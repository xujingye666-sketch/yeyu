// Risu execution owns its transactions; ST script hosts are not involved.
var _risuExecutions = new Set(),
  _risuDisplayCache = new WeakMap(),
  _risuDisplayRandomChoices = new WeakMap(),
  _risuCBSDisplayCache = new WeakMap(),
  _risuDisplaySources = new WeakMap(),
  _risuDisplayClockReads = new WeakSet(),
  _risuDisplayClockEpoch = 0,
  _risuCBSDisplayBatches = new WeakMap(),
  _risuLooseDisplayMessages = new WeakMap(),
  _risuDisplayRenderEnvironment = null,
  _risuDisplayBatches = new WeakMap(),
  _risuDisplayWork = new WeakMap(),
  _risuDisplayWrites = new WeakMap(),
  _risuDisplayPreviews = new WeakMap(),
  _risuStreamDisplay = null,
  _risuStreamPreviews = new WeakMap(),
  _risuExecutionQueues = new Map(),
  _risuLuaSessions = new Map(),
  _risuSessionEpochs = new WeakMap(),
  _risuCancelEpoch = 0;

function risuMessageText(message) {
  var raw = String((message && message.content) || ''),
    saved = message && message.risu;
  return saved && saved.source === raw && typeof saved.text === 'string' ? saved.text : raw;
}
function risuMessageTemplate(message) {
  var saved = message && message.risu;
  return saved && saved.source === String(message.content || '') && typeof saved.template === 'string'
    ? saved.template
    : risuMessageText(message);
}
function risuWriteMessageText(message, text, template, mutation) {
  text = String(text == null ? '' : text);
  var raw = String(message.content || '');
  template = template == null ? text : String(template);
  if (text === raw && template === raw) {
    if (message.risu) {
      if (mutation) mutation.capture(message.risu, ['source', 'text', 'template'], true);
      delete message.risu.source;
      delete message.risu.text;
      delete message.risu.template;
    }
  } else {
    message.risu = message.risu || {};
    if (mutation) mutation.capture(message.risu, ['source', 'text', 'template'], true);
    Object.assign(message.risu, { source: raw, text: text, template: template });
  }
}
function risuAbortError() {
  var error = new Error('已取消');
  error.name = 'AbortError';
  return error;
}
function cancelRisuExecutions(session) {
  if (session) _risuSessionEpochs.set(session, (_risuSessionEpochs.get(session) || 0) + 1);
  else _risuCancelEpoch++;
  _risuExecutions.forEach(function (controller) {
    if (!session || controller.risuSession === session) controller.abort();
  });
}
function releaseRisuExecutionSession(session) {
  cancelRisuExecutions(session);
  _risuTriggerIds.delete(session);
  var owner = _risuLuaSessions.get(session);
  _risuLuaSessions.delete(session);
  if (owner) {
    owner.context = null;
    owner.runtime.dispose();
  }
}
function syncRisuExecutionSessions() {
  var char = getChar(),
    current = char && getActiveSession(char.id),
    generating = generationTarget ? generationSessionForTarget(generationTarget) : null,
    sessions = new Set(Array.from(_risuLuaSessions.keys()).concat(Array.from(_risuExecutionQueues.keys())));
  sessions.forEach(function (session) {
    var live = D.characters.some(function (entry) {
      var box = D.chats[entry.id];
      return box && box.sessions.includes(session);
    });
    if (!live || (session !== current && session !== generating)) releaseRisuExecutionSession(session);
  });
}
function risuScriptError(error) {
  if (error && error.name === 'AbortError') return;
  if (error && error.code === 'RISU_COMMAND_UNSUPPORTED_VOICE') return;
  if (error && error.code === 'RISU_TRIGGER_EFFECT_SKIPPED_MODE') return;
  if (error && ['WRITE_DISABLED', 'CBS_WRITE_DISABLED'].includes(error.code)) return;
  toast('Risu 脚本：' + String(error.message || error), 'err');
}
function risuOfficialMessages(session) {
  return (session.msgs || []).filter(function (message) {
    return !message.opening;
  });
}
function risuChatIndex(session, message) {
  var messages = risuOfficialMessages(session),
    index = messages.indexOf(message);
  if (index < 0 && message && Number(message.seq) > 0)
    index = messages.findIndex(function (row) {
      return row.seq === message.seq;
    });
  return index;
}
function risuSnapshotCBS(char, session, state, options) {
  var context = createRisuCBSContext(char, session, Object.assign({}, options, { state: state })),
    snapshot = {};
  Object.keys(context).forEach(function (key) {
    if (typeof context[key] !== 'function') snapshot[key] = context[key];
  });
  // Functions cannot cross the Worker boundary. Each snapshot starts an independent deterministic
  // stream from the owning round, shared by CBS, regex replacement and lorebook probability.
  snapshot.randomSeed = Math.floor((typeof state.random === 'function' ? state.random() : Math.random()) * 4294967296) >>> 0;
  snapshot.chatVariables = Object.assign({}, risuDefaultVariables(char));
  Object.keys(state.vars).forEach(function (key) {
    snapshot.chatVariables[key.slice(1)] = state.vars[key];
  });
  snapshot.globalVariables = Object.assign({}, state.globalVars);
  return snapshot;
}
function risuRefreshMacroMessages(context) {
  context.state.messages = context.messages.map(function (message) {
    return { role: message.role === 'char' ? 'assistant' : message.role, content: message.data };
  });
}
async function risuComputeInWorker(kind, input, char, session, options) {
  options = options || {};
  var state =
      options.state && options.state.ecosystem === 'risu'
        ? options.state
        : createRisuMacroState(char, session, { commit: false }),
    controller = new AbortController(),
    signal = options.signal,
    stop = function () {
      controller.abort();
    };
  controller.risuSession = session;
  _risuExecutions.add(controller);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', stop, { once: true });
  }
  try {
    var snapshot =
      kind === 'protect-translation' ? {} : risuSnapshotCBS(char, options.contextSession || session, state, options);
    snapshot.commandPlaceholders = !!(options.effect && /^(?:command|v2Command)$/.test(options.effect.type));
    if (Array.isArray(options.branchTrace)) snapshot.branchTrace = [];
    var result = await (kind === 'lore'
      ? YeyuRisuRegexRuntime.resolveLorebook(input, snapshot, { signal: controller.signal })
      : kind === 'protect-translation'
        ? YeyuRisuRegexRuntime.protectTranslation(input, snapshot, { signal: controller.signal })
        : kind === 'visible-spans'
          ? YeyuRisuRegexRuntime.visibleSpans(input, snapshot, { signal: controller.signal })
          : kind === 'cbs-batch'
            ? YeyuRisuRegexRuntime.evaluateCBSBatch(input, snapshot, { signal: controller.signal })
            : YeyuRisuRegexRuntime.evaluateCBS(String(input || ''), snapshot, { signal: controller.signal }));
    if (controller.signal.aborted) throw risuAbortError();
    for (var effect of result.effects) {
      if (effect.type !== 'setChatVariable') continue;
      state.vars['$' + effect.name] = effect.value;
      state.changedVars.add('$' + effect.name);
    }
    result.diagnostics.forEach(function (diagnostic) {
      state.diagnostics.push(diagnostic);
    });
    if (Array.isArray(options.branchTrace))
      (result.branchTrace || []).forEach(function (branch) {
        options.branchTrace.push(branch);
      });
    if (!options.state) result.diagnostics.forEach(risuScriptError);
    return result;
  } finally {
    _risuExecutions.delete(controller);
    if (signal) signal.removeEventListener('abort', stop);
  }
}
async function risuRenderCBSInWorker(text, char, session, options) {
  return (await risuComputeInWorker('cbs', text, char, session, options)).text;
}
async function risuRenderCBSBatchInWorker(texts, char, session, options) {
  return (await risuComputeInWorker('cbs-batch', texts, char, session, options)).text;
}
// Display work shares the session queue with every other transaction. A write goes ahead of display
// work that is still waiting there: a send must not wait behind a display pass that its own renders will
// ask for again. Display work already running finishes first, as its place in the queue says, and the
// messages of a pass the write overtook are evaluated again as soon as the write ends.
function risuQueueDisplayWork(session, work) {
  var queued = _risuDisplayWork.get(session);
  if (!queued) _risuDisplayWork.set(session, (queued = new Set()));
  queued.add(work);
}
function risuStartDisplayWork(session, work) {
  var queued = _risuDisplayWork.get(session);
  if (queued) queued.delete(work);
}
function risuYieldDisplayWork(session) {
  var queued = _risuDisplayWork.get(session),
    yielded = [];
  _risuDisplayBatches.delete(session);
  _risuDisplayWork.delete(session);
  if (queued)
    queued.forEach(function (work) {
      work.yielded = true;
      work.controller.abort();
      if (work.entries) yielded.push(work);
    });
  return yielded;
}
// The write may have rewritten or removed a message of the overtaken pass. Such a message is not
// evaluated with the input it had before: its entry is dropped from the queue, and the render that follows
// the write asks for it again with what it now holds.
function risuRequeueDisplayWork(session, yielded) {
  yielded.forEach(function (batch) {
    var state = risuDisplayScriptState(batch.char, session);
    batch.entries.forEach(function (entry) {
      if (!risuDisplayEntryCurrent(entry)) return;
      var message = entry.message;
      if (
        session.msgs.indexOf(message) < 0 ||
        JSON.stringify([entry.raw, message.content, risuMessageTemplate(message)]) !== entry.source
      ) {
        entry.state = null;
        return;
      }
      entry.state = state;
      entry.options.chatIndex = risuChatIndex(session, message);
      risuQueueDisplayEntry(batch.char, session, entry);
    });
  });
}
// A stop or a session release ended the write instead: nothing restarts on its behalf, so the overtaken
// entries are dropped and the next render asks for them again.
function risuDropDisplayWork(yielded) {
  yielded.forEach(function (batch) {
    batch.entries.forEach(function (entry) {
      if (risuDisplayEntryCurrent(entry)) entry.state = null;
    });
  });
}
async function risuWithExecution(char, session, options, action) {
  options = options || {};
  if (options.preview && options.promptPreview) return risuExecuteTransaction(char, session, options, action);
  var work = options.displayWork,
    yielded = options.readOnly ? [] : risuYieldDisplayWork(session),
    epoch = _risuSessionEpochs.get(session) || 0,
    cancelEpoch = _risuCancelEpoch,
    previous = _risuExecutionQueues.get(session) || Promise.resolve(),
    task = previous
      .catch(function () {})
      .then(function () {
        if (work) risuStartDisplayWork(session, work);
        if (epoch !== (_risuSessionEpochs.get(session) || 0) || cancelEpoch !== _risuCancelEpoch)
          throw risuAbortError();
        return risuExecuteTransaction(char, session, options, action);
      }),
    tail = task.catch(function () {});
  if (work) risuQueueDisplayWork(session, work);
  _risuExecutionQueues.set(session, tail);
  try {
    return await task;
  } finally {
    if (_risuExecutionQueues.get(session) === tail) _risuExecutionQueues.delete(session);
    syncRisuExecutionSessions();
    if (yielded.length) {
      if (epoch === (_risuSessionEpochs.get(session) || 0) && cancelEpoch === _risuCancelEpoch)
        risuRequeueDisplayWork(session, yielded);
      else risuDropDisplayWork(yielded);
    }
  }
}
async function risuExecuteTransaction(char, session, options, action) {
  options = options || {};
  var controller = new AbortController(),
    sourceSignal = options.signal,
    stop = function () {
      controller.abort();
    },
    previewState = options.previewState,
    sourceSession = previewState ? previewState.session : session,
    sourceCharacter = previewState ? previewState.character : char,
    sourceMessages = risuOfficialMessages(sourceSession),
    state = createRisuMacroState(sourceCharacter, sourceSession, { random: options.random }),
    messages = sourceMessages.map(function (message) {
      return {
        role: message.role === 'assistant' ? 'char' : message.role,
        data: options.readOnly ? risuMessageText(message) : risuMessageTemplate(message),
        _pendingEffectsFrom: message.pendingMacroEffects ? Number(message.pendingMacroEffects.from) || 0 : null,
        time: message.time,
        _seq: message.seq,
      };
    }),
    // Only a writing transaction replaces messages, so only it compares the whole conversation. A
    // display that may write its own variables compares just the variables it would overwrite.
    sourceRevision = options.readOnly ? null : JSON.stringify(session),
    variableRevision =
      options.readOnly && options.displayVars && !options.preview ? JSON.stringify(session.risu || null) : null,
    dirtyCharacter = new Set(),
    dirtyPersona = false,
    dirtyAuthorNote = false,
    authorNote = String((sourceSession.risu && sourceSession.risu.authorNote) || ''),
    refreshRequested = false,
    pendingInput = null,
    characterCopy = options.preview ? structuredClone(sourceCharacter) : Object.assign({}, sourceCharacter),
    persona = getActivePersona(char.id) || {},
    // 本事务里出的图：随提交写入 session.risu.inlays，撤销或预览时一并丢弃。
    stagedInlays = {},
    stagedViewScreenImage = null,
    personaCopy = options.preview
      ? structuredClone((previewState && previewState.persona) || persona)
      : Object.assign({}, persona),
    ownership = options.target || bindGenerationTargetOwnership({ charId: char.id, sessionId: session.id }, session);
  state.personaOverride = personaCopy;
  if (sourceSignal) {
    if (sourceSignal.aborted) controller.abort();
    sourceSignal.addEventListener('abort', stop, { once: true });
  }
  controller.risuSession = session;
  _risuExecutions.add(controller);
  function assertLive() {
    if (controller.signal.aborted) throw risuAbortError();
    var box = D.chats && D.chats[char.id];
    if (D.characters.indexOf(char) < 0 || !box || box.sessions.indexOf(session) < 0) throw risuAbortError();
    assertGenerationTargetOwnership(ownership, session);
    if (!options.target && (D.currentCharId !== char.id || getActiveSession(char.id) !== session))
      throw risuAbortError();
  }
  function getVar(key) {
    key = String(key);
    var value = state.vars['$' + key],
      defaults = risuDefaultVariables(char);
    // Trigger resolves temporary variables before applying its final "null" sentinel.
    return value == null
      ? Object.prototype.hasOwnProperty.call(defaults, key)
        ? defaults[key]
        : undefined
      : String(value);
  }
  function setVar(key, value) {
    assertLive();
    if (options.readOnly && !options.displayVars) throw new Error('此脚本不能写入聊天变量');
    state.vars['$' + key] = String(value);
    state.changedVars.add('$' + key);
  }
  var context = {
    preview: options.preview === true,
    previewOptions: options,
    random: state.random,
    previewSkipped: function (label) {
      var marker = '[预览未执行：Risu ' + label + ']';
      if (options.previewNotes && !options.previewNotes.includes(marker)) options.previewNotes.push(marker);
      return marker;
    },
    signal: controller.signal,
    controller: controller,
    assertLive: assertLive,
    state: state,
    char: char,
    characterSnapshot: characterCopy,
    session: session,
    sessionSnapshot: sourceSession,
    lowLevelAccess: risuCardSources(char).card.lowLevelAccess === true,
    messages: messages,
    getMessages: function () {
      return context.messages;
    },
    setMessages: function (rows) {
      assertLive();
      context.messages = rows;
    },
    getVar: getVar,
    getGlobalVar: function (key) {
      return Object.prototype.hasOwnProperty.call(state.globalVars, key) ? String(state.globalVars[key]) : 'null';
    },
    setVar: setVar,
    regexTest: function (input, pattern, flags) {
      return YeyuRisuRegexRuntime.test(input, pattern, flags, { signal: controller.signal });
    },
    regexMatch: function (input, pattern, flags) {
      return YeyuRisuRegexRuntime.match(input, pattern, flags, { signal: controller.signal });
    },
    regexSplit: function (input, pattern, flags) {
      return YeyuRisuRegexRuntime.primitive({
        operation: 'split',
        input: input,
        pattern: pattern,
        flags: flags,
        signal: controller.signal,
      });
    },
    regexReplace: function (input, pattern, flags, specification) {
      return YeyuRisuRegexRuntime.replace(input, pattern, flags, specification, { signal: controller.signal });
    },
    render: function (value, extra) {
      assertLive();
      risuRefreshMacroMessages(context);
      return risuRenderCBSInWorker(
        value,
        characterCopy,
        risuExecutionSessionView(context),
        Object.assign({ state: state, signal: controller.signal }, extra || {})
      );
    },
    firstMessage: char.first_mes || '',
    alternateGreetings: char.alternate_greetings || [],
    greetingIndex: openingAlternateGreetingIndex(
      char,
      (session.msgs || []).find(function (message) {
        return message.opening;
      })
    ),
    getCharacterDescription: function () {
      return characterCopy.description || '';
    },
    setCharacterDescription: function (value) {
      characterCopy.description = String(value);
      dirtyCharacter.add('description');
    },
    getPersonaDescription: function () {
      return personaCopy.desc || '';
    },
    setPersonaDescription: function (value) {
      personaCopy.desc = String(value);
      dirtyPersona = true;
    },
    getReplaceGlobalNote: function () {
      return characterCopy.post_history_instructions || '';
    },
    setReplaceGlobalNote: function (value) {
      characterCopy.post_history_instructions = String(value);
      dirtyCharacter.add('post_history_instructions');
    },
    getAuthorNote: function () {
      return authorNote;
    },
    setAuthorNote: function (value) {
      authorNote = String(value);
      dirtyAuthorNote = true;
    },
    patchCharacter: function (values) {
      Object.keys(values).forEach(function (key) {
        characterCopy[key] = values[key];
        dirtyCharacter.add(key);
      });
    },
    requestRefresh: function (reloadDisplay) {
      refreshRequested = true;
      if (reloadDisplay && !options.preview) _risuDisplayCache = new WeakMap();
    },
    diagnostic: function (error) {
      state.diagnostics.push(error);
    },
    alert: async function (value) {
      assertLive();
      if (options.preview) return context.previewSkipped('脚本弹窗');
      window.alert(String(value));
      assertLive();
    },
    alertInput: async function (value) {
      assertLive();
      if (options.preview) return context.previewSkipped('脚本输入弹窗');
      var answer = window.prompt(String(value));
      assertLive();
      return answer == null ? '' : answer;
    },
    alertSelect: async function (values, title) {
      assertLive();
      if (options.preview) return context.previewSkipped('脚本选择弹窗');
      var answer = window.prompt(
        String(title || '') +
          '\n' +
          values
            .map(function (value, index) {
              return index + ': ' + value;
            })
            .join('\n')
      );
      assertLive();
      if (answer == null || answer === '') return '';
      if (/^\d+$/.test(answer) && Number(answer) < values.length) return String(values[Number(answer)]);
      if (values.includes(answer)) return String(answer);
      throw new Error('请选择列表中的选项');
    },
    updateGUI: function () {
      assertLive();
      context.requestRefresh(true);
    },
    updateChatAt: function () {
      assertLive();
      refreshRequested = true;
    },
    setInput: function (value) {
      assertLive();
      pendingInput = String(value);
    },
    runLLM: async function (prompt, settings, signal) {
      assertLive();
      if (options.preview) return context.previewSkipped('脚本模型调用');
      settings = settings || {};
      if (settings.model && settings.model !== 'model')
        throw new Error('此卡片需要 Risu submodel；夜欲尚未配置该卡外模型');
      var rows = Array.isArray(prompt) ? prompt : await risuParseChatML(prompt, context.render);
      var requestController = new AbortController();
      function stopRequest() {
        requestController.abort();
      }
      var signals = [controller.signal, signal].filter(Boolean);
      signals.forEach(function (source) {
        if (source.aborted) stopRequest();
        else source.addEventListener('abort', stopRequest, { once: true });
      });
      try {
        var result = await callDeepSeek(rows, null, {
          transient: true,
          controller: requestController,
          nonStream: !settings.streaming,
        });
        assertLive();
        if (requestController.signal.aborted) throw risuAbortError();
        return result.content;
      } finally {
        signals.forEach(function (source) {
          source.removeEventListener('abort', stopRequest);
        });
      }
    },
  };
  context.runAxLLM = context.runLLM;
  context.speak = async function (text) {
    assertLive();
    if (options.preview) return context.previewSkipped('语音朗读');
    if (options.readOnly) return '';
    return speechCommand(text, char);
  };
  context.stagedInlays = stagedInlays;
  context.setViewScreenImage = function (entry) {
    assertLive();
    stagedViewScreenImage = entry;
  };
  // trigger runImgGen/v2ImgGen 与 Lua generateImage：成功返回 {{inlay::id}}；失败提示后返回空串，由调用方按上游写入
  // 失败值；取消照常抛出（meta.signal 为 Lua 调用的取消信号）。预览不发请求；只读的显示事务每次重绘都会执行，不出图。
  context.runImage = async function (prompt, _negative, meta) {
    assertLive();
    if (options.preview) return context.previewSkipped('脚本出图');
    if (options.readOnly) return '';
    var requestController = new AbortController(),
      stopRequest = function () {
        requestController.abort();
      },
      signals = [controller.signal, meta && meta.signal].filter(Boolean),
      entry;
    signals.forEach(function (source) {
      if (source.aborted) stopRequest();
      else source.addEventListener('abort', stopRequest, { once: true });
    });
    try {
      entry = await generateRisuInlayImage(char, session, prompt, requestController.signal);
    } catch (error) {
      if (requestController.signal.aborted || (error && error.name === 'AbortError')) throw risuAbortError();
      risuReportImageError(error);
      return '';
    } finally {
      signals.forEach(function (source) {
        source.removeEventListener('abort', stopRequest);
      });
    }
    assertLive();
    stagedInlays[entry.id] = entry;
    return '{{inlay::' + entry.id + '}}';
  };
  context.lore = risuLorebookCreateTransaction(characterCopy, sourceSession);
  context.getLorebooks = function () {
    return context.lore.getGlobalLorebooks();
  };
  context.setLorebooks = function (rows) {
    if (options.readOnly) throw new Error('此脚本不能写入世界书');
    context.lore.setGlobalLorebooks(rows);
    var extensions = Object.assign({}, characterCopy.extensions || {});
    extensions.yeyu = Object.assign({}, extensions.yeyu || {}, {
      risuLorebookState: context.lore.getGlobalLorebooks(),
    });
    context.patchCharacter({ extensions: extensions });
  };
  context.testLorebook = function () {
    return context.lore.test({ messages: context.messages, macroState: state, signal: controller.signal });
  };
  context.command = function (text, extra) {
    return YeyuRisuCommand.run(
      text,
      Object.assign({}, context, extra || {}, {
        sendAIprompt: async function (_value, meta) {
          context.messages = meta.messages;
          if (options.preview) {
            context.previewSkipped('脚本嵌套生成');
            return { messages: context.messages, sendAIprompt: false };
          }
          return risuSendWithinExecution(context);
        },
      })
    );
  };
  function writeVariables(risu, key, changed, values, mutation) {
    if (!changed.size) return;
    risu[key] = risu[key] || {};
    mutation.capture(risu[key], Array.from(changed), true);
    changed.forEach(function (name) {
      risu[key][name] = values[name];
    });
  }
  context.runLua = function (code, mode, extra) {
    return risuExecuteLua(context, code, mode, extra);
  };
  try {
    assertLive();
    var assetContext = await risuDisplayAssetContext(options.preview ? characterCopy : char);
    state.assetContext = options.deferAssetUrls ? risuDeferredCBSAssetContext(assetContext) : assetContext;
    assertLive();
    if (!options.readOnly) await risuHistoryRenderRows(context, false);
    if (options.assertDisplayCurrent) options.assertDisplayCurrent();
    var result = await action(context);
    assertLive();
    if (options.assertDisplayCurrent) options.assertDisplayCurrent();
    // The next stage of a prompt preview starts from the conversation this one would have committed, templates
    // included, so it renders the history exactly as the send's next transaction does.
    if (options.preview && options.promptPreview) {
      await risuHistoryProject(context);
      assertLive();
      var previewSession = risuExecutionSessionView(context);
      previewSession.msgs = previewSession.msgs
        .filter(function (message) {
          return message.opening;
        })
        .concat(risuTransactionMessages(context, structuredClone(sourceMessages), previewSession, null));
      options.previewState = {
        session: previewSession,
        character: characterCopy,
        persona: personaCopy,
      };
      return result;
    }
    if (!options.readOnly) {
      await risuHistoryProject(context);
      assertLive();
      if (JSON.stringify(session) !== sourceRevision) throw new Error('Risu 执行期间对话已改变，请重试');
      var changedIndex = sourceMessages.findIndex(function (message, index) {
        var row = context.messages[index];
        return (
          !row ||
          row._seq !== message.seq ||
          (row.role === 'char' ? 'assistant' : row.role) !== message.role ||
          (row._history ? row._history.source : row.data) !== risuMessageTemplate(message)
        );
      });
      var mutation = changedIndex < 0 ? createMutationJournal() : beginMessageMutation(char, session, null, ['risu']);
      if (changedIndex >= 0) {
        var changedSeq = sourceMessages.slice(changedIndex).reduce(function (earliest, message) {
          return Number(message.seq) > 0 ? Math.min(earliest, Number(message.seq)) : earliest;
        }, Infinity);
        if (Number.isFinite(changedSeq)) rollbackMemoryDependencies(char.id, session, changedSeq);
        invalidateCacheContexts(char.id, session.msgs.indexOf(sourceMessages[changedIndex]), true, session.id);
      }
      mutation.capture(session, ['risu'], true);
      function captureSessionRisu() {
        session.risu = session.risu || {};
        mutation.capture(
          session.risu,
          ['scriptstate', 'globalVariables', 'authorNote', 'localLore', 'inlays', 'viewScreenImage'],
          true
        );
        return session.risu;
      }
      if (session.risu) captureSessionRisu();
      mutation.capture(char, Array.from(dirtyCharacter), true);
      if (dirtyPersona) mutation.capture(persona, ['desc'], true);
      var opening = (session.msgs || []).filter(function (message) {
        return message.opening;
      });
      var nextMessages = opening.concat(risuTransactionMessages(context, sourceMessages, session, mutation));
      for (var messageIndex = 0; messageIndex < nextMessages.length; messageIndex++) {
        if (session.msgs[messageIndex] === nextMessages[messageIndex]) continue;
        var oldIndex = session.msgs.indexOf(nextMessages[messageIndex], messageIndex);
        if (oldIndex >= 0) mutation.splice(session.msgs, oldIndex, 1);
        mutation.splice(session.msgs, messageIndex, 0, [nextMessages[messageIndex]]);
      }
      if (session.msgs.length > nextMessages.length)
        mutation.splice(session.msgs, nextMessages.length, session.msgs.length - nextMessages.length);
      if (state.changedVars.size || state.changedGlobals.size) {
        var writableRisu = captureSessionRisu();
        writeVariables(writableRisu, 'scriptstate', state.changedVars, state.vars, mutation);
        writeVariables(writableRisu, 'globalVariables', state.changedGlobals, state.globalVars, mutation);
      }
      if (dirtyAuthorNote) {
        captureSessionRisu().authorNote = authorNote;
      }
      var loreSnapshot = context.lore.snapshot();
      if (loreSnapshot.localChanged) {
        var loreRisu = captureSessionRisu();
        if (!Array.isArray(loreRisu.localLore)) loreRisu.localLore = [];
        mutation.splice(loreRisu.localLore, 0, loreRisu.localLore.length, loreSnapshot.localLore);
      }
      if (Object.keys(stagedInlays).length) {
        var inlayRisu = captureSessionRisu();
        inlayRisu.inlays = Object.assign({}, inlayRisu.inlays, stagedInlays);
      }
      if (stagedViewScreenImage) captureSessionRisu().viewScreenImage = stagedViewScreenImage;
      dirtyCharacter.forEach(function (key) {
        char[key] = characterCopy[key];
      });
      if (dirtyPersona) persona.desc = personaCopy.desc;
      mutation.seal();
      if (typeof options.onCommit === 'function') options.onCommit(mutation.rollback);
      try {
        if (options.save !== false)
          await saveData(dirtyCharacter.size || dirtyPersona ? ['sessions', 'characters', 'personas'] : 'sessions', {
            urgent: true,
          });
      } catch (error) {
        mutation.rollback();
        throw error;
      }
    }
    // A preview is evaluated exactly like a display and then forgotten: its variable writes, messages,
    // notices and emotion never leave the transaction.
    if (options.preview) return result;
    if (options.readOnly && options.displayVars && state.changedVars.size) {
      if (JSON.stringify(session.risu || null) !== variableRevision) throw new Error('Risu 显示期间对话已改变，请重试');
      var displayMutation = createMutationJournal();
      displayMutation.capture(session, ['risu'], true);
      session.risu = session.risu || {};
      displayMutation.capture(session.risu, ['scriptstate'], true);
      writeVariables(session.risu, 'scriptstate', state.changedVars, state.vars, displayMutation);
      displayMutation.seal();
      if (options.onDisplayResultReady) options.onDisplayResultReady();
      try {
        await saveData('sessions');
      } catch (error) {
        displayMutation.rollback();
        throw error;
      }
    } else if (options.onDisplayResultReady) options.onDisplayResultReady();
    state.diagnostics.forEach(risuScriptError);
    if (pendingInput !== null && getChar() === char && getActiveSession(char.id) === session) {
      $('user-input').value = pendingInput;
      $('user-input').dispatchEvent(new Event('input'));
    }
    if (refreshRequested && getChar() === char && getActiveSession(char.id) === session) renderChat();
    if (context.emotionEffects)
      context.appliedEmotion = await risuApplyEmotionEffects(char, session, context.emotionEffects);
    return result;
  } finally {
    controller.abort();
    _risuExecutions.delete(controller);
    if (options.preview && !options.promptPreview) risuReleasePromptPreview(options);
    if (sourceSignal) sourceSignal.removeEventListener('abort', stop);
  }
}

