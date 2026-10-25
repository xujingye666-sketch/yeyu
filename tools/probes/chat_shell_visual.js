'use strict';

// Optional image is read only; the probe never stores character data in the repository.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('../tests/source');
const { visualDevice, installNativeSafeArea } = require('../qa/visual_device');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const device = visualDevice();
const label = process.argv[3] || 'generated';
const output = path.join(root, '.tmp/chat-shell-rework', device.id, label);
const picture =
  process.argv[2] && process.argv[2] !== '-'
    ? 'data:image/png;base64,' + fs.readFileSync(process.argv[2]).toString('base64')
    : '';
const personaPicture = process.argv[4]
  ? 'data:image/png;base64,' + fs.readFileSync(process.argv[4]).toString('base64')
  : picture;
const metrics = [];
let browser, server;

async function capture(page, name) {
  await page.waitForTimeout(650);
  const state = await page.evaluate(() => {
    const selectors = [
      '.ch-name',
      '#chat-session-switch',
      '#chat-tools-toggle',
      '#chat-tools-panel .chat-menu-item',
      '#session-current',
      '.msg-bubble',
      '.msg-actions .btn',
      '.chat-input-inner',
      '#user-input',
      '#composer-action-btn',
      '.composer-pair-toolbar button',
      '#bottom-nav button',
      '#mobile-menu',
      '.sidebar-tabs button',
      '.char-item',
      '.char-info .cname',
      '.char-tools summary',
      '.session-manager-main',
      '.msg-avatar',
      '.msg.user .msg-avatar',
    ];
    const elements = selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, visible: false };
      const box = el.getBoundingClientRect(),
        css = getComputedStyle(el);
      const canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d');
      ctx.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      const ink = ctx.measureText('国');
      return {
        selector,
        visible: box.width > 0 && box.height > 0 && css.visibility !== 'hidden',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        fontSize: css.fontSize,
        lineHeight: css.lineHeight,
        fontWeight: css.fontWeight,
        glyphHeight: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent,
        background: css.background,
        color: css.color,
      };
    });
    const header = document.getElementById('chat-header').getBoundingClientRect();
    const composer = document.getElementById('chat-input-wrap').getBoundingClientRect();
    const nav = document.getElementById('bottom-nav').getBoundingClientRect();
    const root = getComputedStyle(document.documentElement),
      px = (name) => parseFloat(root.getPropertyValue(name)) || 0;
    return {
      elements,
      fixedHeight: header.height + composer.height + nav.height,
      // The resting header, composer and navigation may not grow past their declared size tokens.
      restingBudget:
        px('--mobile-header-h') +
        px('--mobile-input-h') +
        px('--mobile-bottom-nav-h') +
        px('--native-safe-top') +
        px('--native-safe-bottom'),
      theme: document.documentElement.dataset.theme,
      accent: document.documentElement.style.getPropertyValue('--accent-rgb'),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    };
  });
  assert.strictEqual(state.horizontalOverflow, false, name + ' horizontal overflow');
  metrics.push({ name, ...state });
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: false });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({
    executablePath: resolveEdgeExecutable(),
    headless: true,
  });
  const page = await browser.newPage(device.browserContext);
  await installNativeSafeArea(page, device);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof D === 'object' && document.body.classList.contains('has-bottom-nav'));
  await page.waitForFunction(() => document.querySelector('#toasts .toast'));
  await page.waitForFunction(() => !document.querySelector('#toasts .toast'));
  await page.evaluate(() => {
    document.getElementById('sidebar').classList.add('hidden');
    D.settings.themeMode = 'dark';
    updateChatUI();
  });
  await capture(page, '01-empty-dark');
  await page.evaluate(() => applyTheme('light'));
  await capture(page, '02-empty-light');
  await page.evaluate(
    async ({ image, label, personaPicture }) => {
      if (!image) {
        const canvas = document.createElement('canvas');
        canvas.width = 411;
        canvas.height = 905;
        const ctx = canvas.getContext('2d'),
          grad = ctx.createLinearGradient(0, 0, 411, 905);
        const colors =
          label === 'muted'
            ? ['#b2b1ae', '#929694', '#676d6b', '#4c5354']
            : ['#18c8d0', '#712ccb', '#dd2578', '#feab48'];
        colors.forEach((color, index) => grad.addColorStop(index / (colors.length - 1), color));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 411, 905);
        image = canvas.toDataURL();
      }
      const char = {
        id: 'visual-character',
        name: '林间来信',
        description: '山径、晚风，以及尚未说完的故事。',
        first_mes: '',
        avatar_image: image,
        background_image: image,
        extensions: {},
        tags: ['日常', '探索'],
      };
      const names = [
        '林间来信',
        '雨后书店',
        '海边的灯塔',
        '旧日车站 · 一段很长的角色名称用于检查省略',
        '远行手记',
        '未寄出的信',
      ];
      D.characters = names.map((name, index) => ({
        ...char,
        id: index ? 'visual-' + index : char.id,
        name,
        favorite: index === 0,
      }));
      D.currentCharId = char.id;
      D.personas = [{ id: 'visual-persona', name: '远行者', avatar_image: personaPicture || image, boundCharIds: [] }];
      D.activePersonaId = 'visual-persona';
      const session = createBlankSession('沿着山径走一走', 'visual-session');
      session.greetingChosen = true;
      session.msgs = [
        {
          role: 'assistant',
          seq: 1,
          content:
            '雨停了，枝叶上的水滴仍在慢慢落下。\n\n“沿着这条路走，就能看见山谷里的灯。”她停下脚步，回头等你。\n\n远处传来钟声，风里带着湿润的草木气息。',
          time: Date.now() - 120000,
        },
        {
          role: 'user',
          seq: 2,
          content: '我们走慢一点吧。想听你说说，那座灯塔的故事。',
          time: Date.now() - 60000,
        },
        {
          role: 'assistant',
          seq: 3,
          content:
            '“好呀。”\n\n她把步子放慢，与你并肩。**灯塔已经亮了很多年**，每当有人晚归，就会循着那束光找到回家的路。\n\n（她望向山谷，声音轻了些。）\n\n【旅途笔记】\n今晚的目的地，是灯塔下的小镇。',
          time: Date.now(),
          swipes: [
            '“好呀。”\n\n她把步子放慢，与你并肩。**灯塔已经亮了很多年**，每当有人晚归，就会循着那束光找到回家的路。\n\n（她望向山谷，声音轻了些。）\n\n【旅途笔记】\n今晚的目的地，是灯塔下的小镇。',
            '她点了点头：“那就慢慢走吧。”',
          ],
          swipeId: 0,
        },
      ];
      session.nextMessageSeq = 4;
      const second = createBlankSession('回到灯塔之前', 'visual-second');
      second.greetingChosen = true;
      const branch = createBlankSession('沿着山径 · 支线', 'visual-branch');
      branch.parentSessionId = session.id;
      branch.greetingChosen = true;
      D.chats = { [char.id]: { activeSid: session.id, sessions: [session, second, branch] } };
      D.settings.themeMode = 'dark';
      D.settings.messageStyle = 'bubble';
      applyMessageStyle();
      renderCharList();
      renderChat();
      updateChatUI();
      await applyCharBackground(char, false);
      document.getElementById('chat-messages').scrollTop = 0;
    },
    { image: picture, label, personaPicture }
  );
  await capture(page, '03-chat-dark');
  assert(
    metrics.at(-1).fixedHeight <= metrics.at(-1).restingBudget,
    'resting chrome must fit the header, composer and navigation tokens'
  );
  await page.evaluate(() => {
    toggleMessageActions(2);
    document.getElementById('chat-messages').scrollTop = 99999;
  });
  await capture(page, '04-message-actions');
  await page.locator('[data-msg-idx="2"] .msg-more-toggle').click();
  await capture(page, '05-message-menu');
  await page.evaluate(() => {
    closeMessageMore();
    showChatNavigation();
  });
  await capture(page, '06-navigation');
  await page.evaluate(() => toggleAnchorPanel());
  await capture(page, '07-anchor-list');
  await page.evaluate(() => {
    document.getElementById('chat-anchor-panel').classList.remove('open');
    toggleSidebar();
  });
  await capture(page, '08-characters');
  await page.locator('.char-tools>summary').first().click();
  await capture(page, '09-character-actions');
  const characterActions = await page.locator('.char-tools[open] .char-actions .btn').evaluateAll((buttons) =>
    buttons.map((button) => ({
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
      token: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--button-small-h')),
    }))
  );
  // 收藏（或取消收藏）、编辑、复制、删除
  assert.strictEqual(characterActions.length, 4, 'all character actions remain available');
  assert(
    characterActions.every((button) => button.width >= 40 && button.height === button.token),
    'character actions must not collapse'
  );
  await page.evaluate(() => {
    toggleSidebar();
  });
  await page.locator('#chat-session-switch').click();
  await capture(page, '10-sessions');
  assert.strictEqual(
    await page.evaluate(() => document.activeElement.id),
    'session-manager-panel',
    'opening conversations must not summon the search keyboard'
  );
  await page.evaluate(() => closeSessionManager());
  await page.locator('.tokens-details>summary').click();
  await capture(page, '11-context-details');
  await page.evaluate(() => {
    document.querySelector('.tokens-details').open = false;
    D.settings.themeMode = 'light';
    applyConfiguredTheme();
  });
  await capture(page, '12-chat-light');
  await page.evaluate(() => {
    D.settings.messageStyle = 'immersive';
    applyMessageStyle();
  });
  await capture(page, '13-immersive-light');
  await page.evaluate(() => {
    D.settings.messageStyle = 'bubble';
    applyMessageStyle();
  });
  await page
    .locator('#user-input')
    .fill('这是一段较长的输入，用于检查输入区随内容增长。\n再写一行，确认发送按钮仍然可见。');
  await page.locator('#user-input').focus();
  await capture(page, '14-input-focus');
  await page.locator('#user-input').fill('');
  await page.locator('#user-input').blur();
  await page.locator('#chat-tools-toggle').click();
  await capture(page, '15-chat-tools');
  await page.evaluate(() => {
    closeChatTools();
    D.personas[0].avatar_image = '';
    renderChat();
    D.settings.messageStyle = 'immersive';
    applyMessageStyle();
    document.getElementById('chat-messages').scrollTop = 0;
  });
  await capture(page, '16-immersive-no-user-avatar');
  assert.deepStrictEqual(errors, [], 'page errors');
  fs.writeFileSync(
    path.join(output, 'metrics.json'),
    JSON.stringify({ device: device.id, images: metrics, errors }, null, 2)
  );
  console.log(JSON.stringify({ output, images: metrics.length, errors }));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });
