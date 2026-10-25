'use strict';
const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');

const {waitForAppReady} = require('./helpers/app-ready');
(async () => {
  const server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  const browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route('**/compute-model/**', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: '代写结果' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await waitForAppReady(page);
    const result = await page.evaluate(async () => {
      const originalCBS = YeyuRisuCBS;
      let mainCalls = 0;
      window.YeyuRisuCBS = Object.assign({}, originalCBS, {
        evaluate() {
          mainCalls++;
          throw new Error('Display CBS reached main thread');
        },
      });
      const char = { id: 'display-compute', name: 'Compute', extensions: { risuai: {} } };
      const session = createBlankSession('Compute', 'display-compute-session');
      session.greetingChosen = true;
      session.creatorNotesSeen = true;
      D.characters = [char];
      D.currentCharId = char.id;
      D.chats = { [char.id]: { sessions: [session], activeSid: session.id } };

      const timed = { role: 'assistant', seq: 1, content: 'CLOCK {{datetimeformat::x}}' };
      session.msgs = [timed];
      renderChat();
      await _risuCBSDisplayCache.get(timed).promise;
      const firstClock = _risuCBSDisplayCache.get(timed).text;
      await new Promise((resolve) => setTimeout(resolve, 20));
      renderChat();
      await _risuCBSDisplayCache.get(timed).promise;
      const secondClock = _risuCBSDisplayCache.get(timed).text;

      ensureProviderSettings(D.settings);
      Object.assign(activeProviderForSettings(D.settings), {
        apiUrl: `${location.origin}/compute-model/v1`, apiKey: 'synthetic', model: 'synthetic',
      });
      Object.assign(D.settings, { useMemory: false, embeddingEnabled: false, styleAuditEnabled: false, maxContextTokens: 0 });
      const impersonated = await impersonateUser('{{upper::extra}}');

      let displaySaved;
      try {
        char.nickname = 'BEFORE';
        char.extensions.risuai.customScripts = [{ in: '^', out: 'DISPLAY ', type: 'editdisplay' }];
        // A display Lua hook that counts its own runs: each message writes once, in message order.
        char.extensions.risuai.triggerscript = [{
          type: 'manual', comment: 'display counter', conditions: [], effect: [{ type: 'triggerlua', code:
            "listenEdit('editDisplay', function(id, text, meta) local n = tonumber(getChatVar(id, 'displayCount')) + 1 " +
            "setChatVar(id, 'displayCount', tostring(n)) return text .. ' #' .. n end)" }],
        }];
        session.risu = { scriptstate: { $displayCount: '0' } };
        const messages = [{ seq: 2, role: 'assistant', content: '{{char}}' }, { seq: 3, role: 'assistant', content: '{{char}}' }];
        session.msgs = messages;
        const show = () => messages.map((message) => risuDisplayText(message.content, char, session, message, { role: 'assistant' }));
        show();
        await _risuExecutionQueues.get(session);
        await new Promise((resolve) => setTimeout(resolve, 0));
        displaySaved = {
          count: session.risu.scriptstate.$displayCount,
          texts: show(),
          queued: _risuExecutionQueues.has(session),
        };
      } finally {
        char.extensions.risuai.triggerscript = [];
        delete char.nickname;
      }

      session.msgs = [{ seq: 3, role: 'assistant', content: 'render source' }];
      char.extensions.risuai.customScripts = [{ in: '^', out: 'FIRST ', type: 'editdisplay' }];
      renderChat();
      await _risuExecutionQueues.get(session);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const firstScript = _risuDisplayCache.get(session.msgs[0]).text;
      char.extensions.risuai.customScripts[0].out = 'SECOND ';
      renderChat();
      await _risuExecutionQueues.get(session);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const output = {
        firstClock, secondClock, impersonated, input: $('user-input').value, displaySaved,
        firstScript, secondScript: _risuDisplayCache.get(session.msgs[0]).text, mainCalls,
      };
      window.YeyuRisuCBS = originalCBS;
      return output;
    });
    assert.notEqual(result.firstClock, result.secondClock);
    assert.match(result.secondClock, /^CLOCK [0-9]+$/);
    assert.equal(result.impersonated, true);
    assert.equal(result.input, '代写结果');
    assert.deepStrictEqual(result.displaySaved, {
      count: '2', texts: ['DISPLAY BEFORE #1', 'DISPLAY BEFORE #2'], queued: false,
    });
    assert.strictEqual(result.mainCalls, 0, '显示期 CBS 不得在主线程求值');
    assert.equal(result.firstScript, 'FIRST render source');
    assert.equal(result.secondScript, 'SECOND render source');
    assert(requests.some((request) => request.messages.some((row) => row.role === 'system' && row.content === 'EXTRA')));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
