/* global __char, __session -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';
const assert=require('assert'),fs=require('fs'),http=require('http'),path=require('path');
const {loadPlaywright,listenOnBrowserSafePort,resolveEdgeExecutable}=require('./source');
const {waitForAppReady}=require('./helpers/app-ready');
const root=path.resolve(__dirname,'../..'),assets=path.join(root,'app/src/main/assets');
let probeHits=0;

function serve(req,res){
  const relative=decodeURIComponent(String(req.url||'/').split('?')[0]).replace(/^\/+/, '');
  if(relative==='mvu-probe.js'){probeHits++;res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'});res.end('self.__mvuNetworkEscaped=true; export default true;');return;}
  if(relative==='favicon.ico'){res.writeHead(204);res.end();return;}
  const file=path.join(assets,relative);if(!file.startsWith(assets)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
  const ext=path.extname(file),type=ext==='.js'?'application/javascript; charset=utf-8':ext==='.html'?'text/html; charset=utf-8':'application/octet-stream';res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(fs.readFileSync(file));
}

(async()=>{
  const server=http.createServer(serve),port=await listenOnBrowserSafePort(server),browser=await loadPlaywright().chromium.launch({headless:true,executablePath:resolveEdgeExecutable()}),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(String(error&&error.stack||error)));
  try{
    await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'load'});
    await waitForAppReady(page);
    const result=await page.evaluate(async()=>{
      D=defaults();
      let contextRefreshes=0;
      const originalRefresh=refreshCardScriptLibraryContext;
      refreshCardScriptLibraryContext=function(...args){contextRefreshes++;return originalRefresh(...args);};
      function useSession(session){
        const active=Object.assign(createBlankSession(session.id,session.id),session);
        const box=D.chats[__char.id]||(D.chats[__char.id]={sessions:[]});
        box.sessions.push(active);box.activeSid=active.id;
        window.__session=active;
        return active;
      }
      function useEntries(entries){
        D.worldBook.categories=[{id:'mvu-init',name:'MVU initial state',boundCharIds:['synthetic'],entries:entries.map((entry,index)=>normalizeWBEntry(Object.assign({id:'init-'+index},entry)))}];
      }
      const url='https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
      const legalIdentifiers="const a='a',b='b',c='c';return foo({x: a, y: b, z2: c});",legalBooleans='return cfg({a: 1, strict: true, b: 2});';
      const erasedIdentifiers=mvuEraseSupportedTypescript(legalIdentifiers),erasedBooleans=mvuEraseSupportedTypescript(legalBooleans);
      const legalIdentifiersValue=Function('foo',erasedIdentifiers)(value=>value),legalBooleansValue=Function('cfg',erasedBooleans)(value=>value);
      const typedSource='const clamp=(lo: number, hi: number)=>Math.min(hi,Math.max(lo,5));const value=({answer:clamp(0,10)} as Record<string, unknown>);return value;',typedErased=mvuEraseSupportedTypescript(typedSource),typedValue=Function(typedErased)();
      const protectedSource='import type { Shape } from "./types.js";\nconst label="hello as Record)";/* keep as Record) */const pattern=/hello as Record\\)/;const normalize=(value: unknown)=>value as Record<string, unknown>;return {label,comment:true,regex:pattern.test(label),value:normalize({ok:true})};',protectedErased=mvuEraseSupportedTypescript(protectedSource),protectedValue=Function(protectedErased)();
      const schema=`import { registerMvuSchema } from '${url}';\nconst label='import'; /* import another module */ const pattern=/import/; const note=\`import text\`;\nexport const Schema = z.object({score:z.coerce.number().transform(v=>_.clamp(v,0,10)).prefault(1),name:z.string().prefault('old'),items:z.array(z.string()).prefault([]),nested:z.record(z.string(),z.number()).prefault({}),'$hidden':z.number().prefault(9),_locked:z.number().prefault(4)});\n$(()=>registerMvuSchema(Schema));`;
      useEntries([{comment:'[initvar]',enabled:false,content:'stat_data:\n  score: "1"\n  name: old\n  items: [a, b]\n  nested:\n    a/b: 1\n  $hidden: 9\n  _locked: 4'}]);
      window.__char={id:'synthetic',extensions:{tavern_helper:{scripts:[{type:'folder',id:'folder',name:'Folder',scripts:[{type:'folder',id:'nested',name:'Nested',scripts:[{id:'schema',enabled:true,content:schema}]}]}]}}};
      D.characters=[__char];D.currentCharId=__char.id;
      setPreparedComponentMode(__char,'basic');
      if(mvuEnabled(__char))throw new Error('basic import must start disabled');
      useSession({id:'switch',msgs:[]});
      await toggleCardScripts(true);
      if(!mvuEnabled(__char)||!cardFrontendReady(__char))throw new Error('basic import must honor the current script switch');
      if(__char.regexEnabled!==false)throw new Error('script switch must preserve regex switch');
      for(const unsupported of ['import("./other.js");','import thing from "./other.js";','const dynamic=`value ${import("./other.js")}`;']){
        const script=__char.extensions.tavern_helper.scripts[0].scripts[0].scripts[0],before=script.content;
        script.content=before+'\n'+unsupported;
        try{mvuPrepareSchemaSource(__char);throw new Error('unsupported import accepted');}catch(error){if(!/依赖其他远程模块/.test(error.message))throw error;}finally{script.content=before;}
      }
      const nestedScript=__char.extensions.tavern_helper.scripts[0].scripts[0].scripts[0],fakeImport=`\nimport { registerMvuSchema } from '${url}';\n`;
      nestedScript.content=schema+'\nconst quotedImport=`'+fakeImport+'`;\n/*'+fakeImport+'*/';
      const prepared=mvuPrepareSchemaSource(__char);
      if(!prepared.source.includes('`'+fakeImport+'`')||!prepared.source.includes('/*'+fakeImport+'*/'))throw new Error('quoted imports must remain unchanged');
      nestedScript.content=schema;
      if(mvuRemoteImportAddresses('const fake="import(\'https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js\')";').length)throw new Error('quoted imports must not claim MVU bundle ownership');
      const valid='<UpdateVariable><Analysis>ok</Analysis><JSONPatch>[{"op":"delta","path":"/score","value":2},{"op":"replace","path":"/name","value":"new"},{"op":"insert","path":"/items/1","value":"x"},{"op":"move","from":"/items/0","path":"/items/2"},{"op":"remove","path":"/nested/a~1b"}]</JSONPatch></UpdateVariable>';
      const protectedUpdate='<UpdateVariable><JSONPatch>[{"op":"replace","path":"/$hidden","value":0}]</JSONPatch></UpdateVariable>';
      useSession({id:'s1',msgs:[{role:'assistant',seq:1,content:valid},{role:'assistant',seq:2,content:protectedUpdate}]});
      const first=await rebuildMvuSession(__char,__session,__session.msgs),state=first.status.state,raw=__session.msgs[0].content,hiddenMacro=replaceMvuVariableMacros('{{format_message_variable::stat_data}}',__char,{session:__session}),pathMacro=replaceMvuVariableMacros('{{format_message_variable::stat_data.name}}',__char,{session:__session});
      const beforeInvalid=__session.msgs[0].yeyuMvu.candidates[0].state,afterInvalid=__session.msgs[1].yeyuMvu.candidates[0];
      const hiddenPathMacro=replaceMvuVariableMacros('{{format_message_variable::stat_data.$hidden}}',__char,{session:__session});
      const swipeA='<UpdateVariable><JSONPatch>[{"op":"replace","path":"/score","value":5}]</JSONPatch></UpdateVariable>',swipeB='<UpdateVariable><JSONPatch>[{"op":"replace","path":"/score","value":7}]</JSONPatch></UpdateVariable>',downstream='<UpdateVariable><JSONPatch>[{"op":"delta","path":"/score","value":1}]</JSONPatch></UpdateVariable>';
      useSession({id:'s2',msgs:[{role:'assistant',seq:1,content:swipeA,swipes:[swipeA,swipeB],swipeId:0},{role:'assistant',seq:2,content:downstream}]});
      await rebuildMvuSession(__char,__session,__session.msgs);const firstSwipe=__session.msgs[1].yeyuMvu.candidates[0].state.score,candidateStates=__session.msgs[0].yeyuMvu.candidates.map(row=>row.state.score);
      __session.msgs[0].swipeId=1;__session.msgs[0].content=swipeB;const switched=await rebuildMvuSession(__char,__session,__session.msgs);
      __session.msgs[0].content='<UpdateVariable><JSONPatch>[{"op":"replace","path":"/score","value":2}]</JSONPatch></UpdateVariable>';__session.msgs[0].swipes[1]=__session.msgs[0].content;const edited=await rebuildMvuSession(__char,__session,__session.msgs);
      __session.msgs.splice(0,1);const deleted=await rebuildMvuSession(__char,__session,__session.msgs);
      const branch=useSession(Object.assign(JSON.parse(JSON.stringify(__session)),{id:'branch'}));const branched=await rebuildMvuSession(__char,branch,branch.msgs);
      await saveData(['meta','characters','worldbook','sessions'],{urgent:true});
      terminateMvuWorker(__char);delete window._mvuRuntime['synthetic|branch'];
      D=await loadDataAsync();window.__char=getChar();window.__session=getActiveSession(__char.id);
      const restoredFromStorage=__session!==branch&&__session.id==='branch';
      if(!mvuEnabled(__char)||!cardFrontendReady(__char)||__char.regexEnabled!==false||__char.extensions.yeyu.componentImportMode!=='basic')throw new Error('script switch must survive saving and reloading');
      const reloaded=await rebuildMvuSession(__char,__session,__session.msgs);
      __char.extensions.tavern_helper.scripts=[{id:'schema',enabled:true,content:schema}];
      const probeUrl=location.origin+'/mvu-probe.js',networkSchema=`import { registerMvuSchema } from '${url}';\nconst restore=z.constructor.constructor;restore('return '+('im'+'port')+'(${JSON.stringify(probeUrl)})')().catch(()=>{});\nexport const Schema=z.object({network:z.boolean().transform(()=>typeof fetch==='undefined'&&typeof XMLHttpRequest==='undefined'&&typeof WebSocket==='undefined'&&typeof WebTransport==='undefined'&&typeof navigator==='undefined').prefault(false)});\n$(()=>registerMvuSchema(Schema));`;
      window.__char.extensions.tavern_helper.scripts[0].content=networkSchema;useEntries([{comment:'[initvar]',enabled:false,content:'stat_data:\n  network: false'}]);useSession({id:'network',msgs:[]});const sandboxed=(await rebuildMvuSession(__char,__session,[])).status.state.network;
      await new Promise(resolve=>setTimeout(resolve,100));
      const pointerSchema=`import { registerMvuSchema } from '${url}';\n$(()=>registerMvuSchema(z.object({'':z.number(),'a~b':z.number()})));`;
      window.__char.extensions.tavern_helper.scripts[0].content=pointerSchema;terminateMvuWorker(__char);await mvuEnsureSchema(__char);
      const emptyKey=await mvuCall(__char,{type:'apply',base:{'':1,'a~b':1},operations:[{op:'replace',path:'/',value:2},{op:'replace',path:'/a~0b',value:3}]});
      const atomicSchema=`import { registerMvuSchema } from '${url}';\n$(()=>registerMvuSchema(z.object({value:z.string().transform(v=>{if(v==='hang'){while(true){}}return v;})})));`;
      window.__char.extensions.tavern_helper.scripts[0].content=atomicSchema;useEntries([{comment:'[initvar]',enabled:false,content:'stat_data:\n  value: init'}]);useSession({id:'atomic',msgs:[{role:'assistant',content:'<UpdateVariable><JSONPatch>[{"op":"replace","path":"/value","value":"first"}]</JSONPatch></UpdateVariable>'},{role:'assistant',content:'<UpdateVariable><JSONPatch>[{"op":"replace","path":"/value","value":"hang"}]</JSONPatch></UpdateVariable>'}]});
      terminateMvuWorker(__char);const atomicPending=rebuildMvuSession(__char,__session,__session.msgs).then(()=>'',error=>String(error&&error.message||error));setTimeout(()=>stopMvuRuntime(__char,__session),25);const atomicStopped=await atomicPending,atomicRecords=__session.msgs.map(message=>Object.prototype.hasOwnProperty.call(message,'yeyuMvu')),atomicStatus=mvuRuntimeStatus(__char,__session).kind;
      const swipeMessage={role:'assistant',content:'edited',swipes:['old','other'],swipeId:0};syncMvuMessageActiveSwipe(swipeMessage);
      return{legalTypescriptGate:{identicalIdentifiers:erasedIdentifiers===legalIdentifiers,identicalBooleans:erasedBooleans===legalBooleans,identifiers:legalIdentifiersValue,booleans:legalBooleansValue,typedChanged:typedErased!==typedSource,typedValue,protectedChanged:protectedErased!==protectedSource,typeImportErased:!protectedErased.includes('import type'),protectedLiteral:protectedValue.label,protectedComment:protectedErased.includes('/* keep as Record) */'),protectedRegex:protectedValue.regex,protectedValue:protectedValue.value},state,rawKept:raw===valid,display:stripMvuProtocolForDisplay(valid+'\n正文'),macroLeaksHidden:hiddenMacro.includes('$hidden'),hiddenPathMacro,pathMacro,beforeInvalid,afterInvalid,candidateStates,firstSwipe,switchedScore:switched.status.state.score,editedScore:edited.status.state.score,deletedScore:deleted.status.state.score,branchedScore:branched.status.state.score,reloadedScore:reloaded.status.state.score,sandboxed,emptyKey,atomicStopped,atomicRecords,atomicStatus,swipeMessage,contextRefreshes,restoredFromStorage};
    });
    assert.deepStrictEqual(result.legalTypescriptGate,{identicalIdentifiers:true,identicalBooleans:true,identifiers:{x:'a',y:'b',z2:'c'},booleans:{a:1,strict:true,b:2},typedChanged:true,typedValue:{answer:5},protectedChanged:true,typeImportErased:true,protectedLiteral:'hello as Record)',protectedComment:true,protectedRegex:true,protectedValue:{ok:true}},'合法 JS 必须逐字保留；仅擦除类型 import 与词法代码中的受支持 TS，字符串、注释、对象属性与正则必须原样保留');
    assert.strictEqual(result.state.score,3);assert.strictEqual(result.state.name,'new');assert.deepStrictEqual(result.state.items,['x','b','a']);assert.deepStrictEqual(result.state.nested,{});
    assert.strictEqual(result.rawKept,true,'MVU 只能改显示副本，不能改消息原文');assert.strictEqual(result.display,'正文');assert.strictEqual(result.macroLeaksHidden,false,'$ 私有字段不得进入 Prompt 宏');assert.strictEqual(result.hiddenPathMacro,'','$ 私有字段不得通过路径宏直读');assert.strictEqual(result.pathMacro,'new','变量路径宏必须读取指定字段');
    assert.deepStrictEqual(result.afterInvalid.state,result.beforeInvalid,'受保护路径失败后必须保留上一有效状态');assert.match(result.afterInvalid.error,/受保护变量/);
    assert.deepStrictEqual(result.candidateStates,[5,7]);assert.strictEqual(result.firstSwipe,6);assert.strictEqual(result.switchedScore,8,'切换早期候选后必须重放下游变量');assert.strictEqual(result.editedScore,3,'编辑早期候选后必须重放下游变量');assert.strictEqual(result.deletedScore,2,'删除早期消息后必须重放剩余消息');assert.strictEqual(result.branchedScore,2,'分支副本必须重建同一状态');assert.strictEqual(result.restoredFromStorage,true,'重放必须使用真实保存后重新读取的分支会话');assert.strictEqual(result.reloadedScore,2,'重新载入后必须从持久消息重建状态');assert.strictEqual(result.sandboxed,true,'Schema Worker 不得访问网络或存储能力');assert.strictEqual(probeHits,0,'恢复 Function 后的动态 import 仍必须被 CSP 拦截');
    assert.deepStrictEqual(result.emptyKey, {'': 2, 'a~b': 3}, 'JSON Pointer 的合法空键与转义键必须可写');
    assert.match(result.atomicStopped, /手动停止/);
    assert.deepStrictEqual(result.atomicRecords, [false, false], '停止重建不得留下部分消息记录');
    assert.strictEqual(result.atomicStatus, 'stopped');
    assert.deepStrictEqual(result.swipeMessage.swipes,['edited','other']);assert.ok(result.contextRefreshes>=8,'每次成功 MVU 重放都应刷新常驻脚本库上下文');
    assert.deepStrictEqual(errors,[],errors.join('\n'));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
