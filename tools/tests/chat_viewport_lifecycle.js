/* global __retained -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';
const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');
const { capturePageDiagnostics } = require('./helpers/page-diagnostics');

const {waitForAppReady} = require('./helpers/app-ready');
(async () => {
  const server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  const port = await listenOnBrowserSafePort(server);
  const browser = await loadPlaywright().chromium.launch({ headless: true, executablePath: resolveEdgeExecutable() });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route('https://**', (r) =>
      r.fulfill({ status: 200, body: '', contentType: 'application/javascript' })
    );
    await context.route('**/chat/completions', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        contentType: 'text/event-stream',
        body:
          'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content:
                    '```html\n<!doctype html><html><body>生成的脚本前端<script>window.instance=Math.random();<\/script></body></html>\n```',
                },
              },
            ],
          }) +
          '\n\ndata: [DONE]\n\n',
      });
    });
    const page = await context.newPage();
    const { pageErrors, consoleErrors } = capturePageDiagnostics(page, { ignoreFavicon: true });
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await waitForAppReady(page);
    await page.evaluate((origin) => {
      const char = parseCard({ name: '视口测试', first_mes: '' });
      char.id = 'viewport-main';
      char.scriptsEnabled = true;
      char.extensions = { yeyu: { componentImportMode: 'full' } };
      const session = createBlankSession('测试', 'viewport-session');
      session.greetingChosen = true;
      const html =
        '<!doctype html><html><body style="margin:0"><p>可复用的消息前端</p><input aria-label="原控件"><div style="height:350px"></div><script>window.instance=Math.random();<\/script></body></html>';
      session.msgs = Array.from({ length: 12 }, (_, i) => ({
        role: 'assistant',
        content: i === 3 || i === 8 ? '```html\n' + html + '\n```' : ('普通消息 ' + i + '。').repeat(45),
        seq: i + 1,
        time: 1,
      }));
      session.nextMessageSeq = 13;
      session.msgs[3].content = '前面的说明甲\n' + session.msgs[3].content;
      session.msgs[3].swipes = ['另一候选', session.msgs[3].content];
      session.msgs[3].swipeId = 1;
      D.characters = [char];
      D.chats = { [char.id]: { sessions: [session], activeSid: session.id } };
      D.currentCharId = char.id;
      ensureProviderSettings(D.settings);
      const provider = activeProviderForSettings(D.settings);
      provider.apiUrl = origin;
      provider.apiKey = 'test-key';
      provider.model = 'test-model';
      D.settings.useMemory = false;
      updateChatUI();
      renderChat();
    }, `http://127.0.0.1:${port}`);
    await page.waitForFunction(
      () =>
        _cardFrontendLive.size === 2 &&
        Array.from(_cardFrontendLive.values()).every((l) => l.frame.contentWindow.instance)
    );
    // Frames no longer start in DOM order: the newest card-bearing message is pinned and starts
    // first. Read them back by message seq so the comparisons stay about content, not start order.
    const snapshot = () =>
      page.evaluate(() =>
        Array.from(_cardFrontendLive.values())
          .filter((l) => l.owner.messageSeq <= 12)
          .sort((a, b) => a.owner.messageSeq - b.owner.messageSeq)
          .map((l) => ({
            seq: l.owner.messageSeq,
            index: l.owner.messageIndex,
            instance: l.frame.contentWindow.instance,
            current: l.frame.contentWindow.getCurrentMessageId(),
            swipe: l.frame.contentWindow.getChatMessages()[0].swipe_id,
            value: l.frame.contentDocument.querySelector('input')?.value,
          }))
      );
    await page.evaluate(() => {
      for (const l of _cardFrontendLive.values())
        l.frame.contentDocument.querySelector('input').value = '保留-' + l.owner.messageSeq;
    });
    const before = await snapshot();
    await page.evaluate(() => {
      const message = getMsgs(getChar().id)[3];
      message.content = message.content.replace('前面的说明甲', '不同的说明乙');
      message.swipes[message.swipeId] = message.content;
      renderChat();
    });
    assert.deepStrictEqual(await snapshot(), before, '前端周围说明文字变化不能重建内容未变的前端');
    await page.evaluate(() => {
      getMsgs(getChar().id).forEach((m) => (m.time = Date.now() - 120000));
      renderChat();
    });
    assert.deepStrictEqual(await snapshot(), before, '时间标签改变不能让消息容器重建旧前端');
    await page.locator('#user-input').fill('发送入口回归');
    await page.locator('#composer-action-btn').click();
    await page.waitForFunction(() => _generationState !== 'idle');
    assert.deepStrictEqual(await snapshot(), before, '发送/生成开始不可重载旧前端');
    await page.waitForFunction(() => _generationState === 'idle' && getMsgs(D.currentCharId).length === 14);
    assert.deepStrictEqual(await snapshot(), before, '生成提交不可重载旧前端');
    await page.waitForFunction(() =>
      [..._cardFrontendLive.values()].some((l) => l.owner.messageSeq === 14 && l.frame.contentWindow.instance)
    );
    const committed = await page.evaluate(
      () => [..._cardFrontendLive.values()].find((l) => l.owner.messageSeq === 14).frame.contentWindow.instance
    );
    await page.evaluate(() => renderChat());
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        () => [..._cardFrontendLive.values()].find((l) => l.owner.messageSeq === 14).frame.contentWindow.instance
      ),
      committed,
      '流式提交与正常重绘必须使用相同结构，不得二次初始化新前端'
    );
    await page.evaluate(() => {
      void deleteMessage(0);
    });
    await page.locator('#app-prompt-ok').click();
    await page.waitForFunction(() => getMsgs(D.currentCharId).length === 13);
    await page.waitForTimeout(150);
    const deleted = await snapshot();
    assert.deepStrictEqual(
      deleted.map(({ index, current, ...row }) => row),
      before.map(({ index, current, ...row }) => row),
      '删除前面的消息必须保留旧文档和控件值'
    );
    for (let i = 0; i < deleted.length; i++)
      assert(
        deleted[i].index === before[i].index - 1 && deleted[i].current === deleted[i].index,
        '保活实例楼层必须同步'
      );
    const variableOwner = await page.evaluate(() => {
      const live = [..._cardFrontendLive.values()]
          .filter((l) => l.owner.messageSeq <= 12)
          .sort((a, b) => a.owner.messageSeq - b.owner.messageSeq)[0],
        api = live.frame.contentWindow;
      const option = { type: 'message', message_id: api.getCurrentMessageId() };
      api.replaceVariables({ stat_data: { owned: live.owner.messageSeq } }, option);
      const current = api.getChatMessages()[0];
      return {
        index: current.message_id,
        swipe: current.swipe_id,
        writtenCandidate: getMsgs(getChar().id)[live.owner.messageIndex].yeyuMvu.candidates.findIndex(
          (c) => c.state?.owned
        ),
        variables: api.getVariables(option),
        owners: getMsgs(getChar().id)
          .filter((m) => m.yeyuMvu?.candidates?.some((c) => c.state?.owned))
          .map((m) => m.seq),
      };
    });
    assert.equal(variableOwner.index, deleted[0].index, '默认历史读取必须指向更新后的当前楼层');
    assert.equal(variableOwner.variables.stat_data.owned, deleted[0].seq);
    assert.equal(variableOwner.swipe, 1, '楼层变化后当前 swipe 保持原候选');
    assert.equal(variableOwner.writtenCandidate, 1, '变量写回当前 swipe 候选');
    assert.deepStrictEqual(variableOwner.owners, [deleted[0].seq], '保活前端变量只能写回原消息实体');
    await page.evaluate(() => {
      const ordered = Array.from(_cardFrontendLive.values()).sort(
          (a, b) => a.owner.messageSeq - b.owner.messageSeq
        ),
        l = ordered[0];
      window.__retained = ordered.at(-1).frame.contentWindow.instance;
      releaseCardFrontendsForMessageRender(getChar(), l.owner.messageIndex, [l.owner.messageIndex]);
      renderChat();
    });
    await page.waitForTimeout(250);
    assert(
      await page.evaluate(() =>
        Array.from(_cardFrontendLive.values()).some((l) => l.frame.contentWindow.instance === __retained)
      ),
      '目标刷新保留无关实例'
    );
    assert.deepStrictEqual({ pageErrors, consoleErrors }, { pageErrors: [], consoleErrors: [] }, '页面与控制台不得报错');
    console.log(JSON.stringify({sendAndGeneration: 'preserved', deleteBefore: 'preserved and reindexed', explicitRefresh: 'targeted'}));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
