'use strict';
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const raw = 'Âme sœur □◻◼ {{user}}\n<!-- private note -->\n<thinking_mode>enabled</thinking_mode>\n<internal thoughts>正文</internal thoughts>\nNote: 明天来。\n答案：巴黎。';
  const proof = await page.evaluate(async raw => {
    D = defaults();
    D.settings.useMemory = false;
    const char = {id: 'raw-char', name: '原文测试', extensions: {}}, session = createBlankSession('原文', 'raw-session');
    D.characters = [char]; D.currentCharId = char.id;
    D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
    const originalCommit = commitGeneratedResponse;
    const repositorySave = YeyuRepository.save;
    YeyuRepository.save = async function (data, options) {
      const result = await repositorySave(data, options);
      if (options && options.clearStreamDraftIds && options.clearStreamDraftIds.length)
        await flushStreamDrafts('native_pause');
      return result;
    };
    let target;
    commitGeneratedResponse = async function (owner, text, meta) {
      target = owner;
      const draft = checkpointStreamDraft(owner, session, text, {force: true});
      await draft._writePromise;
      meta.streamDraftId = draft.draftId;
      return originalCommit(owner, text, meta);
    };
    callDeepSeek = async () => ({content: raw, reasoning: '', finishReason: 'stop'});
    const sent = await doSendMessage('请继续');
    if (target && target.postCommitTask) await target.postCommitTask;
    const reply = session.msgs.find(msg => msg.role === 'assistant');
    const display = cleanDisplayText(reply.content, 'assistant');
    const translated = cleanAuxiliaryResponseText('第一段。\n答案：巴黎。\n最后一段。');
    const before = reply.content;
    window.appConfirm = async () => true;
    editMessage(session.msgs.indexOf(reply));
    document.getElementById('edit-msg-content').value = raw + '\n编辑保留';
    const edited = await saveEditMessage();
    await flushPendingSave();
    const stored = (await YeyuRepository.load()).data.chats[char.id].sessions[0].msgs.find(msg => msg.seq === reply.seq);
    const remainingDrafts = await YeyuRepository.loadStreamDrafts();
    return {sent, edited, before, stored: stored.content, display, translated, drafts: remainingDrafts.drafts.length};
  }, raw);
  assert.strictEqual(proof.sent, true);
  assert.strictEqual(proof.drafts, 0, '正式提交清除草稿后后台排空不能复活草稿');
  assert.strictEqual(proof.before, raw);
  assert.strictEqual(proof.stored, raw + '\n编辑保留');
  assert.ok(!proof.display.includes('private note') && !proof.display.includes('thinking_mode'));
  assert.ok(proof.display.includes('Note: 明天来。') && proof.display.includes('正文') && proof.display.includes('Âme sœur □◻◼'));
  assert.strictEqual(proof.translated, '第一段。\n答案：巴黎。\n最后一段。');
  const legacyTool = await page.evaluate(async () => {
    const session = getActiveSession(D.currentCharId);
    session.msgs.push({seq: allocateMessageSeq(session), role: 'assistant', content: '旧历史正文', borrowedCharacterId: 'background-second',
      toolInvocations: [{name: 'legacy_probe'}], toolCallContent: '旧调用内容', toolCallReasoning: '旧调用思考'});
    await saveData('sessions', {urgent: true});
    const row = buildMessages(getChar(), session.msgs, session, {commit: false}).messages.find(message => message.content === '旧历史正文');
    return {ordinary: !!row && row.role === 'assistant', protocolFields: row && Object.keys(row).filter(key => key.startsWith('tool'))};
  });
  assert.deepStrictEqual(legacyTool, {ordinary: true, protocolFields: []}, '旧工具记录必须作为普通历史正文进入请求，不得恢复工具协议');
  await page.reload();
  await waitForAppReady(page);
  const reloaded = await page.evaluate(() => {
    const msgs = getMsgs(D.currentCharId), legacy = msgs.find(msg => msg.content === '旧历史正文');
    return {reply: msgs.find(msg => msg.role === 'assistant').content,
      legacyFields: legacy && [legacy.borrowedCharacterId, legacy.toolInvocations?.[0]?.name, legacy.toolCallContent, legacy.toolCallReasoning]};
  });
  assert.strictEqual(reloaded.reply, raw + '\n编辑保留');
  assert.deepStrictEqual(reloaded.legacyFields, ['background-second', 'legacy_probe', '旧调用内容', '旧调用思考'], '旧字段必须随历史会话保存与重载保真');
  const concurrent = await page.evaluate(async () => {
    const session = getActiveSession(D.currentCharId), realSave = saveData;
    let rejectFirst, calls = 0;
    saveData = () => ++calls === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve();
    const failed = saveMsg('assistant', 'failed').catch(() => null);
    const kept = await saveMsg('assistant', 'kept');
    rejectFirst(new Error('synthetic failure')); await failed;
    saveData = realSave;
    return {kept: session.msgs.includes(kept), failed: session.msgs.some(msg => msg.content === 'failed'), next: session.nextMessageSeq, seq: kept.seq};
  });
  assert.ok(concurrent.kept && !concurrent.failed && concurrent.next > concurrent.seq);
  const hiddenOwner = await page.evaluate(async () => {
    const char = getChar(), box = getSessions(char.id), realSave = saveData;
    const session = createBlankSession('后台脚本', 'hidden-owner');
    box.sessions.push(session);
    stscriptSetOwner({charId: char.id, sessionId: session.id});
    _stscriptVarNest = 1;
    let rejectFirst, calls = 0;
    saveData = () => ++calls === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve();
    try {
      const failed = stscriptSaveMsg('assistant', 'failed-hidden').catch(() => null);
      const kept = await stscriptSaveMsg('assistant', 'kept-hidden');
      rejectFirst(new Error('synthetic failure')); await failed;
      return {kept: session.msgs.includes(kept), failed: session.msgs.some(msg => msg.content === 'failed-hidden')};
    } finally {
      saveData = realSave;
      _stscriptVarNest = 0;
      stscriptSetOwner(null);
    }
  });
  assert.ok(hiddenOwner.kept && !hiddenOwner.failed, '后台会话脚本保存失败只能撤销自身消息');
  const editing = await page.evaluate(async () => {
    const session=getActiveSession(D.currentCharId);
    const target=await saveMsg('user','TARGET');
    const originalConfirm=appConfirm;
    appConfirm=async()=>true;
    editMessage(session.msgs.indexOf(target));
    const inserted={role:'user',content:'INSERTED',seq:session.nextMessageSeq++};
    session.msgs.unshift(inserted);
    $('edit-msg-content').value='  EDITED\n ';
    const moved=await saveEditMessage();
    editMessage(session.msgs.indexOf(target));
    target.content='CHANGED_BY_SCRIPT';
    $('edit-msg-content').value='MUST_NOT_OVERWRITE';
    const conflict=await saveEditMessage();
    let confirmDelete;
    appConfirm=()=>new Promise(resolve=>{confirmDelete=resolve;});
    const deleting=deleteMessage(session.msgs.indexOf(target));
    const second={role:'user',content:'SECOND',seq:session.nextMessageSeq++};
    session.msgs.unshift(second);
    confirmDelete(true);await deleting;
    appConfirm=originalConfirm;
    return {moved,conflict,inserted:inserted.content,second:second.content,removed:!session.msgs.includes(target),targetContent:target.content};
  });
  assert.ok(editing.moved && !editing.conflict && editing.removed);
  assert.strictEqual(editing.inserted,'INSERTED');
  assert.strictEqual(editing.second,'SECOND');
  assert.strictEqual(editing.targetContent,'CHANGED_BY_SCRIPT');
  const rollback = await page.evaluate(async () => {
    const realSave = saveData, realConfirm = appConfirm, char = getChar(), box = getSessions(char.id);
    const results = [];
    appConfirm = async () => true;
    try {
      for (const action of ['edit', 'delete', 'restore', 'swipe', 'add-swipe', 'delete-swipe']) {
        const session = createBlankSession('回滚', 'rollback-' + action);
        const previous = {role:'user', content:'PREVIOUS', seq:1};
        const target = {role:'assistant', content:'TARGET', seq:2, swipes:['TARGET','OTHER'], swipeId:0, continueBase:'BASE'};
        session.msgs = [previous, target]; session.nextMessageSeq = 3;
        session.memoryStore.historySummary=memoryV5NormalizeHistorySummary({sourceStartSeq:1,sourceEndSeq:2,sourceHash:'rollback-source',text:'已有摘要'},session.id);
        ensureSessionMemoryStore(session);
        const summary=session.memoryStore.historySummary, memory=session.memoryStore;
        box.sessions.push(session); box.activeSid = session.id;
        let rejectSave, started;
        const saving = new Promise(resolve => { started = resolve; });
        saveData = () => new Promise((_, reject) => { rejectSave = reject; started(); });
        let task;
        if (action === 'edit') { editMessage(1); $('edit-msg-content').value='EDITED'; task=saveEditMessage(); }
        if (action === 'delete') task=deleteMessage(1);
        if (action === 'restore') task=restoreOriginalMessage(1,true);
        if (action === 'swipe') task=switchMessageSwipe(1,1);
        if (action === 'add-swipe') task=addMessageSwipeCandidate('NEW',{messageIndex:1,switch:true});
        if (action === 'delete-swipe') task=deleteMessageSwipeCandidate(0,{messageIndex:1});
        const settled=task.catch(() => false);
        await saving;
        const added={role:'user',content:'CONCURRENT',seq:session.nextMessageSeq++};
        session.msgs.push(added); previous.content='CONCURRENT_EDIT';
        session.stscript={variables:{retained:'yes'}};
        const elsewhere=createBlankSession('新会话','elsewhere-'+action);
        box.sessions.push(elsewhere); box.activeSid=elsewhere.id;
        rejectSave(new Error('synthetic message save failure')); await settled;
        results.push({action, identities:D.chats[char.id]===box && box.sessions.includes(session) && session.msgs.includes(target),
          own:target.content==='TARGET' && target.continueBase==='BASE' && target.swipeId===0 && target.swipes.join('|')==='TARGET|OTHER',
          memory:session.memoryStore===memory && session.memoryStore.historySummary===summary,
          concurrent:session.msgs.includes(added) && previous.content==='CONCURRENT_EDIT' && session.stscript.variables.retained==='yes' && box.activeSid===elsewhere.id,
          order:session.msgs.indexOf(previous)<session.msgs.indexOf(target) && session.msgs.indexOf(target)<session.msgs.indexOf(added)});
      }
    } finally { saveData=realSave; appConfirm=realConfirm; }
    return results;
  });
  for (const result of rollback) assert.ok(result.identities && result.own && result.concurrent && result.order && result.memory, JSON.stringify(result));
  const translation = await page.evaluate(async () => {
    const char=getChar(), box=getSessions(char.id), realCompletion=fetchCompatibleCompletion, realSave=saveData;
    const provider=activeProviderForSettings(D.settings);
    provider.apiKey='synthetic-key'; provider.apiUrl='https://translation.test/v1'; provider.model='synthetic-model';
    const session=createBlankSession('翻译事务','translation-rollback');
    const message={seq:1,role:'assistant',content:'Translate this text.'};
    session.msgs=[message]; session.nextMessageSeq=2; box.sessions.push(session); box.activeSid=session.id;
    try {
      let deliver, started;
      const requesting=new Promise(resolve=>{started=resolve;});
      fetchCompatibleCompletion=async()=>({json:()=>new Promise(resolve=>{deliver=resolve;started();})});
      const late=translateMessage(0); await requesting;
      message.content='NEWER_TEXT';
      deliver({choices:[{message:{content:'不得写回的迟到译文。'},finish_reason:'stop'}]}); await late;
      const kept=message.content==='NEWER_TEXT' && !message.translated;
      message.content='Translate this text.';
      fetchCompatibleCompletion=async()=>({json:async()=>({choices:[{message:{content:'中文译文。'},finish_reason:'stop'}]})});
      let fail;
      const saving=new Promise(resolve=>{saveData=()=>new Promise((_,reject)=>{fail=reject;resolve();});});
      const translating=translateMessage(0); await saving;
      const extra={seq:2,role:'user',content:'CONCURRENT_TRANSLATION'};
      session.msgs.push(extra); session.nextMessageSeq=3;
      fail(new Error('synthetic translation save failure')); await translating;
      const restored=message.content==='Translate this text.' && !message.translated && !message.original_content;
      saveData=realSave;fetchCompatibleCompletion=realCompletion;
      const realFetch=window.fetch;let request=null;
      window.fetch=async(url,options)=>{request={url,model:JSON.parse(options.body).model};
        return {ok:true,status:200,json:async()=>({choices:[{message:{content:'翻译后的正文。'},finish_reason:'stop'}]})};};
      try { await translateMessage(0); } finally { window.fetch=realFetch; }
      const disk=(await YeyuRepository.load()).data.chats[char.id].sessions.find(row=>row.id===session.id).msgs[0];
      return {kept, restored, concurrent:session.msgs.includes(extra) && box.sessions.includes(session) && session.msgs[0]===message,
        success:{content:message.content,original:message.original_content,marked:message.translated,disk:disk.content,state:_generationState,request}};
    } finally {fetchCompatibleCompletion=realCompletion;saveData=realSave;}
  });
  assert.ok(translation.kept && translation.restored && translation.concurrent, JSON.stringify(translation));
  assert.deepStrictEqual(translation.success, {content:'翻译后的正文。', original:'Translate this text.', marked:true, disk:'翻译后的正文。', state:'idle',
    request:{url:'https://translation.test/v1/chat/completions', model:'synthetic-model'}}, '翻译必须通过正式消息事务写入译文、保留原文并恢复空闲状态');
  const failedScript=await page.evaluate(async()=>{
    const char=getChar(),box=D.chats[char.id],session=getActiveSession(char.id),original=presetTaskCall;
    presetTaskCall=async(name)=>{if(name==='onUserMessage')throw new Error('synthetic after-save failure');};
    $('user-input').value='SAVED_BEFORE_SCRIPT_FAILURE';
    const sent=await doSendMessage('SAVED_BEFORE_SCRIPT_FAILURE');
    presetTaskCall=original;
    const persisted=(await YeyuRepository.load()).data.chats[char.id].sessions.find(row=>row.id===session.id);
    return {sent,boxIdentity:D.chats[char.id]===box,sessionIdentity:getActiveSession(char.id)===session,
      memory:session.msgs.at(-1).content,disk:persisted.msgs.at(-1).content,input:$('user-input').value};
  });
  assert.ok(!failedScript.sent&&failedScript.boxIdentity&&failedScript.sessionIdentity);
  assert.strictEqual(failedScript.memory,'SAVED_BEFORE_SCRIPT_FAILURE');
  assert.strictEqual(failedScript.disk,failedScript.memory);
  assert.strictEqual(failedScript.input,'');
  const rawContinuation=await page.evaluate(async()=>{
    const char=getChar(),box=D.chats[char.id],session=createBlankSession('Raw continuation','raw-continuation-exact');
    const before='  PREFIX  \n',addition='\n  NEW_END  \n';
    const message={seq:1,role:'assistant',content:before};session.msgs=[message];session.nextMessageSeq=2;session.greetingChosen=true;
    box.sessions.push(session);box.activeSid=session.id;
    await commitGeneratedResponse({charId:char.id,sessionId:session.id,mode:'continue',messageIndex:0,messageSeq:1},addition,
      {continuedBase:before,finishReason:'stop'});
    const disk=(await YeyuRepository.load()).data.chats[char.id].sessions.find(row=>row.id===session.id);
    return {expected:before+addition,memory:message.content,disk:disk.msgs[0].content};
  });
  assert.strictEqual(rawContinuation.memory,rawContinuation.expected);
  assert.strictEqual(rawContinuation.disk,rawContinuation.expected);
  console.log('message raw persistence: send, edit, reload, display, auxiliary text, concurrent rollback passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
