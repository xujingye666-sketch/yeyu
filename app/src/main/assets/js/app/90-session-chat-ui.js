// ===== Session management =====
var _sessionManagerOpen = false,
  _sessionManagerTimer = null;
var _pendingBranchMerge = null,
  _pendingBranchMergeChoice = null;
function copyJsonData(value) {
  return JSON.parse(JSON.stringify(value));
}
function syncEmptyHomeCopy() {
  const title = $('empty-home-title');
  const copy = document.querySelector('#empty-home .empty-home-copy');
  if (!title || !copy) return;
  const hasCharacters = !!(D && D.characters && D.characters.some(Boolean));
  title.textContent = hasCharacters ? '选择一个角色' : '还没有角色';
  copy.textContent = hasCharacters
    ? '从侧栏选择一个角色开始对话，或导入、创建新角色。'
    : '导入一张角色卡（PNG、JSON 或 CHARX），或从空白创建一个角色，就可以开始对话。';
}
function findSession(charId, sessionId) {
  var box = D.chats && D.chats[charId];
  return box && Array.isArray(box.sessions)
    ? box.sessions.find(function (sess) {
        return sess.id === sessionId;
      })
    : null;
}
function nextBranchName(box, parent) {
  var prefix = (parent.name || '对话') + ' · 支线 ',
    n = 1,
    names = new Set(
      (box.sessions || []).map(function (sess) {
        return sess.name;
      })
    );
  while (names.has(prefix + n)) n++;
  return prefix + n;
}
function nextSessionName(box, prefix) {
  prefix = String(prefix || '对话 ');
  var n = 1,
    names = new Set(
      (box.sessions || [])
        .filter(function (sess) {
          return !sess.parentSessionId;
        })
        .map(function (sess) {
          return sess.name;
        })
    );
  while (names.has(prefix + n)) n++;
  return prefix + n;
}
function sessionManagerRowsForQuery(sessions, query) {
  var all = Array.isArray(sessions) ? sessions : [],
    matched = window.YeyuPure.filterSessions(all, query),
    visible = new Set(
      matched.map(function (sess) {
        return String(sess.id);
      })
    ),
    children = Object.create(null),
    added = new Set(),
    rows = [];
  all.forEach(function (sess) {
    var parentId = String((sess && sess.parentSessionId) || '');
    if (parentId) (children[parentId] || (children[parentId] = [])).push(sess);
  });
  function add(sess) {
    var id = String((sess && sess.id) || '');
    if (!visible.has(id) || added.has(id)) return;
    added.add(id);
    rows.push(sess);
    (children[id] || []).forEach(add);
  }
  matched.forEach(function (sess) {
    var parentId = String((sess && sess.parentSessionId) || '');
    if (!parentId || !visible.has(parentId)) add(sess);
  });
  matched.forEach(add);
  return rows;
}
function returnToParentSession(sessionId) {
  var char = getChar();
  if (!char) return;
  var box = getSessions(char.id),
    branch = box.sessions.find(function (sess) {
      return sess.id === sessionId;
    }),
    parent =
      branch &&
      box.sessions.find(function (sess) {
        return sess.id === branch.parentSessionId;
      });
  if (!branch || !branch.parentSessionId) {
    toast('这不是分支对话', 'info');
    return;
  }
  if (!parent) {
    toast('父对话已被删除，无法返回', 'err');
    return;
  }
  switchSession(parent.id);
}
function isBranchReturnRevertMessage(msg) {
  return !!(msg && msg.role === 'system' && msg.kind === 'branch-return-revert');
}
function branchReturnText(value, limit) {
  var text =
    typeof sanitizeGeneratedVisibleContent === 'function'
      ? sanitizeGeneratedVisibleContent(value, { fromProvider: true })
      : String(value || '').trim();
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, Number(limit) || 1200));
}
function branchReturnLastMessageText(last) {
  last = last && typeof last === 'object' ? last : {};
  return (
    '角色：' +
    String(last.role || '') +
    '\n说话者：' +
    String(last.speaker || '') +
    '\n消息序号：' +
    Number(last.seq || 0) +
    '\n原文：' +
    String(last.content || '')
  );
}
function cancelBranchMergePreview() {
  _pendingBranchMerge = null;
  _pendingBranchMergeChoice = null;
  closeModal('branch-merge-modal');
}
function renderSessions() {
  const label = $('session-current'),
    char = getChar();
  if (!char) {
    if (label) label.textContent = '';
    closeSessionManager();
    return;
  }
  const c = getSessions(char.id),
    active =
      c.sessions.find(function (x) {
        return x.id === c.activeSid;
      }) || c.sessions[0];
  if (!active) return;
  // Generated branch names already end with "支线 N"; only renamed branches need the kind prefix.
  var kind = !active.parentSessionId
    ? ''
    : active.checkpoint
      ? '检查点 · '
      : branchSessionUsesGeneratedName(active)
        ? ''
        : '支线 · ';
  if (label) label.textContent = kind + active.name;
  var switcher = $('chat-session-switch');
  if (switcher) switcher.title = canonicalCharacterName(char) + ' · ' + active.name + ' · 切换对话';
  var count = $('session-count');
  if (count) count.textContent = c.sessions.length + ' 个对话';
  syncChatHeaderTyping();
  renderSessionManager();
}
// While a reply for the conversation on screen is being written, 「正在输入…」 takes the place of its name.
// Background work such as translation has no generation target, so it never reads as typing.
function syncChatHeaderTyping() {
  var heading = $('chat-session-switch');
  if (!heading) return;
  var target = typeof generationTarget === 'undefined' ? null : generationTarget,
    writing =
      (_generationState === 'preparing' || _generationState === 'streaming') &&
      !!target &&
      typeof chatViewportTargetVisible === 'function' &&
      chatViewportTargetVisible(target);
  heading.classList.toggle('typing', writing);
}
function renderSessionManager() {
  var panel = $('session-manager-panel'),
    list = $('session-manager-list'),
    char = getChar();
  if (!panel || !list || !char) return;
  transitionUiVisibility(panel, _sessionManagerOpen, function () {
    panel.classList.toggle('open', _sessionManagerOpen);
  });
  document.querySelectorAll('[aria-controls="session-manager-panel"]').forEach(function (button) {
    button.setAttribute('aria-expanded', String(_sessionManagerOpen));
  });
  if (!_sessionManagerOpen) return;
  var c = getSessions(char.id),
    q = String($('session-manager-search')?.value || '')
      .trim()
      .toLowerCase(),
    rows = sessionManagerRowsForQuery(c.sessions, q);
  list.innerHTML = rows.length
    ? rows
        .map(function (sess) {
          var active = sess.id === c.activeSid,
            parent =
              sess.parentSessionId &&
              c.sessions.find(function (x) {
                return x.id === sess.parentSessionId;
              }),
            children = c.sessions.filter(function (x) {
              return x.parentSessionId === sess.id;
            }).length,
            meta =
              sess.msgs.length +
              ' 条消息' +
              (active ? ' · 当前对话' : '') +
              (sess.parentSessionId
                ? ' · ' +
                  (sess.checkpoint ? '检查点' : '分支') +
                  (parent ? '，父对话：' + parent.name : '，父对话已删除')
                : '') +
              (children ? ' · ' + children + ' 条支线' : '');
          var returnBlocked =
              sess.parentSessionId && parent && typeof branchReturnReturnBlockedReason === 'function'
                ? branchReturnReturnBlockedReason(sess, parent)
                : '',
            branchActions = sess.parentSessionId
              ? parent
                ? '<button class="btn text sm" onclick="returnToParentSession(' +
                  jsArg(sess.id) +
                  ')">返回父对话</button>' +
                  (!sess.checkpoint && branchReturnHasNewMessages(sess)
                    ? returnBlocked
                      ? '<button class="btn text sm" disabled title="' +
                        escAttr(returnBlocked) +
                        '">分叉位置已整理，无法带回</button><small class="session-return-unavailable">可进入支线后手动复制需要的内容。</small>'
                      : '<button class="btn text sm" onclick="prepareBranchMerge(' +
                        jsArg(sess.id) +
                        ')">将支线带回父对话</button>'
                    : '')
                : '<button class="btn text sm" disabled>父对话已删除</button>'
              : '';
          return (
            '<div class="session-manager-row' +
            (active ? ' active' : '') +
            (sess.parentSessionId ? ' branch' + (parent ? '' : ' orphan') : '') +
            '"><button class="session-manager-main" onclick="switchSession(' +
            jsArg(sess.id) +
            ')"><strong>' +
            (sess.parentSessionId ? uiIcon('branch') : '') +
            esc(sess.name) +
            '</strong><small>' +
            esc(meta) +
            '</small></button><div class="session-manager-actions">' +
            branchActions +
            '<button class="btn text sm" onclick="renameSession(' +
            jsArg(sess.id) +
            ')">重命名</button><button class="btn text sm danger" onclick="deleteSession(' +
            jsArg(sess.id) +
            ')">' +
            (c.sessions.length > 1 ? '删除' : '清空') +
            '</button></div></div>'
          );
        })
        .join('')
    : '<div class="ui-empty">没有名称包含这个词的对话</div>';
}
function scheduleSessionManagerRender() {
  clearTimeout(_sessionManagerTimer);
  _sessionManagerTimer = setTimeout(renderSessionManager, 100);
}
function toggleSessionManager() {
  closeChatTools();
  _sessionManagerOpen = !_sessionManagerOpen;
  renderSessionManager();
  if (_sessionManagerOpen) $('session-manager-panel')?.focus({ preventScroll: true });
}

