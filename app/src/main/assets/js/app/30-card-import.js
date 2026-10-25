// ===== Character Card Parser =====
function normalizeGreetingValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return String(value.content || value.text || value.message || '');
  return '';
}
// Blank greetings keep their slot: CCv3 @@is_greeting counts card positions. The choice list
// (getGreetings) is what hides them.
function normalizeGreetingList(value) {
  return (Array.isArray(value) ? value : []).map(normalizeGreetingValue);
}
function collectCardMediaAssets(data) {
  var api = pureApi(),
    assets = [],
    add = function (text, index) {
      var refs = api ? api.extractImageRefs(String(text || '')) : [];
      refs.forEach(function (ref, n) {
        var local = safeImage(ref.url, false),
          remote = normalizeRemoteCardUrl(ref.url);
        if (!local && !remote) return;
        assets.push({
          id: 'opening_' + index + '_' + n,
          kind: 'opening',
          greetingIndex: index,
          sourceUrl: remote || ref.url,
          alt: ref.alt || '',
          width: ref.width || '',
          radius: ref.radius || '',
          status: local ? 'ready' : 'pending',
          data_url: local || '',
        });
      });
    };
  // Media follow the greeting choice list (getGreetings), which leaves blank greetings out.
  [normalizeGreetingValue(data.first_mes || data.char_greeting || '')]
    .concat(normalizeGreetingList(data.alternate_greetings))
    .filter(function (text) {
      return text.trim();
    })
    .forEach(add);
  return assets;
}
function firstCardValue(data, keys, fallback) {
  for (var i = 0; i < keys.length; i++) {
    var value = data && data[keys[i]];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}
function cardAssetUrl(data, types) {
  var assets = Array.isArray(data && data.assets) ? data.assets : [],
    wanted = (types || []).map(function (x) {
      return String(x).toLowerCase();
    }),
    rows = assets.filter(function (item) {
      return (
        item &&
        wanted.includes(String(item.type || '').toLowerCase()) &&
        typeof (item.uri || item.url || item.src) === 'string'
      );
    }),
    row =
      rows.find(function (item) {
        return String(item.name || '').toLowerCase() === 'main';
      }) || rows[0];
  return row ? String(row.uri || row.url || row.src) : '';
}
function cardAssetStableId(asset, index, prefix) {
  asset = asset && typeof asset === 'object' ? asset : {};
  var extensions =
      asset.extensions && typeof asset.extensions === 'object' && !Array.isArray(asset.extensions)
        ? asset.extensions
        : {},
    declared = String(extensions.yeyuAssetId || '').trim();
  var fallback = prefix === undefined ? 'ccv3_asset_' : String(prefix);
  return declared || (fallback ? fallback + String(index) : '');
}
function collectEmbeddedV3ImageAssets(data) {
  return (Array.isArray(data && data.assets) ? data.assets : [])
    .map(function (asset, index) {
      if (!asset || typeof asset !== 'object') return null;
      var type = String(asset.type || 'other'),
        lowerType = type.toLowerCase(),
        uri = String(asset.uri || asset.url || asset.src || ''),
        local = safeImage(uri, false),
        declaredMime = cardAssetMime(asset, asset.name || uri),
        remote = remoteImageUrl(uri),
        image =
          !!local ||
          declaredMime.indexOf('image/') === 0 ||
          (!/^(?:audio|video)\//.test(declaredMime) &&
            ['avatar', 'portrait', 'background', 'emotion'].includes(lowerType));
      if (!image || lowerType === 'icon' || lowerType === 'user_icon') return null;
      var mimeMatch = local.match(/^data:([^;,]+)/i);
      return {
        id: cardAssetStableId(asset, index, 'ccv3_asset_'),
        kind: 'ccv3_asset',
        assetType: type,
        name: String(asset.name || ''),
        ext: String(asset.ext || ''),
        originalUri: uri,
        sourceUrl: uri,
        status: local ? 'ready' : remote ? 'remote' : 'unavailable',
        data_url: local || '',
        mime: (mimeMatch && mimeMatch[1]) || declaredMime,
      };
    })
    .filter(Boolean);
}
function upsertCardMediaAsset(card, asset) {
  if (!Array.isArray(card.media_assets)) card.media_assets = [];
  var index = card.media_assets.findIndex(function (row) {
    return row && String(row.id || '') === String((asset && asset.id) || '');
  });
  if (index < 0) {
    card.media_assets.push(asset);
    return asset;
  }
  Object.assign(card.media_assets[index], asset);
  return card.media_assets[index];
}
function cardBackgroundPresentation(data) {
  var extensions =
      data && data.extensions && typeof data.extensions === 'object' && !Array.isArray(data.extensions)
        ? data.extensions
        : {},
    yeyu =
      extensions.yeyu && typeof extensions.yeyu === 'object' && !Array.isArray(extensions.yeyu) ? extensions.yeyu : {},
    version = yeyu.backgroundPresentationVersion == null ? 1 : Number(yeyu.backgroundPresentationVersion);
  return yeyu.backgroundPresentation === 'avatar-derived' && version === 1 ? 'avatar-derived' : '';
}
// SillyTavern imports a JSON character only when it carries spec, name or char_name and refuses
// anything else. World books and chat completion presets are named so the user knows where they go.
function characterCardJsonProblem(json) {
  var object = function (value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  };
  if (!object(json)) return '不是角色卡 JSON 对象';
  if (json.lorebookVersion !== undefined || json.kind === 'memory' || json.type === 'risu')
    return '这是世界书文件，不是角色卡，请到「世界书管理 → 导入」里导入';
  if (
    json.spec !== undefined ||
    json.name !== undefined ||
    json.char_name !== undefined ||
    object(json.data) ||
    object(json.card) ||
    object(json.character)
  )
    return '';
  if (json.entries !== undefined || object(json.character_book) || object(json.world_info))
    return '这是世界书文件，不是角色卡，请到「世界书管理 → 导入」里导入';
  if (Array.isArray(json.prompts) || json.prompt_order !== undefined || json.chat_completion_source !== undefined)
    return '这是聊天补全预设，不是角色卡，请到「提示词预设 → 导入 JSON」里导入';
  return '无法识别为角色卡：缺少 spec、data、name 或 char_name';
}
// Parses every card of a JSON file or paste; a bad item names its position in the list.
function parseCardList(items) {
  return items.map(function (item, index) {
    try {
      return parseCard(item);
    } catch (error) {
      if (items.length < 2) throw error;
      throw new Error('第 ' + (index + 1) + ' 项：' + String((error && error.message) || error));
    }
  });
}
function parseCard(json) {
  var problem = characterCardJsonProblem(json);
  if (problem) throw new Error(problem);
  const rawCard = JSON.parse(JSON.stringify(json));
  let data = json;
  if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) data = json.data;
  if (json.card && typeof json.card === 'object' && !data.name) data = json.card;
  if (json.character && !data.name) data = json.character;
  if (json.char_name && !data.name) {
    data = {
      name: json.char_name,
      description: json.char_description || json.description,
      personality: json.char_persona || json.personality,
      scenario: json.world_scenario || json.scenario,
      first_mes: json.char_greeting || json.first_mes,
      mes_example: json.example_dialogue || json.mes_example,
      system_prompt: json.system_prompt,
      post_history_instructions: json.post_history_instructions,
      creator: json.creator_comment || json.creator,
      tags: json.tags || [],
      alternate_greetings: json.alternate_greetings || [],
      creator_notes: json.creator_notes || '',
      character_version: json.character_version || '',
      extensions: json.extensions || {},
      char_name: json.char_name,
      char_persona: json.char_persona,
      char_description: json.char_description,
      char_greeting: json.char_greeting,
      world_scenario: json.world_scenario,
      example_dialogue: json.example_dialogue,
    };
  }
  var api = pureApi(),
    extensions = data.extensions && typeof data.extensions === 'object' ? data.extensions : {},
    chub = extensions.chub && typeof extensions.chub === 'object' ? extensions.chub : {},
    creatorNotes = String(firstCardValue(data, ['creator_notes', 'creatorNotes', 'creator_comment'], '') || ''),
    clientLanguage = browserLanguagePrefix(),
    multilingual =
      data.creator_notes_multilingual &&
      typeof data.creator_notes_multilingual === 'object' &&
      !Array.isArray(data.creator_notes_multilingual)
        ? data.creator_notes_multilingual
        : {},
    matchedLanguage = Object.keys(multilingual).find(function (key) {
      return String(key).toLowerCase().split(/[-_]/)[0] === clientLanguage;
    }),
    creatorNotesDisplay = String(
      matchedLanguage ? multilingual[matchedLanguage] : (multilingual.en != null ? multilingual.en : creatorNotes) || ''
    ),
    noteResult = api ? api.cleanCreatorNotes(creatorNotes) : { cleaned: creatorNotes, removed: [] },
    displayNoteResult = api ? api.cleanCreatorNotes(creatorNotesDisplay) : { cleaned: creatorNotesDisplay },
    alternateGreetings = normalizeGreetingList(
      [].concat(data.alternate_greetings || [], data.additional_greetings || [])
    ),
    characterBook = firstCardValue(
      data,
      ['character_book', 'characterBook', 'lorebook', 'world_info', 'worldInfo'],
      null
    ),
    assetAvatar = cardAssetUrl(data, ['icon', 'avatar', 'portrait']),
    assetBackground = cardAssetUrl(data, ['background']),
    embeddedAvatar = firstCardValue(data, ['avatar_image'], '') || safeImage(assetAvatar, false) || '',
    remoteAvatar = remoteImageUrl(
      firstCardValue(data, ['avatar', 'image_url'], assetAvatar || chub.avatar || extensions.avatar || '')
    ),
    sourceAvatar = embeddedAvatar || remoteAvatar || firstCardValue(data, ['avatar', 'image', 'image_url'], ''),
    sourceBackground = firstCardValue(
      data,
      ['background_image', 'background', 'background_url'],
      safeImage(assetBackground, false) ||
        remoteImageUrl(assetBackground) ||
        chub.background_image ||
        chub.background ||
        extensions.background_image ||
        ''
    ),
    explicitBackgroundUrl = remoteImageUrl(
      firstCardValue(
        data,
        ['background', 'background_url'],
        assetBackground || chub.background_image || chub.background || extensions.background_image || ''
      )
    ),
    backgroundExplicit =
      !!String(sourceBackground || '').trim() &&
      !(embeddedAvatar && String(sourceBackground) === String(embeddedAvatar) && !explicitBackgroundUrl),
    backgroundPresentation =
      !backgroundExplicit && typeof cardBackgroundPresentation === 'function' ? cardBackgroundPresentation(data) : '',
    mediaAssets = collectCardMediaAssets(
      Object.assign({}, data, {
        first_mes: normalizeGreetingValue(
          firstCardValue(data, ['first_mes', 'char_greeting', 'first_message', 'greeting'], '')
        ),
        alternate_greetings: alternateGreetings,
      })
    ).concat(collectEmbeddedV3ImageAssets(data));
  return {
    name: firstCardValue(data, ['name', 'char_name', 'character_name', 'nickname'], '未命名'),
    nickname: String(data.nickname || ''),
    description: firstCardValue(data, ['description', 'char_description', 'definition'], '') || '',
    personality: firstCardValue(data, ['personality', 'char_persona', 'persona'], '') || '',
    scenario: firstCardValue(data, ['scenario', 'world_scenario', 'setting'], '') || '',
    first_mes: normalizeGreetingValue(
      firstCardValue(data, ['first_mes', 'char_greeting', 'first_message', 'greeting'], '')
    ),
    mes_example: firstCardValue(data, ['mes_example', 'example_dialogue', 'message_examples', 'examples'], '') || '',
    system_prompt: firstCardValue(data, ['system_prompt', 'systemPrompt'], '') || '',
    post_history_instructions: firstCardValue(data, ['post_history_instructions', 'postHistoryInstructions'], '') || '',
    creator: data.creator || data.creator_comment || '',
    creator_notes: creatorNotes,
    creator_notes_clean: noteResult.cleaned,
    creator_notes_display: displayNoteResult.cleaned,
    creator_notes_zh: String(data.creator_notes_zh || ''),
    creator_notes_multilingual:
      data.creator_notes_multilingual && typeof data.creator_notes_multilingual === 'object'
        ? JSON.parse(JSON.stringify(data.creator_notes_multilingual))
        : {},
    source: Array.isArray(data.source) ? data.source.map(String) : [],
    creation_date: Number.isFinite(Number(data.creation_date)) ? Number(data.creation_date) : null,
    modification_date: Number.isFinite(Number(data.modification_date)) ? Number(data.modification_date) : null,
    assets: Array.isArray(data.assets) ? JSON.parse(JSON.stringify(data.assets)) : [],
    character_version: data.character_version || '',
    alternate_greetings: alternateGreetings,
    extensions: extensions,
    avatar_emoji: '',
    avatar_image: sourceAvatar,
    background_image: sourceBackground,
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === 'string'
        ? data.tags
            .split(',')
            .map(function (t) {
              return t.trim();
            })
            .filter(Boolean)
        : [],
    character_book: characterBook,
    regexScripts: typeof extractCharacterRegexScripts === 'function' ? extractCharacterRegexScripts(data, rawCard) : [],
    media_assets: mediaAssets,
    importMeta: {
      format: json && json.spec ? String(json.spec) : 'generic',
      specVersion: String((json && json.spec_version) || ''),
      rawCard: rawCard,
      rawCharacterBook: null,
      rawCharacterBookPath: characterBook ? 'card' : '',
      sourceAvatar: remoteAvatar || sourceAvatar,
      sourceBackground: backgroundExplicit ? explicitBackgroundUrl || sourceBackground : '',
      backgroundExplicit: backgroundExplicit,
      backgroundPresentation: backgroundPresentation,
      backgroundPresentationVersion: backgroundPresentation ? 1 : 0,
      sourceBackgroundStatus: backgroundExplicit
        ? 'explicit'
        : backgroundPresentation
          ? 'avatar-derived-marker'
          : sourceBackground
            ? 'auto-duplicate-detected'
            : 'not-provided',
      creatorNotesOriginal: creatorNotes,
      creatorNotesClean: noteResult.cleaned,
      creatorNotesRemoved: noteResult.removed,
      creatorNotesLanguage: clientLanguage,
      depthPrompt: extensions.depth_prompt || extensions.depthPrompt || null,
      chubExtensions: chub,
    },
  };
}

