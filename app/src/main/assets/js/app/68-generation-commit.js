// ===== Streaming viewport and formal message commit =====
var WORLD_BOOK_MESSAGE_DETAIL_LIMIT = 120;
function compactWorldBookMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  function metricCount(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  }
  function metricText(value, limit) {
    return String(value == null ? '' : value).slice(0, limit);
  }
  var latest = {},
    order = [];
  (Array.isArray(metrics.details) ? metrics.details : []).forEach(function (detail, index) {
    if (!detail || typeof detail !== 'object') return;
    var key = metricText(detail.runtimeKey || detail.id || detail.name || 'row_' + index, 160);
    if (!Object.prototype.hasOwnProperty.call(latest, key)) order.push(key);
    latest[key] = {
      runtimeKey: metricText(detail.runtimeKey, 160),
      id: metricText(detail.id, 160),
      name: metricText(detail.name, 160),
      status: metricText(detail.status, 64),
      reason: metricText(detail.reason, 240),
    };
  });
  return {
    matched: metricCount(metrics.matched),
    activated: metricCount(metrics.activated),
    injected: metricCount(metrics.injected),
    dropped: metricCount(metrics.dropped),
    tokens: metricCount(metrics.tokens),
    details: order.slice(0, WORLD_BOOK_MESSAGE_DETAIL_LIMIT).map(function (key) {
      return latest[key];
    }),
  };
}
function isNearChatBottom(ct) {
  return !!ct && ct.scrollHeight - ct.scrollTop - ct.clientHeight < 36;
}
var VIEWPORT_INTENT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'mousedown', 'keydown'];
var _chatViewportOwner = {
  epoch: 1,
  mode: 'reading',
  reason: 'init',
  charId: null,
  sessionId: null,
  contextId: 1,
  renderId: 0,
  anchor: null,
};
var currentChatViewportIdentity = function () {
  var char = getChar(),
    sess = char ? getActiveSession(char.id) : null;
  return { charId: (char && char.id) || null, sessionId: (sess && sess.id) || null };
};
function isChatViewportScrollIntent(event) {
  return (
    !!event &&
    (event.type === 'wheel' ||
      event.type === 'touchmove' ||
      (event.type === 'keydown' && /^(Arrow|Page|Home|End| )/.test(event.key || '')))
  );
}
var chatViewportTargetVisible = function (target) {
  var id = currentChatViewportIdentity();
  return (
    !!target &&
    target.charId === id.charId &&
    target.sessionId === id.sessionId &&
    (target.viewportContextId == null || target.viewportContextId === _chatViewportOwner.contextId)
  );
};
var syncChatViewportOwnerIdentity = function () {
  var id = currentChatViewportIdentity();
  if (_chatViewportOwner.charId !== id.charId || _chatViewportOwner.sessionId !== id.sessionId) {
    _chatViewportOwner.contextId++;
    // Unread content belongs to the conversation it arrived in.
    clearChatNewContentMark();
  }
  _chatViewportOwner.charId = id.charId;
  _chatViewportOwner.sessionId = id.sessionId;
  return id;
};
var captureChatViewportTask = function (ct) {
  var id = currentChatViewportIdentity();
  return {
    epoch: _chatViewportOwner.epoch,
    renderId: _chatViewportOwner.renderId,
    charId: id.charId,
    sessionId: id.sessionId,
    ct: ct || null,
  };
};
var chatViewportTaskMatches = function (task) {
  var id = currentChatViewportIdentity();
  return (
    !!task &&
    task.epoch === _chatViewportOwner.epoch &&
    task.renderId === _chatViewportOwner.renderId &&
    task.charId === id.charId &&
    task.sessionId === id.sessionId &&
    (!task.ct || task.ct === document.getElementById('chat-messages'))
  );
};
var _chatViewportWrittenTop = null;
// The chat is following its bottom for as long as this holds a session; see the bottom-follow block
// below `settleViewportAfterMedia`.
var _chatBottomFollow = null;
var writeChatViewportTop = function (ct, top) {
  if (!ct) return;
  if (_activeViewportState && _activeViewportState.ct === ct) _activeViewportState.writtenTop = top;
  ct.scrollTop = top;
  _chatViewportWrittenTop = ct.scrollTop;
  // Every scroll this application performs on the chat goes through here, which is what lets the
  // bottom follow tell its own corrections apart from the reader moving the list.
  chatBottomFollowNotePosition(_chatBottomFollow, ct);
};
var syncActiveViewportOwner = function () {
  _boundChatViewportIntent = false;
  if (!_activeViewportState || _activeViewportState.released) return;
  if (
    _activeViewportState.charId !== _chatViewportOwner.charId ||
    _activeViewportState.sessionId !== _chatViewportOwner.sessionId
  ) {
    releaseViewportState(_activeViewportState);
    _activeViewportState = null;
    return;
  }
  _activeViewportState.followBottom = _chatViewportOwner.mode === 'follow';
  _activeViewportState.epoch = _chatViewportOwner.epoch;
  _activeViewportState.writtenTop = -1;
};
function getChatViewportState() {
  return {
    mode: _chatViewportOwner.mode,
    reason: _chatViewportOwner.reason,
    epoch: _chatViewportOwner.epoch,
    renderId: _chatViewportOwner.renderId,
    contextId: _chatViewportOwner.contextId,
    charId: _chatViewportOwner.charId,
    sessionId: _chatViewportOwner.sessionId,
    follow: _chatViewportOwner.mode === 'follow',
    anchor: _chatViewportOwner.anchor,
  };
}
var retainChatViewportRender = function () {
  _chatViewportOwner.epoch += 1;
  _chatViewportOwner.renderId += 1;
  syncChatViewportOwnerIdentity();
  syncActiveViewportOwner();
  // A redraw rebuilds the list and puts back the position it sampled before rebuilding; while the
  // chat is following its bottom that sample must not become the new reading position.
  chatBottomFollowRepin();
  return _chatViewportOwner.epoch;
};
var rememberChatViewportAnchor = function (anchor) {
  if (_chatViewportOwner.mode === 'reading') _chatViewportOwner.anchor = anchor || null;
  return _chatViewportOwner.anchor;
};
function adoptChatViewportFollow(reason) {
  // Following the bottom means nothing below can stay unread.
  clearChatNewContentMark();
  _chatViewportOwner.epoch += 1;
  _chatViewportOwner.renderId += 1;
  if (_chatViewportOwner.mode !== 'follow') {
    _chatViewportOwner.mode = 'follow';
    _chatViewportOwner.reason = reason || 'follow';
  } else if (reason) _chatViewportOwner.reason = reason;
  _chatViewportOwner.anchor = null;
  syncChatViewportOwnerIdentity();
  syncActiveViewportOwner();
  return _chatViewportOwner.epoch;
}
function adoptChatViewportReading(reason, anchor) {
  // Taking a reading position is the reader (or a navigation they asked for) claiming the viewport,
  // which ends any bottom follow. The one exception is the generation handing the viewport back when
  // it finishes: the reply is committed but the card frontends under it are still being started one
  // by one, and staying on the newest message through that is the whole point of the follow.
  if (CHAT_BOTTOM_FOLLOW_KEEP_REASONS.indexOf(reason) < 0) stopChatBottomFollow();
  _chatViewportOwner.epoch += 1;
  _chatViewportOwner.renderId += 1;
  if (_chatViewportOwner.mode !== 'reading') {
    _chatViewportOwner.mode = 'reading';
    _chatViewportOwner.reason = reason || 'reading';
  } else if (reason) _chatViewportOwner.reason = reason;
  _chatViewportOwner.anchor = anchor || null;
  syncChatViewportOwnerIdentity();
  syncActiveViewportOwner();
  // "The newest message" is itself a reading position — it is what opening a chat with no saved
  // position adopts. Holding it is the same job as following the bottom after a reply, so the same
  // state takes it: otherwise entering a long chat from the session or character list would be left
  // to each card frontend's own compensation, which is what drifted 5294px in the first place.
  if (anchor && anchor.bottom === true) startChatBottomFollow(document.getElementById('chat-messages'));
  return _chatViewportOwner.epoch;
}
// A drag fires scroll and touchmove many times between two paints, and every anchor sample measures the
// rows above the viewport. The reader takes the viewport on the event itself — the epoch moves at once,
// so no older task can put a position back under the finger — while where they stand is sampled once,
// in the next frame. While the list moves the sample stops at card frames' boxes; anything that later
// restores a position samples it again itself.
var _chatGestureSample = { frame: 0, epoch: 0, moving: false };
function sampleChatViewportAnchorLater(moving) {
  _chatGestureSample.epoch = _chatViewportOwner.epoch;
  if (moving) _chatGestureSample.moving = true;
  if (_chatGestureSample.frame) return;
  var sample = function () {
    var outsideFrames = _chatGestureSample.moving;
    _chatGestureSample.frame = 0;
    _chatGestureSample.moving = false;
    // Anything that claimed the viewport since then (a navigation, a redraw) brought its own anchor.
    if (_chatGestureSample.epoch === _chatViewportOwner.epoch)
      rememberChatViewportAnchor(captureChatReadingAnchor(true, outsideFrames));
  };
  if (typeof requestAnimationFrame === 'function') _chatGestureSample.frame = requestAnimationFrame(sample);
  else sample();
}
function adoptChatViewportGesture(reason, moving) {
  adoptChatViewportReading(reason, null);
  sampleChatViewportAnchorLater(moving);
}
// Reader gestures sample in the next frame; the programmatic entries that pass no event keep their
// immediate, exact sample.
function adoptChatViewportIntent(event) {
  if (event) adoptChatViewportGesture('user-intent', isChatViewportScrollIntent(event));
  else adoptChatViewportReading('user-intent', captureChatReadingAnchor(true));
}
function ensureViewportState(target, ct, state) {
  state = state || {};
  if (!ct || state.initialized) return state;
  var id = currentChatViewportIdentity();
  state.initialized = true;
  state.ct = ct;
  state.followBottom = _chatViewportOwner.mode === 'follow';
  state.scrollTop = ct.scrollTop;
  state.writtenTop = -1;
  state.userIntent = false;
  state.userScrolls = 0;
  state.epoch = _chatViewportOwner.epoch;
  state.charId = (target && target.charId) || id.charId;
  state.sessionId = (target && target.sessionId) || id.sessionId;
  _activeViewportState = state;
  state.onScroll = function () {
    if (state.released || _activeViewportState !== state) return;
    var top = ct.scrollTop;
    state.scrollTop = top;
    if (state.writtenTop >= 0 && Math.abs(top - state.writtenTop) <= 1) return;
    state.writtenTop = -1;
    if (!state.userIntent) return;
    state.userScrolls++;
    if (_generationState !== 'idle' && isNearChatBottom(ct)) {
      if (_chatViewportOwner.mode !== 'follow') adoptChatViewportFollow('user-scroll-bottom');
      state.followBottom = true;
      return;
    }
    adoptChatViewportGesture('user-scroll', true);
    state.followBottom = false;
  };
  state.onIntent = function (event) {
    state.userIntent = isChatViewportScrollIntent(event);
    state.writtenTop = -1;
    adoptChatViewportIntent(event);
    state.followBottom = false;
  };
  ct.addEventListener('scroll', state.onScroll, { passive: true });
  VIEWPORT_INTENT_EVENTS.forEach(function (name) {
    ct.addEventListener(name, state.onIntent, { passive: true });
  });
  return state;
}
var _boundChatViewportHost = null,
  _boundChatViewportIntent = false,
  // Counts gestures that actually move this list: a wheel, a finger drag or a navigation key. The
  // programmatic entries that call noteChatViewportUserIntent() with no event are not gestures, so
  // features that must wait for the reader (loading earlier history) can tell the two apart.
  _chatViewportUserScrolls = 0;
