'use strict';

// ST /imagine 系命令：自由文本与触发词取材、系统图片消息的摆放与持久化、quiet 与返回值、参数、
// 背景模式、去敏感化改写、TavernHelper 调用、预览干跑、失败返回空串，以及图片消息不进 Prompt、不挡重新生成。
const assert = require('assert');
const path = require('path');
const zlib = require('zlib');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {waitForAppReady} = require('./helpers/app-ready');

const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const WRITTEN = 'silver-haired girl on a harbor pier at dusk';
const CHAR_ID = 'imagine-char';
const REPLY = '她走上栈桥，回头看你。';
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
const PNG = solidPng(64, 96, [214, 120, 96]);

const state = {chat: 'ok', image: 'ok', chatBodies: [], imageBodies: []};
const json = body => ({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify(body)});

async function run(page, text) {
  return page.evaluate(async source => (await executeStscript(source, {handleParserErrors: false, handleExecutionErrors: false})).pipe, text);
}
async function msgs(page) {
  return page.evaluate(id => getActiveSession(id).msgs.map(m => ({
    role: m.role,
    kind: m.kind || '',
    seq: m.seq,
    content: m.content,
    images: (m.images || []).map(row => ({mediaKey: row.mediaKey, prompt: row.prompt, blob: 'blob' in row})),
  })), CHAR_ID);
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
async function lastToast(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('#toasts .toast');
    return rows.length ? rows[rows.length - 1].textContent : '';
  });
}
async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(row => row.remove()));
}
async function waitForLibrary(page) {
  await page.waitForFunction(() => typeof _cardScriptLibraryLive !== 'undefined' && _cardScriptLibraryLive
    && _cardScriptLibraryLive.state === 'ready' && _cardScriptLibraryLive.frame.contentWindow.__imagineProbeReady === true);
}
async function trimTo(page, count) {
  await page.evaluate(async ({id, n}) => {
    getActiveSession(id).msgs.length = n;
    await saveData('sessions', {urgent: true});
    renderChat();
  }, {id: CHAR_ID, n: count});
}
function lastChat() {
  const body = state.chatBodies[state.chatBodies.length - 1];
  return {messages: body.messages, task: body.messages[body.messages.length - 1]};
}
function lastImage() {
  return state.imageBodies[state.imageBodies.length - 1];
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
    return route.fulfill(json({choices: [{message: {role: 'assistant', content: WRITTEN}, finish_reason: 'stop'}]}));
  });
  await context.route('https://api.x.ai/**', route => {
    const body = route.request().postDataJSON();
    state.imageBodies.push(body);
    if (state.image === 'moderated')
      return route.fulfill({status: 400, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: JSON.stringify({code: 'imagine:content-moderated', error: 'Generated image rejected by content moderation.'})});
    return route.fulfill(json({data: Array.from({length: body.n || 1}, () => ({b64_json: PNG, mime_type: 'image/png'}))}));
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
  await page.evaluate(async ({id, reply}) => {
    D = defaults();
    D.settings.useMemory = false;
    D.settings.providers[0].apiUrl = 'https://chat.example.test/v1';
    D.settings.providers[0].model = 'chat-model';
    D.settings.providers[0].apiKey = 'synthetic-chat-key';
    D.settings.grokSubscriptionAuth = {accessToken: 'grok-test-token', refreshToken: 'grok-test-refresh', expiresAt: Date.now() + 3600000};
    D.settings.imageSources = [{id: 'grok-source', type: 'grok-subscription', name: 'Grok 出图', model: 'grok-imagine-image', n: 2, aspectRatio: '3:4'}];
    D.settings.activeImageSourceId = 'grok-source';
    D.personas = [{id: 'traveler', name: '旅人', desc: '{{user}}：黑色风衣，背着画板。'}];
    D.activePersonaId = 'traveler';
    const char = parseCard({name: '港口少女', description: '{{char}}：银发，红色围巾。', first_mes: ''});
    char.id = id;
    char.scriptsEnabled = true;
    char.extensions = {
      yeyu: {componentImportMode: 'full'},
      tavern_helper: {scripts: [{type: 'script', enabled: true, name: 'probe', id: 'imagine-probe', content: 'window.__imagineProbeReady=true;'}]},
    };
    const session = createBlankSession('出图对话', 'imagine-session');
    session.greetingChosen = true;
    session.msgs = [
      {role: 'user', content: '我们去港口看看吧。', time: 1000, seq: 1},
      {role: 'assistant', content: reply, time: 2000, seq: 2},
    ];
    ensureMessageSequences(session);
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    renderChat();
    updateChatUI();
  }, {id: CHAR_ID, reply: REPLY});
  await waitForLibrary(page);

  // 1. 自由文本：直接总结来源原样出一张图，新建系统图片消息，返回 data URL。
  let url = await run(page, '/imagine a red fox in the snow');
  assert.match(url, /^data:image\/png;base64,/, '返回自包含的 data URL');
  assert.strictEqual(state.chatBodies.length, 0, '直接总结来源的自由文本不经写提示词模型');
  assert.deepStrictEqual(lastImage(), {model: 'grok-imagine-image', prompt: 'a red fox in the snow', n: 1, response_format: 'b64_json', aspect_ratio: '3:4'}, '一条命令只出一张');
  let rows = await msgs(page);
  assert.strictEqual(rows.length, 3);
  const imageRow = rows[2];
  assert.strictEqual(imageRow.role, 'system');
  assert.strictEqual(imageRow.kind, 'generated-image');
  assert.strictEqual(imageRow.content, '[港口少女 sends a picture that contains: a red fox in the snow].');
  assert.deepStrictEqual(imageRow.images.map(row => [row.prompt, row.blob]), [['a red fox in the snow', false]]);
  assert((await mediaKeys(page)).includes(imageRow.images[0].mediaKey), '图片写入 media Store');
  await page.waitForFunction(seq => document.querySelectorAll(`[data-msg-seq="${seq}"] img.message-image[src^="blob:"]`).length === 1, imageRow.seq);
  assert.match(await page.locator(`[data-msg-seq="${imageRow.seq}"]`).textContent(), /港口少女/, '图片消息以角色名显示');

  // 2. 重载后图片仍在。
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  await waitForLibrary(page);
  await page.waitForFunction(seq => document.querySelectorAll(`[data-msg-seq="${seq}"] img.message-image[src^="blob:"]`).length === 1, imageRow.seq);

  // 3. 图片消息不进下一轮 Prompt，也不挡末尾助手消息的重新生成。
  const promptText = await page.evaluate(async id => JSON.stringify(await buildMessages(getChar(), getActiveSession(id).msgs)), CHAR_ID);
  assert(promptText.includes(REPLY), 'Prompt 仍含助手回复');
  assert(!promptText.includes('sends a picture'), '系统图片消息不进 Prompt');

  // 4. 图片消息上的「生图」：沿用原提示词直接出图，不经写提示词模型，追加到同一条消息。
  await page.evaluate(() => { D.settings.imageSources[0].promptMode = 'desensitize'; });
  await page.evaluate(index => generateMessageImage(index), 2);
  await page.waitForFunction(seq => document.querySelectorAll(`[data-msg-seq="${seq}"] img.message-image[src^="blob:"]`).length === 2, imageRow.seq);
  assert.strictEqual(state.chatBodies.length, 0, '图片消息上的生图不经 LLM');
  assert.strictEqual(lastImage().prompt, 'a red fox in the snow');
  rows = await msgs(page);
  assert.strictEqual(rows[2].images.length, 2);
  const imageMessageKeys = rows[2].images.map(row => row.mediaKey);

  // 5. 去敏感化来源：自由文本先用卡片提示词改写再出图。
  url = await run(page, '/imagine quiet=true a red fox in the snow');
  assert.match(url, /^data:image\/png;base64,/);
  const rewrite = lastChat().messages;
  assert.strictEqual(rewrite.length, 2, '卡片改写仍是 system 任务加卡片提示词');
  assert(rewrite[0].role === 'system' && rewrite[0].content.includes('输入是卡片给出的一段出图提示词'), '自由文本按卡片提示词改写');
  assert(rewrite[0].content.includes('需要注意：'), '去敏感化改写叠加注意事项段');
  assert.strictEqual(rewrite[1].content, 'a red fox in the snow');
  assert.strictEqual(lastImage().prompt, WRITTEN);

  // 写提示词进行中：输入区停止键可用，停止即取消，不出图、返回空串。
  state.chat = 'hang';
  const chatsBeforeStop = state.chatBodies.length, imagesBeforeStop = state.imageBodies.length;
  await page.evaluate(() => {
    window.__imagineRun = executeStscript('/imagine quiet=true a lantern', {handleParserErrors: false, handleExecutionErrors: false})
      .then(result => result.pipe, error => 'ERR:' + error.message);
  });
  for (let i = 0; i < 200 && state.chatBodies.length === chatsBeforeStop; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.strictEqual(state.chatBodies.length, chatsBeforeStop + 1, '/imagine 写提示词请求已发出');
  assert.strictEqual(await page.evaluate(() => document.querySelector('#composer-action-btn').classList.contains('stop-mode')), true,
    '/imagine 写提示词期间输入区可停止');
  await page.evaluate(() => stopGeneration());
  assert.strictEqual(await page.evaluate(() => window.__imagineRun), '', '停止后 /imagine 返回空串');
  if (state.chatHung) await state.chatHung.abort().catch(() => {});
  assert.strictEqual(state.imageBodies.length, imagesBeforeStop, '停止后不出图');
  state.chat = 'ok';
  await page.evaluate(() => { D.settings.imageSources[0].promptMode = 'summary'; });

  // 快捷回复里的 /imagine 在图片消息保存期间被停止：撤回这条图片消息并持久化撤回，不返回图片。
  const rowsBeforeSaveStop = (await msgs(page)).length;
  await page.evaluate(() => {
    const save = saveData;
    window.__heldSave = null;
    saveData = function (sections) {
      if (![].concat(sections).includes('sessions')) return save.apply(this, arguments);
      saveData = save;
      const self = this, args = arguments;
      return new Promise(resolve => { window.__heldSave = () => resolve(save.apply(self, args)); });
    };
    window.__imagineRun = qrRunTop(abort => executeStscript('/imagine a paper boat', {abortController: abort, handleParserErrors: false, handleExecutionErrors: false}))
      .then(result => String(result.pipe || ''), error => 'ERR:' + error.message);
  });
  await page.waitForFunction(() => typeof window.__heldSave === 'function');
  await page.evaluate(() => { stopGeneration(); window.__heldSave(); });
  assert.doesNotMatch(await page.evaluate(() => window.__imagineRun), /^data:/, '保存期间停止后 /imagine 不返回图片');
  assert.strictEqual((await msgs(page)).length, rowsBeforeSaveStop, '保存期间停止不留图片消息');
  assert.strictEqual(await page.evaluate(async id => (await YeyuRepository.load()).data.chats[id].sessions[0].msgs.length, CHAR_ID),
    rowsBeforeSaveStop, '撤回同样写入数据库');

  // 6. quiet=true 与 /sd 别名：不建消息、不留图，只返回 data URL；width/height 映射为最近画幅，model 覆盖来源模型。
  const storedBefore = await mediaKeys(page);
  url = await run(page, '/sd quiet=true width=1280 height=720 model=grok-imagine-image-2.0 negative="lowres" seed=7 a lighthouse');
  assert.match(url, /^data:image\/png;base64,/);
  assert.deepStrictEqual(lastImage(), {model: 'grok-imagine-image-2.0', prompt: 'a lighthouse', n: 1, response_format: 'b64_json', aspect_ratio: '16:9'}, 'negative 与 seed 不发送');
  assert.strictEqual((await msgs(page)).length, 3, 'quiet 不新建消息');
  await page.evaluate(() => saveData('sessions', {urgent: true}));
  assert.deepStrictEqual((await mediaKeys(page)).sort(), storedBefore.sort(), 'quiet 的图片不另行持久化');

  // 7. 触发词：raw_last 用最新一条非系统消息原文、不调用写提示词；last 读最新消息写提示词。
  const chatCount = state.chatBodies.length;
  await run(page, '/img quiet=true raw_last');
  assert.strictEqual(state.chatBodies.length, chatCount, 'raw_last 不调用写提示词模型');
  assert.strictEqual(lastImage().prompt, REPLY);
  await run(page, '/image quiet=true last');
  let chat = lastChat();
  assert.strictEqual(chat.task.role, 'user', '任务消息追加在已生效 Prompt 末尾');
  assert(chat.task.content.startsWith('现在暂停续写和扮演'), 'last 用直接总结任务消息');
  assert(!chat.messages.slice(0, -1).some(row => row.role === 'system' && row.content.includes('出图')), '已生效 Prompt 之外没有外层任务说明');
  assert(chat.messages.slice(0, -1).some(row => row.role === 'user' && row.content.includes('我们去港口看看吧。')), '截至目标消息的历史原样随请求发出');
  assert(JSON.stringify(chat.messages.slice(0, -1)).includes('港口少女：银发，红色围巾。'), '角色资料随上下文进入请求');
  assert.strictEqual(lastImage().prompt, WRITTEN);
  // me 以用户人格为主体，you 以角色为主体；主体说明接在任务消息后。
  await run(page, '/imagine quiet=true me');
  chat = lastChat();
  assert(JSON.stringify(chat.messages.slice(0, -1)).includes('旅人：黑色风衣，背着画板。'));
  assert.match(chat.task.content, /旅人的全身像/);
  await run(page, '/imagine quiet=true YOU');
  chat = lastChat();
  assert(JSON.stringify(chat.messages.slice(0, -1)).includes('港口少女：银发，红色围巾。'));
  assert.match(chat.task.content, /港口少女的全身像/);

  // 8. edit=true：写好提示词后弹窗可改；取消则不出图并返回空串。
  const imageCount = state.imageBodies.length;
  const editing = page.evaluate(() => executeStscript('/imagine quiet=true edit=true last', {handleParserErrors: false, handleExecutionErrors: false}).then(r => r.pipe));
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  await page.evaluate(() => { document.getElementById('app-prompt-textarea').value = 'edited harbor prompt'; });
  await page.locator('#app-prompt-ok').click();
  assert.match(await editing, /^data:image\//);
  assert.strictEqual(lastImage().prompt, 'edited harbor prompt', '出图用修改后的提示词');
  const cancelled = page.evaluate(() => executeStscript('/imagine quiet=true edit=true last', {handleParserErrors: false, handleExecutionErrors: false}).then(r => r.pipe));
  await page.waitForFunction(text => document.getElementById('app-prompt-modal').classList.contains('open') && document.getElementById('app-prompt-textarea').value === text, WRITTEN);
  await page.locator('#app-prompt-modal .modal-ft').getByRole('button', {name: '取消'}).click();
  assert.strictEqual(await cancelled, '');
  assert.strictEqual(state.imageBodies.length, imageCount + 1, '取消编辑不出图');

  // 9. TavernHelper triggerSlash 走同一注册表。
  url = await page.evaluate(() => _cardScriptLibraryLive.frame.contentWindow.TavernHelper.triggerSlash('/imagine quiet=true a paper boat'));
  assert.match(url, /^data:image\/png;base64,/);
  assert.strictEqual(lastImage().prompt, 'a paper boat');

  // 10. 预览干跑：只给模型调用占位，不发请求、不写消息。
  const counts = {chat: state.chatBodies.length, image: state.imageBodies.length};
  const dry = await page.evaluate(async () => {
    const notes = [];
    const result = await executeStscript('/imagine last', {abortController: stscriptDryRunController(notes), handleParserErrors: false, handleExecutionErrors: false});
    return {pipe: result.pipe, notes};
  });
  assert.match(dry.pipe, /预览未执行/);
  assert.deepStrictEqual({chat: state.chatBodies.length, image: state.imageBodies.length}, counts);
  assert.strictEqual((await msgs(page)).length, 3);

  // 11. 失败：审核拒绝、写提示词失败、没有来源都提示并返回空串，不建消息。
  state.image = 'moderated';
  await clearToasts(page);
  assert.strictEqual(await run(page, '/imagine a beach'), '');
  assert.match(await lastToast(page), /内容审核拒绝.*可能仍会计费/);
  state.image = 'ok';
  state.chat = 'fail';
  await clearToasts(page);
  assert.strictEqual(await run(page, '/imagine last'), '');
  assert.match(await lastToast(page), /出图提示词生成失败/);
  state.chat = 'ok';
  await page.evaluate(() => {
    D.settings.imageSources[0].model = '';
  });
  await clearToasts(page);
  assert.strictEqual(await run(page, '/imagine a beach'), '');
  assert.match(await lastToast(page), /设置.*生图/);
  await page.evaluate(() => {
    D.settings.imageSources[0].model = 'grok-imagine-image';
  });
  assert.strictEqual((await msgs(page)).length, 3, '失败不建消息');

  // 12. background：设为当前对话的锁定背景（图片进角色图库），同时照常发图片消息。
  await run(page, '/imagine background');
  assert.match(lastChat().task.content, /场景背景/);
  assert.strictEqual(lastImage().aspect_ratio, '16:9', 'background 把竖幅来源改成横幅');
  const background = await page.evaluate(id => {
    const char = getChar(), session = getActiveSession(id), lock = session.lockedBackground || null;
    const asset = lock && (char.media_assets || []).find(row => String(row.id) === lock.assetId);
    return {lock, asset: asset ? {kind: asset.kind, mime: asset.mime} : null, last: session.msgs[session.msgs.length - 1].kind};
  }, CHAR_ID);
  assert.strictEqual(background.lock && background.lock.charId, CHAR_ID);
  assert.deepStrictEqual(background.asset, {kind: 'image', mime: 'image/png'});
  assert.strictEqual(background.last, 'generated-image');

  // 13. 末尾是图片消息时，重新生成仍作用于最后一条助手回复，图片消息原样保留在其后。
  await trimTo(page, 3);
  state.chatBodies.length = 0;
  assert.strictEqual(await page.evaluate(() => regenerateLast()), true);
  rows = await msgs(page);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[1].role, 'assistant');
  assert.strictEqual(rows[1].content, WRITTEN, '助手回复被重新生成');
  assert.deepStrictEqual(rows[2].images.map(row => row.mediaKey), imageMessageKeys, '图片消息保留');
  assert(!JSON.stringify(state.chatBodies[0]).includes(REPLY), '重新生成不把旧回复放进历史');
  const nextSwipe = page.locator('[data-msg-seq="2"] .message-swipe-controls .opening-swipe-next');
  assert.strictEqual(await nextSwipe.getAttribute('title'), '生成新候选');
  assert.strictEqual(await nextSwipe.isDisabled(), false, '末尾回复仍可右滑生成新候选');
  assert.strictEqual(await page.locator(`[data-msg-seq="${imageRow.seq}"] .message-swipe-controls`).count(), 0, '图片消息没有候选');

  // 14. 从操作条删除图片消息，图片回收。
  await page.locator(`[data-msg-seq="${imageRow.seq}"] .msg-bubble`).click({position: {x: 8, y: 8}});
  await page.locator(`[data-msg-seq="${imageRow.seq}"] .msg-actions`).getByRole('button', {name: '删除'}).click();
  await page.waitForFunction(() => document.getElementById('app-prompt-modal').classList.contains('open'));
  await page.locator('#app-prompt-ok').click();
  await page.waitForFunction(id => getActiveSession(id).msgs.length === 2, CHAR_ID);
  await page.evaluate(() => saveData('sessions', {urgent: true}));
  const stored = await mediaKeys(page);
  assert(imageMessageKeys.every(key => !stored.includes(key)), '删除图片消息后图片 Blob 被回收');

  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log('stscript imagine: free text, triggers, system image message, quiet, parameters, background, TavernHelper, dry run and failures');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
