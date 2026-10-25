'use strict';
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {archive, files, card, image, background} = require('../fixtures/charx_fixture');
const {waitForAppReady} = require('./helpers/app-ready');
const inFolder = prefix => Object.fromEntries(Object.entries(files).map(([name, data]) => [prefix + name, data]));
const pathEdgeCard = {...card, data:{...card.data, assets:[
  card.data.assets[1],
  {type:'background', name:'dot-prefixed', uri:'embedded://folder/../..notes.txt', ext:'png'},
  {type:'emotion', name:'outside', uri:'embedded://../escape.png', ext:'png'},
]}};
const root = path.resolve(__dirname, '../..'), assets = path.join(root, 'app/src/main/assets');
let browser, server;
(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
  const page = await browser.newPage({viewport:{width:450,height:974}});
  const errors=[]; page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  const result=await page.evaluate(async ({archives,invalidArchives,failures,noBackground,extFallback,dotExt,noDotExt,iconOnly,iconMissing,nested,shadowed,pathEdges,expected,image,background})=>{
    const assert=(ok,message)=>{if(!ok)throw new Error(message);};
    const auditNotes=card=>cardImportAuditItems(card).notes;
    let imported;
    for (const data of archives) {
      imported=await readCHARX(new File([new Uint8Array(data)],'测试.charx'));
      assert(imported.name===expected.data.name,'card fields');
      assert(JSON.stringify(imported.importMeta.rawCard)===JSON.stringify(expected),'raw card fidelity');
      assert(imported.media_assets.filter(a=>a.kind==='ccv3_asset').length===4,'CHARX keeps missing image declarations and stores audio assets: '+JSON.stringify(imported.media_assets.map(a=>({id:a.id,name:a.name,type:a.assetType,status:a.status}))));
      assert(imported.media_assets.some(a=>a.name==='missing'&&a.status==='unavailable'),'missing declared image marker');
      assert(imported.background_image==='data:image/png;base64,'+background,'background bytes');
      assert(!String(imported.importMeta.sourceAvatar).startsWith('data:'),'no inline avatar metadata');
      assert(imported.avatar_image==='data:image/png;base64,'+image,'main icon selection');
      assert(imported.media_assets.find(a=>a.assetType==='emotion').name==='Happy.png','sprite preserved');
      assert(imported.media_assets.some(a=>a.name==='sound'&&a.status==='ready'&&a.mime==='audio/wav'&&a.blob),'CHARX 音频素材必须入库');
    }
    assert(YeyuCharx.normalizePath('..notes.txt')==='..notes.txt' && YeyuCharx.normalizePath('folder/../..notes.txt')==='..notes.txt', '点前缀文件名不是父目录跳转');
    assert(YeyuCharx.normalizePath('../outside.png')===null && YeyuCharx.normalizePath('folder/../../outside.png')===null && YeyuCharx.normalizePath('/')===null, '真正越界和空路径须跳过');
    const edge=await readCHARX(new File([new Uint8Array(pathEdges)],'paths.charx'));
    assert(edge.background_image==='data:image/png;base64,'+background, '坏 ZIP 条目不能阻止合法点前缀素材与整卡导入');
    assert(edge.media_assets.some(a=>a.name==='outside'&&a.status==='unavailable'), '越界素材不得读取');
    D=defaults();
    const item=initializeCardForImport(imported);
    item.id='charx-test';
    D.characters=[item]; D.currentCharId=item.id;
    await saveData(['characters','meta']);
    const stored=(await YeyuRepository.load()).data;
    const saved=stored.characters.find(c=>c.id===item.id);
    assert(saved.media_assets.filter(a=>a.mediaKey).length===3,'media owner persistence');
    assert(JSON.stringify(saved.rawCard||saved.importMeta.rawCard)===JSON.stringify(expected),'raw stored');
    const db=await YeyuRepository.open();
    const mediaBlobs=await new Promise((resolve,reject)=>{const request=db.transaction('media','readonly').objectStore('media').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    db.close();
    const encoded=await Promise.all(mediaBlobs.map(blob=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);})));
    assert(encoded.filter(data=>data==='data:image/png;base64,'+image).length===1,'avatar bytes stored exactly once');
    assert(encoded.filter(data=>data==='data:image/png;base64,'+background).length===1,'background bytes stored exactly once');
    assert(saved._media.background_image===saved.media_assets.find(a=>a.assetType==='background').mediaKey,'background owners share one media key');
    D=stored;
    await hydrateReferencedCardAssets(saved,[saved.first_mes]);
    const rendered=document.createElement('div');
    rendered.innerHTML=md(saved.first_mes,{preserveImages:true,mediaAssets:saved.media_assets,role:'assistant'});
    assert(rendered.querySelector('img') && rendered.querySelector('img').src.startsWith('blob:'),'embedded URI display');
    assert(isRisuCharacter(saved) && YeyuExpressionAssets.bindings(saved).length===0,'Risu keeps standard emotion assets without ST automatic binding');
    assert(saved.media_assets.some(a=>a.assetType==='other'&&a.name==='missing'&&a.status==='unavailable'),'generic missing image stays generic after reload');
    const originalBackgroundKey=saved.media_assets.find(a=>a.assetType==='background').mediaKey;
    saved.background_image='data:image/png;base64,'+image;
    await saveData('characters',{urgent:true});
    assert(await YeyuRepository.loadMediaValue(originalBackgroundKey)==='data:image/png;base64,'+background,'replacing display background preserves embedded asset bytes');
    saved.background_image='data:image/png;base64,'+background;
    await saveData('characters',{urgent:true});
    const original=JSON.stringify(D);
    const oldError=console.error;console.error=()=>{};
    try { await handleFileImport({target:{files:[new File([new Uint8Array([80,75,3,4])],'broken.charx')],value:''}}); }
    finally {console.error=oldError;}
    assert(pending.length===0 && JSON.stringify(D)===original,'broken archive atomicity');
    assert(document.body.textContent.includes('CHARX ZIP'),'拒绝 CHARX 必须有明确提示');
    assert(JSON.stringify(saved.importMeta.rawCard.data.extensions.risuai)===JSON.stringify(expected.data.extensions.risuai),'Risu 私有材料必须原样保留');
    const risuItems=analyzeCardDependencies(saved).items.filter(row=>row.evidence.some(proof=>/risu/i.test(proof.source)));
    assert(['risu-core','risu-module','risu-display'].every(id=>risuItems.some(row=>row.id===id && row.group==='ready')),'模块与卡片演出应报告已接入的独立 Risu 能力');
    for(const data of invalidArchives) {
      let failure=false;
      try {await readCHARX(new File([new Uint8Array(data)],'invalid.charx'));} catch(error) {failure=true;}
      assert(failure && JSON.stringify(D)===original,'invalid card rejected without writes');
    }
    for (const [data, expectedError] of failures) {
      let message = '';
      try { await readCHARX(new File([new Uint8Array(data)], 'invalid.charx')); } catch (error) { message = error.message; }
      assert(message.includes(expectedError), 'archive rejection: ' + expectedError + ' got ' + message);
    }
    const derived = await readCHARX(new File([new Uint8Array(noBackground)],'derived.charx'));
    assert(derived.avatar_image && !derived.background_image && derived.importMeta.backgroundPresentation==='avatar-derived','avatar-derived fallback');
    const onlyIcon = await readCHARX(new File([new Uint8Array(iconOnly)],'icon-only.charx'));
    assert(onlyIcon.importMeta.embeddedCardImage && onlyIcon.avatar_image.startsWith('data:image/png;base64,') &&
      !cardImportUnsupportedItems(onlyIcon).some(item=>/0 项可解析/.test(item)), 'CHARX 已声明且读出的主 icon 不得误报零解析');
    const noIcon = await readCHARX(new File([new Uint8Array(iconMissing)], 'missing-icon.charx'));
    assert(!noIcon.avatar_image && !noIcon.importMeta.embeddedCardImage && cardImportUnsupportedItems(noIcon).some(item=>item.includes('「主头像」')&&item.includes('默认头像')), '主头像缺失时按 ST 回退默认头像并在导入报告提示');
    for (const data of nested) {
      const inFolder = await readCHARX(new File([new Uint8Array(data)], 'folder.charx'));
      assert(inFolder.avatar_image==='data:image/png;base64,'+image && inFolder.background_image==='data:image/png;base64,'+background && inFolder.extensions.yeyu.risuModule.name==='测试模块', 'card.json 在子目录时素材与模块按其所在目录找到');
      assert(inFolder.media_assets.some(a=>a.name==='sound'&&a.status==='ready') && auditNotes(inFolder).some(note=>note.includes('1 项音频或视频')), '子目录音频入库并在报告披露数量');
    }
    const rootFirst = await readCHARX(new File([new Uint8Array(shadowed)], 'shadowed.charx'));
    assert(rootFirst.avatar_image==='data:image/png;base64,'+background, '根目录与 card.json 目录同名时先取根目录');
    const extension = await readCHARX(new File([new Uint8Array(extFallback)],'ext.charx'));
    assert(extension.media_assets.filter(asset=>asset.status==='ready').length===3 && extension.media_assets.some(asset=>asset.name==='missing'&&asset.status==='unavailable') && extension.background_image.endsWith(background),'empty ext fallback');
    const dotted = await readCHARX(new File([new Uint8Array(dotExt)],'dot.charx'));
    assert(dotted.media_assets.filter(asset=>asset.kind==='ccv3_asset').length===1 && dotted.media_assets[0].status==='unavailable' && !dotted.background_image,'点文件路径没有扩展名，缺 ext 时只保留缺失声明，不得伪造已导入图片');
    const suffix = await readCHARX(new File([new Uint8Array(noDotExt)],'suffix.charx'));
    assert(suffix.media_assets.filter(asset=>asset.kind==='ccv3_asset').length===1 && suffix.background_image==='data:image/png;base64,'+background,'缺 ext 时仍按路径后缀导入');
    const helperSession=createBlankSession('CHARX helper');
    D.chats[item.id]={sessions:[helperSession],activeSid:helperSession.id}; D.currentCharId=item.id;
    const live={charId:item.id,owner:{sessionId:helperSession.id}};
    await hostImportCharacter(live,'辅助.CHARX',new Blob([new Uint8Array(archives[2])]));
    const helperCard=D.characters.find(row=>row.name==='辅助');
    assert(helperCard && helperCard._media.avatar_image && helperCard.media_assets.length===4,'helper CHARX import transaction');
    const savedDecompressor=window.DecompressionStream;
    window.DecompressionStream=undefined;
    try {
      let message='';try {await readCHARX(new File([new Uint8Array(archives[0])],'compressed.charx'));}catch(error){message=error.message;}
      assert(message.includes('更新 WebView'),'unsupported platform guidance');
      assert((await readCHARX(new File([new Uint8Array(archives[1])],'stored.charx'))).name===expected.data.name,'store independent of deflate');
    } finally {window.DecompressionStream=savedDecompressor;}
    return {variants:archives.length,availableAssets:2,missingAssets:1,rawFields:true,mediaPersistence:true,malformedAtomicity:true};
  },{archives:[archive(files),archive(files,{store:true}),archive(files,{prefix:'JPEG prefix'}),archive(files,{zip64:true}),archive(files,{zip64:true,prefix:'JPEG prefix',fakeSignature:true}),archive({'assets/backup-card.json':'invalid', ...files})].map(b=>Array.from(b)),invalidArchives:[archive({'other.json':'{}'}),archive({'card.json':'{}'}),archive({'card.json':'not JSON'})].map(b=>Array.from(b)),dotExt:[...archive({...files,'assets/.png':background,'card.json':JSON.stringify({...card,data:{...card.data,first_mes:'占位',assets:[{type:'icon',name:'main',uri:'embedded://assets/main.png',ext:'png'},{type:'background',name:'点名背景',uri:'embedded://assets/.png',ext:''},]}})})],noDotExt:[...archive({...files,'assets/bg.png':background,'card.json':JSON.stringify({...card,data:{...card.data,first_mes:'占位',assets:[{type:'icon',name:'main',uri:'embedded://assets/main.png',ext:'png'},{type:'background',name:'普通背景',uri:'embedded://assets/bg.png',ext:''},]}})})],iconOnly:[...archive({'card.json':JSON.stringify({...card,data:{...card.data,assets:[card.data.assets[1]]}}),'assets/main.png':image})],iconMissing:[...archive({'card.json':JSON.stringify({...card,data:{...card.data,assets:[card.data.assets[1]]}})})],nested:[archive(inFolder('MyChar/')),archive(inFolder('外层/角色/'))].map(b=>Array.from(b)),shadowed:[...archive({...inFolder('MyChar/'),'assets/main.png':background})],pathEdges:[...archive({'/':'', '../escape.png':background, 'folder/../../escape.png':background, '..notes.txt':background, 'assets/main.png':image, 'card.json':JSON.stringify(pathEdgeCard)})],failures:[[archive(files,{badCrc:true}),'CRC'],[archive(files,{sizes:{'card.json':1}}),'声明大小'],[archive(files,{sizes:{'card.json':33*1024*1024}}),'文件长度不符'],[archive(files,{flags:0}),'UTF-8'],[archive(files,{flags:0x801}),'加密'],[archive(files,{nameBytes:{'card.json':Buffer.from([0xff])}}),'CHARX 文件名不是 UTF-8']].map(([b,error])=>[[...b],error]),noBackground:[...archive({...files,'card.json':JSON.stringify({...card,data:{...card.data,assets:card.data.assets.filter(a=>a.type!=='background')}})})],extFallback:[...archive({...files,'card.json':JSON.stringify({...card,data:{...card.data,assets:card.data.assets.map(a=>({...a,ext:a.type==='background'?' . ':a.type==='emotion'?'   ':a.ext}))}})})],expected:card,image:image.toString('base64'),background:background.toString('base64')});
  assert.deepStrictEqual(errors,[]);
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
