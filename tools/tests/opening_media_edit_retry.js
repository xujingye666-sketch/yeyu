'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const realCardPath = String(process.env.YEYU_OPENING_MEDIA_REAL_CARD_PATH || '').trim();
const imageUrl = 'https://images.example.test/opening-retry.png';
let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {appendUrl: true});
  // 首次渲染尚未登记媒体资产，普通回复的原始 img 也会请求此合成地址。
  await page.route(imageUrl, route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64')
  }));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  let realCardLegalImages = null;
  if (realCardPath) {
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'opening-media-real-card-fixture';
      document.body.appendChild(input);
    });
    await page.locator('#opening-media-real-card-fixture').setInputFiles(realCardPath);
    realCardLegalImages = await page.evaluate(async () => {
      const card = await readPNG(document.getElementById('opening-media-real-card-fixture').files[0]);
      const count = collectCardMediaAssets(card).length;
      if (String(card.avatar_image || '').startsWith('blob:')) URL.revokeObjectURL(card.avatar_image);
      return count;
    });
    assert.strictEqual(realCardLegalImages, 8, '本机示例卡的八张合法图片必须继续被识别');
  }

  const setup = await page.evaluate(async url => {
    D = defaults();
    D.settings.useMemory = false;
    const originalGreeting = '角色卡里的原始开场白保持不变。';
    const char = {
      id: 'opening-media-opening-char', name: '开场白图片验证', description: '', personality: '', scenario: '',
      first_mes: originalGreeting, alternate_greetings: [], mes_example: '', system_prompt: '',
      post_history_instructions: '', media_assets: [], rawCard: {data: {first_mes: originalGreeting}}, extensions: {}
    };
    const session = createBlankSession('当前会话', 'opening-media-opening-session');
    session.greetingChosen = true;
    session.msgs = [{
      role: 'assistant', opening: true, openingIndex: 0, seq: 1, time: Date.now(),
      content: `开场正文。\n\n[](https://images.example.test/missing-bang.png)\n\n![](https://images.example.test/missing-paren.png`
    }, {
      role: 'assistant', seq: 2, time: Date.now(),
      content: `普通回复不加载远程图：![](${url})`
    }];
    ensureMessageSequences(session);
    const untouched = createBlankSession('其他会话', 'opening-media-other-session');
    untouched.greetingChosen = true;
    untouched.msgs = [{role: 'assistant', opening: true, openingIndex: 0, seq: 1, time: 1, content: '其他会话原文。'}];
    ensureMessageSequences(untouched);
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session, untouched], activeSid: session.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    window.__openingDownloadCalls = 0;
    window.downloadCardImage = async () => {
      window.__openingDownloadCalls += 1;
      throw new Error('合成下载失败');
    };
    window.appConfirm = async () => true;
    renderChat();
    updateChatUI();
    editMessage(0);
    document.getElementById('edit-msg-content').value = `开场正文已由用户保存。\n\n![场景图](${url})\n\n[](https://images.example.test/missing-bang.png)\n\n![](https://images.example.test/missing-paren.png`;
    await saveEditMessage();
    return {originalGreeting, rawGreeting: char.rawCard.data.first_mes, other: untouched.msgs[0].content};
  }, imageUrl);

  await page.waitForSelector('.card-inline-image-retry');
  assert.deepStrictEqual(setup, {
    originalGreeting: '角色卡里的原始开场白保持不变。',
    rawGreeting: '角色卡里的原始开场白保持不变。',
    other: '其他会话原文。'
  }, '编辑会话开场白不得反写角色卡或其他会话');
  let failed = await page.evaluate(url => {
    const char = getChar();
    const message = getActiveSession(char.id).msgs[0];
    return {
      content: message.content,
      assets: char.media_assets.filter(asset => normalizeRemoteCardUrl(asset.sourceUrl) === url).length,
      totalAssets: char.media_assets.length,
      calls: window.__openingDownloadCalls,
      retryText: document.querySelector('.card-inline-image-retry')?.textContent || '',
      ordinaryMedia: document.querySelectorAll('[data-msg-idx="1"] .card-inline-image, [data-msg-idx="1"] .card-inline-image-retry, [data-msg-idx="1"] .yeyu-card-media-missing').length
    };
  }, imageUrl);
  assert(failed.content.includes(`![场景图](${imageUrl})`), '保存后的合法 Markdown 必须保留原文');
  assert(failed.content.includes('[](https://images.example.test/missing-bang.png)')
    && failed.content.includes('![](https://images.example.test/missing-paren.png'), '不合法 Markdown 不得自动修正');
  assert.strictEqual(failed.assets, 1, '新增地址只登记一个媒体资产');
  assert.strictEqual(failed.totalAssets, 1, '不合法 Markdown 不得登记媒体资产');
  assert.strictEqual(failed.calls, 1, '保存后必须自动发起一次下载');
  assert(failed.retryText.includes('图片加载失败') && failed.retryText.includes('重新加载'), '失败占位必须提供清楚的重试操作');
  assert.strictEqual(failed.ordinaryMedia, 1, '普通模型回复中的已知失败图片必须原位降级');

  await page.evaluate(() => {
    const toasts = document.getElementById('toasts');
    if (toasts) toasts.innerHTML = '';
    document.querySelector('.card-inline-image-retry')?.scrollIntoView({block: 'center'});
  });

  await page.evaluate(() => {
    window.downloadCardImage = async () => {
      window.__openingDownloadCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 120));
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 560;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#5b21b6');
      gradient.addColorStop(1, '#db2777');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.font = 'bold 64px sans-serif';
      context.textAlign = 'center';
      context.fillText('开场白图片已原位加载', canvas.width / 2, canvas.height / 2);
      return canvas.toDataURL('image/png');
    };
  });
  await page.locator('[data-msg-idx="0"] .card-inline-image-retry').getByRole('button', {name: '重新加载', exact: true}).click();
  await page.waitForSelector('[data-msg-idx="0"] .card-inline-image');
  await page.waitForFunction(() => {
    const asset = getChar().media_assets[0];
    return asset && asset.status === 'ready' && asset.mediaKey;
  });
  const succeeded = await page.evaluate(url => {
    const char = getChar();
    const asset = char.media_assets.find(item => normalizeRemoteCardUrl(item.sourceUrl) === url);
    return {
      calls: window.__openingDownloadCalls,
      assets: char.media_assets.filter(item => normalizeRemoteCardUrl(item.sourceUrl) === url).length,
      mediaKey: asset && asset.mediaKey,
      status: asset && asset.status,
      imageCount: document.querySelectorAll('[data-msg-idx="0"] .card-inline-image').length
    };
  }, imageUrl);
  assert.strictEqual(succeeded.calls, 2, '点击重新加载必须真实发起一次新下载');
  assert.strictEqual(succeeded.assets, 1);
  assert(succeeded.mediaKey && succeeded.status === 'ready', '成功结果必须进入既有媒体仓储引用');
  assert.strictEqual(succeeded.imageCount, 1, '成功后图片必须在原消息位置显示');
  await page.evaluate(() => {
    const toasts = document.getElementById('toasts');
    if (toasts) toasts.innerHTML = '';
    document.querySelector('[data-msg-idx="0"] .card-inline-image')?.scrollIntoView({block: 'center'});
  });

  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});
  await page.waitForSelector('[data-msg-idx="0"] .card-inline-image');
  const reloaded = await page.evaluate(url => {
    const char = getChar();
    return {
      assets: char.media_assets.filter(asset => normalizeRemoteCardUrl(asset.sourceUrl) === url).length,
      imageCount: document.querySelectorAll('[data-msg-idx="0"] .card-inline-image').length,
      content: getActiveSession(char.id).msgs[0].content,
      other: getSessions(char.id).sessions.find(session => session.id === 'opening-media-other-session').msgs[0].content,
      firstMes: char.first_mes,
      rawFirstMes: char.rawCard.data.first_mes
    };
  }, imageUrl);
  assert.strictEqual(reloaded.assets, 1, '刷新后媒体资产不得重复');
  assert.strictEqual(reloaded.imageCount, 1, '刷新后必须继续从本地缓存显示');
  assert(reloaded.content.includes(`![场景图](${imageUrl})`));
  assert.strictEqual(reloaded.other, '其他会话原文。');
  assert.strictEqual(reloaded.firstMes, '角色卡里的原始开场白保持不变。');
  assert.strictEqual(reloaded.rawFirstMes, '角色卡里的原始开场白保持不变。');
  assert.deepStrictEqual(pageErrors, [], `页面脚本错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log(JSON.stringify({
    openingEditRescan: true,
    invalidMarkdownPreserved: true,
    retryInPlace: true,
    persistedLocalMedia: true,
    ordinaryFailedAssetPlaceholder: true,
    realCardLegalImages,
    viewport: '390x844'
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
