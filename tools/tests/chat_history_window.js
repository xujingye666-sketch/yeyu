'use strict';
const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const { capturePageDiagnostics } = require('./helpers/page-diagnostics');

const TOTAL = 320,
  COMPRESSED_THROUGH_SEQ = 250,
  DEFAULT_START = TOTAL - 200,
  TALL_INDEX = 200;

(async () => {
  const server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  const port = await listenOnBrowserSafePort(server);
  const browser = await loadPlaywright().chromium.launch({ headless: true, executablePath: resolveEdgeExecutable() });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route('https://**', (route) =>
      route.fulfill({ status: 200, body: '', contentType: 'application/javascript' })
    );
    const page = await context.newPage();
    const diagnostics = capturePageDiagnostics(page, { ignoreFavicon: true });
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await waitForAppReady(page);

    await page.evaluate(
      ({ total, through, tallIndex }) => {
        const char = parseCard({ name: '长历史', first_mes: '' });
        char.id = 'history-window-char';
        char.scriptsEnabled = true;
        char.extensions = { yeyu: { componentImportMode: 'full' } };
        // The session the reader comes from, so the long one is opened through the product entry.
        const entry = createBlankSession('入口对话', 'history-window-entry-session');
        entry.greetingChosen = true;
        entry.msgs = [{ role: 'assistant', content: '入口对话的一条消息。', seq: 1, time: 1 }];
        entry.nextMessageSeq = 2;
        const session = createBlankSession('长历史会话', 'history-window-session');
        session.greetingChosen = true;
        session.msgs = Array.from({ length: total }, (_, i) => ({
          role: i % 2 ? 'assistant' : 'user',
          content:
            i === tallIndex
              ? Array.from(
                  { length: 90 },
                  (_, line) => '很长的一段旧剧情第 ' + line + ' 行，用来占据远超一屏的高度。'
                ).join('\n\n')
              : '第 ' + i + ' 条对话内容，这里写得长一些好让每条消息都占据可见高度。',
          seq: i + 1,
          time: 1,
        }));
        // The newest message carries a card frontend, so opening this chat really has to wait for a
        // frame to report its height before the reading position lands — the state in which the top
        // hint sits inside the viewport with nobody having scrolled. It then grows once more, the
        // way a real card does when its own content finishes laying out.
        session.msgs[total - 1] = {
          role: 'assistant',
          seq: total,
          time: 1,
          content:
            '最新一条带卡消息。\n```html\n<!doctype html><html><body style="margin:0">' +
            '<div id="card-body" style="height:300px;background:#345">卡片正文</div>' +
            '<script>setTimeout(function(){document.getElementById("card-body").style.height="520px";},120)<\/script>' +
            '</body></html>\n```',
        };
        session.nextMessageSeq = total + 1;
        // A real rolling summary boundary: everything up to this seq is already covered by memory.
        session.memoryStore.historySummary = {
          text: '较早剧情的摘要正文',
          sourceStartSeq: 1,
          sourceEndSeq: through,
        };
        D.characters = [char];
        D.chats = { [char.id]: { sessions: [entry, session], activeSid: entry.id } };
        D.currentCharId = char.id;
        D.settings.useMemory = true;
        switchAppPage('chat');
        updateChatUI();
        renderChat();
      },
      { total: TOTAL, through: COMPRESSED_THROUGH_SEQ, tallIndex: TALL_INDEX }
    );

    // ⓪ Open the long chat the way a reader does: switch to it and let it settle on its own.
    await page.evaluate(() => switchSession('history-window-session'));
    // The mount scheduler's budget is wall clock, so the wait is too: a frame counter runs out early
    // on a machine whose headless rAF ticks much faster than the display, and the card is then still
    // holding its placeholder estimate when the assertions below read it.
    await page.evaluate(async () => {
      const pause = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const quiet = () =>
        !_cardFrontendMountingKey &&
        !_cardFrontendScheduleQueued &&
        !_cardFrontendScrolling &&
        [..._cardFrontendLive.values()].every((live) => live.heightReady);
      const deadline = performance.now() + 60000;
      while (performance.now() < deadline) {
        if (quiet()) {
          await pause();
          if (quiet()) return;
        }
        await pause();
      }
    });

    const sessionState = () =>
      page.evaluate(() => {
        const sess = getActiveSession(getChar().id),
          ct = $('chat-messages'),
          hint = ct.querySelector('#history-earlier-hint'),
          divider = ct.querySelector('#history-compress-divider');
        return {
          start: getHistoryRenderStart(sess, sess.msgs),
          compressed: getSessionCompressedUntil(sess, sess.msgs),
          hintText: hint ? hint.textContent : '',
          hintCount: hint ? Number(hint.dataset.earlier) : -1,
          dividerBefore: divider && divider.nextElementSibling ? divider.nextElementSibling.dataset.msgIdx : '',
          dividerAfter: divider && divider.previousElementSibling ? divider.previousElementSibling.dataset.msgIdx : '',
          rendered: ct.querySelectorAll('[data-msg-idx]').length,
        };
      });

    // ① Compression no longer hides anything: the window is purely the 200-message render budget,
    // and the boundary shows up as a divider between the summarized and the still-verbatim part.
    const opened = await sessionState();
    assert.strictEqual(opened.compressed, COMPRESSED_THROUGH_SEQ, '摘要边界应覆盖前 250 条');
    assert.strictEqual(opened.start, DEFAULT_START, '默认窗口只由性能决定，取最近 200 条');
    assert.strictEqual(
      await page.locator('[data-msg-idx="' + DEFAULT_START + '"]').count(),
      1,
      '窗口第一条必须渲染'
    );
    assert.strictEqual(
      await page.locator('[data-msg-idx="' + (DEFAULT_START + 10) + '"]').count(),
      1,
      '被摘要覆盖的消息照常显示'
    );
    assert.strictEqual(opened.dividerAfter, String(COMPRESSED_THROUGH_SEQ - 1), '分隔线紧跟最后一条已摘要消息');
    assert.strictEqual(opened.dividerBefore, String(COMPRESSED_THROUGH_SEQ), '分隔线紧邻第一条未摘要消息');
    assert.strictEqual(opened.hintCount, DEFAULT_START, '细提示的条数等于尚未加载的更早消息数');

    // ⑥ Opening a session through its own entry must not load a batch: the reader never scrolled,
    // whatever the viewport was doing while the newest card took its place.
    await page.waitForTimeout(600);
    assert.strictEqual((await sessionState()).start, DEFAULT_START, '打开会话本身不得触发自动加载');
    // ⑦ …and it lands on the newest message, however late the card frame reports its real height.
    assert.strictEqual(await page.evaluate(() => {
      const row = document.querySelector('#chat-messages [data-msg-idx="319"]');
      const container = document.getElementById('chat-messages');
      const rect = row.getBoundingClientRect(), bounds = container.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    }), true, '打开会话后最新消息应可见');

    // ② The reader's own upward scroll loads one more batch and leaves the reading position untouched.
    const beforeAuto = await page.evaluate(() => {
      const ct = $('chat-messages');
      ct.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true }));
      ct.scrollTop = 0;
      ct.dispatchEvent(new Event('scroll', { bubbles: true }));
      return getVisibleMessageIndex();
    });
    await page.waitForFunction(
      (want) => getHistoryRenderStart(getActiveSession(getChar().id), getMsgs(getChar().id)) === want,
      DEFAULT_START - 50
    );
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => getVisibleMessageIndex()), beforeAuto, '加载更早历史后仍阅读同一条消息');
    const afterAutoState = await sessionState();
    assert.strictEqual(afterAutoState.hintCount, DEFAULT_START - 50, '细提示条数随窗口更新');
    assert.strictEqual(afterAutoState.start, DEFAULT_START - 50, '一次接近顶部只加载一批');

    // ④ The topmost displayed message still answers "上一条": it loads the previous one and jumps.
    await page.evaluate(
      ({ start }) => {
        const sess = getActiveSession(getChar().id);
        _historyLoadedBySession[sess.id] = start;
        renderChat();
        // Not the jump-to-end entry: that one is what gives the window back, and these steps need the
        // reader parked on the newest message with the widened window still in place.
        jumpToMessage(sess.msgs.length - 1);
      },
      { start: TALL_INDEX }
    );
    await page.waitForTimeout(400);
    await page.evaluate((idx) => jumpToMessage(idx), TALL_INDEX);
    await page.waitForTimeout(400);
    assert.strictEqual((await sessionState()).start, TALL_INDEX, '停在最顶一条时不应触发自动加载');
    assert.strictEqual(await page.evaluate(() => getVisibleMessageIndex()), TALL_INDEX, '当前可见楼层是窗口第一条');
    // The jump renders synchronously, so this reads the window it chose before any later batch.
    const previousWindow = await page.evaluate((idx) => {
      jumpRelativeMessage(-1);
      return {
        start: getHistoryRenderStart(getActiveSession(getChar().id), getMsgs(getChar().id)),
        rendered: !!document.querySelector('[data-msg-idx="' + idx + '"]'),
      };
    }, TALL_INDEX - 1);
    assert.strictEqual(previousWindow.start, TALL_INDEX - 1 - 5, '「上一条」按目标加载，只留少量上文');
    assert.ok(previousWindow.rendered, '「上一条」必须把目标加载出来');
    await page.waitForTimeout(400);
    const previousJump = await page.evaluate((idx) => {
      const ct = $('chat-messages'),
        el = ct.querySelector('[data-msg-idx="' + idx + '"]'),
        cr = ct.getBoundingClientRect(),
        r = el.getBoundingClientRect();
      return { visible: r.bottom > cr.top && r.top < cr.bottom };
    }, TALL_INDEX - 1);
    assert.ok(previousJump.visible, '「上一条」必须真的跳到上一条');

    // ⑤ Jumping to a floor outside the window loads it first, from the panel and from /chat-jump.
    await page.evaluate(
      ({ start }) => {
        const sess = getActiveSession(getChar().id);
        _historyLoadedBySession[sess.id] = start;
        renderChat();
        // Not the jump-to-end entry: that one is what gives the window back, and these steps need the
        // reader parked on the newest message with the widened window still in place.
        jumpToMessage(sess.msgs.length - 1);
      },
      { start: TALL_INDEX }
    );
    await page.waitForTimeout(300);
    const floorWindow = await page.evaluate(() => {
      jumpToMessage(20);
      return {
        start: getHistoryRenderStart(getActiveSession(getChar().id), getMsgs(getChar().id)),
        rendered: !!document.querySelector('[data-msg-idx="20"]'),
      };
    });
    assert.strictEqual(floorWindow.start, 15, '跳到未显示楼层先加载到目标之前');
    assert.ok(floorWindow.rendered, '跳到未显示楼层必须先把它渲染出来');
    await page.waitForTimeout(400);
    const floorJump = await page.evaluate(() => {
      const ct = $('chat-messages'),
        el = ct.querySelector('[data-msg-idx="20"]'),
        cr = ct.getBoundingClientRect(),
        r = el.getBoundingClientRect();
      return { visible: r.bottom > cr.top && r.top < cr.bottom };
    });
    assert.ok(floorJump.visible, '跳到未显示楼层后目标必须在视口内');
    await page.evaluate(
      ({ start }) => {
        const sess = getActiveSession(getChar().id);
        _historyLoadedBySession[sess.id] = start;
        renderChat();
        // Not the jump-to-end entry: that one is what gives the window back, and these steps need the
        // reader parked on the newest message with the widened window still in place.
        jumpToMessage(sess.msgs.length - 1);
      },
      { start: TALL_INDEX }
    );
    await page.waitForTimeout(300);
    await page.evaluate(() =>
      executeStscript('/chat-jump 40', { handleParserErrors: false, handleExecutionErrors: false })
    );
    await page.waitForFunction(() => document.querySelector('[data-msg-idx="40"]'));
    await page.waitForTimeout(300);
    const scriptJump = await page.evaluate(() => {
      const ct = $('chat-messages'),
        el = ct.querySelector('[data-msg-idx="40"]'),
        cr = ct.getBoundingClientRect(),
        r = el.getBoundingClientRect();
      return { visible: r.bottom > cr.top && r.top < cr.bottom };
    });
    assert.ok(scriptJump.visible, '/chat-jump 到未显示楼层也必须加载并跳转');

    // ③ "跳转到对话开始" keeps its confirmation, loads everything, then lands on message #1.
    await page.evaluate(
      ({ start }) => {
        const sess = getActiveSession(getChar().id);
        _historyLoadedBySession[sess.id] = start;
        renderChat();
        // Not the jump-to-end entry: that one is what gives the window back, and these steps need the
        // reader parked on the newest message with the widened window still in place.
        jumpToMessage(sess.msgs.length - 1);
      },
      { start: TALL_INDEX }
    );
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      void confirmJumpConversationStart();
    });
    await page.locator('#app-prompt-ok').click();
    await page.waitForFunction(() => document.querySelector('[data-msg-idx="0"]'));
    await page.waitForTimeout(500);
    const start = await page.evaluate(() => {
      const ct = $('chat-messages'),
        el = ct.querySelector('[data-msg-idx="0"]'),
        cr = ct.getBoundingClientRect(),
        r = el.getBoundingClientRect(),
        loader = document.getElementById('script-loader-surface');
      return {
        start: getHistoryRenderStart(getActiveSession(getChar().id), getMsgs(getChar().id)),
        visible: r.bottom > cr.top && r.top < cr.bottom,
        hint: ct.querySelectorAll('#history-earlier-hint').length,
        loaderShown: !!loader && !loader.hidden,
      };
    });
    assert.strictEqual(start.start, 0, '跳转到对话开始必须先把更早的消息全部加载出来');
    assert.ok(start.visible, '第 1 条必须落在视口内');
    assert.strictEqual(start.hint, 0, '全部加载后不再显示细提示');
    assert.strictEqual(start.loaderShown, false, '加载提示完成后必须收起');

    // ⑧ Returning to the end gives the window back. The whole log is loaded at this point, and every
    // later redraw — and every send — would keep paying for it with no way for the reader to say so.
    await page.evaluate(async () => {
      const original = appConfirm;
      appConfirm = async () => true;
      try {
        await confirmJumpConversationEnd();
      } finally {
        appConfirm = original;
      }
    });
    await page.waitForTimeout(600);
    const backAtEnd = await sessionState();
    const endGap = await page.evaluate(() => {
      const ct = $('chat-messages');
      return Math.round(ct.scrollHeight - ct.clientHeight - ct.scrollTop);
    });
    assert.strictEqual(backAtEnd.start, DEFAULT_START, '回到对话末尾后窗口回到默认的最近 200 条');
    assert.strictEqual(backAtEnd.rendered, 200, '回到对话末尾后页面上的消息数回到 200 条');
    assert.ok(Math.abs(endGap) <= 4, '回到对话末尾必须停在最新一条：' + endGap);

    // ⑨ A reader who left part-way up their history keeps that window when they come back: dropping
    // it there would put them somewhere else entirely.
    await page.evaluate(() => {
      const sess = getActiveSession(getChar().id);
      _historyLoadedBySession[sess.id] = 0;
      renderChat();
      jumpToMessage(10);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => switchSession('history-window-entry-session'));
    await page.evaluate(() => switchSession('history-window-session'));
    await page.waitForTimeout(600);
    assert.strictEqual((await sessionState()).start, 0, '切走再切回不得丢掉读者正在阅读的历史窗口');

    // ⑩ Leaving from the newest message and coming back does drop it.
    await page.evaluate(() => jumpToMessage(getMsgs(getChar().id).length - 1));
    await page.waitForTimeout(400);
    await page.evaluate(() => switchSession('history-window-entry-session'));
    await page.evaluate(() => switchSession('history-window-session'));
    await page.waitForTimeout(600);
    const reentered = await sessionState();
    assert.strictEqual(reentered.start, DEFAULT_START, '在最新一条离开再回来，窗口回到默认的最近 200 条');
    assert.strictEqual(reentered.rendered, 200, '重新进入会话后页面上的消息数回到 200 条');

    assert.deepStrictEqual(
      { pageErrors: diagnostics.pageErrors, consoleErrors: diagnostics.consoleErrors },
      { pageErrors: [], consoleErrors: [] },
      '渲染窗口改动不得产生页面错误'
    );
    console.log(
      JSON.stringify({
        window: 'performance only',
        divider: 'at compression boundary',
        autoLoad: 'one batch, reading position kept',
        jumpStart: 'full load then message #1',
        jumps: 'load-then-jump',
        backToEnd: 'default window restored',
      })
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
