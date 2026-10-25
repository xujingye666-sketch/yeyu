(function (g) {
  'use strict';
  var modules = g.YeyuRepositoryModules,
    db = modules && modules.db,
    state = modules && modules.state;
  if (!db || !state) throw new Error('repository-db.js 必须先加载');
  var request = db.request,
    transactionDone = db.transactionDone,
    hashValue = db.hashValue;
  function isDataImage(v) {
    return typeof v === 'string' && /^data:image\//i.test(v);
  }
  function isDataMedia(v) {
    return typeof v === 'string' && /^data:(?:image|audio|video)\//i.test(v);
  }
  function dataUrlToBlob(v) {
    var m = String(v).match(/^data:([^,]*),(.*)$/s);
    if (!m) throw new Error('媒体 data URL 格式无效');
    var header = m[1],
      type = header.split(';')[0] || 'application/octet-stream',
      base64 = /(?:^|;)base64(?:;|$)/i.test(header),
      raw = base64 ? atob(m[2]) : decodeURIComponent(m[2]),
      a;
    if (!base64 && typeof TextEncoder !== 'undefined') a = new TextEncoder().encode(raw);
    else {
      a = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
    }
    return new Blob([a], { type: type });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
      r.readAsDataURL(blob);
    });
  }
  function mediaKeyPart(value) {
    return String(value == null || value === '' ? 'unknown' : value).replace(/[^a-zA-Z0-9_-]/g, function (ch) {
      return '~' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    });
  }
  function mediaKey(type, id, field) {
    return mediaKeyPart(type) + ':' + mediaKeyPart(id) + ':' + mediaKeyPart(field);
  }
  function knownMediaKey(candidate, signature, fallback) {
    candidate = String(candidate || '');
    if (candidate && state.persistedMediaHashes.get(candidate) === signature) return candidate;
    if (state.persistedMediaHashes.has(fallback) && state.persistedMediaHashes.get(fallback) !== signature)
      return fallback + ':' + signature;
    return fallback;
  }
  // 会话里夜欲以 Blob 保存的图片条目 {id, mediaKey, mediaHash, mime, ...}，内存里未落库前另挂 blob。
  // kind 区分来源：message-image 是消息当前候选的 images[] 与其余候选的 swipeImages[][]，inlay 是 Risu
  // session.risu.inlays{id: 条目} 和 viewScreenImage。键与签名只由 id 和 Blob 的大小、类型决定，
  // 同步可得，分支按 JSON 复制后仍指向同一份。
  function storedImageFields(kind, id, blob) {
    return {
      mediaKey: mediaKey(kind, id, 'image'),
      mediaHash: hashValue([kind, String(id), blob.size, blob.type]),
    };
  }
  // 拆存与引用汇总共用的唯一 walker：visit(entry, kind, id) 返回替换后的条目，原样返回表示不变；
  // 有条目被替换时只沿路径浅拷贝（会话、msgs、消息、候选分格、inlay 表），原对象不动。
  function mapSessionImages(session, visit) {
    if (!session || typeof session !== 'object') return session;
    var out = session;
    function mapList(list, kind) {
      if (!Array.isArray(list)) return list;
      var next = list;
      list.forEach(function (entry, index) {
        if (!entry || typeof entry !== 'object') return;
        var value = visit(entry, kind, entry.id);
        if (value === entry) return;
        if (next === list) next = list.slice();
        next[index] = value;
      });
      return next;
    }
    if (Array.isArray(session.msgs)) {
      var msgs = session.msgs;
      session.msgs.forEach(function (message, index) {
        if (!message || typeof message !== 'object') return;
        var images = mapList(message.images, 'message-image'),
          slots = message.swipeImages,
          nextSlots = slots;
        if (Array.isArray(slots))
          slots.forEach(function (list, slot) {
            var value = mapList(list, 'message-image');
            if (value === list) return;
            if (nextSlots === slots) nextSlots = slots.slice();
            nextSlots[slot] = value;
          });
        if (images === message.images && nextSlots === slots) return;
        if (msgs === session.msgs) msgs = session.msgs.slice();
        msgs[index] = Object.assign({}, message);
        if (images !== message.images) msgs[index].images = images;
        if (nextSlots !== slots) msgs[index].swipeImages = nextSlots;
      });
      if (msgs !== session.msgs) out = Object.assign({}, session, { msgs: msgs });
    }
    var risu = session.risu,
      inlays = risu && typeof risu === 'object' ? risu.inlays : null;
    if (inlays && typeof inlays === 'object' && !Array.isArray(inlays)) {
      var nextInlays = inlays;
      Object.keys(inlays).forEach(function (id) {
        var entry = inlays[id];
        if (!entry || typeof entry !== 'object') return;
        var value = visit(entry, 'inlay', entry.id || id);
        if (value === entry) return;
        if (nextInlays === inlays) nextInlays = Object.assign({}, inlays);
        nextInlays[id] = value;
      });
      if (nextInlays !== inlays) {
        if (out === session) out = Object.assign({}, session);
        out.risu = Object.assign({}, risu, { inlays: nextInlays });
      }
    }
    var viewScreenImage = risu && risu.viewScreenImage;
    if (viewScreenImage && typeof viewScreenImage === 'object') {
      var nextViewScreenImage = visit(viewScreenImage, 'inlay', viewScreenImage.id);
      if (nextViewScreenImage !== viewScreenImage) {
        if (out === session) out = Object.assign({}, session);
        out.risu = Object.assign({}, out.risu || risu, { viewScreenImage: nextViewScreenImage });
      }
    }
    return out;
  }
  function eachSessionImage(parts, callback) {
    Object.values((parts && parts.chats) || {}).forEach(function (box) {
      ((box && box.sessions) || []).forEach(function (session) {
        mapSessionImages(session, function (entry, kind, id) {
          callback(entry, kind, id);
          return entry;
        });
      });
    });
  }
  // 还有条目挂着内存 Blob（或 JSON 复制留下的空壳）时需要一次拆存。
  function hasUnstoredSessionImages(parts) {
    var pending = false;
    eachSessionImage(parts, function (entry) {
      if (Object.prototype.hasOwnProperty.call(entry, 'blob')) pending = true;
    });
    return pending;
  }
  function eachDataBankAttachment(parts, callback) {
    function visit(owner) {
      (owner && Array.isArray(owner.dataBankAttachments) ? owner.dataBankAttachments : []).forEach(callback);
    }
    visit(parts && parts.meta && parts.meta.settings);
    ((parts && parts.characters) || []).forEach(visit);
    Object.values((parts && parts.chats) || {}).forEach(function (box) {
      ((box && box.sessions) || []).forEach(visit);
    });
  }
  function detachMedia(parts, dirty) {
    var media = Object.create(null),
      hashes = Object.create(null),
      updates = [],
      touchCharacters = !dirty || dirty.includes('characters'),
      touchPersonas = !dirty || dirty.includes('personas'),
      touchSessions = !dirty || dirty.includes('sessions');
    var chars = (parts.characters || []).map(function (src) {
      var x = Object.assign({}, src);
      delete x._mediaBlobs;
      delete x._mediaDisplay;
      if (touchCharacters)
        ['avatar_image', 'background_image'].forEach(function (f) {
          var data = x[f];
          if (!isDataImage(data)) return;
          var sig = hashValue(data),
            sharedIndex = (x.media_assets || []).findIndex(function (asset) {
              return asset && (asset.data_url || asset.dataUrl) === data;
            }),
            fallback =
              sharedIndex < 0
                ? mediaKey('character', x.id, f)
                : mediaKey(
                    'character',
                    x.id,
                    'asset_' + String(x.media_assets[sharedIndex].id || sharedIndex) + '_' + sharedIndex
                  ),
            k = knownMediaKey(src._media && src._media[f], sig, fallback);
          x._media = Object.assign({}, x._media, { [f]: k });
          x._mediaHash = Object.assign({}, x._mediaHash, { [f]: sig });
          if (state.persistedMediaHashes.get(k) !== sig) {
            var b = dataUrlToBlob(data);
            if (b) media[k] = b;
          }
          hashes[k] = sig;
          updates.push({ target: src, field: f, data: data, key: k, hash: sig });
          x[f] = '';
        });
      if (Array.isArray(x.media_assets)) {
        x.media_assets = x.media_assets.map(function (asset, index) {
          var a = Object.assign({}, asset || {}),
            data = a.data_url || a.dataUrl,
            bytes = a.bytes instanceof Uint8Array ? a.bytes : null,
            blob = a.blob instanceof Blob ? a.blob : null,
            storedBlob =
              blob &&
              a.mediaKey &&
              a.mediaHash &&
              state.persistedMediaHashes.get(String(a.mediaKey)) === String(a.mediaHash);
          if (touchCharacters && !storedBlob && (bytes || blob || isDataMedia(data))) {
            var sig =
                bytes || blob
                  ? String(a.mediaHash || hashValue(data || String((bytes || blob).length || (blob && blob.size) || 0)))
                  : hashValue(data),
              fallback = mediaKey('character', x.id, 'asset_' + String(a.id || index) + '_' + index),
              sharedField = Object.keys(x._mediaHash || {}).find(function (field) {
                return x._mediaHash[field] === sig;
              }),
              k = sharedField ? x._media[sharedField] : knownMediaKey(a.mediaKey, sig, fallback),
              b =
                blob ||
                (bytes ? new Blob([bytes], { type: a.mime || 'application/octet-stream' }) : null) ||
                dataUrlToBlob(data);
            if (state.persistedMediaHashes.get(k) !== sig && b && !media[k]) media[k] = b;
            hashes[k] = sig;
            updates.push({ target: asset, asset: true, data: data, key: k, hash: sig, blob: b });
            a.mediaKey = k;
            a.mediaHash = sig;
          }
          delete a.data_url;
          delete a.dataUrl;
          delete a.bytes;
          delete a.blob;
          delete a.objectUrl;
          delete a.objectUrlSource;
          delete a.objectUrlOwnerId;
          return a;
        });
      }
      return x;
    });
    var personas = (parts.personas || []).map(function (src) {
      var x = Object.assign({}, src);
      delete x._mediaBlobs;
      delete x._mediaDisplay;
      if (touchPersonas && isDataImage(x.avatar_image)) {
        var data = x.avatar_image,
          sig = hashValue(data),
          fallback = mediaKey('persona', x.id, 'avatar_image'),
          k = knownMediaKey(src._media && src._media.avatar_image, sig, fallback);
        x._media = Object.assign({}, x._media, { avatar_image: k });
        x._mediaHash = Object.assign({}, x._mediaHash, { avatar_image: sig });
        if (state.persistedMediaHashes.get(k) !== sig) {
          var b = dataUrlToBlob(data);
          if (b) media[k] = b;
        }
        hashes[k] = sig;
        updates.push({ target: src, field: 'avatar_image', data: data, key: k, hash: sig });
        x.avatar_image = '';
      }
      return x;
    });
    function detachAttachments(owner, section, ownerId) {
      if (!owner || !Array.isArray(owner.dataBankAttachments)) return owner;
      return Object.assign({}, owner, {
        dataBankAttachments: owner.dataBankAttachments.map(function (source) {
          var row = Object.assign({}, source),
            text = typeof row.text === 'string' ? row.text : null,
            data = typeof row.data_url === 'string' && row.data_url.startsWith('data:') ? row.data_url : null;
          if ((!dirty || section === 'meta' || dirty.includes(section)) && (text !== null || data !== null)) {
            var hash = hashValue(text !== null ? text : data),
              key = knownMediaKey(row.mediaKey, hash, mediaKey('attachment', ownerId, row.id || row.url)),
              blob = text !== null ? new Blob([text], { type: 'text/plain;charset=utf-8' }) : dataUrlToBlob(data);
            if (state.persistedMediaHashes.get(key) !== hash) media[key] = blob;
            hashes[key] = hash;
            updates.push({ target: source, attachment: true, text: text, data: data, key: key, hash: hash });
            row.mediaKey = key;
            row.mediaHash = hash;
          }
          delete row.text;
          delete row.data_url;
          return row;
        }),
      });
    }
    // 会话图片：内存 Blob 写入 media Store，存档副本只留键与签名；空壳 blob 字段一并去掉。
    function detachImage(entry, kind, id) {
      var blob = entry.blob instanceof Blob ? entry.blob : null;
      if (!Object.prototype.hasOwnProperty.call(entry, 'blob')) return entry;
      var row = Object.assign({}, entry);
      delete row.blob;
      if (!blob) return row;
      var fields = storedImageFields(kind, id, blob),
        hash = String(entry.mediaHash || fields.mediaHash),
        key = knownMediaKey(entry.mediaKey, hash, fields.mediaKey);
      if (state.persistedMediaHashes.get(key) !== hash) media[key] = blob;
      hashes[key] = hash;
      updates.push({ target: entry, image: true, blob: blob, key: key, hash: hash });
      row.mediaKey = key;
      row.mediaHash = hash;
      return row;
    }
    var meta = Object.assign({}, parts.meta, {
        settings: detachAttachments(parts.meta && parts.meta.settings, 'meta', 'global'),
      }),
      chats = {};
    Object.keys(parts.chats || {}).forEach(function (charId) {
      var box = parts.chats[charId];
      if (!box || !Array.isArray(box.sessions)) {
        chats[charId] = box;
        return;
      }
      chats[charId] = Object.assign({}, box, {
        sessions: ((box && box.sessions) || []).map(function (session) {
          var row = detachAttachments(session, 'sessions', charId + ':' + session.id);
          return touchSessions ? mapSessionImages(row, detachImage) : row;
        }),
      });
    });
    chars = chars.map(function (char) {
      return detachAttachments(char, 'characters', char.id);
    });
    return {
      meta: meta,
      chats: chats,
      characters: chars,
      personas: personas,
      media: media,
      hashes: hashes,
      updates: updates,
    };
  }
  function applyMediaUpdates(updates) {
    (updates || []).forEach(function (update) {
      try {
        var target = update.target;
        if (!target || typeof target !== 'object') return;
        if (update.image) {
          // 落库期间条目可能已换了 Blob（极少见）；只摘掉这次写入的那一份。
          if (target.blob !== update.blob) return;
          target.mediaKey = update.key;
          target.mediaHash = update.hash;
          delete target.blob;
          return;
        }
        if (update.attachment) {
          if (update.text !== null ? target.text !== update.text : target.data_url !== update.data) return;
          target.mediaKey = update.key;
          target.mediaHash = update.hash;
          delete target.text;
          delete target.data_url;
          return;
        }
        if (update.asset) {
          var current = target.data_url || target.dataUrl || '';
          if (update.data) {
            if (current !== update.data) return;
          } else if (!(target.bytes instanceof Uint8Array) && !(target.blob instanceof Blob) && !target.mediaKey)
            return;
          target.mediaKey = update.key;
          target.mediaHash = update.hash;
          delete target.data_url;
          delete target.dataUrl;
          delete target.bytes;
          if (update.blob instanceof Blob) target.blob = update.blob;
          return;
        }
        if (target[update.field] !== update.data) return;
        target._media = Object.assign({}, target._media, { [update.field]: update.key });
        target._mediaHash = Object.assign({}, target._mediaHash, { [update.field]: update.hash });
      } catch (_) {}
    });
  }
  function collectPersistedMediaHashes(characters, personas, keys, parts) {
    var keySet = new Set((keys || []).map(String)),
      next = new Map();
    (characters || []).concat(personas || []).forEach(function (x) {
      if (x && x._media && x._mediaHash)
        Object.keys(x._media).forEach(function (f) {
          var key = String(x._media[f] || ''),
            hash = x._mediaHash[f];
          if (key && hash && keySet.has(key)) next.set(key, String(hash));
        });
      if (x && Array.isArray(x.media_assets))
        x.media_assets.forEach(function (asset) {
          var key = String((asset && asset.mediaKey) || ''),
            hash = asset && asset.mediaHash;
          if (key && hash && keySet.has(key)) next.set(key, String(hash));
        });
    });
    eachDataBankAttachment(parts || { characters: characters }, function (row) {
      if (row && row.mediaKey && row.mediaHash && keySet.has(String(row.mediaKey)))
        next.set(String(row.mediaKey), String(row.mediaHash));
    });
    eachSessionImage(parts, function (entry) {
      if (entry.mediaKey && entry.mediaHash && keySet.has(String(entry.mediaKey)))
        next.set(String(entry.mediaKey), String(entry.mediaHash));
    });
    state.persistedMediaHashes = next;
  }
  function referencedMedia(detached) {
    var refs = new Set();
    (detached.characters || []).concat(detached.personas || []).forEach(function (x) {
      if (x && x._media)
        Object.keys(x._media).forEach(function (f) {
          if (x._media[f]) refs.add(x._media[f]);
        });
      if (x && Array.isArray(x.media_assets))
        x.media_assets.forEach(function (asset) {
          if (asset && asset.mediaKey) refs.add(asset.mediaKey);
        });
    });
    eachDataBankAttachment(detached, function (row) {
      if (row && row.mediaKey) refs.add(row.mediaKey);
    });
    eachSessionImage(detached, function (entry) {
      if (entry.mediaKey) refs.add(entry.mediaKey);
    });
    return refs;
  }
  async function cleanupMedia(idb) {
    // Read owners and delete bytes in the same transaction: an unsaved in-memory
    // change (including a different partition's pending edit) cannot retire a Blob.
    var tx = idb.transaction(['app_meta', 'characters', 'personas', 'sessions', 'media'], 'readwrite'),
      done = transactionDone(tx),
      store = tx.objectStore('media');
    done.catch(function () {});
    var values = await Promise.all([
        request(tx.objectStore('app_meta').get('state')),
        request(tx.objectStore('characters').get('all')),
        request(tx.objectStore('personas').get('all')),
        request(tx.objectStore('sessions').get('all')),
        request(store.getAllKeys()),
      ]),
      keys = values[4],
      removedKeys = [];
    if (
      !values[0] ||
      !Array.isArray(values[1]) ||
      !Array.isArray(values[2]) ||
      !values[3] ||
      typeof values[3] !== 'object' ||
      Array.isArray(values[3])
    ) {
      await done;
      throw new Error('媒体引用数据不完整，暂未清理');
    }
    var refs = referencedMedia({ meta: values[0], characters: values[1], personas: values[2], chats: values[3] });
    keys.forEach(function (k) {
      if (!refs.has(k)) {
        store.delete(k);
        removedKeys.push(k);
      }
    });
    await done;
    removedKeys.forEach(function (k) {
      state.persistedMediaHashes.delete(String(k));
    });
    return removedKeys.length;
  }
  async function cleanupMediaBestEffort(idb) {
    try {
      return { removed: await cleanupMedia(idb), cleanupError: '' };
    } catch (error) {
      return { removed: 0, cleanupError: String((error && error.message) || error || '媒体清理失败') };
    }
  }
  modules.media = {
    blobToDataUrl: blobToDataUrl,
    storedImageFields: storedImageFields,
    hasUnstoredSessionImages: hasUnstoredSessionImages,
    detachMedia: detachMedia,
    applyMediaUpdates: applyMediaUpdates,
    collectPersistedMediaHashes: collectPersistedMediaHashes,
    referencedMedia: referencedMedia,
    cleanupMediaBestEffort: cleanupMediaBestEffort,
  };
})(typeof window !== 'undefined' ? window : globalThis);
