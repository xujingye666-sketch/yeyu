// ===== Optional embedding retrieval bridge =====
var _vectorRetrievalBySession = new WeakMap();
var _vectorRetrievalRunBySession = new WeakMap(),
  _vectorRetrievalRunSerial = 0,
  _vectorRetrievalLatestRun = 0,
  _vectorRetrievalActiveController = null;
var _lastVectorRetrievalStatus = { state: 'idle', message: '保存嵌入设置后，在下一次发送时检查连接。', at: 0 };
function normalizeEmbeddingSettings(settings) {
  settings = settings && typeof settings === 'object' ? settings : {};
  return Object.assign(
    { enabled: settings.embeddingEnabled === true },
    YeyuVectorRetrieval.normalizedConfig({
      apiUrl: settings.embeddingApiUrl,
      apiKey: settings.embeddingApiKey,
      model: settings.embeddingModel,
      dimensions: settings.embeddingDimensions,
    })
  );
}
function vectorRetrievalConfigured(settings) {
  var config = normalizeEmbeddingSettings(settings);
  return !!(config.enabled && config.apiUrl && config.apiKey && config.model);
}
function vectorRetrievalQueryFromMessages(messages, limit) {
  var rows = (Array.isArray(messages) ? messages : []).filter(function (row) {
      return (
        row &&
        (row.role === 'user' || row.role === 'assistant') &&
        row.reverted !== true &&
        row.kind !== 'branch-return-revert'
      );
    }),
    selected = rows.slice(-Math.max(1, Math.floor(Number(limit) || 0) || 1)),
    latest = selected
      .slice()
      .reverse()
      .find(function (row) {
        return row && row.role === 'user';
      });
  return selected
    .map(function (row) {
      var text = String((row && row.content) || '');
      return row === latest ? text + '\n' + text : text;
    })
    .join('\n')
    .trim();
}
// Long term memory and World Info keep separate query windows, so the same message
// list produces two query texts whenever the two message counts differ.
function vectorRetrievalQueryForMessages(messages) {
  return vectorRetrievalQueryFromMessages(
    messages,
    typeof memoryV5Number === 'function'
      ? memoryV5Number(D && D.settings && D.settings.memoryQueryMessageLimit, 4, 8, 6)
      : 6
  );
}
function worldBookVectorQueryForMessages(messages) {
  return vectorRetrievalQueryFromMessages(
    messages,
    typeof worldBookSettings === 'function' ? worldBookSettings().vectorQueryMessages : 6
  );
}
function vectorRetrievalEmpty(query, worldBookQuery, state, message, fingerprint) {
  return {
    query: String(query || ''),
    worldBookQuery: String(worldBookQuery || ''),
    fingerprint: String(fingerprint || 'vector_' + state),
    worldBookHitKeys: new Set(),
    memoryScores: Object.create(null),
    state: state,
    message: message,
  };
}
function setVectorRetrievalStatus(state, message) {
  _lastVectorRetrievalStatus = { state: state, message: String(message || ''), at: Date.now() };
  renderVectorRetrievalStatus();
}
function renderVectorRetrievalStatus() {
  var node =
    typeof document !== 'undefined' && document.getElementById ? document.getElementById('s-embedding-status') : null;
  if (!node) return;
  var status = _lastVectorRetrievalStatus || {},
    config = normalizeEmbeddingSettings(D && D.settings);
  node.className = 'api-test-status' + (status.state === 'ready' ? ' ok' : status.state === 'error' ? ' err' : '');
  node.textContent = !config.enabled
    ? '已关闭'
    : !config.apiKey || !config.apiUrl || !config.model
      ? '尚未配齐地址、Key 和模型'
      : status.message || '等待下一次发送时检查';
}
function rememberVectorRetrieval(sess, state) {
  if (sess) _vectorRetrievalBySession.set(sess, state);
  return state;
}
function vectorRetrievalStateForSession(sess, query, worldBookQuery) {
  var state = sess ? _vectorRetrievalBySession.get(sess) : null,
    fresh =
      !!state &&
      state.query === String(query || '').trim() &&
      state.worldBookQuery === String(worldBookQuery || '').trim();
  return fresh
    ? state
    : vectorRetrievalEmpty(query, worldBookQuery, 'unprepared', '本轮尚未准备向量命中', 'vector_unprepared');
}
function vectorRetrievalAbortError() {
  var error = new Error('已取消');
  error.name = 'AbortError';
  return error;
}
async function prepareVectorRetrievalForPrompt(char, sess, messages, options) {
  options = options || {};
  var parentSignal = options.signal || (options.controller && options.controller.signal) || null;
  if (parentSignal && parentSignal.aborted) throw vectorRetrievalAbortError();
  var runToken = options.preview ? 0 : ++_vectorRetrievalRunSerial;
  if (!options.preview) _vectorRetrievalLatestRun = runToken;
  if (!options.preview && sess) _vectorRetrievalRunBySession.set(sess, runToken);
  if (!options.preview && _vectorRetrievalActiveController && typeof _vectorRetrievalActiveController.abort === 'function')
    _vectorRetrievalActiveController.abort();
  var childController = typeof AbortController === 'function' ? new AbortController() : null;
  if (!options.preview) _vectorRetrievalActiveController = childController;
  // A preview's lookups belong to the preview, not to the stop button.
  var releaseController =
    !options.preview && typeof registerTransientRequestController === 'function'
      ? registerTransientRequestController(childController)
      : null;
  var runFresh = function () {
      return (
        (options.preview ||
          (runToken === _vectorRetrievalLatestRun && (!sess || _vectorRetrievalRunBySession.get(sess) === runToken))) &&
        !(childController && childController.signal.aborted) &&
        !(parentSignal && parentSignal.aborted)
      );
    },
    assertFresh = function () {
      if (!runFresh()) throw vectorRetrievalAbortError();
    },
    onParentAbort = function () {
      if (childController) childController.abort();
    };
  if (parentSignal && typeof parentSignal.addEventListener === 'function')
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  // 查询必须来自与 Prompt 构建同一份滚动历史原文，否则本轮命中会被判为过期。
  var rows =
      typeof buildRollingConversationMessages === 'function'
        ? buildRollingConversationMessages(sess, messages).raw
        : messages,
    query = vectorRetrievalQueryForMessages(rows),
    worldBookQuery = worldBookVectorQueryForMessages(rows),
    config = normalizeEmbeddingSettings(D && D.settings),
    chatsEnabled = !D || !D.settings || D.settings.vectorChatsEnabled !== false,
    wbSettings =
      typeof worldBookSettings === 'function'
        ? worldBookSettings()
        : { vectorMaxEntries: 5, vectorScoreThreshold: 0.25 };
  // The status line is only touched for real sends, never for previews.
  var settleEmpty = function (state, message, statusText, fingerprint) {
    assertFresh();
    if (statusText && !options.preview) setVectorRetrievalStatus(state, statusText);
    return rememberVectorRetrieval(sess, vectorRetrievalEmpty(query, worldBookQuery, state, message, fingerprint));
  };
  try {
    if (!config.enabled) return settleEmpty('disabled', '已关闭', '已关闭');
    if (!config.apiUrl || !config.apiKey || !config.model)
      return settleEmpty('unconfigured', '尚未配置', '尚未配齐地址、Key 和模型');
    if (!query && !worldBookQuery) return settleEmpty('empty', '当前没有可检索消息');
    var worldBookEntries =
        wbSettings.vectorEnabled && typeof getAllWBEntries === 'function' ? getAllWBEntries(char && char.id) : [],
      store = options.preview
        ? (sess && sess.memoryStore) || {}
        : typeof ensureSessionMemoryStore === 'function'
          ? ensureSessionMemoryStore(sess)
          : (sess && sess.memoryStore) || {},
      memoryEntries = (
        chatsEnabled && store && Array.isArray(store.longTermEntries) ? store.longTermEntries : []
      ).filter(function (row) {
        return typeof memoryV5EntryActive === 'function'
          ? memoryV5EntryActive(row)
          : row && row.active !== false && String(row.status || 'active') === 'active';
      }),
      candidates = [];
    worldBookEntries.forEach(function (entry) {
      if (!entry || entry.enabled === false || entry.vectorized !== true || !String(entry.content || '').trim()) return;
      if (typeof wbEntryPassesCharacterFilter === 'function' && !wbEntryPassesCharacterFilter(entry, char && char.id))
        return;
      candidates.push({ id: wbEntryRuntimeKey(entry), group: 'worldbook', text: String(entry.content || '') });
    });
    memoryEntries.forEach(function (entry) {
      var id = String((entry && entry.id) || ''),
        text = String((entry && entry.content) || '').trim();
      if (id && text) candidates.push({ id: id, group: 'memory', text: text });
    });
    if (!candidates.length)
      return settleEmpty('ready', '当前没有向量候选', '已开启；当前没有需要建立向量的内容', 'vector_no_candidates');
    var groups = {};
    if (wbSettings.vectorEnabled)
      groups.worldbook = {
        query: worldBookQuery,
        limit: wbSettings.vectorMaxEntries,
        minScore: wbSettings.vectorScoreThreshold,
      };
    if (chatsEnabled) groups.memory = { limit: 24, minScore: 0.35 };
    // The same search over the same candidates reuses the session's last hits, so a send right after a preview
    // gets the previewed result; anything the search reads changing makes it a different search.
    var retrievalKey = JSON.stringify([
        query,
        worldBookQuery,
        candidates,
        groups,
        [config.apiUrl, config.model, config.dimensions],
      ]),
      previous = sess ? _vectorRetrievalBySession.get(sess) : null;
    if (previous && previous.state === 'ready' && previous.retrievalKey === retrievalKey) {
      assertFresh();
      if (!options.preview) setVectorRetrievalStatus('ready', previous.message);
      return previous;
    }
    try {
      var cache = {
          getMany: async function (keys) {
            var rows = await YeyuRepository.loadVectorCache(keys);
            assertFresh();
            return rows;
          },
          putMany: async function (rows) {
            assertFresh();
            var result = await YeyuRepository.saveVectorCache(rows);
            assertFresh();
            return result;
          },
        };
      var result = await YeyuVectorRetrieval.prepareRetrieval({
        query: chatsEnabled ? query : worldBookQuery,
        candidates: candidates,
        groups: groups,
        config: config,
        cache: cache,
        controller: childController,
      });
      assertFresh();
      var worldBookHitKeys = new Set(
          ((result.hits && result.hits.worldbook) || []).map(function (row) {
            return String(row.id || '');
          })
        ),
        memoryScores = Object.create(null);
      ((result.hits && result.hits.memory) || []).forEach(function (row) {
        memoryScores[String(row.id || '')] = Number(row.score) || 0;
      });
      var state = {
        query: query,
        worldBookQuery: worldBookQuery,
        retrievalKey: retrievalKey,
        fingerprint: String(result.fingerprint || 'vector_ready'),
        worldBookHitKeys: worldBookHitKeys,
        memoryScores: memoryScores,
        state: 'ready',
        message: '最近一次语义检索已完成',
      };
      if (!options.preview) setVectorRetrievalStatus('ready', '最近一次语义检索已完成');
      return rememberVectorRetrieval(sess, state);
    } catch (error) {
      if (!runFresh() || (parentSignal && parentSignal.aborted)) throw vectorRetrievalAbortError();
      console.warn('向量检索已降级：', error);
      if (!options.preview) setVectorRetrievalStatus('error', '最近一次向量请求失败；对话已使用普通检索继续');
      else if (options.previewNotes)
        options.previewNotes.push('语义检索请求失败，预览按普通检索显示；发送时会重新检索。');
      return rememberVectorRetrieval(
        sess,
        vectorRetrievalEmpty(query, worldBookQuery, 'error', '向量请求失败，已使用普通检索', 'vector_error')
      );
    }
  } finally {
    if (releaseController) releaseController();
    if (parentSignal && typeof parentSignal.removeEventListener === 'function')
      parentSignal.removeEventListener('abort', onParentAbort);
    if (_vectorRetrievalActiveController === childController) _vectorRetrievalActiveController = null;
  }
}
