'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

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
  const continuationRequests = [];
  await page.route('https://continuation.test/**', async route => {
    continuationRequests.push({url: route.request().url(), body: route.request().postDataJSON()});
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: ' + JSON.stringify({choices: [{delta: {content: '固定续写结果。'}, finish_reason: null}]})
        + '\n\ndata: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n'
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  const setup = await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = false;
    const char = {
      id: 'continuation-undo-char', name: '测试角色', description: '', personality: '', scenario: '',
      first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', extensions: {}
    };
    const session = createBlankSession('撤销续写验证', 'continuation-undo-session');
    const message = {role: 'assistant', content: '续写前原文。', reasoning: '原有思考', time: 100, seq: 2, marker: {keep: true}};
    session.greetingChosen = true;
    session.msgs = [{role: 'user', content: '继续这个场景', time: 50, seq: 1}, message];
    ensureMessageSequences(session);
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    renderChat();
    updateChatUI();
    const target = {charId: char.id, sessionId: session.id, mode: 'continue', messageIndex: 1, messageSeq: 2};
    await commitGeneratedResponse(target, '第一段续写。', {continuedBase: message.content, reasoning: '第一段思考', finishReason: 'stop'});
    const afterFirst = message.content;
    const firstBase = message.continueBase;
    await commitGeneratedResponse(target, '第二段续写。', {continuedBase: message.content, reasoning: '第二段思考', finishReason: 'stop'});
    return {afterFirst, firstBase, latestBase: message.continueBase, content: message.content};
  });
  assert.strictEqual(setup.firstBase, '续写前原文。', '首次续写必须保存续写前正文');
  assert.strictEqual(setup.latestBase, setup.afterFirst, '连续续写必须只保留最近一段之前的正文');
  assert(setup.content.includes('第二段续写。'));

  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});
  await page.waitForFunction(() => D.currentCharId === 'continuation-undo-char'
    && getActiveSession(D.currentCharId).msgs.length === 2, null, {timeout: 15000});
  const persisted = await page.evaluate(() => {
    const message = getActiveSession(D.currentCharId).msgs[1];
    return {base: message.continueBase, content: message.content, marker: message.marker};
  });
  assert.strictEqual(persisted.base, setup.afterFirst, '最近续写前正文必须随会话落库并在刷新后恢复');
  assert(persisted.content.includes('第二段续写。'));
  assert.deepStrictEqual(persisted.marker, {keep: true});

  assert.strictEqual(await page.locator('[data-msg-idx="0"] .msg-more-menu').getByText('撤销续写', {exact: true}).count(), 0, '用户消息不得显示撤销续写入口');
  await page.locator('[data-msg-idx="1"] .stream-content-slot').click();
  const assistantMore = page.locator('[data-msg-idx="1"] .msg-more-toggle');
  await assistantMore.click();
  const undoButton = page.locator('[data-msg-idx="1"] .msg-more-menu').getByRole('button', {name: '撤销续写', exact: true});
  assert.strictEqual(await undoButton.count(), 1, '有有效续写快照的助手消息必须显示撤销入口');
  assert.strictEqual(await undoButton.isVisible(), true, '展开更多菜单后撤销入口必须可点击');
  const beforeUndo = await page.evaluate(() => {
    const message = getActiveSession(D.currentCharId).msgs[1];
    return {reasoning: message.reasoning, time: message.time, continued: message.continued, marker: message.marker, seq: message.seq, role: message.role};
  });
  await undoButton.click();
  await page.waitForFunction(() => {
    const message = getActiveSession(D.currentCharId).msgs[1];
    const bubble = document.querySelector('[data-msg-idx="1"] .msg-bubble');
    return !Object.prototype.hasOwnProperty.call(message, 'continueBase') && bubble && !bubble.textContent.includes('第二段续写。');
  });
  const afterUndo = await page.evaluate(() => {
    const message = getActiveSession(D.currentCharId).msgs[1];
    return {
      content: message.content,
      hasBase: Object.prototype.hasOwnProperty.call(message, 'continueBase'),
      other: {reasoning: message.reasoning, time: message.time, continued: message.continued, marker: message.marker, seq: message.seq, role: message.role}
    };
  });
  assert.strictEqual(afterUndo.content, setup.afterFirst, '一次撤销只能移除最近一段续写');
  assert.strictEqual(afterUndo.hasBase, false, '撤销后必须清除单级快照');
  assert.deepStrictEqual(afterUndo.other, beforeUndo, '撤销续写不得改动消息其他部分');
  assert.strictEqual(await page.locator('[data-msg-idx="1"] .msg-bubble').textContent().then(text => text.includes('第二段续写。')), false, '气泡必须立即移除最近续写内容');
  assert.strictEqual(await page.getByRole('button', {name: '撤销续写', exact: true}).count(), 0, '撤销后入口必须立即消失');

  const oneLevel = await page.evaluate(async () => {
    const message = getActiveSession(D.currentCharId).msgs[1];
    const before = message.content;
    const notices = [];
    const originalToast = toast;
    window.toast = text => notices.push(String(text));
    await restoreOriginalMessage(1, true);
    window.toast = originalToast;
    return {before, after: message.content, notice: notices[notices.length - 1]};
  });
  assert.deepStrictEqual(oneLevel, {before: setup.afterFirst, after: setup.afterFirst, notice: '没有可撤销的续写'}, '单级撤销用完后不得继续回退');

  const replacementProof = await page.evaluate(async () => {
    const session = getActiveSession(D.currentCharId);
    const message = session.msgs[1];
    message.continueBase = '失效快照';
    await commitGeneratedResponse({charId: D.currentCharId, sessionId: session.id, mode: 'regenerate', messageIndex: 1, messageSeq: 2}, '重新生成正文。', {finishReason: 'stop'});
    await awaitGenerationPostCommit(session);
    setGenerationState('idle');
    const regenerateCleared = !Object.prototype.hasOwnProperty.call(message, 'continueBase');
    message.continueBase = '失效快照';
    editMessage(1);
    document.getElementById('edit-msg-content').value = '手动编辑正文。';
    const originalConfirm = appConfirm;
    window.appConfirm = async () => true;
    await saveEditMessage();
    window.appConfirm = originalConfirm;
    return {regenerateCleared, editCleared: !Object.prototype.hasOwnProperty.call(message, 'continueBase'), edited: message.content};
  });
  assert.deepStrictEqual(replacementProof, {regenerateCleared: true, editCleared: true, edited: '手动编辑正文。'}, '替换正文后必须清理失效的撤销快照');

  const duplicateSwipe = await page.evaluate(async () => {
    const session = getActiveSession(D.currentCharId);
    const message = session.msgs[1];
    const restore = {content: message.content, swipes: message.swipes, swipeId: message.swipeId};
    message.swipes = ['甲候选正文。', '乙候选正文。'];
    message.swipeId = 1;
    message.content = '乙候选正文。';
    await commitGeneratedResponse({charId: D.currentCharId, sessionId: session.id, mode: 'regenerate', messageIndex: 1, messageSeq: 2}, '甲候选正文。', {finishReason: 'stop'});
    await awaitGenerationPostCommit(session);
    setGenerationState('idle');
    const proof = {swipes: message.swipes.slice(), swipeId: message.swipeId, content: message.content};
    message.content = restore.content;
    if (restore.swipes === undefined) delete message.swipes; else message.swipes = restore.swipes;
    if (restore.swipeId === undefined) delete message.swipeId; else message.swipeId = restore.swipeId;
    return proof;
  });
  assert.deepStrictEqual(duplicateSwipe, {
    swipes: ['甲候选正文。', '乙候选正文。'],
    swipeId: 0,
    content: '甲候选正文。'
  }, '重新生成得到与已有候选完全相同的正文时，必须选中已有那条而不是追加重复候选');

  const failedSave = await page.evaluate(async () => {
    const message = getActiveSession(D.currentCharId).msgs[1];
    message.content = '续写后正文。';
    message.continueBase = '续写前正文。';
    renderChat();
    const notices = [];
    const originalSave = saveData;
    const originalToast = toast;
    window.saveData = async () => { throw new Error('磁盘写入失败'); };
    window.toast = text => notices.push(String(text));
    try { await restoreOriginalMessage(1, true); }
    finally { window.saveData = originalSave; window.toast = originalToast; }
    const restored = getActiveSession(D.currentCharId).msgs[1];
    return {content: restored.content, base: restored.continueBase, notice: notices[notices.length - 1]};
  });
  assert.deepStrictEqual(failedSave, {
    content: '续写后正文。',
    base: '续写前正文。',
    notice: '撤销续写保存失败，原状态已恢复：磁盘写入失败'
  }, '撤销保存失败时必须恢复续写后正文与可重试快照');

  // The built-in preset ships an empty post-history slot; fill it so the continuation has something to leave out.
  const target = '内置预设续写目标第一行。\n内置预设续写目标末行。';
  const jailbreakMarker = 'FULL_TURN_POST_HISTORY_MARKER';
  const builtinRaw = await page.evaluate(() => presetRawDefault());
  const outcome = await page.evaluate(async ({raw, target, jailbreakMarker}) => {
    const char = getChar();
    const session = getActiveSession(char.id);
    session.msgs = [
      {role: 'user', content: '续写请求前文。', time: 300, seq: 1},
      {role: 'assistant', content: target, time: 400, seq: 2}
    ];
    session.nextMessageSeq = 3;
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    ensureMessageSequences(session);
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {
      apiUrl: 'https://continuation.test/v1',
      apiKey: 'synthetic-local',
      model: 'continuation-test',
      promptPostProcessing: 'none',
      reasoningEffort: 'off'
    });
    const preset = cloneData(raw);
    preset.prompts.find(prompt => prompt.identifier === 'jailbreak').content = jailbreakMarker;
    Object.assign(D.settings, {
      useMemory: false,
      embeddingEnabled: false,
      styleAuditEnabled: false,
      maxContextTokens: 0,
      presetEmbeddedTasksEnabled: false,
      activeChatCompletionPresetName: '',
      chatCompletionPresetInUse: preset
    });
    const regularCarriesMarker = buildMessages(char, session.msgs, session, {commit: false}).messages
      .some(message => String(message.content || '').includes(jailbreakMarker));
    renderChat();
    updateChatUI();
    setGenerationState('idle');
    const ok = await continueGeneration();
    return {ok, regularCarriesMarker, state: _generationState};
  }, {raw: builtinRaw, target, jailbreakMarker});
  assert.deepStrictEqual(outcome, {ok: true, regularCarriesMarker: true, state: 'idle'}, '普通请求带发送后指令，手动续写入口必须完成一次固定响应生成');
  assert.strictEqual(continuationRequests.length, 1, '手动续写只能发出一个主请求');
  assert.strictEqual(continuationRequests[0].url, 'https://continuation.test/v1/chat/completions');
  const messages = continuationRequests[0].body.messages;
  const nudge = String(builtinRaw.continue_nudge_prompt || '').replace(/{{lastChatMessage}}/g, target.trim());
  assert.strictEqual(builtinRaw.continue_prefill === true, false, '内置默认预设必须走普通续写语义');
  assert(messages.at(-1).role === 'user' && messages.at(-1).content === nudge, '内置默认预设必须以完整 nudge 用户消息收尾');
  assert(messages.at(-2).role === 'assistant' && messages.at(-2).content === target, '内置默认预设必须在 nudge 前保留完整助手原文');
  assert(!messages.some(message => String(message.content || '').includes(jailbreakMarker)), '续写请求不得带入整轮发送后指令');

  assert.deepStrictEqual(pageErrors, [], `页面脚本错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log(JSON.stringify({
    continuationUndo: true,
    persistedAcrossReload: true,
    levels: 1,
    viewport: '390x844',
    menuConditional: true,
    saveRollback: true,
    continuationTail: messages.at(-1).role,
    postHistoryExcluded: true
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
