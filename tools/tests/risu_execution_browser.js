'use strict';
const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 450, height: 974 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const card = {spec:'chara_card_v3',spec_version:'3.0',data:{name:'Risu 执行夹具',description:'count={{getvar::count}}',first_mes:'OPEN',extensions:{risuai:{defaultVariables:'count=0',customScripts:[
    {type:'editinput',in:'INPUT',out:'INPUT_SAVED'},
    {type:'editprocess',in:'INPUT_SAVED',out:'INPUT_REQUEST'},
    {type:'editoutput',in:'RAW_REPLY',out:'OUTPUT_SAVED'},
    {type:'editdisplay',in:'OUTPUT_SAVED',out:'DISPLAY_ONLY'},
  ],triggerscript:[
    {type:'start',comment:'start',conditions:[],effect:[{type:'setvar',var:'count',operator:'+=',value:'1'},{type:'systemprompt',location:'start',value:'RISU_START'},{type:'systemprompt',location:'historyend',value:'RISU_HISTORY_END'},{type:'systemprompt',location:'promptend',value:'RISU_PROMPT_END'}]},
    {type:'output',comment:'output',conditions:[],effect:[{type:'setvar',var:'count',operator:'+=',value:'10'}]},
    {type:'manual',comment:'increment',conditions:[],effect:[{type:'setvar',var:'count',operator:'+=',value:'100'}]},
  ]},regex_scripts:[{findRegex:'INPUT|RAW_REPLY|OUTPUT_SAVED',replaceString:'ST_LEAK',placement:[1,2],disabled:false}]}}};
  await page.evaluate(() => { openModal('import-modal'); resetImport(); });
  await page.locator('#file-input').setInputFiles({name:'Risu execution.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(card))});
  await page.waitForFunction(() => pending.length === 1 && !_importProgressActive);
  await page.evaluate(() => {setPendingImportMode(0, 'direct');appConfirm=async()=>true;});
  await page.locator('#import-preview button.primary').click();
  await page.waitForFunction(() => D.characters.length === 1);
  await page.evaluate(async () => {
    const char=D.characters[0];D.currentCharId=char.id;
    const session=getActiveSession(char.id);session.greetingChosen=true;session.creatorNotesSeen=true;
    session.macroVars={count:'ST_UNCHANGED'};
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings),{apiUrl:location.origin+'/risu-execution/v1',apiKey:'synthetic-local',model:'synthetic-model',reasoningEffort:'off'});
    Object.assign(D.settings,{useMemory:false,embeddingEnabled:false,styleAuditEnabled:false,maxContextTokens:0});
    await saveData(['sessions','meta'],{urgent:true});switchAppPage('chat');updateChatUI();renderChat();
  });
  const requests=[];
  let modelReply='RAW_REPLY {{addvar::count::2}}';
  await page.route('**/risu-execution/**', async route => {
    const body=route.request().postDataJSON();
    requests.push(body);
    if(body.messages.at(-1).content==='SIMPLE_FAIL')return route.fulfill({status:500,contentType:'application/json',body:'{"error":{"message":"SIMPLE_DOWN"}}'});
    if(body.stream===false)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:'MODEL_OK'},finish_reason:'stop'}]})});
    await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:modelReply},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});
  });
  const previewIsolation = await page.evaluate(async () => {
    const char = getChar(), session = getActiveSession(char.id);
    const before = JSON.stringify([char, session, getActivePersona(char.id)]);
    const target = bindGenerationTargetOwnership({charId: char.id, sessionId: session.id, mode: 'new'}, session);
    const options = {preview: true, random: () => 0.25, previewNotes: []};
    try {
      await risuPrepareStart(char, session, target, undefined, options);
      const count = options.previewState.session.risu.scriptstate.$count;
      await risuWithExecution(char, session, options, async context => {
        context.setVar('previewOnly', 'yes');
        context.setCharacterDescription('PREVIEW_DESCRIPTION');
        context.setPersonaDescription('PREVIEW_PERSONA');
        context.setAuthorNote('PREVIEW_NOTE');
        context.setLorebooks([{comment: 'PREVIEW_GLOBAL', content: 'GLOBAL', alwaysActive: true}]);
        context.lore.setLocalLorebooks([{comment: 'PREVIEW_LOCAL', content: 'LOCAL', alwaysActive: true}]);
        await context.alert('must not show');
        const marker = await context.runLLM('must not send');
        const network = await risuLuaRpc(context, {method: 'request', args: ['https://example.invalid'],
          scope: {roleId: char.id, sessionId: session.id}});
        context.setVar('previewMarker', marker);
        context.setVar('previewNetwork', network);
      });
      const stages = await risuWithExecution(char, session, options, async context => ({
        note: context.getAuthorNote(), persona: context.getPersonaDescription(),
        globalLore: context.getLorebooks()[0].comment, localLore: context.lore.getLocalLorebooks()[0].comment,
      }));
      const view = options.previewState;
      return {stages, unchanged: before === JSON.stringify([char, session, getActivePersona(char.id)]), count,
        vars: view.session.risu.scriptstate, description: view.character.description, notes: options.previewNotes};
    } finally {risuReleasePromptPreview(options);}
  });
  assert(previewIsolation.unchanged, 'Risu 预览不能写聊天、变量、角色或人格');
  assert.equal(previewIsolation.count, '1', 'start 写入应仅供后续预览阶段读取');
  assert.equal(previewIsolation.vars.$previewOnly, 'yes');
  assert.equal(previewIsolation.description, 'PREVIEW_DESCRIPTION');
  assert.deepStrictEqual(previewIsolation.stages, {note: 'PREVIEW_NOTE', persona: 'PREVIEW_PERSONA', globalLore: 'PREVIEW_GLOBAL', localLore: 'PREVIEW_LOCAL'});
  assert(previewIsolation.vars.$previewMarker.includes('预览未执行'));
  assert(previewIsolation.vars.$previewNetwork.includes('预览未执行'));
  assert.equal(previewIsolation.notes.length, 3);
  assert.equal(requests.length, 0, 'Risu 预览模型与联网宿主不得发送请求');
  const randomRound = await page.evaluate(async () => {
    const sourceChar = getChar();
    const char = {id: 'risu-preview-random', name: '随机预览夹具', first_mes: '', personality: '', scenario: '',
      description: 'DESC {{random::A::B::C}}/{{roll::1d1000000000}}/{{getvar::count}}',
      extensions: {risuai: {defaultVariables: 'count=0', customScripts: [
        {type: 'editprocess', in: 'PREPROCESS', out: 'REGEX {{randint::1::1000000000}}'},
      ], triggerscript: [
        {type: 'start', conditions: [], effect: [
          {type: 'setvar', var: 'count', operator: '+=', value: '1'},
          {type: 'systemprompt', location: 'start', value: 'START {{random::A::B}}/{{roll::1000000000}}'},
        ]},
        {type: 'manual', effect: [{type: 'triggerlua', code:
          "listenEdit('editRequest', function(id, rows) rows[#rows+1]={role='system',content='REQUEST '..cbs('{{getvar::count}}')} return rows end)"}]},
      ]}, yeyu: {risuLorebookState: Array.from({length: 6}, (_, index) => ({
        key: '', secondkey: '', insertorder: 100 + index, comment: 'probability-' + index, mode: 'normal',
        alwaysActive: true, selective: false,
        content: '@@probability 50\nLORE_' + index + '={{roll::1000000000}}',
      }))}}};
    const session = createBlankSession('随机预览', 'risu-preview-random-session');
    // History CBS renders once per request from its template, in the preview as in the send.
    session.msgs = [{role: 'user', seq: 1, content: 'HISTORY {{roll::1000000000}}'}, {role: 'assistant', seq: 2, content: 'HISTORY_REPLY'},
      {role: 'user', seq: 3, content: 'PREPROCESS'}];
    session.nextMessageSeq = 4; session.greetingChosen = true;
    session.memoryStore.migratedFromVersion = 4; session.memoryStore.vectorIndex = {legacy: true};
    D.characters.push(char); D.chats[char.id] = {sessions: [session], activeSid: session.id};
    const before = JSON.stringify([char, session]);
    const target = () => bindGenerationTargetOwnership({charId: char.id, sessionId: session.id, mode: 'new'}, session);
    try {
      const preview = await assembleGenerationPrompt(char, session, session.msgs, target(), {preview: true});
      const noWrites = before === JSON.stringify([char, session]);
      const savedFetch = window.fetch; let actual; const generation = target();
      window.fetch = async (url, init) => {
        if (!String(url).includes('/risu-execution/')) return savedFetch(url, init);
        actual = JSON.parse(init.body);
        return new Response(JSON.stringify({choices: [{message: {content: 'ROUND_REPLY'}, finish_reason: 'stop'}]}),
          {headers: {'content-type': 'application/json'}});
      };
      setGenerationState('preparing');
      try {await doAPICall({target: generation});}
      finally {window.fetch = savedFetch; finishGeneration(generation);}
      const canonical = messages => messages.map(row => [row.role, row.content, row.name || null]);
      return {equal: JSON.stringify(canonical(preview.messages)) === JSON.stringify(canonical(actual.messages)), noWrites,
        preview: preview.messages, actual: actual.messages, count: session.risu.scriptstate.$count,
        luaOwners: _risuLuaSessions.has(session)};
    } finally {
      releaseRisuExecutionSession(session);
      D.characters = D.characters.filter(row => row !== char); delete D.chats[char.id];
      D.currentCharId = sourceChar.id;
    }
  });
  assert(randomRound.noWrites, '预览 start/预处理/request 不得写源聊天和变量');
  assert(randomRound.equal, 'Risu CBS、概率世界书和正则预览与实发必须逐字一致：' + JSON.stringify({preview: randomRound.preview.filter(row => /DESC |LORE_|REGEX |START |REQUEST |HISTORY /.test(row.content)), actual: randomRound.actual.filter(row => /DESC |LORE_|REGEX |START |REQUEST |HISTORY /.test(row.content))}));
  assert.equal(randomRound.count, '1');
  assert(randomRound.actual.some(row => row.content.includes('REGEX ')));
  assert(randomRound.actual.some(row => row.content.includes('REQUEST 1')));
  assert(randomRound.actual.some(row => row.content.includes('START ')));
  assert(randomRound.actual.some(row => /^HISTORY \d+$/.test(row.content)), '历史 CBS 应在请求中渲染');
  await page.locator('#user-input').fill('INPUT');
  await page.locator('#composer-action-btn').click();
  await page.waitForFunction(() => _generationState === 'idle' && getMsgs(getChar().id).some(message=>message.role==='assistant'));
  await page.waitForFunction(() => document.querySelector('#chat-messages').textContent.includes('DISPLAY_ONLY'));
  const outbound=requests[0].messages.map(message=>message.content).join('\n');
  assert(outbound.includes('INPUT_REQUEST')&&!outbound.includes('ST_LEAK'));
  const requestRows=requests[0].messages.map(message=>message.content), inputAt=requestRows.indexOf('INPUT_REQUEST');
  assert.equal(requestRows[inputAt-1],'RISU_START\n\n');assert.equal(requestRows[inputAt+1],'RISU_HISTORY_END\n\n');assert.equal(requestRows.at(-1),'RISU_PROMPT_END\n\n');
  const snap=await page.evaluate(async()=>{
    const char=getChar(),session=getActiveSession(char.id),state=JSON.stringify(session.risu);
    renderChat();renderChat();
    await saveData('sessions',{urgent:true});
    return {vars:session.risu.scriptstate,raw:session.msgs.map(row=>row.content),effective:session.msgs.map(risuMessageText),st:session.macroVars.count,state};
  });
  assert.equal(snap.vars.$count,'13');
  assert.deepStrictEqual(snap.raw,['INPUT','RAW_REPLY {{addvar::count::2}}']);
  assert.deepStrictEqual(snap.effective,['INPUT_SAVED','OUTPUT_SAVED ']);
  assert.equal(snap.st,'ST_UNCHANGED');
  await page.reload();await waitForAppReady(page);
  const restored=await page.evaluate(()=>{switchAppPage('chat');updateChatUI();renderChat();return JSON.stringify(getActiveSession(getChar().id).risu);});
  assert.equal(restored,snap.state,'display/reload never reruns variable writes');
  assert.equal(await page.evaluate(()=>runRisuManualTrigger('increment')),true);
  assert.equal(await page.evaluate(()=>getActiveSession(getChar().id).risu.scriptstate.$count),'113');
  // A start stop effect must stop the actual send path before any provider request.
  await page.evaluate(()=>{risuCardSources(getChar()).triggers.unshift({type:'start',comment:'stop',conditions:[],effect:[{type:'stop'}]});});
  const before=requests.length;
  await page.locator('#user-input').fill('STOP');await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='idle');
  assert.equal(requests.length,before);
  await page.evaluate(()=>{
    const triggers=risuCardSources(getChar()).triggers;triggers.shift();
    triggers[0].effect.push({type:'v2SetAuthorNote',value:'RISU_AUTHOR_NOTE'}, {type:'v2SetReplaceGlobalNote',value:'RISU_POST_NOTE'});
    triggers.push({type:'manual',comment:'lua',conditions:[],effect:[{type:'triggerlua',code:`
      function onInput(id) setChatVar(id, 'luaInput', '1') end
      function onStart(id) setChatVar(id, 'luaCBS', cbs('{{upper::lua}}')); setChatVar(id, 'luaNote', getAuthorsNote(id)) end
      function onOutput(id) setState(id, 'luaState', {ready=true}) end
      function manualLua(id) setChatVar(id, 'luaManual', tostring(getChatLength(id))) end
      listenEdit('editInput', function(id, text, meta) return text .. ' LUA_INPUT' end)
      listenEdit('editRequest', function(id, rows, meta) for _,row in ipairs(rows) do if row.role == 'user' then row.content = row.content .. ' LUA_REQUEST' end end return rows end)
      listenEdit('editOutput', function(id, text, meta) return text .. ' LUA_OUTPUT' end)
      listenEdit('editDisplay', function(id, text, meta) setChatVar(id, 'luaDisplay', '1') return text .. ' LUA_DISPLAY' end)
    `}]});
  });
  await page.locator('#user-input').fill('LUA_SEND');await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='idle'&&getActiveSession(getChar().id).risu.scriptstate.$luaCBS==='LUA');
  await page.waitForFunction(()=>document.querySelector('#chat-messages').textContent.includes('LUA_OUTPUT LUA_DISPLAY'));
  const luaResult=await page.evaluate(async()=>{
    await runRisuManualTrigger('manualLua');
    const session=getActiveSession(getChar().id);
    return {vars:session.risu.scriptstate,effective:risuMessageText(session.msgs.at(-1)),count:risuOfficialMessages(session).length};
  });
  assert.equal(luaResult.vars.$luaInput,'1');assert.equal(luaResult.vars.$luaDisplay,'1');
  assert.equal(luaResult.vars.$luaNote,'RISU_AUTHOR_NOTE');
  assert.equal(JSON.parse(luaResult.vars.$__luaState).ready,true);
  assert.equal(luaResult.vars.$luaManual,String(luaResult.count));
  assert(luaResult.effective.includes('LUA_OUTPUT'));
  assert(requests.at(-1).messages.some(row=>String(row.content).includes('LUA_SEND LUA_INPUT_REQUEST LUA_REQUEST')),'Lua edit hooks precede each mode’s regex pass');
  assert(requests.at(-1).messages.some(row=>String(row.content).includes('RISU_AUTHOR_NOTE')));
  assert(requests.at(-1).messages.some(row=>String(row.content).includes('RISU_POST_NOTE')));
  await page.evaluate(()=>risuCardSources(getChar()).triggers.push({type:'manual',comment:'choose',conditions:[],effect:[{type:'v2GetAlertSelect',value:'first|second',display:'选择',outputVar:'selected'}]}));
  page.once('dialog', dialog=>dialog.accept('1'));
  assert.equal(await page.evaluate(()=>runRisuManualTrigger('choose')),true);
  assert.equal(await page.evaluate(()=>getActiveSession(getChar().id).risu.scriptstate.$selected),'second');
  await page.evaluate(()=>risuCardSources(getChar()).triggers.push(
    {type:'manual',comment:'commandNested',conditions:[],effect:[{type:'setvar',var:'commandNested',operator:'=',value:'{{getvar::commandValue}}'}]},
    {type:'manual',comment:'commands',conditions:[],effect:[{type:'v2Command',value:'/setvar key=commandValue 2 | /addvar key=commandValue 3 | /sendas COMMAND_ROW | /trigger commandNested | /setinput COMMAND_INPUT'}]}
  ));
  assert.equal(await page.evaluate(()=>runRisuManualTrigger('commands')),true);
  const commandResult=await page.evaluate(async()=>{
    const session=getActiveSession(getChar().id), stored=(await YeyuRepository.load()).data.chats[getChar().id].sessions.find(row=>row.id===session.id);
    return {value:session.risu.scriptstate.$commandValue,nested:session.risu.scriptstate.$commandNested,last:session.msgs.at(-1).content,stored:stored.msgs.at(-1).content,input:$('user-input').value};
  });
  assert.deepStrictEqual(commandResult,{value:'5',nested:'5',last:'COMMAND_ROW',stored:'COMMAND_ROW',input:'COMMAND_INPUT'});
  await page.evaluate(()=>{risuCardSources(getChar()).card.lowLevelAccess=true;risuCardSources(getChar()).triggers.push({type:'output',comment:'one resend',conditions:[{type:'var',var:'resend',operator:'null',value:''}],effect:[{type:'setvar',var:'resend',operator:'=',value:'1'},{type:'sendAIprompt'}]});});
  const beforeResend=requests.length;
  await page.locator('#user-input').fill('RESEND_ONCE');await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='idle'&&getActiveSession(getChar().id).risu.scriptstate.$resend==='1');
  assert.equal(requests.length,beforeResend+2,'sendAIprompt starts exactly one additional generation');
  // simpleLLM follows upstream: one raw user row, a {success,result} table, and failures returned instead of thrown.
  await page.evaluate(()=>risuCardSources(getChar()).triggers.push({type:'manual',comment:'simple llm',conditions:[],effect:[{type:'triggerlua',code:`
    askModel = async(function(id)
      local ok = simpleLLM(id, '<|im_start|>system\\nYou are {{char}}.<|im_end|>'):await()
      setChatVar(id, 'simpleOk', tostring(ok.success) .. ':' .. ok.result)
      local bad = simpleLLM(id, 'SIMPLE_FAIL'):await()
      setChatVar(id, 'simpleBad', tostring(bad.success) .. ':' .. string.sub(bad.result, 1, 6))
    end)
  `}]}));
  const beforeSimple=requests.length;
  assert.equal(await page.evaluate(()=>runRisuManualTrigger('askModel')),true);
  assert.deepStrictEqual(requests[beforeSimple].messages,[{role:'user',content:'<|im_start|>system\nYou are {{char}}.<|im_end|>'}]);
  const simpleVars=await page.evaluate(()=>getActiveSession(getChar().id).risu.scriptstate);
  assert.equal(simpleVars.$simpleOk,'true:MODEL_OK');
  assert.equal(simpleVars.$simpleBad,'false:Error:');
  // setFullChat with a copied getFullChat row keeps the original once and adds the copy as a new message.
  const beforeDuplicate=await page.evaluate(()=>{
    const session=getActiveSession(getChar().id),last=session.msgs.at(-1);
    last.swipes=[last.content,'SWIPE_KEPT'];last.swipeId=0;
    risuCardSources(getChar()).triggers.push({type:'manual',comment:'duplicate',conditions:[],effect:[{type:'triggerlua',code:"function duplicateLast(id) local c = getFullChat(id) c[#c+1] = c[#c] c[#c].data = 'EDITED' setFullChat(id, c) end"}]});
    return {count:session.msgs.length,seq:last.seq};
  });
  assert.equal(await page.evaluate(()=>runRisuManualTrigger('duplicateLast')),true);
  const duplicated=await page.evaluate(()=>{
    const msgs=getActiveSession(getChar().id).msgs,[copied,added]=msgs.slice(-2);
    return {count:msgs.length,distinct:copied!==added,seqs:[copied.seq,added.seq],uniqueSeqs:new Set(msgs.map(row=>row.seq)).size===msgs.length,swipes:copied.swipes,addedSwipes:added.swipes,text:[risuMessageText(copied),risuMessageText(added)]};
  });
  assert.equal(duplicated.count,beforeDuplicate.count+1);
  assert(duplicated.distinct&&duplicated.uniqueSeqs);
  assert.equal(duplicated.seqs[0],beforeDuplicate.seq);
  assert.equal(duplicated.swipes[1],'SWIPE_KEPT');
  assert.equal(duplicated.addedSwipes,undefined);
  assert.deepStrictEqual(duplicated.text,['EDITED','EDITED']);
  await page.evaluate(()=>{
    const char=getChar(),session=getActiveSession(char.id),card=risuCardSources(char).card;
    session.msgs=[];session.risu.scriptstate.$historyCount='0';session.risu.scriptstate.$historyValue='BEFORE';char.nickname='BEFORE';
    card.triggerscript=[{type:'manual',comment:'history lua',conditions:[],effect:[{type:'triggerlua',code:"function tweakHistory(id) setChat(id, 0, getChatData(id, 0) .. ' LUA_HISTORY') end"}]}];card.customScripts=[{type:'editinput',in:'^',out:'PREFIX '},{type:'editinput',in:'literal',out:'SCRIPT'},{type:'editoutput',in:'^BASE ',out:''}];
  });
  modelReply='BASE {{addvar::historyCount::100}}{{char}}';
  const historyRaw='{{addvar::historyCount::1}}Name={{char}} value={{getvar::historyValue}} literal';
  await page.locator('#user-input').fill(historyRaw);await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='idle'&&getActiveSession(getChar().id).risu.scriptstate.$historyCount==='101');
  assert.equal(await page.evaluate(()=>runRisuManualTrigger('tweakHistory')),true);
  await page.evaluate(()=>{const char=getChar(),session=getActiveSession(char.id);char.nickname='AFTER';session.risu.scriptstate.$historyValue='AFTER';renderChat();});
  await page.waitForFunction(()=>document.querySelector('#chat-messages').textContent.includes('PREFIX Name=AFTER value=AFTER SCRIPT'));
  modelReply=' TAIL {{addvar::historyCount::10}}{{getvar::historyCount}}';
  await page.evaluate(()=>continueGeneration());
  await page.waitForFunction(()=>_generationState==='idle');
  const continuedHistory=await page.evaluate(()=>{
    const session=getActiveSession(getChar().id),message=session.msgs.find(row=>row.role==='assistant');
    return{count:session.risu.scriptstate.$historyCount,raw:message.content,template:risuMessageTemplate(message)};
  });
  assert.equal(continuedHistory.count,'111');
  assert.equal(continuedHistory.raw,'BASE {{addvar::historyCount::100}}{{char}} TAIL {{addvar::historyCount::10}}{{getvar::historyCount}}');
  assert(!continuedHistory.template.includes('BASE '));assert(continuedHistory.template.includes('{{char}}'));
  modelReply='FOLLOWUP';
  await page.locator('#user-input').fill('HISTORY_NEXT');await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='idle');
  assert(requests.at(-1).messages.some(row=>String(row.content).includes('PREFIX Name=AFTER value=AFTER SCRIPT')));
  const historyState=await page.evaluate(async()=>{
    const session=getActiveSession(getChar().id);await saveData(undefined,{urgent:true});
    return {count:session.risu.scriptstate.$historyCount,raw:session.msgs[0].content,template:risuMessageTemplate(session.msgs[0])};
  });
  assert.equal(historyState.count,'111');assert.equal(historyState.raw,historyRaw);assert(historyState.template.includes('{{char}}'));assert(historyState.template.endsWith('SCRIPT LUA_HISTORY'));
  await page.reload();await waitForAppReady(page);
  await page.evaluate(()=>{switchAppPage('chat');updateChatUI();renderChat();});
  await page.waitForFunction(()=>document.querySelector('#chat-messages').textContent.includes('PREFIX Name=AFTER value=AFTER SCRIPT'));
  assert.equal(await page.evaluate(()=>getActiveSession(getChar().id).risu.scriptstate.$historyCount),'111');
  await page.evaluate(()=>{
    risuCardSources(getChar()).triggers.push({type:'manual',comment:'cancel loop',conditions:[],effect:[{type:'triggerlua',code:"function onInput(id) setChatVar(id, 'cancelledWrite', 'bad') while true do end end"}]});
  });
  const beforeCancel=requests.length;
  await page.locator('#user-input').fill('CANCEL_INPUT');await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='preparing'&&_risuExecutions.size>0);
  await page.waitForFunction(()=>Date.now()-_generationActiveSince>=generationStopTapGuardMs());
  await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='idle',null,{timeout:2000});
  assert.equal(requests.length,beforeCancel);
  assert.equal(await page.evaluate(()=>getActiveSession(getChar().id).risu.scriptstate.$cancelledWrite),undefined);
  assert.equal(await page.evaluate(()=>getMsgs(getChar().id).some(row=>row.content==='CANCEL_INPUT')),false);
  assert.deepStrictEqual(errors,[]);
  console.log(JSON.stringify({importClick:true,sendClick:true,fourScriptStages:true,previewDryRunIsolation:true,previewSeededCbsOutboundIdentity:true,startOutputManual:true,systemPromptPositions:true,sendAIprompt:true,luaAllHooks:true,luaCBS:true,luaDisplayVariables:true,luaStopButton:true,rawPreserved:true,reload:true,variablesOnce:true,dynamicHistory:true,continuationWritesOnce:true,historyLuaEdits:true,stIsolation:true,stopBeforeProvider:true,provider:'local synthetic SSE',viewport:'450x974'}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
