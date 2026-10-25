// ===== Terminable ST regex workers =====
var _scriptWorkers = Object.create(null),
  _scriptWorkerCallSeq = 0;
// A single timeout or Worker error is a single call's problem, so it only fails that call. But when
// nothing gets through at all — the environment cannot run a Worker, or one runaway pattern hits
// every queued message — reassigning the rest one by one would spend a full RPC budget per call, and
// a whole cold render or a send waiting behind the queue would stall for minutes. The handle counts
// consecutive faults with no answer in between; the second one fails the entire queue, which caps an
// environment-level fault at about two budgets. This is a strike count, not a time limit, so it does
// is separate from the computation watchdog.
var SCRIPT_WORKER_ENV_FAILURE_LIMIT = 2,
  SCRIPT_WORKER_COMPUTE_TIMEOUT_MS = 15000;
function scriptWorkerAbortError() {
  var error = new Error('脚本已被停止');
  error.name = 'AbortError';
  return error;
}
function buildRegex(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    var failure = new Error(String((error && error.message) || error));
    failure.cardScriptCode = 'regex';
    throw failure;
  }
}
function regexMatches(source, regex) {
  if (regex.global) return source.matchAll(regex);
  var match = regex.exec(source);
  return match ? [match] : [];
}
// SillyTavern@7e8663cd public/scripts/extensions/regex/engine.js runRegexScript.
// engine.js evaluates a replacement in three ordered steps per match: {{match}} becomes $0,
// then $0/$N/$<name> are substituted with macro-expanded trimStrings applied to each group,
// and only then is substituteParams called on the result. Both trim and replacement macros need
// main-thread state, so the worker returns ordered raw matches while keeping every RegExp match
// inside the terminable worker.
function runStandardReplaceParts(input, pattern, flags, replaceString) {
  var source = String(input),
    regex = buildRegex(pattern, flags),
    parts = [],
    last = 0;
  for (var match of regexMatches(source, regex)) {
    if (match.index > last) parts.push({ literal: source.slice(last, match.index) });
    parts.push({
      replacement: String(replaceString),
      match: Array.prototype.slice.call(match),
      groups: match.groups ? Object.assign({}, match.groups) : null,
    });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ literal: source.slice(last) });
  return parts;
}
// The regex worker is composed from the same function sources the main thread can call
// directly, so a test that exercises regexScriptRunStandardReplace is exercising the exact
// text that runs inside the Worker.
function regexWorkerDispatch() {
  function post(message) {
    self.postMessage(message);
  }
  self.onmessage = function (event) {
    var message = event.data || {};
    try {
      if (message.type === 'ping') post({ type: 'done', callId: message.callId, value: true });
      else if (message.type === 'standardRegexParts')
        post({
          type: 'done',
          callId: message.callId,
          value: runStandardReplaceParts(message.input, message.pattern, message.flags, message.replaceString),
        });
      else if (message.type === 'regexTest')
        post({
          type: 'done',
          callId: message.callId,
          value: buildRegex(message.pattern, message.flags).test(message.input),
        });
      else post({ type: 'failed', callId: message.callId, error: 'unsupported regex op: ' + message.type });
    } catch (error) {
      post({
        type: 'failed',
        callId: message.callId,
        error: String((error && error.message) || error),
        errorCode: error && error.cardScriptCode === 'regex' ? 'regex' : 'worker',
      });
    }
  };
}
function regexWorkerSource() {
  return (
    [buildRegex, regexMatches, runStandardReplaceParts]
      .map(function (fn) {
        return fn.toString();
      })
      .join('\n') +
    '\n(' +
    regexWorkerDispatch.toString() +
    ')();'
  );
}
function scriptWorkerHandle(name) {
  if (!_scriptWorkers[name]) {
    _scriptWorkers[name] = {
      name: name,
      worker: null,
      url: '',
      ready: null,
      pending: new Map(),
      order: [],
      generation: 0,
      // Kept on the handle, not on the Worker instance, so the count survives "terminate the old
      // Worker, reassign to a new one" — the very path it has to measure.
      envFailures: 0,
    };
  }
  return _scriptWorkers[name];
}
function scriptWorkerBlobUrl() {
  return URL.createObjectURL(new Blob([regexWorkerSource()], { type: 'text/javascript' }));
}
function startScriptWorker(handle) {
  if (handle.ready) return handle.ready;
  var generation = handle.generation,
    prepare = Promise.resolve(),
    ready;
  ready = prepare
    .then(function () {
      if (handle.generation !== generation) throw new Error('脚本已被停止');
      return new Promise(function (resolve, reject) {
        var url, worker;
        try {
          url = scriptWorkerBlobUrl();
          worker = new Worker(url);
        } catch (error) {
          if (url) URL.revokeObjectURL(url);
          var startupFailure = new Error('脚本运行环境无法启动：' + String((error && error.message) || error));
          startupFailure.cardScriptCode = 'worker';
          reject(startupFailure);
          return;
        }
        handle.worker = worker;
        handle.url = url;
        worker.onerror = function (event) {
          if (handle.generation !== generation) return;
          var workerFailure = new Error('脚本运行环境出错：' + String((event && event.message) || 'unknown'));
          workerFailure.cardScriptCode = 'worker';
          invalidateScriptWorkerHandle(handle, workerFailure);
        };
        worker.onmessage = function (event) {
          function channelFailure(message) {
            var failure = new Error(message);
            failure.cardScriptCode = 'worker';
            return failure;
          }
          // A terminated Worker has no say over its replacement.
          if (handle.generation !== generation) return;
          var message = event && event.data;
          if (!message || typeof message !== 'object') {
            invalidateScriptWorkerHandle(handle, channelFailure('脚本运行环境返回了无效消息'));
            return;
          }
          if (typeof message.callId !== 'string' || !message.callId) {
            invalidateScriptWorkerHandle(handle, channelFailure('脚本运行环境返回了无关联消息'));
            return;
          }
          var pending = handle.pending.get(message.callId);
          if (!pending) {
            invalidateScriptWorkerHandle(handle, channelFailure('脚本运行环境返回了未知调用结果'));
            return;
          }
          // An answer for a live call — a result or a reported script error — proves the environment
          // still runs and reports, so the consecutive-fault count starts over.
          handle.envFailures = 0;
          if (message.type === 'failed') {
            var failure = new Error(message.error || '脚本执行失败');
            failure.cardScriptCode = message.errorCode === 'regex' ? 'regex' : 'worker';
            failure.partial = message.value;
            settleScriptWorkerCall(handle, pending, false, failure);
          } else if (message.type === 'done' && Object.prototype.hasOwnProperty.call(message, 'value')) {
            settleScriptWorkerCall(handle, pending, true, message.value);
          } else invalidateScriptWorkerHandle(handle, channelFailure('脚本运行环境返回了无效调用结果'));
        };
        resolve(true);
      });
    })
    .catch(function (error) {
      if (handle.generation === generation && handle.ready === ready) handle.ready = null;
      if (error && error.cardScriptCode !== 'regex') error.cardScriptCode = 'worker';
      throw error;
    });
  handle.ready = ready;
  return handle.ready;
}
// Calls stay pipelined, because a cold 200 message render must not wait a host round trip per
// regex. A Worker answers strictly in the order it received, so the head of the dispatch order is
// the call it is actually running, and only that call carries the timeout: queueing alone can no
// longer spend a call's budget. Every other call outlives the Worker and is handed to its
// replacement, so one failure rejects exactly one call — until SCRIPT_WORKER_ENV_FAILURE_LIMIT
// consecutive faults show the environment itself is gone and the whole queue goes with it.
function settleScriptWorkerCall(handle, call, ok, value) {
  if (call.settled) return;
  call.settled = true;
  clearTimeout(call.timer);
  call.timer = 0;
  if (call.signal && call.onAbort) call.signal.removeEventListener('abort', call.onAbort);
  if (call.callId) {
    handle.pending.delete(call.callId);
    var at = handle.order.indexOf(call.callId);
    if (at >= 0) handle.order.splice(at, 1);
    call.callId = '';
  }
  if (ok) call.resolve(value);
  else call.reject(value);
  startScriptWorkerCallTimer(handle);
}
function startScriptWorkerCallTimer(handle) {
  var call = handle.order.length ? handle.pending.get(handle.order[0]) : null;
  if (!call || call.timer) return;
  var timeoutMs = SCRIPT_WORKER_COMPUTE_TIMEOUT_MS;
  call.timer = setTimeout(function () {
    var error = new Error('正则脚本运行超时（' + timeoutMs / 1000 + ' 秒）');
    error.cardScriptCode = 'worker';
    invalidateScriptWorkerHandle(handle, error, call);
  }, timeoutMs);
}
function postScriptWorkerCall(handle, call) {
  var callId = 'c' + ++_scriptWorkerCallSeq;
  call.callId = callId;
  handle.pending.set(callId, call);
  handle.order.push(callId);
  startScriptWorkerCallTimer(handle);
  try {
    handle.worker.postMessage(Object.assign({ callId: callId }, call.message));
  } catch (error) {
    var failure = error instanceof Error ? error : new Error(String(error || '脚本运行环境出错'));
    failure.cardScriptCode = 'worker';
    invalidateScriptWorkerHandle(handle, failure, call);
  }
}
function sendScriptWorkerCall(handle, call) {
  var generation = handle.generation;
  startScriptWorker(handle).then(
    function () {
      if (call.settled) return;
      if (handle.generation !== generation) {
        sendScriptWorkerCall(handle, call);
        return;
      }
      postScriptWorkerCall(handle, call);
    },
    function (error) {
      settleScriptWorkerCall(handle, call, false, error);
    }
  );
}
function callScriptWorker(handle, message, options) {
  var signal = options && options.signal;
  if (signal && signal.aborted) return Promise.reject(scriptWorkerAbortError());
  return new Promise(function (resolve, reject) {
    var call = {
      message: message,
      signal: signal,
      resolve: resolve,
      reject: reject,
      callId: '',
      timer: 0,
      settled: false,
      onAbort: null,
    };
    call.onAbort = function () {
      if (call.settled) return;
      // A dispatched call may already be running, so the Worker has to go; its neighbours continue
      // on the replacement. A call that never reached the Worker just drops itself.
      if (call.callId) invalidateScriptWorkerHandle(handle, scriptWorkerAbortError(), call);
      else settleScriptWorkerCall(handle, call, false, scriptWorkerAbortError());
    };
    if (signal) signal.addEventListener('abort', call.onAbort, { once: true });
    sendScriptWorkerCall(handle, call);
  });
}
// `blame` is the one call that fails with the Worker; `true` fails every call instead.
function invalidateScriptWorkerHandle(handle, error, blame) {
  var reason = error instanceof Error ? error : new Error(String(error || '脚本运行环境出错'));
  if (reason.cardScriptCode !== 'regex') reason.cardScriptCode = 'worker';
  // A stop already takes the whole queue, and an abort is the caller's own doing, so neither counts
  // as an environment fault. Whenever the queue dies here the count goes with it, whether the limit
  // spent it or a stop emptied the queue: the next call starts a fresh Worker with the full
  // allowance, so neither a one-off outage nor a stop can leave later batches one strike short.
  var failEveryCall = blame === true;
  if (failEveryCall) handle.envFailures = 0;
  else if (reason.name !== 'AbortError' && ++handle.envFailures >= SCRIPT_WORKER_ENV_FAILURE_LIMIT) {
    handle.envFailures = 0;
    failEveryCall = true;
  }
  var carried = [];
  handle.order.forEach(function (callId) {
    var call = handle.pending.get(callId);
    if (call) carried.push(call);
  });
  handle.pending.clear();
  handle.order = [];
  var blamed = blame === true ? null : carried.indexOf(blame) >= 0 ? blame : carried[0] || null;
  carried.forEach(function (call) {
    clearTimeout(call.timer);
    call.timer = 0;
    call.callId = '';
  });
  if (handle.worker) {
    try {
      handle.worker.terminate();
    } catch (_) {}
  }
  if (handle.url) {
    try {
      URL.revokeObjectURL(handle.url);
    } catch (_) {}
  }
  handle.worker = null;
  handle.url = '';
  handle.ready = null;
  handle.generation++;
  carried.forEach(function (call) {
    if (failEveryCall || call === blamed) settleScriptWorkerCall(handle, call, false, reason);
    else sendScriptWorkerCall(handle, call);
  });
  return true;
}
function terminateScriptWorker(name) {
  var handle = _scriptWorkers[name];
  if (!handle || (!handle.worker && !handle.ready && !handle.pending.size)) return false;
  return invalidateScriptWorkerHandle(handle, new Error('脚本已被停止'), true);
}
function liveScriptWorkerNames() {
  return Object.keys(_scriptWorkers).filter(function (name) {
    return !!_scriptWorkers[name].worker;
  });
}
