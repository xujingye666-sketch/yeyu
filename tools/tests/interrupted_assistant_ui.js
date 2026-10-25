'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  // A conversation whose last reply was cut off mid-sentence and never continued.
  await page.evaluate(() => { window.seedInterruptedConversation = () => {
    D = defaults();
    const char = {
      id: 'interrupted-char', name: '续接验收角色', description: '负责检查旧宅门锁。', personality: '谨慎、直接。',
      scenario: '夜晚的旧宅门厅。', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', extensions: {}
    };
    const session = createBlankSession('中断回复验收', 'interrupted-session');
    session.msgs = [
      {seq: 1, role: 'user', content: '先检查门厅。', time: Date.now() - 3000},
      {
        seq: 2, role: 'assistant', content: '我走到门边，手指刚触到冰冷的锁舌，便听见走廊尽头传来——',
        reasoning: '应保留的推理摘要', incomplete: true, time: Date.now() - 2000,
        generationMeta: {
          incomplete: true, interruptionReason: 'network_error', interruptionStatus: '连接中断',
          interruptionDetail: 'synthetic fixture', sourceDraftId: 'draft-104',
          finishReason: 'error', usage: {total_tokens: 88}, providerTrace: 'keep-this'
        }
      }
    ];
    ensureMessageSequences(session);
    D.characters = [char];
    D.currentCharId = char.id;
    D.personas = [];
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    D.worldBook = {
      categories: [{
        id: 'interrupted-worldbook', name: '中断正文扫描验收', boundCharIds: [], settings: {},
        entries: [{id: 'interrupted-entry', keys: ['锁舌'], content: '世界书命中证据：灯塔地下室的门锁已经损坏。', enabled: true}]
      }],
      globalCategoryIds: ['interrupted-worldbook'], activeCategoryId: 'interrupted-worldbook',
      scan_depth: 20, token_budget: 2048, recursive: false, caseSensitive: false
    };
    D.settings.useMemory = false;
    _generationState = 'idle';
    switchAppPage('chat');
    updateChatUI();
    renderChat();
    return {char, session};
  }; });

  const acceptance = await page.evaluate(async () => {
    const {char, session} = window.seedInterruptedConversation();
    saveData = async function() {};
    markStreamDraftsStaleForSession = async function() {};
    startStyleAuditForSession = function() {};
    window.__interruptedRequestMessages = null;
    doAPICall = async function(options) {
      const active = getActiveSession(options.target.charId);
      window.__interruptedRequestMessages = getBuiltMessages(char, active.msgs).messages.map(row => ({role: row.role, content: row.content}));
      return '';
    };
    const sent = await doSendMessage('接着检查门锁。');
    return {
      sent,
      messages: copyJsonData(session.msgs),
      ordinary: memoryV5IsOrdinaryMessage(session.msgs[1]),
      requestMessages: copyJsonData(window.__interruptedRequestMessages || []),
    };
  });

  assert.strictEqual(acceptance.sent, true, '直接发送下一条用户消息必须成功');
  assert.deepStrictEqual(acceptance.messages.map(row => row.role), ['user', 'assistant', 'user']);
  assert.strictEqual(acceptance.messages[1].content, '我走到门边，手指刚触到冰冷的锁舌，便听见走廊尽头传来——');
  assert.strictEqual(acceptance.messages[1].reasoning, '应保留的推理摘要');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(acceptance.messages[1], 'incomplete'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(acceptance.messages[1].generationMeta, 'interruptionReason'), false);
  assert.strictEqual(acceptance.ordinary, true, '已接受正文必须按普通消息参与记忆');
  assert.deepStrictEqual(acceptance.messages[1].generationMeta.usage, {total_tokens: 88});
  assert.strictEqual(acceptance.messages[1].generationMeta.finishReason, 'error');
  assert.strictEqual(acceptance.messages[1].generationMeta.providerTrace, 'keep-this');
  const requestRoles = acceptance.requestMessages.filter(row => row.role === 'user' || row.role === 'assistant').map(row => row.role);
  assert.deepStrictEqual(requestRoles.slice(-3), ['user', 'assistant', 'user']);
  assert(acceptance.requestMessages.some(row => row.role === 'assistant' && row.content.includes('便听见走廊尽头传来——')),
    '下一轮 API 上下文必须包含已接受的中断回复正文');
  assert(acceptance.requestMessages.some(row => row.content.includes('世界书命中证据：灯塔地下室的门锁已经损坏。')),
    '已接受的中断回复正文必须参与真实世界书匹配并注入下一轮请求');

  // When saving the new user message fails, nothing is sent and the cut-off reply stays open for another try.
  await page.evaluate(() => window.seedInterruptedConversation());
  await page.locator('#user-input').fill('这条消息会保存失败。');
  const failed = await page.evaluate(async () => {
    const session = getActiveSession(D.currentCharId);
    let requested = false;
    saveData = async function() { throw new Error('synthetic save failure'); };
    doAPICall = async function() { requested = true; return ''; };
    const sent = await doSendMessage(document.getElementById('user-input').value);
    return {sent, requested, roles: session.msgs.map(row => row.role), assistant: copyJsonData(session.msgs[1]),
      incomplete: messageIsIncomplete(session.msgs[1])};
  });
  assert.strictEqual(failed.sent, false);
  assert.deepStrictEqual(failed.roles, ['user', 'assistant'], '用户消息保存失败时不得留下新消息');
  assert.strictEqual(failed.incomplete, true, '保存失败必须恢复助手未完成状态');
  assert.strictEqual(failed.assistant.generationMeta.interruptionReason, 'network_error', '保存失败必须恢复中断原因');
  assert.strictEqual(failed.assistant.content, '我走到门边，手指刚触到冰冷的锁舌，便听见走廊尽头传来——');
  assert.strictEqual(await page.locator('#user-input').inputValue(), '这条消息会保存失败。', '保存失败必须恢复输入内容供重试');
  assert.strictEqual(failed.requested, false, '保存失败不得进入 API 请求');

  // 旧版多候选消息没有 swipeGenerationMeta：消息级未完成标记属于末尾候选（最后一次生成提交的候选），
  // 看的是前面的候选时不显示未完成提示，记忆也不把它当未完成回复跳过；切到末尾候选才算未完成。
  const legacy = await page.evaluate(() => {
    const {session} = window.seedInterruptedConversation();
    const reply = session.msgs[1];
    delete reply.incomplete;
    Object.assign(reply, {content: '完整的第一版回复。', swipes: ['完整的第一版回复。', '完整的第二版回复。', reply.content], swipeId: 0});
    renderChat();
    const bubbleMeta = () => document.querySelectorAll('[data-msg-idx="1"] .generation-meta').length;
    const earlier = {badges: bubbleMeta(), incomplete: messageIsIncomplete(reply), ordinary: memoryV5IsOrdinaryMessage(reply)};
    reply.swipeId = 2;
    reply.content = reply.swipes[2];
    renderChat();
    return {earlier, last: {badges: bubbleMeta(), incomplete: messageIsIncomplete(reply), ordinary: memoryV5IsOrdinaryMessage(reply)}};
  });
  assert.deepStrictEqual(legacy.earlier, {badges: 0, incomplete: false, ordinary: true}, '旧数据的未完成标记不得显示或作用在非末尾候选上');
  assert.deepStrictEqual(legacy.last, {badges: 1, incomplete: true, ordinary: false}, '旧数据的未完成标记仍属于末尾候选');

  assert.deepStrictEqual(pageErrors, [], `页面错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log(JSON.stringify({
    mainPath: true,
    acceptedConversationRoles: ['user', 'assistant', 'user'],
    requestContextContainsAcceptedAssistant: true,
    worldBookMatchedAcceptedAssistant: true,
    saveFailureAtomic: true,
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
