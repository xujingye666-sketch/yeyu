'use strict';
// Public image prompt flow: the effective chat prompt rides along as context and a task message closes the request.
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
let browser, server;
(async () => {
  const requests = [];
  let response = {choices: [{message: {content: 'A woman reading in a lighthouse'}, finish_reason: 'stop'}]}, imageRequests = 0;
  server = createAssetServer(path.join(root, 'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage();
  await page.route('https://chat.context.test/**', route => {
    requests.push(JSON.parse(route.request().postData()));
    return route.fulfill({status: 200, contentType: typeof response === 'string' ? 'text/event-stream' : 'application/json', body: typeof response === 'string' ? response : JSON.stringify(response)});
  });
  await page.route('https://image.context.test/**', route => { imageRequests++; return route.fulfill({status: 500, body: 'unexpected image request'}); });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const result = await page.evaluate(async () => {
    D = defaults();
    D.settings.providers[0].apiUrl = 'https://chat.context.test/v1';
    D.settings.providers[0].apiKey = 'synthetic-key';
    D.settings.providers[0].model = 'scene-model';
    D.settings.embeddingEnabled = false;
    D.settings.maxContextTokens = 0;
    D.settings.imageSources = [{id: 'image-context', type: 'openai', name: 'Fixture', apiUrl: 'https://image.context.test/v1', apiKey: 'synthetic-image-key', model: 'fixture', promptMode: 'summary'}];
    D.settings.activeImageSourceId = 'image-context';
    const char = parseCard({name: 'Context character', description: 'APPEARANCEMARK silver hair', personality: 'PERSONALITYMARK quiet', scenario: 'SCENARIOMARK harbor'});
    char.id = 'context-char';
    const session = createBlankSession('Context', 'context-session');
    session.msgs = [{seq: 1, role: 'user', content: 'Visit the lighthouse'}, {seq: 2, role: 'assistant', content: 'TARGETMARK she reads beside the window'}, {seq: 3, role: 'user', content: 'FUTUREMARK travel to desert'}];
    D.characters = [char]; D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    const persona = {id: 'context-persona', name: 'Reader', desc: 'PERSONAMARK lighthouse keeper'};
    D.personas = [persona]; D.activePersonaId = persona.id;
    D.worldBook.categories = [{id: 'context-book', name: 'Context book', entries: [
      normalizeWBEntry({id: 'lighthouse', enabled: true, keys: ['lighthouse'], content: 'WORLDMARK the lighthouse has blue stone walls'}),
      normalizeWBEntry({id: 'desert', enabled: true, keys: ['desert'], content: 'FUTURE_WORLDMARK desert castle'}),
      normalizeWBEntry({id: 'disabled', enabled: false, constant: true, content: 'DISABLED_WORLDMARK'}),
    ]}];
    D.worldBook.globalCategoryIds = ['context-book'];
    const raw = presetRawDefault();
    raw.prompts.unshift({identifier: 'image-context-fixture', role: 'system', content: 'PRESETMARK keep narrative context', system_prompt: false, marker: false, injection_position: 0});
    presetOrderRow(raw).order.unshift({identifier: 'image-context-fixture', enabled: true});
    D.settings.chatCompletionPresetInUse = raw;
    const store = ensureSessionMemoryStore(session);
    store.historySummary = {text: 'FUTURE_SUMMARYMARK desert adventure', sourceStartSeq: 1, sourceEndSeq: 3, active: true};
    store.longTermEntries = [
      memoryV5NormalizeLongTerm({id: 'past', type: 'character_fact', content: 'MEMORYMARK the keeper owns the lighthouse', sourceStartSeq: 1, sourceEndSeq: 1, importance: 5, status: 'active'}, session.id),
      memoryV5NormalizeLongTerm({id: 'future', type: 'character_fact', content: 'FUTURE_MEMORYMARK desert ruler', sourceStartSeq: 1, sourceEndSeq: 3, importance: 5, status: 'active'}, session.id),
    ];
    ensureProviderSettings(D.settings);
    stscriptPromptSettings(D.settings);
    const before = JSON.stringify(D);
    const pending = generationPromptRound(session, {mode: 'new'}, true);
    _generationPromptNetworkOwner = session;
    const sentinel = {active: true}; pending.network = {key: 'fixture', entries: [], run: sentinel};
    const prompt = await writeImagePrompt({char, session, message: session.msgs[1]});
    const changedPaths = [], original = JSON.parse(before);
    const compare = (a,b,p) => { if (JSON.stringify(a) === JSON.stringify(b)) return; if(a && b && typeof a === 'object' && typeof b === 'object') for(const k of new Set([...Object.keys(a),...Object.keys(b)])) compare(a[k],b[k],p+'.'+k); else changedPaths.push(p); };
    compare(original, D, 'D');
    return {prompt, changedPaths, unchanged: before === JSON.stringify(D), roundUnchanged: _generationPromptRounds.get(session) === pending && pending.network.run === sentinel && sentinel.active};
  });
  assert.strictEqual(result.prompt, 'A woman reading in a lighthouse');
  assert.strictEqual(requests.length, 1);
  const messages = requests[0].messages;
  const task = messages[messages.length - 1];
  assert.strictEqual(task.role, 'user', '任务消息以 user 追加在已生效 Prompt 末尾');
  assert(!messages.slice(0, -1).some(row => row.content.includes('配一张图')), '任务说明只出现一次');
  const context = JSON.stringify(messages.slice(0, -1));
  for (const marker of ['APPEARANCEMARK', 'PERSONALITYMARK', 'SCENARIOMARK', 'PERSONAMARK', 'WORLDMARK', 'PRESETMARK', 'MEMORYMARK', 'TARGETMARK']) assert(context.includes(marker), marker + ' is active context');
  for (const marker of ['FUTUREMARK', 'FUTURE_WORLDMARK', 'DISABLED_WORLDMARK', 'FUTURE_SUMMARYMARK', 'FUTURE_MEMORYMARK']) assert(!context.includes(marker), marker + ' is not active before target');
  assert(result.unchanged, 'auxiliary assembly does not change persisted state: ' + result.changedPaths.join(', '));
  assert(result.roundUnchanged, 'auxiliary assembly leaves pending chat round and network replay alive');
  const imagesBefore = imageRequests;
  for (const content of ['I cannot help with this request.', 'Sorry, I cannot generate that image prompt.', "I'm unable to generate that image prompt.", '抱歉，我无法完成你的请求。']) {
    response = {choices: [{message: {content}, finish_reason: 'stop'}]};
    const refusalError = await page.evaluate(async () => { const char = getChar(), session = getActiveSession(char.id); try { await runImageGeneration({char, session, message: session.msgs[1]}); return ''; } catch (error) { return error.message; } });
    assert(refusalError.includes('unexpected image request'), 'refusal-looking text now goes to the image service as the prompt: ' + refusalError);
  }
  assert.strictEqual(imageRequests, imagesBefore + 4, 'refusal-looking prompts still reach the image service');
  response = {choices: [{message: {content: ''}, finish_reason: 'stop'}]};
  const emptyError = await page.evaluate(async () => { const char = getChar(), session = getActiveSession(char.id); try { await runImageGeneration({char, session, message: session.msgs[1]}); return ''; } catch (error) { return error.message; } });
  assert(/没有返回出图提示词|空响应/.test(emptyError), 'empty output fails before image service: ' + emptyError);
  assert.strictEqual(imageRequests, imagesBefore + 4, 'empty output never reaches the image service');
  response = {choices: [{message: {content: 'A quiet harbor', refusal: 'Request refused'}, finish_reason: 'stop'}]};
  let error = await page.evaluate(async () => { const char = getChar(), session = getActiveSession(char.id); try { await runImageGeneration({char, session, message: session.msgs[1]}); return ''; } catch (error) { return error.message; } });
  assert(error.includes('拦截'), 'structured refusal overrides normal stop and nonempty content');
  response = 'data: ' + JSON.stringify({choices: [{delta: {content: 'A harbor', refusal: 'Request refused'}, finish_reason: null}]}) + '\n\n' + 'data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n';
  error = await page.evaluate(async () => { const char = getChar(), session = getActiveSession(char.id); try { await runImageGeneration({char, session, message: session.msgs[1]}); return ''; } catch (error) { return error.message; } });
  assert(error.includes('拦截'), 'compatible SSE refusal remains rejected after stop');
  response = {error: {message: 'Fixture provider failure'}};
  error = await page.evaluate(async () => { const char = getChar(), session = getActiveSession(char.id); try { await runImageGeneration({char, session, message: session.msgs[1]}); return ''; } catch (error) { return error.message; } });
  assert(error.includes('Fixture provider failure'), 'HTTP 200 error document remains a failure');
  response = {choices: [{message: {content: 'A lighthouse keeper beside a blue window'}, finish_reason: 'stop'}]};
  const risu = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id);
    char.extensions.risuai = {triggerscript: [
      {type: 'start', comment: 'must not run', conditions: [], effect: [{type: 'setvar', var: 'started', operator: '=', value: '1'}]},
      {type: 'request', comment: 'preview only', conditions: [], effect: [{type: 'setvar', var: 'requestVar', operator: '=', value: '1'}]},
    ]};
    char.description = 'RISUAPPEARANCEMARK lighthouse keeper';
    session.risu = {scriptstate: {}, globalVariables: {}};
    const before = JSON.stringify({char, session});
    const prompt = await writeImagePrompt({char, session, message: session.msgs[1]});
    const controller = new AbortController(); controller.abort();
    let cancelled = false;
    try { await writeImagePrompt({char, session, message: session.msgs[1], signal: controller.signal}); } catch (error) { cancelled = error.name === 'AbortError'; }
    return {prompt, unchanged: before === JSON.stringify({char, session}), cancelled};
  });
  assert.strictEqual(risu.prompt, 'A lighthouse keeper beside a blue window');
  assert(risu.unchanged, 'Risu uses live ownership checks with read-only snapshot stages');
  assert(risu.cancelled, 'cancelled Risu auxiliary request does not start');
  assert(JSON.stringify(requests.at(-1).messages.slice(0, -1)).includes('RISUAPPEARANCEMARK'));
  console.log('image_prompt_context_browser: ok');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
