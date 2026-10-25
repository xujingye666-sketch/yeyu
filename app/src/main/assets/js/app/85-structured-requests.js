// ===== Structured auxiliary requests =====
function parseJsonObjectTexts(text, strictWhole) {
  var raw = sanitizeText(text || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!raw) return null;
  var resultKeys = new Set(),
    MAX_SCANNED_JSON_CANDIDATES = 256;
  function addResult(results, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    var key;
    try {
      key = JSON.stringify(value);
    } catch (_) {
      return;
    }
    if (resultKeys.has(key)) return;
    resultKeys.add(key);
    results.push(value);
  }
  function parseCandidate(value, depth) {
    depth = Number(depth) || 0;
    if (!value || depth > 2) return null;
    value = String(value).trim();
    try {
      var parsed = JSON.parse(value);
      if (typeof parsed === 'string' && parsed !== value) return parseCandidate(parsed, depth + 1);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  function scan(value) {
    var results = [],
      scanKeys = new Set();
    function addScan(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      var key;
      try {
        key = JSON.stringify(value);
      } catch (_) {
        return;
      }
      if (scanKeys.has(key)) return;
      scanKeys.add(key);
      results.push(value);
    }
    var direct = parseCandidate(value);
    if (direct) addScan(direct);
    if (strictWhole) return results;
    var ends = [],
      stack = [],
      inString = false,
      escaped = false;
    for (var i = 0; i < value.length; i++) {
      var ch = value[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') stack.push(i);
      else if (ch === '}' && stack.length) {
        var start = stack.pop();
        ends[start] = i + 1;
      }
    }
    for (var at = 0, attempted = 0; at < ends.length && attempted < MAX_SCANNED_JSON_CANDIDATES; at++) {
      if (!ends[at]) continue;
      attempted++;
      var found = parseCandidate(value.slice(at, ends[at]));
      if (found) addScan(found);
    }
    return results;
  }
  var variants = strictWhole ? [raw] : [raw, stripAuxiliaryReasoningBlocks(raw), cleanAuxiliaryResponseText(raw)];
  var results = [];
  for (var n = 0; n < variants.length; n++) {
    var candidate = String(variants[n] || '').trim();
    if (!strictWhole)
      candidate = candidate
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
    scan(candidate).forEach(function (row) {
      addResult(results, row);
    });
  }
  return results;
}
function parseStructuredCompletion(json, route, schema) {
  var visible = getCompletionVisibleCandidateTexts(json),
    hasVisible = visible.some(function (text) {
      return !!String(text || '').trim();
    }),
    candidates = hasVisible ? visible : getCompletionAuxiliaryCandidateTexts(json);
  for (var i = 0; i < candidates.length; i++) {
    var rows = parseJsonObjectTexts(candidates[i], !hasVisible);
    for (var j = 0; j < rows.length; j++) {
      var parsed = rows[j],
        coerced = schema ? parsed : coerceStructuredPayloadForRoute(parsed, route, 0);
      if (coerced && structuredPayloadSchemaValid(coerced, schema || route)) return coerced;
    }
  }
  return null;
}
async function requestStructuredJson(system, user, options) {
  options = options || {};
  var routeKey = options.route || 'memorySummary',
    route = resolveApiRoute(routeKey),
    controller = options.controller || new AbortController(),
    dynamic = Math.max(4096, Math.ceil(String(user || '').length * 1.8)),
    // 显式传 0 表示不限，请求不带输出长度参数；不传时按输入长度自动估算。
    explicit = options.maxTokens == null ? null : Math.max(0, Math.floor(Number(options.maxTokens) || 0)),
    requested = explicit === null ? dynamic : explicit;
  if ((!route.apiKey && route.protocol !== 'grok-subscription') || !route.apiUrl || !route.model)
    throw new Error('未配置“' + (routeKey === 'memorySummary' ? '长记忆总结' : '辅助任务') + '”的 API 路由');
  var schema = options.schema || routeKey,
    structuredInstruction =
      '结构化结果要求：优先在最终答案 content 中只输出一个完整 JSON 对象；不要输出思考过程、Markdown 解释或前后说明。结果必须满足任务字段与类型要求。';
  var output = {
      name:
        'yeyu_' +
        String(routeKey || 'structured')
          .replace(/[^A-Za-z0-9_-]/g, '_')
          .slice(0, 48),
      allowReasoningFallback: true,
      validate: function (value) {
        try {
          return structuredPayloadSchemaValid(value, schema) === true;
        } catch (_) {
          return false;
        }
      },
    },
    result = await callDeepSeek(
      [
        { role: 'system', content: String(system || '') + '\n\n' + structuredInstruction },
        { role: 'user', content: user },
      ],
      null,
      Object.assign(modelRouteRequestOptions(routeKey), {
        route: routeKey,
        transient: true,
        nonStream: true,
        output: output,
        controller: controller,
        maxTokens: requested > 0 ? Math.min(65536, requested) : 0,
        ignoreUserMaxTokens: options.ignoreUserMaxTokens === true,
        allowEmptyContent: true,
      })
    ),
    json = {
      choices: [
        {
          message: {
            content: String((result && result.content) || ''),
            reasoning_content: String((result && result.reasoning) || ''),
          },
        },
      ],
    },
    parsed = parseStructuredCompletion(json, routeKey, schema);
  if (parsed) return parsed;
  if (structuredOutputTruncated(result)) throw structuredOutputTruncatedError();
  throw new Error('结构化结果格式不完整，唯一一次格式修复仍未成功，请重试。');
}
