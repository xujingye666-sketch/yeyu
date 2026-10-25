'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const oracle = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/audio_host_oracle.json'), 'utf8'));
let browser;
let server;

const jqueryStub = `
(function(){
  function J(selector,context){
    if(!(this instanceof J))return new J(selector,context);
    var root=context&&context.querySelectorAll?context:document,rows=[];
    if(typeof selector==='string'&&selector.trim().charAt(0)==='<'){var template=document.createElement('template');template.innerHTML=selector;rows=Array.from(template.content.children);}
    else if(typeof selector==='string')rows=Array.from(root.querySelectorAll(selector));
    else if(selector&&selector.nodeType)rows=[selector];
    else if(selector&&typeof selector.length==='number')rows=Array.from(selector);
    rows.forEach((row,index)=>this[index]=row);this.length=rows.length;
  }
  J.fn=J.prototype={jquery:'3.7.1',each:function(fn){for(var i=0;i<this.length;i++)fn.call(this[i],i,this[i]);return this;},append:function(value){return this.each(function(){if(value&&value.nodeType)this.appendChild(value);});},prepend:function(value){return this.each(function(){if(value&&value.nodeType)this.prepend(value);});},before:function(value){return this.each(function(){if(value&&value.nodeType)this.before(value);});},after:function(value){return this.each(function(){if(value&&value.nodeType)this.after(value);});},html:function(value){if(value===undefined)return this[0]&&this[0].innerHTML;return this.each(function(){this.innerHTML=String(value);});}};
  window.$=window.jQuery=J;
})();`;

