'use strict';

// Risu 卡片出图（固定 RisuAI inlayScreen.ts / triggers.ts / scriptings.ts）：inlay 视图屏为 imggen 时出图指令按上游
// 位置进入实际发出的请求体（多种预设、depth-0 世界书与生成方式的组合，预览与实发一致）；回复里的 ImgGen 标签串行出图写成
// 会话 inlay 并显示、重载仍在、续写只出新标签、失败清空标签并提示、停止键可中止出图、去敏感化来源先改写、删除会话后回收；
// 只在出图进行中显示占位，未出图的标签按上游原样显示；显示只读入引用到的 inlay；trigger 与 Lua 出图的成功与失败返回值；
// 预览不发出图请求；发给模型时去掉助手消息里的 inlay。
const assert = require('assert');
const path = require('path');
const zlib = require('zlib');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require('./helpers/page-diagnostics');
const {waitForAppReady} = require('./helpers/app-ready');

const assetsRoot = path.resolve(__dirname, '../../app/src/main/assets');
const CHAR_ID = 'imggen-char';
const RULE = 'IMGGEN_RULE for {{char}}';
const PLACEHOLDER = '[正在生成图片…]';
let browser;
let server;

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}
function solidPng(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({length: width}, () => Buffer.from(rgb)))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({length: height}, () => row)))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
const PNG = solidPng(48, 64, [90, 140, 200]);

const state = {reply: 'PLAIN_REPLY', rewrite: 'REWRITTEN PROMPT', image: 'ok', gate: null, forceJson: false,
  main: [], transient: [], images: []};
const cors = {'Access-Control-Allow-Origin': '*'};
const sse = text => 'data: ' + JSON.stringify({choices: [{delta: {content: text}, finish_reason: null}]}) + '\n\n' +
  'data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n';

