/* global module */
// The guarded CommonJS export is used by Node tests.
function presetTaskTokenizeSlash(text) {
  var out = [],
    match,
    re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  while ((match = re.exec(String(text || ''))))
    out.push(
      String(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]).replace(
        /\\([\\"'])/g,
        '$1'
      )
    );
  return out;
}
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YeyuPresetTaskRuntime = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var TASK_OWNER_ID = 100000;
  var TIMINGS = [
    'after_ai',
    'before_user',
    'any_message',
    'initialization',
    'character_init',
    'plugin_init',
    'only_this_floor',
    'chat_changed',
  ];
  var FLOOR_TYPES = ['all', 'user', 'llm'];

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }
  function taskId(task, index) {
    return String((task && task.id) || (task && task.name) || 'task-' + index);
  }
  function abortError(reason) {
    var e = new Error(String(reason || '已停止'));
    e.name = 'AbortError';
    return e;
  }
  function isAborted(signal) {
    return !!(signal && signal.aborted);
  }
  function assertCurrent(options) {
    if (options && (isAborted(options.signal) || (options.current && !options.current())))
      throw abortError('任务所属生成已结束');
  }
  function awaitRun(work, signal) {
    return new Promise(function (resolve, reject) {
      var cancel = function () {
        reject(abortError(signal.reason));
      };
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(work)
        .then(resolve, reject)
        .finally(function () {
          signal.removeEventListener('abort', cancel);
        });
    });
  }
  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  // This deliberately returns references from the active raw preset. Callers receive a read-only
  // view and all runtime overrides live in memory; no task definition is copied to persistence.
  function readEmbeddedTasks(raw) {
    if (!raw || !Array.isArray(raw.prompt_order)) return [];
    for (var i = 0; i < raw.prompt_order.length; i++) {
      var row = raw.prompt_order[i];
      if (!row || Number(row.character_id) !== TASK_OWNER_ID) continue;
      var extension = object(row.xiaobai_ext);
      return extension && Array.isArray(extension.scheduledTasks) ? extension.scheduledTasks : [];
    }
    return [];
  }

  function normalizeTask(source, index) {
    var row = object(source) || {};
    var timing = String(row.triggerTiming || 'any_message');
    if (TIMINGS.indexOf(timing) < 0) timing = 'any_message';
    var floorType = String(row.floorType || 'all');
    if (FLOOR_TYPES.indexOf(floorType) < 0) floorType = 'all';
    var interval = Math.max(0, Math.floor(number(row.interval, 1)));
    var commands = Array.isArray(row.commands)
      ? row.commands.slice()
      : [row.commands == null ? '' : String(row.commands)];
    return Object.assign({}, row, {
      id: taskId(row, index),
      name: String(row.name || taskId(row, index)),
      commands: commands,
      interval: interval,
      floorType: floorType,
      triggerTiming: timing,
      disabled: row.disabled === true,
      buttonActivated: row.buttonActivated === true,
      source: row,
    });
  }

  function createRuntime(options) {
    options = options || {};
    var host = options.host || (typeof window !== 'undefined' ? window : globalThis);
    var settings =
      options.settings ||
      function () {
        return (host.D && host.D.settings) || {};
      };
    var readRaw =
      options.getActiveRawPreset ||
      function () {
        if (typeof host.activeCompletionPresetRaw === 'function') return host.activeCompletionPresetRaw();
        var state = host.D && host.D.settings;
        return (state && state.chatCompletionPresetInUse) || null;
      };
    var executeStscript = options.executeStscript || host.executeStscript;
    var executeSlash =
      options.executeSlashCommand || host.executeSlashCommand || host.triggerSlashWithResult || host.triggerSlash;
    var generateRaw = options.xbgenraw || options.generateRaw || host.xbgenraw;
    var executionAllowed =
      options.isExecutionAllowed ||
      function () {
        return true;
      };
    var eventBus = options.eventBus || null;
    var tasks = new Map(),
      overrides = new Map(),
      runs = new Map(),
      listeners = new Map();
    var dynamic = new Map(),
      timerSerial = 0,
      runSerial = 0;
    var floors = { all: 0, user: 0, llm: 0 };
    var identity = { preset: null, character: null, session: null };
    var initializedCharacter = null;
    var attached = false,
      disposed = false;

    function enabled() {
      var s = typeof settings === 'function' ? settings() : settings;
      return !!(executionAllowed() && s && s.presetEmbeddedTasksEnabled === true);
    }
    function activeRaw() {
      return typeof readRaw === 'function' ? readRaw() : readRaw;
    }
    function refresh() {
      var raw = activeRaw(),
        rows = readEmbeddedTasks(raw),
        next = new Map();
      rows.forEach(function (row, index) {
        var task = normalizeTask(row, index);
        next.set(task.id, task);
      });
      tasks = next;
      identity.preset = raw || null;
      return list();
    }
    function list() {
      var out = [];
      tasks.forEach(function (task) {
        out.push(effective(task));
      });
      return out;
    }
    function findTask(name) {
      var wanted = String(name || '').toLowerCase();
      var found = null;
      tasks.forEach(function (task) {
        var row = effective(task);
        if (!found && (String(row.id).toLowerCase() === wanted || String(row.name).toLowerCase() === wanted))
          found = task;
      });
      return found;
    }
    function find(name) {
      var task = findTask(name);
      return task ? effective(task) : null;
    }
    function effective(task) {
      var row = Object.assign({}, task, overrides.get(task.id) || {}, { source: undefined });
      row.commands = Array.isArray(row.commands) ? row.commands.slice() : [String(row.commands || '')];
      return row;
    }
    function assertEnabled() {
      if (!enabled()) throw new Error('预设内任务未启用');
    }
    function setOverride(task, patch) {
      overrides.set(task.id, Object.assign({}, overrides.get(task.id) || {}, patch));
      return effective(task);
    }

    function registerListener(run, event, callback) {
      if (typeof callback !== 'function') throw new Error('监听器必须是函数');
      var key = String(event || '*'),
        bucket = listeners.get(key);
      if (!bucket) {
        bucket = new Set();
        listeners.set(key, bucket);
      }
      var record = { callback: callback, runId: (run && run.id) || null };
      bucket.add(record);
      if (run)
        run.listeners.add(function () {
          bucket.delete(record);
          if (!bucket.size) listeners.delete(key);
        });
      return function () {
        bucket.delete(record);
        if (!bucket.size) listeners.delete(key);
      };
    }
    function removeListener(run, event, callback) {
      var key = String(event || '*'),
        bucket = listeners.get(key);
      if (!bucket) return false;
      var removed = false;
      bucket.forEach(function (record) {
        if (record.runId === run.id && (!callback || record.callback === callback)) {
          bucket.delete(record);
          removed = true;
        }
      });
      if (!bucket.size) listeners.delete(key);
      return removed;
    }
    function safeTimeout(run, callback, ms) {
      var id = ++timerSerial,
        handle = setTimeout(
          function () {
            if (!isAborted(run.signal)) {
              run.timers.delete(id);
              callback();
            }
          },
          Math.max(0, number(ms, 0))
        );
      run.timers.set(id, handle);
      return id;
    }
    function safeInterval(run, callback, ms) {
      var id = ++timerSerial,
        handle = setInterval(
          function () {
            if (!isAborted(run.signal)) callback();
          },
          Math.max(1, number(ms, 1))
        );
      run.intervals.set(id, handle);
      return id;
    }
    function clearSafe(run, id) {
      if (run.timers.has(id)) {
        clearTimeout(run.timers.get(id));
        run.timers.delete(id);
      }
      if (run.intervals.has(id)) {
        clearInterval(run.intervals.get(id));
        run.intervals.delete(id);
      }
    }
    function addFloorListener(run, callback, opts) {
      opts = opts || {};
      var record = {
        callback: callback,
        timing:
          TIMINGS.indexOf(String(opts.timing || opts.triggerTiming || 'after_ai')) >= 0
            ? String(opts.timing || opts.triggerTiming || 'after_ai')
            : 'after_ai',
        interval: Math.max(0, Math.floor(number(opts.interval, 1))),
        floorType: FLOOR_TYPES.indexOf(String(opts.floorType || 'all')) >= 0 ? String(opts.floorType || 'all') : 'all',
        runId: run.id,
        signal: run.signal,
        taskId: run.task.id,
      };
      dynamic.set(run.id + ':' + ++timerSerial, record);
      run.dynamic.add(record);
      return function () {
        dynamic.forEach(function (value, key) {
          if (value === record) dynamic.delete(key);
        });
        run.dynamic.delete(record);
      };
    }
    function removeDynamicForTask(taskIdValue) {
      dynamic.forEach(function (record, key) {
        if (record.taskId === taskIdValue) dynamic.delete(key);
      });
    }
    function cleanRun(run) {
      run.listeners.forEach(function (remove) {
        try {
          remove();
        } catch (_) {}
      });
      run.listeners.clear();
      run.timers.forEach(function (handle) {
        clearTimeout(handle);
      });
      run.timers.clear();
      run.intervals.forEach(function (handle) {
        clearInterval(handle);
      });
      run.intervals.clear();
      // Floor listeners are task-owned and survive the TaskJS invocation. They are removed
      // when that task is reset or when the preset/character/session is changed.
      run.dynamic.clear();
    }
    function contextFor(run, extra) {
      var ctx = Object.assign(
        {
          runtime: api,
          task: run.task,
          signal: run.signal,
          floors: Object.assign({}, floors),
          currentFloor: floors.all,
        },
        extra || {}
      );
      ctx.taskContext = ctx;
      return ctx;
    }
    async function callSlash(command, run, ctx) {
      assertCurrent(run.cancelOptions);
      assertCurrent(ctx);
      if (isAborted(run.signal)) throw abortError(run.signal.reason);
      var text = String(command || '').trim();
      if (!text) return '';
      if (text.charAt(0) !== '/') text = '/' + text;
      var parts = presetTaskTokenizeSlash(text),
        commandName = String(parts[0] || '').toLowerCase();
      if (commandName === '/xbgenraw') return await xbgenraw(text, run, ctx);
      if (commandName === '/xbqte') return await executeNamed(parts.slice(1).join(' '), ctx);
      if (commandName === '/xbset') return await commandSet(parts.slice(1), ctx);
      if (typeof executeSlash === 'function') return await executeSlash(text, ctx);
      if (typeof executeStscript === 'function')
        return await executeStscript(text, { source: 'preset-task', abortController: run.controller, scope: ctx });
      throw new Error('没有可用的 STScript 执行器');
    }
    async function xbgenraw(commandOrConfig, run, ctx) {
      assertCurrent(run && run.cancelOptions);
      assertCurrent(ctx);
      if (typeof generateRaw !== 'function') throw new Error('未配置 xbgenraw adapter');
      if (run && isAborted(run.signal)) throw abortError(run.signal.reason);
      return await generateRaw(
        commandOrConfig,
        Object.assign({}, ctx || {}, { signal: run && run.signal, abortSignal: run && run.signal })
      );
    }
    async function executeTaskJS(code, run, ctx) {
      assertCurrent(ctx);
      if (isAborted(run.signal)) throw abortError(run.signal.reason);
      var scope = contextFor(run, ctx),
        STscript = function (command) {
          return callSlash(command, run, scope);
        };
      var remove = function (event, callback) {
        return removeListener(run, event, callback);
      };
      var XBTasks = api.XBTasks;
      var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      var source = String(code || '').replace(
        /\bimport\s*\(\s*(['"])\/script\.js\1\s*\)/g,
        'Promise.resolve(taskContext.scriptModule || {})'
      );
      var wrappedIife = /^\s*\(\s*async\b/.test(source);
      var body = wrappedIife ? '"use strict";\nreturn await eval(taskSource);' : '"use strict";\n' + source + '\n';
      var fn = new AsyncFunction(
        'taskContext',
        'ctx',
        'STscript',
        'addFloorListener',
        'addListener',
        'removeListener',
        'setTimeoutSafe',
        'clearTimeoutSafe',
        'setIntervalSafe',
        'clearIntervalSafe',
        'abortSignal',
        'XBTasks',
        'xbgenraw',
        'taskSource',
        body
      );
      return await fn(
        scope,
        scope,
        STscript,
        function (cb, opts) {
          return addFloorListener(run, cb, opts);
        },
        registerListener.bind(null, run),
        remove,
        function (cb, ms) {
          return safeTimeout(run, cb, ms);
        },
        function (id) {
          return clearSafe(run, id);
        },
        function (cb, ms) {
          return safeInterval(run, cb, ms);
        },
        function (id) {
          return clearSafe(run, id);
        },
        run.signal,
        XBTasks,
        function (value) {
          return xbgenraw(value, run, scope);
        },
        source
      );
    }
    async function executeCommand(command, run, ctx) {
      var text = String(command == null ? '' : command),
        cursor = 0,
        match,
        taskRe = /<<taskjs>>([\s\S]*?)<<\/taskjs>>/gi;
      while ((match = taskRe.exec(text))) {
        var slash = text.slice(cursor, match.index).trim();
        if (slash) await callSlash(slash, run, ctx);
        await executeTaskJS(match[1], run, ctx);
        cursor = taskRe.lastIndex;
      }
      var tail = text.slice(cursor).trim();
      if (tail) return await callSlash(tail, run, ctx);
      return '';
    }
    // cancelOptions carries the caller's signal/current plus the post-commit run this task belongs
    // to. It stays out of `extra` so the generation's cancel plumbing never lands in a task's JS
    // scope or its event payload.
    async function runTask(source, extra, manual, cancelOptions) {
      assertCurrent(cancelOptions);
      assertCurrent(extra);
      assertEnabled();
      var base = source && source.source ? source : findTask((source && (source.id || source.name)) || source);
      if (!base) throw new Error('任务不存在：' + String(source || ''));
      var task = effective(base);
      if (task.disabled) {
        if (manual) throw new Error('任务已禁用：' + task.name);
        return null;
      }
      if (!manual && task.interval === 0) return null;
      var previous = runs.get(task.id);
      if (previous) {
        previous.controller.abort('被新的任务运行替换');
        try {
          await previous.promise;
        } catch (_) {}
      }
      assertCurrent(cancelOptions);
      assertCurrent(extra);
      removeDynamicForTask(task.id);
      var controller = new AbortController(),
        run = {
          id: task.id + ':' + ++runSerial,
          task: task,
          controller: controller,
          signal: controller.signal,
          timers: new Map(),
          intervals: new Map(),
          listeners: new Set(),
          dynamic: new Set(),
          cancelOptions: cancelOptions,
          promise: null,
        };
      // Slash commands in this task reach `args._abortController` as this controller, so hanging the
      // tail on it is what lets a guarded entry tell an after-AI task apart from a user action.
      if (cancelOptions && cancelOptions.postCommitRun) controller.postCommitRun = cancelOptions.postCommitRun;
      var parentSignal = (cancelOptions && cancelOptions.signal) || (extra && extra.signal),
        cancelRun = function () {
          controller.abort('任务所属生成已结束');
        };
      if (parentSignal) {
        if (parentSignal.aborted) cancelRun();
        else parentSignal.addEventListener('abort', cancelRun, { once: true });
      }
      run.promise = (async function () {
        try {
          var ctx = contextFor(run, extra);
          var result = '';
          for (var i = 0; i < task.commands.length; i++) {
            assertCurrent(cancelOptions);
            assertCurrent(extra);
            if (isAborted(run.signal)) throw abortError(run.signal.reason);
            result = await awaitRun(executeCommand(task.commands[i], run, ctx), run.signal);
          }
          return result;
        } catch (error) {
          if (run.signal.aborted && error && error.name === 'AbortError') return null;
          throw error;
        } finally {
          if (parentSignal) parentSignal.removeEventListener('abort', cancelRun);
          cleanRun(run);
          if (runs.get(task.id) === run) runs.delete(task.id);
        }
      })();
      runs.set(task.id, run);
      return await run.promise;
    }
    function countFor(floorType) {
      return floors[floorType] || floors.all;
    }
    function due(task, event, extra) {
      if (task.disabled) return false;
      var timing = String(task.triggerTiming || 'any_message'),
        messageEvent = event === 'after_ai' || event === 'before_user';
      if (timing !== event && !(messageEvent && (timing === 'any_message' || timing === 'only_this_floor')))
        return false;
      var interval = Math.max(0, Math.floor(number(task.interval, 1)));
      if (interval === 0) return false;
      if (timing === 'only_this_floor') return extra && Number(extra.currentFloor) === floors.all;
      return countFor(task.floorType) % interval === 0;
    }
    function dynamicDue(record, event, extra) {
      var messageEvent = event === 'after_ai' || event === 'before_user',
        timingMatches =
          record.timing === event ||
          (messageEvent && (record.timing === 'any_message' || record.timing === 'only_this_floor'));
      return (
        timingMatches &&
        record.interval !== 0 &&
        countFor(record.floorType) % record.interval === 0 &&
        (!extra ||
          extra.currentFloor == null ||
          record.timing !== 'only_this_floor' ||
          Number(extra.currentFloor) === floors.all)
      );
    }
    async function dispatch(event, extra, cancelOptions) {
      assertCurrent(cancelOptions);
      assertCurrent(extra);
      if (disposed || !enabled()) return [];
      extra = Object.assign({ event: event, floors: Object.assign({}, floors), currentFloor: floors.all }, extra || {});
      var work = [],
        dynamicRows = Array.from(dynamic.values());
      [String(event), '*'].forEach(function (key) {
        var bucket = listeners.get(key);
        if (!bucket) return;
        Array.from(bucket).forEach(function (record) {
          work.push(Promise.resolve(record.callback(extra)));
        });
      });
      tasks.forEach(function (task) {
        var effectiveTask = effective(task);
        if (due(effectiveTask, event, extra)) work.push(runTask(task, extra, false, cancelOptions));
      });
      // A listener registered by a task belongs to the next lifecycle event, not the event
      // currently being dispatched. Snapshotting also matches the host event queue semantics.
      dynamicRows.forEach(function (record) {
        if (!dynamicDue(record, event, extra)) return;
        work.push(Promise.resolve(record.callback(Object.assign({}, extra, { signal: record.signal }))));
      });
      return await Promise.all(work);
    }
    async function executeNamed(name, extra, cancelOptions) {
      assertEnabled();
      var task = findTask(name);
      if (!task) throw new Error('任务不存在：' + String(name || ''));
      return await runTask(task, extra, true, cancelOptions);
    }
    async function commandSet(args, extra) {
      assertEnabled();
      args = Array.isArray(args) ? args.slice() : presetTaskTokenizeSlash(args);
      var optionArgs = args.filter(function (value) {
          return String(value).includes('=');
        }),
        nameArgs = args.filter(function (value) {
          return !String(value).includes('=');
        }),
        name = nameArgs.join(' '),
        task = findTask(name);
      if (!task && args.length) {
        name = String(args[0]);
        task = findTask(name);
        optionArgs = args.slice(1);
      }
      if (!task) throw new Error('任务不存在：' + String(name || ''));
      var patch = {};
      optionArgs.forEach(function (value) {
        var pair = String(value).split('=');
        if (pair.length < 2) return;
        var key = pair[0],
          val = pair.slice(1).join('=');
        if (key === 'status') patch.disabled = !['on', 'true', '1', '启用'].includes(val.toLowerCase());
        else if (key === 'interval') patch.interval = Math.max(0, Math.floor(number(val, 0)));
        else if (key === 'timing' || key === 'triggerTiming') {
          if (TIMINGS.indexOf(val) < 0) throw new Error('无效任务时机：' + val);
          patch.triggerTiming = val;
        } else if (key === 'floorType') {
          if (FLOOR_TYPES.indexOf(val) < 0) throw new Error('无效任务楼层类型：' + val);
          patch.floorType = val;
        }
      });
      return setOverride(task, patch);
    }
    function reset(name) {
      if (name) {
        var task = findTask(name),
          run = task && runs.get(task.id);
        if (run) run.controller.abort('任务已重置');
        if (task) removeDynamicForTask(task.id);
        return;
      }
      runs.forEach(function (run) {
        run.controller.abort('任务已重置');
      });
      dynamic.clear();
    }
    function setIdentity(kind, value) {
      var next = value == null ? null : String(value);
      if (kind !== 'preset' && identity[kind] === next) return getStatus();
      identity[kind] = next;
      if (kind === 'character') initializedCharacter = null;
      if (kind === 'preset' || kind === 'character' || kind === 'session') reset();
      if (kind === 'preset') {
        overrides.clear();
        refresh();
      }
      return getStatus();
    }
    function subscribe(name, callback) {
      if (!eventBus || typeof eventBus.on !== 'function') throw new Error('未配置 eventBus；请使用显式 hook API');
      eventBus.on(name, callback);
      return function () {
        if (typeof eventBus.off === 'function') eventBus.off(name, callback);
      };
    }
    function attach(bus) {
      if (attached) return api;
      eventBus = bus || eventBus;
      if (!eventBus || typeof eventBus.on !== 'function') throw new Error('eventBus 需要 on 方法');
      attached = true;
      return api;
    }
    function dispose() {
      disposed = true;
      reset();
      listeners.clear();
      dynamic.clear();
      if (eventBus && typeof eventBus.off === 'function')
        listeners.forEach(function (_, name) {
          eventBus.off(name);
        });
      attached = false;
    }
    function getStatus() {
      return {
        enabled: enabled(),
        taskCount: tasks.size,
        running: runs.size,
        floors: Object.assign({}, floors),
        identity: Object.assign({}, identity),
      };
    }
    var api = {
      refresh: refresh,
      readEmbeddedTasks: readEmbeddedTasks,
      list: list,
      find: find,
      getStatus: getStatus,
      run: function (name, extra) {
        return executeNamed(name, extra);
      },
      execute: function (name, extra) {
        return executeNamed(name, extra);
      },
      subscribe: subscribe,
      xbqte: executeNamed,
      xbset: commandSet,
      xbgenraw: xbgenraw,
      reset: reset,
      attach: attach,
      dispose: dispose,
      onEvent: dispatch,
      onUserMessage: function (extra, cancelOptions) {
        floors.all++;
        floors.user++;
        return dispatch('before_user', extra, cancelOptions);
      },
      onAfterAi: function (extra, cancelOptions) {
        assertCurrent(cancelOptions);
        assertCurrent(extra);
        floors.all++;
        floors.llm++;
        return dispatch('after_ai', extra, cancelOptions);
      },
      onGenerationEnded: function (extra, cancelOptions) {
        return api.onAfterAi(extra, cancelOptions);
      },
      onGenerationStopped: function () {
        reset();
      },
      onPresetChanged: function (value) {
        return setIdentity('preset', value);
      },
      onCharacterChanged: function (value) {
        return setIdentity('character', value);
      },
      onCharacterInitialized: function (extra, cancelOptions) {
        assertCurrent(cancelOptions);
        var character = String((extra && extra.characterId) || ''),
          session = String((extra && extra.sessionId) || '');
        if (
          !enabled() ||
          !character ||
          !session ||
          initializedCharacter === character ||
          identity.character !== character ||
          identity.session !== session
        )
          return Promise.resolve([]);
        initializedCharacter = character;
        return dispatch('character_init', extra, cancelOptions);
      },
      onSessionChanged: function (value) {
        return setIdentity('session', value);
      },
      onChatCreated: function (extra, cancelOptions) {
        return dispatch('initialization', extra, cancelOptions);
      },
      onPluginInitialized: function (extra, cancelOptions) {
        return dispatch('plugin_init', extra, cancelOptions);
      },
      onChatChanged: function (extra, cancelOptions) {
        return dispatch('chat_changed', extra, cancelOptions);
      },
      onGenerationStart: function () {
        return getStatus();
      },
      XBTasks: null,
    };
    function facadeFind(name) {
      var rows = list(),
        index = rows.findIndex(function (task) {
          return task.id === String(name || '') || task.name === String(name || '');
        });
      return index < 0 ? null : { task: rows[index], scope: 'preset', type: 'preset', list: rows, index: index };
    }
    api.XBTasks = {
      list: list,
      dump: list,
      find: facadeFind,
      exec: executeNamed,
      setCommands: function (name, commands) {
        var task = findTask(name);
        if (!task) throw new Error('任务不存在：' + name);
        return setOverride(task, { commands: Array.isArray(commands) ? commands.slice() : [String(commands || '')] });
      },
      setJS: function (name, code) {
        var task = findTask(name);
        if (!task) throw new Error('任务不存在：' + name);
        return setOverride(task, { commands: ['<<taskjs>>' + String(code || '') + '<</taskjs>>'] });
      },
      setProps: function (name, props) {
        var task = findTask(name);
        if (!task) throw new Error('任务不存在：' + name);
        return setOverride(task, object(props) || {});
      },
    };
    if (options.exposeGlobals !== false && host && typeof host === 'object') {
      host.XBTasks = api.XBTasks;
      host.xbqte = api.xbqte;
      host.xbset = api.xbset;
      host.xbgenraw = function (command) {
        return api.xbgenraw(command, null, {});
      };
    }
    refresh();
    return api;
  }

  return {
    TASK_OWNER_ID: TASK_OWNER_ID,
    TIMINGS: TIMINGS.slice(),
    FLOOR_TYPES: FLOOR_TYPES.slice(),
    readEmbeddedTasks: readEmbeddedTasks,
    normalizeTask: normalizeTask,
    create: createRuntime,
  };
});

var presetTaskRuntime = null,
  presetTaskRawSessions = new Map(),
  presetTaskExternalListeners = new Map();
function presetTaskAbortRawSessions(reason) {
  presetTaskRawSessions.forEach(function (state, key) {
    if (state && state.isStreaming && state.controller) state.controller.abort(reason || '任务生命周期已结束');
    presetTaskRawSessions.delete(key);
  });
}
function presetTaskExternalOn(name, callback) {
  var key = String(name || ''),
    bucket = presetTaskExternalListeners.get(key);
  if (!bucket) {
    bucket = new Set();
    presetTaskExternalListeners.set(key, bucket);
  }
  if (typeof callback === 'function') bucket.add(callback);
  return callback;
}
function presetTaskExternalOff(name, callback) {
  var key = String(name || ''),
    bucket = presetTaskExternalListeners.get(key);
  if (!bucket) return;
  if (callback) bucket.delete(callback);
  else bucket.clear();
  if (!bucket.size) presetTaskExternalListeners.delete(key);
}
async function presetTaskExternalEmit(name, payload, options) {
  var bucket = presetTaskExternalListeners.get(String(name || ''));
  if (!bucket) return [];
  return await Promise.all(
    Array.from(bucket).map(function (callback) {
      if (!presetTaskOptionsCurrent(options)) return null;
      return Promise.resolve(callback(payload, options));
    })
  );
}
function presetTaskSaveSettings() {
  return typeof saveData === 'function' ? saveData('meta') : Promise.resolve();
}
function presetTaskToast(kind, message) {
  if (typeof toast === 'function')
    toast(String(message || ''), kind === 'error' ? 'err' : kind === 'success' ? 'ok' : 'info');
}
function presetTaskSillyTavernContext() {
  var settings = (typeof D !== 'undefined' && D && D.settings) || {},
    extensions = settings.tavernHelperExtensionSettings || (settings.tavernHelperExtensionSettings = {});
  return {
    extensionSettings: extensions,
    saveSettings: presetTaskSaveSettings,
    saveSettingsDebounced: presetTaskSaveSettings,
    getPresetManager: function () {
      return {
        getSelectedPresetName: function () {
          return String(settings.activeChatCompletionPresetName || YEYU_DEFAULT_PRESET_NAME || '');
        },
      };
    },
  };
}
function presetTaskScriptModule() {
  var char = typeof getChar === 'function' ? getChar() : null,
    sess = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  return {
    saveSettingsDebounced: presetTaskSaveSettings,
    getRequestHeaders: function () {
      return {};
    },
    substituteParams: function (value) {
      return cardFrontendSubstitudeMacros(char, sess, String(value || ''));
    },
    eventSource: {
      on: presetTaskExternalOn,
      off: presetTaskExternalOff,
      removeListener: presetTaskExternalOff,
      emit: function (name) {
        return presetTaskExternalEmit(name, Array.prototype.slice.call(arguments, 1));
      },
    },
    event_types: { MESSAGE_RECEIVED: 'after_ai', MESSAGE_SENT: 'before_user', CHAT_CHANGED: 'chat_changed' },
    getCurrentChatId: function () {
      return String((sess && sess.id) || '');
    },
    saveMetadata: function () {
      return typeof saveData === 'function' ? saveData('sessions') : Promise.resolve();
    },
    chat_metadata: (sess && sess.tavernHelperMetadata) || (sess ? (sess.tavernHelperMetadata = {}) : {}),
  };
}
function presetTaskDecode64(value) {
  try {
    var text = String(value || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    text += '='.repeat((4 - (text.length % 4)) % 4);
    var bytes = Uint8Array.from(atob(text), function (char) {
      return char.charCodeAt(0);
    });
    return new TextDecoder().decode(bytes);
  } catch (_) {
    return '';
  }
}
function presetTaskCompositeMessages(value) {
  value = String(value || '').trim();
  if (!value) return [];
  try {
    var parsed = JSON.parse(value);
    if (Array.isArray(parsed))
      return parsed
        .map(function (row) {
          var role = String((row && row.role) || '').toLowerCase();
          if (role === 'sys') role = 'system';
          if (role === 'asst' || role === 'ai') role = 'assistant';
          if (role === 'u') role = 'user';
          return { role: role, content: String((row && row.content) || '') };
        })
        .filter(function (row) {
          return ['system', 'user', 'assistant'].includes(row.role);
        });
  } catch (_) {}
  var parts = [],
    buffer = '',
    depth = 0;
  for (var i = 0; i < value.length; i++) {
    var char = value.charAt(i);
    if (char === '{') depth++;
    if (char === '}') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) {
      parts.push(buffer);
      buffer = '';
    } else buffer += char;
  }
  if (buffer) parts.push(buffer);
  return parts
    .map(function (part) {
      var at = part.indexOf('=');
      if (at < 0) return null;
      var role = part.slice(0, at).trim().toLowerCase(),
        content = part.slice(at + 1).trim();
      if (role === 'sys') role = 'system';
      if (role === 'asst' || role === 'ai') role = 'assistant';
      if (role === 'u') role = 'user';
      if (!['system', 'user', 'assistant'].includes(role)) return null;
      if (
        (content.charAt(0) === '{' && content.slice(-1) === '}') ||
        (['"', "'"].includes(content.charAt(0)) && content.slice(-1) === content.charAt(0))
      )
        content = content.slice(1, -1);
      return { role: role, content: content.trim() };
    })
    .filter(Boolean);
}
function presetTaskRawCommand(value) {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return { args: Object.assign({}, value), prompt: String(value.prompt || '') };
  var source = String(value || '')
      .trim()
      .replace(/^\/xbgenraw\s*/i, ''),
    tokens = presetTaskTokenizeSlash(source),
    args = {},
    prompt = [];
  tokens.forEach(function (token) {
    token = String(token);
    var at = token.indexOf('=');
    if (at > 0) args[token.slice(0, at)] = token.slice(at + 1);
    else prompt.push(token);
  });
  return { args: args, prompt: prompt.join(' ') };
}
function presetTaskRawTarget() {
  var char = typeof getChar === 'function' ? getChar() : null,
    sess = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  return { charId: (char && char.id) || '', sessionId: (sess && sess.id) || '', mode: 'quiet' };
}
async function presetTaskGenerateRaw(commandOrConfig, context) {
  var activeChar = typeof getChar === 'function' ? getChar() : null;
  if (activeChar && typeof isRisuCharacter === 'function' && isRisuCharacter(activeChar))
    throw new Error('Risu 卡片不运行 ST 预设任务');
  var parsed = presetTaskRawCommand(commandOrConfig),
    args = parsed.args || {},
    sessionId = String(args.id || 'xbraw_' + Date.now()),
    top = args.top64 ? presetTaskDecode64(args.top64) : String(args.top || ''),
    bottom = args.bottom64 ? presetTaskDecode64(args.bottom64) : String(args.bottom || ''),
    messages = presetTaskCompositeMessages(top),
    role = ['system', 'user', 'assistant'].includes(String(args.as || '')) ? String(args.as) : 'user';
  if (parsed.prompt.trim()) messages.push({ role: role, content: parsed.prompt.trim() });
  messages.push.apply(messages, presetTaskCompositeMessages(bottom));
  if (!messages.length && top.trim()) messages.push({ role: 'user', content: top.trim() });
  if (!messages.length) throw new Error('xbgenraw 没有可生成的提示词');
  var live = resolveApiRoute('chat'),
    route = Object.assign({}, live);
  if (route.protocol === 'grok-subscription' && (args.apiurl || args.apipassword)) route.protocol = 'openai';
  if (args.apiurl) overrideApiRouteUrl(route, args.apiurl);
  if (args.apipassword) route.apiKey = String(args.apipassword);
  if (args.model) route.model = String(args.model);
  var controller = new AbortController(),
    parentSignal = context && context.signal,
    abortFromParent = function () {
      controller.abort((parentSignal && parentSignal.reason) || '任务已停止');
    };
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  var target = presetTaskRawTarget(),
    state = {
      id: sessionId,
      isStreaming: true,
      text: '',
      error: '',
      controller: controller,
      owner: {
        preset: String(
          (D && D.settings && D.settings.activeChatCompletionPresetName) || YEYU_DEFAULT_PRESET_NAME || ''
        ),
        character: String(target.charId || ''),
        session: String(target.sessionId || ''),
      },
    };
  presetTaskRawSessions.set(sessionId, state);
  var request = callDeepSeek(messages, target, {
    transient: true,
    route: 'chat',
    routeOverride: route,
    allowEmptyApiKey: !!args.apiurl,
    controller: controller,
    nonStream: String(args.nonstream || '').toLowerCase() === 'true',
    onProgress: function (progress) {
      if (!controller.signal.aborted) state.text = String((progress && progress.content) || state.text);
    },
  })
    .then(
      function (result) {
        if (controller.signal.aborted) throw presetTaskAbortError(controller.signal.reason);
        state.text = String((result && result.content) || '');
        state.isStreaming = false;
        try {
          window.postMessage(
            { type: 'xiaobaix_streaming_completed', payload: { sessionId: sessionId, finalText: state.text } },
            '*'
          );
        } catch (_) {}
        return state.text;
      },
      function (error) {
        state.error = String((error && error.message) || error);
        state.isStreaming = false;
        throw error;
      }
    )
    .finally(function () {
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
    });
  state.promise = request;
  if (String(args.nonstream || '').toLowerCase() === 'true') return await request;
  request.catch(function () {});
  return sessionId;
}
var xiaobaixStreamingGeneration = {
  getStatus: function (id) {
    var state = presetTaskRawSessions.get(String(id || ''));
    return state ? { isStreaming: state.isStreaming, text: state.text, error: state.error } : null;
  },
  getLastGeneration: function (id) {
    var state = presetTaskRawSessions.get(String(id || ''));
    return state ? state.text : '';
  },
  stop: function (id) {
    var state = presetTaskRawSessions.get(String((id && id.sessionId) || (id && id.id) || id || ''));
    if (!state) return false;
    state.controller.abort();
    return true;
  },
  cancel: function (id) {
    return this.stop(id);
  },
  abort: function (id) {
    return this.stop(id);
  },
  interrupt: function (id) {
    return this.stop(id);
  },
  xbgenrawCommand: function (args, prompt) {
    return presetTaskGenerateRaw(Object.assign({}, args || {}, { prompt: String(prompt || '') }), {});
  },
};
function initPresetTaskRuntime() {
  if (presetTaskRuntime) return presetTaskRuntime;
  if (!window.YeyuPresetTaskRuntime) return null;
  presetTaskRuntime = window.YeyuPresetTaskRuntime.create({
    host: window,
    getActiveRawPreset: function () {
      return typeof activeCompletionPresetRaw === 'function' ? activeCompletionPresetRaw() : null;
    },
    settings: function () {
      return (D && D.settings) || {};
    },
    isExecutionAllowed: function () {
      var char = typeof getChar === 'function' ? getChar() : null;
      return !(char && typeof isRisuCharacter === 'function' && isRisuCharacter(char));
    },
    executeStscript: typeof executeStscript === 'function' ? executeStscript : null,
    xbgenraw: presetTaskGenerateRaw,
  });
  window.SillyTavern = window.SillyTavern || {};
  window.SillyTavern.getContext = presetTaskSillyTavernContext;
  window.toastr = window.toastr || {
    error: function (message) {
      presetTaskToast('error', message);
    },
    success: function (message) {
      presetTaskToast('success', message);
    },
    warning: function (message) {
      presetTaskToast('warning', message);
    },
    info: function (message) {
      presetTaskToast('info', message);
    },
  };
  window.xiaobaixStreamingGeneration = xiaobaixStreamingGeneration;
  var char = typeof getChar === 'function' ? getChar() : null,
    sess = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  presetTaskRuntime.onCharacterChanged((char && char.id) || '');
  presetTaskRuntime.onSessionChanged((sess && sess.id) || '');
  presetTaskRuntime.onPluginInitialized({ scriptModule: presetTaskScriptModule() });
  presetTaskCall('onCharacterInitialized', {
    characterId: (char && char.id) || '',
    sessionId: (sess && sess.id) || '',
  });
  return presetTaskRuntime;
}
function presetTaskAbortError(reason) {
  var error = new Error(String(reason || '任务已停止'));
  error.name = 'AbortError';
  return error;
}
function presetTaskOptionsCurrent(options) {
  return !options || (!(options.signal && options.signal.aborted) && (!options.current || options.current()));
}
function presetTaskCall(method, value, options) {
  if (!presetTaskOptionsCurrent(options)) return Promise.resolve(null);
  var runtime = presetTaskRuntime || initPresetTaskRuntime();
  if (!runtime || typeof runtime[method] !== 'function') return Promise.resolve(null);
  if (['onGenerationStopped', 'onPresetChanged', 'onCharacterChanged', 'onSessionChanged'].includes(method)) {
    var identityKind = { onCharacterChanged: 'character', onSessionChanged: 'session' }[method];
    if (identityKind && runtime.getStatus().identity[identityKind] === String(value == null ? '' : value))
      return Promise.resolve(runtime.getStatus());
    presetTaskExternalListeners.clear();
    presetTaskAbortRawSessions(String(method));
  }
  var eventName = { onAfterAi: 'after_ai', onUserMessage: 'before_user', onChatChanged: 'chat_changed' }[method],
    // The cancel options travel as their own argument and carry only the caller's stop controls and
    // the post-commit run they belong to: merging them into the payload used to publish the whole
    // options object into the task JS scope and into every listener's event payload.
    cancelOptions = options
      ? { signal: options.signal, current: options.current, postCommitRun: options.postCommitRun || null }
      : null;
  if (method === 'onCharacterInitialized') {
    var characterId = String((value && value.characterId) || ''),
      sessionId = String((value && value.sessionId) || ''),
      char = typeof getChar === 'function' ? getChar() : null,
      sess = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
      parentCurrent = options && options.current;
    if (!char || !sess || String(char.id) !== characterId || String(sess.id) !== sessionId)
      return Promise.resolve(null);
    cancelOptions = Object.assign({}, cancelOptions, {
      current: function () {
        return (!parentCurrent || parentCurrent()) && getChar() === char && getActiveSession(char.id) === sess;
      },
    });
    value = Object.assign({}, value, { scriptModule: presetTaskScriptModule() });
  }
  try {
    return Promise.resolve(runtime[method](value, cancelOptions))
      .then(function (result) {
        return eventName && presetTaskOptionsCurrent(options)
          ? presetTaskExternalEmit(eventName, value, cancelOptions).then(function () {
              return result;
            })
          : result;
      })
      .catch(function (error) {
        if (!presetTaskOptionsCurrent(options) || (error && error.name === 'AbortError')) return null;
        if (typeof toast === 'function') toast('预设任务执行失败：' + String((error && error.message) || error), 'err');
        return null;
      });
  } catch (error) {
    if (typeof toast === 'function') toast('预设任务执行失败：' + String((error && error.message) || error), 'err');
    return Promise.resolve(null);
  }
}
function disposePresetTaskRuntime() {
  if (presetTaskRuntime) presetTaskRuntime.dispose();
  presetTaskRuntime = null;
  presetTaskExternalListeners.clear();
  presetTaskAbortRawSessions('任务运行时已关闭');
}
if (typeof window !== 'undefined' && window.addEventListener)
  window.addEventListener('pagehide', disposePresetTaskRuntime);
