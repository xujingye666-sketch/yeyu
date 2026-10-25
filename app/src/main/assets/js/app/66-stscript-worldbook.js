// ===== SillyTavern 1.19.0 World Info, vector, Regex, and Quick Reply imports =====
function stscriptWorldbookLive() {
  var char = stscriptChar(),
    session = stscriptSess();
  if (!char || !session) throw new Error('当前没有可用对话');
  return { charId: String(char.id || ''), owner: { sessionId: String(session.id || '') } };
}
function stscriptWorldbookValue(value) {
  return typeof stscriptJoin === 'function'
    ? stscriptJoin(value)
    : Array.isArray(value)
      ? value.join(' ')
      : String(value == null ? '' : value);
}
function stscriptWorldbookJsonValue(value) {
  var char = stscriptChar(),
    persona = typeof getActivePersona === 'function' ? getActivePersona(char && char.id) : null,
    expand = function (item) {
      return typeof replaceCharacterMacros === 'function'
        ? replaceCharacterMacros(String(item == null ? '' : item), char, String((persona && persona.name) || '用户'))
        : String(item == null ? '' : item);
    };
  if (Array.isArray(value)) return JSON.stringify(value.map(expand));
  if (value === undefined) return '';
  return expand(value);
}
function stscriptWorldbookFindScore(needle, value) {
  var values = Array.isArray(value) ? value : [value],
    score = 1,
    matched = false;
  values.forEach(function (item) {
    var text = String(item == null ? '' : item),
      result = stscriptFuzzyMatch(needle, text, 0.3, {
        ignoreLocation: false,
        location: 0,
        distance: 100,
      });
    if (!result.match) return;
    matched = true;
    if (result.score === 0) {
      var norm = Math.round(1000 / Math.sqrt((text.match(/[^ ]+/g) || []).length || 1)) / 1000;
      score *= Math.pow(Number.EPSILON, norm);
    } else score *= result.score;
  });
  return matched ? score : Infinity;
}
function stscriptWorldbookBooleanState(value, current) {
  var text = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  if (!text || text === 'toggle' || text === 't') return !current;
  if (stscriptIsTrue(text)) return true;
  if (stscriptIsFalse(text)) return false;
  return current;
}
function stscriptWorldbookValidate(file, options) {
  options = options || {};
  var category = hostWriteWorldbookCategory(file, false),
    message = '',
    entry = null,
    effect = String(options.effect || '')
      .trim()
      .toLowerCase();
  if (!category) message = '找不到世界书：' + String(file || '');
  else if (Object.prototype.hasOwnProperty.call(options, 'uid')) {
    entry = cardFrontendWorldbookRows(category).find(function (row) {
      return String(row.uid) === String(options.uid);
    });
    if (!entry) message = '找不到世界书条目 UID：' + String(options.uid == null ? '' : options.uid);
  }
  if (
    !message &&
    options.field &&
    !Object.prototype.hasOwnProperty.call(HOST_WRITE_STSCRIPT_WORLD_FIELDS, options.field)
  )
    message = '无效的世界书字段：' + options.field;
  if (
    !message &&
    Object.prototype.hasOwnProperty.call(options, 'effect') &&
    !['sticky', 'cooldown', 'delay'].includes(effect)
  )
    message = '定时效果必须为 sticky、cooldown 或 delay';
  if (!message && options.writeEffect) {
    if (effect === 'delay') message = 'delay 由条目延迟消息数决定，不能手动切换';
    else if (!(Number(entry.entry[effect]) > 0)) message = '请先在世界书条目中设置 ' + effect + ' 的持续消息数';
  }
  if (message && !options.quiet && typeof toast === 'function') toast(message, 'err');
  return !message;
}

