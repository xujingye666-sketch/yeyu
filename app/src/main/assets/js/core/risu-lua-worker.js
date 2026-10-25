(function (root) {
  'use strict';

  // This function is serialized into a Blob Worker by risu-lua.js. Keeping the
  // implementation in a standalone asset makes the worker boundary auditable
  // while still working from Android's file:///android_asset origin.
  function risuLuaWorkerMain() {
    'use strict';

    var factory = null;
    var engines = Object.create(null);
    var rpcPending = Object.create(null);
    var rpcSequence = 0;
    var activeRun = null;

    var EDIT_MODE = Object.freeze({
      editinput: 'editInput',
      editoutput: 'editOutput',
      editdisplay: 'editDisplay',
      editInput: 'editInput',
      editOutput: 'editOutput',
      editRequest: 'editRequest',
      editDisplay: 'editDisplay',
    });

    function post(message) {
      self.postMessage(message);
    }

    function computation(active) {
      if (activeRun) post({ type: 'computation', id: activeRun.id, scope: activeRun.scope, active: active });
    }

    function reportRpcWait(runId) {
      // Only an actual return to the Worker event loop proves Lua yielded. A fire-and-forget
      // RPC followed by a synchronous infinite loop must never suspend the watchdog.
      setTimeout(function () {
        if (
          activeRun &&
          activeRun.id === runId &&
          Object.keys(rpcPending).some(function (id) {
            return rpcPending[id].runId === runId;
          })
        )
          computation(false);
      }, 0);
    }

    function cleanError(error, phase) {
      var message = error && error.message ? String(error.message) : String(error || 'Lua 运行失败');
      // Script text and state are intentionally never copied into diagnostics.
      return { name: error && error.name ? String(error.name) : 'Error', message: message, phase: phase || 'run' };
    }

    function clone(value) {
      if (value == null) return value;
      return JSON.parse(JSON.stringify(value));
    }

    function normalizeState(input) {
      var source = input && typeof input === 'object' ? clone(input) : {};
      var chat = source.chat && typeof source.chat === 'object' ? source.chat : {};
      if (!Array.isArray(chat.message)) chat.message = [];
      chat.message = chat.message.map(function (message) {
        var row = message && typeof message === 'object' ? Object.assign({}, message) : {};
        row.role = message && message.role === 'user' ? 'user' : 'char';
        row.data = String(message && message.data != null ? message.data : '');
        row.time = Number(message && message.time) || 0;
        return row;
      });
      if (typeof chat.note !== 'string') chat.note = '';
      source.chat = chat;
      source.vars = source.vars && typeof source.vars === 'object' ? source.vars : {};
      source.globalVars = source.globalVars && typeof source.globalVars === 'object' ? source.globalVars : {};
      source.defaultVariables = Array.isArray(source.defaultVariables) ? source.defaultVariables : [];
      source.character = source.character && typeof source.character === 'object' ? source.character : {};
      source.persona = source.persona && typeof source.persona === 'object' ? source.persona : {};
      source.lore = Array.isArray(source.lore) ? source.lore : [];
      return source;
    }

    function makeRun(message) {
      return {
        id: message.id,
        scope: clone(message.scope),
        accessKey: String(message.accessKey),
        mode: EDIT_MODE[message.mode] || String(message.mode || 'manual'),
        lowLevelAccess: message.lowLevelAccess === true,
        state: normalizeState(message.state),
        changed: { vars: {}, chat: false, note: false, character: {}, lore: false },
        signals: [],
        apiCalls: {},
        stopSending: false,
      };
    }

    function assertAccess(id, kind) {
      if (!activeRun || String(id) !== activeRun.accessKey) return false;
      if (kind === 'low') return activeRun.mode !== 'editDisplay' && activeRun.lowLevelAccess === true;
      if (kind === 'safe') return activeRun.mode !== 'editDisplay';
      if (kind === 'var-write') return true;
      return true;
    }

    function countApi(name) {
      if (!activeRun) return;
      activeRun.apiCalls[name] = (activeRun.apiCalls[name] || 0) + 1;
    }

    function rpc(method, args) {
      if (!activeRun) return Promise.reject(new Error('Lua RPC 没有活动运行'));
      var rpcId = 'r' + ++rpcSequence;
      var runId = activeRun.id;
      return new Promise(function (resolve, reject) {
        rpcPending[rpcId] = { resolve: resolve, reject: reject, runId: runId };
        post({ type: 'rpc', id: rpcId, runId: runId, scope: activeRun.scope, method: method, args: clone(args) });
        reportRpcWait(runId);
      });
    }

    function getVar(state, key) {
      if (Object.prototype.hasOwnProperty.call(state.vars, key)) return String(state.vars[key]);
      for (var i = 0; i < state.defaultVariables.length; i++) {
        var row = state.defaultVariables[i];
        if (Array.isArray(row) && row[0] === key) return String(row[1]);
      }
      return 'null';
    }

    function setVar(state, key, value) {
      key = String(key);
      value = String(value);
      if (String(state.vars[key]) === value && Object.prototype.hasOwnProperty.call(state.vars, key)) return false;
      state.vars[key] = value;
      activeRun.changed.vars[key] = value;
      return true;
    }

    function lastMessage(role) {
      var messages = activeRun.state.chat.message;
      for (var i = messages.length - 1; i >= 0; i--) if (messages[i].role === role) return messages[i].data;
      return role === 'char' ? String(activeRun.state.character.firstMessage || '') : '';
    }

    function evaluateCbs(value) {
      if (!self.YeyuRisuCBS || typeof self.YeyuRisuCBS.evaluate !== 'function')
        throw new Error('RISU_LUA_CBS_UNAVAILABLE');
      var state = activeRun.state;
      var supplied = state.cbsContext && typeof state.cbsContext === 'object' ? state.cbsContext : {};
      var context = Object.assign({}, supplied, {
        runVar: false,
        character: state.character,
        characterId: activeRun.scope.roleId,
        chatId: activeRun.scope.sessionId,
        characterName: String(state.character.name || supplied.characterName || ''),
        userName: String(state.persona.name || supplied.userName || ''),
        persona: String(state.persona.prompt || supplied.persona || ''),
        messages: state.chat.message,
        getChatVar: function (key) {
          return getVar(state, String(key));
        },
        setChatVar: function (key, next) {
          setVar(state, String(key), String(next));
        },
        getGlobalVar: function (key) {
          return Object.prototype.hasOwnProperty.call(state.globalVars, key) ? String(state.globalVars[key]) : 'null';
        },
      });
      return self.YeyuRisuCBS.evaluate(String(value == null ? '' : value), context);
    }

    function declareHostApis(engine) {
      function set(name, fn) {
        engine.global.set(name, function () {
          countApi(name);
          return fn.apply(null, arguments);
        });
      }

      set('__jsonDecode', function (value) {
        return JSON.parse(String(value));
      });
      set('__jsonEncode', function (value) {
        return JSON.stringify(value);
      });
      set('getChatVar', function (_id, key) {
        return getVar(activeRun.state, String(key));
      });
      set('setChatVar', function (id, key, value) {
        if (!assertAccess(id, 'var-write')) return;
        setVar(activeRun.state, key, value);
      });
      set('setChatVarChanged', function (id, key, value) {
        if (!assertAccess(id, 'var-write')) return;
        return setVar(activeRun.state, key, value) || undefined;
      });
      set('getGlobalVar', function (_id, key) {
        var globals = activeRun.state.globalVars;
        return Object.prototype.hasOwnProperty.call(globals, key) ? String(globals[key]) : 'null';
      });
      set('stopChat', function (id) {
        if (assertAccess(id, 'safe')) activeRun.stopSending = true;
      });
      ['alertError', 'alertNormal', 'alertInput', 'alertSelect', 'alertConfirm'].forEach(function (name) {
        set(name, function (id, value) {
          if (!assertAccess(id, 'safe')) return;
          return rpc(name, [value]);
        });
      });
      set('getChatMain', function (_id, index) {
        var message = activeRun.state.chat.message.at(Number(index));
        return JSON.stringify(message ? { role: message.role, data: message.data, time: message.time || 0 } : null);
      });
      set('getChatData', function (_id, index) {
        var message = activeRun.state.chat.message.at(Number(index));
        return message ? message.data : '';
      });
      set('getChatRole', function (_id, index) {
        var message = activeRun.state.chat.message.at(Number(index));
        return message ? message.role : '';
      });
      set('getRecentChatsMain', function (_id, count) {
        var messages = activeRun.state.chat.message;
        var take = Math.max(0, Math.floor(Number(count) || 0));
        return JSON.stringify(messages.slice(Math.max(0, messages.length - take)));
      });
      set('setChat', function (id, index, value) {
        if (!assertAccess(id, 'safe')) return;
        var message = activeRun.state.chat.message.at(Number(index));
        if (message) {
          message.data = String(value == null ? '' : value);
          activeRun.changed.chat = true;
        }
      });
      set('setChatRole', function (id, index, value) {
        if (!assertAccess(id, 'safe')) return;
        var message = activeRun.state.chat.message.at(Number(index));
        if (message) {
          message.role = value === 'user' ? 'user' : 'char';
          activeRun.changed.chat = true;
        }
      });
      set('cutChat', function (id, start, end) {
        if (!assertAccess(id, 'safe')) return;
        activeRun.state.chat.message = activeRun.state.chat.message.slice(Number(start), Number(end));
        activeRun.changed.chat = true;
      });
      set('removeChat', function (id, index) {
        if (!assertAccess(id, 'safe')) return;
        activeRun.state.chat.message.splice(Number(index), 1);
        activeRun.changed.chat = true;
      });
      set('addChat', function (id, role, value) {
        if (!assertAccess(id, 'safe')) return;
        activeRun.state.chat.message.push({
          role: role === 'user' ? 'user' : 'char',
          data: String(value == null ? '' : value),
          time: 0,
        });
        activeRun.changed.chat = true;
      });
      set('insertChat', function (id, index, role, value) {
        if (!assertAccess(id, 'safe')) return;
        activeRun.state.chat.message.splice(Number(index), 0, {
          role: role === 'user' ? 'user' : 'char',
          data: String(value == null ? '' : value),
          time: 0,
        });
        activeRun.changed.chat = true;
      });
      set('getTokens', function (id, value) {
        if (assertAccess(id, 'safe')) return rpc('getTokens', [String(value)]);
      });
      set('getChatLength', function () {
        return activeRun.state.chat.message.length;
      });
      set('getFullChatMain', function () {
        return JSON.stringify(activeRun.state.chat.message);
      });
      set('sleep', function (id, time) {
        if (!assertAccess(id, 'safe')) return;
        return new Promise(function (resolve) {
          setTimeout(
            function () {
              resolve(true);
            },
            Math.max(0, Number(time) || 0)
          );
        });
      });
      set('cbs', function (value) {
        return evaluateCbs(value);
      });
      set('setFullChatMain', function (id, value) {
        if (!assertAccess(id, 'safe')) return;
        var rows = JSON.parse(String(value));
        if (!Array.isArray(rows)) throw new TypeError('聊天内容必须是数组');
        activeRun.state.chat.message = rows.map(function (row) {
          var message = row && typeof row === 'object' ? Object.assign({}, row) : {};
          message.role = row && row.role === 'user' ? 'user' : 'char';
          message.data = String(row && row.data != null ? row.data : '');
          message.time = Number(row && row.time) || 0;
          return message;
        });
        activeRun.changed.chat = true;
      });
      set('logMain', function () {
        /* Card text is deliberately not forwarded to logs. */
      });
      set('reloadDisplay', function (id) {
        if (assertAccess(id, 'safe')) activeRun.signals.push({ kind: 'reloadDisplay' });
      });
      set('reloadChat', function (id, index) {
        if (assertAccess(id, 'safe')) activeRun.signals.push({ kind: 'reloadChat', index: Number(index) });
      });

      ['similarity', 'request', 'generateImage', 'LLMMain', 'axLLMMain', 'simpleLLM', 'loadLoreBooksMain'].forEach(
        function (name) {
          set(name, function () {
            var args = Array.prototype.slice.call(arguments);
            if (!assertAccess(args.shift(), 'low')) return;
            if (name === 'loadLoreBooksMain')
              args.push({ lore: activeRun.state.lore, vars: activeRun.state.vars, chat: activeRun.state.chat });
            return rpc(name, args);
          });
        }
      );
      set('getCharacterImageMain', function () {
        return rpc('getCharacterImage', []);
      });
      set('getPersonaImageMain', function () {
        return rpc('getPersonaImage', []);
      });
      set('hash', function (_id, value) {
        return rpc('hash', [String(value)]);
      });
      set('getName', function () {
        return String(activeRun.state.character.name || '');
      });
      set('setName', function (id, value) {
        if (!assertAccess(id, 'safe')) return;
        if (typeof value !== 'string') throw new TypeError('Invalid data type');
        activeRun.state.character.name = value;
        activeRun.changed.character.name = value;
      });
      set('getDescription', function (id) {
        if (assertAccess(id, 'safe')) return String(activeRun.state.character.desc || '');
      });
      set('setDescription', function (id, value) {
        if (!assertAccess(id, 'safe')) return;
        activeRun.state.character.desc = String(value);
        activeRun.changed.character.desc = String(value);
      });
      set('getCharacterFirstMessage', function () {
        return String(activeRun.state.character.firstMessage || '');
      });
      set('setCharacterFirstMessage', function (id, value) {
        if (!assertAccess(id, 'safe') || typeof value !== 'string') return false;
        activeRun.state.character.firstMessage = value;
        activeRun.changed.character.firstMessage = value;
        return true;
      });
      set('getPersonaName', function () {
        return String(activeRun.state.persona.name || '');
      });
      set('getPersonaDescription', function () {
        return String(activeRun.state.persona.prompt || '');
      });
      set('getAuthorsNote', function () {
        return String(activeRun.state.chat.note || '');
      });
      set('getBackgroundEmbedding', function (id) {
        if (assertAccess(id, 'safe')) return String(activeRun.state.character.backgroundHTML || '');
      });
      set('setBackgroundEmbedding', function (id, value) {
        if (!assertAccess(id, 'safe') || typeof value !== 'string') return false;
        if (activeRun.state.backgroundWritable !== true) throw new Error('RISU_LUA_BACKGROUND_UNAVAILABLE');
        activeRun.state.character.backgroundHTML = value;
        activeRun.changed.character.backgroundHTML = value;
        return true;
      });
      set('getLoreBooksMain', function (_id, search) {
        if (activeRun.state.loreAvailable !== true) throw new Error('RISU_LUA_LORE_UNAVAILABLE');
        return JSON.stringify(
          activeRun.state.lore
            .concat(activeRun.state.globalLore || [])
            .filter(function (book) {
              return book && book.comment === search;
            })
            .map(function (book) {
              return Object.assign({}, book, { content: evaluateCbs(book.content) });
            })
        );
      });
      set('upsertLocalLoreBook', function (id, name, content, options) {
        if (!assertAccess(id, 'safe')) return;
        if (activeRun.state.loreAvailable !== true) throw new Error('RISU_LUA_LORE_UNAVAILABLE');
        options = options && typeof options === 'object' ? options : {};
        activeRun.state.lore = activeRun.state.lore.filter(function (book) {
          return book && book.comment !== name;
        });
        activeRun.state.lore.push({
          alwaysActive: options.alwaysActive === true,
          comment: String(name),
          content: String(content),
          insertorder: Number(options.insertOrder) || 100,
          mode: 'normal',
          key: String(options.key || ''),
          secondkey: String(options.secondKey || ''),
          selective: Boolean(options.secondKey),
          useRegex: options.regex === true,
        });
        activeRun.changed.lore = true;
      });
      set('getCharacterLastMessage', function () {
        return lastMessage('char');
      });
      set('getUserLastMessage', function () {
        return lastMessage('user');
      });
    }

    function luaWrapper(code) {
      return [
        'json = { decode = __jsonDecode, encode = __jsonEncode }',
        "package.loaded['json'] = json",
        'function getChat(id, index) return json.decode(getChatMain(id, index)) end',
        'function getFullChat(id) return json.decode(getFullChatMain(id)) end',
        'function getRecentChats(id, count) return json.decode(getRecentChatsMain(id, count)) end',
        'function setFullChat(id, value) setFullChatMain(id, json.encode(value)) end',
        'function log(value) logMain(json.encode(value)) end',
        'function getLoreBooks(id, search) return json.decode(getLoreBooksMain(id, search)) end',
        'function loadLoreBooks(id, reserve) return json.decode(loadLoreBooksMain(id, reserve or 0):await()) end',
        'function LLM(id, prompt, useMultimodal, options) useMultimodal = useMultimodal or false options = options or {} return json.decode(LLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await()) end',
        'function axLLM(id, prompt, useMultimodal, options) useMultimodal = useMultimodal or false options = options or {} return json.decode(axLLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await()) end',
        'function getCharacterImage(id) return getCharacterImageMain(id):await() end',
        'function getPersonaImage(id) return getPersonaImageMain(id):await() end',
        'local editRequestFuncs, editDisplayFuncs, editInputFuncs, editOutputFuncs = {}, {}, {}, {}',
        "function listenEdit(type, func) if type == 'editRequest' then editRequestFuncs[#editRequestFuncs+1]=func return end if type == 'editDisplay' then editDisplayFuncs[#editDisplayFuncs+1]=func return end if type == 'editInput' then editInputFuncs[#editInputFuncs+1]=func return end if type == 'editOutput' then editOutputFuncs[#editOutputFuncs+1]=func return end error('Invalid type') end",
        'function getState(id, name) return json.decode(getChatVar(id, "__"..name)) end',
        'function setState(id, name, value) setChatVar(id, "__"..name, json.encode(value)) end',
        'function setStateChanged(id, name, value) return setChatVarChanged(id, "__"..name, json.encode(value)) end',
        'function async(callback) return function(...) local co=coroutine.create(callback) local safe,result=coroutine.resume(co,...) return Promise.create(function(resolve,reject) local checkresult local step=function() if coroutine.status(co)=="dead" then local send=safe and resolve or reject return send(result) end safe,result=coroutine.resume(co) checkresult() end checkresult=function() if safe and result==Promise.resolve(result) then result:finally(step) else step() end end checkresult() end) end end',
        'callListenMain = async(function(type,id,value,meta) local realValue=json.decode(value) local realMeta=json.decode(meta) local funcs=nil if type=="editRequest" then funcs=editRequestFuncs elseif type=="editDisplay" then funcs=editDisplayFuncs elseif type=="editInput" then funcs=editInputFuncs elseif type=="editOutput" then funcs=editOutputFuncs else error("Invalid type") end for _,func in ipairs(funcs) do realValue=func(id,realValue,realMeta) end return json.encode(realValue) end)',
        String(code || ''),
      ].join('\n');
    }

    async function ensureFactory(glueBase64) {
      if (factory) return;
      var binary = atob(String(glueBase64 || ''));
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
      factory = new self.wasmoon.LuaFactory(url);
    }

    async function engineFor(message) {
      var key = String(message.engineKey || message.mode || 'manual');
      var entry = engines[key];
      if (entry && entry.code === message.code) return entry;
      if (entry) {
        try {
          entry.engine.global.close();
        } catch (_) {}
        delete engines[key];
      }
      var engine = await factory.createEngine({ injectObjects: true });
      declareHostApis(engine);
      activeRun = makeRun(message);
      try {
        computation(true);
        await engine.doString(luaWrapper(message.code));
      } finally {
        activeRun = null;
      }
      entry = { code: message.code, engine: engine };
      engines[key] = entry;
      return entry;
    }

    async function run(message) {
      activeRun = makeRun(message);
      var runScope = activeRun.scope;
      if (String(message.mode) === 'editprocess') {
        post({
          type: 'done',
          id: message.id,
          scope: runScope,
          result: clone(message.data),
          stopSending: false,
          state: activeRun.state,
          changed: activeRun.changed,
          signals: [],
          apiCalls: {},
        });
        activeRun = null;
        return;
      }
      var entry;
      try {
        entry = await engineFor(message);
        activeRun = makeRun(message);
        computation(true);
        var engine = entry.engine;
        var mode = activeRun.mode;
        var fn;
        var result;
        if (mode === 'input') fn = engine.global.get('onInput');
        else if (mode === 'output') fn = engine.global.get('onOutput');
        else if (mode === 'start') fn = engine.global.get('onStart');
        else if (mode === 'onButtonClick') fn = engine.global.get('onButtonClick');
        else if (mode === 'editRequest' || mode === 'editDisplay' || mode === 'editInput' || mode === 'editOutput')
          fn = engine.global.get('callListenMain');
        else fn = engine.global.get(mode);
        if (fn) {
          if (mode === 'onButtonClick') result = await fn(activeRun.accessKey, message.data);
          else if (mode === 'onFormSubmit')
            result = await fn(activeRun.accessKey, message.data, JSON.stringify(message.meta || {}));
          else if (mode === 'editRequest' || mode === 'editDisplay' || mode === 'editInput' || mode === 'editOutput') {
            result = await fn(
              mode,
              activeRun.accessKey,
              JSON.stringify(message.data),
              JSON.stringify(message.meta || {})
            );
            result = JSON.parse(result);
          } else result = await fn(activeRun.accessKey);
        }
        if (result === false) activeRun.stopSending = true;
        post({
          type: 'done',
          id: message.id,
          scope: activeRun.scope,
          result: result == null ? null : clone(result),
          stopSending: activeRun.stopSending,
          state: activeRun.state,
          changed: activeRun.changed,
          signals: activeRun.signals,
          apiCalls: activeRun.apiCalls,
        });
      } catch (error) {
        post({ type: 'failed', id: message.id, scope: runScope, error: cleanError(error, entry ? 'run' : 'compile') });
      } finally {
        activeRun = null;
      }
    }

    self.onmessage = function (event) {
      var message = event.data || {};
      if (message.type === 'init') {
        ensureFactory(message.glueBase64).then(
          function () {
            post({ type: 'ready', id: message.id });
          },
          function (error) {
            post({ type: 'failed', id: message.id, error: cleanError(error, 'init') });
          }
        );
        return;
      }
      if (message.type === 'rpcResult') {
        var pending = rpcPending[message.id];
        if (!pending || pending.runId !== message.runId) return;
        delete rpcPending[message.id];
        computation(true);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(String(message.error || 'Lua 宿主调用失败')));
        reportRpcWait(message.runId);
        return;
      }
      if (message.type === 'run') run(message);
    };
  }

  root.YeyuRisuLuaWorkerMain = risuLuaWorkerMain;
})(typeof window !== 'undefined' ? window : globalThis);
