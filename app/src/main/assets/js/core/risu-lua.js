(function (root) {
  'use strict';

  var scriptUrl =
    typeof document !== 'undefined' && document.currentScript ? String(document.currentScript.src || '') : '';
  var defaultAssetRoot = scriptUrl ? scriptUrl.replace(/core\/risu-lua\.js(?:\?.*)?$/, '') : 'js/';
  var assetPromise = null;
  var sequence = 0;

  function LuaRuntimeError(code, message, details) {
    this.name =
      code === 'RISU_LUA_ABORTED' ? 'AbortError' : code === 'RISU_LUA_TIMEOUT' ? 'TimeoutError' : 'LuaRuntimeError';
    this.code = code;
    this.message = String(message || 'Lua 运行失败');
    this.details = details || null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, LuaRuntimeError);
  }
  LuaRuntimeError.prototype = Object.create(Error.prototype);
  LuaRuntimeError.prototype.constructor = LuaRuntimeError;

  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.onload = function () {
        ready() ? resolve() : reject(new LuaRuntimeError('RISU_LUA_ASSET', 'Lua 资源未导出预期接口'));
      };
      script.onerror = function () {
        reject(new LuaRuntimeError('RISU_LUA_ASSET', 'Lua 资源加载失败'));
      };
      document.head.appendChild(script);
    });
  }

  function ensureAssets(assetRoot) {
    if (assetPromise) return assetPromise;
    if (typeof document === 'undefined')
      return Promise.reject(new LuaRuntimeError('RISU_LUA_ENV', 'Lua 控制器需要浏览器 Worker 环境'));
    var base = String(assetRoot || defaultAssetRoot);
    if (base && !/[\\\/]$/.test(base)) base += '/';
    assetPromise = loadScript(base + 'core/risu-lua-worker.js', function () {
      return typeof root.YeyuRisuLuaWorkerMain === 'function';
    })
      .then(function () {
        return loadScript(base + 'vendor/wasmoon-1.16.0.js', function () {
          return typeof root.__yeyuWasmoonModule === 'function';
        });
      })
      .then(function () {
        return loadScript(base + 'vendor/wasmoon-1.16.0-glue.js', function () {
          return typeof root.__yeyuWasmoonGlueBase64 === 'string';
        });
      })
      .catch(function (error) {
        assetPromise = null;
        throw error;
      });
    return assetPromise;
  }

  function sameScope(left, right) {
    if (!left || !right) return false;
    return (
      String(left.roleId) === String(right.roleId) &&
      String(left.sessionId) === String(right.sessionId) &&
      String(left.scriptId || '') === String(right.scriptId || '')
    );
  }

  function checkedScope(value) {
    if (!value || value.roleId == null || value.sessionId == null)
      throw new LuaRuntimeError('RISU_LUA_SCOPE', 'Lua 运行必须绑定角色与会话');
    var scope = {
      roleId: String(value.roleId),
      sessionId: String(value.sessionId),
      scriptId: String(value.scriptId || ''),
    };
    if (!scope.roleId || !scope.sessionId) throw new LuaRuntimeError('RISU_LUA_SCOPE', 'Lua 角色与会话标识不能为空');
    return scope;
  }

  function randomAccessKey() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map
      .call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      })
      .join('');
  }

  function workerSource(cbsInstaller) {
    var cbs = typeof cbsInstaller === 'function' ? '(' + cbsInstaller.toString() + ')(self);\n' : '';
    return (
      '(' +
      root.__yeyuWasmoonModule.toString() +
      ').call(self);\n' +
      cbs +
      '(' +
      root.YeyuRisuLuaWorkerMain.toString() +
      ')();'
    );
  }

  function RisuLuaRuntime(options) {
    options = options || {};
    this.assetRoot = options.assetRoot || defaultAssetRoot;
    this.cbsInstaller = typeof options.cbsInstaller === 'function' ? options.cbsInstaller : root.YeyuRisuCBSInstaller;
    this.rpc =
      typeof options.rpc === 'function'
        ? options.rpc
        : function (call) {
            return Promise.reject(
              new LuaRuntimeError('RISU_LUA_RPC_UNAVAILABLE', 'Lua 宿主接口不可用：' + call.method)
            );
          };
    this.defaultTimeoutMs = Number.isFinite(options.defaultTimeoutMs)
      ? Math.max(1, Number(options.defaultTimeoutMs))
      : 8000;
    this.worker = null;
    this.workerUrl = '';
    this.ready = null;
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.disposed = false;
    this.generation = 0;
  }

  RisuLuaRuntime.prototype._invalidate = function (failure) {
    var error =
      failure instanceof Error
        ? failure
        : new LuaRuntimeError('RISU_LUA_WORKER', String(failure || 'Lua Worker 已终止'));
    this.generation++;
    if (this.worker)
      try {
        this.worker.terminate();
      } catch (_) {}
    if (this.workerUrl)
      try {
        URL.revokeObjectURL(this.workerUrl);
      } catch (_) {}
    this.worker = null;
    this.workerUrl = '';
    this.ready = null;
    this.pending.forEach(function (entry) {
      if (entry.cleanup) entry.cleanup();
      entry.reject(error);
    });
    this.pending.clear();
  };

  RisuLuaRuntime.prototype._start = function () {
    var runtime = this,
      generation = runtime.generation,
      startId,
      ready;
    if (runtime.disposed) return Promise.reject(new LuaRuntimeError('RISU_LUA_DISPOSED', 'Lua 运行时已释放'));
    if (runtime.ready) return runtime.ready;
    startId = 's' + ++sequence;
    ready = new Promise(function (resolve, reject) {
      runtime.pending.set(startId, { type: 'start', scope: null, resolve: resolve, reject: reject });
      ensureAssets(runtime.assetRoot).then(
        function () {
          if (
            runtime.disposed ||
            runtime.generation !== generation ||
            !runtime.pending.has(startId) ||
            runtime.ready !== ready
          )
            return;
          runtime.pending.delete(startId);
          var url = '',
            worker;
          try {
            url = URL.createObjectURL(new Blob([workerSource(runtime.cbsInstaller)], { type: 'text/javascript' }));
            worker = new Worker(url);
          } catch (error) {
            if (url)
              try {
                URL.revokeObjectURL(url);
              } catch (_) {}
            runtime.pending.set(startId, { type: 'start', scope: null, resolve: resolve, reject: reject });
            runtime._invalidate(error);
            return;
          }
          runtime.worker = worker;
          runtime.workerUrl = url;
          var initId = 'i' + ++sequence;
          worker.onmessage = function (event) {
            runtime._message(event.data || {}, generation);
          };
          worker.onerror = function () {
            if (runtime.generation === generation && runtime.worker === worker)
              runtime._invalidate(new LuaRuntimeError('RISU_LUA_WORKER', 'Lua Worker 运行失败'));
          };
          runtime.pending.set(initId, { type: 'init', scope: null, resolve: resolve, reject: reject });
          try {
            worker.postMessage({ type: 'init', id: initId, glueBase64: root.__yeyuWasmoonGlueBase64 });
          } catch (error) {
            runtime._invalidate(error);
          }
        },
        function (error) {
          if (runtime.generation === generation && runtime.pending.has(startId) && runtime.ready === ready)
            runtime._invalidate(error);
        }
      );
    });
    runtime.ready = ready;
    return ready;
  };

  RisuLuaRuntime.prototype._message = function (message, generation) {
    var runtime = this;
    if (generation !== runtime.generation) return;
    if (message.type === 'rpc') {
      var run = runtime.pending.get(message.runId);
      if (
        !run ||
        run.type !== 'run' ||
        !sameScope(message.scope, run.scope) ||
        typeof message.method !== 'string' ||
        !Array.isArray(message.args)
      ) {
        runtime._invalidate(new LuaRuntimeError('RISU_LUA_CHANNEL', 'Lua RPC 身份或消息格式无效'));
        return;
      }
      run.rpcQueue.push(function () {
        Promise.resolve()
          .then(function () {
            if (runtime.pending.get(message.runId) !== run || (run.signal && run.signal.aborted))
              throw new LuaRuntimeError('RISU_LUA_ABORTED', 'Lua 运行已取消');
            return runtime.rpc({
              method: message.method,
              args: message.args,
              scope: run.scope,
              runId: message.runId,
              signal: run.signal || null,
            });
          })
          .then(
            function (value) {
              if (runtime.worker && generation === runtime.generation && runtime.pending.get(message.runId) === run)
                runtime.worker.postMessage({
                  type: 'rpcResult',
                  id: message.id,
                  runId: message.runId,
                  ok: true,
                  value: value,
                });
            },
            function (error) {
              if (runtime.worker && generation === runtime.generation && runtime.pending.get(message.runId) === run)
                runtime.worker.postMessage({
                  type: 'rpcResult',
                  id: message.id,
                  runId: message.runId,
                  ok: false,
                  error: String((error && error.message) || error || '宿主调用失败'),
                });
            }
          );
      });
      if (!run.computing) run.flushRpc();
      return;
    }
    var pending = runtime.pending.get(message.id);
    if (!pending) {
      runtime._invalidate(new LuaRuntimeError('RISU_LUA_CHANNEL', 'Lua Worker 返回了无法关联的消息'));
      return;
    }
    if (message.type === 'ready' && pending.type === 'init') {
      runtime.pending.delete(message.id);
      pending.resolve(true);
      return;
    }
    if (pending.type === 'run' && !sameScope(message.scope, pending.scope)) {
      runtime._invalidate(new LuaRuntimeError('RISU_LUA_CHANNEL', 'Lua 结果不属于当前角色或会话'));
      return;
    }
    if (message.type === 'computation' && pending.type === 'run') {
      pending.computation(message.active === true);
      return;
    }
    runtime.pending.delete(message.id);
    if (pending.cleanup) pending.cleanup();
    if (message.type === 'done' && pending.type === 'run') {
      pending.resolve({
        result: message.result,
        stopSending: message.stopSending === true,
        state: message.state,
        changed: message.changed || {},
        signals: Array.isArray(message.signals) ? message.signals : [],
        apiCalls: message.apiCalls || {},
      });
      return;
    }
    var details = message.error && typeof message.error === 'object' ? message.error : null;
    pending.reject(new LuaRuntimeError('RISU_LUA_EXECUTION', (details && details.message) || 'Lua 运行失败', details));
  };

  RisuLuaRuntime.prototype._runOne = function (request) {
    var runtime = this;
    request = request || {};
    var scope = checkedScope(request.scope);
    if (typeof request.code !== 'string')
      return Promise.reject(new LuaRuntimeError('RISU_LUA_CODE', 'Lua 脚本必须是字符串'));
    if (String(request.mode || '') === 'editprocess') {
      return Promise.resolve({
        result: request.data,
        stopSending: false,
        state: request.state || {},
        changed: { vars: {}, chat: false, note: false, character: {}, lore: false },
        signals: [],
        apiCalls: {},
      });
    }
    var signal = request.signal || null;
    if (signal && signal.aborted) return Promise.reject(new LuaRuntimeError('RISU_LUA_ABORTED', 'Lua 运行已取消'));
    var abort = function () {
      runtime._invalidate(new LuaRuntimeError('RISU_LUA_ABORTED', 'Lua 运行已取消'));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    return runtime._start().then(
      function () {
        if (signal && signal.aborted) {
          abort();
          throw new LuaRuntimeError('RISU_LUA_ABORTED', 'Lua 运行已取消');
        }
        return new Promise(function (resolve, reject) {
          var id = 'c' + ++sequence;
          var timeoutMs = Number.isFinite(request.timeoutMs)
            ? Math.max(1, Number(request.timeoutMs))
            : runtime.defaultTimeoutMs;
          var timer = 0,
            startedAt = 0,
            remainingMs = timeoutMs,
            runController = new AbortController(),
            entry;
          function computation(active) {
            entry.computing = active;
            if (timer) {
              clearTimeout(timer);
              timer = 0;
              remainingMs -= performance.now() - startedAt;
            }
            if (!active) {
              entry.flushRpc();
              return;
            }
            startedAt = performance.now();
            timer = setTimeout(
              function () {
                runtime._invalidate(new LuaRuntimeError('RISU_LUA_TIMEOUT', 'Lua 计算超时并已终止'));
              },
              Math.max(0, remainingMs)
            );
          }
          entry = {
            type: 'run',
            computing: false,
            rpcQueue: [],
            flushRpc: function () {
              entry.rpcQueue.splice(0).forEach(function (start) {
                start();
              });
            },
            scope: scope,
            signal: runController.signal,
            resolve: resolve,
            reject: reject,
            computation: computation,
            cleanup: function () {
              clearTimeout(timer);
              if (signal) signal.removeEventListener('abort', abort);
              runController.abort();
              entry.rpcQueue.length = 0;
            },
          };
          runtime.pending.set(id, entry);
          try {
            runtime.worker.postMessage({
              type: 'run',
              id: id,
              scope: scope,
              accessKey: randomAccessKey(),
              engineKey: request.engineKey == null ? String(request.mode || 'manual') : String(request.engineKey),
              mode: String(request.mode || 'manual'),
              code: request.code,
              data: request.data == null ? '' : request.data,
              meta: request.meta || {},
              state: request.state || {},
              lowLevelAccess: request.lowLevelAccess === true,
            });
          } catch (error) {
            runtime._invalidate(
              new LuaRuntimeError('RISU_LUA_CHANNEL', (error && error.message) || 'Lua 请求发送失败')
            );
          }
        });
      },
      function (error) {
        if (signal) signal.removeEventListener('abort', abort);
        throw error;
      }
    );
  };

  RisuLuaRuntime.prototype.run = function (request) {
    var runtime = this;
    var generation = runtime.generation;
    var operation = runtime.queue.then(function () {
      if (generation !== runtime.generation) throw new LuaRuntimeError('RISU_LUA_ABORTED', 'Lua 排队运行已取消');
      return runtime._runOne(request);
    });
    runtime.queue = operation.catch(function () {});
    var signal = request && request.signal;
    if (!signal) return operation;
    return new Promise(function (resolve, reject) {
      function abort() {
        reject(new LuaRuntimeError('RISU_LUA_ABORTED', 'Lua 运行已取消'));
      }
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      operation.then(resolve, reject).finally(function () {
        signal.removeEventListener('abort', abort);
      });
    });
  };

  RisuLuaRuntime.prototype.cancel = function () {
    this._invalidate(new LuaRuntimeError('RISU_LUA_ABORTED', 'Lua 运行已取消'));
  };

  RisuLuaRuntime.prototype.dispose = function () {
    this.disposed = true;
    this._invalidate(new LuaRuntimeError('RISU_LUA_DISPOSED', 'Lua 运行时已释放'));
  };

  root.YeyuRisuLua = Object.freeze({
    Runtime: RisuLuaRuntime,
    Error: LuaRuntimeError,
    createRuntime: function (options) {
      return new RisuLuaRuntime(options);
    },
    officialModes: Object.freeze([
      'start',
      'input',
      'output',
      'manual',
      'onButtonClick',
      'onFormSubmit',
      'editinput',
      'editoutput',
      'editRequest',
      'editdisplay',
    ]),
    passthroughModes: Object.freeze(['editprocess']),
    asyncRpcMethods: Object.freeze([
      'alertError',
      'alertNormal',
      'alertInput',
      'alertSelect',
      'alertConfirm',
      'getTokens',
      'similarity',
      'request',
      'generateImage',
      'LLMMain',
      'axLLMMain',
      'simpleLLM',
      'loadLoreBooksMain',
      'getCharacterImage',
      'getPersonaImage',
      'hash',
    ]),
    officialHostApis: Object.freeze([
      'getChatVar',
      'setChatVar',
      'setChatVarChanged',
      'getGlobalVar',
      'stopChat',
      'alertError',
      'alertNormal',
      'alertInput',
      'alertSelect',
      'alertConfirm',
      'getChatMain',
      'getChatData',
      'getChatRole',
      'getRecentChatsMain',
      'setChat',
      'setChatRole',
      'cutChat',
      'removeChat',
      'addChat',
      'insertChat',
      'getTokens',
      'getChatLength',
      'getFullChatMain',
      'sleep',
      'cbs',
      'setFullChatMain',
      'logMain',
      'reloadDisplay',
      'reloadChat',
      'similarity',
      'request',
      'generateImage',
      'getCharacterImageMain',
      'getPersonaImageMain',
      'hash',
      'LLMMain',
      'simpleLLM',
      'getName',
      'setName',
      'getDescription',
      'setDescription',
      'getCharacterFirstMessage',
      'setCharacterFirstMessage',
      'getPersonaName',
      'getPersonaDescription',
      'getAuthorsNote',
      'getBackgroundEmbedding',
      'setBackgroundEmbedding',
      'getLoreBooksMain',
      'upsertLocalLoreBook',
      'loadLoreBooksMain',
      'axLLMMain',
      'getCharacterLastMessage',
      'getUserLastMessage',
    ]),
    permissions: Object.freeze({
      editDisplay: 'chat-variable-write-only',
      safe: 'all-non-display-hooks',
      lowLevelAccess: Object.freeze([
        'similarity',
        'request',
        'generateImage',
        'LLMMain',
        'axLLMMain',
        'simpleLLM',
        'loadLoreBooksMain',
      ]),
      unsupported: Object.freeze(['audio', 'tts', 'vits']),
    }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
