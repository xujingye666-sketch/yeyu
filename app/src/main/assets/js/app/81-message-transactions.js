// ===== Formal message transactions =====
var _editMessageScriptRun = null,
  _editMessageTarget = null;
function messageTransactionTarget(index) {
  var char = getChar(),
    session = char && getActiveSession(char.id),
    message = session && session.msgs[index];
  return message
    ? { char: char, session: session, message: message, content: message.content, role: message.role }
    : null;
}
function messageTransactionTargetIndex(target) {
  if (!target || D.currentCharId !== target.char.id || getActiveSession(target.char.id) !== target.session) return -1;
  if (target.message.content !== target.content || target.message.role !== target.role) return -1;
  return target.session.msgs.indexOf(target.message);
}
function createMutationJournal() {
  var records = [],
    seen = new Map(),
    removedItems = new Set(),
    pendingInsertions = [],
    undo = [];
  function unchangedGuard(value) {
    var pending = [value],
      saved = new Map();
    while (pending.length) {
      var current = pending.pop();
      if (!current || typeof current !== 'object' || saved.has(current)) continue;
      var keys = Object.keys(current),
        values = keys.map(function (key) {
          return current[key];
        });
      saved.set(current, { keys: keys, values: values, length: Array.isArray(current) ? current.length : null });
      values.forEach(function (item) {
        pending.push(item);
      });
    }
    return function () {
      for (var pair of saved) {
        var object = pair[0],
          record = pair[1];
        if (
          Object.keys(object).length !== record.keys.length ||
          (record.length !== null && object.length !== record.length)
        )
          return false;
        if (
          !record.keys.every(function (key, index) {
            return Object.prototype.hasOwnProperty.call(object, key) && object[key] === record.values[index];
          })
        )
          return false;
      }
      return true;
    };
  }
  // One record per object: a later capture of the same object adds the fields it names, and every
  // field keeps the value it had when first captured, so callers need not coordinate their order.
  function capture(value, fields, shallow) {
    if (!value || typeof value !== 'object') return;
    var record = seen.get(value);
    if (Array.isArray(value)) {
      if (record) return;
      record = { value: value, items: value.slice() };
      seen.set(value, record);
      records.push(record);
      value.forEach(function (item) {
        capture(item);
      });
      return;
    }
    if (!record) {
      record = { value: value, fields: fields ? [] : undefined, before: new Map() };
      seen.set(value, record);
      records.push(record);
    } else if (!fields) record.fields = undefined;
    (fields || Object.keys(value)).forEach(function (key) {
      if (!record.before.has(key)) {
        record.before.set(key, { present: Object.prototype.hasOwnProperty.call(value, key), value: value[key] });
        if (record.fields) record.fields.push(key);
      }
      if (!shallow) capture(value[key]);
    });
  }
  function seal() {
    pendingInsertions.forEach(function (entry) {
      entry.unchanged = unchangedGuard(entry.row);
    });
    pendingInsertions = [];
    records.forEach(function (record) {
      if (record.items) {
        var written = record.value.slice(),
          before = record.items;
        if (
          written.length === before.length &&
          written.every(function (item, index) {
            return item === before[index];
          })
        )
          return;
        undo.push(function () {
          // A later append belongs to its caller and must survive this failed operation.
          if (
            record.value.length < written.length ||
            !written.every(function (item, index) {
              return record.value[index] === item;
            })
          )
            return;
          var tail = record.value.slice(written.length);
          record.value.length = 0;
          before.forEach(function (item) {
            record.value.push(item);
          });
          tail.forEach(function (item) {
            record.value.push(item);
          });
        });
        return;
      }
      var keys = new Set(record.fields || Object.keys(record.value));
      record.before.forEach(function (_, key) {
        keys.add(key);
      });
      keys.forEach(function (key) {
        var before = record.before.get(key) || { present: false },
          present = Object.prototype.hasOwnProperty.call(record.value, key),
          written = record.value[key];
        if (before.present === present && before.value === written) return;
        var unchanged = unchangedGuard(written),
          unchangedWritten = false;
        var restore = function () {
          if (
            Object.prototype.hasOwnProperty.call(record.value, key) !== present ||
            record.value[key] !== written ||
            !unchangedWritten
          )
            return;
          if (before.present)
            Object.defineProperty(record.value, key, {
              value: before.value,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          else delete record.value[key];
        };
        restore.prepare = function () {
          unchangedWritten = unchanged();
        };
        undo.push(restore);
      });
    });
    records = [];
    seen.clear();
  }
  return {
    replaceRecord: function replaceRecord(target, next) {
      capture(target, undefined, true);
      Object.keys(target).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) delete target[key];
      });
      Object.keys(next).forEach(function (key) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
        var before = target[key],
          value = next[key];
        if (before === value) return;
        if (
          Object.prototype.toString.call(before) === '[object Object]' &&
          Object.prototype.toString.call(value) === '[object Object]'
        ) {
          replaceRecord(before, value);
        } else if (
          !(
            Array.isArray(before) &&
            Array.isArray(value) &&
            before.length === value.length &&
            before.every(function (item, index) {
              return item === value[index];
            })
          )
        ) {
          target[key] = value;
        }
      });
      return target;
    },
    capture: capture,
    seal: seal,
    splice: function (array, index, count, inserted) {
      inserted = inserted || [];
      var previous = array[index - 1],
        next = array[index + count],
        removed = array.splice(index, count);
      removed.forEach(function (row) {
        removedItems.add(row);
      });
      var insertions = inserted.map(function (row) {
        var entry = { row: row, moved: removedItems.has(row) };
        if (!entry.moved) pendingInsertions.push(entry);
        return entry;
      });
      inserted.forEach(function (row, offset) {
        array.splice(index + offset, 0, row);
      });
      var restore = function () {
        insertions.forEach(function (entry) {
          // Later stages of this same operation may have changed the inserted object.
          // They have now been undone; an exact original snapshot is also safe to remove.
          if (!entry.moved && !entry.unchangedWritten && !entry.unchanged()) return;
          var at = array.indexOf(entry.row);
          if (at >= 0) array.splice(at, 1);
        });
        var after = array.indexOf(next),
          before = array.indexOf(previous),
          at = after >= 0 ? after : before >= 0 ? before + 1 : Math.min(index, array.length);
        removed.forEach(function (row) {
          var existing = array.indexOf(row);
          if (existing >= 0) at = existing + 1;
          else array.splice(at++, 0, row);
        });
      };
      restore.prepare = function () {
        insertions.forEach(function (entry) {
          entry.unchangedWritten = entry.moved || entry.unchanged();
        });
      };
      undo.push(restore);
      return removed;
    },
    rollback: function () {
      seal();
      undo.forEach(function (restore) {
        if (restore.prepare) restore.prepare();
      });
      for (var i = undo.length - 1; i >= 0; i--) undo[i]();
      undo = [];
      removedItems.clear();
    },
  };
}
function beginMessageMutation(char, session, message, extraSessionFields) {
  var journal = createMutationJournal(),
    parent =
      session.parentSessionId &&
      D.chats[char.id].sessions.find(function (row) {
        return row.id === session.parentSessionId;
      });
  journal.capture(message);
  journal.capture(
    session,
    ['memoryStore', 'lastMergedSeq', 'lastMergeParentStateHash', 'openingIndex'].concat(extraSessionFields || [])
  );
  if (parent) {
    journal.capture(parent, ['memoryStore']);
    parent.msgs.forEach(function (row) {
      if (row.originBranchSessionId === session.id) journal.capture(row, ['reverted', 'excludeFromMemory']);
    });
  }
  if (message && message.opening === true) journal.capture(char, ['media_assets']);
  return journal;
}
async function refreshMessageMutation(char, session, journal) {
  journal.seal();
  if (mvuCanRun(char)) {
    await refreshMvuAfterMutation(char, session, { mutation: journal });
  }
  refreshCardScriptLibraryContext(char, session);
}
function setEditMessageSaveState(state) {
  var applying = state === 'applying',
    busy = applying || state === 'saving',
    save = $('edit-msg-save'),
    label = $('edit-msg-save-label'),
    stop = $('edit-msg-stop'),
    cancel = $('edit-msg-cancel'),
    close = $('edit-msg-close'),
    content = $('edit-msg-content');
  if (save) save.disabled = busy;
  if (label) label.textContent = applying ? '正在应用脚本' : state === 'saving' ? '正在保存' : '保存';
  if (stop) stop.hidden = !applying;
  if (cancel) cancel.disabled = busy;
  if (close) close.disabled = busy;
  if (content) content.readOnly = busy;
}
function editMessage(idx) {
  if (modalSaveInFlight('edit-msg-modal')) return;
  if (blockDuringGenerationOrPostCommit('编辑消息', getActiveSession(D.currentCharId))) return;
  const msgs = getMsgs(D.currentCharId);
  if (idx < 0 || idx >= msgs.length) return;
  if (isBranchReturnMessage(msgs[idx]) || isBranchReturnRevertMessage(msgs[idx])) {
    toast('这条消息是支线带回的记录，不能直接编辑；如需修改请先撤销本次回归', 'info');
    return;
  }
  $('edit-msg-idx').value = idx;
  _editMessageTarget = messageTransactionTarget(idx);
  $('edit-msg-content').value = msgs[idx].content;
  setEditMessageSaveState('idle');
  openModal('edit-msg-modal');
}

