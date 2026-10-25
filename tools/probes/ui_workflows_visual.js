'use strict';

// Read-only optional artwork; all conversations and settings are isolated visual fixtures.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('../tests/source');
const {visualDevice, installNativeSafeArea} = require('../qa/visual_device');
const root = path.resolve(__dirname,'../..'), assets = path.join(root,'app/src/main/assets');
const device = visualDevice(), label = process.argv[3] || 'generated';
const pageTabsOnly = process.argv.includes('--page-tabs');
const motionPreviewOnly = process.argv.includes('--motion-preview');
const wheelManagerOnly = process.argv.includes('--wheel-manager-only');
const wheelGameOnly = process.argv.includes('--wheel-game-only');
const output = path.join(root,motionPreviewOnly ? '.tmp/ui-motion-preview' : pageTabsOnly ? '.tmp/ui-page-tabs' : wheelGameOnly ? '.tmp/ui-wheel-game' : '.tmp/ui-workflows-visual',device.id,label);
const picture = process.argv[2] && process.argv[2] !== '-' ? 'data:image/png;base64,' + fs.readFileSync(process.argv[2]).toString('base64') : '';
const wheelDocument = JSON.parse(fs.readFileSync(path.join(root,'tools/fixtures/wheel_scheme.json'),'utf8'));
const metrics = [], errors = [], nativeDialogs = [];
let browser, server, page;

function writeResults() {
  assert.deepStrictEqual(errors,[]); assert.deepStrictEqual(nativeDialogs,[]);
  fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify({device:device.id,artwork:picture ? 'read-only supplied image' : 'generated gradient',fixtureData:true,errors,nativeDialogs,metrics},null,2));
  console.log(JSON.stringify({output,screenshots:metrics.length,pageErrors:errors.length,nativeDialogs:nativeDialogs.length}));
}

async function capture(name) {
  await page.waitForFunction(() => !_uiMotions.size && !document.getAnimations().some(animation => animation.playState === 'running' && Number.isFinite(animation.effect.getComputedTiming().endTime)));
  const state = await page.evaluate(() => {
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && Number(getComputedStyle(node).opacity) > 0;
    const surface = document.querySelector('.storage-recovery-screen') || getTopOpenModal() || document.querySelector('.app-page.open') || document.querySelector('.wheel-game-view.open') || document.querySelector('.card-bgm-panel.open') || document.getElementById('app');
    const controls = Array.from(surface.querySelectorAll('button,input,textarea,select,summary,h2,h3,.hint,.app-select-trigger,.preset-prompt-main strong'))
      .filter(visible).filter(node => !node.matches('.app-select-native,input[type=hidden],input[type=checkbox]'))
      .map(node => {
        const box = node.getBoundingClientRect(), css = getComputedStyle(node), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
        context.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        const glyph = context.measureText('国');
        return {tag:node.tagName,id:node.id,classes:node.className,label:node.getAttribute('aria-label') || node.textContent.trim().slice(0,36),x:box.x,y:box.y,width:box.width,height:box.height,fontSize:css.fontSize,lineHeight:css.lineHeight,fontWeight:css.fontWeight,glyphHeight:glyph.actualBoundingBoxAscent + glyph.actualBoundingBoxDescent,background:css.backgroundColor,color:css.color,disabled:node.disabled === true};
      });
    const nav = document.getElementById('bottom-nav').getBoundingClientRect();
    return {page:currentAppPage(),surface:surface.id,theme:document.documentElement.dataset.theme,
      bounds:surface.getBoundingClientRect().toJSON(),nav:nav.toJSON(),
      horizontalOverflow:document.documentElement.scrollWidth > innerWidth,
      controls,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};
  });
  assert.strictEqual(state.horizontalOverflow,false,name + ' viewport overflow');
  if (['settings-modal','prompt-manager-modal','memory-manager-modal'].includes(state.surface)) {
    assert(state.bounds.bottom <= state.nav.top + 1,name + ' navigation is covered');
  }
  metrics.push({name,...state});
  await page.screenshot({path:path.join(output,name + '.png'),fullPage:false});
}
async function clearSurfaces() {
  await page.evaluate(() => {
    closeAppSelect(false);
    closeCardBgmPanel();
    document.querySelector('.tokens-details').open=false;
    document.getElementById('toasts').replaceChildren();
    if (_memoryJobActive) hideMemoryJob();
    if (_importProgressActive) hideImportProgress();
    if (creatorNotesResolver) { var resolve = creatorNotesResolver; creatorNotesResolver = null; resolve(false); }
    var top;
    while ((top = getTopOpenModal())) {
      if (top.id === 'wheel-scheme-spin-modal') closeWheelSchemeSpin();
      else if (top.id === 'persona-crop-modal') cancelPersonaCrop();
      else closeModal(top.id);
    }
    closeWheelSchemeGame();
    switchAppPage('chat');
  });
}
async function modal(name, open, ready) {
  await clearSurfaces();
  await page.evaluate(open);
  if (ready) await page.locator(ready).waitFor({state:'visible'});
  await capture(name);
}
async function destination(name, key, setup) {
  await clearSurfaces();
  await page.locator('#bottom-nav [data-page="' + key + '"]').click();
  if (setup) await page.evaluate(setup);
  await page.locator('.app-page.open .modal-body').evaluate(node => { node.scrollTop = 0; });
  await capture(name);
}

