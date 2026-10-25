'use strict';

// Optional android-smoke extension. All lifecycle events go through the emulator and the shipped
// Activity/WebView; no bridge or application function is replaced. Data is synthetic and disposable.
const assert = require('assert');
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function probeNativeLifecycle({client, connect, pageTarget, adbPath, serial}) {
  assert.match(serial || '', /^emulator-\d+$/, 'Native lifecycle probe requires an emulator');
  const connections = [];
  const steps = [];
  const appReadyExpression = "typeof D==='object'&&D!==null&&typeof _streamDraftsLoaded!=='undefined'&&_streamDraftsLoaded===true";
  let stage = 'initial readiness';
  const fixtureName = 'yeyu-native-probe.txt';
  const localFixture = path.resolve(__dirname, '../../.tmp/android-emulator-smoke', fixtureName);
  const remoteFixture = '/sdcard/Download/' + fixtureName;
  const remoteHierarchy = '/sdcard/yeyu-native-probe-ui.xml';
  const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], {encoding:'utf8', timeout:20000, stdio:'pipe'});
  const evaluate = async (expression) => {
    const result = await client.call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true, userGesture:false});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (label, predicate, timeout = 20000) => {
    stage = label;
    fs.writeFileSync(path.resolve(__dirname, '../../.tmp/android-emulator-smoke/native-lifecycle-steps.json'), JSON.stringify({stage, steps}));
    const deadline = Date.now() + timeout;
    while (!(await predicate())) {
      if (Date.now() >= deadline) throw new Error('Native platform timeout: ' + label);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    steps.push(label);
  };
  const ready = () => wait('application ready', () => evaluate(appReadyExpression));
  const focusedActivity = () => {
    const match = adb('shell', 'dumpsys', 'activity', 'activities').match(/^\s*topResumedActivity=(.+)$/m);
    return match ? match[1] : '';
  };
  const resume = async () => {
    adb('shell', 'am', 'start', '-W', '-n', 'com.yeyu.app/.MainActivity');
    await wait('application foreground', () => focusedActivity().includes('com.yeyu.app/.MainActivity'));
  };
  const touch = async (selector) => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await client.call('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[point]});
    await new Promise(resolve => setTimeout(resolve, 50));
    await client.call('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    // Separate taps so Android does not interpret repeated same-coordinate input as a double tap.
    await new Promise(resolve => setTimeout(resolve, 350));
  };
  const hierarchy = () => {
    adb('shell', 'uiautomator', 'dump', remoteHierarchy);
    return adb('shell', 'cat', remoteHierarchy);
  };
  const tapNode = (xml, predicate) => {
    const node = [...xml.matchAll(/<node\b[^>]*>/g)].map(match => match[0]).find(predicate);
    assert(node, 'Missing Android UI node during ' + stage);
    const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    assert(bounds, 'Missing UI bounds');
    adb('shell', 'input', 'tap', String((Number(bounds[1]) + Number(bounds[3])) / 2), String((Number(bounds[2]) + Number(bounds[4])) / 2));
  };
  const pickerFocused = () => /documentsui/i.test(focusedActivity());
  const reconnect = async () => {
    await wait('renderer restored', async () => {
      try {
        const target = await pageTarget();
        const fresh = await connect(target.webSocketDebuggerUrl);
        connections.push(fresh);
        const result = await fresh.call('Runtime.evaluate', {expression:appReadyExpression, returnByValue:true});
        if (result.result?.value !== true) { fresh.close(); return false; }
        client = fresh;
        return true;
      } catch { return false; }
    });
    assert.deepStrictEqual(await evaluate('Object.keys(AndroidBridge).sort()'), [
      'cancelCardImage', 'fetchCardImage', 'hapticLongPress', 'onWebViewPauseReady',
      'saveFile', 'setCardFrontendFullscreenMode', 'setSystemBars'
    ], 'Restored WebView must expose exactly the existing bridge');
  };
  const crash = () => {
    // Page.crash kills the renderer and invokes onRenderProcessGone; CDP necessarily disconnects.
    client.call('Page.crash').catch(() => {});
  };
  try {
    await ready();
    await client.call('Page.enable');
    await client.call('Page.addScriptToEvaluateOnNewDocument', {source:
      'document.addEventListener("DOMContentLoaded",()=>{window.__nativeBridgeAtDocumentReady=!!window.AndroidBridge&&typeof AndroidBridge.saveFile==="function";},{once:true});'});
    await evaluate(`(()=>{document.querySelector('#native-nav')?.remove();const a=document.createElement('a'),url=new URL(location.href);a.id='native-nav';url.searchParams.set('nativeProbe',Date.now().toString(36));url.hash='native-probe';a.href=url.href;a.textContent='probe';a.style.cssText='position:fixed;left:10px;top:100px;width:180px;height:50px;z-index:2147483647';document.body.appendChild(a);})()`);
    await touch('#native-nav');
    await wait('internal navigation', () => evaluate('location.hash==="#native-probe"&&window.__nativeBridgeAtDocumentReady===true').catch(() => false));
    await ready();
    const originalUrl = await evaluate('location.href');
    await evaluate(`(()=>{const a=document.createElement('a');a.id='native-nav';a.style.cssText='position:fixed;left:10px;top:100px;width:180px;height:50px;z-index:2147483647';a.textContent='probe';document.body.appendChild(a);})()`);
    for (const url of ['file:///android_asset/other.html', 'content://media/external/file/1', 'yeyu-probe://blocked']) {
      stage = 'blocked navigation';
      await evaluate(`document.querySelector('#native-nav').href=${JSON.stringify(url)}`);
      await touch('#native-nav');
      // Round-trip the native UI queue before checking the page remained internal.
      adb('shell', 'dumpsys', 'activity', 'activities');
      assert.strictEqual(await evaluate('location.href'), originalUrl, 'Non-SPA local/custom navigation escaped');
    }
    steps.push('local/custom navigation blocked');
    await evaluate("document.querySelector('#native-nav').href='https://example.com/'");
    await touch('#native-nav');
    await wait('external navigation', () => focusedActivity().includes('com.android.chrome/'));
    assert.strictEqual(await evaluate('location.href'), originalUrl, 'External navigation replaced the bundled page');
    await resume();
    await ready();
    await evaluate(`(()=>{document.querySelector('#native-nav').remove();const input=document.createElement('input');input.id='native-input';input.style.cssText='position:fixed;left:10px;top:100px;width:180px;height:50px;z-index:2147483647';document.body.appendChild(input);})()`);
    await touch('#native-input');
    await wait('IME visible', () => evaluate('_nativeImeState.visible&&_nativeImeState.imeBottomPx>0&&_nativeImeState.currentViewHeightPx>0'));
    adb('shell', 'input', 'keyevent', '4');
    await wait('IME hidden', () => evaluate('!_nativeImeState.visible&&_nativeImeState.imeBottomPx===0'));
    await evaluate('document.querySelector("#native-input").remove()');

    stage = 'file chooser';
    fs.writeFileSync(localFixture, 'native-file-roundtrip', 'utf8');
    adb('push', localFixture, remoteFixture);
    await evaluate(`(()=>{window.__nativeFiles={cancels:0,text:''};for(const id of ['native-file-a','native-file-b']){const input=document.createElement('input');input.id=id;input.type='file';input.accept='text/plain';input.style.cssText='position:fixed;left:10px;top:'+(id.endsWith('a')?100:180)+'px;width:180px;height:50px;z-index:2147483647';input.addEventListener('cancel',()=>__nativeFiles.cancels++);input.addEventListener('change',async()=>{__nativeFiles.text=await input.files[0].text()});document.body.appendChild(input);}})()`);
    await touch('#native-file-a');
    await wait('system file picker opened', pickerFocused);
    adb('shell', 'input', 'keyevent', '4');
    await resume();
    await wait('first file callback cancelled', () => evaluate('__nativeFiles.cancels===1'));
    await touch('#native-file-b');
    await wait('second file picker opened', pickerFocused);
    adb('shell', 'input', 'keyevent', '4');
    await resume();
    await wait('second file callback cancelled', () => evaluate('__nativeFiles.cancels===2'));
    await touch('#native-file-a');
    await wait('file picker for selection', pickerFocused);
    stage = 'select synthetic file';
    let xml = hierarchy();
    if (!xml.includes('text="' + fixtureName + '"')) {
      tapNode(xml, node => /content-desc="(?:Show roots|显示根目录)"/.test(node));
      xml = hierarchy();
      tapNode(xml, node => /text="(?:Downloads|下载)"/.test(node));
      xml = hierarchy();
    }
    tapNode(xml, node => node.includes('text="' + fixtureName + '"'));
    await wait('selected file bytes returned', () => evaluate('__nativeFiles.text==="native-file-roundtrip"'));
    await evaluate('openModal("import-modal")');
    assert.strictEqual(await evaluate('document.querySelector("#import-modal").classList.contains("open")'), true);
    adb('shell', 'input', 'keyevent', '4');
    await wait('native back closes modal', () => evaluate('!document.querySelector("#import-modal").classList.contains("open")'));
    await evaluate(`(async()=>{window.__nativeTimerTicks=0;setInterval(()=>__nativeTimerTicks++,100);await saveData()})()`);
    await wait('foreground timer advances', () => evaluate('__nativeTimerTicks>=3'));
    stage = 'idle background timers paused';
    adb('shell', 'input', 'keyevent', '3');
    await new Promise(resolve => setTimeout(resolve, 1000));
    const pausedTicks = await evaluate('__nativeTimerTicks');
    // A fresh hidden page may wake timers only once per second. Span multiple wakeups so mere
    // Chromium throttling cannot satisfy the native pause assertion (also checked by an APK mutation).
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.strictEqual(await evaluate('__nativeTimerTicks'), pausedTicks, 'Persisted idle WebView timers must pause in background');
    steps.push('idle background timers paused');
    await resume();
    const ticks = await evaluate('__nativeTimerTicks');
    await wait('timers resume after background persistence', () => evaluate('__nativeTimerTicks>' + ticks));

    // A pending system picker must not keep a callback into a WebView whose renderer is gone.
    await touch('#native-file-b');
    await wait('file picker before renderer crash', pickerFocused);
    crash();
    await reconnect();
    adb('shell', 'input', 'keyevent', '4');
    await resume();
    await evaluate(`(()=>{const input=document.createElement('input');input.id='native-ime-restored';input.style.cssText='position:fixed;left:10px;top:100px;width:180px;height:50px;z-index:2147483647';document.body.appendChild(input);})()`);
    await touch('#native-ime-restored');
    await wait('IME on restored WebView', () => evaluate('_nativeImeState.visible&&_nativeImeState.imeBottomPx>0&&_nativeImeState.baselineViewHeightPx>0'));
    adb('shell', 'input', 'keyevent', '4');
    await wait('restored IME hidden', () => evaluate('!_nativeImeState.visible'));
    crash();
    await reconnect();
    crash();
    await wait('third renderer crash stops recovery', () => hierarchy().includes('网页组件连续崩溃，已停止自动重启'));
    stage = 'manual renderer reload';
    tapNode(hierarchy(), node => node.includes('text="重新加载"'));
    await reconnect();
    const stored = await evaluate('D.characters.some(char=>char.id==="risu-platform-probe")');
    assert.strictEqual(stored, true, 'Renderer recovery lost persisted synthetic application data');
    return {ok:true, steps, bridgeAtDocumentReady:true, bridgeAfterRecovery:true, persistedData:true,
      environment:'API 35 emulator; real Activity/WebView; cached-app freezer disabled for CDP observation; synthetic files and card; no model'};
  } catch (error) {
    const page = await evaluate(`({url:location.href,bridgeAtDocumentReady:window.__nativeBridgeAtDocumentReady,bridgePresent:!!window.AndroidBridge,
      navPresent:!!document.querySelector('#native-nav'),ime:typeof _nativeImeState==='object'?_nativeImeState:null})`).catch(() => null);
    throw new Error(JSON.stringify({stage, steps, page, error:String(error.stack || error)}));
  } finally {
    for (const connection of connections) connection.close();
    adb('shell', 'rm', '-f', remoteFixture, remoteHierarchy);
  }
};
