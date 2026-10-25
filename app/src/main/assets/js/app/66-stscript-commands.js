// ===== STScript host commands, ST Regex, and the five documented LALib commands =====
var _stscriptOwner = null,
  _stscriptVarDirty = null,
  _stscriptVarUndo = null,
  _stscriptVarNest = 0;
function stscriptSetOwner(owner) {
  _stscriptOwner = owner && owner.charId ? { charId: owner.charId, sessionId: owner.sessionId || '' } : null;
}
function stscriptCurrentOwner() {
  var char = typeof getChar === 'function' ? getChar() : null,
    sess = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  return { charId: (char && char.id) || '', sessionId: (sess && sess.id) || '' };
}
// The post-commit tail a command is running inside, if any. `qrPerformAuto` and the preset task
// runtime hang it on the abort controller that reaches every command as `args._abortController`,
// so it is the one thing that tells a command started by the tail's own scripts apart from the same
// command typed into the composer by the user. Commands that trigger a generation pass it to the
// drain (which then skips waiting for the task it runs in); commands that write through a guarded
// entry pass it as the call source (which then lets the write through).
function stscriptPostCommitRun(args) {
  return (args && args._abortController && args._abortController.postCommitRun) || null;
}
// ---- dry runs (the round preview running an /inject filter) ----
// A dry run hangs on the same abort controller. Its chat and global variables live on copies it keeps, so the
// script reads back what it wrote while the real ones stay as they are. Each command says on its definition what
// a dry run does with it (`dryRun`, see stscriptAddCommand): reads, flow control and variable commands (on the
// copies) run, model calls and network requests answer with a placeholder, and every other command is dropped. A read that would otherwise
// show a toast or dialog checks stscriptDryRunning and stays quiet.
var _stscriptDryRunStores = new WeakSet();
function stscriptDryRunController(notes) {
  var controller = new StscriptAbortController();
  controller.dryRun = { notes: notes, local: null, global: null };
  return controller;
}
function stscriptDryRunNote(dryRun, text) {
  if (dryRun.notes && !dryRun.notes.includes(text)) dryRun.notes.push(text);
  return text;
}
// The replacement for a command a dry run reaches, or null when the command runs.
function stscriptDryRunCall(controller, command, args, value) {
  var dryRun = controller && controller.dryRun;
  if (!dryRun) return null;
  var kind = typeof command.dryRun === 'function' ? command.dryRun(args, value) : command.dryRun;
  if (kind === 'run') return null;
  if (kind === 'model') return { value: stscriptDryRunNote(dryRun, '[预览未执行：STScript 模型调用]') };
  if (kind === 'network') return { value: stscriptDryRunNote(dryRun, '[预览未执行：STScript 联网请求]') };
  stscriptDryRunNote(dryRun, 'STScript 在预览中发起的写入已丢弃，发送时照常写入。');
  return { value: '' };
}
function stscriptDryRunStore(dryRun, key, read) {
  if (!dryRun[key]) {
    dryRun[key] = Object.assign({}, read());
    _stscriptDryRunStores.add(dryRun[key]);
  }
  return dryRun[key];
}
function stscriptChar() {
  if (
    _stscriptVarNest > 0 &&
    _stscriptOwner &&
    _stscriptOwner.charId &&
    typeof D !== 'undefined' &&
    Array.isArray(D.characters)
  ) {
    return (
      D.characters.find(function (row) {
        return row && row.id === _stscriptOwner.charId;
      }) || null
    );
  }
  return typeof getChar === 'function' ? getChar() : null;
}
function stscriptSess() {
  var char = stscriptChar();
  if (
    _stscriptVarNest > 0 &&
    _stscriptOwner &&
    _stscriptOwner.sessionId &&
    char &&
    typeof D !== 'undefined' &&
    D.chats &&
    D.chats[char.id]
  ) {
    var box = D.chats[char.id];
    return (
      (box.sessions || []).find(function (row) {
        return row && row.id === _stscriptOwner.sessionId;
      }) || null
    );
  }
  return char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
}
function stscriptMsgs() {
  var sess = stscriptSess();
  return sess && Array.isArray(sess.msgs) ? sess.msgs : [];
}
function stscriptEnsureLocal(controller) {
  var dryRun = controller && controller.dryRun;
  if (dryRun)
    return stscriptDryRunStore(dryRun, 'local', function () {
      var sess = stscriptSess();
      if (!sess) throw new Error('当前没有可用对话');
      return sess.stscriptVars;
    });
  var sess = stscriptSess();
  if (!sess) throw new Error('当前没有可用对话');
  if (!sess.stscriptVars || typeof sess.stscriptVars !== 'object' || Array.isArray(sess.stscriptVars))
    sess.stscriptVars = {};
  return sess.stscriptVars;
}
function stscriptEnsureGlobal(controller) {
  var dryRun = controller && controller.dryRun;
  if (typeof D === 'undefined' || !D.settings) throw new Error('设置尚未加载');
  if (dryRun)
    return stscriptDryRunStore(dryRun, 'global', function () {
      return D.settings.stscript && D.settings.stscript.globalVars;
    });
  if (!D.settings.stscript || typeof D.settings.stscript !== 'object' || Array.isArray(D.settings.stscript))
    D.settings.stscript = {};
  if (
    !D.settings.stscript.globalVars ||
    typeof D.settings.stscript.globalVars !== 'object' ||
    Array.isArray(D.settings.stscript.globalVars)
  )
    D.settings.stscript.globalVars = {};
  return D.settings.stscript.globalVars;
}
function stscriptMarkVars(kind) {
  _stscriptVarDirty = _stscriptVarDirty || { sessions: false, meta: false };
  _stscriptVarDirty[kind] = true;
}
function stscriptRollbackMutations(snap) {
  for (var i = (snap || []).length - 1; i >= 0; i--) snap[i].rollback();
}
function stscriptDiscardSavedMutations(keys, saved) {
  if (!_stscriptVarUndo || !saved) return;
  _stscriptVarUndo = _stscriptVarUndo.filter(function (entry) {
    return !keys.includes(entry.kind) || !saved.includes(entry);
  });
}
function stscriptRecordRollback(kind, rollback) {
  if (!_stscriptVarUndo) _stscriptVarUndo = [];
  _stscriptVarUndo.push({ kind: kind, rollback: rollback });
}
function stscriptWriteProperty(object, key, value, kind, remove) {
  if (_stscriptDryRunStores.has(object)) {
    if (remove) delete object[key];
    else object[key] = value;
    return;
  }
  var before = Object.getOwnPropertyDescriptor(object, key);
  if (remove) delete object[key];
  else Object.defineProperty(object, key, { value: value, writable: true, configurable: true, enumerable: true });
  var present = Object.prototype.hasOwnProperty.call(object, key),
    written = object[key];
  stscriptRecordRollback(kind, function () {
    if (Object.prototype.hasOwnProperty.call(object, key) !== present || object[key] !== written) return;
    if (before) Object.defineProperty(object, key, before);
    else delete object[key];
  });
}
async function stscriptSaveMsg(role, content, extra) {
  var sess = stscriptSess(),
    char = stscriptChar();
  if (!sess || !char) throw new Error('当前没有可用对话');
  var visible = typeof getChar === 'function' ? getChar() : null,
    ownerVisible = visible && String(visible.id || '') === String(char.id || ''),
    active = ownerVisible && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  if (!_stscriptOwner || (ownerVisible && sess === active)) {
    if (typeof saveMsg !== 'function') throw new Error('无法写入消息');
    return saveMsg(role, content, extra);
  }
  var seq =
    typeof allocateMessageSeq === 'function'
      ? allocateMessageSeq(sess)
      : ((sess.nextMessageSeq = Math.max(1, Number(sess.nextMessageSeq) || 1)), sess.nextMessageSeq++);
  var msg = Object.assign({ role: role, content: content, time: Date.now(), seq: seq }, extra || {});
  sess.msgs.push(msg);
  if (typeof markMessageMacroEffects === 'function') markMessageMacroEffects(char, msg);
  try {
    if (typeof saveData === 'function') await saveData('sessions', { urgent: true });
  } catch (error) {
    var index = sess.msgs.indexOf(msg);
    if (index >= 0) sess.msgs.splice(index, 1);
    throw error;
  }
  return msg;
}
function stscriptNumericVar(value) {
  if (value == null) return '';
  var text = typeof value === 'string' ? value : String(value);
  if (text.trim() === '') return text;
  return isNaN(Number(text)) ? text : Number(text);
}
function stscriptGetStore(store, name, args) {
  var value = store[args && args.key != null ? args.key : name];
  if (args && args.index != null && args.index !== '') {
    try {
      value = JSON.parse(value);
      var num = Number(args.index);
      value = Number.isNaN(num) ? value[args.index] : value[num];
      if (typeof value === 'object' && value != null) value = JSON.stringify(value);
    } catch (_) {}
  }
  return stscriptNumericVar(value);
}
function stscriptSetStore(store, name, value, args, kind) {
  if (!name) throw new Error('变量名不能为空');
  if (args && args.index != null && args.index !== '') {
    try {
      var parsed = JSON.parse(store[name] ?? 'null'),
        num = Number(args.index);
      if (Number.isNaN(num)) {
        if (parsed == null) parsed = {};
        parsed[args.index] = stscriptConvertType(value, args.as);
      } else {
        if (parsed == null) parsed = [];
        parsed[num] = stscriptConvertType(value, args.as);
      }
      stscriptWriteProperty(store, name, JSON.stringify(parsed), kind);
    } catch (_) {}
  } else stscriptWriteProperty(store, name, value, kind);
  if (kind && !_stscriptDryRunStores.has(store)) stscriptMarkVars(kind);
  return value;
}
function stscriptDeleteStore(store, name, kind) {
  stscriptWriteProperty(store, name, undefined, kind, true);
  if (!_stscriptDryRunStores.has(store)) stscriptMarkVars(kind);
  return '';
}
function stscriptResolveHostMacro(name, args, scope, controller) {
  var msgs = stscriptMsgs(),
    last = msgs[msgs.length - 1],
    char = stscriptChar(),
    persona = typeof getActivePersona === 'function' ? getActivePersona(char && char.id) : null,
    input = $('user-input');
  if (name === 'input') return input ? String(input.value || '') : '';
  if (name === 'lastMessage') return last ? String(last.content || '') : '';
  if (name === 'lastMessageId') return msgs.length ? String(msgs.length - 1) : '-1';
  if (name === 'lastUserMessage') {
    for (var i = msgs.length - 1; i >= 0; i--)
      if (msgs[i] && msgs[i].role === 'user') return String(msgs[i].content || '');
    return '';
  }
  if (name === 'lastCharMessage') {
    for (var j = msgs.length - 1; j >= 0; j--)
      if (msgs[j] && msgs[j].role === 'assistant') return String(msgs[j].content || '');
    return '';
  }
  if (name === 'char')
    return char && typeof canonicalCharacterName === 'function'
      ? canonicalCharacterName(char)
      : (char && char.name) || '';
  if (name === 'user') return (persona && persona.name) || '用户';
  if (name === 'noop') return '';
  if (name === 'newline') return '\n';
  if (name === 'getvar')
    return String(stscriptGetStore(stscriptSess() ? stscriptEnsureLocal(controller) : {}, args[0], { index: args[1] }));
  if (name === 'getglobalvar')
    return String(
      stscriptGetStore(typeof D !== 'undefined' && D.settings ? stscriptEnsureGlobal(controller) : {}, args[0], {
        index: args[1],
      })
    );
  return '{{' + [name].concat(args).join('::') + '}}';
}
function stscriptOperand(args, raw) {
  if (raw === undefined) return undefined;
  if (raw === '') return '';
  if (raw instanceof StscriptClosure) return raw;
  var text = String(raw),
    num = text.trim() ? Number(text) : NaN;
  if (!isNaN(num)) return num;
  if (args._scope && args._scope.existsVariable(text)) {
    var scoped = args._scope.getVariable(text);
    return scoped == null ? '' : scoped;
  }
  var local = stscriptSess() ? stscriptEnsureLocal(args._abortController) : {};
  if (Object.prototype.hasOwnProperty.call(local, text)) return stscriptGetStore(local, text, {});
  var global = typeof D !== 'undefined' && D.settings ? stscriptEnsureGlobal(args._abortController) : {};
  if (Object.prototype.hasOwnProperty.call(global, text)) return stscriptGetStore(global, text, {});
  return text;
}
function stscriptEvalBoolean(rule, a, b) {
  if (a === undefined) throw new Error('缺少左操作数');
  if (b === undefined) {
    var truthy = rule !== 'not';
    if (stscriptIsTrue(a)) return truthy;
    if (stscriptIsFalse(a)) return !truthy;
    return a ? truthy : !truthy;
  }
  rule = rule || 'eq';
  if (typeof a === 'number' && typeof b === 'number' && rule !== 'in' && rule !== 'nin') {
    if (rule === 'gt') return a > b;
    if (rule === 'gte') return a >= b;
    if (rule === 'lt') return a < b;
    if (rule === 'lte') return a <= b;
    if (rule === 'eq') return a === b;
    if (rule === 'neq') return a !== b;
    throw new Error('未知数字比较规则：' + rule);
  }
  var left = String(typeof a === 'string' ? a : JSON.stringify(a)).toLowerCase(),
    right = String(typeof b === 'string' ? b : JSON.stringify(b)).toLowerCase();
  if (rule === 'in') return left.indexOf(right) >= 0;
  if (rule === 'nin') return left.indexOf(right) < 0;
  if (rule === 'eq') return left === right;
  if (rule === 'neq') return left !== right;
  throw new Error('未知字符串比较规则：' + rule);
}
function stscriptJoin(value) {
  return Array.isArray(value)
    ? value
        .map(function (item) {
          return item instanceof StscriptClosure ? item : String(item == null ? '' : item);
        })
        .join(' ')
    : value == null
      ? ''
      : String(value);
}
async function stscriptRunClosureOrText(command, args) {
  if (command instanceof StscriptClosure) {
    if (!command.breakController) command.breakController = new StscriptBreakController();
    command.abortController = args._abortController || command.abortController;
    return command.execute();
  }
  return executeStscript(String(command || ''), {
    scope: args._scope,
    parserFlags: args._parserFlags,
    abortController: args._abortController,
    source: args._scope && args._scope.source,
  });
}
function stscriptParseRange(value, max) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return [Math.max(0, max - 1), Math.max(0, max - 1)];
  var match = /^(-?\d+)\s*(?:-\s*(-?\d+))?$/.exec(text);
  if (!match) throw new Error('消息编号无效：' + text);
  function idx(raw) {
    var n = Number(raw);
    if (Object.is(n, -0) || n < 0) n = max + n;
    if (!Number.isInteger(n) || n < 0 || n >= max) throw new Error('消息不存在：' + raw);
    return n;
  }
  var start = idx(match[1]),
    end = match[2] == null ? start : idx(match[2]);
  return start <= end ? [start, end] : [end, start];
}
function stscriptParseRegexLiteral(value) {
  var source = String(value == null ? '' : value).trim();
  if (!source) throw new Error('正则不能为空');
  if (typeof regexScriptLiteralParts === 'function') {
    var parts = regexScriptLiteralParts(source);
    if (!parts.valid) throw new Error(parts.reason || '正则无效');
    return parts;
  }
  if (source.charAt(0) !== '/') return { pattern: source, flags: '' };
  var last = source.lastIndexOf('/');
  if (last <= 0) throw new Error('正则格式应为 /pattern/flags');
  return { pattern: source.slice(1, last), flags: source.slice(last + 1) };
}
function stscriptApplyParts(parts) {
  return (parts || [])
    .map(function (part) {
      if (part.literal != null) return part.literal;
      var replace = String(part.replacement || ''),
        match = part.match || [];
      return replace.replace(/\$(\d+)|\$<([^>]+)>|\$&/g, function (token, number, name) {
        var value = number ? match[Number(number)] : name ? (part.groups || {})[name] : match[0];
        return value == null ? '' : String(value);
      });
    })
    .join('');
}
async function stscriptFlushVars() {
  if (_stscriptVarNest > 1 || !_stscriptVarDirty) return;
  var dirty = _stscriptVarDirty,
    _stscriptVarDirtyHold = dirty;
  _stscriptVarDirty = null;
  var keys = [];
  if (dirty.sessions) keys.push('sessions');
  if (dirty.meta) keys.push('meta');
  if (!keys.length) return;
  if (typeof saveData !== 'function') return;
  var snapshot = _stscriptVarUndo;
  _stscriptVarUndo = [];
  try {
    await saveData(keys.length === 1 ? keys[0] : keys, { urgent: true });
  } catch (error) {
    _stscriptVarDirty = Object.assign({}, _stscriptVarDirtyHold, _stscriptVarDirty || {});
    stscriptRollbackMutations(snapshot);
    throw error;
  }
  if (typeof refreshCardScriptLibraryContext === 'function')
    refreshCardScriptLibraryContext(stscriptChar(), stscriptSess());
}
function stscriptBeginRun(options) {
  options = options || {};
  if (options.nested) {
    _stscriptVarNest++;
    return;
  }
  _stscriptVarNest = 1;
  stscriptSetOwner(options.owner || stscriptCurrentOwner());
  _stscriptVarUndo = [];
  _stscriptVarDirty = null;
}
function stscriptEndRun() {
  _stscriptVarNest = Math.max(0, (_stscriptVarNest || 1) - 1);
  if (!_stscriptVarNest) _stscriptOwner = null;
}

