'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  const baseline = await page.evaluate(async () => {
    function snapshot(value) { return JSON.parse(JSON.stringify(value)); }
    async function waitFor(predicate, message) {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(message);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    function configure(label, messages) {
      D = defaults();
      D.settings.useMemory = false;
      D.settings.embeddingEnabled = false;
      D.settings.styleAuditEnabled = false;
      D.settings.maxContextTokens = 0;
      D.settings.maxTokens = 0;
      const char = {
        id: `st-generation-${label}`,
        name: `ST ${label}`,
        description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
        scriptsEnabled: true,
        regexScripts: [],
        extensions: {}
      };
      const session = createBlankSession(label, `st-generation-session-${label}`);
      session.msgs = messages || [
        {role: 'user', content: 'existing user', time: 1, seq: 1},
        {role: 'assistant', content: 'existing answer', swipes: ['existing answer'], swipeId: 0, time: 2, seq: 2}
      ];
      session.nextMessageSeq = Math.max(1, ...session.msgs.map(row => Number(row.seq) + 1 || 1));
      D.characters = [char];
      D.currentCharId = char.id;
      D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
      return {char, session};
    }
    async function persistSetup(char) {
      await saveData(['meta', 'characters', 'sessions'], {urgent: true});
      renderChat();
      return char;
    }
    async function persistedSession(char, session) {
      const box = (await YeyuRepository.load()).data.chats[char.id];
      return box.sessions.find(row => row.id === session.id);
    }
    async function invoke(mode, session, content) {
      let result;
      if (mode === 'new') result = await doSendMessage(content || 'new user');
      else if (mode === 'continue') result = await continueGeneration();
      else if (mode === 'regenerate') result = await regenerateLast();
      else result = await generateMessageSwipe(session.msgs.length - 1);
      // UI completion precedes card listeners; inspect their writes only after the
      // corresponding background lifecycle and its single scheduled repaint complete.
      await _generationPostCommitTasks.get(session);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return result;
    }
    async function run(mode) {
      const {char, session} = configure(`helper-${mode}`);
      await persistSetup(char);

      const observer = {};
      let outputRuns = 0;
      cardFrontendRegisterEvent(observer, CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_ENDED, async () => { outputRuns++; session.macroVars = {helper_runs: String(outputRuns)}; await saveData('sessions', {urgent: true}); });
      const originalTransport = callDeepSeek;
      let modelCalls = 0;
      callDeepSeek = async function() {
        modelCalls++;
        return {content: `model ${mode} ${modelCalls}`, display: `model ${mode} ${modelCalls}`, reasoning: '', usage: null, finishReason: 'stop'};
      };
      let returned;
      try {
        returned = await invoke(mode, session);
      } finally {
        callDeepSeek = originalTransport;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      await waitFor(() => outputRuns === 1, 'helper generation event did not finish');
      await saveData('sessions', {urgent: true});
      cardFrontendClearOwnerRegistrations(observer);
      const live = getActiveSession(char.id);
      const stored = await persistedSession(char, session);
      return {
        mode,
        returned,
        modelCalls,
        outputRuns: String(outputRuns),
        messages: snapshot(live.msgs),
        persistedMessages: snapshot(stored.msgs),
        persistedState: snapshot(stored.macroVars || {})
      };
    }

    async function runHelperMutation(removeReply) {
      const {char, session} = configure(removeReply ? 'helper-delete' : 'helper-modify');
      await persistSetup(char);
      const observer = {}, lifecycle = [];
      cardFrontendRegisterEvent(observer, CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_STARTED, () => {
        session.msgs[0].content = 'helper input mutation';
      });
      cardFrontendRegisterEvent(observer, CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_ENDED, async index => {
        lifecycle.push(index);
        if (removeReply) session.msgs.splice(index - 1, 1);
        else { session.msgs[0].content = 'helper output mutation'; session.msgs.splice(1, 1); }
        await saveData('sessions', {urgent: true});
        renderChat();
      });
      const originalTransport = callDeepSeek;
      let outbound;
      callDeepSeek = async messages => { outbound = snapshot(messages); return {content:'helper reply',display:'helper reply',reasoning:'',usage:null,finishReason:'stop'}; };
      let returned;
      try { returned = await invoke('new', session, 'mutation user'); }
      finally { callDeepSeek = originalTransport; }
      await waitFor(() => lifecycle.length === 1, 'helper mutation event did not finish');
      await saveData('sessions', {urgent:true});
      cardFrontendClearOwnerRegistrations(observer);
      return {returned,lifecycle,outboundHasMutation:outbound.some(row=>String(row.content||'').includes('helper input mutation')),messages:snapshot(session.msgs),persisted:snapshot(await persistedSession(char,session))};
    }

    async function runNestedPromptGeneration() {
      const {char, session} = configure('nested-prompt');
      await persistSetup(char);
      const observer = {}, trace = [];
      let nesting = false, modelCalls = 0, outbound;
      const originalTransport = callDeepSeek;
      callDeepSeek = async messages => {
        modelCalls++;
        trace.push(nesting ? 'helper transport' : 'main transport');
        if (!nesting) outbound = snapshot(messages);
        return {content:`nested reply ${modelCalls}`,display:`nested reply ${modelCalls}`,reasoning:'',usage:null,finishReason:'stop'};
      };
      function register(event, label) {
        cardFrontendRegisterEvent(observer, event, async payload => {
          if (nesting) return;
          trace.push(label);
          nesting = true;
          try {
            const reply = await executeCardFrontendGeneration(
              {ordered_prompts:[{role:'user',content:`helper ${label}`}],should_stream:false,should_silence:true},
              {charId:char.id,owner:{charId:char.id,sessionId:session.id}}, true
            );
            (payload.chat || payload.prompt).push({role:'system',content:`${label}: ${reply}`});
          } finally { nesting = false; }
          trace.push(`${label} completed`);
        });
      }
      register(CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_COMPLETION_PROMPT_READY, 'prompt ready');
      register(CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATE_AFTER_DATA, 'after data');
      let timer;
      try {
        const returned = await Promise.race([
          invoke('new', session, 'nested callback user'),
          new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('nested helper generation kept the prompt assembly locked')), 5000);})
        ]);
        return {returned,modelCalls,trace,outbound};
      } finally {
        clearTimeout(timer);
        cardFrontendClearOwnerRegistrations(observer);
        callDeepSeek = originalTransport;
      }
    }

    const rows = [];
    for (const mode of ['new', 'continue', 'regenerate', 'swipe']) rows.push(await run(mode));
    return {
      rows,
      modified: await runHelperMutation(false),
      deleted: await runHelperMutation(true),
      nested: await runNestedPromptGeneration()
    };
  });

  assert.deepStrictEqual(pageErrors, []);
  for (const row of baseline.rows) {
    assert.strictEqual(row.returned, true, `${row.mode}: real generation entry must finish successfully with a TavernHelper lifecycle listener`);
    assert.strictEqual(row.modelCalls, 1, `${row.mode}: transport must run exactly once`);
    assert.strictEqual(row.outputRuns, '1', `${row.mode}: helper lifecycle must finish once`);
    assert.deepStrictEqual(row.persistedMessages, row.messages, `${row.mode}: browser IndexedDB must contain the committed chat`);
    assert.strictEqual(row.persistedState.helper_runs, '1', `${row.mode}: output variables must persist`);
  }
  assert.ok(baseline.rows[0].messages.some(row => row.role === 'assistant' && row.content === 'model new 1'), 'new: reply must commit');
  assert.ok(baseline.rows[1].messages.at(-1).content.includes('model continue 1'), 'continue: continuation must commit');
  assert.strictEqual(baseline.rows[2].messages.at(-1).content, 'model regenerate 1', 'regenerate: replacement must commit');
  assert.strictEqual(baseline.rows[3].messages.at(-1).content, 'model swipe 1', 'swipe: selected candidate must commit');
  assert.ok(baseline.rows[3].messages.at(-1).swipes.includes('existing answer'), 'swipe: prior candidate must remain');

  for (const row of [baseline.modified, baseline.deleted]) {
    assert.strictEqual(row.returned, true, 'helper message mutation must finish generation');
    assert.strictEqual(row.outboundHasMutation, true, 'helper input mutation must enter the model context');
    assert.deepStrictEqual(row.lifecycle, [4], 'helper completion event reports the chat length, as ST does');
    assert.deepStrictEqual(row.persisted.msgs, row.messages, 'helper message changes must persist');
  }
  assert.strictEqual(baseline.modified.messages[0].content, 'helper output mutation');
  assert.strictEqual(baseline.modified.messages.at(-1).content, 'helper reply');
  assert.strictEqual(baseline.modified.messages.length, 3, 'helper may remove an earlier message');
  assert.strictEqual(baseline.deleted.messages.some(row => row.content === 'helper reply'), false, 'helper may delete the committed reply');

  assert.strictEqual(baseline.nested.returned, true, 'prompt callbacks may await helper generation before the main request');
  assert.strictEqual(baseline.nested.modelCalls, 3, 'each callback helper and the main request must finish once');
  assert.deepStrictEqual(baseline.nested.trace, ['prompt ready','helper transport','prompt ready completed','after data','helper transport','after data completed','main transport'], 'nested generation must preserve prompt-ready, after-data, and transport order');
  for (const marker of ['prompt ready: nested reply 1', 'after data: nested reply 2'])
    assert.ok(baseline.nested.outbound.some(row => row.content === marker), 'callback changes must survive finalization and enter the main request');

  console.log('ST generation integration: PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
