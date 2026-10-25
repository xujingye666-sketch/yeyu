/* global YeyuFaker */
// Loaded on demand from js/vendor/faker-9.7.0.js.
// ===== ST-Prompt-Template 1.17.9 compatibility runtime =====
var PROMPT_TEMPLATE_DECORATORS = new Set([
  'activate',
  'dont_activate',
  'message_formatting',
  'generate_before',
  'generate_after',
  'render_before',
  'render_after',
  'dont_preload',
  'initial_variables',
  'always_enabled',
  'only_preload',
  'preload',
  'iframe',
  'preprocessing',
  'if',
  'private',
]);
var PROMPT_TEMPLATE_DEFAULT_FEATURES = {
  enabled: true,
  generate: true,
  generate_loader: true,
  render: true,
  render_loader: true,
  preload_worldinfo: true,
  raw_message_evaluation: true,
  preload_only: true,
  compile_workers: false,
  sandbox: false,
  code_editor: false,
  inject_loader: false,
};
var PROMPT_TEMPLATE_DEFAULT_CHAR_DEFINE =
  '<% if (name) { %><<%- name %>>\n<% if (system_prompt) { %>System: <%- system_prompt %>\n<% } %>name: <%- name %>\n<% if (personality) { %>personality: <%- personality %>\n<% } %><% if (description) { %>description: <%- description %>\n<% } %><% if (message_example) { %>example:\n<%- message_example %>\n<% } %><% if (depth_prompt) { %>System: <%- depth_prompt %>\n<% } %></<%- name %>><% } %>';
var _promptTemplateFeatures = Object.assign({}, PROMPT_TEMPLATE_DEFAULT_FEATURES),
  _promptTemplateDefines = {},
  _promptTemplatePublicTransactions = new WeakMap(),
  _promptTemplatePreviewNotes = new WeakMap(),
  _promptTemplatePublicPending = new Set(),
  _promptTemplateInitialByOwner = new Map(),
  _promptTemplateStickyInjections = new Map(),
  _promptTemplateRenderCache = new WeakMap(),
  _promptTemplateRenderBooks = new WeakMap(),
  _promptTemplateRenderNotice = new Set();
var _promptTemplateFakerLoad = null,
  _promptTemplateRegexOwner = '',
  _promptTemplateRegexRevision = 0,
  _promptTemplateRegexes = { basic: new Map(), generate: new Map(), message: new Map() };

async function promptTemplateLoadFaker() {
  if (typeof YeyuFaker === 'object') return YeyuFaker;
  if (!_promptTemplateFakerLoad)
    _promptTemplateFakerLoad = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'js/vendor/faker-9.7.0.js';
      script.onload = function () {
        resolve(typeof YeyuFaker === 'object' ? YeyuFaker : undefined);
      };
      script.onerror = function () {
        script.remove();
        _promptTemplateFakerLoad = null;
        resolve(undefined);
      };
      document.head.appendChild(script);
    });
  return _promptTemplateFakerLoad;
}
function promptTemplateSelectRegexOwner(char, session) {
  var key = promptTemplateOwnerKey(char, session);
  if (_promptTemplateRegexOwner !== key) {
    _promptTemplateRegexOwner = key;
    promptTemplateDeactivateRegex({ basic: true, generate: true, message: true }, Infinity);
    _promptTemplateRenderCache = new WeakMap();
  }
}
function promptTemplateDeactivateRegex(selector, count) {
  Object.keys(_promptTemplateRegexes).forEach(function (kind) {
    if (!selector[kind] && !selector.uuid) return;
    _promptTemplateRegexes[kind].forEach(function (row, id, map) {
      if (selector.uuid && id !== selector.uuid) return;
      row.sticky -= count == null ? 1 : count;
      if (kind === 'basic' || row.sticky <= 0) {
        map.delete(id);
        if (kind === 'message') _promptTemplateRegexRevision++;
      }
    });
  });
  if (selector.basic && typeof invalidateRegexScriptRuntimeCache === 'function') invalidateRegexScriptRuntimeCache();
}
// A preview transaction keeps its generate and message rules in private copies, so the chat display and the next
// real send never see them. Basic rules stay in the shared table because the prompt build reads them through the
// regex script rows; they only affect sending, and the preview restores that table when it ends.
function promptTemplatePreviewRegexes() {
  return {
    basic: _promptTemplateRegexes.basic,
    generate: new Map(_promptTemplateRegexes.generate),
    message: new Map(_promptTemplateRegexes.message),
  };
}
function promptTemplateRegexTable(transaction) {
  return (transaction && transaction.regexes) || _promptTemplateRegexes;
}
function promptTemplateActivateRegex(pattern, replace, options, table) {
  if (typeof pattern !== 'string' && !promptTemplateRegex(pattern)) throw new TypeError('动态正则需要字符串或 RegExp');
  table = table || _promptTemplateRegexes;
  var opts = options || {},
    shared = table === _promptTemplateRegexes,
    id = opts.uuid || String(pattern) + '@' + String(replace);
  if (opts.basic || (opts.basic == null && opts.message == null && opts.generate == null)) {
    if (typeof replace !== 'string') throw new Error('Basic mode regexes must have a string replace value.');
    var existing = table.basic.get(id);
    table.basic.set(id, {
      id: id,
      scriptName: '\u200b' + id,
      findRegex: promptTemplateRegex(pattern)
        ? existing
          ? '/' + pattern.source + '/' + pattern.flags
          : pattern.source
        : pattern,
      replaceString: replace,
      trimStrings: [],
      placement: [
        (opts.user ?? true) ? 1 : 0,
        (opts.assistant ?? true) ? 2 : 0,
        (opts.worldinfo ?? !!existing) ? 5 : 0,
        (opts.reasoning ?? true) ? 6 : 0,
      ].filter(Boolean),
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: existing ? existing.minDepth : (opts.minDepth ?? NaN),
      maxDepth: existing ? existing.maxDepth : (opts.minDepth ?? NaN),
    });
    if (typeof invalidateRegexScriptRuntimeCache === 'function') invalidateRegexScriptRuntimeCache();
  }
  ['generate', 'message'].forEach(function (kind) {
    if (!opts[kind]) return;
    var existing = table[kind].get(id),
      row = {
        search: pattern,
        replace: replace,
        user: opts.user ?? true,
        assistant: opts.assistant ?? true,
        system: opts.system ?? true,
        reasoning: opts.reasoning ?? false,
        worldinfo: opts.worldinfo ?? false,
        order: opts.order ?? 100,
        sticky: opts.sticky ?? 0,
        minDepth: opts.minDepth ?? NaN,
        maxDepth: opts.minDepth ?? NaN,
        before: opts.before ?? (opts.after ?? opts.html) == null,
        after: opts.after ?? false,
        html: opts.html ?? false,
      };
    var changed =
      !existing ||
      Object.keys(row).some(function (key) {
        if (key === 'sticky') return false;
        if (key === 'search' && promptTemplateRegex(row[key]) && promptTemplateRegex(existing[key]))
          return row[key].source !== existing[key].source || row[key].flags !== existing[key].flags;
        if (key === 'replace' && typeof row[key] === 'function' && typeof existing[key] === 'function')
          return String(row[key]) !== String(existing[key]);
        return !Object.is(row[key], existing[key]);
      });
    table[kind].set(id, row);
    if (kind === 'message' && changed && shared) _promptTemplateRegexRevision++;
  });
}
function promptTemplateRegexMatches(row, kind, flags) {
  if (
    ['user', 'assistant', 'system'].some(function (role) {
      return (kind === 'message' ? flags[role] : flags.role === role) && row[role] === false;
    })
  )
    return false;
  if (
    (kind === 'message' ? ['worldinfo', 'reasoning', 'before', 'after', 'html'] : ['worldinfo']).some(function (key) {
      return flags[key] && !row[key];
    })
  )
    return false;
  if (
    kind === 'message' &&
    Number.isSafeInteger(flags.depth) &&
    ((row.minDepth >= -1 && flags.depth < row.minDepth) || (row.maxDepth >= 0 && flags.depth > row.maxDepth))
  )
    return false;
  return true;
}
function promptTemplateApplyRegex(transaction, context, text, kind, flags) {
  flags = flags || {};
  var value = String(text == null ? '' : text);
  Array.from(promptTemplateRegexTable(transaction)[kind].values())
    .sort(function (a, b) {
      return a.order - b.order;
    })
    .forEach(function (row) {
      if (!promptTemplateRegexMatches(row, kind, flags)) return;
      value = value.replace(row.search, typeof row.replace === 'function' ? row.replace.bind(context) : row.replace);
    });
  return value;
}
function promptTemplateUpdateStatistics(transaction, text, type) {
  var prefix = type === 'send' ? 'LAST_SEND_' : 'LAST_RECEIVE_';
  text = String(text || '');
  promptTemplateSetVariable(transaction, prefix + 'CHARS', text.length, { scope: 'global' });
  promptTemplateSetVariable(transaction, prefix + 'TOKENS', estTokens(text), { scope: 'global' });
}

function promptTemplateRegex(value) {
  return Object.prototype.toString.call(value) === '[object RegExp]';
}
function promptTemplateMatches(value, wanted) {
  value = String(value || '');
  if (promptTemplateRegex(wanted)) {
    wanted.lastIndex = 0;
    return wanted.test(value);
  }
  return value === String(wanted) || value.match(String(wanted));
}
function promptTemplateSafeKey(value) {
  return value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}
// Variable paths follow lodash castPath/stringToPath, which upstream reaches through _.get/_.set/_.unset.
var PROMPT_TEMPLATE_PATH_SEGMENT =
    /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g,
  PROMPT_TEMPLATE_DEEP_PATH = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/;
