// ===== Modal =====
var _modalStack = [],
  _modalReturnFocus = new WeakMap();
var appPageIds = { presets: 'prompt-manager-modal', memory: 'memory-manager-modal', settings: 'settings-modal' };
function appPageForModal(id) {
  return Object.keys(appPageIds).find(function (page) {
    return appPageIds[page] === id;
  });
}
function currentAppPage() {
  return document.body.dataset.page || 'chat';
}
function switchAppPage(page) {
  if (page !== 'chat' && !appPageIds[page]) return;
  var previousPage = currentAppPage();
  if (previousPage === 'settings' && page !== 'settings' && typeof cancelProviderProbes === 'function')
    cancelProviderProbes();
  if (previousPage === 'presets' && page !== 'presets' && typeof hidePresetRoundPreview === 'function')
    hidePresetRoundPreview();
  if (previousPage !== page) finishUiMotions();
  if (typeof closeAppSelect === 'function') closeAppSelect(false);
  if (typeof closeChatTools === 'function') closeChatTools(false);
  if (typeof closeSessionManager === 'function') closeSessionManager();
  if (window.innerWidth <= 768) setSidebarOpen(false);
  document.body.dataset.page = page;
  Object.keys(appPageIds).forEach(function (key) {
    var panel = $(appPageIds[key]);
    panel.classList.toggle('open', key === page);
    panel.setAttribute('aria-hidden', String(key !== page));
  });
  document.querySelectorAll('#bottom-nav [data-page]').forEach(function (button) {
    var active = button.dataset.page === page;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  var target = $(appPageIds[page]);
  if (target) {
    if (!target.dataset.loaded) {
      if (page === 'settings') loadSettingsForm();
      if (page === 'presets') loadPromptManager();
      if (page === 'memory') loadMemoryManager();
      target.dataset.loaded = 'true';
    } else if (page === 'memory') {
      var char = getChar();
      renderMemoryManagerState(char, char ? getActiveSession(char.id) : null);
    } else if (page === 'settings' && previousPage !== 'settings') {
      refreshSettingsForm();
    } else if (page === 'presets' && previousPage !== 'presets' && typeof schedulePresetRoundPreview === 'function') {
      schedulePresetRoundPreview();
    }
    scheduleAutoGrowTextareas(target);
    if (typeof syncAppSelects === 'function') syncAppSelects(target);
    target.querySelector('.modal-hd').focus({ preventScroll: true });
    if (previousPage !== page) revealUiContent(target.querySelector('.modal-body'), 0);
  } else if (previousPage !== page) {
    revealUiContent($('chat-messages'), 0);
  }
  if (page === 'chat' && typeof risuRefreshFrameAppearance === 'function')
    requestAnimationFrame(function () {
      if (currentAppPage() === 'chat') risuRefreshFrameAppearance();
    });
}
function showModalSurface(id) {
  var modal = $(id);
  if (!modal) return;
  if (typeof closeAppSelect === 'function') closeAppSelect(false);
  if (!modal.classList.contains('open')) _modalReturnFocus.set(modal, document.activeElement);
  _modalStack = _modalStack.filter(function (node) {
    return node !== modal && node.isConnected && node.classList.contains('open');
  });
  _modalStack.push(modal);
  modal.style.zIndex = String(1000 + _modalStack.length * 2);
  transitionUiVisibility(
    modal,
    true,
    function () {
      modal.hidden = false;
      modal.classList.add('open');
    },
    'dialog'
  );
  var dialog = modal.querySelector('.modal') || modal;
  dialog.tabIndex = -1;
  dialog.focus({ preventScroll: true });
}
function hideModalSurface(id) {
  var modal = $(id);
  if (!modal) return;
  if (typeof closeAppSelect === 'function') closeAppSelect(false);
  var active = document.activeElement,
    restore = !active || active === document.body || modal.contains(active),
    previous = _modalReturnFocus.get(modal);
  transitionUiVisibility(
    modal,
    false,
    function () {
      modal.classList.remove('open');
      modal.hidden = true;
    },
    'dialog'
  );
  _modalStack = _modalStack.filter(function (node) {
    return node !== modal;
  });
  if (restore && previous && previous.isConnected && previous.getClientRects().length)
    previous.focus({ preventScroll: true });
  _modalReturnFocus.delete(modal);
}
var _autoGrowObservers = [],
  _autoGrowFrame = 0,
  _autoGrowRoots = [],
  _autoGrowReady = false,
  _autoGrowMeasure = null;
function autoGrowContentHeight(node, style) {
  if (!_autoGrowMeasure) {
    _autoGrowMeasure = document.createElement('textarea');
    _autoGrowMeasure.tabIndex = -1;
    _autoGrowMeasure.setAttribute('aria-hidden', 'true');
    _autoGrowMeasure.style.cssText =
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;height:0;min-height:0;max-height:none;overflow:hidden;transition:none;';
    document.body.appendChild(_autoGrowMeasure);
  }
  // 在文档流外测量，避免把正在编辑的输入框压成零高而截断父层 scrollTop。
  [
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'wordSpacing',
    'paddingTop',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'borderTopWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRightWidth',
    'borderStyle',
    'whiteSpace',
    'wordBreak',
    'overflowWrap',
    'tabSize',
    'textIndent',
    'textTransform',
    'direction',
  ].forEach(function (key) {
    _autoGrowMeasure.style[key] = style[key];
  });
  _autoGrowMeasure.style.width = style.width;
  _autoGrowMeasure.wrap = node.wrap;
  _autoGrowMeasure.value = node.value;
  return _autoGrowMeasure.scrollHeight;
}
function resizeAutoGrowTextarea(node) {
  if (!node || node.tagName !== 'TEXTAREA' || node.id === 'user-input' || node.dataset.autogrow === 'off') return;
  node.classList.add('is-autogrow');
  if (!node.dataset.autogrow && Number(node.getAttribute('rows')) >= 5) node.dataset.autogrow = 'long';
  if (!node.getClientRects().length) return;
  var style = getComputedStyle(node),
    border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0),
    min = Math.max(0, parseFloat(style.minHeight) || 0),
    max = parseFloat(style.maxHeight),
    wanted = Math.max(min, autoGrowContentHeight(node, style) + border);
  if (!Number.isFinite(max) || max <= 0) max = wanted;
  var body = node.closest('.modal-body');
  if (body && document.body.classList.contains('keyboard-open'))
    max = Math.min(max, Math.max(min, body.clientHeight - 24));
  var height = Math.min(wanted, max);
  var changed = node.style.height !== Math.ceil(height) + 'px';
  if (changed) node.style.height = Math.ceil(height) + 'px';
  node.classList.toggle('is-scrollable', wanted > max + 1);
  if (changed && node === document.activeElement) {
    var caret = node.selectionDirection === 'backward' ? node.selectionStart : node.selectionEnd,
      lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4,
      paddingBottom = parseFloat(style.paddingBottom) || 0;
    _autoGrowMeasure.value = node.value.slice(0, caret) + '\u200b';
    var caretBottom = _autoGrowMeasure.scrollHeight - paddingBottom,
      caretTop = Math.max(0, caretBottom - lineHeight);
    if (caretTop < node.scrollTop) node.scrollTop = caretTop;
    else if (caretBottom > node.scrollTop + node.clientHeight) node.scrollTop = caretBottom - node.clientHeight;
  }
}
function textareaCaretRect(node) {
  var style = getComputedStyle(node),
    rect = node.getBoundingClientRect(),
    lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4,
    caret = node.selectionDirection === 'backward' ? node.selectionStart : node.selectionEnd;
  autoGrowContentHeight(node, style);
  _autoGrowMeasure.value = node.value.slice(0, caret) + '\u200b';
  var bottom =
    rect.top +
    (parseFloat(style.borderTopWidth) || 0) +
    _autoGrowMeasure.scrollHeight -
    (parseFloat(style.paddingBottom) || 0) -
    node.scrollTop;
  return { top: bottom - lineHeight, bottom: bottom };
}
function syncAutoGrowTextareas(root) {
  root = root || document;
  var rows = [],
    selector = root === document ? '.modal-overlay textarea' : 'textarea';
  if (root.matches && root.matches('textarea') && root.closest('.modal-overlay')) rows.push(root);
  if (root.querySelectorAll) rows = rows.concat(Array.from(root.querySelectorAll(selector)));
  rows.forEach(resizeAutoGrowTextarea);
}
function scheduleAutoGrowTextareas(root) {
  _autoGrowRoots.push(root && root.querySelectorAll ? root : document);
  if (_autoGrowFrame) return;
  _autoGrowFrame = requestAnimationFrame(function () {
    _autoGrowFrame = 0;
    var roots = _autoGrowRoots;
    _autoGrowRoots = [];
    if (roots.includes(document)) return syncAutoGrowTextareas(document);
    roots.forEach(syncAutoGrowTextareas);
  });
}
function setupAutoGrowTextareas() {
  if (_autoGrowReady) return;
  _autoGrowReady = true;
  document.addEventListener('input', function (event) {
    if (event.target && event.target.matches('.modal-overlay textarea')) {
      resizeAutoGrowTextarea(event.target);
      requestAnimationFrame(function () {
        if (typeof refreshFocusedInputVisibility === 'function') refreshFocusedInputVisibility();
      });
    }
  });
  document.addEventListener('focusin', function (event) {
    if (event.target && event.target.matches('.modal-overlay textarea')) resizeAutoGrowTextarea(event.target);
  });
  if (window.MutationObserver)
    document.querySelectorAll('.modal-overlay').forEach(function (modal) {
      var observer = new MutationObserver(function () {
        scheduleAutoGrowTextareas(modal);
      });
      observer.observe(modal, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
      _autoGrowObservers.push(observer);
    });
  scheduleAutoGrowTextareas(document);
}
function openModal(id) {
  var page = appPageForModal(id);
  if (page) {
    switchAppPage(page);
    return;
  }
  showModalSurface(id);
  if (id === 'wb-modal') {
    renderWBAll();
    loadWBSettings();
  }
  if (id === 'import-modal') {
    resetImport();
    // Reset to file tab
    const modal = $(id);
    const tabs = modal.querySelectorAll('.tabs button');
    if (tabs.length) {
      tabs[0].classList.add('active');
      if (tabs.length > 1) tabs[1].classList.remove('active');
    }
    const filePanel = modal.querySelector('#import-file');
    const pastePanel = modal.querySelector('#import-paste');
    if (filePanel) filePanel.style.display = '';
    if (pastePanel) pastePanel.style.display = 'none';
  }
  if (id === 'persona-modal') {
    resetPersonaModal();
  }
  if (id === 'app-prompt-modal') syncAppPromptActions();
  if (id === 'create-modal' && !$('edit-char-id').value) {
    $('c-emoji').value = '';
    $('bg-preview').querySelector('img')?.remove();
    $('bg-text').style.display = '';
    document.getElementById('temp-bg-data')?.remove();
  }
  scheduleAutoGrowTextareas($(id));
  if (typeof syncAppSelects === 'function') syncAppSelects($(id));
  rememberUnsavedEditorBaseline(id);
}
function getTopOpenModal() {
  var rows = _modalStack.filter(function (node) {
    return node.isConnected && node.classList.contains('open');
  });
  return rows.length ? rows[rows.length - 1] : null;
}
function closeModal(id, options) {
  if (id === 'speech-settings-modal') {
    stopSpeech();
    _speechEditor = null;
  }
  if (id === 'wheel-scheme-spin-modal') return closeWheelSchemeSpin();
  if (typeof _scriptDialogResolvers !== 'undefined' && _scriptDialogResolvers.has(id)) {
    var scriptResolver = _scriptDialogResolvers.get(id);
    _scriptDialogResolvers.delete(id);
    hideModalSurface(id);
    scriptResolver(null);
    return true;
  }
  if (id === 'yeyu-script-library-panel') return closeCurrentCardScriptLibrary();
  var closingPage = appPageForModal(id);
  if (closingPage) {
    // 底部操作栏的取消：丢弃本页草稿，下次进入按已保存设置重新载入；切换目的地不走这里，草稿保留。
    if (closingPage === 'settings') discardProviderDraft();
    delete $(id).dataset.loaded;
    switchAppPage('chat');
    return true;
  }
  if (id === 'memory-progress-modal' && _memoryJobActive) return false;
  if (id === 'memory-review-modal' && typeof memoryReviewConfirming === 'function' && memoryReviewConfirming())
    return false;
  if (id === 'creator-notes-modal' && creatorNotesResolver) return false;
  if (id === 'import-progress-modal' && _importProgressActive) return false;
  if (id === 'greeting-modal' && typeof cancelGreetingOverviewRequests === 'function') cancelGreetingOverviewRequests();
  if (id === 'greeting-modal' && greetingResolver) {
    var greetingCancel = greetingResolver;
    greetingResolver = null;
    greetingPreviewVars = null;
    greetingPreviewSession = null;
    greetingCancel(null);
  }
  // Every prompt leaves through here, so a danger tone or second action asked for by one confirmation
  // never carries over to a later prompt that sets its mode directly.
  if (id === 'app-prompt-modal') {
    appPromptDanger = false;
    appPromptAlternative = '';
  }
  if (id === 'app-prompt-modal' && appPromptResolver) {
    var promptCancel = appPromptResolver;
    appPromptResolver = null;
    appPromptOwner = null;
    promptCancel(appPromptMode === 'input' ? null : false);
  }
  if (id === 'import-modal' && typeof resetImport === 'function') resetImport();
  // Esc 和点遮罩不经过取消按钮，这里兜底清掉暂存的新提示词：暂存条目不跨越模态框生命周期。
  if (id === 'prompt-entry-modal' && typeof _completionPresetPromptPending !== 'undefined')
    _completionPresetPromptPending = null;
  // 同理，未确认的记忆批次不跨越预览弹窗生命周期，关闭一律按丢弃处理。
  if (id === 'memory-review-modal' && typeof discardMemoryReviewState === 'function') discardMemoryReviewState();
  hideModalSurface(id);
  if (id === 'wb-modal' && typeof resetWBModalView === 'function') resetWBModalView();
  return true;
}
// ===== Unsaved editor guard =====
// Editors of long typed input, keyed by modal: `form` is the element whose controls hold the input,
// `extra` the state kept outside those controls, and `active` whether an editor that is one view of a
// larger modal is showing. Opening an editor or saving it in place records a snapshot; a dismissal
// compares against it and asks before throwing changed input away. Saving never asks.
var UNSAVED_EDITORS = {
    'create-modal': {
      form: 'create-modal',
      // The picked or cleared background waits in a hidden input outside the form until saved.
      extra: function () {
        var temp = document.getElementById('temp-bg-data');
        return temp ? temp.value : '';
      },
    },
    'persona-modal': { form: 'persona-modal' },
    'wb-modal': {
      form: 'wb-add',
      active: function () {
        return wbEditorIsOpen();
      },
    },
    'edit-msg-modal': { form: 'edit-msg-modal' },
  },
  _unsavedEditorSnapshots = {};
function unsavedEditorState(id) {
  var editor = UNSAVED_EDITORS[id],
    form = editor && $(editor.form);
  if (!form) return '';
  var values = Array.from(form.querySelectorAll('input, textarea, select'))
    .filter(function (node) {
      return node.type !== 'file';
    })
    .map(function (node) {
      return node.type === 'checkbox' || node.type === 'radio' ? node.checked : node.value;
    });
  if (editor.extra) values.push(editor.extra());
  return JSON.stringify(values);
}
function rememberUnsavedEditorBaseline(id) {
  if (UNSAVED_EDITORS[id]) _unsavedEditorSnapshots[id] = unsavedEditorState(id);
}
function editorHasUnsavedChanges(id) {
  var editor = UNSAVED_EDITORS[id];
  if (!editor || !(id in _unsavedEditorSnapshots)) return false;
  if (editor.active && !editor.active()) return false;
  return unsavedEditorState(id) !== _unsavedEditorSnapshots[id];
}
// Runs `discard` right away when nothing changed, so an untouched editor closes exactly as before;
// otherwise only after the reader confirms. Declining leaves the editor and its input as they were.
function discardEditorAfterConfirm(id, discard) {
  if (!editorHasUnsavedChanges(id)) {
    discard();
    return;
  }
  appConfirm('这里的修改还没有保存，离开后不会保留。', '放弃未保存的修改', '放弃修改', { danger: true }).then(
    function (confirmed) {
      if (confirmed) discard();
    }
  );
}
var _modalSavesInFlight = new Set();
// One save per editor at a time: a new record gets its id only after the write, so a second tap
// during the write would create it again. Repeated taps are ignored until the save settles.
async function runModalSave(id, save) {
  if (_modalSavesInFlight.has(id)) return false;
  _modalSavesInFlight.add(id);
  try {
    return await save();
  } finally {
    _modalSavesInFlight.delete(id);
  }
}
function modalSaveInFlight(id) {
  return _modalSavesInFlight.has(id);
}
// The close icon and cancel button of a guarded editor.
function requestCloseModal(id) {
  discardEditorAfterConfirm(id, function () {
    closeModal(id);
  });
}
// The overlay, Escape and the native back key dismiss the top modal alike: the world book entry
// editor steps back to its list and a branch merge preview is cancelled; the rest close. A message
// editor that is saving stays open until the save settles.
function dismissModalLayer(id) {
  if (modalSaveInFlight(id)) return;
  if (id === 'wb-modal' && typeof handleWBBack === 'function' && handleWBBack()) return;
  if (id === 'branch-merge-modal') cancelBranchMergePreview();
  else requestCloseModal(id);
}
document.querySelectorAll('.modal-overlay').forEach((o) => {
  var page = appPageForModal(o.id),
    dialog = o.querySelector('.modal') || o;
  if (page) {
    o.classList.add('app-page');
    o.querySelector('.modal-hd').tabIndex = -1;
    dialog.setAttribute('role', 'region');
    dialog.removeAttribute('aria-modal');
  } else {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
  }
  var title = o.querySelector('.modal-hd h2');
  if (title) {
    if (!title.id) title.id = o.id + '-title';
    dialog.setAttribute('aria-labelledby', title.id);
  }
  o.querySelectorAll('.modal-close').forEach(function (button) {
    if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', '关闭');
  });
  o.addEventListener('click', function (e) {
    if (e.target !== this) return;
    if (
      (this.id === 'memory-progress-modal' && _memoryJobActive) ||
      (this.id === 'creator-notes-modal' && creatorNotesResolver) ||
      (this.id === 'import-progress-modal' && _importProgressActive)
    )
      return;
    dismissModalLayer(this.id);
  });
});
// Escape dismisses the topmost layer; true when the key was consumed. Escape pressed inside a
// same-origin iframe reaches the host through the frame bridge in 99-bootstrap.js.
function dismissTopLayerOnEscape() {
  if (typeof closeAppSelect === 'function' && closeAppSelect()) return true;
  if (document.querySelector('.msg-more.open')) {
    closeMessageMore();
    return true;
  }
  if (_memoryJobActive || creatorNotesResolver || _importProgressActive) return true;
  var modal = getTopOpenModal();
  if (!modal) return typeof window.handleNativeBack === 'function' && window.handleNativeBack();
  dismissModalLayer(modal.id);
  return true;
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Tab' && !(typeof appSelectIsOpen === 'function' && appSelectIsOpen())) {
    var top = getTopOpenModal();
    if (top) {
      var nodes = Array.from(top.querySelectorAll('button,input,textarea,select,iframe,a[href],[tabindex]')).filter(
        function (node) {
          return (
            !node.disabled &&
            node.tabIndex >= 0 &&
            node.getClientRects().length &&
            getComputedStyle(node).visibility !== 'hidden'
          );
        }
      );
      var first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) {
        e.preventDefault();
        if (last) last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) {
        e.preventDefault();
        if (first) first.focus();
      }
    }
  }
  if (e.key === 'Escape' && dismissTopLayerOnEscape()) e.preventDefault();
});
document.addEventListener('click', function (e) {
  if (!e.target.closest || !e.target.closest('.msg-more')) closeMessageMore();
});

