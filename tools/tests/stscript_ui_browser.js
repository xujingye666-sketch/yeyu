/* global runScript -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {createAssetServer, listenOnBrowserSafePort,loadPlaywright,resolveEdgeExecutable} = require('./source');
const {visualDevice,installNativeSafeArea}=require('../qa/visual_device');
const {capturePageDiagnostics}=require('./helpers/page-diagnostics');
const {waitForAppReady} = require('./helpers/app-ready');
const root=path.resolve(__dirname,'../..'),assets=path.join(root,'app/src/main/assets'),evidence=path.join(root,'.tmp/stscript-ui');
let browser,server;
(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  server=createAssetServer(assets);
  const port=await listenOnBrowserSafePort(server);
  browser=await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  const device=visualDevice(),page=await browser.newPage(device.browserContext);
  await installNativeSafeArea(page,device);
  const {pageErrors,consoleErrors}=capturePageDiagnostics(page,{ignoreFavicon:true,appendUrl:true});
  await page.route(/^https:\/\//,route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.goto(`http://127.0.0.1:${port}/`);
  await waitForAppReady(page);
  await page.evaluate(async()=>{
    D=defaults();D.settings.useMemory=false;
    const char=parseCard({name:'图库测试',first_mes:'你好',extensions:{}});char.id='script-ui-char';
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=200;const ctx=canvas.getContext('2d');ctx.fillStyle='#384869';ctx.fillRect(0,0,160,200);
    char.media_assets=[{id:'gallery-image',name:'night.png',kind:'image',mime:'image/png',data_url:canvas.toDataURL()}];
    const session=createBlankSession('界面命令测试','script-ui-session');session.msgs=[{seq:1,role:'user',content:'测试输入'},{seq:2,role:'assistant',content:'测试回复'}];session.nextMessageSeq=3;
    D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};
    await saveData();updateChatUI();renderChat();setSidebarOpen(false);
    window.runScript=async text=>(await executeStscript(text,{handleParserErrors:false,handleExecutionErrors:false})).pipe;
  });
  // Shared prompt lifecycle: replacing a prompt resolves its previous caller; cancellation and
  // alternative actions retain their distinct results, and the next input uses its own fields.
  await page.evaluate(() => {
    window.oldPrompt = appInput('旧输入', '旧值', '旧标题');
    window.newPrompt = appChooseAction('选择操作', '操作标题', '删除', '保留');
  });
  assert.strictEqual(await page.evaluate(() => window.oldPrompt), null);
  assert.strictEqual(await page.locator('#app-prompt-ok').evaluate(node => node.classList.contains('danger')), true);
  await page.locator('#app-prompt-alt').tap();
  assert.strictEqual(await page.evaluate(() => window.newPrompt), 'alternative');
  await page.evaluate(() => {
    window.oldPrompt = appConfirm('旧确认', '旧标题');
    window.newPrompt = appInput('输入内容', '默认值', '输入标题', '字段名', {multiline: true});
  });
  assert.strictEqual(await page.evaluate(() => window.oldPrompt), false);
  assert.strictEqual(await page.locator('#app-prompt-ok').evaluate(node => node.classList.contains('primary')), true);
  assert.strictEqual(await page.locator('#app-prompt-alt').isHidden(), true);
  await page.locator('#app-prompt-textarea').fill('多行\n新值');
  await page.keyboard.press('Control+Enter');
  assert.strictEqual(await page.evaluate(() => window.newPrompt), '多行\n新值');
  await page.evaluate(() => { window.newPrompt = appInput('选项', '乙', '选择标题', '选项', {choices: ['甲', '乙']}); });
  await page.locator('#app-prompt-choice input[value="甲"]').tap();
  await page.locator('#app-prompt-ok').tap();
  assert.strictEqual(await page.evaluate(() => window.newPrompt), '甲');
  await page.evaluate(() => { window.newPrompt = appInput('取消输入', '原值'); });
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.evaluate(() => window.newPrompt), null);
  await page.locator('#user-input').fill('/echo 聊天指令');
  await page.locator('#composer-action-btn').click();
  await page.locator('#toasts',{hasText:'聊天指令'}).waitFor();
  assert.strictEqual(await page.locator('#user-input').inputValue(),'','聊天框执行脚本后清空输入框');
  assert.strictEqual(await page.evaluate(()=>runScript('/bubbles')),'');
  assert.strictEqual(await page.evaluate(()=>runScript('/theme light')),'');
  assert.strictEqual(await page.evaluate(()=>runScript('/theme')),'light');
  assert.strictEqual(await page.evaluate(()=>runScript('/bg night.png')),'');
  assert.strictEqual(await page.evaluate(()=>runScript('/bg')),'night.png');
  const backgroundIsolation = await page.evaluate(async()=>{
    const first=getChar(), second=parseCard({name:'Second background',extensions:{}});
    second.id='background-second';const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);second.background_image=canvas.toDataURL();
    D.characters.push(second);D.chats[second.id]={activeSid:'background-session',sessions:[createBlankSession('second','background-session')]};
    const own=currentScriptBackgroundReference(second);
    await saveData();
    const selection=first.selectedBackground;
    first.selectedBackground={charId:'deleted-character',assetId:'missing'};
    getActiveSession(first.id).lockedBackground={charId:'deleted-character',field:'background_image'};
    await applyCharBackground(first);
    const fallback=currentScriptBackgroundReference(first),cleaned=!first.selectedBackground&&!getActiveSession(first.id).lockedBackground;
    first.selectedBackground=selection;await saveData('characters');await applyCharBackground(first);
    return {own,fallback,cleaned,global:D.settings.selectedBackground||null};
  });
  assert.deepStrictEqual(backgroundIsolation,{own:{charId:'background-second',field:'background_image'},fallback:{charId:'script-ui-char',field:'background_image'},cleaned:true,global:null});
  await page.evaluate(()=>runScript('/bglock'));
  assert.ok(await page.evaluate(()=>!!getActiveSession(getChar().id).lockedBackground.assetId));
  await page.evaluate(()=>runScript('/bgcol name=Night'));
  assert.strictEqual(await page.evaluate(()=>runScript('/theme Night')),'');
  assert.strictEqual(await page.evaluate(()=>runScript('/theme')),'Night');
  const gallery=JSON.parse(await page.evaluate(()=>runScript('/lg')));assert.strictEqual(gallery.length,1);assert.ok(gallery[0].startsWith('blob:'));
  await page.evaluate(()=>runScript('/sg'));
  await page.locator('.character-gallery .script-gallery-item img').waitFor();
  await page.screenshot({path:path.join(evidence,'gallery.png')});
  await page.getByRole('button',{name:'完成',exact:true}).last().click();
  await page.evaluate(()=>{window.entityPopupResult=runScript('/char-get field=name return=popup');});
  const entityPopup=page.getByRole('dialog',{name:'脚本结果'});
  await entityPopup.waitFor();
  assert.strictEqual(await entityPopup.locator('.modal-body').textContent(),'图库测试');
  await entityPopup.getByRole('button',{name:'确定',exact:true}).click();
  assert.strictEqual(await page.evaluate(()=>window.entityPopupResult),'');
  await page.evaluate(()=>{window.popupResult=runScript('/pass hello | /popup header=测试 result=true cancelButton=取消');});
  await page.getByRole('button',{name:'确定',exact:true}).last().click();
  assert.strictEqual(await page.evaluate(()=>window.popupResult),'1');
  await page.evaluate(()=>{window.popupResult=runScript('/popup result=true cancelButton=取消 content');});
  await page.keyboard.press('Escape');assert.strictEqual(await page.evaluate(()=>window.popupResult),'');
  await page.evaluate(async()=>{await runScript('/inject id=ui-list position=chat depth=2 role=user scan=true 浏览器注入');window.listInjectResult=runScript('/listinjects');});
  const injectionDialog=page.getByRole('dialog');await injectionDialog.waitFor();
  assert.strictEqual(await injectionDialog.locator('h2').textContent(),'脚本注入');
  assert.strictEqual(await injectionDialog.locator('code').textContent(),'浏览器注入');
  await injectionDialog.getByRole('button',{name:'确定',exact:true}).click();
  assert.strictEqual(await page.evaluate(()=>window.listInjectResult),'');
  await page.evaluate(()=>runScript('/flushinject ui-list'));
  await page.evaluate(()=>{window.iconResult=runScript('/pick-icon');});
  await page.locator('[data-icon="fa-book"]').click();assert.strictEqual(await page.evaluate(()=>window.iconResult),'fa-book');
  const loader=await page.evaluate(()=>runScript('/loader-show message=正在测试 onHide={: /setvar key=hidden yes :}'));
  await page.locator('.script-loader-panel').waitFor();
  assert.ok(await page.locator('#script-loader-surface').evaluate(node=>node.classList.contains('blocking')));
  await page.screenshot({path:path.join(evidence,'loader.png')});
  assert.strictEqual(await page.evaluate(id=>runScript('/loader-hide handle='+id),loader),'true');
  assert.strictEqual(await page.evaluate(()=>getActiveSession(getChar().id).stscriptVars.hidden),'yes');
  assert.strictEqual(await page.evaluate(()=>runScript('/loader-wrap blocking=false {: /pass complete :}')),'complete');
  const stopped=await page.evaluate(()=>runScript('/loader-show onStop={: /setvar key=stopped yes :}'));
  assert.strictEqual(await page.evaluate(id=>runScript('/loader-stop handle='+id),stopped),'true');
  assert.strictEqual(await page.evaluate(()=>getActiveSession(getChar().id).stscriptVars.stopped),'yes');
  assert.strictEqual(await page.evaluate(async()=>{let cancelled=false;const id=scriptLoaderShow({blocking:false,cancel:()=>{cancelled=true;}});await scriptLoaderFinish(id,true);return cancelled;}),true);
  assert.deepStrictEqual(await page.evaluate(async()=>{
    const before=getActiveSession(getChar().id).stscriptVars.hidden;
    const id=await runScript('/loader-show onStop={: /setvar key=stopOnly yes :} onHide={: /setvar key=hidden wrong :}');
    const result=await runScript('/loader-stop handle='+id);
    const hidden=getActiveSession(getChar().id).stscriptVars.hidden;
    const throwing=new StscriptClosure();throwing.getCopy=()=>({execute:async()=>{throw new Error('handler');}});
    const failed=scriptLoaderShow({onHide:throwing});const returns=await scriptLoaderFinish(failed,false);
    const original=scriptLoaderShow({onHide:throwing});let originalError='';try {try {throw new Error('original');} finally {await scriptLoaderFinish(original,false);}}catch(e){originalError=e.message;}
    return {result,unchanged:before===hidden,returns,originalError};
  }),{result:'true',unchanged:true,returns:true,originalError:'original'});
  const beep = await page.evaluate(async () => {
    const original = window.AudioContext;
    let started = 0, closed = 0;
    window.AudioContext = class {
      currentTime = 0;
      destination = {};
      async resume() {}
      createOscillator() { return {frequency: {}, connect() {}, disconnect() {}, start() {started++;}, stop() {this.onended();}}; }
      createGain() { return {gain: {setValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}}; }
      async close() {closed++;}
    };
    try { return {pipe: await runScript('/beep | /setvar key=afterBeep continued | /getvar afterBeep'), started, closed}; }
    finally {window.AudioContext = original;}
  });
  assert.deepStrictEqual(beep, {pipe: 'continued', started: 1, closed: 1});
  await page.evaluate(()=>runScript('/css-var varname=--script-color red'));
  assert.strictEqual(await page.locator('#chat-messages').evaluate(node=>node.style.getPropertyValue('--script-color')),'red');
  await page.evaluate(()=>runScript('/panels'));assert.strictEqual(await page.locator('#sidebar').getAttribute('aria-hidden'),'false');
  await page.evaluate(()=>runScript('/togglepanels'));assert.strictEqual(await page.locator('#sidebar').getAttribute('aria-hidden'),'true');
  await page.evaluate(()=>{const sess=getActiveSession(getChar().id);sess.msgs=Array.from({length:220},(_,i)=>({role:i%2?'assistant':'user',content:'历史'+i,seq:i+1}));renderChat();});
  assert.strictEqual(await page.locator('[data-msg-idx="0"]').count(),0);
  await page.evaluate(()=>runScript('/chat-render'));await page.locator('[data-msg-idx="0"]').waitFor();
  await page.evaluate(()=>runScript('/chat-jump 0'));
  const apiRequests=[];
  await page.route('**/chat-api/**',async route=>{apiRequests.push(route.request().postDataJSON());await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'蓝色图片'},finish_reason:'stop'}]})});});
  await page.evaluate(async()=>{
    D.settings.providers=[{id:'chat-provider',name:'生成测试',apiUrl:location.origin+'/chat-api',apiKey:'synthetic-test-key',model:'chat-model',enabled:true}];D.settings.activeProviderId='chat-provider';
    D.settings.modelPresets=[{id:'chat-routes',name:'测试路由',routes:{chat:{providerId:'chat-provider',model:'chat-model'}}}];D.settings.activeModelPresetId='chat-routes';
  });
  await page.evaluate(async()=>{
    await runScript('/inject id=reload-allowed filter={: /return true :} RELOAD_FILTER_ALLOWED');
    await runScript('/inject id=reload-denied filter={: /return false :} RELOAD_FILTER_DENIED');
    await saveData();
  });
  await page.reload();
  await waitForAppReady(page);
  await page.evaluate(()=>{window.runScript=async text=>(await executeStscript(text,{handleParserErrors:false,handleExecutionErrors:false})).pipe;});
  const reloadedFilterPreview=await page.evaluate(async()=>{
    const char=getChar(),session=getActiveSession(char.id),key=hostPromptKey(char.id,session.id,'reload-allowed');
    _hostPromptFilters.clear();
    await runScript('/chat-reload');
    const refreshed=!!_hostPromptFilters.get(key);
    _hostPromptFilters.clear();
    const text=(await buildPresetRoundPreview()).text;
    return {refreshed,allowed:text.includes('RELOAD_FILTER_ALLOWED'),denied:text.includes('RELOAD_FILTER_DENIED')};
  });
  assert.deepStrictEqual(reloadedFilterPreview,{refreshed:true,allowed:true,denied:false});
  assert.strictEqual(await page.evaluate(async()=>{
    const char=getChar(),source=D.characters.find(row=>row.id==='background-second');
    const storedOnly=!!source._media?.background_image&&!source.background_image;
    await runScript('/bg "Second background"');
    const found=char.selectedBackground.charId===source.id;
    source.background_image='';delete source._media;delete source._mediaBlobs;
    delete getActiveSession(char.id).lockedBackground;
    await applyCharBackground(char);
    const fallback=!char.selectedBackground&&currentScriptBackgroundReference(char).charId===char.id;
    await runScript('/bg night.png');await runScript('/bglock');
    return storedOnly&&found&&fallback;
  }),true);
  // A picture chosen by script stays loadable through chat redraws, including a redraw that lands after its
  // URL exists but before palette analysis puts it on a layer; the redraw after another picture replaces it
  // releases it.
  const scriptBackground=await page.evaluate(async()=>{
    const char=getChar(),night=scriptBackgroundAsset(char),analyze=analyzeImagePalette,revoke=URL.revokeObjectURL,revoked=new Set();
    URL.revokeObjectURL=url=>{revoked.add(String(url));revoke.call(URL,url);};
    const shown=()=>(String(document.getElementById('bg-layer-'+_backgroundFront).style.backgroundImage).match(/blob:[^"')]+/)||[])[0]||'';
    const loadable=async url=>{if(!url||revoked.has(url))return false;try{return (await fetch(url)).ok;}catch(_){return false;}};
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=200;const ctx=canvas.getContext('2d');ctx.fillStyle='#b38a4a';ctx.fillRect(0,0,160,200);
    try {
      await runScript('/chat-reload');
      const nightUrl=night.objectUrl,displayed=shown()===nightUrl&&await loadable(nightUrl);
      char.media_assets.push({id:'gallery-day',name:'day.png',kind:'image',mime:'image/png',data_url:canvas.toDataURL()});
      await runScript('/bgunlock');await runScript('/bg day.png');
      renderChat();
      const released=!night.objectUrl&&revoked.has(nightUrl);
      let resume;
      const held=new Promise(resolve=>{window.analyzeImagePalette=(src,callback)=>{resume=()=>analyze(src,callback);resolve(true);};});
      const picking=runScript('/bg night.png');
      const analysing=await Promise.race([held,new Promise(resolve=>setTimeout(resolve,5000,false))]);
      const pendingUrl=night.objectUrl,offLayer=analysing&&shown()!==pendingUrl;
      renderChat();
      if(resume)resume();
      await picking;
      const landed=shown()===pendingUrl&&await loadable(pendingUrl)&&document.documentElement.dataset.background==='image';
      return {displayed,released,offLayer,landed};
    } finally {
      window.analyzeImagePalette=analyze;URL.revokeObjectURL=revoke;
      char.media_assets=char.media_assets.filter(asset=>asset.id!=='gallery-day');
      await runScript('/bglock');
    }
  });
  assert.deepStrictEqual(scriptBackground,{displayed:true,released:true,offLayer:true,landed:true},'脚本背景在聊天重绘时必须保持可加载，被替换后才释放');
  await page.evaluate(()=>{
    switchAppPage('chat');D.settings.showThinking=true;
    const sess=getActiveSession(getChar().id);sess.msgs=[
      {seq:1,role:'user',content:'问题'},
      {seq:2,role:'assistant',content:'回答'},
      {seq:3,role:'assistant',name:'自定义发言名',content:'正文',reasoning:'测试思考'},
    ];sess.nextMessageSeq=4;renderChat();
  });
  await page.evaluate(()=>runScript('/collapse-reasoning'));
  assert.strictEqual(await page.locator('[data-msg-idx="2"] details').getAttribute('open'),null);
  await page.locator('[data-msg-idx="2"] details summary').click();
  await page.waitForFunction(()=>getActiveSession(getChar().id).msgs[2].reasoningCollapsed===false);
  assert.strictEqual(await page.locator('[data-msg-idx="2"] .msg-immersive-head strong').textContent(),'自定义发言名');
  assert.strictEqual(await page.evaluate(()=>runScript('/sysgen return=pipe 描述天气')),'蓝色图片');
  assert.ok(JSON.stringify(apiRequests.at(-1).messages).includes('RELOAD_FILTER_ALLOWED'));
  assert.ok(!JSON.stringify(apiRequests.at(-1).messages).includes('RELOAD_FILTER_DENIED'));
  const sysgenMessage=await page.evaluate(async()=>{
    const returned=JSON.parse(await runScript('/sysgen return=object name=BrowserNarrator 描述天气'));
    const saved=getActiveSession(getChar().id).msgs.at(-1);
    return {returned,same:JSON.stringify(returned)===JSON.stringify(saved)};
  });
  assert.strictEqual(sysgenMessage.same,true);
  assert.strictEqual(sysgenMessage.returned.kind,'stscript-system');
  assert.strictEqual(sysgenMessage.returned.speaker,'BrowserNarrator');
  assert.strictEqual(sysgenMessage.returned.content,'蓝色图片');
  await page.evaluate(()=>saveData());await page.reload();
  await waitForAppReady(page);
  const persisted=await page.evaluate(async()=>({style:D.settings.messageStyle,theme:D.settings.activeBackgroundTheme,lock:!!getActiveSession(getChar().id).lockedBackground,gallery:(await characterGalleryItems(getChar())).map(row=>row.src),background:await resolveScriptBackground(currentScriptBackgroundReference(getChar()))}));
  assert.strictEqual(persisted.style,'bubble');assert.strictEqual(persisted.theme,'Night');assert.strictEqual(persisted.lock,true);assert.strictEqual(persisted.gallery.length,1);assert.ok(persisted.background.startsWith('blob:'));
  assert.deepStrictEqual(pageErrors,[]);
  assert.deepStrictEqual(consoleErrors,[]);
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({device:device.id,commands:true,persistence:true,realHttpTransport:true,pageErrors,screenshots:['gallery.png','loader.png']},null,2));
  console.log(JSON.stringify({uiCommands:true,realPersistence:true,source:path.relative(root,evidence)}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
