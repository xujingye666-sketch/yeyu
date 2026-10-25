// ===== World book normalization and runtime matching =====
function wbHas(v) {
  return v !== undefined && v !== null && v !== '';
}
function wbNumber(v, def) {
  var n = parseInt(v);
  return Number.isFinite(n) ? n : def;
}
function wbClamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function normalizeWBSettings(source) {
  source = source || {};
  var has = function (k) {
      return wbHas(source[k]);
    },
    scan = has('scan_depth') ? source.scan_depth : has('scanDepth') ? source.scanDepth : null,
    budget = has('token_budget') ? source.token_budget : has('tokenBudget') ? source.tokenBudget : null,
    recursive = has('recursive_scanning') ? source.recursive_scanning : has('recursive') ? source.recursive : null,
    sensitive = has('case_sensitive') ? source.case_sensitive : has('caseSensitive') ? source.caseSensitive : null;
  return {
    scan_depth: scan != null && wbNumber(scan, 0) > 0 ? wbNumber(scan, 0) : null,
    token_budget: budget != null ? Math.max(0, wbNumber(budget, 0)) : null,
    recursive: recursive != null ? wbBool(recursive, false) : null,
    caseSensitive: sensitive != null ? wbBool(sensitive, false) : null,
    raw: source.settings && typeof source.settings === 'object' ? Object.assign({}, source.settings) : {},
  };
}
function wbBool(v, def) {
  if (v === undefined || v === null) return !!def;
  if (typeof v === 'string') return !/^(false|0|no|off)$/i.test(v.trim());
  return !!v;
}
function wbKeyList(v) {
  if (Array.isArray(v))
    return v
      .map(function (k) {
        return String(k).trim();
      })
      .filter(Boolean);
  if (typeof v === 'string')
    return v
      .split(',')
      .map(function (k) {
        return k.trim();
      })
      .filter(Boolean);
  return [];
}
function wbEntryGroupNames(entry) {
  var seen = new Set();
  return String((entry && entry.group) || '')
    .split(/,\s*/)
    .map(function (name) {
      return name.trim();
    })
    .filter(function (name) {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}
// SillyTavern numbers entries from uid 0, so 0 is a real identity and is kept as '0'.
function wbEntryIdText(value) {
  if (value === undefined || value === null || value === '' || value === false) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  var text = typeof value === 'string' ? value : String(value);
  return text.trim() ? text : '';
}
function normalizeWorldBookCategoryEntryIds(category) {
  var seen = new Set(),
    changed = false;
  (category && Array.isArray(category.entries) ? category.entries : []).forEach(function (entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    var next = wbEntryIdText(entry.id);
    while (!next || seen.has(next)) next = wbEntryIdText(uid());
    seen.add(next);
    if (entry.id !== next) {
      entry.id = next;
      changed = true;
    }
  });
  return changed;
}
// Official SillyTavern 1.19.0 world_info_position order; 'before_user' stays a Yeyu-only slot.
var WB_POSITION_BY_INDEX = [
  'before_char',
  'after_char',
  'an_top',
  'an_bottom',
  'at_depth',
  'em_top',
  'em_bottom',
  'outlet',
];
var WB_POSITIONS = WB_POSITION_BY_INDEX.concat(['before_user']);
// SillyTavern DEFAULT_DEPTH: an in-chat entry without a usable depth sits four messages up. The
// default is filled where entries are read and never written back over a stored value.
var WB_DEFAULT_DEPTH = 4;
function wbDepth(value) {
  var depth = wbNumber(value, NaN);
  return Number.isFinite(depth) ? Math.max(0, depth) : WB_DEFAULT_DEPTH;
}
var WB_GENERATION_TRIGGERS = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];
function wbGenerationTriggerList(value) {
  var list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [],
    seen = {},
    out = [];
  list.forEach(function (item) {
    var name = String(item == null ? '' : item)
      .trim()
      .toLowerCase();
    if (!name || seen[name] || WB_GENERATION_TRIGGERS.indexOf(name) < 0) return;
    seen[name] = true;
    out.push(name);
  });
  return out;
}
// Yeyu只有 new / continue / auto / regenerate 四种生成入口，其余官方生成类型没有本地来源。
function wbGenerationTypeForMode(mode) {
  var name = String(mode || '')
    .trim()
    .toLowerCase();
  if (name === 'continue' || name === 'auto') return 'continue';
  if (name === 'regenerate') return 'regenerate';
  return 'normal';
}
function wbPosition(v) {
  if (typeof v === 'string') {
    var p = v.trim().toLowerCase();
    if (p === 'in_chat') return 'at_depth';
    if (WB_POSITIONS.includes(p)) return p;
    if (/^before/i.test(p)) return 'before_char';
    if (/^after/i.test(p)) return 'after_char';
  }
  var n = parseInt(v);
  if (Number.isFinite(n)) return WB_POSITION_BY_INDEX[n] || 'after_char';
  return 'after_char';
}
function wbEscapeRegex(value) {
  return String(value || '').replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}
function wbRegexKey(value) {
  var key = String(value || '').trim();
  return key.charAt(0) === '/' ? key : '';
}
// Same grammar as SillyTavern parseRegexFromString: /pattern/flags, delimiters escaped, JS flags only.
function wbParseRegexPattern(raw) {
  var match = String(raw || '').match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match) return { valid: false, reason: '格式应为 /pattern/flags' };
  var pattern = match[1],
    flags = match[2];
  if (pattern.match(/(^|[^\\])\//)) return { valid: false, reason: '正则中的 / 需要写成 \\/' };
  pattern = pattern.replace(/\\\//g, '/');
  try {
    return { valid: true, pattern: pattern, flags: flags, regex: new RegExp(pattern, flags) };
  } catch (_) {
    return { valid: false, reason: '正则语法无效' };
  }
}
function wbParseRegexKey(value) {
  var key = wbRegexKey(value);
  if (!key) return null;
  return wbParseRegexPattern(key);
}
function wbParseRegexValue(value, _caseSens, forceRegex) {
  if (!forceRegex) return wbParseRegexKey(value);
  var raw = String(value || '').trim();
  if (!raw) return { valid: false, reason: '模式不能为空' };
  if (raw.charAt(0) === '/' && /^\/([\w\W]+?)\/([gimsuy]*)$/.test(raw)) return wbParseRegexPattern(raw);
  try {
    return { valid: true, pattern: raw, flags: '', regex: new RegExp(raw) };
  } catch (_) {
    return { valid: false, reason: '正则语法无效' };
  }
}
// Forced-regex mode (every key is a bare pattern and only the first one counts) is kept only for
// entries already stored with Yeyu's own useRegex flag. The card-spec use_regex field is never
// read: SillyTavern writes use_regex:true on every export and ignores it on import, matching each
// key as /pattern/flags or as plain text. Matching, the import audit and localization all ask this.
function wbEntryForcesRegex(e) {
  return !!e && wbHas(e.useRegex) && wbBool(e.useRegex, false);
}
// SillyTavern convertCharacterBook: a numeric extensions.position is the real slot; the top-level
// card-spec position only says before or after the character.
function wbEntryPositionSource(e, ext) {
  var extPosition = ext && ext.position;
  if (typeof extPosition === 'number' || (typeof extPosition === 'string' && /^\s*\d+\s*$/.test(extPosition)))
    return extPosition;
  return wbHas(e.position) ? e.position : extPosition;
}
// The single judgment for what a world book key matches with. SillyTavern parseRegexFromString
// returns null for anything that is not /pattern/flags, and matchKeys then matches the key as
// ordinary text, so a key that merely starts with "/" is never an error. Only an explicit
// use_regex field has no text fallback, which is the one case that can report an invalid pattern.
function wbKeyMatchPlan(value, caseSens, forceRegex) {
  if (forceRegex) {
    var forced = wbParseRegexValue(value, caseSens, true);
    if (forced && forced.valid) return { mode: 'regex', parsed: forced };
    return { mode: 'invalid', reason: (forced && forced.reason) || '正则格式无效' };
  }
  var parsed = wbParseRegexKey(value);
  if (parsed && parsed.valid) return { mode: 'regex', parsed: parsed };
  return { mode: 'literal' };
}
function wbRegexSafetyForKeys(keys, caseSens, forceRegex) {
  var unsafe = [];
  (keys || []).forEach(function (value) {
    var plan = wbKeyMatchPlan(value, caseSens, forceRegex);
    if (plan.mode === 'invalid') unsafe.push({ key: String(value || ''), reason: plan.reason });
  });
  return { valid: unsafe.length === 0, unsafe: unsafe };
}
function wbRegexGuardSkip(guard, entryId, reason) {
  if (!guard) return;
  guard.skipped[String(entryId || '')] = reason;
}
function parseWorldBookDecorators(value) {
  var lines = String(value || '')
      .replace(/\r\n?/g, '\n')
      .split('\n'),
    prefix = [],
    groups = [],
    current = null,
    index = 0,
    started = false;
  for (; index < lines.length; index++) {
    var line = lines[index],
      trimmed = line.trim();
    if (!trimmed && !started) {
      prefix.push(line);
      continue;
    }
    var match = trimmed.match(/^(@@@?)([a-z_]+)(?:\s+([\s\S]*))?$/i);
    if (!match) break;
    started = true;
    prefix.push(line);
    var row = {
      name: String(match[2] || '').toLowerCase(),
      value: String(match[3] || '').trim(),
      fallback: match[1] === '@@@',
    };
    if (row.fallback && current) current.push(row);
    else {
      current = [row];
      groups.push(current);
    }
  }
  while (index < lines.length && !lines[index].trim()) index++;
  var out = {
      content: lines.slice(index).join('\n').trim(),
      lines: prefix.filter(function (line) {
        return !!line.trim();
      }),
      depth: null,
      instructDepth: null,
      reverseDepth: null,
      reverseInstructDepth: null,
      role: '',
      position: '',
      positionFallbackRows: [],
      greetingFallbackRows: [],
      scanDepth: null,
      instructScanDepth: null,
      activateOnlyAfter: null,
      activateOnlyEvery: null,
      keepActivateAfterMatch: false,
      dontActivateAfterMatch: false,
      additionalKeyGroups: [],
      excludeKeys: [],
      ignoreOnMaxContext: false,
      greetingIndex: null,
      userIcon: '',
      disableUiPrompt: '',
      activate: false,
      dontActivate: false,
    },
    seen = {};
  function integer(value, min) {
    var number = Number(value);
    return Number.isInteger(number) && number >= min ? number : null;
  }
  function apply(row) {
    var name = row.name,
      value = row.value,
      number;
    if (name === 'depth') {
      number = integer(value, 0);
      if (number == null) return false;
      out.depth = number;
      return true;
    }
    if (name === 'instruct_depth') {
      number = integer(value, 0);
      if (number == null) return false;
      out.instructDepth = number;
      return true;
    }
    if (name === 'reverse_depth') {
      number = integer(value, 0);
      if (number == null) return false;
      out.reverseDepth = number;
      return true;
    }
    if (name === 'reverse_instruct_depth') {
      number = integer(value, 0);
      if (number == null) return false;
      out.reverseInstructDepth = number;
      return true;
    }
    if (name === 'role') {
      var role = value.toLowerCase();
      if (!['system', 'user', 'assistant'].includes(role)) return false;
      out.role = role;
      return true;
    }
    if (name === 'position') {
      var position = value.toLowerCase();
      if (!['before_desc', 'after_desc', 'personality', 'scenario'].includes(position)) return false;
      out.position = position;
      return true;
    }
    if (name === 'scan_depth') {
      number = integer(value, 0);
      if (number == null) return false;
      out.scanDepth = number;
      return true;
    }
    if (name === 'instruct_scan_depth') {
      number = integer(value, 0);
      if (number == null) return false;
      out.instructScanDepth = number;
      return true;
    }
    if (name === 'activate_only_after') {
      number = integer(value, 0);
      if (number == null) return false;
      out.activateOnlyAfter = number;
      return true;
    }
    if (name === 'activate_only_every') {
      number = integer(value, 1);
      if (number == null) return false;
      out.activateOnlyEvery = number;
      return true;
    }
    if (name === 'keep_activate_after_match' && !value) {
      out.keepActivateAfterMatch = true;
      return true;
    }
    if (name === 'dont_activate_after_match' && !value) {
      out.dontActivateAfterMatch = true;
      return true;
    }
    if (name === 'additional_keys') {
      var additional = wbKeyList(value);
      if (!additional.length) return false;
      out.additionalKeyGroups.push(additional);
      return true;
    }
    if (name === 'exclude_keys') {
      var excluded = wbKeyList(value);
      if (!excluded.length) return false;
      out.excludeKeys = excluded;
      return true;
    }
    if (name === 'ignore_on_max_context' && !value) {
      out.ignoreOnMaxContext = true;
      return true;
    }
    if (name === 'is_greeting') {
      number = integer(value, 0);
      if (number == null) return false;
      out.greetingIndex = number;
      return true;
    }
    if (name === 'is_user_icon' && value) {
      out.userIcon = value;
      return false;
    }
    if (name === 'disable_ui_prompt') {
      var promptType = value.toLowerCase();
      if (!['post_history_instructions', 'system_prompt'].includes(promptType)) return false;
      out.disableUiPrompt = promptType;
      return true;
    }
    if (name === 'activate' && !value) {
      out.activate = true;
      return true;
    }
    if (name === 'dont_activate' && !value) {
      out.dontActivate = true;
      return true;
    }
    return false;
  }
  groups.forEach(function (group) {
    if (group[0] && group[0].name === 'position' && !out.positionFallbackRows.length)
      out.positionFallbackRows = group.slice(1, 6).map(function (row) {
        return { name: row.name, value: row.value };
      });
    if (group[0] && group[0].name === 'is_greeting' && !out.greetingFallbackRows.length)
      out.greetingFallbackRows = group.slice(1, 6).map(function (row) {
        return { name: row.name, value: row.value };
      });
    for (var candidateIndex = 0; candidateIndex < Math.min(6, group.length); candidateIndex++) {
      var row = group[candidateIndex],
        multiple = row.name === 'additional_keys';
      if (seen[row.name] && !multiple) break;
      if (apply(row)) {
        if (!multiple) seen[row.name] = true;
        break;
      }
    }
  });
  if (out.activate) out.dontActivate = false;
  return out;
}
function wbConstantFlag(e) {
  e = e || {};
  return wbBool(wbHas(e.constant) ? e.constant : wbHas(e.always_active) ? e.always_active : e.alwaysActive, false);
}
function wbFirstNonEmptyKeyList(values) {
  for (var i = 0; i < values.length; i++) {
    var list = wbKeyList(values[i]);
    if (list.length) return list;
  }
  return [];
}
// Where an entry's trigger words and their Chinese aliases may live, in the order every reader
// accepts them: normalization here, and import localization before an entry is normalized.
function wbEntryTriggerKeys(e, secondary) {
  e = e || {};
  return wbFirstNonEmptyKeyList(
    secondary
      ? [e.secondary_keys, e.secondary, e.keysecondary, e.secondaryKeys, e.filters]
      : [e.keys, e.key, e.keywords, e.primary_keys]
  );
}
function wbEntryTriggerAliases(e, secondary) {
  e = e || {};
  var ext = e.extensions && typeof e.extensions === 'object' ? e.extensions : {},
    yeyuExt = ext.yeyu && typeof ext.yeyu === 'object' && !Array.isArray(ext.yeyu) ? ext.yeyu : {},
    sources = [e, ext, yeyuExt],
    listKeys = secondary ? ['secondaryKeyAliases', 'secondary_key_aliases'] : ['keyAliases', 'key_aliases'],
    mapKeys = secondary ? ['secondaryKeyAliasMap', 'secondary_key_alias_map'] : ['keyAliasMap', 'key_alias_map'],
    lists = [],
    map = null;
  sources.forEach(function (source) {
    listKeys.forEach(function (key) {
      lists.push(source[key]);
    });
    mapKeys.forEach(function (key) {
      if (!map && source[key]) map = source[key];
    });
  });
  return { aliases: wbFirstNonEmptyKeyList(lists), map: map || {} };
}
function normalizeWBEntry(e) {
  e = e || {};
  var ext = e.extensions && typeof e.extensions === 'object' ? e.extensions : {};
  const keys = wbEntryTriggerKeys(e, false);
  const secondary = wbEntryTriggerKeys(e, true),
    primaryAliasSource = wbEntryTriggerAliases(e, false),
    secondaryAliasSource = wbEntryTriggerAliases(e, true),
    keyAliases = primaryAliasSource.aliases,
    secondaryAliases = secondaryAliasSource.aliases,
    rawPrimaryMap = primaryAliasSource.map,
    rawSecondaryMap = secondaryAliasSource.map,
    primaryAliasMap = {},
    secondaryAliasMap = {};
  if (rawPrimaryMap && typeof rawPrimaryMap === 'object' && !Array.isArray(rawPrimaryMap))
    Object.keys(rawPrimaryMap).forEach(function (key) {
      var aliases = wbKeyList(rawPrimaryMap[key]);
      if (aliases.length) primaryAliasMap[String(key)] = aliases;
    });
  if (rawSecondaryMap && typeof rawSecondaryMap === 'object' && !Array.isArray(rawSecondaryMap))
    Object.keys(rawSecondaryMap).forEach(function (key) {
      var aliases = wbKeyList(rawSecondaryMap[key]);
      if (aliases.length) secondaryAliasMap[String(key)] = aliases;
    });
  const probabilitySource = wbHas(e.probability)
    ? e.probability
    : wbHas(e.chance)
      ? e.chance
      : wbHas(ext.probability)
        ? ext.probability
        : 100;
  const useProbability = e.useProbability !== false && e.use_probability !== false && ext.useProbability !== false;
  const probability = useProbability ? wbClamp(wbNumber(probabilitySource, 100), 0, 100) : 100;
  const orderSource = wbHas(e.order) ? e.order : wbHas(e.insertion_order) ? e.insertion_order : e.priority;
  const depthSource = wbHas(e.depth) ? e.depth : wbHas(e.insertion_depth) ? e.insertion_depth : ext.depth;
  var rawComment = e.comment != null ? String(e.comment) : e.notes != null ? String(e.notes) : '',
    rawContent = e.content || e.text || e.value || e.entry || e.prompt || '',
    decorators =
      typeof parseWorldBookDecorators === 'function'
        ? parseWorldBookDecorators(rawContent)
        : { content: rawContent, lines: [], depth: null, role: '', activate: false, dontActivate: false },
    rawRole = decorators.role || String(wbHas(e.role) ? e.role : ext.role || '').toLowerCase(),
    normalizedRole =
      rawRole === 'user' || rawRole === '1'
        ? 'user'
        : rawRole === 'assistant' || rawRole === '2'
          ? 'assistant'
          : 'system',
    useRegex = wbEntryForcesRegex(e),
    positionSource = wbEntryPositionSource(e, ext),
    decoratorDepth =
      decorators.depth != null ||
      decorators.instructDepth != null ||
      decorators.reverseDepth != null ||
      decorators.reverseInstructDepth != null;
  var caseSensitive = wbHas(e.case_sensitive)
      ? wbBool(e.case_sensitive, false)
      : wbHas(e.caseSensitive)
        ? wbBool(e.caseSensitive, false)
        : wbHas(ext.case_sensitive)
          ? wbBool(ext.case_sensitive, false)
          : null,
    entryId = wbEntryIdText(e.id) || wbEntryIdText(e.uid) || uid();
  var pick = function () {
      for (var i = 0; i < arguments.length; i++) if (wbHas(arguments[i])) return arguments[i];
      return undefined;
    },
    nullableBool = function (value) {
      return value === undefined ? null : wbBool(value, false);
    },
    rawFilter = e.characterFilter || e.character_filter || ext.character_filter || ext.characterFilter || null,
    filterNames = wbKeyList(rawFilter && (Array.isArray(rawFilter) ? rawFilter : rawFilter.names)).concat(
      wbKeyList(pick(e.characterFilterNames, e.character_filter_names, ext.character_filter_names))
    ),
    filterTags = wbKeyList(rawFilter && !Array.isArray(rawFilter) && rawFilter.tags).concat(
      wbKeyList(pick(e.characterFilterTags, e.character_filter_tags, ext.character_filter_tags))
    ),
    filterExclude = wbBool(
      pick(
        rawFilter && !Array.isArray(rawFilter) && rawFilter.isExclude,
        e.characterFilterExclude,
        e.character_filter_exclude,
        ext.character_filter_exclude
      ),
      false
    ),
    characterFilter =
      filterNames.length || filterTags.length || filterExclude
        ? { isExclude: filterExclude, names: Array.from(new Set(filterNames)), tags: Array.from(new Set(filterTags)) }
        : null;
  return {
    id: entryId,
    name: e.name || e.title || '',
    localizedName: e.localizedName || e.localized_name || '',
    keys: keys,
    keyAliases: keyAliases,
    keyAliasMap: primaryAliasMap,
    content: decorators.content,
    comment: rawComment,
    enabled: e.enabled !== false && e.disable !== true && e.disabled !== true && e.active !== false,
    constant: wbConstantFlag(e),
    selective: wbBool(wbHas(e.selective) ? e.selective : secondary.length > 0 ? true : false, false),
    secondary_keys: secondary,
    secondaryKeyAliases: secondaryAliases,
    secondaryKeyAliasMap: secondaryAliasMap,
    position: decorators.position ? 'character_card' : decoratorDepth ? 'at_depth' : wbPosition(positionSource),
    order: wbNumber(orderSource, 100),
    depth: decorators.depth != null ? decorators.depth : wbDepth(depthSource),
    decoratorDepth: decorators.depth,
    instructDepth: decorators.instructDepth,
    reverseDepth: decorators.reverseDepth,
    reverseInstructDepth: decorators.reverseInstructDepth,
    characterPosition: decorators.position,
    characterPositionFallbacks: decorators.positionFallbackRows,
    scanDepth:
      decorators.scanDepth != null
        ? decorators.scanDepth
        : wbHas(e.scanDepth)
          ? Math.max(0, wbNumber(e.scanDepth, 0))
          : wbHas(e.scan_depth)
            ? Math.max(0, wbNumber(e.scan_depth, 0))
            : wbHas(ext.scanDepth)
              ? Math.max(0, wbNumber(ext.scanDepth, 0))
              : wbHas(ext.scan_depth)
                ? Math.max(0, wbNumber(ext.scan_depth, 0))
                : null,
    instructScanDepth: decorators.instructScanDepth,
    activateOnlyAfter: decorators.activateOnlyAfter,
    activateOnlyEvery: decorators.activateOnlyEvery,
    keepActivateAfterMatch: decorators.keepActivateAfterMatch,
    dontActivateAfterMatch: decorators.dontActivateAfterMatch,
    additionalKeyGroups: decorators.additionalKeyGroups,
    excludeKeys: decorators.excludeKeys,
    ignoreOnMaxContext: decorators.ignoreOnMaxContext,
    greetingIndex: decorators.greetingIndex,
    greetingFallbacks: decorators.greetingFallbackRows,
    userIconDecorator: decorators.userIcon,
    disableUiPrompt: decorators.disableUiPrompt,
    probability: probability,
    useProbability: useProbability,
    selectiveLogic: wbHas(e.selectiveLogic)
      ? e.selectiveLogic
      : wbHas(e.selective_logic)
        ? e.selective_logic
        : ext.selectiveLogic,
    excludeRecursion: wbBool(
      wbHas(e.excludeRecursion)
        ? e.excludeRecursion
        : wbHas(e.exclude_recursion)
          ? e.exclude_recursion
          : ext.exclude_recursion,
      false
    ),
    caseSensitive: caseSensitive,
    characterFilter: characterFilter,
    // Official generation-type filter. Non generation-type values are dropped from the
    // filter but stay untouched in extensions and _raw, matching the official arrayFilter.
    triggers: wbGenerationTriggerList(pick(e.triggers, ext.triggers)),
    ignoreBudget: wbBool(pick(e.ignoreBudget, e.ignore_budget, ext.ignore_budget, ext.ignoreBudget), false),
    matchPersonaDescription: wbBool(
      pick(e.matchPersonaDescription, e.match_persona_description, ext.match_persona_description),
      false
    ),
    matchCharacterDescription: wbBool(
      pick(e.matchCharacterDescription, e.match_character_description, ext.match_character_description),
      false
    ),
    matchCharacterPersonality: wbBool(
      pick(e.matchCharacterPersonality, e.match_character_personality, ext.match_character_personality),
      false
    ),
    matchCharacterDepthPrompt: wbBool(
      pick(e.matchCharacterDepthPrompt, e.match_character_depth_prompt, ext.match_character_depth_prompt),
      false
    ),
    matchScenario: wbBool(pick(e.matchScenario, e.match_scenario, ext.match_scenario), false),
    matchCreatorNotes: wbBool(pick(e.matchCreatorNotes, e.match_creator_notes, ext.match_creator_notes), false),
    useGroupScoring: nullableBool(pick(e.useGroupScoring, e.use_group_scoring, ext.use_group_scoring)),
    outletName: String(pick(e.outletName, e.outlet_name, ext.outlet_name) || '').trim(),
    automationId: String(pick(e.automationId, e.automation_id, ext.automation_id) || '').trim(),
    addMemo: wbBool(e.addMemo, false),
    insertionOrder: wbNumber(wbHas(e.insertion_order) ? e.insertion_order : orderSource, 100),
    sticky: Math.max(
      0,
      wbNumber(
        wbHas(e.sticky) ? e.sticky : wbHas(e.sticky_depth) ? e.sticky_depth : wbHas(ext.sticky) ? ext.sticky : 0,
        0
      )
    ),
    cooldown: Math.max(
      0,
      wbNumber(
        wbHas(e.cooldown)
          ? e.cooldown
          : wbHas(e.cooldown_turns)
            ? e.cooldown_turns
            : wbHas(ext.cooldown)
              ? ext.cooldown
              : 0,
        0
      )
    ),
    delay: Math.max(0, wbNumber(wbHas(e.delay) ? e.delay : wbHas(ext.delay) ? ext.delay : 0, 0)),
    delayUntilRecursion: wbHas(e.delayUntilRecursion)
      ? e.delayUntilRecursion
      : wbHas(e.delay_until_recursion)
        ? e.delay_until_recursion
        : ext.delay_until_recursion,
    preventRecursion: wbBool(
      wbHas(e.preventRecursion)
        ? e.preventRecursion
        : wbHas(e.prevent_recursion)
          ? e.prevent_recursion
          : ext.prevent_recursion,
      false
    ),
    matchWholeWords: nullableBool(
      pick(e.matchWholeWords, e.match_whole_words, ext.match_whole_words, ext.matchWholeWords)
    ),
    group: String(wbHas(e.group) ? e.group : ext.group || '').trim(),
    groupOverride: wbBool(
      wbHas(e.group_override) ? e.group_override : wbHas(e.groupOverride) ? e.groupOverride : ext.group_override,
      false
    ),
    groupWeight: Math.max(
      1,
      wbNumber(wbHas(e.group_weight) ? e.group_weight : wbHas(e.groupWeight) ? e.groupWeight : ext.group_weight, 100)
    ),
    role: normalizedRole,
    useRegex: useRegex,
    // Trigger strategy is a three-way choice: constant, keyword or vector. Data that
    // carries both flags keeps the constant meaning, so the entry never stops being
    // delivered when embedding retrieval is unavailable.
    vectorized: !wbConstantFlag(e) && wbBool(wbHas(e.vectorized) ? e.vectorized : ext.vectorized, false),
    forceActivate: decorators.activate,
    dontActivate: decorators.dontActivate,
    decoratorLines: decorators.lines,
    sourcePosition: positionSource,
    extensions: ext,
    _fromChar: e._fromChar || '',
    _raw: e._raw || e,
    localizationStatus: e.localizationStatus || e.localization_status || '',
  };
}
// Official world info settings with SillyTavern 1.19.0 defaults.
var WB_INSERTION_STRATEGIES = ['evenly', 'character_first', 'global_first'];
function worldBookSettings() {
  var wb = (typeof D !== 'undefined' && D && D.worldBook) || {},
    strategy = String(wb.insertion_strategy || '')
      .trim()
      .toLowerCase();
  return {
    scanDepth: Math.max(0, wbNumber(wb.scan_depth, 20)),
    // 比例与固定上限都以 0 表示不限，默认不给世界书设上限。
    budgetPercent: wbClamp(wbNumber(wb.budget_percent, 0), 0, 100),
    budgetCap: Math.max(0, wbNumber(wb.token_budget, 0)),
    includeNames: wb.include_names !== false,
    recursive: wb.recursive === true,
    caseSensitive: wb.case_sensitive === true,
    matchWholeWords: wb.match_whole_words === true,
    useGroupScoring: wb.use_group_scoring === true,
    minActivations: Math.max(0, wbNumber(wb.min_activations, 0)),
    minActivationsDepthMax: Math.max(0, wbNumber(wb.min_activations_depth_max, 0)),
    maxRecursionSteps: Math.max(0, wbNumber(wb.max_recursion_steps, 0)),
    insertionStrategy: WB_INSERTION_STRATEGIES.includes(strategy) ? strategy : 'character_first',
    vectorEnabled: wb.vector_enabled !== false,
    vectorQueryMessages: Math.max(1, wbNumber(wb.vector_query_messages, 6)),
    vectorMaxEntries: Math.max(1, wbNumber(wb.vector_max_entries, 5)),
    vectorScoreThreshold: (function () {
      var value = wbHas(wb.vector_score_threshold) ? Number(wb.vector_score_threshold) : NaN;
      return wbClamp(Number.isFinite(value) ? value : 0.25, 0, 1);
    })(),
  };
}
function wbCategoryScope(cat) {
  return Array.isArray(cat && cat.boundCharIds) && cat.boundCharIds.map(String).filter(Boolean).length
    ? 'character'
    : 'global';
}
// The categories in effect for a character, each with the lore list it joins in SillyTavern
// getSortedEntries: a book in the global selection is global; otherwise the chat book, then the
// persona book, then the character's bound or primary books.
function effectiveWBCategorySources(charId) {
  var id = String(charId || ''),
    globalIds = new Set(D.worldBook.globalCategoryIds || []),
    char = typeof getChar === 'function' ? getChar() : null;
  if (String((char && char.id) || '') !== id) char = null;
  var primary = String((char && char.extensions && char.extensions.world) || ''),
    box = D.chats && D.chats[id],
    session =
      box && Array.isArray(box.sessions)
        ? box.sessions.find(function (row) {
            return String((row && row.id) || '') === String(box.activeSid || '');
          }) || box.sessions[0]
        : null,
    chatBook = String((session && session.tavernHelperChatLorebook) || ''),
    persona = typeof getActivePersona === 'function' ? getActivePersona(id) : null,
    personaBook = String((persona && persona.lorebook) || '');
  var rows = [];
  (D.worldBook.categories || []).forEach(function (cat) {
    var bound = Array.isArray(cat && cat.boundCharIds) ? cat.boundCharIds.map(String).filter(Boolean) : [],
      name = String((cat && cat.name) || ''),
      scope = globalIds.has(cat.id)
        ? 'global'
        : chatBook && name === chatBook
          ? 'chat'
          : personaBook && name === personaBook
            ? 'persona'
            : bound.includes(id) || (primary && name === primary)
              ? 'character'
              : '';
    if (scope) rows.push({ category: cat, scope: scope });
  });
  return rows;
}
function getEffectiveWBCategories(charId) {
  return effectiveWBCategorySources(charId).map(function (row) {
    return row.category;
  });
}
// Fills official defaults for entries saved before a field existed. Never re-parses
// decorators and never rewrites stored content.
function wbRuntimeEntry(entry, cat, scope) {
  var e = Object.assign({}, entry);
  e._catId = cat.id;
  e._catName = cat.name;
  e._catSettings = cat.settings || null;
  e._catScope = scope || wbCategoryScope(cat);
  e.position = wbPosition(wbHas(e.position) ? e.position : 'after_char');
  e.triggers = wbGenerationTriggerList(e.triggers);
  e.constant = e.constant === true;
  e.vectorized = !e.constant && e.vectorized === true;
  e.ignoreBudget = e.ignoreBudget === true;
  e.matchPersonaDescription = e.matchPersonaDescription === true;
  e.matchCharacterDescription = e.matchCharacterDescription === true;
  e.matchCharacterPersonality = e.matchCharacterPersonality === true;
  e.matchCharacterDepthPrompt = e.matchCharacterDepthPrompt === true;
  e.matchScenario = e.matchScenario === true;
  e.matchCreatorNotes = e.matchCreatorNotes === true;
  e.useGroupScoring = e.useGroupScoring == null ? null : e.useGroupScoring === true;
  e.matchWholeWords = e.matchWholeWords == null ? null : e.matchWholeWords === true;
  e.outletName = String(e.outletName || '').trim();
  e.automationId = String(e.automationId || '').trim();
  e.groupWeight = Math.max(1, wbNumber(e.groupWeight, 100));
  if (!e.characterFilter || typeof e.characterFilter !== 'object') e.characterFilter = null;
  else
    e.characterFilter = {
      isExclude: e.characterFilter.isExclude === true,
      names: wbKeyList(e.characterFilter.names),
      tags: wbKeyList(e.characterFilter.tags),
    };
  // Snapshot the source identity before vector and prompt environment overrides.
  if (wbEntryHasTimedEffect(e)) e.__wbHash = wbEntryHash(e);
  return e;
}
function getAllWBEntries(charId) {
  var entries = [];
  var vectorsEnabled = worldBookSettings().vectorEnabled;
  effectiveWBCategorySources(charId).forEach(function (row) {
    (row.category.entries || []).forEach(function (e) {
      var runtimeEntry = wbRuntimeEntry(e, row.category, row.scope);
      if (!vectorsEnabled) runtimeEntry.vectorized = false;
      entries.push(runtimeEntry);
    });
  });
  return entries;
}
function wbActivationStatus(entry) {
  var reason = entry && entry.__wbReason;
  return reason === 'sticky'
    ? 'sticky'
    : reason === 'recursive'
      ? 'recursive'
      : reason === 'vector'
        ? 'vector-hit'
        : 'activated';
}
function wbEntryRuntimeKey(entry) {
  return JSON.stringify([String((entry && entry._catId) || ''), String((entry && entry.id) || '')]);
}
// One generation attempt draws from one freshly seeded generator. The send scope belongs in
// the identity because session, message count and generation mode are all identical across
// consecutive regenerations of the same message: without it the second and third "regenerate"
// would replay the first one's seed instead of drawing again. Inside one attempt the scope
// holds still, so the dry run, the Worker top-up pass and the committed build share one roll.
var _wbRoundRandomBySession = typeof WeakMap === 'function' ? new WeakMap() : null;
function wbSeededRandom(seed) {
  var state = seed >>> 0 || 1;
  return function () {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}
function worldBookRoundRandom(session, identity) {
  var key =
    String(identity || '') + '|' + (typeof regexScriptScopeId === 'function' ? regexScriptScopeId(null, 'send') : '');
  if (!session || !_wbRoundRandomBySession) return wbSeededRandom(Math.floor(Math.random() * 4294967295));
  var row = _wbRoundRandomBySession.get(session);
  if (!row || row.identity !== key) {
    row = { identity: key, seed: Math.floor(Math.random() * 4294967295) };
    _wbRoundRandomBySession.set(session, row);
  }
  return wbSeededRandom(row.seed);
}
function wbHash32(value) {
  var text = String(value || ''),
    hash = 2166136261;
  for (var index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
// Timed-effect identity. Any stored field change invalidates the effect, matching the way
// SillyTavern hashes the whole entry; runtime-only underscore fields stay out of it. Only entries
// with a sticky, cooldown or delay can own or match a timed record, so only they carry the hash.
function wbEntryHasTimedEffect(entry) {
  return ['sticky', 'cooldown', 'delay'].some(function (type) {
    return wbNumber(entry && entry[type], 0) > 0;
  });
}
function wbEntryHash(entry) {
  var copy = {};
  Object.keys(entry || {}).forEach(function (key) {
    if (key.charAt(0) !== '_') copy[key] = entry[key];
  });
  return wbHash32(JSON.stringify(copy));
}
function worldBookTimedEffectTarget(file, uid) {
  var wanted = String(file == null ? '' : file),
    category = ((D && D.worldBook && D.worldBook.categories) || []).find(function (row) {
      return row && String(row.name || '') === wanted;
    });
  if (!category) return null;
  var row = cardFrontendWorldbookRows(category).find(function (row) {
    return String(row.uid) === String(uid);
  });
  if (!row) return null;
  var entry = row.entry;
  return {
    category: category,
    entry: entry,
    key: wbEntryRuntimeKey(entry),
    hash: entry.__wbHash,
  };
}
function worldBookTimedEffectMessageCount(session) {
  return ((session && session.msgs) || []).filter(function (message) {
    return message && (message.role === 'user' || message.role === 'assistant');
  }).length;
}
function worldBookTimedEffectMetadata(file, uid, effect, session) {
  var type = String(effect || '')
      .trim()
      .toLowerCase(),
    target = worldBookTimedEffectTarget(file, uid),
    runtime = session && session.worldBookRuntime,
    count = worldBookTimedEffectMessageCount(session);
  if (!target || !['sticky', 'cooldown', 'delay'].includes(type)) return null;
  if (type === 'delay') {
    var duration = Math.max(0, Number(target.entry.delay) || 0);
    return duration > count ? { hash: target.hash, start: 0, end: duration, protected: true } : null;
  }
  var row = runtime && runtime[type] && runtime[type][target.key];
  return row && String(row.hash) === String(target.hash) ? row : null;
}
async function worldBookSetTimedEffect(file, uid, effect, state, session) {
  var type = String(effect || '')
      .trim()
      .toLowerCase(),
    target = worldBookTimedEffectTarget(file, uid);
  if (!target || !session || !['sticky', 'cooldown'].includes(type)) return false;
  var duration = Math.max(0, Number(target.entry[type]) || 0);
  if (!duration) return false;
  var before = session.worldBookRuntime ? JSON.parse(JSON.stringify(session.worldBookRuntime)) : null,
    runtime = session.worldBookRuntime || (session.worldBookRuntime = {}),
    count = worldBookTimedEffectMessageCount(session);
  ['sticky', 'cooldown', 'matched'].forEach(function (name) {
    if (!runtime[name] || typeof runtime[name] !== 'object' || Array.isArray(runtime[name])) runtime[name] = {};
  });
  delete runtime[type][target.key];
  if (state)
    runtime[type][target.key] = {
      hash: target.hash,
      start: count,
      end: count + duration,
      protected: false,
    };
  try {
    if (typeof saveData === 'function') await saveData('sessions', { urgent: true });
  } catch (error) {
    if (before) session.worldBookRuntime = before;
    else delete session.worldBookRuntime;
    throw error;
  }
  return true;
}
// The character's tag list, or null when there is no tag data to filter by (SillyTavern skips the
// tag filter when the character has no tag map entry).
function worldBookCharacterTags(charId) {
  var char = (typeof D !== 'undefined' && D && Array.isArray(D.characters) ? D.characters : []).find(function (row) {
      return row && String(row.id) === String(charId);
    }),
    tags = char && [char.tags, char.tagList, char.data && char.data.tags].find(wbHas);
  return tags === undefined ? null : wbKeyList(tags);
}
// Shared scan window: depth slicing, message boundary, extra sources, injections and the
// recursion buffer, following the official WorldInfoBuffer.
function wbScanBuffer(messages, globalScanData, settings) {
  var depthBuffer = (Array.isArray(messages) ? messages : [])
      .map(function (text) {
        return String(text || '').trim();
      })
      .reverse(),
    recurse = [],
    inject = [],
    skew = 0,
    MATCHER = String.fromCharCode(1),
    JOINER = '\n' + String.fromCharCode(1),
    MAX_SCAN_DEPTH = 1000;
  return {
    messageCount: depthBuffer.length,
    addRecurse: function (text) {
      recurse.push(text);
    },
    addInject: function (text) {
      inject.push(text);
    },
    hasRecurse: function () {
      return recurse.length > 0;
    },
    advanceScan: function () {
      skew++;
    },
    getDepth: function () {
      return settings.scanDepth + skew;
    },
    get: function (entry, scanState) {
      var catDepth =
          entry && entry._catSettings && entry._catSettings.scan_depth != null
            ? Number(entry._catSettings.scan_depth)
            : null,
        depth =
          entry && entry.scanDepth != null
            ? Number(entry.scanDepth)
            : catDepth > 0
              ? catDepth + skew
              : settings.scanDepth + skew;
      if (!(depth > 0)) return '';
      if (depth > MAX_SCAN_DEPTH) depth = MAX_SCAN_DEPTH;
      var result = MATCHER + depthBuffer.slice(0, depth).join(JOINER);
      if (entry.matchPersonaDescription && globalScanData.personaDescription)
        result += JOINER + globalScanData.personaDescription;
      if (entry.matchCharacterDescription && globalScanData.characterDescription)
        result += JOINER + globalScanData.characterDescription;
      if (entry.matchCharacterPersonality && globalScanData.characterPersonality)
        result += JOINER + globalScanData.characterPersonality;
      if (entry.matchCharacterDepthPrompt && globalScanData.characterDepthPrompt)
        result += JOINER + globalScanData.characterDepthPrompt;
      if (entry.matchScenario && globalScanData.scenario) result += JOINER + globalScanData.scenario;
      if (entry.matchCreatorNotes && globalScanData.creatorNotes) result += JOINER + globalScanData.creatorNotes;
      if (inject.length) result += JOINER + inject.join(JOINER);
      if (recurse.length && scanState !== 3) result += JOINER + recurse.join(JOINER);
      return result;
    },
  };
}
// ---- Terminable regex-key oracle -------------------------------------------------
// Regex keys run in the existing terminable card-script regex Worker. The synchronous
// resolver only reads answers that are already computed; misses are filled by
// prepareWorldBookRegexKeys before the committed build, so a pathological pattern spins the
// Worker rather than the WebView, and stopping generation terminates it.
var _wbRegexKeyResults = new Map(),
  _wbRegexKeyMisses = new Map(),
  _wbRegexKeyErrors = new Map();
function wbRegexKeyCacheKey(pattern, flags, text) {
  return JSON.stringify([pattern, flags, text]);
}
function resetWorldBookRegexKeyScope() {
  _wbRegexKeyResults.clear();
  _wbRegexKeyMisses.clear();
  _wbRegexKeyErrors.clear();
}
function worldBookRegexKeyMisses() {
  var rows = Array.from(_wbRegexKeyMisses.values());
  _wbRegexKeyMisses.clear();
  return rows;
}
function wbRegexKeyLookup(parsed, text, regexGuard, entryId) {
  var cacheKey = wbRegexKeyCacheKey(parsed.pattern, parsed.flags, text);
  if (_wbRegexKeyErrors.has(cacheKey)) {
    wbRegexGuardSkip(regexGuard, entryId, _wbRegexKeyErrors.get(cacheKey));
    return false;
  }
  if (_wbRegexKeyResults.has(cacheKey)) return _wbRegexKeyResults.get(cacheKey) === true;
  _wbRegexKeyMisses.set(cacheKey, { cacheKey: cacheKey, pattern: parsed.pattern, flags: parsed.flags, input: text });
  wbRegexGuardSkip(regexGuard, entryId, '正则关键词尚未在隔离环境中算完，本次按未命中处理');
  return false;
}
async function prepareWorldBookRegexKeys(char, rows, options) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  // Without the Worker there is no way to answer a regex key. Returning here would leave the
  // caller rediscovering the same misses forever, so fail the generation with a readable cause.
  if (
    typeof callScriptWorker !== 'function' ||
    typeof scriptWorkerHandle !== 'function' ||
    typeof cardRegexWorkerName !== 'function'
  )
    throw new Error('正则关键词需要隔离 Worker，当前环境不可用，本次生成已停止');
  options = options || {};
  var signal = options.signal || (options.controller && options.controller.signal) || null,
    workerName = cardRegexWorkerName(char),
    handle = scriptWorkerHandle(workerName),
    done = 0,
    abortError = function () {
      var error = new Error('已取消');
      error.name = 'AbortError';
      return error;
    },
    onAbort = function () {
      if (typeof terminateScriptWorker === 'function') terminateScriptWorker(workerName);
    };
  if (signal && signal.aborted) throw abortError();
  if (signal && typeof signal.addEventListener === 'function')
    signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (var index = 0; index < rows.length; index++) {
      if (signal && signal.aborted) throw abortError();
      var row = rows[index];
      try {
        var value = await callScriptWorker(handle, {
          type: 'regexTest',
          pattern: String(row.pattern),
          flags: String(row.flags || ''),
          input: String(row.input || ''),
        });
        if (signal && signal.aborted) throw abortError();
        _wbRegexKeyResults.set(row.cacheKey, value === true);
        done++;
      } catch (error) {
        if (signal && signal.aborted) throw abortError();
        var note = '正则关键词已被停止或执行失败：' + String((error && error.message) || error);
        _wbRegexKeyErrors.set(row.cacheKey, note);
        // These rows run one at a time, so the queue never holds more than this call and every row
        // would pay its own RPC budget. A Worker-level fault is the environment, not this pattern:
        // the remaining rows would only buy the same answer M budgets later, so they are recorded
        // unanswered here and the loop stops. A regex-level fault belongs to this pattern alone and
        // leaves the rest of the rows to run. Either way the send continues with these keys treated
        // as misses.
        if (error && error.cardScriptCode === 'worker') {
          for (var rest = index + 1; rest < rows.length; rest++) _wbRegexKeyErrors.set(rows[rest].cacheKey, note);
          break;
        }
      }
    }
    return done;
  } finally {
    if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
  }
}
// ---- Official key matching -------------------------------------------------------
function wbMatch(keys, text, caseSens, wholeWords, regexGuard, entryId, forceRegex) {
  const source = String(text || ''),
    t = caseSens ? source : source.toLowerCase();
  var candidates = forceRegex ? (keys || []).slice(0, 1) : keys || [];
  for (const k of candidates) {
    const key = String(k || ''),
      kk = caseSens ? key : key.toLowerCase();
    var plan = wbKeyMatchPlan(key, caseSens, forceRegex);
    if (plan.mode === 'invalid') {
      // Only an explicit regex field stays skipped, so only that branch records a guard note;
      // a literal fallback is not a skipped regex.
      wbRegexGuardSkip(regexGuard, entryId, plan.reason);
      continue;
    }
    var parsed = plan.mode === 'regex' ? plan.parsed : null;
    if (parsed) {
      // A regex key overrides case and whole-word options, exactly like SillyTavern matchKeys.
      if (wbRegexKeyLookup(parsed, source, regexGuard, entryId)) return true;
    } else if (wholeWords) {
      var words = kk.split(/\s+/);
      if (words.length > 1) {
        if (t.includes(kk)) return true;
      } else {
        var boundary = new RegExp('(?:^|\\W)(' + wbEscapeRegex(kk) + ')(?:$|\\W)');
        if (boundary.test(t)) return true;
      }
    } else if (t.includes(kk)) return true;
  }
  return false;
}
function wbAliasResolver(sources, map, legacy) {
  var byKey = {},
    unique = [],
    seen = {};
  if (map && typeof map === 'object' && !Array.isArray(map))
    Object.keys(map).forEach(function (key) {
      var values = wbKeyList(map[key]);
      if (values.length) {
        byKey[String(key)] = (byKey[String(key)] || []).concat(values);
        byKey[String(key).trim().toLowerCase()] = (byKey[String(key).trim().toLowerCase()] || []).concat(values);
      }
    });
  (sources || []).forEach(function (source) {
    var folded = String(source).trim().toLowerCase();
    if (!seen[folded]) {
      seen[folded] = true;
      unique.push(String(source));
    }
  });
  var legacyList = wbKeyList(legacy),
    positional = legacyList.length >= unique.length;
  return function (source) {
    var exact = String(source),
      folded = exact.trim().toLowerCase(),
      values = (byKey[exact] || []).concat(byKey[folded] || []);
    if (!values.length && positional) {
      var index = unique.findIndex(function (item) {
        return item.trim().toLowerCase() === folded;
      });
      if (index >= 0) values = [legacyList[index]];
    }
    return Array.from(new Set(values));
  };
}
// After an edit removes keys, the aliases their keyAliasMap rows brought in (AI localization writes
// both the map and the flat list) go with them. Free aliases that no map row names stay, and so does
// an alias that a remaining key still maps to.
function wbPruneKeyAliases(aliases, map, previousKeys, nextKeys) {
  var fold = function (key) {
      return String(key).trim().toLowerCase();
    },
    next = new Set(wbKeyList(nextKeys).map(fold)),
    removed = new Set(
      wbKeyList(previousKeys)
        .map(fold)
        .filter(function (key) {
          return !next.has(key);
        })
    ),
    keptMap = {},
    dropped = new Set(),
    kept = new Set();
  Object.keys(map && typeof map === 'object' && !Array.isArray(map) ? map : {}).forEach(function (key) {
    var values = wbKeyList(map[key]);
    if (removed.has(fold(key)))
      values.forEach(function (value) {
        dropped.add(value);
      });
    else {
      keptMap[key] = map[key];
      values.forEach(function (value) {
        kept.add(value);
      });
    }
  });
  return {
    aliases: wbKeyList(aliases).filter(function (alias) {
      return !dropped.has(alias) || kept.has(alias);
    }),
    map: keptMap,
  };
}
// The one official character filter (SillyTavern checkWorldInfo): names and tags are two separate
// passes with the same include or exclude mode, so an include filter needs both to match. Main
// activation and every prompt helper that consumes entries share it, so no path can inject an
// entry the current character is filtered out of.
function wbEntryPassesCharacterFilter(e, charId) {
  var filter = e && e.characterFilter;
  if (!filter) return true;
  var names = wbKeyList(Array.isArray(filter) ? filter : filter.names),
    tags = wbKeyList(!Array.isArray(filter) && filter.tags),
    exclude = !Array.isArray(filter) && filter.isExclude === true,
    filteredBy = function (hit) {
      return exclude ? hit : !hit;
    };
  if (names.length) {
    var charName = String(getCharName(charId) || '');
    if (
      filteredBy(
        names.some(function (v) {
          return String(v) === String(charId) || String(v) === charName;
        })
      )
    )
      return false;
  }
  var tagList = tags.length ? worldBookCharacterTags(charId) : null;
  if (
    tagList &&
    filteredBy(
      tags.some(function (v) {
        return tagList.indexOf(String(v)) >= 0;
      })
    )
  )
    return false;
  return true;
}
function wbEntryCaseSensitive(e, settings) {
  return e.caseSensitive == null
    ? e._catSettings && e._catSettings.caseSensitive != null
      ? e._catSettings.caseSensitive === true
      : settings.caseSensitive
    : e.caseSensitive === true;
}
function wbEntryWholeWords(e, settings) {
  return e.matchWholeWords == null ? settings.matchWholeWords : e.matchWholeWords === true;
}
function wbEntryMatchesText(e, text, charId, regexGuard) {
  if (!wbEntryPassesCharacterFilter(e, charId)) return false;
  var settings = worldBookSettings(),
    sensitive = wbEntryCaseSensitive(e, settings),
    wholeWords = wbEntryWholeWords(e, settings),
    primaryKeys = e.keys || [],
    primaryAliases = e.keyAliases || [],
    primaryFor = wbAliasResolver(primaryKeys, e.keyAliasMap, primaryAliases),
    primaryMapped = primaryKeys.reduce(function (all, key) {
      return all.concat(primaryFor(key));
    }, []),
    primary = e.useRegex ? primaryKeys : primaryKeys.concat(primaryAliases, primaryMapped),
    secondary = e.secondary_keys || [],
    secondaryAliases = e.secondaryKeyAliases || [],
    secondaryFor = wbAliasResolver(secondary, e.secondaryKeyAliasMap, secondaryAliases),
    runtimeKey = wbEntryRuntimeKey(e);
  if (!primary.length || !wbMatch(primary, text, sensitive, wholeWords, regexGuard, runtimeKey, e.useRegex))
    return false;
  if (e.useRegex || !e.selective || !secondary.length) return true;
  var results = secondary.map(function (k) {
    return wbMatch([k].concat(secondaryFor(k)), text, sensitive, wholeWords, regexGuard, runtimeKey, false);
  });
  return window.YeyuPure.worldBookSelectiveMatch(e.selectiveLogic, results);
}
function worldBookNameGlossaryForMessages(messages, charId, maxPairs) {
  if (typeof D === 'undefined' || !D || !D.worldBook) return '';
  var rows = (Array.isArray(messages) ? messages : []).map(function (row) {
      return typeof row === 'string' ? row : String((row && row.content) || (row && row.text) || '');
    }),
    limit = Math.max(1, Math.min(48, Number(maxPairs) || 48)),
    guard = { skipped: Object.create(null) },
    matched = [];
  function score(entry, text) {
    var sensitive = wbEntryCaseSensitive(entry, worldBookSettings()),
      source = sensitive ? String(text || '') : String(text || '').toLowerCase(),
      primary = (entry.keys || []).concat(entry.keyAliases || []),
      secondary = (entry.secondary_keys || []).concat(entry.secondaryKeyAliases || []),
      total = 1;
    primary.concat(secondary).forEach(function (value, index) {
      var key = String(value || '');
      if (!key || key.charAt(0) === '/') return;
      var hit = source.indexOf(sensitive ? key : key.toLowerCase()) >= 0;
      if (hit) total += (index < primary.length ? 20 : 8) + Math.min(20, key.length);
    });
    return total;
  }
  getAllWBEntries(charId).forEach(function (entry, index) {
    if (!entry || !entry.enabled || entry.constant || !wbEntryPassesCharacterFilter(entry, charId)) return;
    var depth =
        entry._catSettings && Number(entry._catSettings.scan_depth) > 0
          ? Number(entry._catSettings.scan_depth)
          : Number(D.worldBook.scan_depth) || 20,
      text = rows.slice(-Math.max(1, depth)).join('\n');
    if (wbEntryMatchesText(entry, text, charId, guard))
      matched.push({ entry: entry, index: index, score: score(entry, text) });
  });
  matched.sort(function (a, b) {
    return b.score - a.score || wbNumber(a.entry.order, 100) - wbNumber(b.entry.order, 100) || a.index - b.index;
  });
  var pairs = [],
    seen = {};
  function add(original, localized) {
    original = String(original || '').trim();
    localized = String(localized || '').trim();
    var key = (original + '\u0000' + localized).toLowerCase();
    if (
      !original ||
      !localized ||
      original === localized ||
      !/[\u3400-\u9fff]/.test(localized) ||
      seen[key] ||
      pairs.length >= limit
    )
      return;
    seen[key] = 1;
    pairs.push(original + ' = ' + localized);
  }
  matched.some(function (row) {
    var entry = row.entry;
    add(entry.name, entry.localizedName);
    [
      [entry.keyAliasMap, entry.keys],
      [entry.secondaryKeyAliasMap, entry.secondary_keys],
    ].forEach(function (group) {
      var map = group[0];
      if (!map || typeof map !== 'object' || Array.isArray(map)) return;
      Object.keys(map).forEach(function (original) {
        wbKeyList(map[original]).forEach(function (localized) {
          add(original, localized);
        });
      });
    });
    return pairs.length >= limit;
  });
  return pairs.join('\n');
}

function resolveWorldBook(recentText, charId, session, options) {
  function wbTailByTokenLimit(value, limit) {
    var source = String(value || ''),
      budget = Math.max(0, Number(limit) || 0);
    if (!budget) return '';
    if (estTokens(source) <= budget) return source;
    var low = 0,
      high = source.length;
    while (low < high) {
      var middle = Math.floor((low + high) / 2);
      if (estTokens(source.slice(middle)) > budget) low = middle + 1;
      else high = middle;
    }
    return source.slice(low);
  }
  function wbMessageDepthForTokenDepth(messages, depth) {
    var target = Math.max(0, Number(depth) || 0);
    if (!target) return 0;
    var used = 0,
      count = 0;
    for (var index = (messages || []).length - 1; index >= 0; index--) {
      used += estTokens(messages[index]);
      count++;
      if (used >= target) break;
    }
    return count;
  }
  options = options || {};
  const wb = D.worldBook,
    rawEntries = getAllWBEntries(charId),
    forcedPromptEntries =
      typeof promptTemplateForcedWorldInfoEntries === 'function'
        ? promptTemplateForcedWorldInfoEntries(options.promptTemplateRun)
        : [],
    commitRuntime = options.commitRuntime === true,
    vectorHitKeys =
      options.vectorHitKeys && typeof options.vectorHitKeys.has === 'function' ? options.vectorHitKeys : new Set(),
    entryRuntimeKey = wbEntryRuntimeKey,
    runtimeDetail = function (entry, status, extra) {
      return Object.assign(
        {
          id: entry.id,
          runtimeKey: entryRuntimeKey(entry),
          categoryId: String(entry._catId || ''),
          name: entry.name || entry.comment || entry.id,
          status: status,
        },
        extra || {}
      );
    };
  if (!rawEntries.length && !forcedPromptEntries.length)
    return {
      beforeChar: '',
      afterChar: '',
      stableBeforeChar: '',
      stableAfterChar: '',
      beforeCharItems: [],
      afterCharItems: [],
      inChat: new Map(),
      beforeUser: '',
      beforeUserItems: [],
      anTopItems: [],
      anBottomItems: [],
      emTopItems: [],
      emBottomItems: [],
      outletItems: [],
      disabledUiPrompts: [],
      count: 0,
      matchedCount: 0,
      activatedCount: 0,
      droppedCount: 0,
      injectedTokens: 0,
      maxContextReached: false,
      details: [],
    };
  const rawScanMessages = Array.isArray(recentText) ? recentText : null,
    scanMessages = rawScanMessages
      ? rawScanMessages.map(function (x) {
          return typeof x === 'string' ? x : String((x && x.text) || '');
        })
      : null,
    scanText = scanMessages ? scanMessages.join('\n') : recentText || '',
    sessionMessages = session && Array.isArray(session.msgs) ? session.msgs : rawScanMessages || [],
    currentTurn = sessionMessages.filter(function (x) {
      return x && x.role === 'user';
    }).length,
    assistantTurn = sessionMessages.filter(function (x) {
      return x && x.role === 'assistant';
    }).length,
    totalMessageCount = sessionMessages.filter(function (x) {
      return x && ['user', 'assistant'].includes(x.role);
    }).length,
    openingMessage = sessionMessages.find(function (x) {
      return x && x.opening === true && Number.isInteger(Number(x.openingIndex));
    }),
    activeGreetingIndex = openingMessage
      ? greetingCardIndex(
          (D.characters || []).find(function (row) {
            return row && String(row.id) === String(charId);
          }),
          Number(openingMessage.openingIndex)
        )
      : null,
    sourceRuntime =
      session && session.worldBookRuntime
        ? session.worldBookRuntime
        : commitRuntime && session
          ? (session.worldBookRuntime = {})
          : null,
    runtime = sourceRuntime ? (commitRuntime ? sourceRuntime : JSON.parse(JSON.stringify(sourceRuntime))) : null,
    details = [],
    regexGuard = { skipped: Object.create(null) };
  const recursiveScanText = function (value) {
    var text = String(value || '');
    return typeof stripCharacterComments === 'function'
      ? stripCharacterComments(text)
      : text.replace(/\{\{\/\/[\s\S]*?\}\}|\{\{comment\s*:[\s\S]*?\}\}/gi, '');
  };
  const scanSettings = worldBookSettings(),
    globalScanData = options.globalScanData && typeof options.globalScanData === 'object' ? options.globalScanData : {},
    generationType = wbGenerationTypeForMode(options.generationType),
    randomSource =
      typeof options.randomSource === 'function'
        ? options.randomSource
        : worldBookRoundRandom(
            session,
            [String((session && session.id) || charId), totalMessageCount, String(options.generationType || '')].join(
              '|'
            )
          );
  // Callers may pass either a message list or one pre-joined block of text.
  const scanBuffer = wbScanBuffer(scanMessages || (scanText ? [scanText] : []), globalScanData, scanSettings),
    messageCount = totalMessageCount;
  if (String(globalScanData.authorNote || '').trim()) scanBuffer.addInject(String(globalScanData.authorNote));
  (options.scanInjections || []).forEach(function (text) {
    if (String(text || '').trim()) scanBuffer.addInject(String(text));
  });
  const entryCaseSensitive = function (e) {
    return wbEntryCaseSensitive(e, scanSettings);
  };
  const entryWholeWords = function (e) {
    return wbEntryWholeWords(e, scanSettings);
  };
  const entryScanText = function (e, scanState) {
    var text = scanBuffer.get(e, scanState);
    return e.instructScanDepth != null ? wbTailByTokenLimit(text, e.instructScanDepth) : text;
  };
  const passesCharacterFilter = function (e) {
    return wbEntryPassesCharacterFilter(e, charId);
  };
  const matchesEntry = function (e, text) {
    if (!passesCharacterFilter(e)) return false;
    function matchKeys(keys, forceRegex) {
      var expanded = (keys || []).map(function (key) {
        return typeof options.renderScanText === 'function' ? options.renderScanText(key) : key;
      });
      return wbMatch(expanded, text, sensitive, whole, regexGuard, runtimeKey, forceRegex);
    }
    var aliasResolver = wbAliasResolver;
    var sensitive = entryCaseSensitive(e),
      whole = entryWholeWords(e),
      primaryKeys = e.keys || [],
      primaryAliases = e.keyAliases || [],
      primaryFor = aliasResolver(primaryKeys, e.keyAliasMap, primaryAliases),
      primaryMapped = primaryKeys.reduce(function (all, key) {
        return all.concat(primaryFor(key));
      }, []),
      primary = e.useRegex ? primaryKeys : primaryKeys.concat(primaryAliases, primaryMapped),
      secondary = e.secondary_keys || [],
      secondaryAliases = e.secondaryKeyAliases || [],
      secondaryFor = aliasResolver(secondary, e.secondaryKeyAliasMap, secondaryAliases),
      runtimeKey = entryRuntimeKey(e);
    if (!primary.length || !matchKeys(primary, e.useRegex)) return false;
    if (!e.useRegex && e.excludeKeys && e.excludeKeys.length && matchKeys(e.excludeKeys, false)) return false;
    if (
      (e.additionalKeyGroups || []).some(function (group) {
        return !matchKeys(group, e.useRegex);
      })
    )
      return false;
    if (e.useRegex || !e.selective || !secondary.length) return true;
    var results = secondary.map(function (k) {
      return matchKeys([k].concat(secondaryFor(k)), false);
    });
    return window.YeyuPure.worldBookSelectiveMatch(e.selectiveLogic, results);
  };
  const bookChar =
    (typeof D !== 'undefined' && D && Array.isArray(D.characters) ? D.characters : []).find(function (row) {
      return row && String(row.id) === String(charId);
    }) || null;
  const userIconNames = function (char) {
      var names = [],
        add = function (item) {
          var type = String((item && (item.type || item.assetType)) || '').toLowerCase(),
            name = String((item && item.name) || '').trim();
          if (type === 'user_icon' && name && names.indexOf(name) < 0) names.push(name);
        };
      ((char && char.assets) || []).forEach(add);
      ((char && char.media_assets) || []).forEach(add);
      return names;
    },
    availableUserIcons = userIconNames(bookChar),
    activeUserIcon = (function () {
      if (!availableUserIcons.length) return '';
      var selected = String((bookChar && bookChar.activeUserIcon) || '').trim();
      if (selected && availableUserIcons.indexOf(selected) >= 0) return selected;
      var main = availableUserIcons.find(function (name) {
        return name.toLowerCase() === 'main';
      });
      return main || availableUserIcons[0];
    })();
  const passesDecoratorGates = function (e, state) {
    if (e.activateOnlyAfter != null && assistantTurn < e.activateOnlyAfter) return false;
    if (e.activateOnlyEvery != null && assistantTurn % e.activateOnlyEvery !== 0) return false;
    if (e.greetingIndex != null && activeGreetingIndex != null && activeGreetingIndex !== e.greetingIndex) return false;
    if (e.userIconDecorator && availableUserIcons.length && activeUserIcon !== e.userIconDecorator) return false;
    if (e.ignoreOnMaxContext && options.maxContextReached === true) return false;
    if (e.dontActivateAfterMatch && state && state.matched === true) return false;
    return true;
  };
  const sections =
      options.characterSections && typeof options.characterSections === 'object' ? options.characterSections : null,
    positionSupported = function (position) {
      return !((position === 'personality' || position === 'scenario') && sections && sections[position] !== true);
    },
    runtimeFallbackEntry = function (entry, row) {
      var name = String((row && row.name) || ''),
        value = String((row && row.value) || ''),
        number = Number(value),
        next = Object.assign({}, entry);
      if (name === 'position') {
        var position = value.toLowerCase();
        if (
          !['before_desc', 'after_desc', 'personality', 'scenario'].includes(position) ||
          !positionSupported(position)
        )
          return null;
        next.position = 'character_card';
        next.characterPosition = position;
        return next;
      }
      if (['depth', 'instruct_depth', 'reverse_depth', 'reverse_instruct_depth'].includes(name)) {
        if (!Number.isInteger(number) || number < 0) return null;
        next.position = 'at_depth';
        if (name === 'depth') next.decoratorDepth = number;
        else if (name === 'instruct_depth') next.instructDepth = number;
        else if (name === 'reverse_depth') next.reverseDepth = number;
        else next.reverseInstructDepth = number;
        return next;
      }
      if (name === 'role') {
        var role = value.toLowerCase();
        if (!['system', 'user', 'assistant'].includes(role)) return null;
        next.role = role;
        return next;
      }
      if (name === 'scan_depth' && Number.isInteger(number) && number >= 0) {
        next.scanDepth = number;
        return next;
      }
      if (name === 'instruct_scan_depth' && Number.isInteger(number) && number >= 0) {
        next.instructScanDepth = number;
        return next;
      }
      if (name === 'activate_only_after' && Number.isInteger(number) && number >= 0) {
        next.activateOnlyAfter = number;
        return next;
      }
      if (name === 'activate_only_every' && Number.isInteger(number) && number >= 1) {
        next.activateOnlyEvery = number;
        return next;
      }
      if (name === 'keep_activate_after_match' && !value) {
        next.keepActivateAfterMatch = true;
        return next;
      }
      if (name === 'dont_activate_after_match' && !value) {
        next.dontActivateAfterMatch = true;
        return next;
      }
      if (name === 'additional_keys') {
        var additional = wbKeyList(value);
        if (!additional.length) return null;
        next.additionalKeyGroups = (next.additionalKeyGroups || []).concat([additional]);
        return next;
      }
      if (name === 'exclude_keys') {
        var excluded = wbKeyList(value);
        if (!excluded.length) return null;
        next.excludeKeys = excluded;
        return next;
      }
      if (name === 'ignore_on_max_context' && !value) {
        next.ignoreOnMaxContext = true;
        return next;
      }
      if (name === 'is_greeting' && Number.isInteger(number) && number >= 0) {
        next.greetingIndex = number;
        return next;
      }
      if (name === 'activate' && !value) {
        next.forceActivate = true;
        return next;
      }
      if (name === 'dont_activate' && !value) {
        next.dontActivate = true;
        return next;
      }
      return null;
    },
    runtimeFallback = function (entry, rows) {
      for (var index = 0; index < rows.length; index++) {
        var row = rows[index],
          resolved = runtimeFallbackEntry(entry, row);
        if (resolved && !(row.name === 'is_greeting' && activeGreetingIndex == null)) return resolved;
      }
      return entry;
    },
    environmentEntry = function (entry) {
      var next = entry,
        primary = String((next && next.characterPosition) || '');
      if (primary && !positionSupported(primary)) {
        var positionFallbacks = Array.isArray(next.characterPositionFallbacks) ? next.characterPositionFallbacks : [],
          positionBase = Object.assign({}, next, {
            position: wbPosition(next.sourcePosition),
            characterPosition: '',
            characterPositionFallbacks: [],
          });
        next = runtimeFallback(positionBase, positionFallbacks);
      }
      if (next.greetingIndex != null && activeGreetingIndex == null) {
        var greetingFallbacks = Array.isArray(next.greetingFallbacks) ? next.greetingFallbacks : [],
          greetingBase = Object.assign({}, next, { greetingIndex: null, greetingFallbacks: [] });
        next = runtimeFallback(greetingBase, greetingFallbacks);
      }
      if (typeof promptTemplateWorldInfoRuntimeEntry === 'function')
        next = promptTemplateWorldInfoRuntimeEntry(next, options.promptTemplateRun);
      if (next && entry.__wbHash != null) next = Object.assign({}, next, { __wbHash: entry.__wbHash });
      return next;
    },
    candidateKeys = new Set(),
    candidateEntries = rawEntries.concat(forcedPromptEntries).filter(function (entry) {
      var key = entryRuntimeKey(entry);
      if (candidateKeys.has(key)) return false;
      candidateKeys.add(key);
      return true;
    }),
    allEntries = candidateEntries.map(environmentEntry).filter(Boolean),
    resolvedEntryPosition = function (e) {
      return e.characterPosition
        ? { position: 'character_card', characterPosition: e.characterPosition }
        : { position: e.position, characterPosition: '' };
    };
  const scanContentByKey = new Map(),
    entryScanContent = function (entry) {
      var key = entryRuntimeKey(entry);
      if (!scanContentByKey.has(key))
        scanContentByKey.set(
          key,
          typeof options.renderScanText === 'function'
            ? String(options.renderScanText(entry.content) || '')
            : String(entry.content || '')
        );
      return scanContentByKey.get(key);
    },
    renderedContentByKey = new Map(),
    entryContent = function (entry) {
      var key = entryRuntimeKey(entry);
      if (renderedContentByKey.has(key)) return renderedContentByKey.get(key);
      var content =
        typeof options.renderContent === 'function'
          ? String(options.renderContent(entryScanContent(entry), entry) || '')
          : entryScanContent(entry);
      renderedContentByKey.set(key, content);
      return content;
    };
  const entryDepth = function (e) {
    if (e.decoratorDepth != null) return Math.max(0, Number(e.decoratorDepth) || 0);
    if (e.instructDepth != null) return wbMessageDepthForTokenDepth(scanMessages || [], e.instructDepth);
    if (e.reverseDepth != null) return Math.max(0, totalMessageCount - e.reverseDepth);
    if (e.reverseInstructDepth != null) {
      var totalTokens = (scanMessages || []).reduce(function (sum, text) {
        return sum + estTokens(text);
      }, 0);
      return wbMessageDepthForTokenDepth(scanMessages || [], Math.max(0, totalTokens - e.reverseInstructDepth));
    }
    return wbDepth(e.depth);
  };
  // ---- Official activation engine (SillyTavern 1.19.0 checkWorldInfo) ----------------
  var matchedKeys = new Set(),
    budgetDroppedCount = 0,
    newlyActivated = new Set();
  var timedStore = runtime
    ? (function () {
        ['sticky', 'cooldown', 'matched'].forEach(function (type) {
          if (!runtime[type] || typeof runtime[type] !== 'object' || Array.isArray(runtime[type])) runtime[type] = {};
        });
        return runtime;
      })()
    : null;
  var timedBuffer = { sticky: [], cooldown: [], delay: [] },
    entryByHash = new Map();
  var commitMatchedState = function (e) {
    var runtimeKey = entryRuntimeKey(e);
    if (!commitRuntime || !timedStore || !newlyActivated.has(runtimeKey)) return;
    var row = timedStore.matched[runtimeKey] || (timedStore.matched[runtimeKey] = {});
    row.matched = true;
    row.at = messageCount;
  };
  var sortByOrder = function (a, b) {
    return wbNumber(b.order, 100) - wbNumber(a.order, 100);
  };
  var loreOf = function (scope) {
      return allEntries
        .filter(function (e) {
          return (e._catScope || 'global') === scope;
        })
        .sort(sortByOrder);
    },
    characterLore = loreOf('character'),
    globalLore = loreOf('global'),
    sortedEntries;
  if (scanSettings.insertionStrategy === 'evenly') sortedEntries = globalLore.concat(characterLore).sort(sortByOrder);
  else if (scanSettings.insertionStrategy === 'global_first') sortedEntries = globalLore.concat(characterLore);
  else sortedEntries = characterLore.concat(globalLore);
  // SillyTavern getSortedEntries: chat lore always goes first, then persona lore, then the rest.
  sortedEntries = loreOf('chat').concat(loreOf('persona'), sortedEntries);
  var entryIndex = new Map();
  sortedEntries.forEach(function (e, index) {
    if (e.__wbHash == null && wbEntryHasTimedEffect(e)) e.__wbHash = wbEntryHash(e);
    if (e.__wbHash != null) entryByHash.set(String(e.__wbHash), e);
    entryIndex.set(e, index);
  });
  var timedValue = function (type, e, isProtected) {
    return {
      hash: e.__wbHash,
      start: messageCount,
      end: messageCount + Math.max(0, wbNumber(e[type], 0)),
      protected: !!isProtected,
    };
  };
  var onStickyEnded = function (e) {
    if (!timedStore || !Math.max(0, wbNumber(e.cooldown, 0))) return;
    timedStore.cooldown[entryRuntimeKey(e)] = timedValue('cooldown', e, true);
    timedBuffer.cooldown.push(e);
  };
  var checkTimedType = function (type, onEnded) {
    if (!timedStore) return;
    Object.keys(timedStore[type]).forEach(function (key) {
      var value = timedStore[type][key];
      if (!value || typeof value !== 'object') {
        delete timedStore[type][key];
        return;
      }
      var entry = entryByHash.get(String(value.hash));
      if (messageCount <= Number(value.start) && !value.protected) {
        delete timedStore[type][key];
        return;
      }
      if (!entry) {
        if (messageCount >= Number(value.end)) delete timedStore[type][key];
        return;
      }
      if (!Math.max(0, wbNumber(entry[type], 0))) {
        delete timedStore[type][key];
        return;
      }
      if (messageCount >= Number(value.end)) {
        delete timedStore[type][key];
        if (onEnded) onEnded(entry);
        return;
      }
      timedBuffer[type].push(entry);
    });
  };
  var isEffectActive = function (type, e) {
    return timedBuffer[type].some(function (row) {
      return row.__wbHash === e.__wbHash;
    });
  };
  checkTimedType('sticky', onStickyEnded);
  checkTimedType('cooldown', null);
  sortedEntries.forEach(function (e) {
    if (Math.max(0, wbNumber(e.delay, 0)) > 0 && messageCount < Math.max(0, wbNumber(e.delay, 0)))
      timedBuffer.delay.push(e);
  });
  var recursionEnabled =
    scanSettings.recursive ||
    sortedEntries.some(function (e) {
      return e._catSettings && e._catSettings.recursive === true;
    });
  // budget 为 0 表示本次不限世界书用量：比例要求上下文上限已设定，比例为 0 时同样不限。
  var contextTokens = Math.max(0, Number(options.maxContext) || 0),
    budget =
      contextTokens > 0 && scanSettings.budgetPercent > 0
        ? Math.round((scanSettings.budgetPercent * contextTokens) / 100) || 1
        : 0;
  if (scanSettings.budgetCap > 0 && (budget === 0 || budget > scanSettings.budgetCap)) budget = scanSettings.budgetCap;
  var delayLevels = Array.from(
      new Set(
        sortedEntries
          .filter(function (e) {
            return e.delayUntilRecursion;
          })
          .map(function (e) {
            return e.delayUntilRecursion === true ? 1 : Math.max(0, wbNumber(e.delayUntilRecursion, 0));
          })
      )
    ).sort(function (a, b) {
      return a - b;
    }),
    currentDelayLevel = delayLevels.shift() || 0;
  var wbEntryScore = function (e, text) {
    var sensitive = entryCaseSensitive(e),
      whole = entryWholeWords(e),
      primary = e.keys || [],
      secondary = e.secondary_keys || [],
      runtimeKey = entryRuntimeKey(e),
      primaryScore = 0,
      secondaryScore = 0;
    if (!primary.length) return 0;
    primary.forEach(function (k) {
      if (wbMatch([k], text, sensitive, whole, regexGuard, runtimeKey, e.useRegex)) primaryScore++;
    });
    if (!secondary.length) return primaryScore;
    secondary.forEach(function (k) {
      if (wbMatch([k], text, sensitive, whole, regexGuard, runtimeKey, false)) secondaryScore++;
    });
    var logic = wbNumber(e.selectiveLogic, 0);
    if (logic === 0) return primaryScore + secondaryScore;
    if (logic === 3) return secondaryScore === secondary.length ? primaryScore + secondaryScore : primaryScore;
    return primaryScore;
  };
  var scanState = 1,
    loopCount = 0,
    budgetOverflowed = false,
    activatedMap = new Map(),
    failedProbability = new Set(),
    activatedText = '';
  var filterInclusionGroups = function (newEntries) {
    var grouped = {};
    newEntries
      .filter(function (e) {
        return e.group;
      })
      .forEach(function (e) {
        wbEntryGroupNames(e).forEach(function (name) {
          (grouped[name] || (grouped[name] = [])).push(e);
        });
      });
    var names = Object.keys(grouped);
    if (!names.length) return;
    var removeEntry = function (e) {
        var at = newEntries.indexOf(e);
        if (at >= 0) newEntries.splice(at, 1);
        details.push(runtimeDetail(e, 'group-dropped'));
      },
      hasSticky = {};
    names.forEach(function (name) {
      var group = grouped[name],
        stickyRows = group.filter(function (e) {
          return isEffectActive('sticky', e);
        });
      hasSticky[name] = stickyRows.length > 0;
      if (stickyRows.length)
        group.slice().forEach(function (e) {
          if (stickyRows.indexOf(e) < 0) removeEntry(e);
        });
      group.slice().forEach(function (e) {
        if (isEffectActive('cooldown', e) || isEffectActive('delay', e)) removeEntry(e);
      });
    });
    names.forEach(function (name) {
      var group = grouped[name];
      if (hasSticky[name]) return;
      if (
        !scanSettings.useGroupScoring &&
        !group.some(function (e) {
          return e.useGroupScoring === true;
        })
      )
        return;
      var scores = group.map(function (e) {
          return wbEntryScore(e, entryScanText(e, scanState));
        }),
        maxScore = Math.max.apply(null, scores);
      for (var index = 0; index < group.length; index++) {
        var scored =
          group[index].useGroupScoring == null ? scanSettings.useGroupScoring : group[index].useGroupScoring === true;
        if (!scored) continue;
        if (scores[index] < maxScore) {
          removeEntry(group[index]);
          group.splice(index, 1);
          scores.splice(index, 1);
          index--;
        }
      }
    });
    names.forEach(function (name) {
      var group = grouped[name];
      if (hasSticky[name]) return;
      if (
        Array.from(activatedMap.values()).some(function (e) {
          return wbEntryGroupNames(e).includes(name);
        })
      ) {
        group.slice().forEach(removeEntry);
        return;
      }
      if (group.length <= 1) return;
      var prios = group
        .filter(function (e) {
          return e.groupOverride;
        })
        .sort(sortByOrder);
      if (prios.length) {
        group.slice().forEach(function (e) {
          if (e !== prios[0]) removeEntry(e);
        });
        return;
      }
      var total = group.reduce(function (sum, e) {
          return sum + Math.max(1, wbNumber(e.groupWeight, 100));
        }, 0),
        roll = randomSource() * total,
        acc = 0,
        winner = null;
      for (var index = 0; index < group.length; index++) {
        acc += Math.max(1, wbNumber(group[index].groupWeight, 100));
        if (roll <= acc) {
          winner = group[index];
          break;
        }
      }
      if (!winner) return;
      group.slice().forEach(function (e) {
        if (e !== winner) removeEntry(e);
      });
    });
  };
  while (scanState) {
    if (scanSettings.maxRecursionSteps && scanSettings.maxRecursionSteps <= loopCount) break;
    loopCount++;
    var nextScanState = 0,
      activatedNow = [];
    for (var scanIndex = 0; scanIndex < sortedEntries.length; scanIndex++) {
      var entry = sortedEntries[scanIndex],
        runtimeKey = entryRuntimeKey(entry);
      if (failedProbability.has(entry) || activatedMap.has(runtimeKey)) continue;
      if (!entry.enabled) continue;
      if (entry.triggers.length && entry.triggers.indexOf(generationType) < 0) {
        details.push(runtimeDetail(entry, 'trigger-filtered', { trigger: generationType }));
        continue;
      }
      if (!passesCharacterFilter(entry)) continue;
      var matchedState = timedStore ? timedStore.matched[runtimeKey] : null,
        held = entry.keepActivateAfterMatch && matchedState && matchedState.matched === true;
      var isSticky = isEffectActive('sticky', entry),
        isCooldown = isEffectActive('cooldown', entry),
        isDelay = isEffectActive('delay', entry);
      if (isDelay) {
        details.push(runtimeDetail(entry, 'delayed'));
        continue;
      }
      if (isCooldown && !isSticky) {
        details.push(runtimeDetail(entry, 'cooldown'));
        continue;
      }
      if (entry.dontActivateAfterMatch && matchedState && matchedState.matched === true) continue;
      if (!held && !passesDecoratorGates(entry, matchedState)) continue;
      if (scanState !== 2 && entry.delayUntilRecursion && !isSticky && !held) continue;
      if (
        scanState === 2 &&
        entry.delayUntilRecursion &&
        (entry.delayUntilRecursion === true ? 1 : Math.max(0, wbNumber(entry.delayUntilRecursion, 0))) >
          currentDelayLevel &&
        !isSticky
      )
        continue;
      if (scanState === 2 && recursionEnabled && entry.excludeRecursion && !isSticky) continue;
      if (scanState === 2 && entry._catSettings && entry._catSettings.recursive === false) continue;
      if (entry.forceActivate) {
        entry.__wbReason = 'forced';
        activatedNow.push(entry);
        matchedKeys.add(runtimeKey);
        continue;
      }
      if (entry.dontActivate) continue;
      if (entry.vectorized === true && vectorHitKeys.has(runtimeKey)) {
        entry.__wbReason = 'vector';
        activatedNow.push(entry);
        matchedKeys.add(runtimeKey);
        continue;
      }
      if (entry.constant) {
        entry.__wbReason = 'constant';
        activatedNow.push(entry);
        matchedKeys.add(runtimeKey);
        continue;
      }
      if (isSticky || held) {
        entry.__wbReason = isSticky ? 'sticky' : 'held';
        activatedNow.push(entry);
        matchedKeys.add(runtimeKey);
        continue;
      }
      if (!(entry.keys || []).length) continue;
      if (!matchesEntry(entry, entryScanText(entry, scanState))) {
        var skipped = regexGuard.skipped[runtimeKey];
        if (skipped) details.push(runtimeDetail(entry, 'regex-skipped', { reason: skipped }));
        continue;
      }
      entry.__wbReason = scanState === 2 ? 'recursive' : 'keyword';
      activatedNow.push(entry);
      matchedKeys.add(runtimeKey);
    }
    var newEntries = activatedNow.slice().sort(function (a, b) {
      var stickyA = isEffectActive('sticky', a) ? 1 : 0,
        stickyB = isEffectActive('sticky', b) ? 1 : 0;
      return stickyB - stickyA || entryIndex.get(a) - entryIndex.get(b);
    });
    filterInclusionGroups(newEntries);
    var baseTokens = estTokens(activatedText),
      newContent = '',
      ignoresBudget = newEntries.filter(function (e) {
        return e.ignoreBudget;
      }).length;
    for (var newIndex = 0; newIndex < newEntries.length; newIndex++) {
      var candidate = newEntries[newIndex];
      if (candidate.ignoreBudget) ignoresBudget--;
      if (budgetOverflowed && !candidate.ignoreBudget) {
        if (ignoresBudget > 0) continue;
        break;
      }
      var candidateSticky = isEffectActive('sticky', candidate),
        roll = null;
      if (
        candidate.useProbability &&
        wbNumber(candidate.probability, 100) < 100 &&
        !candidateSticky &&
        candidate.__wbReason !== 'held'
      ) {
        roll = randomSource() * 100;
        if (roll > wbNumber(candidate.probability, 100)) {
          failedProbability.add(candidate);
          details.push(runtimeDetail(candidate, 'probability', { roll: roll }));
          continue;
        }
      }
      newContent += entryContent(candidate) + '\n';
      if (!candidate.ignoreBudget && budget > 0 && baseTokens + estTokens(newContent) >= budget) {
        budgetOverflowed = true;
        budgetDroppedCount++;
        details.push(runtimeDetail(candidate, 'budget-dropped'));
        continue;
      }
      activatedMap.set(entryRuntimeKey(candidate), candidate);
      newlyActivated.add(entryRuntimeKey(candidate));
      details.push(runtimeDetail(candidate, wbActivationStatus(candidate), { roll: roll, loop: loopCount }));
    }
    var successful = newEntries.filter(function (e) {
        return !failedProbability.has(e);
      }),
      forRecursion = successful.filter(function (e) {
        return !e.preventRecursion && !(e._catSettings && e._catSettings.recursive === false);
      });
    if (recursionEnabled && !budgetOverflowed && forRecursion.length) nextScanState = 2;
    if (recursionEnabled && !budgetOverflowed && scanState === 3 && scanBuffer.hasRecurse()) nextScanState = 2;
    if (
      !nextScanState &&
      !budgetOverflowed &&
      scanSettings.minActivations > 0 &&
      activatedMap.size < scanSettings.minActivations
    ) {
      var overMax =
        (scanSettings.minActivationsDepthMax > 0 && scanBuffer.getDepth() > scanSettings.minActivationsDepthMax) ||
        scanBuffer.getDepth() > scanBuffer.messageCount;
      if (!overMax) {
        nextScanState = 3;
        scanBuffer.advanceScan();
      }
    }
    if (!nextScanState && delayLevels.length) {
      nextScanState = 2;
      currentDelayLevel = delayLevels.shift();
    }
    scanState = nextScanState;
    if (scanState) {
      var recursionText = forRecursion
        .map(function (e) {
          return recursiveScanText(entryScanContent(e));
        })
        .join('\n');
      if (recursionText) {
        scanBuffer.addRecurse(recursionText);
        activatedText = recursionText + '\n' + activatedText;
      }
    }
  }
  if (timedStore)
    Array.from(activatedMap.values()).forEach(function (e) {
      ['sticky', 'cooldown'].forEach(function (type) {
        if (!Math.max(0, wbNumber(e[type], 0))) return;
        var key = entryRuntimeKey(e);
        if (!timedStore[type][key]) timedStore[type][key] = timedValue(type, e, false);
      });
    });
  var selected = Array.from(activatedMap.values()).slice().sort(sortByOrder);
  var matchedSelected = selected.slice(),
    emptySelected = [];
  selected = selected.filter(function (e) {
    if (String(entryContent(e)).trim()) return true;
    emptySelected.push(e);
    details.push(runtimeDetail(e, 'empty-content'));
    return false;
  });
  var maxThreshold = Math.max(0, Number(options.maxContextThreshold) || 0),
    baseContextTokens = Math.max(0, Number(options.contextBaseTokens) || 0),
    selectedTokens = selected.reduce(function (total, e) {
      return total + estTokens(entryContent(e));
    }, 0),
    maxContextReached =
      options.maxContextReached === true || (maxThreshold > 0 && baseContextTokens + selectedTokens >= maxThreshold),
    disabledUiPrompts = Array.from(
      new Set(
        matchedSelected
          .filter(function (e) {
            return !(maxContextReached && e.ignoreOnMaxContext);
          })
          .map(function (e) {
            return e.disableUiPrompt;
          })
          .filter(Boolean)
      )
    );
  emptySelected.forEach(function (e) {
    if (!(maxContextReached && e.ignoreOnMaxContext)) commitMatchedState(e);
  });
  let tok = 0;
  const injected = [],
    catTokens = {};
  var droppedCount = 0;
  for (const e of selected) {
    const content = entryContent(e),
      entryTokens = estTokens(content),
      hasCatBudget = e._catSettings && e._catSettings.token_budget != null,
      catBudget = hasCatBudget ? Number(e._catSettings.token_budget) || 0 : 0,
      catKey = e._catId || '__global__',
      usedCat = catTokens[catKey] || 0;
    if (maxContextReached && e.ignoreOnMaxContext) {
      droppedCount++;
      details.push(runtimeDetail(e, 'max-context-dropped'));
      continue;
    }
    if (!e.ignoreBudget && catBudget > 0 && usedCat + entryTokens > catBudget) {
      droppedCount++;
      details.push(runtimeDetail(e, 'budget-dropped', { tokens: entryTokens }));
      continue;
    }
    catTokens[catKey] = usedCat + entryTokens;
    tok += entryTokens;
    injected.push(e);
  }
  // Entries arrive sorted by descending order and are unshifted into their slot, so the
  // final prompt reads in ascending order — the same arrangement SillyTavern builds.
  const beforeChar = [],
    afterChar = [],
    stableBeforeChar = [],
    stableAfterChar = [],
    beforeCharItems = [],
    afterCharItems = [],
    inChat = new Map(),
    beforeUser = [],
    beforeUserItems = [],
    anTopItems = [],
    anBottomItems = [],
    emTopItems = [],
    emBottomItems = [],
    outletItems = [];
  injected.forEach(function (e, sequence) {
    var stable =
        (e.constant || e.forceActivate) &&
        e.probability >= 100 &&
        !e.group &&
        e.delay === 0 &&
        e.sticky === 0 &&
        e.cooldown === 0,
      runtimeKey = entryRuntimeKey(e),
      resolvedPosition = resolvedEntryPosition(e),
      content = entryContent(e),
      item = {
        content: content,
        entryId: String(e.id || ''),
        entryKey: runtimeKey,
        groupKey: wbEntryGroupNames(e)[0] || '',
        groupKeys: wbEntryGroupNames(e),
        groupOverride: e.groupOverride === true,
        order: wbNumber(e.order, 100),
        sequence: sequence,
        stable: stable,
        characterPosition: resolvedPosition.characterPosition,
        ignoreOnMaxContext: e.ignoreOnMaxContext === true,
      };
    commitMatchedState(e);
    switch (resolvedPosition.position) {
      case 'before_char':
        beforeCharItems.unshift(item);
        (stable ? stableBeforeChar : beforeChar).unshift(content);
        break;
      case 'after_char':
        afterCharItems.unshift(item);
        (stable ? stableAfterChar : afterChar).unshift(content);
        break;
      case 'character_card':
        beforeCharItems.unshift(item);
        break;
      case 'em_top':
        emTopItems.unshift(item);
        break;
      case 'em_bottom':
        emBottomItems.unshift(item);
        break;
      case 'an_top':
        anTopItems.unshift(item);
        break;
      case 'an_bottom':
        anBottomItems.unshift(item);
        break;
      case 'at_depth':
        var depth = entryDepth(e);
        if (!inChat.has(depth)) inChat.set(depth, []);
        inChat.get(depth).unshift({
          content: content,
          role: e.role || 'system',
          entryId: String(e.id || ''),
          entryKey: runtimeKey,
          groupKey: item.groupKey,
          groupKeys: item.groupKeys.slice(),
          groupOverride: item.groupOverride,
          order: item.order,
          sequence: sequence,
          stable: stable,
          ignoreOnMaxContext: item.ignoreOnMaxContext,
        });
        break;
      // Same-name outlets keep official arrival order, so they are pushed while every other
      // slot unshifts.
      case 'outlet':
        if (!e.outletName) {
          droppedCount++;
          details.push(runtimeDetail(e, 'outlet-unnamed'));
          break;
        }
        outletItems.push(Object.assign({}, item, { outletName: e.outletName }));
        break;
      case 'before_user':
        beforeUserItems.unshift(item);
        beforeUser.unshift(content);
        break;
      default:
        afterCharItems.unshift(item);
        afterChar.unshift(content);
    }
  });
  // Slots were filled by unshift, so the stored sequence has to be renumbered to the final
  // official order; downstream consumers order depth rows by sequence.
  var renumberSlot = function (items) {
    (items || []).forEach(function (item, index) {
      item.sequence = index;
    });
  };
  [
    beforeCharItems,
    afterCharItems,
    beforeUserItems,
    anTopItems,
    anBottomItems,
    emTopItems,
    emBottomItems,
    outletItems,
  ].forEach(renumberSlot);
  inChat.forEach(renumberSlot);
  // Runtime state is now grouped per effect type, so pruning walks each group instead of the
  // top level; anything that is not one of the known groups is stale and dropped outright.
  if (commitRuntime && sourceRuntime) {
    var validIds = new Set(allEntries.map(entryRuntimeKey)),
      groups = ['sticky', 'cooldown', 'matched'];
    Object.keys(sourceRuntime).forEach(function (name) {
      if (groups.indexOf(name) < 0) {
        delete sourceRuntime[name];
        return;
      }
      var bucket = sourceRuntime[name];
      if (!bucket || typeof bucket !== 'object') {
        delete sourceRuntime[name];
        return;
      }
      Object.keys(bucket).forEach(function (id) {
        if (!validIds.has(String(id))) delete bucket[id];
      });
    });
  }
  if (commitRuntime && injected.length && typeof qrQueueWorldInfo === 'function') qrQueueWorldInfo(injected);
  if (
    commitRuntime &&
    D.worldBook.overflow_alert === true &&
    details.some(function (row) {
      return row.status === 'budget-dropped';
    })
  )
    toast('世界书已超出预算，部分条目未加入本次提示词', 'info');
  return {
    beforeChar: beforeChar.join('\n'),
    afterChar: afterChar.join('\n'),
    stableBeforeChar: stableBeforeChar.join('\n'),
    stableAfterChar: stableAfterChar.join('\n'),
    beforeCharItems: beforeCharItems,
    afterCharItems: afterCharItems,
    inChat: inChat,
    beforeUser: beforeUser.join('\n'),
    beforeUserItems: beforeUserItems,
    anTopItems: anTopItems,
    anBottomItems: anBottomItems,
    emTopItems: emTopItems,
    emBottomItems: emBottomItems,
    outletItems: outletItems,
    disabledUiPrompts: disabledUiPrompts,
    count: injected.length,
    matchedCount: matchedKeys.size,
    activatedCount: selected.length + budgetDroppedCount,
    droppedCount: droppedCount + budgetDroppedCount,
    injectedTokens: tok,
    maxContextReached: maxContextReached,
    budget: budget,
    budgetCap: scanSettings.budgetCap,
    statusCounts: details.reduce(function (all, row) {
      var status = String((row && row.status) || '');
      all[status] = (all[status] || 0) + 1;
      return all;
    }, {}),
    details: details.slice(0, 200),
  };
}
