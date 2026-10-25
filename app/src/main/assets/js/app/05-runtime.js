// A route with thinkingConfigurable false stores no effort: its thinking-relevant request options
// (structured JSON, or thinking off) are fixed here as requestOptions, the single source that both its
// real requests and the settings page's connectivity test read through modelRouteRequestOptions.
const MODEL_ROUTE_DEFINITIONS = [
  {
    key: 'translation',
    label: '消息与作者注记翻译',
    translation: true,
    thinkingConfigurable: true,
  },
  {
    key: 'greetingOverview',
    label: '开场白中文概览',
    translation: true,
    thinkingConfigurable: true,
  },
  {
    key: 'importLocalization',
    label: '角色卡与世界书名称汉化',
    translation: true,
    thinkingConfigurable: false,
    requestOptions: { structured: true },
  },
  {
    key: 'wheelScheme',
    label: '转盘方案人物志',
    translation: false,
    thinkingConfigurable: true,
  },
  {
    key: 'memorySummary',
    label: '长记忆整理',
    translation: false,
    thinkingConfigurable: false,
    requestOptions: { structured: true },
  },
  {
    key: 'styleAudit',
    label: '回复文风检查',
    translation: false,
    thinkingConfigurable: false,
    requestOptions: { disableThinking: true },
  },
  { key: 'impersonate', label: '代替用户回复', translation: false, thinkingConfigurable: true },
  { key: 'imagePrompt', label: '出图提示词', translation: false, thinkingConfigurable: true },
];
// The fixed request options a route's definition records, as a fresh copy callers may extend.
function modelRouteRequestOptions(key) {
  var def = MODEL_ROUTE_DEFINITIONS.find(function (x) {
    return x.key === key;
  });
  return Object.assign({}, (def && def.requestOptions) || {});
}
const TASK_MAX_TOKENS_MAX = 393216;
// 0 表示不限：请求不发送 max_tokens，由供应商决定，与 settings.maxTokens 同义。
const TASK_MAX_TOKEN_DEFAULTS = { styleAuditMaxTokens: 0, wheelSchemeMaxTokens: 0 };
function normalizeTaskMaxTokens(value, defaultValue) {
  var number = Number(value),
    minimum = defaultValue === 0 ? 0 : 1;
  return Number.isFinite(number) && Number.isInteger(number) && number >= minimum && number <= TASK_MAX_TOKENS_MAX
    ? number
    : defaultValue;
}
// settings.maxTokens 与请求的 max_tokens：0 为不限。按数值解析（手填的 1e5 是十万，不是 1），
// 小数取整，越界夹到 [0, TASK_MAX_TOKENS_MAX]。
function clampReplyMaxTokens(value) {
  var number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(TASK_MAX_TOKENS_MAX, number)) : 0;
}
function ensureTaskMaxTokens(settings) {
  if (!settings || typeof settings !== 'object') return false;
  var changed = false;
  Object.keys(TASK_MAX_TOKEN_DEFAULTS).forEach(function (key) {
    var normalized = normalizeTaskMaxTokens(settings[key], TASK_MAX_TOKEN_DEFAULTS[key]);
    if (settings[key] !== normalized) {
      settings[key] = normalized;
      changed = true;
    }
  });
  return changed;
}
function taskMaxTokens(key) {
  var defaultValue = Object.prototype.hasOwnProperty.call(TASK_MAX_TOKEN_DEFAULTS, key)
    ? TASK_MAX_TOKEN_DEFAULTS[key]
    : 0;
  return normalizeTaskMaxTokens(D && D.settings && D.settings[key], defaultValue);
}
function normalizePromptPostProcessing(value) {
  var mode = String(value || 'none')
    .trim()
    .toLowerCase();
  return ['none', 'merge', 'semi', 'strict', 'single'].includes(mode) ? mode : 'none';
}
function makeDefaultProvider() {
  return {
    id: 'provider_default',
    name: '默认服务商',
    protocol: 'openai',
    apiUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    apiKeys: [],
    activeApiKeyId: '',
    model: 'deepseek-chat',
    models: [],
    promptPostProcessing: 'none',
    enabled: true,
  };
}
function normalizeProviderApiKeys(provider) {
  provider = provider || {};
  var seen = new Set(),
    rows = (Array.isArray(provider.apiKeys) ? provider.apiKeys : [])
      .map(function (value, index) {
        var row = value && typeof value === 'object' && !Array.isArray(value) ? Object.assign({}, value) : {},
          id = String(row.id || 'key_' + index + '_' + uid()).trim();
        if (!id || seen.has(id)) id = 'key_' + index + '_' + uid();
        seen.add(id);
        return Object.assign(row, {
          id: id,
          label: String(row.label || '密钥 ' + (index + 1)).trim() || '密钥 ' + (index + 1),
          value: String(row.value || ''),
        });
      })
      .filter(function (row) {
        return !!row.id;
      });
  var legacy = String(provider.apiKey || ''),
    activeId = String(provider.activeApiKeyId || '');
  if (!rows.length && legacy) {
    activeId = 'key_' + uid();
    rows.push({ id: activeId, label: '默认密钥', value: legacy });
  }
  if (
    !activeId ||
    !rows.some(function (row) {
      return row.id === activeId;
    })
  )
    activeId = rows.length ? rows[0].id : '';
  provider.apiKeys = rows;
  provider.activeApiKeyId = activeId;
  provider.apiKey = activeId
    ? String(
        (
          rows.find(function (row) {
            return row.id === activeId;
          }) || {}
        ).value || ''
      )
    : legacy;
  return provider;
}
function providerActiveApiKey(provider) {
  normalizeProviderApiKeys(provider);
  var row = (provider.apiKeys || []).find(function (item) {
    return item.id === provider.activeApiKeyId;
  });
  return row ? String(row.value || '') : String(provider.apiKey || '');
}
function setProviderActiveApiKeyValue(provider, value) {
  normalizeProviderApiKeys(provider);
  value = String(value || '');
  var row = (provider.apiKeys || []).find(function (item) {
    return item.id === provider.activeApiKeyId;
  });
  if (!row && value) {
    row = { id: 'key_' + uid(), label: '默认密钥', value: '' };
    provider.apiKeys.push(row);
    provider.activeApiKeyId = row.id;
  }
  if (row) row.value = value;
  provider.apiKey = value;
  return value;
}
function normalizeProviderRecord(value, index) {
  var p = Object.assign({}, value || {}),
    id = String(p.id || 'provider_' + index + '_' + uid()).trim();
  p.id = id || 'provider_' + index + '_' + uid();
  p.name = String(p.name || '服务商 ' + (index + 1)).trim() || '服务商 ' + (index + 1);
  p.apiUrl = String(p.apiUrl || '')
    .trim()
    .replace(/\/+$/, '');
  p.protocol = ['openai', 'anthropic', 'gemini', 'grok-subscription'].includes(p.protocol) ? p.protocol : 'openai';
  if (p.protocol === 'grok-subscription') p.apiUrl = 'https://api.x.ai/v1';
  p.apiKey = String(p.apiKey || '');
  normalizeProviderApiKeys(p);
  p.model = String(p.model || '').trim();
  p.models = Array.from(
    new Set(
      (Array.isArray(p.models) ? p.models : [])
        .map(function (x) {
          return String(typeof x === 'string' ? x : (x && x.id) || (x && x.name) || '').trim();
        })
        .filter(Boolean)
    )
  ).slice(0, 500);
  p.promptPostProcessing = normalizePromptPostProcessing(p.promptPostProcessing);
  delete p.capabilities;
  delete p.capabilityCache;
  p.enabled = p.enabled !== false;
  return p;
}
// 图片来源：Grok 订阅复用本机 Grok 登录；自定义来源按 format 选择 OpenAI Images 或 Gemini generateContent。
// promptMode 决定写出图提示词的方式，缺省或非法一律 summary（直接总结）；未知字段保留。
const IMAGE_SOURCE_TYPES = ['grok-subscription', 'openai'];
const IMAGE_PROMPT_MODES = ['summary', 'desensitize'];
function normalizeImageSourceRecord(source, index) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  var row = Object.assign({}, source),
    count = Math.floor(Number(row.n));
  row.id = String(row.id || '').trim() || 'image_source_' + uid();
  row.type = IMAGE_SOURCE_TYPES.includes(row.type) ? row.type : 'openai';
  if (row.type === 'openai' && row.format != null) row.format = row.format === 'gemini' ? 'gemini' : 'openai';
  row.name =
    String(row.name || '').trim() || (row.type === 'grok-subscription' ? 'Grok 订阅' : '图片来源 ' + (index + 1));
  if (row.type === 'grok-subscription') {
    row.apiUrl = 'https://api.x.ai/v1';
    delete row.apiKey;
  } else {
    row.apiUrl = String(row.apiUrl || '')
      .trim()
      .replace(/\/+$/, '');
    row.apiKey = String(row.apiKey || '').trim();
  }
  row.model = String(row.model || '').trim();
  row.models = Array.from(
    new Set(
      (Array.isArray(row.models) ? row.models : [])
        .map(function (model) {
          return String(model || '').trim();
        })
        .filter(Boolean)
    )
  );
  row.aspectRatio = String(row.aspectRatio || '').trim();
  row.size = String(row.size || '').trim();
  row.n = count >= 1 && count <= 4 ? count : 1;
  row.promptMode = IMAGE_PROMPT_MODES.includes(row.promptMode) ? row.promptMode : 'summary';
  return row;
}
function ensureImageSourceSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  var before = JSON.stringify([settings.imageSources, settings.activeImageSourceId]);
  settings.imageSources = (Array.isArray(settings.imageSources) ? settings.imageSources : [])
    .map(normalizeImageSourceRecord)
    .filter(Boolean);
  if (
    !settings.imageSources.some(function (row) {
      return row.id === settings.activeImageSourceId;
    })
  )
    settings.activeImageSourceId = settings.imageSources.length ? settings.imageSources[0].id : '';
  return JSON.stringify([settings.imageSources, settings.activeImageSourceId]) !== before;
}
function ensureProviderSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  var changed = false;
  var settingsKeyCount = Object.keys(settings).length;
  delete settings.apiUrl;
  delete settings.apiKey;
  delete settings.model;
  delete settings.providerSchemaVersion;
  delete settings.taskOutputTokenLimits;
  delete settings.dataMigrationVersion;
  delete settings.vc99AuthorNoteCleared;
  delete settings.vc102PromptDefaultsMigrated;
  delete settings.vc102SessionMemoryMigrated;
  delete settings.vc104MainPromptMigrated;
  delete settings.vc111TranslationPromptMigrated;
  delete settings.vc114EnsemblePromptMigrated;
  delete settings.vc115PromptDefaultsMigrated;
  delete settings.vc116ChubPromptThemeMigrated;
  delete settings.vc118ChatMediaBoundaryMigrated;
  delete settings.vc119ProviderRoutingMigrated;
  delete settings.vc120AuxiliaryResponseMigrated;
  delete settings.vc122MemoryMediaRoutingMigrated;
  delete settings.vc125PromptPresetsMigrated;
  delete settings.vc126ImeSelectImportMigrated;
  delete settings.vc200BranchSummaryPromoted;
  delete settings.vc200MemoryFrequencyMigrated;
  delete settings.vc200RollingHistoryMigrated;
  delete settings.vc211DefaultPromptsSwapMigrated;
  delete settings.vc211PerRouteThinkingMigrated;
  delete settings.vc244DefaultPromptsMigrated;
  delete settings.tavilyApiKey;
  delete settings.firecrawlApiKey;
  delete settings.assistantResearchQueryMaxTokens;
  delete settings.assistantTaskMaxTokens;
  if (Object.keys(settings).length !== settingsKeyCount) changed = true;
  if (!Array.isArray(settings.providers) || !settings.providers.length) {
    settings.providers = [makeDefaultProvider()];
    changed = true;
  }
  var providersBeforeNormalization = JSON.stringify(settings.providers);
  if (
    settings.providers.some(function (provider) {
      return (
        provider &&
        typeof provider === 'object' &&
        (Object.prototype.hasOwnProperty.call(provider, 'capabilities') ||
          Object.prototype.hasOwnProperty.call(provider, 'capabilityCache'))
      );
    })
  )
    changed = true;
  if (
    settings.providers.some(function (provider) {
      return (
        !provider || normalizePromptPostProcessing(provider.promptPostProcessing) !== provider.promptPostProcessing
      );
    })
  )
    changed = true;
  settings.providers = settings.providers.map(normalizeProviderRecord).filter(function (p) {
    return p && p.id;
  });
  if (JSON.stringify(settings.providers) !== providersBeforeNormalization) changed = true;
  if (!settings.providers.length) {
    settings.providers = [makeDefaultProvider()];
    changed = true;
  }
  if (
    !settings.activeProviderId ||
    !settings.providers.some(function (p) {
      return p.id === settings.activeProviderId && p.enabled !== false;
    })
  ) {
    settings.activeProviderId =
      settings.providers.find(function (p) {
        return p.enabled !== false;
      })?.id || settings.providers[0].id;
    changed = true;
  }
  if (!Array.isArray(settings.modelPresets) || !settings.modelPresets.length) {
    settings.modelPresets = [{ id: 'preset_default', name: '默认路由', routes: {} }];
    changed = true;
  }
  settings.modelPresets = settings.modelPresets.map(function (p, index) {
    var row = Object.assign({}, p || {});
    row.id = String(row.id || 'preset_' + index + '_' + uid());
    row.name = String(row.name || '路由预设 ' + (index + 1)).trim() || '路由预设 ' + (index + 1);
    row.routes = row.routes && typeof row.routes === 'object' && !Array.isArray(row.routes) ? row.routes : {};
    delete row.routes.cardScriptAux;
    return row;
  });
  if (
    !settings.activeModelPresetId ||
    !settings.modelPresets.some(function (p) {
      return p.id === settings.activeModelPresetId;
    })
  ) {
    settings.activeModelPresetId = settings.modelPresets[0].id;
    changed = true;
  }
  if (typeof settings.activeConnectionProfileId !== 'string') {
    var initialConnectionProfile = settings.modelPresets.find(function (preset) {
      return preset.id === settings.activeModelPresetId && preset.routes && preset.routes.chat;
    });
    settings.activeConnectionProfileId = initialConnectionProfile ? initialConnectionProfile.id : '';
    changed = true;
  } else if (
    settings.activeConnectionProfileId &&
    !settings.modelPresets.some(function (preset) {
      return preset.id === settings.activeConnectionProfileId && preset.routes && preset.routes.chat;
    })
  ) {
    settings.activeConnectionProfileId = '';
    changed = true;
  }
  if (typeof settings.styleAuditEnabled !== 'boolean') {
    settings.styleAuditEnabled = false;
    changed = true;
  }
  if (typeof settings.embeddingEnabled !== 'boolean') {
    settings.embeddingEnabled = false;
    changed = true;
  }
  if (typeof settings.vectorChatsEnabled !== 'boolean') {
    settings.vectorChatsEnabled = true;
    changed = true;
  }
  if (!Array.isArray(settings.regexPresets)) {
    settings.regexPresets = [];
    changed = true;
  }
  if (typeof settings.activeRegexPresetId !== 'string') {
    settings.activeRegexPresetId = '';
    changed = true;
  }
  var embeddingUrl = String(settings.embeddingApiUrl || '')
      .trim()
      .replace(/\/+$/, ''),
    embeddingKey = String(settings.embeddingApiKey || ''),
    embeddingModel = String(settings.embeddingModel || '').trim(),
    embeddingDimensions = Number(settings.embeddingDimensions);
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0) embeddingDimensions = 0;
  if (settings.embeddingApiUrl !== embeddingUrl) {
    settings.embeddingApiUrl = embeddingUrl;
    changed = true;
  }
  if (settings.embeddingApiKey !== embeddingKey) {
    settings.embeddingApiKey = embeddingKey;
    changed = true;
  }
  if (settings.embeddingModel !== embeddingModel) {
    settings.embeddingModel = embeddingModel;
    changed = true;
  }
  if (settings.embeddingDimensions !== embeddingDimensions) {
    settings.embeddingDimensions = embeddingDimensions;
    changed = true;
  }
  if (typeof ensureTaskMaxTokens === 'function' && ensureTaskMaxTokens(settings)) changed = true;
  if (typeof ensureImageSourceSettings === 'function' && ensureImageSourceSettings(settings)) changed = true;
  var localizationBatchSize = Math.max(10, Math.min(120, parseInt(settings.worldBookLocalizationBatchSize) || 80));
  if (settings.worldBookLocalizationBatchSize !== localizationBatchSize) {
    settings.worldBookLocalizationBatchSize = localizationBatchSize;
    changed = true;
  }
  return changed;
}
function activeProviderForSettings(settings) {
  ensureProviderSettings(settings);
  return (
    (settings.providers || []).find(function (p) {
      return p.id === settings.activeProviderId;
    }) ||
    settings.providers[0] ||
    makeDefaultProvider()
  );
}
function activeModelPresetForSettings(settings) {
  ensureProviderSettings(settings);
  return (
    (settings.modelPresets || []).find(function (p) {
      return p.id === settings.activeModelPresetId;
    }) ||
    settings.modelPresets[0] || { id: 'preset_default', name: '默认路由', routes: {} }
  );
}
function normalizeRouteReasoningEffort(value) {
  var effort = String(value || 'inherit');
  if (effort === 'xhigh') effort = 'max';
  return ['inherit', 'off', 'auto', 'low', 'medium', 'high', 'max'].includes(effort) ? effort : 'inherit';
}
function resolveApiRoute(task, options) {
  options = options || {};
  var requestedTask = task || 'chat',
    routeTask = requestedTask,
    settings = options.settings || (D && D.settings) || {};
  ensureProviderSettings(settings);
  var current = activeProviderForSettings(settings),
    preset =
      routeTask === 'chat' && settings.activeConnectionProfileId
        ? settings.modelPresets.find(function (row) {
            return row.id === settings.activeConnectionProfileId;
          }) || { routes: {} }
        : routeTask === 'chat'
          ? { routes: {} }
          : activeModelPresetForSettings(settings),
    route = (preset.routes && preset.routes[routeTask]) || {},
    routeProvider = ((route.providerId && settings.providers) || []).find(function (p) {
      return p.id === route.providerId && p.enabled !== false;
    });
  // 代拟路由一项都没配置时整体沿用主对话，包括连接档覆盖；配了任一项才按任务路由解析其余项。
  if (
    routeTask === 'impersonate' &&
    !routeProvider &&
    !String(route.model || '').trim() &&
    normalizeRouteReasoningEffort(route.reasoningEffort) === 'inherit'
  )
    return Object.assign(resolveApiRoute('chat', options), { task: requestedTask, routeTask: routeTask });
  var provider = routeProvider || current,
    model = String(route.model || '').trim() || String(provider.model || '').trim();
  var apiUrl = String(provider.apiUrl || '').replace(/\/+$/, '');
  return {
    task: requestedTask,
    routeTask: routeTask,
    providerId: provider.id,
    protocol: provider.protocol,
    name: provider.name,
    apiUrl: apiUrl,
    apiKey: provider.protocol === 'grok-subscription' ? '' : providerActiveApiKey(provider),
    model: model,
    promptPostProcessing: normalizePromptPostProcessing(provider.promptPostProcessing),
    capabilities: {},
    translation: MODEL_ROUTE_DEFINITIONS.some(function (x) {
      return x.key === routeTask && x.translation;
    }),
    reasoningEffort: routeTask === 'chat' ? 'inherit' : normalizeRouteReasoningEffort(route.reasoningEffort),
  };
}
function overrideApiRouteUrl(route, value) {
  var url = String(value || '')
      .trim()
      .replace(/\/+$/, ''),
    sameOrigin = false;
  try {
    var current = new URL(route.apiUrl),
      replacement = new URL(url);
    sameOrigin = current.origin !== 'null' && current.origin === replacement.origin;
  } catch (_) {}
  if (!sameOrigin) {
    route.apiKey = '';
    route.headers = {};
  }
  route.apiUrl = url;
}
function setProviderThinkingMode(body, mode) {
  Object.defineProperty(body, '__yeyuThinkingMode', {
    value: String(mode || ''),
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return body;
}
function clearProviderThinkingParameters(body) {
  delete body.thinking;
  delete body.reasoning_effort;
  delete body.enable_thinking;
  delete body.reasoning;
  return body;
}
var OPTIONAL_SAMPLING_PARAMETER_RANGES = {
  temperature: [0, 2],
  top_p: [0, 1],
  frequency_penalty: [-2, 2],
  presence_penalty: [-2, 2],
  repetition_penalty: [0, 2],
  min_p: [0, 1],
  top_k: [0, 1000000],
  top_a: [0, 1],
  seed: [-1, 2147483647],
};
function optionalSamplingValue(settings, key) {
  var value = settings && settings[key];
  if (value === undefined || value === null || value === '') return null;
  var number = Number(value),
    range = OPTIONAL_SAMPLING_PARAMETER_RANGES[key];
  if (key === 'top_p' && number === 0) return null;
  return Number.isFinite(number) && range && number >= range[0] && number <= range[1] ? number : null;
}
function clearOptionalSamplingParameters(body) {
  Object.keys(OPTIONAL_SAMPLING_PARAMETER_RANGES).forEach(function (key) {
    delete body[key];
  });
  return body;
}
function applyNonThinkingSamplingParameters(body, settings) {
  clearOptionalSamplingParameters(body);
  Object.keys(OPTIONAL_SAMPLING_PARAMETER_RANGES).forEach(function (key) {
    var value = optionalSamplingValue(settings, key);
    if (value !== null) body[key] = value;
  });
  return body;
}
function providerThinkingDisableDialect(body) {
  if (body && body.thinking && body.thinking.type === 'disabled') return 'thinkingDisable.thinking';
  if (body && body.reasoning_effort === 'none') return 'thinkingDisable.reasoningEffort';
  if (body && Object.prototype.hasOwnProperty.call(body, 'enable_thinking') && body.enable_thinking === false)
    return 'thinkingDisable.enableThinking';
  if (body && body.reasoning && body.reasoning.enabled === false) return 'thinkingDisable.reasoning';
  return '';
}
function applyDisabledThinkingDialect(body, route) {
  var caps = (route && route.capabilities) || {},
    dialects = [
      'thinkingDisable.thinking',
      'thinkingDisable.reasoningEffort',
      'thinkingDisable.enableThinking',
      'thinkingDisable.reasoning',
    ],
    dialect = dialects.find(function (key) {
      return caps[key] !== false;
    });
  clearProviderThinkingParameters(body);
  if (!dialect)
    throw new Error('当前供应商或模型不支持关闭思考。请改用支持关闭思考的模型，或把“思考强度”改为“自动”后重试。');
  if (dialect === 'thinkingDisable.thinking') body.thinking = { type: 'disabled' };
  else if (dialect === 'thinkingDisable.reasoningEffort') body.reasoning_effort = 'none';
  else if (dialect === 'thinkingDisable.enableThinking') body.enable_thinking = false;
  else body.reasoning = { enabled: false };
  return body;
}
function applyStructuredResponseFormat(body, route, output) {
  var caps = (route && route.capabilities) || {},
    schema =
      output && output.schema && typeof output.schema === 'object' && !Array.isArray(output.schema)
        ? output.schema
        : null,
    name =
      String((output && output.name) || 'yeyu_structured_output')
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 64) || 'yeyu_structured_output';
  delete body.response_format;
  if (schema && caps.native_json_schema !== false)
    body.response_format = { type: 'json_schema', json_schema: { name: name, strict: true, schema: schema } };
  else if (caps.jsonObject !== false && caps.json_object !== false) body.response_format = { type: 'json_object' };
  return body;
}
function applyProviderCapabilities(body, route) {
  var caps = (route && route.capabilities) || {};
  if (caps.streamOptions === false || caps.stream_options === false) delete body.stream_options;
  if (caps.native_json_schema === false && body.response_format && body.response_format.type === 'json_schema') {
    if (caps.jsonObject !== false && caps.json_object !== false) body.response_format = { type: 'json_object' };
    else delete body.response_format;
  }
  if (
    (caps.jsonObject === false || caps.json_object === false) &&
    body.response_format &&
    body.response_format.type === 'json_object'
  )
    delete body.response_format;
  Object.keys(OPTIONAL_SAMPLING_PARAMETER_RANGES).forEach(function (key) {
    if (caps['sampling.' + key] === false) delete body[key];
  });
  if (caps.thinking === false) {
    delete body.thinking;
    delete body.reasoning_effort;
  }
  if (caps['thinkingDisable.thinking'] === false && body.thinking && body.thinking.type === 'disabled')
    delete body.thinking;
  if (caps['thinkingDisable.reasoningEffort'] === false && body.reasoning_effort === 'none')
    delete body.reasoning_effort;
  if (caps['thinkingDisable.enableThinking'] === false && body.enable_thinking === false) delete body.enable_thinking;
  if (caps['thinkingDisable.reasoning'] === false && body.reasoning && body.reasoning.enabled === false)
    delete body.reasoning;
  if (body && body.__yeyuThinkingMode === 'disabled') applyDisabledThinkingDialect(body, route);
  return body;
}
function rejectedProviderCapability(status, text, body) {
  var code = Number(status),
    message = String(text || '').toLowerCase(),
    responseFormatRejected =
      code >= 400 &&
      code < 500 &&
      body &&
      body.response_format &&
      /(response[_\s-]*format|json[_\s-]*(?:object|schema)|json mode|structured (?:output|response))/i.test(message);
  if (responseFormatRejected) return body.response_format.type === 'json_schema' ? 'native_json_schema' : 'json_object';
  if ([400, 404, 422].indexOf(code) < 0) return '';
  // Only a key the provider names is blamed. Wording such as "invalid parameter" also covers message
  // and content errors, and guessing would strip unrelated parameters one resend at a time — each with
  // the whole prompt — and still bury the provider's real reason. A key counts as named when it stands
  // on its own with underscores, spaces or hyphens: "reasoning" inside "reasoning_effort" names nothing.
  function named(key) {
    return (
      !!key &&
      !!body &&
      Object.prototype.hasOwnProperty.call(body, key) &&
      [key, key.replace(/_/g, ' '), key.replace(/_/g, '-')].some(function (form) {
        return new RegExp('(?:^|[^a-z0-9_])' + form + '(?![a-z0-9_])').test(message);
      })
    );
  }
  var disableDialect = providerThinkingDisableDialect(body),
    disableDialectKey = {
      'thinkingDisable.thinking': 'thinking',
      'thinkingDisable.reasoningEffort': 'reasoning_effort',
      'thinkingDisable.enableThinking': 'enable_thinking',
      'thinkingDisable.reasoning': 'reasoning',
    }[disableDialect],
    blamed = Object.keys(OPTIONAL_SAMPLING_PARAMETER_RANGES)
      .filter(named)
      .map(function (key) {
        return 'sampling.' + key;
      });
  if (body && body.stream_options && /stream[_ ]?options|include[_ ]?usage/i.test(message))
    blamed.push('streamOptions');
  if (
    body &&
    body.response_format &&
    body.response_format.type === 'json_schema' &&
    /response[_ ]?format|json[_ ]?schema|structured output/i.test(message)
  )
    blamed.push('native_json_schema');
  else if (body && body.response_format && /response[_ ]?format|json[_ ]?object|json mode/i.test(message))
    blamed.push('json_object');
  if (disableDialect) {
    if (named(disableDialectKey)) blamed.push(disableDialect);
  } else if (named('thinking') || named('reasoning_effort')) blamed.push('thinking');
  // A text naming several of them (a validation error echoing the request, a list of everything the
  // model refuses) cannot say which one to drop, so it reaches the user as written.
  return blamed.length === 1 ? blamed[0] : '';
}
function rejectProviderCapability(route, key) {
  if (!route || !key) return false;
  route.capabilities = route.capabilities && typeof route.capabilities === 'object' ? route.capabilities : {};
  if (route.capabilities[key] === false) return false;
  route.capabilities[key] = false;
  return true;
}
// 面向用户的 HTTP 错误分类；供应商原文保留在 error.responseText 供中断详情排障。
function providerHttpErrorText(status, raw) {
  var code = Number(status) || 0,
    map = {
      400: '请求参数被供应商拒绝，请检查模型与参数设置',
      401: 'API Key 无效，请在设置中检查',
      402: '账户余额不足，请前往供应商充值',
      403: '当前 Key 没有访问该模型的权限',
      404: '接口地址或模型不存在，请检查设置',
      408: '供应商响应超时，请稍后重试',
      413: '请求内容过长，超过供应商限制',
      422: '请求参数被供应商拒绝，请检查模型与参数设置',
      429: '请求过于频繁，请稍后再试',
      500: '服务器错误，请稍后重试',
      502: '供应商网关错误，请稍后重试',
      503: '服务暂时不可用，请稍后重试',
      504: '供应商网关超时，请稍后重试',
    };
  if ((code === 400 || code === 422 || code === 429) && raw) return String(raw);
  if (map[code]) return map[code];
  if (code >= 500) return '供应商服务异常（HTTP ' + code + '），请稍后重试';
  if (code >= 400) return '供应商拒绝了请求（HTTP ' + code + '）';
  return String(raw || 'API错误 ' + code);
}
// 供应商错误体格式各异：{error:{message}}、{error:"…"}、顶层 message、FastAPI 的 {detail:"…"} 与 422 常见的
// {detail:[{loc,msg}]}。只取供应商写给人看的文字；数组逐项取 msg 并带上 loc，说明是哪个参数出错。
function providerErrorMessage(value, depth) {
  depth = depth || 0;
  if (value == null || depth > 4) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value))
    return value
      .map(function (item) {
        return providerErrorMessage(item, depth + 1);
      })
      .filter(Boolean)
      .join('；');
  if (typeof value !== 'object') return '';
  var text = ['error', 'message', 'msg', 'detail', 'code'].reduce(function (found, key) {
      return found || providerErrorMessage(value[key], depth + 1);
    }, ''),
    loc = Array.isArray(value.loc) ? value.loc.join('.') : '';
  return text && loc ? loc + '：' + text : text;
}
// 取不到可读字段时退回截断的原始响应文本，不让供应商原文只剩状态码。
function providerErrorText(raw) {
  var text = typeof raw === 'string' ? raw.trim() : '',
    parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = null;
    }
  } else {
    try {
      text = JSON.stringify(raw) || '';
    } catch (_) {
      text = '';
    }
  }
  var message = providerErrorMessage(parsed);
  if (message) return message;
  // 网关或代理返回的 HTML 错误页只留可读文字，不把标签、样式和脚本当作错误说明。
  if (text.charAt(0) === '<')
    text = text.replace(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 500 ? text.slice(0, 500) + '…' : text;
}
async function fetchCompatibleCompletion(route, body, signal, options) {
  options = options || {};
  if (route.protocol === 'grok-subscription') {
    var grokResponse = await fetchGrokSubscription('/chat/completions', {
      body: JSON.stringify(body),
      signal: signal,
      convId: options.conversationId,
    });
    // Do not attach authorization or request data to error reports.
    if (!grokResponse.ok) throw await grokSubscriptionFailure(grokResponse);
    return grokResponse;
  }
  var lastText = '',
    lastStatus = 0;
  function providerMessage() {
    return providerErrorText(lastText) || 'API错误 ' + lastStatus;
  }
  for (var attempt = 0; attempt < 16; attempt++) {
    try {
      applyProviderCapabilities(body, route);
    } catch (error) {
      // Every way of turning thinking off was refused; the provider's answer to the last one is the evidence.
      if (lastStatus) {
        error.message += '（供应商返回：' + providerMessage() + '）';
        error.status = lastStatus;
        error.responseText = lastText;
      }
      throw error;
    }
    var nativeProtocol = route.protocol === 'anthropic' || route.protocol === 'gemini',
      nativeRequest = nativeProtocol ? nativeProviderRequest(route, body) : null;
    var resp,
      headers = Object.assign({ 'Content-Type': 'application/json' }, (route && route.headers) || {});
    if (
      route &&
      route.apiKey &&
      !Object.keys(headers).some(function (key) {
        return key.toLowerCase() === 'authorization';
      })
    )
      headers.Authorization = 'Bearer ' + route.apiKey;
    resp = await fetch(nativeRequest ? nativeRequest.url : route.apiUrl + '/chat/completions', {
      method: 'POST',
      headers: nativeRequest ? nativeRequest.headers : headers,
      body: JSON.stringify(nativeRequest ? nativeRequest.body : body),
      signal: signal,
    });
    if (resp.ok) return nativeProtocol ? nativeProviderResponse(route, resp, !!body.stream) : resp;
    lastStatus = resp.status;
    try {
      lastText = await resp.text();
    } catch (_) {
      lastText = '';
    }
    // Adapt only after Gemini explicitly refuses a model-ending request. Old models keep their
    // original prefill/continuation, and every caller-supplied turn survives the retry unchanged.
    if (
      resp.status === 400 &&
      (route.protocol === 'gemini' || /gemini/i.test(body.model || route.model || '')) &&
      /Requests ending with a model turn are not supported\.?/i.test(providerMessage()) &&
      Array.isArray(body.messages) &&
      body.messages.length &&
      body.messages[body.messages.length - 1].role === 'assistant' &&
      attempt < 15
    ) {
      body = Object.assign({}, body, {
        messages: body.messages.concat([{ role: 'user', content: '请继续上一条回复。' }]),
      });
      continue;
    }
    var rejected =
      options.retryCapabilities === false
        ? ''
        : nativeProtocol
          ? rejectedNativeProviderCapability(resp.status, lastText, body, route)
          : rejectedProviderCapability(resp.status, lastText, body);
    if (rejected && attempt < 15 && rejectProviderCapability(route, rejected)) continue;
    var failure = new Error(providerMessage());
    failure.status = lastStatus;
    failure.responseText = lastText;
    throw failure;
  }
  var fallback = new Error('API错误 ' + lastStatus);
  fallback.status = lastStatus;
  fallback.responseText = lastText;
  throw fallback;
}
// 设置页的供应商与路由表单只编辑这份草稿：保存前不碰 D.settings，
// 所以在设置页停留期间由别处触发的保存、以及请求取路由，看到的都是已保存的连接配置。
var PROVIDER_DRAFT_KEYS = [
  'providers',
  'activeProviderId',
  'modelPresets',
  'activeModelPresetId',
  'activeConnectionProfileId',
  'reasoningTemplates',
  'activeReasoningTemplateId',
  'imageSources',
  'activeImageSourceId',
];
let _providerDraft = null,
  _providerDraftBaseline = null;
