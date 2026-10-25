// ===== Card script interface: runtime controls and status =====
function cardScriptRuntimeText(char) {
  var stack = typeof cardScriptStack === 'function' ? cardScriptStack(char) : null;
  if (!stack) return [];
  var rows = [];
  if (Array.isArray(stack.mvuSchemas) && stack.mvuSchemas.length)
    rows.push('会在隔离运行区校验和维护当前对话的 MVU 变量，并把变量值代入卡片提示');
  if (stack.frontends && stack.frontends.count > 0) {
    rows.push(
      '会在聊天里运行卡片自带的网页前端（' +
        stack.frontends.count +
        ' 段），并按酒馆助手模型直接访问夜欲页面、浏览器存储和页面中可见的数据'
    );
    rows.push('前端还能联网加载作者指定的图片、字体和脚本；请只导入你信任的卡片');
    var frontendRemoteCount = new Set([].concat(stack.frontends.remotes || [], stack.frontends.runtimeRemotes || []))
      .size;
    if (frontendRemoteCount)
      rows.push('这些前端与消息前端运行环境会访问 ' + frontendRemoteCount + ' 个外部地址，具体清单见「作品依赖」');
  }
  if (stack.libraries && stack.libraries.active.length) {
    rows.push(
      '会常驻运行卡片自带的脚本库（' +
        stack.libraries.active
          .map(function (row) {
            return row.name;
          })
          .join('、') +
        '），可读取和修改夜欲页面、对话、变量与世界书，也能调用生成或在发送前改写、取消本轮消息'
    );
    if (stack.libraries.remotes.length)
      rows.push('脚本库会访问 ' + stack.libraries.remotes.length + ' 个外部地址，具体清单见「作品依赖」');
  }
  return rows;
}
function renderCardDependencyStatus(char, report) {
  var host = $('card-dependency-status'),
    target = char || (typeof getChar === 'function' ? getChar() : null);
  if (!host) return;
  if (!target) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  report =
    report ||
    (typeof analyzeCardDependencies === 'function'
      ? analyzeCardDependencies(target)
      : { items: [], counts: { ready: 0, preserved: 0, missing: 0 }, mode: 'legacy' });
  var risu = report.ecosystem === 'risu' || (typeof isRisuCharacter === 'function' && isRisuCharacter(target));
  if (risu) {
    host.hidden = false;
    host.innerHTML =
      '<h3 class="ui-group-title">Risu 卡片能力</h3>' +
      '<p class="card-dependency-mode">选项和卡片操作位于聊天页的「演出选项」。</p>' +
      cardDependencyReportHtml(report, { context: 'settings' });
    return;
  }
  var mode = report.mode === 'basic' ? '仅基础内容' : report.mode === 'full' ? '完整保留' : '现有卡片',
    enabled = typeof cardScriptsEnabled === 'function' && cardScriptsEnabled(target);
  host.hidden = false;
  host.innerHTML =
    '<h3 class="ui-group-title">作品依赖</h3><p class="card-dependency-mode">导入方式：' +
    esc(mode) +
    ' · 支持的卡片脚本当前' +
    (enabled ? '开启' : '关闭') +
    '</p>' +
    cardDependencyReportHtml(report, { context: 'settings' });
}
// The card settings dialog is the only place this section is read. Every script start and finish
// asked for it, so a streaming reply rebuilt a closed dialog — and rescanned the card's whole script
// stack — hundreds of times. `force` is for filling the dialog just before it is marked open.
function cardSettingsSurfaceOpen() {
  var modal = typeof document !== 'undefined' ? document.getElementById('card-settings-modal') : null;
  return !!(modal && modal.classList.contains('open'));
}
function renderCardScriptStatus(char, force) {
  var host = $('card-script-status');
  if (!host || (force !== true && !cardSettingsSurfaceOpen())) return;
  var target = char || (typeof getChar === 'function' ? getChar() : null),
    stack = target && typeof cardScriptStack === 'function' ? cardScriptStack(target) : null;
  if (!target || (typeof isRisuCharacter === 'function' && isRisuCharacter(target)) || !stack || !stack.hasContent) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  var summary = cardScriptStatusSummary(target),
    running = summary.kind === 'running',
    library =
      typeof cardScriptLibraryStatus === 'function' ? cardScriptLibraryStatus(target) : { kind: 'none', label: '' };
  var runtimeRows = cardScriptRuntimeText(target),
    scriptsOn = cardScriptsEnabled(target),
    actions = [],
    stops = [];
  if (stack.libraries && stack.libraries.active.length)
    actions.push(
      '<button type="button" class="btn sm" onclick="openCurrentCardScriptLibrary()"' +
        (scriptsOn ? '' : ' disabled') +
        '>打开脚本库面板</button>'
    );
  if (library.kind === 'stopped')
    actions.push('<button type="button" class="btn sm" onclick="resumeCurrentCardScriptLibrary()">重新开启脚本库</button>');
  if (stack.frontends && stack.frontends.count > 0)
    actions.push('<button type="button" class="btn sm" onclick="stopCurrentCardFrontends()">停止全部卡片前端</button>');
  if (running)
    stops.push('<button type="button" class="btn sm danger" onclick="stopCurrentCardScripts()">停止当前脚本</button>');
  if (['loading', 'ready', 'failed'].includes(library.kind))
    stops.push('<button type="button" class="btn sm danger" onclick="stopCurrentCardScriptLibrary()">停止脚本库</button>');
  host.hidden = false;
  host.innerHTML =
    '<h3 class="ui-group-title">脚本运行</h3>' +
    '<p class="card-script-state" data-state="' +
    escAttr(summary.kind) +
    '">状态：' +
    esc(summary.label) +
    '</p>' +
    (library.kind !== 'none'
      ? '<p class="card-script-state" data-state="' + escAttr(library.kind) + '">脚本库：' + esc(library.label) + '</p>'
      : '') +
    '<div class="ui-group">' +
    cardSettingsSwitchHtml('card-script-enabled', '启用这张卡片的脚本', scriptsOn, 'toggleCardScripts(this.checked)') +
    cardSettingsSwitchHtml('card-regex-enabled', '启用这张卡片的正则', cardRegexesEnabled(target), 'toggleCardRegexes(this.checked)') +
    (runtimeRows.length
      ? '<details class="card-runtime-info"><summary>运行内容</summary><ul class="card-script-runtime-details">' +
        runtimeRows
          .map(function (row) {
            return '<li>' + esc(row) + '</li>';
          })
          .join('') +
        '</ul></details>'
      : '') +
    '</div>' +
    (library.error ? '<p class="card-script-error">脚本库错误：' + esc(library.error) + '</p>' : '') +
    (library.failures || [])
      .map(function (row) {
        return '<p class="card-script-error">脚本「' + esc(row.name) + '」失败：' + esc(row.message) + '</p>';
      })
      .join('') +
    (summary.error ? '<p class="card-script-error">最近一次错误：' + esc(summary.error) + '</p>' : '') +
    (actions.length || stops.length
      ? '<div class="card-settings-actions">' + actions.join('') + stops.join('') + '</div>'
      : '');
}
function cardSettingsSwitchHtml(id, label, checked, handler) {
  return (
    '<label class="switch-row" for="' +
    id +
    '"><span class="switch-copy"><strong>' +
    esc(label) +
    '</strong></span><input type="checkbox" id="' +
    id +
    '"' +
    (checked ? ' checked' : '') +
    ' onchange="' +
    handler +
    '"><span class="switch-control" aria-hidden="true"></span></label>'
  );
}
function renderMvuRuntimeStatus(char, session) {
  var host = $('mvu-runtime-status'),
    target = char || (typeof getChar === 'function' ? getChar() : null),
    activeSession = session || (target && typeof getActiveSession === 'function' ? getActiveSession(target.id) : null);
  if (!host) return;
  if (
    !target ||
    (typeof isRisuCharacter === 'function' && isRisuCharacter(target)) ||
    typeof mvuHasSchema !== 'function' ||
    !mvuHasSchema(target)
  ) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  var status =
      typeof mvuRuntimeStatus === 'function'
        ? mvuRuntimeStatus(target, activeSession)
        : { kind: 'idle', label: '尚未构建变量状态' },
    state = status && status.state && typeof status.state === 'object' ? status.state : {},
    vendor = self.YeyuMvuVendor,
    stateText =
      vendor && typeof vendor.stringifyYaml === 'function'
        ? vendor
            .stringifyYaml(typeof mvuHiddenClone === 'function' ? mvuHiddenClone(state) : state, {
              indent: 2,
              lineWidth: 0,
            })
            .trim()
        : JSON.stringify(state, null, 2),
    running = status.kind === 'running',
    local = status.kind !== 'external';
  host.hidden = false;
  host.innerHTML =
    '<h3 class="ui-group-title">MVU 变量</h3><p class="mvu-runtime-state" data-state="' +
    escAttr(status.kind || 'idle') +
    '">状态：' +
    esc(status.label || '尚未构建') +
    '</p>' +
    (status.error ? '<p class="card-script-error">' + esc(status.error) + '</p>' : '') +
    '<details class="mvu-variable-details"' +
    (status.kind === 'failed' ? ' open' : '') +
    '><summary>查看当前变量</summary><pre>' +
    esc(stateText || '{}') +
    '</pre></details>' +
    (local
      ? '<div class="mvu-runtime-actions card-settings-actions"><button type="button" class="btn sm" onclick="rebuildCurrentMvuSession()"' +
        (running || !cardScriptsEnabled(target) ? ' disabled' : '') +
        '>重新构建</button><button type="button" class="btn sm danger" onclick="stopCurrentMvuRuntime()"' +
        (['disabled', 'idle', 'stopped'].includes(status.kind) ? ' disabled' : '') +
        '>停止 MVU</button></div>'
      : '');
}
function stopCurrentMvuRuntime() {
  var char = typeof getChar === 'function' ? getChar() : null;
  if (!char) return;
  var session = typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    stopped = typeof stopMvuRuntime === 'function' && stopMvuRuntime(char, session);
  if (stopped) toast('已停止 MVU 运行区', 'ok');
  renderMvuRuntimeStatus(char);
  renderCardScriptStatus(char);
}
function renderRegexScriptRuntimeStatus(char) {
  var host = $('regex-script-runtime-status'),
    target = char || (typeof getChar === 'function' ? getChar() : null);
  if (!host) return;
  var state = target && typeof cardScriptRuntimeState === 'function' ? cardScriptRuntimeState(target) : null;
  if (!target || !state || state.running <= 0) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.hidden = false;
  host.innerHTML =
    '<div class="regex-script-runtime-copy"><strong>正则脚本运行中</strong><small>' +
    esc(state.label || '正在处理消息') +
    '</small></div><button type="button" class="btn sm danger" onclick="stopCurrentCardScripts()">停止脚本</button>';
}
async function toggleCardScripts(enabled) {
  var char = typeof getChar === 'function' ? getChar() : null;
  if (!char || (typeof isRisuCharacter === 'function' && isRisuCharacter(char))) return;
  var beforeEnabled = char.scriptsEnabled;
  setCardScriptsEnabled(char, enabled === true);
  try {
    await saveData('characters', { urgent: true });
  } catch (error) {
    if (beforeEnabled === undefined) delete char.scriptsEnabled;
    else char.scriptsEnabled = beforeEnabled;
    invalidateCardScriptStack(char);
    toast('脚本开关保存失败，已恢复原状态：' + String((error && error.message) || error), 'err');
    renderCardScriptStatus(char);
    renderCardDependencyStatus(char);
    return;
  }
  if (enabled !== true && typeof stopCardScripts === 'function') stopCardScripts(char);
  if (enabled === true && typeof resumeCardScriptLibrary === 'function') resumeCardScriptLibrary(char);
  if (typeof invalidateCardScriptDisplayCache === 'function') invalidateCardScriptDisplayCache(char);
  renderCardScriptStatus(char);
  renderCardDependencyStatus(char);
  renderMvuRuntimeStatus(char);
  if (typeof renderChat === 'function') renderChat();
}
async function toggleCardRegexes(enabled) {
  var char = getChar();
  if (!char || (typeof isRisuCharacter === 'function' && isRisuCharacter(char))) return;
  var before = char.regexEnabled;
  char.regexEnabled = enabled === true;
  try {
    await saveData('characters', { urgent: true });
  } catch (error) {
    if (before === undefined) delete char.regexEnabled;
    else char.regexEnabled = before;
    toast('正则开关保存失败：' + error.message, 'err');
  }
  invalidateCardScriptStack(char);
  if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts();
  if (typeof invalidateCardScriptDisplayCache === 'function') invalidateCardScriptDisplayCache(char);
  renderCardScriptStatus(char);
  renderCardDependencyStatus(char);
  renderChat();
}
function resumeCurrentCardScriptLibrary() {
  var char = typeof getChar === 'function' ? getChar() : null;
  if (!char) return;
  if (typeof resumeCardScriptLibrary === 'function' && resumeCardScriptLibrary(char)) toast('脚本库已重新开启', 'ok');
  renderCardScriptStatus(char);
}
function stopCurrentCardScriptLibrary() {
  var char = typeof getChar === 'function' ? getChar() : null;
  if (!char) return;
  if (typeof stopCardScriptLibrary === 'function' && stopCardScriptLibrary(char)) toast('脚本库已停止', 'ok');
  renderCardScriptStatus(char);
}
function stopCurrentCardFrontends() {
  var char = typeof getChar === 'function' ? getChar() : null;
  if (!char || typeof stopAllCardFrontends !== 'function') return;
  var stopped = stopAllCardFrontends(char);
  toast(stopped ? '已停止 ' + stopped + ' 段卡片前端' : '当前没有正在运行的卡片前端', stopped ? 'ok' : 'info');
}
function stopCurrentCardScripts() {
  var char = typeof getChar === 'function' ? getChar() : null;
  if (!char) return;
  if (typeof stopAllCardFrontends === 'function') stopAllCardFrontends(char);
  if (stopCardScripts(char)) toast('已停止这张卡片的脚本', 'ok');
  renderCardScriptStatus(char);
  renderRegexScriptRuntimeStatus(char);
}