function chatViewportUserScrollCount() {
  return _chatViewportUserScrolls;
}
var onBoundChatViewportIntent = function (event) {
  // Every reader gesture and every explicit navigation entry comes through here, and each of them
  // takes the viewport back at once — the ones that still want the bottom re-arm it right after.
  stopChatBottomFollow();
  if (isChatViewportScrollIntent(event)) _chatViewportUserScrolls++;
  if (_activeViewportState && _activeViewportState.onIntent) _activeViewportState.onIntent(event);
  else adoptChatViewportIntent(event);
  _boundChatViewportIntent = isChatViewportScrollIntent(event);
};
var onBoundChatViewportScroll = function () {
  var ct = _boundChatViewportHost;
  if (!ct) return;
  if (_activeViewportState && !_activeViewportState.released) return;
  if (_chatViewportWrittenTop !== null && Math.abs(ct.scrollTop - _chatViewportWrittenTop) < 1) {
    _chatViewportWrittenTop = null;
    sampleChatViewportAnchorLater(true);
    return;
  }
  _chatViewportWrittenTop = null;
  if (!_boundChatViewportIntent) return;
  if (_boundChatViewportIntent && _generationState !== 'idle' && isNearChatBottom(ct)) {
    adoptChatViewportFollow('user-scroll-bottom');
    followChatBottomThroughMedia(ct, ct);
    return;
  }
  adoptChatViewportGesture('user-scroll', true);
};
// The handler above stands down whenever a generation owns the viewport, which is exactly when the
// badge is on screen, so reaching the bottom again is watched separately.
var onChatNewContentScroll = function () {
  var ct = _boundChatViewportHost;
  if (!ct) return;
  if (isNearChatBottom(ct)) clearChatNewContentMark();
  else renderChatNewContentBadge();
};
var bindChatViewportHost = function (ct) {
  if (!ct || _boundChatViewportHost === ct) return;
  if (_boundChatViewportHost) {
    _boundChatViewportHost.removeEventListener('scroll', onBoundChatViewportScroll);
    _boundChatViewportHost.removeEventListener('scroll', onChatNewContentScroll);
    VIEWPORT_INTENT_EVENTS.forEach(function (name) {
      _boundChatViewportHost.removeEventListener(name, onBoundChatViewportIntent);
    });
  }
  _boundChatViewportHost = ct;
  _boundChatViewportIntent = false;
  ct.addEventListener('scroll', onChatNewContentScroll, { passive: true });
  ct.addEventListener('scroll', onBoundChatViewportScroll, { passive: true });
  VIEWPORT_INTENT_EVENTS.forEach(function (name) {
    ct.addEventListener(name, onBoundChatViewportIntent, { passive: true });
  });
};
function noteChatViewportUserIntent(event) {
  onBoundChatViewportIntent(event);
}
// Sitting on the newest message is a reading position of its own: a row anchor would hold the row at
// the top of the screen instead and let a card that grows underneath push the newest message out of
// sight, which is what "opened the chat and it is not at the bottom" looks like.
function captureChatViewportLayout() {
  var ct = document.getElementById('chat-messages');
  if (!ct) return null;
  return {
    task: captureChatViewportTask(ct),
    ct: ct,
    follow: _chatViewportOwner.mode === 'follow',
    atBottom: isNearChatBottom(ct),
    anchor: captureChatReadingAnchor(true),
  };
}
// Where a block stands in the visible list, sampled before it changes height. `top` says whether the
// reader can see where the block begins; `bottom` is what everything under the block sits on.
function captureChatViewportBlock(node) {
  var ct = document.getElementById('chat-messages');
  if (!ct || !node || !node.isConnected || !node.getBoundingClientRect) return null;
  var host = ct.getBoundingClientRect(),
    box = node.getBoundingClientRect();
  return { task: captureChatViewportTask(ct), node: node, top: box.top - host.top, bottom: box.bottom - host.top };
}
// A block that finishes rendering while it begins above the visible area must not push what the
// reader is looking at. A row anchor cannot say that: the row the viewport starts in is usually the
// growing block itself, and holding its top in place is exactly what moves every line below it. What
// the rows below sit on is the block's bottom edge, so the scroll position is moved by however far
// that edge travelled — nothing when the browser's own scroll anchoring already absorbed the change,
// the full height difference when it did not. A block whose start is on screen is left to grow
// downwards: the reader can see that one arriving.
// A live bottom follow outranks either snapshot below: a snapshot only knows where the chat stood
// before one block changed, so once anything has pushed the newest message away it would faithfully
// restore the drifted position instead of the bottom. Placeholder swaps, fullscreen exits and Risu
// display transitions all come through here; a card frame's height report repins before it gets here.
function compensateChatViewportGrowth(before) {
  if (chatBottomFollowRepin()) return true;
  if (!before || !Number.isFinite(before.top) || before.top >= 0) return false;
  if (!chatViewportTaskMatches(before.task)) return false;
  var after = captureChatViewportBlock(before.node);
  if (!after) return false;
  var moved = Math.round(after.bottom - before.bottom);
  if (moved) writeChatViewportTop(after.task.ct, Math.max(0, after.task.ct.scrollTop + moved));
  return true;
}
function restoreChatViewportLayout(layout) {
  if (chatBottomFollowRepin()) return;
  if (!layout || !chatViewportTaskMatches(layout.task)) return;
  if (layout.follow || layout.atBottom)
    writeChatViewportTop(layout.ct, Math.max(0, layout.ct.scrollHeight - layout.ct.clientHeight));
  else applyChatReadingAnchor(layout.anchor);
}
function settleViewport(state) {
  if (!state || !state.ct || state.released) return;
  if (_activeViewportState && _activeViewportState !== state) return;
  if (state.epoch != null && state.epoch !== _chatViewportOwner.epoch) return;
  var id = currentChatViewportIdentity();
  if (state.charId != null && state.charId !== id.charId) return;
  if (state.sessionId != null && state.sessionId !== id.sessionId) return;
  var ct = state.ct;
  if (!state.followBottom) {
    // Every repaint of a running generation lands here; when the reader has moved away from the
    // bottom, that repaint is content they have not seen.
    noteChatContentBelowReader();
    state.scrollTop = ct.scrollTop;
    return;
  }
  var bottom = Math.max(0, ct.scrollHeight - ct.clientHeight);
  if (Math.abs(ct.scrollTop - bottom) > 1) {
    state.writtenTop = bottom;
    ct.scrollTop = bottom;
  }
  state.scrollTop = ct.scrollTop;
}
function settleViewportAfterMedia(root, state) {
  if (!root || !state || !state.ct || !root.querySelectorAll) return;
  var epoch = _chatViewportOwner.epoch,
    charId = state.charId,
    sessionId = state.sessionId;
  // Token batches call this on nearly every paint, so without this guard one slow image would end
  // up carrying dozens of stacked load/error listeners.
  if (!state.mediaWatched || state.mediaWatchedEpoch !== epoch) {
    state.mediaWatched = new WeakSet();
    state.mediaWatchedEpoch = epoch;
  }
  var watched = state.mediaWatched;
  root.querySelectorAll('img').forEach(function (image) {
    if (image.complete || watched.has(image)) return;
    watched.add(image);
    var settle = function () {
      watched.delete(image);
      if (_chatViewportOwner.epoch !== epoch) return;
      if (state.charId != null && state.charId !== charId) return;
      if (state.sessionId != null && state.sessionId !== sessionId) return;
      settleViewport(state);
    };
    image.addEventListener('load', settle, { once: true });
    image.addEventListener('error', settle, { once: true });
  });
}
function settleChatThroughMedia(root, ct, apply) {
  if (!ct || typeof apply !== 'function') return;
  var task = Object.assign(captureChatViewportTask(ct), { pending: 0, stopped: false }),
    blocks = 0;
  var live = function () {
      if (!chatViewportTaskMatches(task)) detach();
      return !task.stopped;
    },
    detach = function () {
      task.stopped = true;
      if (task.observer) task.observer.disconnect();
    },
    run = function () {
      if (live()) apply();
    },
    settled = function () {
      run();
      if (--task.pending <= 0) detach();
    };
  if (root && root.querySelectorAll) {
    var risuPending = new Set(Array.from(root.querySelectorAll('.risu-display-host:not([data-risu-ready])')));
    if (risuPending.size) {
      blocks += risuPending.size;
      task.pending += risuPending.size;
      task.observer = new MutationObserver(function () {
        if (!live()) return;
        risuPending.forEach(function (host) {
          if (host.isConnected && !host.hasAttribute('data-risu-ready')) return;
          risuPending.delete(host);
          blocks--;
          settled();
        });
      });
      task.observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-risu-ready'],
      });
    }
  }
  if (root) {
    _cardFrontendLive.forEach(function (item) {
      if (!item || item.heightReady) return;
      if (
        !(item.node && (root === item.node || root.contains(item.node))) &&
        !(item.frame && root.contains(item.frame))
      )
        return;
      blocks++;
      task.pending++;
      if (!item.heightWaiters) item.heightWaiters = [];
      item.heightWaiters.push(function () {
        blocks--;
        settled();
      });
    });
  }
  if (!blocks) run();
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(function () {
      if (!blocks) run();
    });
  if (root && root.querySelectorAll)
    root.querySelectorAll('img').forEach(function (image) {
      if (image.complete) return;
      task.pending++;
      image.addEventListener('load', settled, { once: true });
      image.addEventListener('error', settled, { once: true });
    });
  if (!task.pending && typeof requestAnimationFrame === 'function') requestAnimationFrame(detach);
}
// ---- Staying on the newest message while lazily mounted content is still growing ----
// `settleChatThroughMedia` waits only for the frames and images that exist the moment it is called.
// The mount scheduler in `73-card-frontend.js` starts the card frontends near the reading position
// one at a time long after that, and each one swaps its placeholder estimate for a real height, so a
// single settle lets go while the chat is still growing. Following the bottom is therefore a state
// that outlives one settle: it holds the newest message in place until the reader takes over.
// There is no clock on it: a deadline long enough for the mount queue on a busy main thread is also
// long enough to be wrong, and the queue is not the only late content — display transforms keep
// rebuilding the list for as long as they run. Reasons that hand the viewport to a reading position
// without the reader having asked for one are the only ones that do not end it.
var CHAT_BOTTOM_FOLLOW_KEEP_REASONS = ['generation-end'];
function stopChatBottomFollow() {
  var session = _chatBottomFollow;
  _chatBottomFollow = null;
  if (!session) return false;
  if (session.observer) session.observer.disconnect();
  if (session.ct && session.onScroll) session.ct.removeEventListener('scroll', session.onScroll);
  session.observer = null;
  session.onScroll = null;
  session.pinFrame = 0;
  return true;
}
// Where the list stands as far as the follow is concerned: the position it or anyone else in the
// application last wrote, and how far the content could be scrolled at that moment.
function chatBottomFollowNotePosition(session, ct) {
  if (!session || _chatBottomFollow !== session || !ct || ct !== session.ct) return;
  if (!ct.clientHeight || !ct.scrollHeight) return;
  session.expectedTop = ct.scrollTop;
  session.expectedMax = Math.max(0, ct.scrollHeight - ct.clientHeight);
}
// A finger dragging on a running card frontend never reaches this page: the touch belongs to the
// iframe, and the host only ever sees the scroll it chains into. That blind spot was harmless while
// following the bottom ended with one settle, but a state that lasts would keep pulling such a
// reader back, so the scroll itself has to be readable as "somebody else moved this".
// Two things separate the reader from the application: every scroll the application performs goes
// through `writeChatViewportTop`, which records the position it wrote, and content that grows or
// shrinks changes how far the list can be scrolled — the browser keeping an anchor in place across
// that change is not a gesture either. What is left is a move backwards through unchanged content.
function chatBottomFollowHandleScroll(session) {
  if (!chatBottomFollowLive(session)) return;
  var ct = session.ct,
    top = ct.scrollTop,
    max = Math.max(0, ct.scrollHeight - ct.clientHeight);
  if (
    session.expectedTop == null ||
    max !== session.expectedMax ||
    Math.abs(top - session.expectedTop) <= 2 ||
    top > session.expectedTop
  ) {
    chatBottomFollowNotePosition(session, ct);
    return;
  }
  stopChatBottomFollow();
  adoptChatViewportGesture('user-scroll', true);
}
function chatBottomFollowLive(session) {
  if (!session || _chatBottomFollow !== session) return false;
  var ct = session.ct,
    id = currentChatViewportIdentity();
  if (
    !ct ||
    !ct.isConnected ||
    ct !== document.getElementById('chat-messages') ||
    session.charId !== id.charId ||
    session.sessionId !== id.sessionId ||
    session.contextId !== _chatViewportOwner.contextId
  ) {
    stopChatBottomFollow();
    return false;
  }
  return true;
}
function chatBottomFollowPin(session) {
  if (!chatBottomFollowLive(session)) return false;
  var ct = session.ct,
    bottom = Math.max(0, ct.scrollHeight - ct.clientHeight);
  // A chat page switched away reports an empty box, and "the bottom" of an empty box is the top.
  // The reading position is restored when the page comes back, so nothing is written meanwhile.
  if (!ct.clientHeight || !ct.scrollHeight) return false;
  // Writing an unchanged value fires no scroll event, but a changed one restarts the scheduler's own
  // quiet window, so only a gap the reader would actually see is corrected.
  if (Math.abs(ct.scrollTop - bottom) <= 1) {
    chatBottomFollowNotePosition(session, ct);
    return false;
  }
  writeChatViewportTop(ct, bottom);
  return true;
}
// Content height changes are what the follow reacts to, and the blocks that change late are the card
// frontend slots: each one is measured whether it holds a placeholder or a frame, so a frame started
// after the settle is caught the moment it lays out. The chat host's own box is deliberately not
// watched — the composer and the keyboard resize it, and those keep the reading position instead.
function chatBottomFollowObserve(session) {
  if (!session.observer || !session.ct) return;
  session.ct.querySelectorAll('.yeyu-card-frontend[data-frontend-key]').forEach(function (node) {
    // Re-observing an already observed target delivers another initial observation, which inside the
    // callback would be a loop; the set is what keeps each target registered exactly once.
    if (!node || session.observed.has(node)) return;
    session.observed.add(node);
    try {
      session.observer.observe(node);
    } catch (_) {}
  });
}
// A redraw and a frame reporting its height both end with somebody else restoring the position they
// sampled for themselves, which is a row anchor even when that row was the newest message. One
// coalesced correction two frames later gives the follow the last word without fighting them.
function chatBottomFollowSchedulePin(session) {
  if (!session || session.pinFrame || typeof requestAnimationFrame !== 'function') return;
  session.pinFrame = requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      session.pinFrame = 0;
      chatBottomFollowPin(session);
    });
  });
}
function chatBottomFollowRepin() {
  var session = _chatBottomFollow;
  if (!chatBottomFollowLive(session)) return false;
  // A redraw replaces the card frontend blocks, and the follow may have been taken before that
  // redraw even ran (opening a chat adopts "the newest message" first), so the watch list is
  // resynced here rather than only when an already watched block changes.
  chatBottomFollowObserve(session);
  chatBottomFollowPin(session);
  chatBottomFollowSchedulePin(session);
  return true;
}
function chatBottomFollowing() {
  return chatBottomFollowLive(_chatBottomFollow);
}
function startChatBottomFollow(ct) {
  if (!ct || typeof document === 'undefined' || typeof ResizeObserver !== 'function') return null;
  var session = _chatBottomFollow;
  if (chatBottomFollowLive(session)) {
    chatBottomFollowObserve(session);
    chatBottomFollowNotePosition(session, ct);
    return session;
  }
  stopChatBottomFollow();
  var id = currentChatViewportIdentity();
  session = {
    ct: ct,
    charId: id.charId,
    sessionId: id.sessionId,
    contextId: _chatViewportOwner.contextId,
    observed: new WeakSet(),
    observer: null,
    onScroll: null,
    pinFrame: 0,
    expectedTop: null,
    expectedMax: null,
  };
  session.observer = new ResizeObserver(function () {
    if (!chatBottomFollowLive(session)) return;
    chatBottomFollowObserve(session);
    chatBottomFollowPin(session);
    chatBottomFollowSchedulePin(session);
  });
  session.onScroll = function () {
    chatBottomFollowHandleScroll(session);
  };
  _chatBottomFollow = session;
  chatBottomFollowObserve(session);
  chatBottomFollowNotePosition(session, ct);
  ct.addEventListener('scroll', session.onScroll, { passive: true });
  return session;
}
function followChatBottomThroughMedia(root, ct) {
  settleChatThroughMedia(root, ct, function () {
    writeChatViewportTop(ct, Math.max(0, ct.scrollHeight - ct.clientHeight));
  });
  startChatBottomFollow(ct);
}
// Pressing send is a request to watch the reply arrive. Whatever the reader was looking at, the list
// goes to its bottom and stays there, so the message just sent and the waiting indicator under it are
// both on screen before the first token; scrolling up afterwards hands the viewport back as usual.
function followChatBottomForSend() {
  var ct = document.getElementById('chat-messages');
  clearChatNewContentMark();
  adoptChatViewportFollow('send');
  if (ct) followChatBottomThroughMedia(ct, ct);
}
// ---- "New content" badge ----
// While the reader is away from the bottom, content that arrives below them is unread. The badge is
// the only way back that also re-arms the follow, and it says nothing when nothing has arrived: it is
// armed by content actually landing, not merely by the list being scrolled up.
var _chatNewContentPending = false;
function chatNewContentBadgeElement() {
  return typeof document === 'undefined' ? null : document.getElementById('chat-new-content');
}
function renderChatNewContentBadge() {
  var badge = chatNewContentBadgeElement();
  if (!badge) return;
  var ct = document.getElementById('chat-messages');
  badge.hidden = !(_chatNewContentPending && ct && _chatViewportOwner.mode !== 'follow' && !isNearChatBottom(ct));
}
function clearChatNewContentMark() {
  if (!_chatNewContentPending) return;
  _chatNewContentPending = false;
  renderChatNewContentBadge();
}
function noteChatContentBelowReader() {
  var ct = document.getElementById('chat-messages');
  if (!ct || _chatViewportOwner.mode === 'follow' || isNearChatBottom(ct)) {
    clearChatNewContentMark();
    return;
  }
  _chatNewContentPending = true;
  renderChatNewContentBadge();
}
function jumpChatToNewContent() {
  var ct = document.getElementById('chat-messages');
  clearChatNewContentMark();
  adoptChatViewportFollow('new-content');
  if (ct) followChatBottomThroughMedia(ct, ct);
}
function releaseViewportState(state) {
  if (!state) return;
  state.released = true;
  if (state.ct) {
    if (state.onScroll) state.ct.removeEventListener('scroll', state.onScroll);
    if (state.onIntent)
      VIEWPORT_INTENT_EVENTS.forEach(function (name) {
        state.ct.removeEventListener(name, state.onIntent);
      });
  }
  state.onScroll = null;
  state.onIntent = null;
}
function clearStreamCursors(root) {
  var host = root || document;
  host.querySelectorAll('.stream-cursor').forEach(function (el) {
    el.classList.remove('stream-cursor');
    if (el.tagName === 'SPAN' && !el.textContent) el.remove();
  });
  host.querySelectorAll('.stream-active-bubble').forEach(function (el) {
    el.classList.remove('stream-active-bubble');
  });
}
// 重新生成、新候选或续写没有提交时，把流式改动过的那一行还原成它当前的正式显示。
function restoreTargetBubble(target) {
  if (!chatViewportTargetVisible(target)) return;
  var session = generationSessionForTarget(target),
    message = session && generationTargetMessageIndex(target, session) >= 0 ? session.msgs[target.messageIndex] : null,
    row = message && document.querySelector('[data-msg-seq="' + Number(message.seq) + '"]'),
    char = generationTargetCharacter(target);
  if (row && message && char) {
    var depth = regexScriptMessageDepths(session.msgs)[target.messageIndex];
    reconcileStreamElement(row, messageHtml(char, message, target.messageIndex, null, depth));
    syncCardFrontends(char);
    // The row keeps its Risu frames through the stream; they go back to the committed display here.
    Promise.resolve(syncRisuDisplays(char, session, session.msgs, 0)).catch(function (error) {
      console.warn('Risu 演出恢复失败', error);
    });
  }
}
// One notice per run: a real failure and a skipped tail never both reach the user, so stopping
// during the save shows a single message.
function generationPostCommitNoticeOnce(target) {
  if (!target) return true;
  if (target.postCommitWarningShown) return false;
  target.postCommitWarningShown = true;
  return true;
}
function reportGenerationPostCommitError(target, error) {
  if (error && error.name === 'AbortError') return;
  if (!generationPostCommitNoticeOnce(target)) return;
  toast('回复已保存，卡片后续处理未完成：' + String((error && error.message) || error), 'err');
}
// Switching away right after sending and stopping during the save are everyday actions, so the
// skipped tail is an ordinary notice with its own wording, separate from a real failure.
function reportGenerationSkippedTail(target) {
  // A generation the tail started itself retires that tail by taking a new epoch. That handover is
  // the intended behaviour of the reentrant path, not a round the user lost, so it stays silent.
  if (target && target.postCommitSelfSuperseded) return;
  if (!generationPostCommitNoticeOnce(target)) return;
  toast('回复已保存，本轮卡片脚本、摘要和表情处理已跳过', 'info');
}
var _generationPostCommitTasks = new WeakMap(),
  _generationPostCommitRuns = new WeakMap(),
  // Every tail of a session still reporting to card scripts, including the GENERATION_ENDED tail of a generation
  // without a reply, which stays out of _generationPostCommitTasks so it holds off neither edits nor the next send.
  _generationCardEventTails = new WeakMap();
