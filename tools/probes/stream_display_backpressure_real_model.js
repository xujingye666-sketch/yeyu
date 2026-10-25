'use strict';
// Real-provider evidence for the streaming display-transform backlog: one send against the configured
// chat provider with reasoning on, reporting worker pressure, main-thread long tasks and the time from
// the last fragment to idle. Credentials are read from the local file only and never printed; no reply
// text, prompt content or card content leaves this probe.
// node tools/probes/stream_display_backpressure_real_model.js --card <png> --credentials <file> [--cpu-throttle <rate>]
//   [--prompt <text>] [--fake] [--preload <n>] [--preload-timeout <ms>]

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('../tests/source');

const root = path.resolve(__dirname, '../..');
const argument = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const cardPath = argument('--card', '');
const cpuThrottle = Number(argument('--cpu-throttle', '1')) || 1;
const prompt = argument('--prompt', '请用中文写一段至少八百字的连续剧情，保持卡片要求的输出格式。');
const fake = process.argv.includes('--fake');
const credentialFile = argument('--credentials', '');
// Total archived message count the probe session must reach before sending: 1 opening greeting plus
// alternating user/assistant pairs. 0 keeps the original greeting-only session.
const preload = Number(argument('--preload', '0')) || 0;
const preloadTimeout = Number(argument('--preload-timeout', '180000')) || 180000;
assert(Number.isInteger(preload) && preload >= 0, '--preload 必须是非负整数');
assert(cardPath && credentialFile, '用法：--card <角色卡.png> --credentials <测试 API 文件>');

