var _hostFacadeMetadata = new WeakMap();
function hostFacadeMetadata(session) {
  var metadata = session.tavernHelperMetadata || (session.tavernHelperMetadata = {});
  if (_hostFacadeMetadata.has(metadata)) return _hostFacadeMetadata.get(metadata);
  var proxy = new Proxy(metadata, {
    get: function (target, key) {
      return key === 'variables' ? session.stscriptVars || (session.stscriptVars = {}) : target[key];
    },
    set: function (target, key, value) {
      if (key === 'variables') session.stscriptVars = value;
      else target[key] = value;
      return true;
    },
    deleteProperty: function (target, key) {
      if (key === 'variables') delete session.stscriptVars;
      else delete target[key];
      return true;
    },
    ownKeys: function (target) {
      return Array.from(new Set(Reflect.ownKeys(target).concat('variables')));
    },
    getOwnPropertyDescriptor: function (target, key) {
      return key === 'variables'
        ? { enumerable: true, configurable: true }
        : Object.getOwnPropertyDescriptor(target, key);
    },
  });
  _hostFacadeMetadata.set(metadata, proxy);
  return proxy;
}
function hostFacadeUpdateMetadata(live, value, reset) {
  var session = cardFrontendRequireCurrent(live).session,
    next = cloneData(value || {});
  if (hostWriteOwn(next, 'variables')) {
    session.stscriptVars = next.variables;
    delete next.variables;
  } else if (reset) delete session.stscriptVars;
  session.tavernHelperMetadata = reset ? next : Object.assign({}, session.tavernHelperMetadata || {}, next);
}
function hostFacadeVariable(live, args) {
  var option = { type: args.type },
    vars = hostWriteGetVariables(live, option),
    key = args.key,
    value = args.value,
    result;
  if (args.op === 'get') return stscriptGetStore(vars, key, args.option);
  if (args.op === 'has') return hostWriteOwn(vars, key);
  if (args.op === 'del') {
    delete vars[key];
    result = '';
  } else if (args.op === 'set') result = stscriptSetStore(vars, key, value, args.option);
  else {
    var old = stscriptGetStore(vars, key) || 0,
      parsed;
    try {
      parsed = JSON.parse(old);
    } catch (_) {}
    if (Array.isArray(parsed)) {
      parsed.push(value);
      result = parsed;
      vars[key] = JSON.stringify(parsed);
    } else {
      result = isNaN(Number(old)) || isNaN(Number(value)) ? String(old || '') + value : Number(old) + Number(value);
      stscriptSetStore(vars, key, result);
    }
  }
  hostWriteReplaceVariables(live, vars, option);
  return result;
}
function hostFacadeExtensionPrompts(live) {
  function entries() {
    var context = cardFrontendRequireCurrent(live);
    return hostPromptEntries(context.char, context.session);
  }
  function value(id) {
    var entry = entries().find(function (entry) {
      return entry.row.id === id;
    });
    if (!entry) return undefined;
    var row = entry.row;
    return {
      value: row.content,
      position: { none: -1, in_prompt: 0, in_chat: 1, before_prompt: 2 }[row.position],
      depth: row.depth,
      role: { system: 0, user: 1, assistant: 2 }[row.role],
      scan: row.should_scan,
      filter: (entry.record && entry.record.filter) || null,
    };
  }
  return new Proxy(
    {},
    {
      get: function (_, id) {
        return value(id);
      },
      ownKeys: function () {
        return entries().map(function (entry) {
          return entry.row.id;
        });
      },
      has: function (_, id) {
        return value(id) !== undefined;
      },
      getOwnPropertyDescriptor: function (_, id) {
        var prompt = value(id);
        return prompt ? { enumerable: true, configurable: true, writable: true, value: prompt } : undefined;
      },
      set: function (_, id, prompt) {
        if (!objectRecord(prompt)) throw new Error('扩展提示词必须是对象');
        hostFacadeSetPrompt(live, [
          id,
          prompt.value,
          prompt.position,
          prompt.depth,
          prompt.scan,
          prompt.role,
          prompt.filter,
        ]);
        return true;
      },
      deleteProperty: function (_, id) {
        hostPromptUninject(live, [id]);
        return true;
      },
    }
  );
}
function hostFacadeValue(live, key) {
  var context = cardFrontendRequireCurrent(live),
    persona = getActivePersona(context.char.id);
  if (key === 'characters') return D.characters.map(hostEntityRawCharacter);
  if (key === 'characterId') return D.characters.indexOf(context.char);
  if (key === 'name1') return persona?.name || 'User';
  if (key === 'name2') return canonicalCharacterName(context.char);
  if (key === 'chatId') return context.session.id;
  if (key === 'chatMetadata') return hostFacadeMetadata(context.session);
  if (key === 'chatCompletionSettings') return activeCompletionPresetRaw();
  if (key === 'maxContext') return Number(presetRequestSettings('chat').maxContextTokens) || 0;
  if (key === 'extensionPrompts') return hostFacadeExtensionPrompts(live);
  if (key === 'worldNames') return hostWriteWorldbookNames();
  if (key === 'swipeAllowed')
    return (
      _generationState === 'idle' && !!context.session.msgs.at(-1) && context.session.msgs.at(-1).role === 'assistant'
    );
  if (key === 'model') return resolveApiRoute('chat').model;
  if (key === 'presetList')
    return {
      presets: presetRows().map(function (row) {
        return cloneData(row.preset);
      }),
      preset_names: Object.fromEntries(
        presetRows().map(function (row, index) {
          return [row.name, index];
        })
      ),
      settings: activeCompletionPresetRaw(),
    };
  if (key === 'powerUserSettings') {
    var fields = {
      persona_description: 'desc',
      persona_description_position: 'position',
      persona_description_depth: 'depth',
      persona_description_role: 'role',
      persona_description_lorebook: 'lorebook',
    };
    return new Proxy(
      {},
      {
        get: function (_, name) {
          return persona && persona[fields[name]];
        },
        set: function (_, name, value) {
          if (!persona || !fields[name]) throw new Error('当前人格没有此设置：' + String(name));
          persona[fields[name]] = value;
          return true;
        },
        ownKeys: function () {
          return Object.keys(fields);
        },
        getOwnPropertyDescriptor: function () {
          return { enumerable: true, configurable: true };
        },
      }
    );
  }
  throw new Error('未知上下文字段：' + key);
}
function hostFacadeSetPrompt(live, args) {
  hostPromptSetFacade(live, {
    id: args[0],
    content: args[1],
    position: { '-1': 'none', 0: 'in_prompt', 1: 'in_chat', 2: 'before_prompt' }[args[2]] || args[2],
    depth: args[3],
    should_scan: args[4],
    role: ['system', 'user', 'assistant'][args[5] || 0],
    filter: args[6],
  });
}
async function hostFacadeAction(live, name, args) {
  var context = cardFrontendRequireCurrent(live),
    session = context.session;
  // Facade calls are the card front end acting, never the user interface, so they pass the
  // post-commit guard: it exists to keep the user from interleaving with the background run.
  if (name === 'deleteMessage') {
    if (args[1] != null)
      return deleteMessageSwipeCandidate(args[1], { messageIndex: Number(args[0]), hostFacade: true });
    return hostWriteDeleteChatMessages(live, { messageIds: [Number(args[0])], option: { refresh: 'all' } });
  }
  if (name === 'swipe') {
    var option = args[1] || {},
      index = option.forceMesId == null ? session.msgs.length - 1 : Number(option.forceMesId);
    return switchMessageSwipe(index, args[0] === 'left' ? -1 : 1, {
      targetIndex: option.forceSwipeId,
      hostFacade: true,
    });
  }
  if (name === 'writeExtensionField') {
    let char = D.characters[Number(args[0])];
    if (!char) return;
    var extension = cloneData(char.extensions || {});
    self.YeyuMvuVendor._.set(extension, args[1], cloneData(args[2]));
    return hostEntityWriteCharacter(live, char.id, { extensions: extension }, 'replace', { render: 'immediate' });
  }
  if (name === 'generate') {
    if (args[0] === 'regenerate') return regenerateLast();
    if (args[0] === 'continue') return continueGeneration();
    if (args[0] === 'swipe') return generateMessageSwipe(session.msgs.length - 1);
    if (args[0] === 'impersonate') return impersonateUser();
    if (args[0] == null || args[0] === 'normal') return sendMessage();
    throw new Error('生成类型无效：' + args[0]);
  }
  if (name === 'scrollChatToBottom') {
    scrollChatToBottomAfterRender();
    return;
  }
  if (name === 'reloadWorldInfoEditor' || name === 'updateWorldInfoList') {
    renderWBAll();
    return;
  }
  if (name === 'saveMetadata') {
    await saveData('sessions');
    return;
  }
  if (name === 'saveContextSettings') {
    invalidateCacheContexts();
    await saveData(['meta', 'personas']);
    return;
  }
  if (name === 'selectCharacterById') {
    let char = D.characters[Number(args[0])];
    if (!char) throw new Error('角色索引不存在');
    await selectCharacter(char.id);
    return;
  }
  if (name === 'openCharacterChat') {
    var next = getSessions(context.char.id).sessions.find(function (row) {
      return row.id === args[0] || row.name === args[0];
    });
    if (!next) throw new Error('聊天不存在：' + args[0]);
    await switchSession(next.id);
    return;
  }
  if (name === 'renameChat') {
    var chat = getSessions(context.char.id).sessions.find(function (row) {
      return row.id === args[0] || row.name === args[0];
    });
    if (!chat || !String(args[1] || '').trim()) throw new Error('聊天或新名称无效');
    var beforeName = chat.name;
    chat.name = String(args[1]);
    try {
      await saveData('sessions');
    } catch (error) {
      chat.name = beforeName;
      throw error;
    }
    renderSessions();
    return;
  }
  if (name === 'printMessages' || name === 'reloadCurrentChat') {
    await prepareRegexScriptDisplayTexts(context.char, session.msgs);
    cardFrontendRequireCurrent(live);
    renderChat();
    return;
  }
  throw new Error('未知上下文操作：' + name);
}
