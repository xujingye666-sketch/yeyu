// ===== SillyTavern Chat Completion preset model / Prompt Manager =====
// SillyTavern's built-in prompt slots (its system prompts): the text is editable and the slot movable, but the
// slot itself is never parked or deleted. The card's system_prompt / post_history_instructions override main /
// jailbreak; the other two are the preset's own.
var PRESET_BUILTIN_SLOT_IDS = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'];
var PRESET_CARD_OVERRIDE_SLOT_IDS = ['main', 'jailbreak'];
var PRESET_PLACEHOLDER_IDS = [
  'worldInfoBefore',
  'personaDescription',
  'charDescription',
  'charPersonality',
  'scenario',
  'worldInfoAfter',
  'dialogueExamples',
  'chatHistory',
];
// Like ST, every other prompt, markers included, may move into the chat at a depth; these two keep their slot.
var PRESET_SLOT_ONLY_MARKER_IDS = ['dialogueExamples', 'chatHistory'];
// Placeholders are stored under SillyTavern's standard names and always shown under these, whatever a preset names them.
var PRESET_PLACEHOLDER_ST_NAMES = {
  worldInfoBefore: 'World Info (before)',
  personaDescription: 'Persona Description',
  charDescription: 'Char Description',
  charPersonality: 'Char Personality',
  scenario: 'Scenario',
  worldInfoAfter: 'World Info (after)',
  dialogueExamples: 'Chat Examples',
  chatHistory: 'Chat History',
};
var PRESET_PLACEHOLDER_LABELS = {
  worldInfoBefore: '世界书（角色定义之前）',
  personaDescription: '用户人格',
  charDescription: '角色描述',
  charPersonality: '角色性格',
  scenario: '场景',
  worldInfoAfter: '世界书（角色定义之后）',
  dialogueExamples: '对话示例',
  chatHistory: '聊天记录',
};
var PRESET_PLACEHOLDER_SOURCES = {
  worldInfoBefore: '世界书（角色定义之前）',
  personaDescription: '当前人格描述',
  charDescription: '角色卡描述',
  charPersonality: '角色卡性格',
  scenario: '角色卡场景',
  worldInfoAfter: '世界书（角色定义之后）',
  dialogueExamples: '角色卡对话示例',
  chatHistory: '当前聊天记录',
};
var COMPLETION_PRESET_EVENT_SETTINGS_TO_UPDATE = {
  names_behavior: ['#NULL_SELECTOR', 'names_behavior', false, false],
  send_if_empty: ['#pm-send-if-empty', 'send_if_empty', false, false],
  impersonation_prompt: ['#pm-impersonation-prompt', 'impersonation_prompt', false, false],
  new_chat_prompt: ['#pm-new-chat-prompt', 'new_chat_prompt', false, false],
  new_example_chat_prompt: ['#pm-new-example-chat-prompt', 'new_example_chat_prompt', false, false],
  continue_nudge_prompt: ['#pm-continue-nudge-prompt', 'continue_nudge_prompt', false, false],
  wi_format: ['#pm-wi-format', 'wi_format', false, false],
  scenario_format: ['#pm-scenario-format', 'scenario_format', false, false],
  personality_format: ['#pm-personality-format', 'personality_format', false, false],
  prompts: ['#pm-prompt-list', 'prompts', false, false],
  prompt_order: ['#pm-prompt-list', 'prompt_order', false, false],
  assistant_prefill: ['#pm-assistant-prefill', 'assistant_prefill', false, false],
  squash_system_messages: ['#NULL_SELECTOR', 'squash_system_messages', true, false],
  continue_prefill: ['#NULL_SELECTOR', 'continue_prefill', true, false],
  extensions: ['#NULL_SELECTOR', 'extensions', false, false],
};
var _completionPresetRuntimeBarrier = Promise.resolve(true),
  _completionPresetRuntimeTransaction = null;
function isPresetSystemPrompt(prompt) {
  return PRESET_BUILTIN_SLOT_IDS.includes(String((prompt && prompt.id) || ''));
}
function isPresetPlaceholderPrompt(prompt) {
  return PRESET_PLACEHOLDER_IDS.includes(String((prompt && prompt.id) || ''));
}
// The editor offers in-chat placement except for the built-in slots and the two slot-only markers. Assembly still
// injects an imported system prompt at its depth when its injection_position says in-chat (presetPromptInChat).
function presetPromptPositionEditable(identifier) {
  identifier = String(identifier || '');
  return !PRESET_BUILTIN_SLOT_IDS.includes(identifier) && !PRESET_SLOT_ONLY_MARKER_IDS.includes(identifier);
}
function presetPromptInChat(prompt) {
  return (
    !!prompt &&
    Number(prompt.injection_position) === 1 &&
    !PRESET_SLOT_ONLY_MARKER_IDS.includes(String(prompt.identifier || ''))
  );
}
function isPresetNormalPrompt(prompt) {
  return !isPresetSystemPrompt(prompt) && !isPresetPlaceholderPrompt(prompt);
}
var default_preset = {
  settings: {
    max_context: 2000000,
    max_completion_tokens: 300,
    reply_count: 1,
    should_stream: false,
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    repetition_penalty: 1,
    top_p: 1,
    min_p: 0,
    top_k: 0,
    top_a: 0,
    seed: -1,
    squash_system_messages: false,
    reasoning_effort: 'auto',
    request_thoughts: false,
    request_images: false,
    enable_web_search: false,
    allow_sending_images: 'disabled',
    allow_sending_videos: false,
    character_name_prefix: 'none',
    wrap_user_messages_in_quotes: false,
  },
  prompts: [
    {
      id: 'worldInfoBefore',
      name: '世界书（角色定义之前）',
      enabled: true,
      position: { type: 'relative' },
      role: 'system',
    },
    { id: 'personaDescription', name: '用户人格', enabled: true, position: { type: 'relative' }, role: 'system' },
    { id: 'charDescription', name: '角色描述', enabled: true, position: { type: 'relative' }, role: 'system' },
    { id: 'charPersonality', name: '角色性格', enabled: true, position: { type: 'relative' }, role: 'system' },
    { id: 'scenario', name: '场景', enabled: true, position: { type: 'relative' }, role: 'system' },
    {
      id: 'worldInfoAfter',
      name: '世界书（角色定义之后）',
      enabled: true,
      position: { type: 'relative' },
      role: 'system',
    },
    { id: 'dialogueExamples', name: '对话示例', enabled: true, position: { type: 'relative' }, role: 'system' },
    { id: 'chatHistory', name: '聊天记录', enabled: true, position: { type: 'relative' }, role: 'system' },
  ],
  prompts_unused: [],
  extensions: { tavern_helper: { scripts: [], variables: {} } },
};

