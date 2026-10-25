// Native protocols translate only at fetchCompatibleCompletion; callers keep OpenAI bodies/responses.
const PROVIDER_PROTOCOLS = [
  { key: 'openai', label: 'OpenAI 兼容', defaultApiUrl: '' },
  { key: 'grok-subscription', label: 'Grok 订阅', defaultApiUrl: 'https://api.x.ai/v1' },
  {
    key: 'anthropic',
    label: 'Anthropic Messages',
    defaultApiUrl: 'https://api.anthropic.com/v1',
    versionSegment: 'v1',
  },
  {
    key: 'gemini',
    label: 'Google Gemini',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    versionSegment: 'v1beta',
  },
];
// The base every native request, model listing and connectivity test is built on. Relay consoles show only
// the bare origin, so a native address whose last path segment is not an API version gets the official one
// appended (RisuAI does the same for custom Anthropic URLs); an existing version segment is kept as typed.
function providerApiBase(protocol, apiUrl) {
  var base = String(apiUrl || '')
      .trim()
      .replace(/[/]+$/, ''),
    row = PROVIDER_PROTOCOLS.find(function (item) {
      return item.key === protocol;
    });
  if (!row || !row.versionSegment || /[/]v[0-9]+[a-z]*$/i.test(base)) return base;
  return base + '/' + row.versionSegment;
}
// Checked 2026-09-25: https://platform.claude.com/docs/en/api/messages/create
// max_tokens is required and, while thinking, caps thinking plus answer together. Application defaults for an
// unset limit: 8192 without thinking; with thinking 16384, or the manual budget plus the full 8192 answer
// allowance when that is larger, for streaming and non-streaming alike. The 21333 non-stream ceiling in
// https://platform.claude.com/docs/en/api/errors#long-requests is only the official SDKs' client-side check;
// the API accepts larger direct fetches. A user-set limit is kept, raised only to budget + 1024.
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;
const ANTHROPIC_THINKING_MAX_TOKENS = 16384;
const ANTHROPIC_API_VERSION = '2023-06-01';
// Checked 2026-09-25: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
// Manual budget >= 1024 and < max_tokens. These four budgets are application presets, not API enums.
// 4.6+ uses adaptive thinking and effort: https://platform.claude.com/docs/en/build-with-claude/effort
// auto omits configuration; off explicitly disables it (always-on models may reject it).
const ANTHROPIC_THINKING_PRESETS = {
  off: { type: 'disabled' },
  auto: null,
  low: { budget: 1024, effort: 'low' },
  medium: { budget: 4096, effort: 'medium' },
  high: { budget: 8192, effort: 'high' },
  max: { budget: 16384, effort: 'max' },
};
// Checked 2026-09-25: https://ai.google.dev/gemini-api/docs/generate-content/thinking
// 2.5: 0 disables, -1 is dynamic; Pro cannot disable (send 0 and retain its refusal).
// Preset budgets fit Flash/Flash-Lite <=24576 and Pro <=32768; low also meets Lite's 512 minimum.
// 3.x prefers levels; medium is unavailable on 3 Pro, so map it to low. max maps to high.
// off still sends budget 0: never silently replace an explicit off with MINIMAL (which may think).
const GEMINI_THINKING_PRESETS = {
  off: { budget: 0 },
  auto: { budget: -1 },
  low: { budget: 1024, level: 'LOW' },
  medium: { budget: 4096, level: 'MEDIUM' },
  high: { budget: 8192, level: 'HIGH' },
  max: { budget: 24576, level: 'HIGH' },
};
// Checked 2026-09-25: https://ai.google.dev/api/generate-content#v1beta.HarmCategory and
// https://ai.google.dev/gemini-api/docs/safety-settings. Six configurable categories in GenerateContent;
// OFF (not BLOCK_NONE) is the "never block" threshold for the 2.5 and 3 series (SillyTavern sends the same).
const GEMINI_SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
  'HARM_CATEGORY_JAILBREAK',
];
const GEMINI_SAFETY_THRESHOLD = 'OFF';
// https://ai.google.dev/api/generate-content#v1beta.GenerationConfig (checked 2026-09-25).
const GEMINI_MAX_STOP_SEQUENCES = 5;
// SillyTavern 1.19.0 src/prompt-converters.js default promptPlaceholder.
const NATIVE_PROMPT_PLACEHOLDER = '[Start a new chat]';

