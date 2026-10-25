"use strict";
// Script-initiated generate/generateRaw settles in every state.
// Success and a host-side stop must settle the sandbox promise; a host stop must arrive as an AbortError so the script's own
// notification lifecycle can finish instead of staying on "loading" forever.
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const {loadPlaywright, listenOnBrowserSafePort, resolveEdgeExecutable} = require("./source");
const {waitForAppReady} = require("./helpers/app-ready");

const root = path.resolve(process.env.YEYU_TEST_ROOT || path.resolve(__dirname, "../.."));
const assets = path.join(root, "app/src/main/assets");
const evidenceDir = path.join(root, ".tmp", process.env.YEYU_EVIDENCE_NAME || "card-script-generation-bridge");

function serve(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const sse = piece => "data: " + JSON.stringify(piece) + "\n\n";
  if (url.pathname === "/json-ok") {
    res.writeHead(200, {"content-type": "application/json"});
    res.end(JSON.stringify({choices: [{message: {content: "正常直连结果"}, finish_reason: "stop"}]}));
    return;
  }
  if (url.pathname === "/slow-sse") {
    res.writeHead(200, {"content-type": "text/event-stream"});
    let n = 0, closed = false;
    req.on("close", () => { closed = true; });
    const push = () => {
      if (closed) return;
      res.write(sse({choices: [{delta: {content: "片" + (n++)}}]}));
      setTimeout(push, 120);
    };
    push();
    return;
  }
  if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(assets, relative);
  if (!file.startsWith(assets) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file);
  const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".js" ? "application/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "application/octet-stream";
  res.writeHead(200, {"content-type": type, "cache-control": "no-store"});
  res.end(fs.readFileSync(file));
}

