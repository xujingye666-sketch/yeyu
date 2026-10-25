'use strict';
const assert=require('assert'),path=require('path');
const {createAssetServer,listenOnBrowserSafePort,loadPlaywright,resolveEdgeExecutable}=require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
let server,browser;
(async()=>{
  server=createAssetServer(path.resolve(__dirname,'../../app/src/main/assets'));await listenOnBrowserSafePort(server);
  browser=await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const results=await page.evaluate(async()=>{
    const realSave=saveData,realCall=callDeepSeek,results=[];
    try {
      for(const ecosystem of ['st','risu'])for(const mode of ['new','continue','regenerate','swipe']) {
        D=defaults();Object.assign(D.settings,{useMemory:false,embeddingEnabled:false,styleAuditEnabled:false});
        const char={id:ecosystem+'-'+mode,name:'Rollback',extensions:ecosystem==='risu'?{risuai:{triggerscript:[{type:'output',conditions:[],effect:[{type:'setvar',var:'output',operator:'=',value:'FAILED'}]}]}}:{}};
        const session=createBlankSession('Original','original'),message={seq:2,role:'assistant',content:'ORIGINAL',swipes:['ORIGINAL','OTHER'],swipeId:0};
        const rows=[{seq:1,role:'user',content:'HISTORY'},message];session.msgs=rows;session.greetingChosen=true;session.creatorNotesSeen=true;session.nextMessageSeq=3;
        D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};
        const box=D.chats[char.id],memory=session.memoryStore;
        renderChat();
        let entered,fail;const started=new Promise(resolve=>{entered=resolve;});
        callDeepSeek=async()=>({content:'FAILED_REPLY',reasoning:'',finishReason:'stop'});
        saveData=(...args)=>rows.some(row=>String(row.content).includes('FAILED_REPLY'))?new Promise((_,reject)=>{fail=reject;entered();}):realSave(...args);
        const task=mode==='new'?doSendMessage('NEW_USER'):mode==='continue'?continueGeneration():mode==='regenerate'?regenerateLast():generateMessageSwipe(1);
        await started;
        fail(new Error('synthetic generated response save failure'));const ok=await task;saveData=realSave;
        results.push({ecosystem,mode,ok,identity:D.chats[char.id]===box&&getActiveSession(char.id)===session&&session.msgs===rows&&session.memoryStore===memory&&rows.includes(message),
          own:message.content==='ORIGINAL'&&message.swipeId===0&&message.swipes.join('|')==='ORIGINAL|OTHER'&&!rows.some(row=>String(row.content).includes('FAILED_REPLY')),
          unchanged:session.name==='Original'&&(mode!=='new'||rows.some(row=>row.content==='NEW_USER')),
          risu:ecosystem!=='risu'||!session.risu||session.risu.scriptstate.$output===undefined});
        if(ecosystem==='risu')releaseRisuExecutionSession(session);
      }
      for(const mode of ['full','display','new-state','empty-state']) {
        D=defaults();const char={id:'risu-manual',name:'Risu',description:'ORIGINAL_DESCRIPTION',extensions:{risuai:{}}},persona={id:'persona',name:'Persona',desc:'ORIGINAL_PERSONA',boundCharIds:[]};
        const session=createBlankSession('Original','original'),first={seq:1,role:'user',content:'FIRST',risu:{source:'FIRST',text:'DERIVED'}},second={seq:2,role:'assistant',content:'SECOND'},third={seq:3,role:'assistant',content:'THIRD'};
        const rows=[first,second,third];session.msgs=rows;session.nextMessageSeq=4;
        if(!['new-state','empty-state'].includes(mode))session.risu={scriptstate:{$count:'OLD'}};
        D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};D.personas=[persona];D.activePersonaId=persona.id;
        let entered,fail;const started=new Promise(resolve=>{entered=resolve;});saveData=()=>new Promise((_,reject)=>{fail=reject;entered();});
        const task=risuWithExecution(char,session,mode==='display'?{readOnly:true,displayVars:true}:{},async context=>{
          context.setVar('count','FAILED');
          if(mode!=='display') {
            context.setCharacterDescription('FAILED_DESCRIPTION');context.setPersonaDescription('FAILED_PERSONA');
            context.messages[0].data='FIRST';context.messages.splice(1,1);context.messages.reverse();context.messages.push({role:'char',data:'INSERTED'});
          }
        }).then(()=>false,()=>true);
        await started;
        fail(new Error('synthetic Risu transaction save failure'));const rejected=await task;saveData=realSave;
        results.push({mode,rejected,identity:session.msgs===rows,rows:rows.length===3&&[first,second,third].every((row,index)=>rows[index]===row),
          own:(session.risu&&session.risu.scriptstate.$count)===(['new-state','empty-state'].includes(mode)?undefined:'OLD')&&char.description==='ORIGINAL_DESCRIPTION'&&first.risu.source==='FIRST'&&first.risu.text==='DERIVED',
          unchanged:(!['new-state','empty-state'].includes(mode)||!Object.hasOwn(session,'risu'))&&char.name==='Risu'&&persona.desc==='ORIGINAL_PERSONA'});
        releaseRisuExecutionSession(session);
      }
    } finally {saveData=realSave;callDeepSeek=realCall;}
    return results;
  });
  for(const row of results)assert.ok(row.identity&&row.own&&row.unchanged&&(row.ecosystem?(!row.ok&&row.risu):(row.rejected&&row.rows)),JSON.stringify(row));
  console.log('PASS generated response and Risu scoped rollback');

  // Card scripts and Risu start triggers insert or delete messages while a reply is being generated.
  // The reply still lands on the assistant message it was aimed at, the generation leaves no second
  // draft behind, and a stopped candidate's marker stays with that candidate.
  const moved=await page.evaluate(async()=>{
    const realCall=callDeepSeek,out={};
    async function until(predicate,label){const deadline=Date.now()+8000;while(!predicate()){if(Date.now()>deadline)throw new Error(label);await new Promise(resolve=>setTimeout(resolve,10));}}
    async function storedDrafts(){return (await YeyuRepository.loadStreamDrafts(sanitizeStoredStreamDraft)).drafts.length;}
    // Each queued reply streams `first` at once; a gated reply waits for release() before the rest.
    let replies=[],requestCount=0;
    function reply(first,rest,gated){let release,started;const gate=new Promise(resolve=>{release=resolve;}),sent=new Promise(resolve=>{started=resolve;});replies.push({first,rest,gated,gate,started});return {release,sent};}
    callDeepSeek=async(messages,target,options)=>{
      requestCount++;
      const next=replies.shift(),controller=abortController,encoder=new TextEncoder(),frame=delta=>encoder.encode('data: '+JSON.stringify({choices:[delta]})+'\n\n');
      if(!next)throw new Error('unexpected request');
      setGenerationState('streaming');
      const body=new ReadableStream({async start(stream){
        controller.signal.addEventListener('abort',()=>stream.error(new DOMException('Stopped','AbortError')),{once:true});
        stream.enqueue(frame({delta:{content:next.first}}));next.started();
        if(next.gated)await next.gate;
        if(controller.signal.aborted)return;
        stream.enqueue(frame({delta:{content:next.rest},finish_reason:'stop'}));stream.enqueue(encoder.encode('data: [DONE]\n\n'));stream.close();
      }});
      return streamResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}),target,options);
    };
    async function setup(id,rows,risuTriggers){
      D=defaults();Object.assign(D.settings,{useMemory:false,embeddingEnabled:false,styleAuditEnabled:false,maxContextTokens:0,maxTokens:0});
      const char=parseCard({name:'Moving target',first_mes:'opening'});char.id=id;char.scriptsEnabled=true;
      char.extensions=risuTriggers?{risuai:{triggerscript:risuTriggers}}:{yeyu:{componentImportMode:'full'}};
      const session=createBlankSession('Moving target',id+'-session');
      session.msgs=rows.map((row,index)=>Object.assign({seq:index+1,time:1,swipes:[row.content],swipeId:0},row));
      session.nextMessageSeq=rows.length+1;session.greetingChosen=true;session.creatorNotesSeen=true;
      D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{sessions:[session],activeSid:session.id}};
      await saveData(['meta','characters','sessions'],{urgent:true});
      switchAppPage('chat');updateChatUI();renderChat();
      let live=null;
      if(!risuTriggers)await until(()=>(live=Array.from(_cardFrontendLive.values()).find(row=>row.owner&&row.owner.messageSeq===1)),'opening card frame missing');
      return {char,session,live,bySeq:seq=>session.msgs.find(row=>row.seq===seq)};
    }
    async function persisted(char,session){const data=(await YeyuRepository.load()).data;return JSON.stringify(data.chats[char.id].sessions.find(row=>row.id===session.id).msgs.map(row=>[row.seq,row.role,row.content,row.swipes]))===JSON.stringify(session.msgs.map(row=>[row.seq,row.role,row.content,row.swipes]));}
    const card='<div>live<script>window.cardReady=true;<\/script></div>',insertAtStart=live=>hostWriteCreateChatMessages(live,{messages:[{role:'system',message:'脚本插入'}],option:{insert_at:0}});
    try {
      for(const mode of ['regenerate','swipe']) {
        const {char,session,live,bySeq}=await setup('moved-'+mode,[{role:'assistant',content:card,opening:true},{role:'user',content:'U1'},{role:'assistant',content:'A1'}]);
        const stream=reply('新1。','新2。',true);
        const task=mode==='regenerate'?regenerateLast():generateMessageSwipe(2);
        await stream.sent;await until(()=>_activeStreamDraft&&_activeStreamDraft.text.includes('新1'),'draft checkpoint missing');
        await insertAtStart(live);stream.release();
        out[mode]={ok:await task,user:bySeq(2).content==='U1'&&bySeq(2).swipes.join('|')==='U1',reply:bySeq(3).content==='新1。新2。'&&bySeq(3).swipes.join('|')==='A1|新1。新2。',
          drafts:_streamDrafts.length+await storedDrafts(),persisted:await persisted(char,session)};
      }
      {
        const {char,session,live,bySeq}=await setup('moved-continue',[{role:'assistant',content:card,opening:true},{role:'user',content:'U1'},{role:'assistant',content:'A1'},{role:'user',content:'U2'},{role:'assistant',content:'A2'}]);
        const stream=reply('续1。','续2。',true),task=continueGeneration();
        await stream.sent;await until(()=>_activeStreamDraft&&_activeStreamDraft.text.includes('续1'),'draft checkpoint missing');
        await hostWriteDeleteChatMessages(live,{messageIds:[1]});stream.release();
        out.continue={ok:await task,reply:bySeq(5).content==='A2续1。续2。',removed:!bySeq(2),drafts:_streamDrafts.length+await storedDrafts(),persisted:await persisted(char,session)};
      }
      {
        // A normal streamed reply stays with its target when a script inserts a message before it.
        // A length instruction remains user text and causes only this one request.
        const {char,session,live}=await setup('moved-new',[{role:'assistant',content:card,opening:true}]);
        const stream=reply('短回复。','结束。',true),beforeRequests=requestCount;
        const task=doSendMessage('【正文不少于40字】');
        await stream.sent;await until(()=>_activeStreamDraft&&_activeStreamDraft.text.includes('短回复'),'new checkpoint missing');
        await insertAtStart(live);stream.release();
        const ok=await task,assistant=session.msgs.filter(row=>row.role==='assistant'&&!row.opening);
        out.new={ok,one:assistant.length===1,requests:requestCount-beforeRequests,reply:assistant[0].content==='短回复。结束。',
          user:session.msgs.find(row=>row.role==='user').content==='【正文不少于40字】',drafts:_streamDrafts.length+await storedDrafts(),persisted:await persisted(char,session)};
      }
      {
        // A Risu start trigger inserts a message before every request; regeneration and continuation follow the reply.
        const {char,session,bySeq}=await setup('moved-risu',[{role:'assistant',content:'opening',opening:true},{role:'user',content:'U1'},{role:'assistant',content:'A1'}],
          [{type:'start',conditions:[],effect:[{type:'triggerlua',code:"function onStart(id) insertChat(id, 0, 'user', 'LUA插入') end"}]}]);
        reply('重写。','',false);const regenerated=await regenerateLast(),afterRegenerate=bySeq(3).content==='重写。';
        reply('接着。','',false);const continued=await continueGeneration();
        out.risu={regenerated,afterRegenerate,continued,reply:bySeq(3).content==='重写。接着。'&&bySeq(3).swipes.join('|')==='A1|重写。接着。',
          user:bySeq(2).content==='U1'&&bySeq(2).swipes.join('|')==='U1',inserted:session.msgs.filter(row=>row.content==='LUA插入').length,persisted:await persisted(char,session)};
        releaseRisuExecutionSession(session);
      }
      {
        // Stopped while a script writes the chat, then regenerated: one reply, no leftover draft, and only
        // the stopped candidate keeps the stopped marker.
        const {char,session,live}=await setup('moved-stop',[{role:'assistant',content:card,opening:true}]);
        const stream=reply('半1。','',true),task=doSendMessage('开始');
        await stream.sent;await until(()=>_activeStreamDraft&&_activeStreamDraft.text.includes('半1'),'draft checkpoint missing');
        await hostWriteCreateChatMessages(live,{messages:[{role:'system',message:'脚本追加'}]});
        stopGeneration();await task;
        const stopped=session.msgs.find(row=>row.role==='assistant'&&!row.opening);
        const afterStop={incomplete:messageIsIncomplete(stopped),drafts:_streamDrafts.length+await storedDrafts()};
        reply('全1。','全2。',false);const regenerated=await regenerateLast();
        out.stop={afterStop,regenerated,active:stopped.content==='全1。全2。'&&!messageIsIncomplete(stopped),
          stoppedSlot:!!(stopped.swipeGenerationMeta&&stopped.swipeGenerationMeta[0]&&stopped.swipeGenerationMeta[0].incomplete===true),
          drafts:_streamDrafts.length+await storedDrafts(),persisted:await persisted(char,session)};
        await switchMessageSwipe(session.msgs.indexOf(stopped),-1);
        out.stop.switchedBack=stopped.content==='半1。'&&messageIsIncomplete(stopped);
        await switchMessageSwipe(session.msgs.indexOf(stopped),1);
        out.reloadExpect={charId:char.id,seqs:session.msgs.map(row=>row.seq),swipes:stopped.swipes.length};
      }
    } finally {callDeepSeek=realCall;}
    return out;
  });
  const reloadExpect=moved.reloadExpect;delete moved.reloadExpect;
  assert.deepStrictEqual(moved,{
    regenerate:{ok:true,user:true,reply:true,drafts:0,persisted:true},
    swipe:{ok:true,user:true,reply:true,drafts:0,persisted:true},
    continue:{ok:true,reply:true,removed:true,drafts:0,persisted:true},
    new:{ok:true,one:true,requests:1,reply:true,user:true,drafts:0,persisted:true},
    risu:{regenerated:true,afterRegenerate:true,continued:true,reply:true,user:true,inserted:2,persisted:true},
    stop:{afterStop:{incomplete:true,drafts:0},regenerated:true,active:true,stoppedSlot:true,drafts:0,persisted:true,switchedBack:true},
  },'脚本或 Risu 开始触发器在生成期间挪动消息后，回复仍须写到原助手消息且不留草稿');
  await page.reload({waitUntil:'load'});
  await waitForAppReady(page, {timeout:15000});
  const reloaded=await page.evaluate(async()=>{
    await initStreamDraftRecovery();
    const session=getActiveSession(D.currentCharId),reply=session.msgs.find(row=>row.role==='assistant'&&!row.opening);
    return {seqs:session.msgs.map(row=>row.seq),swipes:reply.swipes.length,incomplete:messageIsIncomplete(reply),drafts:_streamDrafts.length};
  });
  assert.deepStrictEqual(reloaded,{seqs:reloadExpect.seqs,swipes:reloadExpect.swipes,incomplete:false,drafts:0},'重载后不得多出候选或回复，新回复不带未完成标记');
  console.log('PASS generation target follows the reply through script and Risu chat mutations');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