function closeChatTools() {
  var panel = $('chat-tools-panel'),
    button = $('chat-tools-toggle');
  if (!panel || !button) return;
  var restoreFocus = panel.contains(document.activeElement);
  transitionUiVisibility(panel, false, function () {
    panel.hidden = true;
  });
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button.focus({ preventScroll: true });
}
function toggleChatTools() {
  var panel = $('chat-tools-panel'),
    button = $('chat-tools-toggle');
  if (!panel || !button || !getChar()) return;
  if (!panel.hidden) return closeChatTools();
  closeSessionManager();
  transitionUiVisibility(panel, true, function () {
    panel.hidden = false;
  });
  button.setAttribute('aria-expanded', 'true');
  panel.focus({ preventScroll: true });
}
function closeSessionManager() {
  _sessionManagerOpen = false;
  var panel = $('session-manager-panel');
  if (panel) {
    var restoreFocus = panel.contains(document.activeElement);
    transitionUiVisibility(panel, false, function () {
      panel.classList.remove('open');
    });
    if (restoreFocus) $('chat-session-switch')?.focus({ preventScroll: true });
  }
  document.querySelectorAll('[aria-controls="session-manager-panel"]').forEach(function (button) {
    button.setAttribute('aria-expanded', 'false');
  });
}

function renameSession(sid) {
  var char = getChar();
  if (!char) return;
  var c = getSessions(char.id);
  var s = c.sessions.find(function (x) {
    return x.id === sid;
  });
  if (!s) return;
  $('rename-session-id').value = sid;
  $('rename-session-name').value = s.name || '';
  openModal('rename-session-modal');
  setTimeout(function () {
    var input = $('rename-session-name');
    if (input) {
      input.select();
    }
  }, 80);
}
function handleRenameSessionKey(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveRenameSession();
  }
}