function presetSettingsStore(settingsOverride) {
  var settings = settingsOverride || (D && D.settings) || {};
  if (!Array.isArray(settings.chatCompletionPresets)) settings.chatCompletionPresets = [];
  if (typeof settings.activeChatCompletionPresetName !== 'string') settings.activeChatCompletionPresetName = '';
  if (
    settings.chatCompletionPresetInUse !== null &&
    (!settings.chatCompletionPresetInUse ||
      typeof settings.chatCompletionPresetInUse !== 'object' ||
      Array.isArray(settings.chatCompletionPresetInUse))
  )
    settings.chatCompletionPresetInUse = null;
  if (
    Object.prototype.hasOwnProperty.call(settings, 'chatCompletionPresetDefaultExtensions') &&
    !isObjectRecord(settings.chatCompletionPresetDefaultExtensions)
  )
    delete settings.chatCompletionPresetDefaultExtensions;
  return settings;
}
function presetRows() {
  return presetSettingsStore().chatCompletionPresets;
}
// Stored and imported Prompt bodies belong to the user; updating built-in defaults never rewrites them.
function upgradeStoredCompletionPresets(settings) {
  if (!settings || typeof settings !== 'object') return false;
  var changed = false;
  (Array.isArray(settings.chatCompletionPresets) ? settings.chatCompletionPresets : []).forEach(function (row) {
    if (completionPresetEnsureRegexIds(row && row.preset)) changed = true;
  });
  if (completionPresetEnsureRegexIds(settings.chatCompletionPresetInUse)) changed = true;
  if (completionPresetEnsureRegexIds({ extensions: settings.chatCompletionPresetDefaultExtensions })) changed = true;
  return changed;
}
// Hand-written and third-party presets may hold regex rows without an id; ST gives such a script one
// when it first lists it. Here the row takes an id derived from its slot and content when the preset is
// loaded or imported, so the named row, the active copy and any draft agree on it before a save
// writes it down, and the regex page's switch, edit and delete act on that very row.
function completionPresetEnsureRegexIds(raw) {
  var extensions = raw && raw.extensions,
    rows =
      isObjectRecord(extensions) && Array.isArray(extensions.regex_scripts)
        ? extensions.regex_scripts
        : [],
    changed = false;
  rows.forEach(function (row, index) {
    if (!isObjectRecord(row) || String(row.id == null ? '' : row.id).trim()) return;
    var text = index + ':' + JSON.stringify(row),
      hash = 2166136261;
    for (var i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    row.id = 'regex_' + index + '_' + (hash >>> 0).toString(36);
    changed = true;
  });
  return changed;
}
function presetNamedRow(name) {
  return (
    presetRows().find(function (row) {
      return row && String(row.name || '') === String(name || '');
    }) || null
  );
}
function completionPresetImportRaw(name, raw, rows) {
  if (
    Array.isArray(raw) &&
    raw.length &&
    raw.every(function (item) {
      return item && typeof item === 'object' && ('findRegex' in item || 'scriptName' in item);
    })
  )
    throw new Error('这是 ST Regex 脚本列表，不是聊天补全预设；预设面板不会把它当提示词执行');
  if (!raw || Array.isArray(raw) || !Array.isArray(raw.prompts) || !Array.isArray(raw.prompt_order))
    throw new Error('这不是 ST Chat Completion 预设（需要 prompts 和 prompt_order）');
  rows = Array.isArray(rows) ? rows : presetRows();
  if (
    rows.some(function (row) {
      return String((row && row.name) || '') === String(name || '');
    })
  )
    throw new Error('已有同名预设');
  var stored = { name: String(name || ''), preset: cloneData(raw) },
    notices = [];
  completionPresetEnsureRegexIds(stored.preset);
  if (presetEnsureGlobalOrderRow(stored.preset))
    notices.push('该预设没有全局顺序行（character_id 100001），已按 SillyTavern 默认顺序补全；原有顺序行保留不变');
  rows.push(stored);
  return { row: stored, notices: notices };
}
function completionPresetExportRaw(name, rows) {
  rows = Array.isArray(rows) ? rows : presetRows();
  var row = rows.find(function (item) {
    return String((item && item.name) || '') === String(name || '');
  });
  if (!row) throw new Error("预设 '" + name + "' 不存在");
  return cloneData(row.preset);
}
function completionPresetToggleRawOrder(raw, index, enabled) {
  var order = presetOrderRow(raw);
  if (!order || !order.order[index]) return false;
  order.order[index].enabled = enabled !== false;
  return true;
}
function completionPresetVisibleOrderIndexes(raw) {
  var orderRow = presetOrderRow(raw),
    order = Array.isArray(orderRow && orderRow.order) ? orderRow.order : [],
    prompts = Array.isArray(raw && raw.prompts) ? raw.prompts : [],
    definitions = new Map();
  prompts.forEach(function (prompt) {
    var id = String((prompt && prompt.identifier) || '');
    if (id && !definitions.has(id)) definitions.set(id, prompt);
  });
  return order
    .map(function (item, index) {
      var prompt = definitions.get(String((item && item.identifier) || ''));
      return prompt && !(prompt.marker === true && !PRESET_PLACEHOLDER_IDS.includes(String(prompt.identifier || '')))
        ? index
        : -1;
    })
    .filter(function (index) {
      return index >= 0;
    });
}
function completionPresetMoveVisibleRawOrder(raw, index, delta) {
  var order = presetOrderRow(raw),
    prompts = Array.isArray(raw && raw.prompts) ? raw.prompts : [],
    current = order && order.order[index],
    definition = prompts.find(function (prompt) {
      return String((prompt && prompt.identifier) || '') === String((current && current.identifier) || '');
    }),
    visible = completionPresetVisibleOrderIndexes(raw),
    position = visible.indexOf(index),
    targetPosition = position + delta;
  if (
    !order ||
    !definition ||
    definition.marker === true ||
    position < 0 ||
    targetPosition < 0 ||
    targetPosition >= visible.length
  )
    return false;
  var target = visible[targetPosition],
    item = order.order.splice(index, 1)[0];
  if (index < target) target--;
  order.order.splice(delta < 0 ? target : target + 1, 0, item);
  return true;
}
// A preset's own entry, as opposed to a placeholder or a built-in slot: only these may be parked or deleted.
function completionPresetCustomDefinition(raw, index) {
  var prompt = Array.isArray(raw && raw.prompts) ? raw.prompts[index] : null,
    identifier = String((prompt && prompt.identifier) || '');
  return prompt && prompt.marker !== true && !PRESET_BUILTIN_SLOT_IDS.includes(identifier) ? prompt : null;
}
function completionPresetRemoveActivePromptReferences(raw, identifier) {
  var order = presetOrderRow(raw);
  if (!order || !Array.isArray(order.order)) return false;
  var before = order.order.length;
  order.order = order.order.filter(function (item) {
    return String((item && item.identifier) || '') !== String(identifier || '');
  });
  return order.order.length !== before;
}
function completionPresetUnusedOrderStash(raw, create) {
  var extensions = raw && raw.extensions,
    yeyu = extensions && extensions.yeyu,
    stash = yeyu && yeyu.promptOrderStash;
  if (Array.isArray(stash) || !create) return Array.isArray(stash) ? stash : null;
  if (
    !raw ||
    (extensions != null && (typeof extensions !== 'object' || Array.isArray(extensions))) ||
    (yeyu != null && (typeof yeyu !== 'object' || Array.isArray(yeyu))) ||
    stash != null
  )
    return null;
  if (!extensions) extensions = raw.extensions = {};
  if (!yeyu) yeyu = extensions.yeyu = {};
  return (yeyu.promptOrderStash = []);
}
function completionPresetClearUnusedOrderStash(raw, identifier) {
  var stash = completionPresetUnusedOrderStash(raw, false);
  if (!stash) return [];
  identifier = String(identifier || '');
  var index = stash.findIndex(function (row) {
      return String((row && row.identifier) || '') === identifier;
    }),
    entries = index >= 0 && Array.isArray(stash[index].entries) ? stash[index].entries.map(cloneData) : [];
  if (index >= 0) stash.splice(index, 1);
  if (!stash.length) {
    var extensions = raw.extensions,
      yeyu = extensions && extensions.yeyu;
    if (yeyu && typeof yeyu === 'object' && !Array.isArray(yeyu)) {
      delete yeyu.promptOrderStash;
      if (!Object.keys(yeyu).length) delete extensions.yeyu;
    }
    if (extensions && typeof extensions === 'object' && !Array.isArray(extensions) && !Object.keys(extensions).length)
      delete raw.extensions;
  }
  return entries;
}
function completionPresetMoveRawPromptToUnused(raw, index) {
  var prompt = completionPresetCustomDefinition(raw, index),
    order = prompt && presetOrderRow(raw),
    identifier = String((prompt && prompt.identifier) || ''),
    removed =
      order && Array.isArray(order.order)
        ? order.order.filter(function (item) {
            return String((item && item.identifier) || '') === identifier;
          })
        : [];
  if (!removed.length) return false;
  completionPresetClearUnusedOrderStash(raw, identifier);
  var stash = completionPresetUnusedOrderStash(raw, true);
  if (!stash) return false;
  stash.push({ identifier: identifier, entries: removed.map(cloneData) });
  completionPresetRemoveActivePromptReferences(raw, identifier);
  return true;
}
function completionPresetAddUnusedRawPrompt(raw, index) {
  var prompt = Array.isArray(raw && raw.prompts) ? raw.prompts[index] : null,
    order = presetOrderRow(raw);
  if (!prompt) return false;
  if (!order) {
    order = { character_id: 100001, order: [] };
    raw.prompt_order.push(order);
  }
  var entries = completionPresetClearUnusedOrderStash(raw, prompt.identifier);
  if (!entries.length) entries = [{ identifier: String(prompt.identifier || ''), enabled: prompt.enabled !== false }];
  Array.prototype.push.apply(order.order, entries);
  return true;
}
function completionPresetDeleteRawCustomPrompt(raw, index) {
  var prompt = completionPresetCustomDefinition(raw, index);
  if (!prompt) return false;
  Array.prototype.splice.call(raw.prompts, index, 1);
  completionPresetRemoveActivePromptReferences(raw, prompt.identifier);
  completionPresetClearUnusedOrderStash(raw, prompt.identifier);
  return true;
}
function completionPresetInUseRaw(settingsOverride) {
  var s = presetSettingsStore(settingsOverride);
  return s.chatCompletionPresetInUse && typeof s.chatCompletionPresetInUse === 'object'
    ? s.chatCompletionPresetInUse
    : null;
}
// 没有活动 raw 时生效的默认编排：每次由 presetRawDefault() 生成，随版本更新；只有 extensions 换成
// settings.chatCompletionPresetDefaultExtensions——TavernHelper 预设作用域写入的变量、正则和脚本树（DATA_MODEL §2.1.4）。
function completionPresetDefaultRaw(settings) {
  var raw = presetRawDefault(),
    extensions = (settings || presetSettingsStore()).chatCompletionPresetDefaultExtensions;
  if (isObjectRecord(extensions)) raw.extensions = extensions;
  return raw;
}
function activeCompletionPresetRaw(settingsOverride) {
  return completionPresetInUseRaw(settingsOverride) || completionPresetDefaultRaw(settingsOverride);
}
var _completionPresetHostSaveTimer = 0,
  _completionPresetHostSavePending = false;
// TavernHelper preset-scope writes. 'in_use' is the preset in use, like JS-Slash-Runner: the active raw when there is
// one, otherwise the default, whose writes land in its extensions layer so the rest keeps following version updates.
function completionPresetHostWritableRaw(name) {
  name = String(name || 'in_use');
  var settings = presetSettingsStore(),
    row;
  if (name === 'in_use') {
    if (completionPresetInUseRaw()) return settings.chatCompletionPresetInUse;
    if (!isObjectRecord(settings.chatCompletionPresetDefaultExtensions))
      settings.chatCompletionPresetDefaultExtensions = {};
    return completionPresetDefaultRaw(settings);
  }
  row = presetNamedRow(name);
  if (!row) throw new Error("预设 '" + name + "' 不存在");
  return row.preset;
}
function completionPresetSyncHostWrite(name) {
  name = String(name || 'in_use');
  var settings = presetSettingsStore(),
    active = String(settings.activeChatCompletionPresetName || ''),
    row;
  if (name === 'in_use') {
    if (!active || !completionPresetInUseRaw()) return completionPresetSyncDefaultDraft();
    row = presetNamedRow(active);
    if (!row) throw new Error('活动预设没有对应的具名主数据');
    row.preset = cloneData(settings.chatCompletionPresetInUse);
    name = active;
  } else {
    row = presetNamedRow(name);
    if (!row) throw new Error("预设 '" + name + "' 不存在");
    if (active === name) settings.chatCompletionPresetInUse = cloneData(row.preset);
  }
  var rollbackDraft = null;
  if (Array.isArray(_completionPresetDraftRows)) {
    var draft = _completionPresetDraftRows.find(function (item) {
      return item && String(item.name || '') === name;
    });
    if (draft) {
      var beforeDraft = cloneData(draft.preset);
      draft.preset = cloneData(row.preset);
      rollbackDraft = function () {
        draft.preset = beforeDraft;
      };
    }
  }
  return rollbackDraft;
}
// Writes that roll back on failure record the default's extensions layer before the first write may create it.
function completionPresetCaptureDefaultExtensions(journal) {
  journal.capture(presetSettingsStore(), ['chatCompletionPresetDefaultExtensions'], true);
}
// An open prompt manager showing the unnamed default keeps its draft in step with helper writes.
function completionPresetSyncDefaultDraft() {
  if (!Array.isArray(_completionPresetDraftRows) || _completionPresetDraftActive || !_completionPresetDefaultRaw)
    return null;
  var beforeDraft = _completionPresetDefaultRaw;
  _completionPresetDefaultRaw = cloneData(activeCompletionPresetRaw());
  return function () {
    _completionPresetDefaultRaw = beforeDraft;
  };
}
function completionPresetSaveHostWriteDebounced(name) {
  completionPresetSyncHostWrite(name);
  _completionPresetHostSavePending = true;
  clearTimeout(_completionPresetHostSaveTimer);
  _completionPresetHostSaveTimer = setTimeout(completionPresetFlushHostWrite, 1000);
}
function completionPresetFlushHostWrite() {
  if (_completionPresetHostSaveTimer) {
    clearTimeout(_completionPresetHostSaveTimer);
    _completionPresetHostSaveTimer = 0;
  }
  if (!_completionPresetHostSavePending) return null;
  _completionPresetHostSavePending = false;
  var pending = Promise.resolve(saveData('meta'));
  pending.catch(function (error) {
    if (typeof toast === 'function') toast('预设脚本数据保存失败：' + String((error && error.message) || error), 'err');
  });
  return pending;
}
function presetUuid() {
  try {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (_) {}
  return (
    'preset_prompt_' +
    (typeof uid === 'function' ? uid() : Date.now().toString(36) + Math.random().toString(36).slice(2))
  );
}
function presetOrderRow(raw) {
  return (
    (Array.isArray(raw && raw.prompt_order) ? raw.prompt_order : []).find(function (row) {
      return Number(row && row.character_id) === 100001;
    }) || null
  );
}
// SillyTavern PromptManager.sanitizeServiceSettings gives a Chat Completion preset without the global
// (character_id 100001) order row promptManagerDefaultPromptOrder; other rows such as 100000 are never read.
var PRESET_ST_DEFAULT_PROMPT_ORDER = [
  { identifier: 'main', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'personaDescription', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'charPersonality', enabled: true },
  { identifier: 'scenario', enabled: true },
  { identifier: 'enhanceDefinitions', enabled: false },
  { identifier: 'nsfw', enabled: true },
  { identifier: 'worldInfoAfter', enabled: true },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true },
  { identifier: 'jailbreak', enabled: true },
];
function presetEnsureGlobalOrderRow(raw) {
  if (presetOrderRow(raw)) return false;
  raw.prompt_order.push({ character_id: 100001, order: cloneData(PRESET_ST_DEFAULT_PROMPT_ORDER) });
  return true;
}
// SillyTavern PromptManager.getPromptCollection/shouldTrigger: a non-empty injection_trigger limits a prompt
// to the listed generation types. Yeyu's new message is ST's unset (normal) type, and a card-frontend
// generate() is normal too because TavernHelper always assembles it with type 'normal'.
function presetGenerationType(mode) {
  var type = String(mode || 'normal')
    .toLowerCase()
    .trim();
  return type === 'new' || type === 'card-frontend' ? 'normal' : type;
}
function presetPromptTriggered(prompt, mode) {
  var triggers = prompt && prompt.injection_trigger;
  return !Array.isArray(triggers) || !triggers.length || triggers.includes(presetGenerationType(mode));
}
function presetPromptEnabled(prompt, order) {
  var row = (order || []).find(function (item) {
    return String((item && item.identifier) || '') === String((prompt && prompt.identifier) || '');
  });
  return row && row.enabled !== undefined ? row.enabled !== false : prompt && prompt.enabled !== false;
}
function presetPromptPosition(raw) {
  return Number(raw && raw.injection_position) === 1
    ? { type: 'in_chat', depth: Number(raw.injection_depth ?? 4), order: Number(raw.injection_order ?? 100) }
    : { type: 'relative' };
}
function presetRawNumber(raw, liveKey, storedKey, inUse) {
  var key = inUse && Object.prototype.hasOwnProperty.call(raw || {}, liveKey) ? liveKey : storedKey;
  return Number(raw && raw[key]);
}
function presetRawPromptToHelper(raw, order) {
  var id = String((raw && raw.identifier) || presetUuid()),
    system = raw && raw.system_prompt === true && raw.marker !== true,
    placeholder = raw && raw.marker === true,
    normal = !system && !placeholder,
    prompt = {
      id: id,
      name: String((raw && raw.name) || 'unnamed'),
      enabled: presetPromptEnabled(raw, order),
      role: ['system', 'user', 'assistant'].includes(raw && raw.role) ? raw.role : 'system',
    };
  if (normal || placeholder) prompt.position = presetPromptPosition(raw);
  if (normal || system) prompt.content = String((raw && raw.content) || '');
  if (raw && raw.extra) prompt.extra = cloneData(raw.extra);
  return prompt;
}
function presetRegexToHelper(script) {
  script = script || {};
  var placements = Array.isArray(script.placement) ? script.placement : [];
  return {
    id: String(script.id || ''),
    script_name: String(script.scriptName || ''),
    enabled: script.disabled !== true,
    find_regex: String(script.findRegex || ''),
    trim_strings: Array.isArray(script.trimStrings) ? cloneData(script.trimStrings) : [],
    replace_string: String(script.replaceString || ''),
    source: {
      user_input: placements.includes(1),
      ai_output: placements.includes(2),
      slash_command: placements.includes(3),
      world_info: placements.includes(5),
      reasoning: placements.includes(6),
    },
    destination: { display: script.markdownOnly === true, prompt: script.promptOnly === true },
    run_on_edit: script.runOnEdit === true,
    min_depth: Number.isFinite(script.minDepth) ? script.minDepth : null,
    max_depth: Number.isFinite(script.maxDepth) ? script.maxDepth : null,
  };
}
function presetRegexToRaw(script) {
  script = script || {};
  var source = script.source || {},
    placements = [];
  if (source.user_input) placements.push(1);
  if (source.ai_output) placements.push(2);
  if (source.slash_command) placements.push(3);
  if (source.world_info) placements.push(5);
  if (source.reasoning) placements.push(6);
  return {
    id: String(script.id || presetUuid()),
    scriptName: String(script.script_name || ''),
    disabled: script.enabled === false,
    findRegex: String(script.find_regex || ''),
    replaceString: String(script.replace_string || ''),
    trimStrings: Array.isArray(script.trim_strings) ? cloneData(script.trim_strings) : [],
    placement: placements,
    markdownOnly: Boolean(script.destination && script.destination.display),
    promptOnly: Boolean(script.destination && script.destination.prompt),
    runOnEdit: Boolean(script.run_on_edit),
    substituteRegex: 0,
    minDepth: Number.isFinite(script.min_depth) ? script.min_depth : null,
    maxDepth: Number.isFinite(script.max_depth) ? script.max_depth : null,
  };
}
function presetRawToHelper(raw, options) {
  raw = raw && typeof raw === 'object' ? raw : {};
  options = options || {};
  var inUse = options.inUse === true,
    orderRow = presetOrderRow(raw),
    order = Array.isArray(orderRow && orderRow.order) ? orderRow.order : [],
    all = (Array.isArray(raw.prompts) ? raw.prompts : []).map(function (prompt) {
      return presetRawPromptToHelper(prompt, order);
    }),
    usedIds = order.map(function (row) {
      return String((row && row.identifier) || '');
    }),
    seenUsed = new Set(),
    used = usedIds
      .map(function (id) {
        if (seenUsed.has(id)) return null;
        seenUsed.add(id);
        return all.find(function (prompt) {
          return prompt.id === id;
        });
      })
      .filter(Boolean),
    unused = all.filter(function (prompt) {
      return !seenUsed.has(prompt.id);
    }),
    extensions = cloneData(raw.extensions || {});
  if (Array.isArray(extensions.regex_scripts))
    extensions.regex_scripts = extensions.regex_scripts.map(presetRegexToHelper);
  var imageEnabled =
    raw.image_inlining === true ||
    raw.media_inlining === 'auto' ||
    raw.media_inlining === 'images' ||
    raw.media_inlining === 'all';
  return {
    settings: {
      max_context: Number(raw.openai_max_context),
      max_completion_tokens: Number(raw.openai_max_tokens),
      reply_count: Number(raw.n),
      should_stream: Boolean(raw.stream_openai),
      temperature: presetRawNumber(raw, 'temp_openai', 'temperature', inUse),
      frequency_penalty: presetRawNumber(raw, 'freq_pen_openai', 'frequency_penalty', inUse),
      presence_penalty: presetRawNumber(raw, 'pres_pen_openai', 'presence_penalty', inUse),
      repetition_penalty: presetRawNumber(raw, 'repetition_penalty_openai', 'repetition_penalty', inUse),
      top_p: presetRawNumber(raw, 'top_p_openai', 'top_p', inUse),
      min_p: presetRawNumber(raw, 'min_p_openai', 'min_p', inUse),
      top_k: presetRawNumber(raw, 'top_k_openai', 'top_k', inUse),
      top_a: presetRawNumber(raw, 'top_a_openai', 'top_a', inUse),
      seed: Number(raw.seed),
      squash_system_messages: Boolean(raw.squash_system_messages),
      reasoning_effort: String(raw.reasoning_effort || 'auto'),
      request_thoughts: Boolean(raw.show_thoughts),
      request_images: Boolean(raw.request_images),
      enable_web_search: Boolean(raw.enable_web_search),
      allow_sending_images: imageEnabled ? String(raw.inline_image_quality || 'auto') : 'disabled',
      allow_sending_videos:
        Boolean(raw.video_inlining) || raw.media_inlining === 'videos' || raw.media_inlining === 'all',
      character_name_prefix:
        { '-1': 'none', '0': 'default', '1': 'completion', '2': 'content' }[String(raw.names_behavior)] || 'none',
      wrap_user_messages_in_quotes: Boolean(raw.wrap_in_quotes),
    },
    prompts: used,
    prompts_unused: unused,
    extensions: extensions,
  };
}
function presetEnsureUniquePrompts(preset) {
  var seen = new Set();
  function rows(source) {
    return (Array.isArray(source) ? source : []).map(function (value) {
      var prompt = Object.assign({}, value || {}),
        id = String(prompt.id || presetUuid());
      if (seen.has(id)) {
        if (!isPresetNormalPrompt({ id: id })) throw new Error("修改的预设中存在重复的系统/占位提示词 '" + id + "'");
        id = presetUuid();
      }
      seen.add(id);
      prompt.id = id;
      return prompt;
    });
  }
  preset.prompts = rows(preset.prompts);
  preset.prompts_unused = rows(preset.prompts_unused);
  return preset;
}
function presetHelperPromptToRaw(prompt) {
  var normal = isPresetNormalPrompt(prompt),
    system = isPresetSystemPrompt(prompt),
    placeholder = isPresetPlaceholderPrompt(prompt),
    raw = {
      identifier: String(prompt.id),
      name: String(prompt.name || 'unnamed'),
      enabled: prompt.enabled !== false,
      role: ['system', 'user', 'assistant'].includes(prompt.role) ? prompt.role : 'system',
    };
  if ((normal || placeholder) && !['dialogueExamples', 'chatHistory'].includes(String(prompt.id))) {
    raw.injection_position = prompt.position && prompt.position.type === 'in_chat' ? 1 : 0;
    raw.injection_depth = Number((prompt.position && prompt.position.depth) ?? 4);
    raw.injection_order = Number((prompt.position && prompt.position.order) ?? 100);
  }
  if (normal || system) raw.content = String(prompt.content || '');
  raw.system_prompt = system || placeholder;
  raw.marker = placeholder;
  if (prompt.extra) raw.extra = cloneData(prompt.extra);
  raw.forbid_overrides = false;
  return raw;
}
function presetPatchRawPrompt(source, prompt) {
  var next = source ? cloneData(source) : presetHelperPromptToRaw(prompt),
    before = source ? presetRawPromptToHelper(source, []) : null;
  if (!source) return next;
  if (String(prompt.id) !== before.id) next.identifier = String(prompt.id);
  if (String(prompt.name || 'unnamed') !== before.name) next.name = String(prompt.name || 'unnamed');
  if (String(prompt.role || 'system') !== before.role)
    next.role = ['system', 'user', 'assistant'].includes(prompt.role) ? prompt.role : 'system';
  if (
    Object.prototype.hasOwnProperty.call(prompt, 'content') &&
    String(prompt.content || '') !== String(before.content || '')
  )
    next.content = String(prompt.content || '');
  if (JSON.stringify(prompt.extra) !== JSON.stringify(before.extra)) {
    if (prompt.extra === undefined) delete next.extra;
    else next.extra = cloneData(prompt.extra);
  }
  var position = prompt.position || { type: 'relative' },
    oldPosition = before.position || { type: 'relative' };
  if (JSON.stringify(position) !== JSON.stringify(oldPosition)) {
    next.injection_position = position.type === 'in_chat' ? 1 : 0;
    next.injection_depth = Number(position.depth ?? 4);
    next.injection_order = Number(position.order ?? 100);
  }
  return next;
}
function presetPatchRegexRows(sourceRows, helperRows) {
  var queues = new Map();
  (Array.isArray(sourceRows) ? sourceRows : []).forEach(function (row) {
    var id = String((row && row.id) || ''),
      queue = queues.get(id) || [];
    queue.push(row);
    queues.set(id, queue);
  });
  return (Array.isArray(helperRows) ? helperRows : []).map(function (helper) {
    var queue = queues.get(String((helper && helper.id) || '')) || [],
      source = queue.shift();
    if (!source) return presetRegexToRaw(helper);
    var next = cloneData(source),
      before = presetRegexToHelper(source),
      desired = presetRegexToRaw(helper);
    Object.keys(desired).forEach(function (key) {
      var helperKey = {
        scriptName: 'script_name',
        disabled: 'enabled',
        findRegex: 'find_regex',
        replaceString: 'replace_string',
        trimStrings: 'trim_strings',
        runOnEdit: 'run_on_edit',
        minDepth: 'min_depth',
        maxDepth: 'max_depth',
      }[key];
      if (helperKey && JSON.stringify(helper[helperKey]) === JSON.stringify(before[helperKey])) return;
      if (key === 'placement' && JSON.stringify(helper.source) === JSON.stringify(before.source)) return;
      if (
        (key === 'markdownOnly' || key === 'promptOnly') &&
        JSON.stringify(helper.destination) === JSON.stringify(before.destination)
      )
        return;
      next[key] = cloneData(desired[key]);
    });
    return next;
  });
}
function presetHelperFreshRaw(preset) {
  var settings = preset.settings || {},
    used = preset.prompts || [],
    unused = preset.prompts_unused || [],
    extensions = cloneData(preset.extensions || {});
  if (Array.isArray(extensions.regex_scripts))
    extensions.regex_scripts = extensions.regex_scripts.map(presetRegexToRaw);
  return {
    max_context_unlocked: true,
    openai_max_context: settings.max_context,
    openai_max_tokens: settings.max_completion_tokens,
    n: settings.reply_count,
    stream_openai: settings.should_stream,
    temp_openai: settings.temperature,
    freq_pen_openai: settings.frequency_penalty,
    pres_pen_openai: settings.presence_penalty,
    top_p_openai: settings.top_p,
    repetition_penalty_openai: settings.repetition_penalty,
    min_p_openai: settings.min_p,
    top_k_openai: settings.top_k,
    top_a_openai: settings.top_a,
    temperature: settings.temperature,
    frequency_penalty: settings.frequency_penalty,
    presence_penalty: settings.presence_penalty,
    top_p: settings.top_p,
    repetition_penalty: settings.repetition_penalty,
    min_p: settings.min_p,
    top_k: settings.top_k,
    top_a: settings.top_a,
    seed: settings.seed,
    squash_system_messages: settings.squash_system_messages,
    reasoning_effort: settings.reasoning_effort,
    show_thoughts: settings.request_thoughts,
    request_images: settings.request_images,
    enable_web_search: settings.enable_web_search,
    image_inlining: settings.allow_sending_images !== 'disabled',
    inline_image_quality: settings.allow_sending_images === 'disabled' ? 'auto' : settings.allow_sending_images,
    video_inlining: settings.allow_sending_videos,
    names_behavior: { none: -1, default: 0, completion: 1, content: 2 }[settings.character_name_prefix],
    wrap_in_quotes: settings.wrap_user_messages_in_quotes,
    prompts: used.concat(unused).map(presetHelperPromptToRaw),
    prompt_order: [
      {
        character_id: 100001,
        order: used.map(function (prompt) {
          return { identifier: String(prompt.id), enabled: prompt.enabled !== false };
        }),
      },
    ],
    extensions: extensions,
  };
}
function presetHelperToRaw(preset, base) {
  preset = presetEnsureUniquePrompts(preset);
  var settings = preset.settings || {},
    used = preset.prompts || [],
    unused = preset.prompts_unused || [],
    extensions = cloneData(preset.extensions || {});
  if (!base) return presetHelperFreshRaw(preset);
  var next = cloneData(base),
    baseHelper = presetRawToHelper(base),
    all = used.concat(unused),
    helperQueues = new Map(),
    consumed = new Set();
  all.forEach(function (prompt) {
    var id = String((prompt && prompt.id) || ''),
      queue = helperQueues.get(id) || [];
    queue.push(prompt);
    helperQueues.set(id, queue);
  });
  next.prompts = (Array.isArray(base.prompts) ? base.prompts : [])
    .map(function (source) {
      var id = String((source && source.identifier) || ''),
        queue = helperQueues.get(id) || [],
        prompt = queue.shift();
      if (!prompt) return null;
      consumed.add(prompt);
      return presetPatchRawPrompt(source, prompt);
    })
    .filter(Boolean);
  all.forEach(function (prompt) {
    if (!consumed.has(prompt)) next.prompts.push(presetPatchRawPrompt(null, prompt));
  });
  var active = presetOrderRow(next),
    baseActive = presetOrderRow(base),
    definedIds = new Set(
      (base.prompts || []).map(function (row) {
        return String((row && row.identifier) || '');
      })
    ),
    desiredIds = used.map(function (prompt) {
      return String((prompt && prompt.id) || '');
    }),
    desiredSet = new Set(desiredIds),
    helperById = new Map();
  used.forEach(function (prompt) {
    if (!helperById.has(String(prompt.id))) helperById.set(String(prompt.id), prompt);
  });
  var orderQueues = new Map();
  (Array.isArray(baseActive && baseActive.order) ? baseActive.order : []).forEach(function (row) {
    var id = String((row && row.identifier) || ''),
      queue = orderQueues.get(id) || [];
    queue.push(row);
    orderQueues.set(id, queue);
  });
  var ordered = [];
  desiredIds.forEach(function (id) {
    var queue = orderQueues.get(id) || [],
      rows = queue.length ? queue.splice(0) : [{ identifier: id, enabled: true }],
      prompt = helperById.get(id);
    rows.forEach(function (row) {
      var copy = cloneData(row);
      copy.enabled = prompt && prompt.enabled !== false;
      ordered.push(copy);
    });
  });
  var cursor = 0,
    rebuilt = [];
  (Array.isArray(baseActive && baseActive.order) ? baseActive.order : []).forEach(function (row) {
    var id = String((row && row.identifier) || '');
    if (!definedIds.has(id) && !desiredSet.has(id)) rebuilt.push(cloneData(row));
    else if (cursor < ordered.length) rebuilt.push(ordered[cursor++]);
  });
  while (cursor < ordered.length) rebuilt.push(ordered[cursor++]);
  if (active) active.order = rebuilt;
  else {
    if (!Array.isArray(next.prompt_order)) next.prompt_order = [];
    next.prompt_order.push({ character_id: 100001, order: rebuilt });
  }
  if (!next.extensions || typeof next.extensions !== 'object' || Array.isArray(next.extensions)) next.extensions = {};
  Object.keys(extensions).forEach(function (key) {
    if (key === 'regex_scripts')
      next.extensions.regex_scripts = presetPatchRegexRows(
        base.extensions && base.extensions.regex_scripts,
        extensions.regex_scripts
      );
    else next.extensions[key] = cloneData(extensions[key]);
  });
  Object.keys(next.extensions).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(extensions, key)) delete next.extensions[key];
  });
  var generated = presetHelperFreshRaw(preset),
    settingMap = {
      max_context: 'openai_max_context',
      max_completion_tokens: 'openai_max_tokens',
      reply_count: 'n',
      should_stream: 'stream_openai',
      temperature: 'temperature',
      frequency_penalty: 'frequency_penalty',
      presence_penalty: 'presence_penalty',
      repetition_penalty: 'repetition_penalty',
      top_p: 'top_p',
      min_p: 'min_p',
      top_k: 'top_k',
      top_a: 'top_a',
      seed: 'seed',
      squash_system_messages: 'squash_system_messages',
      reasoning_effort: 'reasoning_effort',
      request_thoughts: 'show_thoughts',
      request_images: 'request_images',
      enable_web_search: 'enable_web_search',
      character_name_prefix: 'names_behavior',
      wrap_user_messages_in_quotes: 'wrap_in_quotes',
    };
  Object.keys(settingMap).forEach(function (key) {
    if (JSON.stringify(settings[key]) === JSON.stringify(baseHelper.settings[key])) return;
    var rawKey = settingMap[key],
      value = generated[rawKey];
    if (value === undefined) delete next[rawKey];
    else next[rawKey] = cloneData(value);
  });
  return next;
}
var PRESET_CARD_OVERRIDE_SLOT_NAMES = { main: '主提示词', jailbreak: '发送后指令' };
// main / jailbreak ship empty so a card's system_prompt / post_history_instructions fill them.
function presetRawCardOverrideSlot(identifier) {
  return {
    identifier: identifier,
    name: PRESET_CARD_OVERRIDE_SLOT_NAMES[identifier],
    system_prompt: true,
    role: 'system',
    content: '',
    marker: false,
  };
}
function presetRawPlaceholder(identifier) {
  return { identifier: identifier, name: PRESET_PLACEHOLDER_ST_NAMES[identifier], system_prompt: true, marker: true };
}
function presetRawWithOrder(prompts, order, disabled) {
  disabled = disabled || [];
  return {
    prompts: prompts,
    prompt_order: [
      {
        character_id: 100001,
        order: order.map(function (identifier) {
          return { identifier: identifier, enabled: !disabled.includes(identifier) };
        }),
      },
    ],
    wi_format: DEFAULT_WI_FORMAT,
    personality_format: DEFAULT_PERSONALITY_FORMAT,
    scenario_format: DEFAULT_SCENARIO_FORMAT,
    continue_nudge_prompt: DEFAULT_CONTINUATION_POST_HISTORY_TPL,
    impersonation_prompt: DEFAULT_IMPERSONATION_PROMPT,
    assistant_prefill: '',
  };
}
// A new preset starts from SillyTavern's bare structure: its default order without the preset-owned slots, that is
// the placeholders plus the card-overridable slots, with no prompt text. Formats and utility prompts keep Yeyu's defaults.
function presetRawSkeleton() {
  return presetRawWithOrder(
    PRESET_CARD_OVERRIDE_SLOT_IDS.map(presetRawCardOverrideSlot).concat(
      PRESET_PLACEHOLDER_IDS.map(presetRawPlaceholder)
    ),
    PRESET_ST_DEFAULT_PROMPT_ORDER.map(function (item) {
      return item.identifier;
    }).filter(function (identifier) {
      return PRESET_CARD_OVERRIDE_SLOT_IDS.includes(identifier) || PRESET_PLACEHOLDER_IDS.includes(identifier);
    })
  );
}
var PRESET_RAW_ALL_TRIGGERS = ['normal', 'continue', 'swipe', 'regenerate', 'quiet', 'impersonate'];
// The two prompts that carry the card's main and post-history text; the same fields as a placeholder plus text and triggers.
function presetRawSlot(identifier, name, content) {
  return {
    identifier: identifier,
    name: name,
    system_prompt: true,
    role: 'system',
    content: content,
    marker: false,
    injection_trigger: PRESET_RAW_ALL_TRIGGERS.slice(),
  };
}
function presetRawInjection(identifier, name, role, content, triggers) {
  return {
    identifier: identifier,
    name: name,
    role: role,
    content: content,
    system_prompt: false,
    marker: false,
    injection_position: 0,
    injection_depth: 4,
    injection_order: 100,
    forbid_overrides: false,
    injection_trigger: (triggers || PRESET_RAW_ALL_TRIGGERS).slice(),
  };
}
function presetRawDefault() {
  return {
    prompts: [
      presetRawSlot('main', '📌 主提示词', ''),
      presetRawSlot('jailbreak', '📌 发送后指令', DEFAULT_POST_HISTORY_PROMPT),
      presetRawPlaceholder('worldInfoBefore'),
      presetRawPlaceholder('personaDescription'),
      presetRawPlaceholder('charDescription'),
      presetRawPlaceholder('charPersonality'),
      presetRawPlaceholder('scenario'),
      presetRawPlaceholder('worldInfoAfter'),
      presetRawPlaceholder('dialogueExamples'),
      presetRawPlaceholder('chatHistory'),
      presetRawInjection('d9666911-9f85-4e95-bf7c-cf22f4b7b3ae', '📌 前置', 'system', DEFAULT_CARD_OPEN_TAG),
      presetRawInjection('41f64106-2525-4ad2-879e-6857dd9ef0ec', '📌 过度', 'system', DEFAULT_CARD_TRANSITION_PROMPT),
      presetRawInjection('5a922849-32df-4564-8a5d-f58b2470f1d9', '📌 结束', 'system', DEFAULT_CARD_CLOSE_TAG),
      presetRawInjection('646238cc-dabb-43e5-a238-7c59b6c5a29b', '🎯 执行参数', 'system', DEFAULT_TURN_PARAMS_PROMPT),
      presetRawInjection('a934a37a-ae35-4423-8fbb-abcb682b1b49', '📚 语言与格式规范', 'system', DEFAULT_LANGUAGE_FORMAT_PROMPT),
      presetRawInjection('7b418fd2-852b-491c-9ea2-1dc7af43a383', '🔒 执行原则', 'system', DEFAULT_CARD_EXECUTION_PROMPT),
      presetRawInjection('f953be97-c411-43db-a744-1fe66511489e', '❌ 防抢话（二选一）', 'system', DEFAULT_USER_STRICT_PROMPT, ['normal', 'continue', 'swipe', 'regenerate', 'quiet']),
      presetRawInjection('8944a336-d6d9-48c7-8918-f909fbcbea96', '✔️ 抢话（二选一）', 'system', DEFAULT_USER_TAKEOVER_PROMPT, ['normal', 'continue', 'swipe', 'regenerate', 'quiet']),
      presetRawInjection('f29a122d-02f4-4871-85f1-059a9d8304a8', '🧠 回复前构思', 'system', DEFAULT_PRE_REPLY_PROMPT),
      presetRawInjection('76258373-0ab3-419d-ae9e-365bd721ea80', '🪪 二次强化', 'user', DEFAULT_AUX_PROMPT),
      presetRawInjection('cd553846-565c-440a-85f8-5ad3adf26d41', '🪪 确认身份', 'assistant', DEFAULT_ENHANCE_PROMPT),
      presetRawInjection('785b0a28-36f7-4b16-9ef7-64db5e1304e6', '📜 创作框架', 'system', DEFAULT_FRAMEWORK_PROMPT),
      presetRawInjection('53286048-c07b-45c5-8a39-7f6e3566a18c', '🖋️ 通用：写作原则', 'system', DEFAULT_WRITING_PRINCIPLES_PROMPT),
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: '785b0a28-36f7-4b16-9ef7-64db5e1304e6', enabled: true },
          { identifier: '646238cc-dabb-43e5-a238-7c59b6c5a29b', enabled: true },
          { identifier: 'a934a37a-ae35-4423-8fbb-abcb682b1b49', enabled: true },
          { identifier: 'd9666911-9f85-4e95-bf7c-cf22f4b7b3ae', enabled: true },
          { identifier: 'main', enabled: true },
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'personaDescription', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'charPersonality', enabled: true },
          { identifier: 'scenario', enabled: true },
          { identifier: 'worldInfoAfter', enabled: true },
          { identifier: 'dialogueExamples', enabled: true },
          { identifier: '41f64106-2525-4ad2-879e-6857dd9ef0ec', enabled: true },
          { identifier: '76258373-0ab3-419d-ae9e-365bd721ea80', enabled: true },
          { identifier: 'cd553846-565c-440a-85f8-5ad3adf26d41', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: '5a922849-32df-4564-8a5d-f58b2470f1d9', enabled: true },
          { identifier: '53286048-c07b-45c5-8a39-7f6e3566a18c', enabled: true },
          { identifier: 'f953be97-c411-43db-a744-1fe66511489e', enabled: false },
          { identifier: '8944a336-d6d9-48c7-8918-f909fbcbea96', enabled: true },
          { identifier: '7b418fd2-852b-491c-9ea2-1dc7af43a383', enabled: true },
          { identifier: 'f29a122d-02f4-4871-85f1-059a9d8304a8', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ],
    wi_format: DEFAULT_WI_FORMAT,
    personality_format: DEFAULT_PERSONALITY_FORMAT,
    scenario_format: DEFAULT_SCENARIO_FORMAT,
    continue_nudge_prompt: DEFAULT_CONTINUATION_POST_HISTORY_TPL,
    impersonation_prompt: DEFAULT_IMPERSONATION_PROMPT,
    assistant_prefill: '',
    new_chat_prompt: DEFAULT_NEW_CHAT_PROMPT,
    new_example_chat_prompt: DEFAULT_NEW_EXAMPLE_CHAT_PROMPT,
    send_if_empty: '',
  };
}
function getPresetNames() {
  return cloneData(
    ['in_use'].concat(
      presetRows().map(function (row) {
        return String(row.name || '');
      })
    )
  );
}
function getLoadedPresetName() {
  return presetSettingsStore().activeChatCompletionPresetName;
}
function completionPresetAwaitRuntime(live) {
  if (live && _completionPresetRuntimeTransaction && _completionPresetRuntimeTransaction.internalLives.has(live))
    return Promise.reject(
      new Error('预设正在切换，当前预设脚本不能在载入或切换事件内发起生成；请等预设切换完成后重试')
    );
  return _completionPresetRuntimeBarrier;
}
function completionPresetQueueRuntime(callback) {
  var task = _completionPresetRuntimeBarrier.then(callback);
  _completionPresetRuntimeBarrier = task.then(
    function () {
      return true;
    },
    function () {
      return false;
    }
  );
  return task;
}
function completionPresetEventSettingsToUpdate() {
  return cloneData(COMPLETION_PRESET_EVENT_SETTINGS_TO_UPDATE);
}
function completionPresetEventRuntimeSettings(raw) {
  var out = {};
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  Object.keys(COMPLETION_PRESET_EVENT_SETTINGS_TO_UPDATE).forEach(function (presetKey) {
    var settingKey = COMPLETION_PRESET_EVENT_SETTINGS_TO_UPDATE[presetKey][1];
    if (Object.prototype.hasOwnProperty.call(raw, presetKey)) out[settingKey] = cloneData(raw[presetKey]);
  });
  return out;
}
function completionPresetEventRawFromSettings(settings, base) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('保存聊天补全预设失败：settings 必须是对象');
  var raw = base && typeof base === 'object' && !Array.isArray(base) ? cloneData(base) : {};
  Object.keys(COMPLETION_PRESET_EVENT_SETTINGS_TO_UPDATE).forEach(function (presetKey) {
    var settingKey = COMPLETION_PRESET_EVENT_SETTINGS_TO_UPDATE[presetKey][1];
    if (Object.prototype.hasOwnProperty.call(settings, settingKey)) raw[presetKey] = cloneData(settings[settingKey]);
  });
  if (!Array.isArray(raw.prompts) || !Array.isArray(raw.prompt_order))
    throw new Error('保存聊天补全预设失败：settings 缺少 prompts 或 prompt_order');
  return raw;
}
function completionPresetName(settings) {
  return String((settings && settings.activeChatCompletionPresetName) || YEYU_DEFAULT_PRESET_NAME);
}
async function completionPresetStageEventSave(liveSettings, nextSettings, name, eventSettings, onPersist) {
  name = String(name || '').trim();
  if (!name) throw new Error('保存聊天补全预设失败：预设名称不能为空');
  var mutation = createMutationJournal();
  mutation.capture(liveSettings, ['chatCompletionPresets'], true);
  mutation.capture(nextSettings, ['chatCompletionPresets'], true);
  var liveRows = liveSettings.chatCompletionPresets || (liveSettings.chatCompletionPresets = []),
    nextRows = Array.isArray(nextSettings.chatCompletionPresets) ? nextSettings.chatCompletionPresets : null,
    baseRow = (nextRows || liveRows).find(function (item) {
      return String((item && item.name) || '') === name;
    }),
    raw = completionPresetEventRawFromSettings(eventSettings, baseRow && baseRow.preset);
  function write(rows) {
    var row = rows.find(function (item) {
      return String((item && item.name) || '') === name;
    });
    if (row) {
      mutation.capture(row, ['preset'], true);
      row.preset = cloneData(raw);
    } else mutation.splice(rows, rows.length, 0, [{ name: name, preset: cloneData(raw) }]);
  }
  write(liveRows);
  if (nextRows) write(nextRows);
  mutation.seal();
  try {
    if (typeof saveData === 'function') await saveData('meta', { urgent: true });
    if (typeof onPersist === 'function') onPersist(mutation.rollback);
  } catch (error) {
    mutation.rollback();
    throw error;
  }
}
// buildPatch runs inside the queue and returns only the preset-owned settings keys this transaction writes.
function completionPresetApplySettings(buildPatch, name, onSaveError) {
  return completionPresetQueueRuntime(function () {
    return completionPresetApplySettingsInQueue(buildPatch, name, onSaveError);
  });
}
// The transaction body for callers that already hold a completionPresetQueueRuntime slot and must decide
// what to write from the settings they see there; queueing it again from inside the slot would deadlock.
async function completionPresetApplySettingsInQueue(buildPatch, name, onSaveError) {
  var settingsRef = D.settings,
    patch = buildPatch(settingsRef),
    mutation = createMutationJournal(),
    eventRollbacks = [],
    oldName = completionPresetName(settingsRef),
    oldRaw = settingsRef.chatCompletionPresetInUse || completionPresetDefaultRaw(settingsRef),
    pending = cloneData(patch.chatCompletionPresetInUse || completionPresetDefaultRaw(settingsRef)),
    oldLive = typeof _cardScriptLibraryLive !== 'undefined' ? _cardScriptLibraryLive : null,
    transaction = { internalLives: new Set() },
    applied = false,
    persisted = false,
    eventPersisted = false,
    runtimeChanged = false,
    saveError;
  if (oldLive) transaction.internalLives.add(oldLive);
  _completionPresetRuntimeTransaction = transaction;
  var eventData = {
    preset: pending,
    presetName: String(name || YEYU_DEFAULT_PRESET_NAME),
    settingsToUpdate: completionPresetEventSettingsToUpdate(),
    settings: completionPresetEventRuntimeSettings(oldRaw),
    savePreset: function (saveName, settings) {
      return completionPresetStageEventSave(settingsRef, patch, saveName, settings, function (rollback) {
        eventPersisted = true;
        eventRollbacks.push(rollback);
      });
    },
    presetNameBefore: oldName,
  };
  try {
    if (typeof cardScriptLibrarySillyTavernEmitAsync === 'function')
      await cardScriptLibrarySillyTavernEmitAsync('oai_preset_changed_before', [eventData], oldLive);
    else if (typeof cardScriptLibrarySillyTavernEmit === 'function')
      cardScriptLibrarySillyTavernEmit('oai_preset_changed_before', [eventData]);
    patch.chatCompletionPresetInUse = cloneData(eventData.preset);
    var keys = Object.keys(patch);
    mutation.capture(settingsRef, keys, true);
    keys.forEach(function (key) {
      if (JSON.stringify(settingsRef[key]) !== JSON.stringify(patch[key])) settingsRef[key] = cloneData(patch[key]);
    });
    mutation.seal();
    applied = true;
    var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts();
    if (typeof saveData === 'function') {
      try {
        await saveData(sessionsChanged ? ['meta', 'sessions'] : 'meta', { urgent: true });
      } catch (error) {
        saveError = error;
        throw error;
      }
    }
    persisted = true;
    runtimeChanged = true;
    await completionPresetRefreshRuntime(eventData.presetName, transaction);
    return true;
  } catch (error) {
    if (applied || eventPersisted) {
      mutation.rollback();
      eventRollbacks.reverse().forEach(function (rollback) {
        rollback();
      });
      if (runtimeChanged) {
        if (typeof cardScriptLibraryDispose === 'function') cardScriptLibraryDispose();
        var char = typeof getChar === 'function' ? getChar() : null,
          live = char && typeof syncCardScriptLibrary === 'function' ? syncCardScriptLibrary(char) : null;
        if (live && typeof cardScriptLibraryAwaitReady === 'function') await cardScriptLibraryAwaitReady(live);
      }
      if ((persisted || eventPersisted) && typeof saveData === 'function')
        await saveData(['meta', 'sessions'], { urgent: true });
    }
    if (onSaveError && error === saveError) {
      onSaveError(error);
      return false;
    }
    throw error;
  } finally {
    if (_completionPresetRuntimeTransaction === transaction) _completionPresetRuntimeTransaction = null;
  }
}
async function loadPreset(name) {
  var row = presetNamedRow(name);
  if (!row) return false;
  try {
    await completionPresetApplySettings(function () {
      return { activeChatCompletionPresetName: String(row.name), chatCompletionPresetInUse: cloneData(row.preset) };
    }, row.name);
    return true;
  } catch (error) {
    if (typeof toast === 'function') toast('预设切换保存失败，原预设已恢复：' + error.message, 'err');
    return false;
  }
}
function getPreset(name) {
  var inUse = name === 'in_use',
    raw = inUse ? activeCompletionPresetRaw() : (presetNamedRow(name) || {}).preset;
  if (!raw) throw new Error("预设 '" + name + "' 不存在");
  return cloneData(presetRawToHelper(raw, { inUse: inUse }));
}
function completionPresetRawForGeneration(name) {
  name = String(name || 'in_use');
  var raw = name === 'in_use' ? activeCompletionPresetRaw() : (presetNamedRow(name) || {}).preset;
  if (!raw) throw new Error("预设 '" + name + "' 不存在");
  return cloneData(raw);
}
async function createPreset(name, preset) {
  if (getPresetNames().includes(String(name))) return false;
  await createOrReplacePreset(name, preset === undefined ? default_preset : preset);
  return true;
}
async function createOrReplacePreset(name, preset) {
  name = String(name);
  preset = preset === undefined ? default_preset : preset;
  var row = name === 'in_use' ? null : presetNamedRow(name),
    existing = getPresetNames().includes(name),
    base = name === 'in_use' ? activeCompletionPresetRaw() : row && row.preset,
    raw = presetHelperToRaw(preset, base);
  if (name === 'in_use') {
    var settings = presetSettingsStore();
    settings.chatCompletionPresetInUse = raw;
  } else if (row) row.preset = raw;
  else presetRows().push({ name: name, preset: raw });
  await saveData('meta');
  return !existing;
}
async function deletePreset(name) {
  name = String(name);
  var rows = presetRows(),
    index = rows.findIndex(function (row) {
      return String((row && row.name) || '') === name;
    });
  if (index < 0) return false;
  rows.splice(index, 1);
  var s = presetSettingsStore();
  if (s.activeChatCompletionPresetName === name) {
    s.activeChatCompletionPresetName = '';
    s.chatCompletionPresetInUse = null;
  }
  await saveData('meta');
  return true;
}
async function renamePreset(oldName, newName) {
  oldName = String(oldName);
  newName = String(newName);
  var names = getPresetNames(),
    row = presetNamedRow(oldName);
  if (!names.includes(oldName)) return false;
  if (!row || names.includes(newName)) {
    // Official rename semantics for in_use or an existing target: copy without overwriting, then delete the source.
    await createPreset(newName, getPreset(oldName));
    await deletePreset(oldName);
    return true;
  }
  var settings = presetSettingsStore(),
    active = settings.activeChatCompletionPresetName === oldName;
  row.name = newName;
  if (active) settings.activeChatCompletionPresetName = newName;
  try {
    await saveData('meta');
  } catch (error) {
    row.name = oldName;
    if (active) settings.activeChatCompletionPresetName = oldName;
    throw error;
  }
  return true;
}
async function replacePreset(name, preset, options) {
  if (!getPresetNames().includes(String(name))) throw new Error("预设 '" + name + "' 不存在");
  await createOrReplacePreset(name, preset, options);
}
async function updatePresetWith(name, updater, options) {
  if (!getPresetNames().includes(String(name))) throw new Error("预设 '" + name + "' 不存在");
  var updated = await updater(getPreset(name));
  await replacePreset(name, updated, options);
  return updated;
}
function presetDefaultsDeep(target, source) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return target;
  Object.keys(source || {}).forEach(function (key) {
    var value = target[key],
      fallback = source[key];
    if (value === undefined) target[key] = cloneData(fallback);
    else if (
      value &&
      fallback &&
      typeof value === 'object' &&
      typeof fallback === 'object' &&
      !Array.isArray(value) &&
      !Array.isArray(fallback)
    )
      presetDefaultsDeep(value, fallback);
  });
  return target;
}
async function setPreset(name, partial, options) {
  partial = partial || {};
  return updatePresetWith(
    name,
    function (old) {
      var settings =
          partial.settings === undefined ? cloneData(old.settings) : presetDefaultsDeep(partial.settings, old.settings),
        extensions =
          partial.extensions === undefined
            ? cloneData(old.extensions)
            : presetDefaultsDeep(partial.extensions, old.extensions);
      return {
        settings: settings,
        prompts: partial.prompts === undefined ? old.prompts : partial.prompts,
        prompts_unused: partial.prompts_unused === undefined ? old.prompts_unused : partial.prompts_unused,
        extensions: extensions,
      };
    },
    options
  );
}

