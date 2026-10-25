'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');

(async () => {
  const server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  const browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  try {
    const page = await browser.newPage();
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/turn-parameters-model/**', async route => {
      requests.push(route.request().postDataJSON().messages);
      const events = [
        {choices: [{delta: {content: '合成回复【状态栏】'}, finish_reason: null}]},
        {choices: [{delta: {}, finish_reason: 'stop'}]},
      ];
      await route.fulfill({status: 200, contentType: 'text/event-stream',
        body: events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n'});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await waitForAppReady(page);
    const originals = await page.evaluate(async () => {
      D = defaults();
      Object.assign(D.settings, {useMemory: false, embeddingEnabled: false, styleAuditEnabled: false, maxContextTokens: 0});
      const char = parseCard({name: '本轮参数', description: '卡片【卡片格式】', first_mes: ''});
      char.id = 'turn-parameters';
      const preset = presetRawDefault();
      preset.prompts.push({identifier: 'parameters-fixture', role: 'user', content: '预设【预设格式】', enabled: true});
      presetOrderRow(preset).order.push({identifier: 'parameters-fixture', enabled: true});
      D.settings.chatCompletionPresetInUse = preset;
      D.worldBook.categories = [{id: 'parameters-book', name: '参数世界书', boundCharIds: [char.id], entries: [
        {id: 'parameters-entry', keys: [], content: '世界书【世界书格式】', constant: true, enabled: true,
          position: 'in_chat', depth: 1, role: 'user'},
      ]}];
      D.worldBook.token_budget = 0;
      const session = createBlankSession('本轮参数', 'turn-parameters-session');
      session.msgs = [
        {seq: 1, role: 'user', content: '第一段\n\n  【OLD_A\n跨行参数】 【OLD_EXTRA】\n\n第二段'},
        {seq: 2, role: 'assistant', content: '历史回复【状态栏】'},
        {seq: 3, role: 'user', content: '  【OLD_ONLY】  \n【OLD_ONLY_TWO】  '},
        {seq: 4, role: 'assistant', content: '中间回复'},
        {seq: 5, role: 'user', content: '旧正文 B  【OLD_B】 【OLD_C】  结尾\n未闭合【保留'},
        {seq: 6, role: 'assistant', content: '末尾回复'},
      ];
      session.nextMessageSeq = 7;
      D.characters = [char]; D.currentCharId = char.id;
      D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
      Object.assign(activeProviderForSettings(D.settings), {
        apiUrl: location.origin + '/turn-parameters-model/v1', apiKey: 'synthetic-local', model: 'synthetic-local',
        promptPostProcessing: 'none', reasoningEffort: 'off',
      });
      await saveData(['meta', 'sessions', 'worldbook'], {urgent: true});
      switchAppPage('chat'); updateChatUI(); renderChat();
      return session.msgs.filter(message => message.role === 'user').map(message => message.content);
    });

    for (const mode of ['normal', 'regenerate', 'swipe', 'continue', 'impersonate']) {
      const before = requests.length;
      const ok = await page.evaluate(async mode => {
        const session = getActiveSession(D.currentCharId);
        if (mode === 'normal') return doSendMessage('本轮【CURRENT】');
        if (mode === 'regenerate') return regenerateLast();
        if (mode === 'swipe') return generateMessageSwipe(session.msgs.length - 1);
        if (mode === 'continue') return continueGeneration();
        return impersonateUser();
      }, mode);
      assert.strictEqual(ok, true, mode + ' 生成失败');
      await page.waitForFunction(() => _generationState === 'idle');
      assert.strictEqual(requests.length, before + 1, mode + ' 应只有一次主请求');
      const messages = requests.at(-1);
      const userContents = messages.filter(message => message.role === 'user').map(message => message.content);
      assert(userContents.includes('第一段\n\n第二段'), mode + ' 应保留段落并清除参数造成的多余空行');
      assert(userContents.includes('旧正文 B 结尾\n未闭合【保留'), mode + ' 应清除行内参数并保留未闭合括号');
      assert(userContents.includes('本轮【CURRENT】'), mode + ' 应保留最后一条 user 的参数');
      assert(!messages.some(message => String(message.content).includes('OLD_')), mode + ' 不得发送旧参数');
      assert(!messages.some(message => !String(message.content).trim()), mode + ' 不得发送空消息');
      assert(messages.some(message => message.role === 'assistant' && message.content === '历史回复【状态栏】'));
      assert(messages.some(message => String(message.content).includes('卡片【卡片格式】')));
      assert(userContents.includes('预设【预设格式】'), '预设即使使用 user 角色也不能被剥离');
      assert(userContents.some(content => content.includes('世界书【世界书格式】')), '世界书的 user 角色注入也不能被剥离');
    }

    const preserved = await page.evaluate(async () => {
      const char = getChar(), session = getActiveSession(char.id);
      renderChat();
      editMessage(0);
      const editor = $('edit-msg-content').value;
      closeModal('edit-msg-modal');
      await flushPendingSave();
      const stored = (await YeyuRepository.load()).data.chats[char.id].sessions[0];
      const context = await assembleGenerationContext(char, session, session.msgs.at(-1), new AbortController().signal);
      return {
        users: stored.msgs.filter(message => message.role === 'user').map(message => message.content),
        visible: $('chat-messages').textContent.includes('OLD_A'), editor,
        auxiliaryRetainsParameters: context.some(message => String(message.content).includes('OLD_A')),
      };
    });
    assert.deepStrictEqual(preserved.users, [...originals, '本轮【CURRENT】']);
    assert.strictEqual(preserved.visible, true);
    assert.strictEqual(preserved.editor, originals[0]);
    assert.strictEqual(preserved.auxiliaryRetainsParameters, true, '配图等辅助上下文不属于主聊天处理范围');
    await page.reload();
    await waitForAppReady(page);
    assert.deepStrictEqual(await page.evaluate(() => getMsgs(D.currentCharId)
      .filter(message => message.role === 'user').map(message => message.content)), preserved.users);

    // Finite context must budget the history that the main request actually sends.
    const finiteOriginals = await page.evaluate(async () => {
      Object.assign(D.settings, {maxContextTokens: 2000, maxTokens: 100});
      const preset = presetRawDefault();
      presetOrderRow(preset).order = [{identifier: 'chatHistory', enabled: true}];
      D.settings.chatCompletionPresetInUse = preset;
      D.worldBook.categories = [];
      const session = getActiveSession(D.currentCharId);
      session.msgs = [
        {seq: 1, role: 'user', content: '有限预算旧正文【' + 'P'.repeat(20000) + '】'},
        {seq: 2, role: 'assistant', content: '历史回复'},
      ];
      session.nextMessageSeq = 3;
      await saveData(['meta', 'sessions', 'worldbook'], {urgent: true});
      renderChat();
      return JSON.stringify(session.msgs);
    });
    const beforeFinite = requests.length;
    assert.strictEqual(await page.evaluate(() => doSendMessage('有限预算本轮【CURRENT】')), true);
    await page.waitForFunction(() => _generationState === 'idle');
    assert.strictEqual(requests.length, beforeFinite + 1);
    const finiteMessages = requests.at(-1);
    assert(finiteMessages.some(message => message.role === 'user' && message.content === '有限预算旧正文'),
      '有限预算应容纳清理后的旧正文，不能让已剥离参数提前挤掉它');
    assert(finiteMessages.some(message => message.content === '有限预算本轮【CURRENT】'));
    assert(!finiteMessages.some(message => String(message.content).includes('PPPP')));
    assert.strictEqual(await page.evaluate(() => JSON.stringify(getMsgs(D.currentCharId).slice(0, 2))), finiteOriginals);
    assert.deepStrictEqual(errors, []);
    console.log(JSON.stringify({stage: 'turn-parameters', modes: 5, requestFiltering: true,
      rawDisplayEditorPersistenceReload: true, auxiliaryUnchanged: true, finiteContext: 2000,
      finiteHistoryPreserved: true, response: 'synthetic-local'}));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error.stack || error); process.exit(1);});
