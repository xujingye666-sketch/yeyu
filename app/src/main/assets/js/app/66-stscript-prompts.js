// ===== STScript prompt, provider, reasoning, and auxiliary generation commands =====
var STSCRIPT_REASONING_DEFAULT_TEMPLATE_ID = 'reasoning_think';
function stscriptDefaultReasoningTemplate() {
  return {
    id: STSCRIPT_REASONING_DEFAULT_TEMPLATE_ID,
    name: 'Think 标签',
    prefix: '<think>',
    suffix: '</think>',
    separator: '\n\n',
  };
}
function stscriptPromptSettings(settings) {
  if (typeof D === 'undefined' || !D || !D.settings) return null;
  var s = settings || D.settings;
  if (!Array.isArray(s.customStoppingStrings)) s.customStoppingStrings = [];
  s.customStoppingStrings = s.customStoppingStrings.map(String);
  if (typeof s.startReplyWith !== 'string') s.startReplyWith = '';
  if (!Array.isArray(s.systemPromptProfiles)) s.systemPromptProfiles = [];
  s.systemPromptProfiles = s.systemPromptProfiles.filter(function (row) {
    return row && typeof row === 'object' && !Array.isArray(row);
  });
  s.systemPromptProfiles.forEach(function (row, index) {
    row.id = String(row.id || 'system_prompt_' + index + '_' + stscriptUid());
    row.name = String(row.name || '系统提示词 ' + (index + 1));
    row.content = String(row.content || '');
    row.postHistory = String(row.postHistory || '');
  });
  if (typeof s.systemPromptEnabled !== 'boolean') s.systemPromptEnabled = !!s.activeSystemPromptProfileId;
  if (
    s.activeSystemPromptProfileId &&
    !s.systemPromptProfiles.some(function (row) {
      return row.id === s.activeSystemPromptProfileId;
    })
  )
    s.activeSystemPromptProfileId = '';
  if (!s.activeSystemPromptProfileId && s.systemPromptProfiles.length)
    s.activeSystemPromptProfileId = s.systemPromptProfiles[0].id;
  if (!Array.isArray(s.reasoningTemplates)) s.reasoningTemplates = [];
  s.reasoningTemplates = s.reasoningTemplates.filter(function (row) {
    return row && typeof row === 'object' && !Array.isArray(row);
  });
  if (!s.reasoningTemplates.length) s.reasoningTemplates.push(stscriptDefaultReasoningTemplate());
  s.reasoningTemplates.forEach(function (row, index) {
    row.id = String(row.id || 'reasoning_' + index + '_' + stscriptUid());
    row.name = String(row.name || '思考模板 ' + (index + 1));
    row.prefix = String(row.prefix || '');
    row.suffix = String(row.suffix || '');
    row.separator = String(row.separator == null ? '\n\n' : row.separator);
  });
  if (
    !s.activeReasoningTemplateId ||
    !s.reasoningTemplates.some(function (row) {
      return row.id === s.activeReasoningTemplateId;
    })
  )
    s.activeReasoningTemplateId = s.reasoningTemplates[0].id;
  return s;
}
function stscriptSettingsSnapshot() {
  return typeof copyJsonData === 'function' ? copyJsonData(D.settings) : JSON.parse(JSON.stringify(D.settings));
}
function stscriptRestoreSettings(before) {
  Object.keys(D.settings).forEach(function (key) {
    delete D.settings[key];
  });
  Object.assign(D.settings, before);
}
async function stscriptSaveSettingsChange(before, render, rollback) {
  try {
    await saveData('meta', { urgent: true });
  } catch (error) {
    stscriptRestoreSettings(before);
    if (typeof rollback === 'function') rollback();
    if (typeof render === 'function') render();
    throw error;
  }
  if (typeof render === 'function') render();
}
function stscriptFindNamed(rows, value) {
  var text = String(value || '').trim(),
    lower = text.toLowerCase(),
    exact = rows.find(function (row) {
      return (
        String((row && (row.name || row.id)) || '').toLowerCase() === lower || String((row && row.id) || '') === text
      );
    });
  if (exact || !text) return exact || null;
  var candidates = rows
    .map(function (row) {
      return { row: row, text: String((row && (row.name || row.id)) || '') };
    })
    .filter(function (item) {
      return item.text;
    });
  if (!candidates.length) return null;
  var matches = candidates
    .map(function (item) {
      var result =
        typeof stscriptFuzzyMatch === 'function'
          ? stscriptFuzzyMatch(text, item.text, 0.2, { ignoreLocation: true })
          : { match: item.text.toLowerCase().includes(lower), score: item.text.length };
      return { row: item.row, match: result.match === true, score: Number(result.score) || 0 };
    })
    .filter(function (item) {
      return item.match;
    })
    .sort(function (a, b) {
      return a.score - b.score;
    });
  return matches.length ? matches[0].row : null;
}
// `settings` defaults to the saved settings; the Prompt Manager preview passes its draft candidate.
function stscriptActiveSystemPromptProfile(forceGet, settings) {
  var s = stscriptPromptSettings(settings);
  if (!s || (!s.systemPromptEnabled && forceGet !== true)) return null;
  return (
    s.systemPromptProfiles.find(function (row) {
      return row.id === s.activeSystemPromptProfileId;
    }) || null
  );
}
function stscriptActiveReasoningTemplate() {
  var s = stscriptPromptSettings();
  if (!s) return null;
  return (
    s.reasoningTemplates.find(function (row) {
      return row.id === s.activeReasoningTemplateId;
    }) || s.reasoningTemplates[0]
  );
}
function stscriptParseReasoningText(value, strict) {
  var text = String(value || ''),
    template = stscriptActiveReasoningTemplate();
  if (!template || !template.prefix || !template.suffix) return null;
  var pattern =
      (strict === false ? '' : '^\\s*?') +
      escapeRegexText(String(template.prefix || '')) +
      '([\\s\\S]*?)' +
      escapeRegexText(String(template.suffix || '')),
    match = new RegExp(pattern).exec(text);
  if (!match) return null;
  return {
    reasoning: String(match[1] || '').trim(),
    content: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(),
  };
}
function stscriptFormatReasoning(reasoning, content) {
  var template = stscriptActiveReasoningTemplate();
  if (!reasoning || !template || !template.prefix || !template.suffix) return String(content || '');
  return template.prefix + String(reasoning) + template.suffix + template.separator + String(content || '');
}
function stscriptOwnerIsVisible(char, session) {
  var visible = typeof getChar === 'function' ? getChar() : null,
    active = visible && typeof getActiveSession === 'function' ? getActiveSession(visible.id) : null;
  return !!(visible && active && char && session && visible.id === char.id && active.id === session.id);
}
function stscriptRenderOwner(char, session) {
  if (stscriptOwnerIsVisible(char, session) && typeof renderChat === 'function') renderChat();
}
function stscriptProvider(value) {
  ensureProviderSettings(D.settings);
  if (!value) {
    var route = resolveApiRoute('chat');
    return (
      (D.settings.providers || []).find(function (row) {
        return row.id === route.providerId;
      }) || activeProviderForSettings(D.settings)
    );
  }
  if (['openai', 'chat-completion', 'chat_completion'].includes(String(value).trim().toLowerCase()))
    return stscriptProvider();
  return stscriptFindNamed(D.settings.providers || [], value);
}
function stscriptResolveSecretProvider(value) {
  var provider = stscriptProvider(value);
  return provider || null;
}
function stscriptSecretRow(provider, value) {
  normalizeProviderApiKeys(provider);
  var id = String(value || '').trim();
  if (id)
    return (
      provider.apiKeys.find(function (row) {
        return row.id === id;
      }) ||
      provider.apiKeys.find(function (row) {
        return row.label === id;
      }) ||
      null
    );
  return (
    provider.apiKeys.find(function (row) {
      return row.id === provider.activeApiKeyId;
    }) || null
  );
}
function stscriptTrimGeneratedNames(value) {
  var char = stscriptChar(),
    names = ['User', 'System', char && char.name, char && char.localizedName].filter(Boolean),
    output = String(value || '');
  names.forEach(function (name) {
    output = output.replace(new RegExp('^\\s*' + escapeRegexText(String(name || '')) + '\\s*:\\s*', 'i'), '');
  });
  return output.trim();
}
function stscriptTrimToSentence(value) {
  var output = String(value || ''),
    characters = Array.from(output),
    punctuation = new Set([
      '.',
      '!',
      '?',
      '*',
      '"',
      ')',
      '}',
      '`',
      ']',
      '$',
      '。',
      '！',
      '？',
      '”',
      '）',
      '】',
      '’',
      '」',
      '_',
    ]);
  for (var i = characters.length - 1; i >= 0; i--) {
    var character = characters[i],
      emoji = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(character);
    if (punctuation.has(character) || emoji) {
      var end = !emoji && i > 0 && /\s/.test(characters[i - 1]) ? i : i + 1;
      return characters.slice(0, end).join('').trimEnd();
    }
  }
  return output.trimEnd();
}

