// ===== ST card scripts and runtime state =====
var _cardScriptStackCache = typeof WeakMap === 'function' ? new WeakMap() : null,
  _cardScriptRuntimeState = Object.create(null);
function cardScriptArray(value) {
  return Array.isArray(value) ? value : [];
}
function cardScriptStandardExtensions(char) {
  if (isRisuCharacter(char)) return null;
  var live = objectRecord(char && char.extensions),
    raw = objectRecord(char && char.importMeta && char.importMeta.rawCard),
    root = raw ? objectRecord(raw.data) || raw : null,
    rawExt = objectRecord(root && root.extensions);
  if (live && Object.prototype.hasOwnProperty.call(live, 'regex_scripts')) return live;
  if (rawExt && Object.prototype.hasOwnProperty.call(rawExt, 'regex_scripts')) return rawExt;
  return live || rawExt || null;
}
// TavernHelper script libraries have shipped in three real shapes. Normalising them here gives MVU,
// the resident script sandbox and dependency reporting one executable truth while the original
// extension value remains untouched while the card is parsed and executed.
function cardScriptTavernHelperContainer(extensions, create) {
  var ext = objectRecord(extensions);
  if (!ext) return null;
  var helper = ext.tavern_helper;
  if (objectRecord(helper) && Array.isArray(helper.scripts))
    return { rows: helper.scripts, source: 'extensions.tavern_helper.scripts' };
  if (Array.isArray(helper)) {
    var pair = helper.find(function (entry) {
      return Array.isArray(entry) && entry[0] === 'scripts' && Array.isArray(entry[1]);
    });
    if (pair) return { rows: pair[1], source: 'extensions.tavern_helper[scripts]' };
    if (create) {
      pair = ['scripts', []];
      helper.push(pair);
      return { rows: pair[1], source: 'extensions.tavern_helper[scripts]' };
    }
  }
  if (Array.isArray(ext.TavernHelper_scripts))
    return { rows: ext.TavernHelper_scripts, source: 'extensions.TavernHelper_scripts' };
  if (!create) return null;
  if (!objectRecord(helper)) ext.tavern_helper = {};
  ext.tavern_helper.scripts = [];
  return { rows: ext.tavern_helper.scripts, source: 'extensions.tavern_helper.scripts' };
}
function cardScriptTavernHelperRows(char) {
  if (isRisuCharacter(char)) return [];
  var live = cardScriptTavernHelperContainer(char && char.extensions, false),
    raw = objectRecord(char && char.importMeta && char.importMeta.rawCard),
    root = raw ? objectRecord(raw.data) || raw : null,
    selected = live || cardScriptTavernHelperContainer(root && root.extensions, false),
    rows = [];
  if (!selected) return rows;
  hostWriteFlattenScripts(selected.rows, 'character', 'characters', []).forEach(function (record, index) {
    var row = record.stored;
    var outer = objectRecord(row) || {},
      wrapped = objectRecord(outer.value),
      value = wrapped || outer,
      type = String(value.type || outer.type || 'unknown').toLowerCase(),
      content = String(value.content != null ? value.content : value.code != null ? value.code : '');
    rows.push({
      id: String(value.id || 'tavern_helper_' + index),
      name: String(value.name || value.scriptName || '脚本 ' + (index + 1)),
      type: type,
      enabled: value.enabled !== false && outer.enabled !== false,
      content: content,
      data: objectRecord(value.data) || {},
      source: selected.source,
      index: index,
      raw: cloneJsonValue(row),
    });
  });
  return rows;
}
function hostWriteScriptPayload(value) {
  var row = objectRecord(value);
  return objectRecord(row && row.value) || row;
}
function hostWriteFlattenScripts(rows, scope, section, out) {
  (Array.isArray(rows) ? rows : []).forEach(function (stored) {
    var node = hostWriteScriptPayload(stored);
    if (!node) return;
    if (String(node.type || 'script') === 'folder') hostWriteFlattenScripts(node.scripts, scope, section, out);
    else out.push({ scope: scope, section: section, node: node, stored: stored });
  });
  return out;
}
// A card that ships its own TavernHelper script usually ships the macros that script expands, so a
// third-party marker like {{ERA:$ALLDATA}} is not an unhandled placeholder on such a card. The test
// is textual on purpose: script semantics are never interpreted, only whether an enabled script's
// source writes the macro name right after an opening "{{" (the ERA bundle matches on
// /{{\s*ERA(-withmeta)?\s*:/). name may be the full written form; only its macro name is used.
function cardScriptHandlesMacro(char, name) {
  name = String(name || '').split(/[\s:]/)[0];
  if (!/^[A-Za-z_][\w-]*$/.test(name)) return false;
  var probe = new RegExp('\\{\\{[^}]{0,32}\\b' + name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\b', 'i');
  return cardScriptTavernHelperRows(char).some(function (row) {
    return row.enabled && probe.test(row.content);
  });
}
function cardScriptStackSignature(char) {
  var standard = cardScriptStandardExtensions(char);
  return [
    standard ? JSON.stringify(standard.regex_scripts) : '',
    String(char && char.scriptsEnabled),
    typeof mvuSchemaScriptSignature === 'function' ? mvuSchemaScriptSignature(char) : '',
    typeof cardFrontendSignature === 'function' ? cardFrontendSignature(char) : '',
    typeof cardScriptLibrarySignature === 'function' ? cardScriptLibrarySignature(char) : '',
  ].join('\u0000');
}
function cardScriptStack(char) {
  if (!char || typeof char !== 'object') return null;
  if (isRisuCharacter(char))
    return {
      signature: 'risu',
      stScripts: [],
      mvuSchemas: [],
      frontends: { count: 0, remotes: [], runtimeRemotes: [], missing: [], usesParent: false },
      libraries: { scripts: [], active: [], disabled: [], unsupported: [], remotes: [], runtimeRemotes: [] },
      hasScripts: false,
      frontendAccess: false,
      hasContent: false,
    };
  var cached = _cardScriptStackCache ? _cardScriptStackCache.get(char) : null,
    signature = cardScriptStackSignature(char);
  if (cached && cached.signature === signature) return cached;
  var standard = cardScriptStandardExtensions(char) || {},
    stScripts = cardScriptArray(standard.regex_scripts).map(function (entry, index) {
      var row = objectRecord(entry) || {};
      return Object.assign({}, cloneJsonValue(row), { id: String(row.id || 'card_st_' + index), source: 'card' });
    }),
    mvuSchemas = typeof mvuProtocolScripts === 'function' ? mvuProtocolScripts(char) : [],
    frontends =
      typeof cardFrontendScan === 'function'
        ? cardFrontendScan(char)
        : { count: 0, remotes: [], missing: [], usesParent: false },
    libraries =
      typeof cardScriptLibraryScan === 'function'
        ? cardScriptLibraryScan(char)
        : { scripts: [], active: [], disabled: [], unsupported: [], remotes: [] },
    stack = {
      signature: signature,
      stScripts: stScripts,
      mvuSchemas: mvuSchemas,
      frontends: frontends,
      libraries: libraries,
    };
  stack.hasScripts = stack.stScripts.length > 0 || stack.mvuSchemas.length > 0;
  stack.frontendAccess = stack.frontends.count > 0 || stack.libraries.active.length > 0;
  stack.hasContent = stack.hasScripts || stack.frontendAccess;
  if (_cardScriptStackCache) _cardScriptStackCache.set(char, stack);
  return stack;
}
function invalidateCardScriptStack(char) {
  if (_cardScriptStackCache && char && typeof char === 'object') _cardScriptStackCache.delete(char);
  if (typeof invalidateRegexScriptRuntimeCache === 'function') invalidateRegexScriptRuntimeCache();
}
// Only the card's own switch decides this. The stack used to be built here purely to prove the
// argument is a usable card object, which rescans and rehashes every script the card ships — a cost
// paid once per rendered message and once per placeholder on long chats.
function cardScriptsEnabled(char) {
  if (isRisuCharacter(char)) return false;
  return !!(char && typeof char === 'object' && char.scriptsEnabled !== false);
}
function cardRegexesEnabled(char) {
  return !!char && !isRisuCharacter(char) && char.regexEnabled !== false;
}
function cardScriptSendInterceptGranted(char) {
  var stack = typeof cardScriptStack === 'function' ? cardScriptStack(char) : null;
  return !!(char && stack && stack.libraries && stack.libraries.active.length && cardScriptsEnabled(char));
}
function setCardScriptsEnabled(char, enabled) {
  if (!char || isRisuCharacter(char)) return;
  if (enabled === false) char.scriptsEnabled = false;
  else delete char.scriptsEnabled;
  invalidateCardScriptStack(char);
}

// ---- runtime state shown in the card settings panel ----
function cardScriptRuntimeState(char) {
  var id = String((char && char.id) || '');
  if (!_cardScriptRuntimeState[id])
    _cardScriptRuntimeState[id] = { running: 0, lastError: '', lastErrorAt: 0, label: '' };
  return _cardScriptRuntimeState[id];
}
function markCardScriptRunning(char, label) {
  var state = cardScriptRuntimeState(char);
  state.running++;
  state.label = String(label || '');
  if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(char);
  if (typeof renderRegexScriptRuntimeStatus === 'function') renderRegexScriptRuntimeStatus(char);
  return state;
}
function markCardScriptFinished(char, error) {
  var state = cardScriptRuntimeState(char);
  state.running = Math.max(0, state.running - 1);
  if (error) {
    state.lastError = String((error && error.message) || error);
    state.lastErrorAt = Date.now();
  }
  if (state.running === 0) state.label = '';
  if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(char);
  if (typeof renderRegexScriptRuntimeStatus === 'function') renderRegexScriptRuntimeStatus(char);
  return state;
}
function cardScriptStatusSummary(char) {
  var stack = cardScriptStack(char),
    state = cardScriptRuntimeState(char);
  if (!stack || !stack.hasContent) return { kind: 'none', label: '这张卡片没有随卡脚本' };
  if (state.running > 0)
    return { kind: 'running', label: '运行中' + (state.label ? '：' + state.label : ''), error: state.lastError };
  if (char && char.scriptsEnabled === false) return { kind: 'disabled', label: '已禁用', error: state.lastError };
  if (!cardScriptsEnabled(char)) return { kind: 'disabled', label: '已禁用', error: state.lastError };
  if (state.lastError) return { kind: 'failed', label: '上次运行失败', error: state.lastError };
  return { kind: 'normal', label: '正常', error: '' };
}

// ===== Shared regex, MVU and script-library lifecycle =====
function cardRegexWorkerName(char) {
  return 'card:' + String((char && char.id) || '') + ':regex';
}

function stopCardScripts(char) {
  var stopped = [
    terminateScriptWorker(cardRegexWorkerName(char)),
    typeof terminateMvuWorker === 'function' && terminateMvuWorker(char),
    typeof stopCardScriptLibrary === 'function' && stopCardScriptLibrary(char),
  ].some(Boolean);
  if (stopped) {
    markCardScriptFinished(char, new Error('脚本已被手动停止'));
    var state = cardScriptRuntimeState(char);
    state.running = 0;
    state.label = '';
  }
  return stopped;
}

function releaseCardScriptWorkersExcept(charId) {
  if (typeof releaseRisuExecutionSession === 'function')
    Object.keys(D.chats || {}).forEach(function (id) {
      if (id !== charId) (D.chats[id].sessions || []).forEach(releaseRisuExecutionSession);
    });
  if (typeof cancelGenerationPostCommit === 'function')
    Object.keys(D.chats || {}).forEach(function (id) {
      if (id !== charId) (D.chats[id].sessions || []).forEach(cancelGenerationPostCommit);
    });
  var keep = ['card:' + String(charId || '') + ':regex'],
    released = [];
  liveScriptWorkerNames().forEach(function (name) {
    if (keep.indexOf(name) !== -1) return;
    if (terminateScriptWorker(name)) released.push(name);
  });
  if (typeof releaseMvuWorkersExcept === 'function')
    released = released.concat(
      releaseMvuWorkersExcept(charId).map(function (key) {
        return 'card:' + key + ':mvu';
      })
    );
  if (typeof releaseCardFrontends === 'function' && releaseCardFrontends(charId))
    released.push('card:' + String(charId || '') + ':frontend');
  return released;
}
