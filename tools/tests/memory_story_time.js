'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  const audit = await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = true;
    D.settings.memoryRetrievalTokenBudget = 1200;
    D.settings.summaryTokenLimit = 8192;
    D.settings.autoSummaryEvery = 30;
    D.settings.recentMsgLimit = 10;

    const normalize = overrides => memoryV5NormalizeLongTerm(Object.assign({
      id: 'entry', type: 'key_event', content: '林岚在星港找到银钥匙', subject: '林岚', object: '银钥匙',
      importance: 4, confidence: .9, origin: 'summary', sourceStartSeq: 4, sourceEndSeq: 8, sourceHash: 'story-source'
    }, overrides || {}), 'session');
    const timed = normalize({id: 'timed', story_time: '星历1024年霜月12日 21:30'});
    const blank = normalize({id: 'blank', content: '林岚与沈川结盟', story_time: '   '});
    const withoutTime = normalize({id: 'without-time'});

    const legacySession = {id: 'legacy-session', msgs: [], memoryStore: {
      version: 5, summaryModel: 'rolling-history-v1', historySummary: null, longTermEntries: [{
        id: 'old-entry', type: 'character_fact', content: '历史人物事实', importance: 3,
        sourceStartSeq: 1, sourceEndSeq: 1, status: 'active', active: true
      }]
    }};
    ensureSessionMemoryStore(legacySession);

    const timedStore = makeEmptyMemoryStore();
    timedStore.longTermEntries = [timed];
    const timedPayload = memoryContextPayloadForSession({id: 'timed-session', memoryStore: timedStore}, '林岚在星港找到银钥匙', 1200, {});
    const blankStore = makeEmptyMemoryStore();
    blankStore.longTermEntries = [blank];
    const blankPayload = memoryContextPayloadForSession({id: 'blank-session', memoryStore: blankStore}, '林岚与沈川结盟', 1200, {});

    const applyStore = makeEmptyMemoryStore();
    const target = normalize({id: 'target', content: '林岚在星港找到银钥匙'});
    applyStore.longTermEntries = [target];
    const summary = memoryV5NormalizeHistorySummary({sourceStartSeq: 1, sourceEndSeq: 8, sourceHash: 'batch', text: '摘要'}, 'session');
    memoryV5ApplyBatch(applyStore, {historySummary: summary, entries: [timed], operations: [{candidateIndex: 0, action: 'confirm', targetId: 'target'}]});
    const confirmedStoryTime = target.storyTime;
    const updated = normalize({id: 'updated', content: '林岚把银钥匙交给沈川', story_time: ''});
    memoryV5ApplyBatch(applyStore, {historySummary: summary, entries: [updated], operations: [{candidateIndex: 0, action: 'update', targetId: 'target'}]});

    let capturedPrompt = '';
    let capturedInput = null;
    const originalRequestStructuredJson = requestStructuredJson;
    window.requestStructuredJson = async (prompt, input) => {
      capturedPrompt = prompt;
      capturedInput = JSON.parse(input);
      return {
        history_outline: '',
        recent_history_summary: '星历1024年霜月12日，林岚在星港找到银钥匙；沈川随后决定同行。',
        long_term_entries: [
          {type: 'key_event', content: '林岚在星港找到银钥匙', subject: '林岚', object: '银钥匙', importance: 4, story_time: '星历1024年霜月12日 21:30'},
          {type: 'relationship_change', content: '沈川决定与林岚同行', subject: '沈川', object: '林岚', importance: 4, story_time: ''}
        ]
      };
    };
    D.settings.memorySummaryPrompt = '用户自定义的摘要要求';
    const sourceSession = {id: 'source-session', msgs: [], memoryStore: makeEmptyMemoryStore()};
    let batch;
    try {
      batch = await requestMemoryBatchForSession({id: 'char', name: '林岚', participantRegistry: []}, sourceSession, [
        {seq: 1, role: 'user', content: '【状态】\n日期：星历1024年霜月12日\n时间：21:30'},
        {seq: 2, role: 'assistant', content: '林岚在星港找到银钥匙，沈川决定同行。'}
      ], 'test', {signal: {aborted: false}}, {});
    } finally {
      window.requestStructuredJson = originalRequestStructuredJson;
    }

    return {
      timedStoryTime: timed.storyTime,
      blankHasStoryTime: Object.prototype.hasOwnProperty.call(blank, 'storyTime'),
      legacyHasStoryTime: Object.prototype.hasOwnProperty.call(legacySession.memoryStore.longTermEntries[0], 'storyTime'),
      fingerprintChanged: memoryV5Fingerprint([timed]) !== memoryV5Fingerprint([withoutTime]),
      timedPayloadText: timedPayload.text,
      blankPayloadText: blankPayload.text,
      confirmedStoryTime,
      updatedHasStoryTime: Object.prototype.hasOwnProperty.call(target, 'storyTime'),
      capturedPrompt,
      capturedInputHasGlossary: typeof capturedInput.name_glossary === 'string' && capturedInput.name_glossary.length > 0,
      capturedInputLength: capturedInput.new_messages.length,
      batchEntries: batch.entries.map(row => ({storyTime: row.storyTime || '', hasStoryTime: Object.prototype.hasOwnProperty.call(row, 'storyTime')}))
    };
  });

  assert.strictEqual(audit.timedStoryTime, '星历1024年霜月12日 21:30');
  assert.strictEqual(audit.blankHasStoryTime, false, '空时间不得写入占位字段');
  assert.strictEqual(audit.legacyHasStoryTime, false, '加载旧 memory v5 时不得迁移或补写空时间');
  assert.strictEqual(audit.fingerprintChanged, true, '剧内时间变化必须失效 Prompt 缓存身份');
  assert.match(audit.timedPayloadText, /\[剧内时间：星历1024年霜月12日 21:30\]/, '有值时注入文本必须带剧内时间');
  assert.doesNotMatch(audit.blankPayloadText, /剧内时间|undefined|null/, '无值时注入文本不得产生空标签或占位符');
  assert.strictEqual(audit.confirmedStoryTime, '星历1024年霜月12日 21:30', '后续明确证据必须能补全旧条目的空时间');
  assert.strictEqual(audit.updatedHasStoryTime, false, '条目正文被更新且时间不明时不得沿用旧时间');
  assert.strictEqual(audit.capturedPrompt, '用户自定义的摘要要求', '自定义摘要提示词必须原样发送，不得在运行时追加约束');
  assert.strictEqual(audit.capturedInputHasGlossary, true, '名称表应作为可见输入数据发送，不得改写自定义提示词');
  assert.strictEqual(audit.capturedInputLength, 2);
  assert.deepStrictEqual(audit.batchEntries, [
    {storyTime: '星历1024年霜月12日 21:30', hasStoryTime: true},
    {storyTime: '', hasStoryTime: false}
  ]);
  const entryBefore = await page.evaluate(() => {
    const char = {id: 'entry-char', name: '米拉', description: '', first_mes: '', mes_example: '', extensions: {}};
    const session = {id: 'entry-session', name: '编辑验证', msgs: [], memoryStore: makeEmptyMemoryStore()};
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    const store = ensureSessionMemoryStore(session);
    const row = memoryV5NormalizeLongTerm({
      id: 'edited-entry', type: 'key_event', content: '米拉在月门前答应守住约定', subject: '米拉', object: '月门约定',
      origin: 'summary', sourceStartSeq: 4, sourceEndSeq: 8, confidence: .86, importance: 4, lastConfirmedSeq: 9
    }, session.id);
    store.longTermEntries = [row];
    memoryV5InvalidateIndex(store);
    renderMemoryManagerState(char, session);
    openModal('memory-manager-modal');
    return {id: row.id};
  });
  await page.evaluate(id => editMemoryV5Entry(id), entryBefore.id);
  await page.waitForFunction(() => document.getElementById('memory-entry-modal').classList.contains('open'));
  await page.selectOption('#me-type', 'relationship_change');
  await page.fill('#me-content', '米拉与洛安确认共同守护月门');
  await page.selectOption('#me-importance', '5');
  await page.fill('#me-confidence', '93');
  await page.fill('#me-subject', '米拉');
  await page.fill('#me-object', '洛安');
  const entryAfter = await page.evaluate(async () => {
    try {
      const saved = await saveMemoryV5Entry();
      const store = ensureSessionMemoryStore(getActiveSession(getChar().id));
      const row = store.longTermEntries.find(item => item.id === 'edited-entry');
      return {
        saved,
        fields: row && {type: row.type, content: row.content, importance: row.importance, confidence: row.confidence, subject: row.subject, object: row.object},
        userMaintained: row.userMaintained,
        indexCurrent: memoryV5EnsureIndex(store).sourceFingerprint === memoryV5Fingerprint(store.longTermEntries) && !Object.prototype.hasOwnProperty.call(store, 'vectorIndex'),
        editorClosed: !document.getElementById('memory-entry-modal').classList.contains('open'),
      };
    } finally {
      closeModal('memory-entry-modal');
      closeModal('memory-manager-modal');
    }
  });
  assert.strictEqual(entryAfter.saved, true);
  assert.deepStrictEqual(entryAfter.fields, {type: 'relationship_change', content: '米拉与洛安确认共同守护月门', importance: 5, confidence: .93, subject: '米拉', object: '洛安'}, '编辑器必须一次保存类别、正文、重要度、可信程度、主体和对象');
  assert.strictEqual(entryAfter.userMaintained, true, '人工编辑必须标记维护状态，防止被自动容量管理删除');
  assert.strictEqual(entryAfter.indexCurrent, true, '编辑后必须沿用现有索引重建流程');
  assert.strictEqual(entryAfter.editorClosed, true, '保存成功后应关闭编辑器回到记忆列表');
  assert.deepStrictEqual(pageErrors, [], `页面脚本错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log(JSON.stringify({
    memoryStoryTime: true,
    promptUnmodified: true,
    optionalFieldCompatible: true,
    conditionalInjection: true,
    lifecyclePreserved: true,
    entryEditRoundTrip: true,
    viewport: '390x844',
    realPage: true
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