// API/provider and request settings
stscriptAddCommand({
  name: 'api',
  dryRun: stscriptDryRunReadIfBlank,
  callback: async function (args, value) {
    var target = String(stscriptJoin(value) || '').trim();
    if (!target) return stscriptProvider().name;
    var provider = stscriptProvider(target);
    if (!provider) return '';
    var before = stscriptSettingsSnapshot();
    D.settings.activeProviderId = provider.id;
    D.settings.activeConnectionProfileId = '';
    await stscriptSaveProviderChange(before);
    return provider.name;
  },
});
stscriptAddCommand({ name: 'proxy', dryRun: stscriptDryRunReadIfBlank, callback: STSCRIPT_COMMANDS.api.callback });
stscriptAddCommand({
  name: 'api-url',
  dryRun: stscriptDryRunReadIfBlank,
  aliases: ['server'],
  namedArgumentList: [{ name: 'api' }, { name: 'connect' }, { name: 'quiet' }],
  callback: async function (args, value) {
    var provider = stscriptProvider(args.api);
    if (!provider) return '';
    var url = String(stscriptJoin(value) || '').trim();
    if (!url) return String(provider.apiUrl || '');
    var before = stscriptSettingsSnapshot();
    provider.apiUrl = normalizeApiBase(url);
    await stscriptSaveProviderChange(before);
    return provider.apiUrl;
  },
});
stscriptAddCommand({
  name: 'model',
  dryRun: stscriptDryRunReadIfBlank,
  namedArgumentList: [{ name: 'quiet' }],
  callback: async function (args, value) {
    var provider = stscriptProvider(),
      model = String(stscriptJoin(value) || '').trim();
    if (!model) return String((resolveApiRoute('chat') || {}).model || provider.model || '');
    var before = stscriptSettingsSnapshot();
    provider.model = model;
    if (provider.models.indexOf(model) < 0) provider.models.push(model);
    D.settings.activeProviderId = provider.id;
    D.settings.activeConnectionProfileId = '';
    await stscriptSaveProviderChange(before);
    return model;
  },
});
stscriptAddCommand({
  name: 'prompt-post-processing',
  dryRun: stscriptDryRunReadIfBlank,
  aliases: ['ppp'],
  callback: async function (args, value) {
    var provider = stscriptProvider(),
      mode = String(stscriptJoin(value) || '')
        .trim()
        .toLowerCase();
    if (!mode) return provider.promptPostProcessing;
    if (!['none', 'merge', 'semi', 'strict', 'single'].includes(mode)) return '';
    var before = stscriptSettingsSnapshot();
    provider.promptPostProcessing = mode;
    await stscriptSaveProviderChange(before);
    return mode;
  },
});
stscriptAddCommand({
  name: 'stop-strings',
  dryRun: function (args, value) {
    return stscriptJoin(value).trim() === '' && !stscriptIsTrue(args.force) ? 'run' : null;
  },
  aliases: ['stopping-strings', 'custom-stopping-strings', 'custom-stop-strings'],
  namedArgumentList: [{ name: 'force' }],
  callback: async function (args, value) {
    var s = stscriptPromptSettings(),
      raw = String(stscriptJoin(value) || '').trim();
    if (!raw && !stscriptIsTrue(args.force)) return JSON.stringify(s.customStoppingStrings);
    if (!raw) raw = '[]';
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error('停止字符串必须是 JSON 字符串数组');
    }
    if (!Array.isArray(parsed)) throw new Error('停止字符串必须是 JSON 字符串数组');
    var before = stscriptSettingsSnapshot();
    s.customStoppingStrings = parsed.map(String);
    await stscriptSaveProviderChange(before);
    return JSON.stringify(s.customStoppingStrings);
  },
});
stscriptAddCommand({
  name: 'start-reply-with',
  dryRun: function (args, value) {
    return stscriptJoin(value) === '' && !stscriptIsTrue(args.force) ? 'run' : null;
  },
  namedArgumentList: [{ name: 'force' }],
  callback: async function (args, value) {
    var s = stscriptPromptSettings(),
      text = String(stscriptJoin(value) || '');
    if (!text && !stscriptIsTrue(args.force)) return s.startReplyWith;
    var before = stscriptSettingsSnapshot();
    s.startReplyWith = text;
    await stscriptSaveProviderChange(before);
    return s.startReplyWith;
  },
});

// Chat Completion preset and prompt order
stscriptAddCommand({
  name: 'preset',
  dryRun: stscriptDryRunReadIfBlank,
  callback: async function (args, value) {
    var name = String(stscriptJoin(value) || '').trim();
    // Like ST, a name that matches no preset leaves the current one and reports it.
    var row = name && stscriptFindNamed(presetRows(), name);
    if (!row || !(await loadPreset(row.name))) return String(D.settings.activeChatCompletionPresetName || '');
    return row.name;
  },
});
function stscriptPromptArgumentList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  try {
    var parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [String(value)];
  } catch (_) {
    return [String(value)];
  }
}
function stscriptPromptTargets(args, raw) {
  var prompts = Array.isArray(raw && raw.prompts) ? raw.prompts : [],
    identifiers = stscriptPromptArgumentList(args.identifier),
    names = stscriptPromptArgumentList(args.name);
  names.forEach(function (name) {
    prompts.forEach(function (prompt) {
      if (String(prompt && prompt.name) === name) identifiers.push(String(prompt.identifier || ''));
    });
  });
  return Array.from(new Set(identifiers)).filter(function (identifier) {
    return prompts.some(function (prompt) {
      return String(prompt && prompt.identifier) === identifier;
    });
  });
}
stscriptAddCommand({
  name: 'getpromptentry',
  dryRun: 'run',
  aliases: ['getpromptentries'],
  namedArgumentList: [{ name: 'identifier' }, { name: 'name' }, { name: 'return' }],
  callback: function (args) {
    var raw = activeCompletionPresetRaw(),
      targets = stscriptPromptTargets(args, raw),
      order = presetOrderRow(raw),
      states = {};
    targets.forEach(function (id) {
      var row = ((order && order.order) || []).find(function (item) {
        return String(item && item.identifier) === id;
      });
      if (row) states[id] = row.enabled !== false;
    });
    var values = Object.values(states),
      type = String(args.return || 'simple');
    if (type === 'simple' && values.length > 1) type = args.identifier ? 'dict' : 'list';
    if (type === 'dict') return JSON.stringify(states);
    if (type === 'list') return JSON.stringify(values);
    return values.length ? String(values[0]) : '';
  },
});
stscriptAddCommand({
  name: 'setpromptentry',
  aliases: ['setpromptentries'],
  namedArgumentList: [{ name: 'identifier' }, { name: 'name' }],
  callback: async function (args, value) {
    var raw = completionPresetInUseRaw();
    if (!raw) throw new Error('请先载入具名聊天补全预设');
    var activeName = String(presetSettingsStore().activeChatCompletionPresetName || '');
    if (!activeName || !presetNamedRow(activeName)) throw new Error('当前使用夜欲默认编排；请先载入具名聊天补全预设');
    var targets = stscriptPromptTargets(args, raw),
      order = presetOrderRow(raw),
      state = String(stscriptJoin(value) || 'toggle')
        .trim()
        .toLowerCase(),
      before = stscriptSettingsSnapshot();
    ((order && order.order) || []).forEach(function (row) {
      if (!targets.includes(String(row && row.identifier))) return;
      if (['toggle', 't', ''].includes(state)) row.enabled = row.enabled === false;
      else if (stscriptIsTrue(state)) row.enabled = true;
      else if (stscriptIsFalse(state)) row.enabled = false;
    });
    var rollbackDraft = completionPresetSyncHostWrite('in_use');
    await stscriptSaveSettingsChange(
      before,
      function () {
        if (typeof completionPresetRenderFields === 'function') completionPresetRenderFields();
      },
      rollbackDraft
    );
    return '';
  },
});
stscriptAddCommand({
  name: 'pm-render',
  namedArgumentList: [{ name: 'refresh' }],
  callback: function () {
    if (typeof completionPresetRenderFields === 'function') completionPresetRenderFields();
    return '';
  },
});

