'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');

const assetsRoot = path.resolve(__dirname, '../../app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({
    executablePath: resolveEdgeExecutable(),
    headless: true,
  });
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  const result = await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = false;
    D.settings.maxContextTokens = 0;
    D.settings.maxTokens = 0;
    const char = parseCard({name: '正则主路径', description: '合成角色', first_mes: ''});
    char.id = 'regex-render-send';
    char.regexScripts = [
      normalizeRegexScriptRecord({id: 'display', findRegex: '/DISPLAY/g', replaceString: '已显示', targetAssistant: true, applyDisplay: true, enabled: true}),
      normalizeRegexScriptRecord({id: 'send', findRegex: '/SEND/g', replaceString: '已发送', targetAssistant: true, applySend: true, enabled: true}),
    ];
    const session = createBlankSession('正则会话', 'regex-render-session');
    session.msgs.push({role: 'assistant', content: 'DISPLAY SEND', time: 1, seq: 1});
    session.nextMessageSeq = 2;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    invalidateRegexScriptRuntimeCache();
    await prepareRegexScriptDisplayTexts(char, session.msgs);
    renderChat();

    let sentMessages = [];
    const originalTransport = callDeepSeek;
    callDeepSeek = async (messages) => {
      sentMessages = messages;
      return {content: 'DISPLAY SEND', display: 'DISPLAY SEND', reasoning: '', finishReason: 'stop'};
    };
    try {
      await doSendMessage('发送一次');
      while (_generationState !== 'idle' || _cardScriptTextPending.size) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const stored = (await YeyuRepository.load()).data.chats[char.id].sessions[0];
      const reply = session.msgs.at(-1);
      const presetRollback = [];
      for (const action of ['apply', 'save', 'delete']) {
        const global = {id: `rollback-global-${action}`, enabled: false};
        const scoped = {id: `rollback-char-${action}`, enabled: false};
        D.settings.regexScripts = [global];
        char.regexScripts = [scoped];
        const target = {id: `rollback-${action}`, name: `Rollback ${action}`,
          global: [{id: global.id}], scoped: [{id: scoped.id}], preset: [], isSelected: false};
        const selected = {id: `selected-${action}`, name: 'Selected', global: [], scoped: [], preset: [], isSelected: true};
        D.settings.regexPresets = [target, selected];
        D.settings.activeRegexPresetId = selected.id;
        const settings = D.settings, chats = D.chats, realSave = saveData;
        saveData = async () => { throw new Error('synthetic preset save failure'); };
        try {
          await (action === 'apply' ? regexPresetApply(target.id, char)
            : action === 'save' ? regexPresetSaveCurrent('', target.id)
              : regexPresetDelete(target.id)).catch(() => false);
        } finally {
          saveData = realSave;
        }
        presetRollback.push({
          action,
          identities: D.settings === settings && D.chats === chats && settings.regexPresets[0] === target,
          restored: settings.activeRegexPresetId === selected.id && !target.isSelected && selected.isSelected
            && !global.enabled && !scoped.enabled,
        });
      }
      return {
        historyDisplayed: $('chat-messages').textContent.includes('已显示'),
        historySent: sentMessages.some(message => message.role === 'assistant'
          && message.content.includes('已发送') && !message.content.includes('SEND')),
        rawPreserved: reply.content === 'DISPLAY SEND',
        persisted: stored.msgs.at(-1).content === 'DISPLAY SEND',
        presetRollback,
      };
    } finally {
      callDeepSeek = originalTransport;
    }
  });

  assert.deepStrictEqual(
    {historyDisplayed: result.historyDisplayed, historySent: result.historySent,
      rawPreserved: result.rawPreserved, persisted: result.persisted},
    {historyDisplayed: true, historySent: true, rawPreserved: true, persisted: true}
  );
  for (const proof of result.presetRollback) {
    assert.ok(proof.identities && proof.restored, JSON.stringify(proof));
  }

  // The regex page manages the scripts of the chat completion preset in use like ST: every row
  // action writes straight back into that preset, which keeps its other and unknown fields.
  const managed = await page.evaluate(async () => {
    const char = getChar();
    const presetRow = (id, find, replace, extra) => Object.assign({id, scriptName: id, findRegex: find,
      replaceString: replace, trimStrings: [], placement: [2], disabled: false, markdownOnly: true,
      promptOnly: false, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null}, extra || {});
    const p1 = presetRawDefault();
    p1.futureRoot = {kept: true};
    p1.extensions = Object.assign({}, p1.extensions, {futureExt: 'kept', apiKey: 'must-not-export',
      regex_scripts: [
        presetRow('pa', '/PDISP/g', '预设显示', {futureRow: 'kept-row'}),
        presetRow('pb', '/PSEND/g', '预设已发送', {disabled: true, markdownOnly: false, promptOnly: true}),
        presetRow('pc', '/PDEL/g', '不应存在'),
        presetRow('pd', '/PMOVE/g', '移到角色', {futureRow: 'moved-row'}),
      ]});
    D.settings.chatCompletionPresets = [{name: 'P1', preset: p1}, {name: 'P2', preset: presetRawDefault()}];
    D.settings.activeChatCompletionPresetName = 'P1';
    D.settings.chatCompletionPresetInUse = cloneData(p1);
    D.settings.regexScripts = [normalizeRegexScriptRecord({id: 'pg', name: '全局转预设', findRegex: '/PGLOB/g',
      replaceString: '全局已转预设', targetAssistant: true, applyDisplay: true, enabled: true})];
    char.regexScripts = [];
    await saveData('meta', {urgent: true});
    invalidateRegexScriptRuntimeCache();
    renderRegexScriptManager();
    const group = document.querySelector('[data-regex-group="preset"]');
    const ui = {
      toggles: group.querySelectorAll('.regex-script-toggle input').length,
      edits: group.querySelectorAll('button[onclick^="openRegexScriptEditor"]').length,
      deletes: group.querySelectorAll('button[onclick^="deleteRegexScript"]').length,
      readOnlyText: group.textContent.includes('只读'),
    };
    // A failed save leaves the preset exactly as it was.
    const realSave = saveData;
    saveData = async () => { throw new Error('synthetic preset regex save failure'); };
    try { await toggleRegexScript('preset', 'in_use', 'pb', true); } finally { saveData = realSave; }
    const rolledBack = D.settings.chatCompletionPresetInUse.extensions.regex_scripts[1].disabled === true
      && D.settings.chatCompletionPresets[0].preset.extensions.regex_scripts[1].disabled === true;

    const editorSave = async (scope, ownerId, id, fill) => {
      openRegexScriptEditor(scope, ownerId, id);
      fill();
      await saveRegexScriptEditor();
    };
    await toggleRegexScript('preset', 'in_use', 'pb', true);
    await editorSave('preset', 'in_use', 'pa', () => { $('regex-script-replace').value = '预设已改显示'; });
    const realConfirm = appConfirm;
    appConfirm = async () => true;
    try { await deleteRegexScript('preset', 'in_use', 'pc'); } finally { appConfirm = realConfirm; }
    await editorSave('preset', 'in_use', 'pd', () => { $('regex-script-owner').value = 'character:' + char.id; });
    await editorSave('global', '', 'pg', () => { $('regex-script-owner').value = 'preset'; });
    await editorSave(undefined, undefined, undefined, () => {
      $('regex-script-owner').value = 'preset';
      $('regex-script-name').value = '预设新建';
      $('regex-script-find').value = '/PNEW/g';
      $('regex-script-replace').value = '预设新建已显示';
    });

    const session = getActiveSession(char.id);
    session.msgs.push({role: 'assistant', content: 'PDISP PSEND PGLOB PNEW PMOVE', time: 3, seq: session.nextMessageSeq});
    session.nextMessageSeq += 1;
    invalidateRegexScriptRuntimeCache();
    invalidateCardScriptDisplayCache(char);
    await prepareRegexScriptDisplayTexts(char, session.msgs);
    renderChat();
    const shown = $('chat-messages').textContent;
    let sent = [];
    const originalTransport = callDeepSeek;
    callDeepSeek = async (messages) => {
      sent = messages;
      return {content: '好', display: '好', reasoning: '', finishReason: 'stop'};
    };
    try {
      await doSendMessage('再发一次');
      while (_generationState !== 'idle' || _cardScriptTextPending.size) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      callDeepSeek = originalTransport;
    }
    const sentText = sent.filter(message => message.role === 'assistant').map(message => message.content).join('\n');
    return {
      ui,
      rolledBack,
      shown: ['预设已改显示', '全局已转预设', '预设新建已显示', '移到角色'].every(text => shown.includes(text)),
      sent: sentText.includes('预设已发送') && !sentText.includes('PSEND'),
      globalLeft: D.settings.regexScripts.length,
      characterRow: (char.regexScripts || []).map(row => ({id: row.id, futureRow: row.raw && row.raw.futureRow})),
    };
  });
  assert.deepStrictEqual(managed.ui, {toggles: 4, edits: 4, deletes: 4, readOnlyText: false});
  assert.ok(managed.rolledBack, '预设正则保存失败必须恢复活动预设与具名预设');
  assert.ok(managed.shown, '预设正则改动后显示必须按新脚本处理');
  assert.ok(managed.sent, '预设正则改动后发送必须按新脚本处理');
  assert.strictEqual(managed.globalLeft, 0, '移入预设的全局脚本不应留在全局');
  assert.deepStrictEqual(managed.characterRow, [{id: 'pd', futureRow: 'moved-row'}]);

  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  const reloaded = await page.evaluate(async () => {
    const summary = raw => (raw.extensions.regex_scripts || []).map(row => ({
      id: row.id, name: row.scriptName, replace: row.replaceString, disabled: row.disabled,
      hasEnabled: Object.prototype.hasOwnProperty.call(row, 'enabled'), futureRow: row.futureRow,
    }));
    const switchTo = async name => {
      loadPromptManager();
      switchPromptPreset(name);
      applyPromptManagerForm();
      await saveData('meta', {urgent: true});
    };
    const afterReload = summary(D.settings.chatCompletionPresetInUse);
    const namedAfterReload = summary(D.settings.chatCompletionPresets[0].preset);
    await switchTo('P2');
    const p2Scripts = (activeCompletionPresetRaw().extensions || {}).regex_scripts || [];
    await switchTo('P1');
    const afterSwitch = summary(D.settings.chatCompletionPresetInUse);
    let exported = null;
    const realExport = saveTextFileExport;
    saveTextFileExport = content => { exported = JSON.parse(content); };
    try {
      loadPromptManager();
      exportPromptPreset();
    } finally {
      saveTextFileExport = realExport;
    }
    return {afterReload, namedAfterReload, p2Scripts: p2Scripts.length, afterSwitch,
      exportedScripts: summary(exported), exportedRoot: exported.futureRoot,
      exportedExt: exported.extensions.futureExt, exportedKey: 'apiKey' in exported.extensions};
  });
  const expectedPresetRows = [
    {id: 'pa', name: 'pa', replace: '预设已改显示', disabled: false, hasEnabled: false, futureRow: 'kept-row'},
    {id: 'pb', name: 'pb', replace: '预设已发送', disabled: false, hasEnabled: false, futureRow: undefined},
    {id: 'pg', name: '全局转预设', replace: '全局已转预设', disabled: false, hasEnabled: false, futureRow: undefined},
  ];
  for (const key of ['afterReload', 'namedAfterReload', 'afterSwitch', 'exportedScripts']) {
    const rows = reloaded[key];
    assert.deepStrictEqual(rows.slice(0, 3), expectedPresetRows, key);
    assert.strictEqual(rows.length, 4, key);
    assert.deepStrictEqual({name: rows[3].name, replace: rows[3].replace, disabled: rows[3].disabled},
      {name: '预设新建', replace: '预设新建已显示', disabled: false}, key);
  }
  assert.strictEqual(reloaded.p2Scripts, 0, '其他预设不应带上 P1 的正则');
  assert.deepStrictEqual(reloaded.exportedRoot, {kept: true});
  assert.strictEqual(reloaded.exportedExt, 'kept');
  assert.strictEqual(reloaded.exportedKey, false, '导出预设必须移除凭据');

  // One journal may record several fields of one object at different times; each field rolls back to
  // the value it had when first recorded.
  const journaled = await page.evaluate(() => {
    const value = {first: 1, second: 1};
    const journal = createMutationJournal();
    journal.capture(value, ['first'], true);
    value.first = 2;
    journal.capture(value, ['first', 'second'], true);
    value.first = 3;
    value.second = 3;
    journal.rollback();
    return value;
  });
  assert.deepStrictEqual(journaled, {first: 1, second: 1}, '同一对象分次记录的字段都必须回滚到首次记录的值');

  // With no preset in use, preset writes land in the default's extensions layer; a failed save
  // restores that layer too, and an open prompt manager keeps its default draft in step.
  const defaultLayer = await page.evaluate(async () => {
    const settings = D.settings;
    settings.activeChatCompletionPresetName = '';
    settings.chatCompletionPresetInUse = null;
    delete settings.chatCompletionPresetDefaultExtensions;
    settings.regexScripts = [normalizeRegexScriptRecord({id: 'dg', name: '默认层', findRegex: '/DGL/g',
      replaceString: '默认层已显示', targetAssistant: true, applyDisplay: true, enabled: true})];
    await saveData('meta', {urgent: true});
    loadPromptManager();
    const moveToPreset = async () => {
      openRegexScriptEditor('global', '', 'dg');
      $('regex-script-owner').value = 'preset';
      await saveRegexScriptEditor();
    };
    const snapshot = () => ({
      global: settings.regexScripts.map(row => row.id),
      layer: ((settings.chatCompletionPresetDefaultExtensions || {}).regex_scripts || []).map(row => row.id),
      draft: (((_completionPresetDefaultRaw || {}).extensions || {}).regex_scripts || []).map(row => row.id),
    });
    const realSave = saveData;
    saveData = async () => { throw new Error('synthetic default layer save failure'); };
    try { await moveToPreset(); } finally { saveData = realSave; }
    const failed = snapshot();
    await moveToPreset();
    return {failed, saved: snapshot()};
  });
  assert.deepStrictEqual(defaultLayer.failed, {global: ['dg'], layer: [], draft: []}, '默认编排层写入失败必须完整回滚');
  assert.deepStrictEqual(defaultLayer.saved, {global: [], layer: ['dg'], draft: ['dg']}, '默认编排层写入须同步已打开的草稿');

  // Hand-written or third-party presets may carry regex rows without an id. They still get one stable
  // identity, so switching, editing and deleting act on the original rows and nothing else.
  await page.evaluate(async () => {
    const row = (name, find, replace, extra) => Object.assign({scriptName: name, findRegex: find, replaceString: replace,
      trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: false,
      substituteRegex: 0, minDepth: null, maxDepth: null}, extra);
    const preset = presetRawDefault();
    preset.extensions = {regex_scripts: [
      row('无号甲', '/NIA/g', '甲', {disabled: true, futureRow: 'a'}),
      row('无号乙', '/NIB/g', '乙', {futureRow: 'b'}),
      row('空号丙', '/NIC/g', '丙', {id: '  '}),
    ]};
    D.settings.regexScripts = [];
    D.settings.chatCompletionPresets = [{name: 'NoId', preset}];
    D.settings.activeChatCompletionPresetName = 'NoId';
    D.settings.chatCompletionPresetInUse = cloneData(preset);
    await saveData('meta', {urgent: true});
  });
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  const idless = await page.evaluate(async () => {
    renderRegexScriptManager();
    const shownIds = Array.from(document.querySelectorAll('[data-regex-group="preset"] button[onclick^="openRegexScriptEditor"]'))
      .map(button => new Function('return [' + button.getAttribute('onclick').replace(/^[^(]*\(|\)[^)]*$/g, '') + ']')()[2]);
    await toggleRegexScript('preset', 'in_use', shownIds[0], true);
    openRegexScriptEditor('preset', 'in_use', shownIds[1]);
    $('regex-script-replace').value = '乙已改';
    await saveRegexScriptEditor();
    const realConfirm = appConfirm;
    appConfirm = async () => true;
    try { await deleteRegexScript('preset', 'in_use', shownIds[2]); } finally { appConfirm = realConfirm; }
    const imported = completionPresetImportRaw('Imported', {prompts: [], prompt_order: [],
      extensions: {regex_scripts: [{scriptName: '导入无号', findRegex: '/x/'}]}}, []).row.preset;
    return {shownIds, globalCount: D.settings.regexScripts.length,
      importedHasId: !!String(imported.extensions.regex_scripts[0].id || '').trim()};
  });
  assert.strictEqual(new Set(idless.shownIds.filter(Boolean)).size, 3, '缺 id 的预设正则必须各有身份');
  assert.strictEqual(idless.globalCount, 0, '编辑缺 id 的预设正则不得生成全局副本');
  assert.ok(idless.importedHasId, '导入的预设须为缺 id 的正则补上身份');
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  const idlessReloaded = await page.evaluate(() => {
    const summary = raw => raw.extensions.regex_scripts.map(row => ({id: row.id, name: row.scriptName,
      replace: row.replaceString, disabled: row.disabled, futureRow: row.futureRow}));
    return {inUse: summary(D.settings.chatCompletionPresetInUse), named: summary(D.settings.chatCompletionPresets[0].preset)};
  });
  const expectedIdless = [
    {id: idless.shownIds[0], name: '无号甲', replace: '甲', disabled: false, futureRow: 'a'},
    {id: idless.shownIds[1], name: '无号乙', replace: '乙已改', disabled: false, futureRow: 'b'},
  ];
  assert.deepStrictEqual(idlessReloaded.inUse, expectedIdless, '缺 id 的预设正则改动必须作用在原行并保持身份');
  assert.deepStrictEqual(idlessReloaded.named, expectedIdless);
  assert.deepStrictEqual(pageErrors, []);
  console.log('regex render/send main path passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