function providerDraftSlice(settings) {
  var slice = {};
  PROVIDER_DRAFT_KEYS.forEach(function (key) {
    slice[key] = settings[key];
  });
  return copyJsonData(slice);
}
function beginProviderDraft() {
  if (typeof cancelProviderProbes === 'function') cancelProviderProbes();
  if (!D || !D.settings) return null;
  ensureProviderSettings(D.settings);
  if (typeof stscriptPromptSettings === 'function') stscriptPromptSettings();
  _providerDraftBaseline = providerDraftSlice(D.settings);
  _providerDraft = providerDraftSlice(D.settings);
  return _providerDraft;
}
function discardProviderDraft() {
  if (typeof cancelGrokSubscriptionLogin === 'function') cancelGrokSubscriptionLogin();
  if (typeof cancelProviderProbes === 'function') cancelProviderProbes();
  _providerDraft = null;
  _providerDraftBaseline = null;
}
// 表单的读写目标：设置页打开时是草稿，页面没打开时（脚本、启动流程）就是运行中的设置。
function providerFormSettings() {
  return _providerDraft || (D && D.settings) || null;
}
function editingProviderRecord() {
  var settings = providerFormSettings();
  if (!settings) return null;
  return activeProviderForSettings(settings);
}
function providerDraftRecordIndex(rows, id) {
  return (rows || []).findIndex(function (row) {
    return row.id === id;
  });
}
function providerDraftSameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function providerDraftKeyedRows(value) {
  return (
    Array.isArray(value) &&
    value.every(function (row) {
      return isObjectRecord(row) && row.id != null;
    })
  );
}
// Merge baseline -> live changes by leaf so unrelated draft fields survive immediate actions.
function mergeExternalProviderValue(draftValue, baselineValue, liveValue) {
  if (providerDraftSameValue(liveValue, baselineValue)) return draftValue;
  if (isObjectRecord(draftValue) && isObjectRecord(baselineValue) && isObjectRecord(liveValue)) {
    mergeExternalProviderFields(draftValue, baselineValue, liveValue);
    return draftValue;
  }
  if (
    providerDraftKeyedRows(draftValue) &&
    providerDraftKeyedRows(baselineValue) &&
    providerDraftKeyedRows(liveValue)
  ) {
    var baselineById = {};
    baselineValue.forEach(function (row) {
      baselineById[row.id] = row;
    });
    liveValue.forEach(function (row) {
      var baselineRow = baselineById[row.id],
        draftIndex = providerDraftRecordIndex(draftValue, row.id);
      if (!baselineRow) {
        if (draftIndex < 0) draftValue.push(copyJsonData(row));
      } else if (draftIndex >= 0) {
        draftValue[draftIndex] = mergeExternalProviderValue(draftValue[draftIndex], baselineRow, row);
      }
    });
    baselineValue.forEach(function (row) {
      if (providerDraftRecordIndex(liveValue, row.id) >= 0) return;
      var draftIndex = providerDraftRecordIndex(draftValue, row.id);
      if (draftIndex >= 0) draftValue.splice(draftIndex, 1);
    });
    return draftValue;
  }
  return copyJsonData(liveValue);
}
function mergeExternalProviderFields(draftRow, baselineRow, liveRow) {
  var baseline = baselineRow || {};
  Object.keys(liveRow).forEach(function (field) {
    draftRow[field] = mergeExternalProviderValue(draftRow[field], baseline[field], liveRow[field]);
  });
  Object.keys(baseline).forEach(function (field) {
    if (!(field in liveRow) && providerDraftSameValue(draftRow[field], baseline[field])) delete draftRow[field];
  });
}
// Merge saved script changes into the open form without committing unrelated edits.
function refreshProviderDraft() {
  if (!_providerDraft || !_providerDraftBaseline || !D || !D.settings) return false;
  // 先收集表单里还没写进草稿的输入，随后的重绘才不会把它们清掉。
  if ($('s-provider-select')) {
    captureProviderForm();
    captureModelPresetForm();
    if (typeof captureImageSourceForm === 'function') captureImageSourceForm();
  }
  syncProviderDraftWithSettings();
  var live = providerDraftSlice(D.settings);
  PROVIDER_DRAFT_KEYS.forEach(function (key) {
    if (!Array.isArray(live[key])) {
      if (!providerDraftSameValue(live[key], _providerDraftBaseline[key])) _providerDraft[key] = live[key];
      return;
    }
    live[key].forEach(function (row) {
      var index = providerDraftRecordIndex(_providerDraft[key], row.id);
      if (index < 0) return;
      mergeExternalProviderFields(
        _providerDraft[key][index],
        _providerDraftBaseline[key][providerDraftRecordIndex(_providerDraftBaseline[key], row.id)],
        row
      );
    });
  });
  _providerDraftBaseline = live;
  return true;
}
// Reconcile externally added/deleted rows; leaf updates are merged by refreshProviderDraft.
function syncProviderDraftWithSettings() {
  if (!_providerDraft || !_providerDraftBaseline || !D || !D.settings) return;
  ['providers', 'modelPresets', 'reasoningTemplates', 'imageSources'].forEach(function (key) {
    var live = D.settings[key] || [],
      baseline = _providerDraftBaseline[key] || [],
      draft = _providerDraft[key] || [];
    _providerDraft[key] = draft.filter(function (row) {
      return providerDraftRecordIndex(baseline, row.id) < 0 || providerDraftRecordIndex(live, row.id) >= 0;
    });
    _providerDraftBaseline[key] = baseline.filter(function (row) {
      return providerDraftRecordIndex(live, row.id) >= 0;
    });
    live.forEach(function (row) {
      if (providerDraftRecordIndex(baseline, row.id) >= 0) return;
      if (providerDraftRecordIndex(draft, row.id) < 0) _providerDraft[key].push(copyJsonData(row));
      _providerDraftBaseline[key].push(copyJsonData(row));
    });
  });
}
function commitProviderDraft(settings) {
  if (!_providerDraft || !settings) return false;
  Object.assign(settings, providerDraftSlice(_providerDraft));
  return true;
}
function captureProviderForm(providerId) {
  var settings = providerFormSettings();
  if (!settings) return null;
  ensureProviderSettings(settings);
  var id = providerId || ($('s-provider-select') && $('s-provider-select').value) || settings.activeProviderId,
    provider =
      (settings.providers || []).find(function (p) {
        return p.id === id;
      }) || activeProviderForSettings(settings);
  if ($('s-provider-name')) provider.name = $('s-provider-name').value.trim() || provider.name;
  if ($('s-provider-protocol') && $('s-provider-protocol').value) provider.protocol = $('s-provider-protocol').value;
  if (provider.protocol === 'grok-subscription') provider.apiUrl = 'https://api.x.ai/v1';
  else {
    if ($('s-api-url')) provider.apiUrl = normalizeApiBase($('s-api-url').value);
    if ($('s-api-key')) setProviderActiveApiKeyValue(provider, $('s-api-key').value.trim());
  }
  if ($('s-model')) provider.model = $('s-model').value.trim();
  if ($('s-prompt-post-processing'))
    provider.promptPostProcessing = normalizePromptPostProcessing($('s-prompt-post-processing').value);
  settings.activeProviderId = provider.id;
  return provider;
}
function routeProviderOptions(selected) {
  var options = '<option value="">跟随主对话供应商</option>',
    settings = providerFormSettings();
  ensureProviderSettings(settings);
  return (
    options +
    (settings.providers || [])
      .filter(function (p) {
        return p.enabled !== false;
      })
      .map(function (p) {
        return (
          '<option value="' +
          escAttr(p.id) +
          '"' +
          (p.id === selected ? ' selected' : '') +
          '>' +
          esc(p.name) +
          '</option>'
        );
      })
      .join('')
  );
}
function routeModelOptions(providerId, selected) {
  var settings = providerFormSettings();
  ensureProviderSettings(settings);
  var provider =
      (settings.providers || []).find(function (p) {
        return p.id === providerId;
      }) || activeProviderForSettings(settings),
    ids = Array.isArray(provider.models) ? provider.models.slice() : [],
    value = String(selected || '').trim(),
    options = '<option value="">跟随该供应商默认模型</option>';
  if (value && ids.indexOf(value) < 0)
    options += '<option value="' + escAttr(value) + '" selected>当前已保存：' + esc(value) + '</option>';
  return (
    options +
    ids
      .map(function (id) {
        return '<option value="' + escAttr(id) + '"' + (id === value ? ' selected' : '') + '>' + esc(id) + '</option>';
      })
      .join('')
  );
}
function routeReasoningEffortOptions(selected) {
  selected = normalizeRouteReasoningEffort(selected);
  return [
    ['inherit', '思考：跟随全局'],
    ['off', '思考：关闭'],
    ['auto', '思考：自动'],
    ['low', '思考：低'],
    ['medium', '思考：中'],
    ['high', '思考：高'],
    ['max', '思考：最大'],
  ]
    .map(function (row) {
      return '<option value="' + row[0] + '"' + (row[0] === selected ? ' selected' : '') + '>' + row[1] + '</option>';
    })
    .join('');
}
function changeRouteProvider(key) {
  captureModelPresetForm();
  var preset = activeModelPresetForSettings(providerFormSettings()),
    provider = $('s-route-' + key + '-provider'),
    providerId = provider ? provider.value : '',
    route = Object.assign({}, (preset.routes && preset.routes[key]) || {});
  if (providerId) {
    route.providerId = providerId;
    delete route.model;
  } else {
    delete route.providerId;
    delete route.model;
  }
  if (Object.keys(route).length) preset.routes[key] = route;
  else delete preset.routes[key];
  renderModelPresetForm();
}
function routeModelProviderId(key) {
  var el = $('s-route-' + key + '-provider'),
    id = el && el.value;
  return id || activeProviderForSettings(providerFormSettings()).id;
}
function captureModelPresetForm() {
  var settings = providerFormSettings();
  if (!settings) return;
  ensureProviderSettings(settings);
  var preset = activeModelPresetForSettings(settings);
  if ($('s-model-preset-name')) preset.name = $('s-model-preset-name').value.trim() || preset.name;
  preset.routes = preset.routes && typeof preset.routes === 'object' ? preset.routes : {};
  // 路由行是渲染出来的；容器 s-model-routes 空着时下面每一条都会读成“留空”，把已保存的路由全删掉。
  if (!$('s-route-' + MODEL_ROUTE_DEFINITIONS[0].key + '-provider')) return;
  MODEL_ROUTE_DEFINITIONS.forEach(function (def) {
    var provider = $('s-route-' + def.key + '-provider'),
      model = $('s-route-' + def.key + '-model'),
      thinking = $('s-route-' + def.key + '-thinking'),
      providerId = provider ? provider.value : '',
      modelId = model ? model.value.trim() : '',
      effort = def.thinkingConfigurable ? normalizeRouteReasoningEffort(thinking && thinking.value) : 'inherit',
      route = Object.assign({}, preset.routes[def.key] || {});
    if (providerId) route.providerId = providerId;
    else delete route.providerId;
    if (modelId) route.model = modelId;
    else delete route.model;
    if (effort !== 'inherit') route.reasoningEffort = effort;
    else delete route.reasoningEffort;
    if (Object.keys(route).length) preset.routes[def.key] = route;
    else delete preset.routes[def.key];
  });
}
function renderModelPresetForm() {
  if (!D || !D.settings || !$('s-model-preset-select')) return;
  syncProviderDraftWithSettings();
  var settings = providerFormSettings();
  ensureProviderSettings(settings);
  var preset = activeModelPresetForSettings(settings),
    select = $('s-model-preset-select');
  select.innerHTML = (settings.modelPresets || [])
    .map(function (p) {
      return (
        '<option value="' +
        escAttr(p.id) +
        '"' +
        (p.id === preset.id ? ' selected' : '') +
        '>' +
        esc(p.name) +
        '</option>'
      );
    })
    .join('');
  if ($('s-model-preset-name')) $('s-model-preset-name').value = preset.name;
  var box = $('s-model-routes');
  if (!box) return;
  box.innerHTML = MODEL_ROUTE_DEFINITIONS.map(function (def) {
    var route = (preset.routes && preset.routes[def.key]) || {},
      providerId = String(route.providerId || ''),
      thinking = def.thinkingConfigurable
        ? '<select id="s-route-' +
          def.key +
          '-thinking" class="model-route-thinking" onchange="captureModelPresetForm()" aria-label="' +
          escAttr(def.label) +
          '思考档位">' +
          routeReasoningEffortOptions(route.reasoningEffort) +
          '</select>'
        : '<span class="model-route-thinking-fixed">思考固定关闭</span>';
    return (
      '<div class="model-route-row"><div class="model-route-hd"><strong>' +
      esc(def.label) +
      '</strong><div class="ui-actions"><button type="button" id="s-route-' +
      def.key +
      '-detect" class="btn text sm accent" data-probe-slot="' +
      escAttr(def.key) +
      '" onclick="detectRouteModels(' +
      jsArg(def.key) +
      ')">检测模型</button><button type="button" id="s-route-' +
      def.key +
      '-test" class="btn text sm accent" data-probe-slot="' +
      escAttr(def.key) +
      '" onclick="testRouteConnectivity(' +
      jsArg(def.key) +
      ')">测试</button></div></div><div class="model-route-controls"><select id="s-route-' +
      def.key +
      '-provider" class="model-route-provider" onchange="changeRouteProvider(' +
      jsArg(def.key) +
      ')" aria-label="' +
      escAttr(def.label) +
      '供应商">' +
      routeProviderOptions(providerId) +
      '</select><select id="s-route-' +
      def.key +
      '-model" class="model-route-model" onchange="captureModelPresetForm()" aria-label="' +
      escAttr(def.label) +
      '模型">' +
      routeModelOptions(providerId, route.model) +
      '</select>' +
      thinking +
      '</div><small class="model-route-status" id="s-route-' +
      def.key +
      '-status" aria-live="polite"></small></div>'
    );
  }).join('');
  if (typeof syncProviderProbeButtons === 'function') syncProviderProbeButtons();
}
function selectProviderForEditing() {
  if (typeof cancelGrokSubscriptionLogin === 'function') cancelGrokSubscriptionLogin();
  if (typeof cancelProviderProbes === 'function') cancelProviderProbes();
  var settings = providerFormSettings(),
    previous = settings && settings.activeProviderId;
  captureProviderForm(previous);
  settings.activeProviderId = $('s-provider-select').value;
  renderProviderEditor();
  renderModelPresetForm();
}
function renderProviderEditor() {
  if (!D || !D.settings || !$('s-provider-select')) return;
  syncProviderDraftWithSettings();
  var settings = providerFormSettings();
  ensureProviderSettings(settings);
  var provider = activeProviderForSettings(settings),
    select = $('s-provider-select');
  select.innerHTML = settings.providers
    .filter(function (p) {
      return p.enabled !== false;
    })
    .map(function (p) {
      return (
        '<option value="' +
        escAttr(p.id) +
        '"' +
        (p.id === provider.id ? ' selected' : '') +
        '>' +
        esc(p.name) +
        '</option>'
      );
    })
    .join('');
  if ($('s-provider-name')) $('s-provider-name').value = provider.name;
  var protocolSelect = $('s-provider-protocol');
  if (protocolSelect) {
    if (!protocolSelect.options.length)
      protocolSelect.innerHTML = PROVIDER_PROTOCOLS.map(function (row) {
        return '<option value="' + escAttr(row.key) + '">' + esc(row.label) + '</option>';
      }).join('');
    protocolSelect.value = provider.protocol;
  }
  renderProviderApiUrlHint(provider.protocol);
  if ($('s-api-url')) $('s-api-url').value = provider.apiUrl;
  if ($('s-api-key')) $('s-api-key').value = providerActiveApiKey(provider);
  if ($('s-model')) $('s-model').value = provider.model;
  if ($('s-prompt-post-processing'))
    $('s-prompt-post-processing').value = normalizePromptPostProcessing(provider.promptPostProcessing);
  if (typeof stscriptPromptFeatureRenderUi === 'function') stscriptPromptFeatureRenderUi();
  renderGrokSubscription();
}
function providerProtocolDefaultApiUrl(protocol) {
  return (
    (
      PROVIDER_PROTOCOLS.find(function (row) {
        return row.key === protocol;
      }) || {}
    ).defaultApiUrl || ''
  );
}
function providerProtocolVersionSegment(protocol) {
  return (
    (
      PROVIDER_PROTOCOLS.find(function (row) {
        return row.key === protocol;
      }) || {}
    ).versionSegment || ''
  );
}
function renderProviderApiUrlHint(protocol) {
  var input = $('s-api-url'),
    hint = $('s-api-url-hint'),
    official = providerProtocolDefaultApiUrl(protocol),
    endpoint = protocol === 'anthropic' ? '/messages' : protocol === 'gemini' ? '/models/…' : '/chat/completions';
  if (input) input.placeholder = official || 'https://api.example.com/v1';
  if (hint)
    hint.textContent =
      (official
        ? '官方地址为 ' +
          official +
          '；中转站可只填域名，缺少版本段时自动补 /' +
          providerProtocolVersionSegment(protocol)
        : '填到版本路径为止，例如 …/v1') +
      '；对话请求发往其下的 ' +
      endpoint +
      '。';
}
// Switching type swaps in the new official address unless the user has typed their own.
function changeProviderProtocol() {
  cancelGrokSubscriptionLogin();
  var provider = editingProviderRecord(),
    select = $('s-provider-protocol'),
    input = $('s-api-url');
  if (!provider || !select) return;
  if (typeof cancelProviderProbes === 'function') cancelProviderProbes();
  var current = normalizeApiBase(input ? input.value : provider.apiUrl);
  if (input && (!current || current === providerProtocolDefaultApiUrl(provider.protocol)))
    input.value = providerProtocolDefaultApiUrl(select.value);
  provider = captureProviderForm(provider.id);
  renderProviderApiUrlHint(provider.protocol);
  if (select.value === 'grok-subscription') {
    provider.apiUrl = 'https://api.x.ai/v1';
    if (input) input.value = provider.apiUrl;
    provider.model = '';
    provider.models = [];
    if ($('s-model')) $('s-model').value = '';
  }
  renderGrokSubscription();
}
async function addApiProvider() {
  if (blockDuringGeneration('新增供应商')) return;
  captureProviderForm();
  var name = await appInput('给新的 API 供应商起一个名称。', '新供应商', '新增 API 供应商', '供应商名称', {
    okText: '添加供应商',
  });
  if (!name) return;
  var settings = providerFormSettings(),
    provider = normalizeProviderRecord(
      {
        id: 'provider_' + uid(),
        name: name,
        protocol: 'openai',
        apiUrl: '',
        apiKey: '',
        apiKeys: [],
        activeApiKeyId: '',
        model: '',
        models: [],
        promptPostProcessing: 'none',
      },
      settings.providers.length
    );
  settings.providers.push(provider);
  settings.activeProviderId = provider.id;
  renderProviderEditor();
  renderModelPresetForm();
}
async function deleteApiProvider() {
  if (blockDuringGeneration('删除供应商')) return;
  captureProviderForm();
  var settings = providerFormSettings();
  if (settings.providers.length <= 1) {
    toast('至少保留一个供应商', 'info');
    return;
  }
  var provider = activeProviderForSettings(settings);
  if (
    !(await appConfirm(
      '删除供应商“' + provider.name + '”？已保存的地址、模型和本机密钥都会从本地设置中移除。',
      '删除 API 供应商',
      '删除'
    ))
  )
    return;
  settings = providerFormSettings();
  cancelGrokSubscriptionLogin();
  settings.providers = settings.providers.filter(function (p) {
    return p.id !== provider.id;
  });
  settings.activeProviderId = settings.providers[0].id;
  renderProviderEditor();
  renderModelPresetForm();
}
async function addModelPreset() {
  if (blockDuringGeneration('新增模型路由预设')) return;
  captureProviderForm();
  captureModelPresetForm();
  var name = await appInput(
    '给这套路由起一个名称，例如“低成本辅助任务”。',
    '新路由预设',
    '新增模型路由预设',
    '预设名称',
    { okText: '添加预设' }
  );
  if (!name) return;
  var settings = providerFormSettings(),
    preset = { id: 'preset_' + uid(), name: name, routes: {} };
  settings.modelPresets.push(preset);
  settings.activeModelPresetId = preset.id;
  renderModelPresetForm();
}
async function deleteModelPreset() {
  if (blockDuringGeneration('删除模型路由预设')) return;
  captureModelPresetForm();
  var settings = providerFormSettings();
  if (settings.modelPresets.length <= 1) {
    toast('至少保留一个模型路由预设', 'info');
    return;
  }
  var preset = activeModelPresetForSettings(settings);
  if (!(await appConfirm('删除路由预设“' + preset.name + '”？', '删除模型路由预设', '删除'))) return;
  settings = providerFormSettings();
  settings.modelPresets = settings.modelPresets.filter(function (p) {
    return p.id !== preset.id;
  });
  settings.activeModelPresetId = settings.modelPresets[0].id;
  renderModelPresetForm();
}
function selectModelPresetForEditing() {
  captureModelPresetForm();
  providerFormSettings().activeModelPresetId = $('s-model-preset-select').value;
  renderModelPresetForm();
}

