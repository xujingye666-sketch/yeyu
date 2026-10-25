'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {loadPlaywright, listenOnBrowserSafePort, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {createViewportReadingHelpers} = require('./helpers/viewport');

const root = path.resolve(process.env.YEYU_TEST_ROOT || path.resolve(__dirname, '../..'));
const assets = path.join(root, 'app/src/main/assets');
const MARKER = '【阅读位置】';
const FILL = '夜色里走廊的灯还亮着，风从窗缝里挤进来。';
const LONG_REDISPLAY = MARKER + FILL.repeat(60) + '\n[PANEL:1]\n' + FILL.repeat(50);
const CONTINUE_TEXT = '续写从这里接着往下写。' + FILL.repeat(20);

function serve(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/sse') {
    res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
    const body = url.searchParams.get('text') || '';
    let index = 0, closed = false;
    req.on('close', () => { closed = true; });
    const push = () => {
      if (closed) return;
      if (index >= body.length) { res.write('data: [DONE]\n\n'); res.end(); return; }
      const piece = body.slice(index, index + 6);
      index += 6;
      res.write('data: ' + JSON.stringify({choices: [{delta: {content: piece}}]}) + '\n\n');
      setTimeout(push, 4);
    };
    setTimeout(push, 60);
    return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(assets, relative);
  if (!file.startsWith(assets) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  const ext = path.extname(file);
  const type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, {'content-type': type, 'cache-control': 'no-store'});
  res.end(fs.readFileSync(file));
}

(async () => {
  const server = http.createServer(serve);
  await listenOnBrowserSafePort(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    page.setDefaultTimeout(120000);
    const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {appendUrl: true});
    await page.goto(`${origin}/index.html`, {waitUntil: 'load'});
    await waitForAppReady(page);
    await page.evaluate(({originUrl, initialText}) => {
      window.runAutoMemorySummary = async () => null;
      window.startStyleAuditForSession = () => {};
      window.saveData = async () => true;
      window.markStreamDraftsStaleForSession = async () => 0;
      window.prepareVectorRetrievalForPrompt = async () => null;
      window.qrPerformAuto = async () => null;
      D.settings.useMemory = false;
      const provider = activeProviderForSettings(D.settings);
      Object.assign(provider, {apiUrl: originUrl, apiKey: 'test-key', model: 'test-model'});
      const originalFetch = window.fetch.bind(window);
      window.__sseQueue = [];
      window.fetch = async (url, options) => String(url).includes('/chat/completions')
        ? originalFetch(window.__sseQueue.shift()) : originalFetch(url, options);
      window.__probe = () => {
        const state = getChatViewportState();
        return {mode: state.mode, follow: state.follow === true};
      };
      window.__readingMarkerVisible = () => {
        const ct = document.getElementById('chat-messages');
        const walker = document.createTreeWalker(ct, NodeFilter.SHOW_TEXT);
        let node = null, at = -1;
        while ((node = walker.nextNode())) {
          at = String(node.data || '').indexOf('【阅读位置】');
          if (at >= 0) break;
        }
        if (!node || at < 0) return false;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + '【阅读位置】'.length);
        const rect = range.getBoundingClientRect();
        const viewport = ct.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      };
      const char = parseCard({name: '重显示视口卡', first_mes: '开始。'});
      char.id = 'reading-viewport-redisplay';
      char.regexScripts = [{id: 'redisplay', enabled: true, findRegex: '/\\[PANEL:(\\d+)\\]/g',
        replaceString: '<div style="min-height:280px">重显示面板 $1</div>', targetAssistant: true,
        applyDisplay: true, applySend: false, minDepth: 0, maxDepth: 80}];
      const session = createBlankSession('continue', 'viewport-session');
      for (let i = 0; i < 6; i += 1) {
        session.msgs.push({role: i % 2 ? 'assistant' : 'user', content: `铺垫 ${i + 1}：` + '铺垫文字。'.repeat(24), seq: i + 1, time: 1});
      }
      session.msgs.push({role: 'assistant', content: initialText, seq: 7, time: 1});
      session.nextMessageSeq = 8;
      D.characters = [char];
      D.currentCharId = char.id;
      D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
      renderChat();
      updateChatUI();
    }, {originUrl: origin, initialText: LONG_REDISPLAY});
    await page.evaluate(async text => {
      const session = getActiveSession(getChar().id);
      session.msgs[session.msgs.length - 1].content = text;
      await prepareRegexScriptDisplayTexts(getChar(), session.msgs);
      renderChat();
    }, LONG_REDISPLAY);
    const {locateReadingAt, queueSse} = createViewportReadingHelpers(page, origin);
    const placed = await locateReadingAt(MARKER, 180);
    assert.strictEqual(placed.ok, true, JSON.stringify(placed));
    assert.strictEqual(placed.mode, 'reading');
    assert.strictEqual(placed.follow, false);
    await queueSse(CONTINUE_TEXT);
    await page.locator('button[aria-label="继续生成"]').click();
    await page.waitForFunction(() => _generationState !== 'idle'
      && document.querySelector('[data-msg-idx="6"] .stream-active-bubble')?.textContent.includes('续写'));
    assert.strictEqual(await page.evaluate(() => window.__readingMarkerVisible()), true,
      '流式输出期间阅读锚点必须仍在可见区域');
    await page.waitForFunction(() => _generationState === 'idle');
    const result = await page.evaluate(text => {
      const state = getChatViewportState();
      const session = getActiveSession(getChar().id);
      return {mode: state.mode, follow: state.follow === true,
        appended: session.msgs[session.msgs.length - 1].content.includes(text),
        readingAnchorVisible: window.__readingMarkerVisible()};
    }, '续写从这里接着往下写');
    assert.deepStrictEqual(result, {mode: 'reading', follow: false, appended: true, readingAnchorVisible: true},
      '阅读中继续生成不得把用户拉回底部');

    await page.evaluate(() => {
      const ct = document.getElementById('chat-messages');
      ct.scrollTop = ct.scrollHeight;
      adoptChatViewportFollow('test-bottom-send');
    });
    const bottomReply = FILL.repeat(25) + '【底部新正文】' + FILL.repeat(25);
    await queueSse(bottomReply);
    const sent = page.evaluate(() => doSendMessage('从底部发送。'));
    await page.waitForFunction(() => _generationState !== 'idle'
      && document.querySelector('#chat-messages .stream-active-bubble')?.textContent.includes('【底部新正文】'));
    const bottomFollow = await page.evaluate(() => {
      const chat = document.getElementById('chat-messages');
      const newest = chat.querySelector('.stream-active-bubble');
      const walker = document.createTreeWalker(newest.querySelector('.stream-content-slot') || newest, NodeFilter.SHOW_TEXT);
      let node, last;
      while ((node = walker.nextNode())) if (node.textContent.trim()) last = node;
      const range = document.createRange();
      range.setStart(last, last.length - 1);
      range.setEnd(last, last.length);
      const end = range.getBoundingClientRect(), viewport = chat.getBoundingClientRect();
      const state = getChatViewportState();
      return {newestEndVisible: end.bottom > viewport.top && end.top < viewport.bottom,
        mode: state.mode, follow: state.follow === true};
    });
    assert.deepStrictEqual(bottomFollow, {newestEndVisible: true, mode: 'follow', follow: true},
      '停在底部发送后，新回复必须在跟随态正常生成');
    assert.strictEqual(await sent, true, '底部发送必须成功');
    await page.waitForFunction(() => _generationState === 'idle');
    assert.deepStrictEqual(pageErrors, []);
    assert.deepStrictEqual(consoleErrors, []);
    console.log('redisplay reading viewport main path passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
