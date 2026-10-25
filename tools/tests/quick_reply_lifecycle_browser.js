'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {waitForAppReady} = require('./helpers/app-ready');
const {pageAssertSource} = require('./helpers/page-assert');

const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  const port = await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  await context.route('https://testingcf.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: route.request().resourceType() === 'stylesheet' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
    body: route.request().url().includes('showdown') ? 'window.showdown={Converter:function(){}};' : '',
  }));
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js', route => route.fulfill({
    status: 200, contentType: 'application/javascript; charset=utf-8', body: '',
  }));
  const page = await context.newPage();
  await page.addInitScript(pageAssertSource);
  page.setDefaultTimeout(30000);
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  await page.evaluate(async () => {
    D = defaults();
    D.settings.stscript = {globalVars: {}};
    const char = parseCard({name: 'Quick Reply Lifecycle', first_mes: 'opening'});
    char.id = 'quick-reply-lifecycle';
    char.scriptsEnabled = true;
    char.extensions.tavern_helper = {scripts: [{type: 'script', id: 'quick-reply-library', name: 'Lifecycle Library',
      enabled: true, content: 'window.__quickReplyLibraryReady = true;'}]};
    const other = parseCard({name: 'Other Character', first_mes: 'opening'});
    other.id = 'quick-reply-other';
    const session = Object.assign(createBlankSession('Quick Reply Session', 'quick-reply-session'), {greetingChosen: true});
    session.msgs = [{role: 'user', seq: 1, content: 'Existing message'}];
    session.nextMessageSeq = 2;
    const otherSession = Object.assign(createBlankSession('Other Session', 'quick-reply-other-session'), {greetingChosen: true});
    D.characters = [char, other];
    D.currentCharId = '';
    D.chats = {
      [char.id]: {activeSid: session.id, sessions: [session]},
      [other.id]: {activeSid: otherSession.id, sessions: [otherSession]},
    };
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    await selectCharacter(char.id);

    await qrUpsertSet(qrNormalizeSet({name: '生命周期', qrList: [
      {id: 1, label: '重复', message: '/setglobalvar key=clicked 1'},
      {id: 2, label: '重复', message: '/setglobalvar key=clicked 2'},
    ]}), false);
    if (qrState().globalSetNames.length || qrVisibleButtons().length)
      throw new Error('unbound sets must not appear in the quick reply bar');
    await qrBind('character', '生命周期', true);
    if (!qrBoundSets().some(set => set.name === '生命周期')) throw new Error('bound set missing from active character');
    await selectCharacter(other.id);
    if (qrBoundSets().some(set => set.name === '生命周期')) throw new Error('character binding leaked to another character');
    await selectCharacter(char.id);
    await qrBind('global', '生命周期', true);
    await qrBind('chat', '生命周期', true);
    renderQuickReplyBar();
    renderQuickReplyManager();
  });
  await page.locator('#quick-reply-bar .quick-reply-chip').nth(1).waitFor({state: 'visible'});
  await page.locator('#quick-reply-bar .quick-reply-chip').nth(1).tap();
  await page.waitForFunction(() => D.settings.stscript.globalVars.clicked === '2');
  await page.evaluate(() => _qrChain);
  await page.getByRole('button', {name: '设置'}).click();
  await page.getByRole('tab', {name: '快捷栏'}).click();

  await page.evaluate(() => qrManagerDeleteEntry('生命周期', '重复'));
  assert.deepStrictEqual(await page.evaluate(() => qrFindSet('生命周期').qrList.map(item => item.id)), [1, 2],
    'a duplicate label must not be treated as an entry id');
  await page.locator('#qr-manager .qr-entry-row[data-qr-entry="1"] button').first().click();
  await page.waitForFunction(() => D.settings.stscript.globalVars.clicked === '1');
  await page.evaluate(() => _qrChain);
  await page.locator('#qr-manager .qr-entry-row[data-qr-entry="2"] button').first().click();
  await page.waitForFunction(() => D.settings.stscript.globalVars.clicked === '2');
  await page.evaluate(() => _qrChain);

  const duplicateRow = page.locator('#qr-manager .qr-entry-row[data-qr-entry="2"]');
  await duplicateRow.getByRole('button', {name: '编辑'}).click();
  await page.locator('#qr-edit-label').fill('第二条');
  await page.locator('#qr-entry-editor').getByRole('button', {name: '保存条目'}).click();
  await page.waitForFunction(() => qrEntryById(qrFindSet('生命周期'), 2).label === '第二条');
  await page.evaluate(() => _qrCommitChain);
  await page.waitForFunction(() => document.querySelector('#qr-manager .qr-entry-row[data-qr-entry="2"] strong')?.textContent === '第二条');
  assert.deepStrictEqual(await page.locator('#qr-manager .qr-entry-row strong').allTextContents(), ['重复', '第二条']);

  await page.locator('#qr-manager .qr-entry-row[data-qr-entry="2"] button').nth(2).click();
  await page.locator('#app-prompt-ok').click();
  await page.waitForFunction(() => qrFindSet('生命周期').qrList.length === 1);
  await page.evaluate(() => _qrCommitChain);
  await page.waitForFunction(() => document.querySelectorAll('#qr-manager .qr-entry-row').length === 1
    && !document.querySelector('#qr-manager .qr-entry-row[data-qr-entry="2"]'));
  assert.deepStrictEqual(await page.evaluate(() => qrFindSet('生命周期').qrList.map(item => item.id)), [1],
    'duplicate-label deletion must target the selected item id');

  await page.evaluate(async () => {
    const set = qrNormalizeSet({name: '自动队列', qrList: [
      {id: 1, label: '先执行', message: '/delay 100 | /setglobalvar key=queue first', executeOnAi: true},
      {id: 2, label: '后执行', message: '/getglobalvar key=queue | /setglobalvar key=observed {{pipe}}', executeOnAi: true},
    ]});
    await qrUpsertSet(set, true);
    await qrPerformAuto('executeOnAi');
  });
  assert.strictEqual(await page.evaluate(() => D.settings.stscript.globalVars.observed), 'first',
    'automatic entries must run serially and observe earlier writes');

  await page.evaluate(async () => {
    await qrUpsertSet(qrNormalizeSet({name: '可停止', qrList: [
      {id: 1, label: '迟到写入', message: '/delay 4000 | /setglobalvar key=afterStop leaked', executeOnAi: true},
    ]}), true);
    window.__quickReplyPending = qrPerformAuto('executeOnAi').then(() => false, error => qrIsAbortError(error));
  });
  await page.waitForFunction(() => _qrRun && _qrRun.set === '可停止');
  await page.locator('#qr-manager').getByRole('button', {name: '停止脚本'}).click();
  assert.strictEqual(await page.evaluate(() => window.__quickReplyPending), true, 'stop must propagate cancellation to the auto-execution caller');
  assert.strictEqual(await page.evaluate(() => D.settings.stscript.globalVars.afterStop), undefined,
    'stopping the running automatic entry must prevent its delayed write');
  assert.strictEqual(await page.evaluate(async () => {
    const set = qrNormalizeSet({name: '停止后恢复', qrList: [
      {id: 1, label: '继续运行', message: '/setglobalvar key=recovered yes | /pass resumed'},
    ]});
    await qrUpsertSet(set, false);
    return await qrExecuteEntry(qrFindSet(set.name), set.qrList[0], {});
  }), 'resumed', 'stopping a run must leave the queue ready for the next entry');
  assert.strictEqual(await page.evaluate(() => D.settings.stscript.globalVars.recovered), 'yes');

  await page.waitForFunction(() => _cardScriptLibraryLive && _cardScriptLibraryLive.state === 'ready'
    && _cardScriptLibraryLive.frame.contentWindow.__quickReplyLibraryReady === true);
  const persistenceEvidence = await page.evaluate(async () => {
    const check = window.assert;
    const char = getChar(), session = getActiveSession(char.id), box = D.chats[char.id];
    const set = qrFindSet('生命周期');
    const run = message => qrExecuteEntry(set, {id: 99, label: 'Persistence Probe', message}, {});
    await run('/setvar key=keep 1');
    await flushPendingSave();
    const messagesBefore = JSON.stringify(session.msgs);

    // Both real storage boundaries must fail: IndexedDB alone can fall back to the recovery snapshot.
    async function rejectSessionSave(work) {
      const persistedBefore = (await YeyuRepository.load()).data;
      const originalPut = IDBObjectStore.prototype.put, originalSetItem = Storage.prototype.setItem;
      let primaryFailures = 0, recoveryFailures = 0;
      try {
        IDBObjectStore.prototype.put = function() {
          if (this.name === 'sessions') {
            primaryFailures++;
            throw new DOMException('lifecycle IndexedDB storage failure', 'QuotaExceededError');
          }
          return originalPut.apply(this, arguments);
        };
        Storage.prototype.setItem = function(key) {
          if (key === FALLBACK_KEY) {
            recoveryFailures++;
            throw new DOMException('lifecycle recovery snapshot failure', 'QuotaExceededError');
          }
          return originalSetItem.apply(this, arguments);
        };
        await check.rejects(work, /本地存储写入失败/);
      } finally {
        IDBObjectStore.prototype.put = originalPut;
        Storage.prototype.setItem = originalSetItem;
      }
      check.ok(primaryFailures > 0 && recoveryFailures > 0, 'both storage faults must be exercised');
      check.deepStrictEqual((await YeyuRepository.load()).data, persistedBefore, 'failed save must leave all persisted master data intact');
      check.ok(D.chats[char.id] === box && getActiveSession(char.id) === session, 'failed save must preserve the active session owner');
      check.strictEqual(JSON.stringify(session.msgs), messagesBefore, 'failed save must preserve existing messages');
      return {primaryFailures, recoveryFailures};
    }
    const variables = await rejectSessionSave(() => run('/setvar key=lost 9'));
    check.strictEqual(session.stscriptVars.keep, '1', 'failed variable save must preserve committed variables');
    check.ok(!Object.prototype.hasOwnProperty.call(session.stscriptVars, 'lost'), 'failed variable save must undo the new variable');

    const bindingsBefore = structuredClone(session.quickReply);
    const binding = await rejectSessionSave(() => qrBind('chat', '停止后恢复', true));
    check.deepStrictEqual(session.quickReply, bindingsBefore, 'failed chat binding must restore all previous bindings');

    // A real message projection uses the browser structuredClone API during the resident library refresh.
    // Arm the fault only after the sessions transaction completes, so the variable really reaches storage first.
    const message = session.msgs[0];
    check.ok(message, 'the library refresh needs an existing message to project');
    message.yeyuMvu = {version: 1, activeIndex: 0, candidates: [{variables: {refreshFaultProbe: true}}]};
    await saveData('sessions', {urgent: true});
    const committedBefore = (await YeyuRepository.load()).data;
    const originalPut = IDBObjectStore.prototype.put, originalClone = window.structuredClone;
    let committed = false, refreshFailures = 0;
    try {
      IDBObjectStore.prototype.put = function() {
        if (this.name === 'sessions') this.transaction.addEventListener('complete', () => { committed = true; }, {once: true});
        return originalPut.apply(this, arguments);
      };
      window.structuredClone = function(value) {
        if (committed && value && value.refreshFaultProbe === true) {
          refreshFailures++;
          throw new DOMException('lifecycle context refresh failure', 'DataCloneError');
        }
        return originalClone.apply(this, arguments);
      };
      await check.rejects(() => run('/setvar key=saved yes'), /lifecycle context refresh failure/);
    } finally {
      IDBObjectStore.prototype.put = originalPut;
      window.structuredClone = originalClone;
    }
    check.ok(committed && refreshFailures === 1, 'refresh fault must occur once after a real sessions commit');
    check.deepStrictEqual(session.stscriptVars, {keep: '1', saved: 'yes'}, 'refresh failure must retain committed variables');
    committedBefore.chats[char.id].sessions.find(row => row.id === session.id).stscriptVars.saved = 'yes';
    check.deepStrictEqual((await YeyuRepository.load()).data, committedBefore, 'refresh failure must retain the persisted write and all previous data');
    return {variables, binding, committed, refreshFailures};
  });

  await page.evaluate(() => flushPendingSave());
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  assert.deepStrictEqual(await page.evaluate(() => ({
    setNames: D.settings.quickReply.sets.map(set => set.name),
    entry: qrFindSet('生命周期').qrList.map(item => [item.id, item.label]),
    globalBinding: D.settings.quickReply.globalSetNames,
    chatBinding: qrChatConfig().setNames,
    characterBinding: D.settings.quickReply.characterLinks['quick-reply-lifecycle'],
    observed: D.settings.stscript.globalVars.observed,
    variables: getActiveSession(getChar().id).stscriptVars,
  })), {
    setNames: ['生命周期', '自动队列', '可停止', '停止后恢复'],
    entry: [[1, '重复']],
    globalBinding: ['生命周期', '自动队列', '可停止'],
    chatBinding: ['生命周期'],
    characterBinding: ['生命周期'],
    observed: 'first',
    variables: {keep: '1', saved: 'yes'},
  });
  assert.deepStrictEqual(pageErrors, []);
  console.log('quick reply lifecycle browser tests passed: ' + JSON.stringify(persistenceEvidence));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
