'use strict';
// Scripted platform-boundary probe for the same-origin card frontend runtime, run against the real
// Android WebView on the emulator. It proves that a srcdoc iframe created from the packaged file page
// executes, reaches its true parent and browser storage, receives globals, and uses direct host calls.
// Driven by tools/probes/run_android_emulator_smoke.ps1, which forwards the WebView devtools socket.
const port = Number(process.argv[2] || 9222);
const endpoint = `http://127.0.0.1:${port}`;

async function pageTarget() {
  const response = await fetch(`${endpoint}/json/list`, {signal:AbortSignal.timeout(5000)});
  const targets = await response.json();
  const page = targets.find(target => target.type === 'page' && String(target.url || '').startsWith('file:///android_asset/'));
  if (!page) throw new Error('未找到 file:///android_asset 页面目标：' + JSON.stringify(targets.map(t => t.url)));
  return page;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let seq = 0;
    const openTimer = setTimeout(() => {
      reject(new Error('WebView CDP connection timeout'));
      socket.close();
    }, 10000);
    socket.addEventListener('open', () => {
      clearTimeout(openTimer);
      resolve({
      call(method, params) {
        if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('WebView CDP connection closed'));
        const id = ++seq;
        return new Promise((ok, fail) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            fail(new Error('CDP timeout: ' + method));
          }, 120000);
          pending.set(id, {ok, fail, timer});
          socket.send(JSON.stringify({id, method, params: params || {}}));
        });
      },
      close() { socket.close(); }
      });
    });
    socket.addEventListener('error', () => {
      clearTimeout(openTimer);
      reject(new Error('无法连接 WebView 调试端口 ' + url));
    });
    socket.addEventListener('close', () => {
      clearTimeout(openTimer);
      reject(new Error('WebView CDP connection closed'));
      for (const slot of pending.values()) {
        clearTimeout(slot.timer);
        slot.fail(new Error('WebView CDP connection closed'));
      }
      pending.clear();
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      const slot = pending.get(message.id);
      if (!slot) return;
      clearTimeout(slot.timer);
      pending.delete(message.id);
      if (message.error) slot.fail(new Error(message.error.message || 'CDP 调用失败'));
      else slot.ok(message.result);
    });
  });
}

