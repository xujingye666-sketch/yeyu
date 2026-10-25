'use strict';
const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');
const { archive, risum, image } = require('../fixtures/charx_fixture');
const {waitForAppReady} = require('./helpers/app-ready');
let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 450, height: 974 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const payload = {spec:'chara_card_v3',spec_version:'3.0',data:{name:'核心测试',description:'身份={{char}};状态={{getvar::score}};{{#when::keep::route::tis::2}}BRANCH_TWO{{:else}}BRANCH_OTHER{{/}}',first_mes:'你好 {{user}}。{{#when::keep::route::tis::2}}BRANCH_TWO{{:else}}BRANCH_OTHER{{/}}',extensions:{risuai:{defaultVariables:'score=7',vits:{}},regex_scripts:[{findRegex:'BRANCH_TWO',replaceString:'ST_SHOULD_NOT_RUN',placement:[1,2],disabled:false}]}}};
  const repairedCBS = " | {{upper::don't}} / {{char}} | {{#when::1}}a{{// note}}b{{/}} | PICK={{pick}} | CHOICE={{pick::A::B}}";
  payload.data.description += repairedCBS;
  payload.data.first_mes += repairedCBS;
  const moduleData = { name: '独立核心', regex: [{type:'editdisplay',in:'LIFECYCLE_PANEL',out:'{{#when::{{chat_index}}::is::{{lastmessageid}}}}<style>.lifecycle-panel{border-top:7px solid rgb(1,2,3)}</style><div class="lifecycle-panel" data-branch="active">活动面板</div>{{:else}}<div class="lifecycle-panel" data-branch="static">静态历史</div>{{/}}'}], trigger: [{type:'manual',comment:'reload-lifecycle',conditions:[],effect:[{type:'v2UpdateGUI'}]}], assets:[['module-image','asset/source.png','png'],['missing','asset/absent.png','png']], unknown: { exact: 13 } };
  await page.evaluate(() => { openModal('import-modal'); resetImport(); });
  await page.locator('#file-input').setInputFiles({name:'核心.charx',mimeType:'application/octet-stream',buffer:archive({'card.json':JSON.stringify(payload),'module.risum':risum(moduleData,[image])},{prefix:'JPEG preview'})});
  await page.waitForFunction(() => pending.length === 1 && !_importProgressActive);
  const dependencyPreview = await page.evaluate(() => {
    const pendingText = document.getElementById('import-preview').textContent;
    const card = {
      importMeta: { container: 'charx' },
      extensions: { risuai: { vits: { voice: '__asset:1' } } },
    };
    const report = risuDependencyReport(card);
    const voice = report.items.find(item => item.id === 'risu-voice');
    return { pendingText, voice };
  });
  assert(!dependencyPreview.pendingText.includes('语音：不支持'), '空 vits 导出默认值不得误报语音依赖');
  assert(dependencyPreview.voice && dependencyPreview.voice.group === 'preserved', '含实际 VITS 资源的卡必须报告语音不支持');
  await page.evaluate(() => setPendingImportMode(0, 'direct'));
  await page.locator('#import-preview button.primary').click();
  await page.waitForFunction(() => D.characters.some(char => char.name === '核心测试'));
  const initial = await page.evaluate(async () => {
    const char = D.characters.find(char => char.name === '核心测试');
    D.currentCharId = char.id;
    const session = getActiveSession(char.id);
    session.risu = {scriptstate:{'$score':'9'},globalVariables:{toggle_route:'2'}};
    session.macroVars = {score:'ST_VALUE'};
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    appendOpeningGreeting(char,session,char.first_mes,0);
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings),{apiUrl:location.origin+'/risu-test/v1',apiKey:'synthetic-local',model:'synthetic-model',reasoningEffort:'off'});
    Object.assign(D.settings,{useMemory:false,embeddingEnabled:false,styleAuditEnabled:false,maxContextTokens:0});
    await saveData(['characters','sessions','meta'],{urgent:true});
    const asset = char.media_assets.find(asset=>asset.name==='module-image');
    if (!asset.mediaKey || !(await YeyuRepository.loadMediaValue(asset.mediaKey)).startsWith('data:image/png;base64,')) throw new Error('module asset bytes did not persist');
    if (char.media_assets.find(asset=>asset.name==='missing').status!=='unavailable') throw new Error('missing module payload became a fake image');
    switchAppPage('chat'); updateChatUI(); renderChat();
    const before = JSON.stringify(session);
    const display = await risuRenderCBSInWorker('{{getvar::score}}/{{#when::keep::route::tis::2}}yes{{:else}}no{{/}}',char,session);
    const after = JSON.stringify(session);
    const state = createRisuMacroState(char,session,{commit:true});
    await risuRenderCBSInWorker('{{addvar::score::1}}',char,session,{state,runVar:true});
    await finalizeRisuMacroState(state);
    return {display,readOnly:before===after,isolated:session.macroVars.score==='ST_VALUE',written:session.risu.scriptstate.$score,report:analyzeCardDependencies(char).ecosystem};
  });
  assert.deepStrictEqual(initial,{display:'9/yes',readOnly:true,isolated:true,written:'10',report:'risu'});
  const stableEntry = await page.evaluate(async () => {
    const char=getChar(), session=getActiveSession(char.id);
    const text='{{pick}}/{{pick::A::B}}/{{random::A::B}}';
    {
      const snapshot=risuSnapshotCBS(char,session,createRisuMacroState(char,session),{});
      const first=(await YeyuRisuRegexRuntime.evaluateCBS(text,Object.assign({},snapshot,{randomValues:[0]}))).text;
      const second=(await YeyuRisuRegexRuntime.evaluateCBS(text,Object.assign({},snapshot,{randomValues:[0.99]}))).text;
      await prepareRisuDisplayTexts(char,session,session.msgs);
      renderChat();
      const bodyA=document.querySelector('#chat-messages').textContent;
      renderChat();
      const bodyB=document.querySelector('#chat-messages').textContent;
      const core=YeyuRisuCBS.evaluate('{{pick}}',{characterId:char.id,chatId:session.id,messageCount:0});
      const state=createRisuMacroState(char,session);
      state.messages=[]; // Prompt history windows must not replace the real chat count.
      const promptA=await replaceCharacterMacros('{{pick}}',char,'用户',state);
      const promptB=await replaceCharacterMacros('{{pick}}',char,'用户',createRisuMacroState(char,session));
      return {first,second,core,promptA,promptB,bodyA,bodyB};
    }
  });
  assert.equal(stableEntry.first.split('/').slice(0,2).join('/'),stableEntry.second.split('/').slice(0,2).join('/'),'pick ignores random source');
  assert(stableEntry.first.endsWith('/A')&&stableEntry.second.endsWith('/B'),'random remains random');
  assert.equal(stableEntry.first.split('/')[0],stableEntry.core,'opening is not an official chat message');
  assert.equal(stableEntry.promptA,stableEntry.core);
  assert.equal(stableEntry.promptB,stableEntry.core);
  assert.equal(stableEntry.bodyA,stableEntry.bodyB,'redraw is stable');
  assert(stableEntry.bodyA.includes("DON'T / 核心测试")&&stableEntry.bodyA.includes('a{{// note}}b')&&stableEntry.bodyA.includes('PICK='+stableEntry.core),'opening uses repaired CBS');
  const requests = [];
  let requestPick;
  await page.route('**/risu-test/**', async route => {
    requests.push(route.request().postDataJSON());
    requestPick=await page.evaluate(async()=>{
      const char=getChar(),session=getActiveSession(char.id);
      return {value:YeyuRisuCBS.evaluate('{{pick}}',{characterId:char.id,chatId:session.id,messageCount:1}),actual:await risuRenderCBSInWorker('{{pick}}',char,session)};
    });
    await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'回复 {{getvar::score}} {{#when::keep::route::tis::2}}BRANCH_TWO{{:else}}BRANCH_OTHER{{/}}'+repairedCBS},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});
  });
  await page.locator('#user-input').fill('继续测试');
  await page.locator('#composer-action-btn').click();
  await page.waitForFunction(() => _generationState === 'idle' && getMsgs(getChar().id).some(message=>message.role==='assistant'&&!message.opening));
  assert(requests.length > 0,'send entry reached provider');
  const outbound = requests[0].messages.map(message=>message.content).join('\n');
  assert(outbound.includes('状态=10') && outbound.includes('BRANCH_TWO') && !outbound.includes('BRANCH_OTHER') && !outbound.includes('ST_SHOULD_NOT_RUN'), 'request uses only Risu values and selected branch');
  assert.equal(requestPick.actual,requestPick.value,'request sees one user message');
  assert(outbound.includes("DON'T / 核心测试")&&outbound.includes('a{{// note}}b')&&outbound.includes('PICK='+requestPick.value),'actual outbound contains repaired CBS');
  const snapshot = await page.evaluate(async () => {
    const char=getChar(),session=getActiveSession(char.id);
    await prepareRisuDisplayTexts(char,session,session.msgs);
    renderChat();
    await saveData(['sessions','meta'],{urgent:true});
    const state=createRisuMacroState(char,session);state.messages=[];
    return {state:JSON.stringify(session.risu),module:JSON.stringify(char.extensions.yeyu.risuModule),body:document.querySelector('#chat-messages').textContent,raw:getMsgs(char.id).at(-1).content,pick:await risuRenderCBSInWorker('{{pick}}',char,session),promptPick:await replaceCharacterMacros('{{pick}}',char,'用户',state),core:YeyuRisuCBS.evaluate('{{pick}}',{characterId:char.id,chatId:session.id,messageCount:2})};
  });
  assert(snapshot.body.includes('回复 10 BRANCH_TWO'),'reply uses CBS display');
  assert.equal(snapshot.pick,snapshot.core,'completed reply advances official count');
  assert.equal(snapshot.promptPick,snapshot.core,'trimmed Prompt history keeps real session count');
  assert(snapshot.body.includes('PICK='+snapshot.pick)&&snapshot.body.includes("DON'T / 核心测试")&&snapshot.body.includes('a{{// note}}b'),'reply uses repaired CBS');
  assert(snapshot.raw.includes('{{getvar::score}}'),'display preserves stored message');
  await page.reload();
  await waitForAppReady(page);
  await page.evaluate(() => {switchAppPage('chat');updateChatUI();renderChat();});
  await page.waitForFunction(pick => document.querySelector('#chat-messages').textContent.includes('PICK='+pick),snapshot.pick);
  const restored = await page.evaluate(async () => {
    const char=getChar(),session=getActiveSession(char.id);
    return {state:JSON.stringify(session.risu),module:JSON.stringify(char.extensions.yeyu.risuModule),pick:await risuRenderCBSInWorker('{{pick}}',char,session),promptPick:await replaceCharacterMacros('{{pick}}',char,'用户',createRisuMacroState(char,session)),body:document.querySelector('#chat-messages').textContent};
  });
  assert.equal(restored.state,snapshot.state);assert.equal(restored.module,snapshot.module);
  assert.equal(restored.pick,snapshot.pick);assert.equal(restored.promptPick,snapshot.promptPick);
  assert(restored.body.includes('PICK='+snapshot.pick)&&restored.body.includes('a{{// note}}b'),'reloaded display stays stable');
  const lifecycle = await page.evaluate(() => {
    const char=getChar(),session=getActiveSession(char.id);
    resetClearedSession(session);
    return {clear:!Object.prototype.hasOwnProperty.call(session,'risu')};
  });
  assert.deepStrictEqual(lifecycle,{clear:true});
  const displayLifecycle = await page.evaluate(async () => {
    const char=getChar(),session=createBlankSession('显示生命周期','risu-display-lifecycle');
    session.greetingChosen=true;session.creatorNotesSeen=true;
    session.msgs=[
      {role:'assistant',content:'OPENING',opening:true,openingIndex:0,seq:1,time:Date.now()},
      {role:'user',content:'one',seq:2,time:Date.now()},
      {role:'assistant',content:'two',seq:3,time:Date.now()},
      {role:'user',content:'three',seq:4,time:Date.now()},
      {role:'assistant',content:'four',seq:5,time:Date.now()},
      {role:'user',content:'five',seq:6,time:Date.now()},
      {role:'assistant',content:'LIFECYCLE_PANEL',seq:7,time:Date.now()}
    ];
    session.nextMessageSeq=8;
    D.chats[char.id]={sessions:[session],activeSid:session.id};
    renderChat();
    await saveData(['sessions','meta'],{urgent:true});
    return {
      opening:await risuRenderCBSInWorker('{{chat_index}}/{{lastmessageid}}',char,session,{message:session.msgs[0]}),
      latest:await risuRenderCBSInWorker('{{chat_index}}/{{lastmessageid}}',char,session,{message:session.msgs[6]})
    };
  });
  assert.deepStrictEqual(displayLifecycle,{opening:'-1/5',latest:'5/5'},'opening and official chat indices diverged');
  await page.waitForFunction(() => {
    const frame=document.querySelector('.msg[data-msg-idx="6"] .risu-display-frame'),doc=frame&&frame.contentDocument;
    const panel=doc&&doc.querySelector('.lifecycle-panel[data-branch="active"]');
    return panel&&getComputedStyle(panel).borderTopWidth==='7px';
  });
  const appendedLifecycle = await page.evaluate(async () => {
    const char=getChar(),session=getActiveSession(char.id),message={role:'user',content:'seven',seq:allocateMessageSeq(session),time:Date.now()};
    session.msgs.push(message);renderChat();await saveData(['sessions','meta'],{urgent:true});
    return risuRenderCBSInWorker('{{chat_index}}/{{lastmessageid}}',char,session,{message});
  });
  assert.equal(appendedLifecycle,'6/6','seven official messages must end at index 6');
  await page.waitForFunction(() => {
    const frame=document.querySelector('.msg[data-msg-idx="6"] .risu-display-frame'),doc=frame&&frame.contentDocument;
    const panel=doc&&doc.querySelector('.lifecycle-panel[data-branch="active"]');
    return panel&&getComputedStyle(panel).borderTopWidth==='7px';
  });
  assert.equal(await page.evaluate(() => runRisuManualTrigger('reload-lifecycle')),true,'Risu GUI reload trigger did not run');
  await page.waitForFunction(() => {
    const frame=document.querySelector('.msg[data-msg-idx="6"] .risu-display-frame'),doc=frame&&frame.contentDocument;
    const panel=doc&&doc.querySelector('.lifecycle-panel[data-branch="static"]');
    return panel&&getComputedStyle(panel).borderTopWidth!=='7px';
  });
  await page.evaluate(() => {
    const session=getActiveSession(getChar().id);
    session.msgs.push({role:'assistant',content:'LIFECYCLE_PANEL',seq:allocateMessageSeq(session),time:Date.now()});
    renderChat();
  });
  await page.waitForFunction(() => {
    const frame=document.querySelector('.msg[data-msg-idx="8"] .risu-display-frame'),doc=frame&&frame.contentDocument;
    const panel=doc&&doc.querySelector('.lifecycle-panel[data-branch="active"]');
    return panel&&getComputedStyle(panel).borderTopWidth==='7px';
  });
  await page.evaluate(async () => {
    const session=getActiveSession(getChar().id);
    session.msgs.push({role:'user',content:'after reload candidate',seq:allocateMessageSeq(session),time:Date.now()});
    renderChat();await saveData(['sessions','meta'],{urgent:true});
  });
  await page.waitForFunction(() => {
    const frame=document.querySelector('.msg[data-msg-idx="8"] .risu-display-frame'),doc=frame&&frame.contentDocument;
    const panel=doc&&doc.querySelector('.lifecycle-panel[data-branch="active"]');
    return panel&&getComputedStyle(panel).borderTopWidth==='7px';
  });
  await page.reload();
  await waitForAppReady(page);
  await page.evaluate(() => {switchAppPage('chat');updateChatUI();renderChat();});
  await page.waitForFunction(() => {
    const frame=document.querySelector('.msg[data-msg-idx="8"] .risu-display-frame'),doc=frame&&frame.contentDocument;
    const panel=doc&&doc.querySelector('.lifecycle-panel[data-branch="static"]');
    return panel&&getComputedStyle(panel).borderTopWidth!=='7px';
  });
  assert.deepStrictEqual(errors,[]);
  const filePage=await browser.newPage();
  await filePage.goto(require('url').pathToFileURL(path.resolve(__dirname,'../../app/src/main/assets/index.html')).href);
  await filePage.waitForFunction(()=>typeof YeyuRisuModule==='object');
  const localModule=await filePage.evaluate(async bytes=>(await YeyuRisuModule.decodeRisum(new Uint8Array(bytes))).module.name,[...risum(moduleData,[image])]);
  assert.equal(localModule,moduleData.name,'classic script mapping decodes at an actual file URL');
  await filePage.close();
  console.log(JSON.stringify({importClick:true,sendClick:true,cbsRequest:true,cbsDisplay:true,quotesAndComments:true,pickRedrawPromptReload:true,randomIndependent:true,rawPreserved:true,variableIsolation:true,officialOpeningIndex:true,displayAppendCache:true,displayReloadReparse:true,reload:true,fileUrlDecode:true,provider:'local synthetic SSE',viewport:'450x974'}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
