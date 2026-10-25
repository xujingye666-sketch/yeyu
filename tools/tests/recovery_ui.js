'use strict';

// Unsaved stream drafts left from a previous run come back as recovery cards when the startup
// auto-save cannot write them. From the real cards: "重试保存" turns a draft into a stored incomplete
// reply and clears its record, "丢弃" deletes the draft; both outcomes survive a reload.
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');

const {waitForAppReady} = require('./helpers/app-ready');
const assets = path.resolve(__dirname, '../../app/src/main/assets');
const CHAR_ID = 'recovery-ui-char';
const KEPT = {draftId: 'recovery-kept', text: '这里是断网前已经显示给用户的正文。'};
const DROPPED = {draftId: 'recovery-dropped', text: '另一份要丢弃的半截正文。'};
// Storage is full while this flag is set: the primary database write and its local fallback snapshot both fail.
const FULL_STORAGE_FLAG = 'recovery-ui-full-storage';

function simulateFullStorage(flag) {
  // Init scripts also run in the sandboxed card frames, whose opaque origin denies sessionStorage.
  try {
    if (!sessionStorage.getItem(flag)) return;
  } catch (_) {
    return;
  }
  const failing = () => sessionStorage.getItem(flag) === '1';
  let repository;
  Object.defineProperty(window, 'YeyuRepository', {
    configurable: true,
    get: () => repository,
    set(value) {
      repository = value && Object.assign({}, value, {
        save(...args) {
          return failing() ? Promise.reject(new Error('模拟存储空间不足')) : value.save(...args);
        },
      });
    },
  });
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'tavern_v3_failed_save' && failing()) throw new DOMException('模拟存储空间不足', 'QuotaExceededError');
    return setItem.call(this, key, value);
  };
}

let browser;
let server;
(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  await context.addInitScript(simulateFullStorage, FULL_STORAGE_FLAG);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {
    ignoreConsoleError: message => message.text().startsWith('IndexedDB 写入失败'),
  });
  const appReady = () => waitForAppReady(page);
  const chat = page.locator('#chat-messages');
  const card = draft => page.locator('.stream-draft-recovery').filter({hasText: `已保存 ${draft.text.length} 字`});
  const state = () => page.evaluate(async charId => {
    const stored = await YeyuRepository.loadStreamDrafts(sanitizeStoredStreamDraft);
    return {
      msgs: getActiveSession(charId).msgs.map(row => ({role: row.role, content: row.content, incomplete: messageIsIncomplete(row)})),
      storedDrafts: stored.drafts.map(row => row.draftId).sort(),
    };
  }, CHAR_ID);

  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await appReady();
  // A conversation saved while two replies were still streaming: their drafts are on disk, the replies are not.
  await page.evaluate(async ({charId, drafts}) => {
    const char = parseCard({name: '恢复卡片验证角色', first_mes: ''});
    char.id = charId;
    const session = createBlankSession('草稿恢复验证', 'recovery-ui-session');
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    session.msgs = [{role: 'user', seq: 1, content: '请继续当前故事', time: Date.now() - 30000}];
    session.nextMessageSeq = 2;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    const now = Date.now();
    for (const [index, draft] of drafts.entries()) {
      await persistStreamDraftRecord({
        version: 1, draftId: draft.draftId, charId: char.id, sessionId: session.id,
        targetMode: 'new', targetMessageSeq: 1, committedBaseHash: streamDraftBaseHash(session),
        text: draft.text, receivedChars: draft.text.length, state: 'network_error', stopReason: 'network_error',
        updatedAt: now - 15000 + index, createdAt: now - 20000 + index, lastSavedChars: draft.text.length,
        lastSavedAt: now - 15000 + index, committedMessageHash: '', committedTargetSeq: 0, staleReason: '',
      });
    }
  }, {charId: CHAR_ID, drafts: [KEPT, DROPPED]});

  // Restart on a full disk: startup auto-save fails, so both drafts wait as recovery cards.
  await page.evaluate(flag => sessionStorage.setItem(flag, '1'), FULL_STORAGE_FLAG);
  await page.reload({waitUntil: 'load'});
  await appReady();
  await card(KEPT).waitFor();
  await card(DROPPED).waitFor();
  const started = await state();
  assert.deepStrictEqual(started.msgs.map(row => row.role), ['user'], '启动自动保存失败时草稿不得写进聊天');
  assert.deepStrictEqual(started.storedDrafts, [DROPPED.draftId, KEPT.draftId].sort(), '保存失败的草稿必须留在本地');

  // Space is freed; the user retries one draft and discards the other.
  await page.evaluate(flag => sessionStorage.setItem(flag, '0'), FULL_STORAGE_FLAG);
  await card(KEPT).getByRole('button', {name: '重试保存', exact: true}).click();
  await card(KEPT).waitFor({state: 'detached'});
  await chat.getByText(KEPT.text).waitFor();
  await card(DROPPED).getByRole('button', {name: '丢弃', exact: true}).click();
  await card(DROPPED).waitFor({state: 'detached'});
  const expected = {
    msgs: [
      {role: 'user', content: '请继续当前故事', incomplete: false},
      {role: 'assistant', content: KEPT.text, incomplete: true},
    ],
    storedDrafts: [],
  };
  assert.deepStrictEqual(await state(), expected, '重试保存必须把草稿写成未完成回复并清除草稿记录，丢弃必须删除草稿');

  await page.evaluate(flag => sessionStorage.removeItem(flag), FULL_STORAGE_FLAG);
  await page.reload({waitUntil: 'load'});
  await appReady();
  await chat.getByText(KEPT.text).waitFor();
  assert.deepStrictEqual(await state(), expected, '重载后保存的回复仍在，丢弃的草稿不再出现');
  assert.strictEqual(await page.locator('.stream-draft-recovery').count(), 0, '重载后不得再出现恢复卡片');
  assert.strictEqual(await chat.getByText(DROPPED.text).count(), 0, '丢弃的草稿不得出现在聊天中');

  assert.deepStrictEqual(pageErrors, [], `页面错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log(JSON.stringify({recoveryCards: 2, retrySaved: true, discarded: true, survivesReload: true}));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