async function recordMotionPreview() {
  const {spawn} = require('child_process');
  const {once} = require('events');
  const cdp = await page.context().newCDPSession(page), frames = [], timeline = [];
  cdp.on('Page.screencastFrame',event => {
    frames.push({time:event.metadata.timestamp,bytes:Buffer.from(event.data,'base64')});
    void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(() => {});
  });
  await clearSurfaces();
  await page.waitForTimeout(500);
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:411,maxHeight:905,everyNthFrame:1});
  const started = Date.now();
  async function step(name, action, hold = 850) {
    timeline.push({name,atMs:Date.now()-started});
    if (action) await action();
    await page.waitForTimeout(hold);
  }
  await step('chat');
  await step('reading-navigation',() => page.evaluate(() => showChatNavigation()));
  await step('drawer-open',() => page.evaluate(() => {hideChatNavigation();setSidebarOpen(true);}));
  await step('drawer-close',() => page.evaluate(() => setSidebarOpen(false)));
  await step('chat-tools',() => page.locator('#chat-tools-toggle').click());
  await step('dialog-open',() => page.evaluate(() => {closeChatTools();openCardSettings();}));
  await step('dialog-interrupted',async () => {
    await page.evaluate(() => closeModal('card-settings-modal'));
    await page.waitForTimeout(75);
    await page.evaluate(() => openModal('card-settings-modal'));
  });
  await step('dialog-close',() => page.evaluate(() => closeModal('card-settings-modal')));
  await step('settings-page',() => page.locator('#bottom-nav [data-page=settings]').click());
  await step('settings-parameters',() => page.locator('.settings-tabs button').nth(1).click());
  await step('settings-api',() => page.locator('.settings-tabs button').first().click());
  await step('selector-open',() => page.locator('#s-provider-select-control').click());
  await step('selector-close',() => page.keyboard.press('Escape'),500);
  await step('chat-return',() => page.locator('#bottom-nav [data-page=chat]').click());
  await step('message-actions',() => page.evaluate(() => toggleMessageActions(2)));
  await step('composer-grow',() => page.locator('#user-input').fill('沿着山路慢慢走。\n听她说灯塔的故事。\n等一阵晚风。\n再去镇上看看。'));
  await step('composer-shrink',() => page.locator('#user-input').fill('走慢一点吧。'));
  await step('light-theme',() => page.evaluate(() => {document.activeElement.blur();applyTheme('light');}),1200);
  await step('dark-theme',() => page.evaluate(() => applyTheme('dark')),1200);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  assert(frames.length > 10,'motion preview must contain captured browser frames');
  const duration = (Date.now()-started)/1000, fps = 30;
  const encoder = spawn(process.env.FFMPEG_PATH || 'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','20','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-pix_fmt','yuv420p','-movflags','+faststart',path.join(output,'motion-preview.mp4')],{windowsHide:true});
  let encodingError = '';
  encoder.stderr.on('data',data => {encodingError += data;});
  const completed = once(encoder,'close');
  let frameIndex = 0;
  for (let index = 0; index < Math.ceil(duration*fps); index++) {
    while (frameIndex+1 < frames.length && frames[frameIndex+1].time-frames[0].time <= index/fps) frameIndex++;
    if (!encoder.stdin.write(frames[frameIndex].bytes)) await once(encoder.stdin,'drain');
  }
  encoder.stdin.end();
  const [code] = await completed;
  assert.strictEqual(code,0,encodingError);
  assert.deepStrictEqual(errors,[]);assert.deepStrictEqual(nativeDialogs,[]);
  fs.writeFileSync(path.join(output,'timeline.json'),JSON.stringify({device:device.id,fixtureData:true,environment:'Local Edge screencast; encoded at 30 fps, not a device performance measurement',duration,capturedFrames:frames.length,timeline,errors,nativeDialogs},null,2));
  console.log(JSON.stringify({output,video:'motion-preview.mp4',duration,capturedFrames:frames.length,pageErrors:errors.length,nativeDialogs:nativeDialogs.length}));
}