function defaults() {
  return {
    characters: [],
    currentCharId: null,
    chats: {},
    worldBook: {
      categories: [],
      scan_depth: 20,
      token_budget: 0,
      recursive: false,
      case_sensitive: false,
      activeCategoryId: '',
      globalCategoryIds: [],
    },
    personas: [],
    activePersonaId: null,
    wheelSchemes: [],
    settings: {
      embeddingEnabled: false,
      vectorChatsEnabled: true,
      embeddingApiUrl: '',
      embeddingApiKey: '',
      embeddingModel: 'embedding-3',
      embeddingDimensions: 0,
      providers: [makeDefaultProvider()],
      activeProviderId: 'provider_default',
      modelPresets: [{ id: 'preset_default', name: '默认路由', routes: {} }],
      activeModelPresetId: 'preset_default',
      activeConnectionProfileId: '',
      imageSources: [],
      activeImageSourceId: '',
      assistantPromptOverrides: {},
      maxContextTokens: 0,
      authorsNote: DEFAULT_AUTHORS_NOTE,
      anDepth: 2,
      anFreq: 2,
      chatCompletionPresets: [],
      activeChatCompletionPresetName: '',
      chatCompletionPresetInUse: null,
      presetEmbeddedTasksEnabled: false,
      regexScripts: [],
      regexPresets: [],
      activeRegexPresetId: '',
      useMemory: true,
      maxExampleTokens: 0,
      recentMsgLimit: 10,
      summaryTokenLimit: 0,
      autoSummaryEvery: 30,
      memoryQueryMessageLimit: 6,
      memoryRetrievalTokenBudget: 0,
      maxTokens: 0,
      styleAuditMaxTokens: 0,
      wheelSchemeMaxTokens: 0,
      temperature: null,
      top_p: null,
      frequency_penalty: null,
      presence_penalty: null,
      showThinking: true,
      streamOutput: true,
      reasoningEffort: 'auto',
      innerOS: false,
      themeMode: 'auto',
      messageStyle: 'bubble',
      immersiveBackgroundBlur: 50,
      styleAuditEnabled: false,
      worldBookLocalizationBatchSize: 80,
      lastRequestUsage: null,
    },
  };
}
let D = null;
let _persistenceBlocked = false;
var _styleAuditStates = {};
var _styleAuditLastStatus = null;
function styleAuditStateKey(charId, sessionId) {
  return JSON.stringify([String(charId || ''), String(sessionId || '')]);
}
function styleAuditSessionFor(charId, sessionId) {
  var box = D && D.chats && D.chats[charId];
  return box && Array.isArray(box.sessions)
    ? box.sessions.find(function (session) {
        return session && session.id === sessionId;
      })
    : null;
}
function styleAuditVisibleReplies(session, char) {
  return (session && Array.isArray(session.msgs) ? session.msgs : [])
    .filter(function (message) {
      return message && message.role === 'assistant';
    })
    .map(function (message) {
      var visible =
        typeof splitAssistantResponseText === 'function'
          ? splitAssistantResponseText(message.content).content
          : String(message.content || '');
      if (typeof StoryDirection === 'object' && StoryDirection && typeof StoryDirection.extractBlocks === 'function')
        visible = StoryDirection.extractBlocks(visible, char).body;
      return String(visible || '').trim();
    })
    .filter(Boolean)
    .slice(-3);
}
function styleAuditPromptText() {
  var text = typeof assistantPromptText === 'function' ? assistantPromptText('styleAudit', 'review') : '';
  return String(text || DEFAULT_STYLE_AUDIT_PROMPT);
}
function buildStyleAuditMessages(session, char) {
  var replies = styleAuditVisibleReplies(session, char);
  if (!replies.length) return null;
  return [
    { role: 'system', content: styleAuditPromptText() },
    {
      role: 'user',
      content:
        '以下是助手最近3条回复的正文：\n\n' +
        replies
          .map(function (text, index) {
            return '【回复' + (index + 1) + '】\n' + text;
          })
          .join('\n\n'),
    },
  ];
}
function parseStyleAuditResult(result) {
  var content = String((result && result.content) || ''),
    visible =
      typeof sanitizeGeneratedVisibleContent === 'function'
        ? sanitizeGeneratedVisibleContent(content, { fromProvider: true })
        : content,
    text = String(visible || '')
      .trim()
      .replace(/[\r\n]+/g, ' ');
  if (text === '无问题') return { valid: true, hint: '' };
  if (!text) return { valid: false, hint: '', reason: '模型没有返回可用内容' };
  return { valid: true, hint: text };
}
function styleAuditFailureReason(error) {
  var message = String((error && error.message) || '');
  if (/额度已用完|空响应|没有返回/.test(message)) return '模型没有返回可用内容';
  if (/超时|太久/.test(message)) return '等待模型超时';
  if (/网络|连接|offline/i.test(message)) return '网络连接异常';
  if (/401|API Key/.test(message)) return '接口配置未通过';
  if (/429|频繁/.test(message)) return '请求过于频繁';
  return '模型检查失败';
}
function formatStyleAuditStatusAge(savedAt) {
  var elapsed = Math.max(0, Date.now() - (Number(savedAt) || 0)),
    minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return '约 ' + minutes + ' 分钟前';
  var hours = Math.floor(minutes / 60);
  return hours < 24 ? '约 ' + hours + ' 小时前' : '较早';
}
function renderStyleAuditStatus() {
  var node = typeof $ === 'function' ? $('style-audit-status') : null;
  if (!node) return;
  var status = _styleAuditLastStatus;
  if (!status || !(D && D.settings && D.settings.styleAuditEnabled === true)) {
    node.textContent = '';
    node.hidden = true;
    node.className = 'style-audit-status';
    return;
  }
  var prefix =
    status.kind === 'ok'
      ? '无问题'
      : status.kind === 'suggestion'
        ? '已建议：' + status.text
        : '未完成（' + status.text + '）';
  node.textContent = prefix + ' · 检查了 ' + status.replyCount + ' 条 · ' + formatStyleAuditStatusAge(status.savedAt);
  node.className =
    'style-audit-status ' + (status.kind === 'failure' ? 'err' : status.kind === 'ok' ? 'ok' : 'suggestion');
  node.hidden = false;
}
function setStyleAuditLastStatus(kind, text, replyCount) {
  _styleAuditLastStatus = {
    kind: kind,
    text: String(text || ''),
    replyCount: Math.max(1, Number(replyCount) || 1),
    savedAt: Date.now(),
  };
  renderStyleAuditStatus();
}
function clearStyleAuditStates() {
  Object.keys(_styleAuditStates).forEach(function (key) {
    var state = _styleAuditStates[key];
    if (state && state.controller && typeof state.controller.abort === 'function') state.controller.abort();
    delete _styleAuditStates[key];
  });
  _styleAuditLastStatus = null;
  renderStyleAuditStatus();
}
// `settings` defaults to the saved settings; the Prompt Manager preview passes its draft candidate.
function styleAuditHintForSession(charId, sessionId, settings) {
  var source = settings || (D && D.settings);
  if (!(source && source.styleAuditEnabled === true)) return '';
  var state = _styleAuditStates[styleAuditStateKey(charId, sessionId)];
  return String((state && state.hint) || '');
}
function takeStyleAuditHintForSession(charId, sessionId) {
  var key = styleAuditStateKey(charId, sessionId),
    state = _styleAuditStates[key],
    hint = styleAuditHintForSession(charId, sessionId);
  if (hint && state) state.hint = '';
  return hint;
}
function startStyleAuditForSession(charId, sessionId) {
  if (!(D && D.settings && D.settings.styleAuditEnabled === true)) return false;
  var session = styleAuditSessionFor(charId, sessionId),
    char =
      (D && Array.isArray(D.characters) ? D.characters : []).find(function (row) {
        return row && String(row.id) === String(charId);
      }) || null;
  if (!session) return false;
  var key = styleAuditStateKey(charId, sessionId),
    state = _styleAuditStates[key] || { hint: '', inFlight: false, controller: null };
  if (state.inFlight) return false;
  var replyCount = styleAuditVisibleReplies(session, char).length;
  if (replyCount < 3) return false;
  var messages = buildStyleAuditMessages(session, char);
  if (!messages) return false;
  state.inFlight = true;
  state.controller = new AbortController();
  _styleAuditStates[key] = state;
  Promise.resolve()
    .then(function () {
      return callDeepSeek(
        messages,
        null,
        Object.assign(modelRouteRequestOptions('styleAudit'), {
          route: 'styleAudit',
          transient: true,
          nonStream: true,
          noRetry: true,
          controller: state.controller,
          maxTokens: taskMaxTokens('styleAuditMaxTokens'),
          ignoreUserMaxTokens: true,
        })
      );
    })
    .then(function (result) {
      if (!(D && D.settings && D.settings.styleAuditEnabled === true) || _styleAuditStates[key] !== state) return;
      if (!styleAuditSessionFor(charId, sessionId)) {
        delete _styleAuditStates[key];
        return;
      }
      var parsed = parseStyleAuditResult(result);
      if (parsed.valid) {
        state.hint = parsed.hint;
        setStyleAuditLastStatus(parsed.hint ? 'suggestion' : 'ok', parsed.hint, replyCount);
      } else setStyleAuditLastStatus('failure', parsed.reason, replyCount);
    })
    .catch(function (error) {
      if (
        D &&
        D.settings &&
        D.settings.styleAuditEnabled === true &&
        _styleAuditStates[key] === state &&
        !(state.controller && state.controller.signal.aborted)
      )
        setStyleAuditLastStatus('failure', styleAuditFailureReason(error), replyCount);
    })
    .finally(function () {
      if (_styleAuditStates[key] === state) {
        state.inFlight = false;
        state.controller = null;
      }
    });
  return true;
}
let _storageHealth = {
  source: '尚未读取',
  lastSaveAt: 0,
  lastSaveMode: '尚未保存',
  lastError: '',
  readOnlyFallback: false,
};
function renderStorageHealthStatus() {
  var banner = document.getElementById('storage-health-banner');
  if (!banner) return;
  banner.hidden =
    !_storageHealth.readOnlyFallback && _storageHealth.lastSaveMode !== '本地恢复快照' && !_pendingPrimarySections.size;
  var title = banner.querySelector('strong'),
    detail = banner.querySelector('span');
  if (title)
    title.textContent = _storageHealth.readOnlyFallback ? '数据库未能读取，当前显示本地恢复快照' : '修改暂未保存成功';
  if (detail)
    detail.textContent = _storageHealth.readOnlyFallback
      ? '为避免覆盖数据库里可能更完整的数据，现在不写入任何修改。点击“重新尝试保存”并确认后，才会用这份快照覆盖数据库。'
      : '内容已临时保留在本机。请点击“重新尝试保存”，成功前不要清除应用数据。';
}
async function retryPendingPrimarySave() {
  var button = document.querySelector('#storage-health-banner button'),
    releasedReadOnly = false;
  if (button) button.disabled = true;
  if (_storageHealth.readOnlyFallback) {
    var confirmed =
      typeof appConfirm === 'function'
        ? await appConfirm(
            '数据库上次读取失败，现在显示的是本地恢复快照；确认后将用快照覆盖数据库。',
            '恢复写入',
            '覆盖数据库'
          )
        : true;
    if (!confirmed) {
      if (button) button.disabled = false;
      return;
    }
    releasedReadOnly = true;
    _storageHealth.readOnlyFallback = false;
    ['meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheels'].forEach(function (section) {
      _pendingPrimarySections.add(section);
    });
    renderStorageHealthStatus();
  }
  try {
    await flushPendingSave();
    if (_pendingPrimarySections.size) throw new Error('内容继续临时保留在本机');
    toast('保存已恢复正常，之前的内容已写入', 'ok');
    // 只读期间草稿只读进了内存，恢复写入后再按当前数据核对并自动保存。
    if (releasedReadOnly && typeof settleLoadedStreamDrafts === 'function')
      settleLoadedStreamDrafts().then(
        function (settled) {
          if (settled && typeof renderChat === 'function') renderChat();
        },
        function () {}
      );
  } catch (error) {
    // 覆盖没有成功，只读保护必须挂回去，否则后续自动保存会把这份快照写进数据库。
    if (releasedReadOnly) _storageHealth.readOnlyFallback = true;
    toast('仍未保存成功：' + String((error && error.message) || error), 'err');
  } finally {
    if (button) button.disabled = false;
    renderStorageHealthStatus();
  }
}

