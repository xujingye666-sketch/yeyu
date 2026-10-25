// ===== Isolated streaming draft checkpoints =====
// 草稿不放入 D、session.msgs 或 Journal。它们由仓储写入现有 app_meta 中的独立 key，
// 因而不会进入聊天、记忆、世界书或 usage 汇总。
const STREAM_DRAFT_VERSION = 1,
  STREAM_DRAFT_MAX_TEXT_CHARS = 1000000,
  STREAM_DRAFT_MAX_PER_SESSION = 4,
  STREAM_DRAFT_MAX_TOTAL = 32,
  STREAM_DRAFT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000,
  // swipe 与 regenerate 一样写回原助手消息，只是总是新增一个候选。
  STREAM_DRAFT_TARGET_MODES = ['new', 'continue', 'regenerate', 'swipe'],
  // 草稿的停止原因按「该怎么告诉读者」分组：连接断了、应用离开前台、对话基础变了。
  STREAM_DRAFT_NETWORK_REASONS = ['network_error', 'network_offline', 'network_interrupted', 'connection_timeout'],
  STREAM_DRAFT_SUSPEND_REASONS = ['visibility_hidden', 'pagehide', 'native_pause', 'native_stop', 'native_destroy'],
  STREAM_DRAFT_BACKGROUND_REASONS = STREAM_DRAFT_SUSPEND_REASONS.concat(['lifecycle', 'suspended']),
  STREAM_DRAFT_CONTEXT_REASONS = ['base_changed', 'target_missing', 'target_changed', 'branch_switched', 'stale'];
let _streamDrafts = [],
  _streamDraftsLoaded = false,
  _streamDraftLoadPromise = null,
  _activeStreamDraft = null,
  _streamDraftProtectionWarning = '',
  _streamDraftStopFailure = '',
  // 本轮自动保存失败的原因，只记在内存；之后保存成功即移除。
  _streamDraftAutoSaveFailures = {};