function anthropicModelFeatures(model) {
  var name = String(model || '').toLowerCase(),
    // Minor versions are one or two digits; a dated suffix (claude-sonnet-4-20250514) means x.0.
    version = name.match(/claude-(?:opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2})(?!\d))?/),
    major = version ? Number(version[1]) : 0,
    minor = version ? Number(version[2] || 0) : 0,
    special = /claude-(?:fable|mythos)-/.test(name),
    adaptive = special || major >= 5 || (major === 4 && minor >= 6);
  // Checked 2026-09-25: /docs/en/build-with-claude/thinking and /docs/en/api/errors on platform.claude.com.
  // 4.6+ has no prefill. Fable/Mythos, 4.7+ and 5.x return 400 for non-default sampling; Sonnet 4.6 accepts it
  // (a rejection there is stripped by request-local negotiation). Older thinking omits sampling too.
  // Only the Claude 5 generation (Opus 5 and later, Fable/Mythos) thinks when the request omits `thinking`;
  // 4.6–4.8 run without thinking unless it is configured.
  return {
    adaptive: adaptive,
    cannotDisableThinking: special || (/claude-opus-/.test(name) && (major > 5 || (major === 5 && minor >= 5))),
    defaultThinking: special || major >= 5,
    noSampling: special || major >= 5 || (major === 4 && minor >= 7),
  };
}
// Internal disableThinking requests minimize latency instead of sending an unsupported off setting.
// Checked 2026-09-25: https://platform.claude.com/docs/en/build-with-claude/thinking and
// https://ai.google.dev/gemini-api/docs/generate-content/thinking. Explicit user off stays unchanged.
function nativeProviderMinimumThinking(protocol, model) {
  if (protocol === 'anthropic')
    return anthropicModelFeatures(model).cannotDisableThinking ? ANTHROPIC_THINKING_PRESETS.low : null;
  if (protocol !== 'gemini') return null;
  var name = String(model || '')
    .replace(/^models\//, '')
    .toLowerCase();
  if (/^gemini-2\.5-pro(?:-|$)/.test(name)) return { budget: 128 };
  if (!/^gemini-3(?:\.\d+)?-/.test(name)) return null;
  // Flash and Flash-Lite 3 / 3.0 / 3.1 / 3.5 / 3.6 support MINIMAL; 3.7 / 3.8 and Pro require LOW.
  var minimal = /^gemini-3(?:\.(?:0|1|5|6))?-flash(?:-|$)/.test(name);
  return { level: minimal ? 'MINIMAL' : 'LOW' };
}
function protocolSupportsPrefill(protocol, thinkingEnabled, model) {
  return (
    protocol !== 'gemini' && (protocol !== 'anthropic' || (!thinkingEnabled && !anthropicModelFeatures(model).adaptive))
  );
}
function nativeProviderThinkingEffort(body, route) {
  if (body.__yeyuThinkingMode === 'minimum') return 'low';
  if (body.__yeyuThinkingMode === 'disabled' || providerThinkingDisableDialect(body)) return 'off';
  if (body.__yeyuThinkingMode === 'auto' && !body.reasoning_effort && !body.thinking) return 'auto';
  var effort = body.reasoning_effort || (route && route.reasoningEffort);
  if (!effort || effort === 'inherit') effort = (D && D.settings && D.settings.reasoningEffort) || 'auto';
  if (effort === 'xhigh') effort = 'max';
  return Object.prototype.hasOwnProperty.call(ANTHROPIC_THINKING_PRESETS, effort) ? effort : 'auto';
}
function nativeProviderHeaders(route, accept) {
  var headers = new Headers((route && route.headers) || {}),
    protocol = route && route.protocol;
  if (!headers.has('Content-Type') && !accept) headers.set('Content-Type', 'application/json');
  if (accept && !headers.has('Accept')) headers.set('Accept', 'application/json');
  var auth = protocol === 'anthropic' ? 'x-api-key' : 'x-goog-api-key';
  if (route.apiKey && !headers.has(auth)) headers.set(auth, route.apiKey);
  if (protocol === 'anthropic') {
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', ANTHROPIC_API_VERSION);
    // Official browser requests require this opt-in; WebView uses the same Fetch/CORS boundary.
    if (!headers.has('anthropic-dangerous-direct-browser-access'))
      headers.set('anthropic-dangerous-direct-browser-access', 'true');
  }
  return headers;
}
function nativeProviderMessages(messages, protocol, names) {
  names = names || {};
  var rows = JSON.parse(JSON.stringify(messages || [])),
    system = [],
    turns = [];
  // SillyTavern src/prompt-converters.js: example_* names become the user/character name wherever they appear.
  // Other names prefix only chat turns: Claude drops them from system messages and prefixes the rest without a
  // check; Gemini prefixes every non-leading message unless the text already starts with the name.
  function speaker(message, text, leading) {
    var example =
      message.name === 'example_user' ? names.userName : message.name === 'example_assistant' ? names.charName : null;
    if (example !== null) return example && !text.startsWith(example + ': ') ? example + ': ' + text : text;
    if (!message.name || leading || (protocol !== 'gemini' && message.role === 'system')) return text;
    return protocol === 'gemini' && text.startsWith(message.name + ': ') ? text : message.name + ': ' + text;
  }
  // Media without a data URL, input_audio, and non-image media on Claude are dropped, as the converters do.
  function mediaPart(part) {
    var media = part.image_url || part.video_url || part.audio_url,
      url = media && media.url,
      match = typeof url === 'string' && url.match(/^data:([^;,]+);base64,([\s\S]*)$/);
    if (!match) return null;
    if (protocol === 'gemini') return { inlineData: { mimeType: match[1], data: match[2] } };
    if (part.type !== 'image_url') return null;
    return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
  }
  while (rows.length && rows[0].role === 'system' && (protocol !== 'gemini' || rows.length > 1)) {
    var row = rows.shift(),
      text = speaker(row, String(row.content || ''), true);
    system.push(protocol === 'gemini' ? { text: text } : { type: 'text', text: text });
  }
  if (protocol !== 'gemini' && !rows.length) rows.push({ role: 'user', content: NATIVE_PROMPT_PLACEHOLDER });
  rows.forEach(function (message) {
    var source = Array.isArray(message.content)
        ? message.content
        : [{ type: 'text', text: String(message.content || '') }],
      parts = source
        .map(function (part) {
          if (part.type !== 'text') return mediaPart(part);
          var text = speaker(message, String(part.text || ''));
          return protocol === 'gemini' ? { text: text } : { type: 'text', text: text || '\u200b' };
        })
        .filter(Boolean),
      role = message.role === 'assistant' ? (protocol === 'gemini' ? 'model' : 'assistant') : 'user',
      previous = turns[turns.length - 1];
    if (previous && previous.role === role) {
      if (protocol === 'gemini')
        parts.forEach(function (part) {
          var text = previous.parts.find(function (value) {
            return typeof value.text === 'string';
          });
          if (typeof part.text !== 'string') previous.parts.push(part);
          else if (part.text && text) text.text += '\n\n' + part.text;
          else if (part.text) previous.parts.push(part);
        });
      else previous.content.push.apply(previous.content, parts);
    } else turns.push(protocol === 'gemini' ? { role: role, parts: parts } : { role: role, content: parts });
  });
  if (protocol !== 'gemini') {
    for (var index = 0; index < turns.length; index++) {
      var turn = turns[index],
        images = turn.content.filter(function (part) {
          return part.type === 'image';
        });
      if (turn.role !== 'assistant' || !images.length) continue;
      var next = index + 1;
      while (next < turns.length && turns[next].role !== 'user') next++;
      if (next === turns.length) turns.push({ role: 'user', content: [] });
      turns[next].content.push.apply(turns[next].content, images);
      turn.content = turn.content.filter(function (part) {
        return part.type !== 'image';
      });
    }
  }
  return { system: system, turns: turns };
}
function nativeProviderRequest(route, body) {
  var protocol = route.protocol,
    messages = nativeProviderMessages(body.messages, protocol, body.__yeyuPromptNames),
    effort = nativeProviderThinkingEffort(body, route),
    minimum =
      body.__yeyuThinkingMode === 'minimum' ? nativeProviderMinimumThinking(protocol, body.model || route.model) : null,
    caps = route.capabilities || {},
    thinkingAllowed = caps.thinking !== false,
    stops = typeof body.stop === 'string' ? [body.stop] : Array.isArray(body.stop) ? body.stop.slice() : [],
    base = providerApiBase(protocol, route.apiUrl),
    wire,
    url;
  if (protocol === 'anthropic') {
    var features = anthropicModelFeatures(body.model),
      preset = ANTHROPIC_THINKING_PRESETS[effort];
    wire = {
      model: body.model,
      messages: messages.turns,
      stream: !!body.stream,
    };
    if (messages.system.length) wire.system = messages.system;
    if (stops.length) wire.stop_sequences = stops;
    if (effort === 'off') wire.thinking = { type: 'disabled' };
    else if (preset && thinkingAllowed) {
      if (features.adaptive) {
        wire.thinking = { type: 'adaptive', display: 'summarized' };
        wire.output_config = { effort: preset.effort };
      } else {
        wire.thinking = { type: 'enabled', budget_tokens: preset.budget };
      }
    }
    // Native JSON output and thinking effort share output_config. Pass the public schema unchanged:
    // unsupported constraints must produce the supplier's error instead of weaker silent constraints.
    // https://platform.claude.com/docs/en/build-with-claude/structured-outputs (checked 2026-10-08).
    if (body.response_format && body.response_format.type === 'json_schema')
      wire.output_config = Object.assign({}, wire.output_config, {
        format: { type: 'json_schema', schema: body.response_format.json_schema.schema },
      });
    // Without a thinking field only the Claude 5 generation thinks by default; 4.6–4.8 do not.
    var thinkingOn = wire.thinking ? wire.thinking.type !== 'disabled' : features.defaultThinking,
      budget = (wire.thinking && wire.thinking.budget_tokens) || 0;
    if (body.max_tokens > 0) wire.max_tokens = Math.max(body.max_tokens, budget ? budget + 1024 : 0);
    else
      // A manual budget keeps the whole no-thinking answer allowance on top of it, streaming or not, so the
      // max tier never leaves the answer less room than a request without thinking.
      wire.max_tokens = thinkingOn
        ? Math.max(ANTHROPIC_THINKING_MAX_TOKENS, budget + ANTHROPIC_DEFAULT_MAX_TOKENS)
        : ANTHROPIC_DEFAULT_MAX_TOKENS;
    // Omit all sampling when thinking: default temperature=1; no top_k, no incompatible top_p.
    // Outside thinking prefer temperature over top_p (Claude 4.5+ rejects their combination).
    if (!features.noSampling && (!wire.thinking || wire.thinking.type === 'disabled')) {
      if (body.temperature != null) wire.temperature = Math.max(0, Math.min(1, body.temperature));
      else if (body.top_p != null) wire.top_p = body.top_p;
      if (body.top_k != null) wire.top_k = body.top_k;
    }
    url = base + '/messages';
  } else {
    var model = String(body.model || route.model || '').replace(/^models\//, ''),
      config = {},
      geminiPreset = minimum || GEMINI_THINKING_PRESETS[effort],
      levels = /^gemini-[3-9](?:[.-]|$)/i.test(model);
    wire = {
      contents: messages.turns,
      generationConfig: config,
      safetySettings: GEMINI_SAFETY_CATEGORIES.map(function (category) {
        return { category: category, threshold: GEMINI_SAFETY_THRESHOLD };
      }),
    };
    if (messages.system.length) wire.systemInstruction = { parts: messages.system };
    if (stops.length) config.stopSequences = stops.slice(0, GEMINI_MAX_STOP_SEQUENCES);
    if (body.max_tokens > 0) config.maxOutputTokens = body.max_tokens;
    [
      ['temperature', 'temperature'],
      ['top_p', 'topP'],
      ['top_k', 'topK'],
      ['frequency_penalty', 'frequencyPenalty'],
      ['presence_penalty', 'presencePenalty'],
    ].forEach(function (pair) {
      if (body[pair[0]] != null) config[pair[1]] = body[pair[0]];
    });
    if (thinkingAllowed || effort === 'off') {
      config.thinkingConfig = { includeThoughts: true };
      if (levels && geminiPreset.level) {
        config.thinkingConfig.thinkingLevel =
          effort === 'medium' && /^gemini-3(?:\.0)?-pro/i.test(model) ? 'LOW' : geminiPreset.level;
      } else if (!levels || effort === 'off') config.thinkingConfig.thinkingBudget = geminiPreset.budget;
    }
    if (body.response_format && ['json_object', 'json_schema'].includes(body.response_format.type)) {
      config.responseMimeType = 'application/json';
      // responseJsonSchema accepts JSON Schema directly (responseSchema is Google's restricted dialect).
      // https://ai.google.dev/api/generate-content#v1beta.GenerationConfig, checked 2026-09-25.
      if (body.response_format.json_schema && body.response_format.json_schema.schema)
        config.responseJsonSchema = body.response_format.json_schema.schema;
    }
    url =
      base +
      '/models/' +
      encodeURIComponent(model) +
      (body.stream ? ':streamGenerateContent?alt=sse' : ':generateContent');
  }
  return { url: url, headers: nativeProviderHeaders(route), body: wire };
}
function rejectedNativeProviderCapability(status, text, body, route) {
  // Negotiation stays request-local. Translate only named native keys to existing capability names.
  // There is one native off dialect: never cycle OpenAI dialects into the same rejected native request.
  var effort = nativeProviderThinkingEffort(body, route),
    mapped = String(text || ''),
    thinkingNamed = /thinking(?:Config|Budget|Level)?|budget_tokens|output_config|\beffort\b/i.test(mapped);
  if (effort === 'off' && thinkingNamed) return '';
  mapped = mapped
    .replace(/responseJsonSchema|responseSchema/g, 'json_schema')
    .replace(/responseMimeType/g, 'response_format')
    .replace(/topP/g, 'top_p')
    .replace(/topK/g, 'top_k')
    .replace(/frequencyPenalty/g, 'frequency_penalty')
    .replace(/presencePenalty/g, 'presence_penalty')
    .replace(/thinkingConfig|thinkingBudget|thinkingLevel|budget_tokens|output_config|\beffort\b/g, 'thinking');
  var probe = Object.assign({}, body);
  if (thinkingNamed && (effort !== 'auto' || route.protocol === 'gemini')) probe.thinking = { type: 'enabled' };
  return rejectedProviderCapability(status, mapped, probe);
}
function nativeProviderFinishReason(reason) {
  reason = String(reason || '').toLowerCase();
  return ['end_turn', 'stop_sequence', 'stop'].includes(reason) ? 'stop' : reason === 'max_tokens' ? 'length' : reason;
}
// 供应商以内容过滤、安全拦截或拒答结束回复时的结束原因（OpenAI 兼容 content_filter、Claude refusal、
// Gemini 各类安全与策略原因，见 https://ai.google.dev/api/generate-content#FinishReason，2026-09-27 核对）。
// 返回小写原因；正常结束、输出上限与未知原因返回空串。
const PROVIDER_INTERCEPT_FINISH_REASONS = [
  'content_filter',
  'refusal',
  'safety',
  'recitation',
  'blocklist',
  'prohibited_content',
  'spii',
  'image_safety',
  'image_prohibited_content',
  'image_recitation',
];
function providerInterceptedFinishReason(reason) {
  reason = String(reason || '').toLowerCase();
  return PROVIDER_INTERCEPT_FINISH_REASONS.includes(reason) ? reason : '';
}
function nativeProviderUsage(protocol, usage) {
  if (!usage) return null;
  var prompt =
      protocol === 'anthropic'
        ? Number(usage.input_tokens || 0) +
          Number(usage.cache_creation_input_tokens || 0) +
          Number(usage.cache_read_input_tokens || 0)
        : Number(usage.promptTokenCount || 0),
    completion =
      protocol === 'anthropic'
        ? Number(usage.output_tokens || 0)
        : Number(usage.candidatesTokenCount || 0) + Number(usage.thoughtsTokenCount || 0);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: protocol === 'gemini' && usage.totalTokenCount != null ? usage.totalTokenCount : prompt + completion,
  };
}
// Readers serialize the error object into error.responseText, so the raw feedback stays there for diagnosis.
function geminiBlockError(feedback) {
  var message = 'Gemini 拦截（' + feedback.blockReason + '）';
  if (feedback.blockReasonMessage) message += '：' + feedback.blockReasonMessage;
  return { message: message, promptFeedback: feedback };
}
// Gemini 有时整个响应（流式时指整条流）都没有候选，也没有 promptFeedback.blockReason；原始响应留在错误里供排查。
function geminiNoCandidateError(json) {
  return {
    message: 'Gemini 未返回候选' + (json && json.modelVersion ? '（' + json.modelVersion + '）' : ''),
    response: json,
  };
}
function geminiHasCandidates(json) {
  return !!(json && Array.isArray(json.candidates) && json.candidates.length);
}
function nativeProviderStopError(protocol, stop, hasContent) {
  if (hasContent) return null;
  if (protocol === 'anthropic') {
    if (stop.stop_reason !== 'refusal') return null;
    var details = stop.stop_details || {},
      message = 'Claude 拒绝回复（refusal）';
    if (details.category) message += '：' + details.category;
    if (details.explanation) message += '：' + details.explanation;
    return { message: message, stop_reason: stop.stop_reason, stop_details: stop.stop_details };
  }
  // Keep every abnormal candidate ending, including future reasons, diagnosable with its raw metadata.
  // https://ai.google.dev/api/generate-content#FinishReason (checked 2026-09-25).
  var reason = String(stop.finishReason || '').toUpperCase();
  if (!reason || ['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(reason)) return null;
  return {
    message: 'Gemini 未生成正文（' + stop.finishReason + '）' + (stop.finishMessage ? '：' + stop.finishMessage : ''),
    candidate: stop,
  };
}
// streamChunk: one frame of a stream, where a usage-only frame without candidates is normal.
function nativeProviderCompletion(protocol, json, hasContent, streamChunk) {
  if (json.error) return json;
  if (protocol === 'gemini' && json.promptFeedback && json.promptFeedback.blockReason)
    return { error: geminiBlockError(json.promptFeedback) };
  if (protocol === 'gemini' && !streamChunk && !geminiHasCandidates(json))
    return { error: geminiNoCandidateError(json) };
  var candidate = (json.candidates && json.candidates[0]) || {},
    parts = protocol === 'anthropic' ? json.content || [] : (candidate.content && candidate.content.parts) || [],
    message = { role: 'assistant', content: '', reasoning_content: '' };
  parts.forEach(function (part) {
    if (part.signature || part.thoughtSignature) message.reasoning_signature = part.signature || part.thoughtSignature;
    if (protocol === 'anthropic' && part.type === 'thinking') message.reasoning_content += part.thinking || '';
    else if (typeof part.text === 'string') message[part.thought ? 'reasoning_content' : 'content'] += part.text;
  });
  var error = nativeProviderStopError(
    protocol,
    protocol === 'anthropic' ? json : candidate,
    hasContent || !!message.content.trim()
  );
  if (error) return { error: error };
  return {
    id: json.id || json.responseId || '',
    object: 'chat.completion',
    model: json.model || json.modelVersion || '',
    choices: [
      {
        index: 0,
        message: message,
        finish_reason: nativeProviderFinishReason(json.stop_reason || candidate.finishReason),
      },
    ],
    usage: nativeProviderUsage(protocol, protocol === 'anthropic' ? json.usage : json.usageMetadata),
  };
}
function nativeProviderResponse(route, response, streaming) {
  var headers = new Headers(response.headers),
    protocol = route.protocol;
  headers.delete('content-length');
  headers.delete('content-encoding');
  // Transform JSON incrementally too: fetchCompatibleCompletion must not wait for the whole body,
  // otherwise existing cancellation/idle readers could not interrupt a stalled non-stream response.
  var decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    buffer = '',
    usage = {},
    hasContent = false,
    geminiCandidateSeen = false,
    geminiLastFrame = null,
    finished = false;
  function emit(controller, value) {
    controller.enqueue(encoder.encode('data: ' + JSON.stringify(value) + '\n\n'));
  }
  function end(controller) {
    if (finished) return;
    finished = true;
    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
  }
  function event(controller, raw) {
    if (finished || !raw.trim()) return;
    var data = raw
      .split(/\r?\n/)
      .filter(function (line) {
        return line.startsWith('data:');
      })
      .map(function (line) {
        return line.slice(5).trimStart();
      })
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      end(controller);
      return;
    }
    var json;
    try {
      json = JSON.parse(data);
    } catch (_) {
      // One malformed SSE frame does not invalidate the rest of a native response.
      return;
    }
    if (!json || typeof json !== 'object') return;
    var delta = {},
      finish = '',
      mappedUsage = null;
    if (json.error || json.type === 'error' || (json.promptFeedback && json.promptFeedback.blockReason)) {
      emit(controller, {
        error:
          json.error || json.type === 'error'
            ? { message: providerErrorText(json.error || json) }
            : geminiBlockError(json.promptFeedback),
      });
      end(controller);
      return;
    }
    if (protocol === 'gemini') {
      geminiLastFrame = json;
      if (geminiHasCandidates(json)) geminiCandidateSeen = true;
      var completion = nativeProviderCompletion(protocol, json, hasContent, true);
      if (completion.error) {
        emit(controller, completion);
        end(controller);
        return;
      }
      var choice = completion.choices[0];
      delta = choice.message;
      finish = choice.finish_reason;
      mappedUsage = completion.usage;
    } else {
      if (json.type === 'message_start') Object.assign(usage, json.message && json.message.usage);
      if (json.type === 'content_block_start') {
        var block = json.content_block || {};
        if (block.type === 'text') delta.content = block.text || '';
        if (block.type === 'thinking') delta.reasoning_content = block.thinking || '';
        if (block.signature) delta.reasoning_signature = block.signature;
      }
      if (json.type === 'content_block_delta') {
        if (json.delta && json.delta.type === 'text_delta') delta.content = json.delta.text || '';
        if (json.delta && json.delta.type === 'thinking_delta') delta.reasoning_content = json.delta.thinking || '';
        if (json.delta && json.delta.type === 'signature_delta') delta.reasoning_signature = json.delta.signature || '';
      }
      if (json.type === 'message_delta') {
        Object.assign(usage, json.usage);
        var stopError = nativeProviderStopError(protocol, json.delta || {}, hasContent);
        if (stopError) {
          emit(controller, { error: stopError });
          end(controller);
          return;
        }
        finish = nativeProviderFinishReason(json.delta && json.delta.stop_reason);
      }
      if (json.type === 'message_start' || json.usage) mappedUsage = nativeProviderUsage(protocol, usage);
      if (json.type === 'message_stop') {
        end(controller);
        return;
      }
    }
    if (delta.content && delta.content.trim()) hasContent = true;
    if (Object.keys(delta).length || finish || mappedUsage)
      emit(controller, {
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: delta, finish_reason: finish || null }],
        usage: mappedUsage,
      });
    if (finish) end(controller);
  }
  function consume(controller, flush) {
    if (!streaming) {
      var json;
      try {
        json = JSON.parse(buffer);
      } catch (error) {
        if (flush) throw error;
        return;
      }
      controller.enqueue(encoder.encode(JSON.stringify(nativeProviderCompletion(protocol, json))));
      finished = true;
      controller.terminate();
      return;
    }
    var match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      var raw = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      event(controller, raw);
      if (finished) {
        controller.terminate();
        return;
      }
    }
    if (flush) {
      event(controller, buffer);
      if (!finished && protocol === 'gemini' && geminiLastFrame && !geminiCandidateSeen) {
        emit(controller, { error: geminiNoCandidateError(geminiLastFrame) });
        end(controller);
      }
      if (!finished) {
        emit(controller, {
          error: { message: '原生流在协议结束前关闭' },
          interruptionReason: 'network_interrupted',
        });
        end(controller);
      }
    }
  }
  headers.set('Content-Type', streaming ? 'text/event-stream' : 'application/json');
  var stream = response.body.pipeThrough(
    new TransformStream({
      transform: function (chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        consume(controller, false);
      },
      flush: function (controller) {
        if (!finished) {
          buffer += decoder.decode();
          consume(controller, true);
        }
      },
    })
  );
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: headers });
}

