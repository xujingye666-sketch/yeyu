/* global __controlLeak -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {waitForAppReady} = require('./helpers/app-ready');
let browser, server;

(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({headless: true, executablePath: resolveEdgeExecutable()});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const waitLatestStatus = () => page.waitForFunction(() => {
    const message = getActiveSession(getChar().id).msgs.at(-1);
    const row = document.querySelector(`#chat-messages [data-msg-seq="${message.seq}"]`);
    const child = row?.querySelector('iframe')?.contentDocument;
    const status = child?.getElementById('neutral-status');
    return child?.body?.dataset.ready === 'true' && status?.textContent === 'STATUS_READY' ? status : false;
  });
  await page.route('https://testingcf.jsdelivr.net/**', route => route.fulfill({status: 200,
    contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript', body: ''}));
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {appendUrl: true});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  await page.waitForFunction(() => typeof _appSelectReady !== 'undefined' && _appSelectReady);
  const direct = await page.evaluate(() => {
    const protect = text => regexScriptDisplaySourceText(text, 'assistant', 'display');
    const cases = ['VariableThink', 'VariableInsert', 'VariableEdit', 'VariableDelete', 'era_data'];
    return {
      completePreservedForCardRegex: cases.every(tag => protect(`前文<${tag}>{"note":"CONTROL_SENTINEL"}</${tag}>后文`) === `前文<${tag}>{"note":"CONTROL_SENTINEL"}</${tag}>后文`),
      truncated: cases.every(tag => protect(`前文<${tag}>{"note":"CONTROL_SENTINEL,`) === '前文'),
      adjacent: protect('前文<VariableEdit>{"note":"CONTROL_SENTINEL,<era_data>{}</era_data><StatusPlaceHolderImpl/>后文') === '前文<era_data>{}</era_data><StatusPlaceHolderImpl/>后文',
      internalFence: protect('前文<VariableEdit>\n```json\n{"note":"CONTROL_SENTINEL"}\n```') === '前文',
      mixedCase: protect('前文<vArIaBlEeDiT>{"note":"CONTROL_SENTINEL,') === '前文',
      ordinary: protect('成年人在村口问路。{"world":{"time":"上午"}}<custom>正文</custom>') === '成年人在村口问路。{"world":{"time":"上午"}}<custom>正文</custom>',
      example: protect('```xml\n<VariableEdit>{}</VariableEdit>\n```').includes('<VariableEdit>'),
      tildeExample: protect('~~~xml\n<VariableEdit>{}</VariableEdit>\n~~~').includes('<VariableEdit>'),
      distinctTag: protect('<VariableEdit-example>正文') === '<VariableEdit-example>正文',
      user: regexScriptDisplaySourceText('<VariableEdit>{"note":"CONTROL_SENTINEL,', 'user', 'display').includes('CONTROL_SENTINEL'),
      send: regexScriptDisplaySourceText('<VariableEdit>{"note":"CONTROL_SENTINEL,', 'assistant', 'send').includes('CONTROL_SENTINEL'),
      edit: regexScriptDisplaySourceText('<VariableEdit>{"note":"CONTROL_SENTINEL,', 'assistant', 'edit').includes('CONTROL_SENTINEL'),
    };
  });
  Object.entries(direct).forEach(([key, value]) => assert.strictEqual(value, true, key));
  await page.evaluate(async () => {
    D = defaults(); D.settings.useMemory = false; D.settings.embeddingEnabled = false; D.settings.styleAuditEnabled = false;
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {apiUrl: 'https://model.example.test/v1', apiKey: 'synthetic-key', model: 'fixture', reasoningEffort: 'off', promptPostProcessing: 'none'});
    const char = parseCard({name: '成年旅人', first_mes: '成年旅人在村口停下。', extensions: {regex_scripts: [
      {id: 'hide-control', scriptName: '协议隐藏', findRegex: '/<(variable(?:think|insert|edit|delete)|era_data)>[\\s\\S]*?<\\/\\1>/gi', replaceString: '', placement: [2], markdownOnly: true, promptOnly: true, disabled: false},
      {id: 'status', scriptName: '状态前端', findRegex: '<StatusPlaceHolderImpl/>', replaceString: '<div id="neutral-status">STATUS_READY</div><script>document.body.dataset.ready="true";</script>', placement: [2], markdownOnly: true, disabled: false},
    ]}});
    char.id = 'era-display-fixture'; char.scriptsEnabled = true;
    D.characters = [char]; D.currentCharId = char.id;
    const session = createBlankSession('中性测试', 'era-display-session'); session.greetingChosen = true;
    session.msgs = [{role: 'assistant', content: char.first_mes, seq: 1}]; session.nextMessageSeq = 2;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    renderChat(); updateChatUI();
    const fenced = '<VariableEdit>\n```json\n{"note":"CONTROL_SENTINEL"}\n```\n</VariableEdit>';
    if ((await runRegexTransform(char, 'assistant', 'display', fenced, 0)).includes('CONTROL_SENTINEL'))
      throw new Error('控制块内部的代码围栏必须由原卡完整隐藏规则处理');
    window.__controlLeak = false;
    new MutationObserver(() => {if (document.getElementById('chat-messages').innerText.includes('CONTROL_SENTINEL')) __controlLeak = true;})
      .observe(document.getElementById('chat-messages'), {subtree: true, childList: true, characterData: true});
    callDeepSeek = async function(messages, target, options) {
      window.__outboundRaw = messages.map(row => String(row.content || '')).join('\n');
      const pieces = window.__controlPieces.slice();
      const response = new Response(new ReadableStream({start(controller) {
        let index = 0;
        const send = () => {
          if (index < pieces.length) {
            controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({choices: [{delta: {content: pieces[index++]}}]}) + '\n\n'));
            setTimeout(send, 120);
          } else {
            controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n'));
            controller.close();
          }
        }; send();
      }}), {headers: {'content-type': 'text/event-stream'}});
      return streamResponse(response, target, options);
    };
  });
  for (const complete of [true, false]) {
    const pieces = ['成年旅人在村口询问旅店位置。\n', '<VariableThink>中性计划</VariableThink>\n<VariableEdit>\n',
      '{"world":{"time":"上午"},"user":{"note":"CONTROL_SENTINEL',
      complete ? '"}}</VariableEdit>' : ',',
      '<era_data>{"era-message-key"="neutral-key"}</era_data><StatusPlaceHolderImpl/>'];
    await page.evaluate(pieces => {window.__controlPieces = pieces;}, pieces);
    await page.locator('#user-input').fill('成年旅人继续问路，仅非性日常。');
    await page.locator('#composer-action-btn').click();
    await page.waitForFunction(() => _generationState === 'idle' && getActiveSession(getChar().id).msgs.at(-1).role === 'assistant');
    const status = await waitLatestStatus();
    const result = await page.evaluate(() => ({raw: getActiveSession(getChar().id).msgs.at(-1).content,
      leak: __controlLeak, visible: document.getElementById('chat-messages').innerText.includes('CONTROL_SENTINEL')}));
    assert.strictEqual(result.raw, pieces.join(''), '原始回复必须完整保存，包括未闭合控制数据');
    assert.strictEqual(result.leak, false, '流式过程中不得露出控制数据');
    assert.strictEqual(result.visible, false);
    assert.strictEqual(await status.evaluate(node => node.textContent), 'STATUS_READY', '本轮状态前端必须继续显示');
    await status.dispose();
  }
  await page.reload();
  await waitForAppReady(page);
  await page.waitForFunction(() => D.currentCharId === 'era-display-fixture' && typeof _appSelectReady !== 'undefined' && _appSelectReady);
  const reloadedStatus = await waitLatestStatus();
  assert.strictEqual(await reloadedStatus.evaluate(node => node.textContent), 'STATUS_READY');
  await reloadedStatus.dispose();
  const reloaded = await page.evaluate(() => ({raw: getActiveSession(getChar().id).msgs.at(-1).content,
    visible: document.getElementById('chat-messages').innerText.includes('CONTROL_SENTINEL')}));
  assert(reloaded.raw.includes('CONTROL_SENTINEL,') && !reloaded.raw.includes('</VariableEdit>'));
  assert.strictEqual(reloaded.visible, false);
  assert.strictEqual(await page.evaluate(async () => {
    const raw = getActiveSession(getChar().id).msgs.at(-1).content;
    return (await runRegexTransform(getChar(), 'assistant', 'send', raw, 0)).includes('CONTROL_SENTINEL,');
  }), true, '出站仍严格使用原卡正则，不把显示保护应用到原始协议');
  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log(JSON.stringify({completeAndTruncated: true, normalStop: true, streamingHidden: true, rawPreserved: true, statusFrontendPreserved: true, reloadHidden: true, pageErrors: 0}));
})().catch(error => {console.error(error.stack || error); process.exitCode = 1;}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
