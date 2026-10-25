'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;

function makeData() {
  return {
    characters: [{ id: 'char-integrity', name: '数据测试角色' }],
    currentCharId: 'char-integrity',
    personas: [],
    activePersonaId: null,
    settings: {},
    worldBook: { categories: [], globalCategoryIds: [] },
    chats: {
      'char-integrity': {
        activeSid: 'session-integrity',
        sessions: [{ id: 'session-integrity', name: '对话 1', msgs: [{ role: 'user', seq: 1, content: '保留的数据' }], memoryStore: {version: 5, summaryModel: 'rolling-history-v1', historySummary: null, longTermEntries: []} }],
      },
    },
  };
}

async function openPage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
  await waitForAppReady(page, { timeout: 15000 });
  return { context, page, pageErrors };
}

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });

  const repositoryCase = await openPage();
  const repositoryResult = await repositoryCase.page.evaluate(async data => {
    const repo = window.YeyuRepository;
    const deleteDb = () => new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('TavernAI');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('delete failed'));
      request.onblocked = () => reject(new Error('database blocked'));
    });
    const complete = tx => new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
    const deleteMetaState = async () => {
      const db = await repo.open();
      const tx = db.transaction('app_meta', 'readwrite');
      tx.objectStore('app_meta').delete('state');
      await complete(tx);
      db.close();
    };
    const readParts = async () => {
      const db = await repo.open();
      const tx = db.transaction(['characters', 'sessions'], 'readonly');
      const result = await Promise.all([
        new Promise((resolve, reject) => {
          const request = tx.objectStore('characters').get('all');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
        new Promise((resolve, reject) => {
          const request = tx.objectStore('sessions').get('all');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
      ]);
      await complete(tx);
      db.close();
      return result;
    };
    localStorage.removeItem(FALLBACK_KEY);
    await deleteDb();
    const fresh = await repo.load();
    await repo.save(data, { sections: ['meta', 'characters', 'personas', 'worldbook', 'sessions'] });
    const normal = await repo.load();
    await deleteMetaState();
    const before = await readParts();
    let missingError = '';
    try { await loadDataAsync(); } catch (error) { missingError = String(error && error.message || error); }
    const after = await readParts();
    return {
      freshIsNull: fresh === null,
      normalCharacters: normal.data.characters.length,
      missingError,
      unchanged: JSON.stringify(before) === JSON.stringify(after),
      characterCount: after[0].length,
      sessionCount: after[1]['char-integrity'].sessions.length,
    };
  }, makeData());
  assert.strictEqual(repositoryResult.freshIsNull, true, '全新空库必须仍可按首次启动处理');
  assert.strictEqual(repositoryResult.normalCharacters, 1, '正常结构化仓库必须照常读取');
  assert.match(repositoryResult.missingError, /为避免覆盖原数据已停止写入/);
  assert.strictEqual(repositoryResult.unchanged, true, '缺少 app_meta 时启动读取不得写入任何主数据 Store');
  assert.strictEqual(repositoryResult.characterCount, 1);
  assert.strictEqual(repositoryResult.sessionCount, 1);
  assert.deepStrictEqual(repositoryCase.pageErrors, []);
  await repositoryCase.context.close();

  const uiCase = await openPage();
  const page = uiCase.page;
  const mediaResult = await page.evaluate(async () => {
    const imageA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
    const imageB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAusB9Y9ZK1sAAAAASUVORK5CYII=';
    D = defaults();
    const char = {
      id: 'media-char', name: '媒体测试角色', description: '', personality: '', scenario: '', first_mes: '',
      alternate_greetings: [], mes_example: '', system_prompt: '', post_history_instructions: '', creator_notes: '',
      tags: [], creator: null, avatar_image: imageA, background_image: imageB, extensions: { future: { enabled: false } },
      scriptsEnabled: false, regexScripts: [{ id: 'custom', findRegex: '/sample/g', replaceString: 'kept', disabled: true }],
      rawCard: { spec: 'chara_card_v3', data: { name: 'original', extensions: { unknown: ['keep'] } } },
      futureField: { nullable: null, disabled: false, count: 0, nested: ['original'] },
    };
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = { [char.id]: { activeSid: 'media-session', sessions: [{ id: 'media-session', name: '对话 1', msgs: [], memoryStore: makeEmptyMemoryStore() }] } };
    const extensionsBeforeDisplay = structuredClone(char.extensions);
    renderChat();
    const displayReadPreserved = JSON.stringify(char.extensions) === JSON.stringify(extensionsBeforeDisplay);
    await YeyuRepository.save(D, { sections: ['meta', 'characters', 'personas', 'worldbook', 'sessions'] });
    await editCharacter(char.id);
    $('c-desc').value = 'edited description';
    clearCharacterBackground();
    await saveCharacter();
    await flushPendingSave();
    const loaded = await YeyuRepository.load();
    const stored = loaded.data.characters[0];
    const inspection = await YeyuRepository.inspect(loaded.data);
    const avatarData = await loadStoredMediaDataUrl(stored, 'avatar_image');
    return {
      background: stored.background_image,
      backgroundRef: stored._media && stored._media.background_image,
      backgroundHash: stored._mediaHash && stored._mediaHash.background_image,
      avatar: stored.avatar_image,
      avatarData,
      avatarBlob: !!(stored._mediaBlobs && stored._mediaBlobs.avatar_image instanceof Blob),
      avatarRef: stored._media && stored._media.avatar_image,
      mediaCount: inspection.mediaCount,
      orphanCount: inspection.orphanCount,
      description: stored.description,
      scriptsEnabled: stored.scriptsEnabled,
      regexScripts: stored.regexScripts,
      rawCard: stored.rawCard,
      futureField: stored.futureField,
      creator: stored.creator,
      extensions: stored.extensions,
      displayReadPreserved,
    };
  });
  assert.strictEqual(mediaResult.background || '', '');
  assert.strictEqual(mediaResult.backgroundRef, undefined);
  assert.strictEqual(mediaResult.backgroundHash, undefined);
  assert.strictEqual(mediaResult.avatar || '', '', '运行时头像字段不得回填 data URL');
  assert.strictEqual(mediaResult.avatarBlob, true, '重载后头像必须挂上 Blob');
  assert.match(mediaResult.avatarData, /^data:image\//);
  assert.strictEqual(mediaResult.description, 'edited description');
  assert.strictEqual(mediaResult.scriptsEnabled, false, '普通编辑并重载后，关闭的运行组件必须仍关闭');
  assert.deepStrictEqual(mediaResult.regexScripts, [{ id: 'custom', findRegex: '/sample/g', replaceString: 'kept', disabled: true }]);
  assert.deepStrictEqual(mediaResult.rawCard, { spec: 'chara_card_v3', data: { name: 'original', extensions: { unknown: ['keep'] } } });
  assert.deepStrictEqual(mediaResult.futureField, { nullable: null, disabled: false, count: 0, nested: ['original'] });
  assert.strictEqual(mediaResult.creator, null, '非编辑字段的空值语义也必须保留');
  assert.strictEqual(mediaResult.displayReadPreserved, true, '聊天显示读取不得给角色主数据补写默认扩展');
  assert.deepStrictEqual(mediaResult.extensions, { future: { enabled: false } });

  const editorResult = await page.evaluate(async () => {
    const char = D.characters[0], expected = JSON.stringify({ scriptsEnabled: char.scriptsEnabled, regexScripts: char.regexScripts, rawCard: char.rawCard, futureField: char.futureField });
    await editCharacter(char.id);
    await saveCharacter();
    await flushPendingSave();
    const loaded = (await YeyuRepository.load()).data.characters[0];
    const unchanged = expected === JSON.stringify({ scriptsEnabled: loaded.scriptsEnabled, regexScripts: loaded.regexScripts, rawCard: loaded.rawCard, futureField: loaded.futureField });
    await editCharacter(char.id);
    const before = D.characters[0], beforeJson = JSON.stringify(before), originalSave = saveData;
    $('c-name').value = 'failed rename';
    $('c-desc').value = 'must roll back';
    clearCharacterAvatar();
    saveData = async () => { throw new Error('fixture save failure'); };
    try { await saveCharacter(); } finally { saveData = originalSave; }
    const rollback = D.characters[0] === before && JSON.stringify(before) === beforeJson;
    await editCharacter(char.id);
    clearCharacterAvatar();
    await saveCharacter();
    await flushPendingSave();
    const cleared = (await YeyuRepository.load()).data.characters[0];
    const avatarCleared = !cleared.avatar_image && !(cleared._media && cleared._media.avatar_image) && !(cleared._mediaBlobs && cleared._mediaBlobs.avatar_image);
    const replacement = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAusB9Y9ZK1sAAAAASUVORK5CYII=';
    await editCharacter(char.id);
    $('c-avatar-data').value = replacement;
    $('temp-bg-data').value = replacement;
    await saveCharacter();
    await flushPendingSave();
    const replaced = (await YeyuRepository.load()).data.characters[0];
    const replacedBoth = await loadStoredMediaDataUrl(replaced, 'avatar_image') === replacement && await loadStoredMediaDataUrl(replaced, 'background_image') === replacement;
    return { unchanged, rollback, avatarCleared, replacedBoth };
  });
  assert.deepStrictEqual(editorResult, { unchanged: true, rollback: true, avatarCleared: true, replacedBoth: true });
  assert.ok(mediaResult.avatarRef, '清除背景不得影响头像引用');
  assert.strictEqual(mediaResult.mediaCount, 1, '已解除引用的背景 Blob 必须被清理');
  assert.strictEqual(mediaResult.orphanCount, 0);
  await page.evaluate(() => {
    closeModal('create-modal');
    document.getElementById('toasts').replaceChildren();
  });

  await page.evaluate(() => {
    const fixture = {
      sessions: [
        { id: 'parent', name: '主线', msgs: [], memoryStore: makeEmptyMemoryStore() },
        { id: 'child', name: '支线一', parentSessionId: 'parent', rootSessionId: 'parent', msgs: [], memoryStore: makeEmptyMemoryStore() },
        { id: 'grandchild', name: '支线二', parentSessionId: 'child', rootSessionId: 'parent', msgs: [], memoryStore: makeEmptyMemoryStore() },
        { id: 'other', name: '普通对话', msgs: [], memoryStore: makeEmptyMemoryStore() },
      ],
      activeSid: 'grandchild',
    };
    D.characters = [{ id: 'delete-char', name: '删除测试角色' }];
    D.currentCharId = 'delete-char';
    D.chats = { 'delete-char': JSON.parse(JSON.stringify(fixture)) };
    window.__cascadeDeleteDeleteOriginals = {
      saveData: window.saveData,
      markStreamDraftsStaleForSession: window.markStreamDraftsStaleForSession,
    };
    window.saveData = async () => {};
    window.markStreamDraftsStaleForSession = async () => {};
    document.getElementById('toasts').replaceChildren();
    renderSessions();
    window.__cascadeDeleteDeletePromise = deleteSession('parent');
  });
  await page.locator('#app-prompt-modal.open').waitFor();
  await page.waitForTimeout(300);

  await page.locator('#app-prompt-ok').click();
  const deleteResult = await page.evaluate(async () => {
    await window.__cascadeDeleteDeletePromise;
    const result = JSON.parse(JSON.stringify(D.chats['delete-char']));
    Object.assign(window, window.__cascadeDeleteDeleteOriginals);
    delete window.__cascadeDeleteDeleteOriginals;
    delete window.__cascadeDeleteDeletePromise;
    return result;
  });
  assert.deepStrictEqual(deleteResult.sessions.map(row => row.id), ['other']);
  assert.strictEqual(deleteResult.activeSid, 'other');

  await page.evaluate(() => {
    D.characters = [{ id: 'delete-char', name: '删除测试角色', first_mes: '', alternate_greetings: [] }];
    D.currentCharId = 'delete-char';
    D.chats = {
      'delete-char': {
        sessions: [
          { id: 'parent-only', name: '唯一主线', msgs: [{ role: 'user', seq: 1, content: '需要清空的内容' }], memoryStore: makeEmptyMemoryStore() },
          { id: 'child-only', name: '唯一支线', parentSessionId: 'parent-only', rootSessionId: 'parent-only', msgs: [], memoryStore: makeEmptyMemoryStore() },
        ],
        activeSid: 'child-only',
      },
    };
    window.__cascadeDeleteLastCascadeOriginals = {
      saveData: window.saveData,
      flushPendingSave: window.flushPendingSave,
      markStreamDraftsStaleForSession: window.markStreamDraftsStaleForSession,
    };
    window.saveData = async () => {};
    window.flushPendingSave = async () => {};
    window.markStreamDraftsStaleForSession = async () => {};
    renderSessions();
    window.__cascadeDeleteLastCascadePromise = deleteSession('parent-only');
  });
  await page.locator('#app-prompt-modal.open').waitFor();
  await page.waitForTimeout(300);

  await page.locator('#app-prompt-ok').click();
  const lastCascadeResult = await page.evaluate(async () => {
    await window.__cascadeDeleteLastCascadePromise;
    const result = JSON.parse(JSON.stringify(D.chats['delete-char']));
    Object.assign(window, window.__cascadeDeleteLastCascadeOriginals);
    delete window.__cascadeDeleteLastCascadeOriginals;
    delete window.__cascadeDeleteLastCascadePromise;
    return result;
  });
  assert.deepStrictEqual(lastCascadeResult.sessions.map(row => row.id), ['parent-only']);
  assert.strictEqual(lastCascadeResult.activeSid, 'parent-only');
  assert.deepStrictEqual(lastCascadeResult.sessions[0].msgs, []);
  assert.strictEqual(lastCascadeResult.sessions[0].nextMessageSeq, 2, '清空不得复用原消息的身份');

  assert.deepStrictEqual(uiCase.pageErrors, []);
  await uiCase.context.close();

  console.log(JSON.stringify({
    repository: {
      missingMetaBlocked: true,
      freshAndNormalUnchanged: true,
    },
    media: { backgroundRemoved: true, avatarPreserved: true, mediaCount: mediaResult.mediaCount },
    import: { prototypeSafe: true, branchMetadataIgnored: true, ownExportSemanticsRoundTrip: true },
    sessions: { cascadedDescendants: 2, lastCascadeKeepsUsableSession: true },
    viewport: { width: 390, height: 844 },
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
