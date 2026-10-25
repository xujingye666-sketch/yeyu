var _composerResizeObserver = null;
function syncComposerMetrics() {
  var wrap = $('chat-input-wrap');
  if (!wrap) return;
  var height = Math.round(wrap.getBoundingClientRect().height);
  var root = document.documentElement;
  if (height <= 0 || root.style.getPropertyValue('--composer-current-h') === height + 'px') return;
  var anchor = typeof captureChatReadingAnchor === 'function' ? captureChatReadingAnchor() : null;
  root.style.setProperty('--composer-current-h', height + 'px');
  if (anchor) applyChatReadingAnchor(anchor);
}
function setupComposerMetrics() {
  var wrap = $('chat-input-wrap');
  if (!wrap) return;
  if (window.ResizeObserver) {
    _composerResizeObserver = new ResizeObserver(function () {
      requestAnimationFrame(syncComposerMetrics);
    });
    _composerResizeObserver.observe(wrap);
  }
  requestAnimationFrame(syncComposerMetrics);
}
// The chat header popovers share one dismissal contract: a press outside, Escape and the native back
// key close them alike. `inside` is the surface plus the controls that toggle it, whose own handlers
// decide a press there; focus inside returns to `trigger` when a key closes the popover.
var CHAT_HEADER_POPOVERS = [
  {
    inside: '#session-manager-panel, #chat-session-switch',
    trigger: 'chat-session-switch',
    isOpen: function () {
      return _sessionManagerOpen;
    },
    close: closeSessionManager,
  },
  {
    inside: '#chat-tools-panel, #chat-tools-toggle',
    trigger: 'chat-tools-toggle',
    isOpen: function () {
      return !$('chat-tools-panel').hidden;
    },
    close: closeChatTools,
  },
  {
    inside: '#chat-anchor-panel, #chat-nav-tools, #chat-navigation-reveal',
    trigger: 'chat-navigation-reveal',
    isOpen: function () {
      return $('chat-anchor-panel').classList.contains('open');
    },
    close: function () {
      toggleAnchorPanel(false);
    },
  },
  {
    inside: '#chat-nav-tools, #chat-navigation-reveal',
    trigger: 'chat-navigation-reveal',
    isOpen: function () {
      var tools = $('chat-nav-tools');
      return tools.style.display !== 'none' && !tools.classList.contains('is-auto-hidden');
    },
    close: hideChatNavigation,
  },
  {
    inside: '#card-bgm-panel, #ch-avatar-shell',
    trigger: 'ch-avatar-shell',
    isOpen: function () {
      return _cardBgmPanelOpen;
    },
    close: closeCardBgmPanel,
  },
];
function closeTopChatHeaderPopover() {
  var popover = CHAT_HEADER_POPOVERS.find(function (row) {
    return row.isOpen();
  });
  if (!popover) return false;
  var active = document.activeElement,
    restoreFocus = !!(active && active.closest && active.closest(popover.inside));
  popover.close();
  if (restoreFocus) $(popover.trigger)?.focus({ preventScroll: true });
  return true;
}
function dismissOutsidePress(target) {
  // The option list of an in-popover select lives on <body> but belongs to the popover that opened it.
  if (target.closest('#app-select-list')) return;
  CHAT_HEADER_POPOVERS.forEach(function (popover) {
    if (popover.isOpen() && !target.closest(popover.inside)) popover.close();
  });
  if (!target.closest('.tokens-details')) {
    var details = document.querySelector('.tokens-details');
    if (details) details.open = false;
  }
}
document.addEventListener('pointerdown', function (event) {
  dismissOutsidePress(event.target);
});
// Key and pointer events inside an iframe never reach this document. Each same-origin frame document
// (card frontends, the script library, Risu displays) is bridged once: a press in it counts as a press
// on the frame element and an Escape it leaves unhandled dismisses like a host Escape. A cross-origin
// frame's document is unreachable, so only the native back key closes layers while focus is there.
var _dismissalBridgedFrames = new WeakSet();
function bridgeFrameDismissal(frame) {
  var doc = frame.contentDocument,
    view = doc && doc.defaultView;
  if (!view || _dismissalBridgedFrames.has(doc)) return;
  _dismissalBridgedFrames.add(doc);
  doc.addEventListener(
    'pointerdown',
    function () {
      if (frame.isConnected) dismissOutsidePress(frame);
    },
    true
  );
  view.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !event.defaultPrevented && frame.isConnected && dismissTopLayerOnEscape())
      event.preventDefault();
  });
}
document.addEventListener(
  'load',
  function (event) {
    if (event.target.tagName === 'IFRAME') bridgeFrameDismissal(event.target);
  },
  true
);
// Focus can enter a frame before its load event, e.g. a library opened while its scripts still load.
window.addEventListener('blur', function () {
  setTimeout(function () {
    var frame = document.activeElement;
    if (frame && frame.tagName === 'IFRAME') bridgeFrameDismissal(frame);
  });
});
var _nativeImeState = { visible: false, imeBottomPx: 0, currentViewHeightPx: 0, baselineViewHeightPx: 0 },
  _imeSyncFrame = 0,
  _imeFocusFrame = 0;
