(function (g) {
  'use strict';
  var modules = g.YeyuRepositoryModules,
    db = modules && modules.db,
    media = modules && modules.media,
    state = modules && modules.state;
  if (!db || !media || !state) throw new Error('repository 模块加载顺序无效');
  var SCHEMA = db.SCHEMA,
    STORES = db.STORES,
    open = db.open,
    request = db.request,
    asError = db.asError,
    transactionDone = db.transactionDone;
  var split = db.split,
    compose = db.compose,
    hashValue = db.hashValue,
    changedSections = db.changedSections,
    normalizeStreamDraftIds = db.normalizeStreamDraftIds;
  var streamDraftStorageKey = db.streamDraftStorageKey,
    resetRepositoryState = db.resetRepositoryState,
    STREAM_DRAFT_PREFIX = db.STREAM_DRAFT_PREFIX,
    cloneStreamDraftRecord = db.cloneStreamDraftRecord;
  var blobToDataUrl = media.blobToDataUrl,
    detachMedia = media.detachMedia,
    applyMediaUpdates = media.applyMediaUpdates;
  var collectPersistedMediaHashes = media.collectPersistedMediaHashes;
  var referencedMedia = media.referencedMedia,
    cleanupMediaBestEffort = media.cleanupMediaBestEffort,
    hasUnstoredSessionImages = media.hasUnstoredSessionImages;
  function withoutRetiredDraftFields(value) {
    var copy = cloneStreamDraftRecord(value);
    delete copy.reasoning;
    return copy;
  }
  // Opens the database for one piece of work and always closes it; `failure` turns any error into a user-facing one.
  async function withDatabase(work, failure) {
    var idb = await open();
    try {
      return await work(idb);
    } catch (error) {
      throw failure ? asError(error, failure) : error;
    } finally {
      try {
        idb.close();
      } catch (_) {}
    }
  }
  async function saveStreamDraft(draft) {
    var copy = withoutRetiredDraftFields(draft);
    return withDatabase(async function (idb) {
      var tx = idb.transaction('app_meta', 'readwrite');
      tx.objectStore('app_meta').put(copy, streamDraftStorageKey(copy.draftId));
      await transactionDone(tx);
      return copy;
    }, '流式草稿保存失败');
  }
  // A record that cannot be copied, or that the app's readable check rejects, stays stored untouched
  // and is reported by its storage key, so the app can warn and delete it only when the user asks.
  async function loadStreamDrafts(readable) {
    return withDatabase(async function (idb) {
      // 只读：启动可能正处于数据库读取失败的只读期；退役字段留到下一次保存或删除草稿时去掉。
      var tx = idb.transaction('app_meta', 'readonly'),
        store = tx.objectStore('app_meta'),
        pair = await Promise.all([request(store.getAllKeys()), request(store.getAll())]),
        keys = pair[0] || [],
        values = pair[1] || [],
        drafts = [],
        unreadable = [];
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i]).indexOf(STREAM_DRAFT_PREFIX) !== 0) continue;
        var draft = null;
        try {
          draft = withoutRetiredDraftFields(values[i]);
        } catch (_) {}
        if (draft && (!readable || readable(draft))) drafts.push(draft);
        else unreadable.push(keys[i]);
      }
      await transactionDone(tx);
      return { drafts: drafts, unreadable: unreadable };
    }, '流式草稿读取失败');
  }
  async function deleteStreamDraft(draftId) {
    return deleteStreamDraftRecords([streamDraftStorageKey(draftId)]);
  }
  // Removes stored draft records by storage key; keys outside the draft namespace are ignored.
  function deleteStreamDraftRecords(keys) {
    var own = (keys || []).filter(function (key) {
      return String(key).indexOf(STREAM_DRAFT_PREFIX) === 0;
    });
    if (!own.length) return Promise.resolve(false);
    return withDatabase(async function (idb) {
      var tx = idb.transaction('app_meta', 'readwrite'),
        store = tx.objectStore('app_meta');
      own.forEach(function (key) {
        store.delete(key);
      });
      await transactionDone(tx);
      return true;
    }, '流式草稿删除失败');
  }
  function assertStructuredParts(values) {
    var invalid = [];
    if (!Array.isArray(values[0])) invalid.push('角色卡');
    if (!Array.isArray(values[1])) invalid.push('用户人格');
    if (!values[2] || typeof values[2] !== 'object' || Array.isArray(values[2])) invalid.push('世界书');
    if (!values[3] || typeof values[3] !== 'object' || Array.isArray(values[3])) invalid.push('对话');
    if (!Array.isArray(values[4])) invalid.push('转盘方案');
    if (invalid.length)
      throw new Error('本地' + invalid.join('、') + '数据不完整或已损坏，请保留应用数据并重新尝试读取');
  }
  function queueSnapshotMediaReads(tx, characters, personas, currentCharId) {
    var refs = [];
    (characters || []).forEach(function (x) {
      if (x && x._media)
        Object.keys(x._media).forEach(function (f) {
          if (f === 'avatar_image' || (f === 'background_image' && x.id === currentCharId))
            refs.push({ target: x, field: f, key: x._media[f] });
        });
    });
    (personas || []).forEach(function (x) {
      if (x && x._media)
        Object.keys(x._media).forEach(function (f) {
          refs.push({ target: x, field: f, key: x._media[f] });
        });
    });
    return Promise.all(
      refs.map(function (ref) {
        return request(tx.objectStore('media').get(ref.key));
      })
    ).then(function (values) {
      return { refs: refs, values: values };
    });
  }
  async function applySnapshotMedia(snapshot) {
    ((snapshot && snapshot.values) || []).forEach(function (blob, index) {
      if (!(blob && typeof blob.arrayBuffer === 'function' && typeof blob.size === 'number')) return;
      var ref = snapshot.refs[index];
      if (!ref || !ref.target) return;
      ref.target._mediaBlobs = ref.target._mediaBlobs || {};
      ref.target._mediaBlobs[ref.field] = blob;
    });
  }
  function metaCommitIncomplete(meta) {
    return !!(meta && Object.prototype.hasOwnProperty.call(meta, 'commitState') && meta.commitState !== 'complete');
  }
  async function readStructured(idb) {
    var missing = STORES.filter(function (s) {
      return !idb.objectStoreNames.contains(s);
    });
    if (missing.length) throw new Error('本地数据存储不完整，请保留应用数据并重新尝试读取');
    var tx = idb.transaction(
        ['app_meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheel_schemes', 'media'],
        'readonly'
      ),
      done = transactionDone(tx);
    done.catch(function () {});
    var snapshotState = {},
      ready = {},
      queued = false,
      resolveMedia,
      rejectMedia,
      mediaSnapshot = new Promise(function (resolve, reject) {
        resolveMedia = resolve;
        rejectMedia = reject;
      });
    mediaSnapshot.catch(function () {});
    function track(req, key) {
      req.addEventListener('success', function () {
        snapshotState[key] = req.result;
        ready[key] = true;
        if (queued || !ready.meta || !ready.characters || !ready.personas) return;
        queued = true;
        if (
          !snapshotState.meta ||
          snapshotState.meta.schemaVersion !== SCHEMA ||
          metaCommitIncomplete(snapshotState.meta) ||
          !Array.isArray(snapshotState.characters) ||
          !Array.isArray(snapshotState.personas)
        ) {
          resolveMedia({ refs: [], values: [] });
          return;
        }
        try {
          queueSnapshotMediaReads(
            tx,
            snapshotState.characters,
            snapshotState.personas,
            snapshotState.meta.currentCharId
          ).then(resolveMedia, rejectMedia);
        } catch (error) {
          rejectMedia(error);
          try {
            tx.abort();
          } catch (_) {}
        }
      });
      return request(req);
    }
    var rqMeta = track(tx.objectStore('app_meta').get('state'), 'meta'),
      rqCharacters = track(tx.objectStore('characters').get('all'), 'characters'),
      rqPersonas = track(tx.objectStore('personas').get('all'), 'personas'),
      rqWorldBook = request(tx.objectStore('worldbook').get('state')),
      rqChats = request(tx.objectStore('sessions').get('all')),
      rqWheels = request(tx.objectStore('wheel_schemes').get('all')),
      rqMediaKeys = request(tx.objectStore('media').getAllKeys()),
      all = await Promise.all([rqMeta, rqCharacters, rqPersonas, rqWorldBook, rqChats, rqWheels, rqMediaKeys]),
      meta = all[0],
      values = all.slice(1, 6);
    if (!meta) {
      await mediaSnapshot;
      await done;
      state.persistedMediaHashes.clear();
      if (
        values.some(function (value) {
          return value !== undefined;
        }) ||
        all[6].length
      )
        throw new Error(
          '本地数据的存储索引缺失，但角色、对话或其他内容仍然存在。为避免覆盖原数据，请保留应用数据并重新尝试读取'
        );
      return null;
    }
    if (values[4] === undefined) values[4] = [];
    if (meta.schemaVersion !== SCHEMA || metaCommitIncomplete(meta)) {
      await mediaSnapshot;
      await done;
      throw new Error('本地数据上次保存未完整完成，请保留应用数据并重新尝试读取');
    }
    var snapshot = await mediaSnapshot;
    await done;
    assertStructuredParts(values);
    await applySnapshotMedia(snapshot);
    collectPersistedMediaHashes(values[0], values[1], all[6], { meta: meta, characters: values[0], chats: values[3] });
    return {
      data: compose({
        meta: meta,
        characters: values[0],
        personas: values[1],
        worldBook: values[2],
        chats: values[3],
        wheelSchemes: values[4],
      }),
      updatedAt: Math.max(0, Number(meta.updatedAt) || 0),
    };
  }
  async function load() {
    var idb = await open();
    try {
      var structured = await readStructured(idb);
      if (structured) {
        state.repositoryInitialized = true;
        return { data: structured.data, source: 'schema4', updatedAt: structured.updatedAt };
      }
      resetRepositoryState();
      return null;
    } catch (error) {
      resetRepositoryState();
      throw asError(error, 'IndexedDB 读取失败');
    } finally {
      idb.close();
    }
  }
  async function save(data, options) {
    options = options || {};
    var idb = await open();
    try {
      var p = split(data),
        dirty = changedSections(p, options.sections),
        clearStreamDraftIds = normalizeStreamDraftIds(options.clearStreamDraftIds),
        requestedMediaIndependent =
          Array.isArray(options.sections) &&
          options.sections.length > 0 &&
          options.sections.every(function (section) {
            return section === 'wheels' || section === 'worldbook';
          }),
        mediaScanRequired =
          state.mediaCleanupPending ||
          !requestedMediaIndependent ||
          dirty.some(function (section) {
            return section !== 'wheels' && section !== 'worldbook';
          }),
        needsMedia =
          mediaScanRequired &&
          (dirty.some(function (section) {
            return ['characters', 'personas'].includes(section);
          }) ||
            [p.meta.settings]
              .concat(
                p.characters,
                Object.values(p.chats || {}).flatMap(function (box) {
                  return (box && box.sessions) || [];
                })
              )
              .some(function (owner) {
                return (
                  owner &&
                  Array.isArray(owner.dataBankAttachments) &&
                  owner.dataBankAttachments.some(function (row) {
                    return row && (typeof row.text === 'string' || row.data_url);
                  })
                );
              }) ||
            // 会话图片只在本次写 sessions 时拆存（detachMedia 同样只处理脏分区），其余保存不必遍历消息。
            (dirty.includes('sessions') && hasUnstoredSessionImages(p))),
        currentRefs = mediaScanRequired ? referencedMedia(p) : null,
        needsCleanup =
          needsMedia ||
          state.mediaCleanupPending ||
          (mediaScanRequired &&
            Array.from(state.persistedMediaHashes.keys()).some(function (key) {
              return !currentRefs.has(key);
            })),
        detached = needsCleanup
          ? detachMedia(p, dirty)
          : {
              meta: p.meta,
              chats: p.chats,
              characters: p.characters,
              personas: p.personas,
              media: Object.create(null),
              hashes: Object.create(null),
              updates: [],
            },
        mediaKeys = Object.keys(detached.media),
        now = Date.now();
      if (!dirty.length && !mediaKeys.length && !needsCleanup && !clearStreamDraftIds.length)
        return { dirty: [], media: 0, clearedDrafts: [] };
      if (dirty.length || mediaKeys.length || clearStreamDraftIds.length) {
        var stores = ['app_meta'].concat(
          dirty
            .filter(function (x) {
              return x !== 'meta';
            })
            .map(function (x) {
              return x === 'wheels' ? 'wheel_schemes' : x;
            })
        );
        if (mediaKeys.length) stores.push('media');
        stores = Array.from(new Set(stores));
        var tx = idb.transaction(stores, 'readwrite'),
          meta = Object.assign({}, detached.meta, { updatedAt: now }),
          metaStore = tx.objectStore('app_meta');
        metaStore.put(meta, 'state');
        if (dirty.includes('characters')) tx.objectStore('characters').put(detached.characters, 'all');
        if (dirty.includes('personas')) tx.objectStore('personas').put(detached.personas, 'all');
        if (dirty.includes('worldbook')) tx.objectStore('worldbook').put(p.worldBook, 'state');
        if (dirty.includes('sessions')) tx.objectStore('sessions').put(detached.chats, 'all');
        if (dirty.includes('wheels')) tx.objectStore('wheel_schemes').put(p.wheelSchemes, 'all');
        if (mediaKeys.length) {
          var ms = tx.objectStore('media');
          mediaKeys.forEach(function (k) {
            ms.put(detached.media[k], k);
          });
        }
        clearStreamDraftIds.forEach(function (id) {
          metaStore.delete(streamDraftStorageKey(id));
        });
        await transactionDone(tx);
        state.repositoryInitialized = true;
        Object.keys(detached.hashes).forEach(function (k) {
          state.persistedMediaHashes.set(k, detached.hashes[k]);
        });
        applyMediaUpdates(detached.updates);
      }
      var cleanup = needsCleanup
        ? await cleanupMediaBestEffort(idb)
        : { removed: 0, cleanupError: '' };
      state.mediaCleanupPending = !!cleanup.cleanupError;
      return {
        dirty: dirty,
        media: mediaKeys.length,
        clearedDrafts: clearStreamDraftIds,
        removed: cleanup.removed,
        cleanupError: cleanup.cleanupError,
        maintenancePending: state.mediaCleanupPending,
      };
    } catch (error) {
      if (tx) {
        try {
          tx.abort();
        } catch (_) {}
      }
      state.lastHashes = {};
      throw asError(error, 'IndexedDB 保存失败');
    } finally {
      try {
        idb.close();
      } catch (_) {}
    }
  }
  function loadMediaBlob(key) {
    if (!key) return Promise.resolve(null);
    return withDatabase(async function (idb) {
      var tx = idb.transaction('media', 'readonly'),
        blob = await request(tx.objectStore('media').get(key));
      return blob instanceof Blob ? blob : null;
    });
  }
  async function loadMediaValue(key) {
    var blob = await loadMediaBlob(key);
    return blob ? await blobToDataUrl(blob) : '';
  }
  function inspect(data) {
    return withDatabase(async function (idb) {
      var tx = idb.transaction('media', 'readonly'),
        done = transactionDone(tx);
      done.catch(function () {});
      var keys = await request(tx.objectStore('media').getAllKeys());
      await done;
      var parts = split(data),
        refs = referencedMedia(parts),
        keySet = new Set(keys.map(String)),
        missing = Array.from(refs).filter(function (k) {
          return !keySet.has(String(k));
        }),
        orphan = keys.filter(function (k) {
          return !refs.has(k) && !refs.has(String(k));
        });
      return {
        schema: SCHEMA,
        mediaCount: keys.length,
        referencedCount: refs.size,
        missingCount: missing.length,
        orphanCount: orphan.length,
        missing: missing.slice(0, 20),
      };
    });
  }
  function normalizeVectorCacheRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var key = String(value.key || '').trim(),
      vector = Array.isArray(value.vector) ? value.vector.map(Number) : [];
    if (!key || !vector.length || !vector.every(Number.isFinite)) return null;
    return { key: key, vector: vector, updatedAt: Math.max(0, Number(value.updatedAt) || Date.now()) };
  }
  function loadVectorCache(keys) {
    keys = Array.from(
      new Set(
        (Array.isArray(keys) ? keys : []).map(String).filter(function (key) {
          return !!key;
        })
      )
    );
    if (!keys.length) return Promise.resolve([]);
    return withDatabase(async function (idb) {
      var tx = idb.transaction('vector_cache', 'readonly'),
        done = transactionDone(tx),
        store = tx.objectStore('vector_cache');
      done.catch(function () {});
      var rows = await Promise.all(
        keys.map(function (key) {
          return request(store.get(key));
        })
      );
      await done;
      return rows.map(normalizeVectorCacheRecord).filter(Boolean);
    });
  }
  function saveVectorCache(records) {
    records = (Array.isArray(records) ? records : []).map(normalizeVectorCacheRecord).filter(Boolean);
    if (!records.length) return Promise.resolve(0);
    return withDatabase(async function (idb) {
      var tx = idb.transaction('vector_cache', 'readwrite'),
        store = tx.objectStore('vector_cache');
      records.forEach(function (row) {
        store.put(row, row.key);
      });
      await transactionDone(tx);
      return records.length;
    });
  }
  function deleteVectorCachePrefixes(prefixes) {
    prefixes = (Array.isArray(prefixes) ? prefixes : []).map(String).filter(Boolean);
    if (!prefixes.length) return Promise.resolve(0);
    return withDatabase(async function (idb) {
      var tx = idb.transaction('vector_cache', 'readwrite'),
        done = transactionDone(tx),
        store = tx.objectStore('vector_cache'),
        keys = await request(store.getAllKeys()),
        removed = 0;
      keys.forEach(function (key) {
        if (
          prefixes.some(function (prefix) {
            return String(key).startsWith(prefix);
          })
        ) {
          store.delete(key);
          removed++;
        }
      });
      await done;
      return removed;
    });
  }
  g.YeyuRepository = {
    SCHEMA: SCHEMA,
    open: open,
    load: load,
    save: save,
    saveStreamDraft: saveStreamDraft,
    loadStreamDrafts: loadStreamDrafts,
    deleteStreamDraft: deleteStreamDraft,
    deleteStreamDraftRecords: deleteStreamDraftRecords,
    loadMediaBlob: loadMediaBlob,
    loadMediaValue: loadMediaValue,
    inspect: inspect,
    loadVectorCache: loadVectorCache,
    saveVectorCache: saveVectorCache,
    deleteVectorCachePrefixes: deleteVectorCachePrefixes,
    split: split,
    compose: compose,
    changedSections: changedSections,
    hashValue: hashValue,
    detachMedia: detachMedia,
    referencedMedia: referencedMedia,
    storedImageFields: media.storedImageFields,
  };
  try {
    delete g.YeyuRepositoryModules;
  } catch (_) {
    g.YeyuRepositoryModules = undefined;
  }
})(typeof window !== 'undefined' ? window : globalThis);
