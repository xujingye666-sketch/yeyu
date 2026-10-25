// Risu lorebooks are resolved from preserved card/module data and never enter the ST worldbook runtime.

var RISU_PREBUILT_ASSET_COMMAND = [
  '<Image Tag Instruction>Insert HTML image tags between paragraphs based on context.',
  'Set src as keywords from the list below that matches current character, outfit, situation sentiment and etc.',
  'print as many different images as possible. Use only available keywords.',
  'if there are no matching keywords, try to put clostest matching image src.',
  'try to put at least 1 image per output.',
  '<keywords>{{join::{{chardisplayasset}}::,}}</keywords>',
  'Example: <img src="{{ele::{{chardisplayasset}}::0}}">',
  '<Image Tag Instruction>',
].join('\n');

function risuUtilityPromptSettings(char) {
  var card = risuCardSources(char).card;
  return {
    utilityBot: card.utilityBot === true,
    prebuiltAssetCommand: card.prebuiltAssetCommand === true ? RISU_PREBUILT_ASSET_COMMAND : '',
  };
}

function risuLorebookModuleSource(char) {
  var sources = risuCardSources(char);
  return sources.module && Array.isArray(sources.module.lorebook) ? sources.module.lorebook : null;
}

function risuLorebookCardSource(char) {
  return YeyuRisuLorebook.normalizeCharacterBook((char && char.character_book) || null);
}

function risuLorebookStoredGlobal(char) {
  var yeyu = char && char.extensions && char.extensions.yeyu;
  return yeyu && Array.isArray(yeyu.risuLorebookState) ? yeyu.risuLorebookState : null;
}

function risuLorebookInitialGlobal(char) {
  var stored = risuLorebookStoredGlobal(char),
    moduleLore = risuLorebookModuleSource(char),
    card = risuLorebookCardSource(char);
  return {
    entries: (stored || moduleLore || card.entries || []).map(YeyuRisuLorebook.normalizeEntry),
    settings: card.settings || null,
    source: stored ? 'overlay' : moduleLore ? 'module.risum' : 'character_book',
  };
}

function risuLorebookDefaultSettings(char) {
  var initial = risuLorebookInitialGlobal(char),
    // 卡内写了预算就按卡内取值；卡内没写时默认不限（0）。
    fallback = { scanDepth: 5, tokenBudget: 0, recursiveScanning: true, fullWordMatching: false };
  return YeyuRisuLorebook.normalizeSettings(initial.settings || fallback);
}

