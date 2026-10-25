// ===== Generation coordinator =====
function generationAfterDataPayload(messages, extra) {
  var data = Object.assign({ prompt: messages, dryRun: false }, extra);
  // Existing Yeyu scripts may replace chat; both names must remain the same mutable prompt.
  Object.defineProperty(data, 'chat', {
    enumerable: true,
    get: function () {
      return this.prompt;
    },
    set: function (value) {
      this.prompt = value;
    },
  });
  return data;
}
function generationTypeForTarget(target) {
  var mode = String((target && target.mode) || '');
  return ['continue', 'regenerate', 'swipe', 'impersonate', 'quiet'].includes(mode) ? mode : 'normal';
}
// Every entry that can start a generation takes the post-commit run its caller belongs to, so a
// script running inside a tail can start the next generation without waiting for itself.
// Interface entries pass nothing.
function generationEntryDrainOptions(options) {
  return { postCommitRun: (options && options.postCommitRun) || null };
}
async function generateMessageSwipe(messageIndex, options) {
  if (_generationState !== 'idle') {
    toast('当前回复仍在生成', 'info');
    return false;
  }
  const char = getChar();
  if (!char) return false;
  const sess = getActiveSession(char.id),
    msgs = sess && sess.msgs,
    index = Math.floor(Number(messageIndex));
  if (!msgs || index < 0 || !msgs[index] || msgs[index].role !== 'assistant' || msgs[index].opening === true) {
    toast('只能为当前最后一条普通回复生成新候选', 'info');
    return false;
  }
  const target = {
      charId: char.id,
      sessionId: sess.id,
      mode: 'swipe',
      messageIndex: index,
      messageSeq: msgs[index].seq,
    },
    history = msgs.slice(0, index);
  generationTarget = bindGenerationTargetOwnership(target, sess);
  setGenerationStatusLabel('正在生成新候选');
  setGenerationState('preparing');
  try {
    await doAPICall(
      Object.assign({ target: target, history: history, interactive: true }, generationEntryDrainOptions(options))
    );
    startStyleAuditForSession(target.charId, target.sessionId);
    return true;
  } catch (error) {
    restoreTargetBubble(target);
    if (!isGenerationCancelled(error)) {
      toast('新候选生成失败：' + error.message, 'err');
      console.error(error);
    }
    return false;
  } finally {
    finishGeneration(target);
  }
}
async function impersonateUser(additionalPrompt, options) {
  if (_generationState !== 'idle') {
    toast('当前回复仍在生成', 'info');
    return false;
  }
  const char = getChar();
  if (!char) {
    toast('请选择角色', 'err');
    return false;
  }
  const sess = getActiveSession(char.id);
  if (!sess) {
    toast('当前对话不可用', 'err');
    return false;
  }
  const target = {
    charId: char.id,
    sessionId: sess.id,
    mode: 'impersonate',
    impersonationPromptOverride: String(additionalPrompt || '').trim(),
  };
  generationTarget = bindGenerationTargetOwnership(target, sess);
  setGenerationStatusLabel('正在扮演用户');
  setGenerationState('preparing');
  try {
    await doAPICall(Object.assign({ target: target, interactive: true }, generationEntryDrainOptions(options)));
    return true;
  } catch (error) {
    if (!isGenerationCancelled(error)) {
      toast('扮演用户失败：' + error.message, 'err');
      console.error(error);
    }
    return false;
  } finally {
    finishGeneration(target);
  }
}
// 重新生成与继续生成都落在当前末尾的回复上；末尾是用户消息、还没有回复时，两者都改为补一条新回复。
const REPLY_TAIL_GENERATION = {
  regenerate: { blocked: '当前末尾消息无法生成回复', status: '正在重新生成', failure: '重新生成失败：' },
  continue: { blocked: '当前末尾消息无法继续', status: '正在继续生成', failure: '继续生成失败：' },
};
async function generateOnReplyTail(mode, options) {
  if (_generationState !== 'idle') {
    toast('当前回复仍在生成', 'info');
    return false;
  }
  const char = getChar();
  if (!char) return false;
  const sess = getActiveSession(char.id),
    msgs = sess && sess.msgs;
  if (!msgs || !msgs.length) {
    toast('当前对话没有可生成的内容', 'info');
    return false;
  }
  const words = REPLY_TAIL_GENERATION[mode],
    tail = replyTailIndex(msgs),
    last = msgs[tail],
    replyMissing = last.role === 'user';
  if (!replyMissing && last.role !== 'assistant') {
    toast(words.blocked, 'info');
    return false;
  }
  const target = replyMissing
      ? { charId: char.id, sessionId: sess.id, mode: 'new' }
      : { charId: char.id, sessionId: sess.id, mode: mode, messageIndex: tail, messageSeq: last.seq },
    request = { target: target, interactive: true };
  if (mode === 'regenerate') request.history = replyMissing ? msgs : msgs.slice(0, tail);
  generationTarget = bindGenerationTargetOwnership(target, sess);
  setGenerationStatusLabel(replyMissing ? '正在生成回复' : words.status);
  setGenerationState('preparing');
  try {
    await doAPICall(Object.assign(request, generationEntryDrainOptions(options)));
    startStyleAuditForSession(target.charId, target.sessionId);
    return true;
  } catch (e) {
    if (!replyMissing) restoreTargetBubble(target);
    if (!isGenerationCancelled(e)) {
      toast(words.failure + e.message, 'err');
      console.error(e);
    }
    return false;
  } finally {
    finishGeneration(target);
  }
}
function regenerateLast(options) {
  return generateOnReplyTail('regenerate', options);
}
function continueGeneration(options) {
  return generateOnReplyTail('continue', options);
}
// ===== Send Message =====

async function sendMessage(options) {
  if (_generationState !== 'idle') {
    toast('当前回复仍在生成', 'info');
    return false;
  }
  const input = $('user-input');
  const content = input.value.trim();
  if (!content) return;
  if (!getChar()) {
    toast('请选择角色', 'err');
    return false;
  }
  if (!getActiveSession(getChar().id)) {
    toast('当前对话不可用', 'err');
    return false;
  }
  if (content.charAt(0) === '/') return await executeStscriptFromChat(content);
  return await doSendMessage(content, options);
}

