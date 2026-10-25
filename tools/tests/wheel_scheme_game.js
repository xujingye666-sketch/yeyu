"use strict";
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(root, 'tools/fixtures/wheel_scheme.json'));
let browser, server;
async function spinAndConfirm(page) {
  await page.locator('#wheel-game-spin').tap();
  await page.locator('#wheel-scheme-spin-modal.open').waitFor();
  await page.locator('#wheel-scheme-spin-button').tap();
  await page.locator('#wheel-scheme-spin-confirm').waitFor({state: 'visible'});
  await page.locator('#wheel-scheme-spin-confirm').tap();
}
(async () => {
  server = createAssetServer(path.join(root, 'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  await page.evaluate(async () => {
    D = defaults();
    await saveData(['meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheels'], {urgent: true});
  });
  // Load the Prompt Manager first, then come back to chat: the drawer lives in #app, which app pages hide.
  await page.evaluate(() => { openModal('prompt-manager-modal'); switchAppPage('chat'); openSidebarTab('wheels'); });
  await page.locator('#tab-wheels button[onclick="openWheelSchemeManager()"]').click();
  await page.locator('#wheel-assistant-prompt-wheelScheme-biography').fill('取消的编辑');
  assert.strictEqual(await page.evaluate(() => handleNativeBack()), true);
  await page.waitForFunction(() => !document.getElementById('wheel-manager-modal').classList.contains('open'));
  await page.evaluate(() => openWheelSchemeManager());
  assert.notStrictEqual(await page.locator('#wheel-assistant-prompt-wheelScheme-biography').inputValue(), '取消的编辑');
  await page.locator('#wheel-assistant-prompt-wheelScheme-biography').fill('人物志定向验证正文');
  await page.locator('#wheel-scheme-max-tokens').fill('12288');
  await page.locator('#wheel-manager-save').click();
  await page.waitForFunction(() => !document.getElementById('wheel-manager-modal').classList.contains('open'));
  assert.deepStrictEqual(await page.evaluate(async () => {
    const saved = (await YeyuRepository.load()).data;
    return {prompt:saved.settings.assistantPromptOverrides.wheelScheme.biography,limit:saved.settings.wheelSchemeMaxTokens};
  }),{prompt:'人物志定向验证正文',limit:12288},'人物志设置必须实际写入仓储');
  assert.deepStrictEqual(await page.evaluate(async () => {
    // Saving a previously opened Prompt Manager must not overwrite the independently saved biography.
    await savePromptManager();
    return {prompt:assistantPromptText('wheelScheme','biography'),limit:taskMaxTokens('wheelSchemeMaxTokens')};
  }),{prompt:'人物志定向验证正文',limit:12288});
  await page.evaluate(() => openWheelSchemeManager());
  await page.locator('#wheel-assistant-prompts .ui-group-hd button').click();
  await page.locator('#wheel-manager-save').click();
  await page.waitForFunction(() => !document.getElementById('wheel-manager-modal').classList.contains('open'));
  assert.strictEqual(await page.evaluate(() => assistantPromptText('wheelScheme','biography')===DEFAULT_WHEEL_SCHEME_BIOGRAPHY_PROMPT),true);
  await page.evaluate(() => { switchAppPage('chat'); setSidebarOpen(false); });

  await page.evaluate(() => { openSidebarTab('wheels'); setSidebarOpen(true); });
  await page.evaluate(() => {
    window.__wheelPaletteCalls = [];
    Object.assign(D.settings.providers[0], {apiUrl: 'https://wheel.example.test/v1', apiKey: 'synthetic-key', model: 'wheel-test'});
    D.settings.modelPresets = [{id: 'wheel-route', name: '转盘测试路由', routes: {
      wheelScheme: {providerId: D.settings.providers[0].id, model: 'wheel-route-test'},
    }}];
    D.settings.activeModelPresetId = 'wheel-route';
    const originalFetch = window.fetch;
    window.fetch = async (url, options) => {
      if (!String(url).startsWith('https://wheel.example.test/')) return originalFetch(url, options);
      const request = JSON.parse(options.body);
      window.__wheelPaletteCalls.push(request);
      return new Response(JSON.stringify({choices: [{message: {content: '{"colors":["#A75B52","#4A8D7B","#9271AC"]}'}, finish_reason: 'stop'}]}),
        {headers: {'content-type': 'application/json'}});
    };
  });
  await page.locator('#wheel-scheme-file').setInputFiles({name: 'semantic.wheel.json', mimeType: 'application/json', buffer: fixture});
  await page.waitForFunction(() => D.wheelSchemes.length === 1);
  const imported = await page.evaluate(async () => {
    const item = (await YeyuRepository.load()).data.wheelSchemes[0];
    return {paletteColors: item.paletteColors, document: item.document, autoHue: item.autoHue,
      modelInput: window.__wheelPaletteCalls[0].messages[1].content, model: window.__wheelPaletteCalls[0].model,
      calls: window.__wheelPaletteCalls.length};
  });
  assert.deepStrictEqual(imported.paletteColors, ['#A75B52', '#4A8D7B', '#9271AC']);
  assert.deepStrictEqual(imported.document, JSON.parse(fixture.toString('utf8').replace(/^﻿/, '')), '配色不得写进原始方案');
  assert.strictEqual(imported.autoHue, undefined, '新导入方案不分配旧自动色相');
  assert.strictEqual(imported.model, 'wheel-route-test', '配色必须走转盘专用路由，不能落到主聊天模型');
  assert.strictEqual(imported.calls, 1);
  assert.strictEqual(imported.modelInput.includes(imported.document.title), true);
  assert.strictEqual(imported.modelInput.includes(imported.document.wheels[0].id), true);
  assert.strictEqual(imported.modelInput.includes(imported.document.wheels[0].options[0].id), true);
  // Legacy schemes keep their stored colours and receive missing automatic hues only once.
  assert.deepStrictEqual(await page.evaluate(async () => {
    const imported = D.wheelSchemes[0];
    const extra = (id, at) => ({id, importedAt: at, sourceFileName: id + '.wheel.json', document: imported.document, progress: null});
    D.wheelSchemes.unshift(extra('wheel_scheme_legacy_a', 1), extra('wheel_scheme_legacy_b', 2));
    const first = ensureWheelSchemeAutoHues(), hues = D.wheelSchemes.map(item => item.autoHue), second = ensureWheelSchemeAutoHues();
    const colours = () => Object.fromEntries(D.wheelSchemes.map(item => [item.id, wheelSchemeColor(item.id)]));
    const before = colours();
    D.wheelSchemes[1].color = YeyuPure.identityColor(hues[0]);
    const afterPick = colours();
    D.wheelSchemes.shift();
    const afterDelete = colours();
    const gap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
    return {
      backfilledOnce: first && !second && typeof hues[0] === 'number' && typeof hues[1] === 'number' && hues[2] === undefined,
      apart: gap(hues[0], hues[1]) >= 29.9,
      pickKeepsOthers: afterPick.wheel_scheme_legacy_a === before.wheel_scheme_legacy_a && afterPick[imported.id] === before[imported.id],
      deleteKeepsOthers: afterDelete[imported.id] === before[imported.id],
    };
  }), {backfilledOnce: true, apart: true, pickKeepsOthers: true, deleteKeepsOthers: true});
  await page.evaluate(() => {
    D.wheelSchemes = D.wheelSchemes.filter(item => !/^wheel_scheme_legacy_/.test(item.id));
    renderWheelSchemeLibrary();
  });
  const statsSummary = '项目说明：决定如何进入遗迹。\n起点：前进-越过石门\n本轮后变量：力量=4，总值=21\n\n旧项目：旧结果\n本轮后变量：力量=4，总值=21';
  const changesSummary = '项目说明：决定如何进入遗迹。\n起点：前进-越过石门\n本轮变量变化：力量4（+2），总值21（+16）\n\n旧项目：旧结果\n本轮变量变化：无变化';
  assert.deepStrictEqual(await page.evaluate(() => {
    const scheme = normalizedWheelScheme(D.wheelSchemes[0]);
    scheme.prompt_template = '{{summary_with_stats}}\n---\n{{summary_stats}}\n---\n{{summary_with_stat_changes}}\n---\n{{summary_changes}}\n---\n{{records}}';
    const progress = {stats: {力量: 4, 秘密: 5}, history: [
      {wheelId: '起点', optionId: '前进', note: '越过石门', stats: {力量: 4, 秘密: 5}},
      {wheelId: '旧项目', optionId: '旧结果'},
    ]};
    return {filled: YeyuWheelScheme.resolvePrompt(scheme, progress).split('\n---\n'),
      empty: YeyuWheelScheme.resolvePrompt(scheme, {stats: {}, history: []}).split('\n---\n')};
  }), {filled: [statsSummary, statsSummary, changesSummary, changesSummary, '起点：前进 - 越过石门\n旧项目：旧结果'],
    empty: Array(5).fill('（暂无转盘结果）')}, '摘要别名、派生值、隐藏数值、旧记录回退和分隔符保持原模型输入');
  assert.deepStrictEqual(await page.evaluate(() => {
    const original = D.wheelSchemes;
    D.wheelSchemes = [{id: 'picked', importedAt: 0, color: '#A75B52'}, {id: 'late', importedAt: 3},
      {id: 'early', importedAt: 1}, {id: 'stored', autoHue: 180},
      {id: 'multi', paletteColors: ['#A75B52', '#4A8D7B', '#9271AC']},
      {id: 'same-b', importedAt: 2}, {id: 'same-a', importedAt: 2}];
    try {
      ensureWheelSchemeAutoHues();
      return D.wheelSchemes.map(item => [item.id, item.autoHue ?? null]);
    } finally { D.wheelSchemes = original; }
  }), [['picked', 240], ['late', 57.8], ['early', 357.8], ['stored', 180], ['multi', null], ['same-b', 210], ['same-a', 327.8]],
  '旧方案色相保留原序列：导入时间、同时间 ID、已有色相、手选色最后及新方案跳过');
  await page.locator('.wheel-scheme-item').tap();
  await page.evaluate(() => {
    WHEEL_SCHEME_SPIN_MS = 20;
    window.wheelSchemeRandom = () => 0;
    window.__wheelBiographyRequests = [];
    window.__wheelBiographyMode = 'stream';
    const originalFetch = window.fetch;
    window.fetch = async (url, options) => {
      if (!String(url).startsWith('https://wheel.example.test/')) return originalFetch(url, options);
      window.__wheelBiographyRequests.push(JSON.parse(options.body));
      if (window.__wheelBiographyMode === 'error') throw new Error('模拟人物志网络中断。');
      if (['length', 'refusal', 'content_filter'].includes(window.__wheelBiographyMode))
        return new Response(JSON.stringify({choices: [{message: {content: '这是未完成的新稿'}, finish_reason: window.__wheelBiographyMode}]}),
          {headers: {'content-type': 'application/json'}});
      if (window.__wheelBiographyMode === 'late')
        return new Promise(resolve => { window.__wheelLateRelease = () => resolve(new Response(JSON.stringify({choices: [{message: {content: '取消后迟到的人物志'}, finish_reason: 'stop'}]}),
          {headers: {'content-type': 'application/json'}})); });
      if (window.__wheelBiographyMode === 'replacement')
        return new Response(JSON.stringify({choices: [{message: {content: '《石门之后·新稿》\n\n这是一份成功替换的第二版人物志。'}, finish_reason: 'stop'}]}),
          {headers: {'content-type': 'application/json'}});
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({start(controller) {
        let content = '', reasoning = '';
        const send = value => controller.enqueue(encoder.encode('data: ' + JSON.stringify(value) + '\n\n'));
        window.__wheelBiographyProgress = state => {
          send({choices: [{delta: {content: state.content.slice(content.length), reasoning_content: state.reasoning.slice(reasoning.length)}}]});
          content = state.content;
          reasoning = state.reasoning;
        };
        window.__wheelBiographyRelease = () => {
          send({choices: [{delta: {content: '完整人物志'.slice(content.length)}, finish_reason: 'stop'}]});
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        };
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Cancelled', 'AbortError')), {once: true});
        window.__wheelBiographyProgress({content: '', reasoning: '思考第 1 行'});
      }}), {headers: {'content-type': 'text/event-stream'}});
    };
  });
  await page.locator('.wheel-scheme-start').click();
  await page.locator('#wheel-game-view.open').waitFor();
  await spinAndConfirm(page);
  await page.waitForFunction(() => D.wheelSchemes[0].progress.turns.length === 1 && !_wheelSchemeBusy);
  const firstTurn = await page.evaluate(() => D.wheelSchemes[0].progress.turns[0].records.map(row => [row.wheelId, row.optionId, row.mode]));
  assert.deepStrictEqual(firstTurn, [['起点', '前进', 'normal'], ['暗抽', '机关开启', 'counter']]);
  assert.deepStrictEqual(await page.evaluate(() => {
    const item = D.wheelSchemes[0], scheme = normalizedWheelScheme(item), progress = item.progress;
    const oldSave = {...progress, turns: [{records: [{label: '无快照'}]}, progress.turns[0]]};
    return {
      // The first turn counts from the initial values; the hidden 秘密 set by the automatic wheel reaches the derived 总值.
      firstTurn: Object.fromEntries(wheelSchemeLatestTurnChanges(scheme, progress)),
      withoutSnapshot: wheelSchemeLatestTurnChanges(scheme, oldSave).size,
      legacyRecord: wheelSchemeRecordHtml({wheelName: '起点', label: '前进', changedStatsText: '力量+1'}).includes('力量+1'),
    };
  }), {
    firstTurn: {力量: 2, 总值: 16},
    withoutSnapshot: 0,
    legacyRecord: true,
  });
  // A feed too short to scroll has nowhere to go, so no gesture on it lets go of the bottom.
  assert.deepStrictEqual(await page.evaluate(() => {
    const feed = document.getElementById('wheel-game-feed');
    feed.dispatchEvent(new WheelEvent('wheel', {deltaY: -120}));
    feed.dispatchEvent(new Event('touchmove'));
    feed.dispatchEvent(new Event('touchend'));
    feed.dispatchEvent(new KeyboardEvent('keydown', {key: 'PageUp'}));
    return {short: feed.scrollHeight <= feed.clientHeight + 1, following: _wheelSchemeFeedView.following};
  }), {short: true, following: true}, '不可滚动的记录流不得因滚轮、拖动或按键脱离跟随');
  await spinAndConfirm(page);
  await page.waitForFunction(() => typeof window.__wheelBiographyRelease === 'function');
  // Reasoning is the chat's card: collapsed and timing while the model thinks, and the only status line is the stage's.
  const card = page.locator('#wheel-game-biography-live-reasoning details.think-block');
  await card.waitFor();
  assert.deepStrictEqual(await page.evaluate(() => {
    const block = document.querySelector('#wheel-game-biography-live-reasoning details.think-block');
    return {open: block.open, thinking: block.dataset.thinking, timer: !!block.querySelector('.think-timer'),
      status: Array.from(document.querySelectorAll('#wheel-game-biography-live-status')).map(node => node.closest('#wheel-game-stage') ? 'stage' : 'feed')};
  }), {open: false, thinking: 'true', timer: true, status: ['stage']});
  // The reader can press the title while a new reasoning line arrives, then release to open it.
  const summary = card.locator('summary');
  await page.evaluate(() => {
    window.__wheelSummary = document.querySelector('#wheel-game-biography-live-reasoning summary');
    window.__wheelTimerBefore = window.__wheelSummary.querySelector('.think-timer').textContent;
  });
  const titleBox = await summary.boundingBox();
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.evaluate(async () => {
    window.__wheelBiographyProgress({content: '', reasoning: '思考第 1 行\n思考第 2 行'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => document.querySelector('#wheel-game-biography-live-reasoning .think-timer').textContent !== window.__wheelTimerBefore);
  await page.mouse.up();
  const titleInteraction = await page.evaluate(() => ({
    same: document.querySelector('#wheel-game-biography-live-reasoning summary') === window.__wheelSummary,
    clicked: document.querySelector('#wheel-game-biography-live-reasoning details').open,
  }));
  if (titleInteraction.clicked) await summary.click();
  await page.evaluate(() => {
    window.__wheelCard = document.querySelector('#wheel-game-biography-live-reasoning details.think-block');
    window.__wheelCardText = window.__wheelCard.querySelector('.think-body').firstChild;
    const feed = document.getElementById('wheel-game-feed');
    // A tap is not a scroll: touching the feed and opening the card keep following the growing text.
    ['touchstart', 'pointerdown', 'mousedown', 'touchend', 'pointerup'].forEach(name => feed.dispatchEvent(new Event(name)));
  });
  await card.locator('summary').click();
  // The card is reconciled in place, the reader's choice survives repaints, and the feed keeps following.
  assert.deepStrictEqual(await page.evaluate(async () => {
    const feed = document.getElementById('wheel-game-feed'), frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__wheelBiographyProgress({content: '', reasoning: Array.from({length: 120}, (_, index) => '思考第 ' + (index + 1) + ' 行').join('\n')});
    await frame();
    const block = document.querySelector('#wheel-game-biography-live-reasoning details.think-block');
    return {same: block === window.__wheelCard && block.querySelector('.think-body').firstChild === window.__wheelCardText, open: block.open, following: _wheelSchemeFeedView.following,
      atBottom: feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 1, scrollable: feed.scrollHeight > feed.clientHeight + 200};
  }), {same: true, open: true, following: true, atBottom: true, scrollable: true}, '思考流式更新须原地更新同一张卡片，轻点与展开卡片不得脱离跟随');
  // A real finger tap on the feed once it can scroll is still not a scroll: the growing text stays followed.
  const feedBox = await page.locator('#wheel-game-feed').boundingBox();
  await page.touchscreen.tap(feedBox.x + feedBox.width / 2, feedBox.y + feedBox.height - 24);
  assert.deepStrictEqual(await page.evaluate(async () => {
    const feed = document.getElementById('wheel-game-feed');
    window.__wheelBiographyProgress({content: '', reasoning: Array.from({length: 121}, (_, index) => '思考第 ' + (index + 1) + ' 行').join('\n')});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {following: _wheelSchemeFeedView.following, atBottom: feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 1};
  }), {following: true, atBottom: true}, '真实轻点可滚动的记录流不得脱离跟随');
  // Real touch input must leave an already released reader in the middle, in either direction or sideways.
  const cdp = await page.context().newCDPSession(page);
  const touchDrag = async (dx, dy) => {
    const box = await page.locator('#wheel-game-feed').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx * step / 6, y: y + dy * step / 6}]});
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.waitForTimeout(120);
  };
  const releasedGestures = {};
  let reasoningLines = 121;
  for (const [name, dx, dy] of [['down', 0, -90], ['up', 0, 90], ['sideways', 90, 0]]) {
    await page.evaluate(async () => {
      const feed = document.getElementById('wheel-game-feed');
      feed.scrollTop = 600;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      _wheelSchemeFeedView.following = false;
    });
    await touchDrag(dx, dy);
    const geometry = await page.evaluate(() => {
      const feed = document.getElementById('wheel-game-feed');
      return {top: feed.scrollTop, distance: feed.scrollHeight - feed.scrollTop - feed.clientHeight};
    });
    releasedGestures[name] = await page.evaluate(async ({name, geometry, lines}) => {
      const feed = document.getElementById('wheel-game-feed');
      window.__wheelBiographyProgress({content: '', reasoning: Array.from({length: lines}, (_, index) => '思考第 ' + (index + 1) + ' 行').join('\n')});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {following: _wheelSchemeFeedView.following, middle: geometry.distance > 200,
        moved: Math.sign(Math.round(geometry.top - 600)), sufficientMove: name === 'sideways' || Math.abs(geometry.top - 600) >= 60,
        held: Math.abs(feed.scrollTop - geometry.top) <= 1};
    }, {name, geometry, lines: ++reasoningLines});
    console.log('wheel released touch geometry', name, geometry);
  }
  console.log('wheel stream interaction probe', {titleInteraction, releasedGestures});
  assert.deepStrictEqual({titleInteraction, releasedGestures}, {
    titleInteraction: {same: true, clicked: true},
    releasedGestures: {
      down: {following: false, middle: true, moved: 1, sufficientMove: true, held: true},
      up: {following: false, middle: true, moved: -1, sufficientMove: true, held: true},
      sideways: {following: false, middle: true, moved: 0, sufficientMove: true, held: true},
    },
  }, '追加思考不能替换标题或丢点击，已脱离的中段触摸阅读只能回到底部后恢复跟随');
  await page.evaluate(() => followWheelSchemeFeed());
  // Only scrolling away from the bottom lets go: a drag, the wheel or a key heading up; heading down never does.
  assert.deepStrictEqual(await page.evaluate(async () => {
    const feed = document.getElementById('wheel-game-feed'), view = _wheelSchemeFeedView, frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settle = async () => { await frame(); const following = view.following; followWheelSchemeFeed(); await frame(); return following; };
    const result = {};
    feed.dispatchEvent(new WheelEvent('wheel', {deltaY: 120}));
    feed.dispatchEvent(new KeyboardEvent('keydown', {key: 'End'}));
    result.down = await settle();
    feed.dispatchEvent(new Event('touchmove'));
    result.drag = view.following;
    // Text keeps arriving under a finger pulling past the end.
    window.__wheelBiographyProgress({content: '', reasoning: Array.from({length: 130}, (_, index) => '思考第 ' + (index + 1) + ' 行').join('\n')});
    await frame();
    feed.dispatchEvent(new Event('touchend'));
    result.dragPastEnd = await settle();
    feed.dispatchEvent(new Event('touchmove'));
    feed.scrollTop -= 300;
    feed.dispatchEvent(new Event('touchend'));
    result.dragUp = await settle();
    feed.dispatchEvent(new WheelEvent('wheel', {deltaY: -120}));
    result.wheelUp = await settle();
    feed.focus();
    feed.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    result.keyUp = await settle();
    feed.blur();
    return result;
  }), {down: true, drag: false, dragPastEnd: true, dragUp: false, wheelUp: false, keyUp: false}, '只有向上滚动的手势才脱离跟随');
  // A released feed is not pulled back to its bottom by repaints.
  await page.evaluate(async () => {
    const feed = document.getElementById('wheel-game-feed'), frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    feed.dispatchEvent(new WheelEvent('wheel', {deltaY: -120}));
    feed.scrollTop = 0;
    await frame();
    window.__wheelBiographyProgress({content: '', reasoning: Array.from({length: 160}, (_, index) => '思考第 ' + (index + 1) + ' 行').join('\n')});
    await frame();
  });
  assert.deepStrictEqual(await page.evaluate(() => {
    const feed = document.getElementById('wheel-game-feed');
    return {open: document.querySelector('#wheel-game-biography-live-reasoning details.think-block').open, top: feed.scrollTop, scrollable: feed.scrollHeight > feed.clientHeight + 200};
  }), {open: true, top: 0, scrollable: true}, '重绘不得收起读者展开的思考，也不得把脱离跟随的视角拉回底部');
  // The latest preview changes to the opening line when body text starts; releasing a pressed title
  // must still complete the click, and none of these updates may replace the summary.
  await summary.scrollIntoViewIfNeeded();
  const bodyTitleBox = await summary.boundingBox();
  await page.mouse.move(bodyTitleBox.x + bodyTitleBox.width / 2, bodyTitleBox.y + bodyTitleBox.height / 2);
  await page.mouse.down();
  await page.evaluate(async () => {
    window.__wheelBiographyProgress({content: '完整', reasoning: Array.from({length: 160}, (_, index) => '思考第 ' + (index + 1) + ' 行').join('\n')});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.mouse.up();
  assert.deepStrictEqual(await page.evaluate(() => {
    const block = document.querySelector('#wheel-game-biography-live-reasoning details.think-block');
    return {sameSummary: block.querySelector('summary') === window.__wheelSummary, sameCard: block === window.__wheelCard,
      open: block.open, title: block.querySelector('.think-title').textContent.startsWith('已思考'), timer: !!block.querySelector('.think-timer')};
  }), {sameSummary: true, sameCard: true, open: false, title: true, timer: false}, '转入正文须保留标题身份，按下更新后抬起能收起思考卡片');
  await summary.click();
  assert.deepStrictEqual(await page.evaluate(async () => {
    const feed = document.getElementById('wheel-game-feed'), frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    feed.dispatchEvent(new WheelEvent('wheel', {deltaY: -120}));
    feed.scrollTop = feed.scrollHeight - feed.clientHeight - 20;
    await frame();
    const nearBottomReleased = !_wheelSchemeFeedView.following;
    feed.scrollTop = feed.scrollHeight;
    await frame();
    window.__wheelBiographyProgress({content: '完整', reasoning: Array.from({length: 160}, (_, index) => '思考第 ' + (index + 1) + ' 行').join('\n')});
    await frame();
    const block = document.querySelector('#wheel-game-biography-live-reasoning details.think-block');
    return {open: block.open, title: block.querySelector('.think-title').textContent.startsWith('已思考'), timer: !!block.querySelector('.think-timer'),
      nearBottomReleased, atBottom: feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 1};
  }), {open: true, title: true, timer: false, nearBottomReleased: true, atBottom: true}, '正文到达后计时定格，真正滑回底部后才重新跟随');
  assert.strictEqual(await page.evaluate(() => D.wheelSchemes[0].progress.biography), '', '草稿不得覆盖已保存正文');
  await page.evaluate(() => window.__wheelBiographyRelease());
  await page.waitForFunction(() => !!D.wheelSchemes[0].progress.biography);
  const finale = await page.evaluate(() => ({biography: D.wheelSchemes[0].progress.biography, turns: D.wheelSchemes[0].progress.turns.length}));
  assert.deepStrictEqual(finale, {biography: '完整人物志', turns: 2});
  const firstBiography = finale.biography;
  assert.deepStrictEqual(await page.evaluate(() => {
    const request = window.__wheelBiographyRequests[0];
    return {model: request.model, stream: request.stream, maxTokens: request.max_tokens,
      system: request.messages[0].content.includes(assistantPromptText('wheelScheme', 'biography')),
      stats: request.messages[1].content.includes('本轮后变量：力量=4，总值=21'),
      changes: request.messages[1].content.includes('本轮变量变化：力量4（+2），总值17（+12）'),
      final: request.messages[1].content.endsWith('[最终可见数值]\n力量=4，总值=21')};
  }), {model: 'wheel-route-test', stream: true, maxTokens: 12288, system: true, stats: true, changes: true, final: true},
  '人物志必须实际经过供应商请求链，保留定向提示词、数值摘要、输出上限与流式请求');
  await page.evaluate(() => {
    window.__wheelBiographyMode = 'error';
  });
  await page.locator('#wheel-game-regenerate-biography').click();
  await page.waitForFunction(() => !_wheelSchemeBusy && D.wheelSchemes[0].progress.pendingBiography === true);
  assert.strictEqual(await page.evaluate(() => D.wheelSchemes[0].progress.biography), firstBiography, '重新生成失败必须保留原人物志');
  for (const reason of ['length', 'refusal', 'content_filter']) {
    await page.evaluate(value => { window.__wheelBiographyMode = value; }, reason);
    await page.locator('#wheel-game-regenerate-biography').click();
    await page.waitForFunction(() => !_wheelSchemeBusy);
    assert.deepStrictEqual(await page.evaluate(async () => {
      const memory = D.wheelSchemes[0].progress, saved = (await YeyuRepository.load()).data.wheelSchemes[0].progress;
      return {memory: memory.biography, saved: saved.biography, pending: memory.pendingBiography,
        savedPending: saved.pendingBiography, error: !!memory.biographyError};
    }), {memory: firstBiography, saved: firstBiography, pending: true, savedPending: true, error: true},
    reason + ' 未完成新稿不得替换已保存成品或被标为完成');
  }
  await page.evaluate(() => {
    window.__wheelBiographyMode = 'replacement';
  });
  await page.locator('#wheel-game-regenerate-biography').click();
  await page.waitForFunction(() => !_wheelSchemeBusy && D.wheelSchemes[0].progress.biography.includes('第二版人物志'));
  assert.strictEqual(await page.evaluate(() => D.wheelSchemes[0].progress.pendingBiography), false);
  assert((await page.locator('.wheel-game-biography').textContent()).includes('第二版人物志'), '重新生成成功后才替换旧稿');

  await page.evaluate(() => { window.__wheelBiographyMode = 'late'; });
  await page.locator('#wheel-game-regenerate-biography').tap();
  await page.waitForFunction(() => typeof window.__wheelLateRelease === 'function');
  await page.locator('#wheel-game-view .wheel-game-back').tap();
  await page.evaluate(() => window.__wheelLateRelease());
  await page.waitForFunction(() => !_wheelSchemeBusy);
  assert.deepStrictEqual(await page.evaluate(async () => {
    const item = (await YeyuRepository.load()).data.wheelSchemes[0];
    return {saved: item.progress.biography.includes('第二版人物志'),
      memory: D.wheelSchemes[0].progress.biography.includes('第二版人物志'),
      lateVisible: document.getElementById('wheel-game-feed').textContent.includes('取消后迟到的人物志')};
  }), {saved: true, memory: true, lateVisible: false}, '关闭取消后迟到的网络结果不得覆盖原稿或显示');

  await page.evaluate(async () => {
    await saveData('wheels', {urgent: true});
    await flushPendingSave();
  });
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});
  assert((await page.evaluate(() => D.wheelSchemes[0].progress.biography)).includes('第二版人物志'), '刷新后必须恢复重新生成成功后的唯一人物志');

  const beforeInvalid = await page.evaluate(() => JSON.stringify(D.wheelSchemes));
  await page.evaluate(() => openSidebarTab('wheels'));
  await page.locator('#wheel-scheme-file').setInputFiles({name: 'invalid.wheel.json', mimeType: 'application/json', buffer: Buffer.from('{"type":"wrong"}')});
  await page.waitForFunction(() => document.getElementById('wheel-scheme-import-status').textContent.includes('导入失败'));
  assert.strictEqual(await page.evaluate(() => JSON.stringify(D.wheelSchemes)), beforeInvalid, '无效方案不得改写既有方案或进度');

  console.log('wheel import, settings, progress, biography replacement, and reload preserve data');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
