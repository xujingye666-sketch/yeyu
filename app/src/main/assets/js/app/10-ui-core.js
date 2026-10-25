// ===== Helpers =====
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function objectRecord(value) {
  return isObjectRecord(value) ? value : null;
}
function cloneData(value) {
  return value === undefined
    ? undefined
    : typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
}
function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function escapeRegexText(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function browserLanguagePrefix() {
  return (
    (
      (typeof navigator !== 'undefined' &&
        String(navigator.language || '')
          .trim()
          .toLowerCase()) ||
      'en'
    ).split(/[-_]/)[0] || 'en'
  );
}
function trimmedUniqueStrings(values) {
  var seen = new Set();
  return values
    .map(function (value) {
      return String(value || '').trim();
    })
    .filter(function (value) {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}
const GENERATION_INTERRUPTION_KINDS = [
  'user_cancelled',
  'connection_timeout',
  'network_offline',
  'network_interrupted',
  'provider_error',
  'app_suspended',
  'context_changed',
];
const $ = (id) => document.getElementById(id);
// A tap on a message toggles its toolbar unless it lands on one of these controls, which keep their own
// meaning; the message bubble (80-messages-generation.js) and the Risu message frame (35-risu-display.js)
// both use it.
const MESSAGE_TAP_CONTROL_SELECTOR =
  'a,button,input,textarea,select,label,summary,details,audio,video,iframe,[contenteditable="true"],[data-yeyu-interactive]';
function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
  return window.YeyuPure.escapeHtmlAttr(s);
}
function jsArg(s) {
  return window.YeyuPure.inlineJsArg(s);
}
function safeImage(s, allowBlob) {
  return window.YeyuPure.safeImageSource(s, !!allowBlob);
}
function safeColor(s) {
  return window.YeyuPure.safeColor(s);
}
function pureApi() {
  return (typeof window !== 'undefined' && window.YeyuPure) || (typeof YeyuPure !== 'undefined' ? YeyuPure : null);
}
function characterBindingOptions(chars, bound) {
  return chars
    .map(function (char) {
      var id = String(char.id || '');
      return (
        '<label class="wb-bind-character"><input type="checkbox" value="' +
        escAttr(id) +
        '"' +
        (bound.includes(id) ? ' checked' : '') +
        '><span>' +
        esc(canonicalCharacterName(char)) +
        '</span></label>'
      );
    })
    .join('');
}
function uiIcon(name) {
  return (
    '<svg class="ui-icon" aria-hidden="true"><use href="#i-' + name + '" xlink:href="#i-' + name + '"></use></svg>'
  );
}
function remoteImageUrl(s) {
  var p = pureApi();
  return p ? p.remoteImageUrl(s) : '';
}
function normalizeRemoteCardUrl(value) {
  var source = String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, '')
    .trim();
  return remoteImageUrl(source) || '';
}
function ensureImportMeta(char) {
  if (!char.importMeta || typeof char.importMeta !== 'object') char.importMeta = {};
  return char.importMeta;
}
function canonicalCharacterName(char) {
  return String((char && char.localizedName) || (char && char.name) || '角色').trim() || '角色';
}
function characterPromptName(char) {
  return (
    String((char && char.nickname) || '').trim() ||
    String((char && char.name) || '').trim() ||
    canonicalCharacterName(char)
  );
}
function normalizedNameAliases(char) {
  var p = pureApi(),
    values = [char && char.name, char && char.localizedName].concat((char && char.nameAliases) || []);
  return p && p.uniqueTextList ? p.uniqueTextList(values, 40) : values.filter(Boolean);
}
function ensureCharacterIntelligence(char) {
  if (!char) return char;
  var p = pureApi();
  if (!Array.isArray(char.nameAliases)) char.nameAliases = normalizedNameAliases(char);
  if (!Array.isArray(char.participantRegistry) || char.participantRegistryVersion !== 4) {
    char.participantRegistry = p && p.extractParticipantRegistry ? p.extractParticipantRegistry(char) : [];
    char.participantRegistryVersion = 4;
  }
  if (char.localizedName && char.nameAliases.indexOf(char.localizedName) < 0) char.nameAliases.push(char.localizedName);
  if (char.name && char.nameAliases.indexOf(char.name) < 0) char.nameAliases.push(char.name);
  return char;
}
function characterNameGlossary(char) {
  if (!char) return '';
  ensureCharacterIntelligence(char);
  var rows = [],
    main = canonicalCharacterName(char),
    mainAliases = normalizedNameAliases(char).filter(function (x) {
      return x !== main;
    });
  rows.push(main + (mainAliases.length ? '（别名：' + mainAliases.join('、') + '）' : ''));
  (char.participantRegistry || []).forEach(function (p) {
    if (!p || p.canonicalName === main) return;
    var aliases = (p.aliases || []).filter(function (x) {
      return x && x !== p.canonicalName;
    });
    rows.push(p.canonicalName + (aliases.length ? '（别名：' + aliases.join('、') + '）' : ''));
  });
  return Array.from(new Set(rows)).join('\n');
}
function preserveRemoteImageField(char, field, sourceField) {
  if (!char || typeof char !== 'object') return false;
  var raw = typeof char[field] === 'string' ? char[field].trim() : '';
  var local = safeImage(raw, false);
  if (local) {
    char[field] = local;
    return false;
  }
  if (remoteImageUrl(raw)) {
    var meta = ensureImportMeta(char);
    meta[sourceField] = raw;
    char[field] = '';
    return true;
  }
  if (!raw) {
    var changed = !!char[field];
    char[field] = '';
    return changed;
  }
  return false;
}
function cardAssetNameKey(value) {
  return String(value || '')
    .trim()
    .replace(/\.(?:png|jpe?g|webp|gif|avif|apng)$/i, '')
    .replace(/[\s_]+/g, '_');
}
function findCardMediaAsset(assets, wanted) {
  wanted = String(wanted || '').trim();
  if (!wanted) return null;
  var remote = normalizeRemoteCardUrl(wanted),
    folded = cardAssetNameKey(wanted).toLowerCase(),
    rows = assets || [],
    exact = rows.find(function (asset) {
      if (!asset) return false;
      var source = normalizeRemoteCardUrl(asset.sourceUrl) || String(asset.sourceUrl || '').trim();
      if (remote && source === remote) return true;
      if (source && source === wanted) return true;
      var name = String(asset.name || '').trim();
      return !!name && cardAssetNameKey(name).toLowerCase() === folded;
    });
  if (exact) return exact;
  return null;
}
function safeCardMediaSource(value, kind, allowBlob) {
  var source = String(value || '').trim(),
    // An inline data: payload is often megabytes. Stripping its whitespace to try it as a remote
    // address copies the whole thing, and no amount of whitespace removal turns "data:" into http.
    remote = /^data:/i.test(source) ? '' : remoteImageUrl(source.replace(/\s+/g, ''));
  if (remote) return remote;
  var type = String(kind || '').toLowerCase(),
    dataMatch = source.match(/^data:(image|audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i);
  if (dataMatch && (!type || dataMatch[1].toLowerCase() === type)) return source;
  if (allowBlob && /^blob:[^\s]+$/i.test(source)) return source;
  if (/^file:\/\/\/android_asset\/[a-zA-Z0-9_./-]+$/i.test(source) && source.indexOf('..') < 0) return source;
  return '';
}
var _cardAssetObjectUrls = new Map(),
  _retiredCardAssetObjectUrls = new Set(),
  _cardAssetDataUrlBlobs = new WeakMap(),
  _cardAssetLocalSources = new WeakMap(),
  _cardAssetObjectUrlOwnerId = '';
// Validating an inline data: payload reads the whole base64 body. Every rendered message that shows
// the same card image asked again, so one repaint of a long chat re-scanned the same megabytes once
// per message. The answer is kept per asset and thrown away as soon as the stored value is replaced.
function cardAssetLocalMediaSource(asset) {
  var value = asset && (asset.data_url || asset.dataUrl);
  if (!value) return '';
  var cached = _cardAssetLocalSources.get(asset);
  if (cached && cached.value === value) return cached.source;
  var source = safeCardMediaSource(value, '', false);
  _cardAssetLocalSources.set(asset, { value: value, source: source });
  return source;
}
function cardAssetOwnerId(asset, owner) {
  if (owner && typeof owner === 'object' && owner.id) return String(owner.id);
  if (typeof owner === 'string' && owner) return owner;
  var row =
    typeof D !== 'undefined' && D && Array.isArray(D.characters)
      ? D.characters.find(function (char) {
          return char && Array.isArray(char.media_assets) && char.media_assets.indexOf(asset) >= 0;
        })
      : null;
  return row ? String(row.id || '') : '';
}
function retireCardAssetObjectUrl(asset) {
  if (!asset || !asset.objectUrl) return;
  _retiredCardAssetObjectUrls.add(asset.objectUrl);
  _cardAssetObjectUrls.delete(asset);
  delete asset.objectUrl;
  delete asset.objectUrlSource;
  delete asset.objectUrlOwnerId;
}
function revokeCardAssetObjectUrl(asset) {
  if (!asset) return;
  var url = asset.objectUrl;
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
    _retiredCardAssetObjectUrls.delete(url);
  }
  _cardAssetObjectUrls.delete(asset);
  delete asset.objectUrl;
  delete asset.objectUrlSource;
  delete asset.objectUrlOwnerId;
}
function flushRetiredCardAssetObjectUrls() {
  _retiredCardAssetObjectUrls.forEach(function (url) {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
  });
  _retiredCardAssetObjectUrls.clear();
}
function cardAssetObjectUrlsInUse() {
  var live = new Set(),
    values = [],
    roots = [];
  if (typeof document !== 'undefined' && document) {
    var chat = typeof document.getElementById === 'function' ? document.getElementById('chat-messages') : null;
    if (chat) roots.push(chat);
    var expressions =
      typeof document.getElementById === 'function' ? document.getElementById('expression-stage') : null;
    if (expressions && !expressions.hidden) roots.push(expressions);
    if (typeof document.querySelectorAll === 'function')
      Array.from(document.querySelectorAll('.modal-overlay.open')).forEach(function (modal) {
        roots.push(modal);
      });
    if (!roots.length && typeof document.querySelectorAll === 'function') roots.push(document);
  }
  roots.forEach(function (root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    Array.from(root.querySelectorAll('[src^="blob:"],[style*="blob:"],style')).forEach(function (node) {
      ['src', 'style'].forEach(function (name) {
        var value = node && typeof node.getAttribute === 'function' ? String(node.getAttribute(name) || '') : '';
        if (value.indexOf('blob:') >= 0) values.push(value);
      });
      if (
        node &&
        String(node.tagName || '').toUpperCase() === 'STYLE' &&
        String(node.textContent || '').indexOf('blob:') >= 0
      )
        values.push(String(node.textContent));
    });
  });
  if (typeof tavernAudioRuntime === 'function')
    ['bgm', 'ambient'].forEach(function (type) {
      var source = tavernAudioRuntime(type).src;
      if (/^blob:/i.test(String(source || ''))) values.push(String(source));
    });
  _cardAssetObjectUrls.forEach(function (record) {
    var url = String((record && record.url) || '');
    if (
      url &&
      values.some(function (value) {
        return value.indexOf(url) >= 0;
      })
    )
      live.add(url);
  });
  return live;
}
function collectStoredMediaDisplayAssets() {
  var assets = [];
  function take(item) {
    if (!item || !item._mediaDisplay) return;
    Object.keys(item._mediaDisplay).forEach(function (field) {
      if (item._mediaDisplay[field]) assets.push(item._mediaDisplay[field]);
    });
  }
  if (typeof D !== 'undefined' && D) {
    (D.characters || []).forEach(take);
    (D.personas || []).forEach(take);
  }
  return assets;
}
function ensureStoredMediaDisplayAsset(item, field, blob, dataUrl) {
  if (!item) return null;
  item._mediaDisplay = item._mediaDisplay || {};
  var asset = item._mediaDisplay[field];
  if (!asset) {
    asset = {
      id: 'stored_' + String(item.id || '') + '_' + field,
      kind: 'stored-media',
      field: field,
      persistDisplay: true,
    };
    item._mediaDisplay[field] = asset;
  }
  if (blob && typeof blob.arrayBuffer === 'function' && typeof blob.size === 'number') {
    if (asset.blob !== blob) {
      asset.blob = blob;
      delete asset.data_url;
    }
  } else if (dataUrl && asset.data_url !== dataUrl) asset.data_url = dataUrl;
  return asset;
}
function displayImageSrc(item, field) {
  if (!item) return '';
  var blob = item._mediaBlobs && item._mediaBlobs[field],
    data = typeof item[field] === 'string' && /^data:image\//i.test(item[field]) ? item[field] : '';
  if ((blob && typeof blob.arrayBuffer === 'function' && typeof blob.size === 'number') || data) {
    var asset = ensureStoredMediaDisplayAsset(
      item,
      field,
      blob && typeof blob.arrayBuffer === 'function' ? blob : null,
      blob && typeof blob.arrayBuffer === 'function' ? '' : data
    );
    var src = cardAssetDisplaySrc(asset, 'portrait');
    if (src) return src;
  }
  return safeImage(item[field], true);
}
function syncCardAssetObjectUrlLifecycle(char) {
  var nextId = char ? String(char.id || '') : '',
    currentAssets = new Set(char && Array.isArray(char.media_assets) ? char.media_assets : []),
    portraitAssets = typeof collectStoredMediaDisplayAssets === 'function' ? collectStoredMediaDisplayAssets() : [],
    liveUrls = cardAssetObjectUrlsInUse(),
    backgroundUrls = new Set(typeof backgroundObjectUrlsInUse === 'function' ? backgroundObjectUrlsInUse(char) : []);
  if (typeof risuDisplayObjectUrlsInUse === 'function')
    risuDisplayObjectUrlsInUse(char).forEach(function (url) {
      liveUrls.add(url);
    });
  portraitAssets.forEach(function (asset) {
    currentAssets.add(asset);
  });
  // 消息图片按所属角色记 owner，仍显示在对话里的 URL 由下面的 liveUrls 判断保留。
  if (typeof storedImageDisplayAssets === 'function')
    storedImageDisplayAssets().forEach(function (asset) {
      currentAssets.add(asset);
    });
  Array.from(_cardAssetObjectUrls.keys()).forEach(function (asset) {
    var record = _cardAssetObjectUrls.get(asset),
      ownerId = String((record && record.ownerId) || asset.objectUrlOwnerId || ''),
      url = String((record && record.url) || asset.objectUrl || '');
    if (asset && asset.persistDisplay) {
      if (!currentAssets.has(asset)) revokeCardAssetObjectUrl(asset);
      return;
    }
    if (asset && asset.kind === 'stored-image' && asset.displayReaders) return;
    if (backgroundUrls.has(url)) return;
    if (ownerId !== nextId || !currentAssets.has(asset) || !liveUrls.has(url)) revokeCardAssetObjectUrl(asset);
  });
  _cardAssetObjectUrlOwnerId = nextId;
  flushRetiredCardAssetObjectUrls();
}
function releaseAllCardAssetObjectUrls() {
  Array.from(_cardAssetObjectUrls.keys()).forEach(revokeCardAssetObjectUrl);
  flushRetiredCardAssetObjectUrls();
  _cardAssetObjectUrlOwnerId = '';
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener('pagehide', releaseAllCardAssetObjectUrls);
function cardAssetDisplaySrc(asset, owner) {
  if (!asset) return '';
  rememberCardAssetByteDimensions(asset);
  var source = asset.blob instanceof Blob ? asset.blob : asset.bytes instanceof Uint8Array ? asset.bytes : null,
    local = cardAssetLocalMediaSource(asset);
  if (!source && local) {
    var cached = _cardAssetDataUrlBlobs.get(asset);
    if (cached && cached.data === local) source = cached.blob;
    else {
      var match = local.match(/^data:([^,]*);base64,([a-z0-9+/=\s]+)$/i);
      if (match) {
        try {
          var binary = atob(match[2].replace(/\s+/g, '')),
            bytes = new Uint8Array(binary.length);
          for (var index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
          rememberCardAssetByteDimensions(asset, bytes);
          source = new Blob([bytes], { type: match[1] || 'application/octet-stream' });
          _cardAssetDataUrlBlobs.set(asset, { data: local, blob: source });
        } catch (_) {
          source = null;
        }
      }
    }
  }
  if (!source) {
    if (asset.mediaKey) return '';
    return '';
  }
  if (asset.objectUrl && asset.objectUrlSource !== source) retireCardAssetObjectUrl(asset);
  var ownerId = cardAssetOwnerId(asset, owner);
  if (!asset.objectUrl) {
    var blob =
      source instanceof Blob
        ? source
        : new Blob([source], {
            type:
              asset.mime ||
              (typeof cardAssetMime === 'function' ? cardAssetMime(asset, asset.name) : 'application/octet-stream'),
          });
    asset.objectUrl = URL.createObjectURL(blob);
    asset.objectUrlSource = source;
    asset.objectUrlOwnerId = ownerId;
    _cardAssetObjectUrls.set(asset, { url: asset.objectUrl, ownerId: ownerId });
  } else if (ownerId && asset.objectUrlOwnerId !== ownerId) {
    asset.objectUrlOwnerId = ownerId;
    _cardAssetObjectUrls.set(asset, { url: asset.objectUrl, ownerId: ownerId });
  }
  return safeCardMediaSource(asset.objectUrl, '', true);
}
function cardAssetLayoutBlob(asset) {
  var cached = asset && _cardAssetDataUrlBlobs.get(asset);
  return asset && asset.blob instanceof Blob
    ? asset.blob
    : asset && asset.bytes instanceof Uint8Array
      ? new Blob([asset.bytes], { type: asset.mime || 'application/octet-stream' })
      : (cached && cached.blob) || null;
}
function normalizeCardMediaAssets(char) {
  if (!char || !Array.isArray(char.media_assets)) {
    if (char) char.media_assets = [];
    return;
  }
  char.media_assets = char.media_assets
    .map(function (asset) {
      var a = asset && typeof asset === 'object' ? asset : {},
        local = cardAssetLocalMediaSource(a),
        source = normalizeRemoteCardUrl(a.sourceUrl) || String(a.sourceUrl || '').trim();
      if (local) {
        a.data_url = local;
        delete a.dataUrl;
      } else {
        delete a.data_url;
        delete a.dataUrl;
      }
      if (source) a.sourceUrl = source;
      if (!a.id) a.id = 'asset_' + uid();
      if (!a.status)
        a.status =
          a.bytes instanceof Uint8Array || a.blob instanceof Blob || a.mediaKey || local
            ? 'ready'
            : remoteImageUrl(a.sourceUrl)
              ? 'pending'
              : 'unavailable';
      rememberCardAssetByteDimensions(a);
      return a;
    })
    .filter(function (a) {
      return a && (a.sourceUrl || a.data_url || a.mediaKey || a.bytes instanceof Uint8Array || a.blob instanceof Blob);
    });
}
function ensureSessionDirectiveMetadata(sess) {
  return sess;
}
function sanitizeLoadedData(data) {
  if (!Array.isArray(data.wheelSchemes)) data.wheelSchemes = [];
  (Array.isArray(data.characters) ? data.characters : []).forEach(function (c) {
    preserveRemoteImageField(c, 'avatar_image', 'sourceAvatar');
    preserveRemoteImageField(c, 'background_image', 'sourceBackground');
    var notes = String(c.creator_notes || '');
    if (c.creator_notes_clean == null && notes)
      c.creator_notes_clean = window.YeyuPure.cleanCreatorNotes(notes).cleaned;
    c.creator_notes_display = String(c.creator_notes_display || '');
    c.creator_notes_zh = String(c.creator_notes_zh || '');
    normalizeCardMediaAssets(c);
    c.tags = Array.isArray(c.tags) ? c.tags.map(String) : [];
    ensureCharacterIntelligence(c);
  });
  (data.personas || []).forEach(function (p) {
    p.avatar_image = safeImage(p.avatar_image, false);
  });
  if (typeof normalizePersonaBindings === 'function') normalizePersonaBindings(data);
  ((data.worldBook && data.worldBook.categories) || []).forEach(function (c) {
    c.color = safeColor(c.color);
  });
  Object.values(data.chats || {}).forEach(function (box) {
    (box.sessions || []).forEach(function (sess) {
      ensureMessageSequences(sess);
      sanitizeLoadedAssistantMessages(sess);
      ensureSessionMemoryStore(sess);
      ensureSessionDirectiveMetadata(sess);
      (sess.msgs || []).forEach(function (m) {
        if (m && m.role === 'user') {
          delete m.cacheContext;
          delete m.cacheContextVersion;
          delete m.memoryRetrievalFingerprint;
          delete m.vectorRetrievalFingerprint;
          delete m.worldBookSnapshot;
          delete m.worldBookMetrics;
          delete m.worldBookInChat;
          delete m.authorNoteContext;
        }
      });
    });
  });
  if (!data.settings) data.settings = {};
  ensureProviderSettings(data.settings);
  if (['auto', 'dark', 'light'].indexOf(data.settings.themeMode) < 0) data.settings.themeMode = 'auto';
  if (['bubble', 'immersive'].indexOf(data.settings.messageStyle) < 0) data.settings.messageStyle = 'bubble';
  if (typeof normalizeRegexScriptCollections === 'function') normalizeRegexScriptCollections(data);
  if (typeof upgradeStoredCompletionPresets === 'function') upgradeStoredCompletionPresets(data.settings);
  return data;
}
// A notice may offer one action ({label, run}); it then takes taps and stays long enough to reach.
function toast(msg, type = 'info', action) {
  const c = $('toasts'),
    e = document.createElement('div');
  e.className = 'toast ' + type;
  e.textContent = msg;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn text accent sm toast-action';
    button.textContent = action.label;
    button.onclick = () => {
      e.remove();
      action.run();
    };
    e.classList.add('has-action');
    e.appendChild(button);
  }
  c.appendChild(e);
  const lifetime = action ? 8000 : 2800;
  setTimeout(() => {
    e.style.transition = 'opacity var(--motion-fast) var(--motion-ease)';
    e.style.opacity = '0';
    setTimeout(() => e.remove(), uiMotionDuration('--motion-fast'));
  }, lifetime);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function getGreetings(char) {
  if (!char) return [];
  var all = [];
  if (char.first_mes && char.first_mes.trim()) all.push(char.first_mes.trim());
  if (Array.isArray(char.alternate_greetings))
    char.alternate_greetings.forEach(function (x) {
      if (x && String(x).trim()) all.push(String(x).trim());
    });
  return all;
}
// The non-blank greetings of a first_mes and alternate list, each with its slot: first_mes is 0 and
// alternates[i] is i + 1. A getGreetings choice index is a position in this list.
function filledGreetingSlots(first, alternates) {
  var rows = [];
  [first].concat(Array.isArray(alternates) ? alternates : []).forEach(function (text, slot) {
    text = typeof text === 'string' ? text.trim() : '';
    if (text) rows.push({ slot: slot, text: text });
  });
  return rows;
}
// The stored-card slot of a getGreetings choice. Risu only looks up greetings in the stored list.
function storedGreetingSlot(char, choiceIndex) {
  var row = filledGreetingSlots(char && char.first_mes, char && char.alternate_greetings)[choiceIndex];
  return row ? row.slot : choiceIndex;
}
// The card slot of a getGreetings choice, which is what CCv3 @@is_greeting counts. Cards imported before
// blank greetings kept their slot store a compacted list; while it still matches the raw card, the raw
// card's slots count.
function greetingCardIndex(char, choiceIndex) {
  var stored = filledGreetingSlots(char && char.first_mes, char && char.alternate_greetings),
    raw = char && char.importMeta && char.importMeta.rawCard,
    data = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? raw.data : raw,
    original =
      data && typeof data === 'object'
        ? filledGreetingSlots(
            data.first_mes || data.char_greeting,
            [].concat(data.alternate_greetings || [], data.additional_greetings || [])
          )
        : [],
    sameText =
      original.length === stored.length &&
      original.every(function (row, index) {
        return row.text === stored[index].text;
      }),
    row = (sameText ? original : stored)[choiceIndex];
  return row ? row.slot : choiceIndex;
}
// The stored alternate_greetings position of an opening message (-1 for first_mes or no opening): the
// greeting index Risu scripts read.
function openingAlternateGreetingIndex(char, message) {
  return message && message.opening ? storedGreetingSlot(char, Number(message.openingIndex) || 0) - 1 : -1;
}
let greetingResolver = null,
  greetingSelected = 0,
  greetingOverviewCache = {},
  greetingOverviewRequests = new Map(),
  greetingDisplayCache = {},
  creatorNotesResolver = null,
  creatorNotesCharacterId = '',
  creatorNotesTranslationController = null,
  creatorNotesShowingTranslation = false;
function decodeMarkupEntities(value) {
  return String(value || '').replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ndash|mdash|hellip|ldquo|rdquo|lsquo|rsquo|bull|rarr|larr|harr);/gi,
    function (_, entity) {
      var key = String(entity || '').toLowerCase();
      if (key === 'amp') return '&';
      if (key === 'lt') return '<';
      if (key === 'gt') return '>';
      if (key === 'quot') return '"';
      if (key === 'apos') return "'";
      if (key === 'nbsp') return '\u00a0';
      var map = {
        ndash: '–',
        mdash: '—',
        hellip: '…',
        ldquo: '“',
        rdquo: '”',
        lsquo: '‘',
        rsquo: '’',
        bull: '•',
        rarr: '→',
        larr: '←',
        harr: '↔',
      };
      if (map[key]) return map[key];
      var n =
        key.indexOf('#x') === 0 ? parseInt(key.slice(2), 16) : key.indexOf('#') === 0 ? parseInt(key.slice(1), 10) : 0;
      return n > 0 && n <= 0x10ffff ? (String.fromCodePoint ? String.fromCodePoint(n) : String.fromCharCode(n)) : _;
    }
  );
}
function creatorNoteSource(char) {
  if (!char) return '';
  var multilingual =
      char.creator_notes_multilingual &&
      typeof char.creator_notes_multilingual === 'object' &&
      !Array.isArray(char.creator_notes_multilingual)
        ? char.creator_notes_multilingual
        : {},
    language = browserLanguagePrefix(),
    matched = Object.keys(multilingual).find(function (key) {
      return String(key).toLowerCase().split(/[-_]/)[0] === language;
    }),
    source = matched ? multilingual[matched] : multilingual.en != null ? multilingual.en : char.creator_notes;
  return decodeMarkupEntities(String(source || char.creator_notes_display || char.creator_notes_clean || ''));
}
function protectTranslationMarkup(source, options) {
  return YeyuPure.protectTranslationMarkup(source, options);
}
// A function replacer is required: protected fragments are raw source, so $&, $$, $` and $' inside
// them must be written back literally instead of being expanded.
function translationSlotLiteral(slot) {
  return function () {
    return slot.value;
  };
}
// Protected regions nest: a fragment that a later rule swallowed whole always took its number after
// the fragments already protected inside it, so the containing slot is always the higher number.
// Restoring from the highest number down therefore puts every container back before the tokens it
// contains are looked for. Walking the other way reported those inner tokens as missing, appended
// them to the end of the message and left them spelled out literally inside the container.
// `missing` reports the slots whose token the reply dropped, in the order they were protected.
function restoreTranslationMarkup(value, slots) {
  var text = String(value || ''),
    rows = Array.isArray(slots) ? slots : [],
    missing = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var slot = rows[i],
      token = slot.token,
      index = Number((/(\d+)/.exec(token) || [])[1]),
      escaped = escapeRegexText(token),
      strict = new RegExp(escaped, 'g'),
      loose = new RegExp('__\\s*YEYU[ _-]*KEEP[ _-]*' + index + '\\s*__', 'gi'),
      literal = translationSlotLiteral(slot);
    if (strict.test(text)) text = text.replace(strict, literal);
    else if (loose.test(text)) text = text.replace(loose, literal);
    else {
      missing.push(slot);
      text += (text && !/\n$/.test(text) ? '\n' : '') + slot.value;
    }
  }
  missing.reverse();
  return { text: text, missing: missing };
}
function translationMacroSlot(slot) {
  return /^\{\{[\s\S]*\}\}$/.test(String((slot && slot.value) || ''));
}
function translationRequiredSlot(slot) {
  return translationMacroSlot(slot) || (slot && (slot.kind === 'hidden-trigger' || slot.kind === 'natural-fence'));
}
// Whatever is written back must contain no placeholder of ours. A reply that moved a token into
// another span, invented a separator or dropped one leaves exactly this residue behind, and the
// loose spellings are covered because the restore accepts them too.
function translationPlaceholderResidue(value, original) {
  function counts(source) {
    var result = Object.create(null),
      pattern = /__\s*YEYU[ _-]*(KEEP|PART)[ _-]*(\d+)\s*__/gi,
      match;
    while ((match = pattern.exec(String(source || '')))) {
      var key = String(match[1]).toUpperCase() + ':' + Number(match[2]);
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }
  var actual = counts(value),
    allowed = counts(original);
  return Object.keys(actual).some(function (key) {
    return actual[key] > (allowed[key] || 0);
  });
}
function translationComparableText(value) {
  return String(value || '')
    .replace(/__YEYU_KEEP_\d+__/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, '');
}
function splitAuxiliaryTranslationChunks(text, limit) {
  var source = String(text || ''),
    max = Math.max(1800, Number(limit) || 7000),
    out = [];
  while (source.length > max) {
    var cut = Math.max(source.lastIndexOf('\n\n', max), source.lastIndexOf('\n', max));
    if (cut < Math.floor(max * 0.45)) cut = max;
    out.push(source.slice(0, cut).replace(/\s+$/, ''));
    source = source.slice(cut).replace(/^\s+/, '');
  }
  if (source.trim()) out.push(source);
  return out;
}
async function translateCreatorNotesForUser(char, note) {
  var cfg = (D && D.settings) || {},
    route = resolveApiRoute('translation');
  if ((!route.apiKey && route.protocol !== 'grok-subscription') || !route.apiUrl || !route.model) return '';
  var controller = new AbortController();
  creatorNotesTranslationController = controller;
  var releaseController = typeof registerTransientRequestController === 'function' ? registerTransientRequestController(controller) : null;
  try {
    var protectedInput = protectTranslationMarkup(decodeMarkupEntities(note)),
      chunks = splitAuxiliaryTranslationChunks(protectedInput.source, 7000),
      system = settingsPromptText('creatorNotesTranslationPrompt', cfg),
      parts = [];
    for (var i = 0; i < chunks.length; i++) {
      if (controller.signal.aborted) throw new Error('已取消');
      setCreatorNotesStatus('正在翻译作者注记（' + (i + 1) + ' / ' + chunks.length + '）…');
      var body = {
        model: route.model,
        stream: false,
        messages: [
          { role: 'system', content: system + '\n这是第 ' + (i + 1) + ' / ' + chunks.length + ' 个片段。' },
          { role: 'user', content: chunks[i] },
        ],
      };
      body.max_tokens = Math.min(65536, Math.max(2048, Math.ceil(chunks[i].length * 1.8)));
      applyThinkingForRoute(body, route, { route: 'translation' });
      var resp = await fetchCompatibleCompletion(route, body, controller.signal),
        json = await resp.json(),
        choice = (json && json.choices && json.choices[0]) || {},
        raw = cleanTranslationResult(getChatCompletionContent(json));
      if (choice.finish_reason === 'length') throw new Error('第 ' + (i + 1) + ' 个片段被输出上限截断');
      if (!raw.trim()) throw new Error('第 ' + (i + 1) + ' 个片段没有返回译文');
      parts.push(raw.trim());
    }
    var restored = restoreTranslationMarkup(parts.join('\n\n'), protectedInput.slots),
      out = restored.text,
      sourceComparable = translationComparableText(protectedInput.source),
      outComparable = translationComparableText(out);
    if (
      !out ||
      (!/[\u3400-\u9fff]/.test(out) && sourceComparable.length > 20) ||
      (sourceComparable.length > 300 && outComparable.length < sourceComparable.length * 0.12)
    )
      throw new Error('没有得到完整中文译文');
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
    if (Array.isArray(D.characters) && !D.characters.includes(char)) throw new DOMException('角色已移除', 'AbortError');
    char.creator_notes_zh = out;
    try {
      await saveData('characters', { urgent: true });
    } catch (error) {
      // 本次仍展示译文；未保存要说明，免得重启后译文消失又重复付费翻译。
      toast('译文未保存：' + String((error && error.message) || error || '保存失败'), 'err');
    }
    return out;
  } finally {
    if (releaseController) releaseController();
    if (creatorNotesTranslationController === controller) creatorNotesTranslationController = null;
  }
}
function renderCreatorNotesText(text) {
  var el = $('creator-notes-content');
  if (!el) return;
  el.innerHTML = md(decodeMarkupEntities(text), { role: 'assistant', safeMarkup: true });
}
function setCreatorNotesStatus(text) {
  var el = $('creator-notes-status');
  if (el) el.textContent = String(text || '');
}
function updateCreatorNotesTranslationButton() {
  var btn = $('creator-notes-translate-btn');
  if (!btn) return;
  btn.textContent = creatorNotesShowingTranslation ? '显示原文' : '翻译为中文';
}
async function translateCreatorNotesForDisplay() {
  var char =
      D &&
      D.characters &&
      D.characters.find(function (c) {
        return c.id === creatorNotesCharacterId;
      }),
    note = creatorNoteSource(char).trim(),
    confirm = $('creator-notes-confirm'),
    button = $('creator-notes-translate-btn');
  if (!char || !note) return;
  if (creatorNotesShowingTranslation) {
    creatorNotesShowingTranslation = false;
    renderCreatorNotesText(note);
    setCreatorNotesStatus('当前显示原文。');
    updateCreatorNotesTranslationButton();
    return;
  }
  if (char.creator_notes_zh) {
    creatorNotesShowingTranslation = true;
    renderCreatorNotesText(char.creator_notes_zh);
    setCreatorNotesStatus('已显示保存的中文译文。');
    updateCreatorNotesTranslationButton();
    return;
  }
  var translationRoute = resolveApiRoute('translation');
  if (
    (!translationRoute.apiKey && translationRoute.protocol !== 'grok-subscription') ||
    !translationRoute.apiUrl ||
    !translationRoute.model
  ) {
    setCreatorNotesStatus('未配置翻译接口，仍显示原文。');
    return;
  }
  if (button) button.disabled = true;
  var owner = creatorNotesResolver;
  function active() { return creatorNotesResolver === owner && creatorNotesCharacterId === char.id; }
  setCreatorNotesStatus('正在翻译…');
  try {
    var translated = await translateCreatorNotesForUser(char, note);
    if (!active()) return;
    if (translated) {
      creatorNotesShowingTranslation = true;
      renderCreatorNotesText(translated);
      setCreatorNotesStatus('中文译文已生成并保存。');
    }
  } catch (error) {
    if (!active()) return;
    if (error && error.name === 'AbortError') {
      setCreatorNotesStatus('已停止翻译，当前显示原文。');
    } else {
      renderCreatorNotesText(note);
      setCreatorNotesStatus('翻译失败，仍显示原文：' + String((error && error.message) || error));
    }
  } finally {
    if (active()) {
      if (button) button.disabled = false;
      if (confirm) confirm.disabled = false;
      updateCreatorNotesTranslationButton();
    }
  }
}
async function showCreatorNotesBeforeChat(char) {
  var note = creatorNoteSource(char).trim();
  if (!char || !note || char.creatorNotesShownAt) return true;
  if (creatorNotesTranslationController) creatorNotesTranslationController.abort();
  if (creatorNotesResolver) {
    var old = creatorNotesResolver;
    creatorNotesResolver = null;
    old(false);
  }
  var wait = new Promise(function (resolve) {
    creatorNotesResolver = resolve;
    creatorNotesCharacterId = char.id;
  });
  creatorNotesShowingTranslation = false;
  $('creator-notes-title').textContent = canonicalCharacterName(char) + ' · 作者注记';
  var translationButton = $('creator-notes-translate-btn');
  if (translationButton) translationButton.disabled = false;
  var confirm = $('creator-notes-confirm');
  if (confirm) confirm.disabled = false;
  renderCreatorNotesText(note);
  setCreatorNotesStatus('只给你看，不会发送给角色；点「翻译为中文」后才会调用翻译接口。');
  updateCreatorNotesTranslationButton();
  openModal('creator-notes-modal');
  return wait;
}
async function confirmCreatorNotes() {
  var char = D.characters.find(function (c) {
      return c.id === creatorNotesCharacterId;
    }),
    resolver = creatorNotesResolver;
  if (creatorNotesTranslationController) creatorNotesTranslationController.abort();
  creatorNotesResolver = null;
  creatorNotesCharacterId = '';
  if (char) {
    char.creatorNotesShownAt = Date.now();
    try {
      await saveData('characters', { urgent: true });
    } catch (error) {
      toast('作者注记状态保存失败，下次仍会显示', 'info');
    }
  }
  var modal = $('creator-notes-modal');
  if (modal) closeModal('creator-notes-modal');
  if (resolver) resolver(true);
}
var _cardAssetHydrations = new WeakMap(),
  _cardAssetDimensions = new WeakMap(),
  _cardAssetDimensionTasks = new WeakMap(),
  _cardAssetDimensionFailures = new WeakSet();
function cardAssetDimensions(asset) {
  return (asset && _cardAssetDimensions.get(asset)) || null;
}
function rememberCardAssetByteDimensions(asset, sourceBytes) {
  var bytes = sourceBytes instanceof Uint8Array ? sourceBytes : asset && asset.bytes;
  if (!asset || _cardAssetDimensions.has(asset) || !(bytes instanceof Uint8Array)) return cardAssetDimensions(asset);
  var width = 0,
    height = 0;
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  } else if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    width = bytes[6] | (bytes[7] << 8);
    height = bytes[8] | (bytes[9] << 8);
  } else if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58 && bytes.length >= 30) {
      width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (var offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      var marker = bytes[offset + 1],
        length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        break;
      }
      offset += 2 + length;
    }
  }
  if (width > 0 && height > 0) _cardAssetDimensions.set(asset, { width: width, height: height });
  return cardAssetDimensions(asset);
}
async function measureCardAssetBlob(asset, blob) {
  if (!asset || !blob || _cardAssetDimensions.has(asset)) return cardAssetDimensions(asset);
  var dimensions = null;
  if (typeof createImageBitmap === 'function') {
    try {
      var bitmap = await createImageBitmap(blob);
      dimensions = { width: bitmap.width, height: bitmap.height };
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    } catch (_) {}
  }
  if (
    !dimensions &&
    typeof Image === 'function' &&
    typeof URL === 'object' &&
    URL &&
    typeof URL.createObjectURL === 'function'
  ) {
    dimensions = await new Promise(function (resolve) {
      var url = URL.createObjectURL(blob),
        image = new Image(),
        finish = function (value) {
          URL.revokeObjectURL(url);
          resolve(value);
        };
      image.onload = function () {
        finish({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = function () {
        finish(null);
      };
      image.src = url;
    });
  }
  if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
    _cardAssetDimensions.set(asset, dimensions);
    _cardAssetDimensionFailures.delete(asset);
  } else _cardAssetDimensionFailures.add(asset);
  return cardAssetDimensions(asset);
}
function prepareCardAssetDimensions(asset) {
  if (!asset || cardAssetDimensions(asset) || _cardAssetDimensionFailures.has(asset))
    return Promise.resolve(cardAssetDimensions(asset));
  var task = _cardAssetDimensionTasks.get(asset),
    blob = typeof cardAssetLayoutBlob === 'function' && cardAssetLayoutBlob(asset);
  if (task) return task;
  if (!blob) return Promise.resolve(null);
  task = measureCardAssetBlob(asset, blob);
  _cardAssetDimensionTasks.set(asset, task);
  task.finally(function () {
    if (_cardAssetDimensionTasks.get(asset) === task) _cardAssetDimensionTasks.delete(asset);
  });
  return task;
}
function mediaAssetDisplayText(char, row, text, role, message, options) {
  if (row && row.displayTextReady === true) {
    return text;
  }
  return typeof regexScriptDisplayText === 'function'
    ? regexScriptDisplayText(text, role, char, message, options)
    : text;
}
function mediaAssetsNeededForText(char, texts) {
  var assets = char && Array.isArray(char.media_assets) ? char.media_assets : [],
    needed = [],
    api = pureApi();
  (Array.isArray(texts) ? texts : [texts]).forEach(function (entry) {
    var row = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null,
      text = String(row ? row.text : entry || ''),
      role = String((row && row.role) || 'assistant'),
      message = (row && row.message) || null,
      options =
        row && row.streamPreview
          ? { depth: row.depth, streamPreview: true }
          : row && typeof row.depth === 'number'
            ? { depth: row.depth }
            : undefined,
      display = mediaAssetDisplayText(char, row, text, role, message, options),
      refs = api && api.extractImageRefs ? api.extractImageRefs(display) : [];
    refs.forEach(function (ref) {
      var asset = findCardMediaAsset(assets, ref && ref.url);
      if (asset && needed.indexOf(asset) < 0) needed.push(asset);
    });
  });
  return needed;
}
async function hydrateReferencedCardAssets(char, texts) {
  if (!char || !Array.isArray(char.media_assets)) return false;
  var candidates = mediaAssetsNeededForText(char, texts).filter(function (asset) {
    var src = asset && cardAssetDisplaySrc(asset, char);
    return (
      asset &&
      !_cardAssetDimensionFailures.has(asset) &&
      ((!src && asset.mediaKey) || (src && !cardAssetDimensions(asset) && !!cardAssetLayoutBlob(asset)))
    );
  });
  if (!candidates.length) return false;
  var results = await mapWithConcurrency(candidates, 4, async function (asset) {
    var pending = _cardAssetHydrations.get(asset);
    if (!pending) {
      pending = (async function () {
        var inMemory = cardAssetLayoutBlob(asset);
        if (inMemory) {
          var known = cardAssetDimensions(asset);
          await prepareCardAssetDimensions(asset);
          return !known && !!cardAssetDimensions(asset);
        }
        if (window.YeyuRepository && typeof YeyuRepository.loadMediaBlob === 'function') {
          try {
            var blob = await YeyuRepository.loadMediaBlob(asset.mediaKey);
            if (blob) {
              await measureCardAssetBlob(asset, blob);
              asset.blob = blob;
              delete asset.data_url;
              delete asset.dataUrl;
              delete asset.bytes;
              asset.status = 'ready';
              return true;
            }
            _cardAssetDimensionFailures.add(asset);
          } catch (error) {
            _cardAssetDimensionFailures.add(asset);
            console.warn('素材读取失败', error);
          }
        }
        return false;
      })();
      _cardAssetHydrations.set(asset, pending);
      pending.finally(function () {
        if (_cardAssetHydrations.get(asset) === pending) _cardAssetHydrations.delete(asset);
      });
    }
    return await pending;
  });
  return results.some(Boolean);
}
async function ensureGreetingMediaReady(char) {
  if (!char || !Array.isArray(char.media_assets)) return;
  normalizeCardMediaAssets(char);
  var texts =
    typeof getGreetings === 'function' ? getGreetings(char) : [char.first_mes].concat(char.alternate_greetings || []);
  await hydrateReferencedCardAssets(char, texts);
  var failed = mediaAssetsNeededForText(char, texts).filter(function (asset) {
    return asset && asset.status === 'failed';
  }).length;
  if (failed) toast('部分开场白图片无法下载，已保留原始图片地址', 'info');
}
function prefetchGreetingMedia(char, all) {
  if (!char || !Array.isArray(all) || !all.length) return;
  // Leaving and returning to the same character mid-prefetch starts another selection run, so only
  // the resolver that started this prefetch may repaint; otherwise the stale greeting list would
  // land on top of the newer selection.
  var resolver = greetingResolver;
  Promise.resolve()
    .then(function () {
      return ensureGreetingMediaReady(char);
    })
    .then(function () {
      if (resolver && greetingResolver === resolver) renderGreetingChoices(all);
    })
    .catch(function (error) {
      console.warn('开场白图片预取失败', error);
    });
}
var greetingPreviewVars = null,
  greetingPreviewSession = null;
// Which conversation's state the candidates are evaluated against. Clearing a conversation other
// than the open one must preview that conversation's card options, because those are the options it
// keeps afterwards.
function greetingPreviewSessionFor(char) {
  if (greetingPreviewSession) return greetingPreviewSession;
  return char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
}
function chooseGreeting(char, previewVars, previewSession) {
  cancelGreetingOverviewRequests();
  var all = getGreetings(char);
  if (!all.length) return '';
  if (greetingResolver) {
    var previous = greetingResolver;
    greetingResolver = null;
    previous(null);
  }
  greetingPreviewSession = previewSession || null;
  greetingPreviewVars =
    previewVars && typeof previewVars === 'object' && !Array.isArray(previewVars)
      ? Object.assign({}, previewVars)
      : null;
  return new Promise(function (resolve) {
    greetingResolver = resolve;
    greetingSelected = 0;
    greetingOverviewCache = {};
    greetingDisplayCache = {};
    renderGreetingChoices(all);
    openModal('greeting-modal');
    prefetchGreetingMedia(char, all);
    prefetchGreetingDisplayTexts(char, all);
  });
}
// How many display regexes an ordinary card would run over a greeting. Cards that run none keep the
// immediate preview, so the dialog never shows a placeholder it does not need.
function greetingDisplayRegexCount(char) {
  if (typeof isRisuCharacter === 'function' && isRisuCharacter(char)) return 0;
  if (typeof regexTransformOps !== 'function' || typeof prepareRegexScriptTexts !== 'function') return 0;
  if (typeof regexScriptDisplayText !== 'function') return 0;
  try {
    return regexTransformOps(char, 'assistant', 'display', 0).length;
  } catch (_) {
    return 0;
  }
}
// The candidate as the chat would hold it: the opening message of a conversation that has no other
// message, which is the depth the display transform is keyed by.
function greetingPreviewDisplayRow(text, index) {
  var value = String(text || '');
  return {
    role: 'assistant',
    phase: 'display',
    depth: 0,
    index: 0,
    text: value,
    message: { role: 'assistant', content: value, opening: true, openingIndex: index },
  };
}
// Greeting candidates are templates: what the reader will see depends on the conversation's option
// values (Risu) and on the card's display regexes (everyone else). Each candidate is evaluated once
// per opened dialog and reused by every redraw, because that evaluation walks the whole template
// and, for display regexes, goes through the script worker.
function prefetchGreetingDisplayTexts(char, all) {
  var resolver = greetingResolver,
    session = greetingPreviewSessionFor(char);
  function publish(rows) {
    if (!resolver || greetingResolver !== resolver) return;
    rows.forEach(function (value, index) {
      greetingDisplayCache[index] = value;
    });
    renderGreetingChoices(all);
  }
  if (typeof isRisuCharacter === 'function' && isRisuCharacter(char)) {
    if (typeof risuGreetingDisplayText !== 'function') return;
    Promise.all(
      all.map(function (text, index) {
        return Promise.resolve()
          .then(function () {
            return risuGreetingDisplayText(char, session, text, index);
          })
          .then(function (value) {
            return String(value == null ? '' : value);
          })
          .catch(function () {
            return String(text || '');
          });
      })
    ).then(publish);
    return;
  }
  if (!greetingDisplayRegexCount(char)) return;
  var rows = all.map(function (text, index) {
    var row = greetingPreviewDisplayRow(text, index);
    row.text = messageDisplayParts(char, row.message, { macroState: greetingMacroPreviewState(char) }).content;
    return row;
  });
  Promise.resolve()
    .then(function () {
      return prepareRegexScriptTexts(char, rows);
    })
    .then(function () {
      return rows.map(function (row) {
        var value = regexScriptDisplayText(row.text, 'assistant', char, row.message, { depth: 0, index: 0 });
        return String(value == null ? '' : value);
      });
    })
    .catch(function () {
      return rows.map(function (row) {
        return row.text;
      });
    })
    .then(publish);
}
function greetingMacroPreviewState(char) {
  var session = greetingPreviewSessionFor(char),
    vars = greetingPreviewVars
      ? Object.assign({}, greetingPreviewVars)
      : session && session.macroVars && typeof session.macroVars === 'object' && !Array.isArray(session.macroVars)
        ? Object.assign({}, session.macroVars)
        : {},
    state = typeof createCharacterMacroState === 'function' ? createCharacterMacroState(undefined, vars) : undefined;
  return state;
}
function greetingPreviewSource(char, text, index) {
  var cached = Object.prototype.hasOwnProperty.call(greetingDisplayCache, index) ? greetingDisplayCache[index] : null;
  if (typeof isRisuCharacter === 'function' && isRisuCharacter(char)) return cached;
  // Cached rows have already expanded macros before display regexes, just like chat.
  if (cached == null && greetingDisplayRegexCount(char)) return null;
  return cached == null
    ? messageDisplayParts(char, greetingPreviewDisplayRow(text, index).message, {
        macroState: greetingMacroPreviewState(char),
      }).content
    : cached;
}
// The picker previews what the reader will read, not how the card lays it out: the card's markup,
// styles and scripts never reach the dialog, only the card's own greeting images as thumbnails and
// the text as one run. Images a card interface draws for itself are layout, not greeting content.
// Display scripts commonly wrap a whole scene in an html fence, so fence lines are dropped while
// their bodies stay.
function greetingPreviewHtml(char, displayText) {
  var assets = (char && char.media_assets) || [],
    visible = cleanDisplayText(displayText, 'assistant', { char: char }).replace(
      /<\s*(script|style|template|noscript|title)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      ' '
    ),
    images = window.YeyuPure.extractImageRefs(visible)
      .filter(function (ref) {
        var url = String(ref.url || '').trim();
        return findCardMediaAsset(assets, normalizeRemoteCardUrl(url) || url);
      })
      .map(function (ref) {
        return cardImageHtml(ref, { mediaAssets: assets, mediaOwnerId: char && char.id });
      })
      .join(''),
    text = window.YeyuPure.readableMessageText(visible.replace(/<[^>]+>/g, ' '), { keepCodeBodies: true });
  text = window.YeyuPure.decodeAttrText(text).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return images + esc(text);
}
function renderGreetingChoices(all) {
  var char = getChar(),
    risu = typeof isRisuCharacter === 'function' && isRisuCharacter(char),
    waiting = risu ? '正在按当前卡片选项生成预览…' : '正在生成预览…',
    empty = risu
      ? '按当前卡片选项，这条开场白没有可显示的内容；可先在聊天页的卡片选项里选好场景。'
      : '这条开场白经卡片的显示脚本处理后没有可显示的内容。';
  $('greeting-list').innerHTML = all
    .map(function (text, i) {
      var ov = greetingOverviewCache[i],
        displayText = greetingPreviewSource(char, text, i),
        preview =
          displayText == null
            ? '<p class="hint">' + waiting + '</p>'
            : (displayText.trim() && greetingPreviewHtml(char, displayText)) || '<p class="hint">' + empty + '</p>';
      return (
        '<div class="greeting-option' +
        (i === greetingSelected ? ' selected' : '') +
        '" role="radio" tabindex="0" aria-checked="' +
        (i === greetingSelected) +
        '" onclick="selectGreetingChoice(' +
        i +
        ')" onkeydown="greetingChoiceKey(event,' +
        i +
        ')"><div class="greeting-preview">' +
        preview +
        '</div><div class="greeting-tools"><span>开场白 ' +
        (i + 1) +
        '</span><button type="button" class="btn text accent sm" onclick="event.stopPropagation();translateGreetingOverview(' +
        i +
        ')">中文概览</button></div>' +
        (ov ? '<div class="greeting-overview">' + esc(ov).replace(/\n/g, '<br>') + '</div>' : '') +
        '</div>'
      );
    })
    .join('');
}
function cancelGreetingOverviewRequests() {
  greetingOverviewRequests.forEach(function (request) { request.controller.abort(); });
  greetingOverviewRequests.clear();
}
async function translateGreetingOverview(i) {
  var char = getChar(),
    all = getGreetings(char);
  if (!all[i]) return;
  var evaluated = greetingPreviewSource(char, all[i], i);
  if (evaluated == null) {
    toast('预览还在生成，请稍后再试', 'info');
    return;
  }
  var src = evaluated.trim();
  if (!src) {
    toast('这条开场白没有可概览的内容', 'info');
    return;
  }
  if (greetingOverviewCache[i]) {
    renderGreetingChoices(all);
    return;
  }
  var cfg = D.settings,
    route = resolveApiRoute('greetingOverview');
  if ((!route.apiKey && route.protocol !== 'grok-subscription') || !route.apiUrl || !route.model) {
    toast('请先配置开场白概览的模型路由', 'err');
    return;
  }
  var previous = greetingOverviewRequests.get(i), cache = greetingOverviewCache;
  if (previous && previous.char === char && previous.source === src && previous.cache === cache) return previous.promise;
  if (previous) previous.controller.abort();
  var request = {char: char, source: src, cache: cache, controller: new AbortController(), promise: null};
  greetingOverviewRequests.set(i, request);
  var releaseController = typeof registerTransientRequestController === 'function' ? registerTransientRequestController(request.controller) : null;
  function active() {
    return !request.controller.signal.aborted && greetingOverviewRequests.get(i) === request && greetingOverviewCache === cache &&
      getChar() === char && getGreetings(char)[i] === all[i] && greetingPreviewSource(char, all[i], i) === evaluated;
  }
  toast('正在生成中文概览…', 'info');
  request.promise = (async function () {
    try {
      var glossary = characterNameGlossary(char),
        overviewSystem =
          settingsPromptText('greetingOverviewPrompt', cfg) +
          (glossary ? '\n\n[名称表]\n' + glossary + '\n概览中的人物名称必须使用规范中文名。' : '');
      var body = {
        model: route.model,
        stream: false,
        messages: [
          { role: 'system', content: overviewSystem },
          { role: 'user', content: src },
        ],
      };
      applyThinkingForRoute(body, route, { route: 'greetingOverview' });
      var resp = await fetchCompatibleCompletion(route, body, request.controller.signal),
        out = cleanGreetingOverviewResult(getChatCompletionContent(await resp.json()));
      if (!active()) return;
      if (!out) throw new Error('结果为空');
      greetingOverviewCache[i] = out;
      renderGreetingChoices(all);
    } catch (e) {
      if (active()) toast('中文概览失败：' + e.message, 'err');
    } finally {
      if (greetingOverviewRequests.get(i) === request) greetingOverviewRequests.delete(i);
      if (releaseController) releaseController();
    }
  })();
  return request.promise;
}
function selectGreetingChoice(i) {
  greetingSelected = i;
  renderGreetingChoices(getGreetings(getChar()));
}
function greetingChoiceKey(event, i) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  selectGreetingChoice(i);
  var row = $('greeting-list').children[i];
  if (row) row.focus();
}
function resolveGreetingChoice(value) {
  cancelGreetingOverviewRequests();
  var r = greetingResolver;
  greetingResolver = null;
  greetingPreviewVars = null;
  greetingPreviewSession = null;
  greetingDisplayCache = {};
  closeModal('greeting-modal');
  if (typeof syncCardAssetObjectUrlLifecycle === 'function') syncCardAssetObjectUrlLifecycle(getChar());
  if (r) r(value);
}
function renderCardSettingsFields(char) {
  var dependencyReport = typeof analyzeCardDependencies === 'function' ? analyzeCardDependencies(char) : { items: [] };
  var risu = typeof isRisuCharacter === 'function' && isRisuCharacter(char),
    hint = document.querySelector('#card-settings-modal .hint');
  if (hint)
    hint.textContent = risu
      ? '查看这张 Risu 卡片的能力；尚未接入的能力会单独标明。'
      : '查看这张卡片的依赖和运行状态；这里的开关只作用于这张卡片。';
  if (typeof renderCardDependencyStatus === 'function') renderCardDependencyStatus(char, dependencyReport);
  // Filling the dialog before it is marked open is the one case that must ignore the visibility gate.
  if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(char, true);
  if (typeof renderMvuRuntimeStatus === 'function') renderMvuRuntimeStatus(char);
  var variableHost = $('host-variable-editor');
  if (risu && variableHost) {
    variableHost.hidden = true;
    variableHost.replaceChildren();
  }
}
function cancelCardSettings() {
  closeModal('card-settings-modal');
}
function openCardSettings() {
  var char = typeof getChar === 'function' ? getChar() : null;
  if (!char || typeof characterCanOpenCardSettings !== 'function' || !characterCanOpenCardSettings(char)) return;
  renderCardSettingsFields(char);
  if (
    !(typeof isRisuCharacter === 'function' && isRisuCharacter(char)) &&
    typeof renderHostVariableEditor === 'function'
  )
    renderHostVariableEditor();
  openModal('card-settings-modal');
}
async function confirmGreetingChoice() {
  var char = getChar(),
    all = getGreetings(char),
    index = greetingSelected;
  await queueOpeningMediaHydration(char, index);
  resolveGreetingChoice({ text: all[index] || '', index: index });
}
function appendOpeningGreeting(char, sess, greet, openingIndex, mutation) {
  if (!char || !sess || !greet) return null;
  var msg = {
    role: 'assistant',
    content: String(greet),
    time: Date.now(),
    opening: true,
    seq: allocateMessageSeq(sess),
  };
  if (typeof setOpeningMessageCandidate === 'function')
    setOpeningMessageCandidate(char, sess, msg, openingIndex, greet);
  else if (Number.isInteger(openingIndex)) msg.openingIndex = openingIndex;
  if (mutation) mutation.splice(sess.msgs, sess.msgs.length, 0, [msg]);
  else sess.msgs.push(msg);
  if (typeof markMessageMacroEffects === 'function') markMessageMacroEffects(char, msg);
  return msg;
}
// Read-only preview of the candidate set an opening message would receive. Entries that must run a
// guard before touching anything (switchOpeningGreeting) compute the model first and apply it only
// after the guard lets them through, so a refused call leaves the message exactly as it was.
function openingMessageCandidateModel(char, msg, index, fallback) {
  if (!msg) return null;
  var candidates = getGreetings(char).slice(),
    wanted = Number(index),
    fallbackText = String(fallback == null ? msg.content || '' : fallback);
  if (!candidates.length && fallbackText) candidates = [fallbackText];
  if (!Number.isInteger(wanted) || wanted < 0 || wanted >= candidates.length) {
    var matched = candidates.indexOf(fallbackText);
    wanted = matched >= 0 ? matched : 0;
  }
  return { candidates: candidates, index: wanted, content: String(candidates[wanted] || fallbackText) };
}
function setOpeningMessageCandidate(char, sess, msg, index, fallback) {
  var model = openingMessageCandidateModel(char, msg, index, fallback);
  if (!model) return null;
  msg.swipes = model.candidates;
  msg.swipeId = model.index;
  msg.openingIndex = model.index;
  msg.content = model.content;
  if (sess) sess.openingIndex = model.index;
  return { candidates: msg.swipes, index: model.index };
}
// Character and persona avatars remain blank when no image is configured.
const sanitizeText = window.YeyuPure.sanitizeText;
function promptClean(text) {
  return sanitizeText(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(function (line) {
      return line.replace(/[ \t]+$/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function displayName(role) {
  const ch = getChar && getChar();
  const p = getActivePersona && getActivePersona();
  if (role === 'char') return ch ? canonicalCharacterName(ch) : '角色';
  return p?.name || '用户';
}
function cleanGreetingOverviewResult(text) {
  return cleanAuxiliaryResponseText(text || '')
    .replace(/^```(?:\w+)?\s*/, '')
    .replace(/```\s*$/, '')
    .replace(/^\s*(中文概览|概览|输出)[:：]\s*/i, '')
    .replace(/<\/?(?:assistant|response|output)>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function completionContentPart(value, includeReasoning) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map(function (part) {
        return completionContentPart(part, includeReasoning);
      })
      .join('');
  if (typeof value !== 'object') return '';
  var type = String(value.type || '').toLowerCase();
  if (!includeReasoning && /(?:reasoning|analysis|thinking|thought)/.test(type)) return '';
  // 有些 OpenAI 兼容接口不填写 type，而是把思考放在 reasoning/thinking
  // 字段里，同时重复提供一个 text 字段。关闭思考时不能把这份 text 当成正文。
  var hasReasoningField =
    value.reasoning_content != null ||
    value.reasoning != null ||
    value.thinking != null ||
    value.analysis != null ||
    value.thought != null;
  if (!includeReasoning && hasReasoningField && value.content == null && value.output_text == null) return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string' || Array.isArray(value.content))
    return completionContentPart(value.content, includeReasoning);
  if (typeof value.output_text === 'string' || Array.isArray(value.output_text))
    return completionContentPart(value.output_text, includeReasoning);
  if (Array.isArray(value.parts)) return completionContentPart(value.parts, includeReasoning);
  if (value.message && typeof value.message === 'object') return completionContentPart(value.message, includeReasoning);
  if (Array.isArray(value.summary)) return completionContentPart(value.summary, includeReasoning);
  if (includeReasoning) {
    return (
      completionContentPart(value.reasoning_content, true) ||
      completionContentPart(value.reasoning, true) ||
      completionContentPart(value.thinking, true) ||
      completionContentPart(value.analysis, true) ||
      completionContentPart(value.thought, true)
    );
  }
  return '';
}
function getChatCompletionContent(json) {
  const choice = json && json.choices && json.choices[0];
  if (choice) {
    // 只取最终输出；reasoning_content、analysis 和 thinking 不属于翻译或结构化正文。
    var message = choice.message || {};
    var content = completionContentPart(message.content, false);
    if (content) return content;
    content =
      completionContentPart(choice.text, false) || completionContentPart(choice.delta && choice.delta.content, false);
    if (content) return content;
  }
  // 部分兼容接口使用 Responses API 风格的 output_text，不提供 choices。
  return (
    completionContentPart(json && json.output_text, false) ||
    completionContentPart(json && json.output, false) ||
    completionContentPart(json && json.content, false) ||
    completionContentPart(json && json.message, false) ||
    completionContentPart(json && json.data && json.data.output_text, false) ||
    completionContentPart(json && json.data && json.data.output, false) ||
    ''
  );
}
function getCompletionReasoningContent(json) {
  const choice = json && json.choices && json.choices[0],
    message = (choice && choice.message) || {},
    parts = [];
  function add(value) {
    var text = completionContentPart(value, true);
    if (text && parts.indexOf(text) < 0) parts.push(text);
  }
  add(message.reasoning_content);
  add(message.reasoning);
  add(message.thinking);
  add(message.analysis);
  add(message.thought);
  add(choice && choice.reasoning_content);
  add(choice && choice.reasoning);
  add(choice && choice.thinking);
  add(choice && choice.analysis);
  add(json && json.reasoning_content);
  add(json && json.reasoning);
  add(json && json.thinking);
  add(json && json.analysis);
  // 某些接口把思考块作为 content 数组的一部分，而不是单独字段。
  add(
    message.content && Array.isArray(message.content)
      ? message.content.filter(function (part) {
          return part && /(?:reasoning|analysis|thinking|thought)/i.test(String(part.type || ''));
        })
      : null
  );
  add(
    json && Array.isArray(json.output)
      ? json.output.filter(function (part) {
          return part && /(?:reasoning|analysis|thinking|thought)/i.test(String(part.type || ''));
        })
      : null
  );
  // 保留旧接口的兼容回退：当服务商把唯一输出放在 content 中时，结构化解析仍可尝试读取它。
  if (!parts.length) add(message.content);
  return parts.join('\n');
}
function getCompletionVisibleCandidateTexts(json) {
  var candidates = [];
  function add(value) {
    var text = completionContentPart(value, false);
    if (text && candidates.indexOf(text) < 0) candidates.push(text);
  }
  var choice = json && json.choices && json.choices[0],
    message = (choice && choice.message) || {};
  add(getChatCompletionContent(json));
  add(message.content);
  add(choice && choice.text);
  add(choice && choice.delta && choice.delta.content);
  if (Array.isArray(message.content))
    message.content.forEach(function (part) {
      if (!part || /(?:reasoning|analysis|thinking|thought)/i.test(String(part.type || ''))) return;
      add(part);
    });
  add(json && json.output_text);
  add(json && json.output);
  add(json && json.content);
  add(json && json.message);
  add(json && json.data && json.data.output_text);
  add(json && json.data && json.data.output);
  if (Array.isArray(json && json.output))
    json.output.forEach(function (part) {
      if (!part || /(?:reasoning|analysis|thinking|thought)/i.test(String(part.type || ''))) return;
      add(part);
    });
  return candidates;
}
function getCompletionAuxiliaryCandidateTexts(json) {
  var candidates = [];
  function add(value) {
    var text = completionContentPart(value, true);
    if (text && candidates.indexOf(text) < 0) candidates.push(text);
  }
  var choice = json && json.choices && json.choices[0],
    message = (choice && choice.message) || {};
  add(message.reasoning_content);
  add(message.reasoning);
  add(message.thinking);
  add(message.analysis);
  add(message.thought);
  add(choice && choice.reasoning_content);
  add(choice && choice.reasoning);
  add(choice && choice.thinking);
  add(choice && choice.analysis);
  add(json && json.reasoning_content);
  add(json && json.reasoning);
  add(json && json.thinking);
  add(json && json.analysis);
  if (Array.isArray(message.content))
    message.content.forEach(function (part) {
      if (part && /(?:reasoning|analysis|thinking|thought)/i.test(String(part.type || ''))) add(part);
    });
  if (Array.isArray(json && json.output))
    json.output.forEach(function (part) {
      if (part && /(?:reasoning|analysis|thinking|thought)/i.test(String(part.type || ''))) add(part);
    });
  return candidates;
}
function stripAuxiliaryReasoningBlocks(text) {
  var value = String(text || '');
  value = value.replace(
    /<\s*(?:think|thinking|analysis|reasoning|thought)\b[^>]*>[\s\S]*?<\s*\/\s*(?:think|thinking|analysis|reasoning|thought)\s*>/gi,
    ''
  );
  value = value.replace(
    /<\|(?:thinking|analysis|reasoning|thought)\|>[\s\S]*?<\|end_(?:thinking|analysis|reasoning|thought)\|>/gi,
    ''
  );
  value = value.replace(
    /\[(?:think|thinking|analysis|reasoning|thought)\][\s\S]*?\[\/(?:think|thinking|analysis|reasoning|thought)\]/gi,
    ''
  );
  // 第三方服务偶尔在 stop 时漏掉闭合标签。不要把后面的最终答案一并吞掉；
  // 有明确“最终答案”分隔时只保留分隔符后的正文，只有思考没有答案时返回空。
  var opening = /^\s*<\s*(?:think|thinking|analysis|reasoning|thought)\b[^>]*>/i.exec(value);
  if (opening) {
    var rest = value.slice(opening[0].length),
      marker =
        /(?:^|\n)\s*(?:最终答案|最终结果|最终回复|最终输出|答案|译文|翻译结果|final\s*(?:answer|response)|answer|translation|output|response)\s*[:：]\s*/i.exec(
          rest
        );
    value = marker ? rest.slice(marker.index + marker[0].length) : '';
  }
  value = value.replace(/^\s*<\|(?:assistant|final)\|>\s*/i, '');
  return value;
}
function cleanAuxiliaryResponseText(text) {
  var value = stripAuxiliaryReasoningBlocks(sanitizeText(text || ''));
  value = value.replace(/^\s*(?:最终答案|最终结果|最终回复|最终输出|中文译文|翻译结果|译文|final\s*(?:answer|response)|translation)\s*[:：]\s*/i, '');
  return value.replace(/^\s*<\/?(?:assistant|response|output|final)\s*>\s*/gi, '').trim();
}
function importLocalizationStructuredPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  var copy = Object.assign({}, value),
    found = false;
  function normalizeRow(row, id, field) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      if (field === 'entries') return { id: id, localized_name: row };
      return { id: id, zh: row, aliases: [] };
    }
    var next = Object.assign({}, row);
    if (next.id == null) next.id = next.term_id != null ? next.term_id : next.key != null ? next.key : id;
    if (field === 'terms' || field === 'labels') {
      next.zh =
        next.zh || next.translation || next.translated_text || next.localized_name || next.value || next.text || '';
      next.aliases = next.aliases || next.synonyms || [];
    } else if (field === 'entries')
      next.localized_name = next.localized_name || next.localizedName || next.translation || '';
    return next;
  }
  function rows(input, field) {
    if (Array.isArray(input))
      return input.map(function (row, index) {
        return normalizeRow(row, String(index), field);
      });
    if (input && typeof input === 'object')
      return Object.keys(input).map(function (id) {
        return normalizeRow(input[id], id, field);
      });
    return null;
  }
  ['labels', 'entries'].forEach(function (field) {
    var normalized = rows(value[field], field);
    if (normalized) {
      copy[field] = normalized;
      found = true;
    }
  });
  var terms = rows(value.terms, 'terms');
  if (!terms) terms = rows(value.translations, 'terms');
  if (terms) {
    copy.terms = terms;
    found = true;
  }
  return found ? copy : null;
}
function directStructuredPayloadForRoute(value, route) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (route === 'memorySummary') return Array.isArray(value.facts) && Array.isArray(value.scenes);
  if (route === 'importLocalization') return !!importLocalizationStructuredPayload(value);
  return true;
}
function structuredPayloadSchemaValid(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof schema === 'function') return schema(value) === true;
  if (schema === 'historySummary') return typeof value.summary === 'string' && !!value.summary.trim();
  if (schema === 'memoryStage') {
    if (
      typeof value.stage_summary !== 'string' ||
      !value.stage_summary.trim() ||
      !Array.isArray(value.long_term_entries)
    )
      return false;
    return value.long_term_entries.every(function (row) {
      return (
        !!row &&
        typeof row === 'object' &&
        !Array.isArray(row) &&
        typeof (row.type || row.category) === 'string' &&
        !!String(row.type || row.category).trim() &&
        typeof (row.content || row.text) === 'string' &&
        !!String(row.content || row.text).trim()
      );
    });
  }
  if (schema === 'branchReturn')
    return (
      typeof (value.branch_summary || value.stage_summary || value.returnBrief || value.return_brief) === 'string' &&
      !!String(value.branch_summary || value.stage_summary || value.returnBrief || value.return_brief).trim()
    );
  if (schema === 'importLocalization') return !!importLocalizationStructuredPayload(value);
  return directStructuredPayloadForRoute(value, schema || '');
}
function coerceStructuredPayloadForRoute(value, route, depth) {
  depth = Number(depth) || 0;
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return null;
  if (route === 'importLocalization') {
    var localized = importLocalizationStructuredPayload(value);
    if (localized) return localized;
  }
  if (directStructuredPayloadForRoute(value, route)) return value;
  // 兼容第三方接口常见的 result/data/output/response 包装。
  for (var key of ['result', 'data', 'output', 'response', 'json', 'parsed']) {
    if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) {
      var nested = coerceStructuredPayloadForRoute(value[key], route, depth + 1);
      if (nested) return nested;
    }
  }
  // 兼容旧版总结提示词仍返回 events 的情况，不让一次供应商切换导致总结直接失败。
  if (route === 'memorySummary' && Array.isArray(value.facts) && Array.isArray(value.events)) {
    var copy = Object.assign({}, value);
    copy.scenes = value.events.map(function (item, index) {
      item = item && typeof item === 'object' ? item : {};
      return {
        op: item.op || 'create',
        id: item.id || 'legacy_scene_' + index,
        title: item.title || item.name || '连续场景',
        source_start: item.source_start != null ? item.source_start : item.startSeq != null ? item.startSeq : 0,
        source_end: item.source_end != null ? item.source_end : item.endSeq != null ? item.endSeq : 0,
        summary: item.summary || item.content || item.event || '',
        outcome: item.outcome || '',
        open_threads: item.open_threads || item.openThreads || [],
      };
    });
    return directStructuredPayloadForRoute(copy, route) ? copy : null;
  }
  return null;
}
function getCompletionDebug(json) {
  const choice = json && json.choices && json.choices[0];
  const fr = choice && choice.finish_reason ? 'finish_reason=' + choice.finish_reason : '';
  const hasReasoning = getCompletionReasoningContent(json) ? '含辅助思考字段' : '';
  const err =
    json && json.error && (json.error.message || json.error.code)
      ? 'error=' + (json.error.message || json.error.code)
      : '';
  return [fr, hasReasoning, err].filter(Boolean).join(', ');
}
function stripGeneratedBoundaryArtifacts(text) {
  return String(text || '')
    .replace(/\[\s*作者元数据：[^\]\r\n]*\]\s*\n?/g, '')
    .replace(/〈内部可见范围[^〉]*〉\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function generatedArtifactControlTags() {
  return [
    'thinking_mode',
    'think',
    'analysis',
    'reasoning',
    'reasoning_content',
    'reasoningcontent',
    'assistant_analysis',
    'provider_meta',
    'provider_metadata',
    'generation_meta',
  ];
}
function generatedArtifactTagPatterns() {
  if (generatedArtifactTagPatterns.cache) return generatedArtifactTagPatterns.cache;
  generatedArtifactTagPatterns.cache = generatedArtifactControlTags().map(function (tag) {
    var escaped = escapeRegexText(tag),
      encodedStart = '&(?:amp;)?lt;',
      encodedEnd = '&(?:amp;)?gt;';
    return {
      open: new RegExp('<\\s*' + escaped + '\\b[^>]*>', 'i'),
      close: new RegExp('<\\s*\\/\\s*' + escaped + '\\s*>', 'i'),
      entityOpen: new RegExp(encodedStart + '\\s*' + escaped + '\\b[^&]*?' + encodedEnd, 'i'),
      entityClose: new RegExp(encodedStart + '\\s*\\/\\s*' + escaped + '\\s*' + encodedEnd, 'i'),
      paired: new RegExp('<\\s*' + escaped + '\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*' + escaped + '\\s*>', 'gi'),
      encoded: new RegExp(
        encodedStart +
          '\\s*' +
          escaped +
          '\\b[^&]*?' +
          encodedEnd +
          '[\\s\\S]*?' +
          encodedStart +
          '\\s*\\/\\s*' +
          escaped +
          '\\s*' +
          encodedEnd,
        'gi'
      ),
      openTail: new RegExp('<\\s*' + escaped + '\\b[^>]*>[\\s\\S]*$', 'i'),
      entityOpenTail: new RegExp(encodedStart + '\\s*' + escaped + '\\b[^&]*?' + encodedEnd + '[\\s\\S]*$', 'i'),
      orphan: new RegExp(
        '(?:<|' + encodedStart + ')\\s*\\/?\\s*' + escaped + '\\b[^>]*?(?:>|' + encodedEnd + ')',
        'gi'
      ),
    };
  });
  return generatedArtifactTagPatterns.cache;
}
function sanitizeGeneratedVisibleContent(text, context) {
  context = context || {};
  var source = String(text == null ? '' : text),
    parts = source.split(/((?:\x60){3}[\s\S]*?(?:\x60){3})/g),
    removed = false;
  function replaceTracked(value, pattern) {
    var next = value.replace(pattern, ' ');
    if (next !== value) removed = true;
    return next;
  }
  function cleanSegment(part) {
    var clean = String(part || '');
    generatedArtifactTagPatterns().forEach(function (patterns) {
      clean = replaceTracked(clean, patterns.paired);
      clean = replaceTracked(clean, patterns.encoded);
      if (
        (patterns.open.test(clean) && !patterns.close.test(clean)) ||
        (patterns.entityOpen.test(clean) && !patterns.entityClose.test(clean))
      ) {
        removed = true;
        clean = clean.replace(patterns.openTail, ' ').replace(patterns.entityOpenTail, ' ');
      }
      clean = replaceTracked(clean, patterns.orphan);
    });
    var boundary =
        /[〈<\[]\s*(?:内部可见范围(?:\s*索引)?|知识边界(?:\s*索引)?|internal\s+(?:visibility|boundary))[^〉>\]\r\n]*[〉>\]]/gi,
      partialBoundary =
        /[〈<\[]\s*(?:内部可见范围(?:\s*索引)?|知识边界(?:\s*索引)?|internal\s+(?:visibility|boundary))[^〉>\]\r\n]*(?:\r?\n|$)/gi,
      indexLine =
        /^\s*(?:\[\s*)?(?:内部可见范围索引\s*\/\s*不得输出|内部(?:可见范围|索引|边界)[^\r\n]*|知识边界(?:索引)?[^\r\n]*|(?:[-*]\s*)?(?:seq|index)\s*=\s*\d+[^\r\n]*(?:未列出者按未知处理|内部|可见范围)[^\r\n]*)\]?\s*$/gim,
      protocolLine =
        /^\s*(?:未列出者按未知处理。?|\[?(?:生成协议|内部轮次|调试|provider[_ ]?(?:debug|meta)|visibility[_ ]?scope)[^\r\n]*\]?)\s*$/gim;
    clean = replaceTracked(clean, boundary);
    clean = replaceTracked(clean, partialBoundary);
    clean = replaceTracked(clean, indexLine);
    clean = replaceTracked(clean, protocolLine);
    return clean;
  }
  var result = parts
    .map(function (part, index) {
      return index % 2 ? part : cleanSegment(part);
    })
    .join('');
  if (
    (removed || context.thinkingArtifact === true || context.fromProvider === true) &&
    /^\s*enabled(?=\s*(?:\r?\n|$|[：:\-]))/i.test(result)
  )
    result = result.replace(/^\s*enabled\s*(?:\r?\n)?/i, '');
  return stripGeneratedBoundaryArtifacts(result)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// 生成元数据只持久化状态标记，读回时按同一规则清洗；空结果返回 null。
function sanitizeLoadedGenerationMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  var next = {};
  if (meta.incomplete === true) next.incomplete = true;
  if (meta.outputLimitReached === true) next.outputLimitReached = true;
  var providerStopReason = providerInterceptedFinishReason(meta.providerStopReason);
  if (providerStopReason) next.providerStopReason = providerStopReason;
  if (meta.sourceDraftId) next.sourceDraftId = String(meta.sourceDraftId);
  var interruptionReason = String(meta.interruptionReason || '');
  if (next.incomplete && GENERATION_INTERRUPTION_KINDS.includes(interruptionReason)) {
    next.interruptionReason = interruptionReason;
    var interruptionStatus = Math.floor(Number(meta.interruptionStatus) || 0),
      interruptionDetail = String(meta.interruptionDetail || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
    if (interruptionStatus >= 100 && interruptionStatus <= 599) next.interruptionStatus = interruptionStatus;
    if (interruptionDetail) next.interruptionDetail = interruptionDetail;
  }
  return Object.keys(next).length ? next : null;
}
function sanitizeLoadedAssistantMessages(sess) {
  if (!sess || !Array.isArray(sess.msgs)) return false;
  var changed = false;
  (sess.msgs || []).forEach(function (msg) {
    if (!msg || msg.role !== 'assistant') return;
    if (msg.generationMeta && typeof msg.generationMeta === 'object') {
      var next = sanitizeLoadedGenerationMeta(msg.generationMeta);
      if (!next) {
        delete msg.generationMeta;
        changed = true;
      } else if (JSON.stringify(next) !== JSON.stringify(msg.generationMeta)) {
        msg.generationMeta = next;
        changed = true;
      }
    }
    // 候选级元数据（见 messageSwipeStashGenerationMeta）逐格按同一规则清洗，超出候选数的格子去掉。
    if (Object.prototype.hasOwnProperty.call(msg, 'swipeGenerationMeta')) {
      var count = Array.isArray(msg.swipes) ? msg.swipes.length : 0,
        slots = Array.isArray(msg.swipeGenerationMeta)
          ? Array.from(msg.swipeGenerationMeta.slice(0, count), sanitizeLoadedGenerationMeta)
          : null;
      if (!slots) {
        delete msg.swipeGenerationMeta;
        changed = true;
      } else if (JSON.stringify(slots) !== JSON.stringify(msg.swipeGenerationMeta)) {
        msg.swipeGenerationMeta = slots;
        changed = true;
      }
    }
  });
  return changed;
}
// Markdown 折叠的思考块必须和 splitAssistantResponseText 认的是同一对标记，
// 否则换成自定义模板后，正文里会留下一段既没被拆走、也没被折叠的思考内容。
function reasoningDisplayMarkers() {
  var template = typeof stscriptActiveReasoningTemplate === 'function' ? stscriptActiveReasoningTemplate() : null,
    prefix = String((template && template.prefix) || ''),
    suffix = String((template && template.suffix) || '');
  return prefix && suffix ? { prefix: prefix, suffix: suffix } : { prefix: '<think>', suffix: '</think>' };
}
function reasoningDisplayPattern() {
  var markers = reasoningDisplayMarkers();
  return new RegExp(escapeRegexText(markers.prefix) + '([\\s\\S]*?)' + escapeRegexText(markers.suffix), 'gi');
}
function splitAssistantResponseText(text) {
  var configured =
      typeof stscriptParseReasoningText === 'function' ? stscriptParseReasoningText(String(text || ''), false) : null,
    pure = window.YeyuPure,
    parts =
      configured ||
      (pure && typeof pure.splitReasoningContent === 'function'
        ? pure.splitReasoningContent(text)
        : {
            content: String(text || '')
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .trim(),
            reasoning: '',
          });
  return { content: String(parts.content || '').trim(), reasoning: String(parts.reasoning || '').trim() };
}
function normalizeReasoningText(text) {
  var parts = splitAssistantResponseText(text);
  return (parts.reasoning || parts.content).trim();
}
function joinReasoningText(first, second) {
  first = normalizeReasoningText(first);
  second = normalizeReasoningText(second);
  if (!first) return second;
  if (!second || second === first) return first;
  if (first.indexOf(second) >= 0) return first;
  if (second.indexOf(first) >= 0) return second;
  return first + '\n\n' + second;
}
// 思考是当前候选自己的：消息级思考不属于当前候选的旧数据（见 messageLegacySwipeOwner）只显示正文里的思考标签。
function messageOwnReasoningFields(message) {
  return message && (typeof messageOwnsSwipeField !== 'function' || messageOwnsSwipeField(message, 'swipeReasoning'))
    ? message
    : null;
}
function assistantMessageParts(message) {
  var split = splitAssistantResponseText((message && message.content) || ''),
    own = messageOwnReasoningFields(message),
    reasoning = joinReasoningText((own && own.reasoning) || '', split.reasoning);
  return { content: split.content, reasoning: reasoning };
}
// `live` is the streaming view of the block: it carries the elapsed thinking time and the expansion
// the reader chose during this reply, which the repaint has to hand back so the title can change
// without reopening or closing the block.
// 保存下来的思考用时让提交前后是同一个块：有它就沿用流式末尾的「已思考 N 秒」并默认折叠，没有它
// 的旧消息保持原来的「思考过程」和默认展开。
function reasoningDurationSeconds(message) {
  var ms = Number(message && message.reasoningMs);
  return ms > 0 ? Math.max(0, Math.round(ms / 1000)) : -1;
}
function reasoningTimerText(live) {
  return Math.max(0, Math.round(Number(live && live.seconds) || 0)) + ' 秒';
}
// The head reads 思考中 with three dots and a running timer while the model thinks (the stream ticker
// rewrites only .think-timer), then 已思考 N 秒; old messages without a duration keep 思考过程.
function reasoningBlockHeadHtml(live, message) {
  var thinking = !!(live && live.thinking),
    seconds = live ? -1 : reasoningDurationSeconds(message),
    title = thinking
      ? '思考中<span class="think-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
      : live
        ? '已思考 ' + reasoningTimerText(live)
        : seconds >= 0
          ? '已思考 ' + seconds + ' 秒'
          : '思考过程';
  return (
    '<span class="think-head"><svg class="ui-icon think-icon" aria-hidden="true"><use href="#i-bulb" xlink:href="#i-bulb"></use></svg>' +
    '<span class="think-title">' +
    title +
    '</span>' +
    (thinking ? '<span class="think-timer">' + reasoningTimerText(live) + '</span>' : '') +
    '</span>'
  );
}
// The collapsed card previews one line: the newest while the model is still thinking, the opening
// line once it is done. CSS clips it to one line; the cap only keeps the summary small.
function reasoningPreviewLine(reasoning, latest) {
  var lines = reasoning.split(/\r\n?|\n/).map(function (line) {
      return line.trim();
    }).filter(Boolean),
    line = (latest ? lines[lines.length - 1] : lines[0]) || '';
  return line.length > 160 ? line.slice(0, 160) : line;
}
function reasoningBlockHtml(reasoning, message, live) {
  reasoning = normalizeReasoningText(reasoning);
  if (!D.settings.showThinking || !reasoning) return '';
  message = messageOwnReasoningFields(message);
  var thinking = !!(live && live.thinking),
    open = live
      ? live.open === true
      : reasoningDurationSeconds(message) >= 0
        ? message.reasoningCollapsed === false
        : !(message && message.reasoningCollapsed === true);
  return (
    '<details class="think-block" data-reasoning-details="true"' +
    (thinking ? ' data-thinking="true"' : '') +
    (open ? ' open' : '') +
    '><summary>' +
    reasoningBlockHeadHtml(live, message) +
    '<span class="think-preview">' +
    esc(reasoningPreviewLine(reasoning, thinking)) +
    '</span></summary><div class="think-body">' +
    esc(reasoning).replace(/\r\n?|\n/g, '<br>') +
    '</div></details>'
  );
}
// Remove hidden author/multimodal notes that should not appear in chat UI. A comment may contain
// '>', so it has to go before anything that treats '<...>' as a tag. Message search reads the same
// function, otherwise it finds words the page does not show.
function stripHiddenDisplayNotes(text) {
  return String(text == null ? '' : text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*note\b[\s\S]*?<\s*\/\s*note\s*>/gi, '');
}
// 角色消息需要显示当前名称。Every bracket and case variant the display accepts, shared with message
// search so searching a name finds the messages that show it.
function replaceDisplayNameMacros(text) {
  const userName = displayName('user');
  const charName = displayName('char');
  return String(text == null ? '' : text)
    .replace(/[｛{]\s*[｛{]?\s*user\s*[｝}]?\s*[｝}]/gi, userName)
    .replace(/[｛{]\s*[｛{]?\s*char\s*[｝}]?\s*[｝}]/gi, charName)
    .replace(/[｛{]\s*[｛{]?\s*User\s*[｝}]?\s*[｝}]/g, userName)
    .replace(/[｛{]\s*[｛{]?\s*Char\s*[｝}]?\s*[｝}]/g, charName);
}
function cleanDisplayText(text, role, options) {
  options = options || {};
  let t = sanitizeText(text || '');
  if (role === 'assistant') {
    t = sanitizeGeneratedVisibleContent(splitAssistantResponseText(t).content, { fromProvider: true });
    if (typeof stripMvuProtocolForDisplay === 'function')
      t = stripMvuProtocolForDisplay(t, options.char || (typeof getChar === 'function' ? getChar() : null));
  }
  t = stripHiddenDisplayNotes(t);
  // HTML and media stay in the display copy until md() sanitizes and namespaces them.
  if (!options.preservePlaceholders) t = replaceDisplayNameMacros(t);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
function relativeTime(ts) {
  if (!ts) return '';
  var diff = Date.now() - ts;
  var sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  var min = Math.floor(sec / 60);
  if (min < 60) return min + '分钟前';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + '小时前';
  var day = Math.floor(hr / 24);
  if (day < 30) return day + '天前';
  return new Date(ts).toLocaleDateString('zh-CN');
}
// A 24-hour clock time ("21:05"); the day is carried by the chat's day dividers.
function clockTime(ts) {
  if (!ts) return '';
  var date = new Date(ts);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}
// A message's time: bubbles show the clock time, immersive text the relative time (chat.css picks one).
// Empty when the message has no time; the renderer then marks the bubble meta-empty (messageMetaLayoutClass) to hide the row.
function messageTimeHtml(ts) {
  return ts
    ? '<span class="msg-time"><span class="msg-clock">' +
        clockTime(ts) +
        '</span><span class="msg-ago">' +
        relativeTime(ts) +
        '</span></span>'
    : '<span class="msg-time"></span>';
}
var estTokens =
  typeof window !== 'undefined' && window.YeyuPure
    ? window.YeyuPure.estTokens
    : typeof globalThis !== 'undefined' && globalThis.YeyuPure
      ? globalThis.YeyuPure.estTokens
      : undefined;
function trimToTokenBudget(text, maxTokens) {
  text = text || '';
  maxTokens = parseInt(maxTokens) || 0;
  if (maxTokens <= 0) return text;
  if (estTokens(text) <= maxTokens) return text;
  var chars = Array.from(text),
    suffix = '\n[已按 Token 预算截断]',
    low = 0,
    high = chars.length,
    best = '';
  if (estTokens(suffix) > maxTokens) return window.YeyuPure.trimToTokenBudget(text, maxTokens);
  while (low <= high) {
    var mid = Math.floor((low + high) / 2),
      candidate = chars.slice(0, mid).join('').replace(/\s+$/, '') + suffix;
    if (estTokens(candidate) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else high = mid - 1;
  }
  return best || suffix;
}
function estimateReplyTokens() {
  return 8192;
}
function providerCacheHitTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  var nested = [usage.prompt_tokens_details, usage.input_tokens_details],
    fields = [
      usage.prompt_cache_hit_tokens,
      usage.cache_read_input_tokens,
      usage.cached_content_token_count,
      usage.cachedContentTokenCount,
    ];
  nested.forEach(function (details) {
    if (details && typeof details === 'object') fields.push(details.cached_tokens);
  });
  for (var i = 0; i < fields.length; i++) {
    if (
      fields[i] !== undefined &&
      fields[i] !== null &&
      fields[i] !== '' &&
      Number.isFinite(Number(fields[i])) &&
      Number(fields[i]) >= 0
    )
      return Number(fields[i]);
  }
  return null;
}
function mergeUsageTotals(total, usage) {
  total = total || { prompt: 0, maxPrompt: 0, completion: 0, totalTokens: 0, requestCount: 0 };
  if (!usage) return total;
  var cacheHit =
    usage.providerCacheHitTokens != null ? Number(usage.providerCacheHitTokens) : providerCacheHitTokens(usage);
  total.requestCount = (Number(total.requestCount) || 0) + Math.max(1, Number(usage.requestCount) || 1);
  if (Number.isFinite(cacheHit) && cacheHit >= 0)
    total.providerCacheHitTokens = (Number(total.providerCacheHitTokens) || 0) + cacheHit;
  if (usage.prompt_tokens == null && usage.prompt != null) {
    var mergedPrompt = Number(usage.prompt) || 0;
    total.prompt += mergedPrompt;
    total.maxPrompt = Math.max(Number(total.maxPrompt) || 0, Number(usage.maxPrompt) || mergedPrompt);
    total.completion += Number(usage.completion) || 0;
    total.totalTokens += Number(usage.totalTokens) || 0;
    return total;
  }
  var prompt = Number(usage.prompt_tokens) || 0;
  total.prompt += prompt;
  total.maxPrompt = Math.max(Number(total.maxPrompt) || 0, prompt);
  total.completion += Number(usage.completion_tokens) || 0;
  total.totalTokens += Number(usage.total_tokens) || 0;
  return total;
}
function publishUsage(usage, target) {
  var sessionId = (target && target.sessionId) || '';
  if (typeof _providerCacheUsageBySession !== 'undefined' && sessionId) {
    delete _providerCacheUsageBySession[sessionId];
    var cacheHit = usage && Number(usage.providerCacheHitTokens);
    if (usage && usage.providerCacheHitTokens != null && Number.isFinite(cacheHit) && cacheHit >= 0)
      _providerCacheUsageBySession[sessionId] = {
        providerCacheHitTokens: cacheHit,
        requestCount: Math.max(1, Number(usage.requestCount) || 1),
      };
  }
  if (!usage) return;
  D.settings.lastRequestUsage = {
    prompt: Number(usage.prompt) || 0,
    contextPrompt: Number(usage.maxPrompt) || Number(usage.prompt) || 0,
    completion: Number(usage.completion) || 0,
    totalTokens: Number(usage.totalTokens) || 0,
    requestCount: Math.max(1, Number(usage.requestCount) || 1),
    charId: (target && target.charId) || '',
    sessionId: sessionId,
    time: Date.now(),
  };
  delete D.settings.lastCacheUsage;
  saveData('meta');
}

// Markdown and semantic text render. One scanner is shared by the final and streaming paths.
function semanticSegmentBody(raw, type) {
  raw = String(raw || '');
  if (type === 'narration') {
    if (raw[0] === '*') raw = raw.slice(1);
    if (raw.endsWith('*')) raw = raw.slice(0, -1);
  } else if (type === 'bold') {
    if (raw.indexOf('**') === 0) raw = raw.slice(2);
    if (raw.endsWith('**')) raw = raw.slice(0, -2);
  } else if (type === 'code') {
    if (raw.indexOf('```') === 0) {
      raw = raw.replace(/^```[^\r\n]*\r?\n?/, '').replace(/```$/, '');
    } else if (raw[0] === '`') raw = raw.slice(1).replace(/`$/, '');
  }
  var body = esc(raw);
  if (type === 'plain') body = body.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return body.replace(/\r\n?|\n/g, '<br>');
}
function semanticMarkupHtml(text, role, closeOpenMarkers) {
  var p = pureApi(),
    linked = p && p.markdownLinks
      ? p.markdownLinks(text, closeOpenMarkers === true)
      : { text: String(text || ''), links: [] },
    segments = p && p.semanticSegments
      ? p.semanticSegments(linked.text, closeOpenMarkers === true)
      : [{ type: 'plain', text: String(text || '') }],
    output = '',
    isAssistant = role === 'assistant';
  segments.forEach(function (seg) {
    var type = seg.type || 'plain',
      cls = type === 'bracket' ? (isAssistant ? 'tone-invalid-directive' : 'tone-bracket') : 'tone-' + type;
    if (type === 'code') {
      var code = semanticSegmentBody(seg.text, type);
      output +=
        seg.marker === '`'
          ? '<code class="semantic-inline-code">' + code + '</code>'
          : '<pre><code>' + code + '</code></pre>';
      return;
    }
    output += '<span class="' + cls + '">' + semanticSegmentBody(seg.text, type) + '</span>';
  });
  return output.replace(/(\d+)/g, function (slot, index) {
    var link = linked.links[Number(index)];
    if (!link) return slot;
    return /^https?:\/\//i.test(link.url)
      ? '<a href="' + escAttr(link.url) + '" target="_blank" rel="noopener noreferrer">' + esc(link.label) + '</a>'
      : esc(link.raw);
  });
}
// Block Markdown around the semantic scanner (YeyuPure.markdownBlocks). Only fixed tags with escaped text
// and http(s) links are generated here; card HTML never reaches this path, it stays in the sanitised fragment.
function markdownInlineHtml(text, role, closeOpenMarkers) {
  return semanticMarkupHtml(text, role, closeOpenMarkers);
}
function markdownBlocksHtml(blocks, role, closeOpenMarkers) {
  // `open` reaches only the last text of the block, where a streaming prefix is still being written.
  function listHtml(list, open) {
    var tag = list.ordered ? 'ol' : 'ul',
      start = list.ordered ? Number(list.start) : 1;
    return (
      '<' +
      tag +
      (isFinite(start) && start !== 1 ? ' start="' + start + '"' : '') +
      '>' +
      list.items
        .map(function (item, index) {
          var last = open && index === list.items.length - 1;
          return (
            '<li>' +
            markdownInlineHtml(item.text, role, last && !item.lists.length) +
            item.lists
              .map(function (nested, nestedIndex) {
                return listHtml(nested, last && nestedIndex === item.lists.length - 1);
              })
              .join('') +
            '</li>'
          );
        })
        .join('') +
      '</' +
      tag +
      '>'
    );
  }
  function cellHtml(tag, text, align, open) {
    return (
      '<' +
      tag +
      (align ? ' style="text-align:' + align + '"' : '') +
      '>' +
      markdownInlineHtml(text, role, open) +
      '</' +
      tag +
      '>'
    );
  }
  return blocks
    .map(function (block, index) {
      // A streaming prefix only closes markers in its last piece of text, as the plain renderer does.
      var open = closeOpenMarkers && index === blocks.length - 1;
      if (block.type === 'text') return markdownInlineHtml(block.text, role, open);
      if (block.type === 'heading')
        return '<h' + block.level + '>' + markdownInlineHtml(block.text, role, open) + '</h' + block.level + '>';
      if (block.type === 'rule') return '<hr>';
      if (block.type === 'quote')
        return '<blockquote>' + markdownBlocksHtml(block.blocks, role, open) + '</blockquote>';
      if (block.type === 'list') return listHtml(block, open);
      return (
        '<table class="msg-md-table"><thead><tr>' +
        block.head
          .map(function (text, column) {
            return cellHtml(
              'th',
              text,
              block.align[column],
              open && !block.rows.length && column === block.head.length - 1
            );
          })
          .join('') +
        '</tr></thead><tbody>' +
        block.rows
          .map(function (row, rowIndex) {
            var lastRow = open && rowIndex === block.rows.length - 1;
            return (
              '<tr>' +
              block.head
                .map(function (_, column) {
                  return cellHtml('td', row[column] || '', block.align[column], lastRow && column === row.length - 1);
                })
                .join('') +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table>'
      );
    })
    .join('');
}
// edges.leadInline / trailInline: the text shares its first or last source line with an inline element.
function semanticBlocksHtml(text, role, closeOpenMarkers, edges) {
  var p = pureApi(),
    source = String(text || ''),
    blocks =
      p && p.markdownBlocks
        ? p.markdownBlocks(source, {
            includeOpen: closeOpenMarkers === true,
            leadInline: !!(edges && edges.leadInline),
            trailInline: !!(edges && edges.trailInline),
          })
        : null;
  if (!blocks || (blocks.length === 1 && blocks[0].type === 'text' && blocks[0].text === source))
    return markdownInlineHtml(source, role, closeOpenMarkers);
  return markdownBlocksHtml(blocks, role, closeOpenMarkers);
}
// Elements after which a text node starts on its own line (and before which it ends one).
var MARKDOWN_LINE_BREAKING_TAGS =
  /^(?:ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DETAILS|DIALOG|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|STYLE|SUMMARY|TABLE|UL)$/;
function markdownSharesLine(node) {
  return !!node && !(node.nodeType === 1 && MARKDOWN_LINE_BREAKING_TAGS.test(node.nodeName));
}
function semanticStreamHtml(text, role, options) {
  var actualRole = role || 'assistant',
    source = actualRole === 'assistant' ? stripGeneratedBoundaryArtifacts(text) : String(text || '');
  if (options) return md(source, Object.assign({ role: actualRole }, options));
  return md(source, { role: actualRole });
}
function cardImageHtml(ref, options) {
  var assets = options && Array.isArray(options.mediaAssets) ? options.mediaAssets : [],
    wanted = normalizeRemoteCardUrl(ref && ref.url) || String((ref && ref.url) || '').trim(),
    asset = findCardMediaAsset(assets, wanted),
    src = cardAssetDisplaySrc(asset, options && options.mediaOwnerId);
  if (asset && asset.status === 'pending' && !src) return '<span class="card-inline-image-loading">[图片加载中]</span>';
  if (asset && asset.status === 'failed' && !src)
    return (
      '<span class="card-inline-image-missing card-inline-image-retry"><span>' +
      (ref.alt ? '“' + esc(ref.alt) + '”图片加载失败' : '图片加载失败') +
      '</span><button type="button" class="btn sm" onclick="retryOpeningMediaAsset(' +
      jsArg(wanted) +
      ')">重新加载</button></span>'
    );
  if (!src && safeImage(ref.url, true)) src = safeImage(ref.url, true);
  if (!src) src = remoteImageUrl(String((ref && ref.url) || '').replace(/\s+/g, ''));
  if (src) {
    var dimensions = cardAssetDimensions(asset),
      layoutBlob = asset && cardAssetLayoutBlob(asset);
    if (asset && !dimensions && layoutBlob && !_cardAssetDimensionFailures.has(asset)) {
      prepareCardAssetDimensions(asset).then(function () {
        if (typeof _activeStreamRepaint === 'function' && _activeStreamRepaint()) return;
        if (typeof requestCardScriptRerender === 'function') requestCardScriptRerender();
      });
      return '';
    }
    var size =
        dimensions && dimensions.width > 0 && dimensions.height > 0
          ? ' width="' + dimensions.width + '" height="' + dimensions.height + '"'
          : '',
      style = 'max-width:100%;height:auto;display:block;margin:.55em auto',
      remote = remoteImageUrl(src);
    if (ref.width) style += ';width:' + ref.width;
    if (ref.radius) style += ';border-radius:' + ref.radius;
    return (
      '<img class="card-inline-image yeyu-card-media yeyu-card-image" src="' +
      escAttr(src) +
      '" alt="' +
      escAttr(ref.alt || '图片') +
      '"' +
      (remote ? ' data-yeyu-src="' + escAttr(remote) + '"' : '') +
      ' loading="eager" decoding="async"' +
      size +
      ' style="' +
      style +
      '">'
    );
  }
  return '<span class="card-inline-image-missing">[' + (ref.alt ? '图片：' + esc(ref.alt) : '图片') + ']</span>';
}
function richDisplayUrl(value) {
  var url = window.YeyuPure.decodeAttrText(value).replace(/\s+/g, '').trim();
  return remoteImageUrl(url);
}
var RichDisplay = (function () {
  var MEDIA_TIMEOUT_MS = 15000,
    mediaTimers = typeof WeakMap === 'function' ? new WeakMap() : null,
    mediaWatched = typeof WeakSet === 'function' ? new WeakSet() : null;
  function hashText(value) {
    var hash = 2166136261,
      text = String(value || '');
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  // Class and id tokens of a selector: identifier characters, non-ASCII and CSS escapes.
  var SELECTOR_NAME = /([.#])((?:[A-Za-z0-9_\u00A0-\uFFFF-]|\\[0-9A-Fa-f]{1,6}[ \t\n\r\f]?|\\[^\r\n\f0-9A-Fa-f])+)/g,
    SELECTOR_ID = /#(?:[A-Za-z0-9_\u00A0-\uFFFF-]|\\[^\r\n\f])/;
  function unescapeCssName(value) {
    return String(value || '').replace(
      /\\([0-9A-Fa-f]{1,6})[ \t\n\r\f]?|\\([^\r\n\f0-9A-Fa-f])/g,
      function (_, hex, char) {
        if (!hex) return char;
        var code = parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
      }
    );
  }
  // A class name depends only on the scope and the card's own name, so one card stylesheet maps to
  // the same names in every message that carries it.
  function scopedClassName(namespace, name) {
    return 'yeyu-card-' + namespace + '-c' + hashText(name);
  }
  function scopeSelectorList(value, context) {
    var source = String(value || ''),
      scope = context.scope,
      parts = [],
      start = 0,
      depth = 0,
      quote = '';
    for (var i = 0; i <= source.length; i++) {
      var char = source[i] || ',';
      if (quote) {
        if (char === quote && source[i - 1] !== '\\') quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
      else if (char === ',' && depth === 0) {
        parts.push(source.slice(start, i));
        start = i + 1;
      }
    }
    return parts
      .map(function (part) {
        var selector = part.trim().replace(SELECTOR_NAME, function (_, marker, raw) {
          var name = unescapeCssName(raw);
          if (marker === '.') return '.' + scopedClassName(context.namespace, name);
          if (!context.idMap[name])
            context.idMap[name] = 'yeyu-card-' + context.namespace + '-i' + Object.keys(context.idMap).length;
          return '#' + context.idMap[name];
        });
        selector = selector
          .replace(/:root\b/gi, '.' + scope)
          .replace(/(^|[\s>+~,(])(html|body)(?=$|[^A-Za-z0-9_-])/gi, '$1.' + scope)
          .replace(context.repeatedScope, '.' + scope);
        if (!selector) return '';
        if (selector.indexOf('.' + scope) !== 0) selector = '.' + scope + ' ' + selector;
        return selector;
      })
      .filter(Boolean)
      .join(',');
  }
  function replaceNames(value, map) {
    var output = String(value || '');
    Object.keys(map)
      .sort(function (a, b) {
        return b.length - a.length;
      })
      .forEach(function (name) {
        var replacement = map[name],
          quoted = new RegExp('(["\\\'])' + escapeRegexText(String(name || '')) + '\\1', 'g');
        output = output
          .replace(quoted, '"' + replacement + '"')
          .replace(
            new RegExp('(^|[^A-Za-z0-9_-])' + escapeRegexText(String(name || '')) + '(?=$|[^A-Za-z0-9_-])', 'g'),
            '$1' + replacement
          );
      });
    return output;
  }
  function declarationText(style, names, important) {
    var rows = [];
    if (!style) return '';
    for (var i = 0; i < style.length; i++) {
      var property = style.item(i),
        value = style.getPropertyValue(property);
      if (!property || !value) continue;
      if (
        property === 'behavior' ||
        /expression\s*\(|javascript\s*:/i.test(value) ||
        (property === 'position' && /\bfixed\b/i.test(value))
      )
        continue;
      if (/^animation(?:-name)?$/i.test(property)) value = replaceNames(value, names.keyframes);
      if (/^font(?:-family)?$/i.test(property)) value = replaceNames(value, names.fonts);
      rows.push(
        property +
          ':' +
          value +
          (important ? ' !important' : style.getPropertyPriority(property) ? ' !important' : '') +
          ';'
      );
    }
    return rows.join('');
  }
  function escapeCssHtmlBoundary(value) {
    // CSSOM can decode \3c back to '<'; keep serialized HTML from closing a <style> tag.
    return String(value || '').replace(/</g, '\\3c ');
  }
  function keyframeRule(rule) {
    return rule && rule.name && rule.cssRules && /^@(?:-webkit-)?keyframes\b/i.test(String(rule.cssText || ''));
  }
  function collectCssNames(rules, names, namespace) {
    Array.from(rules || []).forEach(function (rule) {
      if (keyframeRule(rule)) {
        if (!names.keyframes[rule.name])
          names.keyframes[rule.name] = 'yeyu-kf-' + namespace + '-' + Object.keys(names.keyframes).length;
        return;
      }
      if (rule.type === 5 && rule.style) {
        var family = String(rule.style.getPropertyValue('font-family') || '')
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (family && !names.fonts[family])
          names.fonts[family] = 'yeyu-font-' + namespace + '-' + Object.keys(names.fonts).length;
      } else if (rule.cssRules) collectCssNames(rule.cssRules, names, namespace);
    });
  }
  function serializeCssRules(rules, context, names) {
    var output = '';
    Array.from(rules || []).forEach(function (rule) {
      if (keyframeRule(rule)) {
        var frames = Array.from(rule.cssRules || [])
          .map(function (frame) {
            return frame.keyText + '{' + declarationText(frame.style, names, false) + '}';
          })
          .join('');
        output += '@keyframes ' + names.keyframes[rule.name] + '{' + frames + '}';
        return;
      }
      if (rule.type === 1 && rule.style) {
        var selector = scopeSelectorList(rule.selectorText, context);
        if (selector) output += selector + '{' + declarationText(rule.style, names, true) + '}';
        return;
      }
      if (rule.type === 5 && rule.style) {
        output += '@font-face{' + declarationText(rule.style, names, false) + '}';
        return;
      }
      if (rule.cssRules) {
        var header = String(rule.cssText || '')
          .split('{')[0]
          .trim();
        if (/^@(media|supports|container)\b/i.test(header))
          output += header + '{' + serializeCssRules(rule.cssRules, context, names) + '}';
      }
    });
    return output;
  }
  // Rules are read right after parsing, so one detached document serves every stylesheet.
  var cssParser = null,
    sharedCss = new Map(),
    SHARED_CSS_LIMIT = 64;
  function parsedCssRules(css) {
    if (!cssParser) {
      var cssDocument = document.implementation.createHTMLDocument('');
      cssParser = cssDocument.head.appendChild(cssDocument.createElement('style'));
    }
    cssParser.textContent = css;
    return cssParser.sheet ? cssParser.sheet.cssRules : null;
  }
  function cssSelectsIds(rules) {
    return Array.from(rules || []).some(function (rule) {
      return (rule.type === 1 && SELECTOR_ID.test(String(rule.selectorText || ''))) || cssSelectsIds(rule.cssRules);
    });
  }
  // The scope of rich content follows its stylesheet: the same card CSS gets the same scope, class
  // names and rewritten text in every message. Ids stay unique to the message, since a shared id
  // would send labels and in-page links to another message, so CSS selecting ids keeps its own scope.
  function cssScopePlan(css, messageNamespace) {
    var shared = sharedCss.get(css);
    if (shared) {
      sharedCss.delete(css);
      sharedCss.set(css, shared);
      return { css: css, namespace: shared.namespace, rewritten: shared };
    }
    var rules = parsedCssRules(css),
      perMessage = !!rules && cssSelectsIds(rules);
    return { css: css, namespace: perMessage ? messageNamespace : hashText(css), rules: rules, shared: !perMessage };
  }
  function rewriteCss(plan, scope, idMap) {
    if (plan.rewritten) return plan.rewritten;
    var names = { keyframes: Object.create(null), fonts: Object.create(null) },
      scopePattern = escapeRegexText(scope),
      context = {
        scope: scope,
        namespace: plan.namespace,
        idMap: idMap,
        repeatedScope: new RegExp('\\.' + scopePattern + '(?:\\s+\\.' + scopePattern + ')+', 'g'),
      },
      result = { namespace: plan.namespace, css: '', names: names };
    if (plan.rules) {
      collectCssNames(plan.rules, names, plan.namespace);
      result.css = escapeCssHtmlBoundary(serializeCssRules(plan.rules, context, names));
    }
    if (plan.shared) {
      sharedCss.set(plan.css, result);
      if (sharedCss.size > SHARED_CSS_LIMIT) sharedCss.delete(sharedCss.keys().next().value);
    }
    return result;
  }
  function mediaSource(value, kind) {
    return safeCardMediaSource(value, kind, true);
  }
  function missingMedia(kind, label) {
    var failed = document.createElement('span');
    failed.className = 'yeyu-card-media-missing';
    failed.textContent = label || (kind === 'audio' ? '音频' : '图片') + '链接不可用';
    return failed;
  }
  function missingImage(alt) {
    return missingMedia('image', alt ? '“' + alt + '”图片链接不可用' : '图片链接不可用');
  }
  function missingMediaStyle() {
    // Scriptless card frames use the same rule as ordinary rich content.
    for (var sheet of Array.from(document.styleSheets)) {
      var rule;
      try {
        rule = Array.from(sheet.cssRules).find(function (item) {
          return item.selectorText === '.yeyu-card-media-missing';
        });
      } catch (_) {}
      if (rule) return rule.cssText;
    }
    return '';
  }
  function namespaceFragment(fragment, source) {
    var messageNamespace = hashText(source),
      idMap = Object.create(null),
      idIndex = 0,
      styleNodes = Array.from(fragment.querySelectorAll('style')),
      plan = cssScopePlan(
        styleNodes
          .map(function (node) {
            return node.textContent || '';
          })
          .join('\n'),
        messageNamespace
      ),
      namespace = plan.namespace,
      scope = 'yeyu-rich-scope-' + namespace;
    Array.from(fragment.querySelectorAll('*')).forEach(function (element) {
      if (element.tagName === 'STYLE') return;
      var classes = String(element.getAttribute('class') || '')
        .split(/\s+/)
        .filter(Boolean);
      if (classes.length) {
        element.setAttribute(
          'class',
          classes
            .map(function (name) {
              return scopedClassName(namespace, name);
            })
            .join(' ')
        );
      }
      var id = element.getAttribute('id');
      if (id) {
        if (!idMap[id]) idMap[id] = 'yeyu-card-' + messageNamespace + '-i' + idIndex++;
        element.setAttribute('id', idMap[id]);
      }
    });
    var rewritten = rewriteCss(plan, scope, idMap);
    styleNodes.forEach(function (node) {
      node.remove();
    });
    if (rewritten.css) {
      var style = document.createElement('style');
      style.setAttribute('data-yeyu-rich-style', '');
      style.textContent = rewritten.css;
      fragment.insertBefore(style, fragment.firstChild);
    }
    Array.from(fragment.querySelectorAll('[style]')).forEach(function (element) {
      var value = escapeCssHtmlBoundary(declarationText(element.style, rewritten.names, true));
      if (value) element.setAttribute('style', value);
      else element.removeAttribute('style');
    });
    Array.from(fragment.querySelectorAll('form')).forEach(function (form) {
      // submit() skips the submit event; dialog submission also has no navigation default action.
      form.setAttribute('method', 'dialog');
    });
    Array.from(fragment.querySelectorAll('[formmethod]')).forEach(function (control) {
      control.removeAttribute('formmethod');
    });
    Array.from(fragment.querySelectorAll('[for]')).forEach(function (element) {
      var value = element.getAttribute('for');
      if (idMap[value]) element.setAttribute('for', idMap[value]);
    });
    Array.from(fragment.querySelectorAll('[href^="#"]')).forEach(function (element) {
      var value = element.getAttribute('href').slice(1);
      if (idMap[value]) element.setAttribute('href', '#' + idMap[value]);
    });
    Array.from(fragment.querySelectorAll('a')).forEach(function (link) {
      var href = String(link.getAttribute('href') || '');
      if (href && href[0] !== '#' && !richDisplayUrl(href)) {
        link.removeAttribute('href');
        return;
      }
      if (href && href[0] !== '#') {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
    Array.from(fragment.querySelectorAll('img')).forEach(function (image) {
      image.removeAttribute('srcset');
      var src = mediaSource(image.getAttribute('src'), 'image');
      if (!src) {
        image.replaceWith(missingImage(image.alt));
        return;
      }
      image.src = src;
      image.setAttribute('data-yeyu-src', src);
      image.loading = 'eager';
      image.decoding = 'async';
      image.classList.add('yeyu-card-media', 'yeyu-card-image');
      bindMedia(image);
    });
    Array.from(fragment.querySelectorAll('audio,video')).forEach(function (media) {
      var kind = media.tagName === 'AUDIO' ? 'audio' : 'video',
        valid = mediaSource(media.getAttribute('src'), kind);
      if (valid) media.src = valid;
      else media.removeAttribute('src');
      Array.from(media.querySelectorAll('source')).forEach(function (sourceNode) {
        var sourceValue = mediaSource(sourceNode.getAttribute('src'), kind);
        if (sourceValue) sourceNode.src = sourceValue;
        else sourceNode.remove();
      });
      if (!media.getAttribute('src') && !media.querySelector('source')) {
        media.replaceWith(missingMedia(kind, kind === 'audio' ? '音频链接不可用' : '视频链接不可用'));
        return;
      }
      if (kind === 'audio') media.controls = true;
      media.preload = 'metadata';
      media.classList.add('yeyu-card-media', kind === 'audio' ? 'yeyu-card-audio' : 'yeyu-card-video');
    });
    return {
      scopeClass: scope,
      hasMarkup: Array.from(fragment.childNodes).some(function (node) {
        return node.nodeType === 1;
      }),
      fragment: fragment,
    };
  }
  function prepare(value) {
    var source = String(value || ''),
      fragment = DOMPurify.sanitize(source, {
        RETURN_DOM_FRAGMENT: true,
        FORCE_BODY: true,
        USE_PROFILES: { html: true },
        ADD_TAGS: ['style'],
        ADD_ATTR: ['style'],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|blob):|data:(?:image|audio|video)\/|file:\/\/\/android_asset\/)/i,
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'template', 'base', 'meta', 'link'],
        ADD_FORBID_CONTENTS: ['script', 'iframe', 'object', 'embed', 'template'],
        FORBID_ATTR: ['srcdoc'],
      });
    var result = namespaceFragment(fragment, source);
    result.text = result.hasMarkup ? '' : String(fragment.textContent || '');
    return result;
  }
  function clearMedia(media) {
    if (!mediaTimers) return;
    var timer = mediaTimers.get(media);
    if (timer) clearTimeout(timer);
    mediaTimers.delete(media);
  }
  var remoteImageAttempts = typeof WeakMap === 'function' ? new WeakMap() : null;
  function richImageSource(media) {
    var list = [media && media.getAttribute('data-yeyu-src'), media && media.getAttribute('src')],
      i,
      raw,
      remote;
    for (i = 0; i < list.length; i++) {
      raw = String(list[i] || '').trim();
      remote = remoteImageUrl(raw) || remoteImageUrl(raw.replace(/\s+/g, ''));
      if (remote) return remote;
    }
    return '';
  }
  function failedImagePlaceholder(src, alt) {
    var u = remoteImageUrl(src),
      n,
      t,
      b;
    if (!u) return missingImage(alt);
    n = document.createElement('span');
    n.className = 'yeyu-card-media-missing';
    n.classList.add('card-inline-image-retry');
    n.setAttribute('data-yeyu-src', u);
    if (alt) n.setAttribute('data-yeyu-alt', alt);
    t = document.createElement('span');
    t.textContent = (alt ? '“' + alt + '”' : '') + '图片加载失败，请检查网络或原链接：' + u;
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm yeyu-remote-image-retry';
    b.textContent = '重新加载';
    n.appendChild(t);
    n.appendChild(b);
    return n;
  }
  function retryRemoteRichImage(node) {
    if (!node || !node.isConnected) return;
    var src = remoteImageUrl(node.getAttribute('data-yeyu-src') || '') || richImageSource(node),
      alt = node.getAttribute('data-yeyu-alt') || '',
      requestSrc = src,
      hold,
      img,
      tok;
    if (!src) {
      node.replaceWith(failedImagePlaceholder('', alt));
      return;
    }
    try {
      var retryUrl = new URL(src);
      retryUrl.searchParams.set('_yeyu_retry', Date.now().toString(36));
      requestSrc = retryUrl.href;
    } catch (_) {}
    hold = document.createElement('span');
    hold.className = 'card-inline-image-loading';
    hold.textContent = '[图片加载中]';
    node.replaceWith(hold);
    img = document.createElement('img');
    img.className = 'card-inline-image yeyu-card-media yeyu-card-image';
    img.alt = alt || '图片';
    img.setAttribute('data-yeyu-src', src);
    tok = {};
    if (remoteImageAttempts) remoteImageAttempts.set(hold, tok);
    function live() {
      return hold.isConnected && (!remoteImageAttempts || remoteImageAttempts.get(hold) === tok);
    }
    function ok() {
      if (live() && img.complete && img.naturalWidth > 0) hold.replaceWith(img);
    }
    function bad() {
      if (live()) hold.replaceWith(failedImagePlaceholder(src, alt));
    }
    img.addEventListener('load', ok);
    img.addEventListener('error', bad);
    img.src = requestSrc;
    if (img.complete) {
      if (img.naturalWidth > 0) ok();
      else bad();
    }
  }
  function failMedia(media) {
    if (!media || !media.parentNode) return;
    clearMedia(media);
    if (media.tagName === 'IMG') {
      var remote = richImageSource(media);
      if (remote) {
        media.replaceWith(failedImagePlaceholder(remote, media.getAttribute('alt') || ''));
        return;
      }
    }
    var kind = media.tagName === 'AUDIO' ? '音频' : media.tagName === 'VIDEO' ? '视频' : '图片';
    media.replaceWith(missingMedia(kind.toLowerCase(), kind + '加载失败，请检查网络或原链接'));
  }
  function bindMedia(media) {
    if (!media || (mediaWatched && mediaWatched.has(media))) return false;
    if (mediaWatched) mediaWatched.add(media);
    var loaded = media.tagName === 'IMG' ? 'load' : 'loadedmetadata';
    media.addEventListener(
      loaded,
      function () {
        clearMedia(media);
      },
      { once: true }
    );
    media.addEventListener(
      'error',
      function () {
        failMedia(media);
      },
      { once: true }
    );
    return true;
  }
  function watchMedia(root) {
    var rows = [];
    if (root && root.nodeType === 1 && root.matches && root.matches('.yeyu-card-media')) rows.push(root);
    if (root && root.querySelectorAll) rows = rows.concat(Array.from(root.querySelectorAll('.yeyu-card-media')));
    rows.forEach(function (media) {
      if (media.tagName === 'IMG' && media.complete) {
        if (media.naturalWidth > 0) {
          clearMedia(media);
          return;
        }
        failMedia(media);
        return;
      }
      if ((media.tagName === 'AUDIO' || media.tagName === 'VIDEO') && media.readyState >= 1) {
        clearMedia(media);
        return;
      }
      bindMedia(media);
      if (media.tagName === 'IMG' || (mediaTimers && mediaTimers.has(media))) return;
      if (mediaTimers)
        mediaTimers.set(
          media,
          setTimeout(function () {
            if (media.isConnected) failMedia(media);
          }, MEDIA_TIMEOUT_MS)
        );
    });
  }
  // Rich content keeps its own <style>, so its markup stays self-contained wherever it is shown. In the
  // page one enabled sheet per distinct stylesheet is enough: a copy lives in <head> while any message
  // still carries that text, and the copies inside messages are disabled.
  var RICH_STYLE = 'style[data-yeyu-rich-style]',
    sharedStyleNodes = new Map();
  function holdsRichStyle(node) {
    return !!node && node.nodeType === 1 && (node.matches(RICH_STYLE) || !!node.querySelector(RICH_STYLE));
  }
  function syncSharedStyles() {
    if (!document.head) return;
    var used = new Set();
    Array.prototype.forEach.call(document.querySelectorAll(RICH_STYLE), function (node) {
      var text = node.textContent || '',
        shared = sharedStyleNodes.get(text);
      if (!shared) {
        shared = document.createElement('style');
        shared.setAttribute('data-yeyu-rich-shared-style', '');
        shared.textContent = text;
        document.head.appendChild(shared);
        sharedStyleNodes.set(text, shared);
      }
      used.add(text);
      if (node.sheet && !node.sheet.disabled) node.sheet.disabled = true;
    });
    sharedStyleNodes.forEach(function (node, text) {
      if (used.has(text)) return;
      node.remove();
      sharedStyleNodes.delete(text);
    });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener(
      'submit',
      function (event) {
        var form = event.target;
        if (form && form.closest && form.closest('.yeyu-rich-content')) event.preventDefault();
      },
      true
    );
    document.addEventListener(
      'error',
      function (event) {
        var media = event.target;
        if (media && media.classList && media.classList.contains('yeyu-card-media')) failMedia(media);
      },
      true
    );
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button.yeyu-remote-image-retry');
      if (!b) return;
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      retryRemoteRichImage(b.closest('.yeyu-card-media-missing'));
    });
    if (typeof MutationObserver === 'function' && document.documentElement) {
      new MutationObserver(function (records) {
        var stylesChanged = false;
        records.forEach(function (record) {
          Array.from(record.addedNodes || []).forEach(function (node) {
            watchMedia(node);
            stylesChanged = stylesChanged || holdsRichStyle(node);
          });
          stylesChanged =
            stylesChanged ||
            (record.target.nodeName === 'STYLE' && holdsRichStyle(record.target)) ||
            Array.prototype.some.call(record.removedNodes || [], holdsRichStyle);
        });
        if (stylesChanged) syncSharedStyles();
      }).observe(document.documentElement, { childList: true, subtree: true });
      watchMedia(document.documentElement);
    }
  }
  return { prepare: prepare, missingImage: missingImage, missingMediaStyle: missingMediaStyle };
})();
function prepareSafeDisplayMarkup(value) {
  return RichDisplay.prepare(value);
}
// Every redraw renders the same message texts again. Sanitising, CSS scoping and semantic markup
// depend only on the text (slot markers included), the role and the two flags in the key, so their
// result is kept; image, frontend and thinking slots are still filled on every call.
var _markdownBodyCache = new Map(),
  _markdownBodyCacheChars = 0,
  MARKDOWN_BODY_CACHE_CHARS = 8 * 1024 * 1024;
function markdownBodyHtml(text, options) {
  var role = options.role || 'assistant',
    safeMarkup = options.safeMarkup !== false,
    // options.inline: the text sits inside an inline run (a semantic container), so no block syntax applies.
    inline = options.inline === true,
    key =
      role +
      '\u0000' +
      (options.closeOpenMarkers ? '1' : '0') +
      (safeMarkup ? '1' : '0') +
      (inline ? '1' : '0') +
      '\u0000' +
      text,
    cached = _markdownBodyCache.get(key);
  if (cached != null) {
    _markdownBodyCache.delete(key);
    _markdownBodyCache.set(key, cached);
    return cached;
  }
  var prepared = safeMarkup ? prepareSafeDisplayMarkup(text) : null,
    html;
  if (prepared && prepared.hasMarkup)
    html =
      '<div class="yeyu-rich-content ' +
      prepared.scopeClass +
      '">' +
      Array.from(prepared.fragment.childNodes)
        .map(function (node) {
          return node.nodeType === 3
            ? semanticBlocksHtml(node.data, role, options.closeOpenMarkers, {
                leadInline: inline || markdownSharesLine(node.previousSibling),
                trailInline: inline || markdownSharesLine(node.nextSibling),
              })
            : node.outerHTML || '';
        })
        .join('') +
      '</div>';
  else
    html = inline
      ? markdownInlineHtml(prepared ? prepared.text : text, role, options.closeOpenMarkers)
      : semanticBlocksHtml(prepared ? prepared.text : text, role, options.closeOpenMarkers);
  // A streaming prefix never comes back, so keeping it would only push finished messages out.
  var size = key.length + html.length;
  if (options.closeOpenMarkers || size > MARKDOWN_BODY_CACHE_CHARS / 8) return html;
  _markdownBodyCache.set(key, html);
  _markdownBodyCacheChars += size;
  while (_markdownBodyCacheChars > MARKDOWN_BODY_CACHE_CHARS) {
    var oldest = _markdownBodyCache.keys().next().value;
    _markdownBodyCacheChars -= oldest.length + _markdownBodyCache.get(oldest).length;
    _markdownBodyCache.delete(oldest);
  }
  return html;
}
function md(text, options) {
  options = options || {};
  if (!text) return '';
  // Executable card frontends leave the sanitiser path here and come back as sandbox placeholders.
  // Without options.frontendOwner nothing is extracted, so every other md() caller is unchanged.
  var frontendFrames = [];
  if (options.frontendOwner && typeof cardFrontendExtract === 'function') {
    var extracted = cardFrontendExtract(text, options);
    text = extracted.text;
    frontendFrames = extracted.frames;
  }
  var imageSlots = [];
  if (options.preserveImages && window.YeyuPure && window.YeyuPure.extractImageRefs) {
    var refs = window.YeyuPure.extractImageRefs(text);
    for (var ri = refs.length - 1; ri >= 0; ri--) {
      var ref = refs[ri],
        marker = '\uE000IMG' + ri + '\uE001';
      imageSlots[ri] = ref;
      text = text.slice(0, ref.start) + marker + text.slice(ref.end);
    }
  }
  var thinkSlots = [];
  text = String(text).replace(reasoningDisplayPattern(), function (_, body) {
    if (!D.settings.showThinking) return '';
    var marker = '\uE200THINK' + thinkSlots.length + '\uE201';
    thinkSlots.push(body);
    return marker;
  });
  var h = markdownBodyHtml(text, options);
  thinkSlots.forEach(function (body, i) {
    var marker = '\uE200THINK' + i + '\uE201',
      think = '<div class="think-block">' + esc(body).replace(/\r\n?|\n/g, '<br>') + '</div>';
    h = h.split(marker).join(think);
  });
  if (imageSlots.length)
    h = h.replace(/\uE000IMG(\d+)\uE001/g, function (_, i) {
      return imageSlots[Number(i)] ? cardImageHtml(imageSlots[Number(i)], options) : _;
    });
  if (frontendFrames.length)
    h = h.replace(/\uE100FRONT(\d+)\uE101/g, function (_, i) {
      return frontendFrames[Number(i)] ? cardFrontendPlaceholderHtml(frontendFrames[Number(i)]) : _;
    });
  return h;
}