function presetRequestSettings(route, rawOverride) {
  var source = (D && D.settings) || {},
    task = typeof route === 'string' ? route : String((route && route.task) || 'chat'),
    // 代拟与主对话挂载同一份活动预设，只在模型路由上分开。
    raw =
      task === 'chat' || task === 'impersonate'
        ? arguments.length > 1
          ? rawOverride
          : activeCompletionPresetRaw()
        : null;
  if (!raw) return source;
  var next = Object.assign({}, source);
  next._completionPresetActive = true;
  next._completionPresetRaw = raw;
  return next;
}
function presetStageSlice(messages, stages, start, end) {
  var a = stages.find(function (row) {
      return row.id === start;
    }),
    b = stages.find(function (row) {
      return row.id === end;
    }),
    from = a ? Number(a.messageIndex) || 0 : 0,
    to = b ? Number(b.messageIndex) || 0 : messages.length;
  return messages.slice(from, to).map(function (row) {
    var copy = { role: row.role, content: row.content };
    if (row.name) copy.name = row.name;
    if (row.identifier) copy.identifier = row.identifier;
    if (row._yeyuConversation === true) copy._yeyuConversation = true;
    if (row._yeyuPresetSupplemental === true) copy._yeyuPresetSupplemental = true;
    if (row._yeyuPresetPostEverything === true) copy._yeyuPresetPostEverything = true;
    if (row._yeyuRisuLiteral === true) copy._yeyuRisuLiteral = true;
    if (row._yeyuGenerationImageKey) copy._yeyuGenerationImageKey = String(row._yeyuGenerationImageKey);
    return copy;
  });
}
function presetApplyRole(messages, role) {
  return (messages || [])
    .map(function (message) {
      var copy = {
        role: ['system', 'user', 'assistant'].includes(role) ? role : message.role,
        content: String(message.content || ''),
      };
      if (message.name) copy.name = message.name;
      if (message.identifier) copy.identifier = message.identifier;
      return copy;
    })
    .filter(function (message) {
      return !!message.content;
    });
}
function presetInsertInChat(messages, rows) {
  var output = messages.slice(),
    floor = 0,
    groups = {};
  (rows || []).forEach(function (row, index) {
    if (!row || !String(row.content || '')) return;
    var depth = Math.max(0, Number(row.depth) || 0),
      order = Number(row.order) || 0,
      role = ['system', 'user', 'assistant'].includes(row.role) ? row.role : 'system',
      key = depth + '\u0000' + order + '\u0000' + role;
    (
      groups[key] || (groups[key] = { depth: depth, order: order, role: role, index: index, contents: [] })
    ).contents.push(String(row.content));
  });
  Object.keys(groups)
    .map(function (key) {
      return groups[key];
    })
    .sort(function (a, b) {
      return (
        b.depth - a.depth ||
        a.order - b.order ||
        { assistant: 0, user: 1, system: 2 }[a.role] - { assistant: 0, user: 1, system: 2 }[b.role] ||
        a.index - b.index
      );
    })
    .forEach(function (group) {
      var at = Math.max(floor, output.length - group.depth);
      output.splice(at, 0, { role: group.role, content: group.contents.join('\n') });
    });
  return output;
}
function presetEstimateText(value) {
  value = String(value || '').replace(/\{\{\s*(?:setvar|setglobalvar)\s*(?:::|\s)[\s\S]*?\}\}/gi, '');
  return value ? (typeof estTokens === 'function' ? estTokens(value) : Math.ceil(value.length / 3)) + 4 : 0;
}
function presetFormattedMarkerText(id, value, raw, context) {
  value = String(value || '');
  if (!value) return '';
  raw = raw || {};
  context = context || {};
  var format =
    id === 'worldInfoBefore' || id === 'worldInfoAfter'
      ? raw.wi_format
      : id === 'charPersonality'
        ? raw.personality_format
        : id === 'scenario'
          ? raw.scenario_format
          : '';
  if (!String(format || '').trim()) return value;
  var output = String(format);
  if (id === 'worldInfoBefore' || id === 'worldInfoAfter')
    output = output.replace(/\{0\}/g, function () {
      return value;
    });
  else
    output = output.replace(id === 'charPersonality' ? /\{\{personality\}\}/gi : /\{\{scenario\}\}/gi, function () {
      return value;
    });
  return output
    .replace(/\{\{char\}\}/gi, function () {
      return String(context.charName || 'Assistant');
    })
    .replace(/\{\{user\}\}/gi, function () {
      return String(context.userName || 'User');
    });
}
// SillyTavern openai.js preparePromptsForChatCompletion: the card's system_prompt and post_history_instructions
// replace an enabled main / jailbreak unless that prompt sets forbid_overrides. The preset text, together with the
// selected Yeyu system prompt profile, is the {{original}} the card may reuse.
function presetSlotContent(prompt, content, context) {
  // Do not let card or named system prompts refill a text slot excluded from impersonation.
  if (presetGenerationType(context.mode) === 'impersonate' && !presetPromptTriggered(prompt, context.mode)) return '';
  var id = String((prompt && prompt.identifier) || ''),
    original,
    override;
  if (id === 'main') {
    original = [context.disableSystemPrompt ? '' : content, context.namedSystemPrompt];
    override = context.cardSystemPrompt;
  } else if (id === 'jailbreak') {
    original = [
      context.mode === 'continue' || context.disablePostHistoryPrompt ? '' : content,
      context.namedPostHistory,
    ];
    override = context.cardPostHistory;
  } else return content;
  original = original.filter(Boolean).join('\n\n');
  var resolved = prompt.forbid_overrides === true ? original : resolveCardPromptTemplate(original, override);
  return typeof context.transformPromptSlot === 'function' ? context.transformPromptSlot(id, resolved) : resolved;
}
function presetFixedContextEstimate(raw, context) {
  if (!raw) return 0;
  context = context || {};
  var orderRow = presetOrderRow(raw),
    order = Array.isArray(orderRow && orderRow.order) ? orderRow.order : [],
    definitions = Array.isArray(raw.prompts) ? raw.prompts : [],
    byId = new Map(),
    markerText = {
      personaDescription: context.personaDescription,
      charDescription: context.charDescription,
      charPersonality: presetFormattedMarkerText('charPersonality', context.charPersonality, raw, context),
      scenario: presetFormattedMarkerText('scenario', context.scenario, raw, context),
      dialogueExamples: context.dialogueExamples,
    };
  definitions.forEach(function (prompt) {
    var id = String((prompt && prompt.identifier) || '');
    if (id && !byId.has(id)) byId.set(id, prompt);
  });
  var total = 0;
  order.forEach(function (item) {
    if (!item || item.enabled === false) return;
    var prompt = byId.get(String(item.identifier || ''));
    if (!prompt) return;
    var id = String(prompt.identifier || ''),
      triggered = presetPromptTriggered(prompt, context.mode),
      content = '';
    if (!triggered && id !== 'main') return;
    if (prompt.marker === true) {
      if (['worldInfoBefore', 'worldInfoAfter', 'chatHistory'].includes(id)) return;
      content = markerText[id] || '';
    } else content = presetSlotContent(prompt, triggered ? String(prompt.content || '') : '', context);
    total += presetEstimateText(content);
  });
  ['new_chat_prompt', 'new_example_chat_prompt', 'send_if_empty'].forEach(function (key) {
    total += presetEstimateText(raw[key]);
  });
  if (context.mode === 'continue' && !raw.continue_prefill) total += presetEstimateText(raw.continue_nudge_prompt);
  if (context.mode === 'impersonate') total += presetEstimateText(raw.impersonation_prompt);
  return total;
}
function presetCompletionName(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .slice(0, 64);
}
function presetHistoryNames(messages, raw, context) {
  var behavior = Number(raw && raw.names_behavior),
    userName = String((context && context.userName) || 'User'),
    charName = String((context && context.charName) || 'Assistant');
  return (messages || []).map(function (message) {
    var row = Object.assign({}, message);
    if (!['user', 'assistant'].includes(row.role)) return row;
    var speaker = String(row.name || (row.role === 'user' ? userName : charName));
    if (behavior === 1) {
      var completionName = presetCompletionName(speaker);
      if (completionName) row.name = completionName;
    } else if (behavior === 2) {
      if (speaker && !String(row.content || '').startsWith(speaker + ': '))
        row.content = speaker + ': ' + String(row.content || '');
    }
    return row;
  });
}
function presetExampleMessages(messages, separator, blocks) {
  var source = Array.isArray(blocks) && blocks.length ? blocks : messages && messages.length ? [messages] : [],
    out = [];
  source.forEach(function (block) {
    if (String(separator || '')) out.push({ role: 'system', content: String(separator), identifier: 'newChat' });
    out.push.apply(
      out,
      (Array.isArray(block) ? block : []).map(function (row) {
        return Object.assign({}, row);
      })
    );
  });
  return out;
}
function presetDialogueExampleBlocks(value, userName, charName) {
  var text = String(value || '').trim(),
    user = String(userName || 'User'),
    character = String(charName || 'Assistant');
  if (!text || text === '<START>') return [];
  if (!/^<START>/i.test(text)) text = '<START>\n' + text;
  return text
    .split(/<START>/gi)
    .slice(1)
    .map(function (part) {
      var lines = ('{Example Dialogue:}\n' + String(part || '').trim() + '\n').replace(/\r/g, '').split('\n'),
        result = [],
        current = [],
        inUser = false,
        inAssistant = false;
      function add(name, systemName) {
        var content = current
          .join('\n')
          .replace(name + ':', '')
          .trim();
        result.push({ role: 'system', content: content, name: systemName });
        current = [];
      }
      for (var index = 1; index < lines.length; index++) {
        var line = lines[index];
        if (line.startsWith(user + ':')) {
          if (inAssistant) add(character, 'example_assistant');
          inUser = true;
          inAssistant = false;
        } else if (line.startsWith(character + ':')) {
          if (inUser) add(user, 'example_user');
          inAssistant = true;
          inUser = false;
        }
        current.push(line);
      }
      if (inUser) add(user, 'example_user');
      else if (inAssistant) add(character, 'example_assistant');
      return result;
    })
    .filter(function (block) {
      return block.length > 0;
    });
}
function presetSquashSystemMessages(messages) {
  var result = [];
  (messages || []).forEach(function (message) {
    if (!message) return;
    var row = Object.assign({}, message),
      content = String(row.content || '');
    if (row.role === 'system' && !content) return;
    var previous = result[result.length - 1],
      boundary = ['newMainChat', 'newChat'];
    if (
      row.role === 'system' &&
      !row.name &&
      !boundary.includes(row.identifier) &&
      previous &&
      previous.role === 'system' &&
      !previous.name &&
      !boundary.includes(previous.identifier)
    ) {
      previous.content = String(previous.content || '') + '\n' + content;
    } else result.push(row);
  });
  return result;
}
function presetOutboundMessages(messages) {
  return (messages || [])
    .filter(function (message) {
      return message && (String(message.content || '').length > 0 || !!message._yeyuGenerationImageKey);
    })
    .map(function (message) {
      var row = { role: message.role, content: message.content };
      if (message.name) row.name = message.name;
      if (message._yeyuGenerationImageKey) row._yeyuGenerationImageKey = String(message._yeyuGenerationImageKey);
      return row;
    });
}
function presetFinalizeMessages(messages, raw) {
  var rows = (messages || []).map(function (message) {
    return Object.assign({}, message);
  });
  if (raw && raw.squash_system_messages === true) rows = presetSquashSystemMessages(rows);
  return presetOutboundMessages(rows);
}
function presetUnsupportedFeatures(raw) {
  if (!raw) return [];
  var known = new Set(PRESET_PLACEHOLDER_IDS);
  return Array.from(
    new Set(
      (Array.isArray(raw.prompts) ? raw.prompts : [])
        .filter(function (prompt) {
          return prompt && prompt.marker === true && !known.has(String(prompt.identifier || ''));
        })
        .map(function (prompt) {
          return String(prompt.name || prompt.identifier || '').trim();
        })
        .filter(Boolean)
    )
  );
}
function presetAssembleMessages(legacy, stages, context) {
  context = context || {};
  var raw = Object.prototype.hasOwnProperty.call(context, 'completionPresetRaw')
    ? context.completionPresetRaw
    : activeCompletionPresetRaw();
  if (!raw) return null;
  var orderRow = presetOrderRow(raw),
    order = Array.isArray(orderRow && orderRow.order) ? orderRow.order : [],
    definitions = Array.isArray(raw.prompts) ? raw.prompts : [],
    byId = new Map();
  definitions.forEach(function (prompt) {
    var id = String((prompt && prompt.identifier) || '');
    if (id && !byId.has(id)) byId.set(id, prompt);
  });
  var sources = {
      worldInfoBefore: presetStageSlice(legacy, stages, 'worldbook-before-char', 'character-card'),
      personaDescription: context.personaDescription ? [{ role: 'system', content: context.personaDescription }] : [],
      charDescription: context.charDescription ? [{ role: 'system', content: context.charDescription }] : [],
      charPersonality: context.charPersonality ? [{ role: 'system', content: context.charPersonality }] : [],
      scenario: context.scenario ? [{ role: 'system', content: context.scenario }] : [],
      worldInfoAfter: presetStageSlice(legacy, stages, 'worldbook-after-char', 'examples'),
      dialogueExamples: presetStageSlice(legacy, stages, 'examples', 'token-budget'),
      chatHistory: presetStageSlice(legacy, stages, 'memory', 'memory-tail'),
    },
    relative = [],
    inChat = [],
    layers = [],
    utilityControls = [];
  ['worldInfoBefore', 'worldInfoAfter', 'charPersonality', 'scenario'].forEach(function (id) {
    var text = (sources[id] || [])
      .map(function (row) {
        return String((row && row.content) || '');
      })
      .filter(Boolean)
      .join('\n');
    sources[id] = text ? [{ role: 'system', content: presetFormattedMarkerText(id, text, raw, context) }] : [];
  });
  var chatMarkerActive = order.some(function (item) {
      var prompt = item && byId.get(String(item.identifier || ''));
      return (
        item &&
        item.enabled !== false &&
        String(item.identifier || '') === 'chatHistory' &&
        prompt &&
        prompt.marker === true &&
        presetPromptTriggered(prompt, context.mode)
      );
    }),
    prePostHistory = presetStageSlice(legacy, stages, 'memory-tail', 'post-history'),
    postHistoryTail = presetStageSlice(legacy, stages, 'post-history', 'cache-commit'),
    postHistorySupplementals = postHistoryTail.filter(function (row) {
      return row && row._yeyuPresetSupplemental === true;
    }),
    postEverything = postHistoryTail.filter(function (row) {
      return row && row._yeyuPresetPostEverything === true;
    }),
    continuation = null;
  if (context.mode === 'continue') {
    var continuationIndex = -1;
    for (var i = postHistoryTail.length - 1; i >= 0; i--) {
      if (
        postHistoryTail[i]._yeyuPresetSupplemental !== true &&
        postHistoryTail[i]._yeyuPresetPostEverything !== true &&
        postHistoryTail[i].role === 'assistant' &&
        String(postHistoryTail[i].content || '').trim()
      ) {
        continuationIndex = i;
        break;
      }
    }
    if (continuationIndex >= 0)
      continuation = presetHistoryNames([postHistoryTail.splice(continuationIndex, 1)[0]], raw, context)[0];
  }
  function rowsForPrompt(prompt, orderItem) {
    var id = String((prompt && prompt.identifier) || ''),
      rows = [];
    if (prompt && prompt.marker === true) {
      if (!Object.prototype.hasOwnProperty.call(sources, id)) return rows;
      return ['dialogueExamples', 'chatHistory'].includes(id)
        ? sources[id].slice()
        : presetApplyRole(sources[id], prompt.role);
    }
    // Like SillyTavern, a main that is enabled but not triggered keeps an empty slot the card may still override,
    // while a disabled main sends none of its own text and takes no card override. Impersonation also
    // excludes overrides from untriggered text slots; extension prompts still keep their own placement.
    var content =
        orderItem.enabled === false
          ? ''
          : presetSlotContent(
              prompt,
              presetPromptTriggered(prompt, context.mode) ? String(prompt.content || '') : '',
              context
            ),
      imageKey =
        (presetGenerationType(context.mode) !== 'impersonate' || presetPromptTriggered(prompt, context.mode)) &&
        prompt &&
        prompt.extra &&
        prompt.extra.yeyu_generation_image_key;
    if (content || imageKey) {
      var row = {
        role: ['system', 'user', 'assistant'].includes(prompt && prompt.role) ? prompt.role : 'system',
        content: content,
      };
      if (imageKey) row._yeyuGenerationImageKey = String(imageKey);
      rows.push(row);
    }
    if (id === 'main' && Array.isArray(context.extensionPrompts)) {
      var before = [],
        after = [];
      context.extensionPrompts.forEach(function (item) {
        if (!['before_prompt', 'in_prompt'].includes(item.position) || !item.content) return;
        var target = item.position === 'before_prompt' ? before : after;
        target.push({
          role:
            Number(prompt.injection_position) === 1 ? (rows[0] && rows[0].role) || prompt.role || 'system' : item.role,
          content: item.content,
        });
      });
      rows = before.concat(rows, after);
    }
    return rows;
  }
  order.forEach(function (orderItem) {
    if (!orderItem || orderItem.enabled === false) return;
    var prompt = byId.get(String(orderItem.identifier || ''));
    if (!presetPromptInChat(prompt) || !presetPromptTriggered(prompt, context.mode)) return;
    rowsForPrompt(prompt, orderItem).forEach(function (row) {
      inChat.push({
        depth: Number(prompt.injection_depth ?? 4),
        order: Number(prompt.injection_order ?? 100),
        role: row.role,
        content: row.content,
      });
    });
  });
  var chat = presetHistoryNames(sources.chatHistory, raw, context);
  if (chatMarkerActive && continuation && !raw.continue_prefill) {
    continuation.identifier = 'continueTarget';
    chat.push(continuation);
  }
  chat = presetInsertInChat(chat, inChat);
  if (chatMarkerActive && continuation && !raw.continue_prefill) {
    var targetIndex = chat.findIndex(function (row) {
      return row.identifier === 'continueTarget';
    });
    if (targetIndex >= 0) continuation = chat.splice(targetIndex, 1)[0];
  }
  var newChat = String(raw.new_chat_prompt || '');
  if (newChat) chat.unshift({ role: 'system', content: newChat, identifier: 'newMainChat' });
  if (chat.length && chat[chat.length - 1].role === 'assistant' && String(raw.send_if_empty || ''))
    chat.push({ role: 'user', content: String(raw.send_if_empty) });
  sources.chatHistory = chat;
  sources.dialogueExamples = presetExampleMessages(
    sources.dialogueExamples,
    raw.new_example_chat_prompt,
    context.dialogueExampleBlocks
  );
  order.forEach(function (orderItem, index) {
    if (!orderItem) return;
    var prompt = byId.get(String(orderItem.identifier || ''));
    if (!prompt) return;
    var id = String(prompt.identifier || ''),
      active = orderItem.enabled !== false && presetPromptTriggered(prompt, context.mode),
      disabledMain = id === 'main' && !active,
      rows;
    if (!active && !disabledMain) return;
    rows = rowsForPrompt(prompt, orderItem);
    if (!rows.length) return;
    if (id === 'jailbreak' && (prePostHistory.length || postHistorySupplementals.length)) {
      relative.push.apply(relative, prePostHistory.concat(postHistorySupplementals));
      prePostHistory = [];
      postHistorySupplementals = [];
    }
    layers.push({ id: id, name: String(prompt.name || id), count: rows.length, order: index });
    if (!presetPromptInChat(prompt)) relative.push.apply(relative, rows);
  });
  relative.push.apply(relative, prePostHistory.concat(postHistorySupplementals));
  // Risu tail lore follows every ordered preset slot, retaining its own roles and prefill order.
  relative.push.apply(relative, postEverything);
  if (chatMarkerActive && context.mode === 'continue' && continuation) {
    utilityControls.push(continuation);
    if (!context.disablePostHistoryPrompt && !raw.continue_prefill && String(raw.continue_nudge_prompt || ''))
      utilityControls.push({
        role: 'user',
        content: String(raw.continue_nudge_prompt).replace(
          /{{lastChatMessage}}/g,
          String(continuation.content || '').trim()
        ),
        identifier: 'continueNudge',
      });
  }
  if (context.mode === 'impersonate' && String(raw.impersonation_prompt || ''))
    utilityControls.push({ role: 'system', content: String(raw.impersonation_prompt), identifier: 'impersonate' });
  relative.push.apply(relative, utilityControls);
  if (context.deferFinalize !== true) relative = presetFinalizeMessages(relative, raw);
  return { messages: relative, layers: layers, unsupported: presetUnsupportedFeatures(raw) };
}