function promptTemplatePath(value, object) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  if (typeof value !== 'string') return [String(value)];
  if (
    !PROMPT_TEMPLATE_DEEP_PATH.test(value) ||
    (object != null && Object.prototype.hasOwnProperty.call(Object(object), value))
  )
    return [value];
  var parts = value.charAt(0) === '.' ? [''] : [];
  value.replace(PROMPT_TEMPLATE_PATH_SEGMENT, function (match, number, quote, quoted) {
    parts.push(quote ? quoted.replace(/\\(\\)?/g, '$1') : number || match);
  });
  return parts;
}
function promptTemplateIndexKey(value) {
  return /^(?:0|[1-9]\d*)$/.test(value);
}
function promptTemplateGet(object, path) {
  var parts = promptTemplatePath(path, object),
    value = object;
  for (var i = 0; i < parts.length; i++) {
    if (value == null) return undefined;
    value = value[parts[i]];
  }
  return value;
}
function promptTemplateSet(object, path, value) {
  var parts = promptTemplatePath(path, object);
  if (!parts.length) return value;
  if (!parts.every(promptTemplateSafeKey)) return object;
  var owner = object;
  for (var i = 0; i < parts.length - 1; i++) {
    var key = parts[i];
    if (!objectRecord(owner[key]) && !Array.isArray(owner[key]))
      owner[key] = promptTemplateIndexKey(parts[i + 1]) ? [] : {};
    owner = owner[key];
  }
  owner[parts[parts.length - 1]] = value;
  return object;
}
// Like _.unset: array elements become holes so later indexes keep their slots.
function promptTemplateDelete(object, path) {
  var parts = promptTemplatePath(path, object);
  if (!parts.length || !parts.every(promptTemplateSafeKey)) return;
  var owner = parts.length > 1 ? promptTemplateGet(object, parts.slice(0, -1)) : object;
  if (owner != null && typeof owner === 'object') delete owner[parts[parts.length - 1]];
}
function promptTemplateMerge(base, patch) {
  if (Array.isArray(patch)) return cloneData(patch);
  if (!objectRecord(patch)) return cloneData(patch);
  var out = objectRecord(base) ? cloneData(base) : {};
  Object.keys(patch).forEach(function (key) {
    if (promptTemplateSafeKey(key)) out[key] = promptTemplateMerge(out[key], patch[key]);
  });
  return out;
}
function promptTemplateMergeContext(target, patch) {
  if (!target || !objectRecord(patch)) return target;
  Object.keys(patch).forEach(function (key) {
    if (!promptTemplateSafeKey(key)) return;
    var value = patch[key];
    if (objectRecord(value) && objectRecord(target[key]))
      promptTemplateMergeContext(target[key], value);
    else
      try {
        target[key] = cloneData(value);
      } catch (_) {
        target[key] = value;
      }
  });
  return target;
}
function promptTemplateParseJSON(value) {
  return JSON.parse(JSONRepair.jsonrepair(value));
}
function promptTemplateOptionalJSON(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return undefined;
  }
}
function promptTemplateJsonPatch(document, operations) {
  var out = cloneData(document);
  function pathOf(pointer) {
    if (typeof pointer !== 'string') throw new Error('Path must be a string.');
    if (pointer === '') return [];
    if (!pointer.startsWith('/')) throw new Error('Invalid JSON Pointer: must start with "/".');
    return pointer
      .slice(1)
      .split('/')
      .map(function (part) {
        return part.replace(/~1/g, '/').replace(/~0/g, '~');
      });
  }
  function unset(path) {
    var parent = path.length > 1 ? promptTemplateGet(out, path.slice(0, -1)) : out;
    return !parent || !path.length || delete parent[path[path.length - 1]];
  }
  function warn(message) {
    if (typeof toast === 'function') toast(message, 'err');
  }
  for (var row of operations) {
    var path = pathOf(row.path),
      from = row.from ? pathOf(row.from) : undefined;
    if (['set', 'assign', 'add', 'replace'].includes(row.op)) {
      if (path[path.length - 1] === '-') {
        var parent = path.length > 1 ? promptTemplateGet(out, path.slice(0, -1)) : undefined;
        if (Array.isArray(parent)) parent.push(row.value);
        else warn('JSON Patch 追加目标不是数组：' + row.path);
      } else promptTemplateSet(out, path, row.value);
    } else if (row.op === 'remove') {
      if (!unset(path)) promptTemplateToast().warning('JSON Patch 无法删除路径：' + row.path);
    } else if (row.op === 'copy' || row.op === 'move') {
      var value = from ? promptTemplateGet(out, from) : undefined;
      if (value === undefined) {
        warn('JSON Patch 来源不存在：' + row.from);
        continue;
      }
      if (row.op === 'move') unset(from);
      promptTemplateSet(out, path, value);
    } else if (row.op === 'test') {
      var actual = path.length ? promptTemplateGet(out, path) : undefined;
      if (!promptTemplateJsonEqual(actual, row.value)) {
        warn('JSON Patch 测试失败：' + row.path);
        return document;
      }
    } else warn('JSON Patch 不支持的操作：' + row.op);
  }
  return out;
}
function promptTemplateJsonEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  var keys = Object.keys(left);
  return (
    Array.isArray(left) === Array.isArray(right) &&
    keys.length === Object.keys(right).length &&
    keys.every(function (key) {
      return Object.prototype.hasOwnProperty.call(right, key) && promptTemplateJsonEqual(left[key], right[key]);
    })
  );
}
function promptTemplateLines(entry) {
  return Array.isArray(entry && entry.decoratorLines) ? entry.decoratorLines.map(String) : [];
}
function promptTemplateDecoratorRows(entry) {
  var rows = [];
  promptTemplateLines(entry).forEach(function (line) {
    var match = line.trim().match(/^@@([a-z_]+)(?:\s+([\s\S]*))?$/i);
    if (match && PROMPT_TEMPLATE_DECORATORS.has(String(match[1]).toLowerCase()))
      rows.push({ name: String(match[1]).toLowerCase(), value: String(match[2] || '').trim() });
  });
  return rows;
}
function promptTemplateHasDecorator(entry, name) {
  name = String(name || '').toLowerCase();
  return promptTemplateDecoratorRows(entry).some(function (row) {
    return row.name === name;
  });
}
function promptTemplateDecoratorValue(entry, name) {
  name = String(name || '').toLowerCase();
  var row = promptTemplateDecoratorRows(entry).find(function (value) {
    return value.name === name;
  });
  return row ? row.value : '';
}
// Titles match case-insensitively (a superset of upstream). Phases select titles by prefix like evaluate.ts
// startsWith; any title containing a special tag stays special like worldinfo.ts isSpecialEntry includes.
function promptTemplateEntryComment(entry) {
  return String((entry && entry.comment) || (entry && entry.name) || '')
    .trim()
    .toUpperCase();
}
function promptTemplateCommentStartsWith(entry, tag) {
  return promptTemplateEntryComment(entry).startsWith(String(tag).toUpperCase());
}
function promptTemplateCommentIncludes(entry, tag) {
  return promptTemplateEntryComment(entry).includes(String(tag).toUpperCase());
}
var PROMPT_TEMPLATE_PHASE_KINDS = ['generate_before', 'generate_after', 'render_before', 'render_after'];
function promptTemplateSpecialKind(entry) {
  var comment = promptTemplateEntryComment(entry),
    match = /^\[(?:GENERATE:(\d+)|(GENERATE|RENDER)):(BEFORE|AFTER)\]/.exec(comment);
  if (promptTemplateHasDecorator(entry, 'initial_variables') || comment.startsWith('[INITIALVARIABLES]'))
    return 'initial_variables';
  if (comment.startsWith('@INJECT')) return 'inject';
  if (promptTemplateHasDecorator(entry, 'only_preload')) return 'only_preload';
  if (match) return (match[1] ? 'index_' : match[2].toLowerCase() + '_') + match[3].toLowerCase();
  var decorated = PROMPT_TEMPLATE_PHASE_KINDS.find(function (kind) {
    return promptTemplateHasDecorator(entry, kind);
  });
  if (decorated) return decorated;
  return /\[INITIALVARIABLES\]|@INJECT|\[GENERATE:|\[RENDER:/.test(comment) ? 'special' : '';
}
function promptTemplateSpecialEnabled(entry) {
  var raw = objectRecord(entry && entry._raw) || entry || {};
  return raw.disable === true || raw.disabled === true || raw.enabled === false || (entry && entry.enabled === false);
}
function promptTemplateEntryEnabled(entry) {
  if (promptTemplateHasDecorator(entry, 'always_enabled')) return true;
  return promptTemplateSpecialKind(entry) ? promptTemplateSpecialEnabled(entry) : !!(entry && entry.enabled);
}
function promptTemplateEntryLabel(entry) {
  return (
    String((entry && entry._catName) || '') +
    '.' +
    String((entry && entry.comment) || (entry && entry.name) || (entry && entry.id) || '')
  );
}

function promptTemplateCurrent() {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  return { char: char, session: session };
}
function promptTemplateMessageIndex(session, value) {
  var length = session && Array.isArray(session.msgs) ? session.msgs.length : 0,
    index = value == null ? length - 1 : Number(value);
  if (!Number.isFinite(index)) index = length - 1;
  if (index < 0) index = length + index;
  return Math.max(0, Math.min(Math.max(0, length - 1), Math.floor(index)));
}
function promptTemplateLive(char, session, messageId) {
  var current = promptTemplateCurrent();
  // Borrowed-character generation still owns variables in the active chat.
  if (current.char && current.session === session) char = current.char;
  return {
    charId: String((char && char.id) || ''),
    owner: {
      sessionId: String((session && session.id) || ''),
      messageIndex: promptTemplateMessageIndex(session, messageId),
    },
  };
}
function promptTemplateOwnerKey(char, session) {
  return String((char && char.id) || '') + '|' + String((session && session.id) || '');
}
function promptTemplateUpdateInitialOwner(transaction) {
  if (transaction.cancelled) return;
  var key = promptTemplateOwnerKey(transaction.char, transaction.session),
    next = cloneData(transaction.initial) || {},
    current = _promptTemplateInitialByOwner.get(key);
  if (!current) {
    current = next;
    _promptTemplateInitialByOwner.set(key, current);
    return current;
  }
  promptTemplateSyncVariableView(current, next);
  return current;
}
function promptTemplateInjectionSnapshot(char, session) {
  var stored = _promptTemplateStickyInjections.get(promptTemplateOwnerKey(char, session)),
    out = new Map();
  if (stored)
    stored.forEach(function (rows, key) {
      out.set(
        key,
        new Map(
          Array.from(rows.entries()).map(function (pair) {
            return [pair[0], cloneData(pair[1])];
          })
        )
      );
    });
  return out;
}
function promptTemplateScopeRead(live, type, option) {
  try {
    return typeof hostWriteGetVariables === 'function'
      ? hostWriteGetVariables(live, Object.assign({ type: type }, option || {}))
      : {};
  } catch (_) {
    return {};
  }
}
function promptTemplatePreviousMessageVariables(char, session, messageId, key) {
  var index = promptTemplateMessageIndex(session, messageId),
    live = promptTemplateLive(char, session, index);
  for (var at = index; at >= 0; at--) {
    var value = promptTemplateScopeRead(live, 'message', { message_id: at });
    if (key == null && Object.keys(value).length) return value;
    var found = promptTemplateGet(value, key);
    if (found !== undefined) return found;
  }
  return key == null ? {} : undefined;
}
function promptTemplateFindVariables(transaction, key, messageId) {
  var length = transaction.session && Array.isArray(transaction.session.msgs) ? transaction.session.msgs.length : 0,
    end = messageId == null ? length : Number(messageId);
  if (!Number.isFinite(end)) end = length;
  if (end < 0) end = length + end;
  end = Math.max(0, Math.min(length, Math.floor(end)));
  for (var at = end - 1; at >= 0; at--) {
    var value = promptTemplateScopeRead(transaction.live, 'message', { message_id: at });
    if (key == null || promptTemplateGet(value, key) != null) return cloneData(value);
  }
  return cloneData(transaction.initial);
}
function promptTemplateCreateTransaction(char, session, messageId, env, swipeId) {
  var index = promptTemplateMessageIndex(session, messageId),
    live = promptTemplateLive(char, session, index),
    messageRow = (session && session.msgs && session.msgs[index]) || {},
    selectedSwipe =
      swipeId == null
        ? Math.max(0, Number(messageRow.swipeId ?? messageRow.swipe_id) || 0)
        : Math.max(0, Number(swipeId) || 0),
    global = promptTemplateScopeRead(live, 'global'),
    local = promptTemplateScopeRead(live, 'chat'),
    canonicalMessage = promptTemplateScopeRead(live, 'message', { message_id: index, swipe_id: selectedSwipe }),
    message = canonicalMessage,
    dirty = new Set();
  if (!Object.keys(message).length && index > 0) {
    message = promptTemplatePreviousMessageVariables(char, session, index - 1);
    if (Object.keys(message).length) dirty.add('message');
  }
  return {
    char: char,
    session: session,
    messageId: index,
    messageSwipeId: selectedSwipe,
    live: live,
    env: env || {},
    isDryRun: !!(env && (env.isDryRun || env.dryRun)),
    preview: !!(env && env.preview),
    regexes: env && env.preview ? promptTemplatePreviewRegexes() : null,
    scopes: { global: global, local: local, message: message },
    bases: {
      global: cloneData(global),
      local: cloneData(local),
      message: cloneData(canonicalMessage),
    },
    initial: {},
    cache: {},
    cacheDeletes: [],
    cacheReset: false,
    variablesView: null,
    variablesViewBase: null,
    messageTargets: new Map(),
    dirty: dirty,
    injections: promptTemplateInjectionSnapshot(char, session),
    activated: [],
    forcedEntries: new Map(),
    processed: new Map(),
    activeEvaluations: 0,
    inactiveWaiters: [],
    savePromise: null,
    stscriptRunToken: null,
    closed: false,
  };
}
function promptTemplateVariableOptions(options) {
  if (typeof options === 'string') {
    if (['old', 'new', 'fullcache'].includes(options)) return { results: options };
    if (['nx', 'xx', 'nxs', 'xxs', 'n'].includes(options)) return { flags: options };
    if (['cache', 'global', 'local', 'message', 'initial'].includes(options))
      return { scope: options, inscope: options, outscope: options };
  }
  if (typeof options === 'boolean') return { dryRun: options };
  return Object.assign({}, objectRecord(options) || {});
}
function promptTemplateComposeVariables(transaction) {
  var out = promptTemplateMerge(
    promptTemplateMerge(promptTemplateMerge(transaction.scopes.global, transaction.initial), transaction.scopes.local),
    transaction.scopes.message
  );
  if (transaction.cacheReset) out = {};
  transaction.cacheDeletes.forEach(function (path) {
    promptTemplateDelete(out, path);
  });
  return promptTemplateMerge(out, transaction.cache);
}
function promptTemplateCaptureVariableView(transaction, base, next, path) {
  if (promptTemplateSame(base, next)) return;
  path = path || [];
  if (Array.isArray(base) || Array.isArray(next) || !objectRecord(base) || !objectRecord(next)) {
    if (path.length) promptTemplateCacheSet(transaction, path, next);
    else {
      transaction.cacheReset = true;
      transaction.cache = cloneData(next) || {};
      transaction.cacheDeletes = [];
    }
    return;
  }
  var keys = new Set(Object.keys(base).concat(Object.keys(next)));
  keys.forEach(function (key) {
    var child = path.concat(key);
    if (!Object.prototype.hasOwnProperty.call(next, key)) promptTemplateCacheDelete(transaction, child);
    else if (!Object.prototype.hasOwnProperty.call(base, key)) promptTemplateCacheSet(transaction, child, next[key]);
    else promptTemplateCaptureVariableView(transaction, base[key], next[key], child);
  });
}
function promptTemplateSyncVariableView(target, source) {
  Object.keys(target).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
  });
  Object.keys(source).forEach(function (key) {
    target[key] = cloneData(source[key]);
  });
}
function promptTemplateRefreshVariables(transaction) {
  if (transaction.variablesView && transaction.variablesViewBase)
    promptTemplateCaptureVariableView(transaction, transaction.variablesViewBase, transaction.variablesView, []);
  var out = promptTemplateComposeVariables(transaction);
  if (transaction.variablesView) {
    promptTemplateSyncVariableView(transaction.variablesView, out);
    transaction.variablesViewBase = cloneData(out);
    return transaction.variablesView;
  }
  return out;
}
function promptTemplateVariablesView(transaction) {
  if (!transaction.variablesView) {
    transaction.variablesView = promptTemplateComposeVariables(transaction);
    transaction.variablesViewBase = cloneData(transaction.variablesView);
  }
  return transaction.variablesView;
}
function promptTemplateMessageFilter(transaction, filter, getter) {
  filter = objectRecord(filter) || {};
  var rows = transaction.session && Array.isArray(transaction.session.msgs) ? transaction.session.msgs : [],
    index;
  if (filter.id !== undefined) {
    index = Number(filter.id);
    if (index < 0) index = rows.length + index;
  } else if (filter.role !== undefined) {
    for (var at = rows.length - 1; at >= 0; at--) {
      var role = String((rows[at] && rows[at].role) || 'assistant'),
        matches = filter.role === 'any' || role === filter.role;
      if (!matches) continue;
      if (getter) {
        var probe = promptTemplateScopeRead(transaction.live, 'message', { message_id: at, swipe_id: filter.swipe_id });
        if (!Object.keys(probe).length) continue;
      }
      index = at;
      break;
    }
  } else if (getter) {
    for (var previous = transaction.messageId; previous >= 0; previous--) {
      var available = promptTemplateScopeRead(transaction.live, 'message', {
        message_id: previous,
        swipe_id: filter.swipe_id,
      });
      if (Object.keys(available).length) {
        index = previous;
        break;
      }
    }
  } else index = transaction.messageId;
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null;
  var message = rows[index] || {},
    swipe =
      filter.swipe_id == null
        ? messageActiveSwipeIndex(message)
        : Math.floor(Number(filter.swipe_id) || 0),
    length = Array.isArray(message.swipes) ? message.swipes.length : 1;
  if (swipe < 0) swipe = length + swipe;
  return { id: index, swipe: Math.max(0, swipe) };
}
function promptTemplateMessageRecord(transaction, filter, getter) {
  var target = promptTemplateMessageFilter(transaction, filter, getter);
  if (!target) return null;
  var key = target.id + '|' + target.swipe,
    row = transaction.messageTargets.get(key);
  if (!row) {
    var value = promptTemplateScopeRead(transaction.live, 'message', { message_id: target.id, swipe_id: target.swipe });
    row = { messageId: target.id, swipeId: target.swipe, scope: value, base: cloneData(value), dirty: false };
    transaction.messageTargets.set(key, row);
  }
  return row;
}
function promptTemplateScope(transaction, scope, options, getter) {
  scope = String(scope || 'cache').toLowerCase();
  if (scope === 'chat') scope = 'local';
  if (scope === 'cache') return promptTemplateRefreshVariables(transaction);
  if (scope === 'initial') return transaction.initial;
  if (scope === 'message' && options && options.withMsg) {
    var record = promptTemplateMessageRecord(transaction, options.withMsg, getter);
    return record ? record.scope : {};
  }
  return transaction.scopes[scope] || promptTemplateRefreshVariables(transaction);
}
// Cache paths are arrays already resolved against the composed variables, as upstream resolves them on cacheVars.
function promptTemplateCacheSet(transaction, path, value) {
  if (path == null) {
    transaction.cacheReset = true;
    transaction.cache = objectRecord(value) || Array.isArray(value) ? cloneData(value) : {};
    transaction.cacheDeletes = [];
    return;
  }
  promptTemplateSet(transaction.cache, path, cloneData(value));
  var id = JSON.stringify(path);
  transaction.cacheDeletes = transaction.cacheDeletes.filter(function (deleted) {
    return JSON.stringify(deleted) !== id;
  });
}
function promptTemplateCacheDelete(transaction, path) {
  if (path == null) {
    transaction.cacheReset = true;
    transaction.cache = {};
    transaction.cacheDeletes = [];
    return;
  }
  promptTemplateDelete(transaction.cache, path);
  transaction.cacheDeletes.push(path);
}
function promptTemplateMarkVariableDirty(transaction, scope, options) {
  if (transaction.cancelled) return;
  if (scope === 'message' && options && options.withMsg) {
    var record = promptTemplateMessageRecord(transaction, options.withMsg, false);
    if (record) {
      record.dirty = true;
      _promptTemplatePublicPending.add(transaction);
    }
    return;
  }
  if (['global', 'local', 'message'].includes(scope)) {
    transaction.dirty.add(scope);
    _promptTemplatePublicPending.add(transaction);
  }
}
function promptTemplateGetVariable(transaction, key, options) {
  options = promptTemplateVariableOptions(options);
  if (options.noCache) promptTemplateRefreshCanonical(transaction, true);
  var store = promptTemplateScope(transaction, options.scope, options, true),
    value = key == null ? store : promptTemplateGet(store, key);
  if (options.index !== undefined && options.index !== '')
    value = promptTemplateGet(
      typeof value === 'string' ? (promptTemplateOptionalJSON(value) ?? value) : value,
      options.index
    );
  var fallback = Object.prototype.hasOwnProperty.call(options, 'defaults') ? options.defaults : options.default_value,
    resolved = value === undefined ? fallback : value,
    scope = String(options.scope || 'cache').toLowerCase();
  if (
    !options.clone &&
    resolved &&
    typeof resolved === 'object' &&
    ['global', 'local', 'chat', 'message'].includes(scope)
  )
    promptTemplateMarkVariableDirty(transaction, scope === 'chat' ? 'local' : scope, options);
  return options.clone ? cloneData(resolved) : resolved;
}
function promptTemplateSetVariable(transaction, key, value, options) {
  options = promptTemplateVariableOptions(options);
  if (transaction.isDryRun && !transaction.preview && options.dryRun !== true) return undefined;
  if (options.noCache) promptTemplateRefreshCanonical(transaction, true);
  var scope = String(options.scope || 'message').toLowerCase(),
    flags = String(options.flags || '').toLowerCase(),
    results = options.results || options.result;
  if (scope === 'chat') scope = 'local';
  if (!['global', 'local', 'message', 'cache', 'initial'].includes(scope))
    throw new Error('不支持的 Prompt Template 变量作用域：' + scope);
  var cache = promptTemplateRefreshVariables(transaction),
    cachePath = key == null ? null : promptTemplatePath(key, cache),
    cacheRoot = key == null ? cache : promptTemplateGet(cache, cachePath),
    scopedRoot = promptTemplateGetVariable(
      transaction,
      key,
      Object.assign({}, options, { scope: scope, index: undefined, noCache: false, clone: true })
    ),
    indexed = options.index !== undefined && options.index !== '',
    old,
    next = cloneData(value),
    storedNext,
    cacheNext;
  if (indexed) {
    var cacheData =
        typeof cacheRoot === 'string' ? (promptTemplateOptionalJSON(cacheRoot) ?? {}) : cloneData(cacheRoot),
      scopeData =
        typeof scopedRoot === 'string' ? (promptTemplateOptionalJSON(scopedRoot) ?? {}) : cloneData(scopedRoot);
    if (!objectRecord(cacheData) && !Array.isArray(cacheData))
      cacheData = /^\d+$/.test(String(options.index)) ? [] : {};
    if (!objectRecord(scopeData) && !Array.isArray(scopeData))
      scopeData = /^\d+$/.test(String(options.index)) ? [] : {};
    old = promptTemplateGet(cacheData, options.index);
    var cacheHas = old !== undefined,
      scopeHas = promptTemplateGet(scopeData, options.index) !== undefined;
    if (
      (flags === 'nx' && cacheHas) ||
      (flags === 'xx' && !cacheHas) ||
      (flags === 'nxs' && scopeHas) ||
      (flags === 'xxs' && !scopeHas)
    )
      return undefined;
    if (options.merge) {
      if (Array.isArray(next)) next = (Array.isArray(old) ? cloneData(old) : []).concat(cloneData(next));
      else if (objectRecord(next)) next = promptTemplateMerge(objectRecord(old) || {}, next);
    }
    if (next === undefined) {
      promptTemplateDelete(cacheData, options.index);
      promptTemplateDelete(scopeData, options.index);
    } else {
      promptTemplateSet(cacheData, options.index, next);
      promptTemplateSet(scopeData, options.index, next);
    }
    cacheNext = typeof cacheRoot === 'string' ? JSON.stringify(cacheData) : cacheData;
    storedNext = typeof scopedRoot === 'string' ? JSON.stringify(scopeData) : scopeData;
  } else {
    old = cacheRoot;
    var hasCache = key == null ? Object.keys(cache).length > 0 : cacheRoot !== undefined,
      hasScoped = scopedRoot !== undefined;
    if (
      (flags === 'nx' && hasCache) ||
      (flags === 'xx' && !hasCache) ||
      (flags === 'nxs' && hasScoped) ||
      (flags === 'xxs' && !hasScoped)
    )
      return undefined;
    if (options.merge) {
      if (Array.isArray(next)) next = (Array.isArray(old) ? cloneData(old) : []).concat(cloneData(next));
      else if (objectRecord(next)) next = promptTemplateMerge(objectRecord(old) || {}, next);
    }
    if (key == null && next !== undefined) {
      storedNext = Object.assign({}, objectRecord(scopedRoot) || {}, objectRecord(next) || {});
      cacheNext = Object.assign({}, objectRecord(cacheRoot) || {}, objectRecord(next) || {});
    } else {
      storedNext = next;
      cacheNext = next;
    }
  }
  if (scope === 'cache') {
    if (cacheNext === undefined) promptTemplateCacheDelete(transaction, cachePath);
    else promptTemplateCacheSet(transaction, cachePath, cacheNext);
  } else {
    var store = promptTemplateScope(transaction, scope, options, false);
    if (key == null) {
      if (scope === 'initial') transaction.initial = storedNext === undefined ? {} : storedNext;
      else if (scope === 'message' && options.withMsg) {
        var replaceRecord = promptTemplateMessageRecord(transaction, options.withMsg, false);
        if (replaceRecord) replaceRecord.scope = storedNext === undefined ? {} : storedNext;
      } else transaction.scopes[scope] = storedNext === undefined ? {} : storedNext;
    } else if (storedNext === undefined) promptTemplateDelete(store, key);
    else promptTemplateSet(store, key, storedNext);
    promptTemplateMarkVariableDirty(transaction, scope, options);
    if (cacheNext === undefined) promptTemplateCacheDelete(transaction, cachePath);
    else promptTemplateCacheSet(transaction, cachePath, cacheNext);
  }
  var result = results === 'old' ? cloneData(old) : results === 'fullcache' ? null : cloneData(next),
    full = promptTemplateRefreshVariables(transaction);
  return results === 'fullcache' ? full : result;
}
function promptTemplateDeleteVariable(transaction, key, index, options) {
  if (options === undefined && objectRecord(index)) {
    options = index;
    index = undefined;
  }
  options = promptTemplateVariableOptions(options);
  var old = promptTemplateGetVariable(transaction, key, options);
  if (index == null) return promptTemplateSetVariable(transaction, key, undefined, options);
  var next = cloneData(old);
  if (Array.isArray(next)) {
    var at = next.indexOf(index);
    if (at < 0) return undefined;
    next.splice(at, 1);
  } else if (objectRecord(next)) delete next[String(index)];
  else if (typeof next === 'string' && typeof index === 'string') {
    var found = next.indexOf(index);
    if (found < 0) return undefined;
    next = next.slice(0, found) + next.slice(found + index.length);
  } else return undefined;
  return promptTemplateSetVariable(transaction, key, next, options);
}
function promptTemplateInsertVariable(transaction, key, value, index, options) {
  options = promptTemplateVariableOptions(options);
  var current = promptTemplateGetVariable(transaction, key, options),
    target = cloneData(current);
  if (Array.isArray(target)) {
    var at = index == null ? target.length : Number(index);
    if (at < 0) at = target.length + at;
    target.splice(Math.max(0, Math.min(target.length, at)), 0, value);
  } else if (objectRecord(target) && index != null) {
    var exists = Object.prototype.hasOwnProperty.call(target, String(index)),
      flags = String(options.flags || '');
    if ((flags.includes('nx') && exists) || (flags.includes('xx') && !exists)) return undefined;
    target[String(index)] = value;
  } else if (typeof target === 'string') {
    var place = index == null ? target.length : Number(index);
    if (typeof index === 'string') {
      place = target.indexOf(index);
      if (place < 0) return undefined;
    }
    if (place < 0) place = target.length + place;
    target = target.slice(0, place) + String(value) + target.slice(place);
  } else return undefined;
  return promptTemplateSetVariable(transaction, key, target, options);
}
function promptTemplateChangeVariable(transaction, key, value, options, direction) {
  options = promptTemplateVariableOptions(options);
  var inscope = options.inscope || options.scope || 'cache',
    outscope = options.outscope || options.scope || 'message',
    flags = String(options.flags || 'n'),
    raw = promptTemplateGetVariable(transaction, key, {
      scope: inscope,
      index: options.index,
      withMsg: options.withMsg,
      noCache: options.noCache,
    }),
    exists = raw !== undefined,
    cacheExists = promptTemplateGetVariable(transaction, key, { scope: 'cache' }) !== undefined,
    allowed =
      flags === 'n' ||
      !flags ||
      (flags === 'nx' && !cacheExists) ||
      (flags === 'xx' && cacheExists) ||
      (flags === 'nxs' && !exists) ||
      (flags === 'xxs' && exists);
  if (!allowed) return undefined;
  var next = Number(raw === undefined ? (options.defaults == null ? 0 : options.defaults) : raw) || 0;
  next += direction * (value === undefined ? 1 : Number(value) || 0);
  if (options.min != null) next = Math.max(next, Number(options.min));
  if (options.max != null) next = Math.min(next, Number(options.max));
  return promptTemplateSetVariable(transaction, key, next, {
    scope: outscope,
    index: options.index,
    withMsg: options.withMsg,
    results: options.results,
    dryRun: options.dryRun,
    flags: 'n',
  });
}
function promptTemplateSame(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return left === right;
  }
}
function promptTemplateApplyDelta(base, next, latest) {
  if (promptTemplateSame(base, next)) return cloneData(latest);
  if (!objectRecord(base) || !objectRecord(next)) return cloneData(next);
  var out = objectRecord(latest) ? cloneData(latest) : {},
    keys = new Set(Object.keys(base).concat(Object.keys(next)));
  keys.forEach(function (key) {
    if (!promptTemplateSafeKey(key)) return;
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      delete out[key];
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      out[key] = cloneData(next[key]);
      return;
    }
    out[key] = promptTemplateApplyDelta(base[key], next[key], out[key]);
  });
  return out;
}
function promptTemplateCanonicalScope(transaction, scope) {
  var type = scope === 'local' ? 'chat' : scope,
    option = {};
  if (scope === 'message') {
    option.message_id = transaction.messageId;
    option.swipe_id = transaction.messageSwipeId;
  }
  var value = promptTemplateScopeRead(transaction.live, type, option);
  if (scope === 'message' && !Object.keys(value).length && transaction.messageId > 0)
    value = promptTemplatePreviousMessageVariables(transaction.char, transaction.session, transaction.messageId - 1);
  return value;
}
function promptTemplateRefreshCanonical(transaction, preserveDirty) {
  ['global', 'local', 'message'].forEach(function (scope) {
    var latest = promptTemplateCanonicalScope(transaction, scope),
      value =
        preserveDirty && transaction.dirty.has(scope)
          ? promptTemplateApplyDelta(transaction.bases[scope], transaction.scopes[scope], latest)
          : latest;
    transaction.scopes[scope] = value;
    transaction.bases[scope] = cloneData(latest);
  });
  transaction.messageTargets.forEach(function (row) {
    var latest = promptTemplateScopeRead(transaction.live, 'message', {
        message_id: row.messageId,
        swipe_id: row.swipeId,
      }),
      value = preserveDirty && row.dirty ? promptTemplateApplyDelta(row.base, row.scope, latest) : latest;
    row.scope = value;
    row.base = cloneData(latest);
  });
}
function promptTemplateCanonicalSnapshot(transaction) {
  return {
    global: cloneData(transaction.scopes.global),
    local: cloneData(transaction.scopes.local),
    message: cloneData(transaction.scopes.message),
  };
}
function promptTemplateRebaseAfterExternal(transaction, before) {
  promptTemplateRefreshCanonical(transaction);
  ['global', 'local', 'message'].forEach(function (scope) {
    var previous = before[scope] || {},
      latest = transaction.scopes[scope] || {},
      keys = new Set(Object.keys(previous).concat(Object.keys(latest)));
    keys.forEach(function (key) {
      if (promptTemplateSame(previous[key], latest[key])) return;
      if (latest[key] === undefined) promptTemplateCacheDelete(transaction, [key]);
      else promptTemplateCacheSet(transaction, [key], latest[key]);
    });
  });
  if (transaction.variablesView) {
    var current = promptTemplateComposeVariables(transaction);
    promptTemplateSyncVariableView(transaction.variablesView, current);
    transaction.variablesViewBase = cloneData(current);
  }
}
async function promptTemplateFlush(transaction, close) {
  if (!transaction || transaction.closed) return;
  if (transaction.preview) {
    if (close) {
      transaction.closed = true;
      if (transaction.releaseSignal) transaction.releaseSignal();
      _promptTemplatePublicPending.delete(transaction);
    }
    return;
  }
  var dirty = Array.from(transaction.dirty),
    dirtyTargets = Array.from(transaction.messageTargets.values()).filter(function (row) {
      return row.dirty;
    }),
    writes = [];
  dirty.forEach(function (scope) {
    var type = scope === 'local' ? 'chat' : scope,
      option = { type: type },
      latest = promptTemplateCanonicalScope(transaction, scope),
      merged = promptTemplateApplyDelta(transaction.bases[scope], transaction.scopes[scope], latest);
    if (scope === 'message') {
      option.message_id = transaction.messageId;
      option.swipe_id = transaction.messageSwipeId;
    }
    transaction.scopes[scope] = merged;
    if (typeof hostWriteReplaceVariables === 'function')
      writes.push(Promise.resolve(hostWriteReplaceVariables(transaction.live, merged, option)));
  });
  dirtyTargets.forEach(function (row) {
    var option = { type: 'message', message_id: row.messageId, swipe_id: row.swipeId },
      latest = promptTemplateScopeRead(transaction.live, 'message', option),
      merged = promptTemplateApplyDelta(row.base, row.scope, latest);
    row.scope = merged;
    if (typeof hostWriteReplaceVariables === 'function')
      writes.push(Promise.resolve(hostWriteReplaceVariables(transaction.live, merged, option)));
  });
  await Promise.all(writes);
  if (transaction.cancelled) return;
  if (writes.length && typeof saveData === 'function') {
    var sections = [];
    if (transaction.dirty.has('global')) sections.push('meta');
    if (transaction.dirty.has('local') || transaction.dirty.has('message') || dirtyTargets.length)
      sections.push('sessions');
    if (sections.length) await saveData(sections.length === 1 ? sections[0] : sections, { urgent: true });
  }
  transaction.dirty.clear();
  dirtyTargets.forEach(function (row) {
    row.dirty = false;
  });
  promptTemplateRefreshCanonical(transaction);
  if (close) {
    transaction.closed = true;
    if (transaction.releaseSignal) transaction.releaseSignal();
  }
  if (close || transaction.activeEvaluations === 0) _promptTemplatePublicPending.delete(transaction);
}
function promptTemplateCancelTransaction(transaction) {
  if (!transaction || transaction.cancelled) return;
  transaction.cancelled = true;
  promptTemplateRollbackInjections(transaction);
  transaction.closed = true;
  transaction.live.cancelled = true;
  if (transaction.releaseSignal) transaction.releaseSignal();
  transaction.dirty.clear();
  transaction.messageTargets.forEach(function (row) {
    row.dirty = false;
  });
  _promptTemplatePublicPending.delete(transaction);
  transaction.inactiveWaiters.splice(0).forEach(function (resolve) {
    resolve();
  });
}
function promptTemplateBindSignal(transaction, signal) {
  if (!signal) return;
  transaction.signal = signal;
  var cancel = function () {
    promptTemplateCancelTransaction(transaction);
  };
  if (signal.aborted) cancel();
  else {
    signal.addEventListener('abort', cancel, { once: true });
    transaction.releaseSignal = function () {
      signal.removeEventListener('abort', cancel);
    };
  }
}
async function promptTemplateWithTransactionLock(transaction, callback) {
  if (!transaction || transaction.closed) return;
  while (transaction.savePromise) await transaction.savePromise;
  if (transaction.closed) return;
  var wrapped,
    operation = Promise.resolve().then(callback);
  wrapped = operation.finally(function () {
    if (transaction.savePromise === wrapped) transaction.savePromise = null;
  });
  transaction.savePromise = wrapped;
  return wrapped;
}
async function promptTemplateSaveTransaction(transaction, close) {
  return promptTemplateWithTransactionLock(transaction, function () {
    return promptTemplateFlush(transaction, close);
  });
}
async function promptTemplateCommit(transaction) {
  return promptTemplateSaveTransaction(transaction, true);
}
async function promptTemplateSavePublicWhenInactive(transaction) {
  while (transaction && !transaction.cancelled && transaction.activeEvaluations > 0)
    await new Promise(function (resolve) {
      transaction.inactiveWaiters.push(resolve);
    });
  return promptTemplateSaveTransaction(transaction, false);
}
async function promptTemplateTrackedEvaluation(transaction, callback) {
  if (!transaction) return callback();
  if (transaction.cancelled) throw cardFrontendAbortError('EJS 模板');
  while (transaction.savePromise) await transaction.savePromise;
  if (transaction.closed) return callback();
  _promptTemplatePublicPending.add(transaction);
  transaction.activeEvaluations++;
  try {
    return await callback();
  } finally {
    transaction.activeEvaluations = Math.max(0, transaction.activeEvaluations - 1);
    if (transaction.activeEvaluations === 0) {
      var waiters = transaction.inactiveWaiters.splice(0);
      waiters.forEach(function (resolve) {
        resolve();
      });
      var hasDirty =
        transaction.dirty.size ||
        Array.from(transaction.messageTargets.values()).some(function (row) {
          return row.dirty;
        });
      if (!hasDirty) _promptTemplatePublicPending.delete(transaction);
    }
  }
}

