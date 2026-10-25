// ===== Prompt Manager: this round's composition and preview =====
// The 「顺序」 tab lists the order this round's prompt is assembled in and previews the messages the next generation
// would send if the manager's draft were saved. While the preview is expanded it follows every draft change.
function promptLayerListRows(built) {
  if (built && Array.isArray(built.presetLayers) && built.presetLayers.length)
    return built.presetLayers.map(function (layer, index) {
      return {
        index: index,
        order: index,
        label: ['spark', layer.name + (layer.count > 1 ? '（' + layer.count + ' 条）' : '')],
      };
    });
  const labels = {
    'fixed-system': ['spark', '当前预设的主提示词'],
    'persona': ['user', '当前用户人格'],
    'worldbook-before-char': ['book', '世界书（角色设定之前）'],
    'character-card': ['user', '角色设定'],
    'worldbook-after-char': ['book', '世界书（角色设定之后）'],
    'examples': ['chat', '角色卡对话示例'],
    'memory': ['brain', '长期记忆'],
    'depth-prompt': ['spark', '角色卡指定位置提示'],
    'post-history': ['spark', '角色卡结尾提示与发送后指令'],
  };
  if (!built || !Array.isArray(built.pipelineStages) || !Array.isArray(built.messages)) return [];
  var rows = [],
    stages = built.pipelineStages,
    messages = built.messages;
  stages.forEach(function (stage, index) {
    var next = stages[index + 1],
      label = labels[stage && stage.id];
    if (!label || !next || Number(stage.messageIndex) >= Number(next.messageIndex)) return;
    rows.push({ index: Number(stage.messageIndex) || 0, order: index, label: label });
  });
  return rows.sort(function (left, right) {
    return left.index - right.index || left.order - right.order;
  });
}
async function renderPromptLayerList(built) {
  const box = $('prompt-layer-list');
  if (!box) return;
  if (!built) {
    var char = getChar();
    if (char) {
      try {
        var owner = getActiveSession(char.id);
        built = getBuiltMessages(char, getMsgs(char.id));
        if (built && typeof built.then === 'function') built = await built;
        if (getChar() !== char || getActiveSession(char.id) !== owner) return;
      } catch (error) {
        built = null;
      }
    }
  }
  const layers = promptLayerListRows(built);
  const content = layers.length
    ? '<ol class="prompt-order-list">' +
      layers
        .map(function (layer) {
          return '<li>' + layer.label[1] + '</li>';
        })
        .join('') +
      '</ol>'
    : '<p class="hint">开始对话后，这里按当前角色、世界书和聊天内容列出本轮的组合顺序。</p>';
  box.innerHTML = '<details class="prompt-order-details"><summary>内容组合顺序</summary>' + content + '</details>';
}
function presetRoundPreviewContent(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : [])
    .map(function (part) {
      if (part && typeof part.text === 'string') return part.text;
      return JSON.stringify(part);
    })
    .join('');
}
var _presetRoundPreviewExpanded = false,
  // Set by a draft change; a build that finishes after a newer change is dropped and the loop builds again.
  _presetRoundPreviewDirty = false,
  _presetRoundPreviewRun = null,
  _presetRoundPreviewController = null,
  // Callers waiting for the newest draft to be shown, told false when the preview is collapsed or hidden first.
  _presetRoundPreviewWaiters = [];