function stopEditMessageScript() {
  var run = _editMessageScriptRun;
  if (!run || run.stopped) return false;
  run.stopped = true;
  var stopped = terminateScriptWorker(cardRegexWorkerName(run.char));
  if (stopped) toast('正在停止脚本，消息原文不会改变', 'info');
  return stopped;
}
function saveEditMessage() {
  return runModalSave('edit-msg-modal', commitEditMessage);
}
async function commitEditMessage() {
  var target = _editMessageTarget;
  try {
    if (!(await appConfirm('确定保存对这条消息的修改？这会改变后续上下文。', '保存消息修改', '保存'))) return false;
    if (blockDuringGenerationOrPostCommit('编辑消息', getActiveSession(D.currentCharId))) return false;
    var idx = messageTransactionTargetIndex(target);
    if (idx < 0) {
      toast('消息或对话已变化，请重新打开编辑', 'info');
      return false;
    }
    var charId = target.char.id,
      msgs = target.session.msgs;
    if (isBranchReturnMessage(msgs[idx]) || isBranchReturnRevertMessage(msgs[idx])) {
      toast('支线带回的记录不能直接编辑', 'info');
      return false;
    }
    var message = msgs[idx],
      char = target.char,
      role = message.role,
      edited = $('edit-msg-content').value;
    if (!edited.trim()) {
      toast('消息内容不能为空，原消息没有改变', 'err');
      return false;
    }

    // ST runOnEdit is evaluated before the transaction mutates its one allowed target.
    // Any worker failure or manual termination therefore leaves both the stored message and
    // the text in the editor untouched for correction or retry.
    var editCount = regexScriptEditCount(char, role);
    if (editCount > 0) {
      var run = { char: char, stopped: false };
      _editMessageScriptRun = run;
      setEditMessageSaveState('applying');
      try {
        edited = await applyRegexScriptsForEdit(edited, role, char);
      } catch (error) {
        if (run.stopped || String((error && error.message) || error).indexOf('脚本已被停止') >= 0)
          toast('脚本已停止，编辑内容和原消息均已保留', 'info');
        else toast('编辑脚本运行失败，原消息没有改变：' + String((error && error.message) || error), 'err');
        return false;
      } finally {
        _editMessageScriptRun = null;
      }
    }

    idx = messageTransactionTargetIndex(target);
    if (idx < 0) {
      toast('消息或对话已变化，编辑内容已保留', 'info');
      return false;
    }
    if (blockDuringGenerationOrPostCommit('编辑消息', target.session)) return false;
    setEditMessageSaveState('saving');
    var sess = target.session,
      mutation = beginMessageMutation(char, sess, message),
      changedSeq = Number(message.seq) || 0,
      openingMedia = { assets: [], changed: false };
    try {
      if (role === 'user') message.content = edited;
      else {
        // 编辑只清掉当前候选的思考；旧数据先落成分格，别把属于其他候选的消息级思考当成当前候选的删掉。
        messageSwipeAdoptReasoning(message);
        invalidateMessageImageCandidate(message, messageSwipeState(message).active);
        message.content = edited;
        delete message.reasoning;
        delete message.generationMeta;
        delete message.original_content;
        delete message.translated;
        delete message.restored;
        delete message.continueBase;
      }
      if (role === 'assistant') {
        messageSwipeNormalize(message);
        syncMvuMessageActiveSwipe(message);
        if (message.opening === true) openingMedia = registerEditedOpeningMediaAssets(char, message);
      }
      message.edited = true;
      if (changedSeq) rollbackMemoryDependencies(charId, sess, changedSeq);
      invalidateCacheContexts(charId, idx, true, sess.id);
      await refreshMessageMutation(char, sess, mutation);
      await saveData(openingMedia.changed ? ['sessions', 'characters'] : 'sessions');
    } catch (error) {
      mutation.rollback();
      clearMvuSessionRuntime(charId, sess.id);
      toast('消息保存失败，原消息已恢复：' + error.message, 'err');
      return false;
    }
    await markStreamDraftsStaleForSession(charId, sess.id, 'base_changed');
    closeModal('edit-msg-modal');
    // As in messageEditDone of ST, MESSAGE_EDITED listeners run before the redraw, so a rewrite they
    // make is what the reader sees; MESSAGE_UPDATED follows the redraw.
    await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_EDITED, [idx]);
    renderChat();
    openingMedia.assets.forEach(function (asset) {
      queueOpeningMediaHydration(char, Number.isInteger(Number(asset.greetingIndex)) ? Number(asset.greetingIndex) : 0);
    });
    await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_UPDATED, [idx]);
    toast('消息已更新', 'ok');
    return true;
  } finally {
    _editMessageScriptRun = null;
    setEditMessageSaveState('idle');
  }
}

