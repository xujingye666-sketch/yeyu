'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');

const {waitForAppReady} = require('./helpers/app-ready');
const assets = path.resolve(__dirname, '../../app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  const semantic = await page.evaluate(() => {
    const template = document.createElement('template');
    template.innerHTML = risuRenderMixedMarkdown('「*旁白*」『**强调**』[~~状态~~] `「代码」[代码]` [「链接」](https://example.com)', 'assistant');
    return {
      narration: template.content.querySelector('.tone-quote em')?.textContent,
      bold: template.content.querySelector('.tone-quote strong')?.textContent,
      annotation: template.content.querySelector('.tone-paren del')?.textContent,
      quoteCount: template.content.querySelectorAll('.tone-quote').length,
      parenCount: template.content.querySelectorAll('.tone-paren').length,
      code: template.content.querySelector('code')?.textContent,
      link: template.content.querySelector('a')?.textContent,
      invalidCount: template.content.querySelectorAll('.tone-invalid-directive').length,
    };
  });
  assert.deepStrictEqual(semantic, {narration: '旁白', bold: '强调', annotation: '状态', quoteCount: 2, parenCount: 1, code: '「代码」[代码]', link: '「链接」', invalidCount: 0}, 'Risu 显示须复用新增语义边界，保留嵌套 Markdown、代码与链接，方括号不成为指令');

  const protectedContainers = await page.evaluate(() => {
    const pairs = [['「', '」', 'tone-quote', '**强调**'], ['『', '』', 'tone-quote', '*旁白*'], ['[', ']', 'tone-paren', '~~状态~~'], ['“', '”', 'tone-quote', '**强调**'], ['（', '）', 'tone-paren', '*旁白*'], ['【', '】', 'tone-invalid-directive', '**强调**']];
    return pairs.map(([open, close, tone, markup]) => {
      const template = document.createElement('template');
      template.innerHTML = risuRenderMixedMarkdown(open + markup + ' [链接](https://example.com)' + close, 'assistant');
      const container = template.content.querySelector('.' + tone), link = container?.querySelector('a');
      return {
        tone: container?.className,
        text: template.content.textContent,
        link: link && {text: link.textContent, href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel')},
        nested: !!container?.querySelector(markup[0] === '~' ? 'del' : markup.startsWith('**') ? 'strong' : 'em'),
      };
    });
  });
  const expectedLink = {text: '链接', href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer'};
  assert.deepStrictEqual(protectedContainers, [
    {tone: 'tone-quote', text: '「强调 链接」', link: expectedLink, nested: true},
    {tone: 'tone-quote', text: '『旁白 链接』', link: expectedLink, nested: true},
    {tone: 'tone-paren', text: '[状态 链接]', link: expectedLink, nested: true},
    {tone: 'tone-quote', text: '“强调 链接”', link: expectedLink, nested: true},
    {tone: 'tone-paren', text: '（旁白 链接）', link: expectedLink, nested: true},
    {tone: 'tone-invalid-directive', text: '【强调 链接】', link: expectedLink, nested: true},
  ], 'Risu 新旧语义容器重建嵌套 Markdown 时必须保留链接子树与外层语义');

  const inlineSubtrees = await page.evaluate(() => {
    const template = document.createElement('template');
    const source = '「**强调** <a href="https://example.com/path[x]" data-test="kept">*链接*</a> <code>[代码](https://code.example)</code><img src="https://example.com/img.png" alt="图"><span style="color:rgb(1,2,3)" data-test="styled">样式</span>」';
    template.innerHTML = risuRenderMixedMarkdown(source, 'assistant');
    const link = template.content.querySelector('a'), code = template.content.querySelector('code'), image = template.content.querySelector('img'), styled = template.content.querySelector('[data-test="styled"]');
    return {
      link: {href: link?.getAttribute('href'), label: link?.textContent, marker: link?.getAttribute('data-test'), nested: link?.children.length},
      code: {text: code?.textContent, nested: code?.children.length},
      image: {src: image?.getAttribute('src'), alt: image?.getAttribute('alt')},
      styled: {text: styled?.textContent, style: styled?.getAttribute('style')},
      linkCount: template.content.querySelectorAll('a').length,
      quoteCount: template.content.querySelectorAll('.tone-quote').length,
      bold: template.content.querySelector('strong')?.textContent,
    };
  });
  assert.deepStrictEqual(inlineSubtrees, {
    link: {href: 'https://example.com/path[x]', label: '*链接*', marker: 'kept', nested: 0},
    code: {text: '[代码](https://code.example)', nested: 0},
    image: {src: 'https://example.com/img.png', alt: '图'},
    styled: {text: '样式', style: 'color:rgb(1,2,3)'},
    linkCount: 1, quoteCount: 1, bold: '强调',
  }, 'Risu 语义容器须保留链接、代码、图片和内联 HTML 子树，代码与链接标签不得再次解析为 Markdown');

  const existingContainers = await page.evaluate(() => {
    return [['「', '」', 'tone-quote'], ['『', '』', 'tone-quote'], ['[', ']', 'tone-paren'], ['“', '”', 'tone-quote'], ['（', '）', 'tone-paren'], ['【', '】', 'tone-bracket'], ['【', '】', 'tone-invalid-directive']].map(([open, close, tone]) => {
      const template = document.createElement('template');
      template.innerHTML = risuRenderMixedMarkdown('<span class="' + tone + '" data-existing="kept">' + open + '**强调** <a href="https://example.com">链接</a> <code>[代码](https://code.example)</code>' + close + '</span>', 'assistant');
      const container = template.content.querySelector('[data-existing]');
      return {
        tone: container?.className,
        count: template.content.querySelectorAll('.' + tone).length,
        bold: container?.querySelector('strong')?.textContent,
        link: container?.querySelector('a')?.getAttribute('href'),
        code: container?.querySelector('code')?.innerHTML,
      };
    });
  });
  assert.deepStrictEqual(existingContainers, ['tone-quote', 'tone-quote', 'tone-paren', 'tone-quote', 'tone-paren', 'tone-bracket', 'tone-invalid-directive'].map(tone => ({tone, count: 1, bold: '强调', link: 'https://example.com', code: '[代码](https://code.example)'})), '已有 HTML 语义容器须保留自身边界、属性与受保护子树，不重复包裹同类语义容器');

  const source = 'PANEL';
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=';
  await page.evaluate(({source, pixel}) => {
    D = defaults();
    const char = {
      id: 'risu-display-normal',
      name: 'Risu Display',
      extensions: {risuai: {
        backgroundHTML: '<style>.background-owned{color:rgb(1,2,3)}.shared-from-background{color:rgb(4,5,6)}</style><div id="risu-background" class="background-owned">BACKGROUND:{{role}}</div>{{bg::scene.png}}',
        viewScreen: 'emotion',
        hideChatIcon: true,
        largePortrait: true,
        prebuiltAssetStyle: 'dynamic',
        customScripts: [{
          type: 'editdisplay', in: 'PANEL',
          out: '*Markdown before <span id="mixed-inline">HTML</span> after*\n<style>.card-owned{border:2px solid rgb(7,141,91);font-family:monospace}</style><section class="card-owned shared-from-background"><details><summary>状态</summary><input id="card-input"><p id="risu-normal">NORMAL <strong>HTML</strong></p><img id="risu-asset" src="{{raw::scene.png}}"><img id="risu-path" src="{{path::scene.png}}"><img id="risu-prebuilt" src="scene.png"><span id="risu-image">{{img::scene.png}}</span><button risu-trigger="increase" risu-id="normal-trigger">触发</button><button risu-btn="button-value">Lua 按钮</button></details><audio id="card-audio" controls></audio></section>',
        }],
        triggerscript: [
          {type: 'manual', comment: 'increase', conditions: [], effect: [{type: 'setvar', var: 'clicked', operator: '=', value: '{{trigger_id}}'}]},
          {type: 'manual', comment: 'lua-button-host', conditions: [], effect: [{type: 'triggerlua', code: "function onButtonClick(id, value) setChatVar(id, 'button', value) return false end"}]},
        ],
      }},
      media_assets: [
        {id: 'scene', name: 'scene.png', assetType: 'x-risu-asset', originalUri: '__asset:7', mime: 'image/png', status: 'ready', data_url: pixel},
        {id: 'smile', name: 'smile.png', assetType: 'emotion', originalUri: '__asset:8', mime: 'image/png', status: 'ready', data_url: pixel},
        {id: 'neutral', name: 'neutral', assetType: 'emotion', originalUri: '__asset:9', mime: 'image/png', status: 'ready', data_url: pixel},
      ],
    };
    const session = createBlankSession('Normal', 'risu-display-normal-session');
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    session.msgs = [{seq: 1, role: 'assistant', content: source}];
    session.nextMessageSeq = 2;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    updateChatUI();
    renderChat();
  }, {source, pixel});

  await page.waitForFunction(() => {
    const frame = document.querySelector('.risu-display-frame');
    const background = document.querySelector('.risu-background-frame');
    return frame?.contentDocument?.getElementById('risu-normal')
      && frame.contentDocument.getElementById('risu-asset')?.naturalWidth > 0
      && background?.contentDocument?.getElementById('risu-background');
  });

  const display = page.frameLocator('.risu-display-frame');
  await display.locator('summary').click();
  await display.locator('[risu-trigger="increase"]').click();
  await page.waitForFunction(() => getActiveSession(getChar().id).risu?.scriptstate?.$clicked === 'normal-trigger');
  await display.locator('[risu-btn="button-value"]').click();
  await page.waitForFunction(() => getActiveSession(getChar().id).risu?.scriptstate?.$button === 'button-value');
  await display.locator('summary').click();
  // A finger on the card's plain content inside the isolated frame opens and closes the message toolbar, like a
  // tap on the bubble; the card's own media controls keep their meaning and leave the toolbar alone.
  const toolbarOpen = () => page.evaluate(() => document.querySelector('.msg[data-msg-idx="0"]').classList.contains('actions-open'));
  assert.strictEqual(await toolbarOpen(), false);
  await display.locator('#mixed-inline').tap();
  await page.waitForFunction(() => document.querySelector('.msg[data-msg-idx="0"]').classList.contains('actions-open'));
  // Android WebView delivers a tap on media controls as a click on the element; desktop Chromium's controls
  // swallow it, so the click the phone sends is dispatched directly.
  await display.locator('#card-audio').dispatchEvent('click');
  assert.strictEqual(await toolbarOpen(), true, '轻点卡片的媒体控件不得同时切换消息操作条');
  await display.locator('#mixed-inline').tap();
  await page.waitForFunction(() => !document.querySelector('.msg[data-msg-idx="0"]').classList.contains('actions-open'));
  const proof = await page.evaluate(() => {
    const frame = document.querySelector('.risu-display-frame');
    const doc = frame.contentDocument;
    const message = getActiveSession(getChar().id).msgs[0];
    const details = doc.querySelector('details');
    return {
      sandbox: frame.getAttribute('sandbox'),
      text: doc.getElementById('risu-normal').textContent,
      imageLoaded: doc.getElementById('risu-asset').naturalWidth > 0,
      pathLoaded: doc.getElementById('risu-path').naturalWidth > 0,
      imageMacro: doc.getElementById('risu-image').querySelectorAll('img').length,
      prebuiltLoaded: doc.getElementById('risu-prebuilt').naturalWidth > 0,
      prebuiltStyle: doc.getElementById('risu-prebuilt').classList.contains('root-loaded-image-dynamic'),
      background: document.querySelector('.risu-background-frame').contentDocument.getElementById('risu-background').textContent,
      sourceKept: message.content === 'PANEL',
      cardStyle: getComputedStyle(doc.querySelector('.card-owned')).borderTopStyle,
      backgroundStyle: document.querySelector('.risu-background-frame').contentDocument.defaultView.getComputedStyle(document.querySelector('.risu-background-frame').contentDocument.querySelector('.background-owned')).color,
      sharedBackgroundStyle: getComputedStyle(doc.querySelector('.shared-from-background')).color,
      displayOptions: {
        hideChatIcon: document.body.classList.contains('risu-hide-chat-icon'),
        largePortrait: document.body.classList.contains('risu-large-portrait'),
        emotion: risuCurrentEmotion(getActiveSession(getChar().id))?.name,
      },
      trigger: doc.querySelector('[risu-trigger="increase"]').getAttribute('risu-id'),
      mixedMarkdown: !!doc.querySelector('em #mixed-inline') && doc.querySelector('em').textContent.includes('Markdown before HTML after'),
      detailsClosed: !details.open,
      clicked: getActiveSession(getChar().id).risu.scriptstate.$clicked,
      luaButton: getActiveSession(getChar().id).risu.scriptstate.$button,
    };
  });
  assert.deepStrictEqual(proof, {
    sandbox: 'allow-same-origin allow-forms',
    text: 'NORMAL HTML',
    imageLoaded: true,
    pathLoaded: true,
    imageMacro: 1,
    prebuiltLoaded: true,
    prebuiltStyle: true,
    background: 'BACKGROUND:null',
    sourceKept: true,
    cardStyle: 'solid',
    backgroundStyle: 'rgb(1, 2, 3)',
    sharedBackgroundStyle: 'rgb(4, 5, 6)',
    displayOptions: {hideChatIcon: true, largePortrait: true, emotion: 'neutral'},
    trigger: 'normal-trigger',
    mixedMarkdown: true,
    detailsClosed: true,
    clicked: 'normal-trigger',
    luaButton: 'button-value',
  });

  const retained = await page.evaluate(async () => {
    const frame = document.querySelector('.risu-display-frame');
    const doc = frame.contentDocument;
    doc.querySelector('details').open = true;
    doc.getElementById('card-input').value = '保留输入';
    renderChat();
    await new Promise(resolve => setTimeout(resolve, 100));
    const sameDoc = document.querySelector('.risu-display-frame').contentDocument;
    const same = {open: sameDoc.querySelector('details').open, value: sameDoc.getElementById('card-input').value};
    return same;
  });
  assert.deepStrictEqual(retained, {open: true, value: '保留输入'});
  await page.evaluate(() => {
    getActiveSession(getChar().id).msgs[0].content = 'PANEL changed';
    renderChat();
  });
  await page.waitForFunction(() => {
    const doc = document.querySelector('.risu-display-frame')?.contentDocument;
    return !!doc?.querySelector('details') && !!doc.getElementById('card-input') && doc.body.textContent.includes('changed');
  });
  const changed = await page.evaluate(() => {
    const doc = document.querySelector('.risu-display-frame').contentDocument;
    return {open: doc.querySelector('details').open, value: doc.getElementById('card-input').value};
  });
  assert.deepStrictEqual(changed, {open: false, value: ''});

  // Upstream applies every message stylesheet to the shared chat document in DOM
  // order. A stylesheet change reaches loaded frames without reloading them.
  const sharedOrder = await page.evaluate(async () => {
    const session = getActiveSession(getChar().id);
    const settle = async count => {
      for (let attempt = 0; attempt < 250; attempt++) {
        const hosts = [...document.querySelectorAll('.risu-display-host[data-risu-message-index]')];
        if (hosts.length === count && hosts.every(host => host.hasAttribute('data-risu-ready'))) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Risu frames did not settle');
    };
    const colors = () => [...document.querySelectorAll('.risu-display-frame')].map(frame =>
      getComputedStyle(frame.contentDocument.querySelector('.order-probe')).color);
    session.msgs = [
      {role: 'assistant', seq: 2, content: '<style>.order-probe{color:rgb(10,20,30)}</style><details><summary>A</summary><div class="order-probe late-probe">first</div></details>'},
      {role: 'assistant', seq: 3, content: '<style>.order-probe{color:rgb(40,50,60)}</style><div class="order-probe">second</div>'},
    ];
    renderChat();
    await settle(2);
    const ordered = colors();
    const frame = document.querySelector('.risu-display-frame');
    const doc = frame.contentDocument;
    doc.querySelector('details').open = true;
    session.msgs.push({role: 'assistant', seq: 4, content: '<style>.late-probe{color:rgb(70,80,90)}</style><div class="order-probe">third</div>'});
    renderChat();
    await settle(3);
    const appended = {
      colors: colors(),
      sameDocument: document.querySelector('.risu-display-frame') === frame && frame.contentDocument === doc,
      open: doc.querySelector('details').open,
    };
    session.msgs.pop();
    renderChat();
    await settle(2);
    for (let attempt = 0; attempt < 250 && colors()[0] === 'rgb(70, 80, 90)'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 20));
    return {ordered, appended, revoked: colors()};
  });
  assert.deepStrictEqual(sharedOrder, {
    ordered: ['rgb(40, 50, 60)', 'rgb(40, 50, 60)'],
    appended: {colors: ['rgb(70, 80, 90)', 'rgb(40, 50, 60)', 'rgb(40, 50, 60)'], sameDocument: true, open: true},
    revoked: ['rgb(40, 50, 60)', 'rgb(40, 50, 60)'],
  });

  const sharedAndIsolated = await page.evaluate(async () => {
    const risu = getChar();
    const session = getActiveSession(risu.id);
    session.msgs = [
      {role: 'assistant', seq: 2, content: '<style>.cross-message{color:rgb(9,87,123)}</style><div>provider</div>'},
      {role: 'assistant', seq: 3, content: '<div class="cross-message">consumer</div>'},
    ];
    renderChat();
    await new Promise(resolve => setTimeout(resolve, 100));
    const frames = [...document.querySelectorAll('.risu-display-frame')];
    const crossMessage = getComputedStyle(frames[1].contentDocument.querySelector('.cross-message')).color;
    const plain = {id: 'plain-char', name: 'Plain', extensions: {}, media_assets: []};
    const plainSession = createBlankSession('Plain', 'plain-session');
    plainSession.greetingChosen = true;
    plainSession.creatorNotesSeen = true;
    plainSession.msgs = [{role: 'assistant', seq: 1, content: '<div class="cross-message">plain</div>'}];
    D.characters.push(plain);
    D.chats[plain.id] = {sessions: [plainSession], activeSid: plainSession.id};
    D.currentCharId = plain.id;
    renderChat();
    const probe = document.createElement('span');
    probe.className = 'cross-message';
    document.body.appendChild(probe);
    const plainColor = getComputedStyle(probe).color;
    probe.remove();
    return {crossMessage, plainFrames: document.querySelectorAll('.risu-display-frame').length, plainColor};
  });
  assert.strictEqual(sharedAndIsolated.crossMessage, 'rgb(9, 87, 123)');
  assert.strictEqual(sharedAndIsolated.plainFrames, 0);
  assert.notStrictEqual(sharedAndIsolated.plainColor, 'rgb(9, 87, 123)');

  const assetContext = await page.evaluate(async () => {
    const risu = D.characters.find(row => row.id === 'risu-display-normal');
    D.currentCharId = risu.id;
    const context = await risuDisplayAssetContext(risu);
    risu.extensions.risuai.inlayViewScreen = true;
    const inline = (await risuDisplaySource('<Emotion="smile.png">', risu, {})).text;
    return {aliases: Object.keys(context.assetMap), inline};
  });
  assert(assetContext.aliases.includes('scene.png') && assetContext.aliases.includes('scene'));
  assert.match(assetContext.inline, /<img\b/);

  // A streamed reply runs the card's display regex and shows its asset while it is still being
  // written; the committed reply keeps the frame the stream mounted.
  await page.evaluate(() => {
    // Without the emotion view the reply sends no follow-up classification request to the stub below.
    Object.assign(getChar().extensions.risuai, {inlayViewScreen: false, viewScreen: 'none'});
    renderChat();
  });
  await page.waitForFunction(() => document.querySelectorAll('.risu-display-host').length &&
    [...document.querySelectorAll('.risu-display-host')].every(host => host.hasAttribute('data-risu-ready')));
  await page.evaluate(() => {
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {apiUrl: location.origin + '/risu-stream/v1', apiKey: 'synthetic', model: 'synthetic'});
    Object.assign(D.settings, {useMemory: false, embeddingEnabled: false, styleAuditEnabled: false, maxContextTokens: 0});
    const encoder = new TextEncoder();
    let push;
    window.__risuStreamPush = text => push(text);
    const nativeFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (!String(url).includes('/risu-stream/')) return nativeFetch(url, init);
      const body = new ReadableStream({start(controller) {
        push = text => {
          if (text === null) {
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n'));
            controller.close();
          } else controller.enqueue(encoder.encode('data: ' + JSON.stringify({choices: [{delta: {content: text}}]}) + '\n\n'));
        };
      }});
      return new Response(body, {headers: {'content-type': 'text/event-stream'}});
    };
    window.__risuStreamSend = doSendMessage('stream please');
  });
  await page.waitForFunction(() => _generationState !== 'idle' && (() => {
    try { window.__risuStreamPush('Opening line. PANEL'); return true; } catch (_) { return false; }
  })());
  await page.waitForFunction(() => {
    const frame = document.querySelector('#stream-msg iframe.risu-display-frame');
    return _generationState !== 'idle' && frame?.contentDocument?.getElementById('risu-asset')?.naturalWidth > 0;
  });
  const streamed = await page.evaluate(async () => {
    window.__streamFrame = document.querySelector('#stream-msg iframe.risu-display-frame');
    window.__risuStreamPush(' closing words');
    window.__risuStreamPush(null);
    await window.__risuStreamSend;
    const session = getActiveSession(getChar().id), reply = session.msgs.at(-1);
    const row = document.querySelector(`[data-msg-idx="${session.msgs.length - 1}"]`);
    await new Promise(resolve => setTimeout(resolve, 200));
    const frame = row.querySelector('iframe.risu-display-frame');
    return {
      content: reply.content,
      sameFrame: frame === window.__streamFrame,
      finalText: frame.contentDocument.body.textContent.includes('closing words'),
    };
  });
  assert.deepStrictEqual(streamed, {content: 'Opening line. PANEL closing words', sameFrame: true, finalText: true});
  // Prebuilt asset names follow upstream ChatBody: exact match at any length, then nearest name (prefix '' matches all).
  const prebuiltPicks = await page.evaluate(async () => {
    const assets = ['a', 'hi', 'happy', 'sad', 'smile.png'].map(name => ({name, url: 'data:image/png;base64,' + btoa(name)}));
    const picks = {};
    for (const src of ['a', 'hi', 'hapy', 'smlie', 'happy', 'Happy.png', 'x']) {
      const html = await risuResolvePrebuiltImages(`<img src="${src}">`, {assets}, 'static');
      const match = html.match(/src="data:image\/png;base64,([^"]+)"/);
      picks[src] = match ? atob(match[1]) : null;
    }
    return picks;
  });
  assert.deepStrictEqual(prebuiltPicks, {a: 'a', hi: 'hi', hapy: 'happy', smlie: 'hi', happy: 'happy', 'Happy.png': 'happy', x: null});
  const finalLinkEvidence = await page.evaluate(() => {
    const urls = ['https://example.com/search?tag[]=a&tag[]=b', 'https://example.com/path[one]/next', 'http://[::1]:8080/path'];
    const source = urls.join('\n') + '\n「**强调** [链接](https://example.com)」\n『*旁白* [链接](https://example.com)』\n[~~状态~~ [链接](https://example.com)]';
    const frame = document.querySelector('iframe.risu-display-frame'), doc = frame.contentDocument;
    const probe = doc.createElement('div');
    probe.innerHTML = risuPrepareFrameHtml(source, 'assistant');
    doc.body.append(probe);
    const links = [...probe.querySelectorAll('a')], forwarded = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    try {
      HTMLAnchorElement.prototype.click = function () {
        forwarded.push({href: this.getAttribute('href'), target: this.target, rel: this.rel, parentDocument: this.ownerDocument === document});
      };
      links.forEach(link => link.click());
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      probe.remove();
    }
    const sanitized = document.createElement('template');
    sanitized.innerHTML = risuPrepareFrameHtml('<a href="javascript:alert(1)">unsafe</a><img src="http://example.com/image.png">', 'assistant');
    const afterHook = DOMPurify.sanitize('<a href="http://example.com">link</a>', {ALLOWED_URI_REGEXP: /^https:/});
    return {
      hrefs: links.map(link => link.getAttribute('href')),
      labels: links.slice(0, 3).map(link => link.textContent),
      forwarded,
      unsafeHref: sanitized.content.querySelector('a')?.getAttribute('href'),
      httpResource: !!sanitized.content.querySelector('img[src^="http:"]'),
      hookRemoved: !afterHook.includes('href='),
    };
  });
  const finalHrefs = ['https://example.com/search?tag[]=a&tag[]=b', 'https://example.com/path[one]/next', 'http://[::1]:8080/path', 'https://example.com', 'https://example.com', 'https://example.com'];
  assert.deepStrictEqual(finalLinkEvidence, {
    hrefs: finalHrefs,
    labels: finalHrefs.slice(0, 3),
    forwarded: finalHrefs.map(href => ({href, target: '_self', rel: 'noopener noreferrer', parentDocument: true})),
    unsafeHref: null, httpResource: false, hookRemoved: true,
  }, 'Risu 最终帧净化与真实 iframe 点击须保留合法 HTTP(S) 地址并转交宿主导航，不开放 HTTP 资源或其他协议');

  await page.evaluate(async pixel => {
    const char = {
      id: 'risu-inlay-lifecycle', name: 'Lifecycle', first_mes: '',
      extensions: {risuai: {viewScreen: 'imggen', inlayViewScreen: false}},
    };
    const bytes = Uint8Array.from(atob(pixel.split(',')[1]), value => value.charCodeAt(0));
    const image = await createStoredImage('inlay', new Blob([bytes], {type: 'image/png'}));
    const screenImage = await createStoredImage('inlay', new Blob([bytes], {type: 'image/png'}));
    const oldSession = createBlankSession('带图', 'risu-inlay-with-image');
    oldSession.risu = {inlays: {'session-image': image}, viewScreenImage: screenImage};
    oldSession.msgs = [{seq: 1, role: 'assistant', content: '<span>{{inlay::session-image}}</span>'}];
    oldSession.nextMessageSeq = 2;
    const emptySession = createBlankSession('无图', 'risu-inlay-without-image');
    emptySession.greetingChosen = true;
    D.characters = [char]; D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [oldSession, emptySession], activeSid: oldSession.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    window.__risuLifecycleIds = {charId: char.id, emptySid: emptySession.id,
      inlayKey: image.mediaKey, screenKey: screenImage.mediaKey};
    switchAppPage('chat'); updateChatUI(); renderChat();
  }, pixel);
  await page.waitForFunction(() => {
    const stage = document.getElementById('risu-emotion-stage');
    return stage?.getAttribute('data-risu-screen') === 'imggen' && /^blob:/.test(stage.querySelector('img')?.src || '');
  });
  await page.waitForFunction(() => {
    const frame = document.querySelector('#chat-messages iframe.risu-display-frame'),
      images = frame?.contentDocument?.querySelectorAll('img') || [];
    return !!frame && Array.from(images).some(image => image.naturalWidth > 0);
  });
  await page.evaluate(async () => {
    const ids = window.__risuLifecycleIds, session = getActiveSession(ids.charId);
    session.msgs = [];
    session.nextMessageSeq = 1;
    await saveData('sessions', {urgent: true});
    updateChatUI(); renderChat();
  });
  await page.waitForFunction(() => {
    const ids = window.__risuLifecycleIds, inlay = _storedImageDisplays.get(ids.inlayKey),
      screen = _storedImageDisplays.get(ids.screenKey);
    return getActiveSession(ids.charId).id !== ids.emptySid && !document.querySelector('#chat-messages iframe.risu-display-frame')
      && !(inlay && inlay.objectUrl) && !!(screen && screen.objectUrl);
  });
  const beforeSwitch = await page.evaluate(() => {
    const stage = document.getElementById('risu-emotion-stage');
    return {stageUrl: stage.querySelector('img').src, stageShown: stage.getAttribute('data-risu-screen') === 'imggen'};
  });
  assert(/^blob:/.test(beforeSwitch.stageUrl), 'Risu imggen 视图屏应显示 session.risu.viewScreenImage');
  assert.strictEqual(beforeSwitch.stageShown, true, '切换前应显示 imggen 视图屏图片');
  await page.evaluate(async () => {
    const ids = window.__risuLifecycleIds;
    D.chats[ids.charId].activeSid = ids.emptySid;
    await saveData('sessions', {urgent: true});
    updateChatUI(); renderChat();
  });
  await page.waitForFunction(() => {
    const ids = window.__risuLifecycleIds, inlay = _storedImageDisplays.get(ids.inlayKey),
      screen = _storedImageDisplays.get(ids.screenKey);
    return getActiveSession(ids.charId).id === ids.emptySid && !document.getElementById('risu-emotion-stage')
      && !(inlay && inlay.objectUrl) && !(screen && screen.objectUrl);
  });
  const inlayLifecycle = await page.evaluate(async () => {
    const ids = window.__risuLifecycleIds;
    return {
      mediaStillStored: !!(await YeyuRepository.loadMediaBlob(ids.inlayKey)) && !!(await YeyuRepository.loadMediaBlob(ids.screenKey)),
      retainedUrl: (_storedImageDisplays.get(ids.inlayKey) || {}).objectUrl || '',
      screenRetainedUrl: (_storedImageDisplays.get(ids.screenKey) || {}).objectUrl || '',
      stageRemoved: !document.getElementById('risu-emotion-stage'),
      activeSession: getActiveSession(ids.charId).id,
    };
  });
  assert.strictEqual(inlayLifecycle.mediaStillStored, true, '切换会话只释放显示 URL，不删除仍由旧会话持有的图片 Blob');
  assert.strictEqual(inlayLifecycle.retainedUrl, '', '切到无图会话后，角色显示缓存不得继续保活旧会话的 Blob URL');
  assert.strictEqual(inlayLifecycle.screenRetainedUrl, '', '切到无图会话后，视图屏图片显示 URL 也应释放');
  assert.strictEqual(inlayLifecycle.stageRemoved, true, '新会话没有视图屏图片时移除旧舞台');
  assert.strictEqual(inlayLifecycle.activeSession, 'risu-inlay-without-image');
  assert.deepStrictEqual(pageErrors, []);
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
