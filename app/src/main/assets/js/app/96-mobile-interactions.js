// ===== Tab switching =====
function switchTab(tab) {
  document.querySelectorAll('#sidebar .sidebar-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  ['chars', 'personas', 'worldbook', 'wheels'].forEach((t) => $('tab-' + t).classList.remove('active'));
  $('tab-' + tab).classList.add('active');
  if (tab === 'personas') renderPersonaList();
  if (tab === 'worldbook') renderWBSidebar();
  if (tab === 'wheels') renderWheelSchemeLibrary();
  revealUiContent($('tab-' + tab));
}
function openSidebarTab(tab) {
  if (window.innerWidth <= 768) setSidebarOpen(true);
  switchTab(tab);
}

function switchSub(prefix, tab, btn) {
  const modal = btn.closest('.modal-overlay');
  var changed = !btn.classList.contains('active');
  modal.querySelectorAll('.tabs button').forEach(function (b) {
    b.classList.remove('active');
  });
  btn.classList.add('active');
  // Only target known panel IDs, NOT form fields that share the prefix
  var panelSuffixes = ['file', 'paste'];
  panelSuffixes.forEach(function (suffix) {
    var panel = modal.querySelector('#' + prefix + '-' + suffix);
    if (panel) panel.style.display = suffix === tab ? '' : 'none';
  });
  if (typeof scheduleAutoGrowTextareas === 'function') scheduleAutoGrowTextareas(modal);
  if (changed) revealUiContent(modal.querySelector('#' + prefix + '-' + tab));
}

function switchSettingsTab(tab, btn) {
  var previous = document.querySelector('#settings-modal .tabs button.active');
  document.querySelectorAll('#settings-modal .tabs button').forEach(function (button) {
    button.classList.remove('active');
    button.setAttribute('aria-selected', 'false');
  });
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  ['api', 'routes', 'retrieval', 'params', 'translation', 'image', 'speech', 'appearance', 'regex', 'qr'].forEach((t) => {
    const panel = $('st-' + t);
    if (panel) panel.style.display = 'none';
  });
  const target = $('st-' + tab);
  if (target) target.style.display = '';
  if (tab === 'regex' && typeof renderRegexScriptManager === 'function') renderRegexScriptManager();
  if (tab === 'qr' && typeof renderQuickReplyManager === 'function') renderQuickReplyManager();
  if (target && typeof scheduleAutoGrowTextareas === 'function') scheduleAutoGrowTextareas(target);
  if (target && previous !== btn) {
    target.closest('.modal-body').scrollTop = 0;
    revealUiContent(target);
  }
}

function generateLatestMessageImage() {
  var char = getChar();
  if (!char) return false;
  var session = getActiveSession(char.id);
  var index = latestManualImageMessageIndex(session);
  if (index < 0) {
    toast('当前对话没有可生图的 AI 回复', 'info');
    return false;
  }
  return generateMessageImage(index);
}

function refreshComposerImageButton() {
  var button = $('composer-image-btn');
  if (!button || typeof latestManualImageMessageIndex !== 'function') return;
  var char = getChar();
  var session = char && getActiveSession(char.id);
  var index = latestManualImageMessageIndex(session);
  var message = index >= 0 && session.msgs[index];
  var run = message && _messageImageRuns.get(messageImageRunKey(char.id, session.id, message.seq));
  var stopping = run && run.stopping;
  var saving = run && run.saving;
  var running = run && !stopping && !saving;
  var label = stopping ? '正在停止生图' : saving ? '正在保存图片' : running ? '停止生图' : '为最新 AI 回复生图';
  button.disabled = index < 0 || !!stopping || !!saving;
  button.title = label;
  button.setAttribute('aria-label', label);
  var icon = button.querySelector('use');
  if (icon) {
    icon.setAttribute('href', running ? '#i-stop' : '#i-palette');
    icon.setAttribute('xlink:href', running ? '#i-stop' : '#i-palette');
  }
}

function switchMemoryTab(tab, btn) {
  var previous = document.querySelector('.memory-tabs button.active');
  document.querySelectorAll('.memory-tabs button').forEach(function (button) {
    button.classList.toggle('active', button === btn);
    button.setAttribute('aria-selected', String(button === btn));
  });
  $('memory-overview').hidden = tab !== 'overview';
  $('memory-settings').hidden = tab !== 'settings';
  scheduleAutoGrowTextareas($('memory-' + tab));
  if (previous !== btn) {
    $('memory-' + tab).closest('.modal-body').scrollTop = 0;
    revealUiContent($('memory-' + tab));
  }
}

// ===== Mobile sidebar =====
function setSidebarOpen(open) {
  var sb = $('sidebar');
  var bd = $('sidebar-backdrop');
  if (!sb) return;
  var restoreFocus = !open && sb.contains(document.activeElement);
  sb.classList.toggle('hidden', !open);
  sb.inert = !open;
  sb.setAttribute('aria-hidden', String(!open));
  if (bd) bd.classList.toggle('show', open && window.innerWidth <= 768);
  var trigger = $('mobile-menu');
  if (trigger) {
    trigger.setAttribute('aria-expanded', String(open));
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
}
function toggleSidebar() {
  setSidebarOpen($('sidebar').classList.contains('hidden'));
}

// ===== Drag & Drop =====
function setupDZ(zId, fId, handler) {
  const z = $(zId);
  if (!z) return;
  z.addEventListener('dragover', (e) => {
    e.preventDefault();
    z.classList.add('drag');
  });
  z.addEventListener('dragleave', (e) => {
    e.preventDefault();
    z.classList.remove('drag');
  });
  z.addEventListener('drop', (e) => {
    e.preventDefault();
    z.classList.remove('drag');
    if (e.dataTransfer.files.length) {
      const dt = new DataTransfer();
      [...e.dataTransfer.files].forEach((f) => dt.items.add(f));
      const inp = $(fId);
      inp.files = dt.files;
      handler({ target: inp });
    }
  });
}

// ===== Textarea auto-resize =====
var _composerPairComposing = false,
  _composerPendingPair = null;
function applyComposerPair(open, close) {
  var input = $('user-input');
  if (!input || input.disabled) return;
  open = String(open || '');
  close = String(close || '');
  var start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length,
    end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start,
    scrollTop = input.scrollTop,
    selected = input.value.slice(start, end);
  input.value = input.value.slice(0, start) + open + selected + close + input.value.slice(end);
  try {
    input.focus({ preventScroll: true });
  } catch (_) {
    input.focus();
  }
  if (end > start) input.setSelectionRange(start + open.length, end + open.length);
  else input.setSelectionRange(start + open.length, start + open.length);
  input.scrollTop = scrollTop;
  var event;
  try {
    event = new InputEvent('input', { bubbles: true, inputType: 'insertText', data: open + close });
  } catch (_) {
    event = new Event('input', { bubbles: true });
  }
  input.dispatchEvent(event);
  requestAnimationFrame(function () {
    input.scrollTop = scrollTop;
    syncComposerMetrics();
  });
}
function insertComposerPair(open, close) {
  var input = $('user-input');
  if (!input) return;
  if (_composerPairComposing) {
    _composerPendingPair = { open: String(open || ''), close: String(close || '') };
    input.blur();
    setTimeout(function () {
      if (!_composerPendingPair) return;
      _composerPairComposing = false;
      var pending = _composerPendingPair;
      _composerPendingPair = null;
      applyComposerPair(pending.open, pending.close);
    }, 60);
    return;
  }
  applyComposerPair(open, close);
}
document.addEventListener('compositionstart', function (event) {
  if (event.target && event.target.id === 'user-input') _composerPairComposing = true;
});
document.addEventListener('compositionend', function (event) {
  if (!event.target || event.target.id !== 'user-input') return;
  _composerPairComposing = false;
  if (_composerPendingPair) {
    var pending = _composerPendingPair;
    _composerPendingPair = null;
    setTimeout(function () {
      applyComposerPair(pending.open, pending.close);
    }, 0);
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'user-input') {
    resizeComposerInput(e.target);
  }
});