function nativeImeResidualCss(state, devicePixelRatio, layoutHeightCss) {
  state = state || {};
  if (!state.visible) return 0;
  var ime = Math.max(0, Number(state.imeBottomPx) || 0),
    baseline = Math.max(0, Number(state.baselineViewHeightPx) || 0),
    current = Math.max(0, Number(state.currentViewHeightPx) || 0),
    ratio = Math.max(1, Number(devicePixelRatio) || 1),
    layout = Math.max(0, Number(layoutHeightCss) || 0),
    viewResidual = null,
    layoutResidual = null,
    css;
  if (baseline && current) {
    var resized = Math.max(0, baseline - current);
    viewResidual = Math.max(0, ime - resized) / ratio;
  }
  if (baseline && layout) {
    var keyboardTopCss = (baseline - ime) / ratio;
    layoutResidual = Math.max(0, layout - keyboardTopCss);
  }
  css =
    viewResidual === null
      ? layoutResidual
      : layoutResidual === null
        ? viewResidual
        : Math.min(viewResidual, layoutResidual);
  css = Math.max(0, css || 0);
  return css < 48 ? 0 : Math.round(css);
}
window.__yeyuImeInsets = function (visible, imeBottomPx, currentViewHeightPx, baselineViewHeightPx) {
  _nativeImeState = {
    visible: visible === true,
    imeBottomPx: Math.max(0, Number(imeBottomPx) || 0),
    currentViewHeightPx: Math.max(0, Number(currentViewHeightPx) || 0),
    baselineViewHeightPx: Math.max(0, Number(baselineViewHeightPx) || 0),
  };
  if (_imeSyncFrame) cancelAnimationFrame(_imeSyncFrame);
  _imeSyncFrame = requestAnimationFrame(function () {
    _imeSyncFrame = 0;
    syncKeyboardViewport();
    syncComposerMetrics();
  });
};
function keyboardEditableElement(element) {
  if (!element) return false;
  var tag = String(element.tagName || '').toUpperCase(),
    type = String(element.type || '').toLowerCase();
  return (
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (tag === 'INPUT' &&
      !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(
        type
      )) ||
    element.isContentEditable === true
  );
}
// The chat page makes room for the keyboard only when the chat itself is typing: its composer, or a
// card frontend inside a message. The sidebar, panels, dialogs and destination pages are laid over the
// chat and keep their own inputs in view, so their keyboard must not lift the chat underneath.
function keyboardBelongsToChat(element) {
  return !!(element && element.closest && element.closest('#chat-input-wrap, #chat-messages'));
}
function keepFocusedInputVisible(open, viewportTop, viewportHeight) {
  if (!open) return;
  var active = document.activeElement;
  if (!keyboardEditableElement(active) || !active.closest || !active.closest('.modal-overlay.open')) return;
  var body = active.closest('.modal-body'),
    rect = active.getBoundingClientRect(),
    upper = viewportTop + 12,
    lower = viewportTop + viewportHeight - 12;
  if (body) {
    var bodyRect = body.getBoundingClientRect();
    upper = Math.max(upper, bodyRect.top + 12);
    lower = Math.min(lower, bodyRect.bottom - 12);
  }
  if (
    active.tagName === 'TEXTAREA' &&
    typeof textareaCaretRect === 'function' &&
    rect.bottom - rect.top > 3 * (parseFloat(getComputedStyle(active).lineHeight) || 20)
  )
    rect = textareaCaretRect(active);
  // 高于可视带的编辑框覆盖可视带时无需移动；不能在上下边缘之间反复对齐。
  if (rect.bottom - rect.top > lower - upper && rect.top <= upper && rect.bottom >= lower) return;
  if (rect.bottom > lower) {
    if (body) body.scrollTop += rect.bottom - lower;
    else active.scrollIntoView({ block: 'center' });
  } else if (rect.top < upper) {
    if (body) body.scrollTop -= upper - rect.top;
    else active.scrollIntoView({ block: 'center' });
  }
}
function refreshFocusedInputVisibility() {
  var style = document.documentElement.style;
  keepFocusedInputVisible(
    document.body.classList.contains('keyboard-open'),
    parseFloat(style.getPropertyValue('--app-visual-viewport-top')) || 0,
    parseFloat(style.getPropertyValue('--app-keyboard-viewport-height')) || window.innerHeight
  );
}
var _narrowLayout = null;
function syncLayoutBreakpoint() {
  var narrow = window.innerWidth <= 768;
  if (narrow === _narrowLayout) return false;
  _narrowLayout = narrow;
  document.body.classList.toggle('has-bottom-nav', narrow);
  setSidebarOpen(!narrow);
  return true;
}
function syncKeyboardViewport() {
  var vv = window.visualViewport,
    offset = 0,
    viewportHeight = window.innerHeight,
    viewportTop = 0;
  if (vv && window.innerWidth <= 768) {
    viewportHeight = Math.max(1, Math.round(vv.height));
    viewportTop = Math.max(0, Math.round(vv.offsetTop));
    offset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  }
  document.documentElement.style.setProperty('--app-visual-viewport-height', viewportHeight + 'px');
  document.documentElement.style.setProperty('--app-visual-viewport-top', viewportTop + 'px');
  var editableFocused = keyboardEditableElement(document.activeElement),
    nativeOpen = editableFocused && _nativeImeState.visible;
  if (nativeOpen) {
    var nativeOffset = nativeImeResidualCss(_nativeImeState, window.devicePixelRatio, window.innerHeight),
      nativeCap = Math.max(0, Math.round(window.innerHeight - 180));
    offset = Math.max(offset, Math.min(nativeOffset, nativeCap));
  }
  var usableViewportHeight = Math.max(
    1,
    Math.min(viewportHeight, Math.max(1, window.innerHeight - viewportTop - offset))
  );
  document.documentElement.style.setProperty('--keyboard-offset', offset + 'px');
  document.documentElement.style.setProperty('--app-keyboard-viewport-height', usableViewportHeight + 'px');
  var open = offset > 80 || nativeOpen,
    chatOpen = open && keyboardBelongsToChat(document.activeElement);
  if (
    document.body.classList.contains('keyboard-open') !== open ||
    document.body.classList.contains('chat-keyboard-open') !== chatOpen
  )
    finishUiMotions();
  document.body.classList.toggle('keyboard-open', open);
  document.body.classList.toggle('chat-keyboard-open', chatOpen);
  if (typeof positionAppSelect === 'function') positionAppSelect();
  if (_imeFocusFrame) cancelAnimationFrame(_imeFocusFrame);
  _imeFocusFrame = requestAnimationFrame(function () {
    _imeFocusFrame = 0;
    if (typeof syncAutoGrowTextareas === 'function') syncAutoGrowTextareas(document);
    keepFocusedInputVisible(open, viewportTop, usableViewportHeight);
  });
  if (open && getChar()) scheduleTokensBar(getChar());
}
window.handleNativeBack = function () {
  if (typeof closeAppSelect === 'function' && closeAppSelect()) return true;
  if (document.querySelector('.msg-more.open')) {
    closeMessageMore();
    return true;
  }
  if (_memoryJobActive || creatorNotesResolver || _importProgressActive) return true;
  const wheelSpin = $('wheel-scheme-spin-modal');
  if (wheelSpin && wheelSpin.classList.contains('open')) {
    closeWheelSchemeSpin();
    return true;
  }
  const wheelGame = $('wheel-game-view');
  if (wheelGame && wheelGame.classList.contains('open')) {
    closeWheelSchemeGame();
    return true;
  }
  const modal =
    typeof getTopOpenModal === 'function' ? getTopOpenModal() : document.querySelector('.modal-overlay.open');
  if (modal) {
    dismissModalLayer(modal.id);
    return true;
  }
  if (currentAppPage() !== 'chat') {
    switchAppPage('chat');
    return true;
  }
  if (closeTopChatHeaderPopover()) return true;
  var tokenDetails = document.querySelector('.tokens-details[open]');
  if (tokenDetails) {
    tokenDetails.open = false;
    tokenDetails.querySelector('summary')?.focus({ preventScroll: true });
    return true;
  }
  const sidebar = $('sidebar');
  if (window.innerWidth <= 768 && sidebar && !sidebar.classList.contains('hidden')) {
    setSidebarOpen(false);
    return true;
  }
  if (closeOpenMessageActions()) return true;
  return false;
};
// A message toolbar opens inline under its message and survives presses elsewhere, so every floating
// layer opened after it sits above it: back folds it only once those are closed.
function closeOpenMessageActions() {
  var row = document.querySelector('#chat-messages .msg.actions-open');
  if (!row) return false;
  toggleMessageActions(Number(row.dataset.msgIdx));
  return true;
}
function init(options) {
  options = options || {};
  renderAppVersion();
  applyConfiguredTheme();
  applyMessageStyle();
  setupDZ('drop-zone', 'file-input', handleFileImport);
  setupDZ('wb-drop', 'wb-file', importWBFile);

  renderCharList();
  renderPersonaList();
  renderWBSidebar();
  renderWheelSchemeLibrary();

  var initialChar = getChar();
  renderChat();
  updateChatUI();
  if (initialChar) {
    applyCharBackground(initialChar);
    scrollChatToBottomAfterRender();
  }
  if (typeof initStreamDraftRecovery === 'function')
    initStreamDraftRecovery().catch(function () {
      _streamDraftProtectionWarning = '草稿保护暂不可用';
    });
  if (!D.characters.length) {
    setTimeout(function () {
      toast('欢迎使用夜欲：先导入角色卡或创建一个角色吧', 'info');
    }, 700);
  }

  // Request persistent storage (important for IndexedDB reliability)
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function (granted) {
      if (granted) console.log('Storage persisted');
    });
  }

  syncLayoutBreakpoint();
  syncKeyboardViewport();
  setupComposerMetrics();
  setupAutoGrowTextareas();
  setupAppSelects();
  setupUiMotion();
  if (typeof qrPerformAuto === 'function')
    qrPerformAuto('executeOnStartup').catch(function (error) {
      if (typeof toast === 'function') toast(String((error && error.message) || error), 'err');
    });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      syncKeyboardViewport();
      syncComposerMetrics();
    });
    window.visualViewport.addEventListener('scroll', function () {
      syncKeyboardViewport();
      syncComposerMetrics();
    });
  }
  document.addEventListener('focusin', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) {
      setTimeout(function () {
        syncKeyboardViewport();
        syncComposerMetrics();
      }, 120);
      setTimeout(function () {
        syncKeyboardViewport();
        syncComposerMetrics();
      }, 360);
    }
  });

  window.addEventListener('resize', () => {
    syncKeyboardViewport();
    syncComposerMetrics();
    syncLayoutBreakpoint();
  });
}