// Runs inside the real WebView page and uses the shipped mount/document/runtime path.
const PROBE = function () {
  return new Promise(resolve => {
    if (typeof cardFrontendDocument !== 'function' || typeof cardFrontendFrameBody !== 'function') {
      resolve({loaded: false});
      return;
    }
    const suffix=Date.now().toString(36),charId='runtime-probe-'+suffix,sessionId='runtime-session-'+suffix,key=[charId,sessionId,0,'probe'].join('|');
    const previousChars=D.characters,previousChats=D.chats,previousCurrent=D.currentCharId,previousStorage=localStorage.getItem('yeyu-runtime-probe'),previousParent=window.__yeyuRuntimeProbeParent;
    const card = [
      '<div id="probe">初始</div>',
      '<div style="height:120px"></div>',
      '<script>',
      'localStorage.setItem("yeyu-runtime-probe", "child-write");',
      'parent.__yeyuRuntimeProbeParent = parent.document === parent.window.document ? "real-parent" : "wrong-parent";',
      'window.__yeyuRuntimeProbe={globals:["TavernHelper","SillyTavern","Mvu","toastr","z","_","YAML","showdown","EjsTemplate"].filter(function(name){return typeof window[name]!=="undefined";}),parentStorage:parent.localStorage.getItem("yeyu-runtime-probe"),directCall:false};',
      'var rows=getChatMessages(0);window.__yeyuRuntimeProbe.directCall=Array.isArray(rows)&&rows.length===1;document.getElementById("probe").textContent="done";',
      '<\/script>'
    ].join('\n');
    const char={id:charId,name:'运行时探针',scriptsEnabled:true,extensions:{yeyu:{componentImportMode:'full'}}},session=createBlankSession('同源运行时探针',sessionId);session.msgs.push({role:'assistant',content:'probe',seq:1});session.nextMessageSeq=2;
    D.characters=previousChars.concat([char]);D.chats=Object.assign({},previousChats,{[charId]:{activeSid:sessionId,sessions:[session]}});D.currentCharId=charId;
    localStorage.setItem('yeyu-runtime-probe','host-seed');
    const node=document.createElement('div');node.className='yeyu-card-frontend';node.setAttribute('data-frontend-key',key);node.innerHTML='<div class="yeyu-card-frontend-slot"></div><div class="yeyu-card-frontend-note"></div>';node.style.cssText='position:fixed;left:-10000px;top:0;width:320px';document.body.appendChild(node);_cardFrontendSource.set(key,{html:card,owner:{charId:charId,sessionId:sessionId,messageIndex:0}});
    // Public CDN latency must not block this platform probe; install deterministic data-URL stubs.
    const messageResources = CARD_FRONTEND_MESSAGE_RESOURCES.splice(0);
    const predefineResources = CARD_FRONTEND_PREDEFINE_RESOURCES.splice(0);
    CARD_FRONTEND_PREDEFINE_RESOURCES.push({kind:'script',url:'data:text/javascript,window.showdown%3D%7B%7D'});
    try{cardFrontendMount(char,node,key);}finally{CARD_FRONTEND_MESSAGE_RESOURCES.splice(0);CARD_FRONTEND_PREDEFINE_RESOURCES.splice(0);CARD_FRONTEND_MESSAGE_RESOURCES.push(...messageResources);CARD_FRONTEND_PREDEFINE_RESOURCES.push(...predefineResources);}

    function finish() {
      const live=_cardFrontendLive.get(key),frame=live&&live.frame,probe=frame&&frame.contentWindow&&frame.contentWindow.__yeyuRuntimeProbe||{},result={
        loaded:true,userAgent:navigator.userAgent,pageUrl:String(location.href),sandbox:frame&&frame.hasAttribute('sandbox'),allow:frame&&frame.hasAttribute('allow'),referrerPolicy:frame&&frame.hasAttribute('referrerpolicy'),hostReadsFrameDocument:!!(frame&&frame.contentDocument),childReadsRealParent:window.__yeyuRuntimeProbeParent,parentStorage:probe.parentStorage,hostStorage:localStorage.getItem('yeyu-runtime-probe'),globals:probe.globals||[],directCall:probe.directCall===true,height:Number(live&&live.appliedHeight)||0
      };
      cardFrontendDispose(key);_cardFrontendSource.delete(key);node.remove();D.characters=previousChars;D.chats=previousChats;D.currentCharId=previousCurrent;if(previousStorage==null)localStorage.removeItem('yeyu-runtime-probe');else localStorage.setItem('yeyu-runtime-probe',previousStorage);if(previousParent===undefined)delete window.__yeyuRuntimeProbeParent;else window.__yeyuRuntimeProbeParent=previousParent;
      resolve({
        ...result
      });
    }

    const started = Date.now();
    const timer = setInterval(() => {
      const live=_cardFrontendLive.get(key),probe=live&&live.frame&&live.frame.contentWindow&&live.frame.contentWindow.__yeyuRuntimeProbe;
      if ((probe&&probe.directCall&&live.appliedHeight>0) || Date.now() - started > 15000) {
        clearInterval(timer);
        finish();
      }
    }, 200);
  });
};