// 界面上能左右切换的普通回复才提供「删除当前候选」，与候选切换控件的显示条件一致；开场白的候选来自角色卡，只能整条删除。
function messageDeletableSwipeCount(message) {
  return message && message.role === 'assistant' && message.opening !== true
    ? messageSwipeState(message).swipes.length
    : 0;
}
async function deleteMessage(idx) {
  if (blockDuringGenerationOrPostCommit('删除消息', getActiveSession(D.currentCharId))) return;
  const msgs = getMsgs(D.currentCharId);
  if (idx < 0 || idx >= msgs.length) return;
  if (isBranchReturnMessage(msgs[idx]) || isBranchReturnRevertMessage(msgs[idx])) {
    toast('这条消息是支线带回的记录，请使用“撤销本次回归”', 'info');
    return;
  }
  var target = messageTransactionTarget(idx),
    candidates = messageDeletableSwipeCount(target.message),
    activeSwipe = target.message.swipeId,
    choice =
      candidates > 1
        ? await appChooseAction(
            '这条回复有 ' +
              candidates +
              ' 个候选。删除当前候选只移除正在显示的这一个；删除整条消息会移除全部候选，并改变上下文。',
            '删除消息',
            '删除当前候选',
            '删除整条消息'
          )
        : (await appConfirm('确定删除这条消息？该操作会改变上下文。', '删除消息', '删除'))
          ? 'alternative'
          : null;
  if (!choice) return;
  idx = messageTransactionTargetIndex(target);
  if (idx < 0 || (choice === 'primary' && target.message.swipeId !== activeSwipe)) {
    toast('消息或对话已变化，请重新选择要删除的消息', 'info');
    return;
  }
  if (choice === 'primary') {
    try {
      await deleteMessageSwipeCandidate(activeSwipe, { messageIndex: idx });
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }
  if (blockDuringGenerationOrPostCommit('删除消息', getActiveSession(D.currentCharId))) return;
  var charId = target.char.id,
    sess = target.session,
    mutation = beginMessageMutation(target.char, sess, target.message),
    nextMessage = sess.msgs[idx + 1],
    previousMessage = sess.msgs[idx - 1],
    changedSeq = Number(target.message.seq) || 0;
  try {
    if (changedSeq) rollbackMemoryDependencies(charId, sess, changedSeq);
    sess.msgs.splice(idx, 1);
    invalidateCacheContexts(charId, idx, true, sess.id);
    await refreshMessageMutation(target.char, sess, mutation);
    await saveData('sessions');
  } catch (error) {
    mutation.rollback();
    if (!sess.msgs.includes(target.message)) {
      var nextIndex = sess.msgs.indexOf(nextMessage),
        previousIndex = sess.msgs.indexOf(previousMessage);
      sess.msgs.splice(
        nextIndex >= 0 ? nextIndex : previousIndex >= 0 ? previousIndex + 1 : Math.min(idx, sess.msgs.length),
        0,
        target.message
      );
    }
    clearMvuSessionRuntime(charId, sess.id);
    toast('消息删除保存失败，原消息已恢复：' + error.message, 'err');
    return;
  }
  await markStreamDraftsStaleForSession(charId, sess.id, 'base_changed');
  // renderChat captures the current DOM immediately before reconciliation; seq
  // identifies the remaining message even after indexes shift during the save.
  renderChat();
  updateTokensBar(getChar());
  await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_DELETED, [sess.msgs.length]);
}

async function switchOpeningGreeting(idx, step, options) {
  options = options || {};
  var char = getChar(),
    sess = char && getActiveSession(char.id);
  var msg = sess && sess.msgs && sess.msgs[idx];
  if (!char || !sess || !msg || msg.role !== 'assistant' || msg.opening !== true) return false;
  // Everything up to the guard only reads. An opening whose candidates were never materialised would
  // otherwise be rewritten — including an edited body falling back to greeting 0 — and a refusal
  // would leave that rewrite in memory for the next saveData to persist.
  var activeId = msg.swipeId == null && Number.isInteger(msg.openingIndex) ? msg.openingIndex : msg.swipeId;
  // Once the session holds its own candidate set it wins: rebuilding from the card greetings here
  // would throw away an edited opening. Greetings added to or removed from the card afterwards are
  // deliberately not merged back, so the message keeps exactly the candidates the session edited.
  var existing =
      Array.isArray(msg.swipes) && msg.swipes.length
        ? messageSwipeState({ content: msg.content, swipes: msg.swipes, swipeId: activeId })
        : null,
    model = existing
      ? { candidates: existing.swipes, index: existing.active }
      : openingMessageCandidateModel(char, msg, activeId, msg.content),
    requested = options && Number(options.targetIndex),
    next = Number.isFinite(requested) ? Math.floor(requested) : model.index + (Number(step) < 0 ? -1 : 1);
  if (next < 0 && options.wrapLeft === true && model.candidates.length > 1) next = model.candidates.length - 1;
  if (next < 0 || next >= model.candidates.length) return false;
  // After the validity checks, so an out-of-range step or a message without candidates stays silent
  // instead of blaming the background task for a call that would have done nothing anyway.
  if (blockDuringGenerationOrPostCommit('切换开场白', sess, options)) return false;
  var target = messageTransactionTarget(idx);
  // The next index points into the session candidate set while opening media assets index the card
  // greeting list; hydrate the card greeting carrying the same text, and fall back to the same
  // position when the text no longer matches, because a card-side rewrite (本地化、翻译) makes every
  // candidate miss and would otherwise leave the opening media unhydrated forever.
  var cardGreetings = getGreetings(char),
    matchedIndex = cardGreetings.indexOf(String(model.candidates[next] == null ? '' : model.candidates[next])),
    hydrateIndex = matchedIndex >= 0 ? matchedIndex : next < cardGreetings.length ? next : -1;
  if (hydrateIndex >= 0) await queueOpeningMediaHydration(char, hydrateIndex);
  idx = messageTransactionTargetIndex(target);
  if (idx < 0 || blockDuringGenerationOrPostCommit('切换开场白', sess, options)) return false;
  var before = beginMessageMutation(char, sess, msg),
    changedSeq = Number(msg.seq) || 0;
  try {
    if (activeId != null) msg.swipeId = activeId;
    messageRevertTranslation(msg);
    if (existing) {
      messageSwipeSetActive(msg, next);
      msg.openingIndex = next;
      sess.openingIndex = next;
    } else setOpeningMessageCandidate(char, sess, msg, next, model.candidates[next]);
    if (changedSeq) rollbackMemoryDependencies(char.id, sess, changedSeq);
    invalidateCacheContexts(char.id, idx, true, sess.id);
    await refreshMessageMutation(char, sess, before);
    try {
      await prepareRegexScriptTexts(char, [
        {
          role: 'assistant',
          phase: 'display',
          depth: Math.max(0, sess.msgs.length - 1 - idx),
          index: idx,
          message: msg,
          text: String(msg.content || ''),
        },
      ]);
    } catch (_) {}
    await saveData('sessions', { urgent: true });
  } catch (error) {
    before.rollback();
    clearMvuSessionRuntime(char.id, sess.id);
    toast('开场白切换保存失败，原选择已恢复：' + error.message, 'err');
    return false;
  }
  await markStreamDraftsStaleForSession(char.id, sess.id, 'base_changed');
  renderChat();
  updateTokensBar(char);
  await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPED, [idx]);
  return true;
}

