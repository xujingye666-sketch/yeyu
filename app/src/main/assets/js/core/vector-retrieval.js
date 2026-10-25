(function (g) {
  'use strict';
  function normalizedVector(value) {
    if (!Array.isArray(value) || !value.length) return null;
    var result = value.map(Number);
    return result.every(Number.isFinite) ? result : null;
  }
  function cosineSimilarity(left, right) {
    left = normalizedVector(left);
    right = normalizedVector(right);
    if (!left || !right || left.length !== right.length) return 0;
    var dot = 0,
      leftNorm = 0,
      rightNorm = 0;
    for (var index = 0; index < left.length; index++) {
      dot += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }
    if (!leftNorm || !rightNorm) return 0;
    return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
  }
  function topMatches(queryVector, candidates, options) {
    options = options || {};
    var limit = Math.max(0, Math.floor(Number(options.limit) || 0)),
      minimum = Number(options.minScore);
    if (!Number.isFinite(minimum)) minimum = 0;
    if (!limit) return [];
    return (Array.isArray(candidates) ? candidates : [])
      .map(function (candidate, index) {
        return {
          id: String((candidate && candidate.id) || ''),
          score: cosineSimilarity(queryVector, candidate && candidate.vector),
          index: index,
        };
      })
      .filter(function (row) {
        return row.id && row.score >= minimum;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.index - b.index;
      })
      .slice(0, limit)
      .map(function (row) {
        return { id: row.id, score: Number(row.score.toFixed(8)) };
      });
  }
  function normalizedConfig(value) {
    value = value && typeof value === 'object' ? value : {};
    var dimensions = Number(value.dimensions);
    return {
      apiUrl: String(value.apiUrl || '')
        .trim()
        .replace(/\/+$/, ''),
      apiKey: String(value.apiKey || ''),
      model: String(value.model || '').trim(),
      dimensions: Number.isInteger(dimensions) && dimensions > 0 ? dimensions : 0,
    };
  }
  function routeIdentity(config) {
    config = normalizedConfig(config);
    return JSON.stringify([config.apiUrl, config.model, config.dimensions || 'default']);
  }
  function vectorCacheKey(text, config) {
    return 'vector_v2:' + JSON.stringify([routeIdentity(config), String(text == null ? '' : text)]);
  }
  async function requestEmbeddings(texts, config, options) {
    config = normalizedConfig(config);
    options = options || {};
    var fetcher = options.fetch || g.fetch;
    if (!config.apiUrl || !config.apiKey || !config.model) throw new Error('嵌入设置不完整');
    if (typeof fetcher !== 'function') throw new Error('当前环境无法请求嵌入接口');
    var controller = options.controller || (typeof g.AbortController === 'function' ? new g.AbortController() : null),
      timer = 0,
      timeoutMs = Math.max(0, Number(options.timeoutMs) || 0),
      body = { model: config.model, input: texts };
    if (config.dimensions) body.dimensions = config.dimensions;
    if (controller && timeoutMs && typeof g.setTimeout === 'function')
      timer = g.setTimeout(function () {
        controller.abort();
      }, timeoutMs);
    try {
      var response = await fetcher(config.apiUrl + '/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
        body: JSON.stringify(body),
        signal: controller && controller.signal,
      });
      if (!response || !response.ok) {
        var detail = '';
        try {
          detail = String(await response.text());
        } catch (_) {}
        var error = new Error(
          '嵌入接口返回错误' +
            (response && response.status ? ' ' + response.status : '') +
            (detail ? ': ' + detail.slice(0, 300) : '')
        );
        error.status = Number(response && response.status) || 0;
        throw error;
      }
      var payload = await response.json(),
        rows = Array.isArray(payload && payload.data) ? payload.data : [],
        ordered = new Array(texts.length),
        assigned = new Array(texts.length).fill(false),
        invalid = false;
      rows.forEach(function (row, index) {
        var at = Number.isInteger(Number(row && row.index)) ? Number(row.index) : index,
          vector = normalizedVector(row && row.embedding);
        if (at < 0 || at >= ordered.length || assigned[at] || !vector) {
          invalid = true;
          return;
        }
        ordered[at] = vector;
        assigned[at] = true;
      });
      if (
        invalid ||
        rows.length !== ordered.length ||
        assigned.some(function (value) {
          return !value;
        })
      )
        throw new Error('嵌入接口返回的数据不完整');
      var size = ordered[0] && ordered[0].length;
      if (
        !size ||
        ordered.some(function (vector) {
          return vector.length !== size;
        })
      )
        throw new Error('嵌入接口返回的向量维度不一致');
      return ordered;
    } finally {
      if (timer && typeof g.clearTimeout === 'function') g.clearTimeout(timer);
    }
  }
  var EMBEDDING_BATCH_SIZE = 64;
  async function prepareRetrieval(options) {
    // Each group may carry its own query text; groups without one share options.query.
    // Only groups with a non-empty query are embedded, and identical query texts are embedded once.
    options = options || {};
    var query = String(options.query || '').trim(),
      config = normalizedConfig(options.config),
      groups = options.groups && typeof options.groups === 'object' ? options.groups : {},
      queryFor = function (group) {
        var row = groups[group] || {};
        return String(row.query == null ? query : row.query).trim();
      },
      activeGroups = Object.keys(groups).filter(function (group) {
        return !!queryFor(group);
      }),
      candidates = (Array.isArray(options.candidates) ? options.candidates : [])
        .map(function (row) {
          return {
            id: String((row && row.id) || ''),
            group: String((row && row.group) || ''),
            text: String((row && row.text) || '').trim(),
          };
        })
        .filter(function (row) {
          return row.id && row.text && activeGroups.indexOf(row.group) >= 0;
        }),
      queryTexts = [],
      queryAt = Object.create(null);
    activeGroups.forEach(function (group) {
      var text = queryFor(group);
      if (!(text in queryAt)) {
        queryAt[text] = queryTexts.length;
        queryTexts.push(text);
      }
    });
    var texts = queryTexts.concat(
        candidates.map(function (row) {
          return row.text;
        })
      ),
      keys = texts.map(function (text) {
        return vectorCacheKey(text, config);
      }),
      // Repeated candidates and candidates equal to the query share one cached vector per key.
      textByKey = Object.create(null),
      uniqueKeys = keys.filter(function (key, index) {
        if (key in textByKey) return false;
        textByKey[key] = texts[index];
        return true;
      }),
      cache = options.cache || {},
      stored = typeof cache.getMany === 'function' ? await cache.getMany(uniqueKeys) : [],
      byKey = Object.create(null);
    (Array.isArray(stored) ? stored : []).forEach(function (row) {
      var vector = normalizedVector(row && row.vector);
      if (row && String(row.key || '') in textByKey && vector) byKey[String(row.key)] = vector;
    });
    var missing = uniqueKeys
      .filter(function (key) {
        return !byKey[key];
      })
      .map(function (key) {
        return { key: key, text: textByKey[key] };
      });
    // Batches are cached as they complete so a later failure keeps the finished progress.
    for (var at = 0; at < missing.length; at += EMBEDDING_BATCH_SIZE) {
      var batch = missing.slice(at, at + EMBEDDING_BATCH_SIZE),
        created = await requestEmbeddings(
          batch.map(function (row) {
            return row.text;
          }),
          config,
          options
        ),
        records = batch.map(function (row, index) {
          var record = { key: row.key, vector: created[index], updatedAt: Date.now() };
          byKey[row.key] = record.vector;
          return record;
        });
      if (typeof cache.putMany === 'function') await cache.putMany(records);
    }
    var hits = {};
    Object.keys(groups).forEach(function (group) {
      if (activeGroups.indexOf(group) < 0) {
        hits[group] = [];
        return;
      }
      var groupCandidates = candidates
        .map(function (row, index) {
          return row.group === group ? { id: row.id, vector: byKey[keys[queryTexts.length + index]] } : null;
        })
        .filter(Boolean);
      hits[group] = topMatches(byKey[keys[queryAt[queryFor(group)]]], groupCandidates, groups[group]);
    });
    return {
      hits: hits,
      fingerprint:
        'vector_result_v2:' + JSON.stringify([routeIdentity(config), queryTexts, hits]),
      routeIdentity: routeIdentity(config),
    };
  }
  g.YeyuVectorRetrieval = {
    normalizedConfig: normalizedConfig,
    cosineSimilarity: cosineSimilarity,
    topMatches: topMatches,
    routeIdentity: routeIdentity,
    vectorCacheKey: vectorCacheKey,
    requestEmbeddings: requestEmbeddings,
    prepareRetrieval: prepareRetrieval,
  };
})(typeof window !== 'undefined' ? window : globalThis);