// Risu has its own scriptless display frames and Worker/Wasm engine. Exercise the shipped paths
// on the packaged file origin; the smoke runner owns and clears this emulator's synthetic data.
const RISU_PROBE = async function () {
  const steps = [], calls = [], pending = new Set();
  const snapshot = () => {
    const frame = document.querySelector('.risu-display-frame');
    return {generationState:_generationState,frameReady:!!frame?.parentElement?.hasAttribute('data-risu-ready'),
      frameConnected:!!frame?.isConnected,buttonPresent:!!frame?.contentDocument?.querySelector('[risu-btn]')};
  };
  const start = (rows, label) => {
    const row = {step:label,before:snapshot(),returnValue:'pending',elapsedMs:0};
    rows.push(row);
    const entry = {row,started:performance.now()};
    pending.add(entry);
    return entry;
  };
  const finish = (entry, value, error) => {
    pending.delete(entry);
    Object.assign(entry.row, {after:snapshot(),returnValue:value === undefined ? 'undefined' : value,
      elapsedMs:Math.round((performance.now()-entry.started)*100)/100});
    if (error) entry.row.error = String(error.message || error);
  };
  const step = async (label, action) => {
    const entry = start(steps, label);
    try { const result = await action(); finish(entry,result); return result; }
    catch(error) { finish(entry,'threw',error); throw error; }
  };
  const originalManual = runRisuManualTrigger, originalButton = runRisuButtonTrigger;
  const observe = (name, original) => function (...args) {
    const entry = start(calls, name + ':' + String(args[0]));
    try {
      const result = original.apply(this,args);
      // Observe settlement without substituting the application's Promise or gating the call.
      Promise.resolve(result).then(value => finish(entry,value), error => finish(entry,'rejected',error));
      return result;
    } catch(error) { finish(entry,'threw',error); throw error; }
  };
  runRisuManualTrigger = observe('manual', originalManual);
  runRisuButtonTrigger = observe('button', originalButton);
  const wait = (predicate, label) => step(label, async () => {
    const deadline = Date.now() + 20000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Risu platform timeout: ' + label);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  });
  const check = (value, label) => {
    const entry = start(steps,label);
    finish(entry,value);
    if (!value) throw new Error('Risu platform assertion: ' + label);
  };
  try {
  closeModal('settings-modal');
  D = defaults();
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const char = {
    id: 'risu-platform-probe', name: 'Risu 平台夹具', avatar_image: pixel,
    extensions: {risuai: {
      backgroundHTML: '<style>body{background:rgb(12,34,56)}</style><div>平台背景</div>',
      customScripts: [{type: 'editdisplay', in: 'PANEL', out: '<details><summary>展开</summary><div style="height:300px">可收起内容</div></details><img id="probe-asset" src="{{raw::stage.png}}"><button risu-trigger="increment">触发</button><button risu-btn="android-button">Lua</button><script>parent.__risuProbeScript=true</script>'}],
      triggerscript: [
        {type: 'manual', comment: 'increment', effect: [{type:'setvar', var:'click', operator:'=', value:'ok'}]},
        {type: 'manual', comment: 'lua-host', effect: [{type:'triggerlua', code: "platformLua=async(function(id) setChatVar(id,'lua',cbs('{{upper::android}}')); setChatVar(id,'tokens',tostring(getTokens(id,'你好 hello 😀'):await())); setChatVar(id,'dom',tostring(type(document))) end)\nfunction onButtonClick(id,value) setChatVar(id,'button',value) return false end"}]}
      ]
    }},
    media_assets: [{id:'stage',name:'stage.png',kind:'ccv3_asset',assetType:'x-risu-asset',originalUri:'__asset:0',mime:'image/png',status:'ready',data_url:pixel}]
  };
  const session = createBlankSession('Risu 平台验证', 'risu-platform-session');
  session.greetingChosen = true; session.creatorNotesSeen = true;
  session.msgs = [{role:'assistant',content:'PANEL',seq:1,time:Date.now()}]; session.nextMessageSeq = 2;
  session.macroVars = {click:'ST_UNCHANGED'};
  D.characters = [char]; D.currentCharId = char.id;
  D.chats = {[char.id]: {sessions:[session],activeSid:session.id}};
  switchAppPage('chat'); updateChatUI(); renderChat();
  const frame = () => document.querySelector('.risu-display-frame');
  await wait(() => frame()?.parentElement?.hasAttribute('data-risu-ready') && frame()?.contentDocument?.querySelector('#probe-asset')?.naturalWidth > 0, 'display/media');
  const doc = frame().contentDocument;
  const sandbox = frame().getAttribute('sandbox') || '';
  check(sandbox.includes('allow-same-origin') && sandbox.includes('allow-forms') && !sandbox.includes('allow-scripts'), 'scriptless sandbox');
  check(!doc.querySelector('script') && !window.__risuProbeScript, 'card script remains inert');
  check(document.body.classList.contains('risu-character'), 'Risu body state');
  await wait(() => document.querySelector('.risu-background-frame')?.contentDocument?.body?.textContent.includes('平台背景'), 'background');
  const initialHeight = frame().getBoundingClientRect().height;
  doc.querySelector('summary').click();
  await wait(() => frame().getBoundingClientRect().height > initialHeight + 200, 'expand resize');
  const expandedHeight = frame().getBoundingClientRect().height;
  doc.querySelector('summary').click();
  await wait(() => frame().getBoundingClientRect().height < expandedHeight - 200, 'collapse resize');
  doc.querySelector('[risu-trigger]').click();
  // The transaction publishes variables before awaiting saveData; only idle permits the next action.
  await wait(() => session.risu?.scriptstate?.$click === 'ok' && _generationState === 'idle', 'manual trigger');
  check(await runRisuManualTrigger('platformLua'), 'Lua Worker execution');
  check(session.risu.scriptstate.$lua === 'ANDROID', 'Lua CBS host RPC');
  check(Number(session.risu.scriptstate.$tokens) === estTokens('你好 hello 😀'), 'Lua token estimate RPC');
  check(session.risu.scriptstate.$dom === 'nil', 'Lua does not expose DOM');
  // renderChat replaces the frame: its DOM may exist before the load callback binds click handlers.
  await wait(() => _generationState === 'idle' && frame()?.parentElement?.hasAttribute('data-risu-ready') && frame()?.contentDocument?.querySelector('[risu-btn]'), 'display after trigger');
  frame().contentDocument.querySelector('[risu-btn]').click();
  await wait(() => session.risu.scriptstate.$button === 'android-button' && _generationState === 'idle', 'Lua button');
  await saveData(['characters','sessions','meta'], {urgent:true});
  const persisted = (await YeyuRepository.load()).data.chats[char.id].sessions.find(row => row.id === session.id);
  check(persisted.risu.scriptstate.$lua === 'ANDROID' && persisted.risu.scriptstate.$button === 'android-button', 'IndexedDB persistence');
  check(session.macroVars.click === 'ST_UNCHANGED', 'ST variables isolated');
  return {ok:true,steps,calls,pageUrl:location.href,userAgent:navigator.userAgent,luaWorkerWasm:true,luaCBS:true,getTokensEstimate:true,luaDomAbsent:true,scriptlessDisplay:true,storedAssetLoaded:true,background:true,expandCollapse:true,manualTrigger:true,luaButton:true,indexedDB:true,stVariablesIsolated:true,provider:'none; synthetic card'};
  } catch(error) {
    pending.forEach(entry => { entry.row.elapsedMs = Math.round((performance.now()-entry.started)*100)/100; });
    return {ok:false,error:String(error.message || error),steps,calls,current:snapshot()};
  } finally {
    runRisuManualTrigger = originalManual;
    runRisuButtonTrigger = originalButton;
  }
};

async function probeNativeImageDownload(client) {
  const http = require('http'), assert = require('assert');
  const created = await client.call('Runtime.evaluate', {expression: `(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    canvas.getContext('2d').fillRect(0,0,512,512);return canvas.toDataURL('image/png');
  })()`, returnByValue:true});
  const bytes=Buffer.from(created.result.value.split(',')[1],'base64');
  const requests=[];
  const server=http.createServer((request,response)=>{
    requests.push({path:request.url,userAgent:request.headers['user-agent']||''});
    response.writeHead(200,{'Content-Type':'image/png'}).end(request.url==='/valid.png'?bytes:bytes.subarray(0,64));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fixturePort = server.address().port;
  const adbPath = process.argv[3], serial = process.argv[4];
  const adb = (...args) => require('child_process').execFileSync(adbPath, ['-s', serial, ...args], {encoding:'utf8', timeout:20000, stdio:'pipe'});
  try {
    if (adbPath) {
      assert.match(serial || '', /^emulator-\d+$/, 'Native image fixture requires an emulator');
      adb('reverse', 'tcp:' + fixturePort, 'tcp:' + fixturePort);
    }
    const base='http://'+(adbPath?'127.0.0.1':'10.0.2.2')+':'+fixturePort;
    const evaluated=await client.call('Runtime.evaluate', {expression:`(async()=>{
      const data=await downloadCardImage(${JSON.stringify(base+'/valid.png')});
      const nativeData=await fetchCardImageNative(${JSON.stringify(base+'/valid.png')});
      let rejected=false,rejection='';try{await downloadCardImage(${JSON.stringify(base+'/partial.png')});}catch(error){rejected=true;rejection=String(error.message||error);}
      return {data,nativeData,rejected,rejection,pending:Object.keys(_nativeCardImageRequests).length};
    })()`,awaitPromise:true,returnByValue:true});
    if(evaluated.exceptionDetails)throw new Error('Native image probe failed: '+JSON.stringify({exception:evaluated.exceptionDetails,requests}));
    const result=evaluated.result.value;
    assert(Buffer.from(result.data.split(',')[1],'base64').equals(bytes),'Native image download changed original bytes');
    assert(Buffer.from(result.nativeData.split(',')[1],'base64').equals(bytes),'Native bridge changed original image bytes');
    assert(requests.some(request=>request.path==='/valid.png'&&request.userAgent==='Yeyu/1.0'),'Native bridge did not fetch the valid PNG');
    assert(result.rejected,'Native image download accepted an incomplete PNG');
    assert.strictEqual(result.pending,0);
    return {originalBytes:true,nativeBridgeOriginalBytes:true,partialRejected:true,partialRejection:result.rejection,privateHost:true,customPort:true,pending:0,requests};
  } finally {
    if (adbPath) adb('reverse', '--remove', 'tcp:' + fixturePort);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}

(async () => {
  const target = await pageTarget();
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    const ready = await client.call('Runtime.evaluate', {
      expression: `(async()=>{const deadline=Date.now()+30000;
        while(!(typeof D==='object'&&D!==null&&typeof _streamDraftsLoaded!=='undefined'&&_streamDraftsLoaded===true)){
          if(Date.now()>deadline)throw new Error('App readiness timeout');
          await new Promise(resolve=>setTimeout(resolve,100));
        }return true;})()`, awaitPromise:true, returnByValue:true
    });
    if (ready.exceptionDetails) throw new Error('App readiness failed: ' + JSON.stringify(ready.exceptionDetails));
    const evaluated = await client.call('Runtime.evaluate', {
      expression: '(' + PROBE.toString() + ')()',
      awaitPromise: true,
      returnByValue: true
    });
    if (evaluated.exceptionDetails) throw new Error('探针执行失败：' + JSON.stringify(evaluated.exceptionDetails));
    const result = evaluated.result && evaluated.result.value;
    if (!result || result.loaded !== true) throw new Error('页面里没有卡片前端模块，探针无法执行');
    const failures = [];
    if (result.sandbox||result.allow||result.referrerPolicy) failures.push('iframe 仍带有沙箱或能力属性');
    if (result.hostReadsFrameDocument !== true) failures.push('宿主不能读取同源子页文档');
    if (result.childReadsRealParent !== 'real-parent') failures.push('子页没有读到真实 parent.document');
    if (result.parentStorage !== 'child-write'||result.hostStorage !== 'child-write') failures.push('子页与宿主没有共享真实 localStorage');
    const expected=['TavernHelper','SillyTavern','Mvu','toastr','z','_','YAML','showdown','EjsTemplate'];if(JSON.stringify(result.globals)!==JSON.stringify(expected))failures.push('预定义全局不完整：'+JSON.stringify(result.globals));
    if (result.directCall !== true) failures.push('getChatMessages 没有通过同源直连宿主');
    if (!(result.height>0)) failures.push('子页没有完成高度同步');
    if (failures.length) {
      console.error(JSON.stringify({ok: false, failures, result}, null, 2));
      process.exit(1);
    }
    const risuEvaluated = await client.call('Runtime.evaluate', {
      expression: '(' + RISU_PROBE.toString() + ')()', awaitPromise: true, returnByValue: true
    });
    if (risuEvaluated.exceptionDetails) throw new Error('Risu 平台探针失败：' + JSON.stringify(risuEvaluated.exceptionDetails));
    const risu = risuEvaluated.result && risuEvaluated.result.value;
    const tracePath = require('path').resolve(__dirname, '../../.tmp/android-emulator-smoke/risu-probe-steps.json');
    require('fs').mkdirSync(require('path').dirname(tracePath), {recursive:true});
    require('fs').writeFileSync(tracePath, JSON.stringify(risu, null, 2) + '\n');
    if (!risu || !risu.ok) throw new Error('Risu 平台探针未完成：' + JSON.stringify(risu));
    const nativeImages=await probeNativeImageDownload(client);
    const nativeLifecycle = process.argv.includes('--native-lifecycle')
      ? await require('./android_native_lifecycle_probe')({client, connect, pageTarget, adbPath:process.argv[3], serial:process.argv[4]})
      : undefined;
    console.log(JSON.stringify({ok: true, ...result, risu, nativeImages, nativeLifecycle}, null, 2));
  } finally {
    client.close();
  }
})().catch(error => { console.error(String(error && error.stack || error)); process.exit(1); });
