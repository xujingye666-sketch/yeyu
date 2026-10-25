// Shared generation assembly. Preview and sending use the same preparation and transformation path.
// A round is the random draw of one reply generation. The preview draws it and the next reply generation of the
// session uses the same draw, whatever changes in between; sending, regenerating or a new swipe consumes it.
// Continuing and impersonating draw privately and leave the pending round alone.
var _generationPromptRounds = new WeakMap();
// A send takes the round out as it starts, so a preview opened while that send is still assembling draws the next one.
function generationPromptRound(session, target, preview) {
  var round = { seed: Math.floor(Math.random() * 4294967295) };
  if (!['new', 'regenerate', 'swipe'].includes(String(target.mode || 'new'))) return round;
  if (_generationPromptRounds.has(session)) round = _generationPromptRounds.get(session);
  if (preview) _generationPromptRounds.set(session, round);
  else _generationPromptRounds.delete(session);
  return round;
}
// Network replay belongs to the same pending round, but only one active chat owns it.
var _generationPromptNetworkOwner = null;
function generationPromptInvalidateNetwork() {
  if (_generationPromptNetworkOwner) {
    var round = _generationPromptRounds.get(_generationPromptNetworkOwner);
    if (round && round.network) {
      round.network.run.active = false;
      round.network = null;
    }
  }
  _generationPromptNetworkOwner = null;
}
function generationPromptNetworkRun(round, char, session, rows, target, options) {
  // Auxiliary context builds have no pending chat round and cannot invalidate its network replay.
  if (options.contextOnly) return { key: null, source: [], entries: [], cursor: 0, replay: true, active: true };
  if (_generationPromptNetworkOwner !== session) generationPromptInvalidateNetwork();
  _generationPromptNetworkOwner = session;
  // Conservative input identity: public lookups can consume other cards, books, personas and variables.
  // The generation target's mutable preparation flags are not template inputs.
  var key;
  try {
    var settings = presetSettingsStore(cloneData(options.promptSettings || D.settings));
    stscriptPromptSettings(settings);
    qrState(settings);
    var raw =
      options.completionPresetRaw === undefined ? activeCompletionPresetRaw(settings) : options.completionPresetRaw;
    settings.chatCompletionPresetInUse = raw;
    // These missing values have the same meaning in 66-stscript-prompts, 57's draft and 58's author-note pass.
    settings.activeSystemPromptProfileId = settings.activeSystemPromptProfileId || '';
    settings.authorNotePosition = settings.authorNotePosition || 'chat';
    settings.authorNoteRole = settings.authorNoteRole || 'system';
    var objects = new WeakMap();
    key = JSON.stringify(
      [
        char,
        session,
        rows,
        target.mode || 'new',
        promptTemplateMessageIndex(session, target.messageIndex),
        settings,
        raw,
        D.characters,
        D.worldBook,
        D.personas,
        D.activePersonaId,
        typeof _promptTemplateDefines === 'object' ? _promptTemplateDefines : null,
      ],
      function (name, value) {
        if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
          throw new TypeError('Unstable EJS network inputs');
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null
        )
          throw new TypeError('Unstable EJS network inputs');
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          if (objects.has(value)) return objects.get(value);
          var sorted = Object.create(null);
          objects.set(value, sorted);
          Object.keys(value)
            .sort()
            .forEach(function (key) {
              var field = Object.getOwnPropertyDescriptor(value, key);
              if (field.get || field.set) throw new TypeError('Unstable EJS network inputs');
              sorted[key] = field.value;
            });
          return sorted;
        }
        return value;
      }
    );
  } catch (error) {
    key = null;
  }
  var previous = round.network;
  if (previous) previous.run.active = false;
  round.network = null;
  return {
    key: key,
    source: key !== null && previous && previous.key === key ? previous.entries : [],
    entries: [],
    cursor: 0,
    replay: true,
    active: true,
  };
}
function generationPromptRandom(round, name) {
  return wbSeededRandom(wbHash32(String(round.seed) + '|' + name));
}
// The round fixes the draws the host makes; randomness and times a card's own scripts produce (EJS, frontend listeners
// and filters, Risu Lua) stay theirs, so a preview that ran any of them says so once.
var GENERATION_PROMPT_SCRIPT_VOLATILE_NOTE = '卡片脚本自行生成的随机数和时间，发送时可能与预览不同。';
function generationPromptNoteScriptRan(notes) {
  if (notes && !notes.includes(GENERATION_PROMPT_SCRIPT_VOLATILE_NOTE))
    notes.push(GENERATION_PROMPT_SCRIPT_VOLATILE_NOTE);
}
// Send-scope caches a preview fills while it builds; they are restored when the preview ends. The scope counter
// keeps counting, so a transform the preview left running can never land in a later send's scope.
function generationPromptPreviewState() {
  return {
    scope: _regexScriptSendScope,
    text: new Map(_cardScriptTextCache),
    sendKeys: new Set(_cardScriptSendCacheKeys),
    sendMisses: _regexScriptSendMisses.slice(),
    scopeMemo: _regexScriptScopeMemo,
    scopeMemoId: _regexScriptScopeMemoId,
    failures: new Set(_cardScriptTextFailures),
    wbResults: new Map(_wbRegexKeyResults),
    wbMisses: new Map(_wbRegexKeyMisses),
    wbErrors: new Map(_wbRegexKeyErrors),
    templateBasicRegexes: new Map(_promptTemplateRegexes.basic),
  };
}
function generationPromptRestorePreviewState(state) {
  _regexScriptSendScope = state.scope;
  _regexScriptSendMisses = state.sendMisses;
  _regexScriptScopeMemo = state.scopeMemo;
  _regexScriptScopeMemoId = state.scopeMemoId;
  [
    [_cardScriptTextCache, state.text],
    [_wbRegexKeyResults, state.wbResults],
    [_wbRegexKeyMisses, state.wbMisses],
    [_wbRegexKeyErrors, state.wbErrors],
    [_promptTemplateRegexes.basic, state.templateBasicRegexes],
  ].forEach(function (entry) {
    entry[0].clear();
    entry[1].forEach(function (value, key) {
      entry[0].set(key, value);
    });
  });
  [
    [_cardScriptSendCacheKeys, state.sendKeys],
    [_cardScriptTextFailures, state.failures],
  ].forEach(function (entry) {
    entry[0].clear();
    entry[1].forEach(function (key) {
      entry[0].add(key);
    });
  });
}
async function assembleGenerationPrompt(char, session, rows, target, options) {
  options = options || {};
  var preview = options.preview === true,
    controller = { signal: options.signal || new AbortController().signal },
    round,
    risuOptions,
    result,
    networkRun;
  options = Object.assign({}, options, { signal: controller.signal });
  if (!preview) cancelPresetRoundPreviewBuild();
  try {
    result = await cardFrontendGenerationWithPromptBuild(controller, async function () {
      var snapshot = preview ? generationPromptPreviewState() : null,
        previousRandom = _regexScriptRoundRandom,
        previewNotes = [],
        // A preview announces itself to card scripts as ST Generate(..., dryRun=true) does, inside this lock; a send
        // is announced by its entry (82) and dispatches the prompt events after the lock. The dry run ends with the
        // preview, so a listener still running afterwards writes again.
        scope = preview && options.interactive === true ? generationPromptPreviewScope(controller.signal) : null,
        dispatch = scope ? { signal: scope.signal, dryRun: true, previewNotes: previewNotes } : null,
        assertFresh = function () {
          if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
        };
      round = options.contextOnly
        ? { seed: Math.floor(Math.random() * 4294967295) }
        : generationPromptRound(session, target, preview);
      networkRun = generationPromptNetworkRun(round, char, session, rows, target, options);
      risuOptions = {
        seed: round.seed,
        preview: preview,
        random: generationPromptRandom(round, 'risu'),
        previewNotes: previewNotes,
      };
      if (options.contextOnly) risuOptions.previewState = options.contextSnapshot;
      try {
        assertFresh();
        if (dispatch) await generationPromptAnnouncePreview(target, dispatch);
        if (!options.contextOnly && isRisuCharacter(char) && !target.risuStarted) {
          target.risuStartResult = await risuPrepareStart(char, session, target, controller.signal, risuOptions);
          target.risuStarted = true;
          if (!preview) {
            if (target.mode === 'continue' || target.mode === 'regenerate' || target.mode === 'swipe')
              resolveGenerationTargetMessage(target, session);
            rows =
              target.mode === 'regenerate' || target.mode === 'swipe'
                ? session.msgs.slice(0, target.messageIndex)
                : options.history || session.msgs;
          }
        }
        if (preview && risuOptions.previewState) rows = risuOptions.previewState.session.msgs;
        // A preview builds on copies, so the MVU replay and everything after it leave the live chat alone.
        var source = options.contextOnly
          ? { char: options.contextSnapshot.character, session: options.contextSnapshot.session, rows: rows }
          : preview
            ? generationPromptPreviewCopies(char, session, rows)
            : { char: char, session: session, rows: rows };
        if (mvuCanRun(char)) await prepareMvuForPrompt(char, source.session, source.rows, { preview: preview });
        // Retrieval results are cached on the live session by what they search, so a send after a preview of the
        // same history reuses the preview's hits instead of querying again.
        var retrievalOptions = { signal: controller.signal, preview: preview, previewNotes: previewNotes };
        var retrievalSession = options.contextOnly ? source.session : session;
        await prepareVectorRetrievalForPrompt(char, retrievalSession, rows, retrievalOptions);
        await dataBankPrepareForPrompt(char, retrievalSession, rows, retrievalOptions);
        var result = await generationPromptBuild(
          source.char,
          source.session,
          source.rows,
          target,
          Object.assign({}, options, {
            sourceSession: session,
            sourceCharacter: char,
            retrievalSession: retrievalSession,
            round: round,
            networkRun: networkRun,
            signal: controller.signal,
            previewNotes: previewNotes,
            risuOptions: risuOptions,
          })
        );
        if (dispatch) result.messages = await generationPromptScriptEvents(result.messages, dispatch);
        if (preview) result = await finalizeGenerationPrompt(char, session, target, result, options, risuOptions);
        result.previewNotes = previewNotes;
        return result;
      } finally {
        if (scope) scope.abort();
        if (preview) risuReleasePromptPreview(risuOptions);
        _regexScriptRoundRandom = previousRandom;
        if (snapshot) generationPromptRestorePreviewState(snapshot);
      }
    });
    if (!preview) {
      // Card events may await a helper generation, which needs the same assembly lock.
      // Preserve event order without holding that lock across user callbacks.
      await qrFlushWorldInfo();
      if (options.interactive === true)
        result.messages = await generationPromptScriptEvents(result.messages, { signal: controller.signal });
      if (controller.signal.aborted) throw cardFrontendGenerationAbortError();
      result = await cardFrontendGenerationWithPromptBuild(controller, function () {
        return finalizeGenerationPrompt(char, session, target, result, options, risuOptions);
      });
    }
    if (preview && networkRun.key !== null && !controller.signal.aborted)
      round.network = { key: networkRun.key, entries: networkRun.entries, run: networkRun };
    else networkRun.active = false;
    return result;
  } catch (error) {
    if (networkRun) networkRun.active = false;
    if (result && result.promptTemplateRun && result.promptTemplateRun.transaction)
      promptTemplateCancelTransaction(result.promptTemplateRun.transaction);
    throw error;
  }
}
// The lifetime of a preview's dry run: it ends when the preview is cancelled or done.
function generationPromptPreviewScope(signal) {
  var scope = new AbortController(),
    end = function () {
      scope.abort();
    };
  if (signal.aborted) scope.abort();
  else signal.addEventListener('abort', end, { once: true });
  scope.signal.addEventListener('abort', function () {
    signal.removeEventListener('abort', end);
  });
  return scope;
}
// The preview's own copies of the character, the chat and the history rows; history rows taken from the chat stay the
// same objects as the copied chat's messages.
function generationPromptPreviewCopies(char, session, rows) {
  var copy = cloneData(session),
    copies = new Map();
  session.msgs.forEach(function (message, index) {
    copies.set(message, copy.msgs[index]);
  });
  return {
    char: cloneData(char),
    session: copy,
    rows: rows.map(function (message) {
      return copies.has(message) ? copies.get(message) : cloneData(message);
    }),
  };
}
// Read-only auxiliary tasks use the same prompt pipeline, with history and derived memory bounded at their target.
// Keep live owners for Risu's transaction checks, but all stage inputs and retrieval caches belong to these copies.
async function assembleGenerationContext(char, session, message, signal) {
  var index = session && session.msgs.indexOf(message);
  if (!session || index < 0) throw new Error('要配图的消息已不在当前对话。');
  var snapshot = generationPromptPreviewCopies(char, session, session.msgs.slice(0, index + 1));
  snapshot.session.msgs = snapshot.rows;
  if (Number(message.seq) > 0) rollbackMemoryAfterSeq(snapshot.session, Number(message.seq) + 1);
  var persona = getActivePersona(char.id),
    target = { mode: 'new', charId: char.id, sessionId: session.id, messageIndex: index, messageSeq: message.seq };
  var result = await assembleGenerationPrompt(char, session, snapshot.rows, target, {
    preview: true,
    contextOnly: true,
    contextSnapshot: {
      character: snapshot.char,
      session: snapshot.session,
      persona: persona ? cloneData(persona) : null,
    },
    signal: signal,
  });
  return result.messages;
}
// ST Generate(type, options, dryRun) emits these before assembling. Quick replies run before generation only on a
// real send, as ST quick-reply skips its before-generation hook on a dry run.
async function generationPromptAnnouncePreview(target, dispatch) {
  var type = generationTypeForTarget(target);
  await cardFrontendAwaitBroadcastEvent(
    CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_STARTED,
    [type, {}, true],
    dispatch
  );
  if (qrHasAuto('executeBeforeGeneration'))
    dispatch.previewNotes.push('快速回复的生成前脚本只在发送时运行，预览未执行；依赖它的内容发送时可能不同。');
  await cardFrontendAwaitBroadcastEvent(
    CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_AFTER_COMMANDS,
    [type, {}, true],
    dispatch
  );
}
// CHAT_COMPLETION_PROMPT_READY ({chat, dryRun}) and GENERATE_AFTER_DATA (generate_data, dryRun) as ST emits them once
// the prompt is assembled; the message list the listeners leave behind is the one sent.
async function generationPromptScriptEvents(messages, dispatch) {
  var dryRun = dispatch.dryRun === true,
    promptReady = await cardFrontendAwaitBroadcastEvent(
      CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_COMPLETION_PROMPT_READY,
      [{ chat: messages, dryRun: dryRun }],
      dispatch
    );
  if (promptReady && promptReady[0] && Array.isArray(promptReady[0].chat)) messages = promptReady[0].chat;
  var dataReady = await cardFrontendAwaitBroadcastEvent(
    CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATE_AFTER_DATA,
    [generationAfterDataPayload(messages, { dryRun: dryRun }), dryRun],
    dispatch
  );
  if (dataReady && dataReady[0] && Array.isArray(dataReady[0].prompt)) messages = dataReady[0].prompt;
  return messages;
}

