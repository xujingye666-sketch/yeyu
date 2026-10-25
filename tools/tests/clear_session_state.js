'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
const assets = path.resolve(__dirname, '../../app/src/main/assets');
let browser, server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  // Clear owns both the retained conversation and its removed descendants' recovery drafts.
  // Exercise the real confirmation, save transaction and cold-start recovery, including rejected writes.
  for (const mode of ['primary', 'failed', 'fallback']) {
    const fail = mode === 'failed', fallback = mode === 'fallback';
    await page.evaluate(async mode => {
      D = defaults();
      const char = {id: 'clear-drafts', name: 'Clear drafts', first_mes: '', extensions: {}};
      const parent = createBlankSession('Parent', 'draft-parent');
      const child = createBlankSession('Child', 'draft-child');
      const kept = createBlankSession('Kept', 'draft-kept');
      child.parentSessionId = parent.id;
      for (const session of [parent, child, kept]) {
        session.greetingChosen = true;
        session.msgs = [{role: 'user', seq: 1, content: session.name + ' question'}];
      }
      D.characters = [char]; D.currentCharId = char.id;
      D.chats = {[char.id]: {activeSid: parent.id, sessions: [parent, child, kept]}};
      await saveData(['meta', 'characters', 'sessions'], {urgent: true});
      for (const session of [parent, child, kept]) {
        const draft = checkpointStreamDraft({charId: char.id, sessionId: session.id, mode: 'new'}, session,
          session.name + ' protected draft', {state: 'cancelled', stopReason: 'user_cancelled'});
        await draft._writePromise;
      }
      _activeStreamDraft = null;
      setGenerationState('idle'); renderChat(); updateChatUI();
      if (mode !== 'primary') {
        const put = IDBObjectStore.prototype.put, remove = IDBObjectStore.prototype.delete, set = Storage.prototype.setItem;
        let deleted = 0, deletedResolve;
        window.__clearDeleteAttempts = mode === 'fallback' ? new Promise(resolve => {deletedResolve = resolve;}) : Promise.resolve();
        window.__restoreClearStorage = () => {IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.delete = remove; Storage.prototype.setItem = set;};
        window.__clearFailedWrites = 0;
        IDBObjectStore.prototype.put = function () {
          if (this.name === 'sessions') {window.__clearFailedWrites++; throw new DOMException('fixture full', 'QuotaExceededError');}
          return put.apply(this, arguments);
        };
        IDBObjectStore.prototype.delete = function () {
          if (mode === 'fallback' && this.name === 'app_meta') {
            if (++deleted === 2) deletedResolve();
            throw new DOMException('fixture full', 'QuotaExceededError');
          }
          return remove.apply(this, arguments);
        };
        Storage.prototype.setItem = function (key) {
          if (mode === 'failed' && key === FALLBACK_KEY) throw new DOMException('fixture full', 'QuotaExceededError');
          return set.apply(this, arguments);
        };
      }
      window.__clearDraftTask = clearChat();
    }, mode);
    await page.locator('#app-prompt-ok').tap();
    const beforeReload = await page.evaluate(async fail => {
      await window.__clearDraftTask;
      if (window.__clearDeleteAttempts) await window.__clearDeleteAttempts;
      if (window.__restoreClearStorage) {window.__restoreClearStorage(); delete window.__restoreClearStorage;}
      const disk = (await YeyuRepository.load()).data.chats['clear-drafts'];
      const drafts = (await YeyuRepository.loadStreamDrafts(sanitizeStoredStreamDraft)).drafts;
      return {sessions: disk.sessions.map(row => row.id), parent: disk.sessions.find(row => row.id === 'draft-parent').msgs.map(row => row.content),
        drafts: drafts.map(row => row.sessionId).sort(), rejected: !fail || window.__clearFailedWrites > 0,
        released: !fail || _streamDrafts.every(row => !row._discarded)};
    }, fail);
    assert.deepStrictEqual(beforeReload.sessions, fail || fallback ? ['draft-parent', 'draft-child', 'draft-kept'] : ['draft-parent', 'draft-kept']);
    assert.deepStrictEqual(beforeReload.parent, fail || fallback ? ['Parent question'] : []);
    assert.deepStrictEqual(beforeReload.drafts, fail || fallback ? ['draft-child', 'draft-kept', 'draft-parent'] : ['draft-kept']);
    assert.ok(beforeReload.rejected && beforeReload.released);
    await page.reload(); await waitForAppReady(page);
    const recovered = await page.evaluate(() => D.chats['clear-drafts'].sessions.map(row => ({id: row.id, texts: row.msgs.map(msg => msg.content)})));
    assert.strictEqual(recovered.some(row => row.texts.includes('Parent protected draft')), fail, 'clear success must survive cold-start recovery');
    assert.strictEqual(recovered.some(row => row.texts.includes('Child protected draft')), fail, 'removed descendants must not return: ' + JSON.stringify({mode, recovered}));
    assert.ok(recovered.some(row => row.texts.includes('Kept protected draft')), 'unrelated recoverable drafts remain enabled');
  }
  const result = await page.evaluate(async () => {
    D = defaults();
    D.settings.globalChatVariables = {shared: 'legacy global'};
    D.settings.stscript = {globalVars: {shared: 'ST global'}};
    const char = {id: 'clear-card', name: 'Clear', first_mes: 'GREETING', extensions: {risuai: {defaultVariables: 'gold=0\nstarted=0', triggerscript: [{type: 'start', comment: 'init', conditions: [], effect: [{type: 'v2SetVar', var: 'started', operator: '+=', value: '1', valueType: 'value'}, {type: 'impersonate', role: 'char', value: 'START_EVENT'}]}]}}};
    const install = () => {
      const session = createBlankSession('source', 'clear-session');
      session.msgs = [{role: 'user', content: 'ORIGINAL', seq: 8}];
      session.scriptState = {$gold: '99', $started: '77', $oldFlag: 'old'};
      session.macroVars = {local: 'old'}; session.stscriptVars = {local: 'old'};
      session.quickReply = {setNames: ['old']}; session.startTriggerDone = true;
      session.storyDirection = {longTerm: 'OLD_GOAL', queue: []}; session.authorsNote = 'OLD_NOTE'; session.tavernHelperMetadata = {oldPlot: true};
      session.tavernHelperChatLorebook = 'old-book'; session.tavernHelperAudio = {bgm: [{title: 'old', url: 'old.mp3'}]};
      const child = createBlankSession('child', 'clear-child'); child.parentSessionId = session.id; child.msgs = [{role: 'user', content: 'CHILD', seq: 1}];
      D.characters = [char]; D.currentCharId = char.id; D.chats = {[char.id]: {activeSid: session.id, sessions: [session, child]}};
      getSessions(char.id);
      return session;
    };
    let session = install();
    const originalSave = saveData, globals = JSON.stringify([D.settings.globalChatVariables, D.settings.stscript]);
    appConfirm = async () => true;
    let previewVars;
    chooseGreeting = async (card, vars) => { previewVars = vars; return {text: card.first_mes, index: 0}; };
    queueOpeningMediaHydration = () => {};
    await originalSave(['meta', 'characters', 'sessions'], {urgent: true});
    const goldBefore = session.scriptState.$gold;
    _tavernAudioChatKey = currentTavernAudioChatKey();
    Object.assign(tavernAudioRuntime('bgm'), {src: 'old-bgm.mp3', playing: true});
    Object.assign(tavernAudioRuntime('ambient'), {src: 'old-ambient.mp3', playing: true});
    let saveCalls = 0;
    saveData = async (...args) => { saveCalls++; return originalSave(...args); };
    // Post-reply work still running for this conversation (such as a memory summary about to ask for review)
    // is retired by clearing it, as switching or deleting the conversation does (#208).
    const tailTarget = bindGenerationTargetOwnership({charId: char.id, sessionId: session.id, mode: 'new'}, session);
    activateGenerationEpoch(tailTarget, session);
    const tailRun = generationPostCommitRun(tailTarget, session);
    try { await clearChat(); } finally { saveData = originalSave; }
    session = getActiveSession(char.id);
    const cleared = {tailCancelled: tailRun.controller.signal.aborted, scriptState: session.scriptState, messages: session.msgs.map(m => m.content), localCleared: ['macroVars', 'stscriptVars', 'quickReply', 'storyDirection', 'authorsNote', 'tavernHelperMetadata', 'tavernHelperChatLorebook', 'tavernHelperAudio'].every(key => !session[key]), children: D.chats[char.id].sessions.length, startDone: session.startTriggerDone, saveCalls, previewVars};
    const persisted = (await YeyuRepository.load()).data.chats[char.id];
    const audioCleared = ['bgm', 'ambient'].every(type => !tavernAudioRuntime(type).src && !tavernAudioRuntime(type).playing);
    const privateDefaultsNotExecuted = !session.scriptState && !session.startTriggerDone;
    install();
    char.description = 'ORIGINAL_DESCRIPTION';
    char.media_assets = [{id: 'unpersisted', bytes: new Uint8Array([1, 2, 3]), blob: new Blob([new Uint8Array([4, 5])], {type: 'audio/ogg'})}];
    D.personas = [{id: 'test-persona', name: 'Persona', desc: 'ORIGINAL_PERSONA', boundCharIds: [char.id]}];
    renderChat();
    Object.assign(tavernAudioRuntime('bgm'), {src: 'old-bgm.mp3', playing: true});
    Object.assign(tavernAudioRuntime('ambient'), {src: 'old-ambient.mp3', playing: true});
    const before = JSON.stringify(D), originalPrepare = refreshMvuAfterMutation, originalCanRun = mvuCanRun;
    let prepareCalls = 0;
    mvuCanRun = () => true;
    refreshMvuAfterMutation = async (card, sess, options) => {
      prepareCalls++;
      await Promise.resolve();
      options.mutation.capture(sess.msgs[0], ['yeyuMvu'], true);
      sess.msgs[0].yeyuMvu = {prepared:true};
      options.mutation.seal();
    };
    let failedSaveCalls = 0;
    saveData = async () => { failedSaveCalls++; throw new Error('fixture persistence failure'); };
    try { await clearChat(); } finally { saveData = originalSave; refreshMvuAfterMutation = originalPrepare; mvuCanRun = originalCanRun; }
    const rolledBack = {before: JSON.parse(before), after: JSON.parse(JSON.stringify(D))};
    const asset = getChar().media_assets[0];
    return {goldBefore, cleared, persistedMessages: persisted.sessions[0].msgs.map(m => m.content), persistedScriptState: persisted.sessions[0].scriptState, privateDefaultsNotExecuted, prepareCalls, rolledBack, failedSaveCalls, globalUnchanged: globals === JSON.stringify([D.settings.globalChatVariables, D.settings.stscript]), rollbackDom: $('chat-messages').textContent.includes('ORIGINAL') && !$('chat-messages').textContent.includes('START_EVENT'), rollbackMedia: asset.bytes instanceof Uint8Array && asset.blob instanceof Blob && Array.from(asset.bytes).join(',') === '1,2,3' && Array.from(new Uint8Array(await asset.blob.arrayBuffer())).join(',') === '4,5', audioCleared, audioPreservedOnFailure: tavernAudioRuntime('bgm').src === 'old-bgm.mp3' && tavernAudioRuntime('bgm').playing && tavernAudioRuntime('ambient').src === 'old-ambient.mp3' && tavernAudioRuntime('ambient').playing};
  });
  assert.strictEqual(result.goldBefore, '99');
  assert.deepStrictEqual(result.cleared, {tailCancelled: true, scriptState: undefined, messages: ['GREETING'], localCleared: true, children: 1, startDone: undefined, saveCalls: 1, previewVars: {}});
  assert.deepStrictEqual(result.persistedMessages, ['GREETING']);
  assert.strictEqual(result.persistedScriptState, undefined, '清空后不保留旧私有变量，也不执行私有默认值');
  assert.strictEqual(result.privateDefaultsNotExecuted, true);
  assert.deepStrictEqual(result.rolledBack.after, result.rolledBack.before, '保存失败恢复聊天、局部变量和后代支线');
  assert.strictEqual(result.prepareCalls, 1, '必须进入保留的异步MVU准备点');
  assert.strictEqual(result.failedSaveCalls, 1, '初始化和清空必须由同一次保存提交');
  assert.strictEqual(result.globalUnchanged, true);
  assert.strictEqual(result.rollbackDom, true);
  assert.strictEqual(result.rollbackMedia, true);
  assert.strictEqual(result.audioCleared, true);
  assert.strictEqual(result.audioPreservedOnFailure, true);
  console.log(JSON.stringify({issue: 119, retiredStateCleared: true, privateDefaultsNotExecuted: true, singleSave: true, completeRollback: true, globalVariablesPreserved: true}));
  const checkpointDetached = await page.evaluate(async () => {
    D = defaults();
    const char = {id: 'checkpoint-card', name: 'Original', extensions: {}};
    D.characters = [char]; D.currentCharId = char.id;
    const parent = createBlankSession('Parent', 'checkpoint-parent');
    parent.greetingChosen = true; parent.msgs = [{role: 'assistant', content: 'hello', seq: 1}];
    const checkpoint = createBlankSession('Saved checkpoint', 'checkpoint-session');
    checkpoint.parentSessionId = parent.id; checkpoint.checkpoint = true;
    parent.msgs[0].checkpointSessionId = checkpoint.id; parent.msgs[0].checkpointName = checkpoint.name;
    D.chats = {[char.id]: {activeSid: checkpoint.id, sessions: [parent, checkpoint]}};
    chooseGreeting = async () => ''; appConfirm = async () => true;
    await clearChat();
    return !parent.msgs[0].checkpointSessionId && !parent.msgs[0].checkpointName && !checkpoint.parentSessionId;
  });
  assert.strictEqual(checkpointDetached, true, 'checkpointDetached');
  const concurrentSessions=await page.evaluate(async()=>{
    const realSave=saveData,results=[];
    appConfirm=async()=>true;appInput=async()=>'New';chooseGreeting=async()=>'';
    try {
      for(const action of ['clear','ui-delete','script-delete','script-create','script-replace','ui-new','ui-switch','script-switch','rename','close']){
        D=defaults();
        const char={id:'sessions-'+action,name:'事务',first_mes:'',extensions:{}},late={id:'late-'+action,name:'另一个角色',extensions:{}};
        const target=createBlankSession('Target','target'),child=createBlankSession('Child','child'),kept=createBlankSession('Kept','kept');
        child.parentSessionId=target.id;
        target.msgs=[{seq:1,role:'user',content:'TARGET'}];
        const originalMessages=target.msgs,originalMessage=target.msgs[0];
        const message={seq:1,role:'user',content:'KEPT',checkpointSessionId:target.id,checkpointName:target.name};
        kept.msgs=[message];
        const sessions=[target,child,kept],box={activeSid:target.id,sessions};
        D.characters=[char,late];D.currentCharId=char.id;
        D.chats={[char.id]:box,[late.id]:{activeSid:'late-session',sessions:[createBlankSession('Late','late-session')]}};
        let fail,started;const saving=new Promise(resolve=>{started=resolve;});
        saveData=()=>new Promise((_,reject)=>{fail=reject;started();});
        let task;
        if(action==='clear')task=clearChat();
        if(action==='ui-delete')task=deleteSession(target.id);
        if(action==='script-delete')task=stscriptDeleteCurrentSession();
        if(action==='script-create')task=stscriptCreateSession({name:'New'});
        if(action==='script-replace')task=stscriptCreateSession({name:'New',deleteCurrent:true});
        if(action==='ui-new')task=addSession();
        if(action==='ui-switch')task=switchSession(kept.id);
        if(action==='script-switch')task=stscriptSwitchSession(kept.id);
        if(action==='rename')task=stscriptRenameCurrentSession('Failed Name');
        if(action==='close')task=stscriptCloseCurrentChat();
        const settled=task.catch(()=>false);await saving;
        const added=createBlankSession('Concurrent','concurrent');sessions.unshift(added);box.activeSid=added.id;
        const appended={seq:allocateMessageSeq(target),role:'user',content:'CONCURRENT'};target.msgs.push(appended);
        message.content='CONCURRENT_EDIT';target.name='CONCURRENT_NAME';
        D.settings.globalChatVariables={concurrent:'kept'};char.description='Concurrent card edit';
        D.currentCharId=late.id;
        fail(new Error('synthetic session save failure'));await settled;saveData=realSave;
        results.push({action,identities:D.chats[char.id]===box && box.sessions===sessions && sessions.includes(target) && sessions.includes(child) && sessions.includes(kept),
          concurrent:sessions.length===4 && sessions[0]===added && box.activeSid===added.id && target.msgs.includes(appended)
            && target.name==='CONCURRENT_NAME' && message.content==='CONCURRENT_EDIT' && D.currentCharId===late.id,
          checkpoint:message.checkpointSessionId===target.id && message.checkpointName==='Target',
          clear:action!=='clear'||(target.msgs===originalMessages&&target.msgs.includes(originalMessage)&&new Set(target.msgs.map(row=>row.seq)).size===target.msgs.length&&D.settings.globalChatVariables.concurrent==='kept'&&char.description==='Concurrent card edit')});
      }
    } finally {saveData=realSave;}
    return results;
  });
  for(const row of concurrentSessions)assert.ok(row.identities&&row.concurrent&&row.checkpoint&&row.clear,JSON.stringify(row));
  const lateClear = await page.evaluate(async () => {
    const originalSave=saveData, results=[];
    try {
      for(const stage of ['confirm','greeting']) {
        D=defaults();
        const char={id:'late-clear',name:'Clear',extensions:{}},session=createBlankSession('Original','original');
        session.msgs=[{seq:1,role:'user',content:'KEEP'}];
        const box={activeSid:session.id,sessions:[session]};
        D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:box};
        let resume,entered,calls=0;
        const pending=new Promise(resolve=>{entered=resolve;});
        const wait=()=>new Promise(resolve=>{resume=resolve;entered();});
        appConfirm=stage==='confirm'?wait:async()=>true;
        chooseGreeting=stage==='greeting'?wait:async()=>'';
        saveData=async()=>{calls++;};
        const clearing=clearChat();await pending;
        const child=createBlankSession('Unconfirmed child','new-child');child.parentSessionId=session.id;
        box.sessions.push(child);resume(stage==='confirm'?true:'');await clearing;
        results.push(calls===0&&box.sessions.includes(child)&&session.msgs[0].content==='KEEP');
      }
    } finally {saveData=originalSave;}
    return results;
  });
  assert.deepStrictEqual(lateClear,[true,true],'late confirmation must not clear an unconfirmed descendant');
  console.log('PASS clear session state');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
