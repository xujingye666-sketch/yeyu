'use strict';
const {createAssetServer,listenOnBrowserSafePort,loadPlaywright,resolveEdgeExecutable}=require('./source');
const {waitForAppReady}=require('./helpers/app-ready');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'../..');
const java=fs.readFileSync(path.join(root,'app/src/main/java/com/yeyu/app/MainActivity.java'),'utf8');
const pureCtx={};vm.createContext(pureCtx);vm.runInContext(fs.readFileSync(path.join(root,'app/src/main/assets/js/core/pure.js'),'utf8'),pureCtx);const pure=pureCtx.YeyuPure;

const hostile="x');alert(1)//";
const inlined=pure.inlineJsArg(hostile);
assert.ok(!inlined.includes('"')&&!inlined.includes("'")&&!inlined.includes('<'),'内联 JS 参数不得包含未转义引号或标签');
assert.strictEqual(pure.escapeHtmlAttr('a"b\'c<d>'),'a&quot;b&#39;c&lt;d&gt;');
assert.strictEqual(pure.safeImageSource('https://evil.example/x.png',false),'','远程图片地址必须被白名单拒绝');
assert.strictEqual(pure.safeImageSource('javascript:alert(1)',false),'');
assert.strictEqual(pure.safeImageSource('data:image/png;base64,QQ==',false),'data:image/png;base64,QQ==');
assert.strictEqual(pure.safeImageSource('blob:https://x/y',false),'','未授权时 blob 图片必须被拒绝');
assert.strictEqual(pure.safeImageSource('blob:https://x/y',true),'blob:https://x/y');

assert.deepStrictEqual(JSON.parse(JSON.stringify(pure.parseSSEBuffer('data: notjson\n\n').events)),[{invalid:'notjson'}],'非法 JSON 不得中断流解析');

assert.match(java,/MediaStore\.MediaColumns\.IS_PENDING\s*,\s*1/,'MediaStore 写入必须先标记 pending');
assert.match(java,/getContentResolver\(\)\s*\.delete\(\s*uri\s*,\s*null\s*,\s*null\s*\)/,'MediaStore 失败必须删除空记录');
assert.ok(java.includes('value.matches("[a-zA-Z0-9_\\\\-\\\\u4e00-\\\\u9fff]+")'),'目录必须使用严格白名单，字符类不得扩宽');
assert.match(java,/"\."\.equals\(\s*value\s*\)\s*\|\|\s*"\.\."\.equals\(\s*value\s*\)/,'目录必须拒绝点路径');

