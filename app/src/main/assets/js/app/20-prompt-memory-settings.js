// ===== Prompt / Memory Managers =====
// ----- Assistant prompt settings -----
const ASSISTANT_PROMPT_DEFINITIONS = [
  {
    key: 'styleAudit',
    surface: 'prompt-presets',
    label: '回复文风检查',
    description: '识别回复里的重复、套话和生硬表达，保存后从下一次检查起生效。',
    // The switch belongs to the global settings draft the group is rendered from.
    toggle: {
      id: 'pm-style-audit-enabled',
      setting: 'styleAuditEnabled',
      label: '后台检查回复文风',
      description: '回复完成后检查最近三条，发现问题时在下一次回复前给出简短修正；不改已生成的消息。',
      statusId: 'style-audit-status',
    },
    prompts: [
      {
        key: 'review',
        label: '文风检查提示词',
        rows: 17,
        description: '检查最近几条角色回复，只返回“无问题”或一句简短的改进建议。',
        protectedName: 'DEFAULT_STYLE_AUDIT_PROMPT',
        defaultPrompt: DEFAULT_STYLE_AUDIT_PROMPT,
      },
    ],
  },
  {
    key: 'expressions',
    surface: 'prompt-presets',
    label: '立绘表情分类',
    description: '开启自动表情后，用当前聊天模型判断回复情绪，每条回复额外调用一次。',
    prompts: [
      {
        key: 'classify',
        label: '表情分类提示词',
        rows: 6,
        description: '输入包含当前素材组的标签和消息正文；让模型只返回一个原始标签。',
        protectedName: 'DEFAULT_EXPRESSION_CLASSIFY_PROMPT',
        defaultPrompt: DEFAULT_EXPRESSION_CLASSIFY_PROMPT,
      },
    ],
  },
  {
    // 侧边栏转盘设置入口；surface id 由受保护 Prompt 清单钉住。
    key: 'wheelScheme',
    surface: 'wheel-manager',
    label: '转盘方案',
    description: '控制新方案导入时的配色与终局人物志。',
    prompts: [
      {
        key: 'palette',
        label: '导入配色提示词',
        rows: 5,
        description: '根据新方案的名称和代表性内容选择配色；旧方案不会重新分析。',
        protectedName: 'DEFAULT_WHEEL_SCHEME_PALETTE_PROMPT',
        defaultPrompt: DEFAULT_WHEEL_SCHEME_PALETTE_PROMPT,
      },
      {
        key: 'biography',
        label: '终局人物志提示词',
        rows: 12,
        description: '根据整局结果记录与最终数值生成人物志，不会改变本机抽取结果。',
        protectedName: 'DEFAULT_WHEEL_SCHEME_BIOGRAPHY_PROMPT',
        defaultPrompt: DEFAULT_WHEEL_SCHEME_BIOGRAPHY_PROMPT,
      },
    ],
  },
  {
    // 设置页「生图」分区；三份提示词由 86-image-generation.js 按图片来源的处理方式选用。
    key: 'imageGeneration',
    surface: 'image-generation',
    label: '出图提示词',
    description: '聊天模型在保留当前上下文的前提下写出图提示词，每次出图额外调用一次。',
    prompts: [
      {
        key: 'summary',
        label: '直接总结',
        rows: 10,
        description: '追加在要配图消息之后的任务提示词，直接写成一段英文描述。',
        protectedName: 'DEFAULT_IMAGE_PROMPT_SUMMARY',
        defaultPrompt: DEFAULT_IMAGE_PROMPT_SUMMARY,
      },
      {
        key: 'desensitize',
        label: '去敏感化',
        rows: 4,
        description: '追加在直接总结任务后的注意事项，把露骨内容改写成含蓄画面，适合审核严格的图片来源。',
        protectedName: 'DEFAULT_IMAGE_PROMPT_DESENSITIZE',
        defaultPrompt: DEFAULT_IMAGE_PROMPT_DESENSITIZE,
      },
      {
        key: 'cardRewrite',
        label: '卡片提示词改写',
        rows: 3,
        description: '卡片自带出图提示词且来源为去敏感化时，先按此改写再叠加上面那段注意事项出图。',
        protectedName: 'DEFAULT_IMAGE_CARD_PROMPT_REWRITE',
        defaultPrompt: DEFAULT_IMAGE_CARD_PROMPT_REWRITE,
      },
    ],
  },
];

