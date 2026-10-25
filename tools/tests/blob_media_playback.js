/* global mediaMarkup -- Browser fixtures assigned on window/globalThis in this file. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/media_blobs.json'), 'utf8'));
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({
    executablePath: resolveEdgeExecutable(),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage({viewport:{width:390, height:844}, hasTouch:true});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil:'load'});
  await waitForAppReady(page, {timeout:15000});

  const setup = await page.evaluate(async mediaFixture => {
    function bytes(value) {
      const binary = atob(value);
      const output = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
      return output;
    }
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" rx="12" fill="#8b5cf6"/><circle cx="60" cy="40" r="22" fill="#f9a8d4"/></svg>');
    const mediaAssets = [
      {id:'image', kind:'ccv3_asset', assetType:'other', name:'picture.svg', ext:'svg', mime:'image/svg+xml', bytes:svg, mediaHash:'blob-media-image'},
      {id:'preview', kind:'ccv3_asset', assetType:'other', name:'preview.svg', ext:'svg', mime:'image/svg+xml', bytes:svg, mediaHash:'blob-media-preview'},
      {id:'video', kind:'ccv3_asset', assetType:'other', name:'clip.mp4', ext:'mp4', mime:mediaFixture.videoMime, bytes:bytes(mediaFixture.videoBase64), mediaHash:'blob-media-video'},
      {id:'audio', kind:'ccv3_asset', assetType:'other', name:'tone.mp3', ext:'mp3', mime:mediaFixture.audioMime, bytes:bytes(mediaFixture.audioBase64), mediaHash:'blob-media-audio'}
    ];
    const content = '<img src="picture.svg">';
    const data = defaults();
    const portrait = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const char = {id:'blob-media-blob-media', name:'Blob 媒体验收', first_mes:content, alternate_greetings:['备用开场白 <img src="preview.svg">'], description:'', personality:'', scenario:'', mes_example:'', system_prompt:'', post_history_instructions:'', avatar_image:portrait, background_image:portrait, assets:[], media_assets:mediaAssets};
    const session = createBlankSession('播放验收', 'blob-media-blob-media-session');
    session.greetingChosen = true;
    session.msgs = [{seq:1, role:'assistant', content, time:1700000000000}];
    data.characters = [char];
    data.currentCharId = char.id;
    data.chats = {[char.id]:{sessions:[session], activeSid:session.id}};
    await YeyuRepository.save(data, {sections:['meta','characters','personas','worldbook','sessions','wheels']});
    releaseAllCardAssetObjectUrls();
    const loaded = await YeyuRepository.load();
    D = sanitizeLoadedData(loaded.data);
    const reloaded = getChar();
    const before = reloaded.media_assets.map(asset => ({name:asset.name, mediaKey:asset.mediaKey, hasBlob:asset.blob instanceof Blob, hasDataUrl:!!asset.data_url}));
    await hydrateReferencedCardAssets(reloaded, [content].concat(reloaded.alternate_greetings));
    for (const asset of reloaded.media_assets) if (!asset.blob) asset.blob = await YeyuRepository.loadMediaBlob(asset.mediaKey);
    const after = reloaded.media_assets.map(asset => ({name:asset.name, mediaKey:asset.mediaKey, hasBlob:asset.blob instanceof Blob, hasDataUrl:!!asset.data_url}));
    await applyCharBackground(reloaded, false);
    updateChatUI();
    renderCharList();
    renderChat();
    const storedAudio = await YeyuRepository.loadMediaValue(reloaded.media_assets.find(asset => asset.name === 'tone.mp3').mediaKey);
    const storedAvatar = await loadStoredMediaDataUrl(reloaded, 'avatar_image');
    const storedBackground = await loadStoredMediaDataUrl(reloaded, 'background_image');
    const bgLayer = document.querySelector('.bg-layer.active');
    return {
      schema:YeyuRepository.SCHEMA,
      before,
      after,
      storedAudioPrefix:storedAudio.slice(0,24),
      loadedAvatarField:reloaded.avatar_image,
      loadedBackgroundField:reloaded.background_image,
      hasAvatarBlob:!!(reloaded._mediaBlobs&&reloaded._mediaBlobs.avatar_image instanceof Blob),
      hasBackgroundBlob:!!(reloaded._mediaBlobs&&reloaded._mediaBlobs.background_image instanceof Blob),
      displayAvatar:displayImageSrc(reloaded,'avatar_image'),
      displayBackground:displayImageSrc(reloaded,'background_image'),
      headerAvatar:document.querySelector('#ch-avatar img')&&document.querySelector('#ch-avatar img').getAttribute('src')||'',
      listAvatar:document.querySelector('#char-list .char-avatar img')&&document.querySelector('#char-list .char-avatar img').getAttribute('src')||'',
      messageAvatar:document.querySelector('#chat-messages .msg.char .msg-avatar img')&&document.querySelector('#chat-messages .msg.char .msg-avatar img').getAttribute('src')||'',
      backgroundCss:bgLayer&&bgLayer.style.backgroundImage||'',
      storedAvatarPrefix:String(storedAvatar||'').slice(0,22),
      storedBackgroundPrefix:String(storedBackground||'').slice(0,22)
    };
  }, fixture);

  assert.strictEqual(setup.schema, 4, 'IndexedDB schema 必须保持 v4');
  assert.ok(setup.before.every(asset => asset.mediaKey && !asset.hasBlob && !asset.hasDataUrl), '重载后媒体资产应保持仅引用状态');
  assert.ok(setup.after.every(asset => asset.hasBlob && !asset.hasDataUrl), '图片、音频、视频的聊天水合必须统一返回 Blob');
  assert.match(setup.storedAudioPrefix, /^data:audio\/mpeg;base64,/, '媒体读取必须继续返回 data URL');
  assert.strictEqual(setup.loadedAvatarField, '', '重载后头像字段不得回填 data URL');
  assert.strictEqual(setup.loadedBackgroundField, '', '重载后背景字段不得回填 data URL');
  assert.strictEqual(setup.hasAvatarBlob, true, '重载后头像必须挂上 Blob');
  assert.strictEqual(setup.hasBackgroundBlob, true, '重载后背景必须挂上 Blob');
  assert.match(setup.displayAvatar, /^blob:/, '头像展示源必须是 blob URL');
  assert.match(setup.displayBackground, /^blob:/, '背景展示源必须是 blob URL');
  assert.match(setup.headerAvatar, /^blob:/, '标题栏头像 DOM 必须是 blob URL');
  assert.match(setup.listAvatar, /^blob:/, '角色列表头像 DOM 必须是 blob URL');
  assert.match(setup.messageAvatar, /^blob:/, '消息气泡头像 DOM 必须是 blob URL');
  assert.match(setup.backgroundCss, /blob:/, '背景层必须使用 blob URL');
  assert.match(setup.storedAvatarPrefix, /^data:image\/png;base64,/, '读取头像必须仍是 data URL');
  assert.match(setup.storedBackgroundPrefix, /^data:image\/png;base64,/, '读取背景必须仍是 data URL');

  const duplicateBefore = await page.evaluate(() => {
    const original = getChar();
    window.__blobMediaRevokedUrls = [];
    window.__blobMediaOriginalRevokeObjectURL = URL.revokeObjectURL;
    URL.revokeObjectURL = function(url) {
      window.__blobMediaRevokedUrls.push(url);
      return window.__blobMediaOriginalRevokeObjectURL.call(URL, url);
    };
    return {
      originalId:original.id,
      avatarUrl:displayImageSrc(original, 'avatar_image'),
      backgroundUrl:displayImageSrc(original, 'background_image')
    };
  });
  assert.match(duplicateBefore.avatarUrl, /^blob:/, '复制前原角色头像必须已创建 blob URL');
  assert.match(duplicateBefore.backgroundUrl, /^blob:/, '复制前原角色背景必须已创建 blob URL');
  assert.notStrictEqual(duplicateBefore.avatarUrl, duplicateBefore.backgroundUrl);
  await page.locator('.char-item.active button[title="复制"]').evaluate(button => button.click());
  await page.waitForFunction(originalId => D.characters.length === 2 && D.characters.some(char => char.id !== originalId) && document.querySelectorAll('#char-list .char-item').length === 2, duplicateBefore.originalId);

  const duplicatePortraitLifecycle = await page.evaluate(async originalId => {
    function decode(source) {
      return new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
        image.onerror = () => resolve(false);
        image.src = source;
      });
    }
    function portraitState(item) {
      const avatarUrl = displayImageSrc(item, 'avatar_image');
      const backgroundUrl = displayImageSrc(item, 'background_image');
      const avatar = item._mediaDisplay && item._mediaDisplay.avatar_image;
      const background = item._mediaDisplay && item._mediaDisplay.background_image;
      return {
        avatarUrl,
        backgroundUrl,
        avatarDisplay:avatar,
        backgroundDisplay:background,
        avatarBlob:item._mediaBlobs && item._mediaBlobs.avatar_image,
        backgroundBlob:item._mediaBlobs && item._mediaBlobs.background_image
      };
    }
    const original = D.characters.find(char => char.id === originalId);
    const duplicate = D.characters.find(char => char.id !== originalId);
    const originalBeforeSync = portraitState(original);
    const duplicateBeforeSync = portraitState(duplicate);
    const independentBeforeSync = {
      avatarDisplay:originalBeforeSync.avatarDisplay !== duplicateBeforeSync.avatarDisplay,
      backgroundDisplay:originalBeforeSync.backgroundDisplay !== duplicateBeforeSync.backgroundDisplay,
      avatarUrl:originalBeforeSync.avatarUrl !== duplicateBeforeSync.avatarUrl,
      backgroundUrl:originalBeforeSync.backgroundUrl !== duplicateBeforeSync.backgroundUrl,
      avatarSource:originalBeforeSync.avatarDisplay.objectUrlSource === originalBeforeSync.avatarBlob && duplicateBeforeSync.avatarDisplay.objectUrlSource === duplicateBeforeSync.avatarBlob,
      backgroundSource:originalBeforeSync.backgroundDisplay.objectUrlSource === originalBeforeSync.backgroundBlob && duplicateBeforeSync.backgroundDisplay.objectUrlSource === duplicateBeforeSync.backgroundBlob
    };
    const revokedBeforeSync = window.__blobMediaRevokedUrls.slice();
    syncCardAssetObjectUrlLifecycle(original);
    renderChat();
    updateChatUI();
    await applyCharBackground(original, false);
    const originalAfterSync = portraitState(original);
    const duplicateAfterSync = portraitState(duplicate);
    const decodedAfterSync = {
      originalAvatar:await decode(originalAfterSync.avatarUrl),
      originalBackground:await decode(originalAfterSync.backgroundUrl),
      duplicateAvatar:await decode(duplicateAfterSync.avatarUrl),
      duplicateBackground:await decode(duplicateAfterSync.backgroundUrl)
    };
    const revokedAfterSync = window.__blobMediaRevokedUrls.slice();

    const duplicateSession = createBlankSession('副本保存验收', 'blob-media-duplicate-session');
    duplicateSession.greetingChosen = true;
    D.chats[duplicate.id] = {sessions:[duplicateSession], activeSid:duplicateSession.id};
    await saveData('sessions', {urgent:true});
    await selectCharacter(duplicate.id);
    const duplicateAfterSwitch = portraitState(D.characters.find(char => char.id === duplicate.id));
    await selectCharacter(original.id);
    const originalAfterSwitch = portraitState(D.characters.find(char => char.id === original.id));
    const decodedAfterSwitch = {
      originalAvatar:await decode(originalAfterSwitch.avatarUrl),
      originalBackground:await decode(originalAfterSwitch.backgroundUrl),
      duplicateAvatar:await decode(duplicateAfterSwitch.avatarUrl),
      duplicateBackground:await decode(duplicateAfterSwitch.backgroundUrl)
    };

    await editCharacter(duplicate.id);
    await saveCharacter();
    await editCharacter(original.id);
    await saveCharacter();
    closeModal('create-modal');
    const savedOriginal = D.characters.find(char => char.id === original.id);
    const savedDuplicate = D.characters.find(char => char.id === duplicate.id);
    const savedState = {
      original:portraitState(savedOriginal),
      duplicate:portraitState(savedDuplicate)
    };
    const decodedAfterSave = {
      originalAvatar:await decode(savedState.original.avatarUrl),
      originalBackground:await decode(savedState.original.backgroundUrl),
      duplicateAvatar:await decode(savedState.duplicate.avatarUrl),
      duplicateBackground:await decode(savedState.duplicate.backgroundUrl)
    };

    URL.revokeObjectURL = window.__blobMediaOriginalRevokeObjectURL;
    delete window.__blobMediaOriginalRevokeObjectURL;
    delete window.__blobMediaRevokedUrls;
    return {
      originalId:original.id,
      duplicateId:duplicate.id,
      independentBeforeSync,
      originalUrls:[originalBeforeSync.avatarUrl, originalBeforeSync.backgroundUrl],
      duplicateUrls:[duplicateBeforeSync.avatarUrl, duplicateBeforeSync.backgroundUrl],
      revokedBeforeSync,
      revokedAfterSync,
      decodedAfterSync,
      decodedAfterSwitch,
      decodedAfterSave
    };
  }, duplicateBefore.originalId);
  await page.reload({waitUntil:'load'});
  await waitForAppReady(page, {timeout:15000});
  const duplicateReloadLifecycle = await page.evaluate(async ids => {
    function decode(source) {
      return new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
        image.onerror = () => resolve(false);
        image.src = source;
      });
    }
    function portraitState(item) {
      const avatarUrl = displayImageSrc(item, 'avatar_image');
      const backgroundUrl = displayImageSrc(item, 'background_image');
      return {
        avatarUrl,
        backgroundUrl,
        avatarDisplay:item._mediaDisplay && item._mediaDisplay.avatar_image,
        backgroundDisplay:item._mediaDisplay && item._mediaDisplay.background_image
      };
    }
    const original = D.characters.find(char => char.id === ids.originalId);
    const duplicate = D.characters.find(char => char.id === ids.duplicateId);
    await Promise.all([original, duplicate].flatMap(char => ['avatar_image', 'background_image'].map(field => hydrateStoredMediaField(char, field))));
    const session = getActiveSession(original.id);
    const visibleMedia = getGreetings(original).concat((session && session.msgs || []).map(message => String(message.content || '')));
    await hydrateReferencedCardAssets(original, visibleMedia);
    renderCharList();
    await applyCharBackground(getChar(), false);
    renderChat();
    updateChatUI();
    syncCardAssetObjectUrlLifecycle(getChar());
    await selectCharacter(duplicate.id);
    await selectCharacter(original.id);
    const states = {original:portraitState(original), duplicate:portraitState(duplicate)};
    const decoded = {
      originalAvatar:await decode(states.original.avatarUrl),
      originalBackground:await decode(states.original.backgroundUrl),
      duplicateAvatar:await decode(states.duplicate.avatarUrl),
      duplicateBackground:await decode(states.duplicate.backgroundUrl)
    };
    const refs = [original, duplicate].flatMap(char => ['avatar_image', 'background_image'].map(field => ({id:char.id, field, key:char._media && char._media[field]})));
    const stored = await Promise.all(refs.map(async ref => {
      const blob = ref.key ? await YeyuRepository.loadMediaBlob(ref.key) : null;
      return {id:ref.id, field:ref.field, key:ref.key || '', valid:blob instanceof Blob && blob.size > 0};
    }));
    const storedDataUrls = await Promise.all([original, duplicate].map(async char => ({
      id:char.id,
      avatar:await loadStoredMediaDataUrl(char, 'avatar_image'),
      background:await loadStoredMediaDataUrl(char, 'background_image')
    })));
    return {
      decoded,
      stored,
      storedPrefixes:storedDataUrls.map(item => ({id:item.id, avatar:item.avatar.slice(0,22), background:item.background.slice(0,22)})),
      independent:{
        avatarDisplay:states.original.avatarDisplay !== states.duplicate.avatarDisplay,
        backgroundDisplay:states.original.backgroundDisplay !== states.duplicate.backgroundDisplay,
        avatarUrl:states.original.avatarUrl !== states.duplicate.avatarUrl,
        backgroundUrl:states.original.backgroundUrl !== states.duplicate.backgroundUrl
      }
    };
  }, duplicatePortraitLifecycle);
  assert.deepStrictEqual(duplicatePortraitLifecycle.independentBeforeSync, {
    avatarDisplay:true,
    backgroundDisplay:true,
    avatarUrl:true,
    backgroundUrl:true,
    avatarSource:true,
    backgroundSource:true
  }, '原角色与副本必须拥有独立展示缓存与 object URL');
  assert.ok(duplicatePortraitLifecycle.originalUrls.every(url => !duplicatePortraitLifecycle.revokedBeforeSync.includes(url)), '副本首次渲染不得把原角色头像或背景地址送入撤销队列');
  assert.ok(duplicatePortraitLifecycle.originalUrls.every(url => !duplicatePortraitLifecycle.revokedAfterSync.includes(url)), '生命周期回收不得撤销原角色仍持有的头像或背景地址');
  assert.ok(Object.values(duplicatePortraitLifecycle.decodedAfterSync).every(Boolean), '显式同步生命周期后原角色与副本图片必须均可解码');
  assert.ok(Object.values(duplicatePortraitLifecycle.decodedAfterSwitch).every(Boolean), '正常聊天重绘和角色切换后图片必须均可解码');
  assert.ok(Object.values(duplicatePortraitLifecycle.decodedAfterSave).every(Boolean), '保存副本和原角色后图片必须均可解码');
  assert.ok(Object.values(duplicateReloadLifecycle.decoded).every(Boolean), '页面重载后图片必须均可解码：'+JSON.stringify(duplicateReloadLifecycle.decoded));
  assert.ok(duplicateReloadLifecycle.stored.every(item => item.key && item.valid), 'IndexedDB 中两个角色的头像和背景媒体引用必须全部有效');
  assert.ok(duplicateReloadLifecycle.storedPrefixes.every(item => /^data:image\//.test(item.avatar) && /^data:image\//.test(item.background)), '两个角色读取的头像和背景必须仍为 data URL');
  assert.deepStrictEqual(duplicateReloadLifecycle.independent, {avatarDisplay:true, backgroundDisplay:true, avatarUrl:true, backgroundUrl:true}, '重载后两个角色仍必须建立独立展示缓存');

  await page.evaluate(async () => {
    const char=getChar();
    for(const asset of char.media_assets) if(!asset.blob) asset.blob=await YeyuRepository.loadMediaBlob(asset.mediaKey);
    window.mediaMarkup = function(){
      const char=getChar(),src=name=>cardAssetDisplaySrc(char.media_assets.find(asset=>asset.name===name),char);
      return '<img src="'+src('picture.svg')+'"><video autoplay muted loop><source src="'+src('clip.mp4')+'" type="video/mp4"></video><video controls autoplay loop><source src="'+src('clip.mp4')+'" type="video/mp4"></video><audio controls autoplay loop><source src="'+src('tone.mp3')+'" type="audio/mpeg"></audio>';
    };
    getActiveSession(char.id).msgs[0].content=mediaMarkup();
    renderChat();
    playAudio('bgm',{title:'Stored audio',url:cardAssetDisplaySrc(char.media_assets.find(asset=>asset.name==='tone.mp3'),char)});
  });
  try { await page.waitForFunction(() => {
    const root = document.getElementById('chat-messages');
    const image = root && root.querySelector('img.yeyu-card-image');
    const videos = root ? Array.from(root.querySelectorAll('video.yeyu-card-video')) : [];
    const audio = root && root.querySelector('audio.yeyu-card-audio');
    return !!(image && image.complete && image.naturalWidth > 0 && videos.length === 2 && videos.every(video => video.readyState >= 2) && audio && audio.readyState >= 2 && tavernAudioRuntime('bgm').audio && tavernAudioRuntime('bgm').audio.readyState >= 2);
  }, null, {timeout:15000}); } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      html:document.getElementById('chat-messages').innerHTML,
      image:Array.from(document.querySelectorAll('#chat-messages img')).map(item => ({src:item.src, complete:item.complete, width:item.naturalWidth})),
      audio:Array.from(document.querySelectorAll('#chat-messages audio')).map(item => ({src:item.currentSrc, ready:item.readyState, error:item.error && item.error.code})),
      video:Array.from(document.querySelectorAll('#chat-messages video')).map(item => ({src:item.currentSrc, ready:item.readyState, error:item.error && item.error.code})),
      bgm:tavernAudioRuntime('bgm').audio && {src:tavernAudioRuntime('bgm').audio.currentSrc, ready:tavernAudioRuntime('bgm').audio.readyState, error:tavernAudioRuntime('bgm').audio.error && tavernAudioRuntime('bgm').audio.error.code},
      debug:({active:!!tavernAudioRuntime('bgm').src,playing:!!(tavernAudioRuntime('bgm').audio&&!tavernAudioRuntime('bgm').audio.paused),panelOpen:_cardBgmPanelOpen,trackName:tavernAudioRuntime('bgm').title,})
    }));
    throw new Error(error.message + '\n' + JSON.stringify(diagnostics));
  }
  await page.evaluate(async () => {
    const media = Array.from(document.querySelectorAll('#chat-messages audio.yeyu-card-audio,#chat-messages video.yeyu-card-video'));
    await Promise.all(media.map(item => item.play()));
    if (tavernAudioRuntime('bgm').audio.paused) toggleCardAudioPause('bgm');
  });
  await page.waitForFunction(() => {
    const media = Array.from(document.querySelectorAll('#chat-messages audio.yeyu-card-audio,#chat-messages video.yeyu-card-video'));
    return media.length === 3 && media.every(item => !item.paused && item.currentTime > 0.03) && tavernAudioRuntime('bgm').audio && !tavernAudioRuntime('bgm').audio.paused && tavernAudioRuntime('bgm').audio.currentTime > 0.03;
  }, null, {timeout:10000});

  const playback = await page.evaluate(() => {
    const root = document.getElementById('chat-messages');
    const image = root.querySelector('img.yeyu-card-image');
    const videos = Array.from(root.querySelectorAll('video.yeyu-card-video'));
    const audio = root.querySelector('audio.yeyu-card-audio');
    const sources = [image.src, audio.currentSrc || audio.querySelector('source').src]
      .concat(videos.map(video => video.currentSrc || video.querySelector('source').src))
      .concat([tavernAudioRuntime('bgm').audio.currentSrc || tavernAudioRuntime('bgm').audio.src]);
    return {
      sources,
      dataUrlCount:sources.filter(source => /^data:/i.test(source)).length,
      imageReady:image.complete && image.naturalWidth > 0,
      audioCurrentTime:audio.currentTime,
      videoCurrentTimes:videos.map(video => video.currentTime),
      assetVideoControls:videos[0].controls,
      explicitVideoControls:videos[1].controls,
      bgmCurrentTime:tavernAudioRuntime('bgm').audio.currentTime,
      bgm:({active:!!tavernAudioRuntime('bgm').src,playing:!!(tavernAudioRuntime('bgm').audio&&!tavernAudioRuntime('bgm').audio.paused),panelOpen:_cardBgmPanelOpen,trackName:tavernAudioRuntime('bgm').title,}),
      objectUrls:({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)})
    };
  });
  assert.ok(playback.sources.every(source => source.startsWith('blob:')), 'DOM 与 BGM 播放源必须全部是 blob URL');
  assert.strictEqual(playback.dataUrlCount, 0);
  assert.strictEqual(playback.imageReady, true);
  assert.ok(playback.audioCurrentTime > 0);
  assert.ok(playback.videoCurrentTimes.every(value => value > 0));
  assert.strictEqual(playback.assetVideoControls, false, '未声明 controls 的 HTML 视频不显示控制条');
  assert.strictEqual(playback.explicitVideoControls, true, '声明 controls 的 HTML 视频显示控制条');
  assert.ok(playback.bgmCurrentTime > 0);
  assert.ok(playback.objectUrls.active >= 5, '聊天资产与头像/背景展示 URL 必须同时登记');
  assert.strictEqual(playback.objectUrls.retired, 0);

  const greetingCancelLifecycle = await page.evaluate(async () => {
    const char = getChar(), before = ({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}), cycles = [];
    for (let index = 0; index < 2; index += 1) {
      const pending = chooseGreeting(char);
      await new Promise(resolve => setTimeout(resolve, 30));
      syncCardAssetObjectUrlLifecycle(char);
      const previewAsset = char.media_assets.find(asset => asset.name === 'preview.svg'), previewUrl = previewAsset && previewAsset.objectUrl || '';
      const openState = ({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}), overlayOpen = document.getElementById('greeting-modal').classList.contains('open'), inChat = !!(previewUrl && document.getElementById('chat-messages').innerHTML.includes(previewUrl));
      const revokedUrls = [], originalRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = function(url) { revokedUrls.push(url); return originalRevoke.call(URL, url); };
      try { resolveGreetingChoice(null); } finally { URL.revokeObjectURL = originalRevoke; }
      await pending;
      cycles.push({previewUrl, overlayOpen, inChat, openState, closedState:({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}), revoked:revokedUrls.includes(previewUrl)});
    }
    const root = document.getElementById('chat-messages'), image = root.querySelector('img.yeyu-card-image');
    const media = Array.from(root.querySelectorAll('audio.yeyu-card-audio,video.yeyu-card-video'));
    return {before, cycles, imageReady:image.complete && image.naturalWidth > 0, mediaReady:media.every(item => item.readyState >= 2)};
  });
  assert.ok(greetingCancelLifecycle.cycles.every(cycle => cycle.overlayOpen && !cycle.inChat && /^blob:/.test(cycle.previewUrl)), '备用开场白资产必须只存在于当前打开弹窗');
  assert.ok(greetingCancelLifecycle.cycles.every(cycle => cycle.openState.active === greetingCancelLifecycle.before.active + 1 && cycle.openState.urls.includes(cycle.previewUrl)), '弹窗打开期间清理不得过早撤销 modal-only URL');
  assert.ok(greetingCancelLifecycle.cycles.every(cycle => cycle.revoked && cycle.closedState.active === greetingCancelLifecycle.before.active && cycle.closedState.retired === 0), '弹窗关闭后必须释放 modal-only URL 且不得累积');
  assert.ok(greetingCancelLifecycle.cycles.every(cycle => JSON.stringify(cycle.closedState.urls) === JSON.stringify(greetingCancelLifecycle.before.urls)), '取消开场白不得替换原聊天仍在使用的 URL');
  assert.strictEqual(greetingCancelLifecycle.imageReady, true);
  assert.strictEqual(greetingCancelLifecycle.mediaReady, true);

  const inertRisu = await page.evaluate(() => {
    const source = tavernAudioRuntime('bgm').audio.currentSrc;
    getActiveSession(getChar().id).msgs.push({seq:2,role:'assistant',content:'{{bgm::missing.mp3}}<div risu-ctrl="bgm___auto___https://example.invalid/audio.mp3"></div>'});
    renderChat();
    return {source,after:tavernAudioRuntime('bgm').audio.currentSrc,markers:document.querySelectorAll('[risu-ctrl]').length};
  });
  assert.strictEqual(inertRisu.after,inertRisu.source,'Risu 标记不改变 ST 音频');
  assert.strictEqual(inertRisu.markers,0,'Risu 专属属性不进入显示 DOM');
  const detachedAudioLifecycle = await page.evaluate(async () => {
    tavernAudioClearRuntime('bgm');
    const char = getChar(), template = char.media_assets.find(asset => asset.name === 'tone.mp3');
    const tracks = ['bgm', 'ambient'].map(type => {
      const asset = {id:'detached-' + type, name:type + '.mp3', mime:template.mime, blob:template.blob};
      char.media_assets.push(asset);
      const url = cardAssetDisplaySrc(asset, char);
      playAudio(type, {title:type, url});
      pauseAudio(type);
      return {type, asset, url};
    });
    syncCardAssetObjectUrlLifecycle(char);
    const retained = await Promise.all(tracks.map(async ({url}) => ({
      inDom:document.getElementById('chat-messages').innerHTML.includes(url),
      registered:Array.from(_cardAssetObjectUrls.values()).some(record => record.url === url),
      readable:(await fetch(url)).ok,
    })));
    const revoked = [], originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = function(url) { revoked.push(url); return originalRevoke.call(URL, url); };
    try {
      tracks.forEach(({type}) => tavernAudioClearRuntime(type));
      syncCardAssetObjectUrlLifecycle(char);
    } finally { URL.revokeObjectURL = originalRevoke; }
    char.media_assets = char.media_assets.filter(asset => !tracks.some(track => track.asset === asset));
    return {retained, released:tracks.map(({url}) => revoked.includes(url))};
  });
  assert.ok(detachedAudioLifecycle.retained.every(row => !row.inDom && row.registered && row.readable), '暂停的 BGM 和 ambient 即使不在 DOM 中也必须保留当前 Blob 音源');
  assert.deepStrictEqual(detachedAudioLifecycle.released, [true, true], '双通道清空后必须释放不再使用的音源 URL');

  const styleOnlyBackground = await page.evaluate(async () => {
    const session = getActiveSession(getChar().id);
    session.msgs = [{seq:3, role:'assistant', content:mediaMarkup().replace(/<img[^>]+>/, '<style>.blob-media-style-bg{width:120px;height:80px;background-image:url('+cardAssetDisplaySrc(getChar().media_assets.find(asset=>asset.name==='picture.svg'),getChar())+');background-size:cover}</style><div class="blob-media-style-bg" data-blob-media-style-bg="1"></div>'), time:1700000002000}];
    renderChat();
    const target = document.querySelector('[data-blob-media-style-bg="1"]');
    const background = target ? getComputedStyle(target).backgroundImage : '';
    const match = background.match(/url\(["']?(blob:[^)"']+)/i);
    const source = match ? match[1] : '';
    const decoded = await new Promise(resolve => {
      if (!source) return resolve(false);
      const image = new Image();image.onload = () => resolve(image.naturalWidth > 0);image.onerror = () => resolve(false);image.src = source;
    });
    return {background, source, decoded, state:({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}), chatActive:Array.from(_cardAssetObjectUrls.keys()).filter(asset => asset && !asset.persistDisplay).length};
  });
  assert.match(styleOnlyBackground.source, /^blob:/, 'CSS 背景必须保留 blob object URL');
  assert.strictEqual(styleOnlyBackground.decoded, true, '仅由 style 节点引用的 Blob 图片必须能完成解码');
  assert.strictEqual(styleOnlyBackground.chatActive, 3, 'CSS 背景、音频和视频当前使用的 URL 必须保留');

  const sameCharacterUnload = await page.evaluate(() => {
    const oldUrls = ({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}).urls.slice();
    const session = getActiveSession(getChar().id);
    session.msgs = [{seq:3, role:'assistant', content:'媒体节点已经卸载', time:1700000002000}];
    const revokedUrls = [], originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = function(url) { revokedUrls.push(url); return originalRevoke.call(URL, url); };
    try { renderChat(); } finally { URL.revokeObjectURL = originalRevoke; }
    const portraitUrls = Array.from(_cardAssetObjectUrls.keys()).filter(asset => asset && asset.persistDisplay).map(asset => asset.objectUrl).filter(Boolean);
    const chatOldUrls = oldUrls.filter(url => !portraitUrls.includes(url));
    return {oldUrls, portraitUrls, chatOldUrls, revoked:chatOldUrls.map(url => revokedUrls.includes(url)), state:({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}), chatActive:Array.from(_cardAssetObjectUrls.keys()).filter(asset => asset && !asset.persistDisplay).length};
  });
  assert.strictEqual(sameCharacterUnload.chatOldUrls.length, 3);
  assert.ok(sameCharacterUnload.revoked.every(Boolean), '同一角色卸载最后一个媒体节点后，旧 object URL 必须全部失效');
  assert.strictEqual(sameCharacterUnload.chatActive, 0, '同一角色内不得累积已经卸载的聊天资产 URL');
  assert.ok(sameCharacterUnload.portraitUrls.length >= 2, '头像与背景展示 URL 在角色仍存在时必须保留');

  const lifecycle = await page.evaluate(() => {
    const session = getActiveSession(getChar().id);
    session.msgs = [{seq:20, role:'assistant', content:mediaMarkup(), time:1700000004000}];
    renderChat();
    const oldUrls = ({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}).urls.slice();
    const other = {id:'blob-media-empty-card', name:'空卡', first_mes:'', alternate_greetings:[], media_assets:[]};
    D.characters.push(other);
    D.chats[other.id] = {sessions:[createBlankSession('空对话', 'blob-media-empty-session')], activeSid:'blob-media-empty-session'};
    D.currentCharId = other.id;
    renderChat();
    return {
      oldCount:oldUrls.length,
      state:({ownerId:_cardAssetObjectUrlOwnerId,active:_cardAssetObjectUrls.size,retired:_retiredCardAssetObjectUrls.size,urls:Array.from(_cardAssetObjectUrls.values()).map(r=>r.url)}),
      chatActive:Array.from(_cardAssetObjectUrls.keys()).filter(asset => asset && !asset.persistDisplay).length,
      portraitActive:Array.from(_cardAssetObjectUrls.keys()).filter(asset => asset && asset.persistDisplay).length
    };
  });
  assert.ok(lifecycle.oldCount >= 5, '切卡前应同时登记聊天资产与头像/背景 URL');
  assert.strictEqual(lifecycle.state.ownerId, 'blob-media-empty-card');
  assert.strictEqual(lifecycle.chatActive, 0, '切卡后旧卡聊天资产 URL 必须释放');
  assert.ok(lifecycle.portraitActive >= 2, '切卡后原角色头像/背景 URL 必须保留');
  assert.strictEqual(lifecycle.state.retired, 0);
  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log(JSON.stringify({setup, duplicatePortraitLifecycle, duplicateReloadLifecycle, playback, detachedAudioLifecycle, greetingCancelLifecycle, inertRisu, styleOnlyBackground, sameCharacterUnload, lifecycle, viewport:'390x844'}));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