// 「末尾回复」的下标：跳过末尾的 /imagine 系统图片消息，让重新生成、续写（含 /regen、/continue 与 TavernHelper
// 的同名生成入口）和界面右滑新候选仍作用于它前面的回复。ST 重新生成会删掉末尾这条，属有意差异；
// 楼号宏、/swipes-*、TavernHelper 的消息下标与其 swipe 生成仍按真实末尾计。
function replyTailIndex(msgs) {
  var index = (msgs || []).length - 1;
  while (index > 0 && isGeneratedImageMessage(msgs[index])) index--;
  return index;
}
function messageSwipeState(message) {
  var current = String((message && message.content) || ''),
    swipes = Array.isArray(message && message.swipes) && message.swipes.length ? message.swipes.map(String) : [current],
    active = Math.max(0, Math.min(swipes.length - 1, Math.floor(Number(message && message.swipeId) || 0)));
  swipes[active] = current;
  return { swipes: swipes, active: active };
}
function messageSwipeNormalize(message) {
  var model = messageSwipeState(message);
  message.swipes = model.swipes;
  message.swipeId = model.active;
  return model;
}
// 翻译只把译文写进 content 和活动候选，原文只留在 original_content。
function messageUntranslatedContent(message) {
  return typeof (message && message.original_content) === 'string'
    ? message.original_content
    : String((message && message.content) || '');
}
// 切走、删除或改写活动候选前先把它换回原文再丢弃翻译标记，否则被留下的候选只剩译文。
function messageRevertTranslation(message) {
  if (!message || typeof message.original_content !== 'string') return false;
  message.content = message.original_content;
  if (Array.isArray(message.swipes) && message.swipes.length) messageSwipeNormalize(message);
  delete message.original_content;
  delete message.translated;
  delete message.restored;
  return true;
}
// 活动候选号（0 起），候选级分格数组的格数，以及把分格数组补空到该格数。
function messageActiveSwipeIndex(message) {
  return Math.max(0, Math.floor(Number(message.swipeId) || 0));
}
function messageSwipeCount(message) {
  return Array.isArray(message.swipes) ? message.swipes.length : 1;
}
function swipeSlotsFill(slots, count) {
  while (slots.length < count) slots.push(null);
  return slots;
}
// 候选级生成元数据：活动候选的在 generationMeta，其余候选各自的在 swipeGenerationMeta[候选号]
// （活动候选那一格留空）。与 swipeReasoning 一样，消息一经候选增删或切换就带上这个数组；没有它的消息只有
// 消息级一份，归属按 messageLegacySwipeOwner。改变活动候选前先 stash、改完再 restore，未完成标记就跟着候选走。
function messageSwipeAdoptGenerationMeta(message) {
  messageSwipeAdoptLegacy(message);
  return message.swipeGenerationMeta;
}
function messageSwipeStashGenerationMeta(message) {
  messageSwipeAdoptGenerationMeta(message)[messageActiveSwipeIndex(message)] = message.generationMeta || null;
  delete message.generationMeta;
}
function messageSwipeRestoreGenerationMeta(message) {
  var slots = messageSwipeAdoptGenerationMeta(message),
    active = messageActiveSwipeIndex(message);
  swipeSlotsFill(slots, messageSwipeCount(message));
  if (slots[active]) message.generationMeta = slots[active];
  else delete message.generationMeta;
  slots[active] = null;
}
// 候选级思考：活动候选的思考在消息级 reasoning / reasoningMs / reasoningCollapsed，其余候选各自的放在
// swipeReasoning[候选号]（只含这三个字段的对象，没有思考为 null；活动候选那一格留空）。与 swipeGenerationMeta
// 一样在改变活动候选前后互换，所以 /reasoning-*、编辑、续写、宿主写接口这些按消息级读写的入口天然作用于当前候选。
// 消息一经候选增删或切换就带上这个数组；只有一个候选、从没动过候选的消息不需要它。
function messageReasoningTake(message) {
  var slot = null;
  ['reasoning', 'reasoningMs', 'reasoningCollapsed'].forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(message, key)) return;
    (slot = slot || {})[key] = message[key];
    delete message[key];
  });
  return slot;
}
function messageReasoningPut(message, slot) {
  ['reasoning', 'reasoningMs', 'reasoningCollapsed'].forEach(function (key) {
    if (slot && Object.prototype.hasOwnProperty.call(slot, key)) message[key] = slot[key];
    else delete message[key];
  });
}
// 旧数据（多个候选、没有 swipeReasoning / swipeGenerationMeta）只有一份消息级思考和生成元数据，它们属于最后一次
// 生成提交的候选：此前每次重新生成、右滑生成新候选都把新候选追加到末尾并整体覆盖这些消息级字段，切换、删除候选
// 都不动它们。所以默认归末尾候选。末尾候选有证据表明不是生成提交追加的——隐藏追加的草稿候选在
// swipeGenerationMeta 留着元数据、/addswipe 在 tavernHelperSwipeInfo 记为 manual / slash command——真正的归属
// 已无法判断，按当前候选处理。开场白的候选来自角色卡，不是生成的，同样按当前候选。
function messageLegacySwipeOwner(message) {
  var model = messageSwipeState(message),
    last = model.swipes.length - 1;
  if (message.opening === true || last === model.active) return model.active;
  var hiddenMeta = Array.isArray(message.swipeGenerationMeta) && message.swipeGenerationMeta[last],
    info = Array.isArray(message.tavernHelperSwipeInfo) && message.tavernHelperSwipeInfo[last],
    manual = !!(info && info.api === 'manual' && info.model === 'slash command');
  return hiddenMeta || manual ? model.active : last;
}
// 只读：消息级的候选字段是否属于当前候选——slotsKey 是它的分格数组（swipeReasoning / swipeGenerationMeta）。
// 显示、/reasoning-get 和「是否未完成」这类读取用它，旧数据不必先落成分格。
function messageOwnsSwipeField(message, slotsKey) {
  if (!message || Array.isArray(message[slotsKey])) return true;
  if (!Array.isArray(message.swipes) || message.swipes.length < 2) return true;
  return messageLegacySwipeOwner(message) === messageSwipeState(message).active;
}
// 当前候选自己的生成元数据；属于别的候选的旧数据消息级元数据按没有处理。
function messageActiveGenerationMeta(message) {
  return message && messageOwnsSwipeField(message, 'swipeGenerationMeta') ? message.generationMeta || null : null;
}
// 旧数据首次被改动时按上面的规则把思考和生成元数据一起落成分格，已有的分格不动。归属只判定一次：先落成的
// 元数据分格会被当成「隐藏追加」的证据，分开判定会让两者归到不同候选。候选增删和改写消息级思考之前都先调它，
// 否则新追加的候选会被当成「最后生成的候选」、当前候选的改动会写到别的候选的字段上。
function messageSwipeAdoptLegacy(message) {
  var adoptMeta = !Array.isArray(message.swipeGenerationMeta),
    adoptReasoning = !Array.isArray(message.swipeReasoning);
  if (!adoptMeta && !adoptReasoning) return;
  var model = messageSwipeState(message),
    owner = model.swipes.length > 1 ? messageLegacySwipeOwner(message) : model.active,
    blank = function () {
      return model.swipes.map(function () {
        return null;
      });
    };
  if (adoptMeta) {
    message.swipeGenerationMeta = blank();
    if (owner !== model.active) {
      message.swipeGenerationMeta[owner] = message.generationMeta || null;
      delete message.generationMeta;
    }
  }
  if (adoptReasoning) {
    message.swipeReasoning = blank();
    if (owner !== model.active) message.swipeReasoning[owner] = messageReasoningTake(message);
  }
}
function messageSwipeAdoptReasoning(message) {
  if (message) messageSwipeAdoptLegacy(message);
  return message && message.swipeReasoning;
}
function messageSwipeStashReasoning(message) {
  var slots = messageSwipeAdoptReasoning(message);
  slots[messageActiveSwipeIndex(message)] = messageReasoningTake(message);
}
function messageSwipeRestoreReasoning(message) {
  var slots = messageSwipeAdoptReasoning(message),
    active = messageActiveSwipeIndex(message);
  swipeSlotsFill(slots, messageSwipeCount(message));
  messageReasoningPut(message, slots[active]);
  slots[active] = null;
}
// 候选级图片（夜欲生图，条目形状见 86-image-generation.js）：活动候选的在 message.images，其余候选各自的在
// swipeImages[候选号]（没有图为 null，活动候选那一格留空）。图片总是加在当时的活动候选上，所以没有分格数组时
// 消息级图片就属于当前候选，不走 messageLegacySwipeOwner 的旧数据推断；消息有过图片才带上这个数组。
function messageSwipeStashImages(message) {
  var images = Array.isArray(message.images) && message.images.length ? message.images : null;
  if (images || Array.isArray(message.swipeImages)) {
    if (!Array.isArray(message.swipeImages)) message.swipeImages = [];
    var active = messageActiveSwipeIndex(message);
    swipeSlotsFill(message.swipeImages, active);
    message.swipeImages[active] = images;
  }
  delete message.images;
}
function messageSwipeRestoreImages(message) {
  var slots = message.swipeImages;
  if (!Array.isArray(slots)) return;
  var active = messageActiveSwipeIndex(message);
  swipeSlotsFill(slots, messageSwipeCount(message));
  if (Array.isArray(slots[active]) && slots[active].length) message.images = slots[active];
  else delete message.images;
  slots[active] = null;
}
function messageCandidateImages(message, swipe) {
  var list =
    swipe === messageSwipeState(message).active
      ? message.images
      : Array.isArray(message.swipeImages)
        ? message.swipeImages[swipe]
        : null;
  return Array.isArray(list) ? list : [];
}
function setMessageCandidateImages(message, swipe, list) {
  if (swipe === messageSwipeState(message).active) {
    if (list.length) message.images = list;
    else delete message.images;
    return;
  }
  if (!Array.isArray(message.swipeImages)) message.swipeImages = [];
  swipeSlotsFill(message.swipeImages, swipe);
  message.swipeImages[swipe] = list.length ? list : null;
}
// 改变活动候选前后的统一入口：候选级生成元数据、思考和图片一起换出、换入。
function messageSwipeStashActive(message) {
  messageSwipeStashGenerationMeta(message);
  messageSwipeStashReasoning(message);
  messageSwipeStashImages(message);
}
function messageSwipeRestoreActive(message) {
  messageSwipeRestoreGenerationMeta(message);
  messageSwipeRestoreReasoning(message);
  messageSwipeRestoreImages(message);
}
// 把正文存成回复的新候选但不切过去：显示内容、活动候选及其元数据都不动，generationMeta 和思考只记在新候选上。
function messageSwipeAppendHidden(message, text, generationMeta, reasoning) {
  var index = messageSwipeNormalize(message).swipes.length,
    reasoningSlots = messageSwipeAdoptReasoning(message),
    metaSlots = messageSwipeAdoptGenerationMeta(message);
  message.swipes.push(String(text == null ? '' : text));
  if (Array.isArray(message.tavernHelperSwipeInfo))
    message.tavernHelperSwipeInfo[index] = hostWriteMessageExtra(message, null);
  swipeSlotsFill(metaSlots, index)[index] = generationMeta || null;
  swipeSlotsFill(reasoningSlots, index)[index] = reasoning ? { reasoning: String(reasoning) } : null;
  if (Array.isArray(message.swipeImages)) swipeSlotsFill(message.swipeImages, index)[index] = null;
  return index;
}
function messageSwipeSetActive(message, index) {
  messageRevertTranslation(message);
  var model = messageSwipeNormalize(message),
    active = Math.max(0, Math.min(model.swipes.length - 1, Math.floor(Number(index) || 0)));
  messageSwipeStashActive(message);
  message.swipeId = active;
  messageSwipeRestoreActive(message);
  message.content = String(model.swipes[active] || '');
  if (message.yeyuMvu && typeof message.yeyuMvu === 'object') message.yeyuMvu.activeIndex = active;
  if (Array.isArray(message.tavernHelperSwipeInfo) && message.tavernHelperSwipeInfo[active])
    message.extra = hostWriteMessageExtra(message, message.tavernHelperSwipeInfo[active]);
  delete message.continueBase;
  return active;
}
async function messageSwipeCommitMutation(char, sess, message, index, before, eventName, eventArgs) {
  try {
    var changedSeq = Number(message && message.seq) || 0;
    if (changedSeq) rollbackMemoryDependencies(char.id, sess, changedSeq);
    invalidateCacheContexts(char.id, index, true, sess.id);
    await refreshMessageMutation(char, sess, before);
    try {
      await prepareRegexScriptTexts(char, [
        {
          role: 'assistant',
          phase: 'display',
          depth: regexScriptMessageDepths(sess.msgs)[index],
          index: index,
          message: message,
          text: String(message.content || ''),
        },
      ]);
    } catch (_) {}
    await saveData('sessions', { urgent: true });
  } catch (error) {
    before.rollback();
    clearMvuSessionRuntime(char.id, sess.id);
    throw error;
  }
  await markStreamDraftsStaleForSession(char.id, sess.id, 'base_changed');
  renderChat();
  updateTokensBar(char);
  if (eventName) await cardFrontendAwaitBroadcastEvent(eventName, eventArgs || []);
  return true;
}
async function switchMessageSwipe(idx, step, options) {
  options = options || {};
  var char = getChar(),
    sess = char && getActiveSession(char.id),
    message = sess && sess.msgs && sess.msgs[idx];
  if (!char || !sess || !message || message.role !== 'assistant') return false;
  if (message.opening === true) return switchOpeningGreeting(idx, step, options);
  var model = messageSwipeState(message),
    requested = Number(options.targetIndex),
    next = Number.isFinite(requested) ? Math.floor(requested) : model.active + (Number(step) < 0 ? -1 : 1);
  // Swiping past the last candidate generates a genuinely new one through the normal
  // generation/drain pipeline (generateMessageSwipe -> awaitGenerationPostCommit) and must
  // not be rejected by the snapshot-rollback guard below.
  if (next === model.swipes.length && idx === replyTailIndex(sess.msgs) && Number(step) > 0)
    return generateMessageSwipe(idx, options);
  // Only /swipe loops from the first candidate to the last, as ST's swipe() does; the arrows stop at the ends.
  if (next < 0 && options.wrapLeft === true) next = model.swipes.length - 1;
  if (next < 0 || next >= model.swipes.length || next === model.active) return false;
  // After the validity checks, so an out-of-range or no-op switch stays silent.
  if (blockDuringGenerationOrPostCommit('切换回复候选', sess, options)) return false;
  var before = beginMessageMutation(char, sess, message);
  message.swipes = model.swipes;
  message.swipeId = model.active;
  messageSwipeSetActive(message, next);
  try {
    return await messageSwipeCommitMutation(
      char,
      sess,
      message,
      idx,
      before,
      CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPED,
      [idx]
    );
  } catch (error) {
    toast('候选切换保存失败，原选择已恢复：' + error.message, 'err');
    return false;
  }
}
async function addMessageSwipeCandidate(text, options) {
  options = options || {};
  var char = getChar(),
    sess = char && getActiveSession(char.id);
  if (blockDuringGenerationOrPostCommit('添加回复候选', sess, options)) return null;
  var index =
      options.messageIndex == null ? (sess ? sess.msgs.length - 1 : -1) : Math.floor(Number(options.messageIndex)),
    message = sess && sess.msgs[index],
    value = String(text == null ? '' : text);
  if (!char || !sess || !message || message.role !== 'assistant' || message.opening === true)
    throw new Error('当前最后一条不是可添加候选的普通回复');
  if (!value) throw new Error('候选回复不能为空');
  var before = beginMessageMutation(char, sess, message),
    model = messageSwipeNormalize(message),
    newIndex = model.swipes.length;
  messageSwipeAdoptReasoning(message).push(null);
  if (Array.isArray(message.swipeImages)) message.swipeImages[newIndex] = null;
  message.swipes.push(value);
  if (Array.isArray(message.tavernHelperSwipeInfo))
    message.tavernHelperSwipeInfo.push(hostWriteMessageExtra(message, { api: 'manual', model: 'slash command' }));
  if (options.switch === true) messageSwipeSetActive(message, newIndex);
  try {
    await messageSwipeCommitMutation(
      char,
      sess,
      message,
      index,
      before,
      options.switch === true ? CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPED : null,
      options.switch === true ? [index] : null
    );
    return newIndex;
  } catch (error) {
    throw new Error('候选添加保存失败，原消息已恢复：' + error.message);
  }
}
async function deleteMessageSwipeCandidate(swipeIndex, options) {
  options = options || {};
  var char = getChar(),
    sess = char && getActiveSession(char.id);
  if (blockDuringGenerationOrPostCommit('删除回复候选', sess, options)) return null;
  var index =
      options.messageIndex == null ? (sess ? sess.msgs.length - 1 : -1) : Math.floor(Number(options.messageIndex)),
    message = sess && sess.msgs[index];
  if (!char || !sess || !message || message.role !== 'assistant' || message.opening === true)
    throw new Error((options.messageIndex == null ? '当前最后一条' : '这条消息') + '不是可删除候选的普通回复');
  var before = beginMessageMutation(char, sess, message),
    model = messageSwipeState(message);
  if (model.swipes.length <= 1) throw new Error('不能删除唯一的候选回复');
  var remove = swipeIndex == null ? model.active : Math.floor(Number(swipeIndex));
  if (!Number.isInteger(remove) || remove < 0 || remove >= model.swipes.length) throw new Error('候选编号无效');
  messageRevertTranslation(message);
  model = messageSwipeNormalize(message);
  messageSwipeStashActive(message);
  var removedActive = remove === model.active,
    newActive =
      remove < model.active
        ? model.active - 1
        : remove > model.active
          ? model.active
          : Math.min(remove, model.swipes.length - 2);
  removeMessageImageCandidateIdentity(message, remove);
  message.swipes.splice(remove, 1);
  if (Array.isArray(message.tavernHelperSwipeInfo)) message.tavernHelperSwipeInfo.splice(remove, 1);
  if (message.yeyuMvu && Array.isArray(message.yeyuMvu.candidates)) message.yeyuMvu.candidates.splice(remove, 1);
  if (Array.isArray(message.swipeGenerationMeta)) message.swipeGenerationMeta.splice(remove, 1);
  message.swipeReasoning.splice(remove, 1);
  if (Array.isArray(message.swipeImages)) message.swipeImages.splice(remove, 1);
  message.swipeId = newActive;
  message.content = String(message.swipes[newActive] || '');
  messageSwipeRestoreActive(message);
  messageSwipeSetActive(message, newActive);
  try {
    await messageSwipeCommitMutation(char, sess, message, index, before, null, null);
    await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPE_DELETED, [
      { messageId: index, swipeId: remove, newSwipeId: newActive },
    ]);
    if (removedActive) await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPED, [index]);
    return newActive;
  } catch (error) {
    throw new Error('候选删除保存失败，原消息已恢复：' + error.message);
  }
}
function copyMessage(idx) {
  const msgs = getMsgs(D.currentCharId);
  if (idx < 0 || idx >= msgs.length) return;
  navigator.clipboard
    .writeText(msgs[idx].content)
    .then(() => toast('已复制', 'ok'))
    .catch(() => toast('复制失败', 'err'));
}
function rollbackMemoryForMessage(idx) {
  var sess = getActiveSession(D.currentCharId),
    msg = sess && sess.msgs && sess.msgs[idx],
    seq = Number(msg && msg.seq) || 0;
  return seq ? rollbackMemoryDependencies(D.currentCharId, sess, seq) : false;
}