function acceptIncompleteAssistantBeforeUserSend(char, sess) {
  var messages = sess && Array.isArray(sess.msgs) ? sess.msgs : [],
    tail = replyTailIndex(messages),
    target = messages[tail];
  if (!target || target.role !== 'assistant' || !messageIsIncomplete(target)) return { changed: false };
  var beforeIncomplete = target.incomplete,
    hadIncomplete = Object.prototype.hasOwnProperty.call(target, 'incomplete'),
    beforeMeta = target.generationMeta;
  delete target.incomplete;
  var meta = beforeMeta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    meta = Object.assign({}, meta);
    target.generationMeta = meta;
    ['incomplete', 'interruptionReason', 'interruptionStatus', 'interruptionDetail', 'sourceDraftId'].forEach(
      function (key) {
        delete meta[key];
      }
    );
    if (!Object.keys(meta).length) delete target.generationMeta;
  }
  var afterMeta = target.generationMeta;
  return {
    changed: true,
    messageIndex: tail,
    rollback: function () {
      if (target.incomplete !== undefined || target.generationMeta !== afterMeta) return;
      if (hadIncomplete) target.incomplete = beforeIncomplete;
      if (beforeMeta === undefined) delete target.generationMeta;
      else target.generationMeta = beforeMeta;
    },
  };
}
async function doSendMessage(content, options) {
  if (_generationState !== 'idle') return false;
  if (blockGenerationDuringStorageReadOnly()) return false;
  const char = getChar();
  if (!char) {
    toast('请选择角色', 'err');
    return false;
  }
  const sess = getActiveSession(char.id);
  if (!sess) {
    toast('当前对话不可用', 'err');
    return false;
  }
  content = String(content || '').trim();
  var sourceContent = content,
    acceptedIncomplete = { changed: false },
    submittedMessage = null,
    target = { charId: char.id, sessionId: sess.id, mode: 'new' },
    generationType = 'normal';
  generationTarget = bindGenerationTargetOwnership(target, sess);
  followChatBottomForSend();
  var releaseGenerationOperation = beginGenerationSessionOperation(target, sess);
  setGenerationStatusLabel('正在生成回复');
  setGenerationState('preparing');
  try {
    await awaitGenerationPostCommit(sess, abortController?.signal, generationEntryDrainOptions(options));
    assertGenerationTargetOwnership(target, sess);
    activateGenerationEpoch(target, sess);
    acceptedIncomplete = acceptIncompleteAssistantBeforeUserSend(char, sess);
    if (
      acceptedIncomplete.changed &&
      typeof StoryDirection === 'object' &&
      StoryDirection &&
      typeof StoryDirection.reconcile === 'function'
    )
      StoryDirection.reconcile(sess, sess.msgs);
    await completionPresetAwaitRuntime();
    assertGenerationTargetOwnership(target, sess);
    target.cardFrontendStartedEmitted = true;
    await cardFrontendAwaitBroadcastEvent(
      CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_STARTED,
      [generationType, {}, false],
      { signal: abortController?.signal }
    );
    assertGenerationTargetOwnership(target, sess);
    await qrPerformAuto('executeBeforeGeneration');
    assertGenerationTargetOwnership(target, sess);
    target.qrBeforeGenerationEmitted = true;
    var interceptResult = await cardScriptLibraryGenerationAfterCommands(target, null, content);
    assertGenerationTargetOwnership(target, sess);
    target.cardScriptSendInterceptEmitted = true;
    if (interceptResult && typeof interceptResult === 'object') {
      content = String(interceptResult.content == null ? content : interceptResult.content);
      if (interceptResult.deleted === true) {
        releaseGenerationOperation();
        finishGeneration(target);
        return true;
      }
    }
    if (!target.cardFrontendAfterCommandsEmitted) {
      await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_AFTER_COMMANDS,
        [generationType, {}, false],
        { signal: abortController?.signal }
      );
      assertGenerationTargetOwnership(target, sess);
      target.cardFrontendAfterCommandsEmitted = true;
    }
    assertGenerationTargetOwnership(target, sess);
    if (isRisuCharacter(char)) {
      var risuInput = await risuPrepareInput(char, sess, content, target);
      assertGenerationTargetOwnership(target, sess);
      submittedMessage = await saveMsg(
        'user',
        content,
        { risu: { source: content, text: risuInput, template: target.risuInputTemplate } },
        { char: char, session: sess }
      );
    } else submittedMessage = await saveMsg('user', content);
    assertGenerationTargetOwnership(target, sess);
    await broadcastSentMessageEvent('MESSAGE_SENT', sess, submittedMessage);
    assertGenerationTargetOwnership(target, sess);
    await presetTaskCall('onUserMessage', { characterId: char.id, sessionId: sess.id, message: submittedMessage });
    assertGenerationTargetOwnership(target, sess);
    let input = $('user-input');
    if (input && String(input.value || '').trim() === sourceContent) {
      input.value = '';
      input.style.height = 'auto';
      requestAnimationFrame(syncComposerMetrics);
    }
    await qrPerformAuto('executeOnUser');
    assertGenerationTargetOwnership(target, sess);
    // Quick replies in ST are the first USER_MESSAGE_RENDERED listener, so executeOnUser runs before it.
    await broadcastSentMessageEvent('USER_MESSAGE_RENDERED', sess, submittedMessage);
    assertGenerationTargetOwnership(target, sess);
  } catch (error) {
    if (!submittedMessage && acceptedIncomplete.rollback) {
      acceptedIncomplete.rollback();
      if (typeof StoryDirection === 'object' && StoryDirection && typeof StoryDirection.reconcile === 'function')
        StoryDirection.reconcile(sess, sess.msgs);
    }
    releaseGenerationOperation();
    let input = $('user-input');
    if (input && D.currentCharId === char.id && getActiveSession(char.id) === sess) {
      if (!submittedMessage) input.value = sourceContent;
      else if (String(input.value || '').trim() === sourceContent) input.value = '';
      input.dispatchEvent(new Event('input'));
    }
    renderChat();
    finishGeneration(target);
    if (!isGenerationCancelled(error))
      toast(
        (submittedMessage ? '消息已保存，但后续脚本失败：' : '卡片输入脚本或消息保存失败，尚未发送：') +
          String((error && error.message) || error),
        'err'
      );
    return false;
  }
  try {
    if (acceptedIncomplete.changed) renderChat();
    await markStreamDraftsStaleForSession(char.id, sess.id, 'base_changed');
    assertGenerationTargetOwnership(target, sess);
  } catch (error) {
    releaseGenerationOperation();
    finishGeneration(target);
    if (!isGenerationCancelled(error)) toast('发送准备失败：' + String((error && error.message) || error), 'err');
    return false;
  }
  releaseGenerationOperation();
  try {
    await doAPICall({ target: target, interactive: true, submittedMessage: submittedMessage });
    startStyleAuditForSession(target.charId, target.sessionId);
    return true;
  } catch (e) {
    if (!isGenerationCancelled(e)) {
      toast('发送失败：' + e.message, 'err');
      console.error(e);
    }
    return false;
  } finally {
    finishGeneration(target);
  }
}

async function broadcastSentMessageEvent(eventKey, sess, message) {
  var index = sess.msgs.indexOf(message);
  if (index < 0) return;
  await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES[eventKey], [index], {
    signal: abortController?.signal,
  });
}
function isGenerationCancelled(error) {
  if (_generationState === 'stopping') return true;
  return (
    !!(error && (error.name === 'AbortError' || error.message === '已取消')) ||
    !!(abortController && abortController.signal && abortController.signal.aborted)
  );
}
// ST reports the chat length when the generation ends, whether or not a reply was committed.
function generationEndedEventArgs(session) {
  return [session && Array.isArray(session.msgs) ? session.msgs.length : 0];
}
function finishGeneration(target) {
  var finishSession = generationSessionForTarget(target),
    epoch = target && target.epoch,
    epochSession = (target && _generationTargetOwnership.get(target)?.session) || finishSession,
    releaseFinishEvent = null;
  if (
    epoch &&
    (_generationFinishedEpochs.get(epochSession) === epoch || _generationSessionEpochs.get(epochSession) !== epoch)
  )
    return;
  if (generationTarget && generationTarget !== target) return;
  if (epoch && epochSession) _generationFinishedEpochs.set(epochSession, epoch);
  var endTarget = target && { charId: target.charId, sessionId: target.sessionId, epoch: epoch },
    postRun = finishSession && _generationPostCommitRuns.get(finishSession),
    endRun =
      postRun && postRun.epoch === epoch
        ? postRun
        : { target: target, epoch: epoch, controller: new AbortController() };
  hostPromptFinish(finishSession);
  try {
    if (finishSession) releaseFinishEvent = beginGenerationSessionOperation(target, finishSession);
  } catch (error) {
    // A replaced session skips the finish broadcast; anything else is a real fault worth seeing.
    if (!error || error.code !== 'generation_session_replaced')
      console.error('[generation] finish ownership check failed', error);
  }
  var live = chatViewportTargetVisible(target),
    refreshDraftRecovery = !!(_activeStreamDraft && _activeStreamDraft.text);
  if (generationTarget === target) generationTarget = null;
  ++_streamPaintEpoch;
  var o = _activeStreamTarget || target;
  _activeStreamRepaint = null;
  _activeStreamTarget = null;
  abortController = null;
  if (live) {
    clearStreamCursors();
    var pending = document.getElementById('stream-msg');
    if (pending) pending.remove();
  }
  releaseViewportState(_activeViewportState);
  _activeViewportState = null;
  // The GENERATION_ENDED tail is registered before the state goes idle, so the round preview only catches up once
  // card scripts have heard the end (62 cardEventGenerationActive).
  var pendingCommitTask = finishSession
      ? _generationPostCommitTasks.get(finishSession)
      : target && target.postCommitTask,
    hadPostCommitTask = !!pendingCommitTask,
    generationEndedTask = queueGenerationPostCommitTask(
      target,
      finishSession,
      async function (waitOptions) {
        if (hadPostCommitTask && !target.presetAfterAiQueued && target.cardScriptLibraryCommittedMessageIndex != null) {
          target.presetAfterAiQueued = true;
          await generationTailBoundedWork(
            function () {
              return notifyPresetTaskAfterAi(target, waitOptions);
            },
            endRun,
            '预设 after-AI',
            target
          );
        }
        var endController = endRun.controller;
        if (!waitOptions.current()) return;
        await generationBoundedWork(
          async function () {
            if (releaseFinishEvent)
              await cardFrontendAwaitBroadcastEvent(
                CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_ENDED,
                generationEndedEventArgs(finishSession),
                { signal: endController.signal }
              );
            if (waitOptions.current()) cardScriptLibraryGenerationCommitted(target);
          },
          endController,
          undefined,
          '生成结束事件'
        );
      },
      {
        run: endRun,
        owner: endTarget,
        after: pendingCommitTask,
        queue: hadPostCommitTask,
        reportSkip: hadPostCommitTask,
        settled: function (waitOptions) {
          if (hadPostCommitTask && waitOptions.current()) {
            requestCardScriptRerender(rrKey(target));
          }
        },
      }
    );
  setGenerationState('idle');
  refreshComposerImageButton();
  syncRisuExecutionSessions();
  var flushed = false;
  if (live) flushed = flushDeferredCardScriptRerender(o);
  else clearDeferredCardScriptRerender(o);
  if (live && !flushed && refreshDraftRecovery) renderChat();
  requestAnimationFrame(syncComposerMetrics);
  if (releaseFinishEvent) generationEndedTask.catch(function () {}).finally(releaseFinishEvent);
}
async function notifyPresetTaskAfterAi(target, options) {
  await presetTaskCall(
    'onAfterAi',
    {
      characterId: (target && target.charId) || '',
      sessionId: (target && target.sessionId) || '',
      messageIndex: target && target.messageIndex,
    },
    options
  );
}
// Decided by status and interruption kind, never by wording: gateways and CDNs (502/504/520/524) fail
// transiently as often as origin servers do, and rewording a message must not change retry policy.
function isInitialRetryableError(error) {
  var status = Math.floor(Number(error && error.status) || 0);
  if (status) return status >= 500 || status === 408;
  return ['network_offline', 'network_interrupted'].includes(String((error && error.interruptionReason) || ''));
}
async function requestGenerationWithRetry(requestMessages, requestTarget, segmentOptions) {
  var attempts = 0,
    result;
  async function requestOnce() {
    attempts++;
    return await callDeepSeek(requestMessages, requestTarget, segmentOptions);
  }
  try {
    result = await requestOnce();
  } catch (error) {
    var retryable = !error.noRetry && !isGenerationCancelled(error) && attempts === 1 && isInitialRetryableError(error);
    if (retryable) {
      toast('连接未成功，正在重试一次…', 'info');
      try {
        result = await requestOnce();
      } catch (retryError) {
        error = retryError;
      }
    }
    if (!result) throw error;
  }
  return result;
}