(async () => {
  server = createAssetServer(assetsRoot);
  const port = await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  await context.route('https://testingcf.jsdelivr.net/**', route => route.fulfill({status: 200, contentType: route.request().resourceType() === 'stylesheet' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8', body: route.request().url().includes('showdown') ? 'window.showdown={Converter:function(){}};' : ''}));
  await context.route('https://code.jquery.com/jquery-3.7.1.min.js', route => route.fulfill({status: 200, contentType: 'application/javascript; charset=utf-8', body: jqueryStub}));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'load'});
  await waitForAppReady(page);

  await page.evaluate(() => {
    D = defaults();
    D.settings.useMemory = false;
    D.settings.tavernHelperExtensionSettings = {};
    const char = parseCard({name: 'Audio Host', first_mes: 'opening'});
    char.id = 'audio-host-audio-char';
    char.avatar_image = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="purple"/></svg>';
    char.scriptsEnabled = true;
    char.extensions = {world: 'Audio Host Worldbook', yeyu: {componentImportMode: 'full'}, tavern_helper: {scripts: [{type: 'script', enabled: true, name: 'Audio Contract', id: 'audio-host-audio-script', content: 'window.__audioHostScriptIdAtLoad=getScriptId();window.__audioHostIframeNameAtLoad=getIframeName();window.__audioHostAudioReady=true;', data: {}}]}};
    const session = createBlankSession('Audio Host Session', 'audio-host-audio-session');
    session.msgs = [{role: 'assistant', content: 'opening', seq: 1}];
    const persona = {id: 'audio-host-persona', name: 'Audio Host User', avatar_image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="teal"/></svg>', boundCharIds: [char.id]};
    D.worldBook = {scan_depth: 20, token_budget: 0, recursive: false, categories: [{id: 'audio-host-worldbook', name: 'Audio Host Worldbook', boundCharIds: [char.id], entries: [normalizeWBEntry({id: 'output-format', comment: '[mvu_update]变量输出格式强调', content: '<UpdateVariable> required', disable: true})]}], globalCategoryIds: [], activeCategoryId: 'audio-host-worldbook'};
    D.characters = [char]; D.currentCharId = char.id; D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}}; D.personas = [persona]; D.activePersonaId = persona.id;
    window.__audioHostAudioSaves = [];
    saveData = function(sections) { (Array.isArray(sections) ? sections : [sections]).forEach(section => window.__audioHostAudioSaves.push(String(section))); return Promise.resolve(); };
    updateChatUI();
    syncCardScriptLibrary(char);
  });
  await page.waitForFunction(() => _cardScriptLibraryLive && _cardScriptLibraryLive.state === 'ready' && _cardScriptLibraryLive.frame.contentWindow.__audioHostAudioReady === true);
  await page.evaluate(() => {
    const char = getChar(), session = getActiveSession(char.id), key = 'audio-host-audio-message-frame', node = document.createElement('div');
    node.className = 'yeyu-card-frontend'; node.setAttribute('data-frontend-key', key);
    node.innerHTML = '<div class="yeyu-card-frontend-slot"></div><div class="yeyu-card-frontend-note"></div>';
    document.getElementById('chat-messages').appendChild(node);
    _cardFrontendSource.set(key, {html: '<script>window.__audioHostMessageReady=true;<\/script>', owner: {charId: char.id, sessionId: session.id, messageIndex: 0}});
    cardFrontendMount(char, node, key);
    window.__audioHostMessageNode = node;
  });
  await page.waitForFunction(() => { const live = _cardFrontendLive.get('audio-host-audio-message-frame'); return live && live.frame.contentWindow.__audioHostMessageReady === true; });

  const result = await page.evaluate(async oracleValue => {
    const live = _cardScriptLibraryLive;
    const frame = live.frame.contentWindow;
    const messageLive = _cardFrontendLive.get('audio-host-audio-message-frame');
    const messageFrame = messageLive.frame.contentWindow;
    const helper = frame.TavernHelper;
    const missingAudio = oracleValue.audioPublicNames.filter(name => typeof frame[name] !== 'function' || typeof helper[name] !== 'function');
    const missingEvents = oracleValue.eventPublicNames.filter(name => typeof frame[name] !== 'function' || typeof helper[name] !== 'function');
    const missingRemaining = oracleValue.remainingPublicNames.filter(name => typeof frame[name] !== 'function' && typeof helper[name] !== 'function');

    const parentEvent = 'audio-host-daoyuan-parent-' + Math.random().toString(36).slice(2);
    const parentResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Daoyuan parent runtime call timed out')), 5000);
      document.addEventListener(parentEvent, event => { clearTimeout(timeout); resolve(event.detail); }, {once: true});
      const script = frame.parent.document.createElement('script');
      script.textContent = `(async()=>{try{const names=await TavernHelper.getWorldbookNames();const charBooks=await TavernHelper.getCharWorldbookNames('current');const rows=await TavernHelper.getWorldbook('Audio Host Worldbook');const emphasis=rows.find(row=>row.name==='[mvu_update]变量输出格式强调');emphasis.enabled=true;await TavernHelper.replaceWorldbook('Audio Host Worldbook',rows);const updated=await TavernHelper.getWorldbook('Audio Host Worldbook');const saved=updated.find(row=>row.name==='[mvu_update]变量输出格式强调');document.dispatchEvent(new CustomEvent(${JSON.stringify(parentEvent)},{detail:{names,charBooks,enabled:saved.enabled}}));}catch(error){document.dispatchEvent(new CustomEvent(${JSON.stringify(parentEvent)},{detail:{error:String(error&&error.stack||error)}}));}})();`;
      frame.parent.document.body.appendChild(script);
    });
    const daoyuanOptimal = {enabled: true, generate_enabled: true, generate_loader_enabled: true, render_enabled: true, render_loader_enabled: true, with_context_disabled: false, debug_enabled: false, autosave_enabled: false, preload_worldinfo_enabled: true, code_blocks_enabled: true, raw_message_evaluation_enabled: true, filter_message_enabled: true, inject_loader_enabled: false, invert_enabled: true, depth_limit: -1, compile_workers: false, sandbox: false};
    const projectedSettings = frame.SillyTavern.extensionSettings.EjsTemplate;
    const promptOptimal = Object.entries(daoyuanOptimal).every(([key, value]) => projectedSettings[key] === value);
    Object.assign(projectedSettings, daoyuanOptimal);
    await frame.saveSettings();
    const daoyuan = {parentPublished: window.TavernHelper === helper && window.SillyTavern === frame.SillyTavern && window.EjsTemplate === frame.EjsTemplate, parentResult, promptOptimal, promptProjectionEnumerable: Object.prototype.propertyIsEnumerable.call(frame.SillyTavern.extensionSettings, 'EjsTemplate'), promptDuplicatedInPersistence: Object.prototype.hasOwnProperty.call(D.settings.tavernHelperExtensionSettings, 'EjsTemplate')};

    const dom = {
      textarea: frame.parent.document.getElementById('send_textarea') === document.getElementById('user-input'),
      button: frame.parent.document.querySelector('#send_but') === document.getElementById('composer-action-btn'),
      avatar: (() => { const image = document.getElementById('user_avatar_image'), expected = displayImageSrc(getActivePersona(D.currentCharId), 'avatar_image'); const normalize = value => { try { return decodeURIComponent(String(value || '')); } catch (_) { return String(value || ''); } }; return frame.parent.document.querySelector('#user_avatar_image') === image && image.tagName === 'IMG' && normalize(image.getAttribute('src')) === normalize(expected); })(),
      jquery: frame.parent.$('#send_textarea')[0] === document.getElementById('user-input'),
    };

    const order = [];
    const ordinary = frame.eventOn('audio-host-order', async value => { await new Promise(resolve => setTimeout(resolve, 12)); order.push('ordinary:' + value); });
    const last = frame.eventMakeLast('audio-host-order', value => order.push('last:' + value));
    const first = frame.eventMakeFirst('audio-host-order', value => order.push('first:' + value));
    frame.eventOnce('audio-host-order', value => order.push('once:' + value));
    await frame.eventEmit('audio-host-order', 'x');
    await frame.eventEmit('audio-host-order', 'y');
    ordinary.stop(); last.stop(); first.stop(); frame.eventClearEvent('audio-host-order');
    const sync = [];
    frame.eventOn('audio-host-sync', value => sync.push(value));
    frame.eventEmitAndWait('audio-host-sync', 'now');
    frame.eventClearAll();

    const crossFrameOrder = [];
    const a1 = value => crossFrameOrder.push('A1:' + value);
    frame.eventOn('audio-host-cross-frame', a1);
    frame.eventOn('audio-host-cross-frame', a1);
    messageFrame.eventOn('audio-host-cross-frame', value => { crossFrameOrder.push('B1:' + value); throw new Error('expected listener failure'); });
    frame.eventOn('audio-host-cross-frame', value => crossFrameOrder.push('A2:' + value));
    await frame.eventEmit('audio-host-cross-frame', 'global');
    const clearIsolation = [];
    frame.eventOn('audio-host-clear-event', () => clearIsolation.push('event:A'));
    messageFrame.eventOn('audio-host-clear-event', () => clearIsolation.push('event:B'));
    frame.eventClearEvent('audio-host-clear-event');
    await frame.eventEmit('audio-host-clear-event');
    const sharedClearHandler = () => clearIsolation.push('listener:hit');
    frame.eventOn('audio-host-clear-listener', sharedClearHandler);
    messageFrame.eventOn('audio-host-clear-listener', sharedClearHandler);
    frame.eventClearListener(sharedClearHandler);
    await frame.eventEmit('audio-host-clear-listener');
    frame.eventOn('audio-host-clear-all', () => clearIsolation.push('all:A'));
    messageFrame.eventOn('audio-host-clear-all', () => clearIsolation.push('all:B'));
    frame.eventClearAll();
    await frame.eventEmit('audio-host-clear-all');
    const typedMessageIndexes = [];
    messageFrame.eventOn(messageFrame.tavern_events.MESSAGE_SENT, value => typedMessageIndexes.push({value, type: typeof value}));
    await frame.eventEmit(frame.tavern_events.MESSAGE_SENT, '7');

    frame.audioPlay({type: 'ambient', play: 'false'});
    const emptyAudioDesired = frame.getCurrentAudio('ambient');
    frame.replaceAudioList('bgm', [{url: 'data:audio/wav;base64,UklGRg=='}]);
    frame.appendAudioList('bgm', [{title: 'Second', url: 'data:audio/wav;base64,UklGRkI='}]);
    frame.setAudioSettings('bgm', {enabled: false, volume: 0, muted: false, mode: 'repeat_one'});
    frame.playAudio('bgm', {title: 'Fixture', url: 'data:audio/wav;base64,UklGRg=='});
    const publicSettingsMirrored = structuredClone(frame.extension_settings.tavern_helper.audio.bgm);
    const disabledPlayback = {current: frame.getCurrentAudio('bgm'), actualPaused: _tavernAudioRuntime.bgm.audio.paused};
    frame.setAudioSettings('bgm', {enabled: true, volume: 23});
    const extensionSettingsApplied = {settings: frame.getAudioSettings('bgm'), elementVolume: _tavernAudioRuntime.bgm.audio.volume, elementMuted: _tavernAudioRuntime.bgm.audio.muted, actualPaused: _tavernAudioRuntime.bgm.audio.paused};
    frame.setAudioSettings('bgm', {enabled: false, volume: 100, mode: 'repeat_one'});
    await frame.triggerSlash('/audioimport type=ambient play=false https://audio.example/rain.mp3,https://audio.example/wind.mp3');
    await frame.triggerSlash('/audiomode type=ambient mode=random');

    messageFrame.registerMacroLike(/\{\{audioHostMacro\}\}/g, () => 'macro-ok');
    const macro = frame.substitudeMacros('{{char}} {{charAvatarPath}} {{audioHostMacro}}');
    let disposedEventCalls = 0;
    messageFrame.eventOn('audio-host-dispose', () => { disposedEventCalls++; });
    cardFrontendDispose('audio-host-audio-message-frame');
    await frame.eventEmit('audio-host-dispose');
    const macroAfterDispose = frame.substitudeMacros('{{audioHostMacro}}');
    frame.initializeGlobal('__audioHostAudioGlobal', {ready: true});
    await frame.waitGlobalInitialized('__audioHostAudioGlobal');
    let mvuParentResolved = false;
    const mvuParentWaiting = frame.waitGlobalInitialized('Mvu').then(() => { mvuParentResolved = true; });
    await Promise.resolve();
    const mvuPendingBeforeParent = !mvuParentResolved;
    frame.initializeGlobal('Mvu', {getMvuData() { return {}; }});
    await Promise.resolve();
    const mvuPendingAfterParent = !mvuParentResolved;
    frame.replaceVariables({stat_data: {ready: true}}, {type: 'message', message_id: 0});
    await mvuParentWaiting;

    return {
      missingAudio, missingEvents, missingRemaining, daoyuan, dom, order, sync, crossFrameOrder, clearIsolation, typedMessageIndexes,
      triggerAlias: frame.triggerSlashWithResult === frame.triggerSlash,
      iframeIdentity: {nameAtLoad: frame.__audioHostIframeNameAtLoad, idAtLoad: frame.__audioHostScriptIdAtLoad, physicalName: live.frame.name},
      audio: {list: frame.getAudioList('bgm'), settings: frame.getAudioSettings('bgm'), current: frame.getCurrentAudio('bgm'), ambient: frame.getAudioList('ambient'), ambientSettings: frame.getAudioSettings('ambient'), emptyDesired: emptyAudioDesired},
      masters: {playlist: D.chats[D.currentCharId].sessions[0].tavernHelperAudio, settings: D.settings.tavernHelperExtensionSettings.tavern_helper.audio, saves: window.__audioHostAudioSaves.slice()},
      macro, macroAfterDispose, disposedEventCalls, globalReady: frame.__audioHostAudioGlobal.ready, mvu: {pendingBeforeParent: mvuPendingBeforeParent, pendingAfterParent: mvuPendingAfterParent, resolvedAfterState: mvuParentResolved}, settingsSync: {publicSettingsMirrored, disabledPlayback, extensionSettingsApplied, mirroredFinal: structuredClone(frame.extension_settings.tavern_helper.audio.bgm)},
      versions: [frame.getTavernVersion(), frame.getTavernHelperVersion(), frame.getFrontendVersion()],
    };
  }, oracle);

  assert.deepStrictEqual(result.missingAudio, []);
  assert.deepStrictEqual(result.missingEvents, []);
  assert.deepStrictEqual(result.missingRemaining, []);
  assert.strictEqual(result.daoyuan.parentPublished, true);
  assert.deepStrictEqual(result.daoyuan.parentResult, {names: ['Audio Host Worldbook'], charBooks: {primary: 'Audio Host Worldbook', additional: []}, enabled: true});
  assert.strictEqual(result.daoyuan.promptOptimal, true);
  assert.strictEqual(result.daoyuan.promptProjectionEnumerable, false);
  assert.strictEqual(result.daoyuan.promptDuplicatedInPersistence, false);
  assert.deepStrictEqual(result.dom, {textarea: true, button: true, avatar: true, jquery: true});
  assert.deepStrictEqual(result.order, ['first:x', 'ordinary:x', 'last:x', 'once:x', 'first:y', 'ordinary:y', 'last:y']);
  assert.deepStrictEqual(result.sync, ['now']);
  assert.deepStrictEqual(result.crossFrameOrder, ['A1:global', 'B1:global', 'A2:global']);
  assert.deepStrictEqual(result.clearIsolation, ['event:B', 'listener:hit', 'all:B']);
  assert.deepStrictEqual(result.typedMessageIndexes, [{value: 7, type: 'number'}]);
  assert.strictEqual(result.triggerAlias, true);
  assert.deepStrictEqual(result.iframeIdentity, {nameAtLoad: 'TH-script--Audio Contract--audio-host-audio-script', idAtLoad: 'audio-host-audio-script', physicalName: 'TH-script--Audio Contract--audio-host-audio-script'});
  assert.deepStrictEqual(result.audio.settings, {enabled: false, mode: 'repeat_one', muted: false, volume: 100});
  assert.deepStrictEqual(result.audio.current, {src: 'data:audio/wav;base64,UklGRg==', title: 'Fixture', playing: true, progress: 0});
  assert.strictEqual(result.audio.list.length, 2);
  assert.strictEqual(result.audio.ambient.length, 2);
  assert.strictEqual(result.audio.ambientSettings.mode, 'shuffle');
  assert.deepStrictEqual(result.audio.emptyDesired, {src: '', title: '', playing: true, progress: 0});
  assert.deepStrictEqual(result.masters.playlist.bgm, result.audio.list);
  assert.ok(result.masters.saves.includes('sessions'));
  assert.ok(result.masters.saves.includes('meta'));
  assert.deepStrictEqual(result.settingsSync.publicSettingsMirrored, {enabled: false, mode: 'repeat_one', muted: true, volume: 0});
  assert.deepStrictEqual(result.settingsSync.disabledPlayback, {current: {src: 'data:audio/wav;base64,UklGRg==', title: 'Fixture', playing: true, progress: 0}, actualPaused: true});
  assert.deepStrictEqual(result.settingsSync.extensionSettingsApplied, {settings: {enabled: true, mode: 'repeat_one', muted: false, volume: 23}, elementVolume: 0.23, elementMuted: false, actualPaused: false});
  assert.deepStrictEqual(result.settingsSync.mirroredFinal, {enabled: false, mode: 'repeat_one', muted: false, volume: 100});
  assert.match(result.macro, /^Audio Host\s+macro-ok$/);
  assert.ok(!result.macro.includes('{{charAvatarPath}}'));
  assert.strictEqual(result.macroAfterDispose, '{{audioHostMacro}}');
  assert.strictEqual(result.disposedEventCalls, 0);
  assert.strictEqual(result.globalReady, true);
  assert.deepStrictEqual(result.mvu, {pendingBeforeParent: true, pendingAfterParent: true, resolvedAfterState: true});
  assert.deepStrictEqual(result.versions, ['1.19.0', '4.11.3', '4.11.3']);
  assert.deepStrictEqual(pageErrors, []);

  console.log('audio, event, DOM and utility browser checks passed');
})().finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}).catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