function cleanTranslationResult(text) {
  return cleanAuxiliaryResponseText(text || '')
    .replace(/^\s*(?:翻译结果|译文)[:：]\s*/, '')
    .trim();
}
function translationPartToken(index) {
  return '__YEYU_PART_' + index + '__';
}
// The reply must come back with exactly the separators it was given, in order: a missing or
// reordered one would make every following span land in the wrong place in the message.
function splitTranslationParts(text, count) {
  var value = String(text == null ? '' : text);
  if (count <= 1) return [value];
  function attempt(source, flags) {
    var pattern = new RegExp(source, flags),
      parts = [],
      cursor = 0,
      seen = 0,
      match;
    while ((match = pattern.exec(value))) {
      parts.push(value.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      seen++;
      if (Number(match[1]) !== seen) return null;
    }
    parts.push(value.slice(cursor));
    return parts.length === count ? parts : null;
  }
  return attempt('__YEYU_PART_(\\d+)__', 'g') || attempt('__\\s*YEYU[ _-]*PART[ _-]*(\\d+)\\s*__', 'gi');
}
// Which spans of a message this translation may rewrite. A Risu message built from condition
// blocks only ever shows one branch, so only that branch is sent and only that branch is written
// back; every other branch and every structural marker is copied from the stored text unchanged.
// The text handed to the model comes from the pre-translation original whenever the two trees still
// line up, so translating the same branch twice never translates a translation.
async function buildMessageTranslationPlan(message, char, session, signal) {
  var base = String((message && message.content) || ''),
    earlier = message && typeof message.original_content === 'string' ? message.original_content : '',
    spans = null;
  if (isRisuCharacter(char)) {
    spans = await risuVisibleSpans(
      base,
      char,
      session,
      { message: message, role: message.role, signal: signal },
      earlier
    );
  }
  if (!spans) {
    var whole = earlier || base;
    return {
      conditional: false,
      base: whole,
      runs: [{ start: 0, end: whole.length, lead: '', tail: '', source: whole }],
    };
  }
  var runs = [];
  spans.forEach(function (span) {
    var text = base.slice(span.start, span.end);
    if (!text.trim()) return;
    var source = span.earlierStart >= 0 ? earlier.slice(span.earlierStart, span.earlierEnd) : text;
    if (!source.trim()) source = text;
    runs.push({
      start: span.start,
      end: span.end,
      lead: /^\s*/.exec(text)[0],
      tail: /\s*$/.exec(text)[0],
      source: source.trim(),
    });
  });
  return { conditional: true, base: base, runs: runs };
}
async function translateMessage(idx) {
  var sess = getActiveSession(D.currentCharId);
  if (blockDuringGenerationOrPostCommit('翻译消息', sess)) return;
  const msgs = getMsgs(D.currentCharId);
  if (idx < 0 || idx >= msgs.length) return;
  const s = D.settings,
    route = resolveApiRoute('translation');
  if ((!route.apiKey && route.protocol !== 'grok-subscription') || !route.apiUrl || !route.model) {
    toast('请先配置翻译模型路由', 'err');
    return;
  }
  const m = msgs[idx];
  if (!m || !String(m.original_content || m.content || '').trim()) return;
  var char = getChar(),
    owner = messageTransactionTarget(idx),
    mutation = null;
  setGenerationStatusLabel('正在翻译');
  setGenerationState('preparing', { helper: true });
  var controller = abortController;
  try {
    var plan = await buildMessageTranslationPlan(m, char, sess, controller.signal),
      hiddenPatterns = risuHiddenTriggerPatterns(char),
      sendable = [],
      guardedRuns = (
        await risuComputeInWorker(
          'protect-translation',
          {
            texts: plan.runs.map(function (run) {
              return run.source;
            }),
            patterns: hiddenPatterns,
          },
          char,
          sess,
          { signal: controller.signal }
        )
      ).guarded;
    plan.runs.forEach(function (run, runIndex) {
      var guarded = guardedRuns[runIndex];
      run.slots = guarded.slots;
      run.request = guarded.source;
      run.send = window.YeyuPure.visibleCharacterCount(translationComparableText(guarded.source)) > 0;
      if (run.send) sendable.push(run);
    });
    if (!sendable.length) {
      toast(plan.conditional ? '这条消息当前显示的内容没有可翻译的文字' : '这条消息没有可翻译的文字', 'info');
      return;
    }
    var glossary = characterNameGlossary(char),
      protectedInput = sendable
        .map(function (run, index) {
          return (index ? '\n' + translationPartToken(index) + '\n' : '') + run.request;
        })
        .join(''),
      translationSystem = settingsPromptText('translationPrompt', s),
      contextSource = '',
      contextFields = ['mes_example', 'personality', 'description'];
    for (var contextIndex = 0; contextIndex < contextFields.length; contextIndex++) {
      var contextValue = String((char && char[contextFields[contextIndex]]) || '').trim();
      if (contextValue) {
        contextSource = contextValue;
        break;
      }
    }
    var runtimeParts = [
      '严格保留输入中的 __YEYU_KEEP_N__ 格式占位符，不得翻译、删除、改写或移动；它们代表图片、音频、HTML、Markdown、URL、代码围栏或卡片宏。代码块中的聊天记录、消息日志和自然语言仍然必须翻译；只保留代码围栏、时间格式、消息结构和媒体地址，不要把聊天记录误当作程序代码。翻译发言者和收件人名称时优先使用名称表。',
    ];
    if (sendable.length > 1)
      runtimeParts.push(
        '输入被 __YEYU_PART_N__ 分隔标记切成了 ' +
          sendable.length +
          ' 段互不相连的正文。逐段翻译，按原顺序输出，并原样保留每一个 __YEYU_PART_N__ 标记（数量、编号和顺序都不能变）；不要合并、拆分、增删段落，也不要在段与段之间补写过渡内容。'
      );
    if (contextSource) runtimeParts.push('[角色卡背景参照]\n' + contextSource);
    if (glossary)
      runtimeParts.push(
        '[强制名称表]\n' + glossary + '\n所有人物名称必须使用上述规范中文名；原名、简称和爱称只用于识别，不得另造译名。'
      );
    var body = {
      model: route.model,
      stream: false,
      messages: [
        { role: 'system', content: runtimeParts.join('\n\n') },
        {
          role: 'system',
          content:
            '以上信息仅作为背景知识，供你理解接下来要翻译的当前消息。不要翻译、复述、总结或把它写入译文。\n\n' +
            translationSystem,
        },
        { role: 'user', content: protectedInput },
      ],
    };
    applyThinkingForRoute(body, route, { route: 'translation' });
    var resp = await fetchCompatibleCompletion(route, body, controller.signal),
      json = await resp.json(),
      choice = (json && json.choices && json.choices[0]) || {},
      raw = cleanTranslationResult(getChatCompletionContent(json));
    if (!raw) throw new Error('翻译结果为空');
    if (choice.finish_reason === 'length') throw new Error('翻译结果被输出上限截断，已保留原文');
    var parts = splitTranslationParts(raw, sendable.length);
    if (!parts) throw new Error('译文缺少完整的分段标记，无法对回条件分支，已保留原文');
    var lostRequired = 0;
    sendable.forEach(function (run, index) {
      var restored = restoreTranslationMarkup(String(parts[index]).trim(), run.slots),
        clean = restored.text;
      lostRequired += restored.missing.filter(translationRequiredSlot).length;
      run.output = plan.conditional ? clean.trim() : clean;
    });
    if (
      sendable.some(function (run) {
        return !run.output;
      })
    )
      throw new Error('翻译结果为空');
    // A dropped media tag or URL can still be appended at the end of the span. Structural slots
    // cannot: moving a hidden trigger or losing one half of a natural-language fence changes what
    // the reader sees just as surely as losing a card macro.
    if (lostRequired) throw new Error('译文丢失了 ' + lostRequired + ' 个格式占位符，已保留原文');
    var srcCount = window.YeyuPure.visibleCharacterCount(
        translationComparableText(
          sendable
            .map(function (run) {
              return run.source;
            })
            .join('\n')
        )
      ),
      outCount = window.YeyuPure.visibleCharacterCount(
        translationComparableText(
          sendable
            .map(function (run) {
              return run.output;
            })
            .join('\n')
        )
      );
    if (srcCount > 300 && outCount < srcCount * 0.16) throw new Error('翻译结果明显不完整，已保留原文');
    if (isGenerationCancelled()) throw new Error('已取消');
    idx = messageTransactionTargetIndex(owner);
    if (idx < 0) throw new Error('消息或对话已变化，请重新翻译');
    var next = plan.base;
    for (var runIndex = plan.runs.length - 1; runIndex >= 0; runIndex--) {
      var target = plan.runs[runIndex];
      if (!target.send) continue;
      next = next.slice(0, target.start) + target.lead + target.output + target.tail + next.slice(target.end);
    }
    if (translationPlaceholderResidue(next, plan.base))
      throw new Error('译文里残留了格式占位符，无法安全写回，已保留原文');
    mutation = beginMessageMutation(char, sess, m);
    rollbackMemoryForMessage(idx);
    if (!m.original_content) m.original_content = m.content;
    m.content = next;
    syncMvuMessageActiveSwipe(m);
    delete m.generationMeta;
    delete m.continueBase;
    m.translated = true;
    m.edited = true;
    invalidateCacheContexts(char.id, idx + 1, true, sess.id);
    await refreshMessageMutation(char, sess, mutation);
    await saveData('sessions', { urgent: true });
    mutation = null;
    renderChat();
    updateTokensBar(getChar());
    toast('已翻译成中文', 'ok');
  } catch (e) {
    if (mutation) {
      mutation.rollback();
      clearMvuSessionRuntime(char.id, sess.id);
    }
    if (isGenerationCancelled(e)) toast('已停止翻译', 'info');
    else toast('翻译失败，原文已保留：' + e.message, 'err');
  } finally {
    finishGeneration(null);
    setGenerationStatusLabel('正在生成');
  }
}
async function restoreOriginalMessage(idx, continued) {
  var action = continued ? '撤销续写' : '恢复原文',
    sess = getActiveSession(D.currentCharId);
  if (blockDuringGenerationOrPostCommit(action, sess)) return;
  var m = getMsgs(D.currentCharId)[idx],
    source = m && (continued ? m.continueBase : m.original_content);
  if (typeof source !== 'string') {
    toast(continued ? '没有可撤销的续写' : '没有可恢复的原文', 'info');
    return;
  }
  var char = getChar(),
    mutation = beginMessageMutation(char, sess, m);
  try {
    rollbackMemoryForMessage(idx);
    m.content = source;
    syncMvuMessageActiveSwipe(m);
    if (m.role === 'assistant') messageSwipeNormalize(m);
    delete m.continueBase;
    if (!continued) {
      delete m.original_content;
      delete m.translated;
      delete m.restored;
      m.edited = true;
    }
    invalidateCacheContexts(D.currentCharId, idx + 1, true, sess.id);
    await refreshMessageMutation(char, sess, mutation);
    await saveData('sessions');
  } catch (error) {
    mutation.rollback();
    clearMvuSessionRuntime(char.id, sess.id);
    toast(action + '保存失败，原状态已恢复：' + error.message, 'err');
    return;
  }
  await markStreamDraftsStaleForSession(char.id, sess.id, 'base_changed');
  renderChat();
  updateTokensBar(getChar());
  await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_UPDATED, [idx]);
  toast(continued ? '已撤销续写' : '已恢复原文', 'ok');
}
