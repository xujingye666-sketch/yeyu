// Select values and change handlers stay on the original form control.
var _appSelectSource = null,
  _appSelectSequence = 0,
  _appSelectReady = false;
function appSelectIsOpen() {
  return !!_appSelectSource;
}
function appSelectLabel(source) {
  var label = source.labels && source.labels[0];
  if (!label) label = source.closest('.fg')?.querySelector('label');
  return source.getAttribute('aria-label') || (label && label.textContent.trim()) || '选择';
}
function syncAppSelects(root) {
  root = root || document;
  var rows = Array.from(
    root.querySelectorAll(root === document ? '.modal-overlay select, .card-bgm-panel select' : 'select')
  );
  rows.forEach(function (source) {
    var wrapper = source.closest('.app-select');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'app-select';
      source.before(wrapper);
      wrapper.appendChild(source);
      source.classList.add('app-select-native');
      source.tabIndex = -1;
      source.setAttribute('aria-hidden', 'true');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-select-trigger';
      button.id = (source.id || 'app-select-' + ++_appSelectSequence) + '-control';
      button.setAttribute('role', 'combobox');
      button.setAttribute('aria-haspopup', 'listbox');
      button.setAttribute('aria-controls', 'app-select-list');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML =
        '<span></span><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
      button.addEventListener('click', function () {
        if (_appSelectSource === source) closeAppSelect();
        else openAppSelect(source);
      });
      button.addEventListener('keydown', function (event) {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          openAppSelect(source, event.key === 'End' ? 'last' : event.key === 'Home' ? 'first' : 'selected');
        }
      });
      wrapper.appendChild(button);
      source.addEventListener('focus', function () {
        button.focus({ preventScroll: true });
      });
    }
    var trigger = wrapper.querySelector('.app-select-trigger');
    var text = source.selectedOptions[0]?.textContent || '请选择';
    if (trigger.firstElementChild.textContent !== text) trigger.firstElementChild.textContent = text;
    var labelText = appSelectLabel(source) + '：' + text;
    if (trigger.getAttribute('aria-label') !== labelText) trigger.setAttribute('aria-label', labelText);
    trigger.disabled = source.disabled;
    wrapper.hidden = source.hidden || source.style.display === 'none';
    if (_appSelectSource === source && (trigger.disabled || wrapper.hidden || !source.isConnected))
      closeAppSelect(false);
  });
}
function closeAppSelect(restoreFocus) {
  if (!_appSelectSource) return false;
  var trigger = _appSelectSource.closest('.app-select')?.querySelector('.app-select-trigger');
  _appSelectSource = null;
  var panel = $('app-select-list');
  transitionUiVisibility(panel, false, function () {
    panel.hidden = true;
  });
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus !== false && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
  }
  return true;
}
function positionAppSelect() {
  if (!_appSelectSource) return;
  var trigger = _appSelectSource.closest('.app-select')?.querySelector('.app-select-trigger');
  if (!trigger || !trigger.getClientRects().length) {
    closeAppSelect(false);
    return;
  }
  var rect = trigger.getBoundingClientRect(),
    panel = $('app-select-list'),
    viewport = window.visualViewport;
  var top = viewport ? viewport.offsetTop : 0,
    bottom = top + (viewport ? viewport.height : innerHeight);
  if (document.body.classList.contains('keyboard-open')) {
    var usable = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--app-keyboard-viewport-height')
    );
    if (usable > 0) bottom = Math.min(bottom, top + usable);
  }
  var scrollBody = trigger.closest('.modal-body, .preset-tab-panel');
  if (scrollBody) {
    var bodyRect = scrollBody.getBoundingClientRect();
    if (rect.bottom <= bodyRect.top || rect.top >= bodyRect.bottom) {
      closeAppSelect(false);
      return;
    }
  }
  var width = Math.min(Math.max(rect.width, 200), innerWidth - 24);
  var below = bottom - rect.bottom - 12,
    above = rect.top - top - 12;
  var upward = below < Math.min(panel.scrollHeight, 220) && above > below;
  panel.style.width = width + 'px';
  panel.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
  panel.style.maxHeight = Math.max(80, Math.min(300, (upward ? above : below) - 6)) + 'px';
  panel.style.top = (upward ? Math.max(top + 12, rect.top - panel.offsetHeight - 6) : rect.bottom + 6) + 'px';
}
function openAppSelect(source, edge) {
  if (source.disabled) return;
  closeAppSelect(false);
  var panel = $('app-select-list'),
    trigger = source.closest('.app-select').querySelector('.app-select-trigger');
  _appSelectSource = source;
  panel.replaceChildren();
  panel.setAttribute('aria-label', appSelectLabel(source));
  Array.from(source.children).forEach(function (child) {
    var options = child.tagName === 'OPTGROUP' ? Array.from(child.children) : [child];
    if (child.tagName === 'OPTGROUP') {
      var heading = document.createElement('div');
      heading.className = 'app-select-group';
      heading.textContent = child.label;
      panel.appendChild(heading);
    }
    options.forEach(function (option) {
      if (option.hidden) return;
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'app-select-option';
      row.dataset.optionIndex = String(option.index);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      row.disabled = option.disabled || (child.tagName === 'OPTGROUP' && child.disabled);
      row.textContent = option.textContent;
      row.tabIndex = -1;
      row.addEventListener('click', function () {
        var changed = source.selectedIndex !== option.index;
        source.selectedIndex = option.index;
        closeAppSelect();
        if (changed) {
          source.dispatchEvent(new Event('input', { bubbles: true }));
          source.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncAppSelects();
      });
      panel.appendChild(row);
    });
  });
  if (!panel.children.length) {
    var empty = document.createElement('p');
    empty.className = 'app-select-empty';
    empty.textContent = '暂无可选项';
    panel.appendChild(empty);
  }
  transitionUiVisibility(panel, true, function () {
    panel.hidden = false;
  });
  trigger.setAttribute('aria-expanded', 'true');
  positionAppSelect();
  var rows = Array.from(panel.querySelectorAll('button:not(:disabled)'));
  var focus =
    edge === 'last'
      ? rows[rows.length - 1]
      : edge === 'first'
        ? rows[0]
        : rows.find(function (row) {
            return row.getAttribute('aria-selected') === 'true';
          }) || rows[0];
  if (focus) {
    focus.tabIndex = 0;
    focus.focus({ preventScroll: true });
    focus.scrollIntoView({ block: 'nearest' });
  }
}
function setupAppSelects() {
  if (_appSelectReady) return;
  _appSelectReady = true;
  var panel = document.createElement('div');
  panel.id = 'app-select-list';
  panel.className = 'app-select-list';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  document.body.appendChild(panel);
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Tab') {
      closeAppSelect();
      return;
    }
    var rows = Array.from(panel.querySelectorAll('button:not(:disabled)'));
    var index = rows.indexOf(document.activeElement),
      next = index;
    if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key.length === 1 && event.key !== ' ') {
      var found = rows.findIndex(function (row, i) {
        return i > index && row.textContent.toLowerCase().startsWith(event.key.toLowerCase());
      });
      if (found >= 0) next = found;
      else return;
    } else return;
    event.preventDefault();
    if (rows[next]) {
      rows.forEach(function (row) {
        row.tabIndex = -1;
      });
      rows[next].tabIndex = 0;
      rows[next].focus();
    }
  });
  document.addEventListener(
    'pointerdown',
    function (event) {
      if (!event.target.closest('.app-select, .app-select-list')) closeAppSelect(false);
    },
    true
  );
  ['change', 'click'].forEach(function (name) {
    document.addEventListener(
      name,
      function (event) {
        var scope =
          (event.target && event.target.closest && event.target.closest('.modal-overlay, .card-bgm-panel')) || document;
        queueMicrotask(function () {
          syncAppSelects(scope);
        });
      },
      true
    );
  });
  document.addEventListener(
    'scroll',
    function (event) {
      if (_appSelectSource && event.target !== panel) positionAppSelect();
    },
    true
  );
  window.addEventListener('resize', function () {
    closeAppSelect(false);
  });
  if (window.visualViewport)
    window.visualViewport.addEventListener('resize', function () {
      closeAppSelect(false);
    });
  var observer = new MutationObserver(function (records) {
    var openSource = _appSelectSource;
    var optionsChanged =
      openSource &&
      records.some(function (record) {
        return record.target === openSource || openSource.contains(record.target);
      });
    if (
      records.some(function (record) {
        return (
          record.target.closest('select') ||
          Array.from(record.addedNodes).some(function (node) {
            return node.nodeType === 1 && (node.matches('select') || node.querySelector('select'));
          })
        );
      })
    ) {
      syncAppSelects();
      if (optionsChanged && _appSelectSource === openSource) openAppSelect(openSource);
    }
  });
  document.querySelectorAll('.modal-overlay, .card-bgm-panel').forEach(function (modal) {
    observer.observe(modal, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'selected', 'label', 'style'],
    });
  });
  syncAppSelects();
}
