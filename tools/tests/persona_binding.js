'use strict';

const assert = require('assert');
const path = require('path');
const {listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable, createAssetServer} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');

let browser;
let context;
let page;
let server;

async function setFixture() {
  return page.evaluate(() => {
    D = defaults();
    D.settings.useMemory = false;
    D.worldBook = {categories: [], globalCategoryIds: [], activeCategoryId: '', scan_depth: 20, token_budget: 2048, recursive: false};
    const makeSession = (id, label) => ({id, name: label, msgs: [{role: 'user', seq: 1, content: `${label}的合成问题`}], nextMessageSeq: 2, memoryStore: makeEmptyMemoryStore()});
    const boundChar = {id: 'char-bound', name: '雾港角色', description: '合成角色描述', personality: '', scenario: '', mes_example: '', extensions: {}};
    const defaultChar = {id: 'char-default', name: '山谷角色', description: '另一份合成角色描述', personality: '', scenario: '', mes_example: '', extensions: {}};
    const boundSession = makeSession('session-bound', '雾港');
    const defaultSession = makeSession('session-default', '山谷');
    D.characters = [boundChar, defaultChar];
    D.chats = {
      'char-bound': {activeSid: boundSession.id, sessions: [boundSession]},
      'char-default': {activeSid: defaultSession.id, sessions: [defaultSession]},
    };
    D.personas = [
      {id: 'persona-global', name: '全局旅人', desc: '全局身份说明', boundCharIds: []},
      {id: 'persona-old', name: '旧调查员', desc: '旧绑定说明', boundCharIds: ['char-bound']},
      {id: 'persona-bound', name: '月港调查员', desc: '绑定身份说明', boundCharIds: []},
    ];
    D.activePersonaId = 'persona-global';
    D.currentCharId = 'char-bound';
    window.__personaSaves = [];
    window.__personaToasts = [];
    window.saveData = async sections => { window.__personaSaves.push(Array.isArray(sections) ? sections.slice() : [sections]); };
    window.toast = (message, type) => window.__personaToasts.push({message: String(message), type: String(type || '')});
    renderPersonaList();
    updateChatUI();
    return true;
  });
}

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  context = await browser.newContext({viewport: {width: 390, height: 844}});
  page = await context.newPage();
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  assert.strictEqual(response.headers()['cache-control'], 'no-store');
  await waitForAppReady(page, {timeout: 15000});
  await setFixture();

  const initial = await page.evaluate(() => ({
    bound: getActivePersona('char-bound').id,
    fallback: getActivePersona('char-default').id,
    current: getActivePersona().id,
    badge: $('persona-active-badge').textContent,
  }));
  assert.deepStrictEqual(initial, {bound: 'persona-old', fallback: 'persona-global', current: 'persona-old', badge: '扮演：旧调查员'});

  const bindingPromise = page.evaluate(() => bindPersonaScope('persona-bound'));
  await page.waitForSelector('#app-prompt-modal.open input[name="persona-bind-mode"]');
  await page.check('input[name="persona-bind-mode"][value="selected"]');
  await page.check('#persona-bind-character-list input[value="char-bound"]');
  await page.click('#app-prompt-ok');
  await bindingPromise;

  const reassigned = await page.evaluate(() => ({
    active: getActivePersona('char-bound').id,
    oldIds: personaBoundCharIds(D.personas.find(row => row.id === 'persona-old')),
    newIds: personaBoundCharIds(D.personas.find(row => row.id === 'persona-bound')),
    duplicateCount: D.personas.filter(row => personaBoundCharIds(row).includes('char-bound')).length,
    characterToasts: window.__personaToasts.map(row => row.message).filter(message => message.includes('雾港角色')),
    save: window.__personaSaves.find(parts => parts.length === 2 && parts[0] === 'meta' && parts[1] === 'personas') || null,
  }));
  assert.strictEqual(reassigned.active, 'persona-bound');
  assert.deepStrictEqual(reassigned.oldIds, []);
  assert.deepStrictEqual(reassigned.newIds, ['char-bound']);
  assert.strictEqual(reassigned.duplicateCount, 1);
  assert.strictEqual(reassigned.characterToasts.length, 1);
  assert.match(reassigned.characterToasts[0], /人格已从“旧调查员”改为“月港调查员”/);
  assert.deepStrictEqual(reassigned.save, ['meta', 'personas']);

  const evidence = await page.evaluate(async () => {
    const boundChar = D.characters.find(row => row.id === 'char-bound');
    const defaultChar = D.characters.find(row => row.id === 'char-default');
    const boundSession = getActiveSession(boundChar.id);
    const defaultSession = getActiveSession(defaultChar.id);
    const boundMessages = buildMessages(boundChar, boundSession.msgs, boundSession, {}).messages;
    const defaultMessages = buildMessages(defaultChar, defaultSession.msgs, defaultSession, {}).messages;
    const requestFragment = messages => messages.filter(row => row.role === 'system' && /身份说明|用户人格/.test(row.content)).map(row => row.content).join('\n').slice(0, 500);
    const memoryBound = memoryV5SerializedRows([{role: 'user', seq: 1, content: '合成记忆'}], boundChar);
    const memoryDefault = memoryV5SerializedRows([{role: 'user', seq: 1, content: '合成记忆'}], defaultChar);
    const parent = {id: 'parent', nextMessageSeq: 3, msgs: [{seq: 1, role: 'user', content: '共同起点'}, {seq: 2, role: 'assistant', content: '父线内容'}], memoryStore: makeEmptyMemoryStore()};
    const tail = branchReturnCurrentTail(parent);
    const branch = {id: 'branch', parentSessionId: parent.id, branchPointSeq: 1, lastMergedSeq: 1, nextMessageSeq: 4, forkAnchorVersion: 3, branchPointHash: branchReturnMessageHash(parent.msgs[0]), parentTailOrdinarySeqAtFork: tail.seq, parentTailOrdinaryHashAtFork: tail.hash, parentOrdinaryStateHashAtFork: branchReturnOrdinaryStateHash(parent), msgs: [{seq: 1, role: 'user', content: '共同起点'}, {seq: 2, role: 'user', content: '支线调查'}, {seq: 3, role: 'assistant', content: '支线结果'}], memoryStore: makeEmptyMemoryStore()};
    const delta = branchReturnDeltaMessages(branch, 1);
    window.requestStructuredJson = async (prompt, input, options) => { window.__personaBranchRequest = {prompt, input: JSON.parse(input), options}; return {returnBrief: '合成支线摘要'}; };
    await requestBranchReturnPackage(boundChar, parent, branch, delta, delta, {signal: {aborted: false}}, 'completed_side_story');
    return {
      boundRequest: requestFragment(boundMessages),
      defaultRequest: requestFragment(defaultMessages),
      memoryBound,
      memoryDefault,
      branchPrompt: window.__personaBranchRequest.prompt,
      branchRows: window.__personaBranchRequest.input.branch_delta,
      regexBound: regexScriptEvaluateFragment('你好，{{user}}', boundChar, createCharacterMacroState()),
      regexDefault: regexScriptEvaluateFragment('你好，{{user}}', defaultChar, createCharacterMacroState()),
    };
  });
  assert.match(evidence.boundRequest, /绑定身份说明/);
  assert.doesNotMatch(evidence.boundRequest, /全局身份说明/);
  assert.match(evidence.defaultRequest, /全局身份说明/);
  assert.doesNotMatch(evidence.defaultRequest, /绑定身份说明/);
  assert.strictEqual(evidence.memoryBound[0].speaker, '月港调查员');
  assert.strictEqual(evidence.memoryDefault[0].speaker, '全局旅人');
  assert.match(evidence.branchPrompt, /月港调查员/);
  assert.strictEqual(evidence.branchRows[0].speaker, '月港调查员');
  assert.strictEqual(evidence.regexBound, '你好，月港调查员');
  assert.strictEqual(evidence.regexDefault, '你好，全局旅人');

  const globalSwitch = await page.evaluate(async () => {
    await selectPersona('persona-bound');
    return {
      activePersonaId: D.activePersonaId,
      boundIds: personaBoundCharIds(D.personas.find(row => row.id === 'persona-bound')),
      globalCount: D.personas.filter(row => row.id === D.activePersonaId).length,
    };
  });
  assert.deepStrictEqual(globalSwitch, {activePersonaId: 'persona-bound', boundIds: ['char-bound'], globalCount: 1});

  const normalization = await page.evaluate(() => {
    const oldData = {characters: [{id: 'old-char'}], personas: [{id: 'old-persona', name: '旧人格'}], activePersonaId: 'old-persona'};
    const oldChanged = normalizePersonaBindings(oldData);
    const dirty = {characters: [{id: 'kept-char'}], personas: [{id: 'first', boundCharIds: ['kept-char', 'missing-char']}, {id: 'second', boundCharIds: ['kept-char']}], activePersonaId: null};
    const dirtyChanged = normalizePersonaBindings(dirty);
    return {oldChanged, oldHasField: Object.prototype.hasOwnProperty.call(oldData.personas[0], 'boundCharIds'), dirtyChanged, first: dirty.personas[0].boundCharIds, second: dirty.personas[1].boundCharIds};
  });
  assert.deepStrictEqual(normalization, {oldChanged: false, oldHasField: false, dirtyChanged: true, first: ['kept-char'], second: []});

  await setFixture();
  const openingProof = await page.evaluate(() => {
    const char = getChar();
    const session = getActiveSession(char.id);
    const opening = {role: 'assistant', content: '“{{user}}，我是 {{char}}。”', opening: true, seq: 1, time: Date.now()};
    session.msgs = [opening];
    session.nextMessageSeq = 2;
    D.settings.themeMode = 'light';
    applyConfiguredTheme();
    renderChat();
    const backdrop = $('sidebar-backdrop');
    const sidebar = $('sidebar');
    if (backdrop) backdrop.classList.remove('show');
    if (sidebar) sidebar.classList.add('hidden');
    const request = buildMessages(char, session.msgs, session, {commit: false}).messages.find(row => row.role === 'assistant' && row.content.includes('，我是 '));
    return {raw: opening.content, bubble: document.querySelector('.msg.char .msg-bubble').innerText, request: request && request.content};
  });
  assert.strictEqual(openingProof.raw, '“{{user}}，我是 {{char}}。”', '开场白原文必须保留宏');
  assert.match(openingProof.bubble, /旧调查员/);
  assert.match(openingProof.bubble, /雾港角色/);
  assert.doesNotMatch(openingProof.bubble, /\{\{(?:user|char)\}\}/);
  assert.match(openingProof.request, /旧调查员/);
  assert.match(openingProof.request, /雾港角色/);
  assert.doesNotMatch(openingProof.request, /\{\{(?:user|char)\}\}/);
  await setFixture();
  await page.evaluate(() => { window.appConfirm = async () => true; });
  await page.evaluate(() => deleteCharacter('char-bound'));
  const deletion = await page.evaluate(() => ({
    ids: D.personas.map(row => personaBoundCharIds(row)),
    save: window.__personaSaves.find(parts => parts.includes('personas')) || null,
    characterExists: D.characters.some(row => row.id === 'char-bound'),
  }));
  assert.strictEqual(deletion.characterExists, false);
  assert.ok(deletion.ids.every(ids => !ids.includes('char-bound')));
  assert.deepStrictEqual(deletion.save, ['meta', 'characters', 'personas', 'sessions', 'worldbook']);

  assert.deepStrictEqual(pageErrors, [], pageErrors.join('\n'));
  console.log(JSON.stringify({
    personaResolution: {bound: '月港调查员', fallback: '全局旅人'},
    actualRequestFragments: {bound: evidence.boundRequest, fallback: evidence.defaultRequest},
    memoryPersona: evidence.memoryBound[0].speaker,
    branchPersona: evidence.branchRows[0].speaker,
    uniqueReassignment: true,
    globalUniqueness: true,
    legacyOwnerNoMigration: true,
    openingGreetingMacros: true,
    characterDeleteSameSave: deletion.save,
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