// JS-Slash-Runner 4.11.3 compatibility commands. Audio commands and iframe functions both call
// the canonical runtime in 83-card-bgm-player.js; /audioenable remains the reference no-op.
stscriptAddCommand({
  name: 'audioenable',
  namedArgumentList: [{ name: 'type' }, { name: 'state' }],
  callback: function () {
    return '';
  },
});
stscriptAddCommand({
  name: 'audioplay',
  namedArgumentList: [{ name: 'type' }, { name: 'play' }],
  callback: function (args) {
    var type = String(args.type || '').toLowerCase();
    if (type !== 'bgm' && type !== 'ambient') return '';
    tavernAudioSetPlaying(type, Boolean(args.play == null ? 'true' : args.play));
    return '';
  },
});
stscriptAddCommand({
  name: 'audioselect',
  namedArgumentList: [{ name: 'type' }],
  callback: function (args, value) {
    var type = String(args.type || '').toLowerCase(),
      url = Array.isArray(value) ? value.join(' ') : String(value || '').trim();
    if ((type !== 'bgm' && type !== 'ambient') || !url) return '';
    tavernAudioSelect(type, url);
    return '';
  },
});
stscriptAddCommand({
  name: 'audioimport',
  namedArgumentList: [{ name: 'type' }, { name: 'play' }],
  callback: function (args, value) {
    var type = String(args.type || '').toLowerCase(),
      urls = Array.isArray(value) ? value.join(' ') : String(value || '');
    if ((type !== 'bgm' && type !== 'ambient') || !urls.trim()) return '';
    tavernAudioImport(type, urls, args.play == null || !stscriptIsFalse(args.play));
    return '';
  },
});
stscriptAddCommand({
  name: 'audiomode',
  namedArgumentList: [{ name: 'type' }, { name: 'mode' }],
  callback: function (args) {
    var type = String(args.type || '').toLowerCase(),
      mode = String(args.mode || '').toLowerCase();
    if ((type !== 'bgm' && type !== 'ambient') || !{ repeat: 1, random: 1, single: 1, stop: 1 }[mode]) return '';
    tavernAudioSetSlashMode(type, mode);
    return '';
  },
});
stscriptAddCommand({
  name: 'event-emit',
  namedArgumentList: [{ name: 'event' }, { name: 'data' }],
  callback: async function (args) {
    var event = String(args.event || '').trim(),
      data = args.data == null ? [] : Array.isArray(args.data) ? args.data : [args.data];
    if (!event) throw new Error('/event-emit 需要 event');
    if (typeof cardFrontendAwaitBroadcastEvent === 'function')
      await cardFrontendAwaitBroadcastEvent(event, data.map(String));
    return event;
  },
});

