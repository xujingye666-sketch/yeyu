'use strict';

const assert=require('assert');
const path=require('path');
const {createAssetServer, listenOnBrowserSafePort,loadPlaywright,resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const assets=path.resolve(process.env.YEYU_ASSETS_ROOT||path.resolve(__dirname,'../../app/src/main/assets'));
let browser;
let server;

(async()=>{
 server=createAssetServer(assets);
 await listenOnBrowserSafePort(server);
 browser=await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
 await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'load'});
 await waitForAppReady(page, {timeout:15000});

 const result=await page.evaluate(()=>{
  function makeMessages(count,repeat){
   return Array.from({length:count},(_,index)=>({
    seq:index+1,
    role:index%2===0?'user':'assistant',
    content:('第 '+(index+1)+' 条对话内容。').repeat(repeat||1),
   }));
  }
  function ordinarySent(built){
   return built.messages.filter(message=>message.role==='user'||message.role==='assistant');
  }

  const original={
   settings:copyJsonData(D.settings),
   worldBook:copyJsonData(D.worldBook),
   characters:D.characters,
   personas:D.personas,
   chats:D.chats,
   currentCharId:D.currentCharId,
   currentPersonaId:D.currentPersonaId,
   getBuiltMessages:window.getBuiltMessages,
  };
  try{
   const char={id:'trim-summary-char',name:'测试角色',description:'',personality:'',scenario:'',first_mes:'',mes_example:'',extensions:{}};
   D.characters=[char];
   D.personas=[];
   D.currentCharId=char.id;
   D.currentPersonaId=null;
   D.worldBook={categories:[],globalCategoryIds:[],scan_depth:20,token_budget:0,recursive:false};
   Object.assign(D.settings,{
    maxContextTokens:20000,
    maxTokens:1000,
    useMemory:true,
    recentMsgLimit:10,
    autoSummaryEvery:30,
    systemTpl:'',
    enhancePrompt:'',
    auxPrompt:'',
    postHistory:'',
    authorsNote:'',
    maxExampleTokens:0,
   });

   const overTwenty=makeMessages(23,4);
   const noSummarySession={id:'no-summary',msgs:overTwenty,memoryStore:makeEmptyMemoryStore()};
   D.chats={[char.id]:{sessions:[noSummarySession],activeSid:noSummarySession.id}};
   const noSummary=buildMessages(char,overTwenty,noSummarySession,{});
   const afterSent=overTwenty.filter(row=>ordinarySent(noSummary).some(message=>message.role===row.role&&message.content===row.content)).length;

   const summarizedSession={id:'summarized',msgs:overTwenty,memoryStore:makeEmptyMemoryStore()};
   summarizedSession.memoryStore.historySummary=memoryV5NormalizeHistorySummary({
    text:'前十二条对话的摘要',
    sourceStartSeq:1,
    sourceEndSeq:12,
    sourceHash:'trim-summary-range-1-12',
   },summarizedSession.id);
   D.chats={[char.id]:{sessions:[summarizedSession],activeSid:summarizedSession.id}};
   const summarized=buildMessages(char,overTwenty,summarizedSession,{});
   const summarizedOrdinary=ordinarySent(summarized);

   D.settings.maxContextTokens=2500;
   const oversized=makeMessages(23,80);
   const tokenSession={id:'token-budget',msgs:oversized,memoryStore:makeEmptyMemoryStore()};
   D.chats={[char.id]:{sessions:[tokenSession],activeSid:tokenSession.id}};
   const tokenLimited=buildMessages(char,oversized,tokenSession,{});

   return{
    comparison:{maxContextTokens:20000,historyMessages:23,afterSent,usedTokens:noSummary.usedTokens},
    noSummaryTrimmed:noSummary.trimmedMessages,
    summarizedCount:summarized.summarized,
    summarizedTrimmed:summarized.trimmedMessages,
    summaryIncluded:summarized.messages.some(message=>String(message.content||'').includes('前十二条对话的摘要')),
    coveredRawIncluded:summarizedOrdinary.some(message=>message.content===overTwenty[0].content),
    uncoveredRawIncluded:summarizedOrdinary.some(message=>message.content===overTwenty[12].content),
    summarizedLatestIncluded:summarizedOrdinary.some(message=>message.content===overTwenty.at(-1).content),
    tokenTrimmed:tokenLimited.trimmedMessages,
    tokenLatestIncluded:ordinarySent(tokenLimited).some(message=>message.content===oversized.at(-1).content),
   };
  }finally{
   D.settings=original.settings;
   D.worldBook=original.worldBook;
   D.characters=original.characters;
   D.personas=original.personas;
   D.chats=original.chats;
   D.currentCharId=original.currentCharId;
   D.currentPersonaId=original.currentPersonaId;
   window.getBuiltMessages=original.getBuiltMessages;
  }
 });

 assert.strictEqual(result.comparison.afterSent,23,'没有摘要时，20000 上限内的 20 条以上历史必须全部发送');
 assert.strictEqual(result.noSummaryTrimmed,0);
 assert.ok(result.comparison.usedTokens<20000,'对照会话必须确实装得进 20000 Token 上限');
 assert.strictEqual(result.summarizedCount,12,'状态必须统计已被摘要替代的原始消息');
 assert.strictEqual(result.summarizedTrimmed,0);
 assert.strictEqual(result.summaryIncluded,true,'已整理内容必须由摘要替代');
 assert.strictEqual(result.coveredRawIncluded,false,'已被摘要覆盖的原文可以从请求中省略');
 assert.strictEqual(result.uncoveredRawIncluded,true,'摘要范围之后的原文不得因最近条数限制被省略');
 assert.strictEqual(result.summarizedLatestIncluded,true,'当前轮用户正文必须保留');
 assert.ok(result.tokenTrimmed>0,'真实 Token 预算装不下时仍必须裁剪');
 assert.strictEqual(result.tokenLatestIncluded,true,'预算再小也必须保留当前轮用户正文');
 assert.deepStrictEqual(pageErrors,[]);

 console.log(JSON.stringify({
  trimRequiresSummary:true,
  comparison:result.comparison,
  summarizedMessages:result.summarizedCount,
  tokenBudgetStillTrims:result.tokenTrimmed,
  latestUserPreserved:true,
 }));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close().catch(()=>{});
 if(server)await new Promise(resolve=>server.close(resolve));
});
