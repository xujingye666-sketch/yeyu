'use strict';

const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const oracle = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/prompt_template_oracle.json'), 'utf8'));
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  const assetRequest = server.listeners('request')[0], networkCounts = new Map(), postBodies=[];
  server.removeAllListeners('request');
  server.on('request', (request, response) => {
    if (!request.url.startsWith('/ejs-network/')) return assetRequest(request, response);
    const url = new URL(request.url, 'http://fixture.local'), kind = url.pathname.split('/').pop();
    networkCounts.set(kind, (networkCounts.get(kind) || 0) + 1);
    response.setHeader('Cache-Control', 'no-store');
    if(kind === 'init-echo'){let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({method:request.method,header:request.headers['x-ejs'],body}));});return;}
    if(kind === 'constructor-stream'){response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('data: ready\n\n');return;}
    if(kind === 'post'){let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{postBodies.push(body);response.setHeader('Content-Type','text/plain');response.end(request.method+':'+body+':'+request.headers['x-ejs']);});return;}
    if (kind === 'completions') {
      let body=''; request.on('data',chunk=>body+=chunk); request.on('end',()=>{
        const messages=JSON.parse(body).messages;
        networkCounts.set('wireMatchesPreview',messages.some(row=>String(row.content).includes('UI_FETCH:ui:1'))?1:0);
        response.setHeader('Content-Type','text/event-stream');
        response.end('data: '+JSON.stringify({choices:[{delta:{content:'network reply'},finish_reason:null}]})+'\n\n' +
          'data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
      }); return;
    }
    if (kind === 'slow') { response.writeHead(200, {'Content-Type':'text/plain'}); response.flushHeaders();
      request.on('close', () => { networkCounts.set('slowClosed',(networkCounts.get('slowClosed')||0)+1); response.destroy(); }); return; }
    if (kind === 'broken') { response.destroy(); return; }
    if (kind === 'module.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('export const value="MODULE_EFFECT";'); return; }
    if (kind === 'image.png') {
      response.setHeader('Content-Type', 'image/png');
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')); return;
    }
    if (kind === 'stream') response.setHeader('Content-Type', 'text/event-stream');
    else response.setHeader('Content-Type', 'text/plain');
    response.statusCode = kind === 'http-error' ? 418 : 200;
    response.setHeader('X-EJS-Native', 'yes');
    response.end(kind + ':' + networkCounts.get(kind));
  });
  server.on('upgrade', (request, socket) => {
    const accept=crypto.createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    socket.on('data',chunk=>{if((chunk[0]&15)===8)socket.end(Buffer.from([0x88,0]));});
    socket.on('error',()=>{});
  });
  const port = await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  await context.route('https://testingcf.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: route.request().resourceType() === 'stylesheet' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
    body: route.request().url().includes('showdown') ? 'window.showdown={Converter:function(){this.makeHtml=function(value){return String(value||"");};}};' : '',
  }));
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: '',
  }));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  // Normal EJS network use goes through actual browser/server requests, and only completed fetch bodies
  // replay in the same input/round. This is the existing compat contract, not another cache harness.
  const network = await page.evaluate(async () => {
    D = defaults(); D.settings.useMemory = false;
    D.settings.styleAuditEnabled = false; stscriptPromptSettings();
    const char = parseCard({name: 'EJS Network', description:
      '<% const a=await fetch(location.origin+"/ejs-network/value"); const b=await window.fetch(location.origin+"/ejs-network/value"); ' +
      'const nested=await EjsTemplate.prepareContext({}); const c=await nested.globalThis.fetch(location.origin+"/ejs-network/other"); %>' +
      '<%= a instanceof Response %>:<%= a.url.endsWith("/value") %>:<%= a.headers.get("x-ejs-native") %>:' +
      '<%= await a.text() %>|<%= await b.text() %>|<%= await c.clone().text() %>:<%= await c.text() %>'});
    char.id='ejs-network-char';
    const session=createBlankSession('Network', 'ejs-network-session');
    session.msgs=[{role:'user',content:'seed',seq:1}]; session.nextMessageSeq=2;
    D.characters=[char]; D.currentCharId=char.id;
    D.chats={[char.id]:{sessions:[session],activeSid:session.id}};
    const build = (preview, signal, promptSettings) => assembleGenerationPrompt(char, session, session.msgs,
      {mode:'new',messageIndex:session.msgs.length}, {preview,signal,promptSettings});
    const text = result => result.messages.map(row=>row.content).join('\n');
    const captured = async () => {
      const until=Date.now()+5000;
      while(Date.now()<until){const run=_generationPromptRounds.get(session).network;
        if(run && run.entries.filter(Boolean).length===run.run.cursor)return;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      throw new Error('finite fixture body was not captured');
    };
    const originalFetch=window.fetch, originalXhr=window.XMLHttpRequest, localBefore=JSON.stringify(D);
    const first=text(await build(true));
    const repeated=text(await build(true));
    const isolated=JSON.stringify(D)===localBefore;
    const sent=text(await build(false));
    const next=text(await build(true));
    const changed=text(await build(true,undefined,Object.assign({},D.settings,{authorNote:'changed'})));
    const unchangedHost=window.fetch===originalFetch && window.XMLHttpRequest===originalXhr;
    char.description='<%= await (await fetch(location.origin+"/ejs-network/http-error")).text() %>';
    const errorFirst=text(await build(true));
    await captured();
    const errorSend=text(await build(false));
    char.description='<%= await (await fetch(location.origin+"/ejs-network/stream")).text() %>';
    const streamFirst=text(await build(true)),streamAgain=text(await build(true));
    char.description='<%= await import(location.origin+"/ejs-network/module.js") .then(m=>m.value) %>' +
      '<%= await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth);image.onerror=reject;image.src=location.origin+"/ejs-network/image.png?"+Math.random();}) %>' +
      '<%= await new Promise((resolve,reject)=>{const xhr=new window.XMLHttpRequest();xhr.onload=()=>resolve(xhr.responseText);xhr.onerror=reject;xhr.open("GET",location.origin+"/ejs-network/xhr");xhr.send();}) %>';
    const resources=text(await build(true));
    const context=await EjsTemplate.prepareContext({preview:true},0);
    const resourceAgain=await EjsTemplate.evalTemplate(char.description,context);
    char.description='<% const nested=await EjsTemplate.prepareContext({}); const slow=await nested.globalThis.fetch(location.origin+"/ejs-network/slow"); window.__ejsSlowHeaders=true; %><%= await slow.text() %>';
    const abort=new AbortController(), pending=build(true,abort.signal);
    const headersDeadline=Date.now()+5000;
    while(!window.__ejsSlowHeaders && Date.now()<headersDeadline) await new Promise(resolve=>setTimeout(resolve,0));
    if(!window.__ejsSlowHeaders) throw new Error('slow fixture did not reach response headers');
    abort.abort();
    let aborted=false;try {await pending;}catch(error){aborted=error.name==='AbortError';}
    char.description='<%= await (await fetch(location.origin+"/ejs-network/after-cancel")).text() %>';
    const afterCancel=text(await build(true));
    await captured();
    const afterCancelSend=text(await build(false));
    char.description='<%= await (await fetch(location.origin+"/ejs-network/broken")).text() %>';
    let errors=0;for(let i=0;i<2;i++)try{await build(true);}catch(error){if(error instanceof TypeError)errors++;}
    char.description='<% const replies=await Promise.all([fetch(location.origin+"/ejs-network/post",{method:"POST",body:getLocalVar("body")||"a",headers:{"X-EJS":"yes"}}),window.fetch(location.origin+"/ejs-network/post",{method:"POST",body:"b",headers:{"X-EJS":"yes"}})]); %><%= await replies[0].text() %>|<%= await replies[1].text() %>';
    const postFirst=text(await build(true)); await captured();
    const postAgain=text(await build(true));
    session.stscriptVars=Object.assign({},session.stscriptVars,{body:'c'});
    const postChanged=text(await build(true));
    const cyclic={};cyclic.self=cyclic;EjsTemplate.defines.networkLoop=cyclic;
    char.description='<%= networkLoop.self===networkLoop %>:<%= await (await fetch(location.origin+"/ejs-network/unstable")).text() %>';
    const unstable=text(await build(true));
    delete EjsTemplate.defines.networkLoop;
    char.description='UI_FETCH:<%= await (await fetch(location.origin+"/ejs-network/ui")).text() %>';
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings),{apiUrl:location.origin+'/ejs-network/api/v1',apiKey:'synthetic-local',model:'fixture',reasoningEffort:'off'});
    Object.assign(D.settings,{maxContextTokens:0,maxTokens:0});
    switchAppPage('chat'); renderChat();
    switchAppPage('presets'); switchCompletionPresetTab('order');
    document.getElementById('prompt-preview-toggle').click();
    while(_presetRoundPreviewRun) await _presetRoundPreviewRun;
    const uiPreview=document.getElementById('prompt-preview-box').textContent.includes('UI_FETCH:ui:1');
    await captured();
    switchAppPage('chat');
    await regenerateLast(); await _generationPostCommitTasks.get(session);
    const other=createBlankSession('Other','ejs-other-session');
    D.chats[char.id].sessions.push(other); D.chats[char.id].activeSid=other.id;
    renderChat();
    D.chats[char.id].activeSid=session.id; renderChat();
    const ownerFresh=text(await build(true));
    return {postFirst,postAgain,postChanged,unstable,uiPreview,ownerFresh,first,repeated,sent,next,changed,unchangedHost,isolated,errorFirst,errorSend,streamFirst,streamAgain,
      resources,resourceAgain,aborted,afterCancel,afterCancelSend,errors};
  });
  assert.ok(network.first.includes('true:true:yes:value:1|value:2|other:1:other:1'), 'native Response identity, metadata, clone and body are real');
  assert.ok(network.repeated===network.first,'repeated preview reuses each call slot');
  assert.ok(network.sent===network.first,'sending reuses the last matching preview');
  assert.notStrictEqual(network.next,network.first,'next round fetches anew');
  assert.notStrictEqual(network.changed,network.next,'draft settings invalidate replay');
  assert.strictEqual(networkCounts.get('value'),6,'two identical calls occupy separate sequence slots across three fresh builds');
  assert.ok(network.unchangedHost && network.isolated,'network locals preserve host transports and local master data');
  assert.ok(network.errorSend===network.errorFirst,'HTTP error Response remains a Response and can replay');
  assert.notStrictEqual(network.streamFirst,network.streamAgain,'event streams retain real effects without replay');
  assert.ok(network.resources.includes('MODULE_EFFECT1xhr:1') && network.resourceAgain.includes('MODULE_EFFECT1xhr:2'),'module, image and XHR effects remain native');
  assert.strictEqual(networkCounts.get('image.png'),2,'images perform real browser loading each evaluation');
  assert.ok(network.aborted && network.afterCancel===network.afterCancelSend,'cancelled fetch rejects and cannot contaminate the following run');
  assert.strictEqual(network.errors,2,'native fetch failures reject again instead of replaying fake success');
  assert.ok(networkCounts.get('broken')>=2,'failed fetch results are not cached (native transport may retry a dropped connection)');
  assert.ok(network.postFirst===network.postAgain && network.postChanged.includes('POST:c:yes'),'parallel POSTs replay individually and changed bodies stay fresh');
  assert.deepStrictEqual(postBodies,['a','b','c','b'],'request signing does not consume or serialize parallel uploads');
  assert.ok(network.unstable.includes('true:unstable:1'),'cyclic definitions preserve real object identity and execution without replay');
  assert.ok(network.uiPreview,'actual preset-page UI must show the real fetch result');
  assert.strictEqual(networkCounts.get('wireMatchesPreview'),1,'actual send must reuse the matching UI preview result');
  assert.strictEqual(networkCounts.get('ui'),2,'UI preview and actual send share one fetch; returning after a chat switch fetches anew');
  assert.ok(network.ownerFresh.includes('UI_FETCH:ui:2'),'chat switch discards the previous network replay');
  assert.strictEqual(networkCounts.get('slow'),1,'cancel probe must reach the actual server');
  assert.strictEqual(networkCounts.get('slowClosed'),1,'abort closes the in-flight browser connection');

  // Normal HeadersInit iterables, RequestInit dictionary fields and constructor inheritance are
  // public transport compatibility; compare real server receipts instead of inspecting signatures.
  const transport = await page.evaluate(async () => {
    const create=(cache,source)=>{
      const controller=new AbortController(),run=cache?{key:'transport',cursor:0,entries:[],source:source||[],replay:!!source,active:true}:null;
      return {controller,run,net:promptTemplateNetwork({env:{networkRun:run},signal:controller.signal,cancelled:false})};
    };
    const captured=async tx=>{
      const deadline=Date.now()+5000;
      while(tx.run.entries.filter(Boolean).length!==tx.run.cursor && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,0));
      if(tx.run.entries.filter(Boolean).length!==tx.run.cursor)throw new Error('transport response capture timed out');
    };
    const options=()=>{
      const reads={},proto={};
      for(const [key,value] of Object.entries({method:'POST',headers:(function*(){yield ['X-EJS','yes'];})(),body:'body',signal:null}))
        Object.defineProperty(proto,key,{get(){reads[key]=(reads[key]||0)+1;return value;}});
      return {init:Object.create(proto),reads};
    };
    const receipts=[];
    for(const cache of [true,false]){
      const native=options(),expected=await(await fetch('/ejs-network/init-echo',native.init)).json(),first=options(),tx=create(cache);
      const actual=await(await tx.net.fetch('/ejs-network/init-echo',first.init)).json();
      receipts.push(JSON.stringify(actual)===JSON.stringify(expected)&&JSON.stringify(first.reads)===JSON.stringify(native.reads));
      if(cache){await captured(tx);const repeat=options(),replay=create(true,tx.run.entries);
        const repeated=await(await replay.net.fetch('/ejs-network/init-echo',repeat.init)).json();
        receipts.push(JSON.stringify(repeated)===JSON.stringify(expected)&&Object.values(repeat.reads).every(count=>count===1));}
    }
    for(const body of [()=>new URLSearchParams({a:'b c'}),()=>new Uint8Array([97,98,99])]){
      const tx=create(true),init=()=>({method:'POST',headers:{'X-EJS':'yes'},body:body()});
      const first=await(await tx.net.fetch('/ejs-network/init-echo',init())).json();await captured(tx);
      const replay=create(true,tx.run.entries),second=await(await replay.net.fetch('/ejs-network/init-echo',init())).json();
      receipts.push(JSON.stringify(first)===JSON.stringify(second)&&!!replay.run.entries[0]);
    }
    const sequence=create(true);
    await Promise.all([sequence.net.fetch('/ejs-network/init-order?slot=0',{method:'POST',body:new Uint8Array([97])}),sequence.net.fetch('/ejs-network/init-order?slot=1')]);
    await captured(sequence);
    const changed=create(true,sequence.run.entries);
    await Promise.all([changed.net.fetch('/ejs-network/init-order?slot=0',{method:'POST',body:new Uint8Array([98])}),changed.net.fetch('/ejs-network/init-order?slot=1')]);
    const constructors=[],owner=create(false);
    for(const name of ['XMLHttpRequest','WebSocket','EventSource']){
      const Custom=class extends owner.net[name]{marker(){return name;}};
      const args=name==='XMLHttpRequest'?[]:[name==='WebSocket'?location.origin.replace('http','ws')+'/ejs-network/socket':location.origin+'/ejs-network/constructor-stream'];
      const resource=new Custom(...args),explicit=Reflect.construct(owner.net[name],args,Custom);
      constructors.push({name,check:'prototype',ok:resource instanceof Custom&&resource.marker()===name&&Object.getPrototypeOf(explicit)===Custom.prototype});
      if(name==='XMLHttpRequest'){
        await new Promise((resolve,reject)=>{resource.onload=resolve;resource.onerror=reject;resource.open('GET','/ejs-network/constructor-xhr');resource.send();});
        constructors.push({name,check:'native-request',ok:resource.status===200});resource.open('GET','/ejs-network/constructor-stream');resource.send();
        resource.addEventListener('abort',()=>constructors.push({name,check:'cancel',ok:true}),{once:true});
      }else{
        await Promise.all([resource,explicit].map(value=>new Promise((resolve,reject)=>{value.addEventListener('open',resolve,{once:true});value.addEventListener('error',reject,{once:true});})));
        owner.controller.signal.addEventListener('abort',()=>constructors.push({name,check:'cancel',ok:resource.readyState===2||resource.readyState===3}),{once:true});
      }
    }
    owner.controller.abort();
    return {receipts,constructors};
  });
  assert.ok(transport.receipts.every(Boolean),'one-shot headers and inherited/non-enumerable getters preserve native receipts and finite-body replay');
  assert.strictEqual(networkCounts.get('init-echo'),6,'native comparisons, non-replay calls and two finite uploads hit the server; matching replays do not');
  assert.strictEqual(networkCounts.get('init-order'),4,'a changed slow body signature prevents the following parallel slot from replaying');
  assert.deepStrictEqual(transport.constructors.map(row=>row.name+':'+row.check).sort(),['XMLHttpRequest:prototype','XMLHttpRequest:native-request','XMLHttpRequest:cancel','WebSocket:prototype','WebSocket:cancel','EventSource:prototype','EventSource:cancel'].sort());
  assert.deepStrictEqual(transport.constructors.filter(row=>!row.ok),[],'XHR, WebSocket and EventSource keep subclasses, newTarget, native methods and owner cancellation');

  const result = await page.evaluate(async () => {
    D = defaults();
    D.settings.useMemory = false;
    D.settings.stscript = {globalVars: {overlay: 'global'}};
    D.settings.quickReplySets = [];
    const char = parseCard({name: 'Prompt Template Contract', first_mes: 'opening'});
    char.id = 'prompt-template-char';
    char.extensions = {world: 'Prompt Book'};
    const session = createBlankSession('Prompt Template Session', 'prompt-template-session');
    session.stscriptVars = {overlay: 'local'};
    session.msgs = [
      {role: 'user', content: 'seed', seq: 1},
      {role: 'assistant', content: 'answer', seq: 2},
    ];
    session.nextMessageSeq = 3;
    const initial = normalizeWBEntry({id: 'initial', comment: '[InitialVariables]', content: '{"overlay":"initial","initialOnly":9}', constant: true, disable: true});
    const before = normalizeWBEntry({id: 'before', comment: '[GENERATE:BEFORE]', content: 'B<% setLocalVar("browserChain", "ready") %>', constant: true, disable: true});
    const indexBefore = normalizeWBEntry({id: 'index-before', comment: '[GENERATE:1:BEFORE]', content: 'I:<%= getLocalVar("browserChain") %>', constant: true, disable: true});
    const after = normalizeWBEntry({id: 'after', comment: '[GENERATE:AFTER]', content: 'A:<%= getMessageVar("browserMessage") %>', constant: true, disable: true});
    const renderBefore = normalizeWBEntry({id: 'render-before', comment: '[RENDER:BEFORE]', content: 'RB', constant: true, disable: true});
    const renderAfter = normalizeWBEntry({id: 'render-after', comment: '[RENDER:AFTER]', content: 'RA', constant: true, disable: true});
    const inject = normalizeWBEntry({id: 'inject', comment: '@INJECT pos=0', content: 'DO-NOT-INJECT', disable: true});
    const activator = normalizeWBEntry({id: 'activator', comment: 'Activator', content: '@@preprocessing\n<% await activateWorldInfo("Prompt Book", "Manual", true) %>'});
    const manual = normalizeWBEntry({id: 'manual', comment: 'Manual', content: 'MANUAL-FORCED', keys: ['never-matches'], disable: true});
    const privateA = normalizeWBEntry({id: 'private-a', comment: 'Private A', content: '@@private\n<% let privateName = "A"; %>PRIVATE-<%= privateName %>', constant: true});
    const privateB = normalizeWBEntry({id: 'private-b', comment: 'Private B', content: '@@private\n<% let privateName = "B"; %>PRIVATE-<%= privateName %>', constant: true});
    const always = normalizeWBEntry({id: 'always', comment: 'Always despite disabled', content: '@@always_enabled\nALWAYS', constant: true, disable: true});
    const disabledPreprocess = normalizeWBEntry({id: 'disabled-preprocess', comment: 'Disabled preprocessing', content: '@@preprocessing\n<% setLocalVar("mustNotRun", true) %>DISABLED', constant: true, disable: true});
    D.worldBook = {
      scan_depth: 20,
      token_budget: 0,
      recursive: false,
      categories: [{id: 'prompt-book', name: 'Prompt Book', entries: [initial, before, indexBefore, after, renderBefore, renderAfter, inject, activator, manual, privateA, privateB, always, disabledPreprocess], boundCharIds: [char.id]}],
      globalCategoryIds: [],
      activeCategoryId: 'prompt-book',
    };
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
    const probe = await EjsTemplate.evalTemplate('<% print("P") %>|<%= "<b>" %>|<%- "<i>" %>|<%= await Promise.resolve(3) %>', {});
    const prepared = await EjsTemplate.prepareContext({runType: 'command'}, 1);
    const lookupPrimary = normalizeWBEntry({id: 'lookup-primary', comment: 'Duplicate', content: 'PRIMARY', disable: true});
    const lookupOther = normalizeWBEntry({id: 'lookup-other', comment: 'Duplicate', content: 'OTHER', disable: true});
    const lookupFallback = normalizeWBEntry({id: '42', comment: 'Fallback Entry', content: 'FALLBACK:<%= lookupData %>', disable: true});
    const lookupRecursive = normalizeWBEntry({id: 'lookup-recursive', comment: 'Recursive lookup', content: '<%- await getwi("Duplicate", {}) %>', disable: true});
    D.worldBook.categories[0].entries.push(lookupPrimary);
    D.worldBook.categories.push({id: 'lookup-book', name: 'Lookup Book', entries: [lookupOther, lookupFallback, lookupRecursive], boundCharIds: []});
    const lookup = {
      recursive: await prepared.getwi('Lookup Book', 'Recursive lookup'),
      explicit: await prepared.getWorldInfo('Lookup Book', /^Duplicate$/),
      disabled: await prepared.getwi('Fallback Entry', {lookupData: 'data'}),
    };
    D.worldBook.globalCategoryIds.push('lookup-book');
    Object.assign(lookup, {
      unnamed: await prepared.getwi('Duplicate'),
      fallback: await prepared.getwi(/^Fallback/, {lookupData: 'data'}),
      emptyBook: await prepared.getwi('', 'Fallback Entry', {lookupData: 'empty'}),
      explicitMiss: await prepared.getwi('Prompt Book', 'Fallback Entry'),
      missingBook: await prepared.getwi('Missing Book', 'Fallback Entry'),
      numericMiss: await prepared.getwi(42),
      explicitUid: await prepared.getwi('Lookup Book', 42, {lookupData: 'uid'}),
      stringUid: await prepared.getwi('Lookup Book', '42'),
      internalId: await prepared.getwi('Lookup Book', 'lookup-other'),
    });
    D.worldBook.globalCategoryIds = [];
    D.worldBook.categories.pop();
    D.worldBook.categories[0].entries.pop();
    const overlay = prepared.getvar('overlay');
    const initialOnly = prepared.getvar('initialOnly');
    const activationRun = await promptTemplatePrepareGeneration(char, session, 1, {generationType: 'normal'});
    const activatedWorldbook = resolveWorldBook(['no matching key'], char.id, session, {promptTemplateRun: activationRun, maxContext: 0});
    const forcedWorldbook = JSON.stringify(activatedWorldbook).includes('MANUAL-FORCED');
    const alwaysWorldbook = JSON.stringify(activatedWorldbook).includes('ALWAYS');
    const privateRun = await promptTemplatePrepareGeneration(char, session, 1, {generationType: 'normal'});
    const privateWorldbook = resolveWorldBook(['no matching key'], char.id, session, {promptTemplateRun: privateRun, maxContext: 0});
    const privateSources = [];
    (function collect(value) {
      if (typeof value === 'string') { if (value.includes('PRIVATE-')) privateSources.push(value); return; }
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (value && typeof value === 'object') Object.keys(value).forEach(key => collect(value[key]));
    })(privateWorldbook);
    const privateMessages = await promptTemplateProcessGenerationMessages(privateRun, [{role: 'system', content: Array.from(new Set(privateSources)).join('\n')}]);
    const privateScope = privateMessages[0].content.includes('PRIVATE-A') && privateMessages[0].content.includes('PRIVATE-B') && !privateMessages[0].content.includes('@@private');
    const run = await promptTemplatePrepareGeneration(char, session, 1, {generationType: 'normal'});
    const messages = await promptTemplateProcessGenerationMessages(run, [
      {role: 'system', content: 'M0'},
      {role: 'user', content: 'M1:<%= getLocalVar("browserChain") %><% setMessageVar("browserMessage", "saved") %>'},
    ]);
    const rendered = await promptTemplateEvaluateRender('BODY:<%= getLocalVar("browserChain") %>', 'assistant', char, session.msgs[1], {});
    const frame = document.createElement('iframe');
    frame.srcdoc = '<script>window.__sharedEjsTemplate = parent.EjsTemplate;<\/script>';
    document.body.appendChild(frame);
    await new Promise(resolve => { frame.onload = resolve; });
    const shared = frame.contentWindow.__sharedEjsTemplate === EjsTemplate;
    frame.remove();
    EjsTemplate.setFeatures({render_enabled: false});
    const rawHidden = promptTemplateDisplayText('<%= "hidden" %>', 'assistant', char, session.msgs[1], {}) === '';
    EjsTemplate.resetFeatures();
    const daoyuanOptimal = {
      enabled: true, generate_enabled: true, generate_loader_enabled: true,
      render_enabled: true, render_loader_enabled: true, with_context_disabled: false,
      debug_enabled: false, autosave_enabled: false, preload_worldinfo_enabled: true,
      code_blocks_enabled: true, raw_message_evaluation_enabled: true, filter_message_enabled: true,
      inject_loader_enabled: false, invert_enabled: true, depth_limit: -1,
      compile_workers: false, sandbox: false,
    };
    const daoyuanFeatures = EjsTemplate.setFeatures(daoyuanOptimal);
    const daoyuanOptimalEffective = Object.entries(daoyuanOptimal).every(([key, value]) => daoyuanFeatures[key] === value);
    return {
      probe,
      lookup,
      exports: Object.keys(EjsTemplate).sort(),
      overlay,
      initialOnly,
      messages,
      rendered,
      local: structuredClone(session.stscriptVars),
      shared,
      forcedWorldbook,
      alwaysWorldbook,
      disabledPreprocessSkipped: session.stscriptVars.mustNotRun === undefined,
      privateScope,
      rawHidden,
      daoyuanOptimalEffective,
      features: EjsTemplate.getFeatures(),
    };
  });

  assert.strictEqual(result.probe, oracle.ejs.referenceProbeOutput);
  assert.deepStrictEqual(result.lookup, {
    recursive: 'PRIMARY', explicit: 'OTHER', disabled: '', unnamed: 'PRIMARY',
    fallback: 'FALLBACK:data', emptyBook: 'FALLBACK:empty', explicitMiss: '', missingBook: '',
    numericMiss: '', explicitUid: 'FALLBACK:uid', stringUid: '', internalId: '',
  });
  assert.deepStrictEqual(result.exports, oracle.exports.slice().sort());
  assert.strictEqual(result.overlay, 'local');
  assert.strictEqual(result.initialOnly, 9);
  assert.strictEqual(result.messages.length, 2, '@INJECT reference no-op must not add a message');
  assert.strictEqual(result.messages[0].content, 'BM0');
  assert.strictEqual(result.messages[1].content, 'I:readyM1:readyA:saved');
  assert.ok(result.messages.every(message => !message.content.includes('<%')));
  assert.strictEqual(result.rendered, 'RBBODY:readyRA');
  assert.strictEqual(result.local.browserChain, 'ready');
  assert.strictEqual(result.shared, true);
  assert.strictEqual(result.forcedWorldbook, true);
  assert.strictEqual(result.alwaysWorldbook, true);
  assert.strictEqual(result.disabledPreprocessSkipped, true);
  assert.strictEqual(result.privateScope, true);
  assert.strictEqual(result.rawHidden, true);
  assert.strictEqual(result.daoyuanOptimalEffective, true);
  assert.strictEqual(result.features.compile_workers, false);
  assert.strictEqual(result.features.sandbox, false);
  await page.evaluate(() => {
    const char = getChar(), session = getActiveSession(char.id);
    session.msgs = [{seq: 1, role: 'user', content: 'render-next'}];
    D.worldBook.categories[0].entries = [normalizeWBEntry({id: 'new-hook', content: '@@render_before\nHOOK', constant: true, disable: true})];
    renderChat();
  });
  await page.waitForFunction(() => document.querySelector('#chat-messages').textContent.includes('HOOKrender-next'));
  const identities = await page.evaluate(async () => {
    const check = (ok, label) => { if (!ok) throw new Error(label); };
    const context = await EjsTemplate.prepareContext();
    class Defined { static value() { return 'static'; } }
    context.define('IdentityClass', Defined);
    const next = await EjsTemplate.prepareContext();
    check(next.IdentityClass === Defined && new next.IdentityClass() instanceof Defined, 'defined class identity');
    check(next._ === YeyuMvuVendor._ && next.$ === (window.jQuery || window.$), 'library identity');
    check(await EjsTemplate.evalTemplate("<%= _.partial((a,b)=>a+'-'+b, _, 'B')('A') %>", next) === 'A-B', 'partial identity');
    delete _promptTemplateDefines.IdentityClass;
    return true;
  });
  assert.strictEqual(identities, true);
  // Whether a stream preview is hidden for [RENDER:*] entries must follow every book source the
  // moment it changes: chat, persona and character bindings are saved outside the world book.
  const renderSources = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id), message = session.msgs[0];
    const preview = () => promptTemplateDisplayText('plain', 'assistant', char, message, {streamPreview: true}) === '' ? 'render' : 'plain';
    const hook = () => normalizeWBEntry({id: 'hook', comment: '[RENDER:AFTER]', content: 'H', constant: true, disable: true});
    char.extensions = {world: ''};
    D.worldBook.globalCategoryIds = [];
    D.worldBook.categories = [
      {id: 'plain-book', name: 'Plain Book', entries: [normalizeWBEntry({id: 'plain', comment: 'Plain', content: 'P'})], boundCharIds: [char.id]},
      {id: 'hook-book', name: 'Hook Book', entries: [hook()], boundCharIds: []},
    ];
    D.personas = [{id: 'render-persona', name: 'Persona', lorebook: ''}];
    D.activePersonaId = 'render-persona';
    const steps = [preview()];
    session.tavernHelperChatLorebook = 'Hook Book';
    steps.push(preview());
    session.tavernHelperChatLorebook = '';
    steps.push(preview());
    D.personas[0].lorebook = 'Hook Book';
    steps.push(preview());
    D.personas[0].lorebook = '';
    char.extensions.world = 'Hook Book';
    steps.push(preview());
    D.worldBook.categories[1].entries[0].comment = 'Renamed';
    await saveData('worldbook');
    steps.push(preview());
    D.worldBook.categories[0].entries = [hook()];
    steps.push(preview());
    return steps;
  });
  assert.deepStrictEqual(renderSources, ['plain', 'render', 'plain', 'render', 'render', 'plain', 'render']);
  const avatars = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id);
    const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0))], {type: 'image/png'});
    // Stored state after any reload: the field is emptied and the image lives in _mediaBlobs.
    Object.assign(char, {avatar_image: '', _mediaBlobs: {avatar_image: png()}});
    D.personas = [{id: 'avatar-persona', name: 'Avatar User', avatar_image: '', _mediaBlobs: {avatar_image: png()}}];
    D.activePersonaId = 'avatar-persona';
    const context = await promptTemplatePrepareContextFor(char, session, {});
    return {
      char: context.charAvatar,
      user: context.userAvatar,
      charMacro: replaceCharacterMacros('{{charAvatarPath}}', char, 'Avatar User'),
      userMacro: replaceCharacterMacros('{{userAvatarPath}}', char, 'Avatar User'),
    };
  });
  assert.ok(avatars.char && avatars.user, 'EJS avatars must resolve Blob-stored images');
  assert.notStrictEqual(avatars.char, avatars.user);
  assert.strictEqual(avatars.char, avatars.charMacro);
  assert.strictEqual(avatars.user, avatars.userMacro);
  assert.deepStrictEqual(pageErrors, []);
  console.log('prompt template browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
