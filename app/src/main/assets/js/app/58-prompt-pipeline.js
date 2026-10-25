// ===== Prompt history normalization =====
function promptBridgeExcludedMessage(message) {
  return !!(
    message &&
    ((typeof isBranchReturnRevertMessage === 'function' && isBranchReturnRevertMessage(message)) ||
      message.kind === 'branch-return-revert')
  );
}
function rollingHistorySummaryMessage(summary) {
  return {
    role: 'system',
    content: '[较早对话摘要]\n' + summary.text,
    historySummary: true,
    sourceStartSeq: Number(summary.sourceStartSeq) || 0,
    sourceEndSeq: Number(summary.sourceEndSeq) || 0,
  };
}
function buildRollingConversationMessages(sess, completeMsgs) {
  var store = sess && sess.memoryStore,
    raw = (completeMsgs || []).filter(function (message) {
      if (message && message.hidden === true) return false;
      if (message && message.role === 'system' && message.kind === 'stscript-system') return true;
      return typeof memoryV5IsOrdinaryMessage === 'function'
        ? memoryV5IsOrdinaryMessage(message)
        : typeof promptBridgeExcludedMessage === 'function'
          ? !promptBridgeExcludedMessage(message)
          : !!(message && (message.role === 'user' || message.role === 'assistant'));
    }),
    summary =
      D.settings.useMemory !== false && store && store.historySummary && store.historySummary.active !== false
        ? store.historySummary
        : null,
    rows = raw.slice();
  if (summary) {
    rows = [];
    var inserted = false,
      end = Number(summary.sourceEndSeq) || 0;
    raw.forEach(function (message) {
      var narrator = message && message.role === 'system' && message.kind === 'stscript-system',
        covered =
          !narrator &&
          (typeof memoryV5MessageCoveredByHistory === 'function'
            ? memoryV5MessageCoveredByHistory(sess, message, end)
            : Number(message.seq) <= end);
      if (covered) {
        if (!inserted) {
          rows.push(rollingHistorySummaryMessage(summary));
          inserted = true;
        }
        return;
      }
      rows.push(message);
    });
    if (!inserted) rows.unshift(rollingHistorySummaryMessage(summary));
  }
  return { raw: raw, conversation: rows };
}