let appPromptResolver = null;
let appPromptMode = 'input';
let appPromptMultiline = false;
let appPromptChoice = false;
let appPromptOwner = null;
let appPromptDanger = false;
let appPromptAlternative = '';
function cancelOwnedAppPrompt(owner) {
  if (!owner || appPromptOwner !== owner || !appPromptResolver) return false;
  closeModal('app-prompt-modal');
  return true;
}
function prepareAppPrompt(mode, resolve, message, title, options) {
  if (appPromptResolver) {
    var previous = appPromptResolver;
    appPromptResolver = null;
    appPromptOwner = null;
    previous(appPromptMode === 'input' ? null : false);
  }
  appPromptMode = mode;
  appPromptResolver = resolve;
  appPromptOwner = (options && options.owner) || null;
  $('app-prompt-title').textContent = title || (mode === 'input' ? '输入内容' : '确认操作');
  $('app-prompt-message').classList.remove('app-prompt-rich');
  $('app-prompt-message').textContent = message || '';
}
function appConfirm(message, title, okText, options) {
  return new Promise(function (resolve) {
    prepareAppPrompt('confirm', resolve, message, title, options);
    appPromptDanger = !!(options && options.danger);
    appPromptAlternative = String((options && options.alternative) || '');
    $('app-prompt-field').style.display = 'none';
    $('app-prompt-ok').textContent = okText || '确定';
    openModal('app-prompt-modal');
  });
}
function appInput(message, defaultValue, title, label, options) {
  return new Promise(function (resolve) {
    prepareAppPrompt('input', resolve, message, title, options);
    appPromptAlternative = '';
    appPromptMultiline = !!(options && options.multiline);
    appPromptChoice = !!(options && options.choices && options.choices.length);
    $('app-prompt-field').style.display = '';
    $('app-prompt-label').textContent = label || '内容';
    $('app-prompt-input').style.display = appPromptMultiline || appPromptChoice ? 'none' : '';
    $('app-prompt-textarea').style.display = appPromptMultiline && !appPromptChoice ? '' : 'none';
    $('app-prompt-choice').hidden = !appPromptChoice;
    if (appPromptChoice) renderAppPromptChoices(options.choices, defaultValue);
    $('app-prompt-input').value = defaultValue || '';
    $('app-prompt-textarea').value = defaultValue || '';
    $('app-prompt-ok').textContent = (options && options.okText) || '确定';
    openModal('app-prompt-modal');
    setTimeout(function () {
      if (appPromptChoice) {
        var choice = $('app-prompt-choice');
        (choice.querySelector('input:checked') || choice.querySelector('input'))?.focus({ preventScroll: true });
        return;
      }
      var input = $(appPromptMultiline ? 'app-prompt-textarea' : 'app-prompt-input');
      if (input) input.select();
    }, 80);
  });
}
// 两种完成操作加取消：主按钮得到 'primary'，另一个得到 'alternative'，取消或关闭得到 null。
function appChooseAction(message, title, primaryText, alternativeText) {
  return appConfirm(message, title, primaryText, { alternative: alternativeText }).then(function (result) {
    return result === 'alternative' ? 'alternative' : result ? 'primary' : null;
  });
}
function resolveAppPromptAlternative() {
  var resolver = appPromptResolver;
  appPromptResolver = null;
  appPromptOwner = null;
  closeModal('app-prompt-modal');
  if (resolver) resolver('alternative');
}
function resolveAppPrompt(ok) {
  var resolver = appPromptResolver;
  appPromptResolver = null;
  appPromptOwner = null;
  closeModal('app-prompt-modal');
  if (!resolver) return;
  if (!ok) {
    resolver(appPromptMode === 'input' ? null : false);
    return;
  }
  resolver(appPromptMode === 'input' ? appPromptValue() : true);
}
function appPromptValue() {
  if (appPromptChoice) return $('app-prompt-choice').querySelector('input:checked')?.value || '';
  return $(appPromptMultiline ? 'app-prompt-textarea' : 'app-prompt-input').value;
}
// Choices are a short list of rows; nothing is checked when the default is not one of them.
function renderAppPromptChoices(choices, defaultValue) {
  var list = $('app-prompt-choice');
  list.replaceChildren();
  choices.forEach(function (choice) {
    var row = document.createElement('label'),
      input = document.createElement('input'),
      text = document.createElement('span');
    row.className = 'prompt-choice';
    input.type = 'radio';
    input.name = 'app-prompt-choice';
    input.value = String(choice);
    input.checked = input.value === String(defaultValue);
    text.textContent = String(choice);
    row.append(input, text);
    list.appendChild(row);
  });
}
function isDestructiveActionLabel(label) {
  return /^(删除|清除|清空|移除)/.test(String(label || '').trim());
}
// A confirmation whose action removes data gets the danger button instead of the primary one; a caller
// whose action loses input under another verb asks for it with `options.danger`. The second action
// button shows only for a confirmation that asked for one (`options.alternative`).
function syncAppPromptActions() {
  var alternative = $('app-prompt-alt');
  alternative.textContent = appPromptAlternative;
  alternative.hidden = !appPromptAlternative;
  var ok = $('app-prompt-ok'),
    danger = appPromptMode === 'confirm' && (appPromptDanger || isDestructiveActionLabel(ok.textContent));
  ok.classList.toggle('danger', danger);
  ok.classList.toggle('primary', !danger);
}
function handleAppPromptKey(e) {
  if (e.key === 'Enter' && (!appPromptMultiline || e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    resolveAppPrompt(true);
  }
}