async function saveRenameSession() {
  var char = getChar();
  if (!char) return;
  var sid = $('rename-session-id').value;
  var name = $('rename-session-name').value.trim();
  if (!name) {
    toast('名称不能为空', 'err');
    return;
  }
  var c = getSessions(char.id);
  var s = c.sessions.find(function (x) {
    return x.id === sid;
  });
  if (!s) return;
  var oldName = s.name;
  s.name = name;
  try {
    await saveData('sessions');
  } catch (error) {
    if (s.name === name) s.name = oldName;
    toast('重命名保存失败，原名称已恢复：' + error.message, 'err');
    return;
  }
  renderSessions();
  closeModal('rename-session-modal');
  toast('已重命名', 'ok');
}

function chatDescendantSessions(box, sessionId) {
  var sessions = box && Array.isArray(box.sessions) ? box.sessions : [],
    seen = new Set([String(sessionId || '')]),
    rows = [],
    pending = [String(sessionId || '')];
  while (pending.length) {
    var parentId = pending.shift();
    sessions.forEach(function (sess) {
      var id = String((sess && sess.id) || '');
      if (!id || seen.has(id) || String((sess && sess.parentSessionId) || '') !== parentId) return;
      seen.add(id);
      rows.push(sess);
      pending.push(id);
    });
  }
  return rows;
}
function chatSessionCascade(box, sessionId, includeRoot) {
  var target =
      box && Array.isArray(box.sessions)
        ? box.sessions.find(function (row) {
            return String((row && row.id) || '') === String(sessionId || '');
          })
        : null,
    descendants = target ? chatDescendantSessions(box, target.id) : [],
    rows = target && includeRoot ? [target].concat(descendants) : descendants;
  return {
    target: target,
    descendants: descendants,
    rows: rows,
    ids: rows.map(function (row) {
      return row.id;
    }),
  };
}
function chatSessionCascadeStillCurrent(box, cascade, includeRoot) {
  var current = chatSessionCascade(box, cascade.target.id, includeRoot);
  return (
    current.target === cascade.target &&
    current.rows.length === cascade.rows.length &&
    current.rows.every(function (row) {
      return cascade.rows.includes(row);
    })
  );
}
function removeChatSessionCascade(box, cascade, mutation) {
  var removed = new Set((cascade && cascade.ids) || []);
  for (var i = box.sessions.length - 1; i >= 0; i--) {
    if (!removed.has(box.sessions[i].id)) continue;
    if (typeof releaseRisuExecutionSession === 'function') releaseRisuExecutionSession(box.sessions[i]);
    if (typeof cancelGenerationPostCommit === 'function') cancelGenerationPostCommit(box.sessions[i]);
    if (mutation) mutation.splice(box.sessions, i, 1);
    else box.sessions.splice(i, 1);
  }
  (box.sessions || []).forEach(function (session) {
    (session.msgs || []).forEach(function (message) {
      if (!message || !removed.has(message.checkpointSessionId)) return;
      if (mutation) mutation.capture(message, ['checkpointSessionId', 'checkpointName'], true);
      delete message.checkpointSessionId;
      delete message.checkpointName;
    });
  });
  return Array.from(removed);
}

