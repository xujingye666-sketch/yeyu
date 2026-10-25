/* global __char, __session, __sameOriginKey, __sameOriginMessages -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';

const assert=require('assert'),path=require('path');
const {createAssetServer, loadPlaywright,listenOnBrowserSafePort,resolveEdgeExecutable} = require('./source');
const {waitForAppReady}=require('./helpers/app-ready');
const root=path.resolve(__dirname,'../..'),assets=path.join(root,'app/src/main/assets');

(async()=>{
  const server=createAssetServer(assets),port=await listenOnBrowserSafePort(server),origin=`http://127.0.0.1:${port}`;
  const browser=await loadPlaywright().chromium.launch({headless:true,executablePath:resolveEdgeExecutable()}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1}),routes=[];
  // CARD_FRONTEND_PREDEFINE_RESOURCES now serves showdown from this same local asset server rather than
  // jsdelivr; delaying it here keeps exercising the wait-for-slow-predefined-dependency ordering this test
  // checks (globals must not appear until every predefine/message resource, including a deliberately slow
  // one, has actually finished loading).
  await context.route('**/js/vendor/showdown-2.1.0.min.js',async route=>{const url=route.request().url(),started=Date.now();await new Promise(resolve=>setTimeout(resolve,120));await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:'window.showdown={Converter:function(){}};'});routes.push({url,status:200,ms:Date.now()-started});});
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js',async route=>{const url=route.request().url(),started=Date.now();await new Promise(resolve=>setTimeout(resolve,160));await route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:''});routes.push({url,status:200,ms:Date.now()-started});});
  const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[],requestFailures=[],consoleErrors=[];page.on('pageerror',error=>errors.push(String(error&&error.stack||error)));page.on('requestfailed',request=>requestFailures.push({url:request.url(),error:request.failure()&&request.failure().errorText}));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  try{
    await page.goto(`${origin}/index.html`,{waitUntil:'load'});await waitForAppReady(page);
    await page.evaluate(()=>{
      window.__sameOriginMessages=0;window.addEventListener('message',()=>{window.__sameOriginMessages++;});
      const char=parseCard({name:'同源运行时',first_mes:'开场'});char.id='same-origin-runtime';setPreparedComponentMode(char,'basic');setCardScriptsEnabled(char,true);
      const session=createBlankSession('同源测试','same-origin-session');session.msgs.push({role:'assistant',content:'宿主消息',seq:1});session.nextMessageSeq=2;
      D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};window.__char=char;window.__session=session;
      localStorage.setItem('same-origin-shared','host-seed');
      const owner={charId:char.id,sessionId:session.id,messageIndex:0},key=[char.id,session.id,0,'same-origin'].join('|'),html='<div id="runtime-card" style="height:180px"></div><script>var presetMembers=["isPresetNormalPrompt","isPresetSystemPrompt","isPresetPlaceholderPrompt","default_preset","getPresetNames","getLoadedPresetName","loadPreset","createPreset","createOrReplacePreset","deletePreset","renamePreset","getPreset","replacePreset","updatePresetWith","setPreset"];window.__sameOriginRuntime={parentDom:parent.document===parent.window.document&&!!parent.document.getElementById("app"),storageBefore:localStorage.getItem("same-origin-shared"),globals:["TavernHelper","SillyTavern","Mvu","toastr","z","_","YAML","showdown","EjsTemplate"].filter(function(name){return typeof window[name]!=="undefined";}),presetGlobals:presetMembers.filter(function(name){return name==="default_preset"?window[name]&&typeof window[name]==="object":typeof window[name]==="function";}),presetHelper:presetMembers.filter(function(name){return name==="default_preset"?TavernHelper[name]&&typeof TavernHelper[name]==="object":typeof TavernHelper[name]==="function";})};localStorage.setItem("same-origin-shared","child-write");window.__sameOriginRuntime.directRows=getChatMessages(0).length;<\/script>';
      _cardFrontendSource.set(key,{html,owner});const node=document.createElement('div');node.className='yeyu-card-frontend';node.setAttribute('data-frontend-key',key);node.innerHTML='<div class="yeyu-card-frontend-slot"></div><div class="yeyu-card-frontend-note"></div>';document.body.appendChild(node);cardFrontendMount(char,node,key);window.__sameOriginKey=key;
    });
    const readWaitState=()=>page.evaluate(()=>{const live=_cardFrontendLive.get(__sameOriginKey),frame=live&&live.frame;let probe=null,frameError='';try{probe=frame&&frame.contentWindow.__sameOriginRuntime;}catch(error){frameError=String(error&&error.stack||error);}return{currentCharId:D&&D.currentCharId,key:__sameOriginKey,live:!!live,owner:live&&live.owner,frameConnected:!!(frame&&frame.isConnected),frameUrl:frame&&frame.contentWindow.location.href,frameReadyState:frame&&frame.contentDocument&&frame.contentDocument.readyState,frameError,probe:probe&&{directRows:probe.directRows,globals:probe.globals,presetGlobals:probe.presetGlobals,presetHelper:probe.presetHelper},heightReady:live&&live.heightReady,height:frame&&frame.getBoundingClientRect().height,contentHeight:live&&live.contentHeight,appliedHeight:live&&live.appliedHeight,note:live&&live.node.querySelector('.yeyu-card-frontend-note').textContent};});
    try{await page.waitForFunction(()=>{const live=_cardFrontendLive.get(__sameOriginKey),probe=live&&live.frame.contentWindow.__sameOriginRuntime;return probe&&probe.directRows===1&&live.heightReady&&live.frame.getBoundingClientRect().height>0;});}catch(error){throw new Error('same-origin runtime wait failed: '+JSON.stringify({state:await readWaitState().catch(snapshotError=>({snapshotError:String(snapshotError)})),routes,requestFailures,consoleErrors,pageErrors:errors,cause:String(error&&error.message||error)}));}
    const messageState=await page.evaluate(()=>{const live=_cardFrontendLive.get(__sameOriginKey),frame=live.frame,probe=frame.contentWindow.__sameOriginRuntime;return{sandbox:frame.hasAttribute('sandbox'),allow:frame.hasAttribute('allow'),allowFullscreen:frame.hasAttribute('allowfullscreen'),referrer:frame.hasAttribute('referrerpolicy'),hostCanRead:frame.contentDocument===frame.contentWindow.document,parentDom:probe.parentDom,storageBefore:probe.storageBefore,storageAfter:localStorage.getItem('same-origin-shared'),globals:probe.globals,presetGlobals:probe.presetGlobals,presetHelper:probe.presetHelper,directRows:probe.directRows,messages:__sameOriginMessages,srcdocHasHostMessage:frame.srcdoc.includes('宿主消息')};});
    assert.deepStrictEqual({sandbox:messageState.sandbox,allow:messageState.allow,allowFullscreen:messageState.allowFullscreen,referrer:messageState.referrer},{sandbox:false,allow:false,allowFullscreen:false,referrer:false});
    assert.strictEqual(messageState.hostCanRead,true);assert.strictEqual(messageState.parentDom,true);assert.strictEqual(messageState.storageBefore,'host-seed');assert.strictEqual(messageState.storageAfter,'child-write');
    assert.deepStrictEqual(messageState.globals,['TavernHelper','SillyTavern','Mvu','toastr','z','_','YAML','showdown','EjsTemplate']);assert.strictEqual(messageState.presetGlobals.length,15);assert.strictEqual(messageState.presetHelper.length,15);assert.strictEqual(messageState.directRows,1);assert.strictEqual(messageState.messages,0,'卡片运行时不得再用 postMessage RPC');assert.strictEqual(messageState.srcdocHasHostMessage,false,'宿主数据不得序列化进 srcdoc');
    const ejsState=await page.evaluate(async()=>{const frame=_cardFrontendLive.get(__sameOriginKey).frame.contentWindow,methods=['evalTemplate','prepareContext','getSyntaxErrorInfo','setFeatures','allVariables','saveVariables','resetFeatures','refreshWorldInfo','parseJSON','jsonPatch','getFeatures','compileTemplate'],result=await frame.EjsTemplate.evalTemplate('value=<%= value %>',{value:1});return{methods:methods.filter(name=>typeof frame.EjsTemplate[name]==='function'),defines:'defines' in frame.EjsTemplate,initialVariables:'initialVariables' in frame.EjsTemplate,finalization:'finalization' in frame.EjsTemplate,result,shared:frame.EjsTemplate===window.EjsTemplate};});
    assert.deepStrictEqual(ejsState.methods,['evalTemplate','prepareContext','getSyntaxErrorInfo','setFeatures','allVariables','saveVariables','resetFeatures','refreshWorldInfo','parseJSON','jsonPatch','getFeatures','compileTemplate']);assert.deepStrictEqual({defines:ejsState.defines,initialVariables:ejsState.initialVariables,finalization:ejsState.finalization},{defines:true,initialVariables:true,finalization:true});assert.strictEqual(ejsState.result,'value=1');assert.strictEqual(ejsState.shared,true);

    await page.evaluate(()=>cardFrontendDispose(__sameOriginKey));

    await page.evaluate(()=>{
      const script='window.__sameOriginLibraryGlobals=["TavernHelper","SillyTavern","Mvu","toastr","z","_","YAML","showdown","EjsTemplate"].filter(name=>typeof window[name]!=="undefined");parent.__sameOriginOwnedGlobal="owned";const node=parent.document.createElement("div");node.id="same-origin-owned-node";parent.document.body.appendChild(node);const tree=document.createElement("div");document.body.appendChild(tree);tree.innerHTML="<div id=same-origin-inner-node></div>";setTimeout(()=>parent.document.body.appendChild(tree.firstElementChild),0);const clone=node.cloneNode(true);clone.id="same-origin-clone-node";parent.document.body.appendChild(clone);';
      const scan={active:[{id:'owner',name:'生命周期',info:'',button:{},content:script}]};window.__sameOriginLibrary=cardScriptLibraryMount(__char,scan,'same-origin-library');
    });
    await page.waitForFunction(()=>_cardScriptLibraryLive&&_cardScriptLibraryLive.state==='ready'&&window.__sameOriginOwnedGlobal==='owned'&&document.getElementById('same-origin-owned-node')&&document.getElementById('same-origin-inner-node')&&document.getElementById('same-origin-clone-node'));
    const libraryFrameState=await page.evaluate(()=>({sandbox:_cardScriptLibraryLive.frame.hasAttribute('sandbox'),parentAccess:_cardScriptLibraryLive.frame.contentWindow.parent.document.body===document.body,globals:_cardScriptLibraryLive.frame.contentWindow.__sameOriginLibraryGlobals,tags:['same-origin-owned-node','same-origin-inner-node','same-origin-clone-node'].map(id=>document.getElementById(id).getAttribute('data-yeyu-frontend-owner'))}));
    assert.strictEqual(libraryFrameState.sandbox,false);assert.strictEqual(libraryFrameState.parentAccess,true);assert.deepStrictEqual(libraryFrameState.globals,['TavernHelper','SillyTavern','Mvu','toastr','z','_','YAML','showdown','EjsTemplate']);libraryFrameState.tags.forEach((tag,index)=>assert.match(tag||'',/^yeyu-/,'cleanup tag '+index+': '+JSON.stringify(libraryFrameState.tags)));
    // An awaited listener may call Slash again, but an independent click in that same frame must queue.
    await page.evaluate(()=>{
      const frame=_cardScriptLibraryLive.frame.contentWindow;
      frame.eval(`window.__eventTrace=[];
        eventOn('same_origin_reentrant',async function(){
          await Promise.resolve();
          __eventTrace.push('listener-start');
          const button=document.createElement('button');button.id='event-source-click';button.textContent='click';
          button.addEventListener('click',async function(){
            await Promise.resolve();__eventTrace.push('click-start');
            window.__clickDone=triggerSlash('/setvar key=event_source click').then(()=>__eventTrace.push('click-end'));
            await __clickDone;
          });document.body.appendChild(button);
          await triggerSlash('/setvar key=event_source listener');
          __eventTrace.push('listener-command');
          await new Promise(resolve=>window.__releaseListener=resolve);
          __eventTrace.push(await triggerSlashWithResult('/getvar event_source'));
          window.__lateDone=new Promise(resolve=>setTimeout(async function(){
            await new Promise(release=>window.__releaseLate=release);
            await triggerSlash('/setvar key=event_late ready');resolve();
          },0));
          __eventTrace.push('listener-end');
        });
        eventOn('same_origin_reentrant',function(){
          return Promise.resolve().then(async function(){
            await triggerSlash('/setvar key=event_then ready');
            __eventTrace.push('then-command');
            await new Promise(resolve=>setTimeout(async function(){
              await triggerSlash('/setvar key=event_timer ready');
              __eventTrace.push('timer-command');resolve();
            },0));
          });
        });
        `);
      const owner=stscriptCurrentOwner();
      window.__eventOuter=qrRunTop(async abort=>{
        stscriptBeginRun({owner});
        try{
          await cardFrontendAwaitBroadcastEvent('same_origin_reentrant',[],{stscriptRun:_qrTop});
          frame.__eventTrace.push('outer-end');
        }finally{stscriptEndRun();}
      },new StscriptAbortController(),owner);
      showModalSurface(_cardScriptLibraryLive.shell.id);
    });
    try { await page.waitForFunction(()=>_cardScriptLibraryLive.frame.contentWindow.__eventTrace.includes('listener-command'), null, {timeout:5000}); }
    catch(error) { throw new Error('event reentry wait: '+JSON.stringify(await page.evaluate(()=>({trace:_cardScriptLibraryLive.frame.contentWindow.__eventTrace,sources:Array.from(_cardFrontendEventRuns.keys()),owner:_qrTop&&_qrTop.owner,listeners:_cardFrontendEventListeners.map(row=>row.name),libraryError:_cardScriptLibraryLive.lastError})))+' '+error.message); }
    await page.locator('.yeyu-script-library-frame').contentFrame().locator('#event-source-click').click();
    await page.waitForFunction(()=>_cardScriptLibraryLive.frame.contentWindow.__eventTrace.includes('click-start'));
    assert.deepStrictEqual(await page.evaluate(()=>({trace:_cardScriptLibraryLive.frame.contentWindow.__eventTrace,sources:_cardFrontendEventRuns.size})),
      {trace:['listener-start','listener-command','click-start'],sources:1},'真实点击不能借用尚未结束的监听器来源');
    const reentrant=await page.evaluate(async()=>{
      const frame=_cardScriptLibraryLive.frame.contentWindow;frame.__releaseListener();
      await window.__eventOuter;await frame.__clickDone;
      return {trace:frame.__eventTrace,vars:__session.stscriptVars,sources:_cardFrontendEventRuns.size,nesting:_stscriptVarNest};
    });
    assert.deepStrictEqual(reentrant,{trace:['listener-start','listener-command','click-start','listener','listener-end','then-command','timer-command','outer-end','click-end'],
      vars:{event_source:'click',event_then:'ready',event_timer:'ready'},sources:0,nesting:0},'async、Promise.then与注册的timer监听器可重入，点击串行等待，完成后来源与嵌套层数归零');
    await page.waitForFunction(()=>!!_cardScriptLibraryLive.frame.contentWindow.__releaseLate);
    const late=await page.evaluate(async()=>{
      const frame=_cardScriptLibraryLive.frame.contentWindow;frame.__releaseLate();await frame.__lateDone;
      return {value:__session.stscriptVars.event_late,sources:_cardFrontendEventRuns.size,nesting:_stscriptVarNest,run:_qrTop};
    });
    assert.deepStrictEqual(late,{value:'ready',sources:0,nesting:0,run:null},'来源失效后的timer只能另开正常顶层执行，不能复活旧run');
    const messageReentry=await page.evaluate(async()=>{
      const frame=_cardScriptLibraryLive.frame.contentWindow,paint=renderChat;
      frame.eval(`eventOn(tavern_events.MESSAGE_RECEIVED,async function(){
        await Promise.resolve();await triggerSlash('/setvar key=command_received ready');
      });`);
      // Keep this manually mounted fixture alive; the production renderer disposes an unlisted library.
      renderChat=function(){};
      try{await executeStscriptFromCardFrontend('/sendas 事件消息',_cardScriptLibraryLive.owner);}
      finally{renderChat=paint;}
      return {value:__session.stscriptVars.command_received,sources:_cardFrontendEventRuns.size,nesting:_stscriptVarNest};
    });
    assert.deepStrictEqual(messageReentry,{value:'ready',sources:0,nesting:0},'/sendas真实命令必须等待监听器中的异步Slash完成');
    await page.evaluate(()=>{
      const frame=_cardScriptLibraryLive.frame.contentWindow,owner=stscriptCurrentOwner();
      frame.eval(`eventOn('same_origin_stop',function(){
        return window.__stoppedListenerDone=(async function(){
          await new Promise(resolve=>window.__releaseStoppedListener=resolve);
          try{replaceVariables({stopped_late:'bad'},{type:'chat'});}
          catch(error){window.__stoppedWriteBlocked=error.name==='AbortError';}
        })();
      });`);
      window.__stoppedOuter=qrRunTop(async abort=>{
        stscriptBeginRun({owner});
        try{return await stscriptWithRequestController({_abortController:abort},requestController=>
          cardFrontendAwaitBroadcastEvent('same_origin_stop',[],{stscriptRun:_qrTop,signal:requestController.signal}));}
        finally{stscriptEndRun();}
      },new StscriptAbortController(),owner).then(()=>false,error=>error.name==='AbortError');
    });
    await page.waitForFunction(()=>_cardFrontendEventRuns.size===1);
    const stopped=await page.evaluate(async()=>{
      stopStscriptRun();const canceled=await window.__stoppedOuter;
      const frame=_cardScriptLibraryLive.frame.contentWindow;
      frame.__releaseStoppedListener();await frame.__stoppedListenerDone;
      frame.eval(`insertVariables({stop_independent:'ready'},{type:'chat'});`);
      return {canceled,sources:_cardFrontendEventRuns.size,nesting:_stscriptVarNest,libraryDisposed:!_cardScriptLibraryLive,
        blocked:frame.__stoppedWriteBlocked,independent:__session.stscriptVars.stop_independent,late:__session.stscriptVars.stopped_late||null};
    });
    assert.deepStrictEqual(stopped,{canceled:true,sources:0,nesting:0,libraryDisposed:false,blocked:true,independent:'ready',late:null},'停止必须释放等待、拒绝旧监听器写入，并保留同帧独立调用');
    await page.evaluate(()=>cardScriptLibraryDispose());await page.waitForFunction(()=>!window.__sameOriginOwnedGlobal&&!document.getElementById('same-origin-owned-node')&&!document.getElementById('same-origin-inner-node')&&!document.getElementById('same-origin-clone-node'));
    const fenceSources=await page.evaluate(()=>{
      const frontend=['```','<head><style>body{margin:0}</style></head>','<body><main id="fenced-html-normal">正常 HTML 片段</main><script>document.body.dataset.contract="same-origin"<\/script></body>','```'].join('\n');
      const ordinary=['```yaml','time: night','```','','```text','ordinary code fence','```'].join('\n');
      const session=getActiveSession(__char.id);__char.first_mes=frontend;__char.scriptsEnabled=true;session.msgs=[{seq:1,role:'assistant',content:frontend,opening:true},{seq:2,role:'assistant',content:ordinary}];session.nextMessageSeq=3;renderChat();
      return{frontendSource:session.msgs[0].content===frontend,ordinarySource:session.msgs[1].content===ordinary,frontendSegments:cardFrontendSegments(frontend).length,ordinarySegments:cardFrontendSegments(ordinary).length};
    });
    assert.deepStrictEqual(fenceSources,{frontendSource:true,ordinarySource:true,frontendSegments:1,ordinarySegments:0});
    await page.waitForFunction(()=>document.querySelector('[data-msg-idx="0"] iframe.yeyu-card-frontend-frame')?.contentDocument?.getElementById('fenced-html-normal'));
    const fenceRouting=await page.evaluate(()=>{const first=document.querySelector('[data-msg-idx="0"]'),second=document.querySelector('[data-msg-idx="1"]'),frame=first.querySelector('iframe.yeyu-card-frontend-frame');return{frontendFrames:first.querySelectorAll('iframe.yeyu-card-frontend-frame').length,frontendCode:first.querySelectorAll('pre code').length,html:frame.contentDocument.getElementById('fenced-html-normal').textContent,contract:frame.contentDocument.body.dataset.contract,ordinaryFrames:second.querySelectorAll('iframe.yeyu-card-frontend-frame').length,ordinaryCode:second.querySelectorAll('pre code').length,text:second.textContent};});
    assert.deepStrictEqual({frontendFrames:fenceRouting.frontendFrames,frontendCode:fenceRouting.frontendCode,html:fenceRouting.html,contract:fenceRouting.contract,ordinaryFrames:fenceRouting.ordinaryFrames,ordinaryCode:fenceRouting.ordinaryCode},{frontendFrames:1,frontendCode:0,html:'正常 HTML 片段',contract:'same-origin',ordinaryFrames:0,ordinaryCode:2});assert.match(fenceRouting.text,/ordinary code fence/);
    assert.deepStrictEqual(errors,[],errors.join('\n'));
    console.log(JSON.stringify({stage:'card-frontend-same-origin-runtime',iframeAttributesRemoved:true,realParentDom:true,sharedLocalStorage:true,predefinedGlobals:9,libraryPredefineBeforeScripts:true,ejsHostSingleton:true,directHostCalls:true,postMessageRpc:0,srcdocHostData:false,lifecycleCleanup:true,fencedRouting:true}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error&&error.stack||error);process.exit(1);});