async function doAPICall(options) {
  setGenerationStatusLabel('正在生成');
  options = options || {};
  var target = options.target || generationTarget,
    ownedSession = generationSessionForTarget(target);
  if (!ownedSession) throw new Error('当前对话不可用');
  bindGenerationTargetOwnership(target, ownedSession);
  var releaseApiOperation = beginGenerationSessionOperation(target, ownedSession);
  try {
    await completionPresetAwaitRuntime();
    _qrWiQueue = [];
    var externalController = options.controller && options.controller.signal ? options.controller : null,
      currentGenerationController = function () {
        return externalController || (abortController && abortController.signal ? abortController : null);
      },
      checkExternalCancellation = function () {
        var controller = currentGenerationController();
        if (controller && controller.signal.aborted) {
          var error = new Error('已取消');
          error.name = 'AbortError';
          throw error;
        }
      },
      char = generationTargetCharacter(target);
    checkExternalCancellation();
    if (!char) throw new Error('未选择角色');
    if (target.viewportContextId == null)
      target.viewportContextId = chatViewportTargetVisible(target) ? _chatViewportOwner.contextId : -1;
    var sess = generationSessionForTarget(target);
    if (!sess) throw new Error('当前对话不可用');
    await awaitGenerationPostCommit(sess, currentGenerationController()?.signal, options);
    assertGenerationTargetOwnership(target, sess);
    activateGenerationEpoch(target, sess);
    var targetsExistingReply = ['continue', 'regenerate', 'swipe'].includes(target.mode);
    if (targetsExistingReply) resolveGenerationTargetMessage(target, sess);
    if (
      target.mode === 'swipe' &&
      (target.messageIndex !== replyTailIndex(sess.msgs) || sess.msgs[target.messageIndex].opening === true)
    )
      throw new Error('只能为当前最后一条普通回复生成新候选');
    var generationType = generationTypeForTarget(target);
    // ST announces a new swipe before Generate('swipe') starts; the candidate is written on commit.
    if (options.interactive === true && target.mode === 'swipe' && !target.cardFrontendSwipedEmitted) {
      target.cardFrontendSwipedEmitted = true;
      await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPED, [target.messageIndex], {
        signal: currentGenerationController()?.signal,
      });
      checkExternalCancellation();
    }
    if (options.interactive === true && !target.cardFrontendStartedEmitted) {
      target.cardFrontendStartedEmitted = true;
      await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_STARTED,
        [generationType, {}, false],
        { signal: currentGenerationController()?.signal }
      );
      checkExternalCancellation();
    }
    if (!target.qrBeforeGenerationEmitted) await qrPerformAuto('executeBeforeGeneration');
    if (options.interactive === true && !target.cardScriptSendInterceptEmitted) {
      target.cardScriptSendInterceptEmitted = true;
      await cardScriptLibraryGenerationAfterCommands(target, options.submittedMessage || null);
      checkExternalCancellation();
    }
    if (options.interactive === true && !target.cardFrontendAfterCommandsEmitted) {
      target.cardFrontendAfterCommandsEmitted = true;
      await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_AFTER_COMMANDS,
        [generationType, {}, false],
        { signal: currentGenerationController()?.signal }
      );
      checkExternalCancellation();
    }
    // The events and the Risu start trigger above may have moved the reply this generation is aimed at.
    if (targetsExistingReply) resolveGenerationTargetMessage(target, sess);
    var allMsgs =
      target.mode === 'regenerate' || target.mode === 'swipe'
        ? sess.msgs.slice(0, target.messageIndex)
        : options.history || sess.msgs;
    var promptController = currentGenerationController() || { signal: new AbortController().signal },
      promptBuild = await assembleGenerationPrompt(char, sess, allMsgs, target, {
        signal: promptController.signal,
        interactive: options.interactive === true,
        history: options.history,
      });
    checkExternalCancellation();
    var built = promptBuild.built,
      messages = promptBuild.messages;
    target.wbMetrics = built.worldBookMetrics;
    var baseText = promptBuild.baseText,
      manualContinuation = target.mode === 'continue';
    var requestOptions = {
      deferCommit: true,
      route: target.mode === 'impersonate' ? 'impersonate' : 'chat',
      controller: externalController,
    };
    if (options.interactive === true)
      requestOptions.beforeRequest = function (body) {
        return cardFrontendAwaitBroadcastEvent(
          CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_COMPLETION_SETTINGS_READY,
          [body],
          { signal: promptController.signal }
        );
      };
    var result;
    try {
      result = await requestGenerationWithRetry(messages, target, requestOptions);
    } catch (error) {
      var initialAutoSaved = await autoSaveInterruptedStreamDraft(target, error);
      if (initialAutoSaved && initialAutoSaved.saved) error.autoSavedIncomplete = true;
      throw error;
    }

    checkExternalCancellation();
    if (result.toolOnly) {
      publishUsage(result.usage || null, target);
      return '';
    }
    if (target.mode === 'impersonate') {
      var input = $('user-input'),
        impersonated = String(result.display || '');
      if (input) {
        input.value = impersonated;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.IMPERSONATE_READY, [impersonated], {
        signal: promptController.signal,
      });
      publishUsage(result.usage || null, target);
      releaseViewportState(requestOptions.viewportState);
      scheduleTokensBar(char);
      return impersonated;
    }
    // 手动续写的回复接在原文后面，对外交回的是合并后的整段正文。
    var committed = await commitGeneratedResponse(target, result.content, {
      continuedBase: manualContinuation ? baseText : undefined,
      reasoning: result.reasoning,
      reasoningMs: result.reasoningMs,
      reasoningCollapsed: result.reasoningCollapsed,
      usage: result.usage,
      finishReason: result.finishReason,
      streamed: result.streamed,
      viewportState: requestOptions.viewportState,
      streamDraftId: result.streamDraftId,
      streamTokensDelivered: result.streamTokensDelivered,
    });
    checkExternalCancellation();
    assertGenerationTargetOwnership(target, sess);
    if (!target.postCommitTask && !target.presetAfterAiQueued) await notifyPresetTaskAfterAi(target);
    return risuAfterGeneration(target, options, manualContinuation ? committed : result.display);
  } finally {
    releaseApiOperation();
  }
}

