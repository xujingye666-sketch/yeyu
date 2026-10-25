const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');

(async () => {
  const server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  const browser = await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await waitForAppReady(page);
    const results = await page.evaluate(async () => {
      const original = YeyuRisuRegexRuntime, NativeWorker = Worker, rows = [];
      window.resolveApiRoute = () => ({apiKey:'fixture',apiUrl:'https://example.invalid',model:'fixture'});
      let requests = 0;
      window.fetchCompatibleCompletion = async () => {requests++;throw new Error('Computation must finish before request');};
      for (const stage of ['visible-spans','protect-translation']) {
        for (const action of ['timeout','stop','leave']) {
          const char = {id:'translation-worker',name:'Translation',extensions:{risuai:{customScripts:
            stage === 'protect-translation' ? [{type:'editdisplay',in:'(a+)+$',out:'',ableFlag:true,flag:'g'}] : [],
          }}};
          const session = createBlankSession('Translate', 'translation-session');
          const source = stage === 'visible-spans' ? '{{#if 1}}{{range::1e100}}{{/if}}' : 'a'.repeat(50000)+'!';
          const message = {role:'assistant',content:source,seq:1};
          session.msgs=[message];
          D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{sessions:[session],activeSid:session.id}};
          const runtime = original.createRuntime({defaultTimeoutMs: action==='timeout'?50:4000});
          let started=false, ticks=0;
          window.Worker = class extends NativeWorker {
            constructor(...args) {
              super(...args);
              this.addEventListener('message', event => {
                if (this.requestType !== stage || event.data.type !== 'started' || started) return;
                started=true;
                if (action !== 'timeout') setTimeout(() => {
                  if (action==='stop') stopGeneration();
                  else releaseRisuExecutionSession(session);
                },20);
              });
            }
            postMessage(message) {this.requestType=message.type;super.postMessage(message);}
          };
          window.YeyuRisuRegexRuntime = Object.assign({},original,{
            visibleSpans:(input,context,options) => runtime.visibleSpans(input,context,options),
            protectTranslation:(...args) => runtime.protectTranslation(...args),
          });
          const heartbeat=setInterval(()=>{ticks++;},5);
          try {await translateMessage(0);}
          finally {
            clearInterval(heartbeat);runtime.dispose();window.Worker=NativeWorker;window.YeyuRisuRegexRuntime=original;
          }
          rows.push({stage,action,started,responsive:ticks>0,unchanged:message.content===source,
            idle:_generationState==='idle',active:runtime.active.size,executions:_risuExecutions.size,requests});
        }
      }
      return rows;
    });
    for (const row of results) assert(row.started && row.responsive && row.unchanged && row.idle &&
      row.active===0 && row.executions===0 && row.requests===0, JSON.stringify(row));
    console.log(JSON.stringify({translationWorkerIsolation:results}));
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
