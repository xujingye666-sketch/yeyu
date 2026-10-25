function installYeyuRisuLorebook(root) {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function own(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
  }

  function number(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function keyList(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function hashText(value) {
    return root.YeyuRisuCBS.pickHashRand(5555, String(value == null ? '' : value)).toString();
  }

  // Fixed @risuai/ccardlib 0.4.2 decorator.parse semantics. The callback's
  // false result enables the following @@@ fallback, including across rows.
  function parseDecorators(value, callback) {
    var lines = String(value == null ? '' : value)
        .trim()
        .split('\n'),
      fallback = false;
    for (var index = 0; index < lines.length; index++) {
      var line = lines[index].trim();
      if (line === '@@@end') line = '@@end';
      if (!line.startsWith('@@')) return lines.slice(index).join('\n').trim();
      if (line.startsWith('@@@') && !fallback) continue;
      var split = line.indexOf(' ');
      if (split < 0) split = line.length;
      var name = line.slice(line.startsWith('@@@') ? 3 : 2, split),
        args = line
          .slice(split)
          .split(',')
          .map(function (item) {
            return item.trim();
          })
          .filter(Boolean);
      fallback = name !== '' && callback(name, args) === false;
    }
    return '';
  }

  function normalizeRisuEntry(entry) {
    entry = entry && typeof entry === 'object' ? clone(entry) : {};
    return {
      key: String(entry.key == null ? '' : entry.key),
      secondkey: String(entry.secondkey == null ? '' : entry.secondkey),
      insertorder: number(entry.insertorder, 100),
      comment: String(entry.comment == null ? '' : entry.comment),
      content: String(entry.content == null ? '' : entry.content),
      mode: String(entry.mode || 'normal'),
      alwaysActive: entry.alwaysActive === true,
      selective: entry.selective === true,
      extentions: clone(entry.extentions || {}),
      activationPercent: own(entry, 'activationPercent') ? entry.activationPercent : undefined,
      loreCache: clone(entry.loreCache || null),
      useRegex: entry.useRegex === true,
      bookVersion: entry.bookVersion,
      id: entry.id,
      folder: entry.folder,
    };
  }

  // Mirrors characterCards.ts convertCharbook without mutating the preserved card.
  function normalizeCharacterBook(book) {
    book = book && typeof book === 'object' ? book : {};
    var entries = Array.isArray(book.entries)
        ? book.entries
        : book.entries && typeof book.entries === 'object'
          ? Object.keys(book.entries).map(function (key) {
              return book.entries[key];
            })
          : [],
      result = [];
    entries.forEach(function (source) {
      source = source && typeof source === 'object' ? source : {};
      var extensions = clone(source.extensions || {}),
        content = String(source.content == null ? '' : source.content),
        keys = keyList(source.keys),
        secondary = keyList(source.secondary_keys),
        selective = source.selective === true,
        useRegex = source.use_regex === true;
      if (useRegex && !(keys[0] || '').startsWith('/')) useRegex = false;
      if (extensions.useProbability && extensions.probability !== undefined && extensions.probability !== 100) {
        content = '@@probability ' + extensions.probability + '\n' + content;
        delete extensions.useProbability;
        delete extensions.probability;
      }
      if (extensions.position === 4 && typeof extensions.depth === 'number' && typeof extensions.role === 'number') {
        content =
          '@@depth ' +
          extensions.depth +
          '\n@@role ' +
          (['system', 'user', 'assistant'][extensions.role] || 'system') +
          '\n' +
          content;
        delete extensions.position;
        delete extensions.depth;
        delete extensions.role;
      }
      if (typeof extensions.selectiveLogic === 'number' && secondary.length) {
        if (extensions.selectiveLogic === 0 && !secondary.length) selective = false;
        else if (extensions.selectiveLogic === 1) {
          selective = false;
          content = '@@exclude_keys_all ' + secondary.join(',') + '\n' + content;
        } else if (extensions.selectiveLogic === 2 || extensions.selectiveLogic === 3) {
          selective = false;
          var directive = extensions.selectiveLogic === 2 ? '@@exclude_keys ' : '@@additional_keys ';
          secondary.forEach(function (key) {
            content = directive + key + '\n' + content;
          });
        }
      }
      if (typeof extensions.delay === 'number' && extensions.delay > 0) {
        content = '@@activate_only_after ' + extensions.delay + '\n' + content;
        delete extensions.delay;
      }
      if (extensions.match_whole_words === true) {
        content = '@@match_full_word\n' + content;
        delete extensions.match_whole_words;
      }
      if (extensions.match_whole_words === false) {
        content = '@@match_partial_word\n' + content;
        delete extensions.match_whole_words;
      }
      result.push(
        normalizeRisuEntry({
          key: keys.join(', '),
          secondkey: secondary.join(', '),
          insertorder: number(source.insertion_order, 0),
          comment: source.name ?? source.comment ?? '',
          content: content,
          mode: source.mode || 'normal',
          alwaysActive: source.constant === true,
          selective: selective,
          extentions: Object.assign({}, extensions, { risu_case_sensitive: source.case_sensitive }),
          activationPercent: extensions.risu_activationPercent,
          loreCache: extensions.risu_loreCache || null,
          useRegex: useRegex,
          folder: source.folder,
        })
      );
    });
    var hasSettings = book.recursive_scanning != null && book.scan_depth != null && book.token_budget != null;
    return {
      entries: result,
      settings: hasSettings
        ? {
            scanDepth: number(book.scan_depth, 5),
            tokenBudget: number(book.token_budget, 0),
            recursiveScanning: book.recursive_scanning === true,
            fullWordMatching: !!(book.extensions && book.extensions.risu_fullWordMatching),
          }
        : null,
    };
  }

  // tokenBudget 为 0 表示不限，缺省即不限。
  function normalizeSettings(settings) {
    settings = settings || {};
    return {
      scanDepth: number(settings.scanDepth, 5),
      tokenBudget: number(settings.tokenBudget, 0),
      recursiveScanning: settings.recursiveScanning == null ? true : settings.recursiveScanning === true,
      fullWordMatching: settings.fullWordMatching === true,
    };
  }

  function resolve(options) {
    options = options || {};
    // Keep folders in the indexed source just as the fixed upstream does. They
    // normally cannot activate, but child entries refer to the original order.
    var fullLore = (options.entries || []).map(normalizeRisuEntry),
      messages = Array.isArray(options.messages) ? options.messages : [],
      settings = normalizeSettings(options.settings),
      chatLength = number(options.chatLength, messages.length + 1),
      greetingIndex = number(options.greetingIndex, 0),
      render = typeof options.render === 'function' ? options.render : String,
      tokenCount =
        typeof options.tokenize === 'function'
          ? options.tokenize
          : function (text) {
              return Math.ceil(String(text || '').length * 0.4);
            },
      random = typeof options.random === 'function' ? options.random : Math.random,
      getChatVar =
        typeof options.getChatVar === 'function'
          ? options.getChatVar
          : function () {
              return undefined;
            },
      setChatVar = typeof options.setChatVar === 'function' ? options.setChatVar : function () {},
      recursivePrompt = [],
      matchLog = [],
      actives = [],
      activatedIndexes = [],
      disabledUiPrompts = [],
      matching = true;

    function messageData(message) {
      if (message && own(message, 'data')) return String(message.data == null ? '' : message.data);
      return String((message && message.content) || '');
    }

    function searchMatch(argument) {
      var sliced = messages.slice(messages.length - argument.searchDepth),
        keys = (argument.keys || [])
          .map(function (key) {
            return String(key).trim();
          })
          .filter(Boolean),
        rows = sliced.map(function (message, index) {
          return {
            source: 'message ' + index + ' by ' + (message.role === 'user' ? 'user' : 'char'),
            prompt:
              '\x01{{' +
              (message.role === 'user'
                ? options.userName || ''
                : (message.name ?? (options.characterNames || {})[message.saying] ?? options.characterName ?? '')) +
              '}}:' +
              messageData(message) +
              '\x01',
            data: messageData(message),
          };
        });
      if (!argument.dontSearchWhenRecursive)
        rows = rows.concat(
          recursivePrompt.map(function (message) {
            return { source: 'lorebook ' + message.source, prompt: message.prompt, data: message.data };
          })
        );
      if (argument.regex) {
        var regexes = [];
        for (var regexString of keys) {
          var parsed = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(regexString);
          if (!parsed) return false;
          try {
            regexes.push({ regex: new RegExp(parsed[1], parsed[2]), source: regexString });
          } catch (_) {
            return false;
          }
        }
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          for (var item of regexes) {
            item.regex.lastIndex = 0;
            if (item.regex.test(rows[rowIndex].data)) {
              matchLog.push({ prompt: rows[rowIndex].prompt, source: rows[rowIndex].source, activated: item.source });
              return true;
            }
          }
        }
        return false;
      }
      rows = rows.map(function (row) {
        return {
          source: row.source,
          prompt: row.prompt
            .toLocaleLowerCase()
            .replace(/\{\{\/\/(.+?)\}\}/g, '')
            .replace(/\{\{comment:(.+?)\}\}/g, ''),
          data: row.data
            .toLocaleLowerCase()
            .replace(/\{\{\/\/(.+?)\}\}/g, '')
            .replace(/\{\{comment:(.+?)\}\}/g, ''),
        };
      });
      var allMode = argument.all === true,
        allModeMatched = true;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        var text = rows[rowIndex].data;
        if (argument.fullWordMatching) {
          var words = text.split(' ');
          for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
            if (words.includes(keys[keyIndex].toLocaleLowerCase())) {
              matchLog.push({
                prompt: rows[rowIndex].prompt,
                source: rows[rowIndex].source,
                activated: keys[keyIndex],
              });
              if (!allMode) return true;
            } else if (allMode) allModeMatched = false;
          }
        } else {
          text = text.replace(/ /g, '');
          for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
            var realKey = keys[keyIndex].toLocaleLowerCase().replace(/ /g, '');
            if (text.includes(realKey)) {
              matchLog.push({
                prompt: rows[rowIndex].prompt,
                source: rows[rowIndex].source,
                activated: keys[keyIndex],
              });
              if (!allMode) return true;
            } else if (allMode) allModeMatched = false;
          }
        }
      }
      return allMode && allModeMatched;
    }

    while (matching) {
      matching = false;
      for (var index = 0; index < fullLore.length; index++) {
        var lore = fullLore[index];
        if (activatedIndexes.includes(index)) continue;
        if (!lore.alwaysActive && !lore.key) continue;
        var activated = true,
          keepActivateAfterMatch = false,
          dontActivateAfterMatch = false,
          pos = '',
          inject = null,
          depth = 0,
          scanDepth = settings.scanDepth,
          order = lore.insertorder,
          priority = lore.insertorder,
          forceState = 'none',
          role = 'system',
          searchQueries = [],
          fullWordMatching = settings.fullWordMatching,
          dontSearchWhenRecursive = false,
          itemRecursive = 'global';
        if (lore.mode === 'child') {
          activated = false;
          for (var parentIndex = 0; parentIndex < index; parentIndex++) {
            if (fullLore[parentIndex].id === lore.id) {
              if (!activatedIndexes.includes(parentIndex)) {
                lore.comment = fullLore[parentIndex].comment;
                lore.content = fullLore[parentIndex].content;
                lore.alwaysActive = true;
                activated = true;
              }
              break;
            }
          }
        }
        var content = parseDecorators(lore.content, function (name, args) {
          var integer;
          if (name === 'end') {
            pos = 'depth';
            depth = 0;
          } else if (name === 'activate_only_after') {
            integer = parseInt(args[0]);
            if (Number.isNaN(integer)) return false;
            if (chatLength < integer) activated = false;
          } else if (name === 'activate_only_every') {
            integer = parseInt(args[0]);
            if (Number.isNaN(integer)) return false;
            if (chatLength % integer !== 0) activated = false;
          } else if (name === 'keep_activate_after_match') {
            if (getChatVar('__internal_ka_' + (lore.id ?? hashText(lore.content))) === 'true') forceState = 'activate';
            else keepActivateAfterMatch = true;
            return false;
          } else if (name === 'dont_activate_after_match') {
            if (getChatVar('__internal_da_' + (lore.id ?? hashText(lore.content))) === 'true')
              forceState = 'deactivate';
            else dontActivateAfterMatch = true;
            return false;
          } else if (name === 'depth' || name === 'reverse_depth') {
            integer = parseInt(args[0]);
            if (Number.isNaN(integer)) return false;
            depth = integer;
            pos = name;
          } else if (name === 'instruct_depth' || name === 'reverse_instruct_depth' || name === 'instruct_scan_depth')
            return false;
          else if (name === 'role') {
            if (!['user', 'assistant', 'system'].includes(args[0])) return false;
            role = args[0];
          } else if (name === 'scan_depth') scanDepth = parseInt(args[0]);
          else if (name === 'is_greeting') {
            integer = parseInt(args[0]);
            if (Number.isNaN(integer)) return false;
            if (greetingIndex !== integer) activated = false;
          } else if (name === 'position') {
            if (
              !(
                String(args[0] || '').startsWith('pt_') ||
                ['after_desc', 'before_desc', 'personality', 'scenario'].includes(args[0])
              )
            )
              return false;
            pos = args[0];
          } else if (name === 'inject_lore' || name === 'inject_at') {
            inject = inject || { operation: 'append', location: '', param: '', lore: name === 'inject_lore' };
            inject.location = args.join(' ');
            inject.lore = name === 'inject_lore';
          } else if (name === 'inject_replace' || name === 'inject_prepend') {
            inject = inject || { operation: 'append', location: '', param: '', lore: false };
            inject.operation = name === 'inject_replace' ? 'replace' : 'prepend';
            inject.param = args.join(' ');
          } else if (name === 'ignore_on_max_context') priority = -1000;
          else if (name === 'additional_keys') searchQueries.push({ keys: args, negative: false });
          else if (name === 'exclude_keys') searchQueries.push({ keys: args, negative: true });
          else if (name === 'exclude_keys_all') searchQueries.push({ keys: args, negative: true, all: true });
          else if (name === 'match_full_word') fullWordMatching = true;
          else if (name === 'match_partial_word') fullWordMatching = false;
          else if (name === 'is_user_icon') return false;
          else if (name === 'activate') forceState = 'activate';
          else if (name === 'dont_activate') forceState = 'deactivate';
          else if (name === 'disable_ui_prompt') {
            if (!['post_history_instructions', 'system_prompt'].includes(args[0])) return false;
            disabledUiPrompts.push(args[0]);
          } else if (name === 'probability') {
            if (random() * 100 > parseInt(args[0])) activated = false;
          } else if (name === 'priority') priority = parseInt(args[0]);
          else if (name === 'unrecursive') itemRecursive = false;
          else if (name === 'recursive') itemRecursive = true;
          else if (name === 'no_recursive_search') dontSearchWhenRecursive = true;
          else return false;
          return undefined;
        });
        if (!activated || forceState !== 'none' || lore.alwaysActive) {
          // Official skips keyword matching in each of these states.
        } else {
          searchQueries.push({ keys: lore.key.split(','), negative: false });
          if (lore.secondkey && lore.selective)
            searchQueries.push({ keys: lore.secondkey.split(','), negative: false });
          for (var queryIndex = 0; queryIndex < searchQueries.length; queryIndex++) {
            var query = searchQueries[queryIndex],
              matched = searchMatch({
                keys: query.keys,
                searchDepth: scanDepth,
                regex: lore.useRegex,
                fullWordMatching: fullWordMatching,
                all: query.all,
                dontSearchWhenRecursive: dontSearchWhenRecursive,
              });
            if ((query.negative && matched) || (!query.negative && !matched)) {
              activated = false;
              break;
            }
          }
        }
        if (forceState === 'activate') activated = true;
        else if (forceState === 'deactivate') activated = false;
        if (!activated) continue;
        var renderedForTokens = String(render(content));
        actives.push({
          depth: depth,
          pos: pos,
          prompt: content,
          role: role,
          order: order,
          tokens: number(tokenCount(renderedForTokens), 0),
          priority: priority,
          source: lore.comment || 'lorebook ' + index,
          inject: inject,
          index: index,
        });
        activatedIndexes.push(index);
        if (keepActivateAfterMatch) setChatVar('__internal_ka_' + (lore.id ?? hashText(lore.content)), 'true');
        if (dontActivateAfterMatch) setChatVar('__internal_da_' + (lore.id ?? hashText(lore.content)), 'true');
        var recursive = itemRecursive === 'global' ? settings.recursiveScanning : itemRecursive;
        if (recursive) {
          matching = true;
          recursivePrompt.push({ prompt: content, data: content, source: lore.comment || 'lorebook ' + index });
        }
      }
    }

    var usedTokens = 0,
      filtered = actives
        .sort(function (a, b) {
          return b.priority - a.priority;
        })
        .filter(function (active) {
          if (settings.tokenBudget <= 0 || usedTokens + active.tokens <= settings.tokenBudget) {
            usedTokens += active.tokens;
            return true;
          }
          return false;
        })
        .sort(function (a, b) {
          return b.order - a.order;
        }),
      loreInjections = filtered.filter(function (active) {
        return active.inject && active.inject.lore;
      });
    filtered = filtered.filter(function (active) {
      return !(active.inject && active.inject.lore);
    });
    loreInjections.forEach(function (injection) {
      var target = filtered.find(function (active) {
        return active.source === injection.inject.location;
      });
      if (!target) return;
      if (injection.inject.operation === 'append') target.prompt += ' ' + injection.prompt;
      else if (injection.inject.operation === 'prepend') target.prompt = injection.prompt + ' ' + target.prompt;
      else target.prompt = target.prompt.replace(injection.inject.param, injection.prompt);
    });
    return {
      actives: filtered.reverse(),
      matchLog: matchLog,
      disabledUiPrompts: Array.from(new Set(disabledUiPrompts)),
      usedTokens: usedTokens,
      activatedIndexes: activatedIndexes.slice(),
    };
  }

  function applyInjection(value, location, resolved) {
    var text = String(value == null ? '' : value),
      rows = ((resolved && resolved.actives) || []).filter(function (active) {
        return active.inject && !active.inject.lore && active.inject.location === location;
      });
    rows.forEach(function (active) {
      if (active.inject.operation === 'append') text += ' ' + active.prompt;
      else if (active.inject.operation === 'prepend') text = active.prompt + ' ' + text;
      else text = text.replace(active.inject.param, active.prompt);
    });
    return text;
  }

  function applyPosition(value, resolved, maxDepth) {
    var text = String(value == null ? '' : value),
      pattern = /\{\{position::(.+?)\}\}/g,
      depth = Math.max(1, number(maxDepth, 5));
    for (var index = 0; index < depth && pattern.test(text); index++) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, function (_, name) {
        return ((resolved && resolved.actives) || [])
          .filter(function (active) {
            return active.pos === 'pt_' + name;
          })
          .map(function (active) {
            return active.prompt;
          })
          .join('\n');
      });
      pattern.lastIndex = 0;
    }
    return text.replace(pattern, '');
  }

  root.YeyuRisuLorebook = Object.freeze({
    normalizeEntry: normalizeRisuEntry,
    normalizeCharacterBook: normalizeCharacterBook,
    normalizeSettings: normalizeSettings,
    parseDecorators: parseDecorators,
    resolve: resolve,
    applyInjection: applyInjection,
    applyPosition: applyPosition,
    capabilities: Object.freeze({
      sources: Object.freeze(['character_book', 'module.risum', 'session.risu.localLore']),
      decorators: Object.freeze([
        'end',
        'activate_only_after',
        'activate_only_every',
        'keep_activate_after_match',
        'dont_activate_after_match',
        'depth',
        'reverse_depth',
        'instruct_depth',
        'reverse_instruct_depth',
        'instruct_scan_depth',
        'role',
        'scan_depth',
        'is_greeting',
        'position',
        'inject_lore',
        'inject_at',
        'inject_replace',
        'inject_prepend',
        'ignore_on_max_context',
        'additional_keys',
        'exclude_keys',
        'exclude_keys_all',
        'match_full_word',
        'match_partial_word',
        'is_user_icon',
        'activate',
        'dont_activate',
        'disable_ui_prompt',
        'probability',
        'priority',
        'unrecursive',
        'recursive',
        'no_recursive_search',
      ]),
      // The fixed upstream recognizes these rows but deliberately gives them no
      // runtime behavior (instruct mode does not exist; is_user_icon is TODO).
      docOnlyNoOpDecorators: Object.freeze([
        'instruct_depth',
        'reverse_instruct_depth',
        'instruct_scan_depth',
        'is_user_icon',
      ]),
      unsupportedDecorators: Object.freeze([]),
      tokenizer: 'host callback; app integration uses its existing estimator',
    }),
  });
}
installYeyuRisuLorebook(typeof window !== 'undefined' ? window : globalThis);
(typeof window !== 'undefined' ? window : globalThis).YeyuRisuLorebookInstaller = installYeyuRisuLorebook;