var YEYU_DEFAULT_PRESET_NAME = '夜欲默认';
var _completionPresetDraftRows = null,
  _completionPresetDraftActive = '',
  _completionPresetPromptIndex = -1,
  _completionPresetPromptPending = null,
  _completionPresetDefaultRaw = null,
  _completionPresetNoteDraft = null,
  _completionPresetGlobalSettingsDraft = null,
  // 回复开头也可由 /start-reply-with 在页面打开期间改写；只有用户改过编辑框时保存才回写它。
  _completionPresetStartReplyEdited = false,
  _completionPresetTasksEnabledDraft = false,
  _completionPresetTab = 'manage',
  _completionPresetDraftChangeQueued = false,
  _completionPresetDraftChangeBound = false,
  _completionPresetReorderBound = false;
function completionPresetAuthorNoteFrequency(value, fallback) {
  var number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, Math.floor(number));
  number = Number(fallback);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 2;
}
function completionPresetSyncAuthorNoteDraft(key, value) {
  if (!_completionPresetNoteDraft) return;
  if (key === 'authorsNote') _completionPresetNoteDraft.authorsNote = String(value == null ? '' : value);
  else if (key === 'anDepth') _completionPresetNoteDraft.anDepth = Math.max(0, Number(value) || 0);
  else if (key === 'authorNotePosition' || key === 'authorNoteRole') _completionPresetNoteDraft[key] = value;
  else if (key === 'anFreq')
    _completionPresetNoteDraft.anFreq = completionPresetAuthorNoteFrequency(value, _completionPresetNoteDraft.anFreq);
}
// 预设页「辅助」栏编辑的全局设置：预设管理器开着时改草稿，没开时（脚本、启动流程）直接改运行中的设置。
function completionPresetGlobalSettingsDraft() {
  return _completionPresetGlobalSettingsDraft || (typeof D !== 'undefined' && D ? D.settings : null);
}
function completionPresetSyncSystemPromptDraft() {
  if (!_completionPresetGlobalSettingsDraft || typeof D === 'undefined' || !D || !D.settings) return;
  _completionPresetGlobalSettingsDraft.systemPromptProfiles = cloneData(D.settings.systemPromptProfiles || []);
  _completionPresetGlobalSettingsDraft.activeSystemPromptProfileId = D.settings.activeSystemPromptProfileId || '';
  _completionPresetGlobalSettingsDraft.systemPromptEnabled = D.settings.systemPromptEnabled === true;
}
function completionPresetDraftProjection(settings) {
  var source = settings && typeof settings === 'object' ? settings : {},
    active = String(source.activeChatCompletionPresetName || ''),
    inUse =
      source.chatCompletionPresetInUse &&
      typeof source.chatCompletionPresetInUse === 'object' &&
      !Array.isArray(source.chatCompletionPresetInUse)
        ? source.chatCompletionPresetInUse
        : null;
  return {
    chatCompletionPresets: cloneData(Array.isArray(source.chatCompletionPresets) ? source.chatCompletionPresets : []),
    activeChatCompletionPresetName: active,
    chatCompletionPresetInUse: cloneData(!active && !inUse ? completionPresetDefaultRaw(source) : inUse),
    presetEmbeddedTasksEnabled: source.presetEmbeddedTasksEnabled === true,
    authorsNote: String(source.authorsNote ?? DEFAULT_AUTHORS_NOTE),
    anDepth: Math.max(0, Math.floor(Number(source.anDepth) || 0)),
    anFreq: completionPresetAuthorNoteFrequency(source.anFreq, 2),
    authorNotePosition: source.authorNotePosition || 'chat',
    authorNoteRole: source.authorNoteRole || 'system',
    styleAuditEnabled: source.styleAuditEnabled === true,
    systemPromptProfiles: cloneData(Array.isArray(source.systemPromptProfiles) ? source.systemPromptProfiles : []),
    activeSystemPromptProfileId: String(source.activeSystemPromptProfileId || ''),
    systemPromptEnabled: source.systemPromptEnabled === true,
    assistantPromptOverrides: cloneData(
      source.assistantPromptOverrides &&
        typeof source.assistantPromptOverrides === 'object' &&
        !Array.isArray(source.assistantPromptOverrides)
        ? source.assistantPromptOverrides
        : {}
    ),
  };
}
function completionPresetDraftValueEqual(left, right) {
  if (left === right) return true;
  if (
    left == null ||
    right == null ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    for (var index = 0; index < left.length; index++)
      if (!completionPresetDraftValueEqual(left[index], right[index])) return false;
    return true;
  }
  var leftKeys = Object.keys(left).sort(),
    rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (var at = 0; at < leftKeys.length; at++)
    if (leftKeys[at] !== rightKeys[at] || !completionPresetDraftValueEqual(left[leftKeys[at]], right[rightKeys[at]]))
      return false;
  return true;
}
function completionPresetDraftChanged() {
  if (!Array.isArray(_completionPresetDraftRows)) return false;
  var saved = presetSettingsStore(),
    candidate = applyPromptManagerForm(cloneData(saved));
  return !completionPresetDraftValueEqual(
    completionPresetDraftProjection(saved),
    completionPresetDraftProjection(candidate)
  );
}
function completionPresetRenderDraftHint() {
  var hint = $('pm-draft-hint');
  var hidden = !completionPresetDraftChanged();
  if (hint && hint.hidden !== hidden) hint.hidden = hidden;
}
// The single signal that the manager's draft (or the saved state it is compared with) changed. Coalesced per task,
// it refreshes everything derived from the draft: the unsaved-changes hint and the expanded round preview.
function completionPresetNotifyDraftChanged() {
  if (_completionPresetDraftChangeQueued) return;
  _completionPresetDraftChangeQueued = true;
  Promise.resolve().then(function () {
    _completionPresetDraftChangeQueued = false;
    completionPresetRenderDraftHint();
    if (typeof schedulePresetRoundPreview === 'function') schedulePresetRoundPreview();
  });
}
function completionPresetBindDraftChanges() {
  var modal = $('prompt-manager-modal');
  if (!modal || _completionPresetDraftChangeBound) return;
  _completionPresetDraftChangeBound = true;
  var inputTimer = 0,
    changed = function () {
      clearTimeout(inputTimer);
      completionPresetNotifyDraftChanged();
    };
  modal.addEventListener('input', function () {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(changed, 180);
  });
  modal.addEventListener('change', changed);
}
function completionPresetIsDefault() {
  return _completionPresetDraftActive === '';
}
function completionPresetDraftRow() {
  if (completionPresetIsDefault()) return { name: '', preset: _completionPresetDefaultRaw || presetRawDefault() };
  return (
    (_completionPresetDraftRows || []).find(function (row) {
      return String(row.name || '') === _completionPresetDraftActive;
    }) || null
  );
}
function completionPresetNameFromFile(file) {
  var base =
      String((file && file.name) || '')
        .replace(/\.json$/i, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
        .trim()
        .slice(0, 80) || '导入预设',
    name = base,
    n = 2;
  while (
    (_completionPresetDraftRows || []).some(function (row) {
      return row.name === name;
    })
  )
    name = base + ' #' + n++;
  return name;
}
// Textareas report CRLF and lone CR as LF, so a form value that differs from the stored text only in line endings is
// the untouched original and must not be written back.
function completionPresetFormValueChanged(stored, value) {
  var lf = /\r\n?/g;
  return String(stored ?? '').replace(lf, '\n') !== String(value ?? '').replace(lf, '\n');
}
function completionPresetCaptureFields() {
  if (_completionPresetNoteDraft) {
    var note = $('pm-authors-note'),
      depth = $('pm-an-depth'),
      freq = $('pm-an-freq');
    if ($('pm-author-note-position'))
      _completionPresetNoteDraft.authorNotePosition = $('pm-author-note-position').value;
    if ($('pm-author-note-role')) _completionPresetNoteDraft.authorNoteRole = $('pm-author-note-role').value;
    if (note) _completionPresetNoteDraft.authorsNote = note.value;
    if (depth && depth.value !== '')
      _completionPresetNoteDraft.anDepth = Math.max(0, Math.floor(Number(depth.value) || 0));
    if (freq && freq.value !== '')
      _completionPresetNoteDraft.anFreq = completionPresetAuthorNoteFrequency(freq.value, 2);
  }
  if (_completionPresetGlobalSettingsDraft) {
    var startReply = $('pm-start-reply-with');
    if (
      startReply &&
      completionPresetFormValueChanged(_completionPresetGlobalSettingsDraft.startReplyWith, startReply.value)
    ) {
      _completionPresetGlobalSettingsDraft.startReplyWith = startReply.value;
      _completionPresetStartReplyEdited = true;
    }
    var style = $('pm-style-audit-enabled');
    if (style) _completionPresetGlobalSettingsDraft.styleAuditEnabled = style.checked;
    var systemPrompt = $('pm-system-prompt-select');
    if (systemPrompt) {
      _completionPresetGlobalSettingsDraft.systemPromptEnabled = !!systemPrompt.value;
      if (systemPrompt.value) _completionPresetGlobalSettingsDraft.activeSystemPromptProfileId = systemPrompt.value;
    }
    if (typeof captureAssistantPromptSettings === 'function')
      captureAssistantPromptSettings(_completionPresetGlobalSettingsDraft, 'prompt-presets');
  }
  var row = completionPresetDraftRow(),
    raw = row && row.preset;
  if (!raw) return;
  var textFields = {
    send_if_empty: 'pm-send-if-empty',
    impersonation_prompt: 'pm-impersonation-prompt',
    new_chat_prompt: 'pm-new-chat-prompt',
    new_example_chat_prompt: 'pm-new-example-chat-prompt',
    continue_nudge_prompt: 'pm-continue-nudge-prompt',
    assistant_prefill: 'pm-assistant-prefill',
    wi_format: 'pm-wi-format',
    personality_format: 'pm-personality-format',
    scenario_format: 'pm-scenario-format',
  };
  Object.keys(textFields).forEach(function (key) {
    var node = $(textFields[key]),
      value = node && node.value;
    if (node && completionPresetFormValueChanged(raw[key], value)) raw[key] = value;
  });
}
function completionPresetRenderSelect() {
  var select = $('pm-preset-select');
  if (!select) return;
  select.innerHTML =
    '<option value="">' +
    YEYU_DEFAULT_PRESET_NAME +
    '</option>' +
    (_completionPresetDraftRows || [])
      .map(function (row) {
        return (
          '<option value="' +
          escAttr(row.name) +
          '"' +
          (row.name === _completionPresetDraftActive ? ' selected' : '') +
          '>' +
          esc(row.name) +
          '</option>'
        );
      })
      .join('');
  select.value = _completionPresetDraftActive;
  var external = !completionPresetIsDefault();
  ['pm-rename-preset', 'pm-delete-preset'].forEach(function (id) {
    var node = $(id);
    if (node) node.disabled = !external;
  });
  completionPresetNotifyDraftChanged();
}
function completionPresetRenderCompatibility(raw) {
  var box = $('pm-compatibility-status');
  if (!box) return;
  var unsupported = presetUnsupportedFeatures(raw),
    items = ['不支持群聊。', '预设里的参数和思考等级不会生效，请在「设置」里调整。'];
  if (unsupported.length)
    items.push('以下占位暂时无法填充，会保留在预设和导出文件里，但不参与生成：' + unsupported.join('、') + '。');
  box.innerHTML = items
    .map(function (item) {
      return '<li>' + esc(item) + '</li>';
    })
    .join('');
}
function completionPresetEmbeddedTasks(raw) {
  if (window.YeyuPresetTaskRuntime && typeof window.YeyuPresetTaskRuntime.readEmbeddedTasks === 'function')
    return window.YeyuPresetTaskRuntime.readEmbeddedTasks(raw);
  var rows = Array.isArray(raw && raw.prompt_order) ? raw.prompt_order : [],
    owner = rows.find(function (row) {
      return Number(row && row.character_id) === 100000;
    }),
    extension = owner && owner.xiaobai_ext;
  return extension && Array.isArray(extension.scheduledTasks) ? extension.scheduledTasks : [];
}
function completionPresetTaskTimingLabel(task) {
  if (task && task.buttonActivated === true) return '手动任务';
  var timing =
      {
        after_ai: '角色回复后',
        before_user: '用户发送前',
        any_message: '每条消息',
        initialization: '新对话时',
        character_init: '角色载入时',
        plugin_init: '页面载入时',
        only_this_floor: '指定楼层',
        chat_changed: '切换对话时',
      }[String((task && task.triggerTiming) || '')] || '自动任务',
    interval = Math.max(0, Math.floor(Number(task && task.interval) || 0));
  return interval ? timing + ' · 每 ' + interval + ' 层' : timing;
}
function completionPresetTasksSaved() {
  var s = presetSettingsStore();
  return (
    s.presetEmbeddedTasksEnabled === _completionPresetTasksEnabledDraft &&
    String(s.activeChatCompletionPresetName || '') === String(_completionPresetDraftActive || '') &&
    JSON.stringify(s.chatCompletionPresetInUse || null) ===
      JSON.stringify((completionPresetDraftRow() || {}).preset || null)
  );
}
function completionPresetRenderTasks() {
  var panel = $('pm-task-panel'),
    list = $('pm-task-list'),
    enabled = $('pm-task-enabled'),
    hint = $('pm-task-save-hint'),
    raw = (completionPresetDraftRow() || {}).preset,
    tasks = completionPresetEmbeddedTasks(raw);
  if (!panel || !list) return;
  panel.hidden = !tasks.length;
  if (!tasks.length) return;
  if (enabled) enabled.checked = _completionPresetTasksEnabledDraft === true;
  var manual = tasks.filter(function (task) {
      return task && task.buttonActivated === true;
    }),
    saved = completionPresetTasksSaved(),
    canRun = _completionPresetTasksEnabledDraft === true && saved;
  var count = $('pm-task-count');
  if (count) count.textContent = tasks.length + ' 个 · ' + manual.length + ' 个可手动运行';
  if (hint) hint.hidden = !(_completionPresetTasksEnabledDraft && !saved);
  list.innerHTML = manual.length
    ? manual
        .map(function (task) {
          var index = tasks.indexOf(task),
            disabled = task.disabled === true || !canRun;
          return (
            '<div class="preset-task-row"><div class="preset-task-copy"><strong>' +
            esc(String(task.name || task.id || '未命名任务')) +
            '</strong><small>' +
            esc(completionPresetTaskTimingLabel(task)) +
            '</small></div><button type="button" class="btn sm" data-preset-task-index="' +
            index +
            '" ' +
            (disabled ? 'disabled' : '') +
            ' onclick="runCompletionPresetTask(' +
            index +
            ',this)">运行</button></div>'
          );
        })
        .join('')
    : '<p class="ui-empty">这个预设的任务都是自动运行的，没有可手动运行的任务。</p>';
}
function changeCompletionPresetTasksEnabled(enabled) {
  _completionPresetTasksEnabledDraft = enabled === true;
  completionPresetRenderTasks();
}
async function runCompletionPresetTask(index, button) {
  var tasks = completionPresetEmbeddedTasks((completionPresetDraftRow() || {}).preset),
    task = tasks[index];
  if (!task || task.buttonActivated !== true) return;
  if (!completionPresetTasksSaved() || D.settings.presetEmbeddedTasksEnabled !== true) {
    toast('请先保存当前预设和任务开关', 'info');
    return;
  }
  var runtime = typeof initPresetTaskRuntime === 'function' ? initPresetTaskRuntime() : null;
  if (!runtime) {
    toast('任务运行器尚未就绪', 'err');
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = '运行中';
  }
  try {
    await runtime.run(String(task.id || task.name || ''), {
      source: 'prompt-manager',
      scriptModule: typeof presetTaskScriptModule === 'function' ? presetTaskScriptModule() : {},
    });
    toast('任务“' + String(task.name || task.id || '') + '”已完成', 'ok');
  } catch (error) {
    toast('任务执行失败：' + String((error && error.message) || error), 'err');
  } finally {
    if (button) {
      button.textContent = '运行';
      completionPresetRenderTasks();
    }
  }
}
function completionPresetRenderFields() {
  var row = completionPresetDraftRow(),
    raw = row && row.preset,
    editor = $('pm-preset-editor');
  if (editor) editor.hidden = false;
  completionPresetRenderSelect();
  completionPresetRenderCompatibility(raw);
  var noteDraft = _completionPresetNoteDraft || { authorsNote: '', anDepth: 2, anFreq: 2 },
    note = $('pm-authors-note'),
    depth = $('pm-an-depth'),
    freq = $('pm-an-freq');
  if ($('pm-author-note-position')) $('pm-author-note-position').value = noteDraft.authorNotePosition || 'chat';
  if ($('pm-author-note-role')) $('pm-author-note-role').value = noteDraft.authorNoteRole || 'system';
  if (note) note.value = String(noteDraft.authorsNote || '');
  if (depth) depth.value = String(Math.max(0, Number(noteDraft.anDepth) || 0));
  if (freq) freq.value = String(completionPresetAuthorNoteFrequency(noteDraft.anFreq, 2));
  var textFields = {
    send_if_empty: 'pm-send-if-empty',
    impersonation_prompt: 'pm-impersonation-prompt',
    new_chat_prompt: 'pm-new-chat-prompt',
    new_example_chat_prompt: 'pm-new-example-chat-prompt',
    continue_nudge_prompt: 'pm-continue-nudge-prompt',
    assistant_prefill: 'pm-assistant-prefill',
    wi_format: 'pm-wi-format',
    personality_format: 'pm-personality-format',
    scenario_format: 'pm-scenario-format',
  };
  Object.keys(textFields).forEach(function (key) {
    var node = $(textFields[key]);
    if (node) node.value = String((raw && raw[key]) ?? '');
  });
  if (_completionPresetGlobalSettingsDraft) {
    var startReply = $('pm-start-reply-with');
    if (startReply) startReply.value = String(_completionPresetGlobalSettingsDraft.startReplyWith || '');
    if (typeof stscriptRenderSystemPromptField === 'function') stscriptRenderSystemPromptField();
    if (typeof renderAssistantPromptSettings === 'function')
      renderAssistantPromptSettings(
        'pm-global-assistant-prompts',
        'prompt-presets',
        _completionPresetGlobalSettingsDraft
      );
  }
  completionPresetRenderPrompts();
  completionPresetRenderTasks();
  renderPromptLayerList();
  if (typeof renderStyleAuditStatus === 'function') renderStyleAuditStatus();
  if (typeof promptConstraintWarningUi === 'object' && promptConstraintWarningUi) promptConstraintWarningUi.bind();
}
// How the order list tags a built-in slot; empty for placeholders and the preset's own entries.
function completionPresetBuiltinSlotLabel(identifier) {
  if (PRESET_CARD_OVERRIDE_SLOT_IDS.includes(identifier)) return '内置 · 角色卡可覆盖';
  return PRESET_BUILTIN_SLOT_IDS.includes(identifier) ? '内置' : '';
}
// Long-press drag is the arrows' move with a longer step: the same rows can be lifted (placeholders stay put) and a
// drop to visible position `to` is moveCompletionPresetPrompt(index, to - from).
function completionPresetBindPromptReorder() {
  var box = $('pm-prompt-list');
  if (!box || _completionPresetReorderBound) return;
  _completionPresetReorderBound = true;
  bindListReorder(box, {
    rowSelector: '.preset-prompt-row',
    ignoreSelector: '.preset-prompt-toggle, .preset-prompt-actions',
    canGrab: function (row) {
      return !row.classList.contains('is-marker');
    },
    onDrop: function (row, from, to) {
      moveCompletionPresetPrompt(Number(row.dataset.orderIndex), to - from);
    },
  });
}
function completionPresetRenderPrompts() {
  var row = completionPresetDraftRow(),
    raw = row && row.preset,
    box = $('pm-prompt-list');
  if (!box || !raw) return;
  var orderRow = presetOrderRow(raw),
    order = Array.isArray(orderRow && orderRow.order) ? orderRow.order : [],
    prompts = Array.isArray(raw.prompts) ? raw.prompts : [],
    used = new Set(
      order.map(function (item) {
        return String(item.identifier || '');
      })
    ),
    known = new Set(PRESET_PLACEHOLDER_IDS),
    visibleIndexes = completionPresetVisibleOrderIndexes(raw),
    count = $('pm-order-count');
  if (count) count.textContent = visibleIndexes.length + ' 条';
  var roleNames = { system: '系统', user: '用户', assistant: '助手' };
  var rows = order.map(function (item, index) {
    var prompt = prompts.find(function (value) {
      return String((value && value.identifier) || '') === String(item.identifier || '');
    });
    if (!prompt) return '';
    var promptIndex = prompts.indexOf(prompt),
      identifier = String(prompt.identifier || ''),
      marker = prompt.marker === true,
      custom = !!completionPresetCustomDefinition(raw, promptIndex),
      unsupported = marker && !known.has(identifier);
    if (unsupported) return '';
    var name = marker ? '📌 ' + PRESET_PLACEHOLDER_LABELS[identifier] : String(prompt.name || identifier || '未命名'),
      role = roleNames[String(prompt.role || 'system')] || String(prompt.role),
      depthLabel = presetPromptInChat(prompt) ? '聊天记录内 · 深度 ' + Number(prompt.injection_depth ?? 4) : '',
      kind = [marker ? '占位' : completionPresetBuiltinSlotLabel(identifier), depthLabel, marker ? '' : role]
        .filter(Boolean)
        .join(' · '),
      main = '<strong>' + esc(name) + '</strong><small>' + esc(kind) + '</small>';
    main = marker
      ? '<div class="preset-prompt-main" aria-label="' + escAttr(name + '，' + kind) + '">' + main + '</div>'
      : '<button type="button" class="preset-prompt-main" onclick="editCompletionPresetPrompt(' +
        promptIndex +
        ')">' +
        main +
        '</button>';
    return (
      '<div class="preset-prompt-row' +
      (item.enabled === false ? ' is-disabled' : '') +
      (marker ? ' is-marker' : '') +
      '" data-order-index="' +
      index +
      '"><label class="switch-row preset-prompt-toggle" aria-label="' +
      (item.enabled === false ? '启用' : '停用') +
      escAttr(name) +
      '"><input type="checkbox" ' +
      (item.enabled === false ? '' : 'checked') +
      ' onchange="toggleCompletionPresetPrompt(' +
      index +
      ',this.checked)"><span class="switch-control" aria-hidden="true"></span></label>' +
      main +
      (marker
        ? ''
        : '<div class="ui-actions preset-prompt-actions"><button type="button" class="btn icon sm" aria-label="上移' +
          escAttr(name) +
          '" onclick="moveCompletionPresetPrompt(' +
          index +
          ',-1)">' +
          uiIcon('arrow-up') +
          '</button><button type="button" class="btn icon sm" aria-label="下移' +
          escAttr(name) +
          '" onclick="moveCompletionPresetPrompt(' +
          index +
          ',1)">' +
          uiIcon('arrow-down') +
          '</button>' +
          (custom
            ? '<button type="button" class="btn text sm" aria-label="移到备用：' +
              escAttr(name) +
              '" onclick="moveCompletionPresetPromptToUnused(' +
              promptIndex +
              ')">备用</button>'
            : '') +
          '</div>') +
      '</div>'
    );
  });
  var unused = prompts.filter(function (prompt) {
      return prompt && prompt.marker !== true && !used.has(String(prompt.identifier || ''));
    }),
    nameCounts = new Map();
  unused.forEach(function (prompt) {
    var name = String(prompt.name || prompt.identifier || '未命名');
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  });
  box.innerHTML =
    '<div class="ui-group preset-prompt-group">' +
    rows.join('') +
    '</div>' +
    (unused.length
      ? '<details class="preset-unused"><summary>备用提示词 <small class="ui-meta">' +
        unused.length +
        ' 条</small></summary><p class="hint ui-group-hint">备用内容不参与请求，点「加入」放回顺序。</p><div class="ui-group">' +
        unused
          .map(function (prompt) {
            var promptIndex = prompts.indexOf(prompt),
              name = String(prompt.name || prompt.identifier || '未命名'),
              duplicate = nameCounts.get(name) > 1,
              custom = !!completionPresetCustomDefinition(raw, promptIndex);
            return (
              '<div class="preset-unused-row"><div class="preset-unused-copy"><strong>' +
              esc(name) +
              '</strong>' +
              (duplicate ? '<small>' + esc(String(prompt.identifier || '')) + '</small>' : '') +
              '</div><div class="ui-actions">' +
              (custom
                ? '<button type="button" class="btn text sm danger" aria-label="删除提示词：' +
                  escAttr(name) +
                  '" onclick="deleteCompletionPresetPrompt(' +
                  promptIndex +
                  ')">删除</button>'
                : '') +
              '<button type="button" class="btn text sm accent" aria-label="加入提示词：' +
              escAttr(name) +
              '" onclick="addUnusedCompletionPresetPrompt(' +
              promptIndex +
              ')">加入</button></div></div>'
            );
          })
          .join('') +
        '</div></details>'
      : '');
  completionPresetNotifyDraftChanged();
}
function switchCompletionPresetTab(tab) {
  var previous = _completionPresetTab;
  completionPresetCaptureFields();
  _completionPresetTab = ['manage', 'order', 'note', 'utility'].includes(tab) ? tab : 'manage';
  document.querySelectorAll('[data-preset-tab]').forEach(function (button) {
    var active = button.dataset.presetTab === _completionPresetTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-preset-panel]').forEach(function (panel) {
    panel.hidden = panel.dataset.presetPanel !== _completionPresetTab;
    if (!panel.hidden && previous !== _completionPresetTab) revealUiContent(panel);
  });
  if (typeof scheduleAutoGrowTextareas === 'function') scheduleAutoGrowTextareas($('prompt-manager-modal'));
}
function switchPromptPreset(name) {
  completionPresetCaptureFields();
  _completionPresetDraftActive = String(name || '');
  completionPresetRenderFields();
}
// Asks for the name of a preset about to be added to the draft; null when cancelled, empty or already taken.
async function completionPresetAskNewName(message, suggestion, title, okText) {
  var name = await appInput(message, suggestion, title, '预设名称', { okText: okText });
  if (name === null) return null;
  name = String(name).trim();
  if (!name) return null;
  if (
    (_completionPresetDraftRows || []).some(function (row) {
      return row.name === name;
    })
  ) {
    toast('已有同名预设', 'err');
    return null;
  }
  return name;
}
function completionPresetAddDraftRow(name, raw) {
  _completionPresetDraftRows.push({ name: name, preset: raw });
  _completionPresetDraftActive = name;
  completionPresetRenderFields();
}
async function createPromptPreset() {
  completionPresetCaptureFields();
  var name = await completionPresetAskNewName('输入新预设名称', '新预设', '新建聊天补全预设', '新建预设');
  if (name) completionPresetAddDraftRow(name, presetRawSkeleton());
}
async function duplicatePromptPreset() {
  completionPresetCaptureFields();
  var source = completionPresetDraftRow();
  if (!source) return;
  var name = await completionPresetAskNewName(
    '输入副本名称',
    (source.name || YEYU_DEFAULT_PRESET_NAME) + ' 副本',
    '复制预设',
    '复制预设'
  );
  if (name) completionPresetAddDraftRow(name, cloneData(source.preset));
}
async function renamePromptPreset() {
  var row = completionPresetDraftRow();
  if (!row) return;
  var name = await appInput('输入新的预设名称', row.name, '重命名预设', '预设名称', { okText: '保存名称' });
  if (name === null) return;
  name = String(name).trim();
  if (!name || name === row.name) return;
  if (
    (_completionPresetDraftRows || []).some(function (item) {
      return item.name === name;
    })
  ) {
    toast('已有同名预设', 'err');
    return;
  }
  row.name = name;
  _completionPresetDraftActive = name;
  completionPresetRenderSelect();
}
async function deletePromptPreset() {
  var row = completionPresetDraftRow();
  if (!row) return;
  if (!(await appConfirm('确定删除“' + row.name + '”？完整预设数据会从本机移除。', '删除预设', '删除'))) return;
  _completionPresetDraftRows.splice(_completionPresetDraftRows.indexOf(row), 1);
  _completionPresetDraftActive = '';
  completionPresetRenderFields();
}
async function resetPromptPresetDefault() {
  var row = completionPresetDraftRow();
  if (!row || !(await appConfirm('确定把当前预设恢复为夜欲默认内容？', '恢复默认', '恢复'))) return;
  row.preset = presetRawDefault();
  if (completionPresetIsDefault()) _completionPresetDefaultRaw = row.preset;
  completionPresetRenderFields();
}
async function importPromptPresetFile(event) {
  var input = event && event.target,
    file = input && input.files && input.files[0],
    status = $('prompt-import-status');
  if (!file) return;
  try {
    completionPresetCaptureFields();
    var rawText = (await file.text()).replace(/^\uFEFF/, ''),
      raw;
    try {
      raw = JSON.parse(rawText);
    } catch (_) {
      throw new Error(
        '\u6587\u4EF6\u4E0D\u662F\u6709\u6548\u7684 JSON\uFF0C\u53EF\u80FD\u4E0D\u662F\u9884\u8BBE\u6587\u4EF6'
      );
    }
    var name = completionPresetNameFromFile(file),
      notices = completionPresetImportRaw(name, raw, _completionPresetDraftRows).notices;
    _completionPresetDraftActive = name;
    completionPresetRenderFields();
    if (status) status.textContent = ['已载入 ' + name + '，保存后生效'].concat(notices).join('；');
    toast(notices.length ? '预设已载入：' + notices.join('；') : '预设已完整载入', 'ok');
  } catch (error) {
    if (status) status.textContent = '导入失败';
    toast('预设导入失败：' + error.message, 'err');
  } finally {
    input.value = '';
  }
}
function promptPresetExportFilename(name) {
  return (
    (String(name || '预设')
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .slice(0, 60) || '预设') + '.json'
  );
}
function exportPromptPreset() {
  completionPresetCaptureFields();
  var row = completionPresetDraftRow();
  if (!row) return;
  var exported = YeyuPure.redactExportCredentials(completionPresetExportRaw(row.name, [row])),
    json = JSON.stringify(exported, null, 2),
    filename = promptPresetExportFilename(row.name || YEYU_DEFAULT_PRESET_NAME);
  saveTextFileExport(json, filename, 'application/json', '夜欲提示词预设', '已导出完整预设');
}
function toggleCompletionPresetPrompt(index, enabled) {
  var row = completionPresetDraftRow();
  completionPresetToggleRawOrder(row && row.preset, index, enabled);
  completionPresetRenderPrompts();
}
function moveCompletionPresetPrompt(index, delta) {
  var row = completionPresetDraftRow();
  if (!completionPresetMoveVisibleRawOrder(row && row.preset, index, delta)) return;
  completionPresetRenderPrompts();
}
function moveCompletionPresetPromptToUnused(index) {
  var row = completionPresetDraftRow();
  if (!completionPresetMoveRawPromptToUnused(row && row.preset, index)) return false;
  completionPresetRenderPrompts();
  return true;
}
async function deleteCompletionPresetPrompt(index) {
  var row = completionPresetDraftRow(),
    raw = row && row.preset,
    prompt = completionPresetCustomDefinition(raw, index);
  if (!prompt) return false;
  var name = String(prompt.name || prompt.identifier || '未命名提示词');
  if (!(await appConfirm('确定删除“' + name + '”？这会从当前预设移除该提示词定义。', '删除提示词', '删除')))
    return false;
  if (!completionPresetDeleteRawCustomPrompt(raw, index)) return false;
  completionPresetRenderPrompts();
  return true;
}
function addUnusedCompletionPresetPrompt(promptIndex) {
  var row = completionPresetDraftRow();
  if (!completionPresetAddUnusedRawPrompt(row && row.preset, promptIndex)) return false;
  completionPresetRenderPrompts();
  return true;
}
// A new prompt is staged, not written: it only joins raw.prompts when 完成 commits it, so 取消 and
// the header ✕ leave the draft exactly as it was. Like SillyTavern's PromptManager.addPrompt, the
// committed prompt lands in the definition list only — prompt_order stays untouched, so it shows up
// under 备用提示词 until the user places it. Ticking 直接启用 instead appends it, enabled, to the
// end of the active order.
function addCompletionPresetPrompt() {
  var row = completionPresetDraftRow(),
    raw = row && row.preset;
  if (!raw || !Array.isArray(raw.prompts)) return;
  _completionPresetPromptPending = {
    identifier: presetUuid(),
    name: '新提示词',
    role: 'system',
    content: '',
    system_prompt: false,
    marker: false,
    injection_position: 0,
    injection_depth: 4,
    injection_order: 100,
    forbid_overrides: false,
  };
  openCompletionPresetPromptEditor(_completionPresetPromptPending, raw.prompts.length);
  $('pm-entry-enable').checked = false;
  $('pm-entry-enable-field').hidden = false;
}
function cancelCompletionPresetPrompt() {
  _completionPresetPromptPending = null;
  closeModal('prompt-entry-modal');
}
function editCompletionPresetPrompt(index) {
  var row = completionPresetDraftRow(),
    prompt = row && row.preset && row.preset.prompts && row.preset.prompts[index];
  if (!prompt) return;
  _completionPresetPromptPending = null;
  openCompletionPresetPromptEditor(prompt, index);
  $('pm-entry-enable-field').hidden = true;
}
// What the entry editor shows for a stored prompt, including the SillyTavern defaults of absent fields; 完成 writes
// back only the fields whose form value moved away from this.
function completionPresetEntryFormValues(prompt) {
  return {
    'pm-entry-name': String(prompt.name || ''),
    'pm-entry-role': ['system', 'user', 'assistant'].includes(prompt.role) ? prompt.role : 'system',
    'pm-entry-content': String(prompt.content || ''),
    'pm-entry-position': Number(prompt.injection_position) === 1 ? 'in_chat' : 'relative',
    'pm-entry-depth': String(Number(prompt.injection_depth ?? 4)),
    'pm-entry-order': String(Number(prompt.injection_order ?? 100)),
  };
}
function completionPresetEntryNumber(value, fallback) {
  var number = String(value).trim() === '' ? NaN : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function openCompletionPresetPromptEditor(prompt, index) {
  _completionPresetPromptIndex = index;
  var shown = completionPresetEntryFormValues(prompt);
  Object.keys(shown).forEach(function (id) {
    $(id).value = shown[id];
  });
  $('pm-entry-id').value = String(prompt.identifier || '');
  var marker = prompt.marker === true,
    identifier = String(prompt.identifier || ''),
    source = PRESET_PLACEHOLDER_SOURCES[identifier] || '预设提供的占位';
  $('pm-entry-content-field').hidden = marker;
  $('pm-entry-impersonate-field').hidden = marker;
  $('pm-entry-impersonate').checked = presetPromptTriggered(prompt, 'impersonate');
  $('pm-entry-marker').hidden = !marker;
  $('pm-entry-marker-source').textContent = source;
  $('pm-entry-position').disabled = !presetPromptPositionEditable(identifier);
  $('pm-entry-position-fields').hidden = $('pm-entry-position').value !== 'in_chat';
  openModal('prompt-entry-modal');
}
function syncCompletionPresetEntryPosition() {
  if ($('pm-entry-position-fields')) $('pm-entry-position-fields').hidden = $('pm-entry-position').value !== 'in_chat';
}
function saveCompletionPresetPrompt() {
  var row = completionPresetDraftRow(),
    raw = row && row.preset,
    pending = _completionPresetPromptPending,
    prompt = pending || (raw && raw.prompts && raw.prompts[_completionPresetPromptIndex]);
  if (!prompt) return;
  if (pending && !(raw && Array.isArray(raw.prompts))) return;
  var shown = completionPresetEntryFormValues(prompt),
    changed = function (id) {
      return completionPresetFormValueChanged(shown[id], $(id).value);
    };
  if (changed('pm-entry-name')) prompt.name = $('pm-entry-name').value.trim() || prompt.name;
  if (changed('pm-entry-role')) prompt.role = $('pm-entry-role').value;
  if (prompt.marker !== true && changed('pm-entry-content')) prompt.content = $('pm-entry-content').value;
  if (prompt.marker !== true) {
    var triggers = Array.isArray(prompt.injection_trigger) ? prompt.injection_trigger : [],
      impersonate = $('pm-entry-impersonate').checked;
    if (impersonate !== presetPromptTriggered(prompt, 'impersonate')) {
      // Missing/empty means all ST generation types. Materialize ordinary modes only when opting out.
      var nextTriggers = impersonate
        ? triggers.concat('impersonate')
        : (triggers.length ? triggers : ['normal', 'continue', 'swipe', 'regenerate', 'quiet']).filter(function (type) {
            return type !== 'impersonate';
          });
      if (!nextTriggers.length) {
        // ST treats an empty trigger list as all types. Turning off an impersonate-only entry therefore
        // disables its active order references; every other type was already inactive.
        nextTriggers = ['normal', 'continue', 'swipe', 'regenerate', 'quiet'];
        presetOrderRow(raw).order.forEach(function (item) {
          if (item.identifier === prompt.identifier) item.enabled = false;
        });
      }
      prompt.injection_trigger = nextTriggers;
    }
  }
  if (presetPromptPositionEditable(prompt.identifier)) {
    if (changed('pm-entry-position')) prompt.injection_position = $('pm-entry-position').value === 'in_chat' ? 1 : 0;
    if (changed('pm-entry-depth')) prompt.injection_depth = completionPresetEntryNumber($('pm-entry-depth').value, 4);
    if (changed('pm-entry-order')) prompt.injection_order = completionPresetEntryNumber($('pm-entry-order').value, 100);
  }
  if (pending) {
    raw.prompts.push(pending);
    _completionPresetPromptIndex = raw.prompts.length - 1;
    if ($('pm-entry-enable').checked) completionPresetAddUnusedRawPrompt(raw, _completionPresetPromptIndex);
    _completionPresetPromptPending = null;
    completionPresetNotifyDraftChanged();
  }
  closeModal('prompt-entry-modal');
  completionPresetRenderPrompts();
}
function loadPromptManager() {
  var s = presetSettingsStore();
  _completionPresetDraftRows = cloneData(s.chatCompletionPresets);
  _completionPresetDraftActive =
    s.activeChatCompletionPresetName &&
    _completionPresetDraftRows.some(function (row) {
      return row.name === s.activeChatCompletionPresetName;
    })
      ? s.activeChatCompletionPresetName
      : '';
  _completionPresetDefaultRaw = cloneData(
    !_completionPresetDraftActive && s.chatCompletionPresetInUse
      ? s.chatCompletionPresetInUse
      : completionPresetDefaultRaw()
  );
  _completionPresetNoteDraft = {
    authorsNote: String(s.authorsNote ?? DEFAULT_AUTHORS_NOTE),
    anDepth: Math.max(0, Number(s.anDepth) || 0),
    anFreq: completionPresetAuthorNoteFrequency(s.anFreq, 2),
    authorNotePosition: s.authorNotePosition || 'chat',
    authorNoteRole: s.authorNoteRole || 'system',
  };
  _completionPresetGlobalSettingsDraft = cloneData(s);
  _completionPresetStartReplyEdited = false;
  _completionPresetTasksEnabledDraft = s.presetEmbeddedTasksEnabled === true;
  completionPresetBindDraftChanges();
  completionPresetBindPromptReorder();
  completionPresetRenderFields();
  switchCompletionPresetTab('manage');
  if (typeof resetPresetRoundPreview === 'function') resetPresetRoundPreview();
  completionPresetNotifyDraftChanged();
  if (typeof stscriptPromptFeatureRenderUi === 'function') stscriptPromptFeatureRenderUi();
}
function applyPromptManagerForm(targetSettings) {
  completionPresetCaptureFields();
  var s = targetSettings || presetSettingsStore();
  s.chatCompletionPresets = cloneData(_completionPresetDraftRows || []);
  s.activeChatCompletionPresetName = _completionPresetDraftActive;
  var row = s.chatCompletionPresets.find(function (item) {
    return item.name === _completionPresetDraftActive;
  });
  s.chatCompletionPresetInUse = cloneData(
    row ? row.preset : _completionPresetDefaultRaw || completionPresetDefaultRaw()
  );
  s.presetEmbeddedTasksEnabled = _completionPresetTasksEnabledDraft === true;
  if (_completionPresetNoteDraft) {
    s.authorsNote = String(_completionPresetNoteDraft.authorsNote || '');
    s.anDepth = Math.max(0, Math.floor(Number(_completionPresetNoteDraft.anDepth) || 0));
    s.anFreq = completionPresetAuthorNoteFrequency(_completionPresetNoteDraft.anFreq, 2);
    s.authorNotePosition = _completionPresetNoteDraft.authorNotePosition || 'chat';
    s.authorNoteRole = _completionPresetNoteDraft.authorNoteRole || 'system';
  }
  if (_completionPresetGlobalSettingsDraft) {
    if (_completionPresetStartReplyEdited)
      s.startReplyWith = String(_completionPresetGlobalSettingsDraft.startReplyWith || '');
    s.styleAuditEnabled = _completionPresetGlobalSettingsDraft.styleAuditEnabled === true;
    s.systemPromptProfiles = cloneData(_completionPresetGlobalSettingsDraft.systemPromptProfiles || []);
    s.activeSystemPromptProfileId = _completionPresetGlobalSettingsDraft.activeSystemPromptProfileId || '';
    s.systemPromptEnabled = _completionPresetGlobalSettingsDraft.systemPromptEnabled === true;
    var overrides = cloneData(presetSettingsStore().assistantPromptOverrides || {}),
      draftOverrides = _completionPresetGlobalSettingsDraft.assistantPromptOverrides || {};
    assistantPromptSurfaceDefinitions('prompt-presets').forEach(function (assistant) {
      if (draftOverrides[assistant.key]) overrides[assistant.key] = cloneData(draftOverrides[assistant.key]);
      else delete overrides[assistant.key];
    });
    s.assistantPromptOverrides = overrides;
  }
  return s;
}
async function completionPresetRefreshRuntime(name, transaction) {
  var char = typeof getChar === 'function' ? getChar() : null,
    sess = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  if (typeof presetTaskCall === 'function') await presetTaskCall('onPresetChanged', name);
  if (typeof invalidateRegexScriptRuntimeCache === 'function') invalidateRegexScriptRuntimeCache();
  if (typeof invalidateCardScriptDisplayCache === 'function') invalidateCardScriptDisplayCache();
  if (typeof cardScriptLibraryDispose === 'function') cardScriptLibraryDispose();
  var live = char && typeof syncCardScriptLibrary === 'function' ? syncCardScriptLibrary(char) : null;
  if (live && transaction) transaction.internalLives.add(live);
  if (live && typeof cardScriptLibraryAwaitReady === 'function') await cardScriptLibraryAwaitReady(live);
  if (typeof cardScriptLibrarySillyTavernEmitAsync === 'function') {
    await cardScriptLibrarySillyTavernEmitAsync('oai_preset_changed_after', [], live);
    await cardScriptLibrarySillyTavernEmitAsync('preset_changed', [{ apiId: 'openai', name: name }], live);
  } else if (typeof cardScriptLibrarySillyTavernEmit === 'function') {
    cardScriptLibrarySillyTavernEmit('oai_preset_changed_after', []);
    cardScriptLibrarySillyTavernEmit('preset_changed', [{ apiId: 'openai', name: name }]);
  }
  if (char && sess && typeof prepareRegexScriptDisplayTexts === 'function')
    await prepareRegexScriptDisplayTexts(char, sess.msgs || []);
  if (typeof renderChat === 'function') renderChat();
  if (char && typeof updateTokensBar === 'function') updateTokensBar(char);
}
async function savePromptManager() {
  if (blockDuringGeneration('保存提示词预设')) return;
  var beforeTab = _completionPresetTab,
    name = _completionPresetDraftActive || YEYU_DEFAULT_PRESET_NAME,
    patch;
  try {
    await completionPresetApplySettings(function () {
      return (patch = applyPromptManagerForm({}));
    }, name);
  } catch (error) {
    loadPromptManager();
    switchCompletionPresetTab(beforeTab);
    toast('提示词预设保存失败，原预设已恢复：' + error.message, 'err');
    return;
  }
  if (patch.styleAuditEnabled !== true && typeof clearStyleAuditStates === 'function') clearStyleAuditStates();
  completionPresetRenderTasks();
  completionPresetNotifyDraftChanged();
  if (typeof renderStyleAuditStatus === 'function') renderStyleAuditStatus();
  toast(_completionPresetDraftActive ? '预设已保存并切换，已立即生效' : '夜欲默认已保存，已立即生效', 'ok');
}
Object.assign(window, {
  isPresetNormalPrompt: isPresetNormalPrompt,
  isPresetSystemPrompt: isPresetSystemPrompt,
  isPresetPlaceholderPrompt: isPresetPlaceholderPrompt,
  default_preset: default_preset,
  getPresetNames: getPresetNames,
  getLoadedPresetName: getLoadedPresetName,
  loadPreset: loadPreset,
  createPreset: createPreset,
  createOrReplacePreset: createOrReplacePreset,
  deletePreset: deletePreset,
  renamePreset: renamePreset,
  getPreset: getPreset,
  replacePreset: replacePreset,
  updatePresetWith: updatePresetWith,
  setPreset: setPreset,
});