function handleKey(e) {
  // 输入法的 Enter 是换行，不再因为键盘动作误发消息；桌面端可用 Ctrl/Cmd+Enter 明确发送。
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
  // Ctrl+Up: edit last user message
  if (e.ctrlKey && e.key === 'ArrowUp') {
    e.preventDefault();
    var char = getChar();
    if (!char) return;
    var msgs = getMsgs(char.id);
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        editMessage(i);
        return;
      }
    }
  }
}

// ===== Continuation formatting =====
function analyzeContinuationFormat(text) {
  var source = String(text || ''),
    clean = source.replace(/\\[\s\S]/g, ''),
    quoteDepth = 0,
    parenDepth = 0;
  for (var i = 0; i < clean.length; i++) {
    var ch = clean[i];
    if (ch === '“') quoteDepth++;
    else if (ch === '”' && quoteDepth > 0) quoteDepth--;
    else if (ch === '（') parenDepth++;
    else if (ch === '）' && parenDepth > 0) parenDepth--;
  }
  var fenceToken = String.fromCharCode(96, 96, 96),
    fenceCount = clean.split(fenceToken).length - 1,
    withoutFences = clean.split(fenceToken).join(''),
    strongCount = (withoutFences.match(/\*\*/g) || []).length,
    withoutStrong = withoutFences.replace(/\*\*/g, ''),
    asteriskCount = (withoutStrong.match(/\*/g) || []).length,
    underscoreCount = (withoutFences.match(/__/g) || []).length;
  var unclosedCodeFence = fenceCount % 2 === 1,
    unclosedStrong = strongCount % 2 === 1 || underscoreCount % 2 === 1,
    unclosedAsterisk = asteriskCount % 2 === 1,
    last = clean.trimEnd(),
    terminalProbe = last.replace(/[”’」』）》】*_]+$/g, ''),
    endsWithTerminal = /[。！？!?…](?:[。！？!?…])?$/.test(terminalProbe),
    endsMidSentence = !!last && !endsWithTerminal;
  var state = {
    unclosedChineseQuote: quoteDepth > 0,
    unclosedFullwidthParen: parenDepth > 0,
    unclosedAsterisk: unclosedAsterisk,
    unclosedMarkdownEmphasis: unclosedStrong,
    unclosedCodeFence: unclosedCodeFence,
    endsMidSentence: endsMidSentence,
    endsWithTerminal: endsWithTerminal,
  };
  state.hasUnclosed =
    state.unclosedChineseQuote ||
    state.unclosedFullwidthParen ||
    state.unclosedAsterisk ||
    state.unclosedMarkdownEmphasis ||
    state.unclosedCodeFence;
  return state;
}
function continuationJoinMode(base) {
  var state = analyzeContinuationFormat(base);
  return state.hasUnclosed || state.endsMidSentence ? 'direct' : 'paragraph';
}
function joinContinuationText(base, addition) {
  base = String(base || '').replace(/\s+$/, '');
  addition = String(addition || '').replace(/^[ \t]+/, '');
  if (!base) return addition.replace(/^\s+/, '');
  if (!addition) return base;
  if (continuationJoinMode(base) === 'direct') return base + addition.replace(/^\n{2,}/, '\n');
  return base + '\n\n' + addition.replace(/^\s+/, '');
}

// ---- TavernHelper generate / generateRaw for card sandboxes ----
var CARD_FRONTEND_BUILTIN_PROMPT_DEFAULT_ORDER = [
  'world_info_before',
  'persona_description',
  'char_description',
  'char_personality',
  'scenario',
  'world_info_after',
  'dialogue_examples',
  'chat_history',
  'user_input',
];
var _cardFrontendGenerations = new Map(),
  _cardFrontendGenerationSeq = 0,
  _cardFrontendGenerationUiOwned = false,
  _cardFrontendPromptBuildTail = Promise.resolve(),
  cardFrontendGenerationWithPromptBuild = async function (controller, build) {
    var release,
      waiting = _cardFrontendPromptBuildTail.catch(function () {});
    _cardFrontendPromptBuildTail = new Promise(function (resolve) {
      release = resolve;
    });
    await waiting;
    try {
      if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
      return await build();
    } finally {
      release();
    }
  },
  cardFrontendGenerationBroadcast = function (name, args) {
    return cardFrontendBroadcastEvent(name, args);
  },
  cardFrontendGenerationController = function (parentSignal) {
    var controller = new AbortController(),
      relay = null;
    if (parentSignal && typeof parentSignal.addEventListener === 'function') {
      relay = function () {
        if (!controller.signal.aborted) controller.abort(parentSignal.reason);
      };
      if (parentSignal.aborted) relay();
      else parentSignal.addEventListener('abort', relay, { once: true });
    }
    return {
      controller: controller,
      release: function () {
        if (relay && parentSignal && typeof parentSignal.removeEventListener === 'function')
          parentSignal.removeEventListener('abort', relay);
      },
    };
  };
