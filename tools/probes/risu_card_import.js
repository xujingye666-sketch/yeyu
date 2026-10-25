'use strict';
/* global __loreProbeBuild, __loreProbePreviews, __loreProbeOriginal -- browser-only real-card probe state */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {createAssetServer,listenOnBrowserSafePort,loadPlaywright,resolveEdgeExecutable} = require('../tests/source');
const root = path.resolve(__dirname,'../..');
const {resolveCardPaths} = require('./real_cards');
const {waitForAppReady} = require('../tests/helpers/app-ready');
const generation=process.argv.includes('--generation');
const loreRegexProbe=process.argv.includes('--lore-regex-probe');
const usage = '用法：node tools/probes/risu_card_import.js [--generation [--lore-regex-probe]] <原卡路径> [原卡路径...]';
assert(!loreRegexProbe || generation, '--lore-regex-probe requires --generation\n' + usage);
const cardArgs=process.argv.slice(2).filter(value=>!['--generation','--lore-regex-probe'].includes(value));
const cards = resolveCardPaths(cardArgs, usage);
let server,browser;
async function checkLoreRegexParity(page) {
  const requests=[];
  await page.route('**/risu-lore-parity/**', async route=>{
    requests.push(route.request().postDataJSON().messages);
    await route.fulfill({status:200,contentType:'text/event-stream',body:
      'data: '+JSON.stringify({choices:[{delta:{content:'REGEX_PARITY_REPLY'},finish_reason:null}]})+'\n\n'+
      'data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});
  });
  const inventory=await page.evaluate(async()=>{
    const char=D.characters[0], initial=risuLorebookInitialGlobal(char);
    window.__loreProbeOriginal={characters:cloneData(D.characters),chats:cloneData(D.chats),settings:cloneData(D.settings),currentCharId:D.currentCharId,
      character:JSON.stringify(char),history:JSON.stringify(D.chats),storedCharacter:JSON.stringify((await YeyuRepository.load()).data.characters[0])};
    const copy=cloneData(char);
    copy.extensions.yeyu=copy.extensions.yeyu||{};
    // The fixed upstream retains the leading slash in the first alternative. The second alternative
    // matches ordinary chat text, and cannot be activated by the ordinary keyword matcher.
    const key='/UNUSED_REGEX_BRANCH|\\bYEYU_REGEX\\s+\\d+\\b/i';
    const probe=(label,position,order)=>({key,content:'@@no_recursive_search\n@@unrecursive\n'+position+'\n'+label,
      comment:label,mode:'normal',alwaysActive:false,useRegex:true,selective:false,insertorder:order});
    copy.extensions.yeyu.risuLorebookState=initial.entries.concat([
      probe('LORE_REGEX_BEFORE_LOW','@@position before_desc',20),
      probe('LORE_REGEX_BEFORE_HIGH','@@position before_desc',80),
      probe('LORE_REGEX_AFTER','@@position after_desc',40),
      probe('LORE_REGEX_DEPTH_ASSISTANT_LOW','@@depth 0\n@@role assistant',10),
      probe('LORE_REGEX_DEPTH_USER_LOW','@@depth 0\n@@role user',30),
      probe('LORE_REGEX_DEPTH_SYSTEM','@@depth 0\n@@role system',50),
      probe('LORE_REGEX_DEPTH_ASSISTANT_HIGH','@@depth 0\n@@role assistant',60),
      probe('LORE_REGEX_DEPTH_USER_HIGH','@@depth 0\n@@role user',70),
      probe('LORE_REGEX_MAIN','@@inject_at main\n@@inject_prepend',90),
      probe('LORE_REGEX_GLOBAL_NOTE','@@inject_at globalNote\n@@inject_prepend',100),
    ]);
    D.characters=[copy];D.currentCharId=copy.id;
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings),{apiUrl:location.origin+'/risu-lore-parity/v1',apiKey:'synthetic-local',model:'synthetic-model',reasoningEffort:'off',promptPostProcessing:'none'});
    Object.assign(D.settings,{useMemory:false,embeddingEnabled:false,styleAuditEnabled:false,maxContextTokens:0});
    window.__loreProbePreviews=[];
    window.__loreProbeBuild=buildPresetRoundPreview;
    window.buildPresetRoundPreview=async function(){
      const result=await __loreProbeBuild.apply(this,arguments);
      if(result)__loreProbePreviews.push(result);
      return result;
    };
    return {source:initial.source,originalEntries:initial.entries.length,originalRegexEntries:initial.entries.filter(row=>row.useRegex).length};
  });
  const cases=[];
  try {
    for(const [label,input,hit] of [['hit','YEYU_REGEX 73',true],['miss','YEYU_REGEX seventy-three',false]]) {
      await page.evaluate(async({label,input})=>{
        cancelPresetRoundPreviewBuild();
        if(_presetRoundPreviewRun)await _presetRoundPreviewRun;
        _presetRoundPreviewExpanded=false;
        __loreProbePreviews.length=0;
        const char=getChar(),session=createBlankSession('Regex probe', 'regex-probe-'+label);
        session.greetingChosen=true;session.creatorNotesSeen=true;
        session.msgs=[{role:'user',content:input,seq:1}];session.nextMessageSeq=2;
        D.chats={[char.id]:{sessions:[session],activeSid:session.id}};
        switchAppPage('presets');switchCompletionPresetTab('order');
      },{label,input});
      const snapshot=await page.evaluate(()=>JSON.stringify({characters:D.characters,chats:D.chats}));
      await page.locator('#prompt-preview-toggle').click();
      await page.waitForFunction(()=>!_presetRoundPreviewRun&&__loreProbePreviews.length&&document.getElementById('prompt-preview-box').textContent.includes('YEYU_REGEX'));
      const preview=await page.evaluate(async()=>{
        const result=__loreProbePreviews.at(-1),char=getChar(),session=getActiveSession(char.id);
        const resolved=await risuLorebookCreateTransaction(char,session).resolve();
        const texts=result.messages.map(row=>String(row.content));
        const expectedTail=risuLorebookPromptShape(resolved,session.msgs.length).risuPostEverythingItems.map(({role,content})=>({role,content}));
        const renderedTail=await risuRenderCBSBatchInWorker(expectedTail.map(row=>row.content),char,session,{runVar:false});
        expectedTail.forEach((row,index)=>row.content=renderedTail[index]);
        return {messages:result.messages,unchanged:JSON.stringify({characters:D.characters,chats:D.chats}),
          active:resolved.actives.filter(row=>row.source.startsWith('LORE_REGEX_')).map(row=>({source:row.source,pos:row.pos,depth:row.depth,role:row.role})),
          chatRegexMatches:resolved.matchLog.filter(row=>row.activated.includes('YEYU_REGEX')&&row.source.startsWith('message ')).length,
          keywordOnlyMatches:YeyuRisuLorebook.resolve({entries:risuLorebookInitialGlobal(char).entries.filter(row=>row.comment.startsWith('LORE_REGEX_')).map(row=>({...row,useRegex:false})),messages:session.msgs,settings:{recursiveScanning:false}}).actives.length,
          positions:['LORE_REGEX_BEFORE_LOW','LORE_REGEX_BEFORE_HIGH','LORE_REGEX_AFTER'].map(value=>texts.join('\n').indexOf(value)),
          tails:result.messages.filter(row=>String(row.content).startsWith('LORE_REGEX_DEPTH_')),
          postEverythingTail:expectedTail.length===0||JSON.stringify(result.messages.slice(-expectedTail.length))===JSON.stringify(expectedTail),
          slotInjections:['LORE_REGEX_MAIN','LORE_REGEX_GLOBAL_NOTE'].map(value=>texts.filter(text=>text.includes(value)).length)};
      });
      assert.strictEqual(preview.unchanged,snapshot,'preview changed isolated card or raw chat');
      assert.strictEqual(preview.active.length,hit?10:0,'regex activation branch did not match expected chat');
      assert.strictEqual(preview.chatRegexMatches,hit?10:0,'probe must match chat regex, not constant or recursive lore');
      assert.strictEqual(preview.keywordOnlyMatches,0,'ordinary keyword matching must not activate the probes');
      if(hit){
        const characterEntries=preview.active.filter(row=>['before_desc','after_desc'].includes(row.pos));
        assert.deepStrictEqual(characterEntries.map(row=>row.source),['LORE_REGEX_BEFORE_LOW','LORE_REGEX_AFTER','LORE_REGEX_BEFORE_HIGH'],'Risu insertorder changed');
        assert(preview.positions.every(value=>value>=0)&&preview.positions[0]<preview.positions[1]&&preview.positions[1]<preview.positions[2],'lore position/order changed: '+JSON.stringify(preview.positions));
        assert.deepStrictEqual(characterEntries.map(row=>row.pos),['before_desc','after_desc','before_desc']);
        assert.deepStrictEqual(preview.tails,[
          {role:'user',content:'LORE_REGEX_DEPTH_USER_LOW'}, {role:'system',content:'LORE_REGEX_DEPTH_SYSTEM'},
          {role:'user',content:'LORE_REGEX_DEPTH_USER_HIGH'}, {role:'assistant',content:'LORE_REGEX_DEPTH_ASSISTANT_LOW'},
          {role:'assistant',content:'LORE_REGEX_DEPTH_ASSISTANT_HIGH'},
        ],'depth=0 must retain non-assistant activation order followed by assistant prefill');
        assert(preview.postEverythingTail,'all original and probe depth=0 entries must follow normal preset reassembly');
        assert.deepStrictEqual(preview.slotInjections,[1,1],'main/globalNote injection must enter the final request exactly once');
      }else {
        assert(preview.positions.every(value=>value===-1),'unmatched lore entered preview');
        assert.deepStrictEqual(preview.tails,[],'unmatched depth=0 lore entered preview');
        assert.deepStrictEqual(preview.slotInjections,[0,0],'unmatched slot injection entered preview');
      }
      preview.messages.forEach(row=>assert(!Object.keys(row).some(key=>key.startsWith('_yeyu')),'internal lore identity leaked into outbound message'));
      const count=requests.length;
      await page.evaluate(async()=>{
        switchAppPage('chat');updateChatUI();renderChat();
        const session=getActiveSession(getChar().id);
        await regenerateLast();
        await _generationPostCommitTasks.get(session);
      });
      const roundRequests=requests.slice(count), mainRequests=roundRequests.filter(messages=>messages.some(row=>row.role==='user'&&row.content===input));
      assert.strictEqual(mainRequests.length,1,'generation entry must issue exactly one main model request');
      assert(JSON.stringify(mainRequests[0])===JSON.stringify(preview.messages),'actual wire request differs from UI preview');
      assert(await page.evaluate(()=>getMsgs(getChar().id).at(-1).content==='REGEX_PARITY_REPLY'),'reply was not committed');
      cases.push({case:label,active:preview.active.length,chatRegexMatches:preview.chatRegexMatches,keywordOnlyMatches:preview.keywordOnlyMatches,previewUnchanged:true,requestParity:true,positionOrder:true,depthZeroRolesAndOrder:true,slotInjections:preview.slotInjections,requestMessages:mainRequests[0].length,auxiliaryRequests:roundRequests.length-mainRequests.length});
    }
  } finally {
    await page.evaluate(async()=>{
      cancelPresetRoundPreviewBuild();_presetRoundPreviewExpanded=false;
      const original=__loreProbeOriginal;
      D.characters=original.characters;D.chats=original.chats;D.settings=original.settings;D.currentCharId=original.currentCharId;
      window.buildPresetRoundPreview=__loreProbeBuild;
      if(JSON.stringify(D.characters[0])!==original.character||JSON.stringify(D.chats)!==original.history)throw new Error('original imported data changed');
      await saveData(['characters','sessions','meta'],{urgent:true});
      const stored=(await YeyuRepository.load()).data;
      if(JSON.stringify(stored.characters[0])!==original.storedCharacter)throw new Error('restored character differs from original persisted character');
    });
  }
  return {...inventory,overlay:'ten synthetic regex entries on an isolated copy of imported real card',cases,
    originalImportedDataPreserved:true,provider:'local synthetic SSE',previewEntry:'preset order tab preview toggle',sendEntry:'regenerateLast on existing user message',
    disabledAuxiliary:['memory','embedding','style-audit'],contextBudget:'unlimited',fixedUpstreamRegex:'leading slash retained in first alternative; ordinary chat matched by second alternative'};
}
async function checkGeneration(page) {
  const cbs="{{upper::don't}} / {{#when::1}}a{{//::note}}b{{/}} / PICK={{pick}}";
  const outbound=[];
  let requestPick='';
  await page.route('**/risu-probe-model/**',async route=>{
    const text=route.request().postDataJSON().messages.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
    const main=text.includes('CBS_INPUT ');
    const pick=main?await page.evaluate(()=>risuRenderCBSInWorker('{{pick}}',getChar(),getActiveSession(getChar().id))):null;
    outbound.push({text,main,pick});
    if(main)requestPick=pick;
    await route.fulfill({status:200,contentType:'text/event-stream',body:[{choices:[{delta:{content:'CBS_REPLY '+cbs},finish_reason:null}]},{choices:[{delta:{},finish_reason:'stop'}]}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n'});
  });
  await page.evaluate(async()=>{
    const char=D.characters[0];D.currentCharId=char.id;
    const session=getActiveSession(char.id);
    session.greetingChosen=true;session.creatorNotesSeen=true;
    if(!session.msgs.length&&char.first_mes)appendOpeningGreeting(char,session,char.first_mes,0);
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings),{apiUrl:location.origin+'/risu-probe-model/v1',apiKey:'synthetic-local',model:'synthetic-model',reasoningEffort:'off'});
    Object.assign(D.settings,{useMemory:false,embeddingEnabled:false,styleAuditEnabled:false,maxContextTokens:0});
    await saveData(['sessions','meta'],{urgent:true});
    switchAppPage('chat');updateChatUI();renderChat();
  });
  await page.locator('#user-input').fill('CBS_INPUT '+cbs);
  await page.locator('#composer-action-btn').click();
  await page.waitForFunction(()=>_generationState==='idle'&&getMsgs(getChar().id).some(message=>message.role==='assistant'&&!message.opening));
  assert.strictEqual(outbound.filter(row=>row.main).length,1,'send click must issue exactly one main request');
  assert(requestPick&&outbound.some(row=>row.main&&row.text.includes("CBS_INPUT DON'T / a{{//::note}}b / PICK="+row.pick)),'real-card request must evaluate CBS with the submitted user message in official history');
  const snapshot=await page.evaluate(async()=>{
    renderChat();await saveData(['sessions','meta'],{urgent:true});
    const messages=getMsgs(getChar().id),user=messages.filter(message=>message.role==='user').at(-1),reply=messages.filter(message=>message.role==='assistant'&&!message.opening).at(-1);
    const sources=risuCardSources(getChar());
    return {pick:await risuRenderCBSInWorker('{{pick}}',getChar(),getActiveSession(getChar().id)),scriptedDisplay:!!(sources.regex.length||sources.triggers.length),userRaw:user&&user.content,userSource:user&&user.risu&&user.risu.source,replyRaw:reply&&reply.content};
  });
  // Plain CBS follows current message count; scripted display retains the unchanged user's computed snapshot.
  await page.waitForFunction(({inputPick,replyPick})=>{const body=document.querySelector('#chat-messages').textContent;return body.includes('CBS_INPUT DON\'T / a{{//::note}}b / PICK='+inputPick)&&body.includes('CBS_REPLY DON\'T / a{{//::note}}b / PICK='+replyPick);},{inputPick:snapshot.scriptedDisplay?requestPick:snapshot.pick,replyPick:snapshot.pick});
  assert(snapshot.userRaw==='CBS_INPUT '+cbs&&snapshot.userSource===snapshot.userRaw,'user storage changed raw CBS');
  assert(snapshot.replyRaw==='CBS_REPLY '+cbs,'reply storage changed raw CBS');
  await page.reload();await waitForAppReady(page);
  await page.evaluate(()=>{switchAppPage('chat');updateChatUI();renderChat();});
  await page.waitForFunction(pick=>{const body=document.querySelector('#chat-messages').textContent;return body.includes('CBS_INPUT DON\'T / a{{//::note}}b / PICK='+pick)&&body.includes('CBS_REPLY DON\'T / a{{//::note}}b / PICK='+pick);},snapshot.pick);
  const restored=await page.evaluate(async()=>{
    switchAppPage('chat');updateChatUI();renderChat();
    const char=getChar(),session=getActiveSession(char.id);
    const messages=getMsgs(char.id),user=messages.filter(message=>message.role==='user').at(-1),reply=messages.filter(message=>message.role==='assistant'&&!message.opening).at(-1);
    return {pick:await risuRenderCBSInWorker('{{pick}}',char,session),promptPick:await replaceCharacterMacros('{{pick}}',char,'用户',createRisuMacroState(char,session)),body:document.querySelector('#chat-messages').textContent,userRaw:user&&user.content,replyRaw:reply&&reply.content};
  });
  assert.equal(restored.pick,snapshot.pick);assert.equal(restored.promptPick,snapshot.pick);
  assert.equal(restored.userRaw,snapshot.userRaw);assert.equal(restored.replyRaw,snapshot.replyRaw);
  assert(restored.body.includes("CBS_INPUT DON'T / a{{//::note}}b / PICK="+snapshot.pick),'real-card reload changed user CBS display');
  assert(restored.body.includes("CBS_REPLY DON'T / a{{//::note}}b / PICK="+snapshot.pick),'real-card reload changed CBS display');
  return {sendClick:true,repairedCBSRequest:true,userCBSDisplay:true,replyCBSDisplay:true,userDisplayContext:snapshot.scriptedDisplay?'scripted cached snapshot':'current official history',pickReload:true,userRawPreserved:true,replyRawPreserved:true,provider:'local synthetic SSE',requests:outbound.length,mainRequests:outbound.filter(row=>row.main).length,cardAuxiliaryRequests:outbound.filter(row=>!row.main).length,disabledAuxiliary:['memory','embedding','style-audit'],contextBudget:'unlimited'};
}
(async()=>{
  server=createAssetServer(path.join(root,'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser=await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  for(const file of cards){
    const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const context=await browser.newContext({viewport:{width:450,height:974}}),page=await context.newPage();
    page.setDefaultTimeout(180000);
    let pageErrors=0;page.on('pageerror',()=>pageErrors++);
    // No remote card content is needed for import or storage verification.
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    try{
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
      await waitForAppReady(page);
      await page.evaluate(()=>{openModal('import-modal');resetImport();});
      await page.locator('#file-input').setInputFiles(file);
      await page.waitForFunction(()=>pending.length===1&&!_importProgressActive);
      const before=await page.evaluate(()=>{
        const char=pending[0],sources=risuCardSources(char);
        window.__risuExpectedRaw=JSON.stringify(char.importMeta.rawCard);
        window.__risuExpectedModule=JSON.stringify(sources.module);
        return {risu:isRisuCharacter(char),assets:char.media_assets.length,module:sources.module!==null,regex:sources.regex.length,triggers:sources.triggers.length,moduleLorebook:(sources.lorebook||[]).length};
      });
      assert(before.risu,'source did not select Risu');
      await page.evaluate(()=>{setPendingImportMode(0, 'direct');appConfirm=async()=>true;});
      await page.locator('#import-preview button.primary').click();
      await page.waitForFunction(()=>D.characters.length===1&&!_importProgressActive);
      const saved=await page.evaluate(async()=>{
        const char=D.characters[0];
        await saveData(['characters','sessions','meta'],{urgent:true});
        const stored=(await YeyuRepository.load()).data.characters[0];
        const module=JSON.stringify(risuCardSources(stored).module);
        return {raw:JSON.stringify(stored.importMeta.rawCard)===__risuExpectedRaw,modulePreserved:module===__risuExpectedModule,media:stored.media_assets.filter(asset=>asset.mediaKey).length,expressions:YeyuExpressionAssets.bindings(stored).length,ecosystem:analyzeCardDependencies(stored).ecosystem};
      });
      assert(saved.raw&&saved.modulePreserved&&saved.ecosystem==='risu'&&saved.expressions===0,'storage fidelity/isolation');
      await page.reload();
      await waitForAppReady(page);
      const restored=await page.evaluate(()=>{
        const char=D.characters[0],sources=risuCardSources(char);
        return {risu:isRisuCharacter(char),assets:char.media_assets.length,module:sources.module!==null,regex:sources.regex.length,triggers:sources.triggers.length,moduleLorebook:(sources.lorebook||[]).length};
      });
      assert.deepStrictEqual(restored,before,'reload changed source inventory');
      const generated=generation?await checkGeneration(page):null;
      const loreRegex=loreRegexProbe?await checkLoreRegexParity(page):null;
      assert.equal(pageErrors,0,'page errors during actual import');
      assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sourceHash,'source card file changed');
      console.log(JSON.stringify({file:path.basename(file),sha256:sourceHash,...before,...saved,reload:true,generation:generated,loreRegex,sourceFileUnchanged:true,pageErrors,viewport:'450x974',boundary:'Edge desktop; direct import; confirmation auto-accepted; remote resources blocked; card scripts enabled; asset/HTML presentation deferred'}));
    }finally{await context.close();}
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
