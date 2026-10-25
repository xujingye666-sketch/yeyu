'use strict';

const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const {isDeepStrictEqual} = require('util');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('../tests/source');

const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const usage = '用法：node tools/probes/card_package_browser_acceptance.js --package <卡包目录>（或 -p <卡包目录>）\n'
  + '或：node tools/probes/card_package_browser_acceptance.js --card <原卡路径> --worldbook <世界书路径> --preset <预设路径>\n'
  + '可加 --generation [--ejs-probe]；卡包相对文件名见本脚本 samples，可用各文件参数覆盖。';
function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('-'), name + ' 需要路径。\n' + usage);
  return path.resolve(process.argv[index + 1]);
}
const packageRoot = option('--package', option('-p'));
function packageSample(...parts) {
  return packageRoot ? path.join(packageRoot, ...parts) : null;
}
const generation = process.argv.includes('--generation');
const ejsProbe = process.argv.includes('--ejs-probe');
const samples = {
  communityCard: option('--card', packageSample('角色卡', '类脑-魔法少女们最严厉的母亲-v1.2.png')),
  unknownExtensionCard: process.argv.includes('--card') ? null : packageSample('角色卡', 'RisuAI-Sign here hero.png'),
  communityWorldBook: option('--worldbook', packageSample('世界书', '类脑-五官世界书-v8.0.json')),
  communityPreset: option('--preset', packageSample('预设', '咩咩预设 - ver 5.7.8.json'))
};
assert(samples.communityCard && samples.communityWorldBook && samples.communityPreset,
  '必须显式提供卡包目录，或同时提供原卡、世界书与预设路径。\n' + usage);

for (const [kind, file] of Object.entries(samples)) {
  if (!file) continue;
  assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `缺少 ${kind} 实例：${file}\n${usage}`);
}