// Connection profiles use the existing model route preset as their canonical owner.
function stscriptConnectionProfile(value) {
  ensureProviderSettings(D.settings);
  var rows = D.settings.modelPresets.filter(function (row) {
    return !!(row && row.routes && row.routes.chat);
  });
  if (!value)
    return (
      rows.find(function (row) {
        return row.id === D.settings.activeConnectionProfileId;
      }) || null
    );
  return stscriptFindNamed(rows, value);
}
function stscriptConnectionRoute(profile) {
  var route = Object.assign({}, (profile && profile.routes && profile.routes.chat) || {}),
    provider = stscriptProvider(route.providerId) || stscriptProvider();
  return Object.assign({}, resolveApiRoute('chat'), {
    providerId: provider.id,
    name: provider.name,
    apiUrl: provider.apiUrl,
    apiKey: providerActiveApiKey(provider),
    model: String(route.model || provider.model || ''),
    promptPostProcessing: provider.promptPostProcessing,
  });
}
stscriptAddCommand({
  name: 'profile',
  dryRun: stscriptDryRunReadIfBlank,
  namedArgumentList: [{ name: 'await' }, { name: 'timeout' }],
  callback: async function (args, value) {
    var name = String(stscriptJoin(value) || '').trim(),
      current = stscriptConnectionProfile();
    if (!name) return current ? current.name : '<None>';
    if (name === '<None>') {
      var emptyBefore = stscriptSettingsSnapshot();
      D.settings.activeConnectionProfileId = '';
      await stscriptSaveProviderChange(emptyBefore);
      return '<None>';
    }
    var profile = stscriptConnectionProfile(name);
    if (!profile) return '';
    var before = stscriptSettingsSnapshot();
    D.settings.activeConnectionProfileId = profile.id;
    await stscriptSaveProviderChange(before);
    return profile.name;
  },
});
stscriptAddCommand({
  name: 'profile-list',
  dryRun: 'run',
  callback: function () {
    ensureProviderSettings(D.settings);
    return JSON.stringify(
      D.settings.modelPresets
        .filter(function (row) {
          return row && row.routes && row.routes.chat;
        })
        .map(function (row) {
          return row.name;
        })
    );
  },
});
stscriptAddCommand({
  name: 'profile-create',
  callback: async function (args, value) {
    var name = String(stscriptJoin(value) || '').trim();
    if (!name || stscriptConnectionProfile(name)) return '';
    var before = stscriptSettingsSnapshot(),
      provider = stscriptProvider(),
      profile = {
        id: 'preset_' + stscriptUid(),
        name: name,
        routes: { chat: { providerId: provider.id, model: provider.model } },
      };
    D.settings.modelPresets.push(profile);
    D.settings.activeConnectionProfileId = profile.id;
    await stscriptSaveProviderChange(before);
    return profile.name;
  },
});
stscriptAddCommand({
  name: 'profile-update',
  callback: async function () {
    var provider = stscriptProvider(),
      profile = stscriptConnectionProfile();
    if (!profile) return '';
    var before = stscriptSettingsSnapshot();
    profile.routes = profile.routes && typeof profile.routes === 'object' ? profile.routes : {};
    profile.routes.chat = { providerId: provider.id, model: provider.model };
    await stscriptSaveProviderChange(before);
    return profile.name;
  },
});
stscriptAddCommand({
  name: 'profile-get',
  dryRun: 'run',
  callback: function (args, value) {
    var profile = stscriptConnectionProfile(String(stscriptJoin(value) || '').trim());
    return profile ? JSON.stringify(profile) : '';
  },
});
stscriptAddCommand({
  name: 'profile-genstream',
  dryRun: 'model',
  namedArgumentList: [
    'lock',
    'profile',
    'reasoning',
    'system',
    'length',
    'generating',
    'completed',
    'delay',
    'stop',
    'onStop',
    'onComplete',
  ].map(function (name) {
    return { name: name };
  }),
  callback: async function (args, value) {
    var prompt = String(stscriptJoin(value) || '');
    if (!prompt) return '';
    var profile = stscriptConnectionProfile(args.profile),
      route = stscriptConnectionRoute(profile || stscriptConnectionProfile()),
      controller = new AbortController(),
      allowStop = !stscriptIsFalse(args.stop),
      abort = function () {
        if (!controller.signal.aborted) controller.abort();
      },
      id =
        typeof scriptLoaderShow === 'function'
          ? scriptLoaderShow({
              message: args.generating || '正在生成…',
              title: profile && profile.name,
              onStop: args.onStop,
              blocking: stscriptIsTrue(args.lock),
              toast: allowStop ? 'stoppable' : 'static',
              cancel: allowStop ? abort : null,
            })
          : '';
    try {
      var messages = [];
      if (args.system) messages.push({ role: 'system', content: String(args.system) });
      messages.push({ role: 'user', content: prompt });
      var result = await stscriptCompletion(args, messages, {
        transient: true,
        nonStream: true,
        routeOverride: route,
        maxTokens: Number(args.length) || 2048,
        ignoreUserMaxTokens: true,
        controller: controller,
      });
      var output = String(result.content || '');
      if (stscriptIsTrue(args.reasoning) && result.reasoning)
        output = stscriptFormatReasoning(result.reasoning, output);
      if (args.onComplete instanceof StscriptClosure) await args.onComplete.getCopy().execute();
      return output;
    } finally {
      if (id && typeof scriptLoaderFinish === 'function') await scriptLoaderFinish(id, false);
    }
  },
});

// System prompt profiles
stscriptAddCommand({
  name: 'sysprompt',
  dryRun: stscriptDryRunReadIfBlank,
  aliases: ['system-prompt'],
  namedArgumentList: [{ name: 'quiet' }, { name: 'forceGet' }],
  callback: async function (args, value) {
    var name = String(stscriptJoin(value) || '').trim(),
      active = stscriptActiveSystemPromptProfile(stscriptIsTrue(args.forceGet));
    if (stscriptPromptSettings().systemPromptEnabled !== true && !stscriptIsTrue(args.forceGet)) return '';
    if (!name) return active ? active.name : '';
    var profile = stscriptFindNamed(stscriptPromptSettings().systemPromptProfiles, name);
    if (!profile) return '';
    var before = stscriptSettingsSnapshot();
    D.settings.activeSystemPromptProfileId = profile.id;
    D.settings.systemPromptEnabled = true;
    await stscriptSaveSystemPromptChange(before);
    return profile.name;
  },
});
// 即时保存写的是 D.settings；预设页开着时把它的草稿对齐过去，表单立刻显示这次改动。
function stscriptSaveSystemPromptChange(before) {
  return stscriptSaveSettingsChange(before, function () {
    if (typeof completionPresetSyncSystemPromptDraft === 'function') completionPresetSyncSystemPromptDraft();
    stscriptRenderSystemPromptField();
  });
}
async function stscriptSetSystemPromptEnabled(enabled) {
  var s = stscriptPromptSettings(),
    before = stscriptSettingsSnapshot();
  s.systemPromptEnabled = enabled === true;
  await stscriptSaveSystemPromptChange(before);
  return '';
}
[
  ['on', 'enable', true],
  ['off', 'disable', false],
].forEach(function (row) {
  stscriptAddCommand({
    name: 'sysprompt-' + row[0],
    aliases: ['sysprompt-' + row[1]],
    callback: function () {
      return stscriptSetSystemPromptEnabled(row[2]);
    },
  });
});
stscriptAddCommand({
  name: 'sysprompt-state',
  dryRun: stscriptDryRunReadIfBlank,
  aliases: ['sysprompt-toggle'],
  callback: async function (args, value) {
    var text = String(stscriptJoin(value) || '').trim(),
      enabled = stscriptPromptSettings().systemPromptEnabled === true;
    if (!text) return String(enabled);
    enabled = stscriptIsTrue(text);
    await stscriptSetSystemPromptEnabled(enabled);
    return String(enabled);
  },
});

