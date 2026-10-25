'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  createAssetServer,
  listenOnBrowserSafePort,
  loadPlaywright,
  resolveEdgeExecutable,
} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {image: fixtureImage} = require('../fixtures/charx_fixture');

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const pixel = `data:image/png;base64,${fixtureImage.toString('base64')}`;
const secondPixel = pixel;
const bmpBase64 = 'Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABACAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAD//w==';
const avifBase64 = 'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAfAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAABAAAAAQAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EgAAAAAAATY29scm5jbHgAAgACAACAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAnbWRhdAoHOAAG0BDQAjIUGAAAAFAAAAAF9e9k3XMB45obYdg=';

let browser;
let server;
let remoteServer;
let remoteHits = 0;

(async () => {
  assert.ok(fs.existsSync(path.join(assets, 'js/app/45-expression-assets.js')), '缺少角色立绘资产模块 45-expression-assets.js');
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  remoteServer = http.createServer((request, response) => {
    if (request.url !== '/emotion.png') {
      response.writeHead(404).end();
      return;
    }
    remoteHits++;
    if (remoteHits === 1) {
      response.writeHead(503, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'}).end('synthetic retry');
      return;
    }
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'image/png',
    }).end(fixtureImage);
  });
  await listenOnBrowserSafePort(remoteServer);
  browser = await loadPlaywright().chromium.launch({
    executablePath: resolveEdgeExecutable(),
    headless: true,
  });
  const page = await browser.newPage();
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  const validation=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;
    canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),original=createImageBitmap;
    const decoded=[];let rejected=false;
    window.createImageBitmap=async(...args)=>{const bitmap=await original(...args);decoded.push([bitmap.width,bitmap.height]);return bitmap;};
    try {
      const returned=await validateCardImageBlob(blob);
      try{await validateCardImageBlob(blob.slice(0,64,'image/png'));}catch(error){rejected=/图片内容损坏/.test(error.message);}
      return{sameBlob:returned===blob,decoded,rejected};
    }finally{window.createImageBitmap=original;canvas.width=canvas.height=0;}
  });
  assert.deepStrictEqual(validation,{sameBlob:true,decoded:[[1,1]],rejected:true});

  const recognition = await page.evaluate(async ({pixel, secondPixel}) => {
    function check(value, message) { if (!value) throw new Error(message); }
    D = defaults();
    const primary = {
      id: 'expression-primary',
      name: '合成角色甲',
      tags: [],
      extensions: {},
      media_assets: [
        {
          id: 'standard-emotion', name: 'Calm 静谧.png', kind: 'ccv3_asset', assetType: 'emotion',
          ext: 'png', mime: 'image/png', status: 'ready', data_url: pixel,
          originalUri: '__asset:0', sourceUrl: '__asset:0',
        },
        {
          id: 'generic-risu-image', name: 'scene 人物混合.png', kind: 'ccv3_asset', assetType: 'x-risu-asset',
          ext: 'png', mime: 'image/png', status: 'ready', data_url: secondPixel,
          originalUri: '__asset:1', sourceUrl: '__asset:1',
        },
      ],
    };
    const primarySession = createBlankSession('合成对话甲', 'expression-session-a');
    primarySession.msgs = [];
    primarySession.nextMessageSeq = 1;
    D.characters = [primary];
    D.currentCharId = primary.id;
    D.chats = {[primary.id]: {sessions: [primarySession], activeSid: primarySession.id}};

    const automatic = YeyuExpressionAssets.bindings(primary).filter(row => row.automatic);
    check(automatic.length === 1 && automatic[0].assetId === 'standard-emotion', '标准 emotion 没有自动形成绑定');
    YeyuExpressionAssets.bind(primary, 'generic-risu-image', '忧郁-β', '夜装');

    const single = {id: 'expression-single', name: '合成角色乙', tags: [], extensions: {}, media_assets: []};
    const singleSession = createBlankSession('合成对话乙', 'expression-session-b');
    singleSession.msgs = [];
    singleSession.nextMessageSeq = 1;
    D.characters.push(single);
    D.chats[single.id] = {sessions: [singleSession], activeSid: singleSession.id};
    await YeyuExpressionAssets.importFiles(single, [
      new File([await (await fetch(pixel)).blob()], '单张固定立绘.png', {type: 'image/png'}),
    ], {label: '唯一立绘', group: ''});
    await saveData(['characters', 'sessions', 'meta'], {urgent: true});
    await flushPendingSave();
    return {
      automaticLabel: automatic[0].label,
      primaryId: primary.id,
      primarySessionId: primarySession.id,
      singleId: single.id,
      singleSessionId: singleSession.id,
    };
  }, {pixel, secondPixel});

  const saveRollback = await page.evaluate(async ({pixel, automaticLabel}) => {
    function check(value, message) { if (!value) throw new Error(message); }
    async function readableImage(source) {
      const response = await fetch(source);
      if (!response.ok || !(await response.blob()).size) return false;
      return await new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0);
        image.onerror = () => resolve(false);
        image.src = source;
      });
    }
    const primary = getChar();
    const session = getActiveSession(primary.id);
    const config = YeyuExpressionAssets.config(primary, true);

    config.group = '';
    await setExpression(automaticLabel);
    const mediaArray = primary.media_assets;
    const displayedAsset = mediaArray.find(asset => asset.id === (session.expressions || {}).assetId);
    const displayedSource = await YeyuExpressionAssets.source(primary, displayedAsset.id);
    const sharedConsumer = document.createElement('img');
    sharedConsumer.id = 'expression-shared-consumer';
    sharedConsumer.src = displayedSource;
    $('chat-messages').appendChild(sharedConsumer);
    check(await readableImage(displayedSource), '保存失败复现前的立绘 Blob URL 不可读');
    const originalIdentitySave = saveData;
    saveData = async function() { throw new Error('synthetic expression identity failure'); };
    try {
      let failed = false;
      try { await expressionFolder('夜装'); } catch (error) { failed = error.message === 'synthetic expression identity failure'; }
      check(failed, '对象身份回滚测试没有触发保存失败');
    } finally {
      saveData = originalIdentitySave;
    }
    check(primary.media_assets === mediaArray, '保存失败后替换了原 media_assets 数组');
    check(primary.media_assets.find(asset => asset.id === displayedAsset.id) === displayedAsset, '保存失败后替换了正在显示的媒体资产对象');
    syncCardAssetObjectUrlLifecycle(primary);
    const sourceAfterLifecycle = await YeyuExpressionAssets.source(primary, displayedAsset.id);
    check(await readableImage(displayedSource) && await readableImage(sourceAfterLifecycle), '保存失败后的生命周期清理撤销了仍在使用的立绘 Blob URL');
    check(sharedConsumer.complete && sharedConsumer.naturalWidth > 0, '保存失败损坏了共享图片消费者');
    sharedConsumer.remove();

    config.group = '';
    config.hidden = true;
    const beforeFailedSave = {
      expressions: structuredClone(session.expressions || {}),
      hidden: config.hidden,
    };
    const originalSave = saveData;
    let rejected = false;
    saveData = async function() { throw new Error('synthetic expression save failure'); };
    try {
      await setExpression(automaticLabel);
    } catch (error) {
      rejected = error.message === 'synthetic expression save failure';
    } finally {
      saveData = originalSave;
    }
    check(rejected, '立绘保存失败没有传回原始错误');
    check(JSON.stringify(session.expressions || {}) === JSON.stringify(beforeFailedSave.expressions)
      && config.hidden === beforeFailedSave.hidden, '立绘保存失败后内存状态没有回滚');
    await saveData(['characters', 'sessions'], {urgent: true});
    return {saveRollback: true, mediaIdentityRollback: true, sharedBlobConsumer: true};
  }, {pixel, automaticLabel: recognition.automaticLabel});

  const sessionReset = await page.evaluate(async () => {
    function check(value, message) { if (!value) throw new Error(message); }
    const char = getChar();
    const box = D.chats[char.id];
    const sessionA = getActiveSession(char.id);
    const sessionB = createBlankSession('合成对话乙', 'expression-session-reset-b');
    sessionB.msgs = [];
    sessionB.nextMessageSeq = 1;
    box.sessions.push(sessionB);

    YeyuExpressionAssets.config(char, true).group = '夜装';
    box.activeSid = sessionB.id;
    updateChatUI();
    renderChat();
    await YeyuExpressions.set('忧郁-β');
    await expressionVn('true');
    check(!$('expression-stage').hidden && document.body.classList.contains('expression-vn'), '会话 B 没有进入立绘 VN 展示');

    box.activeSid = sessionA.id;
    updateChatUI();
    renderChat();
    await YeyuExpressions.set('忧郁-β');
    const reset = await YeyuExpressions.set('#reset');
    check(reset === '#reset' && YeyuExpressions.last() === '#reset', '会话 A 没有记录重置状态');
    check($('expression-stage').hidden && !document.body.classList.contains('expression-vn'), '会话 A 重置后没有隐藏自身舞台');

    box.activeSid = sessionB.id;
    updateChatUI();
    renderChat();
    syncExpressions();
    await Promise.resolve();
    check(YeyuExpressions.last() === '忧郁-β', '会话 A 重置改变了会话 B 的选择');
    check(!$('expression-stage').hidden && document.body.classList.contains('expression-vn'), '会话 A 重置改变了会话 B 的显示或 VN 状态');

    box.activeSid = sessionA.id;
    updateChatUI();
    renderChat();
    await YeyuExpressions.set('忧郁-β');
    await expressionVn('false');
    box.sessions = box.sessions.filter(session => session !== sessionB);
    box.activeSid = sessionA.id;
    await saveData(['characters', 'sessions'], {urgent: true});
    return {currentSessionResetHidden: true, siblingSelectionPreserved: true, siblingVisualNovelPreserved: true};
  });

  const assetContext = await page.evaluate(remoteUrl => {
    function check(value, message) { if (!value) throw new Error(message); }
    const char = {
      id: 'expression-assets-browser',
      name: '合成资产闭环角色',
      tags: [],
      extensions: {},
      media_assets: [{
        id: 'remote-emotion',
        name: '远程表情.png',
        kind: 'ccv3_asset',
        assetType: 'emotion',
        ext: 'png',
        mime: 'image/png',
        sourceUrl: remoteUrl,
        originalUri: remoteUrl,
        status: 'remote',
      }],
    };
    const session = createBlankSession('合成资产闭环对话', 'expression-assets-browser-session');
    session.msgs = [];
    session.nextMessageSeq = 1;
    D.characters.push(char);
    D.chats[char.id] = {sessions: [session], activeSid: session.id};
    const initial = YeyuExpressionAssets.images(char).find(row => row.id === 'remote-emotion');
    check(initial && initial.status === 'remote' && !initial.missing, '远程标准 emotion 初始状态没有作为可加载图片暴露');
    YeyuExpressionAssets.config(char, true).hidden = false;
    D.currentCharId = char.id;
    switchAppPage('chat');
    updateChatUI();
    renderChat();
    openExpressionManager();
    return {charId: char.id, remoteId: 'remote-emotion'};
  }, `http://127.0.0.1:${remoteServer.address().port}/emotion.png`);
  const retryNote = page.locator('.expression-help[data-expression-asset="remote-emotion"]', {hasText: '重试加载'}).first();
  await retryNote.waitFor();
  const failureText = await retryNote.locator('small').innerText();
  assert.match(failureText, /远程表情|远程图片|503|下载/, '远程图片失败没有显示具体原因：' + failureText);
  assert.strictEqual(remoteHits, 1, '管理器首次预览失败发起了重复远程请求');
  const failedState = await page.evaluate(({charId, remoteId}) => {
    const char = D.characters.find(row => row.id === charId);
    const image = YeyuExpressionAssets.images(char).find(row => row.id === remoteId);
    const asset = char.media_assets.find(row => row.id === remoteId);
    return {status: image && image.status, missing: image && image.missing, retryable: asset && asset.errorRetryable};
  }, assetContext);
  assert.deepStrictEqual(failedState, {status: 'failed', missing: true, retryable: true});
  await retryNote.getByRole('button', {name: '重试加载'}).click();
  await page.waitForFunction(({charId, remoteId}) => {
    const asset = D.characters.find(row => row.id === charId)?.media_assets.find(row => row.id === remoteId);
    return asset?.status === 'ready' && !asset.error
      && !document.querySelector(`.expression-help[data-expression-asset="${remoteId}"]`)
      && Array.from(document.querySelectorAll(`img[data-expression-asset="${remoteId}"]`)).every(image => image.getAttribute('src'));
  }, assetContext);
  // The second lazy preview lives in a closed details section. Open it and bring each
  // preview into view before requiring the new source to finish decoding.
  await page.locator('#expressions-modal summary').getByText('绑定卡内图片', {exact: true}).click();
  const retryPreviews = page.locator(`img[data-expression-asset="${assetContext.remoteId}"]`);
  for (let index = 0; index < await retryPreviews.count(); index++) {
    await retryPreviews.nth(index).scrollIntoViewIfNeeded();
    await page.waitForFunction(({remoteId, index}) => {
      const image = document.querySelectorAll(`img[data-expression-asset="${remoteId}"]`)[index];
      return image && image.complete && image.naturalWidth > 0;
    }, {remoteId: assetContext.remoteId, index});
  }
  await page.waitForFunction(({charId, remoteId}) => {
    const char = D.characters.find(row => row.id === charId);
    const asset = char && char.media_assets.find(row => row.id === remoteId);
    const previews = Array.from(document.querySelectorAll(`img[data-expression-asset="${remoteId}"]`));
    const stage = $('expression-stage'), image = $('expression-image');
    return asset && asset.status === 'ready' && !asset.error && previews.length >= 2
      && previews.every(preview => !preview.hidden && preview.complete && preview.naturalWidth > 0)
      && !document.querySelector(`.expression-help[data-expression-asset="${remoteId}"]`)
      && !stage.hidden && image.dataset.asset === remoteId && image.complete && image.naturalWidth > 0;
  }, assetContext);
  const retryUi = await page.evaluate(({charId, remoteId}) => {
    const char = D.characters.find(row => row.id === charId);
    const asset = char && char.media_assets.find(row => row.id === remoteId);
    const previews = Array.from(document.querySelectorAll(`img[data-expression-asset="${remoteId}"]`));
    return {
      status: asset && asset.status,
      error: asset && asset.error,
      previews: previews.map(image => ({hidden: image.hidden, complete: image.complete, width: image.naturalWidth})),
      retryNotes: document.querySelectorAll(`.expression-help[data-expression-asset="${remoteId}"]`).length,
      stage: {
        hidden: $('expression-stage').hidden,
        asset: $('expression-image').dataset.asset,
        width: $('expression-image').naturalWidth,
      },
    };
  }, assetContext);
  assert.ok(retryUi.status === 'ready' && !retryUi.error && retryUi.previews.length >= 2
    && retryUi.previews.every(image => !image.hidden && image.width > 0)
    && retryUi.retryNotes === 0 && !retryUi.stage.hidden
    && retryUi.stage.asset === assetContext.remoteId && retryUi.stage.width > 0,
  '远程图片重试成功后没有刷新全部预览和舞台：' + JSON.stringify(retryUi));
  assert.strictEqual(remoteHits, 2, '管理器显式重试没有形成首败次成两次请求');

  const assetSetup = await page.evaluate(async ({assetContext, bmpBase64, avifBase64}) => {
    function check(value, message) { if (!value) throw new Error(message); }
    function bytes(base64) {
      return Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    }
    async function decoded(source) {
      return await new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
        image.onerror = () => resolve(false);
        image.src = source;
      });
    }
    const char = D.characters.find(row => row.id === assetContext.charId);
    const remoteAsset = char.media_assets.find(row => row.id === assetContext.remoteId);
    check(await decoded(await YeyuExpressionAssets.source(char, remoteAsset.id))
      && remoteAsset.status === 'ready' && !remoteAsset.error, '远程图片重试成功后没有进入可显示 ready 状态');

    YeyuExpressionAssets.bind(char, remoteAsset.id, '共享昼间', 'day');
    YeyuExpressionAssets.bind(char, remoteAsset.id, '共享夜间', 'night');
    const beforeReplace = YeyuExpressionAssets.bindings(char).filter(row => row.assetId === remoteAsset.id && !row.automatic);
    check(beforeReplace.length === 2, '同一素材没有保留两个分组绑定');
    const replacement = await YeyuExpressionAssets.importFiles(char, [
      new File([bytes(bmpBase64)], '昼间替换.bmp', {type: 'image/bmp'}),
    ], {replaceAssetId: remoteAsset.id, label: '共享昼间', group: 'day'});
    const day = YeyuExpressionAssets.bindings(char).find(row => row.label === '共享昼间' && row.group === 'day');
    const night = YeyuExpressionAssets.bindings(char).find(row => row.label === '共享夜间' && row.group === 'night');
    check(replacement.count === 1 && day && day.assetId !== remoteAsset.id, '定向替换没有生成昼间新素材');
    check(night && night.assetId === remoteAsset.id, '定向替换误删或改写了同素材夜间绑定');

    const formats = await YeyuExpressionAssets.importFiles(char, [
      new File([bytes(bmpBase64)], '仓储位图.bmp', {type: 'image/bmp'}),
      new File([bytes(avifBase64)], '仓储图像.avif', {type: 'image/avif'}),
    ], {group: 'formats'});
    check(formats.count === 2, 'BMP/AVIF 没有同时通过真实导入入口');
    const formatRows = formats.bindings.map(binding => ({assetId: binding.assetId, label: binding.label}));
    for (const row of formatRows) check(await decoded(await YeyuExpressionAssets.source(char, row.assetId)), row.label + ' 导入后无法解码');

    D.currentCharId = 'expression-primary';
    updateChatUI();
    renderChat();
    await saveData(['characters', 'sessions'], {urgent: true});
    await flushPendingSave();
    return {
      charId: char.id,
      remoteId: remoteAsset.id,
      replacementId: day.assetId,
      formats: formatRows,
    };
  }, {
    assetContext,
    bmpBase64,
    avifBase64,
  });
  assert.strictEqual(remoteHits, 2, '远程表情首败次成没有各发起一次请求');

  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  const assetPersistence = await page.evaluate(async setup => {
    function check(value, message) { if (!value) throw new Error(message); }
    async function decoded(source) {
      return await new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
        image.onerror = () => resolve(false);
        image.src = source;
      });
    }
    const char = D.characters.find(row => row.id === setup.charId);
    const ids = [setup.remoteId, setup.replacementId].concat(setup.formats.map(row => row.assetId));
    const storedRecords = ids.map(id => {
      const asset = char.media_assets.find(row => row.id === id);
      return {
        id,
        found: !!asset,
        mediaKey: !!(asset && asset.mediaKey),
        bytes: !!(asset && asset.bytes instanceof Uint8Array),
        blob: !!(asset && asset.blob instanceof Blob),
        dataUrl: !!(asset && asset.data_url),
        status: asset && asset.status,
      };
    });
    const storedOnly = storedRecords.every(row => row.found && row.mediaKey && !row.bytes && !row.blob && !row.dataUrl);
    check(storedOnly, '重载后的远程/BMP/AVIF 素材没有收敛为只读 mediaKey 引用：' + JSON.stringify(storedRecords));
    const decodedByLabel = {};
    for (const row of setup.formats) decodedByLabel[row.label] = await decoded(await YeyuExpressionAssets.source(char, row.assetId));
    const remoteDecoded = await decoded(await YeyuExpressionAssets.source(char, setup.remoteId));
    const bindings = YeyuExpressionAssets.bindings(char);
    const day = bindings.find(row => row.label === '共享昼间' && row.group === 'day');
    const night = bindings.find(row => row.label === '共享夜间' && row.group === 'night');
    check(day && day.assetId === setup.replacementId, '重载后昼间定向替换绑定丢失');
    check(night && night.assetId === setup.remoteId, '重载后夜间原素材绑定丢失');
    check(Object.values(decodedByLabel).every(Boolean) && remoteDecoded, '媒体仓储重载后的远程/BMP/AVIF source 无法解码');
    return {remoteRetryReload: true, targetedMultiBindingReplace: true, bmp: true, avif: true, storedOnly};
  }, assetSetup);
  assert.strictEqual(remoteHits, 2, '远程表情成功保存后重载仍访问了远程地址');

  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  const reloaded = await page.evaluate(async () => {
    const single = D.characters.find(row => row.id === 'expression-single');
    D.currentCharId = single.id;
    switchAppPage('chat');
    updateChatUI();
    renderChat();
    await YeyuExpressions.set('唯一立绘');
    const assetId = YeyuExpressionAssets.bindings(single)[0].assetId;
    const beforeLifecycle = await YeyuExpressionAssets.source(single, assetId);
    syncCardAssetObjectUrlLifecycle(single);
    const afterLifecycle = await YeyuExpressionAssets.source(single, assetId);
    const decoded = await new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0);
      image.onerror = () => resolve(false);
      image.src = afterLifecycle;
    });
    return {
      label: YeyuExpressions.last(),
      source: /^blob:|^data:image\//.test(beforeLifecycle) && /^blob:|^data:image\//.test(afterLifecycle),
      lifecycleDecoded: decoded,
    };
  });
  assert.deepStrictEqual(reloaded, {label: '唯一立绘', source: true, lifecycleDecoded: true});
  assert.deepStrictEqual(pageErrors, [], '页面错误：' + pageErrors.join('\n'));

  console.log(JSON.stringify({recognition, saveRollback, sessionReset, assetPersistence, reloaded}));
  console.log('expressions browser: PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  if (remoteServer) await new Promise(resolve => remoteServer.close(resolve));
});
