'use strict';

// Card import from the real file picker with AI localization. The model is a page-level stub of the
// completion call, so batches can fail, come back short or hang on demand; storage is the real
// IndexedDB repository. A card is written once, after every batch is complete, or not at all.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');

const {waitForAppReady} = require('./helpers/app-ready');
const assets = path.resolve(__dirname, '../../app/src/main/assets');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngTextChunk(keyword, text) {
  const type = Buffer.from('tEXt');
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}

// 440 English entries plus 15 blank shells in a PNG card, a pure Chinese card and a small English card.
function writeImportFixtures() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeyu-card-import-'));
  const entries = Array.from({length: 440}, (_, index) => ({
    id: index + 1, name: `Lore ${index + 1}`, keys: [`Trigger ${index + 1}`], secondary_keys: [`Condition ${index + 1}`],
    content: `Reversible fixture content ${index + 1} `.repeat(18), order: 900 - index, probability: 60 + (index % 41), extensions: {unknown: {index}},
  }));
  for (let index = 440; index < 455; index += 1) entries.push({id: index + 1, name: '', keys: [], secondary_keys: [], content: '', comment: '', order: index, probability: 100, extensions: {emptyRule: index}});
  const pngCard = {spec: 'chara_card_v2', spec_version: '2.0', data: {name: 'English Import PNG', description: 'English card for real Edge DOM', character_book: {name: 'English Import Lore', entries}}};
  const basePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const iend = basePng.lastIndexOf(Buffer.from('IEND')) - 4;
  const png = path.join(directory, 'english-large.png');
  fs.writeFileSync(png, Buffer.concat([basePng.subarray(0, iend), pngTextChunk('chara', Buffer.from(JSON.stringify(pngCard)).toString('base64')), basePng.subarray(iend)]));
  const chinese = path.join(directory, 'chinese.json');
  fs.writeFileSync(chinese, JSON.stringify({spec: 'chara_card_v2', spec_version: '2.0', data: {name: '中文直导角色', description: '中文内容', character_book: {name: '中文世界书', entries: [{name: '地点', keys: ['神社'], secondary_keys: ['夜晚'], content: '中文正文'}]}}}));
  const small = path.join(directory, 'retry-small.json');
  fs.writeFileSync(small, JSON.stringify({spec: 'chara_card_v2', spec_version: '2.0', data: {name: 'Retry Card', character_book: {name: 'Retry Lore', entries: [{name: 'Place', keys: ['Scarlet Mansion', 'Moon Gate'], secondary_keys: ['Night'], content: 'Small retry fixture'}]}}}));
  return {directory, png, chinese, small};
}