async function generationPromptBuild(char, sess, sourceRows, requestTarget, options) {
  var target = requestTarget,
    generationType = String(target.mode || 'new');
  var rows = Array.isArray(sourceRows) ? sourceRows : [],
    promptRows = rows.slice(),
    buildOptions = {
      commit: options.preview !== true,
      mainChat: !options.contextOnly,
      completionPresetRaw: options.completionPresetRaw,
      promptSettings: options.promptSettings,
      random: generationPromptRandom(options.round, 'macro'),
      worldBookRandom: generationPromptRandom(options.round, 'worldbook'),
      generationTarget: requestTarget,
      dataBankMessages: rows,
      dataBankCharacter: options.sourceCharacter || char,
      retrievalSession: options.retrievalSession || options.sourceSession || sess,
      risuSystemPrompts: target.risuStartResult && target.risuStartResult.additionalSystemPrompt,
    },
    baseText = '';
  if (!Object.prototype.hasOwnProperty.call(options, 'completionPresetRaw')) delete buildOptions.completionPresetRaw;
  if (requestTarget && requestTarget.mode === 'continue') {
    var baseMessage = resolveGenerationTargetMessage(requestTarget, sess),
      promptIndex = rows.indexOf(baseMessage);
    if (promptIndex < 0 && rows[requestTarget.messageIndex] && rows[requestTarget.messageIndex].role === 'assistant')
      promptIndex = requestTarget.messageIndex;
    if (promptIndex < 0) throw new Error('待继续的回复不在当前对话历史中');
    baseText = messageUntranslatedContent(baseMessage);
    var extracted =
        typeof StoryDirection === 'object' && StoryDirection && typeof StoryDirection.extractBlocks === 'function'
          ? StoryDirection.extractBlocks(baseText, char)
          : { body: baseText },
      promptBody = extracted.body;
    promptRows[promptIndex] = Object.assign({}, promptRows[promptIndex], { content: promptBody });
    buildOptions.anchorMessages = rows;
    buildOptions.storyDirectionMessages = rows.slice(0, promptIndex);
  }
  if (isRisuCharacter(char))
    promptRows = await risuPreparePrompt(
      options.sourceCharacter || char,
      options.sourceSession || sess,
      promptRows,
      requestTarget,
      options.signal,
      options.risuOptions
    );
  if (options.preview && options.risuOptions.previewState) {
    char = options.risuOptions.previewState.character;
    buildOptions.personaOverride = options.risuOptions.previewState.persona;
    sess = options.risuOptions.previewState.session;
  }
  var promptTemplateRun = await promptTemplatePrepareGeneration(
    char,
    sess,
    requestTarget && requestTarget.messageIndex,
    {
      generationType: generationType,
      signal: options.signal,
      preview: options.preview === true,
      promptSettings: options.promptSettings,
      random: generationPromptRandom(options.round, 'ejs'),
      networkRun: options.networkRun,
      previewNotes: options.previewNotes,
    },
    requestTarget && requestTarget._promptTemplateStscriptRunToken
  );
  try {
    buildOptions.promptTemplateRun = promptTemplateRun;
    var injectSession = options.sourceSession || sess;
    if (!options.preview) await stscriptRestorePromptFilters(char, injectSession);
    buildOptions.scriptInjects = await hostPromptPrepare(char, injectSession, options.signal, {
      preview: options.preview === true,
      previewNotes: options.previewNotes,
    });
    buildOptions.signal = options.signal;
    _regexScriptRoundRandom = function (identity) {
      return generationPromptRandom(options.round, 'regex|' + identity);
    };
    requestTarget.regexScopeOpened = true;
    beginRegexScriptSendScope();
    await prepareRegexScriptsForPrompt(char, promptRows, buildOptions.generationTarget);
    await generationPromptWarm(char, promptRows, sess, buildOptions, options);
    var built = await buildMessages(char, promptRows, sess, generationPromptBuildOptions(buildOptions, options.round));
    return {
      built: built,
      // name carries names_behavior=1 speakers and example_user / example_assistant to the API, as in ST.
      messages: built.messages.map(function (m) {
        var message = { role: m.role, content: m.content };
        if (m.name) message.name = m.name;
        return message;
      }),
      baseText: baseText,
      promptTemplateRun: promptTemplateRun,
    };
  } catch (error) {
    if (promptTemplateRun && promptTemplateRun.transaction)
      promptTemplateCancelTransaction(promptTemplateRun.transaction);
    throw error;
  }
}

