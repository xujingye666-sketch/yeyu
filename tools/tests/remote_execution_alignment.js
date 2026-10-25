/* global __remoteMessageReady, __remoteChatChanged, __remoteDeferredOwner, __remoteDeferredRelease, __remoteMvuEvents, __remoteSillyEvents, __remoteGenerationStates, __remoteNameGuards, __remoteWorldInfo, __remoteChar, __remoteEventContinued, __remoteLibrary, __remoteLibraryEventContinued, __remoteOrder, __remotePages, __remoteSameNameRuns, __remoteSession */
// Browser globals installed by this file's page.evaluate setup and iframe/remote fixtures through parent.
'use strict';

const assert=require('assert'),fs=require('fs'),http=require('http'),path=require('path');
const {loadPlaywright,listenOnBrowserSafePort,resolveEdgeExecutable}=require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const root=path.resolve(__dirname,'../..'),assets=path.join(root,'app/src/main/assets');

function serveAssets(request,response){
  const relative=decodeURIComponent(String(request.url||'/').split('?')[0]).replace(/^\/+/, '')||'index.html',file=path.resolve(assets,relative),inside=path.relative(assets,file);
  if(relative==='favicon.ico'){response.writeHead(204);response.end();return;}
  if(inside.startsWith('..')||path.isAbsolute(inside)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){response.writeHead(404);response.end();return;}
  const ext=path.extname(file),type=ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'application/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/octet-stream';
  response.writeHead(200,{'content-type':type,'cache-control':'no-store'});response.end(fs.readFileSync(file));
}
function remoteServer(routes){return http.createServer((request,response)=>{
  const route=routes[String(request.url||'').split('?')[0]];
  if(!route){response.writeHead(404,{'access-control-allow-origin':'*'});response.end();return;}
  response.writeHead(200,{'content-type':route.type,'access-control-allow-origin':'*','cache-control':'no-store'});response.end(route.body);
});}
function script(id,name,content){return{id,name,type:'script',enabled:true,content};}