function assistantPromptDefinitions() {
  return ASSISTANT_PROMPT_DEFINITIONS;
}
function assistantPromptDefaultText(prompt) {
  return prompt && typeof prompt.defaultPrompt === 'string'
    ? prompt.defaultPrompt
    : (prompt && prompt.defaultText) || '';
}
function assistantPromptDefinition(assistantKey, promptKey) {
  var assistant = assistantPromptDefinitions().find(function (row) {
    return row.key === assistantKey;
  });
  if (!promptKey) return assistant || null;
  var prompt =
    assistant &&
    assistant.prompts.find(function (row) {
      return row.key === promptKey;
    });
  if (prompt && typeof prompt.defaultPrompt === 'string') {
    var exposed = Object.assign({}, prompt);
    exposed.defaultText = prompt.defaultPrompt;
    return exposed;
  }
  return prompt || null;
}
function assistantPromptText(assistantKey, promptKey, settings) {
  var definition = assistantPromptDefinition(assistantKey, promptKey),
    source = settings || (D && D.settings) || {},
    groups =
      source.assistantPromptOverrides &&
      typeof source.assistantPromptOverrides === 'object' &&
      !Array.isArray(source.assistantPromptOverrides)
        ? source.assistantPromptOverrides
        : {},
    group =
      groups[assistantKey] && typeof groups[assistantKey] === 'object' && !Array.isArray(groups[assistantKey])
        ? groups[assistantKey]
        : {},
    value = group[promptKey];
  return typeof value === 'string' ? value : assistantPromptDefaultText(definition);
}
// Translation, localization and memory prompts edited on the settings and memory pages are plain
// settings fields that hold only user edits; a missing key means the current default. A clearable
// field keeps an empty string as a deliberate clear, the others fall back to the default when empty.
function settingsPromptField(key) {
  switch (key) {
    case 'translationPrompt':
      return { defaultText: DEFAULT_TRANSLATION_PROMPT, clearable: false };
    case 'greetingOverviewPrompt':
      return { defaultText: DEFAULT_GREETING_OVERVIEW_PROMPT, clearable: false };
    case 'creatorNotesTranslationPrompt':
      return { defaultText: DEFAULT_CREATOR_NOTES_TRANSLATION_PROMPT, clearable: false };
    case 'cardLocalizationPrompt':
      return { defaultText: DEFAULT_CARD_LOCALIZATION_PROMPT, clearable: true };
    case 'worldBookLocalizationPrompt':
      return { defaultText: DEFAULT_WORLDBOOK_LOCALIZATION_PROMPT, clearable: true };
    case 'memorySummaryPrompt':
      return { defaultText: DEFAULT_MEMORY_SUMMARY_PROMPT, clearable: true };
    case 'memoryInjectPrompt':
      return { defaultText: DEFAULT_MEMORY_INJECT_PROMPT, clearable: false };
  }
  throw new Error('未知的设置提示词字段：' + key);
}
function settingsPromptText(key, settings) {
  var field = settingsPromptField(key),
    value = (settings || (D && D.settings) || {})[key];
  return typeof value === 'string' && (value || field.clearable) ? value : field.defaultText;
}
function storeSettingsPrompt(settings, key, text) {
  var field = settingsPromptField(key),
    value = String(text == null ? '' : text).trim();
  if (value === field.defaultText.trim() || (!value && !field.clearable)) delete settings[key];
  else settings[key] = value;
}
var promptConstraintWarningUi = {
  specs: {
    memorySummary: {
      inputId: 'mm-summary-prompt',
      anchorGroups: [['history_outline'], ['recent_history_summary'], ['long_term_entries']],
    },
    cardLocalization: {
      inputId: 's-card-localization-prompt',
      anchorGroups: [['[夜欲批量术语 JSON 协议]'], ['labels']],
    },
    worldBookLocalization: {
      inputId: 's-worldbook-localization-prompt',
      anchorGroups: [['[夜欲批量术语 JSON 协议]'], ['terms']],
    },
  },
  hasAnchors: function (spec, value) {
    value = String(value || '');
    if (spec.caseInsensitive) value = value.toLowerCase();
    return spec.anchorGroups.every(function (group) {
      return group.some(function (anchor) {
        return value.includes(spec.caseInsensitive ? anchor.toLowerCase() : anchor);
      });
    });
  },
  render: function () {
    var ui = this;
    Object.keys(ui.specs).forEach(function (key) {
      var spec = ui.specs[key],
        input = $(spec.inputId),
        warning = document.querySelector('[data-prompt-constraint-warning="' + key + '"]');
      if (input && warning) warning.hidden = ui.hasAnchors(spec, input.value);
    });
  },
  bind: function () {
    var ui = this;
    Object.keys(ui.specs).forEach(function (key) {
      var input = $(ui.specs[key].inputId);
      if (input && !input.dataset.promptConstraintWarningBound) {
        input.dataset.promptConstraintWarningBound = '1';
        input.addEventListener('change', function () {
          ui.render();
        });
      }
    });
    ui.render();
  },
};
function assistantPromptSurfaceDefinitions(surface) {
  return assistantPromptDefinitions().filter(function (assistant) {
    return assistant.surface === surface;
  });
}
function assistantPromptSurfacePrefix(surface) {
  return { 'wheel-manager': 'wheel', 'image-generation': 'image' }[surface] || 'pm';
}
function assistantPromptInputId(surface, assistantKey, promptKey) {
  return assistantPromptSurfacePrefix(surface) + '-assistant-prompt-' + assistantKey + '-' + promptKey;
}
// Surfaces that mix these Yeyu-only prompts with SillyTavern fields keep the long editors folded.
const ASSISTANT_PROMPT_FOLDED_SURFACES = ['prompt-presets'];
var _assistantPromptOpenFolds = Object.create(null);
function toggleAssistantPromptFold(details, key) {
  if (details.open) {
    _assistantPromptOpenFolds[key] = true;
    scheduleAutoGrowTextareas(details);
  } else delete _assistantPromptOpenFolds[key];
}
// A folded surface lets each prompt's summary stand in for its field label.
function assistantPromptFieldsHtml(surface, assistant, source) {
  var folded = ASSISTANT_PROMPT_FOLDED_SURFACES.includes(surface);
  return assistant.prompts
    .map(function (prompt) {
      var id = assistantPromptInputId(surface, assistant.key, prompt.key),
        foldKey = surface + ':' + assistant.key + ':' + prompt.key,
        field =
          (folded ? '' : '<label for="' + escAttr(id) + '">' + esc(prompt.label) + '</label>') +
          '<textarea id="' +
          escAttr(id) +
          '"' +
          (folded ? ' aria-label="' + escAttr(prompt.label) + '"' : '') +
          ' rows="' +
          Number(prompt.rows || 8) +
          '">' +
          esc(assistantPromptText(assistant.key, prompt.key, source)) +
          '</textarea><div class="hint">' +
          esc(prompt.description) +
          '</div>';
      if (!folded) return '<div class="fg">' + field + '</div>';
      return (
        '<details class="fg ui-fold"' +
        (_assistantPromptOpenFolds[foldKey] ? ' open' : '') +
        ' ontoggle="toggleAssistantPromptFold(this,' +
        jsArg(foldKey) +
        ')"><summary><span class="ui-fold-label">' +
        esc(prompt.label) +
        '</span></summary>' +
        field +
        '</details>'
      );
    })
    .join('');
}
function renderAssistantPromptSettings(targetId, surface, settings) {
  var box = $(targetId),
    source = settings || (D && D.settings);
  if (!box || !source) return;
  box.innerHTML = assistantPromptSurfaceDefinitions(surface)
    .map(function (assistant) {
      var toggle = assistant.toggle;
      return (
        '<section class="ui-section assistant-prompt-group" data-assistant-prompt-group="' +
        escAttr(assistant.key) +
        '"><div class="ui-group-hd"><h3 class="ui-group-title">' +
        esc(assistant.label) +
        '</h3><button class="btn text sm accent" type="button" onclick="resetAssistantPromptDefaults(' +
        jsArg(assistant.key) +
        ',' +
        jsArg(surface) +
        ')">恢复默认</button></div><p class="hint ui-group-hint">' +
        esc(assistant.description) +
        '</p>' +
        (toggle
          ? '<div class="fg switch-field"><label class="switch-row" for="' +
            escAttr(toggle.id) +
            '"><span class="switch-copy"><strong>' +
            esc(toggle.label) +
            '</strong><small>' +
            esc(toggle.description) +
            '</small></span><input type="checkbox" id="' +
            escAttr(toggle.id) +
            '"' +
            (source[toggle.setting] === true ? ' checked' : '') +
            '><span class="switch-control" aria-hidden="true"></span></label>' +
            (toggle.statusId
              ? '<div id="' +
                escAttr(toggle.statusId) +
                '" class="style-audit-status" role="status" aria-live="polite" hidden></div>'
              : '') +
            '</div>'
          : '') +
        assistantPromptFieldsHtml(surface, assistant, source) +
        '</section>'
      );
    })
    .join('');
}
function captureAssistantPromptSettings(settings, surface) {
  if (!settings || typeof settings !== 'object') return;
  var stored =
    settings.assistantPromptOverrides &&
    typeof settings.assistantPromptOverrides === 'object' &&
    !Array.isArray(settings.assistantPromptOverrides)
      ? copyJsonData(settings.assistantPromptOverrides)
      : {};
  assistantPromptSurfaceDefinitions(surface).forEach(function (assistant) {
    var existing =
      stored[assistant.key] && typeof stored[assistant.key] === 'object' && !Array.isArray(stored[assistant.key])
        ? copyJsonData(stored[assistant.key])
        : {};
    assistant.prompts.forEach(function (prompt) {
      var input = $(assistantPromptInputId(surface, assistant.key, prompt.key));
      if (!input) return;
      var fallback = assistantPromptDefaultText(prompt),
        value = String(input.value || '').trim();
      if (value === fallback) delete existing[prompt.key];
      else existing[prompt.key] = value;
    });
    if (Object.keys(existing).length) stored[assistant.key] = existing;
    else delete stored[assistant.key];
  });
  settings.assistantPromptOverrides = stored;
}
function resetAssistantPromptDefaults(assistantKey, surface) {
  var assistant = assistantPromptDefinition(assistantKey);
  if (!assistant || assistant.surface !== surface) return;
  assistant.prompts.forEach(function (prompt) {
    var input = $(assistantPromptInputId(surface, assistant.key, prompt.key));
    if (input) input.value = assistantPromptDefaultText(prompt);
  });
  promptConstraintWarningUi.render();
  scheduleAutoGrowTextareas(document);
  if (surface === 'prompt-presets' && typeof completionPresetNotifyDraftChanged === 'function')
    completionPresetNotifyDraftChanged();
  toast('已恢复“' + assistant.label + '”的默认提示词，保存后生效', 'info');
}

