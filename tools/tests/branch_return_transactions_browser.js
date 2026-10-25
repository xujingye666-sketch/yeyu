'use strict';
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
let browser, server;
(async () => {
  server=createAssetServer(path.resolve(__dirname,'../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser=await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const proof=await page.evaluate(async()=>{
    D=defaults();D.settings.useMemory=false;
    const char={id:'branch-transaction',name:'支线事务',extensions:{}};
    D.characters=[char];D.currentCharId=char.id;
    const realSave=saveData, realRequest=requestStructuredJson, results=[];
    const originals={cancelGenerationPostCommit,prepareRegexScriptDisplayTexts,qrPerformAuto,presetTaskCall,markStreamDraftsStaleForSession},events=[];
    cancelGenerationPostCommit=function(session){events.push('cancel:'+session.id);return originals.cancelGenerationPostCommit(session);};
    prepareRegexScriptDisplayTexts=function(...args){events.push('regex');return originals.prepareRegexScriptDisplayTexts(...args);};
    qrPerformAuto=function(name,...args){events.push('qr:'+name);return originals.qrPerformAuto(name,...args);};
    presetTaskCall=function(name,...args){events.push('preset:'+name);return originals.presetTaskCall(name,...args);};
    markStreamDraftsStaleForSession=function(charId,sid,reason,...args){events.push('draft:'+sid+':'+reason);return originals.markStreamDraftsStaleForSession(charId,sid,reason,...args);};
    requestStructuredJson=async()=>({returnBrief:'支线已经走过一座桥。'});
    try {
      for(const later of [false,true]){
        const parent=createBlankSession('父对话','parent-'+later);
        const box={activeSid:parent.id,sessions:[parent]};D.chats[char.id]=box;
        await saveMsg('user','共同起点');await saveMsg('assistant','分支点');
        events.length=0;await createBranchAtMessage(1);
        const createEvents=events.slice();
        const branch=getActiveSession(char.id);
        if(branch===parent)throw new Error('真实创建支线入口未成功');
        await saveMsg('user','进入支线');await saveMsg('assistant','走过桥梁');
        await prepareBranchMerge(branch.id);await chooseBranchReturnMode('continue_story');
        const mergeId=_pendingBranchMerge && _pendingBranchMerge.mergeId;
        if(!mergeId)throw new Error('真实回归预览入口未成功');
        document.getElementById('branch-return-brief').value='用户编辑后的回归摘要';
        events.length=0;await confirmBranchMerge();
        const mergeEvents=events.slice();
        const card=branchReturnFindCard(parent,mergeId),copy=branchReturnFindCopy(parent,mergeId);
        if(!card || !copy || getActiveSession(char.id)!==parent)throw new Error('真实确认回归入口未成功');
        if(later)await saveMsg('user','回归后的后续剧情');
        const beforeMerge=branch.lastMergedSeq, beforeNext=parent.nextMessageSeq;
        let fail,started;const saving=new Promise(resolve=>{started=resolve;});
        saveData=()=>new Promise((_,reject)=>{fail=reject;started();});
        const undo=undoBranchReturn(mergeId);await saving;
        fail(new Error('synthetic undo save failure'));await undo;saveData=realSave;
        const kept=D.chats[char.id]===box && box.sessions.includes(parent) && box.sessions.includes(branch)
          && parent.msgs.includes(card) && parent.msgs.includes(copy) && !card.reverted && !copy.reverted
          && branch.lastMergedSeq===beforeMerge && parent.nextMessageSeq>=beforeNext
          && !parent.msgs.some(row=>row.kind==='branch-return-revert');
        await saveData('sessions',{urgent:true});
        const disk=(await YeyuRepository.load()).data.chats[char.id].sessions.find(row=>row.id===parent.id);
        results.push({later,kept,edited:card.content.includes('用户编辑后的回归摘要'),persisted:disk.msgs.some(row=>row.mergeId===mergeId),
          lifecycle:[{from:parent.id,list:createEvents},{from:branch.id,list:mergeEvents}].every(({from,list})=>{
            const expected=['cancel:'+from,'draft:'+from+':branch_switched','regex','qr:executeOnChatChange','preset:onSessionChanged','preset:onChatChanged'];
            return expected.every((value,index)=>list.indexOf(value)>=0&&(index===0||list.indexOf(value)>list.indexOf(expected[index-1])));
          })});
        // A second tap while the first undo is still saving is ignored instead of reporting a broken record.
        const notices=[],realToast=toast;toast=(message,...args)=>{notices.push(String(message));return realToast(message,...args);};
        const undoing=undoBranchReturn(mergeId),second=await undoBranchReturn(mergeId),success=await undoing;toast=realToast;
        results[results.length-1].doubleTap=second===undefined && notices.length===1 && /已撤销本次回归|已移除本次回归/.test(notices[0]);
        results[results.length-1].retry=success===true && (later
          ? card.reverted===true && copy.reverted===true && parent.msgs.some(row=>row.kind==='branch-return-revert')
          : !parent.msgs.includes(card) && !parent.msgs.includes(copy));
      }
    } finally {saveData=realSave;requestStructuredJson=realRequest;Object.assign(window,originals);}
    return results;
  });
  for(const row of proof)assert.ok(row.kept && row.edited && row.persisted && row.retry && row.doubleTap && row.lifecycle,JSON.stringify(row));
  // Branches and checkpoints start from the parent line's current Risu chat state (not the fork point's)
  // and own a separate copy of it afterwards.
  const risuCopies=await page.evaluate(async()=>{
    D=defaults();const char={id:'branch-risu',name:'Risu',extensions:{risuai:{}}},parent=createBlankSession('Parent','parent');
    parent.msgs=[{seq:1,role:'user',content:'POINT'},{seq:2,role:'assistant',content:'FORK'},
      {seq:3,role:'user',content:'FUTURE QUESTION'},{seq:4,role:'assistant',content:'FUTURE REPLY'}];
    parent.risu={scriptstate:{$hp:'7'},globalVariables:{toggle_mode:'1',round:'2'},localLore:[{key:'k',comment:'local',content:'LORE'}],authorNote:'NOTE'};
    D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:parent.id,sessions:[parent]}};
    await saveData(['meta','characters','sessions'],{urgent:true});
    parent.tavernHelperChatLorebook='CHAT_BOOK';
    parent.tavernHelperMetadata={nested:{value:'METADATA'}};
    parent.tavernHelperAudio={bgm:[{title:'Track',url:'https://fixture.invalid/track.mp3'}],ambient:[]};
    parent.expressions={label:'happy',assetId:'shared-expression'};
    parent.storyDirection={longTerm:'LONG GOAL',queue:[{id:'goal',text:'CURRENT GOAL',budget:3}],activatedAfterUserSeq:0,
      trackedThroughUserSeq:3,roundOwners:[{userSeq:1,targetId:'goal'},{userSeq:3,targetId:'goal'}]};
    const url=await dataBankAdd(dataBankContext(char,parent),'chat','Branch source','shared attachment text');
    await hostPromptCommandInject(char,parent,{id:'persistent',content:'PERSISTENT CONTEXT',position:'in_chat',role:'system',depth:0});
    parent.worldBookRuntime={derived:true};
    const keys=['risu','dataBankAttachments','tavernHelperChatLorebook','tavernHelperMetadata','tavernHelperAudio','expressions','promptInjections'];
    const expected=JSON.stringify(keys.map(key=>parent[key])),copies=[];
    for(const options of [{switchTo:false},{checkpoint:true,switchTo:false}]){
      await createBranchAtMessage(1,options);
      const box=D.chats[char.id],copy=box.sessions[box.sessions.length-1];
      const disk=(await YeyuRepository.load()).data.chats[char.id].sessions.find(row=>row.id===copy.id);
      const progress=StoryDirection.progress(copy,copy.msgs);
      copies.push({same:JSON.stringify(keys.map(key=>copy[key]))===expected,
        persisted:JSON.stringify(keys.map(key=>disk[key]))===expected,
        detached:keys.every(key=>typeof parent[key]!=='object'||copy[key]!==parent[key])&&copy.risu.localLore!==parent.risu.localLore,
        messages:copy.msgs.map(row=>row.content).join('|')==='POINT|FORK',
        story:progress.current.remaining===2&&copy.storyDirection.trackedThroughUserSeq===1&&copy.storyDirection.roundOwners.length===1,
        runtime:!copy.worldBookRuntime,
        shared:await dataBankText(copy.dataBankAttachments.find(row=>row.url===url))==='shared attachment text',
        prompt:hostPromptSnapshot(char,copy).some(row=>row.content==='PERSISTENT CONTEXT')});
      copy.risu.scriptstate.$hp='0';copy.risu.localLore[0].content='CHANGED';
      copy.tavernHelperMetadata.nested.value='CHANGED';copy.tavernHelperAudio.bgm[0].title='CHANGED';
      copy.expressions.label='CHANGED';copy.promptInjections.persistent.content='CHANGED';copy.dataBankAttachments[0].name='CHANGED';
      copy.storyDirection.queue[0].text='CHANGED';copy.storyDirection.roundOwners[0].targetId='CHANGED';
    }
    return {copies,parentKept:JSON.stringify(keys.map(key=>parent[key]))===expected&&parent.storyDirection.queue[0].text==='CURRENT GOAL'
      &&parent.storyDirection.roundOwners[0].targetId==='goal'};
  });
  assert.ok(risuCopies.parentKept&&risuCopies.copies.length===2&&risuCopies.copies.every(row=>Object.values(row).every(Boolean)),JSON.stringify(risuCopies));
  await page.reload(); await waitForAppReady(page);
  const restoredContext=await page.evaluate(async()=>{
    const char=getChar(),box=getSessions(char.id),parent=box.sessions.find(row=>row.id==='parent'),copy=box.sessions[box.sessions.length-1];
    const snapshot=hostPromptSnapshot(char,copy),file=copy.dataBankAttachments[0];
    await dataBankDelete(dataBankContext(char,parent),'chat',parent.dataBankAttachments[0].url);
    return {checkpoint:copy.checkpoint===true,lore:copy.tavernHelperChatLorebook==='CHAT_BOOK',
      metadata:copy.tavernHelperMetadata.nested.value==='METADATA',audio:copy.tavernHelperAudio.bgm[0].title==='Track',expression:copy.expressions.label==='happy',
      prompt:snapshot.some(row=>row.content==='PERSISTENT CONTEXT'),shared:await dataBankText(file)==='shared attachment text',
      story:StoryDirection.progress(copy,copy.msgs).current.remaining===2};
  });
  assert.ok(Object.values(restoredContext).every(Boolean),JSON.stringify(restoredContext));
  const branchBoundaries=await page.evaluate(async()=>{
    const results=[],put=IDBObjectStore.prototype.put,set=Storage.prototype.setItem;
    for(const checkpoint of [false,true]){
      D=defaults();const char={id:'branch-boundary',name:'Boundary',extensions:{}},parent=createBlankSession('Parent','parent');
      parent.msgs=[{seq:1,role:'user',content:'FORK QUESTION'},{seq:2,role:'assistant',content:'FUTURE ANSWER'},
        {seq:3,role:'user',content:'FUTURE QUESTION'}];
      parent.storyDirection={longTerm:'CURRENT',queue:[{id:'goal',text:'GOAL',budget:2}],activatedAfterUserSeq:3,
        trackedThroughUserSeq:3,roundOwners:[{userSeq:1,targetId:'old-goal'},{userSeq:3,targetId:'goal'}]};
      parent.tavernHelperMetadata={value:'KEEP'};
      const box={activeSid:parent.id,sessions:[parent]};D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:box};
      await saveData(['meta','characters','sessions'],{urgent:true});
      let writes=0;
      IDBObjectStore.prototype.put=function(){if(this.name==='sessions'){writes++;throw new DOMException('fixture full','QuotaExceededError');}return put.apply(this,arguments);};
      Storage.prototype.setItem=function(key){if(key===FALLBACK_KEY)throw new DOMException('fixture full','QuotaExceededError');return set.apply(this,arguments);};
      try{await createBranchAtMessage(0,{checkpoint,switchTo:false});}
      finally{IDBObjectStore.prototype.put=put;Storage.prototype.setItem=set;}
      const disk=(await YeyuRepository.load()).data.chats[char.id];
      const kept=writes>0&&box.sessions.length===1&&box.sessions[0]===parent&&!parent.msgs[0].checkpointSessionId&&disk.sessions.length===1;
      await createBranchAtMessage(0,{checkpoint,switchTo:false});
      const copy=box.sessions[box.sessions.length-1];
      const noFuture=!copy.storyDirection.roundOwners.some(row=>row.userSeq===3);
      copy.msgs.push({seq:allocateMessageSeq(copy),role:'assistant',content:'BRANCH REPLY'});
      const initial=StoryDirection.reconcile(copy,copy.msgs);
      copy.msgs.push({seq:allocateMessageSeq(copy),role:'user',content:'BRANCH QUESTION'},
        {seq:allocateMessageSeq(copy),role:'assistant',content:'BRANCH ANSWER'});
      const next=StoryDirection.reconcile(copy,copy.msgs);
      results.push({checkpoint,kept,pending:initial.current.remaining===2,
        activation:copy.storyDirection.activatedAfterUserSeq===1,progress:next.current.remaining===1,
        noFuture,
        parent:parent.storyDirection.activatedAfterUserSeq===3&&parent.storyDirection.roundOwners.length===2&&parent.tavernHelperMetadata.value==='KEEP'});
    }
    return results;
  });
  for(const row of branchBoundaries)assert.ok(row.kept&&row.pending&&row.activation&&row.progress&&row.noFuture&&row.parent,JSON.stringify(row));
  const failedCreations=await page.evaluate(async()=>{
    const originalSave=saveData,results=[];
    appInput=async()=>'New';chooseGreeting=async()=>'';
    try {
      for(const action of ['branch','checkpoint','ui-new','script-new']) {
        D=defaults();const char={id:'failed-create-'+action,name:'Creation',extensions:{}},parent=createBlankSession('Parent','parent');
        const point={seq:1,role:'user',content:'POINT'};parent.msgs=[point];
        const box={activeSid:parent.id,sessions:[parent]};D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:box};
        getSessions(char.id);await originalSave(['characters','sessions'],{urgent:true});
        let entered,fail,calls=0;const started=new Promise(resolve=>{entered=resolve;});
        saveData=(...args)=>++calls===1?new Promise((_,reject)=>{fail=reject;entered();}):originalSave(...args);
        const task=action==='branch'?createBranchAtMessage(0):action==='checkpoint'?createBranchAtMessage(0,{checkpoint:true})
          :action==='ui-new'?addSession():stscriptCreateSession({name:'New'});
        const settled=task.catch(()=>false);await started;
        fail(new Error('synthetic first save failure'));await settled;saveData=originalSave;
        const disk=(await YeyuRepository.load()).data.chats[char.id];
        results.push({action,kept:box.sessions.length===1&&box.sessions[0]===parent&&getActiveSession(char.id)===parent
          &&parent.msgs.length===1&&!point.checkpointSessionId&&!point.checkpointName,persisted:disk.sessions.length===1&&disk.sessions[0].id===parent.id&&disk.sessions[0].msgs[0].content==='POINT'});
      }
    } finally {saveData=originalSave;}
    return results;
  });
  for(const row of failedCreations)assert.ok(row.kept&&row.persisted,JSON.stringify(row));
  console.log(JSON.stringify({branchReturnTransactions:proof}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
});
