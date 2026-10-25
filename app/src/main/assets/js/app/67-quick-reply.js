// ===== Quick Reply v2 sets, scopes, events, and QR slash commands =====
var _qrAbort = null,
  _qrRun = null,
  _qrTop = null,
  _qrPreventAuto = [],
  _qrIdleWaiters = [],
  _qrChain = Promise.resolve(),
  _qrCommitChain = Promise.resolve();
function qrActiveCharacter() {
  if (typeof getChar === 'function') return getChar();
  return typeof stscriptChar === 'function' ? stscriptChar() : null;
}
function qrStRuntimeAvailable(char) {
  var target = arguments.length ? char : qrActiveCharacter();
  return !(target && typeof isRisuCharacter === 'function' && isRisuCharacter(target));
}
function qrState(settingsOverride) {
  var settings = settingsOverride || (typeof D !== 'undefined' && D.settings);
  if (!settings) return { sets: [], globalSetNames: [], enabled: true, characterLinks: {} };
  if (!settings.quickReply || typeof settings.quickReply !== 'object' || Array.isArray(settings.quickReply))
    settings.quickReply = { sets: [], globalSetNames: [], enabled: true, characterLinks: {} };
  var state = settings.quickReply;
  if (!Array.isArray(state.sets)) state.sets = [];
  if (!Array.isArray(state.globalSetNames)) state.globalSetNames = [];
  if (!state.characterLinks || typeof state.characterLinks !== 'object') state.characterLinks = {};
  if (state.enabled == null) state.enabled = true;
  return state;
}
function qrCopy(value) {
  return typeof copyJsonData === 'function' ? copyJsonData(value) : JSON.parse(JSON.stringify(value));
}
function qrNormalizeSet(source) {
  source = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  var set = {
    version: 2,
    name: String(source.name || '未命名集合'),
    disableSend: source.disableSend === true,
    placeBeforeInput: source.placeBeforeInput === true,
    injectInput: source.injectInput === true,
    color: source.color == null ? 'rgba(0, 0, 0, 0)' : String(source.color),
    onlyBorderColor: source.onlyBorderColor === true,
    qrList: [],
    idIndex: Math.max(0, Number(source.idIndex) || 0),
  };
  Object.keys(source).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(set, key)) set[key] = qrCopy(source[key]);
  });
  var seen = Object.create(null);
  (Array.isArray(source.qrList) ? source.qrList : []).forEach(function (row) {
    if (!row || typeof row !== 'object') return;
    var item = qrNormalizeEntry(row);
    if (seen[item.id]) item.id = ++set.idIndex;
    seen[item.id] = true;
    if (item.id >= set.idIndex) set.idIndex = item.id;
    set.qrList.push(item);
  });
  return set;
}
// Yeyu-private `yeyuSource` records where a set came from: {type:'created'} for sets made in the
// app, {type:'file', fileName} for file imports. Sets saved before it existed carry none.
function qrCreatedSource() {
  return { type: 'created' };
}
function qrSetOrigin(set) {
  var source = set && set.yeyuSource;
  if (source && source.type === 'created') return 'created';
  if (source && source.type === 'file') return 'file';
  return 'unrecorded';
}
function qrNormalizeEntry(source) {
  source = source && typeof source === 'object' ? source : {};
  var item = {
    id: Math.max(1, Number(source.id) || 1),
    icon: source.icon == null ? '' : String(source.icon),
    showLabel: source.showLabel === true,
    label: String(source.label || ''),
    title: String(source.title || ''),
    message: String(source.message || ''),
    preventAutoExecute: source.preventAutoExecute !== false,
    isHidden: source.isHidden === true,
    executeOnStartup: source.executeOnStartup === true,
    executeOnUser: source.executeOnUser === true,
    executeOnAi: source.executeOnAi === true,
    executeOnChatChange: source.executeOnChatChange === true,
    executeOnNewChat: source.executeOnNewChat === true,
    executeBeforeGeneration: source.executeBeforeGeneration === true,
    automationId: String(source.automationId || ''),
  };
  Object.keys(source).forEach(function (key) {
    if (key !== 'contextList' && !Object.prototype.hasOwnProperty.call(item, key)) item[key] = qrCopy(source[key]);
  });
  return item;
}
function qrFindSet(name) {
  name = String(name || '');
  return (
    qrState().sets.find(function (set) {
      return set.name === name;
    }) || null
  );
}
// Labels are not unique in imported sets, so anything that edits or deletes a specific entry
// must address it by id; only the official /qr label contract may fall back to labels.
function qrEntryById(set, id) {
  var wanted = String(id == null ? '' : id);
  return (
    ((set && set.qrList) || []).find(function (row) {
      return row && String(row.id) === wanted;
    }) || null
  );
}
function qrRenderViews() {
  if (typeof renderQuickReplyBar === 'function') renderQuickReplyBar();
  if (typeof renderQuickReplyManager === 'function') renderQuickReplyManager();
}
function qrCaptureMutation(keys) {
  var records = [],
    seen = new Set();
  function capture(value, fields) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    var names = fields || Object.keys(value),
      descriptors = Object.create(null);
    names.forEach(function (key) {
      descriptors[key] = Object.getOwnPropertyDescriptor(value, key);
    });
    records.push({
      value: value,
      fields: fields,
      descriptors: descriptors,
      length: Array.isArray(value) ? value.length : null,
    });
    names.forEach(function (key) {
      if (descriptors[key]) capture(descriptors[key].value);
    });
  }
  qrState();
  capture(D.settings, ['quickReply']);
  if (keys.includes('sessions'))
    Object.keys(D.chats || {}).forEach(function (id) {
      ((D.chats[id] && D.chats[id].sessions) || []).forEach(function (session) {
        capture(session, ['quickReply']);
      });
    });
  return function () {
    records.forEach(function (record) {
      (record.fields || Object.keys(record.value)).forEach(function (key) {
        if (!record.descriptors[key]) delete record.value[key];
      });
      Object.keys(record.descriptors).forEach(function (key) {
        if (record.descriptors[key]) Object.defineProperty(record.value, key, record.descriptors[key]);
      });
      if (record.length !== null) record.value.length = record.length;
    });
  };
}
function qrCommit(keys, mutate) {
  var task = _qrCommitChain.then(function () {
    return qrCommitNow(keys, mutate);
  });
  _qrCommitChain = task.catch(function () {});
  return task;
}
async function qrCommitNow(keys, mutate) {
  var rollback = qrCaptureMutation(keys);
  try {
    if (typeof mutate === 'function') await mutate();
    var scriptSnapshot = typeof _stscriptVarUndo !== 'undefined' ? (_stscriptVarUndo || []).slice() : [];
    if (typeof saveData === 'function') await saveData(keys.length === 1 ? keys[0] : keys, { urgent: true });
    if (typeof stscriptDiscardSavedMutations === 'function') stscriptDiscardSavedMutations(keys, scriptSnapshot);
  } catch (error) {
    rollback();
    qrRenderViews();
    throw error;
  }
  qrRenderViews();
}
async function qrUpsertSet(set, bind) {
  return qrCommit(['meta'], function () {
    var state = qrState(),
      existing = qrFindSet(set.name);
    if (existing) state.sets[state.sets.indexOf(existing)] = set;
    else state.sets.push(set);
    if (bind === true && state.globalSetNames.indexOf(set.name) < 0) state.globalSetNames.push(set.name);
  });
}
function qrChatConfig(create, sess) {
  var empty = { setNames: [] };
  sess = sess || stscriptSess();
  if (!sess) return empty;
  if (!sess.quickReply || typeof sess.quickReply !== 'object') {
    if (!create) return empty;
    sess.quickReply = { setNames: [] };
  }
  if (!Array.isArray(sess.quickReply.setNames)) sess.quickReply.setNames = [];
  return sess.quickReply;
}
function qrCharLinks() {
  var char = stscriptChar(),
    state = qrState();
  if (!char) return [];
  var names = state.characterLinks[char.id];
  return Array.isArray(names) ? names.slice() : [];
}
function qrBoundSets() {
  if (!qrStRuntimeAvailable()) return [];
  var state = qrState(),
    names = state.globalSetNames.concat(qrChatConfig().setNames, qrCharLinks()),
    seen = Object.create(null),
    sets = [];
  names.forEach(function (name) {
    if (seen[name]) return;
    seen[name] = true;
    var set = qrFindSet(name);
    if (set) sets.push(set);
  });
  return sets;
}
function qrHasColor(set) {
  var color = set && set.color != null ? String(set.color).trim() : '';
  return !!color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent';
}
function qrChipStyle(set) {
  if (!qrHasColor(set)) return '';
  var color = String(set.color);
  if (set.onlyBorderColor) return 'border-color:' + color + ';background:transparent;';
  return 'border-color:' + color + ';background:' + color + ';';
}
function qrVisibleButtons() {
  var buttons = [];
  qrBoundSets().forEach(function (set) {
    (set.qrList || []).forEach(function (item) {
      if (!item || item.isHidden === true) return;
      if (!item.label && !item.icon) return;
      buttons.push({ set: set, item: item });
    });
  });
  return buttons;
}
function qrFindEntry(name) {
  name = String(name || '').trim();
  var direct = null;
  qrBoundSets().some(function (set) {
    return (set.qrList || []).some(function (item) {
      if (item.label === name) {
        direct = { set: set, item: item };
        return true;
      }
    });
  });
  if (direct) return direct;
  var parts = name.split('.'),
    setName = parts.shift(),
    label = parts.join('.');
  var set = qrFindSet(setName);
  if (!set || !label) return null;
  var item = (set.qrList || []).find(function (row) {
    return row.label === label;
  });
  return item ? { set: set, item: item } : null;
}
function qrGetEntry(setName, labelOrId) {
  var set = qrFindSet(setName);
  if (!set) throw new Error('找不到集合 "' + setName + '"');
  if (labelOrId == null || labelOrId === '') throw new Error('缺少快捷栏条目');
  var id = Number(labelOrId),
    item = null;
  if (Number.isInteger(id) && String(labelOrId).trim() !== '' && String(labelOrId).trim() === String(id))
    item =
      (set.qrList || []).find(function (row) {
        return row.id === id;
      }) || null;
  if (!item)
    item =
      (set.qrList || []).find(function (row) {
        return row.label === String(labelOrId);
      }) || null;
  if (!item) throw new Error('找不到快捷栏条目');
  return { set: set, item: item };
}
function qrNotifyIdle() {
  var waiters = _qrIdleWaiters.splice(0);
  waiters.forEach(function (fn) {
    try {
      fn();
    } catch (_) {}
  });
}
function qrAwaitIdle() {
  return _qrChain.then(
    function () {},
    function () {}
  );
}
function stopStscriptRun() {
  if (_qrAbort) _qrAbort.abort('已由你停止', false);
  // Ownership follows the shared signal, not the controller object, so a prompt opened by a nested
  // run that only borrowed the stop semantics is closed by the same stop.
  if (typeof cancelOwnedAppPrompt === 'function') cancelOwnedAppPrompt(_qrAbort && _qrAbort.signal);
}
async function qrStopAndAwait() {
  stopStscriptRun();
  await qrAwaitIdle();
}
function qrWrapError(set, item, error) {
  var where = '快捷栏 ' + ((set && set.name) || '') + ' / ' + ((item && item.label) || '脚本');
  if (error && error.qrWrapped) return error;
  if (typeof StscriptExecutionError === 'function' && error instanceof StscriptExecutionError) {
    error.message = where + '：' + error.message;
    error.qrWrapped = true;
    return error;
  }
  var wrapped = new Error(where + '：' + ((error && error.message) || error || '脚本失败'));
  wrapped.cause = error;
  wrapped.qrWrapped = true;
  return wrapped;
}
function qrRunTop(task, abort, owner) {
  abort = abort || new StscriptAbortController();
  owner =
    owner && owner.charId
      ? { charId: owner.charId, sessionId: owner.sessionId || '' }
      : typeof stscriptCurrentOwner === 'function'
        ? stscriptCurrentOwner()
        : { charId: '', sessionId: '' };
  if (!_qrAbort) _qrAbort = abort;
  var run = _qrChain
    .then(
      function () {
        return Promise.resolve();
      },
      function () {
        return Promise.resolve();
      }
    )
    .then(async function () {
      _qrAbort = abort;
      var activeRun = { abort: abort, owner: owner, state: 'running' };
      _qrTop = activeRun;
      if (typeof stscriptSetOwner === 'function') stscriptSetOwner(owner);
      try {
        var value = await task(abort, owner);
        activeRun.state =
          abort.signal.aborted || (value && value.isAborted)
            ? 'canceled'
            : value && value.isError
              ? 'failed'
              : 'completed';
        return value;
      } catch (error) {
        activeRun.state = abort.signal.aborted ? 'canceled' : 'failed';
        throw error;
      } finally {
        if (_qrAbort === abort) _qrAbort = null;
        if (_qrTop && _qrTop.abort === abort) _qrTop = null;
        _qrRun = null;
        if (typeof stscriptSetOwner === 'function') stscriptSetOwner(null);
        if (typeof renderStscriptRunStatus === 'function') renderStscriptRunStatus();
        qrNotifyIdle();
      }
    });
  _qrChain = run.then(
    function () {},
    function () {}
  );
  return run;
}
// A run started while another one holds the bar shares that run's stop semantics — the same signal
// object and the same listener list, so one stop still reaches both and an `/abort` inside it still
// stops the outer run. What it must not inherit is the outer run's identity: only a caller that
// hands over a controller of its own (`/qr`, `/run`, the auto-execute runner, the preset task
// runtime) is a script of that post-commit tail. A button click, the editor's run and anything else
// that passes no controller is a user action, and its writes must meet the guard like any click.
function qrInheritedStopController(controller) {
  if (!controller || !controller.postCommitRun) return controller;
  var view = Object.create(controller);
  view.postCommitRun = null;
  return view;
}
async function qrExecuteScript(set, item, args, options) {
  options = options || {};
  if (!qrExecutionCurrent(options)) return '';
  var nested = options.nested === true;
  var abort = options.abortController || qrInheritedStopController(_qrAbort);
  var text = options.message != null ? String(options.message) : String((item && item.message) || '');
  if (!item || !String(text || '').trim()) return '';
  var scope = options.scope || new StscriptScope();
  Object.keys(args || {}).forEach(function (key) {
    if (key.charAt(0) === '_' || key === 'isAutoExecute') return;
    scope.setMacro('arg::' + key, args[key]);
  });
  if (!scope.macros['arg::*']) scope.setMacro('arg::*', '');
  var previousRun = _qrRun;
  _qrRun = { set: set.name, label: item.label };
  if (typeof renderStscriptRunStatus === 'function') renderStscriptRunStatus();
  if (typeof stscriptBeginRun === 'function') stscriptBeginRun({ nested: nested, owner: options.owner });
  try {
    var result = await executeStscript(text, {
      scope: scope,
      abortController: abort,
      source: 'qr:' + set.name + '.' + item.label,
      handleParserErrors: false,
      handleExecutionErrors: false,
    });
    if (qrExecutionCurrent(options) && typeof stscriptFlushVars === 'function') await stscriptFlushVars();
    return (result && result.pipe) || '';
  } catch (error) {
    var wrapped = qrWrapError(set, item, error);
    if (!options.handleParserErrors || !(error instanceof StscriptParserError)) throw wrapped;
    if (typeof toast === 'function') toast(wrapped.message, 'err');
    return '';
  } finally {
    if (typeof stscriptEndRun === 'function') stscriptEndRun();
    _qrRun = nested ? previousRun : _qrTop ? _qrRun : null;
    if (typeof renderStscriptRunStatus === 'function') renderStscriptRunStatus();
  }
}
async function qrExecuteEntry(set, item, args, options) {
  if (!qrStRuntimeAvailable()) throw new Error('Risu 卡片不运行 STScript 快捷指令');
  options = options || {};
  args = args || {};
  if (_qrTop)
    return qrExecuteScript(
      set,
      item,
      args,
      Object.assign({}, options, {
        nested: true,
        abortController: options.abortController || qrInheritedStopController(_qrAbort),
      })
    );
  var abort = options.abortController || new StscriptAbortController();
  var owner = typeof stscriptCurrentOwner === 'function' ? stscriptCurrentOwner() : { charId: '', sessionId: '' };
  return qrRunTop(
    function (abort, owner) {
      return qrExecuteScript(
        set,
        item,
        args,
        Object.assign({}, options, { nested: false, abortController: abort, owner: owner })
      );
    },
    abort,
    owner
  );
}
async function executeQuickReplyByName(name, args, options) {
  var found = qrFindEntry(name);
  if (!found) throw new Error('找不到快捷栏脚本 "' + name + '"');
  return qrExecuteWithOptions(
    found.set,
    found.item,
    Object.assign({}, options || {}, { args: args || {}, isRun: true })
  );
}
// Upstream QuickReplySet.executeWithOptions, shared by button clicks, /qr, /run and auto-execute: a
// message starting with "/" in a set that may send runs as STScript; anything else goes to the
// composer and is sent unless the set disables sending. Only a click merges what the user typed.
// Auto-execute and /run show a parser error as a notice instead of throwing; run-time errors still
// reach the caller.
async function qrExecuteWithOptions(set, item, options) {
  if (!qrStRuntimeAvailable()) return '';
  options = options || {};
  var message = String((item && item.message) || '');
  if (!message) return '';
  var isAuto = options.isAutoExecute === true;
  var isRun = options.isRun === true;
  var input = $('user-input');
  var typed = input ? String(input.value || '') : '';
  var combined;
  if (!isAuto && !isRun && set.injectInput && typed.length > 0)
    combined = set.placeBeforeInput ? message + ' ' + typed : typed + ' ' + message;
  else combined = message + ' ';
  if (combined.charAt(0) === '/' && !set.disableSend)
    return qrExecuteEntry(
      set,
      item,
      options.args || {},
      Object.assign({}, options, { message: combined, handleParserErrors: isAuto || isRun })
    );
  if (input) {
    input.value = combined;
    if (typeof input.dispatchEvent === 'function') input.dispatchEvent(new Event('input'));
  }
  // A script inside a post-commit tail (`/qr`, `/run`, executeOnAi) carries that run to the drain
  // exactly like a slash command would; a real button click carries nothing. While a generation is
  // being prepared (executeBeforeGeneration, executeOnUser, world info) sendMessage refuses and the
  // text stays in the composer, so a nested send never starts a second round.
  if (!set.disableSend && typeof sendMessage === 'function')
    await sendMessage({ postCommitRun: (options.abortController && options.abortController.postCommitRun) || null });
  return '';
}
function qrCanAuto() {
  return qrStRuntimeAvailable() && qrState().enabled !== false && !_qrPreventAuto[_qrPreventAuto.length - 1];
}
function qrExecutionCurrent(options) {
  return (
    !(options.signal && options.signal.aborted) &&
    !(options.abortController && options.abortController.signal.aborted) &&
    (typeof options.current !== 'function' || options.current())
  );
}
function qrIsAbortError(error) {
  for (var depth = 0; error && depth < 8; depth++, error = error.cause) if (error.name === 'AbortError') return true;
  return false;
}
// Upstream AutoExecuteHandler.performAutoExecute: each entry runs on its own, so one broken script
// is reported and the rest of the round (and the send, chat switch or generation around it) goes
// on. A stop still travels up to the caller.
async function qrPerformAutoRows(rows, options) {
  for (var i = 0; i < rows.length; i++) {
    if (!qrExecutionCurrent(options)) break;
    _qrPreventAuto.push(rows[i].item.preventAutoExecute !== false);
    try {
      await qrExecuteWithOptions(rows[i].set, rows[i].item, Object.assign({}, options, { isAutoExecute: true }));
    } catch (error) {
      if (qrIsAbortError(error)) throw error;
      console.warn(error);
      if (typeof toast === 'function') toast(stscriptFormatError(error), 'err');
    } finally {
      _qrPreventAuto.pop();
    }
  }
}
function qrAutoRows(eventName) {
  var rows = [];
  qrBoundSets().forEach(function (set) {
    (set.qrList || []).forEach(function (item) {
      if (item && item[eventName]) rows.push({ set: set, item: item });
    });
  });
  return rows;
}
// Whether qrPerformAuto(eventName) would run anything now.
function qrHasAuto(eventName) {
  return qrCanAuto() && qrAutoRows(eventName).length > 0;
}
async function qrPerformAuto(eventName, options) {
  options = options || {};
  if (
    ![
      'executeOnStartup',
      'executeOnUser',
      'executeOnAi',
      'executeOnChatChange',
      'executeOnNewChat',
      'executeBeforeGeneration',
    ].includes(String(eventName || ''))
  )
    return;
  var target = options.postCommitRun && options.postCommitRun.target;
  if ((target && target.quickReplyPreventAuto) || !qrCanAuto() || !qrExecutionCurrent(options)) return;
  var rows = qrAutoRows(eventName);
  var abort = new StscriptAbortController();
  // The controller reaches every command as `args._abortController`, so a generation started from
  // inside this run (/trigger in an executeOnAi reply) can tell which post-commit run it is in.
  if (options.postCommitRun) abort.postCommitRun = options.postCommitRun;
  var stop = function () {
    abort.abort('后台任务已取消', true);
  };
  var executionOptions = Object.assign({}, options, { abortController: abort });
  if (options.signal) options.signal.addEventListener('abort', stop, { once: true });
  try {
    await qrPerformAutoRows(rows, executionOptions);
  } finally {
    if (options.signal) options.signal.removeEventListener('abort', stop);
  }
}
var _qrWiQueue = [];
function qrQueueWorldInfo(entries) {
  if (!qrStRuntimeAvailable()) return;
  (Array.isArray(entries) ? entries : []).forEach(function (entry) {
    var id = String((entry && entry.automationId) || '').trim();
    if (
      !id ||
      _qrWiQueue.some(function (row) {
        return row.automationId === id;
      })
    )
      return;
    _qrWiQueue.push({ automationId: id });
  });
}
async function qrFlushWorldInfo() {
  var rows = _qrWiQueue.slice();
  _qrWiQueue = [];
  if (!qrStRuntimeAvailable()) return;
  if (rows.length) await qrHandleWorldInfo(rows);
}
async function qrHandleWorldInfo(entries) {
  if (!qrCanAuto() || !Array.isArray(entries) || !entries.length) return;
  var seen =
    typeof generationTarget === 'object' && generationTarget
      ? generationTarget._qrWiSeen || (generationTarget._qrWiSeen = Object.create(null))
      : null;
  var ids = entries
    .map(function (entry) {
      return String((entry && entry.automationId) || '').trim();
    })
    .filter(function (id) {
      return id && (!seen || !seen[id]);
    });
  if (!ids.length) return;
  var rows = [];
  qrBoundSets().forEach(function (set) {
    (set.qrList || []).forEach(function (item) {
      if (item && item.automationId && ids.indexOf(item.automationId) >= 0) rows.push({ set: set, item: item });
    });
  });
  if (!rows.length) return;
  rows.forEach(function (row) {
    if (seen) seen[row.item.automationId] = true;
  });
  await qrPerformAutoRows(rows, {});
}
async function executeStscriptFromChat(text) {
  var input = $('user-input'),
    source = String(text || '');
  if (!qrStRuntimeAvailable()) return typeof doSendMessage === 'function' ? await doSendMessage(source) : false;
  var abort = new StscriptAbortController();
  var owner = typeof stscriptCurrentOwner === 'function' ? stscriptCurrentOwner() : { charId: '', sessionId: '' };
  return qrRunTop(
    async function (abort, owner) {
      try {
        if (typeof stscriptBeginRun === 'function') stscriptBeginRun({ nested: false, owner: owner });
        _qrRun = { set: '聊天输入', label: source.slice(0, 24) };
        if (typeof renderStscriptRunStatus === 'function') renderStscriptRunStatus();
        var result = await executeStscript(source, {
          abortController: abort,
          handleParserErrors: false,
          handleExecutionErrors: false,
          source: 'chat',
        });
        if (typeof stscriptFlushVars === 'function') await stscriptFlushVars();
        if (input && !(result && result.isAborted) && String(input.value || '') === source) {
          input.value = '';
          if (typeof input.dispatchEvent === 'function') input.dispatchEvent(new Event('input'));
        }
        if (result && result.isAborted && !result.isQuietlyAborted && typeof toast === 'function')
          toast(result.abortReason || '脚本已停止', 'info');
        return result;
      } catch (error) {
        if (input) {
          input.value = source;
          if (typeof input.dispatchEvent === 'function') input.dispatchEvent(new Event('input'));
        }
        if (typeof toast === 'function') toast(stscriptFormatError(error), 'err');
        return { isError: true, errorMessage: stscriptFormatError(error), error: error };
      } finally {
        if (typeof stscriptEndRun === 'function') stscriptEndRun();
      }
    },
    abort,
    owner
  );
}
async function executeStscriptFromCardFrontend(text, owner, eventRun, eventSignal, eventCancel) {
  var source = String(text == null ? '' : text),
    abort = new StscriptAbortController(),
    runOwner =
      owner && owner.charId
        ? { charId: String(owner.charId), sessionId: String(owner.sessionId || '') }
        : typeof stscriptCurrentOwner === 'function'
          ? stscriptCurrentOwner()
          : { charId: '', sessionId: '' };
  var ownerChar =
    typeof D !== 'undefined' && D && Array.isArray(D.characters)
      ? D.characters.find(function (char) {
          return String((char && char.id) || '') === String(runOwner.charId || '');
        })
      : null;
  if (!qrStRuntimeAvailable(ownerChar || qrActiveCharacter()))
    throw new Error('Risu 卡片不运行 TavernHelper / STScript 指令');
  if (!source.trim()) return '';
  if (typeof _generationState !== 'undefined' && _generationState !== 'idle')
    throw new Error('当前正在生成，卡片前端指令未执行');
  async function execute(abort, runOwner, nested) {
    try {
      if (typeof stscriptBeginRun === 'function') stscriptBeginRun({ nested: nested, owner: runOwner });
      var result = await executeStscript(source, {
        abortController: abort,
        handleParserErrors: false,
        handleExecutionErrors: false,
        source: 'card-frontend',
      });
      if (typeof stscriptFlushVars === 'function') await stscriptFlushVars();
      if (result && result.isAborted) throw new Error(result.abortReason || '脚本已停止');
      return (result && result.pipe) || '';
    } catch (error) {
      throw new Error(
        "运行 Slash 命令 '" +
          source +
          "' 时出错: " +
          (typeof stscriptFormatError === 'function'
            ? stscriptFormatError(error)
            : String((error && error.message) || error))
      );
    } finally {
      if (typeof stscriptEndRun === 'function') stscriptEndRun();
    }
  }
  // Only a call carrying the active listener's source can re-enter the run which awaits that listener.
  // A click in the same frame keeps its own controller and joins the normal top-level queue.
  if (eventRun) {
    if (
      eventRun.abort.signal.aborted ||
      (eventSignal && eventSignal.aborted) ||
      (eventRun !== _qrTop && eventRun.state !== 'completed') ||
      String(eventRun.owner.charId || '') !== runOwner.charId ||
      String(eventRun.owner.sessionId || '') !== runOwner.sessionId
    )
      throw new Error('所属事件调用已停止或失效');
    if (eventRun === _qrTop) return execute(eventRun.abort, eventRun.owner, true);
    // A synchronous emitter may have completed while its async listener is still running.
    // Continue in the normal queue, keeping cancellation attached until this command settles.
    var cancel = function () {
      if (!abort.signal.aborted) abort.abort('所属事件调用已停止', false);
    };
    eventRun.abort.onAbort(cancel);
    if (eventSignal) eventSignal.addEventListener('abort', cancel, { once: true });
    if (eventCancel) abort.onAbort(eventCancel);
    try {
      return await qrRunTop(
        function (abort, runOwner) {
          if (abort.signal.aborted) throw new Error('所属事件调用已停止');
          return execute(abort, runOwner, false);
        },
        abort,
        runOwner
      );
    } finally {
      eventRun.abort.offAbort(cancel);
      if (eventSignal) eventSignal.removeEventListener('abort', cancel);
      if (eventCancel) abort.offAbort(eventCancel);
    }
  }
  return qrRunTop(
    function (abort, runOwner) {
      return execute(abort, runOwner, false);
    },
    abort,
    runOwner
  );
}
async function qrImportJson(text, bind, fileName) {
  var data = text;
  if (typeof text === 'string') {
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error('文件不是有效的 JSON，可能不是快捷栏文件');
    }
  }
  if (!data || typeof data !== 'object') throw new Error('快捷栏文件无效');
  var set = qrNormalizeSet(data);
  if (!set.name) throw new Error('快捷栏集合缺少名称');
  set.yeyuSource = { type: 'file', fileName: String(fileName || '') };
  await qrUpsertSet(set, bind === true);
  return set;
}
function qrRetargetBindings(from, to) {
  var state = qrState();
  state.globalSetNames = state.globalSetNames
    .map(function (name) {
      return name === from ? to : name;
    })
    .filter(function (name, idx, arr) {
      return name && arr.indexOf(name) === idx;
    });
  Object.keys(state.characterLinks || {}).forEach(function (charId) {
    var names = state.characterLinks[charId];
    if (!Array.isArray(names)) return;
    state.characterLinks[charId] = names
      .map(function (name) {
        return name === from ? to : name;
      })
      .filter(function (name, idx, arr) {
        return name && arr.indexOf(name) === idx;
      });
  });
  if (typeof D !== 'undefined' && D.chats)
    Object.keys(D.chats).forEach(function (charId) {
      var box = D.chats[charId];
      ((box && box.sessions) || []).forEach(function (sess) {
        if (!sess || !sess.quickReply || !Array.isArray(sess.quickReply.setNames)) return;
        sess.quickReply.setNames = sess.quickReply.setNames
          .map(function (name) {
            return name === from ? to : name;
          })
          .filter(function (name, idx, arr) {
            return name && arr.indexOf(name) === idx;
          });
      });
    });
}
function qrUnbindName(name) {
  qrRetargetBindings(name, '');
}
async function qrRenameSet(oldName, newName) {
  oldName = String(oldName || '');
  newName = String(newName || '').trim();
  if (!qrFindSet(oldName)) throw new Error('找不到集合 "' + oldName + '"');
  if (!newName) throw new Error('集合名称不能为空');
  if (newName !== oldName && qrFindSet(newName)) throw new Error('已有同名集合');
  return qrCommit(['meta', 'sessions'], function () {
    var set = qrFindSet(oldName);
    set.name = newName;
    qrRetargetBindings(oldName, newName);
  });
}
async function qrDeleteSet(name) {
  name = String(name || '');
  if (!qrFindSet(name)) throw new Error('找不到集合 "' + name + '"');
  return qrCommit(['meta', 'sessions'], function () {
    var state = qrState();
    state.sets = state.sets.filter(function (set) {
      return set.name !== name;
    });
    qrUnbindName(name);
  });
}
async function qrBind(scope, name, on) {
  name = String(name || '');
  if (!qrFindSet(name)) throw new Error('找不到集合 "' + name + '"');
  var char = scope === 'character' ? stscriptChar() : null;
  if (scope === 'character' && !char) throw new Error('请选择角色后绑定快捷栏');
  var keys = scope === 'chat' ? ['sessions'] : ['meta'];
  return qrCommit(keys, function () {
    if (scope === 'global') {
      var state = qrState(),
        idx = state.globalSetNames.indexOf(name);
      if (on && idx < 0) state.globalSetNames.push(name);
      if (!on && idx >= 0) state.globalSetNames.splice(idx, 1);
    } else if (scope === 'chat') {
      var chat = qrChatConfig(true),
        cidx = chat.setNames.indexOf(name);
      if (on && cidx < 0) chat.setNames.push(name);
      if (!on && cidx >= 0) chat.setNames.splice(cidx, 1);
      if (typeof stscriptMarkVars === 'function') stscriptMarkVars('sessions');
    } else if (scope === 'character') {
      var links = qrState().characterLinks;
      if (!Array.isArray(links[char.id])) links[char.id] = [];
      var lidx = links[char.id].indexOf(name);
      if (on && lidx < 0) links[char.id].push(name);
      if (!on && lidx >= 0) links[char.id].splice(lidx, 1);
    } else throw new Error('未知范围');
  });
}
function qrApplyEntryProps(item, props) {
  props = props || {};
  if (props.icon !== undefined) item.icon = String(props.icon || '');
  if (props.showLabel !== undefined) item.showLabel = props.showLabel === true;
  if (props.newLabel !== undefined && String(props.newLabel || '').trim()) item.label = String(props.newLabel);
  if (props.label !== undefined && props.newLabel === undefined) item.label = String(props.label || '');
  if (props.message !== undefined) item.message = String(props.message || '');
  if (props.title !== undefined) item.title = String(props.title || '');
  if (props.isHidden !== undefined) item.isHidden = props.isHidden === true;
  if (props.executeOnStartup !== undefined) item.executeOnStartup = props.executeOnStartup === true;
  if (props.executeOnUser !== undefined) item.executeOnUser = props.executeOnUser === true;
  if (props.executeOnAi !== undefined) item.executeOnAi = props.executeOnAi === true;
  if (props.executeOnChatChange !== undefined) item.executeOnChatChange = props.executeOnChatChange === true;
  if (props.executeOnNewChat !== undefined) item.executeOnNewChat = props.executeOnNewChat === true;
  if (props.executeBeforeGeneration !== undefined)
    item.executeBeforeGeneration = props.executeBeforeGeneration === true;
  if (props.automationId !== undefined) item.automationId = String(props.automationId || '');
  return item;
}
function qrBoolArg(value) {
  return value === undefined ? undefined : stscriptIsTrue(value);
}
stscriptAddCommand({
  name: 'qr',
  namedArgumentList: [{ name: 'set' }],
  callback: async function (args, value) {
    var raw = Array.isArray(value) ? value.join(' ') : String(value || '').trim();
    if (/^\d+$/.test(raw)) {
      var buttons = qrVisibleButtons(),
        idx = Number(raw);
      if (!Number.isInteger(idx) || idx < 0 || idx >= buttons.length) throw new Error('快捷栏编号不存在');
      return qrExecuteWithOptions(buttons[idx].set, buttons[idx].item, { abortController: args._abortController });
    }
    return executeQuickReplyByName((args.set ? args.set + '.' : '') + raw, args, {
      abortController: args._abortController,
      isRun: true,
    });
  },
});
stscriptAddCommand({
  name: 'qrset',
  aliases: ['qr-set'],
  callback: async function (args, value) {
    await qrBind('global', value, true);
    return String(value || '');
  },
});
stscriptAddCommand({
  name: 'qr-set-on',
  callback: async function (args, value) {
    await qrBind('global', value, true);
    return String(value || '');
  },
});
stscriptAddCommand({
  name: 'qr-set-off',
  callback: async function (args, value) {
    await qrBind('global', value, false);
    return String(value || '');
  },
});
stscriptAddCommand({
  name: 'qr-chat-set',
  callback: async function (args, value) {
    await qrBind('chat', value, true);
    return String(value || '');
  },
});
stscriptAddCommand({
  name: 'qr-chat-set-on',
  callback: async function (args, value) {
    await qrBind('chat', value, true);
    return String(value || '');
  },
});
stscriptAddCommand({
  name: 'qr-chat-set-off',
  callback: async function (args, value) {
    await qrBind('chat', value, false);
    return String(value || '');
  },
});
stscriptAddCommand({
  name: 'qr-set-list',
  dryRun: 'run',
  callback: function () {
    return JSON.stringify(
      qrState().sets.map(function (set) {
        return set.name;
      })
    );
  },
});
stscriptAddCommand({
  name: 'qr-list',
  dryRun: 'run',
  namedArgumentList: [{ name: 'set' }],
  callback: function (args) {
    var set = args.set ? qrFindSet(args.set) : qrBoundSets()[0];
    return JSON.stringify(
      ((set && set.qrList) || []).map(function (item) {
        return item.label;
      })
    );
  },
});
// ST's Quick Reply editing commands report a failure as a toast and yield an empty result, so the script goes on.
async function qrEditCommandResult(run, quiet) {
  try {
    return await run();
  } catch (error) {
    if (!quiet && typeof toast === 'function') toast(String((error && error.message) || error), 'err');
    return '';
  }
}
stscriptAddCommand({
  name: 'qr-get',
  dryRun: 'run',
  namedArgumentList: [{ name: 'set' }, { name: 'label' }, { name: 'id' }],
  callback: function (args) {
    return qrEditCommandResult(function () {
      if (!args.set || (args.id == null && !args.label)) throw new Error('请提供集合和条目');
      var found = qrGetEntry(args.set, args.id != null && args.id !== '' ? args.id : args.label);
      return JSON.stringify(qrCopy(found.item));
    }, stscriptDryRunning(args));
  },
});
stscriptAddCommand({
  name: 'qr-create',
  namedArgumentList: [
    { name: 'set' },
    { name: 'label' },
    { name: 'icon' },
    { name: 'showlabel' },
    { name: 'hidden' },
    { name: 'startup' },
    { name: 'user' },
    { name: 'bot' },
    { name: 'load' },
    { name: 'new' },
    { name: 'generation' },
    { name: 'title' },
    { name: 'automationId' },
  ],
  callback: function (args, value) {
    return qrEditCommandResult(async function () {
      var set = qrFindSet(args.set);
      if (!set) throw new Error('找不到集合 "' + String(args.set || '') + '"');
      var message = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value);
      var item = null;
      await qrCommit(['meta'], function () {
        item = qrNormalizeEntry({
          id: ++set.idIndex,
          label: args.label || '',
          icon: args.icon || '',
          showLabel: qrBoolArg(args.showlabel) === true,
          title: args.title || '',
          message: message,
          isHidden: qrBoolArg(args.hidden) === true,
          executeOnStartup: qrBoolArg(args.startup) === true,
          executeOnUser: qrBoolArg(args.user) === true,
          executeOnAi: qrBoolArg(args.bot) === true,
          executeOnChatChange: qrBoolArg(args.load) === true,
          executeOnNewChat: qrBoolArg(args.new) === true,
          executeBeforeGeneration: qrBoolArg(args.generation) === true,
          automationId: args.automationId || '',
        });
        set.qrList.push(item);
      });
      return String(item.id);
    });
  },
});
stscriptAddCommand({
  name: 'qr-update',
  namedArgumentList: [
    { name: 'set' },
    { name: 'label' },
    { name: 'id' },
    { name: 'newlabel' },
    { name: 'icon' },
    { name: 'showlabel' },
    { name: 'hidden' },
    { name: 'startup' },
    { name: 'user' },
    { name: 'bot' },
    { name: 'load' },
    { name: 'new' },
    { name: 'generation' },
    { name: 'title' },
    { name: 'automationId' },
  ],
  callback: function (args, value) {
    return qrEditCommandResult(async function () {
      var found = qrGetEntry(args.set, args.id != null && args.id !== '' ? args.id : args.label);
      var message = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value);
      await qrCommit(['meta'], function () {
        qrApplyEntryProps(found.item, {
          icon: args.icon,
          showLabel: qrBoolArg(args.showlabel),
          newLabel: args.newlabel,
          title: args.title,
          message: message.trim() ? message : undefined,
          isHidden: qrBoolArg(args.hidden),
          executeOnStartup: qrBoolArg(args.startup),
          executeOnUser: qrBoolArg(args.user),
          executeOnAi: qrBoolArg(args.bot),
          executeOnChatChange: qrBoolArg(args.load),
          executeOnNewChat: qrBoolArg(args.new),
          executeBeforeGeneration: qrBoolArg(args.generation),
          automationId: args.automationId,
        });
      });
      return found.item.message;
    });
  },
});
stscriptAddCommand({
  name: 'qr-delete',
  namedArgumentList: [{ name: 'set' }, { name: 'label' }, { name: 'id' }],
  callback: function (args, value) {
    return qrEditCommandResult(async function () {
      var found = qrGetEntry(args.set, args.id != null && args.id !== '' ? args.id : args.label || value);
      await qrCommit(['meta'], function () {
        found.set.qrList = found.set.qrList.filter(function (item) {
          return item !== found.item;
        });
      });
      return '';
    });
  },
});
stscriptAddCommand({
  name: 'qr-set-create',
  aliases: ['qr-presetadd'],
  namedArgumentList: [{ name: 'name' }, { name: 'nosend' }, { name: 'before' }, { name: 'inject' }],
  callback: async function (args, value) {
    var name = String(args.name || value || '未命名集合');
    await qrUpsertSet(
      qrNormalizeSet({
        name: name,
        disableSend: qrBoolArg(args.nosend) === true,
        placeBeforeInput: qrBoolArg(args.before) === true,
        injectInput: qrBoolArg(args.inject) === true,
        yeyuSource: qrCreatedSource(),
      }),
      false
    );
    return name;
  },
});
stscriptAddCommand({
  name: 'qr-set-update',
  aliases: ['qr-presetupdate'],
  namedArgumentList: [{ name: 'name' }, { name: 'nosend' }, { name: 'before' }, { name: 'inject' }],
  callback: async function (args, value) {
    var name = String(args.name || value || '');
    var set = qrFindSet(name);
    if (!set) throw new Error('找不到集合');
    await qrCommit(['meta'], function () {
      set.disableSend = qrBoolArg(args.nosend) === true;
      set.placeBeforeInput = qrBoolArg(args.before) === true;
      set.injectInput = qrBoolArg(args.inject) === true;
    });
    return set.name;
  },
});
stscriptAddCommand({
  name: 'qr-set-delete',
  aliases: ['qr-presetdelete'],
  callback: async function (args, value) {
    await qrDeleteSet(value);
    return '';
  },
});
stscriptAddCommand({
  name: 'qr-arg',
  dryRun: 'run',
  splitUnnamedArgument: true,
  splitUnnamedArgumentCount: 2,
  callback: function (args, value) {
    var key = Array.isArray(value) ? value[0] : value,
      val = Array.isArray(value) ? value.slice(1).join(' ') : '';
    if (!args._scope) throw new Error('/qr-arg 缺少作用域');
    args._scope.setMacro('arg::' + String(key || ''), val, String(key || '').includes('*'));
    return '';
  },
});
if (typeof window !== 'undefined' && window.addEventListener)
  window.addEventListener('pagehide', function () {
    stopStscriptRun();
  });