function base64ToUtf8(b64) {
  var clean = String(b64 || '')
    .trim()
    .replace(/\s+/g, '');
  var bin = atob(clean);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
function decodeCharacterPayload(raw) {
  var val = String(raw || '').trim();
  if (!val) throw new Error('角色卡数据为空');
  if (val[0] === '{' || val[0] === '[') return val;
  var decoded = val;
  try {
    decoded = base64ToUtf8(val);
  } catch (e) {
    try {
      decoded = decodeURIComponent(escape(atob(val)));
    } catch (e2) {
      try {
        decoded = atob(val);
      } catch (e3) {}
    }
  }
  return decoded;
}
async function inflatePNGTextChunk(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('当前设备无法读取这张 PNG 角色卡中的压缩数据');
  var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),
    decoder = new TextDecoder('utf-8', { fatal: false }),
    parts = [];
  try {
    while (true) {
      var result = await reader.read();
      if (result.done) break;
      var chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value || 0);
      parts.push(decoder.decode(chunk, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {}
  }
}
var parseCharacterCardJsonText = function (raw) {
  try {
    return JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
  } catch (_) {
    throw new Error(
      '\u6587\u4EF6\u4E0D\u662F\u6709\u6548\u7684 JSON\uFF0C\u53EF\u80FD\u5DF2\u635F\u574F\u6216\u4E0D\u662F\u89D2\u8272\u5361\u6587\u4EF6'
    );
  }
};
function cardAssetMime(asset, path) {
  var declaredExt = String((asset && asset.ext) || '')
      .trim()
      .toLowerCase()
      .replace(/^\./, ''),
    pathExt = String(path || '')
      .split(/[?#]/)[0]
      .split('.')
      .pop()
      .trim()
      .toLowerCase(),
    map = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      apng: 'image/apng',
      bmp: 'image/bmp',
      jfif: 'image/jpeg',
      avif: 'image/avif',
      mp4: 'video/mp4',
      webm: 'video/webm',
      avi: 'video/x-msvideo',
      m4p: 'video/mp4',
      m4v: 'video/x-m4v',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
    };
  return map[declaredExt] || map[pathExt] || '';
}
function cardAssetExtension(asset, path, mime) {
  var declared = String(
      (asset && asset.ext) ||
        String(path || '')
          .split('.')
          .pop() ||
        ''
    ).toLowerCase(),
    mimeExtensions = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/apng': 'apng',
      'image/bmp': 'bmp',
      'image/avif': 'avif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/x-msvideo': 'avi',
      'video/x-m4v': 'm4v',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
    };
  return cardAssetMime({ ext: declared }, '') === String(mime || '').toLowerCase()
    ? declared
    : mimeExtensions[String(mime || '').toLowerCase()] || declared;
}
function cardBytesToDataUrl(bytes, mime) {
  var chunk = 32768,
    binary = '';
  for (var i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  return 'data:' + mime + ';base64,' + btoa(binary);
}
function cardAssetContentType(bytes) {
  var image = cardImageContentType(bytes);
  if (image) return image;
  if (!bytes || bytes.length < 4) return '';
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  if (bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2) return 'audio/mpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    var riffType = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riffType === 'WAVE') return 'audio/wav';
    if (riffType === 'AVI ') return 'video/x-msvideo';
  }
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
    return 'video/mp4';
  return '';
}
function parseEmbeddedCharacterText(text, imgUrl, embeddedAssets) {
  function assetBytes(value) {
    var binary = atob(
        String(value || '')
          .trim()
          .replace(/\s+/g, '')
      ),
      bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  var js = decodeCharacterPayload(text),
    parsed = typeof parseCharacterCardJsonText === 'function' ? parseCharacterCardJsonText(js) : JSON.parse(js),
    card = parseCard(parsed),
    meta = card.importMeta || (card.importMeta = {}),
    data = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed,
    assets = Array.isArray(data && data.assets) ? data.assets : [],
    media = [];
  card.avatar_image = imgUrl;
  meta.embeddedCardImage = true;
  if (!card.background_image) {
    card.background_image = '';
    meta.backgroundExplicit = false;
    meta.backgroundPresentation = 'avatar-derived';
    meta.backgroundPresentationVersion = 1;
    meta.sourceBackground = '';
    meta.sourceBackgroundStatus = 'avatar-derived-png';
  }
  ((embeddedAssets && assets) || []).forEach(function (asset, index) {
    var uri = String((asset && asset.uri) || ''),
      match = uri.match(/^__asset:(\d+)$/),
      stored = /^risustored:[0-9a-f]{64}$/i.test(uri),
      record = match ? embeddedAssets[Number(match[1])] : stored ? embeddedAssets[uri.toLowerCase()] : null;
    if (!record) return;
    var bytes;
    try {
      bytes = assetBytes(record.text);
    } catch (error) {
      if (String(card.background_image || '') === uri) throw new Error('主背景素材无法读取');
      return;
    }
    var mime = cardAssetContentType(bytes) || cardAssetMime(asset, asset.name);
    if (!mime) return;
    media.push({
      id: cardAssetStableId(asset, index, 'ccv3_asset_'),
      kind: 'ccv3_asset',
      assetType: String(asset.type || 'other'),
      name: String(asset.name || ''),
      ext: cardAssetExtension(asset, asset.name, mime),
      originalUri: String(asset.uri || ''),
      sourceUrl: String(asset.uri || ''),
      status: 'ready',
      bytes: bytes,
      mime: mime,
      mediaHash: 'png-crc32:' + record.crc.toString(16) + ':' + bytes.length,
    });
  });
  media.forEach(function (asset) {
    upsertCardMediaAsset(card, asset);
  });
  return card;
}

async function readCHARX(file) {
  var parsed = await YeyuCharx.parse(await file.arrayBuffer()),
    card = parseCard(parsed.card);
  card.importMeta.container = 'charx';
  var moduleBytes = await parsed.readModule();
  if (moduleBytes) {
    var decoded = await YeyuRisuModule.decodeRisum(moduleBytes);
    card.extensions.yeyu = card.extensions.yeyu || {};
    card.extensions.yeyu.risuModule = decoded.module;
    for (var moduleAsset of decoded.assets) {
      var moduleMime = (moduleAsset.bytes && cardImageContentType(moduleAsset.bytes)) || 'application/octet-stream';
      upsertCardMediaAsset(card, {
        id: 'risu_module_' + moduleAsset.index,
        kind: 'ccv3_asset',
        assetType: 'x-risu-asset',
        name: moduleAsset.name,
        originalUri: moduleAsset.declaredRef,
        sourceUrl: moduleAsset.declaredRef,
        status: moduleAsset.bytes ? 'ready' : 'unavailable',
        blob: moduleAsset.bytes ? new Blob([moduleAsset.bytes], { type: moduleMime }) : undefined,
        mime: moduleMime,
        mediaHash: moduleAsset.bytes
          ? 'risum-crc32:' + YeyuCharx.crc32(moduleAsset.bytes).toString(16) + ':' + moduleAsset.bytes.length
          : undefined,
      });
    }
  }
  moduleBytes = null;
  // Like ST, a declared icon that is not in the archive leaves the default avatar; the import report
  // names it (cardImportAuditItems) instead of rejecting the whole card.
  var iconBytes = await parsed.readAsset(parsed.icon);
  if (iconBytes) {
    card.avatar_image = cardBytesToDataUrl(iconBytes, cardAssetMime(parsed.icon, parsed.icon.path));
    card.importMeta.embeddedCardImage = true;
  }
  iconBytes = null;
  for (var asset of parsed.assets) {
    var mime = cardAssetMime(asset, asset.path),
      backgroundImage = asset.type === 'background' && mime.indexOf('image/') === 0,
      record = {
        id: cardAssetStableId(card.assets && card.assets[asset.index], asset.index, 'ccv3_asset_'),
        kind: 'ccv3_asset',
        assetType: asset.type,
        name: asset.name,
        ext: asset.ext,
        originalUri: asset.uri,
        sourceUrl: asset.uri,
        mime: mime,
      },
      bytes;
    try {
      bytes = await parsed.readAsset(asset);
      if (!bytes) throw new Error('素材不存在');
    } catch (error) {
      if (backgroundImage) throw new Error('CHARX 主背景素材无法读取：' + error.message);
      // The declaration stays visible as an unavailable asset, the same as a missing image.
      upsertCardMediaAsset(card, Object.assign(record, { status: 'unavailable' }));
      continue;
    }
    var storedAsset = upsertCardMediaAsset(
      card,
      Object.assign(record, { status: 'ready', blob: new Blob([bytes], { type: mime }), mediaHash: asset.mediaHash })
    );
    if (backgroundImage && !card.background_image) {
      card.background_image = cardBytesToDataUrl(bytes, mime);
      delete storedAsset.blob;
      storedAsset.data_url = card.background_image;
      card.importMeta.backgroundExplicit = true;
      card.importMeta.backgroundPresentation = '';
      card.importMeta.backgroundPresentationVersion = 0;
      card.importMeta.sourceBackgroundStatus = 'explicit';
    }
    bytes = null;
  }
  if (!card.background_image && card.avatar_image) {
    card.importMeta.backgroundExplicit = false;
    card.importMeta.backgroundPresentation = 'avatar-derived';
    card.importMeta.backgroundPresentationVersion = 1;
    card.importMeta.sourceBackground = '';
    card.importMeta.sourceBackgroundStatus = 'avatar-derived-charx';
  }
  card.importMeta.container = 'charx';
  return card;
}

async function readPNG(file) {
  if (!file) throw new Error('没有选择 PNG 文件');
  async function parseBuffer(buffer) {
    let imgUrl = '';
    try {
      const bytes = new Uint8Array(buffer);
      if (
        bytes.length < 20 ||
        bytes[0] !== 0x89 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x4e ||
        bytes[3] !== 0x47 ||
        bytes[4] !== 0x0d ||
        bytes[5] !== 0x0a ||
        bytes[6] !== 0x1a ||
        bytes[7] !== 0x0a
      )
        throw new Error('PNG 文件签名无效');
      imgUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      let idx = 8,
        payloads = {},
        embeddedAssets = Object.create(null);
      while (idx < bytes.length - 12) {
        if (idx + 12 > bytes.length) throw new Error('PNG chunk 头不完整');
        const len = new DataView(bytes.buffer, bytes.byteOffset + idx, 4).getUint32(0, false);
        idx += 4;
        const type = String.fromCharCode(bytes[idx], bytes[idx + 1], bytes[idx + 2], bytes[idx + 3]);
        idx += 4;
        if (type === 'IEND') break;
        if (len > bytes.length || idx + len + 4 > bytes.length) throw new Error('PNG chunk 长度越界');
        const chunk = bytes.subarray(idx, idx + len),
          crc = new DataView(bytes.buffer, bytes.byteOffset + idx + len, 4).getUint32(0, false);
        if (type === 'tEXt') {
          const ni = chunk.indexOf(0);
          if (ni >= 0) {
            const kw = new TextDecoder('latin1').decode(chunk.subarray(0, ni)),
              payload = chunk.subarray(ni + 1),
              assetMatch = kw.match(/^chara-ext-asset_:?(\d+)$/),
              stored = /^risustored:[0-9a-f]{64}$/i.test(kw);
            if ((kw === 'chara' || kw === 'ccv3') && !payloads[kw])
              payloads[kw] = new TextDecoder('latin1').decode(payload);
            else if (assetMatch && !embeddedAssets[Number(assetMatch[1])])
              embeddedAssets[Number(assetMatch[1])] = { text: new TextDecoder('latin1').decode(payload), crc: crc };
            else if (stored && !embeddedAssets[kw.toLowerCase()])
              embeddedAssets[kw.toLowerCase()] = { text: new TextDecoder('latin1').decode(payload), crc: crc };
          }
        } else if (type === 'zTXt') {
          const zero = chunk.indexOf(0);
          if (zero > 0) {
            const kw = new TextDecoder('latin1').decode(chunk.slice(0, zero)),
              method = chunk[zero + 1],
              compressed = chunk.slice(zero + 2);
            if ((kw === 'chara' || kw === 'ccv3') && method === 0 && !payloads[kw])
              payloads[kw] = await inflatePNGTextChunk(compressed);
          }
        } else if (type === 'iTXt') {
          const zero = chunk.indexOf(0),
            flag = zero >= 0 ? chunk[zero + 1] : 0,
            method = zero >= 0 ? chunk[zero + 2] : 0;
          let pos = zero + 3;
          if (zero >= 0) {
            const langEnd = chunk.indexOf(0, pos);
            if (langEnd < 0) throw new Error('iTXt 语言字段不完整');
            pos = langEnd + 1;
            const translatedEnd = chunk.indexOf(0, pos);
            if (translatedEnd < 0) throw new Error('iTXt 翻译字段不完整');
            const keyword = new TextDecoder('latin1').decode(chunk.slice(0, zero)),
              payload = chunk.slice(translatedEnd + 1);
            if ((keyword === 'chara' || keyword === 'ccv3') && !payloads[keyword])
              payloads[keyword] =
                flag === 1 && method === 0
                  ? await inflatePNGTextChunk(payload)
                  : new TextDecoder('utf-8', { fatal: false }).decode(payload);
          }
        }
        idx += len + 4;
      }
      var selected = payloads.ccv3 || payloads.chara;
      if (selected) return parseEmbeddedCharacterText(selected, imgUrl, embeddedAssets);
      throw new Error('未找到角色卡数据');
    } catch (error) {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      throw new Error(
        /^PNG/.test(String((error && error.message) || ''))
          ? String(error.message)
          : 'PNG 角色数据解析失败：' + String((error && error.message) || error)
      );
    }
  }
  if (typeof file.arrayBuffer === 'function') return await parseBuffer(await file.arrayBuffer());
  return await new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function (event) {
      parseBuffer(event.target.result).then(resolve, reject);
    };
    reader.onerror = function () {
      reject(new Error('PNG 文件读取失败'));
    };
    reader.readAsArrayBuffer(file);
  });
}

// ===== Import =====
var _importProgressActive = false,
  _importLocalizationController = null,
  _importLocalizationCancelled = false,
  _importProgressDone = 0,
  _importProgressTotal = 1;
function showImportProgress(title, text, total) {
  _importProgressActive = true;
  _importLocalizationCancelled = false;
  _importProgressDone = 0;
  _importProgressTotal = Math.max(1, Number(total) || 1);
  var modal = $('import-progress-modal'),
    cancel = $('import-progress-cancel');
  if ($('import-progress-title')) $('import-progress-title').textContent = title || '正在导入';
  if ($('import-progress-text')) $('import-progress-text').textContent = text || '正在准备数据…';
  if ($('import-progress-detail')) $('import-progress-detail').textContent = '';
  if ($('import-progress-fill')) $('import-progress-fill').style.width = '0%';
  if (cancel) {
    cancel.disabled = false;
    cancel.textContent = '取消导入';
  }
  if (modal) openModal('import-progress-modal');
}
function updateImportProgress(text, detail, step) {
  if (step !== false) _importProgressDone = Math.min(_importProgressTotal, _importProgressDone + 1);
  if ($('import-progress-text') && text) $('import-progress-text').textContent = text;
  if ($('import-progress-detail'))
    $('import-progress-detail').textContent = detail || _importProgressDone + ' / ' + _importProgressTotal;
  if ($('import-progress-fill'))
    $('import-progress-fill').style.width = Math.round((_importProgressDone * 100) / _importProgressTotal) + '%';
}
function hideImportProgress() {
  _importProgressActive = false;
  _importLocalizationController = null;
  var modal = $('import-progress-modal');
  if (modal) closeModal('import-progress-modal');
}
function cancelImportLocalization() {
  if (!_importProgressActive) return;
  _importLocalizationCancelled = true;
  if (_importLocalizationController) _importLocalizationController.abort();
  var cancel = $('import-progress-cancel');
  if (cancel) {
    cancel.disabled = true;
    cancel.textContent = '正在取消导入';
  }
  if ($('import-progress-text')) $('import-progress-text').textContent = '正在取消；不会保存角色、世界书或媒体…';
}
async function mapWithConcurrency(items, limit, worker) {
  items = Array.isArray(items) ? items : [];
  limit = Math.max(1, Math.min(8, Number(limit) || 1));
  var results = new Array(items.length),
    next = 0;
  async function run() {
    while (next < items.length) {
      var i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  var runners = [];
  for (var r = 0; r < Math.min(limit, items.length); r++) runners.push(run());
  await Promise.all(runners);
  return results;
}
function waitMs(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
function importHasCjk(value) {
  return window.YeyuPure.hasCjk(String(value || ''));
}
function isLocalizationPlaceholderKey(value) {
  var normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return /^(?:disabled){2,}$/.test(normalized);
}
function isNonTranslatableImportTerm(value) {
  var text = String(value || '').trim();
  return (
    !text ||
    Array.from(text).length === 1 ||
    // Digits, symbols, punctuation and emoji carry no words, so they read the same in Chinese.
    !/\p{L}/u.test(text) ||
    isLocalizationPlaceholderKey(text) ||
    /^\/.+\/[gimsuy]*$/.test(text) ||
    /^(?:https?:|data:|file:|blob:|www\.)/i.test(text) ||
    /^\{\{[^{}]+\}\}$/.test(text) ||
    /^<[^<>]+>$/.test(text) ||
    /^\$\{?[-\w.]+\}?$/.test(text) ||
    /^[A-Z0-9_.:/\\-]{3,}$/.test(text)
  );
}
// The single rule for whether an imported name or trigger word still needs a Chinese form. Audits,
// pending counts and every localization request ask it, so they cannot disagree.
function importTermNeedsLocalization(value) {
  var text = String(value || '').trim();
  return !!text && !importHasCjk(text) && !isNonTranslatableImportTerm(text);
}
// A V3 card whose nickname is already Chinese uses it as the Chinese display name instead of asking AI.
// Apply it before the participant registry is built so the main participant gets the Chinese name too.
function applyChineseNicknameAsDisplayName(card) {
  var nickname = String(card.nickname || '').trim();
  if (!card.localizedName && importHasCjk(nickname) && !importHasCjk(card.name)) card.localizedName = nickname;
  return card;
}
function worldBookCategoryNeedsLocalization(book) {
  if (!book || isGenericExportWorldBookName(book.name) || isGenericExportWorldBookName(book.localizedName))
    return false;
  return !importHasCjk(book.localizedName || book.localized_name) && importTermNeedsLocalization(book.name);
}
function createImportAttemptCard(source) {
  function clone(value) {
    if (value instanceof Uint8Array || (typeof Blob !== 'undefined' && value instanceof Blob)) return value;
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      var copied = {};
      Object.keys(value).forEach(function (key) {
        copied[key] = clone(value[key]);
      });
      return copied;
    }
    return value;
  }
  return initializeCardForImport(clone(source));
}
function compactLocalizationText(value, max) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 240);
}
function explicitChineseNameCandidate(card, source, aliases) {
  var direct = (Array.isArray(aliases) ? aliases : [])
    .map(function (x) {
      return String(x || '').trim();
    })
    .find(function (x) {
      return importHasCjk(x) && x.length <= 30;
    });
  if (direct) return direct;
  var text = [
      card && card.localizedName,
      ((card && card.tags) || []).join(' '),
      card && card.description,
      card && card.scenario,
      card && card.first_mes,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 5000),
    escaped = escapeRegexText(String(source || ''));
  if (!escaped) return '';
  var after = text.match(new RegExp(escaped + '\\s*[（(【[]\\s*([\\u3400-\\u9fff·]{1,24})\\s*[）)】\\]]', 'i'));
  if (after) return after[1];
  var before = text.match(new RegExp('([\\u3400-\\u9fff·]{1,24})\\s*[（(【[]\\s*' + escaped + '\\s*[）)】\\]]', 'i'));
  return before ? before[1] : '';
}
function cardLocalizationContext(card) {
  return {
    card_name: String((card && card.name) || ''),
    tags: ((card && card.tags) || []).slice(0, 12),
    creator: String((card && card.creator) || ''),
    description: compactLocalizationText(card && card.description, 260),
    scenario: compactLocalizationText(card && card.scenario, 220),
    greeting: compactLocalizationText(card && card.first_mes, 220),
  };
}
function validLocalizedName(source, value, strategy, kind) {
  var name = String(value || '')
      .replace(/^[\s"“”'‘’【】（）()]+|[\s"“”'‘’【】（）()]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    type = String(kind || 'person').toLowerCase(),
    titleLike = type === 'title' || type === 'category',
    maxLength = titleLike ? 80 : 30,
    generic = /^(角色|人物|女孩|男孩|女人|男人|少女|少年|主人|用户|未知|无名|朋友|敌人|character|unknown)$/i,
    invalid = titleLike ? /[。！？!?\n\r{}<>]/ : /[。！？!?\n\r:：;；{}<>]/;
  if (
    !String(source || '').trim() ||
    !name ||
    String(strategy || '').toLowerCase() === 'keep_original' ||
    name.length > maxLength ||
    !importHasCjk(name) ||
    invalid.test(name) ||
    generic.test(name)
  )
    return '';
  if (String(source || '').trim() === name) return '';
  return name;
}
function validLocalizationAliases(values, limit) {
  return window.YeyuPure.uniqueTextList(values || [], Math.max(40, Number(limit) || 240)).filter(function (x) {
    return x.length <= 48 && !/[。！？!?\n\r{}<>]/.test(x);
  });
}
function applyExistingCardNames(card) {
  ensureCharacterIntelligence(card);
  if (!card.localizedName) {
    var cardZh = explicitChineseNameCandidate(card, card.name, card.nameAliases);
    if (cardZh) card.localizedName = cardZh;
  }
  (card.participantRegistry || []).forEach(function (participant) {
    if (importHasCjk(participant.canonicalName)) return;
    var zh = explicitChineseNameCandidate(
      card,
      participant.originalName || participant.canonicalName,
      participant.aliases
    );
    if (zh) {
      participant.canonicalName = zh;
      participant.aliases = window.YeyuPure.uniqueTextList(
        (participant.aliases || []).concat([participant.originalName, zh]),
        30
      );
    }
  });
}
function isGenericExportWorldBookName(value) {
  var text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—–:：/\\()[\]{}【】]+/g, '');
  return [
    'export',
    'exported',
    'worldbookexport',
    'worldbookexported',
    'lorebookexport',
    'lorebookexported',
    '导出',
    '已导出',
    '导出世界书',
    '已导出世界书',
    '导出的世界书',
  ].includes(text);
}
function fallbackLocalizedWorldBookName(ownerType, title) {
  var text = String(title || '')
    .replace(/\s*·\s*分类名称\s*$/, '')
    .trim();
  if (ownerType === 'card') {
    if (!text || isGenericExportWorldBookName(text)) text = '角色世界书';
    if (!/世界书$/.test(text)) text += ' 世界书';
    return text;
  }
  return text && !isGenericExportWorldBookName(text) ? text : '导入世界书';
}
function buildCardNameTask(card) {
  applyExistingCardNames(card);
  var labels = [];
  if (importTermNeedsLocalization(card.localizedName || card.name))
    labels.push({
      id: 'card',
      text: String(card.name || ''),
      aliases: normalizedNameAliases(card),
      kind: 'title',
      allowKeepOriginal: false,
      target: card,
    });
  (card.participantRegistry || []).forEach(function (participant) {
    if (
      importTermNeedsLocalization(participant.canonicalName || participant.originalName) &&
      !(participant.nameLocalizationResolved === true && participant.nameLocalizationStrategy === 'keep_original')
    )
      labels.push({
        id: 'participant:' + participant.id,
        text: String(participant.originalName || participant.canonicalName || ''),
        aliases: participant.aliases || [],
        kind: 'person',
        allowKeepOriginal: true,
        target: participant,
      });
  });
  if (!labels.length) return null;
  return {
    kind: 'names',
    owner: card,
    ownerType: 'card',
    labels: labels,
    payload: {
      kind: 'names',
      context: cardLocalizationContext(card),
      labels: labels.map(function (row) {
        return {
          id: row.id,
          text: row.text,
          aliases: row.aliases,
          kind: row.kind,
          allow_keep_original: row.allowKeepOriginal === true,
        };
      }),
    },
    title: canonicalCharacterName(card) + ' · 规范名称',
  };
}
function buildWorldBookCategoryNameTask(owner, ownerType, title) {
  if (!worldBookCategoryNeedsLocalization(owner)) return null;
  var label = {
    id: 'worldbook-category',
    text: String(owner.name || ''),
    aliases: [],
    kind: 'category',
    target: owner,
  };
  return {
    kind: 'names',
    owner: owner,
    ownerType: ownerType,
    labels: [label],
    payload: {
      kind: 'names',
      context: {
        category_name: label.text,
        description: compactLocalizationText(owner.description, 180),
        owner_name: String(title || ''),
      },
      labels: [{ id: label.id, text: label.text, aliases: [], kind: 'category' }],
    },
    title: String(title || owner.name || '世界书') + ' · 分类名称',
  };
}
function configuredLocalizationBatchSize() {
  var value = typeof D !== 'undefined' && D && D.settings ? parseInt(D.settings.worldBookLocalizationBatchSize) : 80;
  return Math.max(10, Math.min(120, value || 80));
}
function localizationTermKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
function buildEntryLocalizationTerms(entries, namesOnly) {
  var terms = new Map();
  function add(source, kind, entry, related) {
    source = String(source || '').trim();
    var key = localizationTermKey(source);
    if (!source || !key) return;
    var term = terms.get(key);
    if (!term) {
      term = { id: 'term_' + terms.size, source: source, kinds: [], related: [], targets: [] };
      terms.set(key, term);
    }
    if (term.kinds.indexOf(kind) < 0) term.kinds.push(kind);
    validLocalizationAliases(related || [], 8).forEach(function (value) {
      if (localizationTermKey(value) !== key && term.related.indexOf(value) < 0 && term.related.length < 4)
        term.related.push(value);
    });
    term.targets.push({ entry: entry, kind: kind, source: source });
  }
  (entries || []).forEach(function (entry) {
    if (!entry || typeof entry !== 'object') return;
    // Keywords of an entry that does not trigger by them stay out of the request, even as context.
    var related =
      localizableEntryTerms(entry, false, namesOnly).length || localizableEntryTerms(entry, true, namesOnly).length
        ? validLocalizationAliases(
            wbEntryTriggerKeys(entry, false).concat(wbEntryTriggerKeys(entry, true)),
            8
          ).filter(function (value) {
            return !isLocalizationPlaceholderKey(value);
          })
        : [];
    if (!entryRawDisplayName(entry) && !importHasCjk(entry.localizedName || entry.localized_name)) {
      var firstKey = entryKeywordSources(entry, false)[0],
        existing = firstKey ? entryChineseKeywordAliases(entry, false, firstKey) : [];
      if (existing.length) entry.localizedName = existing[0];
    }
    var displaySource = entryDisplayNameNeedingLocalization(entry);
    if (displaySource) add(displaySource, 'display', entry, related);
    missingEntryLocalizationTerms(entry, false, namesOnly).forEach(function (source) {
      add(source, 'primary', entry, related);
    });
    missingEntryLocalizationTerms(entry, true, namesOnly).forEach(function (source) {
      add(source, 'secondary', entry, related);
    });
  });
  return Array.from(terms.values()).map(function (term) {
    term.kind = term.kinds.join('+');
    return term;
  });
}
function batchLocalizationTerms(terms, maxCount) {
  var batches = [],
    current = [],
    tokens = 0,
    tokenBudget = 6400;
  maxCount = Math.max(10, Math.min(120, Number(maxCount) || 80));
  (terms || []).forEach(function (term) {
    var wire = { id: term.id, source: term.source, kind: term.kind, related: term.related },
      cost = estTokens(JSON.stringify(wire)) + Math.max(28, estTokens(term.source) * 4) + 28;
    if (current.length && (current.length >= maxCount || tokens + cost > tokenBudget)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(term);
    tokens += cost;
  });
  if (current.length) batches.push(current);
  return batches;
}
function buildEntryTasks(owner, ownerType, entries, title, namesOnly) {
  var terms = buildEntryLocalizationTerms(entries, namesOnly),
    configured = configuredLocalizationBatchSize(),
    maxCount = terms.length > 400 ? Math.min(configured, 48) : configured,
    batches = batchLocalizationTerms(terms, maxCount);
  return batches.map(function (batch, index) {
    return {
      kind: 'terms',
      owner: owner,
      ownerType: ownerType,
      namesOnly: !!namesOnly,
      terms: batch,
      payload: {
        kind: 'terms',
        context: { owner_name: title },
        terms: batch.map(function (term) {
          return { id: term.id, source: term.source, kind: term.kind, related: term.related };
        }),
      },
      title: title + ' · 术语 ' + (index + 1) + '/' + batches.length,
    };
  });
}
function characterBookEntries(book) {
  var entries = book && book.entries;
  return Array.isArray(entries) ? entries : entries && typeof entries === 'object' ? Object.values(entries) : [];
}
function localizationAliasMap(value) {
  var out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  Object.keys(value).forEach(function (key) {
    var aliases = validLocalizationAliases(value[key]).filter(importHasCjk),
      exact = String(key),
      folded = exact.trim().toLowerCase();
    if (!aliases.length) return;
    out[exact] = window.YeyuPure.uniqueTextList((out[exact] || []).concat(aliases), 40);
    out[folded] = window.YeyuPure.uniqueTextList((out[folded] || []).concat(aliases), 40);
  });
  return out;
}
function mappedChineseAliases(map, source) {
  var normalized = localizationAliasMap(map),
    key = String(source || ''),
    folded = key.trim().toLowerCase();
  return validLocalizationAliases((normalized[key] || []).concat(normalized[folded] || [])).filter(importHasCjk);
}
function legacyPositionalAliasMap(sources, values) {
  var aliases = validLocalizationAliases(values).filter(importHasCjk),
    unique = [],
    seen = {};
  (sources || []).forEach(function (source) {
    var folded = String(source || '')
      .trim()
      .toLowerCase();
    if (!folded || seen[folded]) return;
    seen[folded] = true;
    unique.push({ source: String(source), folded: folded });
  });
  if (!unique.length || aliases.length < unique.length) return {};
  var out = {};
  unique.forEach(function (row, index) {
    out[row.source] = [aliases[index]];
    out[row.folded] = [aliases[index]];
  });
  return out;
}
function effectiveLocalizationAliasMap(sources, explicitMap, legacyAliases) {
  var out = localizationAliasMap(explicitMap),
    legacy = legacyPositionalAliasMap(sources, legacyAliases);
  (sources || []).forEach(function (source) {
    var key = String(source),
      folded = key.trim().toLowerCase(),
      aliases = mappedChineseAliases(out, key);
    if (!aliases.length) aliases = mappedChineseAliases(legacy, key);
    if (aliases.length) {
      out[key] = window.YeyuPure.uniqueTextList((out[key] || []).concat(aliases), 40);
      out[folded] = window.YeyuPure.uniqueTextList((out[folded] || []).concat(aliases), 40);
    }
  });
  return out;
}
// Keywords that still need a Chinese form, before deciding whether this entry triggers by them.
// Regex keys are patterns, not words: a forced-regex entry has none, and /pattern/flags keys are
// dropped by importTermNeedsLocalization. The card-spec use_regex field decides nothing here.
function entryKeywordSources(entry, secondary) {
  if (wbEntryForcesRegex(entry)) return [];
  return wbEntryTriggerKeys(entry, secondary).filter(function (key) {
    return key.length <= 64 && importTermNeedsLocalization(key);
  });
}
// Chinese aliases only help Yeyu's own keyword matcher: constant entries fire without keywords, and a
// Risu card (namesOnly) runs its own lorebook matcher that never reads aliases.
function localizableEntryTerms(entry, secondary, namesOnly) {
  return namesOnly || wbConstantFlag(entry) ? [] : entryKeywordSources(entry, secondary);
}
function entryChineseKeywordAliases(entry, secondary, source) {
  var existing = wbEntryTriggerAliases(entry, secondary),
    map = effectiveLocalizationAliasMap(entryKeywordSources(entry, secondary), existing.map, existing.aliases);
  return mappedChineseAliases(map, source);
}
function missingEntryLocalizationTerms(entry, secondary, namesOnly) {
  return localizableEntryTerms(entry, secondary, namesOnly).filter(function (source) {
    return !entryChineseKeywordAliases(entry, secondary, source).length;
  });
}
function entryRawDisplayName(entry) {
  return String(entry.name || entry.title || entry.comment || entry.notes || '');
}
// A nameless entry is shown by its first keyword (or that keyword's Chinese alias), so that keyword is
// the name to localize. Display names count for every entry, constant and Risu ones included.
function entryDisplayNameNeedingLocalization(entry) {
  var rawName = entryRawDisplayName(entry),
    source = rawName || entryKeywordSources(entry, false)[0] || '';
  if (!importTermNeedsLocalization(source) || importHasCjk(entry.localizedName || entry.localized_name)) return '';
  if (!rawName && entryChineseKeywordAliases(entry, false, source).length) return '';
  return source;
}
// The single judgement behind the import audits, the localization requests and the 待补全汉化 count.
function entryLocalizationNeedsWork(entry, namesOnly) {
  if (!entry || typeof entry !== 'object') return false;
  return (
    !!entryDisplayNameNeedingLocalization(entry) ||
    missingEntryLocalizationTerms(entry, false, namesOnly).length > 0 ||
    missingEntryLocalizationTerms(entry, true, namesOnly).length > 0
  );
}
function createLocalizationAudit() {
  var audit = {
    names: 0,
    categories: 0,
    entryNames: 0,
    primaryMissing: 0,
    secondaryMissing: 0,
    aliasesReady: 0,
    cjkSignals: 0,
    latinSignals: 0,
    unresolvedItems: [],
  };
  audit.addUnresolved = function (id, kind, source, reason) {
    if (audit.unresolvedItems.length >= 2000) return;
    audit.unresolvedItems.push({
      id: String(id || ''),
      kind: String(kind || ''),
      source: String(source || '').slice(0, 120),
      reason: String(reason || ''),
    });
  };
  return audit;
}
function auditWorldBookLocalization(audit, book, bookId, namesOnly) {
  if (!book || typeof book !== 'object') return;
  if (worldBookCategoryNeedsLocalization(book)) {
    audit.categories++;
    audit.latinSignals++;
    audit.addUnresolved(bookId + ':category', 'worldbook-category', book.name, '世界书分类缺少中文显示名');
  } else if (importHasCjk(book.localizedName || book.localized_name || book.name)) audit.cjkSignals++;
  worldBookImportEntryRows(book).forEach(function (row) {
    var entry = row.value;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    var entryId = bookId + ':' + (entry.id || row.index),
      displaySource = entryDisplayNameNeedingLocalization(entry);
    if (displaySource) {
      audit.entryNames++;
      audit.latinSignals++;
      audit.addUnresolved(entryId + ':name', 'worldbook-entry-name', displaySource, '世界书条目缺少中文显示名');
    }
    [false, true].forEach(function (secondary) {
      var terms = localizableEntryTerms(entry, secondary, namesOnly),
        missing = missingEntryLocalizationTerms(entry, secondary, namesOnly);
      if (secondary) audit.secondaryMissing += missing.length;
      else audit.primaryMissing += missing.length;
      audit.aliasesReady += Math.max(0, terms.length - missing.length);
      audit.latinSignals += terms.length;
      if (wbEntryTriggerKeys(entry, secondary).some(importHasCjk)) audit.cjkSignals++;
      missing.forEach(function (source, missingIndex) {
        audit.addUnresolved(
          entryId + ':' + (secondary ? 'secondary' : 'primary') + ':' + missingIndex,
          secondary ? 'worldbook-secondary-key' : 'worldbook-primary-key',
          source,
          secondary ? '世界书次关键词缺少中文触发别名' : '世界书主关键词缺少中文触发别名'
        );
      });
    });
  });
}
function finishLocalizationAudit(audit) {
  return {
    names: audit.names,
    categories: audit.categories,
    entryNames: audit.entryNames,
    primaryMissing: audit.primaryMissing,
    secondaryMissing: audit.secondaryMissing,
    aliasesReady: audit.aliasesReady,
    totalMissing: audit.names + audit.categories + audit.entryNames + audit.primaryMissing + audit.secondaryMissing,
    language: audit.latinSignals && audit.cjkSignals ? 'mixed' : audit.latinSignals ? 'non-chinese' : 'chinese',
    unresolvedItems: audit.unresolvedItems,
  };
}
function cardLocalizesNamesOnly(card) {
  return typeof isRisuCharacter === 'function' && isRisuCharacter(card);
}
function auditCardImportLocalization(card) {
  card = card || {};
  var audit = createLocalizationAudit(),
    seenNames = new Set(),
    namesOnly = cardLocalizesNamesOnly(card);
  function auditName(value, id, kind, source, resolvedOriginal) {
    var text = String(value || '').trim(),
      key = text.toLowerCase();
    if (!text || seenNames.has(key)) return;
    seenNames.add(key);
    if (importHasCjk(text)) audit.cjkSignals++;
    else if (importTermNeedsLocalization(text)) {
      audit.latinSignals++;
      if (!resolvedOriginal) {
        audit.names++;
        audit.addUnresolved(
          id,
          kind,
          source || text,
          kind === 'title' ? '角色标题缺少中文显示名' : '参与者缺少中文显示名'
        );
      }
    }
  }
  auditName(card.localizedName || card.name, 'card', 'title', card.name, false);
  (card.participantRegistry || []).forEach(function (row, index) {
    var resolved = !!(row && row.nameLocalizationResolved === true && row.nameLocalizationStrategy === 'keep_original');
    auditName(
      (row && row.canonicalName) || (row && row.originalName),
      'participant:' + ((row && row.id) || index),
      'participant',
      (row && row.originalName) || (row && row.canonicalName),
      resolved
    );
  });
  auditWorldBookLocalization(audit, card.character_book, 'character-book', namesOnly);
  exportedAdditionalCharacterBooks(card).forEach(function (book, index) {
    auditWorldBookLocalization(audit, book, 'additional-book-' + index, namesOnly);
  });
  return finishLocalizationAudit(audit);
}
function recommendedCardImportMode(audit) {
  return audit && Number(audit.totalMissing) > 0 ? 'ai' : 'direct';
}
function normalizeLocalizationTermRows(result) {
  var value = result && (result.terms || result.translations),
    rows = [];
  if (Array.isArray(value))
    rows = value.map(function (row, index) {
      if (Array.isArray(row)) return { id: row[0], zh: row[1], aliases: Array.isArray(row[2]) ? row[2] : [] };
      if (!row || typeof row !== 'object') return { id: String(index), zh: row, aliases: [] };
      return Object.assign({}, row, {
        id: row.id != null ? row.id : row.term_id != null ? row.term_id : row.key != null ? row.key : String(index),
        zh: row.zh || row.translation || row.translated_text || row.value || row.text || '',
        aliases: row.aliases || row.synonyms || [],
      });
    });
  else if (value && typeof value === 'object')
    rows = Object.keys(value).map(function (id) {
      var row = value[id];
      if (row && typeof row === 'object')
        return Object.assign({ id: id }, row, {
          zh: row.zh || row.translation || row.translated_text || row.value || row.text || '',
          aliases: row.aliases || row.synonyms || [],
        });
      return { id: id, zh: row, aliases: [] };
    });
  return rows.filter(function (row) {
    return row && row.id != null;
  });
}
function validLocalizationTermAliases(source, row) {
  return validLocalizationAliases([row && row.zh].concat((row && row.aliases) || []), 4).filter(function (value) {
    return importHasCjk(value) && localizationTermKey(value) !== localizationTermKey(source);
  });
}
function importLocalizationResultField(kind) {
  return kind === 'names' ? 'labels' : 'terms';
}
function importLocalizationRows(kind, result) {
  return kind === 'names' ? (result && result.labels) || [] : normalizeLocalizationTermRows(result);
}
function importLocalizationRowComplete(kind, input, row) {
  if (!row || String(row.id) !== String(input && input.id)) return false;
  if (kind === 'names')
    return (
      !!validLocalizedName(input && input.text, row.zh, row.strategy, input && input.kind) ||
      (input &&
        input.kind === 'person' &&
        input.allow_keep_original === true &&
        String(row.strategy || '').toLowerCase() === 'keep_original')
    );
  return validLocalizationTermAliases(input && input.source, row).length > 0;
}
function importLocalizationCompleteResult(payload, result) {
  var kind = payload && payload.kind === 'names' ? 'names' : 'terms',
    field = importLocalizationResultField(kind),
    inputs = new Map(
      ((payload && payload[field]) || []).map(function (row) {
        return [String(row && row.id), row];
      })
    ),
    complete = importLocalizationRows(kind, result).filter(function (row) {
      var input = inputs.get(String(row && row.id));
      return input && importLocalizationRowComplete(kind, input, row);
    }),
    filtered = {};
  filtered[field] = complete;
  return filtered;
}
function importLocalizationMissingIds(payload, result) {
  var kind = payload && payload.kind === 'names' ? 'names' : 'terms',
    field = importLocalizationResultField(kind),
    complete = importLocalizationCompleteResult(payload, result),
    actual = new Set(
      (complete[field] || []).map(function (row) {
        return String(row && row.id);
      })
    );
  return ((payload && payload[field]) || [])
    .map(function (row) {
      return String(row && row.id);
    })
    .filter(function (id) {
      return !actual.has(id);
    });
}
function mergeImportLocalizationResults(kind, base, incoming) {
  kind = kind === 'names' ? 'names' : 'terms';
  var field = importLocalizationResultField(kind),
    rows = new Map();
  [base, incoming].forEach(function (result) {
    importLocalizationRows(kind, result).forEach(function (row) {
      if (!row || row.id == null) return;
      var id = String(row.id),
        old = rows.get(id) || {},
        merged = Object.assign({}, old, row);
      merged.zh = String(row.zh || '').trim() || String(old.zh || '').trim();
      merged.aliases = window.YeyuPure.uniqueTextList(
        (old.aliases || []).concat(row.aliases || []),
        kind === 'names' ? 80 : 4
      );
      if (kind === 'names') merged.strategy = String(row.strategy || '').trim() || String(old.strategy || '').trim();
      rows.set(id, merged);
    });
  });
  var result = {};
  result[field] = Array.from(rows.values());
  return result;
}
function subsetImportLocalizationPayload(payload, ids) {
  var field = payload && payload.kind === 'names' ? 'labels' : 'terms',
    wanted = new Set(ids || []),
    next = Object.assign({}, payload);
  next[field] = ((payload && payload[field]) || []).filter(function (row) {
    return wanted.has(String(row && row.id));
  });
  return next;
}
function importLocalizationOutputLimit(payload) {
  var count =
    payload && payload.kind === 'names' ? (payload.labels || []).length : ((payload && payload.terms) || []).length;
  return Math.max(2048, Math.min(8192, 1024 + count * 84));
}
function importLocalizationPayloadRows(payload) {
  var field = payload && payload.kind === 'names' ? 'labels' : 'terms';
  return { field: field, rows: payload && Array.isArray(payload[field]) ? payload[field] : [] };
}
function importLocalizationJsonSchema(payload) {
  var field = importLocalizationPayloadRows(payload).field,
    properties = {
      id: { type: ['string', 'number'] },
      zh: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
    };
  if (field === 'labels') properties.strategy = { type: 'string' };
  var item = { type: 'object', required: ['id', 'zh'], additionalProperties: true, properties: properties },
    schema = { type: 'object', required: [field], additionalProperties: true, properties: {} };
  schema.properties[field] = { type: 'array', items: item };
  return schema;
}
function applyImportLocalizationStructuredMode(body, route, payload) {
  var caps = (route && route.capabilities) || {},
    schema = importLocalizationJsonSchema(payload);
  if (caps.native_json_schema === true) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'yeyu_import_localization', strict: true, schema: schema },
    };
  } else body.response_format = { type: 'json_object' };
  return body;
}
async function requestImportLocalization(payload, controller, ownerType, state) {
  var route = resolveApiRoute('importLocalization');
  if (!route.apiKey && route.protocol !== 'grok-subscription') throw new Error('未配置角色卡 AI 汉化供应商和模型');
  state = state || { requests: 0 };
  var system = settingsPromptText(ownerType === 'card' ? 'cardLocalizationPrompt' : 'worldBookLocalizationPrompt'),
    last = null,
    collected = null,
    remaining = payload,
    maxAttempts = 3;
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    if (controller.signal.aborted || _importLocalizationCancelled) {
      var cancelled = new Error('用户取消导入');
      cancelled.cancelled = true;
      throw cancelled;
    }
    state.requests++;
    var repair = attempt
      ? '\n\n格式修复要求：只返回本次仍缺失的 ID；不得省略、改写或新增 ID；每项必须提供有效中文结果。'
      : '';
    var body = {
      model: route.model,
      stream: false,
      max_tokens: importLocalizationOutputLimit(remaining),
      messages: [
        { role: 'system', content: system + repair },
        { role: 'user', content: JSON.stringify(remaining) },
      ],
    };
    applyImportLocalizationStructuredMode(body, route, remaining);
    applyThinkingForRoute(
      body,
      route,
      Object.assign(modelRouteRequestOptions('importLocalization'), { route: 'importLocalization' })
    );
    try {
      var resp = await fetchCompatibleCompletion(route, body, controller.signal),
        json = await resp.json(),
        parsed = parseStructuredCompletion(json, 'importLocalization');
      if (!parsed)
        throw new Error(
          'AI 汉化未返回完整 JSON' + (getCompletionDebug(json) ? '（' + getCompletionDebug(json) + '）' : '')
        );
      var valid = importLocalizationCompleteResult(remaining, parsed);
      collected = mergeImportLocalizationResults(payload.kind, collected, valid);
      var missing = importLocalizationMissingIds(payload, collected);
      if (!missing.length) return collected;
      remaining = subsetImportLocalizationPayload(payload, missing);
      last = new Error('AI 汉化结果仍有 ' + missing.length + ' 个术语缺少有效中文字段');
    } catch (error) {
      if (controller.signal.aborted || _importLocalizationCancelled) {
        var aborted = new Error('用户取消导入');
        aborted.cancelled = true;
        throw aborted;
      }
      last = error;
    }
    if (attempt < maxAttempts - 1) await waitMs(500 * Math.pow(2, attempt));
  }
  if (collected && last) last.partialResult = collected;
  throw last || new Error('AI 汉化失败');
}
function applyNameLocalizationTask(task, result) {
  var rows = {};
  ((result && result.labels) || []).forEach(function (row) {
    if (row && row.id) rows[String(row.id)] = row;
  });
  var changed = false;
  (task.labels || []).forEach(function (label) {
    var row = rows[label.id];
    if (!row) return;
    var zh = validLocalizedName(label.text, row.zh, row.strategy, label.kind),
      aliases = validLocalizationAliases([label.text].concat(row.aliases || [])),
      keepOriginal =
        label.kind === 'person' &&
        label.allowKeepOriginal === true &&
        String(row.strategy || '').toLowerCase() === 'keep_original';
    if (label.kind === 'category') {
      if (zh && !importHasCjk(label.target.localizedName)) {
        label.target.localizedName = zh;
        changed = true;
      }
    } else if (task.ownerType === 'card' && label.id === 'card') {
      if (zh && !importHasCjk(task.owner.localizedName)) {
        task.owner.localizedName = zh;
        changed = true;
      }
      task.owner.nameAliases = window.YeyuPure.uniqueTextList(
        (task.owner.nameAliases || []).concat([task.owner.name, zh]).concat(aliases),
        40
      );
    } else if (task.ownerType === 'card' && label.id.indexOf('participant:') === 0) {
      var participant = label.target;
      if (participant) {
        if (zh && !importHasCjk(participant.canonicalName)) {
          participant.canonicalName = zh;
          changed = true;
        }
        if (zh) {
          participant.nameLocalizationResolved = true;
          participant.nameLocalizationStrategy = String(row.strategy || 'transliteration');
        } else if (keepOriginal) {
          participant.nameLocalizationResolved = true;
          participant.nameLocalizationStrategy = 'keep_original';
          changed = true;
        }
        participant.aliases = window.YeyuPure.uniqueTextList(
          (participant.aliases || []).concat([participant.originalName, zh]).concat(aliases),
          30
        );
      }
    }
  });
  if (task.ownerType === 'card' && changed && task.owner && task.owner.participantRegistry)
    task.owner.participantRegistryVersion = 4;
  return changed;
}
function applyEntryLocalizationTask(task, result) {
  if (!task || task.kind !== 'terms') return false;
  var termRows = {};
  normalizeLocalizationTermRows(result).forEach(function (row) {
    termRows[String(row.id)] = row;
  });
  var affected = new Set(),
    changed = false;
  (task.terms || []).forEach(function (term) {
    var row = termRows[String(term.id)],
      aliases = row && validLocalizationTermAliases(term.source, row);
    if (!aliases || !aliases.length) return;
    (term.targets || []).forEach(function (target) {
      var entry = target.entry;
      if (!entry) return;
      affected.add(entry);
      if (target.kind === 'display' && !importHasCjk(entry.localizedName || entry.localized_name)) {
        entry.localizedName = aliases[0];
        changed = true;
      } else if (target.kind === 'primary') {
        var primaryExisting = wbEntryTriggerAliases(entry, false);
        entry.keyAliasMap = Object.assign({}, primaryExisting.map);
        entry.keyAliasMap[target.source] = window.YeyuPure.uniqueTextList(
          (entry.keyAliasMap[target.source] || []).concat(aliases),
          4
        );
        entry.keyAliases = window.YeyuPure.uniqueTextList(primaryExisting.aliases.concat(aliases), 240);
        changed = true;
      } else if (target.kind === 'secondary') {
        var secondaryExisting = wbEntryTriggerAliases(entry, true);
        entry.secondaryKeyAliasMap = Object.assign({}, secondaryExisting.map);
        entry.secondaryKeyAliasMap[target.source] = window.YeyuPure.uniqueTextList(
          (entry.secondaryKeyAliasMap[target.source] || []).concat(aliases),
          4
        );
        entry.secondaryKeyAliases = window.YeyuPure.uniqueTextList(secondaryExisting.aliases.concat(aliases), 240);
        changed = true;
      }
    });
  });
  affected.forEach(function (entry) {
    entry.localizationStatus = entryLocalizationNeedsWork(entry, task.namesOnly) ? 'pending' : 'complete';
  });
  return changed;
}
function markLocalizationTask(task, status) {
  if (!task || task.kind !== 'terms') return;
  (task.terms || []).forEach(function (term) {
    (term.targets || []).forEach(function (target) {
      if (target.entry)
        target.entry.localizationStatus = entryLocalizationNeedsWork(target.entry, task.namesOnly)
          ? status
          : 'complete';
    });
  });
}
function buildCardLocalizationTasks(cards) {
  var names = [],
    entries = [];
  (cards || []).forEach(function (card) {
    ensureCharacterIntelligence(card);
    var nameTask = buildCardNameTask(card),
      title = canonicalCharacterName(card) + ' 世界书';
    if (nameTask) names.push(nameTask);
    // The same books auditCardImportLocalization checks: the card book and Yeyu's extra bound books.
    [card.character_book].concat(exportedAdditionalCharacterBooks(card)).forEach(function (book) {
      if (!book || typeof book !== 'object') return;
      var bookNameTask = buildWorldBookCategoryNameTask(book, 'card', title);
      if (bookNameTask) names.push(bookNameTask);
      entries = entries.concat(
        buildEntryTasks(card, 'card', characterBookEntries(book), title, cardLocalizesNamesOnly(card))
      );
    });
  });
  return names.concat(entries);
}
function buildWorldBookLocalizationTasks(groups) {
  var names = [],
    entries = [];
  (groups || []).forEach(function (group) {
    var nameTask = buildWorldBookCategoryNameTask(group, 'group', String(group.name || '世界书'));
    if (nameTask) names.push(nameTask);
    entries = entries.concat(buildEntryTasks(group, 'group', group.entries || [], String(group.name || '世界书')));
  });
  return names.concat(entries);
}
function importLocalizationTaskIds(tasks) {
  var ids = [];
  (tasks || []).forEach(function (task) {
    importLocalizationPayloadRows(task && task.payload).rows.forEach(function (row) {
      if (row && row.id != null) ids.push(String(row.id));
    });
  });
  return window.YeyuPure.uniqueTextList(ids, 0);
}
async function runLocalizationTasks(tasks, progressText, options) {
  options = options || {};
  var localizationRoute = resolveApiRoute('importLocalization');
  if (!localizationRoute.apiKey && localizationRoute.protocol !== 'grok-subscription') {
    tasks.forEach(function (task) {
      markLocalizationTask(task, 'pending');
    });
    return {
      total: tasks.length,
      completed: 0,
      failed: options.requireComplete ? tasks.length : 0,
      skipped: !options.requireComplete,
      unresolved: tasks.length,
      unresolvedItems: [],
      missingIds: importLocalizationTaskIds(tasks),
      requests: 0,
    };
  }
  if (!tasks.length)
    return {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: false,
      unresolved: 0,
      unresolvedItems: [],
      missingIds: [],
      requests: 0,
    };
  if (!_importLocalizationController || _importLocalizationController.signal.aborted)
    _importLocalizationController = new AbortController();
  _importProgressTotal = Math.max(_importProgressTotal, _importProgressDone + tasks.length);
  var completed = 0,
    failed = 0,
    state = { requests: 0 },
    missingIds = new Set();
  await mapWithConcurrency(tasks, 4, async function (task) {
    if (_importLocalizationCancelled) return null;
    try {
      var result = await requestImportLocalization(task.payload, _importLocalizationController, task.ownerType, state);
      if (result) {
        if (task.kind === 'names') applyNameLocalizationTask(task, result);
        else applyEntryLocalizationTask(task, result);
        completed++;
      }
      updateImportProgress(task.kind === 'names' ? '正在整理角色和分类名称' : progressText, task.title);
      return result;
    } catch (error) {
      if (error && error.cancelled) return null;
      importLocalizationMissingIds(task.payload, null).forEach(function (id) {
        missingIds.add(String(id));
      });
      failed++;
      markLocalizationTask(task, 'failed');
      updateImportProgress('正在检查未完成内容', task.title + ' · ' + String(error.message || error));
      return null;
    }
  });
  return {
    total: tasks.length,
    completed: completed,
    failed: failed,
    skipped: false,
    cancelled: _importLocalizationCancelled,
    unresolvedItems: [],
    missingIds: Array.from(missingIds),
    requests: state.requests,
  };
}
function countPendingEntryLocalizations(owners, entryGetter) {
  var count = 0;
  (owners || []).forEach(function (owner) {
    (entryGetter(owner) || []).forEach(function (entry) {
      if (entryLocalizationNeedsWork(entry)) count++;
    });
  });
  return count;
}
function finalizeLocalizedWorldBookNames(owners, ownerType) {
  (owners || []).forEach(function (owner) {
    var book = ownerType === 'card' && owner ? owner.character_book : owner;
    if (!book) return;
    if (isGenericExportWorldBookName(book.name) || isGenericExportWorldBookName(book.localizedName)) {
      var title = ownerType === 'card' ? canonicalCharacterName(owner) + ' 世界书' : '导入世界书';
      book.localizedName = fallbackLocalizedWorldBookName(ownerType, title);
      book.localizationStatus = 'complete';
    }
  });
}
function localizationUnresolvedItemText(item) {
  item = item || {};
  return String(item.source || item.id || '未知字段').slice(0, 120) + '：' + String(item.reason || '未完成');
}
function assertLocalizationReadyForCommit(report, label, subject) {
  report = report || {};
  subject = String(subject || '角色');
  if (report.cancelled || _importLocalizationCancelled) {
    var cancelled = new Error('用户取消导入；未导入任何' + subject + '，源文件与待导入内容未改变');
    cancelled.cancelled = true;
    throw cancelled;
  }
  if (report.skipped) return true;
  var failed = Math.max(0, Number(report.failed) || 0),
    unresolved = Math.max(0, Number(report.unresolved) || 0),
    missingIds = Array.isArray(report.missingIds) ? report.missingIds.filter(Boolean) : [],
    missing = missingIds.length,
    invalid = Math.max(0, Number(report.invalid) || 0),
    unresolvedItems = Array.isArray(report.unresolvedItems) ? report.unresolvedItems : [];
  if (!failed && !unresolved && !missing && !invalid) return true;
  var remaining = Math.max(unresolved, missing, unresolvedItems.length, failed + invalid),
    preview = unresolvedItems.slice(0, 3).map(localizationUnresolvedItemText),
    details = preview.length
      ? ' 最先发现：' +
        preview.join('；') +
        (unresolvedItems.length > 3 ? '（另有 ' + (unresolvedItems.length - 3) + ' 项可查看）' : '')
      : '',
    error = new Error(
      (label || '汉化') +
        '尚有 ' +
        remaining +
        ' 项名称或触发词没有可用中文结果。' +
        details +
        ' 未导入任何' +
        subject +
        '，原文件与待导入内容未改变；请检查汉化模型和网络后重试。'
    );
  error.localizationIncomplete = true;
  error.unresolvedItems = unresolvedItems;
  error.missingIds = missingIds;
  throw error;
}
async function showLocalizationFailureDetails(error) {
  var items = error && Array.isArray(error.unresolvedItems) ? error.unresolvedItems : [];
  if (items.length <= 3) return;
  var first = items.slice(0, 3).map(localizationUnresolvedItemText).join('\n'),
    viewAll = await appConfirm(
      '最先发现的 3 项：\n' + first + '\n\n另有 ' + (items.length - 3) + ' 项。',
      '汉化未解决项',
      '查看全部'
    );
  if (!viewAll) return;
  await appConfirm(
    items
      .map(function (item, index) {
        return index + 1 + '. ' + localizationUnresolvedItemText(item);
      })
      .join('\n'),
    '全部未解决项',
    '关闭'
  );
}
async function localizeImportedCards(cards) {
  var tasks = buildCardLocalizationTasks(cards),
    report = await runLocalizationTasks(tasks, '正在生成并检查中文世界书触发词', { requireComplete: true });
  finalizeLocalizedWorldBookNames(cards, 'card');
  var audits = (cards || []).map(auditCardImportLocalization);
  report.unresolvedItems = audits.reduce(function (items, audit) {
    return items.concat(audit.unresolvedItems || []);
  }, []);
  report.unresolved = report.unresolvedItems.length;
  report.missingIds = Array.isArray(report.missingIds) ? window.YeyuPure.uniqueTextList(report.missingIds, 0) : [];
  report.invalid = 0;
  return report;
}
async function localizeWorldBookGroups(groups, options) {
  var report = await runLocalizationTasks(
    buildWorldBookLocalizationTasks(groups),
    '正在并行生成中文世界书触发词',
    options || {}
  );
  finalizeLocalizedWorldBookNames(groups, 'group');
  report.unresolved = countPendingEntryLocalizations(groups, function (group) {
    return group.entries || [];
  });
  return report;
}
let pending = [];
var _pendingImportModes = new WeakMap();
var _pendingComponentModes = new WeakMap();
function pendingImportAudit(card) {
  var audit = auditCardImportLocalization(card);
  return { audit: audit, suggested: recommendedCardImportMode(audit) };
}
function pendingImportMode(card) {
  var current = _pendingImportModes.get(card);
  return current === 'ai' || current === 'direct' ? current : pendingImportAudit(card).suggested;
}
function setPendingImportMode(index, mode) {
  var card = pending[Number(index)];
  if (!card || !['ai', 'direct'].includes(mode)) return;
  _pendingImportModes.set(card, mode);
  syncImportPreviewChoices();
}
// A card that carries an explicit choice keeps it on re-import instead of silently promoting
// 仅基础内容 back to 完整保留. Cards without the marker still default to full.
function savedComponentMode(card) {
  var mode = String((((card && card.extensions) || {}).yeyu || {}).componentImportMode || '');
  return mode === 'basic' || mode === 'full' ? mode : '';
}
function pendingComponentMode(card) {
  var chosen = _pendingComponentModes.get(card);
  return chosen === 'basic' || chosen === 'full' ? chosen : savedComponentMode(card) || 'full';
}
function setPendingComponentMode(index, mode) {
  var card = pending[Number(index)];
  if (!card || !['full', 'basic'].includes(mode)) return;
  _pendingComponentModes.set(card, mode);
  syncImportPreviewChoices();
}
function syncImportPreviewChoices() {
  var preview = $('import-preview');
  preview.querySelectorAll('.import-mode-card').forEach(function (row, index) {
    row.dataset.importIndex = String(index);
    row.querySelectorAll('input[type="radio"]').forEach(function (input) {
      var component = input.name.startsWith('component-mode-');
      input.name = (component ? 'component-mode-' : 'import-mode-') + index;
      input.checked =
        input.value === (component ? pendingComponentMode(pending[index]) : pendingImportMode(pending[index]));
    });
  });
  var label = preview.querySelector('[data-import-confirm-label]');
  if (label) label.textContent = '确认导入 ' + pending.length + ' 个角色';
}
function releasePendingImportUrls(items) {
  (items || []).forEach(function (c) {
    ['avatar_image', 'background_image'].forEach(function (k) {
      var value = c && c[k];
      if (typeof value === 'string' && value.startsWith('blob:')) URL.revokeObjectURL(value);
    });
  });
}
function resetImport() {
  releasePendingImportUrls(pending);
  $('import-preview').innerHTML = '';
  $('paste-json').value = '';
  $('paste-result').innerHTML = '';
  pending = [];
  _pendingImportModes = new WeakMap();
  _pendingComponentModes = new WeakMap();
}
function removePendingImport(index) {
  var rows = Array.from($('import-preview').querySelectorAll('.import-mode-card')),
    row = rows[index],
    body = $('import-preview').closest('.modal-body'),
    bounds = body.getBoundingClientRect(),
    anchor = rows.find(function (candidate) {
      var rect = candidate.getBoundingClientRect();
      return candidate !== row && rect.bottom > bounds.top && rect.top < bounds.bottom;
    }),
    anchorTop = anchor && anchor.getBoundingClientRect().top,
    restoreFocus = row && row.contains(document.activeElement);
  var removed = pending.splice(index, 1);
  releasePendingImportUrls(removed);
  if (row) row.remove();
  if (pending.length) syncImportPreviewChoices();
  else renderImportPreview();
  if (anchor) body.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  if (restoreFocus) {
    var next = rows[Number(index) + 1] || rows[Number(index) - 1];
    (next ? next.querySelector('[aria-label="移除待导入角色"]') : $('import-modal').querySelector('.modal')).focus({
      preventScroll: true,
    });
  }
}
// One component can appear in more than one state: a card may run some ST scripts while
// keeping others that 夜欲 does not execute. Each state is its own row with its own count, so a
// summary can never hide an unsupported item behind a runnable one.
// [state, disclosure label, summary label]
var CARD_DEPENDENCY_GROUPS = [
  ['ready', '可直接运行', '可直接运行'],
  ['disabled', '支持但当前关闭', '当前关闭'],
  ['preserved', '已保留但不执行', '保留不执行'],
  ['missing', '当前缺失', '缺失'],
];
function cardDependencyReportHtml(report, options) {
  report = report || { items: [], counts: {} };
  options = options || {};
  var items = Array.isArray(report.items) ? report.items : [],
    counts = report.counts || {},
    context = options.context || 'settings';
  if (!items.length)
    return (
      '<p class="card-dependency-empty">' +
      (context === 'import'
        ? '未检测到额外运行依赖，角色、素材和世界书都能正常导入。'
        : '这张卡片没有额外的运行依赖。') +
      '</p>'
    );
  return (
    '<section class="card-dependency-report" data-dependency-context="' +
    escAttr(context) +
    '"><p class="card-dependency-summary">' +
    CARD_DEPENDENCY_GROUPS.map(function (group) {
      var count = Number(counts[group[0]]) || 0;
      return (
        '<span data-dependency-state="' +
        group[0] +
        '"' +
        (count ? '' : ' data-empty') +
        '>' +
        group[2] +
        ' <b>' +
        count +
        '</b></span>'
      );
    }).join('') +
    '</p><div class="card-dependency-groups">' +
    CARD_DEPENDENCY_GROUPS.map(function (group) {
      var rows = items.filter(function (item) {
        return item.group === group[0];
      });
      if (!rows.length) return '';
      return (
        '<details class="card-dependency-details" data-dependency-state="' +
        group[0] +
        '"><summary>' +
        esc(group[1]) +
        '</summary><div class="card-dependency-list">' +
        rows
          .map(function (item) {
            var proof = (item.evidence || [])
                .map(function (row) {
                  var location = String(row.source || ''),
                    address = String(row.address || ''),
                    detail = String(row.detail || '');
                  return (
                    '<li><span>' +
                    esc(location + (detail ? ' · ' + detail : '')) +
                    '</span>' +
                    (address ? '<code>' + esc(address) + '</code>' : '') +
                    '</li>'
                  );
                })
                .join(''),
              count = Math.max(0, Math.floor(Number(item.count) || 0)),
              impact = String(item.impact || '').trim(),
              missing = String(item.missing || '').trim(),
              sameDetail =
                missing && missing.replace(/[\s。！？.!?]+$/g, '') === impact.replace(/[\s。！？.!?]+$/g, ''),
              description =
                impact +
                (missing && !sameDetail
                  ? (impact ? ' ' : '') + missing + (/[。！？.!?]$/.test(missing) ? '' : '。')
                  : '');
            return (
              '<article class="card-dependency-item"><strong>' +
              esc(item.label || item.id) +
              (count ? '<small>' + count + ' 项</small>' : '') +
              '</strong><p>' +
              esc(description) +
              '</p>' +
              (proof
                ? '<details class="card-dependency-evidence"><summary>查看依据</summary><ul>' +
                  proof +
                  '</ul></details>'
                : '') +
              '</article>'
            );
          })
          .join('') +
        '</div></details>'
      );
    }).join('') +
    '</div></section>'
  );
}
async function handleFileImport(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;

  releasePendingImportUrls(pending);
  pending = [];
  _pendingImportModes = new WeakMap();
  _pendingComponentModes = new WeakMap();
  $('import-preview').innerHTML = '<p class="ui-empty">正在解析…</p>';
  showImportProgress('正在解析角色卡', '正在读取 ' + f.name + '…', 1);
  try {
    var chars = [],
      fname = (f.name || '').toLowerCase();
    if (fname.endsWith('.png')) chars = [await readPNG(f)];
    else if (fname.endsWith('.charx')) chars = [await readCHARX(f)];
    else if (fname.endsWith('.json')) {
      var j = parseCharacterCardJsonText(await f.text()),
        sourceCards = Array.isArray(j) ? j : [j];
      chars = parseCardList(sourceCards);
    } else throw new Error('请选择 PNG、JSON 或 CHARX 的 V2/V3 角色卡');
    pending = chars.filter(Boolean);
    pending.forEach(function (char) {
      char._src = f.name;
      ensureCharacterIntelligence(applyChineseNicknameAsDisplayName(char));
    });
  } catch (err) {
    toast('导入 ' + f.name + ' 失败：' + err.message, 'err');
    console.error('Import error for', f.name, err);
  } finally {
    renderImportPreview();
    hideImportProgress();
    e.target.value = '';
  }
}