function risuLorebookCreateTransaction(char, session) {
  var initial = risuLorebookInitialGlobal(char),
    globalLore = cloneJsonValue(initial.entries),
    localLore = cloneJsonValue((session && session.risu && session.risu.localLore) || []),
    globalChanged = false,
    localChanged = false;

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) throw new TypeError('Risu 世界书必须是数组');
    return rows.map(YeyuRisuLorebook.normalizeEntry);
  }

  function resolutionLorebooks() {
    // loadLoreBookV3Prompt resolves character lore before chat-local lore.
    return globalLore.concat(localLore);
  }

  function luaSearchLorebooks() {
    // Lua getLoreBooksMain searches chat.localLore before character globalLore.
    return localLore.concat(globalLore);
  }

  async function resolve(resolveOptions) {
    resolveOptions = resolveOptions || {};
    var macroState = resolveOptions.macroState,
      sourceMessages = Array.isArray(resolveOptions.messages)
        ? resolveOptions.messages
        : risuOfficialMessages(session),
      opening = ((session && session.msgs) || []).find(function (message) {
        return message && message.opening;
      }),
      settings = Object.assign({}, risuLorebookDefaultSettings(char), resolveOptions.settings || {});
    var lore = {
        entries: resolutionLorebooks(),
        messages: sourceMessages,
        characterName: char.name,
        userName: getActivePersona(char.id)?.name || '用户',
        characterNames: Object.fromEntries(
          D.characters.map(function (row) {
            return [row.id, row.name];
          })
        ),
        settings: settings,
        chatVariables: Object.assign(
          {},
          (macroState && macroState.vars) || (session.risu && session.risu.scriptstate) || {}
        ),
        renderActives: resolveOptions.renderActives === true,
        chatLength: sourceMessages.length + 1,
        // Official @@is_greeting compares fmIndex + 1: the card slot (first_mes is 0, no opening too),
        // the same alternate_greetings position CBS and triggers read.
        greetingIndex: openingAlternateGreetingIndex(char, opening) + 1,
      },
      view = Object.assign({}, session, {
        msgs: (opening ? [opening] : []).concat(
          sourceMessages.map(function (row) {
            return Object.assign({}, row, {
              role: row.role === 'char' ? 'assistant' : row.role,
              content: row.data === undefined ? row.content : row.data,
            });
          })
        ),
      });
    var state = Object.assign({}, macroState || createRisuMacroState(char, session), { messages: view.msgs });
    return (
      await risuComputeInWorker('lore', lore, char, session, {
        state: state,
        contextSession: view,
        signal: resolveOptions.signal,
        runVar: false,
      })
    ).lore;
  }

  return {
    source: initial.source,
    getGlobalLorebooks: function () {
      return cloneJsonValue(globalLore);
    },
    setGlobalLorebooks: function (rows) {
      globalLore = normalizeRows(rows);
      globalChanged = true;
    },
    getLocalLorebooks: function () {
      return cloneJsonValue(localLore);
    },
    setLocalLorebooks: function (rows) {
      localLore = normalizeRows(rows);
      localChanged = true;
    },
    getLorebooksByName: function (name, render) {
      return luaSearchLorebooks()
        .filter(function (entry) {
          return entry.comment === String(name);
        })
        .map(function (entry) {
          var row = cloneJsonValue(entry);
          if (typeof render === 'function') row.content = render(row.content);
          return row;
        });
    },
    upsertLocalLorebook: function (name, content, upsertOptions) {
      upsertOptions = upsertOptions || {};
      localLore = localLore.filter(function (entry) {
        return entry.comment !== String(name);
      });
      localLore.push(
        YeyuRisuLorebook.normalizeEntry({
          alwaysActive: upsertOptions.alwaysActive === true,
          comment: String(name),
          content: String(content),
          insertorder: Number(upsertOptions.insertOrder) || 100,
          mode: 'normal',
          key: String(upsertOptions.key || ''),
          secondkey: String(upsertOptions.secondKey || ''),
          selective: Boolean(upsertOptions.secondKey),
          useRegex: upsertOptions.regex === true,
        })
      );
      localChanged = true;
    },
    resolve: resolve,
    test: async function (resolveOptions) {
      return cloneJsonValue(await resolve(resolveOptions));
    },
    loadActive: async function (reserve, maxContext, resolveOptions) {
      var remaining = Number(maxContext) - Math.max(0, Number(reserve) || 0);
      if (remaining < 0) return [];
      var resolved = await resolve(Object.assign({}, resolveOptions, { renderActives: true })),
        used = 0,
        rows = [];
      for (var index = 0; index < resolved.actives.length; index++) {
        var active = resolved.actives[index],
          parsed = String(active.renderedPrompt).trim();
        if (!parsed) continue;
        var tokens = estTokens(parsed);
        if (used + tokens > remaining) break;
        used += tokens;
        rows.push({ data: parsed, role: active.role === 'assistant' ? 'char' : active.role });
      }
      return rows;
    },
    snapshot: function () {
      return {
        globalChanged: globalChanged,
        localChanged: localChanged,
        globalLore: cloneJsonValue(globalLore),
        localLore: cloneJsonValue(localLore),
        source: initial.source,
      };
    },
    applyToCopies: function (characterCopy, sessionCopy) {
      var snapshot = this.snapshot();
      if (snapshot.globalChanged) {
        characterCopy.extensions = characterCopy.extensions || {};
        characterCopy.extensions.yeyu = characterCopy.extensions.yeyu || {};
        characterCopy.extensions.yeyu.risuLorebookState = snapshot.globalLore;
      }
      if (snapshot.localChanged) {
        sessionCopy.risu = sessionCopy.risu || {};
        sessionCopy.risu.localLore = snapshot.localLore;
      }
      return snapshot;
    },
  };
}