(async()=>{
  const appServer=http.createServer(serveAssets),sourceA=remoteServer({}),sourceB=remoteServer({});
  const appPort=await listenOnBrowserSafePort(appServer),portA=await listenOnBrowserSafePort(sourceA),portB=await listenOnBrowserSafePort(sourceB),origin=`http://127.0.0.1:${appPort}`,remoteA=`http://127.0.0.1:${portA}`,remoteB=`http://127.0.0.1:${portB}`;
  sourceA.removeAllListeners('request');sourceB.removeAllListeners('request');
  const routesA={
    '/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js':{type:'application/javascript; charset=utf-8',body:`parent.__remoteOrder.push("20-bundle");parent.__remoteChatChanged=[];eventOn(tavern_events.CHAT_CHANGED,chatId=>parent.__remoteChatChanged.push(chatId));setTimeout(async()=>{
const bound=getCharWorldbookNames('current'),books=[...(getLorebookSettings().selected_global_lorebooks||[]),bound.primary,...(bound.additional||[])].filter(Boolean),worlds=await Promise.all(books.map(async book=>({book,world:await SillyTavern.loadWorldInfo(book)}))),located=worlds.map(row=>({book:row.book,world:row.world,initial:Object.values(row.world.entries).find(entry=>entry.disable===true&&/\\[initvar\\]/i.test(String(entry.comment||'')))})).find(row=>row.initial),book=located&&located.book,world=located&&located.world,initial=located&&located.initial;
parent.__remoteWorldInfo={book,entryCount:world&&Object.keys(world.entries).length,uid:initial&&initial.uid,displayIndex:initial&&initial.displayIndex,disable:initial&&initial.disable,comment:initial&&initial.comment,unknownRaw:initial&&initial.unknown_raw&&initial.unknown_raw.keep===true};
const initialDay=Number((String(initial&&initial.content||'').match(/day\\s*:\\s*(\\d+)/i)||[])[1]||1);
await replaceVariables({stat_data:{day:initialDay}},{type:'message',message_id:0});
const runtime={owner:'card-bundle',getMvuData:getVariables,replaceMvuData:replaceVariables};parent.Mvu=runtime;await eventEmit('global_Mvu_initialized');
 parent.__remoteMvuEvents=[];parent.__remoteSillyEvents=[];parent.__remoteGenerationStates=[];parent.__remoteNameGuards=[];
 eventOn(tavern_events.MESSAGE_RECEIVED,async(messageId,type)=>{parent.__remoteMvuEvents.push('received:'+messageId+':'+type);parent.__remoteGenerationStates.push(parent.__remoteReadGenerationState());const current=getChatMessages(messageId).at(-1),guard=current&&current.name===SillyTavern.name2;parent.__remoteNameGuards.push(guard);if(!guard)return;const blocks=Array.from(String(current.message||'').matchAll(/<JSONPatch>([\\s\\S]*?)<\\/JSONPatch>/gi));let data=getVariables({type:'message',message_id:messageId});if(!data.stat_data||data.stat_data.day==null)data=messageId>0?getVariables({type:'message',message_id:messageId-1}):{stat_data:{day:initialDay}};data=JSON.parse(JSON.stringify(data));for(const block of blocks){for(const operation of JSON.parse(block[1]))if(operation.path==='/day'&&(operation.op==='replace'||operation.op==='add'))data.stat_data.day=operation.value;}await replaceVariables(data,{type:'message',message_id:messageId});});
 SillyTavern.eventSource.on(tavern_events.MESSAGE_RECEIVED,(messageId,type)=>{parent.__remoteSillyEvents.push('received:'+messageId+':'+type);});eventOn(tavern_events.GENERATION_ENDED,messageId=>{parent.__remoteMvuEvents.push('ended:'+messageId);});},300);`},
    '/mixed.js':{type:'application/javascript; charset=utf-8',body:'export function markLater(){parent.__remoteOrder.push("40-mixed-module");setTimeout(()=>{replaceVariables({mixed:true},{type:"script"});window.__remoteMixedState=getVariables({type:"script"});parent.__remoteOrder.push("40-mixed-callback");},20);}'},
    [encodeURI('/dist/酒馆助手/延迟归属/index.js')]:{type:'application/javascript; charset=utf-8',body:'const deferred=new Promise(resolve=>{parent.__remoteDeferredRelease=resolve;});deferred.then(()=>{parent.__remoteDeferredOwner={id:getScriptId(),name:getScriptName(),event:getButtonEvent("延迟按钮")};});'},
    '/page-a.html':{type:'text/html; charset=utf-8',body:'<!doctype html><body>A<script>top.postMessage({remoteBundlePage:"a"},"*");<\/script>'}
  };
  const routesB={
    '/gh/StageDog/tavern_resource/dist/util/mvu_zod.js':{type:'application/javascript; charset=utf-8',body:'parent.__remoteOrder.push("30-zod-module");const namespace=z;if(typeof namespace.object!=="function"||typeof namespace.z.object!=="function")throw new Error("Zod namespace shape mismatch");export function registerMvuSchema(){parent.__remoteOrder.push("30-schema-call");}'},
    '/page-b.html':{type:'text/html; charset=utf-8',body:'<!doctype html><body>B<script>top.postMessage({remoteBundlePage:"b"},"*");<\/script>'}
  };
  function replaceHandler(routes){return(request,response)=>{const route=routes[String(request.url||'').split('?')[0]];if(!route){response.writeHead(404,{'access-control-allow-origin':'*'});response.end();return;}response.writeHead(200,{'content-type':route.type,'access-control-allow-origin':'*','cache-control':'no-store'});response.end(route.body);};}
  sourceA.on('request',replaceHandler(routesA));sourceB.on('request',replaceHandler(routesB));
  const browser=await loadPlaywright().chromium.launch({headless:true,executablePath:resolveEdgeExecutable()}),context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  await context.route('https://testingcf.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:''}));
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js',route=>route.fulfill({status:200,contentType:'application/javascript; charset=utf-8',body:''}));
  const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',error=>errors.push(String(error&&error.stack||error)));
  try{
    await page.goto(`${origin}/index.html`,{waitUntil:'load'});await waitForAppReady(page);
    const setup=await page.evaluate(({remoteA,remoteB})=>{
      window.__remotePages=[];window.__remoteOrder=[];window.__remoteReadGenerationState=()=>_generationState;window.addEventListener('message',event=>{if(event.data&&event.data.remoteBundlePage)__remotePages.push(event.data.remoteBundlePage);});
      const first='<!doctype html><html><body><iframe src="'+remoteA+'/page-a.html"></iframe><script>window.__remoteGreeting=true;waitGlobalInitialized("Mvu").then(()=>{parent.__remoteMessageReady={actual:Mvu===parent.Mvu,zDirect:typeof z.object==="function",zNested:typeof z.z.object==="function",state:getVariables({type:"message",message_id:0}).stat_data};});<\/script></body></html>',replacement='<!doctype html><html><body><iframe src="'+remoteB+'/page-b.html"></iframe><script>window.__remoteRegex=true;<\/script></body></html>';
      const char=parseCard({name:'远程执行对齐',first_mes:first});char.id='remote-char';char.scriptsEnabled=true;char.regexScripts=[{findRegex:'x',replaceString:replacement}];char.extensions={world:'remote-book',yeyu:{componentImportMode:'full'},tavern_helper:{scripts:[
        {id:'40',name:'混合模块',type:'script',enabled:true,content:'import { markLater } from "'+remoteA+'/mixed.js";markLater();const frame=document.createElement("iframe");frame.src="'+remoteB+'/page-b.html";document.body.appendChild(frame);parent.__remoteOrder.push("40-mixed-row");'},
        {id:'30',name:'Zod 结构',type:'script',enabled:true,content:'import { registerMvuSchema } from "'+remoteB+'/gh/StageDog/tavern_resource/dist/util/mvu_zod.js";const normalize=(value: unknown)=>value as Record<string, unknown>;registerMvuSchema(z.object({value:z.string()}));'},
        {id:'25',name:'错误 TS 脚本',type:'script',enabled:true,content:'const invalidType: string = "不能解析";'},
        {id:'26',name:'载入抛错',type:'script',enabled:true,content:'throw new Error("载入失败哨兵");'},
        {id:'45',name:'延迟归属',type:'script',enabled:true,content:'import "'+remoteA+'/dist/酒馆助手/延迟归属/index.js";setTimeout(function(){throw new Error("延迟失败哨兵");},0);'},
        {id:'20',name:'MVU bundle',type:'script',enabled:true,content:'import "'+remoteA+'/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js";'},
        // Disabled, and its address is built by a template literal: the library section already
        // reports it as 支持但当前关闭, so it must never also surface as 当前缺失.
        {id:'50',name:'模板串关闭',type:'script',enabled:false,content:'const version="v1";import(`'+remoteA+'/gh/demo/pack@${version}/dist/entry.js`);'}
      ]}};
      const session=createBlankSession('远程执行','remote-session');session.msgs.push({role:'assistant',content:'等待状态',seq:1});session.nextMessageSeq=2;
      D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};D.worldBook.globalCategoryIds=['remote-global-id'];D.worldBook.categories=[{id:'remote-global-id',name:'remote-global',boundCharIds:[],entries:[{id:'23',displayIndex:7,comment:'[InitVar]',enabled:false,constant:true,selective:false,position:'after_char',order:100,content:'stat_data:\n  day: 1',_raw:{unknown_raw:{keep:true}}}]},{id:'remote-book-id',name:'remote-book',ownerCharId:char.id,boundCharIds:[char.id],entries:[{id:'24',displayIndex:8,comment:'角色书普通条目',enabled:true,content:'角色书内容'}]}];window.__remoteChar=char;window.__remoteSession=session;
      const scan=cardScriptLibraryScan(char),frontends=cardFrontendScan(char),report=analyzeCardDependencies(char),missing=report.items.filter(item=>item.group==='missing'&&(item.id==='remote-script'||item.id==='remote-frontend'));
      const disabledHelper=report.items.filter(item=>item.id==='tavern-helper'&&item.group==='disabled'),disabledAddresses=disabledHelper.flatMap(item=>(item.evidence||[]).map(row=>row.address||'').filter(Boolean));
      window.__remoteLibrary=cardScriptLibraryMount(char,scan,'remote-library');
      cardFrontendCarrierTexts(char).forEach((source,index)=>{const segment=cardFrontendSegments(source)[0],key='remote-front-'+index,owner={charId:char.id,sessionId:session.id,messageIndex:0};if(!segment)return;_cardFrontendSource.set(key,{html:segment.html,owner});const node=document.createElement('div');node.className='yeyu-card-frontend';node.setAttribute('data-frontend-key',key);node.innerHTML='<div class="yeyu-card-frontend-slot"></div><div class="yeyu-card-frontend-note"></div>';document.body.appendChild(node);cardFrontendMount(char,node,key);});
      const local=parseCard({name:'本地回放',first_mes:'x'});local.id='remote-local';local.scriptsEnabled=true;local.extensions={yeyu:{componentImportMode:'full'},tavern_helper:{scripts:[{id:'z',name:'本地 Zod',type:'script',enabled:true,content:'import { z, registerMvuSchema } from "https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js";\nregisterMvuSchema(z.object({value:z.string()}));'}]}};
      const unbound=parseCard({name:'无世界书角色',first_mes:'x'});unbound.id='remote-unbound';D.characters.push(unbound);const selectedGlobals=D.worldBook.globalCategoryIds;D.worldBook.globalCategoryIds=[];const noAllowedLorebooks=cardFrontendAllowedLorebookNames({charId:unbound.id});D.worldBook.globalCategoryIds=selectedGlobals;
      return{disabledAddresses,ids:scan.active.map(row=>row.id),modules:scan.active.map(row=>row.modules),owner:mvuRuntimeOwner(char),canRun:mvuCanRun(char),protocol:mvuProtocolScripts(char).length,frontendCount:frontends.count,frontendRemotes:frontends.remotes,missing:missing.map(item=>item.id),mvuReady:report.items.some(item=>item.id==='mvu-zod'&&item.group==='ready'&&/bundle.*接管/.test(item.missing||'')),allowedLorebooks:cardFrontendAllowedLorebookNames({charId:char.id}),noAllowedLorebooks,bundleKinds:[mvuBundleAddress('https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'),mvuBundleAddress('https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@beta/artifact/bundle.js'),mvuBundleAddress('https://testingcf.jsdelivr.net/gh/NLKASHEI/MVU-offline@v1.0.2/mvu_bundle_full.js')],typedSchema:{source:/value: unknown/.test(scan.active.find(row=>row.id==='30').content),resident:/value: unknown/.test(__remoteLibrary.scripts.find(row=>row.id==='30').content),plainPreserved:mvuResidentScriptSource(char,{content:'registerMvuSchema(z.any());'})==='registerMvuSchema(z.any());'},local:{owner:mvuRuntimeOwner(local),canRun:mvuCanRun(local),protocol:mvuProtocolScripts(local).length,library:cardScriptLibraryScan(local).active.length,prepared:mvuPrepareSchemaSource(local).source.includes('registerMvuSchema')}};
    },{remoteA,remoteB});
    assert.deepStrictEqual(setup.ids,['20','25','26','30','40','45']);assert.strictEqual(setup.owner,'bundle');assert.strictEqual(setup.canRun,false);assert.strictEqual(setup.protocol,0);assert.strictEqual(setup.frontendCount,2);assert.deepStrictEqual(setup.missing,[],'关闭脚本里的模板串 import 已归入「支持但当前关闭」，不得再报「当前缺失」');assert.deepStrictEqual(setup.disabledAddresses,[`${remoteA}/gh/demo/pack@${'${version}'}/dist/entry.js`],'模板串地址须完整显示，不得截断在 ${ 处');assert.strictEqual(setup.mvuReady,true);
    assert.deepStrictEqual(setup.allowedLorebooks,['remote-global','remote-book']);assert.deepStrictEqual(setup.noAllowedLorebooks,[],'没有启用或绑定世界书时不得退回读取全部世界书');assert.deepStrictEqual(setup.bundleKinds,[true,true,true]);assert.deepStrictEqual(setup.typedSchema,{source:true,resident:false,plainPreserved:true});assert.deepStrictEqual(setup.local,{owner:'local',canRun:true,protocol:1,library:1,prepared:true});assert.strictEqual(setup.modules[0][0],`${remoteA}/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js`);
    await page.waitForFunction(()=>_cardScriptLibraryLive&&_cardScriptLibraryLive.state==='ready'&&__remoteOrder.includes('40-mixed-callback'));await page.waitForTimeout(100);assert.strictEqual(await page.evaluate(()=>window.__remoteMessageReady),undefined,'parent Mvu 尚未出现时 waiter 不得靠超时或本地 facade 伪成功');
    await page.waitForFunction(()=>typeof window.__remoteDeferredRelease==='function');await page.evaluate(()=>__remoteDeferredRelease());
    try{await page.waitForFunction(()=>window.__remoteMessageReady&&__remotePages.includes('a')&&__remotePages.includes('b')&&window.__remoteDeferredOwner&&_cardScriptLibraryLive.scriptFailures.length===3);}
    catch(error){const diagnostic=await page.evaluate(()=>({state:_cardScriptLibraryLive&&_cardScriptLibraryLive.state,lastError:_cardScriptLibraryLive&&_cardScriptLibraryLive.lastError,order:__remoteOrder,pages:__remotePages}));throw new Error(String(error&&error.message||error)+'\n'+JSON.stringify(diagnostic));}
    const runtime=await page.evaluate(()=>{const live=_cardScriptLibraryLive,child=live.frame.contentWindow,message=__remoteSession.msgs[0],toasts=Array.from(document.querySelectorAll('#toasts .toast')).map(node=>node.textContent.trim()),updateErrors=['updateFrontendVersion','updateTavernHelper'].map(name=>{try{child[name]();return'';}catch(error){return String(error&&error.message||error);}});return{order:__remoteOrder.slice(),scriptState:child.__remoteMixedState,mvuState:mvuMessageRecord(message).state,owner:mvuRuntimeStatus(__remoteChar).kind,pages:Array.from(new Set(__remotePages)).sort(),libraryRows:live.scripts.map(row=>row.id),libraryError:live.lastError,libraryState:live.state,scriptFailures:live.scriptFailures.map(row=>({id:row.id,name:row.name})).sort((left,right)=>left.id<right.id?-1:1),deferredOwner:__remoteDeferredOwner,messageReady:__remoteMessageReady,chatChanged:__remoteChatChanged.slice(),versions:[child.getTavernHelperVersion(),child.getFrontendVersion()],updateErrors,toasts};});
    assert.deepStrictEqual(runtime.order,['20-bundle','30-zod-module','30-schema-call','40-mixed-module','40-mixed-row','40-mixed-callback']);assert.deepStrictEqual(runtime.scriptState,{mixed:true});assert.strictEqual(runtime.owner,'external');assert.deepStrictEqual(runtime.pages,['a','b']);assert.deepStrictEqual(runtime.libraryRows,['20','25','26','30','40','45']);assert.deepStrictEqual(runtime.chatChanged,['remote-session']);assert.deepStrictEqual(runtime.versions,['4.11.3','4.11.3']);assert.deepStrictEqual(runtime.updateErrors,['夜欲绑定 JS-Slash-Runner 4.11.3，不提供在线更新接口','夜欲绑定 JS-Slash-Runner 4.11.3，不提供在线更新接口']);assert.strictEqual(runtime.libraryState,'ready','单条脚本失败不得让整个脚本库停摆');assert.strictEqual(runtime.libraryError,'','可归属到脚本的失败不得记成库级错误');assert.deepStrictEqual(runtime.scriptFailures,[{id:'25',name:'错误 TS 脚本'},{id:'26',name:'载入抛错'},{id:'45',name:'延迟归属'}],'载入期与运行期失败都只记在所属脚本上');assert.deepStrictEqual({id:runtime.deferredOwner.id,name:runtime.deferredOwner.name,prefix:runtime.deferredOwner.event.startsWith('45_'),hashed:runtime.deferredOwner.event.length>3},{id:'45',name:'延迟归属',prefix:true,hashed:true},'异步续段里的脚本级接口必须仍解析到所属脚本');assert(runtime.toasts.some(text=>/错误 TS 脚本.*加载失败/.test(text)));assert(!runtime.toasts.some(text=>/Zod 结构.*加载失败/.test(text)));assert.deepStrictEqual(runtime.messageReady,{actual:true,zDirect:true,zNested:true,state:{day:1}});
    const mvuLifecycle=await page.evaluate(async()=>{const values=[],modes=[['new',2],['regenerate',3],['swipe',4],['continue',5]];let messageIndex=__remoteSession.msgs.length;for(const row of modes){const mode=row[0],value=row[1],target={charId:__remoteChar.id,sessionId:__remoteSession.id,mode:mode,messageIndex:messageIndex,messageSeq:(__remoteSession.msgs[messageIndex]||{}).seq,viewportContextId:-1},text='<UpdateVariable><JSONPatch>'+JSON.stringify([{op:'replace',path:'/day',value:value}])+'</JSONPatch></UpdateVariable>';await commitGeneratedResponse(target,text,{finishReason:'stop',deferMemorySummary:true});messageIndex=target.messageIndex;finishGeneration(target);await target.postCommitTask;const message=__remoteSession.msgs[messageIndex],record=mvuMessageRecord(message,Number(message.swipeId)||0);values.push(record&&record.state&&record.state.day);}return{values:values,events:__remoteMvuEvents.slice(),sillyEvents:__remoteSillyEvents.slice(),states:__remoteGenerationStates.slice(),guards:__remoteNameGuards.slice(),world:__remoteWorldInfo,generationState:_generationState};});
    assert.deepStrictEqual(mvuLifecycle.values,[2,3,4,5]);assert.deepStrictEqual(mvuLifecycle.events,['received:1:normal','ended:2','received:1:regenerate','ended:2','received:1:swipe','ended:2','received:1:continue','ended:2']);assert.deepStrictEqual(mvuLifecycle.sillyEvents,['received:1:normal','received:1:regenerate','received:1:swipe','received:1:continue']);assert.deepStrictEqual(mvuLifecycle.states,['idle','idle','idle','idle']);assert.deepStrictEqual(mvuLifecycle.guards,[true,true,true,true]);assert.deepStrictEqual(mvuLifecycle.world,{book:'remote-global',entryCount:1,uid:23,displayIndex:7,disable:true,comment:'[InitVar]',unknownRaw:true});assert.strictEqual(mvuLifecycle.generationState,'idle');
    const hostEventPayload=await page.evaluate(async()=>{
      const live=_cardScriptLibraryLive,child=live.frame.contentWindow,seen=[];
      child.SillyTavern.eventSource.on('oai_preset_changed_before',async payload=>{seen.push({savePresetType:typeof payload.savePreset,presetName:payload.presetName,saved:typeof payload.savePreset==='function'?await payload.savePreset('remote-new'):null,settings:payload.settings&&payload.settings.temperature});});
      child.SillyTavern.eventSource.on('oai_preset_changed_before',()=>{throw new Error('监听器故意抛错');});
      const later=[];child.SillyTavern.eventSource.on('oai_preset_changed_before',payload=>{later.push(typeof payload.savePreset);});
      const eventData={preset:{temperature:0.5},presetName:'remote-preset',settingsToUpdate:{},settings:{temperature:0.5},savePreset:async name=>'saved:'+name,presetNameBefore:'remote-old'};
      const emitted=await cardScriptLibrarySillyTavernEmitAsync('oai_preset_changed_before',[eventData],live);
      const cloneSource={probe:()=>1,plain:7},cloneSeen=[],handler=value=>{cloneSeen.push({probeType:typeof value.probe,same:value===cloneSource,plain:value.plain});};
      cardFrontendRegisterEvent(live,'remote_clone_probe',handler,false);
      await child.eventEmit('remote_clone_probe',cloneSource);
      cardFrontendRemoveEvent(live,'remote_clone_probe',handler);
      return{emitted,seen,later,cloneSeen};
    });
    assert.strictEqual(hostEventPayload.emitted,true);
    assert.deepStrictEqual(hostEventPayload.seen,[{savePresetType:'function',presetName:'remote-preset',saved:'saved:remote-new',settings:0.5}],'宿主发起的 SillyTavern 事件必须把函数字段原样交给脚本监听器');
    assert.deepStrictEqual(hostEventPayload.later,['function'],'监听器抛错不得中断后续监听器，也不得丢失函数字段');
    assert.deepStrictEqual(hostEventPayload.cloneSeen,[{probeType:'undefined',same:false,plain:7}],'脚本发起的 eventEmit 仍须向宿主监听器交付克隆参数');
    const waitNotice=await page.evaluate(async()=>{const live=_cardScriptLibraryLive,child=live.frame.contentWindow,originalTimeout=child.setTimeout,previousMvu=window.Mvu;delete window.Mvu;child.setTimeout=function(callback,delay){return originalTimeout.call(child,callback,delay===5000?0:delay);};let resolved=false;const waiting=child.waitGlobalInitialized('Mvu').then(()=>{resolved=true;});await new Promise(resolve=>setTimeout(resolve,30));const visible=Array.from(document.querySelectorAll('#toasts .toast')).some(node=>/仍在等待 Mvu 初始化/.test(node.textContent||''));const pending=!resolved;window.Mvu=previousMvu;await waiting;child.setTimeout=originalTimeout;return{visible,pending,resolved};});
    assert.deepStrictEqual(waitNotice,{visible:true,pending:true,resolved:true},'父窗口 Mvu 尚未出现时必须显示等待状态，且不能伪装就绪');
    const mvuWindow=await page.evaluate(async()=>{
      const live=Array.from(_cardFrontendLive.values()).find(row=>row.kind!=='library'),child=live.frame.contentWindow,originalMessages=__remoteSession.msgs,makeMessage=index=>({role:'assistant',content:'当前-'+index,swipes:['非当前-'+index,'当前-'+index],swipeId:1,seq:index+1}),messages=Array.from({length:12},(_,index)=>makeMessage(index));
      messages[1].yeyuMvu={activeIndex:1,candidates:[{}, {state:{old:true}}]};
      messages[11].yeyuMvu={activeIndex:1,candidates:[{state:{inactive:true}}, {}]};
      __remoteSession.msgs=messages;
      let resolved=false;
      const waiting=child.waitGlobalInitialized('Mvu').then(()=>{resolved=true;});
      await new Promise(resolve=>setTimeout(resolve,120));
      const rejectsOldAndInactive=!resolved;
      child.replaceVariables({stat_data:{recent:true}},{type:'message',message_id:11});
      await waiting;
      const recentCurrentSwipeResolved=resolved;
      child.replaceVariables({},{type:'message',message_id:11});
      let firstResolved=false;
      const firstWaiting=child.waitGlobalInitialized('Mvu').then(()=>{firstResolved=true;});
      await new Promise(resolve=>setTimeout(resolve,120));
      const firstPendingBeforeWrite=!firstResolved;
      child.replaceVariables({stat_data:{first:true}},{type:'message',message_id:0});
      await firstWaiting;
      __remoteSession.msgs=originalMessages;
      refreshCardScriptLibraryContext(__remoteChar,__remoteSession);
      return{rejectsOldAndInactive,recentCurrentSwipeResolved,firstPendingBeforeWrite,firstMessageResolved:firstResolved};
    });
    assert.deepStrictEqual(mvuWindow,{rejectsOldAndInactive:true,recentCurrentSwipeResolved:true,firstPendingBeforeWrite:true,firstMessageResolved:true},'消息 iframe 的 Mvu 等待只接受第 0 楼或末 10 楼当前 swipe 的真实宿主 stat_data');
    const libraryWait=await page.evaluate(async()=>{
      const child=_cardScriptLibraryLive.frame.contentWindow,session=__remoteSession,previous=session.msgs;
      const messages=Array.from({length:1000},(_,index)=>({role:'assistant',content:'active',seq:index+1,swipeId:1,swipes:['inactive','active'],yeyuMvu:{candidates:[{state:{inactive:true}},{}]}}));
      const pause=()=>new Promise(resolve=>setTimeout(resolve,120));
      const settle=waiting=>Promise.race([waiting,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Mvu library wait did not resolve')),2000))]);
      try{
        session.msgs=messages;messages[1].yeyuMvu.candidates[1].state={old:true};messages[989].yeyuMvu.candidates[1].state={old:true};
        let resolved=false;const waiting=child.waitGlobalInitialized('Mvu').then(()=>{resolved=true;});await pause();
        const longPending=!resolved;messages[990].yeyuMvu.candidates[1].state={recent:true};await settle(waiting);
        session.msgs=messages.slice(0,5);delete messages[1].yeyuMvu.candidates[1].state;
        let firstResolved=false;const first=child.waitGlobalInitialized('Mvu').then(()=>{firstResolved=true;});await pause();
        const shortPending=!firstResolved;messages[0].yeyuMvu.candidates[1].state={first:true};await settle(first);
        return{longPending,recentResolved:resolved,shortPending,firstResolved};
      }finally{session.msgs=previous;}
    });
    assert.deepStrictEqual(libraryWait,{longPending:true,recentResolved:true,shortPending:true,firstResolved:true},'脚本库的 Mvu 等待只接受第 0 楼或末 10 楼当前 swipe 的宿主变量');
    const preservedContext=await page.evaluate(()=>{
      const session=__remoteSession,previous=session.msgs,child=_cardScriptLibraryLive.frame.contentWindow;
      try{
        session.msgs=Array.from({length:500},(_,index)=>({role:index%2?'assistant':'user',content:'上下文消息-'+index,seq:index+1,swipes:['上下文消息-'+index],swipeId:0}));
        session.msgs[0].yeyuMvu={activeIndex:0,candidates:[{state:{preserve_probe:true}}]};
        const preserved=refreshCardScriptLibraryContext(__remoteChar,__remoteSession,true);
        const historicalExpected=cardFrontendHostMessageData(__remoteSession.msgs[0],null,__remoteChar),historicalActual=child.getVariables({type:'message',message_id:0});
        const historicalProbe=historicalActual&&historicalActual.stat_data&&historicalActual.stat_data.preserve_probe===true,regular=refreshCardScriptLibraryContext(__remoteChar,__remoteSession,false);
        return{preserved,regular,historicalProbe,historicalVariablesMatch:JSON.stringify(historicalActual)===JSON.stringify(historicalExpected)};
      }finally{session.msgs=previous;refreshCardScriptLibraryContext(__remoteChar,__remoteSession);}
    });
    assert.strictEqual(preservedContext.preserved,true);assert.strictEqual(preservedContext.regular,true);
    assert.strictEqual(preservedContext.historicalProbe,true,'preserveChat 后必须立即读到历史消息的非空宿主变量');
    assert.strictEqual(preservedContext.historicalVariablesMatch,true,'省略无消费者的 messageVariables 投影后，历史消息变量仍须由宿主实时读取');
    const visibleEventFailure=await page.evaluate(async()=>{const live=Array.from(_cardFrontendLive.values()).find(row=>row.kind!=='library'),child=live.frame.contentWindow;window.__remoteEventContinued=0;child.eventOn('remote_visible_error',()=>{throw new Error('事件失败哨兵');});child.eventOn('remote_visible_error',()=>{window.parent.__remoteEventContinued++;});await child.eventEmit('remote_visible_error');return{continued:__remoteEventContinued,note:String(live.node.querySelector('.yeyu-card-frontend-note')?.textContent||'')};});
    assert.strictEqual(visibleEventFailure.continued,1,'一个监听器失败不得阻断后续监听器');assert.match(visibleEventFailure.note,/事件 remote_visible_error 处理失败：事件失败哨兵/,'监听器失败必须在所属前端可见');
    const libraryEventFailure=await page.evaluate(async()=>{const child=_cardScriptLibraryLive.frame.contentWindow;window.__remoteLibraryEventContinued=0;const failed=child.eventOn('remote_library_error',()=>{throw new Error('脚本库事件失败哨兵');}),continued=child.eventOn('remote_library_error',()=>{window.parent.__remoteLibraryEventContinued++;});await child.eventEmit('remote_library_error');failed.stop();continued.stop();return{continued:__remoteLibraryEventContinued,state:_cardScriptLibraryLive.state,visible:Array.from(document.querySelectorAll('#toasts .toast')).some(node=>/脚本库事件失败哨兵/.test(node.textContent||''))};});
    assert.deepStrictEqual(libraryEventFailure,{continued:1,state:'ready',visible:true},'脚本库监听失败必须可见，但不得毒化仍在运行的脚本库');
    const detachedFailure=await page.evaluate(async()=>{const entry=Array.from(_cardFrontendLive.entries())[0],key=entry[0],live=entry[1],originalCall=cardFrontendCall,originalToast=toast,calls=[];toast=function(message,type){calls.push({message:String(message),type:String(type)});return originalToast(message,type);};cardFrontendCall=function(target,name,args){if(name==='remoteDelayedFailure')return new Promise((_,reject)=>setTimeout(()=>reject(new Error('延迟失败哨兵')),40));return originalCall(target,name,args);};const settled=cardFrontendDirectCall(live.token,live.frame.contentWindow,'remoteDelayedFailure',null).catch(error=>String(error&&error.message||error));cardFrontendDispose(key);const error=await settled;cardFrontendCall=originalCall;toast=originalToast;return{error,calls:calls.filter(row=>row.message.includes('延迟失败哨兵'))};});
    assert.deepStrictEqual(detachedFailure,{error:'延迟失败哨兵',calls:[{message:'卡片操作失败：延迟失败哨兵',type:'err'}]},'拥有者前端销毁后，异步宿主失败仍必须恰好显示一次');
    const sameNameSwitch=await page.evaluate(async()=>{
      releaseCardFrontends('');
      const sharedName='同名角色',sharedSessionId='same-name-session',sharedScriptSource='registerVariableSchema(z.object({identity:z.string()}),{type:"character"});parent.__remoteSameNameRuns.push({character:getVariables({type:"character"}).identity,chat:getVariables({type:"chat"}).identity});',makeCharacter=(id,identity)=>{const char=parseCard({name:sharedName,first_mes:'x'});char.id=id;char.scriptsEnabled=true;char.extensions={yeyu:{componentImportMode:'full'},tavern_helper:{scripts:[{id:'same-name-script',name:'同名刷新',type:'script',enabled:true,content:sharedScriptSource}],variables:{identity}}};return char;},first=makeCharacter('same-name-a','first-character'),second=makeCharacter('same-name-b','second-character'),makeSession=identity=>{const session=createBlankSession('同名对话',sharedSessionId);session.msgs.push({role:'assistant',content:'x',seq:1});session.nextMessageSeq=2;session.stscriptVars={identity};return session;},firstSession=makeSession('first-chat'),secondSession=makeSession('second-chat');
      D.characters=[first,second];D.currentCharId=first.id;D.chats={[first.id]:{activeSid:sharedSessionId,sessions:[firstSession]},[second.id]:{activeSid:sharedSessionId,sessions:[secondSession]}};window.__remoteSameNameRuns=[];
      const before=syncCardScriptLibrary(first);await cardScriptLibraryAwaitReady(before);const beforeChild=before.frame.contentWindow,beforeToken=before.token,beforeSignature=cardScriptLibrarySignature(first),secondSignature=cardScriptLibrarySignature(second);
      window.Mvu={};let staleResolved=false;beforeChild.waitGlobalInitialized('Mvu').then(()=>{staleResolved=true;}).catch(error=>{if(error.name!=='AbortError')throw error;});await new Promise(resolve=>setTimeout(resolve,120));const stalePending=!staleResolved;
      await selectCharacter(second.id);const after=_cardScriptLibraryLive;await cardScriptLibraryAwaitReady(after);
      const refresh=refreshCardScriptLibraryContext,ready=hostWriteIsMvuDataReady;let staleRefreshes=0,staleReads=0,staleWaitError='';
      refreshCardScriptLibraryContext=function(...args){staleRefreshes++;return refresh(...args);};hostWriteIsMvuDataReady=function(...args){staleReads++;return ready(...args);};
      try{cardFrontendDirectCall(beforeToken,beforeChild,'isMvuDataReady',null);}catch(error){staleWaitError=String(error&&error.message||error);}finally{refreshCardScriptLibraryContext=refresh;hostWriteIsMvuDataReady=ready;}
      let staleError='';try{cardFrontendDirectConfig(beforeToken,beforeChild);}catch(error){staleError=String(error&&error.message||error);}
      return{stalePending,staleResolved,staleRefreshes,staleReads,staleWaitError,sameName:first.name===second.name,sameSession:firstSession.id===secondSession.id,sameSignature:beforeSignature===secondSignature,ids:[first.id,second.id],tokensDiffer:beforeToken!==after.token,currentId:D.currentCharId,liveCharId:after.charId,liveVariables:{character:after.frame.contentWindow.getVariables({type:'character'}).identity,chat:after.frame.contentWindow.getVariables({type:'chat'}).identity},runs:__remoteSameNameRuns.slice(),beforeError:before.lastError,afterError:after.lastError,staleError};
    });
    assert.strictEqual(sameNameSwitch.sameName,true);assert.strictEqual(sameNameSwitch.sameSession,true);assert.strictEqual(sameNameSwitch.sameSignature,true);assert.deepStrictEqual(sameNameSwitch.ids,['same-name-a','same-name-b']);assert.strictEqual(sameNameSwitch.tokensDiffer,true);assert.strictEqual(sameNameSwitch.currentId,'same-name-b');assert.strictEqual(sameNameSwitch.liveCharId,'same-name-b');assert.deepStrictEqual(sameNameSwitch.liveVariables,{character:'second-character',chat:'second-chat'});assert.strictEqual(sameNameSwitch.beforeError,'');assert.strictEqual(sameNameSwitch.afterError,'');assert.deepStrictEqual(sameNameSwitch.runs,[{character:'first-character',chat:'first-chat'},{character:'second-character',chat:'second-chat'}],JSON.stringify(sameNameSwitch));assert.match(sameNameSwitch.staleError,/失效|切换/,'同名角色切换后旧 iframe 不得继续读取变量');
    assert.strictEqual(sameNameSwitch.stalePending,true);assert.strictEqual(sameNameSwitch.staleResolved,false);assert.strictEqual(sameNameSwitch.staleRefreshes,0);assert.strictEqual(sameNameSwitch.staleReads,0);assert.match(sameNameSwitch.staleWaitError,/失效|切换/);
    assert.deepStrictEqual(errors,[],errors.join('\n'));
  }finally{await browser.close();await Promise.all([appServer,sourceA,sourceB].map(server=>new Promise(resolve=>server.close(resolve))));}
})().catch(error=>{console.error(error&&error.stack||error);process.exit(1);});
