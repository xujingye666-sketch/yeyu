/* global module, process */
// Guarded CommonJS export and Node runtime detection are used by tests.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YeyuRisuTrigger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MODES = ['start', 'manual', 'output', 'input', 'display', 'request'];
  var SAFE_SUBSET = [
    'v2SetVar',
    'v2If',
    'v2IfAdvanced',
    'v2Else',
    'v2EndIndent',
    'v2LoopNTimes',
    'v2BreakLoop',
    'v2ConsoleLog',
    'v2StopTrigger',
    'v2Random',
    'v2ExtractRegex',
    'v2RegexTest',
    'v2GetCharAt',
    'v2GetCharCount',
    'v2ToLowerCase',
    'v2ToUpperCase',
    'v2SetCharAt',
    'v2SplitString',
    'v2JoinArrayVar',
    'v2ConcatString',
    'v2MakeArrayVar',
    'v2GetArrayVarLength',
    'v2GetArrayVar',
    'v2SetArrayVar',
    'v2PushArrayVar',
    'v2PopArrayVar',
    'v2ShiftArrayVar',
    'v2UnshiftArrayVar',
    'v2SpliceArrayVar',
    'v2SliceArrayVar',
    'v2GetIndexOfValueInArrayVar',
    'v2RemoveIndexFromArrayVar',
    'v2Calculate',
    'v2Comment',
    'v2DeclareLocalVar',
  ];
  var DISPLAY_ALLOW = ['v2GetDisplayState', 'v2SetDisplayState'].concat(SAFE_SUBSET);
  var REQUEST_ALLOW = [
    'v2GetRequestState',
    'v2SetRequestState',
    'v2GetRequestStateRole',
    'v2SetRequestStateRole',
    'v2GetRequestStateLength',
  ].concat(SAFE_SUBSET);
  var LOW_LEVEL = [
    'showAlert',
    'sendAIprompt',
    'runLLM',
    'checkSimilarity',
    'extractRegex',
    'runImgGen',
    'v2SendAIprompt',
    'v2ImgGen',
    'v2CheckSimilarity',
    'v2RunLLM',
  ];
  var HOST_EFFECTS = Object.freeze({
    triggerlua: 'runLua',
    command: 'command',
    v2Command: 'command',
    showAlert: 'alert/alertInput/alertSelect',
    v2ShowAlert: 'alert',
    v2GetAlertInput: 'alertInput',
    v2GetAlertSelect: 'alertSelect',
    runLLM: 'runLLM',
    v2RunLLM: 'runLLM',
    checkSimilarity: 'checkSimilarity',
    v2CheckSimilarity: 'checkSimilarity',
    runImgGen: 'runImage',
    v2ImgGen: 'runImage',
    v2Tokenize: 'tokenize',
    v2UpdateGUI: 'updateGUI',
    v2UpdateChatAt: 'updateChatAt',
    v2GetCharacterDesc: 'getCharacterDescription/characterDescription',
    v2SetCharacterDesc: 'setCharacterDescription/characterDescription',
    v2GetPersonaDesc: 'getPersonaDescription/personaDescription',
    v2SetPersonaDesc: 'setPersonaDescription/personaDescription',
    v2GetReplaceGlobalNote: 'getReplaceGlobalNote/replaceGlobalNote',
    v2SetReplaceGlobalNote: 'setReplaceGlobalNote/replaceGlobalNote',
    v2GetAuthorNote: 'getAuthorNote/authorNote',
    v2SetAuthorNote: 'setAuthorNote/authorNote',
    v2ModifyLorebook: 'getLorebooks+setLorebooks/lorebooks',
    v2GetLorebook: 'getLorebooks/lorebooks',
    v2GetLorebookCount: 'getLorebooks/lorebooks',
    v2GetLorebookEntry: 'getLorebooks/lorebooks',
    v2SetLorebookActivation: 'getLorebooks+setLorebooks/lorebooks',
    v2GetLorebookIndexViaName: 'getLorebooks/lorebooks',
    v2GetAllLorebooks: 'getLorebooks/lorebooks',
    v2GetLorebookByName: 'getLorebooks/lorebooks',
    v2GetLorebookByIndex: 'getLorebooks/lorebooks',
    v2CreateLorebook: 'getLorebooks+setLorebooks/lorebooks',
    v2ModifyLorebookByIndex: 'getLorebooks+setLorebooks/lorebooks',
    v2DeleteLorebookByIndex: 'getLorebooks+setLorebooks/lorebooks',
    v2GetLorebookCountNew: 'getLorebooks/lorebooks',
    v2SetLorebookAlwaysActive: 'getLorebooks+setLorebooks/lorebooks',
    v2GetFirstMessage: 'firstMessage+alternateGreetings+greetingIndex',
    v2GetDisplayState: 'displayState/displayData',
    v2SetDisplayState: 'displayState/displayData',
    v2GetRequestState: 'requestState/displayData',
    v2SetRequestState: 'requestState/displayData',
    v2GetRequestStateRole: 'requestState/displayData',
    v2SetRequestStateRole: 'requestState/displayData',
    v2GetRequestStateLength: 'requestState/displayData',
    v2Calculate: 'getGlobalVar/globalVariables when expression contains @name',
  });
  var UPSTREAM_DECLARED_WITHOUT_EXECUTION = Object.freeze(['triggercode', 'runAxLLM']);
  var IS_NODE = typeof process === 'object' && process && process.versions && typeof process.versions.node === 'string';
  var IMPLEMENTED_EFFECTS = Object.freeze([
    'setvar',
    'systemprompt',
    'impersonate',
    'command',
    'stop',
    'runtrigger',
    'cutchat',
    'modifychat',
    'showAlert',
    'sendAIprompt',
    'runLLM',
    'checkSimilarity',
    'extractRegex',
    'runImgGen',
    'triggerlua',
    'v2Header',
    'v2SetVar',
    'v2DeclareLocalVar',
    'v2If',
    'v2IfAdvanced',
    'v2Else',
    'v2EndIndent',
    'v2Loop',
    'v2LoopNTimes',
    'v2BreakLoop',
    'v2RunTrigger',
    'v2ConsoleLog',
    'v2StopTrigger',
    'v2CutChat',
    'v2ModifyChat',
    'v2SystemPrompt',
    'v2Impersonate',
    'v2Command',
    'v2SendAIprompt',
    'v2ImgGen',
    'v2CheckSimilarity',
    'v2RunLLM',
    'v2ShowAlert',
    'v2ExtractRegex',
    'v2GetLastMessage',
    'v2GetMessageAtIndex',
    'v2GetMessageCount',
    'v2ModifyLorebook',
    'v2GetLorebook',
    'v2GetLorebookCount',
    'v2GetLorebookEntry',
    'v2SetLorebookActivation',
    'v2GetLorebookIndexViaName',
    'v2Random',
    'v2GetCharAt',
    'v2GetCharCount',
    'v2ToLowerCase',
    'v2ToUpperCase',
    'v2SetCharAt',
    'v2SplitString',
    'v2JoinArrayVar',
    'v2GetCharacterDesc',
    'v2SetCharacterDesc',
    'v2GetPersonaDesc',
    'v2SetPersonaDesc',
    'v2MakeArrayVar',
    'v2GetArrayVarLength',
    'v2GetArrayVar',
    'v2SetArrayVar',
    'v2PushArrayVar',
    'v2PopArrayVar',
    'v2ShiftArrayVar',
    'v2UnshiftArrayVar',
    'v2SpliceArrayVar',
    'v2SliceArrayVar',
    'v2GetIndexOfValueInArrayVar',
    'v2RemoveIndexFromArrayVar',
    'v2ConcatString',
    'v2GetLastUserMessage',
    'v2GetLastCharMessage',
    'v2GetFirstMessage',
    'v2GetAlertInput',
    'v2GetAlertSelect',
    'v2GetDisplayState',
    'v2SetDisplayState',
    'v2UpdateGUI',
    'v2UpdateChatAt',
    'v2Wait',
    'v2GetRequestState',
    'v2SetRequestState',
    'v2GetRequestStateRole',
    'v2SetRequestStateRole',
    'v2GetRequestStateLength',
    'v2QuickSearchChat',
    'v2StopPromptSending',
    'v2Tokenize',
    'v2GetAllLorebooks',
    'v2GetLorebookByName',
    'v2GetLorebookByIndex',
    'v2CreateLorebook',
    'v2ModifyLorebookByIndex',
    'v2DeleteLorebookByIndex',
    'v2GetLorebookCountNew',
    'v2SetLorebookAlwaysActive',
    'v2RegexTest',
    'v2GetReplaceGlobalNote',
    'v2SetReplaceGlobalNote',
    'v2GetAuthorNote',
    'v2SetAuthorNote',
    'v2MakeDictVar',
    'v2GetDictVar',
    'v2SetDictVar',
    'v2DeleteDictKey',
    'v2HasDictKey',
    'v2ClearDict',
    'v2GetDictSize',
    'v2GetDictKeys',
    'v2GetDictValues',
    'v2Calculate',
    'v2ReplaceString',
    'v2Comment',
  ]);

  function TriggerError(code, message, details) {
    this.name = 'RisuTriggerError';
    this.code = code;
    this.message = message;
    this.details = details || {};
    if (Error.captureStackTrace) Error.captureStackTrace(this, TriggerError);
  }
  TriggerError.prototype = Object.create(Error.prototype);
  TriggerError.prototype.constructor = TriggerError;

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function asString(value) {
    return value === null || value === undefined ? 'null' : String(value);
  }

  function messageText(message) {
    if (!message) return 'null';
    if (message.data !== undefined) return asString(message.data);
    if (message.content !== undefined) return asString(message.content);
    if (message.text !== undefined) return asString(message.text);
    return 'null';
  }

  function setMessageText(message, value) {
    if (message.data !== undefined || (message.content === undefined && message.text === undefined))
      message.data = value;
    else if (message.content !== undefined) message.content = value;
    else message.text = value;
  }

  function normalRole(role) {
    return role === 'assistant' ? 'char' : role;
  }

  function parseArray(value) {
    var parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new TypeError('Expected an array');
    return parsed;
  }

  function parseDict(value) {
    var parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new TypeError('Expected an object');
    return parsed;
  }

  function replaceRegexResult(format, match) {
    if (!match)
      return String(format)
        .replace(/\$[0-9]+/g, '')
        .replace(/\$&/g, '')
        .replace(/\$\$/g, '$');
    return String(format)
      .replace(/\$[0-9]+/g, function (slot) {
        return match[Number(slot.slice(1))] || '';
      })
      .replace(/\$&/g, match[0] || '')
      .replace(/\$\$/g, '$');
  }

  function calculate(expression) {
    var operators = {
      '+': [2, 'L'],
      '-': [2, 'L'],
      '*': [3, 'L'],
      '/': [3, 'L'],
      '^': [4, 'L'],
      '%': [3, 'L'],
      '<': [1, 'L'],
      '>': [1, 'L'],
      '|': [1, 'L'],
      '&': [1, 'L'],
      '≤': [1, 'L'],
      '≥': [1, 'L'],
      '=': [1, 'L'],
      '≠': [1, 'L'],
      '!': [5, 'R'],
    };

    function flat(text) {
      text = String(text)
        .replace(/\s+/g, '')
        .replace(/&&/g, '&')
        .replace(/\|\|/g, '|')
        .replace(/<=/g, '≤')
        .replace(/>=/g, '≥')
        .replace(/==/g, '=')
        .replace(/!=/g, '≠')
        .replace(/null/gi, '0');
      var tokens = [];
      var current = '';
      var keys = Object.keys(operators);
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (ch === '-' && (i === 0 || keys.indexOf(text[i - 1]) >= 0 || text[i - 1] === '(')) current += ch;
        else if (keys.indexOf(ch) >= 0) {
          tokens.push(current || '0', ch);
          current = '';
        } else current += ch;
      }
      tokens.push(current || '0');
      var output = [];
      var stack = [];
      tokens.forEach(function (token) {
        if (!Number.isNaN(parseFloat(token)) || token === '0') output.push(token);
        else if (operators[token]) {
          while (
            stack.length &&
            ((operators[token][1] === 'L' && operators[token][0] <= operators[stack[stack.length - 1]][0]) ||
              (operators[token][1] === 'R' && operators[token][0] < operators[stack[stack.length - 1]][0]))
          )
            output.push(stack.pop());
          stack.push(token);
        }
      });
      while (stack.length) output.push(stack.pop());
      var values = [];
      output.forEach(function (token) {
        if (!Number.isNaN(parseFloat(token)) || token === '0') {
          values.push(parseFloat(token));
          return;
        }
        var b = values.pop();
        var a = values.pop();
        if (token === '+') values.push(a + b);
        else if (token === '-') values.push(a - b);
        else if (token === '*') values.push(a * b);
        else if (token === '/') values.push(a / b);
        else if (token === '^') values.push(Math.pow(a, b));
        else if (token === '%') values.push(a % b);
        else if (token === '<') values.push(a < b ? 1 : 0);
        else if (token === '>') values.push(a > b ? 1 : 0);
        else if (token === '|') values.push(a || b);
        else if (token === '&') values.push(a && b);
        else if (token === '≤') values.push(a <= b ? 1 : 0);
        else if (token === '≥') values.push(a >= b ? 1 : 0);
        else if (token === '=') values.push(a === b ? 1 : 0);
        else if (token === '≠') values.push(a !== b ? 1 : 0);
        else if (token === '!') values.push(b ? 0 : 1);
      });
      return values.length ? values.pop() : 0;
    }

    var levels = [''];
    String(expression)
      .split('')
      .forEach(function (ch) {
        if (ch === '(') levels.push('');
        else if (ch === ')' && levels.length > 1) levels[levels.length - 2] += flat(levels.pop());
        else levels[levels.length - 1] += ch;
      });
    return flat(levels.join(''));
  }

  async function run(triggers, mode, context) {
    context = context || {};
    if (!Array.isArray(triggers)) throw new TriggerError('RISU_TRIGGER_INVALID_INPUT', 'triggers must be an array');
    if (MODES.indexOf(mode) < 0)
      throw new TriggerError('RISU_TRIGGER_INVALID_MODE', 'Unsupported Risu trigger mode: ' + mode, { mode: mode });
    if (typeof context.render !== 'function')
      throw new TriggerError('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host callback is missing: render', {
        callback: 'render',
      });

    var diagnostics = [];
    var maxDepth = Number(context.maxDepth || (context.limits && context.limits.maxDepth) || 10);
    var effectCount = 0;
    var transient = mode === 'display' || mode === 'request' || context.transientVariables === true;
    var transientVars = Object.assign({}, context.tempVars || {});
    var defaults = context.defaultVariables || {};
    var originalMessages = await readMessages(context);
    var state = {
      messages: clone(originalMessages),
      messagesChanged: false,
      additionalSystemPrompt: Object.assign(
        { start: '', historyend: '', promptend: '' },
        context.additionalSystemPrompt || context.additonalSysPrompt || {}
      ),
      sendAIprompt: Boolean(context.sendAIprompt),
      stopSending: Boolean(context.stopSending),
      displayState:
        context.displayState === undefined
          ? mode === 'display' && context.displayData !== undefined
            ? context.displayData
            : null
          : context.displayState,
      requestState: clone(readRequestState(context, mode)),
      variablesChanged: false,
      lorebooks: null,
      lorebooksChanged: false,
      executedTriggers: 0,
    };

    async function diagnostic(code, message, details) {
      var row = Object.assign({ code: code, message: message, mode: mode }, details || {});
      diagnostics.push(row);
      if (typeof context.diagnostic === 'function') await context.diagnostic(row);
      return row;
    }

    async function fail(code, message, details) {
      var row = await diagnostic(code, message, details);
      throw new TriggerError(code, message, row);
    }

    async function host(name, effect) {
      if (typeof context[name] === 'function') return context[name];
      return fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host callback is missing: ' + name, {
        callback: name,
        effectType: effect && effect.type,
      });
    }

    async function render(value, meta) {
      return asString(await context.render(asString(value), meta || {}));
    }

    function nativeRegexAllowed() {
      return IS_NODE || context.allowNativeRegex === true;
    }

    async function regexMatch(input, pattern, flags, meta) {
      if (typeof context.regexMatch === 'function') {
        var result = await context.regexMatch(asString(input), asString(pattern), asString(flags || ''), meta || {});
        if (result && !Array.isArray(result) && Object.prototype.hasOwnProperty.call(result, 'matched'))
          return result.matched ? result.values : null;
        return result;
      }
      if (nativeRegexAllowed()) return new RegExp(asString(pattern), asString(flags || '')).exec(asString(input));
      return fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger browser host callback is missing: regexMatch', {
        callback: 'regexMatch',
        effectType: meta && meta.effect && meta.effect.type,
      });
    }

    async function regexTest(input, pattern, flags, meta) {
      if (typeof context.regexTest === 'function')
        return Boolean(await context.regexTest(asString(input), asString(pattern), asString(flags || ''), meta || {}));
      if (nativeRegexAllowed()) return new RegExp(asString(pattern), asString(flags || '')).test(asString(input));
      return fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger browser host callback is missing: regexTest', {
        callback: 'regexTest',
        effectType: meta && meta.effect && meta.effect.type,
      });
    }

    async function regexSplit(input, pattern, flags, meta) {
      if (typeof context.regexSplit === 'function')
        return context.regexSplit(asString(input), asString(pattern), asString(flags || ''), meta || {});
      if (nativeRegexAllowed()) return asString(input).split(new RegExp(asString(pattern), asString(flags || '')));
      return fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger browser host callback is missing: regexSplit', {
        callback: 'regexSplit',
        effectType: meta && meta.effect && meta.effect.type,
      });
    }

    async function regexReplace(input, pattern, flags, specification, meta) {
      if (typeof context.regexReplace === 'function')
        return context.regexReplace(
          asString(input),
          asString(pattern),
          asString(flags || ''),
          specification,
          meta || {}
        );
      if (!nativeRegexAllowed())
        return fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger browser host callback is missing: regexReplace', {
          callback: 'regexReplace',
          effectType: meta && meta.effect && meta.effect.type,
        });
      var regex = new RegExp(asString(pattern), asString(flags || ''));
      return asString(input).replace(regex, function () {
        var args = Array.prototype.slice.call(arguments);
        var matchText = args[0];
        var groups = args.slice(1, -2);
        var resultFormat = asString(specification.resultFormat);
        var replacement = asString(specification.replacement);
        var targetGroup = resultFormat.match(/^\$(\d+)$/);
        if (targetGroup) {
          var targetIndex = Number(targetGroup[1]);
          if (targetIndex === 0) return replacement;
          if (groups[targetIndex - 1]) return matchText.replace(groups[targetIndex - 1], replacement);
        }
        return resultFormat
          .replace(/\$[0-9]+/g, function (slot) {
            var slotIndex = Number(slot.slice(1));
            return slotIndex === 0 ? matchText : groups[slotIndex - 1] || '';
          })
          .replace(/\$&/g, matchText)
          .replace(/\$\$/g, '$');
      });
    }

    async function readPersistentVar(key) {
      var value;
      if (typeof context.getVar === 'function') value = await context.getVar(key);
      else if (context.variables && Object.prototype.hasOwnProperty.call(context.variables, key))
        value = context.variables[key];
      if (value === undefined || value === null) {
        if (defaults instanceof Map && defaults.has(key)) value = defaults.get(key);
        else if (Array.isArray(defaults)) {
          var pair = defaults.find(function (row) {
            return row && row[0] === key;
          });
          if (pair) value = pair[1];
        } else if (defaults && Object.prototype.hasOwnProperty.call(defaults, key)) value = defaults[key];
      }
      if (
        (value === undefined || value === null) &&
        transient &&
        Object.prototype.hasOwnProperty.call(transientVars, key)
      )
        value = transientVars[key];
      return asString(value);
    }

    async function writePersistentVar(key, value, effect) {
      value = asString(value);
      if (transient) {
        transientVars[key] = value;
        return;
      }
      if (typeof context.setVar === 'function') await context.setVar(key, value);
      else if (context.variables && typeof context.variables === 'object') context.variables[key] = value;
      else
        await fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot persist variables', {
          callback: 'setVar',
          variable: key,
          effectType: effect && effect.type,
        });
      state.variablesChanged = true;
    }

    async function lowLevelAllowed(trigger) {
      if (typeof context.hasLowLevelAccess === 'function') return Boolean(await context.hasLowLevelAccess(trigger));
      if (typeof trigger.lowLevelAccess === 'boolean') return trigger.lowLevelAccess;
      return Boolean(context.lowLevelAccess);
    }

    async function executeRun(runMode, manualName, depth) {
      var localScopes = [{}];
      var currentIndent = 0;
      var recursion = { count: depth };

      function localGet(key) {
        var scope = localScopes[localScopes.length - 1];
        for (var indent = currentIndent; indent >= 0; indent--)
          if (scope[indent] && scope[indent][key] !== undefined) return scope[indent][key];
        return null;
      }

      function localSet(key, value, indent) {
        var scope = localScopes[localScopes.length - 1];
        var target = indent;
        for (var i = indent; i >= 0; i--)
          if (scope[i] && scope[i][key] !== undefined) {
            target = i;
            break;
          }
        if (!scope[target]) scope[target] = {};
        scope[target][key] = asString(value);
      }

      function localDeclare(key, value, indent) {
        localSet(key, value, indent);
      }

      function localSnapshot() {
        var scope = localScopes[localScopes.length - 1];
        var result = {};
        for (var indent = 0; indent <= currentIndent; indent++) if (scope[indent]) Object.assign(result, scope[indent]);
        return result;
      }

      function localClear(indent) {
        var scope = localScopes[localScopes.length - 1];
        Object.keys(scope).forEach(function (key) {
          if (Number(key) >= indent) delete scope[key];
        });
      }

      async function getVar(key) {
        key = asString(key);
        var local = localGet(key);
        return local === null ? readPersistentVar(key) : local;
      }

      async function setVar(key, value, effect) {
        key = asString(key);
        if (localGet(key) !== null) localSet(key, value, currentIndent);
        else await writePersistentVar(key, value, effect);
      }

      async function renderedValue(effect, field, typeField) {
        var raw = await render(effect[field], { effect: effect, field: field, mode: runMode });
        return effect[typeField] === 'var' ? getVar(raw) : raw;
      }

      async function effectVarName(effect, field) {
        return render(effect[field], { effect: effect, field: field, mode: runMode });
      }

      async function conditionPass(condition, trigger) {
        if (!condition || typeof condition !== 'object')
          return fail('RISU_TRIGGER_INVALID_CONDITION', 'Invalid Risu trigger condition', { condition: condition });
        if (condition.type === 'var' || condition.type === 'chatindex' || condition.type === 'value') {
          var source =
            condition.type === 'var'
              ? await getVar(condition.var)
              : condition.type === 'chatindex'
                ? String(state.messages.length)
                : asString(condition.var);
          source = await render(source, { condition: condition, trigger: trigger, mode: runMode });
          var target = await render(condition.value, { condition: condition, trigger: trigger, mode: runMode });
          if (condition.operator === 'true') return source === 'true' || source === '1';
          if (condition.operator === '=') return source === target;
          if (condition.operator === '!=') return source !== target;
          // Upstream starts from pass and only vetoes (triggers.ts:1250-1303), so a NaN side, such as an
          // unset variable read as 'null', leaves a numeric comparison passing.
          if (condition.operator === '>') return !(Number(source) <= Number(target));
          if (condition.operator === '<') return !(Number(source) >= Number(target));
          if (condition.operator === '>=') return !(Number(source) < Number(target));
          if (condition.operator === '<=') return !(Number(source) > Number(target));
          if (condition.operator === 'null') return source === 'null';
          // An operator no upstream case matches never vetoes either.
          await diagnostic(
            'RISU_TRIGGER_UNKNOWN_CONDITION_OPERATOR',
            'Unknown Risu condition operator: ' + condition.operator,
            { condition: condition }
          );
          return true;
        }
        if (condition.type === 'exists') {
          var needle = await render(condition.value, { condition: condition, trigger: trigger, mode: runMode });
          needle = await render(needle, { condition: condition, trigger: trigger, mode: runMode });
          var depth = Number(condition.depth);
          var haystack = state.messages
            .slice(0 - depth)
            .map(messageText)
            .join(' ');
          if (condition.type2 === 'strict') return haystack.split(' ').indexOf(needle) >= 0;
          if (condition.type2 === 'loose') return haystack.toLowerCase().indexOf(needle.toLowerCase()) >= 0;
          if (condition.type2 === 'regex')
            return regexTest(haystack, needle, '', { condition: condition, trigger: trigger, mode: runMode });
          return fail('RISU_TRIGGER_UNKNOWN_EXISTS_MODE', 'Unknown Risu exists condition mode: ' + condition.type2, {
            condition: condition,
          });
        }
        return fail('RISU_TRIGGER_UNKNOWN_CONDITION', 'Unknown Risu trigger condition: ' + condition.type, {
          condition: condition,
        });
      }

      for (var triggerIndex = 0; triggerIndex < triggers.length; triggerIndex++) {
        var trigger = triggers[triggerIndex];
        if (!trigger || !Array.isArray(trigger.effect))
          await fail('RISU_TRIGGER_INVALID_TRIGGER', 'Invalid Risu trigger at index ' + triggerIndex, {
            triggerIndex: triggerIndex,
          });
        var firstType = trigger.effect[0] && trigger.effect[0].type;
        var scriptedEveryMode = firstType === 'triggerlua' || firstType === 'triggercode';
        if (!scriptedEveryMode) {
          if (manualName !== undefined && manualName !== null) {
            if (trigger.comment !== manualName) continue;
          } else if (trigger.type !== runMode) continue;
        }

        var pass = true;
        var conditions = Array.isArray(trigger.conditions) ? trigger.conditions : [];
        for (var conditionIndex = 0; conditionIndex < conditions.length; conditionIndex++) {
          if (!(await conditionPass(conditions[conditionIndex], trigger))) {
            pass = false;
            break;
          }
        }
        if (!pass) continue;
        state.executedTriggers++;
        var loopCounters = {};

        for (var index = 0; index < trigger.effect.length; index++) {
          var effect = trigger.effect[index];
          if (!effect || typeof effect.type !== 'string')
            await fail('RISU_TRIGGER_INVALID_EFFECT', 'Invalid Risu trigger effect', {
              triggerIndex: triggerIndex,
              effectIndex: index,
            });
          effectCount++;
          if (effectCount % 100 === 0) {
            if (typeof context.yieldControl === 'function') await context.yieldControl();
            else
              await new Promise(function (resolve) {
                setTimeout(resolve, 0);
              });
          }
          if (context.signal && context.signal.aborted)
            await fail('RISU_TRIGGER_ABORTED', 'Risu trigger execution was aborted', {
              triggerIndex: triggerIndex,
              effectIndex: index,
            });
          if (runMode === 'display' && DISPLAY_ALLOW.indexOf(effect.type) < 0) {
            await diagnostic('RISU_TRIGGER_EFFECT_SKIPPED_MODE', 'Effect is not allowed in display mode', {
              effectType: effect.type,
              triggerIndex: triggerIndex,
              effectIndex: index,
            });
            continue;
          }
          if (runMode === 'request' && REQUEST_ALLOW.indexOf(effect.type) < 0) {
            await diagnostic('RISU_TRIGGER_EFFECT_SKIPPED_MODE', 'Effect is not allowed in request mode', {
              effectType: effect.type,
              triggerIndex: triggerIndex,
              effectIndex: index,
            });
            continue;
          }
          if (typeof effect.indent === 'number' && effect.indent >= 0) currentIndent = effect.indent;
          else if (!Object.prototype.hasOwnProperty.call(effect, 'indent')) currentIndent = 0;
          if (LOW_LEVEL.indexOf(effect.type) >= 0 && !(await lowLevelAllowed(trigger))) {
            await diagnostic('RISU_TRIGGER_EFFECT_SKIPPED_LOW_LEVEL', 'Effect requires low-level access', {
              effectType: effect.type,
              triggerIndex: triggerIndex,
              effectIndex: index,
            });
            continue;
          }

          var action = await executeEffect({
            effect: effect,
            trigger: trigger,
            triggerIndex: triggerIndex,
            effectIndex: index,
            index: index,
            effects: trigger.effect,
            runMode: runMode,
            manualName: manualName,
            depth: depth,
            recursion: recursion,
            maxDepth: maxDepth,
            getVar: getVar,
            setVar: setVar,
            render: render,
            renderedValue: renderedValue,
            effectVarName: effectVarName,
            localDeclare: localDeclare,
            localClear: localClear,
            localVariables: localSnapshot,
            loopCounters: loopCounters,
            diagnostic: diagnostic,
            fail: fail,
            host: host,
            regexMatch: regexMatch,
            regexTest: regexTest,
            regexSplit: regexSplit,
            regexReplace: regexReplace,
            executeRun: executeRun,
            lowLevelAllowed: lowLevelAllowed,
            state: state,
            context: context,
          });
          if (action && action.stopTrigger) break;
          if (action && action.stopRun) return;
          if (action && typeof action.index === 'number') index = action.index;
        }
      }
    }

    await executeRun(mode, context.manualName, Number(context.recursiveCount || 0));
    await flushState(context, state, originalMessages, diagnostics);
    return {
      messages: state.messages,
      chat: { message: state.messages },
      additionalSystemPrompt: state.additionalSystemPrompt,
      additonalSysPrompt: state.additionalSystemPrompt,
      sendAIprompt: state.sendAIprompt,
      stopSending: state.stopSending,
      displayState: state.displayState,
      displayData: mode === 'request' ? JSON.stringify(state.requestState) : state.displayState,
      requestState: state.requestState,
      tempVars: transientVars,
      diagnostics: diagnostics,
      executedTriggers: state.executedTriggers,
      variablesChanged: state.variablesChanged,
      effectCount: effectCount,
    };
  }

  async function readMessages(context) {
    var value;
    if (typeof context.getMessages === 'function') value = await context.getMessages();
    else if (context.messages && typeof context.messages.get === 'function') value = await context.messages.get();
    else if (Array.isArray(context.messages)) value = context.messages;
    else if (context.chat && Array.isArray(context.chat.message)) value = context.chat.message;
    else
      throw new TriggerError('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot read messages', {
        callback: 'getMessages',
      });
    if (!Array.isArray(value))
      throw new TriggerError('RISU_TRIGGER_INVALID_MESSAGES', 'Risu trigger messages must be an array');
    return value;
  }

  function readRequestState(context, mode) {
    if (context.requestState !== undefined) return context.requestState;
    if (mode === 'request' && context.displayData !== undefined) {
      if (Array.isArray(context.displayData)) return context.displayData;
      try {
        return JSON.parse(context.displayData);
      } catch (_) {
        throw new TriggerError('RISU_TRIGGER_INVALID_REQUEST_STATE', 'request displayData must contain a JSON array');
      }
    }
    if (mode === 'request')
      throw new TriggerError('RISU_TRIGGER_HOST_MISSING', 'Risu request trigger host did not provide requestState', {
        callback: 'requestState',
      });
    return [];
  }

  async function flushState(context, state, originalMessages, diagnostics) {
    if (state.messagesChanged) {
      if (typeof context.setMessages === 'function') await context.setMessages(state.messages);
      else if (context.messages && typeof context.messages.set === 'function')
        await context.messages.set(state.messages);
      else if (Array.isArray(context.messages))
        context.messages.splice.apply(context.messages, [0, context.messages.length].concat(state.messages));
      else if (context.chat && Array.isArray(context.chat.message)) context.chat.message = state.messages;
      else
        diagnostics.push({
          code: 'RISU_TRIGGER_MESSAGES_RETURN_ONLY',
          message: 'Messages changed and are returned to the caller',
        });
    }
    if (state.lorebooksChanged) {
      if (typeof context.setLorebooks === 'function') await context.setLorebooks(state.lorebooks);
      else if (Array.isArray(context.lorebooks))
        context.lorebooks.splice.apply(context.lorebooks, [0, context.lorebooks.length].concat(state.lorebooks));
      else
        throw new TriggerError('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot persist lorebooks', {
          callback: 'setLorebooks',
        });
    }
  }

  async function executeEffect(x) {
    var e = x.effect;
    var state = x.state;
    var context = x.context;
    var getVar = x.getVar;
    var setVar = x.setVar;
    var render = x.render;
    var value = x.renderedValue;
    var varName = x.effectVarName;
    var regexMatch = x.regexMatch;
    var regexTest = x.regexTest;
    var regexSplit = x.regexSplit;
    var regexReplace = x.regexReplace;

    async function output(name, val) {
      return setVar(await varName(e, name || 'outputVar'), val, e);
    }

    async function numeric(field, typeField, fallback) {
      var number = Number(await value(e, field, typeField));
      return Number.isNaN(number) ? fallback : number;
    }

    async function setArithmetic() {
      var key = await varName(e, 'var');
      var incoming = await value(e, 'value', 'valueType');
      var original = Number(await getVar(key));
      if (Number.isNaN(original)) original = 0;
      var result = incoming;
      if (e.operator === '+=') result = String(original + Number(incoming));
      else if (e.operator === '-=') result = String(original - Number(incoming));
      else if (e.operator === '*=') result = String(original * Number(incoming));
      else if (e.operator === '/=') result = String(original / Number(incoming));
      else if (e.operator === '%=') result = String(original % Number(incoming));
      else if (e.operator !== '=')
        return x.fail('RISU_TRIGGER_UNKNOWN_ASSIGNMENT', 'Unknown Risu assignment operator: ' + e.operator, {
          effectType: e.type,
        });
      await setVar(key, result, e);
    }

    async function lorebooks() {
      if (state.lorebooks) return state.lorebooks;
      var books;
      if (typeof context.getLorebooks === 'function') books = await context.getLorebooks();
      else if (Array.isArray(context.lorebooks)) books = context.lorebooks;
      else
        return x.fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot read lorebooks', {
          callback: 'getLorebooks',
        });
      if (!Array.isArray(books))
        return x.fail('RISU_TRIGGER_INVALID_LOREBOOKS', 'Risu trigger lorebooks must be an array');
      state.lorebooks = clone(books);
      return state.lorebooks;
    }

    function markLorebooks() {
      state.lorebooksChanged = true;
    }

    async function propertyGet(property, getter) {
      if (typeof context[getter] === 'function') return asString(await context[getter]());
      if (Object.prototype.hasOwnProperty.call(context, property)) return asString(context[property]);
      return x.fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot read ' + property, { callback: getter });
    }

    async function propertySet(property, setter, val) {
      if (typeof context[setter] === 'function') await context[setter](val);
      else if (Object.prototype.hasOwnProperty.call(context, property)) context[property] = val;
      else
        return x.fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot persist ' + property, {
          callback: setter,
        });
    }

    async function makeMessage(role, text) {
      if (typeof context.createMessage === 'function') return context.createMessage(role, text);
      return { role: role, data: text };
    }

    if (e.type === 'setvar' || e.type === 'v2SetVar') {
      await setArithmetic();
      return;
    }
    if (e.type === 'v2DeclareLocalVar') {
      x.localDeclare(await varName(e, 'var'), await value(e, 'value', 'valueType'), e.indent);
      return;
    }
    if (e.type === 'systemprompt' || e.type === 'v2SystemPrompt') {
      if (!Object.prototype.hasOwnProperty.call(state.additionalSystemPrompt, e.location))
        return x.fail('RISU_TRIGGER_INVALID_PROMPT_LOCATION', 'Invalid system prompt location: ' + e.location, {
          effect: e,
        });
      state.additionalSystemPrompt[e.location] += (await value(e, 'value', 'valueType')) + '\n\n';
      return;
    }
    if (e.type === 'impersonate' || e.type === 'v2Impersonate') {
      if (e.role !== 'user' && e.role !== 'char')
        return x.fail('RISU_TRIGGER_INVALID_ROLE', 'Invalid impersonate role: ' + e.role, { effect: e });
      state.messages.push(await makeMessage(e.role, await value(e, 'value', 'valueType')));
      state.messagesChanged = true;
      return;
    }
    if (e.type === 'command' || e.type === 'v2Command') {
      var command = await x.host('command', e);
      var commandResult = await command(await value(e, 'value', 'valueType'), {
        mode: x.runMode,
        effect: e,
        getMessages: function () {
          return state.messages;
        },
        setMessages: function (rows) {
          state.messages = rows;
          state.messagesChanged = true;
        },
        getVar: getVar,
        setVar: setVar,
        render: render,
        runTrigger: async function (name) {
          await x.executeRun('manual', name, x.depth + 1);
          return { messages: state.messages, sendAIprompt: state.sendAIprompt, stopSending: state.stopSending };
        },
      });
      if (commandResult && Array.isArray(commandResult.messages)) state.messages = commandResult.messages;
      if (commandResult && commandResult.sendAIprompt) state.sendAIprompt = true;
      if (commandResult && commandResult.stopSending) state.stopSending = true;
      return;
    }
    if (e.type === 'stop' || e.type === 'v2StopPromptSending') {
      state.stopSending = true;
      return;
    }
    if (e.type === 'runtrigger' || e.type === 'v2RunTrigger') {
      var recursionAllowed = await x.lowLevelAllowed(x.trigger);
      if (x.recursion.count >= x.maxDepth && !recursionAllowed) {
        await x.diagnostic('RISU_TRIGGER_RECURSION_SKIPPED', 'Risu trigger recursion limit reached', {
          depth: x.recursion.count,
          maxDepth: x.maxDepth,
          effectType: e.type,
        });
        return;
      }
      x.recursion.count++;
      await x.executeRun('manual', e.type === 'runtrigger' ? e.value : e.target, x.recursion.count);
      return;
    }
    if (e.type === 'cutchat' || e.type === 'v2CutChat') {
      var start = await numeric('start', 'startType', 0);
      var end = await numeric('end', 'endType', state.messages.length);
      state.messages = state.messages.slice(start, end);
      state.messagesChanged = true;
      return;
    }
    if (e.type === 'modifychat' || e.type === 'v2ModifyChat') {
      var messageIndex = await numeric('index', 'indexType', NaN);
      if (state.messages[messageIndex]) {
        setMessageText(state.messages[messageIndex], await value(e, 'value', 'valueType'));
        state.messagesChanged = true;
      }
      return;
    }
    if (e.type === 'sendAIprompt' || e.type === 'v2SendAIprompt') {
      state.sendAIprompt = true;
      return;
    }
    if (e.type === 'showAlert') {
      var alertText = await render(e.value, { effect: e, field: 'value', mode: x.runMode });
      if (e.alertType === 'input') {
        var input = await x.host('alertInput', e);
        await setVar(await varName(e, 'inputVar'), await input(alertText), e);
      } else if (e.alertType === 'select') {
        var select = await x.host('alertSelect', e);
        await setVar(await varName(e, 'inputVar'), await select(alertText.split('§')), e);
      } else {
        var alert = await x.host('alert', e);
        await alert(alertText, e.alertType === 'error' ? 'error' : 'normal');
      }
      return;
    }
    if (e.type === 'v2ShowAlert') {
      var show = await x.host('alert', e);
      await show(await value(e, 'value', 'valueType'), 'normal');
      return;
    }
    if (e.type === 'v2GetAlertInput') {
      var getInput = await x.host('alertInput', e);
      await output('outputVar', await getInput(await value(e, 'display', 'displayType')));
      return;
    }
    if (e.type === 'v2GetAlertSelect') {
      var getSelect = await x.host('alertSelect', e);
      var options = (await value(e, 'value', 'valueType')).split('|');
      await output('outputVar', await getSelect(options, await value(e, 'display', 'displayType')));
      return;
    }
    if (e.type === 'runLLM' || e.type === 'v2RunLLM') {
      var llm = await x.host('runLLM', e);
      try {
        var llmResult = await llm(await value(e, 'value', 'valueType'), {
          model: e.model || 'model',
          streaming: Boolean(e.streaming),
          mode: x.runMode,
        });
        await setVar(await varName(e, e.type === 'runLLM' ? 'inputVar' : 'outputVar'), asString(llmResult), e);
      } catch (error) {
        if (e.type === 'runLLM') await setVar(await varName(e, 'inputVar'), 'Error: ' + error.message, e);
        else await output('outputVar', 'null');
      }
      return;
    }
    if (e.type === 'checkSimilarity' || e.type === 'v2CheckSimilarity') {
      var similarity = await x.host('checkSimilarity', e);
      var similarityResult = await similarity(
        await value(e, 'source', 'sourceType'),
        (await value(e, 'value', 'valueType')).split('§')
      );
      await setVar(
        await varName(e, e.type === 'checkSimilarity' ? 'inputVar' : 'outputVar'),
        Array.isArray(similarityResult) ? similarityResult.join('§') : asString(similarityResult),
        e
      );
      return;
    }
    if (e.type === 'runImgGen' || e.type === 'v2ImgGen') {
      var image = await x.host('runImage', e);
      var imageResult = await image(await value(e, 'value', 'valueType'), await value(e, 'negValue', 'negValueType'), {
        mode: x.runMode,
      });
      var imageValue = imageResult
        ? String(imageResult).indexOf('{{inlay::') === 0
          ? String(imageResult)
          : '{{inlay::' + imageResult + '}}'
        : e.type === 'runImgGen'
          ? 'Error: Image generation failed'
          : 'null';
      await setVar(await varName(e, e.type === 'runImgGen' ? 'inputVar' : 'outputVar'), imageValue, e);
      return;
    }
    if (e.type === 'extractRegex' || e.type === 'v2ExtractRegex') {
      var regexInput = await value(e, 'value', 'valueType');
      var pattern = e.type === 'extractRegex' ? e.regex : await value(e, 'regex', 'regexType');
      var flags = e.type === 'extractRegex' ? e.flags : await value(e, 'flags', 'flagsType');
      var format = e.type === 'extractRegex' ? e.result : await value(e, 'result', 'resultType');
      var match = await regexMatch(regexInput, pattern, flags, { effect: e, mode: x.runMode });
      if (e.type === 'extractRegex' && !match)
        return x.fail('RISU_TRIGGER_REGEX_NO_MATCH', 'V1 extractRegex expected a match', { effect: e });
      await setVar(
        await varName(e, e.type === 'extractRegex' ? 'inputVar' : 'outputVar'),
        replaceRegexResult(format, match),
        e
      );
      return;
    }
    if (e.type === 'triggerlua') {
      var runLua = await x.host('runLua', e);
      var luaExtra = {
        mode: x.runMode === 'manual' ? x.manualName : x.runMode,
        getVar: getVar,
        setVar: function (key, val) {
          return setVar(key, val, e);
        },
        messages: state.messages,
        lowLevelAccess: await x.lowLevelAllowed(x.trigger),
        localVariables: x.localVariables(),
      };
      var luaResult = await runLua(e.code || '', luaExtra.mode, luaExtra);
      if (luaResult && Array.isArray(luaResult.messages)) {
        state.messages = clone(luaResult.messages);
        state.messagesChanged = true;
      } else if (luaResult && luaResult.chat && Array.isArray(luaResult.chat.message)) {
        state.messages = clone(luaResult.chat.message);
        state.messagesChanged = true;
      }
      if (luaResult && luaResult.stopSending) state.stopSending = true;
      if (luaResult && luaResult.sendAIprompt) state.sendAIprompt = true;
      return;
    }
    if (e.type === 'triggercode' || e.type === 'runAxLLM')
      return x.fail(
        'RISU_TRIGGER_UPSTREAM_UNIMPLEMENTED',
        'Effect is declared but not executed by RisuAI v2026.10.211: ' + e.type,
        {
          effectType: e.type,
        }
      );
    if (e.type === 'v2Header' || e.type === 'v2Loop' || e.type === 'v2LoopNTimes' || e.type === 'v2Comment') return;
    if (e.type === 'v2If' || e.type === 'v2IfAdvanced') {
      var source =
        e.type === 'v2If' || e.sourceType === 'var'
          ? await getVar(await varName(e, 'source'))
          : await value(e, 'source', 'sourceType');
      var target = await value(e, 'target', 'targetType');
      var passed = compare(source, target, e.condition);
      if (!passed) {
        var ifIndent = e.indent + 1;
        for (var i = x.index; i < x.effects.length; i++) {
          var ifEffect = x.effects[i];
          if (ifEffect.type === 'v2EndIndent' && ifEffect.indent === ifIndent) {
            var next = x.effects[i + 1];
            if (next && next.type === 'v2Else' && next.indent === e.indent) i++;
            return { index: i };
          }
        }
        return { index: x.effects.length };
      }
      return;
    }
    if (e.type === 'v2Else') {
      var elseIndent = e.indent + 1;
      for (var j = x.index; j < x.effects.length; j++)
        if (x.effects[j].type === 'v2EndIndent' && x.effects[j].indent === elseIndent) return { index: j };
      return { index: x.effects.length };
    }
    if (e.type === 'v2EndIndent') {
      var nextIndex = x.index;
      if (e.endOfLoop) {
        var loopIndent = e.indent - 1;
        for (var k = x.index; k >= 0; k--) {
          var loop = x.effects[k];
          if ((loop.type === 'v2Loop' || loop.type === 'v2LoopNTimes') && loop.indent === loopIndent) {
            nextIndex = k;
            if (loop.type === 'v2LoopNTimes') {
              var count = Number(await value(loop, 'value', 'valueType'));
              if (Number.isNaN(count)) count = 0;
              var counterKey = k + 'LoopNTimes';
              x.loopCounters[counterKey] = (x.loopCounters[counterKey] || 0) + 1;
              if (x.loopCounters[counterKey] >= count) nextIndex = x.index;
            }
            break;
          }
        }
      }
      x.localClear(e.indent);
      return nextIndex === x.index ? undefined : { index: nextIndex };
    }
    if (e.type === 'v2BreakLoop') {
      for (var breakIndex = x.index; breakIndex < x.effects.length; breakIndex++)
        if (x.effects[breakIndex].type === 'v2EndIndent' && x.effects[breakIndex].endOfLoop)
          return { index: breakIndex };
      return { index: x.effects.length };
    }
    if (e.type === 'v2StopTrigger') return { stopTrigger: true };
    if (e.type === 'v2ConsoleLog') {
      var logValue = await value(e, 'source', 'sourceType');
      if (typeof context.consoleLog === 'function') await context.consoleLog(logValue);
      else if (typeof console !== 'undefined' && console.log) console.log(logValue);
      return;
    }
    if (e.type === 'v2Random') {
      var min = await numeric('min', 'minType', NaN);
      var max = await numeric('max', 'maxType', NaN);
      var random = typeof context.random === 'function' ? Number(await context.random()) : Math.random();
      await output('outputVar', String(Math.floor(random * (max - min + 1) + min)));
      return;
    }
    if (e.type === 'v2GetCharAt') {
      var charSource = await value(e, 'source', 'sourceType');
      await output('outputVar', charSource[await numeric('index', 'indexType', NaN)] || 'null');
      return;
    }
    if (e.type === 'v2GetCharCount') {
      await output('outputVar', String((await value(e, 'source', 'sourceType')).length));
      return;
    }
    if (e.type === 'v2ToLowerCase' || e.type === 'v2ToUpperCase') {
      var caseSource = await value(e, 'source', 'sourceType');
      await output('outputVar', e.type === 'v2ToLowerCase' ? caseSource.toLowerCase() : caseSource.toUpperCase());
      return;
    }
    if (e.type === 'v2SetCharAt') {
      var chars = Array.from(await value(e, 'source', 'sourceType'));
      chars[await numeric('index', 'indexType', NaN)] = await value(e, 'value', 'valueType');
      await output('outputVar', chars.join(''));
      return;
    }
    if (e.type === 'v2SplitString') {
      var splitSource = await value(e, 'source', 'sourceType');
      var delimiter = await value(e, 'delimiter', 'delimiterType');
      if (e.delimiterType === 'regex') {
        try {
          var regexParts = delimiter.match(/^\/(.+)\/([gimuy]*)$/);
          var splitPattern = regexParts ? regexParts[1] : delimiter;
          var splitFlags = regexParts ? regexParts[2] : '';
          await output(
            'outputVar',
            JSON.stringify(await regexSplit(splitSource, splitPattern, splitFlags, { effect: e, mode: x.runMode }))
          );
          return;
        } catch (error) {
          if (error && error.code === 'RISU_TRIGGER_HOST_MISSING') throw error;
          await output('outputVar', JSON.stringify([splitSource]));
          return;
        }
      }
      await output('outputVar', JSON.stringify(splitSource.split(delimiter)));
      return;
    }
    if (e.type === 'v2JoinArrayVar') {
      try {
        await output(
          'outputVar',
          parseArray(await value(e, 'var', 'varType')).join(await value(e, 'delimiter', 'delimiterType'))
        );
      } catch (_) {
        await output('outputVar', '');
      }
      return;
    }
    if (e.type === 'v2ConcatString') {
      await output(
        'outputVar',
        (await value(e, 'source1', 'source1Type')) + (await value(e, 'source2', 'source2Type'))
      );
      return;
    }
    if (e.type === 'v2GetLastMessage') {
      await output('outputVar', messageText(state.messages[state.messages.length - 1]));
      return;
    }
    if (e.type === 'v2GetMessageAtIndex') {
      await output('outputVar', messageText(state.messages[await numeric('index', 'indexType', NaN)]));
      return;
    }
    if (e.type === 'v2GetMessageCount') {
      await output('outputVar', String(state.messages.length));
      return;
    }
    if (e.type === 'v2GetLastUserMessage' || e.type === 'v2GetLastCharMessage') {
      var wanted = e.type === 'v2GetLastUserMessage' ? 'user' : 'char';
      var found = state.messages
        .slice()
        .reverse()
        .find(function (row) {
          return normalRole(row.role) === wanted;
        });
      await output('outputVar', messageText(found));
      return;
    }
    if (e.type === 'v2GetFirstMessage') {
      var greetingIndex = Number(context.greetingIndex === undefined ? -1 : context.greetingIndex);
      var greeting = greetingIndex === -1 ? context.firstMessage : (context.alternateGreetings || [])[greetingIndex];
      if (greeting === undefined)
        return x.fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot read the first message', {
          callback: 'firstMessage',
        });
      await output('outputVar', greeting);
      return;
    }
    if (e.type === 'v2GetCharacterDesc') {
      await output('outputVar', await propertyGet('characterDescription', 'getCharacterDescription'));
      return;
    }
    if (e.type === 'v2SetCharacterDesc') {
      await propertySet('characterDescription', 'setCharacterDescription', await value(e, 'value', 'valueType'));
      return;
    }
    if (e.type === 'v2GetPersonaDesc') {
      await output('outputVar', await propertyGet('personaDescription', 'getPersonaDescription'));
      return;
    }
    if (e.type === 'v2SetPersonaDesc') {
      await propertySet('personaDescription', 'setPersonaDescription', await value(e, 'value', 'valueType'));
      return;
    }
    if (e.type === 'v2GetReplaceGlobalNote') {
      await output('outputVar', await propertyGet('replaceGlobalNote', 'getReplaceGlobalNote'));
      return;
    }
    if (e.type === 'v2SetReplaceGlobalNote') {
      await propertySet('replaceGlobalNote', 'setReplaceGlobalNote', await value(e, 'value', 'valueType'));
      return;
    }
    if (e.type === 'v2GetAuthorNote') {
      await output('outputVar', await propertyGet('authorNote', 'getAuthorNote'));
      return;
    }
    if (e.type === 'v2SetAuthorNote') {
      await propertySet('authorNote', 'setAuthorNote', await value(e, 'value', 'valueType'));
      return;
    }
    if (e.type === 'v2MakeArrayVar' && String(e.var).startsWith('[') && String(e.var).endsWith(']'))
      return { stopRun: true };
    if (e.type.indexOf('ArrayVar') >= 0 || e.type === 'v2MakeArrayVar') {
      await arrayEffect(e, x, output, value, varName, getVar, setVar, numeric);
      return;
    }
    if (
      (e.type === 'v2MakeDictVar' || e.type === 'v2ClearDict') &&
      String(e.var).startsWith('{') &&
      String(e.var).endsWith('}')
    )
      return { stopRun: true };
    if (e.type.indexOf('Dict') >= 0) {
      await dictEffect(e, x, output, value, varName, getVar, setVar);
      return;
    }
    if (e.type === 'v2GetDisplayState') {
      if (x.runMode !== 'display') return { stopRun: true };
      await output('outputVar', state.displayState);
      return;
    }
    if (e.type === 'v2SetDisplayState') {
      if (x.runMode !== 'display') return { stopRun: true };
      state.displayState = await value(e, 'value', 'valueType');
      return;
    }
    if (e.type.indexOf('v2GetRequestState') === 0 || e.type.indexOf('v2SetRequestState') === 0) {
      if (x.runMode !== 'request') return { stopRun: true };
      await requestEffect(e, x, output, value, numeric);
      return;
    }
    if (e.type === 'v2UpdateGUI') {
      var updateGUI = await x.host('updateGUI', e);
      await updateGUI();
      return;
    }
    if (e.type === 'v2UpdateChatAt') {
      var updateChatAt = await x.host('updateChatAt', e);
      await updateChatAt(e.index);
      return;
    }
    if (e.type === 'v2Wait') {
      var seconds = await numeric('value', 'valueType', 0);
      await new Promise(function (resolve, reject) {
        var signal = context.signal;
        function abort() {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', abort);
          reject(new TriggerError('RISU_TRIGGER_ABORTED', 'Risu trigger wait was cancelled'));
        }
        var timer = setTimeout(
          function () {
            if (signal) signal.removeEventListener('abort', abort);
            resolve();
          },
          Math.max(0, seconds * 1000)
        );
        if (signal && signal.aborted) abort();
        else if (signal) signal.addEventListener('abort', abort, { once: true });
      });
      return;
    }
    if (e.type === 'v2QuickSearchChat') {
      var search = await value(e, 'value', 'valueType');
      var searchDepth = await numeric('depth', 'depthType', NaN);
      if (Number.isNaN(searchDepth)) {
        await output('outputVar', '0');
        return;
      }
      var corpus = state.messages
        .slice(0 - searchDepth)
        .map(messageText)
        .join(' ');
      var searchPass = false;
      if (e.condition === 'strict') searchPass = corpus.split(' ').indexOf(search) >= 0;
      else if (e.condition === 'loose') searchPass = corpus.toLowerCase().indexOf(search.toLowerCase()) >= 0;
      else if (e.condition === 'regex')
        searchPass = await regexTest(corpus, search, '', { effect: e, mode: x.runMode });
      else
        return x.fail('RISU_TRIGGER_UNKNOWN_SEARCH_MODE', 'Unknown quick search mode: ' + e.condition, { effect: e });
      await output('outputVar', searchPass ? '1' : '0');
      return;
    }
    if (e.type === 'v2Tokenize') {
      var tokenize = await x.host('tokenize', e);
      await output('outputVar', String(await tokenize(await value(e, 'value', 'valueType'))));
      return;
    }
    if (e.type.indexOf('Lorebook') >= 0 || e.type === 'v2GetAllLorebooks') {
      await lorebookEffect(e, x, output, value, numeric, lorebooks, markLorebooks, regexTest);
      return;
    }
    if (e.type === 'v2RegexTest') {
      try {
        var testPattern = await value(e, 'regex', 'regexType');
        var testFlags = await value(e, 'flags', 'flagsType');
        var testInput = await value(e, 'value', 'valueType');
        await output(
          'outputVar',
          (await regexTest(testInput, testPattern, testFlags, { effect: e, mode: x.runMode })) ? '1' : '0'
        );
      } catch (error) {
        if (error && error.code === 'RISU_TRIGGER_HOST_MISSING') throw error;
        await output('outputVar', '0');
      }
      return;
    }
    if (e.type === 'v2Calculate') {
      try {
        var expression = await value(e, 'expression', 'expressionType');
        var matches = expression.match(/\$[a-zA-Z0-9_]+/g) || [];
        for (var mi = 0; mi < matches.length; mi++) {
          var key = matches[mi].slice(1);
          var variableNumber = parseFloat(await getVar(key));
          expression = expression.replace(
            new RegExp('\\$' + key + '\\b', 'g'),
            Number.isNaN(variableNumber) ? '0' : String(variableNumber)
          );
        }
        var globalMatches = expression.match(/\@[a-zA-Z0-9_]+/g) || [];
        for (var gi = 0; gi < globalMatches.length; gi++) {
          var globalKey = globalMatches[gi].slice(1);
          var globalValue;
          if (typeof context.getGlobalVar === 'function') globalValue = await context.getGlobalVar(globalKey);
          else if (context.globalVariables && Object.prototype.hasOwnProperty.call(context.globalVariables, globalKey))
            globalValue = context.globalVariables[globalKey];
          else
            return x.fail('RISU_TRIGGER_HOST_MISSING', 'Risu trigger host cannot read global variable: ' + globalKey, {
              callback: 'getGlobalVar',
              variable: globalKey,
              effectType: e.type,
            });
          var globalNumber = parseFloat(globalValue);
          expression = expression.replace(
            new RegExp('\\@' + globalKey + '\\b', 'g'),
            Number.isNaN(globalNumber) ? '0' : String(globalNumber)
          );
        }
        await output('outputVar', String(calculate(expression)));
      } catch (error) {
        if (error && error.name === 'RisuTriggerError') throw error;
        await output('outputVar', '0');
      }
      return;
    }
    if (e.type === 'v2ReplaceString') {
      var replaceSource = await value(e, 'source', 'sourceType');
      try {
        var replacePattern = await value(e, 'regex', 'regexType');
        var replaceFlags = await value(e, 'flags', 'flagsType');
        var resultFormat = await value(e, 'result', 'resultType');
        var replacement = await value(e, 'replacement', 'replacementType');
        var replaced = await regexReplace(
          replaceSource,
          replacePattern,
          replaceFlags,
          { kind: 'risu-v2', resultFormat: resultFormat, replacement: replacement },
          { effect: e, mode: x.runMode }
        );
        await output('outputVar', replaced);
      } catch (error) {
        if (error && error.code === 'RISU_TRIGGER_HOST_MISSING') throw error;
        await output('outputVar', replaceSource);
      }
      return;
    }
    return x.fail('RISU_TRIGGER_UNKNOWN_EFFECT', 'Unknown Risu trigger effect: ' + e.type, { effectType: e.type });
  }

  function compare(source, target, operator) {
    source = asString(source);
    target = asString(target);
    if (operator === '=' || operator === '!=') {
      var bothNumeric = !Number.isNaN(Number(source)) && !Number.isNaN(Number(target));
      var equal = bothNumeric ? Number(source) === Number(target) : source === target;
      return operator === '=' ? equal : !equal;
    }
    if (operator === '>') return Number(source) > Number(target);
    if (operator === '<') return Number(source) < Number(target);
    if (operator === '>=') return Number(source) >= Number(target);
    if (operator === '<=') return Number(source) <= Number(target);
    if (operator === '∈' || operator === '∉') {
      try {
        var targetArray = JSON.parse(target);
        var included = targetArray.includes(source);
        return operator === '∈' ? included : !included;
      } catch (_) {
        return operator === '∉';
      }
    }
    if (operator === '∋' || operator === '∌') {
      try {
        var sourceArray = JSON.parse(source);
        var contains = sourceArray.includes(target);
        return operator === '∋' ? contains : !contains;
      } catch (_) {
        return operator === '∌';
      }
    }
    if (operator === '≒') {
      var a = Number(source);
      var b = Number(target);
      return Number.isNaN(a) || Number.isNaN(b)
        ? source.toLocaleLowerCase().replace(/ /g, '') === target.toLocaleLowerCase().replace(/ /g, '')
        : Math.abs(a - b) < 0.0001;
    }
    if (operator === '≡') {
      if (target === 'true') return source === 'true' || source === '1';
      if (target === 'false') return !(source === 'true' || source === '1');
      return source === target;
    }
    return false;
  }

  async function arrayEffect(e, x, output, value, varName, getVar, setVar, numeric) {
    var name = await varName(e, 'var');
    if (e.type === 'v2MakeArrayVar') {
      if (name.startsWith('[') && name.endsWith(']')) return;
      await setVar(name, '[]', e);
      return;
    }
    try {
      var array = parseArray(await getVar(name));
      if (e.type === 'v2GetArrayVarLength') await output('outputVar', String(array.length));
      else if (e.type === 'v2GetArrayVar') {
        var got = array[await numeric('index', 'indexType', NaN)];
        await output('outputVar', got === null || got === undefined ? 'null' : got);
      } else if (e.type === 'v2SetArrayVar') {
        var index = await numeric('index', 'indexType', NaN);
        if (!Number.isNaN(index)) {
          array[index] = await value(e, 'value', 'valueType');
          await setVar(name, JSON.stringify(array), e);
        }
      } else if (e.type === 'v2PushArrayVar') {
        array.push(await value(e, 'value', 'valueType'));
        await setVar(name, JSON.stringify(array), e);
      } else if (e.type === 'v2PopArrayVar') {
        var popped = array.pop();
        await output('outputVar', popped === null || popped === undefined ? 'null' : popped);
        await setVar(name, JSON.stringify(array), e);
      } else if (e.type === 'v2ShiftArrayVar') {
        var shifted = array.shift();
        await output('outputVar', shifted === null || shifted === undefined ? 'null' : shifted);
        await setVar(name, JSON.stringify(array), e);
      } else if (e.type === 'v2UnshiftArrayVar') {
        array.unshift(await value(e, 'value', 'valueType'));
        await setVar(name, JSON.stringify(array), e);
      } else if (e.type === 'v2SpliceArrayVar') {
        array.splice(await numeric('start', 'startType', 0), 0, await value(e, 'item', 'itemType'));
        await setVar(name, JSON.stringify(array), e);
      } else if (e.type === 'v2SliceArrayVar')
        await output(
          'outputVar',
          JSON.stringify(
            array.slice(await numeric('start', 'startType', 0), await numeric('end', 'endType', array.length))
          )
        );
      else if (e.type === 'v2GetIndexOfValueInArrayVar')
        await output('outputVar', String(array.indexOf(await value(e, 'value', 'valueType'))));
      else if (e.type === 'v2RemoveIndexFromArrayVar') {
        array.splice(await numeric('index', 'indexType', 0), 1);
        await setVar(name, JSON.stringify(array), e);
      }
    } catch (_) {
      if (e.type === 'v2GetArrayVarLength') await output('outputVar', '0');
      else if (e.type === 'v2GetArrayVar') await output('outputVar', 'null');
      else if (e.type === 'v2SliceArrayVar') await output('outputVar', '[]');
      else if (e.type === 'v2GetIndexOfValueInArrayVar') await output('outputVar', '-1');
      else if (e.type === 'v2PopArrayVar' || e.type === 'v2ShiftArrayVar') {
        await setVar(name, '[]', e);
        await output('outputVar', 'null');
      } else if (e.type !== 'v2SetArrayVar') await setVar(name, '[]', e);
    }
  }

  async function dictEffect(e, x, output, value, varName, getVar, setVar) {
    var name = await varName(e, 'var');
    if (e.type === 'v2MakeDictVar' || e.type === 'v2ClearDict') {
      if (name.startsWith('{') && name.endsWith('}')) return;
      await setVar(name, '{}', e);
      return;
    }
    try {
      var dictSource = e.varType === 'value' ? await x.render(e.var, { effect: e }) : await getVar(name);
      var dict = parseDict(dictSource);
      var key = e.key === undefined ? '' : await value(e, 'key', 'keyType');
      if (e.type === 'v2GetDictVar') await output('outputVar', dict[key] === undefined ? 'null' : dict[key]);
      else if (e.type === 'v2SetDictVar') {
        if (e.varType === 'value') return;
        dict[key] = await value(e, 'value', 'valueType');
        await setVar(name, JSON.stringify(dict), e);
      } else if (e.type === 'v2DeleteDictKey') {
        if (e.varType === 'value') return;
        delete dict[key];
        await setVar(name, JSON.stringify(dict), e);
      } else if (e.type === 'v2HasDictKey')
        await output('outputVar', Object.prototype.hasOwnProperty.call(dict, key) ? '1' : '0');
      else if (e.type === 'v2GetDictSize') await output('outputVar', String(Object.keys(dict).length));
      else if (e.type === 'v2GetDictKeys') await output('outputVar', JSON.stringify(Object.keys(dict)));
      else if (e.type === 'v2GetDictValues') await output('outputVar', JSON.stringify(Object.values(dict)));
    } catch (_) {
      if (e.type === 'v2GetDictVar') await output('outputVar', 'null');
      else if (e.type === 'v2HasDictKey' || e.type === 'v2GetDictSize') await output('outputVar', '0');
      else if (e.type === 'v2GetDictKeys' || e.type === 'v2GetDictValues') await output('outputVar', '[]');
      else if (e.varType === 'var') {
        if (e.type === 'v2SetDictVar') {
          var replacement = {};
          replacement[await value(e, 'key', 'keyType')] = await value(e, 'value', 'valueType');
          await setVar(name, JSON.stringify(replacement), e);
        } else await setVar(name, '{}', e);
      }
    }
  }

  async function requestEffect(e, x, output, value, numeric) {
    var state = x.state;
    if (!Array.isArray(state.requestState))
      return x.fail('RISU_TRIGGER_INVALID_REQUEST_STATE', 'requestState must be an array', { effect: e });
    if (e.type === 'v2GetRequestStateLength') {
      await output('outputVar', String(state.requestState.length));
      return;
    }
    var index = await numeric('index', 'indexType', NaN);
    var row = state.requestState[index];
    if (e.type === 'v2GetRequestState')
      await output('outputVar', row && row.content !== undefined ? row.content : 'null');
    else if (e.type === 'v2GetRequestStateRole')
      await output('outputVar', row && row.role !== undefined ? row.role : 'null');
    else if (e.type === 'v2SetRequestState') {
      if (!row)
        return x.fail('RISU_TRIGGER_REQUEST_INDEX', 'Request state index does not exist: ' + index, { effect: e });
      row.content = await value(e, 'value', 'valueType');
    } else if (e.type === 'v2SetRequestStateRole') {
      if (!row)
        return x.fail('RISU_TRIGGER_REQUEST_INDEX', 'Request state index does not exist: ' + index, { effect: e });
      var role = await value(e, 'value', 'valueType');
      if (role === 'user' || role === 'assistant' || role === 'system') row.role = role;
    }
  }

  async function lorebookEffect(e, x, output, value, numeric, readLorebooks, markLorebooks, regexTest) {
    var books = await readLorebooks();
    if (e.type === 'v2GetLorebookCount' || e.type === 'v2GetLorebookCountNew')
      await output('outputVar', String(books.length));
    else if (e.type === 'v2ModifyLorebook' || e.type === 'v2GetLorebook') {
      var target = await value(e, 'target', 'targetType');
      var legacyIndex = books.findIndex(function (row) {
        return Array.isArray(row) && row[0] === target;
      });
      if (e.type === 'v2GetLorebook') await output('outputVar', legacyIndex === -1 ? 'null' : books[legacyIndex][1]);
      else if (legacyIndex !== -1) {
        books[legacyIndex][1] = await value(e, 'value', 'valueType');
        markLorebooks();
      }
    } else if (e.type === 'v2GetLorebookEntry') {
      var entry = books[await numeric('index', 'indexType', 0)];
      await output('outputVar', Array.isArray(entry) ? entry[1] || 'null' : 'null');
    } else if (e.type === 'v2SetLorebookActivation') {
      var activationIndex = await numeric('index', 'indexType', NaN);
      if (!Array.isArray(books[activationIndex]))
        return x.fail('RISU_TRIGGER_LOREBOOK_SHAPE', 'Legacy lorebook entry is missing at index ' + activationIndex, {
          effect: e,
        });
      books[activationIndex][2] = e.value;
      markLorebooks();
    } else if (e.type === 'v2GetLorebookIndexViaName') {
      var name = await value(e, 'name', 'nameType');
      await output(
        'outputVar',
        String(
          books.findIndex(function (row) {
            return Array.isArray(row) && row[0] === name;
          })
        )
      );
    } else if (e.type === 'v2GetAllLorebooks') {
      await output(
        'outputVar',
        JSON.stringify(
          books
            .filter(function (row) {
              return row && !Array.isArray(row) && row.content !== undefined;
            })
            .map(function (row) {
              return row.content;
            })
        )
      );
    } else if (e.type === 'v2GetLorebookByName') {
      var namePattern = await value(e, 'name', 'nameType');
      var indices = [];
      for (var nameIndex = 0; nameIndex < books.length; nameIndex++) {
        var namedRow = books[nameIndex];
        if (
          namedRow &&
          !Array.isArray(namedRow) &&
          namedRow.comment !== undefined &&
          (await regexTest(namedRow.comment, namePattern, 'i', { effect: e, mode: x.runMode }))
        )
          indices.push(nameIndex);
      }
      await output('outputVar', JSON.stringify(indices));
    } else if (e.type === 'v2GetLorebookByIndex') {
      var getIndex = await numeric('index', 'indexType', NaN);
      var modern = books[getIndex];
      await output(
        'outputVar',
        modern && !Array.isArray(modern) && modern.content !== undefined ? modern.content : 'null'
      );
    } else if (e.type === 'v2CreateLorebook') {
      var insertOrder = await numeric('insertOrder', 'insertOrderType', 100);
      books.push({
        key: await value(e, 'key', 'keyType'),
        comment: await value(e, 'name', 'nameType'),
        content: await value(e, 'content', 'contentType'),
        mode: 'normal',
        insertorder: insertOrder,
        alwaysActive: false,
        secondkey: '',
        selective: false,
      });
      markLorebooks();
    } else if (e.type === 'v2ModifyLorebookByIndex') {
      var modifyIndex = await numeric('index', 'indexType', NaN);
      var current = books[modifyIndex];
      if (!current || Array.isArray(current)) return;
      current.comment = (await value(e, 'name', 'nameType')).replace(/{{slot}}/g, current.comment || '');
      current.key = (await value(e, 'key', 'keyType')).replace(/{{slot}}/g, current.key || '');
      current.content = (await value(e, 'content', 'contentType')).replace(/{{slot}}/g, current.content || '');
      var orderText = (await value(e, 'insertOrder', 'insertOrderType')).replace(
        /{{slot}}/g,
        String(current.insertorder || 100)
      );
      if (!Number.isNaN(Number(orderText))) current.insertorder = Number(orderText);
      markLorebooks();
    } else if (e.type === 'v2DeleteLorebookByIndex') {
      var deleteIndex = await numeric('index', 'indexType', NaN);
      if (deleteIndex >= 0 && deleteIndex < books.length) {
        books.splice(deleteIndex, 1);
        markLorebooks();
      }
    } else if (e.type === 'v2SetLorebookAlwaysActive') {
      var activeIndex = await numeric('index', 'indexType', NaN);
      if (books[activeIndex] && !Array.isArray(books[activeIndex])) {
        books[activeIndex].alwaysActive = e.value;
        markLorebooks();
      }
    }
  }

  return Object.freeze({
    run: run,
    TriggerError: TriggerError,
    capabilities: Object.freeze({
      modes: Object.freeze(MODES.slice()),
      implementedEffects: IMPLEMENTED_EFFECTS,
      hostEffects: HOST_EFFECTS,
      regexCallbacks: Object.freeze({
        regexMatch: '(input, pattern, flags, meta) => matchArray|null',
        regexTest: '(input, pattern, flags, meta) => boolean',
        regexSplit: '(input, pattern, flags, meta) => string[]',
        regexReplace: '(input, pattern, flags, specification, meta) => string',
        browserFallback: false,
        nodeFallback: true,
      }),
      contextContract: Object.freeze({
        required: Object.freeze(['render', 'messages|getMessages']),
        variables: 'getVar+setVar or mutable variables; display/request use returned tempVars',
        lua: 'runLua(code, mode, {mode,getVar,setVar,messages,lowLevelAccess,localVariables})',
        recursion: 'manualName selects trigger.comment exactly; nested calls share message and persistent state',
        cancellation: 'signal plus optional yieldControl for long loops',
      }),
      displayAllowList: Object.freeze(DISPLAY_ALLOW.slice()),
      requestAllowList: Object.freeze(REQUEST_ALLOW.slice()),
      upstreamDeclaredWithoutExecution: UPSTREAM_DECLARED_WITHOUT_EXECUTION,
      recursionLimit: 10,
      lua: 'delegated-to-context.runLua',
      source: 'RisuAI v2026.10.211 src/ts/process/triggers.ts',
    }),
  });
});
