'use strict';

// Real-card translation over the loaded app, actual Workers and persistent message transactions.
// --offline replaces only the completion response. Reports never contain card text, replies or credentials.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createHash} = require('crypto');
const {createAssetServer,listenOnBrowserSafePort,loadPlaywright,resolveEdgeExecutable}=require('../tests/source');
const {waitForAppReady}=require('../tests/helpers/app-ready');

function parseArguments(argv) {
  const options = { toggles: {}, switches: {}, offline: false, credentials: '', card: '', greeting: 0 };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--offline') options.offline = true;
    else if (value === '--card') options.card = argv[++i];
    else if (value === '--credentials') options.credentials = argv[++i];
    else if (value === '--greeting') options.greeting = Number(argv[++i]) || 0;
    else if (value === '--toggle' || value === '--switch') {
      const pair = String(argv[++i] || '').split('=');
      if (pair.length !== 2) throw new Error(value + ' 需要 键=值');
      (value === '--toggle' ? options.toggles : options.switches)['toggle_' + pair[0]] = pair[1];
    } else if (!options.card) options.card = value;
  }
  if (!options.card || (!options.offline && !options.credentials))
    throw new Error('用法：node tools/probes/risu_conditional_translation.js --card <原卡路径> (--credentials <测试 API 文件> | --offline)');
  return options;
}

function readCredentials(file) {
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const pick = (label) => {
    const hit = rows.find((row) => row.trim().startsWith(label));
    return hit ? hit.slice(hit.indexOf('：') + 1).trim() : '';
  };
  return {
    apiKey: pick('key'),
    apiUrl: pick('url').replace(/\/+$/, '') + '/chat/completions',
    model: pick('模型') || 'deepseek-chat',
  };
}

