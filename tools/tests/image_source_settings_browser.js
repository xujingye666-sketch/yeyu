'use strict';

// 设置页「生图」分区：图片来源与出图提示词只在底部保存时落盘，取消丢弃，重载后仍在。
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {waitForAppReady} = require('./helpers/app-ready');

const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const summaryInput = '#image-assistant-prompt-imageGeneration-summary';
let browser;
let server;

async function openImageTab(page) {
  await page.evaluate(() => {
    switchAppPage('settings');
    switchSettingsTab('image', Array.from(document.querySelectorAll('#settings-modal .tabs button')).find((b) => b.textContent === '生图'));
  });
}
async function saveAndReload(page) {
  await page.evaluate(() => saveSettings());
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
}

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  page.setDefaultTimeout(15000);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);
  await page.evaluate(async () => {
    D.settings.providers[0].apiUrl = 'https://chat.example.test/v1';
    D.settings.providers[0].model = 'chat-model';
    await saveData('meta');
  });

  // 新增自定义来源（默认 OpenAI 图片接口）、填参数、改提示词，保存后重载仍在。
  await openImageTab(page);
  assert.strictEqual(await page.locator('#image-source-empty').isVisible(), true, '没有来源时显示空状态');
  await page.evaluate(() => { addImageSource(); });
  await page.locator('#app-prompt-choice label', {hasText: '自定义图片接口'}).click();
  await page.locator('#app-prompt-ok').click();
  await page.locator('#image-source-url').fill('https://images.example.test/v1/');
  await page.locator('#image-source-key').fill('synthetic-image-key');
  await page.locator('#image-source-model').fill('sd-model');
  await page.locator('#image-source-size').fill('768x1024');
  await page.evaluate(() => {
    document.getElementById('image-source-count').value = '3';
    document.getElementById('image-source-prompt-mode').value = 'desensitize';
  });
  await page.locator(summaryInput).fill('自定义直接总结提示词');
  await saveAndReload(page);
  const saved = await page.evaluate(() => ({
    sources: D.settings.imageSources.map(({id, ...row}) => ({active: id === D.settings.activeImageSourceId, ...row})),
    summary: assistantPromptText('imageGeneration', 'summary'),
  }));
  assert.deepStrictEqual(saved, {
    sources: [{
      active: true,
      type: 'openai',
      format: 'openai',
      name: '图片来源 1',
      apiUrl: 'https://images.example.test/v1',
      apiKey: 'synthetic-image-key',
      model: 'sd-model',
      models: [],
      aspectRatio: '',
      size: '768x1024',
      n: 3,
      promptMode: 'desensitize',
    }],
    summary: '自定义直接总结提示词',
  });

  // 修改后点取消：草稿丢弃，已保存的设置不变。
  await openImageTab(page);
  assert.strictEqual(await page.locator('#image-source-model').inputValue(), 'sd-model');
  await page.locator('#image-source-model').fill('changed-model');
  await page.locator(summaryInput).fill('不应保存');
  await page.evaluate(() => { addImageSource(); });
  await page.locator('#app-prompt-choice label', {hasText: 'Grok 订阅'}).click();
  await page.locator('#app-prompt-ok').click();
  await page.locator('#settings-modal .modal-ft .btn.text').click();
  const cancelled = await page.evaluate(() => ({
    count: D.settings.imageSources.length,
    model: D.settings.imageSources[0].model,
    summary: assistantPromptText('imageGeneration', 'summary'),
  }));
  assert.deepStrictEqual(cancelled, {count: 1, model: 'sd-model', summary: '自定义直接总结提示词'});

  // 同一自定义来源可切为 Gemini，地址及画幅随草稿保存；旧来源仍默认 OpenAI。
  await openImageTab(page);
  await page.locator('#image-source-format').selectOption('gemini');
  await page.locator('#image-source-url').fill('https://uuapi.cc/v1beta');
  await page.locator('#image-source-model').fill('gemini-3.1-flash-image-preview');
  await page.locator('#image-source-aspect').selectOption('16:9');
  await saveAndReload(page);
  assert.deepStrictEqual(await page.evaluate(() => {
    const row = D.settings.imageSources[0];
    return {format: row.format, apiUrl: row.apiUrl, aspectRatio: row.aspectRatio, model: row.model, n: row.n};
  }), {format: 'gemini', apiUrl: 'https://uuapi.cc/v1beta', aspectRatio: '16:9', model: 'gemini-3.1-flash-image-preview', n: 3});

  // 恢复默认后保存，回到受保护默认文本。
  await openImageTab(page);
  assert.strictEqual(await page.locator('#image-source-model').inputValue(), 'gemini-3.1-flash-image-preview', '取消后重新进入按已保存设置载入');
  await page.locator('[data-assistant-prompt-group="imageGeneration"] .ui-group-hd button').click();
  await saveAndReload(page);
  assert.strictEqual(
    await page.evaluate(() => assistantPromptText('imageGeneration', 'summary') === DEFAULT_IMAGE_PROMPT_SUMMARY && !D.settings.assistantPromptOverrides.imageGeneration),
    true,
    '恢复默认后不再保存覆盖'
  );

  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log('image source settings save, cancel and prompt defaults round-trip');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
