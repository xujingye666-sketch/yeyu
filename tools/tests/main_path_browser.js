'use strict';

// Daily main path from the real DOM: import a card file, see its greeting, send, watch the reply stream,
// stop it mid-stream, reload and find the conversation intact. The API connection is entered through the
// settings page; the model is a local SSE stub on the same origin that writes timed chunks, so the stop
// always lands inside the stream and no request leaves the machine.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');

const {waitForAppReady} = require('./helpers/app-ready');
const assets = path.resolve(__dirname, '../../app/src/main/assets');
const CARD_NAME = '主路径验收角色';
const GREETING = '灯塔的门吱呀一声开了，守夜人举着油灯看向你。';
// Card fields carry SillyTavern name macros; the prompt copy sent to the model must resolve {{char}} to the
// card name and {{user}} to the active persona, which is created through the persona editor beforehand.
const PERSONA_NAME = '雨夜旅人';
const DESCRIPTION = '{{char}}是海边灯塔的守夜人，认得每个来避雨的{{user}}。';
const SCENARIO = '{{user}}在暴雨夜敲开了{{char}}的门。';
const resolveNames = text => text.replaceAll('{{char}}', CARD_NAME).replaceAll('{{user}}', PERSONA_NAME);
const USER_TEXT = '我把湿透的外套挂在门边，问他今晚还有没有船。';
// Dialogue examples reach the model as system messages named example_user / example_assistant, as in ST.
const MES_EXAMPLE = '<START>\n{{user}}: 还有船吗？\n{{char}}: 等雨停。';
const CHUNKS = Array.from({length: 60}, (_, index) => `第${index + 1}段浪声。`);
const CHUNK_INTERVAL_MS = 120;
// Stop only after this many chunks are visible, well past the composer's 400 ms double-tap guard.
const STOP_AFTER_CHUNKS = 5;

// The first streamed chat request is the main reply; any auxiliary request gets an empty completion.
function createModelStub() {
  const state = {mainRequests: 0, mainBody: null, auxiliaryRequests: 0, sentChunks: 0, clientClosedEarly: false, finished: false};
  function handle(request, response) {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (_) {}
      if (!String(request.url).endsWith('/chat/completions') || body.stream !== true || state.mainRequests) {
        state.auxiliaryRequests += 1;
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify({choices: [{finish_reason: 'stop', message: {role: 'assistant', content: ''}}]}));
        return;
      }
      state.mainRequests += 1;
      state.mainBody = body;
      response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
      let closed = false;
      response.on('close', () => {
        closed = true;
        if (!state.finished) state.clientClosedEarly = true;
      });
      const push = () => {
        if (closed) return;
        if (state.sentChunks >= CHUNKS.length) {
          state.finished = true;
          response.end('data: [DONE]\n\n');
          return;
        }
        response.write('data: ' + JSON.stringify({choices: [{delta: {content: CHUNKS[state.sentChunks]}}]}) + '\n\n');
        state.sentChunks += 1;
        setTimeout(push, CHUNK_INTERVAL_MS);
      };
      setTimeout(push, CHUNK_INTERVAL_MS);
    });
  }
  return {state, handle};
}

function writeCardFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeyu-main-path-'));
  const file = path.join(directory, 'main-path-card.json');
  fs.writeFileSync(file, JSON.stringify({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {name: CARD_NAME, description: DESCRIPTION, personality: '寡言、可靠。', scenario: SCENARIO, first_mes: GREETING, mes_example: MES_EXAMPLE},
  }));
  return {directory, file};
}

