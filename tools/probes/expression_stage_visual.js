'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createAssetServer,
  listenOnBrowserSafePort,
  loadPlaywright,
  resolveEdgeExecutable,
} = require('../tests/source');
const {visualDevice, installNativeSafeArea} = require('../qa/visual_device');
const {capturePageDiagnostics} = require('../tests/helpers/page-diagnostics');

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const input = process.argv[2] ? path.resolve(process.argv[2]) : '';
const evidence = path.join(root, '.tmp/expression-stage-visual/oneplus13-pjz110');
let browser;
let server;

(async () => {
  if (!input) throw new Error('用法：node tools/probes/expression_stage_visual.js <含标准 emotion 的角色卡.png>');
  if (path.extname(input).toLowerCase() !== '.png' || !fs.existsSync(input)) throw new Error('角色卡 PNG 不存在');
  fs.mkdirSync(evidence, {recursive: true});
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({
    executablePath: resolveEdgeExecutable(),
    headless: true,
  });
  const device = visualDevice();
  const page = await browser.newPage(device.browserContext);
  await installNativeSafeArea(page, device);
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await page.waitForFunction(() => window.YeyuExpressions && typeof readPNG === 'function');
  await page.evaluate(() => {
    const rejectExecution = () => {
      throw new Error('视觉探针禁止执行角色卡脚本或模型调用');
    };
    window.executeStscript = rejectExecution;
    window.callDeepSeek = rejectExecution;
  });
  await page.locator('#expression-files').setInputFiles(input);
  const setup = await page.evaluate(async () => {
    const file = $('expression-files').files[0];
    const card = await readPNG(file);
    if (!card) throw new Error('角色卡解析失败');
    card.id = 'expression-stage-visual-card';
    const rows = YeyuExpressionAssets.bindings(card).filter(row => row.automatic && !row.missing);
    if (rows.length < 2) throw new Error('视觉探针至少需要两个可读的标准 emotion');
    const session = createBlankSession('立绘视觉验收', 'expression-stage-visual-session');
    session.msgs = [
      {seq: 1, role: 'assistant', content: '夜色安静下来，她抬眼望向你。', time: Date.now()},
      {seq: 2, role: 'user', content: '我在这里。', time: Date.now()},
    ];
    session.nextMessageSeq = 3;
    D = defaults();
    D.settings.messageStyle = 'immersive';
    D.characters = [card];
    D.currentCharId = card.id;
    D.chats = {[card.id]: {sessions: [session], activeSid: session.id}};
    const config = YeyuExpressionAssets.config(card);
    config.group = rows[0].group;
    config.hidden = false;
    config.vn = false;
    config.height = 36;
    config.position = 'center';
    switchAppPage('chat');
    applyMessageStyle();
    updateChatUI();
    renderChat();
    await applyCharBackground(card, false);
    await setExpression(rows[0].label, {assetId: rows[0].assetId});
    return {
      first: {label: rows[0].label, assetId: rows[0].assetId},
      second: {label: rows[1].label, assetId: rows[1].assetId},
      standardEmotionCount: rows.length,
    };
  });
  await page.waitForFunction(assetId => {
    const image = $('expression-image');
    return !$('expression-stage').hidden && image.dataset.asset === assetId && image.complete && image.naturalWidth > 0;
  }, setup.first.assetId);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(node => node.remove()));
  await page.screenshot({path: path.join(evidence, 'normal.png'), fullPage: false});
  async function captureClassification(name) {
    await page.evaluate(() => {
      const original = callDeepSeek;
      callDeepSeek = (messages, target, options) => new Promise((resolve, reject) => {
        options.controller.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {once: true});
      });
      window.__visualClassification = classifyExpression('视觉验收正文').catch(() => {});
      callDeepSeek = original;
    });
    assert(await page.locator('#expression-status').isVisible(), '判定提示必须在舞台可见');
    await page.screenshot({path: path.join(evidence, name), fullPage: false});
    await page.evaluate(async () => { cancelExpressionClassification(); await __visualClassification; });
    assert(await page.locator('#expression-status').isHidden(), '停止后判定提示必须消失');
  }
  await captureClassification('normal-classifying.png');

  await page.evaluate(second => setExpression(second.label, {assetId: second.assetId}), setup.second);
  await page.waitForFunction(() => !!document.querySelector('.expression-image-outgoing'));
  await page.waitForTimeout(45);
  const crossfade = await page.evaluate(() => {
    const current = $('expression-image');
    const outgoing = document.querySelector('.expression-image-outgoing');
    return {
      currentOpacity: Number(getComputedStyle(current).opacity),
      outgoingOpacity: Number(getComputedStyle(outgoing).opacity),
      layers: document.querySelectorAll('#expression-stage img').length,
      stageHidden: $('expression-stage').hidden,
    };
  });
  assert.ok(crossfade.layers === 2 && !crossfade.stageHidden, JSON.stringify(crossfade));
  assert.ok(crossfade.currentOpacity > 0 && crossfade.currentOpacity < 1, JSON.stringify(crossfade));
  assert.ok(crossfade.outgoingOpacity > 0 && crossfade.outgoingOpacity < 1, JSON.stringify(crossfade));
  await page.waitForFunction(() => !document.querySelector('.expression-image-outgoing'));

  await page.evaluate(() => expressionVn('true'));
  await page.waitForTimeout(250);
  await page.screenshot({path: path.join(evidence, 'visual-novel.png'), fullPage: false});
  await captureClassification('visual-novel-classifying.png');
  const boundary = await page.evaluate(() => ({
    imageMask: getComputedStyle($('expression-image')).webkitMaskImage,
    messageBackground: getComputedStyle($('chat-messages')).backgroundImage,
    radius: getComputedStyle($('chat-messages')).borderTopLeftRadius,
  }));
  assert.match(boundary.imageMask, /gradient/i);
  assert.match(boundary.messageBackground, /gradient/i);
  assert.strictEqual(boundary.radius, '0px');

  const hidePromise = page.evaluate(() => expressionVisibility(true));
  await page.waitForFunction(() => $('expression-stage').hidden && $('expression-stage').inert);
  await page.waitForTimeout(45);
  const hiding = await page.evaluate(() => ({
    hidden: $('expression-stage').hidden,
    inert: $('expression-stage').inert,
    display: getComputedStyle($('expression-stage')).display,
    opacity: Number(getComputedStyle($('expression-stage')).opacity),
  }));
  assert.ok(hiding.hidden && hiding.inert && hiding.display !== 'none' && hiding.opacity > 0 && hiding.opacity < 1, JSON.stringify(hiding));
  await hidePromise;
  await page.waitForFunction(() => getComputedStyle($('expression-stage')).display === 'none' && !$('expression-stage').inert);

  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.evaluate(() => expressionVisibility(false));
  await page.waitForFunction(() => !$('expression-stage').hidden);
  const reducedMotion = await page.evaluate(() => ({
    motions: _uiMotions.has($('expression-stage')),
    opacity: Number(getComputedStyle($('expression-stage')).opacity),
    outgoing: document.querySelectorAll('.expression-image-outgoing').length,
  }));
  assert.deepStrictEqual(reducedMotion, {motions: false, opacity: 1, outgoing: 0});

  const avoidance = await page.evaluate(() => {
    document.body.classList.add('chat-keyboard-open');
    const keyboard = getComputedStyle($('expression-stage')).display;
    document.body.classList.remove('chat-keyboard-open');
    const frame = document.createElement('iframe');
    frame.dataset.yeyuFullscreenActive = 'true';
    document.body.appendChild(frame);
    const fullscreen = getComputedStyle($('expression-stage')).display;
    frame.remove();
    return {keyboard, fullscreen};
  });
  assert.deepStrictEqual(avoidance, {keyboard: 'none', fullscreen: 'none'});
  const contextIsolation = await page.evaluate(() => {
    const card = {id: 'expression-stage-empty-card', name: '空素材角色', tags: [], extensions: {}, media_assets: []};
    const session = createBlankSession('空素材对话', 'expression-stage-empty-session');
    D.characters.push(card);
    D.chats[card.id] = {sessions: [session], activeSid: session.id};
    D.currentCharId = card.id;
    syncExpressions();
    return {
      hidden: $('expression-stage').hidden,
      hasSource: $('expression-image').hasAttribute('src'),
      outgoing: document.querySelectorAll('.expression-image-outgoing').length,
    };
  });
  assert.deepStrictEqual(contextIsolation, {hidden: true, hasSource: false, outgoing: 0});
  assert.deepStrictEqual(pageErrors, [], '页面错误：' + pageErrors.join('\n'));

  const report = {
    probe: 'expression-stage-visual',
    device: device.id,
    evidence: 'Edge mobile emulation; not a physical-device result',
    standardEmotionCount: setup.standardEmotionCount,
    realEmbeddedImages: true,
    scriptsExecuted: false,
    crossfade,
    hiding,
    reducedMotion,
    avoidance,
    contextIsolation,
    boundary,
    screenshots: ['normal.png', 'visual-novel.png'],
    pageErrors: 0,
  };
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  console.log('expression stage visual: PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