(async()=>{
  const server=createAssetServer(path.join(root,'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  const browser=await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  try {
    const page=await browser.newPage(), errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await waitForAppReady(page);
    const result=await page.evaluate(()=>{
      const value=`x');window.__injected=1;//"<img src=x onerror="window.__injected=2">`, calls={};
      window.__injected=0;
      const char={id:value,name:value,tags:[value],description:value,avatar_image:'javascript:window.__injected=3',extensions:{}};
      const session=createBlankSession(value,value);
      D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};
      window.selectCharacter=id=>{calls.character=id;};window.switchSession=id=>{calls.session=id;};window.toggleWBCategory=id=>{calls.worldbook=id;};
      renderCharList();
      const charName=$('char-list').querySelector('.cname').textContent;
      const noInjectedImage=$('char-list').querySelectorAll('img').length===0;
      $('char-list').querySelector('.char-item').click();
      $('char-list').querySelector('.tag-chip').click();
      calls.tag=$('char-search').value;
      _sessionManagerOpen=true;renderSessionManager();
      $('session-manager-list').querySelector('.session-manager-main').click();
      D.worldBook.categories=[{id:value,name:value,entries:[],boundCharIds:[]}];
      renderWBAll();
      const toggle=$('wb-cat-list').querySelector('[data-wb-action="toggle"]');
      const attributePreserved=toggle.dataset.catId===value;
      toggle.click();
      return {forwarded:Object.values(calls).length===4&&Object.values(calls).every(x=>x===value),charName:charName===value,noInjectedImage,attributePreserved,injected:window.__injected};
    });
    assert.deepStrictEqual(result,{forwarded:true,charName:true,noInjectedImage:true,attributePreserved:true,injected:0});
    const remotePosts=[];
    await page.route('https://example.invalid/rich-form-post',route=>{
      remotePosts.push(route.request().method());
      return route.fulfill({status:200,contentType:'text/html',body:'blocked test request'});
    });
    const appUrl=page.url();
    const forms=await page.evaluate(()=>{
      const host=document.createElement('div');
      host.id='rich-form-test';
      host.style.cssText='position:fixed;top:80px;left:10px;z-index:2147483647;background:white';
      host.innerHTML=md('<form action="/index.html?richFormReload=1" method="get" target="_top"><button type="submit">reload</button></form><form action="https://example.invalid/rich-form-post" method="post" target="_top"><button type="submit" formmethod="post">post</button></form>',{role:'assistant',safeMarkup:true});
      document.body.appendChild(host);
      window.__richButtonClicks=0;
      window.__richSubmitEvents=0;
      host.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>window.__richButtonClicks++));
      host.querySelectorAll('form').forEach(form=>form.addEventListener('submit',()=>window.__richSubmitEvents++));
      return {forms:host.querySelectorAll('form').length,buttons:host.querySelectorAll('button').length,methods:Array.from(host.querySelectorAll('form'),form=>form.method),override:!!host.querySelector('[formmethod]')};
    });
    assert.deepStrictEqual(forms,{forms:2,buttons:2,methods:['dialog','dialog'],override:false},'普通消息保留表单和按钮，但提交方法必须无导航');
    await page.locator('#rich-form-test button').first().click();
    assert.strictEqual(page.url(),appUrl,'富文本表单不得重载应用顶层页面');
    await page.locator('#rich-form-test button').nth(1).click();
    assert.strictEqual(page.url(),appUrl,'富文本表单不得导航到远程页面');
    assert.deepStrictEqual(remotePosts,[],'富文本表单不得发出远程 POST');
    assert.deepStrictEqual(await page.evaluate(()=>{
      const counts=[window.__richButtonClicks,window.__richSubmitEvents];
      document.querySelector('#rich-form-test').remove();
      return counts;
    }),[2,2],'原有按钮和 submit 监听器仍应触发');
    const directMethod=await page.evaluate(()=>{
      const host=document.createElement('div');
      host.id='rich-direct-submit-test';
      host.innerHTML=md('<form action="https://example.invalid/rich-form-post"><button>direct</button></form>',{role:'assistant',safeMarkup:true});
      document.body.appendChild(host);
      setTimeout(()=>host.querySelector('form').submit(),0);
      return host.querySelector('form').method;
    });
    assert.strictEqual(directMethod,'dialog');
    await page.waitForTimeout(100);
    assert.strictEqual(page.url(),appUrl,'form.submit() 绕过 submit 事件时也不得导航');
    assert.deepStrictEqual(remotePosts,[],'form.submit() 不得发出远程请求');
    await page.evaluate(()=>document.querySelector('#rich-direct-submit-test').remove());
    const richCss=await page.evaluate(()=>{
      const source='<style>.css-probe{content:"\\3c /style\\3e \\3c img src=x onerror=window.__richStyleInjected=1\\3e"}</style><span class="css-probe" style="content:\'\\3c /style\\3e\'">probe</span>';
      const prepared=RichDisplay.prepare(source);
      const style=prepared.fragment.querySelector('style[data-yeyu-rich-style]');
      const inline=prepared.fragment.querySelector('span');
      const html=md(source,{role:'assistant',safeMarkup:true});
      const host=document.createElement('div');
      window.__richStyleInjected=0;
      host.innerHTML=html;
      document.body.appendChild(host);
      const state={styleText:style&&style.textContent,inlineStyle:inline&&inline.getAttribute('style'),inlineValue:inline&&inline.style.getPropertyValue('content'),injected:window.__richStyleInjected,escapedImage:!!host.querySelector('img')};
      host.remove();
      return state;
    });
    assert.ok(richCss.styleText&&!richCss.styleText.includes('<'),'CSSOM 重写后的 style 文本不得重新包含标签起始符');
    assert.ok(richCss.inlineStyle&&!richCss.inlineStyle.includes('<'),'CSSOM 重写后的行内 style 不得重新包含标签起始符');
    assert.ok(richCss.inlineValue.includes('</style>'),'CSS 转义后仍应保留样式原本的显示值');
    assert.strictEqual(richCss.escapedImage,false,'重新拼接的富文本不得形成可执行 HTML');
    assert.strictEqual(richCss.injected,0);
    assert.deepStrictEqual(errors,[]);
    console.log(JSON.stringify({renderedArgumentRoundtrip:true,sseParser:true,nativeStructureChecked:true}));
  } finally {
    await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