// A synthetic scheme with `statCount` visible stats (negative, large and derived values among them) and a
// chain of `wheelCount` wheels; `ending` makes the last wheel finish the game instead of looping back.
function visualWheelDocument(title,statCount,wheelCount,ending) {
  const names = ['天赋','努力','经验值','成长消耗','装备倍率','战斗经验倍率','情报相性倍率','敌方战斗力','伤势','精神压力','高专信任','咒力总量'];
  const stats = Array.from({length:statCount},(_,index) => ({id:'s' + index,name:names[index] || '属性' + (index + 1),initial:index === 7 ? 260000 : index === 9 ? -7 : index === 2 ? 75 : (index % 5) * 3}));
  if (statCount > 4) stats.splice(4,0,{id:'score',name:'综合评价',initial:0,derived_formula:'s0 * 1200 + s1 * 800'});
  const effect = (index,step) => statCount ? [{stat_id:'s0',delta:1 + (index % 2)},{stat_id:'s' + Math.min(statCount - 1,1),delta:2.5},...(statCount > 9 ? [{stat_id:'s7',delta:12345 * (step + 1)},{stat_id:'s9',delta:-3}] : [])] : [];
  const wheels = Array.from({length:wheelCount},(_,step) => ({id:'w' + step,name:['入场时期','出身','术式','战斗','结局'][step % 5],description:'这一轮决定角色在这个阶段的走向。',default_next_wheel_id:step + 1 < wheelCount ? 'w' + (step + 1) : ending ? '' : 'w0',
    options:['死灭回游时期','涩谷事变之后','京都姐妹校交流会','百鬼夜行前夜'].map((label,index) => ({id:'o' + index,label,weight:[3,2,1,0.05][index],note:index % 2 ? '' : '角色以此为起点展开这一段经历，结果会写进人物志。',stat_effects:effect(index,step)}))}));
  return {type:'meme-auto-wheel-config',version:1,title,description:'转动每一轮，由结果共同写成这一次人生。',start_wheel_id:'w0',stats,wheels};
}
async function openVisualWheelGame(document,spins,patch) {
  await clearSurfaces();
  await page.evaluate(({document,spins,patch}) => {
    const scheme = YeyuWheelScheme.normalizeScheme(document);
    let progress = YeyuWheelScheme.createProgress(scheme,() => .3);
    for (let index = 0; index < spins && progress.currentWheelId; index++) {
      const wheel = YeyuWheelScheme.wheelById(scheme,progress.currentWheelId);
      progress = YeyuWheelScheme.commitSpin(scheme,progress,wheel.options[index % wheel.options.length].id,() => .3).progress;
    }
    Object.assign(progress,patch || {});
    const item = {id:'visual-' + document.title,document,progress};
    D.wheelSchemes = [item];
    openWheelSchemeGame(item);
  },{document,spins,patch});
}
async function captureWheelGameStates() {
  const many = visualWheelDocument('咒术转盘2威力加强版',35,3,false), huge = visualWheelDocument('百项数值压力方案',120,3,false);
  const few = visualWheelDocument('单轮盘小方案',2,1,false), none = visualWheelDocument('无数值方案',0,2,false), ending = visualWheelDocument('会结束的方案',12,2,true);
  const reasoning = ['这是一个转盘结果生成任务。我需要根据详细的转盘记录，生成一个完整的角色故事。','','让我先梳理关键信息：','- 入场时期：死灭回游时期','- 出身：羂索实验地点','- 身份：普通人→强制觉醒'].join('\n');
  const opening = '《涩谷的余烬》\n\n他在死灭回游开始的那个夜里醒来';
  for (const theme of ['dark','light']) {
    await page.evaluate(theme => applyTheme(theme),theme);
    await openVisualWheelGame(many,7); await capture(theme + '-wheel-active');
    await page.evaluate(() => toggleWheelSchemeStats()); await capture(theme + '-wheel-active-expanded');
    await openVisualWheelGame(huge,3); await page.evaluate(() => toggleWheelSchemeStats());
    await page.evaluate(() => { const panel = document.getElementById('wheel-game-stats'); panel.scrollTop = panel.scrollHeight / 2; }); await capture(theme + '-wheel-120-expanded');
    await openVisualWheelGame(few,2); await capture(theme + '-wheel-few');
    await openVisualWheelGame(none,1); await capture(theme + '-wheel-no-stats');
    await openVisualWheelGame(ending,2,{pendingBiography:true});
    await page.evaluate(reasoning => { _wheelSchemeBusy = true; renderWheelSchemeGame(); paintWheelSchemeBiographyProgress({content:'',reasoning}); },reasoning);
    await capture(theme + '-wheel-biography-thinking');
    await page.locator('#wheel-game-biography-live-reasoning summary').click(); await capture(theme + '-wheel-biography-thinking-open');
    await page.locator('#wheel-game-biography-live-reasoning summary').click();
    await page.evaluate(({reasoning,opening}) => paintWheelSchemeBiographyProgress({content:opening + '。',reasoning}),{reasoning,opening});
    await capture(theme + '-wheel-biography-writing');
    await page.evaluate(() => { _wheelSchemeBusy = false; resetWheelSchemeBiographyDraft(); });
    await openVisualWheelGame(ending,2,{biography:opening + '，手里只剩一枚写着陌生名字的护符。\n\n此后的每一转，都把他推向更深的夜。',status:'finished'});
    await capture(theme + '-wheel-finished');
    await openVisualWheelGame(ending,2,{pendingBiography:true,biographyError:'人物志达到输出上限，但没有返回正文。'}); await capture(theme + '-wheel-failed');
    await openVisualWheelGame(many,3,{currentWheelId:'',automaticError:'loop'}); await capture(theme + '-wheel-automatic-error');
    await openVisualWheelGame(many,7); await page.evaluate(() => spinWheelScheme()); await capture(theme + '-wheel-spin');
    await page.evaluate(() => spinWheelSchemeModal()); await page.locator('#wheel-scheme-spin-confirm').waitFor({state:'visible'}); await capture(theme + '-wheel-spin-result');
  }
}