// The conversation a transaction leaves behind: each row goes back onto its original message with the rendered
// text and the retained template, and a row a script added becomes a new message of `session`. A commit writes onto
// the live messages under its journal; a prompt preview passes copies and no journal.
function risuTransactionMessages(context, sourceMessages, session, mutation) {
  var claimedSeqs = new Set();
  return context.messages.map(function (row) {
    // A script may copy a getFullChat row; only its first occurrence keeps the original message.
    if (claimedSeqs.has(row._seq)) row = { role: row.role, data: row.data };
    var original = sourceMessages.find(function (message) {
      return message.seq === row._seq;
    });
    if (original) claimedSeqs.add(row._seq);
    var message = original || {
      role: row.role === 'char' ? 'assistant' : row.role,
      content: String(row._raw == null ? row.data || '' : row._raw),
      time: Date.now(),
      seq: allocateMessageSeq(session),
    };
    if (original && mutation) mutation.capture(message, ['role', 'risu', 'pendingMacroEffects'], true);
    message.role = row.role === 'char' ? 'assistant' : row.role;
    risuWriteMessageText(message, row.data, row._history && row._history.source, original && mutation);
    if (row._historyConsumed) delete message.pendingMacroEffects;
    else if (!original) markMessageMacroEffects(context.char, message);
    return message;
  });
}
async function risuHistoryProject(context) {
  var changed = context.messages.filter(function (row) {
    return row._history && row.data !== row._history.text;
  });
  if (!changed.length) return;
  var result = await YeyuRisuRegexRuntime.retainHistory(
    changed.map(function (row) {
      return {
        before: row._history.text,
        after: row.data,
        trace: row._history.trace,
        source: row._history.source,
        from: row._pendingEffectsFrom,
      };
    }),
    { signal: context.signal }
  );
  context.assertLive();
  changed.forEach(function (row, index) {
    row._history.source = result.templates[index].template;
    row._pendingEffectsFrom = result.templates[index].from;
  });
}
async function risuHistoryRenderRows(context, consume) {
  await risuHistoryProject(context);
  var rows = context.messages;
  rows.forEach(function (row) {
    if (!row._history) {
      row._history = { source: String(row.data || ''), text: String(row.data || ''), trace: [] };
      if (!row._seq && row._pendingEffectsFrom == null) row._pendingEffectsFrom = 0;
    }
  });
  var selected = rows.filter(function (row) {
    return YeyuRisuCBS.hasMacros(row._history.source);
  });
  if (selected.length) {
    risuRefreshMacroMessages(context);
    var snapshot = risuSnapshotCBS(context.characterSnapshot, risuExecutionSessionView(context), context.state, {
      trackHistory: true,
    });
    snapshot.historyRowOptions = selected.map(function (row) {
      var pending = row._pendingEffectsFrom != null;
      return {
        runVar: consume && pending,
        rmVar: !pending,
        historyEffectStart: pending ? row._pendingEffectsFrom : undefined,
        chatIndex: rows.indexOf(row),
      };
    });
    var result = await YeyuRisuRegexRuntime.evaluateCBSBatch(
      selected.map(function (row) {
        return row._history.source;
      }),
      snapshot,
      { signal: context.signal }
    );
    context.assertLive();
    result.effects.forEach(function (effect) {
      if (effect.type === 'setChatVariable') context.setVar(effect.name, effect.value);
    });
    result.diagnostics.forEach(function (diagnostic) {
      context.state.diagnostics.push(diagnostic);
    });
    selected.forEach(function (row, index) {
      row.data = result.text[index];
      row._history.text = row.data;
      row._history.trace = result.traces[index];
    });
  }
  if (consume)
    rows.forEach(function (row) {
      if (row._pendingEffectsFrom != null) {
        row._pendingEffectsFrom = null;
        row._historyConsumed = true;
      }
    });
}
async function risuRunTriggerContext(context, mode, extra) {
  context.assertLive();
  var sources = risuCardSources(context.char),
    permission = !!sources.card.lowLevelAccess,
    triggers = sources.triggers.map(function (trigger) {
      return Object.assign({}, trigger, { lowLevelAccess: permission });
    }),
    result = await YeyuRisuTrigger.run(triggers, mode, Object.assign({}, context, extra || {}));
  context.assertLive();
  if (result.messages) context.messages = result.messages;
  return result;
}
async function risuProcessScriptContext(context, text, mode, options) {
  options = options || {};
  context.assertLive();
  text = await risuRunLuaHooks(context, mode, String(text), options);
  if (mode === 'editdisplay') {
    var display = await risuRunTriggerContext(context, 'display', { displayState: text });
    text = display.displayState == null ? text : display.displayState;
  }
  // The dedicated regex Worker evaluates CBS against a serializable Risu snapshot.
  var result = await risuRunRegex(context, text, mode, options);
  context.assertLive();
  (result.diagnostics || []).forEach(function (error) {
    context.diagnostic(error);
  });
  if (options.history) {
    options.history.template = result.template;
    options.history.input = result.inputHistory;
  }
  return result.data;
}
// Lua edit hooks and display triggers run between rows and may read what an earlier row wrote, so a
// mode that has them processes its rows one by one. Without them the rows' regex passes are one
// Worker request. Request history never runs either (see risuRunLuaHooks).
function risuModeRunsHooks(char, mode) {
  if (mode === 'editprocess') return false;
  return risuCardSources(char).triggers.some(function (trigger) {
    var effects = trigger && trigger.effect,
      first = Array.isArray(effects) && effects[0];
    return (
      !Array.isArray(effects) ||
      !!(first && (first.type === 'triggerlua' || first.type === 'triggercode')) ||
      (mode === 'editdisplay' && trigger.type === 'display')
    );
  });
}
// rows: [{ text, options: { role, chatIndex, message } }] in the order they take effect. A failing row
// fails the whole pass, as a single row's pass does, unless `onRowError` is given: then the failure
// stays with that row, as if the row had run in its own transaction. Its writes are undone, its text
// comes back undefined, `onRowError(index, error)` receives the error and later rows carry on.
async function risuProcessScriptRows(context, rows, mode, onRowError) {
  context.assertLive();
  if (!risuModeRunsHooks(context.char, mode)) return risuRunRegexRows(context, rows, mode, onRowError);
  var texts = [];
  for (var index = 0; index < rows.length; index++) {
    var row = rows[index];
    if (!onRowError) {
      texts.push(await risuProcessScriptContext(context, row.text, mode, row.options));
      continue;
    }
    var saved = risuSaveRowState(context);
    try {
      texts.push(await risuProcessScriptContext(context, row.text, mode, row.options));
    } catch (error) {
      // A cancelled or displaced transaction ends the whole pass; anything else belongs to this row.
      context.assertLive();
      risuRestoreRowState(context, saved);
      texts.push(undefined);
      onRowError(index, error);
    }
  }
  return texts;
}
function risuSaveRowState(context) {
  return {
    vars: Object.assign({}, context.state.vars),
    changedVars: Array.from(context.state.changedVars),
    diagnostics: context.state.diagnostics.length,
    emotions: (context.emotionEffects || []).length,
    messages: context.messages,
  };
}
function risuRestoreRowState(context, saved) {
  var state = context.state;
  Object.keys(state.vars).forEach(function (key) {
    delete state.vars[key];
  });
  Object.assign(state.vars, saved.vars);
  state.changedVars.clear();
  saved.changedVars.forEach(function (key) {
    state.changedVars.add(key);
  });
  state.diagnostics.length = saved.diagnostics;
  if (context.emotionEffects) context.emotionEffects.length = saved.emotions;
  context.messages = saved.messages;
}
async function risuPrepareInput(char, session, text, target) {
  if (!isRisuCharacter(char)) return String(text);
  return risuWithExecution(char, session, { target: target }, async function (context) {
    await risuRunTriggerContext(context, 'input');
    var history = {};
    var result = await risuProcessScriptContext(context, text, 'editinput', {
      role: 'user',
      chatIndex: -1,
      history: history,
    });
    if (target) target.risuInputTemplate = history.template;
    return result;
  });
}
async function risuPrepareStart(char, session, target, signal, options) {
  if (!isRisuCharacter(char)) return null;
  options = Object.assign(options || {}, { target: target, signal: signal, promptPreview: true });
  var result = await risuWithExecution(char, session, options, async function (context) {
    await risuHistoryRenderRows(context, true);
    return risuRunTriggerContext(context, 'start');
  });
  if (result.stopSending) throw risuAbortError();
  return result;
}
async function risuPreparePrompt(char, session, rows, target, signal, options) {
  if (!isRisuCharacter(char)) return rows;
  options = Object.assign(options || {}, { target: target, signal: signal, promptPreview: true });
  return risuWithExecution(char, session, options, async function (context) {
    var texts = await risuProcessScriptRows(
      context,
      rows.map(function (row) {
        return {
          text: risuMessageTemplate(row),
          options: { role: row.role, chatIndex: risuChatIndex(session, row), message: row },
        };
      }),
      'editprocess'
    );
    // 固定 Risu index.svelte.ts：用户与助手消息里的 inlay token 都不以文本发给模型（上游把用户消息与 inlayeddata 转成
    // 多模态 part，这里未接，见 RISU_REFERENCE）。
    return rows.map(function (row, index) {
      var content = texts[index];
      if (row.role !== 'system') content = risuStripPromptInlays(content);
      return Object.assign({}, row, { content: content });
    });
  });
}
function risuStripPromptInlays(content) {
  return String(content).replace(/\{\{(inlay|inlayed|inlayeddata)::(.+?)\}\}/g, '');
}
async function risuPrepareRequest(char, session, messages, target, signal, options) {
  if (!isRisuCharacter(char)) return messages;
  options = Object.assign(options || {}, { target: target, signal: signal, promptPreview: true });
  return risuWithExecution(char, session, options, async function (context) {
    var edited = await risuRunLuaHooks(context, 'editRequest', messages, {});
    if (!Array.isArray(edited)) throw new Error('Risu editRequest 必须返回消息数组');
    var result = await risuRunTriggerContext(context, 'request', { requestState: edited });
    if (result.stopSending) throw risuAbortError();
    return result.requestState || messages;
  });
}
async function risuCommitOutput(char, session, message, target, options) {
  if (!isRisuCharacter(char)) return;
  var undo, outputContext;
  await risuWithExecution(
    char,
    session,
    {
      target: target,
      save: false,
      onCommit: function (rollback) {
        undo = rollback;
      },
    },
    async function (context) {
      outputContext = context;
      var index = risuChatIndex(session, message),
        row = context.messages[index];
      if (!row) return;
      row.data = await risuProcessScriptContext(context, row.data, 'editoutput', {
        role: 'assistant',
        chatIndex: index,
        message: message,
      });
      target.risuNonStreamInlayHandled = false;
      if (options && options.complete && !options.streamed && risuInlayImageGeneration(char)) {
        await risuResolveImgGenTags(context, row);
        target.risuNonStreamInlayHandled = true;
      }
      await risuHistoryRenderRows(context, true);
      var result = await risuRunTriggerContext(context, 'output');
      target.risuSendAIprompt = result.sendAIprompt === true;
    }
  ).catch(function (error) {
    if (undo) undo();
    throw error;
  });
  if (target && outputContext && outputContext.appliedEmotion) target.risuOutputEmotionHandled = true;
  return undo;
}
function risuMessageDisplaySource(text, message) {
  return message && text === message.content ? risuMessageTemplate(message) : String(text || '');
}
function risuPersonaDisplayState(char) {
  var persona = getActivePersona(char.id);
  if (!persona) return persona;
  var state = Object.assign({}, persona);
  // Loading an avatar adds this derived URL cache without changing the persona.
  delete state._mediaDisplay;
  return state;
}
function risuDisplayRandomKey(raw, char, session, message) {
  return JSON.stringify([
    raw,
    char.id,
    session && session.id,
    session && session.risu,
    characterPromptName(char),
    risuPersonaDisplayState(char),
    risuDefaultVariables(char),
    session && session.msgs.length,
    message && message.opening,
    message && message.openingIndex,
  ]);
}
async function risuEvaluateDisplayMessages(char, session, messages, isCurrent, signal, texts) {
  var controller = new AbortController(),
    revision = _risuDisplayCache,
    displayEntries = messages.map(function (message) { return _risuCBSDisplayCache.get(message); });
  controller.risuSession = session;
  _risuExecutions.add(controller);
  var stop = function () {
    controller.abort();
  };
  if (signal) {
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  }
  try {
    var state = createRisuMacroState(char, session, { commit: false });
    // Asset macros stay for the message frame to resolve, as they do for display scripts, so the text is
    // the same whether or not an asset was loaded yet.
    state.assetContext = risuDeferredCBSAssetContext(await risuDisplayAssetContext(char));
    var snapshot = risuSnapshotCBS(char, session, state, { lazyLoreSnapshot: true });
    var official = risuOfficialMessages(session),
      positions = new Map();
    official.forEach(function (message, index) {
      positions.set(message, index);
    });
    var rows = messages.map(function (message, index) {
      var raw = texts ? texts[index] : risuMessageDisplaySource(messageDisplayParts(char, message).content, message);
      var cached = _risuDisplayRandomChoices.get(message);
      if (cached && (cached.revision !== revision || cached.key !== risuDisplayRandomKey(raw, char, session, message)))
        cached = null;
      return {
        text: raw,
        randomValues: cached ? cached.values : [],
        context: {
          role: message.role === 'assistant' ? 'char' : message.role,
          chatIndex: message.opening
            ? -1
            : positions.has(message)
              ? positions.get(message)
              : official.findIndex(function (row) {
                  return Number(message.seq) > 0 && row.seq === message.seq;
                }),
          firstMessage: !!message.opening,
          firstMessageIndex: openingAlternateGreetingIndex(char, message),
        },
      };
    });
    var results = await YeyuRisuRegexRuntime.evaluateDisplayCBS(rows, snapshot, { signal: controller.signal });
    if (controller.signal.aborted || revision !== _risuDisplayCache || (isCurrent && !isCurrent()))
      throw risuAbortError();
    results.forEach(function (result, index) {
      var displayEntry = displayEntries[index];
      if (!result.error && displayEntry && _risuCBSDisplayCache.get(messages[index]) === displayEntry &&
          displayEntry.raw === rows[index].text && displayEntry.revision === revision) {
        displayEntry.inputHistory = result.inputHistory;
        risuCaptureDisplayHistory(messages[index], result.text, result.inputHistory, displayEntry);
      }
      if (result.clockDependent) _risuDisplayClockReads.add(messages[index]);
      else _risuDisplayClockReads.delete(messages[index]);
      if (result.randomValues && result.randomValues.length)
        _risuDisplayRandomChoices.set(messages[index], {
          key: risuDisplayRandomKey(rows[index].text, char, session, messages[index]),
          revision: revision,
          values: result.randomValues,
        });
      if (result.error) risuScriptError(result.error);
    });
    return results.map(function (result, index) {
      return result.error ? rows[index].text : result.text;
    });
  } finally {
    _risuExecutions.delete(controller);
    if (signal) signal.removeEventListener('abort', stop);
  }
}
function risuDisplayEnvironment(char, session) {
  var env = _risuDisplayRenderEnvironment;
  return env && env.char === char && env.session === session ? env : chatSearchEnvironment(char, session);
}
function risuDisplayCBS(text, char, session, message, options) {
  var raw = risuMessageDisplaySource(text, message);
  if (!YeyuRisuCBS.hasMacros(raw)) return raw;
  if (!message) {
    var loose = _risuLooseDisplayMessages.get(session);
    if (!loose || loose.content !== raw || loose.role !== (options && options.role)) {
      loose = { content: raw, role: options && options.role };
      _risuLooseDisplayMessages.set(session, loose);
    }
    message = loose;
  }
  var env = risuDisplayEnvironment(char, session),
    revision = _risuDisplayCache;
  var existing = _risuCBSDisplayCache.get(message);
  if (
    existing &&
    existing.raw === raw &&
    existing.env === env &&
    existing.revision === revision &&
    (!_risuDisplayClockReads.has(message) || existing.clockEpoch === _risuDisplayClockEpoch)
  ) {
    if (!(options && options.prewarm) && existing.batch) existing.batch.rerender = true;
    return risuRememberDisplaySource(message, existing.text, existing.inputHistory, existing);
  }
  var entry = {
    raw: raw,
    env: env,
    revision: revision,
    message: message,
    clockEpoch: _risuDisplayClockEpoch,
    text: existing ? existing.text : '',
    inputHistory: existing && existing.inputHistory,
  };
  _risuCBSDisplayCache.set(message, entry);
  var batch = _risuCBSDisplayBatches.get(session);
  if (!batch || batch.env !== env || batch.revision !== revision) {
    batch = {
      env: env,
      revision: revision,
      entries: [],
      epoch: _risuSessionEpochs.get(session) || 0,
      cancelEpoch: _risuCancelEpoch,
    };
    _risuCBSDisplayBatches.set(session, batch);
    batch.promise = Promise.resolve().then(async function () {
      if (_risuCBSDisplayBatches.get(session) === batch) _risuCBSDisplayBatches.delete(session);
      var entries = batch.entries.filter(function (entry) {
        return _risuCBSDisplayCache.get(entry.message) === entry;
      });
      function current() {
        return (
          revision === _risuDisplayCache &&
          batch.epoch === (_risuSessionEpochs.get(session) || 0) &&
          batch.cancelEpoch === _risuCancelEpoch &&
          chatSearchEnvironment(char, session) === env
        );
      }
      if (!entries.length) return;
      if (!current()) {
        entries.forEach(function (entry) {
          if (_risuCBSDisplayCache.get(entry.message) === entry) _risuCBSDisplayCache.delete(entry.message);
        });
        return false;
      }
      try {
        var values = await risuEvaluateDisplayMessages(
          char,
          session,
          entries.map(function (entry) {
            return entry.message;
          }),
          current,
          undefined,
          entries.map(function (entry) {
            return entry.raw;
          })
        );
        entries.forEach(function (entry, index) {
          if (_risuCBSDisplayCache.get(entry.message) === entry) entry.text = values[index];
          entry.batch = null;
          entry.promise = null;
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          entries.forEach(function (entry) {
            if (_risuCBSDisplayCache.get(entry.message) === entry) _risuCBSDisplayCache.delete(entry.message);
          });
          return false;
        }
        entries.forEach(function (entry) {
          entry.text = entry.raw;
          entry.batch = null;
          entry.promise = null;
        });
        risuScriptError(error);
      }
      if (batch.rerender && current() && getChar() === char && getActiveSession(char.id) === session) renderChat(true);
    });
  }
  batch.entries.push(entry);
  entry.batch = batch;
  if (!(options && options.prewarm)) batch.rerender = true;
  entry.promise = batch.promise;
  return risuRememberDisplaySource(message, entry.text, entry.inputHistory, entry);
}
function risuRememberDisplaySource(message, text, history, owner) {
  if (message) {
    var existing = _risuDisplaySources.get(message), template = risuMessageTemplate(message);
    if (existing && existing.owner === owner && existing.text === text && existing.content === message.content && existing.template === template) {
      if (history) existing.input = history;
    } else _risuDisplaySources.set(message, {
      text: text, input: history, content: message.content, template: template, owner: owner,
    });
  }
  return text;
}
function risuCaptureDisplayHistory(message, text, history, owner) {
  var record = _risuDisplaySources.get(message);
  if (record && record.owner === owner && record.text === text && record.content === message.content && record.template === risuMessageTemplate(message))
    record.input = history;
}
async function prepareRisuDisplayTexts(char, session, messages) {
  risuAdoptDisplayContextOwner(char);
  risuSyncCharacterDisplayOptions(char);
  var previous = _risuDisplayRenderEnvironment;
  _risuDisplayRenderEnvironment = chatSearchEnvironment(char, session);
  var pending = new Set();
  try {
    messages.forEach(function (message) {
      if (!message || message.role === 'system') return;
      risuDisplayCBS(messageDisplayParts(char, message).content, char, session, message, {
        role: message.role,
        prewarm: true,
      });
      var entry = _risuCBSDisplayCache.get(message);
      if (entry && entry.promise) pending.add(entry.promise);
    });
  } finally {
    _risuDisplayRenderEnvironment = previous;
  }
  var results = await Promise.all(Array.from(pending));
  if (results.includes(false)) throw risuAbortError();
  return pending.size;
}

// What every message's display shares within one render: chat variables, persona and the card's
// display scripts. A render serializes it once; display results are keyed on it.
function risuDisplayScriptState(char, session, shareRenderState) {
  var env = shareRenderState && _risuDisplayRenderEnvironment,
    shared = env && env.char === char && env.session === session;
  if (shared && env.scriptDisplayKey) return env.scriptDisplayKey;
  var sources = risuCardSources(char),
    state = JSON.stringify([
      session && session.risu,
      characterPromptName(char),
      risuPersonaDisplayState(char),
      sources.regex,
      sources.triggers,
    ]);
  if (shared) env.scriptDisplayKey = state;
  return state;
}
// A display pass writes its chat variables once, together with the texts it produced. Texts computed
// in the state just before that write remain the display of the state just after it, so the write
// alone never sends messages back through their scripts.
function risuDisplayStateMatches(session, computed, current) {
  if (computed === current) return true;
  var written = _risuDisplayWrites.get(session);
  return !!(written && written.to === current && written.from.has(computed));
}
function risuNoteDisplayWrites(session, before, after) {
  if (before === after) return;
  var written = _risuDisplayWrites.get(session);
  if (!written || written.to !== before) written = { from: new Set(), to: before };
  written.from.add(before);
  written.to = after;
  _risuDisplayWrites.set(session, written);
}
function risuDisplayEntryCurrent(entry) {
  return _risuDisplayCache.get(entry.message) === entry;
}
function risuDisplayText(text, char, session, message, options) {
  options = options || {};
  var stream = _risuStreamDisplay;
  if (stream && stream.char === char && stream.session === session && stream.message === (message || null))
    return risuStreamDisplayText(text, char, session, message, stream);
  var sources = risuCardSources(char);
  if (!message || (!sources.regex.length && !sources.triggers.length))
    return risuDisplayCBS(text, char, session, message, options);
  var raw = risuMessageDisplaySource(text, message),
    state = risuDisplayScriptState(char, session, true),
    source = JSON.stringify([raw, message.content, risuMessageTemplate(message)]),
    previous = _risuDisplayCache.get(message);
  if (previous && previous.source === source && risuDisplayStateMatches(session, previous.state, state)) {
    previous.state = state;
    // Until the card's display scripts answer, a CBS placeholder follows the latest CBS text, which may
    // itself have been pending when the entry was created.
    if (previous.pending && previous.placeholder === 'cbs')
      previous.text = risuDisplayCBS(text, char, session, message, options);
    return risuRememberDisplaySource(message, previous.text, previous.history ||
      (previous.placeholder === 'cbs' && (_risuCBSDisplayCache.get(message) || {}).inputHistory), previous);
  }
  // While the scripts recompute, a message whose text did not change keeps its last display instead of
  // collapsing to the unprocessed text and back; a reply just committed starts from its preview.
  var preview = _risuDisplayPreviews.get(message),
    stale = previous && previous.source === source && !(previous.pending && previous.placeholder === 'cbs'),
    entry = {
      state: state,
      source: source,
      message: message,
      raw: raw,
      options: Object.assign({}, options, { message: message, chatIndex: risuChatIndex(session, message), history: {} }),
      pending: true,
      placeholder: 'cbs',
    };
  _risuDisplayPreviews.delete(message);
  if (preview && preview.source === source && preview.state === state) {
    entry.placeholder = 'preview';
    entry.text = preview.text;
  } else if (stale) {
    entry.placeholder = 'stale';
    entry.text = previous.text;
    entry.history = previous.history;
  } else entry.text = risuDisplayCBS(text, char, session, message, options);
  _risuDisplayCache.set(message, entry);
  risuQueueDisplayEntry(char, session, entry);
  return risuRememberDisplaySource(message, entry.text, entry.history ||
    (entry.placeholder === 'cbs' && (_risuCBSDisplayCache.get(message) || {}).inputHistory), entry);
}
// Every message a render finds stale joins the session's open display pass; the pass closes when it
// starts running.
function risuQueueDisplayEntry(char, session, entry) {
  var batch = _risuDisplayBatches.get(session);
  if (!batch || batch.char !== char || batch.state !== entry.state) {
    if (batch) batch.controller.abort();
    batch = { char: char, session: session, state: entry.state, entries: [], controller: new AbortController() };
    _risuDisplayBatches.set(session, batch);
    risuRunDisplayBatch(batch);
  }
  batch.entries.push(entry);
}
// One read-only transaction recomputes the pass's messages one after another in render order, so
// display-time variable writes land in the same order and are saved once; the chat repaints once
// afterwards.
function risuRunDisplayBatch(batch) {
  var char = batch.char,
    session = batch.session,
    written = null,
    failures = new Map();
  risuWithExecution(
    char,
    session,
    {
      readOnly: true,
      displayVars: true,
      displayWork: batch,
      // The message frame resolves asset macros itself and keys its preserved controls on this text,
      // so the text must not change with whether an asset URL was already hydrated.
      deferAssetUrls: true,
      signal: batch.controller.signal,
      assertDisplayCurrent: function () {
        if (risuDisplayScriptState(char, session) !== batch.state) throw risuAbortError();
      },
      onDisplayResultReady: function () {
        // Capture our own variable writes before saving can yield to unrelated changes.
        written = risuDisplayScriptState(char, session);
      },
    },
    function (context) {
      if (_risuDisplayBatches.get(session) === batch) _risuDisplayBatches.delete(session);
      batch.entries = batch.entries.filter(risuDisplayEntryCurrent);
      return risuProcessScriptRows(
        context,
        batch.entries.map(function (entry) {
          return { text: entry.raw, options: entry.options };
        }),
        'editdisplay',
        // Each message fails on its own, as its own display pass would: the others still show.
        function (index, error) {
          failures.set(index, error);
        }
      );
    }
  )
    .then(function (texts) {
      var changed = [];
      risuNoteDisplayWrites(session, batch.state, written);
      batch.entries.forEach(function (entry, index) {
        if (!risuDisplayEntryCurrent(entry)) return;
        // A failed message keeps what is on screen and is asked for again by the next render.
        if (failures.has(index)) {
          entry.state = null;
          return;
        }
        if (entry.text !== texts[index]) changed.push(entry.message);
        risuCaptureDisplayHistory(entry.message, texts[index], entry.options.history.input, entry);
        entry.text = texts[index];
        entry.history = entry.options.history.input;
        entry.state = written;
        entry.pending = false;
      });
      failures.forEach(risuScriptError);
      if (changed.length && getChar() === char && getActiveSession(char.id) === session)
        risuRepaintDisplays(char, session, changed);
    })
    .catch(function (error) {
      // The write that overtook this pass evaluates its messages again when it ends, or drops them if a
      // stop or release ended it.
      if (batch.yielded) return;
      // What is on screen stays; the next render asks for these messages again.
      batch.entries.forEach(function (entry) {
        if (risuDisplayEntryCurrent(entry)) entry.state = null;
      });
      risuScriptError(error);
    });
}
// A generation owns the chat until it commits, so the list is not rebuilt under it: only the rows whose
// display changed are patched, and the committed render repaints the rest. Otherwise, like other script
// repaints, the whole chat is rendered again.
function risuRepaintDisplays(char, session, messages) {
  if (messages && typeof _generationState !== 'undefined' && _generationState !== 'idle') {
    // A continuation, regeneration or swipe streams onto its own existing row, which the stream paints:
    // that row is left to it and to the committed render.
    var streaming =
        typeof generationTarget === 'object' &&
        generationTarget &&
        String(generationTarget.sessionId) === String(session.id)
          ? session.msgs[generationTargetMessageIndex(generationTarget, session)] || null
          : null,
      targets = messages
        .map(function (message) {
          return {
            charId: String(char.id),
            sessionId: String(session.id),
            index: session.msgs.indexOf(message),
            message: message,
          };
        })
        .filter(function (target) {
          return target.index >= 0 && target.message !== streaming;
        });
    if (!targets.length) return;
    if (patchRegexDisplayMessages(targets)) {
      // The patch rewrites the rows' display sources; their card frames follow. A new reply streams at
      // the index after the chat, so it stays listed there: its frame keeps its place and its stylesheet.
      Promise.resolve(
        syncRisuDisplays(char, session, session.msgs.concat([{ role: 'assistant', content: '' }]), 0)
      ).catch(function (error) {
        console.warn('Risu 演出挂载失败', error);
      });
      return;
    }
  }
  requestCardScriptRerender();
}
// A message's display evaluated as the committed chat will evaluate it, without writing anything: the
// text stands where its message is, or will be appended, so history macros read it in place. `cbsOnly`
// evaluates just the text's CBS, as for a card without display scripts.
async function risuPreviewDisplay(char, session, message, raw, signal, cbsOnly) {
  var sources = risuCardSources(char),
    placed = Object.assign({}, message || { role: 'assistant', time: Date.now() }, { content: raw }),
    msgs = (session.msgs || []).slice(),
    at = message ? msgs.indexOf(message) : -1;
  delete placed.risu;
  if (at >= 0) msgs[at] = placed;
  else msgs.push(placed);
  if (cbsOnly || (!sources.regex.length && !sources.triggers.length))
    return (
      await risuEvaluateDisplayMessages(char, Object.assign({}, session, { msgs: msgs }), [placed], null, signal, [raw])
    )[0];
  var controller = new AbortController(),
    stop = function () {
      controller.abort();
    };
  if (signal) {
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  }
  try {
    return await risuWithExecution(
      char,
      session,
      {
        readOnly: true,
        displayVars: true,
        preview: true,
        deferAssetUrls: true,
        signal: controller.signal,
        displayWork: { controller: controller },
      },
      function (context) {
        var index = message ? risuChatIndex(session, message) : -1;
        if (index >= 0) context.messages[index].data = raw;
        else if (!placed.opening) {
          context.messages.push({ role: 'char', data: raw, time: placed.time });
          index = context.messages.length - 1;
        }
        return risuProcessScriptContext(context, raw, 'editdisplay', {
          role: 'assistant',
          chatIndex: index,
          message: placed,
        });
      }
    );
  } finally {
    if (signal) signal.removeEventListener('abort', stop);
  }
}
// A streaming reply is displayed through the same chain as the committed reply, so images and card
// markup appear while it is written. `stream` is the paint asking: its slot, revision and snapshot
// callbacks follow the streaming preview protocol of 72-stream-response.js.
function risuWithStreamDisplay(stream, paint) {
  if (!stream || !isRisuCharacter(stream.char)) return paint();
  var previous = _risuStreamDisplay;
  _risuStreamDisplay = Object.assign({}, stream, { message: stream.message || null });
  try {
    return paint();
  } finally {
    _risuStreamDisplay = previous;
  }
}
// Only the newest text of each slot is evaluated: one preview runs at a time and a newer paint replaces
// whatever was still waiting, so a fast stream never builds a backlog. Results reach the stream through
// its completion callback, never through a chat render.
function risuStreamDisplayText(text, char, session, message, stream) {
  var options = stream.options || {},
    slot = String(options.streamDisplaySlot || 'body'),
    revision = Number(options.streamDisplayRevision) || 0,
    raw = risuMessageDisplaySource(text, message),
    previews = _risuStreamPreviews.get(stream.owner);
  if (!previews) {
    previews = { running: null, waiting: new Map(), asked: Object.create(null), dropped: false };
    _risuStreamPreviews.set(stream.owner, previews);
  }
  if (!previews.dropped && previews.asked[slot] !== raw) {
    previews.asked[slot] = raw;
    previews.waiting.set(slot, {
      char: char,
      session: session,
      message: message,
      raw: raw,
      slot: slot,
      revision: revision,
      complete: options.onStreamDisplayComplete,
    });
    risuRunStreamPreview(previews);
  }
  var snapshot =
    typeof options.streamDisplaySnapshot === 'function'
      ? options.streamDisplaySnapshot({ slot: slot, revision: revision, ready: false })
      : null;
  return snapshot && snapshot.ready ? String(snapshot.text == null ? '' : snapshot.text) : '';
}
function risuRunStreamPreview(previews) {
  if (previews.running || !previews.waiting.size) return;
  var slot = previews.waiting.keys().next().value,
    request = previews.waiting.get(slot);
  previews.waiting.delete(slot);
  previews.running = new AbortController();
  var signal = previews.running.signal;
  risuPreviewDisplay(request.char, request.session, request.message, request.raw, signal)
    .catch(function (error) {
      if (error && error.name === 'AbortError') throw error;
      console.warn('Risu 流式显示求值失败', error);
      // A failed preview leaves the stream its text instead of an empty bubble: the text's CBS alone, or the
      // text as written when that fails too. The next text is previewed as usual.
      return risuPreviewDisplay(request.char, request.session, request.message, request.raw, signal, true).catch(
        function (fallbackError) {
          if (fallbackError && fallbackError.name === 'AbortError') throw fallbackError;
          return request.raw;
        }
      );
    })
    .then(
      function (text) {
        if (typeof request.complete === 'function')
          request.complete({ slot: request.slot, revision: request.revision, text: text, key: '', async: true });
      },
      function () {}
    )
    .then(function () {
      previews.running = null;
      risuRunStreamPreview(previews);
    });
}
// No further text is coming for this stream: its waiting preview is dropped and the running one stopped,
// so they do not delay the reply's committed display on the same queue.
function dropRisuStreamPreviews(owner) {
  var previews = _risuStreamPreviews.get(owner);
  if (!previews) return;
  previews.dropped = true;
  previews.waiting.clear();
  if (previews.running) previews.running.abort();
}
// Before a reply is shown as committed, its display is evaluated once without writing anything, so the
// committed render starts from the text the stream ended on instead of the unprocessed reply. The
// committed display pass still runs, writes its variables and repaints only if its text differs.
async function risuPrimeDisplay(char, session, message, text, signal) {
  var sources = risuCardSources(char);
  if (!sources.regex.length && !sources.triggers.length) {
    await prepareRisuDisplayTexts(char, session, [message]);
    return;
  }
  var raw = risuMessageDisplaySource(text, message),
    state = risuDisplayScriptState(char, session),
    source = JSON.stringify([raw, message.content, risuMessageTemplate(message)]),
    display = await risuPreviewDisplay(char, session, message, raw, signal);
  _risuDisplayPreviews.set(message, { state: state, source: source, text: display });
}
// The greeting picker must show what the conversation will show: the same CBS evaluation under the
// conversation's current options, followed by the card's display regexes.
async function risuGreetingDisplayText(char, session, text, openingIndex) {
  var raw = String(text == null ? '' : text);
  if (!isRisuCharacter(char) || !session) return Promise.resolve(raw);
  var options = {
      role: 'assistant',
      chatIndex: -1,
      message: { role: 'assistant', content: raw, opening: true, openingIndex: Number(openingIndex) || 0 },
    },
    sources = risuCardSources(char);
  if (!sources.regex.length && !sources.triggers.length) return risuRenderCBSInWorker(raw, char, session, options);
  return risuWithExecution(char, session, { readOnly: true, displayVars: true }, function (context) {
    return risuProcessScriptContext(context, raw, 'editdisplay', options);
  })
    .then(function (result) {
      return result == null ? risuRenderCBSInWorker(raw, char, session, options) : String(result);
    })
    .catch(function (error) {
      if (error.name === 'AbortError') throw error;
      console.warn('开场白显示求值失败', error);
      return risuRenderCBSInWorker(raw, char, session, options);
    });
}
function runRisuManualTrigger(name, triggerId) {
  return runRisuCardAction(function (context) {
    return risuRunTriggerContext(context, 'manual', { manualName: name, triggerId: triggerId });
  }, triggerId);
}
function runRisuButtonTrigger(value) {
  return runRisuInteractionTrigger('onButtonClick', value);
}
function runRisuFormTrigger(value, data) {
  return runRisuInteractionTrigger('onFormSubmit', value, { data: data });
}
function runRisuInteractionTrigger(mode, value, meta) {
  return runRisuCardAction(async function (context) {
    var result = {},
      sources = risuCardSources(context.char),
      triggers =
        mode === 'onFormSubmit'
          ? (sources.card.triggerscript || []).concat((sources.module && sources.module.trigger) || [])
          : sources.triggers;
    for (var entry of risuLuaEntries(context.char, triggers)) {
      result = await risuExecuteLua(context, entry.code, mode, {
        scriptId: entry.id,
        data: value,
        meta: meta,
        lowLevelAccess: context.lowLevelAccess,
      });
    }
    return result;
  });
}
async function runRisuCardAction(action, triggerId) {
  var char = getChar(),
    session = char && getActiveSession(char.id);
  if (!char || !session || !isRisuCharacter(char) || _generationState !== 'idle') return false;
  var target = bindGenerationTargetOwnership({ charId: char.id, sessionId: session.id, mode: 'new' }, session);
  generationTarget = target;
  var triggerEntry = triggerId == null ? null : { value: triggerId };
  if (triggerEntry) _risuTriggerIds.set(session, triggerEntry);
  setGenerationState('preparing');
  try {
    var result = await risuWithExecution(char, session, { target: target, signal: abortController.signal }, action);
    renderChat();
    if (result.sendAIprompt) {
      await doAPICall({ target: target });
    }
    return true;
  } catch (error) {
    risuScriptError(error);
    return false;
  } finally {
    finishGeneration(target);
    if (triggerEntry)
      setTimeout(function () {
        if (_risuTriggerIds.get(session) === triggerEntry) _risuTriggerIds.delete(session);
      }, 100);
  }
}
function risuExecutionSessionView(context) {
  var session = context.preview
    ? structuredClone(context.sessionSnapshot || context.session)
    : Object.assign({}, context.session);
  session.msgs = (context.session.msgs || [])
    .filter(function (row) {
      return row.opening;
    })
    .concat(
      context.messages.map(function (row) {
        return { role: row.role === 'char' ? 'assistant' : row.role, content: row.data, time: row.time, seq: row._seq };
      })
    );
  session.risu = Object.assign({}, context.session.risu || {}, {
    scriptstate: Object.assign({}, context.state.vars),
    globalVariables: Object.assign({}, context.state.globalVars),
    authorNote: context.getAuthorNote(),
    localLore: context.lore
      ? context.lore.getLocalLorebooks()
      : (context.session.risu && context.session.risu.localLore) || [],
  });
  return session;
}
// Nested command generations stay inside the owning transaction. Reentering the
// session queue would deadlock; this uses the same Risu lifecycle and Prompt builder.
async function risuSendWithinExecution(context) {
  context.assertLive();
  await risuHistoryRenderRows(context, true);
  var start = await risuRunTriggerContext(context, 'start');
  if (start.stopSending) throw risuAbortError();
  var session = risuExecutionSessionView(context),
    openings = session.msgs.filter(function (row) {
      return row.opening;
    }).length,
    texts = await risuProcessScriptRows(
      context,
      session.msgs.map(function (message, index) {
        return {
          text: message.content,
          options: { role: message.role, message: message, chatIndex: message.opening ? -1 : index - openings },
        };
      }),
      'editprocess'
    ),
    rows = session.msgs.map(function (message, index) {
      return Object.assign({}, message, {
        content: message.role === 'system' ? texts[index] : risuStripPromptInlays(texts[index]),
      });
    });
  session = risuExecutionSessionView(context);
  var built = await buildMessages(context.characterSnapshot, rows, session, {
    commit: false,
    risuSystemPrompts: start.additionalSystemPrompt,
    signal: context.controller.signal,
  });
  var request = await risuRunLuaHooks(context, 'editRequest', built.messages, {});
  if (!Array.isArray(request)) throw new Error('Risu editRequest 必须返回消息数组');
  var prepared = await risuRunTriggerContext(context, 'request', { requestState: request });
  if (prepared.stopSending) throw risuAbortError();
  var response = await callDeepSeek(prepared.requestState || request, null, {
    transient: true,
    controller: context.controller,
    route: 'chat',
  });
  context.assertLive();
  var row = {
      role: 'char',
      data: response.content,
      _raw: response.content,
      time: Date.now(),
      _nestedOutputId: ++_risuNestedOutputNonce,
    },
    nestedOutputId = row._nestedOutputId;
  context.messages.push(row);
  row.data = await risuProcessScriptContext(context, row.data, 'editoutput', {
    role: 'assistant',
    chatIndex: context.messages.length - 1,
  });
  if (!response.streamed && risuInlayImageGeneration(context.char)) await risuResolveImgGenTags(context, row);
  await risuHistoryRenderRows(context, true);
  var output = await risuRunTriggerContext(context, 'output');
  if (output.stopSending) throw risuAbortError();
  if (response.streamed && risuInlayImageGeneration(context.char)) {
    var outputRow = context.messages.find(function (entry) {
      return entry._nestedOutputId === nestedOutputId;
    });
    if (outputRow) await risuResolveImgGenTags(context, outputRow);
  }
  if (output.sendAIprompt) return risuSendWithinExecution(context);
  var viewGeneration = risuViewScreenImageGeneration(context.char);
  if (viewGeneration) {
    var viewSession = risuExecutionSessionView(context),
      viewMessage = risuOfficialMessages(viewSession).slice(-1)[0];
    try {
      context.setViewScreenImage(
        await risuCreateViewScreenImage(context.char, viewSession, viewMessage, viewGeneration, context.controller)
      );
    } catch (error) {
      context.assertLive();
      if (error && error.name === 'AbortError') throw error;
      risuReportImageError(error);
    }
  }
  return { messages: context.messages, sendAIprompt: false };
}
function risuEmotionClassificationEnabled(char) {
  var card = char && isRisuCharacter(char) ? risuCardSources(char).card : null;
  return !!(card && card.viewScreen === 'emotion' && card.inlayViewScreen !== true);
}
function risuEmotionClassificationAnswer(value, names) {
  var answer = String(value == null ? '' : value)
      .replace(/\s/g, '')
      .toLocaleLowerCase(),
    normalized = names.map(function (name) {
      return String(name).replace(/\s/g, '').toLocaleLowerCase();
    }),
    index = normalized.indexOf(answer);
  if (index < 0)
    index = normalized.findIndex(function (name) {
      return name && answer.includes(name);
    });
  if (index < 0) index = normalized.indexOf('neutral');
  return index < 0 ? '' : names[index];
}
function risuShuffleEmotionNames(names) {
  names = names.slice();
  for (var index = names.length - 1; index > 0; index--) {
    var swap = Math.floor(Math.random() * (index + 1)),
      value = names[index];
    names[index] = names[swap];
    names[swap] = value;
  }
  return names;
}
function risuAssertEmotionClassificationOwner(char, session, target, message, source) {
  assertGenerationTargetOwnership(target, session);
  if (
    getChar() !== char ||
    getActiveSession(char.id) !== session ||
    !Number.isInteger(target.messageIndex) ||
    session.msgs[target.messageIndex] !== message ||
    risuMessageText(message) !== source
  )
    throw risuAbortError();
}
async function risuClassifyOutputEmotion(char, session, message, target, signal) {
  if (!risuEmotionClassificationEnabled(char) || !message || !target || target.risuOutputEmotionHandled === true)
    return null;
  var source = risuMessageText(message);
  if (!source.trim()) return null;
  risuAssertEmotionClassificationOwner(char, session, target, message, source);
  return risuWithExecution(char, session, { readOnly: true, signal: signal }, async function (context) {
    risuAssertEmotionClassificationOwner(char, session, target, message, source);
    var assets = await risuDisplayAssetContext(char),
      entries = (assets.emotionEntries || []).filter(function (entry) {
        var status = String((entry.sourceAsset && entry.sourceAsset.status) || '');
        return entry.name && !['unavailable', 'failed', 'save_failed'].includes(status);
      }),
      names = entries
        .map(function (entry) {
          return entry.name;
        })
        .filter(function (name, index, all) {
          var key = String(name).toLocaleLowerCase();
          return (
            all.findIndex(function (candidate) {
              return String(candidate).toLocaleLowerCase() === key;
            }) === index
          );
        });
    if (!names.length) return null;
    var prompt =
        "From the list below, choose a word that best represents a character's outfit description, action, or emotion in their dialogue. Prioritize selecting words related to outfit first, then action, and lastly emotion. Print out the chosen word.\n\n list: " +
        risuShuffleEmotionNames(names).join(', ') +
        ' \noutput only one word.',
      result = await callDeepSeek(
        [
          { role: 'system', content: prompt },
          { role: 'user', content: '"Good morning, Master! Is there anything I can do for you today?"' },
          { role: 'assistant', content: 'happy' },
          { role: 'user', content: source },
        ],
        null,
        {
          route: 'chat',
          transient: true,
          nonStream: true,
          disableThinking: true,
          controller: context.controller,
          maxTokens: 30,
          ignoreUserMaxTokens: true,
          silent: true,
        }
      );
    context.assertLive();
    risuAssertEmotionClassificationOwner(char, session, target, message, source);
    var selected = risuEmotionClassificationAnswer(result && result.content, names),
      entry = entries.find(function (candidate) {
        return candidate.name === selected;
      });
    if (!entry) return null;
    await risuEnsureDisplayAsset(entry, assets);
    context.assertLive();
    risuAssertEmotionClassificationOwner(char, session, target, message, source);
    if (!entry.url) return null;
    var applied = await risuApplyEmotionEffects(char, session, {
      type: 'emotion',
      name: entry.name,
      asset: entry.url,
    });
    context.assertLive();
    risuAssertEmotionClassificationOwner(char, session, target, message, source);
    if (applied) target.risuOutputEmotionHandled = true;
    return applied;
  });
}
function risuReportEmotionClassificationError(error) {
  if (error && (error.name === 'AbortError' || error.message === '已取消')) return;
  if (typeof console !== 'undefined' && console.warn) console.warn('Risu 情绪判定失败', error);
  toast('Risu 情绪判定失败，保留当前立绘：' + String((error && error.message) || error), 'err');
}
function risuReportImageError(error) {
  toast('Risu 卡片出图失败：' + String((error && error.message) || error), 'err');
}
// 固定 Risu inlayScreen.ts runInlayScreen：回复（editoutput 与 output trigger 之后）里的 <ImgGen="…">、{{ImgGen="…"}}
// 以 newGenData.prompt 的 {{slot}} 为卡片提示词逐个出图（上游并发，这里串行，免得一次回复成倍计费），再在一次 Risu 事务里
// 把标签依次换成 {{inlay::id}}、失败的换成空串，图片随事务写入 session.risu.inlays。停止后已出的图照常写入，其余标签清空；
// 等待期间消息被改写则丢弃结果。content 原文不变，运行文本按 DATA_MODEL 的 Risu 消息文本约定保存。
var RISU_IMGGEN_TAGS = [/<ImgGen="(.+?)">/gi, /\{\{ImgGen="(.+?)"\}\}/gi];
var _risuNestedOutputNonce = 0;
async function risuResolveImgGenTags(context, row) {
  var generation = risuInlayImageGeneration(context.char),
    text = String(row.data);
  if (!generation) return;
  for (var pattern of RISU_IMGGEN_TAGS) {
    var slots = [];
    text.replace(pattern, function (_match, slot) {
      slots.push(slot);
      return _match;
    });
    if (!slots.length) continue;
    var replacements = [];
    for (var slot of slots) {
      context.assertLive();
      replacements.push(await context.runImage(generation.prompt.split('{{slot}}').join(slot), ''));
    }
    var index = 0;
    text = text.replace(pattern, function () {
      return replacements[index++] || '';
    });
  }
  row.data = text;
}
// 出图进行中的回复（会话 id + 消息 seq，只存在运行时）：35 号显示层只对它们把 ImgGen 标签显示为占位。
var _risuInlayScreenRuns = new Set();
function risuInlayScreenKey(session, message) {
  return String(session.id) + '|' + String(message.seq);
}
function risuInlayScreenPending(session, message) {
  return !!(session && message) && _risuInlayScreenRuns.has(risuInlayScreenKey(session, message));
}
function risuRefreshInlayScreen(char, session) {
  if (getChar() === char && getActiveSession(char.id) === session) renderChat();
}
async function risuGenerateInlayScreen(char, session, message, target, outerSignal) {
  var generation = risuInlayImageGeneration(char),
    source = risuMessageText(message),
    seq = message.seq,
    slots = [];
  RISU_IMGGEN_TAGS.forEach(function (pattern) {
    source.replace(pattern, function (match, slot) {
      slots.push(slot);
      return match;
    });
  });
  if (!slots.length) return;
  var runKey = risuInlayScreenKey(session, message),
    // 出图在回复提交之后（保存阶段）进行，登记为临时请求，输入区的停止键才能取消它。
    controller = new AbortController(),
    signal = controller.signal,
    abort = function () {
      controller.abort();
    },
    releaseController = registerTransientRequestController(controller);
  if (outerSignal && outerSignal.aborted) abort();
  else if (outerSignal) outerSignal.addEventListener('abort', abort, { once: true });
  _risuInlayScreenRuns.add(runKey);
  risuRefreshInlayScreen(char, session);
  setGenerationStatusLabel('正在生成图片');
  try {
    // 同一原因（如没有图片来源）只提示一次。
    var results = [],
      failures = new Map();
    try {
      for (var slot of slots) {
        var entry = null;
        if (!signal.aborted)
          try {
            entry = await generateRisuInlayImage(char, session, generation.prompt.split('{{slot}}').join(slot), signal);
          } catch (error) {
            if (!(error && error.name === 'AbortError')) failures.set(String((error && error.message) || error), error);
          }
        results.push(entry);
      }
    } finally {
      releaseController();
      if (outerSignal) outerSignal.removeEventListener('abort', abort);
    }
    failures.forEach(risuReportImageError);
    await risuWithExecution(char, session, { target: target }, async function (context) {
      var row = context.messages[risuChatIndex(session, message)];
      if (!row || row._seq !== seq || risuMessageText(message) !== source)
        throw new Error('消息已变化，这次生成的图片没有保存');
      var queue = results.slice();
      RISU_IMGGEN_TAGS.forEach(function (pattern) {
        row.data = String(row.data).replace(pattern, function () {
          var entry = queue.shift();
          if (!entry) return '';
          context.stagedInlays[entry.id] = entry;
          return '{{inlay::' + entry.id + '}}';
        });
      });
      // 占位随这次提交的重绘撤下。
      _risuInlayScreenRuns.delete(runKey);
      context.updateChatAt();
    });
  } catch (error) {
    if (!(error && error.name === 'AbortError')) risuReportImageError(error);
  } finally {
    // 没走到提交（消息已变化、写入失败）时在这里撤下占位。
    if (_risuInlayScreenRuns.delete(runKey)) risuRefreshInlayScreen(char, session);
  }
}
function risuViewScreenChatPrompt(session, message) {
  var rows = risuOfficialMessages(session),
    end = rows.indexOf(message),
    lines = [];
  if (end < 0) throw risuAbortError();
  for (var index = end; index >= 0; index--) {
    var row = rows[index];
    lines.unshift(
      (row.role === 'assistant' ? 'character' : 'user') + ': ' + risuMessageText(row).replace(/\n/g, ' ') + ' \n'
    );
    if (row.role === 'user') break;
  }
  return 'Chat:\n' + lines.join('');
}
async function risuCreateViewScreenImage(char, session, message, generation, controller) {
  var result = await callDeepSeek(
    [
      { role: 'system', content: generation.instructions },
      { role: 'user', content: risuViewScreenChatPrompt(session, message) },
    ],
    null,
    {
      transient: true,
      nonStream: true,
      route: 'imagePrompt',
      controller: controller,
      ignoreUserMaxTokens: true,
      maxTokens: 300,
      beforeRequest: function (body) {
        body.temperature = 0.2;
      },
    }
  );
  if (controller.signal.aborted) throw risuAbortError();
  var slot = String((result && result.content) || '')
    .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/g, '')
    .trim();
  if (!slot) throw new Error('卡片未生成有效的出图提示词');
  var entry = await generateRisuInlayImage(
    char,
    session,
    generation.prompt.split('{{slot}}').join(slot),
    controller.signal
  );
  if (controller.signal.aborted) throw risuAbortError();
  return entry;
}
async function risuGenerateViewScreenImage(char, session, message, target, outerSignal) {
  var generation = risuViewScreenImageGeneration(char);
  if (!generation) return;
  var source = risuMessageText(message),
    seq = message.seq,
    controller = new AbortController(),
    abort = function () {
      controller.abort();
    },
    releaseController = registerTransientRequestController(controller);
  if (outerSignal && outerSignal.aborted) abort();
  else if (outerSignal) outerSignal.addEventListener('abort', abort, { once: true });
  setGenerationStatusLabel('正在生成图片');
  try {
    var entry = await risuCreateViewScreenImage(char, session, message, generation, controller);
    await risuWithExecution(char, session, { target: target, signal: controller.signal }, async function (context) {
      var row = context.messages[risuChatIndex(session, message)];
      if (!row || row._seq !== seq || risuMessageText(message) !== source) throw risuAbortError();
      context.setViewScreenImage(entry);
      context.updateChatAt();
    });
  } catch (error) {
    if (!(error && error.name === 'AbortError')) risuReportImageError(error);
  } finally {
    releaseController();
    if (outerSignal) outerSignal.removeEventListener('abort', abort);
  }
}
async function risuAfterGeneration(target, options, value) {
  if (!target) return value;
  var char = (D.characters || []).find(function (entry) {
      return entry.id === target.charId;
    }),
    session = generationSessionForTarget(target),
    message = session && Number.isInteger(target.messageIndex) ? session.msgs[target.messageIndex] : null,
    signal = options && options.controller && options.controller.signal,
    complete = !!(char && session && message && !(messageActiveGenerationMeta(message) || {}).incomplete);
  // 上游先换 inlay，再处理 sendAIprompt 的重发。
  if (complete && risuInlayImageGeneration(char) && !target.risuNonStreamInlayHandled)
    await risuGenerateInlayScreen(char, session, message, target, signal);
  if (target.risuSendAIprompt) {
    if (isGenerationCancelled()) throw risuAbortError();
    target.risuSendAIprompt = false;
    target.mode = 'new';
    delete target.messageIndex;
    delete target.messageSeq;
    delete target.risuStarted;
    delete target.risuStartResult;
    delete target.risuOutputEmotionHandled;
    setGenerationState('preparing');
    return doAPICall({ target: target, controller: options && options.controller });
  }
  if (complete && risuViewScreenImageGeneration(char))
    await risuGenerateViewScreenImage(char, session, message, target, signal);
  if (!complete || !risuEmotionClassificationEnabled(char)) return value;
  try {
    await risuClassifyOutputEmotion(char, session, message, target, signal);
  } catch (error) {
    risuReportEmotionClassificationError(error);
  }
  return value;
}

