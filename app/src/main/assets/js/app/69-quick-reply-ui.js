// ===== Quick Reply bar and settings manager =====
function renderStscriptRunStatus() {
  var bar = $('stscript-run-status'),
    label = $('stscript-run-label');
  if (!bar) return;
  if (_qrRun) {
    bar.hidden = false;
    if (label) label.textContent = '正在运行 ' + (_qrRun.set ? _qrRun.set + ' / ' : '') + (_qrRun.label || '脚本');
  } else bar.hidden = true;
  var btn = $('composer-action-btn');
  if (btn && typeof _generationState !== 'undefined' && _generationState === 'idle') {
    btn.classList.remove('has-label');
    if (_qrRun) {
      btn.classList.add('stop-mode', 'danger');
      btn.classList.remove('primary');
      btn.innerHTML = typeof uiIcon === 'function' ? uiIcon('stop') : '停止';
      btn.setAttribute('aria-label', '停止当前脚本');
    } else {
      btn.classList.remove('stop-mode', 'danger');
      btn.classList.add('primary');
      btn.innerHTML = typeof uiIcon === 'function' ? uiIcon('arrow-up') : '发送';
      btn.setAttribute('aria-label', '发送消息');
    }
  }
  if (typeof syncComposerMetrics === 'function') requestAnimationFrame(syncComposerMetrics);
}
function qrChipHtml(row) {
  var item = row.item,
    iconOnly = !!item.icon && item.showLabel !== true;
  var icon = iconOnly ? '<span class="quick-reply-chip-icon" aria-hidden="true"></span>' : '';
  var text = iconOnly ? '' : esc(item.label || '');
  var title = item.title || item.label || '快捷脚本';
  var style = typeof qrChipStyle === 'function' ? qrChipStyle(row.set) : '';
  var cls = 'quick-reply-chip' + (iconOnly ? ' is-icon-only' : '');
  return (
    '<button type="button" class="' +
    cls +
    '" style="' +
    escAttr(style) +
    '" title="' +
    escAttr(title) +
    '" aria-label="' +
    escAttr(title) +
    '" onclick="runQuickReplyButton(' +
    jsArg(row.set.name) +
    ',' +
    jsArg(String(item.id)) +
    ')">' +
    (icon + text || esc(title)) +
    '</button>'
  );
}
function renderQuickReplyBar() {
  var bar = $('quick-reply-bar');
  if (!bar) return;
  var buttons = typeof qrVisibleButtons === 'function' ? qrVisibleButtons() : [];
  if (!buttons.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    if (typeof syncComposerMetrics === 'function') requestAnimationFrame(syncComposerMetrics);
    return;
  }
  bar.hidden = false;
  bar.innerHTML = buttons.map(qrChipHtml).join('');
  if (typeof syncComposerMetrics === 'function') requestAnimationFrame(syncComposerMetrics);
}
async function runQuickReplyButton(setName, id) {
  try {
    var set = qrFindSet(setName),
      item = qrEntryById(set, id);
    if (!set || !item) throw new Error('找不到快捷栏脚本');
    await qrExecuteWithOptions(set, item, {});
  } catch (error) {
    if (typeof toast === 'function') toast(stscriptFormatError(error), 'err');
  }
}
function stscriptPromptButtons(labels, controller) {
  return new Promise(function (resolve) {
    var modal = $('stscript-choice-modal'),
      list = $('stscript-choice-list'),
      title = $('stscript-choice-title');
    if (!modal || !list) {
      resolve(labels[0] || '');
      return;
    }
    if (title) title.textContent = '请选择';
    list.innerHTML = labels
      .map(function (label, index) {
        return '<button type="button" class="prompt-choice" data-choice="' + index + '">' + esc(label) + '</button>';
      })
      .join('');
    function finish(value) {
      if (controller && controller.offAbort) controller.offAbort(onAbort);
      closeModal('stscript-choice-modal');
      resolve(value);
    }
    function onAbort() {
      finish('');
    }
    if (controller && controller.onAbort) controller.onAbort(onAbort);
    list.onclick = function (event) {
      var btn = event.target && event.target.closest('[data-choice]');
      if (!btn) return;
      finish(labels[Number(btn.getAttribute('data-choice'))] || '');
    };
    var cancel = $('stscript-choice-cancel');
    if (cancel)
      cancel.onclick = function () {
        finish('');
      };
    openModal('stscript-choice-modal');
  });
}
function qrManagerSelectedName() {
  var root = $('qr-manager');
  return root ? String(root.getAttribute('data-set') || '') : '';
}
function qrCheck(id, on) {
  return '<input type="checkbox" id="' + id + '" ' + (on ? 'checked' : '') + '>';
}
// Collapsed origin groups are kept on the manager root, next to the selected set and open editor.
function qrCollapsedSetGroups(root) {
  return String((root && root.getAttribute('data-collapsed')) || '')
    .split(' ')
    .filter(Boolean);
}
function toggleQuickReplySetGroup(origin, open) {
  var root = $('qr-manager');
  if (!root) return;
  var collapsed = qrCollapsedSetGroups(root).filter(function (name) {
    return name !== origin;
  });
  if (!open) collapsed.push(origin);
  root.setAttribute('data-collapsed', collapsed.join(' '));
}
function qrSetRowHtml(set, selected) {
  var origin = qrSetOrigin(set),
    details = [set.qrList.length + ' 个条目'];
  if (origin === 'file') details.unshift('来自 ' + (set.yeyuSource.fileName || '文件'));
  return (
    '<button type="button" class="qr-set-row' +
    (set.name === selected ? ' is-selected" aria-current="true' : '') +
    '" onclick="qrManagerSelect(' +
    jsArg(set.name) +
    ')"><span class="qr-set-copy"><strong>' +
    esc(set.name) +
    '</strong><small>' +
    esc(details.join(' · ')) +
    '</small></span></button>'
  );
}
// Sets are grouped by origin; each group keeps the library order. Empty groups are omitted.
function qrSetGroupsHtml(sets, selected, collapsed) {
  return [
    { origin: 'created', title: '自建' },
    { origin: 'file', title: '文件导入' },
    { origin: 'unrecorded', title: '导入（来源未记录）' },
  ]
    .map(function (group) {
      var rows = sets.filter(function (set) {
        return qrSetOrigin(set) === group.origin;
      });
      if (!rows.length) return '';
      return (
        '<details class="ui-fold" data-qr-set-group="' +
        group.origin +
        '"' +
        (collapsed.indexOf(group.origin) >= 0 ? '' : ' open') +
        ' ontoggle="toggleQuickReplySetGroup(' +
        jsArg(group.origin) +
        ',this.open)"><summary><span class="ui-fold-title">' +
        group.title +
        '</span><small class="ui-meta">' +
        rows.length +
        ' 个</small></summary><div class="ui-group">' +
        rows
          .map(function (set) {
            return qrSetRowHtml(set, selected);
          })
          .join('') +
        '</div></details>'
      );
    })
    .join('');
}
function renderQuickReplyManager() {
  var root = $('qr-manager');
  if (!root) return;
  var state = qrState(),
    bound = qrBoundSets(),
    selected = root.getAttribute('data-set') || (state.sets[0] && state.sets[0].name) || '';
  var editing = root.getAttribute('data-edit') || '';
  if (selected && !qrFindSet(selected)) selected = (state.sets[0] && state.sets[0].name) || '';
  root.setAttribute('data-set', selected);
  var set = qrFindSet(selected);
  var bindGlobal = state.globalSetNames.indexOf(selected) >= 0,
    bindChat = (qrChatConfig().setNames || []).indexOf(selected) >= 0,
    bindChar = qrCharLinks().indexOf(selected) >= 0,
    char = stscriptChar(),
    canBindChar = !!char;
  var entryRows = set
    ? set.qrList
        .map(function (item) {
          var args = jsArg(set.name) + ',' + jsArg(String(item.id));
          return (
            '<div class="qr-entry-row' +
            (item.isHidden ? ' is-hidden' : '') +
            (String(item.id) === editing ? ' is-editing' : '') +
            '" data-qr-entry="' +
            escAttr(String(item.id)) +
            '"><div class="qr-entry-copy"><strong>' +
            esc(item.label || '(无名称)') +
            '</strong><small>' +
            (item.automationId
              ? '自动化 ID ' + esc(item.automationId)
              : item.icon && !item.showLabel
                ? '只显示图标'
                : '手动') +
            (item.isHidden ? ' · 横栏隐藏' : '') +
            '</small></div><div class="ui-actions"><button type="button" class="btn text sm accent" onclick="qrManagerRun(' +
            args +
            ')">试运行</button><button type="button" class="btn text sm accent" onclick="qrManagerEdit(' +
            args +
            ')">编辑</button><button type="button" class="btn text sm danger" onclick="qrManagerDeleteEntry(' +
            args +
            ')">删除</button></div></div>'
          );
        })
        .join('') ||
      '<div class="ui-empty"><strong>这个集合还没有条目</strong><p>点「新建条目」添加一个按钮或脚本。</p></div>'
    : '';
  var check = function (id, on, text, handler, disabled) {
    return (
      '<label class="check-row" for="' +
      id +
      '"><input type="checkbox" id="' +
      id +
      '" ' +
      (on ? 'checked' : '') +
      (disabled ? ' disabled' : '') +
      ' onchange="' +
      handler +
      '"><span class="check-row-copy"><strong>' +
      text +
      '</strong></span></label>'
    );
  };
  root.innerHTML =
    '<section class="ui-section"><h3 class="ui-group-title">运行</h3>' +
    '<div class="fg switch-field"><label class="switch-row" for="qr-enabled"><span class="switch-copy"><strong>启用自动事件</strong><small>关闭后仍可手动点按，或在输入框用 / 命令运行。</small></span><input type="checkbox" id="qr-enabled" ' +
    (state.enabled !== false ? 'checked' : '') +
    ' onchange="qrManagerToggleEnabled(this.checked)"><span class="switch-control" aria-hidden="true"></span></label></div>' +
    '<div class="button-row"><button type="button" class="btn sm danger" onclick="stopStscriptRun()">停止脚本</button><span class="hint">中止正在运行的快捷栏脚本。</span></div></section>' +
    '<section class="ui-section"><div class="ui-group-hd"><h3 class="ui-group-title">集合</h3><div class="ui-actions"><button type="button" class="btn text sm accent" onclick="qrManagerImport()">导入</button><button type="button" class="btn text sm accent" onclick="qrManagerCreate()">新建</button></div></div>' +
    (state.sets.length
      ? '<div class="qr-set-groups">' +
        qrSetGroupsHtml(state.sets, selected, qrCollapsedSetGroups(root)) +
        '</div><p class="hint">导入后只进库，勾选生效范围后才会自动运行。</p></section>'
      : '<div class="ui-group"><div class="ui-empty"><strong>还没有快捷栏集合</strong><p>导入 SillyTavern 快速回复集合（JSON），或新建一个。</p></div></div></section>') +
    (set
      ? '<section class="ui-section"><div class="ui-group-hd"><h3 class="ui-group-title qr-current-set">' +
        esc(set.name) +
        '</h3><div class="ui-actions"><button type="button" class="btn text sm accent" onclick="qrManagerRename()">重命名</button><button type="button" class="btn text sm danger" onclick="qrManagerDeleteSet()">删除</button></div></div>' +
        '<fieldset class="fg"><legend>生效范围</legend><div class="check-inline qr-bind-row">' +
        check('qr-bind-global', bindGlobal, '全局', "qrManagerBind('global',this.checked)") +
        check('qr-bind-chat', bindChat, '当前对话', "qrManagerBind('chat',this.checked)") +
        check('qr-bind-char', bindChar, '当前角色', "qrManagerBind('character',this.checked)", !canBindChar) +
        '</div></fieldset>' +
        '<fieldset class="fg"><legend>点按按钮时</legend><div class="ui-group qr-set-flags">' +
        check('qr-set-nosend', set.disableSend, '只写入输入框，不发送', 'qrManagerSaveSet()') +
        check('qr-set-inject', set.injectInput, '带上输入框里已有的内容', 'qrManagerSaveSet()') +
        check('qr-set-before', set.placeBeforeInput, '脚本放在已有内容前面', 'qrManagerSaveSet()') +
        check('qr-set-border', set.onlyBorderColor, '按钮颜色只用于边框', 'qrManagerSaveSet()') +
        '</div></fieldset>' +
        '<div class="fg"><label for="qr-set-color">按钮颜色</label><input id="qr-set-color" type="text" spellcheck="false" value="' +
        escAttr(set.color || '') +
        '" onchange="qrManagerSaveSet()"><div class="hint">例如 rgba(80,40,120,0.9)。留空或透明时使用默认样式。</div></div></section>' +
        '<section class="ui-section"><div class="ui-group-hd"><h3 class="ui-group-title">条目 <small class="ui-meta">' +
        set.qrList.length +
        ' 个</small></h3><button type="button" class="btn sm" onclick="qrManagerAddEntry()">新建条目</button></div>' +
        '<div class="ui-group qr-entry-list">' +
        entryRows +
        '</div>' +
        '<div id="qr-entry-editor" class="qr-entry-editor"' +
        (editing ? '' : ' hidden') +
        '></div></section>'
      : '');
  if (set && editing) qrManagerEdit(set.name, editing, true);
}
function qrManagerSelect(name) {
  var root = $('qr-manager');
  if (root) {
    root.setAttribute('data-set', name);
    root.removeAttribute('data-edit');
  }
  renderQuickReplyManager();
}
async function qrManagerToggleEnabled(on) {
  try {
    await qrCommit(['meta'], function () {
      qrState().enabled = !!on;
    });
  } catch (error) {
    toast('快捷栏开关保存失败：' + error.message, 'err');
    renderQuickReplyManager();
  }
}
async function qrManagerBind(scope, on) {
  var name = qrManagerSelectedName();
  if (!name) return;
  try {
    await qrBind(scope, name, !!on);
  } catch (error) {
    toast('快捷栏绑定保存失败：' + error.message, 'err');
    renderQuickReplyManager();
  }
}
async function qrManagerCreate() {
  var name = await appInput('集合名称', '', '新建快捷栏集合', '名称', { okText: '新建集合' });
  if (name == null || !String(name).trim()) return;
  try {
    await qrUpsertSet(qrNormalizeSet({ name: String(name).trim(), yeyuSource: qrCreatedSource() }), false);
    qrManagerSelect(String(name).trim());
  } catch (error) {
    toast('新建集合失败：' + error.message, 'err');
  }
}
async function qrManagerRename() {
  var name = qrManagerSelectedName();
  if (!name) {
    toast('请先选择集合', 'info');
    return;
  }
  var next = await appInput('新的集合名称', name, '重命名集合', '名称', { okText: '保存名称' });
  if (next == null || !String(next).trim() || String(next).trim() === name) return;
  try {
    await qrRenameSet(name, String(next).trim());
    qrManagerSelect(String(next).trim());
    toast('集合已改名', 'ok');
  } catch (error) {
    toast('集合改名失败：' + error.message, 'err');
  }
}
async function qrManagerDeleteSet() {
  var name = qrManagerSelectedName();
  if (!name) {
    toast('请先选择集合', 'info');
    return;
  }
  if (
    typeof appConfirm === 'function' &&
    !(await appConfirm('删除集合「' + name + '」？绑定也会一并清掉。', '删除集合', '删除'))
  )
    return;
  try {
    await qrDeleteSet(name);
    var root = $('qr-manager');
    if (root) root.removeAttribute('data-edit');
    renderQuickReplyManager();
    toast('集合已删除', 'ok');
  } catch (error) {
    toast('删除集合失败：' + error.message, 'err');
  }
}
async function qrManagerSaveSet() {
  var name = qrManagerSelectedName(),
    set = qrFindSet(name);
  if (!set) return;
  try {
    await qrCommit(['meta'], function () {
      set.disableSend = !!$('qr-set-nosend') && $('qr-set-nosend').checked;
      set.injectInput = !!$('qr-set-inject') && $('qr-set-inject').checked;
      set.placeBeforeInput = !!$('qr-set-before') && $('qr-set-before').checked;
      set.onlyBorderColor = !!$('qr-set-border') && $('qr-set-border').checked;
      set.color = String(($('qr-set-color') && $('qr-set-color').value) || 'rgba(0, 0, 0, 0)');
    });
  } catch (error) {
    toast('集合设置保存失败：' + error.message, 'err');
    renderQuickReplyManager();
  }
}
async function qrManagerImport() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async function () {
    var file = input.files && input.files[0];
    if (!file) return;
    try {
      var set = await qrImportJson(await file.text(), false, file.name);
      qrManagerSelect(set.name);
      toast('已导入 ' + set.name + '，默认不绑定自动执行', 'ok');
    } catch (error) {
      toast('导入失败：' + error.message, 'err');
    }
  };
  input.click();
}
async function qrManagerRun(setName, id) {
  try {
    var set = qrFindSet(setName),
      item = qrEntryById(set, id);
    if (!item) throw new Error('找不到条目');
    await qrExecuteEntry(set, item, {}, { isEditor: true });
    toast('已运行 ' + (item.label || id), 'ok');
  } catch (error) {
    toast(stscriptFormatError(error), 'err');
  }
}
async function qrManagerAddEntry() {
  var name = qrManagerSelectedName(),
    set = qrFindSet(name);
  if (!set) {
    toast('请先选择集合', 'info');
    return;
  }
  var label = await appInput('条目标签', '', '新建快捷栏条目', '标签', { okText: '新建条目' });
  if (label == null || !String(label).trim()) return;
  try {
    var item = null;
    await qrCommit(['meta'], function () {
      item = qrNormalizeEntry({ id: ++set.idIndex, label: String(label).trim(), showLabel: true });
      set.qrList.push(item);
    });
    qrManagerEdit(set.name, String(item.id));
  } catch (error) {
    toast('新建条目失败：' + error.message, 'err');
  }
}
async function qrManagerDeleteEntry(setName, id) {
  var set = qrFindSet(setName),
    item = qrEntryById(set, id);
  if (!item) return;
  if (
    typeof appConfirm === 'function' &&
    !(await appConfirm('删除条目「' + (item.label || id) + '」？', '删除条目', '删除'))
  )
    return;
  try {
    await qrCommit(['meta'], function () {
      set.qrList = set.qrList.filter(function (row) {
        return row !== item;
      });
    });
    var root = $('qr-manager');
    if (root) root.removeAttribute('data-edit');
    toast('条目已删除', 'ok');
  } catch (error) {
    toast('删除条目失败：' + error.message, 'err');
  }
}
function qrManagerEdit(setName, id, keep) {
  var set = qrFindSet(setName),
    item = qrEntryById(set, id),
    editor = $('qr-entry-editor'),
    root = $('qr-manager');
  if (!item || !editor) return;
  if (root) root.setAttribute('data-edit', String(item.id));
  editor.hidden = false;
  if (root)
    root.querySelectorAll('.qr-entry-row').forEach(function (row) {
      row.classList.toggle('is-editing', row.dataset.qrEntry === String(item.id));
    });
  editor.innerHTML =
    '<h4 class="ui-group-title">编辑条目：' +
    esc(item.label || '(无名称)') +
    '</h4>' +
    '<div class="fg"><label for="qr-edit-label">名称</label><input id="qr-edit-label" value="' +
    escAttr(item.label) +
    '"></div>' +
    '<div class="fg"><label for="qr-edit-message">脚本</label><textarea id="qr-edit-message" class="code-input" rows="8" spellcheck="false">' +
    esc(item.message) +
    '</textarea></div>' +
    '<div class="fg"><label for="qr-edit-title">提示文字</label><input id="qr-edit-title" value="' +
    escAttr(item.title) +
    '" placeholder="长按或悬停时显示"></div>' +
    '<div class="fg"><label for="qr-edit-automation">自动化 ID</label><input id="qr-edit-automation" spellcheck="false" value="' +
    escAttr(item.automationId) +
    '"><div class="hint">与世界书条目的自动化 ID 相同时，该条目真正注入后会运行这条脚本。</div></div>' +
    '<fieldset class="fg"><legend>显示</legend><div class="check-grid">' +
    '<label for="qr-edit-icon-only">' +
    qrCheck('qr-edit-icon-only', !!item.icon && item.showLabel !== true) +
    ' 只显示图标</label><label for="qr-edit-hidden">' +
    qrCheck('qr-edit-hidden', item.isHidden) +
    ' 从横栏隐藏</label></div></fieldset>' +
    '<fieldset class="fg"><legend>自动运行时机</legend><div class="check-grid">' +
    '<label for="qr-edit-auto-user">' +
    qrCheck('qr-edit-auto-user', item.executeOnUser) +
    ' 用户消息后</label><label for="qr-edit-auto-ai">' +
    qrCheck('qr-edit-auto-ai', item.executeOnAi) +
    ' AI 消息后</label><label for="qr-edit-auto-before">' +
    qrCheck('qr-edit-auto-before', item.executeBeforeGeneration) +
    ' 生成前</label><label for="qr-edit-auto-chat">' +
    qrCheck('qr-edit-auto-chat', item.executeOnChatChange) +
    ' 切换对话</label><label for="qr-edit-auto-new">' +
    qrCheck('qr-edit-auto-new', item.executeOnNewChat) +
    ' 新建对话</label><label for="qr-edit-auto-start">' +
    qrCheck('qr-edit-auto-start', item.executeOnStartup) +
    ' 启动时</label><label for="qr-edit-prevent">' +
    qrCheck('qr-edit-prevent', item.preventAutoExecute) +
    ' 阻止嵌套自动执行</label></div></fieldset>' +
    '<div class="button-row"><button type="button" class="btn" onclick="qrManagerSaveEdit(' +
    jsArg(setName) +
    ',' +
    jsArg(String(item.id)) +
    ')">保存条目</button></div>';
}
async function qrManagerSaveEdit(setName, id) {
  var set = qrFindSet(setName),
    item = qrEntryById(set, id),
    root = $('qr-manager');
  if (!item) return;
  try {
    await qrCommit(['meta'], function () {
      item.label = String($('qr-edit-label').value || '').trim() || item.label;
      item.message = $('qr-edit-message').value;
      item.title = String($('qr-edit-title').value || '');
      var iconOnly = $('qr-edit-icon-only').checked;
      item.icon = iconOnly ? item.icon || 'generic' : '';
      item.automationId = String($('qr-edit-automation').value || '').trim();
      item.showLabel = !iconOnly;
      item.isHidden = $('qr-edit-hidden').checked;
      item.executeOnUser = $('qr-edit-auto-user').checked;
      item.executeOnAi = $('qr-edit-auto-ai').checked;
      item.executeBeforeGeneration = $('qr-edit-auto-before').checked;
      item.executeOnChatChange = $('qr-edit-auto-chat').checked;
      item.executeOnNewChat = $('qr-edit-auto-new').checked;
      item.executeOnStartup = $('qr-edit-auto-start').checked;
      item.preventAutoExecute = $('qr-edit-prevent').checked;
      if (root) root.setAttribute('data-edit', String(item.id));
    });
    toast('条目已保存', 'ok');
  } catch (error) {
    toast('条目保存失败：' + error.message, 'err');
  }
}