function promptTemplateToast() {
  return {
    success: function (value) {
      if (typeof toast === 'function') toast(String(value || ''), 'ok');
    },
    error: function (value) {
      if (typeof toast === 'function') toast(String(value || ''), 'err');
    },
    warning: function (value) {
      if (typeof toast === 'function') toast(String(value || ''), 'info');
    },
    info: function (value) {
      if (typeof toast === 'function') toast(String(value || ''), 'info');
    },
  };
}
function promptTemplateFindCharacter(current, name) {
  var rows = typeof D !== 'undefined' && D && Array.isArray(D.characters) ? D.characters.filter(Boolean) : [];
  if (name == null || name === '' || name === 'current') return current || null;
  if (typeof name === 'number') return rows[name] || null;
  return (
    rows.find(function (row) {
      return String((row && row.id) || '') === String(name) || promptTemplateMatches(row && row.name, name);
    }) || null
  );
}
function promptTemplateCharacterData(char, name) {
  var found = arguments.length > 1 ? promptTemplateFindCharacter(char, name) : char;
  return found ? cloneData(found) : null;
}
function promptTemplateCharacterDefine(char) {
  if (!char) return null;
  var example = String(char.mes_example || char.message_example || '').trim();
  if (example.startsWith('<START>')) example = example.slice(7).trim();
  example = example.replace('<START>', '```\n```');
  if (example && example.includes('```')) example += '\n```';
  return {
    name: String(char.name || ''),
    description: String(char.description || ''),
    personality: String(char.personality || ''),
    scenario: String(char.scenario || ''),
    first_message: String(char.first_mes || char.first_message || ''),
    message_example: example,
    creator_notes: String(char.creator_notes || ''),
    creatorcomment: String(char.creatorcomment || ''),
    system_prompt: String(char.system_prompt || ''),
    post_history_instructions: String(char.post_history_instructions || ''),
    alternate_greetings: cloneData(char.alternate_greetings || []),
    depth_prompt: cloneData(char.depth_prompt),
    creator: String(char.creator || ''),
  };
}
function promptTemplateWorldInfoData(char, name) {
  var categories =
      typeof D !== 'undefined' && D && D.worldBook && Array.isArray(D.worldBook.categories)
        ? D.worldBook.categories
        : [],
    rows = [];
  categories.forEach(function (category) {
    if (name !== undefined && (name === '' || String((category && category.name) || '') !== String(name))) return;
    ((category && category.entries) || []).forEach(function (entry) {
      rows.push(
        typeof wbRuntimeEntry === 'function'
          ? wbRuntimeEntry(entry, category)
          : Object.assign({}, entry, { _catId: category.id, _catName: category.name })
      );
    });
  });
  return rows;
}
function promptTemplateOfficialUid(entry) {
  var uid = Number(entry && entry.id);
  if (Number.isFinite(uid)) return uid;
  var value =
      String((entry && entry._catId) || (entry && entry._catName) || '') + '|' + String((entry && entry.id) || ''),
    hash = 2166136261;
  for (var i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function promptTemplateOfficialPosition(entry) {
  var raw = entry && entry.sourcePosition,
    n = Number(raw);
  if (raw !== '' && raw != null && Number.isFinite(n) && n >= 0 && n <= 7) return n;
  var positions = {
    before_char: 0,
    after_char: 1,
    an_top: 2,
    an_bottom: 3,
    at_depth: 4,
    em_top: 5,
    em_bottom: 6,
    outlet: 7,
  };
  return positions[String((entry && entry.position) || '')] ?? 1;
}
function promptTemplateOfficialRole(entry) {
  var raw = entry && entry._raw,
    source = raw && raw.role;
  if (source == null && raw && raw.extensions) source = raw.extensions.role;
  if (source == null) return null;
  var role = String(source).toLowerCase();
  return role === 'user' || role === '1' ? 1 : role === 'assistant' || role === '2' ? 2 : 0;
}
function promptTemplateWorldInfoOfficial(entry) {
  entry = entry || {};
  var raw = objectRecord(entry._raw) || {},
    filter = objectRecord(entry.characterFilter) || { isExclude: false, names: [], tags: [] },
    position = promptTemplateOfficialPosition(entry),
    role = promptTemplateOfficialRole(entry),
    displayIndex = Number(raw.displayIndex ?? raw.display_index ?? entry.displayIndex ?? 0),
    extensions = Object.assign({}, objectRecord(entry.extensions) || {}, {
      position: position,
      exclude_recursion: !!entry.excludeRecursion,
      display_index: displayIndex,
      probability: Number(entry.probability ?? 100),
      useProbability: entry.useProbability !== false,
      depth: Number(entry.depth ?? 4),
      selectiveLogic: Number(entry.selectiveLogic ?? 0),
      group: String(entry.group || ''),
      group_override: !!entry.groupOverride,
      group_weight: Number(entry.groupWeight ?? 100),
      prevent_recursion: !!entry.preventRecursion,
      delay_until_recursion: entry.delayUntilRecursion || false,
      scan_depth: entry.scanDepth == null ? null : Number(entry.scanDepth),
      match_whole_words: entry.matchWholeWords == null ? null : !!entry.matchWholeWords,
      use_group_scoring: entry.useGroupScoring == null ? null : !!entry.useGroupScoring,
      case_sensitive: entry.caseSensitive == null ? null : !!entry.caseSensitive,
      automation_id: String(entry.automationId || ''),
      role: role,
      vectorized: !!entry.vectorized,
      sticky: Number(entry.sticky || 0),
      cooldown: Number(entry.cooldown || 0),
      delay: Number(entry.delay || 0),
      match_persona_description: !!entry.matchPersonaDescription,
      match_character_description: !!entry.matchCharacterDescription,
      match_character_personality: !!entry.matchCharacterPersonality,
      match_character_depth_prompt: !!entry.matchCharacterDepthPrompt,
      match_scenario: !!entry.matchScenario,
      match_creator_notes: !!entry.matchCreatorNotes,
      ignoreBudget: !!entry.ignoreBudget,
    });
  return {
    uid: promptTemplateOfficialUid(entry),
    key: cloneData(entry.keys || []),
    keysecondary: cloneData(entry.secondary_keys || []),
    comment: String(entry.comment || entry.name || ''),
    content: String(entry.content || ''),
    constant: !!entry.constant,
    vectorized: !!entry.vectorized,
    selective: !!entry.selective,
    selectiveLogic: Number(entry.selectiveLogic ?? 0),
    addMemo: !!entry.addMemo,
    order: Number(entry.order ?? 100),
    position: position,
    disable: !entry.enabled,
    excludeRecursion: !!entry.excludeRecursion,
    preventRecursion: !!entry.preventRecursion,
    delayUntilRecursion: entry.delayUntilRecursion || false,
    probability: Number(entry.probability ?? 100),
    useProbability: entry.useProbability !== false,
    depth: Number(entry.depth ?? 4),
    group: String(entry.group || ''),
    groupOverride: !!entry.groupOverride,
    groupWeight: Number(entry.groupWeight ?? 100),
    scanDepth: entry.scanDepth == null ? null : Number(entry.scanDepth),
    caseSensitive: entry.caseSensitive == null ? null : !!entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords == null ? null : !!entry.matchWholeWords,
    useGroupScoring: entry.useGroupScoring == null ? null : !!entry.useGroupScoring,
    automationId: String(entry.automationId || ''),
    role: role,
    sticky: Number(entry.sticky || 0),
    cooldown: Number(entry.cooldown || 0),
    delay: Number(entry.delay || 0),
    displayIndex: displayIndex,
    world: String(entry._catName || ''),
    decorators: promptTemplateLines(entry).map(function (line) {
      return String(line).trim();
    }),
    extensions: extensions,
    hash: raw.hash,
    triggers: cloneData(entry.triggers || []),
    characterFilter: {
      isExclude: !!filter.isExclude,
      names: cloneData(filter.names || []),
      tags: cloneData(filter.tags || []),
    },
    characterFilterNames: cloneData(filter.names || []),
    characterFilterTags: cloneData(filter.tags || []),
    characterFilterExclude: !!filter.isExclude,
    matchPersonaDescription: !!entry.matchPersonaDescription,
    matchCharacterDescription: !!entry.matchCharacterDescription,
    matchCharacterPersonality: !!entry.matchCharacterPersonality,
    matchCharacterDepthPrompt: !!entry.matchCharacterDepthPrompt,
    matchScenario: !!entry.matchScenario,
    matchCreatorNotes: !!entry.matchCreatorNotes,
    ignoreBudget: !!entry.ignoreBudget,
  };
}
function promptTemplatePersonaWorld(char) {
  var persona =
    typeof getActivePersona === 'function'
      ? getActivePersona(char && char.id)
      : typeof D !== 'undefined' && D && Array.isArray(D.personas)
        ? D.personas.find(function (row) {
            return row && String(row.id || '') === String(D.activePersonaId || '');
          })
        : null;
  return String(
    (persona && ((persona.extensions && persona.extensions.world) || persona.world || persona.lorebook)) || ''
  );
}
function promptTemplateDefaultWorldInfoName(char, session) {
  return (
    String((char && char.extensions && char.extensions.world) || '') ||
    promptTemplatePersonaWorld(char) ||
    String((session && session.tavernHelperChatLorebook) || '')
  );
}
function promptTemplateWorldEntry(char, book, name, session) {
  var explicit = name != null,
    wanted = explicit ? name : book,
    wantedBook = explicit ? book : undefined,
    defaultBook = String(wantedBook || promptTemplateDefaultWorldInfoName(char, session) || ''),
    rows = promptTemplateWorldInfoData(char, defaultBook),
    match = function (row, allowUid) {
      return (
        (allowUid && promptTemplateOfficialUid(row) === wanted) ||
        promptTemplateMatches(row.comment || row.name, wanted)
      );
    },
    found = rows.find(function (row) {
      return match(row, true);
    });
  if (found || (explicit && wantedBook)) return found || null;
  if (typeof wanted === 'number') return null;
  var enabled = promptTemplateEnabledLoreBooks(char, session);
  for (var i = 0; i < enabled.length; i++) {
    if (enabled[i] === defaultBook) continue;
    found = promptTemplateWorldInfoData(char, enabled[i]).find(function (row) {
      return match(row, false);
    });
    if (found) return found;
  }
  return null;
}
function promptTemplatePresetPrompt(name) {
  var raw = typeof completionPresetRawForGeneration === 'function' ? completionPresetRawForGeneration('in_use') : null,
    row =
      raw && Array.isArray(raw.prompts)
        ? raw.prompts.find(function (value) {
            return promptTemplateMatches((value && value.identifier) || (value && value.name), name);
          })
        : null;
  return row ? String(row.content || '') : '';
}
function promptTemplateQuickReplyData(char, session, name) {
  var state = (typeof D !== 'undefined' && D && D.settings && objectRecord(D.settings.quickReply)) || {},
    sets = Array.isArray(state.sets) ? state.sets : [],
    names = (Array.isArray(state.globalSetNames) ? state.globalSetNames : []).concat(
      session && session.quickReply && Array.isArray(session.quickReply.setNames) ? session.quickReply.setNames : [],
      state.characterLinks && Array.isArray(state.characterLinks[char && char.id]) ? state.characterLinks[char.id] : []
    ),
    seen = new Set(),
    links = [];
  names.forEach(function (value) {
    value = String(value || '');
    if (seen.has(value)) return;
    seen.add(value);
    var set = sets.find(function (row) {
      return String((row && row.name) || '') === value;
    });
    if (set) links.push({ set: cloneData(set), isVisible: true });
  });
  if (name === undefined) return links;
  return (
    links.find(function (link) {
      return promptTemplateMatches(link.set && link.set.name, name);
    }) || null
  );
}
function promptTemplateEnabledLoreBooks(char, session, chara, global, persona, charaExtra, chat, onlyExisting) {
  chara = chara !== false;
  global = global !== false;
  persona = persona !== false;
  charaExtra = charaExtra !== false;
  chat = chat !== false;
  onlyExisting = onlyExisting !== false;
  var worldBook = (typeof D !== 'undefined' && D && D.worldBook) || {},
    categories = Array.isArray(worldBook.categories) ? worldBook.categories : [],
    names = [],
    push = function (value) {
      value = String(value || '');
      if (value && !names.includes(value)) names.push(value);
    },
    primary = String((char && char.extensions && char.extensions.world) || ''),
    globalIds = new Set((worldBook.globalCategoryIds || []).map(String));
  if (chara) push(primary);
  if (global)
    categories.forEach(function (row) {
      if (globalIds.has(String((row && row.id) || ''))) push(row.name);
    });
  if (persona) push(promptTemplatePersonaWorld(char));
  if (charaExtra)
    categories.forEach(function (row) {
      if (
        ((row && row.boundCharIds) || []).map(String).includes(String((char && char.id) || '')) &&
        String(row.name || '') !== primary &&
        !globalIds.has(String(row.id || ''))
      )
        push(row.name);
    });
  if (chat) push(session && session.tavernHelperChatLorebook);
  return onlyExisting
    ? names.filter(function (name) {
        return categories.some(function (row) {
          return String((row && row.name) || '') === name;
        });
      })
    : names;
}
function promptTemplateEnabledWorldInfoEntries(char, session, chara, global, persona, charaExtra, chat, onlyExisting) {
  var names = promptTemplateEnabledLoreBooks(char, session, chara, global, persona, charaExtra, chat, onlyExisting);
  return promptTemplateWorldInfoData(char).filter(function (entry) {
    return names.includes(String(entry._catName || ''));
  });
}
function promptTemplateChatRows(char, session) {
  return (session && Array.isArray(session.msgs) ? session.msgs : []).map(function (message, index) {
    return typeof hostWriteMessageRow === 'function'
      ? hostWriteMessageRow(char, message, index, true)
      : cloneData(message);
  });
}
function promptTemplateModel(settings) {
  return typeof resolveApiRoute === 'function' ? String(resolveApiRoute('chat', { settings: settings }).model || '') : '';
}
function promptTemplateWorldEntryKey(entry) {
  return String((entry && entry._catId) || (entry && entry._catName) || '') + '|' + String((entry && entry.id) || '');
}
function promptTemplateSelectionEntry(original) {
  return Object.assign({}, original, {
    keys: original.keys || original.key || [],
    secondary_keys: original.secondary_keys || original.keysecondary || [],
    enabled: original.disable == null ? original.enabled : !original.disable,
    decoratorLines: original.decoratorLines || original.decorators || [],
    position: original.position,
    role: original.role,
  });
}
function promptTemplateWorldKeyMatch(source, key, entry, char, random) {
  key = promptTemplateMacroResult(key, char, random);
  var parsed = typeof wbParseRegexPattern === 'function' ? wbParseRegexPattern(key) : null;
  if (parsed && parsed.valid) {
    parsed.regex.lastIndex = 0;
    return parsed.regex.test(source);
  }
  var sensitive =
      entry.caseSensitive == null
        ? !!(typeof D !== 'undefined' && D && D.worldBook && D.worldBook.case_sensitive)
        : entry.caseSensitive === true,
    haystack = sensitive ? String(source) : String(source).toLowerCase(),
    needle = sensitive ? String(key) : String(key).toLowerCase(),
    whole =
      entry.matchWholeWords == null
        ? !!(typeof D !== 'undefined' && D && D.worldBook && D.worldBook.match_whole_words)
        : entry.matchWholeWords === true;
  if (!whole) return haystack.includes(needle);
  if (/\s/.test(needle)) return haystack.includes(needle);
  return new RegExp('(?:^|\\W)(' + escapeRegexText(String(needle)) + ')(?:$|\\W)').test(haystack);
}
function promptTemplateWorldInfoDepth(entry, top) {
  var position = typeof entry.position === 'number' ? entry.position : promptTemplateOfficialPosition(entry),
    offsets = { 0: 4, 1: 3, 5: 2, 6: 1 },
    depth = Number(entry.depth ?? 4);
  if (position === 4) return depth;
  if (position === 2 || position === 3)
    return Math.max(0, Number(typeof D !== 'undefined' && D && D.settings && D.settings.anDepth) || 0) + depth;
  return offsets[position] == null ? depth : offsets[position] + top;
}
function promptTemplateWorldInfoSort(entries) {
  var top = Math.max(
    0,
    ...entries.map(function (entry) {
      return (typeof entry.position === 'number' ? entry.position : promptTemplateOfficialPosition(entry)) === 4
        ? Number(entry.depth || 0)
        : 0;
    })
  );
  return function (a, b) {
    return (
      promptTemplateWorldInfoDepth(b, top) - promptTemplateWorldInfoDepth(a, top) ||
      Number(a.order ?? 100) - Number(b.order ?? 100) ||
      Number(b.uid ?? promptTemplateOfficialUid(b)) - Number(a.uid ?? promptTemplateOfficialUid(a))
    );
  };
}
function promptTemplateWorldInfoScore(source, entry, char) {
  var primary = (entry.keys || []).filter(function (key) {
      return promptTemplateWorldKeyMatch(source, key, entry, char);
    }).length,
    secondary = (entry.secondary_keys || []).filter(function (key) {
      return promptTemplateWorldKeyMatch(source, key, entry, char);
    }).length;
  if (!(entry.keys || []).length) return 0;
  if ((entry.secondary_keys || []).length && Number(entry.selectiveLogic || 0) === 0) return primary + secondary;
  if ((entry.secondary_keys || []).length && Number(entry.selectiveLogic || 0) === 3)
    return secondary === (entry.secondary_keys || []).length ? primary + secondary : primary;
  return primary;
}
function promptTemplateSelectActivatedEntries(char, entries, text, condition, random) {
  random = typeof random === 'function' ? random : Math.random;
  condition = objectRecord(condition) || {};
  var source = Array.isArray(text) ? text.map(String).join('\n\n') : String(text == null ? '' : text),
    activated = [];
  (Array.isArray(entries) ? entries : []).forEach(function (original) {
    var entry = promptTemplateSelectionEntry(original);
    if (
      (condition.constant != null && entry.constant !== condition.constant) ||
      (condition.disabled != null && !entry.enabled !== condition.disabled) ||
      (condition.vectorized != null && !!entry.vectorized !== condition.vectorized)
    )
      return;
    if (entry.useProbability && Number(entry.probability) < Math.floor(random() * 100) + 1) return;
    if (entry.constant || promptTemplateHasDecorator(entry, 'activate')) {
      activated.push(original);
      return;
    }
    if (promptTemplateHasDecorator(entry, 'dont_activate') || promptTemplateHasDecorator(entry, 'only_preload')) return;
    var primary = (entry.keys || []).map(function (key) {
      return promptTemplateWorldKeyMatch(source, key, entry, char, random);
    });
    if (!primary.some(Boolean)) return;
    var secondary = entry.secondary_keys || [];
    if (!entry.selective || !secondary.length) {
      activated.push(original);
      return;
    }
    var matches = secondary.map(function (key) {
        return promptTemplateWorldKeyMatch(source, key, entry, char, random);
      }),
      logic = Number(entry.selectiveLogic || 0),
      pass =
        logic === 0
          ? matches.some(Boolean)
          : logic === 1
            ? !matches.every(Boolean)
            : logic === 2
              ? !matches.some(Boolean)
              : matches.every(Boolean);
    if (pass) activated.push(original);
  });
  if (!activated.length) return [];
  var groups = new Map(),
    ungrouped = [];
  activated.forEach(function (original) {
    var group = String(original.group || '');
    if (!group) {
      ungrouped.push(original);
      return;
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(original);
  });
  var globalScoring = !!(typeof D !== 'undefined' && D && D.worldBook && D.worldBook.use_group_scoring),
    matched = [];
  groups.forEach(function (rows) {
    if (rows.length === 1) {
      matched.push(rows[0]);
      return;
    }
    if (
      rows.some(function (row) {
        return row.groupOverride;
      })
    ) {
      var orders = rows.map(function (row) {
          return Number(row.order ?? 100);
        }),
        top = Math.min.apply(Math, orders);
      if (top) {
        matched.push(
          rows[
            Math.max(
              orders.findIndex(function (order) {
                return order <= top;
              }),
              0
            )
          ]
        );
        return;
      }
    }
    if (
      rows.some(function (row) {
        return row.useGroupScoring ?? globalScoring;
      })
    ) {
      var scores = rows.map(function (row) {
          return promptTemplateWorldInfoScore(source, promptTemplateSelectionEntry(row), char);
        }),
        scoreTop = Math.max.apply(Math, scores);
      if (scoreTop) {
        matched.push(
          rows[
            Math.max(
              scores.findIndex(function (score) {
                return score >= scoreTop;
              }),
              0
            )
          ]
        );
        return;
      }
    }
    var weighted = rows.filter(function (row) {
        return !row.groupOverride && !row.useGroupScoring;
      }),
      total = weighted.reduce(function (sum, row) {
        return sum + Number(row.groupWeight ?? 100);
      }, 0),
      roll = Math.floor(random() * Math.max(1, total)) + 1;
    for (var i = 0; i < weighted.length; i++) {
      roll -= Number(weighted[i].groupWeight ?? 100);
      if (roll <= 0) {
        matched.push(weighted[i]);
        break;
      }
    }
  });
  return ungrouped.concat(matched).sort(promptTemplateWorldInfoSort(ungrouped.concat(matched)));
}
function promptTemplateSelectActivated(transaction, text, condition, entries) {
  return promptTemplateSelectActivatedEntries(
    transaction.char,
    entries || promptTemplateEnabledWorldInfoEntries(transaction.char, transaction.session),
    text == null
      ? (transaction.session.msgs || []).map(function (row) {
          return String((row && row.content) || '');
        })
      : text,
    condition,
    transaction.env.random
  );
}
function promptTemplateActivateEntry(transaction, world, uid, force) {
  if (typeof uid === 'boolean' || uid === undefined) {
    force = typeof uid === 'boolean' ? uid : force;
    uid = world;
    world = undefined;
  }
  var entry = promptTemplateWorldEntry(transaction.char, world, uid, transaction.session);
  if (!entry) return null;
  var key = promptTemplateWorldEntryKey(entry);
  transaction.forcedEntries.set(key, { entry: cloneData(entry), force: force === true });
  if (
    !transaction.activated.some(function (row) {
      return promptTemplateWorldEntryKey(row) === key;
    })
  )
    transaction.activated.push(cloneData(entry));
  return cloneData(entry);
}
function promptTemplateActivateByKeywords(transaction, text, condition) {
  condition = objectRecord(condition) || {};
  var rows = promptTemplateSelectActivated(transaction, text, condition);
  rows.forEach(function (entry) {
    promptTemplateActivateEntry(
      transaction,
      entry._catName,
      promptTemplateOfficialUid(entry),
      condition.force === true
    );
  });
  return rows.map(cloneData);
}
function promptTemplateMessageRole(message) {
  var role = String((message && message.role) || '');
  return role === 'user' || role === 'assistant' || role === 'system' ? role : 'system';
}
function promptTemplateMacroResult(value, char, random) {
  if (typeof replaceCharacterMacros !== 'function') return String(value == null ? '' : value);
  var state = typeof characterMacroStateForChar === 'function' ? characterMacroStateForChar(char) : undefined;
  if (state && typeof random === 'function') state.random = random;
  return replaceCharacterMacros(String(value == null ? '' : value), char,
    typeof displayName === 'function' ? displayName('user') : '用户', state);
}
function promptTemplateChatText(char, session, message, index) {
  if (!message) return '';
  var content = message.content;
  if (Array.isArray(content))
    content = content
      .filter(function (part) {
        return part && part.type === 'text';
      })
      .map(function (part) {
        return String(part.text || '');
      })
      .join('\n');
  var value = String(content == null ? '' : content);
  if (typeof applyRegexScriptsToText === 'function')
    value = applyRegexScriptsToText(value, promptTemplateMessageRole(message), 'send', char, {
      depth: Math.max(0, (session.msgs || []).length - index - 1),
    }).text;
  if (typeof replaceCharacterMacros === 'function')
    value = replaceCharacterMacros(
      value,
      char,
      typeof displayName === 'function' ? displayName('user') : '用户',
      typeof characterMacroStateForChar === 'function' ? characterMacroStateForChar(char) : undefined
    );
  return String(value == null ? '' : value);
}
function promptTemplateChatMessages(char, session, startOrCount, endOrRole, role) {
  var messages = (session && Array.isArray(session.msgs) ? session.msgs : []).map(function (message, index) {
      return { message: message, index: index };
    }),
    filter = function (value) {
      return !value
        ? messages
        : messages.filter(function (row) {
            return promptTemplateMessageRole(row.message) === value;
          });
    },
    selected = [];
  if (arguments.length < 3) startOrCount = messages.length;
  if (endOrRole == null) {
    if (startOrCount > 0) selected = messages.slice(0, startOrCount);
    else if (startOrCount < 0) selected = messages.slice(startOrCount);
  } else if (typeof endOrRole === 'string') {
    var byRole = filter(endOrRole);
    if (startOrCount > 0) selected = byRole.slice(0, startOrCount);
    else if (startOrCount < 0) selected = byRole.slice(startOrCount);
  } else if (typeof endOrRole === 'number' && (startOrCount > 0 || startOrCount < 0))
    selected = filter(role).slice(startOrCount, endOrRole);
  return selected.map(function (row) {
    return promptTemplateChatText(char, session, row.message, row.index);
  });
}
function promptTemplateChatMessage(char, session, index, role) {
  var messages = (session && Array.isArray(session.msgs) ? session.msgs : [])
      .map(function (message, at) {
        return { message: message, index: at };
      })
      .filter(function (row) {
        return !role || promptTemplateMessageRole(row.message) === role;
      }),
    at = index > -1 ? index : messages.length + index,
    row = messages[at];
  return row ? promptTemplateChatText(char, session, row.message, row.index) : '';
}
function promptTemplateMatchChatMessages(char, session, pattern, options) {
  options = objectRecord(options) || {};
  var messages = promptTemplateChatMessages(char, session, options.start ?? -2, options.end, options.role),
    patterns = Array.isArray(pattern) ? pattern : [pattern];
  return messages.some(function (message) {
    return options.and === true
      ? patterns.every(function (value) {
          return message.match(value) != null;
        })
      : patterns.some(function (value) {
          return message.match(value) != null;
        });
  });
}
function promptTemplateInjectionUid(key, prompt) {
  var value = String(key || '') + '#' + String(prompt || ''),
    hash = 0xdeadbeef;
  for (var i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 2654435761);
  return String(hash >>> 0);
}
function promptTemplateInject(transaction, key, prompt, order, sticky, uid) {
  key = String(key || '');
  if (!transaction.injections.has(key)) transaction.injections.set(key, new Map());
  uid = String(uid || promptTemplateInjectionUid(key, prompt));
  var row = {
      prompt: String(prompt || ''),
      order: order == null ? 100 : Number(order) || 0,
      sticky: Math.max(0, Number(sticky) || 0),
      uid: uid,
    },
    ownerKey = promptTemplateOwnerKey(transaction.char, transaction.session);
  transaction.injections.get(key).set(uid, row);
  if (transaction.preview) return;
  if (!_promptTemplateStickyInjections.has(ownerKey)) _promptTemplateStickyInjections.set(ownerKey, new Map());
  var owner = _promptTemplateStickyInjections.get(ownerKey);
  if (!owner.has(key)) owner.set(key, new Map());
  if (!transaction.injectionWrites) {
    transaction.injectionWrites = [];
    // Generation may already have committed its variables while the request still waits.
    if (transaction.signal)
      transaction.signal.addEventListener(
        'abort',
        function () {
          promptTemplateCancelTransaction(transaction);
        },
        { once: true }
      );
  }
  var stored = owner.get(key),
    written = cloneData(row);
  transaction.injectionWrites.push({
    owner: owner,
    key: key,
    stored: stored,
    uid: uid,
    previous: stored.get(uid),
    written: written,
  });
  stored.set(uid, written);
}
function promptTemplateRollbackInjections(transaction) {
  var ownerKey = promptTemplateOwnerKey(transaction.char, transaction.session);
  (transaction.injectionWrites || [])
    .slice()
    .reverse()
    .forEach(function (write) {
      if (write.stored.get(write.uid) !== write.written) return;
      if (write.previous) write.stored.set(write.uid, write.previous);
      else write.stored.delete(write.uid);
      if (!write.stored.size) write.owner.delete(write.key);
      if (!write.owner.size && _promptTemplateStickyInjections.get(ownerKey) === write.owner)
        _promptTemplateStickyInjections.delete(ownerKey);
    });
  transaction.injectionWrites = [];
}
function promptTemplateDeactivateInjections(transaction) {
  if (transaction.preview) return;
  if (transaction.injectionsReleased || transaction.cancelled) return;
  transaction.injectionsReleased = true;
  var ownerKey = promptTemplateOwnerKey(transaction.char, transaction.session),
    owner = _promptTemplateStickyInjections.get(ownerKey);
  if (!owner) return;
  transaction.injections.forEach(function (rows, key) {
    var stored = owner.get(key);
    if (!stored) return;
    rows.forEach(function (_, uid) {
      var row = stored.get(uid);
      if (!row) return;
      row.sticky = Number(row.sticky || 0) - 1;
      if (row.sticky < 0) stored.delete(uid);
    });
    if (!stored.size) owner.delete(key);
  });
  if (!owner.size) _promptTemplateStickyInjections.delete(ownerKey);
}
function promptTemplateInjected(transaction, key, postprocess, outlet) {
  key = String(key || '');
  if (outlet === true && !(Array.isArray(postprocess) && postprocess.length))
    return '{{outletPromptsInjected:' + key + '}}';
  var map = transaction.injections.get(key),
    value = map
      ? Array.from(map.values())
          .sort(function (a, b) {
            return a.order - b.order;
          })
          .map(function (row) {
            return row.prompt;
          })
          .join('\n')
      : '';
  (Array.isArray(postprocess) ? postprocess : []).forEach(function (row) {
    if (row && row.search !== undefined) value = value.replace(row.search, row.replace == null ? '' : row.replace);
  });
  return value;
}
function promptTemplateApplyInjected(transaction, value) {
  var output = String(value == null ? '' : value);
  for (var count = 0; count < 16 && output.indexOf('{{outletPromptsInjected:') >= 0; count++)
    output = output.replace(/\{\{outletPromptsInjected:(.+?)\}\}/g, function (_, key) {
      return promptTemplateInjected(transaction, key);
    });
  return output;
}
async function promptTemplateExecuteRun(command, owner, abort, nested) {
  if (typeof executeStscript !== 'function') throw new Error('STScript 运行时不可用');
  if (typeof stscriptBeginRun === 'function') stscriptBeginRun({ nested: nested, owner: owner });
  try {
    var result = await executeStscript(String(command || ''), {
      abortController: abort,
      handleParserErrors: false,
      handleExecutionErrors: false,
      source: 'prompt-template',
    });
    if (typeof stscriptFlushVars === 'function') await stscriptFlushVars();
    return String(result && result.pipe !== undefined ? result.pipe : result == null ? '' : result);
  } finally {
    if (typeof stscriptEndRun === 'function') stscriptEndRun();
  }
}
// Host STScript remains a dry-run placeholder; card network effects run normally.
function promptTemplatePreviewSkipped(transaction, label) {
  var marker = '[预览未执行：EJS ' + label + ']',
    notes = transaction.env.previewNotes;
  if (notes && !notes.includes(marker)) notes.push(marker);
  return marker;
}
// A request occupies its own sequence slot, even when two calls have identical arguments.
// Only clonable, finite response bodies are replayed. Native clones retain URL/status/headers and body errors;
// neither capture nor replay drains the response before handing it to the template.
function promptTemplateNetworkRequestKey(request, body) {
  var bodyKey = null;
  if (request.body) {
    if (typeof body === 'string') bodyKey = body;
    else if (!(body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body))) return null;
  }
  var fields = [
    request.url,
    request.method,
    Array.from(request.headers),
    request.mode,
    request.credentials,
    request.cache,
    request.redirect,
    request.referrer,
    request.referrerPolicy,
    request.integrity,
    request.keepalive,
  ];
  if (request.body && typeof body !== 'string')
    return request.clone().arrayBuffer().then(function (bytes) {
      return JSON.stringify(fields.concat([Array.from(new Uint8Array(bytes))]));
    });
  return Promise.resolve(JSON.stringify(fields.concat([bodyKey])));
}
function promptTemplateNetwork(transaction) {
  var host = globalThis,
    nativeFetch = typeof host.fetch === 'function' ? host.fetch.bind(host) : null,
    run = transaction.env.networkRun && transaction.env.networkRun.key !== null ? transaction.env.networkRun : null,
    shadows = {};
  if (nativeFetch)
    shadows.fetch = async function (input, init) {
      if (transaction.cancelled || (transaction.signal && transaction.signal.aborted))
        throw cardFrontendAbortError('EJS 模板');
      // Let the native dictionary conversion read each caller property once, including inherited/non-enumerable
      // fields and one-shot HeadersInit. The observer only remembers values for replay eligibility.
      var observed = {},
        options =
          run && init != null && (typeof init === 'object' || typeof init === 'function')
            ? new Proxy(init, {
                get: function (target, name) {
                  var value = Reflect.get(target, name, target);
                  if (name === 'body' || name === 'signal') observed[name] = value;
                  return value;
                },
              })
            : init,
        request = new Request(input, options),
        slot = run ? run.cursor++ : -1,
        signals = [transaction.signal, request.signal].filter(Boolean),
        signal = signals[0],
        keyPromise = null;
      if (run && (typeof input === 'string' || input instanceof URL) && !observed.signal) {
        try {
          keyPromise = promptTemplateNetworkRequestKey(request, observed.body);
          if (keyPromise)
            keyPromise = keyPromise.catch(function () {
              return null;
            });
        } catch (_) {
          // A signature failure must never retry the caller's already-normalized parameters.
        }
      }
      if (signals.length > 1) {
        var controller = new AbortController();
        signals.forEach(function (source) {
          if (source.aborted) controller.abort(source.reason);
          else
            source.addEventListener(
              'abort',
              function () {
                controller.abort(source.reason);
              },
              { once: true }
            );
        });
        signal = controller.signal;
      }
      if (signal && signal.aborted) throw signal.reason;
      var cached = run && run.replay && run.source[slot];
      if (run && run.replay) {
        // Finite upload signatures may finish out of order. Compare slots in invocation order so a
        // mismatch also prevents later slots from replaying, without serializing native requests.
        var match = (run.replayCheck || Promise.resolve()).then(async function () {
          var key = keyPromise ? await keyPromise : null,
            reusable = run.replay && run.active && !transaction.cancelled && cached && key !== null && cached.key === key;
          if (!reusable) run.replay = false;
          return reusable;
        });
        run.replayCheck = match;
        if (cached && keyPromise) {
          var reusable = await match;
          if (transaction.cancelled) throw cardFrontendAbortError('EJS 模板');
          if (signal && signal.aborted) throw signal.reason;
          if (reusable) {
            var replay = cached.response.clone();
            run.entries[slot] = cached;
            return replay;
          }
        }
      }
      // New requests start in this task; finite-body signature capture runs alongside the native request.
      var response = await nativeFetch(request, signal ? { signal: signal } : undefined);
      if (
        run &&
        run.active &&
        !transaction.cancelled &&
        keyPromise &&
        response.type !== 'opaque' &&
        response.type !== 'opaqueredirect' &&
        !response.bodyUsed &&
        !(response.body && response.body.locked) &&
        !/event-stream|ndjson|json-seq/i.test(response.headers.get('content-type') || '')
      ) {
        var captured = response.clone();
        Promise.all([keyPromise, captured.body ? captured.clone().arrayBuffer() : null]).then(
          function (values) {
            if (values[0] !== null && run.active && !transaction.cancelled && !(signal && signal.aborted))
              run.entries[slot] = { key: values[0], response: captured };
          },
          function () {
            /* A failed body is delivered by the native response, never cached as a success. */
          }
        );
      }
      return response;
    };
  ['XMLHttpRequest', 'WebSocket', 'EventSource'].forEach(function (name) {
    var Native = host[name];
    if (typeof Native !== 'function') return;
    shadows[name] = new Proxy(Native, {
      construct: function (target, args, newTarget) {
        if (transaction.cancelled) throw cardFrontendAbortError('EJS 模板');
        var resource = Reflect.construct(target, args, newTarget),
          signal = transaction.signal;
        if (signal) {
          var cancel = function () {
              if (name === 'XMLHttpRequest') resource.abort();
              else resource.close();
            },
            release = function () {
              // A load handler may already have started the next XHR before the old loadend fires.
              if (name === 'XMLHttpRequest' && resource.readyState !== 0 && resource.readyState !== 4) return;
              signal.removeEventListener('abort', cancel);
            };
          if (signal.aborted) cancel();
          else signal.addEventListener('abort', cancel, { once: true });
          if (typeof resource.addEventListener === 'function') {
            if (name === 'XMLHttpRequest') {
              // XHR instances can start another request after loadend removed the previous listener.
              resource.addEventListener('loadstart', function () {
                if (signal.aborted) cancel();
                else signal.addEventListener('abort', cancel, { once: true });
              });
              resource.addEventListener('loadend', release);
            } else resource.addEventListener('close', release, { once: true });
          }
        }
        return resource;
      },
    });
  });
  // This facade is local to EJS locals. Host fetch, modules, DOM resources and navigation are untouched.
  var facade = new Proxy(host, {
    get: function (target, key) {
      if (key === 'window' || key === 'globalThis' || key === 'self') return facade;
      if (Object.prototype.hasOwnProperty.call(shadows, key)) return shadows[key];
      var value = Reflect.get(target, key, target);
      if (value === host) return facade;
      // Window methods require their original receiver; constructors retain native identity and static fields.
      return typeof value === 'function' && !value.prototype ? value.bind(target) : value;
    },
  });
  shadows.window = shadows.globalThis = shadows.self = facade;
  return shadows;
}
async function promptTemplateExecute(command, transaction) {
  if (transaction.preview) return promptTemplatePreviewSkipped(transaction, '中的 STScript');
  return promptTemplateWithTransactionLock(transaction, async function () {
    await promptTemplateFlush(transaction, false);
    var before = promptTemplateCanonicalSnapshot(transaction),
      owner = {
        charId: String((transaction.char && transaction.char.id) || ''),
        sessionId: String((transaction.session && transaction.session.id) || ''),
      },
      currentRun = typeof _qrTop === 'object' ? _qrTop : null,
      sameRun = transaction.stscriptRunToken && transaction.stscriptRunToken === currentRun;
    try {
      if (sameRun && typeof _stscriptVarNest === 'number' && _stscriptVarNest > 0)
        return await promptTemplateExecuteRun(command, owner, currentRun.abort, true);
      if (typeof qrRunTop === 'function') {
        var abort = typeof StscriptAbortController === 'function' ? new StscriptAbortController() : null;
        return await qrRunTop(
          function (runAbort, runOwner) {
            return promptTemplateExecuteRun(command, runOwner, runAbort, false);
          },
          abort,
          owner
        );
      }
      return await promptTemplateExecuteRun(command, owner, null, false);
    } finally {
      promptTemplateRebaseAfterExternal(transaction, before);
    }
  });
}
function promptTemplateScopedEjsTemplate(transaction) {
  var facade = Object.create(EjsTemplate);
  Object.keys(EjsTemplate).forEach(function (key) {
    if (typeof EjsTemplate[key] !== 'function') return;
    facade[key] = function () {
      if (transaction.cancelled) throw cardFrontendAbortError('EJS 模板');
      return EjsTemplate[key].apply(this, arguments);
    };
  });
  facade.saveVariables = async function (context) {
    var target = (context && _promptTemplatePublicTransactions.get(context)) || transaction;
    return promptTemplateSaveTransaction(target, false);
  };
  // Explicit contexts and evalTemplate's implicit context keep the parent's owner and network lifetime.
  facade.prepareContext = function (env, messageId) {
    if (transaction.cancelled) throw cardFrontendAbortError('EJS 模板');
    var next = Object.assign({}, objectRecord(env) || {}, {
      signal: transaction.signal,
      networkRun: transaction.env.networkRun,
    });
    if (transaction.preview) {
      next.preview = true;
      next.previewNotes = transaction.env.previewNotes;
    }
    return promptTemplatePrepareContextFor(transaction.char, transaction.session, next, messageId);
  };
  facade.evalTemplate = async function (content, data, options) {
    if (transaction.cancelled) throw cardFrontendAbortError('EJS 模板');
    return EjsTemplate.evalTemplate(content, data == null ? await facade.prepareContext() : data, options);
  };
  if (transaction.preview) {
    // A preview cannot change template features.
    facade.setFeatures = facade.resetFeatures = function () {
      return promptTemplateFeatureSnapshot();
    };
  }
  return facade;
}
async function promptTemplateContext(transaction, env) {
  if (!transaction.contextPromise) {
    transaction.contextPromise = promptTemplateCreateContext(transaction, env);
    return transaction.contextPromise;
  }
  var context = await transaction.contextPromise,
    next = Object.assign({}, env || {});
  if (next.world_info && next.world_info._catName) next.world_info = promptTemplateWorldInfoOfficial(next.world_info);
  Object.keys(next).forEach(function (key) {
    if (typeof context[key] !== 'function') context[key] = next[key];
  });
  return context;
}
async function promptTemplateCreateContext(transaction, env) {
  if (!transaction.preview) promptTemplateSelectRegexOwner(transaction.char, transaction.session);
  var char = transaction.char || {},
    session = transaction.session || {},
    rows = promptTemplateChatRows(char, session),
    user = typeof displayName === 'function' ? displayName('user') : '用户',
    assistant = typeof canonicalCharacterName === 'function' ? canonicalCharacterName(char) : String(char.name || ''),
    context = {},
    finalEnv = Object.assign({}, env || {});
  if (finalEnv.world_info && finalEnv.world_info._catName)
    finalEnv.world_info = promptTemplateWorldInfoOfficial(finalEnv.world_info);
  Object.assign(context, finalEnv);
  function scoped(scope, operation) {
    return function (key, value, options) {
      options = Object.assign(promptTemplateVariableOptions(options), { scope: scope });
      return operation(transaction, key, value, options);
    };
  }
  function read(scope) {
    return function (key, options) {
      return promptTemplateGetVariable(
        transaction,
        key,
        Object.assign(promptTemplateVariableOptions(options), { scope: scope })
      );
    };
  }
  function change(scope, direction) {
    return function (key, value, options) {
      return promptTemplateChangeVariable(
        transaction,
        key,
        value === undefined ? 1 : value,
        Object.assign(promptTemplateVariableOptions(options), { outscope: scope }),
        direction
      );
    };
  }
  function remove(scope) {
    return function (key, index, options) {
      if (
        options === undefined &&
        (objectRecord(index) ||
          typeof index === 'boolean' ||
          (typeof index === 'string' &&
            [
              'old',
              'new',
              'fullcache',
              'nx',
              'xx',
              'nxs',
              'xxs',
              'n',
              'cache',
              'global',
              'local',
              'message',
              'initial',
            ].includes(index)))
      ) {
        options = index;
        index = undefined;
      }
      return promptTemplateDeleteVariable(
        transaction,
        key,
        index,
        Object.assign(promptTemplateVariableOptions(options), { scope: scope })
      );
    };
  }
  function insert(scope) {
    return function (key, value, index, options) {
      return promptTemplateInsertVariable(
        transaction,
        key,
        value,
        index,
        Object.assign(promptTemplateVariableOptions(options), { scope: scope })
      );
    };
  }
  Object.assign(context, {
    _: typeof YeyuMvuVendor === 'object' ? YeyuMvuVendor._ : window._,
    $: window.jQuery || window.$,
    z: typeof YeyuMvuVendor === 'object' ? YeyuMvuVendor.z : window.z,
    toastr:
      transaction.preview
        ? { success: function () {}, error: function () {}, warning: function () {}, info: function () {} }
        : promptTemplateToast(),
    console: console,
    getCharaData: function (name) {
      return promptTemplateCharacterData(promptTemplateFindCharacter(char, name));
    },
    getCharData: function (name) {
      return context.getCharaData(name);
    },
    getWorldInfoData: async function (name) {
      return promptTemplateWorldInfoData(
        char,
        name === undefined ? promptTemplateDefaultWorldInfoName(char, session) : name
      )
        .map(promptTemplateWorldInfoOfficial)
        .sort(
          promptTemplateWorldInfoSort(
            promptTemplateWorldInfoData(
              char,
              name === undefined ? promptTemplateDefaultWorldInfoName(char, session) : name
            ).map(promptTemplateWorldInfoOfficial)
          )
        );
    },
    getQuickReplyData: function (name) {
      return promptTemplateQuickReplyData(char, session, name);
    },
    getWorldInfoActivatedData: async function (name, keyword, condition) {
      return promptTemplateSelectActivated(
        transaction,
        keyword,
        condition,
        promptTemplateWorldInfoData(char, name)
      ).map(promptTemplateWorldInfoOfficial);
    },
    getEnabledWorldInfoEntries: async function (chara, global, persona, charaExtra, chat, onlyExisting) {
      var entries = promptTemplateEnabledWorldInfoEntries(
        char,
        session,
        chara,
        global,
        persona,
        charaExtra,
        chat,
        onlyExisting
      ).map(promptTemplateWorldInfoOfficial);
      return entries.sort(promptTemplateWorldInfoSort(entries));
    },
    selectActivatedEntries: function (entries, keyword, condition) {
      return promptTemplateSelectActivatedEntries(char, entries, keyword, condition, transaction.env.random);
    },
    activewi: async function (world, uid, force) {
      var row = promptTemplateActivateEntry(transaction, world, uid, force);
      return row ? promptTemplateWorldInfoOfficial(row) : null;
    },
    activateWorldInfo: async function (world, uid, force) {
      var row = promptTemplateActivateEntry(transaction, world, uid, force);
      return row ? promptTemplateWorldInfoOfficial(row) : null;
    },
    getChatMessage: function (id, role) {
      return promptTemplateChatMessage(char, session, Number(id) || 0, role);
    },
    getChatMessages: function (startOrCount, endOrRole, role) {
      if (arguments.length === 0) return promptTemplateChatMessages(char, session);
      if (arguments.length === 1) return promptTemplateChatMessages(char, session, startOrCount);
      if (arguments.length === 2) return promptTemplateChatMessages(char, session, startOrCount, endOrRole);
      return promptTemplateChatMessages(char, session, startOrCount, endOrRole, role);
    },
    activateRegex: function (pattern, replace, options) {
      var previous = _promptTemplateRegexRevision;
      promptTemplateActivateRegex(pattern, replace, options, promptTemplateRegexTable(transaction));
      if (transaction.renderRevision === previous) transaction.renderRevision = _promptTemplateRegexRevision;
    },
    injectPrompt: function (key, prompt, order, sticky, uid) {
      promptTemplateInject(transaction, key, prompt, order == null ? 100 : order, sticky, uid);
    },
    getPromptsInjected: function (key, postprocess, outlet) {
      return promptTemplateInjected(transaction, key, postprocess, outlet);
    },
    activateWorldInfoByKeywords: async function (text, condition) {
      return promptTemplateActivateByKeywords(transaction, text, condition).map(promptTemplateWorldInfoOfficial);
    },
    getEnabledLoreBooks: function (chara, global, persona, charaExtra, chat, onlyExisting) {
      return promptTemplateEnabledLoreBooks(char, session, chara, global, persona, charaExtra, chat, onlyExisting);
    },
    hasPromptsInjected: function (key) {
      return transaction.injections.has(String(key || ''));
    },
    matchChatMessages: function (pattern, options) {
      return promptTemplateMatchChatMessages(char, session, pattern, options);
    },
    jsonPatch: promptTemplateJsonPatch,
    parseJSON: promptTemplateParseJSON,
    setVariableSchema: function (schema) {
      transaction.variableSchema = schema;
      return schema;
    },
    get variables() {
      return promptTemplateVariablesView(transaction);
    },
    execute: function (command) {
      return promptTemplateExecute(command, transaction);
    },
    get SillyTavern() {
      return typeof cardFrontendSillyTavernContext === 'function'
        ? cardFrontendSillyTavernContext(char, session)
        : { chat: rows };
    },
    faker: await promptTemplateLoadFaker(),
    userName: user,
    assistantName: assistant,
    charName: assistant,
    chatId: String(session.id || ''),
    characterId: String(char.id || ''),
    charAvatar: promptAvatarSrc('char', char),
    userAvatar: promptAvatarSrc('user', char),
    charLoreBook: String((char.extensions && char.extensions.world) || ''),
    userLoreBook: promptTemplatePersonaWorld(char),
    chatLoreBook: String(session.tavernHelperChatLorebook || ''),
    get lastUserMessageId() {
      for (var i = session.msgs.length - 1; i >= 0; i--)
        if (session.msgs[i] && session.msgs[i].role === 'user') return i;
      return -1;
    },
    get lastUserMessage() {
      var id = context.lastUserMessageId;
      return id >= 0 ? String(session.msgs[id].content || '') : '';
    },
    get lastCharMessageId() {
      for (var i = session.msgs.length - 1; i >= 0; i--)
        if (session.msgs[i] && session.msgs[i].role === 'assistant') return i;
      return -1;
    },
    get lastCharMessage() {
      var id = context.lastCharMessageId;
      return id >= 0 ? String(session.msgs[id].content || '') : '';
    },
    get lastMessageId() {
      return session.msgs.length - 1;
    },
    get model() {
      return promptTemplateModel(transaction.env.promptSettings);
    },
  });
  context.getwi = context.getWorldInfo = async function (book, entry, data) {
    if (objectRecord(entry) && !promptTemplateRegex(entry)) {
      data = entry;
      entry = book;
      book = undefined;
    }
    var row = promptTemplateWorldEntry(char, book, entry, session);
    if (!row) return '';
    return promptTemplateTrackedEvaluation(transaction, async function () {
      promptTemplateMergeContext(context, data || {});
      promptTemplateMergeContext(context, { world_info: promptTemplateWorldInfoOfficial(row) });
      var source = String(row.content || '');
      if (typeof applyRegexScriptsToText === 'function')
        source = applyRegexScriptsToText(source, 'worldbook', 'send', char).text;
      source = promptTemplateMacroResult(source, char, transaction.env.random);
      return promptTemplateEval(source, context, { when: promptTemplateEntryLabel(row) });
    });
  };
  context.getchr =
    context.getchar =
    context.getChara =
      async function (name, template, data) {
        var found = promptTemplateFindCharacter(char, name);
        if (!found) return '';
        return promptTemplateTrackedEvaluation(transaction, async function () {
          if (objectRecord(template)) {
            data = template;
            template = PROMPT_TEMPLATE_DEFAULT_CHAR_DEFINE;
          }
          promptTemplateMergeContext(context, data || {});
          promptTemplateMergeContext(context, promptTemplateCharacterDefine(found));
          promptTemplateMergeContext(context, { chara_name: String(found.name || '') });
          var value = await promptTemplateEval(
            String(template == null ? PROMPT_TEMPLATE_DEFAULT_CHAR_DEFINE : template),
            context,
            { when: String(found.name || name || '') }
          );
          if (isRisuCharacter(found)) {
            var sourceSession = getActiveSession(found.id);
            return risuRenderCBSInWorker(value, found, session, {
              contextSession: sourceSession,
              state: createRisuMacroState(found, sourceSession),
              userName: typeof displayName === 'function' ? displayName('user') : '用户',
            });
          }
          return typeof replaceCharacterMacros === 'function'
            ? replaceCharacterMacros(value, found, typeof displayName === 'function' ? displayName('user') : '用户')
            : value;
        });
      };
  context.getprp =
    context.getpreset =
    context.getPresetPrompt =
      async function (name, data) {
        return promptTemplateTrackedEvaluation(transaction, async function () {
          promptTemplateMergeContext(context, data || {});
          promptTemplateMergeContext(context, { prompt_name: name });
          return promptTemplateMacroResult(
            await promptTemplateEval(promptTemplatePresetPrompt(name), context, { when: String(name || '') }),
            char, transaction.env.random
          );
        });
      };
  context.getqr = context.getQuickReply = async function (name, label, data) {
    var link = promptTemplateQuickReplyData(char, session, name),
      set = link && link.set,
      reply =
        set && Array.isArray(set.qrList)
          ? set.qrList.find(function (row) {
              return promptTemplateMatches(row.label || row.id, label);
            })
          : null;
    if (!reply) return '';
    return promptTemplateTrackedEvaluation(transaction, async function () {
      promptTemplateMergeContext(context, data || {});
      promptTemplateMergeContext(context, { qr_name: name, qr_label: label });
      return promptTemplateMacroResult(
        await promptTemplateEval(String(reply.message || reply.text || ''), context, {
          when: String(name || '') + '.' + String(label || ''),
        }),
        char, transaction.env.random
      );
    });
  };
  // A preview's definitions stay on its own context.
  context.define = function (name, value, merge) {
    var defines = transaction.preview ? context : _promptTemplateDefines,
      old = promptTemplateGet(defines, name);
    if (merge) {
      if (Array.isArray(value)) value = (Array.isArray(old) ? cloneData(old) : []).concat(cloneData(value));
      else if (objectRecord(value)) value = promptTemplateMerge(objectRecord(old) || {}, value);
    }
    if (!transaction.preview) promptTemplateSet(_promptTemplateDefines, name, value);
    promptTemplateSet(context, name, value);
    return old;
  };
  Object.assign(context, promptTemplateNetwork(transaction));
  context.setvar = function (key, value, options) {
    return promptTemplateSetVariable(transaction, key, value, options);
  };
  context.setLocalVar = scoped('local', promptTemplateSetVariable);
  context.setGlobalVar = scoped('global', promptTemplateSetVariable);
  context.setMessageVar = scoped('message', promptTemplateSetVariable);
  context.getvar = function (key, options) {
    return promptTemplateGetVariable(transaction, key, options);
  };
  context.getLocalVar = read('local');
  context.getGlobalVar = read('global');
  context.getMessageVar = read('message');
  context.incvar = function (key, value, options) {
    return promptTemplateChangeVariable(transaction, key, value === undefined ? 1 : value, options, 1);
  };
  context.incLocalVar = change('local', 1);
  context.incGlobalVar = change('global', 1);
  context.incMessageVar = change('message', 1);
  context.decvar = function (key, value, options) {
    return promptTemplateChangeVariable(transaction, key, value === undefined ? 1 : value, options, -1);
  };
  context.decLocalVar = change('local', -1);
  context.decGlobalVar = change('global', -1);
  context.decMessageVar = change('message', -1);
  context.patchVariables = function (key, change, options) {
    options = promptTemplateVariableOptions(options);
    var operations = typeof change === 'string' ? promptTemplateParseJSON(change) : change;
    if (!Array.isArray(operations)) throw new Error('JSON Patch 必须是操作数组');
    var next = promptTemplateJsonPatch(promptTemplateGetVariable(transaction, key, options), operations);
    return promptTemplateSetVariable(transaction, key, next, options);
  };
  context.applyVarYamlAnnotate = function (key) {
    var value = key == null ? promptTemplateRefreshVariables(transaction) : promptTemplateGetVariable(transaction, key);
    return promptTemplateYaml().stringifyYaml(value);
  };
  context.evalTemplate = async function (content, data, options) {
    return promptTemplateTrackedEvaluation(transaction, async function () {
      promptTemplateMergeContext(context, data || {});
      return promptTemplateMacroResult(await promptTemplateEval(content, context, { options: options || {} }), char, transaction.env.random);
    });
  };
  context.findVariables = function (key, messageId) {
    return promptTemplateFindVariables(transaction, key, messageId == null ? session.msgs.length : messageId);
  };
  context.delvar = function (key, index, options) {
    return promptTemplateDeleteVariable(transaction, key, index, options);
  };
  context.delLocalVar = remove('local');
  context.delGlobalVar = remove('global');
  context.delMessageVar = remove('message');
  context.insvar = function (key, value, index, options) {
    return promptTemplateInsertVariable(transaction, key, value, index, options);
  };
  context.insertLocalVar = insert('local');
  context.insertGlobalVar = insert('global');
  context.insertMessageVar = insert('message');
  context.EjsTemplate = promptTemplateScopedEjsTemplate(transaction);
  // Guard only host-owned effects; library placeholders and user definitions rely on identity.
  [
    'activewi',
    'activateWorldInfo',
    'activateWorldInfoByKeywords',
    'activateRegex',
    'injectPrompt',
    'setVariableSchema',
    'execute',
    'define',
    'setvar',
    'setLocalVar',
    'setGlobalVar',
    'setMessageVar',
    'incvar',
    'incLocalVar',
    'incGlobalVar',
    'incMessageVar',
    'decvar',
    'decLocalVar',
    'decGlobalVar',
    'decMessageVar',
    'patchVariables',
    'delvar',
    'delLocalVar',
    'delGlobalVar',
    'delMessageVar',
    'insvar',
    'insertLocalVar',
    'insertGlobalVar',
    'insertMessageVar',
  ].forEach(function (key) {
    var operation = context[key];
    context[key] = function () {
      if (transaction.cancelled) throw cardFrontendAbortError('EJS 模板');
      return operation.apply(this, arguments);
    };
  });
  // A generation's templates draw Math.random() from its round, so a preview and the send it shows compute the same
  // values. Only template code sees this Math; the page's own Math is untouched.
  if (typeof transaction.env.random === 'function')
    context.Math = Object.create(Math, { random: { value: transaction.env.random } });
  if (transaction.preview && transaction.env.previewNotes) _promptTemplatePreviewNotes.set(context, transaction.env.previewNotes);
  Object.keys(_promptTemplateDefines).forEach(function (key) {
    context[key] = _promptTemplateDefines[key];
  });
  if (typeof cardFrontendAwaitBroadcastEvent === 'function')
    await cardFrontendAwaitBroadcastEvent(
      'prompt_template_prepare',
      [context],
      transaction.preview
        ? { signal: transaction.signal, dryRun: true, previewNotes: transaction.env.previewNotes }
        : { signal: transaction.signal }
    );
  return context;
}

function promptTemplateCompileOptions(options) {
  options = objectRecord(options) || {};
  var nested = objectRecord(options.options) || {},
    escapeFunction =
      typeof options.escaper === 'function'
        ? options.escaper
        : function (markup) {
            return String(markup == null ? '' : markup);
          };
  return Object.assign(
    {
      async: true,
      client: true,
      _with: true,
      localsName: 'locals',
      outputFunctionName: 'print',
      escape: escapeFunction,
      includer: function (path) {
        return { filename: path, template: '' };
      },
    },
    nested
  );
}
async function promptTemplateCompile(content, options, data) {
  if (typeof ejs !== 'object' || !ejs || typeof ejs.compile !== 'function') throw new Error('EJS 3.1.9 未加载');
  return ejs.compile(String(content == null ? '' : content), promptTemplateCompileOptions(options), data || {});
}
async function promptTemplateEval(content, data, options) {
  if (typeof content !== 'string' || (content.indexOf('<%') < 0 && content.indexOf('&lt;%') < 0)) return content;
  if (data && typeof generationPromptNoteScriptRan === 'function')
    generationPromptNoteScriptRan(_promptTemplatePreviewNotes.get(data));
  var compile = await promptTemplateCompile(content, options, data),
    result = await compile.call(data || {}, data || {});
  return result == null ? '' : String(result);
}
function promptTemplateSyntaxErrorInfo(content, count) {
  try {
    if (typeof ejs !== 'object' || !ejs) throw new Error('EJS 3.1.9 未加载');
    ejs.compile(String(content || ''), promptTemplateCompileOptions({}));
    return '';
  } catch (error) {
    var lines = String(content || '').split('\n'),
      match = String((error && error.message) || error).match(/:(\d+)\s*$/m),
      line = match ? Number(match[1]) : 1,
      span = Math.max(1, Number(count) || 4),
      from = Math.max(0, line - span),
      to = Math.min(lines.length, line + span);
    return (
      String((error && error.message) || error) +
      '\n' +
      lines
        .slice(from, to)
        .map(function (value, index) {
          return (from + index + 1 === line ? '> ' : '  ') + (from + index + 1) + ' | ' + value;
        })
        .join('\n')
    );
  }
}

// The main page has no YAML global; the MVU vendor loaded at startup carries the YAML implementation.
function promptTemplateYaml() {
  if (typeof YeyuMvuVendor !== 'object' || !YeyuMvuVendor || typeof YeyuMvuVendor.parseYaml !== 'function')
    throw new Error('YAML 解析组件未加载');
  return YeyuMvuVendor;
}
function promptTemplateInitialVariablesError(entry, reason, error) {
  var message = '初始变量条目「' + promptTemplateEntryLabel(entry) + '」' + reason + '，已跳过';
  console.error('[Prompt Template] ' + message, error || '');
  promptTemplateToast().error(message);
}
async function promptTemplateLoadInitialEntries(transaction, entries, env) {
  transaction.initial = {};
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i],
      kind = promptTemplateSpecialKind(entry);
    if (kind !== 'initial_variables' || !promptTemplateEntryEnabled(entry)) continue;
    var context = await promptTemplateContext(transaction, Object.assign({}, env, { world_info: entry })),
      source = await promptTemplateEval(
        promptTemplateMacroResult(String(entry.content || ''), transaction.char, transaction.env.random),
        context,
        { when: promptTemplateEntryLabel(entry) }
      ),
      value = promptTemplateOptionalJSON(source);
    if (value === undefined)
      try {
        value = promptTemplateYaml().parseYaml(source);
      } catch (error) {
        promptTemplateInitialVariablesError(entry, '无法按 JSON 或 YAML 解析', error);
        continue;
      }
    if (!objectRecord(value)) {
      promptTemplateInitialVariablesError(entry, '内容必须是对象');
      continue;
    }
    transaction.initial = promptTemplateMerge(transaction.initial, value);
  }
  if (!transaction.preview) promptTemplateUpdateInitialOwner(transaction);
}
async function promptTemplatePrepareEntries(transaction) {
  if (transaction && isRisuCharacter(transaction.char)) {
    transaction.entries = [];
    transaction.initial = {};
    return [];
  }
  var entries = promptTemplateEnabledWorldInfoEntries(transaction.char, transaction.session),
    preparation = transaction.isDryRun && !transaction.preview,
    preloadEnv = preparation
      ? {
          runType: 'preparation',
          message_id: undefined,
          swipe_id: undefined,
          is_last: undefined,
          is_user: undefined,
          is_system: undefined,
          name: undefined,
          isDryRun: true,
          generateType: '',
        }
      : { runType: 'preload', generateType: transaction.env.generationType || transaction.env.generateType || '' };
  transaction.entries = entries;
  var ownerInitial = _promptTemplateInitialByOwner.get(promptTemplateOwnerKey(transaction.char, transaction.session));
  if (preparation || !ownerInitial) await promptTemplateLoadInitialEntries(transaction, entries, preloadEnv);
  else transaction.initial = cloneData(ownerInitial);
  if (preparation)
    entries.forEach(function (row) {
      transaction.processed.set(promptTemplateWorldEntryKey(row), { allowed: true, entry: Object.assign({}, row) });
    });
  else
    for (var at = 0; at < entries.length; at++) {
      var row = entries[at],
        enabled = promptTemplateEntryEnabled(row),
        kind = promptTemplateSpecialKind(row),
        contextRow = await promptTemplateContext(transaction, {
          runType: 'generate',
          world_info: row,
          generateType: transaction.env.generationType || transaction.env.generateType || '',
        }),
        condition = !kind ? promptTemplateDecoratorValue(row, 'if') : '',
        allowed = true;
      if (enabled && condition)
        try {
          allowed =
            String(
              await promptTemplateEval('<%- !!(' + condition + ') %>', contextRow, {
                when: promptTemplateEntryLabel(row) + '.if',
              })
            ).trim() === 'true';
        } catch (_) {
          allowed = false;
        }
      var processed = Object.assign({}, row),
        preprocess =
          !kind &&
          (promptTemplateHasDecorator(row, 'preprocessing') || promptTemplateCommentIncludes(row, '[Preprocessing]'));
      if (enabled && allowed && preprocess) {
        processed.content = await promptTemplateEval(
          promptTemplateApplyRegex(transaction, contextRow, promptTemplateWorldInfoSource(transaction, row, contextRow), 'generate'),
          contextRow,
          {
            when: promptTemplateEntryLabel(row),
          }
        );
        for (var keyField of ['keys', 'secondary_keys']) {
          processed[keyField] = [];
          for (var key of row[keyField] || [])
            processed[keyField].push(
              await promptTemplateEval(
                promptTemplateApplyRegex(transaction, contextRow, String(key || ''), 'generate'),
                contextRow,
                {
                  when: promptTemplateEntryLabel(row) + '.' + keyField,
                }
              )
            );
        }
      } else if (enabled && allowed && !kind && promptTemplateHasDecorator(row, 'private'))
        processed.content = '<% await (async()=>{%>' + String(row.content || '') + '<%})(); %>';
      transaction.processed.set(promptTemplateWorldEntryKey(row), { allowed: allowed, entry: processed });
      if (
        enabled &&
        allowed &&
        !kind &&
        (row.forceActivate || promptTemplateHasDecorator(row, 'activate')) &&
        !promptTemplateHasDecorator(row, 'dont_activate')
      )
        promptTemplateActivateEntry(transaction, row._catName, promptTemplateOfficialUid(row), true);
    }
  if (transaction.contextPromise)
    await promptTemplateContext(transaction, Object.assign({}, preloadEnv, { world_info: undefined }));
  var prompts = '';
  if (preparation && _promptTemplateFeatures.generate_loader)
    prompts += await promptTemplateEvalEntries(transaction, 'generate_before', preloadEnv, undefined, '', '');
  if (_promptTemplateFeatures.preload_worldinfo) {
    for (var preloadIndex = 0; preloadIndex < entries.length; preloadIndex++) {
      var preload = entries[preloadIndex],
        preloadHit = transaction.processed.get(promptTemplateWorldEntryKey(preload)),
        preloadEntry = (preloadHit && preloadHit.entry) || preload,
        preloadKind = promptTemplateSpecialKind(preloadEntry),
        shouldPreload =
          !promptTemplateHasDecorator(preloadEntry, 'dont_preload') &&
          (promptTemplateHasDecorator(preloadEntry, 'preload') ||
            preloadKind === 'only_preload' ||
            (!_promptTemplateFeatures.preload_only && !preloadKind));
      if (preloadHit && preloadHit.allowed && shouldPreload && promptTemplateEntryEnabled(preloadEntry)) {
        var preloadValue = await promptTemplateEval(
          promptTemplateMacroResult(String(preloadEntry.content || ''), transaction.char, transaction.env.random),
          await promptTemplateContext(transaction, Object.assign({}, preloadEnv, { world_info: preloadEntry })),
          { when: promptTemplateEntryLabel(preloadEntry) }
        );
        if (preparation && preloadValue != null) prompts += preloadValue;
      }
    }
  }
  if (preparation) {
    var define = promptTemplateCharacterDefine(transaction.char);
    if (define && (define.description || define.scenario))
      prompts += await promptTemplateEval(
        promptTemplateMacroResult(
          String(define.description || '') + '\n---\n' + String(define.scenario || ''),
          transaction.char, transaction.env.random
        ),
        await promptTemplateContext(transaction, preloadEnv),
        { when: 'preparation.character' }
      );
    if (_promptTemplateFeatures.generate_loader)
      await promptTemplateEvalEntries(transaction, 'generate_after', preloadEnv, undefined, prompts, '');
  }
  if (transaction.contextPromise)
    await promptTemplateContext(transaction, Object.assign({}, preloadEnv, { world_info: undefined }));
}
function promptTemplateWorldInfoRuntimeEntry(entry, run) {
  if (!_promptTemplateFeatures.enabled) return entry;
  var kind = promptTemplateSpecialKind(entry);
  if (kind) return null;
  if (promptTemplateHasDecorator(entry, 'only_preload')) return null;
  var transaction = run && run.transaction,
    hit = transaction && transaction.processed.get(promptTemplateWorldEntryKey(entry));
  if (hit && !hit.allowed) return null;
  var next = hit ? hit.entry : entry,
    forced = transaction && transaction.forcedEntries.get(promptTemplateWorldEntryKey(entry));
  if (promptTemplateHasDecorator(next, 'always_enabled')) next = Object.assign({}, next, { enabled: true });
  if (forced)
    next = Object.assign({}, next, {
      enabled: true,
      forceActivate: true,
      dontActivate: false,
      constant: forced.force ? true : next.constant,
      probability: 100,
      useProbability: false,
      ignoreBudget: forced.force || next.ignoreBudget,
      group: forced.force ? '' : next.group,
      triggers: forced.force ? [] : next.triggers,
      cooldown: forced.force ? 0 : next.cooldown,
      delay: forced.force ? 0 : next.delay,
      sticky: forced.force ? 0 : next.sticky,
      delayUntilRecursion: forced.force ? false : next.delayUntilRecursion,
      vectorized: forced.force ? false : next.vectorized,
    });
  return next;
}
function promptTemplateForcedWorldInfoEntries(run) {
  var transaction = run && run.transaction;
  if (!transaction) return [];
  return Array.from(transaction.forcedEntries.values()).map(function (row) {
    return cloneData(row.entry);
  });
}
function promptTemplatePhaseEntries(transaction, kind, index) {
  return (transaction.entries || [])
    .map(function (entry) {
      var hit = transaction.processed.get(promptTemplateWorldEntryKey(entry));
      return hit && hit.allowed ? hit.entry : null;
    })
    .filter(function (entry) {
      if (!entry || !promptTemplateEntryEnabled(entry)) return false;
      var entryKind = promptTemplateSpecialKind(entry);
      if (index != null)
        return promptTemplateCommentStartsWith(
          entry,
          '[GENERATE:' + index + ':' + (kind === 'before' ? 'BEFORE' : 'AFTER') + ']'
        );
      return (
        entryKind === kind && (!promptTemplateHasDecorator(entry, kind) || !promptTemplateDecoratorValue(entry, kind))
      );
    });
}
function promptTemplateWorldInfoSource(transaction, entry, env) {
  var source = promptTemplateMacroResult(String(entry.content || ''), transaction.char, transaction.env.random);
  if (typeof applyRegexScriptsToText === 'function')
    source = applyRegexScriptsToText(
      source,
      'worldbook',
      env && env.runType === 'render' ? 'display' : 'send',
      transaction.char
    ).text;
  return source;
}
async function promptTemplateEvalEntries(transaction, kind, env, index, content, buffer) {
  var output = '',
    candidates = promptTemplatePhaseEntries(transaction, kind, index),
    entries = promptTemplateSelectActivatedEntries(
      transaction.char,
      candidates,
      String(content == null ? '' : content),
      { vectorized: false },
      transaction.env.random
    );
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i],
      entryEnv = Object.assign({}, env, { world_info: entry, generateBuffer: String(buffer == null ? '' : buffer) }),
      condition = promptTemplateDecoratorValue(entry, 'if'),
      allowed = true;
    if (condition)
      try {
        allowed =
          String(
            await promptTemplateEval(
              '<%- !!(' + condition + ') %>',
              await promptTemplateContext(transaction, entryEnv),
              {
                when: promptTemplateEntryLabel(entry) + '.if',
              }
            )
          ).trim() === 'true';
      } catch (_) {
        allowed = false;
      }
    if (!allowed) continue;
    var context = await promptTemplateContext(transaction, entryEnv),
      value = await promptTemplateEval(
        promptTemplateApplyRegex(
          transaction,
          context,
          promptTemplateWorldInfoSource(transaction, entry, env),
          kind.startsWith('render') ? 'message' : 'generate',
          { worldinfo: true, html: true }
        ),
        context,
        { when: promptTemplateEntryLabel(entry) }
      );
    if (value != null) output += value;
    if (
      !transaction.activated.some(function (row) {
        return promptTemplateWorldEntryKey(row) === promptTemplateWorldEntryKey(entry);
      })
    )
      transaction.activated.push(cloneData(entry));
  }
  if (transaction.contextPromise)
    await promptTemplateContext(transaction, Object.assign({}, env, { world_info: undefined }));
  return output;
}
function promptTemplateWrapContent(content, before, after) {
  if (!Array.isArray(content))
    return String(before || '') + String(content == null ? '' : content) + String(after || '');
  var parts = content.map(function (part) {
      return objectRecord(part) ? Object.assign({}, part) : part;
    }),
    textIndexes = [];
  parts.forEach(function (part, index) {
    if (part && part.type === 'text') textIndexes.push(index);
  });
  if (!textIndexes.length) {
    if (before) parts.unshift({ type: 'text', text: before });
    if (after) parts.push({ type: 'text', text: after });
    return parts;
  }
  var first = textIndexes[0],
    last = textIndexes[textIndexes.length - 1];
  if (before) parts[first].text = before + String(parts[first].text || '');
  if (after) parts[last].text = String(parts[last].text || '') + after;
  return parts;
}
async function promptTemplatePrepareGeneration(char, session, messageId, env, stscriptRunToken) {
  if (!env || !env.preview) {
    promptTemplateSelectRegexOwner(char, session);
    promptTemplateDeactivateRegex({ message: true });
  }
  if (isRisuCharacter(char)) return { transaction: null, skipProcessing: true, ecosystem: 'risu' };
  var transaction = promptTemplateCreateTransaction(char, session, messageId, env),
    run = {
      transaction: transaction,
      skipProcessing:
        !_promptTemplateFeatures.enabled ||
        (!_promptTemplateFeatures.generate && !_promptTemplateFeatures.generate_loader),
    };
  transaction.stscriptRunToken = stscriptRunToken || null;
  promptTemplateBindSignal(transaction, env && env.signal);
  if (!_promptTemplateFeatures.enabled) return run;
  try {
    await promptTemplatePrepareEntries(transaction);
    return run;
  } catch (error) {
    promptTemplateCancelTransaction(transaction);
    throw error;
  }
}
async function promptTemplateProcessGenerationMessages(run, messages) {
  var transaction = run && run.transaction;
  if (!transaction) return messages;
  if (run.skipProcessing) {
    await promptTemplateCommit(transaction);
    return messages;
  }
  var injectionsReleased = false;
  if (!transaction.preview) promptTemplateDeactivateRegex({ basic: true });
  try {
    var out = (Array.isArray(messages) ? messages : []).map(function (row) {
        return Object.assign({}, row);
      }),
      globalEnv = { runType: 'generate', generateData: { chat: out } },
      overallBefore = _promptTemplateFeatures.generate_loader
        ? await promptTemplateEvalEntries(transaction, 'generate_before', globalEnv, undefined, '', '')
        : '',
      collect = overallBefore;
    for (var i = 0; i < out.length; i++) {
      var row = out[i],
        env = { runType: 'generate', message_id: i, role: row.role, generateData: { chat: out } },
        before = _promptTemplateFeatures.generate_loader
          ? await promptTemplateEvalEntries(transaction, 'before', env, i, '', collect)
          : '',
        content = row.content,
        regexContext = await promptTemplateContext(transaction, env);
      if (Array.isArray(content)) {
        var parts = [];
        for (var partIndex = 0; partIndex < content.length; partIndex++) {
          var part = content[partIndex];
          if (!part || part.type !== 'text') {
            parts.push(part);
            continue;
          }
          var prompt =
              _promptTemplateFeatures.generate && _promptTemplateFeatures.raw_message_evaluation
                ? await promptTemplateEval(
                    promptTemplateApplyRegex(transaction, regexContext, part.text, 'generate', { role: row.role }),
                    regexContext,
                    {
                      when: 'generate.' + i,
                    }
                  )
                : String(part.text || ''),
            after = _promptTemplateFeatures.generate_loader
              ? await promptTemplateEvalEntries(transaction, 'after', env, i, prompt, collect + before + prompt)
              : '';
          parts.push(Object.assign({}, part, { text: before + prompt + after }));
          collect += before + prompt + after;
        }
        content = parts;
      } else {
        var promptText =
            _promptTemplateFeatures.generate && _promptTemplateFeatures.raw_message_evaluation
              ? await promptTemplateEval(
                  promptTemplateApplyRegex(transaction, regexContext, content, 'generate', { role: row.role }),
                  regexContext,
                  { when: 'generate.' + i }
                )
              : String(content == null ? '' : content),
          afterText = _promptTemplateFeatures.generate_loader
            ? await promptTemplateEvalEntries(transaction, 'after', env, i, promptText, collect + before + promptText)
            : '';
        content = before + promptText + afterText;
        collect += content;
      }
      row.content = content;
    }
    await promptTemplateContext(
      transaction,
      Object.assign({}, globalEnv, { message_id: undefined, role: undefined, world_info: undefined })
    );
    var overallAfter = _promptTemplateFeatures.generate_loader
      ? await promptTemplateEvalEntries(
          transaction,
          'generate_after',
          globalEnv,
          undefined,
          collect,
          overallBefore + collect
        )
      : '';
    if (overallBefore && out.length) out[0].content = promptTemplateWrapContent(out[0].content, overallBefore, '');
    if (overallAfter && out.length)
      out[out.length - 1].content = promptTemplateWrapContent(out[out.length - 1].content, '', overallAfter);
    out.forEach(function (row) {
      if (Array.isArray(row.content))
        row.content = row.content.map(function (part) {
          return part && part.type === 'text'
            ? Object.assign({}, part, { text: promptTemplateApplyInjected(transaction, part.text) })
            : part;
        });
      else row.content = promptTemplateApplyInjected(transaction, row.content);
    });
    promptTemplateDeactivateInjections(transaction);
    if (!transaction.preview) promptTemplateDeactivateRegex({ generate: true, basic: true });
    if (!transaction.preview) promptTemplateUpdateStatistics(transaction, collect, 'send');
    injectionsReleased = true;
    await promptTemplateCommit(transaction);
    return out;
  } catch (error) {
    if (!injectionsReleased) promptTemplateDeactivateInjections(transaction);
    if (!transaction.preview) promptTemplateDeactivateRegex({ generate: true, basic: true });
    await promptTemplateCommit(transaction);
    throw error;
  }
}