let browser;
let server;
let fixture;
(async () => {
  fixture = writeImportFixtures();
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  await context.route(url => !String(url).startsWith(origin), route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`${origin}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);
  const storedData = () => page.evaluate(async () => { await flushPendingSave(); return (await YeyuRepository.load()).data; });

  // Characters and personas created by hand in their editors reach storage.
  await page.evaluate(async () => {
    const confirm = window.appConfirm;
    window.appConfirm = async () => false;
    try {
      openCharacterCreator();
      $('c-name').value = '手动角色';
      $('c-desc').value = '由用户手动填写';
      await saveCharacter();
    } finally { window.appConfirm = confirm; }
    closeModal('create-modal');
    $('persona-edit-id').value = '';
    $('p-name').value = '手动人格';
    $('p-desc').value = '由用户手动填写';
    await savePersona();
  });
  const manual = await storedData();
  assert.ok(manual.characters.some(row => row.name === '手动角色' && row.description === '由用户手动填写'), '编辑器新建的角色必须落库');
  assert.ok(manual.personas.some(row => row.name === '手动人格' && row.desc === '由用户手动填写'), '编辑器新建的人格必须落库');

  const openImport = async () => {
    await page.evaluate(() => { if ($('import-modal').classList.contains('open')) closeModal('import-modal'); resetImport(); openModal('import-modal'); });
    await page.locator('#file-input').waitFor({state: 'attached'});
  };
  const confirmImport = () => page.locator('#import-preview .import-confirm').click();

  // Closing the import sheet releases the preview's Blob URLs and forgets the pending cards.
  await openImport();
  await page.locator('#file-input').setInputFiles(fixture.png);
  await page.locator('#import-preview .import-mode-card').waitFor();
  await page.evaluate(() => {
    window.__revokedUrls = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = url => { window.__revokedUrls.push(url); revoke.call(URL, url); };
    window.__pendingAvatar = pending[0].avatar_image;
  });
  await page.locator('#import-modal .modal-close').click();
  const closed = await page.evaluate(() => ({revoked: window.__revokedUrls.includes(window.__pendingAvatar), avatar: window.__pendingAvatar, pending: pending.length, preview: $('import-preview').textContent}));
  assert.ok(/^blob:/.test(closed.avatar) && closed.revoked, '关闭导入弹窗必须释放待导入卡的 Blob URL');
  assert.strictEqual(closed.pending, 0, '关闭导入弹窗必须清空待导入对象');
  assert.strictEqual(closed.preview, '', '关闭导入弹窗必须清空预览');

  await page.evaluate(() => {
    const originalRoute = resolveApiRoute;
    const originalSave = saveData;
    window.__import = {saveParts: [], saveStacks: [], requests: [], mode: 'recover', initialFailures: 0, partialDone: false};
    window.saveData = async (parts, options) => {
      window.__import.saveParts.push(JSON.parse(JSON.stringify(parts == null ? null : parts)));
      window.__import.saveStacks.push(String(new Error().stack || ''));
      return originalSave(parts, options);
    };
    window.waitMs = async () => {};
    window.__realConfirm = window.appConfirm;
    window.appConfirm = async () => true;
    window.resolveApiRoute = task => task === 'importLocalization'
      ? {task: 'importLocalization', apiKey: 'stub-key', apiUrl: 'https://example.test/v1', model: 'stub-model', translation: true}
      : originalRoute(task);
    const reply = content => ({json: async () => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(content)}}]})});
    window.fetchCompatibleCompletion = async (_route, body, signal) => {
      const state = window.__import;
      const input = JSON.parse(body.messages[1].content);
      state.requests.push({kind: input.kind, ids: (input.labels || input.terms || input.entries || []).map(row => String(row.id))});
      if (state.mode === 'hang') return await new Promise((_resolve, reject) => {
        const stop = () => { const error = new Error('用户取消导入'); error.name = 'AbortError'; reject(error); };
        if (signal && signal.aborted) stop(); else if (signal) signal.addEventListener('abort', stop, {once: true});
      });
      if (state.mode === 'invalid') {
        const field = input.kind === 'names' ? 'labels' : 'terms';
        return reply({[field]: (input[field] || []).map(row => ({id: row.id, zh: 'English only', aliases: []}))});
      }
      if (state.mode === 'recover' && state.initialFailures < 2) {
        state.initialFailures += 1;
        const error = new Error('503 simulated first-batch failure'); error.status = 503; throw error;
      }
      if (input.kind === 'names') return reply({labels: input.labels.map((row, index) => ({id: row.id, zh: `汉化名称${['甲', '乙', '丙', '丁'][index % 4]}`, aliases: []}))});
      let terms = input.terms || [];
      if (state.mode === 'recover' && !state.partialDone && terms.length > 1) { state.partialDone = true; terms = terms.slice(0, -1); }
      return reply({terms: terms.map(row => ({id: row.id, zh: `中文${row.id}`, aliases: []}))});
    };
  });

  // Two failed batches and one short batch are recovered inside the import; the card is saved once.
  await openImport();
  await page.locator('#file-input').setInputFiles(fixture.png);
  await page.locator('#import-preview .import-mode-card').waitFor();
  assert.strictEqual(await page.evaluate(() => pendingImportMode(pending[0])), 'ai', '英文名称与触发词必须建议 AI 汉化');
  await page.locator('input[name="import-mode-0"][value="ai"]').check();
  await page.evaluate(() => { window.__import.saveParts = []; window.__import.saveStacks = []; });
  await confirmImport();
  await page.waitForFunction(() => D.characters.some(card => card.name === 'English Import PNG'), null, {timeout: 30000});
  const recovered = await page.evaluate(() => {
    const card = D.characters.find(row => row.name === 'English Import PNG');
    const category = D.worldBook.categories.find(row => Array.isArray(row.boundCharIds) && row.boundCharIds.includes(card.id));
    const state = window.__import;
    return {
      cardId: card.id,
      report: characterBookImportReport(card),
      rawEntries: card.importMeta.rawCard.data.character_book.entries.length,
      categoryEntries: category && category.entries.length,
      initialFailures: state.initialFailures,
      partialDone: state.partialDone,
      atomicSaves: state.saveParts.filter((parts, index) => Array.isArray(parts) && ['characters', 'sessions', 'worldbook'].every(part => parts.includes(part)) && state.saveStacks[index].includes('commitPreparedCharacterCards')).length,
      derived: (() => { const source = derivedCharacterBackground(card); return !!source && (source === card.avatar_image || /^blob:/i.test(source)) && !card.background_image; })(),
    };
  });
  assert.deepStrictEqual(recovered.report, {imported: 440, blank: 15, unrecognized: 0, source: 455, unsupported: 0, unsupportedItems: []});
  assert.strictEqual(recovered.rawEntries, 455, '原卡必须保留全部 455 条');
  assert.strictEqual(recovered.categoryEntries, 440);
  assert.strictEqual(recovered.initialFailures, 2, '应模拟首次两个批次失败');
  assert.strictEqual(recovered.partialDone, true, '应模拟一次缺失 ID 并内部补齐');
  assert.strictEqual(recovered.atomicSaves, 1, '角色卡必须在 100% 完成后只原子保存一次');
  assert.strictEqual(recovered.derived, true, 'PNG 卡图必须只存头像，并由聊天层派生背景');
  const afterRecover = await storedData();
  const storedCategory = afterRecover.worldBook.categories.find(row => (row.boundCharIds || []).includes(recovered.cardId));
  assert.ok(afterRecover.characters.some(row => row.id === recovered.cardId) && storedCategory && storedCategory.entries.length === 440, '汉化导入的角色与随卡世界书必须一起落库');

  // A pure Chinese card imports directly with no model call and no localized name.
  await page.evaluate(() => { window.__import.requests = []; window.__import.mode = 'success'; });
  await openImport();
  await page.locator('#file-input').setInputFiles(fixture.chinese);
  await page.waitForFunction(() => pending.length === 1 && document.querySelectorAll('#import-preview .import-mode-card').length === 1);
  assert.strictEqual(await page.evaluate(() => pendingImportMode(pending[0])), 'direct', '纯中文卡必须建议直接导入');
  await page.locator('input[name="import-mode-0"][value="direct"]').check();
  await confirmImport();
  await page.waitForFunction(() => D.characters.some(card => card.name === '中文直导角色') && !pending.length && !$('import-modal').classList.contains('open'));
  const chineseDirect = await page.evaluate(() => ({requests: window.__import.requests.length, localized: D.characters.find(card => card.name === '中文直导角色').localizedName}));
  assert.strictEqual(chineseDirect.requests, 0, '纯中文卡直接导入时 AI 请求必须为 0');
  assert.ok(!chineseDirect.localized, '直接导入不得写入汉化名');

  // Direct import of English triggers asks first in the real confirm dialog; cancelling keeps everything as it was.
  const retryCount = () => page.evaluate(() => ({count: D.characters.filter(card => card.name === 'Retry Card').length, pending: pendingImportSnapshots(pending)}));
  const riskPrompt = page.locator('#app-prompt-modal');
  await page.evaluate(() => { window.__import.requests = []; window.appConfirm = window.__realConfirm; });
  await openImport();
  await page.locator('#file-input').setInputFiles(fixture.small);
  await page.waitForFunction(() => pending.length === 1);
  await page.locator('input[name="import-mode-0"][value="direct"]').check();
  const riskBefore = await retryCount();
  await confirmImport();
  await page.waitForFunction(() => $('app-prompt-modal').classList.contains('open') || !pending.length);
  const risk = await page.evaluate(() => ({open: $('app-prompt-modal').classList.contains('open'), message: $('app-prompt-message').textContent}));
  assert.ok(risk.open && /可能无法被中文对话触发/.test(risk.message), `英文触发词直接导入必须先弹风险确认：${JSON.stringify(risk)}`);
  assert.deepStrictEqual(await retryCount(), riskBefore, '风险确认前不得写入角色卡');
  await riskPrompt.locator('.modal-ft').getByRole('button', {name: '取消'}).click();
  await page.waitForFunction(() => !$('app-prompt-modal').classList.contains('open'));
  assert.deepStrictEqual(await retryCount(), riskBefore, '取消风险确认不得导入且 pending 必须不变');
  await confirmImport();
  await page.waitForFunction(() => $('app-prompt-modal').classList.contains('open'));
  await riskPrompt.locator('#app-prompt-ok').click();
  await page.waitForFunction(count => D.characters.filter(card => card.name === 'Retry Card').length === count + 1 && !pending.length && !$('import-modal').classList.contains('open'), riskBefore.count);
  assert.strictEqual(await page.evaluate(() => window.__import.requests.length), 0, '确认风险后直接导入时 AI 请求必须为 0');
  await page.evaluate(() => { window.appConfirm = async () => true; });

  // Cancelling while a batch is in flight leaves no half-imported card and the pending card untouched.
  await page.evaluate(() => { window.__import.mode = 'hang'; window.__import.requests = []; });
  await openImport();
  await page.locator('#file-input').setInputFiles(fixture.small);
  await page.waitForFunction(() => pending.length === 1);
  await page.locator('input[name="import-mode-0"][value="ai"]').check();
  const cancelBefore = await retryCount();
  await confirmImport();
  await page.waitForFunction(() => document.getElementById('import-progress-modal').classList.contains('open'));
  await page.locator('#import-progress-cancel').click();
  await page.waitForFunction(() => !window._importProgressActive);
  assert.deepStrictEqual(await retryCount(), cancelBefore, '取消导入不得产生角色半成品，pending 必须逐字段不变');

  // A localization that never completes imports nothing; the next attempt starts from the full task list.
  await page.evaluate(() => { window.__import.mode = 'invalid'; window.__import.requests = []; });
  await openImport();
  await page.locator('#file-input').setInputFiles(fixture.small);
  await page.waitForFunction(() => pending.length === 1);
  await page.locator('input[name="import-mode-0"][value="ai"]').check();
  const failureBefore = await retryCount();
  await confirmImport();
  await page.waitForFunction(() => !window._importProgressActive);
  assert.deepStrictEqual(await retryCount(), failureBefore, '最终汉化不完整时整卡不得导入且 pending 不变');
  await page.evaluate(() => { window.__import.mode = 'success'; window.__import.requests = []; });
  await confirmImport();
  await page.waitForFunction(count => D.characters.filter(card => card.name === 'Retry Card').length === count + 1, failureBefore.count);
  const retry = await page.evaluate(() => ({requests: window.__import.requests.length, firstTermIds: (window.__import.requests.find(row => row.kind === 'terms') || {}).ids || []}));
  assert.ok(retry.requests > 0 && retry.firstTermIds.length >= 4, '重试必须从完整固定任务清单重新开始，不能依赖上次泄漏状态');

  // Replacing a card merges its world book into the existing category instead of adding another one.
  const replaced = await page.evaluate(async () => {
    const sourceCard = () => parseCard({name: 'Replace target', first_mes: 'opening', character_book: {
      name: 'Replace target lore', description: 'book description', extensions: {fixture_book: {kept: true}},
      entries: [{keys: ['alpha'], content: 'alpha body', enabled: true}],
    }});
    await commitPreparedCharacterCards([sourceCard()]);
    const target = D.characters.find(row => row.name === 'Replace target');
    // A book the user also bound to a second character keeps that binding across a replace-import.
    D.worldBook.categories.find(row => row.name === 'Replace target lore').boundCharIds.push('second-owner');
    await commitPreparedCharacterCards([sourceCard()], {replaceId: target.id});
    const ownBook = () => D.worldBook.categories.find(row => row.name === 'Replace target lore');
    ownBook().entries.push(normalizeWBEntry({id: '0', keys: ['own'], content: 'user added', enabled: true}));
    const replacement = sourceCard();
    await commitPreparedCharacterCards([replacement], {replaceId: target.id});
    const books = D.worldBook.categories.filter(row => row.sourceType === 'character_card'
      && (row.ownerCharId === target.id || (row.boundCharIds || []).includes(target.id)));
    return {
      targetId: target.id,
      entries: ownBook().entries.map(entry => [entry.id, entry.content]),
      synced: replacement.importMeta.worldBookImportReport.synced,
      books: books.map(book => ({name: book.name, owner: book.ownerCharId, bound: book.boundCharIds, description: book.description,
        extensions: book.extensions, source: book.sourceMeta && book.sourceMeta.source})),
      world: D.characters.find(row => row.id === target.id).extensions.world,
    };
  });
  assert.deepStrictEqual(replaced.entries.map(([, content]) => content), ['alpha body', 'user added'], '替换导入必须换掉随卡条目并保留用户新增条目');
  assert.strictEqual(replaced.entries[1][0], '0', '用户新增条目必须保留原 id');
  assert.deepStrictEqual(replaced.synced, [{name: 'Replace target lore', replaced: 1, imported: 1, kept: 1}], '导入报告必须记录替换与保留的条目数');
  assert.strictEqual(replaced.books.length, 1, '反复替换只能留下一本随卡世界书');
  const [book] = replaced.books;
  assert.deepStrictEqual({name: book.name, owner: book.owner, description: book.description, kept: book.extensions.fixture_book.kept, source: book.source},
    {name: 'Replace target lore', owner: replaced.targetId, description: 'book description', kept: true, source: 'character_book'}, '替换后的世界书必须带上新卡的描述、扩展与来源并保留归属');
  assert.ok(book.bound.includes('second-owner') && book.bound.filter(id => id === replaced.targetId).length === 1, '替换后的世界书必须保留额外绑定且不重复');
  assert.strictEqual(replaced.world, 'Replace target lore', '替换后的角色必须指向合并后的世界书');

  assert.deepStrictEqual(pageErrors, [], `页面错误：${pageErrors.join('\n')}`);
  console.log(JSON.stringify({manualCreate: true, blobRelease: true, atomicLocalizedImport: true, directImportNoAi: true, directImportRiskConfirm: true, cancelClean: true, incompleteRetry: true, replaceMerge: true}));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture) fs.rmSync(fixture.directory, {recursive: true, force: true});
});