let browser;
let server;
let fixture;
(async () => {
  const started = Date.now();
  fixture = writeCardFixture();
  const model = createModelStub();
  server = createAssetServer(assets);
  const serveAsset = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (request, response) => (String(request.url).startsWith('/v1/') ? model.handle : serveAsset)(request, response));
  await listenOnBrowserSafePort(server);
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  await context.route(url => !String(url).startsWith(origin), route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {ignoreFavicon: true});
  const appReady = () => waitForAppReady(page);
  const chat = page.locator('#chat-messages');
  const composer = page.locator('#composer-action-btn');
  const streamBubble = page.locator('#chat-messages .stream-active-bubble');
  // Exactly greeting, user message and the stopped reply, each stored and drawn once, with no draft left behind.
  const assertStoppedConversation = async label => {
    const view = await page.evaluate(async () => {
      const char = getChar();
      const session = getActiveSession(char.id);
      const stored = await YeyuRepository.load();
      const storedDrafts = await YeyuRepository.loadStreamDrafts(sanitizeStoredStreamDraft);
      const summary = rows => rows.map(row => ({role: row.role, content: row.content, incomplete: row.generationMeta?.incomplete === true}));
      return {
        rows: summary(session.msgs),
        storedRows: summary(stored.data.chats[char.id].sessions.find(row => row.id === session.id).msgs),
        seqs: Array.from(document.querySelectorAll('#chat-messages [data-msg-seq]'), row => row.dataset.msgSeq),
        drafts: _streamDrafts.concat(storedDrafts.drafts).filter(row => row.charId === char.id).length,
      };
    });
    assert.deepStrictEqual(view.rows.map(row => row.role), ['assistant', 'user', 'assistant'], `${label}：会话必须恰好是开场白、用户消息、助手回复`);
    assert.deepStrictEqual([view.rows[0].content, view.rows[1].content], [GREETING, USER_TEXT]);
    assert.strictEqual(view.rows[2].incomplete, true, `${label}：停止的回复必须标记为未完成`);
    assert.deepStrictEqual(view.storedRows, view.rows, `${label}：落库内容必须与会话一致且不重复`);
    assert.strictEqual(view.seqs.length, 3, `${label}：界面必须恰好显示三条消息`);
    assert.strictEqual(new Set(view.seqs).size, 3, `${label}：界面不得重复显示同一条消息`);
    assert.strictEqual(view.drafts, 0, `${label}：不得残留流式草稿`);
    await chat.locator('.msg').last().locator('.generation-meta.interrupted').waitFor();
    return view.rows[2];
  };
  await page.goto(`${origin}/index.html`, {waitUntil: 'load'});
  await appReady();

  // API connection through the settings page.
  await page.locator('#bottom-nav [data-page="settings"]').click();
  await page.locator('#s-api-url').fill(`${origin}/v1`);
  await page.locator('#s-api-key').fill('stub-key');
  await page.locator('#s-model').fill('stub-model');
  await page.locator('#settings-modal .modal-ft .btn.primary').click();
  await page.waitForFunction(url => activeProviderForSettings(D.settings).apiUrl === url, `${origin}/v1`);
  await page.locator('#bottom-nav [data-page="chat"]').click();

  // The first persona saved in its editor becomes the active one that {{user}} resolves to.
  await page.locator('#mobile-menu').click();
  await page.locator('.sidebar-tabs [data-tab="personas"]').click();
  await page.locator('#tab-personas .sidebar-ft .btn.primary').click();
  await page.locator('#p-name').fill(PERSONA_NAME);
  await page.locator('#persona-modal .modal-ft .btn.primary').click();
  await page.locator('#persona-list .persona-item.active').filter({hasText: PERSONA_NAME}).waitFor();
  await page.locator('#persona-modal .modal-close').click();
  await page.locator('#persona-modal').waitFor({state: 'hidden'});
  await page.locator('.sidebar-tabs [data-tab="chars"]').click();
  await page.locator('.sidebar-close').click();

  // 1-2. Import the card through the file picker and its confirmation, then see the greeting.
  await page.locator('#empty-home .btn.primary').click();
  await page.locator('#file-input').setInputFiles(fixture.file);
  await page.locator('#import-preview .import-mode-card').waitFor();
  await page.locator('#import-preview .import-confirm').click();
  await page.locator('#import-modal').waitFor({state: 'hidden'});
  // An imported card waits on the home screen until it is picked from the sidebar list.
  await page.locator('#mobile-menu').click();
  await page.locator('#char-list .char-item').filter({hasText: CARD_NAME}).click();
  await page.locator('#greeting-modal').getByText(GREETING).waitFor();
  await page.locator('#greeting-modal .btn.primary').click();
  await chat.getByText(GREETING).waitFor();

  // 3. Type into the composer and press send.
  await page.locator('#user-input').click();
  await page.keyboard.type(USER_TEXT);
  await composer.click();
  await chat.getByText(USER_TEXT).waitFor();

  // 4. The reply appears in pieces and keeps growing while the stream is open.
  await page.waitForFunction(first => document.querySelector('#chat-messages .stream-active-bubble')?.textContent.includes(first), CHUNKS[0]);
  const firstSeen = (await streamBubble.textContent()).trim();
  await page.waitForFunction(length => (document.querySelector('#chat-messages .stream-active-bubble')?.textContent.trim().length || 0) > length, firstSeen.length);
  assert(!firstSeen.includes(CHUNKS[CHUNKS.length - 1]), '首段可见时回复不应已全部到达');
  assert.strictEqual(await composer.getAttribute('aria-label'), '停止当前处理', '流式期间主按钮必须切换为停止');

  // 5. Stop mid-stream: the request is cut, the composer returns to send and the received part stays.
  await page.waitForFunction(last => document.querySelector('#chat-messages .stream-active-bubble')?.textContent.includes(last), CHUNKS[STOP_AFTER_CHUNKS - 1]);
  await composer.click();
  await page.waitForFunction(() => document.getElementById('composer-action-btn').getAttribute('aria-label') === '发送消息');
  await page.waitForFunction(() => _generationState === 'idle');
  const sentAtStop = model.state.sentChunks;
  assert.strictEqual(model.state.mainRequests, 1, '主回复必须恰好请求一次');
  assert.strictEqual(model.state.clientClosedEarly, true, '停止必须中断仍在进行的流式请求');
  assert(sentAtStop >= STOP_AFTER_CHUNKS && sentAtStop < CHUNKS.length, `停止必须发生在流中途（已发送 ${sentAtStop} 段）`);
  await chat.getByText(CHUNKS[STOP_AFTER_CHUNKS - 1], {exact: false}).waitFor();
  assert.strictEqual(await streamBubble.count(), 0, '停止后不得残留流式气泡');
  const requestText = model.state.mainBody.messages.map(row => String(row.content || '')).join('\n');
  assert(requestText.includes(`${CARD_NAME}是海边灯塔的守夜人`), '角色卡字段必须以当前角色名进入请求');
  for (const text of [DESCRIPTION.slice(DESCRIPTION.indexOf('认得')), SCENARIO]) {
    assert(requestText.includes(resolveNames(text)), `角色卡字段中的用户宏必须替换为当前人格名：${resolveNames(text)}`);
  }
  assert.deepStrictEqual(
    model.state.mainBody.messages.filter(row => row.name).map(row => ({role: row.role, name: row.name, content: row.content})),
    [{role: 'system', name: 'example_user', content: '还有船吗？'}, {role: 'system', name: 'example_assistant', content: '等雨停。'}],
    '对话示例必须带 example_user / example_assistant 名字字段进入请求'
  );
  const keptReply = await assertStoppedConversation('停止后');
  assert(keptReply.content.startsWith(CHUNKS.slice(0, STOP_AFTER_CHUNKS).join('')), '停止前收到的回复必须作为助手消息保留');
  assert(!keptReply.content.includes(CHUNKS[CHUNKS.length - 1]), '停止后不得再收到后续内容');
  await page.waitForTimeout(CHUNK_INTERVAL_MS * 3);
  assert.strictEqual(model.state.sentChunks, sentAtStop, '停止后服务端不得继续推送');

  // 6. Reload: the app reopens the last conversation with the greeting, the user message and the stopped reply.
  await page.reload({waitUntil: 'load'});
  await appReady();
  await chat.getByText(GREETING).waitFor();
  await chat.getByText(USER_TEXT).waitFor();
  await chat.getByText(keptReply.content.trim(), {exact: false}).waitFor();
  assert.deepStrictEqual(await assertStoppedConversation('重载后'), keptReply, '重载后回复必须与停止时一致');

  assert.deepStrictEqual(pageErrors, [], `页面错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log(JSON.stringify({mainPath: true, chunksBeforeStop: sentAtStop, auxiliaryRequests: model.state.auxiliaryRequests, ms: Date.now() - started}));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture) fs.rmSync(fixture.directory, {recursive: true, force: true});
});