// 上游 letCallback/varCallback：首个值是字符串时拼接，否则原样保存闭包；无值时 /let 声明空变量、/var 只读。
function stscriptScopeVariableCall(args, value) {
  var values = Array.isArray(value) ? value.slice() : [value],
    hasKey = args.key !== undefined,
    key = hasKey ? args.key : values.shift();
  if (typeof key !== 'string' || !key) throw new Error('变量名必须是非空字符串');
  var hasValue = hasKey ? !!args._hasUnnamedArgument : values.length > 0;
  return {
    key: key,
    hasValue: hasValue,
    value: hasValue ? (typeof values[0] === 'string' ? values.join(' ') : values[0]) : undefined,
  };
}
stscriptAddCommand({
  name: 'let',
  dryRun: 'run',
  splitUnnamedArgument: true,
  splitUnnamedArgumentCount: 1,
  namedArgumentList: [{ name: 'key' }],
  callback: function (args, value) {
    var call = stscriptScopeVariableCall(args, value),
      val = call.hasValue ? call.value : '';
    args._scope.letVariable(call.key, val);
    return val;
  },
});
stscriptAddCommand({
  name: 'var',
  dryRun: 'run',
  splitUnnamedArgument: true,
  splitUnnamedArgumentCount: 1,
  namedArgumentList: [{ name: 'key' }, { name: 'index' }, { name: 'as' }],
  callback: function (args, value) {
    var call = stscriptScopeVariableCall(args, value);
    if (!call.hasValue) return args._scope.getVariable(call.key, args.index);
    args._scope.setVariable(call.key, call.value, args.index, args.as);
    return call.value;
  },
});
stscriptAddCommand({
  name: 'setvar',
  dryRun: 'run',
  aliases: ['setchatvar'],
  namedArgumentList: [{ name: 'key' }, { name: 'name' }, { name: 'index' }, { name: 'as' }],
  callback: function (args, value) {
    return String(
      stscriptSetStore(
        stscriptEnsureLocal(args._abortController),
        args.key || args.name,
        Array.isArray(value) ? value.join(' ') : value,
        args,
        'sessions'
      )
    );
  },
});
stscriptAddCommand({
  name: 'getvar',
  dryRun: 'run',
  aliases: ['getchatvar'],
  namedArgumentList: [{ name: 'key' }, { name: 'index' }],
  callback: function (args, value) {
    return String(
      stscriptGetStore(stscriptEnsureLocal(args._abortController), args.key || value, {
        key: args.key,
        index: args.index,
      })
    );
  },
});
stscriptAddCommand({
  name: 'addvar',
  dryRun: 'run',
  aliases: ['addchatvar'],
  namedArgumentList: [{ name: 'key' }],
  callback: function (args, value) {
    var cur = Number(stscriptGetStore(stscriptEnsureLocal(args._abortController), args.key, {})) || 0,
      next = cur + (Number(value) || 0);
    stscriptSetStore(stscriptEnsureLocal(args._abortController), args.key, next, {}, 'sessions');
    return String(next);
  },
});
stscriptAddCommand({
  name: 'incvar',
  dryRun: 'run',
  aliases: ['incchatvar'],
  namedArgumentList: [{ name: 'key' }],
  callback: function (args) {
    var key = args.key || arguments[1],
      cur = Number(stscriptGetStore(stscriptEnsureLocal(args._abortController), key, {})) || 0,
      next = cur + 1;
    stscriptSetStore(stscriptEnsureLocal(args._abortController), key, next, {}, 'sessions');
    return String(next);
  },
});
stscriptAddCommand({
  name: 'decvar',
  dryRun: 'run',
  aliases: ['decchatvar'],
  namedArgumentList: [{ name: 'key' }],
  callback: function (args, value) {
    var key = args.key || value,
      cur = Number(stscriptGetStore(stscriptEnsureLocal(args._abortController), key, {})) || 0,
      next = cur - 1;
    stscriptSetStore(stscriptEnsureLocal(args._abortController), key, next, {}, 'sessions');
    return String(next);
  },
});
stscriptAddCommand({
  name: 'flushvar',
  dryRun: 'run',
  aliases: ['flushchatvar'],
  callback: function (args, value) {
    var key = String(value || '');
    if (!key) throw new Error('/flushvar 需要变量名');
    return stscriptDeleteStore(stscriptEnsureLocal(args._abortController), key, 'sessions');
  },
});
stscriptAddCommand({
  name: 'setglobalvar',
  dryRun: 'run',
  namedArgumentList: [{ name: 'key' }, { name: 'index' }, { name: 'as' }],
  callback: function (args, value) {
    return String(
      stscriptSetStore(
        stscriptEnsureGlobal(args._abortController),
        args.key,
        Array.isArray(value) ? value.join(' ') : value,
        args,
        'meta'
      )
    );
  },
});
stscriptAddCommand({
  name: 'getglobalvar',
  dryRun: 'run',
  namedArgumentList: [{ name: 'key' }, { name: 'index' }],
  callback: function (args, value) {
    return String(
      stscriptGetStore(stscriptEnsureGlobal(args._abortController), args.key || value, {
        key: args.key,
        index: args.index,
      })
    );
  },
});
stscriptAddCommand({
  name: 'addglobalvar',
  dryRun: 'run',
  namedArgumentList: [{ name: 'key' }],
  callback: function (args, value) {
    var cur = Number(stscriptGetStore(stscriptEnsureGlobal(args._abortController), args.key, {})) || 0,
      next = cur + (Number(value) || 0);
    stscriptSetStore(stscriptEnsureGlobal(args._abortController), args.key, next, {}, 'meta');
    return String(next);
  },
});
stscriptAddCommand({
  name: 'incglobalvar',
  dryRun: 'run',
  namedArgumentList: [{ name: 'key' }],
  callback: function (args, value) {
    var key = args.key || value,
      cur = Number(stscriptGetStore(stscriptEnsureGlobal(args._abortController), key, {})) || 0,
      next = cur + 1;
    stscriptSetStore(stscriptEnsureGlobal(args._abortController), key, next, {}, 'meta');
    return String(next);
  },
});
stscriptAddCommand({
  name: 'decglobalvar',
  dryRun: 'run',
  namedArgumentList: [{ name: 'key' }],
  callback: function (args, value) {
    var key = args.key || value,
      cur = Number(stscriptGetStore(stscriptEnsureGlobal(args._abortController), key, {})) || 0,
      next = cur - 1;
    stscriptSetStore(stscriptEnsureGlobal(args._abortController), key, next, {}, 'meta');
    return String(next);
  },
});
stscriptAddCommand({
  name: 'flushglobalvar',
  dryRun: 'run',
  callback: function (args, value) {
    var key = String(value || '');
    if (!key) throw new Error('/flushglobalvar 需要变量名');
    return stscriptDeleteStore(stscriptEnsureGlobal(args._abortController), key, 'meta');
  },
});
stscriptAddCommand({
  name: 'listvar',
  dryRun: stscriptDryRunReadUnlessShown('object'),
  aliases: ['listchatvar'],
  namedArgumentList: [{ name: 'scope' }, { name: 'return' }],
  // ST returns [{key, value, scope}] and shows a popup unless return= says otherwise; without return= Yeyu
  // returns that list silently, so unattended scripts never wait on a dialog.
  callback: function (args) {
    var scope = String(args.scope || 'all')
        .trim()
        .toLowerCase(),
      returnType = String(args.return || 'object').toLowerCase(),
      stores = [];
    if (!['object', 'none', 'chat-html', 'popup-html', 'toast-html'].includes(returnType))
      throw new Error('/listvar 的 return 必须是 object、chat-html、popup-html、toast-html 或 none');
    if (scope !== 'global')
      stores.push({
        scope: 'local',
        label: '本地变量',
        rows: stscriptSess() ? stscriptEnsureLocal(args._abortController) : {},
      });
    if (scope !== 'local')
      stores.push({
        scope: 'global',
        label: '全局变量',
        rows: typeof D !== 'undefined' && D.settings ? stscriptEnsureGlobal(args._abortController) : {},
      });
    var list = [];
    stores.forEach(function (store) {
      Object.keys(store.rows).forEach(function (key) {
        list.push({ key: key, value: store.rows[key], scope: store.scope });
      });
    });
    return stscriptPromptReturn(returnType, list, {
      title: '变量',
      text: stores
        .map(function (store) {
          var lines = list
            .filter(function (row) {
              return row.scope === store.scope;
            })
            .map(function (row) {
              return row.key + ': ' + (typeof row.value === 'string' ? row.value : JSON.stringify(row.value));
            });
          return store.label + '：\n' + (lines.length ? lines.join('\n') : '无');
        })
        .join('\n\n'),
    });
  },
});
stscriptAddCommand({
  name: 'if',
  dryRun: 'run',
  namedArgumentList: [
    { name: 'left' },
    { name: 'a' },
    { name: 'first' },
    { name: 'x' },
    { name: 'right' },
    { name: 'b' },
    { name: 'second' },
    { name: 'y' },
    { name: 'rule' },
    { name: 'else' },
  ],
  callback: async function (args, value) {
    var left = stscriptOperand(args, args.left ?? args.a ?? args.first ?? args.x),
      right = stscriptOperand(args, args.right ?? args.b ?? args.second ?? args.y),
      ok = stscriptEvalBoolean(args.rule, left, right);
    var command = Array.isArray(value) ? (value[0] instanceof StscriptClosure ? value[0] : value.join(' ')) : value;
    if (ok && command) return (await stscriptRunClosureOrText(command, args)).pipe;
    if (!ok && args.else) return (await stscriptRunClosureOrText(args.else, args)).pipe;
    return '';
  },
});
stscriptAddCommand({
  name: 'times',
  dryRun: 'run',
  splitUnnamedArgument: true,
  splitUnnamedArgumentCount: 1,
  namedArgumentList: [{ name: 'guard' }],
  unnamedArgumentList: [{ name: 'repeats' }],
  callback: async function (args, value) {
    var repeats, command;
    if (Array.isArray(value)) {
      repeats = value[0];
      command = value[1] instanceof StscriptClosure ? value[1] : value.slice(1).join(' ');
    } else {
      var parts = String(value || '').split(' ');
      repeats = parts.shift();
      command = parts.join(' ');
    }
    var guardOff = stscriptIsFalse(args.guard),
      limit = Math.min(Number(repeats) || 0, guardOff ? Number.MAX_SAFE_INTEGER : STSCRIPT_MAX_LOOPS),
      result = '';
    for (var i = 0; i < limit; i++) {
      if (args._abortController && args._abortController.signal.aborted) break;
      if (command instanceof StscriptClosure) {
        var runner = command.getCopy();
        runner.breakController = new StscriptBreakController();
        runner.abortController = args._abortController;
        runner.scope.parent = args._scope;
        runner.scope.setMacro('timesIndex', i);
        result = await runner.execute();
      } else
        result = await executeStscript(String(command).replace(/\{\{timesIndex\}\}/g, String(i)), {
          scope: args._scope,
          parserFlags: args._parserFlags,
          abortController: args._abortController,
        });
      if (result.isAborted || result.isBreak) break;
    }
    return (result && result.pipe) || '';
  },
});
stscriptAddCommand({
  name: 'while',
  dryRun: 'run',
  namedArgumentList: [
    { name: 'left' },
    { name: 'a' },
    { name: 'right' },
    { name: 'b' },
    { name: 'rule' },
    { name: 'guard' },
  ],
  callback: async function (args, value) {
    var command = Array.isArray(value) ? (value[0] instanceof StscriptClosure ? value[0] : value.join(' ')) : value,
      guardOff = stscriptIsFalse(args.guard),
      limit = guardOff ? Number.MAX_SAFE_INTEGER : STSCRIPT_MAX_LOOPS,
      result = '';
    for (var i = 0; i < limit; i++) {
      if (args._abortController && args._abortController.signal.aborted) break;
      if (
        !stscriptEvalBoolean(
          args.rule,
          stscriptOperand(args, args.left ?? args.a),
          stscriptOperand(args, args.right ?? args.b)
        )
      )
        break;
      if (!command) break;
      result = await stscriptRunClosureOrText(command, args);
      if (result.isAborted || result.isBreak) break;
    }
    return (result && result.pipe) || '';
  },
});
stscriptAddCommand({
  name: 'abort',
  dryRun: 'run',
  namedArgumentList: [{ name: 'quiet' }],
  callback: function (args, value) {
    if (!args._abortController) throw new Error('/abort 缺少中止控制器');
    args._abortController.abort(String(value || '/abort'), !stscriptIsFalse(args.quiet == null ? 'true' : args.quiet));
    return '';
  },
});
stscriptAddCommand({
  name: 'pass',
  dryRun: 'run',
  callback: function (args, value) {
    if (
      Array.isArray(value) &&
      value.some(function (item) {
        return item instanceof StscriptClosure;
      })
    )
      throw new Error('/pass 不支持多个脚本块');
    return Array.isArray(value) ? JSON.stringify(value) : value;
  },
});
stscriptAddCommand({
  name: 'delay',
  dryRun: 'run',
  aliases: ['wait', 'sleep'],
  callback: async function (args, value) {
    await stscriptDelay(value, args._abortController);
    return '';
  },
});
stscriptAddCommand({
  name: 'run',
  aliases: ['call', 'exec'],
  // A closure runs dry command by command; a Quick Reply may fill the composer and send, so a dry run drops it.
  dryRun: function (args, name) {
    if (!name || name instanceof StscriptClosure) return 'run';
    name = Array.isArray(name) ? name.join(' ') : String(name).trim();
    return args._scope && args._scope.existsVariable(name) ? 'run' : null;
  },
  callback: async function (args, name) {
    if (!name) throw new Error('/run 需要名称或脚本块');
    if (name instanceof StscriptClosure) {
      name.breakController = new StscriptBreakController();
      name.abortController = args._abortController;
      return (await name.execute()).pipe;
    }
    name = Array.isArray(name) ? name.join(' ') : String(name).trim();
    if (args._scope && args._scope.existsVariable(name)) {
      var closure = args._scope.getVariable(name);
      if (!(closure instanceof StscriptClosure)) throw new Error('"' + name + '" 不能运行');
      closure.scope.parent = args._scope;
      closure.breakController = new StscriptBreakController();
      closure.abortController = args._abortController;
      closure.providedArgumentList = closure.argumentList
        .filter(function (arg) {
          return Object.prototype.hasOwnProperty.call(args, arg.name);
        })
        .map(function (arg) {
          return { name: arg.name, value: args[arg.name] };
        });
      return (await closure.execute()).pipe;
    }
    if (typeof executeQuickReplyByName !== 'function') throw new Error('快捷栏尚未加载');
    return await executeQuickReplyByName(name, args, { abortController: args._abortController });
  },
});
stscriptAddCommand({
  name: 'echo',
  dryRun: 'run',
  callback: function (args, value) {
    var text = stscriptJoin(value);
    if (!stscriptDryRunning(args) && typeof toast === 'function') toast(text || ' ', 'info');
    return text;
  },
});
// ST's message commands leave the pipe alone unless return= asks for the text (pipe) or the message (object).
function stscriptMessageReturnType(args) {
  var returnType = String((args && args.return) || 'none').toLowerCase();
  if (!['none', 'pipe', 'object', 'toast-html'].includes(returnType))
    throw new Error('return 必须是 pipe、object、toast-html 或 none');
  return returnType;
}
function stscriptMessageReturn(returnType, message, text) {
  return stscriptPromptReturn(returnType, message || { content: text }, { text: text });
}
// ST message commands await the message event before painting, then announce the rendered row. A character
// message carries its origin as the event type: 'command' for /sendas and the like, 'extension' for /imagine.
async function stscriptRenderSentMessage(session, message, character, commandArgs, type) {
  var index = session.msgs.indexOf(message),
    args = character ? [index, type || 'command'] : [index],
    broadcast = index >= 0 && typeof cardFrontendAwaitBroadcastEvent === 'function',
    controller = commandArgs && commandArgs._abortController,
    run =
      typeof _qrTop !== 'undefined' && _qrTop && controller && _qrTop.abort.signal === controller.signal
        ? _qrTop
        : null;
  return stscriptWithRequestController(commandArgs, async function (requestController) {
    if (typeof refreshCardScriptLibraryContext === 'function')
      refreshCardScriptLibraryContext(stscriptChar(), session);
    if (broadcast)
      await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES[character ? 'MESSAGE_RECEIVED' : 'MESSAGE_SENT'],
        args,
        { stscriptRun: run, signal: requestController.signal }
      );
    if (typeof renderChat === 'function') renderChat();
    if (broadcast)
      await cardFrontendAwaitBroadcastEvent(
        CARD_FRONTEND_TAVERN_EVENT_VALUES[character ? 'CHARACTER_MESSAGE_RENDERED' : 'USER_MESSAGE_RENDERED'],
        args,
        { stscriptRun: run, signal: requestController.signal }
      );
  });
}
stscriptAddCommand({
  name: 'comment',
  namedArgumentList: [{ name: 'return' }],
  callback: async function (args, value) {
    var text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value),
      returnType = stscriptMessageReturnType(args),
      session = stscriptSess();
    var message = await stscriptSaveMsg('system', text, {
      kind: 'stscript-comment',
      excludeFromMemory: true,
      excludeFromWorldBook: true,
    });
    await stscriptRenderSentMessage(session, message, false, args);
    return stscriptMessageReturn(returnType, message, text);
  },
});
stscriptAddCommand({
  name: 'sys',
  aliases: ['nar'],
  rawQuotes: true,
  namedArgumentList: [{ name: 'compact' }, { name: 'at' }, { name: 'name' }, { name: 'return' }],
  callback: async function (args, value) {
    var text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value),
      returnType = stscriptMessageReturnType(args),
      sess = stscriptSess(),
      char = stscriptChar();
    if (!sess) throw new Error('当前没有可用对话');
    if (!char) throw new Error('当前没有可用角色');
    var at = args && args.at,
      insertAt = sess.msgs.length;
    if (at !== undefined && at !== null && String(at).trim() !== '') {
      insertAt = Number(at);
      var length = sess.msgs.length;
      if (Number.isInteger(insertAt)) {
        if (insertAt < 0 || Object.is(insertAt, -0)) insertAt = length + insertAt;
        if (insertAt < 0 || insertAt > length) insertAt = length;
      } else insertAt = length;
    }
    var seq =
        typeof allocateMessageSeq === 'function'
          ? allocateMessageSeq(sess)
          : ((sess.nextMessageSeq = Math.max(1, Number(sess.nextMessageSeq) || 1)), sess.nextMessageSeq++),
      message = {
        role: 'system',
        content: text.trim(),
        time: Date.now(),
        seq: seq,
        kind: 'stscript-system',
        speaker: String((args && args.name) || '系统'),
        compact: stscriptIsTrue(args && args.compact),
      };
    sess.msgs.splice(insertAt, 0, message);
    try {
      if (typeof saveData === 'function') await saveData('sessions', { urgent: true });
    } catch (error) {
      sess.msgs.splice(insertAt, 1);
      sess.nextMessageSeq = Math.max(1, Number(seq) || 1);
      throw error;
    }
    await stscriptRenderSentMessage(sess, message, false, args);
    return stscriptMessageReturn(returnType, message, message.content);
  },
});
stscriptAddCommand({
  name: 'len',
  dryRun: 'run',
  aliases: ['length'],
  callback: function (args, value) {
    var text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value);
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return String(parsed.length);
      if (parsed && typeof parsed === 'object') return String(Object.keys(parsed).length);
    } catch (_) {}
    return String(text.length);
  },
});
stscriptAddCommand({
  name: 'lower',
  dryRun: 'run',
  aliases: ['lowercase', 'to-lower'],
  callback: function (args, value) {
    return String(value == null ? '' : value).toLowerCase();
  },
});
stscriptAddCommand({
  name: 'upper',
  dryRun: 'run',
  aliases: ['uppercase', 'to-upper'],
  callback: function (args, value) {
    return String(value == null ? '' : value).toUpperCase();
  },
});
stscriptAddCommand({
  name: 'trimstart',
  dryRun: 'run',
  callback: function (args, value) {
    return String(value == null ? '' : value).replace(/^\s+/, '');
  },
});
stscriptAddCommand({
  name: 'trimend',
  dryRun: 'run',
  callback: function (args, value) {
    return String(value == null ? '' : value).replace(/\s+$/, '');
  },
});
stscriptAddCommand({
  name: 'substr',
  dryRun: 'run',
  aliases: ['substring'],
  namedArgumentList: [{ name: 'start' }, { name: 'end' }],
  callback: function (args, value) {
    var text = String(value == null ? '' : value),
      start = Number(args.start) || 0,
      end = args.end == null ? undefined : Number(args.end);
    return text.slice(start, end);
  },
});
stscriptAddCommand({
  name: 'replace',
  dryRun: 'run',
  aliases: ['re'],
  namedArgumentList: [{ name: 'mode' }, { name: 'pattern' }, { name: 'replacer' }],
  callback: function (args, value) {
    if (!args.pattern) throw new Error('/replace 需要 pattern');
    var text = stscriptJoin(value),
      replacement = String(args.replacer == null ? '' : args.replacer);
    if (!args.mode || args.mode === 'literal') return text.replaceAll(String(args.pattern), replacement);
    if (args.mode !== 'regex') throw new Error('/replace mode 需要 literal 或 regex');
    var parts = stscriptParseRegexLiteral(args.pattern);
    return text.replace(new RegExp(parts.pattern, parts.flags), replacement);
  },
});
stscriptAddCommand({
  name: 'rand',
  dryRun: 'run',
  aliases: ['random'],
  namedArgumentList: [{ name: 'from' }, { name: 'to' }],
  callback: function (args, value) {
    if (value) {
      try {
        var list = JSON.parse(value);
        if (Array.isArray(list) && list.length) return String(list[Math.floor(Math.random() * list.length)]);
      } catch (_) {
        var parts = String(value).split(',');
        if (parts.length > 1) return parts[Math.floor(Math.random() * parts.length)].trim();
      }
    }
    var from = Number(args.from);
    var to = Number(args.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('/rand 需要范围或列表');
    return String(Math.floor(Math.random() * (to - from + 1)) + from);
  },
});
function stscriptMath(op) {
  return function (args, value) {
    var text = String(value == null ? '' : value).trim(),
      parts = text.split(/\s+/).map(Number);
    if (
      parts.some(function (n) {
        return !Number.isFinite(n);
      })
    )
      throw new Error('/' + op + ' 需要数字');
    var a = parts[0],
      b = parts[1];
    if (op === 'add')
      return String(
        parts.reduce(function (s, n) {
          return s + n;
        }, 0)
      );
    if (op === 'sub') return String(a - b);
    if (op === 'mul')
      return String(
        parts.reduce(function (s, n) {
          return s * n;
        }, 1)
      );
    if (op === 'div') {
      if (!b) throw new Error('除数不能为 0');
      return String(a / b);
    }
    if (op === 'mod') return String(a % b);
    if (op === 'pow') return String(Math.pow(a, b));
    if (op === 'min') return String(Math.min.apply(null, parts));
    if (op === 'max') return String(Math.max.apply(null, parts));
    if (op === 'abs') return String(Math.abs(a));
    if (op === 'round') return String(Math.round(a));
    if (op === 'sqrt') return String(Math.sqrt(a));
    if (op === 'sin') return String(Math.sin(a));
    if (op === 'cos') return String(Math.cos(a));
    return String(a);
  };
}
['add', 'sub', 'mul', 'div', 'mod', 'pow', 'min', 'max', 'abs', 'round', 'sqrt', 'sin', 'cos'].forEach(function (name) {
  stscriptAddCommand({ name: name, dryRun: 'run', callback: stscriptMath(name) });
});
stscriptAddCommand({
  name: 'help',
  dryRun: 'run',
  aliases: ['?'],
  callback: function (args, value) {
    var name = String(value == null ? '' : value)
      .replace(/^\//, '')
      .trim();
    if (!name)
      return Object.keys(STSCRIPT_COMMANDS)
        .filter(function (key) {
          return (
            STSCRIPT_COMMANDS[key] &&
            STSCRIPT_COMMANDS[key].name === key &&
            STSCRIPT_COMMANDS[key].capability !== 'unavailable'
          );
        })
        .sort()
        .map(function (key) {
          return '/' + key;
        })
        .join('\n');
    if (typeof STSCRIPT_UNAVAILABLE === 'object' && STSCRIPT_UNAVAILABLE[name]) return STSCRIPT_UNAVAILABLE[name];
    var command = STSCRIPT_COMMANDS[name];
    if (!command) throw new Error('未知命令 /' + name);
    return (
      '/' + command.name + (command.aliases && command.aliases.length ? ' 别名：' + command.aliases.join(', ') : '')
    );
  },
});
stscriptAddCommand({
  name: 'setinput',
  callback: function (args, value) {
    var input = $('user-input'),
      text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value);
    if (input) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }
    return text;
  },
});
stscriptAddCommand({
  name: 'input',
  aliases: ['prompt'],
  namedArgumentList: [{ name: 'default' }, { name: 'placeholder' }],
  callback: async function (args, value) {
    if (typeof appInput !== 'function') throw new Error('输入框不可用');
    var owner = (args._abortController && args._abortController.signal) || {};
    var result = await appInput(
      String(value || '请输入'),
      String(args.default || ''),
      '脚本输入',
      String(args.placeholder || '内容'),
      { owner: owner }
    );
    if (args._abortController && args._abortController.signal.aborted)
      throw new Error(args._abortController.signal.reason || '已停止');
    return result == null ? '' : String(result);
  },
});
stscriptAddCommand({
  name: 'buttons',
  namedArgumentList: [{ name: 'labels' }],
  callback: async function (args) {
    if (typeof stscriptPromptButtons !== 'function') throw new Error('按钮弹窗不可用');
    var labels = args.labels;
    try {
      if (typeof labels === 'string') labels = JSON.parse(labels);
    } catch (_) {}
    if (!Array.isArray(labels) || !labels.length) throw new Error('/buttons 需要 labels 列表');
    var picked = await stscriptPromptButtons(
      labels.map(function (item) {
        return item && typeof item === 'object' ? String(item.text || item.label || '') : String(item);
      }),
      args._abortController
    );
    return picked == null ? '' : picked;
  },
});
stscriptAddCommand({
  name: 'send',
  rawQuotes: true,
  namedArgumentList: [{ name: 'raw' }, { name: 'return' }],
  callback: async function (args, value) {
    var text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value),
      returnType = stscriptMessageReturnType(args),
      session = stscriptSess();
    if (!text) return '';
    var message = await stscriptSaveMsg('user', text);
    await stscriptRenderSentMessage(session, message, false, args);
    return stscriptMessageReturn(returnType, message, text);
  },
});
stscriptAddCommand({
  name: 'sendas',
  namedArgumentList: [{ name: 'name' }, { name: 'return' }],
  callback: async function (args, value) {
    var text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value),
      name = String(args.name || ''),
      returnType = stscriptMessageReturnType(args),
      session = stscriptSess();
    var message = await stscriptSaveMsg('assistant', text, name ? { speaker: name } : {});
    await stscriptRenderSentMessage(session, message, true, args);
    return stscriptMessageReturn(returnType, message, text);
  },
});
stscriptAddCommand({
  name: 'hide',
  callback: async function (args, value) {
    var msgs = stscriptMsgs(),
      range = stscriptParseRange(value, msgs.length);
    for (var i = range[0]; i <= range[1]; i++) stscriptWriteProperty(msgs[i], 'hidden', true, 'sessions');
    stscriptMarkVars('sessions');
    await stscriptFlushVars();
    if (typeof renderChat === 'function') renderChat();
    return '';
  },
});
stscriptAddCommand({
  name: 'unhide',
  callback: async function (args, value) {
    var msgs = stscriptMsgs(),
      range = stscriptParseRange(value, msgs.length);
    for (var i = range[0]; i <= range[1]; i++) stscriptWriteProperty(msgs[i], 'hidden', undefined, 'sessions', true);
    stscriptMarkVars('sessions');
    await stscriptFlushVars();
    if (typeof renderChat === 'function') renderChat();
    return '';
  },
});
stscriptAddCommand({
  name: 'cut',
  callback: async function (args, value) {
    var sess = stscriptSess();
    if (!sess) throw new Error('当前没有可用对话');
    if (
      typeof blockDuringGenerationOrPostCommit === 'function' &&
      blockDuringGenerationOrPostCommit('剪切消息', sess, { postCommitRun: stscriptPostCommitRun(args) })
    )
      return '';
    var range = stscriptParseRange(value, sess.msgs.length),
      previous = sess.msgs[range[0] - 1],
      next = sess.msgs[range[1] + 1],
      removed = sess.msgs.splice(range[0], range[1] - range[0] + 1);
    stscriptRecordRollback('sessions', function () {
      var after = sess.msgs.indexOf(next),
        before = sess.msgs.indexOf(previous),
        index = after >= 0 ? after : before >= 0 ? before + 1 : Math.min(range[0], sess.msgs.length);
      removed.forEach(function (message) {
        if (!sess.msgs.includes(message)) sess.msgs.splice(index++, 0, message);
      });
    });
    stscriptMarkVars('sessions');
    await stscriptFlushVars();
    if (typeof renderChat === 'function') renderChat();
    // ST appends a newline after every cut message, the last one included.
    return removed
      .map(function (msg) {
        return String((msg && msg.content) || '') + '\n';
      })
      .join('');
  },
});
stscriptAddCommand({
  name: 'messages',
  dryRun: 'run',
  aliases: ['message'],
  namedArgumentList: [{ name: 'hidden' }, { name: 'role' }],
  callback: function (args, value) {
    var msgs = stscriptMsgs(),
      range = stscriptParseRange(value, msgs.length),
      includeHidden = !stscriptIsFalse(args.hidden == null ? 'on' : args.hidden),
      role = args.role ? String(args.role) : '',
      out = [];
    for (var i = range[0]; i <= range[1]; i++) {
      var msg = msgs[i];
      if (!msg) continue;
      if (msg.hidden && !includeHidden) continue;
      if (role && msg.role !== role) continue;
      out.push(String(msg.content || ''));
    }
    return out.join('\n\n');
  },
});
stscriptAddCommand({
  name: 'trigger',
  dryRun: 'model',
  callback: async function (args) {
    if (typeof _generationState !== 'undefined' && _generationState !== 'idle') throw new Error('当前正在生成');
    var char = stscriptChar(),
      sess = stscriptSess();
    if (!char || !sess) throw new Error('当前没有可用对话');
    if (typeof doAPICall !== 'function') throw new Error('生成入口不可用');
    var target = {
      charId: char.id,
      sessionId: sess.id,
      mode: 'new',
      _promptTemplateStscriptRunToken: typeof _qrTop === 'object' ? _qrTop : null,
    };
    if (typeof generationTarget !== 'undefined') generationTarget = target;
    if (typeof setGenerationState === 'function') setGenerationState('preparing');
    try {
      await doAPICall({
        target: target,
        interactive: true,
        submittedMessage: (args && args.__submittedMessage) || null,
        // Set when this script itself runs inside a post-commit tail; the drain then skips
        // waiting for the task it is running in instead of fencing itself.
        postCommitRun: stscriptPostCommitRun(args),
      });
      return '';
    } finally {
      if (typeof finishGeneration === 'function') finishGeneration(target);
    }
  },
});
stscriptAddCommand({
  name: 'gen',
  dryRun: 'model',
  callback: async function (args, value) {
    var submittedMessage = null;
    if (String(value || '').trim()) submittedMessage = await stscriptSaveMsg('user', String(value));
    return STSCRIPT_COMMANDS.trigger.callback(
      Object.assign({}, args || {}, { __submittedMessage: submittedMessage }),
      value
    );
  },
});
stscriptAddCommand({
  name: 'regex',
  dryRun: 'run',
  namedArgumentList: [{ name: 'name' }],
  // Like ST's regex extension, a missing, unknown or disabled script only warns and passes the input through.
  callback: async function (args, value) {
    var name = String(args.name || '').trim(),
      skip = function (message) {
        if (!stscriptDryRunning(args) && typeof toast === 'function') toast(message, 'err');
        return value == null ? '' : value;
      };
    if (!name) return skip('/regex 需要脚本名称');
    var rows = typeof effectiveRegexScriptRows === 'function' ? effectiveRegexScriptRows(stscriptChar()) : [];
    var script = rows.map(function (item) {
      return item && item.script && normalizeRegexScriptRecord(item.script);
    }).find(function (item) {
      return item && String(item.name || '').toLowerCase() === name.toLowerCase();
    });
    if (!script) return skip('找不到名为 "' + name + '" 的正则脚本');
    if (script.enabled === false) return skip('正则脚本 "' + name + '" 已停用');
    var parts = stscriptParseRegexLiteral(script.findRegex);
    if (typeof runStandardReplaceParts !== 'function') throw new Error('正则执行链不可用');
    return stscriptApplyParts(
      runStandardReplaceParts(
        String(value == null ? '' : value),
        parts.pattern,
        parts.flags,
        script.replaceString || ''
      )
    );
  },
});
stscriptAddCommand({
  name: 'foreach',
  dryRun: 'run',
  source: 'LALib',
  splitUnnamedArgument: true,
  unnamedArgumentList: [{ name: 'list' }],
  callback: async function (args, value) {
    var list, command;
    if (Array.isArray(value)) {
      list = value[0];
      command =
        value.find(function (item) {
          return item instanceof StscriptClosure;
        }) || value[1];
    } else throw new Error('/foreach 需要列表和脚本块');
    if (!(command instanceof StscriptClosure)) throw new Error('/foreach 需要脚本块');
    var parsed;
    try {
      parsed = typeof list === 'string' ? JSON.parse(list) : list;
    } catch (_) {
      throw new Error('/foreach 的列表不是有效 JSON');
    }
    var entries = Array.isArray(parsed)
      ? parsed.map(function (item, index) {
          return { item: item, index: index };
        })
      : Object.keys(parsed || {}).map(function (key) {
          return { item: parsed[key], index: key };
        });
    var names = (command.argumentList || []).map(function (item) {
        return item.name;
      }),
      itemName = names[0] || 'item',
      indexName = names[1] || 'index',
      result = '';
    for (var i = 0; i < entries.length; i++) {
      if (args._abortController && args._abortController.signal.aborted) break;
      var runner = command.getCopy();
      runner.abortController = args._abortController;
      runner.breakController = new StscriptBreakController();
      runner.scope.parent = args._scope;
      var itemVal = entries[i].item,
        stored = typeof itemVal === 'object' && itemVal != null ? JSON.stringify(itemVal) : itemVal;
      if (runner.scope.existsVariableInScope(itemName)) runner.scope.setVariable(itemName, stored);
      else runner.scope.letVariable(itemName, stored);
      if (runner.scope.existsVariableInScope(indexName)) runner.scope.setVariable(indexName, entries[i].index);
      else runner.scope.letVariable(indexName, entries[i].index);
      runner.argumentList = [];
      result = await runner.execute();
      if (result.isAborted || result.isBreak) break;
    }
    return (result && result.pipe) || '';
  },
});
stscriptAddCommand({
  name: 're-escape',
  dryRun: 'run',
  source: 'LALib',
  callback: function (args, value) {
    return escapeRegexText(String(value == null ? '' : value));
  },
});
stscriptAddCommand({
  name: 're-exec',
  dryRun: 'run',
  source: 'LALib',
  namedArgumentList: [{ name: 'find' }, { name: 'first' }],
  callback: function (args, value) {
    var spec = stscriptParseRegexLiteral(args.find),
      flags = spec.flags || '',
      text = String(value == null ? '' : value),
      regex = new RegExp(spec.pattern, flags),
      first = stscriptIsTrue(args.first),
      rows = [];
    for (var match of regexMatches(text, regex)) {
      rows.push(Array.prototype.slice.call(match));
      if (first) break;
    }
    return first ? (rows[0] ? JSON.stringify(rows[0]) : '') : JSON.stringify(rows);
  },
});
stscriptAddCommand({
  name: 're-replace',
  dryRun: 'run',
  source: 'LALib',
  namedArgumentList: [{ name: 'find' }, { name: 'replace' }, { name: 'cmd' }],
  callback: async function (args, value) {
    var spec = stscriptParseRegexLiteral(args.find),
      text = String(value == null ? '' : value),
      replace = args.replace == null ? '' : String(args.replace),
      cmd = args.cmd;
    if (cmd instanceof StscriptClosure || (typeof cmd === 'string' && cmd)) {
      var regex = new RegExp(spec.pattern, spec.flags || ''),
        out = '',
        last = 0;
      for (var match of regexMatches(text, regex)) {
        out += text.slice(last, match.index);
        var replacement;
        if (cmd instanceof StscriptClosure) {
          match.forEach(function (group, index) {
            cmd.scope.setMacro('$' + index, group == null ? '' : group);
          });
          replacement = String((await cmd.execute()).pipe || '');
        } else
          replacement = String(
            (
              await executeStscript(
                String(cmd).replace(/\$(\d+)/g, function (_, n) {
                  return match[Number(n)] == null ? '' : match[Number(n)];
                }),
                { scope: args._scope, abortController: args._abortController }
              )
            ).pipe || ''
          );
        out += replacement;
        last = match.index + match[0].length;
      }
      return out + text.slice(last);
    }
    if (typeof runStandardReplaceParts === 'function')
      return stscriptApplyParts(runStandardReplaceParts(text, spec.pattern, spec.flags || '', replace));
    return text.replace(new RegExp(spec.pattern, spec.flags || ''), replace);
  },
});
stscriptAddCommand({
  name: 'swipes-go',
  source: 'LALib',
  namedArgumentList: [{ name: 'message' }],
  callback: async function (args, value) {
    var msgs = stscriptMsgs();
    if (!msgs.length) throw new Error('没有可切换的消息');
    var idx = args.message == null ? msgs.length - 1 : Number(args.message);
    if (!Number.isInteger(idx) || idx < 0 || idx >= msgs.length) throw new Error('消息不存在：' + args.message);
    var msg = msgs[idx],
      want = Number(value);
    if (!Number.isInteger(want) || want < 0) throw new Error('/swipes-go 需要从 0 开始的编号');
    // The candidate set a message without one would get, computed without touching it: a refused
    // call must not leave a materialised swipes/swipeId (or an edited opening rewritten back to
    // greeting 0) behind for the next saveData to persist.
    var materialize = null,
      candidates = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes : null;
    if (!candidates) {
      if (msg.opening === true && typeof getGreetings === 'function') {
        if (typeof openingMessageCandidateModel === 'function' && typeof setOpeningMessageCandidate === 'function') {
          candidates = openingMessageCandidateModel(stscriptChar(), msg, msg.openingIndex, msg.content).candidates;
          materialize = function () {
            setOpeningMessageCandidate(stscriptChar(), stscriptSess(), msg, msg.openingIndex, msg.content);
          };
        } else {
          candidates = getGreetings(stscriptChar()).slice();
          materialize = function () {
            msg.swipes = candidates.slice();
            msg.swipeId = Number.isInteger(msg.openingIndex) ? msg.openingIndex : 0;
          };
        }
      } else {
        candidates = [String(msg.content || '')];
        materialize = function () {
          msg.swipes = [String(msg.content || '')];
          msg.swipeId = 0;
        };
      }
    }
    if (want >= candidates.length) throw new Error('没有编号为 ' + want + ' 的候选回复');
    // Validate before materializing candidates, including calls made by a post-commit script.
    if (
      typeof blockDuringGenerationOrPostCommit === 'function' &&
      blockDuringGenerationOrPostCommit('切换回复候选', stscriptSess(), { postCommitRun: stscriptPostCommitRun(args) })
    )
      return '';
    var char = stscriptChar(),
      session = stscriptSess(),
      mutation = beginMessageMutation(char, session, msg);
    stscriptRecordRollback('sessions', function () {
      mutation.rollback();
      if (typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, session.id);
    });
    try {
      if (materialize) materialize();
      // Switching candidates must also drop the per-candidate continuation and translation drafts;
      // messageSwipeSetActive is the single owner of that.
      if (typeof messageSwipeSetActive === 'function') messageSwipeSetActive(msg, want);
      else {
        msg.swipeId = want;
        msg.content = String(msg.swipes[want] || '');
      }
      if (msg.opening === true) {
        msg.openingIndex = want;
        stscriptSess().openingIndex = want;
      }
      if (Number(msg.seq) > 0 && typeof rollbackMemoryDependencies === 'function')
        rollbackMemoryDependencies(stscriptChar().id, stscriptSess(), Number(msg.seq));
      if (typeof invalidateCacheContexts === 'function')
        invalidateCacheContexts(stscriptChar().id, idx, true, stscriptSess().id);
      await refreshMessageMutation(char, session, mutation);
    } catch (error) {
      mutation.rollback();
      throw error;
    }
    stscriptMarkVars('sessions');
    await stscriptFlushVars();
    if (typeof renderChat === 'function') renderChat();
    if (typeof cardFrontendAwaitBroadcastEvent === 'function')
      await cardFrontendAwaitBroadcastEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPED, [idx]);
    return String(msg.content || '');
  },
});
async function stscriptRunOptionalAwait(task, shouldAwait) {
  var run = new Promise(function (resolve, reject) {
    setTimeout(function () {
      Promise.resolve().then(task).then(resolve, reject);
    }, 1);
  });
  if (shouldAwait) await run;
  else
    run.catch(function (error) {
      if (typeof toast === 'function') toast(String((error && error.message) || error), 'err');
    });
}
async function stscriptWaitForGenerationIdle(command) {
  var started = Date.now();
  while (typeof _generationState !== 'undefined' && _generationState !== 'idle') {
    if (Date.now() - started >= 10000) throw new Error('当前回复仍在生成，/' + command + ' 未执行');
    await new Promise(function (resolve) {
      setTimeout(resolve, 100);
    });
  }
}
stscriptAddCommand({
  name: 'swipe',
  dryRun: 'model',
  namedArgumentList: [{ name: 'direction' }, { name: 'await' }],
  callback: async function (args) {
    var direction = String(args.direction || 'right').toLowerCase(),
      step = direction === 'left' ? -1 : 1;
    if (typeof switchMessageSwipe !== 'function') throw new Error('候选切换入口不可用');
    var postCommitRun = stscriptPostCommitRun(args);
    await stscriptRunOptionalAwait(async function () {
      await stscriptWaitForGenerationIdle('swipe');
      var sess = stscriptSess(),
        index = sess && sess.msgs.length - 1;
      if (index < 0) throw new Error('没有可切换的回复');
      return switchMessageSwipe(index, step, { postCommitRun: postCommitRun, wrapLeft: true });
    }, stscriptIsTrue(args.await));
    return '';
  },
});
stscriptAddCommand({
  name: 'addswipe',
  aliases: ['swipeadd'],
  namedArgumentList: [{ name: 'switch' }],
  callback: async function (args, value) {
    if (typeof addMessageSwipeCandidate !== 'function') throw new Error('候选添加入口不可用');
    var index = await addMessageSwipeCandidate(stscriptJoin(value), {
      switch: stscriptIsTrue(args.switch),
      postCommitRun: stscriptPostCommitRun(args),
    });
    return String(index);
  },
});
stscriptAddCommand({
  name: 'delswipe',
  aliases: ['swipedel'],
  callback: async function (args, value) {
    if (typeof deleteMessageSwipeCandidate !== 'function') throw new Error('候选删除入口不可用');
    var text = stscriptJoin(value).trim(),
      swipeIndex = text === '' ? null : Number(text) - 1;
    if (text !== '' && (!Number.isInteger(swipeIndex) || swipeIndex < 0))
      throw new Error('/delswipe 需要从 1 开始的候选编号');
    return String(await deleteMessageSwipeCandidate(swipeIndex, { postCommitRun: stscriptPostCommitRun(args) }));
  },
});
stscriptAddCommand({
  name: 'impersonate',
  dryRun: 'model',
  aliases: ['imp'],
  namedArgumentList: [{ name: 'await' }],
  callback: async function (args, value) {
    if (typeof impersonateUser !== 'function') throw new Error('扮演用户入口不可用');
    var prompt = stscriptJoin(value),
      postCommitRun = stscriptPostCommitRun(args);
    await stscriptRunOptionalAwait(async function () {
      await stscriptWaitForGenerationIdle('impersonate');
      return impersonateUser(prompt, { postCommitRun: postCommitRun });
    }, stscriptIsTrue(args.await));
    return '';
  },
});