async function risuParseChatML(value, render) {
  var text = String(value || '').trim();
  if (!text.startsWith('<|im_start|>')) return [{ role: 'user', content: text }];
  var rows = [];
  for (var part of text.split('<|im_start|>').filter(Boolean)) {
    var match = /^(system|user|assistant)(?:<\|im_sep\|>| |\n)/.exec(part),
      role = match ? match[1] : 'user',
      body = (match ? part.slice(match[0].length) : part).trim();
    if (body.endsWith('<|im_end|>')) body = body.slice(0, -10);
    rows.push({ role: role, content: await render(body.replace(/<Thoughts>(.+)<\/Thoughts>/gms, '')) });
  }
  return rows;
}
function risuLuaEntries(char, triggers) {
  return (triggers || risuCardSources(char).triggers)
    .map(function (trigger, index) {
      var effect = trigger.effect && trigger.effect[0];
      return effect && effect.type === 'triggerlua' && String(effect.code || '').trim()
        ? { code: effect.code, id: String(trigger.id || index), lowLevelAccess: false }
        : null;
    })
    .filter(Boolean);
}
async function risuLuaRpc(context, call) {
  context.assertLive();
  if (call.signal && call.signal.aborted) throw risuAbortError();
  if (call.scope.roleId !== context.char.id || call.scope.sessionId !== context.session.id) throw risuAbortError();
  var args = call.args,
    result;
  if (context.preview && call.method === 'request')
    return JSON.stringify({ status: 0, data: context.previewSkipped('Lua 网络请求') });
  if (context.preview && call.method === 'alertConfirm') {
    context.previewSkipped('Lua 确认弹窗');
    return false;
  }
  switch (call.method) {
    case 'getTokens':
      result = estTokens(String(args[0] == null ? '' : args[0]));
      break;
    case 'alertError':
    case 'alertNormal':
      result = await context.alert(args[0]);
      break;
    case 'alertInput':
      result = await context.alertInput(args[0]);
      break;
    case 'alertSelect':
      result = await context.alertSelect(args[0]);
      break;
    case 'alertConfirm':
      result = window.confirm(String(args[0]));
      break;
    case 'simpleLLM':
      try {
        result = {
          success: true,
          result: await context.runLLM(
            [{ role: 'user', content: String(args[0] == null ? '' : args[0]) }],
            null,
            call.signal
          ),
        };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        result = { success: false, result: 'Error: ' + String(error.message) };
      }
      break;
    case 'LLMMain':
    case 'axLLMMain': {
      var rows = JSON.parse(args[0]).map(function (row) {
        return {
          role: row.role === 'user' ? 'user' : ['sys', 'system'].includes(row.role) ? 'system' : 'assistant',
          content: String(row.content || ''),
        };
      });
      try {
        if (args[1]) rows = await risuLuaMultimodalRows(context, rows, call.signal);
        result = JSON.stringify({
          success: true,
          result: await context.runLLM(
            rows,
            Object.assign({}, args[2] ? JSON.parse(args[2]) : {}, {
              model: call.method === 'axLLMMain' ? 'submodel' : 'model',
            }),
            call.signal
          ),
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        result = JSON.stringify({ success: false, result: String(error.message) });
      }
      break;
    }
    case 'generateImage':
      result = (await context.runImage(args[0], args[1], { signal: call.signal })) || 'Error: Image generation failed';
      break;
    case 'getCharacterImage':
    case 'getPersonaImage': {
      var inlays = await risuImageInlayContext(context.char, undefined, null, []),
        kind = call.method === 'getCharacterImage' ? 'char' : 'user',
        item = kind === 'char' ? context.char : getActivePersona(context.char.id);
      result = inlays[kind] ? risuImageInlayToken(kind, item, 'avatar_image') : '';
      break;
    }
    case 'loadLoreBooksMain': {
      var pending = args[1] || {},
        view = risuExecutionSessionView(context),
        loreState = createRisuMacroState(context.characterSnapshot, view, { random: context.state.random });
      view.risu.localLore = pending.lore || view.risu.localLore;
      Object.keys(pending.vars || {}).forEach(function (key) {
        loreState.vars['$' + key] = String(pending.vars[key]);
      });
      loreState.messages = ((pending.chat && pending.chat.message) || context.messages).map(function (row) {
        return { role: row.role === 'char' ? 'assistant' : row.role, content: row.data };
      });
      result = JSON.stringify(
        await risuLorebookCreateTransaction(context.characterSnapshot, view).loadActive(
          args[0],
          Number(D.settings.maxContextTokens) || Infinity,
          {
            messages: (pending.chat && pending.chat.message) || context.messages,
            macroState: loreState,
            signal: call.signal,
          }
        )
      );
      break;
    }
    case 'request': {
      var url = new URL(String(args[0]));
      if (url.protocol !== 'https:') throw new Error('Risu request 仅支持 HTTPS');
      var response = await fetch(url.href, { signal: call.signal });
      result = JSON.stringify({ status: response.status, data: await response.text() });
      break;
    }
    case 'hash': {
      var bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(args[0])));
      result = Array.from(new Uint8Array(bytes), function (value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
      break;
    }
    default:
      throw new Error('Risu 宿主能力尚未接入：' + call.method);
  }
  context.assertLive();
  if (call.signal && call.signal.aborted) throw risuAbortError();
  return result;
}
function risuLuaMultimodalRows(context, rows, signal) {
  var imageAssets = new Set();
  return risuLuaMultimodalRowsWithImages(context, rows, signal, imageAssets).finally(function () {
    releaseStoredImageDisplayReads(imageAssets);
  });
}
async function risuLuaMultimodalRowsWithImages(context, rows, signal, imageAssets) {
  // 先找出要转成多模态 part 的 inlay，只读入这些图片。
  var plans = rows.map(function (row) {
      var ids = [],
        text = row.content.replace(/\{\{(inlay|inlayed|inlayeddata)::(.+?)\}\}/g, function (_all, type, id) {
          if (row.role !== 'assistant' || type === 'inlayeddata') ids.push(id);
          return '';
        });
      return { row: row, ids: ids, text: text };
    }),
    inlayMap = await risuImageInlayContext(
      context.char,
      context.session,
      context.stagedInlays,
      plans.flatMap(function (plan) {
        return plan.ids;
      }),
      function () {
        context.assertLive();
        if ((signal && signal.aborted) || (context.signal && context.signal.aborted)) throw risuAbortError();
        return true;
      },
      imageAssets
    ),
    result = [];
  for (var plan of plans) {
    var row = plan.row,
      ids = plan.ids,
      text = plan.text,
      parts = [{ type: 'text', text: text }];
    for (var id of ids) {
      var inlay = inlayMap[id];
      if (!inlay) throw new Error('卡片引用的 inlay 图片不存在：' + id);
      var response = await fetch(inlay.url, { signal: signal || context.signal }),
        blob = await response.blob();
      var dataUrl = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      context.assertLive();
      parts.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    result.push(Object.assign({}, row, { content: ids.length ? parts : text }));
  }
  return result;
}
async function risuExecuteLua(context, code, mode, extra) {
  extra = extra || {};
  if (!String(code || '').trim()) return { messages: context.messages, stopSending: false };
  var previewOptions = context.previewOptions || {},
    owners = context.preview
      ? previewOptions.previewLuaOwners || (previewOptions.previewLuaOwners = new Map())
      : _risuLuaSessions,
    owner = owners.get(context.session);
  // Lua globals live inside the session's running engine and cannot be copied, so a preview starts from a new
  // engine. That only differs from the send once earlier real runs have left globals behind.
  if (context.preview && !owner && _risuLuaSessions.has(context.session) && previewOptions.previewNotes) {
    var luaNote = '卡片 Lua 脚本在预览中从全新环境运行，不带此前运行留下的 Lua 全局变量；依赖它们的内容发送时可能不同。';
    if (!previewOptions.previewNotes.includes(luaNote)) previewOptions.previewNotes.push(luaNote);
  }
  if (context.preview && typeof generationPromptNoteScriptRan === 'function')
    generationPromptNoteScriptRan(previewOptions.previewNotes);
  if (!owner) {
    owner = { context: null, runtime: null };
    owner.runtime = YeyuRisuLua.createRuntime({
      defaultTimeoutMs: 30000,
      rpc: function (call) {
        if (!owner.context) throw risuAbortError();
        return risuLuaRpc(owner.context, call);
      },
    });
    owners.set(context.session, owner);
  }
  owner.context = context;
  var vars = {};
  Object.keys(context.state.vars).forEach(function (key) {
    vars[key.slice(1)] = context.state.vars[key];
  });
  Object.assign(vars, extra.localVariables || {});
  var defaults = risuDefaultVariables(context.char),
    persona = (typeof getActivePersona === 'function' && getActivePersona(context.char.id)) || {},
    source = risuCardSources(context.characterSnapshot),
    result;
  try {
    risuRefreshMacroMessages(context);
    result = await owner.runtime.run({
      scope: { roleId: context.char.id, sessionId: context.session.id, scriptId: String(extra.scriptId || 'trigger') },
      mode: mode,
      code: code,
      data: extra.data,
      meta: extra.meta || {},
      signal: context.signal,
      lowLevelAccess: extra.lowLevelAccess === true,
      state: {
        chat: { message: extra.messages || context.messages, note: context.getAuthorNote() },
        loreAvailable: true,
        lore: context.lore.getLocalLorebooks(),
        globalLore: context.lore.getGlobalLorebooks(),
        backgroundWritable: true,
        vars: vars,
        globalVars: context.state.globalVars,
        defaultVariables: Object.keys(defaults).map(function (key) {
          return [key, defaults[key]];
        }),
        character: {
          name: context.characterSnapshot.name,
          desc: context.getCharacterDescription(),
          firstMessage: context.characterSnapshot.first_mes || '',
          backgroundHTML: source.card.backgroundHTML || '',
        },
        persona: { name: persona.name || '用户', prompt: context.getPersonaDescription() },
        cbsContext: risuSnapshotCBS(context.characterSnapshot, risuExecutionSessionView(context), context.state, {}),
      },
    });
    context.assertLive();
    for (var key of Object.keys(result.changed.vars || {})) {
      if (extra.setVar) await extra.setVar(key, result.state.vars[key]);
      else context.setVar(key, result.state.vars[key]);
    }
    if (result.changed.chat) context.messages = result.state.chat.message;
    var character = result.changed.character || {},
      values = {};
    if (Object.prototype.hasOwnProperty.call(character, 'name')) values.name = character.name;
    if (Object.prototype.hasOwnProperty.call(character, 'desc')) values.description = character.desc;
    if (Object.prototype.hasOwnProperty.call(character, 'firstMessage')) values.first_mes = character.firstMessage;
    if (Object.keys(values).length) context.patchCharacter(values);
    if ((result.signals || []).length)
      context.requestRefresh(
        result.signals.some(function (signal) {
          return signal && signal.kind === 'reloadDisplay';
        })
      );
    if (result.changed.note) context.setAuthorNote(result.state.chat.note);
    if (Object.prototype.hasOwnProperty.call(character, 'backgroundHTML')) {
      var extensions = Object.assign({}, context.characterSnapshot.extensions || {});
      extensions.risuai = Object.assign({}, extensions.risuai || {}, { backgroundHTML: character.backgroundHTML });
      context.patchCharacter({ extensions: extensions });
    }
    if (result.changed.lore) context.lore.setLocalLorebooks(result.state.lore);
    return {
      messages: result.changed.chat ? result.state.chat.message : extra.messages || context.messages,
      stopSending: result.stopSending,
      result: result.result,
    };
  } finally {
    owner.context = null;
  }
}
function risuReleasePromptPreview(options) {
  if (!options || !options.previewLuaOwners) return;
  options.previewLuaOwners.forEach(function (owner) {
    owner.context = null;
    owner.runtime.dispose();
  });
  options.previewLuaOwners.clear();
}
async function risuRunLuaHooks(context, mode, text, options) {
  if (mode === 'editprocess') return text;
  for (var entry of risuLuaEntries(context.char)) {
    var result = await risuExecuteLua(context, entry.code, mode, {
      scriptId: entry.id,
      lowLevelAccess: entry.lowLevelAccess,
      data: text,
      meta: { index: options.chatIndex },
    });
    if (result.result != null) text = mode === 'editRequest' ? result.result : String(result.result);
    if (result.stopSending) throw risuAbortError();
  }
  return text;
}
// A regex pass whose mode has no script only renders the text's CBS, and text without CBS syntax
// (a macro, or a `<user>`-style tag the parser turns into one) renders as itself.
function risuRegexPassNeedsWorker(scripts, mode, text) {
  return (
    YeyuRisuCBS.hasMacros(text) ||
    scripts.some(function (script) {
      return script && script.type === mode && script.in !== '';
    })
  );
}
function risuApplyRegexEffects(context, effects) {
  for (var effect of effects || []) {
    if (effect.type === 'setChatVariable') context.setVar(effect.name, effect.value);
    else if (effect.type === 'inject' && context.messages[effect.chatIndex])
      context.messages[effect.chatIndex].data = effect.data;
    else if (effect.type === 'emotion') (context.emotionEffects || (context.emotionEffects = [])).push(effect);
  }
}
async function risuRunRegex(context, text, mode, options) {
  var scripts = risuCardSources(context.char).regex;
  if (!risuRegexPassNeedsWorker(scripts, mode, text))
    return { data: String(text), template: String(text), effects: [], diagnostics: [] };
  risuRefreshMacroMessages(context);
  var index = options.chatIndex == null ? -1 : options.chatIndex,
    role = options.role === 'assistant' ? 'char' : options.role,
    previous = context.char.first_mes || '';
  for (var i = Math.min(index - 1, context.messages.length - 1); i >= 0; i--) {
    if (context.messages[i].role === role) {
      previous = context.messages[i].data;
      break;
    }
  }
  var result = await YeyuRisuRegexRuntime.run({
    data: text,
    scripts: scripts,
    mode: mode,
    context: {
      chatIndex: index,
      previousSameRole: previous,
      emotions: (context.state.assetContext && context.state.assetContext.emotions) || [],
    },
    cbsContext: risuSnapshotCBS(
      context.characterSnapshot,
      risuExecutionSessionView(context),
      context.state,
      Object.assign({}, options, {
        mode: mode,
        rmVar: mode === 'editdisplay' || mode === 'editprocess',
        trackHistory: !!options.history,
      })
    ),
    signal: context.signal,
  });
  context.assertLive();
  if (result.stopped) throw risuAbortError();
  risuApplyRegexEffects(context, result.effects);
  return result;
}
// A failed row of a batched regex request, as the single request for that row would have failed.
function risuRegexRowFailure(result) {
  if (!result || !result.error) return risuAbortError();
  var detail = result.error;
  return new YeyuRisuRegexRuntime.Error(
    detail.code === 'RISU_REGEX_TIMEOUT' ? detail.code : 'RISU_REGEX_EXECUTION',
    detail.message,
    detail
  );
}
// Many rows of one mode in one Worker request, equivalent to risuRunRegex on each row in order: the
// Worker applies each row's variable writes and injections before the next row, and the same
// effects then reach this transaction in the same order. Row failures follow risuProcessScriptRows.
async function risuRunRegexRows(context, rows, mode, onRowError) {
  var scripts = risuCardSources(context.char).regex,
    results = rows.map(function (row) {
      return risuRegexPassNeedsWorker(scripts, mode, row.text)
        ? null
        : { data: String(row.text), effects: [], diagnostics: [] };
    }),
    pending = [];
  results.forEach(function (result, index) {
    if (!result) pending.push(index);
  });
  if (pending.length) {
    risuRefreshMacroMessages(context);
    var view = risuExecutionSessionView(context),
      computed = await YeyuRisuRegexRuntime.runBatch({
        rows: pending.map(function (index) {
          var options = rows[index].options || {};
          return {
            data: String(rows[index].text),
            chatIndex: options.chatIndex == null ? -1 : options.chatIndex,
            position: risuCBSPosition(context.characterSnapshot, view, options),
          };
        }),
        scripts: scripts,
        mode: mode,
        firstMessage: context.char.first_mes || '',
        emotions: (context.state.assetContext && context.state.assetContext.emotions) || [],
        cbsContext: risuSnapshotCBS(context.characterSnapshot, view, context.state, {
          mode: mode,
          rmVar: mode === 'editdisplay' || mode === 'editprocess',
          trackHistory: rows.some(function (row) { return !!(row.options && row.options.history); }),
        }),
        // Without row isolation the first failure fails the pass, so rows after a timeout are not worth
        // running.
        stopAtTimeout: !onRowError,
        signal: context.signal,
      });
    context.assertLive();
    computed.forEach(function (result, offset) {
      results[pending[offset]] = result;
    });
  }
  return results.map(function (result, index) {
    if (!result || result.error || result.stopped) {
      var failure = risuRegexRowFailure(result);
      if (!onRowError) throw failure;
      onRowError(index, failure);
      return undefined;
    }
    risuApplyRegexEffects(context, result.effects);
    (result.diagnostics || []).forEach(function (error) {
      context.diagnostic(error);
    });
    if (rows[index].options && rows[index].options.history) {
      rows[index].options.history.template = result.template;
      rows[index].options.history.input = result.inputHistory;
    }
    return result.data;
  });
}
