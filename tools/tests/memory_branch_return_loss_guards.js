'use strict';

const assert = require('assert');
const path = require('path');
const {listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable, createAssetServer} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
  await waitForAppReady(page, { timeout: 15000 });

  const audit = await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = true;
    D.settings.memorySummaryPrompt = '';
    D.settings.summaryTokenLimit = 8192;
    D.settings.autoSummaryEvery = 30;
    D.settings.recentMsgLimit = 0;
    D.settings.maxContextTokens = 0;
    D.currentCharId = '';
    D.characters = [];
    D.chats = {};

    const summaryPayloads = [];
    const capturedSummaryInputs = [];
    const notices = [];
    let saveCalls = 0;
    requestStructuredJson = async (_prompt, input) => {
      const parsed = JSON.parse(input);
      if (parsed.schema_version === 'memory_lifecycle_v2') {
        return { operations: parsed.candidates.map(row => ({ candidate_index: row.candidate_index, action: 'add', target_id: '' })) };
      }
      capturedSummaryInputs.push(parsed);
      if (!summaryPayloads.length) throw new Error('summary response queue is empty');
      return summaryPayloads.shift();
    };
    saveData = async () => { saveCalls += 1; };
    flushPendingSave = async () => {};
    toast = (message, type) => notices.push({ message: String(message), type });
    showMemoryJob = () => { _memoryJobActive = true; };
    hideMemoryJob = () => { _memoryJobActive = false; };
    scheduleTokensBar = () => {};
    renderMemoryManagerState = () => {};
    _memorySummaryLocks = {};
    _memoryJobActive = false;
    _memoryJobController = null;
    _historyLoadedBySession = {};

    function messages(start, end) {
      const rows = [];
      for (let seq = start; seq <= end; seq += 1) {
        rows.push({ seq, role: seq % 2 ? 'user' : 'assistant', content: `主线消息 ${seq}` });
      }
      return rows;
    }
    const liveCard = {
      seq: 40,
      role: 'user',
      kind: 'branch-return',
      branchReturnSummary: true,
      returnMode: 'completed_side_story',
      branchPointSeq: 1,
      content: '[支线回归摘要]\n用户在支线救下琥珀，并确认支线已经完结。',
    };
    const liveCopy = {
      seq: 41,
      role: 'assistant',
      kind: 'branch-return-copy',
      branchReturnCopy: true,
      content: '支线最后一条原文。',
    };
    const serialization = {
      cardOrdinary: memoryV5IsOrdinaryMessage(liveCard),
      cardContent: memoryV5MessageContent(liveCard),
      copyOrdinary: memoryV5IsOrdinaryMessage(liveCopy),
      copyContent: memoryV5MessageContent(liveCopy),
      excluded: [
        { ...liveCard, reverted: true },
        { ...liveCard, excludeFromMemory: true },
        { ...liveCopy, reverted: true },
        { ...liveCopy, excludeFromMemory: true },
      ].map(row => ({ ordinary: memoryV5IsOrdinaryMessage(row), content: memoryV5MessageContent(row) })),
    };

    const scene = {
      id: 'full-scene',
      msgs: [
        { seq: 1, role: 'user', content: '主线分叉锚点。' },
        liveCard,
        ...messages(2, 30),
      ],
      memoryStore: makeEmptyMemoryStore(),
    };
    const scenePlan = memoryV5CompressionPlan(scene, 30);
    summaryPayloads.push({
      history_outline: '',
      recent_history_summary: '主线推进期间，用户在已完结支线救下琥珀。',
      long_term_entries: [],
    });
    const sceneBatch = await requestMemoryBatchForSession(
      { id: 'char', name: '角色', participantRegistry: [] },
      scene,
      scenePlan.source,
      'full-scene',
      { signal: { aborted: false } },
      {},
    );
    const sceneRequest = capturedSummaryInputs[capturedSummaryInputs.length - 1];
    const serializedCard = sceneRequest.new_messages.find(row => row.seq === liveCard.seq);
    memoryV5ApplyBatch(scene.memoryStore, sceneBatch);
    const fullScene = {
      planContainsCard: scenePlan.source.includes(liveCard),
      serializedCardContent: serializedCard && serializedCard.content || '',
      cardCovered: memoryV5MessageCoveredByHistory(scene, liveCard, scene.memoryStore.historySummary.sourceEndSeq),
      summaryText: scene.memoryStore.historySummary.text,
    };

    const guardStore = makeEmptyMemoryStore();
    guardStore.historySummary = memoryV5NormalizeHistorySummary({
      history_outline: '矿镇往事',
      recent_history_summary: '王都三章',
      sourceStartSeq: 1,
      sourceEndSeq: 20,
      outlineEndSeq: 10,
      detailStartSeq: 11,
      lifecycleVersion: 2,
      lifecycleRounds: 2,
      sourceHash: 'guard-existing',
    }, 'guard-session');
    const guardSession = { id: 'guard-session', msgs: messages(1, 25), memoryStore: guardStore };
    const guardChar = { id: 'guard', name: '角色', participantRegistry: [] };
    D.characters = [guardChar];
    D.chats.guard = { activeSid: guardSession.id, sessions: [guardSession] };
    const guardBefore = JSON.stringify(guardSession.memoryStore);
    const savesBeforeGuard = saveCalls;
    summaryPayloads.push({
      history_outline: '   ',
      recent_history_summary: '只含本轮新内容',
      long_term_entries: [],
    });
    const rejected = await summarizeMessagesToMemory(
      guardChar,
      guardSession.msgs.slice(20),
      false,
      0,
      guardSession.id,
      { controller: new AbortController(), sourceName: 'guard-test' },
    );
    const afterReject = {
      result: rejected,
      storeUnchanged: JSON.stringify(guardSession.memoryStore) === guardBefore,
      sourceEndSeq: guardSession.memoryStore.historySummary.sourceEndSeq,
      saveCalls: saveCalls - savesBeforeGuard,
    };

    summaryPayloads.push({
      history_outline: '矿镇往事仍影响王都调查',
      recent_history_summary: '王都三章与本轮新内容已合并',
      long_term_entries: [],
    });
    const retried = await summarizeMessagesToMemory(
      guardChar,
      guardSession.msgs.slice(20),
      false,
      0,
      guardSession.id,
      { controller: new AbortController(), sourceName: 'guard-retry' },
    );
    const retry = {
      processed: retried.processed,
      sourceEndSeq: guardSession.memoryStore.historySummary.sourceEndSeq,
      saveCalls: saveCalls - savesBeforeGuard,
    };

    return {
      serialization,
      fullScene,
      afterReject,
      retry,
    };
  });

  assert.strictEqual(audit.serialization.cardOrdinary, true);
  assert.strictEqual(audit.serialization.cardContent, '[支线回归摘要]\n用户在支线救下琥珀，并确认支线已经完结。');
  assert.strictEqual(audit.serialization.copyOrdinary, true);
  assert.strictEqual(audit.serialization.copyContent, '支线最后一条原文。');
  assert(audit.serialization.excluded.every(row => row.ordinary === false && row.content === ''), '已撤销或明确排除的回归内容不得进入记忆');

  assert.strictEqual(audit.fullScene.planContainsCard, true, '完整压缩计划必须包含已完结回归卡');
  assert(audit.fullScene.serializedCardContent.includes('救下琥珀'), '压缩请求必须携带回归卡正文');
  assert.strictEqual(audit.fullScene.cardCovered, true, '采纳后回归卡应按分叉锚点进入覆盖范围');
  assert(audit.fullScene.summaryText.includes('救下琥珀'), '覆盖回归卡时摘要必须来自含卡片正文的送审源');

  assert.strictEqual(audit.afterReject.result.processed, false);
  assert.match(audit.afterReject.result.error, /缺少应保留的久远剧情概览/);
  assert.strictEqual(audit.afterReject.storeUnchanged, true, '坏摘要轮必须保留原摘要');
  assert.strictEqual(audit.afterReject.sourceEndSeq, 20, '坏摘要轮不得推进覆盖边界');
  assert.strictEqual(audit.afterReject.saveCalls, 0, '坏摘要轮不得保存派生状态');
  assert.strictEqual(audit.retry.processed, true, '拒绝坏轮后必须允许后续重试');
  assert.strictEqual(audit.retry.sourceEndSeq, 25);
  assert.strictEqual(audit.retry.saveCalls, 1);
  assert.deepStrictEqual(pageErrors, [], 'page errors: ' + pageErrors.join('\n'));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