// ===== Auditable prompt pipeline =====
function promptHistoryMessageName(message, userName, charName) {
  if (message && message.role === 'user') return userName;
  if (message && message.role === 'assistant') return charName;
  if (message && message.role === 'system' && message.kind === 'stscript-system')
    return String(message.speaker || '系统');
  return '';
}
function buildMessages(char, allMsgs, sessionOverride, buildOptions) {
  var stages = buildMessageStages(char, allMsgs, sessionOverride, buildOptions);
  function resume(value, failed) {
    var step = stages[failed ? 'throw' : 'next'](value);
    while (!step.done) {
      if (step.value && typeof step.value.then === 'function')
        return step.value.then(
          function (result) {
            return resume(result, false);
          },
          function (error) {
            return resume(error, true);
          }
        );
      step = stages.next(step.value);
    }
    return step.value;
  }
  return resume();
}
// ST host APIs retain their synchronous contract; Risu computation suspends only at Worker calls.
function* buildMessageStages(char, allMsgs, sessionOverride, buildOptions) {
  buildOptions = buildOptions || {};
  // The Prompt Manager previews its unsaved draft by passing the whole settings candidate that saving would store.
  var promptSettings =
    buildOptions.promptSettings && typeof buildOptions.promptSettings === 'object'
      ? buildOptions.promptSettings
      : D.settings;
  var generationOverrides =
      buildOptions.generationOverrides && typeof buildOptions.generationOverrides === 'object'
        ? buildOptions.generationOverrides
        : {},
    completionPresetOverride = Object.prototype.hasOwnProperty.call(buildOptions, 'completionPresetRaw')
      ? buildOptions.completionPresetRaw
      : undefined;
  var generationSettings =
    typeof presetRequestSettings === 'function'
      ? Object.prototype.hasOwnProperty.call(buildOptions, 'completionPresetRaw')
        ? presetRequestSettings('chat', completionPresetOverride)
        : presetRequestSettings('chat')
      : promptSettings;
  var completionPresetForBuild =
      (Object.prototype.hasOwnProperty.call(buildOptions, 'completionPresetRaw')
        ? completionPresetOverride
        : typeof activeCompletionPresetRaw === 'function'
          ? activeCompletionPresetRaw()
          : null) || (typeof presetRawDefault === 'function' ? presetRawDefault() : null),
    // The text of a preset prompt only when the preset sends it: enabled in its global (100001) order.
    presetSentPromptContent = function (identifier) {
      var raw = completionPresetForBuild,
        orderRow =
          raw && Array.isArray(raw.prompt_order)
            ? raw.prompt_order.find(function (row) {
                return Number(row && row.character_id) === 100001;
              })
            : null,
        enabled =
          !!orderRow &&
          Array.isArray(orderRow.order) &&
          orderRow.order.some(function (item) {
            return item && String(item.identifier || '') === identifier && item.enabled !== false;
          }),
        prompt =
          enabled && Array.isArray(raw.prompts)
            ? raw.prompts.find(function (item) {
                return String((item && item.identifier) || '') === identifier;
              })
            : null;
      return String((prompt && prompt.content) || '');
    };
  // 代拟只为用户起草发言：剧情方向与文风审计都是对角色回复的要求，不注入也不消耗。
  const impersonating = !!(buildOptions.generationTarget && buildOptions.generationTarget.mode === 'impersonate'),
    sessForBuild = sessionOverride || getActiveSession(char.id),
    completeMsgs = allMsgs || [],
    continuationTarget =
      buildOptions.generationTarget && buildOptions.generationTarget.mode === 'continue'
        ? buildOptions.generationTarget
        : null,
    continuationHistoryMessage =
      continuationTarget &&
      completeMsgs[continuationTarget.messageIndex] &&
      completeMsgs[continuationTarget.messageIndex].role === 'assistant'
        ? completeMsgs[continuationTarget.messageIndex]
        : null,
    rolling =
      typeof buildRollingConversationMessages === 'function'
        ? buildRollingConversationMessages(sessForBuild, completeMsgs)
        : (function () {
            var raw = completeMsgs.filter(function (message) {
              return message && message.role !== 'system';
            });
            return { raw: raw, conversation: raw };
          })(),
    rawConversationMsgs = rolling.raw,
    conversationMsgs = rolling.conversation;
  var activeHistorySummary = conversationMsgs.find(function (message) {
      return message && message.historySummary === true;
    }),
    summaryCoverageEnd = Math.max(0, Number(activeHistorySummary && activeHistorySummary.sourceEndSeq) || 0),
    summarizedMessageCount = summaryCoverageEnd
      ? rawConversationMsgs.filter(function (message) {
          return Number(message && message.seq) > 0 && Number(message.seq) <= summaryCoverageEnd;
        }).length
      : 0,
    storyDirectionMessage =
      !impersonating &&
      typeof StoryDirection === 'object' &&
      StoryDirection &&
      typeof StoryDirection.messageForBuild === 'function'
        ? StoryDirection.messageForBuild(sessForBuild, completeMsgs, buildOptions)
        : null;
  allMsgs = completeMsgs;
  const storedPersona = Object.prototype.hasOwnProperty.call(buildOptions, 'personaOverride')
      ? buildOptions.personaOverride
      : getActivePersona(char && char.id),
    persona = Object.prototype.hasOwnProperty.call(generationOverrides, 'persona_description')
      ? {
          name: String((storedPersona && storedPersona.name) || '用户'),
          desc: String(generationOverrides.persona_description || ''),
        }
      : storedPersona;
  const userName = persona?.name || '用户';
  const scriptInjects = Array.isArray(buildOptions.scriptInjects)
    ? buildOptions.scriptInjects.slice()
    : typeof hostPromptSnapshot === 'function'
      ? hostPromptSnapshot(char, sessForBuild)
      : [];
  if (!buildOptions.skipDataBank && typeof dataBankPromptSnapshot === 'function')
    scriptInjects.push.apply(
      scriptInjects,
      dataBankPromptSnapshot(buildOptions.dataBankCharacter || char, buildOptions.retrievalSession || sessForBuild, buildOptions.dataBankMessages || completeMsgs)
    );
  const personaPosition = Number(persona?.position || 0),
    personaDescription = String(persona?.desc || ''),
    personaPromptDescription = [0, 1].includes(personaPosition) ? personaDescription : '';
  const charName = canonicalCharacterName(char);
  const macroState =
    typeof isRisuCharacter === 'function' && isRisuCharacter(char)
      ? createRisuMacroState(char, sessForBuild, { commit: buildOptions.commit === true, random: buildOptions.random })
      : typeof bindCharacterMacroSession === 'function'
        ? bindCharacterMacroSession(
            typeof createCharacterMacroState === 'function'
              ? createCharacterMacroState(buildOptions.random)
              : { random: Math.random, picks: new Map(), vars: {} },
            sessForBuild,
            { commit: buildOptions.commit === true }
          )
        : typeof createCharacterMacroState === 'function'
          ? createCharacterMacroState(buildOptions.random)
          : { random: Math.random, picks: new Map(), vars: {} };
  macroState.personaOverride = persona;
  macroState.messages = completeMsgs;
  macroState.input = String(
    (
      rawConversationMsgs
        .slice()
        .reverse()
        .find(function (message) {
          return message && message.role === 'user';
        }) || {}
    ).content || ''
  );
  macroState.firstDisplayedMessageId = completeMsgs.length
    ? typeof getHistoryRenderStart === 'function'
      ? getHistoryRenderStart(sessForBuild, completeMsgs)
      : Math.max(0, completeMsgs.length - 200)
    : null;
  macroState.firstIncludedMessageId = completeMsgs.length ? 0 : null;
  macroState.generationType = buildOptions.generationTarget && buildOptions.generationTarget.mode;
  macroState.maxContextTokens = generationSettings.maxContextTokens;
  macroState.maxResponseTokens = generationSettings.maxTokens;
  try {
    macroState.model = (resolveApiRoute('chat', { settings: promptSettings }) || {}).model || '';
  } catch (_) {
    macroState.model = '';
  }
  const macroReplace =
    typeof replaceCharacterMacros === 'function'
      ? function (value) {
          return macroState.ecosystem === 'risu'
            ? risuRenderCBSInWorker(value, char, sessForBuild, {
                state: macroState,
                runVar: false,
                signal: buildOptions.signal,
              })
            : replaceCharacterMacros(value, char, userName, macroState);
        }
      : function (value) {
          return String(value || '');
        };
  // The speaker prefix joins the world book scan window only when the official
  // include-names setting is on; the message boundary itself comes from the scan buffer.
  const worldBookIncludeNames = worldBookSettings().includeNames;
  const recentMessages = rawConversationMsgs.map((m) => {
    var speaker =
      typeof promptHistoryMessageName === 'function'
        ? promptHistoryMessageName(m, userName, charName)
        : m && m.role === 'user'
          ? userName
          : m && m.role === 'assistant'
            ? charName
            : m && m.role === 'system' && m.kind === 'stscript-system'
              ? String(m.speaker || '系统')
              : '';
    return {
      text: (worldBookIncludeNames && speaker ? speaker + ': ' : '') + String(m.content || ''),
      role: m.role,
      seq: m.seq || 0,
      opening: m.opening === true,
      openingIndex: m.openingIndex,
    };
  });
  var scannedScriptPrompts = [];
  for (var injection of scriptInjects) {
    if (injection.should_scan) scannedScriptPrompts.push(yield macroReplace(injection.content));
  }
  const worldBookScanInjections = (
    Array.isArray(buildOptions.worldBookScanPrompts) ? buildOptions.worldBookScanPrompts : []
  )
    .concat(scannedScriptPrompts)
    .map(function (value) {
      return String(value || '');
    });
  const latestUserForBuild = rawConversationMsgs
    .slice()
    .reverse()
    .find(function (m) {
      return m && m.role === 'user';
    });
  function worldBookGroupKeys(item) {
    return trimmedUniqueStrings(Array.isArray(item && item.groupKeys) ? item.groupKeys : [item && item.groupKey]);
  }
  function worldBookItemRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(function (item, index) {
        var groupKeys = worldBookGroupKeys(item);
        return {
          content: String((item && item.content) || ''),
          entryId: String((item && item.entryId) || ''),
          entryKey: String((item && item.entryKey) || ''),
          groupKey: groupKeys[0] || '',
          groupKeys: groupKeys,
          groupOverride: item && item.groupOverride === true,
          order: Number(item && item.order) || 0,
          sequence: Number.isFinite(Number(item && item.sequence)) ? Number(item.sequence) : index,
          stable: item && item.stable === true,
          role: String((item && item.role) || 'system'),
          characterPosition: String((item && item.characterPosition) || ''),
          outletName: String((item && item.outletName) || ''),
          ignoreOnMaxContext: item && item.ignoreOnMaxContext === true,
        };
      })
      .filter(function (item) {
        return !!item.content;
      });
  }
  function worldBookPositionItems(items, dynamic, stable) {
    var normalized = worldBookItemRows(items);
    if (normalized.length) return normalized;
    var fallback = [];
    if (stable)
      fallback.push({
        content: String(stable),
        entryId: '',
        entryKey: '',
        groupKey: '',
        groupOverride: false,
        order: 0,
        sequence: 0,
        stable: true,
      });
    if (dynamic)
      fallback.push({
        content: String(dynamic),
        entryId: '',
        entryKey: '',
        groupKey: '',
        groupOverride: false,
        order: 0,
        sequence: fallback.length,
        stable: false,
      });
    return fallback;
  }
  function worldBookSegments(items) {
    var stable = [],
      dynamic = [];
    (items || []).forEach(function (item) {
      (item && item.stable === true ? stable : dynamic).push(item);
    });
    return [
      {
        stable: true,
        content: stable
          .map(function (item) {
            return item.content;
          })
          .filter(Boolean)
          .join('\n'),
      },
      {
        stable: false,
        content: dynamic
          .map(function (item) {
            return item.content;
          })
          .filter(Boolean)
          .join('\n'),
      },
    ].filter(function (item) {
      return !!item.content;
    });
  }
  var queryLimit =
      typeof memoryV5Number === 'function' ? memoryV5Number(promptSettings.memoryQueryMessageLimit, 4, 8, 6) : 6,
    memoryQueryRows = rawConversationMsgs.slice(-queryLimit),
    memoryQueryText =
      typeof vectorRetrievalQueryForMessages === 'function'
        ? vectorRetrievalQueryForMessages(rawConversationMsgs)
        : memoryQueryRows
            .map(function (m) {
              var text = String((m && m.content) || '');
              return m === latestUserForBuild ? text + '\n' + text : text;
            })
            .join('\n'),
    worldBookVectorQueryText =
      typeof worldBookVectorQueryForMessages === 'function'
        ? worldBookVectorQueryForMessages(rawConversationMsgs)
        : memoryQueryText,
    vectorState =
      typeof vectorRetrievalStateForSession === 'function'
        ? vectorRetrievalStateForSession(buildOptions.retrievalSession || sessForBuild, memoryQueryText, worldBookVectorQueryText)
        : { state: 'unprepared', fingerprint: 'vector_unprepared', worldBookHitKeys: new Set(), memoryScores: {} },
    vectorRetrievalFingerprint = String((vectorState && vectorState.fingerprint) || 'vector_unprepared');
  var memoryPayload =
      promptSettings.useMemory !== false && sessForBuild && typeof memoryContextPayloadForSession === 'function'
        ? memoryContextPayloadForSession(sessForBuild, memoryQueryText, 0, char, {
            vectorScores: vectorState && vectorState.memoryScores,
          })
        : {
            text:
              promptSettings.useMemory !== false && sessForBuild
                ? memoryContextForSession(sessForBuild, memoryQueryText, 0, char)
                : '',
            fingerprint: '',
            scored: [],
            enabled: promptSettings.useMemory !== false,
          },
    previewMemoryText = memoryPayload.text || '',
    memoryRetrievalFingerprint = String(memoryPayload.fingerprint || '');
  var generationMode = String((buildOptions.generationTarget && buildOptions.generationTarget.mode) || '');
  var historyOverride =
      generationOverrides.chat_history && typeof generationOverrides.chat_history === 'object'
        ? generationOverrides.chat_history
        : {},
    authorNoteOverridden = Object.prototype.hasOwnProperty.call(historyOverride, 'author_note'),
    risuSessionAuthorNoteOwned = !!(
      typeof isRisuCharacter === 'function' &&
      isRisuCharacter(char) &&
      sessForBuild &&
      sessForBuild.risu &&
      Object.prototype.hasOwnProperty.call(sessForBuild.risu, 'authorNote')
    ),
    authorNoteText = String(
      authorNoteOverridden
        ? historyOverride.author_note
        : risuSessionAuthorNoteOwned
          ? sessForBuild.risu.authorNote
          : promptSettings.authorsNote || ''
    ),
    authorNoteFrequencyValue = Number(promptSettings.anFreq),
    authorNoteFrequency = Number.isFinite(authorNoteFrequencyValue)
      ? Math.max(0, Math.floor(authorNoteFrequencyValue))
      : 2,
    authorNoteDepth = Math.max(0, parseInt(promptSettings.anDepth) || 0),
    authorNotePosition = ['before', 'after', 'chat'].includes(String(promptSettings.authorNotePosition || 'chat'))
      ? String(promptSettings.authorNotePosition || 'chat')
      : 'chat',
    authorNoteRole = ['system', 'user', 'assistant'].includes(String(promptSettings.authorNoteRole || 'system'))
      ? String(promptSettings.authorNoteRole || 'system')
      : 'system',
    authorNoteUserTurnCount = (
      sessForBuild && Array.isArray(sessForBuild.msgs) ? sessForBuild.msgs : completeMsgs
    ).filter(function (message) {
      return message && message.role === 'user';
    }).length,
    plannedAuthorNoteActive =
      risuSessionAuthorNoteOwned || authorNoteOverridden
        ? !!(latestUserForBuild && authorNoteText)
        : !!(
            latestUserForBuild &&
            authorNoteText &&
            authorNoteFrequency > 0 &&
            authorNoteUserTurnCount % authorNoteFrequency === 0
          ),
    plannedAuthorNoteText = plannedAuthorNoteActive ? authorNoteText : '';
  var risuSystemPromptsForBuild =
      buildOptions.risuSystemPrompts && typeof isRisuCharacter === 'function' && isRisuCharacter(char)
        ? buildOptions.risuSystemPrompts
        : null,
    risuPromptSettingsForBuild =
      typeof isRisuCharacter === 'function' && isRisuCharacter(char) && typeof risuUtilityPromptSettings === 'function'
        ? risuUtilityPromptSettings(char)
        : {},
    risuUtilityBot = risuPromptSettingsForBuild.utilityBot === true,
    risuPrebuiltAssetCommand = String(risuPromptSettingsForBuild.prebuiltAssetCommand || ''),
    risuFixedContextEstimate = risuSystemPromptsForBuild
      ? ['start', 'historyend', 'promptend'].reduce(function (sum, key) {
          var value = String(risuSystemPromptsForBuild[key] || '');
          return sum + (value ? estTokens(value) + 4 : 0);
        }, 0)
      : 0;
  function appendRisuPrebuiltAssetCommand(value, globalNoteSource) {
    var text = String(value || '');
    if (!risuPrebuiltAssetCommand || String(globalNoteSource || '').includes('{{//@customimageinstruction}}'))
      return text;
    return [text, risuPrebuiltAssetCommand].filter(Boolean).join('\n');
  }
  // Preserve message identity/depth while sharing the request text between budgeting and assembly.
  var regexDepthByMessage = new Map(),
    regexDepths =
      typeof regexScriptMessageDepths === 'function'
        ? regexScriptMessageDepths(completeMsgs, buildOptions.generationTarget)
        : [],
    conversationRequestText = new Map();
  completeMsgs.forEach(function (message, index) {
    regexDepthByMessage.set(message, regexDepths[index]);
  });
  function stripHistoricalTurnParameters(text) {
    var cleaned = text.replace(/^[ \t]*(?:【[^】]*】[ \t]*)+(?:\r?\n|$)/gm, '');
    cleaned = cleaned.replace(/(?:[ \t]*【[^】]*】[ \t]*)+/g, function (block, offset, source) {
      // Keep one word separator for inline parameters; standalone parameter lines disappear.
      return /^[ \t]|[ \t]$/.test(block) &&
        offset > 0 &&
        offset + block.length < source.length &&
        !/[\r\n]/.test(source[offset - 1] + source[offset + block.length])
        ? ' '
        : '';
    });
    return cleaned === text ? text : cleaned.replace(/\r?\n(?:[ \t]*\r?\n){2,}/g, '\n\n').trim();
  }
  function requestTextForMessage(m) {
    if (conversationRequestText.has(m)) return conversationRequestText.get(m);
    var source = regexScriptPromptSourceText(m, char);
    if (
      typeof regexScriptMessageEligible === 'function' &&
      regexScriptMessageEligible(m) &&
      typeof applyRegexScriptsToText === 'function'
    )
      source = applyRegexScriptsToText(source, m.role, 'send', char, { depth: regexDepthByMessage.get(m) }).text;
    var stripParameters = buildOptions.mainChat === true && m.role === 'user' && m !== latestUserForBuild,
      text = stripParameters ? stripHistoricalTurnParameters(source) : source,
      prepared = { source: source, text: text, omitted: stripParameters && !text && !m._yeyuGenerationImageKey };
    conversationRequestText.set(m, prepared);
    return prepared;
  }
  function historyMessageTokens(m) {
    if (buildOptions.mainChat !== true) return estTokens(m.content || '') + 10;
    var prepared = requestTextForMessage(m);
    return prepared.omitted ? 0 : estTokens(prepared.text) + 10;
  }
  const maxTokens = buildOptions.ignoreContextLimit ? 0 : parseInt(generationSettings.maxContextTokens) || 0;
  // estTokens is fitted to DeepSeek's tokenizer and other tokenizers count CJK text higher, so the
  // error grows with the prompt: the safety margin scales with the window instead of a fixed 500.
  var contextMargin = Math.max(500, Math.ceil(maxTokens * 0.1)),
    replyReserve = generationSettings.maxTokens || estimateReplyTokens(rawConversationMsgs.slice(-1)),
    maxContextThreshold = Math.max(0, maxTokens - replyReserve - contextMargin),
    sysPrompt = risuUtilityBot
      ? ''
      : yield buildPrompt(
          char,
          conversationMsgs,
          '',
          macroState,
          null,
          macroState.ecosystem === 'risu' ? macroReplace : undefined
        ),
    depthPrompt =
      (char.extensions && (char.extensions.depth_prompt || char.extensions.depthPrompt)) ||
      (char.importMeta && char.importMeta.depthPrompt),
    depthPromptText = depthPrompt
      ? typeof depthPrompt === 'string'
        ? depthPrompt
        : String(depthPrompt.prompt || depthPrompt.content || depthPrompt.text || depthPrompt.value || '')
      : '',
    postHistoryBase = continuationTarget || risuUtilityBot ? '' : presetSentPromptContent('jailbreak'),
    postHistoryForBudget = appendRisuPrebuiltAssetCommand(
      resolveCardPromptTemplate(postHistoryBase, char.post_history_instructions),
      postHistoryBase
    ),
    examplesEstimate =
      !risuUtilityBot && char.mes_example
        ? trimToTokenBudget(promptClean(char.mes_example), promptSettings.maxExampleTokens || 0)
        : '';
  var renderedCharacterSections = {
      description: promptClean(yield macroReplace(char.description)),
      personality: promptClean(yield macroReplace(char.personality)),
      scenario: promptClean(yield macroReplace(char.scenario)),
      characterVersion: risuUtilityBot ? '' : promptClean(yield macroReplace(char.character_version || '')),
    },
    fixedContextEstimate =
      [
        sysPrompt,
        !risuUtilityBot && persona && persona.desc,
        renderedCharacterSections.description,
        renderedCharacterSections.personality,
        renderedCharacterSections.scenario,
        renderedCharacterSections.characterVersion,
        examplesEstimate,
        !risuUtilityBot && previewMemoryText,
        postHistoryForBudget,
        !risuUtilityBot && depthPromptText,
        !risuUtilityBot && plannedAuthorNoteText,
        !risuUtilityBot && storyDirectionMessage && storyDirectionMessage.content,
      ].reduce(function (sum, value) {
        return sum + estTokens(value || '') + 4;
      }, 0) + risuFixedContextEstimate,
    historyContextEstimate = rawConversationMsgs.reduce(function (sum, message) {
      return sum + historyMessageTokens(message);
    }, 0),
    maxContextReached = maxTokens > 0 && fixedContextEstimate + historyContextEstimate >= maxContextThreshold,
    characterSections = {
      personality: !!renderedCharacterSections.personality,
      scenario: !!renderedCharacterSections.scenario,
    };
  // With the preset layout the fixed part is the prompts the preset actually sends, counted by order, toggle and
  // trigger; the list above only stands for the layout sent without it.
  if (!risuUtilityBot && typeof presetFixedContextEstimate === 'function') {
    fixedContextEstimate =
      presetFixedContextEstimate(completionPresetForBuild, {
        personaDescription: String((persona && persona.desc) || ''),
        charDescription: renderedCharacterSections.description,
        charPersonality: renderedCharacterSections.personality,
        scenario: renderedCharacterSections.scenario,
        dialogueExamples: examplesEstimate,
        cardSystemPrompt: String(char.system_prompt || ''),
        cardPostHistory: String(char.post_history_instructions || ''),
        userName: String(userName || 'User'),
        charName: String(charName || 'Assistant'),
        mode: generationMode,
      }) + risuFixedContextEstimate;
    maxContextReached = maxTokens > 0 && fixedContextEstimate + historyContextEstimate >= maxContextThreshold;
  }
  // world-info.js hands WORLD_INFO scripts `entry.depth ?? 4` for @D entries and no depth otherwise.
  var renderWorldBookContent = function (value, entry) {
      var depth = entry && entry.position === 'at_depth' ? Number(entry.depth ?? 4) : undefined,
        produce = function () {
          var rendered = String(value || ''),
            result =
              typeof applyRegexScriptsToText === 'function'
                ? applyRegexScriptsToText(rendered, 'worldbook', 'send', char, { depth: depth })
                : { text: rendered, ready: true };
          return { text: result.text, ready: result.ready !== false };
        };
      return (
        typeof regexScriptScopeMemo === 'function'
          ? regexScriptScopeMemo(
              JSON.stringify([
                'wb',
                char.id,
                sessForBuild && sessForBuild.id,
                value == null ? '' : String(value),
                depth,
              ]),
              produce
            )
          : produce()
      ).text;
    },
    worldBookGlobalScanData = {
      personaDescription: String((persona && persona.desc) || ''),
      characterDescription: String(renderedCharacterSections.description || ''),
      characterPersonality: String(renderedCharacterSections.personality || ''),
      characterDepthPrompt: String(depthPromptText || ''),
      scenario: String(renderedCharacterSections.scenario || ''),
      creatorNotes: String((char && (char.creator_notes || char.creatorcomment)) || ''),
      authorNote: String(plannedAuthorNoteText || ''),
    },
    worldBookResolveOptions = {
      commitRuntime: buildOptions.commit === true,
      vectorHitKeys: vectorState && vectorState.worldBookHitKeys,
      maxContextReached: maxContextReached,
      contextBaseTokens: fixedContextEstimate + historyContextEstimate,
      maxContextThreshold: maxContextThreshold,
      characterSections: characterSections,
      renderContent: renderWorldBookContent,
      renderScanText: macroReplace,
      scanInjections: worldBookScanInjections,
      globalScanData: worldBookGlobalScanData,
      generationType: buildOptions.generationTarget && buildOptions.generationTarget.mode,
      maxContext: maxTokens,
      promptTemplateRun: buildOptions.promptTemplateRun,
      randomSource:
        buildOptions.worldBookRandom ||
        (typeof worldBookRoundRandom === 'function'
          ? worldBookRoundRandom(
              sessForBuild,
              [
                sessForBuild && sessForBuild.id,
                rawConversationMsgs.length,
                vectorRetrievalFingerprint,
                latestUserForBuild && latestUserForBuild.seq,
                buildOptions.generationTarget && buildOptions.generationTarget.mode,
              ].join('|')
            )
          : undefined),
    };
  var wb =
    typeof isRisuCharacter === 'function' &&
    isRisuCharacter(char) &&
    typeof risuResolveWorldBookForPrompt === 'function'
      ? yield risuResolveWorldBookForPrompt(char, sessForBuild, rawConversationMsgs, {
          macroState: macroState,
          signal: buildOptions.signal,
          random: buildOptions.worldBookRandom || buildOptions.random || Math.random,
        })
      : resolveWorldBook(recentMessages, char.id, sessForBuild, worldBookResolveOptions);
  var wbMetrics = {
    matched: Number(wb.matchedCount) || 0,
    activated: Number(wb.activatedCount) || 0,
    injected: Number(wb.count) || 0,
    dropped: Number(wb.droppedCount) || 0,
    tokens: Number(wb.injectedTokens) || 0,
    details: wb.details || [],
  };
  if (buildOptions.commit === true) {
    D._lastWbHitCount = wbMetrics.injected || 0;
    _lastWbHitsByChar[char.id] = wbMetrics;
  }
  var applyRisuWorldBookInjection = function (value, location) {
    if (!wb.isRisu || !wb.risuResolved || typeof YeyuRisuLorebook !== 'object') return String(value || '');
    return YeyuRisuLorebook.applyPosition(
      YeyuRisuLorebook.applyInjection(value, location, wb.risuResolved),
      wb.risuResolved
    );
  };
  var disabledUiPrompts = new Set(Array.isArray(wb.disabledUiPrompts) ? wb.disabledUiPrompts : []),
    postHistoryInstructionsDisabled = disabledUiPrompts.has('post_history_instructions');
  // The preset owns text-slot overrides; apply parsed Risu injections after it resolves that text.
  var transformPresetPromptSlot = wb.isRisu
    ? function (id, value) {
        return id === 'jailbreak'
          ? appendRisuPrebuiltAssetCommand(applyRisuWorldBookInjection(value, 'globalNote'), postHistoryBase)
          : applyRisuWorldBookInjection(value, 'main');
      }
    : null;
  sysPrompt = risuUtilityBot
    ? ''
    : yield buildPrompt(
        char,
        conversationMsgs,
        '',
        macroState,
        disabledUiPrompts,
        macroState.ecosystem === 'risu' ? macroReplace : undefined
      );
  sysPrompt = applyRisuWorldBookInjection(sysPrompt, 'main');
  postHistoryForBudget = appendRisuPrebuiltAssetCommand(
    applyRisuWorldBookInjection(
      resolveCardPromptTemplate(postHistoryInstructionsDisabled ? '' : postHistoryBase, char.post_history_instructions),
      'globalNote'
    ),
    postHistoryBase
  );
  var allBeforeCharParts = worldBookPositionItems(wb.beforeCharItems, wb.beforeChar, wb.stableBeforeChar),
    characterPositionParts = allBeforeCharParts.filter(function (item) {
      return !!item.characterPosition;
    }),
    beforeCharParts = allBeforeCharParts.filter(function (item) {
      return !item.characterPosition;
    }),
    afterCharParts = worldBookPositionItems(wb.afterCharItems, wb.afterChar, wb.stableAfterChar),
    beforeUserParts = worldBookPositionItems(wb.beforeUserItems, wb.beforeUser, '');
  if (Object.prototype.hasOwnProperty.call(generationOverrides, 'world_info_before'))
    beforeCharParts = String(generationOverrides.world_info_before || '')
      ? [{ content: String(generationOverrides.world_info_before), stable: false }]
      : [];
  if (Object.prototype.hasOwnProperty.call(generationOverrides, 'world_info_after'))
    afterCharParts = String(generationOverrides.world_info_after || '')
      ? [{ content: String(generationOverrides.world_info_after), stable: false }]
      : [];
  var anTopParts = worldBookItemRows(wb.anTopItems),
    anBottomParts = worldBookItemRows(wb.anBottomItems),
    emTopParts = worldBookItemRows(wb.emTopItems),
    emBottomParts = worldBookItemRows(wb.emBottomItems),
    outletParts = worldBookItemRows(wb.outletItems);
  var joinWorldBookParts = function (items) {
    return (items || [])
      .map(function (item) {
        return item.content;
      })
      .filter(Boolean)
      .join('\n');
  };
  // Same-name outlets are concatenated in official order and consumed by {{outlet::Name}}
  // inside prompts the user owns. Unreferenced outlets are dropped, never relocated.
  var worldBookOutlets = {};
  outletParts.forEach(function (item) {
    var name = String(item.outletName || '');
    if (!name) return;
    (worldBookOutlets[name] || (worldBookOutlets[name] = [])).push(item.content);
  });
  var usedWorldBookOutlets = new Set(),
    applyWorldBookOutlets = function (value) {
      var text = String(value == null ? '' : value);
      if (!text || text.indexOf('{{outlet::') < 0) return text;
      return text.replace(/\{\{outlet::(.+?)\}\}/gi, function (_, name) {
        var key = String(name || '').trim(),
          rows = Object.prototype.hasOwnProperty.call(worldBookOutlets, key) ? worldBookOutlets[key] : null;
        if (rows) usedWorldBookOutlets.add(key);
        return rows ? rows.join('\n') : '';
      });
    };

  const result = [],
    pipelineStages = [],
    conversationPromptMessages = new Set(),
    macroSourceBySeq = new Map();
  ((sessForBuild && sessForBuild.msgs) || []).forEach(function (message) {
    if (Number(message.seq) > 0) macroSourceBySeq.set(Number(message.seq), message);
  });
  var presetLayers = [],
    presetDialogueBlocks = [],
    presetAssembly = null;
  function markPromptStage(id) {
    pipelineStages.push({ id: id, messageIndex: result.length });
  }
  markPromptStage('fixed-system');
  if (sysPrompt) result.push({ role: 'system', content: sysPrompt });
  markPromptStage('persona');
  if (!risuUtilityBot && personaPromptDescription) result.push({ role: 'system', content: personaPromptDescription });
  markPromptStage('worldbook-before-char');
  (wb.isRisu ? beforeCharParts : worldBookSegments(beforeCharParts)).forEach(function (segment) {
    result.push({
      role: wb.isRisu ? segment.role || 'system' : 'system',
      content: segment.content,
    });
  });
  markPromptStage('character-card');
  if (wb.isRisu)
    characterPositionParts
      .filter(function (item) {
        return item.characterPosition === 'before_desc';
      })
      .forEach(function (item) {
        result.push({ role: item.role || 'system', content: item.content });
      });
  var characterCoreMessage = {
    role: 'system',
    content: buildCharacterCorePrompt(
      char,
      userName,
      macroState,
      wb.isRisu ? [] : characterPositionParts,
      renderedCharacterSections
    ),
  };
  result.push(characterCoreMessage);
  if (wb.isRisu)
    characterPositionParts
      .filter(function (item) {
        return item.characterPosition !== 'before_desc';
      })
      .forEach(function (item) {
        result.push({ role: item.role || 'system', content: item.content });
      });
  markPromptStage('worldbook-after-char');
  (wb.isRisu ? afterCharParts : worldBookSegments(afterCharParts)).forEach(function (segment) {
    result.push({
      role: wb.isRisu ? segment.role || 'system' : 'system',
      content: segment.content,
    });
  });

  markPromptStage('examples');
  if (!risuUtilityBot) {
    const examplesRaw = char.mes_example ? yield macroReplace(promptClean(char.mes_example)) : '';
    const examples = examplesRaw ? trimToTokenBudget(examplesRaw, promptSettings.maxExampleTokens || 0) : '';
    const exampleTop = joinWorldBookParts(emTopParts),
      exampleBottom = joinWorldBookParts(emBottomParts),
      exampleBody = [exampleTop, examples, exampleBottom].filter(Boolean).join('\n');
    if (exampleBody) result.push({ role: 'system', content: exampleBody });
    if (typeof presetDialogueExampleBlocks === 'function') {
      presetDialogueBlocks = presetDialogueExampleBlocks(
        examples,
        String(userName || 'User'),
        String(charName || 'Assistant')
      );
      if (!presetDialogueBlocks.length && (exampleTop || exampleBottom))
        presetDialogueBlocks = [[{ role: 'system', content: '' }]];
      if (presetDialogueBlocks.length) {
        var firstExampleBlock = presetDialogueBlocks[0],
          lastExampleBlock = presetDialogueBlocks[presetDialogueBlocks.length - 1],
          exampleHeader = exampleTop,
          exampleFooter = exampleBottom;
        if (exampleHeader) firstExampleBlock.unshift({ role: 'system', content: exampleHeader });
        if (exampleFooter) lastExampleBlock.push({ role: 'system', content: exampleFooter });
      }
    }
  }

  markPromptStage('token-budget');
  const toInclude = [];
  var trimmedMsgs = [];
  var unplacedWorldBookTokens = beforeUserParts.reduce(function (total, item) {
    return total + estTokens(item.content);
  }, 0);
  if (wb.inChat && wb.inChat.size)
    wb.inChat.forEach(function (rows) {
      (rows || []).forEach(function (item) {
        unplacedWorldBookTokens += estTokens(item.content);
      });
    });
  // The card sections as the preset sees them: each text with the world-book entries pinned to its position.
  var presetCharacterSections = function () {
    var positionText = function (position) {
      return characterPositionParts
        .filter(function (item) {
          return item.characterPosition === position;
        })
        .map(function (item) {
          return item.content;
        })
        .join('\n');
    };
    return {
      charDescription: [positionText('before_desc'), renderedCharacterSections.description, positionText('after_desc')]
        .filter(Boolean)
        .join('\n'),
      charPersonality: [renderedCharacterSections.personality, positionText('personality')].filter(Boolean).join('\n'),
      scenario: [renderedCharacterSections.scenario, positionText('scenario')].filter(Boolean).join('\n'),
    };
  };
  var dynamicReserve =
    unplacedWorldBookTokens +
    estTokens(risuUtilityBot ? '' : previewMemoryText) +
    estTokens(postHistoryForBudget) +
    estTokens(risuUtilityBot ? '' : depthPromptText) +
    (!risuUtilityBot && storyDirectionMessage ? estTokens(storyDirectionMessage.content) + 4 : 0);
  if (!risuUtilityBot && typeof presetFixedContextEstimate === 'function') {
    var presetSections = presetCharacterSections();
    fixedContextEstimate =
      presetFixedContextEstimate(completionPresetForBuild, {
        personaDescription: personaPromptDescription,
        charDescription: presetSections.charDescription,
        charPersonality: presetSections.charPersonality,
        scenario: presetSections.scenario,
        dialogueExamples: yield macroReplace(examplesEstimate),
        cardSystemPrompt: String(char.system_prompt || ''),
        cardPostHistory: String(char.post_history_instructions || ''),
        transformPromptSlot: transformPresetPromptSlot,
        disableSystemPrompt: disabledUiPrompts.has('system_prompt'),
        disablePostHistoryPrompt: postHistoryInstructionsDisabled,
        userName: String(userName || 'User'),
        charName: String(charName || 'Assistant'),
        mode: generationMode,
      }) + risuFixedContextEstimate;
    dynamicReserve =
      (Number(wb.injectedTokens) || 0) +
      scriptInjects.reduce(function (sum, row) {
        return sum + (row.position !== 'none' ? estTokens(row.content) + 4 : 0);
      }, 0) +
      ([2, 3, 4].includes(personaPosition) ? estTokens(personaDescription) : 0) +
      estTokens(previewMemoryText) +
      estTokens(depthPromptText) +
      estTokens(plannedAuthorNoteText) +
      (storyDirectionMessage ? estTokens(storyDirectionMessage.content) + 4 : 0) +
      (continuationHistoryMessage ? estTokens(continuationHistoryMessage.content) + 10 : 0);
  }
  if (!maxTokens || maxTokens <= 0) {
    toInclude.push(...conversationMsgs);
  } else {
    let usedTokens = fixedContextEstimate + dynamicReserve;
    const maxReply = generationSettings.maxTokens || estimateReplyTokens(rawConversationMsgs.slice(-1));
    const budget = maxTokens - usedTokens - maxReply - contextMargin;
    let tokCount = 0,
      keptCount = 0,
      latestIndex = conversationMsgs.length - 1;
    const recentLimit =
      typeof memoryV5RecentMessageLimit === 'function'
        ? memoryV5RecentMessageLimit(promptSettings.recentMsgLimit, promptSettings.autoSummaryEvery)
        : parseInt(promptSettings.recentMsgLimit) || 0;
    for (let i = conversationMsgs.length - 1; i >= 0; i--) {
      const m = conversationMsgs[i];
      const tokens = historyMessageTokens(m);
      // Empty stripped rows retain their identity for positioning, but consume no history allowance.
      if (!tokens) {
        toInclude.unshift(m);
        continue;
      }
      // 当前轮必须保留，不能因为上下文预算过小而只剩执行合同、却丢掉用户正文。
      if (i === latestIndex) {
        toInclude.unshift(m);
        tokCount += tokens;
        keptCount++;
        continue;
      }
      var coveredByActiveSummary =
        summaryCoverageEnd > 0 &&
        m &&
        m.historySummary !== true &&
        Number(m.seq) > 0 &&
        Number(m.seq) <= summaryCoverageEnd;
      if ((recentLimit > 0 && keptCount >= recentLimit && coveredByActiveSummary) || tokCount + tokens > budget)
        trimmedMsgs.unshift(m);
      else {
        toInclude.unshift(m);
        tokCount += tokens;
        keptCount++;
      }
    }
  }
  var firstIncluded = toInclude
    .map(function (message) {
      return completeMsgs.indexOf(message);
    })
    .filter(function (index) {
      return index >= 0;
    })
    .sort(function (a, b) {
      return a - b;
    })[0];
  macroState.firstIncludedMessageId = Number.isInteger(firstIncluded) ? firstIncluded : completeMsgs.length ? 0 : null;

  const latest =
      rawConversationMsgs
        .slice()
        .reverse()
        .find(function (message) {
          return message && message.role === 'user';
        }) || (toInclude.length ? toInclude[toInclude.length - 1] : null),
    outputGuard = latest
      ? yield macroReplace(
          appendRisuPrebuiltAssetCommand(
            applyRisuWorldBookInjection(
              resolveCardPromptTemplate(
                postHistoryInstructionsDisabled ? '' : postHistoryBase,
                char.post_history_instructions
              ),
              'globalNote'
            ),
            postHistoryBase
          )
            .replace(/\{\{instant_directives_block\}\}/g, '')
            .replace(/\{\{instant_directives\}\}/g, '')
            .replace(/\{\{longform_guard\}\}/g, '')
            .replace(/\{\{requirement_guard\}\}/g, ''),
          char,
          userName,
          macroState
        )
      : '';
  markPromptStage('memory');
  // Author note top/bottom entries wrap the note itself, and still reach the prompt in
  // the note slot when this round has no note text of its own.
  var ephemeralInChat = [],
    ephemeralBeforeUser = beforeUserParts,
    requestedAuthorNote = risuUtilityBot
      ? ''
      : [
          personaPosition === 2 ? personaDescription : '',
          joinWorldBookParts(anTopParts),
          plannedAuthorNoteActive ? authorNoteText : '',
          joinWorldBookParts(anBottomParts),
          personaPosition === 3 ? personaDescription : '',
        ]
          .filter(Boolean)
          .join('\n'),
    ephemeralAuthorNote =
      requestedAuthorNote && authorNotePosition === 'chat'
        ? { content: requestedAuthorNote, depth: authorNoteDepth, role: authorNoteRole }
        : null;
  if (requestedAuthorNote && authorNotePosition !== 'chat')
    scriptInjects.push({
      id: '__authors_note__',
      position: authorNotePosition === 'before' ? 'before_prompt' : 'in_prompt',
      role: authorNoteRole,
      depth: authorNoteDepth,
      content: requestedAuthorNote,
      should_scan: false,
    });
  if (wb.inChat && wb.inChat.size)
    wb.inChat.forEach(function (rows, depth) {
      rows.forEach(function (row, index) {
        ephemeralInChat.push({
          depth: Number(depth) || 0,
          role: row.role || 'system',
          content: row.content,
          order: Number(row.order) || 0,
          sequence: Number.isFinite(Number(row.sequence)) ? Number(row.sequence) : index,
        });
      });
    });
  if (buildOptions.commit === true && latestUserForBuild && typeof rememberMessageMemoryScores === 'function')
    rememberMessageMemoryScores(latestUserForBuild, {
      fingerprint: memoryRetrievalFingerprint,
      scored: Array.isArray(memoryPayload.scored) ? memoryPayload.scored : [],
      enabled: memoryPayload.enabled !== false && promptSettings.useMemory !== false,
    });

  function appendConversationMessage(m) {
    var prepared = requestTextForMessage(m),
      c = prepared.text;
    var sourceMessage = macroSourceBySeq.get(Number(m.seq)),
      pendingEffects = sourceMessage && sourceMessage.pendingMacroEffects;
    if (macroState.ecosystem !== 'risu' && pendingEffects) {
      var from = Math.max(0, Number(pendingEffects.from) || 0);
      macroReplace(from ? String(sourceMessage.content || '').slice(from) : prepared.source);
      if (buildOptions.commit === true) {
        delete sourceMessage.pendingMacroEffects;
        macroState.dirtySections.add('sessions');
      }
    }
    if (prepared.omitted) return;
    var apiMessage = { role: m.role, content: c, _yeyuConversation: true };
    if (m._yeyuGenerationImageKey) apiMessage._yeyuGenerationImageKey = String(m._yeyuGenerationImageKey);
    result.push(apiMessage);
    conversationPromptMessages.add(apiMessage);
    if (m === latest && m.role === 'user') latestUserApiMessage = apiMessage;
  }
  function depthRowMessages(rows) {
    return rows.map(function (item) {
      return { role: item.role, content: item.content };
    });
  }
  // ST populationInjectionPrompts: one message per role at a depth, in assistant, user, system order.
  function depthRoleMessages(rows) {
    return ['assistant', 'user', 'system']
      .map(function (role) {
        return {
          role: role,
          content: rows
            .filter(function (item) {
              return item.role === role;
            })
            .map(function (item) {
              return item.content;
            })
            .join('\n'),
        };
      })
      .filter(function (message) {
        return message.content;
      });
  }
  // ST 语义：深度条目与作者注记每次生成按当前聊天末尾倒数定位，不随历史消息持久重放；
  // before_user 在深度注入后再插入，保持与最新用户消息紧邻。
  function injectConversationDepthEntries() {
    var attached = (historyOverride.with_depth_entries === false ? [] : ephemeralInChat).map(function (item, index) {
      return {
        depth: Math.max(0, Number(item.depth) || 0),
        role: ['user', 'assistant'].includes(item.role) ? item.role : 'system',
        content: item.content,
        order: Number(item.order) || 0,
        sequence: Number.isFinite(Number(item.sequence)) ? Number(item.sequence) : index,
      };
    });
    if (ephemeralAuthorNote)
      attached.push({
        depth: Math.max(0, Number(ephemeralAuthorNote.depth) || 0),
        role: ephemeralAuthorNote.role,
        content: ephemeralAuthorNote.content,
        order: Infinity,
        sequence: Infinity,
      });
    if (!risuUtilityBot && personaPosition === 4 && personaDescription)
      attached.push({
        depth: Math.max(0, Number(persona.depth ?? 2)),
        role: ['system', 'user', 'assistant'][Number(persona.role) || 0] || 'system',
        content: personaDescription,
        order: 0,
        sequence: Infinity,
      });
    scriptInjects.forEach(function (row, index) {
      if (row.position === 'in_chat' && row.content)
        attached.push({ depth: row.depth, role: row.role, content: row.content, order: 0, sequence: index });
    });
    var byDepth = {};
    attached.forEach(function (item) {
      var key = String(item.depth);
      (byDepth[key] || (byDepth[key] = [])).push(item);
    });
    Object.keys(byDepth)
      .map(Number)
      .sort(function (a, b) {
        return b - a;
      })
      .forEach(function (depth) {
        var rows = byDepth[String(depth)].sort(function (a, b) {
            return a.sequence - b.sequence || a.order - b.order;
          }),
          at = Math.max(conversationFloor, result.length - Math.min(100, depth));
        result.splice.apply(result, [at, 0].concat(wb.isRisu ? depthRowMessages(rows) : depthRoleMessages(rows)));
      });
    if (latestUserApiMessage && ephemeralBeforeUser.length) {
      var userAt = result.indexOf(latestUserApiMessage),
        beforeUserText = ephemeralBeforeUser
          .map(function (item) {
            return item.content;
          })
          .filter(Boolean)
          .join('\n');
      if (userAt >= 0 && beforeUserText)
        result.splice(userAt, 0, { role: 'system', content: '[世界书 / 当前用户消息之前]\n' + beforeUserText });
    }
  }
  markPromptStage('worldbook-in-chat');
  markPromptStage('worldbook-before-user');
  markPromptStage('chat-history');
  var conversationFloor = result.length,
    latestUserApiMessage = null;
  toInclude.forEach(function (message) {
    if (message !== continuationHistoryMessage) appendConversationMessage(message);
  });
  injectConversationDepthEntries();
  if (!risuUtilityBot && depthPromptText.trim()) {
    var depth = Math.max(
        0,
        Math.min(
          50,
          parseInt(
            depthPrompt && typeof depthPrompt === 'object' ? depthPrompt.depth || depthPrompt.injection_depth : 0
          ) || 0
        )
      ),
      rawDepthRole = String(
        depthPrompt && typeof depthPrompt === 'object' ? depthPrompt.role || depthPrompt.message_role || '' : ''
      ).toLowerCase(),
      depthRole =
        rawDepthRole === 'user' || rawDepthRole === '1'
          ? 'user'
          : rawDepthRole === 'assistant' || rawDepthRole === '2'
            ? 'assistant'
            : 'system',
      depthPosition = String(
        depthPrompt && typeof depthPrompt === 'object'
          ? depthPrompt.position || depthPrompt.insertion_position || ''
          : ''
      ).toLowerCase(),
      insertAt = Math.max(conversationFloor, result.length - depth);
    if (depthPosition === 'before_char') {
      var coreAt = result.indexOf(characterCoreMessage);
      if (coreAt >= 0) insertAt = coreAt;
    } else if (depthPosition === 'after_char') {
      var afterCore = result.indexOf(characterCoreMessage);
      if (afterCore >= 0) insertAt = afterCore + 1;
    }
    result.splice(insertAt, 0, { role: depthRole, content: promptClean(depthPromptText) });
    pipelineStages.forEach(function (stage) {
      if (stage.messageIndex > insertAt || (depthPosition === 'before_char' && stage.messageIndex === insertAt))
        stage.messageIndex++;
    });
  }
  markPromptStage('memory-tail');
  // 记忆尾部属于请求附加上下文，不参与预设的聊天深度计数。
  if (!risuUtilityBot && previewMemoryText) {
    var memoryGuide = settingsPromptText('memoryInjectPrompt', promptSettings);
    result.push({ role: 'system', content: memoryGuide });
    result.push({ role: 'system', content: previewMemoryText });
  }
  markPromptStage('depth-prompt');
  markPromptStage('story-direction');
  if (!risuUtilityBot && storyDirectionMessage)
    result.push({ role: storyDirectionMessage.role, content: storyDirectionMessage.content });
  markPromptStage('post-history');
  var styleAuditHint = impersonating
    ? ''
    : buildOptions.commit === true && typeof takeStyleAuditHintForSession === 'function'
      ? takeStyleAuditHintForSession(char.id, sessForBuild && sessForBuild.id)
      : typeof styleAuditHintForSession === 'function'
        ? styleAuditHintForSession(char.id, sessForBuild && sessForBuild.id, promptSettings)
        : '';
  if (!risuUtilityBot && styleAuditHint)
    result.push({ role: 'system', content: '[文风审计] ' + styleAuditHint, _yeyuPresetSupplemental: true });
  if (outputGuard) result.push({ role: 'system', content: (wb.isRisu ? '' : '[发送后指令]\n') + outputGuard });
  (wb.risuPostEverythingItems || []).forEach(function (item) {
    var row = { role: item.role || 'system', content: item.content, _yeyuPresetPostEverything: true };
    if (item.literal === true) row._yeyuRisuLiteral = true;
    result.push(row);
  });
  if (continuationHistoryMessage) appendConversationMessage(continuationHistoryMessage);
  markPromptStage('cache-commit');
  if (!risuUtilityBot && typeof presetAssembleMessages === 'function') {
    var namedSystemPromptProfile =
        typeof stscriptActiveSystemPromptProfile === 'function'
          ? stscriptActiveSystemPromptProfile(false, promptSettings)
          : null,
      namedSystemPromptText = String((namedSystemPromptProfile && namedSystemPromptProfile.content) || ''),
      namedSystemPostHistory = String((namedSystemPromptProfile && namedSystemPromptProfile.postHistory) || '');
    var assemblySections = presetCharacterSections();
    presetAssembly = presetAssembleMessages(result, pipelineStages, {
      completionPresetRaw: completionPresetForBuild,
      personaDescription: personaPromptDescription,
      extensionPrompts: scriptInjects,
      charDescription: assemblySections.charDescription,
      charPersonality: assemblySections.charPersonality,
      scenario: assemblySections.scenario,
      cardSystemPrompt: String(char.system_prompt || ''),
      cardPostHistory: String(char.post_history_instructions || ''),
      transformPromptSlot: transformPresetPromptSlot,
      namedSystemPrompt: namedSystemPromptText,
      namedPostHistory: namedSystemPostHistory,
      disableSystemPrompt: disabledUiPrompts.has('system_prompt'),
      disablePostHistoryPrompt: postHistoryInstructionsDisabled,
      userName: String(userName || 'User'),
      charName: String(charName || 'Assistant'),
      mode: String((buildOptions.generationTarget && buildOptions.generationTarget.mode) || ''),
      dialogueExampleBlocks: presetDialogueBlocks,
      deferFinalize: true,
    });
    if (presetAssembly) {
      result.splice.apply(result, [0, result.length].concat(presetAssembly.messages));
      presetLayers = presetAssembly.layers || [];
    }
  }
  var trimmedMessageCount = trimmedMsgs.filter(function (message) {
      return !(message && message.historySummary === true);
    }).length,
    summaryTrimmed = trimmedMsgs.some(function (message) {
      return message && message.historySummary === true;
    });
  if (risuSystemPromptsForBuild) {
    var risuPrompts = risuSystemPromptsForBuild,
      lastChatAt = -1;
    result.forEach(function (message, index) {
      if (conversationPromptMessages.has(message) || message._yeyuConversation === true) lastChatAt = index;
    });
    if (lastChatAt < 0) lastChatAt = result.length;
    if (risuPrompts.historyend)
      result.splice(Math.min(result.length, lastChatAt + 1), 0, { role: 'system', content: risuPrompts.historyend });
    if (risuPrompts.start) result.splice(lastChatAt, 0, { role: 'system', content: risuPrompts.start });
    if (risuPrompts.promptend) result.push({ role: 'system', content: risuPrompts.promptend });
  }
  var risuFinalRows = [];
  for (var message of result) {
    if (!message || typeof message.content !== 'string') continue;
    var isConversation = conversationPromptMessages.has(message) || message._yeyuConversation === true;
    if (!isConversation) message.content = applyWorldBookOutlets(message.content);
    var beforeSuppress = macroState.suppressWrites;
    if (isConversation) macroState.suppressWrites = true;
    try {
      if (macroState.ecosystem !== 'risu') message.content = yield macroReplace(message.content);
      // 上游原样发送的 Risu 行（inlay 出图指令）不再跑 CBS。
      else if (message._yeyuRisuLiteral !== true) risuFinalRows.push(message);
    } finally {
      macroState.suppressWrites = beforeSuppress;
    }
    delete message._yeyuConversation;
    delete message._yeyuPresetPostEverything;
    delete message._yeyuRisuLiteral;
  }
  if (risuFinalRows.length) {
    var renderedRisuRows = yield risuRenderCBSBatchInWorker(
      risuFinalRows.map(function (message) {
        return message.content;
      }),
      char,
      sessForBuild,
      { state: macroState, runVar: false, signal: buildOptions.signal }
    );
    risuFinalRows.forEach(function (message, index) {
      message.content = renderedRisuRows[index];
    });
  }
  if (presetAssembly && typeof presetFinalizeMessages === 'function') {
    var finalizedPresetMessages = presetFinalizeMessages(result, completionPresetForBuild);
    result.splice.apply(result, [0, result.length].concat(finalizedPresetMessages));
  }
  if (typeof finalizeCharacterMacroState === 'function') finalizeCharacterMacroState(macroState);
  Object.keys(worldBookOutlets).forEach(function (name) {
    if (!usedWorldBookOutlets.has(name))
      wbMetrics.details = (wbMetrics.details || [])
        .concat([{ id: 'outlet:' + name, runtimeKey: 'outlet:' + name, name: name, status: 'outlet-unused' }])
        .slice(0, 200);
  });
  return {
    messages: result,
    usedTokens: result.reduce(function (sum, m) {
      return sum + estTokens(m.content || '') + 4;
    }, 0),
    trimmed: trimmedMsgs.length,
    trimmedMessages: trimmedMessageCount,
    summarized: summarizedMessageCount,
    summaryTrimmed: summaryTrimmed,
    worldBookMetrics: wbMetrics,
    pipelineStages: pipelineStages,
    presetLayers: presetLayers,
  };
}
