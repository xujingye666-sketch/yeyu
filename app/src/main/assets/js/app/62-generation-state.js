// ===== Generation state and controls =====
let abortController = null,
  _generationState = 'idle',
  _activeViewportState = null,
  _generationStatusLabel = '正在生成',
  _streamPaintEpoch = 0,
  _activeStreamRepaint = null,
  _activeStreamTarget = null,
  _generationActiveSince = 0,
  _generationStallSeconds = 0;
// 流式回复这么久没收到新数据就在状态条提示可以停止；只提示不中断：可能是连接半开，也可能是模型还在思考。
const GENERATION_STALL_NOTICE_MS = 60000;
let generationTarget = null;
let _generationTargetOwnership = new WeakMap();
var _generationEpochCounter = 0,
  _generationSessionEpochs = new WeakMap(),
  _generationFinishedEpochs = new WeakMap();
// Allocate only after the preceding writeback queue drained. While preparing waits,
// that older queue still owns its epoch and may finish its legitimate writes.
function activateGenerationEpoch(target, session) {
  if (!target.epoch || _generationFinishedEpochs.get(session) === target.epoch) {
    speechGenerationStarted(target);
    target.epoch = ++_generationEpochCounter;
    target.quickReplyPreventAuto = !!_qrPreventAuto[_qrPreventAuto.length - 1];
    delete target.presetAfterAiQueued;
    delete target.postCommitWarningShown;
    delete target.postCommitTask;
    delete target.cardScriptLibraryCommittedMessageIndex;
  }
  _generationSessionEpochs.set(session, target.epoch);
  return target.epoch;
}
function generationTargetStillLive(target, session, signal) {
  return !!(
    target &&
    session &&
    generationSessionForTarget(target) === session &&
    D.currentCharId === target.charId &&
    getActiveSession(target.charId) === session &&
    _generationSessionEpochs.get(session) === target.epoch &&
    !(signal && signal.aborted)
  );
}
// 生成目标（或带 charId 的草稿）所属的角色；已被删除时为 null。
function generationTargetCharacter(target) {
  return (
    (target &&
      D.characters.find(function (c) {
        return c.id === target.charId;
      })) ||
    null
  );
}
function generationSessionForTarget(target) {
  var box = target && typeof D === 'object' && D && D.chats && D.chats[target.charId];
  return box && Array.isArray(box.sessions)
    ? box.sessions.find(function (sess) {
        return sess && sess.id === target.sessionId;
      })
    : null;
}
// 重新生成、新候选与续写瞄准的是一条助手消息，身份是它的 seq。生成期间卡片脚本和 Risu 触发器可以插入、
// 删除消息，入口时的下标随时会指向别的消息，所以每一步都按 seq 重新定位，并把当前下标写回 messageIndex。
function generationTargetMessageIndex(target, session) {
  var seq = Number(target && target.messageSeq) || 0,
    msgs = session && Array.isArray(session.msgs) ? session.msgs : [],
    index = seq
      ? msgs.findIndex(function (message) {
          return Number(message && message.seq) === seq;
        })
      : -1;
  if (index < 0 || msgs[index].role !== 'assistant') return -1;
  target.messageIndex = index;
  return index;
}
function resolveGenerationTargetMessage(target, session) {
  var index = generationTargetMessageIndex(target, session);
  if (index < 0)
    throw new Error(target && target.mode === 'continue' ? '待继续的回复已不存在' : '待生成候选的回复已不存在');
  return session.msgs[index];
}
// 数据库读取失败时界面只是只读展示本地快照，任何写入都会在排空时被拒绝；生成必须在开始前挡住，
// 否则回复要等到保存阶段才回滚。
function blockGenerationDuringStorageReadOnly() {
  if (!_storageHealth.readOnlyFallback) return false;
  toast('数据库未能读取，当前只读展示本地恢复快照；请先在顶部横幅确认恢复写入', 'err');
  return true;
}
function bindGenerationTargetOwnership(target, sess) {
  if (!target || typeof target !== 'object') return target;
  var existing = _generationTargetOwnership.get(target);
  if (existing) return target;
  sess = sess || generationSessionForTarget(target);
  if (!sess) return target;
  _generationTargetOwnership.set(target, { session: sess });
  return target;
}
function inheritGenerationTargetOwnership(target, parent) {
  if (!target || !parent) return target;
  var owner = _generationTargetOwnership.get(parent);
  if (owner) _generationTargetOwnership.set(target, owner);
  target.epoch = parent.epoch;
  return target;
}
function generationTargetOwnershipError() {
  var error = new Error('对话已切换，旧生成结果未保存');
  error.name = 'AbortError';
  error.code = 'generation_session_replaced';
  return error;
}
// Script writeback may rebuild or edit chat messages within the same generation.
// Only a different live session retires that run.
function assertGenerationTargetOwnership(target, sess) {
  bindGenerationTargetOwnership(target, sess);
  var owner = _generationTargetOwnership.get(target),
    currentSession = generationSessionForTarget(target);
  if (!owner || !currentSession || owner.session !== currentSession || (sess && sess !== currentSession))
    throw generationTargetOwnershipError();
  return currentSession;
}
function beginGenerationSessionOperation(target, sess) {
  assertGenerationTargetOwnership(target, sess);
  return function () {};
}
function beginGenerationSessionCommit(target, sess) {
  assertGenerationTargetOwnership(target, sess);
  if (!target.epoch) activateGenerationEpoch(target, sess);
  var controller = new AbortController(),
    release = registerTransientRequestController(controller);
  target.commitWaitController = controller;
  return function () {
    release();
    if (target.commitWaitController === controller) delete target.commitWaitController;
  };
}
function setGenerationStatusLabel(text) {
  _generationStatusLabel = text || '正在生成';
  var el = $('generation-status-text');
  if (el) el.textContent = _generationState === 'idle' ? '' : _generationStatusLabel;
}
function generationStatusText() {
  if (_generationState === 'idle') return '';
  if (_generationState === 'stopping') return '正在停止';
  if (_generationState === 'committing') return '正在保存回复';
  return _generationStallSeconds ? '已 ' + _generationStallSeconds + ' 秒没收到数据，可点停止' : _generationStatusLabel;
}
// 流式读取记下的空闲时长；只在 streaming 状态下显示，状态一变就收起。
function noteGenerationStall(idleMs) {
  var seconds =
    _generationState === 'streaming' && idleMs >= GENERATION_STALL_NOTICE_MS ? Math.floor(idleMs / 1000) : 0;
  if (seconds === _generationStallSeconds) return;
  _generationStallSeconds = seconds;
  var el = $('generation-status-text');
  if (el) el.textContent = generationStatusText();
  syncGenerationStatusBar();
}
// 保存阶段只有登记在册的临时请求可以释放，所以按钮在有可释放项时保持可用，其余时候禁用，
// 避免给出点了没有任何效果的停止入口。
function renderComposerActionButton() {
  var btn = $('composer-action-btn');
  if (!btn) return;
  var active = _generationState !== 'idle' || transientRequestsReleasable(),
    stopping = _generationState === 'stopping',
    committing = _generationState === 'committing',
    releasable = committing && transientRequestsReleasable();
  btn.classList.toggle('stop-mode', active && (!committing || releasable));
  btn.classList.toggle('primary', !active);
  btn.classList.toggle('danger', active && (!committing || releasable));
  // 发送与停止是同一个圆钮换图标；少见的过渡态才展开成带字的胶囊，免得只剩一个看不懂的图标。
  var label = committing ? (releasable ? '停止整理' : '正在保存') : stopping ? '正在停止' : '';
  btn.classList.toggle('has-label', !!label);
  btn.innerHTML =
    uiIcon(committing && !releasable ? 'check' : active ? 'stop' : 'arrow-up') +
    (label ? '<span>' + label + '</span>' : '');
  btn.disabled = stopping || (committing && !releasable);
  btn.setAttribute(
    'aria-label',
    committing ? (releasable ? '停止正在整理的后台请求' : '正在保存回复') : active ? '停止当前处理' : '发送消息'
  );
}
// Generations that dispatch card events or let the host write for card scripts: the interactive one (unless it
// entered as a helper request such as translation), card-frontend generate calls including silent ones, and the
// active chat's post-commit tails that report the reply and GENERATION_ENDED. The round preview's dry run intercepts
// card writes per instance, so it must never overlap them: it waits while this holds and catches up when the last one
// settles.
var _generationDispatchesCardEvents = false;
function cardEventGenerationActive() {
  if (_generationState !== 'idle' && _generationDispatchesCardEvents) return true;
  if (_cardFrontendGenerations.size) return true;
  var char = getChar(),
    session = char ? getActiveSession(char.id) : null;
  return !!(session && generationCardEventTailPending(session));
}
// A generation announces itself to card scripts only after the preview's dry run has let go of them.
function noteCardEventGenerationStarted() {
  cancelPresetRoundPreviewBuild();
}
function noteCardEventGenerationSettled() {
  if (!cardEventGenerationActive()) resumePresetRoundPreview();
}
// `options.helper` marks a request that never reaches card scripts (translation), so it holds nothing off.
function setGenerationState(state, options) {
  if (state === 'preparing') cancelExpressionClassification();
  var previous = _generationState,
    settledCardEvents = false;
  _generationState = state || 'idle';
  _generationStallSeconds = 0;
  var active = _generationState !== 'idle';
  if (active && !_generationStatusLabel) _generationStatusLabel = '正在生成';
  if (!active) _generationStatusLabel = '';
  if (previous === 'idle' && active) _generationActiveSince = Date.now();
  if (previous === 'idle' && active && isNearChatBottom($('chat-messages')))
    adoptChatViewportFollow('generation-start');
  if (!active && previous !== 'idle' && getChatViewportState().mode === 'follow')
    adoptChatViewportReading('generation-end', captureChatReadingAnchor(true));
  if (previous === 'idle' && _generationState === 'preparing') abortController = new AbortController();
  if (previous === 'idle' && active) {
    _generationDispatchesCardEvents = !(options && options.helper);
    if (_generationDispatchesCardEvents) noteCardEventGenerationStarted();
  } else if (!active && previous !== 'idle') {
    settledCardEvents = _generationDispatchesCardEvents;
    _generationDispatchesCardEvents = false;
  }
  document.body.classList.toggle('generation-active', active);
  renderComposerActionButton();
  var status = $('generation-status-text');
  if (status) status.textContent = generationStatusText();
  syncGenerationStatusBar();
  noteGenerationStateForStreamIndicator(_generationState);
  $('user-input').disabled = active;
  syncBranchReturnUndoButtons();
  syncChatHeaderTyping();
  if (settledCardEvents) noteCardEventGenerationSettled();
}
// 输入区上方的状态条只在聊天里看不出正在生成时才出现：主对话回复已经有底部指示行或正在吐字的
// 气泡，再挂一句「正在生成」是同一件事说两遍；翻译、摘要这类后台任务在聊天里没有落点，仍要它。
// 流式长时间没有新数据时聊天里看不出来，提示也走它。
function syncGenerationStatusBar() {
  var bar = $('typing');
  if (!bar) return;
  var active = _generationState !== 'idle' && _generationState !== 'stopping' && _generationState !== 'committing',
    shownInChat = chatShowsGenerationInline();
  bar.classList.toggle('show', active && (!shownInChat || _generationStallSeconds > 0));
}
// Transient and structured requests (memory summary, auxiliary tasks) own their own controllers,
// so the single global one cannot release them; keep them here so a stop can reach them.
var _transientRequestControllers = new Map();
function generationWorkPending() {
  return (
    _generationState !== 'idle' ||
    transientRequestsReleasable() ||
    _messageImageRuns.size > 0 ||
    !!_qrRun ||
    _risuExecutions.size > 0
  );
}
function transientRequestsReleasable() {
  return !!(_transientRequestControllers && _transientRequestControllers.size);
}
function registerTransientRequestController(controller) {
  if (!controller || !controller.signal) return null;
  _transientRequestControllers.set(controller, (_transientRequestControllers.get(controller) || 0) + 1);
  var released = false;
  renderComposerActionButton();
  return function () {
    if (released) return;
    released = true;
    var count = _transientRequestControllers.get(controller) || 0;
    if (count > 1) _transientRequestControllers.set(controller, count - 1);
    else _transientRequestControllers.delete(controller);
    renderComposerActionButton();
  };
}
function abortTransientRequestControllers() {
  var aborted = 0;
  Array.from(_transientRequestControllers.keys()).forEach(function (controller) {
    _transientRequestControllers.delete(controller);
    if (!controller || !controller.signal || controller.signal.aborted) return;
    aborted++;
    try {
      controller.abort();
    } catch (_) {}
  });
  renderComposerActionButton();
  return aborted;
}
// The state flips to preparing synchronously inside sendMessage, so the second tap of a double tap
// on 发送 already sees 停止; ignore stop taps that land right after generation started.
function generationStopTapGuardMs() {
  return 400;
}
function handleComposerAction() {
  if (_qrRun || _generationState !== 'idle' || transientRequestsReleasable()) {
    if (_generationState !== 'idle' && Date.now() - _generationActiveSince < generationStopTapGuardMs()) return;
    if (_qrRun) stopStscriptRun();
    stopGeneration();
    return;
  }
  sendMessage();
}
// `silent` is for a call that already identified itself as a script whose run is gone: it is refused
// like any other, but nobody is at the screen waiting for it, so only the return value reports it.
function blockDuringGeneration(action, silent) {
  if (_generationState === 'idle') return false;
  if (!silent) toast('正在生成内容，请先停止再' + (action || '操作'), 'info');
  return true;
}

