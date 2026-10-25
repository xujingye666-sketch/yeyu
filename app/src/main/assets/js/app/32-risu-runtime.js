// Risu card sources and chat state. ST hosts never own these values.
var _risuTriggerIds = new WeakMap();
function isRisuCharacter(char) {
  return !!(
    char &&
    ((char.importMeta && char.importMeta.container === 'charx') ||
      (char.extensions && Object.prototype.hasOwnProperty.call(char.extensions, 'risuai')))
  );
}
function risuCardSources(char) {
  var extensions = (char && char.extensions) || {},
    card = extensions.risuai || {},
    module = (extensions.yeyu && extensions.yeyu.risuModule) || null;
  return {
    card: card,
    module: module,
    // characterCards.ts replaces the card's two executable lists with the embedded module.
    regex: module ? module.regex || [] : card.customScripts || [],
    triggers: module ? module.trigger || [] : card.triggerscript || [],
    lorebook: module && module.lorebook,
  };
}
// 固定 Risu inlayScreen.ts：inlay 视图屏且 viewScreen 为 imggen 时，出图指令进 postEverything（34 号），回复里的
// ImgGen 标签以 newGenData.prompt 为模板出图并换成 inlay（33 号 risuGenerateInlayScreen）。不成立时返回 null。
function risuImageGenerationSettings(data) {
  return { instructions: String(data.instructions || ''), prompt: String(data.prompt || '') };
}
function risuInlayImageGeneration(char) {
  var card = risuCardSources(char).card,
    data = card.newGenData || {};
  if (card.inlayViewScreen !== true || card.viewScreen !== 'imggen') return null;
  return risuImageGenerationSettings(data);
}
function risuViewScreenImageGeneration(char) {
  var card = risuCardSources(char).card,
    data = card.newGenData || {};
  if (card.viewScreen !== 'imggen' || card.inlayViewScreen === true) return null;
  return risuImageGenerationSettings(data);
}
function risuDefaultVariables(char) {
  var result = Object.create(null);
  String(risuCardSources(char).card.defaultVariables || '')
    .split('\n')
    .forEach(function (line) {
      var pair = line.split('=');
      if (pair[0] && pair[1] && !Object.prototype.hasOwnProperty.call(result, pair[0])) result[pair[0]] = pair[1];
    });
  return result;
}
function risuDependencyReport(char) {
  var sources = risuCardSources(char),
    card = sources.card,
    items = [],
    vits = card.vits,
    // The official exporter writes an empty vits object on every card. Resource keys, rather
    // than the container's presence, are the evidence that this card actually needs VITS.
    hasVoiceDependency = !!(vits && (typeof vits === 'object' ? Object.keys(vits).length : String(vits).trim()));
  function add(id, label, ready, count, source, detail, missing) {
    if (!count) return;
    items.push({
      id: id,
      label: label,
      group: ready ? 'ready' : 'preserved',
      count: count,
      materialStatus: 'embedded-preserved',
      runtimeStatus: ready ? 'supported-enabled' : 'unsupported',
      impact: detail,
      missing: ready ? '' : String(missing || ''),
      evidence: [{ source: source, detail: detail }],
    });
  }
  add(
    'risu-core',
    'Risu CBS 核心',
    true,
    1,
    'extensions.risuai',
    '独立解析角色宏、聊天变量与条件；完整宏范围见兼容清单。'
  );
  add(
    'risu-module',
    'Risu 随卡模块',
    true,
    sources.module ? 1 : 0,
    'module.risum',
    '随卡模块的正则、触发器、世界书与资产进入独立 Risu 运行体系。'
  );
  add(
    'risu-regex',
    'Risu 正则',
    true,
    sources.regex.length,
    'Risu.customScripts',
    '输入、输出、请求历史与显示四阶段执行；资产演出另行报告。'
  );
  add(
    'risu-trigger',
    'Risu 触发器 / Lua',
    true,
    sources.triggers.length,
    'Risu.triggerscript',
    '独立触发器与 Lua Worker 已接通；仅执行已接入的宿主能力，缺少能力时明确报告。'
  );
  var unfinishedEffects = new Set(),
    deferredEffects = /^(?:checkSimilarity|v2CheckSimilarity|v2Tokenize)$/,
    deferredLua = /\b(?:similarity|axLLM)\s*\(/,
    imageUses = risuInlayImageGeneration(char) || risuViewScreenImageGeneration(char) ? 1 : 0;
  sources.triggers.forEach(function (trigger) {
    (trigger.effect || []).forEach(function (effect) {
      if (deferredEffects.test(effect.type)) unfinishedEffects.add(effect.type);
      if (effect.type === 'triggerlua' && deferredLua.test(String(effect.code || '')))
        unfinishedEffects.add('Lua 宿主能力');
      if (
        effect.type === 'runImgGen' ||
        effect.type === 'v2ImgGen' ||
        (effect.type === 'triggerlua' && /\bgenerateImage\s*\(/.test(String(effect.code || '')))
      )
        imageUses++;
    });
  });
  add(
    'risu-image',
    'Risu 卡片出图',
    true,
    imageUses,
    'extensions.risuai.newGenData / Risu.trigger / Lua',
    '卡片要求出图时，用「设置 → 生图」当前选中的图片来源出图，图片嵌入对应消息或写入脚本变量。'
  );
  if (Array.isArray(card.bias) && card.bias.length) unfinishedEffects.add('bias：需要模型对应的精确分词器');
  add(
    'risu-host-deferred',
    '尚未接入的 Risu 能力',
    false,
    unfinishedEffects.size,
    'Risu.trigger / Lua',
    '这张卡使用了当前尚未接入的触发器或 Lua 宿主能力。',
    '尚未接入：' + Array.from(unfinishedEffects).join('、')
  );
  add(
    'risu-toggle',
    'Risu 选项',
    true,
    card.toggles || card.customModuleToggle ? 1 : 0,
    'extensions.risuai.toggles',
    '聊天页演出选项按当前对话保存，与剧情条件联动。'
  );
  add(
    'risu-lorebook',
    'Risu 世界书',
    true,
    (sources.lorebook || (char.character_book || {}).entries || []).length,
    'module.risum / character_book',
    '按 Risu 条件、顺序和位置激活；Token 预算使用当前应用估算。'
  );
  add(
    'risu-display',
    'Risu 演出',
    true,
    card.backgroundHTML ||
      card.backgroundEmbedding ||
      card.viewScreen ||
      card.inlayViewScreen ||
      card.prebuiltAssetCommand ||
      card.hideChatIcon ||
      card.largePortrait ||
      (char.media_assets || char.assets || []).some(function (asset) {
        return ['x-risu-asset', 'emotion'].includes(asset.assetType || asset.type);
      })
      ? 1
      : 0,
    'extensions.risuai / assets',
    '卡片背景与消息 HTML 独立显示，资产按卡片名称解析。'
  );
  add(
    'risu-voice',
    '卡内 VITS',
    false,
    hasVoiceDependency ? 1 : 0,
    'extensions.risuai',
    '卡内 VITS 不播放，可用夜欲语音朗读；其他内容照常运行。',
    'VITS 模型保留，不在本机运行'
  );
  var counts = { ready: 0, disabled: 0, preserved: 0, missing: 0 };
  items.forEach(function (item) {
    counts[item.group]++;
  });
  return { version: 2, ecosystem: 'risu', items: items, counts: counts, mode: 'full' };
}
function createRisuMacroState(char, session, options) {
  options = options || {};
  var saved = (session && session.risu) || {};
  return {
    ecosystem: 'risu',
    character: char,
    session: session,
    runtimeSession: session,
    commit: options.commit === true,
    random: options.random || Math.random,
    messages: (session && session.msgs) || [],
    vars: Object.assign(Object.create(null), saved.scriptstate || {}),
    globalVars: Object.assign(Object.create(null), saved.globalVariables || {}),
    changedVars: new Set(),
    changedGlobals: new Set(),
    diagnostics: [],
    triggerId: session && _risuTriggerIds.get(session) ? _risuTriggerIds.get(session).value : undefined,
  };
}
function finalizeRisuMacroState(state) {
  if (!state || !state.commit || !state.session || (!state.changedVars.size && !state.changedGlobals.size)) return;
  var session = state.session;
  session.risu = session.risu || {};
  [
    ['scriptstate', 'vars', 'changedVars'],
    ['globalVariables', 'globalVars', 'changedGlobals'],
  ].forEach(function (row) {
    if (!state[row[2]].size) return;
    var target = (session.risu[row[0]] = session.risu[row[0]] || {});
    state[row[2]].forEach(function (key) {
      Object.defineProperty(target, key, {
        value: state[row[1]][key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });
    state[row[2]].clear();
  });
  return saveData('sessions');
}
// Card options (`toggle_*`) belong to a conversation, not to the app, so a new conversation would
// otherwise start with every option unset and a card whose whole opening lives inside
// `{{#when::keep::…}}` would open blank. Opening a new conversation from this one carries the
// option values over; no other conversation variable travels, because script state and counters
// describe a story that is not being continued.
function risuInheritedCardOptions(session) {
  var saved = (session && session.risu && session.risu.globalVariables) || {},
    values = null;
  Object.keys(saved).forEach(function (key) {
    if (key.indexOf('toggle_') !== 0) return;
    values = values || {};
    values[key] = String(saved[key] == null ? '' : saved[key]);
  });
  return values;
}
function risuApplyInheritedCardOptions(session, values) {
  if (!session || !values) return false;
  session.risu = session.risu || {};
  session.risu.globalVariables = Object.assign({}, session.risu.globalVariables || {}, values);
  return true;
}
// The only character fields CBS reads. The Worker snapshot carries these instead of the stored
// card, whose module, raw card copy and media rows are large and never read there.
var RISU_CBS_CHARACTER_FIELDS = [
  'name',
  'nickname',
  'description',
  'desc',
  'personality',
  'scenario',
  'first_mes',
  'firstMessage',
  'alternate_greetings',
  'alternateGreetings',
  'mes_example',
  'exampleMessage',
  'exampleDialogue',
];
function risuCBSCharacter(char) {
  var result = {};
  RISU_CBS_CHARACTER_FIELDS.forEach(function (key) {
    if (char && char[key] !== undefined) result[key] = char[key];
  });
  return result;
}
// Where one text sits in the conversation, as CBS sees it: role, message index and whether it is
// an opening. Opening messages are outside the official message list, so their index is -1.
function risuCBSPosition(char, session, options) {
  var message = options.message,
    chatIndex = options.chatIndex;
  if (message && message.opening) chatIndex = -1;
  else if (!Number.isInteger(chatIndex) && message) {
    var official = ((session && session.msgs) || []).filter(function (row) {
      return !row.opening;
    });
    chatIndex = official.indexOf(message);
    if (chatIndex < 0 && Number(message.seq) > 0)
      chatIndex = official.findIndex(function (row) {
        return row.seq === message.seq;
      });
  }
  return {
    role: options.role === 'assistant' ? 'char' : options.role,
    chatIndex: chatIndex,
    firstMessage: !!(message && message.opening),
    firstMessageIndex: openingAlternateGreetingIndex(char, message),
  };
}
function createRisuCBSContext(char, session, options) {
  options = options || {};
  var state =
      options.state && options.state.ecosystem === 'risu'
        ? options.state
        : createRisuMacroState(char, session, { commit: false, random: options.random }),
    sessionMessages = (session && session.msgs) || [],
    officialSessionMessages = sessionMessages.filter(function (message) {
      return !message.opening;
    }),
    officialStateMessages = (state.messages || []).filter(function (message) {
      return !message.opening;
    }),
    position = risuCBSPosition(char, session, options),
    defaults = risuDefaultVariables(char),
    runtimeSettings = D.settings,
    runtimeRoute = resolveApiRoute('chat'),
    runtimeModel = runtimeRoute.model,
    persona =
      options.personaOverride ||
      state.personaOverride ||
      getActivePersona(char.id) ||
      {},
    own = Object.prototype.hasOwnProperty,
    context = {
      character: risuCBSCharacter(char),
      characterId: char.id,
      chatId: session && session.id,
      // Official firstMessage is outside chat.message. Use the actual session,
      // not a trimmed Prompt history or the displayed message's index.
      messageCount: officialSessionMessages.length,
      characterName: characterPromptName(char),
      userName: options.userName || persona.name || '用户',
      persona: persona.desc || '',
      assets: (char.media_assets || []).filter(function (asset) {
        return asset.assetType === 'x-risu-asset';
      }),
      emotions: (char.media_assets || []).filter(function (asset) {
        return asset.assetType === 'emotion';
      }),
      messages: officialStateMessages.map(function (message) {
        return {
          role: message.role === 'assistant' ? 'char' : message.role,
          data: String(message.content === undefined ? message.data || '' : message.content),
          time: message.created || message.time,
        };
      }),
      role: position.role,
      chatIndex: position.chatIndex,
      firstMessage: position.firstMessage,
      firstMessageIndex: position.firstMessageIndex,
      mode: options.mode,
      triggerId: options.triggerId === undefined ? state.triggerId : options.triggerId,
      model: runtimeModel,
      jailbreakEnabled: false,
      metadata: {
        // modellist.ts getModelInfo fallback: OpenAICompatible / AsIs / Unknown.
        modelformat: '0',
        modelprovider: '4',
        modeltokenizer: '0',
        mobile:
          typeof navigator === 'object' && /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent) ? '1' : '0',
        // Risu's local/node keys specifically mean Tauri and its Node server.
        local: '0',
        node: '0',
        risutype: 'web',
      },
      maxContext: Number(runtimeSettings.maxContextTokens) || 0,
      risuCompatibilityVersion: '2026.10.211',
      screenWidth: typeof window === 'object' ? window.innerWidth : undefined,
      screenHeight: typeof window === 'object' ? window.innerHeight : undefined,
      language: 'zh-CN',
      browserLanguage: typeof navigator === 'object' ? navigator.language : undefined,
      authorNote: String((session && session.risu && session.risu.authorNote) || runtimeSettings.authorsNote || ''),
      random: state.random,
      runVar: options.runVar === true,
      rmVar: options.rmVar === true,
      historyEffectStart: options.historyEffectStart,
      trackHistory: options.trackHistory === true,
      strict: options.strict === true,
      getChatVar: function (key) {
        var value = state.vars['$' + key];
        return value == null ? (own.call(defaults, key) ? defaults[key] : 'null') : String(value);
      },
      setChatVar: function (key, value) {
        state.vars['$' + key] = String(value);
        state.changedVars.add('$' + key);
      },
      getGlobalVar: function (key) {
        return own.call(state.globalVars, key) ? String(state.globalVars[key]) : 'null';
      },
      setGlobalVar: function (key, value) {
        state.globalVars[key] = String(value);
        state.changedGlobals.add(key);
      },
      onError: function (error) {
        if (
          options.effect &&
          /^(?:command|v2Command)$/.test(options.effect.type) &&
          error.code === 'UNKNOWN_MACRO' &&
          /^\{\{(?:pipe|slot)\}\}$/.test(error.macro)
        )
          return;
        state.diagnostics.push(error);
      },
    };
  if (runtimeModel !== undefined) {
    context.metadata.modelshortname = String(runtimeModel);
    context.metadata.modelname = String(runtimeModel);
    context.metadata.modelinternalid = String(runtimeModel);
  }
  try {
    // Only these exact official routes have an unambiguous frozen Risu entry.
    var modelUrl = new URL(String(runtimeRoute.apiUrl || '')),
      deepseekTokenizers = {
        'deepseek-chat': '13',
        'deepseek-reasoner': '13',
        'deepseek-v4-pro': '14',
        'deepseek-v4-flash': '14',
      },
      deepseekTokenizer = own.call(deepseekTokenizers, runtimeModel) ? deepseekTokenizers[runtimeModel] : '';
    if (modelUrl.origin === 'https://api.deepseek.com' && deepseekTokenizer) {
      context.metadata.modelprovider = '12';
      context.metadata.modeltokenizer = deepseekTokenizer;
    }
  } catch (_) {}
  var assetContext =
    state.assetContext ||
    risuCachedDisplayAssetContext(char);
  if (assetContext) Object.assign(context, assetContext);
  var card = risuCardSources(char).card;
  context.characterDisplayAssets = card.prebuiltAssetCommand
    ? (context.assets || []).filter(function (asset) {
        return !(card.prebuiltAssetExclude || []).some(function (excluded) {
          return Array.isArray(asset)
            ? asset[1] === excluded
            : [asset.reference, asset.mediaKey, asset.originalUri].includes(excluded);
        });
      })
    : [];
  context.modules = [];
  // Most display text never reads lore. Resolve on demand from current data, without a stale cache.
  context.getLorebooks = function () {
    return risuLorebookInitialGlobal(char).entries.concat((session && session.risu && session.risu.localLore) || []);
  };
  if (options.lazyLoreSnapshot) {
    context.loreSource = {
      entries: risuLorebookStoredGlobal(char) || risuLorebookModuleSource(char),
      book: char.character_book || null,
      local: (session && session.risu && session.risu.localLore) || [],
    };
  } else if (context.getLorebooks) context.lorebooks = context.getLorebooks();
  return context;
}

async function risuVisibleSpans(text, char, session, options, earlier) {
  if (!text || !YeyuRisuCBS.hasMacros(text)) return null;
  return (await risuComputeInWorker('visible-spans', { text: text, earlier: earlier }, char, session, options)).spans;
}
// Card display regexes whose replacement drops the whole match: what they matched is a control
// string the reader never sees, so translation must carry it through untouched. A replacement that
// quotes the match or a capture keeps real text on screen and stays translatable.
function risuHiddenTriggerPatterns(char) {
  var patterns = [];
  if (!char || !isRisuCharacter(char)) return patterns;
  risuCardSources(char).regex.forEach(function (script) {
    if (!script || script.type !== 'editdisplay') return;
    var input = String(script.in == null ? '' : script.in),
      output = String(script.out == null ? '' : script.out);
    if (!input) return;
    if (output.indexOf('@@') === 0) return;
    if (script.ableFlag && String(script.flag || '').indexOf('<') !== -1) return;
    if (/(?<!\$)\$(?:[0-9]+|&|<[^>]+>)/.test(output) || output.indexOf('{{data}}') !== -1) return;
    // Built with the display pass's own flags, so exactly the hits it rewrites are protected: a
    // script without `g` hides only its first hit, and a pattern that needs `u` still compiles.
    // Scripts carrying `<…>` meta flags are already skipped above, so no actions apply here.
    var flags = YeyuRisuRegex.normalizeFlags(script, output, []);
    try {
      patterns.push(new RegExp(input, flags));
    } catch (_) {
      // A pattern the display pass cannot compile never runs there either, so its match is text the
      // reader actually sees and must stay translatable.
    }
  });
  return patterns;
}
