// ===== STScript value utilities =====
function stscriptResolveValue(value, args) {
  var key = stscriptJoin(value);
  if (args._scope && args._scope.existsVariable(key)) return args._scope.getVariable(key);
  var sess = stscriptSess(),
    dry = stscriptDryRunning(args),
    local = dry ? sess && stscriptEnsureLocal(args._abortController) : sess && sess.stscriptVars;
  if (local && Object.prototype.hasOwnProperty.call(local, key)) return local[key];
  var global = dry
    ? stscriptEnsureGlobal(args._abortController)
    : D.settings.stscript && D.settings.stscript.globalVars;
  return global && Object.prototype.hasOwnProperty.call(global, key) ? global[key] : key;
}
stscriptAddCommand({
  name: 'array-wrap',
  dryRun: 'run',
  aliases: ['list-wrap'],
  namedArgumentList: [{ name: 'stringify' }],
  callback: function (args, value) {
    if (value instanceof StscriptClosure || Array.isArray(value)) throw new Error('/array-wrap 需要单个值');
    value = stscriptJoin(value);
    if (!value) return '[]';
    try {
      var parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return value;
      if ((parsed !== null && typeof parsed === 'object') || stscriptIsFalse(args.stringify))
        return JSON.stringify([parsed]);
    } catch (_) {}
    return JSON.stringify([value]);
  },
});
stscriptAddCommand({
  name: 'array-unwrap',
  dryRun: 'run',
  aliases: ['list-unwrap'],
  callback: function (args, value) {
    if (value instanceof StscriptClosure || Array.isArray(value)) throw new Error('/array-unwrap 需要单个值');
    value = stscriptJoin(value);
    try {
      var parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        var first = parsed[0];
        return first == null ? '' : typeof first === 'object' ? JSON.stringify(first) : String(first);
      }
    } catch (_) {}
    return value;
  },
});
stscriptAddCommand({
  name: 'closure-serialize',
  dryRun: 'run',
  callback: function (args, value) {
    if (!(value instanceof StscriptClosure)) throw new Error('/closure-serialize 需要闭包');
    return value.rawText;
  },
});
stscriptAddCommand({
  name: 'closure-deserialize',
  dryRun: 'run',
  callback: function (args, value) {
    var closure = new StscriptParser().parse(stscriptJoin(value), true, args._parserFlags, args._abortController);
    closure.scope.parent = args._scope;
    return closure;
  },
});
function stscriptValueCompare(a, b) {
  if (typeof a !== typeof b) {
    a = typeof a;
    b = typeof b;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}
stscriptAddCommand({
  name: 'sort',
  dryRun: 'run',
  namedArgumentList: [{ name: 'keysort' }],
  callback: function (args, value) {
    var parsed;
    try {
      parsed = JSON.parse(stscriptJoin(value));
    } catch (_) {
      return stscriptJoin(value);
    }
    if (Array.isArray(parsed)) parsed.sort(stscriptValueCompare);
    else if (parsed && typeof parsed === 'object') {
      var data = parsed;
      parsed = Object.keys(data).sort(function (a, b) {
        return stscriptValueCompare(
          stscriptIsFalse(args.keysort) ? data[a] : a,
          stscriptIsFalse(args.keysort) ? data[b] : b
        );
      });
    }
    return JSON.stringify(parsed);
  },
});
stscriptAddCommand({
  name: 'log',
  dryRun: 'run',
  callback: function (args, value) {
    var text = stscriptJoin(value),
      parts;
    try {
      parts = JSON.parse(text);
    } catch (_) {}
    if (!Array.isArray(parts)) parts = text.split(' ');
    var numbers = parts
      .filter(function (item) {
        return item !== '';
      })
      .map(function (item) {
        return Number(stscriptResolveValue(item, args));
      })
      .filter(function (n) {
        return !Number.isNaN(n);
      });
    if (!numbers.length) return '0';
    var result = Math.log(numbers[0]);
    return String(Number.isNaN(result) ? 0 : result);
  },
});
['test', 'match'].forEach(function (name) {
  stscriptAddCommand({
    name: name,
    dryRun: 'run',
    namedArgumentList: [{ name: 'pattern' }],
    callback: function (args, value) {
      if (!args.pattern) throw new Error('/' + name + ' 需要 pattern 正则表达式');
      var parts = stscriptParseRegexLiteral(args.pattern),
        re = new RegExp(parts.pattern, parts.flags),
        text = stscriptJoin(value);
      if (name === 'test') return String(re.test(text));
      if (re.global) return JSON.stringify(Array.from(text.matchAll(re)));
      var match = text.match(re);
      return match ? JSON.stringify(match) : '';
    },
  });
});
function stscriptFuzzyMatch(pattern, text, threshold, options) {
  options = options || {};
  pattern = String(pattern).toLowerCase();
  text = String(text).toLowerCase();
  if (!pattern || !text.trim()) return { match: false, score: 1 };
  if (pattern === text) return { match: true, score: 0 };
  var chunks = [];
  for (var start = 0; start + 32 <= pattern.length; start += 32)
    chunks.push({ text: pattern.slice(start, start + 32), offset: start });
  if (pattern.length <= 32) chunks = [{ text: pattern, offset: 0 }];
  else if (pattern.length % 32) chunks.push({ text: pattern.slice(-32), offset: pattern.length - 32 });
  var total = 0,
    matched = false;
  chunks.forEach(function (chunk) {
    var source = chunk.text,
      length = source.length,
      alphabet = Object.create(null),
      mask = 1 << (length - 1);
    for (var i = 0; i < length; i++) alphabet[source[i]] = (alphabet[source[i]] || 0) | (1 << (length - i - 1));
    var expected = Math.max(0, Math.min(text.length, (Number(options.location) || 0) + chunk.offset));
    var distance = options.distance == null ? 100 : Number(options.distance);
    function score(errors, position) {
      var accuracy = errors / length;
      if (options.ignoreLocation !== false) return accuracy;
      var proximity = Math.abs(position - expected);
      return distance ? accuracy + proximity / distance : proximity ? 1 : accuracy;
    }
    var ceiling = threshold,
      previous = [],
      best = -1,
      finalScore = 1,
      searchRadius = length + text.length;
    for (var exact = text.indexOf(source, expected); exact >= 0; exact = text.indexOf(source, exact + length))
      ceiling = Math.min(ceiling, score(0, exact));
    for (var errors = 0; errors < length; errors++) {
      var low = 0,
        middle = searchRadius;
      while (low < middle) {
        if (score(errors, expected + middle) <= ceiling) low = middle;
        else searchRadius = middle;
        middle = Math.floor((searchRadius - low) / 2 + low);
      }
      searchRadius = middle;
      var scanStart = Math.max(1, expected - middle + 1);
      var scanFinish = Math.min(expected + middle, text.length) + length;
      var current = new Array(scanFinish + 2);
      current[scanFinish + 1] = (1 << errors) - 1;
      for (var j = scanFinish; j >= scanStart; j--) {
        current[j] = ((current[j + 1] << 1) | 1) & (alphabet[text[j - 1]] || 0);
        if (errors) current[j] |= ((previous[j + 1] | previous[j]) << 1) | 1 | previous[j + 1];
        if (current[j] & mask) {
          finalScore = score(errors, j - 1);
          if (finalScore <= ceiling) {
            ceiling = finalScore;
            best = j - 1;
            if (best <= expected) break;
            scanStart = Math.max(1, 2 * expected - best);
          }
        }
      }
      if (score(errors + 1, expected) > ceiling) break;
      previous = current;
    }
    matched = matched || best >= 0;
    total += Math.max(0.001, finalScore);
  });
  var norm = Math.round(1000 / Math.sqrt((text.match(/[^ ]+/g) || []).length || 1)) / 1000;
  return { match: matched, score: matched ? Math.pow(total / chunks.length, norm) : 1 };
}
stscriptAddCommand({
  name: 'fuzzy',
  dryRun: 'run',
  namedArgumentList: [{ name: 'list' }, { name: 'threshold' }, { name: 'mode' }],
  callback: function (args, value) {
    var text = stscriptJoin(value),
      list;
    if (!text || !args.list) return '';
    try {
      list = JSON.parse(stscriptResolveValue(args.list, args));
    } catch (_) {
      return '';
    }
    if (!Array.isArray(list)) return '';
    var threshold = args.threshold == null ? 0.4 : parseFloat(args.threshold);
    if (Number.isNaN(threshold)) return '';
    threshold = Math.max(0, Math.min(1, threshold));
    var best = '',
      score = Infinity;
    list.forEach(function (item) {
      if (typeof item !== 'string') return;
      var match =
        args.mode === 'best' ? stscriptFuzzyMatch(text, item, threshold) : stscriptFuzzyMatch(item, text, threshold);
      if (match.match && match.score < score && (args.mode === 'best' || score === Infinity)) {
        best = item;
        score = match.score;
      }
    });
    return best;
  },
});
stscriptAddCommand({
  name: 'tokens',
  dryRun: 'run',
  callback: function (args, value) {
    if (value instanceof StscriptClosure || Array.isArray(value)) throw new Error('/tokens 需要单个文本值');
    return String(estTokens(stscriptJoin(value)));
  },
});
stscriptAddCommand({
  name: 'count',
  dryRun: 'run',
  callback: function (args) {
    var count = estTokens(
      stscriptMsgs()
        .filter(function (msg) {
          return msg.content && msg.role !== 'system';
        })
        .map(function (msg) {
          return msg.content;
        })
        .join(' ')
    );
    if (!stscriptDryRunning(args)) toast('Token 数：' + count);
    return String(count);
  },
});
stscriptAddCommand({
  name: 'trimtokens',
  dryRun: 'run',
  namedArgumentList: [{ name: 'limit' }, { name: 'direction' }],
  callback: function (args, value) {
    var text = stscriptJoin(value),
      limit = Number(stscriptResolveValue(args.limit, args));
    if (Number.isNaN(limit)) return text;
    if (limit <= 0) return '';
    if (estTokens(text) <= limit) return text;
    var chars = Array.from(text),
      low = 0,
      high = chars.length,
      best = '';
    while (low <= high) {
      var mid = Math.floor((low + high) / 2),
        candidate =
          args.direction === 'start' ? chars.slice(0, mid).join('') : chars.slice(chars.length - mid).join('');
      if (estTokens(candidate) <= limit) {
        best = candidate;
        low = mid + 1;
      } else high = mid - 1;
    }
    return best;
  },
});
stscriptAddCommand({
  name: 'clipboard-get',
  callback: async function () {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('unavailable');
      return await navigator.clipboard.readText();
    } catch (_) {
      toast('当前环境不能读取剪贴板，请手动粘贴');
      return '';
    }
  },
});
stscriptAddCommand({
  name: 'clipboard-set',
  callback: async function (args, value) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('当前环境不能写入剪贴板');
    await navigator.clipboard.writeText(stscriptJoin(value));
    return '';
  },
});
stscriptAddCommand({
  name: 'is-mobile',
  dryRun: 'run',
  callback: function () {
    return String(window.matchMedia('(max-width: 1000px)').matches);
  },
});
stscriptAddCommand({
  name: 'forcesave',
  callback: async function () {
    await saveData(['meta', 'sessions']);
    return '';
  },
});
stscriptAddCommand({
  name: 'reroll-pick',
  callback: async function (args, value) {
    var sess = stscriptSess();
    if (!sess) throw new Error('当前没有可用对话');
    var parsed = parseInt(stscriptJoin(value), 10),
      old = sess.pickRerollSeed;
    sess.pickRerollSeed = Number.isNaN(parsed) ? (Number(old) || 0) + 1 : parsed;
    try {
      await saveData('sessions');
    } catch (error) {
      if (old === undefined) delete sess.pickRerollSeed;
      else sess.pickRerollSeed = old;
      throw error;
    }
    return String(sess.pickRerollSeed);
  },
});
