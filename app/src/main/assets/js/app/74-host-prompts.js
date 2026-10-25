var _hostFacadePrompts = new Map();
function hostPromptNormalize(value, options, facade) {
  if (!objectRecord(value)) throw new Error('注入条目必须是对象');
  var id =
      value.id == null ? (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uid()) : String(value.id),
    position = value.position || 'in_chat',
    role = value.role || 'system',
    depth = value.depth ?? 0;
  if (!['in_chat', 'none', 'before_prompt', 'in_prompt'].includes(position))
    throw new Error('注入位置无效：' + position);
  if (!['system', 'user', 'assistant'].includes(role)) throw new Error('注入 role 必须为 system、user 或 assistant');
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0) throw new Error('注入 depth 必须是非负数字');
  if (value.filter != null && typeof value.filter !== 'function') throw new Error('注入 filter 必须是函数');
  var row = {
    id: id,
    position: position,
    role: role,
    depth: depth,
    content: String(value.content ?? ''),
    should_scan: value.should_scan === true,
    once: options && options.once === true,
    hasFilter: typeof value.filter === 'function',
  };
  if (typeof value.filterText === 'string' && value.filterText) row.filterText = value.filterText;
  return row;
}
function hostPromptSetFacade(live, value) {
  var context = cardFrontendRequireCurrent(live),
    row = hostPromptNormalize(value, {}, true);
  hostPromptCommit(context, live, [{ id: row.id, row: row, filter: value.filter, facade: true }]);
}
function hostPromptEntries(char, session) {
  var entries = hostPromptRows(session).map(function (row) {
    return { row: row, record: _hostPromptFilters.get(hostPromptKey(char.id, session.id, row.id)) };
  });
  _hostFacadePrompts.forEach(function (record) {
    if (record.session === session && cardFrontendLiveIsCurrent(record.live))
      entries.push({ row: record.row, record: record, facade: true });
  });
  return entries;
}
function hostPromptEntryIsCurrent(entry, session) {
  if (entry.facade) {
    var record = entry.record,
      live = record && record.live;
    return (
      !!record &&
      _hostFacadePrompts.get(hostPromptKey(record.charId, session.id, entry.row.id)) === record &&
      cardFrontendLiveIsCurrent(live)
    );
  }
  return !!(session.promptInjections && session.promptInjections[entry.row.id] === entry.row);
}
var _hostPromptFilters = new Map();
function hostPromptKey(charId, sessionId, id) {
  return JSON.stringify([charId, sessionId, id]);
}
function hostPromptRows(session) {
  return Object.values(objectRecord(session && session.promptInjections) || {});
}
function hostPromptSave(session, before, next, live, rollback) {
  session.promptInjections = next;
  var task = (async function () {
    return saveData('sessions');
  })();
  task.catch(function (error) {
    if (session.promptInjections === next) {
      session.promptInjections = before;
      if (rollback) rollback();
    }
    cardFrontendSettingsSaveFailed(error, live);
  });
  return task;
}
function hostPromptCommit(context, live, updates) {
  var session = context.session,
    before = session.promptInjections,
    next = Object.assign({}, before || {}),
    previousFilters = new Map(),
    previousFacades = new Map(),
    persistentChanged = false;
  updates.forEach(function (update) {
    var id = update.id,
      key = hostPromptKey(context.char.id, session.id, id),
      hadPersistent = Object.prototype.hasOwnProperty.call(next, id);
    if (!previousFilters.has(key)) previousFilters.set(key, _hostPromptFilters.get(key));
    if (!previousFacades.has(key)) previousFacades.set(key, _hostFacadePrompts.get(key));
    if (!update.row || update.facade) {
      if (hadPersistent) persistentChanged = true;
      delete next[id];
    }
    _hostPromptFilters.delete(key);
    if (!update.row || !update.facade) _hostFacadePrompts.delete(key);
    if (!update.row) return;
    var record = {
      row: update.row,
      filter: update.filter,
      live: live,
      session: session,
      charId: context.char.id,
      script: update.script === true,
    };
    if (update.facade) _hostFacadePrompts.set(key, record);
    else {
      if (!hadPersistent || JSON.stringify(next[id]) !== JSON.stringify(update.row)) persistentChanged = true;
      else record.row = update.row = next[id];
      Object.defineProperty(next, id, { value: update.row, configurable: true, enumerable: true, writable: true });
      if (typeof update.filter === 'function') _hostPromptFilters.set(key, record);
    }
  });
  var saveTask = null;
  if (persistentChanged)
    saveTask = hostPromptSave(session, before, next, live, function () {
      previousFilters.forEach(function (record, key) {
        if (record && (record.script === true || cardFrontendLiveIsCurrent(record.live)))
          _hostPromptFilters.set(key, record);
        else _hostPromptFilters.delete(key);
      });
      previousFacades.forEach(function (record, key) {
        if (record && cardFrontendLiveIsCurrent(record.live)) _hostFacadePrompts.set(key, record);
        else _hostFacadePrompts.delete(key);
      });
    });
  invalidateCacheContexts(context.char.id, 0, true, session.id);
  return saveTask;
}
async function hostPromptCommandInject(char, session, value) {
  if (!char || !session) throw new Error('当前没有可用对话');
  var row = hostPromptNormalize(value, { once: value && value.once === true }, false),
    filter = value && value.filter;
  await hostPromptCommit({ char: char, session: session }, null, [
    { id: row.id, row: row, filter: filter, script: true },
  ]);
  return row.id;
}
async function hostPromptCommandRemove(char, session, id) {
  if (!char || !session) throw new Error('当前没有可用对话');
  var rows = hostPromptRows(session),
    ids =
      id == null || String(id) === ''
        ? rows.map(function (row) {
            return row.id;
          })
        : [String(id)];
  if (!ids.length) return '';
  await hostPromptCommit(
    { char: char, session: session },
    null,
    ids.map(function (value) {
      return { id: value };
    })
  );
  return '';
}
function hostPromptInject(live, prompts, options) {
  var context = cardFrontendRequireCurrent(live);
  if (!Array.isArray(prompts)) throw new Error('injectPrompts 需要注入条目数组');
  var updates = prompts.map(function (value) {
    var row = hostPromptNormalize(value, options, false);
    return { id: row.id, row: row, filter: value.filter };
  });
  hostPromptCommit(context, live, updates);
  return updates.map(function (update) {
    return update.id;
  });
}
function hostPromptUninject(live, ids) {
  var context = cardFrontendRequireCurrent(live);
  if (!Array.isArray(ids)) throw new Error('uninjectPrompts 需要 id 数组');
  hostPromptCommit(
    context,
    live,
    ids.map(function (id) {
      return { id: String(id) };
    })
  );
}
function hostPromptReleaseOwner(live) {
  _hostFacadePrompts.forEach(function (record, key) {
    if (record.live === live) _hostFacadePrompts.delete(key);
  });
  _hostPromptFilters.forEach(function (record, key) {
    if (record.live === live) _hostPromptFilters.delete(key);
  });
}
function hostPromptReleaseSession(session) {
  _hostFacadePrompts.forEach(function (record, key) {
    if (record.session === session) _hostFacadePrompts.delete(key);
  });
  _hostPromptFilters.forEach(function (record, key) {
    if (record.session === session) _hostPromptFilters.delete(key);
  });
}
function hostPromptSnapshot(char, session) {
  return hostPromptEntries(char, session)
    .filter(function (entry) {
      var row = entry.row,
        record = entry.record;
      return (
        hostPromptEntryIsCurrent(entry, session) &&
        (!row.hasFilter ||
          !!(
            record &&
            record.row === row &&
            record.allowed === true &&
            (record.script === true || cardFrontendLiveIsCurrent(record.live))
          ))
      );
    })
    .map(function (entry) {
      return cloneData(entry.row);
    });
}
// Runs every filter, as ST getExtensionPrompt does on each assembly. A preview runs them too but registers
// nothing: a card frontend's filter runs as a dry-run listener of its owner, and an /inject filter (restored or
// run from its stored text) runs as a dry STScript run that is handed the preview notes.
async function hostPromptPrepare(char, session, signal, options) {
  var preview = !!(options && options.preview),
    entries = hostPromptEntries(char, session),
    output = [];
  for (var entry of entries) {
    var row = entry.row;
    if (signal && signal.aborted) throw cardFrontendGenerationAbortError();
    if (row.hasFilter) {
      var record = hostPromptFilterRecord(entry.record, row),
        filter = record
          ? record.filter
          : preview && row.filterText && typeof stscriptPromptFilterForRow === 'function'
            ? stscriptPromptFilterForRow(row)
            : null;
      if (!filter) continue;
      var allowed = await hostPromptRunFilter(filter, record, signal, preview ? options.previewNotes || [] : null);
      if (!preview) record.allowed = !!allowed;
      if (!allowed || (record && record.script !== true && !cardFrontendLiveIsCurrent(record.live))) continue;
    }
    if (hostPromptEntryIsCurrent(entry, session)) output.push(cloneData(row));
  }
  if (signal && signal.aborted) throw cardFrontendGenerationAbortError();
  return output;
}
function hostPromptFilterRecord(record, row) {
  return record && record.row === row && (record.script === true || cardFrontendLiveIsCurrent(record.live))
    ? record
    : null;
}
function hostPromptRunFilter(filter, record, signal, previewNotes) {
  return new Promise(function (resolve, reject) {
    var cancel = function () {
      reject(cardFrontendGenerationAbortError());
    };
    if (signal && signal.addEventListener) signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve()
      .then(function () {
        if (!previewNotes) return filter();
        return record && record.live
          ? cardFrontendDryRun(record.live, previewNotes, filter, signal)
          : filter(previewNotes);
      })
      .then(resolve, reject)
      .finally(function () {
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', cancel);
      });
  });
}
function hostPromptFinish(session) {
  if (!session) return;
  var before = session.promptInjections,
    next = Object.assign({}, before || {}),
    changed = false,
    previousFilters = new Map();
  Object.keys(next).forEach(function (id) {
    if (next[id].once === true) {
      delete next[id];
      changed = true;
    }
  });
  _hostPromptFilters.forEach(function (record, key) {
    if (record.row.once && before && before[record.row.id] === record.row) {
      previousFilters.set(key, record);
      _hostPromptFilters.delete(key);
    }
  });
  if (changed)
    hostPromptSave(session, before, next, null, function () {
      previousFilters.forEach(function (record, key) {
        _hostPromptFilters.set(key, record);
      });
    });
}
function hostPromptCall(live, name, args) {
  if (name === 'injectPrompts')
    return { handled: true, value: hostPromptInject(live, args && args.prompts, args && args.option) };
  if (name === 'uninjectPrompts') return { handled: true, value: hostPromptUninject(live, args && args.ids) };
  return null;
}
