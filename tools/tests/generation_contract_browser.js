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

  const result = await page.evaluate(async () => {
    function check(condition, message) { if (!condition) throw new Error(message); }
    D = defaults();
    D.settings.useMemory = false;
    D.settings.maxContextTokens = 0;
    D.settings.maxTokens = 0;
    D.settings.anFreq = 99;
    D.settings.authorsNote = '设置作者注记';
    D.worldBook = {scan_depth: 20, token_budget: 0, recursive: false, caseSensitive: false, categories: [], globalCategoryIds: [], activeCategoryId: ''};

    const char = {id: 'generation-contract-char', name: '角色', description: '原描述', personality: '原性格', scenario: '原场景', mes_example: '原示例', extensions: {}};
    const prior = {seq: 1, role: 'user', content: '较早消息'};
    const latest = {seq: 3, role: 'user', content: '本轮历史'};
    const session = {id: 'generation-contract-session', msgs: [prior, {seq: 2, role: 'assistant', content: '回复'}, latest], nextMessageSeq: 4, memoryStore: makeEmptyMemoryStore()};
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};

    const controller = new AbortController();
    const messages = await cardFrontendPresetGenerationMessages(char, session, {charId: char.id, sessionId: session.id, mode: 'card-frontend', generationId: 'browser'}, {
      preset_name: 'in_use',
      should_silence: true,
      overrides: {
        world_info_before: '覆盖世界书前',
        persona_description: '覆盖用户描述',
        char_description: '覆盖角色描述',
        char_personality: '覆盖角色性格',
        scenario: '覆盖场景',
        world_info_after: '覆盖世界书后',
        dialogue_examples: '覆盖示例',
        chat_history: {with_depth_entries: false, author_note: '覆盖作者注记'},
      },
      injects: [],
      max_chat_history: 'all',
    }, controller, false);
    const text = messages.map(row => typeof row.content === 'string' ? row.content : JSON.stringify(row.content)).join('\n');
    ['覆盖世界书前', '覆盖用户描述', '覆盖角色描述', '覆盖角色性格', '覆盖场景', '覆盖世界书后', '覆盖示例', '覆盖作者注记'].forEach(marker => check(text.includes(marker), `请求覆盖未进入实际 Prompt：${marker}`));
    check(!text.includes('设置作者注记'), 'author_note 覆盖不得混入设置里的作者注记');
    check(char.description === '原描述' && char.personality === '原性格' && char.scenario === '原场景' && char.mes_example === '原示例', '请求覆盖污染角色主数据');

    const imageMessages = await cardFrontendPresetGenerationMessages(char, session, {charId: char.id, sessionId: session.id, mode: 'card-frontend', generationId: 'browser-image'}, {
      preset_name: 'in_use', should_silence: true, max_chat_history: 'all', injects: [],
      overrides: {chat_history: {prompts: [{role: 'user', content: '带图 {{char}}', image: 'data:image/png;base64,AA=='}]}},
    }, new AbortController(), false);
    const imageMessage = imageMessages.find(row => Array.isArray(row.content) && row.content.some(part => part && part.type === 'image_url'));
    check(imageMessage && imageMessage.content.some(part => part.type === 'image_url' && part.image_url.url === 'data:image/png;base64,AA=='), '带宏 history prompt 的图片未绑定到对应出站消息');
    check(!imageMessages.some(row => Object.prototype.hasOwnProperty.call(row, '_yeyuGenerationImageKey')), '请求期图片身份标记泄漏到出站消息');

    const rawTopImageMessages = await cardFrontendPresetGenerationMessages(char, session, {charId: char.id, sessionId: session.id, mode: 'card-frontend', generationId: 'browser-raw-top-image'}, {
      ordered_prompts: ['user_input', 'chat_history'], user_input: '本次顶层图片', image: 'data:image/png;base64,TOP=',
      should_silence: true, max_chat_history: 'all', injects: [], overrides: {},
    }, new AbortController(), true);
    const rawTopImageMessage = rawTopImageMessages.find(row => Array.isArray(row.content) && row.content.some(part => part && part.type === 'image_url' && part.image_url.url === 'data:image/png;base64,TOP='));
    check(rawTopImageMessage && rawTopImageMessage.content.some(part => part.type === 'text' && part.text === '本次顶层图片'), 'raw 顶层 image 没有绑定 ordered user_input');
    check(!rawTopImageMessages.some(row => Array.isArray(row.content) && row.content.some(part => part && part.type === 'text' && part.text === '本轮历史') && row.content.some(part => part && part.type === 'image_url')), 'raw 顶层 image 污染了历史 user');

    const imageOnlyMessages = await cardFrontendPresetGenerationMessages(char, session, {charId: char.id, sessionId: session.id, mode: 'card-frontend', generationId: 'browser-image-only'}, {
      preset_name: 'in_use', user_input: '', image: 'data:image/png;base64,ONLY=', should_silence: true,
      max_chat_history: 'all', injects: [], overrides: {},
    }, new AbortController(), false);
    const imageOnlyMessage = imageOnlyMessages.find(row => Array.isArray(row.content) && row.content.some(part => part && part.type === 'image_url' && part.image_url.url === 'data:image/png;base64,ONLY='));
    check(imageOnlyMessage && imageOnlyMessage.content.some(part => part.type === 'text' && part.text === ''), '仅 image 请求没有创建本次空 user_input');
    check(!imageOnlyMessages.some(row => Array.isArray(row.content) && row.content.some(part => part && part.type === 'text' && part.text === '本轮历史') && row.content.some(part => part && part.type === 'image_url')), '仅 image 请求污染了既有历史楼层');

    const originalBroadcastAwait = cardFrontendAwaitBroadcastEvent;
    const originalCallDeepSeek = callDeepSeek;
    let transportedMessages = null;
    try {
      cardFrontendAwaitBroadcastEvent = async function(name, args) {
        if (name === CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATE_AFTER_DATA) {
          const payload = args[0];
          payload.chat = payload.chat.concat([{role: 'system', content: 'EVENT:<%= 6 * 7 %>'}]);
        }
        return args;
      };
      callDeepSeek = async function(outbound) {
        transportedMessages = structuredClone(outbound);
        return {content: 'ok'};
      };
      const response = await executeCardFrontendGeneration({
        preset_name: 'in_use', should_silence: true, max_chat_history: 'all', injects: [], overrides: {},
      }, {charId: char.id, owner: {charId: char.id, sessionId: session.id}}, false);
      check(response === 'ok', 'helper 生成测试没有完成传输');
      const eventMessage = transportedMessages && transportedMessages.find(row => String(row.content || '').startsWith('EVENT:'));
      check(eventMessage && eventMessage.content === 'EVENT:42', 'GENERATE_AFTER_DATA 新增的 EJS 未在最终传输前求值');
      check(!transportedMessages.some(row => String(row.content || '').includes('<%')), 'helper 最终出站仍含原始 EJS');
    } finally {
      cardFrontendAwaitBroadcastEvent = originalBroadcastAwait;
      callDeepSeek = originalCallDeepSeek;
    }

    const savedListeners = _cardFrontendEventListeners.slice();
    const payloadOwner = {};
    const payloadEvents = [];
    try {
      cardFrontendRegisterEvent(payloadOwner, CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_COMPLETION_PROMPT_READY, function(data) {
        check(arguments.length === 1 && Array.isArray(data.chat) && data.dryRun === false, 'prompt-ready 负载/参数顺序错误');
        data.chat.push({role: 'system', content: 'PROMPT_READY'});
        payloadEvents.push('ready');
      }, false);
      cardFrontendRegisterEvent(payloadOwner, CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATE_AFTER_DATA, async function(data, dryRun) {
        check(arguments.length === 2 && dryRun === false, 'after-data 的 dryRun 必须是第二个参数');
        check(data.prompt.some(row => row.content === 'PROMPT_READY'), 'after-data 未收到 prompt-ready 修改后的 prompt');
        data.prompt = data.prompt.concat([{role: 'system', content: 'PROMPT_REPLACED'}]);
        check(data.chat === data.prompt, 'prompt 整体替换后 chat 别名脱节');
        await Promise.resolve();
        data.chat = data.chat.concat([{role: 'system', content: 'CHAT_REPLACED'}]);
        check(data.chat === data.prompt, 'chat 整体替换后 prompt 别名脱节');
        payloadEvents.push('data');
      }, false);
      let transportCount = 0;
      callDeepSeek = async function(outbound) {
        check(['PROMPT_READY', 'PROMPT_REPLACED', 'CHAT_REPLACED'].every(marker => outbound.some(row => row.content === marker)), '事件修改未进入最终请求');
        transportCount++;
        return {content: 'ok', display: 'ok', reasoning: '', finishReason: 'stop'};
      };
      for (const raw of [false, true]) {
        await executeCardFrontendGeneration(raw
          ? {ordered_prompts: [{role: 'user', content: 'raw test'}], should_silence: true}
          : {preset_name: 'in_use', should_silence: true, user_input: 'helper test'},
        {charId: char.id, owner: {charId: char.id, sessionId: session.id}}, raw);
      }
      session.msgs = [prior];
      session.nextMessageSeq = 2;
      renderChat();
      check(document.getElementById('composer-image-btn').disabled, '没有 AI 回复时输入栏生图不可用');
      await doSendMessage('interactive test');
      check(!document.getElementById('composer-image-btn').disabled, '首条 AI 回复提交后输入栏生图应启用');
      const firstReply = session.msgs.find(row => row.role === 'assistant');
      check(firstReply && !document.querySelector('[data-msg-seq="' + firstReply.seq + '"] [data-message-image-action]'), '最新 AI 回复的更多菜单不重复生图');
      await doSendMessage('second interactive test');
      check(!!document.querySelector('[data-msg-seq="' + firstReply.seq + '"] [data-message-image-action]'), '连续生成后旧 AI 回复的更多菜单恢复生图入口');
      check(!document.getElementById('composer-image-btn').disabled, '连续生成后输入栏生图仍可用');
      check(transportCount === 4 && payloadEvents.join(',') === 'ready,data,ready,data,ready,data,ready,data', '普通生成与 generate/generateRaw 必须使用相同事件语义');
    } finally {
      callDeepSeek = originalCallDeepSeek;
      cardFrontendClearOwnerRegistrations(payloadOwner);
    }
    const fakeA = {key: 'a'};
    const fakeB = {key: 'b'};
    const fakeLibrary = {key: 'library'};
    const awaited = [];
    const delivered = [];
    try {
      _cardFrontendEventListeners = [];
      [fakeA, fakeB, fakeLibrary].forEach(live => cardFrontendRegisterEvent(live, 'probe_tavern', async payload => { awaited.push([live.key, 'probe_tavern']); payload.value += live.key; }, false));
      const payload = {value: 'x'};
      await cardFrontendAwaitBroadcastEvent('probe_tavern', [payload]);
      check(payload.value === 'xablibrary', '跨 frame 异步事件修改未按实际注册顺序传播');
      [fakeA, fakeB, fakeLibrary].forEach(live => cardFrontendRegisterEvent(live, 'probe_iframe', () => { delivered.push([live.key, 'event', 'probe_iframe']); }, false));
      check(cardFrontendBroadcastEvent('probe_iframe', ['payload']) === 3, 'iframe 广播未覆盖全部 live');
      await new Promise(resolve => setTimeout(resolve, 0));
    } finally {
      _cardFrontendEventListeners = savedListeners;
    }
    check(awaited.map(row => row[0]).join(',') === 'a,b,library', 'Tavern 事件不是全局广播');
    check(delivered.map(row => row[0]).join(',') === 'a,b,library', 'iframe 事件不是全局广播');
    return {promptMessages: messages.length, imagePrompt: true, tavernListeners: awaited.length, iframeListeners: delivered.length};
  });

  assert.deepStrictEqual(pageErrors, []);
  assert.ok(result.promptMessages > 0);
  assert.strictEqual(result.tavernListeners, 3);
  assert.strictEqual(result.iframeListeners, 3);
  await page.close();
  console.log(JSON.stringify(result));
  console.log('generation contract browser: PASS');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
