// ===== STScript parser / runtime (SillyTavern 1.19.0 behavior, independently rewritten) =====
var STSCRIPT_PARSER_FLAG = { STRICT_ESCAPING: 1, REPLACE_GETVAR: 2 };
var STSCRIPT_COMMANDS = Object.create(null);
var STSCRIPT_MAX_LOOPS = 100;
function stscriptIsTrue(value) {
  value = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  return value === 'true' || value === 'on' || value === 'yes' || value === '1';
}
function stscriptIsFalse(value) {
  value = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  return value === 'false' || value === 'off' || value === 'no' || value === '0';
}
function stscriptUid() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function StscriptParserError(message, text, index) {
  this.name = 'StscriptParserError';
  this.message = String(message || '脚本语法错误');
  this.text = String(text == null ? '' : text);
  this.index = Math.max(0, Number(index) || 0);
  var before = this.text.slice(0, this.index),
    lines = before.split('\n');
  this.line = lines.length;
  this.column = lines[lines.length - 1].length + 1;
  var start = Math.max(0, this.index - 40),
    end = Math.min(this.text.length, this.index + 40);
  this.hint = this.text.slice(start, end);
}
StscriptParserError.prototype = Object.create(Error.prototype);
function StscriptExecutionError(cause, message, name, start, end, snippet, fullText) {
  this.name = 'StscriptExecutionError';
  this.cause = cause;
  this.message = String(message || (cause && cause.message) || '脚本执行失败');
  this.commandName = String(name || '');
  this.start = Math.max(0, Number(start) || 0);
  this.end = Math.max(this.start, Number(end) || this.start);
  this.snippet = String(snippet == null ? '' : snippet);
  this.fullText = String(fullText == null ? '' : fullText);
  var before = this.fullText.slice(0, this.start),
    lines = before.split('\n');
  this.line = lines.length;
  this.column = lines[lines.length - 1].length + 1;
}
StscriptExecutionError.prototype = Object.create(Error.prototype);
function StscriptAbortController() {
  this.signal = { aborted: false, paused: false, isQuiet: false, reason: '' };
  this._listeners = [];
}
StscriptAbortController.prototype.abort = function (reason, isQuiet) {
  this.signal.aborted = true;
  this.signal.isQuiet = isQuiet !== false;
  this.signal.reason = reason == null ? '已停止' : String(reason);
  this._listeners.slice().forEach(function (fn) {
    try {
      fn();
    } catch (_) {}
  });
};
StscriptAbortController.prototype.onAbort = function (fn) {
  this._listeners.push(fn);
};
StscriptAbortController.prototype.offAbort = function (fn) {
  var i = this._listeners.indexOf(fn);
  if (i >= 0) this._listeners.splice(i, 1);
};
function StscriptBreakController() {
  this.isBreak = false;
}
StscriptBreakController.prototype.break = function () {
  this.isBreak = true;
};
function StscriptScope(parent) {
  this.parent = parent || null;
  this.variableNames = [];
  this.variables = {};
  this.macros = {};
  this._pipe = undefined;
}
StscriptScope.prototype.getCopy = function () {
  var scope = new StscriptScope(this.parent);
  scope.variableNames = this.variableNames.slice();
  scope.variables = Object.assign({}, this.variables);
  scope.macros = Object.assign({}, this.macros);
  scope._pipe = this._pipe;
  return scope;
};
Object.defineProperty(StscriptScope.prototype, 'pipe', {
  get: function () {
    return this._pipe !== undefined ? this._pipe : this.parent ? this.parent.pipe : undefined;
  },
  set: function (value) {
    this._pipe = value;
  },
});
StscriptScope.prototype.macroList = function () {
  var rows = Object.keys(this.macros).map(function (key) {
    return { key: key, value: this.macros[key] };
  }, this);
  return this.parent ? rows.concat(this.parent.macroList()) : rows;
};
StscriptScope.prototype.setMacro = function (key, value, overwrite) {
  if (
    overwrite !== false ||
    !this.macroList().some(function (row) {
      return row.key === key;
    })
  )
    this.macros[key] = value;
};
StscriptScope.prototype.existsVariableInScope = function (key) {
  return Object.prototype.hasOwnProperty.call(this.variables, key);
};
StscriptScope.prototype.existsVariable = function (key) {
  return this.existsVariableInScope(key) || !!(this.parent && this.parent.existsVariable(key));
};
StscriptScope.prototype.letVariable = function (key, value) {
  if (this.existsVariableInScope(key)) throw new Error('变量 "' + key + '" 已存在');
  this.variables[key] = value;
  if (this.variableNames.indexOf(key) < 0) this.variableNames.push(key);
};
StscriptScope.prototype.setVariable = function (key, value, index, type) {
  if (this.existsVariableInScope(key)) {
    if (index != null && index !== '') {
      var stored = this.variables[key],
        parsed = stored;
      try {
        parsed = JSON.parse(stored);
      } catch (_) {
        parsed = stored;
      }
      var num = Number(index);
      if (Number.isNaN(num)) parsed[index] = stscriptConvertType(value, type);
      else parsed[num] = stscriptConvertType(value, type);
      this.variables[key] = typeof parsed === 'object' ? JSON.stringify(parsed) : parsed;
    } else this.variables[key] = value;
    return value;
  }
  if (this.parent) return this.parent.setVariable(key, value, index, type);
  throw new Error('没有名为 "' + key + '" 的变量');
};
StscriptScope.prototype.getVariable = function (key, index) {
  if (this.existsVariableInScope(key)) {
    var stored = this.variables[key];
    if (index != null && index !== '') {
      var parsed = stored;
      try {
        parsed = JSON.parse(stored);
      } catch (_) {}
      var num = Number(index);
      parsed = Number.isNaN(num) ? parsed[index] : parsed[num];
      if (typeof parsed === 'object' && parsed != null) return JSON.stringify(parsed);
      return parsed == null ? '' : parsed;
    }
    if (stored instanceof StscriptClosure) return stored;
    return (typeof stored === 'string' && stored.trim() === '') || isNaN(Number(stored))
      ? stored || ''
      : Number(stored);
  }
  if (this.parent) return this.parent.getVariable(key, index);
  throw new Error('没有名为 "' + key + '" 的变量');
};
function StscriptExecutor(start) {
  this.start = start;
  this.end = start;
  this.name = '';
  this.command = null;
  this.namedArgumentList = [];
  this.unnamedArgumentList = [];
  this.injectPipe = true;
  this.parserFlags = {};
  this.startNamedArgs = 0;
  this.endNamedArgs = 0;
  this.startUnnamedArgs = 0;
  this.endUnnamedArgs = 0;
}
function StscriptClosure(parent) {
  this.scope = new StscriptScope(parent);
  this.executeNow = false;
  this.argumentList = [];
  this.providedArgumentList = [];
  this.executorList = [];
  this.abortController = null;
  this.breakController = null;
  this.rawText = '';
  this.fullText = '';
  this.source = stscriptUid();
  this.onProgress = null;
}
StscriptClosure.prototype.getCopy = function () {
  var closure = new StscriptClosure();
  closure.scope = this.scope.getCopy();
  closure.executeNow = this.executeNow;
  closure.argumentList = this.argumentList;
  closure.providedArgumentList = this.providedArgumentList;
  closure.executorList = this.executorList;
  closure.abortController = this.abortController;
  closure.breakController = this.breakController;
  closure.rawText = this.rawText;
  closure.fullText = this.fullText;
  closure.source = this.source;
  closure.onProgress = this.onProgress;
  return closure;
};
StscriptClosure.prototype.substituteParams = function (text, scope) {
  scope = scope || this.scope;
  if (text == null) return '';
  if (typeof text !== 'string') return text;
  var self = this;
  return stscriptExpandMacros(text, function (name, args) {
    if (name === 'pipe') return scope.pipe == null ? '' : scope.pipe;
    // Like ST, reading a variable that was never assigned fails the command instead of reading as empty.
    if (name === 'var') return scope.getVariable(args[0], args[1]);
    var macros = scope.macroList(),
      match = null;
    for (var i = 0; i < macros.length; i++) {
      var key = macros[i].key,
        parts = String(key).split('::');
      if (parts[0] !== name) continue;
      var rest = parts.slice(1);
      if (
        rest.length === args.length &&
        rest.every(function (part, idx) {
          return part === '*' || part === args[idx];
        })
      ) {
        match = macros[i].value;
        break;
      }
    }
    if (match instanceof StscriptClosure) {
      match.abortController = self.abortController;
      match.breakController = self.breakController;
      match.scope.parent = self.scope;
      return match;
    }
    if (match != null) return String(match);
    if (typeof stscriptResolveHostMacro === 'function')
      return stscriptResolveHostMacro(name, args, scope, self.abortController);
    return '';
  });
};
// Failures while resolving or running a command carry that command's position in the script.
StscriptClosure.prototype.executorError = function (executor, error) {
  if (error instanceof StscriptExecutionError) return error;
  return new StscriptExecutionError(
    error,
    (error && error.message) || String(error),
    executor.name,
    executor.start,
    executor.end,
    this.fullText.slice(executor.start, executor.end),
    this.fullText
  );
};
StscriptClosure.prototype._unescape = function (value) {
  if (typeof value === 'string') return value.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  if (Array.isArray(value)) return value.map(this._unescape, this);
  return value;
};
StscriptClosure.prototype._assignNamed = function (executor, args, name, value) {
  if (Array.isArray(value) && !(value instanceof StscriptClosure)) {
    value.forEach(function (item) {
      this._assignNamed(executor, args, name, item);
    }, this);
    return;
  }
  var definition = ((executor.command && executor.command.namedArgumentList) || []).find(function (item) {
    return item.name === name;
  });
  name = (definition && definition.name) || name;
  value = this._unescape(value);
  if (definition && definition.acceptsMultiple) {
    if (args[name] === undefined) args[name] = [value];
    else {
      if (!Array.isArray(args[name])) args[name] = [args[name]];
      args[name].push(value);
    }
  } else args[name] = value;
};
StscriptClosure.prototype.substituteNamedArguments = async function (executor, args) {
  for (var i = 0; i < executor.namedArgumentList.length; i++) {
    var arg = executor.namedArgumentList[i],
      value = arg.value;
    if (value instanceof StscriptClosure) {
      value.scope.parent = this.scope;
      value.breakController = this.breakController;
      value.abortController = this.abortController;
      if (value.executeNow) this._assignNamed(executor, args, arg.name, (await value.execute()).pipe);
      else this._assignNamed(executor, args, arg.name, value);
    } else this._assignNamed(executor, args, arg.name, this.substituteParams(value));
  }
};
StscriptClosure.prototype.substituteUnnamedArgument = async function (executor, isFirst, args) {
  var value;
  if (!executor.unnamedArgumentList.length) {
    if (!isFirst && executor.injectPipe) {
      value = this.scope.pipe;
      args._hasUnnamedArgument = this.scope.pipe != null;
    }
  } else {
    value = [];
    for (var i = 0; i < executor.unnamedArgumentList.length; i++) {
      var item = executor.unnamedArgumentList[i].value;
      if (item instanceof StscriptClosure) {
        item.scope.parent = this.scope;
        item.breakController = this.breakController;
        item.abortController = this.abortController;
        value[i] = item.executeNow ? (await item.execute()).pipe : item;
      } else value[i] = this.substituteParams(item);
    }
    if (!(executor.command && executor.command.splitUnnamedArgument)) {
      if (value.length === 1) value = value[0];
      else if (
        !value.some(function (item) {
          return item instanceof StscriptClosure;
        })
      )
        value = value.join('');
    }
  }
  value = this._unescape(value == null ? '' : value);
  if (executor.command && executor.command.splitUnnamedArgument && !Array.isArray(value)) value = [value];
  return value;
};
StscriptClosure.prototype.testAbort = async function () {
  var signal = this.abortController && this.abortController.signal;
  if (signal && signal.paused) {
    while (signal.paused && !signal.aborted) await stscriptDelay(50, this.abortController);
  }
  if (signal && signal.aborted)
    return {
      pipe: this.scope.pipe || '',
      isAborted: true,
      isQuietlyAborted: !!signal.isQuiet,
      abortReason: String(signal.reason || '已停止'),
      isBreak: false,
      isReturned: false,
      isError: false,
    };
  return null;
};
StscriptClosure.prototype.execute = async function () {
  var closure = this.getCopy(),
    abort,
    isFirst = true,
    done = 0;
  for (var a = 0; a < closure.argumentList.length; a++) {
    var carg = closure.argumentList[a],
      cval = carg.value;
    if (cval instanceof StscriptClosure) {
      cval.scope.parent = closure.scope;
      cval.breakController = closure.breakController;
      cval.abortController = closure.abortController;
      cval = cval.executeNow ? (await cval.execute()).pipe : cval;
    } else cval = closure.substituteParams(cval);
    closure.scope.letVariable(carg.name, closure._unescape(cval));
  }
  for (var p = 0; p < closure.providedArgumentList.length; p++) {
    var parg = closure.providedArgumentList[p],
      pval = parg.value;
    if (pval instanceof StscriptClosure) {
      pval.scope.parent = closure.scope;
      pval.breakController = closure.breakController;
      pval.abortController = closure.abortController;
      pval = pval.executeNow ? (await pval.execute()).pipe : pval;
    } else pval = closure.substituteParams(pval, closure.scope.parent);
    closure.scope.setVariable(parg.name, closure._unescape(pval));
  }
  if (!closure.executorList.length) closure.scope.pipe = '';
  for (var i = 0; i < closure.executorList.length; i++) {
    if (closure.breakController && closure.breakController.isBreak) break;
    abort = await closure.testAbort();
    if (abort) return abort;
    var executor = closure.executorList[i],
      args = {
        _scope: closure.scope,
        _parserFlags: executor.parserFlags,
        _abortController: closure.abortController,
        _hasUnnamedArgument: executor.unnamedArgumentList.length > 0,
      };
    if (executor.name === 'break') {
      var breakValue;
      try {
        breakValue = await closure.substituteUnnamedArgument(executor, isFirst, args);
      } catch (error) {
        throw closure.executorError(executor, error);
      }
      closure.scope.pipe = breakValue == null || breakValue === '' ? closure.scope.pipe : breakValue;
      if (closure.breakController) {
        closure.breakController.break();
        break;
      }
      isFirst = false;
      continue;
    }
    if (executor.name === 'breakpoint' || executor.name === '/' || executor.name === '#' || executor.name === '*') {
      isFirst = false;
      continue;
    }
    var unnamed;
    try {
      await closure.substituteNamedArguments(executor, args);
      unnamed = await closure.substituteUnnamedArgument(executor, isFirst, args);
    } catch (error) {
      throw closure.executorError(executor, error);
    }
    abort = await closure.testAbort();
    if (abort) return abort;
    if (!executor.command || typeof executor.command.callback !== 'function')
      throw new StscriptExecutionError(
        null,
        '命令 /' + executor.name + ' 没有可执行实现',
        executor.name,
        executor.start,
        executor.end,
        closure.fullText.slice(executor.start, executor.end),
        closure.fullText
      );
    try {
      var dryRun =
          typeof stscriptDryRunCall === 'function'
            ? stscriptDryRunCall(closure.abortController, executor.command, args, unnamed)
            : null,
        result = dryRun ? dryRun.value : await executor.command.callback(args, unnamed == null ? '' : unnamed);
      if (result == null) closure.scope.pipe = '';
      else if (typeof result === 'string' || result instanceof StscriptClosure) closure.scope.pipe = result;
      else closure.scope.pipe = JSON.stringify(result) ?? '';
    } catch (error) {
      throw closure.executorError(executor, error);
    }
    abort = await closure.testAbort();
    if (abort) return abort;
    if (executor.name === 'return')
      return {
        pipe: closure.scope.pipe == null ? '' : closure.scope.pipe,
        isAborted: false,
        isQuietlyAborted: false,
        abortReason: '',
        isBreak: false,
        isReturned: true,
        isError: false,
      };
    if (typeof closure.onProgress === 'function') closure.onProgress(++done, closure.executorList.length);
    isFirst = false;
  }
  return {
    pipe: closure.scope.pipe == null ? '' : closure.scope.pipe,
    isAborted: false,
    isQuietlyAborted: false,
    abortReason: '',
    isBreak: !!(closure.breakController && closure.breakController.isBreak),
    isReturned: false,
    isError: false,
  };
};
function StscriptParser() {
  this.flags = {};
  this.jumpedEscapeSequence = false;
  this.verifyCommandNames = true;
  this.text = '';
  this.index = 0;
  this.scope = null;
  this.closure = null;
  this.abortController = null;
}
StscriptParser.prototype.ahead = function () {
  return this.text.slice(this.index + 1);
};
StscriptParser.prototype.behind = function () {
  return this.text.slice(0, this.index);
};
StscriptParser.prototype.char = function () {
  return this.text.charAt(this.index);
};
StscriptParser.prototype.endOfText = function () {
  return this.index >= this.text.length || (/\s/.test(this.char()) && /^\s+$/.test(this.ahead()));
};
StscriptParser.prototype.take = function (length) {
  length = length == null ? 1 : length;
  this.jumpedEscapeSequence = false;
  var content = this.char();
  this.index++;
  if (length > 1) content = this.take(length - 1);
  return content;
};
StscriptParser.prototype.discardWhitespace = function () {
  while (/\s/.test(this.char())) {
    this.take();
    this.jumpedEscapeSequence = false;
  }
};
StscriptParser.prototype.testSymbol = function (sequence, offset) {
  offset = offset || 0;
  var strict = !!this.flags[STSCRIPT_PARSER_FLAG.STRICT_ESCAPING],
    escapeOffset = this.jumpedEscapeSequence ? -1 : 0;
  var slice = this.text.slice(this.index + offset + escapeOffset),
    escapes = strict ? slice.replace(/^(\\*).*$/s, '$1').length : slice.charAt(0) === '\\' ? 1 : 0;
  var test =
    sequence instanceof RegExp
      ? function (text) {
          return new RegExp('^' + sequence.source).test(text);
        }
      : function (text) {
          return text.indexOf(sequence) === 0;
        };
  if (!test(this.text.slice(this.index + offset + escapeOffset + escapes))) return false;
  if (escapes === 0) return true;
  if (!this.jumpedEscapeSequence && offset === 0) {
    this.index++;
    this.jumpedEscapeSequence = true;
  }
  return false;
};
StscriptParser.prototype.isInsideMacroBraces = function () {
  var text = this.behind(),
    depth = 0;
  for (var i = 0; i < text.length; i++) {
    if (text.charAt(i) === '{' && text.charAt(i + 1) === '{') {
      depth++;
      i++;
    } else if (text.charAt(i) === '}' && text.charAt(i + 1) === '}') {
      depth = Math.max(0, depth - 1);
      i++;
    }
  }
  return depth > 0;
};
StscriptParser.prototype.testCommandEnd = function () {
  if (this.testClosureEnd()) return true;
  return this.testSymbol('|') && !this.isInsideMacroBraces();
};
StscriptParser.prototype.testClosure = function () {
  return this.testSymbol('{:');
};
StscriptParser.prototype.testClosureEnd = function () {
  if (!this.scope.parent) return this.index >= this.text.length;
  if (!this.verifyCommandNames) {
    if (this.index >= this.text.length) return true;
  } else if (this.ahead().length < 1)
    throw new StscriptParserError('未闭合的脚本块，位置 ' + this.index, this.text, this.index);
  return this.testSymbol(':}');
};
StscriptParser.prototype.parse = function (text, verifyCommandNames, flags, abortController) {
  this.verifyCommandNames = verifyCommandNames !== false;
  this.flags = {};
  this.flags[STSCRIPT_PARSER_FLAG.STRICT_ESCAPING] = !!(flags && flags[STSCRIPT_PARSER_FLAG.STRICT_ESCAPING]);
  this.flags[STSCRIPT_PARSER_FLAG.REPLACE_GETVAR] = !!(flags && flags[STSCRIPT_PARSER_FLAG.REPLACE_GETVAR]);
  this.abortController = abortController || new StscriptAbortController();
  this.text = String(text == null ? '' : text);
  this.index = 0;
  this.scope = null;
  this.closure = null;
  return this.parseClosure(true);
};
StscriptParser.prototype.parseClosure = function (isRoot) {
  var injectPipe = true;
  if (!isRoot) this.take(2);
  var textStart = this.index,
    closure = new StscriptClosure(this.scope);
  closure.fullText = this.text;
  closure.abortController = this.abortController;
  this.scope = closure.scope;
  var old = this.closure;
  this.closure = closure;
  this.discardWhitespace();
  while (this.testNamedArgument()) {
    var arg = this.parseNamedArgument();
    closure.argumentList.push(arg);
    this.scope.variableNames.push(arg.name);
    this.discardWhitespace();
  }
  while (!this.testClosureEnd()) {
    if (this.testSymbol('/*')) this.parseBlockComment();
    else if (this.testSymbol(/\/[/#]/)) this.parseComment();
    else if (this.testSymbol('/parser-flag ')) this.parseParserFlag();
    else if (this.testSymbol('/:') && !this.testSymbol(':}', 1)) {
      closure.executorList.push(this.parseRunShorthand());
      injectPipe = true;
    } else if (this.testSymbol(/\/breakpoint\s*\|/)) this.parseBreakPoint();
    else if (this.testSymbol(/\/break(\s|\||$)/)) {
      closure.executorList.push(this.parseBreak());
      injectPipe = true;
    } else if (this.testSymbol('/')) {
      var cmd = this.parseCommand();
      cmd.injectPipe = injectPipe;
      closure.executorList.push(cmd);
      injectPipe = true;
    } else while (!this.testCommandEnd()) this.take();
    this.discardWhitespace();
    if (this.testSymbol('|')) {
      this.take();
      if (this.testSymbol('|')) {
        injectPipe = false;
        this.take();
      }
    }
    this.discardWhitespace();
  }
  closure.rawText = this.text.slice(textStart, this.index);
  if (!isRoot) this.take(2);
  if (this.testSymbol('()')) {
    this.take(2);
    closure.executeNow = true;
  }
  this.scope = closure.scope.parent;
  this.closure = old || closure;
  return closure;
};
StscriptParser.prototype.parseBlockComment = function () {
  this.take(2);
  var depth = 1;
  while (depth && this.index < this.text.length) {
    if (this.testSymbol('/*')) {
      depth++;
      this.take(2);
    } else if (this.testSymbol('*|')) {
      depth--;
      this.take(2);
    } else this.take();
  }
  if (depth && this.verifyCommandNames)
    throw new StscriptParserError('未闭合的块注释，位置 ' + this.index, this.text, this.index);
};
StscriptParser.prototype.parseComment = function () {
  this.take();
  this.take();
  while (!this.testSymbol('|') && this.index < this.text.length) {
    if (this.endOfText() && this.verifyCommandNames)
      throw new StscriptParserError('未闭合的注释，位置 ' + this.index, this.text, this.index);
    this.take();
  }
};
StscriptParser.prototype.parseParserFlag = function () {
  var executor = new StscriptExecutor(this.index + 1);
  executor.name = 'parser-flag';
  executor.command = STSCRIPT_COMMANDS['parser-flag'];
  this.take(13);
  executor.unnamedArgumentList = this.parseUnnamedArgument(true);
  var flag = executor.unnamedArgumentList[0] && executor.unnamedArgumentList[0].value,
    state = executor.unnamedArgumentList[1] && executor.unnamedArgumentList[1].value;
  if (flag && Object.prototype.hasOwnProperty.call(STSCRIPT_PARSER_FLAG, String(flag)))
    this.flags[STSCRIPT_PARSER_FLAG[String(flag)]] = stscriptIsTrue(state == null ? 'on' : state);
  executor.end = this.index;
  return executor;
};
StscriptParser.prototype.parseBreakPoint = function () {
  this.take('/breakpoint'.length);
};
StscriptParser.prototype.parseBreak = function () {
  var executor = new StscriptExecutor(this.index + 1);
  executor.name = 'break';
  executor.command = STSCRIPT_COMMANDS.break;
  this.take('/break'.length);
  this.discardWhitespace();
  if (!this.testCommandEnd()) executor.unnamedArgumentList = this.parseUnnamedArgument();
  executor.end = this.index;
  return executor;
};
StscriptParser.prototype.parseRunShorthand = function () {
  var executor = new StscriptExecutor(this.index + 2);
  executor.name = ':';
  executor.command = STSCRIPT_COMMANDS.run;
  this.take(2);
  var assignment = {
    start: this.index,
    end: 0,
    name: '',
    value: this.testQuotedValue() ? this.parseQuotedValue() : this.parseValue(),
  };
  assignment.end = this.index;
  executor.unnamedArgumentList = [assignment];
  this.discardWhitespace();
  while (this.testNamedArgument()) {
    executor.namedArgumentList.push(this.parseNamedArgument());
    this.discardWhitespace();
  }
  if (!this.testCommandEnd())
    throw new StscriptParserError('命令意外结束，位置 ' + this.index + '："/:"', this.text, this.index);
  executor.end = this.index;
  return executor;
};
StscriptParser.prototype.parseCommand = function () {
  var executor = new StscriptExecutor(this.index + 1);
  executor.parserFlags = Object.assign({}, this.flags);
  this.take();
  while (this.char() && !/\s/.test(this.char()) && !this.testCommandEnd()) executor.name += this.take();
  this.discardWhitespace();
  if (this.verifyCommandNames && !STSCRIPT_COMMANDS[executor.name])
    throw new StscriptParserError(
      (typeof STSCRIPT_UNAVAILABLE === 'object' && STSCRIPT_UNAVAILABLE[executor.name]) ||
        '未知命令，位置 ' + (this.index - executor.name.length) + '："/' + executor.name + '"',
      this.text,
      this.index - executor.name.length
    );
  executor.command = STSCRIPT_COMMANDS[executor.name];
  while (this.testNamedArgument()) {
    executor.namedArgumentList.push(this.parseNamedArgument());
    this.discardWhitespace();
  }
  this.discardWhitespace();
  if (!this.testCommandEnd()) {
    var rawArg = executor.namedArgumentList.find(function (item) {
      return item.name === 'raw';
    });
    var rawQuotes =
      !!(executor.command && executor.command.rawQuotes) && (rawArg ? !stscriptIsFalse(rawArg.value) : true);
    executor.unnamedArgumentList = this.parseUnnamedArgument(
      !!(executor.command && executor.command.splitUnnamedArgument),
      executor.command && executor.command.splitUnnamedArgumentCount,
      rawQuotes
    );
    if (executor.name === 'let') {
      var keyArg = executor.namedArgumentList.find(function (item) {
        return item.name === 'key';
      });
      if (keyArg) this.scope.variableNames.push(String(keyArg.value));
      else if (executor.unnamedArgumentList[0] && typeof executor.unnamedArgumentList[0].value === 'string')
        this.scope.variableNames.push(executor.unnamedArgumentList[0].value);
    }
  }
  if (!this.testCommandEnd())
    throw new StscriptParserError(
      '命令意外结束，位置 ' + this.index + '："/' + executor.name + '"',
      this.text,
      this.index
    );
  executor.end = this.index;
  return executor;
};
StscriptParser.prototype.testNamedArgument = function () {
  return /^\w+=/.test(this.char() + this.ahead());
};
StscriptParser.prototype.parseNamedArgument = function () {
  var assignment = { start: this.index, end: 0, name: '', value: '' };
  while (/\w/.test(this.char())) assignment.name += this.take();
  this.take();
  if (this.testClosure()) assignment.value = this.parseClosure();
  else if (this.testQuotedValue()) assignment.value = this.parseQuotedValue();
  else if (this.testSymbol('[')) assignment.value = this.parseListValue();
  else if (!this.testSymbol(/\s/)) assignment.value = this.parseValue();
  assignment.end = this.index;
  return assignment;
};
StscriptParser.prototype.parseUnnamedArgument = function (split, splitCount, rawQuotes) {
  var value = this.jumpedEscapeSequence ? this.take() : '',
    isList = !!split,
    listValues = [],
    listQuoted = [],
    assignment = { start: this.index, end: this.index, name: '', value: '' };
  if (!split && !rawQuotes && this.testQuotedValue()) {
    assignment.value = this.parseQuotedValue();
    assignment.end = this.index;
    isList = true;
    listValues.push(assignment);
    listQuoted.push(true);
    assignment = { start: this.index, end: this.index, name: '', value: '' };
  }
  while (!this.testCommandEnd()) {
    if (split && splitCount && listValues.length >= splitCount) {
      split = false;
      if (this.testQuotedValue()) {
        assignment.value = this.parseQuotedValue();
        assignment.end = this.index;
        listValues.push(assignment);
        listQuoted.push(true);
        assignment = { start: this.index, end: this.index, name: '', value: '' };
      }
    }
    if (this.testClosure()) {
      isList = true;
      if (value.length) {
        assignment.value = value;
        listValues.push(assignment);
        listQuoted.push(false);
        assignment = { start: this.index, end: this.index, name: '', value: '' };
        if (!split && this.testQuotedValue()) {
          assignment.value = this.parseQuotedValue();
          assignment.end = this.index;
          listValues.push(assignment);
          listQuoted.push(true);
          assignment = { start: this.index, end: this.index, name: '', value: '' };
        } else value = '';
      }
      assignment.start = this.index;
      assignment.value = this.parseClosure();
      assignment.end = this.index;
      listValues.push(assignment);
      assignment = { start: this.index, end: this.index, name: '', value: '' };
      if (split) this.discardWhitespace();
    } else if (split) {
      if (this.testQuotedValue()) {
        assignment.start = this.index;
        assignment.value = this.parseQuotedValue();
        assignment.end = this.index;
        listValues.push(assignment);
        listQuoted.push(true);
      } else if (this.testSymbol('[')) {
        assignment.start = this.index;
        assignment.value = this.parseListValue();
        assignment.end = this.index;
        listValues.push(assignment);
        listQuoted.push(false);
      } else if (!this.testSymbol(/\s/)) {
        assignment.start = this.index;
        assignment.value = this.parseValue();
        assignment.end = this.index;
        listValues.push(assignment);
        listQuoted.push(false);
      } else throw new StscriptParserError('未命名参数意外结束，位置 ' + this.index, this.text, this.index);
      assignment = { start: this.index, end: this.index, name: '', value: '' };
      this.discardWhitespace();
    } else {
      value += this.take();
      assignment.end = this.index;
    }
  }
  if (isList && value.length) {
    assignment.value = value;
    listValues.push(assignment);
    listQuoted.push(false);
  }
  if (isList) {
    var first = listValues[0];
    if (first && typeof first.value === 'string') {
      if (!listQuoted[0]) first.value = first.value.replace(/^\s+/, '');
      if (!first.value.length) {
        listValues.shift();
        listQuoted.shift();
      }
    }
    var last = listValues[listValues.length - 1];
    if (last && typeof last.value === 'string') {
      if (!listQuoted[listQuoted.length - 1]) last.value = last.value.replace(/\s+$/, '');
      if (!last.value.length) {
        listValues.pop();
        listQuoted.pop();
      }
    }
    return listValues;
  }
  value = value.trim();
  assignment.value = value;
  return [assignment];
};
StscriptParser.prototype.testQuotedValue = function () {
  return this.testSymbol('"');
};
StscriptParser.prototype.parseQuotedValue = function () {
  this.take();
  var value = '';
  while (true) {
    if (this.endOfText()) {
      if (this.verifyCommandNames)
        throw new StscriptParserError('引号未闭合，位置 ' + this.index, this.text, this.index);
      break;
    }
    if (!this.verifyCommandNames && this.testClosureEnd()) break;
    if (this.verifyCommandNames && !this.flags[STSCRIPT_PARSER_FLAG.STRICT_ESCAPING] && this.testCommandEnd())
      throw new StscriptParserError('引号未闭合，位置 ' + this.index, this.text, this.index);
    if (this.testSymbol('"') || (!this.flags[STSCRIPT_PARSER_FLAG.STRICT_ESCAPING] && this.testCommandEnd())) break;
    value += this.take();
  }
  if (this.testSymbol('"')) this.take();
  return value;
};
StscriptParser.prototype.parseListValue = function () {
  var value = this.take();
  while (!this.testSymbol(']') && this.index < this.text.length) value += this.take();
  if (this.testSymbol(']')) value += this.take();
  return value;
};
StscriptParser.prototype.parseValue = function () {
  var value = this.jumpedEscapeSequence ? this.take() : '';
  while (!(this.testSymbol(/\s/) || this.testCommandEnd())) value += this.take();
  return value;
};
// `dryRun` says what the command does when the round preview runs it dry (see stscriptDryRunCall): 'run' runs it
// as is, 'model' and 'network' answer with a placeholder; a function of (args, value) decides per call and may
// return any of those. A command that declares nothing is dropped.
function stscriptAddCommand(props) {
  props = props || {};
  if (!props.name) throw new Error('命令缺少名称');
  var command = {
    name: props.name,
    aliases: props.aliases || [],
    callback: props.callback,
    namedArgumentList: props.namedArgumentList || [],
    unnamedArgumentList: props.unnamedArgumentList || [],
    splitUnnamedArgument: !!props.splitUnnamedArgument,
    splitUnnamedArgumentCount: props.splitUnnamedArgumentCount || null,
    rawQuotes: !!props.rawQuotes,
    source: props.source || 'core',
    capability: props.capability || 'executable',
    help: props.help || '',
    dryRun: props.dryRun || null,
  };
  var names = [command.name].concat(command.aliases);
  names.forEach(function (name) {
    STSCRIPT_COMMANDS[name] = command;
    if (typeof STSCRIPT_UNAVAILABLE === 'object') delete STSCRIPT_UNAVAILABLE[name];
  });
  return command;
}
// Whether the command runs inside a dry run, for reads that would otherwise show a toast or dialog.
function stscriptDryRunning(args) {
  return !!(args && args._abortController && args._abortController.dryRun);
}
// Declarations for commands that read without a value and write with one.
function stscriptDryRunReadIfEmpty(args, value) {
  return stscriptJoin(value) === '' ? 'run' : null;
}
function stscriptDryRunReadIfBlank(args, value) {
  return stscriptJoin(value).trim() === '' ? 'run' : null;
}
// A read whose `return=` (default `fallback`) may put the result in the chat, a dialog or a toast instead of the pipe.
function stscriptDryRunReadUnlessShown(fallback) {
  var shown = ['chat-html', 'chat-text', 'popup', 'popup-html', 'popup-text', 'toast-html', 'toast-text'];
  return function (args) {
    return shown.includes(String((args && args.return) || fallback).toLowerCase()) ? null : 'run';
  };
}
function stscriptConvertType(value, type) {
  if (!type || type === 'string') return value == null ? '' : String(value);
  if (type === 'number') {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  if (type === 'boolean') return stscriptIsTrue(value);
  if (type === 'list' || type === 'dictionary') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return type === 'list' ? [] : {};
    }
  }
  return value;
}
function stscriptExpandMacros(text, resolver) {
  var source = String(text == null ? '' : text),
    out = '',
    i = 0;
  while (i < source.length) {
    if (source.charAt(i) === '{' && source.charAt(i + 1) === '{') {
      var depth = 1,
        j = i + 2,
        start = j;
      while (j < source.length - 1 && depth > 0) {
        if (source.charAt(j) === '{' && source.charAt(j + 1) === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (source.charAt(j) === '}' && source.charAt(j + 1) === '}') {
          depth--;
          if (depth === 0) break;
          j += 2;
          continue;
        }
        j++;
      }
      if (depth !== 0) {
        out += source.charAt(i);
        i++;
        continue;
      }
      var inner = stscriptExpandMacros(source.slice(start, j), resolver),
        parts = inner.split('::'),
        name = parts[0],
        args = parts.slice(1),
        value = resolver(name, args);
      if (value instanceof StscriptClosure) return value;
      out += value == null ? '' : String(value);
      i = j + 2;
      continue;
    }
    out += source.charAt(i);
    i++;
  }
  return out;
}
function stscriptDelay(ms, controller) {
  ms = Math.max(0, Number(ms) || 0);
  return new Promise(function (resolve, reject) {
    var timer = setInterval(function () {
      if (controller && controller.signal && controller.signal.aborted) {
        clearInterval(timer);
        var error = new Error(controller.signal.reason || '已停止');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      ms -= 50;
      if (ms <= 0) {
        clearInterval(timer);
        resolve('');
      }
    }, 50);
  });
}
function stscriptFormatError(error) {
  if (error instanceof StscriptParserError)
    return '脚本语法错误：' + error.message + '（第 ' + error.line + ' 行第 ' + error.column + ' 列）';
  if (error instanceof StscriptExecutionError)
    return (
      '命令 /' +
      error.commandName +
      ' 失败：' +
      error.message +
      '（第 ' +
      error.line +
      ' 行第 ' +
      error.column +
      ' 列）'
    );
  return String((error && error.message) || error || '脚本失败');
}
async function executeStscript(text, options) {
  options = options || {};
  var activeChar = typeof getChar === 'function' ? getChar() : null;
  if (activeChar && typeof isRisuCharacter === 'function' && isRisuCharacter(activeChar))
    throw new Error('Risu 卡片不运行 TavernHelper / STScript 指令');
  if (text == null || String(text).trim() === '')
    return {
      pipe: '',
      isAborted: false,
      isQuietlyAborted: false,
      abortReason: '',
      isBreak: false,
      isReturned: false,
      isError: false,
    };
  var abort = options.abortController || new StscriptAbortController(),
    parser = new StscriptParser(),
    closure;
  try {
    closure = parser.parse(text, options.verifyCommandNames !== false, options.parserFlags || null, abort);
  } catch (error) {
    if (options.handleParserErrors) {
      if (typeof toast === 'function') toast(stscriptFormatError(error), 'err');
      return {
        pipe: '',
        isAborted: false,
        isQuietlyAborted: false,
        abortReason: '',
        isBreak: false,
        isReturned: false,
        isError: true,
        errorMessage: stscriptFormatError(error),
        error: error,
      };
    }
    throw error;
  }
  if (options.scope) closure.scope.parent = options.scope;
  closure.onProgress = options.onProgress || null;
  closure.source = options.source || closure.source;
  try {
    return await closure.execute();
  } catch (error) {
    if (options.handleExecutionErrors) {
      if (typeof toast === 'function') toast(stscriptFormatError(error), 'err');
      return {
        pipe: '',
        isAborted: false,
        isQuietlyAborted: false,
        abortReason: '',
        isBreak: false,
        isReturned: false,
        isError: true,
        errorMessage: stscriptFormatError(error),
        error: error,
      };
    }
    throw error;
  }
}
stscriptAddCommand({
  name: 'parser-flag',
  dryRun: 'run',
  capability: 'executable',
  splitUnnamedArgument: true,
  callback: function () {
    return '';
  },
});
stscriptAddCommand({
  name: '/',
  dryRun: 'run',
  aliases: ['#'],
  capability: 'executable',
  callback: function () {
    return '';
  },
});
stscriptAddCommand({
  name: 'breakpoint',
  dryRun: 'run',
  capability: 'executable',
  callback: function () {
    return '';
  },
});
stscriptAddCommand({
  name: 'break',
  dryRun: 'run',
  capability: 'executable',
  callback: function (args, value) {
    return value;
  },
});
stscriptAddCommand({
  name: 'return',
  dryRun: 'run',
  capability: 'executable',
  callback: function (args, value) {
    return Array.isArray(value) ? value.join(' ') : value;
  },
});