// 删除角色或对话留下的派生数据：所属流式草稿与主数据在同一次保存里删除，资料库附件向量在保存成功后
// 按剩余引用清理。
function beginOwnedChatDataRemoval(charId, sessionIds, owners) {
  var drafts = typeof holdStreamDraftsForRemoval === 'function' ? holdStreamDraftsForRemoval(charId, sessionIds) : null,
    urls = typeof dataBankAttachmentUrls === 'function' ? dataBankAttachmentUrls(owners) : [];
  return {
    saveOptions: function (options) {
      return Object.assign({}, options, { clearStreamDraftIds: drafts ? drafts.ids : [] });
    },
    release: function () {
      if (drafts) drafts.release();
    },
    commit: function () {
      if (drafts) drafts.commit().catch(function () {});
      if (urls.length && typeof dataBankForgetAttachments === 'function') dataBankForgetAttachments(urls);
    },
  };
}
function confirmChatSessionDeletion(cascade) {
  var lines = ['删除对话「' + cascade.target.name + '」？'];
  if (cascade.descendants.length)
    lines.push(
      '同时删除 ' +
        cascade.descendants.length +
        ' 条后代支线：\n' +
        cascade.descendants
          .map(function (row) {
            return '• ' + row.name;
          })
          .join('\n')
    );
  lines.push('此操作不可撤销。');
  return appConfirm(lines.join('\n\n'), '删除对话', cascade.descendants.length ? '删除对话及支线' : '删除');
}
async function deleteSession(sid) {
  if (blockDuringGeneration('删除对话')) return;
  var char = getChar();
  if (!char) return;
  var c = getSessions(char.id);
  if (c.sessions.length <= 1) {
    await clearChat();
    return;
  }
  var cascade = chatSessionCascade(c, sid, true),
    s = cascade.target;
  if (!s) return;
  if (cascade.ids.length === c.sessions.length) {
    await clearChat(s.id);
    return;
  }
  if (!(await confirmChatSessionDeletion(cascade))) return;
  if (getChar() !== char || D.chats[char.id] !== c || !chatSessionCascadeStillCurrent(c, cascade, true)) return;
  if (typeof qrStopAndAwait === 'function') await qrStopAndAwait();
  else if (typeof stopStscriptRun === 'function') stopStscriptRun();
  if (getChar() !== char || D.chats[char.id] !== c || !chatSessionCascadeStillCurrent(c, cascade, true)) return;
  var mutation = createMutationJournal(),
    ownedData = beginOwnedChatDataRemoval(char.id, cascade.ids, cascade.rows);
  mutation.capture(c, ['activeSid'], true);
  removeChatSessionCascade(c, cascade, mutation);
  if (cascade.ids.includes(c.activeSid)) c.activeSid = c.sessions[0].id;
  mutation.seal();
  try {
    await saveData('sessions', ownedData.saveOptions());
  } catch (error) {
    mutation.rollback();
    ownedData.release();
    if (typeof syncRisuExecutionSessions === 'function') syncRisuExecutionSessions();
    toast('删除保存失败，对话和全部后代支线已恢复：' + error.message, 'err');
    return;
  }
  ownedData.commit();
  if (typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, cascade.ids);
  renderChat();
  updateChatUI();
  toast(
    cascade.descendants.length ? '对话和 ' + cascade.descendants.length + ' 条后代支线已删除' : '对话已删除',
    'info'
  );
}

async function switchSession(sid) {
  const char = getChar();
  if (!char) return;
  if (typeof qrStopAndAwait === 'function') await qrStopAndAwait();
  else if (typeof stopStscriptRun === 'function') stopStscriptRun();
  if (getChar() !== char) return;
  const c = getSessions(char.id),
    before = c.activeSid,
    from = c.sessions.find(function (sess) {
      return sess && sess.id === before;
    }),
    next = c.sessions.find(function (sess) {
      return sess && sess.id === sid;
    });
  if (!next) return;
  rememberCurrentChatPosition();
  if (before !== sid && typeof cancelGenerationPostCommit === 'function') cancelGenerationPostCommit(from);
  if (from && from !== next && typeof releaseRisuExecutionSession === 'function') releaseRisuExecutionSession(from);
  c.activeSid = sid;
  if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('switch-session');
  try {
    await saveData('sessions', { urgent: true });
  } catch (error) {
    if (c.activeSid === sid) c.activeSid = before;
    if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('switch-session-revert');
    toast('对话切换保存失败：' + error.message, 'err');
    return;
  }
  await finishSessionSwitch(char, from, next);
}
async function finishSessionSwitch(char, from, next) {
  function live() {
    return getChar() === char && getActiveSession(char.id) === next;
  }
  if (!live()) return false;
  var branchTransition = from && from !== next && (from.parentSessionId || next.parentSessionId);
  if (branchTransition && typeof markStreamDraftsStaleForSession === 'function')
    await markStreamDraftsStaleForSession(char.id, from.id, 'branch_switched');
  if (!live()) return false;
  if (typeof prepareRegexScriptDisplayTexts === 'function') await prepareRegexScriptDisplayTexts(char, next.msgs || []);
  if (!live()) return false;
  closeSessionManager();
  renderChat();
  updateChatUI();
  if (typeof qrPerformAuto === 'function') await qrPerformAuto('executeOnChatChange', { current: live });
  if (!live()) return false;
  if (typeof presetTaskCall === 'function') {
    await presetTaskCall('onSessionChanged', next.id);
    if (!live()) return false;
    await presetTaskCall('onChatChanged', { characterId: char.id, sessionId: next.id });
  }
  return live();
}

