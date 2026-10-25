/* global window -- js/core/risu-regex-runtime.js loads this file on the page before serializing the Worker entry. */
function yeyuRisuRegexWorkerMain() {
  'use strict';

  var scope = self;

  var loaded = Object.create(null);
  var cancelled = Object.create(null);

  function serializeError(error) {
    return {
      name: error && error.name ? String(error.name) : 'Error',
      message: error && error.message ? String(error.message) : String(error),
      code: error && error.code ? String(error.code) : '',
    };
  }

  function loadDependency(url) {
    if (!url || loaded[url]) return;
    importScripts(String(url));
    loaded[url] = true;
  }

  function ensureApis(dependencies) {
    dependencies = dependencies || {};
    if (!scope.YeyuRisuCBS) loadDependency(dependencies.cbs);
    if (!scope.YeyuRisuRegex) loadDependency(dependencies.regex);
    if (!scope.YeyuRisuCBS) throw new Error('YeyuRisuCBS is unavailable in the Risu regex worker');
    if (!scope.YeyuRisuRegex) throw new Error('YeyuRisuRegex is unavailable in the Risu regex worker');
  }

  function own(value, key) {
    return !!value && Object.prototype.hasOwnProperty.call(value, key);
  }

  function seededRandom(seed) {
    var state = Number(seed) >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function assetResolver(snapshot) {
    var map = snapshot.assetMap || snapshot.assets;
    if (!map) return null;
    return function (type, name) {
      var typed = String(type) + '::' + String(name);
      if (!Array.isArray(map) && typeof map === 'object') {
        if (own(map, typed)) return map[typed];
        if (own(map, name)) return map[name];
        return undefined;
      }
      if (Array.isArray(map)) {
        for (var i = 0; i < map.length; i++) {
          var row = map[i];
          if (Array.isArray(row) && row[0] === name) return row[1];
          if (row && typeof row === 'object' && row.name === name)
            return row.value !== undefined ? row.value : row.url;
        }
      }
      return undefined;
    };
  }

  function prepareCbs(snapshot, diagnostics, effects) {
    snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
    var variables = snapshot.chatVariables && typeof snapshot.chatVariables === 'object' ? snapshot.chatVariables : {};
    snapshot.chatVariables = variables;
    snapshot.getChatVar = function (name) {
      name = String(name);
      if (own(variables, name)) return variables[name];
      if (own(variables, '$' + name)) return variables['$' + name];
      return undefined;
    };
    snapshot.setChatVar = function (name, value) {
      name = String(name);
      value = String(value);
      variables[name] = value;
      effects.push({ type: 'setChatVariable', name: name, value: value });
    };
    var globals = snapshot.globalVariables && typeof snapshot.globalVariables === 'object' ? snapshot.globalVariables : {};
    snapshot.globalVariables = globals;
    snapshot.getGlobalVar = function (name) {
      name = String(name);
      return own(globals, name) ? globals[name] : undefined;
    };
    var resolveAsset = assetResolver(snapshot);
    if (resolveAsset) snapshot.resolveAsset = resolveAsset;
    if (Number.isFinite(snapshot.randomSeed)) snapshot.random = seededRandom(snapshot.randomSeed);
    if (Array.isArray(snapshot.randomValues) && snapshot.randomValues.length) {
      var randomIndex = 0;
      snapshot.random = function () {
        var value = Number(snapshot.randomValues[randomIndex % snapshot.randomValues.length]);
        randomIndex++;
        return value;
      };
    }
    snapshot.onError = function (detail) {
      var code = String((detail && detail.code) || 'ERROR');
      if (snapshot.commandPlaceholders && code === 'UNKNOWN_MACRO' && /^\{\{(?:pipe|slot)\}\}$/.test(detail.macro)) return;
      diagnostics.push({
        level: 'error',
        code: 'CBS_' + code,
        message: 'Risu CBS evaluation failed (' + code + ')',
        detail: detail && Number.isInteger(detail.position) ? { position: detail.position } : null,
      });
    };
    return snapshot;
  }

  function runRequest(request) {
    ensureApis(request.dependencies);
    var diagnostics = [];
    var effects = [];
    var cbs = prepareCbs(request.cbsContext || (request.context && request.context.cbs), diagnostics, effects);
    var sourceContext = request.context && typeof request.context === 'object' ? request.context : {};
    var context = {};
    Object.keys(sourceContext).forEach(function (key) {
      if (key !== 'cbs') context[key] = sourceContext[key];
    });
    var inputHistory;
    context.render = function (text, phase) {
      var tracking = cbs.trackHistory && phase.phase === 'input';
      // Only the initial CBS pass describes the message's original macro addresses.
      // Replacement CBS must not append its already-expanded nodes to that history.
      cbs.outputTrace = tracking ? [] : null;
      var rendered = scope.YeyuRisuCBS.evaluate(text, cbs);
      if (tracking) inputHistory = { source: text, text: rendered, trace: cbs.outputTrace };
      return rendered;
    };
    context.onDiagnostic = function (row) {
      diagnostics.push({
        level: row.level,
        code: row.code,
        message:
          row.code === 'SCRIPT_ERROR' && row.detail && row.detail.name === 'SyntaxError'
            ? 'Invalid Risu regex pattern'
            : row.message,
        scriptIndex: row.scriptIndex,
      });
    };
    context.onEffect = function (effect) {
      effects.push(effect);
    };
    context.shouldStop = function () {
      return !!cancelled[request.id];
    };

    var result = scope.YeyuRisuRegex.run(request.data, request.scripts, request.mode, context);
    result.diagnostics = diagnostics;
    result.effects = effects;
    if(inputHistory) {
      result.template=scope.YeyuRisuHistory.retainTemplate(inputHistory.text,result.data,inputHistory.trace);
      result.inputHistory=inputHistory;
    }
    return result;
  }

  // Rows of one mode against one snapshot: the snapshot, messages and assets arrive once, and each
  // row's variable writes and message injections are in place before the next row runs, exactly as
  // they would be between consecutive single runs. A row that throws or stops is that row's failure:
  // its writes are undone and the next row runs as if it had not been there. `report` announces each
  // row before it starts and hands over its result, so the controller times rows one by one.
  function runBatchRequest(request, report) {
    var base = request.cbsContext && typeof request.cbsContext === 'object' ? request.cbsContext : {},
      messages = Array.isArray(base.messages) ? base.messages : [],
      results = [],
      random = Number.isFinite(base.randomSeed) ? seededRandom(base.randomSeed) : null;
    var variables = (base.chatVariables =
      base.chatVariables && typeof base.chatVariables === 'object' ? base.chatVariables : {});
    for (var index = 0; index < request.rows.length; index++) {
      var row = request.rows[index],
        position = row.position || {},
        chatIndex = Number.isInteger(row.chatIndex) ? row.chatIndex : -1,
        previous = request.firstMessage,
        before = Object.assign({}, variables),
        result;
      report.started(index);
      for (var at = Math.min(chatIndex - 1, messages.length - 1); at >= 0; at--) {
        if (messages[at] && messages[at].role === position.role) {
          previous = messages[at].data;
          break;
        }
      }
      try {
        result = runRequest({
          id: request.id,
          dependencies: request.dependencies,
          data: row.data,
          scripts: request.scripts,
          mode: request.mode,
          context: { chatIndex: chatIndex, previousSameRole: previous, emotions: request.emotions || [] },
          cbsContext: Object.assign({}, base, position,
            random ? { randomSeed: Math.floor(random() * 4294967296) >>> 0 } : {}),
        });
      } catch (error) {
        result = { error: serializeError(error) };
      }
      if (result.error || result.stopped) {
        Object.keys(variables).forEach(function (key) {
          delete variables[key];
        });
        Object.assign(variables, before);
      } else
        result.effects.forEach(function (effect) {
          if (effect.type === 'inject' && messages[effect.chatIndex]) messages[effect.chatIndex].data = effect.data;
        });
      results.push(result);
      report.finished(result);
    }
    return results;
  }

  function primitiveRequest(request) {
    var input = String(request.input === undefined || request.input === null ? '' : request.input);
    var pattern = String(request.pattern === undefined || request.pattern === null ? '' : request.pattern);
    var flags = String(request.flags || '');
    var regex = new RegExp(pattern, flags);
    if (request.operation === 'test') return regex.test(input);
    if (request.operation === 'split') return input.split(regex);
    if (request.operation === 'replace') {
      if (request.specification && request.specification.kind === 'risu-v2') {
        var specification = request.specification;
        return input.replace(regex, function () {
          var args = Array.prototype.slice.call(arguments);
          var matchText = args[0];
          // Keep the fixed upstream slice, including its named-group offset quirk.
          var groups = args.slice(1, -2);
          var resultFormat = String(specification.resultFormat === undefined ? '' : specification.resultFormat);
          var replacement = String(specification.replacement === undefined ? '' : specification.replacement);
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
      return input.replace(regex, String(request.replacement === undefined ? '' : request.replacement));
    }
    if (request.operation === 'match') {
      var matched = input.match(regex);
      return matched ? Array.from(matched) : null;
    }
    throw new Error('Unsupported Risu regex primitive: ' + String(request.operation));
  }

  scope.onmessage = function (event) {
    var request = (event && event.data) || {};
    var id = request.id;
    if (request.type === 'cancel') {
      cancelled[id] = true;
      return;
    }
    try {
      if (request.type === 'init') {
        ensureApis(request.dependencies);
        scope.postMessage({ type: 'ready', id: id });
        return;
      }
      if (request.type === 'primitive') {
        scope.postMessage({ type: 'started', id: id });
        scope.postMessage({ type: 'primitiveResult', id: id, value: primitiveRequest(request) });
        return;
      }
      if (request.type === 'history') {
        scope.postMessage({type:'started',id:id});
        var templates=request.rows.map(function (row) {
          var template=scope.YeyuRisuHistory.retainTemplate(row.before,row.after,row.trace);
          return {template:template,from:row.from==null?null:scope.YeyuRisuHistory.mapOffset(row.source,template,row.from)};
        });
        scope.postMessage({type:'result',id:id,result:{templates:templates,effects:[],diagnostics:[]}});
        return;
      }
      if (request.type === 'protect-translation') {
        scope.postMessage({ type: 'started', id: id });
        var protection = request.input, slots = [], nextIndex = {value: 0};
        protection.texts.forEach(function (text) {
          String(text || '').replace(/__YEYU_(?:KEEP|PART)_(\d+)__/gi, function (_, index) {
            nextIndex.value = Math.max(nextIndex.value, Number(index) + 1);
            return _;
          });
        });
        var guarded = protection.texts.map(function (text) {
          var from = slots.length;
          var result = scope.YeyuProtectTranslationMarkup(text, {
            patterns: protection.patterns, slots: slots, nextIndex: nextIndex,
          });
          return {source: result.source, slots: slots.slice(from)};
        });
        scope.postMessage({type:'result', id:id, result:{guarded:guarded, effects:[], diagnostics:[]}});
        return;
      }
      if (request.type === 'display-cbs') {
        ensureApis(request.dependencies);
        var displayResults = [], displayContext = request.context || {}, displayLore;
        if (displayContext.loreSource) displayContext.getLorebooks = function () {
          if (!displayLore) {
            var source = displayContext.loreSource;
            var rows = source.entries || scope.YeyuRisuLorebook.normalizeCharacterBook(source.book).entries || [];
            displayLore = rows.map(scope.YeyuRisuLorebook.normalizeEntry).concat(source.local || []);
          }
          return displayLore;
        };
        request.rows.forEach(function (row, index) {
          scope.postMessage({type: 'started', id: id, index: index});
          var result;
          try {
            var diagnostics = [], effects = [], choices = (row.randomValues || []).slice(), cursor = 0, clockDependent = false;
            var snapshot = prepareCbs(Object.assign({}, displayContext, row.context, {runVar: false,rmVar:true}), diagnostics, effects);
            snapshot.onClockRead = function () {clockDependent = true;};
            snapshot.random = function () {
              if (cursor === choices.length) choices.push(Math.random());
              return choices[cursor++];
            };
            snapshot.outputTrace = [];
            result = {text: scope.YeyuRisuCBS.evaluate(String(row.text || ''), snapshot), randomValues: choices,
              inputHistory: {source: String(row.text || ''), trace: snapshot.outputTrace},
              diagnostics: diagnostics, clockDependent: clockDependent};
            result.inputHistory.text = result.text;
          } catch (error) { result = {error: serializeError(error)}; }
          displayResults.push(result);
          scope.postMessage({type: 'rowResult', id: id, result: result});
        });
        scope.postMessage({type: 'result', id: id, result: displayResults});
        return;
      }
      if (request.type === 'cbs' || request.type === 'lore' || request.type === 'visible-spans') {
        ensureApis(request.dependencies);
        var diagnostics = [], effects = [], snapshot = prepareCbs(request.context, diagnostics, effects);
        scope.postMessage({ type: 'started', id: id });
        if (request.type === 'visible-spans') {
          var spans = scope.YeyuRisuCBS.visibleSpans(request.text, snapshot, request.earlier);
          scope.postMessage({type:'result', id:id, result:{spans:spans, effects:effects, diagnostics:diagnostics}});
          return;
        }
        if (request.type === 'lore') {
          var loreOptions = Object.assign({}, request.lore, {
            render: function (text) { return scope.YeyuRisuCBS.evaluate(String(text || ''), snapshot); },
            tokenize: scope.YeyuRisuTokenize,
            getChatVar: function (key) { return (request.lore.chatVariables || {})['$' + key]; },
            setChatVar: function (key, value) {
              (request.lore.chatVariables || (request.lore.chatVariables = {}))['$' + key] = String(value);
              snapshot.setChatVar(key, value);
            },
            random: snapshot.random,
          });
          var loreResult = scope.YeyuRisuLorebook.resolve(loreOptions);
          if (request.lore.renderActives)
            loreResult.actives.forEach(function (active) { active.renderedPrompt = loreOptions.render(active.prompt); });
          scope.postMessage({type:'result', id:id, result:{lore:loreResult, effects:effects, diagnostics:diagnostics}});
          return;
        }
        var traces=[];
        function renderHistory(text,index) {
          if(snapshot.historyRowOptions)Object.assign(snapshot,snapshot.historyRowOptions[index]);
          if(snapshot.trackHistory) snapshot.outputTrace=[];
          var value=scope.YeyuRisuCBS.evaluate(String(text || ''),snapshot);
          if(snapshot.trackHistory)traces.push(snapshot.outputTrace);
          return value;
        }
        var rendered=Array.isArray(request.texts)?request.texts.map(renderHistory):renderHistory(request.text);
        scope.postMessage({ type: 'result', id: id, result: {
          text: rendered, diagnostics: diagnostics, effects: effects, branchTrace: snapshot.branchTrace || [], traces: traces,
        } });
        return;
      }
      if (request.type === 'run-batch') {
        ensureApis(request.dependencies);
        var batchResults = runBatchRequest(request, {
          started: function (index) {
            scope.postMessage({ type: 'started', id: id, index: index });
          },
          finished: function (result) {
            scope.postMessage({ type: 'rowResult', id: id, result: result });
          },
        });
        delete cancelled[id];
        scope.postMessage({ type: 'result', id: id, result: batchResults });
        return;
      }
      if (request.type !== 'run') throw new Error('Unsupported Risu regex worker request: ' + String(request.type));
      if (cancelled[id]) {
        delete cancelled[id];
        scope.postMessage({
          type: 'result',
          id: id,
          result: {
            data: String(request.data === undefined || request.data === null ? '' : request.data),
            effects: [],
            diagnostics: [{ level: 'warning', code: 'STOP_REQUESTED', message: 'Risu regex execution was stopped' }],
            stopped: true,
          },
        });
        return;
      }
      ensureApis(request.dependencies);
      scope.postMessage({ type: 'started', id: id });
      var result = runRequest(request);
      delete cancelled[id];
      scope.postMessage({ type: 'result', id: id, result: result });
    } catch (error) {
      delete cancelled[id];
      scope.postMessage({ type: 'error', id: id, error: serializeError(error) });
    }
  };
}

(typeof window !== 'undefined' ? window : globalThis).YeyuRisuRegexWorkerMain = yeyuRisuRegexWorkerMain;