// The final build reads send regex results and world book regex keys from caches only. A dry build reports what it
// found missing: world book texts the send regex scripts have not transformed and regex keys the Worker has not
// answered. Each answer can activate more entries, so dry builds repeat until one asks for nothing, and the final
// build is that dry build committed.
async function generationPromptWarm(char, rows, sess, buildOptions, options) {
  var none = function () {
      return [];
    },
    textMisses = regexScriptDrainSendMisses,
    keyMisses = worldBookRegexKeyMisses;
  textMisses();
  keyMisses();
  while (true) {
    await buildMessages(
      char,
      rows,
      sess,
      Object.assign(generationPromptBuildOptions(buildOptions, options.round), { commit: false })
    );
    var texts = textMisses(),
      keys = keyMisses();
    if (!texts.length && !keys.length) return;
    if (texts.length) await prepareRegexScriptTexts(char, texts, { signal: options.signal });
    if (keys.length) await prepareWorldBookRegexKeys(char, keys, { signal: options.signal });
    if (options.signal.aborted) throw cardFrontendGenerationAbortError();
  }
}
function generationPromptBuildOptions(options, round) {
  return Object.assign({}, options, {
    random: generationPromptRandom(round, 'macro'),
    worldBookRandom: generationPromptRandom(round, 'worldbook'),
  });
}

// The last passes over the finished message list: the impersonation instruction joins it first, so the template
// and Risu request passes see it like any other message.
async function finalizeGenerationPrompt(char, session, target, result, options, risuOptions) {
  if (target.mode === 'impersonate' && target.impersonationPromptOverride)
    result.messages = result.messages.concat({
      role: 'system',
      content: await replaceCharacterMacros(
        target.impersonationPromptOverride,
        char,
        undefined,
        characterMacroStateForChar(char)
      ),
    });
  result.messages = await promptTemplateProcessGenerationMessages(result.promptTemplateRun, result.messages);
  if (isRisuCharacter(char))
    result.messages = await risuPrepareRequest(char, session, result.messages, target, options.signal, risuOptions);
  return result;
}