stscriptAddCommand({
  name: 'world',
  namedArgumentList: [{ name: 'state' }, { name: 'silent' }],
  callback: async function (args, value) {
    var text = stscriptWorldbookValue(value).trim(),
      names = text ? text.split(',') : [],
      state = String(args.state || 'on')
        .trim()
        .toLowerCase();
    if (!['on', 'off', 'toggle'].includes(state)) state = 'on';
    return hostWriteSetStscriptGlobalWorldbooks(names, state, stscriptIsTrue(args.silent));
  },
});
stscriptAddCommand({
  name: 'getglobalbooks',
  dryRun: 'run',
  aliases: ['getgloballore', 'getglobalwi'],
  callback: function () {
    return JSON.stringify(hostWriteLorebookSettings().selected_global_lorebooks || []);
  },
});
stscriptAddCommand({
  name: 'getchatbook',
  dryRun: function (args) {
    return hostWriteChatLorebook(stscriptSess()) || stscriptIsFalse(args.create) ? 'run' : null;
  },
  aliases: ['getchatlore', 'getchatwi'],
  namedArgumentList: [{ name: 'name' }, { name: 'create' }],
  callback: async function (args) {
    var existing = hostWriteChatLorebook(stscriptSess());
    if (existing) return existing;
    if (stscriptIsFalse(args.create)) return '';
    return hostWriteGetOrCreateChatLorebook(stscriptWorldbookLive(), args.name);
  },
});
stscriptAddCommand({
  name: 'getpersonabook',
  dryRun: function (args) {
    var char = stscriptChar(),
      persona = char && typeof getActivePersona === 'function' ? getActivePersona(char.id) : null;
    return !stscriptIsTrue(args.create) || (persona && persona.lorebook) ? 'run' : null;
  },
  aliases: ['getpersonalore', 'getpersonawi'],
  namedArgumentList: [{ name: 'name' }, { name: 'create' }],
  callback: function (args) {
    return hostWriteGetOrCreatePersonaLorebook(stscriptWorldbookLive(), args.name, stscriptIsTrue(args.create));
  },
});
stscriptAddCommand({
  name: 'getcharbook',
  dryRun: function (args, value) {
    if (!stscriptIsTrue(args.create)) return 'run';
    var lookup = hostWriteCharLorebookLookup(
      stscriptWorldbookValue(value).trim() || 'current',
      args.type,
      stscriptChar()
    );
    return !lookup.char || lookup.books.length ? 'run' : null;
  },
  aliases: ['getcharlore', 'getcharwi'],
  namedArgumentList: [{ name: 'type' }, { name: 'name' }, { name: 'create' }],
  callback: function (args, value) {
    return hostWriteGetOrCreateCharLorebooks(
      stscriptWorldbookLive(),
      stscriptWorldbookValue(value).trim() || 'current',
      args.type,
      args.name,
      stscriptIsTrue(args.create)
    );
  },
});
stscriptAddCommand({
  name: 'createentry',
  aliases: ['createlore', 'createwi'],
  namedArgumentList: [{ name: 'file' }, { name: 'key' }],
  callback: function (args, value) {
    if (!stscriptWorldbookValidate(args.file)) return '';
    return hostWriteCreateStscriptWorldbookEntry(args.file, args.key, stscriptWorldbookValue(value));
  },
});
stscriptAddCommand({
  name: 'findentry',
  dryRun: 'run',
  aliases: ['findlore', 'findwi'],
  namedArgumentList: [{ name: 'file' }, { name: 'field' }],
  callback: function (args, value) {
    var category = hostWriteWorldbookCategory(args.file, false),
      field = String(args.field || 'key'),
      needle = stscriptWorldbookValue(value),
      best = null;
    if (!stscriptWorldbookValidate(args.file, { field: field, quiet: stscriptDryRunning(args) }) || !needle) return '';
    cardFrontendWorldbookRows(category).forEach(function (row) {
      var fieldValue = hostWriteGetStscriptWorldbookField(args.file, row.uid, field),
        score = stscriptWorldbookFindScore(needle, fieldValue);
      if (Number.isFinite(score) && (!best || score < best.score)) best = { uid: row.uid, score: score };
    });
    return best ? String(best.uid) : '';
  },
});
stscriptAddCommand({
  name: 'getentryfield',
  dryRun: 'run',
  aliases: ['getlorefield', 'getwifield'],
  namedArgumentList: [{ name: 'file' }, { name: 'field' }],
  callback: function (args, value) {
    if (
      !stscriptWorldbookValidate(args.file, {
        uid: stscriptWorldbookValue(value).trim(),
        field: String(args.field || 'content'),
        quiet: stscriptDryRunning(args),
      })
    )
      return '';
    var result = hostWriteGetStscriptWorldbookField(
      args.file,
      stscriptWorldbookValue(value).trim(),
      String(args.field || 'content')
    );
    return stscriptWorldbookJsonValue(result);
  },
});
stscriptAddCommand({
  name: 'setentryfield',
  aliases: ['setlorefield', 'setwifield'],
  namedArgumentList: [{ name: 'file' }, { name: 'uid' }, { name: 'field' }],
  callback: async function (args, value) {
    if (!stscriptWorldbookValidate(args.file, { uid: args.uid, field: String(args.field || 'content') })) return '';
    var text = stscriptWorldbookValue(value).replace(/\\([{}|])/g, '$1');
    await hostWriteSetStscriptWorldbookField(args.file, args.uid, String(args.field || 'content'), text);
    return '';
  },
});
stscriptAddCommand({
  name: 'wi-get-timed-effect',
  dryRun: 'run',
  namedArgumentList: [{ name: 'file' }, { name: 'effect' }, { name: 'format' }],
  callback: function (args, value) {
    if (
      !stscriptWorldbookValidate(args.file, {
        uid: stscriptWorldbookValue(value).trim(),
        effect: args.effect,
        quiet: stscriptDryRunning(args),
      })
    )
      return '';
    var metadata = worldBookTimedEffectMetadata(
        args.file,
        stscriptWorldbookValue(value).trim(),
        args.effect,
        stscriptSess()
      ),
      count = worldBookTimedEffectMessageCount(stscriptSess());
    return String(
      String(args.format || 'boolean')
        .trim()
        .toLowerCase() === 'number'
        ? metadata
          ? metadata.end - count
          : 0
        : !!metadata
    );
  },
});
stscriptAddCommand({
  name: 'wi-set-timed-effect',
  namedArgumentList: [{ name: 'file' }, { name: 'uid' }, { name: 'effect' }],
  callback: async function (args, value) {
    if (!stscriptWorldbookValidate(args.file, { uid: args.uid, effect: args.effect, writeEffect: true })) return '';
    var current = !!worldBookTimedEffectMetadata(args.file, args.uid, args.effect, stscriptSess()),
      state = stscriptWorldbookBooleanState(stscriptWorldbookValue(value), current);
    await worldBookSetTimedEffect(args.file, args.uid, args.effect, state, stscriptSess());
    return '';
  },
});

