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
  const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});

  const result = await page.evaluate(async () => {
    D = defaults();
    D.settings.authorsNote = '';
    D.settings.useMemory = false;
    D.settings.assistantPromptOverrides = {
      roleDialogue: {continuation: 'LEGACY_CONTINUATION_OVERRIDE'},
      unknownGroup: {future: {keep: true}},
    };
    const importedRaw = presetRawDefault();
    importedRaw.prompts[0].name = 'Author Main Prompt';
    importedRaw.prompts[1].name = '作者自定义辅助名';
    importedRaw.opaque = {keep: true};
    importedRaw.function_calling = true;
    D.settings.chatCompletionPresets = [{name: 'Author Preset', preset: importedRaw}];
    D.settings.activeChatCompletionPresetName = '';
    D.settings.chatCompletionPresetInUse = presetRawDefault();

    openModal('prompt-manager-modal');
    switchCompletionPresetTab('utility');

    const styleInput = document.getElementById('pm-assistant-prompt-styleAudit-review');
    const expressionInput = document.getElementById('pm-assistant-prompt-expressions-classify');
    document.getElementById('pm-style-audit-enabled').checked = true;
    styleInput.value = 'CUSTOM_STYLE_AUDIT';
    expressionInput.value = 'CUSTOM_EXPRESSION_CLASSIFY';
    const next = applyPromptManagerForm(copyJsonData(D.settings));
    const exported = completionPresetExportRaw('Author Preset', next.chatCompletionPresets);
    D.settings = next;

    const char = {
      id: 'prompt-settings-char', name: '提示词测试角色', description: '', personality: '', scenario: '', first_mes: '',
      mes_example: '', system_prompt: '', post_history_instructions: '', extensions: {yeyu: {future: {keep: true}}},
    };
    const session = createBlankSession('提示词验证', 'prompt-settings-session');
    session.msgs = [
      {seq: 1, role: 'assistant', content: '回复一'},
      {seq: 2, role: 'assistant', content: '回复二'},
      {seq: 3, role: 'assistant', content: '回复三'},
      {seq: 4, role: 'user', content: '继续'},
      {seq: 5, role: 'assistant', content: '未完正文'},
    ];
    ensureMessageSequences(session);
    D.characters = [char];
    D.currentCharId = char.id;
    D.personas = [];
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    const auditMessages = buildStyleAuditMessages(session, char);

    closeModal('prompt-manager-modal');

    switchAppPage('wheels');
    openWheelSchemeManager();
    const biographyInput = document.getElementById('wheel-assistant-prompt-wheelScheme-biography');
    const biographyDefaultShown = biographyInput.value === DEFAULT_WHEEL_SCHEME_BIOGRAPHY_PROMPT;
    biographyInput.value = 'CUSTOM_WHEEL_BIOGRAPHY';
    const originalSaveData = saveData;
    saveData = async () => true;
    await saveWheelSchemeManager();
    openWheelSchemeManager();
    resetAssistantPromptDefaults('wheelScheme', 'wheel-manager');
    const biographyResetToDefault = document.getElementById('wheel-assistant-prompt-wheelScheme-biography').value === DEFAULT_WHEEL_SCHEME_BIOGRAPHY_PROMPT;
    await saveWheelSchemeManager();
    const biographyOverrideDroppedAfterReset = !(D.settings.assistantPromptOverrides.wheelScheme
      && 'biography' in D.settings.assistantPromptOverrides.wheelScheme);
    openWheelSchemeManager();
    document.getElementById('wheel-assistant-prompt-wheelScheme-biography').value = 'CUSTOM_WHEEL_BIOGRAPHY';
    await saveWheelSchemeManager();
    saveData = originalSaveData;

    return {
      styleStored: D.settings.assistantPromptOverrides.styleAudit.review,
      biographyStored: D.settings.assistantPromptOverrides.wheelScheme.biography,
      legacyOverrideKept: D.settings.assistantPromptOverrides.roleDialogue.continuation,
      unknownOverrideKept: D.settings.assistantPromptOverrides.unknownGroup.future.keep,
      styleInjected: auditMessages && auditMessages[0].content,
      exportedAuthorNames: exported.prompts.slice(0, 2).map(row => row.name),
      exportedOpaque: exported.opaque,
      exportedFunctionCalling: exported.function_calling,
      exportedText: JSON.stringify(exported),
      biographyDefaultShown,
      expressionStored: assistantPromptText('expressions', 'classify'),
      biographyResetToDefault,
      biographyOverrideDroppedAfterReset,
      characterExtensionKept: char.extensions.yeyu.future.keep,
    };
  });

  assert.strictEqual(result.styleStored, 'CUSTOM_STYLE_AUDIT');
  assert.strictEqual(result.expressionStored, 'CUSTOM_EXPRESSION_CLASSIFY');
  assert.strictEqual(result.biographyStored, 'CUSTOM_WHEEL_BIOGRAPHY');
  assert.strictEqual(result.legacyOverrideKept, 'LEGACY_CONTINUATION_OVERRIDE');
  assert.strictEqual(result.unknownOverrideKept, true, '保存新表面不得清除未知覆盖字段');
  assert.strictEqual(result.styleInjected, 'CUSTOM_STYLE_AUDIT', '全局文风覆盖必须进入下一次后台检查');
  assert.deepStrictEqual(result.exportedAuthorNames, ['Author Main Prompt', '作者自定义辅助名'], '导入预设的作者命名必须逐字保留');
  assert.deepStrictEqual(result.exportedOpaque, {keep: true}, '预设导出必须保留未知字段');
  assert.strictEqual(result.exportedFunctionCalling, true, '预设 raw 中未消费的 function_calling 必须随编辑与导出保真');
  for (const forbidden of ['CUSTOM_EXPRESSION_CLASSIFY', 'CUSTOM_STYLE_AUDIT', 'styleAuditEnabled', 'assistantPromptOverrides']) {
    assert(!result.exportedText.includes(forbidden), `预设 JSON 不得夹带全局设置：${forbidden}`);
  }
  assert.strictEqual(result.biographyDefaultShown, true, '未覆盖时人物志提示词必须显示 00-defaults 的默认文本');
  assert.strictEqual(result.biographyResetToDefault, true, '“恢复这组默认”必须把人物志提示词还原为默认文本');
  assert.strictEqual(result.biographyOverrideDroppedAfterReset, true, '恢复默认后保存必须清除 assistantPromptOverrides.wheelScheme.biography');
  assert.strictEqual(result.characterExtensionKept, true, '提示词管理不得改写角色未知扩展');
  assert.deepStrictEqual(pageErrors, [], `页面错误：${pageErrors.join('\n')}`);
  assert.deepStrictEqual(consoleErrors, [], `控制台错误：${consoleErrors.join('\n')}`);

  const providerDraft = await page.evaluate(async () => {
    const storedSettings = async () => (await YeyuRepository.load()).data.settings;
    const storedProvider = async id => (await storedSettings()).providers.find(row => row.id === id);
    closeModal('settings-modal');
    D = defaults();
    D.settings.providers = [
      {id: 'p-main', name: '主供应商', apiUrl: 'https://main.invalid/v1', apiKey: 'main-key', apiKeys: [{id: 'key-a', label: '甲', value: 'main-key'}, {id: 'key-b', label: '乙', value: 'backup-key'}], activeApiKeyId: 'key-a', model: 'main-model', models: ['main-model', 'alt-model'], promptPostProcessing: 'none'},
      {id: 'p-aux', name: '备用供应商', apiUrl: 'https://aux.invalid/v1', apiKey: 'aux-key', apiKeys: [], activeApiKeyId: '', model: 'aux-model', models: [], promptPostProcessing: 'none'},
    ];
    D.settings.activeProviderId = 'p-main';
    D.settings.modelPresets = [{
      id: 'profile-main', name: '主连接档',
      routes: {
        chat: {providerId: 'p-main', model: 'chat-old'},
        caption: {providerId: 'p-aux', model: 'caption-live'},
      },
    }];
    D.settings.activeModelPresetId = 'profile-main';
    D.settings.activeConnectionProfileId = 'profile-main';
    ensureProviderSettings(D.settings);
    await saveData('meta', {urgent: true});

    // Key labels and values share the page draft; verify cancel and save against IndexedDB.
    const realInputForMerge = window.appInput;
    switchAppPage('settings');
    document.getElementById('s-api-key').value = 'key-draft-cancel';
    window.appInput = async () => '甲-取消草稿';
    await stscriptRenameApiKey();
    const keyRenameBeforeCancel = {
      formValue: document.getElementById('s-api-key').value,
      draftValue: providerActiveApiKey(activeProviderForSettings(providerFormSettings())),
      storedValue: providerActiveApiKey(await storedProvider('p-main')),
      storedLabel: (await storedProvider('p-main')).apiKeys.find(row => row.id === 'key-a').label,
    };
    closeModal('settings-modal');
    const keyRenameAfterCancel = {
      storedValue: providerActiveApiKey(await storedProvider('p-main')),
      storedLabel: (await storedProvider('p-main')).apiKeys.find(row => row.id === 'key-a').label,
    };
    switchAppPage('settings');
    document.getElementById('s-api-key').value = 'key-draft-save';
    window.appInput = async () => '甲-保存草稿';
    await stscriptRenameApiKey();
    await saveSettings();
    const keyRenameAfterSave = {
      storedValue: providerActiveApiKey(await storedProvider('p-main')),
      storedLabel: (await storedProvider('p-main')).apiKeys.find(row => row.id === 'key-a').label,
    };
    window.appInput = realInputForMerge;
    closeModal('settings-modal');

    // /profile-update 只更新现行 chat 路由，历史未知路由必须原样保留。
    D.settings.modelPresets = [{
      id: 'profile-main', name: '主连接档',
      routes: {
        chat: {providerId: 'p-main', model: 'chat-old'},
        caption: {providerId: 'p-aux', model: 'caption-live'},
      },
    }];
    D.settings.activeModelPresetId = 'profile-main';
    D.settings.activeConnectionProfileId = 'profile-main';
    await saveData('meta', {urgent: true});
    switchAppPage('settings');
    await STSCRIPT_COMMANDS['profile-update'].callback({}, []);
    const routesAfterProfileUpdate = copyJsonData(
      (await storedSettings()).modelPresets.find(row => row.id === 'profile-main').routes
    );
    closeModal('settings-modal');
    D.settings.modelPresets = [{
      id: 'profile-main', name: '主连接档',
      routes: {
        chat: {providerId: 'p-main', model: 'main-model'},
        caption: {providerId: 'p-main', model: 'main-model'},
      },
    }];
    D.settings.activeModelPresetId = 'profile-main';
    D.settings.activeConnectionProfileId = 'profile-main';
    await saveData('meta', {urgent: true});

    // 编辑主供应商地址并把下拉切到备用供应商，都不保存，然后在预设页触发保存并回到聊天。
    switchAppPage('settings');
    document.getElementById('s-api-url').value = 'https://discard.invalid/v1';
    captureProviderForm();
    document.getElementById('s-provider-select').value = 'p-aux';
    selectProviderForEditing();
    const draftActiveWhileBrowsing = document.getElementById('s-provider-select').value;
    const liveActiveWhileBrowsing = D.settings.activeProviderId;
    const routeWhileBrowsing = resolveApiRoute('chat').apiUrl;
    switchAppPage('presets');
    await savePromptManager();
    switchAppPage('chat');
    const afterOtherPageSave = {
      active: (await storedSettings()).activeProviderId,
      url: (await storedProvider('p-main')).apiUrl,
      memoryActive: D.settings.activeProviderId,
      memoryUrl: D.settings.providers.find(row => row.id === 'p-main').apiUrl,
    };

    // 取消离开。
    switchAppPage('settings');
    document.getElementById('s-api-url').value = 'https://cancelled.invalid/v1';
    captureProviderForm();
    closeModal('settings-modal');
    await saveData('meta', {urgent: true});
    const urlAfterCancel = (await storedProvider('p-main')).apiUrl;

    // 返回键离开。
    switchAppPage('settings');
    document.getElementById('s-provider-select').value = 'p-aux';
    selectProviderForEditing();
    document.getElementById('s-api-url').value = 'https://back-abandoned.invalid/v1';
    captureProviderForm();
    handleNativeBack();
    const pageAfterBack = document.body.dataset.page || 'chat';
    await saveData('meta', {urgent: true});
    const afterBack = {
      active: (await storedSettings()).activeProviderId,
      auxUrl: (await storedProvider('p-aux')).apiUrl,
    };

    // 校验失败后取消。
    switchAppPage('settings');
    document.getElementById('s-api-url').value = 'not-an-address';
    await saveSettings();
    const urlAfterFailedSave = (await storedProvider('p-main')).apiUrl;
    const formKeptAfterFailedSave = document.getElementById('s-api-url').value;
    closeModal('settings-modal');
    await saveData('meta', {urgent: true});
    const urlAfterFailedSaveCancel = (await storedProvider('p-main')).apiUrl;

    // Script commands persist immediately while UI key selection remains in the page draft.
    switchAppPage('settings');
    document.getElementById('s-api-url').value = 'https://never-saved.invalid/v1';
    document.getElementById('s-api-key-select').value = 'key-b';
    await stscriptSelectApiKey();
    const afterKeySwitch = {
      url: document.getElementById('s-api-url').value,
      key: providerActiveApiKey(activeProviderForSettings(providerFormSettings())),
    };
    await STSCRIPT_COMMANDS.model.callback({}, ['script-model']);
    await STSCRIPT_COMMANDS['profile-create'].callback({}, ['脚本连接档']);
    const scriptProfileId = D.settings.activeConnectionProfileId;
    const afterScriptChange = {
      model: document.getElementById('s-model').value,
      url: document.getElementById('s-api-url').value,
    };
    closeModal('settings-modal');
    await saveData('meta', {urgent: true});
    const immediateStored = await storedSettings();
    const afterImmediateSaves = {
      activeKey: immediateStored.providers.find(row => row.id === 'p-main').activeApiKeyId,
      model: immediateStored.providers.find(row => row.id === 'p-main').model,
      url: immediateStored.providers.find(row => row.id === 'p-main').apiUrl,
      profile: immediateStored.activeConnectionProfileId,
      profileKept: immediateStored.modelPresets.some(row => row.id === scriptProfileId),
      routes: JSON.stringify(immediateStored.modelPresets.find(row => row.id === immediateStored.activeModelPresetId).routes),
    };

    // 正常保存必须把草稿整体落盘。
    await STSCRIPT_COMMANDS.profile.callback({}, ['<None>']);
    switchAppPage('settings');
    const postProcessing = document.getElementById('s-prompt-post-processing');
    postProcessing.value = 'single';
    document.getElementById('s-provider-select').value = 'p-aux';
    selectProviderForEditing();
    const auxPostProcessingLoaded = postProcessing.value;
    postProcessing.value = 'strict';
    document.getElementById('s-api-url').value = 'https://aux-saved.invalid/v1';
    document.getElementById('s-max-context').value = '8000';
    await saveSettings();
    switchAppPage('chat');
    const saved = await storedSettings();
    const afterExplicitSave = {
      active: saved.activeProviderId,
      auxUrl: saved.providers.find(row => row.id === 'p-aux').apiUrl,
      route: resolveApiRoute('chat').apiUrl,
      auxPostProcessingLoaded,
      postProcessing: saved.providers.filter(row => row.id === 'p-main' || row.id === 'p-aux').map(row => row.id + ':' + row.promptPostProcessing),
      maxContextTokens: [D.settings.maxContextTokens, saved.maxContextTokens],
    };

    // 路由表单还没渲染时（容器是空的静态 div），收集不得把已保存的路由当成“留空”全部删掉。
    switchAppPage('settings');
    activeModelPresetForSettings(providerFormSettings()).routes = {caption: {providerId: 'p-aux', model: 'alt-model'}};
    document.getElementById('s-model-routes').innerHTML = '';
    captureModelPresetForm();
    const routesAfterUnrenderedCapture = JSON.stringify(activeModelPresetForSettings(providerFormSettings()).routes);
    closeModal('settings-modal');

    // New providers can manage draft keys without touching saved providers.
    switchAppPage('settings');
    const realInput = window.appInput, realConfirm = window.appConfirm;
    window.appInput = async (message, defaultValue, title, label) =>
      label === '供应商名称' ? '草稿供应商' : label === '密钥名称' ? '草稿密钥' : 'draft-secret';
    window.appConfirm = async () => true;
    await addApiProvider();
    const draftProviderId = providerFormSettings().activeProviderId;
    const countKeys = rows => rows.filter(row => row.id !== draftProviderId)
      .map(row => row.id + ':' + (row.apiKeys || []).map(key => key.id + '=' + key.label).join('|')).join(',');
    const liveKeysBefore = countKeys(D.settings.providers);
    const storedKeysBefore = countKeys((await storedSettings()).providers);
    await stscriptAddApiKey();
    const liveAfterDraftAdd = countKeys(D.settings.providers);
    const storedAfterDraftAdd = countKeys((await storedSettings()).providers);
    await stscriptSelectApiKey();
    await stscriptRenameApiKey();
    await stscriptDeleteApiKey();
    const keysWhileDraft = {
      memoryUnchangedAfterAdd: liveAfterDraftAdd === liveKeysBefore,
      storedUnchangedAfterAdd: storedAfterDraftAdd === storedKeysBefore,
      memoryUnchanged: countKeys(D.settings.providers) === liveKeysBefore,
      storedUnchanged: countKeys((await storedSettings()).providers) === storedKeysBefore,
      draftStillUnsaved: !(await storedSettings()).providers.some(row => row.id === draftProviderId),
    };

    // Save a new provider and its key together. Further key edits remain drafts.
    await stscriptAddApiKey();
    document.getElementById('s-api-url').value = 'https://draft-saved.invalid/v1';
    document.getElementById('s-model').value = 'draft-model';
    await saveSettings();
    await stscriptAddApiKey();
    window.appInput = realInput;
    window.appConfirm = realConfirm;
    await saveData('meta', {urgent: true});
    const storedAfterSave = await storedSettings();
    const afterDraftProviderSaved = {
      othersUnchanged: countKeys(storedAfterSave.providers) === storedKeysBefore,
      newProviderKeys: (storedAfterSave.providers.find(row => row.id === draftProviderId).apiKeys || []).length,
    };

    // 复原为 p-aux，后面的重启断言仍检查已保存的当前对话供应商。
    document.getElementById('s-provider-select').value = 'p-aux';
    selectProviderForEditing();
    await saveSettings();
    closeModal('settings-modal');
    switchAppPage('chat');

    return {keysWhileDraft, afterDraftProviderSaved,
      keyRenameBeforeCancel, keyRenameAfterCancel, keyRenameAfterSave,
      routesAfterProfileUpdate,
      draftActiveWhileBrowsing, liveActiveWhileBrowsing, routeWhileBrowsing, afterOtherPageSave, urlAfterCancel,
      pageAfterBack, afterBack, urlAfterFailedSave, formKeptAfterFailedSave, urlAfterFailedSaveCancel,
      afterKeySwitch, afterScriptChange, scriptProfileId, afterImmediateSaves, afterExplicitSave, routesAfterUnrenderedCapture};
  });

  assert.strictEqual(providerDraft.draftActiveWhileBrowsing, 'p-aux', '下拉切换供应商时编辑器确实指向新供应商');
  assert.strictEqual(providerDraft.liveActiveWhileBrowsing, 'p-main', '未保存的下拉切换不得改动运行中的当前对话供应商');
  assert.deepStrictEqual(providerDraft.keyRenameBeforeCancel, {
    formValue: 'key-draft-cancel', draftValue: 'key-draft-cancel', storedValue: 'main-key', storedLabel: '甲',
  }, '密钥重命名和输入框值必须只进入草稿');
  assert.deepStrictEqual(providerDraft.keyRenameAfterCancel, {
    storedValue: 'main-key', storedLabel: '甲',
  }, '取消必须同时撤销密钥名称和值');
  assert.deepStrictEqual(providerDraft.keyRenameAfterSave, {
    storedValue: 'key-draft-save', storedLabel: '甲-保存草稿',
  }, '明确保存必须同时落库密钥名称和值');
  assert.deepStrictEqual(providerDraft.routesAfterProfileUpdate, {
    chat: {providerId: 'p-main', model: 'main-model'}, caption: {providerId: 'p-aux', model: 'caption-live'},
  }, '/profile-update 必须只更新 chat，并保留历史未知路由字段');
  assert.strictEqual(providerDraft.routeWhileBrowsing, 'https://main.invalid/v1', '设置页编辑期间请求路由必须仍用已保存的连接配置');
  assert.deepStrictEqual(providerDraft.afterOtherPageSave, {
    active: 'p-main', url: 'https://main.invalid/v1', memoryActive: 'p-main', memoryUrl: 'https://main.invalid/v1',
  }, '在别的页面触发保存时，未保存的供应商草稿不得落盘');
  assert.strictEqual(providerDraft.urlAfterCancel, 'https://main.invalid/v1', '取消设置页后再保存，数据库里不得出现未保存的地址');
  assert.strictEqual(providerDraft.pageAfterBack, 'chat', '返回键必须从设置页回到聊天');
  assert.deepStrictEqual(providerDraft.afterBack, {active: 'p-main', auxUrl: 'https://aux.invalid/v1'}, '返回键离开设置页同样不得落盘未保存的编辑');
  assert.strictEqual(providerDraft.urlAfterFailedSave, 'https://main.invalid/v1', '校验失败的保存不得写入数据库');
  assert.strictEqual(providerDraft.formKeptAfterFailedSave, 'not-an-address', '校验失败后必须保留用户正在编辑的内容');
  assert.strictEqual(providerDraft.urlAfterFailedSaveCancel, 'https://main.invalid/v1', '校验失败后取消，数据库必须保持已保存配置');
  assert.deepStrictEqual(providerDraft.afterKeySwitch, {
    url: 'https://never-saved.invalid/v1', key: 'backup-key',
  }, '切换密钥必须只改密钥，不得清空正在输入的地址');
  assert.deepStrictEqual(providerDraft.afterScriptChange, {
    model: 'script-model', url: 'https://never-saved.invalid/v1',
  }, '脚本改动只更新它改的字段，表单里其他未保存内容必须原样保留');
  assert.deepStrictEqual(providerDraft.afterImmediateSaves, {
    activeKey: 'key-a', model: 'script-model', url: 'https://main.invalid/v1',
    profile: providerDraft.scriptProfileId, profileKept: true,
    routes: '{"chat":{"providerId":"p-main","model":"main-model"},"caption":{"providerId":"p-main","model":"main-model"}}',
  }, '脚本保存必须保留；取消必须撤销密钥选择，不能夹带表单内容');
  assert.deepStrictEqual(providerDraft.afterExplicitSave, {
    active: 'p-aux', auxUrl: 'https://aux-saved.invalid/v1', route: 'https://aux-saved.invalid/v1',
    auxPostProcessingLoaded: 'none', postProcessing: ['p-main:single', 'p-aux:strict'], maxContextTokens: [8000, 8000],
  }, '点击保存必须把草稿整体写入设置与数据库；切换供应商前捕获当前后处理档位，切换后加载各自档位');
  assert.strictEqual(providerDraft.routesAfterUnrenderedCapture, JSON.stringify({caption: {providerId: 'p-aux', model: 'alt-model'}}),
    '路由表单没有渲染时收集必须原样保留已保存的路由');
  assert.deepStrictEqual(providerDraft.keysWhileDraft, {
    memoryUnchangedAfterAdd: true, storedUnchangedAfterAdd: true,
    memoryUnchanged: true, storedUnchanged: true, draftStillUnsaved: true,
  }, '草稿供应商上的密钥操作不得给任何已保存的供应商增删密钥，也不得把草稿写进数据库');
  assert.deepStrictEqual(providerDraft.afterDraftProviderSaved, {othersUnchanged: true, newProviderKeys: 1},
    '保存必须包含新供应商的草稿密钥；后续未保存的新增不落库');
  assert.deepStrictEqual(pageErrors, [], '供应商草稿流程页面错误：' + pageErrors.join('\n'));

  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});
  const afterReload = await page.evaluate(() => ({
    active: D.settings.activeProviderId,
    mainUrl: D.settings.providers.find(row => row.id === 'p-main').apiUrl,
    auxUrl: D.settings.providers.find(row => row.id === 'p-aux').apiUrl,
    mainModel: D.settings.providers.find(row => row.id === 'p-main').model,
    activeKey: D.settings.providers.find(row => row.id === 'p-main').activeApiKeyId,
  }));
  assert.deepStrictEqual(afterReload, {
    active: 'p-aux', mainUrl: 'https://main.invalid/v1', auxUrl: 'https://aux-saved.invalid/v1',
    mainModel: 'script-model', activeKey: 'key-a',
  }, '重启后必须恢复已保存配置，未保存的草稿不得复活');

  // 思考模板、系统提示词档与作者注都先进入各自页面的草稿，保存才生效，保存失败回滚。
  await page.evaluate(()=>{
    D.settings.reasoningTemplates=[{id:'tag-a',name:'Think 标签',prefix:'<think>',suffix:'</think>',separator:'\n'},{id:'tag-b',name:'Analysis 标签',prefix:'<analysis>',suffix:'</analysis>',separator:'\n'}];D.settings.activeReasoningTemplateId='tag-a';
    D.settings.systemPromptProfiles=[{id:'system-test',name:'测试系统档',content:'System profile probe',postHistory:''}];
    D.settings.providers.push({id:'editor-provider',name:'编辑供应商',apiUrl:'https://example.invalid',model:'editor-model',apiKeys:[{id:'editor-key',label:'编辑密钥',value:'synthetic-editor',futureField:{keep:true}}],activeApiKeyId:'editor-key'});
    switchAppPage('settings');
  });
  await page.locator('#s-provider-select').selectOption('editor-provider',{force:true});
  await page.locator('#s-provider-select').selectOption(await page.evaluate(()=>D.settings.activeProviderId),{force:true});
  await page.locator('#s-reasoning-template-select').selectOption('tag-b',{force:true});
  assert.strictEqual(await page.evaluate(()=>D.settings.activeReasoningTemplateId),'tag-a');
  await page.evaluate(()=>saveSettings());
  assert.deepStrictEqual(await page.evaluate(async()=>[D.settings,(await YeyuRepository.load()).data.settings].map(settings=>settings.activeReasoningTemplateId+':'+settings.providers.find(p=>p.id==='editor-provider').apiKeys[0].futureField.keep)),['tag-b:true','tag-b:true'],'保存设置必须保留密钥上的未知字段');
  await page.evaluate(()=>{switchAppPage('presets');switchCompletionPresetTab('utility');});
  await page.locator('#pm-system-prompt-select').selectOption('system-test',{force:true});
  assert.strictEqual(await page.evaluate(()=>D.settings.systemPromptEnabled),false);
  await page.locator('#pm-author-note-position').selectOption('before',{force:true});
  assert.strictEqual(await page.evaluate(()=>D.settings.authorNotePosition||'chat'),'chat');
  await page.locator('#pm-author-note-role').selectOption('assistant',{force:true});
  assert.strictEqual(await page.evaluate(()=>D.settings.authorNoteRole||'system'),'system');
  assert.strictEqual(await page.evaluate(()=>completionPresetDraftChanged()),true);
  await page.evaluate(()=>savePromptManager());
  assert.deepStrictEqual(await page.evaluate(()=>({position:D.settings.authorNotePosition,role:D.settings.authorNoteRole,system:D.settings.systemPromptEnabled})),{position:'before',role:'assistant',system:true});
  // 两组命名条目的管理弹窗：重命名原地生效、删除使用中的条目回落、模板可恢复默认。
  const profileManager = await page.evaluate(async()=>{
    const confirm=window.appConfirm, input=window.appInput;
    try {
      window.appConfirm=async()=>true;
      switchAppPage('presets');
      stscriptOpenPromptProfileManager('system');
      window.appInput=async()=>'改名后的系统档';
      await stscriptRenamePromptProfile('system-test');
      const profiles=completionPresetGlobalSettingsDraft().systemPromptProfiles;
      const renamedInPlace=profiles.length===1 && profiles[0].id==='system-test' && profiles[0].name==='改名后的系统档';
      await stscriptDeletePromptProfile('system-test');
      const draft=completionPresetGlobalSettingsDraft();
      const deletedFallsBackToOff=!draft.systemPromptProfiles.length && draft.systemPromptEnabled===false && document.getElementById('pm-system-prompt-select').value==='';
      closeModal('prompt-profile-manager-modal');
      closeModal('prompt-manager-modal');
      switchAppPage('settings');
      stscriptOpenPromptProfileManager('reasoning');
      await stscriptDeletePromptProfile('tag-b');
      const deletedTemplateFallsBack=providerFormSettings().activeReasoningTemplateId==='tag-a';
      await stscriptResetPromptProfiles();
      const templates=providerFormSettings().reasoningTemplates;
      const resetToDefault=templates.length===1 && templates[0].prefix==='<think>' && providerFormSettings().activeReasoningTemplateId===templates[0].id;
      closeModal('prompt-profile-manager-modal');
      closeModal('settings-modal');
      return {renamedInPlace,deletedFallsBackToOff,deletedTemplateFallsBack,resetToDefault};
    } finally {window.appConfirm=confirm;window.appInput=input;}
  });
  assert.deepStrictEqual(profileManager,{renamedInPlace:true,deletedFallsBackToOff:true,deletedTemplateFallsBack:true,resetToDefault:true});
  const draftLifecycle = await page.evaluate(async()=>{
    const stored = async()=> (await YeyuRepository.load()).data.settings;
    const baseline = JSON.stringify(await stored());
    const input = window.appInput;
    const save = window.saveData;
    // 管理弹窗一次填完表单；两组条目分别属于设置页草稿和预设页草稿。
    const addProfile = (group, name, fields)=>{
      stscriptOpenPromptProfileManager(group);
      stscriptAddPromptProfile();
      document.getElementById('prompt-profile-entry-name').value=name;
      Object.keys(fields).forEach(key=>{document.getElementById('prompt-profile-entry-'+key).value=fields[key];});
      stscriptSavePromptProfileEntry();
      closeModal('prompt-profile-manager-modal');
    };
    const editReasoning = ()=>addProfile('reasoning','Draft reasoning',{prefix:'<draft>',suffix:'</draft>'});
    const editSystem = (name)=>addProfile('system',name,{content:name+' body',postHistory:'Draft post'});
    try {
      switchAppPage('settings');
      editReasoning();
      const draftId=providerFormSettings().activeReasoningTemplateId;
      const unchangedBeforeSave=JSON.stringify(await stored())===baseline && D.settings.activeReasoningTemplateId==='tag-b';
      switchAppPage('presets');
      editSystem('Draft system');
      const systemUnchangedBeforeSave=!D.settings.systemPromptProfiles.some(row=>row.name==='Draft system');
      await savePromptManager();
      const systemSaved=(await stored()).systemPromptProfiles.some(row=>row.content==='Draft system body');
      const unrelatedSaveKeptDraft=(await stored()).activeReasoningTemplateId==='tag-b';
      switchAppPage('settings');
      const navigationKeptDraft=providerFormSettings().activeReasoningTemplateId===draftId;
      closeModal('settings-modal');
      switchAppPage('settings');
      const cancelled=providerFormSettings().activeReasoningTemplateId==='tag-b' && !providerFormSettings().reasoningTemplates.some(row=>row.name==='Draft reasoning');
      editReasoning();
      window.saveData=async()=>{throw new Error('synthetic save failure');};
      await saveSettings();
      const failedSaveKeptLive=D.settings.activeReasoningTemplateId==='tag-b' && (await stored()).activeReasoningTemplateId==='tag-b';
      const failedSaveKeptDraft=providerFormSettings().reasoningTemplates.some(row=>row.name==='Draft reasoning');
      window.saveData=save;
      await saveSettings();
      const savedProfiles=(await stored()).reasoningTemplates.some(row=>row.prefix==='<draft>') && systemSaved;
      document.getElementById('s-reasoning-template-select').value='tag-a';
      await stscriptSelectReasoningTemplate();
      await STSCRIPT_COMMANDS['reasoning-template'].callback({}, 'Analysis 标签');
      const scriptMerged=providerFormSettings().activeReasoningTemplateId==='tag-b';
      closeModal('settings-modal');
      switchAppPage('presets');
      editSystem('Cancelled system');
      closeModal('prompt-manager-modal');
      switchAppPage('presets');
      const systemCancelled=!completionPresetGlobalSettingsDraft().systemPromptProfiles.some(row=>row.name==='Cancelled system');
      document.getElementById('pm-system-prompt-select').value='system-test';
      await stscriptSelectSystemPrompt();
      await STSCRIPT_COMMANDS['sysprompt'].callback({}, 'Draft system');
      const systemScriptMerged=completionPresetGlobalSettingsDraft().activeSystemPromptProfileId===D.settings.activeSystemPromptProfileId;
      await savePromptManager();
      document.getElementById('pm-author-note-position').value='chat';
      document.getElementById('pm-author-note-role').value='user';
      completionPresetCaptureFields();
      const noteDraftDirty=completionPresetDraftChanged();
      closeModal('prompt-manager-modal');
      switchAppPage('presets');
      const noteCancelled=document.getElementById('pm-author-note-position').value==='before' && document.getElementById('pm-author-note-role').value==='assistant' && !completionPresetDraftChanged();
      document.getElementById('pm-author-note-position').value='after';
      document.getElementById('pm-author-note-role').value='user';
      window.saveData=async()=>{throw new Error('synthetic preset save failure');};
      await savePromptManager();
      const noteRollback=D.settings.authorNotePosition==='before' && D.settings.authorNoteRole==='assistant' && (await stored()).authorNotePosition==='before';
      return {unchangedBeforeSave,systemUnchangedBeforeSave,systemCancelled,unrelatedSaveKeptDraft,navigationKeptDraft,cancelled,failedSaveKeptLive,failedSaveKeptDraft,savedProfiles,scriptMerged,systemScriptMerged,noteDraftDirty,noteCancelled,noteRollback};
    } finally {window.appInput=input;window.saveData=save;}
  });
  assert.deepStrictEqual(draftLifecycle,{unchangedBeforeSave:true,systemUnchangedBeforeSave:true,systemCancelled:true,unrelatedSaveKeptDraft:true,navigationKeptDraft:true,cancelled:true,failedSaveKeptLive:true,failedSaveKeptDraft:true,savedProfiles:true,scriptMerged:true,systemScriptMerged:true,noteDraftDirty:true,noteCancelled:true,noteRollback:true});
  assert.deepStrictEqual(pageErrors, [], '草稿生命周期页面错误：' + pageErrors.join('\n'));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