(async () => {
  fs.mkdirSync(evidenceDir, {recursive: true});
  const server = http.createServer(serve);
  await listenOnBrowserSafePort(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, hasTouch: true, isMobile: true});
  const page = await context.newPage();
  await page.route("https://testingcf.jsdelivr.net/**", route => route.fulfill({
    status: 200,
    contentType: route.request().resourceType() === "stylesheet" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8",
    body: "",
  }));
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on("pageerror", error => errors.push(String(error && error.stack || error)));
  await page.goto(`${origin}/index.html`, {waitUntil: "load"});
  await waitForAppReady(page);

  await page.evaluate(originUrl => {
    window.saveData = async () => true;
    window.appConfirm = async () => true;
    window.runAutoMemorySummary = async () => null;
    const provider = typeof activeProviderForSettings === "function" ? activeProviderForSettings(D.settings) : D.settings.providers[0];
    provider.apiUrl = originUrl;
    provider.apiKey = "test-key";
    provider.model = "test-model";
    window.__endpointQueue = [];
    window.__completionRequests = [];
    window.__cardGenerationCallOptions = [];
    const originalCallDeepSeek = window.callDeepSeek;
    window.callDeepSeek = function (messages, target, options) {
      window.__cardGenerationCallOptions.push({
        mode: String(target && target.mode || ""),
        nonStream: !!(options && options.nonStream === true),
        // Card script requests wait for the provider or a stop; no option may set a deadline.
        deadlines: Object.keys(options || {}).filter(key => /timeout|deadline/i.test(key)),
      });
      return originalCallDeepSeek(messages, target, options);
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, requestOptions) => {
      if (String(url).includes("/chat/completions")) {
        const next = window.__endpointQueue.shift();
        window.__completionRequests.push({endpoint: String(next || ""), body: JSON.parse(String(requestOptions && requestOptions.body || "{}"))});
        if (!next) throw new Error("端点队列为空");
        return originalFetch(next, requestOptions);
      }
      return originalFetch(url, requestOptions);
    };
    window.__cardToasts = [];
    const originalToastShow = window.cardFrontendToastShow;
    window.cardFrontendToastShow = function (live, payload) {
      window.__cardToasts.push({message: String(payload && payload.message || ""), level: String(payload && payload.level || "")});
      return originalToastShow(live, payload);
    };
    const char = parseCard({name: "桥三态卡", description: "x", first_mes: "开始。"});
    char.id = "script-generation-bridge";
    ensureCharacterIntelligence(char);
    D.characters = [char];
    D.currentCharId = char.id;
    const session = createBlankSession("bridge", "sess_bridge");
    session.msgs.push({role: "assistant", content: "占位。", time: Date.now(), seq: 1});
    session.nextMessageSeq = 2;
    D.chats[char.id] = {sessions: [session], activeSid: session.id};
    renderChat();
    updateChatUI();
  }, origin);

  async function runScenario(name, endpointPath, shouldStream, scenarioOptions) {
    scenarioOptions = scenarioOptions || {};
    await page.evaluate(({name, endpoint, shouldStream, scenarioOptions}) => {
      window.__endpointQueue = endpoint ? [endpoint] : [];
      const sess = getActiveSession(getChar().id);
      const attempts = Math.max(1, Number(scenarioOptions.attempts) || 1);
      const lastRole = scenarioOptions.lastRole === "assistant" ? "assistant" : "user";
      const prompt = JSON.stringify([{role: lastRole, content: "ping"}]);
      const errorOptions = scenarioOptions.persistError ? ",{timeOut:0,extendedTimeOut:0}" : "";
      const restartButton = scenarioOptions.restart ? "<button id=\"restart-" + name + "\" type=\"button\">重新开始</button>" : "";
      const script = [
        "<div>" + restartButton + "<script>",
        "toastr.clear();",
        scenarioOptions.restart ? "document.getElementById('restart-" + name + "').addEventListener('click',async()=>{try{const text=await generateRaw({ordered_prompts:" + prompt + ",should_stream:false});toastr.success('done:" + name + "-restart:'+String(text).slice(0,24));}catch(e){toastr.error('fail:" + name + "-restart:'+(e.name||'')+':'+String(e.message||'').slice(0,60),'', {timeOut:0,extendedTimeOut:0});}});" : "",
        "(async()=>{",
        "  const loading=toastr.info('loading:" + name + "','',{timeOut:0,extendedTimeOut:0});",
        "  try{",
        "    let lastError=null;",
        "    for(let attempt=1;attempt<=" + attempts + ";attempt++){try{const text=await generateRaw({ordered_prompts:" + prompt + ",should_stream:" + (shouldStream ? "true" : "false") + "});toastr.success('done:" + name + ":'+String(text).slice(0,24));return;}catch(e){lastError=e;}}",
        "    throw lastError;",
        "  }catch(e){",
        "    toastr.error('fail:" + name + ":'+(e.name||'')+':'+String(e.message||'').slice(0,60),''," + (scenarioOptions.persistError ? "{timeOut:0,extendedTimeOut:0}" : "{}") + ");",
        "  }finally{toastr.clear(loading);}",
        "})();",
        "<\/script></div>",
      ].join("\n");
      sess.msgs[0] = {role: "assistant", content: "场景 " + name + "\n\n" + script, time: Date.now(), seq: Number(sess.msgs[0].seq) || 1};
      renderChat();
    }, {name, endpoint: endpointPath ? `${origin}${endpointPath}` : "", shouldStream: !!shouldStream, scenarioOptions});
    await page.waitForFunction(wanted => window.__cardToasts.some(row => row.message.startsWith("loading:" + wanted)), name, {timeout: 30000});
  }

  async function waitOutcome(name, timeoutMs) {
    await page.waitForFunction(wanted => window.__cardToasts.some(row => row.message.startsWith("done:" + wanted) || row.message.startsWith("fail:" + wanted)), name, {timeout: timeoutMs || 45000});
    return page.evaluate(wanted => window.__cardToasts.filter(row => row.message.startsWith("done:" + wanted) || row.message.startsWith("fail:" + wanted)).map(row => row.message), name);
  }

  const results = {};

  await runScenario("ok", "/json-ok", false);
  results.ok = await waitOutcome("ok");
  assert.ok(results.ok.some(row => row.startsWith("done:ok:") && row.includes("正常直连结果")), `直连成功必须解析出正文：${JSON.stringify(results.ok)}`);
  const nonStreamCallOptions = await page.evaluate(() => window.__cardGenerationCallOptions.at(-1));
  assert.deepStrictEqual(nonStreamCallOptions, {mode: "card-frontend", nonStream: true, deadlines: []}, "卡片脚本非流式请求不能附加读取空闲期限");

  // Host stop: model the real shujuku failure retry loop. The first request is aborted and every
  // later generateRaw in this same user-action cycle must be rejected before transport starts.
  await runScenario("stopped", "/slow-sse", true, {attempts: 4, restart: true, persistError: true});
  const stoppedRequestStart = await page.evaluate(() => window.__completionRequests.length);
  await page.waitForFunction(() => typeof _generationState === "string" && (_generationState === "streaming" || _generationState === "preparing"), null, {timeout: 30000});
  const streamCallOptions = await page.evaluate(() => window.__cardGenerationCallOptions.at(-1));
  assert.deepStrictEqual(streamCallOptions, {mode: "card-frontend", nonStream: false, deadlines: []}, "卡片脚本流式请求不得携带读取空闲期限");
  await page.waitForTimeout(400);
  await page.evaluate(() => stopGeneration());
  results.stopped = await waitOutcome("stopped");
  assert.ok(results.stopped.some(row => row.startsWith("fail:stopped:AbortError:")), `宿主停止必须让脚本收到 AbortError：${JSON.stringify(results.stopped)}`);
  await page.waitForFunction(() => _generationState === "idle", null, {timeout: 30000});
  assert.strictEqual(await page.evaluate(() => window.__completionRequests.length), stoppedRequestStart, "同一脚本运行周期的失败重试不得再次进入传输层");

  // A trusted next user action starts a new cycle without recreating this iframe.
  await page.evaluate(next => { window.__endpointQueue = [next]; }, `${origin}/json-ok`);
  let restartFrame = null;
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame() && await frame.locator("#restart-stopped").count()) { restartFrame = frame; break; }
  }
  assert.ok(restartFrame, "停止复现 iframe 必须仍在原位");
  // The previous error has been asserted; clear its persistent notification before
  // the next physical click so an overlay cannot intercept the iframe button.
  await restartFrame.evaluate(() => toastr.clear());
  await page.waitForFunction(() => !document.querySelector('#toasts .toast:not(.card-frontend-toast)'));
  await restartFrame.locator("#restart-stopped").click();
  results.stoppedRestart = await waitOutcome("stopped-restart");
  assert.ok(results.stoppedRestart.some(row => row.includes("正常直连结果")), `下一次用户动作必须能启动新周期：${JSON.stringify(results.stoppedRestart)}`);

  // Script side stop: the sandbox-facing stopGeneration bridge call may only abort the
  // generation this frame started, and settles it with the same AbortError shape.
  await runScenario("scriptstop", "/slow-sse", true);
  await page.waitForFunction(() => typeof _generationState === "string" && (_generationState === "streaming" || _generationState === "preparing"), null, {timeout: 30000});
  await page.waitForTimeout(400);
  const scriptStopAccepted = await page.evaluate(() => {
    const generation = typeof _cardFrontendGenerations === "object" && _cardFrontendGenerations instanceof Map && Array.from(_cardFrontendGenerations.values())[0];
    if (!generation || !generation.live) return "no-generation";
    return cardFrontendCall(generation.live, "stopGeneration", null);
  });
  assert.strictEqual(scriptStopAccepted, true, `脚本侧停止调用必须中止本脚本发起的生成：${JSON.stringify(scriptStopAccepted)}`);
  results.scriptstop = await waitOutcome("scriptstop");
  assert.ok(results.scriptstop.some(row => row.startsWith("fail:scriptstop:AbortError:")), `脚本侧停止必须以 AbortError 收尾：${JSON.stringify(results.scriptstop)}`);
  await page.waitForFunction(() => _generationState === "idle", null, {timeout: 30000});

  // Every scenario cleared its own loading toast, so no persistent script toast may remain.
  await page.waitForFunction(() => !document.querySelector("#toasts .card-frontend-toast[data-yeyu-toast-id]") || Array.from(document.querySelectorAll("#toasts .card-frontend-toast")).every(node => node.classList.contains("is-leaving")), null, {timeout: 15000});

  const evidence = {origin, results, requests: await page.evaluate(() => window.__completionRequests), toasts: await page.evaluate(() => window.__cardToasts)};
  fs.writeFileSync(path.join(evidenceDir, "bridge-tristate.json"), JSON.stringify(evidence, null, 2));
  assert.deepStrictEqual(errors, [], "页面错误必须为 0");
  await browser.close();
  server.close();
})().catch(error => { console.error(String(error && error.stack || error)); process.exit(1); });
