'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assetsRoot = path.join(root, 'app/src/main/assets');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/character_card_v3_full.json'), 'utf8'));
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  const chromium = loadPlaywright().chromium;
  browser = await chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage();
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'language', {configurable: true, get: () => 'zh-CN'}));
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  assert.strictEqual(response.headers()['cache-control'], 'no-store');
  await waitForAppReady(page, {timeout: 15000});

  const result = await page.evaluate(async ({fullFixture}) => {
    function assert(condition, message) { if (!condition) throw new Error(message || 'CCv3 L2 浏览器断言失败'); }
    function concatBytes(parts) {
      const length = parts.reduce((total, part) => total + part.length, 0);
      const output = new Uint8Array(length);
      let offset = 0;
      parts.forEach(part => { output.set(part, offset); offset += part.length; });
      return output;
    }
    function pngChunk(type, data) {
      const output = new Uint8Array(12 + data.length);
      new DataView(output.buffer).setUint32(0, data.length, false);
      output.set(new TextEncoder().encode(type), 4);
      output.set(data, 8);
      return output;
    }
    function textChunk(name, card) {
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(card))));
      return pngChunk('tEXt', new TextEncoder().encode(name + '\0' + encoded));
    }
    function rawTextChunk(name, value) {
      return pngChunk('tEXt', new TextEncoder().encode(name + '\0' + value));
    }
    D = defaults();
    D.settings.useMemory = false;
    D.settings.systemTpl = '';
    D.settings.postHistory = '';
    D.settings.authorsNote = '';

    const card = parseCard(fullFixture);
    card.extensions = Object.assign({}, card.extensions, {
      yeyu: Object.assign({}, card.extensions && card.extensions.yeyu, {componentImportMode: 'basic'})
    });
    card.scriptsEnabled = false;
    card.id = 'ccv3-l2-full';
    ensureCharacterIntelligence(card);
    assert(card.nickname === 'Ali');
    assert(card.creator_notes_display === '用于验证多语言作者注记。');
    assert(card.source.length === 2 && !Object.prototype.hasOwnProperty.call(card, 'group_only_greetings'));
    assert(!card.alternate_greetings.includes('The whole party is here!'));

    const lateWorldBookCard = parseCard(JSON.parse(JSON.stringify(fullFixture)));
    lateWorldBookCard.character_book.entries = Array.from({length: 301}, (_, index) => ({
      id: index,
      content: index === 300 ? '后部世界书成员资料' : '普通资料',
      participants: index === 300 ? ['后位成员'] : [],
    }));
    lateWorldBookCard.participantRegistry = null;
    lateWorldBookCard.participantRegistryVersion = 0;
    ensureCharacterIntelligence(lateWorldBookCard);
    assert(lateWorldBookCard.participantRegistry.some(item => item.canonicalName === '后位成员'), '角色卡世界书后部条目不得因隐藏扫描条数而漏读');

    D.characters = [card];
    D.currentCharId = card.id;
    D.chats[card.id] = {sessions: [], activeSid: null};
    getActiveSession(card.id);
    D.worldBook.categories = [];
    D.worldBook.globalCategoryIds = [];
    const importedEntries = importCharacterBookForCharacter(card);
    assert(importedEntries === 3);
    // Regex keys are answered by the terminable regex Worker, so the caller drains
    // the miss list and lets the Worker fill it before reading the final activation.
    resetWorldBookRegexKeyScope();
    let resolved = null;
    for (let guard = 0; guard < 4; guard += 1) {
      resolved = resolveWorldBook([{text: '旅行者拔出了 sword。', role: 'user', seq: 1}], card.id, {id: 'ccv3-l2-session', msgs: [{role: 'user'}]});
      const misses = worldBookRegexKeyMisses();
      if (!misses.length) break;
      await prepareWorldBookRegexKeys(card, misses);
    }
    const depthRows = resolved.inChat.get(4) || [];
    assert(depthRows.some(row => row.role === 'assistant' && row.content.includes('Starfall')));
    const promptText = [resolved.beforeChar, resolved.stableBeforeChar, resolved.afterChar, resolved.stableAfterChar, resolved.beforeUser]
      .concat(Array.from(resolved.inChat.values()).flat().map(row => row.content)).join('\n');
    assert(promptText.includes('Always active lore.'));
    assert(!promptText.includes('Must not enter the prompt.') && !promptText.includes('@@'));

    const v2 = {spec: 'chara_card_v2', spec_version: '2.0', data: {name: 'Wrong V2', description: 'legacy'}};
    const dualPng = concatBytes([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      textChunk('chara', v2),
      textChunk('ccv3', fullFixture),
      pngChunk('IEND', new Uint8Array()),
    ]);
    const pngCard = await readPNG(new File([dualPng], 'dual-v3.png', {type: 'image/png'}));
    assert(pngCard.name === 'Alice' && pngCard.nickname === 'Ali');
    const trailingPng = concatBytes([dualPng, new Uint8Array(64).fill(0x41)]);
    const trailingCard = await readPNG(new File([trailingPng], 'trailing-v3.png', {type: 'image/png'}));
    assert(trailingCard.name === 'Alice' && trailingCard.nickname === 'Ali', 'IEND 之后的多余字节不得阻断 PNG 角色卡读取');
    URL.revokeObjectURL(trailingCard.avatar_image);
    const firstCharaPng = concatBytes([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      textChunk('chara', {spec: 'chara_card_v2', spec_version: '2.0', data: {name: '第一块', character_book: {entries: [{keys: ['雾城'], content: '第一块的世界书'}]}}}),
      textChunk('chara', {spec: 'chara_card_v2', spec_version: '2.0', data: {name: '第二块'}}),
      pngChunk('IEND', new Uint8Array()),
    ]);
    const firstCharaCard = await readPNG(new File([firstCharaPng], 'two-chara.png', {type: 'image/png'}));
    assert(firstCharaCard.name === '第一块' && firstCharaCard.character_book.entries.length === 1, '双 chara PNG 必须完整读取文件中的第一个块');
    URL.revokeObjectURL(firstCharaCard.avatar_image);

    async function deflate(bytes) {
      return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    }
    async function compressedTextPng(type, card) {
      const keyword = new TextEncoder().encode('chara\0');
      const header = type === 'zTXt' ? new Uint8Array([0]) : new Uint8Array([1, 0, 0, 0]);
      const chunk = pngChunk(type, concatBytes([keyword, header, await deflate(new TextEncoder().encode(JSON.stringify(card)))]));
      return new File([concatBytes([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk, pngChunk('IEND', new Uint8Array())])], type + '.png', {type: 'image/png'});
    }
    const compressedCard = {spec: 'chara_card_v2', spec_version: '2.0', data: {name: '压缩文本角色', description: '正常角色卡'}};
    for (const type of ['zTXt', 'iTXt']) {
      const compressed = await readPNG(await compressedTextPng(type, compressedCard));
      assert(compressed.name === '压缩文本角色', type + ' 压缩文本块里的角色卡必须可读');
      URL.revokeObjectURL(compressed.avatar_image);
    }
    const oversizedCard = {spec: 'chara_card_v3', spec_version: '3.0', data: {name: '超过旧阈值的角色', description: 'A'.repeat(8 * 1024 * 1024)}};
    const oversizedPng = await readPNG(await compressedTextPng('zTXt', oversizedCard));
    const oversizedText = JSON.stringify(oversizedCard);
    assert(oversizedPng.name === oversizedCard.data.name && parseCharacterCardJsonText(oversizedText).data.name === oversizedCard.data.name
      && parseEmbeddedCharacterText(oversizedText, 'blob:oversized').name === oversizedCard.data.name, '超大角色卡不得按体积拒绝读取');
    URL.revokeObjectURL(oversizedPng.avatar_image);
    const brokenJsonMessage = parse => { try { parse(); } catch (error) { return String(error && error.message || error); } return ''; };
    assert(/不是有效的 JSON/.test(brokenJsonMessage(() => parseCharacterCardJsonText('{ 不是 JSON'))), '坏掉的角色卡 JSON 必须给出能看懂的原因');
    assert(/不是有效的 JSON/.test(brokenJsonMessage(() => parseEmbeddedCharacterText('{ 不是 JSON', 'blob:broken'))), 'PNG 内嵌角色卡 JSON 坏掉时必须给出同样的说明');

    const assetPngDocument = JSON.parse(JSON.stringify(fullFixture));
    assetPngDocument.data.first_mes = '![embedded](https://example.com/embedded.webp)';
    assetPngDocument.data.assets = [{type:'image', name:'smirk', uri:'__asset:0', ext:'unknown'}, {type:'image', name:'legacy.webp', uri:'__asset:1', ext:'webp'}, {type:'icon', name:'main', uri:'ccdefault:', ext:'png'}];
    const webpHeader = String.fromCharCode(0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50);
    const assetPng = concatBytes([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      rawTextChunk('chara-ext-asset_0', btoa(webpHeader)),
      rawTextChunk('chara-ext-asset_:1', btoa(webpHeader)),
      textChunk('ccv3', assetPngDocument),
      pngChunk('IEND', new Uint8Array()),
    ]);
    const parsedAssetPng = await readPNG(new File([assetPng], 'embedded-assets.png', {type:'image/png'}));
    const brokenAssetPng = concatBytes([
      new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
      rawTextChunk('chara-ext-asset_0', btoa(webpHeader)),
      rawTextChunk('chara-ext-asset_:1', '%bad-base64!'),
      textChunk('ccv3', assetPngDocument), pngChunk('IEND', new Uint8Array()),
    ]);
    const partialCard = await readPNG(new File([brokenAssetPng], 'partial.png', {type:'image/png'}));
    assert(partialCard.name === parsedAssetPng.name && partialCard.media_assets.some(asset => asset.name === 'legacy.webp' && asset.status === 'unavailable'), '附属素材损坏不能拒绝主卡');
    assert(cardImportUnsupportedItems(partialCard).some(item => item.includes('legacy.webp')), '必须明确提示不可用素材');
    releasePendingImportUrls([partialCard]);

    const embeddedAssetRow = parsedAssetPng.media_assets.find(asset => asset.name === 'smirk');
    const legacyEmbeddedAssetRow = parsedAssetPng.media_assets.find(asset => asset.name === 'legacy.webp');
    assert(embeddedAssetRow && embeddedAssetRow.bytes instanceof Uint8Array && !embeddedAssetRow.data_url, '无冒号 PNG 扩展资产必须以二进制进入媒体管线');
    assert(embeddedAssetRow.mime === 'image/webp' && embeddedAssetRow.ext === 'webp', '未知扩展名必须从内嵌图片字节恢复类型');
    assert(legacyEmbeddedAssetRow && legacyEmbeddedAssetRow.bytes instanceof Uint8Array && !legacyEmbeddedAssetRow.data_url, '历史带冒号 PNG 扩展资产必须继续读取');
    const storedUri = 'risustored:' + 'a'.repeat(64);
    const storedDocument = {spec:'chara_card_v3', data:{name:'RisuRealm 资产卡', assets:[{type:'x-risu-asset', name:'Kneeling2.webp', uri:storedUri, ext:'webp'}], extensions:{risuai:{}}}};
    const storedPng = concatBytes([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      textChunk('ccv3', storedDocument),
      rawTextChunk(storedUri, btoa(webpHeader)),
      pngChunk('IEND', new Uint8Array()),
    ]);
    const storedCard = await readPNG(new File([storedPng], 'risurealm.png', {type:'image/png'}));
    const storedAsset = storedCard.media_assets.find(asset => asset.name === 'Kneeling2.webp');
    assert(storedAsset && storedAsset.status === 'ready' && storedAsset.bytes instanceof Uint8Array && storedAsset.mime === 'image/webp', 'RisuRealm PNG 资产须按 URI 查找同名文本块');
    assert(!cardImportUnsupportedItems(storedCard).some(item => /0 项可解析/.test(item)), '已有可读资产不得触发零解析提醒');
    const missingDocument = {spec:'chara_card_v3', data:{name:'缺失资产卡', assets:[{type:'x-risu-asset', name:'Fear1.webp', uri:storedUri, ext:'webp'}, {type:'x-risu-asset', name:'Fear2.webp', uri:'risustored:' + 'b'.repeat(64), ext:'webp'}], extensions:{risuai:{}}}};
    const missingPng = concatBytes([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), textChunk('ccv3', missingDocument), pngChunk('IEND', new Uint8Array())]);
    const missingCard = await readPNG(new File([missingPng], 'missing-assets.png', {type:'image/png'}));
    assert(cardImportUnsupportedItems(missingCard).some(item => /声明了 2 项资产，但 0 项可解析/.test(item)), '声明资产却零解析须明确提示数量');
    const jsonMissingCard = parseCard(missingDocument);
    assert(!jsonMissingCard.media_assets.some(asset => asset.status === 'ready' || asset.status === 'remote'), 'JSON 的 risustored URI 不得伪装为可读取或远程资产');
    assert(cardImportUnsupportedItems(jsonMissingCard).some(item => /声明了 2 项资产，但 0 项可解析/.test(item)), '无内嵌数据的 JSON 卡应提示零解析');
    const defaultIcon = {type:'icon', name:'main', uri:'ccdefault:', ext:'png'};
    for (const extensions of [{}, {risuai:{}}]) {
      const defaultIconDocument = {spec:'chara_card_v3', data:{name:'卡自身图标', assets:[defaultIcon], extensions}};
      const defaultIconCard = parseCard(defaultIconDocument);
      assert(!cardImportUnsupportedItems(defaultIconCard).some(item => /0 项可解析/.test(item)), '仅声明 ccdefault 图标的 ST/Risu V3 卡不得误报零解析');
    }
    const mixedIconCard = parseCard({spec:'chara_card_v3', data:{name:'图标与附加资产', assets:[defaultIcon, storedDocument.data.assets[0]], extensions:{risuai:{}}}});
    assert(cardImportUnsupportedItems(mixedIconCard).some(item => /声明了 1 项资产，但 0 项可解析/.test(item)), 'ccdefault 图标不计入声明数量，也不得掩盖真正缺失的附加资产');
    mixedIconCard.media_assets.find(asset => asset.id === 'ccv3_asset_1').status = 'ready';
    assert(!cardImportUnsupportedItems(mixedIconCard).some(item => /0 项可解析/.test(item)), '忽略默认图标时须保留附加资产原索引对应的稳定 ID');
    const iconDataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const iconJsonCard = parseCard({spec:'chara_card_v3', data:{name:'有效 icon', assets:[{type:'icon', name:'main', uri:iconDataUri, ext:'png'}]}});
    assert(iconJsonCard.avatar_image === iconDataUri && !cardImportUnsupportedItems(iconJsonCard).some(item=>/0 项可解析/.test(item)), 'JSON 已声明且实际解析为主头像的 icon 不得误报');
    const missingIconDocument = {spec:'chara_card_v3', data:{name:'PNG 失联 icon', assets:[{type:'icon', name:'main', uri:'risustored:' + 'c'.repeat(64), ext:'png'}]}};
    const missingIconPng = concatBytes([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), textChunk('ccv3', missingIconDocument), pngChunk('IEND', new Uint8Array())]);
    const missingIconCard = await readPNG(new File([missingIconPng], 'missing-icon.png', {type:'image/png'}));
    assert(cardImportUnsupportedItems(missingIconCard).some(item=>/声明了 1 项资产，但 0 项可解析/.test(item)), 'PNG 容器头像不得掩盖失联声明 icon');
    URL.revokeObjectURL(storedCard.avatar_image);
    URL.revokeObjectURL(missingCard.avatar_image);
    URL.revokeObjectURL(missingIconCard.avatar_image);
    embeddedAssetRow.sourceUrl = 'https://example.com/embedded.webp';
    parsedAssetPng.media_assets = parsedAssetPng.media_assets.filter(asset => asset.kind === 'ccv3_asset');
    await prepareCardAssetDimensions(embeddedAssetRow);
    const assetMarkup = document.createElement('div');
    assetMarkup.innerHTML = md(parsedAssetPng.first_mes, {preserveImages:true, mediaAssets:parsedAssetPng.media_assets, role:'assistant'});
    const renderedAssetImage = assetMarkup.querySelector('img');
    assert(renderedAssetImage && /^blob:/.test(renderedAssetImage.src), '标准 Markdown 图片引用必须渲染随卡资产');
    const embeddedAssetsBeforeSave = parsedAssetPng.media_assets.filter(asset => asset.kind === 'ccv3_asset').length;
    parsedAssetPng.media_assets = syncCharacterGreetingMediaAssets(parsedAssetPng, []);
    const embeddedAssetsAfterSave = parsedAssetPng.media_assets.filter(asset => asset.kind === 'ccv3_asset').length;
    assert(embeddedAssetsBeforeSave === 2 && embeddedAssetsAfterSave === 2, '首次保存必须保留两种关键词格式的 PNG 内嵌资产');

    const openingAsset = {id:'old-opening', kind:'opening', sourceUrl:'https://example.com/old.png', status:'ready', data_url:'data:image/png;base64,iVBORw0KGgo='};
    const greetingSyncCard = {first_mes:'![新开场](https://example.com/new.png)', alternate_greetings:[], media_assets:parsedAssetPng.media_assets.concat(openingAsset)};
    const firstGreetingSync = syncCharacterGreetingMediaAssets(greetingSyncCard, greetingSyncCard.media_assets);
    greetingSyncCard.media_assets = firstGreetingSync;
    const secondGreetingSync = syncCharacterGreetingMediaAssets(greetingSyncCard, firstGreetingSync);
    assert(firstGreetingSync.filter(asset => asset.kind === 'ccv3_asset').length === 2, '编辑开场白不得删除卡内嵌资产');
    assert(firstGreetingSync.filter(asset => asset.kind === 'opening').length === 1 && firstGreetingSync.some(asset => asset.sourceUrl === 'https://example.com/new.png'), '新开场白引用必须替换旧 opening 资产');
    assert(secondGreetingSync.length === firstGreetingSync.length, '重复编辑保存不得增减资产');

    parsedAssetPng.id = 'embedded-persisted-card';
    const persistedData = defaults();
    persistedData.characters = [parsedAssetPng];
    persistedData.chats = {[parsedAssetPng.id]: {sessions:[], activeSid:null}};
    await YeyuRepository.save(persistedData, {sections:['meta','characters','personas','worldbook','sessions','wheels']});
    const loadedState = await YeyuRepository.load();
    const reloadedAssetPng = loadedState.data.characters.find(character => character.id === parsedAssetPng.id);
    assert(reloadedAssetPng && reloadedAssetPng.media_assets.filter(asset => asset.kind === 'ccv3_asset' && asset.mediaKey).length === 2, 'IndexedDB 往返后必须保留两种关键词格式的内嵌资产引用');
    const persistedAsset = reloadedAssetPng.media_assets.find(asset => asset.kind === 'ccv3_asset' && asset.sourceUrl === 'https://example.com/embedded.webp');
    assert(persistedAsset && !persistedAsset.data_url && !(persistedAsset.bytes instanceof Uint8Array) && !(persistedAsset.blob instanceof Blob), 'IndexedDB 往返后的资产应只保留媒体引用，不应全量水合');
    const ordinaryMessage = '普通消息持久化回读：\n\n' + reloadedAssetPng.first_mes;
    const beforeHydrationMarkup = document.createElement('div');
    beforeHydrationMarkup.innerHTML = md(ordinaryMessage, {preserveImages:true, mediaAssets:reloadedAssetPng.media_assets, role:'assistant'});
    assert(beforeHydrationMarkup.querySelector('img') && !/^blob:/.test(beforeHydrationMarkup.querySelector('img').src), '取回存储媒体前不得伪造 blob 引用');
    const originalLoadMediaBlob = YeyuRepository.loadMediaBlob;
    let mediaReadCount = 0;
    YeyuRepository.loadMediaBlob = async function(key){mediaReadCount += 1;return await originalLoadMediaBlob.call(YeyuRepository,key);};
    try{await hydrateReferencedCardAssets(reloadedAssetPng,[ordinaryMessage]);}
    finally{YeyuRepository.loadMediaBlob=originalLoadMediaBlob;}
    assert(mediaReadCount === 1, '普通消息资产按需水合必须读取 IndexedDB');
    assert(persistedAsset.blob instanceof Blob && !persistedAsset.data_url, '聊天资产水合必须保留 Blob，不得转成 base64 data URL');
    const reloadedMarkup = document.createElement('div');
    reloadedMarkup.innerHTML = md(ordinaryMessage, {preserveImages:true, mediaAssets:reloadedAssetPng.media_assets, role:'assistant'});
    assert(reloadedMarkup.querySelector('img') && /^blob:/.test(reloadedMarkup.querySelector('img').src) && !reloadedMarkup.querySelector('.card-inline-image-missing'), 'IndexedDB 往返后的普通消息必须通过 blob URL 渲染真实图片');
    const privateData = {customScripts:[{type:'editdisplay',in:'Alice',out:'changed'}], triggerscript:[{type:'start',effect:[{type:'triggerlua',code:'error("must not run")'}]}], unknown:{keep:[1,2,3]}};
    const privateDocument = JSON.parse(JSON.stringify(fullFixture));
    privateDocument.data.extensions.risuai = privateData;
    const privateCard = parseCard(privateDocument);
    privateCard.id = 'private-preserved';
    ensureCharacterIntelligence(privateCard);
    assert(JSON.stringify(privateCard.extensions.risuai) === JSON.stringify(privateData), '未知私有扩展必须完整保留');
    assert(!analyzeCardDependencies(privateCard).items.some(item => item.id === 'st-regex'), 'Risu 私有脚本不得报告为 ST 正则');
    privateCard.importMeta.risuModule = {type:'risuModule',module:{regex:[{in:'x',out:'y'}],unknown:{keep:true}}};
    const legacyBefore = JSON.stringify(privateCard.importMeta.risuModule);
    const risuItems = analyzeCardDependencies(privateCard).items.filter(item => item.evidence.some(proof => /risu/i.test(proof.source)));
    assert(typeof readCHARX === 'function' && isRisuCharacter(privateCard)
      && ['risu-core', 'risu-regex', 'risu-trigger'].every(id=>risuItems.some(item=>item.id===id && item.group==='ready'))
      && !risuItems.some(item=>!['risu-core', 'risu-module', 'risu-regex', 'risu-trigger', 'risu-toggle', 'risu-lorebook', 'risu-display'].includes(item.id) && item.group==='ready'),
      '仅已接入的 Risu 运行能力可报告为可用');
    assert(JSON.stringify(privateCard.importMeta.risuModule) === legacyBefore
      && JSON.stringify(privateCard.extensions.risuai) === JSON.stringify(privateData),
      '依赖分析后 Risu 私有材料仍必须原样保留');
    const v2Card = parseCard(v2);
    assert(v2Card.name === 'Wrong V2' && v2Card.description === 'legacy', 'V2 JSON 公共字段必须可读取');
    URL.revokeObjectURL(pngCard.avatar_image);
    URL.revokeObjectURL(parsedAssetPng.avatar_image);
    return {v2:true, v3:true, pngV3Preferred:true, unknownPrivateExtensionPreserved:true, binaryMediaPersistence:true, worldBook:true};
  }, {fullFixture: fixture});

  assert.deepStrictEqual(pageErrors, []);
  assert.deepStrictEqual(consoleErrors, []);
  console.log(JSON.stringify(result));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
