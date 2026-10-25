/* global __sendInterceptEvents, __sendInterceptHostCalls, __sendInterceptHostPrompts, __sendInterceptPlanningCalls */
// Browser globals installed by this file's INTERCEPT_SCRIPT fixture and page.evaluate setup.
'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, loadPlaywright, listenOnBrowserSafePort, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');

const INTERCEPT_SCRIPT = `
window.__sendInterceptEvents=[];
const eventTypes=SillyTavern.eventTypes;
SillyTavern.eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS,async(type,params,dryRun)=>{
  __sendInterceptEvents.push({type:String(type),dryRun:dryRun===true});
  const chat=SillyTavern.chat,last=chat.length?chat[chat.length-1]:null;
  if(!last||!last.is_user)return;
  const source=String(last.mes||'');
  if(source==='删除本轮用户消息'){
    await SillyTavern.deleteLastMessage();
    return;
  }
  const planned=await TavernHelper.generateRaw({ordered_prompts:[{role:'user',content:source}],should_stream:false});
  last.mes=planned;
  await SillyTavern.eventSource.emit(eventTypes.MESSAGE_UPDATED,chat.length-1);
});
`;

const NO_LISTENER_SCRIPT = `window.__sendInterceptNoListener=true;`;

async function waitLibrary(page) {
  try{await page.waitForFunction(() => window._cardScriptLibraryLive && _cardScriptLibraryLive.state === 'ready',null,{timeout:15000});}
  catch(error){const state=await page.evaluate(()=>({live:_cardScriptLibraryLive&&{state:_cardScriptLibraryLive.state,error:_cardScriptLibraryLive.lastError},frames:Array.from(document.querySelectorAll('iframe')).map(frame=>({title:frame.title,srcdoc:frame.srcdoc.length,sandbox:frame.hasAttribute('sandbox')}))}));throw new Error('发送拦截脚本库未就绪：'+JSON.stringify(state)+'；'+String(error&&error.message||error));}
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && await frame.evaluate(() => !!window.SillyTavern).catch(() => false)) return frame;
  }
  throw new Error('发送拦截脚本库 iframe 未创建');
}

