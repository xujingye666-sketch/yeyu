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
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  const result = await page.evaluate(() => {
    function check(condition, message) { if (!condition) throw new Error(message); }
    function entry(id, content, keys, extra) {
      return normalizeWBEntry(Object.assign({
        id, content, keys: keys || ['needle'], enabled: true, probability: 100, insertion_order: 100,
      }, extra || {}));
    }
    function setBook(entries, recursive) {
      D.worldBook = {
        scan_depth: 20, token_budget: 0, recursive: recursive === true, caseSensitive: false,
        categories: [{id: 'decorators-book', name: 'CCv3 L3a', settings: {scan_depth: 20, token_budget: 0, recursive: recursive === true, caseSensitive: false}, entries}],
        globalCategoryIds: ['decorators-book'], activeCategoryId: 'decorators-book',
      };
    }
    function resolveSingle(sourceEntry, messages, session, options) {
      setBook([sourceEntry], false);
      return resolveWorldBook(messages, 'decorators-char', session || {id: 'decorators-session', msgs: messages}, options || {});
    }
    function hasContent(resolved, marker) {
      return [resolved.beforeChar, resolved.stableBeforeChar, resolved.afterChar, resolved.stableAfterChar, resolved.beforeUser]
        .concat(Array.from(resolved.inChat.values()).flat().map(row => row.content))
        .concat((resolved.beforeCharItems || []).map(row => row.content))
        .join('\n').includes(marker);
    }

    D = defaults();
    D.settings.useMemory = false;
    D.settings.systemTpl = '';
    D.settings.postHistory = '';
    D.settings.authorsNote = '';
    D.settings.maxContextTokens = 0;
    D.settings.maxTokens = 0;

    const after = entry('after', '@@activate_only_after 2\nAFTER', ['needle']);
    const afterSession = {id: 'after-session', msgs: [{role: 'user', content: 'needle', seq: 1}]};
    check(resolveSingle(after, [{role: 'user', text: 'needle', seq: 1}], afterSession).count === 0, 'activate_only_after 提前激活');
    afterSession.msgs.push({role: 'assistant', content: 'reply', seq: 2}, {role: 'user', content: 'needle', seq: 3}, {role: 'user', content: 'needle again', seq: 4});
    check(resolveSingle(after, afterSession.msgs.map(row => ({role: row.role, text: row.content, seq: row.seq})), afterSession).count === 0, 'activate_only_after 错把用户消息数当角色回复数');
    afterSession.msgs.push({role: 'assistant', content: 'second reply', seq: 5});
    check(resolveSingle(after, afterSession.msgs.map(row => ({role: row.role, text: row.content, seq: row.seq})), afterSession).count === 1, 'activate_only_after 到达轮次未激活');

    const every = entry('every', '@@activate_only_every 2\nEVERY', ['needle']);
    check(resolveSingle(every, [{role: 'user', text: 'needle'}], {id: 'every-1', msgs: [{role: 'user'}, {role: 'assistant'}, {role: 'user'}]}).count === 0, 'activate_only_every 错把用户消息数当角色回复数');
    check(resolveSingle(every, [{role: 'user', text: 'needle'}], {id: 'every-2', msgs: [{role: 'user'}, {role: 'assistant'}, {role: 'assistant'}]}).count === 1, 'activate_only_every 在角色回复整除轮次未激活');

    const keep = entry('keep', '@@keep_activate_after_match\nKEEP', ['needle']);
    const keepSession = {id: 'keep-session', msgs: [{role: 'user', content: 'needle'}]};
    check(resolveSingle(keep, [{role: 'user', text: 'needle'}], keepSession, {commitRuntime: true}).count === 1, 'keep 首次匹配失败');
    keepSession.msgs.push({role: 'assistant', content: 'reply'}, {role: 'user', content: 'none'});
    keep.probability = 0;
    check(resolveSingle(keep, [{role: 'user', text: 'none'}], keepSession, {commitRuntime: true}).count === 1, 'keep 首次匹配后未持续');

    const once = entry('once', '@@dont_activate_after_match\nONCE', ['needle']);
    const onceSession = {id: 'once-session', msgs: [{role: 'user', content: 'needle'}]};
    check(resolveSingle(once, [{role: 'user', text: 'needle'}], onceSession, {commitRuntime: true}).count === 1, 'dont_activate_after_match 首次匹配失败');
    onceSession.msgs.push({role: 'assistant', content: 'reply'}, {role: 'user', content: 'needle'});
    check(resolveSingle(once, [{role: 'user', text: 'needle'}], onceSession, {commitRuntime: true}).count === 0, 'dont_activate_after_match 重复激活');

    const scanDepth = entry('scan', '@@scan_depth 1\nSCAN', ['old-key']);
    check(resolveSingle(scanDepth, [{role: 'user', text: 'old-key'}, {role: 'assistant', text: 'recent'}]).count === 0, 'scan_depth 未限制消息范围');
    check(resolveSingle(scanDepth, [{role: 'user', text: 'old'}, {role: 'assistant', text: 'old-key'}]).count === 1, 'scan_depth 未扫描最近消息');
    const scanDepthZero = entry('scan-zero', '@@scan_depth 0\nSCAN_ZERO', ['old-key']);
    check(resolveSingle(scanDepthZero, [{role: 'user', text: 'old-key'}]).count === 0, 'scan_depth=0 不得扫描完整历史');

    const instructScan = entry('instruct-scan', '@@instruct_scan_depth 3\nINSTRUCT_SCAN', ['tail-key']);
    check(resolveSingle(instructScan, [{role: 'user', text: 'tail-key far away from the recent suffix'}, {role: 'assistant', text: 'recent suffix without match'}]).count === 0, 'instruct_scan_depth 未限制 Token 范围');
    check(resolveSingle(instructScan, [{role: 'assistant', text: 'recent tail-key'}]).count === 1, 'instruct_scan_depth 未扫描最近 Token');

    const additional = entry('additional', '@@additional_keys extra-a,extra-b\nADDITIONAL', ['base']);
    check(resolveSingle(additional, [{role: 'user', text: 'base and extra-b'}]).count === 1, 'additional_keys 合法扩展未触发');
    check(resolveSingle(additional, [{role: 'user', text: 'base only'}]).count === 0, 'additional_keys 缺失时仍触发');
    const excluded = entry('excluded', '@@exclude_keys blocked,forbidden\nEXCLUDED', ['base']);
    check(resolveSingle(excluded, [{role: 'user', text: 'base and blocked'}]).count === 0, 'exclude_keys 命中后未抑制');
    check(resolveSingle(excluded, [{role: 'user', text: 'base allowed'}]).count === 1, 'exclude_keys 未命中时误抑制');

    const depthEntries = [
      entry('instruct-depth', '@@activate\n@@instruct_depth 0\nINSTRUCT_DEPTH', []),
      entry('reverse-depth', '@@activate\n@@reverse_depth 1\nREVERSE_DEPTH', []),
      entry('reverse-instruct-depth', '@@activate\n@@reverse_instruct_depth 0\nREVERSE_INSTRUCT_DEPTH', []),
    ];
    setBook(depthEntries, false);
    const depthMessages = [
      {role: 'user', text: 'one'}, {role: 'assistant', text: 'two'},
      {role: 'user', text: 'three'}, {role: 'assistant', text: 'four'},
    ];
    const depthResolved = resolveWorldBook(depthMessages, 'decorators-char', {id: 'depth-session', msgs: depthMessages});
    check((depthResolved.inChat.get(0) || []).some(row => row.content === 'INSTRUCT_DEPTH'), 'instruct_depth=0 位置错误');
    check((depthResolved.inChat.get(3) || []).some(row => row.content === 'REVERSE_DEPTH'), 'reverse_depth 反向消息位置错误');
    check((depthResolved.inChat.get(4) || []).some(row => row.content === 'REVERSE_INSTRUCT_DEPTH'), 'reverse_instruct_depth 反向 Token 位置错误');
    const depthPrecedence = entry('depth-precedence', '@@activate\n@@depth 1\n@@reverse_depth 0\nDEPTH_PRECEDENCE', []);
    const precedenceResolved = resolveSingle(depthPrecedence, depthMessages, {id: 'precedence-session', msgs: depthMessages});
    check((precedenceResolved.inChat.get(1) || []).some(row => row.content === 'DEPTH_PRECEDENCE'), '@@depth 必须优先于 reverse_depth');

    const budgetEntry = entry('max-context', '@@ignore_on_max_context\nMAX_CONTEXT', ['needle']);
    check(resolveSingle(budgetEntry, [{role: 'user', text: 'needle'}], null, {maxContextReached: true}).count === 0, 'ignore_on_max_context 在上限状态仍注入');
    check(resolveSingle(budgetEntry, [{role: 'user', text: 'needle'}], null, {maxContextReached: false}).count === 1, 'ignore_on_max_context 未到上限时误省略');

    const greetingZero = entry('greeting-zero', '@@is_greeting 0\nGREETING_ZERO', ['needle']);
    const unknownGreetingSession = {id: 'greeting-unknown', msgs: [{role: 'user', content: 'needle'}]};
    const greetingScan = session => session.msgs.map(message => ({role: message.role, text: message.content, opening: message.opening, openingIndex: message.openingIndex}));
    check(resolveSingle(greetingZero, greetingScan(unknownGreetingSession), unknownGreetingSession).count === 1, '无法判断活动开场白时未忽略 is_greeting');
    const matchingGreetingSession = {id: 'greeting-match', msgs: [{role: 'assistant', opening: true, openingIndex: 0, content: 'hello'}, {role: 'user', content: 'needle'}]};
    check(resolveSingle(greetingZero, greetingScan(matchingGreetingSession), matchingGreetingSession).count === 1, 'is_greeting 未识别命中的活动开场白');
    const differentGreetingSession = {id: 'greeting-different', msgs: [{role: 'assistant', opening: true, openingIndex: 1, content: 'hello'}, {role: 'user', content: 'needle'}]};
    check(resolveSingle(greetingZero, greetingScan(differentGreetingSession), differentGreetingSession).count === 0, 'is_greeting 错误匹配其他开场白');
    const greetingFallback = entry('greeting-fallback', '@@is_greeting 0\n@@@activate\nGREETING_FALLBACK', ['absent-key']);
    check(resolveSingle(greetingFallback, greetingScan(unknownGreetingSession), unknownGreetingSession).count === 1, '无法判断活动开场白时未执行 is_greeting fallback');
    check(resolveSingle(greetingFallback, greetingScan(matchingGreetingSession), matchingGreetingSession).count === 0, '能判断活动开场白时错误执行 is_greeting fallback');
    // is_greeting counts card slots (first_mes is 0), while the session stores the choice index, which
    // skips blank greetings: the third choice of ['g0', '', 'g2', 'g3'] is card slot 3.
    D.characters = [{id: 'decorators-char', first_mes: 'g0', alternate_greetings: ['', 'g2', 'g3']}];
    const blankSlotSession = {id: 'greeting-blank-slot', msgs: [{role: 'assistant', opening: true, openingIndex: 2, content: 'g3'}, {role: 'user', content: 'needle'}]};
    check(resolveSingle(entry('greeting-slot', '@@is_greeting 3\nGREETING_SLOT'), greetingScan(blankSlotSession), blankSlotSession).count === 1, 'is_greeting 必须按卡内开场白位置计数，空白开场白也占位');
    check(resolveSingle(entry('greeting-choice', '@@is_greeting 2\nGREETING_CHOICE'), greetingScan(blankSlotSession), blankSlotSession).count === 0, 'is_greeting 不得按跳过空白后的选择序号计数');
    D.characters = [];

    const placeholder = entry('user-icon', '@@is_user_icon traveler\n@@@activate\nUSER_ICON_BODY', []);
    const placeholderResolved = resolveSingle(placeholder, [{role: 'user', text: 'anything'}]);
    check(placeholderResolved.count === 1 && hasContent(placeholderResolved, 'USER_ICON_BODY'), 'is_user_icon 占位不应阻断其他有效条件');
    check(!hasContent(placeholderResolved, '@@is_user_icon'), 'is_user_icon 行污染正文');
    D.characters = [{id: 'decorators-char', assets: [{type: 'user_icon', name: 'traveler', uri: 'ccdefault:', ext: 'png'}], media_assets: []}];
    const matchedIcon = entry('user-icon-hit', '@@is_user_icon traveler\n@@@activate\nUSER_ICON_HIT', []);
    check(hasContent(resolveSingle(matchedIcon, [{role: 'user', text: 'anything'}]), 'USER_ICON_HIT'), '匹配的 user_icon 必须生效');
    const missedIcon = entry('user-icon-miss', '@@is_user_icon other\n@@@activate\nUSER_ICON_MISS', []);
    check(!hasContent(resolveSingle(missedIcon, [{role: 'user', text: 'anything'}]), 'USER_ICON_MISS'), '不匹配的 user_icon 不得注入');
    D.characters = [];
    const disableSystem = entry('disable-system', '@@disable_ui_prompt system_prompt\n@@activate\nDISABLE_SYSTEM_BODY', []);
    const disableSystemResolved = resolveSingle(disableSystem, [{role: 'user', text: 'anything'}]);
    check(disableSystemResolved.disabledUiPrompts.includes('system_prompt') && !hasContent(disableSystemResolved, '@@disable_ui_prompt'), 'disable_ui_prompt system_prompt 未识别或污染正文');
    const recursiveEntries = [
      entry('recursive-seed', 'SEED_VISIBLE secret-key', ['trigger']),
      entry('recursive-target', 'RECURSIVE_TARGET', ['secret-key']),
    ];
    setBook(recursiveEntries, true);
    const recursiveResolved = resolveWorldBook([{role: 'user', text: 'trigger'}], 'decorators-char', {id: 'recursive-session', msgs: [{role: 'user'}]});
    check(recursiveResolved.count === 2 && hasContent(recursiveResolved, 'RECURSIVE_TARGET'), '静态文本未参与递归扫描');
    const commentRecursiveEntries = [
      entry('comment-seed', 'COMMENT_SEED{{// slash-secret}}{{comment: named-secret}}', ['trigger']),
      entry('slash-target', 'SLASH_TARGET', ['slash-secret']),
      entry('named-target', 'NAMED_TARGET', ['named-secret']),
    ];
    setBook(commentRecursiveEntries, true);
    const commentRecursiveResolved = resolveWorldBook([{role: 'user', text: 'trigger'}], 'decorators-char', {id: 'comment-recursive-session', msgs: [{role: 'user'}]});
    check(commentRecursiveResolved.count === 1 && !hasContent(commentRecursiveResolved, 'SLASH_TARGET') && !hasContent(commentRecursiveResolved, 'NAMED_TARGET'), '注释 CBS 错误参与递归扫描');
    const macroState = createCharacterMacroState(() => 0.5);
    const macroText = replaceCharacterMacros('A{{comment: secret-key}}B{{reverse:Hello}}C{{// note}}D{{comment: note}}E', {name: 'Card'}, 'User', macroState);
    check(macroText === 'ABolleHCDE', 'hidden_key/reverse/comment CBS 替换错误：' + macroText);

    const positionEntries = [
      entry('before-desc', '@@position before_desc\n@@activate\nWB_BEFORE_DESC', []),
      entry('after-desc', '@@position after_desc\n@@activate\nWB_AFTER_DESC', []),
      entry('personality', '@@position personality\n@@activate\nWB_PERSONALITY', []),
      entry('scenario', '@@position scenario\n@@activate\nWB_SCENARIO', []),
    ];
    setBook(positionEntries, false);
    const card = parseCard({spec: 'chara_card_v3', spec_version: '3.0', data: {
      name: 'Decorators Card', description: 'DESC_BODY', personality: 'PERSONALITY_BODY', scenario: 'SCENARIO_BODY', first_mes: 'Hello',
      system_prompt: 'CARD_SYSTEM_PROMPT {{original}}', post_history_instructions: '{{original}} CARD_POST_HISTORY\n```status\nstate\n```',
    }});
    card.id = 'decorators-char';
    D.characters = [card];
    D.currentCharId = card.id;
    D.settings.systemTpl = 'APP_SYSTEM_PROMPT';
    D.settings.postHistory = 'APP_POST_HISTORY';
    D.settings.chatCompletionPresetInUse = presetRawDefault();
    D.settings.chatCompletionPresetInUse.prompts.find(prompt => prompt.identifier === 'main').content = 'APP_SYSTEM_PROMPT';
    D.settings.chatCompletionPresetInUse.prompts.find(prompt => prompt.identifier === 'jailbreak').content = 'APP_POST_HISTORY';
    const promptSession = {id: 'position-session', msgs: [{role: 'user', content: 'position', seq: 1}], nextMessageSeq: 2, memoryStore: makeEmptyMemoryStore()};
    D.chats[card.id] = {sessions: [promptSession], activeSid: promptSession.id};
    setBook([entry('disable-system-prompt', '@@disable_ui_prompt system_prompt\n@@activate\nSYSTEM_DISABLE_ACTIVE', [])], false);
    const systemDisabledBuilt = buildMessages(card, promptSession.msgs, promptSession, {});
    const systemDisabledText = systemDisabledBuilt.messages.map(message => String(message.content || '')).join('\n');
    check(systemDisabledText.includes('SYSTEM_DISABLE_ACTIVE') && !systemDisabledText.includes('APP_SYSTEM_PROMPT') && systemDisabledText.includes('CARD_SYSTEM_PROMPT') && systemDisabledText.includes('APP_POST_HISTORY') && systemDisabledText.includes('CARD_POST_HISTORY'), 'system_prompt 未按规范仅禁用应用主提示词');
    setBook([entry('disable-system-only', '@@disable_ui_prompt system_prompt\n@@activate', [])], false);
    const decoratorOnlyBuilt = buildMessages(card, promptSession.msgs, promptSession, {});
    const decoratorOnlyText = decoratorOnlyBuilt.messages.map(message => String(message.content || '')).join('\n');
    check(!decoratorOnlyText.includes('APP_SYSTEM_PROMPT') && decoratorOnlyText.includes('CARD_SYSTEM_PROMPT') && decoratorOnlyBuilt.worldBookMetrics.injected === 0, '无正文的纯装饰器条目未触发 system_prompt 禁用或错误注入正文');
    setBook([entry('disable-post-prompt', '@@disable_ui_prompt post_history_instructions\n@@activate\nPOST_DISABLE_ACTIVE', [])], false);
    const postDisabledBuilt = buildMessages(card, promptSession.msgs, promptSession, {commit: true});
    const postDisabledText = postDisabledBuilt.messages.map(message => String(message.content || '')).join('\n');
    check(postDisabledText.includes('POST_DISABLE_ACTIVE') && postDisabledText.includes('APP_SYSTEM_PROMPT') && postDisabledText.includes('CARD_SYSTEM_PROMPT') && !postDisabledText.includes('APP_POST_HISTORY') && postDisabledText.includes('CARD_POST_HISTORY'), 'post_history_instructions 未按规范仅禁用应用发送后模板');
    check(postDisabledText.includes('```status\nstate\n```') && !postDisabledBuilt.pipelineStages.some(stage => /status/i.test(String(stage && stage.id || ''))), '卡片原生协议文本应原样进入，Prompt 流水线不得增加相邻派生阶段');
    check(!Object.prototype.hasOwnProperty.call(promptSession.msgs[0], 'worldBookSnapshot'), '构建不得在消息上写冻结快照');
    promptSession.msgs.push({role: 'assistant', content: 'partial', seq: 2});
    const continuationBase = DEFAULT_CONTINUATION_POST_HISTORY_TPL;
    const rescanPostBuilt = buildMessages(card, promptSession.msgs, promptSession, {generationTarget: {mode: 'continue', messageIndex: 1}});
    const rescanPostText = rescanPostBuilt.messages.map(message => String(message.content || '')).join('\n');
    check(rescanPostText.includes('CARD_POST_HISTORY') && !rescanPostText.includes(continuationBase), '续写全量重扫未重新应用禁用结果或错误移除卡片指令');
    promptSession.msgs.pop();
    const originalSystemPrompt = card.system_prompt;
    const originalPostHistory = card.post_history_instructions;
    card.system_prompt = '';
    card.post_history_instructions = '';
    setBook([
      entry('disable-empty-system', '@@disable_ui_prompt system_prompt\n@@activate', []),
      entry('disable-empty-post', '@@disable_ui_prompt post_history_instructions\n@@activate', []),
    ], false);
    const emptyPromptBuilt = buildMessages(card, promptSession.msgs, promptSession, {});
    check(!emptyPromptBuilt.messages.some(message => message.role === 'system' && !String(message.content || '').trim()), '两种应用提示词均禁用且卡片字段为空时仍推入空 system 消息');
    card.system_prompt = originalSystemPrompt;
    card.post_history_instructions = originalPostHistory;
    setBook([entry('prompt-cbs', '@@activate\nCBS_VISIBLE|{{comment: secret-key}}|{{reverse:Hello}}|{{// slash-note}}|{{comment: named-note}}|{{char}}|{{user}}|{{random:A,B}}|{{pick:X,Y}}|{{roll:6}}', [])], false);
    const cbsBuilt = buildMessages(card, promptSession.msgs, promptSession, {});
    const cbsPrompt = cbsBuilt.messages.find(message => String(message.content || '').includes('CBS_VISIBLE'));
    check(cbsPrompt && cbsPrompt.content.includes('olleH') && cbsPrompt.content.includes('Decorators Card') && cbsPrompt.content.includes('用户'), '世界书 CBS 未进入真实 Prompt 渲染链');
    check(!cbsPrompt.content.includes('{{') && !cbsPrompt.content.includes('secret-key') && !cbsPrompt.content.includes('slash-note') && !cbsPrompt.content.includes('named-note'), '世界书隐藏/注释 CBS 泄漏到真实 Prompt');
    // A depth entry whose body renders empty must add nothing: the prompt equals one built without the entry.
    const promptRows = built => JSON.stringify(built.messages.map(message => [message.role, String(message.content || '')]));
    setBook([], false);
    const withoutHiddenOnly = promptRows(buildMessages(card, promptSession.msgs, promptSession, {}));
    setBook([entry('hidden-only-depth', '@@activate\n@@depth 1\n{{comment: recursive-only}}\n{{comment: prompt-empty}}', [])], false);
    const hiddenOnlyBuilt = buildMessages(card, promptSession.msgs, promptSession, {});
    check(promptRows(hiddenOnlyBuilt) === withoutHiddenOnly, '仅含 hidden_key/comment 的空正文仍生成世界书深度消息');
    const hiddenOnlyOnce = entry('hidden-only-once', '@@dont_activate_after_match\n@@depth 1\n{{comment: recursive-only}}', ['position']);
    const hiddenOnlyRuntimeSession = {id: 'hidden-only-runtime', msgs: promptSession.msgs.slice()};
    const hiddenOnlyResolved = resolveSingle(hiddenOnlyOnce, [{role: 'user', text: 'position'}], hiddenOnlyRuntimeSession, {commitRuntime: true, renderContent: value => replaceCharacterMacros(value, card, '用户', createCharacterMacroState())});
    check(hiddenOnlyResolved.count === 0 && hiddenOnlyRuntimeSession.worldBookRuntime.matched[JSON.stringify(['decorators-book', 'hidden-only-once'])].matched === true, '空正文虽未注入但未保留已匹配运行态语义');
    const hiddenMaxIgnore = entry('hidden-max-ignore', '@@ignore_on_max_context\n@@keep_activate_after_match\n{{comment: recursive-only}}', ['position'], {insertion_order: 1});
    const hiddenMaxFiller = entry('hidden-max-filler', 'MAX_FILLER '.repeat(100), ['position'], {insertion_order: 2});
    setBook([hiddenMaxIgnore, hiddenMaxFiller], false);
    const hiddenMaxRuntimeSession = {id: 'hidden-max-runtime', msgs: promptSession.msgs.slice()};
    const hiddenMaxResolved = resolveWorldBook([{role: 'user', text: 'position'}], card.id, hiddenMaxRuntimeSession, {commitRuntime: true, contextBaseTokens: 490, maxContextThreshold: 500, renderContent: value => replaceCharacterMacros(value, card, '用户', createCharacterMacroState())});
    check(hiddenMaxResolved.maxContextReached === true && !(hiddenMaxRuntimeSession.worldBookRuntime.matched[JSON.stringify(['decorators-book', 'hidden-max-ignore'])] || {}).matched, '空正文 ignore_on_max_context 在动态触顶前错误提交 matched 运行态');
    setBook(positionEntries, false);
    const built = buildMessages(card, promptSession.msgs, promptSession, {});
    const coreText = built.messages.map(message => String(message.content || '')).join('\n');
    check(coreText.includes('DESC_BODY'), '缺少角色卡核心层');
    const positions = ['WB_BEFORE_DESC', 'DESC_BODY', 'WB_AFTER_DESC', 'PERSONALITY_BODY', 'WB_PERSONALITY', 'SCENARIO_BODY', 'WB_SCENARIO'];
    for (let index = 1; index < positions.length; index += 1) {
      check(coreText.indexOf(positions[index - 1]) < coreText.indexOf(positions[index]), '@@position 命名位置顺序错误：' + positions.join(' -> '));
    }

    const emptyPositionEntries = [
      entry('empty-personality', '@@position personality\n@@activate\nEMPTY_PERSONALITY_FALLBACK', [], {position: 'after_char'}),
      entry('empty-scenario', '@@position scenario\n@@activate\nEMPTY_SCENARIO_FALLBACK', [], {position: 'before_char'}),
      entry('position-chain', '@@position personality\n@@@position after_desc\n@@activate\nPOSITION_CHAIN_FALLBACK', []),
      entry('position-depth-chain', '@@position personality\n@@@depth 2\n@@@position after_desc\n@@activate\nPOSITION_DEPTH_FALLBACK', []),
      entry('position-activate-chain', '@@position personality\n@@@activate\nPOSITION_ACTIVATE_FALLBACK', []),
    ];
    setBook(emptyPositionEntries, false);
    const emptyCard = parseCard({spec: 'chara_card_v3', spec_version: '3.0', data: {
      name: 'Empty Sections', description: 'EMPTY_DESC', personality: '{{random:,PERSONALITY_PRESENT}}', scenario: '', first_mes: 'Hello',
    }});
    emptyCard.id = 'decorators-empty-char';
    D.characters = [emptyCard];
    D.currentCharId = emptyCard.id;
    const emptySession = {id: 'empty-position-session', msgs: [{role: 'user', content: 'position', seq: 1}], nextMessageSeq: 2, memoryStore: makeEmptyMemoryStore()};
    D.chats[emptyCard.id] = {sessions: [emptySession], activeSid: emptySession.id};
    const originalRandom = Math.random;
    Math.random = () => 0;
    const emptyBuilt = buildMessages(emptyCard, emptySession.msgs, emptySession, {});
    Math.random = originalRandom;
    const emptyPrompt = emptyBuilt.messages.map(message => String(message.content || '')).join('\n');
    check(emptyPrompt.includes('EMPTY_PERSONALITY_FALLBACK') && emptyPrompt.includes('EMPTY_SCENARIO_FALLBACK'), '目标角色字段为空时丢失 named-position 世界书');
    check(emptyPrompt.includes('POSITION_CHAIN_FALLBACK'), '目标角色字段为空时未执行 @@position fallback');
    check(emptyBuilt.messages.some(message => String(message.content || '').includes('POSITION_DEPTH_FALLBACK')), '目标角色字段为空时跳过了非 position fallback');
    check(emptyPrompt.includes('POSITION_ACTIVATE_FALLBACK'), '目标角色字段为空时未执行 activate fallback');

    setBook([
      entry('max-context-ignore', '@@ignore_on_max_context\nMAX_CONTEXT_IGNORED', ['needle']),
      entry('max-context-keep', 'MAX_CONTEXT_KEPT', ['needle']),
    ], false);
    D.personas = [{id: 'large-persona', name: 'User', desc: 'P'.repeat(12000), boundCharIds: [emptyCard.id]}];
    D.activePersonaId = null;
    D.settings.maxContextTokens = 1200;
    D.settings.maxTokens = 100;
    const maxSession = {id: 'max-context-session', msgs: [{role: 'user', content: 'needle', seq: 1}], nextMessageSeq: 2, memoryStore: makeEmptyMemoryStore()};
    D.chats[emptyCard.id] = {sessions: [maxSession], activeSid: maxSession.id};
    const maxBuiltText = buildMessages(emptyCard, maxSession.msgs, maxSession, {}).messages.map(message => String(message.content || '')).join('\n');
    check(!maxBuiltText.includes('MAX_CONTEXT_IGNORED') && maxBuiltText.includes('MAX_CONTEXT_KEPT'), '真实 Prompt 到达上下文上限时未优先省略 ignore_on_max_context 条目');
    D.personas = [];

    const dynamicIgnore = entry('dynamic-max-ignore', '@@ignore_on_max_context\n@@keep_activate_after_match\n' + 'DYNAMIC_MAX_IGNORED '.repeat(80), ['needle']);
    setBook([dynamicIgnore], false);
    const dynamicSession = {id: 'dynamic-max-session', msgs: [{role: 'user', content: 'needle'}]};
    const dynamicResolved = resolveWorldBook([{role: 'user', text: 'needle'}], emptyCard.id, dynamicSession, {commitRuntime: true, contextBaseTokens: 490, maxContextThreshold: 500});
    const dynamicKey = JSON.stringify(['decorators-book', 'dynamic-max-ignore']);
    check(dynamicResolved.count === 0 && !((dynamicSession.worldBookRuntime.matched||{})[dynamicKey] || {}).matched, '动态触顶后省略的条目错误提交 matched 运行态');

    const budgetIgnore = entry('budget-ignore', '@@ignore_on_max_context\nBUDGET_IGNORE_KEPT', ['needle'], {insertion_order: 1});
    const overBudget = entry('over-budget', 'OVER_BUDGET '.repeat(1000), ['needle'], {insertion_order: 2});
    setBook([budgetIgnore, overBudget], false);
    D.worldBook.token_budget = 20;
    const budgetMaxResolved = resolveWorldBook([{role: 'user', text: 'needle'}], emptyCard.id, {id: 'budget-max-session', msgs: [{role: 'user', content: 'needle'}]}, {contextBaseTokens: 100, maxContextThreshold: 500});
    // The world book budget is spent in official priority order (descending
    // insertion order), and once it overflows the remaining normal entries stop. With
    // over-budget at order 2 and the decorated entry at order 1, both are refused, but the
    // reason must stay "budget", never the max-context omission path.
    check(!hasContent(budgetMaxResolved, 'OVER_BUDGET'), '超预算条目不得进入 Prompt');
    check(budgetMaxResolved.details.some(row => row.status === 'budget-dropped'), '超预算条目必须记为预算丢弃');
    check(!budgetMaxResolved.details.some(row => row.status === 'max-context-dropped'), '必然超世界书预算的条目错误触发 max-context 省略');
    setBook([entry('budget-ignore', '@@ignore_on_max_context\nBUDGET_IGNORE_KEPT', ['needle'], {insertion_order: 9}), entry('over-budget', 'OVER_BUDGET '.repeat(1000), ['needle'], {insertion_order: 2})], false);
    D.worldBook.token_budget = 20;
    const budgetPriorityResolved = resolveWorldBook([{role: 'user', text: 'needle'}], emptyCard.id, {id: 'budget-priority-session', msgs: [{role: 'user', content: 'needle'}]}, {contextBaseTokens: 100, maxContextThreshold: 500});
    check(hasContent(budgetPriorityResolved, 'BUDGET_IGNORE_KEPT') && !hasContent(budgetPriorityResolved, 'OVER_BUDGET'), '高 order 条目必须先拿到预算');

    setBook([
      entry('history-max-ignore', '@@ignore_on_max_context\nHISTORY_MAX_IGNORED', ['needle']),
      entry('history-max-keep', 'HISTORY_MAX_KEPT', ['needle']),
    ], false);
    D.settings.maxContextTokens = 1200;
    D.settings.maxTokens = 100;
    const historyMsgs = [
      {role: 'user', content: 'old ' + 'H'.repeat(12000), seq: 1},
      {role: 'assistant', content: 'reply', seq: 2},
      {role: 'user', content: 'needle', seq: 3},
    ];
    const historySession = {id: 'history-max-session', msgs: historyMsgs, nextMessageSeq: 4, memoryStore: makeEmptyMemoryStore()};
    D.chats[emptyCard.id] = {sessions: [historySession], activeSid: historySession.id};
    const historyBuiltText = buildMessages(emptyCard, historyMsgs, historySession, {}).messages.map(message => String(message.content || '')).join('\n');
    check(!historyBuiltText.includes('HISTORY_MAX_IGNORED') && historyBuiltText.includes('HISTORY_MAX_KEPT'), '历史正文占满上下文时未省略 ignore_on_max_context 条目：ignored=' + historyBuiltText.includes('HISTORY_MAX_IGNORED') + ', kept=' + historyBuiltText.includes('HISTORY_MAX_KEPT'));

    const continuationEntries = [
      entry('continuation-ignore', '@@ignore_on_max_context\n' + 'CONTINUATION_IGNORED '.repeat(800), ['needle']),
      entry('continuation-keep', 'CONTINUATION_KEPT', ['needle']),
    ];
    setBook(continuationEntries, false);
    const continuationUser = {role: 'user', content: 'needle', seq: 1};
    // 由被续写正文稳定触顶，避免依赖内置预设文案的长度。
    const continuationAssistant = {role: 'assistant', content: 'partial ' + 'C'.repeat(4000), seq: 2};
    const continuationSession = {id: 'continuation-session', msgs: [continuationUser, continuationAssistant], nextMessageSeq: 3, memoryStore: makeEmptyMemoryStore()};
    D.chats[emptyCard.id] = {sessions: [continuationSession], activeSid: continuationSession.id};
    const continuationText = buildMessages(emptyCard, continuationSession.msgs, continuationSession, {generationTarget: {mode: 'continue', messageIndex: 1}}).messages.map(message => String(message.content || '')).join('\n');
    check(!continuationText.includes('CONTINUATION_IGNORED') && continuationText.includes('CONTINUATION_KEPT'), '续写全量重扫触顶时未省略 ignore_on_max_context 条目');

    setBook([
      entry('inactive-note-ignore', '@@ignore_on_max_context\nINACTIVE_NOTE_IGNORE', ['needle']),
      entry('inactive-note-keep', 'INACTIVE_NOTE_KEEP', ['needle']),
    ], false);
    // Budgets below sit on top of the in-use preset text so they do not depend on the built-in preset's length.
    const presetTextTokens = estTokens(activeCompletionPresetRaw().prompts.map(prompt => String(prompt.content || '')).join('\n'));
    D.settings.authorsNote = 'N'.repeat(12000);
    D.settings.anFreq = 2;
    D.settings.maxContextTokens = presetTextTokens + 2600;
    D.settings.maxTokens = 100;
    const inactiveNoteSession = {id: 'inactive-note-session', msgs: [{role: 'user', content: 'needle', seq: 1}], nextMessageSeq: 2, memoryStore: makeEmptyMemoryStore()};
    D.chats[emptyCard.id] = {sessions: [inactiveNoteSession], activeSid: inactiveNoteSession.id};
    const inactiveNoteText = buildMessages(emptyCard, inactiveNoteSession.msgs, inactiveNoteSession, {}).messages.map(message => String(message.content || '')).join('\n');
    check(inactiveNoteText.includes('INACTIVE_NOTE_IGNORE') && inactiveNoteText.includes('INACTIVE_NOTE_KEEP'), '作者注记未命中频率时仍错误触发 max-context');

    const frozenNote = 'F'.repeat(6000);
    setBook([
      entry('frozen-note-ignore', '@@ignore_on_max_context\nFROZEN_NOTE_IGNORE', ['needle']),
      entry('frozen-note-keep', 'FROZEN_NOTE_KEEP', ['needle']),
    ], false);
    D.settings.authorsNote = frozenNote;
    D.settings.anFreq = 1;
    D.settings.maxContextTokens = presetTextTokens + estTokens(frozenNote) + 1600;
    const frozenNoteUser = {role: 'user', content: 'needle', seq: 1};
    const frozenNoteAssistant = {role: 'assistant', content: 'partial', seq: 2};
    const frozenNoteSession = {id: 'frozen-note-session', msgs: [frozenNoteUser, frozenNoteAssistant], nextMessageSeq: 3, memoryStore: makeEmptyMemoryStore()};
    D.chats[emptyCard.id] = {sessions: [frozenNoteSession], activeSid: frozenNoteSession.id};
    const frozenNoteText = buildMessages(emptyCard, frozenNoteSession.msgs, frozenNoteSession, {generationTarget: {mode: 'continue', messageIndex: 1}}).messages.map(message => String(message.content || '')).join('\n');
    check(frozenNoteText.includes('FROZEN_NOTE_IGNORE') && frozenNoteText.includes('FROZEN_NOTE_KEEP'), '续写时作者注记被重复计入 max-context');
    D.settings.maxContextTokens = 0;
    D.settings.maxTokens = 0;
    D.settings.authorsNote = '';
    D.personas = [];

    setBook([entry('bounded-position', '@@position personality\n@@activate\nBOUNDED_POSITION', [])], false);
    const boundedPersonality = 'P'.repeat(4000) + '{{random:PERSONALITY_A,PERSONALITY_B}}';
    const boundedCard = parseCard({spec: 'chara_card_v3', spec_version: '3.0', data: {
      name: 'Bounded Snapshot', description: 'D'.repeat(4000), personality: boundedPersonality, scenario: 'S'.repeat(4000), first_mes: 'Hello',
    }});
    boundedCard.id = 'decorators-bounded-char';
    const boundedSession = {id: 'bounded-snapshot-session', msgs: [], nextMessageSeq: 1, memoryStore: makeEmptyMemoryStore()};
    D.characters = [boundedCard];
    D.currentCharId = boundedCard.id;
    D.chats[boundedCard.id] = {sessions: [boundedSession], activeSid: boundedSession.id};
    const boundedRandom = Math.random;
    try {
      for (let round = 0; round < 20; round += 1) {
        const user = {role: 'user', content: 'needle', seq: boundedSession.nextMessageSeq++};
        boundedSession.msgs.push(user);
        Math.random = round === 0 ? () => 0 : () => 0.999999;
        const firstBuild = buildMessages(boundedCard, boundedSession.msgs, boundedSession, {commit: true});
        if (round === 0) {
          const firstCore = firstBuild.messages.map(message => String(message.content || '')).join('\n');
          check(firstCore.includes('PERSONALITY_A') && firstCore.includes('BOUNDED_POSITION'), '首次生成未渲染角色字段宏与命名位置');
          boundedSession.msgs.push({role: 'assistant', content: 'partial', seq: boundedSession.nextMessageSeq++});
          Math.random = () => 0.999999;
          const continued = buildMessages(boundedCard, boundedSession.msgs, boundedSession, {commit: true, generationTarget: {mode: 'continue', messageIndex: 1}});
          const continuedCore = continued.messages.map(message => String(message.content || '')).join('\n');
          check(continuedCore.includes('PERSONALITY_B') && !continuedCore.includes('PERSONALITY_A') && continuedCore.includes('BOUNDED_POSITION'), '续写必须按当前状态重新渲染角色字段宏并保留命名位置');
        } else {
          boundedSession.msgs.push({role: 'assistant', content: 'reply', seq: boundedSession.nextMessageSeq++});
        }
      }
    } finally {
      Math.random = boundedRandom;
    }
    const boundedUsers = boundedSession.msgs.filter(message => message.role === 'user');
    check(boundedUsers.every(message => !Object.prototype.hasOwnProperty.call(message, 'worldBookSnapshot')), '构建不得在消息上持久化角色字段快照');

    const runtimeSession = {id: 'runtime-reset', msgs: [{role: 'user', content: 'needle'}], worldBookRuntime: {sticky: {matched: true}}};
    resetClearedSession(runtimeSession);
    check(runtimeSession.worldBookRuntime === undefined, '清空对话后残留世界书运行态');
    const invalidationSession = {id: 'runtime-invalidation', msgs: [], worldBookRuntime: {sticky: {matched: true}}};
    const isolatedSession = {id: 'runtime-isolated', msgs: [], worldBookRuntime: {sticky: {matched: true}}};
    D.chats['runtime-char'] = {sessions: [invalidationSession, isolatedSession], activeSid: invalidationSession.id};
    invalidateCacheContexts('runtime-char', 0, true, invalidationSession.id);
    check(invalidationSession.worldBookRuntime === undefined && isolatedSession.worldBookRuntime !== undefined, '历史内容变更的运行态重置破坏会话隔离');

    return {
      decorators: 15,
      macros: ['reverse', '//', 'comment'],
      positions: 4,
      recursiveStaticText: true,
      viewport: '390x844',
    };
  });

  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log(JSON.stringify(result));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
