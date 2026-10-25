(function (root) {
  'use strict';

  var scriptUrl =
    typeof document !== 'undefined' && document.currentScript ? String(document.currentScript.src || '') : '';
  var defaultAssetRoot = scriptUrl ? scriptUrl.replace(/core\/risu-regex-runtime\.js(?:\?.*)?$/, '') : 'js/';
  var assetPromise = null;
  var sequence = 0;
  var singleton = null;

  function RisuRegexRuntimeError(code, message, details) {
    this.name =
      code === 'RISU_REGEX_ABORTED'
        ? 'AbortError'
        : code === 'RISU_REGEX_TIMEOUT'
          ? 'TimeoutError'
          : 'RisuRegexRuntimeError';
    this.code = code;
    this.message = String(message || 'Risu 正则运行失败');
    this.details = details || null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, RisuRegexRuntimeError);
  }
  RisuRegexRuntimeError.prototype = Object.create(Error.prototype);
  RisuRegexRuntimeError.prototype.constructor = RisuRegexRuntimeError;

  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    if (typeof document === 'undefined')
      return Promise.reject(new RisuRegexRuntimeError('RISU_REGEX_ENV', 'Risu 正则控制器需要浏览器 Worker 环境'));
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.onload = function () {
        if (ready()) resolve();
        else reject(new RisuRegexRuntimeError('RISU_REGEX_ASSET', 'Risu 正则资源未导出预期接口'));
      };
      script.onerror = function () {
        reject(new RisuRegexRuntimeError('RISU_REGEX_ASSET', 'Risu 正则资源加载失败'));
      };
      document.head.appendChild(script);
    });
  }

  function ensureAssets(assetRoot) {
    if (assetPromise) return assetPromise;
    var base = String(assetRoot || defaultAssetRoot);
    if (base && !/[\\/]$/.test(base)) base += '/';
    assetPromise = loadScript(base + 'core/risu-cbs.js', function () {
      return typeof root.YeyuRisuCBSInstaller === 'function';
    })
      .then(function () {
        return loadScript(base + 'core/risu-regex.js', function () {
          return typeof root.YeyuRisuRegexInstaller === 'function';
        });
      })
      .then(function () {
        return loadScript(base + 'core/risu-lorebook.js', function () {
          return typeof root.YeyuRisuLorebookInstaller === 'function';
        });
      })
      .then(function () {
        return loadScript(base + 'core/pure.js', function () {
          return !!root.YeyuPure && typeof root.YeyuPure.estTokens === 'function';
        });
      })
      .then(function () {
        return Promise.all([
          loadScript(base + 'vendor/jsdiff-9.0.0.js', function () {
            return typeof root.YeyuTextDiffInstaller === 'function';
          }),
          loadScript(base + 'core/risu-history.js', function () {
            return typeof root.YeyuRisuHistoryInstaller === 'function';
          }),
        ]);
      })
      .then(function () {
        return loadScript(base + 'workers/risu-regex-worker.js', function () {
          return typeof root.YeyuRisuRegexWorkerMain === 'function';
        });
      })
      .catch(function (error) {
        assetPromise = null;
        throw error;
      });
    return assetPromise;
  }

  function workerSource() {
    return (
      '(' +
      root.YeyuTextDiffInstaller.toString() +
      ')(self.YeyuTextDiff = {});\n(' +
      root.YeyuRisuHistoryInstaller.toString() +
      ')(self);\n(' +
      root.YeyuRisuCBSInstaller.toString() +
      ')(self);\n(' +
      root.YeyuRisuRegexInstaller.toString() +
      ')(self);\n(' +
      root.YeyuRisuLorebookInstaller.toString() +
      ')(self);\nself.YeyuRisuTokenize = ' +
      root.YeyuPure.estTokens.toString() +
      ';\nself.YeyuProtectTranslationMarkup = ' +
      root.YeyuPure.protectTranslationMarkup.toString() +
      ';\n(' +
      root.YeyuRisuRegexWorkerMain.toString() +
      ')();'
    );
  }

  function RisuRegexRuntime(options) {
    options = options || {};
    this.assetRoot = options.assetRoot || defaultAssetRoot;
    this.defaultTimeoutMs = Number.isFinite(options.defaultTimeoutMs)
      ? Math.max(1, Number(options.defaultTimeoutMs))
      : 4000;
    this.active = new Set();
    this.idleWorker = null;
    this.disposed = false;
  }

  RisuRegexRuntime.prototype._execute = function (message, options) {
    var runtime = this;
    options = options || {};
    var signal = options.signal || null;
    if (runtime.disposed)
      return Promise.reject(new RisuRegexRuntimeError('RISU_REGEX_DISPOSED', 'Risu 正则运行时已释放'));
    if (signal && signal.aborted)
      return Promise.reject(new RisuRegexRuntimeError('RISU_REGEX_ABORTED', 'Risu 正则运行已取消'));
    return new Promise(function (resolve, reject) {
      var id = 'r' + ++sequence,
        url = null,
        worker = null,
        timer = null,
        settled = false,
        rowIndex = -1,
        rowResults = [];
      var timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1, Number(options.timeoutMs))
        : runtime.defaultTimeoutMs;
      function cleanup(reuse) {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
        if (worker && reuse && !runtime.disposed && !runtime.idleWorker) {
          worker.onmessage = null;
          worker.onerror = null;
          runtime.idleWorker = { worker: worker, url: url };
        } else {
          if (worker) worker.terminate();
          if (url) URL.revokeObjectURL(url);
        }
        runtime.active.delete(entry);
      }
      function finish(error, value) {
        if (settled) return;
        settled = true;
        cleanup(!error);
        if (error) reject(error);
        else resolve(value);
      }
      function abort() {
        finish(new RisuRegexRuntimeError('RISU_REGEX_ABORTED', 'Risu 正则运行已取消'));
      }
      var entry = {
        abort: function (error) {
          finish(error || new RisuRegexRuntimeError('RISU_REGEX_ABORTED', 'Risu 正则运行已取消'));
        },
      };
      runtime.active.add(entry);
      if (signal) signal.addEventListener('abort', abort, { once: true });
      ensureAssets(runtime.assetRoot)
        .then(function () {
          if (settled) return;
          if (runtime.idleWorker) {
            worker = runtime.idleWorker.worker;
            url = runtime.idleWorker.url;
            runtime.idleWorker = null;
          } else {
            url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
            try {
              worker = new Worker(url);
            } catch (_) {
              finish(new RisuRegexRuntimeError('RISU_REGEX_WORKER', 'Risu 正则 Worker 启动失败'));
              return;
            }
          }
          worker.onmessage = function (event) {
            var response = (event && event.data) || {};
            if (response.id !== id) {
              finish(new RisuRegexRuntimeError('RISU_REGEX_CHANNEL', 'Risu 正则 Worker 返回了无法关联的消息'));
              return;
            }
            if (response.type === 'rowResult') {
              clearTimeout(timer);
              timer = null;
              rowResults.push(response.result);
              return;
            }
            if (response.type === 'started') {
              if (Number.isInteger(response.index)) {
                rowIndex = response.index;
                clearTimeout(timer);
                timer = null;
              }
              if (timer === null)
                timer = setTimeout(function () {
                  finish(
                    new RisuRegexRuntimeError(
                      'RISU_REGEX_TIMEOUT',
                      'Risu 正则计算超时并已终止',
                      rowIndex < 0 ? null : { index: rowIndex, results: rowResults }
                    )
                  );
                }, timeoutMs);
            } else if (response.type === 'result') finish(null, response.result);
            else if (response.type === 'primitiveResult') finish(null, response.value);
            else {
              var detail = response.error && typeof response.error === 'object' ? response.error : null;
              finish(
                new RisuRegexRuntimeError(
                  'RISU_REGEX_EXECUTION',
                  detail && detail.name === 'SyntaxError'
                    ? 'Risu 正则表达式无效'
                    : (detail && detail.message) || 'Risu 正则运行失败',
                  detail
                )
              );
            }
          };
          worker.onerror = function () {
            finish(new RisuRegexRuntimeError('RISU_REGEX_WORKER', 'Risu 正则 Worker 运行失败'));
          };
          try {
            worker.postMessage(Object.assign({}, message, { id: id }));
          } catch (_) {
            finish(new RisuRegexRuntimeError('RISU_REGEX_CHANNEL', 'Risu 正则请求包含不可传输的数据'));
          }
        })
        .catch(function (error) {
          finish(error);
        });
    });
  };

  RisuRegexRuntime.prototype.run = function (data, scripts, mode, context, options) {
    var request;
    if (arguments.length === 1 && data && typeof data === 'object') {
      request = data;
      options = request;
    } else {
      options = options || {};
      request = {
        data: data,
        scripts: scripts,
        mode: mode,
        context: context,
        cbsContext: options.cbsContext,
      };
    }
    return this._execute(
      {
        type: 'run',
        data: request.data,
        scripts: request.scripts,
        mode: request.mode,
        context: request.context || {},
        cbsContext: request.cbsContext || (request.context && request.context.cbs) || {},
      },
      options
    );
  };

  // The snapshot the rows after `finished` start from: what the successful ones wrote and injected.
  function carryRowEffects(context, finished) {
    var variables = Object.assign({}, context.chatVariables),
      messages = Array.isArray(context.messages)
        ? context.messages.map(function (row) {
            return Object.assign({}, row);
          })
        : context.messages;
    finished.forEach(function (result) {
      if (!result || result.error || result.stopped) return;
      (result.effects || []).forEach(function (effect) {
        if (effect.type === 'setChatVariable') variables[effect.name] = effect.value;
        else if (effect.type === 'inject' && Array.isArray(messages) && messages[effect.chatIndex])
          messages[effect.chatIndex].data = effect.data;
      });
    });
    return Object.assign({}, context, { chatVariables: variables, messages: messages });
  }
  // One request for many rows of one mode, equivalent to a single run per row in order: the Worker
  // applies earlier rows' variable writes and injections before later rows. Each row has its own
  // computation timeout. A row that throws, stops or times out comes back as that row's result
  // (`error` or `stopped`); after a timeout the remaining rows continue in a fresh Worker from what
  // the finished rows left behind. With `stopAtTimeout` a timeout rejects the whole request instead.
  RisuRegexRuntime.prototype.runBatch = async function (request) {
    var rows = request.rows || [],
      context = request.cbsContext || {},
      results = [],
      offset = 0;
    while (offset < rows.length) {
      try {
        var batch = await this._execute(
          {
            type: 'run-batch',
            rows: rows.slice(offset),
            scripts: request.scripts,
            mode: request.mode,
            firstMessage: request.firstMessage,
            emotions: request.emotions || [],
            cbsContext: context,
          },
          request
        );
        return results.concat(batch);
      } catch (error) {
        if (
          request.stopAtTimeout ||
          error.code !== 'RISU_REGEX_TIMEOUT' ||
          !error.details ||
          error.details.index < 0
        )
          throw error;
        results = results.concat(error.details.results, [
          { error: { name: error.name, code: error.code, message: error.message } },
        ]);
        context = carryRowEffects(context, error.details.results);
        offset += error.details.index + 1;
      }
    }
    return results;
  };

  RisuRegexRuntime.prototype.primitive = function (operation, input, pattern, flags, replacement, options) {
    var request;
    if (arguments.length === 1 && operation && typeof operation === 'object') {
      request = operation;
      options = request;
    } else {
      request = { operation: operation, input: input, pattern: pattern, flags: flags, replacement: replacement };
      options = options || {};
    }
    return this._execute(
      {
        type: 'primitive',
        operation: request.operation,
        input: request.input,
        pattern: request.pattern,
        flags: request.flags,
        replacement: request.replacement && typeof request.replacement === 'object' ? undefined : request.replacement,
        specification:
          request.specification ||
          (request.replacement && typeof request.replacement === 'object' ? request.replacement : undefined),
      },
      options
    );
  };

  RisuRegexRuntime.prototype.protectTranslation = function (input, context, options) {
    return this._execute({ type: 'protect-translation', input: input }, options);
  };
  RisuRegexRuntime.prototype.visibleSpans = function (input, context, options) {
    return this._execute(
      { type: 'visible-spans', text: input.text, earlier: input.earlier, context: context || {} },
      options
    );
  };
  RisuRegexRuntime.prototype.retainHistory = function (rows, options) {
    return this._execute({ type: 'history', rows: rows }, options);
  };
  RisuRegexRuntime.prototype.evaluateCBS = function (text, context, options) {
    return this._execute({ type: 'cbs', text: text, context: context || {} }, options);
  };
  RisuRegexRuntime.prototype.evaluateCBSBatch = function (texts, context, options) {
    return this._execute({ type: 'cbs', texts: texts, context: context || {} }, options);
  };
  RisuRegexRuntime.prototype.evaluateDisplayCBS = async function (rows, context, options) {
    var results = [],
      offset = 0;
    while (offset < rows.length) {
      try {
        var batch = await this._execute(
          { type: 'display-cbs', rows: rows.slice(offset), context: context || {} },
          options
        );
        return results.concat(batch);
      } catch (error) {
        if (error.code !== 'RISU_REGEX_TIMEOUT' || !error.details || error.details.index < 0) throw error;
        // Each row is independent. Terminate the failed computation and retain explicit failure
        // evidence for it; the remaining messages run in a fresh Worker with the same snapshot.
        results = results.concat(error.details.results, [
          { error: { name: error.name, code: error.code, message: error.message } },
        ]);
        offset += error.details.index + 1;
      }
    }
    return results;
  };
  RisuRegexRuntime.prototype.resolveLorebook = function (lore, context, options) {
    return this._execute({ type: 'lore', lore: lore, context: context || {} }, options);
  };

  RisuRegexRuntime.prototype.test = function (input, pattern, flags, options) {
    return this.primitive('test', input, pattern, flags, undefined, options);
  };
  RisuRegexRuntime.prototype.match = function (input, pattern, flags, options) {
    return this.primitive('match', input, pattern, flags, undefined, options);
  };
  RisuRegexRuntime.prototype.split = function (input, pattern, flags, options) {
    return this.primitive('split', input, pattern, flags, undefined, options);
  };
  RisuRegexRuntime.prototype.replace = function (input, pattern, flags, replacement, options) {
    return this.primitive('replace', input, pattern, flags, replacement, options);
  };
  RisuRegexRuntime.prototype.cancel = function () {
    if (this.idleWorker) {
      this.idleWorker.worker.terminate();
      URL.revokeObjectURL(this.idleWorker.url);
      this.idleWorker = null;
    }
    this.active.forEach(function (entry) {
      entry.abort();
    });
  };
  RisuRegexRuntime.prototype.dispose = function () {
    this.disposed = true;
    if (this.idleWorker) {
      this.idleWorker.worker.terminate();
      URL.revokeObjectURL(this.idleWorker.url);
      this.idleWorker = null;
    }
    var error = new RisuRegexRuntimeError('RISU_REGEX_DISPOSED', 'Risu 正则运行时已释放');
    this.active.forEach(function (entry) {
      entry.abort(error);
    });
  };

  function defaultRuntime() {
    if (!singleton || singleton.disposed) singleton = new RisuRegexRuntime();
    return singleton;
  }

  root.YeyuRisuRegexRuntime = Object.freeze({
    Runtime: RisuRegexRuntime,
    Error: RisuRegexRuntimeError,
    createRuntime: function (options) {
      return new RisuRegexRuntime(options);
    },
    run: function () {
      return defaultRuntime().run.apply(defaultRuntime(), arguments);
    },
    runBatch: function () {
      return defaultRuntime().runBatch.apply(defaultRuntime(), arguments);
    },
    primitive: function () {
      return defaultRuntime().primitive.apply(defaultRuntime(), arguments);
    },
    protectTranslation: function () {
      return defaultRuntime().protectTranslation.apply(defaultRuntime(), arguments);
    },
    visibleSpans: function () {
      return defaultRuntime().visibleSpans.apply(defaultRuntime(), arguments);
    },
    retainHistory: function () {
      return defaultRuntime().retainHistory.apply(defaultRuntime(), arguments);
    },
    evaluateCBS: function () {
      return defaultRuntime().evaluateCBS.apply(defaultRuntime(), arguments);
    },
    evaluateCBSBatch: function () {
      return defaultRuntime().evaluateCBSBatch.apply(defaultRuntime(), arguments);
    },
    evaluateDisplayCBS: function () {
      return defaultRuntime().evaluateDisplayCBS.apply(defaultRuntime(), arguments);
    },
    resolveLorebook: function () {
      return defaultRuntime().resolveLorebook.apply(defaultRuntime(), arguments);
    },
    test: function () {
      return defaultRuntime().test.apply(defaultRuntime(), arguments);
    },
    match: function () {
      return defaultRuntime().match.apply(defaultRuntime(), arguments);
    },
    split: function () {
      return defaultRuntime().split.apply(defaultRuntime(), arguments);
    },
    replace: function () {
      return defaultRuntime().replace.apply(defaultRuntime(), arguments);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