let server, browser;
(async()=>{
  const options=parseArguments(process.argv.slice(2));
  const sourceHash=createHash('sha256').update(fs.readFileSync(options.card)).digest('hex');
  const route=options.offline?{apiKey:'offline',apiUrl:'https://offline.example.test/v1',model:'offline'}:readCredentials(options.credentials);
  if(!route.apiKey)throw new Error('凭据文件里没有可用的 key');
  server=createAssetServer(path.resolve(__dirname,'../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser=await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  const page=await browser.newPage();
  // Live API requests keep their wire body, while Playwright forwards across the desktop browser's CORS boundary.
  await page.route('**/*',async intercepted=>{
    const url=intercepted.request().url();
    if(new URL(url).hostname==='127.0.0.1')return intercepted.continue();
    if(!options.offline&&url===route.apiUrl)return intercepted.fulfill({response:await intercepted.fetch()});
    return intercepted.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  await page.evaluate(()=>{openModal('import-modal');resetImport();});
  await page.locator('#file-input').setInputFiles(path.resolve(options.card));
  await page.waitForFunction(()=>pending.length===1&&!_importProgressActive);
  await page.evaluate(()=>{setPendingImportMode(0,'direct');appConfirm=async()=>true;});
  await page.locator('#import-preview button.primary').click();
  await page.waitForFunction(()=>D.characters.length===1&&!_importProgressActive);
  const report=await page.evaluate(async({options,route,filename})=>{
    const record={requests:[],finishReasons:[]};
    const nativeFetch=window.fetch;
    window.fetch=async(url,init)=>{
      if(!String(url).startsWith(route.apiUrl.replace(/\/chat\/completions$/, '')))return nativeFetch(url,init);
      const body=JSON.parse(init.body),input=body.messages.at(-1).content;
      record.requests.push(input);
      let response;
      if(options.offline){
        const reply=input.split(/(__YEYU_PART_\d+__)/).map((piece,index)=>{
          if(/^__YEYU_PART_\d+__$/.test(piece))return piece;
          const kept=piece.match(/__YEYU_KEEP_\d+__/g)||[];
          const size=piece.replace(/__YEYU_KEEP_\d+__/g,'').replace(/\s+/g,'').length;
          return '离'+record.requests.length+'段'+index+'译'.repeat(Math.max(1,size))+' '+kept.join(' ');
        }).join('\n');
        response=new Response(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
      }else response=await nativeFetch(url,init);
      const json=await response.clone().json();
      record.finishReasons.push(String(json.choices?.[0]?.finish_reason||''));
      return response;
    };
    const char=D.characters[0];D.currentCharId=char.id;
    const session=createBlankSession('Translation probe','translation-probe');
    session.greetingChosen=true;session.creatorNotesSeen=true;
    session.risu={globalVariables:{...options.toggles}};
    D.chats={[char.id]:{sessions:[session],activeSid:session.id}};
    Object.assign(activeProviderForSettings(D.settings),{...route,reasoningEffort:'off'});
    const original=getGreetings(char)[options.greeting]||char.first_mes;
    const message={role:'assistant',content:original,opening:true,openingIndex:options.greeting,seq:1};
    session.msgs.push(message);session.nextMessageSeq=2;
    await saveData(['characters','sessions','meta'],{urgent:true});
    switchAppPage('chat');updateChatUI();renderChat();
function markerCounts(text) {
  return {
    open: (String(text).match(/\{\{#\w+/g) || []).length,
    close: (String(text).match(/\{\{\/\w+\}\}/g) || []).length,
    macro: (String(text).match(/\{\{(?!#|\/|:)/g) || []).length,
  };
}

// The longest line the translation introduced: a stable anchor for checking later that an earlier
// pass's translation is still in place.
function newestLine(after, before) {
  const known = new Set(String(before).split(/\r?\n/).map((line) => line.trim()));
  return (
    String(after)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 8 && !known.has(line))
      .sort((a, b) => b.length - a.length)[0] || ''
  );
}

  const baseMarkers = markerCounts(original);
  const report = {
    card: filename,
    model: options.offline ? 'offline' : route.model,
    isRisuCharacter: isRisuCharacter(char),
    greetingIndex: options.greeting,
    greetingChars: original.length,
    conditionBlocks: YeyuRisuCBS.templateBlockCount(YeyuRisuCBS.parse(original)),
    hiddenTriggerPatterns: risuHiddenTriggerPatterns(char).length,
    markers: baseMarkers,
    greetingRenderedChars: (await risuRenderCBSInWorker(original, char, session, { message: message, chatIndex: -1 }))
      .replace(/\s+/g, '').length,
    alternateGreetingRenderedChars: await Promise.all(char.alternate_greetings.map(async (text) =>
      (await risuRenderCBSInWorker(text, char, session, { message: message, chatIndex: -1 })).replace(/\s+/g, '').length)),
    passes: [],
  };

  async function pass(label) {
    const before = message.content;
    const plan = await buildMessageTranslationPlan(message, char, session);
    const cut = (text, runs) => {
      let out = text;
      for (let i = runs.length - 1; i >= 0; i--) out = out.slice(0, runs[i].start) + '\u0000' + out.slice(runs[i].end);
      return out;
    };
    const outsideBefore = cut(before, plan.runs);
    await translateMessage(0);
    const request = record.requests[record.requests.length - 1] || '';
    const afterPlan = await buildMessageTranslationPlan(message, char, session);
    const markers = markerCounts(message.content);
    report.passes.push({
      step: label,
      visibleRuns: plan.runs.length,
      requestChars: request.length,
      requestBlockMarkers: (request.match(/\{\{#\w+|\{\{\/\w+\}\}/g) || []).length,
      requestKeepTokens: (request.match(/__YEYU_KEEP_\d+__/g) || []).length,
      sentRuns: request ? (request.match(/__YEYU_PART_\d+__/g) || []).length + 1 : 0,
      requestPartMarkers: (request.match(/__YEYU_PART_\d+__/g) || []).length,
      finishReason: record.finishReasons[record.finishReasons.length - 1] || '',
      contentChanged: message.content !== before,
      contentChars: message.content.length,
      markersUnchanged: markers.open === baseMarkers.open && markers.close === baseMarkers.close,
      macrosUnchanged: markers.macro === baseMarkers.macro,
      untouchedRegionsIdentical: cut(message.content, afterPlan.runs) === outsideBefore,
      leftoverPlaceholders: /__YEYU_(KEEP|PART)_\d+__/.test(message.content),
      toastKind: $('toasts').lastElementChild?.classList.contains('err') ? 'err' : 'ok',
      persisted: (await YeyuRepository.load()).data.chats[char.id].sessions[0].msgs[0].content === message.content,
    });
  }

  await pass('首次翻译');
  report.originalContentIsPreTranslation = message.original_content === original;
  const afterFirst = message.content;
  const firstReplyAnchor = newestLine(afterFirst, original);

  if (Object.keys(options.switches).length) {
    Object.assign(session.risu.globalVariables, options.switches);
    const switchedPlan = await buildMessageTranslationPlan(message, char, session);
    report.afterSwitch = {
      visibleRuns: switchedPlan.runs.length,
      runsStillOriginal: switchedPlan.runs.filter(
        (run) => message.content.slice(run.start, run.end).trim() === run.source
      ).length,
    };
    await pass('切换选项后再次翻译');
    report.afterSwitch.previousTranslationRetained = firstReplyAnchor
      ? message.content.includes(firstReplyAnchor)
      : null;
    report.afterSwitch.contentDiffersFromFirstPass = message.content !== afterFirst;
    report.afterSwitch.originalContentStable = message.original_content === original;
  }

  await restoreOriginalMessage(0);
  report.restoredToOriginal = message.content === original;
  report.originalCopyCleared = message.original_content === undefined;

  const stored = (await YeyuRepository.load()).data.chats[char.id].sessions[0].msgs[0];
  report.restoredPersisted = stored.content === original && stored.original_content === undefined;
  return report;
  },{options,route,filename:path.basename(options.card)});
  for(const row of report.passes){
    assert(row.contentChanged&&row.persisted&&row.toastKind==='ok','translation did not commit at '+row.step);
    assert(row.markersUnchanged&&row.macrosUnchanged&&row.untouchedRegionsIdentical&&!row.leftoverPlaceholders,'translation changed protected structure at '+row.step);
  }
  assert(report.originalContentIsPreTranslation&&report.restoredToOriginal&&report.originalCopyCleared&&report.restoredPersisted,'original message did not survive translation/restoration');
  assert.strictEqual(createHash('sha256').update(fs.readFileSync(options.card)).digest('hex'),sourceHash,'original card file changed');
  console.log(JSON.stringify({...report,sha256:sourceHash,sourceFileUnchanged:true,application:'real loaded app',provider:options.offline?'local fixed completion':'live configured model',device:'Edge mobile context; Android unverified'},null,1));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server){server.closeAllConnections();server.close();}});
