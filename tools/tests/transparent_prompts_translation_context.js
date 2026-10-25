'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const screenshotDir = String(process.env.YEYU_SCREENSHOT_DIR || '').trim();
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

  const audit = await page.evaluate(async () => {
    D = defaults();
    D.settings.translationPrompt = '用户自定义的消息翻译要求';
    D.settings.cardLocalizationPrompt = '用户自定义的角色卡汉化要求';
    D.settings.worldBookLocalizationPrompt = '用户自定义的世界书汉化要求';
    D.settings.useMemory = true;
    D.settings.maxContextTokens = 32768;
    D.settings.maxTokens = 2048;
    const char = {
      id: 'translation-context-char', name: '测试角色', description: '描述背景', personality: '性格背景', mes_example: '对话示例背景',
      scenario: '', first_mes: '', alternate_greetings: [], system_prompt: '', post_history_instructions: '',
      creator_notes: '', extensions: {}, media_assets: [], participantRegistry: []
    };
    ensureCharacterIntelligence(char);
    const session = {id: 'translation-context-session', name: '测试对话', msgs: [], nextMessageSeq: 2, memoryStore: makeEmptyMemoryStore()};
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};

    const originalRoute = resolveApiRoute;
    const originalFetch = fetchCompatibleCompletion;
    const originalSave = saveData;
    const originalRender = renderChat;
    const originalUpdateTokens = updateTokensBar;
    const bodies = [];
    resolveApiRoute = () => ({apiKey: 'local-test', apiUrl: 'https://local.invalid/v1', model: 'local-test', provider: {}});
    fetchCompatibleCompletion = async (_route, body) => {
      bodies.push(copyJsonData(body));
      let content = '译文正文';
      if (body.response_format && body.messages[1]) {
        const payload = JSON.parse(body.messages[1].content);
        content = payload.kind === 'names'
          ? JSON.stringify({labels: payload.labels.map(row => ({id: row.id, zh: '爱丽丝', strategy: 'transliteration', aliases: []}))})
          : JSON.stringify({terms: payload.terms.map(row => ({id: row.id, zh: '月亮', aliases: ['月']}))});
      }
      return {json: async () => ({choices: [{message: {content}, finish_reason: 'stop'}]})};
    };
    saveData = async () => true;
    renderChat = () => {};
    updateTokensBar = () => {};

    async function translateWith(fields) {
      Object.assign(char, fields);
      session.msgs = [{seq: 1, role: 'assistant', content: 'Foreign source text.', time: 1700000000000}];
      await translateMessage(0);
      return bodies[bodies.length - 1];
    }

    let exampleBody;
    let personalityBody;
    let descriptionBody;
    let emptyBody;
    let longBody;
    let creatorBody;
    let creatorNotesManualTranslation;
    let cardLocalizationBody;
    let worldBookLocalizationBody;
    try {
      exampleBody = await translateWith({mes_example: '示例优先标记', personality: '性格不应进入', description: '描述不应进入'});
      personalityBody = await translateWith({mes_example: '   ', personality: '性格次选标记', description: '描述不应进入'});
      descriptionBody = await translateWith({mes_example: '', personality: '', description: '描述末选标记'});
      emptyBody = await translateWith({mes_example: '', personality: '', description: ''});
      longBody = await translateWith({mes_example: '', personality: '', description: '甲'.repeat(5000)});
      char.creator_notes = 'Creator notes source';
      await translateCreatorNotesForUser(char, char.creator_notes);
      creatorBody = bodies[bodies.length - 1];
      char.creator_notes_zh = '';
      delete char.creatorNotesShownAt;
      const bodiesBeforeNotes = bodies.length;
      const notesShown = showCreatorNotesBeforeChat(char);
      // 留出足够时间，让「打开即自动翻译」这类接线真的发得出请求。
      await new Promise(resolve => setTimeout(resolve, 50));
      creatorNotesManualTranslation = {
        requestsOnOpen: bodies.length - bodiesBeforeNotes,
        statusOnOpen: document.getElementById('creator-notes-status').textContent,
        shownOnOpen: document.getElementById('creator-notes-content').textContent.trim(),
      };
      await translateCreatorNotesForDisplay();
      creatorNotesManualTranslation.requestsAfterButton = bodies.length - bodiesBeforeNotes;
      creatorNotesManualTranslation.shownAfterButton = document.getElementById('creator-notes-content').textContent.trim();
      await confirmCreatorNotes();
      creatorNotesManualTranslation.confirmed = (await notesShown) === true;
      const localizationController = new AbortController();
      await requestImportLocalization({kind: 'names', labels: [{id: 'card', text: 'Alice', kind: 'person'}]}, localizationController, 'card', {requests: 0});
      cardLocalizationBody = bodies[bodies.length - 1];
      await requestImportLocalization({kind: 'terms', terms: [{id: 'term-1', source: 'Moon'}]}, localizationController, 'worldbook', {requests: 0});
      worldBookLocalizationBody = bodies[bodies.length - 1];
    } finally {
      resolveApiRoute = originalRoute;
      fetchCompatibleCompletion = originalFetch;
      saveData = originalSave;
      renderChat = originalRender;
      updateTokensBar = originalUpdateTokens;
    }

    const store = makeEmptyMemoryStore();
    store.longTermEntries = [memoryV5NormalizeLongTerm({
      id: 'key-memory', type: 'key_event', content: '银钥匙藏在星港', subject: '测试角色', object: '银钥匙',
      importance: 5, confidence: 1, origin: 'manual', sourceStartSeq: 1, sourceEndSeq: 1, sourceHash: 'translation-context-source'
    }, session.id)];
    session.memoryStore = store;
    session.msgs = [{seq: 1, role: 'user', content: '银钥匙在哪里？', time: 1700000001000}];
    D.settings.memoryInjectPrompt = '用户自定义的记忆注入要求';
    const built = buildMessages(char, session.msgs, session, {commit: false});
    const injectIndex = built.messages.findIndex(message => message.role === 'system' && message.content === D.settings.memoryInjectPrompt);
    const memoryData = injectIndex >= 0 && built.messages[injectIndex + 1] && built.messages[injectIndex + 1].content || '';

    loadSettingsForm();
    loadMemoryManager();
    loadPromptManager();
    switchCompletionPresetTab('utility');
    const translationInput = document.getElementById('s-translation-prompt');
    const summaryInput = document.getElementById('mm-summary-prompt');
    const injectInput = document.getElementById('mm-inject-prompt');
    translationInput.value = '可忽略的自定义翻译提示词';
    summaryInput.value = '可忽略的自定义摘要提示词';
    injectInput.value = '可忽略的自定义记忆提示词';
    const customPromptValues = [translationInput.value, summaryInput.value, injectInput.value];
    const warningCases = [
      ['memorySummary', '删掉格式字段后的自由改写'],
      ['cardLocalization', '删掉角色卡协议后的自由改写'],
      ['worldBookLocalization', '删掉世界书协议后的自由改写'],
    ];
    warningCases.forEach(([key, missing]) => {
      const input = document.getElementById(promptConstraintWarningUi.specs[key].inputId);
      input.value = missing;
      input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    document.getElementById('s-api-url').value = 'https://local.invalid/v1';
    document.getElementById('s-model').value = 'local-test';
    const saveForWarnings = saveData;
    saveData = async () => true;
    await saveSettings();
    await savePromptManager();
    const settingsSavedWhileWarning = D.settings.cardLocalizationPrompt === '删掉角色卡协议后的自由改写'
      && D.settings.worldBookLocalizationPrompt === '删掉世界书协议后的自由改写';
    await saveMemoryManager();
    const memorySavedWhileWarning = D.settings.memorySummaryPrompt === '删掉格式字段后的自由改写';
    warningCases.forEach(([key]) => {
      const input = document.getElementById(promptConstraintWarningUi.specs[key].inputId);
      input.value = '';
      input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await saveSettings();
    await savePromptManager();
    await saveMemoryManager();
    loadSettingsForm();
    loadMemoryManager();
    loadPromptManager();
    switchCompletionPresetTab('utility');
    const emptyValuesAfterReload = warningCases.map(([key]) => document.getElementById(promptConstraintWarningUi.specs[key].inputId).value);
    const blankBodies = [];
    const blankFetch = fetchCompatibleCompletion;
    const blankRoute = resolveApiRoute;
    resolveApiRoute = () => ({apiKey: 'local-test', apiUrl: 'https://local.invalid/v1', model: 'local-test', provider: {}});
    fetchCompatibleCompletion = async (_route, body) => {
      blankBodies.push(copyJsonData(body));
      const payload = JSON.parse(body.messages[1].content);
      const content = payload.kind === 'names' ? JSON.stringify({labels: [{id: 'card', zh: '爱丽丝', strategy: 'transliteration', aliases: []}]}) : JSON.stringify({terms: [{id: 'term-1', zh: '月亮', aliases: []}]});
      return {json: async () => ({choices: [{message: {content}, finish_reason: 'stop'}]})};
    };
    await requestImportLocalization({kind: 'names', labels: [{id: 'card', text: 'Alice', kind: 'person'}]}, new AbortController(), 'card', {requests: 0});
    await requestImportLocalization({kind: 'terms', terms: [{id: 'term-1', source: 'Moon'}]}, new AbortController(), 'worldbook', {requests: 0});
    fetchCompatibleCompletion = blankFetch;
    resolveApiRoute = blankRoute;
    const originalStructured = requestStructuredJson;
    let blankMemoryPrompt;
    requestStructuredJson = async (prompt) => {
      blankMemoryPrompt = prompt;
      return {history_outline: '', recent_history_summary: '测试摘要', long_term_entries: []};
    };
    await requestMemoryBatchForSession(char, session, [{seq: 1, role: 'user', content: '测试消息'}], 'test', new AbortController(), {});
    requestStructuredJson = originalStructured;
    saveData = saveForWarnings;

    return {
      exampleBody, personalityBody, descriptionBody, emptyBody, longBody, creatorBody,
      creatorNotesManualTranslation,
      cardLocalizationBody, worldBookLocalizationBody,
      injection: {injectIndex, memoryData},
      customPromptValues, settingsSavedWhileWarning, memorySavedWhileWarning, emptyValuesAfterReload,
      blankLocalizationSystems: blankBodies.map(body => body.messages[0].content), blankMemoryPrompt,
      memoryRuntimeGuardsKept: ['history_outline', 'recent_history_summary', 'long_term_entries', 'story_time'].every(anchor => DEFAULT_MEMORY_SUMMARY_PROMPT.includes(anchor))
        && DEFAULT_MEMORY_INJECT_PROMPT.includes(MEMORY_INJECTION_RUNTIME_GUARD)
    };
  });

  const connector = '以上信息仅作为背景知识，供你理解接下来要翻译的当前消息。不要翻译、复述、总结或把它写入译文。';
  for (const body of [audit.exampleBody, audit.personalityBody, audit.descriptionBody, audit.emptyBody, audit.longBody]) {
    assert.strictEqual(body.messages[0].role, 'system');
    assert.strictEqual(body.messages[1].content, `${connector}\n\n用户自定义的消息翻译要求`, '衔接句必须逐字位于用户翻译提示词之前');
    assert.doesNotMatch(body.messages[1].content, /输出前按语义逐段检查/);
    assert.strictEqual(body.messages[2].role, 'user');
  }
  assert.match(audit.exampleBody.messages[0].content, /示例优先标记/);
  assert.doesNotMatch(audit.exampleBody.messages[0].content, /性格不应进入|描述不应进入/);
  assert.match(audit.personalityBody.messages[0].content, /性格次选标记/);
  assert.doesNotMatch(audit.personalityBody.messages[0].content, /描述不应进入/);
  assert.match(audit.descriptionBody.messages[0].content, /描述末选标记/);
  assert.doesNotMatch(audit.emptyBody.messages[0].content, /角色卡背景参照/);
  assert.strictEqual((audit.longBody.messages[0].content.match(/甲/g) || []).length, 5000, '超过 4000 字的 description 必须全文注入');
  assert.doesNotMatch(audit.longBody.messages[0].content, /已截断|内容过长/);
  assert.doesNotMatch(audit.exampleBody.messages[0].content, /以下描述仅供理解|以下对话示例仅供理解|不要翻译、复述、总结或把它写入译文/);
  assert.doesNotMatch(JSON.stringify(audit.creatorBody), /示例优先标记|性格次选标记|描述末选标记|角色卡背景参照/, '作者注记翻译不得注入角色卡背景');
  assert.strictEqual(audit.creatorNotesManualTranslation.requestsOnOpen, 0, '进入聊天前展示作者注记不得自行调用翻译接口');
  assert.strictEqual(audit.creatorNotesManualTranslation.shownOnOpen, 'Creator notes source', '刚打开时必须显示清洗后的原文');
  assert.match(audit.creatorNotesManualTranslation.statusOnOpen, /点「翻译为中文」后才会调用翻译接口/, '状态行必须说明翻译需要用户主动点按钮');
  assert.strictEqual(audit.creatorNotesManualTranslation.requestsAfterButton, 1, '点击“翻译为中文”后才允许发出一次翻译请求');
  assert.strictEqual(audit.creatorNotesManualTranslation.shownAfterButton, '译文正文', '点击后必须把译文显示出来');
  assert.strictEqual(audit.creatorNotesManualTranslation.confirmed, true, '确认作者注记后必须放行进入聊天');
  assert.strictEqual(audit.cardLocalizationBody.messages[0].content, '用户自定义的角色卡汉化要求', '角色卡汉化请求不得静默追加协议');
  assert.strictEqual(audit.worldBookLocalizationBody.messages[0].content, '用户自定义的世界书汉化要求', '世界书汉化请求不得静默追加协议');
  assert.doesNotMatch(JSON.stringify([audit.cardLocalizationBody, audit.worldBookLocalizationBody]), /夜欲批量术语 JSON 协议|强制最新格式/);
  assert(audit.injection.injectIndex >= 0, '自定义记忆注入提示词必须原样进入请求');
  assert.match(audit.injection.memoryData, /银钥匙藏在星港/, '记忆数据应放在独立 system 消息中');
  assert.doesNotMatch(audit.injection.memoryData, /用户自定义的记忆注入要求/);
  assert.deepStrictEqual(audit.customPromptValues, ['可忽略的自定义翻译提示词', '可忽略的自定义摘要提示词', '可忽略的自定义记忆提示词']);
  assert.strictEqual(audit.settingsSavedWhileWarning, true, '设置页与预设辅助页在警告状态下仍必须正常保存');
  assert.strictEqual(audit.memorySavedWhileWarning, true, '记忆整理警告状态下仍必须正常保存');
  assert.deepStrictEqual(audit.emptyValuesAfterReload, ['', '', ''], '三处提示词清空保存并重载后必须保持为空');
  assert.deepStrictEqual(audit.blankLocalizationSystems, ['', ''], '角色卡和世界书汉化提示词清空后实际请求不得补回默认值');
  assert.strictEqual(audit.blankMemoryPrompt, '', '记忆整理提示词清空后实际请求不得补回默认值');
  assert.strictEqual(audit.memoryRuntimeGuardsKept, true, '记忆默认提示词正文中的运行约束必须保留');
  assert.deepStrictEqual(pageErrors, [], `页面脚本错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, {recursive:true});
    await page.evaluate(() => { const toasts=document.getElementById('toasts');if(toasts)toasts.innerHTML='';openModal('settings-modal');switchSettingsTab('translation'); });
    await page.waitForFunction(() => document.getElementById('settings-modal').classList.contains('open') && getComputedStyle(document.getElementById('st-translation')).display !== 'none');
    await page.waitForTimeout(250);
    await page.screenshot({path:path.join(screenshotDir, 'translation-format-warnings-390x844.png')});
    await page.evaluate(() => { closeModal('settings-modal'); openModal('memory-manager-modal'); });
    await page.waitForFunction(() => document.getElementById('memory-manager-modal').classList.contains('open'));
    await page.waitForTimeout(250);
    await page.screenshot({path:path.join(screenshotDir, 'memory-format-warning-390x844.png')});
  }
  console.log(JSON.stringify({
    transparentPrompts: true,
    translationRequestEvidence: audit.longBody.messages.map((message, index) => ({
      index, role: message.role, characters: message.content.length,
      headings: message.content.match(/^\[[^\]\r\n]+\]/gm) || [],
      connectorFirst: index === 1 ? message.content.startsWith(connector) : undefined,
      userPromptLast: index === 1 ? message.content.endsWith('用户自定义的消息翻译要求') : undefined,
    })),
    translationContextPriority: ['mes_example', 'personality', 'description'],
    longDescriptionCharacters: 5000,
    localizationRequestEvidence: {
      cardSystem: audit.cardLocalizationBody.messages[0].content,
      worldBookSystem: audit.worldBookLocalizationBody.messages[0].content,
      protocolPresent: /夜欲批量术语 JSON 协议|强制最新格式/.test(JSON.stringify([audit.cardLocalizationBody, audit.worldBookLocalizationBody])),
    },
    warningSaveAllowed: true,
    emptyPromptRoundTripAndRequests: true,
    memoryRuntimeGuardsKept: true,
    viewport: '390x844',
  }));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