// Only an expanded preview on the visible preset page builds; leaving the page cancels the build.
function presetRoundPreviewVisible() {
  return _presetRoundPreviewExpanded && currentAppPage() === 'presets';
}
function settlePresetRoundPreviewWaiters(shown) {
  var waiters = _presetRoundPreviewWaiters;
  _presetRoundPreviewWaiters = [];
  waiters.forEach(function (resolve) {
    resolve(shown);
  });
}
// Resolves true once the newest draft is shown, which during a generation that dispatches card events is the
// catch-up after it; false when the preview is collapsed or the page left before that.
function presetRoundPreviewShown() {
  if (!presetRoundPreviewVisible()) return Promise.resolve(false);
  if (!_presetRoundPreviewDirty && !_presetRoundPreviewRun) return Promise.resolve(true);
  return new Promise(function (resolve) {
    _presetRoundPreviewWaiters.push(resolve);
  });
}
// The settings saving the manager would store, or null when no draft is loaded and the saved settings apply.
function presetRoundPreviewDraftSettings() {
  var settings = presetSettingsStore(cloneData(D.settings));
  return Array.isArray(_completionPresetDraftRows) ? applyPromptManagerForm(settings) : settings;
}
// A cancelled build leaves its draft unshown, so the preview builds again once it may (never shown as a failure).
function cancelPresetRoundPreviewBuild() {
  if (!_presetRoundPreviewController) return;
  _presetRoundPreviewDirty = true;
  _presetRoundPreviewController.abort();
}
// The preview is cancelled by a new draft, by collapsing, by leaving the preset page and by a generation that dispatches card events (62
// cardEventGenerationActive); it is not a request the stop button owns.
async function buildPresetRoundPreview() {
  var controller = new AbortController();
  _presetRoundPreviewController = controller;
  try { return await buildPresetRoundPreviewForController(controller); }
  finally {
    if (_presetRoundPreviewController === controller) _presetRoundPreviewController = null;
  }
}
async function buildPresetRoundPreviewForController(controller) {
  var char = getChar();
  if (!char) return null;
  var settings = presetRoundPreviewDraftSettings() || cloneData(D.settings),
    sess = typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  var target = { charId: char.id, sessionId: sess.id, mode: 'new', messageIndex: sess.msgs.length },
    raw = activeCompletionPresetRaw(settings),
    result = await assembleGenerationPrompt(char, sess, getMsgs(char.id), target, {
      preview: true,
      signal: controller.signal,
      interactive: true,
      promptSettings: settings || undefined,
      completionPresetRaw: raw,
    }),
    route = resolveApiRoute('chat', { settings: cloneData(settings) }),
    requestSettings = Object.assign({}, settings || D.settings, {
      _completionPresetActive: !!raw,
      _completionPresetRaw: raw,
    }),
    wire = completionWirePreview(result.messages, target, route, requestSettings, { route: 'chat' }),
    total = wire.reduce(function (sum, message) {
      return sum + estTokens(presetRoundPreviewContent(message.content)) + 4;
    }, 0),
    notes = result.previewNotes || [];
  if (controller.signal.aborted || getChar() !== char || getActiveSession(char.id) !== sess) return null;
  return {
    built: result.built,
    stats:
      '本轮预计总量约 ' +
      total +
      ' Token；按服务商转换后的角色和内容显示。' +
      (notes.length ? '\n预览限制：' + notes.join('\n') : ''),
    messages: wire,
    text: wire
      .map(function (message, index) {
        return (
          '【' +
          (index + 1) +
          ' · ' +
          message.role +
          (message.name ? ' · ' + message.name : '') +
          '】\n' +
          presetRoundPreviewContent(message.content)
        );
      })
      .join('\n\n'),
  };
}
function renderPresetRoundPreview(result) {
  var stats = $('prompt-stats-box'),
    box = $('prompt-preview-box');
  if (stats) stats.textContent = result.stats;
  if (box) box.textContent = result.text;
}
function renderPresetRoundPreviewToggle() {
  var region = $('prompt-preview'),
    toggle = $('prompt-preview-toggle');
  if (region) region.hidden = !_presetRoundPreviewExpanded;
  if (toggle) {
    toggle.textContent = _presetRoundPreviewExpanded ? '收起预览' : '预览本轮内容';
    toggle.setAttribute('aria-expanded', _presetRoundPreviewExpanded ? 'true' : 'false');
  }
}
function renderPresetRoundPreviewWaiting() {
  renderPresetRoundPreview({ stats: '正在生成，结束后自动更新预览…', text: '' });
}
// Builds until no draft change arrived during the last build, so only the newest result is shown. A generation that
// dispatches card events stops the loop; resumePresetRoundPreview restarts it when the last one settles.
async function runPresetRoundPreview() {
  try {
    while (_presetRoundPreviewDirty && presetRoundPreviewVisible()) {
      _presetRoundPreviewDirty = false;
      var result;
      try {
        result = await buildPresetRoundPreview();
      } catch (error) {
        result = { built: null, stats: '预览生成失败：' + ((error && error.message) || error), text: '' };
      }
      if (presetRoundPreviewVisible() && cardEventGenerationActive()) {
        _presetRoundPreviewDirty = true;
        renderPresetRoundPreviewWaiting();
        break;
      }
      if (_presetRoundPreviewDirty || !presetRoundPreviewVisible() || !result) continue;
      renderPresetRoundPreview(result);
      if (result.built) renderPromptLayerList(result.built);
    }
  } finally {
    _presetRoundPreviewRun = null;
    if (!presetRoundPreviewVisible()) settlePresetRoundPreviewWaiters(false);
    else if (!_presetRoundPreviewDirty) settlePresetRoundPreviewWaiters(true);
  }
}
// Called from the manager's draft-change signal and when the preset page is shown again; a collapsed or hidden
// preview does no work. Resolves like presetRoundPreviewShown.
function schedulePresetRoundPreview() {
  if (!presetRoundPreviewVisible()) return Promise.resolve(false);
  _presetRoundPreviewDirty = true;
  cancelPresetRoundPreviewBuild();
  if (cardEventGenerationActive()) renderPresetRoundPreviewWaiting();
  else if (!_presetRoundPreviewRun) _presetRoundPreviewRun = runPresetRoundPreview();
  return presetRoundPreviewShown();
}
// Called by 62 when the last generation that dispatches card events settles; the chat has moved on, so a visible
// preview rebuilds from the newest draft. A hidden one rebuilds when the page is shown again.
function resumePresetRoundPreview() {
  if (!presetRoundPreviewVisible()) return;
  _presetRoundPreviewDirty = true;
  if (!_presetRoundPreviewRun) _presetRoundPreviewRun = runPresetRoundPreview();
}
function setPresetRoundPreviewExpanded(expanded) {
  if (expanded && !getChar()) {
    toast('请先选择角色', 'err');
    return false;
  }
  var opening = expanded && !_presetRoundPreviewExpanded;
  _presetRoundPreviewExpanded = !!expanded;
  if (!_presetRoundPreviewExpanded) hidePresetRoundPreview();
  if (opening) renderPresetRoundPreview({ stats: '正在整理本轮内容…', text: '' });
  renderPresetRoundPreviewToggle();
  if (_presetRoundPreviewExpanded) schedulePresetRoundPreview();
  return true;
}
// Called on collapse and by switchAppPage (14) when the preset page is left, where the preview stays expanded for the
// return. Waiting callers learn the preview was not shown.
function hidePresetRoundPreview() {
  cancelPresetRoundPreviewBuild();
  settlePresetRoundPreviewWaiters(false);
}
function togglePresetRoundPreview() {
  setPresetRoundPreviewExpanded(!_presetRoundPreviewExpanded);
}
// Opening the manager starts from a collapsed, empty preview.
function resetPresetRoundPreview() {
  hidePresetRoundPreview();
  _presetRoundPreviewExpanded = false;
  _presetRoundPreviewDirty = false;
  renderPresetRoundPreview({ stats: '', text: '' });
  renderPresetRoundPreviewToggle();
}
async function copyPresetRoundPreview() {
  // Always a fresh build from the current draft; expanding already schedules one. A preview collapsed or left before
  // it is shown copies nothing and reports nothing.
  var shown = _presetRoundPreviewExpanded
    ? schedulePresetRoundPreview()
    : setPresetRoundPreviewExpanded(true) && presetRoundPreviewShown();
  if (!(await shown)) return;
  var text = $('prompt-preview-box') ? $('prompt-preview-box').textContent : '';
  if (!text) {
    toast('暂无可复制预览', 'err');
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => toast('预览已复制', 'ok'))
    .catch(() => toast('复制失败', 'err'));
}
