'use strict';
// 预设页「预览本轮内容」与紧接着的实发请求（服务商转换后）逐字一致：随机宏、世界书概率、EJS 随机（含模板里的
// Math.random）、正则替换里的随机只在发送后换新，设置变化不重抽，正则随机不随其他文本的转换顺序或缓存命中而变；
// 只靠正则关键词激活的世界书条目也经过世界书正则；向量检索与资料库按查询内容缓存，实发命中预览结果。预览按 ST dryRun 执行 EJS、/inject 过滤闭包、
// 卡片发送事件（dryRun=true，采用改写）与 MVU（克隆数据），且不写聊天、变量、世界书计时和持久化，
// 不改动显示正则、发送按钮和提示；运行了 EJS 或卡片脚本时注记脚本自行生成的随机与时间，纯静态卡不注记。
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');

let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 450, height: 974}});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const requests = [];
  let failRequests = false;
  await page.route('**/parity-api/**', async route => {
    if (failRequests) return route.fulfill({status: 400, contentType: 'application/json', body: '{"error":{"message":"fixture failure"}}'});
    requests.push(route.request().postDataJSON());
    await route.fulfill({status: 200, contentType: 'text/event-stream', body:
      'data: ' + JSON.stringify({choices: [{delta: {content: 'REPLY'}, finish_reason: null}]}) + '\n\n' +
      'data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n'});
  });
  await page.evaluate(async () => {
    D = defaults();
    Object.assign(D.settings, {useMemory: false, styleAuditEnabled: false, maxContextTokens: 0, maxTokens: 0,
      embeddingEnabled: true, embeddingApiUrl: 'https://fixture.invalid/v1', embeddingApiKey: 'fixture-only', embeddingModel: 'fixture'});
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {apiUrl: location.origin + '/parity-api/v1', apiKey: 'synthetic-local',
      model: 'synthetic-model', reasoningEffort: 'off'});
    // The EJS part counts in a variable it writes and reads back, and draws from the round through a macro it
    // assembles itself, so the macro pass before it does not see the braces.
    const char = parseCard({name: '一致性角色', description: 'RAND{{random::A::B::C::D::E::F::G::H}} ROLL{{roll:d1000000}} ' +
      '<% setvar("ejsCount", (getvar("ejsCount") || 0) + 1) %>EJS_VAR<%= getvar("ejsCount") %> ' +
      'EJS_RAND<%= await evalTemplate("{" + "{random::P::Q::R::S::T::U::V::W}}") %> EJS_MATH<%= Math.floor(Math.random() * 1e9) %>'});
    char.id = 'parity-char';
    const letters = '{{random::' + 'abcdefghijklmnopqrstuvwx'.split('').join('::') + '}}';
    char.regexScripts = [
      normalizeRegexScriptRecord({id: 'regex-key-lore', findRegex: '/WB_REGEXKEY/g', replaceString: 'WB_REGEXKEY_RX', placement: [5],
        promptOnly: true, disabled: false}, {imported: true}),
      normalizeRegexScriptRecord({id: 'apple', findRegex: '/apple/g', replaceString: 'APPLE_RX' + letters + letters, placement: [1, 2],
        promptOnly: true, disabled: false}, {imported: true}),
    ];
    const session = createBlankSession('一致性', 'parity-session');
    session.greetingChosen = true; session.creatorNotesSeen = true;
    session.msgs = [{role: 'user', content: 'apple question', seq: 1}, {role: 'assistant', content: 'apple answer', seq: 2},
      {role: 'user', content: 'apple follow-up', seq: 3}];
    session.nextMessageSeq = 4;
    D.characters = [char]; D.currentCharId = char.id; D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    const entries = Array.from({length: 12}, (_, index) => normalizeWBEntry({id: 'coin-' + index, name: 'coin ' + index,
      content: 'WB_COIN_' + index, constant: true, probability: 50, useProbability: true, enabled: true, position: 'before_char'}));
    entries.push(normalizeWBEntry({id: 'vector-apple', name: 'vector apple', content: 'apple vector lore', keys: [],
      constant: false, vectorized: true, enabled: true, position: 'after_char'}));
    // Entries only a regex key activates; the world book regex must reach them in the preview and the send alike.
    for (let index = 0; index < 4; index++) entries.push(normalizeWBEntry({id: 'regex-key-' + index, name: 'regex key ' + index,
      content: 'WB_REGEXKEY ' + index, keys: ['/apple\\s+follow/i'], constant: false, enabled: true, position: 'before_char'}));
    entries.push(normalizeWBEntry({id: 'sticky', name: 'sticky', content: 'WB_STICKY', constant: true, sticky: 3,
      enabled: true, position: 'after_char'}));
    D.worldBook.categories = [{id: 'parity-book', name: '一致性世界书', settings: null, boundCharIds: [char.id], entries}];
    window.__embeddingRequests = 0; window.__embeddingFails = false;
    const originalFetch = window.fetch;
    window.fetch = async function (input, options) {
      if (!String(input).startsWith('https://fixture.invalid/')) return originalFetch.apply(this, arguments);
      window.__embeddingRequests++;
      if (window.__embeddingFails) return new Response('fixture failure', {status: 500});
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({data: body.input.map((text, index) => ({index, embedding: text.includes('apple') ? [1, 0] : [0, 1]}))}),
        {headers: {'content-type': 'application/json'}});
    };
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    const run = text => executeStscript(text, {handleParserErrors: false, handleExecutionErrors: false});
    await run('/vector-files-state true');
    await run('/db-add source=global name=BANK apple bank chunk');
    await run('/setvar key=parityGate true');
    await run('/inject id=parity-gated filter={: /getvar parityGate :} INJECT_GATED');
    await run('/inject id=parity-denied filter={: /return false :} INJECT_DENIED');
    // A card script listening to the generation events; in a dry run it tries a write and a model call too.
    window.__scriptOwner = {kind: 'library'};
    window.__scriptEvents = [];
    const owner = window.__scriptOwner, events = CARD_FRONTEND_TAVERN_EVENT_VALUES;
    [events.GENERATION_STARTED, events.GENERATION_AFTER_COMMANDS].forEach(name => cardFrontendRegisterEvent(owner, name,
      (type, options, dryRun) => { window.__scriptEvents.push([name, dryRun]); }, false));
    cardFrontendRegisterEvent(owner, events.CHAT_COMPLETION_PROMPT_READY, async data => {
      window.__scriptEvents.push([events.CHAT_COMPLETION_PROMPT_READY, data.dryRun]);
      if (data.dryRun) {
        cardFrontendCall(owner, 'replaceVariables', {value: {scriptLeak: true}, option: {type: 'chat'}});
        window.__scriptGenerated = await cardFrontendCall(owner, 'generate', {config: {user_input: 'x'}});
      }
      data.chat.push({role: 'system', content: 'SCRIPT_READY'});
    }, false);
    cardFrontendRegisterEvent(owner, events.GENERATE_AFTER_DATA, (data, dryRun) => {
      window.__scriptEvents.push([events.GENERATE_AFTER_DATA, dryRun, data.dryRun]);
      data.prompt = data.prompt.concat([{role: 'system', content: 'SCRIPT_DATA'}]);
    }, false);
    window.__previews = [];
    const build = buildPresetRoundPreview;
    window.buildPresetRoundPreview = async function () {
      const result = await build.apply(this, arguments);
      if (result) window.__previews.push({messages: JSON.parse(JSON.stringify(result.messages)), stats: result.stats});
      return result;
    };
    switchAppPage('chat'); renderChat();
    promptTemplateSelectRegexOwner(char, session);
    // A display regex the chat keeps showing while the preview runs.
    promptTemplateActivateRegex('DISPLAY_ONLY', 'SHOWN', {message: true});
    switchAppPage('presets'); switchCompletionPresetTab('order');
  });
  assert.strictEqual(await page.evaluate(() => Array.isArray(_completionPresetDraftRows)), true, '预览须走管理器草稿设置');
  const settle = () => page.evaluate(async () => { while (_presetRoundPreviewRun) await _presetRoundPreviewRun; });
  const text = messages => messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
  const draws = messages => {
    const joined = text(messages);
    return {rand: (joined.match(/RAND\w ROLL\d+/) || [''])[0], ejs: (joined.match(/EJS_RAND\w/) || [''])[0],
      coins: (joined.match(/WB_COIN_\d+/g) || []).join(',')};
  };

  // Opening the preview through the page; the send button, display regexes, toasts, chat, variables, world book
  // timing and storage stay as they were.
  const isolation = await page.evaluate(async () => {
    const renders = {button: 0, toasts: [], saves: 0}, originalRender = renderComposerActionButton, originalToast = toast,
      originalSave = saveData, buildMessagesOriginal = buildMessages, displaySizes = [];
    const state = () => JSON.stringify({session: getActiveSession(getChar().id), settings: D.settings.stscript, worldBook: D.worldBook});
    const before = state();
    window.renderComposerActionButton = function () { renders.button++; return originalRender.apply(this, arguments); };
    // The empty-library welcome is a boot timer that a slow preview can outlast; it is not the preview's.
    window.toast = function (message) {
      if (!String(message).startsWith('欢迎使用夜欲')) renders.toasts.push(String(message));
      return originalToast.apply(this, arguments);
    };
    window.saveData = function () { renders.saves++; return originalSave.apply(this, arguments); };
    window.buildMessages = function () { displaySizes.push(_promptTemplateRegexes.message.size); return buildMessagesOriginal.apply(this, arguments); };
    window.__scriptEvents.length = 0;
    try {
      document.getElementById('prompt-preview-toggle').click();
      while (!_presetRoundPreviewRun) await new Promise(resolve => setTimeout(resolve, 0));
      await _presetRoundPreviewRun;
    } finally {
      window.renderComposerActionButton = originalRender; window.toast = originalToast; window.saveData = originalSave;
      window.buildMessages = buildMessagesOriginal;
    }
    return {button: renders.button, toasts: renders.toasts, saves: renders.saves, unchanged: state() === before,
      displayKept: displaySizes.length > 0 && displaySizes.every(size => size === 1),
      shown: document.getElementById('prompt-preview-box').textContent.includes('apple bank chunk'),
      events: window.__scriptEvents.slice(), generated: window.__scriptGenerated};
  });
  const events = await page.evaluate(() => CARD_FRONTEND_TAVERN_EVENT_VALUES);
  assert.deepStrictEqual(isolation, {button: 0, toasts: [], saves: 0, unchanged: true, displayKept: true, shown: true,
    events: [[events.GENERATION_STARTED, true], [events.GENERATION_AFTER_COMMANDS, true],
      [events.CHAT_COMPLETION_PROMPT_READY, true], [events.GENERATE_AFTER_DATA, true, true]],
    generated: '[预览未执行：卡片脚本模型调用]'}, '预览须带 dryRun 派发发送事件，且不得改动聊天、变量、世界书计时、存储和界面');
  const first = await page.evaluate(() => window.__previews.at(-1));
  assert.ok(first.messages.some(message => String(message.content).includes('apple vector lore')), '预览应含向量检索命中的世界书');
  assert.ok(await page.evaluate(() => window.__embeddingRequests) > 0, '预览应真实检索');
  const firstText = text(first.messages);
  assert.ok(/WB_REGEXKEY_RX 3/.test(firstText) && !/WB_REGEXKEY \d/.test(firstText), '正则关键词激活的条目也应经过世界书正则');
  assert.ok(/EJS_MATH\d+/.test(firstText) && /APPLE_RX[a-x]{2} follow-up/.test(firstText), '夹具应含模板 Math.random 与正则随机');
  assert.ok(/EJS_VAR1 EJS_RAND[P-W]/.test(firstText), '预览应真实求值 EJS，读到本事务内写入的变量');
  assert.ok(firstText.includes('INJECT_GATED') && !firstText.includes('INJECT_DENIED'), '预览应执行 /inject 过滤闭包并采用结果');
  assert.ok(firstText.includes('SCRIPT_READY') && firstText.includes('SCRIPT_DATA'), '预览应采用卡片发送事件的改写');
  assert.ok(first.stats.includes('卡片脚本在预览中发起的写入已丢弃') && first.stats.includes('[预览未执行：卡片脚本模型调用]'),
    '预览应注记被丢弃的脚本写入与模型调用');
  assert.ok(!first.stats.includes('未在预览中执行') && !first.stats.includes('预览未执行这部分'), '预览不应再跳过 EJS、过滤闭包或发送事件');
  const volatileNote = await page.evaluate(() => GENERATION_PROMPT_SCRIPT_VOLATILE_NOTE);
  assert.strictEqual(first.stats.split(volatileNote).length, 2, '运行了 EJS 或卡片脚本的预览应注记一次脚本自行生成的随机与时间');
  // The real send right after a preview, with the same history and the input left empty.
  const send = () => page.evaluate(async () => {
    const session = getActiveSession(getChar().id), before = window.__embeddingRequests;
    window.__scriptEvents.length = 0;
    switchAppPage('chat');
    await regenerateLast();
    const retrievals = window.__embeddingRequests - before, events = window.__scriptEvents.slice();
    await _generationPostCommitTasks.get(session);
    // The expanded preview catches up once the send settles; it is not part of the send.
    while (_presetRoundPreviewRun) await _presetRoundPreviewRun;
    session.msgs.pop();
    switchAppPage('presets'); switchCompletionPresetTab('order');
    return {retrievals, events};
  });
  const sent = await send();
  assert.strictEqual(sent.retrievals, 0, '同一查询的实发应命中预览的检索结果');
  assert.deepStrictEqual(sent.events.slice(-2), [[events.CHAT_COMPLETION_PROMPT_READY, false], [events.GENERATE_AFTER_DATA, false, false]]);
  assert.strictEqual(requests.length, 1, '应恰好发出一次模型请求');
  assert.deepStrictEqual(requests[0].messages, first.messages, '实发请求消息须与预览逐字、逐角色一致');
  assert.strictEqual(await page.evaluate(() => getActiveSession(getChar().id).stscriptVars.scriptLeak), undefined, '预览中的脚本写入不得落地');

  // The next round draws anew, and a saved setting change rebuilds the preview with that same draw; the EJS
  // counter moves only with the send.
  await page.evaluate(() => schedulePresetRoundPreview());
  await settle();
  const renewed = await page.evaluate(() => window.__previews.at(-1).messages);
  assert.notStrictEqual(draws(renewed).rand, draws(first.messages).rand, '发送后下一轮应重新抽取随机结果');
  assert.ok(text(renewed).includes('EJS_VAR2'), '实发写入的 EJS 变量应被下一轮读到');
  await page.evaluate(() => switchCompletionPresetTab('note'));
  await page.locator('#pm-authors-note').fill('PARITY_NOTE');
  await settle();
  await page.evaluate(async () => { await savePromptManager(); switchCompletionPresetTab('order'); });
  await page.evaluate(() => schedulePresetRoundPreview());
  await settle();
  const previewed = await page.evaluate(() => window.__previews.at(-1).messages);
  assert.ok(previewed.some(message => String(message.content).includes('PARITY_NOTE')), '保存后的预览应含新作者注记');
  assert.deepStrictEqual(draws(previewed), draws(renewed), '设置变化不得重抽本轮随机');
  assert.ok(text(previewed).includes('EJS_VAR2'), '预览不得提交 EJS 变量');
  assert.strictEqual((await send()).retrievals, 0, '同一查询的实发应命中预览的检索结果');
  assert.deepStrictEqual(requests[1].messages, previewed, '设置变化后实发仍须与预览一致');

  // The filter runs on every assembly: closing the gate drops the injection from the next preview.
  const gated = await page.evaluate(async () => {
    await executeStscript('/setvar key=parityGate false', {handleParserErrors: false, handleExecutionErrors: false});
    return (await buildPresetRoundPreview()).text.includes('INJECT_GATED');
  });
  assert.strictEqual(gated, false, '过滤闭包应在每次组装时执行');

  // A regex draw belongs to the text it transforms: one more transformed message ahead of it changes nothing.
  const regexDraws = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id), target = () => bindGenerationTargetOwnership(
      {charId: char.id, sessionId: session.id, mode: 'new'}, session);
    const last = async rows => {
      const result = await assembleGenerationPrompt(char, session, rows, target(), {preview: true});
      return (result.messages.map(message => String(message.content)).join('\n').match(/APPLE_RX\w+ follow-up/) || [''])[0];
    };
    return [await last(session.msgs), await last([{role: 'user', content: 'apple zero', seq: 0}].concat(session.msgs))];
  });
  assert.ok(regexDraws[0], '应读到正则随机');
  assert.strictEqual(regexDraws[1], regexDraws[0], '正则随机须由本轮种子与所转换的文本决定，不依赖转换顺序');

  // A failing Data Bank search in a preview is a note, not a toast.
  const next = await page.evaluate(async () => {
    const session = getActiveSession(getChar().id), toasts = [], originalToast = toast;
    session.msgs.push({role: 'user', content: 'banana next', seq: session.nextMessageSeq++});
    window.__embeddingFails = true;
    window.toast = function (message) { toasts.push(String(message)); return originalToast.apply(this, arguments); };
    try {
      switchAppPage('presets');
      const result = await buildPresetRoundPreview();
      return {messages: result.messages, stats: result.stats, toasts};
    } finally { window.toast = originalToast; window.__embeddingFails = false; }
  });
  assert.deepStrictEqual(next.toasts, [], '预览中的检索失败不得弹出提示');
  assert.ok(next.stats.includes('资料库附件检索失败'), '预览应注记资料库检索失败');

  // A preview whose card listener never returns is over once a send starts: the send's writes and toasts land, and so
  // does what the card writes afterwards.
  const hung = await page.evaluate(async () => {
    const owner = {kind: 'library'}, events = CARD_FRONTEND_TAVERN_EVENT_VALUES, session = getActiveSession(getChar().id);
    const dropped = () => ({write: cardFrontendDryRunCall(owner, 'replaceVariables', {value: {}}) !== null,
      toast: cardFrontendInDryRun(owner)});
    let hanging = false, sending = null;
    cardFrontendRegisterEvent(owner, events.GENERATION_STARTED, async (type, options, dryRun) => {
      if (!dryRun) { sending = dropped(); return; }
      if (hanging) return;
      hanging = true;
      await new Promise(() => {});
    }, false);
    try {
      const preview = schedulePresetRoundPreview();
      while (!hanging) await new Promise(resolve => setTimeout(resolve, 0));
      const during = dropped();
      switchAppPage('chat');
      await regenerateLast();
      await _generationPostCommitTasks.get(session);
      await preview;
      while (_presetRoundPreviewRun) await _presetRoundPreviewRun;
      session.msgs.pop();
      return {during, sending, after: dropped()};
    } finally {
      cardFrontendClearOwnerRegistrations(owner);
      switchAppPage('presets'); switchCompletionPresetTab('order');
    }
  });
  assert.deepStrictEqual(hung, {during: {write: true, toast: true}, sending: {write: false, toast: false},
    after: {write: false, toast: false}}, '预览挂起的卡片监听器不得让实发及之后的写入与提示被丢弃');

  // A send takes its round as it starts: a preview opened while that send is still assembling shows the next round,
  // and the send after it uses that round.
  const overlap = await page.evaluate(async () => {
    const owner = {kind: 'library'}, events = CARD_FRONTEND_TAVERN_EVENT_VALUES, session = getActiveSession(getChar().id);
    let release, held = false;
    const gate = new Promise(resolve => { release = resolve; });
    cardFrontendRegisterEvent(owner, events.CHAT_COMPLETION_PROMPT_READY, async data => {
      if (data.dryRun) return;
      held = true;
      await gate;
    }, false);
    try {
      switchAppPage('chat');
      const sending = regenerateLast();
      while (!held) await new Promise(resolve => setTimeout(resolve, 0));
      switchAppPage('presets'); switchCompletionPresetTab('order');
      const preview = await buildPresetRoundPreview();
      release();
      await sending;
      await _generationPostCommitTasks.get(session);
      session.msgs.pop();
      return preview.messages;
    } finally {
      release();
      cardFrontendClearOwnerRegistrations(owner);
      switchAppPage('presets'); switchCompletionPresetTab('order');
    }
  });
  assert.notStrictEqual(draws(overlap).rand, draws(requests.at(-1).messages).rand, '实发组装中打开的预览应是下一轮');
  await send();
  assert.deepStrictEqual(draws(requests.at(-1).messages), draws(overlap), '预览之后的实发须用该预览那一轮');

  // The preview never overlaps a generation that dispatches card events: opened or refreshed while a reply or a silent
  // card generation runs, it waits without a dry run, the generation's writes and toasts land, and it catches up
  // afterwards without reporting a failure.
  const heldOff = await page.evaluate(async () => {
    const owner = {kind: 'library', charId: getChar().id, owner: {sessionId: getActiveSession(getChar().id).id}},
      events = CARD_FRONTEND_TAVERN_EVENT_VALUES, session = getActiveSession(getChar().id);
    const dropped = () => ({write: cardFrontendDryRunCall(owner, 'replaceVariables', {value: {}}) !== null,
      toast: cardFrontendInDryRun(owner)});
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    let release = null, held = false, dryRuns = 0;
    const writes = {};
    cardFrontendRegisterEvent(owner, events.CHAT_COMPLETION_PROMPT_READY, async data => {
      if (data.dryRun) { dryRuns++; return; }
      if (release) { held = true; await new Promise(resolve => { const open = release; release = () => { open(); resolve(); }; }); }
      writes.prompt = dropped();
    }, false);
    cardFrontendRegisterEvent(owner, events.GENERATE_AFTER_DATA, (data, dryRun) => { if (!dryRun) writes.data = dropped(); }, false);
    cardFrontendRegisterEvent(owner, events.MESSAGE_RECEIVED, () => { writes.received = dropped(); }, false);
    const stats = () => $('prompt-stats-box').textContent;
    async function during(start) {
      held = false; dryRuns = 0;
      release = () => {};
      const running = start();
      while (!held) await tick();
      const builds = window.__previews.length;
      const shown = schedulePresetRoundPreview();
      for (let index = 0; index < 5; index++) await tick();
      const waiting = {dryRuns, built: window.__previews.length - builds, waiting: stats().includes('结束后自动更新预览')};
      release(); release = null;
      await running;
      const shownAfter = await shown;
      return {waiting, shown: shownAfter, rebuilt: window.__previews.length > builds, failed: stats().includes('预览生成失败')};
    }
    try {
      const expanded = _presetRoundPreviewExpanded;
      const reply = await during(() => regenerateLast());
      session.msgs.pop();
      const replyWrites = Object.assign({}, writes);
      Object.keys(writes).forEach(key => delete writes[key]);
      const silent = await during(() => executeCardFrontendGeneration({user_input: 'x', should_silence: true}, owner, false));
      return {expanded, reply, replyWrites, silent, silentWrites: Object.assign({}, writes)};
    } finally {
      cardFrontendClearOwnerRegistrations(owner);
    }
  });
  const clean = {write: false, toast: false}, heldPreview = {waiting: {dryRuns: 0, built: 0, waiting: true}, shown: true, rebuilt: true,
    failed: false};
  assert.deepStrictEqual(heldOff, {expanded: true, reply: heldPreview, replyWrites: {prompt: clean, data: clean, received: clean},
    silent: heldPreview, silentWrites: {prompt: clean, data: clean}},
    '回复或静默卡片生成期间预览须等待且不派发 dryRun，实发写入与提示生效，结束后自动补建且不显示失败');

  // A generation that ends without a reply still reports GENERATION_ENDED to card scripts; the preview waits for that
  // listener too and catches up once it returns.
  failRequests = true;
  const endedOff = await page.evaluate(async () => {
    const owner = {kind: 'library'}, events = CARD_FRONTEND_TAVERN_EVENT_VALUES, session = getActiveSession(getChar().id);
    const tick = () => new Promise(resolve => setTimeout(resolve, 0)), msgs = session.msgs.slice();
    let release, held = false;
    const gate = new Promise(resolve => { release = resolve; });
    cardFrontendRegisterEvent(owner, events.GENERATION_ENDED, async () => { held = true; await gate; }, false);
    try {
      const running = regenerateLast();
      while (!held) await tick();
      const builds = window.__previews.length;
      for (let index = 0; index < 5; index++) await tick();
      const during = {active: cardEventGenerationActive(), built: window.__previews.length - builds};
      release();
      await running;
      while (cardEventGenerationActive() || _presetRoundPreviewRun) await (_presetRoundPreviewRun || tick());
      return {during, rebuilt: window.__previews.length > builds};
    } finally {
      release();
      cardFrontendClearOwnerRegistrations(owner);
      session.msgs.splice(0, session.msgs.length, ...msgs);
    }
  });
  failRequests = false;
  assert.deepStrictEqual(endedOff, {during: {active: true, built: 0}, rebuilt: true},
    '无回复的生成在 GENERATION_ENDED 监听返回前仍算生成中，预览等其结束后才补建');

  // Copying while a generation holds the preview off copies the catch-up after it; leaving the page first copies
  // nothing and reports nothing.
  const copied = await page.evaluate(async () => {
    const owner = {kind: 'library'}, events = CARD_FRONTEND_TAVERN_EVENT_VALUES, session = getActiveSession(getChar().id);
    const tick = () => new Promise(resolve => setTimeout(resolve, 0)), msgs = session.msgs.slice();
    const toasts = [], clips = [], originalToast = toast, originalWrite = navigator.clipboard.writeText;
    let gate = null, release = () => {}, held = false;
    const hold = () => { held = false; gate = new Promise(resolve => { release = resolve; }); };
    window.toast = function (message) {
      if (/预览|复制/.test(String(message))) toasts.push(String(message));
      return originalToast.apply(this, arguments);
    };
    navigator.clipboard.writeText = async text => { clips.push(text); };
    cardFrontendRegisterEvent(owner, events.CHAT_COMPLETION_PROMPT_READY, async data => {
      if (data.dryRun || !gate) return;
      held = true;
      await gate;
    }, false);
    async function copyDuring(between) {
      toasts.length = 0; clips.length = 0;
      hold();
      const running = regenerateLast();
      while (!held) await tick();
      const copying = copyPresetRoundPreview();
      for (let index = 0; index < 5; index++) await tick();
      const early = {toasts: toasts.slice(), clips: clips.length};
      between();
      gate = null; release();
      await running;
      await copying;
      while (cardEventGenerationActive()) await tick();
      session.msgs.splice(0, session.msgs.length, ...msgs);
      return {early, toasts: toasts.slice(), clipped: clips.length ? clips[0] === $('prompt-preview-box').textContent : null};
    }
    try {
      const waited = await copyDuring(() => {});
      const left = await copyDuring(() => switchAppPage('chat'));
      return {waited, left};
    } finally {
      release();
      window.toast = originalToast;
      navigator.clipboard.writeText = originalWrite;
      cardFrontendClearOwnerRegistrations(owner);
      session.msgs.splice(0, session.msgs.length, ...msgs);
      switchAppPage('presets'); switchCompletionPresetTab('order');
      while (cardEventGenerationActive() || _presetRoundPreviewRun) await (_presetRoundPreviewRun || tick());
    }
  });
  assert.deepStrictEqual(copied, {
    waited: {early: {toasts: [], clips: 0}, toasts: ['预览已复制'], clipped: true},
    left: {early: {toasts: [], clips: 0}, toasts: [], clipped: null},
  }, '生成中复制预览须等结束后的补建再复制，期间离开预设页则不复制也不误报');

  // The preview only builds on the visible preset page: leaving it cancels the build, generations in the chat meanwhile
  // run no dry run, and coming back rebuilds.
  const offPage = await page.evaluate(async () => {
    const session = getActiveSession(getChar().id), msgs = session.msgs.slice();
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const dryRuns = () => window.__scriptEvents.filter(event => event[1] === true).length;
    while (_presetRoundPreviewRun) await _presetRoundPreviewRun;
    const building = schedulePresetRoundPreview(), controller = _presetRoundPreviewController;
    switchAppPage('chat');
    const cancelled = !!controller && controller.signal.aborted;
    await building;
    const builds = window.__previews.length, events = dryRuns();
    try {
      await regenerateLast();
      while (cardEventGenerationActive() || _presetRoundPreviewRun) await (_presetRoundPreviewRun || tick());
      const hidden = {built: window.__previews.length - builds, dryRuns: dryRuns() - events};
      switchAppPage('presets'); switchCompletionPresetTab('order');
      while (_presetRoundPreviewRun) await _presetRoundPreviewRun;
      return {cancelled, hidden, rebuilt: window.__previews.length - builds - hidden.built};
    } finally {
      session.msgs.splice(0, session.msgs.length, ...msgs);
      switchAppPage('presets'); switchCompletionPresetTab('order');
    }
  });
  assert.deepStrictEqual(offPage, {cancelled: true, hidden: {built: 0, dryRuns: 0}, rebuilt: 1},
    '离开预设页须取消预览构建，期间聊天生成结束不得在后台补建，回到预设页再重建');

  // A helper request that never reaches card scripts (translation) leaves a running preview alone.
  const helper = await page.evaluate(async () => {
    const owner = {kind: 'library'}, events = CARD_FRONTEND_TAVERN_EVENT_VALUES;
    let release, hanging = false;
    const gate = new Promise(resolve => { release = resolve; });
    cardFrontendRegisterEvent(owner, events.GENERATION_STARTED, async (type, options, dryRun) => {
      if (!dryRun || hanging) return;
      hanging = true;
      await gate;
    }, false);
    try {
      const preview = schedulePresetRoundPreview();
      while (!hanging) await new Promise(resolve => setTimeout(resolve, 0));
      const controller = _presetRoundPreviewController;
      const translating = translateMessage(0);
      const kept = _generationState !== 'idle' && !controller.signal.aborted;
      await translating;
      release();
      await preview;
      return {kept, failed: $('prompt-stats-box').textContent.includes('预览生成失败')};
    } finally {
      release();
      cardFrontendClearOwnerRegistrations(owner);
    }
  });
  assert.deepStrictEqual(helper, {kept: true, failed: false}, '翻译请求不派发卡片事件，不得取消进行中的预览');

  // A card without templates or scripts has nothing of its own that could differ from the send.
  const plain = await page.evaluate(async () => {
    cardFrontendClearOwnerRegistrations(window.__scriptOwner);
    const char = {id: 'parity-plain', name: 'Plain', description: 'PLAIN_CARD'};
    const session = createBlankSession('Plain', 'parity-plain-session');
    session.greetingChosen = true; session.creatorNotesSeen = true;
    session.msgs = [{seq: 1, role: 'user', content: 'hi'}];
    session.nextMessageSeq = 2;
    D.characters.push(char); D.currentCharId = char.id; D.chats[char.id] = {sessions: [session], activeSid: session.id};
    const result = await buildPresetRoundPreview();
    return {shown: result.text.includes('PLAIN_CARD'), noted: result.stats.includes(GENERATION_PROMPT_SCRIPT_VOLATILE_NOTE)};
  });
  assert.deepStrictEqual(plain, {shown: true, noted: false}, '没有模板与脚本的卡片预览不应出现脚本随机注记');

  // MVU replays on the preview's copies: the preview shows the state the send will use, the live chat and runtime
  // keep theirs.
  const mvu = await page.evaluate(async () => {
    cardFrontendClearOwnerRegistrations(window.__scriptOwner);
    const char = {id: 'parity-mvu', name: 'MVU', description: 'MVU_SCORE{{get_message_variable::stat_data.score}}',
      extensions: {yeyu: {componentImportMode: 'full'}, tavern_helper: {scripts: [{id: 'schema', enabled: true, content:
        "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\n" +
        'registerMvuSchema(z.object({score:z.number().prefault(1)}));'}]}}};
    const session = createBlankSession('MVU', 'parity-mvu-session');
    session.greetingChosen = true; session.creatorNotesSeen = true;
    const reply = {seq: 2, role: 'assistant', content: 'plain'};
    session.msgs = [{seq: 1, role: 'user', content: 'hi'}, reply, {seq: 3, role: 'user', content: 'next'}];
    session.nextMessageSeq = 4;
    D.characters.push(char); D.currentCharId = char.id; D.chats[char.id] = {sessions: [session], activeSid: session.id};
    await rebuildMvuSession(char, session, session.msgs);
    reply.content = '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/score","value":2}]</JSONPatch></UpdateVariable>';
    const before = JSON.stringify({record: reply.yeyuMvu, runtime: _mvuRuntime[mvuRuntimeKey(char, session)]});
    const preview = await buildPresetRoundPreview();
    const kept = JSON.stringify({record: reply.yeyuMvu, runtime: _mvuRuntime[mvuRuntimeKey(char, session)]}) === before;
    switchAppPage('chat');
    await regenerateLast();
    await _generationPostCommitTasks.get(session);
    return {shown: preview.text.includes('MVU_SCORE2'), kept, messages: preview.messages};
  });
  assert.strictEqual(mvu.shown, true, '预览应在克隆数据上运行 MVU');
  assert.strictEqual(mvu.kept, true, '预览不得改写真实的 MVU 记录与运行状态');
  assert.deepStrictEqual(requests.at(-1).messages, mvu.messages, 'MVU 卡的实发须与预览一致');
  assert.deepStrictEqual(errors, []);
  console.log(JSON.stringify({previewMatchesSend: true, settingChangeKeepsDraw: true, retrievalCached: true, previewIsolated: true,
    dryRunScripts: true, mvuOnCopies: true, previewEndsBeforeSend: true, overlappingPreviewNextRound: true,
    previewWaitsForCardEventGenerations: true, previewWaitsForGenerationEnded: true, copyWaitsForCatchUp: true,
    previewOnlyOnPresetPage: true, helperRequestKeepsPreview: true}));
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});