function cardFrontendGenerationAbortError(message) {
  var error = new Error(String(message || '已由你停止'));
  error.name = 'AbortError';
  return error;
}
function cardFrontendGenerationConfig(value, raw) {
  var config = objectRecord(value) || {},
    allowed = {
      preset_name: 1,
      generation_id: 1,
      user_input: 1,
      image: 1,
      should_stream: 1,
      should_silence: 1,
      should_return_reasoning: 1,
      overrides: 1,
      injects: 1,
      max_chat_history: 1,
      custom_api: 1,
      json_schema: 1,
    };
  if (raw) allowed.ordered_prompts = 1;
  var unsupported = Object.keys(config).filter(function (key) {
    return !allowed[key];
  });
  if (unsupported.length)
    throw new Error((raw ? 'generateRaw' : 'generate') + ' 不支持配置项：' + unsupported.join('、'));
  if (raw && Object.prototype.hasOwnProperty.call(config, 'preset_name'))
    throw new Error(
      'generateRaw 不接受 preset_name：JS-Slash-Runner 4.11.3 的公开类型与运行时矛盾，夜欲选择明确拒绝而不是静默忽略'
    );
  if (config.preset_name != null && typeof config.preset_name !== 'string') throw new Error('preset_name 必须是字符串');
  if (config.generation_id != null && typeof config.generation_id !== 'string')
    throw new Error('generation_id 必须是字符串');
  if (config.user_input != null && typeof config.user_input !== 'string') throw new Error('user_input 必须是字符串');
  if (config.should_stream != null && typeof config.should_stream !== 'boolean')
    throw new Error('should_stream 必须是 true 或 false');
  if (config.should_silence != null && typeof config.should_silence !== 'boolean')
    throw new Error('should_silence 必须是 true 或 false');
  if (config.should_return_reasoning != null && typeof config.should_return_reasoning !== 'boolean')
    throw new Error('should_return_reasoning 必须是 true 或 false');
  if (config.overrides != null && !objectRecord(config.overrides)) throw new Error('overrides 必须是对象');
  if (config.overrides) {
    var overrideAllowed = {
        world_info_before: 1,
        persona_description: 1,
        char_description: 1,
        char_personality: 1,
        scenario: 1,
        world_info_after: 1,
        dialogue_examples: 1,
        chat_history: 1,
      },
      overrideExtra = Object.keys(config.overrides).filter(function (key) {
        return !overrideAllowed[key];
      });
    if (overrideExtra.length) throw new Error('overrides 不支持配置项：' + overrideExtra.join('、'));
    var chatHistory = config.overrides.chat_history;
    if (chatHistory != null && !objectRecord(chatHistory)) throw new Error('overrides.chat_history 必须是对象');
    if (chatHistory) {
      var chatAllowed = { with_depth_entries: 1, author_note: 1, prompts: 1 },
        chatExtra = Object.keys(chatHistory).filter(function (key) {
          return !chatAllowed[key];
        });
      if (chatExtra.length) throw new Error('overrides.chat_history 不支持配置项：' + chatExtra.join('、'));
      if (chatHistory.with_depth_entries != null && typeof chatHistory.with_depth_entries !== 'boolean')
        throw new Error('overrides.chat_history.with_depth_entries 必须是布尔值');
      if (chatHistory.author_note != null && typeof chatHistory.author_note !== 'string')
        throw new Error('overrides.chat_history.author_note 必须是字符串');
      if (chatHistory.prompts != null && !Array.isArray(chatHistory.prompts))
        throw new Error('overrides.chat_history.prompts 必须是数组');
    }
  }
  if (config.injects != null && !Array.isArray(config.injects)) throw new Error('injects 必须是数组');
  if (
    config.max_chat_history !== undefined &&
    config.max_chat_history !== 'all' &&
    !(
      typeof config.max_chat_history === 'number' &&
      Number.isFinite(config.max_chat_history) &&
      config.max_chat_history >= 0
    )
  )
    throw new Error("max_chat_history 只能是非负数字或 'all'");
  if (config.json_schema != null) {
    var schema = objectRecord(config.json_schema);
    if (!schema) throw new Error('json_schema 必须是对象');
    var schemaAllowed = { name: 1, description: 1, value: 1, strict: 1 },
      schemaExtra = Object.keys(schema).filter(function (key) {
        return !schemaAllowed[key];
      });
    if (schemaExtra.length) throw new Error('json_schema 不支持配置项：' + schemaExtra.join('、'));
    if (typeof schema.name !== 'string' || !schema.name.trim()) throw new Error('json_schema.name 必须是非空字符串');
    if (schema.description != null && typeof schema.description !== 'string')
      throw new Error('json_schema.description 必须是字符串');
    if (!objectRecord(schema.value)) throw new Error('json_schema.value 必须是对象');
    if (schema.strict != null && typeof schema.strict !== 'boolean') throw new Error('json_schema.strict 必须是布尔值');
  }
  return config;
}
function cardFrontendGenerationRole(value, label) {
  var row = objectRecord(value);
  if (!row) throw new Error(label + ' 必须是对象');
  var role = String(row.role || '');
  if (['system', 'assistant', 'user'].indexOf(role) < 0) throw new Error(label + ' 的 role 无效：' + role);
  return { role: role, content: String(row.content == null ? '' : row.content), image: row.image };
}
function cardFrontendGenerationOverrideCharacter(char, overrides) {
  var copy = cloneData(char),
    mapping = {
      char_description: 'description',
      char_personality: 'personality',
      scenario: 'scenario',
      dialogue_examples: 'mes_example',
    };
  Object.keys(mapping).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) copy[mapping[key]] = String(overrides[key] || '');
  });
  return copy;
}
function cardFrontendGenerationHistory(session, config) {
  var overrides = objectRecord(config.overrides) || {},
    historyOverride = objectRecord(overrides.chat_history) || {},
    rows;
  if (Object.prototype.hasOwnProperty.call(historyOverride, 'prompts')) {
    if (!Array.isArray(historyOverride.prompts)) throw new Error('overrides.chat_history.prompts 必须是数组');
    rows = historyOverride.prompts.map(function (row, index) {
      return cardFrontendGenerationRole(row, 'overrides.chat_history.prompts[' + index + ']');
    });
  } else
    rows = (session && Array.isArray(session.msgs) ? session.msgs : [])
      .filter(function (row) {
        return row && ['user', 'assistant'].includes(row.role);
      })
      .map(function (row) {
        return cloneData(row);
      });
  if (typeof config.max_chat_history === 'number') {
    // A limit of 0 keeps no history at all; slice(-0) would keep every row.
    var limit = Math.max(0, Math.floor(config.max_chat_history));
    rows = limit ? rows.slice(-limit) : [];
  } else if (config.max_chat_history !== undefined && config.max_chat_history !== 'all')
    throw new Error("max_chat_history 只能是数字或 'all'");
  return rows;
}
async function cardFrontendGenerationDataUrl(value) {
  if (typeof value === 'string') {
    var text = value.trim();
    return text || '';
  }
  if (!value || typeof value.arrayBuffer !== 'function')
    throw new Error('image 只接受 File、data URL、普通 URL 或它们的数组');
  var bytes = new Uint8Array(await value.arrayBuffer()),
    binary = '',
    chunk = 32768;
  for (var at = 0; at < bytes.length; at += chunk)
    binary += String.fromCharCode.apply(null, bytes.subarray(at, Math.min(bytes.length, at + chunk)));
  return 'data:' + String(value.type || 'application/octet-stream') + ';base64,' + btoa(binary);
}
async function cardFrontendGenerationImages(value) {
  var rows = value == null ? [] : Array.isArray(value) ? value : [value],
    out = [];
  for (var index = 0; index < rows.length; index++) {
    var url = await cardFrontendGenerationDataUrl(rows[index]);
    if (url) out.push(url);
  }
  return out;
}
function cardFrontendGenerationAttachImages(message, urls) {
  if (!message || !urls.length) return message;
  var content = Array.isArray(message.content)
    ? message.content.slice()
    : [{ type: 'text', text: String(message.content == null ? '' : message.content) }];
  message.content = content.concat(
    urls.map(function (url) {
      return { type: 'image_url', image_url: { url: url } };
    })
  );
  return message;
}
async function cardFrontendGenerationAttachPromptImages(messages, rows, label) {
  var used = new Set();
  for (var index = 0; index < rows.length; index++) {
    var row = rows[index],
      matchIndex = -1;
    for (var at = 0; at < messages.length; at++) {
      var candidate = messages[at];
      if (
        !used.has(at) &&
        candidate &&
        (row.key
          ? candidate._yeyuGenerationImageKey === row.key
          : candidate.role === row.role && candidate.content === row.content)
      ) {
        matchIndex = at;
        break;
      }
    }
    if (matchIndex < 0) throw new Error(label + '[' + row.index + '] 的 image 无法关联到出站消息');
    used.add(matchIndex);
    delete messages[matchIndex]._yeyuGenerationImageKey;
    cardFrontendGenerationAttachImages(messages[matchIndex], await cardFrontendGenerationImages(row.image));
  }
  return messages;
}
async function cardFrontendGenerationPrepareInjects(config) {
  var rows = Array.isArray(config.injects) ? config.injects : [],
    inChat = [],
    scan = [];
  for (var index = 0; index < rows.length; index++) {
    var row = objectRecord(rows[index]);
    if (!row) throw new Error('injects[' + index + '] 必须是对象');
    var allowed = { position: 1, depth: 1, role: 1, content: 1, filter: 1, should_scan: 1 },
      extra = Object.keys(row).filter(function (key) {
        return !allowed[key];
      });
    if (extra.length) throw new Error('injects[' + index + '] 不支持配置项：' + extra.join('、'));
    if (row.filter != null && typeof row.filter !== 'function')
      throw new Error('injects[' + index + '].filter 必须是函数');
    if (row.should_scan != null && typeof row.should_scan !== 'boolean')
      throw new Error('injects[' + index + '].should_scan 必须是布尔值');
    if (row.depth != null && !(typeof row.depth === 'number' && Number.isFinite(row.depth) && row.depth >= 0))
      throw new Error('injects[' + index + '].depth 必须是非负数字');
    var content = String(row.content == null ? '' : row.content);
    if (typeof row.filter === 'function' && (await row.filter()) === false) continue;
    var position = String(row.position || 'in_chat'),
      role = String(row.role || 'system');
    if (['system', 'assistant', 'user'].indexOf(role) < 0)
      throw new Error('injects[' + index + '] 的 role 无效：' + role);
    if (row.should_scan === true && content) scan.push(content);
    if (position === 'none') continue;
    if (position !== 'in_chat') throw new Error('injects[' + index + '] 的 position 无效：' + position);
    inChat.push({ role: role, content: content, depth: Math.max(0, Math.floor(Number(row.depth) || 0)), order: index });
  }
  return { inChat: inChat, scan: scan };
}
function cardFrontendGenerationInsertInjects(messages, rows) {
  var out = (Array.isArray(messages) ? messages : []).map(function (row) {
    var copy = { role: row.role, content: row.content, name: row.name };
    if (row._yeyuGenerationImageKey) copy._yeyuGenerationImageKey = String(row._yeyuGenerationImageKey);
    return copy;
  });
  (rows || [])
    .slice()
    .sort(function (a, b) {
      return b.depth - a.depth || a.order - b.order;
    })
    .forEach(function (row) {
      out.splice(Math.max(0, out.length - row.depth), 0, { role: row.role, content: row.content });
    });
  return out;
}
function cardFrontendGenerationRawPreset(config, userInput) {
  var base = completionPresetRawForGeneration('in_use'),
    definitions = [],
    order = [],
    markerIds = {
      world_info_before: 'worldInfoBefore',
      persona_description: 'personaDescription',
      char_description: 'charDescription',
      char_personality: 'charPersonality',
      scenario: 'scenario',
      world_info_after: 'worldInfoAfter',
      dialogue_examples: 'dialogueExamples',
      chat_history: 'chatHistory',
    },
    rows = Array.isArray(config.ordered_prompts) ? config.ordered_prompts : CARD_FRONTEND_BUILTIN_PROMPT_DEFAULT_ORDER,
    hasUser = false,
    hasHistory = false,
    images = [];
  rows.forEach(function (value, index) {
    if (typeof value === 'string') {
      var name = String(value),
        identifier = markerIds[name];
      if (name === 'user_input') {
        hasUser = true;
        identifier = 'yeyuRawUserInput';
        definitions.push({
          identifier: identifier,
          name: 'User input',
          role: 'user',
          content: userInput,
          system_prompt: false,
          marker: false,
          injection_position: 0,
          extra: config.image != null ? { yeyu_generation_image_key: 'input' } : undefined,
        });
        order.push({ identifier: identifier, enabled: true });
        return;
      }
      if (!identifier) throw new Error('ordered_prompts[' + index + '] 的占位符无效：' + name);
      if (name === 'chat_history') hasHistory = true;
      definitions.push({
        identifier: identifier,
        name: name,
        role: 'system',
        system_prompt: true,
        marker: true,
        injection_position: 0,
      });
      order.push({ identifier: identifier, enabled: true });
      return;
    }
    var prompt = cardFrontendGenerationRole(value, 'ordered_prompts[' + index + ']'),
      id = 'yeyuRawPrompt' + index,
      imageKey = prompt.image !== undefined ? 'raw:' + index : '';
    definitions.push({
      identifier: id,
      name: id,
      role: prompt.role,
      content: prompt.content,
      system_prompt: false,
      marker: false,
      injection_position: 0,
      extra: imageKey ? { yeyu_generation_image_key: imageKey } : undefined,
    });
    order.push({ identifier: id, enabled: true });
    if (prompt.image !== undefined)
      images.push({ index: index, key: imageKey, role: prompt.role, content: prompt.content, image: prompt.image });
  });
  base.prompts = definitions;
  base.prompt_order = [{ character_id: 100001, order: order }];
  return { raw: base, hasUser: hasUser, hasHistory: hasHistory, promptImages: images };
}
async function cardFrontendPresetGenerationMessages(char, session, target, config, controller, raw, requestOptions) {
  var overrides = objectRecord(config.overrides) || {},
    injects = await cardFrontendGenerationPrepareInjects(config),
    history = cardFrontendGenerationHistory(session, config),
    historyImages = [];
  history.forEach(function (row, index) {
    if (row && row.image !== undefined) {
      var key = 'history:' + index;
      row._yeyuGenerationImageKey = key;
      historyImages.push({ index: index, key: key, role: row.role, content: row.content, image: row.image });
    }
  });
  var user = String(config.user_input || ''),
    hasTopImage = config.image != null,
    rawPlan = null,
    appendUser = true;
  if (raw) {
    rawPlan = cardFrontendGenerationRawPreset(config, user);
    if (rawPlan.hasUser) appendUser = false;
    else if (rawPlan.hasHistory) appendUser = true;
  }
  if ((user || hasTopImage) && appendUser)
    history.push({
      role: 'user',
      content: user,
      time: Date.now(),
      _yeyuGenerationImageKey: hasTopImage ? 'input' : undefined,
    });
  var buildChar = cardFrontendGenerationOverrideCharacter(char, overrides),
    promptTemplateRun = await promptTemplatePrepareGeneration(char, session, target && target.messageIndex, {
      generationType: 'quiet',
      signal: controller.signal,
    }),
    buildOptions = {
      commit: false,
      generationTarget: target,
      signal: controller.signal,
      completionPresetRaw: rawPlan ? rawPlan.raw : completionPresetRawForGeneration(config.preset_name || 'in_use'),
      routeOverride: requestOptions && requestOptions.routeOverride,
      generationOverrides: overrides,
      worldBookScanPrompts: injects.scan,
      skipDataBank: true,
      promptTemplateRun: promptTemplateRun,
    };
  if (target) target.promptTemplateRun = promptTemplateRun;
  await stscriptRestorePromptFilters(char, session);
  buildOptions.scriptInjects = await hostPromptPrepare(char, session, controller.signal);
  if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
  await prepareVectorRetrievalForPrompt(buildChar, session, history, { signal: controller.signal });
  if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
  beginRegexScriptSendScope();
  await prepareRegexScriptsForPrompt(buildChar, history, buildOptions.generationTarget);
  regexScriptDrainSendMisses();
  await buildMessages(buildChar, history, session, Object.assign({}, buildOptions, { commit: false }));
  var textMisses = regexScriptDrainSendMisses();
  if (textMisses.length) await prepareRegexScriptTexts(buildChar, textMisses);
  worldBookRegexKeyMisses();
  while (true) {
    await buildMessages(buildChar, history, session, buildOptions);
    var misses = worldBookRegexKeyMisses();
    if (!misses.length) break;
    await prepareWorldBookRegexKeys(buildChar, misses, { signal: controller.signal });
    if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
  }
  var built = await buildMessages(buildChar, history, session, buildOptions),
    messages = cardFrontendGenerationInsertInjects(built.messages || [], injects.inChat);
  if (rawPlan && !rawPlan.hasUser && !rawPlan.hasHistory && (user || hasTopImage))
    messages.push({ role: 'user', content: user, _yeyuGenerationImageKey: hasTopImage ? 'input' : undefined });
  await cardFrontendGenerationAttachPromptImages(messages, historyImages, 'overrides.chat_history.prompts');
  if (hasTopImage)
    await cardFrontendGenerationAttachPromptImages(
      messages,
      [{ index: 0, key: 'input', role: 'user', content: user, image: config.image }],
      'image'
    );
  if (rawPlan) await cardFrontendGenerationAttachPromptImages(messages, rawPlan.promptImages, 'ordered_prompts');
  messages.forEach(function (row) {
    delete row._yeyuGenerationImageKey;
  });
  return messages;
}
async function generateQuietForCharacter(char, session, prompt, options) {
  options = options || {};
  if (!char || !session) throw new Error('静默生成需要角色和对话');
  var stscriptController = options.abortController,
    controller = options.controller && options.controller.signal ? options.controller : new AbortController(),
    abort = function () {
      if (!controller.signal.aborted) controller.abort();
    };
  if (stscriptController && stscriptController.signal && stscriptController.signal.aborted) abort();
  if (stscriptController && typeof stscriptController.onAbort === 'function') stscriptController.onAbort(abort);
  var target = {
      charId: String(char.id || ''),
      sessionId: String(session.id || ''),
      mode: 'quiet',
      messageIndex: Array.isArray(session.msgs) ? session.msgs.length - 1 : -1,
    },
    config = {
      user_input: String(prompt || ''),
      should_stream: false,
      should_silence: true,
      max_chat_history: options.maxChatHistory === undefined ? 'all' : options.maxChatHistory,
      overrides: options.overrides || {},
      injects: options.injects || [],
    };
  if (options.presetName) config.preset_name = String(options.presetName);
  var pendingError = null;
  try {
    var messages = await cardFrontendPresetGenerationMessages(
      char,
      session,
      target,
      config,
      controller,
      false,
      options
    );
    if (!messages.length) throw new Error('静默生成没有可发送的提示内容');
    messages = await promptTemplateProcessGenerationMessages(target.promptTemplateRun, messages);
    if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
    var requestOptions = {
      transient: true,
      nonStream: true,
      route: 'chat',
      controller: controller,
      maxTokens: Math.max(0, Math.floor(Number(options.maxTokens) || 0)),
    };
    if (options.routeOverride) requestOptions.routeOverride = Object.assign({}, options.routeOverride);
    if (Array.isArray(options.stop) && options.stop.length)
      requestOptions.requestBodyPatch = { stop: options.stop.map(String) };
    var result = await callDeepSeek(messages, target, requestOptions);
    if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
    return sanitizeGeneratedVisibleContent(String((result && result.content) || ''), { fromProvider: true });
  } catch (error) {
    pendingError = error;
    throw error;
  } finally {
    try {
      var transaction = target.promptTemplateRun && target.promptTemplateRun.transaction;
      if (transaction && !transaction.closed) {
        promptTemplateDeactivateInjections(transaction);
        await promptTemplateCommit(transaction);
      }
    } catch (cleanupError) {
      if (!pendingError) throw cleanupError;
      console.error('静默生成提示模板清理失败', cleanupError);
    } finally {
      hostPromptFinish(session);
      if (stscriptController && typeof stscriptController.offAbort === 'function') stscriptController.offAbort(abort);
    }
  }
}
function cardFrontendGenerationRequestOptions(config, presetRaw, controller, target, live, run) {
  var custom = config.custom_api == null ? null : objectRecord(config.custom_api);
  if (config.custom_api != null && !custom) throw new Error('custom_api 必须是对象');
  var route = Object.assign({}, resolveApiRoute('chat')),
    bodyPatch = {},
    bodyExclude = [],
    headers = {},
    proxyMatched = false;
  if (custom) {
    var allowed = {
        proxy_preset: 1,
        apiurl: 1,
        key: 1,
        model: 1,
        source: 1,
        max_tokens: 1,
        temperature: 1,
        frequency_penalty: 1,
        presence_penalty: 1,
        top_p: 1,
        top_k: 1,
        custom_include_body: 1,
        custom_exclude_body: 1,
        custom_include_headers: 1,
      },
      extra = Object.keys(custom).filter(function (key) {
        return !allowed[key];
      });
    if (extra.length) throw new Error('custom_api 不支持配置项：' + extra.join('、'));
    var source = String(custom.source || 'openai')
      .trim()
      .toLowerCase();
    if (['openai', 'custom', 'deepseek', 'openrouter', 'xai'].indexOf(source) < 0)
      throw new Error(
        'custom_api.source="' +
          source +
          '" 需要酒馆供应商专用转换；夜欲本地 OpenAI-compatible 传输只支持 openai、custom、deepseek、openrouter、xai'
      );
    if (custom.apiurl != null || (route.protocol === 'grok-subscription' && custom.key != null))
      route.protocol = 'openai';
    if (custom.apiurl != null) overrideApiRouteUrl(route, custom.apiurl);
    if (custom.key != null) route.apiKey = String(custom.key || '');
    if (custom.model != null) route.model = String(custom.model || '').trim();
    if (custom.proxy_preset != null) {
      var wanted = String(custom.proxy_preset).trim(),
        provider = (D.settings.providers || []).find(function (row) {
          return row && row.enabled !== false && String(row.name || '') === wanted;
        });
      if (provider) {
        if (provider.protocol && provider.protocol !== 'openai')
          throw new Error('custom_api 只支持 OpenAI-compatible；proxy_preset 指向了其他传输协议');
        proxyMatched = true;
        route = Object.assign({}, route, {
          providerId: provider.id,
          protocol: 'openai',
          name: provider.name,
          apiUrl: String(provider.apiUrl || '')
            .trim()
            .replace(/\/+$/, ''),
          apiKey: provider.protocol === 'grok-subscription' ? '' : String(provider.apiKey || ''),
          promptPostProcessing: normalizePromptPostProcessing(provider.promptPostProcessing),
        });
      }
    }
    if (custom.proxy_preset != null && !proxyMatched && route.protocol !== 'openai')
      throw new Error('custom_api 的 proxy_preset 未命中启用的 OpenAI-compatible 供应商，且未指定兼容接口地址');
    ['max_tokens', 'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k'].forEach(function (key) {
      var value = custom[key];
      if (value === undefined || value === 'same_as_preset') return;
      if (value === 'unset') {
        bodyExclude.push(key);
        return;
      }
      var number = Number(value);
      if (!Number.isFinite(number)) throw new Error('custom_api.' + key + ' 必须是数字、same_as_preset 或 unset');
      bodyPatch[key] = number;
    });
    if (custom.custom_include_body != null && !objectRecord(custom.custom_include_body))
      throw new Error('custom_include_body 必须是对象');
    Object.assign(bodyPatch, cloneData(custom.custom_include_body) || {});
    if (custom.custom_exclude_body != null && !Array.isArray(custom.custom_exclude_body))
      throw new Error('custom_exclude_body 必须是字符串数组');
    bodyExclude.push.apply(bodyExclude, (custom.custom_exclude_body || []).map(String));
    if (custom.custom_include_headers != null && !objectRecord(custom.custom_include_headers))
      throw new Error('custom_include_headers 必须是对象');
    headers = cloneData(custom.custom_include_headers) || {};
  }
  route.headers = Object.assign({}, route.headers || {}, headers);
  var schemaRequested = !!config.json_schema,
    capabilities = route.capabilities && typeof route.capabilities === 'object' ? route.capabilities : {};
  if (schemaRequested && capabilities.native_json_schema === false)
    throw new Error('当前供应商或模型已知不支持 JSON Schema；本次生成不会静默降级 response_format');
  var settings = presetRequestSettings('chat', presetRaw),
    previous = '',
    request = {
      route: 'chat',
      routeOverride: route,
      settingsOverride: settings,
      transient: true,
      silent: run.silent || run.nested,
      nonStream: config.should_stream !== true,
      allowEmptyContent: config.should_return_reasoning === true,
      controller: controller,
      allowEmptyApiKey: !!(
        custom &&
        (custom.apiurl != null || Object.prototype.hasOwnProperty.call(custom, 'key') || proxyMatched)
      ),
      requestBodyPatch: bodyPatch,
      requestBodyExclude: Array.from(new Set(bodyExclude)),
      jsonSchema: config.json_schema,
      noRetry: schemaRequested,
      onProgress:
        config.should_stream === true
          ? function (snapshot) {
              var full = String((snapshot && snapshot.content) || ''),
                increment = full.indexOf(previous) === 0 ? full.slice(previous.length) : full;
              previous = full;
              if (full)
                cardFrontendGenerationBroadcast(CARD_FRONTEND_IFRAME_EVENT_VALUES.STREAM_TOKEN_RECEIVED_FULLY, [
                  full,
                  run.id,
                ]);
              if (increment)
                cardFrontendGenerationBroadcast(CARD_FRONTEND_IFRAME_EVENT_VALUES.STREAM_TOKEN_RECEIVED_INCREMENTALLY, [
                  increment,
                  run.id,
                ]);
            }
          : null,
    };
  return request;
}
function cardFrontendGenerationUiStart(run) {
  if (run.nested || run.silent) return;
  if (!_cardFrontendGenerationUiOwned) {
    if (_generationState !== 'idle') throw new Error('当前普通对话正在生成，非静默卡片生成未启动');
    _cardFrontendGenerationUiOwned = true;
    setGenerationStatusLabel('卡片脚本正在生成');
    setGenerationState('preparing');
  }
  abortController = run.controller;
}
function cardFrontendGenerationUiFinish() {
  if (!_cardFrontendGenerationUiOwned) return;
  var active = Array.from(_cardFrontendGenerations.values()).some(function (row) {
    return !row.nested && !row.silent;
  });
  if (active) return;
  _cardFrontendGenerationUiOwned = false;
  abortController = null;
  setGenerationState('idle');
}
function cardFrontendGenerationStoppedEvent(run) {
  if (run && !run.stopNotified) {
    run.stopNotified = true;
    hostPromptFinish(generationSessionForTarget(run.target));
    Promise.resolve(
      cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_STOPPED, [run.id])
    ).catch(function () {});
  }
}
function stopCardFrontendGenerationRun(run) {
  if (!run || _cardFrontendGenerations.get(run.id) !== run) return false;
  _cardFrontendGenerations.delete(run.id);
  if (!run.controller.signal.aborted) run.controller.abort();
  cardFrontendGenerationStoppedEvent(run);
  cardFrontendGenerationUiFinish();
  noteCardEventGenerationSettled();
  return true;
}
function stopCardFrontendGenerationById(id) {
  return stopCardFrontendGenerationRun(_cardFrontendGenerations.get(String(id || '')));
}
function stopAllCardFrontendGenerations() {
  Array.from(_cardFrontendGenerations.values()).forEach(stopCardFrontendGenerationRun);
  return true;
}
function stopCardFrontendGenerationsForLive(live, onlyBound) {
  var stopped = false;
  Array.from(_cardFrontendGenerations.values()).forEach(function (run) {
    if (run.live === live && (!onlyBound || !run.silent)) stopped = stopCardFrontendGenerationRun(run) || stopped;
  });
  return stopped;
}
function cancelCardFrontendGeneration(live) {
  var stopped = false;
  Array.from(_cardFrontendGenerations.values()).forEach(function (run) {
    if (!live || run.live === live) {
      if (typeof CardFrontendGenerationCycle === 'object') CardFrontendGenerationCycle.stop(run.live);
      stopped = stopCardFrontendGenerationRun(run) || stopped;
    }
  });
  return stopped;
}
async function cardFrontendGetModelList(value) {
  var config = objectRecord(value) || {},
    extra = Object.keys(config).filter(function (key) {
      return !['apiurl', 'key'].includes(key);
    });
  if (extra.length) throw new Error('getModelList 不支持配置项：' + extra.join('、'));
  return fetchProviderModelIds({ apiUrl: String(config.apiurl || ''), apiKey: String(config.key || '') });
}
function cardFrontendGetProxyPresetNames() {
  ensureProviderSettings(D.settings);
  return (D.settings.providers || [])
    .filter(function (row) {
      return row && row.enabled !== false;
    })
    .map(function (row) {
      return String(row.name || '');
    });
}
async function executeCardFrontendGeneration(value, live, raw) {
  if (!live || !live.owner) throw new Error('卡片生成调用没有有效 owner');
  await completionPresetAwaitRuntime(live);
  if (typeof CardFrontendGenerationCycle === 'object' && CardFrontendGenerationCycle.stopped(live))
    throw cardFrontendGenerationAbortError('本轮脚本任务已由你停止');
  var intercept =
      typeof _cardScriptSendIntercept === 'object' &&
      _cardScriptSendIntercept &&
      !_cardScriptSendIntercept.closed &&
      _cardScriptSendIntercept.live === live
        ? _cardScriptSendIntercept
        : null,
    nested = !!intercept;
  if (nested && (intercept.cancelled || !cardScriptSendInterceptCurrent(intercept)))
    throw new Error('发送拦截运行实例或所属对话已变化');
  if (!nested && _qrRun) throw new Error('当前正在执行 STScript，本次生成未启动');
  var config = objectRecord(value) || {};
  config.generation_id = config.generation_id || 'yeyu_' + Date.now().toString(36) + '_' + ++_cardFrontendGenerationSeq;
  await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_IFRAME_EVENT_VALUES.GENERATION_REQUESTED, [
    config.generation_id,
    raw ? 'generateRaw' : 'generate',
    config,
  ]);
  cardFrontendGenerationConfig(config, raw);
  if (CardFrontendGenerationCycle.stopped(live)) throw cardFrontendGenerationAbortError();
  cardFrontendRequireCurrent(live);
  var char = cardFrontendCharacter(live),
    box = char && D.chats && D.chats[char.id],
    session =
      box && Array.isArray(box.sessions)
        ? box.sessions.find(function (row) {
            return row.id === String(live.owner.sessionId || '');
          })
        : null;
  if (!char || !session) throw new Error('卡片生成 owner 对应的角色或对话已不存在');
  var id = String(config.generation_id || 'yeyu_' + Date.now().toString(36) + '_' + ++_cardFrontendGenerationSeq);
  if (_cardFrontendGenerations.has(id))
    throw new Error("ID为 '" + id + "' 的请求正在进行中，请勿重复使用活动 generation_id");
  var link = cardFrontendGenerationController(nested && intercept.controller && intercept.controller.signal),
    controller = link.controller,
    target = { charId: String(char.id), sessionId: String(session.id), mode: 'card-frontend', generationId: id },
    run = {
      id: id,
      live: live,
      target: target,
      controller: controller,
      nested: nested,
      silent: config.should_silence === true,
      raw: raw === true,
      stopNotified: false,
    };
  if (controller.signal.aborted) {
    link.release();
    throw cardFrontendGenerationAbortError();
  }
  _cardFrontendGenerations.set(id, run);
  noteCardEventGenerationStarted();
  try {
    cardFrontendGenerationUiStart(run);
    if (!nested)
      await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_AFTER_COMMANDS,
        ['normal', {}, false],
        { signal: controller.signal }
      );
    var presetRaw = raw
        ? cardFrontendGenerationRawPreset(config, String(config.user_input || '')).raw
        : completionPresetRawForGeneration(config.preset_name || 'in_use'),
      requestOptions = cardFrontendGenerationRequestOptions(config, presetRaw, controller, target, live, run),
      messages = await cardFrontendGenerationWithPromptBuild(controller, function () {
        return cardFrontendPresetGenerationMessages(
          char,
          session,
          target,
          config,
          controller,
          raw === true,
          requestOptions
        );
      });
    if (!messages.length) throw new Error((raw ? 'generateRaw' : 'generate') + ' 没有可发送的提示内容');
    var promptEvent = await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_COMPLETION_PROMPT_READY,
        [{ chat: messages, dryRun: false }],
        { signal: controller.signal }
      ),
      promptPayload = promptEvent && promptEvent[0];
    if (promptPayload && Array.isArray(promptPayload.chat)) messages = promptPayload.chat;
    var data = generationAfterDataPayload(messages, { generation_id: id, stream: config.should_stream === true }),
      dataEvent = await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATE_AFTER_DATA,
        [data, false],
        { signal: controller.signal }
      );
    if (dataEvent && dataEvent[0] && Array.isArray(dataEvent[0].prompt)) messages = dataEvent[0].prompt;
    messages = await promptTemplateProcessGenerationMessages(target && target.promptTemplateRun, messages);
    if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
    cardFrontendGenerationBroadcast(CARD_FRONTEND_IFRAME_EVENT_VALUES.GENERATION_STARTED, [id]);
    requestOptions.beforeRequest = function (body) {
      return cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_COMPLETION_SETTINGS_READY, [body], {
        signal: controller.signal,
      });
    };
    if (!run.nested && !run.silent) setGenerationState('streaming');
    var result = await callDeepSeek(messages, target, requestOptions);
    if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
    var response = String((result && result.content) || '');
    hostPromptFinish(session);
    cardFrontendGenerationBroadcast(CARD_FRONTEND_IFRAME_EVENT_VALUES.GENERATION_ENDED, [
      response,
      id,
      result.reasoning || undefined,
    ]);
    if (!config.should_return_reasoning) return response;
    var detailed = { content: response };
    if (result.reasoning) detailed.reasoning = result.reasoning;
    if (result.reasoning_signature) detailed.reasoning_signature = result.reasoning_signature;
    return detailed;
  } catch (error) {
    if (controller.signal.aborted) {
      cardFrontendGenerationStoppedEvent(run);
      throw cardFrontendGenerationAbortError();
    }
    throw error;
  } finally {
    if (_cardFrontendGenerations.get(id) === run) _cardFrontendGenerations.delete(id);
    link.release();
    cardFrontendGenerationUiFinish();
    noteCardEventGenerationSettled();
  }
}
