/* global YeyuTextDiff */ // Loaded with the Risu runtime from js/vendor/jsdiff-9.0.0.js.
// Risu card presentation is isolated from the ST/card-frontend host. Card HTML
// is inert inside a scriptless iframe; the parent owns sizing and interactions.
var _risuDisplayContexts = new WeakMap(),
  _risuEmotionStates = new WeakMap(),
  _risuMessageFrameStates = new Map(),
  _risuDisplayFrames = new Set(),
  _risuDisplaySyncEpoch = 0,
  _risuDisplaySync = null,
  _risuBackgroundFrame = null,
  _risuBackgroundSourceKey = '',
  _risuDisplayContextOwner = null,
  _risuDisplayResizeObserver = null,
  _risuSharedFrameStyles = { source: '', blocks: [], markup: '' };

function risuAssetNameKeys(value) {
  var source = String(value == null ? '' : value).trim(),
    lower = source.toLocaleLowerCase(),
    slash = lower.split(/[\\/]/).pop() || lower,
    stem = slash.replace(/\.[a-z0-9]{1,8}$/i, '');
  return Array.from(new Set([lower, slash, stem].filter(Boolean)));
}
function risuAssetMime(asset) {
  var mime = String((asset && asset.mime) || '').toLowerCase(),
    name = String((asset && (asset.name || asset.originalUri || asset.sourceUrl)) || '').toLowerCase();
  if (mime) return mime;
  if (/\.webp(?:$|[?#])/.test(name)) return 'image/webp';
  if (/\.png(?:$|[?#])/.test(name)) return 'image/png';
  if (/\.jpe?g(?:$|[?#])/.test(name)) return 'image/jpeg';
  if (/\.gif(?:$|[?#])/.test(name)) return 'image/gif';
  if (/\.(?:mp4|m4v)(?:$|[?#])/.test(name)) return 'video/mp4';
  if (/\.webm(?:$|[?#])/.test(name)) return 'video/webm';
  if (/\.mp3(?:$|[?#])/.test(name)) return 'audio/mpeg';
  if (/\.ogg(?:$|[?#])/.test(name)) return 'audio/ogg';
  return 'application/octet-stream';
}
function risuSerializableAssetReference(asset) {
  if (!asset) return '';
  return String(asset.originalUri || asset.sourceUrl || asset.mediaKey || asset.id || '');
}
async function risuAssetUrl(asset, owner) {
  if (!asset || asset.status === 'unavailable') return '';
  var url = cardAssetDisplaySrc(asset, owner);
  if (!url && asset.mediaKey) {
    try {
      var blob = await YeyuRepository.loadMediaBlob(asset.mediaKey);
      if (blob) {
        asset.blob = blob;
        asset.status = 'ready';
        url = cardAssetDisplaySrc(asset, owner);
      }
    } catch (error) {
      console.warn('Risu 素材读取失败', error);
    }
  }
  if (!url) {
    var source = String(asset.sourceUrl || asset.data_url || asset.dataUrl || '');
    if (/^(?:https:|blob:|data:(?:image|audio|video)\/)/i.test(source)) url = source;
  }
  return String(url || '');
}
async function risuDisplayAssetContext(char) {
  if (!char)
    return { assets: [], emotions: [], emotionEntries: [], assetMap: {}, emotionMap: {}, sourceMap: {}, inlayMap: {} };
  var rows = Array.isArray(char.media_assets) ? char.media_assets : [],
    displayRows = rows.filter(function (asset) {
      return asset && (asset.assetType === 'x-risu-asset' || asset.assetType === 'emotion');
    }),
    logicalSignature = displayRows
      .map(function (asset) {
        return [asset.assetType, asset.name, risuSerializableAssetReference(asset)].join(':');
      })
      .join('|'),
    signature = rows
      .map(function (asset) {
        var inline = String((asset && (asset.data_url || asset.dataUrl)) || '');
        return [
          asset && asset.id,
          asset && asset.mediaKey,
          asset && asset.mediaHash,
          asset && asset.status,
          asset && asset.name,
          asset && asset.sourceUrl,
          inline.length,
          inline.slice(0, 32),
          inline.slice(-32),
        ].join(':');
      })
      .join('|'),
    cached = _risuDisplayContexts.get(char);
  if (
    cached &&
    cached.signature === signature &&
    cached.sourceRows &&
    cached.sourceRows.length === displayRows.length &&
    cached.sourceRows.every(function (asset, index) {
      return asset === displayRows[index];
    })
  )
    return cached.promise;
  // editdisplay/CBS output depends on the logical inventory. Blob hydration,
  // object replacement, and status changes only affect the later display URL
  // pass and must not flash the unprocessed message by clearing that cache.
  if (cached && cached.logicalSignature !== logicalSignature && typeof _risuDisplayCache !== 'undefined')
    _risuDisplayCache = new WeakMap();
  var previousAliases = cached && cached.value ? cached.value.logicalAssetAliases || [] : [],
    record = {
      signature: signature,
      logicalSignature: logicalSignature,
      sourceRows: displayRows.slice(),
      promise: null,
      value: null,
    },
    assets = [],
    emotionEntries = [],
    assetMap = Object.create(null),
    emotionMap = Object.create(null);
  displayRows.forEach(function (asset) {
    // Keep inventory construction cheap. cardAssetDisplaySrc can decode an
    // inline payload, so even a synchronous probe would eagerly materialize
    // every asset in a large card.
    var url = String(asset.objectUrl || ''),
      entry = {
        name: String(asset.name || asset.originalUri || asset.id || ''),
        // Undefined keeps CBS macros deferred until this asset is consumed.
        // An empty string would resolve a cold asset to a permanently blank URL.
        url: url || undefined,
        mime: risuAssetMime(asset),
        type: String(asset.assetType || 'x-risu-asset'),
        reference: risuSerializableAssetReference(asset),
        originalUri: String(asset.originalUri || ''),
        sourceUrl: String(asset.sourceUrl || ''),
        mediaKey: String(asset.mediaKey || ''),
      },
      target = entry.type === 'emotion' ? emotionEntries : assets,
      map = entry.type === 'emotion' ? emotionMap : assetMap;
    Object.defineProperties(entry, {
      sourceAsset: { value: asset },
      owner: { value: char },
      loading: { value: null, writable: true },
    });
    target.push(entry);
    risuAssetNameKeys(entry.name).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = entry;
    });
  });
  var logicalAssetAliases = previousAliases
    .concat(assets, emotionEntries)
    .filter(function (entry) {
      return entry && entry.url;
    })
    .map(function (entry) {
      return { url: entry.url, reference: entry.reference || entry.name || '' };
    })
    .filter(function (entry, index, all) {
      return (
        all.findIndex(function (candidate) {
          return candidate.url === entry.url;
        }) === index
      );
    });
  record.value = {
    assets: assets,
    emotions: emotionEntries.map(function (entry) {
      return [entry.name, entry.url];
    }),
    emotionEntries: emotionEntries,
    assetMap: assetMap,
    emotionMap: emotionMap,
    logicalAssetAliases: logicalAssetAliases.slice(-Math.max(32, rows.length * 2)),
    inlayMap: {},
    risuLogoUrl:
      typeof document === 'object' && document.baseURI
        ? new URL('risu-logo.png', document.baseURI).href
        : 'risu-logo.png',
  };
  record.promise = Promise.resolve(record.value);
  _risuDisplayContexts.set(char, record);
  return record.promise;
}

async function risuEnsureDisplayAsset(entry, context) {
  if (!entry) return '';
  if (entry.url) {
    // Character switches can retire an object URL while the lightweight name
    // index is still cached. Re-materialize that one entry when it is used.
    if (!entry.sourceAsset || !/^blob:/i.test(entry.url) || entry.sourceAsset.objectUrl === entry.url) return entry.url;
    entry.url = '';
  }
  if (!entry.loading)
    entry.loading = risuAssetUrl(entry.sourceAsset, entry.owner).then(function (url) {
      entry.url = String(url || '');
      entry.loading = null;
      if (!entry.url) return '';
      var cached = context || risuCachedDisplayAssetContext(entry.owner);
      if (cached) {
        if (entry.type === 'emotion') {
          var emotion = cached.emotions.find(function (row) {
            return row[0] === entry.name;
          });
          if (emotion) emotion[1] = entry.url;
        }
        if (
          !cached.logicalAssetAliases.some(function (alias) {
            return alias.url === entry.url;
          })
        )
          cached.logicalAssetAliases.push({ url: entry.url, reference: entry.reference || entry.name || '' });
      }
      return entry.url;
    });
  return entry.loading;
}
function risuCachedDisplayAssetContext(char) {
  var record = char && _risuDisplayContexts.get(char);
  return (record && record.value) || null;
}
function risuDeferredCBSAssetContext(context) {
  function copies(rows) {
    return (rows || []).map(function (entry) {
      return {
        name: entry.name,
        url: undefined,
        mime: entry.mime,
        type: entry.type,
        reference: entry.reference,
        originalUri: entry.originalUri,
        sourceUrl: entry.sourceUrl,
        mediaKey: entry.mediaKey,
      };
    });
  }
  function index(rows) {
    var map = Object.create(null);
    rows.forEach(function (entry) {
      risuAssetNameKeys(entry.name).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = entry;
      });
    });
    return map;
  }
  var assets = copies(context && context.assets),
    emotions = copies(context && context.emotionEntries);
  return {
    assets: assets,
    emotions: emotions.map(function (entry) {
      return [entry.name, ''];
    }),
    emotionEntries: emotions,
    assetMap: index(assets),
    emotionMap: index(emotions),
    sourceMap: Object.create(null),
    inlayMap: Object.create(null),
    risuLogoUrl: context && context.risuLogoUrl,
  };
}
// Asset macros become media when a message is displayed; as text they are neither read nor searched.
function risuStripAssetMacros(value) {
  return String(value == null ? '' : value).replace(
    /\{\{(?:raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source|inlay|inlayed|inlayeddata)::[\s\S]*?\}\}/gi,
    ''
  );
}
function risuAdoptDisplayContextOwner(char) {
  var nextOwner = char && isRisuCharacter(char) ? char : null;
  if (_risuDisplayContextOwner && _risuDisplayContextOwner !== nextOwner) {
    _risuDisplayContexts.delete(_risuDisplayContextOwner);
    if (typeof _risuDisplayCache !== 'undefined') _risuDisplayCache = new WeakMap();
  }
  _risuDisplayContextOwner = nextOwner;
  return nextOwner;
}
function risuDisplayObjectUrlsInUse(char) {
  var nextOwner = risuAdoptDisplayContextOwner(char);
  if (!nextOwner) return [];
  var context = risuCachedDisplayAssetContext(nextOwner),
    urls = [];
  (Array.isArray(nextOwner.media_assets) ? nextOwner.media_assets : []).forEach(function (asset) {
    var url = asset && asset.objectUrl;
    if (/^blob:/i.test(String(url || '')) && !urls.includes(url)) urls.push(url);
  });
  if (context)
    context.assets.concat(context.emotionEntries).forEach(function (entry) {
      if (entry && /^blob:/i.test(String(entry.url || '')) && !urls.includes(entry.url)) urls.push(entry.url);
    });
  if (typeof document === 'object')
    Array.from(document.querySelectorAll('#chat-messages iframe.risu-display-frame, iframe.risu-background-frame')).forEach(function (frame) {
      var doc = frame.contentDocument,
        host = frame.closest('.risu-display-host'),
        ready = host ? host.hasAttribute('data-risu-ready') : frame._risuReady === true;
      function addImageSources(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        Array.from(root.querySelectorAll('[src^="blob:"]')).forEach(function (node) {
          var url = String(node.getAttribute('src') || '');
          if (url && !urls.includes(url)) urls.push(url);
        });
      }
      if (ready) addImageSources(doc);
      else {
        // srcdoc becomes the iframe's document before its body is ready. Keep
        // its declared image URLs through navigation, then use the live DOM.
        var source = String(frame.srcdoc || frame.getAttribute('srcdoc') || ''),
          parsed = source && typeof DOMParser === 'function' ? new DOMParser().parseFromString(source, 'text/html') : null;
        addImageSources(parsed);
      }
    });
  var stage = typeof document === 'object' && document.getElementById('risu-emotion-stage'),
    stageImage = stage && stage.getAttribute('data-risu-screen') === 'imggen' && stage.querySelector('img'),
    stageUrl = stageImage && stageImage.src;
  if (/^blob:/i.test(String(stageUrl || '')) && !urls.includes(stageUrl)) urls.push(stageUrl);
  return urls;
}
function risuLookupDisplayAsset(context, name, emotion) {
  var map = (emotion ? context && context.emotionMap : context && context.assetMap) || {},
    rows = emotion ? context && context.emotionEntries : context && context.assets;
  for (var key of risuAssetNameKeys(name)) if (map[key]) return map[key];
  if (emotion) return null;
  // Fixed RisuAI v2026.10.211 falls back to a Levenshtein match after removing
  // common media extensions. Its default assetMaxDifference is four.
  var trim = function (value) {
      return String(value || '')
        .toLocaleLowerCase()
        .replace(/\.(?:webp|png|jpe?g|gif|mp4|webm|avi|m4p|m4v|mp3|wav|ogg)$/i, '');
    },
    wanted = trim(name),
    best = null,
    bestDistance = 5;
  if (!wanted) return null;
  (rows || []).forEach(function (entry) {
    var distance = risuNameDistance(wanted, trim(entry && entry.name));
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  });
  return bestDistance <= 4 ? best : null;
}
function risuMediaElement(type, entry) {
  if (!entry || !entry.url) return '';
  var url = escAttr(entry.url),
    mime = escAttr(entry.mime || '');
  if (type === 'raw' || type === 'path') return entry.url;
  if (type === 'audio') return '<audio controls autoplay loop><source src="' + url + '" type="' + mime + '"></audio>';
  if (type === 'video' || type === 'video-img')
    return (
      '<video autoplay ' +
      (type === 'video-img' ? 'muted ' : 'controls ') +
      'loop><source src="' +
      url +
      '" type="' +
      mime +
      '"></video>'
    );
  var image = '<img src="' + url + '" alt="' + escAttr(entry.name || '') + '">';
  return type === 'image'
    ? '<div class="risu-inlay-image">' + image + '</div>\n'
    : image + (type === 'asset' ? '\n' : '');
}
async function risuResolveAssetMacros(value, context, options) {
  options = options || {};
  var text = String(value == null ? '' : value),
    pattern = /\{\{(raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source)::(.+?)\}\}/gims,
    output = '',
    cursor = 0,
    match;
  while ((match = pattern.exec(text))) {
    output += text.slice(cursor, match.index);
    var type = match[1].toLocaleLowerCase(),
      name = String(match[2] || '').trim(),
      replacement = '';
    if (type === 'source') {
      var source = context && context.inlayMap && context.inlayMap[name.toLocaleLowerCase()];
      replacement = source && source.url ? source.url : match[0];
    } else {
      var entry = risuLookupDisplayAsset(context, name, type === 'emotion');
      if (entry) await risuEnsureDisplayAsset(entry, context);
      if (entry && entry.url) {
        if (type === 'bg')
          replacement = options.background
            ? '<div class="risu-asset-background" style="background-image:linear-gradient(rgba(0,0,0,.8),rgba(0,0,0,.8)),url(&quot;' +
              escAttr(entry.url) +
              '&quot;)"></div>'
            : '';
        else if (type === 'bgm')
          replacement =
            '<div risu-ctrl="bgm___auto___' +
            escAttr(entry.url) +
            '" hidden></div>';
        else if (type === 'asset' && /^video\//i.test(entry.mime || ''))
          replacement = risuMediaElement('video-img', entry);
        else replacement = risuMediaElement(type, entry);
      } else if (
        /^(?:img|image|emotion|asset)$/.test(type) &&
        !(type === 'asset' && entry && /^video\//i.test(entry.mime || ''))
      ) {
        replacement = RichDisplay.missingImage(name).outerHTML;
      } else if (type === 'raw' || type === 'path') replacement = match[0];
    }
    output += replacement;
    cursor = pattern.lastIndex;
  }
  output += text.slice(cursor);
  // Keep missing URL macros just long enough to recover their asset name from
  // card-authored image tags. Bare URLs and non-image media still resolve empty.
  output = output.replace(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, function (html) {
    var template = document.createElement('template');
    template.innerHTML = html;
    var image = template.content.querySelector('img'),
      src = image && image.getAttribute('src'),
      missing = /\{\{(?:raw|path|source)::(.+?)\}\}/is.exec(src || '');
    if (missing) return RichDisplay.missingImage(image.alt || missing[1].trim()).outerHTML;
    if (image && src && (!image.alt || image.alt === src)) {
      var asset = ((context && context.assets) || [])
        .concat((context && context.emotionEntries) || [])
        .find(function (entry) {
          return entry.url === src;
        });
      if (asset) {
        image.alt = asset.name;
        return image.outerHTML;
      }
    }
    return html;
  });
  return output.replace(pattern, '');
}
function risuImageInlayId(kind, item, field) {
  return ['yeyu-media', kind, encodeURIComponent(String((item && item.id) || '')), field].join(':');
}
function risuImageInlayToken(kind, item, field) {
  if (!item) return '';
  return '{{inlayed::' + risuImageInlayId(kind, item, field || 'avatar_image') + '}}';
}
// 文本里引用的 inlay id（{{inlay::}}、{{inlayed::}}、{{inlayeddata::}}），按出现顺序去重。
function risuReferencedInlayIds(value) {
  var ids = [];
  String(value == null ? '' : value).replace(/\{\{(?:inlay|inlayed|inlayeddata)::(.+?)\}\}/gims, function (_, id) {
    id = String(id).trim();
    if (ids.indexOf(id) < 0) ids.push(id);
    return '';
  });
  return ids;
}
// 角色/人格头像 inlay，加上会话 session.risu.inlays（缺省为当前会话）与 staged（事务里尚未提交的出图）。
// 给了 ids 时只读入其中的会话 inlay，免得每次显示都把整个会话的图片读成 Blob。
async function risuImageInlayContext(char, session, staged, ids, isCurrent, displayAssets) {
  var persona = char ? getActivePersona(char.id) : null,
    result = Object.create(null),
    entries = [
      ['char', char, 'avatar_image'],
      ['user', persona, 'avatar_image'],
    ];
  for (var row of entries) {
    var kind = row[0],
      item = row[1],
      field = row[2];
    if (!item) continue;
    var url = displayImageSrc(item, field);
    if (!url && item._media && item._media[field] && YeyuRepository && YeyuRepository.loadMediaBlob) {
      var blob = await YeyuRepository.loadMediaBlob(item._media[field]);
      if (blob) {
        item._mediaBlobs = item._mediaBlobs || {};
        item._mediaBlobs[field] = blob;
        url = displayImageSrc(item, field);
      }
    }
    if (url)
      result[kind] = result[risuImageInlayId(kind, item, field)] = {
        name: kind,
        url: url,
        mime: 'image/*',
        type: 'inlay',
      };
  }
  if (session === undefined && char) session = getActiveSession(char.id);
  var inlays = Object.assign({}, session && session.risu && session.risu.inlays, staged);
  for (var id of ids ? ids : Object.keys(inlays)) {
    if (!Object.prototype.hasOwnProperty.call(inlays, id)) continue;
    var src = char ? await storedImageDisplaySrcReady(inlays[id], char.id, isCurrent, displayAssets) : '';
    if (src) result[id] = { name: id, url: src, mime: inlays[id].mime || 'image/*', type: 'inlay', generated: true };
  }
  return result;
}
function risuResolveInlayMacros(value, context) {
  var occurrences = Object.create(null);
  return String(value == null ? '' : value).replace(
    /\{\{(?:inlay|inlayed|inlayeddata)::(.+?)\}\}/gims,
    function (_, id) {
      id = String(id).trim();
      var entry = context && context.inlayMap && context.inlayMap[id],
        occurrence = occurrences[id] || 0;
      occurrences[id] = occurrence + 1;
      if (!entry || !entry.url) return RichDisplay.missingImage(id).outerHTML;
      var html = risuMediaElement('image', entry);
      return entry.generated
        ? html.replace('<img ', '<img data-generated-image="' + escAttr(id) + '" data-risu-inlay-occurrence="' + occurrence + '" ')
        : html;
    }
  );
}
function risuCardDisplayOptions(char) {
  var card = char ? risuCardSources(char).card || {} : {};
  return {
    viewScreen: /^(?:emotion|imggen)$/.test(String(card.viewScreen || '')) ? String(card.viewScreen) : 'none',
    inlayViewScreen: card.inlayViewScreen === true,
    hideChatIcon: card.hideChatIcon === true,
    largePortrait: card.largePortrait === true,
    prebuiltAssetStyle: String(card.prebuiltAssetStyle || ''),
  };
}
// 该消息的出图进行中时，回复里的 ImgGen 标签显示为占位（上游此时把标签写成 [Generating...]），完成后标签已换成
// inlay 或空串。没有出图在进行（回复被停止或不完整、重载之后）时标签原样交给显示，与上游未经 runInlayScreen 的回复一致。
const RISU_IMGGEN_PLACEHOLDER = '[正在生成图片…]';
function risuPrepareInlayScreenSource(value, char, imgGenPending) {
  var options = risuCardDisplayOptions(char),
    text = String(value == null ? '' : value);
  if (options.inlayViewScreen && options.viewScreen === 'emotion')
    text = text.replace(/<Emotion="(.+?)">/gi, '{{emotion::$1}}');
  if (imgGenPending && options.inlayViewScreen && options.viewScreen === 'imggen')
    text = text
      .replace(/<ImgGen="(.+?)">/gi, RISU_IMGGEN_PLACEHOLDER)
      .replace(/\{\{ImgGen="(.+?)"\}\}/gi, RISU_IMGGEN_PLACEHOLDER);
  return text;
}
function risuNameDistance(a, b) {
  a = String(a || '');
  b = String(b || '');
  var previous = Array.from({ length: b.length + 1 }, function (_, index) {
    return index;
  });
  for (var i = 1; i <= a.length; i++) {
    var current = [i];
    for (var j = 1; j <= b.length; j++)
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}
async function risuResolvePrebuiltImages(value, context, style) {
  var text = String(value == null ? '' : value),
    rows = (context && context.assets) || [];
  if (!rows.length || !/<img\b/i.test(text)) return text;
  var pattern = /<img\b([^>]*?)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>/gi,
    output = '',
    cursor = 0,
    match;
  while ((match = pattern.exec(text))) {
    output += text.slice(cursor, match.index);
    var full = match[0],
      before = match[1],
      quote = match[2],
      source = match[3],
      after = match[4],
      name = String(source || '').toLocaleLowerCase(),
      replacement = full;
    // Upstream order: exact names of any length first, then nearest-name fallback for names of 3+ characters.
    if (name && name.length <= 200 && !name.includes(':')) {
      var found = rows.find(function (entry) {
        return String(entry.name || '').toLocaleLowerCase() === name;
      });
      if (!found && name.length >= 3) {
        var dot = name.lastIndexOf('.'),
          prefix = dot > 0 ? name.substring(0, dot) : '',
          distance = 1000;
        rows.forEach(function (entry) {
          var candidate = String(entry.name || '').toLocaleLowerCase();
          if (!candidate.startsWith(prefix)) return;
          var next = risuNameDistance(name, candidate);
          if (next < distance) {
            distance = next;
            found = entry;
          }
        });
      }
      if (found) await risuEnsureDisplayAsset(found, context);
      if (found && found.url) {
        var classMatch = String(before + ' ' + after).match(/\bclass\s*=\s*(["'])(.*?)\1/i),
          classes = classMatch ? classMatch[2].split(/\s+/).filter(Boolean) : [];
        ['root-loaded-image', 'root-loaded-image-' + String(style || '')].forEach(function (className) {
          if (className !== 'root-loaded-image-' && !classes.includes(className)) classes.push(className);
        });
        var attrs = before + after;
        if (classMatch)
          attrs = attrs.replace(classMatch[0], 'class=' + classMatch[1] + classes.join(' ') + classMatch[1]);
        else attrs += ' class="' + classes.join(' ') + '"';
        if (!/\balt\s*=/i.test(attrs)) attrs += ' alt="' + escAttr(found.name || source) + '"';
        replacement =
          '<img' +
          attrs +
          ' src=' +
          quote +
          escAttr(found.url) +
          quote +
          '>';
      } else if (found) replacement = RichDisplay.missingImage(found.name || source).outerHTML;
    }
    output += replacement;
    cursor = pattern.lastIndex;
  }
  return output + text.slice(cursor);
}
function risuDisplayLogicalSource(value, context) {
  var text = String(value == null ? '' : value),
    rows = ((context && context.assets) || [])
      .concat((context && context.emotionEntries) || [])
      .concat((context && context.logicalAssetAliases) || []);
  rows.forEach(function (entry) {
    if (!entry || !entry.url) return;
    text = text.split(entry.url).join('{{yeyu-risu-asset::' + String(entry.reference || entry.name || '') + '}}');
  });
  return text;
}
async function risuRefreshLogicalAssetUrls(value, context) {
  var text = String(value == null ? '' : value),
    entries = ((context && context.assets) || []).concat((context && context.emotionEntries) || []),
    aliases = ((context && context.logicalAssetAliases) || []).slice();
  for (var alias of aliases) {
    if (!alias || !alias.url || text.indexOf(alias.url) < 0) continue;
    var entry = entries.find(function (candidate) {
      return candidate && String(candidate.reference || candidate.name || '') === String(alias.reference || '');
    });
    if (!entry) continue;
    await risuEnsureDisplayAsset(entry, context);
    if (entry.url && entry.url !== alias.url) text = text.split(alias.url).join(entry.url);
  }
  return text;
}
function risuNeedsIsolatedDisplay(value) {
  value = String(value == null ? '' : value);
  return (
    /<(?:style|details|summary|div|section|article|aside|header|footer|table|form|button|img|video|audio|canvas|svg|iframe|emotion|imggen|a|span|p|input|select|textarea)\b/i.test(
      value
    ) ||
    /\{\{ImgGen=/i.test(value) ||
    /\{\{(?:raw|path|source|img|image|video|audio|bgm|bg|emotion|asset|video-img|inlay|inlayed|inlayeddata)::/i.test(
      value
    )
  );
}
// options.imgGenPending：这条消息的卡片出图正在进行（见 33 号 risuInlayScreenPending）。
async function risuDisplaySource(value, char, options) {
  options = options || {};
  var cached = await risuDisplayAssetContext(char),
    context = Object.assign({}, cached),
    session = char ? getActiveSession(char.id) : null;
  Object.assign(cached.inlayMap, await risuImageInlayContext(char, undefined, null, []));
  context.inlayMap = Object.assign(Object.create(null), cached.inlayMap);
  context.sourceMap = { char: context.inlayMap.char, user: context.inlayMap.user };
  context.mode = options.background === true ? 'back' : 'display';
  context.displaying = true;
  context.resolveAssets = true;
  var displayOptions = risuCardDisplayOptions(char),
    source = await risuRefreshLogicalAssetUrls(
      risuPrepareInlayScreenSource(value, char, options.imgGenPending === true),
      context
    ),
    text = await risuResolveAssetMacros(source, context, { background: options.background === true });
  text = await risuResolvePrebuiltImages(text, context, displayOptions.prebuiltAssetStyle);
  var referencedIds = risuReferencedInlayIds(text);
  Object.assign(context.inlayMap, await risuImageInlayContext(char, session, null, referencedIds, options.isCurrent, options.imageAssets));
  context.sourceMap = { char: context.inlayMap.char, user: context.inlayMap.user };
  return { text: risuResolveInlayMacros(text, context), context: context };
}
async function risuApplyEmotionEffects(char, session, effects) {
  if (!char || !session || !isRisuCharacter(char)) return null;
  var context = await risuDisplayAssetContext(char),
    next = null,
    rows = Array.isArray(effects) ? effects : effects ? [effects] : [];
  for (var effect of rows) {
    if (!effect || effect.type !== 'emotion') continue;
    var entry = effect.asset
      ? { name: String(effect.name || ''), url: String(effect.asset), mime: 'image/*', type: 'emotion' }
      : risuLookupDisplayAsset(context, effect.name, true);
    if (entry) await risuEnsureDisplayAsset(entry, context);
    if (entry && entry.url) next = entry;
  }
  if (next) _risuEmotionStates.set(session, next);
  await risuSyncEmotionStage(char, session);
  return next;
}
function risuCurrentEmotion(session) {
  return (session && _risuEmotionStates.get(session)) || null;
}
async function risuSyncEmotionStage(char, session, isCurrent, imageAssets) {
  var main = document.getElementById('main'),
    existing = document.getElementById('risu-emotion-stage'),
    options = risuCardDisplayOptions(char),
    image = null,
    screen = '';
  if (char && session && isRisuCharacter(char) && options.viewScreen === 'emotion' && !options.inlayViewScreen) {
    image = risuCurrentEmotion(session);
    screen = 'emotion';
  } else if (
    char && session && isRisuCharacter(char) && options.viewScreen === 'imggen' && !options.inlayViewScreen &&
    session.risu && session.risu.viewScreenImage
  ) {
    var viewImage = session.risu.viewScreenImage,
      currentImageDisplay = isCurrent || function () {
        return getChar() === char && getActiveSession(char.id) === session;
      },
      url = await storedImageDisplaySrcReady(viewImage, char.id, currentImageDisplay, imageAssets);
    if (!currentImageDisplay()) return;
    if (url) {
      image = { name: '', url: url };
      screen = 'imggen';
    }
  }
  if (!image) {
    if (existing) existing.remove();
    if (char && getChar() === char)
      syncCardAssetObjectUrlLifecycle(char);
    return;
  }
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'risu-emotion-stage';
    existing.setAttribute('aria-hidden', 'true');
    existing.innerHTML = '<img alt="">';
    main.insertBefore(existing, document.getElementById('chat-messages'));
  }
  existing.setAttribute('data-risu-screen', screen);
  existing.querySelector('img').src = image.url;
  risuSyncBackgroundGeometry();
  if (char && getChar() === char)
    syncCardAssetObjectUrlLifecycle(char);
}
function risuSyncCharacterDisplayOptions(char) {
  if (!document.body) return;
  var active = char && isRisuCharacter(char),
    options = risuCardDisplayOptions(active ? char : null);
  document.body.classList.toggle('risu-character', !!active);
  document.body.classList.toggle('risu-hide-chat-icon', !!(active && options.hideChatIcon));
  document.body.classList.toggle('risu-large-portrait', !!(active && options.largePortrait));
  document.body.classList.toggle('risu-view-screen', !!(active && options.viewScreen !== 'none'));
}
function risuDisplayPlaceholderHtml(value, index, role, partIndex) {
  var source = String(value == null ? '' : value),
    readable = source
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|aside|header|footer|li|tr|table|details|summary|h[1-6])\s*>/gi, '\n');
  if (/<[a-z!/][\s\S]*?>/i.test(readable) && typeof DOMParser === 'function') {
    var parsed = new DOMParser().parseFromString(readable, 'text/html');
    readable = (parsed.body && parsed.body.textContent) || '';
  } else readable = readable.replace(/<[^>]*>/g, '');
  readable = readable
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!readable) readable = '正在加载卡片演出…';
  var safe = esc(readable),
    sourceSafe = esc(source);
  return (
    '<div class="risu-display-host" data-risu-message-index="' +
    Number(index) +
    '" data-risu-role="' +
    (role === 'user' ? 'user' : 'assistant') +
    '" data-risu-display-part="' +
    Number(partIndex || 0) +
    '"><div class="risu-display-source" hidden style="display:none!important">' +
    sourceSafe +
    '</div><div class="risu-display-fallback">' +
    safe +
    '</div></div>'
  );
}
function risuFrameAppearance(target, role) {
  var style = target && typeof getComputedStyle === 'function' ? getComputedStyle(target) : null,
    rootStyle =
      document.documentElement && typeof getComputedStyle === 'function'
        ? getComputedStyle(document.documentElement)
        : null,
    clean = function (value, fallback) {
      value = String(value || fallback || '');
      return value.replace(/<\/(?=style)/gi, '<\\/').replace(/[\r\n]+/g, ' ');
    },
    tone = function (name, fallback) {
      return clean(rootStyle && rootStyle.getPropertyValue(name), fallback);
    };
  return {
    scheme: document.documentElement && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    role: role === 'user' ? 'user' : 'assistant',
    immersive: !!(document.body && document.body.classList.contains('message-style-immersive')),
    color: clean(style && style.color, rootStyle && rootStyle.getPropertyValue('--t')),
    fontFamily: clean(style && style.fontFamily, rootStyle && rootStyle.getPropertyValue('--font')),
    fontSynthesis: clean(style && style.fontSynthesis, 'weight style'),
    fontSize: clean(style && style.fontSize, rootStyle && rootStyle.getPropertyValue('--type-chat')),
    fontWeight: clean(style && style.fontWeight, rootStyle && rootStyle.getPropertyValue('--weight-chat')),
    strongWeight: clean(style && style.getPropertyValue('--weight-chat-strong'), tone('--weight-chat-strong', '700')),
    lineHeight: clean(style && style.lineHeight, rootStyle && rootStyle.getPropertyValue('--line-chat')),
    letterSpacing: clean(style && style.letterSpacing, 'normal'),
    textShadow: clean(style && style.textShadow, 'none'),
    mediaBorder: clean(rootStyle && rootStyle.getPropertyValue('--ui-line-bright')),
    mediaColor: clean(rootStyle && rootStyle.getPropertyValue('--t-dim')),
    tonePlain: tone('--tone-plain', '#f4f4f5'),
    toneParen: tone('--tone-paren', '#b8d8ff'),
    toneQuote: tone('--tone-quote', '#f3c3e7'),
    toneBold: tone('--tone-bold', '#d7b8ff'),
    toneBracket: tone('--tone-bracket', '#ffe4a8'),
    toneBracketBackground: tone('--tone-bracket-bg', 'rgba(139,92,246,.18)'),
    toneBracketBorder: tone('--tone-bracket-border', 'rgba(139,92,246,.35)'),
    toneNarration: tone('--tone-narration', '#d7b8ff'),
    toneInvalid: tone('--tone-invalid', '#ff9aa8'),
    toneInvalidBackground: tone('--tone-invalid-bg', 'rgba(255,120,140,.14)'),
  };
}
function risuFrameHostStyle(appearance, background) {
  appearance = appearance || risuFrameAppearance(null);
  var semanticStyle = background
    ? ''
    : ':root{--tone-plain:' +
      appearance.tonePlain +
      ';--tone-paren:' +
      appearance.toneParen +
      ';--tone-quote:' +
      appearance.toneQuote +
      ';--tone-bold:' +
      appearance.toneBold +
      ';--tone-bracket:' +
      appearance.toneBracket +
      ';--tone-bracket-bg:' +
      appearance.toneBracketBackground +
      ';--tone-bracket-border:' +
      appearance.toneBracketBorder +
      ';--tone-narration:' +
      appearance.toneNarration +
      ';--tone-invalid:' +
      appearance.toneInvalid +
      ';--tone-invalid-bg:' +
      appearance.toneInvalidBackground +
      '}' +
      (appearance.role === 'assistant'
        ? ':where(.tone-plain){color:var(--tone-narration)}'
        : ':where(.tone-plain){color:inherit}') +
      ':where(em,.tone-narration){color:var(--tone-narration)}' +
      ':where(strong,.tone-bold){color:var(--tone-bold)}' +
      ':where(b,strong,.tone-bold,.tone-bracket,.tone-invalid-directive,h1,h2,h3,h4,h5,h6,th){font-weight:' +
      appearance.strongWeight +
      '}' +
      ':where(.tone-paren){color:var(--tone-paren)}' +
      ':where(.tone-quote){color:var(--tone-quote)}' +
      ':where(.tone-bracket){color:var(--tone-bracket);background:var(--tone-bracket-bg);border:1px solid var(--tone-bracket-border);border-radius:5px;padding:0 3px}' +
      ':where(.tone-invalid-directive){color:var(--tone-invalid);background:var(--tone-invalid-bg);border-bottom:1px dashed var(--tone-invalid)}' +
      ':where(.tone-bracket,.tone-invalid-directive){box-decoration-break:clone;-webkit-box-decoration-break:clone}' +
      ':where(.tone-quote,.tone-paren,.tone-bracket,.tone-invalid-directive) .tone-plain{color:inherit;font-style:inherit}' +
      ':where(.tone-bracket,.tone-invalid-directive) *{color:inherit;text-shadow:inherit}' +
      (appearance.immersive
        ? ':where(em,.tone-narration' +
          (appearance.role === 'assistant' ? ',.tone-plain' : '') +
          '){font-style:italic}' +
          ':where(.tone-quote,.tone-paren,.tone-bold,.tone-bracket,.tone-invalid-directive,code,pre){font-style:normal}'
        : '');
  return (
    'html,body{box-sizing:border-box;margin:0;padding:0;width:100%;min-width:0;background:transparent;overflow:hidden}' +
    'html{color-scheme:' +
    appearance.scheme +
    ';--ui-line-bright:' +
    appearance.mediaBorder +
    ';--t-dim:' +
    appearance.mediaColor +
    '}' +
    '*,*:before,*:after{box-sizing:border-box}body{color:' +
    appearance.color +
    ';font-family:' +
    appearance.fontFamily +
    ';font-size:' +
    appearance.fontSize +
    ';font-weight:' +
    appearance.fontWeight +
    ';font-synthesis:' +
    appearance.fontSynthesis +
    ';line-height:' +
    appearance.lineHeight +
    ';letter-spacing:' +
    appearance.letterSpacing +
    ';text-shadow:' +
    appearance.textShadow +
    ';overflow-wrap:anywhere}' +
    'img,video,svg,canvas{display:block;max-width:100%;height:auto}audio{max-width:100%}' +
    'details{max-width:100%}summary,button,[risu-trigger],[risu-btn]{cursor:pointer}' +
    '.risu-inlay-image{max-width:100%}.risu-asset-background{position:absolute;inset:0;background-size:cover;background-position:center}' +
    '.root-loaded-image{display:block;width:calc(100% - 1rem);max-width:20rem;height:auto;margin-left:auto;margin-right:auto;border-radius:.5rem;box-shadow:0 2px 4px rgba(137,137,137,.1)}' +
    '.root-loaded-image-dynamic{max-height:14rem;object-fit:cover;object-position:top;transition:max-height .5s ease}.root-loaded-image-dynamic:hover{max-height:30rem}' +
    RichDisplay.missingMediaStyle() +
    semanticStyle +
    (background ? 'html,body,#risu-root{width:100%;height:100%;min-height:100%;overflow:hidden}' : '')
  );
}
// Message text follows the host's reading face, which in immersive mode is the bundled serif. Message
// frames share page-owned FontFace objects built from the app's own @font-face rules for that face:
// all frames then use one download and one decoded font, whereas an @font-face rule inside each frame
// fetches and decodes the file again per frame. The faces load in the page, so the frame CSP keeps
// local fonts out.
var _risuFrameFontFaces = null;
function risuFrameFontFaces() {
  if (_risuFrameFontFaces) return _risuFrameFontFaces;
  var serifStack = getComputedStyle(document.documentElement).getPropertyValue('--font-serif');
  _risuFrameFontFaces = [];
  Array.from(document.styleSheets).forEach(function (sheet) {
    // Linked sheets are first-party; card-owned CSS lives in inline <style>.
    if (!sheet.href) return;
    var rules;
    try {
      rules = Array.from(sheet.cssRules || []);
    } catch (_) {
      // An unreadable sheet only costs the shared face; the frame then falls back along the serif stack.
      return;
    }
    rules.forEach(function (rule) {
      var family = rule.type === CSSRule.FONT_FACE_RULE ? rule.style.getPropertyValue('font-family') : '';
      if (!family || serifStack.indexOf(family) < 0) return;
      var source = rule.style
        .getPropertyValue('src')
        .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (_, quote, reference) {
          return 'url("' + new URL(reference, sheet.href).href + '")';
        });
      _risuFrameFontFaces.push(
        new FontFace(family.replace(/^(['"])(.*)\1$/, '$2'), source, {
          weight: rule.style.getPropertyValue('font-weight') || 'normal',
          style: rule.style.getPropertyValue('font-style') || 'normal',
          display: rule.style.getPropertyValue('font-display') || 'auto',
        })
      );
    });
  });
  return _risuFrameFontFaces;
}
function risuShareFrameFonts(frame) {
  var fonts = frame.contentDocument && frame.contentDocument.fonts;
  if (!fonts) return;
  risuFrameFontFaces().forEach(function (face) {
    fonts.add(face);
  });
}
function risuFrameDocument(html, background, appearance) {
  appearance = appearance || risuFrameAppearance(null);
  var csp =
      "default-src 'none'; img-src https: blob: data:; media-src https: blob: data:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
    baseStyle = risuFrameHostStyle(appearance, background);
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="' +
    appearance.scheme +
    '"><meta http-equiv="Content-Security-Policy" content="' +
    csp +
    '"><meta name="viewport" content="width=device-width,initial-scale=1"><style data-risu-host-appearance>' +
    baseStyle +
    '</style></head><body><div id="risu-root">' +
    String(html || '').replace(/<\/(?:body|html)>/gi, '') +
    '</div></body></html>'
  );
}
function risuSyncFrameAppearance() {
  var frames = Array.from(_risuDisplayFrames);
  if (_risuBackgroundFrame) frames.push(_risuBackgroundFrame);
  frames.forEach(function (frame) {
    if (!frame || !frame.isConnected || !frame.contentDocument) return;
    var doc = frame.contentDocument,
      style = doc.querySelector('style[data-risu-host-appearance]'),
      background = frame.classList.contains('risu-background-frame'),
      target = background ? document.getElementById('chat-messages') : frame.closest('.msg-bubble') || frame,
      host = background ? null : frame.closest('.risu-display-host'),
      appearance = risuFrameAppearance(target, host && host.getAttribute('data-risu-role')),
      meta = doc.querySelector('meta[name="color-scheme"]');
    if (!style) return;
    style.textContent = risuFrameHostStyle(appearance, background);
    if (meta) meta.setAttribute('content', appearance.scheme);
    if (!background) {
      risuResizeFrame(frame);
      requestAnimationFrame(function () {
        risuResizeFrame(frame);
      });
    }
  });
}
function risuRefreshFrameAppearance() {
  risuSyncFrameAppearance();
  var targets = new Set();
  Array.from(_risuDisplayFrames).forEach(function (frame) {
    if (frame && frame.isConnected) targets.add(frame.closest('.msg-bubble') || frame);
  });
  targets.forEach(function (target) {
    if (target._risuAppearanceTransitionListener) {
      target.removeEventListener('transitionend', target._risuAppearanceTransitionListener);
      delete target._risuAppearanceTransitionListener;
    }
  });
  // Hidden chat content does not run its color transition. The page-return
  // lifecycle calls this again after the host becomes visible.
  if (document.body.dataset.page && document.body.dataset.page !== 'chat') return;
  targets.forEach(function (target) {
    var listener = function (event) {
      if (event.target !== target || event.propertyName !== 'color') return;
      target.removeEventListener('transitionend', listener);
      delete target._risuAppearanceTransitionListener;
      risuSyncFrameAppearance();
    };
    target._risuAppearanceTransitionListener = listener;
    target.addEventListener('transitionend', listener);
  });
}
function risuSplitFrameStyles(source) {
  // CSS remains card-owned inside the scriptless frame. Strip the HTML style
  // boundary here; CSP limits its resources to the authorized HTTPS/media URLs.
  var styleBlocks = [];
  source = String(source == null ? '' : source).replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, function (_, css) {
    styleBlocks.push(String(css || '').replace(/<\/(?=style)/gi, '<\\/'));
    return '';
  });
  return {
    body: source,
    blocks: styleBlocks,
    styles: styleBlocks
      .map(function (css) {
        return '<style>' + css + '</style>';
      })
      .join(''),
  };
}
function risuSetSharedFrameStyles(styles) {
  // Background CSS and every visible message stylesheet form one ordered set
  // shared by all message frames; a new blocks array marks a changed set.
  styles = String(styles || '');
  if (styles === _risuSharedFrameStyles.source) return;
  var blocks = risuSplitFrameStyles(styles).blocks;
  _risuSharedFrameStyles = {
    source: styles,
    blocks: blocks,
    // Each block keeps its own element so @import and similar rules stay valid.
    markup: blocks
      .map(function (css) {
        return '<style data-risu-shared-style>' + css + '</style>';
      })
      .join(''),
  };
}
function risuSyncSharedFrameStyles(frame) {
  var doc = frame && frame.contentDocument,
    root = doc && doc.getElementById('risu-root'),
    blocks = _risuSharedFrameStyles.blocks,
    applied = frame && frame._risuSharedStyleBlocks;
  if (!root || !applied || applied === blocks) return;
  // Edit the shared style nodes in place instead of reloading the frame, so the
  // body, its control state and listeners survive. Unchanged blocks keep their
  // parsed sheets; an appended message only adds its own.
  var nodes = Array.from(root.querySelectorAll(':scope > style[data-risu-shared-style]')),
    remaining = new Map(),
    next = 0,
    previous = null;
  blocks.forEach(function (css) {
    remaining.set(css, (remaining.get(css) || 0) + 1);
  });
  blocks.forEach(function (css) {
    while (next < nodes.length && !remaining.get(applied[next])) nodes[next++].remove();
    if (next < nodes.length && applied[next] === css) previous = nodes[next++];
    else {
      var style = doc.createElement('style');
      style.setAttribute('data-risu-shared-style', '');
      style.textContent = css;
      if (previous) previous.after(style);
      else root.prepend(style);
      previous = style;
    }
    remaining.set(css, remaining.get(css) - 1);
  });
  while (next < nodes.length) nodes[next++].remove();
  frame._risuSharedStyleBlocks = blocks;
}
function risuFrameMarkdownEnvironment() {
  // Besides its own text and role, a prepared body depends only on how md()
  // treats reasoning blocks.
  var markers = reasoningDisplayMarkers();
  return [D && D.settings && D.settings.showThinking ? '1' : '0', markers.prefix || '', markers.suffix || ''].join(
    '\u0000'
  );
}
function risuRenderMixedMarkdown(source, role) {
  var blockTags = new Set(
      (
        'ADDRESS ARTICLE ASIDE BASE BASEFONT BLOCKQUOTE BODY CAPTION CENTER COL COLGROUP DD DETAILS DIALOG DIR DIV DL DT ' +
        'FIELDSET FIGCAPTION FIGURE FOOTER FORM FRAME FRAMESET H1 H2 H3 H4 H5 H6 HEAD HEADER HGROUP HR HTML IFRAME ' +
        'LEGEND LI LINK MAIN MENU MENUITEM META NAV NOFRAMES OL OPTGROUP OPTION P PARAM PRE SCRIPT SEARCH SECTION STYLE SUMMARY ' +
        'TABLE TBODY TD TEXTAREA TFOOT TH THEAD TITLE TR TRACK UL BUTTON DATALIST INPUT LABEL SELECT OUTPUT METER PROGRESS'
      ).split(' ')
    ),
    semanticContainerSelector = '.tone-quote,.tone-paren,.tone-bracket,.tone-invalid-directive',
    template = document.createElement('template');
  template.innerHTML = String(source || '');
  function semanticContainerSource(node) {
    var slots = [],
      prefix = '\uE500RISUSEMANTIC';
    while (node.textContent.indexOf(prefix) >= 0) prefix += 'X';
    var text = Array.from(node.childNodes)
      .map(function (child) {
        if (child.nodeType === 3) return child.data;
        if (child.nodeType === 1 && child.tagName === 'BR') return '\n';
        // md() has already made links and other inline subtrees. Keep those nodes opaque
        // while parsing the surrounding Markdown; textContent would discard their structure.
        var token = prefix + slots.length + '\uE501';
        slots.push({ token: token, node: child });
        return token;
      })
      .join('');
    return { text: text, slots: slots, prefix: prefix };
  }
  function semanticContainerBoundary(node, source) {
    var pairs = node.classList.contains('tone-quote')
      ? [
          ['“', '”'],
          ['「', '」'],
          ['『', '』'],
          ['"', '"'],
        ]
      : node.classList.contains('tone-paren')
        ? [
            ['（', '）'],
            ['(', ')'],
            ['[', ']'],
          ]
        : [['【', '】']];
    return pairs.find(function (pair) {
      return source.startsWith(pair[0]) && source.endsWith(pair[1]) && source.length >= pair[0].length + pair[1].length;
    });
  }
  function renderNestedSemanticContainers(root, depth) {
    if (depth > 16) return;
    Array.from(root.querySelectorAll(semanticContainerSelector)).forEach(function (container) {
      if (container.closest('a,code,pre')) return;
      var source = semanticContainerSource(container),
        boundary = semanticContainerBoundary(container, source.text);
      if (!boundary) return;
      var inner = source.text.slice(boundary[0].length, source.text.length - boundary[1].length),
        semantic = pureApi(),
        segments = semantic && semantic.semanticSegments ? semantic.semanticSegments(inner, true) : [],
        hasNestedMarkup = segments.some(function (segment) {
          return segment.open === false && segment.type && segment.type !== 'plain';
        });
      if (!hasNestedMarkup && !/~~[^~]+~~/.test(inner)) return;
      var nested = document.createElement('template');
      nested.innerHTML = md(inner, {
        role: role || 'assistant',
        preserveImages: false,
        safeMarkup: false,
        inline: true,
      });
      // Restore the original nodes in text slots, avoiding a second HTML/Markdown parse.
      var walker = document.createTreeWalker(nested.content, NodeFilter.SHOW_TEXT),
        slotNodes = [],
        textNode;
      while ((textNode = walker.nextNode())) slotNodes.push(textNode);
      slotNodes.forEach(function (node) {
        var tokens = new RegExp(source.prefix + '(\\d+)\uE501', 'g'),
          match,
          cursor = 0,
          fragment = document.createDocumentFragment();
        while ((match = tokens.exec(node.data))) {
          var slot = source.slots[Number(match[1])];
          if (!slot) continue;
          fragment.append(document.createTextNode(node.data.slice(cursor, match.index)), slot.node);
          cursor = match.index + match[0].length;
        }
        if (!cursor) return;
        fragment.append(document.createTextNode(node.data.slice(cursor)));
        node.replaceWith(fragment);
      });
      container.replaceChildren(
        document.createTextNode(boundary[0]),
        nested.content,
        document.createTextNode(boundary[1])
      );
      renderNestedSemanticContainers(container, depth + 1);
    });
  }
  function replaceSemanticEmphasis(root) {
    [
      ['.tone-narration', 'em'],
      ['.tone-bold', 'strong'],
    ].forEach(function (entry) {
      root.querySelectorAll(entry[0]).forEach(function (node) {
        if (node.closest('a,code,pre')) return;
        var replacement = document.createElement(entry[1]);
        replacement.append.apply(replacement, Array.from(node.childNodes));
        node.replaceWith(replacement);
      });
    });
  }
  function renderChildren(owner) {
    var slots = [],
      markdown = '',
      output = '',
      flush = function () {
        if (!markdown) return;
        var rendered = md(markdown, { role: role || 'assistant', preserveImages: false, safeMarkup: false });
        var semantic = document.createElement('template');
        semantic.innerHTML = rendered;
        renderNestedSemanticContainers(semantic.content, 0);
        replaceSemanticEmphasis(semantic.content);
        rendered = semantic.innerHTML;
        slots.forEach(function (slot) {
          rendered = rendered.split(slot.token).join(slot.html);
        });
        output += rendered;
        markdown = '';
        slots = [];
      };
    Array.from(owner.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        markdown += node.data;
        return;
      }
      if (node.nodeType !== 1) {
        if (node.nodeType === 8) {
          var commentToken = '\uE500RISUCOMMENT' + slots.length + '\uE501';
          slots.push({ token: commentToken, html: '<!--' + node.data + '-->' });
          markdown += commentToken;
        }
        return;
      }
      if (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
        var foreignToken = '\uE500RISUFOREIGN' + slots.length + '\uE501';
        slots.push({ token: foreignToken, html: node.outerHTML });
        markdown += foreignToken;
        return;
      }
      if (blockTags.has(node.tagName)) {
        flush();
        output += node.outerHTML;
        return;
      }
      var inline = node.cloneNode(false),
        inlineToken = '\uE500RISUINLINE' + slots.length + '\uE501';
      // Links and code are already structured inline content, not another Markdown input.
      if (node.tagName === 'A' || node.tagName === 'CODE') inline = node.cloneNode(true);
      else if (
        node.matches(semanticContainerSelector) &&
        semanticContainerBoundary(node, semanticContainerSource(node).text)
      ) {
        // Existing semantic HTML owns its outer delimiters. Rebuild only its inner Markdown,
        // rather than scanning the same quote/annotation again and creating a second container.
        var semanticInline = document.createElement('template');
        semanticInline.content.append(node.cloneNode(true));
        renderNestedSemanticContainers(semanticInline.content, 0);
        replaceSemanticEmphasis(semanticInline.content);
        inline = semanticInline.content.firstElementChild;
      } else inline.innerHTML = renderChildren(node);
      slots.push({ token: inlineToken, html: inline.outerHTML });
      markdown += inlineToken;
    });
    flush();
    return output;
  }
  return renderChildren(template.content);
}
function risuPrepareFrameHtml(source, role) {
  var split = risuSplitFrameStyles(source);
  source = split.body;
  source = source.replace(/\s(risu-(?:trigger|btn|id|ctrl|form))\s*=/gi, ' data-yeyu-$1=');
  // Risu editdisplay can insert one HTML asset into an otherwise Markdown reply.
  // Render text nodes without routing card HTML through the host namespacer;
  // block HTML stays opaque, matching markdown-it's raw block semantics.
  var rendered = risuRenderMixedMarkdown(source, role);
  if (typeof DOMPurify === 'undefined' || typeof DOMPurify.sanitize !== 'function')
    throw new Error('Risu 显示需要 DOMPurify');
  // DOMPurify drops field names such as "name" and "submit" as DOM-clobbering keys. Keep them
  // inert through sanitization, then restore only form controls inside the scriptless frame.
  var template = document.createElement('template');
  if (/<form\b/i.test(rendered)) {
    template.innerHTML = rendered;
    template.content
      .querySelectorAll('form input[name],form select[name],form textarea[name],form button[name]')
      .forEach(function (control) {
        control.setAttribute('data-yeyu-risu-field-name', control.getAttribute('name'));
        control.removeAttribute('name');
      });
    rendered = template.innerHTML;
  }
  // HTTP is an external link destination, never a frame resource permission.
  DOMPurify.addHook('uponSanitizeAttribute', function (node, attribute) {
    if (node.tagName === 'A' && attribute.attrName === 'href' && /^http:\/\//i.test(attribute.attrValue)) {
      try {
        if (new URL(attribute.attrValue).protocol === 'http:') attribute.forceKeepAttr = true;
      } catch (_) {}
    }
  });
  try {
    rendered = DOMPurify.sanitize(rendered, {
      ADD_TAGS: ['style'],
      ADD_ATTR: [
        'style',
        'type',
        'value',
        'checked',
        'selected',
        'name',
        'for',
        'risu-trigger',
        'risu-btn',
        'risu-id',
        'risu-ctrl',
        'risu-form',
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:https|blob):|data:(?:image|audio|video)\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'template', 'base', 'meta', 'link'],
      ADD_FORBID_CONTENTS: ['script', 'iframe', 'object', 'embed', 'template'],
      FORBID_ATTR: ['srcdoc'],
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
  }
  rendered = rendered.replace(/data-yeyu-(risu-(?:trigger|btn|id|ctrl|form))=/gi, '$1=');
  template.innerHTML = rendered;
  template.content.querySelectorAll('form [data-yeyu-risu-field-name]').forEach(function (control) {
    control.setAttribute('name', control.getAttribute('data-yeyu-risu-field-name'));
    control.removeAttribute('data-yeyu-risu-field-name');
  });
  Array.from(template.content.querySelectorAll('img')).forEach(function (image) {
    if (!String(image.getAttribute('src') || '').trim()) image.replaceWith(RichDisplay.missingImage(image.alt));
  });
  return split.styles + template.innerHTML;
}
function risuResizeFrame(frame) {
  if (!frame || !frame.contentDocument || frame.classList.contains('risu-background-frame')) return;
  var doc = frame.contentDocument,
    root = doc.getElementById('risu-root'),
    bounds = root && root.getBoundingClientRect(),
    height = Math.ceil(Math.max(1, bounds ? bounds.top + root.scrollHeight : 0, bounds ? bounds.bottom : 0)),
    oldHeight = frame.clientHeight;
  if (height === oldHeight) return;
  var chat = document.getElementById('chat-messages'),
    interaction = frame._risuInteractionLayout,
    layout = interaction && chatViewportTaskMatches(interaction.task) ? interaction : null,
    owner = chat ? getChatViewportState() : null,
    follow = !owner || owner.mode === 'follow',
    anchor = layout ? layout.anchor : chat && !follow ? captureChatReadingAnchor(true) : null;
  frame.style.height = height + 'px';
  if (!chat) return;
  // Compensate this geometry change once. A later frame may have completed an
  // explicit navigation, so replaying this pre-resize anchor would undo it.
  if (follow) writeOwnedChatScrollTop(chat, Math.max(0, chat.scrollHeight - chat.clientHeight));
  else if (anchor) applyChatReadingAnchor(anchor);
}
function risuCaptureDisplayStates(messages) {
  Array.from(document.querySelectorAll('.risu-display-host[data-risu-message-index]')).forEach(function (host) {
    var frame = host.querySelector('iframe.risu-display-frame'),
      index = Number(host.getAttribute('data-risu-message-index')),
      message = host._risuMessage || (messages && messages[index]),
      doc = frame && frame.contentDocument,
      details = doc ? Array.from(doc.querySelectorAll('details')) : [],
      controls = doc ? Array.from(doc.querySelectorAll('input,select,textarea')) : [];
    if (!message || !doc || !host.hasAttribute('data-risu-ready')) return;
    if (!details.length && !controls.length) return;
    _risuMessageFrameStates.set(host._risuMessageStateKey, {
      key: host._risuLogicalSourceKey,
      details: details.map(function (row) {
        return row.open;
      }),
      controls: controls.map(function (row) {
        return { value: row.value, checked: !!row.checked, selectedIndex: row.selectedIndex };
      }),
    });
  });
}
function risuMessageStateKey(message, index, owner) {
  return [
    String(owner || ''),
    message && (message.seq != null ? message.seq : message._seq != null ? message._seq : index),
    (message && message.role) || '',
    Number(index),
  ].join('|');
}
function risuRestoreFrameState(frame, state) {
  if (!frame || !frame.contentDocument || !state) return;
  Array.from(frame.contentDocument.querySelectorAll('details')).forEach(function (row, index) {
    if (index < state.details.length) row.open = state.details[index] === true;
  });
  Array.from(frame.contentDocument.querySelectorAll('input,select,textarea')).forEach(function (row, index) {
    var saved = state.controls[index];
    if (!saved) return;
    if ('checked' in row) row.checked = saved.checked;
    if (row.tagName === 'SELECT') row.selectedIndex = saved.selectedIndex;
    else row.value = saved.value;
  });
}
function risuBindFrameImages(frame, images) {
  var doc = frame.contentDocument;
  if (!doc) return;
  (images || Array.from(doc.querySelectorAll('img'))).forEach(function (image) {
    function failed() {
      var source = String(image.getAttribute('src') || '').trim(),
        label = image.alt || (source && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source) ? source : '');
      image.replaceWith(RichDisplay.missingImage(label));
      risuResizeFrame(frame);
    }
    image.addEventListener('error', failed, { once: true });
    if (image.complete && !image.naturalWidth) failed();
  });
}
function risuInlayDeleteTarget(frame, image) {
  var host = frame.closest('.risu-display-host'),
    char = getChar(),
    session = char && getActiveSession(char.id),
    message = host && host._risuMessage,
    id = image.getAttribute('data-generated-image'),
    template = message && risuMessageTemplate(message),
    display = host && host._risuInlayHistory;
  if (!message || !session || !session.msgs.includes(message) || !session.risu || !session.risu.inlays[id]) return null;
  return {
    char: char, session: session, message: message,
    content: message.content, template: template, originalContent: message.original_content,
    host: host, display: display, history: display && display.input,
    displayState: risuDisplayScriptState(char, session, false),
    swipe: messageSwipeState(message).active, id: id,
    occurrence: Number(image.getAttribute('data-risu-inlay-occurrence')) || 0,
    displaySource: String(host._risuInlaySource || ''),
  };
}
function risuInlayDeleteTargetCurrent(target) {
  return getChar() === target.char && getActiveSession(target.char.id) === target.session &&
    target.session.msgs.includes(target.message) && target.message.content === target.content &&
    risuMessageTemplate(target.message) === target.template && target.message.original_content === target.originalContent &&
    messageSwipeState(target.message).active === target.swipe &&
    target.host.isConnected && target.host._risuInlayHistory === target.display &&
    (!target.display || target.display.input === target.history) &&
    target.host._risuInlaySource === target.displaySource &&
    risuDisplayScriptState(target.char, target.session, false) === target.displayState;
}
function risuInlayTokenSpans(text, id) {
  var spans = [], pattern = /\{\{(?:inlay|inlayed|inlayeddata)::(.+?)\}\}/gims, match;
  while ((match = pattern.exec(text)))
    if (String(match[1]).trim() === id) spans.push({ start: match.index, end: pattern.lastIndex });
  return spans;
}
function risuInlaySourceSpan(before, displayed, chosen, id) {
  if (!chosen) return null;
  var offset = before.indexOf(displayed);
  if (offset >= 0 && offset === before.lastIndexOf(displayed))
    return { start: offset + chosen.start, end: offset + chosen.end };
  // 普通显示正则可以给周围文字加 HTML。沿现成文本差异映射未改动的 token，
  // 凭空新增/删除同 ID 引用则无法证明来源，不能猜测要删哪个原始位置。
  if (risuInlayTokenSpans(before, id).length !== risuInlayTokenSpans(displayed, id).length) return null;
  var left = 0, right = 0;
  for (var part of YeyuTextDiff.diffChars(before, displayed)) {
    if (!part.added && !part.removed && chosen.start >= right && chosen.end <= right + part.value.length)
      return { start: left + chosen.start - right, end: left + chosen.end - right };
    if (!part.added) left += part.value.length;
    if (!part.removed) right += part.value.length;
  }
  return null;
}
function risuInlaySourceNodes(source, targets) {
  var matches = new Map();
  function pair(left, rights) {
    left = left.filter(function (node) { return node.type !== 'text'; });
    rights = rights.map(function (nodes) { return nodes.filter(function (node) { return node.type !== 'text'; }); });
    if (rights.some(function (nodes) { return nodes.length !== left.length; })) return false;
    for (var index = 0; index < left.length; index++) {
      var node = left[index], peers = rights.map(function (nodes) { return nodes[index]; });
      if (peers.some(function (peer) {
        return peer.type !== node.type || (node.type === 'block' ? peer.tag !== node.tag : peer.raw !== node.raw);
      })) return false;
      matches.set(node.start + ':' + node.end, { node: node, peers: peers });
      if (node.type === 'block' &&
          (!pair(node.body, peers.map(function (peer) { return peer.body; })) ||
           !pair(node.alternate, peers.map(function (peer) { return peer.alternate; })))) return false;
    }
    return true;
  }
  return pair(YeyuRisuCBS.parse(source), targets.map(function (text) { return YeyuRisuCBS.parse(text); })) ? matches : null;
}
function risuInlaySourceEdit(history, span, sources, id) {
  if (!history || !span) return null;
  var matches = risuInlaySourceNodes(history.source, sources), leaves = [];
  if (!matches) return null;
  function collect(rows) {
    rows.forEach(function (row) { if (row.children.length) collect(row.children); else leaves.push(row); });
  }
  function locate(rows, actual, chosen) {
    var joined = rows.map(function (row) { return row.text; }).join(''),
      mapped = risuInlaySourceSpan(joined, actual, chosen, id), at = 0;
    if (!mapped) return null;
    for (var row of rows) {
      if (mapped.start >= at && mapped.end <= at + row.text.length) {
        var relative = { start: mapped.start - at, end: mapped.end - at };
        return row.children.length ? locate(row.children, row.text, relative) : { row: row, span: relative };
      }
      at += row.text.length;
    }
    return null;
  }
  collect(history.trace);
  var leaf = locate(history.trace, history.text, span);
  if (!leaf) return null;
  var row = leaf.row, match = matches.get(row.start + ':' + row.end);
  if (!row.macro || !match || match.node.raw !== row.source ||
      leaves.filter(function (entry) { return entry.start === row.start && entry.end === row.end; }).length !== 1)
    return null;
  // CBS trace identifies the actual visible leaf. Translation preserves its macro address, even
  // when prose lengths differ; a variable expansion is frozen only at this message's leaf.
  var replacement = row.text.slice(0, leaf.span.start) + row.text.slice(leaf.span.end);
  return sources.map(function (source, index) {
    var node = match.peers[index];
    return source.slice(0, node.start) + replacement + source.slice(node.end);
  });
}
// 用户删图作为当前候选的一次正文编辑：沿已有来源投影保留其他动态宏与条件分支，
// 译文和待恢复原文同步编辑，不改共享变量、其他候选或会话级图片条目；inlay 沿既有会话生命周期回收。
async function deleteRisuInlayImage(target) {
  if (!risuInlayDeleteTargetCurrent(target)) return false;
  if (blockDuringGenerationOrPostCommit('删除图片', target.session)) return false;
  var char = target.char, session = target.session, message = target.message, sources = [target.template];
  if (typeof target.originalContent === 'string') sources.push(target.originalContent);
  try {
    var visible = risuInlayTokenSpans(target.displaySource, target.id),
      chosen = visible[target.occurrence],
      span = target.history && risuInlaySourceSpan(target.history.text, target.displaySource, chosen, target.id),
      edited = risuInlaySourceEdit(target.history, span, sources, target.id);
    if (!edited) {
      toast('这张图片由卡片显示脚本重新构建，无法定位可删除的原始引用', 'info');
      return false;
    }
    if (!risuInlayDeleteTargetCurrent(target)) return false;
    if (blockDuringGenerationOrPostCommit('删除图片', session)) return false;
    var mutation = beginMessageMutation(char, session, message, ['risu']), index = session.msgs.indexOf(message);
    try {
      message.content = edited[0];
      if (sources.length > 1) message.original_content = edited[1];
      if (Array.isArray(message.swipes) && message.swipes.length) messageSwipeNormalize(message);
      if (message.risu) {
        delete message.risu.source;
        delete message.risu.text;
        delete message.risu.template;
      }
      message.edited = true;
      syncMvuMessageActiveSwipe(message);
      if (Number(message.seq)) rollbackMemoryDependencies(char.id, session, Number(message.seq));
      invalidateCacheContexts(char.id, index, true, session.id);
      await refreshMessageMutation(char, session, mutation);
      await saveData('sessions', { urgent: true });
    } catch (error) {
      mutation.rollback();
      clearMvuSessionRuntime(char.id, session.id);
      throw error;
    }
    await markStreamDraftsStaleForSession(char.id, session.id, 'base_changed');
    renderChat();
    updateTokensBar(char);
    return true;
  } catch (error) {
    toast('图片删除失败：' + ((error && error.message) || error), 'err');
    return false;
  }
}
// Clicks inside the frame never reach the host bubble's onclick, so a tap on plain card content
// toggles the message toolbar exactly as a tap on the bubble itself would; the controls the bubble
// ignores, plus the card's own triggers, keep their meaning.
var RISU_FRAME_INTERACTIVE_SELECTOR = MESSAGE_TAP_CONTROL_SELECTOR + ',[risu-trigger],[risu-btn]';
function risuForwardBubbleTap(frame, event) {
  if (event.target && event.target.closest && event.target.closest(RISU_FRAME_INTERACTIVE_SELECTOR)) return;
  var row = frame.closest('.msg[data-msg-idx]');
  if (!row) return;
  toggleMessageActions(Number(row.dataset.msgIdx));
}
function risuBindFrame(frame) {
  var doc = frame.contentDocument,
    char = getChar(),
    session = char && getActiveSession(char.id);
  if (!doc) return;
  risuBindFrameImages(frame);
  bindGeneratedImageHold(
    doc,
    function (image) {
      return risuInlayDeleteTarget(frame, image);
    },
    deleteRisuInlayImage
  );
  // Input events do not bubble out of an iframe. Retire pending viewport work
  // before the browser focuses a control or applies a card's hover/expanded layout.
  VIEWPORT_INTENT_EVENTS.forEach(function (name) {
    doc.addEventListener(
      name,
      function (event) {
        noteChatViewportUserIntent(event);
        frame._risuInteractionLayout = null;
        if (isChatViewportScrollIntent(event)) return;
        var layout = captureChatViewportLayout(),
          quietFrames = 2;
        frame._risuInteractionLayout = layout;
        // A card can collapse one image while expanding another: total frame height
        // is unchanged, but its internal reading content moves. Follow this finite
        // layout transition only; the next user gesture invalidates its task.
        requestAnimationFrame(function settleInteraction() {
          if (!frame.isConnected || frame._risuInteractionLayout !== layout || !chatViewportTaskMatches(layout.task))
            return;
          risuResizeFrame(frame);
          restoreChatViewportLayout(layout);
          var transitioning =
            doc.getAnimations &&
            doc.getAnimations().some(function (animation) {
              return animation.playState === 'running' && Number.isFinite(animation.effect.getComputedTiming().endTime);
            });
          if (transitioning) quietFrames = 2;
          if (transitioning || quietFrames-- > 0) requestAnimationFrame(settleInteraction);
          else frame._risuInteractionLayout = null;
        });
      },
      { capture: true, passive: true }
    );
  });
  var resize = function () {
      risuResizeFrame(frame);
    },
    scheduleResize = function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(resize);
      });
      setTimeout(resize, 80);
    };
  if (typeof ResizeObserver === 'function') {
    frame._risuResizeObserver = new ResizeObserver(scheduleResize);
    frame._risuResizeObserver.observe(doc.documentElement);
    if (doc.body) frame._risuResizeObserver.observe(doc.body);
  }
  doc.addEventListener('toggle', scheduleResize, true);
  doc.addEventListener('load', scheduleResize, true);
  doc.addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target,
      key = form && doc.defaultView.Element.prototype.getAttribute.call(form, 'risu-form');
    if (!key || !frame.isConnected || getChar() !== char || getActiveSession(char.id) !== session) return;
    var data = Object.create(null);
    for (var pair of new doc.defaultView.FormData(form, event.submitter)) {
      var name = pair[0],
        value = pair[1];
      if (Object.prototype.hasOwnProperty.call(data, name)) {
        if (Array.isArray(data[name])) data[name].push(value);
        else data[name] = [data[name], value];
      } else data[name] = value;
    }
    Promise.resolve(runRisuFormTrigger(key, data)).catch(risuScriptError);
  });
  doc.addEventListener('click', function (event) {
    var origin = event.target && event.target.closest && event.target.closest('[risu-trigger],[risu-btn],a');
    if (!origin) {
      risuForwardBubbleTap(frame, event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    var triggerName = origin.getAttribute('risu-trigger'),
      buttonEvent = origin.getAttribute('risu-btn'),
      triggerId = origin.getAttribute('risu-id');
    if (triggerName)
      Promise.resolve(runRisuManualTrigger(triggerName, triggerId || undefined)).catch(function (error) {
        risuScriptError(error);
      });
    else if (buttonEvent)
      Promise.resolve(runRisuButtonTrigger(buttonEvent)).catch(function (error) {
        risuScriptError(error);
      });
    else if (origin.tagName === 'A') {
      var href = origin.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      // Forward to the parent page's normal external-link path. The isolated frame keeps
      // its navigation sandbox, and Android's existing main-frame handler opens the browser.
      var link = document.createElement('a');
      link.href = href;
      link.target = '_self';
      link.rel = 'noopener noreferrer';
      link.click();
    }
  });
  resize();
}
function risuMountFrame(host, body, role, logicalKey, markdownEnvironment) {
  body = String(body == null ? '' : body);
  // Compare the unprepared inputs first; sanitising only runs for a remount.
  var key = [role, markdownEnvironment, body].join('\u0000'),
    existingFrame = host.querySelector('iframe.risu-display-frame'),
    existingDocument = existingFrame && existingFrame.contentDocument,
    existingReady =
      existingFrame &&
      host.hasAttribute('data-risu-ready') &&
      existingDocument &&
      existingDocument.URL !== 'about:blank' &&
      existingDocument.getElementById('risu-root');
  logicalKey = String(logicalKey == null ? key : logicalKey);
  if (host._risuLogicalSourceKey === logicalKey && host._risuSourceKey === key && existingReady) {
    risuSyncSharedFrameStyles(existingFrame);
    return;
  }
  var prepared = risuPrepareFrameHtml(body, role),
    appearance = risuFrameAppearance(host.closest('.msg-bubble') || host, role);
  host.removeAttribute('data-risu-ready');
  host._risuSourceKey = key;
  host._risuLogicalSourceKey = logicalKey;
  host.querySelectorAll('iframe.risu-display-frame').forEach(function (oldFrame) {
    if (oldFrame._risuResizeObserver) oldFrame._risuResizeObserver.disconnect();
    oldFrame.remove();
  });
  var frame = document.createElement('iframe');
  frame.className = 'risu-display-frame';
  frame.setAttribute('sandbox', 'allow-same-origin allow-forms');
  frame.setAttribute('allowtransparency', 'true');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', 'Risu 卡片演出');
  frame.addEventListener('load', function () {
    if (!frame.isConnected || host.querySelector('iframe.risu-display-frame') !== frame) return;
    try {
      if (frame.contentDocument && frame.contentDocument.URL === 'about:blank') return;
      if (!frame.contentDocument || !frame.contentDocument.getElementById('risu-root'))
        throw new Error('Risu 消息帧未装载');
      var state = _risuMessageFrameStates.get(host._risuMessageStateKey);
      if (state && state.key === logicalKey) risuRestoreFrameState(frame, state);
      // The frame stays 1px tall behind the readable fallback until ready, so text never shows unshared.
      risuShareFrameFonts(frame);
      risuBindFrame(frame);
      host.setAttribute('data-risu-ready', '');
    } catch (error) {
      risuShowDisplayFallback(host, error);
    }
  });
  frame.addEventListener('error', function () {
    risuShowDisplayFallback(host, new Error('Risu 消息帧加载失败'));
  });
  _risuDisplayFrames.add(frame);
  host.appendChild(frame);
  // The first document already carries the current shared CSS, so a new frame
  // paints styled; later changes replace those nodes in place.
  frame._risuSharedStyleBlocks = _risuSharedFrameStyles.blocks;
  // WebView may complete a disconnected iframe's srcdoc navigation and then
  // reset it to about:blank when the node is attached. Connect the frame first
  // so the following navigation is the one whose load event marks it ready.
  frame.srcdoc = risuFrameDocument(_risuSharedFrameStyles.markup + prepared, false, appearance);
}
function risuShowDisplayFallback(host, error) {
  host.removeAttribute('data-risu-ready');
  host.querySelectorAll('iframe.risu-display-frame').forEach(function (frame) {
    if (frame._risuResizeObserver) frame._risuResizeObserver.disconnect();
    _risuDisplayFrames.delete(frame);
    frame.remove();
  });
  risuScriptError(error);
}
function risuSyncBackgroundGeometry() {
  var chat = document.getElementById('chat-messages'),
    main = document.getElementById('main');
  if (!chat || !main) return;
  if (!_risuDisplayResizeObserver && typeof ResizeObserver === 'function') {
    _risuDisplayResizeObserver = new ResizeObserver(risuSyncBackgroundGeometry);
    _risuDisplayResizeObserver.observe(chat);
    _risuDisplayResizeObserver.observe(main);
  }
  var box = chat.getBoundingClientRect(),
    owner = main.getBoundingClientRect();
  if (_risuBackgroundFrame && _risuBackgroundFrame.isConnected)
    Object.assign(_risuBackgroundFrame.style, {
      left: box.left - owner.left + 'px',
      top: box.top - owner.top + 'px',
      width: box.width + 'px',
      height: box.height + 'px',
    });
  var emotion = document.getElementById('risu-emotion-stage');
  if (emotion)
    Object.assign(emotion.style, {
      left: box.left - owner.left + 'px',
      top: box.top - owner.top + 'px',
      width: box.width + 'px',
      height: box.height + 'px',
      right: 'auto',
      bottom: 'auto',
    });
}
async function risuApplyBackground(char, session, current, imageAssets) {
  var owner = char && session && isRisuCharacter(char) ? String(char.id) + '|' + String(session.id) : '';
  if (!owner) {
    if (_risuBackgroundFrame) _risuBackgroundFrame.remove();
    _risuBackgroundFrame = null;
    _risuBackgroundSourceKey = '';
    return '';
  }
  var source = String((risuCardSources(char).card || {}).backgroundHTML || '');
  if (!source) {
    if (_risuBackgroundFrame) _risuBackgroundFrame.remove();
    _risuBackgroundFrame = null;
    _risuBackgroundSourceKey = '';
    return '';
  }
  var displayContext = await risuDisplayAssetContext(char),
    macroState = createRisuMacroState(char, session, { commit: false });
  macroState.assetContext = risuDeferredCBSAssetContext(displayContext);
  var rendered = await risuRenderCBSInWorker(source, char, session, {
      state: macroState,
      runVar: false,
    }),
    resolved = await risuDisplaySource(rendered, char, { background: true, isCurrent: current, imageAssets: imageAssets });
  // A sync superseded while this resolved must not land its older rendering, even for the same owner.
  if (current && !current()) return '';
  if (
    owner !==
    String(getChar() && getChar().id) + '|' + String(getActiveSession(char.id) && getActiveSession(char.id).id)
  )
    return '';
  var backgroundParts = risuSplitFrameStyles(resolved.text),
    sharedStyles = backgroundParts.styles,
    visibleBackground = backgroundParts.body
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!doctype[^>]*>/gi, '')
      .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
      .trim();
  // Many cards use backgroundHTML only as the shared stylesheet for message
  // output. Fixed Risu keeps that CSS in the chat document; mounting an empty
  // iframe adds an opaque WebView canvas over the whole conversation.
  if (!visibleBackground) {
    if (_risuBackgroundFrame) _risuBackgroundFrame.remove();
    _risuBackgroundFrame = null;
    _risuBackgroundSourceKey = source;
    return sharedStyles;
  }
  if (!_risuBackgroundFrame) {
    _risuBackgroundFrame = document.createElement('iframe');
    _risuBackgroundFrame.className = 'risu-background-frame';
    _risuBackgroundFrame.setAttribute('sandbox', 'allow-same-origin');
    _risuBackgroundFrame.setAttribute('allowtransparency', 'true');
    _risuBackgroundFrame.setAttribute('referrerpolicy', 'no-referrer');
    _risuBackgroundFrame.setAttribute('aria-hidden', 'true');
    _risuBackgroundFrame._risuReady = false;
    _risuBackgroundFrame.addEventListener('load', function () {
      if (!this.contentDocument || this.contentDocument.URL === 'about:blank') return;
      this._risuReady = true;
      risuBindFrameImages(this);
    });
    document.getElementById('main').insertBefore(_risuBackgroundFrame, document.getElementById('chat-messages'));
  }
  var frameSource = risuPrepareFrameHtml(resolved.text, 'assistant'),
    assetSignature = resolved.context.assets
      .concat(resolved.context.emotionEntries)
      .map(function (entry) {
        return [entry.name, entry.reference, entry.mediaKey].join(':');
      })
      .join('|'),
    sourceKey = owner + '|' + source + '|' + assetSignature + '|' + frameSource;
  if (_risuBackgroundSourceKey !== sourceKey) {
    _risuBackgroundSourceKey = sourceKey;
    _risuBackgroundFrame._risuReady = false;
    _risuBackgroundFrame.srcdoc = risuFrameDocument(
      frameSource,
      true,
      risuFrameAppearance(document.getElementById('chat-messages'))
    );
  }
  risuSyncBackgroundGeometry();
  return sharedStyles;
}
// A display sync resolves every visible message's assets, which can take longer than a streaming reply
// takes to paint again. The running sync finishes, so the shared stylesheet set it builds lands; calls made
// meanwhile collapse into one sync with the latest arguments that runs afterwards. A sync for another
// display owner does not wait: the running one stops at its next check, whatever it had queued is dropped,
// and the new owner's sync starts at once.
function syncRisuDisplays(char, session, messages, start) {
  var owner = risuDisplaySyncOwner(char, session),
    running = _risuDisplaySync;
  if (running && running.owner !== owner) {
    _risuDisplaySyncEpoch++;
    risuDropQueuedDisplaySync(running);
    running = null;
  }
  if (!running) return risuStartDisplaySync(owner, [char, session, messages, start]);
  var next = running.next;
  if (!next) {
    next = running.next = {};
    next.promise = new Promise(function (resolve, reject) {
      next.resolve = resolve;
      next.reject = reject;
    });
  }
  next.args = [char, session, messages, start];
  return next.promise;
}
function risuDisplaySyncOwner(char, session) {
  return char && session ? String(char.id || '') + '|' + String(session.id || '') : '';
}
function risuStartDisplaySync(owner, args) {
  var sync = { owner: owner, next: null };
  _risuDisplaySync = sync;
  sync.promise = risuRunDisplaySync.apply(null, args).finally(function () {
    var next = sync.next;
    if (_risuDisplaySync === sync) _risuDisplaySync = null;
    if (next) risuStartDisplaySync(owner, next.args).then(next.resolve, next.reject);
  });
  return sync.promise;
}
// Consumers of rendered text wait for the existing display work, without scheduling a second render.
async function risuAwaitDisplaySync(char, session) {
  var owner = risuDisplaySyncOwner(char, session);
  while (_risuDisplaySync && _risuDisplaySync.owner === owner) await _risuDisplaySync.promise;
}
// The queued follow-up of a sync that was superseded settles without running.
function risuDropQueuedDisplaySync(sync) {
  var next = sync.next;
  if (!next) return;
  sync.next = null;
  next.resolve();
}
function risuRunDisplaySync(char, session, messages) {
  var imageAssets = new Set();
  return risuRunDisplaySyncWithImages(char, session, messages, imageAssets).finally(function () {
    releaseStoredImageDisplayReads(imageAssets);
  });
}
async function risuRunDisplaySyncWithImages(char, session, messages, imageAssets) {
  var epoch = _risuDisplaySyncEpoch,
    displayOwner = risuDisplaySyncOwner(char, session),
    current = function () {
      return epoch === _risuDisplaySyncEpoch;
    };
  risuSyncCharacterDisplayOptions(char);
  if (!char || !session || !isRisuCharacter(char)) {
    await risuSyncEmotionStage(null, null);
    await risuApplyBackground(null, null);
    return;
  }
  var displayContext = await risuDisplayAssetContext(char),
    displayOptions = risuCardDisplayOptions(char);
  if (!current()) return;
  var currentEmotion = risuCurrentEmotion(session),
    refreshedEmotion = currentEmotion && risuLookupDisplayAsset(displayContext, currentEmotion.name, true);
  if (refreshedEmotion) {
    await risuEnsureDisplayAsset(refreshedEmotion, displayContext);
    if (!current()) return;
    if (refreshedEmotion.url) _risuEmotionStates.set(session, refreshedEmotion);
  }
  if (
    displayOptions.viewScreen === 'emotion' &&
    !displayOptions.inlayViewScreen &&
    !risuCurrentEmotion(session) &&
    displayContext.emotionEntries.length
  ) {
    var initialEmotion = displayContext.emotionEntries.find(function (entry) {
      return entry.name === 'neutral';
    });
    if (initialEmotion) {
      await risuEnsureDisplayAsset(initialEmotion, displayContext);
      if (!current()) return;
      if (initialEmotion.url) _risuEmotionStates.set(session, initialEmotion);
    }
  }
  var sharedStyles = await risuApplyBackground(char, session, current, imageAssets);
  if (!current()) return;
  await risuSyncEmotionStage(char, session, current, imageAssets);
  if (!current()) return;
  var hosts = Array.from(document.querySelectorAll('.risu-display-host[data-risu-message-index]'));
  Array.from(_risuDisplayFrames).forEach(function (frame) {
    if (frame.isConnected) return;
    if (frame._risuResizeObserver) frame._risuResizeObserver.disconnect();
    _risuDisplayFrames.delete(frame);
  });
  var displays = await Promise.all(
    hosts.map(async function (host) {
      try {
        var index = Number(host.getAttribute('data-risu-message-index')),
          message = messages[index];
        if (!message) return null;
        var role = host.getAttribute('data-risu-role') || message.role,
          sourceNode = host.querySelector('.risu-display-source'),
          text = sourceNode ? sourceNode.textContent : '',
          history = _risuDisplaySources.get(message),
          resolved = await risuDisplaySource(text, char, {
            imgGenPending: risuInlayScreenPending(session, message),
            isCurrent: function () { return current() && host.isConnected; },
            imageAssets: imageAssets,
          }),
          split = risuSplitFrameStyles(resolved.text);
        if (!current() || !host.isConnected) return null;
        return {
          host: host,
          index: index,
          message: message,
          role: role,
          text: text,
          history: history && history.content === message.content && history.template === risuMessageTemplate(message) &&
            history.text.includes(text) ? history : null,
          resolved: resolved,
          split: split,
        };
      } catch (error) {
        if (current() && host.isConnected) risuShowDisplayFallback(host, error);
        return null;
      }
    })
  );
  if (!current()) return;
  displays = displays.filter(function (display) {
    return display && display.host.isConnected;
  });
  // Upstream scopes card selectors to its shared chat document. Reproduce that
  // within the current Risu owner by placing every visible message stylesheet,
  // in DOM order, before each message body. Nothing is persisted or escapes the
  // scriptless frame boundary.
  risuSetSharedFrameStyles(
    sharedStyles +
      displays
        .map(function (display) {
          return display.split.styles;
        })
        .join('')
  );
  var markdownEnvironment = risuFrameMarkdownEnvironment();
  // Incremental appends keep the old hosts alive. Capture their latest controls
  // before a changed body remounts them, just as a full chat render does.
  risuCaptureDisplayStates(messages);
  displays.forEach(function (display) {
    var host = display.host,
      liveFrame = host.hasAttribute('data-risu-ready') && host.querySelector('iframe.risu-display-frame'),
      liveSource = host.querySelector('.risu-display-source');
    // A ready frame whose source was rewritten while this sync resolved it is newer than this sync: a
    // chat render starts its own sync, and a streaming reply has already patched the frame in place.
    if (liveFrame && liveSource && liveSource.textContent !== display.text) {
      risuSyncSharedFrameStyles(liveFrame);
      return;
    }
    try {
      host._risuMessage = display.message;
      host._risuInlaySource = display.text;
      host._risuInlayHistory = display.history;
      host._risuOwner = displayOwner;
      host._risuMessageStateKey =
        risuMessageStateKey(display.message, display.index, displayOwner) + '|' + host.dataset.risuDisplayPart;
      risuMountFrame(
        host,
        display.split.body,
        display.role,
        displayOwner + '|' + display.role + '|' + risuDisplayLogicalSource(display.text, display.resolved.context),
        markdownEnvironment
      );
    } catch (error) {
      if (current() && host.isConnected) risuShowDisplayFallback(host, error);
    }
  });
  risuSyncBackgroundGeometry();
  if (!imageAssets.size && current() && getChar() === char)
    syncCardAssetObjectUrlLifecycle(char);
}
function clearRisuDisplays() {
  _risuDisplaySyncEpoch++;
  if (_risuDisplaySync) risuDropQueuedDisplaySync(_risuDisplaySync);
  _risuDisplayFrames.forEach(function (frame) {
    if (frame._risuResizeObserver) frame._risuResizeObserver.disconnect();
  });
  _risuDisplayFrames.clear();
  if (_risuDisplayResizeObserver) _risuDisplayResizeObserver.disconnect();
  _risuDisplayResizeObserver = null;
  _risuMessageFrameStates.clear();
  if (_risuBackgroundFrame) _risuBackgroundFrame.remove();
  var emotion = document.getElementById('risu-emotion-stage');
  if (emotion) emotion.remove();
  _risuBackgroundFrame = null;
  _risuBackgroundSourceKey = '';
  risuSetSharedFrameStyles('');
  risuSyncCharacterDisplayOptions(null);
}
// A streaming reply rewrites its display many times a second. Remounting its frame for each paint would
// flash the readable fallback and collapse the frame every time, so once the frame is ready its body is
// patched in place. The first mount goes through syncRisuDisplays once; so does a stylesheet the shared
// set does not hold yet, and that sync edits every frame's style nodes in place while finding this
// frame current. `messages` holds the reply at the index its placeholders name. Returns whether a full
// display sync ran.
function syncRisuStreamDisplays(char, session, root, messages) {
  var imageAssets = new Set();
  return risuSyncStreamDisplaysWithImages(char, session, root, messages, imageAssets).finally(function () {
    releaseStoredImageDisplayReads(imageAssets);
  });
}
async function risuSyncStreamDisplaysWithImages(char, session, root, messages, imageAssets) {
  var hosts = Array.from(root.querySelectorAll('.risu-display-host[data-risu-message-index]')),
    sync = false;
  if (!char || !session || !hosts.length) return false;
  var results = await Promise.allSettled(
    hosts.map(async function (host) {
      var ticket = (host._risuStreamTicket = (host._risuStreamTicket || 0) + 1),
        sourceNode = host.querySelector('.risu-display-source'),
        text = sourceNode ? sourceNode.textContent : '',
        resolved = await risuDisplaySource(text, char, {
          isCurrent: function () {
            return ticket === host._risuStreamTicket && host.isConnected && getChar() === char && getActiveSession(char.id) === session;
          },
          imageAssets: imageAssets,
        }),
        split = risuSplitFrameStyles(resolved.text);
      if (ticket !== host._risuStreamTicket || !host.isConnected) return;
      if (risuPatchStreamFrame(char, session, host, text, resolved, split)) {
        if (!risuSharedFrameStylesHold(split.blocks)) sync = true;
        return;
      }
      // A frame still loading, or one that failed and reported, is left to later paints and the commit
      // instead of restarting its load.
      if (host._risuStreamMountRequested) return;
      host._risuStreamMountRequested = true;
      sync = true;
    })
  );
  // A failed host must not release the shared image reads while another host still resolves its images.
  var failed = results.find(function (result) { return result.status === 'rejected'; });
  if (failed) throw failed.reason;
  if (sync) await syncRisuDisplays(char, session, messages, 0);
  return sync;
}
// Whether the shared stylesheet set already holds every one of these blocks.
function risuSharedFrameStylesHold(blocks) {
  var counts = new Map();
  _risuSharedFrameStyles.blocks.forEach(function (css) {
    counts.set(css, (counts.get(css) || 0) + 1);
  });
  return blocks.every(function (css) {
    var count = counts.get(css) || 0;
    counts.set(css, count - 1);
    return count > 0;
  });
}
// Patches a ready frame in place: its shared style nodes are brought up to date and its body is
// reconciled, so unchanged nodes, loaded images among them, stay as they are. The host takes the keys
// risuMountFrame computes for the same content, so a later display sync finds the frame current.
function risuPatchStreamFrame(char, session, host, text, resolved, split) {
  var frame = host.querySelector('iframe.risu-display-frame'),
    doc = frame && frame.contentDocument,
    root = doc && doc.getElementById('risu-root'),
    role = host.getAttribute('data-risu-role') || 'assistant';
  if (!root || !host.hasAttribute('data-risu-ready') || doc.URL === 'about:blank') return false;
  var key = [role, risuFrameMarkdownEnvironment(), split.body].join('\u0000'),
    logicalKey =
      String(char.id || '') +
      '|' +
      String(session.id || '') +
      '|' +
      role +
      '|' +
      risuDisplayLogicalSource(text, resolved.context);
  risuSyncSharedFrameStyles(frame);
  host._risuInlaySource = text;
  if (host._risuSourceKey === key && host._risuLogicalSourceKey === logicalKey) return true;
  var template = doc.createElement('template'),
    loaded = new Set(Array.from(root.querySelectorAll('img')));
  template.innerHTML = risuPrepareFrameHtml(split.body, role);
  reconcileStreamChildren(
    root,
    Array.from(root.querySelectorAll(':scope > style[data-risu-shared-style]')).concat(
      Array.from(template.content.childNodes)
    )
  );
  risuBindFrameImages(
    frame,
    Array.from(root.querySelectorAll('img')).filter(function (image) {
      return !loaded.has(image);
    })
  );
  host._risuSourceKey = key;
  host._risuLogicalSourceKey = logicalKey;
  risuResizeFrame(frame);
  return true;
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', risuSyncBackgroundGeometry);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', risuSyncBackgroundGeometry);
    window.visualViewport.addEventListener('scroll', risuSyncBackgroundGeometry);
  }
  window.addEventListener('pagehide', clearRisuDisplays);
}