function mergeLoadedData(source) {
  source = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return deepMerge(defaults(), source);
}
const SNAPSHOT_BINARY_ENCODING = 'yeyu-binary-sidecar-v1';
function snapshotBytesToBase64(value) {
  var bytes = value instanceof Uint8Array ? value : new Uint8Array(value),
    chunks = [];
  for (var offset = 0; offset < bytes.length; offset += 24576)
    chunks.push(btoa(String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(bytes.length, offset + 24576)))));
  return chunks.join('');
}
function snapshotBase64ToBytes(value) {
  var raw = atob(String(value || '')),
    bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
function captureRecoverySnapshot(value, active, path, binary) {
  if (value instanceof Uint8Array) {
    binary.push({ path: path, kind: 'Uint8Array', bytes: new Uint8Array(value) });
    return null;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    binary.push({ path: path, kind: 'Blob', type: String(value.type || ''), blob: value });
    return null;
  }
  if (value === null || typeof value !== 'object') return value;
  if (active.has(value)) throw new TypeError('数据包含循环对象引用，无法写入恢复快照');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      var arrayOut = new Array(value.length);
      for (var index = 0; index < value.length; index++)
        if (Object.prototype.hasOwnProperty.call(value, index))
          arrayOut[index] = captureRecoverySnapshot(value[index], active, path.concat(index), binary);
      return arrayOut;
    }
    if (typeof value.toJSON === 'function') return captureRecoverySnapshot(value.toJSON(), active, path, binary);
    var out = {};
    for (var keys = Object.keys(value), i = 0; i < keys.length; i++)
      out[keys[i]] = captureRecoverySnapshot(value[keys[i]], active, path.concat(keys[i]), binary);
    return out;
  } finally {
    active.delete(value);
  }
}
async function stringifyRecoverySnapshot(value) {
  var pending = [],
    captured = captureRecoverySnapshot(value, new WeakSet(), [], pending),
    binary = [];
  for (var i = 0; i < pending.length; i++) {
    var row = pending[i],
      bytes = row.kind === 'Blob' ? new Uint8Array(await row.blob.arrayBuffer()) : row.bytes,
      encoded = { path: row.path, kind: row.kind, base64: snapshotBytesToBase64(bytes) };
    if (row.kind === 'Blob') encoded.type = row.type;
    binary.push(encoded);
  }
  return { snapshot: JSON.stringify(captured), binary: binary };
}
function restoreRecoverySnapshotBinary(value, binary) {
  if (!Array.isArray(binary)) throw new Error('恢复快照的二进制索引无效');
  var seen = new Set();
  binary.forEach(function (row) {
    if (
      !row ||
      typeof row !== 'object' ||
      !Array.isArray(row.path) ||
      !row.path.length ||
      typeof row.base64 !== 'string' ||
      (row.kind !== 'Uint8Array' && row.kind !== 'Blob') ||
      (row.kind === 'Blob' && typeof row.type !== 'string')
    )
      throw new Error('恢复快照的二进制条目无效');
    var expected = row.kind === 'Blob' ? ['base64', 'kind', 'path', 'type'] : ['base64', 'kind', 'path'],
      keys = Object.keys(row).sort();
    expected.sort();
    if (
      keys.length !== expected.length ||
      !keys.every(function (key, index) {
        return key === expected[index];
      })
    )
      throw new Error('恢复快照的二进制条目无效');
    var pathKey = JSON.stringify(row.path);
    if (seen.has(pathKey)) throw new Error('恢复快照的二进制路径重复');
    seen.add(pathKey);
    var target = value;
    for (var i = 0; i < row.path.length - 1; i++) {
      var segment = row.path[i],
        arrayIndex = Array.isArray(target) && Number.isInteger(segment) && segment >= 0 && segment < target.length;
      if (
        !arrayIndex &&
        (!target ||
          typeof target !== 'object' ||
          typeof segment !== 'string' ||
          !Object.prototype.hasOwnProperty.call(target, segment))
      )
        throw new Error('恢复快照的二进制路径无效');
      target = target[segment];
    }
    var last = row.path[row.path.length - 1],
      validArray = Array.isArray(target) && Number.isInteger(last) && last >= 0 && last < target.length,
      validObject =
        !Array.isArray(target) &&
        target &&
        typeof target === 'object' &&
        typeof last === 'string' &&
        Object.prototype.hasOwnProperty.call(target, last);
    if ((!validArray && !validObject) || target[last] !== null) throw new Error('恢复快照的二进制占位无效');
    var bytes = snapshotBase64ToBytes(row.base64);
    target[last] = row.kind === 'Blob' ? new Blob([bytes], { type: row.type }) : bytes;
  });
  return value;
}
async function loadDataAsync() {
  _storageHealth.readOnlyFallback = false;
  var repositoryError = null,
    fallbackError = null,
    fallbackCandidate = null;
  try {
    var fallbackRaw = localStorage.getItem(FALLBACK_KEY);
    if (fallbackRaw) {
      var fallbackBox = JSON.parse(fallbackRaw),
        fallbackData = JSON.parse(fallbackBox.snapshot || '');
      var fallbackDataMerged = mergeLoadedData(fallbackData);
      if (fallbackBox.encoding === SNAPSHOT_BINARY_ENCODING)
        fallbackDataMerged = restoreRecoverySnapshotBinary(fallbackDataMerged, fallbackBox.binary);
      fallbackCandidate = {
        data: fallbackDataMerged,
        savedAt: Math.max(0, Number(fallbackBox.savedAt) || 0),
        clearedStreamDraftIds: fallbackBox.clearedStreamDraftIds || [],
      };
    }
  } catch (e) {
    fallbackError = e;
    console.warn('保存失败恢复快照不可用', e);
  }
  try {
    if (!window.YeyuRepository) throw new Error('结构化仓库模块未加载，无法确认本地数据');
    var loaded = await window.YeyuRepository.load();
    if (loaded && loaded.data) {
      var repositoryUpdatedAt = Math.max(0, Number(loaded.updatedAt) || 0),
        preferRepository = !fallbackCandidate || repositoryUpdatedAt >= fallbackCandidate.savedAt;
      if (preferRepository) {
        _storageHealth.source = 'IndexedDB 分区仓库';
        if (fallbackCandidate)
          try {
            localStorage.removeItem(FALLBACK_KEY);
          } catch (_) {}
        return mergeLoadedData(loaded.data);
      }
    }
  } catch (e) {
    repositoryError = e;
    console.warn('结构化仓库读取失败，尝试本地回退', e);
  }
  if (fallbackCandidate) {
    _storageHealth.source = '本地恢复快照';
    (Array.isArray(fallbackCandidate.clearedStreamDraftIds) ? fallbackCandidate.clearedStreamDraftIds : []).forEach(
      function (value) {
        var id = String(value || '').trim();
        if (id && id.length <= 160) _pendingPrimaryStreamDraftClearIds.add(id);
      }
    );
    // 只有主仓库读取成功、确认快照更新时才自动补写；读取异常时整体只读，避免用旧快照覆盖可能更完整的数据库。
    if (repositoryError) _storageHealth.readOnlyFallback = true;
    else
      ['meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheels'].forEach(function (section) {
        _pendingPrimarySections.add(section);
      });
    return fallbackCandidate.data;
  }
  if (repositoryError || fallbackError) {
    var readError = new Error('本地数据读取失败，为避免覆盖原数据已停止写入');
    readError.cause = repositoryError || fallbackError;
    readError.storageReadFailed = true;
    if (!repositoryError && loaded === null && fallbackError) readError.restartRecoverySnapshot = fallbackRaw;
    throw readError;
  }
  _storageHealth.source = '首次启动默认数据';
  return defaults();
}