['vector-chats-state', 'vector-worldinfo-state'].forEach(function (name) {
  stscriptAddCommand({
    name: name,
    dryRun: stscriptDryRunReadIfBlank,
    callback: async function (args, value) {
      var text = stscriptWorldbookValue(value).trim();
      if (!text) return String(hostWriteStscriptVectorValue(name));
      return String(await hostWriteSetStscriptVectorValue(name, stscriptIsTrue(text)));
    },
  });
});
['vector-query', 'vector-max-entries', 'vector-threshold'].forEach(function (name) {
  stscriptAddCommand({
    name: name,
    dryRun: stscriptDryRunReadIfBlank,
    callback: async function (args, value) {
      var text = stscriptWorldbookValue(value).trim(),
        number;
      if (!text) return String(hostWriteStscriptVectorValue(name));
      number = Number(text);
      if (!Number.isFinite(number)) return '';
      if (name === 'vector-threshold' ? number < 0 || number > 1 : number <= 0) return '';
      return String(await hostWriteSetStscriptVectorValue(name, number));
    },
  });
});

stscriptAddCommand({
  name: 'regex-state',
  dryRun: 'run',
  callback: function (args, value) {
    var name = stscriptWorldbookValue(value),
      state = hostWriteStscriptRegexState(name, stscriptChar()),
      quiet = stscriptDryRunning(args) || typeof toast !== 'function';
    if (!name && !quiet) toast('未提供正则脚本名称', 'err');
    else if (state == null && !quiet) toast('找不到正则脚本：' + name, 'err');
    return state == null ? '' : String(state);
  },
});
stscriptAddCommand({
  name: 'regex-toggle',
  namedArgumentList: [{ name: 'state' }, { name: 'quiet' }],
  callback: async function (args, value) {
    var name = stscriptWorldbookValue(value),
      state = String(args.state || 'toggle')
        .trim()
        .toLowerCase();
    if (!['on', 'off', 'toggle'].includes(state)) state = 'toggle';
    var result = await hostWriteToggleStscriptRegex(name, state, stscriptChar());
    if (!result && !stscriptIsTrue(args.quiet) && typeof toast === 'function') toast('找不到正则脚本：' + name, 'err');
    else if (result && !stscriptIsTrue(args.quiet) && typeof toast === 'function')
      toast(
        '正则脚本“' + result + '”已' + (hostWriteStscriptRegexState(result, stscriptChar()) ? '启用' : '停用'),
        'ok'
      );
    return result;
  },
});
stscriptAddCommand({
  name: 'regex-preset',
  dryRun: stscriptDryRunReadIfBlank,
  namedArgumentList: [{ name: 'quiet' }],
  callback: async function (args, value) {
    var name = stscriptWorldbookValue(value),
      result = await hostWriteSelectStscriptRegexPreset(name);
    if (name.trim() && !result && !stscriptIsTrue(args.quiet) && typeof toast === 'function')
      toast('找不到正则预设：' + name, 'err');
    return result;
  },
});