// Author's note and generic prompt injections
function stscriptPromptFilterExecutor(filter, abortController) {
  var closure =
    filter instanceof StscriptClosure
      ? filter
      : new StscriptParser().parse(String(filter || ''), true, null, abortController);
  // Given the preview notes, the filter runs dry: on copies of the scopes it inherits and of the variables.
  return async function (previewNotes) {
    try {
      var run = closure.getCopy();
      if (previewNotes) {
        run.abortController = stscriptDryRunController(previewNotes);
        for (var scope = run.scope; scope.parent; scope = scope.parent) scope.parent = scope.parent.getCopy();
        if (typeof generationPromptNoteScriptRan === 'function') generationPromptNoteScriptRan(previewNotes);
      } else run.abortController = abortController || run.abortController;
      var result = await run.execute();
      return stscriptIsTrue(result.pipe);
    } catch (_) {
      return false;
    }
  };
}
// The filter a stored /inject row carries as text; one that no longer parses lets the row through.
function stscriptPromptFilterForRow(row) {
  try {
    return stscriptPromptFilterExecutor(row.filterText);
  } catch (_) {
    return function () {
      return true;
    };
  }
}
async function stscriptRestorePromptFilters(char, session) {
  if (!char || !session || !session.promptInjections) return;
  var rows = Object.values(session.promptInjections);
  for (var row of rows) {
    if (!row || row.hasFilter !== true || !row.filterText) continue;
    var key = hostPromptKey(char.id, session.id, row.id),
      record = _hostPromptFilters.get(key);
    if (record && record.row === row && record.script === true) continue;
    var filter = stscriptPromptFilterForRow(row);
    await hostPromptCommandInject(char, session, {
      id: row.id,
      content: row.content,
      position: row.position,
      depth: row.depth,
      role: row.role,
      should_scan: row.should_scan,
      once: row.once,
      filter: filter,
      filterText: row.filterText,
    });
  }
}
function stscriptAuthorValue(key, value, normalize) {
  var s = stscriptPromptSettings(),
    text = String(stscriptJoin(value) || '');
  if (!text) return Promise.resolve(String(s[key] == null ? '' : s[key]));
  var before = stscriptSettingsSnapshot();
  s[key] = normalize ? normalize(text) : text;
  return stscriptSaveSettingsChange(before).then(function () {
    if (typeof completionPresetSyncAuthorNoteDraft === 'function') completionPresetSyncAuthorNoteDraft(key, s[key]);
    if (typeof completionPresetRenderFields === 'function') completionPresetRenderFields();
    stscriptPromptFeatureRenderUi();
    return String(s[key]);
  });
}
stscriptAddCommand({
  name: 'note',
  dryRun: stscriptDryRunReadIfEmpty,
  callback: function (args, value) {
    return stscriptAuthorValue('authorsNote', value);
  },
});
[
  ['note-depth', ['depth'], 'anDepth', '深度'],
  ['note-frequency', ['freq', 'note-freq'], 'anFreq', '频率'],
].forEach(function (row) {
  stscriptAddCommand({
    name: row[0],
    aliases: row[1],
    dryRun: stscriptDryRunReadIfEmpty,
    callback: function (args, value) {
      return stscriptAuthorValue(row[2], value, function (text) {
        var n = Number(text);
        if (Number.isNaN(n)) throw new Error('作者注' + row[3] + '必须是数字');
        return Math.abs(n);
      });
    },
  });
});
stscriptAddCommand({
  name: 'note-position',
  dryRun: stscriptDryRunReadIfEmpty,
  aliases: ['pos', 'note-pos'],
  callback: async function (args, value) {
    var text = String(stscriptJoin(value) || '');
    if (!text)
      return stscriptPromptSettings().authorNotePosition === 'before'
        ? 'before_scenario'
        : String(stscriptPromptSettings().authorNotePosition || 'after');
    var result = await stscriptAuthorValue('authorNotePosition', value, function (input) {
      var map = { scenario: 'after', before_scenario: 'before' },
        position = map[input.toLowerCase()] || input.toLowerCase();
      if (!['before', 'after', 'chat'].includes(position)) throw new Error('作者注位置必须是 before、after 或 chat');
      return position;
    });
    return result === 'before' ? 'before_scenario' : result;
  },
});
stscriptAddCommand({
  name: 'note-role',
  dryRun: stscriptDryRunReadIfEmpty,
  callback: function (args, value) {
    return stscriptAuthorValue('authorNoteRole', value, function (text) {
      var role = text.toLowerCase();
      if (!['system', 'user', 'assistant'].includes(role))
        throw new Error('作者注角色必须是 system、user 或 assistant');
      return role;
    });
  },
});

var stscriptPromptReturnModes = ['none', 'pipe', 'object', 'chat-html', 'popup-html', 'toast-html'];
async function stscriptPromptReturn(returnType, value, options) {
  options = options || {};
  var text = String(options.text == null ? (typeof value === 'string' ? value : '') : options.text);
  if (returnType === 'none') return '';
  if (returnType === 'pipe') return text;
  if (returnType === 'object') return JSON.stringify(value);
  if (returnType === 'popup-html') {
    var html = options.html || '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>';
    await scriptDialog(options.title || '脚本返回', html, [{ label: '确定', value: true }], { wide: true });
    return '';
  }
  if (returnType === 'toast-html') {
    if (typeof toast === 'function') toast(text, 'info');
    return '';
  }
  await stscriptSaveMsg('system', text, {
    kind: 'stscript-system',
    speaker: options.speaker || '系统',
    compact: true,
    excludeFromMemory: true,
    excludeFromWorldBook: true,
  });
  if (typeof renderChat === 'function') renderChat();
  return '';
}