async function addSession() {
  if (blockDuringGeneration('新建对话')) return;
  const char = getChar();
  if (!char) return;
  const c = getSessions(char.id);
  var ownerSession = getActiveSession(char.id);
  var name = await appInput('对话名称（留空使用默认）：', '', '新建对话', '对话名称', { okText: '新建对话' });
  if (name === null) return;
  if (getChar() !== char || D.chats[char.id] !== c || getActiveSession(char.id) !== ownerSession) return;
  // Snapshot immediately before the picker: its preview reads this same active conversation, and
  // the new conversation must keep the exact card options under which the greeting was chosen.
  var inheritedOptions =
    typeof risuInheritedCardOptions === 'function' ? risuInheritedCardOptions(getActiveSession(char.id)) : null;
  var greet = await chooseGreeting(char);
  if (greet === null) return;
  if (getChar() !== char || D.chats[char.id] !== c || getActiveSession(char.id) !== ownerSession) return;
  if (typeof qrStopAndAwait === 'function') await qrStopAndAwait();
  else if (typeof stopStscriptRun === 'function') stopStscriptRun();
  if (getChar() !== char || D.chats[char.id] !== c || getActiveSession(char.id) !== ownerSession) return;
  const s = createBlankSession((name && name.trim()) || nextSessionName(c, '对话 '));
  if (typeof risuApplyInheritedCardOptions === 'function') risuApplyInheritedCardOptions(s, inheritedOptions);
  var mutation = createMutationJournal(),
    selectedGreeting = typeof greet === 'object' ? greet.text : greet,
    openingIndex = typeof greet === 'object' ? greet.index : null;
  rememberCurrentChatPosition();
  mutation.capture(c, ['activeSid'], true);
  mutation.splice(c.sessions, c.sessions.length, 0, [s]);
  if (typeof releaseRisuExecutionSession === 'function') releaseRisuExecutionSession(ownerSession);
  if (typeof cancelGenerationPostCommit === 'function') cancelGenerationPostCommit(ownerSession);
  c.activeSid = s.id;
  if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('new-session');
  s.greetingChosen = true;
  if (selectedGreeting) {
    appendOpeningGreeting(char, s, selectedGreeting, openingIndex);
    if (typeof markCardFrontendChatCreated === 'function') markCardFrontendChatCreated(char, s);
  }
  mutation.seal();
  try {
    await saveData('sessions', { urgent: true });
  } catch (error) {
    mutation.rollback();
    if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('new-session-revert');
    toast('新建对话保存失败：' + error.message, 'err');
    return;
  }
  if (getChar() !== char || getActiveSession(char.id) !== s) return;
  closeSessionManager();
  renderChat();
  updateChatUI();
  scrollChatToBottomAfterRender();
  if (selectedGreeting) queueOpeningMediaHydration(char, Number.isInteger(openingIndex) ? openingIndex : 0);
  if (typeof qrPerformAuto === 'function') await qrPerformAuto('executeOnNewChat');
  if (typeof presetTaskCall === 'function') {
    await presetTaskCall('onSessionChanged', s.id);
    await presetTaskCall('onChatCreated', { characterId: char.id, sessionId: s.id });
  }
  toast('新对话已创建', 'ok');
}

