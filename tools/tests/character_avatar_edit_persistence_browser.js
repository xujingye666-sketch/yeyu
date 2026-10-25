'use strict';

// An avatar that is stored but cannot be read for a moment is not an avatar the user removed. Opening the editor
// while the media read fails, then saving only a new name once reads work again, must keep the stored avatar
// through media cleanup and a reload.
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');

const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  const port = await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  const open = async () => {
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await waitForAppReady(page);
  };
  const storedState = () => page.evaluate(async () => {
    const char = D.characters[0];
    return {name: char.name, mediaKey: (char._media || {}).avatar_image || '', avatar: await loadStoredMediaDataUrl(char, 'avatar_image'),
      blobKeys: await new Promise((resolve, reject) => {
        const request = indexedDB.open(YeyuRepository.DB_NAME || 'TavernAI');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const keys = request.result.transaction('media', 'readonly').objectStore('media').getAllKeys();
          keys.onsuccess = () => { request.result.close(); resolve(keys.result); };
          keys.onerror = () => reject(keys.error);
        };
      })};
  });

  await open();
  await page.evaluate(async avatar => {
    D = defaults();
    const char = parseCard({spec: 'chara_card_v2', spec_version: '2.0', data: {name: '头像守夜人', description: '守着灯塔。', first_mes: '灯塔的门开了。'}});
    char.id = 'avatar-edit-card';
    char.avatar_image = avatar;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {activeSid: null, sessions: []}};
    await saveData(['meta', 'characters', 'personas', 'worldbook', 'sessions'], {urgent: true});
  }, PIXEL_PNG);

  await open();
  const before = await storedState();
  assert.ok(before.mediaKey && before.blobKeys.includes(before.mediaKey), '头像应存成媒体 Blob');
  assert.strictEqual(before.avatar, PIXEL_PNG, '重载后头像应能读出');

  // Open the editor while one media read fails, then reads recover and only the name changes.
  const editor = await page.evaluate(async () => {
    const original = YeyuRepository.loadMediaValue;
    let failed = false;
    YeyuRepository.loadMediaValue = async function () {
      if (!failed) { failed = true; throw new Error('fixture media read failed'); }
      return original.apply(this, arguments);
    };
    try { await editCharacter('avatar-edit-card'); } finally { YeyuRepository.loadMediaValue = original; }
    $('c-name').value = '改名守夜人';
    await commitCharacterEditor();
    await saveData(['characters'], {urgent: true});
    return {failed, avatarField: $('c-avatar-data').value};
  });
  assert.ok(editor.failed, '夹具应让打开编辑器时的头像读取失败一次');
  assert.strictEqual(editor.avatarField, '', '读取失败时编辑器不显示头像');

  const afterSave = await storedState();
  assert.strictEqual(afterSave.name, '改名守夜人');
  assert.strictEqual(afterSave.mediaKey, before.mediaKey, '只改名保存不得丢掉头像媒体引用');
  assert.ok(afterSave.blobKeys.includes(before.mediaKey), '媒体清理后头像 Blob 必须仍在');

  await open();
  const reloaded = await storedState();
  assert.strictEqual(reloaded.name, '改名守夜人');
  assert.strictEqual(reloaded.avatar, PIXEL_PNG, '重载应用后原头像仍在');
  console.log('renaming a character after a failed avatar read keeps the stored avatar');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) server.close();
});