async function promptTemplateEvaluateRender(text, role, char, message, options) {
  if (isRisuCharacter(char)) return String(text == null ? '' : text);
  var current = promptTemplateCurrent(),
    session = current.char && String(current.char.id) === String(char && char.id) ? current.session : null;
  if (!session) return '';
  var index = session.msgs.indexOf(message),
    transaction = promptTemplateCreateTransaction(char, session, index < 0 ? session.msgs.length - 1 : index, {
      runType: 'render',
    });
  transaction.renderRevision = _promptTemplateRegexRevision;
  if (options && options.renderState) options.renderState.transaction = transaction;
  promptTemplateBindSignal(transaction, options && options.signal);
  try {
    await promptTemplatePrepareEntries(transaction);
    var env = {
        runType: 'render',
        message_id: index,
        swipe_id: Math.max(0, Number(message && message.swipeId) || 0),
        is_last: index === session.msgs.length - 1,
        is_user: role === 'user',
        is_system: role === 'system',
        name: String((message && message.name) || ''),
      },
      before = _promptTemplateFeatures.render_loader
        ? await promptTemplateEvalEntries(transaction, 'render_before', env, undefined, '', '')
        : '',
      context = await promptTemplateContext(transaction, env),
      regexFlags = {
        user: role === 'user',
        assistant: role === 'assistant',
        system: role === 'system',
        depth: session.msgs.length - index - 1,
      },
      value = _promptTemplateFeatures.render
        ? await promptTemplateEval(
            promptTemplateApplyRegex(transaction, context, text, 'message', Object.assign({ before: true }, regexFlags)),
            context,
            {
              when: 'render.' + index,
            }
          )
        : String(text || '');
    var htmlFlags = Object.assign({ html: true }, regexFlags),
      renderState = options && options.renderState;
    if (
      renderState &&
      Array.from(_promptTemplateRegexes.message.values()).some(function (row) {
        return promptTemplateRegexMatches(row, 'message', htmlFlags);
      })
    ) {
      Object.assign(renderState, {
        transaction: transaction,
        context: context,
        env: env,
        before: before,
        flags: htmlFlags,
        index: index,
      });
      await promptTemplateSaveTransaction(transaction, false);
      return value;
    }
    var after = _promptTemplateFeatures.render_loader
      ? await promptTemplateEvalEntries(transaction, 'render_after', env, undefined, value, '')
      : '';
    await promptTemplateCommit(transaction);
    return before + value + after;
  } catch (error) {
    await promptTemplateCommit(transaction);
    throw error;
  } finally {
    if (options && options.renderState) options.renderState.revision = transaction.renderRevision;
  }
}
function promptTemplateRenderKey(source, role, message) {
  return String(role || '') + '|' + String((message && message.swipeId) || 0) + '|' + source;
}
// Every displayed message asks whether the character's books hold an enabled [RENDER:*] entry.
// The answer depends only on each book's stored entries, so it is remembered per book until a
// world book save or a replaced entry list; the books in effect are resolved on every call, so
// chat, persona and character bindings take effect immediately.
function promptTemplateBookHasRender(category) {
  var entries = Array.isArray(category && category.entries) ? category.entries : [],
    revision = typeof _worldBookRevision === 'number' ? _worldBookRevision : 0,
    row = _promptTemplateRenderBooks.get(category);
  if (!row || row.revision !== revision || row.entries !== entries) {
    row = {
      revision: revision,
      entries: entries,
      value: entries.some(function (entry) {
        var kind = promptTemplateSpecialKind(entry);
        return (kind === 'render_before' || kind === 'render_after') && promptTemplateEntryEnabled(entry);
      }),
    };
    _promptTemplateRenderBooks.set(category, row);
  }
  return row.value;
}
function promptTemplateHasRenderEntries(char) {
  return !!(
    char &&
    typeof effectiveWBCategorySources === 'function' &&
    effectiveWBCategorySources(char.id).some(function (row) {
      return row.category && typeof row.category === 'object' && promptTemplateBookHasRender(row.category);
    })
  );
}
function promptTemplateDisplayText(text, role, char, message, options) {
  var source = String(text == null ? '' : text);
  if (isRisuCharacter(char)) return source;
  var current = promptTemplateCurrent();
  if (current.char && current.session) promptTemplateSelectRegexOwner(current.char, current.session);
  var hasTemplate = source.indexOf('<%') >= 0;
  if (!_promptTemplateFeatures.enabled || !_promptTemplateFeatures.render) return hasTemplate ? '' : source;
  var hasRender = promptTemplateHasRenderEntries(char);
  if (!hasTemplate && !hasRender && !_promptTemplateRegexes.message.size) return source;
  if ((options && options.streamPreview) || !message) return '';
  var cache = message && typeof message === 'object' ? _promptTemplateRenderCache.get(message) : null;
  if (!cache) {
    cache = new Map();
    if (message && typeof message === 'object') _promptTemplateRenderCache.set(message, cache);
  }
  var key = promptTemplateRenderKey(source, role, message),
    row = cache.get(key);
  if (row && row.revision !== _promptTemplateRegexRevision) row = null;
  if (row && row.state === 'ready') return row.value;
  if (row && row.state === 'error') return '';
  if (!row) {
    row = { state: 'pending', value: '', revision: _promptTemplateRegexRevision, renderState: {} };
    cache.set(key, row);
    row.promise = promptTemplateEvaluateRender(
      source,
      role,
      char,
      message,
      Object.assign({}, options, { renderState: row.renderState })
    )
      .then(function (value) {
        if (row.renderState.transaction && row.renderState.transaction.cancelled) return;
        row.state = 'ready';
        row.value = value;
        row.revision = row.renderState.revision;
        if ((!options || options.notifyRender !== false) && typeof renderChat === 'function') renderChat();
      })
      .catch(function (error) {
        row.state = 'error';
        if (row.renderState.transaction && row.renderState.transaction.cancelled) return;
        var notice = String((error && error.message) || error);
        if (!_promptTemplateRenderNotice.has(notice)) {
          _promptTemplateRenderNotice.add(notice);
          if (typeof toast === 'function') toast('EJS 模板求值失败：' + notice, 'err');
        }
      });
  }
  return row.value;
}
function promptTemplateDisplayHtml(html, source, role, char, message, options) {
  if (isRisuCharacter(char)) return html;
  if (
    !_promptTemplateFeatures.enabled ||
    !_promptTemplateFeatures.render ||
    !message ||
    (options && options.streamPreview)
  )
    return html;
  var cache = _promptTemplateRenderCache.get(message),
    textKey = promptTemplateRenderKey(String(source == null ? '' : source), role, message),
    textRow = cache && cache.get(textKey),
    state = textRow && textRow.renderState;
  if (!state || !state.transaction || !state.flags) return html;
  if (
    !Array.from(_promptTemplateRegexes.message.values()).some(function (rule) {
      return promptTemplateRegexMatches(rule, 'message', state.flags);
    })
  )
    return html;
  if (textRow.state !== 'ready' || textRow.revision !== _promptTemplateRegexRevision) return '';
  var key = 'html|' + textKey + '|' + html,
    row = cache.get(key);
  if (row && row.revision === _promptTemplateRegexRevision) return row.value;
  row = { state: 'pending', value: '', revision: _promptTemplateRegexRevision };
  cache.set(key, row);
  row.promise = (state.htmlPromise || Promise.resolve())
    .then(async function () {
      var value = await promptTemplateEval(
          promptTemplateApplyRegex(state.transaction, state.context, html, 'message', state.flags),
          state.context,
          { when: 'render.html.' + state.index }
        ),
        after = _promptTemplateFeatures.render_loader
          ? await promptTemplateEvalEntries(state.transaction, 'render_after', state.env, undefined, value, '')
          : '';
      await promptTemplateSaveTransaction(state.transaction, false);
      if (state.transaction.cancelled) return;
      row.value = state.before + value + after;
      row.state = 'ready';
      row.revision = state.transaction.renderRevision;
      textRow.revision = state.transaction.renderRevision;
      if ((!options || options.notifyRender !== false) && typeof renderChat === 'function') renderChat();
    })
    .catch(async function (error) {
      row.state = 'error';
      if (state.transaction.cancelled) return;
      await promptTemplateSaveTransaction(state.transaction, false);
      var notice = String((error && error.message) || error);
      if (!_promptTemplateRenderNotice.has(notice)) {
        _promptTemplateRenderNotice.add(notice);
        if (typeof toast === 'function') toast('EJS 模板求值失败：' + notice, 'err');
      }
    });
  state.htmlPromise = row.promise;
  return row.value;
}
async function promptTemplateAwaitRender(message, render, options) {
  options = options || {};
  var timeoutMs = options.timeoutMs == null ? Infinity : Number(options.timeoutMs),
    started = Date.now();
  function cancel() {
    var cache = _promptTemplateRenderCache.get(message);
    if (cache)
      cache.forEach(function (row, key) {
        var transaction = row.renderState && row.renderState.transaction;
        if (transaction) promptTemplateCancelTransaction(transaction);
        if (row.state === 'pending' || transaction) cache.delete(key);
      });
  }
  if (options.signal) options.signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (options.signal && options.signal.aborted) throw cardFrontendAbortError('EJS 显示渲染');
      var value = render(),
        cache = _promptTemplateRenderCache.get(message),
        pending = cache
          ? Array.from(cache.values()).filter(function (row) {
              return row.state === 'pending';
            })
          : [];
      pending.forEach(function (row) {
        var transaction = row.renderState && row.renderState.transaction;
        if (transaction && options.signal && transaction.signal !== options.signal)
          promptTemplateBindSignal(transaction, options.signal);
      });
      if (!pending.length) return value;
      if (Date.now() - started >= timeoutMs) {
        var timeout = new Error('EJS 显示渲染等待超时（' + timeoutMs + 'ms）');
        timeout.name = 'TimeoutError';
        throw timeout;
      }
      await cardFrontendAwaitWithTimeout(
        Promise.all(
          pending.map(function (row) {
            return row.promise;
          })
        ),
        { signal: options.signal, timeoutMs: Math.max(0, timeoutMs - (Date.now() - started)), label: 'EJS 显示渲染' }
      );
    }
  } catch (error) {
    if (error && error.name === 'AbortError') cancel();
    throw error;
  } finally {
    if (options.signal) options.signal.removeEventListener('abort', cancel);
  }
}
async function promptTemplateRecordReceive(char, session, message, waitOptions) {
  waitOptions = waitOptions || {};
  if (!_promptTemplateFeatures.enabled || !message || isRisuCharacter(char)) return;
  var current = promptTemplateCurrent();
  if (current.char !== char || current.session !== session) return;
  var index = session.msgs.indexOf(message),
    role = message.role,
    source = role === 'assistant' ? assistantMessageParts(message).content : String(message.content || ''),
    marked = source,
    options = { depth: regexScriptMessageDepths(session.msgs)[index], notifyRender: false },
    text = await promptTemplateAwaitRender(
      message,
      function () {
        return promptTemplateDisplayText(marked, role, char, message, options);
      },
      waitOptions
    );
  await cardFrontendAwaitWithTimeout(
    prepareRegexScriptTexts(
      char,
      [{ text: text, role: role, phase: 'display', message: message, index: index, depth: options.depth }],
      { signal: waitOptions.signal }
    ),
    { signal: waitOptions.signal, label: '接收消息显示正则' }
  );
  var markdownOptions = {
      role: role,
      preserveImages: true,
      mediaAssets: char.media_assets || [],
      mediaOwnerId: char.id,
    },
    html = await promptTemplateAwaitRender(
      message,
      function () {
        // Statistics do not scan older objective panels, which can schedule unrelated display transforms.
        if (role === 'assistant')
          return assistantStructuredDisplayHtml(source, char, message, options, markdownOptions, null, index);
        var body =
          role === 'system'
            ? esc(text)
            : md(cleanDisplayText(regexScriptDisplayText(text, role, char, message, options), role), markdownOptions);
        return promptTemplateDisplayHtml(body, marked, role, char, message, options);
      },
      waitOptions
    ),
    element = document.createElement('div');
  if ((waitOptions.signal && waitOptions.signal.aborted) || (waitOptions.current && !waitOptions.current()))
    throw cardFrontendAbortError('接收消息统计');
  element.innerHTML = html;
  var transaction = promptTemplateCreateTransaction(char, session, index, {});
  promptTemplateUpdateStatistics(transaction, element.textContent, 'receive');
  await promptTemplateCommit(transaction);
}
async function promptTemplateRefreshWorldInfo() {
  _promptTemplateRenderCache = new WeakMap();
  var current = promptTemplateCurrent();
  if (current.char && isRisuCharacter(current.char)) {
    promptTemplateSelectRegexOwner(current.char, current.session);
    if (typeof renderChat === 'function') renderChat();
    return true;
  }
  if (current.char && current.session) {
    var transaction = promptTemplateCreateTransaction(current.char, current.session, current.session.msgs.length - 1, {
      runType: 'preparation',
      isDryRun: true,
    });
    await promptTemplatePrepareEntries(transaction);
    await promptTemplateCommit(transaction);
  }
  if (current.char && typeof renderChat === 'function') renderChat();
  return true;
}