function branchSessionUsesGeneratedName(sess) {
  return /^.+ · 支线 [1-9]\d*$/.test(String((sess && sess.name) || ''));
}
function detachSessionFromBranch(sess) {
  [
    'parentSessionId',
    'rootSessionId',
    'branchPointSeq',
    'branchPointIndex',
    'branchMemoryThroughSeq',
    'lastMergedSeq',
    'lastMergeAt',
    'lastMergeId',
    'lastMergeParentSeq',
    'lastMergeBridgeId',
    'forkAnchorVersion',
    'branchPointHash',
    'parentTailOrdinarySeqAtFork',
    'parentTailOrdinaryHashAtFork',
    'parentOrdinaryStateHashAtFork',
    'lastMergeParentStateHash',
    'checkpoint',
  ].forEach(function (key) {
    delete sess[key];
  });
}
function resetClearedSession(sess, mutation) {
  if (typeof releaseRisuExecutionSession === 'function') releaseRisuExecutionSession(sess);
  if (typeof cancelExpressionClassification === 'function') cancelExpressionClassification();
  if (mutation) mutation.splice(sess.msgs, 0, sess.msgs.length);
  else sess.msgs = [];
  sess.memoryStore = makeEmptyMemoryStore();
  [
    'worldBookRuntime',
    'macroVars',
    'stscriptVars',
    'scriptState',
    'risu',
    'startTriggerDone',
    'openingIndex',
    'quickReply',
    'storyDirection',
    'authorsNote',
    'tavernHelperMetadata',
    'tavernHelperChatLorebook',
    'tavernHelperAudio',
    'expressions',
    'promptInjections',
    'personaId',
    'temporaryUserName',
    'pickRerollSeed',
    'lockedBackground',
    'checkpoint',
  ].forEach(function (key) {
    delete sess[key];
  });
  sess.greetingChosen = true;
}