var STSCRIPT_UNAVAILABLE = Object.create(null);
function stscriptMarkUnavailable(names, message) {
  String(names)
    .split(',')
    .forEach(function (name) {
      STSCRIPT_UNAVAILABLE[name] = message.replace(/%s/g, name);
    });
}
stscriptAddCommand({
  name: 'continue',
  dryRun: 'model',
  aliases: ['cont'],
  callback: async function (args) {
    if (typeof continueGeneration !== 'function') throw new Error('续写入口不可用');
    await continueGeneration({ postCommitRun: stscriptPostCommitRun(args) });
    return '';
  },
});
stscriptAddCommand({
  name: 'regenerate',
  dryRun: 'model',
  aliases: ['regen'],
  callback: async function (args) {
    if (typeof regenerateLast !== 'function') throw new Error('重新生成入口不可用');
    await regenerateLast({ postCommitRun: stscriptPostCommitRun(args) });
    return '';
  },
});
stscriptAddCommand({
  name: 'getchatname',
  dryRun: 'run',
  callback: function () {
    var sess = stscriptSess();
    if (!sess) throw new Error('当前没有可用对话');
    return String(sess.name || '');
  },
});
function stscriptExpressionsHost() {
  var host = typeof window !== 'undefined' ? window.YeyuExpressions : null;
  if (!host) throw new Error('立绘表情宿主尚未加载，请重新打开当前对话后再试');
  return host;
}
function stscriptExpressionCharacterName(value) {
  var name = String(value || '').trim(),
    char = stscriptChar();
  if (!name || !char) return name || null;
  var canonical = typeof canonicalCharacterName === 'function' ? canonicalCharacterName(char) : '',
    matched = [char.id, char.name, char.avatar, canonical].some(function (item) {
      return String(item || '').toLowerCase() === name.toLowerCase();
    });
  return matched ? String(char.id || char.name || name) : name;
}
function stscriptExpressionListReturn(value, returnType) {
  var list = Array.isArray(value) ? value.slice() : [],
    type = String(returnType || 'pipe').toLowerCase(),
    text = list.join(', ');
  if (type === 'pipe') return text;
  if (type === 'object') return JSON.stringify(list);
  if (type === 'none') return '';
  if (type === 'console') {
    if (typeof console !== 'undefined' && console.info) console.info(list);
    return '';
  }
  if (type === 'toast-html' || type === 'toast-text') {
    if (typeof toast === 'function') toast(text, 'info');
    return '';
  }
  throw new Error('/expression-list 的 return 参数必须是 pipe、object、toast-html、toast-text、console 或 none');
}
stscriptAddCommand({
  name: 'expression-set',
  aliases: ['sprite', 'emote'],
  namedArgumentList: [{ name: 'type' }],
  callback: async function (args, value) {
    var name = stscriptJoin(value).trim().toLowerCase(),
      type = String(args.type || 'expression').toLowerCase();
    if (!name) throw new Error('/expression-set 需要表情标签或图片名称');
    if (type !== 'expression' && type !== 'sprite')
      throw new Error('/expression-set 的 type 参数必须是 expression 或 sprite');
    return String((await stscriptExpressionsHost().set(name, { type: type, mode: 'command' })) || '');
  },
});
stscriptAddCommand({
  name: 'expression-fallback',
  callback: async function (args, value) {
    var name = stscriptJoin(value).trim();
    return String((await stscriptExpressionsHost().fallback(name || null)) || '');
  },
});
stscriptAddCommand({
  name: 'expression-folder-override',
  aliases: ['spriteoverride', 'costume'],
  namedArgumentList: [{ name: 'name' }],
  callback: async function (args, value) {
    await stscriptExpressionsHost().folder(stscriptExpressionCharacterName(args.name), {
      costume: stscriptJoin(value).trim(),
    });
    return '';
  },
});
stscriptAddCommand({
  name: 'expression-last',
  dryRun: 'run',
  aliases: ['lastsprite'],
  callback: async function (args, value) {
    var identity = stscriptJoin(value).trim(),
      char = stscriptChar(),
      canonical = char && typeof canonicalCharacterName === 'function' ? canonicalCharacterName(char) : '';
    if (
      identity &&
      (!char ||
        ![char.id, char.name, char.avatar, canonical].some(function (item) {
          return String(item || '').toLowerCase() === identity.toLowerCase();
        }))
    )
      return '';
    return String((await stscriptExpressionsHost().last()) || '');
  },
});
stscriptAddCommand({
  name: 'expression-list',
  dryRun: stscriptDryRunReadUnlessShown('pipe'),
  aliases: ['expressions'],
  namedArgumentList: [{ name: 'return' }, { name: 'filter' }],
  callback: async function (args) {
    var returnType = String(args.return || 'pipe').toLowerCase(),
      list = await stscriptExpressionsHost().list({
        filter: !stscriptIsFalse(args.filter == null ? 'true' : args.filter),
        returnType: returnType,
      });
    return stscriptExpressionListReturn(list, returnType);
  },
});
stscriptAddCommand({
  name: 'expression-classify',
  dryRun: 'model',
  aliases: ['classify'],
  namedArgumentList: [{ name: 'api' }, { name: 'filter' }, { name: 'prompt' }],
  callback: async function (args, value) {
    var text = stscriptJoin(value).trim();
    if (!text) throw new Error('/expression-classify 需要待分类的消息正文');
    return String(
      (await stscriptExpressionsHost().classify(text, {
        api: args.api || null,
        filter: !stscriptIsFalse(args.filter == null ? 'true' : args.filter),
        prompt: args.prompt || null,
      })) || ''
    );
  },
});
stscriptAddCommand({
  name: 'expression-upload',
  aliases: ['uploadsprite'],
  namedArgumentList: [{ name: 'name' }, { name: 'label' }, { name: 'folder' }, { name: 'spriteName' }],
  callback: async function (args, value) {
    var url = stscriptJoin(value).trim(),
      label = String(args.label || '').trim();
    if (!url) throw new Error('/expression-upload 需要图片 URL');
    if (!label) throw new Error('/expression-upload 需要 label 参数');
    return String(
      (await stscriptExpressionsHost().upload(url, {
        name: stscriptExpressionCharacterName(args.name),
        label: label,
        folder: args.folder || null,
        spriteName: args.spriteName || null,
      })) || ''
    );
  },
});
stscriptAddCommand({
  name: 'vn',
  callback: async function () {
    await stscriptExpressionsHost().vn();
    return '';
  },
});
// ST stable-diffusion 扩展的 /imagine：执行与语义在 86 号 runStscriptImagine；ST 的参数都接受，
// 夜欲用得上的是 quiet、width/height、model、edit，其余（negative、seed、steps 等）接受但不生效。
stscriptAddCommand({
  name: 'imagine',
  dryRun: 'model',
  aliases: ['sd', 'img', 'image'],
  namedArgumentList:
    'quiet,gallery,negative,extend,edit,multimodal,snap,processing,seed,width,height,steps,cfg,skip,model,sampler,scheduler,vae,upscaler,hires,scale,denoise,2ndpass,faces'
      .split(',')
      .map(function (name) {
        return { name: name };
      }),
  callback: async function (args, value) {
    return runStscriptImagine(args, stscriptJoin(value), stscriptChar(), stscriptSess());
  },
});
stscriptMarkUnavailable(
  'imagine-comfy-workflow,imagine-source,imagine-style,img-source,img-style,sd-source,sd-style',
  '夜欲的图片来源与风格在「设置 → 生图」里管理，没有命令 /%s'
);
stscriptMarkUnavailable(
  'autobg,bgauto,context,default,disable,enable,extension-disable,extension-enable,extension-exists,extension-installed,extension-state,extension-toggle,flat,icw,instruct,instruct-off,instruct-on,instruct-state,instruct-toggle,movingui,qr-contextadd,qr-contextclear,qr-contextdel,resetpanels,resetui,single,story,tokenizer,yt-script',
  '夜欲没有命令 /%s 对应的产品能力'
);
stscriptAddCommand({
  name: 'speak',
  aliases: ['narrate', 'tts'],
  namedArgumentList: [{ name: 'voice' }],
  callback: async function (_args, value) {
    await speechCommand(stscriptJoin(value), stscriptChar());
    return '';
  },
});