async function mediaKeys(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('TavernAI');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction('media', 'readonly').objectStore('media').getAllKeys();
      read.onsuccess = () => { db.close(); resolve(read.result.map(String)); };
      read.onerror = () => reject(read.error);
    };
  }));
}
async function idle(page) {
  await page.waitForFunction(() => _generationState === 'idle');
}
async function send(page, text) {
  const count = await page.evaluate(() => getActiveSession('imggen-char').msgs.length + 2);
  await page.locator('#user-input').fill(text);
  await page.locator('#composer-action-btn').click();
  await page.waitForFunction(n => _generationState === 'idle' && getActiveSession('imggen-char').msgs.length >= n, count);
}
async function lastToast(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map(row => row.textContent).join('\n'));
}
async function lastText(page) {
  return page.evaluate(() => {
    const session = getActiveSession('imggen-char'), message = session.msgs[session.msgs.length - 1];
    return {content: message.content, text: risuMessageText(message), inlays: Object.assign({}, session.risu && session.risu.inlays)};
  });
}
// 各消息框架里显示出来的文字与已解码的图片数。
async function shown(page) {
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('#chat-messages .risu-display-frame'));
    return {
      text: document.querySelector('#chat-messages').textContent + frames.map(frame => frame.contentDocument?.body?.textContent || '').join('\n'),
      images: frames.reduce((sum, frame) => sum + (frame.contentDocument
        ? Array.from(frame.contentDocument.querySelectorAll('img')).filter(img => img.naturalWidth > 0).length : 0), 0),
    };
  });
}
async function waitShownImages(page, count) {
  await page.waitForFunction(n => Array.from(document.querySelectorAll('#chat-messages .risu-display-frame')).reduce((sum, frame) =>
    sum + (frame.contentDocument ? Array.from(frame.contentDocument.querySelectorAll('img')).filter(img => img.naturalWidth > 0).length : 0), 0) >= n, count);
}
function between(text, from, to) {
  return text.slice(text.indexOf(from) + from.length, text.indexOf(to));
}

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  await context.route('**/imggen-chat/**', route => {
    const body = route.request().postDataJSON();
    if (body.messages.some(row => String(row.content).includes('严格保留输入中的 __YEYU_KEEP_N__'))) {
      const input = body.messages.at(-1).content;
      return route.fulfill({status: 200, contentType: 'application/json', headers: cors,
        body: JSON.stringify({choices: [{message: {role: 'assistant', content: input.replace(/DELETE_MIDDLE/g, '中间').replace(/DELETE_TAIL/g, '末尾')}, finish_reason: 'stop'}]})});
    }
    if (body.stream === false && body.messages.length === 2 &&
        !body.messages.some(row => String(row.content).includes('NESTED'))) {
      state.transient.push(body);
      return route.fulfill({status: 200, contentType: 'application/json', headers: cors,
        body: JSON.stringify({choices: [{message: {role: 'assistant', content: state.rewrite}, finish_reason: 'stop'}]})});
    }
    state.main.push(body);
    if (body.stream === false || state.forceJson) return route.fulfill({status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({choices: [{message: {role: 'assistant', content: state.reply}, finish_reason: 'stop'}]})});
    return route.fulfill({status: 200, contentType: 'text/event-stream', headers: cors, body: sse(state.reply)});
  });
  await context.route('https://api.x.ai/**', async route => {
    const body = route.request().postDataJSON();
    state.images.push(body);
    if (state.gate) await state.gate.promise;
    if (state.image === 'moderated')
      return route.fulfill({status: 400, contentType: 'application/json', headers: cors,
        body: JSON.stringify({code: 'imagine:content-moderated', error: 'Generated image rejected by content moderation.'})});
    if (state.image === 'fail')
      return route.fulfill({status: 500, contentType: 'application/json', headers: cors, body: JSON.stringify({error: {message: 'image backend down'}})});
    return route.fulfill({status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({data: Array.from({length: body.n || 1}, () => ({b64_json: PNG, mime_type: 'image/png'}))})});
  });
  const page = await context.newPage();
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page, {
    ignoreFavicon: true,
    // 审核拒绝与出图失败是本测试有意返回的错误响应。
    ignoreConsoleError: (entry, url) => /^https:\/\/api\.x\.ai\//.test(url),
  });
  page.setDefaultTimeout(20000);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);
  await page.evaluate(async ({id, rule}) => {
    D = defaults();
    Object.assign(D.settings, {useMemory: false, styleAuditEnabled: false, embeddingEnabled: false, maxContextTokens: 0});
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {apiUrl: location.origin + '/imggen-chat/v1', apiKey: 'synthetic-local',
      model: 'synthetic-model', reasoningEffort: 'off'});
    D.settings.grokSubscriptionAuth = {accessToken: 'grok-test-token', refreshToken: 'grok-test-refresh', expiresAt: Date.now() + 3600000};
    // n=2 的来源：Risu 出图每个标签只要一张，按上游只取一张。
    D.settings.imageSources = [{id: 'grok-source', type: 'grok-subscription', name: 'Grok 出图', model: 'grok-imagine-image', n: 2}];
    D.settings.activeImageSourceId = 'grok-source';
    const char = {
      id, name: '画师', description: 'DESC_MARK', first_mes: '', post_history_instructions: 'CARD_POST_MARK',
      extensions: {
        risuai: {
          viewScreen: 'imggen', inlayViewScreen: true, lowLevelAccess: true,
          newGenData: {prompt: 'best quality, {{slot}}', negative: 'worse quality', instructions: rule, emotionInstructions: ''},
          triggerscript: [
            {type: 'start', comment: 'tail', conditions: [], effect: [{type: 'systemprompt', location: 'promptend', value: 'PROMPT_END_MARK'}]},
            {type: 'manual', comment: 'img', conditions: [], effect: [
              {type: 'runImgGen', value: 'TRIGGER_V1 {{char}}', negValue: 'neg', inputVar: 'imgv1'},
              {type: 'v2ImgGen', value: 'TRIGGER_V2', valueType: 'value', negValue: '', negValueType: 'value', outputVar: 'imgv2'},
            ]},
            {type: 'manual', comment: 'lua', conditions: [], effect: [{type: 'triggerlua', code: `
              luaImage = async(function(id)
                setChatVar(id, 'luaImg', generateImage(id, 'LUA_PROMPT', 'neg'):await())
              end)`}]},
            {type: 'manual', comment: 'touch', conditions: [], effect: [{type: 'setvar', var: 'touched', operator: '=', value: '1'}]},
          ],
        },
        yeyu: {risuLorebookState: []},
      },
    };
    const session = createBlankSession('出图', 'imggen-session');
    session.greetingChosen = true; session.creatorNotesSeen = true;
    D.characters = [char]; D.currentCharId = id; D.chats = {[id]: {sessions: [session], activeSid: session.id}};
    await saveData(['meta', 'characters', 'sessions'], {urgent: true});
    switchAppPage('chat'); updateChatUI(); renderChat();
  }, {id: CHAR_ID, rule: RULE});

  // 1. 出图指令落在实际发出的请求体上：预设 × depth-0 世界书 × 生成方式。
  const lore = {
    none: [],
    system: [{key: '', secondkey: '', insertorder: 100, comment: 'sys', mode: 'normal', alwaysActive: true, selective: false,
      content: '@@depth 0\n@@role system\nLORE_SYS_MARK'}],
    both: [
      {key: '', secondkey: '', insertorder: 100, comment: 'sys', mode: 'normal', alwaysActive: true, selective: false,
        content: '@@depth 0\n@@role system\nLORE_SYS_MARK'},
      {key: '', secondkey: '', insertorder: 90, comment: 'prefill', mode: 'normal', alwaysActive: true, selective: false,
        content: '@@depth 0\n@@role assistant\nLORE_ASSISTANT_MARK'},
    ],
  };
  let combos = 0;
  for (const preset of ['default', 'tail', 'reordered']) {
    for (const loreCase of Object.keys(lore)) {
      await page.evaluate(({preset, rows}) => {
        const store = presetSettingsStore();
        if (preset === 'default') store.chatCompletionPresetInUse = null;
        else {
          const raw = presetRawSkeleton();
          raw.prompts.push({identifier: 'after-post', role: 'system', content: 'PRESET_AFTER_POST', injection_position: 0});
          const order = presetOrderRow(raw).order;
          order.push({identifier: 'after-post', enabled: true});
          if (preset === 'reordered') {
            const at = order.findIndex(row => row.identifier === 'jailbreak');
            order.unshift(order.splice(at, 1)[0]);
            raw.prompts.find(row => row.identifier === 'jailbreak').content = 'PRESET_JB_FIRST';
          }
          store.chatCompletionPresetInUse = raw;
        }
        getChar().extensions.yeyu.risuLorebookState = JSON.parse(JSON.stringify(rows));
      }, {preset, rows: lore[loreCase]});
      for (const mode of ['new', 'regenerate', 'continue']) {
        state.reply = 'PLAIN_REPLY';
        const before = state.main.length;
        let preview = null;
        if (mode === 'new') {
          // 预览本轮（末尾是用户消息）后紧接着为它生成回复，二者应逐条一致。
          preview = await page.evaluate(async () => {
            const session = getActiveSession('imggen-char');
            session.msgs.push({role: 'user', content: 'USER_TURN', seq: allocateMessageSeq(session), time: Date.now()});
            await saveData('sessions', {urgent: true});
            renderChat();
            return (await buildPresetRoundPreview()).messages;
          });
          await page.evaluate(() => regenerateLast());
          await idle(page);
        } else {
          await page.evaluate(m => (m === 'regenerate' ? regenerateLast() : continueGeneration()), mode);
          await idle(page);
        }
        assert.strictEqual(state.main.length, before + 1, `${preset}/${loreCase}/${mode} 应发出一次主请求`);
        const body = state.main[state.main.length - 1], texts = body.messages.map(row => String(row.content)), joined = texts.join('\n\u0000\n');
        const label = `${preset}/${loreCase}/${mode}`;
        assert.strictEqual(joined.split(RULE).length - 1, 1, `${label}：出图指令原样出现一次`);
        const ruleAt = joined.indexOf(RULE);
        assert(joined.indexOf('CARD_POST_MARK') >= 0 && joined.indexOf('CARD_POST_MARK') < ruleAt, `${label}：指令在发送后指令之后`);
        if (preset !== 'default') assert(joined.indexOf('PRESET_AFTER_POST') < ruleAt, `${label}：指令在所有预设行之后`);
        if (preset === 'reordered') assert(joined.indexOf('PRESET_JB_FIRST') < ruleAt, `${label}：重排的预设行在指令之前`);
        if (loreCase !== 'none') {
          assert.match(between(joined, RULE, 'LORE_SYS_MARK'), /^[\s\u0000]*$/, `${label}：指令紧挨在 depth-0 世界书之前`);
        }
        if (loreCase === 'both') assert(joined.indexOf('LORE_ASSISTANT_MARK') > joined.indexOf('LORE_SYS_MARK'), `${label}：assistant 世界书在后`);
        assert(joined.indexOf('PROMPT_END_MARK') > ruleAt, `${label}：trigger promptend 在指令之后`);
        if (mode === 'continue') {
          // 续写时被续写的回复作为 assistant 行接在 postEverything 之后（夜欲的续写编排）。
          const ruleRow = texts.findIndex(text => text.includes(RULE)), baseRow = texts.lastIndexOf('PLAIN_REPLY');
          assert(baseRow > ruleRow && body.messages[baseRow].role === 'assistant', `${label}：续写的回复在指令之后`);
        }
        if (preview) assert.deepStrictEqual(body.messages, preview, `${label}：预览与实发一致`);
        combos++;
      }
    }
  }
  // 条件不成立时不注入。
  for (const patch of [{viewScreen: 'none'}, {viewScreen: 'emotion'}, {newGenData: {prompt: 'p {{slot}}', negative: '', instructions: '  ', emotionInstructions: ''}}]) {
    const saved = await page.evaluate(p => {
      const card = getChar().extensions.risuai, before = JSON.stringify(card);
      Object.assign(card, p);
      return before;
    }, patch);
    await send(page, 'USER_NEGATIVE');
    assert(!state.main[state.main.length - 1].messages.some(row => String(row.content).includes('IMGGEN_RULE')), '条件不成立时不注入：' + JSON.stringify(patch));
    await page.evaluate(before => { getChar().extensions.risuai = JSON.parse(before); }, saved);
  }
  await page.evaluate(() => { presetSettingsStore().chatCompletionPresetInUse = null; getChar().extensions.yeyu.risuLorebookState = []; });
  assert.strictEqual(state.images.length, 0, '没有 ImgGen 标签时不出图');

  // 2. ImgGen 标签：生成期间显示占位，串行出图，写成会话 inlay，原文保留。
  state.reply = 'Hello <ImgGen="a cat"> and {{ImgGen="a dog"}} end';
  let release;
  state.gate = {promise: new Promise(resolve => { release = resolve; })};
  await page.locator('#user-input').fill('DRAW');
  await page.locator('#composer-action-btn').click();
  for (let i = 0; i < 200 && state.images.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 50));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.strictEqual(state.images.length, 1, '标签串行出图：第一张完成前不发第二张');
  await page.waitForFunction(text => Array.from(document.querySelectorAll('#chat-messages .risu-display-frame'))
    .some(frame => frame.contentDocument?.body?.textContent.includes(text)), PLACEHOLDER);
  state.gate = null;
  release();
  await idle(page);
  assert.deepStrictEqual(state.images.map(body => [body.prompt, body.n]), [['best quality, a cat', 1], ['best quality, a dog', 1]]);
  let last = await lastText(page);
  assert.strictEqual(last.content, 'Hello <ImgGen="a cat"> and {{ImgGen="a dog"}} end', '原文保留');
  const tokens = last.text.match(/^Hello \{\{inlay::([^}]+)\}\} and \{\{inlay::([^}]+)\}\} end$/);
  assert(tokens, '运行文本里的标签换成 inlay：' + last.text);
  const inlayIds = [tokens[1], tokens[2]];
  assert.deepStrictEqual(Object.keys(last.inlays).sort(), inlayIds.slice().sort());
  const inlayKeys = inlayIds.map(id => last.inlays[id].mediaKey);
  assert(inlayKeys.every(Boolean));
  let stored = await mediaKeys(page);
  assert(inlayKeys.every(key => stored.includes(key)), 'inlay Blob 写入 media Store');
  await waitShownImages(page, 2);
  assert(!(await shown(page)).text.includes(PLACEHOLDER), '完成后不再显示占位');

  // 没有出图在进行的回复（被停止或不完整）：标签原样交给显示，不显示占位，也不出图；重载后同样。
  const imagesBeforeStale = state.images.length;
  await page.evaluate(async () => {
    const session = getActiveSession('imggen-char');
    session.msgs.push({role: 'assistant', content: 'STALE_HEAD <ImgGen="stale cat"> {{ImgGen="stale dog"}} STALE_TAIL',
      seq: allocateMessageSeq(session), time: Date.now()});
    await saveData('sessions', {urgent: true});
    renderChat();
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#chat-messages .risu-display-frame'))
    .some(frame => frame.contentDocument?.body?.textContent.includes('STALE_TAIL')));
  const staleShown = await page.evaluate(() => Array.from(document.querySelectorAll('#chat-messages .risu-display-frame'))
    .map(frame => frame.contentDocument?.body?.textContent || '').find(text => text.includes('STALE_TAIL')));
  // 与上游一致：<ImgGen> 作为未知标签被清掉，{{ImgGen}} 作为未知宏原样显示。
  assert.strictEqual(staleShown.replace(/\s+/g, ' '), 'STALE_HEAD {{ImgGen="stale dog"}} STALE_TAIL', '没有出图在进行时不显示占位');
  assert.strictEqual(state.images.length, imagesBeforeStale, '显示不触发出图');

  // 发给模型时去掉助手消息里的 inlay。
  state.reply = 'PLAIN_REPLY';
  await send(page, 'AFTER_IMAGES');
  assert(!state.main[state.main.length - 1].messages.some(row => /\{\{inlay|<img\b/i.test(String(row.content))), '助手消息里的 inlay 不发给模型');

  // 重载后仍显示；之后的写事务不让标签复活。
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  // 显示只读入文本里引用到的 inlay：再挂一条没被引用的，它的 Blob 不应被读取。
  await page.evaluate(() => {
    const session = getActiveSession('imggen-char'), [first] = Object.values(session.risu.inlays);
    session.risu.inlays['unreferenced-inlay'] = Object.assign({}, first, {id: 'unreferenced-inlay', mediaKey: 'unreferenced-media'});
    window.__loadedMediaKeys = [];
    const load = YeyuRepository.loadMediaBlob;
    YeyuRepository.loadMediaBlob = key => { window.__loadedMediaKeys.push(String(key)); return load.call(YeyuRepository, key); };
    switchAppPage('chat'); updateChatUI(); renderChat();
  });
  await waitShownImages(page, 2);
  const loadedKeys = await page.evaluate(() => {
    delete getActiveSession('imggen-char').risu.inlays['unreferenced-inlay'];
    return window.__loadedMediaKeys;
  });
  assert(!loadedKeys.includes('unreferenced-media'), '没被引用的 inlay 不读入：' + loadedKeys.join(','));
  assert(!(await shown(page)).text.includes(PLACEHOLDER), '重载后不显示占位');
  assert.strictEqual(await page.evaluate(() => runRisuManualTrigger('touch')), true);
  const afterTouch = await page.evaluate(id => {
    const session = getActiveSession('imggen-char');
    return risuMessageText(session.msgs.find(message => message.content.includes('a cat')));
  });
  assert.match(afterTouch, /^Hello \{\{inlay::[^}]+\}\} and \{\{inlay::[^}]+\}\} end$/, '写事务之后 inlay 仍在');

  // 3. 续写：只给新标签出图，旧图保留。
  state.reply = 'Hello <ImgGen="a fox"> again';
  await send(page, 'DRAW_FOX');
  let imageCount = state.images.length;
  state.reply = ' then <ImgGen="a bird">';
  await page.evaluate(() => continueGeneration());
  await idle(page);
  assert.strictEqual(state.images.length, imageCount + 1, '续写只为新标签出图');
  last = await lastText(page);
  assert.match(last.text, /^Hello \{\{inlay::[^}]+\}\} again then \{\{inlay::[^}]+\}\}$/, '续写后旧图与新图都在：' + last.text);

  // 4. 失败：标签换成空串，提示审核拒绝并注明可能计费。
  state.image = 'moderated';
  state.reply = 'Bad <ImgGen="forbidden"> tail';
  await send(page, 'DRAW_BAD');
  last = await lastText(page);
  assert.strictEqual(last.text, 'Bad  tail');
  assert.match(await lastToast(page), /内容审核拒绝[\s\S]*可能仍会计费/);
  state.image = 'ok';

  // 4b. 出图中途用输入区停止键停止：进行中的出图请求被取消，后面的标签不再出图；占位撤下。
  state.reply = 'S1 <ImgGen="one"> S2 <ImgGen="two"> S3';
  let releaseStop;
  state.gate = {promise: new Promise(resolve => { releaseStop = resolve; })};
  imageCount = state.images.length;
  await page.locator('#user-input').fill('DRAW_STOP');
  await page.locator('#composer-action-btn').click();
  for (let i = 0; i < 200 && state.images.length === imageCount; i++) await new Promise(resolve => setTimeout(resolve, 50));
  await page.evaluate(() => stopGeneration());
  state.gate = null;
  releaseStop();
  await idle(page);
  assert.strictEqual(state.images.length, imageCount + 1, '停止后不再为后面的标签出图');
  last = await lastText(page);
  assert.strictEqual(last.text, 'S1  S2  S3', '停止后未出的图标签清空');
  assert(!(await shown(page)).text.includes(PLACEHOLDER), '停止后不显示占位');

  // 5. 去敏感化来源：卡片提示词先改写再出图。
  await page.evaluate(async () => { D.settings.imageSources[0].promptMode = 'desensitize'; await saveData('meta'); });
  state.reply = 'Soft <ImgGen="a kiss">';
  const transientBefore = state.transient.length;
  imageCount = state.images.length;
  await send(page, 'DRAW_SOFT');
  const rewrite = state.transient[transientBefore];
  const rewritePrompt = await page.evaluate(() => assistantPromptText('imageGeneration', 'cardRewrite'));
  const desensitizeNote = await page.evaluate(() => assistantPromptText('imageGeneration', 'desensitize'));
  assert.deepStrictEqual(rewrite.messages.map(row => row.content), [rewritePrompt + '\n\n' + desensitizeNote, 'best quality, a kiss']);
  assert.strictEqual(state.images[imageCount].prompt, 'REWRITTEN PROMPT');
  await page.evaluate(async () => { D.settings.imageSources[0].promptMode = 'summary'; await saveData('meta'); });

  // 6. trigger runImgGen / v2ImgGen 与 Lua generateImage。
  imageCount = state.images.length;
  const imgRun = await page.evaluate(() => runRisuManualTrigger('img'));
  assert.strictEqual(imgRun, true);
  assert.deepStrictEqual(state.images.slice(imageCount).map(body => [body.prompt, body.n]), [['TRIGGER_V1 画师', 1], ['TRIGGER_V2', 1]]);
  assert.strictEqual(await page.evaluate(() => runRisuManualTrigger('luaImage')), true);
  assert.strictEqual(state.images[state.images.length - 1].prompt, 'LUA_PROMPT');
  let vars = await page.evaluate(() => {
    const session = getActiveSession('imggen-char');
    return {vars: session.risu.scriptstate, inlays: Object.keys(session.risu.inlays)};
  });
  for (const key of ['$imgv1', '$imgv2', '$luaImg']) {
    const match = /^\{\{inlay::(.+)\}\}$/.exec(vars.vars[key]);
    assert(match && vars.inlays.includes(match[1]), key + ' 指向写入的 inlay：' + vars.vars[key]);
  }
  state.image = 'fail';
  await page.evaluate(() => runRisuManualTrigger('img'));
  await page.evaluate(() => runRisuManualTrigger('luaImage'));
  vars = await page.evaluate(() => getActiveSession('imggen-char').risu.scriptstate);
  assert.strictEqual(vars.$imgv1, 'Error: Image generation failed');
  assert.strictEqual(vars.$imgv2, 'null');
  assert.strictEqual(vars.$luaImg, 'Error: Image generation failed');
  state.image = 'ok';

  // 7. 预览不发出图请求：脚本预览与本轮预览都短路。
  imageCount = state.images.length;
  const previewResult = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id), notes = [];
    const result = await risuWithExecution(char, session, {preview: true, previewNotes: notes}, async context => ({
      trigger: await context.runImage('PREVIEW_PROMPT', ''),
      lua: await risuLuaRpc(context, {method: 'generateImage', args: ['PREVIEW_LUA', ''], scope: {roleId: char.id, sessionId: session.id}}),
    }));
    risuCardSources(char).triggers.push({type: 'start', comment: 'preview-image', conditions: [], effect: [
      {type: 'v2ImgGen', value: 'START_PREVIEW', valueType: 'value', negValue: '', negValueType: 'value', outputVar: 'startImg'}]});
    try { await buildPresetRoundPreview(); } finally { risuCardSources(char).triggers.pop(); }
    return {result, notes};
  });
  assert.strictEqual(state.images.length, imageCount, '预览不得发出出图请求');
  assert(previewResult.result.trigger.includes('预览未执行') && previewResult.result.lua.includes('预览未执行'));

  // 9. 非流式在 output trigger 前完成 inlay；流式保留上游先 output 后 inlay 的顺序。
  await page.evaluate(() => {
    getChar().extensions.risuai.triggerscript.push({type: 'output', comment: 'see image', conditions: [],
      effect: [{type: 'v2GetLastMessage', outputVar: 'outputImageSeen'}]});
    D.settings.streamOutput = false;
  });
  state.reply = 'NONSTREAM <ImgGen="before output">';
  imageCount = state.images.length;
  await send(page, 'NONSTREAM_ORDER');
  assert.strictEqual(state.images.length, imageCount + 1);
  let order = await page.evaluate(() => {
    const s = getActiveSession('imggen-char');
    return {seen: s.risu.scriptstate.$outputImageSeen, final: risuMessageText(s.msgs.at(-1))};
  });
  assert.match(order.seen, /\{\{inlay::[^}]+\}\}/, '非流式 output 看见已转换的图片 token');
  assert.strictEqual(order.seen, order.final);
  await page.evaluate(() => { D.settings.streamOutput = true; });
  state.reply = 'STREAM <ImgGen="after output">';
  await send(page, 'STREAM_ORDER');
  order = await page.evaluate(() => {
    const s = getActiveSession('imggen-char');
    return {seen: s.risu.scriptstate.$outputImageSeen, final: risuMessageText(s.msgs.at(-1))};
  });
  assert.match(order.seen, /<ImgGen="after output">/, '流式 output 看见原始标签');
  assert.match(order.final, /\{\{inlay::[^}]+\}\}/);
  state.forceJson = true;
  state.reply = 'JSON_FALLBACK <ImgGen="json fallback">';
  await send(page, 'JSON_FALLBACK_ORDER');
  order = await page.evaluate(() => getActiveSession('imggen-char').risu.scriptstate.$outputImageSeen);
  assert.match(order, /\{\{inlay::[^}]+\}\}/, '请求流式但供应商返回整段 JSON 时按非流式顺序');
  state.forceJson = false;

  // 10. /multisend 的嵌套生成沿非流式 inlay 顺序，后一请求清掉已保存图片 token。
  await page.evaluate(() => {
    const card = getChar().extensions.risuai;
    card.defaultVariables = 'nested=ONE|||TWO';
    card.triggerscript.push({type: 'manual', comment: 'nested image', conditions: [],
      effect: [{type: 'command', value: '/getvar key=nested|/multisend {{pipe}}'}]});
  });
  state.reply = 'NESTED <ImgGen="nested picture">';
  const nestedBefore = state.main.length;
  imageCount = state.images.length;
  assert.strictEqual(await page.evaluate(() => runRisuManualTrigger('nested image')), true);
  assert.strictEqual(state.main.length, nestedBefore + 2);
  assert.strictEqual(state.main[nestedBefore].stream, true, '嵌套请求沿当前流式路径发出');
  assert.strictEqual(state.images.length, imageCount + 2);
  assert(!JSON.stringify(state.main[nestedBefore + 1].messages).includes('{{inlay::'), '嵌套请求清掉历史 inlay token');
  const nested = await page.evaluate(() => {
    const s = getActiveSession('imggen-char');
    return {seen: s.risu.scriptstate.$outputImageSeen, final: risuMessageText(s.msgs.at(-1)),
      inlays: Object.keys(s.risu.inlays)};
  });
  assert.match(nested.final, /\{\{inlay::[^}]+\}\}/);
  assert.match(nested.seen, /<ImgGen="nested picture">/, '嵌套流式 output 先于 inlay');
  state.forceJson = true;
  imageCount = state.images.length;
  assert.strictEqual(await page.evaluate(() => runRisuManualTrigger('nested image')), true);
  assert.strictEqual(state.images.length, imageCount + 2);
  const nestedJson = await page.evaluate(() => getActiveSession('imggen-char').risu.scriptstate.$outputImageSeen);
  assert.match(nestedJson, /\{\{inlay::[^}]+\}\}/, '嵌套整段 JSON 在 output 前完成 inlay');
  state.forceJson = false;

  // 嵌套出图时停止，整个 /multisend 事务的消息与图片都回滚。
  const beforeStopped = await page.evaluate(() => {
    const s = getActiveSession('imggen-char');
    return {messages: s.msgs.length, inlays: Object.keys(s.risu.inlays).length};
  });
  let releaseNested;
  state.gate = {promise: new Promise(resolve => { releaseNested = resolve; })};
  imageCount = state.images.length;
  const stoppedRun = page.evaluate(() => runRisuManualTrigger('nested image'));
  for (let i = 0; i < 200 && state.images.length === imageCount; i++) await new Promise(resolve => setTimeout(resolve, 50));
  await page.evaluate(() => stopGeneration());
  state.gate = null;
  releaseNested();
  await stoppedRun;
  const afterStopped = await page.evaluate(() => {
    const s = getActiveSession('imggen-char');
    return {messages: s.msgs.length, inlays: Object.keys(s.risu.inlays).length};
  });
  assert.deepStrictEqual(afterStopped, beforeStopped, '停止后嵌套出图事务无残留');

  // 11. 非内嵌 imggen 视图屏先由卡片规则写提示词，再以当前图片来源生成并替换上一张。
  await page.evaluate(() => {
    const card = getChar().extensions.risuai;
    card.inlayViewScreen = false;
    card.newGenData.instructions = 'VIEW_INSTRUCTIONS';
    card.newGenData.prompt = 'view quality, {{slot}}';
  });
  state.reply = 'VIEW_REPLY';
  const transientBeforeView = state.transient.length;
  imageCount = state.images.length;
  await send(page, 'VIEW_USER');
  assert.strictEqual(state.images.length, imageCount + 1);
  assert.strictEqual(state.images.at(-1).prompt, 'view quality, REWRITTEN PROMPT');
  const caption = state.transient[transientBeforeView];
  assert.strictEqual(caption.messages[0].content, 'VIEW_INSTRUCTIONS');
  assert.match(caption.messages[1].content, /^Chat:\n[\s\S]*user: VIEW_USER[\s\S]*character: VIEW_REPLY/);
  assert.strictEqual(caption.max_tokens, 300);
  assert.strictEqual(caption.temperature, 0.2);
  const firstView = await page.evaluate(() => getActiveSession('imggen-char').risu.viewScreenImage);
  assert(firstView && firstView.mediaKey);
  await send(page, 'VIEW_REPLACE');
  const secondView = await page.evaluate(() => getActiveSession('imggen-char').risu.viewScreenImage);
  assert(secondView && secondView.mediaKey !== firstView.mediaKey);
  assert(!(await mediaKeys(page)).includes(firstView.mediaKey), '旧视图屏图无引用后回收');
  state.image = 'moderated';
  await send(page, 'VIEW_MODERATED');
  assert.strictEqual(await page.evaluate(() => getActiveSession('imggen-char').risu.viewScreenImage.mediaKey),
    secondView.mediaKey, '视图屏出图被拒后保留上次有效图片');
  assert.match(await lastToast(page), /内容审核拒绝[\s\S]*可能仍会计费/);
  state.image = 'ok';
  const nestedViewImages = state.images.length;
  state.reply = 'NESTED_VIEW_REPLY';
  assert.strictEqual(await page.evaluate(() => runRisuManualTrigger('nested image')), true);
  assert.strictEqual(state.images.length, nestedViewImages + 2, '嵌套每轮回复更新视图屏图片');
  const nestedView = await page.evaluate(() => getActiveSession('imggen-char').risu.viewScreenImage);
  assert(nestedView && nestedView.mediaKey !== secondView.mediaKey);
  await page.evaluate(() => saveData(['sessions', 'characters'], {urgent: true}));
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  assert.strictEqual(await page.evaluate(() => getActiveSession('imggen-char').risu.viewScreenImage.mediaKey), nestedView.mediaKey,
    '视图屏图片重载后仍在');

  // 长按删除是当前候选的单图编辑；重复 id、动态变量与共享引用不能一起消失。
  const deleteFixture = await page.evaluate(async () => {
    const session = getActiveSession('imggen-char'), id = Object.keys(session.risu.inlays)[0];
    session.risu.scriptstate.$deleteImage = '{{inlay::' + id + '}}';
    getChar().extensions.risuai.customScripts = [
      {type: 'editdisplay', in: 'ABSENT_DELETE_MARKER', out: 'unused'},
      {type: 'editdisplay', in: 'DELETE_HEAD', out: '<b>DELETE_HEAD</b>'},
    ];
    const raw = '{{#when::1}}\nDELETE_HEAD {{getvar::deleteImage}} DELETE_MIDDLE {{inlay::' + id + '}} DELETE_TAIL\n{{:else}}UNSHOWN {{char}}{{/}}';
    const other = 'OTHER_CANDIDATE {{inlay::' + id + '}}';
    const message = {role: 'assistant', content: raw, seq: allocateMessageSeq(session), swipes: [raw, other], swipeId: 0};
    session.msgs.push(message);
    await saveData(['sessions', 'characters'], {urgent: true}); renderChat();
    return {id, raw, other, seq: message.seq, key: session.risu.inlays[id].mediaKey};
  });
  async function translateDeletedMessage() {
    await page.evaluate(async seq => {
      const session = getActiveSession('imggen-char');
      await translateMessage(session.msgs.findIndex(row => row.seq === seq));
    }, deleteFixture.seq);
    assert.strictEqual(await page.evaluate(seq => getActiveSession('imggen-char').msgs.find(row => row.seq === seq).translated,
      deleteFixture.seq), true, '通过实际翻译入口建立译文与原文');
  }
  await translateDeletedMessage();
  const translatedRaw = deleteFixture.raw.replace('DELETE_MIDDLE', '中间').replace('DELETE_TAIL', '末尾');
  async function holdInlay(occurrence = 0) {
    await page.waitForFunction(({seq, id}) => Array.from(document.querySelectorAll('.msg[data-msg-idx]')).some(row => {
      const message = getActiveSession('imggen-char').msgs[Number(row.dataset.msgIdx)];
      return message && message.seq === seq && Array.from(row.querySelectorAll('iframe')).some(frame =>
        frame.closest('.risu-display-host')._risuInlaySource.includes('<b>DELETE_HEAD</b>') &&
        frame.contentDocument && frame.contentDocument.querySelector('img[data-generated-image="' + id + '"]'));
    }), deleteFixture);
    const point = await page.evaluate(({seq, id, occurrence}) => {
      const row = Array.from(document.querySelectorAll('.msg[data-msg-idx]')).find(row =>
        getActiveSession('imggen-char').msgs[Number(row.dataset.msgIdx)].seq === seq);
      const images = Array.from(row.querySelectorAll('iframe')).flatMap(frame => frame.contentDocument
        ? Array.from(frame.contentDocument.querySelectorAll('img[data-generated-image="' + id + '"]')) : []);
      const image = images[occurrence];
      image.ownerDocument.defaultView.frameElement.scrollIntoView({block: 'center'});
      const frameBounds = image.ownerDocument.defaultView.frameElement.getBoundingClientRect(), bounds = image.getBoundingClientRect();
      return {x: frameBounds.left + bounds.left + bounds.width / 2, y: frameBounds.top + bounds.top + bounds.height / 2};
    }, {...deleteFixture, occurrence});
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.getByRole('button', {name: '删除', exact: true}).waitFor();
    await page.mouse.up();
  }
  await holdInlay();
  await page.getByRole('button', {name: '取消', exact: true}).click();
  assert.strictEqual(await page.evaluate(seq => getActiveSession('imggen-char').msgs.find(row => row.seq === seq).content,
    deleteFixture.seq), translatedRaw, '取消删除保留译文');
  await holdInlay();
  await page.getByRole('button', {name: '删除', exact: true}).click();
  await page.waitForFunction(({seq, raw}) => getActiveSession('imggen-char').msgs.find(row => row.seq === seq).content !== raw,
    {...deleteFixture, raw: translatedRaw});
  const deleted = await page.evaluate(seq => {
    const session = getActiveSession('imggen-char'), message = session.msgs.find(row => row.seq === seq);
    return {content: message.content, original: message.original_content, swipes: message.swipes, variable: session.risu.scriptstate.$deleteImage};
  }, deleteFixture.seq);
  const deletedOriginal = '{{#when::1}}\nDELETE_HEAD  DELETE_MIDDLE {{inlay::' + deleteFixture.id + '}} DELETE_TAIL\n{{:else}}UNSHOWN {{char}}{{/}}';
  assert.strictEqual(deleted.content, deletedOriginal.replace('DELETE_MIDDLE', '中间').replace('DELETE_TAIL', '末尾'));
  assert.strictEqual(deleted.original, deletedOriginal, '译文删图同步编辑待恢复原文，不丢弃原文');
  assert.deepStrictEqual(deleted.swipes, [deleted.content, deleteFixture.other], '只改活动候选');
  assert.strictEqual(deleted.variable, '{{inlay::' + deleteFixture.id + '}}', '动态源变量与共享图保留');
  assert((await mediaKeys(page)).includes(deleteFixture.key), '共享 inlay 媒体保留');
  await page.reload({waitUntil: 'load'}); await waitForAppReady(page);
  assert.strictEqual(await page.evaluate(seq => getActiveSession('imggen-char').msgs.find(row => row.seq === seq).content,
    deleteFixture.seq), deleted.content, '删除重载后生效');
  await page.evaluate(async seq => {
    const session = getActiveSession('imggen-char');
    await restoreOriginalMessage(session.msgs.findIndex(row => row.seq === seq));
  }, deleteFixture.seq);
  assert.strictEqual(await page.evaluate(seq => getActiveSession('imggen-char').msgs.find(row => row.seq === seq).content,
    deleteFixture.seq), deletedOriginal, '重载后恢复原文不会撤销删图');
  // 原文与译文长度已经不同，再次翻译后删剩下的直接引用；切换候选自动恢复原文也不能带回图片。
  await translateDeletedMessage();
  await holdInlay();
  await page.getByRole('button', {name: '删除', exact: true}).click();
  await page.waitForFunction(seq => !getActiveSession('imggen-char').msgs.find(row => row.seq === seq).content.includes('{{inlay::'),
    deleteFixture.seq);
  const noImageOriginal = deletedOriginal.replace('{{inlay::' + deleteFixture.id + '}}', '');
  await page.evaluate(async seq => {
    const session = getActiveSession('imggen-char');
    await switchMessageSwipe(session.msgs.findIndex(row => row.seq === seq), 1, {targetIndex: 1});
  }, deleteFixture.seq);
  await page.reload({waitUntil: 'load'}); await waitForAppReady(page);
  assert.strictEqual(await page.evaluate(seq => getActiveSession('imggen-char').msgs.find(row => row.seq === seq).content,
    deleteFixture.seq), deleteFixture.other, '其他候选及其共享图片在重载后保持');
  await page.evaluate(async seq => {
    const session = getActiveSession('imggen-char');
    await switchMessageSwipe(session.msgs.findIndex(row => row.seq === seq), -1, {targetIndex: 0});
  }, deleteFixture.seq);
  await page.reload({waitUntil: 'load'}); await waitForAppReady(page);
  assert.strictEqual(await page.evaluate(seq => getActiveSession('imggen-char').msgs.find(row => row.seq === seq).content,
    deleteFixture.seq), noImageOriginal, '候选往返与保存重载不复活已删图且保留完整正文与隐藏分支');
  await page.waitForFunction(seq => Array.from(document.querySelectorAll('.msg[data-msg-idx]')).some(row => {
    const message = getActiveSession('imggen-char').msgs[Number(row.dataset.msgIdx)];
    const frames = Array.from(row.querySelectorAll('iframe'));
    if (frames.some(frame => !frame.contentDocument || !frame.contentDocument.body)) return false;
    const text = row.textContent + frames.map(frame => frame.contentDocument.body.textContent).join('');
    return message && message.seq === seq && text.includes('DELETE_TAIL') && !row.querySelector('img[data-generated-image]') &&
      frames.every(frame => !frame.contentDocument.querySelector('img[data-generated-image]'));
  }), deleteFixture.seq);
  assert((await mediaKeys(page)).includes(deleteFixture.key), '删完当前候选仍保留其他候选与会话共享媒体');

  // 8. 删除会话后，下一次保存回收它的 inlay Blob。
  await page.evaluate(async () => {
    const box = D.chats['imggen-char'], fresh = createBlankSession('新对话', 'imggen-fresh');
    box.sessions = [fresh]; box.activeSid = fresh.id;
    await saveData('sessions', {urgent: true});
  });
  stored = await mediaKeys(page);
  assert(inlayKeys.every(key => !stored.includes(key)), '删除会话后 inlay Blob 被回收');

  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log(JSON.stringify({requestCombos: combos, imggenTags: true, triggerLua: true, previewShortCircuit: true, cleanup: true}));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