async function testProviderConnectivity(route, options) {
  options = options || {};
  var controller = new AbortController(),
    timedOut = false,
    timeoutMs = options.timeoutMs == null ? 60000 : Math.max(0, Number(options.timeoutMs) || 0),
    abort = function () {
      controller.abort();
    },
    requestRoute = Object.assign({}, route, { task: 'connectivity', capabilities: {} }),
    body = { model: route.model, messages: [{ role: 'user', content: 'Reply OK.' }], stream: false, max_tokens: 1024 };
  if (options.signal) {
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  }
  applyThinkingForRoute(body, requestRoute, route.requestOptions);
  // Small answer allowance plus the selected manual budget. Adaptive/auto has no fixed budget;
  // allow enough output for a reasoning model to reach its answer to this short prompt.
  var effort = nativeProviderThinkingEffort(body, requestRoute),
    preset =
      route.protocol === 'anthropic'
        ? ANTHROPIC_THINKING_PRESETS[effort]
        : route.protocol === 'gemini'
          ? GEMINI_THINKING_PRESETS[effort]
          : null;
  if (effort !== 'off') body.max_tokens = Math.max(4096, (preset && preset.budget > 0 ? preset.budget : 0) + 1024);
  var started = Date.now(),
    timer = timeoutMs
      ? setTimeout(function () {
          timedOut = true;
          abort();
        }, timeoutMs)
      : 0;
  try {
    var resp = await fetchCompatibleCompletion(requestRoute, body, controller.signal),
      json = await resp.json(),
      result = completionFromJsonResponse(json);
    if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
    if (!result.content.trim()) {
      var empty = new Error('API 返回空响应');
      empty.status = resp.status;
      empty.responseText = JSON.stringify(json);
      throw empty;
    }
    return {
      ok: true,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      model: route.model,
      content: result.content,
    };
  } catch (error) {
    if (timedOut) {
      var timeoutError = new Error('连通性测试超时（' + timeoutMs / 1000 + ' 秒）');
      timeoutError.interruptionReason = 'connection_timeout';
      throw timeoutError;
    }
    if (resp && !error.status) error.status = resp.status;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', abort);
  }
}