function importModeOptionHtml(name, index, value, checked, handler, title, detail) {
  return (
    '<label class="import-mode-option"><input type="radio" name="' +
    name +
    '-' +
    index +
    '" value="' +
    value +
    '"' +
    (checked ? ' checked' : '') +
    ' onchange="' +
    handler +
    "(this.closest('.import-mode-card').dataset.importIndex,'" +
    value +
    '\')"><span><strong>' +
    title +
    '</strong><small>' +
    detail +
    '</small></span></label>'
  );
}
function renderImportPreview() {
  if (!pending.length) {
    $('import-preview').innerHTML = '<p class="ui-empty">没有可导入的角色。可以重新选择文件或粘贴 JSON。</p>';
    return;
  }
  let h = '';
  pending.forEach((c, i) => {
    const previewSrc =
      typeof displayImageSrc === 'function' ? displayImageSrc(c, 'avatar_image') : safeImage(c.avatar_image, true);
    const hasRemote = remoteImageUrl(c.avatar_image) || (c.importMeta && remoteImageUrl(c.importMeta.sourceAvatar));
    const av = previewSrc
      ? `<img class="import-card-avatar" src="${escAttr(previewSrc)}" alt="" aria-hidden="true">`
      : `<span class="import-card-avatar" aria-hidden="true"></span>`;
    const imageHint = hasRemote ? '头像待确认下载' : c.avatar_image ? '头像已读取' : '未检测到本地头像';
    const noteHint = c.creator_notes ? '有作者注记，首次对话前向你展示' : '无作者注记';
    const inlineCount = Array.isArray(c.media_assets)
      ? c.media_assets.filter(function (asset) {
          return asset && asset.kind === 'opening';
        }).length
      : 0;
    const participantCount = (c.participantRegistry || []).length || 1;
    const originalDescription = String(c.description || c.personality || '').trim();
    const descriptionPreview = originalDescription.slice(0, 70) + (originalDescription.length > 70 ? '…' : '');
    const risu = typeof isRisuCharacter === 'function' && isRisuCharacter(c);
    const modeInfo = pendingImportAudit(c),
      audit = modeInfo.audit,
      mode = pendingImportMode(c),
      componentMode = pendingComponentMode(c),
      dependencyReport =
        typeof analyzeCardDependencies === 'function'
          ? analyzeCardDependencies(c)
          : { items: [], counts: { ready: 0, preserved: 0, missing: 0 } },
      languageLabel = audit.language === 'chinese' ? '纯中文' : audit.language === 'mixed' ? '中英混合' : '主要非中文',
      risk = audit.primaryMissing + audit.secondaryMissing,
      auditItems = cardImportAuditItems(c),
      unsupportedItems = auditItems.unsupported,
      regexSummary =
        !risu && typeof regexScriptImportSummary === 'function'
          ? regexScriptImportSummary(c)
          : {
              total: 0,
              disabled: 0,
              unsupportedTarget: 0,
              worldBook: 0,
              unsupportedPhase: 0,
              unsafe: 0,
              unrecognizedReplacement: 0,
              replacementMacros: {},
            },
      // An unrecognised macro is kept verbatim and the script still runs, so it is not a problem.
      regexProblems = regexSummary.unsupportedTarget + regexSummary.unsupportedPhase + regexSummary.unsafe,
      regexHint = regexSummary.total
        ? `<p class="import-regex-summary${regexProblems ? ' warn' : ''}">随卡正则脚本 ${regexSummary.total} 条将保存为这个角色的专属脚本${regexSummary.disabled ? ' · ' + regexSummary.disabled + ' 条当前关闭' : ''}${regexSummary.worldBook ? ' · ' + regexSummary.worldBook + ' 条作用于世界书正文' : ''}${regexSummary.unsupportedTarget ? ' · ' + regexSummary.unsupportedTarget + ' 条没有当前支持的作用对象' : ''}${regexSummary.unsupportedPhase ? ' · ' + regexSummary.unsupportedPhase + ' 条没有当前支持的作用环节' : ''}${regexSummary.unsafe ? ' · ' + regexSummary.unsafe + ' 条正则不安全或无法在当前设备使用，导入后保留但不会执行' : ''}${regexSummary.unrecognizedReplacement ? ' · ' + regexSummary.unrecognizedReplacement + ' 条替换内容含未识别的宏，照常执行，宏标记原样保留' : ''}</p>`
        : '',
      meta = [c._src, imageHint, inlineCount + ' 条开场白图片', noteHint]
        .concat(participantCount > 1 ? ['检测到 ' + participantCount + ' 名成员'] : [])
        .filter(Boolean)
        .map(esc)
        .join(' · ');

    h += `<article class="import-mode-card" data-import-index="${i}">
      <header class="import-card-head">${av}<div class="import-card-title"><strong>${esc(canonicalCharacterName(c))}</strong><small>${meta}</small></div><button type="button" class="btn icon sm text" onclick="removePendingImport(this.closest('.import-mode-card').dataset.importIndex)" aria-label="移除待导入角色">${uiIcon('close')}</button></header>
      ${descriptionPreview ? `<p class="import-card-desc">${esc(descriptionPreview)}</p>` : ''}
      <section class="import-card-section"><h4>内容检查</h4>
      <p class="import-audit${risk ? ' warn' : ''}">${languageLabel} · 可补充中文的名称 ${audit.names} · 世界书分类 ${audit.categories} · 条目名 ${audit.entryNames} · 缺少中文别名的主关键词 ${audit.primaryMissing} · 次关键词 ${audit.secondaryMissing} · 已有中文别名 ${audit.aliasesReady}</p>
      <p class="import-suggestion">建议${modeInfo.suggested === 'ai' ? ' AI 汉化后导入' : '直接导入（内容已是中文）'}${risk ? '<span class="import-risk">；直接导入时 ' + risk + ' 个外语触发词可能无法被中文对话触发</span>' : ''}</p>
      ${regexHint}
      ${importRuntimeNotesHtml(auditItems.notes)}
      ${importUnsupportedItemsHtml(unsupportedItems)}</section>
      <section class="import-card-section"><h4>运行依赖</h4>${cardDependencyReportHtml(dependencyReport, { context: 'import' })}</section>
      <div class="import-choice-group"><h4>内容处理</h4><div class="import-mode-options">${importModeOptionHtml('import-mode', i, 'ai', mode === 'ai', 'setPendingImportMode', 'AI 汉化后导入', '为名称和触发词补充中文，结果全部准备好后才保存；不改写开场白和正文')}${importModeOptionHtml('import-mode', i, 'direct', mode === 'direct', 'setPendingImportMode', '直接导入', '不调用 AI，名称、关键词、正文和别名保持原样')}</div></div>
      ${risu ? '' : `<div class="import-choice-group"><h4>卡片脚本</h4><div class="import-mode-options">${importModeOptionHtml('component-mode', i, 'full', componentMode === 'full', 'setPendingComponentMode', '完整保留（推荐）', '保留全部材料；夜欲支持的组件按本卡开关运行，其余只保存不执行')}${importModeOptionHtml('component-mode', i, 'basic', componentMode === 'basic', 'setPendingComponentMode', '仅基础内容', '角色、素材和世界书照常导入；关闭随卡正则和本卡脚本，以后可在卡片设置开启。提示词模板（EJS）不受此项控制，照常执行')}</div></div>`}
      </article>`;
  });
  h += `<button type="button" class="btn primary import-confirm" onclick="confirmImport()"><span data-import-confirm-label>确认导入 ${pending.length} 个角色</span></button>`;
  $('import-preview').innerHTML = h;
}
function rawCharacterBookForCard(c) {
  var meta = (c && c.importMeta) || {};
  if (meta.rawCharacterBook && typeof meta.rawCharacterBook === 'object') return meta.rawCharacterBook;
  var raw = meta.rawCard && typeof meta.rawCard === 'object' ? meta.rawCard : null,
    data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
  return (
    (data && firstCardValue(data, ['character_book', 'characterBook', 'lorebook', 'world_info', 'worldInfo'], null)) ||
    (c && c.character_book) ||
    null
  );
}
function exportedAdditionalCharacterBooks(c) {
  var ext = c && c.extensions && typeof c.extensions === 'object' ? c.extensions.yeyu : null;
  return ext && Array.isArray(ext.boundWorldBooks)
    ? ext.boundWorldBooks.filter(function (book) {
        return book && typeof book === 'object' && !Array.isArray(book);
      })
    : [];
}
function worldBookImportEntryRows(book) {
  var source = book && book.entries;
  if (Array.isArray(source))
    return source.map(function (value, index) {
      return { value: value, index: index, key: '' };
    });
  if (source && typeof source === 'object')
    return Object.keys(source)
      .filter(function (key) {
        return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
      })
      .map(function (key, index) {
        return { value: source[key], index: index, key: key };
      });
  return [];
}
function worldBookImportEntryLabel(entry, index, key) {
  var label = String(
    (entry && firstCardValue(entry, ['localizedName', 'localized_name', 'name', 'title', 'comment', 'notes'], '')) ||
      key ||
      ''
  ).trim();
  return label || '第 ' + (index + 1) + ' 条';
}
function worldBookImportUnsupportedItems(book, bookLabel) {
  var items = [],
    seen = new Set(),
    prefix = String(bookLabel || (book && book.name) || '').trim(),
    add = function (label, reason) {
      var title = prefix ? prefix + ' / ' + label : label,
        text = '「' + title + '」：' + reason;
      if (!seen.has(text)) {
        seen.add(text);
        items.push(text);
      }
    };
  worldBookImportEntryRows(book).forEach(function (row) {
    var entry = row.value;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    var extensions =
        entry.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
          ? entry.extensions
          : {},
      label = worldBookImportEntryLabel(entry, row.index, row.key),
      position = firstCardValue(entry, ['position'], extensions.position),
      vectorized = firstCardValue(entry, ['vectorized'], extensions.vectorized),
      keys = wbKeyList(firstCardValue(entry, ['keys', 'key', 'keywords', 'primary_keys'], [])),
      constant = firstCardValue(entry, ['constant', 'always_active', 'alwaysActive'], false),
      outletName = String(firstCardValue(entry, ['outletName', 'outlet_name'], extensions.outlet_name) || '').trim();
    if (wbPosition(position) === 'outlet')
      add(
        label,
        outletName
          ? '放在名为「' + outletName + '」的出口；只有你的提示词里写了 {{outlet::' + outletName + '}} 才会被用上。'
          : '设置为出口位置但没有填出口名称；内容会保留，但不会进入对话。'
      );
    if (
      wbBool(vectorized, false) &&
      !keys.length &&
      !wbBool(constant, false) &&
      !(
        typeof vectorRetrievalConfigured === 'function' &&
        vectorRetrievalConfigured(typeof D !== 'undefined' && D && D.settings)
      )
    )
      add(label, '只设置了语义匹配且没有普通关键词；请先在“设置 > 语义检索”开启并配好语义检索，否则这条不会触发。');
    if (wbEntryForcesRegex(entry)) {
      var safety = wbRegexSafetyForKeys(
        keys,
        wbBool(firstCardValue(entry, ['case_sensitive', 'caseSensitive'], false), false),
        true
      );
      if (!safety.valid) add(label, '正则规则无效或不安全；内容会保留，但这条不会触发。');
    }
  });
  return items;
}
function cardPlayableImportText(c, raw) {
  var source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {},
    root = source.data && typeof source.data === 'object' && !Array.isArray(source.data) ? source.data : source,
    parts = [],
    add = function (value) {
      if (typeof value === 'string') {
        if (value) parts.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
    };
  [
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'system_prompt',
    'post_history_instructions',
    'character_version',
    'alternate_greetings',
  ].forEach(function (key) {
    add(root[key] != null ? root[key] : c && c[key]);
  });
  function addBook(book) {
    worldBookImportEntryRows(book).forEach(function (row) {
      var entry = row.value;
      if (typeof entry === 'string') add(entry);
      else if (entry && typeof entry === 'object' && !Array.isArray(entry))
        add(firstCardValue(entry, ['content', 'text', 'value', 'entry', 'prompt'], ''));
    });
  }
  addBook(typeof rawCharacterBookForCard === 'function' ? rawCharacterBookForCard(c) : root.character_book);
  (typeof exportedAdditionalCharacterBooks === 'function' ? exportedAdditionalCharacterBooks(c) : []).forEach(addBook);
  return parts.join('\n');
}
function cardImportUnevaluatedMacroCounts(text) {
  if (typeof characterMacroUnsupportedCounts === 'function') {
    return characterMacroUnsupportedCounts(text);
  }
  var supported = {
      char: 1,
      user: 1,
      bot: 1,
      random: 1,
      pick: 1,
      roll: 1,
      reverse: 1,
      comment: 1,
      setvar: 1,
      getvar: 1,
      addvar: 1,
      incvar: 1,
      decvar: 1,
      hasvar: 1,
      varexists: 1,
      deletevar: 1,
      flushvar: 1,
      setglobalvar: 1,
      getglobalvar: 1,
      addglobalvar: 1,
      incglobalvar: 1,
      decglobalvar: 1,
      hasglobalvar: 1,
      globalvarexists: 1,
      deleteglobalvar: 1,
      flushglobalvar: 1,
      else: 1,
      space: 1,
      newline: 1,
      trim: 1,
      noop: 1,
      input: 1,
      time: 1,
      date: 1,
      weekday: 1,
      isotime: 1,
      isodate: 1,
      datetimeformat: 1,
      idleduration: 1,
      idle_duration: 1,
      time_utc: 1,
      timediff: 1,
      lastmessage: 1,
      lastmessageid: 1,
      lastusermessage: 1,
      lastcharmessage: 1,
      firstincludedmessageid: 1,
      firstdisplayedmessageid: 1,
      lastswipeid: 1,
      currentswipeid: 1,
      allchatrange: 1,
    },
    counts = {},
    re = new RegExp('\\{\\{\\s*(\\/\\/|[#/:]*[A-Za-z_][\\w]*)((?:::?)[^{}]*)?', 'g'),
    match;
  while ((match = re.exec(String(text || '')))) {
    var raw = match[1];
    if (raw === '//') continue;
    var written = String(raw || '').replace(/^[#/:]+/, ''),
      name = written.toLowerCase();
    if (!name || supported[name]) continue;
    written += String(match[2] || '').replace(/\s+$/, '');
    counts[written] = (counts[written] || 0) + 1;
  }
  return counts;
}
function cardImportMacroNameCount(text, name) {
  var re = new RegExp('\\{\\{\\s*' + escapeRegexText(String(name || '')) + '\\b', 'gi'),
    n = 0;
  while (re.exec(String(text || ''))) n += 1;
  return n;
}
// Two separate lists on purpose: `unsupported` is material the import recognises but will not
// apply, `notes` is material that does run and only needs an explanation. Putting a line that ends
// in "照常展开" under a "识别但不应用" heading contradicts itself, so the heading follows the bucket.
function cardImportAuditItems(c) {
  var raw =
      c && c.importMeta && c.importMeta.rawCard && typeof c.importMeta.rawCard === 'object' ? c.importMeta.rawCard : {},
    data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw,
    declaredAssets = Array.isArray(data.assets) ? data.assets : [],
    mediaAssets = Array.isArray(c && c.media_assets) ? c.media_assets : [],
    declaredAssetCount = 0,
    availableAsset = false,
    items = [],
    notes = [];
  declaredAssets.forEach(function (declared, index) {
    var uri = String((declared && (declared.uri || declared.url || declared.src)) || ''),
      icon = declared && String(declared.type || '').toLowerCase() === 'icon',
      meta = c && c.importMeta;
    // ccdefault points to the card itself, not a separately materialized asset.
    if (icon && uri === 'ccdefault:') return;
    declaredAssetCount += 1;
    var id = cardAssetStableId(declared, index, 'ccv3_asset_'),
      resolvedIcon =
        icon &&
        ((meta &&
          meta.container === 'charx' &&
          meta.embeddedCardImage === true &&
          /^data:image\//i.test(String(c.avatar_image || ''))) ||
          (/^(?:data:image\/|https?:\/\/)/i.test(uri) &&
            (String(c.avatar_image || '') === uri || String((meta && meta.sourceAvatar) || '') === uri)));
    availableAsset =
      availableAsset ||
      resolvedIcon ||
      mediaAssets.some(function (asset) {
        return (
          asset &&
          asset.kind === 'ccv3_asset' &&
          asset.id === id &&
          (asset.status === 'ready' || asset.status === 'remote')
        );
      });
  });
  if (declaredAssetCount && !availableAsset)
    items.push('「随卡资产」：声明了 ' + declaredAssetCount + ' 项资产，但 0 项可解析；相关图片可能无法显示。');
  var unavailableMedia = mediaAssets.filter(function (asset) {
    return asset && asset.kind === 'ccv3_asset' && asset.status === 'unavailable';
  });
  if (unavailableMedia.length)
    items.push(
      '「不可用素材」：' +
        unavailableMedia
          .map(function (asset) {
            return asset.name || asset.originalUri || asset.id;
          })
          .join('、') +
        '。其余卡片内容可继续导入。'
    );
  var importMeta = (c && c.importMeta) || {};
  if (importMeta.container === 'charx' && importMeta.embeddedCardImage !== true && !importMeta.avatarUserReplaced) {
    var embeddedIcons = declaredAssets.filter(function (asset) {
        return (
          asset &&
          String(asset.type || '').toLowerCase() === 'icon' &&
          /^(?:embed(?:d)?ed:\/\/|__asset:)/i.test(String(asset.uri || ''))
        );
      }),
      missingIcon =
        embeddedIcons.find(function (asset) {
          return String(asset.name || '').toLowerCase() === 'main';
        }) || embeddedIcons[0];
    if (missingIcon)
      items.push(
        '「主头像」：声明的头像素材 ' +
          String(missingIcon.name || missingIcon.uri) +
          ' 在 CHARX 文件里找不到或不是图片，已使用默认头像，可在角色设置里更换。'
      );
  }
  if (typeof isRisuCharacter === 'function' && isRisuCharacter(c)) {
    var playableMedia = mediaAssets.filter(function (asset) {
      return (
        asset && asset.kind === 'ccv3_asset' && asset.status === 'ready' && /^(?:audio|video)\//i.test(asset.mime || '')
      );
    }).length;
    if (playableMedia) notes.push('「音视频素材」：随卡保存 ' + playableMedia + ' 项音频或视频，卡片可按素材名播放。');
    // Risu has one authoritative capability report directly above the legacy warning block.
    // Keeping a second phase list here previously contradicted the live runtime and counted
    // ordinary exporter defaults as unsupported card material.
    return { unsupported: items, notes: notes };
  }
  var seen = new Set(items),
    collect = function (list, text) {
      text = String(text || '').trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        list.push(text);
      }
    },
    add = function (text) {
      collect(items, text);
    },
    addNote = function (text) {
      collect(notes, text);
    };
  var version = Number(String(raw.spec_version || '').split('.')[0]);
  if (Number.isFinite(version) && version > 3)
    add('「角色卡版本 ' + String(raw.spec_version) + '」：高于当前可识别规范，未认识的新功能不会生效。');
  (Array.isArray(data.assets) ? data.assets : []).forEach(function (asset, index) {
    if (!asset || typeof asset !== 'object') return;
    var type = String(asset.type || '').toLowerCase(),
      ext = String(asset.ext || asset.name || asset.uri || ''),
      image =
        /\.(?:png|jpe?g|webp|gif|avif|apng)$/i.test(ext) ||
        ['icon', 'avatar', 'portrait', 'background', 'emotion', 'user_icon'].includes(type);
    if (image) return;
    var label = String(asset.name || asset.type || '素材 ' + (index + 1)).trim();
    add('「素材 ' + label + '」：会随角色卡保留，但当前不展示或播放。');
  });
  var playable = cardPlayableImportText(c, raw),
    setvarCount = cardImportMacroNameCount(playable, 'setvar'),
    getvarCount = cardImportMacroNameCount(playable, 'getvar');
  if (setvarCount || getvarCount)
    add(
      '「变量求值顺序」：定义只在其所在内容实际加入本轮时生效；写在定义之前的引用会得到空内容。本卡有定义 ' +
        setvarCount +
        ' 处、引用 ' +
        getvarCount +
        ' 处。'
    );
  var unavailable =
      typeof characterMacroUnavailableCounts === 'function' ? characterMacroUnavailableCounts(playable) : {},
    unavailableNames = Object.keys(unavailable).sort();
  if (unavailableNames.length)
    add(
      '「ST 官方宏缺少宿主能力」：' +
        unavailableNames
          .map(function (name) {
            var reason =
              typeof CHARACTER_OFFICIAL_UNAVAILABLE_MACROS === 'object' && CHARACTER_OFFICIAL_UNAVAILABLE_MACROS[name]
                ? '（' + CHARACTER_OFFICIAL_UNAVAILABLE_MACROS[name] + '）'
                : '';
            return name + ' ' + unavailable[name] + ' 处' + reason;
          })
          .join('、') +
        '。这些宏已识别，但当前不会伪造结果，标记会原样进入提示词。'
    );
  var leftover = cardImportUnevaluatedMacroCounts(playable);
  Object.keys(leftover).forEach(function (key) {
    // Keys keep the parameters the card wrote, so the known marker is dropped by macro name.
    if (String(key).split(/[\s:]/)[0].toLowerCase() === 'group') delete leftover[key];
  });
  var scripted = [],
    leftoverNames = [];
  Object.keys(leftover)
    .sort()
    .forEach(function (name) {
      if (typeof cardScriptHandlesMacro === 'function' && cardScriptHandlesMacro(c, name)) scripted.push(name);
      else leftoverNames.push(name);
    });
  function macroList(names, counts) {
    return names
      .map(function (name) {
        return name + ' ' + counts[name] + ' 处';
      })
      .join('、');
  }
  if (scripted.length)
    addNote(
      '「随卡脚本自带的宏」：' +
        macroList(scripted, leftover) +
        '。本卡已启用的随卡脚本自己处理这些标记，保持“完整保留”导入即可照常展开。'
    );
  if (leftoverNames.length)
    add(
      '「非 ST 官方文本占位」：' +
        macroList(leftoverNames, leftover) +
        '。这些标记会原样进入提示词，通常由卡作者交给模型填写，或属于其他扩展。'
    );
  if (typeof regexScriptImportSummary === 'function') {
    var regexSummary = regexScriptImportSummary(c),
      replacementNames = Object.keys(regexSummary.replacementMacros || {}).sort();
    if (regexSummary.unrecognizedReplacement)
      add(
        '「随卡正则脚本」：有 ' +
          regexSummary.unrecognizedReplacement +
          ' 条脚本的替换内容含未识别的宏' +
          (replacementNames.length ? '（' + replacementNames.join('、') + '）' : '') +
          '；脚本照常执行，这些标记原样保留。'
      );
  }
  worldBookImportUnsupportedItems(rawCharacterBookForCard(c), canonicalCharacterName(c) + '的随卡世界书').forEach(add);
  exportedAdditionalCharacterBooks(c).forEach(function (book, index) {
    worldBookImportUnsupportedItems(book, canonicalCharacterName(c) + '的附加世界书 ' + (index + 1)).forEach(add);
  });
  return { unsupported: items, notes: notes };
}
function cardImportUnsupportedItems(c) {
  return cardImportAuditItems(c).unsupported;
}
function importAuditItemsHtml(items, summary, className) {
  items = Array.isArray(items) ? items : [];
  if (!items.length) return '';
  var shown = items.slice(0, 200),
    remaining = items.length - shown.length;
  return (
    '<details class="' +
    className +
    '"><summary>' +
    summary +
    '：' +
    items.length +
    ' 项</summary><ul>' +
    shown
      .map(function (item) {
        return '<li>' + esc(item) + '</li>';
      })
      .join('') +
    (remaining ? '<li>另有 ' + remaining + ' 项未展开。</li>' : '') +
    '</ul></details>'
  );
}
function importUnsupportedItemsHtml(items) {
  return importAuditItemsHtml(items, '识别但不应用', 'import-audit-details warn import-unsupported');
}
function importRuntimeNotesHtml(notes) {
  return importAuditItemsHtml(notes, '已识别并照常运行', 'import-audit-details import-runtime-notes');
}
// Each item is a full sentence; the result always ends with a full stop.
function importUnsupportedItemsText(items, limit) {
  items = Array.from(new Set((items || []).map(String).filter(Boolean)));
  limit = Math.max(1, Number(limit) || 8);
  return (
    items
      .slice(0, limit)
      .map(function (item) {
        return /[。！？]$/.test(item) ? item : item + '。';
      })
      .join('') + (items.length > limit ? '另有 ' + (items.length - limit) + ' 项已在导入预览中列出。' : '')
  );
}
function hasSemanticWorldBookValue(entry) {
  entry = entry || {};
  var text = function (value) {
      return String(value == null ? '' : value).trim();
    },
    list = function (value) {
      return Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    },
    keys = list(entry.keys || entry.key || entry.keywords),
    content = text(entry.content || entry.text || entry.value || entry.entry || entry.prompt);
  var name = text(entry.localizedName || entry.localized_name || entry.name);
  if (/^(?:世界书条目|未命名条目)$/.test(name)) name = '';
  return !!(
    name ||
    keys.some(function (value) {
      return text(value);
    }) ||
    list(entry.secondary_keys || entry.secondary || entry.keysecondary || entry.secondaryKeys).some(function (value) {
      return text(value);
    }) ||
    content ||
    text(entry.comment || entry.notes)
  );
}
function analyzeCharacterBookEntries(book) {
  var source = book && book.entries;
  if (source == null) return { records: [], unrecognized: 0, source: 0 };
  if (!Array.isArray(source) && (typeof source !== 'object' || source === null))
    return { records: [], unrecognized: 1, source: 1 };
  var rows = Array.isArray(source)
    ? source.map(function (value, index) {
        return { key: '', value: value, index: index };
      })
    : Object.keys(source).map(function (key, index) {
        return { key: key, value: source[key], index: index };
      });
  var records = [],
    unrecognized = 0,
    unsafeKey = function (key) {
      return key === '__proto__' || key === 'prototype' || key === 'constructor';
    },
    cloneOwn = function (value) {
      var out = {};
      Object.keys(value || {}).forEach(function (key) {
        if (!unsafeKey(key)) out[key] = value[key];
      });
      return out;
    },
    looksLikeEntry = function (value) {
      return Object.keys(value || {}).some(function (key) {
        return [
          'id',
          'uid',
          'name',
          'title',
          'keys',
          'key',
          'keywords',
          'triggers',
          'primary_keys',
          'secondary_keys',
          'secondary',
          'keysecondary',
          'secondaryKeys',
          'filters',
          'content',
          'text',
          'value',
          'entry',
          'prompt',
          'comment',
          'notes',
          'enabled',
          'disable',
          'disabled',
          'active',
          'constant',
          'always_active',
          'alwaysActive',
          'selective',
          'use_regex',
          'useRegex',
          'position',
          'order',
          'insertion_order',
          'priority',
          'depth',
          'probability',
          'extensions',
        ].includes(key);
      });
    };
  rows.forEach(function (row) {
    var value = row.value,
      seen = new Set(),
      depth = 0;
    while (value && typeof value === 'object' && !Array.isArray(value) && depth < 3) {
      if (seen.has(value)) {
        value = null;
        break;
      }
      seen.add(value);
      var wrapper = ['data', 'entry', 'value'].find(function (key) {
          return (
            Object.prototype.hasOwnProperty.call(value, key) &&
            value[key] &&
            typeof value[key] === 'object' &&
            !Array.isArray(value[key])
          );
        }),
        wrapperOnly =
          wrapper &&
          Object.keys(value).every(function (key) {
            return [wrapper, 'id', 'uid', 'name', 'title'].includes(key);
          });
      if (!wrapperOnly) break;
      value = value[wrapper];
      depth++;
    }
    var normalized = null;
    if (typeof value === 'string' && row.key && !unsafeKey(row.key) && value.trim())
      normalized = { name: row.key, keys: [row.key], content: value };
    else if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[1] === 'string' &&
      (typeof value[0] === 'string' || Array.isArray(value[0]))
    )
      normalized = { name: row.key || '', keys: Array.isArray(value[0]) ? value[0] : [value[0]], content: value[1] };
    else if (value && typeof value === 'object' && !Array.isArray(value) && looksLikeEntry(value))
      normalized = cloneOwn(value);
    if (!normalized) {
      unrecognized++;
      return;
    }
    records.push({ value: normalized, index: row.index, key: row.key });
  });
  return { records: records, unrecognized: unrecognized, source: rows.length };
}
function characterBookImportReport(c) {
  var report = (c && c.importMeta && c.importMeta.worldBookImportReport) || {},
    unsupportedItems = cardImportUnsupportedItems(c);
  return {
    imported: Number(report.imported) || 0,
    blank: Number(report.blank) || 0,
    unrecognized: Number(report.unrecognized) || 0,
    source: Number(report.source) || 0,
    unsupported: unsupportedItems.length,
    unsupportedItems: unsupportedItems,
  };
}
// Entries a character_book import created carry _rawSource and keep it through edits; entries the user
// or a script added to the book never have it.
function isCharacterCardSourcedEntry(entry) {
  return !!(entry && entry._rawSource === 'character_card');
}
// Replacing a card's own book swaps the entries that came from the previous card for the new card's
// entries and keeps the entries added afterwards, which also keep their ids.
function syncedCharacterBookEntries(previousBook, importedBook) {
  var previous = Array.isArray(previousBook.entries) ? previousBook.entries : [],
    added = previous.filter(function (entry) {
      return !isCharacterCardSourcedEntry(entry);
    }),
    imported = Array.isArray(importedBook.entries) ? importedBook.entries : [];
  normalizeWorldBookCategoryEntryIds({ entries: added.concat(imported) });
  return { entries: imported.concat(added), replaced: previous.length - added.length, kept: added.length };
}
function isCleanableCharacterCardBlankEntry(category, entry) {
  return !!(
    category &&
    category.sourceType === 'character_card' &&
    isCharacterCardSourcedEntry(entry) &&
    !hasSemanticWorldBookValue(entry)
  );
}
function importCharacterBookCategoryForCharacter(c, book, sourceLabel, targetWorldBook) {
  if (!c || !book || typeof book !== 'object') return 0;
  var analysis = analyzeCharacterBookEntries(book),
    sourceEntries = analysis.records;
  if (!sourceEntries.length) {
    var emptyReport = characterBookImportReport(c);
    emptyReport.unrecognized += analysis.unrecognized;
    emptyReport.source += analysis.source;
    c.importMeta = c.importMeta || {};
    c.importMeta.worldBookImportReport = emptyReport;
    return 0;
  }
  var worldBook = targetWorldBook || D.worldBook;
  if (!worldBook.categories) worldBook.categories = [];
  var candidate = String(book.localizedName || book.localized_name || book.name || '').trim(),
    baseName = isGenericExportWorldBookName(candidate)
      ? canonicalCharacterName(c) + ' 世界书'
      : candidate || canonicalCharacterName(c) + ' 世界书',
    name = baseName,
    n = 2;
  while (
    worldBook.categories.some(function (x) {
      return x.name === name;
    })
  )
    name = baseName + ' #' + n++;
  var cat = {
    id: 'cat_' + uid(),
    name: name,
    localizedName: String(book.localizedName || book.localized_name || ''),
    color: '#6366f1',
    entries: [],
    settings: normalizeWBSettings(
      Object.assign({}, book, book.settings && typeof book.settings === 'object' ? book.settings : {})
    ),
    description: String(book.description || ''),
    extensions: book.extensions && typeof book.extensions === 'object' ? book.extensions : {},
    sourceMeta: {
      source: 'character_book',
      rawPath: sourceLabel || 'character.importMeta.rawCard',
      rawFormat: (c.importMeta && c.importMeta.format) || '',
      rawName: String(book.name || ''),
      importReport: { source: analysis.source, blank: 0, unrecognized: analysis.unrecognized, imported: 0 },
    },
    boundCharIds: [c.id],
    ownerCharId: c.id,
    sourceType: 'character_card',
  };
  sourceEntries.forEach(function (record) {
    try {
      var raw = Object.assign({}, record.value || {});
      raw._fromChar = canonicalCharacterName(c);
      if (!hasSemanticWorldBookValue(raw)) {
        cat.sourceMeta.importReport.blank++;
        return;
      }
      var normalized = normalizeWBEntry(raw);
      normalized._rawIndex = record.index;
      normalized._rawSource = 'character_card';
      cat.entries.push(normalized);
    } catch (_) {
      cat.sourceMeta.importReport.unrecognized++;
    }
  });
  normalizeWorldBookCategoryEntryIds(cat);
  cat.sourceMeta.importReport.imported = cat.entries.length;
  if (cat.entries.length) {
    worldBook.categories.push(cat);
    worldBook.activeCategoryId = cat.id;
  }
  var report = characterBookImportReport(c);
  report.imported += cat.entries.length;
  report.blank += cat.sourceMeta.importReport.blank;
  report.unrecognized += cat.sourceMeta.importReport.unrecognized;
  report.source += analysis.source;
  c.importMeta = c.importMeta || {};
  c.importMeta.worldBookImportReport = report;
  return cat.entries.length;
}
function importCharacterBookForCharacter(c, targetWorldBook) {
  if (!c) return 0;
  c.importMeta = c.importMeta || {};
  c.importMeta.worldBookImportReport = { imported: 0, blank: 0, unrecognized: 0, source: 0 };
  var total = importCharacterBookCategoryForCharacter(
    c,
    c.character_book,
    'character.importMeta.rawCard',
    targetWorldBook
  );
  exportedAdditionalCharacterBooks(c).forEach(function (book, index) {
    total += importCharacterBookCategoryForCharacter(
      c,
      book,
      'character.extensions.yeyu.boundWorldBooks[' + index + ']',
      targetWorldBook
    );
  });
  return total;
}

function pendingImportSnapshot(item) {
  return JSON.stringify(item, function (key, value) {
    if (value instanceof Uint8Array) return { binary: 'Uint8Array', length: value.byteLength };
    if (typeof Blob !== 'undefined' && value instanceof Blob)
      return { binary: 'Blob', size: value.size, type: value.type };
    return value;
  });
}
function pendingImportSnapshots(items) {
  return (items || []).map(pendingImportSnapshot);
}
function setPreparedComponentMode(card, mode) {
  var extensions =
      card.extensions && typeof card.extensions === 'object' && !Array.isArray(card.extensions)
        ? Object.assign({}, card.extensions)
        : {},
    yeyu =
      extensions.yeyu && typeof extensions.yeyu === 'object' && !Array.isArray(extensions.yeyu)
        ? Object.assign({}, extensions.yeyu)
        : {};
  yeyu.componentImportMode = mode === 'basic' ? 'basic' : 'full';
  extensions.yeyu = yeyu;
  card.extensions = extensions;
  delete card.scriptPermission;
  delete card.scriptSendInterceptPermission;
  setCardScriptsEnabled(card, mode !== 'basic');
  card.regexEnabled = mode !== 'basic';
  return card;
}
function assertPendingImportUnchanged(items, snapshots) {
  (items || []).forEach(function (item, index) {
    if (pendingImportSnapshot(item) !== snapshots[index]) throw new Error('待导入源数据发生意外变化，已阻止保存');
  });
  return true;
}
async function confirmDirectImportRisks(items, modes) {
  var risky = [];
  (items || []).forEach(function (card, index) {
    if (modes[index] !== 'direct') return;
    var audit = auditCardImportLocalization(card),
      count = audit.primaryMissing + audit.secondaryMissing;
    if (count) risky.push('「' + canonicalCharacterName(card) + '」：' + count + ' 个触发词缺少中文别名');
  });
  if (!risky.length) return true;
  return await appConfirm(
    '以下角色卡的英文触发词可能无法被中文对话触发：\n\n' +
      risky.join('\n') +
      '\n\n直接导入不调用 AI、不修改原内容；也可以返回预览改选“AI 汉化后导入”。',
    '直接导入风险',
    '仍然直接导入'
  );
}
async function preparePendingCharacterCards(originals, modes, componentModes) {
  componentModes = componentModes || [];
  var prepared = originals.map(function (card, index) {
      return setPreparedComponentMode(createImportAttemptCard(card), componentModes[index]);
    }),
    aiCards = prepared.filter(function (card, index) {
      return modes[index] === 'ai';
    });
  _importLocalizationController = new AbortController();
  var mediaBatch = createCardImportImageBatch(prepared),
    localizationReport = {
      total: 0,
      completed: 0,
      failed: 0,
      unresolved: 0,
      unresolvedItems: [],
      missingIds: [],
      skipped: false,
      requests: 0,
    };
  updateImportProgress('正在检查成员、触发词和待处理内容', '已准备 ' + prepared.length + ' 张角色卡，完成前不会保存');
  var parallel = await Promise.all([
    mapWithConcurrency(prepared, 3, async function (card) {
      await prepareCardMediaForImport(card, mediaBatch);
      if (_importLocalizationCancelled) {
        var cancelled = cardImageCancelError();
        throw cancelled;
      }
      updateImportProgress('正在处理角色头像和媒体', canonicalCharacterName(card));
      return card;
    }),
    aiCards.length ? localizeImportedCards(aiCards) : Promise.resolve(localizationReport),
  ]);
  localizationReport = parallel[1];
  if (aiCards.length) assertLocalizationReadyForCommit(localizationReport, '角色卡与世界书汉化');
  if (_importLocalizationCancelled) assertLocalizationReadyForCommit({ cancelled: true }, '角色卡导入');
  return {
    cards: parallel[0],
    localization: localizationReport,
    aiCards: aiCards.length,
    directCards: prepared.length - aiCards.length,
  };
}
async function commitPreparedCharacterCards(prepared, options) {
  // rawPath identifies a book in the previous card, never a position in the replacement card.
  // This recovers names from older imports without interpreting literal numeric suffixes.
  var bookNames = function (book, character, imported) {
      var meta = book.sourceMeta || {},
        source = null;
      if (meta.rawPath === 'character.importMeta.rawCard') source = character.character_book;
      else {
        var match = String(meta.rawPath || '').match(/^character\.extensions\.yeyu\.boundWorldBooks\[(\d+)\]$/);
        if (match) source = exportedAdditionalCharacterBooks(character)[Number(match[1])];
      }
      var rawName = Object.prototype.hasOwnProperty.call(meta, 'rawName')
          ? String(meta.rawName || '')
          : String((source && source.name) || ''),
        localizedName = String(book.localizedName || ''),
        name = String(book.name || '');
      if (imported && source) {
        var candidate = String(source.localizedName || source.localized_name || source.name || '').trim();
        name = isGenericExportWorldBookName(candidate)
          ? canonicalCharacterName(character) + ' 世界书'
          : candidate || canonicalCharacterName(character) + ' 世界书';
      }
      return { rawName: rawName, localizedName: localizedName, name: name };
    },
    pairImportedBooks = function (importedBooks, previousBooks, card, previous) {
      var remaining = (previousBooks || []).map(function (book) {
          return { book: book, names: bookNames(book, previous, false) };
        }),
        paired = importedBooks.map(function () {
          return null;
        }),
        keys = importedBooks.map(function (book) {
          return bookNames(book, card, true);
        });
      ['rawName', 'localizedName', 'name'].forEach(function (key) {
        keys.forEach(function (row, index) {
          if (paired[index] || !row[key]) return;
          var matches = remaining.filter(function (candidate) {
            var names = candidate.names;
            if (row.rawName && names.rawName && row.rawName !== names.rawName) return false;
            return names[key] === row[key];
          });
          if (matches.length !== 1) return;
          paired[index] = matches[0].book;
          remaining.splice(remaining.indexOf(matches[0]), 1);
        });
      });
      return paired;
    },
    isPrimaryImportedBook = function (book) {
      var rawPath = book && book.sourceMeta ? book.sourceMeta.rawPath : '';
      return !rawPath || rawPath === 'character.importMeta.rawCard';
    };
  if (options && options.replaceId && prepared.length !== 1) throw new Error('替换角色时只能导入一张角色卡');
  var before = { characters: D.characters, chats: D.chats, worldBook: D.worldBook },
    nextCharacters = (D.characters || []).slice(),
    nextChats = Object.assign({}, D.chats || {}),
    nextWorldBook = copyJsonData(D.worldBook || { categories: [], globalCategoryIds: [] });
  try {
    prepared.forEach(function (card) {
      var previous =
        options &&
        options.replaceId &&
        nextCharacters.find(function (row) {
          return row.id === options.replaceId;
        });
      card.id = previous ? previous.id : 'c_' + uid();
      ensureCharacterIntelligence(card);
      // A shared ownerless book has no proven owner, even when extensions.world names it.
      var previousBooks = !previous
        ? []
        : nextWorldBook.categories.filter(function (row) {
            return (
              row &&
              row.sourceType === 'character_card' &&
              (row.ownerCharId === previous.id ||
                (!row.ownerCharId &&
                  Array.isArray(row.boundCharIds) &&
                  row.boundCharIds.length === 1 &&
                  row.boundCharIds[0] === previous.id))
            );
          });
      var bookCount = nextWorldBook.categories.length;
      importCharacterBookForCharacter(card, nextWorldBook);
      var importedBooks = nextWorldBook.categories.slice(bookCount),
        pairedBooks = pairImportedBooks(importedBooks, previousBooks, card, previous),
        primaryImported = false,
        pairedNames = [];
      importedBooks.forEach(function (importedBook, index) {
        var previousBook = pairedBooks[index];
        if (previousBook)
          pairedNames.push({
            baseName: bookNames(importedBook, card, true).name,
            localizedName: String(importedBook.localizedName || ''),
            rawName: String((importedBook.sourceMeta && importedBook.sourceMeta.rawName) || ''),
            previousName: previousBook.name,
          });
        // {{charLoreBook}}, promptTemplateDefaultWorldInfoName and world-book rename sync read this
        // pointer, so it follows the book that replaced the primary character_book of this card.
        if (previous && isPrimaryImportedBook(importedBook)) {
          primaryImported = true;
          if (!card.extensions || typeof card.extensions !== 'object') card.extensions = {};
          card.extensions.world = previousBook ? previousBook.name : importedBook.name;
        }
        if (!previousBook) return;
        var synced = syncedCharacterBookEntries(previousBook, importedBook),
          report = card.importMeta.worldBookImportReport;
        report.synced = (report.synced || []).concat([
          {
            name: previousBook.name,
            replaced: synced.replaced,
            imported: importedBook.entries.length,
            kept: synced.kept,
          },
        ]);
        Object.assign(previousBook, {
          entries: synced.entries,
          // A book that reached here without an owner belongs to this character, so record that.
          ownerCharId: previousBook.ownerCharId || previous.id,
          settings: importedBook.settings,
          localizedName: importedBook.localizedName,
          description: importedBook.description,
          extensions: importedBook.extensions,
          sourceMeta: importedBook.sourceMeta,
          // Ownership stays with the existing category: a card book the user also bound to other
          // characters through the world-book UI keeps those bindings across a replace-import.
          boundCharIds: Array.from(
            new Set(
              (Array.isArray(previousBook.boundCharIds) ? previousBook.boundCharIds : []).concat(
                Array.isArray(importedBook.boundCharIds) ? importedBook.boundCharIds : []
              )
            )
          ),
        });
        nextWorldBook.categories.splice(nextWorldBook.categories.indexOf(importedBook), 1);
        if (nextWorldBook.activeCategoryId === importedBook.id) nextWorldBook.activeCategoryId = previousBook.id;
      });
      // A card without character_book carries the pointer from its own file, which can name a book the
      // user has since renamed. Only the category that replaced that very book may take the pointer
      // over: a card pointing elsewhere, or pointing nowhere, keeps what it had.
      if (previous && !primaryImported && card.extensions && card.extensions.world) {
        var pointer = String(card.extensions.world),
          repointed = pairedNames.find(function (pair) {
            return (
              pair.baseName === pointer ||
              (pair.localizedName && pair.localizedName === pointer) ||
              pair.rawName === pointer
            );
          });
        if (repointed) card.extensions.world = repointed.previousName;
      }
      delete card._src;
      if (previous) nextCharacters[nextCharacters.indexOf(previous)] = card;
      else {
        nextCharacters.push(card);
        nextChats[card.id] = { sessions: [], activeSid: null };
      }
    });
    D.characters = nextCharacters;
    D.chats = nextChats;
    D.worldBook = nextWorldBook;
    await saveData(['characters', 'sessions', 'worldbook']);
  } catch (error) {
    D.characters = before.characters;
    D.chats = before.chats;
    D.worldBook = before.worldBook;
    throw new Error('保存失败，未写入任何角色或随卡世界书：' + String(error.message || error));
  }
  if (typeof scheduleWBRenderPrewarm === 'function') {
    try {
      scheduleWBRenderPrewarm(nextWorldBook.categories || []);
    } catch (error) {
      console.warn('世界书预热失败，已保存的数据不受影响', error);
    }
  }
  return true;
}
async function confirmImport() {
  if (!pending || !pending.length) {
    toast('没有待导入的角色', 'info');
    return;
  }
  var accepted = pending.map(function (source) {
    return { card: source, mode: pendingImportMode(source), componentMode: pendingComponentMode(source) };
  });
  var originals = accepted.map(function (row) {
      return row.card;
    }),
    modes = accepted.map(function (row) {
      return row.mode;
    }),
    componentModes = accepted.map(function (row) {
      return row.componentMode;
    }),
    snapshots = pendingImportSnapshots(originals),
    prepared = [],
    result = null;
  if (!(await confirmDirectImportRisks(originals, modes))) return;
  showImportProgress('正在导入角色卡', '正在创建不可变的本次工作副本…', Math.max(4, originals.length + 4));
  try {
    result = await preparePendingCharacterCards(originals, modes, componentModes);
    prepared = result.cards;
    assertPendingImportUnchanged(originals, snapshots);
    updateImportProgress('正在保存角色卡', '全部处理完成，正在保存角色和随卡世界书');
    await commitPreparedCharacterCards(prepared);
    assertPendingImportUnchanged(originals, snapshots);
    originals.forEach(function (c) {
      ['avatar_image', 'background_image'].forEach(function (k) {
        if (typeof c[k] === 'string' && c[k].startsWith('blob:')) URL.revokeObjectURL(c[k]);
      });
    });
    pending = [];
    _pendingImportModes = new WeakMap();
    _pendingComponentModes = new WeakMap();
    renderCharList();
    renderWBSidebar();
    $('import-preview').innerHTML = '';
    var bookReport = prepared.reduce(
        function (total, c) {
          var report = characterBookImportReport(c);
          total.imported += report.imported;
          total.blank += report.blank;
          total.unrecognized += report.unrecognized;
          total.unsupportedItems = total.unsupportedItems.concat(report.unsupportedItems || []);
          return total;
        },
        { imported: 0, blank: 0, unrecognized: 0, unsupportedItems: [] }
      ),
      regexCount = prepared.reduce(function (total, c) {
        return total + (Array.isArray(c.regexScripts) ? c.regexScripts.length : 0);
      }, 0),
      bookDetails = [];
    if (bookReport.blank)
      bookDetails.push('有 ' + bookReport.blank + ' 条空白记录未保存：这些记录里没有名称、关键词、正文和备注。');
    if (bookReport.unrecognized)
      bookDetails.push(
        '有 ' + bookReport.unrecognized + ' 条无法识别的记录未保存：这些记录的结构不符合可读取的世界书条目格式。'
      );
    if (bookReport.unsupportedItems.length)
      bookDetails.push('识别但不应用：' + importUnsupportedItemsText(bookReport.unsupportedItems, 8));
    toast(
      '已导入 ' +
        prepared.length +
        ' 个角色（AI 汉化 ' +
        result.aiCards +
        ' 个，直接导入 ' +
        result.directCards +
        ' 个；完整保留 ' +
        componentModes.filter(function (mode) {
          return mode === 'full';
        }).length +
        ' 个，仅基础 ' +
        componentModes.filter(function (mode) {
          return mode === 'basic';
        }).length +
        ' 个），并保存 ' +
        bookReport.imported +
        ' 条随卡世界书内容' +
        (regexCount ? '、' + regexCount + ' 条角色专属正则脚本' : '') +
        '。' +
        (bookDetails.length ? ' ' + bookDetails.join(' ') : ''),
      'ok'
    );
    closeModal('import-modal');
    hideImportProgress();
  } catch (error) {
    if (_importLocalizationController) _importLocalizationController.abort();
    try {
      assertPendingImportUnchanged(originals, snapshots);
    } catch (integrityError) {
      console.error(integrityError);
    }
    toast((error && error.cancelled ? '已取消导入：' : '角色卡处理失败：') + String(error.message || error), 'err');
    if (error && error.localizationIncomplete && error.unresolvedItems && error.unresolvedItems.length > 3) {
      hideImportProgress();
      await showLocalizationFailureDetails(error);
    }
  } finally {
    hideImportProgress();
  }
}

async function convertBlobToBase64(blobUrl) {
  const resp = await fetch(blobUrl);
  if (!resp.ok) throw new Error('无法读取导入图片');
  return imageBlobToDataUrl(await resp.blob());
}
function imageBlobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () {
      reject(new Error('图片转换失败'));
    };
    reader.onloadend = function () {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('图片转换失败'));
    };
    reader.readAsDataURL(blob);
  });
}
function cardImageContentType(bytes) {
  if (!bytes || bytes.length < 4) return '';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return 'image/gif';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    var boxLength = Math.min(bytes.length, ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
    if (boxLength >= 12) {
      for (var offset = 8; offset + 3 < boxLength; offset += 4) {
        var brand = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        if (brand === 'avif' || brand === 'avis') return 'image/avif';
      }
    }
  }
  return '';
}
async function validateCardImageBlob(blob) {
  var bytes = new Uint8Array(await blob.arrayBuffer()),
    type = cardImageContentType(bytes);
  if (!type) throw new Error('图片内容不是有效的 PNG/JPEG/WebP/GIF/BMP/AVIF');
  var imageBlob = blob.type === type ? blob : new Blob([bytes], { type: type }),
    bitmap = null;
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(imageBlob, { resizeWidth: 1, resizeHeight: 1 });
      if (!bitmap || !bitmap.width || !bitmap.height) throw new Error('图片内容损坏，无法读取');
    } catch (error) {
      throw new Error('图片内容损坏，无法读取');
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
    return imageBlob;
  }
  await new Promise(function (resolve, reject) {
    var image = new Image(),
      objectUrl = URL.createObjectURL(imageBlob);
    image.onload = function () {
      URL.revokeObjectURL(objectUrl);
      if (image.naturalWidth && image.naturalHeight) resolve();
      else reject(new Error('图片内容损坏，无法读取'));
    };
    image.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片内容损坏，无法读取'));
    };
    image.src = objectUrl;
  });
  return imageBlob;
}
var _nativeCardImageRequests = {},
  _cardImageDownloads = new Map(),
  _cardImageQueue = { active: 0, pending: [] };
