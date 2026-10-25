/* global regexWorkerRuns -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';
const {createAssetServer, selectAppOption} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/regex_scripts_card.json'), 'utf8'));

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
  // Editing and moving scripts must preserve execution order through the real editor and storage.
  await page.evaluate(() => {
    D = defaults();
    D.characters = [{id: 'char-1', name: '角色一', regexScripts: []}];
    D.settings.regexScripts = ['A', 'B', 'C'].map(name => normalizeRegexScriptRecord({
      id: name.toLowerCase(), name, findRegex: '/x/', replaceString: '',
      targetAssistant: true, applyDisplay: true, enabled: true
    }));
    openRegexScriptEditor('global', '', 'b');
  });
  await page.locator('#regex-script-name').fill('B 改名');
  await page.getByRole('button', {name: '保存脚本'}).click();
  await page.waitForFunction(() => !document.getElementById('regex-script-editor-modal').classList.contains('open'));
  const renamed = await page.evaluate(async () => (await window.YeyuRepository.load()).data.settings.regexScripts);
  assert.deepStrictEqual(renamed.map(row => row.id), ['a', 'b', 'c'], '仅改名不得改变正则脚本的执行顺序');
  assert.strictEqual(renamed[1].name, 'B 改名', '改名必须持久化到原位置');
  await page.evaluate(() => openRegexScriptEditor('global', '', 'b'));
  await selectAppOption(page, '#regex-script-owner', 'character:char-1');
  await page.getByRole('button', {name: '保存脚本'}).click();
  await page.waitForFunction(() => !document.getElementById('regex-script-editor-modal').classList.contains('open'));
  const moved = await page.evaluate(async () => {
    const saved = (await window.YeyuRepository.load()).data;
    return {global: saved.settings.regexScripts.map(row => row.id), character: saved.characters[0].regexScripts.map(row => row.id)};
  });
  assert.deepStrictEqual(moved.global, ['a', 'c'], '改归属后脚本必须离开持久化全局列表');
  assert.deepStrictEqual(moved.character, ['b'], '改归属后脚本必须落到持久化角色列表');

  async function savedCharacterScripts() {
    return page.evaluate(async () => {
      await flushPendingSave();
      return (await window.YeyuRepository.load()).data.characters.find(row => row.id === 'regex_char').regexScripts;
    });
  }

  // Count real regex worker runs per script body to prove that warming and building never repeat a script.
  await page.evaluate(() => {
    const call = callScriptWorker;
    window.regexWorkerRuns = new Map();
    window.callScriptWorker = function (handle, message) {
      if (message && message.type === 'standardRegexParts') {
        const key = message.pattern + '/' + message.flags + ' -> ' + message.replaceString;
        regexWorkerRuns.set(key, (regexWorkerRuns.get(key) || 0) + 1);
      }
      return call.apply(this, arguments);
    };
  });

  const setup = await page.evaluate(cardFixture => {
    D = defaults();
    D.settings.authorsNote = '';
    D.settings.useMemory = false;
    D.personas = [{id: 'persona_fixture', name: '测试用户', desc: ''}];
    D.activePersonaId = 'persona_fixture';
    const parsed = parseCard(cardFixture);
    const char = initializeCardForImport(parsed);
    char.id = 'regex_char';
    D.characters = [char];
    D.currentCharId = char.id;
    const session = createBlankSession('正则脚本验证', 'regex_session');
    session.msgs = [
      {seq: 1, role: 'user', content: 'USER_DISPLAY USER_SEND USER_BOTH', time: 1700000000000},
      {seq: 2, role: 'assistant', content: 'AI_DISPLAY ai_send AI_BOTH DISABLED_TOKEN MISSING_DEFAULT', time: 1700000001000}
    ];
    ensureMessageSequences(session);
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    D.settings.regexScripts = [normalizeRegexScriptRecord({
      id: 'fixture_global',
      name: '全局正则脚本',
      findRegex: '/GLOBAL_TOKEN/g',
      replaceString: '全局替换',
      targetUser: true,
      targetAssistant: true,
      applyDisplay: true,
      applySend: true,
      enabled: false,
      raw: {opaqueGlobal: {keep: true}}
    })];
    renderChat();
    const byId = Object.fromEntries(char.regexScripts.map(script => [script.id, script]));
    return {
      total: char.regexScripts.length,
      summary: regexScriptImportSummary(char),
      mapping: Object.fromEntries(Object.entries(byId).map(([id, script]) => [id, {
        enabled: script.enabled,
        user: script.targetUser,
        assistant: script.targetAssistant,
        display: script.applyDisplay,
        send: script.applySend
      }])),
      unrecognizedMacroReason: regexScriptStaticReason(byId.fixture_unsupported_replacement),
      rawPreserved: JSON.stringify(byId.fixture_ai_display.raw.customFixture) === JSON.stringify(cardFixture.data.extensions.regex_scripts[0].customFixture)
    };
  }, fixture);

  assert.strictEqual(setup.total, 10);
  // The fixture's nested-quantifier script compiles, so it is no longer counted as unsafe.
  assert.deepStrictEqual(setup.summary, {total: 10, disabled: 2, unsupportedTarget: 0, worldBook: 0, unsupportedPhase: 0, unsafe: 0, unrecognizedReplacement: 1, replacementMacros: {'raw::$1': 1}});
  assert.deepStrictEqual(setup.mapping.fixture_ai_display, {enabled: true, user: false, assistant: true, display: true, send: false});
  assert.deepStrictEqual(setup.mapping.fixture_ai_send, {enabled: true, user: false, assistant: true, display: false, send: true});
  assert.deepStrictEqual(setup.mapping.fixture_ai_both, {enabled: true, user: false, assistant: true, display: true, send: true});
  assert.deepStrictEqual(setup.mapping.fixture_user_display, {enabled: true, user: true, assistant: false, display: true, send: false});
  assert.deepStrictEqual(setup.mapping.fixture_user_send, {enabled: true, user: true, assistant: false, display: false, send: true});
  assert.deepStrictEqual(setup.mapping.fixture_user_both, {enabled: true, user: true, assistant: false, display: true, send: true});
  assert.strictEqual(setup.mapping.fixture_disabled.enabled, false, 'disabled 项必须默认关闭');
  assert.deepStrictEqual(setup.mapping.fixture_missing_defaults, {enabled: false, user: false, assistant: true, display: true, send: true}, '缺字段项必须默认关闭、仅指向 AI、两环节非破坏性执行');
  // SillyTavern substitutes unconditionally and keeps an unknown marker, so the script still runs.
  assert.strictEqual(setup.unrecognizedMacroReason, '', '含未识别宏的脚本必须照常执行，宏标记原样保留');
  assert.strictEqual(setup.rawPreserved, true);

  const engineParity = await page.evaluate(async () => {
    const allowed = [
      '/(?:(?!<UpdateVariable>)[\\s\\S])*?/g',
      '/<(update)>[\\s\\S]*?<\\/\\1>/g',
      '/<img="(.+?)\\_(.+?)">/g'
    ].map(pattern => regexScriptSafety(pattern));
    // minDepth and maxDepth bound how far back a message may be.
    const depthChar = {id: 'depth', regexScripts: [normalizeRegexScriptRecord({
      id: 'recent-only', findRegex: '/DEPTH/g', replaceString: 'HIT',
      minDepth: 0, maxDepth: 1, targetAssistant: true, applySend: true, enabled: true
    })]};
    const depthOps = [0, 1, 2].map(depth => regexTransformOps(depthChar, 'assistant', 'send', depth).length);
    const removalChar = {id: 'remove', regexScripts: [normalizeRegexScriptRecord({
      id: 'remove-update', findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g', replaceString: '',
      targetAssistant: true, applySend: true, enabled: true
    })]};
    await prepareRegexScriptTexts(removalChar, [{role: 'assistant', phase: 'send', text: '正文<UpdateVariable>{"x":1}</UpdateVariable>结尾'}]);
    const removed = applyRegexScriptsToText('正文<UpdateVariable>{"x":1}</UpdateVariable>结尾', 'assistant', 'send', removalChar).text;
    const summary = regexScriptImportSummary({regexScripts: [
      normalizeRegexScriptRecord({id: 'world', findRegex: '/x/g', replaceString: '', placement: [5], disabled: false}, {imported: true}),
      normalizeRegexScriptRecord({id: 'phase', findRegex: '/x/g', replaceString: '', targetAssistant: true, applyDisplay: false, applySend: false, enabled: true}),
      normalizeRegexScriptRecord({id: 'replacement', findRegex: '/x/g', replaceString: '{{raw::$&}}', targetAssistant: true, applySend: true, enabled: true})
    ]});
    const macroChar = {id: 'macro', regexScripts: [normalizeRegexScriptRecord({id: 'macro', findRegex: '/TOKEN/g', replaceString: '{{setvar::local::value}}{{getvar::local}} {{random:a,b}}', targetAssistant: true, applyDisplay: true, enabled: true})]};
    await prepareRegexScriptTexts(macroChar, [{role: 'assistant', phase: 'display', text: 'TOKEN'}]);
    const standardMacro = applyRegexScriptsToText('TOKEN', 'assistant', 'display', macroChar).text;
    // ESCAPED escapes only the macro values, so the pattern's own groups keep matching.
    const escapedChar = {id: 'escaped', name: 'A.B', regexScripts: [normalizeRegexScriptRecord({
      id: 'escaped', findRegex: '/<{{char}}>(.*?)<\\/{{char}}>/g', replaceString: '[$1]', substituteRegex: 2,
      targetAssistant: true, applySend: true, enabled: true
    })]};
    const escapedInput = '<A.B>hi</A.B> <AxB>hi</AxB>';
    await prepareRegexScriptTexts(escapedChar, [{role: 'assistant', phase: 'send', text: escapedInput}]);
    const escaped = applyRegexScriptsToText(escapedInput, 'assistant', 'send', escapedChar).text;
    // regexFromString falls back to a bare expression for "/abc" and for a literal with bad flags.
    const fallback = ['/abc', '/a/gg'].map(input => regexScriptSafety(input)).map(row => [row.valid, row.pattern, row.flags]);
    // Hidden and /comment rows are is_system in ST and take no depth; a continued reply is -1.
    const row = role => ({role, content: role});
    const depthMatrix = [
      [row('user'), row('assistant'), {role: 'system', kind: 'stscript-comment', content: 'c'}, row('user')],
      [row('user'), row('assistant'), Object.assign(row('assistant'), {hidden: true}), row('user')],
      [row('user'), row('assistant'), row('user'), row('assistant')]
    ].map((rows, index) => Array.from(regexScriptMessageDepths(rows, index === 2 ? {mode: 'continue', messageIndex: 3} : null), depth => depth === undefined ? null : depth));
    return {
      depthMatrix,
      escaped,
      fallback,
      stickyOnce: runStandardReplaceParts('aab', 'a', 'y', 'X').filter(part => part.literal == null).length,
      allowed: allowed.map(row => row.valid),
      depthOps,
      removed,
      summary,
      standardMacro
    };
  });
  assert.deepStrictEqual(engineParity.allowed, [true, true, true], '前瞻、反向引用和惰性量词必须通过脚本判据');
  assert.deepStrictEqual(engineParity.depthOps, [1, 1, 0], 'minDepth 与 maxDepth 必须按官方规则限定消息深度');
  assert.strictEqual(engineParity.removed, '正文结尾', '纯删除脚本必须移除变量更新块');
  assert.deepStrictEqual(engineParity.summary, {total: 3, disabled: 0, unsupportedTarget: 0, worldBook: 1, unsupportedPhase: 1, unsafe: 0, unrecognizedReplacement: 1, replacementMacros: {'raw::$&': 1}});
  assert.match(engineParity.standardMacro, /^value [ab]$/);
  assert.strictEqual(engineParity.escaped, '[hi] <AxB>hi</AxB>', 'ESCAPED 只转义宏值，查找正则自身的分组必须照常生效');
  assert.deepStrictEqual(engineParity.fallback, [[true, '/abc', ''], [true, '/a/gg', '']], '无结尾斜杠或 flags 非法时必须按 ST 回退为裸表达式');
  assert.strictEqual(engineParity.stickyOnce, 1, '只有 y 没有 g 时只替换一次');
  assert.deepStrictEqual(engineParity.depthMatrix, [[2, 1, null, 0], [2, 1, null, 0], [2, 1, 0, -1]], '隐藏与注释消息不占深度，续写目标深度为 -1');

  const slashRegex = await page.evaluate(async () => {
    const char=getChar(), savedPreset=D.settings.chatCompletionPresetInUse, savedScripts=char.regexScripts;
    const run=async text=>(await executeStscriptFromChat(text)).pipe;
    try {
      D.settings.chatCompletionPresetInUse={extensions:{regex_scripts:[{id:'raw-slash',scriptName:'Raw Named Rule',findRegex:'/(?<part>foo)/g',replaceString:'[$<part>]/$1/$&',disabled:false}]}};
      char.regexScripts=[];
      const named=await run('/regex name="Raw Named Rule" foo');
      D.settings.chatCompletionPresetInUse.extensions.regex_scripts[0].disabled=true;
      const disabled=await run('/regex name="Raw Named Rule" foo');
      const unicode=[];
      for(const flags of ['g','gu']) {
        const input='😀字',pattern='(?=.)',expected=input.replace(new RegExp(pattern,flags),'-');
        const literal=await run('/re-replace find=/'+pattern+'/'+flags+' replace=- '+input);
        const command=await run('/re-replace find=/'+pattern+'/'+flags+' cmd="/pass -" '+input);
        const matches=JSON.parse(await run('/re-exec find=/'+pattern+'/'+flags+' '+input));
        const worker=stscriptApplyParts(await callScriptWorker(scriptWorkerHandle('unicode-regex'),{type:'standardRegexParts',input,pattern,flags,replaceString:'-'}));
        unicode.push({expected,literal,command,count:matches.length,expectedCount:Array.from(input.matchAll(new RegExp(pattern,flags))).length,worker});
      }
      return {named,disabled,unicode};
    } finally {D.settings.chatCompletionPresetInUse=savedPreset;char.regexScripts=savedScripts;}
  });
  assert.strictEqual(slashRegex.named,'[foo]/foo/foo','/regex must normalize active raw preset names and preserve named captures');
  assert.strictEqual(slashRegex.disabled,'foo','raw disabled regex must pass input through');
  for(const row of slashRegex.unicode){assert.strictEqual(row.literal,row.expected,JSON.stringify(row));assert.strictEqual(row.command,row.expected,JSON.stringify(row));assert.strictEqual(row.worker,row.expected,JSON.stringify(row));assert.strictEqual(row.count,row.expectedCount,JSON.stringify(row));}
  assert.strictEqual(await page.evaluate(()=>42),42,'empty Unicode matches must leave the page responsive');

  // The greeting picker must show what the conversation will show. The candidates used to reach the
  // preview and the Chinese overview before the card's display scripts had touched them, so a card
  // that rewrites its own text showed the raw source in the dialog and the rewritten text in chat.
  const greetingPreview = await page.evaluate(async () => {
    const char = getChar(), active = getActiveSession(char.id);
    active.macroVars = {preview: 'saved'};
    char.first_mes = '{{setvar::preview::first}}{{getvar::preview}} AI_DISPLAY';
    char.alternate_greetings = ['{{setvar::preview::second}}{{getvar::preview}} AI_DISPLAY', 'AI_DISPLAY {{user}} 尾声'];
    char.regexScripts.push(normalizeRegexScriptRecord({
      id: 'preview-name', name: '预览名字', findRegex: '/{{user}}/g', replaceString: '宏已先展开',
      substituteRegex: 1, targetAssistant: true, applyDisplay: true, enabled: true
    }));
    char.regexScripts.push(normalizeRegexScriptRecord({
      id: 'preview-literal', name: '预览字面宏', findRegex: '/\\{\\{user\\}\\}/g', replaceString: '错误顺序',
      targetAssistant: true, applyDisplay: true, enabled: true
    }));
    const list = () => document.getElementById('greeting-list').textContent;
    const choice = chooseGreeting(char, null);
    for (let i = 0; i < 300 && list().includes('正在生成预览'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    const candidates = getGreetings(char);
    const host = document.createElement('div');
    host.innerHTML = messageHtml(char, {role: 'assistant', content: candidates[2], opening: true}, 0, null, 0);
    const result = {
      text: list(),
      chatBody: host.querySelector('.stream-content-slot').textContent,
      vars: JSON.parse(JSON.stringify(active.macroVars))
    };
    resolveGreetingChoice(null);
    await choice;
    char.regexScripts = char.regexScripts.filter(row => !/^preview-/.test(row.id));
    return result;
  });
  assert(greetingPreview.text.includes('AI显示') && !greetingPreview.text.includes('AI_DISPLAY'), '弹窗预览必须经过卡片的显示正则');
  assert(greetingPreview.text.includes('first') && greetingPreview.text.includes('second'), '每条开场白仍在独立变量副本中预览');
  assert(greetingPreview.chatBody.includes('宏已先展开') && !greetingPreview.chatBody.includes('错误顺序'), '宏必须先于显示正则展开');
  assert.deepStrictEqual(greetingPreview.vars, {preview: 'saved'}, '开场白预览不得改写会话变量');

  // Display regex runs in the terminable worker, so the chat fills in as the worker answers.
  // The bodies must never pass through a frame showing the untransformed text.
  await page.waitForFunction(() => {
    const bubble = document.querySelector('#chat-messages .msg.char .msg-bubble');
    return !!bubble && bubble.textContent.includes('AI显示');
  }, null, {timeout: 20000});
  const display = {
    user: await page.locator('#chat-messages .msg.user .msg-bubble').textContent(),
    assistant: await page.locator('#chat-messages .msg.char .msg-bubble').textContent()
  };
  assert(display.user.includes('用户显示') && display.user.includes('USER_SEND') && display.user.includes('用户两处'), '用户消息显示必须区分仅显示、仅发送与两者');
  assert(!display.user.includes('USER_DISPLAY') && !display.user.includes('USER_BOTH'));
  // fixture_ai_both declares minDepth 3, and this reply is the newest message, so the depth
  // bound must keep it from running in either phase while the other two still apply.
  assert(display.assistant.includes('AI显示') && display.assistant.includes('ai_send'), 'AI 回复显示必须区分显示与发送环节');
  assert(display.assistant.includes('AI_BOTH') && !display.assistant.includes('BOTH|AI_BOTH'), '超出 minDepth 的脚本不得在显示环节执行');
  assert(!display.assistant.includes('AI_DISPLAY'));
  assert(display.assistant.includes('DISABLED_TOKEN') && display.assistant.includes('MISSING_DEFAULT'), '关闭项与缺字段项不得执行');

  // ---- official evaluation-order differences, checked against engine.js runRegexScript ----
  // engine.js runs the replacement callback once per match: {{match}} becomes $0, the groups
  // are substituted with trimStrings applied, and only then is substituteParams called. So a
  // random macro is rolled separately for each match, a macro that arrived inside a capture
  // group is evaluated, and ordered variable macros run in match order.
  const officialOrder = await page.evaluate(async () => {
    const scoped = async (char, entries, read) => {
      await prepareRegexScriptTexts(char, entries);
      return read();
    };
    const originalRandom = Math.random;
    let rolls = 0;
    Math.random = () => { rolls += 1; return originalRandom(); };
    let perMatchRandom;
    let perMatchRolls = 0;
    try {
      const randomChar = {id: 'order-random', regexScripts: [normalizeRegexScriptRecord({
        id: 'random-each', findRegex: '/N/g', replaceString: '{{random:aaa,zzz}}',
        targetAssistant: true, applyDisplay: true, enabled: true
      })]};
      perMatchRandom = await scoped(randomChar, [{role: 'assistant', phase: 'display', text: 'N N'}],
        () => applyRegexScriptsToText('N N', 'assistant', 'display', randomChar).text);
      perMatchRolls = rolls;
    } finally { Math.random = originalRandom; }

    // A capture group whose text is itself a macro must be substituted first and evaluated after.
    const nestedChar = {id: 'order-nested', name: '嵌套宏角色', regexScripts: [normalizeRegexScriptRecord({
      id: 'macro-in-group', findRegex: '/<m>([\\s\\S]*?)<\\/m>/g', replaceString: '[$1]',
      targetAssistant: true, applyDisplay: true, enabled: true
    })]};
    const macroFromGroup = await scoped(nestedChar, [{role: 'assistant', phase: 'display', text: '<m>{{char}}</m>'}],
      () => applyRegexScriptsToText('<m>{{char}}</m>', 'assistant', 'display', nestedChar).text);

    // Ordered side effects: each match writes then reads, so the matches must not share one
    // pre-resolved replacement.
    const orderChar = {id: 'order-vars', regexScripts: [normalizeRegexScriptRecord({
      id: 'ordered-vars', findRegex: '/(\\d)/g', replaceString: '{{setvar::step::$1}}{{getvar::step}}',
      targetAssistant: true, applyDisplay: true, enabled: true
    })]};
    const orderedVars = await scoped(orderChar, [{role: 'assistant', phase: 'display', text: '1 2 3'}],
      () => applyRegexScriptsToText('1 2 3', 'assistant', 'display', orderChar).text);

    // trimStrings apply to each group, never to the literal text around the match.
    const trimChar = {id: 'order-trim', regexScripts: [normalizeRegexScriptRecord({
      id: 'trim-groups-only', findRegex: '/<t>([\\s\\S]*?)<\\/t>/g', replaceString: '[$1]',
      trimStrings: ['X'], targetAssistant: true, applyDisplay: true, enabled: true
    })]};
    const trimScope = await scoped(trimChar, [{role: 'assistant', phase: 'display', text: 'X<t>aXb</t>X'}],
      () => applyRegexScriptsToText('X<t>aXb</t>X', 'assistant', 'display', trimChar).text);
    const trimMacroChar = {id: 'order-trim-macro', name: 'MacroTrim', regexScripts: [normalizeRegexScriptRecord({
      id: 'trim-macro', findRegex: '/<t>([\\s\\S]*?)<\\/t>/g', replaceString: '[$1]',
      trimStrings: ['{{char}}'], targetAssistant: true, applyDisplay: true, enabled: true
    })]};
    const trimMacro = await scoped(trimMacroChar, [{role: 'assistant', phase: 'display', text: '<t>aMacroTrimb</t>'}],
      () => applyRegexScriptsToText('<t>aMacroTrimb</t>', 'assistant', 'display', trimMacroChar).text);
    let trimMacroRolls = 0, absentTrimMacroCalls = 0;
    Math.random = () => { trimMacroRolls += 1; return 0; };
    try {
      const trimPerCaptureChar = {id: 'order-trim-per-capture', regexScripts: [normalizeRegexScriptRecord({
        id: 'trim-per-capture', findRegex: '/(a)(b)/g', replaceString: '$1|$2',
        trimStrings: ['{{random:missing-one,missing-two}}'], targetAssistant: true, applyDisplay: true, enabled: true
      })]};
      await scoped(trimPerCaptureChar, [{role: 'assistant', phase: 'display', text: 'ab'}],
        () => applyRegexScriptsToText('ab', 'assistant', 'display', trimPerCaptureChar).text);
      const originalMacroReplace = replaceCharacterMacros;
      replaceCharacterMacros = function(value) {
        if (String(value) === '{{char}}') absentTrimMacroCalls += 1;
        return originalMacroReplace.apply(this, arguments);
      };
      const trimAbsentCaptureChar = {id: 'order-trim-absent-capture', regexScripts: [normalizeRegexScriptRecord({
        id: 'trim-absent-capture', findRegex: '/(a)|(b)/g', replaceString: '$1$2',
        trimStrings: ['{{char}}'], targetAssistant: true, applyDisplay: true, enabled: true
      })]};
      try { await scoped(trimAbsentCaptureChar, [{role: 'assistant', phase: 'display', text: 'ab'}],
        () => applyRegexScriptsToText('ab', 'assistant', 'display', trimAbsentCaptureChar).text); }
      finally { replaceCharacterMacros = originalMacroReplace; }
    } finally { Math.random = originalRandom; }

    // A group that did not participate contributes the empty string, as engine.js does.
    const absentChar = {id: 'order-absent', regexScripts: [normalizeRegexScriptRecord({
      id: 'absent-group', findRegex: '/(a)|(b)/g', replaceString: '<$1$2>',
      targetAssistant: true, applyDisplay: true, enabled: true
    })]};
    const absentGroup = await scoped(absentChar, [{role: 'assistant', phase: 'display', text: 'ab'}],
      () => applyRegexScriptsToText('ab', 'assistant', 'display', absentChar).text);

    return {perMatchRandom, perMatchRolls, macroFromGroup, orderedVars, trimScope, trimMacro, trimMacroRolls, absentTrimMacroCalls, absentGroup};
  });
  assert.match(officialOrder.perMatchRandom, /^(aaa|zzz) (aaa|zzz)$/, '两处匹配都必须产生随机结果');
  assert.ok(officialOrder.perMatchRolls >= 2,
    'global 正则的每个匹配必须分别求值 replacement 中的随机宏，实际取随机次数：' + officialOrder.perMatchRolls);
  assert.strictEqual(officialOrder.macroFromGroup, '[嵌套宏角色]',
    '捕获组自身包含宏时，必须先代入捕获组再解析其中的宏');
  assert.strictEqual(officialOrder.orderedVars, '1 2 3',
    '有顺序副作用的变量宏必须按匹配顺序执行');
  assert.strictEqual(officialOrder.trimScope, 'X[ab]X',
    'trimStrings 只作用于捕获组，匹配之外的同名文本必须保留');
  assert.strictEqual(officialOrder.trimMacro, '[ab]',
    'trimStrings 必须先按 ST 官方顺序求值宏，再从捕获组中移除');
  assert.ok(officialOrder.trimMacroRolls >= 2,
    'trimStrings 的状态宏必须为每个捕获占位分别求值，实际取随机次数：' + officialOrder.trimMacroRolls);
  assert.strictEqual(officialOrder.absentTrimMacroCalls, 2,
    '未参与的捕获组不得求值 trimStrings 状态宏；两个匹配应只执行两次，实际：' + officialOrder.absentTrimMacroCalls);
  assert.strictEqual(officialOrder.absentGroup, '<a><b>',
    '未参与匹配的捕获组必须代入空字符串');

  const execution = await page.evaluate(async cardFixture => {
    const char = getChar();
    const session = getActiveSession(char.id);
    const storedBefore = session.msgs.map(message => message.content);
    // The prompt builder reads a warmed cache; the pre-warm and the builder derive the text
    // from the same function, so warming these exact rows is what production does.
    regexWorkerRuns.clear();
    await prepareRegexScriptsForPrompt(char, session.msgs);
    const built = buildMessages(char, session.msgs, session, {commit: false});
    const sendCounts = Object.fromEntries(regexWorkerRuns);
    const requestRows = built.messages.filter(message => message.role === 'user' || message.role === 'assistant');
    return {
      requestUser: requestRows.find(message => message.role === 'user' && message.content.includes('USER_DISPLAY')).content,
      requestAssistant: requestRows.find(message => message.role === 'assistant' && message.content.includes('AI_DISPLAY')).content,
      storedBefore,
      storedAfter: session.msgs.map(message => message.content),
      sendCounts,
      sendCountValues: Object.values(sendCounts)
    };
  }, fixture);
  // Every script that ran did so once, in one dialect, in the send phase.
  assert(Object.keys(execution.sendCounts).length > 0, '发送环节必须真实执行了脚本');
  assert(execution.sendCountValues.every(count => count === 1), '同一脚本在一次发送预热中不得执行多于一次：' + JSON.stringify(execution.sendCounts));
  assert(execution.requestUser.includes('USER_DISPLAY') && execution.requestUser.includes('用户发送') && execution.requestUser.includes('用户两处'), '用户消息请求体必须区分三种环节');
  assert(!execution.requestUser.includes('USER_SEND') && !execution.requestUser.includes('USER_BOTH'));
  assert(execution.requestAssistant.includes('AI_DISPLAY') && execution.requestAssistant.includes('AI发送'), 'AI 回复请求体必须区分显示与发送环节');
  assert(execution.requestAssistant.includes('AI_BOTH') && !execution.requestAssistant.includes('BOTH|AI_BOTH'), '超出 minDepth 的脚本不得在发送环节执行');
  assert(!execution.requestAssistant.includes('ai_send'));
  assert.deepStrictEqual(execution.storedAfter, execution.storedBefore, '显示与请求构建不得改写存储消息');

  const worldBookExecution = await page.evaluate(async () => {
    // World book text only exists during a build, so production runs a throwaway build,
    // warms what it reports, then builds for real. The same two passes are needed here.
    // A new user turn opens a new evaluation scope; a continuation inside the same turn keeps
    // the scope so the frozen results of that round are reused rather than re-rolled.
    async function buildWarmed(character, rows, sess, options, newScope) {
      if (newScope !== false) beginRegexScriptSendScope();
      regexScriptDrainSendMisses();
      buildMessages(character, rows, sess, Object.assign({}, options, {commit: false}));
      const misses = regexScriptDrainSendMisses();
      if (misses.length) await prepareRegexScriptTexts(character, misses);
      lastWarmCounts = [...regexWorkerRuns.values()].reduce((total, count) => total + count, 0);
      const built = buildMessages(character, rows, sess, options);
      lastCommitCounts = [...regexWorkerRuns.values()].reduce((total, count) => total + count, 0);
      return built;
    }
    let lastWarmCounts = 0;
    let lastCommitCounts = 0;
    const originalWorldBook = D.worldBook;
    const originalGlobals = D.settings.regexScripts;
    const originalCharacters = D.characters;
    const originalCurrentCharId = D.currentCharId;
    const originalChats = D.chats;
    const originalRandom = Math.random;
    function script(id, findRegex, replaceString, extra) {
      return normalizeRegexScriptRecord(Object.assign({id, name: id, findRegex, replaceString, targetWorldBook: true, applySend: true, enabled: true}, extra || {}));
    }
    function entry(id, content, keys, extra) {
      return normalizeWBEntry(Object.assign({id, content, keys: keys || ['needle'], enabled: true, probability: 100, insertion_order: 100}, extra || {}));
    }
    function setBook(entries, tokenBudget, recursive) {
      D.worldBook = {
        scan_depth: 20, token_budget: tokenBudget || 0, recursive: recursive === true, caseSensitive: false,
        categories: [{id: 'regex-worldbook', name: '正则世界书', settings: {scan_depth: 20, token_budget: tokenBudget || 0, recursive: recursive === true, caseSensitive: false}, entries}],
        globalCategoryIds: ['regex-worldbook'], activeCategoryId: 'regex-worldbook'
      };
    }
    function promptText(built) { return built.messages.map(message => String(message.content || '')).join('\n'); }
    try {
      const char = Object.assign({}, getChar(), {id: 'regex-worldbook-char'});
      const foreign = {id: 'foreign-char', name: '其他角色', regexScripts: [script('foreign', '/FOREIGN/g', 'WRONG_SCOPE')]};
      char.regexScripts = [
        script('character-order', '/GLOBAL_ORDER/g', 'CHARACTER_ORDER'),
        script('character-random', '/RANDOM_TOKEN/g', '{{random:FROZEN_A,FROZEN_B}}'),
        script('character-disabled', '/DISABLED_TOKEN/g', 'DISABLED_CHANGED', {enabled: false}),
        script('character-display-only', '/DISPLAY_ONLY/g', 'DISPLAY_CHANGED', {applyDisplay: true, applySend: false}),
        script('character-empty', '/EMPTY_TOKEN/g', '')
      ];
      D.settings.regexScripts = [
        script('global-order', '/ORDER_TOKEN/g', 'GLOBAL_ORDER'),
        script('global-recursive', '/RECURSIVE_SEED/g', 'RECURSIVE_TRIGGER'),
        script('global-foreign', '/FOREIGN/g', 'GLOBAL_SCOPE')
      ];
      D.characters = [char, foreign];
      D.currentCharId = char.id;
      const session = createBlankSession('世界书正则验证', 'regex-worldbook-session');
      session.msgs = [{seq: 1, role: 'user', content: 'needle', time: 1700000010000}];
      D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
      setBook([
        entry('ordered', 'ORDER_TOKEN'),
        entry('random', 'RANDOM_TOKEN'),
        entry('disabled', 'DISABLED_TOKEN'),
        entry('display-only', 'DISPLAY_ONLY'),
        entry('foreign', 'FOREIGN'),
        entry('inactive', 'INACTIVE_TOKEN', ['never']),
        entry('recursive-seed', 'RECURSIVE_SEED', [], {constant: true}),
        entry('recursive-target', 'RECURSIVE_WRONG', ['RECURSIVE_TRIGGER']),
        entry('empty', 'EMPTY_TOKEN')
      ], 0, true);
      Math.random = () => 0;
      regexWorkerRuns.clear();
      const first = await buildWarmed(char, session.msgs, session, {commit: true});
      // The discovery pass and the committed build share one scope-memoised world book result,
      // so the two passes together must not run any script twice.
      const firstText = promptText(first);
      const sourceContents = D.worldBook.categories[0].entries.map(row => row.content);
      session.msgs.push({seq: 2, role: 'assistant', content: 'partial', time: 1700000011000});
      setBook(D.worldBook.categories[0].entries.concat([entry('continuation-new', 'RANDOM_TOKEN NEW_ENTRY', [], {constant: true})]), 0, true);
      Math.random = () => 0.999999;
      const continued = await buildWarmed(char, session.msgs, session, {commit: true, generationTarget: {mode: 'continue', messageIndex: 1}}, false);
      const continuedText = promptText(continued);
      session.msgs.push({seq: 3, role: 'user', content: 'needle', time: 1700000012000});
      const nextRound = await buildWarmed(char, session.msgs, session, {commit: true});
      const nextRoundText = promptText(nextRound);

      const exportSource = normalizeRegexScriptRecord({id: 'roundtrip-world', name: '往返世界书', findRegex: '/x/g', replaceString: 'y', placement: [5], promptOnly: true, disabled: true, opaque: {keep: true}}, {imported: true});
      const exported = exportRegexScriptRecord(exportSource);
      const reimported = normalizeRegexScriptRecord(exported, {imported: true});
      const mixed = normalizeRegexScriptRecord({id: 'mixed', findRegex: '/MIXED/g', replaceString: 'MIXED_OK', placement: [2, 5], promptOnly: true, disabled: false}, {imported: true});
      const unsupported = [3, 6].map(placement => regexScriptStaticStatus(normalizeRegexScriptRecord({id: 'unsupported-'+placement, findRegex: '/x/g', replaceString: 'y', placement: [placement], promptOnly: true, disabled: false}, {imported: true})).kind);

      setBook([entry('budget', 'EXPAND_TOKEN', [], {constant: true})], 1, false);
      D.settings.regexScripts = [script('expand', '/EXPAND_TOKEN/g', 'X'.repeat(120))];
      char.regexScripts = [];
      const budgetSession = createBlankSession('改写后预算验证', 'regex-worldbook-budget-session');
      budgetSession.msgs = [{seq: 1, role: 'user', content: 'budget', time: 1700000013000}];
      D.chats[char.id] = {sessions: [budgetSession], activeSid: budgetSession.id};
      const budgetBuilt = await buildWarmed(char, budgetSession.msgs, budgetSession, {commit: false});

      // world-info.js runs WORLD_INFO scripts with isPrompt only, handing @D entries `depth ?? 4`.
      setBook([
        entry('scope-unmarked', 'SCOPE_UNMARKED', [], {constant: true}),
        entry('scope-plain', 'SCOPE_PLAIN', [], {constant: true}),
        entry('scope-deep', 'SCOPE_DEEP', [], {constant: true, position: 'at_depth', depth: 3}),
        entry('scope-near', 'SCOPE_NEAR', [], {constant: true, position: 'at_depth', depth: 1})
      ], 0, false);
      D.settings.regexScripts = [
        normalizeRegexScriptRecord({id: 'scope-unmarked', findRegex: '/SCOPE_UNMARKED/g', replaceString: 'UNMARKED_CHANGED', placement: [5], disabled: false}, {imported: true}),
        normalizeRegexScriptRecord({id: 'scope-prompt', findRegex: '/SCOPE_(PLAIN|DEEP|NEAR)/g', replaceString: 'PROMPT_$1', placement: [5], promptOnly: true, maxDepth: 2, disabled: false}, {imported: true})
      ];
      const scopeText = promptText(await buildWarmed(char, budgetSession.msgs, budgetSession, {commit: false}));
      return {
        scope: ['SCOPE_UNMARKED', 'PROMPT_PLAIN', 'SCOPE_DEEP', 'PROMPT_NEAR', 'UNMARKED_CHANGED', 'PROMPT_DEEP'].map(token => scopeText.includes(token)),
        firstText, continuedText, nextRoundText, sourceContents,
        warmExecutions: lastWarmCounts, commitExecutions: lastCommitCounts,
        firstInjected: first.worldBookMetrics.injected,
        continuedInjected: continued.worldBookMetrics.injected,
        budgetInjected: budgetBuilt.worldBookMetrics.injected,
        roundtrip: {placement: exported.placement, disabled: exported.disabled, opaque: exported.opaque, target: reimported.targetWorldBook, send: reimported.applySend, enabled: reimported.enabled},
        mixed: await (async () => {
          const mixedChar = {id: char.id, regexScripts: [mixed]};
          await prepareRegexScriptTexts(mixedChar, [{role: 'assistant', phase: 'send', text: 'MIXED'}, {role: 'worldbook', phase: 'send', text: 'MIXED'}]);
          return {assistant: mixed.targetAssistant, worldBook: mixed.targetWorldBook,
            assistantText: applyRegexScriptsToText('MIXED', 'assistant', 'send', mixedChar).text,
            worldBookText: applyRegexScriptsToText('MIXED', 'worldbook', 'send', mixedChar).text};
        })(),
        unsupported
      };
    } finally {
      Math.random = originalRandom;
      D.worldBook = originalWorldBook;
      D.settings.regexScripts = originalGlobals;
      D.characters = originalCharacters;
      D.currentCharId = originalCurrentCharId;
      D.chats = originalChats;
      invalidateRegexScriptRuntimeCache();
    }
  });
  assert(worldBookExecution.warmExecutions > 0, '预热必须真实执行了世界书正则');
  assert.strictEqual(worldBookExecution.commitExecutions, worldBookExecution.warmExecutions,
    '正式构建不得重复执行已预热的脚本，预热 ' + worldBookExecution.warmExecutions + ' 次，正式后 ' + worldBookExecution.commitExecutions + ' 次');
  assert(worldBookExecution.firstText.includes('CHARACTER_ORDER'), '世界书脚本必须保持全局在前、角色专属在后的串行顺序');
  assert(worldBookExecution.firstText.includes('FROZEN_A') && !worldBookExecution.firstText.includes('RANDOM_TOKEN'), '世界书替换宏必须进入最终 Prompt');
  assert(worldBookExecution.firstText.includes('DISABLED_TOKEN') && worldBookExecution.firstText.includes('DISPLAY_ONLY'), '关闭脚本与仅显示阶段不得改写世界书');
  assert(worldBookExecution.firstText.includes('GLOBAL_SCOPE') && !worldBookExecution.firstText.includes('WRONG_SCOPE'), '全局脚本必须生效且其他角色脚本不得跨角色执行');
  assert(!worldBookExecution.firstText.includes('INACTIVE_TOKEN') && !worldBookExecution.firstText.includes('RECURSIVE_WRONG'), '未激活条目不得注入，正则结果不得反向触发递归');
  assert(!worldBookExecution.firstText.includes('EMPTY_TOKEN'), '改写为空的世界书正文不得注入');
  assert(worldBookExecution.sourceContents.includes('ORDER_TOKEN') && worldBookExecution.sourceContents.includes('RANDOM_TOKEN') && worldBookExecution.sourceContents.includes('EMPTY_TOKEN'), '世界书源正文不得被改写');
  assert(worldBookExecution.continuedText.includes('FROZEN_A') && worldBookExecution.continuedText.includes('FROZEN_B NEW_ENTRY'), '续写重扫必须带入新增命中，且同一预热周期内既有渲染保持一致');
  assert(worldBookExecution.nextRoundText.includes('FROZEN_B') && !worldBookExecution.nextRoundText.includes('FROZEN_A'), '新用户轮必须重新构建世界书正则结果');
  assert.strictEqual(worldBookExecution.budgetInjected, 0, '世界书预算必须使用改写后的正文长度');
  assert.deepStrictEqual(worldBookExecution.roundtrip, {placement: [5], disabled: true, opaque: {keep: true}, target: true, send: true, enabled: false}, 'placement 5、关闭状态和未知字段必须原样往返');
  assert.deepStrictEqual(worldBookExecution.mixed, {assistant: true, worldBook: true, assistantText: 'MIXED_OK', worldBookText: 'MIXED_OK'}, '混合作用对象必须同时保持 AI 回复与世界书执行');
  assert.deepStrictEqual(worldBookExecution.unsupported, ['target', 'target'], 'placement 3/6 必须继续明确报告为不支持目标');
  assert.deepStrictEqual(worldBookExecution.scope, [true, true, true, true, false, false], '世界书只由 promptOnly 脚本改写，@D 条目按条目深度过滤、其余条目不按深度过滤');

  await page.getByRole('button', {name: '设置'}).last().click();
  await page.getByRole('tab', {name: '正则脚本'}).click();
  await page.waitForFunction(() => document.querySelectorAll('#regex-script-list .regex-script-row').length === 11);
  const nestedRun = await page.evaluate(async () => {
    const char = getChar();
    const nested = (char.regexScripts || []).find(script => /危险规则/.test(String(script.name || '')));
    const probe = {id: 'nested-probe', regexScripts: [nested]};
    regexWorkerRuns.clear();
    await prepareRegexScriptTexts(probe, [{role: 'assistant', phase: 'display', text: 'aaab'}]);
    return {
      reason: regexScriptStaticReason(nested),
      counts: [...regexWorkerRuns.values()].reduce((total, count) => total + count, 0),
      workers: liveScriptWorkerNames().filter(name => name.indexOf('nested-probe') >= 0),
      stopped: stopCardScripts(probe)
    };
  });
  assert.strictEqual(nestedRun.reason, '', '嵌套量词脚本必须被判定为可执行');
  assert.strictEqual(nestedRun.counts, 1, '嵌套量词脚本必须真实执行一次');
  assert.deepStrictEqual(nestedRun.workers, ['card:nested-probe:regex'], '正则必须运行在可终止的正则 Worker 中');
  assert.strictEqual(nestedRun.stopped, true, '该 Worker 必须可被手动停止');


  const disabledCard = page.locator('#regex-script-list .regex-script-row').filter({hasText: '默认关闭项'});
  await disabledCard.locator('.regex-script-toggle').click();
  await page.waitForFunction(() => getChar().regexScripts.find(script => script.id === 'fixture_disabled').enabled === true);
  assert.strictEqual((await savedCharacterScripts()).find(row => row.id === 'fixture_disabled').enabled, true, '启用脚本必须持久化');
  const toggled = await page.evaluate(async () => {
    const char = getChar();
    await prepareRegexScriptTexts(char, [{role: 'assistant', phase: 'display', text: 'DISABLED_TOKEN'}]);
    return applyRegexScriptsToText('DISABLED_TOKEN', 'assistant', 'display', char).text;
  });
  assert.strictEqual(toggled, '不应出现', '管理界面开关必须立即影响执行');
  await disabledCard.locator('.regex-script-toggle').click();
  await page.waitForFunction(() => getChar().regexScripts.find(script => script.id === 'fixture_disabled').enabled === false);

  assert.strictEqual((await savedCharacterScripts()).find(row => row.id === 'fixture_disabled').enabled, false, '停用脚本必须持久化');

  await page.getByRole('button', {name: '新建脚本'}).click();
  await selectAppOption(page,'#regex-script-owner', 'character:regex_char');
  await page.locator('#regex-script-name').fill('界面新增脚本');
  await page.locator('#regex-script-find').fill('/UI_TOKEN/g');
  await page.locator('#regex-script-replace').fill('界面替换');
  await page.locator('#regex-script-target-assistant').uncheck();
  await page.locator('#regex-script-target-worldbook').check();
  await page.locator('#regex-script-phase-display').uncheck();
  await page.locator('#regex-script-phase-send').check();

  await page.getByRole('button', {name: '保存脚本'}).click();
  await page.waitForFunction(() => !document.getElementById('regex-script-editor-modal').classList.contains('open')
    && getChar().regexScripts.some(script => script.name === '界面新增脚本'));
  assert.strictEqual(
    await page.evaluate(async () => {
      const char = getChar();
      await prepareRegexScriptTexts(char, [{role: 'worldbook', phase: 'send', text: 'UI_TOKEN'}]);
      return applyRegexScriptsToText('UI_TOKEN', 'worldbook', 'send', char).text;
    }),
    '界面替换',
    '通过界面手工创建的 AI 回复显示脚本必须立即生效'
  );
  assert((await savedCharacterScripts()).some(row => row.name === '界面新增脚本'), '新增脚本必须持久化');
  let createdCard = page.locator('#regex-script-list .regex-script-row').filter({hasText: '界面新增脚本'});
  await createdCard.getByRole('button', {name: '编辑'}).click();
  assert.strictEqual(await page.locator('#regex-script-target-worldbook').isChecked(), true, '重新打开编辑器必须保留世界书作用对象');
  assert.strictEqual(await page.locator('#regex-script-target-assistant').isChecked(), false, '世界书脚本不得被迫改成 AI 回复脚本');
  await page.locator('#regex-script-replace').fill('界面已编辑');
  await page.getByRole('button', {name: '保存脚本'}).click();
  await page.waitForFunction(() => getChar().regexScripts.some(script => script.name === '界面新增脚本' && script.replaceString === '界面已编辑'));
  assert.strictEqual(
    await page.evaluate(async () => {
      const char = getChar();
      await prepareRegexScriptTexts(char, [{role: 'worldbook', phase: 'send', text: 'UI_TOKEN'}]);
      return applyRegexScriptsToText('UI_TOKEN', 'worldbook', 'send', char).text;
    }),
    '界面已编辑',
    '通过界面编辑后的脚本必须使用新内容执行'
  );
  assert((await savedCharacterScripts()).some(row => row.name === '界面新增脚本' && row.replaceString === '界面已编辑'), '编辑脚本必须持久化');
  createdCard = page.locator('#regex-script-list .regex-script-row').filter({hasText: '界面新增脚本'});
  await createdCard.getByRole('button', {name: '删除'}).click();
  await page.locator('#app-prompt-ok').click();
  await page.waitForFunction(() => !getChar().regexScripts.some(script => script.name === '界面新增脚本'));
  assert(!(await savedCharacterScripts()).some(row => row.name === '界面新增脚本'), '删除脚本必须持久化');

  assert.deepStrictEqual(pageErrors, [], `页面脚本错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);
  console.log('regex scripts browser regression passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