(async () => {
  fs.mkdirSync(output,{recursive:true});
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({headless:true,executablePath:resolveEdgeExecutable()});
  page = await browser.newPage(device.browserContext);
  await installNativeSafeArea(page,device);
  page.on('pageerror',error => errors.push(String(error)));
  page.on('dialog',async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.route('https://**',route => route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
  await page.waitForFunction(() => typeof _appSelectReady !== 'undefined' && _appSelectReady);
  await page.waitForFunction(() => document.querySelector('#toasts .toast'));
  await page.waitForFunction(() => !document.querySelector('#toasts .toast'));
  await page.evaluate(() => { D.settings.themeMode = 'dark'; applyConfiguredTheme(); });
  if (!motionPreviewOnly && !wheelGameOnly) {
    await capture('01-empty-chat');
    await destination('02-empty-memory','memory');
    await destination('03-empty-settings','settings');
  }
  await page.evaluate(async ({picture,label,wheelDocument}) => {
    var image = picture;
    if (!image) {
      var canvas = document.createElement('canvas'); canvas.width = 411; canvas.height = 905;
      var context = canvas.getContext('2d'),gradient = context.createLinearGradient(0,0,411,905);
      (label === 'muted' ? ['#a6aaa7','#838b88','#4d5654'] : ['#10cbd4','#692fd5','#e52b83']).forEach((color,index) => gradient.addColorStop(index/2,color));
      context.fillStyle = gradient; context.fillRect(0,0,411,905); image = canvas.toDataURL();
    }
    window.visualImage = image;
    const char = {id:'workflow-char',name:'林间来信',description:'山径、晚风，以及尚未说完的故事。\n\n她住在灯塔镇，常常为旅人指路。',personality:'温和、细心，愿意倾听。',scenario:'雨后的山路通向灯塔镇。',first_mes:'雨停了。她收起伞，回头等你。\n\n“沿着山路走，就能看见灯塔。”',alternate_greetings:['风吹过书页，她抬起头向你微笑。','晚归的船只正在驶向港口。'],avatar_image:image,background_image:image,tags:['日常','探索'],creator_notes:'这是一段从山间开始的旅途。\n\n你可以从散步、书店或港口开始对话。',scriptsEnabled:false,extensions:{regex_scripts:[{id:'visual-regex',scriptName:'清理空白行',findRegex:'^never-match$',replaceString:'',placement:[2],disabled:false}],tavern_helper:{scripts:[{id:'visual-schema',name:'位置变量',enabled:true,type:'script',content:"import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\nregisterMvuSchema(z.object({location:z.string()}));"}],variables:{}}}};
    D.characters = [char]; D.currentCharId = char.id;
    D.personas = [{id:'workflow-persona',name:'远行者',description:'喜欢旅行与记录沿途的故事。',avatar_image:image,boundCharIds:[]}]; D.activePersonaId = 'workflow-persona';
    const session = createBlankSession('山径上的晚风','workflow-session'); session.greetingChosen = true;
    session.msgs = [{role:'assistant',seq:1,content:char.first_mes},{role:'user',seq:2,content:'我们走慢一点吧。想听你说说，那座灯塔的故事。'},{role:'assistant',seq:3,content:'“好呀。”她把步子放慢，与你并肩。\n\n灯塔已经亮了很多年，每当有人晚归，就会循着那束光找到回家的路。'}];session.nextMessageSeq = 4;
    D.chats = {[char.id]:{activeSid:session.id,sessions:[session]}};
    const store = ensureSessionMemoryStore(session);
    store.historySummary = {text:'你们在雨后的山路相遇，约定一起去灯塔镇。',active:true,startSeq:1,endSeq:2,updatedAt:Date.now()};
    store.longTermEntries = [memoryV5NormalizeLongTerm({id:'visual-memory',type:'relationship_change',content:'你们约定放慢脚步，一起听完灯塔的故事。',importance:4,confidence:.9,subject:'远行者',object:'林间来信',sourceStartSeq:1,sourceEndSeq:3,origin:'manual'},session.id)];
    D.worldBook.categories = [{id:'visual-worldbook',name:'灯塔镇',global:true,entries:[{id:'visual-entry',name:'旧灯塔',keys:['灯塔'],content:'灯塔坐落在镇北的山崖上，入夜后会为归航的船只点灯。',enabled:true}]}];
    D.wheelSchemes = [{id:'visual-wheel',document:wheelDocument,progress:YeyuWheelScheme.createProgress(YeyuWheelScheme.normalizeScheme(wheelDocument),() => .2)}];
    D.settings.regexScripts = [{id:'visual-global-regex',name:'整理显示空白',findRegex:'^never-match$',replaceString:'',enabled:true,targetAssistant:true,applyDisplay:true}];
    qrImportJson({name:'旅途快捷栏',qrList:[{id:1,label:'打个招呼',message:'/echo 你好',title:'显示问候',isHidden:false}]});
    updateChatUI(); renderChat(); renderCharList(); renderPersonaList(); renderWBSidebar(); renderWheelSchemeLibrary();
    applyCharBackground(char); await updateTokensBar(char); scrollChatToBottomAfterRender();
  },{picture,label,wheelDocument});
  await page.waitForTimeout(700);
  if (motionPreviewOnly) { await recordMotionPreview(); return; }
  if (wheelManagerOnly) {
    for (const theme of ['dark','light']) {
      await page.evaluate(theme => applyTheme(theme),theme);
      await modal(theme + '-wheel-manager',() => openWheelSchemeManager(), '#wheel-manager-modal.open');
      await page.evaluate(() => { const body = document.querySelector('#wheel-manager-modal .modal-body'); body.scrollTop = body.scrollHeight; }); await capture(theme + '-wheel-manager-end');
    }
    writeResults(); return;
  }
  if (wheelGameOnly) { await captureWheelGameStates(); writeResults(); return; }
  if (pageTabsOnly) {
    for (const theme of ['dark','light']) {
      await page.evaluate(theme => applyTheme(theme),theme);
      for (const key of ['presets','memory','settings']) {
        await destination(theme + '-' + key + '-top',key);
        if (key === 'settings') await page.locator('.settings-tabs button').nth(1).click();
        const scrolled = await page.evaluate(() => {
          const page = document.querySelector('.app-page.open'), tabs = page.querySelector('.page-tabs');
          const body = page.querySelector('.preset-tab-panel:not([hidden])') || page.querySelector('.modal-body');
          body.scrollTop = body.scrollHeight;
          return {tabBottom:tabs.getBoundingClientRect().bottom,bodyTop:page.querySelector('.modal-body').getBoundingClientRect().top};
        });
        assert(scrolled.tabBottom <= scrolled.bodyTop,'section bar must stay outside the scrolling body');
        await capture(theme + '-' + key + '-scrolled');
      }
    }
    writeResults(); return;
  }
  await clearSurfaces(); await capture('04-chat');
  await destination('05-presets','presets',() => switchCompletionPresetTab('manage'));
  await destination('06-memory','memory',() => switchMemoryTab('overview',document.querySelector('.memory-tabs button')));
  await destination('07-settings','settings',() => switchSettingsTab('api',document.querySelector('.settings-tabs button')));
  await page.locator('#s-provider-select-control').click(); await capture('08-select-open'); await page.keyboard.press('Escape');

  if (label === 'daylight' || label === 'generated') {
    for (const [index,key] of ['params','translation','appearance','regex','qr'].entries()) {
      await clearSurfaces(); await page.locator('#bottom-nav [data-page=settings]').click();
      await page.locator('.settings-tabs button').nth(index+1).click();
      await page.locator('#settings-modal .modal-body').evaluate(node => {node.scrollTop=0;});
      await capture('10-' + (index + 1) + '-settings-' + key);
    }
    await destination('11-preset-order','presets',() => switchCompletionPresetTab('order'));
    await destination('12-preset-note','presets',() => switchCompletionPresetTab('note'));
    await destination('13-preset-utility','presets',() => switchCompletionPresetTab('utility'));
    await destination('14-memory-settings','memory',() => switchMemoryTab('settings',document.querySelectorAll('.memory-tabs button')[1]));
    await modal('15-card-settings',() => openCardSettings(), '#card-settings-modal.open');
    await page.locator('#card-settings-modal .modal-body').evaluate(node => {node.scrollTop=node.scrollHeight;}); await capture('16-card-settings-mvu');
    await modal('17-character-editor',() => { editCharacter(getChar().id); }, '#create-modal.open');
    await modal('18-persona-editor',() => { editPersona('workflow-persona'); }, '#persona-modal.open');
    await modal('19-persona-crop',() => beginPersonaCrop(window.visualImage,'persona'), '#persona-crop-modal.open');
    await modal('20-regex-editor',() => openRegexScriptEditor(), '#regex-script-editor-modal.open');
    await page.locator('#regex-script-find').fill('['); await capture('21-regex-warning');
    await modal('22-memory-editor',() => editMemoryV5Entry('visual-memory'), '#memory-entry-modal.open');
    await modal('23-prompt-editor',() => { openModal('prompt-manager-modal'); addCompletionPresetPrompt(); }, '#prompt-entry-modal.open');
    await modal('24-worldbook-list',() => openModal('wb-modal'), '#wb-modal.open');
    await page.evaluate(() => openWBEditor('visual-worldbook')); await capture('25-worldbook-editor');
    await page.evaluate(() => openWBSection('settings')); await capture('26-worldbook-settings');
    await page.evaluate(() => openWBSection('import')); await capture('27-worldbook-import');
    await modal('28-card-import',() => openModal('import-modal'), '#import-modal.open');
    await page.locator('#import-modal .tabs button').nth(1).click(); await page.locator('#paste-json').fill('{');
    await capture('29-card-import-paste');
    await page.evaluate(() => openSidebarTab('wheels')); await capture('32-wheel-library');
    await modal('47-wheel-manager',() => openWheelSchemeManager(), '#wheel-manager-modal.open');
    await page.evaluate(() => { const body = document.querySelector('#wheel-manager-modal .modal-body'); body.scrollTop = body.scrollHeight; }); await capture('47-wheel-manager-end');
    await modal('33-story-direction',() => openLatestStoryObjective(), '#story-objective-modal.open');
    await modal('34-statistics-empty',() => openLatestTurnStatistics(), '#turn-statistics-modal.open');
    await modal('35-message-editor',() => editMessage(2), '#edit-msg-modal.open');
    await modal('36-session-name',() => renameSession('workflow-session'), '#rename-session-modal.open');
    await modal('37-greetings',() => {chooseGreeting(getChar());}, '#greeting-modal.open');
    await modal('38-creator-notes',() => {showCreatorNotesBeforeChat(getChar());}, '#creator-notes-modal.open');
    await modal('39-confirmation',() => {appConfirm('确定删除这条辅助记忆？删除后不会再用于后续对话。','删除辅助记忆','删除');}, '#app-prompt-modal.open');
    await modal('40-text-input',() => {appInput('给这次旅途起一个名字。','山径上的晚风','对话名称','名称');}, '#app-prompt-modal.open');
    await modal('41-choice-input',() => {appInput('选择这条记忆的类别。','关键事件','辅助记忆类型','类型',{choices:['人物信息','关系变化','关键事件']});}, '#app-prompt-modal.open');
    await page.locator('#app-prompt-choice .prompt-choice').first().click(); await capture('42-choice-selected');
    await modal('43-script-choices',() => {stscriptPromptButtons(['去灯塔看看','在镇上休息','沿着海边散步']);}, '#stscript-choice-modal.open');
    await modal('44-memory-progress',() => showMemoryJob('整理较早对话','正在更新历史摘要…'), '#memory-progress-modal.open');
    await modal('45-import-progress',() => {showImportProgress('导入角色卡','正在整理世界书',4); updateImportProgress('正在整理世界书','已完成 2 / 4 项',true);}, '#import-progress-modal.open');
    await modal('46-branch-preview',() => {openModal('branch-merge-modal');document.getElementById('branch-merge-summary').textContent='选择要带回父对话的内容。';document.getElementById('branch-merge-preview').innerHTML=branchReturnModeChoiceHtml({});}, '#branch-merge-modal.open');
    await clearSurfaces(); await page.evaluate(() => openWheelSchemeGame(D.wheelSchemes[0])); await capture('48-wheel-game');
    await page.evaluate(() => spinWheelScheme()); await capture('49-wheel-spin');
    await clearSurfaces();
    await page.evaluate(() => {document.querySelector('.tokens-details').open=true;}); await capture('50-context-unlimited');
    await page.evaluate(async () => {D.settings.maxContextTokens=4096;await updateTokensBar(getChar());}); await capture('51-context-limited');
    await modal('61-dependency-expanded',() => {openCardSettings();document.querySelector('.card-dependency-details').open=true;}, '#card-settings-modal.open');
    await page.evaluate(() => {document.querySelector('.mvu-variable-details').open=true;document.querySelector('.mvu-variable-details').scrollIntoView({block:'center'});}); await capture('62-mvu-variables');
    await modal('63-worldbook-invalid',() => {openModal('wb-modal');openWBSection('settings');document.getElementById('wb-vector-score-threshold').value='2';saveWBSettings();}, '#wb-modal.open');
    await page.locator('#wb-settings .field-error').scrollIntoViewIfNeeded(); await capture('64-worldbook-error');
    await clearSurfaces();
    await page.evaluate(() => {tavernAudioRuntime('bgm').src='ui-fixture:forest';tavernAudioRuntime('bgm').title='林间晚风';_cardBgmPanelOpen=true;refreshCardBgmUi();});
    await capture('65-audio-player');
    await page.locator('#card-bgm-mode-control').click(); await capture('66-audio-select');
    await clearSurfaces();
    await page.evaluate(() => {
      window.uiPreviousHelper=getChar().extensions.tavern_helper;
      getChar().extensions.tavern_helper={scripts:[{id:'ui-noop',name:'界面检查',type:'script',enabled:true,content:'window.uiFixtureReady = true;'}],variables:{}};
      getChar().scriptsEnabled=true;openCardSettings();openCurrentCardScriptLibrary();
    });
    await page.waitForFunction(() => _cardScriptLibraryLive?.state === 'ready'); await capture('67-script-library');
    await page.evaluate(() => {appConfirm('关闭这个提示后继续查看脚本库。','脚本提示','继续');}); await capture('68-library-confirmation');
    await clearSurfaces();
    await page.evaluate(() => {cardScriptLibraryDispose();getChar().extensions.tavern_helper=window.uiPreviousHelper;getChar().scriptsEnabled=false;});
  }

  await clearSurfaces(); await page.evaluate(() => applyTheme('light')); await capture('52-chat-light');
  await destination('53-presets-light','presets',() => switchCompletionPresetTab('manage'));
  await destination('54-memory-light','memory',() => switchMemoryTab('overview',document.querySelector('.memory-tabs button')));
  await destination('55-settings-light','settings',() => switchSettingsTab('appearance',document.querySelectorAll('.settings-tabs button')[3]));
  await page.locator('#s-theme-mode-control').click(); await capture('56-select-light'); await page.keyboard.press('Escape');
  await modal('57-card-settings-light',() => openCardSettings(), '#card-settings-modal.open');
  await modal('58-confirmation-light',() => {appConfirm('确定删除这条辅助记忆？','删除辅助记忆','删除');}, '#app-prompt-modal.open');
  await clearSurfaces();
  await destination('59-settings-keyboard','settings',() => switchSettingsTab('api',document.querySelector('.settings-tabs button')));
  await page.locator('#s-provider-name').focus(); await page.evaluate(() => window.__yeyuImeInsets(true,1120,3168,3168)); await capture('60-keyboard-layout');
  await page.evaluate(() => {document.activeElement.blur();window.__yeyuImeInsets(false,0,3168,3168);});
  await clearSurfaces();
  await page.evaluate(() => showStorageRecoveryScreen(new Error('读取本地数据库失败，请重新尝试。'))); await capture('69-storage-recovery');
  writeResults();
})().catch(error => {console.error(error);process.exitCode=1;}).finally(async () => {
  if(browser) await browser.close(); if(server) await new Promise(resolve => server.close(resolve));
});