function generationCardEventTailPending(session) {
  var tails = session && _generationCardEventTails.get(session);
  return !!(tails && tails.size);
}
// The guard only keeps *user* actions from interleaving with the background run; the run's own
// scripts must be able to write. A call therefore states its source in its options, because a tail
// spans many macrotasks and a module-level "current run" flag would wave through the user's own
// clicks during the same window. Two script sources exist: `postCommitRun` is the tail a slash
// command runs inside (stscript hands it over as `args._abortController.postCommitRun`, which
// `qrPerformAuto` and the preset task runtime attach), and `hostFacade` marks a call a card front
// end made through the host facade. Everything else — interface entries and slash commands the
// user typed into the composer — carries nothing and stays guarded.
function generationPostCommitCallFromScript(session, source) {
  if (!source) return false;
  if (source.hostFacade === true) return true;
  var run = source.postCommitRun;
  return !!(run && session && _generationPostCommitRuns.get(session) === run);
}
// A call that named a script source the check above did not clear — a tail whose run was already
// replaced by the generation that tail started itself — is refused without a notice: no one is at
// the screen waiting for it and the caller already learns of it from the failure return. User
// sources keep the notice.
function generationPostCommitSilentReject(session, source) {
  return !!(source && source.postCommitRun) && !generationPostCommitCallFromScript(session, source);
}
function blockDuringGenerationPostCommit(session, source) {
  if (!session || !_generationPostCommitTasks.has(session)) return false;
  if (generationPostCommitCallFromScript(session, source)) return false;
  if (!generationPostCommitSilentReject(session, source)) toast('卡片脚本处理中，请稍后再操作', 'info');
  return true;
}
// Shared guard for entries that roll back a whole-session snapshot the same way
// editMessage/deleteMessage do: active generation blocks first, then an in-flight
// post-commit background task for that session blocks too. Entries that themselves
// belong to the generation/drain pipeline (send, continue, regenerate, new candidate
// via generateMessageSwipe) must not call this — they go through awaitGenerationPostCommit.
// Callers that can be reached by a script pass that call's options as `source`.
function blockDuringGenerationOrPostCommit(action, session, source) {
  if (blockDuringGeneration(action, generationPostCommitSilentReject(session, source))) return true;
  return blockDuringGenerationPostCommit(session, source);
}
function cancelGenerationPostCommit(session) {
  var run = session && _generationPostCommitRuns.get(session);
  if (run) run.controller.abort();
}
function generationPostCommitRun(target, session) {
  var run = _generationPostCommitRuns.get(session);
  if (!run || run.epoch !== target.epoch || run.controller.signal.aborted) {
    run = { target: target, epoch: target.epoch, controller: new AbortController() };
    _generationPostCommitRuns.set(session, run);
  }
  return run;
}
async function generationBoundedWork(work, controller, timeoutMs, label) {
  try {
    return await cardFrontendAwaitWithTimeout(
      Promise.resolve().then(function () {
        if (controller.signal.aborted) throw cardFrontendAbortError(label);
        return work();
      }),
      {
        signal: controller.signal,
        timeoutMs: timeoutMs == null ? undefined : timeoutMs,
        label: label,
      }
    );
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) controller.abort();
    throw error;
  }
}
async function generationTailBoundedWork(work, run, label) {
  return generationBoundedWork(work, run.controller, undefined, label);
}
// A generation started from inside a tail (an executeOnAi QR running /trigger, /continue, the
// default send of a quick reply) carries the run it belongs to; waiting for that same task would
// wait for itself forever.
function generationPostCommitReentrant(session, options) {
  var run = options && options.postCommitRun;
  if (!run || !session || _generationPostCommitRuns.get(session) !== run) return false;
  // The new generation takes a new epoch and retires this tail. That is the point of the reentrant
  // path, so the tail must not announce it as a skipped round.
  if (run.target) run.target.postCommitSelfSuperseded = true;
  return true;
}
async function awaitGenerationPostCommit(session, signal, options) {
  if (generationPostCommitReentrant(session, options)) return;
  var task = _generationPostCommitTasks.get(session),
    run = _generationPostCommitRuns.get(session);
  if (!task) return;
  try {
    await cardFrontendAwaitWithTimeout(task, {
      signal: signal,
      label: '上一条回复的卡片处理',
    });
  } catch (error) {
    // Fence before returning to the next send. A late receipt can no longer emit
    // the next event, mutate the target index or launch QR/summary/after-AI work.
    if (run) {
      run.controller.abort();
      reportGenerationPostCommitError(run.target, error);
    }
    if (_generationPostCommitTasks.get(session) === task) _generationPostCommitTasks.delete(session);
    throw error;
  }
}
// Single entry for every post-commit background task: it takes the run for this target, builds
// the shared wait options, queues behind that session's previous task, reports once and removes
// itself when settled. Nothing else writes _generationPostCommitTasks, so an early return in
// finishGeneration can no longer leave edit/delete refused until the next generation.
function queueGenerationPostCommitTask(target, sess, work, options) {
  options = options || {};
  var run = options.run || generationPostCommitRun(target, sess),
    owner =
      options.owner || (target && { charId: target.charId, sessionId: target.sessionId, epoch: target.epoch }) || null;
  if (options.abortAtQueue) run.controller.abort();
  var release = registerTransientRequestController(run.controller);
  var waitOptions = {
      signal: run.controller.signal,
      current: function () {
        return generationTargetStillLive(owner, sess, run.controller.signal);
      },
      postCommitRun: run,
    },
    previous = options.after || (sess && _generationPostCommitTasks.get(sess)) || Promise.resolve();
  var task = cardFrontendAwaitWithTimeout(previous, { signal: run.controller.signal, label: '上一条回复的卡片处理' })
    .then(function () {
      if (!waitOptions.current()) {
        if (options.reportSkip !== false) reportGenerationSkippedTail(target);
        return;
      }
      return cardFrontendAwaitWithTimeout(
        Promise.resolve().then(function () {
          if (!waitOptions.current()) throw cardFrontendAbortError('回复后续处理');
          return work(waitOptions, run);
        }),
        { signal: run.controller.signal, label: '回复后续处理' }
      );
    })
    .catch(function (error) {
      reportGenerationPostCommitError(target, error);
    })
    .finally(function () {
      release();
      if (options.settled) options.settled(waitOptions);
      if (sess && _generationPostCommitTasks.get(sess) === task) _generationPostCommitTasks.delete(sess);
      if (sess) _generationCardEventTails.get(sess).delete(task);
      noteCardEventGenerationSettled();
    });
  if (target) target.postCommitTask = task;
  if (sess && options.queue !== false) _generationPostCommitTasks.set(sess, task);
  if (sess) {
    if (!_generationCardEventTails.has(sess)) _generationCardEventTails.set(sess, new Set());
    _generationCardEventTails.get(sess).add(task);
  }
  noteCardEventGenerationStarted();
  return task;
}
function queueGenerationPostCommit(target, char, sess, reply, options, afterEvents) {
  var eventTarget = {
    index: sess.msgs.indexOf(reply),
    mode: target.mode,
    charId: target.charId,
    sessionId: target.sessionId,
    epoch: target.epoch,
  };
  return queueGenerationPostCommitTask(
    target,
    sess,
    async function (waitOptions, run) {
      var controller = run.controller;
      function current() {
        return waitOptions.current();
      }
      function indexNow() {
        return current() ? sess.msgs.indexOf(reply) : -1;
      }
      try {
        await generationBoundedWork(
          async function () {
            // ST awaits every STREAM_TOKEN_RECEIVED before saveReply, so a slow listener still hears
            // the last chunk before the reply is reported and cannot repaint it as still streaming.
            if (options && options.streamTokensDelivered) await options.streamTokensDelivered;
            if (indexNow() < 0) return;
            await promptTemplateRecordReceive(char, sess, reply, waitOptions);
            if (indexNow() < 0) return;
            // Like saveReply in ST, every generation type reports the reply with MESSAGE_RECEIVED and
            // nothing else here; a new swipe was already announced before the request started.
            eventTarget.index = indexNow();
            await cardFrontendMessageReceived(eventTarget, waitOptions);
            if (current()) target.messageIndex = sess.msgs.indexOf(reply);
          },
          controller,
          undefined,
          '回复接收事件'
        );
      } catch (error) {
        reportGenerationPostCommitError(target, error);
      }
      // A script may delete the reply while the events run. There is no committed message left,
      // so the tail and the after-AI fallback are both retired instead of working on a stale
      // messageIndex.
      if (current() && indexNow() < 0) {
        delete target.cardScriptLibraryCommittedMessageIndex;
        reportGenerationSkippedTail(target);
        return;
      }
      if (!afterEvents) return;
      if (!current()) {
        reportGenerationSkippedTail(target);
        return;
      }
      await generationTailBoundedWork(
        function () {
          return afterEvents(waitOptions);
        },
        run,
        '回复后续处理',
        target
      );
    },
    { owner: eventTarget, abortAtQueue: !!(options && options.signal && options.signal.aborted) }
  );
}
// appendSwipe：正文存成目标回复的一个未显示候选。显示内容和活动候选不变，所以不回滚记忆、不失效缓存，
// 也不跑只作用于显示候选的整理（宏效果、Risu 输出、MVU、正则显示、故事方向）和卡片接收事件；
// 用户切到它时由候选切换按正常流程整理。草稿基础 hash 不含候选，同对话的其他草稿也不因此失效。
async function commitHiddenSwipeCandidate(target, full, meta) {
  var char = generationTargetCharacter(target),
    sess = generationSessionForTarget(target);
  if (!char || !sess) throw new Error('生成目标已不存在');
  var message = resolveGenerationTargetMessage(target, sess),
    releaseGenerationCommit = beginGenerationSessionCommit(target, sess),
    mutation = beginMessageMutation(char, sess, message),
    text = String(full == null ? '' : full);
  try {
    var candidateMeta = meta.streamDraftId
      ? Object.assign({}, meta.generationMeta, { sourceDraftId: meta.streamDraftId })
      : meta.generationMeta;
    messageSwipeAppendHidden(
      message,
      text,
      candidateMeta,
      joinReasoningText(meta.reasoning || '', splitAssistantResponseText(text).reasoning)
    );
    mutation.seal();
    if (meta.streamDraftId) {
      try {
        await prepareStreamDraftCommit(meta.streamDraftId, { content: text, seq: message.seq });
      } catch (error) {
        console.warn('流式草稿提交准备失败', error);
      }
    }
    await saveData('sessions', {
      urgent: true,
      clearStreamDraftIds: meta.streamDraftId ? [meta.streamDraftId] : [],
    });
  } catch (error) {
    var failedDraft = meta.streamDraftId && findStreamDraft(meta.streamDraftId);
    if (failedDraft) delete failedDraft._committing;
    mutation.rollback();
    throw new Error('生成结果保存失败，原对话已恢复：' + error.message);
  } finally {
    releaseGenerationCommit();
  }
  if (meta.streamDraftId) removeStreamDraftInMemory(meta.streamDraftId);
  if (chatViewportTargetVisible(target)) renderChat();
  return text;
}
// 供应商给出的结束原因记在回复的生成元数据上：达到输出上限与供应商中途拦截各有提示，正常结束清掉旧标记。
// 拦截只提示并保留原因，正文照常保存，不并入未完成标记。
function recordProviderFinishReason(reply, finishReason) {
  var reason = String(finishReason || '').toLowerCase(),
    intercepted = providerInterceptedFinishReason(reason),
    next = Object.assign({}, reply.generationMeta);
  delete next.outputLimitReached;
  delete next.providerStopReason;
  if (reason === 'length') next.outputLimitReached = true;
  if (intercepted) next.providerStopReason = intercepted;
  if (Object.keys(next).length) reply.generationMeta = next;
  else delete reply.generationMeta;
  return intercepted;
}
async function commitGeneratedResponse(target, full, meta) {
  meta = meta || {};
  var expressionEpoch = _expressionEpoch;
  if (isGenerationCancelled() && !meta.allowCancelledCommit) throw new Error('已取消');
  setGenerationState('committing');
  if (target.mode === 'appendSwipe') return commitHiddenSwipeCandidate(target, full, meta);
  const char = generationTargetCharacter(target),
    sess = generationSessionForTarget(target);
  if (!char || !sess) throw new Error('生成目标已不存在');
  var releaseGenerationCommit = beginGenerationSessionCommit(target, sess),
    mutation = null,
    committed = false;
  try {
    if (target.viewportContextId == null)
      target.viewportContextId = chatViewportTargetVisible(target) ? _chatViewportOwner.contextId : -1;
    var responseParts = splitAssistantResponseText(full),
      incomingReasoning = joinReasoningText(meta.reasoning || '', responseParts.reasoning);
    full = String(full == null ? '' : full);
    assertGenerationTargetOwnership(target, sess);
    const visible = chatViewportTargetVisible(target),
      ct = visible ? $('chat-messages') : null,
      directionBefore =
        target.mode === 'new' &&
        typeof StoryDirection === 'object' &&
        StoryDirection &&
        typeof StoryDirection.progress === 'function'
          ? StoryDirection.progress(sess, sess.msgs)
          : null,
      directionUserSeq =
        directionBefore && typeof StoryDirection.latestUserSeq === 'function'
          ? StoryDirection.latestUserSeq(sess.msgs)
          : 0;
    var targetMessage = target.mode === 'new' ? null : resolveGenerationTargetMessage(target, sess),
      idx = target.messageIndex,
      reply;
    mutation = beginMessageMutation(char, sess, targetMessage);
    if (target.mode === 'continue') {
      messageRevertTranslation(targetMessage);
      // 续写的思考接在当前候选自己的思考后面；旧数据先落成分格，不接到别的候选的思考上。
      messageSwipeAdoptReasoning(targetMessage);
      var old = targetMessage.content,
        continuedBase = String(meta.continuedBase || old || ''),
        continuedText = continuedBase + full;
      target.speechSourceOffset = continuedBase.length;
      if (continuedText !== old)
        invalidateMessageImageCandidate(targetMessage, Math.max(0, Number(targetMessage.swipeId) || 0));
      targetMessage.content = continuedText;
      if (!Array.isArray(targetMessage.swipes) || !targetMessage.swipes.length)
        targetMessage.swipes = [String(old || '')];
      var activeSwipe = Math.max(0, Math.min(targetMessage.swipes.length - 1, Number(targetMessage.swipeId) || 0));
      targetMessage.swipes[activeSwipe] = continuedText;
      targetMessage.swipeId = activeSwipe;
      if (targetMessage.content !== old) targetMessage.continueBase = old;
      if (incomingReasoning)
        targetMessage.reasoning = joinReasoningText(targetMessage.reasoning || '', incomingReasoning);
      targetMessage.continued = true;
      targetMessage.time = Date.now();
      if (targetMessage.generationMeta) {
        delete targetMessage.generationMeta.incomplete;
        delete targetMessage.generationMeta.interruptionReason;
        delete targetMessage.generationMeta.interruptionStatus;
        delete targetMessage.generationMeta.interruptionDetail;
        delete targetMessage.generationMeta.sourceDraftId;
        delete targetMessage.generationMeta.visibleChars;
        if (!Object.keys(targetMessage.generationMeta).length) delete targetMessage.generationMeta;
      }
      reply = targetMessage;
    } else if (target.mode === 'regenerate' || target.mode === 'swipe') {
      rollbackMemoryDependencies(target.charId, sess, Number(targetMessage.seq) || 1);
      messageRevertTranslation(targetMessage);
      var previous = String(targetMessage.content || '');
      if (!Array.isArray(targetMessage.swipes) || !targetMessage.swipes.length) targetMessage.swipes = [previous];
      else {
        var previousActive = Math.max(0, Math.min(targetMessage.swipes.length - 1, Number(targetMessage.swipeId) || 0));
        targetMessage.swipes[previousActive] = previous;
      }
      messageSwipeStashActive(targetMessage);
      targetMessage.content = full;
      if (target.mode === 'swipe') targetMessage.swipes.push(full);
      else if (targetMessage.swipes.indexOf(full) < 0) targetMessage.swipes.push(full);
      if (target.mode === 'swipe') targetMessage.swipeId = targetMessage.swipes.length - 1;
      else targetMessage.swipeId = Math.max(0, targetMessage.swipes.indexOf(full));
      messageSwipeRestoreActive(targetMessage);
      // 旧候选的生成元数据已随它换出；这次提交的候选只带本次提交记下的元数据。
      delete targetMessage.generationMeta;
      if (Array.isArray(targetMessage.tavernHelperSwipeInfo))
        targetMessage.tavernHelperSwipeInfo[targetMessage.swipeId] = hostWriteMessageExtra(
          targetMessage,
          targetMessage.tavernHelperSwipeInfo[targetMessage.swipeId]
        );
      if (incomingReasoning) targetMessage.reasoning = incomingReasoning;
      else delete targetMessage.reasoning;
      targetMessage.time = Date.now();
      targetMessage.regenerated = true;
      delete targetMessage.continueBase;
      invalidateCacheContexts(target.charId, idx + 1, true, sess.id);
      reply = targetMessage;
    } else {
      reply = {
        role: 'assistant',
        content: full,
        swipes: [full],
        swipeId: 0,
        time: Date.now(),
        seq: allocateMessageSeq(sess),
      };
      if (incomingReasoning) reply.reasoning = incomingReasoning;
      mutation.splice(sess.msgs, sess.msgs.length, 0, [reply]);
      idx = sess.msgs.length - 1;
      target.messageIndex = idx;
    }
    markMessageMacroEffects(char, reply, target.mode === 'continue' ? String(old || '').length : 0);
    // 思考用时与读者当时的折叠选择随消息保存，提交和重载都不会让思考块跳回另一个样子。
    if (!reply.reasoning) {
      delete reply.reasoningMs;
      delete reply.reasoningCollapsed;
    } else {
      var committedReasoningMs = Math.round(Number(meta.reasoningMs) || 0);
      if (committedReasoningMs > 0)
        reply.reasoningMs =
          target.mode === 'continue' ? committedReasoningMs + (Number(reply.reasoningMs) || 0) : committedReasoningMs;
      if (typeof meta.reasoningCollapsed === 'boolean') reply.reasoningCollapsed = meta.reasoningCollapsed;
    }
    if (meta.generationMeta) reply.generationMeta = meta.generationMeta;
    var providerStopReason = '';
    if (Object.prototype.hasOwnProperty.call(meta, 'finishReason'))
      providerStopReason = recordProviderFinishReason(reply, meta.finishReason);
    else if (reply.generationMeta)
      reply.generationMeta.visibleChars = window.YeyuPure.visibleCharacterCount(reply.content);
    if (target && Object.prototype.hasOwnProperty.call(target, 'wbMetrics')) {
      var compactMetrics = compactWorldBookMetrics(target.wbMetrics);
      if (compactMetrics) reply.worldBookMetrics = compactMetrics;
      else delete reply.worldBookMetrics;
    }
    mutation.seal();
    if (isRisuCharacter(char))
      target.risuRollback = await risuCommitOutput(char, sess, reply, target, {
        streamed: meta.streamed,
        complete: !meta.allowCancelledCommit && !(messageActiveGenerationMeta(reply) || {}).incomplete,
      });
    var outputMessageOrder = sess.msgs.map(function (message) {
        return { message: message, role: message.role, content: message.content };
      }),
      outputTargetIndex = idx;
    idx = sess.msgs.indexOf(reply);
    target.messageIndex = idx;
    var commitController = target.commitWaitController,
      replyDepth = regexScriptMessageDepths(sess.msgs)[idx];
    try {
      await generationBoundedWork(
        async function () {
          if (mvuCanRun(char)) {
            try {
              await refreshMvuAfterMutation(char, sess, { signal: commitController.signal, mutation: mutation });
            } catch (error) {
              target.commitDisplayError = error;
            }
          }
          if (commitController.signal.aborted) return;

          refreshCardScriptLibraryContext(char, sess);
          var replyText = assistantMessageParts(reply).content;
          if (idx >= 0 && regexScriptMessageEligible(reply)) {
            try {
              await prepareRegexScriptTexts(
                char,
                [
                  {
                    role: 'assistant',
                    phase: 'display',
                    depth: replyDepth,
                    index: idx,
                    message: reply,
                    text: replyText,
                  },
                ],
                { signal: commitController.signal }
              );
            } catch (error) {
              if (!error || error.name !== 'AbortError') target.commitDisplayError = error;
            }
          }
          if (commitController.signal.aborted) return;
          // The committed Risu reply starts from the display its stream ended on, not its raw text.
          if (idx >= 0 && isRisuCharacter(char)) {
            try {
              await risuPrimeDisplay(char, sess, reply, replyText, commitController.signal);
            } catch (error) {
              if (!error || error.name !== 'AbortError') console.warn('Risu 回复显示预热失败', error);
            }
          }
          if (commitController.signal.aborted) return;
          if (idx >= 0)
            await hydrateReferencedCardAssets(char, [
              { text: replyText, message: reply, role: 'assistant', depth: replyDepth },
            ]);
        },
        commitController,
        undefined,
        '回复保存前整理'
      );
    } catch (error) {
      target.commitDisplayError = error;
    }
    if (idx >= 0 && meta.streamDraftId) {
      mutation.capture(reply, ['generationMeta'], true);
      reply.generationMeta = Object.assign({}, reply.generationMeta, { sourceDraftId: meta.streamDraftId });
      mutation.seal();
      try {
        await prepareStreamDraftCommit(meta.streamDraftId, reply);
      } catch (error) {
        console.warn('流式草稿提交准备失败', error);
      }
    }
    mutation.capture(sess, ['storyDirection']);
    if (idx >= 0 && directionBefore && typeof StoryDirection.recordReplyRound === 'function')
      StoryDirection.recordReplyRound(
        sess,
        directionUserSeq,
        directionBefore.current && directionBefore.current.id,
        directionBefore.direction
      );
    if (typeof StoryDirection === 'object' && StoryDirection && typeof StoryDirection.reconcile === 'function')
      StoryDirection.reconcile(sess, sess.msgs);
    mutation.seal();
    try {
      await saveData(['characters', 'personas', 'sessions', 'worldbook'], {
        urgent: true,
        clearStreamDraftIds: meta.streamDraftId ? [meta.streamDraftId] : [],
      });
      committed = true;
      // From here on the target names the saved reply; later segments and tails find it by seq.
      target.messageSeq = Number(reply.seq) || 0;
      delete target.risuRollback;
    } catch (error) {
      var failedDraft = meta.streamDraftId && findStreamDraft(meta.streamDraftId);
      if (failedDraft) delete failedDraft._committing;
      target.messageIndex = outputTargetIndex;
      clearMvuSessionRuntime(char.id, sess.id);
      throw new Error('生成结果保存失败，原对话已恢复：' + error.message);
    }
    target.cardScriptLibraryCommittedMessageIndex = idx;
    if (providerStopReason) toast('供应商中途拦截了这次回复（' + providerStopReason + '），已保存收到的部分', 'err');
    if (target.commitDisplayError) {
      // A stop reports once: the queued background task is already fenced and stays silent.
      if (target.commitDisplayError.name === 'AbortError') {
        if (generationPostCommitNoticeOnce(target)) toast('已停止卡片整理，回复仍已保存', 'info');
      } else reportGenerationPostCommitError(target, target.commitDisplayError);
      delete target.commitDisplayError;
    }
    if (directionBefore && typeof StoryDirection.notifyAdvance === 'function')
      StoryDirection.notifyAdvance(directionBefore, StoryDirection.progress(sess, sess.msgs));
    if (meta.streamDraftId) removeStreamDraftInMemory(meta.streamDraftId);
    var staleTask = markStreamDraftsStaleForSession(
      target.charId,
      target.sessionId,
      'base_changed',
      meta.streamDraftId
    );
    staleTask.catch(function (error) {
      console.warn('流式草稿失效标记失败', error);
    });
    // Publish the saved reply before invoking external script listeners.
    idx = sess.msgs.indexOf(reply);
    target.messageIndex = idx;
    var outputMessageOrderChanged =
      outputMessageOrder.length !== sess.msgs.length ||
      outputMessageOrder.some(function (row, index) {
        return (
          row.message !== sess.msgs[index] ||
          row.role !== row.message.role ||
          (row.message !== reply && row.content !== row.message.content)
        );
      });
    if (visible && ct && chatViewportTargetVisible(target) && outputMessageOrderChanged) renderChat();
    else if (idx >= 0 && visible && ct && chatViewportTargetVisible(target)) {
      var follow = _chatViewportOwner.mode === 'follow',
        readingAnchor = follow ? null : captureChatReadingAnchor(true),
        el =
          target.mode === 'new'
            ? document.getElementById('stream-msg') ||
              ct.querySelector('[data-msg-seq="' + (Number(reply.seq) || '') + '"]') ||
              ct.querySelector('[data-msg-idx="' + idx + '"]')
            : ct.querySelector('[data-msg-idx="' + idx + '"]');
      retainChatViewportRender();
      if (!follow) rememberChatViewportAnchor(readingAnchor);
      ct.classList.add('chat-anchor-lock');
      if (el) {
        clearStreamCursors(el);
        el.id = '';
        el.className = 'msg char';
        el.setAttribute('data-msg-idx', idx);
        if (Number(reply.seq) > 0) el.setAttribute('data-msg-seq', String(Number(reply.seq)));
        var timeStr = relativeTime(reply.time),
          body = el.querySelector('.msg-body'),
          bubble = body && body.querySelector(':scope > .msg-bubble'),
          replyParts = assistantMessageParts(reply),
          displayOptions = { preserveImages: true, depth: replyDepth },
          displayContent = regexScriptDisplayText(replyParts.content, 'assistant', char, reply, displayOptions),
          markdownOptions = {
            role: 'assistant',
            preserveImages: true,
            mediaAssets: (char && char.media_assets) || [],
            mediaOwnerId: char && char.id,
            frontendOwner: cardFrontendOwner(char, idx),
            frontendIncomplete: messageIsIncomplete(reply),
          },
          displayBody = assistantMessageDisplayHtml(
            replyParts.content,
            char,
            reply,
            displayOptions,
            markdownOptions,
            null,
            idx
          );
        if (body && bubble) {
          var slots = ensureStreamContentSlots(bubble);
          bubble.setAttribute('title', timeStr);
          bubble.setAttribute('onclick', 'toggleMessageActions(' + idx + ',event)');
          reconcileStreamHtml(slots.reasoning, reasoningBlockHtml(replyParts.reasoning, reply));
          reconcileStreamHtml(slots.content, displayBody);
          var generationHtml = generationMetaHtml(reply.generationMeta, reply),
            metaHtml = '<div class="msg-bubble-meta">' + messageTimeHtml(reply.time) + generationHtml + '</div>',
            metaNode = bubble.querySelector(':scope > .msg-bubble-meta');
          if (metaNode) reconcileStreamElement(metaNode, metaHtml);
          else reconcileStreamHtml(bubble, bubble.innerHTML + metaHtml);
          syncMessageMetaLayout(bubble, reply.time, generationHtml);
          slots.live.className = 'msg-live-text';
          var actionsHtml = messageActionsHtml(char, reply, idx),
            actions = body.querySelector(':scope > .msg-actions');
          if (actions) reconcileStreamElement(actions, actionsHtml);
          else {
            var actionsTemplate = document.createElement('template');
            actionsTemplate.innerHTML = actionsHtml;
            if (actionsTemplate.content.firstElementChild) body.appendChild(actionsTemplate.content.firstElementChild);
          }
        }
        clearStreamCursors(el);
        updateChatAnchors();
        syncTavernAudioSession();
        syncCardAssetObjectUrlLifecycle(char);
        syncCardFrontends(char);
        // The streamed Risu frame takes the committed display in place before the full display sync,
        // which then finds it current instead of remounting it.
        Promise.resolve(slots ? syncRisuStreamDisplays(char, sess, slots.content, sess.msgs) : false)
          .then(function (synced) {
            if (!synced) return syncRisuDisplays(char, sess, sess.msgs, 0);
          })
          .catch(function (error) {
            console.warn('Risu 原位提交演出挂载失败', error);
          });
        // Earlier messages may display the variables this reply's output wrote.
        if (isRisuCharacter(char)) risuRepaintDisplays();
      } else if (target.mode === 'new') appendMessageDom(char, reply, idx);
      if (follow) followChatBottomThroughMedia(el || ct, ct);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          ct.classList.remove('chat-anchor-lock');
        });
      });
    }
    refreshManualImageEntrypoints(char, sess);
    if (!meta.allowCancelledCommit && !messageIsIncomplete(reply))
      speechGenerated(target, char, sess, reply).catch(function () {
        toast('无法准备朗读文本', 'err');
      });
    publishUsage(meta.usage || null, target);
    releaseViewportState(meta.viewportState);
    if (_activeViewportState === meta.viewportState) _activeViewportState = null;
    scheduleTokensBar(char);
    async function afterReceived(waitOptions) {
      waitOptions = waitOptions || {};
      if (waitOptions.current && !waitOptions.current()) {
        reportGenerationSkippedTail(target);
        return;
      }
      try {
        await qrPerformAuto('executeOnAi', waitOptions);
      } catch (error) {
        reportGenerationPostCommitError(target, error);
      }
      // Quick replies in ST are the first CHARACTER_MESSAGE_RENDERED listener, so the card hears the
      // rendered reply right after executeOnAi.
      var renderedIndex = sess.msgs.indexOf(reply);
      if (renderedIndex >= 0) {
        try {
          await cardFrontendAwaitBroadcastEvent(
            CARD_FRONTEND_TAVERN_EVENT_VALUES.CHARACTER_MESSAGE_RENDERED,
            [renderedIndex, generationTypeForTarget(target)],
            waitOptions
          );
        } catch (error) {
          reportGenerationPostCommitError(target, error);
        }
      }
      if (!generationTargetStillLive(target, sess, waitOptions.signal)) {
        reportGenerationSkippedTail(target);
        return;
      }
      if (
        !meta.deferMemorySummary &&
        !meta.allowCancelledCommit &&
        !(reply.generationMeta && reply.generationMeta.incomplete) &&
        expressionEpoch === _expressionEpoch
      )
        autoClassifyExpression(char, sess, reply, waitOptions);
      if ((target.mode === 'new' || target.mode === 'continue') && !meta.deferMemorySummary)
        await runAutoMemorySummary(char, target.sessionId, waitOptions);
    }
    if (isRisuCharacter(char)) {
      // Risu sendAIprompt may reuse this target for another generation. Keep its
      // existing foreground lifecycle and let the coordinator finish that run.
      await afterReceived();
    } else {
      queueGenerationPostCommit(
        target,
        char,
        sess,
        reply,
        { signal: target.commitWaitController.signal, streamTokensDelivered: meta.streamTokensDelivered },
        async function (waitOptions) {
          await afterReceived(waitOptions);
          if (!generationTargetStillLive(target, sess, waitOptions.signal)) {
            reportGenerationSkippedTail(target);
            return;
          }
          if (!meta.deferMemorySummary) {
            target.presetAfterAiQueued = true;
            await notifyPresetTaskAfterAi(target, waitOptions);
          }
        }
      );
      releaseGenerationCommit();
      if (!meta.deferMemorySummary) finishGeneration(target);
    }
    return full;
  } catch (error) {
    if (target.risuRollback) {
      target.risuRollback();
      delete target.risuRollback;
    }
    if (!committed && mutation) mutation.rollback();
    throw error;
  } finally {
    releaseGenerationCommit();
  }
}