function cardImageCancelled(batch) {
  return !!(batch && batch.signal && batch.signal.aborted);
}
function cardImageCancelError() {
  var error = new Error('已取消图片处理，未保存导入内容');
  error.cancelled = true;
  return error;
}
function cardImageQueuePump() {
  while (_cardImageQueue.active < CARD_IMAGE_DOWNLOAD_CONCURRENCY && _cardImageQueue.pending.length) {
    var job = _cardImageQueue.pending.shift();
    if (job.detach) job.detach();
    _cardImageQueue.active++;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .then(
        function () {
          _cardImageQueue.active--;
          cardImageQueuePump();
        },
        function () {
          _cardImageQueue.active--;
          cardImageQueuePump();
        }
      );
  }
}
function queueCardImageDownload(task, signal) {
  return new Promise(function (resolve, reject) {
    var job = { task: task, resolve: resolve, reject: reject };
    function abort() {
      var index = _cardImageQueue.pending.indexOf(job);
      if (index < 0) return;
      _cardImageQueue.pending.splice(index, 1);
      job.detach();
      reject(cardImageCancelError());
    }
    job.detach = function () {
      if (signal) signal.removeEventListener('abort', abort);
    };
    if (signal && signal.aborted) {
      reject(cardImageCancelError());
      return;
    }
    if (signal) signal.addEventListener('abort', abort, { once: true });
    _cardImageQueue.pending.push(job);
    cardImageQueuePump();
  });
}
function createCardImageDownloadBatch(signal) {
  return { signal: signal || null };
}
function createCardImportImageBatch() {
  return createCardImageDownloadBatch(_importLocalizationController && _importLocalizationController.signal);
}
window.__yeyuCardImageResult = function (id, ok, data, error) {
  var pending = _nativeCardImageRequests[id];
  if (!pending) return;
  delete _nativeCardImageRequests[id];
  if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort);
  if (cardImageCancelled(pending.batch)) {
    pending.reject(cardImageCancelError());
    return;
  }
  if (ok && safeImage(data, false)) pending.resolve(data);
  else pending.reject(new Error(error || '图片下载失败'));
};
function fetchCardImageNative(url, batch) {
  return new Promise(function (resolve, reject) {
    if (!window.AndroidBridge || typeof AndroidBridge.fetchCardImage !== 'function') {
      reject(new Error('当前环境不支持跨域图片下载'));
      return;
    }
    if (cardImageCancelled(batch)) {
      reject(cardImageCancelError());
      return;
    }
    var id = 'img_' + uid(),
      signal = batch && batch.signal,
      onAbort = function () {
        var pending = _nativeCardImageRequests[id];
        if (!pending) return;
        delete _nativeCardImageRequests[id];
        if (signal) signal.removeEventListener('abort', onAbort);
        AndroidBridge.cancelCardImage(id);
        reject(cardImageCancelError());
      };
    _nativeCardImageRequests[id] = {
      resolve: resolve,
      reject: reject,
      batch: batch,
      signal: signal,
      onAbort: onAbort,
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      AndroidBridge.fetchCardImage(url, id);
    } catch (error) {
      delete _nativeCardImageRequests[id];
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(error);
    }
  });
}
async function downloadCardImageNow(source, batch) {
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null,
    parentSignal = batch && batch.signal,
    onParentAbort = function () {
      controller.abort();
    };
  if (controller && parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  try {
    if (cardImageCancelled(batch)) throw cardImageCancelError();
    var resp = await fetch(source, {
      method: 'GET',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
    if (cardImageCancelled(batch)) throw cardImageCancelError();
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var blob = await validateCardImageBlob(await resp.blob());
    if (cardImageCancelled(batch)) throw cardImageCancelError();
    return await imageBlobToDataUrl(blob);
  } catch (error) {
    if (error && error.cancelled) throw error;
    if (cardImageCancelled(batch)) throw cardImageCancelError();
    if (window.AndroidBridge && typeof AndroidBridge.fetchCardImage === 'function')
      return await fetchCardImageNative(source, batch);
    throw error;
  } finally {
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}
function downloadCardImage(url, batch) {
  var source = remoteImageUrl(url);
  if (!source) return Promise.reject(new Error('图片地址不是受支持的 HTTP 地址'));
  if (cardImageCancelled(batch)) return Promise.reject(cardImageCancelError());
  var key = normalizeRemoteCardUrl(source) || source,
    signal = (batch && batch.signal) || null,
    owners = _cardImageDownloads.get(key);
  if (!owners) {
    owners = new Map();
    _cardImageDownloads.set(key, owners);
  }
  var shared = owners.get(signal);
  if (!shared) {
    shared = queueCardImageDownload(function () {
      if (cardImageCancelled(batch)) throw cardImageCancelError();
      return downloadCardImageNow(key, batch);
    }, signal).finally(function () {
      owners.delete(signal);
      if (!owners.size && _cardImageDownloads.get(key) === owners) _cardImageDownloads.delete(key);
    });
    owners.set(signal, shared);
  }
  return shared;
}

var _cardMediaDownloads = new Map(),
  _openingMediaHydration = new Map();

async function resolveCardImageValue(card, field, sourceField, batch) {
  var meta = ensureImportMeta(card),
    raw = String(card[field] || '').trim() || String(meta[sourceField] || '').trim(),
    local = safeImage(raw, false);
  if (local) {
    card[field] = local;
    return 'ready';
  }
  if (raw && raw.indexOf('blob:') === 0) {
    card[field] = await convertBlobToBase64(raw);
    return 'ready';
  }
  var remote = remoteImageUrl(raw);
  if (!remote) {
    card[field] = '';
    return 'unavailable';
  }
  meta[sourceField] = remote;
  try {
    card[field] = await downloadCardImage(remote, batch);
    meta[sourceField + 'Status'] = 'downloaded';
    return 'ready';
  } catch (error) {
    if (error && error.cancelled) throw error;
    card[field] = '';
    meta[sourceField + 'Status'] = 'failed';
    meta[sourceField + 'Error'] = String(error.message || error);
    var message = String((error && error.message) || error || ''),
      http = message.match(/HTTP\s+(\d+)/i),
      reason =
        /超时|timeout|timed out|abort/i.test(message) || (error && error.name === 'AbortError')
          ? '下载超时'
          : http
            ? '图片服务器返回 HTTP ' + http[1]
            : /图片(?:格式|内容)|PNG|JPEG|WebP|GIF/i.test(message)
              ? message
              : '网络连接失败';
    throw new Error(
      '“' +
        canonicalCharacterName(card) +
        '”的' +
        (field === 'avatar_image' ? '头像' : '背景图') +
        '下载失败：' +
        reason +
        '。请检查网络后重新导入，届时会重新下载。'
    );
  }
}
function initializeCardForImport(source) {
  source = source || {};
  var card = Object.assign({}, source);
  card.importMeta = Object.assign({}, source.importMeta || {});
  card.importMeta.rawCard = (source.importMeta && source.importMeta.rawCard) || null;
  card.character_book = source.character_book || null;
  card.regexScripts =
    typeof normalizeRegexScriptList === 'function'
      ? normalizeRegexScriptList(source.regexScripts)
      : copyJsonData(source.regexScripts || []);
  card.tags = Array.isArray(source.tags) ? source.tags.slice() : [];
  card.alternate_greetings = Array.isArray(source.alternate_greetings) ? source.alternate_greetings.slice() : [];
  card.source = Array.isArray(source.source) ? source.source.slice() : [];
  card.assets = Array.isArray(source.assets) ? copyJsonData(source.assets || []) : [];
  card.creator_notes_multilingual =
    source.creator_notes_multilingual && typeof source.creator_notes_multilingual === 'object'
      ? copyJsonData(source.creator_notes_multilingual)
      : {};
  card.nameAliases = Array.isArray(source.nameAliases) ? source.nameAliases.slice() : [];
  card.participantRegistry = Array.isArray(source.participantRegistry)
    ? copyJsonData(source.participantRegistry)
    : null;
  card.media_assets = Array.isArray(source.media_assets)
    ? source.media_assets.map(function (asset) {
        return Object.assign({}, asset);
      })
    : [];
  var meta = ensureImportMeta(card);
  card.creator_notes = String(card.creator_notes || '');
  var note = window.YeyuPure.cleanCreatorNotes(card.creator_notes);
  card.creator_notes_clean = note.cleaned;
  card.creator_notes_display = String(card.creator_notes_display || card.creator_notes_clean || '');
  card.creator_notes_zh = String(card.creator_notes_zh || '');
  delete card.creator_notes_max_tokens;
  applyChineseNicknameAsDisplayName(card);
  ensureCharacterIntelligence(card);
  normalizeCardMediaAssets(card);
  return card;
}
async function prepareCardMediaForImport(card, batch) {
  var meta = ensureImportMeta(card),
    originalAvatar = String(card.avatar_image || meta.sourceAvatar || ''),
    originalBackground = String(card.background_image || meta.sourceBackground || '');
  if (originalBackground && originalBackground === originalAvatar && meta.backgroundExplicit !== false) {
    await resolveCardImageValue(card, 'avatar_image', 'sourceAvatar', batch);
    if (card.avatar_image) {
      card.background_image = card.avatar_image;
      meta.sourceBackgroundStatus = 'shared-explicit';
    } else await resolveCardImageValue(card, 'background_image', 'sourceBackground', batch);
  } else if (originalBackground && originalBackground === originalAvatar) {
    card.background_image = '';
    meta.sourceBackground = '';
    meta.sourceBackgroundStatus = 'auto-duplicate-omitted';
    await resolveCardImageValue(card, 'avatar_image', 'sourceAvatar', batch);
  } else
    await Promise.all([
      resolveCardImageValue(card, 'avatar_image', 'sourceAvatar', batch),
      resolveCardImageValue(card, 'background_image', 'sourceBackground', batch),
    ]);
  normalizeCardMediaAssets(card);
  return card;
}
async function downloadCardAsset(card, asset, batch) {
  if (!card || !asset || asset.data_url || !remoteImageUrl(asset.sourceUrl)) return asset;
  var key = normalizeRemoteCardUrl(asset.sourceUrl) || asset.sourceUrl,
    shared = _cardMediaDownloads.get(key);
  if (!shared) {
    shared = downloadCardImage(key, batch).finally(function () {
      _cardMediaDownloads.delete(key);
    });
    _cardMediaDownloads.set(key, shared);
  }
  try {
    asset.data_url = await shared;
    asset.status = 'ready';
    asset.error = '';
  } catch (error) {
    asset.status = 'failed';
    asset.error = String(error.message || error);
  }
  return asset;
}
function registerEditedOpeningMediaAssets(char, message) {
  if (!char || !message || message.opening !== true) return { assets: [], changed: false };
  var openingIndex = Number.isInteger(Number(message.openingIndex)) ? Number(message.openingIndex) : 0,
    all = Array.isArray(char.media_assets) ? char.media_assets : [],
    bySource = new Map(),
    assets = [],
    changed = false;
  all.forEach(function (asset) {
    var source = normalizeRemoteCardUrl(asset && asset.sourceUrl) || String((asset && asset.sourceUrl) || '').trim();
    if (source && !bySource.has(source)) bySource.set(source, asset);
  });
  collectCardMediaAssets({ first_mes: String(message.content || '') }).forEach(function (candidate) {
    var source =
      normalizeRemoteCardUrl(candidate && candidate.sourceUrl) ||
      String((candidate && candidate.sourceUrl) || '').trim();
    if (!source) return;
    var asset = bySource.get(source);
    if (!asset) {
      asset = Object.assign({}, candidate, {
        id: 'opening_edit_' + uid(),
        greetingIndex: openingIndex,
        sourceUrl: source,
        status: candidate.data_url ? 'ready' : 'pending',
      });
      all.push(asset);
      bySource.set(source, asset);
      changed = true;
    } else if (!asset.data_url && (asset.mediaKey || remoteImageUrl(asset.sourceUrl)) && asset.status !== 'pending') {
      asset.status = 'pending';
      asset.error = '';
      changed = true;
    }
    if (assets.indexOf(asset) < 0) assets.push(asset);
  });
  if (char.media_assets !== all) {
    char.media_assets = all;
    changed = true;
  }
  return { assets: assets, changed: changed };
}
async function scheduleGreetingImageDownload(char, index) {
  if (!char || !Array.isArray(char.media_assets)) return;
  var sess = typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    sessId = sess && sess.id,
    assets = char.media_assets.filter(function (a) {
      return (
        a &&
        Number(a.greetingIndex) === Number(index) &&
        !a.data_url &&
        !a.blob &&
        a.status !== 'ready' &&
        a.status !== 'failed' &&
        (a.mediaKey || remoteImageUrl(a.sourceUrl))
      );
    });
  if (!assets.length) return;
  var batch = createCardImageDownloadBatch();
  var downloaded = false;
  await Promise.all(
    assets.map(async function (a) {
      if (a.mediaKey && window.YeyuRepository && typeof YeyuRepository.loadMediaBlob === 'function') {
        var blob = await YeyuRepository.loadMediaBlob(a.mediaKey);
        if (blob) {
          a.blob = blob;
          delete a.data_url;
          delete a.dataUrl;
          delete a.bytes;
          a.status = 'ready';
          return a;
        }
      }
      downloaded = true;
      return downloadCardAsset(char, a, batch);
    })
  );
  if (downloaded) await saveData('characters');
  var now = typeof getChar === 'function' ? getChar() : null,
    nowSess = now && typeof getActiveSession === 'function' ? getActiveSession(now.id) : null;
  if (now && now.id === char.id && (!sessId || (nowSess && nowSess.id === sessId)) && typeof renderChat === 'function')
    renderChat();
  var failed = assets.filter(function (a) {
    return a.status === 'failed';
  }).length;
  if (failed)
    toast(
      '部分开场白图片加载失败：' +
        String(
          assets.find(function (a) {
            return a.status === 'failed';
          }).error || '已保留原文'
        ),
      'info'
    );
}
function queueOpeningMediaHydration(char, index) {
  if (!char || !Array.isArray(char.media_assets)) return Promise.resolve();
  var key = char.id + '|' + (Number.isInteger(Number(index)) ? Number(index) : 0),
    existing = _openingMediaHydration.get(key);
  if (existing) return existing;
  var task = Promise.resolve(
    scheduleGreetingImageDownload(char, Number.isInteger(Number(index)) ? Number(index) : 0)
  ).finally(function () {
    _openingMediaHydration.delete(key);
  });
  _openingMediaHydration.set(key, task);
  return task;
}
function retryOpeningMediaAsset(source) {
  var char = getChar(),
    wanted = normalizeRemoteCardUrl(source) || String(source || '').trim(),
    asset =
      char &&
      Array.isArray(char.media_assets) &&
      char.media_assets.find(function (item) {
        return item && (normalizeRemoteCardUrl(item.sourceUrl) || String(item.sourceUrl || '').trim()) === wanted;
      });
  if (!asset || !remoteImageUrl(asset.sourceUrl)) return Promise.resolve(false);
  asset.status = 'pending';
  asset.error = '';
  renderChat();
  return queueOpeningMediaHydration(
    char,
    Number.isInteger(Number(asset.greetingIndex)) ? Number(asset.greetingIndex) : 0
  ).then(function () {
    return asset.status === 'ready';
  });
}

function noteMissingStoredMedia(item, field, mediaKey) {
  var meta =
      item.importMeta && typeof item.importMeta === 'object' && !Array.isArray(item.importMeta)
        ? item.importMeta
        : (item.importMeta = {}),
    rows = Array.isArray(meta.mediaRecoveryDiagnostics) ? meta.mediaRecoveryDiagnostics : [],
    key = String(mediaKey || '');
  rows = rows.filter(function (row) {
    return row && !(row.field === field && row.mediaKey === key);
  });
  rows.push({ field: String(field || ''), mediaKey: key, reason: 'missing_blob', at: Date.now() });
  meta.mediaRecoveryDiagnostics = rows.slice(-8);
  if (item._media && typeof item._media === 'object') {
    delete item._media[field];
    if (!Object.keys(item._media).length) delete item._media;
  }
  if (item._mediaHash && typeof item._mediaHash === 'object') {
    delete item._mediaHash[field];
    if (!Object.keys(item._mediaHash).length) delete item._mediaHash;
  }
}
async function loadStoredMediaDataUrl(item, field) {
  if (!item) return '';
  if (typeof item[field] === 'string' && /^data:image\//i.test(item[field])) return item[field];
  if (
    !item._media ||
    !item._media[field] ||
    !window.YeyuRepository ||
    typeof YeyuRepository.loadMediaValue !== 'function'
  )
    return '';
  var mediaKey = item._media[field];
  try {
    var value = await YeyuRepository.loadMediaValue(mediaKey);
    if (!value) noteMissingStoredMedia(item, field, mediaKey);
    return value || '';
  } catch (error) {
    console.warn('媒体读取失败', field, error);
    return '';
  }
}
async function hydrateStoredMediaField(item, field) {
  if (!item) return '';
  var existing = typeof displayImageSrc === 'function' ? displayImageSrc(item, field) : '';
  if (existing) return existing;
  if (
    !item._media ||
    !item._media[field] ||
    !window.YeyuRepository ||
    typeof YeyuRepository.loadMediaBlob !== 'function'
  )
    return item[field] || '';
  var mediaKey = item._media[field];
  try {
    var blob = await YeyuRepository.loadMediaBlob(mediaKey);
    if (blob && typeof blob.arrayBuffer === 'function' && typeof blob.size === 'number') {
      item._mediaBlobs = item._mediaBlobs || {};
      item._mediaBlobs[field] = blob;
      return typeof displayImageSrc === 'function' ? displayImageSrc(item, field) : '';
    }
    noteMissingStoredMedia(item, field, mediaKey);
    return '';
  } catch (error) {
    console.warn('媒体读取失败', field, error);
    return '';
  }
}

function loadCharacterCardJsonIntoImportPreview(raw, sourceLabel) {
  raw = String(raw || '').trim();
  if (!raw) throw new Error('角色卡 JSON 为空');
  var parsed = parseCharacterCardJsonText(raw),
    items = Array.isArray(parsed) ? parsed : [parsed];
  releasePendingImportUrls(pending);
  pending = parseCardList(items).map(function (card) {
    card._src = sourceLabel || '粘贴 JSON';
    ensureCharacterIntelligence(applyChineseNicknameAsDisplayName(card));
    return card;
  });
  _pendingImportModes = new WeakMap();
  _pendingComponentModes = new WeakMap();
  $('paste-result').innerHTML =
    '<p class="status-line ok">' +
    uiIcon('check') +
    ' 已分析 ' +
    pending.length +
    ' 张角色卡，请在预览中分别选择导入方式。</p>';
  $('import-paste').style.display = 'none';
  $('import-file').style.display = '';
  var tabs = $('import-modal').querySelectorAll('.tabs button');
  tabs.forEach(function (button, index) {
    button.classList.toggle('active', index === 0);
  });
  renderImportPreview();
  return pending.slice();
}
async function importPaste() {
  const raw = $('paste-json').value.trim();
  if (!raw) {
    toast('请先粘贴角色卡 JSON', 'err');
    return;
  }
  try {
    loadCharacterCardJsonIntoImportPreview(raw, '粘贴 JSON');
  } catch (err) {
    $('paste-result').innerHTML = `<p class="status-line err">${uiIcon('alert')} 解析失败：${esc(err.message)}</p>`;
  }
}
