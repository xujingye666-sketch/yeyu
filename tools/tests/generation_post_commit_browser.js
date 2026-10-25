'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
let server, browser;
(async () => {
  server = createAssetServer(path.join(root, 'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);
  // Stopping mid-stream must leave a live card-frontend first message untouched.
  const result = await page.evaluate(async () => {
    async function until(predicate, label) {
      const deadline = Date.now() + 8000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(label);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    D = defaults();
    Object.assign(D.settings, {useMemory: false, embeddingEnabled: false, styleAuditEnabled: false,
      maxContextTokens: 0, maxTokens: 0});
    const char = parseCard({name: 'Streaming card stop', first_mes: 'opening'});
    char.id = 'message-stream-stop';
    char.scriptsEnabled = true;
    char.extensions = {yeyu: {componentImportMode: 'full'}};
    const session = createBlankSession('Streaming card stop', 'message-stream-stop-session');
    const source = '<div id="stream-card">live card<script>window.cardReady=true;<\/script></div>';
    session.msgs = [{role: 'assistant', content: source, seq: 1, time: 1}];
    session.nextMessageSeq = 2;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    switchAppPage('chat');
    updateChatUI();
    renderChat();
    await until(() => Array.from(_cardFrontendLive.values()).some(row => row.owner && row.owner.messageIndex === 0),
      'initial message card missing');
    const partial = '这段流式正文尚未完成';
    let streaming = false;
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {apiUrl: 'https://model.example.test/v1',
      apiKey: 'synthetic-key', model: 'fixture', reasoningEffort: 'off', promptPostProcessing: 'none'});
    callDeepSeek = async (messages, target, options) => {
      const response = new Response(new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({choices: [{delta: {content: partial}}]}) + '\n\n'));
        abortController.signal.addEventListener('abort',
          () => controller.error(new DOMException('Stopped', 'AbortError')), {once: true});
        streaming = true;
      }}), {headers: {'content-type': 'text/event-stream'}});
      return streamResponse(response, target, options);
    };
    const sending = doSendMessage('请继续');
    await until(() => streaming && document.getElementById('stream-msg')?.textContent.includes(partial), 'partial stream missing');
    stopGeneration();
    await sending;
    return {original: session.msgs[0].content === source};
  });
  assert.deepStrictEqual(result, {original: true}, '流式中停止不得改动首条活卡片前端消息');
  // A stream that stops sending (a half-open connection) is not cut off: after a minute without data the
  // status bar says so and points at the stop button, and new data takes the notice away again (#221).
  const stalled = await page.evaluate(async () => {
    async function until(predicate, label) {
      const deadline = Date.now() + 8000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(label);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    let push, requestSignal;
    const encoder = new TextEncoder(), realNow = Date.now;
    callDeepSeek = async (messages, target, options) => {
      requestSignal = abortController.signal;
      setGenerationState('streaming');
      const response = new Response(new ReadableStream({start(controller) {
        push = text => controller.enqueue(encoder.encode('data: ' + JSON.stringify({choices: [{delta: {content: text}}]}) + '\n\n'));
        push('半开连接前的正文。');
        requestSignal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), {once: true});
      }}), {headers: {'content-type': 'text/event-stream'}});
      return streamResponse(response, target, options);
    };
    const status = () => document.getElementById('generation-status-text').textContent,
      barShown = () => document.getElementById('typing').classList.contains('show');
    const sending = doSendMessage('等一个半开连接');
    await until(() => document.getElementById('stream-msg')?.textContent.includes('半开连接前'), 'stream missing');
    const before = {status: status(), bar: barShown()};
    try {
      Date.now = () => realNow() + 65000;
      await until(() => /已 6\d 秒没收到数据，可点停止/.test(status()), 'stall notice missing');
      const during = {bar: barShown(), state: _generationState, aborted: requestSignal.aborted};
      Date.now = realNow;
      push('又来了一段。');
      await until(() => !/没收到数据/.test(status()), 'stall notice not cleared');
      const after = {bar: barShown(), state: _generationState};
      stopGeneration();
      await sending;
      return {before, during, after};
    } finally {
      Date.now = realNow;
    }
  });
  assert.deepStrictEqual(stalled, {
    before: {status: '正在生成', bar: false},
    during: {bar: true, state: 'streaming', aborted: false},
    after: {bar: false, state: 'streaming'},
  }, '流式长时间没有新数据时只提示可停止，不中断请求');
  const afterAi = await page.evaluate(async () => {
    const session = getActiveSession(getChar().id), first = session.msgs[0], before = session.msgs.length;
    activeCompletionPresetRaw = () => ({prompt_order: [{character_id: 100000, xiaobai_ext: {scheduledTasks: [
      {id: 'after-ai-cut', name: 'after-ai-cut', triggerTiming: 'after_ai', interval: 1, commands: '/cut 0'}
    ]}}]});
    D.settings.presetEmbeddedTasksEnabled = true;
    (presetTaskRuntime || initPresetTaskRuntime()).refresh();
    const cut = STSCRIPT_COMMANDS.cut.callback, observed = [];
    STSCRIPT_COMMANDS.cut.callback = function(...args) {
      observed.push({role: session.msgs.at(-1).role, content: session.msgs.at(-1).content});
      return cut.apply(this, args);
    };
    callDeepSeek = async () => ({content: 'normal reply', display: 'normal reply', reasoning: '', usage: null, finishReason: 'stop'});
    const sent = await doSendMessage('trigger after-AI task');
    const task = _generationPostCommitTasks.get(session);
    if (task) await task;
    STSCRIPT_COMMANDS.cut.callback = cut;
    return {sent, removed: !session.msgs.includes(first), delta: session.msgs.length - before,
      reply: session.msgs.at(-1).content, observed};
  });
  assert.deepStrictEqual(afterAi, {sent: true, removed: true, delta: 1, reply: 'normal reply',
    observed: [{role: 'assistant', content: 'normal reply'}]},
    'after_ai preset task must run after a normal generated reply');
  assert.deepStrictEqual(errors, []);
  console.log('generation stop and post-commit tasks passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
