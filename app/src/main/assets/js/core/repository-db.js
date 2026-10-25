(function (g) {
  'use strict';
  var modules = g.YeyuRepositoryModules || (g.YeyuRepositoryModules = {});
  var DB_NAME = 'TavernAI',
    DB_VERSION = 4,
    SCHEMA = 4;
  var STORES = [
    'app_meta',
    'characters',
    'personas',
    'worldbook',
    'sessions',
    'wheel_schemes',
    'media',
    'vector_cache',
  ];
  var STREAM_DRAFT_PREFIX = 'stream_draft_v1:';
  var state =
    modules.state ||
    (modules.state = {
      persistedMediaHashes: new Map(),
      repositoryInitialized: false,
      lastHashes: {},
      mediaCleanupPending: false,
    });
  function resetRepositoryState() {
    state.persistedMediaHashes.clear();
    state.repositoryInitialized = false;
    state.lastHashes = {};
    state.mediaCleanupPending = false;
  }
  function request(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(asError(req.error, '本地存储操作失败'));
      };
    });
  }
  // DOMException 原文是英文，在此翻成面向用户的中文；原始异常保留在 cause 供排障。
  function asError(error, fallback) {
    var isDomException = typeof DOMException !== 'undefined' && error instanceof DOMException;
    if (error instanceof Error && !isDomException) return error;
    var name = String((error && error.name) || ''),
      label = '';
    if (name === 'QuotaExceededError') label = '本地存储空间不足，请清理设备空间后重试';
    else if (name === 'AbortError') label = '本地存储操作被中断';
    else if (isDomException) label = '本地存储操作失败（' + name + '）';
    var out = new Error(label || String((error && error.message) || error || fallback || '本地存储操作失败'));
    if (name) out.name = name;
    try {
      out.cause = error;
    } catch (_) {}
    return out;
  }
  function streamDraftStorageKey(draftId) {
    var id = String(draftId || '').trim();
    if (!id || id.length > 160) throw new Error('流式草稿标识无效');
    return STREAM_DRAFT_PREFIX + id;
  }
  function normalizeStreamDraftIds(ids) {
    var seen = new Set(),
      out = [];
    (Array.isArray(ids) ? ids : [ids]).forEach(function (value) {
      var id = String(value || '').trim();
      if (!id || id.length > 160 || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out;
  }
  function cloneStreamDraftRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('流式草稿记录无效');
    var text = JSON.stringify(value);
    if (!text || text.length > 1250000) throw new Error('流式草稿记录超过安全上限');
    var copy = JSON.parse(text);
    if (!copy || typeof copy !== 'object' || Array.isArray(copy) || !copy.draftId) throw new Error('流式草稿记录无效');
    return copy;
  }
  function transactionDone(tx) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function fail() {
        if (settled) return;
        settled = true;
        reject(asError(tx.error, 'transaction aborted'));
      }
      tx.oncomplete = function () {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onerror = fail;
      tx.onabort = fail;
    });
  }
  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      var blocked = false;
      req.onblocked = function () {
        blocked = true;
        reject(new Error('本地数据库升级被其他页面占用，请关闭其他页面后重新尝试'));
      };
      req.onupgradeneeded = function () {
        resetRepositoryState();
        var db = req.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        });
      };
      req.onsuccess = function () {
        if (blocked) {
          req.result.close();
          return;
        }
        req.result.onversionchange = function () {
          req.result.close();
        };
        resolve(req.result);
      };
      req.onerror = function () {
        reject(asError(req.error, 'IndexedDB 打开失败'));
      };
    });
  }
  function split(data) {
    data = data || {};
    var characters = Array.isArray(data.characters) ? data.characters : [],
      chats = data.chats || {};
    return {
      meta: {
        schemaVersion: SCHEMA,
        currentCharId: data.currentCharId || null,
        activePersonaId: data.activePersonaId || null,
        settings: data.settings || {},
      },
      characters: characters,
      personas: Array.isArray(data.personas) ? data.personas : [],
      worldBook: data.worldBook || {},
      chats: chats,
      wheelSchemes: Array.isArray(data.wheelSchemes) ? data.wheelSchemes : [],
    };
  }
  function compose(parts) {
    parts = parts || {};
    return {
      characters: parts.characters || [],
      currentCharId: (parts.meta && parts.meta.currentCharId) || null,
      chats: parts.chats || {},
      worldBook: parts.worldBook || {},
      personas: parts.personas || [],
      activePersonaId: (parts.meta && parts.meta.activePersonaId) || null,
      settings: (parts.meta && parts.meta.settings) || {},
      wheelSchemes: Array.isArray(parts.wheelSchemes) ? parts.wheelSchemes : [],
    };
  }
  function hashValue(v) {
    var s = JSON.stringify(v, function (key, value) {
        if (value instanceof Uint8Array) return { binary: 'Uint8Array', length: value.byteLength };
        if (typeof Blob !== 'undefined' && value instanceof Blob)
          return { binary: 'Blob', size: value.size, type: value.type };
        return value;
      }),
      h1 = 2166136261,
      h2 = 2654435769;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619);
      h2 ^= c;
      h2 = Math.imul(h2, 2246822519);
      h2 = (h2 << 13) | (h2 >>> 19);
    }
    return (h1 >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36) + ':' + s.length;
  }
  function normalizeSections(sections) {
    if (!Array.isArray(sections)) return [];
    var allowed = { meta: 1, characters: 1, personas: 1, worldbook: 1, sessions: 1, wheels: 1 };
    return Array.from(
      new Set(
        sections.filter(function (k) {
          return allowed[k];
        })
      )
    );
  }
  function changedSections(parts, requested) {
    var values = {
        meta: parts.meta,
        characters: parts.characters,
        personas: parts.personas,
        worldbook: parts.worldBook,
        sessions: parts.chats,
        wheels: parts.wheelSchemes,
      },
      requestedKeys = normalizeSections(requested);
    if (state.repositoryInitialized && requestedKeys.length) return requestedKeys;
    var dirty = [],
      keys = Object.keys(values);
    keys.forEach(function (k) {
      var h = hashValue(values[k]);
      if (state.lastHashes[k] !== h) {
        dirty.push(k);
        state.lastHashes[k] = h;
      }
    });
    return dirty;
  }
  modules.db = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    SCHEMA: SCHEMA,
    STORES: STORES,
    STREAM_DRAFT_PREFIX: STREAM_DRAFT_PREFIX,
    resetRepositoryState: resetRepositoryState,
    request: request,
    asError: asError,
    streamDraftStorageKey: streamDraftStorageKey,
    normalizeStreamDraftIds: normalizeStreamDraftIds,
    cloneStreamDraftRecord: cloneStreamDraftRecord,
    transactionDone: transactionDone,
    open: open,
    split: split,
    compose: compose,
    hashValue: hashValue,
    changedSections: changedSections,
  };
})(typeof window !== 'undefined' ? window : globalThis);