async function resetMemoryPromptsDefault() {
  if (
    !(await appConfirm(
      '确定恢复默认记忆提示词？当前两个提示词输入框会被覆盖，保存后生效。',
      '恢复默认记忆提示词',
      '恢复'
    ))
  )
    return;
  if ($('mm-summary-prompt')) $('mm-summary-prompt').value = settingsPromptField('memorySummaryPrompt').defaultText;
  if ($('mm-inject-prompt')) $('mm-inject-prompt').value = settingsPromptField('memoryInjectPrompt').defaultText;
  promptConstraintWarningUi.render();
  toast('已恢复默认记忆提示词，保存后生效', 'info');
}
async function saveMemoryManager() {
  if (blockDuringGeneration('保存对话记忆设置')) return;
  var before = copyJsonData(D.settings);
  applyMemoryManagerSettings();
  try {
    await saveData('meta');
  } catch (error) {
    D.settings = before;
    toast('对话记忆设置保存失败，原设置已恢复：' + error.message, 'err');
    return;
  }
  toast('记忆设置已保存', 'ok');
}

function memoryInternalControlTags() {
  return typeof generatedArtifactControlTags === 'function'
    ? generatedArtifactControlTags()
    : [
        'thinking_mode',
        'think',
        'analysis',
        'reasoning',
        'reasoning_content',
        'reasoningcontent',
        'assistant_analysis',
        'provider_meta',
        'provider_metadata',
        'generation_meta',
        'debug',
        'cache',
        'usage',
        'internal',
      ];
}
// Alternating plain/fenced slices, the odd ones being code blocks. Markdown fence rules apply: both
// delimiters own a line and the closing run repeats the opening character, so a ``` inside the
// block's own code neither ends it early nor shifts the parity the caller relies on.
function memoryFencedParts(text) {
  var fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*(?:[\s\S]*?\r?\n[ \t]{0,3}\1[`~]*[ \t]*(?=\r?\n|$)|[\s\S]*$)/gm,
    parts = [],
    cursor = 0,
    match;
  while ((match = fence.exec(text))) {
    parts.push(text.slice(cursor, match.index), match[0]);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}
function stripMemoryControlArtifacts(value) {
  if (typeof sanitizeGeneratedVisibleContent === 'function')
    return sanitizeGeneratedVisibleContent(value, { fromProvider: true });
  var text = String(value == null ? '' : value),
    tags = memoryInternalControlTags(),
    parts = memoryFencedParts(text);
  return parts
    .map(function (part, index) {
      if (index % 2) return part;
      var clean = part;
      tags.forEach(function (tag) {
        var escaped = escapeRegexText(tag),
          paired = new RegExp('<\\s*' + escaped + '\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*' + escaped + '\\s*>', 'gi'),
          encoded = new RegExp(
            '&lt;\\s*' + escaped + '\\b[^&]*?&gt;[\\s\\S]*?&lt;\\s*\\/\\s*' + escaped + '\\s*&gt;',
            'gi'
          ),
          orphan = new RegExp('(?:<|&lt;)\\s*\\/?\\s*' + escaped + '\\b[^>]*?(?:>|&gt;)', 'gi');
        clean = clean.replace(paired, ' ').replace(encoded, ' ').replace(orphan, ' ');
      });
      return clean
        .replace(
          /\[\s*(?:thinking|analysis|reasoning|tool(?:_call)?|function_call|provider_meta|debug|cache|usage)[^\]\r\n]*\][\s\S]*?\[\s*\/(?:thinking|analysis|reasoning|tool(?:_call)?|function_call|provider_meta|debug|cache|usage)\s*\]/gi,
          ' '
        )
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
    })
    .join('');
}
function memoryOutputText(value, limit) {
  var text = stripMemoryControlArtifacts(value);
  if (typeof stripGeneratedBoundaryArtifacts === 'function') text = stripGeneratedBoundaryArtifacts(text);
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, Number(limit) || 4000));
}
function messageIsIncomplete(msg) {
  var meta = messageActiveGenerationMeta(msg);
  return !!(msg && (msg.incomplete === true || (meta && meta.incomplete === true)));
}
function memorySourceContent(msg, options) {
  options = options || {};
  if (!msg || typeof msg !== 'object' || (msg.role !== 'user' && msg.role !== 'assistant')) return '';
  if (
    msg.excludeFromMemory === true ||
    msg.kind === 'branch-return-revert' ||
    msg.kind === 'stream-draft' ||
    msg.streamDraft === true ||
    msg.isStreamDraft === true
  )
    return '';
  if (
    msg.role === 'assistant' &&
    (options.excludeIncomplete === true || options.automatic === true) &&
    messageIsIncomplete(msg)
  )
    return '';
  if (msg.role === 'user') return typeof msg.content === 'string' ? msg.content : String(msg.content || '');
  var parts =
      typeof splitAssistantResponseText === 'function'
        ? splitAssistantResponseText(String(msg.content || ''))
        : { content: String(msg.content || '') },
    content =
      typeof stripGeneratedBoundaryArtifacts === 'function'
        ? stripGeneratedBoundaryArtifacts(parts.content)
        : parts.content;
  return memoryOutputText(content, 12000);
}
function memoryPromptSourceText(value, limit) {
  var text = String(value == null ? '' : value),
    cap = Math.max(256, Math.min(12000, Number(limit) || 2400));
  if (text.length <= cap) return text;
  var head = Math.max(128, Math.floor(cap * 0.7)),
    tail = Math.max(96, cap - head - 48);
  return text.slice(0, head) + '\n[内容过长，已保留开头与结尾]\n' + text.slice(-tail);
}

function currentMemorySession() {
  var char = getChar();
  return char ? getActiveSession(char.id) : null;
}
var _memorySummaryLocks = {},
  _memoryJobController = null,
  _memoryJobActive = false;
function showMemoryJob(title, textValue) {
  _memoryJobActive = true;
  var modal = $('memory-progress-modal'),
    titleEl = $('memory-progress-title'),
    textEl = $('memory-progress-text'),
    cancel = $('memory-progress-cancel'),
    input = $('user-input');
  if (input) input.disabled = true;
  if (typeof syncBranchReturnUndoButtons === 'function') syncBranchReturnUndoButtons();
  if (titleEl) titleEl.textContent = title || '正在处理历史压缩';
  if (textEl) textEl.textContent = textValue || '正在合并较早消息与当前有效摘要…';
  if (cancel) {
    cancel.disabled = false;
    cancel.textContent = '取消处理';
  }
  if (modal) openModal('memory-progress-modal');
}
function hideMemoryJob() {
  _memoryJobActive = false;
  var modal = $('memory-progress-modal'),
    input = $('user-input');
  if (modal) closeModal('memory-progress-modal');
  if (input) input.disabled = _generationState !== 'idle';
  if (typeof syncBranchReturnUndoButtons === 'function') syncBranchReturnUndoButtons();
}
function cancelMemoryJob() {
  if (!_memoryJobActive) return;
  var textEl = $('memory-progress-text'),
    cancel = $('memory-progress-cancel');
  if (textEl) textEl.textContent = '正在取消，已生成但尚未保存的结果会被丢弃…';
  if (cancel) {
    cancel.disabled = true;
    cancel.textContent = '正在取消';
  }
  if (_memoryJobController) _memoryJobController.abort();
}
// ===== Settings =====
function normalizeApiBase(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}
function isValidApiBase(url) {
  try {
    var parsed = new URL(normalizeApiBase(url));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch (_) {
    return false;
  }
}
function setApiTestStatus(text, type) {
  var el = $('api-test-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'api-test-status ' + (type || '');
}
// Status plus the provider's own wording, shared by model detection and connectivity tests.
function providerFailureText(status, message) {
  message = String(message || '').trim();
  if (!status) return message || '未知错误';
  return message && message !== 'API错误 ' + status ? 'HTTP ' + status + ' · ' + message : 'HTTP ' + status;
}
function parseApiErrorStatus(resp, text) {
  return providerFailureText(resp.status, providerErrorText(text));
}
// Model detection and connectivity tests of one form slot ("provider" or a route key) share its
// status line, so while one runs the other's button is disabled.
var _providerModelDetections = new Map(),
  _providerConnectivityTests = new Map();
function providerProbeDetectId(slot) {
  return slot === 'provider' ? 'api-detect-btn' : 's-route-' + slot + '-detect';
}
function setProviderProbeStatus(slot, text, type) {
  if (slot === 'provider') {
    setApiTestStatus(text, type);
    return;
  }
  var el = $('s-route-' + slot + '-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'model-route-status' + (type ? ' api-test-status ' + type : '');
}
function syncProviderProbeButtons() {
  document.querySelectorAll('[data-probe-slot]').forEach(function (button) {
    var slot = button.dataset.probeSlot,
      detecting = _providerModelDetections.has(providerProbeDetectId(slot)),
      testing = _providerConnectivityTests.has(slot);
    if (button.id === providerProbeDetectId(slot)) {
      button.disabled = detecting || testing;
      return;
    }
    button.disabled = detecting;
    button.textContent = testing ? '取消' : '测试';
  });
}
// Switching provider or type, or leaving the page, drops every running probe; the probes no longer
// report back, so their status lines are cleared here instead of keeping a busy message.
function cancelProviderProbes() {
  var slots = new Set();
  _providerModelDetections.forEach(function (request) {
    request.controller.abort();
    slots.add(request.slot);
  });
  _providerModelDetections.clear();
  _providerConnectivityTests.forEach(function (request, slot) {
    request.controller.abort();
    slots.add(slot);
  });
  _providerConnectivityTests.clear();
  if (typeof cancelImageSourceDetection === 'function') cancelImageSourceDetection();
  slots.forEach(function (slot) {
    setProviderProbeStatus(slot, '', '');
  });
  syncProviderProbeButtons();
}
function beginProviderModelDetection(slot) {
  var id = providerProbeDetectId(slot),
    previous = _providerModelDetections.get(id);
  if (previous) previous.controller.abort();
  var request = { id: id, slot: slot, controller: new AbortController(), settings: providerFormSettings() };
  _providerModelDetections.set(id, request);
  syncProviderProbeButtons();
  return request;
}
function providerModelDetectionLive(request) {
  return _providerModelDetections.get(request.id) === request && providerFormSettings() === request.settings;
}
function finishProviderModelDetection(request) {
  if (_providerModelDetections.get(request.id) !== request) return;
  _providerModelDetections.delete(request.id);
  syncProviderProbeButtons();
}
async function fetchProviderModelIds(provider, controller) {
  provider = provider || {};
  if (provider.protocol === 'grok-subscription') {
    var grokResponse = await fetchGrokSubscription('/models', { signal: controller && controller.signal });
    if (!grokResponse.ok) {
      var grokError = await grokSubscriptionFailure(grokResponse);
      throw grokError;
    }
    var grokModels = await grokResponse.json(),
      grokIds = (grokModels.data || [])
        .map(function (model) {
          return String(model.id || '');
        })
        .filter(Boolean);
    if (!grokIds.length) throw new Error('Grok 未返回可用模型，请稍后重试。');
    return Array.from(new Set(grokIds)).sort();
  }
  var url = normalizeApiBase(provider.apiUrl),
    key = String(
      typeof providerActiveApiKey === 'function' ? providerActiveApiKey(provider) : provider.apiKey || ''
    ).trim();
  if (!isValidApiBase(url)) throw new Error('API 地址无效');
  url = providerApiBase(provider.protocol, url);
  var nativeProtocol = provider.protocol === 'anthropic' || provider.protocol === 'gemini';
  controller = controller || new AbortController();
  var release =
    typeof registerTransientRequestController === 'function'
      ? registerTransientRequestController(controller)
      : function () {};
  try {
    var headers = nativeProtocol
      ? nativeProviderHeaders(Object.assign({}, provider, { apiKey: key }), true)
      : { 'Accept': 'application/json' };
    var ids = [],
      cursor = '',
      seen = new Set();
    do {
      var query =
        provider.protocol === 'gemini'
          ? '?pageSize=1000' + (cursor ? '&pageToken=' + encodeURIComponent(cursor) : '')
          : provider.protocol === 'anthropic'
            ? '?limit=1000' + (cursor ? '&after_id=' + encodeURIComponent(cursor) : '')
            : '';
      if (key && !nativeProtocol) headers.Authorization = 'Bearer ' + key;
      var resp = await fetch(url + '/models' + query, {
          method: 'GET',
          headers: headers,
          signal: controller.signal,
          cache: 'no-store',
        }),
        text = await resp.text();
      if (controller.signal.aborted) {
        var aborted = new Error('已取消');
        aborted.name = 'AbortError';
        throw aborted;
      }
      if (!resp.ok) {
        var failure = new Error(parseApiErrorStatus(resp, text));
        failure.status = resp.status;
        failure.responseText = text;
        throw failure;
      }
      var json;
      try {
        json = JSON.parse(text);
      } catch (_) {
        throw new Error('接口返回的不是有效 JSON');
      }
      var rows = Array.isArray(json)
          ? json
          : Array.isArray(json.data)
            ? json.data
            : Array.isArray(json.models)
              ? json.models
              : [],
        pageIds = rows
          // Gemini lists embedding and image models too; keep only those that can chat. Relays that
          // omit supportedGenerationMethods are left unfiltered. Checked 2026-09-25: ai.google.dev/api/models.
          .filter(function (x) {
            var methods = provider.protocol === 'gemini' && x && x.supportedGenerationMethods;
            return !Array.isArray(methods) || methods.includes('generateContent');
          })
          .map(function (x) {
            var id = typeof x === 'string' ? x : x && String(x.id || x.name || '');
            return provider.protocol === 'gemini' && id ? id.replace(/^models\//, '') : id;
          })
          .filter(Boolean);
      ids = ids.concat(pageIds);
      // Official cursors: Anthropic has_more/last_id; Gemini nextPageToken. Never follow a returned URL.
      // Checked 2026-09-25: platform.claude.com/docs/en/api/models/list and ai.google.dev/api/models.
      cursor =
        provider.protocol === 'gemini'
          ? String(json.nextPageToken || '')
          : provider.protocol === 'anthropic' && json.has_more
            ? String(json.last_id || '')
            : '';
      if (cursor && seen.has(cursor)) throw new Error('模型列表分页游标重复');
      if (provider.protocol === 'anthropic' && json.has_more && !cursor) throw new Error('模型列表缺少分页游标');
      if (cursor) seen.add(cursor);
    } while (cursor);
    ids = Array.from(new Set(ids)).sort();
    if (!ids.length) throw new Error('连接成功，但响应中没有可识别的模型列表');
    return ids;
  } finally {
    release();
  }
}
async function detectApiModels() {
  captureProviderForm();
  var provider = activeProviderForSettings(providerFormSettings());
  if (!provider.apiUrl) {
    setApiTestStatus('请填写 API 地址', 'err');
    return;
  }
  var request = beginProviderModelDetection('provider');
  setApiTestStatus('正在检测模型…', 'busy');
  try {
    var ids = await fetchProviderModelIds(provider, request.controller);
    if (!providerModelDetectionLive(request)) return;
    provider.models = ids;
    var box = $('api-model-results');
    box.innerHTML = ids
      .map(function (id) {
        return (
          '<button type="button" class="api-model-option" onclick="chooseDetectedModel(this)" data-model="' +
          escAttr(id) +
          '">' +
          esc(id) +
          '</button>'
        );
      })
      .join('');
    box.style.display = 'grid';
    renderModelPresetForm();
    setApiTestStatus('连接有效 · 已发现 ' + ids.length + ' 个模型，请选择', 'ok');
  } catch (e) {
    if (providerModelDetectionLive(request))
      setApiTestStatus(e.name === 'AbortError' ? '检测已取消' : '检测失败：' + e.message, 'err');
  } finally {
    finishProviderModelDetection(request);
  }
}
function chooseDetectedModel(btn) {
  var id = btn && btn.dataset.model;
  if (!id) return;
  $('s-model').value = id;
  var provider = captureProviderForm();
  if (provider) provider.model = id;
  document.querySelectorAll('.api-model-option').forEach(function (x) {
    x.classList.toggle('selected', x === btn);
  });
  setApiTestStatus('已选择 ' + id + '；保存设置后生效', 'ok');
}
function optionalSettingsNumberInput(id, min, max) {
  var input = $(id),
    text = String((input && input.value) || '').trim();
  if (!text) return null;
  var value = Number(text);
  return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}
function resetParameterSettings() {
  var values = {
    's-max-context': '0',
    's-max-tokens': '0',
    's-style-audit-max-tokens': '0',
    's-temperature': '',
    's-top-p': '',
    's-frequency-penalty': '',
    's-presence-penalty': '',
  };
  Object.keys(values).forEach(function (id) {
    var input = $(id);
    if (input) input.value = values[id];
  });
  toast('已恢复参数页默认值，点击保存后生效', 'info');
}
async function detectRouteModels(key) {
  if (blockDuringGeneration('检测模型')) return;
  captureProviderForm();
  captureModelPresetForm();
  var providerId = routeModelProviderId(key),
    provider = (providerFormSettings().providers || []).find(function (p) {
      return p.id === providerId;
    });
  if (!provider) {
    toast('没有可检测的供应商', 'info');
    return;
  }
  var request = beginProviderModelDetection(key);
  setProviderProbeStatus(key, '正在连接并读取模型列表…', 'busy');
  try {
    var ids = await fetchProviderModelIds(provider, request.controller);
    if (!providerModelDetectionLive(request)) return;
    provider.models = ids;
    renderModelPresetForm();
    setProviderProbeStatus(key, '已发现 ' + provider.models.length + ' 个模型，请在模型框中选择；保存后生效', 'ok');
    toast(
      '已更新“' +
        (
          MODEL_ROUTE_DEFINITIONS.find(function (x) {
            return x.key === key;
          }) || {}
        ).label +
        '”的模型列表',
      'ok'
    );
  } catch (e) {
    if (!providerModelDetectionLive(request)) return;
    setProviderProbeStatus(key, e.name === 'AbortError' ? '检测已取消' : '检测失败：' + e.message, 'err');
  } finally {
    finishProviderModelDetection(request);
  }
}
// Sends one short non-streaming request from the unsaved form; clicking again while it runs cancels it.
async function runProviderConnectivityTest(slot, route) {
  var running = _providerConnectivityTests.get(slot);
  if (running) {
    running.controller.abort();
    return;
  }
  if (!isValidApiBase(route.apiUrl)) {
    setProviderProbeStatus(slot, '请填写有效的 API 地址', 'err');
    return;
  }
  if (!route.model) {
    setProviderProbeStatus(slot, '请先填写模型', 'err');
    return;
  }
  var request = { controller: new AbortController(), settings: providerFormSettings() },
    live = function () {
      return _providerConnectivityTests.get(slot) === request && providerFormSettings() === request.settings;
    };
  _providerConnectivityTests.set(slot, request);
  syncProviderProbeButtons();
  setProviderProbeStatus(slot, '正在测试 ' + route.model + '…', 'busy');
  try {
    var result = await testProviderConnectivity(route, { signal: request.controller.signal });
    if (live()) setProviderProbeStatus(slot, '连通正常，' + result.seconds.toFixed(1) + ' 秒', 'ok');
  } catch (e) {
    if (!live()) return;
    if (request.controller.signal.aborted) {
      setProviderProbeStatus(slot, '测试已取消', 'err');
      return;
    }
    var text = providerFailureText(e.status, e.message);
    setProviderProbeStatus(slot, '测试失败：' + (text.length > 300 ? text.slice(0, 300) + '…' : text), 'err');
  } finally {
    if (_providerConnectivityTests.get(slot) === request) _providerConnectivityTests.delete(slot);
    syncProviderProbeButtons();
  }
}
// A route "inherit" effort follows the global thinking select as currently filled in.
function providerConnectivityRoute(provider, model, reasoningEffort, requestOptions) {
  var globalEffort = $('s-reasoning-effort');
  return {
    protocol: provider.protocol,
    apiUrl: normalizeApiBase(provider.apiUrl),
    apiKey: providerActiveApiKey(provider),
    model: String(model || provider.model || '').trim(),
    reasoningEffort: reasoningEffort === 'inherit' ? (globalEffort && globalEffort.value) || 'auto' : reasoningEffort,
    requestOptions: requestOptions || null,
  };
}
function testProviderFormConnectivity() {
  var provider = captureProviderForm();
  if (provider) runProviderConnectivityTest('provider', providerConnectivityRoute(provider, provider.model, 'inherit'));
}
// A route without a thinking select stores no effort; its requests inherit the global thinking setting
// under the fixed request options its definition records, read here through the same modelRouteRequestOptions.
function testRouteConnectivity(key) {
  captureProviderForm();
  captureModelPresetForm();
  var providerId = routeModelProviderId(key),
    provider = (providerFormSettings().providers || []).find(function (p) {
      return p.id === providerId;
    }),
    def =
      MODEL_ROUTE_DEFINITIONS.find(function (x) {
        return x.key === key;
      }) || {},
    model = $('s-route-' + key + '-model'),
    thinking = $('s-route-' + key + '-thinking');
  if (!provider) {
    setProviderProbeStatus(key, '没有可测试的供应商', 'err');
    return;
  }
  runProviderConnectivityTest(
    key,
    providerConnectivityRoute(
      provider,
      model && model.value,
      def.thinkingConfigurable ? normalizeRouteReasoningEffort(thinking && thinking.value) : 'inherit',
      modelRouteRequestOptions(key)
    )
  );
}
// 背景模糊只属于全宽沉浸，气泡模式下连入口都不出现。
function syncImmersiveAppearanceFields() {
  var field = $('s-immersive-blur-field'),
    slider = $('s-immersive-blur'),
    value = $('s-immersive-blur-value');
  if (field) field.hidden = !($('s-message-style') && $('s-message-style').value === 'immersive');
  if (value && slider) value.textContent = String(normalizeImmersiveBackgroundBlur(slider.value));
}
// 设置页中不属于连接草稿、由保存统一采集的字段。切换目的地时整页表单保留；回到本页时，
// 用户没改过的字段换成离开期间别处保存的新值，改过的字段保留用户输入。
var SETTINGS_PAGE_FIELD_IDS = [
  's-embedding-enabled',
  's-vector-chats-enabled',
  's-vector-worldbook-enabled',
  's-embedding-api-url',
  's-embedding-api-key',
  's-embedding-model',
  's-embedding-dimensions',
  's-max-context',
  's-max-tokens',
  's-style-audit-max-tokens',
  's-temperature',
  's-top-p',
  's-frequency-penalty',
  's-presence-penalty',
  's-show-thinking',
  's-stream-output',
  's-reasoning-effort',
  's-inner-os',
  's-theme-mode',
  's-message-style',
  's-immersive-blur',
  's-translation-prompt',
  's-greeting-overview-prompt',
  's-card-localization-prompt',
  's-worldbook-localization-prompt',
  's-worldbook-localization-batch-size',
  's-creator-notes-translation-prompt',
];
var SETTINGS_PAGE_PROMPT_INPUTS = [
  { id: 's-translation-prompt', key: 'translationPrompt' },
  { id: 's-greeting-overview-prompt', key: 'greetingOverviewPrompt' },
  { id: 's-card-localization-prompt', key: 'cardLocalizationPrompt' },
  { id: 's-worldbook-localization-prompt', key: 'worldBookLocalizationPrompt' },
  { id: 's-creator-notes-translation-prompt', key: 'creatorNotesTranslationPrompt' },
];
// 生图分区的出图提示词输入框由分组定义渲染，按同一规则保留未保存的修改。
function settingsPageFieldIds() {
  var ids = SETTINGS_PAGE_FIELD_IDS.slice();
  assistantPromptSurfaceDefinitions('image-generation').forEach(function (assistant) {
    assistant.prompts.forEach(function (prompt) {
      ids.push(assistantPromptInputId('image-generation', assistant.key, prompt.key));
    });
  });
  return ids;
}
var _settingsPageFieldBaseline = {};
function settingsPageFieldValues() {
  var values = {};
  settingsPageFieldIds().forEach(function (id) {
    var input = $(id);
    if (input) values[id] = input.type === 'checkbox' ? input.checked : input.value;
  });
  return values;
}
function loadSettingsForm() {
  ensureProviderSettings(D.settings);
  beginProviderDraft();
  loadGlobalSpeechEditor();
  renderSettingsForm();
  _settingsPageFieldBaseline = settingsPageFieldValues();
  promptConstraintWarningUi.bind();
}
function refreshSettingsForm() {
  var current = settingsPageFieldValues(),
    edited = {};
  Object.keys(current).forEach(function (id) {
    if (current[id] !== _settingsPageFieldBaseline[id]) edited[id] = current[id];
  });
  refreshProviderDraft();
  renderSettingsForm();
  _settingsPageFieldBaseline = settingsPageFieldValues();
  Object.keys(edited).forEach(function (id) {
    if ($(id).type === 'checkbox') $(id).checked = edited[id];
    else $(id).value = edited[id];
  });
  syncImmersiveAppearanceFields();
  promptConstraintWarningUi.render();
}
function renderSettingsForm() {
  const s = D.settings;
  renderProviderEditor();
  renderModelPresetForm();
  if (typeof renderImageSourceEditor === 'function') renderImageSourceEditor();
  renderAssistantPromptSettings('image-assistant-prompts', 'image-generation', s);
  if ($('s-embedding-enabled')) $('s-embedding-enabled').checked = s.embeddingEnabled === true;
  if ($('s-vector-chats-enabled')) $('s-vector-chats-enabled').checked = s.vectorChatsEnabled !== false;
  if ($('s-vector-worldbook-enabled'))
    $('s-vector-worldbook-enabled').checked =
      typeof worldBookSettings === 'function'
        ? worldBookSettings().vectorEnabled
        : D.worldBook.vector_enabled !== false;
  if ($('s-embedding-api-url')) $('s-embedding-api-url').value = String(s.embeddingApiUrl || '');
  if ($('s-embedding-api-key')) $('s-embedding-api-key').value = String(s.embeddingApiKey || '');
  if ($('s-embedding-model')) $('s-embedding-model').value = String(s.embeddingModel || 'embedding-3');
  if ($('s-embedding-dimensions'))
    $('s-embedding-dimensions').value = Number(s.embeddingDimensions) > 0 ? String(s.embeddingDimensions) : '';
  if (typeof renderVectorRetrievalStatus === 'function') renderVectorRetrievalStatus();
  $('s-max-context').value = s.maxContextTokens || 0;
  $('s-max-tokens').value = s.maxTokens || 0;
  $('s-style-audit-max-tokens').value = taskMaxTokens('styleAuditMaxTokens');
  $('s-temperature').value =
    optionalSamplingValue(s, 'temperature') === null ? '' : optionalSamplingValue(s, 'temperature');
  $('s-top-p').value = optionalSamplingValue(s, 'top_p') === null ? '' : optionalSamplingValue(s, 'top_p');
  $('s-frequency-penalty').value =
    optionalSamplingValue(s, 'frequency_penalty') === null ? '' : optionalSamplingValue(s, 'frequency_penalty');
  $('s-presence-penalty').value =
    optionalSamplingValue(s, 'presence_penalty') === null ? '' : optionalSamplingValue(s, 'presence_penalty');
  $('s-show-thinking').checked = s.showThinking;
  if ($('s-stream-output')) $('s-stream-output').checked = s.streamOutput !== false;
  if ($('s-reasoning-effort')) $('s-reasoning-effort').value = s.reasoningEffort || 'auto';
  $('s-inner-os').checked = s.innerOS;
  if ($('s-theme-mode')) $('s-theme-mode').value = s.themeMode || 'auto';
  if ($('s-message-style')) $('s-message-style').value = s.messageStyle === 'immersive' ? 'immersive' : 'bubble';
  if ($('s-immersive-blur'))
    $('s-immersive-blur').value = String(normalizeImmersiveBackgroundBlur(s.immersiveBackgroundBlur));
  syncImmersiveAppearanceFields();
  SETTINGS_PAGE_PROMPT_INPUTS.forEach(function (row) {
    if ($(row.id)) $(row.id).value = settingsPromptText(row.key, s);
  });
  if ($('s-worldbook-localization-batch-size'))
    $('s-worldbook-localization-batch-size').value = Math.max(
      10,
      Math.min(120, parseInt(s.worldBookLocalizationBatchSize) || 80)
    );
  if (typeof renderRegexScriptManager === 'function') renderRegexScriptManager();
  if (typeof renderRegexPresetManager === 'function') renderRegexPresetManager();
  if (typeof stscriptPromptFeatureRenderUi === 'function') stscriptPromptFeatureRenderUi();
}
async function saveSettings() {
  if (blockDuringGeneration('保存设置')) return;
  var speechDraft;
  try {
    speechDraft = globalSpeechSettingsDraft();
  } catch (error) {
    toast(error.message, 'err');
    return;
  }
  const beforeSettings = copyJsonData(D.settings);
  const beforeWorldBook = copyJsonData(D.worldBook);
  captureProviderForm();
  captureModelPresetForm();
  if (typeof captureImageSourceForm === 'function') captureImageSourceForm();
  var active = activeProviderForSettings(providerFormSettings()),
    apiUrl = active.apiUrl,
    model = String(active.model || '').trim(),
    embeddingApiUrl = normalizeApiBase($('s-embedding-api-url') && $('s-embedding-api-url').value),
    embeddingDimensionsText = String(($('s-embedding-dimensions') && $('s-embedding-dimensions').value) || '').trim(),
    embeddingDimensions = embeddingDimensionsText ? Number(embeddingDimensionsText) : 0,
    temperature = optionalSettingsNumberInput('s-temperature', 0, 2),
    topP = optionalSettingsNumberInput('s-top-p', 0, 1),
    frequencyPenalty = optionalSettingsNumberInput('s-frequency-penalty', -2, 2),
    presencePenalty = optionalSettingsNumberInput('s-presence-penalty', -2, 2),
    // 0 或留空为不限，与 TASK_MAX_TOKEN_DEFAULTS.styleAuditMaxTokens 一致。
    styleAuditLimit = normalizeTaskMaxTokens($('s-style-audit-max-tokens').value, 0);
  var vectorWorldbookEnabled = $('s-vector-worldbook-enabled')
      ? $('s-vector-worldbook-enabled').checked
      : D.worldBook.vector_enabled !== false,
    vectorWorldbookChanged = D.worldBook.vector_enabled !== vectorWorldbookEnabled;
  $('s-style-audit-max-tokens').value = String(styleAuditLimit);
  if (!isValidApiBase(apiUrl) || !model) {
    toast(!isValidApiBase(apiUrl) ? 'API 地址必须是有效的 http:// 或 https:// 地址' : '请填写当前对话模型 ID', 'err');
    return;
  }
  if (
    String(($('s-embedding-api-url') && $('s-embedding-api-url').value) || '').trim() &&
    !isValidApiBase(embeddingApiUrl)
  ) {
    toast('嵌入 API 地址需以 http:// 或 https:// 开头', 'err');
    return;
  }
  var invalidImageSource = (providerFormSettings().imageSources || []).find(function (source) {
    return source.type === 'openai' && source.apiUrl && !isValidApiBase(source.apiUrl);
  });
  if (invalidImageSource) {
    toast('图片来源「' + invalidImageSource.name + '」的接口地址需以 http:// 或 https:// 开头', 'err');
    return;
  }
  if (embeddingDimensionsText && (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0)) {
    toast('向量维度请填写正整数，或留空使用模型默认值', 'err');
    return;
  }
  if ([temperature, topP, frequencyPenalty, presencePenalty].includes(undefined)) {
    toast('采样参数超出允许范围，请检查后再保存', 'err');
    return;
  }
  // Number() keeps a typed 1e5 as 100000 (parseInt read it as 1).
  var replyLimitInput = Number($('s-max-tokens').value),
    replyLimit = clampReplyMaxTokens(replyLimitInput),
    contextLimit = Math.max(0, Math.floor(Number($('s-max-context').value)) || 0);
  $('s-max-tokens').value = String(replyLimit);
  $('s-max-context').value = String(contextLimit);
  D.settings = Object.assign({}, D.settings, {
    speech: speechDraft,
    embeddingEnabled: $('s-embedding-enabled') ? $('s-embedding-enabled').checked : false,
    vectorChatsEnabled: $('s-vector-chats-enabled') ? $('s-vector-chats-enabled').checked : true,
    embeddingApiUrl: embeddingApiUrl,
    embeddingApiKey: $('s-embedding-api-key') ? $('s-embedding-api-key').value.trim() : '',
    embeddingModel: $('s-embedding-model') ? $('s-embedding-model').value.trim() : '',
    embeddingDimensions: embeddingDimensions,
    maxContextTokens: contextLimit,
    maxTokens: replyLimit,
    styleAuditMaxTokens: styleAuditLimit,
    temperature: temperature,
    top_p: topP,
    frequency_penalty: frequencyPenalty,
    presence_penalty: presencePenalty,
    showThinking: $('s-show-thinking').checked,
    streamOutput: $('s-stream-output') ? $('s-stream-output').checked : true,
    reasoningEffort: $('s-reasoning-effort') ? $('s-reasoning-effort').value : 'auto',
    innerOS: $('s-inner-os').checked,
    themeMode: $('s-theme-mode') ? $('s-theme-mode').value : 'auto',
    messageStyle: $('s-message-style') ? $('s-message-style').value : 'bubble',
    immersiveBackgroundBlur: normalizeImmersiveBackgroundBlur(
      $('s-immersive-blur') ? $('s-immersive-blur').value : D.settings.immersiveBackgroundBlur
    ),
    worldBookLocalizationBatchSize: $('s-worldbook-localization-batch-size')
      ? Math.max(10, Math.min(120, parseInt($('s-worldbook-localization-batch-size').value) || 80))
      : 80,
  });
  SETTINGS_PAGE_PROMPT_INPUTS.forEach(function (row) {
    if ($(row.id)) storeSettingsPrompt(D.settings, row.key, $(row.id).value);
  });
  captureAssistantPromptSettings(D.settings, 'image-generation');
  if ($('s-vector-worldbook-enabled')) D.worldBook.vector_enabled = vectorWorldbookEnabled;
  commitProviderDraft(D.settings);
  ensureProviderSettings(D.settings);
  try {
    await saveData(vectorWorldbookChanged ? ['meta', 'worldbook'] : 'meta');
  } catch (error) {
    // Login/logout and token rotation are immediate account actions, outside the provider form draft.
    var currentGrokAuth = D.settings.grokSubscriptionAuth;
    D.settings = beforeSettings;
    if (currentGrokAuth) D.settings.grokSubscriptionAuth = currentGrokAuth;
    else delete D.settings.grokSubscriptionAuth;
    D.worldBook = beforeWorldBook;
    toast('设置保存失败，原设置已恢复：' + error.message, 'err');
    return;
  }
  beginProviderDraft();
  _settingsPageFieldBaseline = settingsPageFieldValues();
  if (typeof stscriptPromptFeatureRenderUi === 'function') stscriptPromptFeatureRenderUi();
  if (D.settings.styleAuditEnabled !== true && typeof clearStyleAuditStates === 'function') clearStyleAuditStates();
  if (typeof renderVectorRetrievalStatus === 'function') renderVectorRetrievalStatus();
  applyConfiguredTheme();
  if (typeof applyMessageStyle === 'function') applyMessageStyle();
  syncKeyboardViewport();
  updateTokensBar(getChar());
  toast('设置已保存', 'ok');
  if (replyLimitInput < 0 || replyLimitInput > TASK_MAX_TOKENS_MAX)
    toast('回复长度上限只能填 0—' + TASK_MAX_TOKENS_MAX + '，已按 ' + replyLimit + ' 保存', 'info');
}
function resetTranslationPrompts() {
  SETTINGS_PAGE_PROMPT_INPUTS.forEach(function (row) {
    if ($(row.id)) $(row.id).value = settingsPromptField(row.key).defaultText;
  });
  promptConstraintWarningUi.render();
  toast('已恢复默认翻译提示词，点击保存后生效', 'info');
}
