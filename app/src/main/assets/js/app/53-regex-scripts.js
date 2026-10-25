// ===== Non-destructive regex scripts =====
var _regexScriptIdCounter = 0,
  _regexScriptEditorState = null,
  _regexScriptRuntimeReasons = Object.create(null),
  _regexScriptSafetyCache = new Map(),
  _regexScriptPlanCache = typeof WeakMap === 'function' ? new WeakMap() : null;
var _cardScriptTextCache = new Map(),
  _cardScriptSendCacheKeys = new Set(),
  _cardScriptTextPending = new Map(),
  _cardScriptStreamCacheKeys = new Map(),
  _cardScriptStreamTransforms = new Map(),
  _cardScriptTextFailures = new Set(),
  _cardScriptTextRevision = Object.create(null),
  _cardScriptVariableSignatures = new WeakMap(),
  _regexScriptDisplayReadScope = null,
  _cardScriptRerenderQueued = false,
  _cardScriptRerenderQueuedOwner = null,
  _cardScriptRerenderTargets = [],
  _cardScriptRerenderFull = false;
// The last display text settled for a (char, role, text), across depth/revision re-keys: the finished
// transform, or the original when a transform failed before this text ever had one. While the
// exact-key transform is still in the worker, the reading viewport keeps showing this snapshot
// instead of collapsing to an empty body; the rerender on completion converges to the exact result.
var _cardScriptDisplaySnapshots = new Map(),
  CARD_SCRIPT_DISPLAY_SNAPSHOT_LIMIT = 400;
