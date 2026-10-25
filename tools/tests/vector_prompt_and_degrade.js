'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  const result = await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = true;
    D.settings.embeddingEnabled = true;
    D.settings.embeddingApiUrl = 'https://embedding.test/v1';
    D.settings.embeddingApiKey = 'synthetic-key';
    D.settings.embeddingModel = 'embedding-3';
    D.settings.embeddingDimensions = 2;
    D.settings.maxContextTokens = 0;
    D.settings.postHistory = '';
    D.settings.authorsNote = '';
    const char = {id: 'char', name: '角色', description: '测试角色', first_mes: ''};
    const session = {id: 'session', name: '测试', msgs: [{seq: 1, role: 'assistant', content: '隐藏的旁白', hidden: true}, {seq: 2, role: 'user', content: '寻找港口医生'}], nextMessageSeq: 3, memoryStore: makeEmptyMemoryStore()};
    const store = ensureSessionMemoryStore(session);
    store.longTermEntries.push(memoryV5NormalizeLongTerm({
      id: 'memory-doctor', type: 'key_event', content: '医生曾答应治疗船长', importance: 3,
      confidence: 0.8, sourceStartSeq: 1, sourceEndSeq: 2, status: 'active',
    }, session.id));
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats[char.id] = {sessions: [session], activeSid: session.id};
    D.worldBook.categories = [{
      id: 'cat', name: '港口', entries: [
        Object.assign(normalizeWBEntry({id: 'doctor', enabled: true, vectorized: true, keys: [], content: '港口的医生住在灯塔下', position: 'after_char'}), {_catId: 'cat'}),
        Object.assign(normalizeWBEntry({id: 'desert', enabled: true, vectorized: true, keys: [], content: '沙漠商队经过绿洲', position: 'after_char'}), {_catId: 'cat'}),
      ],
    }];
    D.worldBook.globalCategoryIds = ['cat'];

    const originalFetch = window.fetch;
    const originalRequest = requestGenerationWithRetry;
    const originalCommit = commitGeneratedResponse;
    const originalSummary = runAutoMemorySummary;
    let captured = [];
    let embeddedTexts = [];
    window.fetch = async (url, options) => {
      if (!String(url).endsWith('/embeddings')) throw new Error('unexpected fetch: ' + url);
      const body = JSON.parse(options.body);
      embeddedTexts.push(...body.input);
      const vector = text => /寻找港口医生|港口的医生|治疗船长/.test(text) ? [1, 0] : [0, 1];
      return {ok: true, json: async () => ({data: body.input.map((text, index) => ({index, embedding: vector(text)}))})};
    };
    requestGenerationWithRetry = async messages => { captured = messages; return {display: '测试回复', usage: null, finishReason: 'stop'}; };
    commitGeneratedResponse = async () => {};
    runAutoMemorySummary = async () => false;
    try {
      await doAPICall({target: {charId: char.id, sessionId: session.id, mode: 'new'}});
      const initialPrompt = captured.map(row => row.content).join('\n');
      const initialSnapshot = JSON.parse(JSON.stringify(session.msgs[1].worldBookSnapshot || null));
      const initialVectorFingerprint = session.msgs[1].vectorRetrievalFingerprint || '';
      const initialStatus = Object.assign({}, _lastVectorRetrievalStatus);

      D.worldBook.categories[0].entries[0].content = '沙漠商队经过绿洲';
      session.msgs.push({seq: 3, role: 'assistant', content: '上一段回复'});
      captured = [];
      embeddedTexts = [];
      await doAPICall({target: {charId: char.id, sessionId: session.id, mode: 'continue', messageIndex: 2, messageSeq: 3}});
      const continuationEmbeddedTexts = embeddedTexts.slice();
      const continuationPrompt = captured.map(row => row.content).join('\n');
      const refreshedSnapshot = JSON.parse(JSON.stringify(session.msgs[1].worldBookSnapshot || null));

      D.settings.embeddingEnabled = false;
      captured = [];
      await doAPICall({target: {charId: char.id, sessionId: session.id, mode: 'new'}});
      const disabled = {status: _lastVectorRetrievalStatus.state, prompt: captured.map(row => row.content).join('\n')};

      return {prompt: initialPrompt, snapshot: initialSnapshot, vectorFingerprint: initialVectorFingerprint, status: initialStatus, continuationPrompt, continuationEmbeddedTexts, refreshedSnapshot, disabled};
    } finally {
      window.fetch = originalFetch;
      requestGenerationWithRetry = originalRequest;
      commitGeneratedResponse = originalCommit;
      runAutoMemorySummary = originalSummary;
    }

  });

  assert.match(result.prompt, /港口的医生住在灯塔下/, '世界书语义命中必须进入发送 Prompt');
  assert.doesNotMatch(result.prompt, /沙漠商队经过绿洲/, '无关向量条目不得进入发送 Prompt');
  assert.match(result.prompt, /医生曾答应治疗船长/, '长记忆语义命中必须进入发送 Prompt');
  assert.strictEqual(result.snapshot, null, '构建不得在消息上写世界书快照');
  assert.strictEqual(result.vectorFingerprint, '', '构建不得在消息上写向量指纹');
  assert.strictEqual(result.status.state, 'ready', '隐藏消息不得让本轮向量命中作废');
  assert.doesNotMatch(result.continuationPrompt, /港口的医生住在灯塔下/, '续写必须按当前内容重扫向量命中，不得复用旧结果');
  assert(!result.continuationEmbeddedTexts.includes('医生曾答应治疗船长'), '内容与模型未变化的候选必须复用向量缓存');
  assert.strictEqual(result.refreshedSnapshot, null, '续写构建也不得在消息上写快照');
  assert.strictEqual(typeof result.disabled.prompt, 'string');
  assert(result.disabled.prompt.length > 0, '关闭向量时发送必须继续完成 Prompt 构建');
  assert.doesNotMatch(result.disabled.prompt, /港口的医生住在灯塔下/, '关闭向量时纯向量世界书条目不得注入');
  assert.strictEqual(result.disabled.status, 'disabled');
  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log(JSON.stringify({promptSemanticWorldBook: true, promptSemanticMemory: true, noPersistedSnapshot: true, continuationInvalidated: true, hiddenMessageKeepsHits: true, vectorCacheReused: true, degradedSend: true}));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
