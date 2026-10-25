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
  await page.evaluate(() => {
    openModal('settings-modal');
    switchSettingsTab('routes', document.querySelector('#settings-modal .settings-tabs button[onclick="switchSettingsTab(\'routes\',this)"]'));
  });
  const originalRouteName = await page.locator('#s-model-preset-name').inputValue();
  await page.locator('#s-model-preset-name').fill('取消的任务模型方案');
  await page.locator('#settings-modal .modal-ft .btn.text').click();
  await page.evaluate(() => {
    openModal('settings-modal');
    switchSettingsTab('routes', document.querySelector('#settings-modal .settings-tabs button[onclick="switchSettingsTab(\'routes\',this)"]'));
  });
  assert.strictEqual(await page.locator('#s-model-preset-name').inputValue(), originalRouteName, '取消不保存任务模型草稿');
  await page.locator('#s-model-preset-name').fill('已保存的任务模型方案');
  await page.locator('#settings-modal .modal-ft .btn.primary').click();
  assert.strictEqual(await page.evaluate(() => activeModelPresetForSettings(D.settings).name), '已保存的任务模型方案');

  await page.evaluate(() => {
    openModal('settings-modal');
    switchSettingsTab('retrieval', document.querySelector('#settings-modal .settings-tabs button[onclick="switchSettingsTab(\'retrieval\',this)"]'));
  });
  const originalEmbeddingUrl = await page.locator('#s-embedding-api-url').inputValue();
  await page.locator('#s-embedding-api-url').fill('https://cancelled.example.test/v1');
  await page.locator('#settings-modal .modal-ft .btn.text').click();
  await page.evaluate(() => {
    openModal('settings-modal');
    switchSettingsTab('retrieval', document.querySelector('#settings-modal .settings-tabs button[onclick="switchSettingsTab(\'retrieval\',this)"]'));
  });
  assert.strictEqual(await page.locator('#s-embedding-api-url').inputValue(), originalEmbeddingUrl, '取消不保存语义检索草稿');

  await page.locator('label[for="s-embedding-enabled"]').click();
  await page.locator('label[for="s-vector-chats-enabled"]').click();
  await page.locator('#s-embedding-api-url').fill('https://open.bigmodel.cn/api/paas/v4');
  await page.locator('#s-embedding-api-key').fill('synthetic-key');
  await page.locator('#s-embedding-model').fill('embedding-3');
  await page.locator('#s-embedding-dimensions').fill('1024');
  await page.locator('#settings-modal .modal-ft .btn.primary').click();
  const saved = await page.evaluate(() => ({
    enabled: D.settings.embeddingEnabled,
    chatsEnabled: D.settings.vectorChatsEnabled,
    worldbookEnabled: D.worldBook.vector_enabled,
    apiUrl: D.settings.embeddingApiUrl,
    apiKey: D.settings.embeddingApiKey,
    model: D.settings.embeddingModel,
    dimensions: D.settings.embeddingDimensions,
  }));
  assert.deepStrictEqual(saved, {enabled: true, chatsEnabled: false, worldbookEnabled: true, apiUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'synthetic-key', model: 'embedding-3', dimensions: 1024});


  await page.evaluate(async () => {
    const character = {
      id: 'vector-self-built-character',
      name: '合成角色',
      localizedName: '合成角色',
      extensions: {},
      importMeta: {},
    };
    D.characters = [character];
    D.currentCharId = character.id;
    D.worldBook = {
      scan_depth: 20,
      token_budget: 2048,
      recursive: false,
      activeCategoryId: 'vector-self-built-category',
      globalCategoryIds: ['vector-self-built-category'],
      categories: [{
        id: 'vector-self-built-category',
        name: '自建世界书',
        entries: [],
        boundCharIds: [character.id],
      }],
    };
    openModal('wb-modal');
    await openWBEditor('vector-self-built-category');
    const control = document.getElementById('wb-trigger-mode');
    if (!control) throw new Error('世界书编辑器缺少触发策略三态选择');
    const modes = Array.from(control.options).map((option) => option.value);
    if (modes.join(',') !== 'keyword,constant,vector') throw new Error('触发策略必须是常驻、关键词、向量三选一');
    document.getElementById('wb-content').value = '港口的医生住在灯塔下';
    control.value = 'vector';
    await saveWBEntry();
    const category = D.worldBook.categories[0];
    if (category.entries.length !== 1 || category.entries[0].vectorized !== true) {
      throw new Error('勾选向量条目后必须保存 vectorized=true');
    }
    const entryId = category.entries[0].id;
    editWBEntry(category.id, 0);
    document.getElementById('wb-keys').value = '医生';
    control.value = 'keyword';
    await saveWBEntry();
    if (category.entries[0].vectorized !== false) throw new Error('取消向量条目后必须保存 vectorized=false');
    editWBEntry(category.id, 0);
    document.getElementById('wb-keys').value = '';
    control.value = 'vector';
    await saveWBEntry();
    const savedEntry = category.entries[0];
    if (savedEntry.id !== entryId || savedEntry.vectorized !== true || savedEntry.keys.length !== 0) {
      throw new Error('重新启用纯向量条目时必须保留条目身份并清空关键词');
    }
  });
  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log('vector settings and worldbook edits preserve saved values');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