function risuLorebookPromptShape(resolved, messageCount, render) {
  var beforeCharItems = [],
    afterCharItems = [],
    postEverythingItems = [],
    inChat = new Map(),
    count = 0;
  function content(active) {
    return YeyuRisuLorebook.applyPosition(
      typeof render === 'function'
        ? render(active.prompt)
        : String(active.renderedPrompt === undefined ? active.prompt || '' : active.renderedPrompt),
      resolved
    );
  }
  (resolved.actives || []).forEach(function (active, sequence) {
    if ((active.inject && !active.inject.lore) || String(active.pos || '').startsWith('pt_')) return;
    var value = content(active);
    if (!value.trim()) return;
    var item = {
      content: value,
      entryId: 'risu:' + active.index,
      entryKey: 'risu:' + active.index,
      order: Number(active.order) || 0,
      sequence: sequence,
      stable: false,
      role: active.role || 'system',
    };
    if (['before_desc', 'after_desc', 'personality', 'scenario'].includes(active.pos)) {
      item.characterPosition = active.pos;
      beforeCharItems.push(item);
    } else if (active.pos === 'depth' && active.depth === 0) {
      postEverythingItems.push(item);
    } else if (active.pos === 'depth' || active.pos === 'reverse_depth') {
      var depth = active.pos === 'reverse_depth' ? active.depth : Math.max(0, messageCount - active.depth);
      if (!inChat.has(depth)) inChat.set(depth, []);
      inChat.get(depth).push(item);
    } else afterCharItems.push(item);
    count++;
  });
  // Fixed Risu postEverything keeps user/system activation order, then assistant prefill entries.
  postEverythingItems = postEverythingItems
    .filter(function (item) {
      return item.role !== 'assistant';
    })
    .concat(
      postEverythingItems.filter(function (item) {
        return item.role === 'assistant';
      })
    );
  return {
    isRisu: true,
    beforeChar: '',
    afterChar: '',
    stableBeforeChar: '',
    stableAfterChar: '',
    beforeCharItems: beforeCharItems,
    afterCharItems: afterCharItems,
    inChat: inChat,
    beforeUser: '',
    beforeUserItems: [],
    anTopItems: [],
    anBottomItems: [],
    emTopItems: [],
    emBottomItems: [],
    outletItems: [],
    risuPostEverythingItems: postEverythingItems,
    disabledUiPrompts: resolved.disabledUiPrompts || [],
    count: count,
    matchedCount: (resolved.activatedIndexes || []).length,
    activatedCount: (resolved.actives || []).length,
    droppedCount: Math.max(0, (resolved.activatedIndexes || []).length - (resolved.actives || []).length),
    injectedTokens: Number(resolved.usedTokens) || 0,
    details: (resolved.actives || []).map(function (active) {
      return { id: 'risu:' + active.index, runtimeKey: 'risu:' + active.index, name: active.source, status: 'active' };
    }),
    risuResolved: resolved,
  };
}

async function risuResolveWorldBookForPrompt(char, session, messages, options) {
  options = options || {};
  var transaction = risuLorebookCreateTransaction(char, session),
    officialMessages = (messages || [])
      .filter(function (message) {
        return !message.opening;
      })
      .map(function (message) {
        return {
          role: message && message.role,
          name: message && message.name,
          saying: message && message.saying,
          data: risuMessageTemplate(message),
        };
      }),
    resolved = await transaction.resolve({
      messages: officialMessages,
      macroState: options.macroState,
      signal: options.signal,
      renderActives: true,
    }),
    shape = risuLorebookPromptShape(resolved, officialMessages.length),
    imageGeneration = risuInlayImageGeneration(char);
  // 固定 Risu index.svelte.ts：inlay 视图屏的出图指令以 system 原样（不跑 CBS）先于 depth-0 世界书进入 postEverything；
  // 空指令与上游 pushPrompts 一样不发。
  if (imageGeneration && imageGeneration.instructions.trim())
    shape.risuPostEverythingItems.unshift({ role: 'system', content: imageGeneration.instructions, literal: true });
  return shape;
}

window.risuLorebookCreateTransaction = risuLorebookCreateTransaction;
window.risuResolveWorldBookForPrompt = risuResolveWorldBookForPrompt;
window.risuUtilityPromptSettings = risuUtilityPromptSettings;
