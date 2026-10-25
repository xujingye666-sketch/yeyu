var _hostVariableSchemas = Object.create(null),
  _hostVariableSchemaOwner = {};
function hostVariableSchemaSync() {
  var char = getChar(),
    character = char ? String(char.id) + '|' + String(char.name) : '',
    preset = D.settings.activeChatCompletionPresetName;
  if (_hostVariableSchemaOwner.character !== character) {
    ['character', 'chat', 'message'].forEach(function (type) {
      delete _hostVariableSchemas[type];
    });
  }
  if (_hostVariableSchemaOwner.preset !== preset) delete _hostVariableSchemas.preset;
  _hostVariableSchemaOwner = { character: character, preset: preset };
}
function hostVariableRegisterSchema(live, schema, type) {
  cardFrontendRequireCurrent(live);
  if (!['global', 'preset', 'character', 'chat', 'message'].includes(type)) throw new Error('schema 作用域无效');
  if (!schema || typeof schema !== 'object') throw new Error('schema 必须是对象');
  hostVariableSchemaSync();
  _hostVariableSchemas[type] = schema;
  if ($('card-settings-modal')?.classList.contains('show')) renderHostVariableEditor();
}
function hostVariableSchema(type) {
  hostVariableSchemaSync();
  return _hostVariableSchemas[type] || null;
}
function hostVariableSchemaInfo(schema) {
  var current = schema,
    def = {},
    kind = '';
  for (var i = 0; current && i < 10; i++) {
    def = current._zod?.def || current._def || {};
    kind = String(def.typeName || def.type || '')
      .replace(/^Zod/, '')
      .toLowerCase();
    if (['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'effects', 'pipe'].includes(kind))
      current = def.innerType || def.schema || def.in;
    else break;
  }
  var shape = current && (current.shape || def.shape),
    values = def.values || (def.entries && Object.values(def.entries));
  return {
    kind: kind,
    shape: typeof shape === 'function' ? shape() : shape,
    values: values,
    description: schema?.description || current?.description || '',
  };
}
function renderHostVariableEditor() {
  var parent = $('card-settings-modal')?.querySelector('.modal-body');
  if (!parent) return;
  var host = $('host-variable-editor');
  if (!host) {
    host = document.createElement('section');
    host.id = 'host-variable-editor';
    host.className = 'ui-section';
    parent.appendChild(host);
  }
  var live = null,
    context;
  try {
    context = hostWriteVariableContext(null);
  } catch (_) {}
  host.hidden = !context;
  if (host.hidden) {
    host.replaceChildren();
    return;
  }
  var selectedType = host.querySelector('[data-variable-scope]')?.value || 'chat',
    selectedMessage = host.querySelector('[data-variable-message]')?.value || 'latest',
    selectedScript = host.querySelector('[data-variable-script]')?.value || '';
  host.replaceChildren();
  var title = document.createElement('h3');
  title.className = 'ui-group-title';
  title.textContent = '脚本变量';
  host.appendChild(title);
  var scope = document.createElement('select');
  scope.dataset.variableScope = '';
  var scopeNames = {
    chat: '当前聊天',
    message: '消息',
    character: '角色',
    preset: '预设',
    global: '全局',
    script: '脚本库',
  };
  Object.entries(scopeNames).forEach(function (pair) {
    var item = document.createElement('option');
    item.value = pair[0];
    item.textContent = pair[1];
    scope.appendChild(item);
  });
  scope.value = selectedType;
  scope.setAttribute('aria-label', '变量范围');
  scope.onchange = renderHostVariableEditor;
  host.appendChild(scope);
  var option = { type: selectedType };
  if (selectedType === 'message') {
    var messageSelect = document.createElement('select');
    messageSelect.dataset.variableMessage = '';
    messageSelect.setAttribute('aria-label', '消息楼层');
    var latest = document.createElement('option');
    latest.value = 'latest';
    latest.textContent = '最新消息';
    messageSelect.appendChild(latest);
    context.session.msgs.forEach(function (message, index) {
      var row = document.createElement('option');
      row.value = index;
      row.textContent = '#' + index + ' ' + String(message.content || '').slice(0, 30);
      messageSelect.appendChild(row);
    });
    messageSelect.value = selectedMessage;
    messageSelect.onchange = renderHostVariableEditor;
    host.appendChild(messageSelect);
    option.message_id = selectedMessage === 'latest' ? 'latest' : Number(selectedMessage);
  } else if (selectedType === 'script') {
    var scripts = typeof cardFrontendAllScriptRows === 'function' ? cardFrontendAllScriptRows(context.char) : [],
      scriptSelect = document.createElement('select');
    scriptSelect.dataset.variableScript = '';
    scriptSelect.setAttribute('aria-label', '脚本');
    scripts.forEach(function (script) {
      var row = document.createElement('option');
      row.value = JSON.stringify([String(script.scope || ''), String(script.id || '')]);
      row.textContent =
        (scopeNames[script.scope] || script.scope) + ' · ' + String(script.name || script.id || '未命名脚本');
      scriptSelect.appendChild(row);
    });
    if (!scripts.length) {
      var noScripts = document.createElement('p');
      noScripts.textContent = '没有可编辑的脚本';
      host.appendChild(noScripts);
      return;
    }
    scriptSelect.value = scripts.some(function (script) {
      return JSON.stringify([String(script.scope || ''), String(script.id || '')]) === selectedScript;
    })
      ? selectedScript
      : scriptSelect.options[0].value;
    scriptSelect.onchange = renderHostVariableEditor;
    host.appendChild(scriptSelect);
    var scriptTarget = JSON.parse(scriptSelect.value);
    option.script_scope = scriptTarget[0];
    option.script_id = scriptTarget[1];
  }
  var value;
  try {
    value = hostWriteGetVariables(live, option);
  } catch (error) {
    var empty = document.createElement('p');
    empty.textContent = error.message;
    host.appendChild(empty);
    return;
  }
  var edits = [],
    form = document.createElement('form');
  form.className = 'host-variable-fields';
  function field(path, data, schema) {
    var info = hostVariableSchemaInfo(schema),
      shape = info.shape || {},
      isObject = info.kind === 'object' || (!info.kind && objectRecord(data));
    if (isObject && (Object.keys(shape).length || Object.keys(data || {}).length)) {
      Array.from(new Set(Object.keys(data || {}).concat(Object.keys(shape)))).forEach(function (key) {
        field(path.concat(key), data && data[key], shape[key]);
      });
      return;
    }
    var label = document.createElement('label');
    label.className = 'host-variable-field';
    label.textContent = path.join('.') || '变量内容';
    var control,
      kind = info.kind || typeof data,
      choices = info.values;
    if (choices && ['enum', 'nativeenum', 'literal'].includes(kind)) {
      control = document.createElement('select');
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '未设置';
      control.appendChild(blank);
      choices.forEach(function (choice) {
        var row = document.createElement('option');
        row.value = JSON.stringify(choice);
        row.textContent = String(choice);
        control.appendChild(row);
      });
      control.value = data === undefined ? '' : JSON.stringify(data);
    } else if (kind === 'boolean') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = data === true;
    } else if (kind === 'number') {
      control = document.createElement('input');
      control.type = 'number';
      control.step = 'any';
      control.value = data == null ? '' : String(data);
    } else {
      control = document.createElement('textarea');
      control.rows = kind === 'string' ? 2 : 4;
      control.value = data === undefined ? '' : kind === 'string' ? String(data) : JSON.stringify(data, null, 2);
    }
    control.dataset.variablePath = JSON.stringify(path);
    label.appendChild(control);
    if (info.description) {
      var help = document.createElement('small');
      help.textContent = info.description;
      label.appendChild(help);
    }
    var changed = false;
    control.addEventListener('input', function () {
      changed = true;
    });
    control.addEventListener('change', function () {
      changed = true;
    });
    edits.push(function (next) {
      if (!changed) return next;
      var updated =
        kind === 'boolean'
          ? control.checked
          : choices
            ? control.value === ''
              ? undefined
              : JSON.parse(control.value)
            : kind === 'number'
              ? control.value === ''
                ? undefined
                : Number(control.value)
              : kind === 'string'
                ? control.value
                : JSON.parse(control.value);
      if (!path.length) return updated;
      var cursor = next;
      path.slice(0, -1).forEach(function (key) {
        if (!objectRecord(cursor[key])) cursor[key] = {};
        cursor = cursor[key];
      });
      if (updated === undefined) delete cursor[path[path.length - 1]];
      else cursor[path[path.length - 1]] = updated;
      return next;
    });
    form.appendChild(label);
  }
  field([], value, hostVariableSchema(selectedType));
  var save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn sm';
  save.textContent = '保存变量';
  form.appendChild(save);
  var notice = document.createElement('p');
  notice.setAttribute('role', 'status');
  form.appendChild(notice);
  form.onsubmit = function (event) {
    event.preventDefault();
    try {
      var current = hostWriteVariableContext(null);
      if (current.char !== context.char || current.session !== context.session)
        throw new Error('当前角色或聊天已经切换，请重新打开变量编辑');
      if (selectedType === 'script' && !hostWriteFindScript(current.char, option.script_id, option.script_scope))
        throw new Error('所选脚本已不存在，请重新选择');
      var next = hostWriteGetVariables(live, option);
      edits.forEach(function (apply) {
        next = apply(next);
      });
      if (!objectRecord(next)) throw new Error('变量内容需要是 JSON 对象');
      hostWriteReplaceVariables(live, next, option);
      notice.textContent = '已更新';
    } catch (error) {
      notice.textContent = error.message;
    }
  };
  host.appendChild(form);
}
