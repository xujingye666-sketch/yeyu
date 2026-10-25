'use strict';

// 消息图片：手动生图、多图滑动、重载、候选归属（含 TavernHelper 写入）、卡片写回 extra、媒体回收与失败提示。
const assert = require('assert');
const path = require('path');
const zlib = require('zlib');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {waitForAppReady} = require('./helpers/app-ready');

const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const PROMPT = 'silver-haired girl in a red scarf on a harbor pier at dusk';
const CHAR_ID = 'image-char';
let browser;
let server;

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}
function solidPng(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({length: width}, () => Buffer.from(rgb)))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({length: height}, () => row)))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
const PNGS = [[214, 120, 96], [96, 140, 214], [120, 190, 130], [200, 170, 90]].map(rgb => solidPng(480, 640, rgb));

const state = {chat: 'ok', image: 'ok', hung: null, chatBodies: [], imageBodies: [], served: 0};
const json = body => ({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify(body)});

async function generate(page, index) {
  await page.evaluate(i => { generateMessageImage(i); }, index);
  // 手动生图每次先弹出可编辑的提示词确认框，点「出图」才真正出图。
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  await page.locator('#app-prompt-ok').click();
}
async function waitIdle(page) {
  await page.waitForFunction(() => !document.querySelector('.message-image-status'));
}
async function lastToast(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('#toasts .toast');
    return rows.length ? rows[rows.length - 1].textContent : '';
  });
}
async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(row => row.remove()));
}
async function message(page) {
  return page.evaluate(id => {
    const m = getActiveSession(id).msgs[1];
    const keys = list => (list || []).map(row => row.mediaKey);
    return {
      swipeId: m.swipeId,
      images: keys(m.images),
      slots: (m.swipeImages || []).map(list => (list ? keys(list) : null)),
      entries: m.images || [],
      extraMedia: m.extra && m.extra.media,
    };
  }, CHAR_ID);
}
async function mediaKeys(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('TavernAI');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction('media', 'readonly').objectStore('media').getAllKeys();
      read.onsuccess = () => { db.close(); resolve(read.result.map(String)); };
      read.onerror = () => reject(read.error);
    };
  }));
}
async function reload(page) {
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  await waitForLibrary(page);
}
async function waitForLibrary(page) {
  await page.waitForFunction(() => typeof _cardScriptLibraryLive !== 'undefined' && _cardScriptLibraryLive
    && _cardScriptLibraryLive.state === 'ready' && _cardScriptLibraryLive.frame.contentWindow.__imageProbeReady === true);
}
async function shownImages(page, count) {
  await page.waitForFunction(n => document.querySelectorAll('[data-msg-seq="2"] img.message-image[src^="blob:"]').length === n, count);
}
async function holdImage(page, image) {
  await image.scrollIntoViewIfNeeded();
  const rect = await image.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.locator('#app-prompt-modal.open').waitFor();
}

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  await context.route('https://testingcf.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: route.request().resourceType() === 'stylesheet' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
    body: route.request().url().includes('showdown') ? 'window.showdown={Converter:function(){}};' : '',
  }));
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js', route => route.fulfill({status: 200, contentType: 'application/javascript; charset=utf-8', body: ''}));
  await context.route('https://chat.example.test/**', route => {
    state.chatBodies.push(route.request().postDataJSON());
    if (state.chat === 'hang') {
      state.chatHung = route;
      return undefined;
    }
    if (state.chat === 'fail')
      return route.fulfill({status: 500, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify({error: {message: 'upstream exploded'}})});
    return route.fulfill(json({choices: [{message: {role: 'assistant', content: '"' + PROMPT + '"'}, finish_reason: 'stop'}]}));
  });
  await context.route('https://api.x.ai/**', route => {
    const body = route.request().postDataJSON();
    state.imageBodies.push(body);
    if (state.image === 'moderated')
      return route.fulfill({status: 400, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify({code: 'imagine:content-moderated', error: 'Generated image rejected by content moderation.'})});
    if (state.image === 'hang') {
      state.hung = route;
      return undefined;
    }
    return route.fulfill(json({data: Array.from({length: body.n || 1}, () => ({b64_json: PNGS[state.served++ % PNGS.length], mime_type: 'image/png'}))}));
  });
  const page = await context.newPage();
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {
    ignoreFavicon: true,
    // 审核拒绝与写提示词失败是本测试有意返回的错误响应。
    ignoreConsoleError: (entry, url) => /^https:\/\/(api\.x\.ai|chat\.example\.test)\//.test(url),
  });
  page.setDefaultTimeout(20000);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);
  await page.evaluate(async id => {
    D = defaults();
    D.settings.useMemory = false;
    D.settings.providers[0].apiUrl = 'https://chat.example.test/v1';
    D.settings.providers[0].model = 'chat-model';
    D.settings.providers[0].apiKey = 'synthetic-chat-key';
    D.settings.grokSubscriptionAuth = {accessToken: 'grok-test-token', refreshToken: 'grok-test-refresh', expiresAt: Date.now() + 3600000};
    D.settings.imageSources = [{id: 'grok-source', type: 'grok-subscription', name: 'Grok 出图', model: 'grok-imagine-image', n: 1}];
    D.settings.activeImageSourceId = 'grok-source';
    const char = parseCard({name: '港口少女', description: '{{char}}：银发，红色围巾。', first_mes: ''});
    char.id = id;
    char.scriptsEnabled = true;
    char.extensions = {
      yeyu: {componentImportMode: 'full'},
      tavern_helper: {scripts: [{type: 'script', enabled: true, name: 'probe', id: 'image-probe', content: 'window.__imageProbeReady=true;'}]},
    };
    const session = createBlankSession('图片对话', 'image-session');
    session.greetingChosen = true;
    session.msgs = [
      {role: 'user', content: '我们去港口看看吧。', time: 1000, seq: 1},
      {role: 'assistant', content: '候选零：她走上栈桥，回头看你。', swipes: ['候选零：她走上栈桥，回头看你。', '候选一：她在灯塔下等你。'], swipeId: 0, time: 2000, seq: 2},
    ];
    ensureMessageSequences(session);
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    renderChat();
    updateChatUI();
  }, CHAR_ID);
  await waitForLibrary(page);

  // 1. 最新 AI 回复从输入栏生图；它的「更多」不重复，旧消息仍保留菜单入口。
  await page.locator('[data-msg-seq="2"] .stream-content-slot').click();
  await page.locator('[data-msg-seq="2"] .msg-more-toggle').click();
  assert.strictEqual(await page.locator('[data-msg-seq="2"] [data-message-image-action]').count(), 0);
  await page.locator('#composer-image-btn').click();
  // 手动生图先弹出可编辑的提示词确认框；取消或清空不出图，确认后才发出图请求。
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  const imagesBeforeCancel = state.imageBodies.length;
  await page.locator('#app-prompt-modal .modal-ft').getByRole('button', {name: '取消'}).click();
  await waitIdle(page);
  assert.strictEqual(state.imageBodies.length, imagesBeforeCancel, '取消提示词确认框不出图');
  await page.locator('#composer-image-btn').click();
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  await page.evaluate(() => { document.getElementById('app-prompt-textarea').value = ''; });
  await page.locator('#app-prompt-ok').click();
  await waitIdle(page);
  assert.strictEqual(state.imageBodies.length, imagesBeforeCancel, '清空提示词不出图');
  await page.locator('#composer-image-btn').click();
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  await page.locator('#app-prompt-ok').click();
  await shownImages(page, 1);
  await waitIdle(page);
  const promptRequest = state.chatBodies[0];
  const taskMessage = promptRequest.messages[promptRequest.messages.length - 1];
  assert.strictEqual(taskMessage.role, 'user', '任务消息追加在已生效 Prompt 末尾');
  assert(taskMessage.content.startsWith('现在暂停续写和扮演'), '手动生图默认用直接总结任务消息');
  assert(taskMessage.content.includes('港口少女'), '任务消息按聊天 Prompt 规则展开宏');
  assert(JSON.stringify(promptRequest.messages.slice(0, -1)).includes('候选零：她走上栈桥，回头看你。'), '目标消息随已生效 Prompt 进入请求');
  assert(JSON.stringify(promptRequest.messages.slice(0, -1)).includes('港口少女：银发，红色围巾。'), '实际生效的角色资料进入画面理解上下文');
  assert.deepStrictEqual(state.imageBodies[0], {model: 'grok-imagine-image', prompt: PROMPT, n: 1, response_format: 'b64_json'});
  let current = await message(page);
  assert.strictEqual(current.images.length, 1);
  const first = current.entries[0];
  assert.strictEqual(first.prompt, PROMPT, '条目记下实际发给出图模型的提示词');
  assert.strictEqual(first.sourceId, 'grok-source');
  assert.strictEqual(first.model, 'grok-imagine-image');
  assert.strictEqual(first.mime, 'image/png');
  assert.strictEqual(first.width, 480);
  assert.strictEqual(first.height, 640);
  assert(first.mediaKey && first.mediaHash && first.id && first.createdAt > 0);
  assert.strictEqual('blob' in first, false, '保存成功后条目不再挂内存 Blob');
  assert((await mediaKeys(page)).includes(first.mediaKey), '图片 Blob 写入 media Store');

  await page.evaluate(() => {
    getActiveSession('image-char').msgs.push({role: 'assistant', content: '后来的一条回复', seq: 3, time: 3000});
    renderChat();
  });
  assert.strictEqual(await page.locator('[data-msg-seq="2"] [data-message-image-action]').count(), 1, '旧 AI 回复仍能从更多生图');
  assert.strictEqual(await page.locator('[data-msg-seq="3"] [data-message-image-action]').count(), 0, '最新 AI 回复不重复提供菜单入口');
  await page.evaluate(() => { getActiveSession('image-char').msgs.pop(); renderChat(); });

  // 2. 一次两张：追加到末尾，显示这批的第一张，计数与左右切换。
  await page.evaluate(async () => {
    D.settings.imageSources[0].n = 2;
    await saveData('meta');
  });
  await generate(page, 1);
  await shownImages(page, 3);
  await waitIdle(page);
  current = await message(page);
  assert.strictEqual(current.images.length, 3);
  assert.strictEqual(current.images[0], first.mediaKey, '新图追加在末尾');
  const counter = page.locator('[data-msg-seq="2"] .message-image-count');
  const countIs = text => page.waitForFunction(value => document.querySelector('[data-msg-seq="2"] .message-image-count').textContent.trim() === value, text);
  await countIs('2 / 3');
  await page.locator('[data-msg-seq="2"] .message-image-next').click();
  await countIs('3 / 3');
  assert.strictEqual(await page.locator('[data-msg-seq="2"] .message-image-next').isDisabled(), true);
  await page.locator('[data-msg-seq="2"] .message-image-prev').click();
  await countIs('2 / 3');
  // 点按图片区不切换操作条。
  const actionsBefore = await page.locator('[data-msg-seq="2"]').evaluate(row => row.classList.contains('actions-open'));
  await page.locator('[data-msg-seq="2"] .message-images').click({position: {x: 20, y: 20}});
  assert.strictEqual(await page.locator('[data-msg-seq="2"]').evaluate(row => row.classList.contains('actions-open')), actionsBefore, '点按图片不切换消息操作条');

  // 3. 重载后图片仍在，按需从 media Store 读出显示。
  await reload(page);
  await shownImages(page, 3);
  assert.strictEqual((await counter.textContent()).trim(), '1 / 3');
  current = await message(page);
  assert.strictEqual(current.images.length, 3);
  const imageKeys = current.images;

  // 4. 卡片 getChatMessages 只读投影 extra.media；原样写回或写 media: [] 都不冲掉夜欲图片，也不把投影存进 extra。
  const projection = await page.evaluate(async () => {
    const helper = _cardScriptLibraryLive.frame.contentWindow.TavernHelper;
    const row = helper.getChatMessages(1)[0];
    const swipes = helper.getChatMessages(1, {include_swipes: true})[0];
    await helper.setChatMessages([{message_id: 1, message: row.message, extra: row.extra}], {refresh: 'none'});
    const afterEcho = getActiveSession('image-char').msgs[1];
    const echoed = {images: (afterEcho.images || []).length, extraMedia: afterEcho.extra && afterEcho.extra.media};
    await helper.setChatMessages([{message_id: 1, message: row.message, extra: {media: []}}], {refresh: 'none'});
    const afterClear = getActiveSession('image-char').msgs[1];
    return {
      media: row.extra.media.map(item => ({type: item.type, title: item.title, url: /^blob:/.test(item.url)})),
      infos: swipes.swipes_info.map(info => (info.media || []).length),
      echoed,
      cleared: (afterClear.images || []).length,
    };
  });
  assert.deepStrictEqual(projection.media, Array.from({length: 3}, () => ({type: 'image', title: PROMPT, url: true})));
  assert.deepStrictEqual(projection.infos, [3, 0], '候选视图各自投影自己的图片');
  assert.strictEqual(projection.echoed.images, 3);
  assert(!projection.echoed.extraMedia || projection.echoed.extraMedia.length === 0, '投影项不得写回 extra.media');
  assert.strictEqual(projection.cleared, 3, 'media: [] 不删除夜欲图片');
  // 卡片删掉 ST 自己的媒体项、只剩投影项写回：以剔除投影后的结果为准，ST 项真的删掉，夜欲图片仍在。
  const stMedia = await page.evaluate(async () => {
    const helper = _cardScriptLibraryLive.frame.contentWindow.TavernHelper;
    await helper.setChatMessages([{message_id: 1, message: helper.getChatMessages(1)[0].message, extra: {media: [{url: 'st.png', type: 'image'}]}}], {refresh: 'none'});
    const row = helper.getChatMessages(1)[0];
    const projected = row.extra.media.filter(item => item.yeyu_image_id);
    const stored = () => getActiveSession('image-char').msgs[1];
    const withSt = {media: (stored().extra.media || []).map(item => item.url), images: (stored().images || []).length};
    await helper.setChatMessages([{message_id: 1, message: row.message, extra: {media: projected}}], {refresh: 'none'});
    return {withSt, after: stored().extra.media, images: (stored().images || []).length};
  });
  assert.deepStrictEqual(stMedia.withSt.media, ['st.png']);
  assert.deepStrictEqual(stMedia.after, [], '只剩投影项的写回删掉 ST 媒体项');
  assert.strictEqual(stMedia.images, 3, '删 ST 媒体项不影响夜欲图片');

  // 5. 经 TavernHelper 切换候选：图片随候选换出，重载后归属不变；切回后恢复。
  await page.evaluate(async () => {
    await _cardScriptLibraryLive.frame.contentWindow.TavernHelper.setChatMessages([{message_id: 1, swipe_id: 1}]);
  });
  current = await message(page);
  assert.strictEqual(current.swipeId, 1);
  assert.deepStrictEqual(current.images, []);
  assert.deepStrictEqual(current.slots[0], imageKeys);
  assert.strictEqual(await page.locator('[data-msg-seq="2"] img.message-image').count(), 0);
  await reload(page);
  current = await message(page);
  assert.strictEqual(current.swipeId, 1);
  assert.deepStrictEqual(current.images, [], '重载后候选一仍没有图');
  assert.deepStrictEqual(current.slots[0], imageKeys, '重载后图片仍属于候选零');
  await page.evaluate(async () => {
    await _cardScriptLibraryLive.frame.contentWindow.TavernHelper.setChatMessages([{message_id: 1, swipe_id: 0}]);
  });
  await reload(page);
  current = await message(page);
  assert.strictEqual(current.swipeId, 0);
  assert.deepStrictEqual(current.images, imageKeys, '切回候选零后图片恢复');
  await shownImages(page, 3);

  // 6. 生成新候选从空图开始；在新候选上生图后删除该候选，只回收它的图。
  await page.evaluate(async () => {
    const session = getActiveSession('image-char');
    await commitGeneratedResponse(
      {charId: 'image-char', sessionId: session.id, mode: 'swipe', messageIndex: 1, messageSeq: 2},
      '候选二：海风把围巾吹起。',
      {finishReason: 'stop'}
    );
  });
  current = await message(page);
  assert.strictEqual(current.swipeId, 2);
  assert.deepStrictEqual(current.images, [], '新候选从空图开始');
  assert.deepStrictEqual(current.slots[0], imageKeys);
  await page.evaluate(async () => {
    D.settings.imageSources[0].n = 1;
    await saveData('meta');
  });
  await generate(page, 1);
  await shownImages(page, 1);
  await waitIdle(page);
  const swipeTwoKey = (await message(page)).images[0];
  assert((await mediaKeys(page)).includes(swipeTwoKey));
  await page.evaluate(async () => { await deleteMessageSwipeCandidate(2, {messageIndex: 1}); });
  current = await message(page);
  assert.strictEqual(current.swipeId, 1);
  let stored = await mediaKeys(page);
  assert(!stored.includes(swipeTwoKey), '删除候选后保存回收它的图片');
  assert(imageKeys.every(key => stored.includes(key)), '仍被引用的图片不回收');

  // 7. 编辑确认框里的提示词后，出图用确认后的文本。
  await page.evaluate(async () => { await switchMessageSwipe(1, -1, {targetIndex: 0}); });
  let imageRequests = state.imageBodies.length;
  await page.evaluate(i => { generateMessageImage(i); }, 1);
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  await page.evaluate(() => { document.getElementById('app-prompt-textarea').value = 'edited manual prompt'; });
  await page.locator('#app-prompt-ok').click();
  await shownImages(page, 4);
  await waitIdle(page);
  assert.strictEqual(state.imageBodies.length, imageRequests + 1);
  assert.strictEqual(state.imageBodies[state.imageBodies.length - 1].prompt, 'edited manual prompt', '出图用确认后的提示词');
  assert.deepStrictEqual((await message(page)).images.length, imageKeys.length + 1);
  await page.evaluate(async () => {
    const m = getActiveSession('image-char').msgs[1];
    setMessageCandidateImages(m, 0, m.images.slice(0, m.images.length - 1));
    await saveData('sessions', {urgent: true});
    renderChat();
  });

  // 8. 审核拒绝：专门提示，消息没有新图。
  await clearToasts(page);
  state.image = 'moderated';
  await generate(page, 1);
  await waitIdle(page);
  assert.match(await lastToast(page), /内容审核拒绝.*没有生成图片.*可能仍会计费/);
  assert.deepStrictEqual((await message(page)).images, imageKeys);

  // 9. 写提示词失败：明确提示，不发出图请求。
  state.image = 'ok';
  state.chat = 'fail';
  imageRequests = state.imageBodies.length;
  await clearToasts(page);
  await page.evaluate(i => { generateMessageImage(i); }, 1);
  await waitIdle(page);
  assert.match(await lastToast(page), /出图提示词生成失败/);
  assert.strictEqual(state.imageBodies.length, imageRequests, '写提示词失败不出图');
  assert.deepStrictEqual((await message(page)).images, imageKeys);

  // 10. 进行中可停止：同一消息只有一个进行中的生图，停止后不留图。
  state.chat = 'ok';
  state.image = 'hang';
  await generate(page, 1);
  await page.waitForFunction(() => document.querySelector('[data-msg-seq="2"] .message-image-status'));
  await page.waitForFunction(() => document.querySelector('#composer-image-btn').getAttribute('aria-label') === '停止生图');
  await page.locator('#composer-image-btn').click();
  await waitIdle(page);
  assert.strictEqual(await page.locator('#composer-image-btn').getAttribute('aria-label'), '为最新 AI 回复生图');
  assert.deepStrictEqual((await message(page)).images, imageKeys, '停止后没有新图');
  if (state.hung) await state.hung.abort().catch(() => {});
  state.image = 'ok';

  // 写提示词期间输入区不变成停止键（照常可发送），消息内的「停止」仍能取消，且不再出图。
  state.chat = 'hang';
  const imagesBeforePromptStop = state.imageBodies.length, chatsBeforePromptStop = state.chatBodies.length;
  await page.evaluate(i => { generateMessageImage(i); }, 1);
  await page.waitForFunction(() => document.querySelector('[data-msg-seq="2"] .message-image-status'));
  for (let i = 0; i < 200 && state.chatBodies.length === chatsBeforePromptStop; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.strictEqual(state.chatBodies.length, chatsBeforePromptStop + 1, '写提示词请求已发出');
  assert.deepStrictEqual(await page.evaluate(() => ({
    stop: document.querySelector('#composer-action-btn').classList.contains('stop-mode'),
    releasable: transientRequestsReleasable(),
  })), {stop: false, releasable: false}, '写提示词不占用输入区的停止键');
  await page.locator('[data-msg-seq="2"] .message-image-status button').click();
  await waitIdle(page);
  assert.strictEqual(await page.locator('#app-prompt-modal.open').count(), 0, '停止在写提示词阶段不弹提示词确认框');
  if (state.chatHung) await state.chatHung.abort().catch(() => {});
  assert.strictEqual(state.imageBodies.length, imagesBeforePromptStop, '写提示词阶段停止后不出图');
  assert.deepStrictEqual((await message(page)).images, imageKeys, '写提示词阶段停止后没有新图');
  state.chat = 'ok';

  // 提示词确认框打开时点消息内「停止」，弹窗随这次生图一起关闭，同样不再出图。
  await page.evaluate(i => { generateMessageImage(i); }, 1);
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  await page.evaluate(() => stopMessageImage(1));
  await waitIdle(page);
  assert.strictEqual(await page.locator('#app-prompt-modal.open').count(), 0, '停止关掉提示词确认框');
  assert.deepStrictEqual((await message(page)).images, imageKeys, '确认阶段停止后没有新图');

  // 生图进行中删掉发起它的候选，再生成一条同文候选：迟到的图片属于已删除的候选，不落到新候选上。
  const sameText = '候选三：浪花打湿了栈桥。';
  // A committed reply is handed to the card scripts afterwards; generating an image waits for that to end.
  const commitSwipe = async () => {
    await page.evaluate(async text => {
      const session = getActiveSession('image-char');
      await commitGeneratedResponse({charId: 'image-char', sessionId: session.id, mode: 'swipe', messageIndex: 1, messageSeq: 2}, text, {finishReason: 'stop'});
    }, sameText);
    await page.waitForFunction(() => !_generationPostCommitTasks.has(getActiveSession('image-char')));
  };
  await commitSwipe();
  const deletedSwipe = (await message(page)).swipeId;
  state.image = 'hang';
  state.hung = null;
  await generate(page, 1);
  for (let i = 0; i < 400 && !state.hung; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert(state.hung, '出图请求应已发出');
  await page.evaluate(index => deleteMessageSwipeCandidate(index, {messageIndex: 1}), deletedSwipe);
  await commitSwipe();
  assert.strictEqual((await message(page)).swipeId, deletedSwipe, '新候选占回被删候选的位置且正文相同');
  await state.hung.fulfill(json({data: [{b64_json: PNGS[0], mime_type: 'image/png'}]}));
  state.hung = null;
  state.image = 'ok';
  await waitIdle(page);
  assert.deepStrictEqual((await message(page)).images, [], '迟到的图片不得落到删除后重建的同文候选');
  await page.evaluate(async index => {
    await deleteMessageSwipeCandidate(index, {messageIndex: 1});
    await switchMessageSwipe(1, -1, {targetIndex: 0});
  }, deletedSwipe);
  assert.deepStrictEqual((await message(page)).images, imageKeys);

  // 11. 没有可用来源：给出指向设置的提示，不弹提示词确认框。
  await page.evaluate(async () => {
    D.settings.imageSources = [];
    D.settings.activeImageSourceId = '';
    await saveData('meta');
  });
  await clearToasts(page);
  await page.evaluate(i => { generateMessageImage(i); }, 1);
  await waitIdle(page);
  assert.match(await lastToast(page), /设置.*生图/);

  // 12. 长按单张删除：取消无写入，左右滑动不误触；确认后只改目标候选，共享媒体仍在。
  const selectedImage = page.locator('[data-msg-seq="2"] .message-image').first();
  await selectedImage.click();
  assert.strictEqual(await page.locator('#app-prompt-modal.open').count(), 0, '普通点按不弹出删除确认');
  await selectedImage.evaluate(image => {
    image.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 4, button: 0, clientX: 50, clientY: 50}));
    image.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 4, clientX: 90, clientY: 50}));
  });
  await page.waitForTimeout(650);
  await selectedImage.evaluate(image => image.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 4})));
  assert.strictEqual(await page.locator('#app-prompt-modal.open').count(), 0, '横滑不触发长按删除');
  await holdImage(page, selectedImage);
  await page.locator('#app-prompt-modal').getByRole('button', {name: '取消', exact: true}).click();
  assert.deepStrictEqual((await message(page)).images, imageKeys, '取消删除不改变图片');
  await page.evaluate(async () => {
    const m = getActiveSession('image-char').msgs[1];
    setMessageCandidateImages(m, 1, [m.images[0]]);
    await saveData('sessions', {urgent: true});
  });
  const originalText = await page.evaluate(() => getActiveSession('image-char').msgs[1].content);
  await holdImage(page, selectedImage);
  await page.evaluate(async () => { await switchMessageSwipe(1, 1, {targetIndex: 1}); });
  await page.locator('#app-prompt-ok').click();
  await page.waitForFunction(() => (getActiveSession('image-char').msgs[1].swipeImages[0] || []).length === 2);
  assert.deepStrictEqual((await message(page)).images, [imageKeys[0]], '确认期间切换候选，不删除新候选里的共享图片');
  await page.evaluate(async () => { await switchMessageSwipe(1, -1, {targetIndex: 0}); });
  await shownImages(page, 2);
  assert.deepStrictEqual((await message(page)).images, imageKeys.slice(1), '确认只删除所选的一张图');
  assert((await mediaKeys(page)).includes(imageKeys[0]), '其他候选的共享引用保留媒体');
  assert.strictEqual(await page.evaluate(() => getActiveSession('image-char').msgs[1].content), originalText, '删图保留文字');
  await reload(page);
  await shownImages(page, 2);
  assert.deepStrictEqual((await message(page)).images, imageKeys.slice(1), '单张删除在重载后仍生效');
  await page.locator('[data-msg-seq="2"] .message-image-next').click();
  await holdImage(page, page.locator('[data-msg-seq="2"] .message-image').last());
  await page.locator('#app-prompt-ok').click();
  await shownImages(page, 1);
  await holdImage(page, page.locator('[data-msg-seq="2"] .message-image'));
  await page.locator('#app-prompt-ok').click();
  await page.waitForFunction(() => !document.querySelector('[data-msg-seq="2"] .message-images'));
  assert.strictEqual(await page.locator('[data-msg-seq="2"] .message-image-controls').count(), 0, '最后一张删除后没有空图与翻页占位');
  assert.deepStrictEqual((await message(page)).slots[1], [imageKeys[0]], '另一个候选不受影响');

  // 13. 删除整条消息后保存，图片全部回收。
  await page.evaluate(async () => {
    const session = getActiveSession('image-char');
    session.msgs.splice(1, 1);
    await saveData('sessions', {urgent: true});
  });
  stored = await mediaKeys(page);
  assert(imageKeys.every(key => !stored.includes(key)), '删除消息后图片 Blob 被回收');

  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log('message images: manual generation, swipe ownership, card projection and media cleanup');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