function promptTemplateFeatureSnapshot() {
  return Object.assign({}, _promptTemplateFeatures, {
    generate_enabled: _promptTemplateFeatures.generate,
    generate_loader_enabled: _promptTemplateFeatures.generate_loader,
    render_enabled: _promptTemplateFeatures.render,
    render_loader_enabled: _promptTemplateFeatures.render_loader,
    preload_worldinfo_enabled: _promptTemplateFeatures.preload_worldinfo,
    raw_message_evaluation_enabled: _promptTemplateFeatures.raw_message_evaluation,
    with_context_disabled: false,
    debug_enabled: false,
    autosave_enabled: false,
    code_blocks_enabled: true,
    filter_message_enabled: true,
    inject_loader_enabled: false,
    invert_enabled: true,
    depth_limit: -1,
    compile_workers: false,
    sandbox: false,
  });
}
function promptTemplateSetFeatures(value) {
  value = objectRecord(value) || {};
  var aliases = {
      enabled: 'enabled',
      generate: 'generate',
      generate_enabled: 'generate',
      generate_loader: 'generate_loader',
      generate_loader_enabled: 'generate_loader',
      render: 'render',
      render_enabled: 'render',
      render_loader: 'render_loader',
      render_loader_enabled: 'render_loader',
      preload_worldinfo: 'preload_worldinfo',
      preload_worldinfo_enabled: 'preload_worldinfo',
      raw_message_evaluation: 'raw_message_evaluation',
      raw_message_evaluation_enabled: 'raw_message_evaluation',
      preload_only: 'preload_only',
    },
    required = { enabled: true, generate: true, raw_message_evaluation: true },
    fixed = {
      with_context_disabled: false,
      debug_enabled: false,
      autosave_enabled: false,
      code_blocks_enabled: true,
      filter_message_enabled: true,
      inject_loader: false,
      inject_loader_enabled: false,
      invert_enabled: true,
      depth_limit: -1,
      compile_workers: false,
      sandbox: false,
    },
    unsupported = { code_editor: true, cache_enabled: true, cache_size: true, cache_hasher: true };
  Object.keys(value).forEach(function (key) {
    if (aliases[key]) {
      var target = aliases[key];
      if (required[target] && value[key] === false)
        throw new Error('Prompt Template 生成求值不可关闭，否则会把裸 EJS 发送给模型：' + key);
      _promptTemplateFeatures[target] = value[key];
      return;
    }
    if (Object.prototype.hasOwnProperty.call(fixed, key)) {
      if (value[key] !== fixed[key])
        throw new Error(
          '夜欲原生提示词模板的 ' +
            key +
            ' 固定为 ' +
            JSON.stringify(fixed[key]) +
            '，不能由卡片面板改为 ' +
            JSON.stringify(value[key])
        );
      return;
    }
    if (unsupported[key]) {
      if (value[key]) throw new Error('夜欲原生提示词模板不支持：' + key);
      return;
    }
    throw new Error('未知 Prompt Template 功能：' + key);
  });
  return promptTemplateFeatureSnapshot();
}
async function promptTemplatePrepareContextFor(char, session, env, messageId, stscriptRunToken) {
  env = objectRecord(env) || {};
  if (!char || !session) throw new Error('当前没有可用对话');
  if (isRisuCharacter(char)) throw new Error('Risu 卡片不运行 ST Prompt Template / EJS');
  var transaction = promptTemplateCreateTransaction(char, session, messageId, env),
    ownerKey = promptTemplateOwnerKey(char, session),
    initial = _promptTemplateInitialByOwner.get(ownerKey);
  transaction.stscriptRunToken = stscriptRunToken || null;
  promptTemplateBindSignal(transaction, env.signal);
  if (initial) transaction.initial = cloneData(initial);
  else {
    var entries = promptTemplateEnabledWorldInfoEntries(char, session);
    transaction.entries = entries;
    await promptTemplateLoadInitialEntries(transaction, entries, { runType: 'preload', generateType: '' });
  }
  var context = await promptTemplateContext(transaction, env);
  _promptTemplatePublicTransactions.set(context, transaction);
  return context;
}
var EjsTemplate = {
  evalTemplate: async function (content, data, options) {
    if (data == null) data = await EjsTemplate.prepareContext();
    var transaction = _promptTemplatePublicTransactions.get(data);
    return promptTemplateTrackedEvaluation(transaction, function () {
      return promptTemplateEval(content, data, { options: options || {} });
    });
  },
  prepareContext: async function (env, messageId) {
    var current = promptTemplateCurrent();
    return promptTemplatePrepareContextFor(current.char, current.session, env, messageId);
  },
  getSyntaxErrorInfo: promptTemplateSyntaxErrorInfo,
  setFeatures: promptTemplateSetFeatures,
  allVariables: function (messageId, swipeId) {
    var current = promptTemplateCurrent();
    if (current.char && current.session) {
      var transaction = promptTemplateCreateTransaction(current.char, current.session, messageId, {}, swipeId),
        key = String(current.char.id || '') + '|' + String(current.session.id || '');
      transaction.initial = cloneData(_promptTemplateInitialByOwner.get(key) || {});
      return promptTemplateVariablesView(transaction);
    }
    return {};
  },
  saveVariables: async function (context) {
    var transaction = context && _promptTemplatePublicTransactions.get(context);
    if (transaction) return promptTemplateSaveTransaction(transaction, false);
    var pending = Array.from(_promptTemplatePublicPending);
    if (pending.length) return Promise.all(pending.map(promptTemplateSavePublicWhenInactive));
  },
  resetFeatures: function () {
    _promptTemplateFeatures = Object.assign({}, PROMPT_TEMPLATE_DEFAULT_FEATURES);
    return promptTemplateFeatureSnapshot();
  },
  refreshWorldInfo: promptTemplateRefreshWorldInfo,
  parseJSON: promptTemplateParseJSON,
  jsonPatch: promptTemplateJsonPatch,
  getFeatures: promptTemplateFeatureSnapshot,
  compileTemplate: promptTemplateCompile,
  finalization:
    typeof FinalizationRegistry === 'function'
      ? new FinalizationRegistry(function (sandbox) {
          if (sandbox && typeof sandbox.destroyIframe === 'function') sandbox.destroyIframe();
        })
      : null,
};
Object.defineProperty(EjsTemplate, 'defines', {
  enumerable: true,
  get: function () {
    return _promptTemplateDefines;
  },
});
Object.defineProperty(EjsTemplate, 'initialVariables', {
  enumerable: true,
  get: function () {
    var current = promptTemplateCurrent(),
      key = current.char && current.session ? promptTemplateOwnerKey(current.char, current.session) : '';
    return key ? _promptTemplateInitialByOwner.get(key) || {} : {};
  },
});
window.EjsTemplate = EjsTemplate;