async function checkGeneration(page) {
  const reply = '测试回复：我看了看周围，准备继续交谈。' + (ejsProbe ? '<%= _.partial((a,b)=>a+"-"+b, _, "display")("ejs") %>' : '');
  const displayedReply = ejsProbe ? reply.replace(/<%[\s\S]*%>/, 'ejs-display') : reply;
  let outbound;
  await page.route('**/card-package-model/**', async route => {
    const body = route.request().postDataJSON();
    outbound = body.messages;
    const events = [
      {choices: [{delta: {content: reply}, finish_reason: null}]},
      {choices: [{delta: {}, finish_reason: 'stop'}]},
    ];
    await route.fulfill({status: 200, contentType: 'text/event-stream', body: events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n'});
  });
  const input = await page.evaluate(async ({origin, ejsProbe}) => {
    window.__packageEjsEvaluations = {};
    const evaluate = promptTemplateEval;
    promptTemplateEval = async function(content, data, options) {
      const value = await evaluate.apply(this, arguments);
      if (typeof content === 'string' && /<%|&lt;%/.test(content)) {
        const phase = String(options && options.when || 'unspecified');
        __packageEjsEvaluations[phase] = (__packageEjsEvaluations[phase] || 0) + 1;
      }
      return value;
    };
    D.currentCharId = D.characters[0].id;
    const char = getChar(), session = getActiveSession(char.id);
    if (ejsProbe) char.description += '\n<%= _.partial((a,b)=>a+"-"+b, _, "generation")("ejs") %>';
    if (!session.msgs.length && char.first_mes) {
      appendOpeningGreeting(char, session, char.first_mes, 0);
      session.greetingChosen = true;
    }
    const categories = D.worldBook.categories.slice(-window.__packageWorldBookGroups);
    D.worldBook.globalCategoryIds = [...new Set([...(D.worldBook.globalCategoryIds || []), ...categories.map(category => category.id)])];
    const entries = categories.flatMap(category => category.entries);
    window.__packageWorldBookText = entries.map(entry => String(entry.content || '').trim().slice(0, 60)).filter(Boolean);
    const keys = entries.flatMap(entry => entry.keys || []).filter(key => typeof key === 'string' && !key.startsWith('/'));
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {apiUrl: origin + '/card-package-model/v1', apiKey: 'synthetic-local-test', model: 'synthetic-card-model', promptPostProcessing: 'none', reasoningEffort: 'off'});
    Object.assign(D.settings, {useMemory: false, embeddingEnabled: false, styleAuditEnabled: false, maxContextTokens: 0});
    D.worldBook.token_budget = 0;
    await saveData(['meta', 'sessions', 'worldbook'], {urgent: true});
    switchAppPage('chat'); updateChatUI(); renderChat();
    await cardScriptLibraryAwaitReady(syncCardScriptLibrary(char));
    return '我观察了一下周围，准备继续交谈。' + keys.join('，');
  }, {origin: new URL(page.url()).origin, ejsProbe});
  await page.locator('#user-input').fill(input);
  await page.locator('#composer-action-btn').click();
  await page.waitForFunction(reply => _generationState === 'idle' && getMsgs(getChar().id).some(message => message.role === 'assistant' && message.content.includes(reply)), reply);
  assert(outbound && outbound.length, '发送入口没有产生模型请求');
  await page.waitForFunction(reply => document.querySelector('#chat-messages').textContent.includes(reply), displayedReply);
  const result = await page.evaluate(({messages, displayedReply, ejsProbe}) => {
    const char = getChar(), session = getActiveSession(char.id), text = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
    const built = getBuiltMessages(char, session.msgs);
    const raw = D.settings.chatCompletionPresetInUse;
    const enabled = new Set((presetOrderRow(raw)?.order || []).filter(item => item.enabled !== false).map(item => item.identifier));
    const presetLines = raw.prompts.filter(prompt => !prompt.marker && enabled.has(prompt.identifier)).flatMap(prompt => String(prompt.content || '').split(/\r?\n/)).filter(line => line.length >= 40 && !/[{}]|<%/.test(line));
    return {
      modelResponse: 'synthetic-local',
      auxiliaryRequests: 'disabled',
      contextAndWorldBookBudgets: 'unlimited',
      requestMessages: messages.length,
      requestChars: text.length,
      cardInRequest: text.includes(char.name),
      worldBookInRequest: __packageWorldBookText.some(value => text.includes(value)),
      presetInRequest: presetLines.some(value => text.includes(value)),
      presetLayers: built.presetLayers.length,
      replyDisplayed: document.querySelector('#chat-messages').textContent.includes(displayedReply),
      ejsProbe: ejsProbe ? 'synthetic EJS overlay on imported real card; original sample unchanged' : 'none',
      ejsRequestEvaluated: ejsProbe ? text.includes('ejs-generation') && !text.includes('"generation")("ejs")') : null,
      ejsEvaluations: window.__packageEjsEvaluations,
      scriptError: String((_cardScriptLibraryLive && _cardScriptLibraryLive.lastError) || ''),
    };
  }, {messages: outbound, displayedReply, ejsProbe});
  if (ejsProbe) assert(result.ejsRequestEvaluated && Object.keys(result.ejsEvaluations).some(key => key.startsWith('generate'))
    && Object.keys(result.ejsEvaluations).some(key => key.startsWith('render')), 'EJS 生成或显示未执行：' + JSON.stringify(result));
  assert(result.cardInRequest && result.worldBookInRequest && result.presetInRequest && result.presetLayers > 0, '卡片、世界书或预设未进入请求：' + JSON.stringify(result));
  assert(result.replyDisplayed && !result.scriptError, '回复显示或脚本运行失败：' + JSON.stringify(result));
  await page.reload();
  await page.waitForFunction(reply => D && getChar() && getMsgs(getChar().id).some(message => message.role === 'assistant' && message.content.includes(reply)), reply);
  return {...result, replyReloaded: true};
}

(async () => {
  const server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  const browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);
  page.setDefaultTimeout(300000);

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
    await page.waitForFunction(() => typeof D === 'object' && D && typeof confirmImport === 'function'
      && typeof confirmWBImport === 'function' && typeof loadPromptManager === 'function');

    const cardFiles = [samples.communityCard, samples.unknownExtensionCard].filter(Boolean);
    const cardCount = cardFiles.length;
    const parsedCards = [];
    for (const cardFile of cardFiles) {
      await page.evaluate(() => { openModal('import-modal'); resetImport(); });
      await page.locator('#file-input').setInputFiles(cardFile);
      await page.waitForFunction(() => !_importProgressActive && pending.length === 1);
      parsedCards.push(await page.evaluate(() => {
        const card = pending[0];
        const bookAnalysis = analyzeCharacterBookEntries(rawCharacterBookForCard(card));
        const blank = bookAnalysis.records.filter(row => !hasSemanticWorldBookValue(row.value)).length;
        return {
          name: canonicalCharacterName(card),
          format: card.importMeta && card.importMeta.format,
          worldBookEntries: bookAnalysis.source,
          worldBookImportableEntries: bookAnalysis.records.length - blank,
          worldBookBlankEntries: blank,
          worldBookUnrecognizedEntries: bookAnalysis.unrecognized,
          alternateGreetings: getGreetings(card).length - 1,
          regexScripts: Array.isArray(card.regexScripts) ? card.regexScripts.length : 0,
          preservedPrivateKeys: card.extensions && card.extensions.risuai
            ? Object.keys(card.extensions.risuai).filter(key => /script|trigger|virtual/i.test(key)).length : 0
        };
      }));
      await page.evaluate(async () => {
        const original = {confirm: appConfirm, toast};
        appConfirm = async () => true;
        toast = () => {};
        try {
          setPendingImportMode(0, 'direct');
          await confirmImport();
        } finally {
          appConfirm = original.confirm;
          toast = original.toast;
        }
      });
    }
    assert.strictEqual(parsedCards.length, cardCount);
    const committedCards = await page.evaluate(() => {
      return D.characters.map(card => ({
        name: canonicalCharacterName(card),
        worldBookImported: Number(card.importMeta && card.importMeta.worldBookImportReport
          && card.importMeta.worldBookImportReport.imported) || 0,
        assets: Array.isArray(card.media_assets) ? card.media_assets.length : 0
      }));
    });
    assert.strictEqual(committedCards.length, cardCount);
    parsedCards.forEach(card => {
      assert.strictEqual(
        card.worldBookEntries,
        card.worldBookImportableEntries + card.worldBookBlankEntries + card.worldBookUnrecognizedEntries,
        '角色卡世界书来源、可导入、空白与不识别条目数量不守恒'
      );
    });
    assert.deepStrictEqual(committedCards.map(card => card.worldBookImported), parsedCards.map(card => card.worldBookImportableEntries));

    await page.evaluate(() => { resetPendingWorldBookImport(true); openWBSection('import'); });
    await page.locator('#wb-file').setInputFiles(samples.communityWorldBook);
    await page.waitForFunction(() => _pendingWorldBookImports.length > 0);
    const stagedWorldBook = await page.evaluate(() => ({
      groups: _pendingWorldBookImports.length,
      entries: _pendingWorldBookImports.reduce((total, group) => total + (group.entries || []).length, 0)
    }));
    assert(stagedWorldBook.groups >= 1 && stagedWorldBook.entries > 0, '世界书未解析到条目');
    const importedWorldBook = await page.evaluate(async () => {
      const original = {confirm: appConfirm, toast};
      appConfirm = async () => true;
      toast = () => {};
      try {
        setAllPendingWorldBookImportModes('direct');
        return await confirmWBImport();
      } finally {
        appConfirm = original.confirm;
        toast = original.toast;
      }
    });
    assert.strictEqual(importedWorldBook, stagedWorldBook.entries, '世界书导入数量不符');

    await page.evaluate(() => loadPromptManager());
    await page.locator('#prompt-preset-file').setInputFiles(samples.communityPreset);
    await page.waitForFunction(() => _completionPresetDraftActive && completionPresetDraftRow());
    const importedPreset = await page.evaluate(async () => {
      const row = completionPresetDraftRow();
      const expectedRaw = JSON.stringify(row.preset);
      await savePromptManager();
      const saved = D.settings.chatCompletionPresets.find(item => item.name === row.name);
      return {
        prompts: saved && Array.isArray(saved.preset.prompts) ? saved.preset.prompts.length : 0,
        orders: saved && Array.isArray(saved.preset.prompt_order) ? saved.preset.prompt_order.length : 0,
        rawPreserved: !!saved && JSON.stringify(saved.preset) === expectedRaw
      };
    });
    assert(importedPreset.prompts > 0 && importedPreset.orders >= 1 && importedPreset.rawPreserved,
      JSON.stringify(importedPreset));
    const beforeReload = await page.evaluate(() => JSON.stringify({characters: D.characters.map(card => [card.id, card.rawCard || card.importMeta?.rawCard]), worldBook: D.worldBook.categories.map(category => [category.id, category.entries.map(entry => [entry.id, entry.content, entry._raw])]), preset: D.settings.chatCompletionPresetInUse}));
    await page.reload();
    await page.waitForFunction(count => D && D.characters.length === count, cardCount);
    const afterReload = await page.evaluate(() => JSON.stringify({characters: D.characters.map(card => [card.id, card.rawCard || card.importMeta?.rawCard]), worldBook: D.worldBook.categories.map(category => [category.id, category.entries.map(entry => [entry.id, entry.content, entry._raw])]), preset: D.settings.chatCompletionPresetInUse}));
    assert.ok(isDeepStrictEqual(JSON.parse(afterReload), JSON.parse(beforeReload)), '重载后原卡、世界书或活动预设变化');
    await page.evaluate(groups => { window.__packageWorldBookGroups = groups; }, stagedWorldBook.groups);
    const generationResult = generation ? await checkGeneration(page) : null;
    assert.strictEqual(pageErrors, 0, '页面运行发生错误，请在本地检查原卡');

    console.log(JSON.stringify({
      stage: 'card-package-real-instances',
      sources: Object.fromEntries(Object.entries(samples).filter(([,file]) => file).map(([kind,file]) => [kind, {file: path.basename(file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}])),
      reload: true,
      generation: generationResult,
      viewport: '390x844',
      cards: {parsed: parsedCards, committed: committedCards},
      worldBook: {staged: stagedWorldBook, imported: importedWorldBook},
      preset: importedPreset,
      pageErrors
    }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
