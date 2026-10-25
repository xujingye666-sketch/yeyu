'use strict';

const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('../source');
const {waitForAppReady} = require('./app-ready');
const {pageAssertSource} = require('./page-assert');

const assets = path.resolve(__dirname, '../../../app/src/main/assets');

// In-page helpers for tests that drive streamResponse over real Response bodies. Only the byte stream (and
// navigator.onLine) is replaced; the library, drafts, display and commit layers are the app's own.
//   body(steps, type)  a streaming Response delivering bytes, {delay: ms}, a function to run, or an Error that
//                breaks the stream; the provider points at a placeholder API
//   chunk(text)  one SSE content delta;  sse(value)  one SSE data event
//   reset({visible})  a fresh library with character c1 and session s1 ending in the user message "请继续"
//                     (seq 1); visible puts the conversation on screen, otherwise another character is current
const streamHarness = `
  const encoder = new TextEncoder();
  const sse = value => encoder.encode('data: ' + JSON.stringify(value) + '\\n\\n');
  const done = encoder.encode('data: [DONE]\\n\\n');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const body = (steps, type = 'text/event-stream') => {
    let index = 0;
    return new Response(new ReadableStream({
      async pull(controller) {
        // A pull that enqueues nothing is not repeated, so non-byte steps run until the next bytes or the end.
        for (;;) {
          const step = steps[index++];
          if (step === undefined) return controller.close();
          if (step instanceof Error) return controller.error(step);
          if (typeof step === 'function') step();
          else if (step.delay) await wait(step.delay);
          else return controller.enqueue(step);
        }
      },
    }), {headers: {'content-type': type}});
  };
  const chunk = text => sse({choices: [{delta: {content: text}}]});
  const storedDrafts = async () => (await YeyuRepository.loadStreamDrafts(sanitizeStoredStreamDraft)).drafts;
  const failure = work => work().then(() => null, error => error);
  const setOnline = online => Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => online});
  const reset = async (options = {}) => {
    for (const draft of await storedDrafts()) await YeyuRepository.deleteStreamDraft(draft.draftId);
    D = defaults();
    Object.assign(D.settings.providers[0], {apiUrl: 'https://api.example.test/v1', apiKey: 'key', model: 'test-model'});
    const char = parseCard({spec: 'chara_card_v2', spec_version: '2.0', data: {name: '草稿角色', description: '守夜人。', first_mes: ''}});
    char.id = 'c1';
    const session = createBlankSession('草稿', 's1');
    session.msgs = [{role: 'user', seq: 1, content: '请继续', time: 1700000000000}];
    session.nextMessageSeq = 2;
    D.characters = [char];
    D.currentCharId = options.visible ? 'c1' : 'other';
    D.chats = {c1: {activeSid: 's1', sessions: [session]}};
    _streamDrafts = [];
    _activeStreamDraft = null;
    _streamDraftProtectionWarning = '';
    _streamDraftStopFailure = '';
    abortController = null;
    _transientRequestControllers.clear();
    setOnline(true);
    if (options.visible) renderChat();
    setGenerationState('streaming');
    return {char, session, target: {charId: 'c1', sessionId: 's1', mode: 'new'}};
  };
`;

// Opens the app in a fresh mobile page with the in-page assert installed and the app ready.
async function openStreamPage() {
  const server = createAssetServer(assets);
  let browser, page;
  const close = async () => {
    if (browser) await browser.close().catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  try {
    const port = await listenOnBrowserSafePort(server);
    browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
    page = await browser.newPage();
    await page.addInitScript(pageAssertSource);
    await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'load'});
    await waitForAppReady(page);
  } catch (error) {
    await close();
    throw error;
  }
  // Runs one named scenario in the page; a failure or a hang past 30 s carries the scenario name.
  const scenario = async (name, code) => {
    let timer;
    try {
      await Promise.race([
        page.evaluate(`(async () => {\n${streamHarness}\n${code}\n})()`),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('场景超过 30 秒未结束')), 30000); }),
      ]);
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  return {page, scenario, close};
}

// Runs a test body against a freshly opened page and always closes it; a failure sets the exit code.
function runStreamPage(body) {
  let opened;
  return (async () => {
    opened = await openStreamPage();
    await body(opened.scenario);
  })().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }).finally(async () => {
    if (opened) await opened.close();
  });
}

module.exports = {openStreamPage, runStreamPage};
