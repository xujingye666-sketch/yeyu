'use strict';
const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');

const {waitForAppReady} = require('./helpers/app-ready');
let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 450, height: 974 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: 'Risu 临时变量', first_mes: '', extensions: { risuai: { customScripts: [], triggerscript: [] } },
  } };
  await page.evaluate(() => { openModal('import-modal'); resetImport(); });
  await page.locator('#file-input').setInputFiles({
    name: 'Risu transient.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(card)),
  });
  await page.waitForFunction(() => pending.length === 1 && !_importProgressActive);
  await page.evaluate(() => { setPendingImportMode(0, 'direct'); appConfirm = async () => true; });
  await page.locator('#import-preview button.primary').click();
  await page.waitForFunction(() => D.characters.length === 1);

  // Use the page's real transaction, variable callbacks, CBS and Trigger engine.
  // Expected values follow v2026.10.211 triggers.ts getVar precedence, not a test host.
  const matrix = await page.evaluate(async () => {
    const char = D.characters[0];
    D.currentCharId = char.id;
    const session = getActiveSession(char.id);
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    const effect = (type, fields = {}) => ({ type, indent: 0, ...fields });
    const cases = [
      { name: 'temporary', expected: 'ORIGINAL' },
      { name: 'persistent', persistent: 'PERSISTENT', fallback: 'DEFAULT', expected: 'PERSISTENT' },
      { name: 'literal-null', persistent: 'null', fallback: 'DEFAULT', expected: 'null' },
      { name: 'persistent-empty', persistent: '', fallback: 'DEFAULT', expected: '' },
      { name: 'default', fallback: 'DEFAULT', expected: 'DEFAULT' },
      { name: 'default-null', fallback: 'null', expected: 'null' },
      { name: 'js-null', persistent: null, fallback: 'DEFAULT', expected: 'DEFAULT' },
      { name: 'local', persistent: 'PERSISTENT', fallback: 'DEFAULT', local: 'LOCAL', expected: 'LOCAL' },
      { name: 'local-empty', persistent: 'PERSISTENT', fallback: 'DEFAULT', local: '', expected: '' },
      { name: 'local-null', persistent: 'PERSISTENT', local: 'null', expected: 'null' },
      { name: 'missing', write: false, expected: 'null' },
      { name: 'condition-transform', transform: true, expected: 'original|derived' },
    ];
    function flow(mode, item) {
      const read = mode === 'display'
        ? effect('v2GetDisplayState', { outputVar: 'scratch' })
        : effect('v2GetRequestState', { index: '0', indexType: 'value', outputVar: 'scratch' });
      const write = variable => mode === 'display'
        ? effect('v2SetDisplayState', { value: variable, valueType: 'var' })
        : effect('v2SetRequestState', { index: '0', indexType: 'value', value: variable, valueType: 'var' });
      const effects = item.write === false ? [] : [read];
      if ('local' in item) effects.push(effect('v2DeclareLocalVar', { var: 'scratch', value: item.local, valueType: 'value' }));
      effects.push(write('scratch'));
      if (item.transform) effects.push(
        effect('v2If', { source: 'scratch', target: 'ORIGINAL', targetType: 'value', condition: '=' }),
        effect('v2ToLowerCase', { indent: 1, source: 'scratch', sourceType: 'var', outputVar: 'lowered' }),
        effect('v2ConcatString', { indent: 1, source1: 'lowered', source1Type: 'var', source2: '|derived', source2Type: 'value', outputVar: 'derived' }),
        { ...write('derived'), indent: 1 }, effect('v2EndIndent', { indent: 1 }),
      );
      return { type: mode, comment: item.name, conditions: [], effect: effects };
    }
    async function run(mode, activeSession, item) {
      const source = risuCardSources(char).card;
      source.defaultVariables = 'fallback' in item ? `scratch=${item.fallback}` : '';
      source.triggerscript = [flow(mode, item)];
      activeSession.risu = { scriptstate: 'persistent' in item ? { $scratch: item.persistent } : {} };
      const before = JSON.stringify(activeSession.risu);
      const result = await risuWithExecution(char, activeSession, { readOnly: mode === 'display' }, context =>
        risuRunTriggerContext(context, mode, mode === 'display'
          ? { displayState: 'ORIGINAL' }
          : { requestState: [{ role: 'user', content: 'ORIGINAL' }] }));
      return {
        mode, name: item.name, expected: item.expected,
        actual: mode === 'display' ? result.displayState : result.requestState[0].content,
        unchanged: before === JSON.stringify(activeSession.risu),
      };
    }
    const rows = [];
    for (const mode of ['display', 'request']) {
      for (const item of cases) rows.push(await run(mode, session, item));
      // No temp write in a later invocation must still read the missing sentinel.
      rows.push(await run(mode, session, { name: 'next-invocation', write: false, expected: 'null' }));
    }
    const other = createBlankSession('另一会话');
    other.greetingChosen = true;
    other.creatorNotesSeen = true;
    const box = getSessions(char.id);
    box.sessions.push(other);
    box.activeSid = other.id;
    for (const mode of ['display', 'request'])
      rows.push(await run(mode, other, { name: 'other-session', write: false, expected: 'null' }));
    box.activeSid = session.id;
    await saveData(['meta', 'characters', 'sessions'], { urgent: true });
    const stored = (await YeyuRepository.load()).data.chats[char.id].sessions;
    return { rows, storedStates: stored.map(row => row.risu.scriptstate) };
  });
  for (const row of matrix.rows) {
    assert.strictEqual(row.actual, row.expected, `${row.mode}/${row.name}`);
    assert.strictEqual(row.unchanged, true, `${row.mode}/${row.name} must not persist temp variables`);
  }
  assert.deepStrictEqual(matrix.storedStates, [{}, {}]);

  // End-to-end: request state -> temp -> condition -> conversion -> final provider
  // request, and response state -> temp -> conversion -> final chat DOM and reload.
  await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id);
    const effect = (type, fields = {}) => ({ type, indent: 0, ...fields });
    const flows = ['display', 'request'].map(mode => {
      const isDisplay = mode === 'display';
      const indent = isDisplay ? 0 : 1;
      const index = { index: 'requestIndex', indexType: 'var' };
      const write = value => effect(isDisplay ? 'v2SetDisplayState' : 'v2SetRequestState', { indent, ...(!isDisplay && index), value, valueType: 'var' });
      return { type: mode, comment: 'roundtrip and transform', conditions: [], effect: [
        ...(!isDisplay ? [
          effect('v2GetRequestStateLength', { outputVar: 'requestLength' }),
          effect('v2SetVar', { var: 'requestIndex', operator: '=', value: '0', valueType: 'value' }),
          effect('v2LoopNTimes', { value: 'requestLength', valueType: 'var' }),
        ] : []),
        effect(isDisplay ? 'v2GetDisplayState' : 'v2GetRequestState', { indent, ...(!isDisplay && index), outputVar: 'scratch' }),
        write('scratch'),
        effect('v2If', { indent, source: 'scratch', target: isDisplay ? 'VISIBLE_ORIGINAL' : 'REQUEST_ORIGINAL', targetType: 'value', condition: '=' }),
        effect('v2ToLowerCase', { indent: indent + 1, source: 'scratch', sourceType: 'var', outputVar: 'lowered' }),
        effect('v2ConcatString', { indent: indent + 1, source1: 'lowered', source1Type: 'var', source2: '|derived', source2Type: 'value', outputVar: 'derived' }),
        { ...write('derived'), indent: indent + 1 }, effect('v2EndIndent', { indent: indent + 1 }),
        ...(!isDisplay ? [
          effect('v2SetVar', { indent: 1, var: 'requestIndex', operator: '+=', value: '1', valueType: 'value' }),
          effect('v2EndIndent', { indent: 1, endOfLoop: true }),
        ] : []),
      ] };
    });
    Object.assign(risuCardSources(char).card, { defaultVariables: '', triggerscript: flows });
    session.risu = { scriptstate: {} };
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), { apiUrl: location.origin + '/transient/v1', apiKey: 'synthetic-local', model: 'synthetic', reasoningEffort: 'off' });
    Object.assign(D.settings, { useMemory: false, embeddingEnabled: false, styleAuditEnabled: false, maxContextTokens: 0 });
    await saveData(['meta', 'characters', 'sessions'], { urgent: true });
    switchAppPage('chat'); updateChatUI(); renderChat();
  });
  const requests = [];
  await page.route('**/transient/**', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'VISIBLE_ORIGINAL' }, finish_reason: null }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n' });
  });
  await page.locator('#user-input').fill('REQUEST_ORIGINAL');
  await page.locator('#composer-action-btn').click();
  await page.waitForFunction(() => _generationState === 'idle' && getMsgs(getChar().id).length === 2 && _risuExecutionQueues.size === 0);
  assert.strictEqual(requests.length, 1);
  assert.deepStrictEqual(requests[0].messages.filter(row => row.content === 'request_original|derived').map(row => row.role), ['user']);
  assert(!requests[0].messages.some(row => row.content === 'REQUEST_ORIGINAL'));
  assert((await page.locator('#chat-messages').innerText()).includes('visible_original|derived'));
  const stored = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id);
    const data = (await YeyuRepository.load()).data.chats[char.id].sessions.find(row => row.id === session.id);
    return { messages: data.msgs.map(row => row.content), vars: data.risu.scriptstate };
  });
  assert.deepStrictEqual(stored, { messages: ['REQUEST_ORIGINAL', 'VISIBLE_ORIGINAL'], vars: {} });
  await page.reload();
  await waitForAppReady(page);
  await page.evaluate(() => { switchAppPage('chat'); updateChatUI(); renderChat(); });
  await page.waitForFunction(() => document.querySelector('#chat-messages').textContent.includes('visible_original|derived') && _risuExecutionQueues.size === 0);
  assert.deepStrictEqual(await page.evaluate(() => getActiveSession(getChar().id).risu.scriptstate), {});
  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({ hostCases: matrix.rows.length, displayRequestRoundtrip: true, precedenceAndLiteralNull: true,
    conditionAndConversion: true, noPersistenceOrSessionLeak: true, sendButtonAndFinalRequest: true, displayAndReload: true,
    provider: 'local synthetic SSE', browser: 'Edge', viewport: '450x974' }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
