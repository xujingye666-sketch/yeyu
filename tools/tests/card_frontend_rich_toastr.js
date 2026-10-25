/* global __clicked, __inline, __richSource, __scriptRan, __shown, __urlRan -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';
// Script toast direct host surface: rich rendering, four levels, title/options, callbacks,
// timeout/clear lifecycles, media release, and unchanged host-only toasts.
const assert=require('assert'),path=require('path');
const {createAssetServer,loadPlaywright,listenOnBrowserSafePort,resolveEdgeExecutable}=require('./source');
const {waitForAppReady}=require('./helpers/app-ready');
const root=path.resolve(__dirname,'../..'),assets=path.join(root,'app/src/main/assets');

(async()=>{
  const server=createAssetServer(assets),port=await listenOnBrowserSafePort(server),origin=`http://127.0.0.1:${port}`;
  const browser=await loadPlaywright().chromium.launch({headless:true,executablePath:resolveEdgeExecutable()});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});await context.route('https://testingcf.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:route.request().resourceType()==='stylesheet'?'text/css; charset=utf-8':'application/javascript; charset=utf-8',body:''}));const page=await context.newPage();page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',error=>errors.push(String(error&&error.stack||error)));
  try{
    await page.goto(`${origin}/index.html`,{waitUntil:'load'});await waitForAppReady(page);
    await page.evaluate(()=>{
      const content=['```html','<body><div id="toast-ready">toast ready</div></body>','```'].join('\n');
      const char=parseCard({name:'斗破苍穹',first_mes:content});char.id='rich-toastr';char.scriptsEnabled=true;char.extensions={yeyu:{componentImportMode:'full'}};
      const session=createBlankSession('通知测试','rich-toastr-session');session.msgs=[{role:'assistant',content,seq:1,opening:true}];session.nextMessageSeq=2;
      D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};
      renderChat();updateChatUI();setSidebarOpen(false);
    });
    const frameElement=await page.waitForSelector('.yeyu-card-frontend-frame',{state:'attached'}),frame=await frameElement.contentFrame();assert(frame,'未创建通知测试子页');await frame.waitForSelector('#toast-ready');
    await page.evaluate(()=>toast('宿主纯文本提示','ok'));
    const hostToast=page.locator('#toasts>.toast.ok:not(.card-frontend-toast)').filter({hasText:'宿主纯文本提示'});
    assert.strictEqual(await hostToast.count(),1,'宿主自身 toast 必须保持旧通道与旧样式');
    await hostToast.waitFor({state:'detached'});

    await frame.evaluate(()=>{toastr.info('信息','',{timeOut:0});toastr.success('成功','',{timeOut:0});toastr.warning('警告','',{timeOut:0});toastr.error('错误','',{timeOut:0});});
    await page.waitForFunction(()=>document.querySelectorAll('.card-frontend-toast').length===4);
    const levels=await page.locator('.card-frontend-toast').evaluateAll(nodes=>nodes.map(node=>/level-(info|success|warning|error)/.exec(node.className)[1]));
    assert.deepStrictEqual(levels,['info','success','warning','error']);
    await frame.evaluate(()=>toastr.clear());await page.waitForFunction(()=>document.querySelectorAll('.card-frontend-toast').length===0);

    const directHandleState=await frame.evaluate(()=>{const handle=toastr.info('<button id="direct-probe-button">直接按钮</button>','',{timeOut:0}),root=handle[0],state={ownerIsParent:root.ownerDocument===parent.document.defaultView.document,bodyDisplay:getComputedStyle(document.body).display,buttons:root.querySelectorAll('button').length};toastr.clear(handle);return state;});
    assert.deepStrictEqual(directHandleState,{ownerIsParent:true,bodyDisplay:'block',buttons:1},'toastr 句柄必须直接指向宿主可见通知，不得创建子页回调镜像');
    const richSource='<div class="acu-progress"><strong>自动更新 2/4</strong><div style="height:8px;background:#29364a"><span style="display:block;width:50%;height:8px;background:#60a5fa"></span></div><button id="acu-stop-update-btn" style="margin-top:10px;border:1px solid #ffc107;color:#ffc107;background:transparent;padding:6px 12px;border-radius:6px" onclick="window.__inline=(window.__inline||0)+1">终止</button><script>window.__scriptRan=1<\/script><a style="display:none" href="javascript:window.__urlRan=1">危险链接</a></div>';
    await frame.evaluate(source=>{
      window.__richSource=source;window.__shown=0;window.__clicked=0;window.__inline=0;window.__scriptRan=0;window.__urlRan=0;let handle=null;
      handle=toastr.info(source,'数据库自动更新',{timeOut:0,extendedTimeOut:0,closeButton:true,progressBar:false,tapToDismiss:false,onShown:function(){window.__shown++;this.find('.card-frontend-toast-message button').off('click.richToast').on('click.richToast',function(event){event.preventDefault();event.stopPropagation();window.__clicked++;handle.remove();});}});
    },richSource);
    const rich=page.locator('.card-frontend-toast').filter({hasText:'自动更新 2/4'});await rich.waitFor();
    assert.strictEqual(await rich.locator('.card-frontend-toast-title').textContent(),'数据库自动更新');
    assert.strictEqual(await rich.locator('.card-frontend-toast-message button').count(),1,'净化后应保留可见按钮交互');
    assert.strictEqual(await rich.locator('script').count(),0);assert.strictEqual(await rich.locator('[onclick],[onmouseover],[onerror]').count(),0);assert.strictEqual(await rich.locator('a').getAttribute('href'),null);
    assert((await rich.locator('span').nth(0).boundingBox()).width>0,'进度条结构必须实际参与布局');
    const namespaced=await rich.locator('.card-frontend-toast-message>div').getAttribute('class');assert(!String(namespaced||'').split(/\s+/).includes('acu-progress'),'宿主显示副本的类名必须隔离');
    const safeState=await frame.evaluate(()=>({shown:__shown,source:__richSource,inline:__inline,script:__scriptRan,url:__urlRan}));assert.strictEqual(safeState.source,richSource,'显示副本不得改写脚本持有的通知正文');delete safeState.source;assert.deepStrictEqual(safeState,{shown:1,inline:0,script:0,url:0});
    await rich.locator('.card-frontend-toast-message button').click();await page.waitForFunction(()=>document.querySelectorAll('.card-frontend-toast').length===0);
    assert.deepStrictEqual(await frame.evaluate(()=>({clicked:__clicked,inline:__inline,script:__scriptRan,url:__urlRan})),{clicked:1,inline:0,script:0,url:0});

    await frame.evaluate(()=>toastr.warning('自定义时长','时长测试',{timeOut:80,extendedTimeOut:25,progressBar:true}));
    const timed=page.locator('.card-frontend-toast').filter({hasText:'自定义时长'});await timed.waitFor();assert.strictEqual(await timed.locator('.card-frontend-toast-progress').count(),1);await page.waitForTimeout(130);assert(await timed.evaluate(node=>node.classList.contains('is-leaving')),'timeOut 到期后通知应进入移除生命周期');await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.card-frontend-toast')).some(node=>node.textContent.includes('自定义时长')));

    const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await frame.evaluate(src=>{window.__mediaToast=toastr.info(`<img alt="资源释放" src="${src}">`,'',{timeOut:0});},pixel);
    const mediaToast=page.locator('.card-frontend-toast').filter({has:page.locator('img[alt="资源释放"]')});await mediaToast.waitFor();await frame.evaluate(()=>toastr.clear(window.__mediaToast));await page.waitForFunction(()=>{const node=Array.from(document.querySelectorAll('.card-frontend-toast.is-leaving')).find(row=>row.textContent.includes('')&&row.querySelector('img[alt="资源释放"]'));return node&&!node.querySelector('img').hasAttribute('src');});await page.waitForFunction(()=>!document.querySelector('img[alt="资源释放"]'));

    assert.deepStrictEqual(errors,[],errors.join('\n'));
    console.log(JSON.stringify({stage:'card-frontend-rich-toastr',viewport:'390x844',levels:['info','success','warning','error'],directHostHandle:true,title:true,richProgress:true,buttonCallback:true,inlineEventsBlocked:true,javascriptUrlBlocked:true,customTimeout:true,mediaReleased:true,hostToastUnchanged:true}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error&&error.stack||error);process.exit(1)});
