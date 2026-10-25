/* global module */
// The guarded CommonJS export is used by Node tests.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YeyuRisuCommand = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function CommandError(code, message, details) {
    this.name = 'CommandError';
    this.code = code;
    this.message = message;
    this.details = details || {};
    if (Error.captureStackTrace) Error.captureStackTrace(this, CommandError);
  }
  CommandError.prototype = Object.create(Error.prototype);
  CommandError.prototype.constructor = CommandError;

  function fail(code, message, details) {
    throw new CommandError(code, message, details);
  }

  function abortError() {
    var error = new CommandError('RISU_COMMAND_ABORTED', 'Risu command execution was cancelled');
    error.name = 'AbortError';
    return error;
  }

  function assertLive(state) {
    if (state.signal && state.signal.aborted) throw abortError();
    if (typeof state.context.assertLive === 'function') state.context.assertLive();
  }

  async function yieldControl(state) {
    assertLive(state);
    if (typeof state.context.yieldControl === 'function') await state.context.yieldControl();
    else
      await new Promise(function (resolve) {
        setTimeout(resolve, 0);
      });
    assertLive(state);
  }

  function host(state, name, command) {
    var fn = state.context[name];
    if (typeof fn !== 'function')
      fail('RISU_COMMAND_HOST_MISSING', 'Risu command host is missing context.' + name, {
        command: command,
        host: name,
      });
    return fn.bind(state.context);
  }

  async function render(state, value) {
    var fn = state.context.render;
    return String(typeof fn === 'function' ? await fn(String(value == null ? '' : value)) : value == null ? '' : value);
  }

  function messages(state) {
    var rows = typeof state.context.getMessages === 'function' ? state.context.getMessages() : state.context.messages;
    if (!Array.isArray(rows))
      fail('RISU_COMMAND_HOST_MISSING', 'Risu command host cannot read messages', { host: 'messages|getMessages' });
    return rows;
  }

  function setMessages(state, rows) {
    if (!Array.isArray(rows)) fail('RISU_COMMAND_INVALID_MESSAGES', 'Risu command messages must be an array');
    if (typeof state.context.setMessages === 'function') state.context.setMessages(rows);
    else if (Array.isArray(state.context.messages)) state.context.messages = rows;
    else fail('RISU_COMMAND_HOST_MISSING', 'Risu command host cannot write messages', { host: 'messages|setMessages' });
  }

  function splitCommands(text) {
    text = String(text == null ? '' : text);
    var result = [],
      lastIndex = 0,
      quoteDepth = false;
    for (var index = 0; index < text.length; index++) {
      var character = text[index];
      if (character === '"') quoteDepth = !quoteDepth;
      else if (character === '|' && quoteDepth === false) {
        result.push(text.slice(lastIndex, index));
        lastIndex = index + 1;
      }
    }
    result.push(text.slice(lastIndex));
    return result;
  }

  function parseCommand(command, pipe) {
    command = String(command == null ? '' : command);
    if (command.startsWith('/')) command = command.slice(1);
    var sliced = command.split(' ').filter(function (value) {
        return value !== '';
      }),
      commandName = sliced[0],
      argArray = [],
      namedArg = {};
    for (var index = 1; index < sliced.length; index++) {
      if (sliced[index].includes('=')) {
        var pair = sliced[index].split('=');
        namedArg[pair[0]] = pair[1];
      } else argArray.push(sliced[index]);
    }
    var arg = argArray.join(' ').replace('{{pipe}}', String(pipe)).replace('{{slot}}', String(pipe));
    return { commandName: commandName, arg: arg, namedArg: namedArg };
  }

  function applyHostMessages(state, result) {
    if (!result || typeof result !== 'object') return;
    if (Array.isArray(result.messages)) setMessages(state, result.messages);
    else if (result.chat && Array.isArray(result.chat.message)) setMessages(state, result.chat.message);
    if (result.sendAIprompt === true) state.sendAIprompt = true;
    if (result.stopSending === true) state.stopSending = true;
  }


  async function processCommand(source, pipe, state) {
    assertLive(state);
    var parsed = parseCommand(source, pipe),
      commandName = parsed.commandName,
      arg = parsed.arg,
      namedArg = parsed.namedArg;
    if (!arg) arg = pipe;
    arg = await render(state, arg == null ? '' : arg);
    for (var key of Object.keys(namedArg)) namedArg[key] = await render(state, namedArg[key]);

    switch (commandName) {
      case 'input':
        return String((await host(state, 'alertInput', commandName)(arg, { command: commandName })) ?? '');
      case 'echo':
      case 'popup':
        await host(state, 'alert', commandName)(arg, { command: commandName });
        return pipe;
      case 'pass':
        return arg;
      case 'buttons':
        if (namedArg.labels) {
          try {
            var labels = JSON.parse(namedArg.labels);
            if (Array.isArray(labels))
              return String(
                (await host(state, 'alertSelect', commandName)(labels, '', { command: commandName })) ?? ''
              );
          } catch (_) {}
        }
        return pipe;
      case 'setinput':
        await host(state, 'setInput', commandName)(arg, { command: commandName });
        return pipe;
      case 'speak':
        await host(state, 'speak', commandName)(arg);
        return pipe;
      case 'send': {
        var sendRows = messages(state);
        sendRows.push({ role: 'user', data: arg });
        setMessages(state, sendRows);
        return pipe;
      }
      case 'sendas': {
        var sendAsRows = messages(state);
        sendAsRows.push({ role: 'char', data: arg });
        setMessages(state, sendAsRows);
        return pipe;
      }
      case 'comment': {
        var commentRows = messages(state);
        if (!commentRows.length)
          fail('RISU_COMMAND_INVALID_STATE', 'Risu /comment requires an existing message', { command: commandName });
        commentRows[commentRows.length - 1].data =
          String(commentRows[commentRows.length - 1].data || '') + '<Comment>\n' + arg + '\n</Comment>';
        setMessages(state, commentRows);
        return pipe;
      }
      case 'cut': {
        var cutRows = messages(state);
        if (arg.includes('-')) {
          var range = arg.split('-');
          setMessages(state, cutRows.slice(parseInt(range[0]), parseInt(range[1])));
        } else if (!isNaN(parseInt(arg))) {
          // v2026.10.211 assigns splice's removed row back to the chat.
          setMessages(state, cutRows.splice(parseInt(arg), 1));
        } else {
          setMessages(
            state,
            cutRows.filter(function (message) {
              return message.chatId !== arg;
            })
          );
        }
        return pipe;
      }
      case 'del': {
        var size = parseInt(arg);
        if (!isNaN(size)) {
          var deleteRows = messages(state);
          // v2026.10.211 keeps the last `size` rows despite the command's label.
          setMessages(state, deleteRows.slice(deleteRows.length - size));
        }
        return pipe;
      }
      case 'len':
        try {
          var value = JSON.parse(arg);
          if (Array.isArray(value)) return value.length.toString();
        } catch (_) {}
        return pipe;
      case 'multisend': {
        var values = String(arg).split('|||'),
          clearMode = false;
        if (values[0] && values[0].trim() === 'clear') {
          clearMode = true;
          values.shift();
        }
        var sendAIprompt = host(state, 'sendAIprompt', commandName);
        for (var multiIndex = 0; multiIndex < values.length; multiIndex++) {
          assertLive(state);
          if (clearMode) setMessages(state, []);
          var multiRows = messages(state);
          multiRows.push({ role: 'user', data: values[multiIndex] });
          setMessages(state, multiRows);
          var sendResult = await sendAIprompt(values[multiIndex], {
            command: commandName,
            index: multiIndex,
            clear: clearMode,
            messages: messages(state),
          });
          applyHostMessages(state, sendResult);
          if ((multiIndex + 1) % state.yieldEvery === 0) await yieldControl(state);
        }
        return '';
      }
      case 'setvar':
        await host(state, 'setVar', commandName)(namedArg.key, arg);
        return '';
      case 'addvar': {
        var getVar = host(state, 'getVar', commandName),
          setVar = host(state, 'setVar', commandName),
          current = await getVar(namedArg.key);
        await setVar(namedArg.key, (Number(current) + Number(arg)).toString());
        return '';
      }
      case 'getvar':
        return String((await host(state, 'getVar', commandName)(namedArg.key)) ?? 'null');
      case 'test_lorebook':
        var testLorebook = host(state, 'testLorebook', commandName),
          loreResult = await testLorebook({ command: commandName, signal: state.signal });
        if (!loreResult || !Array.isArray(loreResult.actives))
          fail('RISU_COMMAND_LOREBOOK_RESULT', 'Risu /test_lorebook host returned an invalid result', {
            command: commandName,
          });
        if (typeof state.context.alert === 'function')
          await state.context.alert(
            loreResult.actives
              .map(function (entry) {
                return String((entry && entry.prompt) || '');
              })
              .join('§'),
            { command: commandName }
          );
        return JSON.stringify(loreResult);
      case 'trigger': {
        var triggerResult = await host(
          state,
          'runTrigger',
          commandName
        )(arg, {
          command: commandName,
          signal: state.signal,
        });
        applyHostMessages(state, triggerResult);
        // The fixed upstream command returns no pipe value for /trigger.
        return undefined;
      }
      case '?':
        await host(state, 'alert', commandName)(HELP, { command: commandName, markdown: true });
        return 'help';
      default:
        return false;
    }
  }

  async function run(text, context) {
    context = context || {};
    var state = {
        context: context,
        signal: context.signal,
        yieldEvery: Math.max(1, Number(context.yieldEvery) || 16),
        sendAIprompt: false,
        stopSending: false,
      },
      commands = splitCommands(text),
      pipe = '',
      ok = true;
    for (var index = 0; index < commands.length; index++) {
      assertLive(state);
      var result = await processCommand(commands[index].trim(), pipe, state);
      if (result === false) {
        pipe = false;
        ok = false;
        break;
      }
      pipe = result;
      if ((index + 1) % state.yieldEvery === 0) await yieldControl(state);
    }
    return {
      ok: ok,
      pipe: pipe,
      messages: messages(state),
      sendAIprompt: state.sendAIprompt,
      stopSending: state.stopSending,
    };
  }

  var HELP = [
    '/input, /echo, /popup, /pass, /buttons labels=[JSON], /setinput',
    '/send, /sendas, /comment, /cut, /del, /len',
    '/multisend, /setvar key=NAME, /addvar key=NAME, /getvar key=NAME, /trigger, /?',
    '/speak uses the host voice; /test_lorebook reports the active Risu lorebook result.',
  ].join('\n');

  return Object.freeze({
    run: run,
    CommandError: CommandError,
    capabilities: Object.freeze({
      source: 'RisuAI v2026.10.211 src/ts/process/command.ts',
      commands: Object.freeze([
        'input',
        'echo',
        'popup',
        'pass',
        'buttons',
        'setinput',
        'speak',
        'send',
        'sendas',
        'comment',
        'cut',
        'del',
        'len',
        'multisend',
        'setvar',
        'addvar',
        'getvar',
        'test_lorebook',
        'trigger',
        '?',
      ]),
      unsupported: Object.freeze([]),
      deferred: Object.freeze([]),
      context: Object.freeze({
        messages: 'messages or getMessages()+setMessages()',
        variables: 'getVar(name), setVar(name,value)',
        ui: 'alert(value), alertInput(value), alertSelect(values,title), setInput(value)',
        actions: 'runTrigger(name,meta), sendAIprompt(value,meta); returned state flags are merged',
        optional: 'render(value), diagnostic(error), assertLive(), signal, yieldControl()',
      }),
      result: 'Promise<{ok,pipe,messages,sendAIprompt,stopSending}>',
      defaults: Object.freeze({ yieldEvery: 16 }),
    }),
  });
});
