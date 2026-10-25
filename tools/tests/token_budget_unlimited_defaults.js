'use strict';

// 预算与输出上限的默认语义：全新数据一律不限（0），界面留空与 0 同义，
// 已保存过的旧数值不被改写，输出上限为 0 时请求不携带 max_tokens。

const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');
const { capturePageDiagnostics } = require('./helpers/page-diagnostics');

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');

let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const { pageErrors } = capturePageDiagnostics(page, { captureConsole: false });
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  await page.goto(url, { waitUntil: 'load' });
  await waitForAppReady(page, { timeout: 15000 });

  // 1. 全新数据：七项预算/输出上限全部为不限。
  const shipped = await page.evaluate(() => {
    D = defaults();
    return {
      worldBookTokenBudget: D.worldBook.token_budget,
      worldBookBudgetPercent: worldBookSettings().budgetPercent,
      worldBookBudgetCap: worldBookSettings().budgetCap,
      memoryRetrievalTokenBudget: D.settings.memoryRetrievalTokenBudget,
      summaryTokenLimit: D.settings.summaryTokenLimit,
      styleAuditMaxTokens: taskMaxTokens('styleAuditMaxTokens'),
      wheelSchemeMaxTokens: taskMaxTokens('wheelSchemeMaxTokens'),
      risuCardFallback: YeyuRisuLorebook.normalizeSettings({}).tokenBudget,
      risuCardDefault: risuLorebookDefaultSettings({ character_book: null }).tokenBudget,
    };
  });
  assert.deepStrictEqual(shipped, {
    worldBookTokenBudget: 0,
    worldBookBudgetPercent: 0,
    worldBookBudgetCap: 0,
    memoryRetrievalTokenBudget: 0,
    summaryTokenLimit: 0,
    styleAuditMaxTokens: 0,
    wheelSchemeMaxTokens: 0,
    risuCardFallback: 0,
    risuCardDefault: 0,
  }, '全新数据下七项预算/输出上限都必须是不限（0）');

  // 2. 已保存的旧数值不迁移：重载后仍是原值。
  await page.evaluate(async () => {
    D = defaults();
    D.worldBook.token_budget = 2048;
    D.worldBook.budget_percent = 25;
    Object.assign(D.settings, {
      summaryTokenLimit: 8192,
      memoryRetrievalTokenBudget: 1200,
      styleAuditMaxTokens: 512,
      wheelSchemeMaxTokens: 8192,
    });
    await saveData(['meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheels'], { urgent: true });
  });
  await page.reload({ waitUntil: 'load' });
  await waitForAppReady(page, { timeout: 15000 });
  const preserved = await page.evaluate(() => ({
    worldBookTokenBudget: D.worldBook.token_budget,
    worldBookBudgetPercent: worldBookSettings().budgetPercent,
    memoryRetrievalTokenBudget: D.settings.memoryRetrievalTokenBudget,
    summaryTokenLimit: D.settings.summaryTokenLimit,
    styleAuditMaxTokens: taskMaxTokens('styleAuditMaxTokens'),
    wheelSchemeMaxTokens: taskMaxTokens('wheelSchemeMaxTokens'),
  }));
  assert.deepStrictEqual(preserved, {
    worldBookTokenBudget: 2048,
    worldBookBudgetPercent: 25,
    memoryRetrievalTokenBudget: 1200,
    summaryTokenLimit: 8192,
    styleAuditMaxTokens: 512,
    wheelSchemeMaxTokens: 8192,
  }, '升级不得改写用户已保存的预算与输出上限');

  // 3. 界面留空或填 0 都必须能保存成不限，并在重载后保持。
  await page.evaluate(async () => {
    openWBSection('settings');
    loadWBSettings();
    document.getElementById('wb-budget-percent').value = '';
    document.getElementById('wb-token-budget').value = '0';
    await saveWBSettings();

    loadMemoryManager();
    document.getElementById('mm-summary-token-limit').value = '';
    document.getElementById('mm-memory-token-budget').value = '0';
    await saveMemoryManager();

    loadSettingsForm();
    document.getElementById('s-style-audit-max-tokens').value = '';
    await saveSettings();

    openWheelSchemeManager();
    document.getElementById('wheel-scheme-max-tokens').value = '0';
    await saveWheelSchemeManager();
  });
  await page.reload({ waitUntil: 'load' });
  await waitForAppReady(page, { timeout: 15000 });
  const savedZero = await page.evaluate(() => {
    openWBSection('settings');
    loadWBSettings();
    loadMemoryManager();
    loadSettingsForm();
    openWheelSchemeManager();
    return {
      stored: {
        worldBookTokenBudget: D.worldBook.token_budget,
        worldBookBudgetPercent: D.worldBook.budget_percent,
        memoryRetrievalTokenBudget: D.settings.memoryRetrievalTokenBudget,
        summaryTokenLimit: D.settings.summaryTokenLimit,
        styleAuditMaxTokens: D.settings.styleAuditMaxTokens,
        wheelSchemeMaxTokens: D.settings.wheelSchemeMaxTokens,
      },
      shown: [
        'wb-token-budget', 'wb-budget-percent', 'mm-memory-token-budget',
        'mm-summary-token-limit', 's-style-audit-max-tokens', 'wheel-scheme-max-tokens',
      ].map(id => document.getElementById(id).value),
    };
  });
  assert.deepStrictEqual(savedZero.stored, {
    worldBookTokenBudget: 0,
    worldBookBudgetPercent: 0,
    memoryRetrievalTokenBudget: 0,
    summaryTokenLimit: 0,
    styleAuditMaxTokens: 0,
    wheelSchemeMaxTokens: 0,
  }, '留空或填 0 必须能保存为不限');
  assert.deepStrictEqual(savedZero.shown, ['0', '0', '0', '0', '0', '0'], '保存后的不限必须在界面上回显为 0');

  // 4. 输出上限为 0 时辅助任务请求不得携带 max_tokens；填写正数仍按该值发送。
  const structured = await page.evaluate(async () => {
    const realFetch = window.fetch;
    const bodies = [];
    window.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"probe":true}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    try {
      ensureProviderSettings(D.settings);
      activeProviderForSettings(D.settings).apiKey = 'structured-probe-key';
      D.settings.maxTokens = 2048;
      const run = async () => requestStructuredJson('系统', '用户', {
        route: 'memorySummary',
        schema: value => !!(value && value.probe === true),
        maxTokens: memoryV5SummaryMaxTokens(0),
        ignoreUserMaxTokens: true,
      });
      D.settings.summaryTokenLimit = 0;
      await run();
      D.settings.summaryTokenLimit = 16384;
      await run();
      return bodies.map(body => (Object.prototype.hasOwnProperty.call(body, 'max_tokens') ? body.max_tokens : null));
    } finally {
      window.fetch = realFetch;
    }
  });
  assert.deepStrictEqual(structured, [null, 16384], '整理输出上限为 0 时请求不得带 max_tokens，正数时必须按该值发送');

  assert.deepStrictEqual(pageErrors, [], '真实页面不得出现脚本错误');
  console.log(JSON.stringify({
    tokenBudgetUnlimitedDefaults: true,
    shippedDefaults: shipped,
    storedValuesPreserved: preserved,
    blankAndZeroSaved: savedZero.stored,
    structuredMaxTokens: structured,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
});
