/* global runStscript -- Browser fixture attached to the loaded application page. */
'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');

const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;
let expectedStorageFailure = false;

(async () => {
  server = createAssetServer(assets);
  const port = await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage();
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {
    ignoreFavicon: true,
    appendUrl: true,
    ignoreConsoleError: message => expectedStorageFailure && message.text().includes('IndexedDB 写入失败，使用恢复快照'),
  });
  const requests = [];
  let modelResponseContent = '模型回复';
  let holdGeneration = false;
  let releaseGeneration;
  let signalGenerationRouteEntered;
  let generationRouteEntered = Promise.resolve();
  await page.route('https://stscript.test/**', async route => {
    requests.push(route.request().postDataJSON());
    if (holdGeneration) {
      signalGenerationRouteEntered();
      await new Promise(resolve => { releaseGeneration = resolve; });
    }
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({choices: [{message: {content: modelResponseContent}, finish_reason: 'stop'}]})});
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);
  // Bootstrap emits one welcome toast for the empty initial account; wait for its real lifecycle before dry-run observation.
  const welcomeToast = page.locator('#toasts .toast').filter({hasText: '欢迎使用夜欲'});
  await welcomeToast.waitFor({state: 'visible', timeout: 10000});
  await welcomeToast.waitFor({state: 'detached', timeout: 10000});
  await page.evaluate(async () => {
    D = defaults();
    const char = parseCard({spec: 'chara_card_v2', spec_version: '2.0', data: {name: 'Prompt 命令测试', description: '角色描述', first_mes: '你好'}});
    char.id = 'stscript-prompt-char';
    const session = createBlankSession('STScript prompt commands', 'stscript-prompt-session');
    session.msgs = [{role: 'user', seq: 1, content: '原始问题'}, {role: 'assistant', seq: 2, content: '先前回答', reasoning: '旧思考'}, {role: 'assistant', seq: 3, content: '末条', reasoning: '末条思考'}];
    session.nextMessageSeq = 4;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
    Object.assign(D.settings.providers[0], {id: 'p1', name: '主接口', apiUrl: 'https://stscript.test/v1', apiKey: 'synthetic-key', model: 'm1', models: ['m1'], enabled: true});
    D.settings.providers = [D.settings.providers[0], {id: 'p2', name: '备用接口', apiUrl: 'https://stscript.test/v1', apiKey: 'synthetic-key-2', model: 'm2', models: ['m2'], enabled: true}];
    D.settings.activeProviderId = 'p1';
    D.settings.modelPresets = [{id: 'routes', name: '路由', routes: {
      translation: {providerId: 'p1', model: 'translation-model'},
      memorySummary: {providerId: 'p1', model: 'summary-model'},
    }}];
    D.settings.activeModelPresetId = 'routes';
    const promptPreset = presetRawDefault();
    promptPreset.prompts = Array.isArray(promptPreset.prompts) ? promptPreset.prompts : [];
    if (!promptPreset.prompts.some(row => row.identifier === 'main'))
      promptPreset.prompts.push({identifier: 'main', name: '主提示词', content: '{{char}}'});
    promptPreset.prompt_order = Array.isArray(promptPreset.prompt_order) ? promptPreset.prompt_order : [];
    let mainOrder = promptPreset.prompt_order.find(row => row.character_id === 100001);
    if (!mainOrder) promptPreset.prompt_order.push(mainOrder = {character_id: 100001, order: []});
    mainOrder.order = Array.isArray(mainOrder.order) ? mainOrder.order : [];
    if (!mainOrder.order.some(row => row.identifier === 'main')) mainOrder.order.push({identifier: 'main', enabled: true});
    D.settings.chatCompletionPresets = [{name: '测试预设', preset: promptPreset}];
    D.settings.activeChatCompletionPresetName = '测试预设';
    D.settings.chatCompletionPresetInUse = structuredClone(promptPreset);
    D.settings.systemPromptProfiles = [{id: 'sp1', name: '系统档一', content: '档案系统', postHistory: '档案后置'}, {id: 'sp2', name: '系统档二', content: '备用系统', postHistory: ''}];
    D.settings.activeSystemPromptProfileId = 'sp1';
    D.settings.systemPromptEnabled = true;
  D.settings.reasoningTemplates = [{id: 'rt1', name: '自定义标签', prefix: '<r>', suffix: '</r>', separator: '\n--\n'}];
    D.settings.regexScripts = [{id: 'stscript-prompt-regex', name: 'STScript prompt regex', placement: [3, 6], findRegex: '/分析/g', replaceString: '已整理分析'}];
    D.settings.systemPromptProfiles[0].unknownField = {preserved: true};
    D.settings.reasoningTemplates[0].unknownField = {preserved: true};
    D.settings.activeReasoningTemplateId = 'rt1';
    D.settings.customStoppingStrings = [];
    D.settings.startReplyWith = '';
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    updateChatUI();
    renderChat();
    window.runStscript = async text => (await executeStscript(text, {handleParserErrors: false, handleExecutionErrors: false})).pipe;
  });

  const run = async text => page.evaluate(text => runStscript(text), text);
  const aliases = [
    ['prompt', 'input'],
    ['server', 'api-url'], ['ppp', 'prompt-post-processing'], ['custom-stop-strings', 'stop-strings'],
    ['getpromptentries', 'getpromptentry'], ['setpromptentries', 'setpromptentry'], ['system-prompt', 'sysprompt'],
    ['depth', 'note-depth'], ['flushinjects', 'flushinject'], ['secret-rotate', 'secret-id'],
    ['get-reasoning', 'reasoning-get'], ['collapse-reasoning', 'reasoning-collapse'],
    ['expand-reasoning', 'reasoning-expand'], ['toggle-reasoning', 'reasoning-toggle'],
    ['format-reasoning', 'reasoning-format'], ['generate-stop', 'stop'],
  ];
  assert.deepStrictEqual(await page.evaluate(rows => rows.map(([alias, primary]) =>
    [alias, Boolean(STSCRIPT_COMMANDS[alias] && STSCRIPT_COMMANDS[alias] === STSCRIPT_COMMANDS[primary])]), aliases),
  aliases.map(([alias]) => [alias, true]), '兼容别名必须映射到同一个命令定义');
  assert.deepStrictEqual(await page.evaluate(() => {
    const system = D.settings.systemPromptProfiles[0], reasoning = D.settings.reasoningTemplates[0];
    stscriptPromptSettings();
    return {systemSame: D.settings.systemPromptProfiles[0] === system,
      reasoningSame: D.settings.reasoningTemplates[0] === reasoning,
      systemField: system.unknownField, reasoningField: reasoning.unknownField};
  }), {systemSame: true, reasoningSame: true, systemField: {preserved: true}, reasoningField: {preserved: true}},
  '提示词规范化需保留未知字段及对象身份');
  assert.deepStrictEqual(await page.evaluate(() => {
    const templates = D.settings.reasoningTemplates;
    D.settings.reasoningTemplates = [null, []];
    stscriptPromptSettings();
    const normalized = {length: D.settings.reasoningTemplates.length, id: D.settings.reasoningTemplates[0].id};
    D.settings.reasoningTemplates = templates;
    D.settings.activeReasoningTemplateId = templates[0].id;
    return normalized;
  }), {length: 1, id: 'reasoning_think'}, '无效推理模板记录应归一到默认模板');
  assert.strictEqual(await run('/api'), '主接口');
  assert.strictEqual(await run('/api 备用接口'), '备用接口');
  assert.strictEqual(await run('/model m2-plus'), 'm2-plus');
  assert.strictEqual(await run('/api-url https://stscript.test/v2/'), 'https://stscript.test/v2');
  assert.strictEqual(await run('/ppp strict'), 'strict');
  assert.strictEqual(await run('/stop-strings ["END",42]'), '["END","42"]');
  assert.strictEqual(await run('/custom-stopping-strings'), '["END","42"]');
  assert.strictEqual(await run('/start-reply-with 好的，'), '好的，');
  assert.strictEqual(await run('/start-reply-with force=true {{noop}}'), '');
  const secretId = await run('/secret-write label=临时密钥 synthetic-secret');
  assert.match(secretId, /^key_/);
  assert.strictEqual(await run('/secret-read 临时密钥'), 'synthetic-secret');
  assert.strictEqual(await run('/secret-rename id=' + secretId + ' 改名密钥'), secretId);
  assert.strictEqual(await run('/secret-read 改名密钥'), 'synthetic-secret');
  const secondSecretId = await run('/secret-write label=备用密钥 second-secret');
  assert.strictEqual(await run('/secret-id 改名密钥'), secretId);
  assert.strictEqual(await run('/secret-id'), secretId, 'secret-id 应切换并读取当前活动密钥');
  assert.strictEqual(await run('/secret-id 备用密钥'), secondSecretId);
  assert.strictEqual(await run('/secret-id'), secondSecretId);
  assert.strictEqual(await run('/secret-delete ' + secretId), secretId);
  assert.strictEqual(await run('/secret-read ' + secretId), '');

  assert.strictEqual(await run('/note 保持克制'), '保持克制');
  assert.strictEqual(await run('/depth -3'), '3');
  assert.strictEqual(await run('/freq 0'), '0');
  assert.strictEqual(await run('/note-frequency 0'), '0');
  assert.strictEqual(await run('/note-frequency -4'), '4');
  assert.strictEqual(await run('/note-frequency 0'), '0');
  assert.strictEqual(await run('/pos before_scenario'), 'before_scenario');
  assert.strictEqual(await run('/note-role assistant'), 'assistant');
  await page.evaluate(() => loadPromptManager());
  assert.deepStrictEqual(await page.evaluate(() => ({..._completionPresetNoteDraft})), {
    authorsNote: '保持克制', anDepth: 3, anFreq: 0, authorNotePosition: 'before', authorNoteRole: 'assistant',
  }, '作者注命令需同步提示词管理器草稿属主');
  assert.strictEqual(await run('/setpromptentry identifier=main off'), '');
  assert.strictEqual(await run('/getpromptentry identifier=main'), 'false');
  assert.strictEqual(await page.evaluate(() => {
    const row = _completionPresetDraftRows[0].preset.prompt_order.find(item => item.character_id === 100001);
    return row.order.find(item => item.identifier === 'main').enabled;
  }), false,
    '预设命令需同步真实提示词管理器草稿');
  assert.strictEqual(await run('/preset 未知预设'), '测试预设');
  assert.strictEqual(await run('/preset 测试预设'), '测试预设');

  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    const originalSetItem = Storage.prototype.setItem;
    let writes = 0;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'app_meta') {
        writes++;
        throw new DOMException('synthetic IndexedDB transaction failure', 'QuotaExceededError');
      }
      return originalPut.apply(this, arguments);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === FALLBACK_KEY) throw new DOMException('synthetic recovery snapshot failure', 'QuotaExceededError');
      return originalSetItem.apply(this, arguments);
    };
    window.__restoreFailedStorage = () => {
      IDBObjectStore.prototype.put = originalPut;
      Storage.prototype.setItem = originalSetItem;
      return writes;
    };
  });
  expectedStorageFailure = true;
  const failedCommand = await page.evaluate(async () => {
    try {
      await executeStscript('/setpromptentry identifier=main on', {handleParserErrors: false, handleExecutionErrors: false});
      return {failed: false};
    } catch (error) {
      return {failed: true, name: error.name, message: error.message, storageError: _storageHealth.lastError};
    }
  });
  const failedWrites = await page.evaluate(() => window.__restoreFailedStorage());
  expectedStorageFailure = false;
  assert.strictEqual(failedCommand.failed, true, '真实 IndexedDB 与恢复快照同时失败时命令必须拒绝');
  assert.strictEqual(failedCommand.name, 'StscriptExecutionError');
  assert.ok(failedWrites > 0, '保存失败构造必须触达真实 app_meta IndexedDB object store');
  assert.deepStrictEqual(await page.evaluate(() => ({
    inUse: D.settings.chatCompletionPresetInUse.prompt_order.find(item => item.character_id === 100001).order.find(item => item.identifier === 'main').enabled,
    saved: D.settings.chatCompletionPresets[0].preset.prompt_order.find(item => item.character_id === 100001).order.find(item => item.identifier === 'main').enabled,
    draft: _completionPresetDraftRows[0].preset.prompt_order.find(item => item.character_id === 100001).order.find(item => item.identifier === 'main').enabled,
  })), {inUse: false, saved: false, draft: false}, 'IndexedDB 写入失败必须回滚设置、具名预设和面板草稿');

  const dryRun = await page.evaluate(async () => {
    const before = {note: D.settings.authorsNote, model: D.settings.providers.find(row => row.id === D.settings.activeProviderId).model};
    const notes = [];
    const execute = text => executeStscript(text, {abortController: stscriptDryRunController(notes), handleParserErrors: false, handleExecutionErrors: false});
    const write = await execute('/note 干跑不得写入');
    const model = await execute('/model 干跑模型');
    const generated = await execute('/profile-genstream 干跑问题');
    return {before, after: {note: D.settings.authorsNote, model: D.settings.providers.find(row => row.id === D.settings.activeProviderId).model}, write: write.pipe, modelPipe: model.pipe, generated: generated.pipe};
  });
  assert.deepStrictEqual(dryRun.before, dryRun.after, '预览中写类 prompt/provider 命令不得改真实设置');
  assert.strictEqual(dryRun.write, '');
  assert.strictEqual(dryRun.modelPipe, '');
  assert.match(dryRun.generated, /预览未执行/);
  await run('/getchatbook');
  const requestCountBeforeDrySweep = requests.length;
  await page.evaluate(() => {
    const original = saveData, originalToast = toast;
    window.__dryRunStorageWrites = 0;
    window.__dryRunToastCalls = 0;
    window.__dryRunToastArgs = [];
    window.__restoreDryRunStorageObserver = () => { saveData = original; toast = originalToast; };
    saveData = function() { window.__dryRunStorageWrites++; return original.apply(this, arguments); };
    toast = function() { window.__dryRunToastCalls++; window.__dryRunToastArgs.push(Array.from(arguments)); return originalToast.apply(this, arguments); };
  });
  const drySweep = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id), input = document.getElementById('user-input');
    const effects = () => JSON.stringify({
      data: D, input: input && input.value,
      toastCalls: window.__dryRunToastCalls,
      dialogs: [...document.querySelectorAll('.modal.open')].map(node => node.id),
      scriptLoaders: [...document.querySelectorAll('.script-loader-panel')].map(node => node.textContent),
    });
    const notes = [];
    const commands = new Set(Object.values(STSCRIPT_COMMANDS));
    let checked = 0;
    for (const command of commands) {
      for (const args of ['', ' 0', ' return=chat-html 0']) {
        const before = effects();
        const text = '/' + command.name + args;
        window.__stscriptDryRunCommand = text;
        let timeout;
        try {
          await Promise.race([
            executeStscript(text, {abortController: stscriptDryRunController(notes), handleParserErrors: false, handleExecutionErrors: false}),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('dry-run command timeout')), 5000); }),
          ]);
        } catch (error) {
          if (error.message === 'dry-run command timeout') throw new Error(text + ' 干跑超时');
        }
        clearTimeout(timeout);
        const after = effects();
        if (after !== before) {
          const left = JSON.parse(before), right = JSON.parse(after);
          const changed = Object.keys(left).filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
          throw new Error('/' + command.name + args + ' 在预览中产生了副作用: ' + JSON.stringify(changed.map(key => [key, left[key], right[key]])).slice(0, 1200));
        }
        checked++;
      }
    }
    return {checked, commandCount: commands.size};
  });
  assert.strictEqual(drySweep.checked, drySweep.commandCount * 3,
    '所有注册命令的三种参数形态都应经过真实 executeStscript 干跑');
  assert.strictEqual(requests.length, requestCountBeforeDrySweep, '完整 dry-run 命令扫描不得发出模型请求');
  assert.strictEqual(await page.evaluate(() => window.__dryRunStorageWrites), 0, '所有干跑命令都不得调用持久化');
  assert.strictEqual(await page.evaluate(() => window.__dryRunToastCalls), 0, '所有干跑命令都不得调用toast');

  const focusedDryRun = await page.evaluate(async () => {
    const session = getActiveSession(getChar().id), input = document.getElementById('user-input'), beforeMessages = session.msgs.length;
    D.settings.quickReply = {sets: [{name: '常用', qrList: [{id: 1, label: '打招呼', message: '你好'}]}], globalSetNames: ['常用'], enabled: true, characterLinks: {}};
    input.value = '';
    const notes = [], dry = async text => (await executeStscript(text, {abortController: stscriptDryRunController(notes), handleParserErrors: false, handleExecutionErrors: false})).pipe;
    const closure = await dry('/let greet {: /setvar key=probe 1 | /getvar probe :} | /run greet');
    const qr = await dry('/run 打招呼');
    const regex = await dry('/regex name=不存在 原文');
    const dryWrites = window.__dryRunStorageWrites, dryToasts = window.__dryRunToastCalls;
    const readOnly = [];
    for (const text of ['/messages 0', '/count', '/getchatbook', '/note', '/model', '/listvar', '/listinjects return=object']) {
      const preview = await dry(text);
      const actual = (await executeStscript(text, {handleParserErrors: false, handleExecutionErrors: false})).pipe;
      readOnly.push({text, preview, actual});
    }
    return {closure, qr, regex, dryWrites, dryToasts, readOnly, input: input.value, messagesUnchanged: session.msgs.length === beforeMessages,
      probe: session.stscriptVars && session.stscriptVars.probe};
  });
  assert.strictEqual(focusedDryRun.closure, '1', '预览内 /run 必须逐命令干跑闭包');
  assert.strictEqual(focusedDryRun.qr, '', '预览不能执行快捷回复');
  assert.strictEqual(focusedDryRun.regex, '原文', '缺失正则名称的预览保留原文');
  assert.deepStrictEqual(focusedDryRun.readOnly.map(row => [row.text, row.preview, row.actual]), focusedDryRun.readOnly.map(row => [row.text, row.actual, row.actual]),
    '7个只读命令的预览结果必须与实发一致');
  assert.deepStrictEqual({input: focusedDryRun.input, probe: focusedDryRun.probe, messagesUnchanged: focusedDryRun.messagesUnchanged},
    {input: '', probe: undefined, messagesUnchanged: true}, '预览不得改输入框、变量或发送消息');
  assert.strictEqual(focusedDryRun.dryWrites, 0, '聚焦干跑不得调用持久化');
  assert.strictEqual(focusedDryRun.dryToasts, 0, '聚焦干跑不得调用toast');
  await page.evaluate(() => window.__restoreDryRunStorageObserver());
  const requestCountBeforeQuickReply = requests.length;
  await run('/run 打招呼');
  assert.strictEqual(requests.length, requestCountBeforeQuickReply + 1, '真实 /run Quick Reply 应实际发送消息并进入真实生成请求');
  assert.ok(await page.evaluate(() => getActiveSession(getChar().id).msgs.some(message => message.role === 'user' && message.content === '你好')));

  assert.strictEqual(await run('/sysprompt'), '系统档一');
  assert.strictEqual(await run('/sysprompt-off'), '');
  assert.strictEqual(await run('/sysprompt 系统档二'), '');
  assert.strictEqual(await page.evaluate(() => D.settings.activeSystemPromptProfileId), 'sp1', '关闭态不能切换系统提示词');
  assert.strictEqual(await page.evaluate(async () => {
    let writes = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value) { if (this.name === 'app_meta') writes++; return original.apply(this, arguments); };
    try { await runStscript('/sysprompt 系统档二'); } finally { IDBObjectStore.prototype.put = original; }
    return writes;
  }), 0, '关闭状态选择系统提示词不能触发保存');
  assert.strictEqual(await run('/sysprompt forceGet=true'), '系统档一');
  assert.strictEqual(await run('/sysprompt-on'), '');
  assert.strictEqual(await run('/sysprompt-state'), 'true');
  assert.strictEqual(await run('/sysprompt-state false'), 'false');
  assert.strictEqual(await page.evaluate(() => stscriptActiveSystemPromptProfile()), null);
  assert.strictEqual(await run('/sysprompt-on'), '');
  assert.strictEqual(await run('/reasoning-parse <r>分析</r>正文'), '已整理分析');
  assert.strictEqual(await run('/reasoning-parse regex=false <r>分析</r>正文'), '分析');
  assert.strictEqual(await run('/reasoning-parse return=content <r>分析</r>正文'), '正文');
  assert.strictEqual(await page.evaluate(async () => {
    const template = D.settings.reasoningTemplates[0], prefix = template.prefix;
    template.prefix = '';
    try { return await runStscript('/reasoning-parse 原样内容'); } finally { template.prefix = prefix; }
  }), '原样内容', '没有模板标签时原文保持不变');
  assert.strictEqual(await run('/reasoning-set at=1 collapse=true 新思考'), '新思考');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).msgs[1].reasoningCollapsed), true);
  assert.strictEqual(await run('/reasoning-format reasoning=分析 正文'), '<r>分析</r>\n--\n正文');

  await page.evaluate(() => { window.__sysgenPopup = runStscript('/sysgen return=popup-html 描述天气').catch(error => ({name: error.name, message: error.message, stack: error.stack})); });
  const sysgenDialog = page.getByRole('dialog', {name: '系统消息'});
  const popupOpened = await sysgenDialog.waitFor({timeout: 5000}).then(() => true, () => false);
  if (!popupOpened) throw new Error('sysgen popup did not open: ' + JSON.stringify(await page.evaluate(() => window.__sysgenPopup)));
  assert.match(await sysgenDialog.locator('.modal-body').innerText(), /模型回复/);
  await sysgenDialog.getByRole('button', {name: '确定'}).click();
  assert.strictEqual(await page.evaluate(() => window.__sysgenPopup), '');
  const toastsBeforeSysgen = await page.locator('#toasts .toast').count();
  assert.strictEqual(await run('/sysgen return=toast-html 描述天气'), '');
  await page.locator('#toasts .toast').filter({hasText: '模型回复'}).last().waitFor();
  assert.ok(await page.locator('#toasts .toast').count() >= toastsBeforeSysgen + 1);
  const sysgenToast = await page.locator('#toasts .toast').filter({hasText: '模型回复'}).last().evaluate(node => ({text: node.textContent, className: node.className}));
  assert.deepStrictEqual(sysgenToast, {text: '模型回复', className: 'toast info'});
  const messageCountBeforeSysgen = await page.evaluate(() => getActiveSession(getChar().id).msgs.length);
  assert.strictEqual(await run('/sysgen return=chat-html 描述天气'), '');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).msgs.length), messageCountBeforeSysgen + 2);
  assert.deepStrictEqual(await page.evaluate(() => {
    const message = getActiveSession(getChar().id).msgs.at(-1);
    return {role: message.role, content: message.content, kind: message.kind, compact: message.compact,
      excludeFromMemory: message.excludeFromMemory, excludeFromWorldBook: message.excludeFromWorldBook};
  }), {role: 'system', content: '模型回复', kind: 'stscript-system', compact: true,
    excludeFromMemory: true, excludeFromWorldBook: true});
  assert.strictEqual(await run('/sysname 叙述者'), '');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).narratorName), '叙述者');
  modelResponseContent = '分析';
  assert.strictEqual(await run('/sysgen return=pipe 描述天气'), '已整理分析');
  const sysgenObject = JSON.parse(await run('/sysgen return=object 描述天气'));
  assert.deepStrictEqual({content: sysgenObject.content, kind: sysgenObject.kind, speaker: sysgenObject.speaker},
    {content: '已整理分析', kind: 'stscript-system', speaker: '叙述者'});
  for (const [source, expected] of [
    ['完整一句。下一句还没完', '完整一句。'], ['Hello! unfinished', 'Hello!'], ['没有句号  ', '没有句号'], ['完成😀剩余', '完成😀'],
  ]) {
    modelResponseContent = source;
    assert.strictEqual(await run('/sysgen trim=true return=pipe 描述天气'), expected);
  }
  modelResponseContent = '完整一句。下一句还没完';
  assert.strictEqual(await run('/sysgen trim=false return=pipe 描述天气'), '完整一句。下一句还没完');
  modelResponseContent = '模型回复';
  assert.strictEqual(await run('/stop'), 'false');

  assert.strictEqual(await run('/genraw system=系统 prefill=前缀 stop=["END"] 原始问题'), '模型回复');
  assert.deepStrictEqual(requests.at(-1).messages, [{role: 'system', content: '系统'}, {role: 'user', content: '原始问题'}, {role: 'assistant', content: '前缀'}]);
  assert.deepStrictEqual(requests.at(-1).stop, ['END']);
  assert.strictEqual(await run('/genraw as=char 角色口吻'), '模型回复');
  assert.deepStrictEqual(requests.at(-1).messages, [{role: 'user', content: '角色口吻'}]);
  assert.strictEqual(await run('/translate target=日语 待翻译'), '模型回复');
  assert.ok(requests.at(-1).messages.some(message => message.content.includes('待翻译')));
  assert.strictEqual(requests.at(-1).model, 'translation-model', '翻译须使用真实任务路由');
  await page.evaluate(() => {
    D.settings.autoSummaryEvery = 9999;
    getActiveSession(getChar().id).memoryStore = makeEmptyMemoryStore();
    getActiveSession(getChar().id).memoryStore.historySummary = {sourceStartSeq: 1, sourceEndSeq: 2, text: '聊天摘要'};
  });
  assert.strictEqual(await run('/summarize'), '聊天摘要', '没有待压缩历史时返回现有摘要');
  assert.strictEqual(await run('/summarize 要点一和要点二'), '模型回复');
  assert.strictEqual(requests.at(-1).model, 'summary-model', '文本总结须使用 memorySummary 任务路由');
  assert.deepStrictEqual(requests.at(-1).messages.map(message => message.content), [
    '请忠实总结以下内容，保留重要事实、关系和未完成事项。', '要点一和要点二',
  ]);
  assert.strictEqual(await run('/reasoning-collapse 1'), '');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).msgs[1].reasoningCollapsed), true);
  assert.strictEqual(await run('/reasoning-expand 1-2'), '');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).msgs[1].reasoningCollapsed), false);
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).msgs[2].reasoningCollapsed), false);
  assert.strictEqual(await run('/toggle-reasoning 1'), '');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).msgs[1].reasoningCollapsed), true);

  const profileName = await run('/profile-create 临时连接');
  assert.strictEqual(profileName, '临时连接');
  assert.ok(JSON.parse(await run('/profile-list')).includes('临时连接'));
  assert.strictEqual(JSON.parse(await run('/profile-get 临时连接')).routes.chat.providerId, 'p2');
  await run('/profile 临时连接');
  assert.strictEqual(await page.evaluate(() => resolveApiRoute('chat').providerId), 'p2');
  const savedConnectionRoute = await page.evaluate(() => structuredClone(D.settings.modelPresets.find(row => row.name === '临时连接').routes.chat));
  await page.evaluate(() => { D.settings.activeProviderId = 'p1'; });
  assert.strictEqual(await page.evaluate(() => resolveApiRoute('chat').providerId), 'p2');
  assert.strictEqual(await run('/model'), savedConnectionRoute.model);
  assert.strictEqual(await run('/model m2-profile'), 'm2-profile');
  assert.strictEqual(await page.evaluate(() => D.settings.activeConnectionProfileId), '');
  assert.strictEqual(await page.evaluate(() => D.settings.activeProviderId), 'p2');
  assert.strictEqual(await page.evaluate(() => resolveApiRoute('chat').model), 'm2-profile');
  assert.deepStrictEqual(await page.evaluate(() => D.settings.modelPresets.find(row => row.name === '临时连接').routes.chat), savedConnectionRoute);
  assert.strictEqual(await run('/api openai'), '备用接口');
  assert.strictEqual(await run('/profile <None>'), '<None>');
  assert.strictEqual(await run('/profile'), '<None>');
  assert.strictEqual(await page.evaluate(() => resolveApiRoute('chat').providerId), 'p2');
  await run('/profile 临时连接');
  assert.strictEqual(await run('/api 主接口'), '主接口');
  assert.strictEqual(await page.evaluate(() => D.settings.activeConnectionProfileId), '');
  assert.strictEqual(await page.evaluate(() => resolveApiRoute('chat').providerId), 'p1');
  assert.deepStrictEqual(await page.evaluate(() => D.settings.modelPresets.find(row => row.name === '临时连接').routes.chat), savedConnectionRoute);
  assert.strictEqual(await run('/model m1-profile'), 'm1-profile');
  await run('/profile 临时连接');
  assert.strictEqual(await run('/profile-update'), '临时连接');
  assert.strictEqual(await page.evaluate(() => resolveApiRoute('chat').model), 'm2-profile');

  assert.deepStrictEqual(await page.evaluate(async () => {
    const data = (await YeyuRepository.load()).data;
    return {
      activeProviderId: data.settings.activeProviderId,
      activeProfileMatches: data.settings.activeConnectionProfileId === data.settings.modelPresets.find(row => row.name === '临时连接').id,
      note: data.settings.authorsNote,
      frequency: data.settings.anFreq,
      profile: data.settings.modelPresets.find(row => row.name === '临时连接').routes.chat,
    };
  }), {
    activeProviderId: 'p1', activeProfileMatches: true, note: '保持克制', frequency: 0,
    profile: {providerId: 'p2', model: 'm2-profile'},
  }, 'provider、作者注与连接配置命令写入真实仓储');

  assert.strictEqual(await run('/inject id=prompt-test position=chat depth=2 role=user scan=true 测试注入'), 'prompt-test');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).promptInjections['prompt-test'].content), '测试注入');
  await run('/inject id=filtered filter={: /return true :} 过滤注入');
  const listed = JSON.parse(await run('/listinjects return=object'));
  assert.deepStrictEqual(listed['prompt-test'], {value: '测试注入', position: 1, depth: 2, scan: true, role: 1, filter: null});
  await page.evaluate(() => { window.__listPopup = runStscript('/listinjects'); });
  const listDialog = page.getByRole('dialog', {name: '脚本注入'});
  await listDialog.waitFor();
  assert.match(await listDialog.locator('.modal-body').innerText(), /prompt-test/);
  await listDialog.getByRole('button', {name: '确定'}).click();
  assert.strictEqual(await page.evaluate(() => window.__listPopup), '');
  assert.strictEqual(await run('/listinjects return=none'), '');
  assert.strictEqual(await run('/listinjects return=toast-html'), '');
  await page.locator('#toasts .toast').filter({hasText: '脚本注入'}).last().waitFor();
  const listToast = await page.locator('#toasts .toast').filter({hasText: '脚本注入'}).last().evaluate(node => ({text: node.textContent, className: node.className}));
  assert.match(listToast.text, /prompt-test: 测试注入/);
  assert.ok(listToast.className.split(/\s+/).includes('info'));
  const listChatBefore = await page.evaluate(() => getActiveSession(getChar().id).msgs.length);
  await run('/listinjects return=chat-html');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).msgs.length), listChatBefore + 1);
  assert.deepStrictEqual(await page.evaluate(() => {
    const message = getActiveSession(getChar().id).msgs.at(-1);
    return {role: message.role, content: message.content, kind: message.kind, compact: message.compact,
      excludeFromMemory: message.excludeFromMemory, excludeFromWorldBook: message.excludeFromWorldBook};
  }), {role: 'system', content: '脚本注入：\n- prompt-test: 测试注入 (IN_CHAT, depth: 2, scan: true, role: 1)\n- filtered: 过滤注入 (IN_PROMPT, depth: 4, scan: false, role: 0)',
    kind: 'stscript-system', compact: true, excludeFromMemory: true, excludeFromWorldBook: true});
  const filter = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id), key = hostPromptKey(char.id, session.id, 'filtered');
    return {key, result: await _hostPromptFilters.get(key).filter()};
  });
  assert.strictEqual(filter.result, true);
  await run('/flushinject filtered');
  await page.evaluate(() => {
    getActiveSession(getChar().id).stscriptVars = {n: 5};
    D.settings.stscript.globalVars = {g: 1};
  });
  await run('/let outer 0 | /inject id=counted filter={: /incvar n | /incglobalvar g | /var outer 1 | /if left={{getvar::n}} rule=eq right=6 else={: /pass false :} {: /pass true :} :} 计数过滤');
  const closureState = await page.evaluate(async () => {
    const key = hostPromptKey(getChar().id, getActiveSession(getChar().id).id, 'counted');
    const countedFilter = _hostPromptFilters.get(key).filter, notes = [];
    const first = await countedFilter(notes), second = await countedFilter(notes);
    return {first, second, notes, n: getActiveSession(getChar().id).stscriptVars.n, g: D.settings.stscript.globalVars.g};
  });
  assert.deepStrictEqual(closureState, {first: true, second: true, notes: ['卡片脚本自行生成的随机数和时间，发送时可能与预览不同。'], n: 5, g: 1}, '每次过滤预览从新变量快照运行且不写回');
  assert.strictEqual(await page.evaluate(async () => {
    const key = hostPromptKey(getChar().id, getActiveSession(getChar().id).id, 'counted');
    return _hostPromptFilters.get(key).filter();
  }), true);
  assert.deepStrictEqual(await page.evaluate(() => [getActiveSession(getChar().id).stscriptVars.n, D.settings.stscript.globalVars.g]), [6, 2], '实际过滤运行写入变量');
  await run('/inject id=generated filter={: /gen 判断 | /setvar key=answer | /genraw 再问 | /sendas name=旁白 预览消息 | /return true :} 生成过滤');
  const generatedBefore = {requests: requests.length, msgs: await page.evaluate(() => getActiveSession(getChar().id).msgs.length)};
  const generatedResult = await page.evaluate(async () => {
    const key = hostPromptKey(getChar().id, getActiveSession(getChar().id).id, 'generated');
    const notes = [];
    const originalSaveData = saveData;
    let writes = 0, result;
    saveData = function() { writes++; return originalSaveData.apply(this, arguments); };
    try { result = await _hostPromptFilters.get(key).filter(notes); } finally { saveData = originalSaveData; }
    return {result, notes, writes, answer: getActiveSession(getChar().id).stscriptVars.answer,
      msgCount: getActiveSession(getChar().id).msgs.length};
  });
  assert.strictEqual(generatedResult.result, true);
  assert.strictEqual(generatedResult.writes, 0, '模型与写入型过滤预览不得调用真实saveData');
  assert.deepStrictEqual(generatedResult.notes, [
    '卡片脚本自行生成的随机数和时间，发送时可能与预览不同。',
    '[预览未执行：STScript 模型调用]',
    'STScript 在预览中发起的写入已丢弃，发送时照常写入。',
  ], '预览应记录真实应用的随机/时间、模型占位及丢弃写入注记');
  assert.strictEqual(generatedResult.answer, undefined);
  assert.strictEqual(generatedResult.msgCount, generatedBefore.msgs);
  assert.strictEqual(requests.length, generatedBefore.requests, '过滤预览不得发送模型请求');
  const abortResult = await page.evaluate(async () => {
    const controller = new StscriptAbortController();
    controller.abort();
    return stscriptPromptFilterExecutor('/return true', controller)();
  });
  assert.strictEqual(abortResult, false, '中止的过滤闭包返回 false');
  await run('/flushinject');

  generationRouteEntered = new Promise(resolve => { signalGenerationRouteEntered = resolve; });
  holdGeneration = true;
  await page.evaluate(() => { window.__genstreamResult = runStscript('/profile-genstream stop=false 静态提示'); });
  await generationRouteEntered;
  await page.locator('.script-loader-panel').filter({hasText: '正在生成'}).waitFor();
  assert.strictEqual(await page.locator('.script-loader-panel button').count(), 0, 'stop=false 的进度提示不可停止');
  assert.match(await page.locator('.script-loader-panel').innerText(), /正在生成/);
  holdGeneration = false;
  releaseGeneration();
  assert.strictEqual(await page.evaluate(() => window.__genstreamResult), '模型回复');

  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log('stscript prompts: real app commands, repository persistence, prompt manager drafts, provider routing and captured model requests');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