function credentials() {
  const lines = fs.readFileSync(credentialFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    strip = value => String(value || '').replace(/^[^：:]+[：:]\s*/, '').trim(),
    apiKey = (lines.join('\n').match(/sk-[A-Za-z0-9_-]{16,}/) || [])[0],
    result = {apiUrl: strip(lines[0]), apiKey, model: strip(lines[2])};
  assert(result.apiUrl.startsWith('http') && result.apiKey && result.model, '测试 API 文件格式不完整');
  return result;
}

(async () => {
  assert(fs.existsSync(cardPath), `找不到角色卡：${cardPath}`);
  const server = createAssetServer(path.join(root, 'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  const browser = await loadPlaywright().chromium.launch({headless: true, executablePath: resolveEdgeExecutable()});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  page.setDefaultTimeout(600000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String((error && error.message) || error).slice(0, 160)));
  try {
    if (cpuThrottle > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', {rate: cpuThrottle});
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
    await page.waitForFunction(() => typeof D === 'object' && typeof confirmImport === 'function' && typeof doSendMessage === 'function');
    await page.evaluate(() => {
      const fresh = defaults();
      Object.keys(D).forEach(key => delete D[key]);
      Object.assign(D, fresh);
      openModal('import-modal');
      resetImport();
    });
    await page.locator('#file-input').setInputFiles(cardPath);
    await page.waitForFunction(() => !_importProgressActive && pending.length === 1);
    const imported = await page.evaluate(async config => {
      const expected = canonicalCharacterName(pending[0]);
      const originalConfirm = appConfirm;
      appConfirm = async () => true;
      try {
        setPendingImportMode(0, 'direct');
        setPendingComponentMode(0, 'full');
        await confirmImport();
      } finally {
        appConfirm = originalConfirm;
      }
      const char = D.characters.slice().reverse().find(row => canonicalCharacterName(row) === expected);
      if (!char) throw new Error('角色卡导入后未找到');
      ensureProviderSettings(D.settings);
      const provider = activeProviderForSettings(D.settings);
      Object.assign(provider, {name: '流式积压取证', apiUrl: config.apiUrl, apiKey: config.apiKey, model: config.model, promptPostProcessing: 'none'});
      D.settings.activeProviderId = provider.id;
      D.settings.useMemory = false;
      D.settings.embeddingEnabled = false;
      D.settings.styleAuditEnabled = false;
      D.settings.showThinking = true;
      D.settings.reasoningEffort = 'high';
      D.settings.maxContextTokens = 0;
      D.settings.maxTokens = 0;
      // The card needs every resident entry in the request; a budget would drop the ones that ask for
      // the card's own output tags and change what the stream has to transform.
      D.worldBook.token_budget = 0;
      D.worldBook.budget_percent = 0;
      const session = createBlankSession('流式积压取证', 'stream-backpressure-probe-session');
      const greeting = getGreetings(char).find(Boolean) || '';
      session.greetingChosen = true;
      if (greeting) appendOpeningGreeting(char, session, greeting, 0);
      // Synthetic history uses the same normalized shape saveMsg writes; the assistant side repeats the
      // card's own greeting so every assistant row drives the real display regex and card frontend.
      if (config.preload > session.msgs.length) {
        if (!greeting) throw new Error('预载需要该卡的首个非空开场白');
        while (session.msgs.length < config.preload) {
          const role = session.msgs.length % 2 ? 'user' : 'assistant';
          session.msgs.push({
            role,
            content: role === 'user' ? '请继续。' : greeting,
            time: Date.now(),
            seq: allocateMessageSeq(session),
          });
        }
        ensureMessageSequences(session);
      }
      D.currentCharId = char.id;
      D.chats[char.id] = {sessions: [session], activeSid: session.id};
      document.querySelectorAll('.modal-overlay.open').forEach(node => node.classList.remove('open'));
      await saveData(['meta', 'characters', 'sessions', 'worldbook'], {urgent: true});
      await prepareRegexScriptDisplayTexts(char, session.msgs);
      // Without the chat page laid out the message iframes stay 0×0 and never report a height, so the
      // card frontends would cost nothing — the opposite of what a real send pays for.
      switchAppPage('chat');
      updateChatUI();
      renderChat();
      const chatHost = document.getElementById('chat-messages');
      const bottomGapAfterRender = chatHost ? Math.round(chatHost.scrollHeight - chatHost.clientHeight - chatHost.scrollTop) : null;
      // Every product path that opens a chat follows renderChat() with this; without it the probe
      // would send from the top of the log instead of from where a reader actually sends.
      scrollChatToBottomAfterRender();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const live = typeof syncCardScriptLibrary === 'function' ? syncCardScriptLibrary(char) : null;
      if (live && typeof cardScriptLibraryAwaitReady === 'function') await cardScriptLibraryAwaitReady(live);
      // The preloaded session must reach its own idle before the send is timed, otherwise the send
      // measurement absorbs the backlog of mounting the preloaded history.
      // A frame is ready once it has parsed its document and reported a real height. Waiting for
      // readyState 'complete' would wait for the images inside the card, which this probe never counts.
      // Card slots mount on demand, so a slot without a frame is not a pending slot: readiness asks
      // that the mount scheduler has nothing left to do and that every frame it mounted reported a
      // real height. Code without lazy mounting has no scheduler and only the frame terms apply.
      const frameState = () => {
        const rows = [..._cardFrontendLive.values()].filter(row => row.frame && row.frame.isConnected);
        const readyState = row => (row.frame.contentDocument || {}).readyState || 'loading';
        const lazyMount = typeof _cardFrontendMountingKey !== 'undefined';
        return {
          connected: rows.length,
          heightPending: rows.filter(row => !row.heightReady).length,
          documentPending: rows.filter(row => readyState(row) === 'loading').length,
          documentIncomplete: rows.filter(row => readyState(row) !== 'complete').length,
          schedulerBusy: lazyMount && !!((_cardFrontendMountingKey && _cardFrontendLive.has(_cardFrontendMountingKey)) ||
            _cardFrontendScheduleQueued || _cardFrontendScrolling),
        };
      };
      const idleStartedAt = performance.now();
      const idleDeadline = idleStartedAt + config.preloadTimeout;
      let stable = 0;
      while (stable < 2 && performance.now() < idleDeadline) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const frames = frameState();
        const libraryReady = !_cardScriptLibraryLive || _cardScriptLibraryLive.state === 'ready';
        stable = !_cardScriptTextPending.size && !frames.heightPending && !frames.documentPending &&
          !frames.schedulerBusy && libraryReady ? stable + 1 : 0;
      }
      const host = document.getElementById('chat-messages');
      return {
        name: canonicalCharacterName(char).length,
        displayScripts: regexTransformOps(char, 'assistant', 'display', 0).length,
        replacementChars: regexTransformOps(char, 'assistant', 'display', 0).reduce((sum, op) => sum + String(op.replaceString || '').length, 0),
        worldEntries: getAllWBEntries(char.id).length,
        preloadedMessages: session.msgs.length,
        preloadIdleMs: Math.round(performance.now() - idleStartedAt),
        preloadIdleTimedOut: stable < 2,
        preloadIdleState: {...frameState(), pendingTransforms: _cardScriptTextPending.size,
          libraryState: _cardScriptLibraryLive ? String(_cardScriptLibraryLive.state || '') : 'none'},
        pendingTransformsBeforeSend: _cardScriptTextPending.size,
        bottomGapAfterRender,
        bottomGapBeforeSend: host ? Math.round(host.scrollHeight - host.clientHeight - host.scrollTop) : null,
        domMessagesBeforeSend: host ? host.querySelectorAll('[data-msg-idx]').length : -1,
        cardIframesBeforeSend: document.querySelectorAll('.yeyu-card-frontend iframe').length,
        cardPlaceholdersBeforeSend: document.querySelectorAll('.yeyu-card-frontend[data-frontend-key]').length,
      };
    }, {...credentials(), preload, preloadTimeout});

    // Debugging the probe itself must not spend real requests: --fake replays a deepseek-shaped local
    // SSE (1–11 events per read, ~13 ms apart, one or two characters per delta, reasoning first).
    if (fake)
      await page.evaluate(() => {
        callDeepSeek = async function (messages, target, options) {
          const encoder = new TextEncoder();
          const fragments = (source, carrier) => {
            const rows = [];
            for (let index = 0; index < source.length; index += 2)
              rows.push(JSON.stringify({choices: [{delta: {[carrier]: source.slice(index, index + 2)}}]}));
            return rows;
          };
          const events = fragments('推理过程逐字展开。'.repeat(80), 'reasoning_content')
            .concat(fragments('夜色落在长街尽头，远处的灯火像一行未写完的字。'.repeat(120), 'content'));
          const sizes = [1, 3, 11, 2, 7, 5, 1, 9, 4, 2];
          const response = new Response(new ReadableStream({start(controller) {
            let index = 0, group = 0;
            const push = () => {
              if (index >= events.length) {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n'));
                return controller.close();
              }
              let payload = '';
              for (let taken = 0, size = sizes[group++ % sizes.length]; taken < size && index < events.length; taken++)
                payload += 'data: ' + events[index++] + '\n\n';
              controller.enqueue(encoder.encode(payload));
              setTimeout(push, 13);
            };
            push();
          }}), {headers: {'content-type': 'text/event-stream'}});
          return streamResponse(response, target, options);
        };
      });

    const measured = await page.evaluate(async text => {
      const probe = {
        workerCalls: 0, inFlight: 0, maxInFlight: 0, repaints: 0, hydrations: 0, longTasks: [],
        streamStartAt: 0, streamEndAt: 0, commitPrepareMs: 0, transportDoneAt: 0,
      };
      window.__streamProbe = probe;
      new PerformanceObserver(list => list.getEntries().forEach(entry => probe.longTasks.push(Math.round(entry.duration))))
        .observe({entryTypes: ['longtask']});
      const originalCall = callScriptWorker;
      callScriptWorker = function () {
        probe.workerCalls++;
        probe.inFlight++;
        if (probe.inFlight > probe.maxInFlight) probe.maxInFlight = probe.inFlight;
        const task = originalCall.apply(this, arguments);
        const settle = () => { probe.inFlight--; };
        task.then(settle, settle);
        return task;
      };
      const originalStructured = assistantStructuredDisplayHtml;
      assistantStructuredDisplayHtml = function (value, owner, message, displayOptions) {
        if (displayOptions && displayOptions.streamPreview === true) {
          probe.repaints++;
          if (!probe.streamStartAt) probe.streamStartAt = performance.now();
          probe.streamEndAt = performance.now();
        }
        return originalStructured.apply(this, arguments);
      };
      const originalHydrate = hydrateReferencedCardAssets;
      hydrateReferencedCardAssets = function (owner, texts) {
        if (Array.isArray(texts) && texts.some(row => row && row.streamPreview === true)) probe.hydrations++;
        return originalHydrate.apply(this, arguments);
      };
      const originalPrepare = prepareRegexScriptTexts;
      prepareRegexScriptTexts = async function (owner, entries) {
        const display = Array.isArray(entries) && entries.some(row => row && (row.phase || 'send') === 'display');
        const startedAt = performance.now();
        try {
          return await originalPrepare.apply(this, arguments);
        } finally {
          if (display && probe.streamEndAt && !probe.commitPrepareMs)
            probe.commitPrepareMs = Math.round(performance.now() - startedAt);
        }
      };
      const startedAt = performance.now();
      const outcome = await doSendMessage(text).then(() => 'done', error => String((error && error.message) || error).slice(0, 120));
      probe.transportDoneAt = performance.now();
      const deadline = performance.now() + 300000;
      while (performance.now() < deadline && (_generationState !== 'idle' || _cardScriptTextPending.size))
        await new Promise(resolve => setTimeout(resolve, 50));
      const char = getChar();
      const session = getActiveSession(char.id);
      const reply = session.msgs[session.msgs.length - 1];
      const metrics = (reply && reply.worldBookMetrics) || null;
      const longTasks = probe.longTasks.slice().sort((a, b) => b - a);
      return {
        outcome,
        state: _generationState,
        totalMs: Math.round(performance.now() - startedAt),
        streamingMs: probe.streamStartAt ? Math.round(probe.streamEndAt - probe.streamStartAt) : 0,
        streamEndToIdleMs: probe.streamEndAt ? Math.round(performance.now() - probe.streamEndAt) : -1,
        commitPrepareMs: probe.commitPrepareMs,
        workerCalls: probe.workerCalls,
        maxInFlight: probe.maxInFlight,
        repaints: probe.repaints,
        hydrations: probe.hydrations,
        longTaskCount: longTasks.length,
        longestTaskMs: longTasks[0] || 0,
        longTasksTop5: longTasks.slice(0, 5),
        replyChars: reply && reply.role === 'assistant' ? String(reply.content || '').length : 0,
        reasoningChars: reply && reply.role === 'assistant' ? String(reply.reasoning || '').length : 0,
        worldBookDropped: metrics ? Number(metrics.budgetDropped || metrics['budget-dropped'] || 0) : -1,
        pendingTransforms: _cardScriptTextPending.size,
        streamLanes: typeof _cardScriptStreamTransforms === 'undefined' ? -1 : _cardScriptStreamTransforms.size,
        archivedMessages: session.msgs.length,
        domMessagesAfterIdle: document.querySelectorAll('#chat-messages [data-msg-idx]').length,
        cardIframesAfterIdle: document.querySelectorAll('.yeyu-card-frontend iframe').length,
        cardPlaceholdersAfterIdle: document.querySelectorAll('.yeyu-card-frontend[data-frontend-key]').length,
      };
    }, prompt);

    console.log(JSON.stringify({
      stage: 'stream-display-backpressure-real-model',
      privacy: 'counts-and-durations-only; no reply text, prompt text or credentials',
      cpuThrottle, preload, preloadTimeout, fake, card: path.basename(cardPath), imported, measured, pageErrors,
    }));
  } finally {
    await page.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(JSON.stringify({stage: 'stream-display-backpressure-real-model', failed: true,
    errorType: String((error && error.name) || 'Error'), checkpoint: String((error && error.message) || '').replace(/[\r\n].*$/s, '').slice(0, 200)}));
  process.exit(1);
});