function streamDraftHash(value) {
  var text = String(value == null ? '' : value),
    a = 2166136261,
    b = 2654435769;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 16777619);
    b ^= code;
    b = Math.imul(b, 2246822519);
    b = (b << 13) | (b >>> 19);
  }
  return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36) + ':' + text.length;
}
function streamDraftBaseHash(session) {
  var msgs = Array.isArray(session && session.msgs) ? session.msgs : [],
    snapshot = msgs.map(function (msg) {
      return {
        seq: Number(msg && msg.seq) || 0,
        role: String((msg && msg.role) || ''),
        content: String((msg && msg.content) || ''),
        reasoning: String((msg && msg.reasoning) || ''),
      };
    });
  return streamDraftHash(
    JSON.stringify({
      id: String((session && session.id) || ''),
      parentSessionId: String((session && session.parentSessionId) || ''),
      rootSessionId: String((session && session.rootSessionId) || ''),
      branchPointSeq: Number(session && session.branchPointSeq) || 0,
      msgs: snapshot,
    })
  );
}
function streamDraftTargetMessage(session, target) {
  var msgs = Array.isArray(session && session.msgs) ? session.msgs : [];
  if (target && target.mode === 'new') {
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i] && msgs[i].role === 'user') return msgs[i];
    }
    return null;
  }
  var index = generationTargetMessageIndex(target, session);
  return index >= 0 ? msgs[index] : null;
}
function streamDraftTargetIdentity(target, session) {
  var base = streamDraftTargetMessage(session, target);
  return {
    charId: String((target && target.charId) || ''),
    sessionId: String((target && target.sessionId) || ''),
    mode: STREAM_DRAFT_TARGET_MODES.includes(String((target && target.mode) || '')) ? String(target.mode) : 'new',
    targetMessageSeq: Number(base && base.seq) || 0,
    baseHash: streamDraftBaseHash(session),
  };
}
function streamDraftMatchesTarget(draft, target, session, identity) {
  var key = identity || streamDraftTargetIdentity(target, session);
  return !!(
    draft &&
    draft._discarded !== true &&
    draft.state !== 'stale' &&
    draft.charId === key.charId &&
    draft.sessionId === key.sessionId &&
    draft.targetMode === key.mode &&
    Number(draft.targetMessageSeq) === key.targetMessageSeq &&
    draft.committedBaseHash === key.baseHash
  );
}
// 在途生成写着的草稿归这次生成（按生成 epoch 认领）：它的去向由这次生成自己的提交或中断保存决定，
// 对话基础变化只让已经没人写入的草稿失效。
function streamDraftOwnedByGeneration(draft, target) {
  return !!(
    draft &&
    target &&
    draft._generationEpoch &&
    draft._generationEpoch === Number(target.epoch) &&
    draft.charId === String(target.charId || '') &&
    draft.sessionId === String(target.sessionId || '')
  );
}
function streamDraftWrittenByLiveGeneration(draft) {
  return _generationState !== 'idle' && streamDraftOwnedByGeneration(draft, generationTarget);
}
function reusableStreamDraft(target, session, identity) {
  return (
    _streamDrafts
      .filter(function (draft) {
        return streamDraftMatchesTarget(draft, target, session, identity);
      })
      .sort(function (a, b) {
        return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
      })[0] || null
  );
}
function streamDraftVisibleCount(text) {
  try {
    if (window.YeyuPure && typeof window.YeyuPure.visibleCharacterCount === 'function')
      return Number(window.YeyuPure.visibleCharacterCount(String(text || ''))) || 0;
  } catch (_) {}
  return String(text || '').length;
}
function streamDraftState(value) {
  return ['streaming', 'cancelled', 'network_error', 'suspended', 'stale'].includes(String(value || ''))
    ? String(value)
    : 'streaming';
}
function makeStreamDraftCheckpoint(target, session, options) {
  options = options || {};
  var text = String(options.text || '');
  if (!text.trim()) throw new Error('草稿正文为空');
  if (text.length > STREAM_DRAFT_MAX_TEXT_CHARS) throw new Error('草稿正文超过安全上限');
  var identity = options.identity || streamDraftTargetIdentity(target, session),
    seq = Number(identity && identity.targetMessageSeq) || 0;
  if (!seq) throw new Error('草稿基础消息不存在');
  var now = Number(options.now) || Date.now(),
    draftId = String(options.draftId || 'stream_v1_' + uid()).trim(),
    count = streamDraftVisibleCount(text);
  if (!draftId || draftId.length > 160) throw new Error('草稿标识无效');
  return {
    version: STREAM_DRAFT_VERSION,
    draftId: draftId,
    charId: identity.charId,
    sessionId: identity.sessionId,
    targetMode: identity.mode,
    targetMessageSeq: seq,
    committedBaseHash: String(options.committedBaseHash || identity.baseHash),
    text: text,
    receivedChars: count,
    state: streamDraftState(options.state),
    stopReason: String(options.stopReason || ''),
    updatedAt: now,
    createdAt: Number(options.createdAt) || now,
    lastSavedChars: count,
    lastSavedAt: now,
    committedMessageHash: '',
    committedTargetSeq: 0,
    staleReason: '',
  };
}
function shouldCheckpointStreamDraft(draft, nextText, now, force) {
  if (force) return true;
  var next = streamDraftVisibleCount(nextText),
    last = Math.max(0, Number(draft && draft.lastSavedChars) || 0),
    lastAt = Math.max(0, Number(draft && draft.lastSavedAt) || 0),
    at = Number(now) || Date.now();
  return next - last >= 128 || at - lastAt >= 1000;
}
function streamDraftPersistenceRecord(draft) {
  if (!draft || typeof draft !== 'object') return null;
  return {
    version: draft.version,
    draftId: draft.draftId,
    charId: draft.charId,
    sessionId: draft.sessionId,
    targetMode: draft.targetMode,
    targetMessageSeq: draft.targetMessageSeq,
    committedBaseHash: draft.committedBaseHash,
    text: draft.text,
    receivedChars: draft.receivedChars,
    state: draft.state,
    stopReason: draft.stopReason,
    updatedAt: draft.updatedAt,
    createdAt: draft.createdAt,
    lastSavedChars: draft.lastSavedChars,
    lastSavedAt: draft.lastSavedAt,
    committedMessageHash: draft.committedMessageHash,
    committedTargetSeq: draft.committedTargetSeq,
    staleReason: draft.staleReason,
  };
}
function sanitizeStoredStreamDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  var allowed = {
    version: 1,
    draftId: 1,
    charId: 1,
    sessionId: 1,
    targetMode: 1,
    targetMessageSeq: 1,
    committedBaseHash: 1,
    // 旧版草稿带有的续写分段号，读取时忽略。
    segmentIndex: 1,
    text: 1,
    receivedChars: 1,
    state: 1,
    stopReason: 1,
    updatedAt: 1,
    createdAt: 1,
    lastSavedChars: 1,
    lastSavedAt: 1,
    committedMessageHash: 1,
    committedTargetSeq: 1,
    staleReason: 1,
  };
  for (var inherited in value) {
    if (!Object.prototype.hasOwnProperty.call(value, inherited)) return null;
  }
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) {
    if (!allowed[keys[i]]) return null;
  }
  var text = typeof value.text === 'string' ? value.text : null;
  if (!text || text.length > STREAM_DRAFT_MAX_TEXT_CHARS) return null;
  var draftId = String(value.draftId || '').trim(),
    charId = String(value.charId || '').trim(),
    sessionId = String(value.sessionId || '').trim(),
    mode = String(value.targetMode || '');
  if (
    Number(value.version) !== STREAM_DRAFT_VERSION ||
    !draftId ||
    draftId.length > 160 ||
    !charId ||
    charId.length > 160 ||
    !sessionId ||
    sessionId.length > 160 ||
    !STREAM_DRAFT_TARGET_MODES.includes(mode)
  )
    return null;
  var seq = Math.floor(Number(value.targetMessageSeq) || 0),
    baseHash = String(value.committedBaseHash || '');
  if (seq <= 0 || !baseHash || baseHash.length > 160) return null;
  var updated = Math.floor(Number(value.updatedAt) || 0),
    created = Math.floor(Number(value.createdAt) || updated || 0);
  if (updated <= 0 || created <= 0) return null;
  return {
    version: STREAM_DRAFT_VERSION,
    draftId: draftId,
    charId: charId,
    sessionId: sessionId,
    targetMode: mode,
    targetMessageSeq: seq,
    committedBaseHash: baseHash,
    text: text,
    receivedChars: Math.max(0, Math.floor(Number(value.receivedChars) || streamDraftVisibleCount(text))),
    state: streamDraftState(value.state),
    stopReason: String(value.stopReason || '').slice(0, 240),
    updatedAt: updated,
    createdAt: created,
    lastSavedChars: Math.max(0, Math.floor(Number(value.lastSavedChars) || streamDraftVisibleCount(text))),
    lastSavedAt: Math.max(0, Math.floor(Number(value.lastSavedAt) || updated)),
    committedMessageHash: String(value.committedMessageHash || '').slice(0, 160),
    committedTargetSeq: Math.max(0, Math.floor(Number(value.committedTargetSeq) || 0)),
    staleReason: String(value.staleReason || '').slice(0, 120),
  };
}
function isStreamDraftAlreadyCommitted(draft, session) {
  var draftId = String((draft && draft.draftId) || ''),
    hash = String((draft && draft.committedMessageHash) || ''),
    expectedSeq = Math.max(0, Number(draft && draft.committedTargetSeq) || 0),
    msgs = Array.isArray(session && session.msgs) ? session.msgs : [];
  // 草稿也可能存成了未显示的候选，来源 ID 和正文要连同各候选一起核对。
  return msgs.some(function (msg) {
    if (!msg || msg.role !== 'assistant') return false;
    var metas = [msg.generationMeta].concat(Array.isArray(msg.swipeGenerationMeta) ? msg.swipeGenerationMeta : []),
      texts = [msg.content].concat(Array.isArray(msg.swipes) ? msg.swipes : []);
    return (
      (!!draftId &&
        metas.some(function (meta) {
          return !!meta && String(meta.sourceDraftId || '') === draftId;
        })) ||
      (!!hash &&
        (!expectedSeq || Number(msg.seq) === expectedSeq) &&
        texts.some(function (text) {
          return streamDraftHash(String(text || '')) === hash;
        }))
    );
  });
}
function streamDraftExpired(draft) {
  return Date.now() - (Number(draft && draft.updatedAt) || 0) > STREAM_DRAFT_RETENTION_MS;
}
function validateStreamDraftContext(draft, char, session) {
  var safe = sanitizeStoredStreamDraft(streamDraftPersistenceRecord(draft));
  if (!safe) return { valid: false, reason: 'corrupt' };
  if (!char || String(char.id) !== safe.charId) return { valid: false, reason: 'character_missing' };
  if (!session || String(session.id) !== safe.sessionId) return { valid: false, reason: 'session_missing' };
  if (isStreamDraftAlreadyCommitted(safe, session)) return { valid: false, reason: 'already_committed' };
  var target = (session.msgs || []).find(function (msg) {
    return Number(msg && msg.seq) === safe.targetMessageSeq;
  });
  if (!target) return { valid: false, reason: 'target_missing' };
  if (safe.targetMode === 'new' && target.role !== 'user') return { valid: false, reason: 'target_changed' };
  if (safe.targetMode !== 'new' && target.role !== 'assistant') return { valid: false, reason: 'target_changed' };
  if (safe.state === 'stale') return { valid: false, reason: safe.staleReason || 'stale' };
  if (streamDraftBaseHash(session) !== safe.committedBaseHash) return { valid: false, reason: 'base_changed' };
  // 期限最后判断：expired 表示其余都对得上，草稿仍能按原目标保存，只是不再直接续写。
  if (streamDraftExpired(safe)) return { valid: false, reason: 'expired' };
  return { valid: true, reason: '' };
}
function findStreamDraft(draftId) {
  var id = String(draftId || '');
  return (
    _streamDrafts.find(function (draft) {
      return draft && draft.draftId === id;
    }) || null
  );
}
function replaceStreamDraft(draft) {
  var index = _streamDrafts.findIndex(function (item) {
    return item && item.draftId === draft.draftId;
  });
  if (index >= 0) _streamDrafts[index] = draft;
  else _streamDrafts.push(draft);
}
function removeStreamDraftInMemory(draftId) {
  var id = String(draftId || '');
  _streamDrafts = _streamDrafts.filter(function (draft) {
    return draft && draft.draftId !== id;
  });
  if (_activeStreamDraft && _activeStreamDraft.draftId === id) _activeStreamDraft = null;
}
function streamDraftSessionCount(charId, sessionId) {
  return _streamDrafts.filter(function (item) {
    return item && item.charId === charId && item.sessionId === sessionId;
  }).length;
}
function streamDraftCapacityReached(identity) {
  return (
    _streamDrafts.length >= STREAM_DRAFT_MAX_TOTAL ||
    streamDraftSessionCount(identity.charId, identity.sessionId) >= STREAM_DRAFT_MAX_PER_SESSION
  );
}
// 数据库读取失败（恢复页或只读快照回退）期间草稿只留在内存，和 saveData 走同一道闸。
function streamDraftWritesBlocked() {
  return _persistenceBlocked === true || !!_storageHealth.readOnlyFallback;
}
async function persistStreamDraftRecord(draft) {
  var safe = sanitizeStoredStreamDraft(streamDraftPersistenceRecord(draft));
  if (!safe) throw new Error('草稿内容无效或超过安全上限');
  if (streamDraftWritesBlocked()) throw new Error('数据库上次读取失败，草稿暂不写入');
  return window.YeyuRepository.saveStreamDraft(safe);
}
function noteStreamDraftPersistenceFailure(reason) {
  if (_streamDraftProtectionWarning) return;
  _streamDraftProtectionWarning = reason || '草稿保护暂不可用';
  toast(_streamDraftProtectionWarning + '，当前生成仍会继续', 'err');
}
function queueStreamDraftWrite(draft) {
  var snapshot = streamDraftPersistenceRecord(draft),
    revision = Math.max(0, Number(draft._writeRevision) || 0);
  draft._writePromise = Promise.resolve(draft._writePromise)
    .catch(function () {})
    .then(async function () {
      if (draft._discarded === true || revision !== Math.max(0, Number(draft._writeRevision) || 0)) return null;
      try {
        var saved = await persistStreamDraftRecord(snapshot);
        if (draft._discarded === true || revision !== Math.max(0, Number(draft._writeRevision) || 0)) return null;
        if (!findStreamDraft(saved.draftId)) replaceStreamDraft(saved);
        draft.lastSavedChars = saved.lastSavedChars;
        draft.lastSavedAt = saved.lastSavedAt;
        draft.protectionError = '';
        return saved;
      } catch (error) {
        if (draft._discarded === true || revision !== Math.max(0, Number(draft._writeRevision) || 0)) return null;
        draft.protectionError = String((error && error.message) || error || '保存失败');
        noteStreamDraftPersistenceFailure();
        return null;
      }
    });
  return draft._writePromise;
}
function checkpointStreamDraft(target, session, text, options) {
  options = options || {};
  var next = String(text || '');
  if (!next.trim()) return null;
  if (next.length > STREAM_DRAFT_MAX_TEXT_CHARS) {
    noteStreamDraftPersistenceFailure();
    return null;
  }
  // 一次流式只写它自己的那份草稿：交进来的草稿直接沿用，脚本同时改写聊天也不会让它分叉出第二份。
  var identity = options.identity || streamDraftTargetIdentity(target, session),
    draft = options.draft && options.draft._discarded !== true ? options.draft : null;
  if (!draft && _activeStreamDraft && streamDraftMatchesTarget(_activeStreamDraft, target, session, identity))
    draft = _activeStreamDraft;
  if (!draft) draft = reusableStreamDraft(target, session, identity);
  if (draft && draft._committing) return draft;
  if (!draft) {
    // 上限在新建前判断：新草稿不入列、不写库，当前生成照常进行。
    if (streamDraftCapacityReached(identity)) {
      noteStreamDraftPersistenceFailure('未完成草稿已达数量上限，请先处理已有草稿');
      return null;
    }
    try {
      draft = makeStreamDraftCheckpoint(target, session, {
        text: next,
        state: options.state || 'streaming',
        stopReason: options.stopReason || '',
        now: options.now,
        identity: identity,
      });
    } catch (_) {
      return null;
    }
    _activeStreamDraft = draft;
    draft._target = Object.assign({}, target);
    draft._session = session;
    draft._identity = identity;
    draft._generationEpoch = Number(target && target.epoch) || 0;
    replaceStreamDraft(draft);
    queueStreamDraftWrite(draft);
    return draft;
  }
  _activeStreamDraft = draft;
  draft.text = next;
  draft.receivedChars = streamDraftVisibleCount(next);
  draft.state = streamDraftState(options.state || 'streaming');
  draft.stopReason = String(options.stopReason || '');
  draft.updatedAt = Number(options.now) || Date.now();
  draft._target = Object.assign({}, target);
  draft._session = session;
  draft._identity = identity;
  draft._generationEpoch = Number(target && target.epoch) || draft._generationEpoch || 0;
  if (shouldCheckpointStreamDraft(draft, next, draft.updatedAt, options.force === true)) {
    draft.lastSavedChars = draft.receivedChars;
    draft.lastSavedAt = draft.updatedAt;
    queueStreamDraftWrite(draft);
  }
  return draft;
}
// 生命周期与传输层给出的停止原因决定草稿落成什么状态。
function streamDraftStateForReason(reason) {
  if (reason === 'user_cancelled') return 'cancelled';
  if (reason === 'provider_error' || STREAM_DRAFT_NETWORK_REASONS.includes(reason)) return 'network_error';
  return STREAM_DRAFT_SUSPEND_REASONS.includes(reason) ? 'suspended' : 'streaming';
}
async function flushActiveStreamDraft(reason) {
  var draft = _activeStreamDraft;
  if (!draft || !draft.text) return null;
  if (draft._committing) return draft._writePromise;
  var state = streamDraftStateForReason(reason),
    target = draft._target || {
      charId: draft.charId,
      sessionId: draft.sessionId,
      mode: draft.targetMode,
    },
    session = draft._session || findSession(draft.charId, draft.sessionId);
  if (!session) return null;
  checkpointStreamDraft(target, session, draft.text, {
    draft: draft,
    state: state,
    stopReason: reason || state,
    force: true,
    identity: draft._identity,
  });
  try {
    return await draft._writePromise;
  } catch (_) {
    return null;
  }
}
// Resolves false when the active draft did not reach storage; the draft keeps the reason in protectionError.
function flushStreamDrafts(reason) {
  if (STREAM_DRAFT_SUSPEND_REASONS.includes(reason)) stopSpeech();
  var draft = _activeStreamDraft;
  return Promise.resolve(flushActiveStreamDraft(reason || 'lifecycle')).then(
    function () {
      return !(draft && draft.protectionError);
    },
    function () {
      return false;
    }
  );
}
function notifyNativeWebViewPauseReady(epoch, safeToPause) {
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.onWebViewPauseReady === 'function')
      window.AndroidBridge.onWebViewPauseReady(String(epoch), safeToPause === true);
  } catch (_) {}
}
// A draft that failed to reach storage before the app went to the background is reported when it returns.
function noteStreamDraftStopFailure() {
  var draft = _activeStreamDraft;
  _streamDraftStopFailure = (draft && draft.protectionError) || '保存失败';
}
function prepareNativeWebViewStop(epoch) {
  var token = Math.max(0, Math.floor(Number(epoch) || 0)),
    activeAtStart = generationWorkPending(),
    saved = true,
    tasks = [];
  try {
    tasks.push(
      Promise.resolve(flushStreamDrafts('native_stop')).then(function (draftSaved) {
        if (draftSaved !== false) return;
        saved = false;
        noteStreamDraftStopFailure();
      })
    );
  } catch (_) {
    saved = false;
    noteStreamDraftStopFailure();
  }
  try {
    tasks.push(Promise.resolve(flushPendingSave()));
  } catch (_) {
    saved = false;
  }
  Promise.all(tasks).then(
    function () {
      notifyNativeWebViewPauseReady(token, saved && !activeAtStart && !generationWorkPending());
    },
    function () {
      notifyNativeWebViewPauseReady(token, false);
    }
  );
  return true;
}
async function clearStoredStreamDraft(draftId) {
  var id = String(draftId || ''),
    draft = findStreamDraft(id),
    wasActive = !!(_activeStreamDraft && _activeStreamDraft.draftId === id);
  if (!id || streamDraftWritesBlocked()) return false;
  if (draft) {
    draft._discarded = true;
    draft._writeRevision = Math.max(0, Number(draft._writeRevision) || 0) + 1;
  }
  removeStreamDraftInMemory(id);
  if (draft && draft._writePromise) {
    try {
      await draft._writePromise;
    } catch (_) {}
  }
  try {
    await window.YeyuRepository.deleteStreamDraft(id);
    return true;
  } catch (_) {
    if (draft) {
      draft._discarded = false;
      replaceStreamDraft(draft);
      if (wasActive) _activeStreamDraft = draft;
    }
    return false;
  }
}
// 删除角色或对话时，所属草稿随主数据在同一次保存里删除（clearStreamDraftIds）。先作废排队中的写入；
// 保存成功后等在途写入落地再补删一次，免得晚到的写入把草稿写回；保存失败则解除作废。
function holdStreamDraftsForRemoval(charId, sessionIds) {
  var owner = String(charId || ''),
    sessions = Array.isArray(sessionIds) ? sessionIds.map(String) : null,
    drafts = _streamDrafts.filter(function (draft) {
      return draft && draft.charId === owner && (!sessions || sessions.includes(draft.sessionId));
    });
  drafts.forEach(function (draft) {
    draft._discarded = true;
    draft._writeRevision = Math.max(0, Number(draft._writeRevision) || 0) + 1;
  });
  return {
    ids: drafts.map(function (draft) {
      return draft.draftId;
    }),
    release: function () {
      drafts.forEach(function (draft) {
        draft._discarded = false;
      });
    },
    commit: async function () {
      drafts.forEach(function (draft) {
        removeStreamDraftInMemory(draft.draftId);
      });
      await Promise.all(
        drafts.map(function (draft) {
          return Promise.resolve(draft._writePromise)
            .catch(function () {})
            .then(function () {
              return window.YeyuRepository.deleteStreamDraft(draft.draftId);
            })
            .catch(function () {});
        })
      );
    },
  };
}
async function prepareStreamDraftCommit(draftId, reply) {
  var draft = findStreamDraft(draftId);
  if (!draft || !reply) return;
  draft._committing = true;
  draft.committedMessageHash = streamDraftHash(String(reply.content || ''));
  draft.committedTargetSeq = Math.max(0, Number(reply.seq) || 0);
  draft.updatedAt = Date.now();
  draft.lastSavedAt = draft.updatedAt;
  draft.lastSavedChars = streamDraftVisibleCount(draft.text);
  await queueStreamDraftWrite(draft);
}
function streamDraftConflictLabel(reason) {
  reason = String(reason || '');
  if (STREAM_DRAFT_CONTEXT_REASONS.includes(reason)) return '对话内容已变化';
  if (reason === 'character_missing' || reason === 'session_missing') return '角色或对话已不存在';
  if (reason === 'expired' || reason === 'corrupt') return '草稿已失效';
  if (STREAM_DRAFT_NETWORK_REASONS.includes(reason)) return '网络连接中断';
  if (reason === 'provider_error') return '模型服务中断';
  if (reason === 'user_cancelled' || reason === 'cancelled') return '已由你停止';
  if (STREAM_DRAFT_BACKGROUND_REASONS.includes(reason)) return '应用离开前台';
  if (reason === 'streaming') return '正在保存';
  return '生成被中断';
}
async function markStreamDraftsStaleForSession(charId, sessionId, reason, exceptDraftId) {
  var matches = _streamDrafts.filter(function (draft) {
    return (
      draft &&
      draft.charId === String(charId || '') &&
      draft.sessionId === String(sessionId || '') &&
      draft.draftId !== String(exceptDraftId || '') &&
      !streamDraftWrittenByLiveGeneration(draft)
    );
  });
  await Promise.all(
    matches.map(async function (draft) {
      if (draft.state === 'stale' && draft.staleReason === reason) return;
      draft.state = 'stale';
      draft.staleReason = String(reason || 'base_changed');
      draft.stopReason = 'stale';
      draft.updatedAt = Date.now();
      draft.lastSavedAt = draft.updatedAt;
      draft.lastSavedChars = streamDraftVisibleCount(draft.text);
      await queueStreamDraftWrite(draft);
    })
  );
}
function streamDraftContextCheck(draft) {
  var char = generationTargetCharacter(draft),
    session = char && findSession(draft.charId, draft.sessionId);
  return { char: char, session: session, check: validateStreamDraftContext(draft, char, session) };
}
// 已提交、或按本次实际查找所属角色或对话已不存在的草稿直接删除；其余失效草稿标成 stale，交给随后的自动保存。
// 角色与对话是否还在不看记录里存下的 staleReason：旧版曾在只读期把仍在的角色误标为缺失。
async function reconcileStreamDrafts() {
  var removals = [],
    writes = [];
  _streamDrafts.slice().forEach(function (draft) {
    var context = streamDraftContextCheck(draft),
      check = context.check;
    if (!context.char || !context.session || check.reason === 'already_committed') {
      removals.push(draft.draftId);
      return;
    }
    if (!check.valid && check.reason !== 'expired' && draft.state !== 'stale') {
      draft.state = 'stale';
      draft.staleReason = check.reason;
      draft.stopReason = 'stale';
      draft.updatedAt = Date.now();
      draft.lastSavedAt = draft.updatedAt;
      draft.lastSavedChars = streamDraftVisibleCount(draft.text);
      writes.push(queueStreamDraftWrite(draft));
    }
  });
  await Promise.all(writes);
  await Promise.all(removals.map(clearStoredStreamDraft));
}
function streamDraftAutoSaveFailure(draftId) {
  return String(_streamDraftAutoSaveFailures[draftId] || '');
}
// 保留期与全局上限只清理自动保存后仍留下的草稿，本轮保存失败的草稿正文还没落到聊天里，不删也不占上限名额。
// 失效草稿超过保留期删除；基础未变、只是过期的草稿仍能按原目标保存，不因期限删除；超出全局上限的旧记录
// （上限生效前留下的）按更新时间从旧到新删除。
async function pruneUnsavedStreamDrafts() {
  var candidates = _streamDrafts.filter(function (draft) {
      return !streamDraftAutoSaveFailure(draft.draftId);
    }),
    removals = candidates
      .filter(function (draft) {
        var check = streamDraftContextCheck(draft).check;
        return !check.valid && check.reason !== 'expired' && streamDraftExpired(draft);
      })
      .map(function (draft) {
        return draft.draftId;
      });
  candidates
    .filter(function (draft) {
      return removals.indexOf(draft.draftId) < 0;
    })
    .sort(function (a, b) {
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    })
    .slice(STREAM_DRAFT_MAX_TOTAL)
    .forEach(function (draft) {
      removals.push(draft.draftId);
    });
  await Promise.all(removals.map(clearStoredStreamDraft));
}
// 读回的草稿要与当前数据核对、自动保存并清理，都会写库；只读期间留到用户确认恢复写入之后。
// 能写回的草稿先自动保存，再清理剩下的；生成进行中不自动保存，也就不按期限和上限清理。
async function settleLoadedStreamDrafts() {
  if (!_streamDraftsLoaded || streamDraftWritesBlocked()) return false;
  await reconcileStreamDrafts();
  if (_generationState !== 'idle') return true;
  await autoSaveRecoveredStreamDrafts();
  await pruneUnsavedStreamDrafts();
  return true;
}
// 读不出的草稿原样保留在本地数据中；提示里带「清除」，用户确认后才删除这些记录。
function reportUnreadableStreamDrafts(keys) {
  toast(keys.length + ' 份未完成草稿无法读取，已原样保留在本地数据中', 'err', {
    label: '清除',
    run: function () {
      return clearUnreadableStreamDrafts(keys);
    },
  });
}
async function clearUnreadableStreamDrafts(keys) {
  if (!(await appConfirm('清除 ' + keys.length + ' 份无法读取的未完成草稿？清除后无法恢复。', '清除草稿', '清除')))
    return false;
  if (streamDraftWritesBlocked()) {
    toast('数据库上次读取失败，暂不能清除草稿', 'err');
    return false;
  }
  try {
    await window.YeyuRepository.deleteStreamDraftRecords(keys);
  } catch (error) {
    toast('草稿清除失败：' + String((error && error.message) || error), 'err');
    return false;
  }
  toast('已清除无法读取的草稿', 'ok');
  return true;
}
function initStreamDraftRecovery() {
  if (_streamDraftLoadPromise) return _streamDraftLoadPromise;
  _streamDraftLoadPromise = (async function () {
    try {
      var pending = _streamDrafts.slice(),
        clearedIds = new Set(_pendingPrimaryStreamDraftClearIds);
      var loaded = await window.YeyuRepository.loadStreamDrafts(sanitizeStoredStreamDraft);
      _pendingPrimaryStreamDraftClearIds.forEach(function (id) {
        clearedIds.add(id);
      });
      pending = pending.concat(_streamDrafts.slice());
      var merged = new Map();
      loaded.drafts.forEach(function (value) {
        var draft = sanitizeStoredStreamDraft(value);
        if (draft && !clearedIds.has(draft.draftId)) merged.set(draft.draftId, draft);
      });
      if (loaded.unreadable.length) reportUnreadableStreamDrafts(loaded.unreadable);
      pending.forEach(function (draft) {
        if (!clearedIds.has(draft.draftId) && sanitizeStoredStreamDraft(streamDraftPersistenceRecord(draft)))
          merged.set(draft.draftId, draft);
      });
      _streamDrafts = Array.from(merged.values());
      _streamDraftsLoaded = true;
      await settleLoadedStreamDrafts();
    } catch (_) {
      _streamDraftsLoaded = true;
      _streamDraftProtectionWarning = '草稿保护暂不可用';
    }
    if (D && getChar()) renderChat();
    return _streamDrafts;
  })();
  return _streamDraftLoadPromise;
}
function streamDraftUpdatedLabel(value) {
  var time = Number(value) || 0;
  if (!time) return '时间未知';
  var delta = Math.max(0, Date.now() - time);
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return Math.floor(delta / 60000) + ' 分钟前';
  if (delta < 86400000) return Math.floor(delta / 3600000) + ' 小时前';
  return Math.floor(delta / 86400000) + ' 天前';
}
function streamDraftRecoveryHtml(char, session) {
  if (!_streamDraftsLoaded || !char || !session || _generationState !== 'idle') return '';
  var rows = _streamDrafts
    .filter(function (draft) {
      return draft && draft.charId === char.id && draft.sessionId === session.id;
    })
    .sort(function (a, b) {
      return b.updatedAt - a.updatedAt;
    });
  if (!rows.length) return '';
  return rows
    .map(function (draft) {
      var check = validateStreamDraftContext(draft, char, session),
        conflict = !check.valid && check.reason !== 'already_committed',
        reason = conflict
          ? streamDraftConflictLabel(check.reason)
          : streamDraftConflictLabel(draft.stopReason || draft.state),
        failure = streamDraftAutoSaveFailure(draft.draftId),
        actions =
          '<button type="button" class="btn text sm" onclick="retrySaveStreamDraft(' +
          jsArg(draft.draftId) +
          ')">重试保存</button><button type="button" class="btn text sm danger" onclick="discardStreamDraft(' +
          jsArg(draft.draftId) +
          ')">丢弃</button>',
        hint = failure
          ? '自动保存失败：' + esc(failure) + '；草稿仍受保护，可重试保存。'
          : conflict
            ? '基础内容已变化，系统仍会把已保存正文作为普通回复保存。'
            : '正在保存已生成的正文。';
      return (
        '<section class="stream-draft-recovery' +
        (conflict ? ' stale' : '') +
        '"><div class="stream-draft-recovery-copy"><strong>上次生成未完成</strong><span>已保存 ' +
        (Number(draft.receivedChars) || streamDraftVisibleCount(draft.text)) +
        ' 字 · ' +
        esc(streamDraftUpdatedLabel(draft.updatedAt)) +
        ' · ' +
        esc(reason) +
        '</span><small' +
        (failure ? ' class="warn"' : '') +
        '>' +
        hint +
        '</small>' +
        (_streamDraftProtectionWarning
          ? '<small class="warn">' + esc(_streamDraftProtectionWarning) + '</small>'
          : '') +
        '</div><div class="stream-draft-recovery-actions">' +
        actions +
        '</div></section>'
      );
    })
    .join('');
}
function streamDraftSourceUserSeq(session, draft, index) {
  var msgs = Array.isArray(session && session.msgs) ? session.msgs : [],
    end = Number.isInteger(index) ? index : msgs.length - 1;
  if (draft && draft.targetMode === 'new' && msgs[end] && msgs[end].role === 'user') return Number(msgs[end].seq) || 0;
  for (var i = Math.min(end, msgs.length - 1); i >= 0; i--) {
    if (msgs[i] && msgs[i].role === 'user') return Number(msgs[i].seq) || 0;
  }
  return 0;
}
// 在途生成中断时，它的草稿照这次生成原本的目标保存：生成期间脚本改写聊天不改变它要写回哪条回复。
// 目标回复已被删除时返回 null，交给下面的恢复规则另找落点。
function streamDraftOwnTarget(draft, session) {
  var target = {
    charId: draft.charId,
    sessionId: draft.sessionId,
    mode: draft.targetMode,
  };
  if (draft.targetMode === 'new') return target;
  target.messageSeq = draft.targetMessageSeq;
  return generationTargetMessageIndex(target, session) >= 0 ? target : null;
}
function streamDraftTargetForCommit(draft, session, allowStale) {
  var index = (session.msgs || []).findIndex(function (msg) {
      return Number(msg && msg.seq) === Number(draft.targetMessageSeq);
    }),
    check = validateStreamDraftContext(draft, generationTargetCharacter(draft), session);
  if (!allowStale && (!check.valid || index < 0)) return null;
  var target = { charId: draft.charId, sessionId: draft.sessionId };
  if (check.valid || check.reason === 'expired')
    return Object.assign(
      target,
      { mode: draft.targetMode, messageIndex: index },
      draft.targetMode === 'new' ? {} : { messageSeq: draft.targetMessageSeq }
    );
  // 基础已变时，草稿对应的回复还在就存成它的新候选，不另起一条连续的助手消息，也不覆盖已有候选；
  // 新候选不切成当前显示（appendSwipe），历史中间的回复不会在启动时被换掉，摘要与缓存也不失效。
  var reply = streamDraftExistingReplyIndex(session, draft, index);
  if (reply >= 0)
    return Object.assign(target, { mode: 'appendSwipe', messageIndex: reply, messageSeq: session.msgs[reply].seq });
  return Object.assign(target, { mode: 'new', sourceUserSeq: streamDraftSourceUserSeq(session, draft, index) });
}
// 草稿对应的现有回复：目标本身是助手消息就是它；新回复草稿的目标用户消息后面已经有了普通回复时，就是那条回复。
// 开场白不算回复：它的候选是卡片的各条开场白，草稿混进去会成为多出来的一条开场白，所以走新回复落点。
function streamDraftExistingReplyIndex(session, draft, index) {
  var msgs = session.msgs || [],
    base = msgs[index],
    next = msgs[index + 1];
  if (!base) return -1;
  if (base.role === 'assistant') return base.opening === true ? -1 : index;
  return draft.targetMode === 'new' && base.role === 'user' && next && next.role === 'assistant' && !next.kind
    ? index + 1
    : -1;
}
// 续写草稿只存接续部分；改存为新候选时接在该回复当前原文后面，候选才是完整的一段回复。
function streamDraftCommitText(draft, target, session) {
  var text = String(draft.text || '');
  if (draft.targetMode !== 'continue' || target.mode !== 'appendSwipe') return text;
  return messageUntranslatedContent(session.msgs[target.messageIndex]) + text;
}
function generationInterruption(value, source) {
  if (!value || typeof value !== 'object') return null;
  var kind = '',
    status = 0,
    detail = '';
  if (source === 'error') {
    if (value.name === 'AbortError' || String(value.message || '') === '已取消') return null;
    kind = String(value.interruptionReason || '');
    status = Math.floor(Number(value.status) || 0);
    if (value.responseText) detail = providerErrorText(String(value.responseText));
    if (!kind)
      kind = status
        ? 'provider_error'
        : typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'network_offline'
          : 'network_interrupted';
  } else if (source === 'draft') {
    var reason = String(value.stopReason || value.state || '');
    if (reason === 'user_cancelled' || reason === 'cancelled') kind = 'user_cancelled';
    else if (reason === 'connection_timeout' || reason === 'provider_error') kind = reason;
    else if (reason === 'network_offline') kind = 'network_offline';
    else if (reason === 'network_error' || reason === 'network_interrupted') kind = 'network_interrupted';
    else if (STREAM_DRAFT_BACKGROUND_REASONS.includes(reason)) kind = 'app_suspended';
    else if (STREAM_DRAFT_CONTEXT_REASONS.includes(reason)) kind = 'context_changed';
    else return null;
  } else {
    kind = String(value.kind || '');
    status = Math.floor(Number(value.status) || 0);
    detail = String(value.detail || '');
  }
  if (GENERATION_INTERRUPTION_KINDS.indexOf(kind) < 0) return null;
  var result = { kind: kind };
  detail = detail
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
  if (status >= 100 && status <= 599) result.status = status;
  if (detail) result.detail = detail;
  return result;
}
function streamDraftIncompleteMeta(draft, interruption) {
  var meta = { sourceDraftId: String((draft && draft.draftId) || '') },
    reason = generationInterruption(interruption) || generationInterruption(draft, 'draft');
  if (reason) {
    meta.incomplete = true;
    meta.interruptionReason = reason.kind;
    if (reason.status) meta.interruptionStatus = reason.status;
    if (reason.detail) meta.interruptionDetail = reason.detail;
  }
  return meta;
}
async function commitStreamDraftAsIncomplete(draftId, options) {
  options = options || {};
  var draft = findStreamDraft(draftId),
    char = generationTargetCharacter(draft),
    session = char && findSession(draft.charId, draft.sessionId);
  if (!draft || !char || !session)
    return { saved: false, target: null, error: new Error('草稿所属角色或对话已不存在') };
  if (isStreamDraftAlreadyCommitted(draft, session)) {
    await clearStoredStreamDraft(draft.draftId);
    delete _streamDraftAutoSaveFailures[draft.draftId];
    return { saved: true, target: null, alreadyCommitted: true };
  }
  var target =
    (options.ownerTarget && streamDraftOwnTarget(draft, session)) || streamDraftTargetForCommit(draft, session, true);
  if (!target) return { saved: false, target: null, error: new Error('草稿无法写入当前对话') };
  if (options.ownerTarget) inheritGenerationTargetOwnership(target, options.ownerTarget);
  var text = streamDraftCommitText(draft, target, session);
  try {
    await commitGeneratedResponse(target, text, {
      generationMeta: streamDraftIncompleteMeta(draft, options.interruption),
      streamDraftId: draft.draftId,
      deferMemorySummary: true,
      allowCancelledCommit: options.allowCancelled === true,
    });
    delete _streamDraftAutoSaveFailures[draft.draftId];
    return { saved: true, target: target, content: text };
  } catch (error) {
    _streamDraftAutoSaveFailures[draft.draftId] = String((error && error.message) || error || '保存失败').slice(0, 120);
    return { saved: false, target: target, error: error };
  }
}
async function autoSaveInterruptedStreamDraft(target, error) {
  var draft = _activeStreamDraft,
    session = draft && findSession(draft.charId, draft.sessionId);
  if (!draft || !draft.text || !session || !streamDraftOwnedByGeneration(draft, target))
    return { saved: false, skipped: true, target: null };
  var interruption = generationInterruption(error, 'error') || generationInterruption(draft, 'draft'),
    commitOptions = { allowCancelled: true, ownerTarget: target };
  if (interruption) commitOptions.interruption = interruption;
  var result = await commitStreamDraftAsIncomplete(draft.draftId, commitOptions);
  if (result.saved) toast('未完成回复已自动保存，可点击“继续生成”接着写。', 'info');
  return result;
}
async function retrySaveStreamDraft(draftId) {
  if (_generationState !== 'idle') {
    toast('当前回复仍在生成', 'info');
    return false;
  }
  var result;
  try {
    result = await commitStreamDraftAsIncomplete(draftId, { allowCancelled: true });
    if (result.saved) {
      toast('未完成回复已保存', 'ok');
      renderChat();
      return true;
    }
    toast('未完成回复保存失败：' + String((result.error && result.error.message) || '未知错误'), 'err');
    renderChat();
    return false;
  } finally {
    finishGeneration((result && result.target) || null);
  }
}
async function autoSaveRecoveredStreamDrafts() {
  if (_generationState !== 'idle') return 0;
  var ids = _streamDrafts
      .filter(function (draft) {
        return draft && draft.text;
      })
      .sort(function (a, b) {
        return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
      })
      .map(function (draft) {
        return draft.draftId;
      }),
    saved = 0,
    attempted = false;
  try {
    for (var i = 0; i < ids.length; i++) {
      attempted = true;
      var result = await commitStreamDraftAsIncomplete(ids[i], { allowCancelled: true });
      if (result.saved) saved++;
    }
  } finally {
    if (attempted) setGenerationState('idle');
  }
  if (saved) toast('已自动保存 ' + saved + ' 条未完成回复', 'info');
  return saved;
}
async function discardStreamDraft(draftId) {
  var draft = findStreamDraft(draftId);
  if (!draft) return false;
  if (!(await clearStoredStreamDraft(draft.draftId))) {
    toast('未完成草稿丢弃失败，请重试', 'err');
    return false;
  }
  renderChat();
  toast('已丢弃未完成草稿', 'info');
  return true;
}
if (typeof window !== 'undefined') window.flushStreamDrafts = flushStreamDrafts;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushStreamDrafts('visibility_hidden');
    else if (_streamDraftStopFailure) {
      toast('切到后台前未完成回复草稿没有保存成功：' + _streamDraftStopFailure, 'err');
      _streamDraftStopFailure = '';
    }
  });
  window.addEventListener('pagehide', function () {
    flushStreamDrafts('pagehide');
  });
}