function showStorageRecoveryScreen(error) {
  _persistenceBlocked = true;
  var overlay = document.createElement('div');
  overlay.className = 'storage-recovery-screen';
  overlay.innerHTML =
    '<div class="storage-recovery-card">' +
    '<h2>本地数据暂时无法读取</h2><p>为避免覆盖原有角色和对话，应用已停止写入。请先重新尝试读取；不要卸载或清除应用数据。</p><div class="storage-recovery-error">' +
    esc(String((error && error.message) || '未知存储错误')) +
    '</div><button type="button" class="btn primary" onclick="location.reload()">重新尝试</button></div>';
  document.body.appendChild(overlay);
  if (error && error.restartRecoverySnapshot) {
    var restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'btn danger';
    restart.textContent = '重新开始';
    var confirmed = false;
    restart.onclick = async function () {
      if (!confirmed) {
        confirmed = true;
        overlay.querySelector('p').textContent =
          '主数据库已确认是空的，剩余恢复快照无法解析。重新开始会删除这份损坏快照，无法从中恢复角色和对话。确定放弃快照并重新开始吗？';
        restart.textContent = '确认放弃快照并重新开始';
        return;
      }
      restart.disabled = true;
      try {
        var currentError;
        try {
          await loadDataAsync();
        } catch (checkError) {
          currentError = checkError;
        }
        if (!currentError || currentError.restartRecoverySnapshot !== error.restartRecoverySnapshot)
          throw new Error('本地数据状态已变化，请重新尝试读取');
        localStorage.removeItem(FALLBACK_KEY);
        location.reload();
      } catch (restartError) {
        overlay.querySelector('.storage-recovery-error').textContent = restartError.message;
        restart.disabled = false;
      }
    };
    overlay.querySelector('.storage-recovery-card').appendChild(restart);
  }
}