function cardScriptDisplaySnapshotKey(char, role, text) {
  return [String((char && char.id) || ''), String(role || ''), String(text == null ? '' : text)].join('\u0000');
}
function rememberCardScriptDisplaySnapshot(char, role, text, value) {
  var key = cardScriptDisplaySnapshotKey(char, role, text);
  if (_cardScriptDisplaySnapshots.has(key)) _cardScriptDisplaySnapshots.delete(key);
  _cardScriptDisplaySnapshots.set(key, String(value == null ? '' : value));
  while (_cardScriptDisplaySnapshots.size > CARD_SCRIPT_DISPLAY_SNAPSHOT_LIMIT)
    _cardScriptDisplaySnapshots.delete(_cardScriptDisplaySnapshots.keys().next().value);
}
function cardScriptDisplaySnapshot(char, role, text) {
  var key = cardScriptDisplaySnapshotKey(char, role, text);
  return _cardScriptDisplaySnapshots.has(key) ? String(_cardScriptDisplaySnapshots.get(key)) : null;
}
function regexScriptOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}
function regexScriptBool(value, fallback) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return fallback;
}
function regexScriptCopy(value, label) {
  if (value == null) return value;
  return copyJsonData(value);
}
// The identity a stored row answers to; lookups compare this, never the raw field.
function regexScriptIdOf(script) {
  var value = script && typeof script === 'object' ? script.id : '';
  return String(value == null ? '' : value)
    .trim()
    .slice(0, 160);
}
function regexScriptNewId() {
  _regexScriptIdCounter++;
  return 'regex_' + (typeof uid === 'function' ? uid() : Date.now().toString(36) + '_' + _regexScriptIdCounter);
}
function regexScriptPlacementValues(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(function (item) {
      return Number(item);
    })
    .filter(function (item) {
      return Number.isFinite(item);
    });
}
function regexScriptTargetState(source) {
  source = source || {};
  if (
    regexScriptOwn(source, 'targetUser') ||
    regexScriptOwn(source, 'targetAssistant') ||
    regexScriptOwn(source, 'targetWorldBook')
  )
    return {
      user: source.targetUser === true,
      assistant: source.targetAssistant === true,
      worldBook: source.targetWorldBook === true,
    };
  var hasPlacement = regexScriptOwn(source, 'placement'),
    placements = regexScriptPlacementValues(source.placement);
  if (hasPlacement)
    return { user: placements.includes(1), assistant: placements.includes(2), worldBook: placements.includes(5) };
  return { user: false, assistant: true, worldBook: false };
}
// SillyTavern@7e8663cd unmarked scripts map onto both display and send; only saveEditMessage uses the edit phase.
function regexScriptPhaseState(source) {
  source = source || {};
  if (regexScriptOwn(source, 'applyDisplay') || regexScriptOwn(source, 'applySend'))
    return { display: source.applyDisplay === true, send: source.applySend === true };
  var markdown = regexScriptBool(source.markdownOnly, false),
    prompt = regexScriptBool(source.promptOnly, false);
  if (markdown || prompt) return { display: markdown, send: prompt };
  return { display: true, send: true };
}
// world-info.js runs WORLD_INFO scripts only with isPrompt, so an entry is rewritten only by a
// promptOnly script; an unmarked script rewrites chat text at its source in ST, a path entries do not
// have. A record without the official flag counts as promptOnly when it runs on send alone.
function regexScriptRewritesWorldBook(script) {
  return (
    script.targetWorldBook === true &&
    (script.promptOnly === true || (script.applySend === true && script.applyDisplay !== true))
  );
}
// trimStrings are removed from every capture group before it is inserted into the
// replacement, exactly as engine.js filterString does.
function regexScriptTrimStrings(source) {
  return (Array.isArray(source && source.trimStrings) ? source.trimStrings : [])
    .map(function (item) {
      return String(item == null ? '' : item);
    })
    .filter(function (item) {
      return item !== '';
    });
}
// engine.js accepts minDepth >= -1 and maxDepth >= 0; null, absent and NaN mean "no bound".
function regexScriptDepthValue(value, floor) {
  if (value == null || value === '') return null;
  var number = Number(value);
  return Number.isFinite(number) && number >= floor ? number : null;
}
// substitute_find_regex: 0 NONE, 1 RAW, 2 ESCAPED. Legacy cards store a boolean.
function regexScriptSubstituteMode(value) {
  var number = Number(value);
  if (number === 1 || number === 2) return number;
  if (value === true) return 1;
  return 0;
}
function regexScriptOfficialPhaseFlag(source, key) {
  source = source && typeof source === 'object' ? source : {};
  if (regexScriptOwn(source, key)) return regexScriptBool(source[key], false);
  var raw = source.raw && typeof source.raw === 'object' && !Array.isArray(source.raw) ? source.raw : null;
  return raw && regexScriptOwn(raw, key) ? regexScriptBool(raw[key], false) : false;
}
function normalizeRegexScriptRecord(source, options) {
  source = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  options = options || {};
  var targets = regexScriptTargetState(source),
    phases = regexScriptPhaseState(source),
    enabled,
    markdownOnly = regexScriptOfficialPhaseFlag(source, 'markdownOnly'),
    promptOnly = regexScriptOfficialPhaseFlag(source, 'promptOnly');
  if (regexScriptOwn(source, 'enabled')) enabled = source.enabled !== false;
  else if (regexScriptOwn(source, 'disabled')) enabled = !regexScriptBool(source.disabled, false);
  else enabled = options.imported === true ? false : true;
  var raw =
      source.raw && typeof source.raw === 'object' && !Array.isArray(source.raw)
        ? regexScriptCopy(source.raw, '正则脚本原始字段')
        : options.imported === true
          ? regexScriptCopy(source, '导入的正则脚本')
          : {},
    id = regexScriptIdOf(source) || regexScriptNewId();
  var record = {
    id: id,
    name:
      String(source.name || source.scriptName || options.fallbackName || '未命名脚本')
        .trim()
        .slice(0, 120) || '未命名脚本',
    findRegex: String(source.findRegex ?? source.find ?? ''),
    replaceString: String(source.replaceString ?? source.replacement ?? ''),
    targetUser: targets.user,
    targetAssistant: targets.assistant,
    targetWorldBook: targets.worldBook,
    applyDisplay: phases.display,
    applySend: phases.send,
    markdownOnly: markdownOnly,
    promptOnly: promptOnly,
    trimStrings: regexScriptTrimStrings(source),
    minDepth: regexScriptDepthValue(source.minDepth, -1),
    maxDepth: regexScriptDepthValue(source.maxDepth, 0),
    substituteRegex: regexScriptSubstituteMode(source.substituteRegex),
    runOnEdit: source.runOnEdit === true,
    enabled: enabled,
    imported: source.imported === true || options.imported === true,
    raw: raw,
  };
  var owner = regexScriptGlobalOwnerId(source);
  if (owner) record.ownerCharacterId = owner;
  return record;
}
// A global row written by a card script through TavernHelper records the character whose script
// wrote it and applies to that character only; a row without an owner is the user's own and
// applies to everyone. Ids are unique per owner, so two cards may keep rows with the same id.
function regexScriptGlobalOwnerId(script) {
  var value = script && typeof script === 'object' ? script.ownerCharacterId : '';
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
function regexScriptGlobalVisibleTo(script, char) {
  var owner = regexScriptGlobalOwnerId(script);
  return !owner || (!!char && owner === String(char.id || ''));
}
function regexScriptGlobalSlot(script) {
  return regexScriptGlobalOwnerId(script) + '\n' + String((script && script.id) || '');
}
function removeCharacterOwnedRegexScripts(charId, journal) {
  var owner = String(charId || ''),
    list = D && D.settings && Array.isArray(D.settings.regexScripts) ? D.settings.regexScripts : [],
    removed = false;
  if (!owner) return false;
  for (var index = list.length - 1; index >= 0; index--) {
    if (regexScriptGlobalOwnerId(list[index]) !== owner) continue;
    journal.splice(list, index, 1);
    removed = true;
  }
  return removed;
}
function normalizeRegexScriptList(list, options) {
  var seen = Object.create(null);
  return (Array.isArray(list) ? list : [])
    .filter(function (row) {
      return row && typeof row === 'object' && !Array.isArray(row);
    })
    .map(function (row, index) {
      var normalized = normalizeRegexScriptRecord(
          row,
          Object.assign({}, options || {}, { fallbackName: '导入脚本 ' + (index + 1) })
        ),
        base = normalized.id,
        suffix = 2;
      while (seen[regexScriptGlobalSlot(normalized)]) normalized.id = base + '_' + suffix++;
      seen[regexScriptGlobalSlot(normalized)] = true;
      return normalized;
    });
}
function normalizeRegexScriptCollections(data) {
  if (!data || typeof data !== 'object') return false;
  var changed = false,
    settings = data.settings && typeof data.settings === 'object' ? data.settings : null;
  if (settings && Array.isArray(settings.regexScripts)) {
    var globalBefore = JSON.stringify(settings.regexScripts),
      globalAfter = normalizeRegexScriptList(settings.regexScripts);
    if (JSON.stringify(globalAfter) !== globalBefore) {
      settings.regexScripts = globalAfter;
      changed = true;
    }
  }
  (Array.isArray(data.characters) ? data.characters : []).forEach(function (char) {
    if (!char || !Array.isArray(char.regexScripts)) return;
    var before = JSON.stringify(char.regexScripts),
      after = normalizeRegexScriptList(char.regexScripts);
    if (JSON.stringify(after) !== before) {
      char.regexScripts = after;
      changed = true;
    }
  });
  if (changed) invalidateRegexScriptRuntimeCache();
  return changed;
}
// SillyTavern utils.js regexFromString: "/pattern/flags" only when the flags are a set of distinct
// known letters; otherwise the whole input is a bare expression, so "/abc" matches the text "/abc".
function regexScriptLiteralParts(value) {
  var source = String(value || '').trim();
  if (!source) return { valid: false, reason: '查找正则不能为空' };
  var match = /(\/?)(.+)\1([a-z]*)/i.exec(source);
  if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3]))
    return { valid: true, pattern: source, flags: '', literal: false };
  return { valid: true, pattern: match[2], flags: match[3], literal: !!match[1] };
}
// Regex validation is compile-only; matches run in a terminable worker.
function regexScriptSafety(source) {
  var cacheKey = String(source || ''),
    cached = _regexScriptSafetyCache.get(cacheKey);
  if (cached) return cached;
  var parsed = regexScriptLiteralParts(source),
    store = function (value) {
      _regexScriptSafetyCache.set(cacheKey, value);
      return value;
    };
  if (!parsed.valid) return store(parsed);
  if (!parsed.pattern) return store({ valid: false, reason: '正则模式不能为空' });
  try {
    new RegExp(parsed.pattern, parsed.flags);
  } catch (_) {
    return store({ valid: false, reason: '正则语法无效，或当前设备无法使用这些选项' });
  }
  return store({ valid: true, pattern: parsed.pattern, flags: parsed.flags, literal: parsed.literal });
}
function invalidateRegexScriptRuntimeCache() {
  _regexScriptSafetyCache.clear();
  _regexScriptPlanCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  _regexScriptRuntimeReasons = Object.create(null);
  _cardScriptTextCache.clear();
  _cardScriptStreamCacheKeys.clear();
  _cardScriptTextFailures.clear();
  dropStreamRegexPreviews();
}
function regexScriptMacroCountName(key) {
  return String(key || '')
    .split(/[\s:]/)[0]
    .toLowerCase();
}
// Keys are the macro as written, parameters included, so {{match}} is dropped by name.
function regexScriptDropMacroCount(counts, name) {
  Object.keys(counts).forEach(function (key) {
    if (regexScriptMacroCountName(key) === name) delete counts[key];
  });
  return counts;
}
function regexScriptUnrecognizedReplacementMacros(value) {
  if (typeof characterMacroUnsupportedCounts === 'function')
    return regexScriptDropMacroCount(characterMacroUnsupportedCounts(value), 'match');
  var supported = {
      match: 1,
      char: 1,
      user: 1,
      random: 1,
      pick: 1,
      roll: 1,
      reverse: 1,
      comment: 1,
      setvar: 1,
      getvar: 1,
      else: 1,
      if: 1,
    },
    counts = {},
    re = /\{\{\s*(?:[#/:]*([A-Za-z_][\w]*)((?:::?)[^{}]*)?|(\?))/g,
    match;
  while ((match = re.exec(String(value || '')))) {
    var written = String(match[1] || match[3] || ''),
      name = written.toLowerCase();
    if (!name || supported[name]) continue;
    written += String(match[2] || '').replace(/\s+$/, '');
    counts[written] = (counts[written] || 0) + 1;
  }
  return counts;
}
function regexScriptPlan(source) {
  source = source && typeof source === 'object' ? source : {};
  var signature = [
      source.id,
      source.name,
      source.findRegex,
      source.find,
      source.replaceString,
      source.replacement,
      source.targetUser,
      source.targetAssistant,
      source.targetWorldBook,
      source.applyDisplay,
      source.applySend,
      source.enabled,
      source.disabled,
      JSON.stringify(source.trimStrings || []),
      source.minDepth,
      source.maxDepth,
      source.substituteRegex,
      source.runOnEdit,
      JSON.stringify(source.placement == null ? null : source.placement),
      source.markdownOnly,
      source.promptOnly,
    ].join('\u0000'),
    cached = _regexScriptPlanCache && _regexScriptPlanCache.get(source);
  if (cached && cached.signature === signature) return cached;
  var script = normalizeRegexScriptRecord(source),
    safety = regexScriptSafety(script.findRegex),
    replacementMacros = regexScriptUnrecognizedReplacementMacros(script.replaceString);
  // An unrecognised macro never blocks the script: engine.js substitutes unconditionally and
  // macros.js leaves an unknown marker in place, so the replacement runs with the marker kept.
  var reason =
      !script.targetUser && !script.targetAssistant && !script.targetWorldBook
        ? '没有选择当前支持的作用对象'
        : script.targetWorldBook &&
            !script.targetUser &&
            !script.targetAssistant &&
            !regexScriptRewritesWorldBook(script)
          ? '世界书只由仅勾选“发送给 AI”的脚本改写'
          : !script.applyDisplay && !script.applySend
            ? '没有选择作用环节'
            : !safety.valid
              ? safety.reason
              : '',
    plan = {
      signature: signature,
      script: script,
      safety: safety,
      replacementMacros: replacementMacros,
      reason: reason,
    };
  if (_regexScriptPlanCache) _regexScriptPlanCache.set(source, plan);
  return plan;
}
function regexScriptStaticReason(script) {
  return regexScriptPlan(script).reason;
}
// kind names the one reason the script cannot run; macros is reported alongside any kind, because an
// unrecognised macro is kept verbatim and never stops the script.
function regexScriptStaticStatus(script) {
  var plan = regexScriptPlan(script),
    normalized = plan.script,
    macros = plan.replacementMacros;
  if (!normalized.targetUser && !normalized.targetAssistant && !normalized.targetWorldBook)
    return { kind: 'target', reason: plan.reason, worldBook: false, macros: macros };
  if (
    (normalized.targetWorldBook && !normalized.targetUser && !normalized.targetAssistant && !normalized.applySend) ||
    (!normalized.applyDisplay && !normalized.applySend)
  )
    return { kind: 'phase', reason: plan.reason, worldBook: normalized.targetWorldBook, macros: macros };
  if (!plan.safety.valid) return { kind: 'safety', reason: plan.reason, worldBook: false, macros: macros };
  return { kind: '', reason: '', worldBook: false, macros: macros };
}
function regexScriptCharacterName(char) {
  return typeof canonicalCharacterName === 'function'
    ? canonicalCharacterName(char)
    : String((char && char.name) || '角色');
}
function regexScriptUserName(char) {
  var persona = typeof getActivePersona === 'function' ? getActivePersona(char && char.id) : null;
  return String((persona && persona.name) || '用户');
}
function regexScriptRuntimeKey(scope, ownerId, scriptId) {
  return [String(scope || ''), String(ownerId || ''), String(scriptId || '')].join(':');
}
// The single execution source for SillyTavern-dialect scripts: the global scripts this character
// sees (the user's own plus those its card scripts wrote) plus the character's own list.
function effectiveRegexScriptRows(char) {
  if (isRisuCharacter(char)) return [];
  var rows = [],
    globals = D && D.settings && Array.isArray(D.settings.regexScripts) ? D.settings.regexScripts : [],
    preset = typeof activeCompletionPresetRaw === 'function' ? activeCompletionPresetRaw() : null,
    presetScripts =
      preset && preset.extensions && Array.isArray(preset.extensions.regex_scripts)
        ? preset.extensions.regex_scripts
        : [];
  globals.forEach(function (script) {
    if (!regexScriptGlobalVisibleTo(script, char)) return;
    rows.push({ scope: 'global', ownerId: regexScriptGlobalOwnerId(script), script: script });
  });
  if (typeof _promptTemplateRegexes !== 'undefined')
    _promptTemplateRegexes.basic.forEach(function (script) {
      rows.push({ scope: 'template', ownerId: '', script: script });
    });
  presetScripts.forEach(function (script) {
    rows.push({ scope: 'preset', ownerId: 'in_use', script: script });
  });
  if (char && Array.isArray(char.regexScripts))
    char.regexScripts.forEach(function (script) {
      rows.push({ scope: 'character', ownerId: String(char.id || ''), script: script });
    });
  return rows;
}
// ---- execution ----
// Display and send phases are warmed before read; an unwarmed display read yields no text.
function cardScriptSessionKey(char) {
  var session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  return session ? String(session.id || session.createdAt || '') : '';
}
function cardScriptTextRevision(char) {
  var key = String((char && char.id) || '');
  return _cardScriptTextRevision[key] || 0;
}
function invalidateCardScriptDisplayCache(char) {
  var key = String((char && char.id) || '');
  if (char) _cardScriptTextRevision[key] = (_cardScriptTextRevision[key] || 0) + 1;
  else
    Object.keys(_cardScriptTextRevision).forEach(function (id) {
      _cardScriptTextRevision[id]++;
    });
  _cardScriptTextCache.clear();
  _cardScriptStreamCacheKeys.clear();
  _cardScriptTextFailures.clear();
  dropStreamRegexPreviews();
}
// A failed transform writes no terminal cache entry, so it stays eligible for retry. Keeping the body
// readable is the original-text display snapshot the failure records, which every render reads through
// the ordinary snapshot path. The sentinel has one job left: a repaint that a failure asked for must
// not re-enter a transform that just failed. Only the key's own reader spends it: an ordinary render
// deletes it and retries that one key, so a failure never reschedules a neighbour's transform and two
// failing sources cannot take turns rescheduling each other. The set is keyed exactly like
// `_cardScriptTextCache` and is its complement — a key that settles goes to the cache, a key that
// fails stays here — so it is bounded by the same key space and emptied by the same two invalidations.
function rememberCardScriptTextFailure(key) {
  _cardScriptTextFailures.add(key);
}
function cardScriptTextFailureHolds(key) {
  if (!_cardScriptTextFailures.has(key)) return false;
  if (_cardScriptFailureRepaint) return true;
  _cardScriptTextFailures.delete(key);
  return false;
}
function cardScriptTextKey(char, role, phase, value, depth) {
  return [
    String((char && char.id) || ''),
    cardScriptSessionKey(char),
    cardScriptTextRevision(char),
    String(role || ''),
    String(phase || ''),
    depth == null ? '' : String(depth),
    String(value == null ? '' : value),
  ].join('\u0000');
}
var _regexScriptSendMisses = [];
// engine.js: minDepth >= -1 and maxDepth >= 0 bound how far back a message may be. A caller
// that does not know the depth passes nothing and no depth filtering happens.
function regexScriptDepthAllows(script, depth) {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return true;
  if (script.minDepth != null && depth < script.minDepth) return false;
  if (script.maxDepth != null && depth > script.maxDepth) return false;
  return true;
}
// engine.js sanitizeRegexMacro: the ESCAPED post-process for each macro value inserted into a pattern.
function regexScriptSanitizeMacroValue(value) {
  var controls = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v', '\f': '\\f', '\0': '\\0' };
  return String(value).replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g, function (ch) {
    return controls[ch] || '\\' + ch;
  });
}
// substitute_find_regex: engine.js expands macros over the whole findRegex before parsing it.
// RAW inserts macro values as they are; ESCAPED escapes only those values, so the pattern's own
// syntax such as (.*?) keeps working. Macros need main thread state, so this runs before the
// pattern is handed to the worker.
function regexScriptFindSource(script, char) {
  if (!script.substituteRegex || typeof replaceCharacterMacros !== 'function') return script.findRegex;
  return String(
    replaceCharacterMacros(
      script.findRegex,
      char,
      regexScriptUserName(char),
      regexScriptMacroState(char, 'find\u0000' + regexScriptFingerprint(script)),
      script.substituteRegex === 2 ? { postProcess: regexScriptSanitizeMacroValue } : null
    )
  );
}
// A script's transform result depends only on its own unchanging content, and flags travel inside
// the findRegex literal. Fingerprinting that content once per script object keeps the display cache
// key short and stable even when macro expansion rewrites the pattern on every evaluation; macro
// value changes still invalidate through regexScriptScopeId / cardScriptTextRevision.
var _regexScriptFingerprints = typeof WeakMap === 'function' ? new WeakMap() : null;
function regexScriptFingerprint(script) {
  if (!script || typeof script !== 'object') return '0';
  if (_regexScriptFingerprints && _regexScriptFingerprints.has(script)) return _regexScriptFingerprints.get(script);
  var text = JSON.stringify([
      String(script.findRegex == null ? '' : script.findRegex),
      script.substituteRegex,
      String(script.replaceString == null ? '' : script.replaceString),
      Array.isArray(script.trimStrings) ? script.trimStrings : [],
    ]),
    a = 2166136261,
    b = 2654435769;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 16777619);
    b ^= code;
    b = Math.imul(b, 2246822519);
    b = (b << 13) | (b >>> 19);
  }
  var print = (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36) + '.' + text.length;
  if (_regexScriptFingerprints) _regexScriptFingerprints.set(script, print);
  return print;
}
function regexTransformOps(char, role, phase, depth) {
  var ops = [];
  if (phase === 'display' || phase === 'send' || phase === 'edit')
    effectiveRegexScriptRows(char).forEach(function (row) {
      if (row.scope === 'character' && !cardRegexesEnabled(char)) return;
      var plan = regexScriptPlan(row.script),
        script = plan.script;
      if (!script.enabled || plan.reason) return;
      if (phase === 'edit') {
        if (!script.runOnEdit || script.markdownOnly || script.promptOnly) return;
      } else {
        if (phase === 'display' && !script.applyDisplay) return;
        if (phase === 'send' && !script.applySend) return;
      }
      if (role === 'user' && !script.targetUser) return;
      if (role === 'assistant' && !script.targetAssistant) return;
      if (role === 'worldbook' && !regexScriptRewritesWorldBook(script)) return;
      // The fixed ST edit call omits depth, so minDepth/maxDepth never filter edit saves.
      if (phase !== 'edit' && !regexScriptDepthAllows(script, depth)) return;
      var safety = script.substituteRegex ? regexScriptSafety(regexScriptFindSource(script, char)) : plan.safety;
      if (!safety.valid) return;
      var runtimeKey = regexScriptRuntimeKey(row.scope, row.ownerId, script.id);
      ops.push({
        pattern: safety.pattern,
        flags: safety.flags,
        replaceString: script.replaceString,
        trimStrings: script.trimStrings,
        runtimeKey: runtimeKey,
        fingerprint: regexScriptFingerprint(script),
      });
    });
  return ops;
}
function regexScriptEditCount(char, role) {
  return regexTransformOps(char, role, 'edit').length;
}
async function applyRegexScriptsForEdit(value, role, char) {
  if (isRisuCharacter(char)) return String(value == null ? '' : value);
  return runRegexTransform(char, role, 'edit', String(value == null ? '' : value));
}
function regexScriptDisplaySourceText(value, role, phase) {
  var text = String(value == null ? '' : value);
  if (role !== 'assistant' || phase !== 'display') return text;
  // Complete blocks still reach the card's ordered regexes (some repair body markup).
  // Only an unfinished ERA block is hidden, before status placeholders become HTML.
  var tokens =
      /^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*|<\s*(\/?)\s*(variable(?:think|insert|edit|delete)|era_data)(?=\s|\/?>)[^>]*>|<\s*StatusPlaceHolderImpl\s*\/\s*>/gim,
    active = null,
    fence = '',
    removed = [],
    token;
  while ((token = tokens.exec(text))) {
    if (token[1]) {
      if (!active) {
        if (!fence) fence = token[1];
        else if (token[1][0] === fence[0] && token[1].length >= fence.length && token[0].trim() === token[1])
          fence = '';
      }
      continue;
    }
    if (fence) continue;
    if (!token[3]) {
      if (active) removed.push([active.start, token.index]);
      active = null;
    } else if (token[2]) {
      if (active && active.name === token[3].toLowerCase()) active = null;
    } else if (!/\/\s*>$/.test(token[0])) {
      if (active) removed.push([active.start, token.index]);
      active = { name: token[3].toLowerCase(), start: token.index };
    }
  }
  if (active) removed.push([active.start, text.length]);
  for (var index = removed.length - 1; index >= 0; index--)
    text = text.slice(0, removed[index][0]) + text.slice(removed[index][1]);
  return text;
}
async function runRegexTransform(char, role, phase, value, depth, options) {
  if (isRisuCharacter(char)) return String(value == null ? '' : value);
  var ops = regexTransformOps(char, role, phase, depth),
    text = regexScriptDisplaySourceText(value, role, phase);
  if (!ops.length) return text;
  var handle = scriptWorkerHandle(cardRegexWorkerName(char)),
    state = regexScriptMacroState(
      char,
      [role, phase, depth == null ? '' : depth, text]
        .concat(
          ops.map(function (op) {
            return op.fingerprint;
          })
        )
        .join('\u0000')
    ),
    failure = null;
  if (typeof markCardScriptRunning === 'function') markCardScriptRunning(char, '正则脚本');
  try {
    for (var index = 0; index < ops.length; index++) {
      var op = ops[index];
      var parts = await callScriptWorker(
        handle,
        {
          type: 'standardRegexParts',
          input: text,
          pattern: op.pattern,
          flags: op.flags,
          replaceString: op.replaceString,
          trimStrings: op.trimStrings,
        },
        options
      );
      text = regexScriptAssembleParts(parts, char, state, op.trimStrings);
    }
    return text;
  } catch (error) {
    failure = error;
    if (error.name !== 'AbortError' && op.runtimeKey)
      _regexScriptRuntimeReasons[op.runtimeKey] = String((error && error.message) || error);
    throw error;
  } finally {
    if (typeof markCardScriptFinished === 'function')
      markCardScriptFinished(char, failure && failure.name !== 'AbortError' ? failure : null);
  }
}
// A stream slot is only ever worth its newest prefix. Each slot keeps a lane holding the one
// transform inside the worker plus at most one request waiting behind it; a newer prefix replaces the
// waiting request instead of queueing another, so worker depth and worker calls follow repaints
// rather than the provider's fragment count. The slot is part of the owner key, so a continuation's
// body and objective own separate lanes and neither can starve the other. The transform already in
// the worker is left to finish: aborting it discards the whole worker and hands its other calls to a
// replacement, which costs more than the single chain it would save, and one chain is a constant
// either way.
function cardScriptStreamLane(owner) {
  var lane = _cardScriptStreamTransforms.get(owner);
  if (!lane) {
    lane = { running: null, queued: null };
    _cardScriptStreamTransforms.set(owner, lane);
  }
  return lane;
}
function dropQueuedStreamTransform(lane) {
  var request = lane.queued;
  if (!request) return;
  lane.queued = null;
  _cardScriptTextPending.delete(request.key);
  // A preview carries no repaint target of its own, but an ordinary display reader may have joined
  // the same text while this request waited. That reader reschedules itself on its next render, so it
  // is asked for one instead of being left on its stand-in.
  if (request.pending.targets.length) requestCardScriptRerender(null, request.pending.targets);
}
// The stream stopped producing prefixes, or the display cache was invalidated: a waiting preview can
// only compete with this reply's final display transform for the same worker, so it is dropped before
// that one is asked for. A lane with nothing in the worker goes with it; a running lane stays until
// its own completion releases the slot.
function dropStreamRegexPreviews() {
  _cardScriptStreamTransforms.forEach(function (lane, owner) {
    dropQueuedStreamTransform(lane);
    if (!lane.running) _cardScriptStreamTransforms.delete(owner);
  });
}
function releaseStreamRegexPreview(request) {
  var lane = request.lane;
  if (!lane || lane.running !== request) return;
  lane.running = lane.queued;
  lane.queued = null;
  if (lane.running) startRegexTransform(lane.running);
  else if (_cardScriptStreamTransforms.get(request.owner) === lane) _cardScriptStreamTransforms.delete(request.owner);
}
function startRegexTransform(request) {
  var char = request.char,
    role = request.role,
    phase = request.phase,
    value = request.value,
    key = request.key,
    pending = request.pending,
    suppressRerender = request.options.streamPreview === true,
    streamCacheOwner = request.owner,
    rerenderOwner = phase === 'display' && !suppressRerender ? rrKey(char) : null;
  runRegexTransform(char, role, phase, value, request.depth, request.options).then(
    function (text) {
      _cardScriptTextPending.delete(key);
      var current = phase !== 'display' || key.endsWith('\u0000' + regexScriptScopeId(char, phase));
      if (!current) {
        releaseStreamRegexPreview(request);
        pending.listeners.forEach(function (notify) {
          notify(String(value == null ? '' : value));
        });
        return;
      }
      if (!suppressRerender || _cardScriptStreamCacheKeys.get(streamCacheOwner) === key)
        cacheRegexScriptText(key, text, phase);
      if (phase === 'display' && !suppressRerender) rememberCardScriptDisplaySnapshot(char, role, value, text);
      releaseStreamRegexPreview(request);
      pending.listeners.forEach(function (notify) {
        notify(text);
      });
      if (phase === 'display' && !suppressRerender) requestCardScriptRerender(rerenderOwner, pending.targets);
    },
    function (error) {
      _cardScriptTextPending.delete(key);
      // Worker failures are transient. A failed original must remain eligible for retry, so no
      // terminal cache entry is written; what keeps the body readable is this text's display
      // snapshot, which every later render sees — not only the one repaint below. A text that has
      // no snapshot yet (the cold render this failure interrupted) takes the original, while a text
      // that already rendered keeps that finished result: a load spike that times out one re-key
      // must not drop a laid-out card frontend back to its raw tags. A stop lands here too.
      releaseStreamRegexPreview(request);
      pending.listeners.forEach(function (notify) {
        notify(String(value == null ? '' : value));
      });
      if (phase !== 'display' || suppressRerender || !key.endsWith('\u0000' + regexScriptScopeId(char, phase))) return;
      if (cardScriptDisplaySnapshot(char, role, value) == null)
        rememberCardScriptDisplaySnapshot(char, role, value, value);
      rememberCardScriptTextFailure(key);
      if (error && error.name === 'AbortError') return;
      // Exactly one repaint, held by the sentinel, so a failure cannot re-enter its own retry.
      requestCardScriptRerender(rerenderOwner, pending.targets, true);
    }
  );
}
function scheduleRegexTransform(char, role, phase, value, key, depth, options) {
  var listenerKey =
      String((options && options.streamDisplaySlot) || 'body') +
      '\u0000' +
      String(Number(options && options.streamDisplayRevision) || 0),
    listener =
      options && options.streamPreview === true && typeof options.onStreamDisplayComplete === 'function'
        ? function (text) {
            options.onStreamDisplayComplete({
              slot: String(options.streamDisplaySlot || 'body'),
              revision: Number(options.streamDisplayRevision) || 0,
              text: String(text == null ? '' : text),
              key: key,
              async: true,
            });
          }
        : null,
    streamCacheOwner =
      options && options.streamPreview === true && typeof options.onStreamDisplayComplete === 'function'
        ? [String(role || ''), String(phase || ''), String(options.streamDisplaySlot || 'body')].join('\u0000')
        : '',
    pending = _cardScriptTextPending.get(key),
    target =
      phase === 'display' && options && options.message && Number.isInteger(options.index)
        ? {
            charId: String(char.id),
            sessionId: cardScriptSessionKey(char),
            index: options.index,
            message: options.message,
          }
        : null;
  if (streamCacheOwner) {
    var previousStreamKey = _cardScriptStreamCacheKeys.get(streamCacheOwner);
    if (previousStreamKey && previousStreamKey !== key) _cardScriptTextCache.delete(previousStreamKey);
    _cardScriptStreamCacheKeys.set(streamCacheOwner, key);
  }
  if (pending) {
    if (
      target &&
      !pending.targets.some(function (item) {
        return item.index === target.index && item.message === target.message;
      })
    )
      pending.targets.push(target);
    if (listener && !pending.listenerKeys[listenerKey]) {
      pending.listenerKeys[listenerKey] = true;
      pending.listeners.push(listener);
    }
    return;
  }
  pending = {
    listeners: listener ? [listener] : [],
    listenerKeys: Object.create(null),
    targets: target ? [target] : [],
  };
  if (listener) pending.listenerKeys[listenerKey] = true;
  _cardScriptTextPending.set(key, pending);
  var request = {
    lane: null,
    owner: streamCacheOwner,
    char: char,
    role: role,
    phase: phase,
    value: value,
    key: key,
    depth: depth,
    options: Object.assign({}, options || {}, { depth: depth }),
    pending: pending,
  };
  if (streamCacheOwner) {
    var lane = cardScriptStreamLane(streamCacheOwner);
    request.lane = lane;
    if (lane.running) {
      dropQueuedStreamTransform(lane);
      lane.queued = request;
      return;
    }
    lane.running = request;
  }
  startRegexTransform(request);
}
// Finished display work owns one page (character/session/viewport context); stale owners are dropped.
var _cardScriptRerenderDeferred = false,
  _cardScriptRerenderDeferredOwner = null,
  _cardScriptRerenderFromFailure = false,
  _cardScriptFailureRepaint = false;
function rrKey(s) {
  if (!s) return null;
  var z = s.id && typeof getActiveSession === 'function' ? getActiveSession(s.id) : null,
    t =
      s.charId && s.sessionId
        ? s
        : { charId: String(s.id || ''), sessionId: String((z && z.id) || ''), viewportContextId: null },
    i = typeof currentChatViewportIdentity === 'function' ? currentChatViewportIdentity() : null,
    c = t.viewportContextId;
  if (
    c == null &&
    typeof _chatViewportOwner !== 'undefined' &&
    _chatViewportOwner &&
    i &&
    i.charId === t.charId &&
    i.sessionId === t.sessionId
  )
    c = _chatViewportOwner.contextId;
  return {
    charId: String(t.charId || ''),
    sessionId: String(t.sessionId || ''),
    contextId: c == null ? null : Number(c),
  };
}
function rrNow() {
  var i = typeof currentChatViewportIdentity === 'function' ? currentChatViewportIdentity() : null;
  return {
    charId: String((i && i.charId) || ''),
    sessionId: String((i && i.sessionId) || ''),
    contextId:
      typeof _chatViewportOwner !== 'undefined' && _chatViewportOwner
        ? Number(_chatViewportOwner.contextId) || null
        : null,
  };
}
function rrMatch(a, b) {
  return (
    !!a &&
    !!b &&
    a.charId === b.charId &&
    a.sessionId === b.sessionId &&
    a.contextId != null &&
    b.contextId != null &&
    a.contextId === b.contextId
  );
}
function requestCardScriptRerender(owner, targets, fromFailure) {
  owner = owner || rrNow();
  if (_cardScriptRerenderQueued) {
    var n = rrNow();
    if (_cardScriptRerenderQueuedOwner && n && !rrMatch(_cardScriptRerenderQueuedOwner, n) && rrMatch(owner, n)) {
      _cardScriptRerenderQueuedOwner = owner;
      _cardScriptRerenderTargets = [];
      _cardScriptRerenderFull = false;
      _cardScriptRerenderFromFailure = false;
    } else if (!rrMatch(owner, _cardScriptRerenderQueuedOwner)) return;
  } else {
    _cardScriptRerenderQueued = true;
    _cardScriptRerenderQueuedOwner = owner;
  }
  if (fromFailure === true) _cardScriptRerenderFromFailure = true;
  if (!targets || !targets.length) _cardScriptRerenderFull = true;
  else if (!_cardScriptRerenderFull)
    targets.forEach(function (target) {
      if (_cardScriptRerenderFull) return;
      if (_cardScriptRerenderTargets.length >= 200) {
        _cardScriptRerenderFull = true;
        _cardScriptRerenderTargets = [];
      } else if (
        !_cardScriptRerenderTargets.some(function (queued) {
          return queued.index === target.index && queued.message === target.message;
        })
      )
        _cardScriptRerenderTargets.push(target);
    });
  if (_cardScriptRerenderQueuedFrame) return;
  var flush = function () {
    clearTimeout(_cardScriptRerenderFallbackTimer);
    _cardScriptRerenderFallbackTimer = 0;
    if (_cardScriptRerenderQueuedFrame) cancelAnimationFrame(_cardScriptRerenderQueuedFrame);
    _cardScriptRerenderQueuedFrame = 0;
    _cardScriptRerenderQueued = false;
    var q = _cardScriptRerenderQueuedOwner;
    _cardScriptRerenderQueuedOwner = null;
    var queuedTargets = _cardScriptRerenderTargets,
      full = _cardScriptRerenderFull,
      fromFailure = _cardScriptRerenderFromFailure;
    _cardScriptRerenderTargets = [];
    _cardScriptRerenderFull = false;
    _cardScriptRerenderFromFailure = false;
    if (q && !rrMatch(q, rrNow())) return;
    if (typeof _activeStreamRepaint === 'function' && _activeStreamRepaint()) {
      _cardScriptRerenderDeferred = true;
      _cardScriptRerenderDeferredOwner = q;
      return;
    }
    // The readable stand-in is already in the display snapshots, so a repaint a failure asked for
    // has nothing to fetch; it must not spend itself retrying the transforms that just failed. Every
    // key that has failed is held for the whole repaint, including the ones this repaint did not ask
    // for: a no-target failure falls back to a full render, and rescheduling its neighbours there
    // would put them back in the queue to fail and repaint again. Each key leaves the set when an
    // ordinary render reads it.
    _cardScriptFailureRepaint = fromFailure;
    try {
      if (!full && typeof patchRegexDisplayMessages === 'function') full = !patchRegexDisplayMessages(queuedTargets);
      else full = true;
      if (full && typeof renderChat === 'function') renderChat();
    } finally {
      _cardScriptFailureRepaint = false;
    }
  };
  _cardScriptRerenderQueuedFrame = requestAnimationFrame(flush);
  _cardScriptRerenderFallbackTimer = setTimeout(flush, 250);
}
var _cardScriptRerenderQueuedFrame = 0;
var _cardScriptRerenderFallbackTimer = 0;
function flushDeferredCardScriptRerender(target) {
  if (!_cardScriptRerenderDeferred) return false;
  var e = arguments.length ? rrKey(target) : null;
  if (_cardScriptRerenderDeferredOwner && e && !rrMatch(_cardScriptRerenderDeferredOwner, e)) {
    _cardScriptRerenderDeferred = false;
    _cardScriptRerenderDeferredOwner = null;
    return false;
  }
  // The full flush already includes any completion queued for this same frame.
  if (_cardScriptRerenderQueued && rrMatch(_cardScriptRerenderQueuedOwner, e)) {
    cancelAnimationFrame(_cardScriptRerenderQueuedFrame);
    _cardScriptRerenderQueuedFrame = 0;
    clearTimeout(_cardScriptRerenderFallbackTimer);
    _cardScriptRerenderFallbackTimer = 0;
    _cardScriptRerenderQueued = false;
    _cardScriptRerenderQueuedOwner = null;
    _cardScriptRerenderTargets = [];
    _cardScriptRerenderFull = false;
    _cardScriptRerenderFromFailure = false;
  }
  _cardScriptRerenderDeferred = false;
  _cardScriptRerenderDeferredOwner = null;
  if (typeof renderChat !== 'function') return false;
  // An ordinary render: it is not held, so every failed key it reads retries itself once.
  renderChat();
  return true;
}
function clearDeferredCardScriptRerender(target) {
  if (!_cardScriptRerenderDeferred) return false;
  if (arguments.length) {
    var e = rrKey(target);
    if (_cardScriptRerenderDeferredOwner && e && !rrMatch(_cardScriptRerenderDeferredOwner, e)) return false;
  }
  _cardScriptRerenderDeferred = false;
  _cardScriptRerenderDeferredOwner = null;
  return true;
}
// ---- evaluation scope ----
// One scope shares one macro state; a new user send opens a new scope. While a generation assembles, its round
// hands each transform its own random stream by what the transform is, so a draw never depends on which other
// texts were transformed first or were already cached.
var _regexScriptRoundRandom = null;
var _regexScriptScopeSeq = 0,
  _regexScriptSendScope = 0;
function beginRegexScriptSendScope() {
  _cardScriptSendCacheKeys.forEach(function (key) {
    _cardScriptTextCache.delete(key);
  });
  _cardScriptSendCacheKeys.clear();
  _regexScriptScopeSeq++;
  _regexScriptSendScope = _regexScriptScopeSeq;
  if (typeof resetWorldBookRegexKeyScope === 'function') resetWorldBookRegexKeyScope();
  return _regexScriptSendScope;
}
function cacheRegexScriptText(key, text, phase) {
  if (phase === 'send') {
    if (!key.endsWith('\u0000s' + _regexScriptSendScope)) return;
    _cardScriptSendCacheKeys.add(key);
  }
  _cardScriptTextCache.set(key, text);
}
function regexScriptScopeId(char, phase) {
  if (phase === 'send') return 's' + _regexScriptSendScope;
  if (_regexScriptDisplayReadScope && _regexScriptDisplayReadScope.char === char)
    return _regexScriptDisplayReadScope.id;
  var session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    signature = JSON.stringify([
      (session && session.macroVars) || {},
      (typeof D !== 'undefined' && D.settings && D.settings.stscript && D.settings.stscript.globalVars) || {},
    ]),
    previous = _cardScriptVariableSignatures.get(char);
  if (!previous || previous.signature !== signature) {
    if (previous) {
      var ending = '\u0000d' + cardScriptTextRevision(char) + 'v' + previous.revision;
      _cardScriptTextCache.forEach(function (_, key) {
        if (key.endsWith(ending)) _cardScriptTextCache.delete(key);
      });
      _cardScriptTextFailures.forEach(function (key) {
        if (key.endsWith(ending)) _cardScriptTextFailures.delete(key);
      });
    }
    previous = { signature: signature, revision: ++_regexScriptScopeSeq };
    _cardScriptVariableSignatures.set(char, previous);
  }
  return 'd' + cardScriptTextRevision(char) + 'v' + previous.revision;
}
function withRegexScriptDisplayScope(char, action) {
  var previous = _regexScriptDisplayReadScope;
  if (char && !isRisuCharacter(char))
    _regexScriptDisplayReadScope = { char: char, id: regexScriptScopeId(char, 'display') };
  try {
    return action();
  } finally {
    _regexScriptDisplayReadScope = previous;
  }
}
// One macro state per transform, advanced fragment by fragment, so ordered side effects such
// as {{setvar}} run in match order exactly as substituteParams does in engine.js.
function regexScriptMacroState(char, identity) {
  var session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    state = typeof createCharacterMacroState === 'function' ? createCharacterMacroState() : undefined;
  if (state && _regexScriptRoundRandom) state.random = _regexScriptRoundRandom(identity);
  return state && typeof bindCharacterMacroSession === 'function'
    ? bindCharacterMacroSession(state, session, { commit: false })
    : state;
}
// engine.js calls substituteParams on the fragment after the groups are in place, so a macro
// that came out of a capture group is evaluated here too.
function regexScriptEvaluateFragment(fragment, char, state) {
  if (typeof replaceCharacterMacros !== 'function') return String(fragment);
  return String(replaceCharacterMacros(String(fragment), char, regexScriptUserName(char), state));
}
function regexScriptFilterGroup(value, trims) {
  var result = String(value == null ? '' : value);
  (trims || []).forEach(function (trim) {
    if (trim !== '') result = result.split(trim).join('');
  });
  return result;
}
function regexScriptAssembleParts(parts, char, state, trimStrings) {
  return (Array.isArray(parts) ? parts : [])
    .map(function (part) {
      if (part && typeof part.literal === 'string') return part.literal;
      var matches = part && Array.isArray(part.match) ? part.match : [],
        groups = part && part.groups && typeof part.groups === 'object' ? part.groups : {},
        replacement = String((part && part.replacement) || '')
          .replace(/{{match}}/gi, '$0')
          .replace(/\$(\d+)|\$<([^>]+)>/g, function (_, number, name) {
            var value = number ? matches[Number(number)] : groups[name];
            if (value == null || value === '') return '';
            var trims = (trimStrings || []).map(function (trim) {
              return regexScriptEvaluateFragment(trim, char, state);
            });
            return regexScriptFilterGroup(value, trims);
          });
      return regexScriptEvaluateFragment(replacement, char, state);
    })
    .join('');
}
// A depth change only invalidates a text whose ordered applicable scripts actually change, so the
// signature carries the ordered content fingerprints and nothing macro expansion rewrites.
function regexScriptTextCacheKey(char, role, phase, text, depth, ops) {
  var signature = (ops || regexTransformOps(char, role, phase, depth))
    .map(function (op) {
      return op.fingerprint;
    })
    .join('|');
  return cardScriptTextKey(char, role, phase, text, signature) + '\u0000' + regexScriptScopeId(char, phase);
}
function applyRegexScriptsToText(value, role, phase, char, options) {
  if (isRisuCharacter(char)) {
    var risuText = String(value == null ? '' : value);
    return { text: risuText, rawText: risuText, ready: true };
  }
  var text = regexScriptDisplaySourceText(value, role, phase),
    depth = options && typeof options.depth === 'number' ? options.depth : undefined;
  if (!char) return { text: text, rawText: text, ready: true };
  var ops = regexTransformOps(char, role, phase, depth),
    key = regexScriptTextCacheKey(char, role, phase, text, depth, ops);
  if (_cardScriptTextCache.has(key)) {
    var cached = String(_cardScriptTextCache.get(key));
    // Streaming already owns its current display slot. Its changing prefixes
    // must not evict committed history while that history awaits a depth re-key.
    if (phase === 'display' && (!options || options.streamPreview !== true))
      rememberCardScriptDisplaySnapshot(char, role, text, cached);
    return { text: cached, rawText: cached, ready: true };
  }
  if (!ops.length) {
    return { text: text, rawText: text, ready: true };
  }
  if (phase === 'display' && cardScriptTextFailureHolds(key)) {
    // A repaint a failure asked for. It neither re-enters the transform nor spends the sentinel, and
    // it shows the same stand-in every other render reads: the last finished display result for this
    // text, or the original the failure recorded when there was none — a laid out card frontend must
    // not drop back to its raw tags for this one frame either. The stand-in is not a transform
    // result, so it carries the same flags as the pending-snapshot return below: `ready` false keeps
    // it out of the stream completion callback and the send scope memo, `snapshot` true lets the
    // display path print it. No branch here writes the terminal cache.
    var heldSnapshot = cardScriptDisplaySnapshot(char, role, text);
    if (heldSnapshot != null) return { text: heldSnapshot, rawText: heldSnapshot, ready: false, snapshot: true };
    return { text: text, rawText: text, ready: true };
  }
  if (phase === 'send') _regexScriptSendMisses.push({ role: role, phase: phase, depth: depth, text: text });
  scheduleRegexTransform(char, role, phase, text, key, depth, options);
  var snapshot = phase === 'display' ? cardScriptDisplaySnapshot(char, role, text) : null;
  if (snapshot != null) return { text: snapshot, rawText: snapshot, ready: false, snapshot: true };
  return { text: text, rawText: text, ready: false };
}
var _regexScriptScopeMemo = Object.create(null),
  _regexScriptScopeMemoId = '';
function regexScriptScopeMemo(key, produce) {
  var scope = 's' + _regexScriptSendScope;
  if (_regexScriptScopeMemoId !== scope) {
    _regexScriptScopeMemoId = scope;
    _regexScriptScopeMemo = Object.create(null);
  }
  var slot = String(key);
  if (Object.prototype.hasOwnProperty.call(_regexScriptScopeMemo, slot)) return _regexScriptScopeMemo[slot];
  var value = produce();
  if (!value || value.ready !== false) _regexScriptScopeMemo[slot] = value;
  return value;
}
function regexScriptDrainSendMisses() {
  var rows = _regexScriptSendMisses;
  _regexScriptSendMisses = [];
  return rows;
}
// Awaited before the text is consumed, so neither phase ever reads an unfinished result.
async function prepareRegexScriptTexts(char, entries, options) {
  if (!char || isRisuCharacter(char)) return 0;
  var rows = (Array.isArray(entries) ? entries : []).filter(Boolean),
    filled = 0;
  for (var index = 0; index < rows.length; index++) {
    var row = rows[index],
      text = regexScriptDisplaySourceText(row.text, row.role, row.phase || 'send'),
      depth = typeof row.depth === 'number' ? row.depth : undefined,
      phase = row.phase || 'send',
      ops = regexTransformOps(char, row.role, phase, depth),
      key = regexScriptTextCacheKey(char, row.role, phase, text, depth, ops);
    if (!ops.length) continue;
    if (_cardScriptTextCache.has(key)) continue;
    if (options && options.signal && options.signal.aborted) {
      var aborted = new Error('脚本已被停止');
      aborted.name = 'AbortError';
      throw aborted;
    }
    var prepared = await runRegexTransform(char, row.role, row.phase || 'send', text, depth, {
      index: row.index,
      message: row.message,
      signal: options && options.signal,
    });
    if (phase === 'display' && !key.endsWith('\u0000' + regexScriptScopeId(char, phase))) continue;
    cacheRegexScriptText(key, prepared, phase);
    if ((row.phase || 'send') === 'display') rememberCardScriptDisplaySnapshot(char, row.role, text, prepared);
    filled++;
  }
  return filled;
}
function regexScriptMessageEligible(message) {
  if (!message) return true;
  return (
    (message.role === 'user' || message.role === 'assistant') &&
    !['branch-return', 'branch-return-revert', 'stream-draft'].includes(String(message.kind || '')) &&
    message.branchReturnSummary !== true &&
    message.branchReturnCopy !== true &&
    message.streamDraft !== true &&
    message.isStreamDraft !== true &&
    message.reverted !== true
  );
}
function regexScriptDisplayText(value, role, char, message, options) {
  if (isRisuCharacter(char)) {
    var session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
      chatIndex =
        message && message.opening
          ? -1
          : session && message && typeof risuChatIndex === 'function'
            ? risuChatIndex(session, message)
            : -1;
    if (chatIndex < 0 && (!message || !message.opening) && options && Number.isInteger(Number(options.index)))
      chatIndex = Number(options.index);
    return typeof risuDisplayText === 'function'
      ? risuDisplayText(value, char, session, message, {
          role: role,
          chatIndex: chatIndex < 0 ? undefined : chatIndex,
        })
      : String(value == null ? '' : value);
  }
  if (!regexScriptMessageEligible(message)) return String(value == null ? '' : value);
  options = Object.assign({}, options || {}, { message: message });
  var result = applyRegexScriptsToText(value, role, 'display', char, options),
    streaming = options.streamPreview === true && typeof options.streamDisplaySnapshot === 'function';
  if (streaming) {
    if (result.ready && typeof options.onStreamDisplayComplete === 'function')
      options.onStreamDisplayComplete({
        slot: String(options.streamDisplaySlot || 'body'),
        revision: Number(options.streamDisplayRevision) || 0,
        text: result.rawText,
        key: '',
        async: false,
      });
    var snapshot = options.streamDisplaySnapshot({
      slot: String(options.streamDisplaySlot || 'body'),
      revision: Number(options.streamDisplayRevision) || 0,
      ready: result.ready,
    });
    if (snapshot && snapshot.ready) return String(snapshot.text == null ? '' : snapshot.text);
  }
  // While the exact transform is pending, the last finished snapshot for the same text keeps the
  // rendered body in place; an empty return here would collapse the layout under the reader.
  return result.ready || result.snapshot ? result.text : '';
}
// ST extensions.regex_scripts become character scripts.
function characterRegexScriptSourceRows(data, rawCard) {
  data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  var root = rawCard && typeof rawCard === 'object' && !Array.isArray(rawCard) ? rawCard : {},
    rootData = root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root,
    candidates = [
      { owner: data.extensions, key: 'regex_scripts' },
      { owner: data, key: 'regex_scripts' },
      { owner: rootData.extensions, key: 'regex_scripts' },
      { owner: rootData, key: 'regex_scripts' },
      { owner: root.extensions, key: 'regex_scripts' },
      { owner: root, key: 'regex_scripts' },
    ];
  for (var index = 0; index < candidates.length; index++) {
    var candidate = candidates[index],
      owner = candidate.owner;
    if (!owner || typeof owner !== 'object' || !regexScriptOwn(owner, candidate.key)) continue;
    var value = owner[candidate.key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) return [value];
    return [];
  }
  return [];
}
function extractCharacterRegexScripts(data, rawCard) {
  return normalizeRegexScriptList(characterRegexScriptSourceRows(data, rawCard), { imported: true });
}
function regexScriptImportSummary(card) {
  var scripts = Array.isArray(card && card.regexScripts) ? normalizeRegexScriptList(card.regexScripts) : [],
    disabled = 0,
    unsupportedTarget = 0,
    worldBook = 0,
    unsupportedPhase = 0,
    unsafe = 0,
    unrecognizedReplacement = 0,
    replacementMacros = {};
  scripts.forEach(function (script) {
    var normalized = normalizeRegexScriptRecord(script),
      status = regexScriptStaticStatus(normalized),
      // A macro the card's own enabled TavernHelper script replaces is not unrecognised here.
      names = Object.keys(status.macros || {}).filter(function (name) {
        return !(typeof cardScriptHandlesMacro === 'function' && cardScriptHandlesMacro(card, name));
      });
    if (normalized.targetWorldBook) worldBook++;
    if (status.kind === 'target') unsupportedTarget++;
    else if (status.kind === 'phase') unsupportedPhase++;
    else if (status.kind === 'safety') unsafe++;
    if (names.length) {
      unrecognizedReplacement++;
      names.forEach(function (name) {
        replacementMacros[name] = (replacementMacros[name] || 0) + status.macros[name];
      });
    }
    if (!normalized.enabled) disabled++;
  });
  return {
    total: scripts.length,
    disabled: disabled,
    unsupportedTarget: unsupportedTarget,
    worldBook: worldBook,
    unsupportedPhase: unsupportedPhase,
    unsafe: unsafe,
    unrecognizedReplacement: unrecognizedReplacement,
    replacementMacros: replacementMacros,
  };
}
function regexScriptSameTargets(left, right) {
  return (
    !!left &&
    !!right &&
    left.user === right.user &&
    left.assistant === right.assistant &&
    left.worldBook === right.worldBook
  );
}
function regexScriptSamePhases(left, right) {
  return !!left && !!right && left.display === right.display && left.send === right.send;
}
function regexScriptExportPhases(script) {
  return script.applyDisplay && script.applySend
    ? { markdownOnly: false, promptOnly: false }
    : { markdownOnly: script.applyDisplay, promptOnly: script.applySend };
}
function exportRegexScriptRecord(source) {
  var script = normalizeRegexScriptRecord(source),
    raw =
      script.raw && typeof script.raw === 'object' && !Array.isArray(script.raw)
        ? regexScriptCopy(script.raw, '正则脚本导出字段')
        : {},
    rawTargets = regexScriptTargetState(raw),
    rawPhases = regexScriptPhaseState(raw),
    rawEnabled = regexScriptOwn(raw, 'disabled')
      ? !regexScriptBool(raw.disabled, false)
      : script.imported
        ? false
        : true,
    exportedPhases = regexScriptExportPhases(script),
    extras = (Array.isArray(raw.placement) ? raw.placement : raw.placement == null ? [] : [raw.placement]).filter(
      function (item) {
        var number = Number(item);
        return number !== 1 && number !== 2 && number !== 5;
      }
    );
  raw.id = raw.id == null || String(raw.id).trim() === '' ? script.id : raw.id;
  raw.scriptName = script.name;
  if (regexScriptOwn(raw, 'name')) raw.name = script.name;
  raw.findRegex = script.findRegex;
  if (regexScriptOwn(raw, 'find')) raw.find = script.findRegex;
  raw.replaceString = script.replaceString;
  if (regexScriptOwn(raw, 'replacement')) raw.replacement = script.replaceString;
  if (
    regexScriptOwn(raw, 'placement') ||
    !script.imported ||
    !regexScriptSameTargets(rawTargets, {
      user: script.targetUser,
      assistant: script.targetAssistant,
      worldBook: script.targetWorldBook,
    })
  ) {
    if (
      !regexScriptSameTargets(rawTargets, {
        user: script.targetUser,
        assistant: script.targetAssistant,
        worldBook: script.targetWorldBook,
      }) ||
      !regexScriptOwn(raw, 'placement')
    ) {
      raw.placement = [];
      if (script.targetUser) raw.placement.push(1);
      if (script.targetAssistant) raw.placement.push(2);
      if (script.targetWorldBook) raw.placement.push(5);
      raw.placement = raw.placement.concat(extras);
    }
  }
  if (regexScriptOwn(raw, 'disabled') || !script.imported || rawEnabled !== script.enabled)
    raw.disabled = !script.enabled;
  // These are written back only when the value actually changed, so a card that stored the
  // legacy boolean form of substituteRegex or an equivalent trim list exports byte for byte.
  if (
    JSON.stringify(regexScriptTrimStrings(raw)) !== JSON.stringify(script.trimStrings) ||
    (!regexScriptOwn(raw, 'trimStrings') && script.trimStrings.length)
  )
    raw.trimStrings = script.trimStrings.slice();
  if (regexScriptDepthValue(raw.minDepth, -1) !== script.minDepth) raw.minDepth = script.minDepth;
  if (regexScriptDepthValue(raw.maxDepth, 0) !== script.maxDepth) raw.maxDepth = script.maxDepth;
  if (regexScriptSubstituteMode(raw.substituteRegex) !== script.substituteRegex)
    raw.substituteRegex = script.substituteRegex;
  if ((raw.runOnEdit === true) !== script.runOnEdit) raw.runOnEdit = script.runOnEdit;
  if (
    regexScriptOwn(raw, 'markdownOnly') ||
    regexScriptOwn(raw, 'promptOnly') ||
    !script.imported ||
    !regexScriptSamePhases(rawPhases, { display: script.applyDisplay, send: script.applySend })
  ) {
    if (
      !regexScriptSamePhases(rawPhases, { display: script.applyDisplay, send: script.applySend }) ||
      !regexScriptOwn(raw, 'markdownOnly') ||
      !regexScriptOwn(raw, 'promptOnly')
    ) {
      raw.markdownOnly = exportedPhases.markdownOnly;
      raw.promptOnly = exportedPhases.promptOnly;
    }
  }
  return raw;
}
function regexPresetRows() {
  if (!D || !D.settings) return [];
  if (!Array.isArray(D.settings.regexPresets)) D.settings.regexPresets = [];
  return D.settings.regexPresets.filter(function (row) {
    return row && typeof row === 'object' && String(row.id || '');
  });
}
function regexPresetComparable(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function regexPresetFind(value) {
  var wanted = regexPresetComparable(value);
  return (
    regexPresetRows().find(function (row) {
      return regexPresetComparable(row.id) === wanted || regexPresetComparable(row.name) === wanted;
    }) || null
  );
}
function regexPresetSelected() {
  var selected = regexPresetFind(D && D.settings && D.settings.activeRegexPresetId);
  if (selected) return selected;
  return (
    regexPresetRows().find(function (row) {
      return row.isSelected === true;
    }) || null
  );
}
function regexPresetSetSelected(id) {
  var wanted = String(id || '');
  D.settings.activeRegexPresetId = wanted;
  regexPresetRows().forEach(function (row) {
    row.isSelected = String(row.id || '') === wanted;
  });
}
function regexPresetScriptId(script) {
  return String((normalizeRegexScriptRecord(script) || {}).id || '');
}
function regexPresetCaptureList(list, visible) {
  return (Array.isArray(list) ? list : [])
    .filter(function (script) {
      return (!visible || visible(script)) && normalizeRegexScriptRecord(script).enabled !== false;
    })
    .map(regexPresetScriptId)
    .filter(Boolean)
    .map(function (id) {
      return { id: id };
    });
}
// The preset in use owns its scripts, as in ST. With no active raw a write lands in the default's
// extensions layer, the same place TavernHelper preset-scope writes go.
function regexPresetCompletionScripts(create) {
  var raw = create
    ? completionPresetHostWritableRaw('in_use')
    : typeof activeCompletionPresetRaw === 'function'
      ? activeCompletionPresetRaw()
      : null;
  if (!raw) return null;
  if (create && (!raw.extensions || typeof raw.extensions !== 'object' || Array.isArray(raw.extensions)))
    raw.extensions = {};
  if (create && !Array.isArray(raw.extensions.regex_scripts)) raw.extensions.regex_scripts = [];
  return raw.extensions && Array.isArray(raw.extensions.regex_scripts) ? raw.extensions.regex_scripts : null;
}
// A preset covers the global rows the current character sees; rows other characters' card
// scripts wrote are neither captured nor switched by it.
function regexPresetGlobalVisible(char) {
  return function (script) {
    return regexScriptGlobalVisibleTo(script, char);
  };
}
function regexPresetCurrentSnapshot(id, name) {
  var char = typeof getChar === 'function' ? getChar() : null;
  return {
    id: String(id || ''),
    name: String(name || '').trim(),
    isSelected: true,
    global: regexPresetCaptureList(D.settings.regexScripts, regexPresetGlobalVisible(char)),
    scoped: regexPresetCaptureList(char && char.regexScripts),
    preset: regexPresetCaptureList(regexPresetCompletionScripts(false)),
  };
}
function regexScriptSetEnabled(script, enabled) {
  if (regexScriptOwn(script, 'enabled') || !regexScriptOwn(script, 'disabled')) script.enabled = enabled === true;
  else script.disabled = enabled !== true;
}
function regexPresetApplyList(list, ids, visible) {
  if (!Array.isArray(list) || !Array.isArray(ids)) return;
  ids = ids
    .map(function (item) {
      return String(item && typeof item === 'object' ? item.id || '' : item || '');
    })
    .filter(Boolean);
  list.forEach(function (script) {
    if (visible && !visible(script)) return;
    regexScriptSetEnabled(script, ids.includes(regexPresetScriptId(script)));
  });
  // The list order is the execution order, so a preset may only re-seat the scripts it
  // actually lists: they are sorted into the slots they already occupy, while the scripts the
  // preset never mentions keep their own place instead of being hoisted to the front.
  var slots = [],
    ordered = [];
  list.forEach(function (script, index) {
    if ((visible && !visible(script)) || ids.indexOf(regexPresetScriptId(script)) < 0) return;
    slots.push(index);
    ordered.push(script);
  });
  ordered.sort(function (left, right) {
    return ids.indexOf(regexPresetScriptId(left)) - ids.indexOf(regexPresetScriptId(right));
  });
  slots.forEach(function (slot, index) {
    list[slot] = ordered[index];
  });
}
function regexPresetMutation(char, scripts) {
  var journal = createMutationJournal();
  journal.capture(
    D.settings,
    scripts ? ['activeRegexPresetId', 'regexPresets', 'regexScripts'] : ['activeRegexPresetId', 'regexPresets']
  );
  if (scripts) {
    journal.capture(char, ['regexScripts']);
    regexPresetCaptureCompletionScripts(journal);
  }
  return journal;
}
// Records everything a write to the preset's scripts touches: the preset in use (or the default's
// extensions layer), its named row and an open prompt manager draft of it.
function regexPresetCaptureCompletionScripts(journal) {
  completionPresetCaptureDefaultExtensions(journal);
  var raw = typeof activeCompletionPresetRaw === 'function' ? activeCompletionPresetRaw() : null;
  journal.capture(raw, ['extensions'], true);
  journal.capture(raw && raw.extensions, ['regex_scripts']);
  var active = String(D.settings.activeChatCompletionPresetName || '');
  (D.settings.chatCompletionPresets || []).forEach(function (row) {
    if (row && String(row.name || '') === active) journal.capture(row, ['preset'], true);
  });
  if (typeof _completionPresetDraftRows !== 'undefined' && Array.isArray(_completionPresetDraftRows))
    _completionPresetDraftRows.forEach(function (row) {
      if (row && String(row.name || '') === active) journal.capture(row, ['preset'], true);
    });
}
async function regexPresetApply(value, char) {
  var preset = regexPresetFind(value);
  if (!preset) return '';
  char = char || (typeof getChar === 'function' ? getChar() : null);
  var mutation = regexPresetMutation(char, true),
    sections = ['meta'];
  try {
    var completionScripts = regexPresetCompletionScripts(false);
    regexPresetApplyList(D.settings.regexScripts, preset.global, regexPresetGlobalVisible(char));
    if (char) {
      if (!Array.isArray(char.regexScripts)) char.regexScripts = [];
      regexPresetApplyList(char.regexScripts, preset.scoped);
      sections.push('characters');
    }
    if (completionScripts) {
      regexPresetApplyList(completionScripts, preset.preset);
      if (typeof completionPresetSyncHostWrite === 'function') completionPresetSyncHostWrite('in_use');
    }
    regexPresetSetSelected(preset.id);
    var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts();
    if (sessionsChanged) sections.push('sessions');
    mutation.seal();
    await saveData(Array.from(new Set(sections)), { urgent: true });
  } catch (error) {
    mutation.rollback();
    throw error;
  }
  invalidateRegexScriptRuntimeCache();
  invalidateCardScriptDisplayCache(char);
  regexScriptRefreshAfterChange();
  renderRegexPresetManager();
  return String(preset.id);
}
async function regexPresetSaveCurrent(name, id) {
  var mutation = regexPresetMutation(null, false),
    existing = id ? regexPresetFind(id) : null,
    wantedId = existing
      ? String(existing.id)
      : String(id || 'regex_preset_' + (typeof uid === 'function' ? uid() : Date.now())),
    snapshot = regexPresetCurrentSnapshot(wantedId, existing ? existing.name : name);
  if (!snapshot.name) return '';
  try {
    if (existing) Object.assign(existing, snapshot);
    else D.settings.regexPresets.push(snapshot);
    regexPresetSetSelected(wantedId);
    mutation.seal();
    await saveData('meta', { urgent: true });
  } catch (error) {
    mutation.rollback();
    throw error;
  }
  renderRegexPresetManager();
  return wantedId;
}
async function regexPresetDelete(id) {
  var row = regexPresetFind(id);
  if (!row) return false;
  var mutation = regexPresetMutation(null, false),
    rows = regexPresetRows(),
    index = rows.indexOf(row);
  try {
    D.settings.regexPresets.splice(D.settings.regexPresets.indexOf(row), 1);
    var next = regexPresetRows()[Math.min(index, regexPresetRows().length - 1)] || null;
    regexPresetSetSelected(next && next.id);
    mutation.seal();
    await saveData('meta', { urgent: true });
  } catch (error) {
    mutation.rollback();
    throw error;
  }
  renderRegexPresetManager();
  return true;
}
function renderRegexPresetManager() {
  var select = $('regex-preset-select');
  if (!select || !D || !D.settings) return;
  var selected = regexPresetSelected(),
    rows = regexPresetRows();
  select.innerHTML = rows.length
    ? rows
        .map(function (row) {
          return (
            '<option value="' +
            escAttr(row.id) +
            '"' +
            (selected && String(selected.id) === String(row.id) ? ' selected' : '') +
            '>' +
            esc(row.name || row.id) +
            '</option>'
          );
        })
        .join('')
    : '<option value="">还没有预设</option>';
  select.disabled = !rows.length;
}
async function applyRegexPresetSelection(id) {
  if (!id) return;
  try {
    var applied = await regexPresetApply(id);
    if (applied) toast('正则预设已应用', 'ok');
  } catch (error) {
    renderRegexPresetManager();
    toast('正则预设应用失败，原状态已恢复：' + String(error.message || error), 'err');
  }
}
async function createRegexPresetFromCurrent() {
  var name = await appInput(
    '保存当前启用的全局、当前聊天补全预设和当前角色正则脚本。',
    '',
    '新建正则预设',
    '预设名称',
    { okText: '保存预设' }
  );
  if (!name || !String(name).trim()) return;
  try {
    await regexPresetSaveCurrent(String(name).trim());
    toast('正则预设已保存', 'ok');
  } catch (error) {
    toast('正则预设保存失败：' + String(error.message || error), 'err');
  }
}
async function updateRegexPresetFromCurrent() {
  var selected = regexPresetSelected();
  if (!selected) {
    await createRegexPresetFromCurrent();
    return;
  }
  try {
    await regexPresetSaveCurrent(selected.name, selected.id);
    toast('正则预设已更新', 'ok');
  } catch (error) {
    toast('正则预设更新失败：' + String(error.message || error), 'err');
  }
}
async function deleteRegexPresetSelection() {
  var selected = regexPresetSelected();
  if (!selected) return;
  if (!(await appConfirm('删除正则预设“' + String(selected.name || selected.id) + '”？', '删除正则预设', '删除')))
    return;
  try {
    await regexPresetDelete(selected.id);
    toast('正则预设已删除', 'ok');
  } catch (error) {
    toast('正则预设删除失败：' + String(error.message || error), 'err');
  }
}
// The manager groups scripts by where they come from; each group keeps its stored order, which
// is the execution order within that owner. Preset scripts belong to the chat completion preset in
// use and, as in ST, are managed here like the others; every change is saved into that preset.
function regexScriptManagerGroups() {
  var groups = [],
    globals = D && D.settings && Array.isArray(D.settings.regexScripts) ? D.settings.regexScripts : [],
    presetScripts = regexPresetCompletionScripts(false) || [];
  var userRows = [],
    ownedRows = Object.create(null),
    owners = [];
  globals.forEach(function (script) {
    var owner = regexScriptGlobalOwnerId(script);
    if (!owner) {
      userRows.push({ scope: 'global', ownerId: '', script: script });
      return;
    }
    if (!ownedRows[owner]) {
      ownedRows[owner] = [];
      owners.push(owner);
    }
    ownedRows[owner].push({ scope: 'global', ownerId: owner, script: script });
  });
  groups.push({ key: 'global', title: '全局', rows: userRows });
  groups.push({
    key: 'preset',
    title: '来自预设〈' + regexScriptPresetName() + '〉',
    hint: '保存在当前聊天补全预设里，切换预设时随之切换，导出预设时一并带上。',
    rows: presetScripts.map(function (script) {
      return { scope: 'preset', ownerId: 'in_use', script: script };
    }),
  });
  var ownedGroup = function (owner, char) {
    return {
      key: 'global-owner:' + owner,
      title: char ? '由角色〈' + regexScriptCharacterName(char) + '〉的脚本写入' : '由已不存在的角色的脚本写入',
      hint: char ? '卡片脚本写入的全局正则，只对这个角色生效，删除角色时一并删除。' : '不会对任何角色生效。',
      rows: ownedRows[owner],
    };
  };
  (D && Array.isArray(D.characters) ? D.characters : []).forEach(function (char) {
    if (!char) return;
    var id = String(char.id || '');
    groups.push({
      key: 'character:' + id,
      title: '来自角色卡〈' + regexScriptCharacterName(char) + '〉',
      rows: (Array.isArray(char.regexScripts) ? char.regexScripts : []).map(function (script) {
        return { scope: 'character', ownerId: id, script: script };
      }),
    });
    if (ownedRows[id]) {
      groups.push(ownedGroup(id, char));
      delete ownedRows[id];
    }
  });
  owners.forEach(function (owner) {
    if (ownedRows[owner]) groups.push(ownedGroup(owner, null));
  });
  return groups.filter(function (group) {
    return group.rows.length > 0;
  });
}
function regexScriptPresetName() {
  return typeof completionPresetName === 'function' ? completionPresetName(D.settings) : '当前预设';
}
function regexScriptOwnerOptions(selected) {
  var value = String(selected || 'global'),
    html = '<option value="global"' + (value === 'global' ? ' selected' : '') + '>全局 · 所有角色</option>';
  // A row a card script wrote keeps its owner unless the user explicitly makes it global.
  if (value.indexOf('script:') === 0) {
    var writer = (D && Array.isArray(D.characters) ? D.characters : []).find(function (char) {
      return char && String(char.id || '') === value.slice('script:'.length);
    });
    html +=
      '<option value="' +
      escAttr(value) +
      '" selected>全局 · 仅' +
      esc(writer ? '〈' + regexScriptCharacterName(writer) + '〉' : '已不存在的角色') +
      '（由其脚本写入）</option>';
  }
  html +=
    '<option value="preset"' +
    (value === 'preset' ? ' selected' : '') +
    '>预设 · ' +
    esc(regexScriptPresetName()) +
    '</option>';
  (D && Array.isArray(D.characters) ? D.characters : []).forEach(function (char) {
    if (!char) return;
    var option = 'character:' + String(char.id || '');
    html +=
      '<option value="' +
      escAttr(option) +
      '"' +
      (value === option ? ' selected' : '') +
      '>角色 · ' +
      esc(regexScriptCharacterName(char)) +
      '</option>';
  });
  return html;
}
function regexScriptTargetLabel(script) {
  var labels = [];
  if (script.targetUser) labels.push('用户消息');
  if (script.targetAssistant) labels.push('AI 回复');
  if (script.targetWorldBook) labels.push('世界书');
  return labels.join('、') || '未选择支持对象';
}
function regexScriptPhaseLabel(script) {
  var labels = [];
  if (script.applyDisplay) labels.push('聊天显示');
  if (script.applySend) labels.push('发送给 AI');
  return labels.join('、') || '未选择环节';
}
var _regexScriptCollapsedGroups = Object.create(null);
function toggleRegexScriptGroup(key, open) {
  if (open) delete _regexScriptCollapsedGroups[key];
  else _regexScriptCollapsedGroups[key] = true;
}
function regexScriptRowHtml(row) {
  var script = normalizeRegexScriptRecord(row.script),
    reason =
      regexScriptStaticReason(script) ||
      _regexScriptRuntimeReasons[regexScriptRuntimeKey(row.scope, row.ownerId, script.id)] ||
      '',
    args = jsArg(row.scope) + ',' + jsArg(row.ownerId) + ',' + jsArg(script.id),
    summary = [regexScriptTargetLabel(script), regexScriptPhaseLabel(script)]
      // Before owners were recorded, TavernHelper writes were the only source of imported global rows.
      .concat(script.imported ? [row.scope === 'global' ? '由卡片脚本写入' : '随角色卡导入'] : []);
  return (
    '<div class="regex-script-row' +
    (script.enabled ? '' : ' is-disabled') +
    '"><label class="switch-row regex-script-toggle" aria-label="' +
    (script.enabled ? '停用' : '启用') +
    escAttr(script.name) +
    '"><input type="checkbox" ' +
    (script.enabled ? 'checked' : '') +
    ' onchange="toggleRegexScript(' +
    args +
    ',this.checked)"><span class="switch-control" aria-hidden="true"></span></label>' +
    '<div class="regex-script-copy"><strong>' +
    esc(script.name) +
    '</strong><small>' +
    esc(summary.join(' · ')) +
    '</small><span class="regex-script-pattern">' +
    esc(script.findRegex || '（未填写查找正则）') +
    '</span></div>' +
    '<div class="ui-actions"><button type="button" class="btn text sm accent" onclick="openRegexScriptEditor(' +
    args +
    ')">编辑</button><button type="button" class="btn text sm danger" onclick="deleteRegexScript(' +
    args +
    ')">删除</button></div>' +
    (reason ? '<div class="notice regex-script-reason">未执行：' + esc(reason) + '</div>' : '') +
    '</div>'
  );
}
function renderRegexScriptManager() {
  var box = $('regex-script-list');
  if (!box || !D || !D.settings) return;
  if (typeof renderRegexScriptRuntimeStatus === 'function')
    renderRegexScriptRuntimeStatus(typeof getChar === 'function' ? getChar() : null);
  if (!Array.isArray(D.settings.regexScripts)) D.settings.regexScripts = [];
  var groups = regexScriptManagerGroups();
  if (!groups.length) {
    box.innerHTML =
      '<div class="ui-group"><div class="ui-empty"><strong>还没有正则脚本</strong><p>点「新建脚本」添加全局脚本；导入带正则的角色卡后，它的脚本也会列在这里。</p></div></div>';
    return;
  }
  box.innerHTML = groups
    .map(function (group) {
      return (
        '<details class="ui-fold" data-regex-group="' +
        escAttr(group.key) +
        '"' +
        (_regexScriptCollapsedGroups[group.key] ? '' : ' open') +
        ' ontoggle="toggleRegexScriptGroup(' +
        jsArg(group.key) +
        ',this.open)"><summary><span class="ui-fold-title">' +
        esc(group.title) +
        '</span><small class="ui-meta">' +
        group.rows.length +
        ' 条</small></summary>' +
        (group.hint ? '<p class="hint ui-fold-hint">' + esc(group.hint) + '</p>' : '') +
        '<div class="ui-group">' +
        group.rows.map(regexScriptRowHtml).join('') +
        '</div></details>'
      );
    })
    .join('');
}
function regexScriptOwnerCharacter(ownerId) {
  return (
    (D.characters || []).find(function (row) {
      return String((row && row.id) || '') === String(ownerId || '');
    }) || null
  );
}
function regexScriptStoredList(scope, ownerId, create) {
  if (scope === 'global') {
    if (create && !Array.isArray(D.settings.regexScripts)) D.settings.regexScripts = [];
    return Array.isArray(D.settings.regexScripts) ? D.settings.regexScripts : null;
  }
  if (scope === 'preset') return regexPresetCompletionScripts(create);
  var char = regexScriptOwnerCharacter(ownerId);
  if (!char) return null;
  if (create && !Array.isArray(char.regexScripts)) char.regexScripts = [];
  return Array.isArray(char.regexScripts) ? char.regexScripts : null;
}
function regexScriptStoredRecord(scope, ownerId, id) {
  var list = regexScriptStoredList(scope, ownerId, false);
  return (
    (list &&
      list.find(function (row) {
        return (
          regexScriptIdOf(row) === String(id || '') &&
          (scope !== 'global' || regexScriptGlobalOwnerId(row) === String(ownerId || ''))
        );
      })) ||
    null
  );
}
// Preset rows are stored in ST's raw shape, which is their own evidence; global and character rows
// are normalized records that carry their raw evidence alongside.
function regexScriptStoredEvidence(scope, stored) {
  return scope === 'preset' ? stored : stored && stored.raw;
}
function regexScriptStoredForm(scope, record) {
  if (scope !== 'preset') return record;
  var raw = exportRegexScriptRecord(record);
  raw.id = record.id;
  return raw;
}
function regexScriptSection(scope) {
  return scope === 'character' ? 'characters' : 'meta';
}
// The manager's one write path. It journals the lists the change touches; a preset write is mirrored
// into the preset's named row and an open prompt manager draft, as TavernHelper preset writes are,
// and a failed save restores all of it.
async function regexScriptPersist(owners, mutate) {
  var journal = createMutationJournal(),
    scopes = owners.map(function (owner) {
      return owner.scope;
    }),
    touchesPreset = scopes.indexOf('preset') >= 0;
  owners.forEach(function (owner) {
    if (owner.scope === 'global') journal.capture(D.settings, ['regexScripts']);
    else if (owner.scope === 'character') journal.capture(regexScriptOwnerCharacter(owner.ownerId), ['regexScripts']);
  });
  if (touchesPreset) regexPresetCaptureCompletionScripts(journal);
  try {
    mutate();
    if (touchesPreset) completionPresetSyncHostWrite('in_use');
    journal.seal();
    await saveData(Array.from(new Set(scopes.map(regexScriptSection))), { urgent: true });
  } catch (error) {
    journal.rollback();
    if (touchesPreset)
      try {
        completionPresetSyncHostWrite('in_use');
      } catch (_) {}
    throw error;
  }
}
function openRegexScriptEditor(scope, ownerId, id) {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration(id ? '编辑正则脚本' : '新增正则脚本'))
    return;
  var existing = id ? regexScriptStoredRecord(scope, ownerId, id) : null,
    script = existing
      ? normalizeRegexScriptRecord(existing)
      : normalizeRegexScriptRecord({
          id: regexScriptNewId(),
          name: '新脚本',
          findRegex: '',
          replaceString: '',
          targetAssistant: true,
          applyDisplay: true,
          applySend: false,
          enabled: true,
        }),
    ownerValue = !existing
      ? 'global'
      : scope === 'preset'
        ? 'preset'
        : scope !== 'global'
          ? 'character:' + ownerId
          : ownerId
            ? 'script:' + ownerId
            : 'global';
  _regexScriptEditorState = {
    scope: existing ? scope : '',
    ownerId: existing ? String(ownerId || '') : '',
    id: existing ? String(id || '') : '',
    draftId: script.id,
  };
  $('regex-script-editor-title').textContent = existing ? '编辑正则脚本' : '新建正则脚本';
  $('regex-script-owner').innerHTML = regexScriptOwnerOptions(ownerValue);
  $('regex-script-name').value = script.name;
  $('regex-script-find').value = script.findRegex;
  $('regex-script-replace').value = script.replaceString;
  $('regex-script-target-user').checked = script.targetUser;
  $('regex-script-target-assistant').checked = script.targetAssistant;
  $('regex-script-target-worldbook').checked = script.targetWorldBook;
  $('regex-script-phase-display').checked = script.applyDisplay;
  $('regex-script-phase-send').checked = script.applySend;
  $('regex-script-enabled').checked = script.enabled;
  openModal('regex-script-editor-modal');
  updateRegexScriptEditorSafety();
}
function updateRegexScriptEditorSafety() {
  var status = $('regex-script-safety');
  if (!status) return;
  var safety = regexScriptSafety($('regex-script-find').value);
  status.className = 'regex-script-editor-safety ' + (safety.valid ? 'ok' : 'notice');
  status.textContent = safety.valid ? '这条规则可以执行' : '不会执行：' + safety.reason;
}
function regexScriptRefreshAfterChange() {
  renderRegexScriptManager();
  renderRegexPresetManager();
  if (typeof renderChat === 'function') renderChat();
  var char = typeof getChar === 'function' ? getChar() : null;
  if (char && typeof scheduleTokensBar === 'function') scheduleTokensBar(char);
}
function saveRegexScriptEditor() {
  return runModalSave('regex-script-editor-modal', commitRegexScriptEditor);
}
async function commitRegexScriptEditor() {
  if (!_regexScriptEditorState) return;
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('保存正则脚本')) return;
  var name = $('regex-script-name').value.trim(),
    targetUser = $('regex-script-target-user').checked,
    targetAssistant = $('regex-script-target-assistant').checked,
    targetWorldBook = $('regex-script-target-worldbook').checked,
    applyDisplay = $('regex-script-phase-display').checked,
    applySend = $('regex-script-phase-send').checked;
  if (!name) {
    toast('请填写脚本名称', 'err');
    return;
  }
  if (!String($('regex-script-find').value || '').trim()) {
    toast('请填写查找正则', 'err');
    return;
  }
  if (!targetUser && !targetAssistant && !targetWorldBook) {
    toast('请至少选择一个作用对象', 'err');
    return;
  }
  if (!applyDisplay && !applySend) {
    toast('请至少选择“聊天显示”或“发送给 AI”之一', 'err');
    return;
  }
  var state = _regexScriptEditorState,
    existing = state.id ? regexScriptStoredRecord(state.scope, state.ownerId, state.id) : null,
    existingNormalized = existing ? normalizeRegexScriptRecord(existing) : null,
    unchangedPhases =
      !!existingNormalized &&
      existingNormalized.applyDisplay === applyDisplay &&
      existingNormalized.applySend === applySend,
    officialPhases = unchangedPhases
      ? { markdownOnly: existingNormalized.markdownOnly, promptOnly: existingNormalized.promptOnly }
      : regexScriptExportPhases({ applyDisplay: applyDisplay, applySend: applySend }),
    owner = $('regex-script-owner').value,
    targetScope = owner === 'preset' ? 'preset' : owner.indexOf('character:') === 0 ? 'character' : 'global',
    targetOwner =
      targetScope === 'preset' ? 'in_use' : targetScope === 'character' ? owner.slice('character:'.length) : '',
    scriptOwner = owner.indexOf('script:') === 0 ? owner.slice('script:'.length) : '',
    record = normalizeRegexScriptRecord({
      id: regexScriptIdOf(existing) || state.draftId,
      name: name,
      findRegex: $('regex-script-find').value,
      replaceString: $('regex-script-replace').value,
      targetUser: targetUser,
      targetAssistant: targetAssistant,
      targetWorldBook: targetWorldBook,
      applyDisplay: applyDisplay,
      applySend: applySend,
      markdownOnly: officialPhases.markdownOnly,
      promptOnly: officialPhases.promptOnly,
      trimStrings: (existingNormalized && existingNormalized.trimStrings) || [],
      minDepth: existingNormalized && existingNormalized.minDepth,
      maxDepth: existingNormalized && existingNormalized.maxDepth,
      substituteRegex: existingNormalized && existingNormalized.substituteRegex,
      runOnEdit: existingNormalized && existingNormalized.runOnEdit === true,
      enabled: $('regex-script-enabled').checked,
      imported: existing && existing.imported === true,
      ownerCharacterId: scriptOwner,
      raw: regexScriptStoredEvidence(state.scope, existing) || {},
    }),
    owners = [{ scope: targetScope, ownerId: targetOwner }].concat(
      existing ? [{ scope: state.scope, ownerId: state.ownerId }] : []
    );
  try {
    await regexScriptPersist(owners, function () {
      var oldList = null,
        oldIndex = -1;
      if (existing) {
        oldList = regexScriptStoredList(state.scope, state.ownerId, true);
        oldIndex = oldList ? oldList.indexOf(existing) : -1;
        if (oldIndex >= 0) oldList.splice(oldIndex, 1);
      }
      var targetList = regexScriptStoredList(targetScope, targetOwner, true);
      if (!targetList) throw new Error('选择的角色已经不存在');
      var base = record.id,
        suffix = 2;
      while (
        targetList.some(function (row) {
          return (
            regexScriptIdOf(row) === record.id &&
            (targetScope !== 'global' || regexScriptGlobalOwnerId(row) === scriptOwner)
          );
        })
      )
        record.id = base + '_' + suffix++;
      var stored = regexScriptStoredForm(targetScope, record);
      // Keeping the original slot matters: the list order is the execution order, so editing a
      // script in place must not push it behind the ones that used to run after it.
      if (targetList === oldList && oldIndex >= 0) targetList.splice(oldIndex, 0, stored);
      else targetList.push(stored);
    });
  } catch (error) {
    toast('脚本保存失败，原内容已保留：' + String(error.message || error), 'err');
    return;
  }
  closeModal('regex-script-editor-modal');
  _regexScriptEditorState = null;
  invalidateRegexScriptRuntimeCache();
  regexScriptRefreshAfterChange();
  var reason = regexScriptStaticReason(record);
  toast(reason ? '脚本已保存，但当前不会执行：' + reason : '正则脚本已保存并立即生效', reason ? 'info' : 'ok');
}
async function toggleRegexScript(scope, ownerId, id, enabled) {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('切换正则脚本')) {
    renderRegexScriptManager();
    return;
  }
  var record = regexScriptStoredRecord(scope, ownerId, id);
  if (!record) return;
  try {
    await regexScriptPersist([{ scope: scope, ownerId: ownerId }], function () {
      regexScriptSetEnabled(record, enabled);
    });
  } catch (error) {
    toast('开关保存失败，已恢复原状态：' + String(error.message || error), 'err');
  }
  invalidateRegexScriptRuntimeCache();
  regexScriptRefreshAfterChange();
}
async function deleteRegexScript(scope, ownerId, id) {
  if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('删除正则脚本')) return;
  var record = regexScriptStoredRecord(scope, ownerId, id);
  if (!record) return;
  if (
    !(await appConfirm(
      '删除正则脚本“' + String(normalizeRegexScriptRecord(record).name) + '”？聊天原文不会受到影响。',
      '删除正则脚本',
      '删除'
    ))
  )
    return;
  var list = regexScriptStoredList(scope, ownerId, false),
    index = list ? list.indexOf(record) : -1;
  if (index < 0) return;
  try {
    await regexScriptPersist([{ scope: scope, ownerId: ownerId }], function () {
      list.splice(index, 1);
    });
  } catch (error) {
    toast('删除保存失败，脚本仍然保留：' + String(error.message || error), 'err');
    return;
  }
  invalidateRegexScriptRuntimeCache();
  regexScriptRefreshAfterChange();
  toast('正则脚本已删除', 'ok');
}
// ---- one derivation for both the send pre-warm and the prompt builder ----
// buildMessages and the pre-warm must agree byte for byte, so both call this and nothing
// reimplements it. It is pure: no macro state is written and no message is mutated.
function regexScriptPromptSourceText(message, char) {
  var content = (message && message.content) || '';
  if (message && message.role === 'assistant') {
    if (typeof splitAssistantResponseText === 'function') content = splitAssistantResponseText(content).content;
  }
  return String(content == null ? '' : content);
}
// ST leaves is_system rows (/hide, /comment, /imagine's picture) out of coreChat and usableMessages, so they take no depth.
function regexScriptMessageTakesDepth(message) {
  return (
    !!message && message.hidden !== true && message.kind !== 'stscript-comment' && message.kind !== 'generated-image'
  );
}
// The one depth derivation shared by display, the send pre-warm and prompt assembly, so their cache
// keys agree: the distance back from the newest counted row, what engine.js compares minDepth and
// maxDepth against. While continuing, the continued reply is -1, as script.js subtracts
// `isContinue ? 2 : 1`. Rows that take no depth are left undefined and are not depth-filtered.
function regexScriptMessageDepths(messages, generationTarget) {
  var rows = Array.isArray(messages) ? messages : [],
    depths = new Array(rows.length),
    next = generationTarget && generationTarget.mode === 'continue' ? -1 : 0;
  for (var index = rows.length - 1; index >= 0; index--)
    if (regexScriptMessageTakesDepth(rows[index])) depths[index] = next++;
  return depths;
}
function regexScriptPromptEntries(char, messages, generationTarget) {
  var rows = Array.isArray(messages) ? messages : [],
    depths = regexScriptMessageDepths(rows, generationTarget),
    entries = [];
  rows.forEach(function (message, index) {
    if (!regexScriptMessageEligible(message) || depths[index] === undefined) return;
    entries.push({
      role: message.role,
      phase: 'send',
      depth: depths[index],
      index: index,
      message: message,
      text: regexScriptPromptSourceText(message, char),
    });
  });
  return entries;
}
// Called with the exact array and generation target buildMessages is about to consume, including
// any text a manual or automatic continuation just rewrote, so the warmed keys are the keys the
// builder reads.
async function prepareRegexScriptsForPrompt(char, messages, generationTarget) {
  if (!char || isRisuCharacter(char)) return 0;
  return prepareRegexScriptTexts(char, regexScriptPromptEntries(char, messages, generationTarget));
}
// Warms the display phase before the chat paints, so the first frame already shows the
// transformed text instead of blanking until the worker answers.
async function prepareRegexScriptDisplayTexts(char, messages) {
  if (!char) return 0;
  if (isRisuCharacter(char)) return prepareRisuDisplayTexts(char, getActiveSession(char.id), messages || []);
  var rows = Array.isArray(messages) ? messages : [],
    depths = regexScriptMessageDepths(rows),
    entries = [];
  rows.forEach(function (message, index) {
    if (!regexScriptMessageEligible(message)) return;
    var content = message.content || '';
    if (message.role === 'assistant' && typeof assistantMessageParts === 'function')
      content = assistantMessageParts(message).content;
    entries.push({
      role: message.role,
      phase: 'display',
      depth: depths[index],
      index: index,
      message: message,
      text: String(content == null ? '' : content),
    });
  });
  return prepareRegexScriptTexts(char, entries);
}
