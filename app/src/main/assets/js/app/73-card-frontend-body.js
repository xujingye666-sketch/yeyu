// Serialized into every same-origin card frontend iframe by 73-card-frontend.js and executed before
// the card's own scripts. Runtime calls bind directly to the real parent window; cards can also use
// window.parent and parent.document exactly as they do under TavernHelper 4.11.3.
// Behaviour reference for the injected API names and shapes: 酒馆助手 4.11.3 (tag 4.11.3 / 1292dbfa)
// predefine.js + src/function/index.ts. Only the contracted batches are injected; anything absent stays
// absent so a card's own `typeof xxx === 'function'` feature detection keeps working.
function cardFrontendFrameBody(token) {
  'use strict';
  var hostWindow = window.parent,
    config = hostWindow.cardFrontendDirectStartup(String(token || ''), window);
  // No config means the host cancelled this startup — the reader switched character or session while
  // this document was still loading — and is already recycling the frame. Nothing else of this
  // runtime is installed, so the card's own scripts find an inert page. These two are the exception:
  // the inline script cardFrontendDocument/cardScriptLibraryDocument put right after the dependency
  // tags calls them with no `typeof` guard, so leaving them undefined would throw from the very
  // document that is standing down. Every frame calls __yeyuCleanupDependenciesReady; only the script
  // library's document also calls __yeyuStartLibraryRows, and a library instance can be cancelled the
  // same way a message frame can. __yeyuDependencyError needs no stub — its only caller is the
  // onerror attribute on a dependency tag, which tests for it before calling.
  if (!config) {
    window.__yeyuCleanupDependenciesReady = function () {};
    window.__yeyuStartLibraryRows = window.__yeyuCleanupDependenciesReady;
    return;
  }
  var runtimeScript = document.currentScript;
  token = String(token || '');
  var reportedHeight = -1,
    reportedFullscreenWidth = -1,
    reportedFullscreenHeight = -1,
    heightQueued = false,
    hostFullscreenScrollStyle = null,
    hostHorizontalScrollOwners = new Set(),
    hostHorizontalScanDirty = true,
    hostHorizontalScannedAt = 0,
    hostHorizontalScanTimer = 0,
    hostHorizontalWidth = 0,
    layoutObserver = null,
    hostFullscreenTouchX = null,
    hostFullscreenTouchY = null,
    hostFullscreenTouchStartX = null,
    hostFullscreenTouchStartY = null,
    hostFullscreenTouchScreenX = null,
    hostFullscreenTouchScreenY = null,
    hostFullscreenTouchAxis = '',
    hostFullscreenOwnsRootScroll = false,
    hostFullscreenPinchDistance = 0,
    hostFullscreenPinchZoom = 1,
    hostFullscreenPanActive = false,
    hostFullscreenPanOwned = false,
    normalViewportHeight = Math.max(1, Math.floor(Number(config.viewportHeight) || 1)),
    hostFullscreen = false,
    hostFullscreenMode = '',
    hostFullscreenZoom = 1,
    hostFullscreenScale = 1,
    hostFullscreenLogicalHeight = 0,
    liveContext = config.liveContext === true,
    sillyTavernEnabled = config.sillyTavern === true,
    sillyTavernChat = Array.isArray(config.sillyTavernChat) ? config.sillyTavernChat : [],
    sillyTavernChatId = String(config.sillyTavernChatId || ''),
    extensionSettings =
      sillyTavernEnabled && config.extensionSettings && typeof config.extensionSettings === 'object'
        ? config.extensionSettings
        : {},
    scriptRows = Object.create(null),
    scriptUrls = [],
    soleScriptOwner = null,
    activeScript = null,
    activeEventSources = new Map(),
    scriptVariables = Object.create(null),
    globalInitializationWaiters = [],
    trackedAudioContexts = [],
    mediaStopped = false,
    cleanupParentWrites = null,
    publishParentRuntime = null;
  function clone(value) {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {}
    return JSON.parse(JSON.stringify(value));
  }
  function post(type, payload) {
    try {
      return hostWindow.cardFrontendDirectNotify(token, window, type, payload, currentEventSource()) !== false;
    } catch (_) {
      return false;
    }
  }
  function request(name, args) {
    try {
      return Promise.resolve(
        hostWindow.cardFrontendDirectCall(
          token,
          window,
          String(name),
          args === undefined ? null : args,
          currentEventSource()
        )
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  function requestSync(name, args) {
    return hostWindow.cardFrontendDirectCall(
      token,
      window,
      String(name),
      args === undefined ? null : args,
      currentEventSource()
    );
  }
  var hostFullscreenVirtualElement = null;
  function setHostFullscreenState(active) {
    var before = !!hostFullscreenVirtualElement;
    if (active) hostFullscreenVirtualElement = hostFullscreenVirtualElement || document.documentElement;
    else hostFullscreenVirtualElement = null;
    if (before !== !!hostFullscreenVirtualElement) {
      try {
        document.dispatchEvent(new Event('fullscreenchange'));
      } catch (_) {}
      try {
        document.dispatchEvent(new Event('webkitfullscreenchange'));
      } catch (_) {}
    }
  }
  function installHostFullscreenFacade() {
    function enter() {
      var element = this;
      hostFullscreenVirtualElement = element;
      if (hostFullscreen) return Promise.resolve();
      return request('requestFullscreen', { mode: 'desktop' }).then(function (ok) {
        if (ok !== true) {
          setHostFullscreenState(false);
          throw new Error('无法进入卡片全屏');
        }
      });
    }
    function exit() {
      return request('exitFullscreen', null).then(function () {
        setHostFullscreenState(false);
      });
    }
    try {
      Element.prototype.requestFullscreen = enter;
      Element.prototype.webkitRequestFullscreen = enter;
    } catch (_) {}
    try {
      document.exitFullscreen = exit;
      document.webkitExitFullscreen = exit;
    } catch (_) {}
    try {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: function () {
          return hostFullscreenVirtualElement;
        },
      });
      Object.defineProperty(document, 'webkitFullscreenElement', {
        configurable: true,
        get: function () {
          return hostFullscreenVirtualElement;
        },
      });
    } catch (_) {}
  }
  installHostFullscreenFacade();
  function trackAudioContext(name) {
    var Native = window[name];
    if (typeof Native !== 'function' || typeof Proxy !== 'function') return;
    try {
      var Wrapped = new Proxy(Native, {
        construct: function (target, args, newTarget) {
          var context = Reflect.construct(target, args, newTarget === Wrapped ? target : newTarget);
          trackedAudioContexts.push(context);
          return context;
        },
      });
      window[name] = Wrapped;
    } catch (_) {}
  }
  function stopRuntimeMedia() {
    if (mediaStopped) return { media: 0, contexts: 0 };
    mediaStopped = true;
    var mediaRows = Array.from(document.querySelectorAll('audio,video')),
      contexts = trackedAudioContexts.splice(0),
      paused = 0;
    mediaRows.forEach(function (media) {
      try {
        media.pause();
        paused++;
      } catch (_) {}
      try {
        media.removeAttribute('autoplay');
        media.removeAttribute('src');
        Array.from(media.querySelectorAll('source')).forEach(function (source) {
          source.removeAttribute('src');
        });
        media.load();
      } catch (_) {}
    });
    contexts.forEach(function (context) {
      try {
        var result =
          typeof context.close === 'function'
            ? context.close()
            : typeof context.suspend === 'function'
              ? context.suspend()
              : null;
        if (result && typeof result.catch === 'function') result.catch(function () {});
      } catch (_) {}
    });
    return { media: mediaRows.length, paused: paused, contexts: contexts.length };
  }
  trackAudioContext('AudioContext');
  trackAudioContext('webkitAudioContext');
  window.addEventListener('pagehide', stopRuntimeMedia);
  window.addEventListener('unload', stopRuntimeMedia);
  function reportUserAction(event) {
    if (event && event.isTrusted === false) return;
    post('userAction', {});
  }
  document.addEventListener('pointerdown', reportUserAction, true);
  document.addEventListener('keydown', reportUserAction, true);
  document.addEventListener('click', reportUserAction, true);
  // ---- size: normal mode reports layout extent; fullscreen also reports its independent content range ----
  function syncViewportHeight() {
    var fullscreen = document.fullscreenElement != null || hostFullscreen,
      current = fullscreen
        ? Math.max(
            1,
            Math.floor(
              hostFullscreenLogicalHeight ||
                Number((window.visualViewport && window.visualViewport.height) || window.innerHeight) ||
                normalViewportHeight
            )
          )
        : normalViewportHeight;
    var currentWidth = Math.max(
      1,
      Math.floor(Number((document.documentElement && document.documentElement.clientWidth) || window.innerWidth) || 1)
    );
    if (!fullscreen && currentWidth !== hostHorizontalWidth) {
      clearHostHorizontalScrollOwners();
      hostHorizontalWidth = currentWidth;
    }
    if (document.documentElement) {
      document.documentElement.style.setProperty('--TH-viewport-height', current + 'px');
      document.documentElement.style.setProperty('--TH-viewport-unit', current / 100 + 'px');
    }
    scheduleMeasure();
  }
  function clearHostHorizontalScrollOwners() {
    hostHorizontalScrollOwners.forEach(function (node) {
      if (node && node.nodeType === 1) {
        node.removeAttribute('data-yeyu-host-horizontal-scroll');
        node.scrollLeft = 0;
      }
    });
    hostHorizontalScrollOwners.clear();
    hostHorizontalScanDirty = true;
    // The owners are gone right now, so the rescan must not wait out the pace below.
    hostHorizontalScannedAt = 0;
  }
  function hostHorizontalControlVisible(control, styleOf) {
    if (!control || !control.isConnected) return false;
    for (var node = control; node && node !== document.documentElement; node = node.parentElement) {
      var style = styleOf(node);
      if (
        node.hidden ||
        node.hasAttribute('inert') ||
        String(node.getAttribute('aria-hidden') || '').toLowerCase() === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        style.transform !== 'none'
      )
        return false;
    }
    var rect = control.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }
  // The scan walks every control's ancestors with style and geometry reads. A running animation marks
  // it dirty every frame, so it trails changes at this pace instead; the last change is always scanned.
  var HOST_HORIZONTAL_SCAN_INTERVAL_MS = 200;
  function syncHostHorizontalScrollOwners() {
    if (hostFullscreen || !document.body || !hostHorizontalScanDirty) return false;
    var wait = hostHorizontalScannedAt + HOST_HORIZONTAL_SCAN_INTERVAL_MS - performance.now();
    if (wait > 0) {
      if (!hostHorizontalScanTimer)
        hostHorizontalScanTimer = setTimeout(function () {
          hostHorizontalScanTimer = 0;
          scheduleMeasure(false);
        }, wait);
      return false;
    }
    hostHorizontalScanDirty = false;
    hostHorizontalScannedAt = performance.now();
    var changed = false,
      selector =
        'a[href],button,input:not([type="hidden"]),select,textarea,label,summary,[role="button"],[onclick],[contenteditable="true"]',
      styleCache = new WeakMap(),
      rectCache = new WeakMap(),
      styleOf = function (node) {
        var style = styleCache.get(node);
        if (!style) {
          style = getComputedStyle(node);
          styleCache.set(node, style);
        }
        return style;
      },
      rectOf = function (node) {
        var rect = rectCache.get(node);
        if (!rect) {
          rect = node.getBoundingClientRect();
          rectCache.set(node, rect);
        }
        return rect;
      };
    hostHorizontalScrollOwners.forEach(function (owner) {
      if (!owner || !owner.isConnected || owner.scrollWidth <= owner.clientWidth + 2) {
        if (owner && owner.nodeType === 1) {
          owner.removeAttribute('data-yeyu-host-horizontal-scroll');
          owner.scrollLeft = 0;
        }
        hostHorizontalScrollOwners.delete(owner);
        changed = true;
        return;
      }
      var ownerRect = rectOf(owner),
        origin = ownerRect.left + (Number(owner.clientLeft) || 0),
        needed = Array.from(owner.querySelectorAll(selector)).some(function (control) {
          if (!hostHorizontalControlVisible(control, styleOf)) return false;
          var rect = rectOf(control),
            logicalLeft = rect.left - origin + (Number(owner.scrollLeft) || 0),
            logicalRight = rect.right - origin + (Number(owner.scrollLeft) || 0);
          return logicalLeft < -2 || logicalRight > owner.clientWidth + 2;
        });
      if (!needed) {
        owner.removeAttribute('data-yeyu-host-horizontal-scroll');
        owner.scrollLeft = 0;
        hostHorizontalScrollOwners.delete(owner);
        changed = true;
      }
    });
    Array.from(document.body.querySelectorAll(selector)).forEach(function (control) {
      if (!hostHorizontalControlVisible(control, styleOf)) return;
      var controlRect = rectOf(control);
      for (
        var ancestor = control.parentElement;
        ancestor && ancestor !== document.body && ancestor !== document.documentElement;
        ancestor = ancestor.parentElement
      ) {
        if (hostHorizontalScrollOwners.has(ancestor)) break;
        var style = styleOf(ancestor);
        if (style.overflowX !== 'hidden') continue;
        var rect = rectOf(ancestor),
          left = rect.left + (Number(ancestor.clientLeft) || 0),
          right = left + (Number(ancestor.clientWidth) || 0);
        if (controlRect.left >= left - 1 && controlRect.right <= right + 1) continue;
        if (
          controlRect.bottom <= rect.top + 2 ||
          controlRect.top >= rect.bottom - 2 ||
          ancestor.scrollWidth <= ancestor.clientWidth + 2
        )
          break;
        ancestor.setAttribute('data-yeyu-host-horizontal-scroll', '');
        hostHorizontalScrollOwners.add(ancestor);
        changed = true;
        break;
      }
    });
    return changed;
  }
  function documentLayoutExtent() {
    var doc = document.documentElement,
      body = document.body,
      bodyRect = body && body.getBoundingClientRect ? body.getBoundingClientRect() : null,
      width = Math.max(
        1,
        Math.ceil(
          Math.max((doc && doc.clientWidth) || 0, (body && body.offsetWidth) || 0, (bodyRect && bodyRect.width) || 0)
        )
      ),
      height = Math.max(
        1,
        Math.ceil(
          Math.max(
            (doc && doc.scrollHeight) || 0,
            (doc && doc.offsetHeight) || 0,
            (body && body.scrollHeight) || 0,
            (body && body.offsetHeight) || 0,
            (bodyRect && bodyRect.height) || 0
          )
        )
      ),
      positionCache = new WeakMap(),
      styleCache = new WeakMap(),
      styleOf = function (node) {
        var cached = styleCache.get(node);
        if (!cached) {
          cached = getComputedStyle(node);
          styleCache.set(node, cached);
        }
        return cached;
      },
      positionOf = function (node) {
        var cached = positionCache.get(node);
        if (cached) return cached;
        var parent = node && node.offsetParent,
          parentPosition = parent && parent.nodeType === 1 ? positionOf(parent) : { left: 0, top: 0 },
          value = {
            left: parentPosition.left + (Number(node && node.offsetLeft) || 0),
            top: parentPosition.top + (Number(node && node.offsetTop) || 0),
          };
        if (node) positionCache.set(node, value);
        return value;
      };
    if (body && body.querySelectorAll)
      Array.from(body.querySelectorAll('*')).forEach(function (node) {
        if (!node || /^(?:SCRIPT|STYLE|LINK|META)$/.test(node.tagName)) return;
        var position = positionOf(node),
          style = styleOf(node),
          right = position.left + (Number(node.offsetWidth) || 0),
          bottom = position.top + (Number(node.offsetHeight) || 0),
          ancestor = node.parentElement;
        if (style.overflowY === 'visible') bottom = Math.max(bottom, position.top + (Number(node.scrollHeight) || 0));
        while (ancestor && ancestor !== body && ancestor !== doc) {
          var ancestorStyle = styleOf(ancestor),
            ancestorPosition = positionOf(ancestor);
          if (ancestorStyle.overflowX !== 'visible')
            right = Math.min(right, ancestorPosition.left + (Number(ancestor.clientWidth) || 0));
          if (ancestorStyle.overflowY !== 'visible')
            bottom = Math.min(bottom, ancestorPosition.top + (Number(ancestor.clientHeight) || 0));
          ancestor = ancestor.parentElement;
        }
        width = Math.max(width, Math.ceil(right));
        height = Math.max(height, Math.ceil(bottom));
      });
    return { width: width, height: height };
  }
  function measure() {
    heightQueued = false;
    syncHostFixedOverflow(hostFullscreen && hostFullscreenMode === 'desktop');
    if (syncHostHorizontalScrollOwners()) scheduleMeasure(false);
    var doc = document.documentElement,
      body = document.body,
      fullscreen = document.fullscreenElement || hostFullscreen,
      extent = fullscreen ? documentLayoutExtent() : null,
      height = fullscreen
        ? extent.height
        : Math.ceil(
            Math.max(
              doc && doc.getBoundingClientRect ? doc.getBoundingClientRect().height : 0,
              body && body.getBoundingClientRect ? body.getBoundingClientRect().height : 0
            )
          ),
      contentWidth = fullscreen
        ? extent.width
        : Math.ceil(Math.max((doc && doc.scrollWidth) || 0, (body && body.scrollWidth) || 0));
    if (doc && doc.style.getPropertyValue('--yeyu-host-content-width') !== contentWidth + 'px') {
      doc.style.setProperty('--yeyu-host-content-width', contentWidth + 'px');
      // Only this write is queued here (no card code has run since the frame began), and observing it
      // would just measure again.
      if (layoutObserver) layoutObserver.takeRecords();
    }
    if (fullscreen) {
      if (contentWidth !== reportedFullscreenWidth || height !== reportedFullscreenHeight) {
        reportedFullscreenWidth = contentWidth;
        reportedFullscreenHeight = height;
        post('fullscreenContentSize', { width: contentWidth, height: height });
      }
      return;
    }
    if (height === reportedHeight) return;
    reportedHeight = height;
    post('height', {
      height: height,
      width: contentWidth,
      scrollHeight: Math.max((doc && doc.scrollHeight) || 0, (body && body.scrollHeight) || 0),
      scrollWidth: Math.max((doc && doc.scrollWidth) || 0, (body && body.scrollWidth) || 0),
    });
  }
  function scheduleMeasure(markHorizontal) {
    if (markHorizontal !== false) hostHorizontalScanDirty = true;
    if (heightQueued) return;
    heightQueued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else setTimeout(measure, 16);
  }
  function syncHostFixedOverflow(active) {
    if (!document.body) return;
    var marked = Array.from(document.querySelectorAll('[data-yeyu-host-scroll-fixed]'));
    if (!active) {
      marked.forEach(function (node) {
        node.removeAttribute('data-yeyu-host-scroll-fixed');
      });
      return;
    }
    Array.from(document.body.querySelectorAll('*')).forEach(function (node) {
      if (node.hasAttribute('data-yeyu-host-scroll-fixed')) return;
      var style = getComputedStyle(node);
      if (style.position === 'fixed' && style.overflowY === 'visible' && node.scrollHeight > node.clientHeight + 1)
        node.setAttribute('data-yeyu-host-scroll-fixed', '');
    });
  }
  function setHostFrameScrollMode(active) {
    var root = document.documentElement;
    if (!root) return;
    if (!hostFullscreenScrollStyle) {
      hostFullscreenScrollStyle = document.createElement('style');
      hostFullscreenScrollStyle.textContent =
        'html[data-yeyu-host-width-scroll]{overflow-x:auto!important;overflow-y:auto!important;overscroll-behavior-y:contain!important;-webkit-overflow-scrolling:touch}html[data-yeyu-host-width-scroll] body{overflow-x:visible!important}html[data-yeyu-host-width-scroll]::after{content:"";position:absolute;top:0;left:0;width:var(--yeyu-host-content-width,100%);height:1px;pointer-events:none}html[data-yeyu-host-viewport-scroll]{overflow:auto!important}html[data-yeyu-host-viewport-scroll] body{overflow:visible!important}[data-yeyu-host-scroll-fixed]{position:absolute!important}html:not([data-yeyu-host-fullscreen]) [data-yeyu-host-horizontal-scroll]{overflow-x:auto!important;overscroll-behavior-x:contain!important;-webkit-overflow-scrolling:touch}html[data-yeyu-host-fullscreen]{--vhfix:var(--TH-viewport-unit)!important}';
      (document.head || root).appendChild(hostFullscreenScrollStyle);
    }
    root.setAttribute('data-yeyu-host-width-scroll', '');
    if (active) clearHostHorizontalScrollOwners();
    else hostHorizontalScanDirty = true;
    if (active) {
      if (!root.hasAttribute('data-yeyu-host-viewport-scroll')) {
        var rootStyle = getComputedStyle(root),
          bodyStyle = document.body ? getComputedStyle(document.body) : null;
        hostFullscreenOwnsRootScroll = [rootStyle.overflowY, bodyStyle && bodyStyle.overflowY].some(function (value) {
          return /^(?:hidden|clip)$/.test(String(value || ''));
        });
      }
      root.setAttribute('data-yeyu-host-viewport-scroll', '');
    } else {
      root.removeAttribute('data-yeyu-host-viewport-scroll');
      hostFullscreenOwnsRootScroll = false;
    }
    syncHostFixedOverflow(active && hostFullscreenMode === 'desktop');
  }
  function hostFullscreenScrollableAncestor(target, delta, axis) {
    for (
      var node = target && target.nodeType === 1 ? target : target && target.parentElement;
      node && node !== document.body && node !== document.documentElement;
      node = node.parentElement
    ) {
      var style = getComputedStyle(node),
        horizontal = axis === 'horizontal',
        overflow = horizontal ? style.overflowX : style.overflowY,
        position = horizontal ? node.scrollLeft : node.scrollTop,
        client = horizontal ? node.clientWidth : node.clientHeight,
        size = horizontal ? node.scrollWidth : node.scrollHeight,
        scrollable = /^(?:auto|scroll|overlay)$/.test(overflow) && size > client + 1;
      if (scrollable && (delta > 0 ? position + client < size - 1 : delta < 0 && position > 0)) return true;
    }
    return false;
  }
  function hostFullscreenTouchDistance(touches) {
    var first = touches && touches[0],
      second = touches && touches[1];
    return first && second
      ? Math.hypot(Number(second.clientX) - Number(first.clientX), Number(second.clientY) - Number(first.clientY))
      : 0;
  }
  function hostFullscreenPinchPayload(touches, phase) {
    var first = touches[0],
      second = touches[1];
    return {
      phase: phase,
      kind: 'pinch',
      distance: hostFullscreenTouchDistance(touches),
      centerX: (Number(first.clientX) + Number(second.clientX)) / 2,
      centerY: (Number(first.clientY) + Number(second.clientY)) / 2,
      viewportWidth: Math.max(1, window.innerWidth),
      viewportHeight: Math.max(1, window.innerHeight),
    };
  }
  function hostFullscreenScreenPoint(touch) {
    var x = Number(touch && touch.screenX),
      y = Number(touch && touch.screenY);
    return {
      x: Number.isFinite(x) ? x : Number(touch && touch.clientX) || 0,
      y: Number.isFinite(y) ? y : Number(touch && touch.clientY) || 0,
    };
  }
  document.addEventListener(
    'touchstart',
    function (event) {
      if (hostFullscreen && hostFullscreenMode === 'desktop' && event.touches && event.touches.length === 2) {
        hostFullscreenPinchDistance = hostFullscreenTouchDistance(event.touches);
        hostFullscreenPinchZoom = hostFullscreenZoom;
        hostFullscreenTouchX = null;
        hostFullscreenTouchY = null;
        hostFullscreenTouchScreenX = null;
        hostFullscreenTouchScreenY = null;
        post('fullscreenGesture', hostFullscreenPinchPayload(event.touches, 'start'));
        event.preventDefault();
        return;
      }
      var touch = event.touches && event.touches.length === 1 ? event.touches[0] : null,
        screen = touch ? hostFullscreenScreenPoint(touch) : null;
      hostFullscreenTouchX = hostFullscreenTouchStartX = touch ? Number(touch.clientX) : null;
      hostFullscreenTouchY = hostFullscreenTouchStartY = touch ? Number(touch.clientY) : null;
      hostFullscreenTouchScreenX = screen ? screen.x : null;
      hostFullscreenTouchScreenY = screen ? screen.y : null;
      hostFullscreenTouchAxis = '';
      hostFullscreenPanActive = !!(touch && hostFullscreen && hostFullscreenMode === 'desktop');
      hostFullscreenPanOwned = false;
      if (hostFullscreenPanActive) post('fullscreenGesture', { phase: 'start', kind: 'pan' });
    },
    { capture: true, passive: false }
  );
  document.addEventListener(
    'touchmove',
    function (event) {
      if (
        hostFullscreen &&
        hostFullscreenMode === 'desktop' &&
        hostFullscreenPinchDistance > 0 &&
        event.touches &&
        event.touches.length === 2
      ) {
        var distance = hostFullscreenTouchDistance(event.touches);
        hostFullscreenZoom = Math.min(
          4,
          Math.max(1, (hostFullscreenPinchZoom * distance) / hostFullscreenPinchDistance)
        );
        post('fullscreenGesture', hostFullscreenPinchPayload(event.touches, 'move'));
        event.preventDefault();
        return;
      }
      if (hostFullscreenTouchX == null || hostFullscreenTouchY == null || !event.touches || event.touches.length !== 1)
        return;
      var currentTouch = event.touches[0],
        currentScreen = hostFullscreenScreenPoint(currentTouch),
        currentX = Number(currentTouch.clientX),
        currentY = Number(currentTouch.clientY),
        moveX = currentX - hostFullscreenTouchStartX,
        moveY = currentY - hostFullscreenTouchStartY,
        deltaX = hostFullscreenTouchX - currentX,
        delta = hostFullscreenTouchY - currentY,
        screenDeltaX = hostFullscreenTouchScreenX - currentScreen.x,
        screenDeltaY = hostFullscreenTouchScreenY - currentScreen.y,
        root = document.scrollingElement || document.documentElement;
      hostFullscreenTouchX = currentX;
      hostFullscreenTouchY = currentY;
      hostFullscreenTouchScreenX = currentScreen.x;
      hostFullscreenTouchScreenY = currentScreen.y;
      if (!Number.isFinite(delta) || !root) return;
      if (!hostFullscreenTouchAxis) {
        if (Math.max(Math.abs(moveX), Math.abs(moveY)) < 6) return;
        hostFullscreenTouchAxis = Math.abs(moveX) > Math.abs(moveY) ? 'horizontal' : 'vertical';
      }
      if (!hostFullscreen) {
        if (hostFullscreenTouchAxis === 'horizontal') return;
        var normalDelta = Math.max(-32, Math.min(32, Math.abs(screenDeltaY) >= 1 ? screenDeltaY : delta));
        if (hostFullscreenScrollableAncestor(event.target, normalDelta, 'vertical')) return;
        var normalCanScroll =
          delta > 0 ? root.scrollTop + root.clientHeight < root.scrollHeight - 1 : delta < 0 && root.scrollTop > 0;
        if (normalCanScroll) return;
        if (Math.abs(normalDelta) >= 1 && post('normalScroll', { delta: normalDelta })) event.preventDefault();
        return;
      }
      if (hostFullscreenTouchAxis === 'horizontal') {
        if (!hostFullscreenPanOwned && hostFullscreenScrollableAncestor(event.target, deltaX, 'horizontal')) return;
        if (hostFullscreenMode === 'desktop' && hostFullscreenZoom > 1.001) {
          hostFullscreenPanOwned = true;
          post('fullscreenGesture', {
            phase: 'pan',
            kind: 'pan',
            deltaX: Math.abs(screenDeltaX) >= 1 ? screenDeltaX : deltaX * hostFullscreenScale,
            deltaY: 0,
          });
          event.preventDefault();
        }
        return;
      }
      if (!hostFullscreenPanOwned && hostFullscreenScrollableAncestor(event.target, delta)) return;
      if (hostFullscreenMode === 'desktop') {
        var desktopDelta = Math.abs(screenDeltaY) >= 1 ? screenDeltaY : delta * hostFullscreenScale;
        if (Math.abs(desktopDelta) >= 1) {
          hostFullscreenPanOwned = true;
          if (hostFullscreenZoom > 1.001)
            post('fullscreenGesture', { phase: 'pan', kind: 'pan', deltaX: 0, deltaY: desktopDelta });
          else post('fullscreenScroll', { delta: desktopDelta });
          event.preventDefault();
        }
        return;
      }
      var rootConsumed = 0;
      if (!hostFullscreenPanOwned && hostFullscreenOwnsRootScroll && delta) {
        var before = root.scrollTop;
        root.scrollTop += delta;
        rootConsumed = root.scrollTop - before;
        delta -= rootConsumed;
        event.preventDefault();
      }
      var canScroll =
        !hostFullscreenPanOwned &&
        (delta > 0 ? root.scrollTop + root.clientHeight < root.scrollHeight - 1 : delta < 0 && root.scrollTop > 0);
      if (canScroll) return;
      var hostDelta = rootConsumed ? delta * hostFullscreenScale : screenDeltaY;
      if (Math.abs(hostDelta) >= 1) {
        hostFullscreenPanOwned = true;
        if (hostFullscreenMode === 'desktop' && hostFullscreenZoom > 1.001)
          post('fullscreenGesture', { phase: 'pan', kind: 'pan', deltaX: 0, deltaY: hostDelta });
        else post('fullscreenScroll', { delta: hostDelta });
        event.preventDefault();
      }
    },
    { capture: true, passive: false }
  );
  function hostFullscreenTouchFinish() {
    if (hostFullscreenPinchDistance > 0 || hostFullscreenPanActive)
      post('fullscreenGesture', { phase: 'end', kind: hostFullscreenPinchDistance > 0 ? 'pinch' : 'pan' });
    hostFullscreenPinchDistance = 0;
    hostFullscreenPanActive = false;
    hostFullscreenPanOwned = false;
    hostFullscreenTouchX = null;
    hostFullscreenTouchY = null;
    hostFullscreenTouchStartX = null;
    hostFullscreenTouchStartY = null;
    hostFullscreenTouchScreenX = null;
    hostFullscreenTouchScreenY = null;
    hostFullscreenTouchAxis = '';
  }
  document.addEventListener('touchend', hostFullscreenTouchFinish, { capture: true, passive: true });
  document.addEventListener('touchcancel', hostFullscreenTouchFinish, { capture: true, passive: true });
  // ---- remote images ----
  var failedImages = typeof WeakMap === 'function' ? new WeakMap() : null,
    watchedImages = typeof WeakSet === 'function' ? new WeakSet() : null;
  function remoteImageSource(image) {
    var raw = String((image && image.getAttribute && image.getAttribute('src')) || '').trim();
    if (!raw) return '';
    try {
      var resolved = new URL(raw, document.baseURI);
      return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : '';
    } catch (_) {
      return '';
    }
  }
  function imageDescriptor(image, src) {
    var template = image.cloneNode(false);
    template.removeAttribute('src');
    template.removeAttribute('srcset');
    return { src: src, alt: String(image.getAttribute('alt') || ''), template: template };
  }
  function failedImageNode(descriptor) {
    var box = document.createElement('span'),
      message = document.createElement('span'),
      address = document.createElement('span'),
      button = document.createElement('button');
    box.className = 'yeyu-frontend-image-failed';
    box.setAttribute('data-yeyu-image-src', descriptor.src);
    message.textContent = (descriptor.alt ? '“' + descriptor.alt + '”' : '') + '图片加载失败，请检查网络或原链接';
    address.className = 'yeyu-frontend-image-failed-address';
    address.textContent = descriptor.src;
    button.type = 'button';
    button.className = 'yeyu-frontend-image-retry';
    button.textContent = '重新加载';
    box.appendChild(message);
    box.appendChild(address);
    box.appendChild(button);
    if (failedImages) failedImages.set(box, descriptor);
    return box;
  }
  function failRemoteImage(image) {
    if (!image || !image.parentNode) return;
    var src = remoteImageSource(image);
    if (!src) return;
    image.replaceWith(failedImageNode(imageDescriptor(image, src)));
    scheduleMeasure();
  }
  function watchRemoteImages(root) {
    var rows = [];
    if (root && root.nodeType === 1 && root.tagName === 'IMG') rows.push(root);
    if (root && root.querySelectorAll) rows = rows.concat(Array.from(root.querySelectorAll('img')));
    rows.forEach(function (image) {
      if (!remoteImageSource(image)) return;
      if (image.complete) {
        if (image.naturalWidth <= 0) failRemoteImage(image);
        return;
      }
      if (watchedImages && watchedImages.has(image)) return;
      if (watchedImages) watchedImages.add(image);
      image.addEventListener(
        'error',
        function () {
          failRemoteImage(image);
        },
        { once: true }
      );
    });
  }
  function retryRemoteImage(box) {
    if (!box || !box.isConnected) return;
    var descriptor = failedImages && failedImages.get(box),
      src = String((descriptor && descriptor.src) || box.getAttribute('data-yeyu-image-src') || ''),
      requestSrc = src;
    if (!descriptor || !src) return;
    try {
      var retryUrl = new URL(src);
      retryUrl.searchParams.set('_yeyu_retry', Date.now().toString(36));
      requestSrc = retryUrl.href;
    } catch (_) {}
    var loading = document.createElement('span'),
      image = descriptor.template.cloneNode(false),
      settled = false;
    loading.className = 'yeyu-frontend-image-loading';
    loading.textContent = '图片加载中';
    box.replaceWith(loading);
    function live() {
      return !settled && loading.isConnected;
    }
    function loaded() {
      if (!live() || !image.complete || image.naturalWidth <= 0) return;
      settled = true;
      loading.replaceWith(image);
      scheduleMeasure();
    }
    function failed() {
      if (!live()) return;
      settled = true;
      loading.replaceWith(failedImageNode(descriptor));
      scheduleMeasure();
    }
    image.addEventListener('load', loaded, { once: true, capture: true });
    image.addEventListener('error', failed, { once: true, capture: true });
    image.setAttribute('data-yeyu-src', src);
    image.setAttribute('src', requestSrc);
    if (image.complete) {
      if (image.naturalWidth > 0) loaded();
      else failed();
    }
  }
  document.addEventListener(
    'error',
    function (event) {
      var image = event.target;
      if (image && image.tagName === 'IMG') failRemoteImage(image);
    },
    true
  );
  document.addEventListener(
    'click',
    function (event) {
      var button = event.target && event.target.closest && event.target.closest('button.yeyu-frontend-image-retry');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      retryRemoteImage(button.closest('.yeyu-frontend-image-failed'));
    },
    true
  );
  // Size changes of any kind reach the ResizeObserver. The mutation observer only adds what it cannot
  // see: nodes coming and going (remote images, new controls) and the attributes that move layout or
  // decide which controls the horizontal-owner scan considers. Text edits, and the data-* attributes
  // that cards and this runtime rewrite constantly, stay out of it.
  var HOST_LAYOUT_ATTRIBUTES = [
    'class',
    'style',
    'hidden',
    'inert',
    'aria-hidden',
    'open',
    'src',
    'width',
    'height',
    'href',
    'role',
    'type',
    'onclick',
    'contenteditable',
  ];
  function watchLayout() {
    if (typeof ResizeObserver === 'function') {
      var resize = new ResizeObserver(scheduleMeasure);
      if (document.documentElement) resize.observe(document.documentElement);
      if (document.body) resize.observe(document.body);
    }
    if (typeof MutationObserver === 'function' && document.documentElement) {
      layoutObserver = new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.from(record.addedNodes || []).forEach(function (node) {
            watchRemoteImages(node);
          });
        });
        scheduleMeasure();
      });
      layoutObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: HOST_LAYOUT_ATTRIBUTES,
      });
    }
    document.addEventListener('load', scheduleMeasure, true);
    document.addEventListener('error', scheduleMeasure, true);
    document.addEventListener('fullscreenchange', syncViewportHeight);
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function')
      window.visualViewport.addEventListener('resize', syncViewportHeight);
    window.addEventListener('load', scheduleMeasure);
    setHostFrameScrollMode(false);
    watchRemoteImages(document.documentElement);
    syncViewportHeight();
  }
  // ---- seven variable scopes; every write goes through the host's canonical owner ----
  // A script owns whatever runs from the URLs its code lives in. Stack frames always name the address
  // the browser resolved, which percent-encodes every non-ASCII character, so an address the card
  // writes literally — 酒馆助手's own CDN paths carry Chinese directory names — is only recognised once
  // both spellings are registered.
  function registerScriptUrl(row, url) {
    var raw = String(url || '');
    if (!raw) return;
    var forms = [raw];
    try {
      var resolved = new URL(raw, location.href).href;
      if (forms.indexOf(resolved) < 0) forms.push(resolved);
    } catch (_) {}
    forms.forEach(function (form) {
      scriptUrls.push({ url: form, row: row });
    });
    soleScriptOwner = scriptUrls.every(function (entry) {
      return entry.row === row;
    })
      ? row
      : null;
  }
  function scriptUrlOwner(stack) {
    var text = String(stack || '');
    if (!text) return null;
    for (var i = 0; i < scriptUrls.length; i++) if (text.indexOf(scriptUrls[i].url) >= 0) return scriptUrls[i].row;
    return null;
  }
  // A default V8 stack stops at ten frames, which a framework's own dispatch can fill before the
  // card's own frame appears. The limit is raised for this one capture and restored immediately.
  function currentStack() {
    var limit = Error.stackTraceLimit;
    try {
      if (typeof limit === 'number' && limit < 64) Error.stackTraceLimit = 64;
      return String(new Error().stack || '');
    } catch (_) {
      return '';
    } finally {
      try {
        Error.stackTraceLimit = limit;
      } catch (__) {}
    }
  }
  // Every timer, frame callback and listener a script hands over asks for its owner, and a script's
  // animation loop does so on every frame. While all registered addresses belong to the script already
  // running, the stack could only name that same script, so it is not captured.
  function currentScriptOwner() {
    if (!scriptUrls.length) return activeScript;
    if (activeScript && activeScript === soleScriptOwner) return activeScript;
    return scriptUrlOwner(currentStack()) || activeScript;
  }
  function currentEventSource() {
    if (!activeEventSources.size) return '';
    var source = currentStack().match(/yeyu-event-run:([a-z0-9]+):/),
      scope = source && activeEventSources.get(source[1]);
    // A detached timer outlives its completed listener without borrowing another listener's run.
    // Cancellation remains attached to captured callbacks after the original listener ends.
    return scope && (scope.pending || scope.signal.aborted) ? source[1] : '';
  }
  // A timer or listener a script hands over keeps its owner. Stack matching already covers every
  // continuation whose code sits in the script's own file, but a bundle's chunk address is not in the
  // card source and cannot be registered, so the owner is captured where the callback is handed over.
  function bindScriptCallback(callback, inheritEvent) {
    if (typeof callback !== 'function') return callback;
    var owner = currentScriptOwner(),
      eventSource = inheritEvent ? currentEventSource() : '',
      eventScope = activeEventSources.get(eventSource),
      eventSignal = eventScope && eventScope.signal;
    if (!owner && !eventSource) return callback;
    return function () {
      var previous = activeScript;
      activeScript = owner || previous;
      try {
        if (eventSource)
          return window.__yeyuInvokeEventListener(
            callback.bind(this),
            Array.from(arguments),
            eventSource,
            false,
            eventSignal
          );
        return callback.apply(this, arguments);
      } finally {
        activeScript = previous;
      }
    };
  }
  function installAsyncCallbackBinding() {
    ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask'].forEach(
      function (name) {
        var original = window[name];
        if (typeof original !== 'function') return;
        window[name] = function (callback) {
          var args = Array.prototype.slice.call(arguments);
          args[0] = bindScriptCallback(callback, true);
          return original.apply(window, args);
        };
      }
    );
  }
  function installScriptOwnerBinding() {
    var prototype = window.EventTarget && window.EventTarget.prototype;
    if (!prototype || typeof prototype.addEventListener !== 'function') return;
    var add = prototype.addEventListener,
      remove = prototype.removeEventListener,
      bound = new WeakMap();
    prototype.addEventListener = function (type, listener) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof listener === 'function') {
        if (!bound.has(listener)) {
          var wrapped = bindScriptCallback(listener);
          if (wrapped !== listener) bound.set(listener, wrapped);
        }
        args[1] = bound.get(listener) || listener;
      }
      return add.apply(this, args);
    };
    prototype.removeEventListener = function (type, listener) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof listener === 'function' && bound.has(listener)) args[1] = bound.get(listener);
      return remove.apply(this, args);
    };
  }
  function scriptContext() {
    var row = currentScriptOwner();
    if (row) return row;
    throw new Error('当前调用不属于已登记的脚本库条目');
  }
  function scriptId() {
    return String(scriptContext().id || '');
  }
  var SCOPES = { message: 1, chat: 1, global: 1, script: 1, character: 1, preset: 1, extension: 1 };
  function scopeOf(option) {
    var type = String((option && option.type) || 'chat');
    if (!SCOPES[type]) throw new Error('变量作用域无效：' + type);
    return type;
  }
  function hostVariableOption(option) {
    var value = clone(option && typeof option === 'object' ? option : {}),
      type = scopeOf(value);
    value.type = type;
    if (type === 'script' && !value.script_id) {
      var row = scriptContext();
      value.script_id = String(row.id || '');
      value.script_scope = String(row.scope || '');
    }
    return value;
  }
  function getVariables(option) {
    return clone(requestSync('getVariables', { option: hostVariableOption(option) }));
  }
  function assignDeep(target, source) {
    Object.keys(source || {}).forEach(function (key) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
      var next = source[key];
      // lodash merge keeps an existing value when the patch carries undefined for it.
      if (next === undefined && Object.prototype.hasOwnProperty.call(target, key)) return;
      if (
        next &&
        typeof next === 'object' &&
        !Array.isArray(next) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      )
        assignDeep(target[key], next);
      else target[key] = clone(next);
    });
    return target;
  }
  function writeVariables(type, operation, value, merged, option) {
    replaceVariables(merged, option);
    return clone(merged);
  }
  function insertOrAssignVariables(updates, option) {
    var type = scopeOf(option),
      patch = updates && typeof updates === 'object' ? updates : {},
      current = getVariables(option);
    var merged = assignDeep(current, patch);
    return writeVariables(type, 'assign', patch, merged, option);
  }
  function insertVariables(updates, option) {
    var type = scopeOf(option),
      incoming = clone(updates && typeof updates === 'object' ? updates : {}),
      current = getVariables(option),
      merged = assignDeep(incoming, current);
    return writeVariables(type, 'insert', incoming, merged, option);
  }
  function updateVariablesWith(updater, option) {
    var resolved = hostVariableOption(option),
      type = scopeOf(resolved),
      current = getVariables(resolved);
    if (typeof updater !== 'function') throw new Error('updateVariablesWith 需要一个函数参数');
    var next = updater(current);
    if (next && typeof next.then === 'function')
      return next.then(function (value) {
        value = value === undefined ? current : value;
        return writeVariables(type, 'replace', value, value, resolved);
      });
    var value = next === undefined ? current : next;
    return writeVariables(type, 'replace', value, value, resolved);
  }
  function replaceVariables(next, option) {
    var value = clone(next && typeof next === 'object' ? next : {});
    requestSync('replaceVariables', { value: value, option: hostVariableOption(option) });
  }
  function deleteVariable(path, option) {
    var type = scopeOf(option),
      current = getVariables(option),
      removed = window._ && typeof window._.unset === 'function' ? window._.unset(current, String(path || '')) : false;
    replaceVariables(current, option);
    return { variables: current, delete_occurred: removed === true };
  }
  function getAllVariables() {
    var row = null;
    try {
      row = scriptContext();
    } catch (_) {}
    return clone(
      requestSync('getAllVariables', {
        option: { message_id: config.messageId, script_id: row && row.id, script_scope: row && row.scope },
      })
    );
  }
  function registerVariableSchema(schema, option) {
    var type = String((option && option.type) || '');
    if (!['global', 'preset', 'character', 'chat', 'message'].includes(type))
      throw new Error('schema 作用域无效：' + type);
    requestSync('registerVariableSchema', { schema: schema, type: type });
  }
  // ---- events: constants match JS-Slash-Runner 4.11.3; delivery remains source-driven ----
  // The async trampoline stays in this realm: V8 retains its address through both await and returned
  // promise continuations. An unrelated DOM callback has no such ancestor, even in the same frame.
  window.__yeyuInvokeEventListener = function (handler, args, source, track, signal) {
    var invoke = new Function(
      'handler',
      'args',
      'return (async function () { return await handler.apply(null, args); })();\n//# sourceURL=yeyu-event-run:' +
        source
    );
    var scope = activeEventSources.get(source) || { signal: signal, pending: false, depth: 0 };
    if (track) scope.pending = true;
    scope.depth++;
    activeEventSources.set(source, scope);
    return invoke(handler, args).finally(function () {
      if (track) scope.pending = false;
      if (--scope.depth === 0) activeEventSources.delete(source);
    });
  };
  var tavern_events = clone(config.tavernEventValues || {}),
    iframe_events = clone(config.iframeEventValues || {}),
    eventAliases = {};
  Object.keys(tavern_events).forEach(function (key) {
    eventAliases[tavern_events[key]] = tavern_events[key];
  });
  Object.keys(iframe_events).forEach(function (key) {
    eventAliases[iframe_events[key]] = iframe_events[key];
  });
  function eventName(name) {
    var key = String(name == null ? '' : name);
    if (tavern_events[key]) return tavern_events[key];
    if (iframe_events[key]) return iframe_events[key];
    var matched = eventAliases[key];
    if (matched) return matched;
    if (key) return key;
    throw new Error('事件名不能为空');
  }
  function eventOn(name, handler) {
    var key = eventName(name);
    if (typeof handler !== 'function') throw new Error('eventOn 需要一个函数监听器');
    requestSync('eventRegister', { name: key, handler: handler, once: false });
    return {
      stop: function () {
        eventRemoveListener(key, handler);
      },
    };
  }
  function eventOnce(name, handler) {
    var key = eventName(name);
    if (typeof handler !== 'function') throw new Error('eventOnce 需要一个函数监听器');
    requestSync('eventRegister', { name: key, handler: handler, once: true });
    return {
      stop: function () {
        eventRemoveListener(key, handler);
      },
    };
  }
  function eventRemoveListener(name, handler) {
    return requestSync('eventRemove', { name: eventName(name), handler: handler }) === true;
  }
  function eventClearEvent(name) {
    requestSync('eventClearEvent', { name: eventName(name) });
  }
  function eventClearListener(handler) {
    requestSync('eventClearListener', { handler: handler });
  }
  function eventClearAll() {
    requestSync('eventClearAll', null);
  }
  window.addEventListener(
    'pagehide',
    function () {
      try {
        requestSync('clearOwnerRegistrations', null);
      } catch (_) {}
    },
    { once: true }
  );
  function eventMakeFirst(name, handler) {
    var key = eventName(name);
    if (typeof handler !== 'function') throw new Error('eventMakeFirst 需要一个函数监听器');
    requestSync('eventRegister', { name: key, handler: handler, once: false, position: 'first' });
    return {
      stop: function () {
        eventRemoveListener(key, handler);
      },
    };
  }
  function eventMakeLast(name, handler) {
    var key = eventName(name);
    if (typeof handler !== 'function') throw new Error('eventMakeLast 需要一个函数监听器');
    requestSync('eventRegister', { name: key, handler: handler, once: false, position: 'last' });
    return {
      stop: function () {
        eventRemoveListener(key, handler);
      },
    };
  }
  function eventOnButton(eventType, handler) {
    return eventOn(getButtonEvent(eventType), handler);
  }
  function eventDispatch(name, args, transfer) {
    var key = eventName(name),
      initialized = key.match(/^global_(.+)_initialized$/);
    if (initialized && vendor._.has(hostWindow, initialized[1])) {
      if (initialized[1] !== 'Mvu' || mvuGlobalInitialized()) exposeInitializedGlobal(initialized[1]);
      flushGlobalInitializationWaiters();
    }
    return request('eventEmit', {
      name: key,
      args: transfer ? args : clone(args),
      eventSource: currentEventSource(),
    });
  }
  function eventEmit(name) {
    return eventDispatch(name, Array.prototype.slice.call(arguments, 1), false);
  }
  function eventEmitAndWait(name) {
    var key = eventName(name),
      args = Array.prototype.slice.call(arguments, 1);
    requestSync('eventEmitAndWait', { name: key, args: clone(args), eventSource: currentEventSource() });
  }
  function sillyTavernEventOn(name, handler) {
    var key = String(name == null ? '' : name);
    if (!key || typeof handler !== 'function') throw new Error('SillyTavern.eventSource.on 需要事件名和监听器');
    eventOn(key, handler);
  }
  function sillyTavernEventOff(name, handler) {
    return eventRemoveListener(String(name == null ? '' : name), handler);
  }
  function sillyTavernEventEmit(name) {
    return eventEmit.apply(null, [String(name == null ? '' : name)].concat(Array.prototype.slice.call(arguments, 1)));
  }
  // ---- toasts and error surfacing ----
  function toastClear(handle) {
    var id = handle && handle.__yeyuToastId ? String(handle.__yeyuToastId) : '';
    return hostWindow.cardFrontendDirectToastClear(token, window, id, currentEventSource());
  }
  function toastShow(level, message, title, override) {
    var options = {},
      base = toastr.options && typeof toastr.options === 'object' ? toastr.options : {};
    Object.keys(base).forEach(function (key) {
      options[key] = base[key];
    });
    if (override && typeof override === 'object')
      Object.keys(override).forEach(function (key) {
        options[key] = override[key];
      });
    return hostWindow.cardFrontendDirectToast(
      token,
      window,
      level,
      String(message == null ? '' : message),
      String(title == null ? '' : title),
      options,
      currentEventSource()
    );
  }
  var toastr = {
    options: {},
    info: function (message, title, options) {
      return toastShow('info', message, title, options);
    },
    success: function (message, title, options) {
      return toastShow('success', message, title, options);
    },
    warning: function (message, title, options) {
      return toastShow('warning', message, title, options);
    },
    error: function (message, title, options) {
      return toastShow('error', message, title, options);
    },
    clear: toastClear,
    remove: toastClear,
  };
  // TavernHelper's optional cleanup protector is retained for the resident script iframe. It does
  // not gate access: reads and calls still reach the real host objects, while writes and host DOM
  // nodes created through parent.document are recorded so pagehide can reverse this iframe's work.
  function installCleanupProtector() {
    if (typeof Proxy !== 'function') return;
    var originalParent = hostWindow,
      writes = new Map(),
      owner = 'yeyu-' + token,
      parentDocument = originalParent.document,
      parentDocumentProxy = null,
      parentProxy = null,
      parentJQuery = originalParent.$ && originalParent.$.fn && originalParent.$.fn.jquery ? originalParent.$ : null,
      customJQuery = null,
      observer = null;
    function markTree(node) {
      if (!node || node.nodeType !== 1) return node;
      node.setAttribute('data-yeyu-frontend-owner', owner);
      for (var child = node.firstElementChild; child; child = child.nextElementSibling) markTree(child);
      return node;
    }
    function isHtml(value) {
      var text = typeof value === 'string' ? value.trim() : '';
      return text.length >= 3 && text[0] === '<' && text[text.length - 1] === '>';
    }
    function hostAccessCurrent() {
      try {
        return originalParent.cardFrontendDirectAlive(token, window) === true;
      } catch (_) {
        return false;
      }
    }
    function mappedSelector(value) {
      return String(value || '')
        .replace(/#send_textarea\b/g, '#user-input')
        .replace(/#send_but\b/g, '#composer-action-btn');
    }
    function convertHtmlArgs(args) {
      return Array.prototype.map.call(args, function (value) {
        if (!isHtml(value) || !parentJQuery) return value;
        try {
          var row = parentJQuery(value);
          row.each(function () {
            markTree(this);
          });
          return row;
        } catch (_) {
          return value;
        }
      });
    }
    try {
      parentDocumentProxy = new Proxy(parentDocument, {
        get: function (target, prop) {
          if (prop === 'createElement')
            return function () {
              return markTree(target.createElement.apply(target, arguments));
            };
          if (prop === 'createElementNS')
            return function () {
              return markTree(target.createElementNS.apply(target, arguments));
            };
          if (prop === 'getElementById')
            return function (value) {
              return hostAccessCurrent()
                ? target.getElementById(mappedSelector('#' + String(value || '')).slice(1))
                : null;
            };
          if (prop === 'querySelector')
            return function (value) {
              return hostAccessCurrent() ? target.querySelector(mappedSelector(value)) : null;
            };
          if (prop === 'querySelectorAll')
            return function (value) {
              return hostAccessCurrent() ? target.querySelectorAll(mappedSelector(value)) : [];
            };
          var value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    } catch (_) {
      parentDocumentProxy = parentDocument;
    }
    try {
      parentProxy = new Proxy(originalParent, {
        get: function (target, prop) {
          if (['parent', 'window', 'self', 'top', 'globalThis'].indexOf(prop) >= 0) return parentProxy;
          if (prop === '$' || prop === 'jQuery') return customJQuery || Reflect.get(target, prop);
          if (prop === 'document') return parentDocumentProxy;
          var value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set: function (target, prop, value) {
          if (!writes.has(prop)) writes.set(prop, { exists: prop in target, value: target[prop] });
          return Reflect.set(target, prop, value);
        },
        deleteProperty: function (target, prop) {
          if (!writes.has(prop)) writes.set(prop, { exists: prop in target, value: target[prop] });
          return Reflect.deleteProperty(target, prop);
        },
      });
      Object.defineProperty(window, 'parent', {
        configurable: true,
        enumerable: true,
        get: function () {
          return parentProxy;
        },
        set: function () {},
      });
      var topDescriptor = Object.getOwnPropertyDescriptor(window, 'top');
      if (!topDescriptor || topDescriptor.configurable)
        Object.defineProperty(window, 'top', {
          configurable: true,
          enumerable: true,
          get: function () {
            return parentProxy;
          },
          set: function () {},
        });
    } catch (_) {
      parentProxy = originalParent;
    }
    try {
      var create = document.createElement,
        createNs = document.createElementNS,
        clone = Node.prototype.cloneNode;
      document.createElement = function () {
        return markTree(create.apply(this, arguments));
      };
      document.createElementNS = function () {
        return markTree(createNs.apply(this, arguments));
      };
      Node.prototype.cloneNode = function (deep) {
        var row = clone.call(this, deep);
        try {
          if (this.nodeType === 1 && this.closest('[data-yeyu-frontend-owner="' + owner + '"]')) markTree(row);
        } catch (_) {}
        return row;
      };
      observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          Array.from(mutation.addedNodes || []).forEach(function (node) {
            if (node && node.nodeType === 1 && node.getAttribute('data-yeyu-frontend-owner') !== owner) markTree(node);
          });
        });
      });
      observer.observe(document, { childList: true, subtree: true });
    } catch (_) {}
    function installJQuery(base) {
      if (!base || !base.fn || !base.fn.jquery || customJQuery) return;
      parentJQuery = base;
      customJQuery = function (selector, context) {
        if (typeof selector === 'string' && !isHtml(selector)) selector = mappedSelector(selector);
        var result = parentJQuery(selector, context === undefined ? parentDocument : context);
        Object.setPrototypeOf(result, customJQuery.fn);
        if (isHtml(selector))
          result.each(function () {
            markTree(this);
          });
        return result;
      };
      Object.setPrototypeOf(customJQuery, parentJQuery);
      customJQuery.fn = customJQuery.prototype = Object.create(parentJQuery.fn);
      customJQuery.fn.constructor = customJQuery;
      ['append', 'prepend', 'before', 'after', 'html'].forEach(function (method) {
        customJQuery.fn[method] = function () {
          var result = parentJQuery.fn[method].apply(this, convertHtmlArgs(arguments));
          if (result && result.jquery) Object.setPrototypeOf(result, customJQuery.fn);
          return result;
        };
      });
    }
    installJQuery(parentJQuery);
    window.__yeyuCleanupDependenciesReady = function () {
      installJQuery(window.jQuery || window.$);
    };
    cleanupParentWrites = function () {
      writes.forEach(function (state, prop) {
        try {
          if (state.exists) originalParent[prop] = state.value;
          else delete originalParent[prop];
        } catch (_) {}
      });
      writes.clear();
      try {
        var selector = '[data-yeyu-frontend-owner="' + owner.replace(/"/g, '') + '"]',
          tagged = Array.from(parentDocument.querySelectorAll(selector));
        tagged
          .filter(function (node) {
            return !node.parentElement || !node.parentElement.closest(selector);
          })
          .forEach(function (node) {
            node.remove();
          });
      } catch (_) {}
      if (observer) observer.disconnect();
    };
    publishParentRuntime = function (name, value) {
      if (!writes.has(name)) writes.set(name, { exists: name in originalParent, value: originalParent[name] });
      originalParent[name] = value;
    };
    window.addEventListener('pagehide', cleanupParentWrites, { once: true });
    if (sillyTavernEnabled)
      try {
        parentProxy.__ACU_USERSCRIPT_BRIDGE__ = {
          extension_settings: extensionSettings,
          saveSettings: saveSettings,
          saveSettingsDebounced: saveSettingsDebounced,
        };
      } catch (_) {}
  }
  // The error carries the frames where it was raised, which name the failing script even when the
  // reporting turn no longer has an owner of its own; the host needs that id to fail one script
  // instead of the whole library.
  function reportError(error) {
    var stack = '';
    try {
      stack = String((error && error.stack) || '');
    } catch (_) {}
    var row = scriptUrlOwner(stack) || activeScript,
      owner = row && row.name ? '脚本库「' + row.name + '」：' : '';
    post('error', {
      message: owner + String((error && error.message) || error || '卡片前端运行出错'),
      scriptId: row ? String(row.id || '') : '',
      scriptName: row ? String(row.name || '') : '',
    });
  }
  window.__yeyuDependencyError = function (url) {
    reportError(new Error('依赖加载失败：' + String(url || '未知地址')));
  };
  // ---- direct host delivery ----
  window.__yeyuHostDeliver = function (type, incoming) {
    var payload = incoming || {};
    if (type === 'shutdown') {
      var result = stopRuntimeMedia();
      scriptUrls.splice(0).forEach(function (row) {
        try {
          URL.revokeObjectURL(row.url);
        } catch (_) {}
      });
      try {
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
      } catch (_) {
        try {
          window.dispatchEvent(new Event('pagehide'));
        } catch (__) {}
      }
      post('shutdownComplete', result);
      return;
    }
    if (type === 'normalLayout') {
      normalViewportHeight = Math.max(1, Math.floor(Number(payload.viewportHeight) || 1));
      syncViewportHeight();
      return;
    }
    if (type === 'fullscreenLayout') {
      hostFullscreen = payload.active === true;
      hostFullscreenMode = hostFullscreen ? String(payload.mode || '') : '';
      hostFullscreenZoom = hostFullscreen ? Math.min(4, Math.max(1, Number(payload.zoom) || 1)) : 1;
      hostFullscreenScale = hostFullscreen ? Math.max(0.0001, Number(payload.scale) || 1) : 1;
      hostFullscreenLogicalHeight = hostFullscreen ? Math.max(1, Number(payload.logicalViewportHeight) || 0) : 0;
      if (document.documentElement) {
        if (hostFullscreen) document.documentElement.setAttribute('data-yeyu-host-fullscreen', '');
        else document.documentElement.removeAttribute('data-yeyu-host-fullscreen');
      }
      if (!hostFullscreen) {
        reportedFullscreenWidth = -1;
        reportedFullscreenHeight = -1;
        hostFullscreenTouchFinish();
      }
      setHostFullscreenState(hostFullscreen);
      setHostFrameScrollMode(hostFullscreen);
      syncViewportHeight();
      return;
    }
    if (type === 'fullscreenViewport') {
      var viewportRoot = document.scrollingElement || document.documentElement;
      if (viewportRoot) viewportRoot.scrollTop = Math.max(0, Number(payload.top) || 0);
      scheduleMeasure();
      return;
    }
    if (type === 'context') {
      if (payload.preserveChat !== true) {
        config.messageId = Math.max(0, Math.floor(Number(payload.messageId) || 0));
        config.lastMessageId = Math.max(0, Math.floor(Number(payload.lastMessageId) || 0));
      }
      if (sillyTavernEnabled && payload.preserveChat !== true) {
        sillyTavernChat.splice.apply(
          sillyTavernChat,
          [0, sillyTavernChat.length].concat(
            clone(Array.isArray(payload.sillyTavernChat) ? payload.sillyTavernChat : [])
          )
        );
        sillyTavernChatId = String(payload.sillyTavernChatId || sillyTavernChatId);
      }
      flushGlobalInitializationWaiters();
      return;
    }
    if (type === 'sillyTavernEvent' && sillyTavernEnabled) {
      var eventArgs = Array.isArray(payload.args) ? payload.args : [],
        eventId = String(payload.eventId || '');
      Promise.resolve(eventDispatch(String(payload.name || ''), eventArgs, true)).then(
        function () {
          if (eventId) post('sillyTavernEventResult', { eventId: eventId, chat: clone(sillyTavernChat) });
        },
        function (error) {
          reportError(error);
          if (eventId) post('sillyTavernEventResult', { eventId: eventId, chat: clone(sillyTavernChat) });
        }
      );
      return;
    }
  };
  window.addEventListener('error', function (event) {
    var detail = event && (event.error || event.message);
    if (hostWindow.cardFrontendIgnoresRuntimeError(detail)) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    reportError(detail);
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  });
  window.addEventListener('unhandledrejection', function (event) {
    reportError(event && event.reason);
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  });
  // ---- injected surface ----
  var vendor = hostWindow.YeyuMvuVendor;
  if (!vendor || !vendor.z || !vendor._ || typeof vendor.parseYaml !== 'function')
    throw new Error('卡片前端本地工具组件未加载');
  var zodNamespace = Object.assign({}, vendor.z, { z: vendor.z });
  window.z = zodNamespace;
  window._ = vendor._;
  window.YAML = {
    parse: vendor.parseYaml,
    stringify: vendor.stringifyYaml,
    parseDocument: function (value) {
      var parsed = vendor.parseYaml(String(value == null ? '' : value));
      return {
        toJS: function () {
          return parsed;
        },
      };
    },
  };
  var EjsTemplate = hostWindow.EjsTemplate;
  if (!EjsTemplate) throw new Error('EjsTemplate 宿主运行时未加载');
  window.EjsTemplate = EjsTemplate;
  function promptTemplateSettingsSnapshot() {
    return EjsTemplate.getFeatures();
  }
  var promptTemplateSettingsView =
    typeof Proxy === 'function'
      ? new Proxy(
          {},
          {
            get: function (_, prop) {
              if (prop === 'toJSON') return promptTemplateSettingsSnapshot;
              return promptTemplateSettingsSnapshot()[prop];
            },
            set: function (_, prop, value) {
              var update = {};
              update[prop] = value;
              EjsTemplate.setFeatures(update);
              return true;
            },
            has: function (_, prop) {
              return prop in promptTemplateSettingsSnapshot();
            },
            ownKeys: function () {
              return Reflect.ownKeys(promptTemplateSettingsSnapshot());
            },
            getOwnPropertyDescriptor: function (_, prop) {
              var snapshot = promptTemplateSettingsSnapshot();
              return prop in snapshot
                ? { configurable: true, enumerable: true, value: snapshot[prop], writable: true }
                : undefined;
            },
          }
        )
      : promptTemplateSettingsSnapshot();
  if (sillyTavernEnabled)
    Object.defineProperty(extensionSettings, 'EjsTemplate', {
      configurable: true,
      enumerable: false,
      get: function () {
        return promptTemplateSettingsView;
      },
    });
  function getIframeName() {
    try {
      var row = scriptContext();
      return 'TH-script--' + String(row.name || '') + '--' + String(row.id || '');
    } catch (_) {}
    var frame = window.frameElement,
      cached = window.__TH_IFRAME_ID || window.name;
    if (frame && frame.id) {
      window.__TH_IFRAME_ID = frame.id;
      if (!window.name) window.name = frame.id;
      return frame.id;
    }
    if (cached) {
      if (!window.name) window.name = cached;
      return cached;
    }
    throw new TypeError('frameElement is null while resolving iframe id');
  }
  function getMessageId(iframeName) {
    var match = String(iframeName || '').match(/^TH-message--(\d+)--\d+(_\d+)?$/);
    if (!match)
      throw new Error(
        '获取 ' + String(iframeName || '') + ' 所在楼层 id 时出错: 不要对全局脚本 iframe 调用 getMessageId!'
      );
    return parseInt(match[1], 10);
  }
  function getScriptId() {
    return scriptId();
  }
  function getCurrentMessageId() {
    if (!liveContext) return hostWindow.cardFrontendDirectConfig(token, window).messageId;
    return getMessageId(getIframeName());
  }
  function getLastMessageId() {
    return hostWindow.cardFrontendDirectConfig(token, window).lastMessageId;
  }
  function reloadIframe() {
    window.location.reload();
  }
  function errorCatched(fn) {
    if (typeof fn !== 'function') throw new Error('errorCatched 需要函数');
    return function () {
      var args = arguments;
      try {
        var result = fn.apply(this, args);
        return result && typeof result.then === 'function'
          ? result.catch(function (error) {
              toastr.error(
                '<pre style="white-space: pre-wrap">' +
                  String((error && error.stack) || (error && error.message) || error) +
                  '</pre>',
                String((error && error.name) || 'Error'),
                { escapeHtml: false }
              );
              throw error;
            })
          : result;
      } catch (error) {
        toastr.error(
          '<pre style="white-space: pre-wrap">' +
            String((error && error.stack) || (error && error.message) || error) +
            '</pre>',
          String((error && error.name) || 'Error'),
          { escapeHtml: false }
        );
        throw error;
      }
    };
  }
  function macroVariable(type, path, context) {
    var option = { type: type };
    if (type === 'message')
      option.message_id = context && context.message_id != null ? context.message_id : config.messageId;
    var value = vendor._.get(getVariables(option), vendor._.unescape(String(path || '')), null);
    return value;
  }
  function applyBuiltinMacroLikes(text, context) {
    return String(text).replace(
      /\{\{get_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi,
      function (_, type, path) {
        var value = macroVariable(type, path, context);
        return typeof value === 'string' ? value : JSON.stringify(value);
      }
    );
  }
  function registerMacroLike(regex, replace) {
    var isRegex = regex instanceof RegExp || Object.prototype.toString.call(regex) === '[object RegExp]';
    if (!isRegex || typeof replace !== 'function') throw new Error('registerMacroLike 需要 RegExp 和替换函数');
    requestSync('registerMacroLike', { regex: regex, replace: replace });
    return {
      unregister: function () {
        unregisterMacroLike(regex);
      },
    };
  }
  function unregisterMacroLike(regex) {
    return requestSync('unregisterMacroLike', { regex: regex }) === true;
  }
  function substitudeMacros(value) {
    var context = { message_id: config.messageId },
      text = String(
        requestSync('substitudeMacros', { value: String(value == null ? '' : value), messageId: config.messageId })
      );
    text = applyBuiltinMacroLikes(text, context);
    return String(requestSync('applyMacroLikes', { value: text, context: context }));
  }
  function initializeGlobal(name, value) {
    name = String(name || '');
    if (!name) throw new Error('全局名称不能为空');
    vendor._.set(hostWindow, name, value);
    if (name !== 'Mvu' || mvuGlobalInitialized()) exposeInitializedGlobal(name);
    eventEmit('global_' + name + '_initialized');
  }
  function mvuGlobalInitialized() {
    try {
      return requestSync('isMvuDataReady', null) === true;
    } catch (_) {
      return false;
    }
  }
  function exposeInitializedGlobal(name) {
    if (!vendor._.has(hostWindow, name)) return false;
    Object.defineProperty(window, name, {
      get: function () {
        return vendor._.get(hostWindow, name);
      },
      set: function () {},
      configurable: true,
    });
    return true;
  }
  function flushGlobalInitializationWaiters() {
    globalInitializationWaiters.slice().forEach(function (row) {
      var ready =
        row.name === 'Mvu'
          ? vendor._.has(hostWindow, 'Mvu') && mvuGlobalInitialized()
          : vendor._.has(hostWindow, row.name);
      if (ready) row.finish();
    });
  }
  function waitGlobalInitialized(name, options) {
    name = String(name || '');
    options = options || {};
    var signal = options.signal,
      timeoutMs = options.timeoutMs == null ? NaN : Number(options.timeoutMs);
    if (signal && signal.aborted) {
      var aborted = new Error('等待 ' + name + ' 初始化已停止');
      aborted.name = 'AbortError';
      return Promise.reject(aborted);
    }
    if (vendor._.has(hostWindow, name) && (name !== 'Mvu' || mvuGlobalInitialized())) {
      exposeInitializedGlobal(name);
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var row = {
        name: name,
        done: false,
        noticeTimer: null,
        timeoutTimer: null,
        poll: null,
        close: function (error) {
          if (row.done) return;
          row.done = true;
          globalInitializationWaiters = globalInitializationWaiters.filter(function (item) {
            return item !== row;
          });
          clearTimeout(row.noticeTimer);
          clearTimeout(row.timeoutTimer);
          clearInterval(row.poll);
          window.removeEventListener('pagehide', onPageHide);
          if (signal) signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else {
            exposeInitializedGlobal(name);
            resolve();
          }
        },
        finish: function () {
          row.close(null);
        },
      };
      function onAbort() {
        var error = new Error('等待 ' + name + ' 初始化已停止');
        error.name = 'AbortError';
        row.close(error);
      }
      function onPageHide() {
        onAbort();
      }
      window.addEventListener('pagehide', onPageHide, { once: true });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      row.noticeTimer = setTimeout(function () {
        if (!row.done) post('globalWait', { name: name });
      }, 5000);
      if (Number.isFinite(timeoutMs) && timeoutMs >= 0)
        row.timeoutTimer = setTimeout(function () {
          var error = new Error('等待 ' + name + ' 初始化超时（' + timeoutMs + 'ms）');
          error.name = 'TimeoutError';
          row.close(error);
        }, timeoutMs);
      row.poll = setInterval(flushGlobalInitializationWaiters, 50);
      globalInitializationWaiters.push(row);
      flushGlobalInitializationWaiters();
    });
  }
  function getTavernVersion() {
    return '1.19.0';
  }
  function getTavernHelperVersion() {
    return '4.11.3';
  }
  function getFrontendVersion() {
    return '4.11.3';
  }
  function updateFrontendVersion() {
    throw new Error('夜欲绑定 JS-Slash-Runner 4.11.3，不提供在线更新接口');
  }
  function updateTavernHelper() {
    throw new Error('夜欲绑定 JS-Slash-Runner 4.11.3，不提供在线更新接口');
  }
  function playAudio(type, audio) {
    requestSync('playAudio', { values: [type, clone(audio)] });
  }
  function pauseAudio(type) {
    requestSync('pauseAudio', { values: [type] });
  }
  function getAudioList(type) {
    return clone(requestSync('getAudioList', { values: [type] }));
  }
  function replaceAudioList(type, list) {
    requestSync('replaceAudioList', { values: [type, clone(Array.isArray(list) ? list : [])] });
  }
  function appendAudioList(type, list) {
    requestSync('appendAudioList', { values: [type, clone(Array.isArray(list) ? list : [])] });
  }
  function getAudioSettings(type) {
    return clone(requestSync('getAudioSettings', { values: [type] }));
  }
  function setAudioSettings(type, settings) {
    requestSync('setAudioSettings', { values: [type, clone(settings || {})] });
  }
  function getCurrentAudio(type) {
    return clone(requestSync('getCurrentAudio', { values: [type] }));
  }
  function audioEnable() {
    return '';
  }
  function audioPlay(args) {
    args = args || {};
    var type = String(args.type || '').toLowerCase();
    if (type !== 'bgm' && type !== 'ambient') return '';
    requestSync('setAudioPlaying', { values: [type, Boolean(args.play == null ? 'true' : args.play)] });
    return '';
  }
  function audioMode(args) {
    args = args || {};
    var mapped = { single: 'repeat_one', repeat: 'repeat_all', random: 'shuffle', stop: 'play_one_and_stop' }[
        String(args.mode || '').toLowerCase()
      ],
      type = String(args.type || '').toLowerCase();
    if (!mapped || (type !== 'bgm' && type !== 'ambient')) return '';
    setAudioSettings(type, { mode: mapped });
    return '';
  }
  function audioSelect(args, url) {
    args = args || {};
    var type = String(args.type || '').toLowerCase(),
      source = String(url || '');
    if (!source || (type !== 'bgm' && type !== 'ambient')) return '';
    playAudio(type, { url: source });
    return '';
  }
  function audioImport(args, url) {
    args = args || {};
    var type = String(args.type || '').toLowerCase(),
      sources = Array.from(
        new Set(
          String(url || '')
            .split(',')
            .map(function (row) {
              return row.trim();
            })
            .filter(Boolean)
        )
      ),
      rows = type === 'bgm' || type === 'ambient' ? getAudioList(type) : [];
    if (!sources.length || (type !== 'bgm' && type !== 'ambient')) return '';
    var known = new Set(
        rows.map(function (row) {
          return row.url;
        })
      ),
      added = sources
        .filter(function (row) {
          return !known.has(row);
        })
        .map(function (row) {
          return { url: row };
        });
    if (!added.length) return '';
    appendAudioList(type, added);
    if (Boolean(args.play == null ? 'true' : args.play)) playAudio(type, added[0]);
    return '';
  }
  function getChatMessages(range, option) {
    return clone(
      requestSync('getChatMessages', {
        range: range === undefined ? getCurrentMessageId() : range,
        option: option || null,
      })
    );
  }
  function setChatMessage(message, messageId, option) {
    return request('setChatMessage', { message: clone(message), messageId: messageId, option: option || null });
  }
  function setChatMessages(updates, option) {
    return request('setChatMessages', {
      updates: Array.isArray(updates) ? clone(updates) : [],
      option: option || null,
    });
  }
  function createChatMessages(messages, option) {
    return request('createChatMessages', {
      messages: Array.isArray(messages) ? clone(messages) : [],
      option: option || null,
    });
  }
  function deleteChatMessages(messageIds, option) {
    return request('deleteChatMessages', {
      messageIds: Array.isArray(messageIds) ? clone(messageIds) : [],
      option: option || null,
    });
  }
  function rotateChatMessages(begin, middle, end, option) {
    return request('rotateChatMessages', { begin: begin, middle: middle, end: end, option: option || null });
  }
  function triggerSlash(command) {
    return request('triggerSlash', {
      command: String(command == null ? '' : command),
      eventSource: currentEventSource(),
    });
  }
  var triggerSlashWithResult = triggerSlash;
  function generate(config) {
    return request('generate', { config: config && typeof config === 'object' ? config : {} });
  }
  function generateRaw(config) {
    return request('generateRaw', { config: config && typeof config === 'object' ? config : {} });
  }
  function stopGenerationById(generationId) {
    return requestSync('stopGenerationById', { generationId: String(generationId || '') }) === true;
  }
  function stopAllGeneration() {
    return requestSync('stopAllGeneration', null) === true;
  }
  function getModelList(config) {
    return request('getModelList', { config: config && typeof config === 'object' ? config : {} });
  }
  function getProxyPresetNames() {
    return clone(requestSync('getProxyPresetNames', null));
  }
  var builtin_prompt_default_order = [
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
  function hostPresetCall(name, args) {
    var fn = hostWindow && hostWindow[name];
    if (typeof fn !== 'function') throw new Error('夜欲预设接口未加载：' + name);
    return fn.apply(hostWindow, args || []);
  }
  function isPresetNormalPrompt(prompt) {
    return hostPresetCall('isPresetNormalPrompt', [prompt]);
  }
  function isPresetSystemPrompt(prompt) {
    return hostPresetCall('isPresetSystemPrompt', [prompt]);
  }
  function isPresetPlaceholderPrompt(prompt) {
    return hostPresetCall('isPresetPlaceholderPrompt', [prompt]);
  }
  var default_preset = clone(hostWindow.default_preset);
  function getPresetNames() {
    return clone(hostPresetCall('getPresetNames'));
  }
  function getLoadedPresetName() {
    return hostPresetCall('getLoadedPresetName');
  }
  function loadPreset(name) {
    return hostPresetCall('loadPreset', [name]);
  }
  function createPreset(name, preset) {
    return hostPresetCall('createPreset', [name, preset]);
  }
  function createOrReplacePreset(name, preset, options) {
    return hostPresetCall('createOrReplacePreset', [name, preset, options]);
  }
  function deletePreset(name) {
    return hostPresetCall('deletePreset', [name]);
  }
  function renamePreset(oldName, newName) {
    return hostPresetCall('renamePreset', [oldName, newName]);
  }
  function getPreset(name) {
    return clone(hostPresetCall('getPreset', [name]));
  }
  function replacePreset(name, preset, options) {
    return hostPresetCall('replacePreset', [name, preset, options]);
  }
  function updatePresetWith(name, updater, options) {
    return hostPresetCall('updatePresetWith', [name, updater, options]);
  }
  function setPreset(name, preset, options) {
    return hostPresetCall('setPreset', [name, preset, options]);
  }
  function saveSettings() {
    return request('saveSettings', { extensionSettings: clone(extensionSettings) });
  }
  function saveSettingsDebounced() {
    if (!post('settings', { extensionSettings: clone(extensionSettings) }))
      throw new Error('卡片运行实例所属的角色或对话已经切换');
  }
  function getWorldbook(name) {
    return request('getWorldbook', { name: String(name == null ? '' : name) });
  }
  function loadWorldInfo(name) {
    return request('loadWorldInfo', { name: String(name == null ? '' : name) });
  }
  function getLorebooks() {
    return clone(requestSync('getLorebooks', null));
  }
  function getLorebookEntries(name, option) {
    return request('getLorebookEntries', { name: String(name == null ? '' : name), option: option || null });
  }
  function getCharLorebooks(option) {
    option = option || {};
    return clone(requestSync('getCharLorebooks', { name: option.name || 'current' }));
  }
  function getCurrentCharPrimaryLorebook() {
    return requestSync('getCurrentCharPrimaryLorebook', null);
  }
  function getLorebookSettings() {
    return clone(requestSync('getLorebookSettings', null));
  }
  function setLorebookSettings(value) {
    requestSync('setLorebookSettings', { value: clone(value || {}) });
  }
  function replaceLorebookEntries(name, entries) {
    return request('replaceLorebookEntries', {
      name: String(name || ''),
      entries: Array.isArray(entries) ? clone(entries) : [],
    });
  }
  function updateLorebookEntriesWith(name, updater) {
    if (typeof updater !== 'function') throw new Error('updateLorebookEntriesWith 需要 updater');
    return getLorebookEntries(name).then(function (rows) {
      return Promise.resolve(updater(rows)).then(function (entries) {
        return request('updateLorebookEntriesWith', {
          name: String(name || ''),
          entries: Array.isArray(entries) ? clone(entries) : [],
        });
      });
    });
  }
  function createLorebookEntries(name, entries) {
    return request('createLorebookEntries', {
      name: String(name == null ? '' : name),
      entries: Array.isArray(entries) ? clone(entries) : [],
    });
  }
  function setLorebookEntries(name, entries) {
    return request('setLorebookEntries', {
      name: String(name == null ? '' : name),
      entries: Array.isArray(entries) ? clone(entries) : [],
    });
  }
  function deleteLorebookEntries(name, uids) {
    return request('deleteLorebookEntries', {
      name: String(name == null ? '' : name),
      uids: Array.isArray(uids) ? clone(uids) : [],
    });
  }
  function createLorebookEntry(name, entry) {
    return createLorebookEntries(name, [entry || {}]).then(function (result) {
      return result.new_uids[0];
    });
  }
  function deleteLorebookEntry(name, uid) {
    return deleteLorebookEntries(name, [uid]).then(function (result) {
      return result.delete_occurred === true;
    });
  }
  function createLorebook(name) {
    return request('createLorebook', { name: String(name || '') });
  }
  function deleteLorebook(name) {
    return request('deleteLorebook', { name: String(name || '') });
  }
  function setCurrentCharLorebooks(value) {
    return request('setCurrentCharLorebooks', { value: clone(value || {}) });
  }
  function getChatLorebook() {
    return requestSync('getChatLorebook', null);
  }
  function setChatLorebook(name) {
    return request('setChatLorebook', { name: name == null ? null : String(name) });
  }
  function getOrCreateChatLorebook(name) {
    return request('getOrCreateChatLorebook', { name: name == null ? null : String(name) });
  }
  function getWorldbookNames() {
    return clone(requestSync('getWorldbookNames', null));
  }
  function getGlobalWorldbookNames() {
    return clone(requestSync('getGlobalWorldbookNames', null));
  }
  function rebindGlobalWorldbooks(names) {
    return request('rebindGlobalWorldbooks', { names: Array.isArray(names) ? clone(names) : [] });
  }
  function getCharWorldbookNames(name) {
    return clone(requestSync('getCharWorldbookNames', { name: String(name || 'current') }));
  }
  function rebindCharWorldbooks(name, value) {
    if (String(name || 'current') !== 'current') throw new Error('只允许重绑当前角色世界书');
    return request('rebindCharWorldbooks', { name: 'current', value: clone(value || {}) });
  }
  function getChatWorldbookName(name) {
    if (String(name || 'current') !== 'current') throw new Error('只允许读取当前聊天世界书');
    return requestSync('getChatWorldbookName', null);
  }
  function rebindChatWorldbook(name, worldbook) {
    if (String(name || 'current') !== 'current') throw new Error('只允许重绑当前聊天世界书');
    return request('rebindChatWorldbook', { name: worldbook == null ? null : String(worldbook) });
  }
  function getOrCreateChatWorldbook(name, worldbook) {
    if (String(name || 'current') !== 'current') throw new Error('只允许操作当前聊天世界书');
    return request('getOrCreateChatWorldbook', { name: worldbook == null ? null : String(worldbook) });
  }
  function createWorldbook(name, entries) {
    return request('createWorldbook', {
      name: String(name || ''),
      entries: Array.isArray(entries) ? clone(entries) : [],
    });
  }
  function createOrReplaceWorldbook(name, entries, option) {
    return request('createOrReplaceWorldbook', {
      name: String(name || ''),
      entries: Array.isArray(entries) ? clone(entries) : [],
      option: clone(option || {}),
    });
  }
  function deleteWorldbook(name) {
    return request('deleteWorldbook', { name: String(name || '') });
  }
  function replaceWorldbook(name, entries, option) {
    return request('replaceWorldbook', {
      name: String(name || ''),
      entries: Array.isArray(entries) ? clone(entries) : [],
      option: clone(option || {}),
    });
  }
  function updateWorldbookWith(name, updater, option) {
    if (typeof updater !== 'function') throw new Error('updateWorldbookWith 需要 updater');
    return getWorldbook(name).then(function (rows) {
      return Promise.resolve(updater(rows)).then(function (entries) {
        return request('updateWorldbookWith', {
          name: String(name || ''),
          entries: Array.isArray(entries) ? clone(entries) : [],
          option: clone(option || {}),
        });
      });
    });
  }
  function createWorldbookEntries(name, entries, option) {
    var start = 0;
    return updateWorldbookWith(
      name,
      function (rows) {
        start = rows.length;
        return rows.concat(Array.isArray(entries) ? entries : []);
      },
      option
    ).then(function (rows) {
      return { worldbook: rows, new_entries: rows.slice(start) };
    });
  }
  function deleteWorldbookEntries(name, predicate, option) {
    if (typeof predicate !== 'function') throw new Error('deleteWorldbookEntries 需要 predicate');
    var deleted = [];
    return updateWorldbookWith(
      name,
      function (rows) {
        return rows.filter(function (row) {
          if (predicate(row)) {
            deleted.push(clone(row));
            return false;
          }
          return true;
        });
      },
      option
    ).then(function (rows) {
      return { worldbook: rows, deleted_entries: deleted };
    });
  }
  var Mvu = {
    events: {
      VARIABLE_INITIALIZED: 'mag_variable_initialized',
      VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
      COMMAND_PARSED: 'mag_command_parsed',
      VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
      BEFORE_MESSAGE_UPDATE: 'mag_before_message_update',
      SINGLE_VARIABLE_UPDATED: 'mag_variable_updated',
    },
    getMvuData: function (option) {
      return getVariables(option);
    },
    replaceMvuData: function (data, option) {
      return replaceVariables(data, option);
    },
    getMvuVariable: function (data, path, option) {
      var source = Mvu.getRecordFromMvuData(data, (option && option.category) || 'stat'),
        value = vendor._.get(source, path, option && option.default_value);
      return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string' ? value[0] : value;
    },
    getRecordFromMvuData: function (data, category) {
      return data && data[{ stat: 'stat_data', display: 'display_data', delta: 'delta_data' }[category]];
    },
    getCurrentMvuData: function () {
      return getVariables({ type: 'message', message_id: getCurrentMessageId() });
    },
    replaceCurrentMvuData: async function (data) {
      return replaceVariables(data, { type: 'message', message_id: getCurrentMessageId() });
    },
  };
  ['parseMessage', 'setMvuVariable', 'reloadInitVar'].forEach(function (name) {
    Mvu[name] = function () {
      return request('mvuCall', { name: name, args: Array.from(arguments) });
    };
  });
  var TavernHelper = {
    getVariables: getVariables,
    getAllVariables: getAllVariables,
    replaceVariables: replaceVariables,
    insertOrAssignVariables: insertOrAssignVariables,
    insertVariables: insertVariables,
    deleteVariable: deleteVariable,
    updateVariablesWith: updateVariablesWith,
    registerVariableSchema: registerVariableSchema,
    getChatMessages: getChatMessages,
    setChatMessages: setChatMessages,
    setChatMessage: setChatMessage,
    createChatMessages: createChatMessages,
    deleteChatMessages: deleteChatMessages,
    rotateChatMessages: rotateChatMessages,
    getCurrentMessageId: getCurrentMessageId,
    getLastMessageId: getLastMessageId,
    eventOn: eventOn,
    eventOnce: eventOnce,
    eventMakeFirst: eventMakeFirst,
    eventMakeLast: eventMakeLast,
    eventOnButton: eventOnButton,
    eventEmit: eventEmit,
    eventEmitAndWait: eventEmitAndWait,
    eventRemoveListener: eventRemoveListener,
    eventClearEvent: eventClearEvent,
    eventClearListener: eventClearListener,
    eventClearAll: eventClearAll,
    triggerSlash: triggerSlash,
    triggerSlashWithResult: triggerSlashWithResult,
    generate: generate,
    generateRaw: generateRaw,
    stopGenerationById: stopGenerationById,
    stopAllGeneration: stopAllGeneration,
    getModelList: getModelList,
    getProxyPresetNames: getProxyPresetNames,
    builtin_prompt_default_order: builtin_prompt_default_order,
    playAudio: playAudio,
    pauseAudio: pauseAudio,
    getAudioList: getAudioList,
    replaceAudioList: replaceAudioList,
    appendAudioList: appendAudioList,
    getAudioSettings: getAudioSettings,
    setAudioSettings: setAudioSettings,
    getCurrentAudio: getCurrentAudio,
    audioEnable: audioEnable,
    audioPlay: audioPlay,
    audioSelect: audioSelect,
    audioImport: audioImport,
    audioMode: audioMode,
    initializeGlobal: initializeGlobal,
    waitGlobalInitialized: waitGlobalInitialized,
    registerMacroLike: registerMacroLike,
    unregisterMacroLike: unregisterMacroLike,
    reloadIframe: reloadIframe,
    substitudeMacros: substitudeMacros,
    errorCatched: errorCatched,
    getIframeName: getIframeName,
    getScriptId: getScriptId,
    getMessageId: getMessageId,
    getTavernVersion: getTavernVersion,
    getTavernHelperVersion: getTavernHelperVersion,
    getFrontendVersion: getFrontendVersion,
    updateFrontendVersion: updateFrontendVersion,
    updateTavernHelper: updateTavernHelper,
    getLorebookSettings: getLorebookSettings,
    setLorebookSettings: setLorebookSettings,
    getLorebooks: getLorebooks,
    createLorebook: createLorebook,
    deleteLorebook: deleteLorebook,
    getCharLorebooks: getCharLorebooks,
    setCurrentCharLorebooks: setCurrentCharLorebooks,
    getCurrentCharPrimaryLorebook: getCurrentCharPrimaryLorebook,
    getChatLorebook: getChatLorebook,
    setChatLorebook: setChatLorebook,
    getOrCreateChatLorebook: getOrCreateChatLorebook,
    getLorebookEntries: getLorebookEntries,
    replaceLorebookEntries: replaceLorebookEntries,
    updateLorebookEntriesWith: updateLorebookEntriesWith,
    createLorebookEntries: createLorebookEntries,
    createLorebookEntry: createLorebookEntry,
    setLorebookEntries: setLorebookEntries,
    deleteLorebookEntries: deleteLorebookEntries,
    deleteLorebookEntry: deleteLorebookEntry,
    getWorldbookNames: getWorldbookNames,
    getGlobalWorldbookNames: getGlobalWorldbookNames,
    rebindGlobalWorldbooks: rebindGlobalWorldbooks,
    getCharWorldbookNames: getCharWorldbookNames,
    rebindCharWorldbooks: rebindCharWorldbooks,
    getChatWorldbookName: getChatWorldbookName,
    rebindChatWorldbook: rebindChatWorldbook,
    getOrCreateChatWorldbook: getOrCreateChatWorldbook,
    createWorldbook: createWorldbook,
    createOrReplaceWorldbook: createOrReplaceWorldbook,
    deleteWorldbook: deleteWorldbook,
    getWorldbook: getWorldbook,
    replaceWorldbook: replaceWorldbook,
    updateWorldbookWith: updateWorldbookWith,
    createWorldbookEntries: createWorldbookEntries,
    deleteWorldbookEntries: deleteWorldbookEntries,
    getScriptTrees: getScriptTrees,
    replaceScriptTrees: replaceScriptTrees,
    updateScriptTreesWith: updateScriptTreesWith,
    getAllEnabledScriptButtons: getAllEnabledScriptButtons,
    formatAsTavernRegexedString: formatAsTavernRegexedString,
    isCharacterTavernRegexesEnabled: isCharacterTavernRegexesEnabled,
    getTavernRegexes: getTavernRegexes,
    replaceTavernRegexes: replaceTavernRegexes,
    updateTavernRegexesWith: updateTavernRegexesWith,
    isPresetNormalPrompt: isPresetNormalPrompt,
    isPresetSystemPrompt: isPresetSystemPrompt,
    isPresetPlaceholderPrompt: isPresetPlaceholderPrompt,
    default_preset: default_preset,
    getPresetNames: getPresetNames,
    getLoadedPresetName: getLoadedPresetName,
    loadPreset: loadPreset,
    createPreset: createPreset,
    createOrReplacePreset: createOrReplacePreset,
    deletePreset: deletePreset,
    renamePreset: renamePreset,
    getPreset: getPreset,
    replacePreset: replacePreset,
    updatePresetWith: updatePresetWith,
    setPreset: setPreset,
  };
  [
    'getCharacterNames',
    'getCharacterIds',
    'getCurrentCharacterName',
    'getCurrentCharacterId',
    'getCharData',
    'getCharAvatarPath',
    'getPersonaNames',
    'getPersonaIds',
    'getCurrentPersonaName',
    'getCurrentPersonaId',
    'getPersonaAvatarPath',
    'getPersona',
  ].forEach(function (name) {
    window[name] = TavernHelper[name] = function (target) {
      return requestSync(name, { name: target });
    };
  });
  ['getCharacter', 'getChatHistoryBrief'].forEach(function (name) {
    window[name] = TavernHelper[name] = function (target) {
      return request(name, { name: target });
    };
  });
  ['Character', 'Persona'].forEach(function (kind) {
    ['create', 'createOrReplace', 'replace'].forEach(function (op) {
      var name = op + kind;
      window[name] = TavernHelper[name] = function (target, value, option) {
        return request(name, { name: target, value: value, option: option });
      };
    });
    window['delete' + kind] = TavernHelper['delete' + kind] = function (target, option) {
      return request('delete' + kind, { name: target, option: option });
    };
    window['update' + kind + 'With'] = TavernHelper['update' + kind + 'With'] = function (target, updater, option) {
      return requestSync('update' + kind + 'With', { name: target, updater: updater, option: option });
    };
  });
  function RawCharacter(data) {
    this.character_data = data;
  }
  RawCharacter.find = function (option) {
    return TavernHelper.getCharData(option && option.name);
  };
  RawCharacter.findIndex = function (name) {
    var raw = RawCharacter.find({ name: name });
    return raw ? TavernHelper.getCharacterIds().indexOf(raw.avatar) : -1;
  };
  RawCharacter.getChatsFromFiles = function (rows, group) {
    return request('getChatHistoryDetail', { rows: rows, group: group });
  };
  RawCharacter.prototype.getCardData = function () {
    return this.character_data;
  };
  RawCharacter.prototype.getAvatarId = function () {
    return this.character_data.avatar || '';
  };
  RawCharacter.prototype.getRegexScripts = function () {
    return this.character_data.data?.extensions?.regex_scripts || [];
  };
  RawCharacter.prototype.getCharacterBook = function () {
    return this.character_data.data?.character_book || null;
  };
  RawCharacter.prototype.getWorldName = function () {
    return this.character_data.data?.extensions?.world || '';
  };
  window.RawCharacter = TavernHelper.RawCharacter = RawCharacter;
  window.getChatHistoryDetail = TavernHelper.getChatHistoryDetail = RawCharacter.getChatsFromFiles;
  window.formatAsDisplayedMessage = TavernHelper.formatAsDisplayedMessage = function (text, option) {
    return requestSync('formatAsDisplayedMessage', { text: String(text), option: option });
  };
  window.retrieveDisplayedMessage = TavernHelper.retrieveDisplayedMessage = function (id) {
    var nodes = requestSync('retrieveDisplayedMessage', { id: id });
    if (typeof window.jQuery !== 'function')
      throw new Error('retrieveDisplayedMessage 需要 jQuery；请先在当前脚本中加载 jQuery');
    return window.jQuery(nodes);
  };
  window.refreshOneMessage = TavernHelper.refreshOneMessage = function (id, element) {
    if (element && element.length === 0) return Promise.resolve();
    return request('refreshOneMessage', { id: id });
  };
  window.injectPrompts = TavernHelper.injectPrompts = function (prompts, option) {
    var ids = requestSync('injectPrompts', { prompts: prompts, option: option }),
      deleted = false;
    return {
      uninject: function () {
        if (deleted) return;
        requestSync('uninjectPrompts', { ids: ids });
        deleted = true;
      },
    };
  };
  window.uninjectPrompts = TavernHelper.uninjectPrompts = function (ids) {
    requestSync('uninjectPrompts', { ids: ids });
  };
  ['importRawCharacter', 'importRawPreset', 'importRawWorldbook', 'importRawTavernRegex'].forEach(function (name) {
    window[name] = TavernHelper[name] = function (fileName, content) {
      return (name === 'importRawTavernRegex' ? requestSync : request)(name, { name: fileName, content: content });
    };
  });
  window.getVariables = getVariables;
  window.getAllVariables = getAllVariables;
  window.replaceVariables = replaceVariables;
  window.deleteVariable = deleteVariable;
  window.insertOrAssignVariables = insertOrAssignVariables;
  window.insertVariables = insertVariables;
  window.updateVariablesWith = updateVariablesWith;
  window.registerVariableSchema = registerVariableSchema;
  window.getChatMessages = getChatMessages;
  window.setChatMessage = setChatMessage;
  window.setChatMessages = setChatMessages;
  window.createChatMessages = createChatMessages;
  window.deleteChatMessages = deleteChatMessages;
  window.rotateChatMessages = rotateChatMessages;
  window.getCurrentMessageId = getCurrentMessageId;
  window.getLastMessageId = getLastMessageId;
  window.triggerSlash = triggerSlash;
  window.triggerSlashWithResult = triggerSlashWithResult;
  window.generate = generate;
  window.generateRaw = generateRaw;
  window.stopGenerationById = stopGenerationById;
  window.stopAllGeneration = stopAllGeneration;
  window.getModelList = getModelList;
  window.getProxyPresetNames = getProxyPresetNames;
  window.builtin_prompt_default_order = builtin_prompt_default_order;
  window.getWorldbook = getWorldbook;
  window.getLorebooks = getLorebooks;
  window.getLorebookEntries = getLorebookEntries;
  window.isPresetNormalPrompt = isPresetNormalPrompt;
  window.isPresetSystemPrompt = isPresetSystemPrompt;
  window.isPresetPlaceholderPrompt = isPresetPlaceholderPrompt;
  window.default_preset = default_preset;
  window.getPresetNames = getPresetNames;
  window.getLoadedPresetName = getLoadedPresetName;
  window.loadPreset = loadPreset;
  window.createPreset = createPreset;
  window.createOrReplacePreset = createOrReplacePreset;
  window.deletePreset = deletePreset;
  window.renamePreset = renamePreset;
  window.getPreset = getPreset;
  window.replacePreset = replacePreset;
  window.updatePresetWith = updatePresetWith;
  window.setPreset = setPreset;
  window.getLorebookSettings = getLorebookSettings;
  window.setLorebookSettings = setLorebookSettings;
  window.getLorebooks = getLorebooks;
  window.createLorebook = createLorebook;
  window.deleteLorebook = deleteLorebook;
  window.getCharLorebooks = getCharLorebooks;
  window.setCurrentCharLorebooks = setCurrentCharLorebooks;
  window.getCurrentCharPrimaryLorebook = getCurrentCharPrimaryLorebook;
  window.getChatLorebook = getChatLorebook;
  window.setChatLorebook = setChatLorebook;
  window.getOrCreateChatLorebook = getOrCreateChatLorebook;
  window.getLorebookEntries = getLorebookEntries;
  window.replaceLorebookEntries = replaceLorebookEntries;
  window.updateLorebookEntriesWith = updateLorebookEntriesWith;
  window.createLorebookEntries = createLorebookEntries;
  window.createLorebookEntry = createLorebookEntry;
  window.setLorebookEntries = setLorebookEntries;
  window.deleteLorebookEntries = deleteLorebookEntries;
  window.deleteLorebookEntry = deleteLorebookEntry;
  window.getWorldbookNames = getWorldbookNames;
  window.getGlobalWorldbookNames = getGlobalWorldbookNames;
  window.rebindGlobalWorldbooks = rebindGlobalWorldbooks;
  window.getCharWorldbookNames = getCharWorldbookNames;
  window.rebindCharWorldbooks = rebindCharWorldbooks;
  window.getChatWorldbookName = getChatWorldbookName;
  window.rebindChatWorldbook = rebindChatWorldbook;
  window.getOrCreateChatWorldbook = getOrCreateChatWorldbook;
  window.createWorldbook = createWorldbook;
  window.createOrReplaceWorldbook = createOrReplaceWorldbook;
  window.deleteWorldbook = deleteWorldbook;
  window.getWorldbook = getWorldbook;
  window.replaceWorldbook = replaceWorldbook;
  window.updateWorldbookWith = updateWorldbookWith;
  window.createWorldbookEntries = createWorldbookEntries;
  window.deleteWorldbookEntries = deleteWorldbookEntries;
  window.eventOn = eventOn;
  window.eventOnce = eventOnce;
  window.eventMakeFirst = eventMakeFirst;
  window.eventMakeLast = eventMakeLast;
  window.eventOnButton = eventOnButton;
  window.eventEmit = eventEmit;
  window.eventEmitAndWait = eventEmitAndWait;
  window.eventRemoveListener = eventRemoveListener;
  window.eventClearEvent = eventClearEvent;
  window.eventClearListener = eventClearListener;
  window.eventClearAll = eventClearAll;
  window.playAudio = playAudio;
  window.pauseAudio = pauseAudio;
  window.getAudioList = getAudioList;
  window.replaceAudioList = replaceAudioList;
  window.appendAudioList = appendAudioList;
  window.getAudioSettings = getAudioSettings;
  window.setAudioSettings = setAudioSettings;
  window.getCurrentAudio = getCurrentAudio;
  window.audioEnable = audioEnable;
  window.audioPlay = audioPlay;
  window.audioSelect = audioSelect;
  window.audioImport = audioImport;
  window.audioMode = audioMode;
  window.initializeGlobal = initializeGlobal;
  window.waitGlobalInitialized = waitGlobalInitialized;
  window.registerMacroLike = registerMacroLike;
  window.unregisterMacroLike = unregisterMacroLike;
  window.reloadIframe = reloadIframe;
  window.substitudeMacros = substitudeMacros;
  window.errorCatched = errorCatched;
  window.getIframeName = getIframeName;
  window.getScriptId = getScriptId;
  window.getMessageId = getMessageId;
  window.getTavernVersion = getTavernVersion;
  window.getTavernHelperVersion = getTavernHelperVersion;
  window.getFrontendVersion = getFrontendVersion;
  window.updateFrontendVersion = updateFrontendVersion;
  window.updateTavernHelper = updateTavernHelper;
  window.tavern_events = tavern_events;
  window.iframe_events = iframe_events;
  window.toastr = toastr;
  window.Mvu = Mvu;
  window.TavernHelper = TavernHelper;
  if (sillyTavernEnabled) {
    window.extension_settings = extensionSettings;
    window.saveSettings = saveSettings;
    window.saveSettingsDebounced = saveSettingsDebounced;
  }
  function currentScriptHostArgs() {
    var row = scriptContext();
    return { scriptId: String(row.id || ''), scope: String(row.scope || '') };
  }
  function tavernStringHash(value) {
    var text = String(value),
      h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function getButtonEvent(name) {
    return scriptId() + '_' + tavernStringHash(String(name == null ? '' : name));
  }
  function getScriptButtons() {
    return clone(requestSync('getScriptButtons', currentScriptHostArgs()));
  }
  function replaceScriptButtons(param1, param2) {
    var buttons = typeof param1 === 'string' ? param2 : param1,
      args = currentScriptHostArgs();
    args.buttons = Array.isArray(buttons) ? clone(buttons) : [];
    requestSync('replaceScriptButtons', args);
  }
  function updateScriptButtonsWith(updater) {
    if (typeof updater !== 'function') throw new Error('updateScriptButtonsWith 需要 updater');
    var args = currentScriptHostArgs(),
      result = updater(clone(requestSync('getScriptButtons', args))),
      commit = function (rows) {
        var payload = clone(args);
        payload.buttons = Array.isArray(rows) ? clone(rows) : [];
        requestSync('replaceScriptButtons', payload);
        return rows;
      };
    return result && typeof result.then === 'function' ? result.then(commit) : commit(result);
  }
  function appendInexistentScriptButtons(param1, param2) {
    var current = getScriptButtons(),
      incoming = Array.isArray(param1) ? param1 : param2;
    incoming = Array.isArray(incoming) ? incoming : [];
    incoming.forEach(function (row) {
      if (
        !current.some(function (item) {
          return String((item && item.name) || '') === String((row && row.name) || '');
        })
      )
        current.push(clone(row));
    });
    return replaceScriptButtons(current);
  }
  function getScriptName() {
    return String(scriptContext().name || '');
  }
  function getScriptInfo() {
    return String(requestSync('getScriptInfo', currentScriptHostArgs()) || '');
  }
  function replaceScriptInfo(value) {
    var args = currentScriptHostArgs();
    args.value = String(value || '');
    requestSync('replaceScriptInfo', args);
  }
  function getScriptTrees(option) {
    return clone(requestSync('getScriptTrees', { option: clone(option || {}) }));
  }
  function replaceScriptTrees(trees, option) {
    requestSync('replaceScriptTrees', { trees: Array.isArray(trees) ? clone(trees) : [], option: clone(option || {}) });
  }
  function updateScriptTreesWith(updater, option) {
    if (typeof updater !== 'function') throw new Error('updateScriptTreesWith 需要 updater');
    var current = getScriptTrees(option),
      result = updater(current);
    return result && typeof result.then === 'function'
      ? result.then(function (rows) {
          replaceScriptTrees(rows, option);
          return getScriptTrees(option);
        })
      : (replaceScriptTrees(result, option), getScriptTrees(option));
  }
  function getAllEnabledScriptButtons() {
    return clone(requestSync('getAllEnabledScriptButtons', null));
  }
  function getTavernRegexes(option) {
    return clone(requestSync('getTavernRegexes', { option: clone(option || {}) }));
  }
  function replaceTavernRegexes(regexes, option) {
    return request('replaceTavernRegexes', {
      regexes: Array.isArray(regexes) ? clone(regexes) : [],
      option: clone(option || {}),
    });
  }
  function updateTavernRegexesWith(updater, option) {
    if (typeof updater !== 'function') throw new Error('updateTavernRegexesWith 需要 updater');
    var current = getTavernRegexes(option);
    return Promise.resolve(updater(current)).then(function (rows) {
      return replaceTavernRegexes(rows, option).then(function () {
        return rows;
      });
    });
  }
  function isCharacterTavernRegexesEnabled() {
    return requestSync('isCharacterTavernRegexesEnabled', null) === true;
  }
  function formatAsTavernRegexedString(text, source, destination, option) {
    return requestSync('formatAsTavernRegexedString', {
      text: String(text || ''),
      source: source,
      destination: destination,
      option: clone(option || {}),
    });
  }
  function explicitUnsupported(name) {
    return function () {
      throw new Error('夜欲当前没有实现 ' + name);
    };
  }
  window.getScriptName = getScriptName;
  window.getScriptInfo = getScriptInfo;
  window.replaceScriptInfo = replaceScriptInfo;
  window.getButtonEvent = getButtonEvent;
  window.getScriptButtons = getScriptButtons;
  window.replaceScriptButtons = replaceScriptButtons;
  window.updateScriptButtonsWith = updateScriptButtonsWith;
  window.appendInexistentScriptButtons = appendInexistentScriptButtons;
  window.getScriptTrees = getScriptTrees;
  window.replaceScriptTrees = replaceScriptTrees;
  window.updateScriptTreesWith = updateScriptTreesWith;
  window.getAllEnabledScriptButtons = getAllEnabledScriptButtons;
  window.getTavernRegexes = getTavernRegexes;
  window.replaceTavernRegexes = replaceTavernRegexes;
  window.updateTavernRegexesWith = updateTavernRegexesWith;
  window.isCharacterTavernRegexesEnabled = isCharacterTavernRegexesEnabled;
  window.formatAsTavernRegexedString = formatAsTavernRegexedString;
  window.getCurrentLocale = function () {
    return String(navigator.language || 'zh-CN');
  };
  ['registerMvuSchema'].forEach(function (name) {
    if (typeof window[name] !== 'function') window[name] = explicitUnsupported(name);
  });
  async function loadLibraryRows(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var list = document.getElementById('tavern_helper'),
      failures = [];
    for (var i = 0; i < rows.length; i++) {
      var row = clone(rows[i] || {});
      row.id = String(row.id || 'script-' + i);
      row.name = String(row.name || row.id);
      scriptRows[row.id] = row;
      var marker = document.createElement('div');
      marker.hidden = true;
      marker.setAttribute('data-script-id', row.id);
      list.appendChild(marker);
      var source = String(row.content || ''),
        address = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      registerScriptUrl(row, address);
      (Array.isArray(row.modules) ? row.modules : []).forEach(function (url) {
        registerScriptUrl(row, url);
      });
      activeScript = row;
      try {
        await import(address);
        await Promise.resolve();
        await new Promise(function (resolve) {
          setTimeout(resolve, 0);
        });
      } catch (error) {
        failures.push({ id: row.id, name: row.name, message: String((error && error.message) || error) });
      } finally {
        activeScript = null;
      }
    }
    return failures;
  }
  var SillyTavern = {
    eventTypes: clone(tavern_events),
    eventSource: {
      on: sillyTavernEventOn,
      off: sillyTavernEventOff,
      removeListener: sillyTavernEventOff,
      emit: sillyTavernEventEmit,
    },
    saveChat: function () {
      return request('saveChat', { chat: clone(sillyTavernChat) });
    },
    stopGeneration: function () {
      return request('stopGeneration', null).then(function (value) {
        return value === true;
      });
    },
    deleteLastMessage: function () {
      return request('deleteLastMessage', null).then(function (value) {
        return value === true;
      });
    },
    loadWorldInfo: loadWorldInfo,
    getCharacterCardFields: function (option) {
      var character =
          option && option.chid != null ? SillyTavern.characters[option.chid] : TavernHelper.getCharData('current'),
        data = character?.data || {},
        format = function (value) {
          return substitudeMacros(String(value || '').trim());
        };
      return {
        system: format(data.system_prompt),
        mesExamples: format(data.mes_example),
        description: format(data.description),
        personality: format(data.personality),
        persona: format(SillyTavern.powerUserSettings.persona_description),
        scenario: format(data.scenario),
        jailbreak: format(data.post_history_instructions),
        version: data.character_version || '',
        charDepthPrompt: format(data.extensions?.depth_prompt?.prompt),
        creatorNotes: format(data.creator_notes),
        firstMessage: format(data.first_mes),
        alternateGreetings: (data.alternate_greetings || []).map(format),
      };
    },
    getCurrentChatId: function () {
      return sillyTavernChatId;
    },
    getContext: function () {
      return Object.assign({}, SillyTavern, { characterId: SillyTavern.this_chid });
    },
    getRequestHeaders: explicitUnsupported('SillyTavern.getRequestHeaders'),
    registerMacro: function (key, value) {
      registerMacroLike(facadeMacroPattern(key), function () {
        return String(typeof value === 'function' ? value() : value);
      });
    },
    unregisterMacro: function (key) {
      unregisterMacroLike(facadeMacroPattern(key));
    },
  };
  function facadeMacroPattern(key) {
    if (typeof key !== 'string' || !key.trim() || key.startsWith('{{') || key.endsWith('}}'))
      throw new Error('宏名称无效');
    return new RegExp('\\{\\{\\s*' + hostWindow.escapeRegexText(key.trim()) + '\\s*\\}\\}', 'gi');
  }
  Object.defineProperty(SillyTavern, 'chat', {
    enumerable: true,
    get: function () {
      return sillyTavernChat;
    },
  });
  Object.defineProperty(SillyTavern, 'characters', {
    enumerable: true,
    get: function () {
      return requestSync('facadeValue', { key: 'characters' });
    },
  });
  Object.defineProperty(SillyTavern, 'this_chid', {
    enumerable: true,
    get: function () {
      return requestSync('facadeValue', { key: 'characterId' });
    },
  });
  Object.defineProperty(SillyTavern, 'chatId', {
    enumerable: true,
    get: function () {
      return requestSync('facadeValue', { key: 'chatId' });
    },
  });
  Object.defineProperty(SillyTavern, 'name1', {
    enumerable: true,
    get: function () {
      return requestSync('facadeValue', { key: 'name1' });
    },
  });
  Object.defineProperty(SillyTavern, 'name2', {
    enumerable: true,
    get: function () {
      return requestSync('facadeValue', { key: 'name2' });
    },
  });
  Object.defineProperty(SillyTavern, 'extensionSettings', {
    enumerable: true,
    get: function () {
      return extensionSettings;
    },
  });
  [
    'chatMetadata',
    'chatCompletionSettings',
    'powerUserSettings',
    'maxContext',
    'extensionPrompts',
    'worldNames',
  ].forEach(function (key) {
    Object.defineProperty(SillyTavern, key, {
      enumerable: true,
      get: function () {
        return requestSync('facadeValue', { key: key });
      },
    });
  });
  [
    'saveMetadata',
    'selectCharacterById',
    'openCharacterChat',
    'renameChat',
    'printMessages',
    'reloadCurrentChat',
    'deleteMessage',
    'writeExtensionField',
    'scrollChatToBottom',
    'reloadWorldInfoEditor',
    'updateWorldInfoList',
  ].forEach(function (name) {
    SillyTavern[name] = function () {
      return request('facadeAction', { name: name, args: Array.from(arguments) });
    };
  });
  SillyTavern.updateChatMetadata = function (value, reset) {
    return requestSync('facadeUpdateMetadata', { value: value, reset: reset });
  };
  SillyTavern.saveSettings = async function () {
    await saveSettings();
    await request('facadeAction', { name: 'saveContextSettings', args: [] });
  };
  SillyTavern.saveSettingsDebounced = function () {
    SillyTavern.saveSettings().catch(reportError);
  };
  SillyTavern.saveMetadataDebounced = function () {
    SillyTavern.saveMetadata().catch(reportError);
  };
  SillyTavern.mainApi = 'openai';
  SillyTavern.generate = function (type, options) {
    if (options && Object.keys(options).length) throw new Error('生成参数请使用 TavernHelper.generate');
    return request('facadeAction', { name: 'generate', args: [type] });
  };
  SillyTavern.swipe = {
    left: function (event, options) {
      return request('facadeAction', { name: 'swipe', args: ['left', options] });
    },
    right: function (event, options) {
      return request('facadeAction', { name: 'swipe', args: ['right', options] });
    },
    to: function (event, direction, options) {
      return request('facadeAction', { name: 'swipe', args: [direction, options] });
    },
    isAllowed: function () {
      return requestSync('facadeValue', { key: 'swipeAllowed' });
    },
    refresh: function () {
      return SillyTavern.printMessages();
    },
  };
  SillyTavern.getChatCompletionModel = function () {
    return requestSync('facadeValue', { key: 'model' });
  };
  SillyTavern.getWorldInfoNames = getWorldbookNames;
  SillyTavern.saveWorldInfo = async function (name, data) {
    if (!(await TavernHelper.importRawWorldbook(name, JSON.stringify(data)))) throw new Error('世界书保存失败');
  };
  SillyTavern.getCharacters = async function () {
    return SillyTavern.characters;
  };
  SillyTavern.getOneCharacter = async function (id) {
    return TavernHelper.getCharData(id);
  };
  SillyTavern.getThumbnailUrl = function (type, id) {
    return type === 'persona' ? TavernHelper.getPersonaAvatarPath(id) : TavernHelper.getCharAvatarPath(id);
  };
  SillyTavern.setExtensionPrompt = function (id, value, position, depth, scan, role, filter) {
    requestSync('facadeSetPrompt', { args: [id, value, position, depth, scan, role, filter] });
  };
  SillyTavern.messageFormatting = function (text, name, system, user, id) {
    return TavernHelper.formatAsDisplayedMessage(text, { message_id: id });
  };
  SillyTavern.updateMessageBlock = TavernHelper.refreshOneMessage;
  SillyTavern.substituteParams = substitudeMacros;
  SillyTavern.substituteParamsExtended = substitudeMacros;
  SillyTavern.getCurrentLocale = window.getCurrentLocale;
  SillyTavern.uuidv4 = function () {
    return crypto.randomUUID();
  };
  SillyTavern.variables = {};
  ['local', 'global'].forEach(function (scope) {
    var type = scope === 'local' ? 'chat' : 'global',
      api = {};
    ['get', 'set', 'del', 'has', 'add'].forEach(function (op) {
      api[op] = function (key, value, option) {
        return requestSync('facadeVariable', {
          type: type,
          op: op,
          key: key,
          value: value,
          option: op === 'get' ? value : option,
        });
      };
    });
    api.inc = function (key) {
      return api.add(key, 1);
    };
    api.dec = function (key) {
      return api.add(key, -1);
    };
    SillyTavern.variables[scope] = api;
  });
  SillyTavern.getPresetManager = function (api) {
    if (api && api !== 'openai') throw new Error('夜欲只支持聊天补全预设');
    return {
      apiId: 'openai',
      getPresetList: function () {
        return requestSync('facadeValue', { key: 'presetList' });
      },
      getSelectedPresetName: getLoadedPresetName,
      getSelectedPreset: function () {
        return this.getPresetList().preset_names[getLoadedPresetName()];
      },
      findPreset: function (name) {
        return this.getPresetList().preset_names[name];
      },
      getPresetSettings: function (name) {
        var list = this.getPresetList();
        return list.presets[list.preset_names[name]] || list.settings;
      },
      selectPreset: function (value) {
        var names = this.getPresetList().preset_names,
          name = Object.keys(names).find(function (key) {
            return String(names[key]) === String(value);
          });
        if (!name) throw new Error('预设索引不存在');
        return loadPreset(name);
      },
      savePreset: async function (name, settings, options) {
        if (!(await TavernHelper.importRawPreset(name, JSON.stringify(settings || this.getPresetSettings(name)))))
          throw new Error('预设保存失败');
        if (!options || !options.skipUpdate) await loadPreset(name);
      },
      deletePreset: function (name) {
        return deletePreset(name || getLoadedPresetName());
      },
      renamePreset: function (name) {
        return renamePreset(getLoadedPresetName(), name);
      },
    };
  };
  window.SillyTavern = SillyTavern;
  installCleanupProtector();
  if (sillyTavernEnabled && publishParentRuntime) publishParentRuntime('TavernHelper', TavernHelper);
  if (sillyTavernEnabled) {
    SillyTavern.Chat = { document: document };
    SillyTavern.POPUP_TYPE = { DISPLAY: 'display', INPUT: 'input' };
    SillyTavern.callGenericPopup = function (html, type, title, options) {
      var dialog = document.createElement('dialog'),
        close = document.createElement('button'),
        body = document.createElement('div');
      function finish() {
        try {
          dialog.close();
        } catch (_) {}
        dialog.remove();
        if (options && typeof options.callback === 'function') options.callback('close', null);
      }
      close.type = 'button';
      close.className = 'yeyu-library-dialog-close';
      close.textContent = '关闭';
      body.innerHTML = String(html || '');
      dialog.appendChild(close);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      close.addEventListener('click', finish);
      dialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        finish();
      });
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
      return dialog;
    };
  }
  if (sillyTavernEnabled && !document.getElementById('tavern_helper')) {
    var registry = document.createElement('div');
    registry.id = 'tavern_helper';
    registry.hidden = true;
    (document.body || document.documentElement).appendChild(registry);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLayout);
  else watchLayout();
  installAsyncCallbackBinding();
  if (sillyTavernEnabled) {
    var libraryStarted = false;
    window.__yeyuStartLibraryRows = function () {
      if (libraryStarted) return;
      libraryStarted = true;
      installScriptOwnerBinding();
      loadLibraryRows(config.scripts || []).then(
        function (failures) {
          if (publishParentRuntime) {
            publishParentRuntime('SillyTavern', SillyTavern);
            publishParentRuntime('EjsTemplate', EjsTemplate);
          }
          post('libraryReady', { failures: failures });
        },
        // Every row already fails on its own; reaching here means the loader itself could not run, so
        // the host is told the library never started instead of receiving one more runtime error.
        function (error) {
          post('libraryFailed', { message: String((error && error.message) || error || '脚本库启动失败') });
        }
      );
    };
  } else post('ready', { messageId: config.messageId });
}