function stopGeneration() {
  cancelRisuExecutions();
  cancelExpressionClassification();
  if (_qrAbort) _qrAbort.abort('已由你停止', false);
  if (_generationState === 'idle' || _generationState === 'stopping') {
    // A repeated stop is the fallback for a main request the first stop could not reach.
    var pendingController = _generationState === 'stopping' ? abortController : null;
    abortTransientRequestControllers();
    cancelCardFrontendGeneration();
    if (pendingController && !pendingController.signal.aborted) pendingController.abort();
    return;
  }
  // Committing awaits transient helper requests; a provider that never answers one would otherwise
  // pin the composer on 正在保存回复 with no way out, so a stop has to release them here.
  if (_generationState === 'committing') {
    abortTransientRequestControllers();
    return;
  }
  ++_streamPaintEpoch;
  setGenerationState('stopping');
  cardFrontendBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_STOPPED, []);
  presetTaskCall('onGenerationStopped');
  flushStreamDrafts('user_cancelled');
  cardScriptSendInterceptHostStop();
  // Silent and nested card runs never take over abortController, so stopping them says nothing about
  // the main request; a card run that does own the UI clears abortController while it is cancelled,
  // hence the reference is taken first.
  var mainController = abortController;
  cancelCardFrontendGeneration();
  if (mainController && !mainController.signal.aborted) mainController.abort();
  abortTransientRequestControllers();
  var target = generationTarget,
    char = generationTargetCharacter(target) || getChar(),
    session = target && char && char.id === target.charId ? generationSessionForTarget(target) : null;
  if (!session && char) session = getActiveSession(char.id);
  if (char) stopMvuRuntime(char, session);
  clearStreamCursors();
  const el = document.getElementById('stream-msg');
  if (el) el.remove();
}
