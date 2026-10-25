/* global module */
// The guarded CommonJS export is used by Node tests.
function installYeyuRisuRegex(g) {
  'use strict';

  // RisuAI v2026.10.211 process/scripts.ts semantics. The caller owns CBS,
  // message persistence, emotion state and worker lifecycle.
  var MODES = Object.freeze(['editinput', 'editoutput', 'editprocess', 'editdisplay']);
  var META_RE = /<(.+?)>/g;
  var DATA_RE = /{{data}}/g;

  function own(value, key) {
    return !!value && Object.prototype.hasOwnProperty.call(value, key);
  }

  function messageOf(error) {
    return error && error.message ? String(error.message) : String(error);
  }

  function copyScript(script) {
    var clone = {};
    if (!script || typeof script !== 'object') return clone;
    Object.keys(script).forEach(function (key) {
      clone[key] = script[key];
    });
    return clone;
  }

  function parseScripts(scripts) {
    var parsed = [];
    var orderChanged = false;
    for (var i = 0; i < scripts.length; i++) {
      var original = scripts[i];
      var script = original;
      var order = 0;
      var actions = [];
      if (original && original.ableFlag && typeof original.flag === 'string' && original.flag.indexOf('<') !== -1) {
        script = copyScript(original);
        script.flag = original.flag.replace(META_RE, function (_, body) {
          body
            .split(',')
            .map(function (value) {
              return value.trim();
            })
            .forEach(function (action) {
              if (action.indexOf('order ') === 0) {
                order = parseInt(action.substring(6), 10);
                orderChanged = true;
              } else {
                actions.push(action);
              }
            });
          return '';
        });
      }
      parsed.push({ script: script, order: order, actions: actions, sourceIndex: i });
    }
    if (orderChanged) {
      parsed.sort(function (a, b) {
        return b.order - a.order;
      });
    }
    return parsed;
  }

  // Exported: a host deciding which hits this pass will replace has to build its regex with exactly
  // these flags, or it reads a different set of matches than the display actually rewrites.
  function normalizeFlags(script, output, actions) {
    script = script || {};
    output = String(output == null ? '' : output);
    actions = Array.isArray(actions) ? actions : [];
    var flag = script.ableFlag ? script.flag || 'g' : 'g';
    if (
      output.indexOf('@@move_top') === 0 ||
      output.indexOf('@@move_bottom') === 0 ||
      actions.indexOf('move_top') !== -1 ||
      actions.indexOf('move_bottom') !== -1
    ) {
      flag = flag.replace('g', '');
    }
    flag = String(flag)
      .trim()
      .replace(/[^dgimsuvy]/g, '')
      .split('')
      .filter(function (value, index, all) {
        return all.indexOf(value) === index;
      })
      .join('');
    return flag || 'u';
  }

  function moveReplacement(output, match) {
    var matchedText = match[0];
    return output
      .replace('@@move_top ', '')
      .replace('@@move_bottom ', '')
      .replace(/(?<!\$)\$[0-9]+/g, function (value) {
        var index = parseInt(value.substring(1), 10);
        return index < match.length ? match[index] : value;
      })
      .replace(/\$&/g, matchedText)
      .replace(/(?<!\$)\$<([^>]+)>/g, function (value) {
        // This numeric lookup intentionally follows the fixed upstream source.
        var groupName = parseInt(value.substring(2, value.length - 1), 10);
        return match.groups && match.groups[groupName] ? match.groups[groupName] : value;
      });
  }

  function run(data, scripts, mode, context) {
    context = context || {};
    var diagnostics = [];
    var effects = [];
    var stopped = false;
    var value = String(data === undefined || data === null ? '' : data);
    var maxScripts = Math.max(1, Number(context.maxScripts) || 10000);
    var executed = 0;

    function diagnostic(code, text, parsed, level, detail) {
      var row = {
        level: level || 'error',
        code: code,
        message: String(text),
      };
      if (parsed) {
        row.scriptIndex = parsed.sourceIndex;
        if (parsed.script && parsed.script.comment !== undefined) row.comment = String(parsed.script.comment);
      }
      if (detail !== undefined) row.detail = detail;
      diagnostics.push(row);
      if (typeof context.onDiagnostic === 'function') {
        try {
          context.onDiagnostic(row);
        } catch (_) {}
      }
      return row;
    }

    function emit(effect, parsed) {
      effect.scriptIndex = parsed.sourceIndex;
      effects.push(effect);
      if (typeof context.onEffect === 'function') context.onEffect(effect);
    }

    function render(text, parsed, phase) {
      if (typeof context.render === 'function') {
        return String(
          context.render(String(text), {
            mode: mode,
            phase: phase,
            scriptIndex: parsed ? parsed.sourceIndex : -1,
          })
        );
      }
      // Same CBS syntax test as YeyuRisuCBS.hasMacros: "{{" or an upstream <user>/<char>/<bot> tag.
      if (/{{|<(?:user|char|bot)>/i.test(String(text))) {
        diagnostic('RENDER_UNAVAILABLE', 'Risu CBS renderer is required for this text', parsed, 'warning', {
          phase: phase,
        });
      }
      return String(text);
    }

    if (MODES.indexOf(mode) === -1) {
      diagnostic('INVALID_MODE', 'Unsupported Risu regex mode: ' + String(mode));
      return { data: value, effects: effects, diagnostics: diagnostics, stopped: true };
    }
    if (!Array.isArray(scripts)) {
      diagnostic('INVALID_SCRIPTS', 'Risu regex scripts must be an array');
      return { data: value, effects: effects, diagnostics: diagnostics, stopped: true };
    }

    try {
      value = render(value, null, 'input');
    } catch (error) {
      diagnostic('INITIAL_RENDER_ERROR', messageOf(error), null, 'error');
      return { data: value, effects: effects, diagnostics: diagnostics, stopped: true };
    }

    var parsedScripts = parseScripts(scripts);
    for (var p = 0; p < parsedScripts.length; p++) {
      var parsed = parsedScripts[p];
      var script = parsed.script;
      if (!script || script.type !== mode || script.in === '') continue;
      if (typeof context.shouldStop === 'function' && context.shouldStop()) {
        diagnostic('STOP_REQUESTED', 'Risu regex execution was stopped', parsed, 'warning');
        stopped = true;
        break;
      }
      executed++;
      if (executed > maxScripts) {
        diagnostic('SCRIPT_LIMIT', 'Risu regex script limit reached', parsed, 'error', { maxScripts: maxScripts });
        stopped = true;
        break;
      }

      try {
        var output = String(script.out).replaceAll('$n', '\n').replace(DATA_RE, '$&');
        if (output.endsWith('>') && parsed.actions.indexOf('no_end_nl') === -1) output += '\n';
        var flags = normalizeFlags(script, output, parsed.actions);
        var input = String(script.in);
        if (parsed.actions.indexOf('cbs') !== -1) input = render(input, parsed, 'pattern');
        var regex = new RegExp(input, flags);
        var special = output.indexOf('@@') === 0 || parsed.actions.length > 0;

        if (!special) {
          value = render(value.replace(regex, output), parsed, 'replacement');
          continue;
        }

        if (regex.test(value)) {
          if (output.indexOf('@@emo ') === 0) {
            var emotionName = String(script.out).substring(6).trim();
            var effect = { type: 'emotion', name: emotionName };
            if (Array.isArray(context.emotions)) {
              var emotion = context.emotions.find(function (row) {
                return Array.isArray(row) && row[0] === emotionName;
              });
              if (!emotion) continue;
              effect.asset = emotion[1];
            }
            emit(effect, parsed);
          } else if (
            (output.indexOf('@@inject') === 0 || parsed.actions.indexOf('inject') !== -1) &&
            Number.isInteger(context.chatIndex) &&
            context.chatIndex !== -1
          ) {
            emit({ type: 'inject', chatIndex: context.chatIndex, data: value }, parsed);
            value = value.replace(regex, '');
          } else if (
            output.indexOf('@@move_top') === 0 ||
            output.indexOf('@@move_bottom') === 0 ||
            parsed.actions.indexOf('move_top') !== -1 ||
            parsed.actions.indexOf('move_bottom') !== -1
          ) {
            var global = flags.indexOf('g') !== -1;
            var matches = global ? Array.from(value.matchAll(regex)) : [value.match(regex)];
            value = value.replace(regex, '');
            for (var m = 0; m < matches.length; m++) {
              if (!matches[m]) continue;
              var moved = moveReplacement(output, matches[m]);
              if (output.indexOf('@@move_top') === 0 || parsed.actions.indexOf('move_top') !== -1) {
                value = moved + '\n' + value;
              } else {
                value = value + '\n' + moved;
              }
            }
          } else {
            value = render(value.replace(regex, output), parsed, 'replacement');
          }
          continue;
        }

        if (
          (output.indexOf('@@repeat_back') === 0 || parsed.actions.indexOf('repeat_back') !== -1) &&
          Number.isInteger(context.chatIndex) &&
          context.chatIndex !== -1
        ) {
          var previous;
          if (typeof context.getPreviousSameRole === 'function') {
            previous = context.getPreviousSameRole({
              chatIndex: context.chatIndex,
              mode: mode,
              scriptIndex: parsed.sourceIndex,
            });
          } else if (own(context, 'previousSameRole')) {
            previous = context.previousSameRole;
          } else {
            diagnostic(
              'PREVIOUS_MESSAGE_UNAVAILABLE',
              'repeat_back requires the previous message from the host',
              parsed,
              'warning'
            );
            continue;
          }
          var repeated = String(previous === undefined || previous === null ? '' : previous).match(regex);
          if (!repeated) throw new Error('repeat_back pattern did not match the previous message');
          var placement = output.split(' ', 2)[1];
          if (!placement || placement === 'end') value += repeated[0];
          else if (placement === 'start') value = repeated[0] + value;
          else if (placement === 'end_nl') value += '\n' + repeated[0];
          else if (placement === 'start_nl') value = repeated[0] + '\n' + value;
        }
      } catch (error) {
        diagnostic('SCRIPT_ERROR', messageOf(error), parsed, 'error', {
          name: error && error.name ? String(error.name) : 'Error',
        });
      }
    }

    return { data: value, effects: effects, diagnostics: diagnostics, stopped: stopped };
  }

  var api = Object.freeze({
    run: run,
    modes: MODES.slice(),
    normalizeFlags: normalizeFlags,
  });
  g.YeyuRisuRegex = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}

installYeyuRisuRegex(typeof window !== 'undefined' ? window : globalThis);
(typeof window !== 'undefined' ? window : globalThis).YeyuRisuRegexInstaller = installYeyuRisuRegex;
