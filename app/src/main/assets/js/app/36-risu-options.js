// Card-owned Risu controls. Values belong only to the current Risu conversation.
function risuToggleItems(template) {
  var items = [],
    group = null;
  String(template || '')
    .split('\n')
    .forEach(function (line) {
      var parts = line.split('='),
        key = parts[0],
        value = parts[1],
        type = parts[2],
        item;
      if (type === 'groupEnd') {
        group = null;
        return;
      }
      if (type === 'group') {
        group = { key: key, value: value || '', type: type, children: [] };
        items.push(group);
        return;
      }
      if (type !== 'divider' && !(value && (key || type === 'caption'))) return;
      item = {
        key: key,
        value: value || '',
        type: ['select', 'text', 'textarea', 'caption', 'divider'].includes(type) ? type : 'check',
        options: (parts[3] || '').split(','),
      };
      (group ? group.children : items).push(item);
    });
  return items;
}
function syncRisuOptionsUI() {
  var char = getChar(),
    button = $('risu-options-btn'),
    modal = $('risu-options-modal');
  if (button) button.hidden = !isRisuCharacter(char);
  var expressionButton = $('expression-manager-btn');
  if (expressionButton) expressionButton.hidden = isRisuCharacter(char);
  if (
    modal &&
    modal.classList.contains('open') &&
    (!char || modal.dataset.owner !== char.id + ':' + getActiveSession(char.id).id)
  )
    closeModal('risu-options-modal');
}
async function risuSetToggle(char, session, key, value) {
  await risuWithExecution(char, session, {}, function (context) {
    context.state.globalVars['toggle_' + key] = String(value);
    context.state.changedGlobals.add('toggle_' + key);
  });
  if (getChar() === char && getActiveSession(char.id) === session) {
    renderChat();
    scheduleTokensBar(char);
  }
}
function openRisuOptions() {
  var char = getChar(),
    session = char && getActiveSession(char.id);
  if (!isRisuCharacter(char) || !session) return;
  closeChatTools();
  var host = $('risu-options-body'),
    modal = $('risu-options-modal'),
    sources = risuCardSources(char),
    values = (session.risu && session.risu.globalVariables) || {},
    items = risuToggleItems(sources.card.toggles || sources.card.customModuleToggle || '');
  host.replaceChildren();
  modal.dataset.owner = char.id + ':' + session.id;
  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  function appendItems(parent, rows) {
    rows.forEach(function (item) {
      if (item.type === 'group') {
        if (!item.children.length) return;
        var group = element('details', 'risu-option-group');
        group.append(element('summary', '', item.value));
        appendItems(group, item.children);
        parent.append(group);
        return;
      }
      if (item.type === 'caption' || item.type === 'divider') {
        parent.append(
          element(
            item.type === 'caption' ? 'p' : 'h3',
            item.type === 'caption' ? 'hint' : 'risu-option-divider',
            item.value
          )
        );
        return;
      }
      var label = element('label', 'risu-option-row'),
        title = element('span', '', item.value),
        input;
      if (item.type === 'select') {
        input = element('select');
        item.options.forEach(function (option, index) {
          var entry = element('option', '', option);
          entry.value = String(index);
          input.append(entry);
        });
      } else {
        input = element(item.type === 'textarea' ? 'textarea' : 'input');
        if (item.type !== 'textarea') input.type = item.type === 'check' ? 'checkbox' : 'text';
      }
      input.dataset.risuToggle = item.key;
      input.setAttribute('aria-label', item.value);
      if (item.type === 'check') input.checked = values['toggle_' + item.key] === '1';
      else input.value = values['toggle_' + item.key] || '';
      input.addEventListener('change', async function () {
        var previous = values['toggle_' + item.key],
          value = item.type === 'check' ? (input.checked ? '1' : '0') : input.value;
        input.disabled = true;
        try {
          await risuSetToggle(char, session, item.key, value);
          values['toggle_' + item.key] = value;
        } catch (error) {
          if (item.type === 'check') input.checked = previous === '1';
          else input.value = previous || '';
          risuScriptError(error);
        } finally {
          input.disabled = false;
        }
      });
      label.append(title, input);
      parent.append(label);
    });
  }
  appendItems(host, items);
  var triggers = sources.triggers.filter(function (trigger) {
    return trigger.type === 'manual' && trigger.comment;
  });
  if (triggers.length) {
    host.append(element('h3', 'risu-option-divider', '卡片操作'));
    var actions = element('div', 'risu-option-actions');
    host.append(actions);
    triggers.forEach(function (trigger) {
      var button = element('button', 'btn', trigger.comment);
      button.type = 'button';
      button.dataset.risuManual = trigger.comment;
      button.addEventListener('click', async function () {
        if (getChar() !== char || getActiveSession(char.id) !== session) return;
        button.disabled = true;
        try {
          await runRisuManualTrigger(trigger.comment);
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    });
  }
  if (!items.length && !triggers.length) host.append(element('p', 'hint', '这张卡片没有额外选项。'));
  openModal('risu-options-modal');
}