stscriptAddCommand({
  name: 'import',
  dryRun: 'run',
  splitUnnamedArgument: true,
  namedArgumentList: [{ name: 'from' }],
  callback: function (args, value) {
    var from = String(args.from || ''),
      wanted = Array.isArray(value) ? value : [value],
      found = null;
    if (!from) throw new Error('/import 需要 from=快捷栏集合.条目');
    if (!wanted.length || !String(wanted[0] || '')) throw new Error('/import 需要要导入的闭包名');
    (typeof qrBoundSets === 'function' ? qrBoundSets() : []).some(function (set) {
      var item = (set.qrList || []).find(function (row) {
        return row && row.label === from;
      });
      if (!item) return false;
      found = item;
      return true;
    });
    if (!found) {
      var parts = from.split('.'),
        set = typeof qrFindSet === 'function' ? qrFindSet(parts.shift()) : null,
        label = parts.join('.');
      found =
        set &&
        (set.qrList || []).find(function (row) {
          return row && row.label === label;
        });
    }
    if (!found) throw new Error('找不到 Quick Reply：' + from);
    var closure = new StscriptParser().parse(found.message, true, [], args._abortController),
      candidates = closure.executorList
        .filter(function (executor) {
          return executor.command && ['let', 'var'].includes(executor.command.name);
        })
        .map(function (executor) {
          var keyArg = executor.namedArgumentList.find(function (arg) {
              return arg.name === 'key';
            }),
            values = executor.unnamedArgumentList || [],
            key = keyArg ? keyArg.value : values[0] && values[0].value,
            picked = keyArg ? values[0] : values[1];
          return picked && picked.value instanceof StscriptClosure ? { key: key, value: picked.value } : null;
        })
        .filter(Boolean);
    for (var index = 0; index < wanted.length; index++) {
      var sourceName = String(wanted[index]),
        destinationName = sourceName;
      if (index + 2 < wanted.length && wanted[index + 1] === 'as') {
        destinationName = String(wanted[index + 2]);
        index += 2;
      }
      var candidate = candidates.find(function (item) {
        return String(item.key) === sourceName;
      });
      if (!candidate) throw new Error('Quick Reply "' + from + '" 中没有作用域闭包 "' + sourceName + '"');
      if (args._scope.existsVariableInScope(destinationName)) args._scope.setVariable(destinationName, candidate.value);
      else args._scope.letVariable(destinationName, candidate.value);
    }
    return '';
  },
});
