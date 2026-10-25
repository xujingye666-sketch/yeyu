'use strict';

// SillyTavern World Info runtime semantics, asserted on the real activation engine with
// deterministic fixtures.

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
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {ignoreFavicon: true, appendUrl: true});
  page.setDefaultTimeout(120000);
  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html', {waitUntil: 'load'});
  await waitForAppReady(page);

  // Shared harness: rebuild D from a scenario spec and run the real activation engine.
  await page.evaluate(() => {
    window.__worldInfoAlignment = {
      setup(spec) {
        const characters = (spec.characters || [{id: 'alignment-char', name: '主角'}]).map((row) => Object.assign({
          description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
          system_prompt: '', post_history_instructions: '', extensions: {}, regexScripts: []
        }, row));
        D.characters = characters;
        D.currentCharId = String(spec.charId || characters[0].id);
        D.chats = {};
        D.worldBook = Object.assign({
          categories: [], globalCategoryIds: [], activeCategoryId: '',
          scan_depth: 20, token_budget: 0, recursive: false
        }, spec.settings || {});
        D.worldBook.categories = (spec.categories || []).map((category) => Object.assign({
          id: category.id, name: category.name || category.id, settings: category.settings || null,
          boundCharIds: category.boundCharIds || null,
          entries: (category.entries || []).map((entry) => normalizeWBEntry(entry))
        }));
        D.worldBook.globalCategoryIds = (spec.categories || [])
          .filter((category) => !(category.boundCharIds || []).length)
          .map((category) => category.id);
        return D.worldBook.categories.map((category) => category.entries.map((entry) => entry.id));
      },
      // Runs the official engine. `session` carries msgs so message-counted effects and
      // per-session runtime state behave exactly as they do during a real send.
      resolve(spec, options) {
        const session = spec.session || {id: 'alignment-session', msgs: spec.msgs || []};
        const roll = Array.isArray(spec.rolls) ? spec.rolls.slice() : null;
        const resolveOptions = Object.assign({
          globalScanData: spec.globalScanData || {},
          generationType: spec.generationType || 'new',
          maxContext: spec.maxContext || 8192
        }, options || {});
        if (roll) resolveOptions.randomSource = () => (roll.length ? roll.shift() : 1);
        // resolveWorldBook takes the scan window as plain text rows; the session carries the
        // role-tagged messages the official message counter uses.
        const scan = (spec.scan || (spec.msgs || []).map((row) => String(row && row.content || ''))).map((text) => ({text}));
        const result = resolveWorldBook(scan, D.currentCharId, session, resolveOptions);
        return {
          count: result.count,
          matchedCount: result.matchedCount,
          droppedCount: result.droppedCount,
          injectedTokens: result.injectedTokens,
          budget: result.budget,
          beforeChar: result.beforeCharItems.map((item) => item.content),
          afterChar: result.afterCharItems.map((item) => item.content),
          beforeUser: result.beforeUserItems.map((item) => item.content),
          anTop: result.anTopItems.map((item) => item.content),
          anBottom: result.anBottomItems.map((item) => item.content),
          emTop: result.emTopItems.map((item) => item.content),
          emBottom: result.emBottomItems.map((item) => item.content),
          outlets: result.outletItems.map((item) => ({name: item.outletName, content: item.content})),
          inChat: Array.from(result.inChat.entries()).map(([depth, rows]) => ({
            depth, rows: rows.map((row) => ({content: row.content, role: row.role}))
          })),
          statusCounts: result.statusCounts || {},
          details: (result.details || []).map((row) => ({name: row.name, status: row.status}))
        };
      },
      run(spec, options) {
        window.__worldInfoAlignment.setup(spec);
        return window.__worldInfoAlignment.resolve(spec, options);
      }
    };
  });

  const run = (spec, options) => page.evaluate(([value, extra]) => window.__worldInfoAlignment.run(value, extra), [spec, options || null]);
  const evidence = {};

  const entry = (over) => Object.assign({
    id: over.id, name: over.id, content: over.content || ('内容-' + over.id),
    keys: over.keys || [], enabled: true, position: 'after_char', order: 100
  }, over);
  const book = (id, entries, extra) => Object.assign({id, name: id, entries}, extra || {});
  const bodies = (result) => result.afterChar.slice();

  // ---- 4.3 entry scanDepth 0 -------------------------------------------------------
  const zeroDepthSpec = {
    msgs: [{role: 'user', content: '我们潜入深水区', seq: 1}],
    globalScanData: {personaDescription: '深水区的老手', characterDescription: '深水区向导'},
    categories: [book('zero', [
      entry({id: 'zero-keyword', keys: ['深水'], scanDepth: 0}),
      entry({id: 'zero-source', keys: ['深水'], scanDepth: 0, matchPersonaDescription: true, matchCharacterDescription: true}),
      entry({id: 'zero-constant', keys: [], scanDepth: 0, constant: true}),
      entry({id: 'depth-keyword', keys: ['深水']})
    ])]
  };
  const zeroDepth = await run(zeroDepthSpec);
  if (process.env.YEYU_WORLD_INFO_DEBUG) console.log('DEBUG zeroDepth', JSON.stringify(zeroDepth, null, 1));
  const zeroNames = bodies(zeroDepth);
  assert.ok(!zeroNames.includes('内容-zero-keyword'), '条目 scanDepth=0 时聊天关键词不得命中');
  assert.ok(!zeroNames.includes('内容-zero-source'), '条目 scanDepth=0 时额外扫描来源也不得让它命中');
  assert.ok(zeroNames.includes('内容-zero-constant'), '常驻条目不依赖扫描缓冲');
  assert.ok(zeroNames.includes('内容-depth-keyword'), '未设置 scanDepth 的同关键词条目必须命中');
  evidence.entryScanDepthZero = {activated: zeroNames.length, blockedKeyword: true, blockedExtraSource: true, constantStillWorks: true};

  // Global depth 0 can still be advanced by the minimum-activation scan; an entry that
  // sets scanDepth 0 itself never joins that advance.
  const globalZero = await run({
    msgs: [
      {role: 'user', content: '很久以前提到过灯塔', seq: 1},
      {role: 'assistant', content: '嗯。', seq: 2},
      {role: 'user', content: '现在只说天气', seq: 3}
    ],
    settings: {scan_depth: 0, min_activations: 1, min_activations_depth_max: 5},
    categories: [book('global-zero', [
      entry({id: 'far-keyword', keys: ['灯塔']}),
      entry({id: 'far-explicit-zero', keys: ['灯塔'], scanDepth: 0})
    ])]
  });
  const globalZeroNames = bodies(globalZero);
  assert.ok(globalZeroNames.includes('内容-far-keyword'), '全局深度 0 必须能被最少激活数扫描推进');
  assert.ok(!globalZeroNames.includes('内容-far-explicit-zero'), '条目显式 scanDepth=0 不随最少激活数推进');
  evidence.globalDepthZeroAdvance = {advanced: true, explicitZeroStaysOff: true};

  // ---- 4.3 six extra scan sources --------------------------------------------------
  const sources = [
    ['matchPersonaDescription', 'personaDescription', '角标甲'],
    ['matchCharacterDescription', 'characterDescription', '角标乙'],
    ['matchCharacterPersonality', 'characterPersonality', '角标丙'],
    ['matchCharacterDepthPrompt', 'characterDepthPrompt', '角标丁'],
    ['matchScenario', 'scenario', '角标戊'],
    ['matchCreatorNotes', 'creatorNotes', '角标己']
  ];
  evidence.extraScanSources = [];
  for (const [flag, field, token] of sources) {
    const scanData = {};
    scanData[field] = '这里写着' + token + '。';
    const spec = {
      msgs: [{role: 'user', content: '今天天气不错', seq: 1}],
      globalScanData: scanData,
      categories: [book('source-' + flag, [
        entry(Object.assign({id: 'on-' + flag, keys: [token]}, {[flag]: true})),
        entry({id: 'off-' + flag, keys: [token]})
      ])]
    };
    const result = bodies(await run(spec));
    assert.ok(result.includes('内容-on-' + flag), '开启 ' + flag + ' 后必须在该来源里命中');
    assert.ok(!result.includes('内容-off-' + flag), '未开启 ' + flag + ' 的条目不得因该来源命中');
    evidence.extraScanSources.push({flag, positive: true, negative: true});
  }

  // ---- 4.3 generation type filtering -----------------------------------------------
  const triggerCases = [['new', 'normal'], ['continue', 'continue'], ['regenerate', 'regenerate']];
  evidence.generationTypes = [];
  for (const [mode, expected] of triggerCases) {
    const result = await run({
      msgs: [{role: 'user', content: '提到钥匙', seq: 1}],
      generationType: mode,
      categories: [book('trigger-' + mode, [
        entry({id: 'only-normal', keys: ['钥匙'], triggers: ['normal']}),
        entry({id: 'only-continue', keys: ['钥匙'], triggers: ['continue']}),
        entry({id: 'only-regenerate', keys: ['钥匙'], triggers: ['regenerate']}),
        entry({id: 'no-filter', keys: ['钥匙']})
      ])]
    });
    const names = bodies(result);
    assert.ok(names.includes('内容-only-' + expected), mode + ' 必须命中 ' + expected + ' 过滤条目');
    assert.ok(names.includes('内容-no-filter'), '没有生成类型过滤的条目必须始终参与');
    assert.strictEqual(names.length, 2, mode + ' 下不匹配的生成类型条目不得进入 Prompt：' + JSON.stringify(names));
    assert.strictEqual(result.statusCounts['trigger-filtered'], 2, mode + ' 必须记录两条被生成类型过滤的条目');
    evidence.generationTypes.push({mode, mappedTo: expected, filtered: 2});
  }

  // ---- 4.3 character name and tag filtering ----------------------------------------
  const filterSpec = {
    charId: 'char-a',
    characters: [
      {id: 'char-a', name: '甲角色', tags: ['海港', '夜晚']},
      {id: 'char-b', name: '乙角色', tags: ['沙漠']}
    ],
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    categories: [book('filter', [
      entry({id: 'name-include', keys: ['灯塔'], characterFilter: {names: ['甲角色'], tags: [], isExclude: false}}),
      entry({id: 'name-exclude', keys: ['灯塔'], characterFilter: {names: ['甲角色'], tags: [], isExclude: true}}),
      entry({id: 'tag-include', keys: ['灯塔'], characterFilter: {names: [], tags: ['海港'], isExclude: false}}),
      entry({id: 'tag-exclude', keys: ['灯塔'], characterFilter: {names: [], tags: ['海港'], isExclude: true}}),
      entry({id: 'both-include', keys: ['灯塔'], characterFilter: {names: ['甲角色'], tags: ['海港'], isExclude: false}}),
      entry({id: 'name-only-include', keys: ['灯塔'], characterFilter: {names: ['甲角色'], tags: ['沙漠'], isExclude: false}})
    ])]
  };
  const filterA = bodies(await run(filterSpec));
  // Names and tags are two separate passes (SillyTavern checkWorldInfo): an include filter needs both.
  assert.deepStrictEqual(filterA.sort(), ['内容-name-include', '内容-tag-include', '内容-both-include'].sort(), '角色甲只应命中名字与标签都通过的包含式过滤：' + JSON.stringify(filterA));
  const filterB = bodies(await run(Object.assign({}, filterSpec, {charId: 'char-b'})));
  assert.deepStrictEqual(filterB.sort(), ['内容-name-exclude', '内容-tag-exclude'].sort(), '切换角色后不得串用旧过滤结果：' + JSON.stringify(filterB));
  const filterNone = bodies(await run(Object.assign({}, filterSpec, {
    charId: 'char-c',
    characters: filterSpec.characters.concat([{id: 'char-c', name: '丙角色'}])
  })));
  assert.deepStrictEqual(filterNone.sort(), ['内容-name-exclude', '内容-tag-include', '内容-tag-exclude'].sort(), '没有标签数据的角色跳过标签过滤，只按名字过滤');
  evidence.characterFilter = {names: true, tags: true, include: true, exclude: true, switchIsolated: true};

  // ---- 4.4 inclusion groups --------------------------------------------------------
  const groupSpec = (over) => ({
    msgs: [{role: 'user', content: '提到灯塔和港口', seq: 1}],
    rolls: over.rolls || [0.99],
    categories: over.categories
  });
  const multiGroup = await run(groupSpec({
    rolls: [0.01, 0.01],
    categories: [book('multi', [
      entry({id: 'both', keys: ['灯塔'], group: '组甲, 组乙', groupWeight: 100}),
      entry({id: 'only-a', keys: ['灯塔'], group: '组甲', groupWeight: 1}),
      entry({id: 'only-b', keys: ['灯塔'], group: '组乙', groupWeight: 1})
    ])]
  }));
  assert.deepStrictEqual(bodies(multiGroup), ['内容-both'], '逗号分隔的多组必须让同一条目参加每个组的抽选：' + JSON.stringify(bodies(multiGroup)));

  const crossBook = await run(groupSpec({
    rolls: [0.01],
    categories: [
      book('global-book', [entry({id: 'global-side', keys: ['灯塔'], group: '同名组', groupWeight: 100})]),
      book('char-book', [entry({id: 'char-side', keys: ['灯塔'], group: '同名组', groupWeight: 1})], {boundCharIds: ['alignment-char']})
    ]
  }));
  assert.strictEqual(bodies(crossBook).length, 1, '跨世界书的同名组必须只留一个赢家：' + JSON.stringify(bodies(crossBook)));

  const weighted = await run(groupSpec({
    rolls: [0.99],
    categories: [book('weight', [
      entry({id: 'heavy', keys: ['灯塔'], group: '权重组', groupWeight: 1}),
      entry({id: 'light', keys: ['灯塔'], group: '权重组', groupWeight: 1000})
    ])]
  }));
  assert.deepStrictEqual(bodies(weighted), ['内容-light'], '组权重必须影响抽选结果：' + JSON.stringify(bodies(weighted)));

  const scored = await run(groupSpec({
    rolls: [0.01],
    categories: [book('score', [
      entry({id: 'one-hit', keys: ['灯塔'], group: '评分组', groupWeight: 1000, useGroupScoring: true}),
      entry({id: 'two-hits', keys: ['灯塔', '港口'], group: '评分组', groupWeight: 1, useGroupScoring: true})
    ])]
  }));
  assert.deepStrictEqual(bodies(scored), ['内容-two-hits'], '开启组评分后命中更多关键词的条目胜出：' + JSON.stringify(bodies(scored)));

  const overridden = await run(groupSpec({
    rolls: [0.99],
    categories: [book('override', [
      entry({id: 'plain', keys: ['灯塔'], group: '优先组', groupWeight: 1000}),
      entry({id: 'priority', keys: ['灯塔'], group: '优先组', groupWeight: 1, groupOverride: true, order: 300})
    ])]
  }));
  assert.deepStrictEqual(bodies(overridden), ['内容-priority'], 'groupOverride 条目必须直接成为赢家：' + JSON.stringify(bodies(overridden)));
  evidence.inclusionGroups = {
    multiGroup: true, crossBookSameName: true, weight: true, scoring: true, groupOverride: true
  };

  // ---- 4.4 probability is re-rolled on every new evaluation --------------------------
  const probabilitySpec = {
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    categories: [book('probability', [entry({id: 'coin', keys: ['灯塔'], probability: 50, useProbability: true})])]
  };
  const rolledIn = await run(Object.assign({}, probabilitySpec, {rolls: [0.10]}));
  const rolledOut = await run(Object.assign({}, probabilitySpec, {rolls: [0.90]}));
  assert.deepStrictEqual(bodies(rolledIn), ['内容-coin'], '低点数必须通过 50% 概率');
  assert.deepStrictEqual(bodies(rolledOut), [], '高点数必须被 50% 概率挡下');
  assert.strictEqual(rolledOut.statusCounts.probability, 1, '被概率挡下的条目必须留下可读原因');
  evidence.probability = {rerolledPerEvaluation: true, statusRecorded: true};

  // ---- 4.4 sticky, cooldown and delay are counted in messages ------------------------
  const timedSpec = (msgs) => ({
    msgs,
    categories: [book('timed', [
      entry({id: 'sticky-entry', keys: ['灯塔'], sticky: 2, cooldown: 2}),
      entry({id: 'delayed-entry', keys: ['港口'], delay: 4})
    ])]
  });
  const timedTrace = await page.evaluate(([spec]) => {
    window.__worldInfoAlignment.setup(spec);
    const session = {id: 'alignment-timed', msgs: []};
    const script = [
      {role: 'assistant', content: '开场白，提到灯塔和港口。', opening: true, openingIndex: 0},
      {role: 'user', content: '我们去灯塔吧'},
      {role: 'assistant', content: '好的。'},
      {role: 'user', content: '继续走'},
      {role: 'assistant', content: '嗯。'},
      {role: 'user', content: '现在说说港口'},
      {role: 'assistant', content: '好。'}
    ];
    const trace = [];
    script.forEach((row, index) => {
      session.msgs.push(Object.assign({seq: index + 1}, row));
      const result = resolveWorldBook(
        session.msgs.map((message) => ({text: String(message.content || '')})),
        D.currentCharId, session,
        {commitRuntime: true, generationType: 'new', maxContext: 8192, globalScanData: {}}
      );
      trace.push({
        messages: session.msgs.length,
        activated: result.afterCharItems.map((item) => item.content),
        statuses: (result.details || []).map((detail) => detail.name + ':' + detail.status)
      });
    });
    return trace;
  }, [timedSpec([])]);
  // Messages, not user turns: the opening message and every assistant reply advance the
  // counter, so a sticky of 2 covers exactly the next message and then hands over to cooldown.
  assert.ok(timedTrace[0].statuses.includes('sticky-entry:activated'), '开场白里的关键词必须能触发条目');
  assert.ok(timedTrace[1].statuses.includes('sticky-entry:sticky'), '持续消息数必须按消息推进');
  assert.ok(!timedTrace[2].activated.includes('内容-sticky-entry'), '持续期结束后不得继续带入');
  assert.ok(timedTrace[2].statuses.includes('sticky-entry:cooldown'), '持续期结束必须进入冷却并可读');
  assert.ok(timedTrace[3].statuses.includes('sticky-entry:cooldown'), '冷却同样按消息计数');
  assert.ok(timedTrace[4].statuses.includes('sticky-entry:activated'), '冷却结束后必须能再次触发');
  const delayedFirst = timedTrace.findIndex((row) => row.activated.includes('内容-delayed-entry'));
  assert.strictEqual(timedTrace[delayedFirst].messages, 4, '等待消息数必须按消息计数：' + JSON.stringify(timedTrace.map((row) => row.activated)));
  assert.ok(timedTrace.slice(0, delayedFirst).every((row) => row.statuses.includes('delayed-entry:delayed')), '等待期内必须记录 delayed');
  evidence.timedEffects = {
    countedInMessages: true,
    trace: timedTrace.map((row) => ({messages: row.messages, activated: row.activated}))
  };

  // ---- 4.5 budget, ordering and insertion strategy -----------------------------------
  const budgetEntries = [
    entry({id: 'budget-high', keys: ['灯塔'], order: 300, content: '甲'.repeat(40)}),
    entry({id: 'budget-mid', keys: ['灯塔'], order: 200, content: '乙'.repeat(40)}),
    entry({id: 'budget-low', keys: ['灯塔'], order: 100, content: '丙'.repeat(40)})
  ];
  const roomy = await run({
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    settings: {token_budget: 4096},
    categories: [book('budget', budgetEntries)]
  });
  assert.strictEqual(bodies(roomy).length, 3, '预算充足时三条都应加入');
  // Two of the three bodies fit in 50 tokens, the third overflows: the official rule stops
  // handing out ordinary entries once one of them reaches the remaining budget.
  const oneShort = await run({
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    settings: {token_budget: 50},
    categories: [book('budget', budgetEntries)]
  });
  assert.strictEqual(bodies(oneShort).length, 2, '预算刚好少一个条目时必须挡下最后一条普通条目：' + JSON.stringify(bodies(oneShort)));
  assert.ok(bodies(oneShort).includes('甲'.repeat(40)) && bodies(oneShort).includes('乙'.repeat(40)), '高 order 条目必须先加入');
  assert.ok(!bodies(oneShort).includes('丙'.repeat(40)), '低 order 条目必须最先被挤掉');
  assert.strictEqual(oneShort.statusCounts['budget-dropped'], 1, '被预算挡下的条目必须留下可读原因');
  const ignoring = await run({
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    settings: {token_budget: 1},
    categories: [book('budget', budgetEntries.concat([
      entry({id: 'budget-must', keys: ['灯塔'], order: 10, ignoreBudget: true, content: '丁'.repeat(60)})
    ]))]
  });
  assert.ok(bodies(ignoring).includes('丁'.repeat(60)), '忽略预算的条目不得因普通预算耗尽被丢弃：' + JSON.stringify(bodies(ignoring)));
  const strategySpec = {
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    settings: {token_budget: 20},
    categories: [
      book('global-src', [entry({id: 'from-global', keys: ['灯塔'], order: 100, content: '全'.repeat(20)})]),
      book('char-src', [entry({id: 'from-char', keys: ['灯塔'], order: 100, content: '角'.repeat(20)})], {boundCharIds: ['alignment-char']})
    ]
  };
  const characterFirst = await run(Object.assign({}, strategySpec, {
    settings: Object.assign({}, strategySpec.settings, {insertion_strategy: 'character_first'})
  }));
  const globalFirst = await run(Object.assign({}, strategySpec, {
    settings: Object.assign({}, strategySpec.settings, {insertion_strategy: 'global_first'})
  }));
  assert.notDeepStrictEqual(bodies(characterFirst), bodies(globalFirst), '来源排序必须改变预算不足时的赢家');
  evidence.budget = {
    justOneShort: bodies(oneShort), ignoreBudgetKept: true,
    characterFirst: bodies(characterFirst), globalFirst: bodies(globalFirst)
  };

  // ---- 4.5 official insertion positions and named outlets -----------------------------
  const positions = ['before_char', 'after_char', 'em_top', 'em_bottom', 'an_top', 'an_bottom', 'at_depth', 'before_user'];
  const placed = await run({
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    categories: [book('positions', positions.map((position) => entry({
      id: 'pos-' + position, keys: ['灯塔'], position, depth: position === 'at_depth' ? 2 : 0, role: 'user'
    })).concat([
      entry({id: 'outlet-a', keys: ['灯塔'], position: 'outlet', outletName: 'Lore', order: 300}),
      entry({id: 'outlet-b', keys: ['灯塔'], position: 'outlet', outletName: 'Lore', order: 100}),
      entry({id: 'outlet-unnamed', keys: ['灯塔'], position: 'outlet'})
    ]))]
  });
  assert.deepStrictEqual(placed.beforeChar, ['内容-pos-before_char']);
  assert.deepStrictEqual(placed.afterChar, ['内容-pos-after_char']);
  assert.deepStrictEqual(placed.emTop, ['内容-pos-em_top']);
  assert.deepStrictEqual(placed.emBottom, ['内容-pos-em_bottom']);
  assert.deepStrictEqual(placed.anTop, ['内容-pos-an_top']);
  assert.deepStrictEqual(placed.anBottom, ['内容-pos-an_bottom']);
  assert.deepStrictEqual(placed.beforeUser, ['内容-pos-before_user']);
  assert.deepStrictEqual(placed.inChat, [{depth: 2, rows: [{content: '内容-pos-at_depth', role: 'user'}]}]);
  assert.deepStrictEqual(placed.outlets.map((row) => row.content), ['内容-outlet-a', '内容-outlet-b'], '同名出口必须按官方顺序汇总');
  assert.ok(placed.details.some((row) => row.name === 'outlet-unnamed' && row.status === 'outlet-unnamed'), '缺少出口名称时必须明确丢弃');
  evidence.positions = {
    covered: positions.concat(['outlet']),
    sameNameOutletOrder: placed.outlets.map((row) => row.name + ':' + row.content),
    unnamedOutletDropped: true
  };

  // ---- 4.7 official regex keys, including long patterns and pathological input --------
  const regexProbe = await page.evaluate(async ([spec]) => {
    window.__worldInfoAlignment.setup(spec);
    resetWorldBookRegexKeyScope();
    const session = {id: 'alignment-regex', msgs: spec.msgs};
    const scan = spec.msgs.map((row) => ({text: String(row.content || '')}));
    const options = {generationType: 'new', maxContext: 8192, globalScanData: {}};
    const first = resolveWorldBook(scan, D.currentCharId, session, options);
    const misses = worldBookRegexKeyMisses();
    let workerError = '';
    let answered = 0;
    try {
      answered = await prepareWorldBookRegexKeys(getChar(), misses);
    } catch (error) {
      workerError = String(error && error.message || error);
    }
    const second = resolveWorldBook(scan, D.currentCharId, session, options);
    return {
      misses: misses.length,
      answered,
      workerError,
      firstPass: first.afterCharItems.map((item) => item.content),
      secondPass: second.afterCharItems.map((item) => item.content),
      statuses: (second.details || []).map((row) => row.name + ':' + row.status)
    };
  }, [{
    msgs: [{role: 'user', content: '灯塔守夜人在 2026-08-18 值班', seq: 1}],
    categories: [book('regex', [
      entry({id: 'plain-regex', keys: ['/守夜人/']}),
      entry({id: 'no-regex', keys: ['灯塔']})
    ])]
  }]);
  assert.strictEqual(regexProbe.workerError, '', '正则关键词必须能在隔离 Worker 中算完：' + regexProbe.workerError);
  assert.ok(regexProbe.misses >= 1, '正则关键词首轮必须登记为未命中并交给 Worker：' + regexProbe.misses);
  assert.ok(regexProbe.firstPass.includes('内容-no-regex'), '普通关键词不受正则等待影响');
  assert.ok(regexProbe.secondPass.includes('内容-plain-regex'), '普通正则关键词必须命中');
  evidence.regexKeys = {
    misses: regexProbe.misses, answered: regexProbe.answered,
    terminableWorker: true
  };

  // ---- 4.6 session isolation ----------------------------------------------------------
  const isolation = await page.evaluate(([spec]) => {
    window.__worldInfoAlignment.setup(spec);
    const options = {commitRuntime: true, generationType: 'new', maxContext: 8192, globalScanData: {}};
    const sessionA = {id: 'session-a', msgs: [{role: 'user', content: '提到灯塔', seq: 1}]};
    const sessionB = {id: 'session-b', msgs: [{role: 'user', content: '只说天气', seq: 1}]};
    const scanOf = (session) => session.msgs.map((row) => ({text: String(row.content || '')}));
    const first = resolveWorldBook(scanOf(sessionA), D.currentCharId, sessionA, options);
    const other = resolveWorldBook(scanOf(sessionB), D.currentCharId, sessionB, options);
    sessionA.msgs.push({role: 'assistant', content: '好的。', seq: 2});
    const back = resolveWorldBook(scanOf(sessionA), D.currentCharId, sessionA, options);
    return {
      first: first.afterCharItems.map((item) => item.content),
      other: other.afterCharItems.map((item) => item.content),
      back: back.afterCharItems.map((item) => item.content),
      otherRuntime: JSON.stringify(sessionB.worldBookRuntime || {})
    };
  }, [{
    categories: [book('isolation', [entry({id: 'sticky-only', keys: ['灯塔'], sticky: 3})])]
  }]);
  assert.deepStrictEqual(isolation.first, ['内容-sticky-only'], '首个会话必须命中');
  assert.deepStrictEqual(isolation.other, [], '另一个会话不得继承持续状态：' + JSON.stringify(isolation));
  assert.deepStrictEqual(isolation.back, ['内容-sticky-only'], '切回原会话必须使用自己的持续状态');
  assert.strictEqual(isolation.otherRuntime, '{"sticky":{},"cooldown":{},"matched":{}}', '未命中的会话不得写入他人的时效状态');
  evidence.sessionIsolation = {perSessionRuntime: true, switchBackKeepsOwnState: true};

  // Two books may carry the same entry id; their timed-effect state must never be shared.
  const sameIdBooks = await page.evaluate(([spec]) => {
    window.__worldInfoAlignment.setup(spec);
    const options = {commitRuntime: true, generationType: 'new', maxContext: 8192, globalScanData: {}};
    const session = {id: 'alignment-same-id', msgs: [{role: 'user', content: '龙', seq: 1}]};
    const first = resolveWorldBook([{text: '龙'}], D.currentCharId, session, options);
    session.msgs.push({role: 'assistant', content: '回应', seq: 2}, {role: 'user', content: '今天很安静', seq: 3});
    const second = resolveWorldBook([{text: '今天很安静'}], D.currentCharId, session, options);
    return {
      firstCount: first.count,
      runtimeGroups: Object.keys(session.worldBookRuntime).sort(),
      matchedKeys: Object.keys(session.worldBookRuntime.matched || {}).length,
      secondCount: second.count,
      secondStatuses: second.details.map((row) => row.name + ':' + row.status),
      secondRuntimeKeys: new Set(second.details.map((row) => row.runtimeKey)).size
    };
  }, [{
    categories: [
      book('same-id-a', [entry({id: '1', name: 'A 条目', keys: ['龙'], sticky: 5})]),
      book('same-id-b', [entry({id: '1', name: 'B 条目', keys: ['龙'], cooldown: 3})])
    ]
  }]);
  assert.strictEqual(sameIdBooks.firstCount, 2);
  assert.deepStrictEqual(sameIdBooks.runtimeGroups, ['cooldown', 'matched', 'sticky'], '运行时状态按效果类型分组');
  assert.strictEqual(sameIdBooks.matchedKeys, 2, '相同条目 ID 的两个分类必须有独立运行时状态');
  assert.strictEqual(sameIdBooks.secondCount, 1);
  assert.ok(sameIdBooks.secondStatuses.includes('A 条目:sticky') && sameIdBooks.secondStatuses.includes('B 条目:cooldown'), '两个分类必须各自推进时效：' + JSON.stringify(sameIdBooks.secondStatuses));
  assert.strictEqual(sameIdBooks.secondRuntimeKeys, 2);
  evidence.sameIdRuntimeKeys = {separateRuntime: true};

  // ---- 4.1 field source priority: top-level camelCase, then snake_case, then extensions
  const conflict = await page.evaluate(() => {
    const normalized = normalizeWBEntry({
      id: 'conflict', content: '冲突夹具', keys: ['灯塔'],
      ignoreBudget: true, ignore_budget: false,
      useGroupScoring: true, use_group_scoring: false,
      matchWholeWords: true, match_whole_words: false,
      outletName: 'FromCamel', outlet_name: 'FromSnake',
      automationId: 'from-camel', automation_id: 'from-snake',
      matchScenario: true, match_scenario: false,
      extensions: {
        ignore_budget: false, use_group_scoring: false, match_whole_words: false,
        outlet_name: 'FromExtensions', automation_id: 'from-extensions',
        match_scenario: false, third_party_unknown: '第三方保留值'
      }
    });
    const snakeOnly = normalizeWBEntry({
      id: 'snake', content: '只有下划线写法', keys: ['灯塔'],
      ignore_budget: true, outlet_name: 'FromSnake', match_scenario: true,
      extensions: {ignore_budget: false, outlet_name: 'FromExtensions', match_scenario: false}
    });
    const extensionsOnly = normalizeWBEntry({
      id: 'ext', content: '只有扩展写法', keys: ['灯塔'],
      extensions: {ignore_budget: true, outlet_name: 'FromExtensions', match_scenario: true}
    });
    const orderedAliases = normalizeWBEntry({
      id: 'ordered-aliases', content: '别名优先级', keys: ['灯塔'],
      chance: 22, insertion_depth: 4, sticky_depth: 6, cooldown_turns: 8,
      extensions: {probability: 33, depth: 5, sticky: 7, cooldown: 9}
    });
    // A SillyTavern export writes the legacy field names; each one must land on its official meaning.
    const stExport = normalizeWBEntry({
      uid: 'third-party-id', key: ['Alpha'], keysecondary: ['Beta'], text: 'Keep {{char}} and https://example.test/x',
      constant: false, selective: true, position: 'at_depth', insertion_order: 77, depth: 9, probability: 43,
      use_probability: true, exclude_recursion: true, prevent_recursion: true, case_sensitive: true, match_whole_words: true,
      group: 'g', group_override: true, group_weight: 55, sticky: 4, cooldown: 3, delay: 2, role: 'assistant',
      extensions: {future_rule: {keep: true}}, unknown_field: 'preserve'
    });
    const pick = (row) => ({
      ignoreBudget: row.ignoreBudget, useGroupScoring: row.useGroupScoring,
      matchWholeWords: row.matchWholeWords, outletName: row.outletName,
      automationId: row.automationId, matchScenario: row.matchScenario
    });
    return {
      camel: pick(normalized),
      snake: pick(snakeOnly),
      extensions: pick(extensionsOnly),
      orderedAliases: {
        probability: orderedAliases.probability, depth: orderedAliases.depth,
        sticky: orderedAliases.sticky, cooldown: orderedAliases.cooldown
      },
      unknownPreserved: normalized.extensions.third_party_unknown,
      rawPreserved: JSON.stringify(normalized._raw.extensions),
      stExport: {
        id: stExport.id, keys: stExport.keys, secondary: stExport.secondary_keys, content: stExport.content,
        selective: stExport.selective, position: stExport.position, order: stExport.order, depth: stExport.depth,
        probability: stExport.probability, exclude: stExport.excludeRecursion, prevent: stExport.preventRecursion,
        sensitive: stExport.caseSensitive, whole: stExport.matchWholeWords, group: stExport.group,
        override: stExport.groupOverride, weight: stExport.groupWeight, sticky: stExport.sticky,
        cooldown: stExport.cooldown, delay: stExport.delay, role: stExport.role,
        unknownField: stExport._raw.unknown_field, futureRule: stExport.extensions.future_rule
      },
      emptyKeysFallback: normalizeWBEntry({keys: [], key: ['fallback-key']}).keys,
      bookSettings: normalizeWBSettings({scanDepth: 12, tokenBudget: 3456, recursive_scanning: false, case_sensitive: true, settings: {unknown: 'keep'}})
    };
  });
  assert.deepStrictEqual(conflict.camel, {
    ignoreBudget: true, useGroupScoring: true, matchWholeWords: true,
    outletName: 'FromCamel', automationId: 'from-camel', matchScenario: true
  }, '同一语义有多来源时，顶层 camelCase 必须胜出：' + JSON.stringify(conflict.camel));
  assert.strictEqual(conflict.snake.ignoreBudget, true, '没有 camelCase 时顶层 snake_case 胜出');
  assert.strictEqual(conflict.snake.outletName, 'FromSnake');
  assert.strictEqual(conflict.snake.matchScenario, true);
  assert.strictEqual(conflict.extensions.ignoreBudget, true, '两种顶层写法都没有时才使用 extensions');
  assert.strictEqual(conflict.extensions.outletName, 'FromExtensions');
  assert.strictEqual(conflict.extensions.matchScenario, true);
  assert.deepStrictEqual(conflict.orderedAliases, {probability: 22, depth: 4, sticky: 6, cooldown: 8}, '顶层兼容字段必须先于 extensions：' + JSON.stringify(conflict.orderedAliases));
  assert.strictEqual(conflict.unknownPreserved, '第三方保留值', '未被采用的来源和未知字段必须原样保留');
  assert.match(conflict.rawPreserved, /third_party_unknown/, '原始对象必须保留全部来源');
  assert.deepStrictEqual(conflict.stExport, {
    id: 'third-party-id', keys: ['Alpha'], secondary: ['Beta'], content: 'Keep {{char}} and https://example.test/x',
    selective: true, position: 'at_depth', order: 77, depth: 9, probability: 43, exclude: true, prevent: true,
    sensitive: true, whole: true, group: 'g', override: true, weight: 55, sticky: 4, cooldown: 3, delay: 2, role: 'assistant',
    unknownField: 'preserve', futureRule: {keep: true}
  }, 'ST 导出的旧字段名必须映射到官方语义，未知字段原样保留：' + JSON.stringify(conflict.stExport));
  assert.deepStrictEqual(conflict.emptyKeysFallback, ['fallback-key'], '空 keys 不应覆盖非空 key');
  assert.deepStrictEqual(conflict.bookSettings, {scan_depth: 12, token_budget: 3456, recursive: false, caseSensitive: true, raw: {unknown: 'keep'}}, '世界书设置的别名必须归一化且保留未知设置');
  evidence.fieldSourcePriority = conflict;

  // ---- 4.1 triggers stay a generation-type filter, never keywords --------------------
  const triggerFieldMeaning = await page.evaluate(() => {
    const normalized = normalizeWBEntry({
      id: 'trigger-meaning', content: '生成类型过滤内容', keys: ['真关键词'],
      triggers: ['normal', 'continue', 'regenerate', '不是生成类型']
    });
    return {keys: normalized.keys, triggers: normalized.triggers, raw: (normalized._raw.triggers || []).slice()};
  });
  assert.deepStrictEqual(triggerFieldMeaning.keys, ['真关键词'], 'triggers 不得被并进关键词');
  assert.deepStrictEqual(triggerFieldMeaning.triggers, ['normal', 'continue', 'regenerate'], '只有官方生成类型进入过滤');
  assert.deepStrictEqual(triggerFieldMeaning.raw, ['normal', 'continue', 'regenerate', '不是生成类型'], '未识别的值必须原样保留');
  evidence.triggersAreGenerationTypes = triggerFieldMeaning;

  // ---- 4.3 speaker name prefix and message boundary in the scan window ----------------
  // Driven through buildMessages so the scan window is the one the model actually gets.
  const namePrefix = await page.evaluate(async ([includeNames]) => {
    const char = {
      id: 'alignment-names', name: '守夜人', description: '', personality: '', scenario: '',
      first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '',
      extensions: {}, regexScripts: []
    };
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {};
    D.worldBook = {
      categories: [{
        id: 'names-book', name: 'names', settings: null, boundCharIds: null,
        entries: [
          normalizeWBEntry({id: 'needs-name', keys: ['守夜人:'], content: '命中了发言人名称'}),
          normalizeWBEntry({id: 'needs-content', keys: ['灯塔'], content: '命中了正文'})
        ]
      }],
      globalCategoryIds: ['names-book'], activeCategoryId: '',
      scan_depth: 20, token_budget: 0, recursive: false, include_names: includeNames
    };
    const session = getActiveSession(char.id);
    session.msgs = [{seq: 1, role: 'assistant', content: '夜里去了灯塔。', time: Date.now()}];
    const built = buildMessages(char, session.msgs, session, {commit: false});
    const text = built.messages.map((row) => String(row.content || '')).join('\n');
    return {
      includeNames: worldBookSettings().includeNames,
      matchedName: text.includes('命中了发言人名称'),
      matchedContent: text.includes('命中了正文')
    };
  }, [true]);
  const noNamePrefix = await page.evaluate(async () => {
    D.worldBook.include_names = false;
    const char = getChar();
    const session = getActiveSession(char.id);
    const built = buildMessages(char, session.msgs, session, {commit: false});
    const text = built.messages.map((row) => String(row.content || '')).join('\n');
    return {
      includeNames: worldBookSettings().includeNames,
      matchedName: text.includes('命中了发言人名称'),
      matchedContent: text.includes('命中了正文')
    };
  });
  assert.strictEqual(namePrefix.includeNames, true);
  assert.strictEqual(namePrefix.matchedName, true, '开启发言人名称后，名称前缀必须进入关键词扫描');
  assert.strictEqual(noNamePrefix.includeNames, false);
  assert.strictEqual(noNamePrefix.matchedName, false, '关闭发言人名称后，名称前缀不得再让条目命中');
  assert.strictEqual(namePrefix.matchedContent, true);
  assert.strictEqual(noNamePrefix.matchedContent, true, '同一段聊天正文的命中不受名称开关影响');
  const boundary = await page.evaluate(() => {
    const settings = worldBookSettings();
    const buffer = wbScanBuffer(['第二句', '第一句'], {}, settings);
    const text = buffer.get({scanDepth: null, _catSettings: null}, 1);
    return {
      startsWithBoundary: text.charCodeAt(0) === 1,
      joinedByBoundary: text.indexOf('\n' + String.fromCharCode(1)) > 0
    };
  });
  assert.ok(boundary.startsWithBoundary && boundary.joinedByBoundary, '扫描窗口必须带官方消息边界：' + JSON.stringify(boundary));
  evidence.scanWindow = {includeNamesOn: namePrefix, includeNamesOff: noNamePrefix, messageBoundary: boundary};

  // ---- 4.4 recursion, minimum activations and recursion steps -------------------------
  const recursionBook = () => book('recursion', [
    entry({id: 'seed', keys: ['灯塔'], content: '灯塔的记录提到了密钥。'}),
    entry({id: 'level-1', keys: ['密钥'], content: '密钥打开了暗门。'}),
    entry({id: 'level-2', keys: ['暗门'], content: '暗门后面是地窖。'}),
    entry({id: 'level-3', keys: ['地窖'], content: '地窖里放着旧灯。'}),
    // Official meaning: non-recursable entries can never be reached by recursion.
    entry({id: 'non-recursable', keys: ['密钥'], content: '这条不被其他条目触发。', excludeRecursion: true}),
    // Official meaning: this entry can be reached, but its own content stops the chain.
    entry({id: 'stopper', keys: ['密钥'], content: '这条到此为止，也提到地窖。', preventRecursion: true})
  ]);
  const noRecursion = bodies(await run({
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    settings: {recursive: false},
    categories: [recursionBook()]
  }));
  assert.deepStrictEqual(noRecursion, ['灯塔的记录提到了密钥。'], '关闭递归时只命中直接关键词：' + JSON.stringify(noRecursion));
  const withRecursion = bodies(await run({
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    settings: {recursive: true},
    categories: [recursionBook()]
  }));
  assert.ok(withRecursion.includes('密钥打开了暗门。'), '开启递归后已激活条目的正文必须能触发关联条目');
  assert.ok(withRecursion.includes('暗门后面是地窖。'), '递归必须能继续到下一层');
  assert.ok(withRecursion.includes('这条到此为止，也提到地窖。'), '“不再触发其他条目”的条目本身仍可被递归触发');
  assert.ok(!withRecursion.includes('这条不被其他条目触发。'), '“不被其他条目触发”的条目不得通过递归激活');
  const cappedRecursion = bodies(await run({
    msgs: [{role: 'user', content: '提到灯塔', seq: 1}],
    settings: {recursive: true, max_recursion_steps: 2},
    categories: [recursionBook()]
  }));
  assert.ok(cappedRecursion.includes('密钥打开了暗门。'), '限制递归步数后第一层仍应生效');
  assert.ok(!cappedRecursion.includes('暗门后面是地窖。'), '达到最大递归步数后必须停止：' + JSON.stringify(cappedRecursion));
  evidence.recursion = {off: noRecursion, on: withRecursion, capped: cappedRecursion};

  // ---- 4.4 secondary key logic, case and whole words ----------------------------------
  const selectiveCases = [
    ['0', '任意一个', ['甲', '丙'], true],
    ['0', '一个都没有', ['丙', '丁'], false],
    ['3', '全部命中', ['甲', '乙'], true],
    ['3', '只命中一个', ['甲', '丙'], false],
    ['1', '没有全部命中', ['甲', '丙'], true],
    ['1', '全部命中', ['甲', '乙'], false],
    ['2', '一个都没命中', ['丙', '丁'], true],
    ['2', '命中了一个', ['甲', '丙'], false]
  ];
  evidence.selectiveLogic = [];
  for (const [logic, label, secondary, expected] of selectiveCases) {
    const result = bodies(await run({
      msgs: [{role: 'user', content: '提到灯塔，还有甲和乙', seq: 1}],
      categories: [book('selective', [entry({
        id: 'selective', keys: ['灯塔'], selective: true, selectiveLogic: Number(logic), secondary_keys: secondary
      })])]
    }));
    assert.strictEqual(result.length === 1, expected, '次级逻辑 ' + logic + '（' + label + '）判定错误：' + JSON.stringify(result));
    evidence.selectiveLogic.push({logic, label, activated: result.length === 1});
  }
  const caseAndWords = await run({
    msgs: [{role: 'user', content: 'The Cat sat in the catalog', seq: 1}],
    categories: [book('case', [
      entry({id: 'case-on', keys: ['cat'], caseSensitive: true}),
      entry({id: 'case-off', keys: ['cat'], caseSensitive: false}),
      entry({id: 'whole-on', keys: ['cat'], caseSensitive: false, matchWholeWords: true}),
      entry({id: 'whole-off', keys: ['catalo'], caseSensitive: false, matchWholeWords: true})
    ])]
  });
  const caseNames = bodies(caseAndWords);
  assert.ok(caseNames.includes('内容-case-on'), '区分大小写时 cat 必须命中小写 catalog 中的 cat');
  assert.ok(caseNames.includes('内容-case-off'), '不区分大小写时必须命中');
  assert.ok(caseNames.includes('内容-whole-on'), '整词匹配必须命中独立单词 Cat');
  assert.ok(!caseNames.includes('内容-whole-off'), '整词匹配不得命中单词片段：' + JSON.stringify(caseNames));
  evidence.caseAndWholeWords = caseNames;

  // ---- 4.4 the vector activation path ------------------------------------------------
  const vectorPath = await page.evaluate(([spec]) => {
    window.__worldInfoAlignment.setup(spec);
    const session = {id: 'alignment-vector', msgs: spec.msgs};
    const scan = spec.msgs.map((row) => ({text: String(row.content || '')}));
    const options = {generationType: 'new', maxContext: 8192, globalScanData: {}};
    const entries = getAllWBEntries(D.currentCharId);
    const hitKey = wbEntryRuntimeKey(entries.find((row) => row.id === 'vector-entry'));
    const without = resolveWorldBook(scan, D.currentCharId, session, options);
    const withHit = resolveWorldBook(scan, D.currentCharId, session,
      Object.assign({}, options, {vectorHitKeys: new Set([hitKey])}));
    const keywordToo = resolveWorldBook([{text: '提到向量关键词'}], D.currentCharId,
      {id: 'alignment-vector-2', msgs: [{role: 'user', content: '提到向量关键词'}]}, options);
    return {
      without: without.afterCharItems.map((item) => item.content),
      withHit: withHit.afterCharItems.map((item) => item.content),
      keywordToo: keywordToo.afterCharItems.map((item) => item.content),
      statuses: (withHit.details || []).map((row) => row.name + ':' + row.status)
    };
  }, [{
    msgs: [{role: 'user', content: '完全无关的一句话', seq: 1}],
    categories: [book('vector', [
      entry({id: 'vector-entry', keys: ['向量关键词'], vectorized: true, content: '向量条目内容'})
    ])]
  }]);
  assert.deepStrictEqual(vectorPath.without, [], '没有向量命中时向量条目不得进入 Prompt');
  assert.deepStrictEqual(vectorPath.withHit, ['向量条目内容'], '向量命中必须是独立的激活路径');
  assert.deepStrictEqual(vectorPath.keywordToo, ['向量条目内容'], '向量条目仍可被普通关键词命中');
  assert.ok(vectorPath.statuses.includes('vector-entry:vector-hit'), '向量激活必须可归因：' + JSON.stringify(vectorPath.statuses));
  evidence.vectorPath = vectorPath;

  // ---- 4.4 every generation re-evaluates the world book (ST native, no freeze) ---------
  const regenerateReroll = await page.evaluate(([spec]) => {
    window.__worldInfoAlignment.setup(spec);
    const session = getActiveSession(D.currentCharId);
    session.msgs = [{role: 'user', content: '提到灯塔', seq: 1, time: Date.now()}];
    const originalRandom = window.worldBookRoundRandom;
    let roll = 0;
    window.worldBookRoundRandom = () => () => roll;
    try {
      const pick = (built) => {
        const joined = built.messages.map((row) => String(row.content || '')).join('\n');
        return ['内容-reroll-a', '内容-reroll-b'].filter((value) => joined.includes(value));
      };
      const first = pick(buildMessages(getChar(), session.msgs, session, {commit: true, generationTarget: {mode: 'new'}}));
      roll = 0.999;
      const regenerated = pick(buildMessages(getChar(), session.msgs, session, {commit: true, generationTarget: {mode: 'regenerate'}}));
      const snapshotWritten = Object.prototype.hasOwnProperty.call(session.msgs[0], 'worldBookSnapshot');
      return {first, regenerated, snapshotWritten};
    } finally {
      window.worldBookRoundRandom = originalRandom;
    }
  }, [{categories: [book('regenerate-reroll', [
    entry({id: 'reroll-a', keys: ['灯塔'], group: '重投组', groupWeight: 100}),
    entry({id: 'reroll-b', keys: ['灯塔'], group: '重投组', groupWeight: 100})
  ])]}]);
  assert.deepStrictEqual(regenerateReroll.first, ['内容-reroll-a']);
  assert.deepStrictEqual(regenerateReroll.regenerated, ['内容-reroll-b'], '重生成必须重新评估概率和分组，不得复用旧结果：' + JSON.stringify(regenerateReroll));
  assert.strictEqual(regenerateReroll.snapshotWritten, false, '构建不得在消息上写世界书快照');
  evidence.regenerateReroll = regenerateReroll;

  // ---- 4.4 a sticky entry keeps its group ---------------------------------------------
  const stickyGroup = await page.evaluate(([spec]) => {
    window.__worldInfoAlignment.setup(spec);
    const session = {id: 'alignment-sticky-group', msgs: []};
    const options = {commitRuntime: true, generationType: 'new', maxContext: 8192, globalScanData: {}, randomSource: () => 0.01};
    session.msgs.push({role: 'user', content: '提到灯塔', seq: 1});
    const first = resolveWorldBook(session.msgs.map((row) => ({text: row.content})), D.currentCharId, session, options);
    session.msgs.push({role: 'assistant', content: '提到灯塔和港口', seq: 2});
    const second = resolveWorldBook(session.msgs.map((row) => ({text: row.content})), D.currentCharId, session, options);
    return {
      first: first.afterCharItems.map((item) => item.content),
      second: second.afterCharItems.map((item) => item.content),
      statuses: (second.details || []).map((row) => row.name + ':' + row.status)
    };
  }, [{
    categories: [book('sticky-group', [
      entry({id: 'sticky-member', keys: ['灯塔'], group: '值班组', groupWeight: 1, sticky: 3}),
      entry({id: 'other-member', keys: ['港口'], group: '值班组', groupWeight: 1000})
    ])]
  }]);
  assert.deepStrictEqual(stickyGroup.first, ['内容-sticky-member']);
  assert.deepStrictEqual(stickyGroup.second, ['内容-sticky-member'], '有效 sticky 必须直接成为同组赢家：' + JSON.stringify(stickyGroup));
  evidence.stickyGroupWinner = stickyGroup;

  // ---- 4.5 named outlets are consumed by the user's own prompt ------------------------
  const outletPrompt = await page.evaluate(() => {
    const protectedBefore = JSON.stringify([DEFAULT_PRE_REPLY_PROMPT, DEFAULT_AUTHORS_NOTE, DEFAULT_MEMORY_INJECT_PROMPT]);
    const char = {
      id: 'alignment-outlet', name: '出口角色', description: '', personality: '', scenario: '',
      first_mes: '', mes_example: '', post_history_instructions: '', extensions: {}, regexScripts: [],
      system_prompt: '参考资料：{{outlet::Lore}}｜未引用：{{outlet::Missing}}'
    };
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {};
    D.worldBook = {
      categories: [{
        id: 'outlet-book', name: 'outlet', settings: null, boundCharIds: null,
        entries: [
          normalizeWBEntry({id: 'o1', keys: ['灯塔'], content: '出口内容甲', position: 'outlet', outletName: 'Lore', order: 300}),
          normalizeWBEntry({id: 'o2', keys: ['灯塔'], content: '出口内容乙', position: 'outlet', outletName: 'Lore', order: 100}),
          normalizeWBEntry({id: 'o3', keys: ['灯塔'], content: '没人引用的出口', position: 'outlet', outletName: 'Unused'})
        ]
      }],
      globalCategoryIds: ['outlet-book'], activeCategoryId: '',
      scan_depth: 20, token_budget: 0, recursive: false
    };
    const session = getActiveSession(char.id);
    const literalHistory = '我们去灯塔，原文保留 {{outlet::Lore}}';
    session.msgs = [{seq: 1, role: 'user', content: literalHistory, time: Date.now()}];
    D.settings.chatCompletionPresetInUse = null;
    const built = buildMessages(char, session.msgs, session, {commit: false});
    const text = built.messages.map((row) => String(row.content || '')).join('\n');
    const host = built.messages.find((row) => String(row.content || '').includes('参考资料：'));
    const defaultHistory = built.messages.find((row) => row.role === 'user' && String(row.content || '').includes('我们去灯塔'));
    D.settings.chatCompletionPresetInUse = presetRawDefault();
    const presetBuilt = buildMessages(char, session.msgs, session, {commit: false});
    const presetHistory = presetBuilt.messages.find((row) => row.role === 'user' && String(row.content || '').includes('我们去灯塔'));
    D.settings.chatCompletionPresetInUse = null;
    return {
      hostContent: String(host && host.content || ''),
      unusedInPrompt: text.includes('没人引用的出口'),
      outletOccurrences: (text.match(/出口内容甲/g) || []).length,
      missingLeftEmpty: !/\{\{outlet::/.test(String(host && host.content || '')),
      literalHistory,
      defaultHistory: String(defaultHistory && defaultHistory.content || ''),
      presetHistory: String(presetHistory && presetHistory.content || ''),
      protectedUnchanged: protectedBefore === JSON.stringify([DEFAULT_PRE_REPLY_PROMPT, DEFAULT_AUTHORS_NOTE, DEFAULT_MEMORY_INJECT_PROMPT])
    };
  });
  assert.match(outletPrompt.hostContent, /参考资料：出口内容甲\n出口内容乙/, '同名出口必须按官方顺序汇总到引用位置：' + outletPrompt.hostContent);
  assert.strictEqual(outletPrompt.outletOccurrences, 1, '出口内容只能出现一次');
  assert.strictEqual(outletPrompt.unusedInPrompt, false, '没有被引用的出口不得被塞进其它位置');
  assert.strictEqual(outletPrompt.missingLeftEmpty, true, '名称不匹配的出口标记必须被清掉，不得原样发给模型');
  assert.strictEqual(outletPrompt.defaultHistory, outletPrompt.literalHistory, '默认链不得展开用户聊天正文里的 outlet 字面量');
  assert.strictEqual(outletPrompt.presetHistory, outletPrompt.literalHistory, '外部预设重组后也不得展开用户聊天正文里的 outlet 字面量');
  assert.strictEqual(outletPrompt.protectedUnchanged, true, '命名出口不得改动受保护默认 Prompt');
  evidence.namedOutlets = outletPrompt;

  console.log(JSON.stringify({stage: 'world-info-alignment', evidence}, null, 1));

  await browser.close();
  server.close();
  assert.deepStrictEqual(pageErrors, [], '真实页面不得产生脚本错误');
  assert.deepStrictEqual(consoleErrors, [], '真实页面不得产生控制台错误');
})().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
});
