'use strict';

// Memory manager mutations through the real UI: entry archive/restore/delete/add, summary edit and the
// pre-write review, each with the save-failure rollback that keeps the stored memory untouched.
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {
    ignoreConsoleError: message => message.text().startsWith('IndexedDB 写入失败，使用恢复快照 QuotaExceededError:'),
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = true;
    D.settings.autoSummaryEvery = 10;
    D.settings.recentMsgLimit = 0;
    const char = {id: 'mm-char', name: '米拉', description: '', first_mes: '', mes_example: '', extensions: {}};
    const msgs = [];
    for (let seq = 1; seq <= 12; seq++) msgs.push({seq, role: seq % 2 ? 'user' : 'assistant', content: `第${seq}条原文`});
    const session = {id: 'mm-session', name: '记忆验证', msgs, memoryStore: makeEmptyMemoryStore()};
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    const store = ensureSessionMemoryStore(session);
    const entry = (id, content) => memoryV5NormalizeLongTerm({
      id, type: 'key_event', content, subject: '米拉', object: '月门', origin: 'summary',
      sourceStartSeq: 1, sourceEndSeq: 2, importance: 4, confidence: .9
    }, session.id);
    store.longTermEntries = [entry('keep', '米拉在月门前立下约定'), entry('gone', '米拉丢失了旧地图')];
    store.historySummary = memoryV5NormalizeHistorySummary({sourceStartSeq: 1, sourceEndSeq: 2, sourceHash: 'h', text: '原历史摘要'}, session.id);
    store.processedThroughSeq = 2;
    memoryV5InvalidateIndex(store);
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    window.__storedMemoryBefore = JSON.stringify((await YeyuRepository.load()).data.chats[char.id].sessions[0].memoryStore);
    window.__saveFailure = null;
    const realPut = IDBObjectStore.prototype.put, realSetItem = Storage.prototype.setItem;
    IDBObjectStore.prototype.put = function(...args) {
      if (window.__saveFailure && this.name === 'sessions') throw new DOMException(window.__saveFailure, 'QuotaExceededError');
      return realPut.apply(this, args);
    };
    Storage.prototype.setItem = function(key, value) {
      if (window.__saveFailure && key === FALLBACK_KEY) throw new DOMException(window.__saveFailure, 'QuotaExceededError');
      return realSetItem.call(this, key, value);
    };
    renderMemoryManagerState(char, session);
    openModal('memory-manager-modal');
  });

  const state = () => page.evaluate(() => {
    const store = ensureSessionMemoryStore(getActiveSession('mm-char'));
    return {
      entries: store.longTermEntries.map(row => ({id: row.id, status: row.status, active: row.active, content: row.content, origin: row.origin})),
      summary: store.historySummary && store.historySummary.text,
      summaryEnd: store.historySummary && store.historySummary.sourceEndSeq,
      toasts: [...document.querySelectorAll('#toasts .toast')].map(node => node.textContent)
    };
  });
  const row = text => page.locator('#mm-memory-structured .memory-row', {hasText: text});
  const toastShown = text => page.waitForFunction(expected => [...document.querySelectorAll('#toasts .toast')].some(node => node.textContent.includes(expected)), text);
  const rememberToasts = () => page.evaluate(() => {
    window.__memorySeenToasts = new WeakSet(document.querySelectorAll('#toasts .toast'));
  });
  const freshToastShown = text => page.waitForFunction(expected => [...document.querySelectorAll('#toasts .toast')].some(node => !window.__memorySeenToasts.has(node) && node.textContent.includes(expected)), text);
  const failSaves = reason => page.evaluate(value => { window.__saveFailure = value; }, reason);
  const confirmPrompt = async () => {
    await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
    await page.locator('#app-prompt-ok').tap();
  };

  // A failing save leaves every stored entry as it was.
  await failSaves('磁盘已满');
  await rememberToasts();
  await row('米拉在月门前立下约定').getByRole('button', {name: '停用'}).tap();
  await freshToastShown('保存失败，原记忆已恢复：本地存储写入失败');
  await rememberToasts();
  await row('米拉丢失了旧地图').getByRole('button', {name: '删除'}).tap();
  await confirmPrompt();
  await freshToastShown('保存失败，原记忆已恢复：本地存储写入失败');
  await rememberToasts();
  await page.locator('#mm-memory-structured').getByRole('button', {name: '新增辅助记忆'}).tap();
  await page.fill('#app-prompt-input', '米拉记住了洛安的名字');
  await page.locator('#app-prompt-ok').tap();
  await page.waitForFunction(() => document.getElementById('app-prompt-choice') && !document.getElementById('app-prompt-choice').hidden);
  await page.locator('#app-prompt-ok').tap();
  await freshToastShown('保存失败，原记忆已恢复：本地存储写入失败');
  let current = await state();
  assert.deepStrictEqual(current.entries.map(item => [item.id, item.status, item.active]), [['keep', 'active', true], ['gone', 'active', true]], '保存失败时停用、删除和新增都必须回到原条目');
  assert.strictEqual(await page.evaluate(async () => JSON.stringify((await YeyuRepository.load()).data.chats['mm-char'].sessions[0].memoryStore) === window.__storedMemoryBefore), true, '失败未改变已保存记忆');

  // Successful saves: archive, restore, delete and add a manual entry.
  await failSaves(null);
  await row('米拉在月门前立下约定').getByRole('button', {name: '停用'}).tap();
  await toastShown('辅助记忆已停用');
  current = await state();
  assert.strictEqual(current.entries.find(item => item.id === 'keep').status, 'archived');
  await page.locator('#mm-memory-structured .memory-inactive > summary').tap();
  await row('米拉在月门前立下约定').getByRole('button', {name: '恢复使用'}).tap();
  await toastShown('辅助记忆已恢复使用');
  current = await state();
  assert.deepStrictEqual(current.entries.find(item => item.id === 'keep'), {id: 'keep', status: 'active', active: true, content: '米拉在月门前立下约定', origin: 'summary'});
  await row('米拉丢失了旧地图').getByRole('button', {name: '删除'}).tap();
  await confirmPrompt();
  await page.waitForFunction(() => !document.querySelector('#mm-memory-structured').textContent.includes('米拉丢失了旧地图'));
  await page.locator('#mm-memory-structured').getByRole('button', {name: '新增辅助记忆'}).tap();
  await page.fill('#app-prompt-input', '米拉记住了洛安的名字');
  await page.locator('#app-prompt-ok').tap();
  await page.waitForFunction(() => document.getElementById('app-prompt-choice') && !document.getElementById('app-prompt-choice').hidden);
  await page.locator('#app-prompt-ok').tap();
  await toastShown('辅助记忆已添加');
  current = await state();
  assert.deepStrictEqual(current.entries.map(item => [item.content, item.origin]), [['米拉在月门前立下约定', 'summary'], ['米拉记住了洛安的名字', 'manual']]);

  // Repeated manual facts remain separately addressable through edit/delete, including a failed edit.
  await rememberToasts();
  await page.locator('#mm-memory-structured').getByRole('button', {name: '新增辅助记忆'}).tap();
  await page.fill('#app-prompt-input', '米拉记住了洛安的名字');
  await page.locator('#app-prompt-ok').tap();
  await page.waitForFunction(() => document.getElementById('app-prompt-choice') && !document.getElementById('app-prompt-choice').hidden);
  await page.locator('#app-prompt-ok').tap();
  await freshToastShown('辅助记忆已添加');
  current = await state();
  assert.strictEqual(new Set(current.entries.map(item => item.id)).size, 3, '重复正文不得共用对象身份');
  const duplicateId = current.entries[2].id;
  await page.locator(`#mm-memory-structured button[onclick*="${duplicateId}"]`).getByText('编辑', {exact: true}).tap();
  await page.fill('#me-content', '米拉记住了洛安的约定');
  const storedBeforeFailedEdit = await page.evaluate(async () => JSON.stringify((await YeyuRepository.load()).data.chats['mm-char'].sessions[0].memoryStore));
  await failSaves('条目修改失败');
  await rememberToasts();
  await page.locator('#memory-entry-modal .modal-ft .primary').tap();
  await freshToastShown('保存失败，原记忆已恢复：本地存储写入失败');
  assert.strictEqual((await state()).entries.filter(item => item.content === '米拉记住了洛安的名字').length, 2);
  assert.strictEqual(await row('米拉记住了洛安的名字').count(), 2, '本次失败提交结束后列表也恢复原正文');
  assert.strictEqual(await page.evaluate(async () => JSON.stringify((await YeyuRepository.load()).data.chats['mm-char'].sessions[0].memoryStore)), storedBeforeFailedEdit, '失败编辑不得改变刚完成保存的两条记忆');
  await failSaves(null);
  await page.locator('#memory-entry-modal .modal-ft .primary').tap();
  await page.waitForFunction(() => !document.getElementById('memory-entry-modal').classList.contains('open'));
  assert.deepStrictEqual((await state()).entries.slice(1).map(item => item.content), ['米拉记住了洛安的名字', '米拉记住了洛安的约定']);
  await row('米拉记住了洛安的约定').getByRole('button', {name: '删除'}).tap();
  await confirmPrompt();
  await page.waitForFunction(() => !document.querySelector('#mm-memory-structured').textContent.includes('米拉记住了洛安的约定'));
  assert.strictEqual((await state()).entries.filter(item => item.content === '米拉记住了洛安的名字').length, 1, '删除第二条不得误删第一条');

  // Summary editor: a failed save restores the old summary, a successful one replaces it.
  await page.evaluate(() => {
    closeModal('memory-manager-modal');
    openModal('memory-manager-modal');
  });
  await page.locator('#mm-memory-structured').getByRole('button', {name: '编辑'}).first().tap();
  await page.waitForFunction(() => document.getElementById('memory-summary-modal').classList.contains('open'));
  await page.fill('#ms-summary-text', '改写后的历史摘要');
  await failSaves('写入被拒绝');
  await page.locator('#memory-summary-modal .modal-ft .primary').tap();
  await toastShown('保存失败，原摘要已恢复：本地存储写入失败');
  assert.strictEqual((await state()).summary, '原历史摘要');
  await failSaves(null);
  await page.locator('#memory-summary-modal .modal-ft .primary').tap();
  await page.waitForFunction(() => !document.getElementById('memory-summary-modal').classList.contains('open'));
  assert.strictEqual((await state()).summary, '改写后的历史摘要');
  await page.evaluate(() => closeModal('memory-manager-modal'));

  // Review before writing: only ticked changes are written, a failed save restores the old memory,
  // and a conversation edited meanwhile drops the result.
  const review = () => page.evaluate(async () => {
    requestStructuredJson = async (_prompt, input) => {
      const parsed = JSON.parse(input);
      if (parsed.schema_version === 'memory_lifecycle_v2')
        return {operations: parsed.candidates.map(item => ({candidate_index: item.candidate_index, action: 'add', target_id: ''}))};
      return {
        history_outline: '二人早已相识。',
        recent_history_summary: '米拉与洛安在月门前会合。',
        long_term_entries: [
          {type: 'key_event', content: '米拉与洛安在月门前会合', subject: '米拉', object: '洛安', importance: 4},
          {type: 'relationship_change', content: '洛安开始信任米拉', subject: '洛安', object: '米拉', importance: 4}
        ]
      };
    };
    const char = getChar(), sess = getActiveSession(char.id), plan = memoryV5CompressionPlan(sess, 10);
    const result = await summarizeMessagesToMemory(char, plan.source, false, 0, sess.id, {review: true, sourceName: 'manual'});
    if (!result.review) return {pending: false, opened: false, error: result.error};
    return {pending: result.pending === true, opened: openMemoryReview(result.review)};
  });
  assert.deepStrictEqual(await review(), {pending: true, opened: true});
  await page.waitForFunction(() => document.getElementById('memory-review-modal').classList.contains('open'));
  assert.strictEqual(await page.locator('#memory-review-body .memory-review-pick').count(), 2);
  await page.locator('#memory-review-body .memory-review-item', {hasText: '洛安开始信任米拉'}).locator('input').uncheck();
  await failSaves('存储空间不足');
  await page.locator('#memory-review-modal .modal-ft .primary').tap();
  await toastShown('写入失败，摘要和辅助记忆未改变：本地存储写入失败');
  current = await state();
  assert.strictEqual(current.summary, '改写后的历史摘要');
  assert.strictEqual(current.entries.length, 2, '写入失败后辅助记忆保持原样');
  assert.strictEqual(await page.evaluate(() => document.getElementById('memory-review-modal').classList.contains('open')), true, '写入失败时预览保留，可再次确认');
  await failSaves(null);
  await page.locator('#memory-review-modal .modal-ft .primary').tap();
  await toastShown('较早对话已整理');
  current = await state();
  assert.strictEqual(current.summary, '久远剧情概览：二人早已相识。 近期较早剧情：米拉与洛安在月门前会合。');
  assert.deepStrictEqual(current.entries.map(item => item.content), ['米拉在月门前立下约定', '米拉记住了洛安的名字', '米拉与洛安在月门前会合'], '取消勾选的变更不写入');

  await page.evaluate(() => { getActiveSession('mm-char').memoryStore.historySummary = null; });
  assert.deepStrictEqual(await review(), {pending: true, opened: true});
  await page.evaluate(() => { getActiveSession('mm-char').msgs[3].content = '已被改写的原文'; });
  await page.locator('#memory-review-modal .modal-ft .primary').tap();
  await toastShown('这段对话在确认前已改变，本次整理结果已丢弃');
  assert.strictEqual(await page.evaluate(() => document.getElementById('memory-review-modal').classList.contains('open')), false);
  assert.strictEqual((await state()).entries.length, 3, '预览失效后不写入任何变更');

  // Data safety: legacy duplicate IDs retain every body/reference, and automatic capacity only
  // evicts proven unmaintained derivatives. Manual edits and disabled entries survive save/load.
  const capacity = await page.evaluate(async () => {
    const sess = createBlankSession('容量保护', 'capacity-session');
    const entry = (id, extra = {}) => memoryV5NormalizeLongTerm(Object.assign({
      id, type: 'key_event', content: `共同约定${id}`, importance: 5, origin: 'summary', userMaintained: false,
    }, extra), sess.id);
    sess.memoryStore.longTermEntries = [entry('duplicate'), entry('duplicate', {content: '另一条正文'}), entry('link', {relatedIds: ['duplicate'], supersededBy: 'duplicate'})];
    const normalized = ensureSessionMemoryStore(sess), ids = normalized.longTermEntries.map(item => item.id);
    const identity = {ids, bodies: normalized.longTermEntries.map(item => item.content), links: normalized.longTermEntries[2].relatedIds, supersededBy: normalized.longTermEntries[2].supersededBy};
    const normalizedBefore = JSON.stringify(normalized);
    ensureSessionMemoryStore(sess);
    identity.stable = JSON.stringify(sess.memoryStore) === normalizedBefore;
    const protectedEntries = [
      entry('manual', {origin: 'manual', importance: 1, userMaintained: true}),
      entry('edited', {importance: 1, userMaintained: true}),
      entry('disabled', {importance: 1, status: 'archived', active: false, userMaintained: true}),
      entry('unknown', {importance: 1, userMaintained: undefined}),
    ];
    sess.memoryStore.longTermEntries = protectedEntries.concat(Array.from({length: 1001}, (_, i) => entry(`auto${i}`)));
    memoryV5ApplyBatch(sess.memoryStore, {
      historySummary: memoryV5NormalizeHistorySummary({text: '容量保护摘要', sourceStartSeq: 1, sourceEndSeq: 1}, sess.id), entries: [],
    });
    D.chats['mm-char'].sessions.push(sess);
    await saveData('sessions', {urgent: true});
    const loaded = (await YeyuRepository.load()).data.chats['mm-char'].sessions.find(item => item.id === sess.id).memoryStore;
    return {identity, protectedRows: loaded.longTermEntries.filter(item => protectedEntries.some(row => row.id === item.id)).map(item => ({id: item.id, status: item.status, userMaintained: item.userMaintained})), derivedCount: loaded.longTermEntries.filter(item => item.origin === 'summary' && item.userMaintained === false).length};
  });
  assert.strictEqual(new Set(capacity.identity.ids).size, 3);
  assert.deepStrictEqual(capacity.identity.bodies, ['共同约定duplicate', '另一条正文', '共同约定link']);
  assert.deepStrictEqual(capacity.identity.links, capacity.identity.ids.slice(0, 2));
  assert.strictEqual(capacity.identity.supersededBy, capacity.identity.ids[0]);
  assert.strictEqual(capacity.identity.stable, true);
  assert.deepStrictEqual(capacity.protectedRows, [
    {id: 'manual', status: 'active', userMaintained: true}, {id: 'edited', status: 'active', userMaintained: true},
    {id: 'disabled', status: 'archived', userMaintained: true}, {id: 'unknown', status: 'active', userMaintained: undefined},
  ]);
  assert.strictEqual(capacity.derivedCount, 1000);

  assert.deepStrictEqual(pageErrors, [], `页面脚本错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log(JSON.stringify({memoryManagerActions: true, saveFailureRollback: true, uniqueIdentities: true, protectedCapacity: true, reviewWrite: true, realPage: true}));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