function stscriptRefreshSessionUi(char, session) {
  function live() {
    return getChar() === char && (!char || getActiveSession(char.id) === session);
  }
  if (!live()) return Promise.resolve(false);
  var prepare =
    char && session && typeof prepareRegexScriptDisplayTexts === 'function'
      ? prepareRegexScriptDisplayTexts(char, session.msgs || [])
      : null;
  return Promise.resolve(prepare)
    .then(function () {
      if (!live()) return;
      if (char && session && typeof stscriptRestorePromptFilters === 'function')
        return stscriptRestorePromptFilters(char, session);
    })
    .then(function () {
      if (!live()) return false;
      closeSessionManager();
      renderCharList();
      renderChat();
      updateChatUI();
      return true;
    });
}
function stscriptReleaseCharacterRuntime(nextId) {
  if (typeof releaseCardScriptWorkersExcept === 'function') releaseCardScriptWorkersExcept(nextId);
  if (typeof invalidateBackgroundThemeRequest === 'function') invalidateBackgroundThemeRequest();
}
async function stscriptSelectCharacter(id) {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('切换角色')) return false;
  var target = D.characters.find(function (row) {
    return row && row.id === id;
  });
  if (!target) return false;
  var previous = D.currentCharId;
  if (D.currentCharId === target.id) return true;
  rememberCurrentChatPosition();
  stscriptReleaseCharacterRuntime(target.id);
  D.currentCharId = target.id;
  if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('stscript-select-character');
  try {
    await saveData('meta', { urgent: true });
  } catch (error) {
    if (D.currentCharId === target.id) D.currentCharId = previous;
    throw error;
  }
  if (typeof applyCharBackground === 'function') await applyCharBackground(target, true);
  if (D.currentCharId !== target.id) return false;
  await stscriptRefreshSessionUi(target, getActiveSession(target.id));
  return true;
}
async function stscriptSwitchSession(id) {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('切换对话')) return false;
  var char = getChar(),
    box = char && getSessions(char.id),
    next = box && findSession(char.id, id);
  if (!next) return false;
  var before = box.activeSid;
  rememberCurrentChatPosition();
  if (before !== next.id && typeof releaseRisuExecutionSession === 'function')
    releaseRisuExecutionSession(getActiveSession(char.id));
  if (before !== next.id && typeof cancelGenerationPostCommit === 'function')
    cancelGenerationPostCommit(
      box.sessions.find(function (session) {
        return session.id === before;
      })
    );
  box.activeSid = next.id;
  try {
    await saveData('sessions', { urgent: true });
  } catch (error) {
    if (box.activeSid === next.id) box.activeSid = before;
    throw error;
  }
  await stscriptRefreshSessionUi(char, next);
  return true;
}
function stscriptOpenSessionManager() {
  if (!getChar()) return false;
  closeChatTools();
  _sessionManagerOpen = true;
  renderSessionManager();
  var panel = $('session-manager-panel');
  if (panel) panel.focus({ preventScroll: true });
  return true;
}
async function stscriptCreateSession(options) {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('新建对话')) return false;
  options = options || {};
  var char = getChar();
  if (!char) throw new Error('当前没有可用角色');
  var box = getSessions(char.id),
    current = getActiveSession(char.id),
    cascade = options.deleteCurrent && current ? chatSessionCascade(box, current.id, true) : null;
  if (cascade) {
    if (!(await confirmChatSessionDeletion(cascade))) return false;
    if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('新建对话')) return false;
    if (getChar() !== char || getActiveSession(char.id) !== current) return false;
  }
  if (cascade && !chatSessionCascadeStillCurrent(box, cascade, true)) return false;
  var mutation = createMutationJournal(),
    session = createBlankSession(String(options.name || '').trim() || nextSessionName(box, '对话 ')),
    ownedData = cascade ? beginOwnedChatDataRemoval(char.id, cascade.ids, cascade.rows) : null;
  mutation.capture(box, ['activeSid'], true);
  if (typeof risuApplyInheritedCardOptions === 'function')
    risuApplyInheritedCardOptions(
      session,
      typeof risuInheritedCardOptions === 'function' ? risuInheritedCardOptions(current) : null
    );
  session.greetingChosen = true;
  var greetings = typeof getGreetings === 'function' ? getGreetings(char) : [],
    greeting = greetings[0] || String(char.first_mes || '');
  if (greeting && typeof appendOpeningGreeting === 'function') {
    appendOpeningGreeting(char, session, greeting, 0);
    if (typeof markCardFrontendChatCreated === 'function') markCardFrontendChatCreated(char, session);
  }
  rememberCurrentChatPosition();
  if (cascade) removeChatSessionCascade(box, cascade, mutation);
  else {
    if (typeof releaseRisuExecutionSession === 'function') releaseRisuExecutionSession(current);
    if (typeof cancelGenerationPostCommit === 'function') cancelGenerationPostCommit(current);
  }
  mutation.splice(box.sessions, box.sessions.length, 0, [session]);
  box.activeSid = session.id;
  mutation.seal();
  try {
    await saveData('sessions', ownedData ? ownedData.saveOptions({ urgent: true }) : { urgent: true });
  } catch (error) {
    mutation.rollback();
    if (ownedData) ownedData.release();
    throw error;
  }
  if (ownedData) ownedData.commit();
  if (cascade && typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, cascade.ids);
  await stscriptRefreshSessionUi(char, session);
  return session;
}
async function stscriptRenameCurrentSession(name) {
  var char = getChar(),
    session = char && getActiveSession(char.id),
    text = String(name || '').trim();
  if (!session) return false;
  if (!text) throw new Error('/renamechat 需要新名称');
  var old = session.name;
  session.name = text;
  try {
    await saveData('sessions');
  } catch (error) {
    if (session.name === text) session.name = old;
    throw error;
  }
  renderSessions();
  return true;
}
async function stscriptDeleteCurrentSession() {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('删除对话')) return false;
  var char = getChar(),
    box = char && getSessions(char.id),
    session = char && getActiveSession(char.id);
  if (!session) return false;
  var cascade = chatSessionCascade(box, session.id, true);
  if (!(await confirmChatSessionDeletion(cascade))) return false;
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('删除对话')) return false;
  if (getChar() !== char || getActiveSession(char.id) !== session) return false;
  if (!chatSessionCascadeStillCurrent(box, cascade, true)) return false;
  var mutation = createMutationJournal(),
    inheritedOptions = typeof risuInheritedCardOptions === 'function' ? risuInheritedCardOptions(session) : null,
    ownedData = beginOwnedChatDataRemoval(char.id, cascade.ids, cascade.rows);
  mutation.capture(box, ['activeSid'], true);
  removeChatSessionCascade(box, cascade, mutation);
  if (!box.sessions.length) {
    var replacement = createBlankSession('对话 1');
    if (typeof risuApplyInheritedCardOptions === 'function')
      risuApplyInheritedCardOptions(replacement, inheritedOptions);
    mutation.splice(box.sessions, 0, 0, [replacement]);
  }
  box.activeSid = box.sessions[0].id;
  mutation.seal();
  try {
    await saveData('sessions', ownedData.saveOptions({ urgent: true }));
  } catch (error) {
    mutation.rollback();
    ownedData.release();
    throw error;
  }
  ownedData.commit();
  if (typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, cascade.ids);
  await stscriptRefreshSessionUi(char, getActiveSession(char.id));
  return true;
}
async function stscriptCloseCurrentChat() {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('关闭对话')) return false;
  rememberCurrentChatPosition();
  var previous = D.currentCharId;
  if (!previous) return false;
  stscriptReleaseCharacterRuntime(null);
  D.currentCharId = null;
  try {
    await saveData('meta', { urgent: true });
  } catch (error) {
    if (D.currentCharId === null) D.currentCharId = previous;
    throw error;
  }
  if (D.currentCharId !== null) return false;
  if (typeof applyCharBackground === 'function') await applyCharBackground(null, false);
  await stscriptRefreshSessionUi(null, null);
  return true;
}
async function stscriptReloadCurrentChat() {
  var char = getChar(),
    session = char && getActiveSession(char.id);
  if (!session) return false;
  await stscriptRefreshSessionUi(char, session);
  return true;
}
async function clearChat(sessionId) {
  if (blockDuringGeneration('清空对话')) return;
  const char = getChar();
  if (!char) return;
  const box = getSessions(char.id),
    sess = sessionId
      ? box.sessions.find(function (row) {
          return row.id === sessionId;
        })
      : getActiveSession(char.id);
  if (!sess) return;
  const cascade = chatSessionCascade(box, sess.id, false),
    descendants = cascade.descendants,
    parent =
      sess.parentSessionId &&
      box.sessions.find(function (row) {
        return row.id === sess.parentSessionId;
      }),
    lines = [`清空与「${canonicalCharacterName(char)}」当前对话的所有记录？`];
  if (descendants.length)
    lines.push(
      '同时删除 ' +
        descendants.length +
        ' 条后代支线：\n' +
        descendants
          .map(function (row) {
            return '• ' + row.name;
          })
          .join('\n')
    );
  if (parent) lines.push('当前对话会解除与「' + parent.name + '」的支线关系，变成普通对话。');
  if (!(await appConfirm(lines.join('\n\n'), '清空对话', descendants.length ? '清空并删除支线' : '清空'))) return;
  function current() {
    return (
      getChar() === char &&
      box.sessions.includes(sess) &&
      (sessionId || getActiveSession(char.id) === sess) &&
      chatSessionCascadeStillCurrent(box, cascade, false)
    );
  }
  if (!current()) return;
  // The card options of the conversation being cleared drive both the preview and what it keeps,
  // so an emptied conversation opens on the same scene the picker showed.
  var inheritedOptions = typeof risuInheritedCardOptions === 'function' ? risuInheritedCardOptions(sess) : null;
  var greet = await chooseGreeting(char, {}, sess);
  if (greet === null || !current()) return;
  if (typeof qrStopAndAwait === 'function') await qrStopAndAwait();
  else if (typeof stopStscriptRun === 'function') stopStscriptRun();
  if (!current()) return;
  // Like switching or deleting a conversation, clearing it retires its pending post-reply work (memory
  // summary and its review), which would otherwise report on messages that are gone.
  if (typeof cancelGenerationPostCommit === 'function') cancelGenerationPostCommit(sess);
  var mutation = createMutationJournal(),
    removedIds = cascade.ids,
    ownedData = beginOwnedChatDataRemoval(char.id, [sess.id].concat(removedIds), cascade.rows),
    generatedBranchName = parent && branchSessionUsesGeneratedName(sess, parent);
  mutation.capture(sess, undefined, true);
  mutation.capture(box, ['activeSid'], true);
  try {
    if (parent && generatedBranchName) sess.name = nextSessionName(box, '对话 ');
    if (parent) {
      (parent.msgs || []).forEach(function (message) {
        if (message.checkpointSessionId !== sess.id) return;
        mutation.capture(message, ['checkpointSessionId', 'checkpointName'], true);
        delete message.checkpointSessionId;
        delete message.checkpointName;
      });
      detachSessionFromBranch(sess);
    }
    removeChatSessionCascade(box, cascade, mutation);
    if (removedIds.includes(box.activeSid)) box.activeSid = sess.id;
    resetClearedSession(sess, mutation);
    if (typeof risuApplyInheritedCardOptions === 'function') risuApplyInheritedCardOptions(sess, inheritedOptions);
    var clearedGreeting = typeof greet === 'object' ? greet.text : greet,
      openingIndex = typeof greet === 'object' ? greet.index : null;
    if (clearedGreeting) appendOpeningGreeting(char, sess, clearedGreeting, openingIndex, mutation);
    if (typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, removedIds.concat([sess.id]));
    await refreshMessageMutation(char, sess, mutation);
    await saveData('sessions', ownedData.saveOptions({ urgent: true }));
  } catch (error) {
    mutation.rollback();
    ownedData.release();
    if (typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, [sess.id]);
    if (typeof invalidateCardScriptStack === 'function') invalidateCardScriptStack(getChar());
    renderCharList();
    renderPersonaList();
    renderWBAll();
    renderWBSidebar();
    renderChat();
    updateChatUI();
    toast('清空保存失败，原对话和全部支线已恢复：' + error.message, 'err');
    return;
  }
  ownedData.commit();
  if (typeof hostPromptReleaseSession === 'function') hostPromptReleaseSession(sess);
  [sess.id].concat(removedIds).forEach(function (id) {
    delete _historyLoadedBySession[id];
  });
  if (getChar() && getChar().id === char.id && getActiveSession(char.id) === sess) {
    tavernAudioClearRuntime('bgm');
    tavernAudioClearRuntime('ambient');
    renderChat();
    updateChatUI();
    updateTokensBar(char);
    scrollChatToBottomAfterRender();
    if (clearedGreeting) queueOpeningMediaHydration(char, Number.isInteger(openingIndex) ? openingIndex : 0);
  }
  toast(descendants.length ? '对话已清空，' + descendants.length + ' 条后代支线已删除' : '对话已清空', 'info');
}