(async () => {
  const server = createAssetServer(assets);
  const port = await listenOnBrowserSafePort(server);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await loadPlaywright().chromium.launch({headless: true, executablePath: resolveEdgeExecutable()});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, hasTouch: true, isMobile: true});
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js', route => route.fulfill({status: 200, contentType: 'application/javascript', body: 'window.jQuery=window.$=function(){return {val:function(){return "";}}};'}));
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`${origin}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  await page.evaluate(script => {
    window.saveData = async () => true;
    window.runAutoMemorySummary = async () => null;
    window.__sendInterceptPlanningCalls = 0;
    window.__sendInterceptHostPrompts = [];
    window.__sendInterceptHostCalls = 0;
    window.callDeepSeek = async function(messages, target) {
      if (target && target.mode === 'card-frontend') {
        __sendInterceptPlanningCalls++;
        const text = (messages || []).map(row => String(row && row.content || '')).join('\n');
        return {content: '规划改写：' + text.split('\n').at(-1)};
      }
      __sendInterceptHostCalls++;
      __sendInterceptHostPrompts.push((messages || []).map(row => ({role: row.role, content: String(row.content || '')})));
      return {display: '宿主回复 ' + __sendInterceptHostCalls, reasoning: '', usage: null, finishReason: 'stop'};
    };
    const char = parseCard({name: '发送拦截测试卡', description: '测试', first_mes: '开场'});
    char.id = 'send-intercept-card';
    char.extensions = {tavern_helper: [['scripts', [{id: 'intercept', name: '发送拦截测试库', type: 'script', enabled: true, content: script}]], ['variables', {}]]};
    const session = createBlankSession('主对话', 'send-intercept-session');
    session.msgs.push({role: 'assistant', content: '开场', time: Date.now(), seq: 1});
    session.nextMessageSeq = 2;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [session], activeSid: session.id}};
    renderChat();
    updateChatUI();
    syncCardScriptLibrary(char);
  }, INTERCEPT_SCRIPT);

  let library = await waitLibrary(page);
  const eventTypes = await library.evaluate(() => SillyTavern.eventTypes);
  assert.ok(Object.keys(eventTypes).length >= 80, 'SillyTavern 事件表必须保留完整宿主事件集');
  assert.deepStrictEqual({
    CHAT_CHANGED:eventTypes.CHAT_CHANGED,GENERATION_ENDED:eventTypes.GENERATION_ENDED,MESSAGE_RECEIVED:eventTypes.MESSAGE_RECEIVED,
    MESSAGE_UPDATED:eventTypes.MESSAGE_UPDATED,GENERATION_AFTER_COMMANDS:eventTypes.GENERATION_AFTER_COMMANDS,
    OAI_PRESET_CHANGED_BEFORE:eventTypes.OAI_PRESET_CHANGED_BEFORE,OAI_PRESET_CHANGED_AFTER:eventTypes.OAI_PRESET_CHANGED_AFTER,PRESET_CHANGED:eventTypes.PRESET_CHANGED
  }, {
    CHAT_CHANGED:'chat_id_changed',GENERATION_ENDED:'generation_ended',MESSAGE_RECEIVED:'message_received',
    MESSAGE_UPDATED:'message_updated',GENERATION_AFTER_COMMANDS:'GENERATION_AFTER_COMMANDS',
    OAI_PRESET_CHANGED_BEFORE:'oai_preset_changed_before',OAI_PRESET_CHANGED_AFTER:'oai_preset_changed_after',PRESET_CHANGED:'preset_changed'
  });

  const normalSent = await page.evaluate(() => doSendMessage('原始用户正文'));
  assert.strictEqual(normalSent, true, normalSent ? '' : await page.evaluate(() => document.getElementById('toasts').textContent));
  const normal = await page.evaluate(() => {
    const rows = getActiveSession(getChar().id).msgs;
    return {rows: rows.map(row => ({role: row.role, content: row.content})), planning: __sendInterceptPlanningCalls, prompts: __sendInterceptHostPrompts.slice()};
  });
  assert.strictEqual(normal.planning, 1, '启用运行组件后发送必须真实走一次脚本 generateRaw 规划调用');
  assert.strictEqual(normal.rows[1].content, '规划改写：原始用户正文', '本轮用户正文必须被窄写回通道改写');
  assert.ok(normal.prompts[0].some(row => row.role === 'user' && row.content.includes('规划改写：原始用户正文')), '宿主提示词必须采用改写后正文');
  assert.strictEqual(normal.rows.at(-1).role, 'assistant');

  await page.evaluate(async () => { await regenerateLast(); await continueGeneration(); });
  const types = await library.evaluate(() => __sendInterceptEvents.slice());
  assert.deepStrictEqual(types.map(row => row.type).slice(0, 3), ['normal', 'regenerate', 'continue']);
  assert.ok(types.slice(0, 3).every(row => row.dryRun === false));

  const stscriptBefore = await page.evaluate(() => __sendInterceptPlanningCalls);
  await page.evaluate(() => STSCRIPT_COMMANDS.gen.callback({}, 'STScript交互原文'));
  const stscript = await page.evaluate(() => ({
    planning: __sendInterceptPlanningCalls,
    rows: getActiveSession(getChar().id).msgs.map(row => ({role: row.role, content: row.content})),
    prompts: __sendInterceptHostPrompts.slice()
  }));
  assert.strictEqual(stscript.planning, stscriptBefore + 1, 'STScript /gen 必须进入同一发送拦截窗口');
  assert.ok(stscript.rows.some(row => row.role === 'user' && row.content === '规划改写：STScript交互原文'));
  assert.ok(stscript.prompts.at(-1).some(row => row.role === 'user' && row.content.includes('规划改写：STScript交互原文')));
  const triggerBefore = await library.evaluate(() => __sendInterceptEvents.length);
  const triggerPlanningBefore = await page.evaluate(() => __sendInterceptPlanningCalls);
  await page.evaluate(() => STSCRIPT_COMMANDS.trigger.callback({}));
  assert.strictEqual(await library.evaluate(() => __sendInterceptEvents.length), triggerBefore + 1, 'STScript /trigger 必须发射发送拦截事件');
  assert.strictEqual(await library.evaluate(() => __sendInterceptEvents.at(-1).type), 'normal');
  assert.strictEqual(await page.evaluate(() => __sendInterceptPlanningCalls), triggerPlanningBefore, '/trigger 未新建用户楼层时不得伪造可写回消息');

  await page.mouse.click(8, 8);
  const beforeDelete = await page.evaluate(() => ({rows: getActiveSession(getChar().id).msgs.map(row => ({role: row.role, content: row.content})), calls: __sendInterceptHostCalls}));
  assert.strictEqual(await page.evaluate(() => doSendMessage('删除本轮用户消息')), true);
  const afterDelete = await page.evaluate(() => ({rows: getActiveSession(getChar().id).msgs.map(row => ({role: row.role, content: row.content})), calls: __sendInterceptHostCalls}));
  assert.deepStrictEqual(afterDelete, beforeDelete, 'deleteLastMessage must remove this send without changing existing messages or starting an AI reply');
  const tokenBeforeNoListener = await page.evaluate(() => _cardScriptLibraryLive && _cardScriptLibraryLive.token);
  await page.evaluate(script => {
    const char = getChar();
    char.extensions.tavern_helper[0][1][0].content = script;
    invalidateCardScriptStack(char);
    syncCardScriptLibrary(char);
  }, NO_LISTENER_SCRIPT);
  await page.waitForFunction(previous => _cardScriptLibraryLive && _cardScriptLibraryLive.state === 'ready' && _cardScriptLibraryLive.token !== previous, tokenBeforeNoListener);
  await waitLibrary(page);
  const noListenerPlanning = await page.evaluate(() => __sendInterceptPlanningCalls);
  assert.strictEqual(await page.evaluate(() => doSendMessage('无监听器原文')), true);
  assert.strictEqual(await page.evaluate(() => __sendInterceptPlanningCalls), noListenerPlanning, '无监听器时不得产生额外模型调用');
  assert.ok(await page.evaluate(() => getActiveSession(getChar().id).msgs.some(row => row.role === 'user' && row.content === '无监听器原文')));

  assert.deepStrictEqual(pageErrors, []);

  await browser.close();
  server.close();
})().catch(error => { console.error(String(error && error.stack || error)); process.exit(1); });
