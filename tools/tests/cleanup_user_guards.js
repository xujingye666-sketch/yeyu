'use strict';

const assert = require('assert');
const path = require('path');
const {listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable, createAssetServer} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
  await waitForAppReady(page, { timeout: 15000 });

  await page.evaluate(() => {
    D = defaults();
    D.characters = [{ id: 'cleanup-guard-char', name: '回归测试角色' }];
    D.currentCharId = 'cleanup-guard-char';
    D.chats = {
      'cleanup-guard-char': {
        activeSid: 'cleanup-guard-session',
        sessions: [{
          id: 'cleanup-guard-session',
          name: '对话 1',
          msgs: [{ role: 'user', seq: 1, content: '原消息正文' }],
          nextMessageSeq: 2,
          memoryStore: makeEmptyMemoryStore(),
        }],
      },
    };
    renderChat();
  });

  const emptyEdit = await page.evaluate(async () => {
    window.appConfirm = async () => true;
    const before = D.chats['cleanup-guard-char'].sessions[0].msgs[0].content;
    editMessage(0);
    $('edit-msg-content').value = ' \n\t ';
    const saved = await saveEditMessage();
    return {
      saved,
      before,
      after: D.chats['cleanup-guard-char'].sessions[0].msgs[0].content,
      toast: $('toasts').textContent,
      modalOpen: $('edit-msg-modal').classList.contains('open'),
    };
  });
  assert.strictEqual(emptyEdit.saved, false);
  assert.strictEqual(emptyEdit.after, emptyEdit.before);
  assert.match(emptyEdit.toast, /消息内容不能为空，原消息没有改变/);
  assert.strictEqual(emptyEdit.modalOpen, true);
  assert.deepStrictEqual(pageErrors, []);
  console.log(JSON.stringify({
    emptyEditPreserved: true,
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
