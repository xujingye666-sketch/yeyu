/* global __hostContractHostChar, __hostContractHostSaves, __hostContractHostSession -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const oracle = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/host_write_contract_oracle.json'), 'utf8'));
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  const port = await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  await context.route('https://testingcf.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: route.request().resourceType() === 'stylesheet' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
    body: route.request().url().includes('showdown') ? 'window.showdown={Converter:function(){}};' : '',
  }));
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: '',
  }));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = false;
    D.settings.stscript = {globalVars: {seed: 'global'}};
    D.settings.tavernHelperExtensionSettings = {seed_extension: {seed: 'extension'}};
    D.settings.regexScripts = [];
    D.worldBook = {
      scan_depth: 20,
      token_budget: 0,
      recursive: false,
      caseSensitive: false,
      categories: [],
      globalCategoryIds: [],
      activeCategoryId: '',
    };

    const char = parseCard({name: 'Host Contract Card', first_mes: 'opening'});
    char.id = 'host-contract-char';
    char.scriptsEnabled = true;
    char.regexScripts = [];
    char.extensions = {
      yeyu: {componentImportMode: 'full'},
      tavern_helper: {
        variables: {seed: 'character'},
        scripts: [{
          type: 'script', enabled: true, name: 'Contract Script', id: 'host-contract-script',
          content: 'window.__hostContractHostRuntimeReady=true;window.__hostContractScriptContract={replaceVariables:function(value){return window.replaceVariables(value,{type:"script"});},getVariables:function(){return window.getVariables({type:"script"});},getAllVariables:function(){return window.getAllVariables();},getButtonEvent:function(name){return window.getButtonEvent(name);},getScriptButtons:function(){return window.getScriptButtons();},replaceScriptButtons:function(value){return window.replaceScriptButtons(value);},updateScriptButtonsWith:function(value){return window.updateScriptButtonsWith(value);},appendInexistentScriptButtons:function(value){return window.appendInexistentScriptButtons(value);},getScriptName:function(){return window.getScriptName();},getScriptInfo:function(){return window.getScriptInfo();},replaceScriptInfo:function(value){return window.replaceScriptInfo(value);}};', info: 'seed-info',
          button: {enabled: true, buttons: [{name: 'seed-button', visible: true}]},
          data: {seed: 'script'}, export_with: {data: true, button: true},
          contract_unknown: {preserve: true},
        }],
      },
    };
    const session = createBlankSession('Host Contract Session', 'host-contract-session');
    session.stscriptVars = {seed: 'chat'};
    session.msgs = [
      {role: 'user', content: 'm0', seq: 11, variables: [{legacy_must_not_be_used: true}]},
      {role: 'assistant', content: 'm1', seq: 22, swipes: ['m1', 'm1b'], swipeId: 1},
      {role: 'user', content: 'm2', seq: 33},
    ];
    session.nextMessageSeq = 34;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};

    const preset = presetRawDefault();
    preset.extensions = preset.extensions || {};
    preset.extensions.tavern_helper = {variables: {seed: 'preset'}, scripts: []};
    const presetStore = presetSettingsStore();
    presetStore.chatCompletionPresets = [{name: 'host-contract-preset', preset: structuredClone(preset)}];
    presetStore.activeChatCompletionPresetName = 'host-contract-preset';
    presetStore.chatCompletionPresetInUse = structuredClone(preset);

    D.worldBook.categories = [{
      id: 'host-contract-book-id', name: 'Host Contract Book', ownerCharId: char.id,
      boundCharIds: [char.id], entries: [{id: '7', name: 'seed-world-entry', content: 'seed', keys: ['/hero\\/name/gi'], secondary_keys: ['/side/u'], contract_internal: {preserve: true}, _raw: {extra: {seed_extra: true}}}], contract_unknown: {preserve: true},
    }];
    D.worldBook.globalCategoryIds = ['host-contract-book-id'];
    D.worldBook.activeCategoryId = 'host-contract-book-id';

    window.__hostContractHostChar = char;
    window.__hostContractHostSession = session;
    window.__hostContractHostSaves = [];
    window.__hostContractHostOriginalSaveData = saveData;
    saveData = function(sections, options) {
      (Array.isArray(sections) ? sections : [sections]).forEach(section => window.__hostContractHostSaves.push(String(section)));
      return window.__hostContractHostOriginalSaveData(sections, options);
    };
    window.__hostContractFailWrites = async function(store, draftOnly = false) {
      const persistedBefore = draftOnly ? null : JSON.stringify((await YeyuRepository.load()).data);
      const original = IDBObjectStore.prototype.put;
      const originalSetItem = Storage.prototype.setItem;
      let failures = 0;
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === store && (!draftOnly || String(key).startsWith('stream_draft_v1:'))) {
          failures++;
          throw new DOMException('host contract storage failure', 'QuotaExceededError');
        }
        return original.apply(this, arguments);
      };
      // A primary-store failure alone is recoverable: fail the real recovery snapshot boundary too.
      Storage.prototype.setItem = function(key, value) {
        if (!draftOnly && key === FALLBACK_KEY) throw new DOMException('host contract recovery storage failure', 'QuotaExceededError');
        return originalSetItem.apply(this, arguments);
      };
      return async function() {
        IDBObjectStore.prototype.put = original;
        Storage.prototype.setItem = originalSetItem;
        if (!failures) throw new Error('storage failure probe did not reach ' + store);
        if (!draftOnly && JSON.stringify((await YeyuRepository.load()).data) !== persistedBefore)
          throw new Error('failed host write changed persisted data in ' + store);
      };
    };
    await saveData(['meta', 'characters', 'personas', 'worldbook', 'sessions']);
    window.__hostContractHostSaves.length = 0;
    syncCardScriptLibrary(char);
  });
  await page.waitForFunction(() => _cardScriptLibraryLive && _cardScriptLibraryLive.state === 'ready'
    && _cardScriptLibraryLive.frame.contentWindow.__hostContractHostRuntimeReady === true);

  const previewVariables = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id), helper = _cardScriptLibraryLive.frame.contentWindow.TavernHelper;
    const description = char.description, local = session.macroVars, chat = session.stscriptVars, global = D.settings.stscript.globalVars;
    try {
      helper.replaceVariables({visited: ['initial'], nested: {rows: [{value: 'original'}]}}, {type: 'global'});
      helper.replaceVariables({nested: {rows: [{value: 'original'}]}}, {type: 'chat'});
      session.macroVars = {visited: ['local'], nested: {rows: [{value: 'original'}]}};
      char.description = '{{addglobalvar::visited::preview}}{{addvar::visited::preview}}' +
        '<% getvar("nested", {scope: "global"}).rows[0].value = "changed"; getvar("nested", {scope: "local"}).rows[0].value = "changed" %>';
      await flushPendingSave();
      const state = () => JSON.stringify([session.macroVars, session.stscriptVars, D.settings.stscript.globalVars]);
      const before = state();
      await updateTokensBar(char);
      const tokensUnchanged = state() === before;
      const preview = await buildPresetRoundPreview();
      const previewUnchanged = state() === before;
      await assembleGenerationPrompt(char, session, session.msgs, {charId: char.id, sessionId: session.id, mode: 'new', messageIndex: session.msgs.length}, {});
      const generationCommitted = D.settings.stscript.globalVars.visited === '["initial","preview"]' &&
        D.settings.stscript.globalVars.nested.rows[0].value === 'changed' && session.stscriptVars.nested.rows[0].value === 'changed';
      await flushPendingSave();
      return {tokensUnchanged, previewUnchanged, previewBuilt: !!preview, generationCommitted};
    } finally {
      char.description = description; session.macroVars = local; session.stscriptVars = chat; D.settings.stscript.globalVars = global;
    }
  });
  assert.deepStrictEqual(previewVariables, {tokensUnchanged: true, previewUnchanged: true, previewBuilt: true, generationCommitted: true});

  const result = await page.evaluate(async oracleValue => {
    function check(condition, message) { if (!condition) throw new Error(message); }
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function thenable(value) { return value && typeof value.then === 'function'; }
    function equal(actual, expected, message) {
      check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
    }
    const live = _cardScriptLibraryLive;
    const frame = live.frame.contentWindow;
    const helper = frame.TavernHelper;
    const scriptApi = frame.__hostContractScriptContract;
    const messageEvents = [];
    ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED'].forEach(name => {
      frame.eventOn(frame.tavern_events[name], (messageId, type) => messageEvents.push(type === undefined ? [name, messageId] : [name, messageId, type]));
    });
    const allNames = Object.values(oracleValue.publicGroups).flat();
    const missingUnion = allNames.filter(name => typeof frame[name] !== 'function' && typeof helper[name] !== 'function');
    const missingDirect = oracleValue.exposure.directRequired.filter(name => typeof frame[name] !== 'function');
    const missingHelper = oracleValue.exposure.helperRequiredExceptDirectOnly.filter(name => typeof helper[name] !== 'function');
    equal(missingUnion, [], '66-name union exposure');
    equal(missingDirect, [], 'direct binding exposure');
    equal(missingHelper, [], 'TavernHelper exposure');

    const synchronousReads = [
      ['getChatMessages', () => helper.getChatMessages('0-2')],
      ['getVariables', () => frame.getVariables({type: 'chat'})],
      ['getLorebooks', () => helper.getLorebooks()],
      ['getWorldbookNames', () => helper.getWorldbookNames()],
      ['getScriptTrees', () => helper.getScriptTrees({type: 'character'})],
      ['getTavernRegexes', () => helper.getTavernRegexes()],
    ];
    synchronousReads.forEach(([name, call]) => check(!thenable(call()), `${name} must return synchronously`));
    const loreRead = helper.getLorebookEntries('Host Contract Book');
    check(thenable(loreRead), 'getLorebookEntries must return a Promise');
    await loreRead;
    const noopMessageWrite = helper.setChatMessages([], {refresh: 'none'});
    check(thenable(noopMessageWrite), 'setChatMessages must return a Promise');
    await noopMessageWrite;

    const savedRegexScripts = D.settings.regexScripts;
    D.settings.regexScripts = [
      {id: 'sync-user-prompt', scriptName: 'sync user prompt', disabled: false, findRegex: '/probe/g', replaceString: 'prompt-{{match}}', trimStrings: [], placement: [1], markdownOnly: false, promptOnly: true, minDepth: 0, maxDepth: 0, substituteRegex: 0},
      {id: 'sync-user-display', scriptName: 'sync user display', disabled: false, findRegex: '/probe/g', replaceString: 'display-{{match}}', trimStrings: [], placement: [1], markdownOnly: true, promptOnly: false, substituteRegex: 0},
      {id: 'sync-ai-prompt', scriptName: 'sync ai prompt', disabled: false, findRegex: '/probe/g', replaceString: 'assistant-{{match}}', trimStrings: [], placement: [2], markdownOnly: false, promptOnly: true, substituteRegex: 0},
      {id: 'sync-slash-prompt', scriptName: 'sync slash prompt', disabled: false, findRegex: '/probe/g', replaceString: 'system-{{match}}', trimStrings: [], placement: [3], markdownOnly: false, promptOnly: true, substituteRegex: 0},
    ];
    invalidateRegexScriptRuntimeCache();
    const userPrompt = helper.formatAsTavernRegexedString('probe {{char}}', 'user_input', 'prompt', {depth: 0, character_name: '替代角色'});
    check(typeof userPrompt === 'string' && !thenable(userPrompt), 'formatAsTavernRegexedString must synchronously return a string');
    check(userPrompt === 'prompt-probe 替代角色', `user prompt/depth/character_name mismatch: ${userPrompt}`);
    check(helper.formatAsTavernRegexedString('probe', 'user_input', 'display') === 'display-probe', 'display destination must select only display regexes');
    check(helper.formatAsTavernRegexedString('probe {{char}}', 'user_input', 'prompt', {depth: 1, character_name: '替代角色'}) === 'probe 替代角色', 'depth must filter the prompt regex before host macro replacement');
    check(helper.formatAsTavernRegexedString('probe', 'ai_output', 'prompt') === 'assistant-probe', 'ai_output source mapping failed');
    check(helper.formatAsTavernRegexedString('probe', 'slash_command', 'prompt') === 'system-probe', 'slash_command source mapping failed');
    const failingMacro = /__sync_macro_failure__/g;
    frame.registerMacroLike(failingMacro, () => { throw new Error('sync macro failure'); });
    let formatError = '';
    try { helper.formatAsTavernRegexedString('__sync_macro_failure__', 'reasoning', 'prompt'); }
    catch (error) { formatError = String(error && error.message || error); }
    frame.unregisterMacroLike(failingMacro);
    check(/sync macro failure/.test(formatError), 'synchronous formatter must surface a real macro failure');
    D.settings.regexScripts = savedRegexScripts;
    invalidateRegexScriptRuntimeCache();

    const configuredWorldBook = D.worldBook;
    try {
      D.worldBook = {categories: [], globalCategoryIds: [], activeCategoryId: ''};
      equal(helper.getLorebookSettings(), oracleValue.lorebookSettings.runtimeDefaults, 'missing lorebook settings must use runtime defaults');
    } finally { D.worldBook = configuredWorldBook; }

    const beforeSchema = JSON.stringify(D);
    oracleValue.lifecycle.schemaScopes.forEach(type => helper.registerVariableSchema({opaque: type}, {type}));
    check(JSON.stringify(D) === beforeSchema, 'variable schema metadata must not persist or mutate host master data');
    let schemaScopeError = '';
    try { helper.registerVariableSchema({}, {type: 'script'}); } catch (error) { schemaScopeError = String(error && error.message || error); }
    check(schemaScopeError.length > 0, 'script schema scope must be rejected explicitly');

    const existingSeq = __hostContractHostSession.msgs.map(row => row.seq);
    const createResult = helper.createChatMessages([{role: 'assistant', message: 'inserted', data: {source: 'create'}, extra: {contract_unknown: true}}], {insert_at: 1, refresh: 'none'});
    check(thenable(createResult), 'createChatMessages must return a Promise');
    check(await createResult === undefined, 'createChatMessages must resolve void');
    equal(__hostContractHostSession.msgs.filter(row => existingSeq.includes(row.seq)).map(row => row.seq), existingSeq, 'middle insertion must preserve existing seq identities and order');
    const insertedSeq = __hostContractHostSession.msgs[1].seq;
    check(Number.isInteger(insertedSeq) && insertedSeq > 0 && !existingSeq.includes(insertedSeq), 'middle insertion must allocate one unique positive seq');
    await helper.rotateChatMessages(0, 2, 4, {refresh: 'none'});
    equal(__hostContractHostSession.msgs.map(row => row.seq), [22, 33, 11, insertedSeq], 'rotate must use half-open [begin,middle,end) semantics without renumbering');
    await helper.setChatMessages([{message_id: 0, message: 'first-write'}, {message_id: 0, message: 'last-write'}], {refresh: 'none'});
    check(__hostContractHostSession.msgs[0].content === 'last-write', 'duplicate setChatMessages targets must use the last update');
    await helper.setChatMessage({message: 'deprecated-write'}, 0, {refresh: 'none'});
    check(__hostContractHostSession.msgs[0].swipes[__hostContractHostSession.msgs[0].swipeId || 0] === 'deprecated-write', 'setChatMessage wrapper must update the canonical active swipe');
    const openingBackupMsgs = clone(__hostContractHostSession.msgs);
    const openingBackupIndex = __hostContractHostSession.openingIndex;
    __hostContractHostSession.msgs = [{role: 'assistant', content: 'greet-a', time: Date.now(), opening: true, seq: 91, swipes: ['greet-a', 'greet-b'], swipeId: 0, openingIndex: 0}];
    __hostContractHostSession.openingIndex = 0;
    const openingSwitch = helper.setChatMessage('greet-b', 0, {swipe_id: 1});
    check(thenable(openingSwitch), 'setChatMessage on the opening greeting must return a Promise');
    check(await openingSwitch === true, 'the opening greeting handler must confirm the switch');
    const openingMessage = __hostContractHostSession.msgs[0];
    check(openingMessage.openingIndex === 1, `opening setChatMessage must update message.openingIndex: ${openingMessage.openingIndex}`);
    check(__hostContractHostSession.openingIndex === 1, `opening setChatMessage must update session.openingIndex: ${__hostContractHostSession.openingIndex}`);
    check(openingMessage.content === 'greet-b' && openingMessage.swipeId === 1, 'opening setChatMessage must project the selected greeting');
    await helper.setChatMessage('开场正文改写', 0, {refresh: 'none'});
    check(openingMessage.swipes[1] === '开场正文改写' && openingMessage.content === '开场正文改写', 'a plain opening text edit must reach the generic host write');
    check(openingMessage.openingIndex === 1 && __hostContractHostSession.openingIndex === 1, `a plain opening text edit must keep the opening selection: ${openingMessage.openingIndex}/${__hostContractHostSession.openingIndex}`);
    await helper.setChatMessage('负数下标改写', -1, {refresh: 'none'});
    check(openingMessage.swipes[1] === '负数下标改写', 'setChatMessage must accept a negative opening message id');
    check(await helper.setChatMessage('greet-a', -1, {swipe_id: 0}) === true, 'the opening candidate handoff must resolve a negative message id');
    check(openingMessage.openingIndex === 0 && __hostContractHostSession.openingIndex === 0 && openingMessage.content === 'greet-a', 'the negative-index handoff must select the first greeting');
    await helper.setChatMessages([{message_id: 0, swipe_id: 1}], {refresh: 'none'});
    check(openingMessage.openingIndex === 1 && __hostContractHostSession.openingIndex === 1, `setChatMessages must sync the opening selection: ${openingMessage.openingIndex}/${__hostContractHostSession.openingIndex}`);
    Object.assign(openingMessage, {original_content: 'greet-b', translated: true, continueBase: 'greet-b', futureMessageField: {seed: 1}});
    await helper.setChatMessage('翻译后的开场改写', 0, {refresh: 'none'});
    check(openingMessage.translated === true && openingMessage.original_content === 'greet-b' && openingMessage.continueBase === 'greet-b' && openingMessage.futureMessageField, 'a plain opening text edit must keep translation state and unknown fields');
    check(openingMessage.openingIndex === 1 && openingMessage.swipes[1] === '翻译后的开场改写', 'a plain opening text edit must keep the selected candidate');
    await helper.setChatMessages([{message_id: 0, message: '复数写入改写', swipe_id: 0}], {refresh: 'none'});
    check(openingMessage.translated === true && openingMessage.original_content === 'greet-b', 'a plural patch carrying text must keep the translation flags');
    check(openingMessage.openingIndex === 1 && __hostContractHostSession.openingIndex === 1 && openingMessage.swipes[1] === '复数写入改写', `a plural patch carrying text must keep the opening selection: ${openingMessage.openingIndex}/${__hostContractHostSession.openingIndex}`);
    openingMessage.tavernHelperSwipeInfo = [{api: 'greet-a-info'}, {api: 'greet-b-info'}, {api: 'greet-c-info'}];
    openingMessage.extra = {api: 'greet-b-info'};
    await helper.setChatMessage('第三条开场', 0, {swipe_id: 2});
    check(openingMessage.translated === undefined && openingMessage.original_content === undefined
      && openingMessage.continueBase === undefined && openingMessage.futureMessageField.seed === 1,
      'moving the opening to another candidate must clear candidate display state and preserve unknown fields');
    check(openingMessage.openingIndex === 2 && __hostContractHostSession.openingIndex === 2 && openingMessage.content === '第三条开场',
      'moving the opening candidate must select the new greeting');
    check(openingMessage.extra && openingMessage.extra.api === 'greet-c-info',
      `moving the opening candidate must remap message.extra to that candidate: ${JSON.stringify(openingMessage.extra)}`);
    delete openingMessage.tavernHelperSwipeInfo;
    ['original_content', 'translated', 'continueBase', 'futureMessageField'].forEach(key => delete openingMessage[key]);
    // refresh 'none' 写入开场候选文本，但不得切换激活候选、不得发 MESSAGE_SWIPED；默认 refresh 仍然切换。
    __hostContractHostSession.msgs = [{role: 'assistant', content: 'greet-a', time: Date.now(), opening: true, seq: 92, swipes: ['greet-a', 'greet-b'], swipeId: 0, openingIndex: 0}];
    __hostContractHostSession.openingIndex = 0;
    const quietOpening = __hostContractHostSession.msgs[0];
    messageEvents.length = 0;
    await helper.setChatMessage('greet-b', 0, {swipe_id: 1, refresh: 'none'});
    check(quietOpening.swipeId === 0 && quietOpening.openingIndex === 0 && __hostContractHostSession.openingIndex === 0,
      `refresh 'none' must not move the opening selection: ${quietOpening.swipeId}/${quietOpening.openingIndex}/${__hostContractHostSession.openingIndex}`);
    check(quietOpening.content === 'greet-a' && quietOpening.swipes[1] === 'greet-b',
      `refresh 'none' must write the candidate text without projecting it: ${quietOpening.content}/${quietOpening.swipes[1]}`);
    equal(messageEvents.filter(row => row[0] === 'MESSAGE_SWIPED'), [], `refresh 'none' must not emit MESSAGE_SWIPED`);
    messageEvents.length = 0;
    check(await helper.setChatMessage('greet-b', 0, {swipe_id: 1}) === true, 'the default refresh must still hand the opening switch over');
    check(quietOpening.swipeId === 1 && quietOpening.openingIndex === 1 && __hostContractHostSession.openingIndex === 1 && quietOpening.content === 'greet-b',
      `the default refresh must select the opening candidate: ${quietOpening.swipeId}/${quietOpening.openingIndex}/${__hostContractHostSession.openingIndex}`);
    equal(messageEvents.filter(row => row[0] === 'MESSAGE_SWIPED'), [['MESSAGE_SWIPED', 0]], 'the default refresh must emit exactly one MESSAGE_SWIPED');
    __hostContractHostSession.msgs = openingBackupMsgs;
    if (openingBackupIndex === undefined) delete __hostContractHostSession.openingIndex;
    else __hostContractHostSession.openingIndex = openingBackupIndex;
    await helper.setChatMessage({message: 'non-opening-write'}, 0, {refresh: 'none'});
    check(__hostContractHostSession.msgs[0].opening !== true && __hostContractHostSession.msgs[0].swipes[__hostContractHostSession.msgs[0].swipeId || 0] === 'non-opening-write', 'a non-opening setChatMessage must still go through the generic host write');
    const compactMessage = helper.getChatMessages(0)[0], swipedMessage = helper.getChatMessages(0, {include_swipes: true})[0];
    check(Object.prototype.hasOwnProperty.call(compactMessage, 'message'), 'compact chat reads must include the active message');
    oracleValue.messageSemantics.compactCompatibilityFields.forEach(field => check(Object.prototype.hasOwnProperty.call(compactMessage, field), `compact chat reads must include ${field}`));
    oracleValue.messageSemantics.compactExcludedFields.forEach(field => check(!Object.prototype.hasOwnProperty.call(compactMessage, field), `compact chat reads must exclude ${field}`));
    check(Object.prototype.hasOwnProperty.call(swipedMessage, 'swipes') && !Object.prototype.hasOwnProperty.call(swipedMessage, 'message'), 'swiped chat reads must return ChatMessageSwiped shape only');
    check(helper.getChatMessages('{{lastMessageId}}')[0].message_id === __hostContractHostSession.msgs.length - 1, 'getChatMessages must expand lastMessageId before parsing the range');
    check(helper.getChatMessages('{{allChatRange}}').length === __hostContractHostSession.msgs.length, 'getChatMessages must expand allChatRange before parsing the range');
    const mixedBefore = clone(__hostContractHostSession.msgs[0].swipes);
    await helper.setChatMessages([{message_id: 0, message: 'compact-wins', data: {mixed: true}, swipes: ['must-not-replace']}], {refresh: 'none'});
    check(__hostContractHostSession.msgs[0].content === 'compact-wins' && __hostContractHostSession.msgs[0].swipes.length === mixedBefore.length, 'message/data patch must use the compact branch and ignore swipe-group fields');
    const mixedInfoBefore = JSON.stringify(__hostContractHostSession.msgs[0].tavernHelperSwipeInfo || []);
    await helper.setChatMessages([{message_id: 0, extra: {must_not_write: true}}], {refresh: 'none'});
    check(JSON.stringify(__hostContractHostSession.msgs[0].tavernHelperSwipeInfo || []) === mixedInfoBefore, 'extra-only patch outside the compact message/data branch must be ignored');
    await helper.setChatMessages([{message_id: 0, extra: {must_not_write: true}, swipes: clone(__hostContractHostSession.msgs[0].swipes)}], {refresh: 'none'});
    check(!JSON.stringify(__hostContractHostSession.msgs[0].tavernHelperSwipeInfo || []).includes('must_not_write'), 'extra+swipes patch must not pollute swipe info fallback');
    await helper.setChatMessages([{
      message_id: 0,
      swipe_id: 0,
      swipes: ['only-swipe'],
      swipes_data: [{helper_candidate: 'single', stat_data: {hp: 7}}],
      swipes_info: [{source: 'single'}],
    }], {refresh: 'none'});
    const truncatedMessage = __hostContractHostSession.msgs[0];
    check(truncatedMessage.swipes.length === 1 && truncatedMessage.swipes[0] === 'only-swipe', 'swipe replacement must truncate the stored swipe list');
    check(truncatedMessage.swipeId === 0 && truncatedMessage.content === 'only-swipe', 'swipe truncation must clamp and project the active candidate');
    check(truncatedMessage.tavernHelperSwipeInfo.length === 1, 'swipe replacement must truncate swipe info');
    check(truncatedMessage.yeyuMvu.candidates.length === 1 && truncatedMessage.yeyuMvu.activeIndex === 0, 'swipe replacement must truncate MVU candidates');
    const beforeDelete = __hostContractHostSession.msgs.length;
    await helper.deleteChatMessages([-1, -1], {refresh: 'none'});
    check(__hostContractHostSession.msgs.length === beforeDelete - 1, 'deleteChatMessages must normalize and deduplicate ids');
    const beforeMissingTargets = JSON.stringify(__hostContractHostSession.msgs);
    await helper.setChatMessages([{message_id: 999, message: 'must-not-clamp'}], {refresh: 'none'});
    await helper.setChatMessage({message: 'must-not-clamp'}, 999, {refresh: 'none'});
    await helper.deleteChatMessages([999, -999], {refresh: 'none'});
    check(JSON.stringify(__hostContractHostSession.msgs) === beforeMissingTargets, 'missing message targets must be ignored instead of clamped to an existing message');
    const lifecycleStart = __hostContractHostSession.msgs.length;
    messageEvents.length = 0;
    await helper.createChatMessages([{role: 'user', message: 'event-user'}, {role: 'system', message: 'event-system'}, {role: 'assistant', message: 'event-assistant'}]);
    equal(messageEvents, [
      ['MESSAGE_SENT', lifecycleStart, 'extension'],
      ['USER_MESSAGE_RENDERED', lifecycleStart],
      ['MESSAGE_RECEIVED', lifecycleStart + 1, 'extension'],
      ['CHARACTER_MESSAGE_RENDERED', lifecycleStart + 1],
      ['MESSAGE_RECEIVED', lifecycleStart + 2, 'extension'],
      ['CHARACTER_MESSAGE_RENDERED', lifecycleStart + 2],
    ], 'createChatMessages lifecycle event order');
    messageEvents.length = 0;
    await helper.createChatMessages([{role: 'assistant', message: 'quiet-none'}], {refresh: 'none'});
    await helper.createChatMessages([{role: 'user', message: 'quiet-all'}], {refresh: 'all'});
    equal(messageEvents, [], `createChatMessages with refresh 'none' or 'all' emits no message events`);

    const scopeCases = [
      ['global', {type: 'global'}],
      ['character', {type: 'character'}],
      ['preset', {type: 'preset'}],
      ['chat', {type: 'chat'}],
      ['extension', {type: 'extension', extension_id: 'host_contract_extension'}],
    ];
    scopeCases.forEach(([name, option]) => {
      const output = frame.replaceVariables({scope: name, nested: {value: 1}}, option);
      check(output === undefined, `replaceVariables(${name}) must return void synchronously`);
      equal(frame.getVariables(option), {scope: name, nested: {value: 1}}, `${name} variable roundtrip`);
    });
    scriptApi.replaceVariables({scope: 'script', nested: {value: 1}});
    equal(scriptApi.getVariables(), {scope: 'script', nested: {value: 1}}, 'script variable roundtrip');
    equal(D.settings.stscript.globalVars, {scope: 'global', nested: {value: 1}}, 'global variable master owner');
    equal(__hostContractHostSession.stscriptVars, {scope: 'chat', nested: {value: 1}}, 'chat variable master owner');
    equal(__hostContractHostChar.extensions.tavern_helper.variables, {scope: 'character', nested: {value: 1}}, 'character variable master owner');
    equal(D.settings.tavernHelperExtensionSettings.host_contract_extension, {scope: 'extension', nested: {value: 1}}, 'extension variable master owner');
    check(!Object.prototype.hasOwnProperty.call(frame.extension_settings, 'host_contract_extension'), 'library frame must retain its initial extension_settings snapshot for the merge counterexample');
    await frame.saveSettings();
    equal(D.settings.tavernHelperExtensionSettings.host_contract_extension, {scope: 'extension', nested: {value: 1}}, 'saveSettings from an old snapshot must preserve a newly added host branch');
    check(frame.saveSettingsDebounced() === undefined, 'saveSettingsDebounced must return void');
    await new Promise(resolve => setTimeout(resolve, 0));
    equal(D.settings.tavernHelperExtensionSettings.host_contract_extension, {scope: 'extension', nested: {value: 1}}, 'saveSettingsDebounced from an old snapshot must preserve a newly added host branch');
    const projectedMessageVariables = {
      helper_only: {keep: true},
      stat_data: {hp: 17},
      schema: {type: 'object'},
      display_data: {hp: '17'},
      delta_data: {hp: 1},
    };
    check(frame.replaceVariables(projectedMessageVariables, {type: 'message', message_id: 0}) === undefined, 'message replaceVariables must return void synchronously');
    equal(frame.getVariables({type: 'message', message_id: 0}), projectedMessageVariables, 'message variable official projection roundtrip');
    const messageRecord = __hostContractHostSession.msgs[0].yeyuMvu;
    const activeCandidate = messageRecord && messageRecord.candidates && messageRecord.candidates[messageRecord.activeIndex || 0];
    equal(activeCandidate && activeCandidate.variables, {helper_only: {keep: true}}, 'message helper fields must exclude reserved MVU projection keys');
    equal(activeCandidate && activeCandidate.state, {hp: 17}, 'message stat_data canonical MVU owner');
    equal(activeCandidate && activeCandidate.schema, {type: 'object'}, 'message schema canonical MVU owner');
    equal(activeCandidate && activeCandidate.display, {hp: '17'}, 'message display_data canonical MVU owner');
    equal(activeCandidate && activeCandidate.delta, {hp: 1}, 'message delta_data canonical MVU owner');
    check(!Object.prototype.hasOwnProperty.call(__hostContractHostSession.msgs[0], 'variables'), 'message variable bridge must not create message.variables');
    const legacyVariableMessage = __hostContractHostSession.msgs.find(row => row.seq === 11);
    check(legacyVariableMessage.variables[0].legacy_must_not_be_used === true, 'message variable bridge must leave unrelated legacy message.variables untouched');
    equal(presetSettingsStore().chatCompletionPresetInUse.extensions.tavern_helper.variables, {scope: 'preset', nested: {value: 1}}, 'preset variable master owner');
    const activeNamedPreset = presetSettingsStore().chatCompletionPresets.find(row => row.name === presetSettingsStore().activeChatCompletionPresetName);
    equal(activeNamedPreset.preset.extensions.tavern_helper.variables, presetSettingsStore().chatCompletionPresetInUse.extensions.tavern_helper.variables, 'active preset variable writes must synchronize named and in-use copies');
    // Like JS-Slash-Runner, preset-scope writes without a named preset apply to the default in use. They are kept as
    // the default's extensions only: the rest of the default is still generated from presetRawDefault(), so version
    // updates of the default (protected prompts included) keep reaching the user after a card script has written.
    const presetStoreForDefaultProbe = presetSettingsStore();
    const presetActiveNameBeforeProbe = presetStoreForDefaultProbe.activeChatCompletionPresetName;
    const presetInUseBeforeProbe = presetStoreForDefaultProbe.chatCompletionPresetInUse;
    const namedPresetBeforeDefaultProbe = JSON.stringify(activeNamedPreset.preset);
    const namedPresetCountBeforeProbe = presetStoreForDefaultProbe.chatCompletionPresets.length;
    const defaultRegex = {id: 'default-regex', script_name: 'Default Regex', enabled: true, find_regex: '/DEFAULT_FIND/g', replace_string: 'DEFAULT_REPLACED', source: {user_input: false, ai_output: true, slash_command: false, world_info: false}, destination: {display: true, prompt: false}, run_on_edit: false, min_depth: null, max_depth: null};
    const defaultScript = {type: 'script', enabled: false, name: 'Default Script', id: 'default-script', content: '', info: '', button: {enabled: false, buttons: []}, data: {}};
    const withoutExtensions = raw => JSON.stringify(Object.assign({}, raw, {extensions: null}));
    const originalPresetRawDefault = presetRawDefault;
    let restoreDefaultStorage = null;
    try {
      presetStoreForDefaultProbe.activeChatCompletionPresetName = '';
      presetStoreForDefaultProbe.chatCompletionPresetInUse = null;
      frame.replaceVariables({default_owner: true}, {type: 'preset'});
      await helper.replaceTavernRegexes([defaultRegex], {type: 'preset'});
      helper.replaceScriptTrees([defaultScript], {type: 'preset'});
      await new Promise(resolve => setTimeout(resolve, 0));
      check(presetStoreForDefaultProbe.chatCompletionPresetInUse === null && presetStoreForDefaultProbe.activeChatCompletionPresetName === '', 'default-mode preset writes must not freeze the default into an unnamed active raw');
      equal(frame.getVariables({type: 'preset'}), {default_owner: true}, 'default-mode preset variables must read back');
      const effectiveDefault = activeCompletionPresetRaw();
      equal(effectiveDefault.extensions.tavern_helper.variables, {default_owner: true}, 'default-mode preset variables must apply to the default');
      check(effectiveDefault.extensions.regex_scripts.map(row => row.id).join() === 'default-regex', 'default-mode Regex writes must apply to the default');
      check(effectiveRegexScriptRows(getChar()).some(row => row.scope === 'preset' && row.script.id === 'default-regex'), 'default-mode Regex writes must reach the Regex runtime');
      check(effectiveDefault.extensions.tavern_helper.scripts.map(row => row.id).join() === 'default-script', 'default-mode script writes must apply to the default');
      check(withoutExtensions(effectiveDefault) === withoutExtensions(presetRawDefault()), 'the rest of the default must stay the generated default');
      await flushPendingSave();
      const persistedDefault = (await YeyuRepository.load()).data.settings;
      check(persistedDefault.chatCompletionPresetInUse === null && JSON.stringify(persistedDefault).includes('default-regex') && JSON.stringify(persistedDefault).includes('default-script') && JSON.stringify(persistedDefault).includes('default_owner'), 'default-mode writes must persist with the settings');
      presetRawDefault = function () {
        const next = originalPresetRawDefault();
        next.prompts.find(row => row.identifier === '785b0a28-36f7-4b16-9ef7-64db5e1304e6').content = 'UPDATED_DEFAULT_FRAMEWORK';
        return next;
      };
      check(activeCompletionPresetRaw().prompts.find(row => row.identifier === '785b0a28-36f7-4b16-9ef7-64db5e1304e6').content === 'UPDATED_DEFAULT_FRAMEWORK', 'a later default update must still reach the user after default-mode writes');
      equal(activeCompletionPresetRaw().extensions.tavern_helper.variables, {default_owner: true}, 'default-mode writes must survive a default update');
      presetRawDefault = originalPresetRawDefault;
      await flushPendingSave();
      const beforeFailedWrite = JSON.stringify(presetStoreForDefaultProbe);
      restoreDefaultStorage = await window.__hostContractFailWrites('app_meta');
      const failedDefaultWrite = await helper.replaceTavernRegexes([], {type: 'preset'}).then(() => false, () => true);
      if (restoreDefaultStorage) { await restoreDefaultStorage(); restoreDefaultStorage = null; }
      check(failedDefaultWrite && JSON.stringify(presetStoreForDefaultProbe) === beforeFailedWrite, 'a failed default-mode write must leave the settings as before');
      presetStoreForDefaultProbe.activeChatCompletionPresetName = '';
      presetStoreForDefaultProbe.chatCompletionPresetInUse = null;
      delete presetStoreForDefaultProbe.chatCompletionPresetDefaultExtensions;
      await flushPendingSave();
      const pristineDefault = JSON.stringify(presetStoreForDefaultProbe);
      restoreDefaultStorage = await window.__hostContractFailWrites('app_meta');
      const failedFirstWrite = await helper.replaceTavernRegexes([defaultRegex], {type: 'preset'}).then(() => false, () => true);
      if (restoreDefaultStorage) { await restoreDefaultStorage(); restoreDefaultStorage = null; }
      check(failedFirstWrite && presetStoreForDefaultProbe.chatCompletionPresetInUse === null && withoutExtensions(activeCompletionPresetRaw()) === withoutExtensions(presetRawDefault()) && !JSON.stringify(presetStoreForDefaultProbe).includes('default-regex'), 'a failed first default-mode write must not freeze the default or keep its rows');
      check(JSON.stringify(presetStoreForDefaultProbe) === pristineDefault, 'a failed first default-mode write must leave the settings as before');
      check(presetStoreForDefaultProbe.chatCompletionPresets.length === namedPresetCountBeforeProbe, 'default-mode writes must not create a named preset');
      check(JSON.stringify(activeNamedPreset.preset) === namedPresetBeforeDefaultProbe, 'default-mode writes must not mutate a named preset');
    } finally {
      presetRawDefault = originalPresetRawDefault;
      if (restoreDefaultStorage) { await restoreDefaultStorage(); restoreDefaultStorage = null; }
      presetStoreForDefaultProbe.activeChatCompletionPresetName = presetActiveNameBeforeProbe;
      presetStoreForDefaultProbe.chatCompletionPresetInUse = presetInUseBeforeProbe;
      delete presetStoreForDefaultProbe.chatCompletionPresetDefaultExtensions;
    }

    const syncUpdate = frame.updateVariablesWith(value => Object.assign(value, {sync_update: true}), {type: 'chat'});
    check(!thenable(syncUpdate) && syncUpdate.sync_update === true, 'synchronous variable updater must remain synchronous');
    const asyncUpdate = frame.updateVariablesWith(async value => Object.assign(value, {async_update: true}), {type: 'chat'});
    check(thenable(asyncUpdate), 'asynchronous variable updater must return a Promise');
    await asyncUpdate;
    const insertAssigned = frame.insertOrAssignVariables({array: ['new'], nested: {assigned: true}}, {type: 'chat'});
    const inserted = frame.insertVariables({array: ['fallback'], nested: {value: 99, inserted: true}}, {type: 'chat'});
    equal(insertAssigned.array, ['new'], 'insertOrAssignVariables array direction');
    equal(inserted.array, ['new'], 'insertVariables must preserve an existing array');
    check(inserted.nested.value === 1 && inserted.nested.inserted === true, 'insertVariables must fill missing values without replacing existing values');
    const deletion = frame.deleteVariable('nested.inserted', {type: 'chat'});
    check(deletion.delete_occurred === true && deletion.variables.nested.inserted === undefined, 'deleteVariable must report and persist deletion');
    const allVariables = scriptApi.getAllVariables();
    check(allVariables.scope === 'chat', 'script iframe aggregate must stop after global→character→script→chat and exclude message variables');

    const createdLore = await helper.createLorebookEntries('Host Contract Book', [{comment: 'first', content: 'one', contract_unknown: {preserve: true}}]);
    equal(createdLore.new_uids, [0], 'lorebook create must allocate the smallest free uid');
    {
      // TavernHelper toLorebookEntry exposes only the public fields; a position/role write reaches the
      // SillyTavern view, and _raw keeps unknown fields without the public field names.
      const publicFields = ['uid', 'display_index', 'comment', 'enabled', 'type', 'position', 'depth', 'order', 'probability', 'key', 'keys', 'logic', 'filter', 'filters', 'scan_depth', 'case_sensitive', 'match_whole_words', 'use_group_scoring', 'automation_id', 'exclude_recursion', 'prevent_recursion', 'delay_until_recursion', 'content', 'group', 'group_prioritized', 'group_weight', 'sticky', 'cooldown', 'delay'];
      const created = (await helper.getLorebookEntries('Host Contract Book')).find(entry => entry.uid === 0);
      equal(Object.keys(created).sort(), publicFields.slice().sort(), 'getLorebookEntries must expose only TavernHelper public fields');
      await helper.setLorebookEntries('Host Contract Book', [{uid: 0, position: 'at_depth_as_user', depth: 1}]);
      const projected = (await frame.SillyTavern.loadWorldInfo('Host Contract Book')).entries['0'];
      equal([projected.position, projected.role, projected.depth], [4, 1, 1], 'loadWorldInfo must follow a TavernHelper position write');
      const stored = D.worldBook.categories.find(row => row.name === 'Host Contract Book').entries.find(row => row.id === '0');
      check(stored._raw.contract_unknown.preserve === true && !('position' in stored._raw) && !('enabled' in stored._raw), 'TavernHelper writes keep unknown fields in _raw without public field names');
    }
    const beforeMissingLoreSet = (await helper.getLorebookEntries('Host Contract Book')).length;
    await helper.setLorebookEntries('Host Contract Book', [{uid: 9999, content: 'ignored'}]);
    check((await helper.getLorebookEntries('Host Contract Book')).length === beforeMissingLoreSet, 'setLorebookEntries must silently ignore a missing uid');
    await helper.updateLorebookEntriesWith('Host Contract Book', entries => entries.map(entry => Object.assign(entry, {content: 'updated'})));
    check((await helper.getLorebookEntries('Host Contract Book'))[0].content === 'updated', 'lorebook updater must commit to the canonical category');
    const singularUid = await helper.createLorebookEntry('Host Contract Book', {comment: 'second', content: 'two'});
    check(singularUid === 1, 'deprecated lorebook create wrapper must share uid allocation');
    check(await helper.deleteLorebookEntry('Host Contract Book', singularUid) === true, 'deprecated lorebook delete wrapper must share canonical deletion');
    const loreDelete = await helper.deleteLorebookEntries('Host Contract Book', [9999]);
    check(loreDelete.delete_occurred === false, 'deleting missing lorebook ids must be a stable no-op');

    check(await helper.createLorebook('Host Created Book') === true, 'createLorebook must report creation');
    await helper.createLorebookEntries('Host Created Book', [{comment: 'old', content: 'old body'}]);
    await helper.replaceLorebookEntries('Host Created Book', [{uid: 7, comment: 'replacement', content: 'replacement body'}]);
    const replacedLore = await helper.getLorebookEntries('Host Created Book');
    equal(replacedLore.map(entry => [entry.uid, entry.comment, entry.content]), [[7, 'replacement', 'replacement body']], 'replaceLorebookEntries must replace the complete entry list');
    check(await helper.createLorebook('Host Created Book') === false, 'createLorebook must report existing names');
    check(helper.setLorebookSettings({selected_global_lorebooks: ['Host Contract Book']}) === undefined, 'setLorebookSettings must return void synchronously');
    equal(helper.getGlobalWorldbookNames(), ['Host Contract Book'], 'global worldbook binding');
    {
      const savedWorldbook = D.worldBook;
      const savedToast = toast;
      const notices = [];
      D.worldBook = {
        token_budget: 1, categories: [{id: 'overflow', name: 'Overflow', enabled: true,
          entries: [{id: 'entry', enabled: true, constant: true, content: 'Budget overflow fixture'}]}],
        globalCategoryIds: ['overflow'],
      };
      toast = (...args) => { notices.push(args[0]); return savedToast(...args); };
      try {
        helper.setLorebookSettings({overflow_alert: true});
        check(helper.getLorebookSettings().overflow_alert === true, 'overflow alert must round trip');
        resolveWorldBook([], __hostContractHostChar.id, __hostContractHostSession, {commitRuntime: false});
        check(notices.length === 0, 'preview must not show an overflow notice');
        resolveWorldBook([], __hostContractHostChar.id, __hostContractHostSession, {commitRuntime: true});
        check(notices.length === 1, 'committed budget overflow must show one notice');
        helper.setLorebookSettings({overflow_alert: false});
        resolveWorldBook([], __hostContractHostChar.id, __hostContractHostSession, {commitRuntime: true});
        check(notices.length === 1, 'disabled overflow alert must stay quiet');
      } finally { D.worldBook = savedWorldbook; toast = savedToast; }
    }
    await helper.setCurrentCharLorebooks({primary: 'Host Contract Book', additional: ['Host Contract Book']});
    check(helper.getCurrentCharPrimaryLorebook() === 'Host Contract Book', 'character primary lorebook binding');
    await helper.setChatLorebook('Host Contract Book');
    check(helper.getChatLorebook() === 'Host Contract Book', 'chat lorebook binding');
    await helper.rebindGlobalWorldbooks(['Host Contract Book']);
    await helper.rebindCharWorldbooks('current', {primary: 'Host Contract Book', additional: ['Host Contract Book']});
    await helper.rebindChatWorldbook('current', 'Host Contract Book');
    check(helper.getChatWorldbookName('current') === 'Host Contract Book', 'worldbook facade chat binding');
    await helper.setLorebookEntries('Host Contract Book', [{uid: 0, order: 0}]);
    const worldEntries = await helper.getWorldbook('Host Contract Book');
    const worldOwner = D.worldBook.categories.find(row => row.name === 'Host Contract Book');
    const ownerBeforeRoundtrip = JSON.stringify({id: worldOwner.id, boundCharIds: worldOwner.boundCharIds});
    const worldOrderBeforeRoundtrip = worldEntries.map(row => row.uid);
    const regexWorldEntry = worldEntries.find(row => row.uid === 7);
    const primaryWorldKey = regexWorldEntry && regexWorldEntry.strategy.keys[0];
    const secondaryWorldKey = regexWorldEntry && regexWorldEntry.strategy.keys_secondary.keys[0];
    check(Object.prototype.toString.call(primaryWorldKey) === '[object RegExp]' && primaryWorldKey.source === 'hero\\/name' && primaryWorldKey.flags === 'gi', 'worldbook primary RegExp key must preserve source and flags');
    check(Object.prototype.toString.call(secondaryWorldKey) === '[object RegExp]' && secondaryWorldKey.source === 'side' && secondaryWorldKey.flags === 'u', 'worldbook secondary RegExp key must preserve source and flags');
    await helper.replaceWorldbook('Host Contract Book', worldEntries);
    const preservedWorldEntry = D.worldBook.categories[0].entries.find(row => String(row.id) === '7');
    const replacedWorldEntry = (await helper.getWorldbook('Host Contract Book')).find(row => row.uid === 7);
    const replacedWorldEntries = await helper.getWorldbook('Host Contract Book');
    equal(replacedWorldEntries.map(row => row.uid), worldOrderBeforeRoundtrip, 'worldbook round trip must preserve row order');
    check(replacedWorldEntries.find(row => row.uid === 0).position.order === 0, 'worldbook round trip must preserve zero order');
    check(JSON.stringify({id: worldOwner.id, boundCharIds: worldOwner.boundCharIds}) === ownerBeforeRoundtrip, 'worldbook round trip must preserve owner');
    check(preservedWorldEntry.contract_internal.preserve === true && replacedWorldEntry.extra.seed_extra === true, 'worldbook replacement must preserve internal unknown fields and public extra');
    const replacedPrimaryKey = replacedWorldEntry.strategy.keys[0], replacedSecondaryKey = replacedWorldEntry.strategy.keys_secondary.keys[0];
    check(Object.prototype.toString.call(replacedPrimaryKey) === '[object RegExp]' && replacedPrimaryKey.source === primaryWorldKey.source && replacedPrimaryKey.flags === primaryWorldKey.flags, 'worldbook primary RegExp key must survive get-replace-get');
    check(Object.prototype.toString.call(replacedSecondaryKey) === '[object RegExp]' && replacedSecondaryKey.source === secondaryWorldKey.source && replacedSecondaryKey.flags === secondaryWorldKey.flags, 'worldbook secondary RegExp key must survive get-replace-get');
    await helper.updateWorldbookWith('Host Contract Book', rows => rows);
    const addedWorld = await helper.createWorldbookEntries('Host Contract Book', [{name: 'world-added', content: 'world', extra: {contract_unknown: true}}]);
    check(addedWorld.new_entries.length === 1, 'worldbook entry facade must return the created rows');
    const removedWorld = await helper.deleteWorldbookEntries('Host Contract Book', entry => entry.name === 'world-added');
    check(removedWorld.deleted_entries.length === 1, 'worldbook entry facade must return deleted rows');
    check(await helper.createWorldbook('Host Worldbook Facade', []) === true, 'worldbook facade create');
    check(await helper.createOrReplaceWorldbook('Host Worldbook Facade', []) === false, 'worldbook facade replace must report existing name');
    check(await helper.deleteWorldbook('Host Worldbook Facade') === true, 'worldbook facade delete');
    check(await helper.deleteLorebook('Host Created Book') === true, 'lorebook delete');

    const boundWorldbook = D.worldBook.categories.find(row => row.name === 'Host Contract Book');
    const boundWorldbookId = boundWorldbook.id;
    const globalIdsBeforeRename = clone(D.worldBook.globalCategoryIds);
    const additionalIdsBeforeRename = clone(boundWorldbook.boundCharIds);
    const originalWorldbookRenderOwners = {scheduleWBRenderPrewarm, renderWBAll, renderWBSidebar, updateChatUI};
    const worldbookRenderCalls = {prewarm: 0, all: 0, sidebar: 0, chat: 0};
    scheduleWBRenderPrewarm = function(...args) { worldbookRenderCalls.prewarm++; return originalWorldbookRenderOwners.scheduleWBRenderPrewarm.apply(this, args); };
    renderWBAll = function(...args) { worldbookRenderCalls.all++; return originalWorldbookRenderOwners.renderWBAll.apply(this, args); };
    renderWBSidebar = function(...args) { worldbookRenderCalls.sidebar++; return originalWorldbookRenderOwners.renderWBSidebar.apply(this, args); };
    updateChatUI = function(...args) { worldbookRenderCalls.chat++; return originalWorldbookRenderOwners.updateChatUI.apply(this, args); };
    try {
      check(await hostWriteRenameWorldbook('Host Contract Book', 'Host Renamed Book') === true, 'worldbook rename must report a changed name');
      check(__hostContractHostChar.extensions.world === 'Host Renamed Book' && __hostContractHostSession.tavernHelperChatLorebook === 'Host Renamed Book', 'worldbook rename must update primary and chat name bindings');
      equal(D.worldBook.globalCategoryIds, globalIdsBeforeRename, 'worldbook rename must preserve global id bindings');
      equal(D.worldBook.categories.find(row => row.id === boundWorldbookId).boundCharIds, additionalIdsBeforeRename, 'worldbook rename must preserve additional character id bindings');
      check(Object.values(worldbookRenderCalls).every(count => count === 1), 'worldbook rename must call the complete runtime render owner');
      const renderCallsAfterRename = clone(worldbookRenderCalls);
      check(await helper.deleteWorldbook('Host Renamed Book') === true, 'renamed worldbook must remain deletable through the public facade');
      check(!D.worldBook.categories.some(row => row.id === boundWorldbookId), 'worldbook delete must remove the canonical category');
      check(!D.worldBook.globalCategoryIds.includes(boundWorldbookId), 'worldbook delete must clear global id bindings');
      check(!Object.prototype.hasOwnProperty.call(__hostContractHostChar.extensions, 'world') && __hostContractHostSession.tavernHelperChatLorebook === undefined, 'worldbook delete must clear primary and chat bindings');
      check(Object.keys(worldbookRenderCalls).every(key => worldbookRenderCalls[key] === renderCallsAfterRename[key] + 1), 'worldbook delete must call the complete runtime render owner');
    } finally {
      scheduleWBRenderPrewarm = originalWorldbookRenderOwners.scheduleWBRenderPrewarm;
      renderWBAll = originalWorldbookRenderOwners.renderWBAll;
      renderWBSidebar = originalWorldbookRenderOwners.renderWBSidebar;
      updateChatUI = originalWorldbookRenderOwners.updateChatUI;
    }

    const characterTrees = helper.getScriptTrees({type: 'character'});
    check(!thenable(characterTrees) && characterTrees.length === 1, 'character script tree must be synchronous and read the canonical card tree');
    check(characterTrees[0].contract_unknown.preserve === true, 'script tree unknown fields must roundtrip');
    const originalCharacterExtensions = __hostContractHostChar.extensions;
    const wrappedScript = {wrapper_unknown: {preserve: true}, value: {type: 'script', id: 'host-contract-wrapped-script', name: 'Wrapped Script', enabled: true, content: 'window.__wrapped=true;', data: {wrapped: true}}};
    const characterContainerCases = [
      ['extensions.tavern_helper.scripts', {tavern_helper: {scripts: [clone(wrappedScript)]}}],
      ['extensions.tavern_helper[scripts]', {tavern_helper: [['scripts', [clone(wrappedScript)]]]}],
      ['extensions.TavernHelper_scripts', {TavernHelper_scripts: [clone(wrappedScript)]}],
    ];
    try {
      characterContainerCases.forEach(([source, extensions]) => {
        __hostContractHostChar.extensions = extensions;
        const rawTree = helper.getScriptTrees({type: 'character'});
        check(rawTree.length === 1 && rawTree[0].value.id === 'host-contract-wrapped-script', `${source} must expose its wrapped script tree`);
        const containerBeforeWrite = cardScriptTavernHelperContainer(__hostContractHostChar.extensions, false);
        const ownerRows = containerBeforeWrite.rows;
        rawTree[0].value.data = {wrapped: true, writeback: source};
        rawTree[0].value.info = `written:${source}`;
        check(helper.replaceScriptTrees(rawTree, {type: 'character'}) === undefined, `${source} replaceScriptTrees must return void`);
        const containerAfterWrite = cardScriptTavernHelperContainer(__hostContractHostChar.extensions, false);
        check(containerAfterWrite.rows === ownerRows, `${source} writes must retain the detected owner container`);
        const helperContainer = __hostContractHostChar.extensions.tavern_helper;
        const presentContainers = [
          !!(helperContainer && !Array.isArray(helperContainer) && Array.isArray(helperContainer.scripts)),
          !!(Array.isArray(helperContainer) && helperContainer.some(row => Array.isArray(row) && row[0] === 'scripts' && Array.isArray(row[1]))),
          Array.isArray(__hostContractHostChar.extensions.TavernHelper_scripts),
        ].filter(Boolean).length;
        check(presentContainers === 1, `${source} writes must not create a second script container`);
        const discovered = cardScriptTavernHelperRows(__hostContractHostChar).find(row => row.id === 'host-contract-wrapped-script');
        const scanned = cardFrontendAllScriptRows(__hostContractHostChar).find(row => row.scope === 'character' && row.id === 'host-contract-wrapped-script');
        check(discovered && discovered.source === source && discovered.data.writeback === source, `${source} must discover the written nested value payload`);
        check(scanned && scanned.data.writeback === source, `${source} must expose the written nested value payload to the host write scanner`);
        check(discovered.raw.wrapper_unknown.preserve === true && scanned.raw.value.id === 'host-contract-wrapped-script', `${source} must preserve the outer wrapper`);
      });
    } finally { __hostContractHostChar.extensions = originalCharacterExtensions; }
    const buttonEvent = scriptApi.getButtonEvent('contract-button');
    check(buttonEvent.startsWith('host-contract-script_') && buttonEvent !== 'host-contract-script_contract-button', 'button event id must use the reference hash shape');
    check(scriptApi.replaceScriptButtons([{name: 'contract-button', visible: true}]) === undefined, 'replaceScriptButtons must return void synchronously');
    scriptApi.replaceScriptInfo('contract-info');
    equal(scriptApi.getScriptButtons(), [{name: 'contract-button', visible: true}], 'script buttons roundtrip');
    check(scriptApi.getScriptInfo() === 'contract-info' && scriptApi.getScriptName() === 'Contract Script', 'script name/info owner');
    const buttonUpdate = scriptApi.updateScriptButtonsWith(async buttons => buttons.concat({name: 'async-button', visible: false}));
    check(thenable(buttonUpdate), 'async script button updater must return a Promise');
    await buttonUpdate;
    scriptApi.appendInexistentScriptButtons([{name: 'async-button', visible: true}, {name: 'new-button', visible: true}]);
    check(scriptApi.getScriptButtons().filter(row => row.name === 'async-button').length === 1, 'appendInexistentScriptButtons must deduplicate by name');
    check(Object.keys(helper.getAllEnabledScriptButtons()).length >= 1, 'enabled script button map must be available synchronously');
    const regex = {
      id: 'host-contract-regex', script_name: 'contract-regex', enabled: true,
      find_regex: 'a', trim_strings: [], replace_string: 'b',
      source: {user_input: true, ai_output: false, slash_command: false, world_info: false, reasoning: false},
      destination: {display: false, prompt: true}, run_on_edit: false,
      min_depth: null, max_depth: null, contract_unknown: {preserve: true},
    };
    const regexWrite = helper.replaceTavernRegexes([regex], {type: 'global'});
    check(thenable(regexWrite), 'replaceTavernRegexes must return a Promise');
    await regexWrite;
    let regexRows = helper.getTavernRegexes({type: 'global'});
    check(!thenable(regexRows) && regexRows.length === 1 && regexRows[0].contract_unknown.preserve === true, 'global Regex sync read and unknown-field roundtrip');
    const regexUnknownBefore = clone(D.settings.regexScripts[0].raw.contract_unknown);
    const regexNoopRows = await helper.updateTavernRegexesWith(rows => rows, {type: 'global'});
    check(regexNoopRows.length === 1, 'Regex no-op updater must return the canonical rows');
    check(helper.getTavernRegexes({type: 'global'})[0].contract_unknown.preserve === true, 'Regex no-op updater must preserve unknown fields through the public getter');
    equal(D.settings.regexScripts[0].raw.contract_unknown, regexUnknownBefore, 'Regex no-op updater must preserve canonical row.raw unknown fields');
    await helper.updateTavernRegexesWith(rows => rows.map(row => Object.assign(row, {replace_string: 'c'})), {type: 'global'});
    regexRows = helper.getTavernRegexes({type: 'global'});
    check(regexRows[0].replace_string === 'c', 'Regex updater must commit to the canonical global list');
    // User choice over upstream: global rows a card script writes belong to its character.
    const ownRegex = D.settings.regexScripts[0];
    check(ownRegex.ownerCharacterId === __hostContractHostChar.id && ownRegex.imported === false, 'card-written global Regex must belong to the writing character without an imported mark');
    const userRegex = normalizeRegexScriptRecord({id: 'host-contract-user-regex', name: 'user-regex', findRegex: 'u', replaceString: 'v', targetUser: true, applySend: true, enabled: true});
    const otherRegex = normalizeRegexScriptRecord({id: 'host-contract-regex', name: 'other-owner', findRegex: 'o', replaceString: 'p', targetUser: true, applySend: true, enabled: true, ownerCharacterId: 'host-contract-other-char'});
    D.settings.regexScripts = [userRegex, otherRegex, ownRegex];
    const userRegexBefore = JSON.stringify(userRegex);
    equal(helper.getTavernRegexes({type: 'global'}).map(row => row.id), ['host-contract-user-regex', 'host-contract-regex'], 'global Regex read must show user rows and this character rows only');
    await helper.replaceTavernRegexes(helper.getTavernRegexes({type: 'global'}).reverse(), {type: 'global'});
    check(D.settings.regexScripts.length === 3 && D.settings.regexScripts[1] === otherRegex && D.settings.regexScripts[2] === userRegex && JSON.stringify(userRegex) === userRegexBefore, 'global Regex replace must keep other characters rows in place and leave unchanged user rows as stored');
    check(!effectiveRegexScriptRows(__hostContractHostChar).some(row => row.script === otherRegex), 'another character global Regex must not apply to this character');
    D.settings.regexScripts = [D.settings.regexScripts[0]];
    const presetRegex = Object.assign({}, regex, {id: 'host-contract-preset-regex', script_name: 'preset-contract-regex'});
    await helper.replaceTavernRegexes([presetRegex], {type: 'preset'});
    equal(activeNamedPreset.preset.extensions.regex_scripts, presetSettingsStore().chatCompletionPresetInUse.extensions.regex_scripts, 'active preset Regex writes must synchronize named and in-use raw copies');
    check(activeNamedPreset.preset.extensions.regex_scripts.length === 1 && activeNamedPreset.preset.extensions.regex_scripts[0].id === 'host-contract-preset-regex', 'preset Regex must use raw extensions.regex_scripts as its canonical owner');
    check(helper.getTavernRegexes({type: 'preset'})[0].contract_unknown.preserve === true, 'preset Regex public getter must preserve unknown fields');
    const presetRegexUnknownBefore = clone(activeNamedPreset.preset.extensions.regex_scripts[0].contract_unknown);
    await helper.updateTavernRegexesWith(rows => rows, {type: 'preset'});
    equal(activeNamedPreset.preset.extensions.regex_scripts[0].contract_unknown, presetRegexUnknownBefore, 'preset Regex no-op updater must preserve raw unknown fields');
    const legacyGlobalRegex = Object.assign({}, regex, {id: 'host-contract-legacy-global', script_name: 'legacy-global', scope: 'global'});
    const legacyCharacterRegex = Object.assign({}, regex, {id: 'host-contract-legacy-character', script_name: 'legacy-character'});
    await helper.replaceTavernRegexes([legacyGlobalRegex, legacyCharacterRegex], {scope: 'all'});
    check(helper.getTavernRegexes({type: 'global'})[0].id === 'host-contract-legacy-global', 'legacy global Regex row must remain global');
    check(helper.getTavernRegexes({type: 'character'})[0].id === 'host-contract-legacy-character', 'legacy Regex row without scope must map to character');
    check(helper.isCharacterTavernRegexesEnabled() === true, 'character Regex must default to enabled');
    __hostContractHostChar.scriptsEnabled = false;
    check(helper.isCharacterTavernRegexesEnabled() === true, 'script switch must not disable character Regex');
    __hostContractHostChar.regexEnabled = false;
    check(helper.isCharacterTavernRegexesEnabled() === false, 'character Regex must have its own enable owner');
    delete __hostContractHostChar.regexEnabled;
    __hostContractHostChar.scriptsEnabled = true;

    const trackedSaveData = saveData;
    const draft = makeStreamDraftCheckpoint({charId: __hostContractHostChar.id,
      sessionId: __hostContractHostSession.id, mode: 'new'}, __hostContractHostSession,
      {draftId: 'host-contract-draft', text: 'pending draft', state: 'network_error'});
    _streamDrafts.push(draft);
    check(await queueStreamDraftWrite(draft), 'draft invalidation fixture must be stored before the failure');
    await flushPendingSave();
    const restoreDraftStorage = await window.__hostContractFailWrites('app_meta', true);
    let sessionsSaveCommitted = false;
    saveData = async function(sections, option) {
      await trackedSaveData(sections, option);
      if ((Array.isArray(sections) ? sections : [sections]).map(String).includes('sessions')) sessionsSaveCommitted = true;
    };

    try {
      await helper.setChatMessages([{message_id: 0, message: 'committed-after-save'}], {refresh: 'none'});
    } catch (_) {
      // Whether draft cleanup is surfaced is a product choice; a completed sessions save is the rollback boundary.
    } finally {
      saveData = trackedSaveData;
      await restoreDraftStorage();
      _streamDrafts = _streamDrafts.filter(row => row !== draft);
      await YeyuRepository.deleteStreamDraft(draft.draftId);
    }
    const committedSession = D.chats[__hostContractHostChar.id].sessions.find(row => row.id === 'host-contract-session');
    check(sessionsSaveCommitted, 'draft invalidation probe must cross a successful sessions save');
    check(committedSession.msgs[0].content === 'committed-after-save', 'draft invalidation failure after save must not roll back committed message memory');
    const persistedSession = (await YeyuRepository.load()).data.chats[__hostContractHostChar.id].sessions.find(row => row.id === committedSession.id);
    check(persistedSession.msgs[0].content === 'committed-after-save', 'draft invalidation failure must retain the committed message in IndexedDB');
    check(draft.state === 'stale' && draft.protectionError, 'real draft invalidation must retain its failed save for recovery');
    window.__hostContractHostSession = committedSession;

    const presetTree = [{
      type: 'script', id: 'host-contract-preset-script', name: 'Preset Contract Script', enabled: false,
      content: '', info: 'preset-info', button: {enabled: true, buttons: []},
      data: {coherent: true}, export_with: {data: true, button: true},
    }];
    const treeUpdate = helper.updateScriptTreesWith(async () => presetTree, {type: 'preset'});
    check(thenable(treeUpdate), 'async script-tree updater must return a Promise');
    const presetTreeResult = await treeUpdate;
    check(presetTreeResult.length === 1 && presetTreeResult[0].id === 'host-contract-preset-script', 'preset script-tree updater must commit the returned tree');
    equal(activeNamedPreset.preset.extensions.tavern_helper.scripts, presetSettingsStore().chatCompletionPresetInUse.extensions.tavern_helper.scripts, 'active preset script writes must synchronize named and in-use copies');

    const metaSavesBeforeFlush = __hostContractHostSaves.filter(section => section === 'meta').length;
    frame.replaceVariables({flush: 'pending'}, {type: 'preset'});
    check(_completionPresetHostSavePending === true, 'preset host write must enter the pending debounce state');
    await flushPendingSave();
    check(_completionPresetHostSavePending === false && __hostContractHostSaves.filter(section => section === 'meta').length > metaSavesBeforeFlush, 'flushPendingSave must await and clear the pending preset save');

    const persisted = (await YeyuRepository.load()).data;
    equal(persisted.settings.chatCompletionPresets, D.settings.chatCompletionPresets, 'host preset writes must reach persisted settings');
    equal(persisted.worldBook, D.worldBook, 'worldbook writes must reach persisted worldbook data');
    equal(persisted.characters.find(row => row.id === __hostContractHostChar.id).extensions,
      __hostContractHostChar.extensions, 'script tree and character variables must reach persisted character data');
    equal(persisted.personas, D.personas, 'worldbook persona bindings must reach persisted personas');
    const saves = Array.from(new Set(__hostContractHostSaves));
    ['sessions', 'meta', 'characters', 'worldbook'].forEach(section => check(saves.includes(section), `missing save channel ${section}: ${saves.join(',')}`));
    return {
      directBindings: oracleValue.exposure.directRequired.length,
      helperBindings: oracleValue.exposure.helperRequiredExceptDirectOnly.length,
      messageSeq: __hostContractHostSession.msgs.map(row => row.seq),
      saveChannels: saves.sort(),
      formatDecision: formatError,
    };
  }, oracle);

  await page.evaluate(() => {
    const session = getActiveSession(__hostContractHostChar.id);
    session.stscriptVars = {stat_data: {turn: 0}};
    session.msgs = [901, 902, 903].map(seq => ({
      role: 'assistant',
      seq,
      time: Date.now(),
      content: `<div><span id="host-contract-variable-turn-${seq}"></span><script>document.getElementById("host-contract-variable-turn-${seq}").textContent=String((getVariables().stat_data||{}).turn||0);<\/script></div>`,
    }));
    session.nextMessageSeq = 904;
    renderChat();
    session.msgs.forEach(message => {
      document.querySelector(`[data-msg-seq="${message.seq}"]`).__hostContractStableMessageRow = true;
    });
  });
  await page.waitForFunction(() => {
    return [0, 1, 2].every(index => {
      const live = Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index);
      const value = live && live.frame.contentDocument.getElementById(`host-contract-variable-turn-${901 + index}`);
      return value && value.textContent === '0';
    });
  });
  const initialFrontendState = await page.evaluate(() => ({
    libraryToken: _cardScriptLibraryLive.token,
    messageTokens: [0, 1, 2].map(index => Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index).token),
  }));
  await page.evaluate(async () => {
    const library = _cardScriptLibraryLive.frame.contentWindow;
    const current = library.TavernHelper.getChatMessages(1)[0];
    await library.TavernHelper.setChatMessages([{message_id: 1, message: current.message}], {refresh: 'none'});
  });
  const noneFrontendState = await page.evaluate(() => ({
    libraryToken: _cardScriptLibraryLive.token,
    messageTokens: [0, 1, 2].map(index => Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index).token),
  }));
  assert.deepStrictEqual(noneFrontendState, initialFrontendState, 'refresh none must preserve every frontend and the resident script library');

  const variableRefreshRounds = [];
  for (const turn of [1]) {
    const before = await page.evaluate(() => {
      return {
        libraryToken: _cardScriptLibraryLive.token,
        messageTokens: [0, 1, 2].map(index => Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index).token),
      };
    });
    await page.evaluate(async turnValue => {
      const library = _cardScriptLibraryLive.frame.contentWindow;
      library.replaceVariables({stat_data: {turn: turnValue}}, {type: 'chat'});
      const current = library.TavernHelper.getChatMessages(1)[0];
      await library.TavernHelper.setChatMessages([{message_id: 1, message: current.message}]);
    }, turn);
    await page.waitForFunction(turnValue => {
      const live = Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === 1);
      const value = live && live.frame.contentDocument.getElementById('host-contract-variable-turn-902');
      return value && value.textContent === String(turnValue);
    }, turn);
    const after = await page.evaluate(() => {
      const lives = [0, 1, 2].map(index => Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index));
      return {
        libraryToken: _cardScriptLibraryLive.token,
        messageTokens: lives.map(live => live.token),
        value: lives[1].frame.contentDocument.getElementById('host-contract-variable-turn-902').textContent,
        rowsStable: [901, 902, 903].every(seq => document.querySelector(`[data-msg-seq="${seq}"]`).__hostContractStableMessageRow === true),
      };
    });
    assert.strictEqual(after.libraryToken, before.libraryToken, `round ${turn} must preserve the resident script library`);
    assert.strictEqual(after.messageTokens[0], before.messageTokens[0], `round ${turn} must preserve the preceding frontend`);
    assert.notStrictEqual(after.messageTokens[1], before.messageTokens[1], `round ${turn} must remount the affected frontend`);
    assert.strictEqual(after.messageTokens[2], before.messageTokens[2], `round ${turn} must preserve the following frontend`);
    assert.strictEqual(after.rowsStable, true, `round ${turn} must preserve every message row`);
    variableRefreshRounds.push(Number(after.value));
  }

  const beforeAll = await page.evaluate(() => ({
    libraryToken: _cardScriptLibraryLive.token,
    messageTokens: [0, 1, 2].map(index => Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index).token),
  }));
  await page.evaluate(async () => {
    const library = _cardScriptLibraryLive.frame.contentWindow;
    library.replaceVariables({stat_data: {turn: 4}}, {type: 'chat'});
    const current = library.TavernHelper.getChatMessages(1)[0];
    await library.TavernHelper.setChatMessages([{message_id: 1, message: current.message}], {refresh: 'all'});
  });
  await page.waitForFunction(() => [0, 1, 2].every(index => {
    const live = Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index);
    const value = live && live.frame.contentDocument.getElementById(`host-contract-variable-turn-${901 + index}`);
    return value && value.textContent === '4';
  }));
  const afterAll = await page.evaluate(() => ({
    libraryToken: _cardScriptLibraryLive.token,
    messageTokens: [0, 1, 2].map(index => Array.from(_cardFrontendLive.values()).find(row => row.owner && row.owner.messageIndex === index).token),
    rowsStable: [901, 902, 903].every(seq => document.querySelector(`[data-msg-seq="${seq}"]`).__hostContractStableMessageRow === true),
  }));
  assert.strictEqual(afterAll.libraryToken, beforeAll.libraryToken, 'refresh all must preserve the resident script library');
  afterAll.messageTokens.forEach((token, index) => assert.notStrictEqual(token, beforeAll.messageTokens[index], `refresh all must remount frontend ${index}`));
  assert.strictEqual(afterAll.rowsStable, true, 'refresh all must preserve every message row');

  const failedWrites = await page.evaluate(async () => {
    const char=getChar(),session=getActiveSession(char.id),box=D.chats[char.id],helper=_cardScriptLibraryLive.frame.contentWindow.TavernHelper;
    await flushPendingSave();
    let restoreStorage;
    const first={seq:101,role:'assistant',content:'FIRST'},second={seq:102,role:'user',content:'SECOND'};
    const rows=[first,second];session.msgs=rows;session.nextMessageSeq=103;
    const memory=session.memoryStore;
    try {
      restoreStorage = await window.__hostContractFailWrites('sessions');
      const rejected=await helper.setChatMessages([{message_id:0,message:'FAILED'}],{refresh:'none'}).then(()=>false,()=>true);
      return {rejected,identity:D.chats[char.id]===box&&getActiveSession(char.id)===session&&session.msgs===rows&&session.memoryStore===memory,
        rows:rows.length===2&&rows[0]===first&&rows[1]===second,content:first.content==='FIRST'&&second.content==='SECOND'};
    } finally {if(restoreStorage)await restoreStorage();}
  });
  assert.ok(failedWrites.rejected&&failedWrites.identity&&failedWrites.rows&&failedWrites.content,JSON.stringify(failedWrites));
  const failedSaveChat = await page.evaluate(async () => {
    await flushPendingSave();
    const char = getChar(), session = getActiveSession(char.id), frame = _cardScriptLibraryLive.frame.contentWindow;
    const rows = session.msgs, first = rows[0], second = rows[1], previousExtra = {saved: true, nested: {original: true}};
    first.extra = previousExtra;
    refreshCardScriptLibraryContext(char, session);
    const restoreStorage = await window.__hostContractFailWrites('sessions');
    try {
      frame.SillyTavern.chat[0].extra = {failed: true};
      const pending = frame.SillyTavern.saveChat();
      frame.TavernHelper.replaceVariables({parallel: {kept: true}}, {type: 'chat'});
      second.content = 'CONCURRENT';
      const appended = {seq: 104, role: 'user', content: 'APPENDED'};
      rows.push(appended);
      const rejected = await pending.then(() => false, () => true);
      await flushPendingSave().catch(() => {});
      return {rejected, identities: session.msgs === rows && rows[0] === first && rows[1] === second,
        ownedRestored: first.extra === previousExtra && first.extra.nested.original === true,
        concurrentKept: session.stscriptVars.parallel.kept === true && second.content === 'CONCURRENT' && rows[2] === appended};
    } finally { await restoreStorage(); }
  });
  assert.deepStrictEqual(failedSaveChat, {rejected: true, identities: true, ownedRestored: true, concurrentKept: true});
  const failedWorldWrites = await page.evaluate(async () => {
    const char=getChar(),session=getActiveSession(char.id),box=D.chats[char.id],helper=_cardScriptLibraryLive.frame.contentWindow.TavernHelper;
    await flushPendingSave();
    let restoreStorage;
    const originalBook=D.worldBook,originalPersonas=D.personas;
    try {
      const category={id:'failed-book',name:'Failed Book',entries:[{id:'1',content:'BEFORE'}],boundCharIds:[char.id]};
      const book={categories:[category],globalCategoryIds:[category.id],activeCategoryId:category.id};
      const persona={id:'journal-persona',name:'BEFORE',lorebook:category.name};
      D.worldBook=book;D.personas=[persona];char.extensions.world=category.name;session.tavernHelperChatLorebook=category.name;
      restoreStorage = await window.__hostContractFailWrites('worldbook');
      const rejected=await hostWriteRenameWorldbook(category.name,'RENAMED').then(()=>false,()=>true);
      return {rejected,identity:D.worldBook===book&&D.worldBook.categories[0]===category&&D.personas[0]===persona&&D.chats[char.id]===box,
        restored:category.name==='Failed Book'&&char.extensions.world==='Failed Book'&&session.tavernHelperChatLorebook==='Failed Book'&&persona.lorebook==='Failed Book'};
    } finally {if(restoreStorage)await restoreStorage();D.worldBook=originalBook;D.personas=originalPersonas;}
  });
  assert.ok(failedWorldWrites.rejected&&failedWorldWrites.identity&&failedWorldWrites.restored,JSON.stringify(failedWorldWrites));
  const failedSettings = await page.evaluate(async () => {
    await flushPendingSave();
    let restoreStorage;
    try {
      const helper=_cardScriptLibraryLive.frame.contentWindow.TavernHelper;
      const first=normalizeRegexScriptRecord({id:'rollback-regex',name:'Rollback',findRegex:'x',replaceString:'BEFORE',enabled:true});
      const second=normalizeRegexScriptRecord({id:'second-regex',name:'Second',findRegex:'x',replaceString:'SECOND'});
      const rows=[first,second];D.settings.regexScripts=rows;
      restoreStorage = await window.__hostContractFailWrites('app_meta');
      const values=helper.getTavernRegexes({type:'global'});values[0].replace_string='FAILED';
      const rejected=await helper.replaceTavernRegexes([values[0]],{type:'global'}).then(()=>false,()=>true);
      return {rejected,rows:D.settings.regexScripts===rows&&rows[0]===first&&rows[1]===second,fields:first.replaceString==='BEFORE'&&second.replaceString==='SECOND'};
    } finally {if(restoreStorage)await restoreStorage();}
  });
  assert.ok(failedSettings.rejected&&failedSettings.rows&&failedSettings.fields,JSON.stringify(failedSettings));
  const failedScriptToggle = await page.evaluate(async () => {
    await flushPendingSave();
    const char=getChar(),originalStop=stopCardScripts,originalToast=toast,before=char.scriptsEnabled;
    const restoreStorage = await window.__hostContractFailWrites('characters');
    let stopped=0,failureNotices=0;
    try {
      stopCardScripts=(...args)=>{stopped++;return originalStop(...args);};
      toast=(message,type)=>{if(type==='err')failureNotices++;return originalToast(message,type);};
      delete char.scriptsEnabled;
      await toggleCardScripts(false);
      const disableRestored=!Object.prototype.hasOwnProperty.call(char,'scriptsEnabled');
      char.scriptsEnabled=false;
      await toggleCardScripts(true);
      return {disableRestored,enableRestored:char.scriptsEnabled===false,stopped,failureNotices};
    } finally {
      await restoreStorage();stopCardScripts=originalStop;toast=originalToast;
      if(before===undefined)delete char.scriptsEnabled;else char.scriptsEnabled=before;
    }
  });
  assert.deepStrictEqual(failedScriptToggle,{disableRestored:true,enableRestored:true,stopped:0,failureNotices:2},'a failed script switch save must restore the switch without stopping running scripts');
  const failedCompletionPreset=await page.evaluate(async()=>{
    await flushPendingSave();
    const restoreStorage = await window.__hostContractFailWrites('app_meta'),settings=D.settings;
    const before=cloneData(settings);
    try {
      const rejected=await completionPresetApplySettings(()=>({activeChatCompletionPresetName:'Failed preset',chatCompletionPresetInUse:presetRawDefault()}),'Failed preset').then(()=>false,()=>true);
      return {rejected,identity:D.settings===settings,restored:settings.activeChatCompletionPresetName===before.activeChatCompletionPresetName&&JSON.stringify(settings.chatCompletionPresetInUse)===JSON.stringify(before.chatCompletionPresetInUse)};
    } finally {if(restoreStorage)await restoreStorage();}
  });
  assert.deepStrictEqual(failedCompletionPreset,{rejected:true,identity:true,restored:true});
  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(result.saveChannels, ['characters', 'meta', 'personas', 'sessions', 'worldbook']);
  assert.deepStrictEqual(variableRefreshRounds, [1]);
  result.variableRefreshRounds = variableRefreshRounds;
  console.log(JSON.stringify(result));
  console.log('host write contract browser: PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