// Async bootstrap: load from IndexedDB then init
loadDataAsync()
  .then(function (value) {
    D = sanitizeLoadedData(value || defaults());
    var wheelHuesAdded = ensureWheelSchemeAutoHues();
    init();
    if (wheelHuesAdded) saveData('wheels').catch(function () {});
    if (typeof initPresetTaskRuntime === 'function') initPresetTaskRuntime();
    startAppUpdateChecks();
    if (_storageHealth.readOnlyFallback) renderStorageHealthStatus();
    else if (_pendingPrimarySections.size) {
      renderStorageHealthStatus();
      flushPendingSave().catch(function () {});
    }
    // Installed APK uses the native shell; browser installation prompts are intentionally ignored.
  })
  .catch(function (error) {
    _persistenceBlocked = true;
    cancelScheduledSave();
    console.error('应用启动失败', error);
    D = defaults();
    try {
      init({ readOnly: true });
      showStorageRecoveryScreen(error);
    } catch (initError) {
      document.body.innerHTML =
        '<main style="padding:32px;color:#fff;background:#090910;min-height:100vh"><h2>夜欲启动失败</h2><p>本地数据未被删除。请重新启动应用；仍失败时请保留应用数据并联系支持。</p><pre style="white-space:pre-wrap;color:#f59e9e">' +
        esc(String((initError && initError.message) || (error && error.message) || '未知错误')) +
        '</pre></main>';
    }
  });