let _saveDirty = false,
  _saveDrainPromise = null,
  _saveActivePromise = null,
  _saveFlushRequested = false,
  _saveTimer = 0,
  _saveIdleHandle = 0,
  _saveRunning = false,
  _saveResolve = null,
  _saveReject = null,
  _saveMutationRevision = 0;
const _saveSections = new Set(),
  _pendingPrimarySections = new Set(),
  _pendingPrimaryStreamDraftClearIds = new Set(),
  _pendingStreamDraftClearIds = new Set();
async function writeSnapshot(sections, options) {
  if (_persistenceBlocked) throw new Error('当前处于只读恢复模式，未写入任何数据');
  options = options || {};
  try {
    if (!window.YeyuRepository || typeof window.YeyuRepository.save !== 'function')
      throw new Error('结构化仓库模块未加载，无法安全保存');
    await window.YeyuRepository.save(D, { sections: sections, clearStreamDraftIds: options.clearStreamDraftIds || [] });
    try {
      localStorage.removeItem(FALLBACK_KEY);
    } catch (_) {}
    _storageHealth.lastSaveAt = Date.now();
    _storageHealth.lastSaveMode = 'IndexedDB 正常保存';
    _storageHealth.lastError = '';
    if (typeof renderStorageHealthStatus === 'function') renderStorageHealthStatus();
    return true;
  } catch (primaryError) {
    console.error('IndexedDB 写入失败，使用恢复快照', primaryError);
    try {
      var fallbackSnapshot, snapshotRevision;
      do {
        snapshotRevision = _saveMutationRevision;
        var persistentData =
          window.YeyuRepository &&
          typeof window.YeyuRepository.split === 'function' &&
          typeof window.YeyuRepository.compose === 'function'
            ? Object.assign({}, D, window.YeyuRepository.compose(window.YeyuRepository.split(D)))
            : D;
        fallbackSnapshot = await stringifyRecoverySnapshot(persistentData);
      } while (snapshotRevision !== _saveMutationRevision);
      localStorage.setItem(
        FALLBACK_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          encoding: SNAPSHOT_BINARY_ENCODING,
          snapshot: fallbackSnapshot.snapshot,
          binary: fallbackSnapshot.binary,
          clearedStreamDraftIds: Array.from(
            new Set([
              ..._pendingPrimaryStreamDraftClearIds,
              ...(options.clearStreamDraftIds || []),
              ..._pendingStreamDraftClearIds,
            ])
          ),
        })
      );
      if (options.onFallbackSaved) options.onFallbackSaved();
      _storageHealth.lastSaveAt = Date.now();
      _storageHealth.lastSaveMode = '本地恢复快照';
      _storageHealth.lastError = String((primaryError && primaryError.message) || primaryError);
      if (typeof renderStorageHealthStatus === 'function') renderStorageHealthStatus();
      return false;
    } catch (fallbackError) {
      var error = new Error('本地存储写入失败，可能是存储空间不足');
      error.cause = fallbackError;
      throw error;
    }
  }
}
var _worldBookRevision = 0;
function invalidateCacheContexts(charId, fromIndex, resetWorldBookRuntime, sessionId) {
  var boxes = charId && D.chats && D.chats[charId] ? [[charId, D.chats[charId]]] : Object.entries(D.chats || {}),
    changed = false,
    targetSessionId = String(sessionId || '');
  boxes.forEach(function (pair) {
    var scopedSessionId = targetSessionId || (charId ? String((pair[1] && pair[1].activeSid) || '') : '');
    (pair[1].sessions || []).forEach(function (sess) {
      if ((!scopedSessionId || String((sess && sess.id) || '') === scopedSessionId) && sess && sess.worldBookRuntime) {
        delete sess.worldBookRuntime;
        changed = true;
      }
    });
  });
  return changed;
}
function normalizeSaveSections(sections) {
  if (typeof sections === 'string') sections = [sections];
  if (!Array.isArray(sections) || !sections.length)
    return ['meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheels'];
  return sections.filter(function (k) {
    return ['meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheels'].includes(k);
  });
}
function cancelScheduledSave() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = 0;
  }
  if (_saveIdleHandle && window.cancelIdleCallback) {
    cancelIdleCallback(_saveIdleHandle);
    _saveIdleHandle = 0;
  }
}
function triggerSaveDrain() {
  if (_saveRunning || !_saveDrainPromise) return;
  cancelScheduledSave();
  if (_persistenceBlocked || _storageHealth.readOnlyFallback) {
    // 数据库读取失败后先只读展示快照，用户在降级横幅里确认前不写入任何分区。调用方收到拒绝后
    // 会回滚这次修改，所以这里不把分区标记为待补写；确认覆盖时会重新挂上全部六个分区。
    _saveSections.clear();
    _saveDirty = false;
    _pendingStreamDraftClearIds.clear();
    var blockedReject = _saveReject;
    _saveDrainPromise = null;
    _saveResolve = null;
    _saveReject = null;
    _saveFlushRequested = false;
    if (typeof renderStorageHealthStatus === 'function') renderStorageHealthStatus();
    if (blockedReject) blockedReject(new Error('数据库上次读取失败，当前只读展示本地恢复快照，未写入任何数据'));
    return;
  }
  _saveRunning = true;
  (async function () {
    var attemptedSections = [];
    var batchResolve, batchReject;
    try {
      while (_saveDrainPromise) {
        _saveActivePromise = _saveDrainPromise;
        batchResolve = _saveResolve;
        batchReject = _saveReject;
        _saveDrainPromise = null;
        _saveResolve = null;
        _saveReject = null;
        _saveDirty = false;
        var merged = new Set(_pendingPrimarySections);
        _saveSections.forEach(function (section) {
          merged.add(section);
        });
        _saveSections.clear();
        var sections = Array.from(merged),
          clearStreamDraftIds = Array.from(
            new Set([..._pendingPrimaryStreamDraftClearIds, ..._pendingStreamDraftClearIds])
          );
        _pendingStreamDraftClearIds.clear();
        attemptedSections = sections.slice();
        var capturedQueue = null;
        var primarySaved = await writeSnapshot(sections, {
          clearStreamDraftIds: clearStreamDraftIds,
          onFallbackSaved: function () {
            // Freeze callers in the same synchronous turn as the successful
            // snapshot write. A later microtask belongs to the next batch.
            capturedQueue = {
              resolve: _saveResolve,
              sections: Array.from(_saveSections),
              clearIds: Array.from(_pendingStreamDraftClearIds),
            };
            _saveDrainPromise = null;
            _saveResolve = null;
            _saveReject = null;
            _saveSections.clear();
            _pendingStreamDraftClearIds.clear();
            _saveDirty = false;
          },
        });
        if (!primarySaved) {
          sections.forEach(function (section) {
            _pendingPrimarySections.add(section);
          });
          capturedQueue.sections.forEach(function (section) {
            _pendingPrimarySections.add(section);
          });
          clearStreamDraftIds.forEach(function (id) {
            _pendingPrimaryStreamDraftClearIds.add(id);
          });
          capturedQueue.clearIds.forEach(function (id) {
            _pendingPrimaryStreamDraftClearIds.add(id);
          });
          if (capturedQueue.resolve) capturedQueue.resolve();
          if (batchResolve) batchResolve();
          batchResolve = null;
          batchReject = null;
          continue;
        }
        sections.forEach(function (section) {
          _pendingPrimarySections.delete(section);
        });
        if (typeof renderStorageHealthStatus === 'function') renderStorageHealthStatus();
        clearStreamDraftIds.forEach(function (id) {
          _pendingPrimaryStreamDraftClearIds.delete(id);
        });
        if (batchResolve) batchResolve();
        batchResolve = null;
        batchReject = null;
      }
    } catch (e) {
      attemptedSections.forEach(function (section) {
        _pendingPrimarySections.add(section);
      });
      _saveSections.forEach(function (section) {
        _pendingPrimarySections.add(section);
      });
      _saveSections.clear();
      _saveDirty = true;
      // 被拒绝的保存由调用方回滚，随它一起请求的草稿删除也作废，否则下一次保存会删掉仍受保护的草稿。
      _pendingStreamDraftClearIds.clear();
      var reject = _saveReject;
      _saveDrainPromise = null;
      _saveResolve = null;
      _saveReject = null;
      if (batchReject) batchReject(e);
      if (reject) reject(e);
    } finally {
      _saveActivePromise = null;
      _saveFlushRequested = false;
      _saveRunning = false;
    }
  })();
}
function scheduleSaveDrain() {
  cancelScheduledSave();
  _saveTimer = setTimeout(function () {
    _saveTimer = 0;
    if (_saveFlushRequested) triggerSaveDrain();
    else if (window.requestIdleCallback)
      _saveIdleHandle = requestIdleCallback(
        function () {
          _saveIdleHandle = 0;
          triggerSaveDrain();
        },
        { timeout: 1200 }
      );
    else triggerSaveDrain();
  }, 120);
}
function saveData(sections, options) {
  if (_persistenceBlocked) return Promise.reject(new Error('当前处于只读恢复模式，未写入任何数据'));
  options = options || {};
  _saveDirty = true;
  _saveMutationRevision++;
  var normalizedSections = normalizeSaveSections(sections);
  if (normalizedSections.indexOf('worldbook') >= 0) _worldBookRevision++;
  normalizedSections.forEach(function (k) {
    _saveSections.add(k);
  });
  var clearIds = options.clearStreamDraftIds || options.clearStreamDraftId || [];
  (Array.isArray(clearIds) ? clearIds : [clearIds]).forEach(function (value) {
    var id = String(value || '').trim();
    if (id && id.length <= 160) _pendingStreamDraftClearIds.add(id);
  });
  if (!_saveDrainPromise)
    _saveDrainPromise = new Promise(function (resolve, reject) {
      _saveResolve = resolve;
      _saveReject = reject;
    });
  // 排空可能同步结束并清空 _saveDrainPromise，先握住本次调用要返回的 Promise。
  var pending = _saveDrainPromise;
  if (options.urgent || _saveFlushRequested) triggerSaveDrain();
  else if (!_saveTimer && !_saveIdleHandle && !_saveRunning) scheduleSaveDrain();
  pending.catch(function () {});
  return pending;
}
function flushPendingSave() {
  if (_persistenceBlocked) {
    var blocked = Promise.reject(new Error('当前处于只读恢复模式，未写入任何数据'));
    blocked.catch(function () {});
    return blocked;
  }
  var presetPending = typeof completionPresetFlushHostWrite === 'function' ? completionPresetFlushHostWrite() : null;
  _saveFlushRequested = true;
  var appPending;
  if (
    !_saveDirty &&
    !_pendingPrimarySections.size &&
    !_pendingStreamDraftClearIds.size &&
    !_pendingPrimaryStreamDraftClearIds.size &&
    !_saveDrainPromise
  )
    appPending = _saveActivePromise || Promise.resolve();
  else {
    if (!_saveDrainPromise)
      _saveDrainPromise = new Promise(function (resolve, reject) {
        _saveResolve = resolve;
        _saveReject = reject;
      });
    _saveDirty = true;
    var drain = _saveDrainPromise,
      active = _saveActivePromise;
    triggerSaveDrain();
    drain.catch(function () {});
    appPending = active ? Promise.all([active, drain]).then(function () {}) : drain;
  }
  var pending = presetPending
    ? Promise.all([Promise.resolve(presetPending), appPending]).then(function () {})
    : appPending;
  pending.catch(function () {});
  return pending;
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flushPendingSave();
});
window.addEventListener('pagehide', function () {
  flushPendingSave();
});