stscriptAddCommand({
  name: 'inject',
  namedArgumentList: ['id', 'position', 'depth', 'scan', 'role', 'ephemeral', 'filter'].map(function (name) {
    return { name: name };
  }),
  callback: async function (args, value) {
    var char = stscriptChar(),
      session = stscriptSess(),
      text = String(stscriptJoin(value) || ''),
      id = String(args.id || '') || Math.random().toString(36).slice(2);
    var filterText = args.filter instanceof StscriptClosure ? String(args.filter.rawText || '') : '';
    if (args.filter && (!(args.filter instanceof StscriptClosure) || !filterText.trim()))
      throw new Error('filter 需要非空闭包');
    if (!text) {
      await hostPromptCommandRemove(char, session, id);
      return id;
    }
    var position =
        { before: 'before_prompt', after: 'in_prompt', chat: 'in_chat', none: 'none' }[
          String(args.position || 'after')
        ] || 'in_prompt',
      filter =
        args.filter instanceof StscriptClosure
          ? stscriptPromptFilterExecutor(args.filter, args._abortController)
          : null;
    await hostPromptCommandInject(char, session, {
      id: id,
      content: text,
      position: position,
      depth: Number.isNaN(Number(args.depth)) ? 4 : Number(args.depth == null ? 4 : args.depth),
      role: ['system', 'user', 'assistant'].includes(String(args.role || '').toLowerCase())
        ? String(args.role).toLowerCase()
        : 'system',
      should_scan: stscriptIsTrue(args.scan),
      once: stscriptIsTrue(args.ephemeral),
      filter: filter,
      filterText: filterText,
    });
    return id;
  },
});
stscriptAddCommand({
  name: 'listinjects',
  dryRun: stscriptDryRunReadUnlessShown('popup-html'),
  namedArgumentList: [{ name: 'return' }],
  callback: async function (args) {
    var session = stscriptSess(),
      rows = (session && session.promptInjections) || {},
      result = {},
      positions = { before_prompt: 2, in_prompt: 0, in_chat: 1, none: -1 },
      positionNames = { '-1': 'NONE', 0: 'IN_PROMPT', 1: 'IN_CHAT', 2: 'BEFORE_PROMPT' },
      roles = { system: 0, user: 1, assistant: 2 },
      returnType = String(args.return || 'popup-html').toLowerCase();
    Object.keys(rows).forEach(function (id) {
      var row = rows[id];
      result[id] = {
        value: row.content,
        position: positions[row.position] == null ? 0 : positions[row.position],
        depth: row.depth,
        scan: row.should_scan === true,
        role: roles[row.role] == null ? 0 : roles[row.role],
        filter: row.filterText || null,
      };
    });
    if (returnType === 'console') throw new Error('/listinjects 不支持 return=console，避免在控制台泄露注入正文');
    if (!['object', 'none', 'chat-html', 'popup-html', 'toast-html'].includes(returnType))
      throw new Error('/listinjects 的 return 必须是 object、chat-html、popup-html、toast-html、console 或 none');
    var entries = Object.keys(result),
      text = entries.length
        ? '脚本注入：\n' +
          entries
            .map(function (id) {
              var row = result[id];
              return (
                '- ' +
                id +
                ': ' +
                row.value +
                ' (' +
                (positionNames[row.position] || 'unknown') +
                ', depth: ' +
                row.depth +
                ', scan: ' +
                row.scan +
                ', role: ' +
                row.role +
                ')'
              );
            })
            .join('\n')
        : '当前聊天没有脚本注入',
      html = entries.length
        ? '<h3>脚本注入</h3><ul>' +
          entries
            .map(function (id) {
              var row = result[id];
              return (
                '<li><strong>' +
                esc(id) +
                '</strong>: <code>' +
                esc(row.value) +
                '</code> (' +
                esc(positionNames[row.position] || 'unknown') +
                ', depth: ' +
                esc(row.depth) +
                ', scan: ' +
                esc(row.scan) +
                ', role: ' +
                esc(row.role) +
                ')</li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p>当前聊天没有脚本注入</p>';
    return await stscriptPromptReturn(returnType, result, {
      text: text,
      html: html,
      title: '脚本注入',
    });
  },
});
stscriptAddCommand({
  name: 'flushinject',
  aliases: ['flushinjects'],
  callback: function (args, value) {
    return hostPromptCommandRemove(stscriptChar(), stscriptSess(), String(stscriptJoin(value) || ''));
  },
});

function stscriptSaveProviderChange(before) {
  return stscriptSaveSettingsChange(before, function () {
    // 即时保存写的是 D.settings；设置页开着时把草稿对齐过去，表单立刻显示这次改动。
    if (typeof refreshProviderDraft === 'function') refreshProviderDraft();
    if (typeof renderProviderEditor === 'function') renderProviderEditor();
    if (typeof renderModelPresetForm === 'function') renderModelPresetForm();
  });
}

// Multiple API keys / secrets
var stscriptSecretArgs = [{ name: 'quiet' }, { name: 'key' }];
stscriptAddCommand({
  name: 'secret-id',
  dryRun: stscriptDryRunReadIfBlank,
  aliases: ['secret-rotate'],
  namedArgumentList: stscriptSecretArgs,
  callback: async function (args, value) {
    var provider = stscriptResolveSecretProvider(args.key);
    if (!provider) return '';
    var text = String(stscriptJoin(value) || '').trim(),
      row = stscriptSecretRow(provider, text);
    if (!text) return row ? row.id : '';
    if (!row || (row.id !== text && row.label !== text)) return '';
    var before = stscriptSettingsSnapshot();
    provider.activeApiKeyId = row.id;
    provider.apiKey = row.value;
    await stscriptSaveProviderChange(before);
    return row.id;
  },
});
stscriptAddCommand({
  name: 'secret-write',
  namedArgumentList: stscriptSecretArgs.concat([{ name: 'label' }, { name: 'empty' }]),
  callback: async function (args, value) {
    var provider = stscriptResolveSecretProvider(args.key),
      secret = String(stscriptJoin(value) || '').trim();
    if (!provider || (!secret && !stscriptIsTrue(args.empty))) return '';
    var before = stscriptSettingsSnapshot(),
      id = 'key_' + stscriptUid(),
      row = { id: id, label: String(args.label || new Date().toLocaleString()), value: secret };
    normalizeProviderApiKeys(provider);
    provider.apiKeys.push(row);
    provider.activeApiKeyId = id;
    provider.apiKey = secret;
    await stscriptSaveProviderChange(before);
    return id;
  },
});
stscriptAddCommand({
  name: 'secret-delete',
  namedArgumentList: stscriptSecretArgs,
  callback: async function (args, value) {
    var provider = stscriptResolveSecretProvider(args.key);
    if (!provider) return '';
    var row = stscriptSecretRow(provider, value);
    if (!row) return '';
    var before = stscriptSettingsSnapshot();
    provider.apiKeys = provider.apiKeys.filter(function (item) {
      return item.id !== row.id;
    });
    provider.activeApiKeyId = provider.apiKeys.length ? provider.apiKeys[0].id : '';
    provider.apiKey = provider.apiKeys.length ? provider.apiKeys[0].value : '';
    await stscriptSaveProviderChange(before);
    return row.id;
  },
});
stscriptAddCommand({
  name: 'secret-rename',
  namedArgumentList: stscriptSecretArgs.concat([{ name: 'id' }]),
  callback: async function (args, value) {
    var provider = stscriptResolveSecretProvider(args.key),
      label = String(stscriptJoin(value) || '').trim();
    if (!provider || !label) return '';
    var row = stscriptSecretRow(provider, args.id);
    if (!row) return '';
    var before = stscriptSettingsSnapshot();
    row.label = label;
    await stscriptSaveProviderChange(before);
    return row.id;
  },
});
stscriptAddCommand({
  name: 'secret-read',
  dryRun: 'run',
  aliases: ['secret-find', 'secret-get'],
  namedArgumentList: stscriptSecretArgs,
  callback: function (args, value) {
    var provider = stscriptResolveSecretProvider(args.key),
      row = provider && stscriptSecretRow(provider, value);
    return row ? row.value : '';
  },
});

// Reasoning message data, formatting, and persistent collapse state
function stscriptReasoningMessage(value) {
  var messages = stscriptMsgs(),
    index = value == null || String(value).trim() === '' ? messages.length - 1 : Number(value);
  return Number.isInteger(index) && messages[index] ? { message: messages[index], index: index } : null;
}
stscriptAddCommand({
  name: 'reasoning-get',
  dryRun: 'run',
  aliases: ['get-reasoning'],
  callback: function (args, value) {
    var row = stscriptReasoningMessage(stscriptJoin(value)),
      own = row && messageOwnReasoningFields(row.message);
    return own ? String(own.reasoning || '') : '';
  },
});
stscriptAddCommand({
  name: 'reasoning-set',
  aliases: ['set-reasoning'],
  namedArgumentList: [{ name: 'at' }, { name: 'collapse' }],
  callback: async function (args, value) {
    var row = stscriptReasoningMessage(args.at),
      char = stscriptChar(),
      session = stscriptSess();
    if (!row) return '';
    var before = JSON.parse(JSON.stringify(row.message));
    // 写的是当前候选的思考（见 messageSwipeAdoptReasoning）。
    messageSwipeAdoptReasoning(row.message);
    row.message.reasoning = String(stscriptJoin(value) || '');
    if (args.collapse != null && String(args.collapse) !== '')
      row.message.reasoningCollapsed = stscriptIsTrue(args.collapse);
    try {
      await saveData('sessions', { urgent: true });
    } catch (error) {
      Object.keys(row.message).forEach(function (key) {
        delete row.message[key];
      });
      Object.assign(row.message, before);
      throw error;
    }
    stscriptRenderOwner(char, session);
    return row.message.reasoning;
  },
});
stscriptAddCommand({
  name: 'reasoning-parse',
  dryRun: 'run',
  aliases: ['parse-reasoning'],
  namedArgumentList: [{ name: 'regex' }, { name: 'return' }, { name: 'strict' }],
  callback: function (args, value) {
    var text = String(stscriptJoin(value) || ''),
      template = stscriptActiveReasoningTemplate();
    if (!template || !template.prefix || !template.suffix) return text;
    var parsed = stscriptParseReasoningText(text, !stscriptIsFalse(args.strict));
    if (!parsed) return args.return === 'content' ? text : '';
    if (args.return === 'content') return parsed.content;
    return !stscriptIsFalse(args.regex) && typeof formatRegexedStringForContext === 'function'
      ? formatRegexedStringForContext(stscriptChar(), stscriptSess(), {
          text: parsed.reasoning,
          source: 'reasoning',
          destination: '',
        })
      : parsed.reasoning;
  },
});
stscriptAddCommand({
  name: 'reasoning-format',
  dryRun: 'run',
  aliases: ['format-reasoning'],
  namedArgumentList: [{ name: 'reasoning' }],
  callback: function (args, value) {
    return args.reasoning ? stscriptFormatReasoning(String(args.reasoning), String(stscriptJoin(value) || '')) : '';
  },
});
stscriptAddCommand({
  name: 'reasoning-template',
  dryRun: stscriptDryRunReadIfBlank,
  aliases: ['reasoning-formatting', 'reasoning-preset'],
  namedArgumentList: [{ name: 'quiet' }],
  callback: async function (args, value) {
    var s = stscriptPromptSettings(),
      name = String(stscriptJoin(value) || '').trim(),
      current = stscriptActiveReasoningTemplate();
    if (!name) return current ? current.name : '';
    var template = stscriptFindNamed(s.reasoningTemplates, name);
    if (!template) return '';
    var before = stscriptSettingsSnapshot();
    s.activeReasoningTemplateId = template.id;
    await stscriptSaveProviderChange(before);
    return template.name;
  },
});
async function stscriptSetReasoningCollapsed(value, mode) {
  var messages = stscriptMsgs(),
    range = stscriptParseRange(value, messages.length),
    changed = false,
    before = [];
  for (var index = range[0]; index <= range[1]; index++) {
    if (!messages[index] || !String((messageOwnReasoningFields(messages[index]) || {}).reasoning || '').trim())
      continue;
    before.push({
      message: messages[index],
      hadValue: Object.prototype.hasOwnProperty.call(messages[index], 'reasoningCollapsed'),
      value: messages[index].reasoningCollapsed,
    });
    messages[index].reasoningCollapsed =
      mode === 'toggle' ? messages[index].reasoningCollapsed !== true : mode === 'collapse';
    changed = true;
  }
  if (changed) {
    try {
      await saveData('sessions', { urgent: true });
    } catch (error) {
      before.forEach(function (row) {
        if (row.hadValue) row.message.reasoningCollapsed = row.value;
        else delete row.message.reasoningCollapsed;
      });
      stscriptRenderOwner(stscriptChar(), stscriptSess());
      throw error;
    }
    stscriptRenderOwner(stscriptChar(), stscriptSess());
  }
  return '';
}
['collapse', 'expand', 'toggle'].forEach(function (mode) {
  stscriptAddCommand({
    name: 'reasoning-' + mode,
    aliases: [mode + '-reasoning'],
    callback: function (args, value) {
      return stscriptSetReasoningCollapsed(stscriptJoin(value), mode);
    },
  });
});

async function stscriptWithRequestController(args, work, controller) {
  controller = controller || new AbortController();
  var source = args && args._abortController;
  function abort() {
    controller.abort();
  }
  function check() {
    if (controller.signal.aborted) {
      var error = new Error('已取消');
      error.name = 'AbortError';
      throw error;
    }
  }
  if (source && source.signal && source.signal.aborted) abort();
  if (source && typeof source.onAbort === 'function') source.onAbort(abort);
  try {
    check();
    var result = await work(controller);
    check();
    return result;
  } finally {
    if (source && typeof source.offAbort === 'function') source.offAbort(abort);
  }
}
function stscriptCompletion(args, messages, options) {
  options = options || {};
  return stscriptWithRequestController(
    args,
    function (controller) {
      return callDeepSeek(messages, null, Object.assign({}, options, { controller: controller }));
    },
    options.controller
  );
}

// Raw/system generation, stop, translation, and summary
stscriptAddCommand({
  name: 'genraw',
  dryRun: 'model',
  namedArgumentList: ['lock', 'instruct', 'stop', 'as', 'system', 'prefill', 'length', 'trim'].map(function (name) {
    return { name: name };
  }),
  callback: async function (args, value) {
    var prompt = String(stscriptJoin(value) || '');
    if (!prompt) return '';
    var messages = [];
    if (args.system) messages.push({ role: 'system', content: String(args.system) });
    messages.push({ role: 'user', content: prompt });
    if (args.prefill) messages.push({ role: 'assistant', content: String(args.prefill) });
    var stop = [];
    if (args.stop) {
      try {
        stop = JSON.parse(String(args.stop));
      } catch (_) {}
      if (!Array.isArray(stop)) stop = [];
    }
    var result = await stscriptCompletion(args, messages, {
      transient: true,
      nonStream: true,
      // As in ST, length= is this reply's own budget; without it the chat reply limit applies.
      maxTokens: Number(args.length) || 0,
      ignoreUserMaxTokens: Number(args.length) > 0,
      requestBodyPatch: stop.length ? { stop: stop.map(String) } : null,
    });
    return stscriptIsFalse(args.trim) ? String(result.content || '') : stscriptTrimGeneratedNames(result.content);
  },
});
stscriptAddCommand({
  name: 'sysname',
  callback: async function (args, value) {
    var session = stscriptSess();
    if (!session) return '';
    var hadValue = Object.prototype.hasOwnProperty.call(session, 'narratorName'),
      before = session.narratorName;
    session.narratorName = String(stscriptJoin(value) || '系统');
    try {
      await saveData('sessions', { urgent: true });
    } catch (error) {
      if (hadValue) session.narratorName = before;
      else delete session.narratorName;
      throw error;
    }
    return '';
  },
});
stscriptAddCommand({
  name: 'sysgen',
  dryRun: 'model',
  namedArgumentList: [{ name: 'trim' }, { name: 'compact' }, { name: 'at' }, { name: 'name' }, { name: 'return' }],
  callback: async function (args, value) {
    var char = stscriptChar(),
      session = stscriptSess(),
      prompt = String(stscriptJoin(value) || ''),
      returnType = String(args.return || 'none').toLowerCase();
    if (!char || !session || !prompt) return '';
    if (!stscriptPromptReturnModes.includes(returnType))
      throw new Error('/sysgen 的 return 必须是 pipe、object、chat-html、popup-html、toast-html 或 none');
    var output = await generateQuietForCharacter(char, session, prompt, { abortController: args._abortController });
    if (stscriptIsTrue(args.trim)) output = stscriptTrimToSentence(output);
    if (typeof formatRegexedStringForContext === 'function')
      output = formatRegexedStringForContext(char, session, {
        text: output,
        source: 'slash_command',
        destination: '',
      });
    var sysArgs = Object.assign({}, args, { name: args.name || session.narratorName || '系统', return: 'none' });
    var previousMessages = session.msgs.slice();
    await STSCRIPT_COMMANDS.sys.callback(sysArgs, output);
    var message = session.msgs.find(function (row) {
      return !previousMessages.includes(row);
    });
    return await stscriptPromptReturn(returnType, message || { content: output }, {
      text: output,
      title: '系统消息',
    });
  },
});
stscriptAddCommand({
  name: 'stop',
  aliases: ['generate-stop'],
  callback: function () {
    var running = typeof generationWorkPending === 'function' && generationWorkPending();
    if (running && typeof stopGeneration === 'function') stopGeneration();
    return String(running);
  },
});
stscriptAddCommand({
  name: 'translate',
  dryRun: 'model',
  namedArgumentList: [{ name: 'target' }, { name: 'provider' }],
  callback: async function (args, value) {
    var text = String(stscriptJoin(value) || '');
    if (!text) return '';
    var target = String(args.target || '中文'),
      system = settingsPromptText('translationPrompt') + '\n目标语言：' + target,
      route = resolveApiRoute('translation');
    if (args.provider) {
      var provider = stscriptProvider(args.provider);
      if (!provider) return '';
      route = Object.assign({}, route, {
        providerId: provider.id,
        name: provider.name,
        apiUrl: provider.apiUrl,
        apiKey: providerActiveApiKey(provider),
        model: provider.model,
      });
    }
    var result = await stscriptCompletion(
      args,
      [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      { transient: true, nonStream: true, routeOverride: route, ignoreUserMaxTokens: true }
    );
    return typeof cleanTranslationResult === 'function'
      ? cleanTranslationResult(result.content)
      : String(result.content || '').trim();
  },
});
stscriptAddCommand({
  name: 'summarize',
  dryRun: 'model',
  namedArgumentList: [{ name: 'source' }, { name: 'prompt' }, { name: 'quiet' }],
  callback: async function (args, value) {
    var text = String(stscriptJoin(value) || '').trim(),
      char = stscriptChar(),
      session = stscriptSess();
    if (text) {
      var prompt = String(args.prompt || '请忠实总结以下内容，保留重要事实、关系和未完成事项。'),
        result = await stscriptCompletion(
          args,
          [
            { role: 'system', content: prompt },
            { role: 'user', content: text },
          ],
          { transient: true, nonStream: true, route: 'memorySummary', ignoreUserMaxTokens: true }
        );
      return String(result.content || '').trim();
    }
    if (!char || !session) return '';
    var plan = memoryV5CompressionPlan(session, D.settings.autoSummaryEvery);
    if (!plan) return String((ensureSessionMemoryStore(session).historySummary || {}).text || '');
    var summarized = await stscriptWithRequestController(args, function (controller) {
      return summarizeMessagesToMemory(char, plan.source, !stscriptIsTrue(args.quiet), 0, session.id, {
        sourceName: 'stscript',
        signal: controller.signal,
      });
    });
    if (!summarized.processed) return '';
    return String((ensureSessionMemoryStore(session).historySummary || {}).text || '');
  },
});

// Page controls edit their owning settings or preset draft.
var STSCRIPT_API_KEY_HINT = '同一供应商可存多个本机密钥，选中哪个，上方 API Key 就换成哪个。';
function stscriptPromptFeatureRenderUi() {
  if (typeof document === 'undefined' || typeof D === 'undefined' || !D || !D.settings) return;
  var s = stscriptPromptSettings(providerFormSettings()),
    provider = editingProviderRecord(),
    keys = $('s-api-key-select');
  if (keys) {
    if (provider) {
      normalizeProviderApiKeys(provider);
      keys.innerHTML = provider.apiKeys.length
        ? provider.apiKeys
            .map(function (row) {
              return '<option value="' + escAttr(row.id) + '">' + esc(row.label) + '</option>';
            })
            .join('')
        : '<option value="">还没有保存的密钥</option>';
      keys.value = provider.activeApiKeyId;
    } else {
      keys.innerHTML = '';
      keys.value = '';
    }
    var hasKeys = !!provider && provider.apiKeys.length > 0;
    keys.disabled = !hasKeys;
    if ($('s-api-key-add')) $('s-api-key-add').disabled = !provider;
    ['s-api-key-rename', 's-api-key-delete'].forEach(function (id) {
      if ($(id)) $(id).disabled = !hasKeys;
    });
    if ($('s-api-key-hint')) $('s-api-key-hint').textContent = STSCRIPT_API_KEY_HINT;
  }
  var reasoning = $('s-reasoning-template-select');
  if (reasoning) {
    reasoning.innerHTML = s.reasoningTemplates
      .map(function (row) {
        return '<option value="' + escAttr(row.id) + '">' + esc(row.name) + '</option>';
      })
      .join('');
    reasoning.value = s.activeReasoningTemplateId;
  }
  stscriptRenderSystemPromptField();
}
// 命名系统提示词属于预设页「辅助」栏，编辑目标是预设管理器草稿，不是设置页的连接草稿。
function stscriptSystemPromptFormSettings() {
  return typeof completionPresetGlobalSettingsDraft === 'function'
    ? completionPresetGlobalSettingsDraft()
    : (typeof D !== 'undefined' && D && D.settings) || null;
}
function stscriptRenderSystemPromptField() {
  var select = typeof document !== 'undefined' && $('pm-system-prompt-select');
  if (!select) return;
  var s = stscriptPromptSettings(stscriptSystemPromptFormSettings());
  if (!s) return;
  select.innerHTML =
    '<option value="">关闭</option>' +
    s.systemPromptProfiles
      .map(function (row) {
        return '<option value="' + escAttr(row.id) + '">' + esc(row.name) + '</option>';
      })
      .join('');
  select.value = s.systemPromptEnabled ? s.activeSystemPromptProfileId || '' : '';
}
function stscriptCaptureConnectionForms() {
  captureProviderForm();
  captureModelPresetForm();
}
async function stscriptSelectApiKey() {
  stscriptCaptureConnectionForms();
  var provider = editingProviderRecord();
  if (!provider) return;
  var current = stscriptSecretRow(provider, $('s-api-key-select').value);
  if (!current) return;
  provider.activeApiKeyId = current.id;
  provider.apiKey = current.value;
  renderProviderEditor();
}
async function stscriptAddApiKey() {
  stscriptCaptureConnectionForms();
  var provider = editingProviderRecord();
  if (!provider) return;
  var label = await appInput('给这个密钥起一个便于识别的名称。', '备用密钥', '新增密钥', '密钥名称', {
    okText: '下一步',
  });
  if (!label) return;
  var value = await appInput('输入 API Key。密钥只保存在本机。', '', '新增密钥', 'API Key', { okText: '添加密钥' });
  if (value == null) return;
  var id = 'key_' + stscriptUid();
  provider.apiKeys.push({ id: id, label: label, value: String(value).trim() });
  provider.activeApiKeyId = id;
  provider.apiKey = String(value).trim();
  renderProviderEditor();
}
async function stscriptRenameApiKey() {
  stscriptCaptureConnectionForms();
  var provider = editingProviderRecord();
  if (!provider) return;
  var row = stscriptSecretRow(provider, '');
  if (!row) return;
  var label = await appInput('修改密钥名称。', row.label, '重命名密钥', '密钥名称', { okText: '保存名称' });
  if (!label) return;
  row.label = label;
  stscriptPromptFeatureRenderUi();
}
async function stscriptDeleteApiKey() {
  stscriptCaptureConnectionForms();
  var provider = editingProviderRecord();
  if (!provider) return;
  var row = stscriptSecretRow(provider, '');
  if (!row || !(await appConfirm('删除密钥“' + row.label + '”？', '删除密钥', '删除'))) return;
  provider.apiKeys = provider.apiKeys.filter(function (item) {
    return item.id !== row.id;
  });
  provider.activeApiKeyId = provider.apiKeys.length ? provider.apiKeys[0].id : '';
  provider.apiKey = provider.apiKeys.length ? provider.apiKeys[0].value : '';
  renderProviderEditor();
}
async function stscriptSelectReasoningTemplate() {
  var settings = providerFormSettings();
  settings.activeReasoningTemplateId = $('s-reasoning-template-select').value;
  stscriptPromptFeatureRenderUi();
}
async function stscriptSelectSystemPrompt() {
  var settings = stscriptSystemPromptFormSettings();
  if (!settings) return;
  var id = $('pm-system-prompt-select').value;
  settings.systemPromptEnabled = !!id;
  if (id) settings.activeSystemPromptProfileId = id;
  stscriptRenderSystemPromptField();
}

// 两组命名条目共用一套管理弹窗，差异只有存放位置、编辑字段和有没有可恢复的默认值。
var STSCRIPT_PROMPT_PROFILE_GROUPS = {
  system: {
    title: '命名系统提示词',
    hint: '在预设页「辅助」里选用条目；改动在预设页点「保存」后生效。',
    empty: '还没有命名系统提示词',
    idPrefix: 'system_prompt_',
    fields: [
      { key: 'content', label: '正文', rows: 6, placeholder: '放在预设主提示词之后、角色卡自带系统提示词之前' },
      { key: 'postHistory', label: '后置内容', rows: 4, placeholder: '放在角色卡后置指令之后；可留空' },
    ],
    settings: stscriptSystemPromptFormSettings,
    rows: function (s) {
      return s.systemPromptProfiles;
    },
    summary: function (row) {
      return '正文 ' + String(row.content || '').length + ' 字 · 后置 ' + String(row.postHistory || '').length + ' 字';
    },
    activeId: function (s) {
      return s.systemPromptEnabled ? s.activeSystemPromptProfileId || '' : '';
    },
    activate: function (s, id) {
      s.activeSystemPromptProfileId = id;
      s.systemPromptEnabled = true;
    },
    fallback: function (s) {
      s.systemPromptEnabled = false;
    },
    render: function () {
      stscriptRenderSystemPromptField();
    },
    // 预设页的未保存提示只监听页内表单事件，弹窗里的改动要主动告诉它。
    changed: function () {
      if (typeof completionPresetNotifyDraftChanged === 'function') completionPresetNotifyDraftChanged();
    },
  },
  reasoning: {
    title: '思考标签模板',
    hint: '用来识别正文里的思考块；改动在设置页点「保存」后生效。',
    empty: '还没有思考标签模板',
    idPrefix: 'reasoning_',
    fields: [
      { key: 'prefix', label: '开始标记', placeholder: '<think>' },
      { key: 'suffix', label: '结束标记', placeholder: '</think>' },
    ],
    settings: function () {
      return providerFormSettings();
    },
    rows: function (s) {
      return s.reasoningTemplates;
    },
    summary: function (row) {
      return String(row.prefix || '') + ' … ' + String(row.suffix || '');
    },
    activeId: function (s) {
      return s.activeReasoningTemplateId || '';
    },
    activate: function (s, id) {
      s.activeReasoningTemplateId = id;
    },
    fallback: function (s) {
      var preferred = s.reasoningTemplates.find(function (row) {
        return row.id === STSCRIPT_REASONING_DEFAULT_TEMPLATE_ID;
      });
      s.activeReasoningTemplateId = preferred ? preferred.id : '';
    },
    reset: function (s) {
      s.reasoningTemplates = [stscriptDefaultReasoningTemplate()];
      s.activeReasoningTemplateId = STSCRIPT_REASONING_DEFAULT_TEMPLATE_ID;
    },
    render: function () {
      stscriptPromptFeatureRenderUi();
    },
  },
};
var _stscriptPromptProfileGroup = '',
  _stscriptPromptProfileEditingId = '';
function stscriptPromptProfileGroup() {
  return STSCRIPT_PROMPT_PROFILE_GROUPS[_stscriptPromptProfileGroup] || null;
}
function stscriptPromptProfileState() {
  var group = stscriptPromptProfileGroup(),
    settings = group && stscriptPromptSettings(group.settings());
  return settings ? { group: group, settings: settings } : null;
}
function stscriptOpenPromptProfileManager(name) {
  if (!STSCRIPT_PROMPT_PROFILE_GROUPS[name]) return;
  _stscriptPromptProfileGroup = name;
  openModal('prompt-profile-manager-modal');
  stscriptRenderPromptProfileManager();
}
function stscriptRenderPromptProfileManager() {
  var state = stscriptPromptProfileState(),
    box = $('prompt-profile-manager-list');
  if (!state || !box) return;
  $('prompt-profile-manager-title').textContent = state.group.title;
  $('prompt-profile-manager-hint').textContent = state.group.hint;
  $('prompt-profile-manager-reset').hidden = typeof state.group.reset !== 'function';
  var activeId = state.group.activeId(state.settings),
    rows = state.group.rows(state.settings);
  box.innerHTML = rows.length
    ? rows
        .map(function (row) {
          return (
            '<div class="prompt-profile-row"><div class="prompt-profile-copy"><strong>' +
            esc(row.name) +
            '</strong><small>' +
            (row.id === activeId ? '<span class="state-tag">使用中</span>' : '') +
            esc(state.group.summary(row)) +
            '</small></div><div class="ui-actions"><button type="button" class="btn text sm accent" onclick="stscriptEditPromptProfile(' +
            jsArg(row.id) +
            ')">编辑</button><button type="button" class="btn text sm accent" onclick="stscriptRenamePromptProfile(' +
            jsArg(row.id) +
            ')">重命名</button><button type="button" class="btn text sm danger" onclick="stscriptDeletePromptProfile(' +
            jsArg(row.id) +
            ')">删除</button></div></div>'
          );
        })
        .join('')
    : '<div class="ui-empty"><strong>' + esc(state.group.empty) + '</strong><p>点底部「新建」添加一条。</p></div>';
}
function stscriptPromptProfileRow(id) {
  var state = stscriptPromptProfileState();
  return state
    ? state.group.rows(state.settings).find(function (row) {
        return row.id === id;
      }) || null
    : null;
}
function stscriptOpenPromptProfileEntry(row) {
  var group = stscriptPromptProfileGroup();
  if (!group) return;
  _stscriptPromptProfileEditingId = row ? row.id : '';
  $('prompt-profile-entry-title').textContent = (row ? '编辑' : '新建') + group.title;
  $('prompt-profile-entry-name').value = row ? row.name : '';
  $('prompt-profile-entry-fields').innerHTML = group.fields
    .map(function (field) {
      var id = 'prompt-profile-entry-' + field.key,
        value = String((row && row[field.key]) || ''),
        placeholder = escAttr(field.placeholder || '');
      return (
        '<div class="fg"><label for="' +
        id +
        '">' +
        esc(field.label) +
        '</label>' +
        (field.rows
          ? '<textarea id="' +
            id +
            '" rows="' +
            field.rows +
            '" placeholder="' +
            placeholder +
            '">' +
            esc(value) +
            '</textarea>'
          : '<input id="' + id + '" type="text" placeholder="' + placeholder + '" value="' + escAttr(value) + '">') +
        '</div>'
      );
    })
    .join('');
  openModal('prompt-profile-entry-modal');
}
function stscriptAddPromptProfile() {
  stscriptOpenPromptProfileEntry(null);
}
function stscriptEditPromptProfile(id) {
  var row = stscriptPromptProfileRow(id);
  if (row) stscriptOpenPromptProfileEntry(row);
}
// 脚本命令按名字找条目（stscriptFindNamed 只命中第一条），同组内不允许重名；比较不区分大小写，
// 和查找规则一致。
function stscriptPromptProfileNameTaken(state, name, ownId) {
  var lower = String(name || '')
    .trim()
    .toLowerCase();
  return state.group.rows(state.settings).some(function (row) {
    return (
      row.id !== ownId &&
      String(row.name || '')
        .trim()
        .toLowerCase() === lower
    );
  });
}
// 弹窗里的每个改动都走这里：归一化设置、重绘列表与所在页的选择框，并让所在页的未保存提示知道。
function stscriptCommitPromptProfileChange(state) {
  stscriptPromptSettings(state.settings);
  stscriptRenderPromptProfileManager();
  state.group.render();
  if (typeof state.group.changed === 'function') state.group.changed();
}
function stscriptSavePromptProfileEntry() {
  var state = stscriptPromptProfileState();
  if (!state) return;
  var name = $('prompt-profile-entry-name').value.trim();
  if (!name) {
    toast('请先填写名称', 'err');
    return;
  }
  var rows = state.group.rows(state.settings),
    row = rows.find(function (item) {
      return item.id === _stscriptPromptProfileEditingId;
    }),
    created = !row;
  if (stscriptPromptProfileNameTaken(state, name, row ? row.id : '')) {
    toast('已有同名的' + state.group.title + '：' + name, 'err');
    return;
  }
  if (created) {
    row = { id: state.group.idPrefix + stscriptUid() };
    rows.push(row);
  }
  row.name = name;
  state.group.fields.forEach(function (field) {
    var node = $('prompt-profile-entry-' + field.key);
    if (node) row[field.key] = String(node.value);
  });
  if (created) state.group.activate(state.settings, row.id);
  closeModal('prompt-profile-entry-modal');
  stscriptCommitPromptProfileChange(state);
}
async function stscriptRenamePromptProfile(id) {
  var renaming = stscriptPromptProfileRow(id);
  if (!renaming) return;
  var name = await appInput('修改名称。', renaming.name, stscriptPromptProfileGroup().title, '名称', {
    okText: '保存名称',
  });
  if (!name || !name.trim()) return;
  var state = stscriptPromptProfileState(),
    row = stscriptPromptProfileRow(id);
  if (!state || !row) return;
  name = name.trim();
  if (stscriptPromptProfileNameTaken(state, name, row.id)) {
    toast('已有同名的' + state.group.title + '：' + name, 'err');
    return;
  }
  row.name = name;
  stscriptCommitPromptProfileChange(state);
}
async function stscriptDeletePromptProfile(id) {
  var confirming = stscriptPromptProfileRow(id);
  if (!confirming) return;
  if (!(await appConfirm('删除“' + confirming.name + '”？', stscriptPromptProfileGroup().title, '删除'))) return;
  var state = stscriptPromptProfileState(),
    row = stscriptPromptProfileRow(id);
  if (!state || !row) return;
  var rows = state.group.rows(state.settings),
    wasActive = state.group.activeId(state.settings) === row.id;
  rows.splice(rows.indexOf(row), 1);
  if (wasActive) state.group.fallback(state.settings);
  stscriptCommitPromptProfileChange(state);
}
async function stscriptResetPromptProfiles() {
  var state = stscriptPromptProfileState();
  if (!state || typeof state.group.reset !== 'function') return;
  if (!(await appConfirm('恢复默认后，自定义条目会被移除。', state.group.title, '恢复默认'))) return;
  state.group.reset(state.settings);
  stscriptCommitPromptProfileChange(state);
}
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', stscriptPromptFeatureRenderUi);
  document.addEventListener(
    'toggle',
    function (event) {
      var details = event.target;
      if (!details || !details.matches || !details.matches('details.think-block[data-reasoning-details]')) return;
      var container = details.closest('[data-msg-idx]'),
        index = container && Number(container.getAttribute('data-msg-idx')),
        message = Number.isInteger(index) && stscriptMsgs()[index];
      if (!message) return;
      // 折叠状态属于当前候选；消息级字段还属于别的候选的旧数据先落成分格。
      if (!messageOwnReasoningFields(message)) messageSwipeAdoptReasoning(message);
      if ((message.reasoningCollapsed === true) === !details.open) return;
      message.reasoningCollapsed = !details.open;
      saveData('sessions').catch(function (error) {
        if (typeof toast === 'function') toast('思考块状态保存失败：' + error.message, 'err');
      });
    },
    true
  );
}
