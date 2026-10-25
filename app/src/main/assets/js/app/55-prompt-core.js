// ===== Fixed prompt and character card layers =====
var CHARACTER_MACRO_MAX_INPUT = 1000000,
  CHARACTER_MACRO_MAX_DEPTH = 32,
  CHARACTER_MACRO_MAX_BLOCKS = 4096;
function createCharacterMacroState(random, vars) {
  return {
    random: typeof random === 'function' ? random : Math.random,
    picks: new Map(),
    vars: vars && typeof vars === 'object' && !Array.isArray(vars) ? vars : {},
    globalVars: {},
    messages: [],
    dirtySections: new Set(),
  };
}
function bindCharacterMacroSession(state, session, options) {
  options = options && typeof options === 'object' ? options : {};
  state =
    state && typeof state === 'object'
      ? state
      : typeof createCharacterMacroState === 'function'
        ? createCharacterMacroState()
        : { random: Math.random, picks: new Map(), vars: {} };
  if (!state.vars || typeof state.vars !== 'object' || Array.isArray(state.vars)) state.vars = {};
  if (!state.globalVars || typeof state.globalVars !== 'object' || Array.isArray(state.globalVars))
    state.globalVars = {};
  if (!state.dirtySections || typeof state.dirtySections.add !== 'function') state.dirtySections = new Set();
  var commit = options.commit !== false,
    local =
      session && session.macroVars && typeof session.macroVars === 'object' && !Array.isArray(session.macroVars)
        ? session.macroVars
        : state.vars,
    global =
      options.globalVars && typeof options.globalVars === 'object' && !Array.isArray(options.globalVars)
        ? options.globalVars
        : null;
  if (!global && typeof D !== 'undefined' && D && D.settings) {
    var stscript =
      D.settings.stscript && typeof D.settings.stscript === 'object' && !Array.isArray(D.settings.stscript)
        ? D.settings.stscript
        : null;
    if (commit && !stscript) {
      stscript = {};
      D.settings.stscript = stscript;
    }
    if (
      commit &&
      stscript &&
      (!stscript.globalVars || typeof stscript.globalVars !== 'object' || Array.isArray(stscript.globalVars))
    )
      stscript.globalVars = {};
    global =
      stscript && stscript.globalVars && typeof stscript.globalVars === 'object' && !Array.isArray(stscript.globalVars)
        ? stscript.globalVars
        : {};
  }
  state.vars = commit ? local : cloneData(local);
  state.globalVars = commit ? global || state.globalVars : cloneData(global || state.globalVars);
  state.commit = commit;
  if (session && typeof session === 'object') {
    state.runtimeSession = session;
    state.session = session;
  }
  return state;
}
function characterMacroStateForChar(char, random) {
  if (typeof isRisuCharacter === 'function' && isRisuCharacter(char))
    return createRisuMacroState(char, getActiveSession(char.id), { random: random });
  return bindCharacterMacroSession(
    createCharacterMacroState(random),
    char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    { commit: false }
  );
}
function characterMacroChoices(value) {
  var rows = [],
    current = '',
    escaped = false;
  String(value || '')
    .split('')
    .forEach(function (ch) {
      if (escaped) {
        current += ch;
        escaped = false;
      } else if (ch === '\\') escaped = true;
      else if (ch === ',') {
        rows.push(current.trim());
        current = '';
      } else current += ch;
    });
  if (escaped) current += '\\';
  rows.push(current.trim());
  return rows;
}
function characterHasCardSettings(char) {
  var stack = typeof cardScriptStack === 'function' ? cardScriptStack(char) : null;
  return !!(stack && stack.hasContent);
}
// An imported card always has a report, even an empty one. Characters that never kept a raw card
// still get the entry when their normalised extensions or script stack can be attributed.
function characterHasCardDependencyReport(char) {
  if (!char || typeof char !== 'object') return false;
  if (char.importMeta && char.importMeta.rawCard && typeof char.importMeta.rawCard === 'object') return true;
  if (typeof cardScriptStack === 'function') {
    var stack = cardScriptStack(char);
    if (stack && stack.hasContent) return true;
  }
  return typeof analyzeCardDependencies === 'function' && analyzeCardDependencies(char).items.length > 0;
}
function characterCanOpenCardSettings(char) {
  return (
    (typeof characterHasCardSettings === 'function' && characterHasCardSettings(char)) ||
    characterHasCardDependencyReport(char)
  );
}
function stripCharacterComments(value) {
  return String(value == null ? '' : value)
    .replace(/\{\{\/\/\}\}[\s\S]*?\{\{\/{3,}\}\}/g, '')
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}|\{\{comment\s*(?:::|:|\s+)[\s\S]*?\}\}/gi, '');
}
var CHARACTER_OFFICIAL_SUPPORTED_MACROS = (function () {
  var names =
      'hasextension char user bot random pick roll reverse comment setvar getvar getvarindex getvarkey setvarindex setvarkey getglobalvarindex getglobalvarkey setglobalvarindex setglobalvarkey lastexpression defaultexpression availableexpressions addvar incvar decvar hasvar varexists deletevar flushvar setglobalvar getglobalvar addglobalvar incglobalvar decglobalvar hasglobalvar globalvarexists deleteglobalvar flushglobalvar if else outlet space newline trim noop input useravatarpath charavatarpath charprompt charinstruction charjailbreak chardescription description charpersonality personality charscenario scenario persona mesexamples mesexamplesraw chardepthprompt charcreatornotes creatornotes charfirstmessage greeting charversion version char_version model original ismobile maxprompt maxprompttokens maxcontext maxcontexttokens maxresponse maxresponsetokens lastgenerationtype lastmessage lastmessageid lastusermessage lastcharmessage firstincludedmessageid firstdisplayedmessageid lastswipeid currentswipeid allchatrange time date weekday isotime isodate datetimeformat idleduration idle_duration time_utc timediff format_message_variable format_message_variable_quoted format_chat_variable format_chat_variable_quoted format_character_variable format_character_variable_quoted format_preset_variable format_preset_variable_quoted format_global_variable format_global_variable_quoted get_message_variable'.split(
        ' '
      ),
    out = {};
  names.forEach(function (name) {
    out[name] = 1;
  });
  return out;
})();
var CHARACTER_OFFICIAL_UNAVAILABLE_MACROS = (function () {
  var groups = { banned: 'text-gen 禁词表' },
    instruct =
      'instructstorystringprefix instructstorystringsuffix instructinput instructuserprefix instructusersuffix instructoutput instructassistantprefix instructseparator instructassistantsuffix instructsystemprefix instructsystemsuffix instructfirstoutput instructfirstoutputprefix instructfirstassistantprefix instructlastoutput instructlastoutputprefix instructlastassistantprefix instructstop instructuserfiller instructsysteminstructionprefix instructfirstinput instructfirstuserprefix instructlastinput instructlastuserprefix systemprompt defaultsystemprompt instructsystem instructsystemprompt exampleseparator chatseparator chatstart'.split(
        ' '
      );
  instruct.forEach(function (name) {
    groups[name] = 'instruct/文本补全预设';
  });
  return groups;
})();
function characterMacroOfficialStatus(name) {
  name = String(name || '')
    .replace(/^[#/:]+/, '')
    .toLowerCase();
  if (CHARACTER_OFFICIAL_SUPPORTED_MACROS[name]) return 'supported';
  if (CHARACTER_OFFICIAL_UNAVAILABLE_MACROS[name]) return 'unavailable';
  return 'custom';
}
function characterMacroUnavailableCounts(value) {
  return characterMacroClassifiedCounts(value).unavailable;
}
// Official status is always decided by the bare name, because {{reverse:...}}, {{setvar::a::b}} and
// {{outlet::x}} are official forms that carry parameters after the colon. Unrecognised macros are
// counted under the full written form instead: {{ERA:$ALLDATA}} and {{ERA:$STAT}} are different
// third-party markers, and reporting both as "era" hides what the card actually wrote.
function characterMacroClassifiedCounts(value) {
  var custom = {},
    unavailable = {},
    text = String(value || ''),
    re = /\{\{\s*(?:\/\/|([#/:]*[A-Za-z_][\w]*)((?:::?)[^{}]*)?|(\?))/g,
    match,
    name,
    raw,
    args,
    cond,
    status;
  while ((match = re.exec(text))) {
    if (match[0].indexOf('{{//') === 0 || match[0].indexOf('{{ //') === 0) continue;
    raw = String(match[1] || match[3] || '');
    args = String(match[2] || '').replace(/\s+$/, '');
    name = raw.replace(/^[#/:]+/, '').toLowerCase();
    if (!name || name === '?' || name === 'else') continue;
    if (name === 'if' && !/^[/:]/.test(raw)) {
      var ifToken = (text.slice(match.index).match(/^\{\{\s*#?if[\s\S]*?\}\}/i) || [])[0] || '';
      if (!/^\{\{\s*#?if(?:\s*::|\s+)\S[\s\S]*?\}\}$/i.test(ifToken)) {
        custom.if = (custom.if || 0) + 1;
        continue;
      }
    }
    status = characterMacroOfficialStatus(name);
    if (status === 'supported') continue;
    if (status === 'unavailable') unavailable[name] = (unavailable[name] || 0) + 1;
    else {
      var written = raw.replace(/^[#/:]+/, '') + args;
      custom[written] = (custom[written] || 0) + 1;
    }
  }
  return { custom: custom, unavailable: unavailable };
}
function characterMacroMarkDirty(state, section) {
  if (state && state.commit !== false && state.dirtySections && typeof state.dirtySections.add === 'function')
    state.dirtySections.add(section);
}
function characterMacroVariableAdd(store, name, value, state, section) {
  name = String(name || '').trim();
  if (!name) return '';
  var current = Object.prototype.hasOwnProperty.call(store, name) ? store[name] : 0,
    parsed;
  try {
    parsed = typeof current === 'string' ? JSON.parse(current) : current;
    if (Array.isArray(parsed)) {
      parsed.push(value);
      store[name] = JSON.stringify(parsed);
      characterMacroMarkDirty(state, section);
      return parsed;
    }
  } catch (_) {}
  var increment = Number(value),
    base = Number(current),
    next;
  if (!Number.isFinite(increment) || !Number.isFinite(base)) next = String(current || '') + String(value);
  else next = base + increment;
  store[name] = next;
  characterMacroMarkDirty(state, section);
  return next;
}
// One variable macro call. The body arrives with its nested macros already resolved, so a value
// such as {{setvar::a::{{getvar::b}}}} stores b's value instead of a fragment cut at the inner "}}".
function characterMacroVariable(kind, body, state) {
  var lower = String(kind).toLowerCase(),
    isGlobal = lower.indexOf('global') >= 0,
    store = isGlobal ? state.globalVars || {} : state.vars,
    section = isGlobal ? 'meta' : 'sessions',
    parts = String(body || '').split('::'),
    name = String(parts.shift() || '').trim(),
    value = parts.join('::').trim(),
    has = Object.prototype.hasOwnProperty.call(store, name),
    result;
  if (/^(?:get|set)(?:global)?var(?:index|key)$/.test(lower)) {
    var index = parts.shift() ?? '',
      setting = lower.startsWith('set');
    if (!setting) {
      result = store[name];
      try {
        result = JSON.parse(result);
        result = result[Number.isNaN(Number(index)) ? index : Number(index)];
        if (typeof result === 'object') result = JSON.stringify(result);
      } catch (_) {}
      return String(stscriptNumericVar(result));
    }
    if (state.suppressWrites) return '';
    if (!name) throw new Error('变量名不能为空');
    try {
      var parsed = JSON.parse(store[name] ?? 'null'),
        numeric = Number(index),
        key = Number.isNaN(numeric) ? index : numeric;
      if (parsed === null) parsed = Number.isNaN(numeric) ? {} : [];
      parsed[key] = stscriptConvertType(parts.join('::').trim());
      store[name] = JSON.stringify(parsed);
      characterMacroMarkDirty(state, section);
      if (!isGlobal && state.commit !== false && state.session) state.session.macroVars = store;
    } catch (_) {}
    return '';
  }
  if (state.suppressWrites && /^(?:set|add|inc|dec|delete|flush)(?:global)?var$/.test(lower))
    return /^(?:inc|dec)/.test(lower) && name && has ? String(store[name]) : '';
  if (lower === 'setvar' || lower === 'setglobalvar') {
    if (name) {
      store[name] = value;
      characterMacroMarkDirty(state, section);
      if (!isGlobal && state.commit !== false && state.session) state.session.macroVars = store;
    }
    return '';
  }
  if (lower === 'addvar' || lower === 'addglobalvar') {
    characterMacroVariableAdd(store, name, value, state, section);
    return '';
  }
  if (lower === 'incvar' || lower === 'incglobalvar') {
    result = characterMacroVariableAdd(store, name, 1, state, section);
    return String(result === '' ? '' : result);
  }
  if (lower === 'decvar' || lower === 'decglobalvar') {
    result = characterMacroVariableAdd(store, name, -1, state, section);
    return String(result === '' ? '' : result);
  }
  if (lower === 'hasvar' || lower === 'varexists' || lower === 'hasglobalvar' || lower === 'globalvarexists')
    return String(!!name && has);
  if (lower === 'deletevar' || lower === 'flushvar' || lower === 'deleteglobalvar' || lower === 'flushglobalvar') {
    if (name && has) {
      delete store[name];
      characterMacroMarkDirty(state, section);
    }
    return '';
  }
  return name && has ? String(store[name]) : '';
}
function markMessageMacroEffects(char, message, from) {
  if (!message) return;
  if (typeof isRisuCharacter === 'function' && isRisuCharacter(char)) {
    var raw = String(message.content || ''),
      prior = message.risu,
      offset = Math.max(0, Number(from) || 0);
    if (offset && prior && prior.source === raw.slice(0, offset)) {
      var risuPrefix = typeof prior.template === 'string' ? prior.template : prior.text;
      if (typeof risuPrefix === 'string') {
        var combined = risuPrefix + raw.slice(offset);
        message.risu = Object.assign({}, prior, { source: raw, text: combined, template: combined });
        offset = risuPrefix.length;
      }
    }
    message.pendingMacroEffects = { from: offset };
    return;
  }
  var text = String(message.content || ''),
    start = Math.max(0, Number(from) || 0),
    prefix = text.slice(0, start),
    opening = prefix.lastIndexOf('{{');
  if (opening > prefix.lastIndexOf('}}')) start = opening;
  if (!/\{\{\s*(?:set|add|inc|dec|delete|flush)(?:global)?var(?:\s|::)/i.test(text.slice(start))) return;
  if (message.pendingMacroEffects) start = Math.min(start, Number(message.pendingMacroEffects.from) || 0);
  message.pendingMacroEffects = { from: start };
}
function characterMacroDate(state) {
  var source = typeof state.now === 'function' ? state.now() : state.now,
    stamp = source && typeof source.getTime === 'function' ? source.getTime() : source,
    date = new Date(stamp == null ? Date.now() : stamp);
  return Number.isFinite(date.getTime()) ? date : new Date();
}
function characterMacroLocale(state) {
  return String((state && state.locale) || (typeof navigator !== 'undefined' && navigator.language) || 'zh-CN');
}
function characterMacroPad(value, size) {
  return String(Math.abs(Math.trunc(Number(value) || 0))).padStart(size || 2, '0');
}
function characterMacroIntl(date, locale, options) {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch (_) {
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }
}
function characterMacroMomentFormat(date, format, locale, useUtc) {
  format = String(format == null ? '' : format);
  var get = function (local, utc) {
      return useUtc ? date[utc]() : date[local]();
    },
    year = get('getFullYear', 'getUTCFullYear'),
    month = get('getMonth', 'getUTCMonth'),
    day = get('getDate', 'getUTCDate'),
    weekday = get('getDay', 'getUTCDay'),
    hour = get('getHours', 'getUTCHours'),
    minute = get('getMinutes', 'getUTCMinutes'),
    second = get('getSeconds', 'getUTCSeconds'),
    ms = get('getMilliseconds', 'getUTCMilliseconds'),
    zone = -date.getTimezoneOffset(),
    zoneSign = zone < 0 ? '-' : '+',
    zoneAbs = Math.abs(zone),
    tokens = {
      YYYY: String(year).padStart(4, '0'),
      YY: characterMacroPad(year % 100, 2),
      M: String(month + 1),
      MM: characterMacroPad(month + 1, 2),
      MMM: characterMacroIntl(date, locale, { month: 'short', timeZone: useUtc ? 'UTC' : undefined }),
      MMMM: characterMacroIntl(date, locale, { month: 'long', timeZone: useUtc ? 'UTC' : undefined }),
      D: String(day),
      DD: characterMacroPad(day, 2),
      Do: String(day),
      d: String(weekday),
      dd: characterMacroIntl(date, locale, { weekday: 'narrow', timeZone: useUtc ? 'UTC' : undefined }),
      ddd: characterMacroIntl(date, locale, { weekday: 'short', timeZone: useUtc ? 'UTC' : undefined }),
      dddd: characterMacroIntl(date, locale, { weekday: 'long', timeZone: useUtc ? 'UTC' : undefined }),
      H: String(hour),
      HH: characterMacroPad(hour, 2),
      h: String(hour % 12 || 12),
      hh: characterMacroPad(hour % 12 || 12, 2),
      k: String(hour || 24),
      kk: characterMacroPad(hour || 24, 2),
      m: String(minute),
      mm: characterMacroPad(minute, 2),
      s: String(second),
      ss: characterMacroPad(second, 2),
      S: String(Math.floor(ms / 100)),
      SS: characterMacroPad(Math.floor(ms / 10), 2),
      SSS: characterMacroPad(ms, 3),
      A: hour < 12 ? 'AM' : 'PM',
      a: hour < 12 ? 'am' : 'pm',
      Z: zoneSign + characterMacroPad(Math.floor(zoneAbs / 60), 2) + ':' + characterMacroPad(zoneAbs % 60, 2),
      ZZ: zoneSign + characterMacroPad(Math.floor(zoneAbs / 60), 2) + characterMacroPad(zoneAbs % 60, 2),
      X: String(Math.floor(date.getTime() / 1000)),
      x: String(date.getTime()),
      Q: String(Math.floor(month / 3) + 1),
    };
  if (format === 'LT')
    return characterMacroIntl(date, locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: useUtc ? 'UTC' : undefined,
    });
  if (format === 'LTS')
    return characterMacroIntl(date, locale, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZone: useUtc ? 'UTC' : undefined,
    });
  if (format === 'L')
    return characterMacroIntl(date, locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: useUtc ? 'UTC' : undefined,
    });
  if (format === 'LL')
    return characterMacroIntl(date, locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: useUtc ? 'UTC' : undefined,
    });
  if (format === 'LLL')
    return characterMacroIntl(date, locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: useUtc ? 'UTC' : undefined,
    });
  if (format === 'LLLL')
    return characterMacroIntl(date, locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: useUtc ? 'UTC' : undefined,
    });
  return format.replace(
    /\[[^\]]*\]|\\.|YYYY|MMMM|MMM|MM|M|dddd|ddd|dd|Do|DD|D|YY|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|SS|S|ZZ|Z|X|x|Q|A|a|d/g,
    function (token) {
      if (token.charAt(0) === '[') return token.slice(1, -1);
      if (token.charAt(0) === '\\') return token.slice(1);
      return Object.prototype.hasOwnProperty.call(tokens, token) ? tokens[token] : token;
    }
  );
}
// ST formats {{time::UTC±N}} with moment().utc().utcOffset(N), and moment reads |N| < 16 as hours.
function characterMacroUtcOffsetDate(date, offset) {
  var amount = Number(offset) || 0;
  return new Date(date.getTime() + amount * (Math.abs(amount) < 16 ? 3600000 : 60000));
}
function characterMacroHumanDuration(milliseconds, withSuffix, locale) {
  var ms = Number(milliseconds) || 0,
    abs = Math.abs(ms),
    unit = 'second',
    amount = Math.round(abs / 1000);
  if (abs >= 36e5 * 22) {
    unit = 'day';
    amount = Math.round(abs / 864e5);
  } else if (abs >= 45 * 6e4) {
    unit = 'hour';
    amount = Math.round(abs / 36e5);
  } else if (abs >= 45e3) {
    unit = 'minute';
    amount = Math.round(abs / 6e4);
  }
  amount = Math.max(0, amount);
  if (withSuffix) {
    try {
      return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(ms < 0 ? -amount : amount, unit);
    } catch (_) {}
  }
  var zh = /^zh\b/i.test(locale),
    labels = zh
      ? { second: '秒', minute: '分钟', hour: '小时', day: '天' }
      : {
          second: amount === 1 ? 'second' : 'seconds',
          minute: amount === 1 ? 'minute' : 'minutes',
          hour: amount === 1 ? 'hour' : 'hours',
          day: amount === 1 ? 'day' : 'days',
        };
  return zh ? String(amount) + labels[unit] : String(amount) + ' ' + labels[unit];
}
function characterMacroMessageRows(state) {
  return Array.isArray(state && state.messages) ? state.messages : [];
}
function characterMacroLastMessageIndex(rows, filter, includePendingSwipe) {
  for (var i = rows.length - 1; i >= 0; i--) {
    var row = rows[i] || {},
      swipes = Array.isArray(row.swipes) ? row.swipes : null,
      swipe = Number(row.swipeId != null ? row.swipeId : row.swipe_id);
    if (!includePendingSwipe && swipes && Number.isFinite(swipe) && swipe >= swipes.length) continue;
    if (!filter || filter(row)) return i;
  }
  return -1;
}
function characterMacroMessageValue(name, state) {
  var rows = characterMacroMessageRows(state),
    index,
    lower = String(name || '').toLowerCase();
  if (lower === 'lastmessage' || lower === 'lastmessageid') {
    index = characterMacroLastMessageIndex(rows, null, false);
    return lower === 'lastmessageid'
      ? index < 0
        ? ''
        : String(index)
      : index < 0
        ? ''
        : String(rows[index].content || rows[index].mes || '');
  }
  if (lower === 'lastusermessage') {
    index = characterMacroLastMessageIndex(
      rows,
      function (row) {
        return row.role === 'user' && !row.is_system;
      },
      false
    );
    return index < 0 ? '' : String(rows[index].content || rows[index].mes || '');
  }
  if (lower === 'lastcharmessage') {
    index = characterMacroLastMessageIndex(
      rows,
      function (row) {
        return row.role === 'assistant' && !row.is_system;
      },
      false
    );
    return index < 0 ? '' : String(rows[index].content || rows[index].mes || '');
  }
  if (lower === 'firstincludedmessageid')
    return rows.length
      ? String(Number.isInteger(Number(state.firstIncludedMessageId)) ? Number(state.firstIncludedMessageId) : 0)
      : '';
  if (lower === 'firstdisplayedmessageid')
    return rows.length
      ? String(Number.isInteger(Number(state.firstDisplayedMessageId)) ? Number(state.firstDisplayedMessageId) : 0)
      : '';
  if (lower === 'allchatrange') return rows.length ? '0-' + String(rows.length - 1) : '';
  index = characterMacroLastMessageIndex(rows, null, true);
  if (index < 0) return '';
  var swipes = rows[index] && rows[index].swipes,
    swipeId = Number(rows[index] && (rows[index].swipeId != null ? rows[index].swipeId : rows[index].swipe_id));
  if (lower === 'lastswipeid') return Array.isArray(swipes) ? String(swipes.length) : '';
  return Number.isFinite(swipeId) ? String(swipeId + 1) : '';
}
function characterMacroIdleDuration(state, date, locale) {
  var rows = characterMacroMessageRows(state),
    takeNext = false,
    last = null;
  for (var i = rows.length - 1; i >= 0; i--) {
    var row = rows[i];
    if (!row || row.role === 'system' || row.is_system) continue;
    if (row.role === 'user' && takeNext) {
      last = row;
      break;
    }
    takeNext = true;
  }
  var stamp = last && Number(last.time != null ? last.time : last.send_date);
  return Number.isFinite(stamp) ? characterMacroHumanDuration(date.getTime() - stamp, false, locale) : 'just now';
}
// Avatars are stored as Blobs after the first save, so templates read the same display source the chat uses.
function promptAvatarSrc(owner, char) {
  var target =
    owner === 'user' ? (typeof getActivePersona === 'function' ? getActivePersona(char && char.id) : null) : char;
  if (!target) return '';
  return String(
    typeof displayImageSrc === 'function' ? displayImageSrc(target, 'avatar_image') : target.avatar_image || ''
  );
}
function characterMacroCardValues(char, userName, state) {
  var persona = typeof getActivePersona === 'function' ? getActivePersona(char && char.id) : null,
    depth =
      (char && char.extensions && (char.extensions.depth_prompt || char.extensions.depthPrompt)) ||
      (char && char.importMeta && char.importMeta.depthPrompt),
    greetings =
      typeof getGreetings === 'function'
        ? getGreetings(char)
        : [char && char.first_mes].concat(
            Array.isArray(char && char.alternate_greetings) ? char.alternate_greetings : []
          ),
    model = state.model;
  if (model == null && typeof resolveApiRoute === 'function') {
    try {
      model = (resolveApiRoute('chat') || {}).model;
    } catch (_) {}
  }
  return {
    charprompt: String((char && char.system_prompt) || ''),
    charinstruction: String((char && char.post_history_instructions) || ''),
    charjailbreak: String((char && char.post_history_instructions) || ''),
    chardescription: String((char && char.description) || ''),
    description: String((char && char.description) || ''),
    charpersonality: String((char && char.personality) || ''),
    personality: String((char && char.personality) || ''),
    charscenario: String((char && char.scenario) || ''),
    scenario: String((char && char.scenario) || ''),
    persona: String((persona && persona.desc) || ''),
    mesexamplesraw: String((char && char.mes_example) || ''),
    mesexamples: String((char && char.mes_example) || ''),
    chardepthprompt: String(
      typeof depth === 'string' ? depth : (depth && (depth.prompt || depth.content || depth.text || depth.value)) || ''
    ),
    charcreatornotes: String((char && (char.creator_notes || char.creatorcomment)) || ''),
    creatornotes: String((char && (char.creator_notes || char.creatorcomment)) || ''),
    charfirstmessage: String(greetings[0] || ''),
    greeting: String(greetings[0] || ''),
    charversion: String((char && (char.character_version || char.version)) || ''),
    version: String((char && (char.character_version || char.version)) || ''),
    char_version: String((char && (char.character_version || char.version)) || ''),
    model: String(model || ''),
    original: String(state.original || ''),
    ismobile: String(state.isMobile != null ? state.isMobile : true),
  };
}
function characterMacroGenerationType(state) {
  var type = String((state && state.generationType) || '');
  return type === 'new' ? 'normal' : type;
}
function characterMacroTokenValue(name, state) {
  var settings = (typeof D !== 'undefined' && D && D.settings) || {},
    context = Number(state.maxContextTokens != null ? state.maxContextTokens : settings.maxContextTokens) || 0,
    response = Number(state.maxResponseTokens != null ? state.maxResponseTokens : settings.maxTokens) || 0,
    lower = String(name || '').toLowerCase();
  if (lower === 'maxcontext' || lower === 'maxcontexttokens') return String(context);
  if (lower === 'maxresponse' || lower === 'maxresponsetokens') return String(response);
  return String(Math.max(0, context - response));
}
// ===== ST text macro evaluation =====
// SillyTavern 1.19 evaluates macros as a tree in document order: every argument is resolved before
// its macro runs, {{if}} keeps both branches unresolved until one is chosen, an unknown macro keeps
// its braces around the resolved inner text, and a macro's result is never scanned again.
// Like ST's lexer (PlaintextOpenBrace), a "{" directly before "{{" is plain text, so {{{char}}} is {name}.
function characterMacroPlainBrace(source, i) {
  return source.charAt(i + 1) === '{' && source.charAt(i + 2) === '{';
}
function characterMacroNextStart(source, from) {
  var start = source.indexOf('{{', from);
  while (start >= 0 && characterMacroPlainBrace(source, start)) start++;
  return start;
}
// Pairs every macro opening with its closing in one pass, keyed by the opening's offset; an opening
// left out never closes. Scanning each opening separately made unclosed "{{" runs quadratic.
function characterMacroTokenEnds(source) {
  var ends = {},
    open = [];
  for (var i = 0; i < source.length - 1; i++) {
    var pair = source.charAt(i) + source.charAt(i + 1);
    if (pair === '{{' && characterMacroPlainBrace(source, i)) continue;
    if (pair === '{{') {
      open.push(i);
      i++;
    } else if (pair === '}}') {
      if (open.length) ends[open.pop()] = i + 2;
      i++;
    }
  }
  return ends;
}
// Splits on "::" outside nested macros, so a condition like {{getvar::x}} stays one argument.
function characterMacroTopLevelArgs(text) {
  var args = [],
    depth = 0,
    from = 0;
  for (var i = 0; i < text.length - 1; i++) {
    var pair = text.charAt(i) + text.charAt(i + 1);
    if (pair === '{{') {
      depth++;
      i++;
    } else if (pair === '}}') {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (pair === '::' && !depth) {
      args.push(text.slice(from, i));
      from = i + 2;
      i++;
    }
  }
  args.push(text.slice(from));
  return args;
}
// {{if cond}} / {{#if::cond}} open a block; {{if::cond::content}} is the complete inline form.
function characterMacroIfOpening(token) {
  var match = /^\{\{\s*(#?)if(::|\s+)([\s\S]*)\}\}$/i.exec(token);
  if (!match) return null;
  var args = match[2] === '::' ? characterMacroTopLevelArgs(match[3]) : [match[3]];
  if (!String(args[0]).trim()) return null;
  return { preserve: !!match[1], condition: args[0], inline: args.length > 1 ? args.slice(1).join('::') : null };
}
function characterMacroScopeRole(token, kind) {
  if (kind === 'trim') return /^\{\{trim\}\}$/i.test(token) ? 'open' : /^\{\{\/trim\}\}$/i.test(token) ? 'close' : '';
  if (/^\{\{\s*\/if\s*\}\}$/i.test(token)) return 'close';
  if (/^\{\{\s*else\s*\}\}$/i.test(token)) return 'else';
  var opening = characterMacroIfOpening(token);
  return opening && opening.inline == null ? 'open' : '';
}
// Finds the closing tag of a scoped macro at this nesting level, plus the first top-level {{else}}.
function characterMacroScopedBlock(source, ends, from, kind) {
  var nesting = 1,
    alternate = null,
    cursor = from,
    start;
  while ((start = characterMacroNextStart(source, cursor)) >= 0) {
    var end = ends[start];
    if (end === undefined) {
      cursor = start + 2;
      continue;
    }
    var role = characterMacroScopeRole(source.slice(start, end), kind);
    if (role === 'open') nesting++;
    else if (role === 'close' && !--nesting) return { alternate: alternate, close: start, end: end };
    else if (role === 'else' && nesting === 1 && !alternate) alternate = { start: start, end: end };
    cursor = end;
  }
  return null;
}
// `offset` (here and below) is where the text being evaluated starts in the top-level source; {{pick}} seeds on it.
function characterMacroCondition(raw, ctx, depth, offset) {
  var state = ctx.state,
    condition = String(raw || '').trim(),
    invert = false;
  if (condition.charAt(0) === '!') {
    invert = true;
    condition = condition.slice(1).trim();
  }
  if (condition.charAt(0) === '.')
    condition = Object.prototype.hasOwnProperty.call(state.vars, condition.slice(1))
      ? String(state.vars[condition.slice(1)])
      : '';
  else if (condition.charAt(0) === '$')
    condition = Object.prototype.hasOwnProperty.call(state.globalVars || {}, condition.slice(1))
      ? String(state.globalVars[condition.slice(1)])
      : '';
  else if (/^[A-Za-z_][\w]*$/.test(condition) && characterMacroOfficialStatus(condition) === 'supported')
    condition = evaluateCharacterMacroText('{{' + condition + '}}', ctx, depth, offset - 2);
  else condition = evaluateCharacterMacroText(condition, ctx, depth, offset);
  var pass = condition !== '' && !['off', 'false', '0'].includes(condition.trim().toLowerCase());
  return invert ? !pass : pass;
}
// `branches` holds the offsets of the condition and the then / else texts.
function characterMacroIf(opening, thenText, elseText, ctx, depth, branches) {
  var pass = characterMacroCondition(opening.condition, ctx, depth + 1, branches.condition),
    chosen = pass ? thenText : elseText,
    result =
      chosen == null ? '' : evaluateCharacterMacroText(chosen, ctx, depth + 1, pass ? branches.then : branches.else);
  return opening.preserve ? result : result.trim();
}
// Evaluates one scoped macro whose opening token ends at `end`; returns null when it has no closing tag.
function characterMacroScoped(source, ends, token, end, ctx, depth, offset) {
  var kind = /^\{\{trim\}\}$/i.test(token) ? 'trim' : 'if',
    opening = kind === 'if' ? characterMacroIfOpening(token) : null;
  if (kind === 'if' && (!opening || opening.inline != null)) return null;
  if (ctx.budget.blocks++ >= CHARACTER_MACRO_MAX_BLOCKS || source.length > CHARACTER_MACRO_MAX_INPUT) return null;
  var block = characterMacroScopedBlock(source, ends, end, kind);
  if (!block) return null;
  if (kind === 'trim')
    return {
      end: block.end,
      text: evaluateCharacterMacroText(source.slice(end, block.close), ctx, depth + 1, offset + end).trim(),
    };
  var thenText = source.slice(end, block.alternate ? block.alternate.start : block.close),
    elseText = block.alternate ? source.slice(block.alternate.end, block.close) : null;
  return {
    end: block.end,
    text: characterMacroIf(opening, thenText, elseText, ctx, depth, {
      condition: offset + end - token.length + token.indexOf(opening.condition),
      then: offset + end,
      else: block.alternate ? offset + block.alternate.end : 0,
    }),
  };
}
function evaluateCharacterMacroText(source, ctx, depth, offset) {
  // Remove opaque scoped comments before pairing macros, including any unmatched braces or if tags inside.
  source = String(source == null ? '' : source).replace(/\{\{\/\/\}\}[\s\S]*?\{\{\/{3,}\}\}/g, '');
  offset = offset || 0;
  if (depth > CHARACTER_MACRO_MAX_DEPTH || source.indexOf('{{') < 0) return source;
  var ends = characterMacroTokenEnds(source),
    out = '',
    cursor = 0,
    start;
  while ((start = characterMacroNextStart(source, cursor)) >= 0) {
    var end = ends[start];
    if (end === undefined) {
      out += source.slice(cursor, start + 2);
      cursor = start + 2;
      continue;
    }
    var token = source.slice(start, end),
      scoped = characterMacroScoped(source, ends, token, end, ctx, depth, offset);
    out += source.slice(cursor, start);
    if (scoped) {
      out += scoped.text;
      cursor = scoped.end;
      continue;
    }
    var expanded = evaluateCharacterMacroToken(token, ctx, depth, offset + start);
    if (/^\{\{\s*format_(?:message|chat|character|preset|global)_variable(?:_quoted)?\s*::/i.test(token))
      expanded = expanded.replace(/\n/g, '\n' + ' '.repeat(out.length - out.lastIndexOf('\n') - 1));
    out += expanded;
    cursor = end;
  }
  return out + source.slice(cursor);
}
function evaluateCharacterMacroToken(token, ctx, depth, offset) {
  if (/^\{\{\s*\/\/|^\{\{comment\s*(?:::|:|\s)/i.test(token)) return '';
  var opening = characterMacroIfOpening(token);
  if (opening && opening.inline != null) {
    var inline = opening.inline + '{{/if}}',
      branches = characterMacroScopedBlock(inline, characterMacroTokenEnds(inline), 0, 'if'),
      alternate = branches && branches.alternate,
      inlineAt = offset + token.length - 2 - opening.inline.length;
    return characterMacroIf(
      opening,
      alternate ? opening.inline.slice(0, alternate.start) : opening.inline,
      alternate ? opening.inline.slice(alternate.end) : null,
      ctx,
      depth,
      {
        condition: offset + token.indexOf(opening.condition),
        then: inlineAt,
        else: alternate ? inlineAt + alternate.end : 0,
      }
    );
  }
  var resolved = '{{' + evaluateCharacterMacroText(token.slice(2, -2), ctx, depth + 1, offset + 2) + '}}';
  for (var i = 0; i < CHARACTER_MACRO_HANDLERS.length; i++) {
    var match = CHARACTER_MACRO_HANDLERS[i][0].exec(resolved);
    if (match) {
      var value = CHARACTER_MACRO_HANDLERS[i][1](match, ctx, depth, offset);
      return value == null ? resolved : ctx.postProcess ? ctx.postProcess(String(value)) : String(value);
    }
  }
  return resolved;
}
function characterMacroContextDate(ctx) {
  if (!ctx.date) ctx.date = characterMacroDate(ctx.state);
  return ctx.date;
}
function characterMacroContextLocale(ctx) {
  if (!ctx.locale) ctx.locale = characterMacroLocale(ctx.state);
  return ctx.locale;
}
function characterMacroContextCard(ctx) {
  if (!ctx.card) ctx.card = characterMacroCardValues(ctx.char, ctx.userName, ctx.state);
  return ctx.card;
}
// Card text fields reach ST macros already macro-substituted, but without card-field macros inside
// them (baseChatReplace with replaceCharacterCard off), so a field cannot recurse into itself.
function characterMacroCardText(value, ctx, depth) {
  if (ctx.cardFieldsOff) return '';
  return evaluateCharacterMacroText(
    value,
    Object.assign({}, ctx, { cardFieldsOff: true, postProcess: null, contentHash: characterMacroHash(value) }),
    depth + 1,
    0
  );
}
var CHARACTER_MACRO_CARD_TEXT_FIELDS = {
  charprompt: 1,
  charinstruction: 1,
  charjailbreak: 1,
  chardescription: 1,
  description: 1,
  charpersonality: 1,
  personality: 1,
  charscenario: 1,
  scenario: 1,
  persona: 1,
  mesexamplesraw: 1,
  mesexamples: 1,
  chardepthprompt: 1,
  charcreatornotes: 1,
  creatornotes: 1,
};
function characterMacroHash(text) {
  var value = String(text == null ? '' : text),
    hash = 2166136261;
  for (var n = 0; n < value.length; n++) hash = Math.imul(hash ^ value.charCodeAt(n), 16777619);
  return hash >>> 0;
}
// Like ST core-macros {{pick}}, a pick is stable per chat, source text and position in it, so equal
// picks at different places choose independently; which item wins need not match ST.
function characterMacroPickChoice(kind, body, state, position) {
  var source = String(body || ''),
    choices =
      source.indexOf('::') >= 0
        ? source.split('::').map(function (item) {
            return item.trim();
          })
        : characterMacroChoices(source);
  if (!choices.length) return '';
  var key = kind + ':' + position + ':' + ((state.session && state.session.pickRerollSeed) || 0),
    index;
  if (kind === 'pick' && state.picks.has(key)) index = state.picks.get(key);
  else {
    index = Math.min(
      choices.length - 1,
      Math.floor(Math.max(0, Math.min(0.9999999999999999, Number(state.random()) || 0)) * choices.length)
    );
    if (kind === 'pick') {
      if (state.session && state.session.id)
        index = characterMacroHash(String(state.session.id) + ':' + key) % choices.length;
      state.picks.set(key, index);
    }
  }
  return choices[index] || '';
}
function characterMacroRoll(count, sides, sign, bonus, state) {
  var n = count == null || count === '' ? 1 : Number(count),
    m = Number(sides);
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(m) || m < 1) return '';
  var total = 0;
  for (var i = 0; i < n; i++)
    total += 1 + Math.floor(Math.max(0, Math.min(0.9999999999999999, Number(state.random()) || 0)) * m);
  if (sign && bonus != null && bonus !== '') {
    var add = Number(bonus);
    if (Number.isSafeInteger(add)) total += sign === '-' ? -add : add;
  }
  return String(total);
}
var CHARACTER_HOST_EXTENSION_NAMES = [
  'tavern helper',
  'tavernhelper',
  'tavern_helper',
  'js-slash-runner',
  '酒馆助手',
  'st-prompt-template',
  'prompt template',
  '提示词模板',
];
function characterMacroHelperVariable(type, path, ctx) {
  var session = ctx.state.session || (ctx.char && getActiveSession(ctx.char.id)),
    variables = {},
    container;
  if (type === 'chat') variables = (session && session.stscriptVars) || {};
  else if (type === 'global') variables = ctx.state.globalVars;
  else if (type === 'character' || type === 'preset') {
    container = type === 'character' ? ctx.char && ctx.char.extensions : (activeCompletionPresetRaw() || {}).extensions;
    variables = hostWriteContainerVariables(hostWriteExtensionContainer(container, false), false) || {};
  } else if (type === 'message' && session) {
    var rows = session.msgs || [],
      enabled = mvuEnabled(ctx.char),
      explicit = ctx.state.helperMessageId != null,
      selected = explicit ? hostWriteMessageTargetIndex(ctx.state.helperMessageId, rows.length) : rows.length - 1;
    if (enabled && !explicit) variables = mvuMacroContainers(ctx.char, session);
    else
      for (var i = selected == null ? -1 : selected; i >= 0; i--) {
        var data = cardFrontendHostMessageData(rows[i], messageActiveSwipeIndex(rows[i]), ctx.char);
        if (explicit || (data && Object.keys(data).length)) {
          variables = data;
          break;
        }
      }
    // Preserve the local MVU bare-path shorthand in existing cards.
    if (enabled) path = path.trim();
    if (enabled && !/^(?:stat_data|display_data|delta_data)(?:\.|\[|$)/.test(path))
      path = 'stat_data' + (path ? '.' + path : '');
    if (enabled) return mvuReadStatePath(variables, path);
  }
  var vendor = self.YeyuMvuVendor;
  return vendor._.get(variables, vendor._.unescape(path), null);
}
// One entry per official macro form: [pattern over the whole resolved token, handler(match, ctx, depth)].
// A handler returning null leaves the token as written.
var CHARACTER_MACRO_HANDLERS = [
  [
    /^\{\{\s*format_(message|chat|character|preset|global)_variable(_quoted)?\s*::([\s\S]*?)\}\}$/i,
    function (m, ctx) {
      return formatTavernHelperVariable(characterMacroHelperVariable(m[1].toLowerCase(), m[3], ctx), !!m[2]);
    },
  ],
  [
    /^\{\{\s*((?:get|set)(?:global)?var(?:index|key))\s*(?:::|\s)([\s\S]*)\}\}$/i,
    function (m, ctx) {
      return characterMacroVariable(m[1], m[2], ctx.state);
    },
  ],
  [
    /^\{\{(lastExpression|defaultExpression|availableExpressions)(?:::(.*))?\}\}$/i,
    function (m, ctx) {
      return expressionMacroValue(m[1], m[2], ctx.char, ctx.state.session);
    },
  ],
  [
    /^\{\{\s*(setvar|getvar|addvar|incvar|decvar|hasvar|varexists|deletevar|flushvar|setglobalvar|getglobalvar|addglobalvar|incglobalvar|decglobalvar|hasglobalvar|globalvarexists|deleteglobalvar|flushglobalvar)\s*(?:::|\s)([\s\S]*)\}\}$/i,
    function (m, ctx) {
      return characterMacroVariable(m[1], m[2], ctx.state);
    },
  ],
  [
    /^\{\{(space|newline)(?:\s*::\s*(\d+))?\}\}$/i,
    function (m) {
      return (m[1].toLowerCase() === 'space' ? ' ' : '\n').repeat(Math.max(0, m[2] == null ? 1 : Number(m[2])));
    },
  ],
  [
    /^\{\{(?:noop|else)\}\}$/i,
    function () {
      return '';
    },
  ],
  [
    /^\{\{input\}\}$/i,
    function (m, ctx) {
      if (ctx.state.input != null) return String(ctx.state.input);
      var input = typeof $ === 'function' ? $('user-input') : null;
      return String((input && input.value) || '');
    },
  ],
  [
    /^\{\{(userAvatarPath|charAvatarPath)\}\}$/i,
    function (m, ctx) {
      return promptAvatarSrc(m[1].toLowerCase() === 'useravatarpath' ? 'user' : 'char', ctx.char);
    },
  ],
  [
    /^\{\{(charprompt|charinstruction|charjailbreak|chardescription|description|charpersonality|personality|charscenario|scenario|persona|mesexamplesraw|mesexamples|chardepthprompt|charcreatornotes|creatornotes|charversion|version|char_version|model|original|ismobile)\}\}$/i,
    function (m, ctx, depth) {
      var name = m[1].toLowerCase(),
        value = characterMacroContextCard(ctx)[name] || '';
      return CHARACTER_MACRO_CARD_TEXT_FIELDS[name] ? characterMacroCardText(value, ctx, depth) : value;
    },
  ],
  [
    /^\{\{(charfirstmessage|greeting)(?:\s*::\s*(\d+))?\}\}$/i,
    function (m, ctx, depth) {
      var char = ctx.char,
        greetings =
          typeof getGreetings === 'function'
            ? getGreetings(char)
            : [char && char.first_mes].concat(
                Array.isArray(char && char.alternate_greetings) ? char.alternate_greetings : []
              );
      return characterMacroCardText(String(greetings[Math.max(0, Number(m[2]) || 0)] || ''), ctx, depth);
    },
  ],
  [
    /^\{\{(lastmessage|lastmessageid|lastusermessage|lastcharmessage|firstincludedmessageid|firstdisplayedmessageid|lastswipeid|currentswipeid|allchatrange)\}\}$/i,
    function (m, ctx) {
      return characterMacroMessageValue(m[1], ctx.state);
    },
  ],
  [
    /^\{\{(maxprompt|maxprompttokens|maxcontext|maxcontexttokens|maxresponse|maxresponsetokens)\}\}$/i,
    function (m, ctx) {
      return characterMacroTokenValue(m[1], ctx.state);
    },
  ],
  [
    /^\{\{lastgenerationtype\}\}$/i,
    function (m, ctx) {
      return characterMacroGenerationType(ctx.state);
    },
  ],
  [
    /^\{\{(time|date|weekday|isotime|isodate)\}\}$/i,
    function (m, ctx) {
      var format = { time: 'LT', date: 'LL', weekday: 'dddd', isotime: 'HH:mm', isodate: 'YYYY-MM-DD' }[
        m[1].toLowerCase()
      ];
      return characterMacroMomentFormat(
        characterMacroContextDate(ctx),
        format,
        characterMacroContextLocale(ctx),
        false
      );
    },
  ],
  [
    /^\{\{datetimeformat\s*(?:::|\s+)([^{}]+)\}\}$/i,
    function (m, ctx) {
      return characterMacroMomentFormat(characterMacroContextDate(ctx), m[1], characterMacroContextLocale(ctx), false);
    },
  ],
  [
    /^\{\{time\s*::\s*UTC([-+]\d+)\}\}$/i,
    function (m, ctx) {
      return characterMacroMomentFormat(
        characterMacroUtcOffsetDate(characterMacroContextDate(ctx), m[1]),
        'LT',
        characterMacroContextLocale(ctx),
        true
      );
    },
  ],
  [
    /^\{\{(?:idleduration|idle_duration)\}\}$/i,
    function (m, ctx) {
      return characterMacroIdleDuration(ctx.state, characterMacroContextDate(ctx), characterMacroContextLocale(ctx));
    },
  ],
  [
    /^\{\{timediff\s*::([\s\S]*?)::([\s\S]*)\}\}$/i,
    function (m, ctx) {
      var a = new Date(String(m[1]).trim()),
        b = new Date(String(m[2]).trim());
      return Number.isFinite(a.getTime()) && Number.isFinite(b.getTime())
        ? characterMacroHumanDuration(a.getTime() - b.getTime(), true, characterMacroContextLocale(ctx))
        : null;
    },
  ],
  [
    /^\{\{reverse\s*(?:::|:)([\s\S]*)\}\}$/i,
    function (m) {
      return Array.from(m[1]).reverse().join('');
    },
  ],
  [
    /^\{\{\s*hasextension(?:(?:::?|\s+)\s*([^{}]*?))?\s*\}\}$/i,
    function (m) {
      return String(
        CHARACTER_HOST_EXTENSION_NAMES.indexOf(
          String(m[1])
            .trim()
            .replace(/^third-party\//i, '')
            .toLowerCase()
        ) >= 0
      );
    },
  ],
  [
    /^\{\{roll\s*:?\s*(?:(\d*)\s*d)?(\d+)\s*(?:([+-])\s*(\d+))?\s*\}\}$/i,
    function (m, ctx) {
      return characterMacroRoll(m[1], m[2], m[3], m[4], ctx.state);
    },
  ],
  [
    /^\{\{(char|user|bot)\}\}$/i,
    function (m, ctx) {
      return m[1].toLowerCase() === 'user' ? ctx.userName : ctx.charName;
    },
  ],
  [
    /^\{\{\s*get_message_variable\s*::/i,
    function (m, ctx) {
      return typeof replaceMvuVariableMacros === 'function'
        ? replaceMvuVariableMacros(m.input, ctx.char, ctx.state)
        : null;
    },
  ],
  [
    /^\{\{(random|pick)\s*(?:::|:|\s+)([\s\S]*)\}\}$/i,
    function (m, ctx, depth, offset) {
      return characterMacroPickChoice(m[1].toLowerCase(), m[2], ctx.state, ctx.contentHash + ':' + offset);
    },
  ],
];
function finalizeCharacterMacroState(state) {
  if (state && state.ecosystem === 'risu') return finalizeRisuMacroState(state);
  if (!state || state.commit === false || !state.dirtySections || !state.dirtySections.size) return;
  if (state.session) state.session.macroVars = state.vars;
  if (typeof saveData === 'function') {
    var sections = Array.from(state.dirtySections);
    state.dirtySections.clear();
    var pending = saveData(sections);
    if (pending && typeof pending.catch === 'function')
      pending.catch(function (error) {
        console.warn('文本宏变量保存失败', error);
      });
  }
}
function characterMacroUnsupportedCounts(value) {
  return characterMacroClassifiedCounts(value).custom;
}
// options.postProcess mirrors ST's env.functions.postProcess: it rewrites each resolved macro value,
// never the text around it (regex ESCAPED mode escapes only what a macro inserted).
function replaceCharacterMacros(value, char, userName, state, options) {
  if (typeof isRisuCharacter === 'function' && isRisuCharacter(char))
    return risuRenderCBSInWorker(
      value,
      char,
      (state && (state.runtimeSession || state.session)) || getActiveSession(char.id),
      {
        state: state,
        userName: userName,
      }
    );
  state =
    state && typeof state === 'object'
      ? state
      : typeof createCharacterMacroState === 'function'
        ? createCharacterMacroState()
        : { random: Math.random, picks: new Map(), vars: {} };
  if (typeof state.random !== 'function') state.random = Math.random;
  if (!state.picks || typeof state.picks.get !== 'function') state.picks = new Map();
  if (!state.vars || typeof state.vars !== 'object' || Array.isArray(state.vars)) state.vars = {};
  if (!state.globalVars || typeof state.globalVars !== 'object' || Array.isArray(state.globalVars))
    state.globalVars = {};
  var ctx = {
      char: char,
      state: state,
      userName: String(
        userName || ((typeof getActivePersona === 'function' && getActivePersona(char && char.id)) || {}).name || '用户'
      ),
      charName:
        typeof characterPromptName === 'function'
          ? characterPromptName(char)
          : String((char && char.nickname) || '').trim() ||
            String((char && char.name) || '').trim() ||
            canonicalCharacterName(char),
      budget: { blocks: 0 },
      postProcess: options && typeof options.postProcess === 'function' ? options.postProcess : null,
    },
    // ST's pre-processors turn the legacy {{time_UTC±N}} and <USER>/<BOT>/<CHAR> forms into macros.
    text = String(value || '')
      .replace(/\{\{time_(UTC[-+]\d+)\}\}/gi, '{{time::$1}}')
      .replace(/<(char|bot|user)>/gi, function (_, name) {
        return name.toLowerCase() === 'user' ? '{{user}}' : '{{char}}';
      });
  ctx.contentHash = characterMacroHash(text);
  // ST post-processors, once everything else is resolved: \{ \} escapes drop their backslash, and a bare
  // {{trim}} removes the newlines around it.
  return evaluateCharacterMacroText(text, ctx, 0)
    .replace(/\\([{}])/g, '$1')
    .replace(/(?:\r?\n)*\{\{trim\}\}(?:\r?\n)*/gi, '');
}
function buildCharacterCorePrompt(char, userName, macroState, worldBookItems, renderedSections) {
  if (!char) return '';
  ensureCharacterIntelligence(char);
  var parts = [],
    positionRows = { before_desc: [], after_desc: [], personality: [], scenario: [] };
  (Array.isArray(worldBookItems) ? worldBookItems : []).forEach(function (item) {
    var position = String((item && item.characterPosition) || '');
    if (positionRows[position] && item && item.content) positionRows[position].push(String(item.content));
  });
  function addWorldBookPosition(position) {
    if (positionRows[position].length) parts.push(positionRows[position].join('\n'));
  }
  var risu = typeof isRisuCharacter === 'function' && isRisuCharacter(char);
  renderedSections = renderedSections && typeof renderedSections === 'object' ? renderedSections : null;
  var desc = renderedSections
    ? String(renderedSections.description || '')
    : promptClean(replaceCharacterMacros(char.description, char, userName, macroState));
  var personality = renderedSections
    ? String(renderedSections.personality || '')
    : promptClean(replaceCharacterMacros(char.personality, char, userName, macroState));
  var scenario = renderedSections
    ? String(renderedSections.scenario || '')
    : promptClean(replaceCharacterMacros(char.scenario, char, userName, macroState));
  addWorldBookPosition('before_desc');
  if (desc) parts.push(desc);
  addWorldBookPosition('after_desc');
  if (personality) {
    parts.push(risu ? 'Description of ' + characterPromptName(char) + ': ' + personality : personality);
    addWorldBookPosition('personality');
  }
  if (scenario) {
    parts.push(risu ? 'Circumstances and context of the dialogue: ' + scenario : scenario);
    addWorldBookPosition('scenario');
  }
  return parts.join(risu ? '\n\n' : '\n');
}
// A character card's system_prompt / post_history_instructions replaces the preset text as in SillyTavern;
// the first {{original}} inserts that text and any later one is empty.
function resolveCardPromptTemplate(original, override) {
  var base = String(original || ''),
    cardText = promptClean(override || '').trim(),
    inserted = false;
  if (!cardText) return base;
  return cardText
    .replace(/\{\{original\}\}/gi, function () {
      if (inserted) return '';
      inserted = true;
      return base;
    })
    .trim();
}
function buildPrompt(char, msgs, userMsg, macroState, disabledUiPrompts, renderMacros) {
  const persona = (macroState && macroState.personaOverride) || getActivePersona(char && char.id);
  const userName = persona?.name || '用户';
  const userDesc = persona?.desc || '';

  var disabled = disabledUiPrompts && typeof disabledUiPrompts.has === 'function' ? disabledUiPrompts : new Set();
  var raw = typeof activeCompletionPresetRaw === 'function' ? activeCompletionPresetRaw() : null,
    main =
      raw && Array.isArray(raw.prompts)
        ? raw.prompts.find(function (prompt) {
            return String((prompt && prompt.identifier) || '') === 'main';
          })
        : null;
  let sys = resolveCardPromptTemplate(
    disabled.has('system_prompt') ? '' : String((main && main.content) || ''),
    char.system_prompt
  );
  sys = sys.replace(/\{\{persona\}\}/g, userDesc);
  sys = sys.replace(/\{\{scenario\}\}/g, char.scenario || '');
  sys = sys.replace(/\{\{description\}\}/g, char.description || '');
  sys = sys.replace(/\{\{personality\}\}/g, char.personality || '');
  return typeof renderMacros === 'function'
    ? renderMacros(sys)
    : replaceCharacterMacros(sys, char, userName, macroState);
}