function deepMerge(base, src) {
  return window.YeyuPure.deepMerge(base, src);
}

function worldBookCategoryBoundCharIds(cat) {
  return trimmedUniqueStrings(Array.isArray(cat && cat.boundCharIds) ? cat.boundCharIds : []);
}
function setWorldBookCategoryBoundCharIds(cat, ids) {
  if (!cat) return [];
  cat.boundCharIds = worldBookCategoryBoundCharIds({ boundCharIds: ids });
  return cat.boundCharIds;
}

// ===== Chat Session Management =====
function createBlankSession(name, id) {
  return {
    id: id || uid(),
    name: name || '对话 1',
    msgs: [],
    created: Date.now(),
    nextMessageSeq: 1,
    _messageSeqVersion: 1,
    _directiveParseVersion: 1,
    memoryStore: makeEmptyMemoryStore(),
  };
}
// A conversation that has not begun: no message yet and its greeting not decided. Card scripts wait
// until it begins, as in SillyTavern, where a chat always opens with its greeting in place.
function sessionAwaitsGreeting(sess) {
  return !!sess && !sess.greetingChosen && !(Array.isArray(sess.msgs) && sess.msgs.length);
}
function ensureMessageSequences(sess) {
  if (!sess || !Array.isArray(sess.msgs)) return sess;
  var reserved = Object.create(null),
    seen = Object.create(null),
    max = 0,
    next = Number(sess.nextMessageSeq);
  if (!Number.isInteger(next) || next < 1) next = 1;
  sess.msgs.forEach(function (msg) {
    var seq = Number(msg && msg.seq);
    if (Number.isInteger(seq) && seq > 0) {
      reserved[seq] = 1;
      max = Math.max(max, seq);
    }
  });
  next = Math.max(next, max + 1);
  sess.msgs.forEach(function (msg) {
    var seq = Number(msg && msg.seq);
    if (Number.isInteger(seq) && seq > 0 && !seen[seq]) {
      seen[seq] = 1;
      return;
    }
    while (reserved[next]) next++;
    if (msg) msg.seq = next;
    reserved[next] = 1;
    seen[next] = 1;
    next++;
  });
  sess.nextMessageSeq = next;
  sess._messageSeqVersion = 1;
  return sess;
}
function allocateMessageSeq(sess) {
  ensureMessageSequences(sess);
  var seq = Math.max(1, Number(sess.nextMessageSeq) || 1);
  sess.nextMessageSeq = seq + 1;
  return seq;
}
function getSessionContainer(charId) {
  if (!D.chats[charId]) D.chats[charId] = { sessions: [], activeSid: null };
  if (!D.chats[charId].sessions) D.chats[charId] = { sessions: [], activeSid: null };
  const c = D.chats[charId];
  if (!c.sessions.length) {
    const sid = uid();
    c.sessions.push(createBlankSession('对话 1', sid));
    c.activeSid = sid;
  }
  if (!c.activeSid || !c.sessions.find((s) => s.id === c.activeSid)) c.activeSid = c.sessions[0].id;
  return c;
}
function getSessions(charId) {
  const c = getSessionContainer(charId);
  c.sessions.forEach(function (sess) {
    ensureMessageSequences(sess);
    ensureSessionMemoryStore(sess);
  });
  return c;
}
function getActiveSession(charId) {
  const c = getSessionContainer(charId);
  return c.sessions.find((s) => s.id === c.activeSid) || c.sessions[0];
}
function getMsgs(charId) {
  const s = getActiveSession(charId);
  return s ? s.msgs : [];
}