if (typeof stscriptAddCommand === 'function') {
  stscriptAddCommand({
    name: 'ejs',
    namedArgumentList: [{ name: 'ctx' }, { name: 'block' }],
    callback: async function (args, value) {
      var char = typeof stscriptChar === 'function' ? stscriptChar() : promptTemplateCurrent().char,
        session =
          typeof stscriptSess === 'function'
            ? stscriptSess()
            : char && typeof getActiveSession === 'function'
              ? getActiveSession(char.id)
              : null,
        extra = args && args.ctx ? promptTemplateParseJSON(args.ctx) || {} : {},
        context = await promptTemplatePrepareContextFor(
          char,
          session,
          Object.assign({ runType: 'command' }, extra),
          undefined,
          typeof _qrTop === 'object' ? _qrTop : null
        ),
        source = Array.isArray(value) ? value.join(' ') : String(value || '');
      if (args && args.block) source = '<%= ' + source + ' %>';
      try {
        return await promptTemplateEval(source, context, { when: '/ejs' });
      } finally {
        await promptTemplateCommit(_promptTemplatePublicTransactions.get(context));
      }
    },
  });
  stscriptAddCommand({
    name: 'ejs-refresh',
    callback: async function () {
      await promptTemplateRefreshWorldInfo();
      return '';
    },
  });
}
