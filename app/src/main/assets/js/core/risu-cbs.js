function installYeyuRisuCBS(g) {
  'use strict';

  // RisuAI v2026.10.211 parser/CBS semantics, rewritten as a synchronous,
  // dependency-free evaluator. Runtime integration supplies all mutable state.
  var BLOCKS = Object.freeze([
    '#when',
    '#if',
    '#if_pure',
    '#each',
    '#pure',
    '#puredisplay',
    '#escape',
    '#func',
    '#code',
  ]);
  var DEFERRED = Object.freeze([
    'asset',
    'emotion',
    'audio',
    'bg',
    'bgm',
    'video',
    'video-img',
    'image',
    'img',
    'path',
    'raw',
    'inlay',
    'inlayed',
    'inlayeddata',
    'source',
  ]);
  var HOST_CONTEXT = Object.freeze([
    'model',
    'axmodel',
    'jbtoggled',
    'maxcontext',
    'risu',
    'lorebook',
    'chardisplayasset',
    'moduleenabled',
    'moduleassetlist',
    'metadata',
    'prefillsupported',
    'screenwidth',
    'screenheight',
  ]);
  var DOC_ONLY = Object.freeze(['position']);
  var UNSUPPORTED = Object.freeze([]);
  var UNSUPPORTED_PARSER = Object.freeze([]);
  var SUPPORTED_OFFICIAL = Object.freeze([
    '?',
    '//',
    ':else',
    '#each',
    '#escape',
    '#if',
    '#if_pure',
    '#pure',
    '#puredisplay',
    '#when',
    'abs',
    'addvar',
    'all',
    'and',
    'any',
    'arrayassert',
    'arrayelement',
    'arraylength',
    'arraypop',
    'arraypush',
    'arrayshift',
    'arraysplice',
    'assetlist',
    'authornote',
    'average',
    'bc',
    'blank',
    'bo',
    'br',
    'calc',
    'capitalize',
    'cbr',
    'ceil',
    'char',
    'charhistory',
    'chatindex',
    'contains',
    'decbc',
    'decbo',
    'description',
    'dictelement',
    'displayescapedanglebracketclose',
    'displayescapedanglebracketopen',
    'displayescapedbracketclose',
    'displayescapedbracketopen',
    'displayescapedcolon',
    'displayescapedsemicolon',
    'element',
    'emotionlist',
    'endswith',
    'equal',
    'exampledialogue',
    'filter',
    'firstmsgindex',
    'fixnum',
    'floor',
    'fromhex',
    'getglobalvar',
    'getvar',
    'globalnote',
    'greater',
    'greaterequal',
    'history',
    'isfirstmsg',
    'jb',
    'join',
    'lastmessage',
    'lastmessageid',
    'length',
    'less',
    'lessequal',
    'lower',
    'mainprompt',
    'makearray',
    'makedict',
    'max',
    'min',
    'not',
    'notequal',
    'objectassert',
    'or',
    'persona',
    'personality',
    'pick',
    'pow',
    'previouscharchat',
    'previouschatlog',
    'previoususerchat',
    'randint',
    'random',
    'range',
    'remaind',
    'replace',
    'return',
    'reverse',
    'role',
    'round',
    'scenario',
    'setdefaultvar',
    'settempvar',
    'setvar',
    'slot',
    'split',
    'spread',
    'startswith',
    'sum',
    'tempvar',
    'tohex',
    'tonumber',
    'trim',
    'u',
    'ue',
    'unicodedecode',
    'unicodeencode',
    'upper',
    'user',
    'userhistory',
    'trigger_id',
    'messagetime',
    'messagedate',
    'messageunixtimearray',
    'unixtime',
    'date',
    'time',
    'isotime',
    'isodate',
    'messageidleduration',
    'idleduration',
    'model',
    'axmodel',
    'jbtoggled',
    'maxcontext',
    'button',
    'risu',
    'file',
    'chardisplayasset',
    'lorebook',
    'moduleenabled',
    'moduleassetlist',
    'metadata',
    'prefillsupported',
    'screenwidth',
    'screenheight',
    'hash',
    'dice',
    'roll',
    'rollp',
    'iserror',
    'xor',
    'xordecrypt',
    'crypt',
    'hiddenkey',
    'comment',
    'tex',
    'ruby',
    'codeblock',
    'bkspc',
    'erase',
    'declare',
    '__',
  ]);

  function RisuCBSError(code, message, detail) {
    this.name = 'RisuCBSError';
    this.code = code;
    this.message = message;
    this.detail = detail || null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, RisuCBSError);
  }
  RisuCBSError.prototype = Object.create(Error.prototype);
  RisuCBSError.prototype.constructor = RisuCBSError;

  function normalizeName(value) {
    return String(value || '')
      .toLocaleLowerCase()
      .replace(/[\s_-]/g, '');
  }

  function named(list, normalized) {
    for (var i = 0; i < list.length; i++) if (normalizeName(list[i]) === normalized) return list[i];
    return '';
  }

  function own(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  // Escape macros emit private-use placeholders so nested macro arguments never split on them;
  // the outermost evaluation restores the display characters, like upstream risuUnescape.
  var ESCAPE_TEXT = ['{', '}', '(', ')', '&lt;', '&gt;', ':', ';'];
  function escaped(text) {
    return String.fromCharCode(0xe9b8 + ESCAPE_TEXT.indexOf(text));
  }
  function escapeBrackets(text) {
    return text.replace(/[{}()]/g, escaped);
  }
  function unescapeText(text) {
    return text.replace(/[\ue9b8-\ue9bf]/g, function (placeholder) {
      return ESCAPE_TEXT[placeholder.charCodeAt(0) - 0xe9b8];
    });
  }

  function valueString(value) {
    if (value === undefined || value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function parseArray(value) {
    try {
      var parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : String(value).split('\u00a7');
    } catch (_) {
      return String(value).split('\u00a7');
    }
  }

  function parseDict(value) {
    try {
      var parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function makeArray(values) {
    return JSON.stringify(
      values.map(function (value) {
        return typeof value === 'string' ? value.replace(/::/g, '\\u003A\\u003A') : value;
      })
    );
  }

  function utf8Bytes(value) {
    var encoded = unescape(encodeURIComponent(String(value))),
      out = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i);
    return out;
  }

  function utf8Text(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    try {
      return decodeURIComponent(escape(binary));
    } catch (_) {
      return binary;
    }
  }

  var BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64Encode(bytes) {
    var output = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i],
        b = i + 1 < bytes.length ? bytes[i + 1] : 0,
        c = i + 2 < bytes.length ? bytes[i + 2] : 0,
        value = (a << 16) | (b << 8) | c;
      output += BASE64.charAt((value >>> 18) & 63);
      output += BASE64.charAt((value >>> 12) & 63);
      output += i + 1 < bytes.length ? BASE64.charAt((value >>> 6) & 63) : '=';
      output += i + 2 < bytes.length ? BASE64.charAt(value & 63) : '=';
    }
    return output;
  }

  function base64Decode(value) {
    var input = String(value || '').replace(/[^A-Za-z0-9+/=]/g, ''),
      output = [];
    for (var i = 0; i < input.length; i += 4) {
      var a = BASE64.indexOf(input.charAt(i)),
        b = BASE64.indexOf(input.charAt(i + 1)),
        c = input.charAt(i + 2) === '=' ? -1 : BASE64.indexOf(input.charAt(i + 2)),
        d = input.charAt(i + 3) === '=' ? -1 : BASE64.indexOf(input.charAt(i + 3));
      if (a < 0 || b < 0) break;
      output.push((a << 2) | (b >>> 4));
      if (c >= 0) output.push(((b & 15) << 4) | (c >>> 2));
      if (d >= 0) output.push(((c & 3) << 6) | d);
    }
    return new Uint8Array(output);
  }

  function durationText(milliseconds) {
    var seconds = Math.floor(milliseconds / 1000),
      minutes = Math.floor(seconds / 60),
      hours = Math.floor(minutes / 60);
    return String(hours) + ':' + String(minutes % 60).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  function normalizeCode(value) {
    return String(value)
      .trim()
      .replaceAll('\n', '')
      .replaceAll('\t', '')
      .replace(/\\u([0-9A-Fa-f]{4})/g, function (_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      })
      .replace(/\\(.)/g, function (_, escaped) {
        switch (escaped) {
          case 'n':
            return '\n';
          case 'r':
            return '\r';
          case 't':
            return '\t';
          case 'b':
            return '\b';
          case 'f':
            return '\f';
          case 'v':
            return '\v';
          case 'a':
            // The fixed upstream source uses JavaScript's legacy `\a`
            // spelling, whose runtime value is the literal letter "a".
            return 'a';
          case 'x':
            return '\x00';
          default:
            return escaped;
        }
      });
  }

  function trimLegacy(value) {
    return String(value)
      .trim()
      .split('\n')
      .map(function (line) {
        return line.trimStart();
      })
      .join('\n')
      .trim();
  }

  function trimWhen(value) {
    var lines = String(value).split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  }

  // Pairs every "{{" with its "}}" in one pass, like upstream's parser stack (parser.svelte.ts:1673-1813):
  // delimiter pairs only, not JavaScript strings or JSON objects. An opening left without a partner
  // is absent from the map; the parser keeps it as plain text and evaluates the macros after it.
  function tagEnds(source) {
    var ends = new Map(),
      openings = [];
    for (var i = 0; i < source.length - 1; i++) {
      if (source.charAt(i) === '{' && source.charAt(i + 1) === '{') {
        openings.push(i);
        i++;
      } else if (source.charAt(i) === '}' && source.charAt(i + 1) === '}') {
        if (openings.length) ends.set(openings.pop(), i + 2);
        i++;
      }
    }
    return ends;
  }

  // Upstream risuChatParser rewrites <user>, <char> and <bot> (any case) as macros before parsing
  // (parser.svelte.ts:1666), so they also count as CBS syntax for callers that skip plain text.
  var ROLE_TAG = /<(user|char|bot)>/gi;
  function hasMacros(text) {
    var value = String(text === undefined || text === null ? '' : text);
    return value.indexOf('{{') >= 0 || /<(?:user|char|bot)>/i.test(value);
  }

  // Each rewrite grows the text by two characters; maps a rewritten offset back onto the caller's
  // text, and offsets inside a rewritten tag onto the matching position of the original tag.
  function originOffsets(rewrites) {
    return function (at) {
      var low = 0,
        high = rewrites.length;
      while (low < high) {
        var middle = (low + high) >> 1;
        if (rewrites[middle].at + 2 * middle < at) low = middle + 1;
        else high = middle;
      }
      if (!low) return at;
      var last = rewrites[low - 1],
        rewrittenStart = last.at + 2 * (low - 1);
      if (at >= rewrittenStart + last.length + 2) return at - 2 * low;
      return last.at + Math.min(last.length, Math.max(0, at - rewrittenStart - 1));
    };
  }

  function remapOffsets(nodes, origin) {
    nodes.forEach(function (node) {
      node.start = origin(node.start);
      node.end = origin(node.end);
      if (node.type !== 'block') return;
      node.bodyStart = origin(node.bodyStart);
      node.bodyEnd = origin(node.bodyEnd);
      if (node.alternateStart >= 0) {
        node.alternateStart = origin(node.alternateStart);
        node.alternateEnd = origin(node.alternateEnd);
      }
      remapOffsets(node.body, origin);
      remapOffsets(node.alternate, origin);
    });
  }

  // The tree evaluate runs: role tags rewritten as upstream does, while node offsets index the
  // caller's text so output, branch and history traces still line up with it. Raw node strings
  // keep the rewritten form, which is what upstream's #pure and unknown macros return.
  function parseSource(text) {
    var rewrites = [],
      source = String(text).replace(ROLE_TAG, function (match, name, offset) {
        rewrites.push({ at: offset, length: match.length });
        return '{{' + name + '}}';
      }),
      nodes = parseTemplate(source);
    if (rewrites.length) remapOffsets(nodes, originOffsets(rewrites));
    return nodes;
  }

  function blockKind(tag) {
    var clean = tag.trim();
    if (clean === '#func' || clean.indexOf('#func::') === 0) return '';
    if (clean.startsWith('#code') && clean !== '#code') return '';
    for (var i = 0; i < BLOCKS.length; i++) {
      if (clean === BLOCKS[i] || clean.indexOf(BLOCKS[i] + ' ') === 0 || clean.indexOf(BLOCKS[i] + '::') === 0)
        return BLOCKS[i];
    }
    return '';
  }

  function parseTemplate(source) {
    function frame(start, allowStop) {
      return { nodes: [], cursor: start, textStart: start, allowStop: allowStop, pending: null };
    }
    var stack = [frame(0, false)],
      ends = tagEnds(source);
    function pushText(current, end) {
      if (end > current.textStart)
        current.nodes.push({
          type: 'text',
          value: source.slice(current.textStart, end),
          start: current.textStart,
          end: end,
        });
    }
    function complete(result) {
      stack.pop();
      if (!stack.length) return result.nodes;
      var parent = stack[stack.length - 1],
        pending = parent.pending;
      if (!pending.first) {
        pending.first = result;
        if (result.stop === ':else') {
          stack.push(frame(result.pos, true));
          return null;
        }
      }
      var first = pending.first,
        alternate = result === first ? null : result;
      if (!result.stop || result.stop.charAt(0) !== '/') {
        parent.nodes.push({
          type: 'broken',
          raw: source.slice(pending.open, result.pos),
          tag: pending.tag,
          start: pending.open,
          end: result.pos,
        });
      } else {
        parent.nodes.push({
          type: 'block',
          kind: pending.kind,
          tag: pending.tag,
          body: first.nodes,
          alternate: alternate ? alternate.nodes : [],
          raw: source.slice(pending.open, result.pos),
          bodyRaw: source.slice(pending.end, first.stopStart),
          alternateRaw: alternate ? source.slice(first.pos, alternate.stopStart) : '',
          start: pending.open,
          end: result.pos,
          bodyStart: pending.end,
          bodyEnd: first.stopStart,
          alternateStart: alternate ? first.pos : -1,
          alternateEnd: alternate ? alternate.stopStart : -1,
        });
      }
      parent.cursor = parent.textStart = result.pos;
      parent.pending = null;
      return null;
    }
    while (stack.length) {
      var current = stack[stack.length - 1],
        open = source.indexOf('{{', current.cursor),
        result;
      if (open < 0) {
        pushText(current, source.length);
        result = complete({ nodes: current.nodes, pos: source.length, stop: '', stopStart: source.length });
        if (result) return result;
        continue;
      }
      var end = ends.get(open);
      if (end === undefined) {
        // An unclosed "{{" stays in the surrounding text node.
        current.cursor = open + 2;
        continue;
      }
      var tag = source.slice(open + 2, end - 2),
        trimmed = tag.trim();
      pushText(current, open);
      if (
        current.allowStop &&
        ((trimmed === ':else' && !['#pure', '#puredisplay', '#escape', '#func'].includes(current.allowStop)) ||
          (trimmed.charAt(0) === '/' && trimmed.indexOf('//') !== 0))
      ) {
        result = complete({ nodes: current.nodes, pos: end, stop: trimmed, stopStart: open });
        if (result) return result;
        continue;
      }
      var kind = blockKind(tag);
      if (kind) {
        current.pending = { open: open, end: end, tag: tag, kind: kind, first: null };
        stack.push(frame(end, kind));
      } else {
        current.nodes.push({ type: 'macro', tag: tag, raw: source.slice(open, end), start: open, end: end });
        current.cursor = current.textStart = end;
      }
    }
    return [];
  }

  function pickRandom(messageCount, identity) {
    // util.ts pickHashRand: four cumulative string hashes seed sfc32, then
    // advance by the current chat's message count modulo 1000.
    var hash = 5515;
    function seed() {
      for (var i = 0; i < identity.length; i++) hash = (hash << 5) + hash + identity.charCodeAt(i);
      return hash;
    }
    var a = seed(),
      b = seed(),
      c = seed(),
      d = seed();
    function next() {
      a |= 0;
      b |= 0;
      c |= 0;
      d |= 0;
      var t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    }
    for (var i = 0; i < messageCount % 1000; i++) next();
    return next();
  }

  // Fixed Risu process/infunctions.ts calcString semantics. This intentionally
  // preserves its permissive tokenization and left-associative exponentiation.
  function safeMath(expression, getChatVariable, getGlobalVariable) {
    var operators = {
        '+': { precedence: 2, associativity: 'Left' },
        '-': { precedence: 2, associativity: 'Left' },
        '*': { precedence: 3, associativity: 'Left' },
        '/': { precedence: 3, associativity: 'Left' },
        '^': { precedence: 4, associativity: 'Left' },
        '%': { precedence: 3, associativity: 'Left' },
        '<': { precedence: 1, associativity: 'Left' },
        '>': { precedence: 1, associativity: 'Left' },
        '|': { precedence: 1, associativity: 'Left' },
        '&': { precedence: 1, associativity: 'Left' },
        '≤': { precedence: 1, associativity: 'Left' },
        '≥': { precedence: 1, associativity: 'Left' },
        '=': { precedence: 1, associativity: 'Left' },
        '≠': { precedence: 1, associativity: 'Left' },
        '!': { precedence: 5, associativity: 'Right' },
      },
      operatorKeys = Object.keys(operators);

    function toRPN(input) {
      var output = '',
        operatorStack = [],
        tokens = [],
        lastToken = '';
      input = input.replace(/\s+/g, '');
      for (var i = 0; i < input.length; i++) {
        var character = input[i];
        if (character === '-' && (i === 0 || operatorKeys.indexOf(input[i - 1]) >= 0 || input[i - 1] === '(')) {
          lastToken += character;
        } else if (operatorKeys.indexOf(character) >= 0) {
          tokens.push(lastToken !== '' ? lastToken : '0');
          lastToken = '';
          tokens.push(character);
        } else lastToken += character;
      }
      tokens.push(lastToken !== '' ? lastToken : '0');
      tokens.forEach(function (token) {
        if (parseFloat(token) || token === '0') output += token + ' ';
        else if (operatorKeys.indexOf(token) >= 0) {
          while (
            operatorStack.length > 0 &&
            ((operators[token].associativity === 'Left' &&
              operators[token].precedence <= operators[operatorStack[operatorStack.length - 1]].precedence) ||
              (operators[token].associativity === 'Right' &&
                operators[token].precedence < operators[operatorStack[operatorStack.length - 1]].precedence))
          )
            output += operatorStack.pop() + ' ';
          operatorStack.push(token);
        }
      });
      while (operatorStack.length > 0) output += operatorStack.pop() + ' ';
      return output.trim();
    }

    function calculateRPN(input) {
      var stack = [];
      input.split(' ').forEach(function (token) {
        if (parseFloat(token) || token === '0') stack.push(parseFloat(token));
        else {
          var b = stack.pop(),
            a = stack.pop();
          switch (token) {
            case '+':
              stack.push(a + b);
              break;
            case '-':
              stack.push(a - b);
              break;
            case '*':
              stack.push(a * b);
              break;
            case '/':
              stack.push(a / b);
              break;
            case '^':
              stack.push(a ** b);
              break;
            case '%':
              stack.push(a % b);
              break;
            case '<':
              stack.push(a < b ? 1 : 0);
              break;
            case '>':
              stack.push(a > b ? 1 : 0);
              break;
            case '|':
              stack.push(a || b);
              break;
            case '&':
              stack.push(a && b);
              break;
            case '≤':
              stack.push(a <= b ? 1 : 0);
              break;
            case '≥':
              stack.push(a >= b ? 1 : 0);
              break;
            case '=':
              stack.push(a === b ? 1 : 0);
              break;
            case '≠':
              stack.push(a !== b ? 1 : 0);
              break;
            case '!':
              stack.push(b ? 0 : 1);
              break;
          }
        }
      });
      return stack.length === 0 ? 0 : stack.pop();
    }

    function execute(input) {
      input = String(input)
        .replace(/\$([a-zA-Z0-9_]+)/g, function (_, name) {
          var parsed = parseFloat(typeof getChatVariable === 'function' ? getChatVariable(name) : 'null');
          return Number.isNaN(parsed) ? '0' : parsed.toString();
        })
        .replace(/\@([a-zA-Z0-9_]+)/g, function (_, name) {
          var parsed = parseFloat(typeof getGlobalVariable === 'function' ? getGlobalVariable(name) : 'null');
          return Number.isNaN(parsed) ? '0' : parsed.toString();
        })
        .replace(/&&/g, '&')
        .replace(/\|\|/g, '|')
        .replace(/<=/g, '≤')
        .replace(/>=/g, '≥')
        .replace(/==/g, '=')
        .replace(/!=/g, '≠')
        .replace(/null/gi, '0');
      return calculateRPN(toRPN(input));
    }

    var depthText = [''],
      source = String(expression || '');
    for (var i = 0; i < source.length; i++) {
      if (source[i] === '(') depthText.push('');
      else if (source[i] === ')' && depthText.length > 1) {
        var result = execute(depthText.pop());
        depthText[depthText.length - 1] += result;
      } else depthText[depthText.length - 1] += source[i];
    }
    return execute(depthText.join(''));
  }

  function evaluate(text, context) {
    context = context || {};
    var calls = context._cbsCalls || { count: 0 };
    calls.count++;
    var outputTrace = Array.isArray(context.outputTrace) && calls.count === 1 ? context.outputTrace : null,
      traceParent = null,
      tracedNodes = outputTrace || Number.isFinite(context.historyEffectStart) ? new Set() : null,
      historyWriteAllowed = true;
    var state = {
      temp: Object.assign(Object.create(null), context.tempVariables || {}),
      returned: false,
      returnValue: 'null',
      functions: context._cbsFunctions || Object.create(null),
      outputFrames: [],
    };

    // Optional branch tracing. Only blocks of the root source tree are reported, so callers can map
    // a record back to an offset in the text they passed in; trees re-parsed by evalEmbedded, host
    // macros or function calls have no such offsets and stay out of the trace.
    var branchTrace = Array.isArray(context.branchTrace) ? context.branchTrace : null,
      rootBlocks = null;
    function collectRootBlocks(nodes) {
      var pending = nodes.slice();
      while (pending.length) {
        var node = pending.pop();
        if (node.type !== 'block') continue;
        rootBlocks.add(node);
        for (var i = 0; i < node.body.length; i++) pending.push(node.body[i]);
        for (var j = 0; j < node.alternate.length; j++) pending.push(node.alternate[j]);
      }
    }
    function traceBranch(node, branch) {
      if (!branchTrace || !rootBlocks.has(node)) return;
      branchTrace.push({ start: node.start, end: node.end, kind: node.kind, branch: branch });
    }

    function fail(code, message, node) {
      var detail = { code: code, message: message, macro: (node && node.raw) || '', position: node && node.start };
      if (typeof context.onError === 'function') context.onError(detail);
      if (context.strict) throw new RisuCBSError(code, message, detail);
      return (node && node.raw) || '';
    }

    function getChatVar(name) {
      var value;
      if (typeof context.getChatVar === 'function') value = context.getChatVar(String(name));
      else if (own(context.chatVariables, String(name))) value = context.chatVariables[String(name)];
      else if (own(context.chatVariables, '$' + String(name))) value = context.chatVariables['$' + String(name)];
      return value === undefined || value === null ? 'null' : String(value);
    }
    function setChatVar(name, value) {
      if (typeof context.setChatVar === 'function') context.setChatVar(String(name), String(value));
      else if (context.chatVariables) context.chatVariables['$' + String(name)] = String(value);
    }
    function getGlobalVar(name) {
      var value;
      if (typeof context.getGlobalVar === 'function') value = context.getGlobalVar(String(name));
      else if (own(context.globalVariables, String(name))) value = context.globalVariables[String(name)];
      return value === undefined || value === null ? 'null' : String(value);
    }

    function messages() {
      return Array.isArray(context.messages) ? context.messages : [];
    }
    function messageData(row) {
      return row && row.data !== undefined
        ? String(row.data)
        : row && row.content !== undefined
          ? String(row.content)
          : '';
    }
    function prior(role) {
      var rows = messages(),
        from = Number.isInteger(context.chatIndex) && context.chatIndex >= 0 ? context.chatIndex - 1 : rows.length - 1;
      for (var i = from; i >= 0; i--) if (rows[i] && rows[i].role === role) return messageData(rows[i]);
      if (role === 'char') {
        var chara = context.character || {},
          fm = Number(context.firstMessageIndex);
        if (fm >= 0) return String((chara.alternateGreetings || chara.alternate_greetings || [])[fm] || '');
        return String(chara.firstMessage || chara.first_mes || '');
      }
      return '';
    }
    function jsonHistory(role, prefixRole, depth) {
      return makeArray(
        messages()
          .filter(function (row) {
            return !role || row.role === role;
          })
          .map(function (row) {
            if (prefixRole) return String(row.role || '') + ': ' + messageData(row);
            return JSON.stringify(Object.assign({}, row, { data: evalEmbedded(messageData(row), depth) }));
          })
      );
    }

    // Tags and host text such as descriptions or history rows, which upstream passes through
    // risuChatParser again.
    function evalEmbedded(value, depth) {
      if (!hasMacros(value)) return String(value);
      return evalNodes(parseSource(value), depth + 1);
    }

    function splitTag(tag, depth) {
      var resolved = evalEmbedded(tag, depth),
        colon = resolved.indexOf(':'),
        parts;
      if (colon !== -1 && resolved.charAt(colon + 1) === ':') parts = resolved.split('::');
      else parts = resolved.split(':');
      return { raw: resolved, name: normalizeName(parts[0]), args: parts.slice(1) };
    }

    function hostValue(name, args, node) {
      if (typeof context.resolveHostMacro === 'function') {
        try {
          var value = context.resolveHostMacro(name, args.slice(), {
            raw: node.raw,
            displaying: context.displaying === true || context.mode === 'display',
            mode: context.mode || '',
          });
          if (value && typeof value.then === 'function')
            return fail('ASYNC_HOST_UNSUPPORTED', 'Risu CBS host context must be synchronous: ' + name, node);
          if (value !== undefined && value !== null) return String(value);
        } catch (_) {
          return fail('HOST_CONTEXT_ERROR', 'Risu CBS host context failed: ' + name, node);
        }
      }
      return fail('HOST_CONTEXT_REQUIRED', 'Risu CBS macro requires host context: ' + name, node);
    }

    function currentDate() {
      if (typeof context.onClockRead === 'function') context.onClockRead();
      var source = typeof context.now === 'function' ? context.now() : context.now;
      if (source === undefined || source === null) return new Date();
      return source instanceof Date ? new Date(source.getTime()) : new Date(source);
    }

    function dateTimeFormat(format, timestamp) {
      var date = timestamp === undefined || timestamp === null || timestamp === 0 ? currentDate() : new Date(timestamp);
      var main = String(format || '');
      if (!main) return '';
      if (main.charAt(0) === ':') main = main.slice(1);
      if (main.length > 300) return '';
      return main
        .replace(/YYYY/g, String(date.getFullYear()))
        .replace(/YY/g, String(date.getFullYear()).slice(2))
        .replace(/MMMM/g, new Intl.DateTimeFormat('en', { month: 'long' }).format(date))
        .replace(/MMM/g, new Intl.DateTimeFormat('en', { month: 'short' }).format(date))
        .replace(/MM/g, String(date.getMonth() + 1).padStart(2, '0'))
        .replace(
          /DDDD/g,
          String(Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000))
        )
        .replace(/DD/g, String(date.getDate()).padStart(2, '0'))
        .replace(/dddd/g, new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date))
        .replace(/ddd/g, new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date))
        .replace(/HH/g, String(date.getHours()).padStart(2, '0'))
        .replace(/hh/g, String(date.getHours() % 12 || 12).padStart(2, '0'))
        .replace(/mm/g, String(date.getMinutes()).padStart(2, '0'))
        .replace(/ss/g, String(date.getSeconds()).padStart(2, '0'))
        .replace(/X/g, String(Math.floor(date.getTime() / 1000)))
        .replace(/x/g, String(date.getTime()))
        .replace(/A/g, date.getHours() >= 12 ? 'PM' : 'AM');
    }

    function findAsset(map, list, name) {
      var lower = String(name).toLocaleLowerCase(),
        value,
        i;
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        value = own(map, name) ? map[name] : own(map, lower) ? map[lower] : undefined;
        if (value !== undefined) return value;
      }
      if (!Array.isArray(list)) return undefined;
      for (i = 0; i < list.length; i++) {
        value = list[i];
        if (Array.isArray(value) && String(value[0]).toLocaleLowerCase() === lower)
          return { name: value[0], url: value[1], type: value[2] };
        if (value && typeof value === 'object' && String(value.name || '').toLocaleLowerCase() === lower) return value;
      }
      return undefined;
    }

    function assetUrl(entry) {
      if (entry === undefined || entry === null) return undefined;
      if (typeof entry === 'string') return entry;
      return entry.url !== undefined ? entry.url : entry.value !== undefined ? entry.value : entry.src;
    }

    function renderAsset(name, assetName, entry) {
      var url = assetUrl(entry),
        width =
          context.assetWidth === undefined || Number(context.assetWidth) === -1
            ? ''
            : 'max-width:' + context.assetWidth + 'rem;',
        mime = String((entry && (entry.mime || entry.mimeType || entry.type)) || '');
      if (url === undefined || url === null) return undefined;
      url = String(url);
      if (name === 'raw' || name === 'path' || name === 'source') return url;
      if (name === 'emotion' || name === 'img')
        return '<img src="' + url + '" alt="' + url + '" style="' + width + ' "/>';
      if (name === 'image')
        return '<div class="risu-inlay-image"><img src="' + url + '" alt="' + url + '" style="' + width + '"/></div>\n';
      if (name === 'video')
        return '<video controls autoplay loop><source src="' + url + '" type="video/mp4"></video>\n';
      if (name === 'videoimg')
        return '<video autoplay muted loop><source src="' + url + '" type="video/mp4"></video>\n';
      if (name === 'audio')
        return '<audio controls autoplay loop><source src="' + url + '" type="audio/mpeg"></audio>\n';
      if (name === 'bgm') return '<div risu-ctrl="bgm___auto___' + url + '" style="display:none;"></div>\n';
      if (name === 'bg')
        return context.mode === 'back'
          ? '<div style="width:100%;height:100%;background: linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.8)),url(' +
              url +
              '); background-size: cover;"></div>'
          : '';
      if (name === 'asset') {
        if (/video|mp4|webm|avi|m4p|m4v/i.test(mime))
          return '<video autoplay muted loop><source src="' + url + '" type="video/mp4"></video>\n';
        return '<img src="' + url + '" alt="' + url + '" style="' + width + ' "/>\n';
      }
      if (name === 'inlay' || name === 'inlayed' || name === 'inlayeddata') {
        var media = /audio/i.test(mime)
          ? '<audio controls><source src="' + url + '" type="audio/mpeg"></audio>'
          : /video/i.test(mime)
            ? '<video controls><source src="' + url + '" type="video/mp4"></video>'
            : '<img src="' + url + '"/>';
        return name === 'inlay' ? media : '<div class="risu-inlay-image">' + media + '</div>\n\n';
      }
      return undefined;
    }

    function deferred(node, name, split) {
      var normalized = normalizeName(name),
        assetName = split.args[0] || '',
        entry;
      if (typeof context.resolveAsset === 'function') {
        try {
          var resolved = context.resolveAsset(name === 'raw' ? 'path' : name, assetName, split.args.slice(1));
          if (resolved !== undefined && resolved !== null) {
            if (resolved && typeof resolved.then === 'function')
              return fail('ASYNC_ASSET_UNSUPPORTED', 'Risu CBS asset context must be synchronous: ' + name, node);
            if (typeof resolved !== 'object') return String(resolved);
            var rendered = renderAsset(normalized, assetName, resolved);
            if (rendered !== undefined) return rendered;
          }
        } catch (_) {
          return fail('ASSET_CONTEXT_ERROR', 'Risu CBS asset context failed: ' + name, node);
        }
      }
      if (
        context.resolveAssets !== true &&
        context.displaying !== true &&
        context.mode !== 'display' &&
        context.mode !== 'back'
      )
        return '{{' + split.raw + '}}';
      if (normalized === 'emotion') entry = findAsset(context.emotionMap, context.emotions, assetName);
      else if (normalized === 'source') entry = findAsset(context.sourceMap, [], assetName);
      else entry = findAsset(context.assetMap, context.assets, assetName);
      resolved = renderAsset(normalized, assetName, entry);
      if (resolved !== undefined) return resolved;
      return '';
    }

    function inline(node, depth) {
      if (node.tag.indexOf('? ') === 0) {
        try {
          return String(safeMath(evalEmbedded(node.tag.slice(2), depth), getChatVar, getGlobalVar));
        } catch (_) {
          return '0';
        }
      }
      var parsed = splitTag(node.tag, depth),
        name = parsed.name,
        a = parsed.args;
      // // is doc_only in the fixed upstream registry. The parser preserves
      // its text (after nested CBS evaluation); it is not a closing tag.
      if (parsed.raw.trimStart().indexOf('//') === 0) return '{{' + parsed.raw + '}}';
      // :each is a registered doc-only alias; upstream's block matcher only
      // opens #each, so this spelling remains literal after nested evaluation.
      if (parsed.raw === ':each' || parsed.raw.startsWith(':each::') || parsed.raw.startsWith(':each '))
        return '{{' + parsed.raw + '}}';
      if (parsed.raw.indexOf('call::') === 0) {
        var callArgs = parsed.raw.split('::').slice(1),
          functionName = callArgs[0],
          definition = state.functions[functionName];
        if (!definition) return node.raw;
        if (calls.count > 20) return 'ERROR: Call stack limit reached';
        var functionText = definition.data;
        for (var argumentIndex = 0; argumentIndex < callArgs.length; argumentIndex++)
          functionText = functionText.replaceAll('{{arg::' + argumentIndex + '}}', callArgs[argumentIndex]);
        return evaluate(
          functionText,
          Object.assign({}, context, {
            _cbsFunctions: state.functions,
            _cbsCalls: calls,
            tempVariables: undefined,
            historyEffectStart: undefined,
            rmVar: context.rmVar || !historyWriteAllowed,
          })
        );
      }
      var deferredName = named(DEFERRED, name);
      if (deferredName) return deferred(node, deferredName, parsed);
      if (named(UNSUPPORTED, name) || named(UNSUPPORTED_PARSER, name) || node.tag.trim().indexOf('call::') === 0)
        return fail('UNSUPPORTED_MACRO', 'Unsupported Risu CBS macro: ' + node.tag.trim(), node);
      var chara = context.character || {},
        rows = messages(),
        nums,
        arr,
        obj,
        val,
        i;
      switch (name) {
        case 'char':
        case 'bot':
          return String(context.characterName || chara.nickname || chara.name || '');
        case 'user':
          return String(context.userName || '');
        case 'triggerid':
          return context.triggerId === undefined || context.triggerId === null ? 'null' : String(context.triggerId);
        case 'messagetime':
        case 'messagedate':
          if (context.tokenizeAccurate) return '00:00:00';
          if (!Number.isInteger(context.chatIndex) || context.chatIndex < 0) return '[Cannot get time]';
          val = rows[context.chatIndex];
          if (!val || !val.time) return '[Cannot get time, message was sent in older version]';
          return name === 'messagetime'
            ? new Date(val.time).toLocaleTimeString()
            : new Date(val.time).toLocaleDateString();
        case 'messageunixtimearray':
          return makeArray(
            rows.map(function (message) {
              return String((message && message.time) || 0);
            })
          );
        case 'unixtime':
          return (currentDate().getTime() / 1000).toFixed(0);
        case 'time':
        case 'date':
        case 'datetimeformat':
          if (!a.length) {
            val = currentDate();
            return name === 'time'
              ? val.getHours() + ':' + val.getMinutes() + ':' + val.getSeconds()
              : val.getFullYear() + '-' + (val.getMonth() + 1) + '-' + val.getDate();
          }
          val = a[1] ? Number(a[1]) / 1000 : 0;
          if (isNaN(val)) val = 0;
          return dateTimeFormat(a[0], val);
        case 'isotime':
          val = currentDate();
          return val.getUTCHours() + ':' + val.getUTCMinutes() + ':' + val.getUTCSeconds();
        case 'isodate':
          val = currentDate();
          return val.getUTCFullYear() + '-' + (val.getUTCMonth() + 1) + '-' + val.getUTCDate();
        case 'messageidleduration':
          if (context.tokenizeAccurate) return '00:00:00';
          if (!Number.isInteger(context.chatIndex) || context.chatIndex < 0) return '[Cannot get time]';
          var latestUser,
            previousUser,
            messagePointer = context.chatIndex;
          while (messagePointer >= 0) {
            if (rows[messagePointer] && rows[messagePointer].role === 'user') {
              if (!latestUser) latestUser = rows[messagePointer];
              else {
                previousUser = rows[messagePointer];
                break;
              }
            }
            messagePointer--;
          }
          if (!latestUser) return '[No user message found]';
          if (!previousUser) return '[No previous user message found]';
          if (!latestUser.time) return '[Cannot get time, message was sent in older version]';
          if (!previousUser.time) return '[Cannot get time, previous message was sent in older version]';
          return durationText(latestUser.time - previousUser.time);
        case 'idleduration':
          if (context.tokenizeAccurate) return '00:00:00';
          if (!rows.length) return '00:00:00';
          val = rows[rows.length - 1];
          if (!val.time) return '[Cannot get time, message was sent in older version]';
          return durationText(currentDate().getTime() - val.time);
        case 'personality':
        case 'charpersona':
          return evalEmbedded(String(chara.personality || ''), depth);
        case 'description':
        case 'chardesc':
          return evalEmbedded(String(chara.description || chara.desc || ''), depth);
        case 'scenario':
          return evalEmbedded(String(chara.scenario || ''), depth);
        case 'exampledialogue':
        case 'examplemessage':
          return evalEmbedded(String(chara.exampleDialogue || chara.exampleMessage || chara.mes_example || ''), depth);
        case 'persona':
        case 'userpersona':
          return evalEmbedded(String(context.persona || ''), depth);
        case 'mainprompt':
        case 'systemprompt':
          return evalEmbedded(String(context.mainPrompt || ''), depth);
        case 'jb':
        case 'jailbreak':
          return evalEmbedded(String(context.jailbreak || ''), depth);
        case 'globalnote':
        case 'systemnote':
        case 'ujb':
          return evalEmbedded(String(context.globalNote || ''), depth);
        case 'authornote':
          return evalEmbedded(String(context.authorNote || ''), depth);
        case 'model':
          return context.model === undefined ? hostValue(name, a, node) : String(context.model);
        case 'axmodel':
          return context.auxModel === undefined ? hostValue(name, a, node) : String(context.auxModel);
        case 'jbtoggled':
          return context.jailbreakEnabled === undefined
            ? hostValue(name, a, node)
            : context.jailbreakEnabled
              ? '1'
              : '0';
        case 'maxcontext':
          return context.maxContext === undefined ? hostValue(name, a, node) : String(context.maxContext);
        case 'chatindex':
          return String(context.chatIndex === undefined ? -1 : context.chatIndex);
        case 'firstmsgindex':
        case 'firstmessageindex':
          return String(context.firstMessageIndex === undefined ? -1 : context.firstMessageIndex);
        case 'blank':
        case 'none':
        case 'hiddenkey':
          return '';
        case 'br':
        case 'newline':
          return '\n';
        case 'cbr':
        case 'cnl':
        case 'cnewline':
          if (a.length) return parsed.raw.repeat(Number(a[0]) < 1 ? 1 : Number(a[0]));
          return '\\n';
        case 'decbo':
        case 'displayescapedcurlybracketopen':
          return escaped('{');
        case 'decbc':
        case 'displayescapedcurlybracketclose':
          return escaped('}');
        case 'bo':
        case 'ddecbo':
        case 'doubledisplayescapedcurlybracketopen':
          return escaped('{').repeat(2);
        case 'bc':
        case 'ddecbc':
        case 'doubledisplayescapedcurlybracketclose':
          return escaped('}').repeat(2);
        case 'displayescapedbracketopen':
        case 'debo':
          return escaped('(');
        case 'displayescapedbracketclose':
        case 'debc':
          return escaped(')');
        case 'displayescapedanglebracketopen':
        case 'deabo':
          return escaped('&lt;');
        case 'displayescapedanglebracketclose':
        case 'deabc':
          return escaped('&gt;');
        case 'displayescapedcolon':
        case 'dec':
          return escaped(':');
        case 'displayescapedsemicolon':
          return escaped(';');
        case 'role':
          return String(
            context.role || (context.firstMessage ? 'char' : (rows[context.chatIndex] || {}).role) || 'null'
          );
        case 'isfirstmsg':
        case 'isfirstmessage':
          return context.firstMessage ? '1' : '0';
        case 'previouscharchat':
        case 'lastcharmessage':
          return prior('char');
        case 'previoususerchat':
        case 'lastusermessage':
          return prior('user');
        case 'lastmessage':
          return rows.length ? messageData(rows[rows.length - 1]) : '';
        case 'lastmessageid':
        case 'lastmessageindex':
          return rows.length ? String(rows.length - 1) : '';
        case 'previouschatlog':
          return rows[Number(a[0])] ? messageData(rows[Number(a[0])]) : 'Out of range';
        case 'history':
        case 'messages':
          return jsonHistory('', a.indexOf('role') >= 0, depth);
        case 'userhistory':
        case 'usermessages':
          return jsonHistory('user', false, depth);
        case 'charhistory':
        case 'charmessages':
          return jsonHistory('char', false, depth);
        case 'emotionlist':
          return makeArray(
            (context.emotions || []).map(function (x) {
              return Array.isArray(x) ? x[0] : x && x.name !== undefined ? x.name : x;
            })
          );
        case 'assetlist':
          return makeArray(
            (context.assets || []).map(function (x) {
              return Array.isArray(x) ? x[0] : x && x.name !== undefined ? x.name : x;
            })
          );
        case 'chardisplayasset':
          if (!Array.isArray(context.characterDisplayAssets)) return hostValue(name, a, node);
          return makeArray(
            context.characterDisplayAssets.map(function (x) {
              return Array.isArray(x) ? x[0] : x && x.name !== undefined ? x.name : x;
            })
          );
        case 'lorebook':
        case 'worldinfo':
          var lorebooks = typeof context.getLorebooks === 'function' ? context.getLorebooks() : context.lorebooks;
          if (!Array.isArray(lorebooks)) return hostValue('lorebook', a, node);
          return makeArray(
            lorebooks.map(function (entry) {
              return JSON.stringify(entry);
            })
          );
        case 'moduleenabled':
          if (!Array.isArray(context.modules)) return hostValue(name, a, node);
          return context.modules.some(function (module) {
            return module && module.namespace === a[0];
          })
            ? '1'
            : '0';
        case 'moduleassetlist':
          if (!Array.isArray(context.modules)) return hostValue(name, a, node);
          val = context.modules.find(function (module) {
            return module && module.namespace === a[0];
          });
          if (!val) return '';
          return makeArray(
            (val.assets || []).map(function (asset) {
              return Array.isArray(asset) ? asset[0] : asset && asset.name !== undefined ? asset.name : asset;
            })
          );
        case 'prefillsupported':
        case 'prefill':
          if (context.prefillSupported !== undefined) return context.prefillSupported ? '1' : '0';
          if (context.model !== undefined) return String(context.model).startsWith('claude') ? '1' : '0';
          return hostValue('prefillsupported', a, node);
        case 'screenwidth':
          return context.screenWidth === undefined ? hostValue(name, a, node) : String(context.screenWidth);
        case 'screenheight':
          return context.screenHeight === undefined ? hostValue(name, a, node) : String(context.screenHeight);
        case 'metadata':
          var metadataKey = String(a[0] || '').toLocaleLowerCase(),
            metadata = context.metadata || {};
          if (own(metadata, metadataKey)) return String(metadata[metadataKey]);
          if (metadataKey === 'imateapot') return '🫖';
          if (metadataKey === 'maxcontext' && context.maxContext !== undefined) return String(context.maxContext);
          if (metadataKey === 'version' && context.risuCompatibilityVersion !== undefined)
            return String(context.risuCompatibilityVersion);
          if (
            ['majorversion', 'majorver', 'major'].indexOf(metadataKey) >= 0 &&
            context.risuCompatibilityVersion !== undefined
          )
            return String(context.risuCompatibilityVersion).split('.')[0];
          if (['language', 'locale', 'lang'].indexOf(metadataKey) >= 0 && context.language !== undefined)
            return String(context.language);
          if (
            ['browserlanguage', 'browserlocale', 'browserlang'].indexOf(metadataKey) >= 0 &&
            context.browserLanguage !== undefined
          )
            return String(context.browserLanguage);
          if (
            [
              'mobile',
              'local',
              'node',
              'modelshortname',
              'modelname',
              'modelinternalid',
              'modelformat',
              'modelprovider',
              'modeltokenizer',
              'risutype',
            ].indexOf(metadataKey) >= 0
          )
            return hostValue(name, a, node);
          return 'Error: ' + a[0] + ' is not a valid metadata key.';
        case 'button':
          return '<button class="button-default" risu-trigger="' + a[1] + '">' + a[0] + '</button>';
        case 'risu':
          if (context.risuLogoUrl !== undefined)
            return (
              '<img src="' +
              String(context.risuLogoUrl) +
              '" style="height:' +
              (a[0] || '45') +
              'px;width:' +
              (a[0] || '45') +
              'px" />'
            );
          return hostValue(name, a, node);
        case 'file':
          if (context.displaying === true || context.mode === 'display')
            return '<br><div class="risu-file">' + a[0] + '</div><br>';
          return utf8Text(base64Decode(a[1]));
        case 'tempvar':
        case 'gettempvar':
          return own(state.temp, a[0]) ? String(state.temp[a[0]]) : '';
        case 'settempvar':
          state.temp[a[0]] = a[1];
          return '';
        case 'return':
          state.returned = true;
          state.returnValue = a[0] === undefined ? 'null' : a[0];
          return '';
        case 'getvar':
          return getChatVar(a[0]);
        case 'getglobalvar':
          return getGlobalVar(a[0]);
        case 'setvar':
        case 'addvar':
        case 'setdefaultvar':
          if (context.rmVar || !historyWriteAllowed) return '';
          if (!context.runVar)
            return fail('WRITE_DISABLED', 'Risu CBS variable write requires context.runVar: ' + name, node);
          if (name === 'setvar') setChatVar(a[0], a[1]);
          else if (name === 'addvar') setChatVar(a[0], String(Number(getChatVar(a[0])) + Number(a[1])));
          else {
            val = getChatVar(a[0]);
            if (!val || val === 'null') setChatVar(a[0], a[1]);
          }
          return '';
        case 'calc':
          try {
            return String(safeMath(a[0], getChatVar, getGlobalVar));
          } catch (_) {
            return '0';
          }
        case 'equal':
          return a[0] === a[1] ? '1' : '0';
        case 'notequal':
          return a[0] !== a[1] ? '1' : '0';
        case 'greater':
          return Number(a[0]) > Number(a[1]) ? '1' : '0';
        case 'less':
          return Number(a[0]) < Number(a[1]) ? '1' : '0';
        case 'greaterequal':
          return Number(a[0]) >= Number(a[1]) ? '1' : '0';
        case 'lessequal':
          return Number(a[0]) <= Number(a[1]) ? '1' : '0';
        case 'and':
          return a[0] === '1' && a[1] === '1' ? '1' : '0';
        case 'or':
          return a[0] === '1' || a[1] === '1' ? '1' : '0';
        case 'not':
          return a[0] === '1' ? '0' : '1';
        case 'startswith':
          return String(a[0]).startsWith(a[1]) ? '1' : '0';
        case 'endswith':
          return String(a[0]).endsWith(a[1]) ? '1' : '0';
        case 'contains':
          return String(a[0]).includes(a[1]) ? '1' : '0';
        case 'replace':
          return String(a[0]).split(String(a[1])).join(a[2]);
        case 'split':
          return makeArray(String(a[0]).split(a[1]));
        case 'join':
          return parseArray(a[0]).join(a[1]);
        case 'spread':
          return parseArray(a[0]).join('::');
        case 'trim':
          return String(a[0]).trim();
        case 'length':
          return String(String(a[0]).length);
        case 'arraylength':
          return String(parseArray(a[0]).length);
        case 'lower':
          return String(a[0]).toLocaleLowerCase();
        case 'upper':
          return String(a[0]).toLocaleUpperCase();
        case 'capitalize':
          return String(a[0]).charAt(0).toUpperCase() + String(a[0]).slice(1);
        case 'reverse':
          return Array.from(String(a[0] || ''))
            .reverse()
            .join('');
        case 'unicodeencode':
          return String(String(a[0]).charCodeAt(a[1] ? Number(a[1]) : 0));
        case 'unicodedecode':
          return String.fromCharCode(Number(a[0]));
        case 'u':
        case 'ue':
        case 'unicodedecodefromhex':
        case 'unicodeencodefromhex':
          return String.fromCharCode(parseInt(a[0], 16));
        case 'round':
          return String(Math.round(Number(a[0])));
        case 'floor':
          return String(Math.floor(Number(a[0])));
        case 'ceil':
          return String(Math.ceil(Number(a[0])));
        case 'abs':
          return String(Math.abs(Number(a[0])));
        case 'remaind':
          return String(Number(a[0]) % Number(a[1]));
        case 'pow':
          return String(Math.pow(Number(a[0]), Number(a[1])));
        case 'tonumber':
          return Array.from(String(a[0]))
            .filter(function (x) {
              return !isNaN(Number(x)) || x === '.';
            })
            .join('');
        case 'fixnum':
        case 'fixnumber':
          return Number(a[0]).toFixed(Number(a[1]));
        case 'fromhex':
          return String(Number.parseInt(a[0], 16));
        case 'tohex':
          return Number.parseInt(a[0], 10).toString(16);
        case 'makearray':
        case 'array':
        case 'a':
          return makeArray(a);
        case 'makedict':
        case 'dict':
        case 'd':
        case 'makeobject':
        case 'object':
        case 'o':
          obj = {};
          a.forEach(function (entry) {
            var eq = entry.indexOf('=');
            if (eq >= 0) obj[entry.slice(0, eq)] = entry.slice(eq + 1);
          });
          return JSON.stringify(obj);
        case 'arrayelement':
          val = parseArray(a[0]).at(Number(a[1]));
          return valueString(val);
        case 'dictelement':
        case 'objectelement':
          return valueString(parseDict(a[0])[a[1]]);
        case 'element':
        case 'ele':
          val = a[0];
          for (i = 1; i < a.length; i++) {
            try {
              val = JSON.parse(val)[a[i]];
            } catch (_) {
              return 'null';
            }
            if (!val) return 'null';
          }
          return valueString(val);
        case 'arrayshift':
          arr = parseArray(a[0]);
          arr.shift();
          return makeArray(arr);
        case 'arraypop':
          arr = parseArray(a[0]);
          arr.pop();
          return makeArray(arr);
        case 'arraypush':
          arr = parseArray(a[0]);
          arr.push(a[1]);
          return makeArray(arr);
        case 'arraysplice':
          arr = parseArray(a[0]);
          arr.splice(Number(a[1]), Number(a[2]), a[3]);
          return makeArray(arr);
        case 'arrayassert':
          arr = parseArray(a[0]);
          i = Number(a[1]);
          if (i >= arr.length) arr[i] = a[2];
          return makeArray(arr);
        case 'objectassert':
        case 'dictassert':
          obj = parseDict(a[0]);
          if (!obj[a[1]]) obj[a[1]] = a[2];
          return JSON.stringify(obj);
        case 'filter':
          arr = parseArray(a[0]);
          val = ['all', 'nonempty', 'unique'].indexOf(a[1]);
          if (val < 0) val = 0;
          return makeArray(
            arr.filter(function (x, index) {
              return val === 0 ? x !== '' && index === arr.indexOf(x) : val === 1 ? x !== '' : index === arr.indexOf(x);
            })
          );
        case 'all':
          arr = a.length > 1 ? a : parseArray(a[0]);
          return arr.every(function (x) {
            return x === '1';
          })
            ? '1'
            : '0';
        case 'any':
          arr = a.length > 1 ? a : parseArray(a[0]);
          return arr.some(function (x) {
            return x === '1';
          })
            ? '1'
            : '0';
        case 'min':
        case 'max':
        case 'sum':
        case 'average':
          arr = (a.length > 1 ? a : parseArray(a[0])).map(function (x) {
            x = Number(x);
            return isNaN(x) ? 0 : x;
          });
          if (name === 'min') return String(Math.min.apply(Math, arr));
          if (name === 'max') return String(Math.max.apply(Math, arr));
          val = arr.reduce(function (x, y) {
            return x + y;
          }, 0);
          return String(name === 'average' ? val / arr.length : val);
        case 'range':
          nums = parseArray(a[0]);
          var start = nums.length > 1 ? Number(nums[0]) : 0,
            end = nums.length > 1 ? Number(nums[1]) : Number(nums[0]),
            stride = nums.length > 2 ? Number(nums[2]) : 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(stride) || stride <= 0) return '[]';
          arr = [];
          for (i = start; i < end; i += stride) arr.push(String(i));
          return makeArray(arr);
        case 'random':
        case 'pick':
          var random =
            name === 'pick'
              ? pickRandom(
                  context.messageCount === undefined ? rows.length : context.messageCount,
                  String(context.characterId || '') + String(context.chatId || '')
                )
              : typeof context.random === 'function'
                ? Number(context.random())
                : Math.random();
          if (!a.length) return String(random);
          arr =
            a.length > 1
              ? a
              : a[0].startsWith('[') && a[0].endsWith(']')
                ? parseArray(a[0])
                : a[0].replace(/\\,/g, '§X').split(/:|,/);
          val = arr[context.tokenizeAccurate ? 0 : Math.floor(random * arr.length)];
          return typeof val === 'string' ? val.replace(/§X/g, ',') : JSON.stringify(val) || '';
        case 'randint':
          var min = Number(a[0]),
            max = Number(a[1]),
            rand = typeof context.random === 'function' ? Number(context.random()) : Math.random();
          return isNaN(min) || isNaN(max) ? 'NaN' : String(Math.floor(rand * (max - min + 1)) + min);
        case 'hash':
          return String((pickRandom(0, String(a[0])) * 10000000 + 1).toFixed(0)).padStart(7, '0');
        case 'dice':
          var diceNotation = String(a[0]).split('d'),
            diceCount = Number(diceNotation[0]),
            diceSides = Number(diceNotation[1]),
            diceTotal = 0;
          if (isNaN(diceCount) || isNaN(diceSides)) return 'NaN';
          for (i = 0; i < diceCount; i++)
            diceTotal +=
              Math.floor(
                (typeof context.random === 'function' ? Number(context.random()) : Math.random()) * diceSides
              ) + 1;
          return String(diceTotal);
        case 'roll':
        case 'rollp':
        case 'rollpick':
          if (!a.length) return '1';
          diceNotation = String(a[0]).split('d');
          diceCount = 1;
          diceSides = 6;
          if (diceNotation.length === 2) {
            diceCount = Number(diceNotation[0] || 1);
            diceSides = Number(diceNotation[1] || 6);
          } else if (diceNotation.length === 1) diceSides = Number(diceNotation[0]);
          if (isNaN(diceCount) || isNaN(diceSides) || diceCount < 1 || diceSides < 1) return 'NaN';
          diceTotal = 0;
          for (i = 0; i < diceCount; i++) {
            rand =
              name === 'rollp' || name === 'rollpick'
                ? pickRandom(
                    (context.messageCount === undefined ? rows.length : context.messageCount) + i * 15,
                    String(context.characterId || '') + String(context.chatId || '')
                  )
                : typeof context.random === 'function'
                  ? Number(context.random())
                  : Math.random();
            diceTotal += Math.floor(rand * diceSides) + 1;
          }
          return String(diceTotal);
        case 'iserror':
          return String(a[0]).toLocaleLowerCase().startsWith('error:') ? '1' : '0';
        case 'xor':
        case 'xorencrypt':
        case 'xorencode':
        case 'xore':
          var xorBytes = utf8Bytes(a[0]);
          for (i = 0; i < xorBytes.length; i++) xorBytes[i] ^= 255;
          return base64Encode(xorBytes);
        case 'xordecrypt':
        case 'xordecode':
        case 'xord':
          xorBytes = base64Decode(a[0]);
          for (i = 0; i < xorBytes.length; i++) xorBytes[i] ^= 255;
          return utf8Text(xorBytes);
        case 'crypt':
        case 'crypto':
        case 'caesar':
        case 'encrypt':
        case 'decrypt':
          var shift = a[1] ? Number(a[1]) : 32768,
            crypted = '';
          if (isNaN(shift)) shift = 32768;
          for (i = 0; i < String(a[0]).length; i++) {
            var shiftedCode = String(a[0]).charCodeAt(i) + shift;
            if (shiftedCode > 65535) shiftedCode -= 65536;
            crypted += String.fromCharCode(shiftedCode);
          }
          return crypted;
        case 'comment':
          return context.displaying === true || context.mode === 'display'
            ? '<div class="risu-comment">' + a[0] + '</div>'
            : '';
        case 'tex':
        case 'latex':
        case 'katex':
          return '$$' + a[0] + '$$';
        case 'ruby':
        case 'furigana':
          return '<ruby>' + a[0] + '<rp> (</rp><rt>' + a[1] + '</rt><rp>) </rp></ruby>';
        case 'codeblock':
          val = String(a[a.length - 1])
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return a.length > 1
            ? '<pre-hljs-placeholder lang="' + a[0] + '">' + val + '</pre-hljs-placeholder>'
            : '<pre><code>' + val + '</code></pre>';
        case 'bkspc':
          var frame = state.outputFrames[state.outputFrames.length - 1];
          if (!frame || !frame.output) return '';
          val = frame.output.trimEnd();
          i = val.length - 1;
          for (; i >= 0; i--) {
            if (i === 0 || val.charAt(i) === ' ' || val.charAt(i) === '\n' || val.charAt(i) === '\t') break;
          }
          if (i === -1) i = 0;
          frame.output = val.substring(0, i).trimEnd();
          return '';
        case 'erase':
          frame = state.outputFrames[state.outputFrames.length - 1];
          if (!frame || !frame.output) return '';
          val = frame.output.trimEnd();
          i = val.length - 1;
          var sentenceEndFound = false;
          for (; i >= 0; i--) {
            if (val.charAt(i) === '.' || val.charAt(i) === '!' || val.charAt(i) === '?' || val.charAt(i) === '\n') {
              sentenceEndFound = true;
              break;
            }
            if (i === 0) break;
          }
          if (i === -1) i = 0;
          else if (sentenceEndFound) i++;
          frame.output = val.substring(0, i).trimEnd();
          return '';
        case 'declare':
          state.temp['__declared_' + a[0] + '__'] = '1';
          return '';
        case '':
          if (parsed.raw.split(/::|:/)[0] === '__') return '';
          return fail('UNKNOWN_MACRO', 'Unknown Risu CBS macro: ' + node.tag.trim(), node);
        case 'position':
          return node.raw;
        case ';':
        case ':':
        case '(':
        case ')':
          return escaped(name);
        case '<':
          return escaped('&lt;');
        case '>':
          return escaped('&gt;');
        default:
          return fail('UNKNOWN_MACRO', 'Unknown Risu CBS macro: ' + node.tag.trim(), node);
      }
    }

    function whenState(tag, depth, node) {
      var resolved = evalEmbedded(tag, depth),
        statement,
        mode = 'normal';
      if (resolved.indexOf('#when ') === 0)
        return { truthy: ['true', '1'].indexOf(resolved.split(' ', 2)[1]) >= 0, mode: mode };
      statement = resolved.split('::').slice(1);
      if (statement.length === 1) return { truthy: statement[0] === 'true' || statement[0] === '1', mode: mode };
      function truthy(x) {
        return x === 'true' || x === '1';
      }
      while (statement.length > 1) {
        var condition = statement.pop(),
          operator = statement.pop(),
          left;
        switch (operator) {
          case 'not':
            statement.push(truthy(condition) ? '0' : '1');
            break;
          case 'keep':
            mode = 'keep';
            statement.push(condition);
            break;
          case 'legacy':
            mode = 'legacy';
            statement.push(condition);
            break;
          case 'and':
            left = statement.pop();
            statement.push(truthy(left) && truthy(condition) ? '1' : '0');
            break;
          case 'or':
            left = statement.pop();
            statement.push(truthy(left) || truthy(condition) ? '1' : '0');
            break;
          case 'is':
            left = statement.pop();
            statement.push(left === condition ? '1' : '0');
            break;
          case 'isnot':
            left = statement.pop();
            statement.push(left !== condition ? '1' : '0');
            break;
          case 'var':
            statement.push(truthy(getChatVar(condition)) ? '1' : '0');
            break;
          case 'toggle':
            statement.push(truthy(getGlobalVar('toggle_' + condition)) ? '1' : '0');
            break;
          case 'vis':
            left = statement.pop();
            statement.push(getChatVar(left) === condition ? '1' : '0');
            break;
          case 'visnot':
            left = statement.pop();
            statement.push(getChatVar(left) !== condition ? '1' : '0');
            break;
          case 'tis':
            left = statement.pop();
            statement.push(getGlobalVar('toggle_' + left) === condition ? '1' : '0');
            break;
          case 'tisnot':
            left = statement.pop();
            statement.push(getGlobalVar('toggle_' + left) !== condition ? '1' : '0');
            break;
          case '>':
            left = statement.pop();
            statement.push(parseFloat(left) > parseFloat(condition) ? '1' : '0');
            break;
          case '<':
            left = statement.pop();
            statement.push(parseFloat(left) < parseFloat(condition) ? '1' : '0');
            break;
          case '>=':
            left = statement.pop();
            statement.push(parseFloat(left) >= parseFloat(condition) ? '1' : '0');
            break;
          case '<=':
            left = statement.pop();
            statement.push(parseFloat(left) <= parseFloat(condition) ? '1' : '0');
            break;
          default:
            statement.push(truthy(condition) ? '1' : '0');
        }
      }
      return { truthy: truthy(statement[0]), mode: mode };
    }

    function block(node, depth) {
      if (node.kind === '#pure') {
        traceBranch(node, 'raw');
        return node.bodyRaw.trim();
      }
      if (node.kind === '#puredisplay') {
        traceBranch(node, 'raw');
        return node.bodyRaw.trim().replaceAll('{{', '\\{\\{').replaceAll('}}', '\\}\\}');
      }
      if (node.kind === '#escape') {
        traceBranch(node, 'raw');
        return escapeBrackets(node.tag.trim().indexOf('::keep') >= 0 ? node.bodyRaw : node.bodyRaw.trim());
      }
      if (node.kind === '#code') return normalizeCode(evalNodes(node.body, depth + 1));
      if (node.kind === '#func') {
        var definitionParts = node.tag.trim().split(' ');
        if (definitionParts.length > 1)
          state.functions[definitionParts[1]] = {
            data: node.bodyRaw.trim(),
            args: definitionParts.slice(2),
          };
        return '';
      }
      if (node.kind === '#if' || node.kind === '#if_pure') {
        var resolved = evalEmbedded(node.tag, depth),
          stateText = resolved.split(' ', 2)[1],
          ifTruthy = stateText === '1' || stateText === 'true',
          chosen = ifTruthy ? node.body : node.alternate;
        traceBranch(node, ifTruthy ? 'body' : 'alternate');
        var ifOut = evalNodes(chosen, depth + 1);
        return node.kind === '#if_pure' ? ifOut : trimLegacy(ifOut);
      }
      if (node.kind === '#when') {
        var condition = whenState(node.tag, depth, node);
        if (condition.mode === 'legacy' && node.alternate && node.alternate.length) {
          traceBranch(node, condition.truthy ? 'both' : 'none');
          return condition.truthy
            ? trimLegacy(evalNodes(node.body, depth + 1) + '{{:else}}' + evalNodes(node.alternate, depth + 1))
            : '';
        }
        traceBranch(node, condition.truthy ? 'body' : 'alternate');
        // Upstream's streaming parser evaluates inline CBS while collecting the
        // whole #when body, before blockEndMatcher selects a branch. Preserve
        // that observable runVar/tempvar/return order: body, then :else.
        var traceBranchStart = traceParent ? traceParent.children.length : 0;
        var truthyOut = evalNodes(node.body, depth + 1);
        var traceBranchEnd = traceParent ? traceParent.children.length : 0;
        var falsyOut = evalNodes(node.alternate, depth + 1);
        if (traceParent) {
          if (condition.truthy) traceParent.children.splice(traceBranchEnd);
          else traceParent.children.splice(traceBranchStart, traceBranchEnd - traceBranchStart);
        }
        var whenOut = condition.truthy ? truthyOut : falsyOut;
        if (condition.mode === 'keep' && node.alternate && node.alternate.length) {
          whenOut = condition.truthy ? whenOut.replace(/\n$/, '') : whenOut.replace(/^\n/, '');
        }
        return condition.mode === 'keep'
          ? whenOut
          : condition.mode === 'legacy'
            ? trimLegacy(whenOut)
            : trimWhen(whenOut);
      }
      if (node.kind === '#each') {
        var header = evalEmbedded(node.tag, depth).slice(5).trim(),
          keep = false;
        if (header.indexOf('::keep ') === 0) {
          keep = true;
          header = header.slice(7).trim();
        }
        var match = header.match(/^(.*)\s+as\s+([^\s]+)$/) || header.match(/^(.*)\s+([^\s]+)$/),
          sourceValue = match ? match[1] : header,
          slot = match ? match[2] : 'slot';
        var loopArray = parseArray(sourceValue);
        if (loopArray.length) traceBranch(node, 'body');
        var output = '';
        for (var j = 0; j < loopArray.length; j++) {
          var old = own(state.temp, '__slot_' + slot) ? state.temp['__slot_' + slot] : undefined,
            had = own(state.temp, '__slot_' + slot);
          state.temp['__slot_' + slot] = valueString(loopArray[j]);
          var iteration = evalNodes(node.body, depth + 1);
          output += keep ? iteration : trimLegacy(iteration);
          if (had) state.temp['__slot_' + slot] = old;
          else delete state.temp['__slot_' + slot];
          if (state.returned) break;
        }
        return output;
      }
      return fail('UNSUPPORTED_BLOCK', 'Unsupported Risu CBS block: ' + node.tag.trim(), node);
    }

    function evalNodes(nodes, depth) {
      var frame = { output: '' };
      state.outputFrames.push(frame);
      for (var i = 0; i < nodes.length; i++) {
        if (state.returned) break;
        var node = nodes[i],
          traceStart = frame.output.length,
          previousTrace = traceParent,
          previousHistoryWrite = historyWriteAllowed,
          traceNode =
            outputTrace && tracedNodes.has(node)
              ? {
                  source: sourceText.slice(node.start, node.end),
                  text: '',
                  macro: node.type !== 'text',
                  start: node.start,
                  end: node.end,
                  children: [],
                }
              : null;
        if (tracedNodes && tracedNodes.has(node) && Number.isFinite(context.historyEffectStart))
          historyWriteAllowed = node.end > context.historyEffectStart;
        if (traceNode) {
          (traceParent ? traceParent.children : outputTrace).push(traceNode);
          traceParent = traceNode;
        }
        try {
          if (node.type === 'text') frame.output += node.value;
          else if (node.type === 'macro') {
            var tagName = normalizeName(node.tag.split(/::|:/)[0]);
            if (tagName === 'slot')
              frame.output += own(state.temp, '__slot_' + (node.tag.split(/::|:/)[1] || 'slot'))
                ? state.temp['__slot_' + (node.tag.split(/::|:/)[1] || 'slot')]
                : node.raw;
            else {
              var renderedInline = inline(node, depth);
              frame.output += renderedInline;
            }
          } else if (node.type === 'block') frame.output += block(node, depth);
          else frame.output += fail('UNCLOSED_BLOCK', 'Unclosed Risu CBS block: ' + node.tag.trim(), node);
        } catch (error) {
          if (error instanceof RisuCBSError) throw error;
          frame.output += fail('EVALUATION_ERROR', String((error && error.message) || error), node);
        } finally {
          historyWriteAllowed = previousHistoryWrite;
          if (traceNode) {
            traceNode.text = frame.output.slice(traceStart);
            traceParent = previousTrace;
          }
        }
      }
      state.outputFrames.pop();
      return frame.output;
    }

    if (calls.count > 20) return 'ERROR: Call stack limit reached';
    var sourceText = String(text === undefined || text === null ? '' : text),
      rootNodes = parseSource(sourceText);
    if (branchTrace) {
      rootBlocks = new Set();
      collectRootBlocks(rootNodes);
    }
    if (tracedNodes) {
      var pendingTraceNodes = rootNodes.slice();
      while (pendingTraceNodes.length) {
        var traceRoot = pendingTraceNodes.pop();
        tracedNodes.add(traceRoot);
        if (traceRoot.body) {
          traceRoot.body.forEach(function (child) {
            pendingTraceNodes.push(child);
          });
          traceRoot.alternate.forEach(function (child) {
            pendingTraceNodes.push(child);
          });
        }
      }
    }
    var result = evalNodes(rootNodes, 1);
    if (state.returned && outputTrace) {
      outputTrace.length = 0;
      outputTrace.push({
        source: sourceText,
        text: state.returnValue,
        macro: true,
        start: 0,
        end: sourceText.length,
        children: [],
      });
    }
    var output = state.returned ? state.returnValue : result;
    // Function calls share the caller's counter and stay escaped until the outermost evaluation.
    if (context._cbsCalls) return output;
    if (outputTrace)
      (function restore(rows) {
        rows.forEach(function (row) {
          row.text = unescapeText(String(row.text));
          restore(row.children);
        });
      })(outputTrace);
    return unescapeText(String(output));
  }

  var supported = Object.freeze({
    blocks: BLOCKS.slice(),
    variables: [
      'tempvar',
      'gettempvar',
      'settempvar',
      'return',
      'getvar',
      'getglobalvar',
      'setvar',
      'addvar',
      'setdefaultvar',
      'slot',
    ],
    conditions: ['#when keep/legacy/not/and/or/is/isnot/>/>=/</<=/var/toggle/vis/visnot/tis/tisnot', '#if', '#if_pure'],
    strings: [
      'startswith',
      'endswith',
      'contains',
      'replace',
      'split',
      'join',
      'spread',
      'trim',
      'length',
      'lower',
      'upper',
      'capitalize',
      'reverse',
      'unicodeencode',
      'unicodedecode',
      'u',
      'ue',
    ],
    arrays: [
      'arraylength',
      'arrayelement',
      'dictelement',
      'objectelement',
      'element',
      'arrayshift',
      'arraypop',
      'arraypush',
      'arraysplice',
      'arrayassert',
      'objectassert',
      'makearray',
      'makedict',
      'filter',
      'range',
    ],
    math: [
      'calc',
      '?',
      'equal',
      'notequal',
      'greater',
      'less',
      'greaterequal',
      'lessequal',
      'and',
      'or',
      'not',
      'round',
      'floor',
      'ceil',
      'abs',
      'remaind',
      'pow',
      'tonumber',
      'fixnum',
      'all',
      'any',
      'min',
      'max',
      'sum',
      'average',
      'fromhex',
      'tohex',
    ],
    context: [
      'char',
      'user',
      'role',
      'isfirstmsg',
      'personality',
      'description',
      'scenario',
      'exampledialogue',
      'persona',
      'mainprompt',
      'jb',
      'globalnote',
      'authornote',
      'chatindex',
      'firstmsgindex',
      'previouscharchat',
      'previoususerchat',
      'lastmessage',
      'lastmessageid',
      'previouschatlog',
      'history',
      'userhistory',
      'charhistory',
      'emotionlist',
      'assetlist',
    ],
    injectedRandomness: ['random', 'randint'],
    stableSelection: ['pick'],
    escapes: ['br', 'cbr', 'decbo', 'decbc', 'bo', 'bc', ';', ':', '(', ')', '<', '>'],
  });

  function templateBlockCount(nodes) {
    var total = 0;
    (nodes || []).forEach(function (node) {
      if (node.type !== 'block') return;
      total += 1 + templateBlockCount(node.body) + templateBlockCount(node.alternate);
    });
    return total;
  }
  function templateLevel(nodes) {
    var segments = [],
      blocks = [],
      current = null;
    (nodes || []).forEach(function (node) {
      if (node.type === 'block') {
        segments.push(current);
        current = null;
        blocks.push(node);
        return;
      }
      if (current) current.end = node.end;
      else current = { start: node.start, end: node.end };
    });
    segments.push(current);
    return { segments: segments, blocks: blocks };
  }
  // Which spans of a Risu template the reader actually sees under the current options. The adopted
  // branch of every block comes from a real evaluation, never from a second condition parser, so
  // tempvar/setvar order and host macros decide it exactly as the displayed text does. When an
  // earlier text is supplied, its identically shaped tree is walked in lockstep so each visible span
  // can be paired with the same span before it was rewritten.
  function visibleSpans(text, context, earlier) {
    if (!text || !hasMacros(text)) return null;
    var source = String(text),
      tree = parseSource(source);
    if (!templateBlockCount(tree)) return null;
    var trace = [];
    evaluate(source, Object.assign({}, context || {}, { branchTrace: trace }));
    var adopted = Object.create(null);
    trace.forEach(function (row) {
      adopted[row.start + ':' + row.end] = row.branch;
    });
    var earlierText = typeof earlier === 'string' ? earlier : '',
      earlierTree = earlierText && earlierText !== source ? parseSource(earlierText) : null,
      spans = [];
    function pair(span, other) {
      return {
        start: span.start,
        end: span.end,
        earlierStart: other ? other.start : -1,
        earlierEnd: other ? other.end : -1,
      };
    }
    function walk(nodes, otherNodes) {
      var level = templateLevel(nodes),
        otherLevel = otherNodes ? templateLevel(otherNodes) : null,
        aligned = !!otherLevel && otherLevel.blocks.length === level.blocks.length;
      for (var i = 0; i < level.segments.length; i++) {
        if (level.segments[i]) spans.push(pair(level.segments[i], aligned ? otherLevel.segments[i] : null));
        if (i >= level.blocks.length) continue;
        var block = level.blocks[i],
          other = aligned && otherLevel.blocks[i].kind === block.kind ? otherLevel.blocks[i] : null,
          branch = adopted[block.start + ':' + block.end];
        if (!branch || branch === 'none') continue;
        if (branch === 'raw') {
          if (block.bodyEnd > block.bodyStart)
            spans.push(
              pair(
                { start: block.bodyStart, end: block.bodyEnd },
                other && other.bodyEnd > other.bodyStart ? { start: other.bodyStart, end: other.bodyEnd } : null
              )
            );
          continue;
        }
        if (branch === 'body' || branch === 'both') walk(block.body, other ? other.body : null);
        if (branch === 'alternate' || branch === 'both') walk(block.alternate, other ? other.alternate : null);
      }
    }
    walk(tree, earlierTree);
    return spans;
  }
  g.YeyuRisuCBS = Object.freeze({
    evaluate: evaluate,
    parse: parseSource,
    hasMacros: hasMacros,
    visibleSpans: visibleSpans,
    templateBlockCount: templateBlockCount,
    pickHashRand: pickRandom,
    Error: RisuCBSError,
    capabilities: Object.freeze({
      supported: supported,
      supportedOfficialMacros: SUPPORTED_OFFICIAL.slice(),
      deferredOfficialMacros: DEFERRED.filter(function (name) {
        return name !== 'raw';
      }),
      deferredDisplayMacros: DEFERRED.slice(),
      hostContextMacros: HOST_CONTEXT.slice(),
      docOnlyOfficialMacros: DOC_ONLY.slice(),
      unsupportedOfficialMacros: UNSUPPORTED.slice(),
      supportedParserConstructs: ['#func', 'call', '#code'],
      unsupportedParserConstructs: UNSUPPORTED_PARSER.slice(),
    }),
  });
}

installYeyuRisuCBS(typeof window !== 'undefined' ? window : globalThis);
(typeof window !== 'undefined' ? window : globalThis).YeyuRisuCBSInstaller = installYeyuRisuCBS;
