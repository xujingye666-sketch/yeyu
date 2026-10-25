// ===== JS-Slash-Runner 4.11.3 host write contract =====
// This module owns the shared persistence and lifecycle boundary for stage-3 helper APIs.
function hostWriteOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}
function hostWriteSafeKey(key) {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
}
function hostWriteStringHash(value) {
  var text = String(value),
    h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function hostWriteMerge(base, patch, arrayMode) {
  if (Array.isArray(patch)) return arrayMode === 'preserve' && Array.isArray(base) ? cloneData(base) : cloneData(patch);
  if (!objectRecord(patch)) return cloneData(patch);
  var out = objectRecord(base) ? cloneData(base) : {};
  Object.keys(patch).forEach(function (key) {
    if (hostWriteSafeKey(key)) out[key] = hostWriteMerge(out[key], patch[key], arrayMode);
  });
  return out;
}
function hostWriteCharacter(value, current) {
  if (!D || !Array.isArray(D.characters)) return null;
  if (value == null || value === '' || value === 'current') return current || null;
  var wanted = String(value);
  return (
    D.characters.find(function (row) {
      return (
        row &&
        (String(row.id || '') === wanted ||
          String(row.id || '') + '.png' === wanted ||
          String(row.name || '') === wanted ||
          (typeof canonicalCharacterName === 'function' && String(canonicalCharacterName(row)) === wanted))
      );
    }) || null
  );
}
function hostWriteExtensionContainer(extensions, create) {
  var ext = objectRecord(extensions);
  if (!ext) return null;
  var helper = ext.tavern_helper;
  if (objectRecord(helper)) return { kind: 'object', owner: helper };
  if (Array.isArray(helper)) {
    var pairs = helper,
      variables = pairs.find(function (row) {
        return Array.isArray(row) && row[0] === 'variables';
      }),
      scripts = pairs.find(function (row) {
        return Array.isArray(row) && row[0] === 'scripts';
      });
    return { kind: 'pairs', owner: pairs, variables: variables, scripts: scripts };
  }
  if (!create) return null;
  ext.tavern_helper = { scripts: [], variables: {} };
  return { kind: 'object', owner: ext.tavern_helper };
}
function hostWriteContainerVariables(container, create) {
  if (!container) return null;
  if (container.kind === 'object') {
    if (create && !objectRecord(container.owner.variables)) container.owner.variables = {};
    return objectRecord(container.owner.variables);
  }
  if (!container.variables && create) {
    container.variables = ['variables', {}];
    container.owner.push(container.variables);
  }
  if (container.variables && create && !objectRecord(container.variables[1])) container.variables[1] = {};
  return container.variables && objectRecord(container.variables[1]);
}
function hostWritePresetRaw(name, create) {
  var wanted = String(name || 'in_use');
  if (wanted === 'in_use')
    return objectRecord(create ? completionPresetHostWritableRaw(wanted) : activeCompletionPresetRaw());
  var row = typeof presetNamedRow === 'function' ? presetNamedRow(wanted) : null;
  return row && objectRecord(row.preset);
}
function hostWritePresetExtensions(name, create) {
  var raw = hostWritePresetRaw(name, create);
  if (!raw) return null;
  if (create && !objectRecord(raw.extensions)) raw.extensions = {};
  return objectRecord(raw.extensions);
}

// Message variables are an official view of the active MVU candidate. Arbitrary helper keys live
// on that candidate too, so stat_data and helper data never diverge into parallel message stores.
function hostWriteMessageCandidates(message, char, create) {
  if (!message) return [];
  var choices =
      typeof mvuCandidateTexts === 'function'
        ? mvuCandidateTexts(message)
        : {
            texts: Array.isArray(message.swipes) ? message.swipes : [String(message.content || '')],
            active: Math.max(0, Number(message.swipeId) || 0),
          },
    envelope = objectRecord(message.yeyuMvu);
  if (!envelope && create) {
    envelope = {
      version: typeof MVU_STATE_VERSION !== 'undefined' ? MVU_STATE_VERSION : 1,
      schemaSignature: typeof mvuSchemaScriptSignature === 'function' ? mvuSchemaScriptSignature(char) : 'resident',
      activeIndex: choices.active,
      candidates: [],
    };
    message.yeyuMvu = envelope;
  }
  if (!envelope) return [];
  if (!Array.isArray(envelope.candidates)) {
    if (!create) return [];
    envelope.candidates = [];
  }
  if (create)
    for (var index = envelope.candidates.length; index < choices.texts.length; index++)
      envelope.candidates.push({
        sourceHash: typeof mvuHash === 'function' ? mvuHash(choices.texts[index]) : '',
        state: {},
        error: '',
        updates: 0,
      });
  return envelope.candidates;
}
function cardFrontendHostMessageData(message, swipeIndex, char) {
  var candidates = hostWriteMessageCandidates(message, char, false),
    index =
      swipeIndex == null
        ? messageActiveSwipeIndex(message || {})
        : Math.max(0, Math.floor(Number(swipeIndex) || 0)),
    candidate = objectRecord(candidates[index]);
  if (!candidate) return {};
  var data = objectRecord(candidate.variables) ? cloneData(candidate.variables) : {};
  ['stat_data', 'schema', 'display_data', 'delta_data'].forEach(function (key) {
    delete data[key];
  });
  if (objectRecord(candidate.state)) data.stat_data = cloneData(candidate.state);
  if (objectRecord(candidate.schema)) data.schema = cloneData(candidate.schema);
  if (objectRecord(candidate.display)) data.display_data = cloneData(candidate.display);
  if (objectRecord(candidate.delta)) data.delta_data = cloneData(candidate.delta);
  return data;
}
function hostWriteSetMessageData(message, swipeIndex, value, char) {
  var candidates = hostWriteMessageCandidates(message, char, true),
    index = Math.max(0, Math.floor(Number(swipeIndex) || 0));
  while (candidates.length <= index) candidates.push({ sourceHash: '', state: {}, error: '', updates: 0 });
  var candidate = objectRecord(candidates[index]) || {},
    data = cloneData(objectRecord(value) || {});
  candidates[index] = candidate;
  ['stat_data', 'schema', 'display_data', 'delta_data'].forEach(function (key) {
    delete data[key];
  });
  candidate.variables = data;
  if (objectRecord(value && value.stat_data)) candidate.state = cloneData(value.stat_data);
  else delete candidate.state;
  if (objectRecord(value && value.schema)) candidate.schema = cloneData(value.schema);
  else delete candidate.schema;
  if (objectRecord(value && value.display_data)) candidate.display = cloneData(value.display_data);
  else delete candidate.display;
  if (objectRecord(value && value.delta_data)) candidate.delta = cloneData(value.delta_data);
  else delete candidate.delta;
  return candidate;
}
// 夜欲图片（message.images / swipeImages）在脚本视图里只读投影进该候选的 extra.media，投影项带 yeyu_image_id；
// 写回 extra 时剔除这些项，所以原样写回或写 media: [] 都不会把投影存进 extra，也删不掉夜欲图片。
function hostWriteImageExtraView(message, swipeIndex, extra) {
  var entries = typeof messageCandidateImages === 'function' ? messageCandidateImages(message, swipeIndex) : [];
  if (!entries.length || typeof storedImageMediaView !== 'function') return extra;
  extra.media = (Array.isArray(extra.media) ? extra.media : []).concat(storedImageMediaView(entries));
  return extra;
}
// 卡片写回的 extra.media 剔除夜欲投影项后以剩下的为准：卡片删掉 ST 自己的媒体项即真的删掉，剩空数组就写空数组。
// 只有卡片写回的全是投影项、而原 extra 本来没有 media 时（原样写回投影视图），才不新增 media 键。
function hostWriteWithoutImageMedia(extra, previousExtra) {
  if (!extra || !Array.isArray(extra.media) || !extra.media.length) return extra;
  var media = extra.media.filter(function (item) {
    return !(objectRecord(item) && hostWriteOwn(item, 'yeyu_image_id'));
  });
  if (media.length || (previousExtra && Array.isArray(previousExtra.media))) extra.media = media;
  else delete extra.media;
  return extra;
}
function hostWriteMessageInfo(message, swipeIndex) {
  var rows = message && Array.isArray(message.tavernHelperSwipeInfo) ? message.tavernHelperSwipeInfo : [],
    index = Math.max(0, Math.floor(Number(swipeIndex) || 0));
  return hostWriteImageExtraView(
    message,
    index,
    cloneData(
      objectRecord(rows[index]) ||
        (index === messageActiveSwipeIndex(message || {}) &&
          objectRecord(message && message.extra)) ||
        {}
    )
  );
}
function hostWriteMessageRow(char, message, index, includeSwipes) {
  var role = ['system', 'user', 'assistant'].includes(String((message && message.role) || ''))
      ? String(message.role)
      : 'assistant',
    swipes =
      Array.isArray(message && message.swipes) && message.swipes.length
        ? message.swipes.map(String)
        : [String((message && message.content) || '')],
    active = Math.min(swipes.length - 1, messageActiveSwipeIndex(message || {})),
    name =
      String((message && message.name) || '') ||
      (role === 'user'
        ? typeof displayName === 'function'
          ? displayName('user')
          : 'User'
        : role === 'system'
          ? 'system'
          : typeof canonicalCharacterName === 'function'
            ? canonicalCharacterName(char)
            : String((char && char.name) || ''));
  var data = swipes.map(function (_, swipe) {
      return cardFrontendHostMessageData(message, swipe, char);
    }),
    info = swipes.map(function (_, swipe) {
      return hostWriteMessageInfo(message, swipe);
    });
  if (includeSwipes)
    return {
      message_id: index,
      name: name,
      role: role,
      is_hidden: message && message.hidden === true,
      swipe_id: active,
      swipes: swipes,
      swipes_data: data,
      swipes_info: info,
    };
  return {
    message_id: index,
    name: name,
    role: role,
    is_hidden: message && message.hidden === true,
    message: swipes[active],
    data: data[active] || {},
    extra: info[active] || {},
    swipe_id: active,
    swipes: swipes,
    swipes_data: data,
  };
}
function hostWriteNormalizeIndex(value, length, allowEnd) {
  if (value === 'end') return length;
  var number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return null;
  if (number < 0) number = length + number;
  return Math.max(0, Math.min(allowEnd ? length : length - 1, number));
}
function hostWriteMessageTargetIndex(value, length) {
  var number = Number(value);
  if (!Number.isInteger(number)) return null;
  if (number < 0) number = length + number;
  return number >= 0 && number < length ? number : null;
}
// TavernHelper string_to_range: only `n` or `a-b` (optionally negative) name messages; anything else,
// including an empty string or a decimal, selects nothing.
function hostWriteMessageIndexes(range, length) {
  if (length <= 0) return [];
  var text = String(range == null ? '' : range),
    single = /^(-?\d+)$/.exec(text),
    match = single ? [text, single[1], single[1]] : /^(-?\d+)-(-?\d+)$/.exec(text),
    values = [];
  if (!match) return [];
  var from = hostWriteNormalizeIndex(match[1], length, false),
    to = hostWriteNormalizeIndex(match[2], length, false);
  if (from > to) {
    var swap = from;
    from = to;
    to = swap;
  }
  for (var at = from; at <= to; at++) values.push(at);
  return values;
}
function hostWriteGetChatMessages(char, session, args) {
  var option = objectRecord(args && args.option) || {},
    role = String(option.role || 'all'),
    hide = String(option.hide_state || 'all'),
    rows = session && Array.isArray(session.msgs) ? session.msgs : [];
  if (!['all', 'system', 'assistant', 'user'].includes(role) || !['all', 'hidden', 'unhidden'].includes(hide))
    return [];
  var range = args && args.range;
  if (typeof replaceCharacterMacros === 'function') {
    var state = typeof createCharacterMacroState === 'function' ? createCharacterMacroState() : {};
    if (typeof bindCharacterMacroSession === 'function')
      state = bindCharacterMacroSession(state, session, { commit: false });
    state.messages = rows;
    range = replaceCharacterMacros(
      String(range == null ? '' : range),
      char,
      typeof displayName === 'function' ? displayName('user') : '用户',
      state
    );
  }
  return hostWriteMessageIndexes(range, rows.length)
    .map(function (index) {
      return hostWriteMessageRow(char, rows[index], index, option.include_swipes === true);
    })
    .filter(function (row) {
      return (role === 'all' || row.role === role) && (hide === 'all' || (hide === 'hidden') === row.is_hidden);
    });
}
function hostWriteMessageExtra(message, value) {
  var extra = hostWriteWithoutImageMedia(cloneData(objectRecord(value) || {}), message.extra);
  if (!hostWriteOwn(extra, 'media') && message.extra && Array.isArray(message.extra.media))
    extra.media = cloneData(message.extra.media);
  return extra;
}
function hostWriteApplyMessagePatch(message, patch, char) {
  if (hostWriteOwn(patch, 'name')) message.name = String(patch.name || '');
  if (hostWriteOwn(patch, 'role'))
    message.role = ['system', 'user', 'assistant'].includes(String(patch.role)) ? String(patch.role) : message.role;
  if (hostWriteOwn(patch, 'is_hidden')) message.hidden = patch.is_hidden === true;
  var current = messageActiveSwipeIndex(message),
    compact = hostWriteOwn(patch, 'message') || hostWriteOwn(patch, 'data');
  if (hostWriteOwn(patch, 'message')) {
    if (
      String(patch.message == null ? '' : patch.message) !== messageUntranslatedContent(message) &&
      typeof invalidateMessageImageCandidate === 'function'
    )
      invalidateMessageImageCandidate(message, current);
    message.content = String(patch.message == null ? '' : patch.message);
    if (Array.isArray(message.swipes) && current < message.swipes.length) message.swipes[current] = message.content;
  }
  if (hostWriteOwn(patch, 'data')) hostWriteSetMessageData(message, current, patch.data, char);
  if (compact && hostWriteOwn(patch, 'extra')) {
    message.extra = hostWriteMessageExtra(message, patch.extra);
    if (!Array.isArray(message.tavernHelperSwipeInfo)) message.tavernHelperSwipeInfo = [];
    message.tavernHelperSwipeInfo[current] = cloneData(message.extra);
  }
  var hasSwipe =
    !compact &&
    ['swipe_id', 'swipes', 'swipes_data', 'swipes_info'].some(function (key) {
      return hostWriteOwn(patch, key);
    });
  if (hasSwipe) {
    var explicitSwipes = Array.isArray(patch.swipes),
      max = Math.max(
        1,
        explicitSwipes ? patch.swipes.length : Array.isArray(message.swipes) ? message.swipes.length : 0,
        Array.isArray(patch.swipes_data) ? patch.swipes_data.length : 0,
        Array.isArray(patch.swipes_info) ? patch.swipes_info.length : 0
      ),
      next = Math.max(
        0,
        Math.min(max - 1, Math.floor(Number(hostWriteOwn(patch, 'swipe_id') ? patch.swipe_id : current)) || 0)
      );
    // Moving the selection off a translated candidate reverts it like messageSwipeSetActive does, so the
    // candidate left behind keeps its original and a later 恢复原文 cannot copy it onto the new one.
    // Openings are reverted by hostWriteSyncOpeningSelection, which knows their openingIndex fallback.
    if (next !== current && message.opening !== true) messageRevertTranslation(message);
    messageSwipeStashActive(message);
    var oldSwipes =
        Array.isArray(message.swipes) && message.swipes.length
          ? message.swipes.slice()
          : [String(message.content || '')],
      oldData = oldSwipes.map(function (_, i) {
        return cardFrontendHostMessageData(message, i, char);
      }),
      oldInfo = oldSwipes.map(function (_, i) {
        return hostWriteMessageInfo(message, i);
      }),
      swipes = [],
      data = [],
      info = [];
    for (var i = 0; i < max; i++) {
      swipes[i] = String(Array.isArray(patch.swipes) && patch.swipes[i] != null ? patch.swipes[i] : oldSwipes[i] || '');
      data[i] = cloneData(
        Array.isArray(patch.swipes_data) && patch.swipes_data[i] != null ? patch.swipes_data[i] : oldData[i] || {}
      );
      info[i] = hostWriteMessageExtra(
        message,
        Array.isArray(patch.swipes_info) && patch.swipes_info[i] != null ? patch.swipes_info[i] : oldInfo[i] || {}
      );
    }
    current = next;
    if (explicitSwipes && typeof resetMessageImageCandidateIdentities === 'function')
      resetMessageImageCandidateIdentities(message);
    message.swipes = swipes;
    message.swipeId = current;
    message.content = swipes[current];
    message.tavernHelperSwipeInfo = info;
    message.extra = cloneData(info[current]);
    data.forEach(function (value, index) {
      hostWriteSetMessageData(message, index, value, char);
    });
    if (message.yeyuMvu) {
      message.yeyuMvu.activeIndex = current;
      if (Array.isArray(message.yeyuMvu.candidates)) message.yeyuMvu.candidates.length = max;
    }
    if (Array.isArray(message.swipeGenerationMeta)) message.swipeGenerationMeta.length = max;
    message.swipeReasoning.length = max;
    if (Array.isArray(message.swipeImages)) message.swipeImages.length = max;
    messageSwipeRestoreActive(message);
  }
}
async function hostWriteMessageTransaction(live, start, refresh, mutate, lifecycle) {
  var context = cardFrontendRequireCurrent(live),
    char = context.char,
    session = context.session,
    mutation = beginMessageMutation(char, session),
    affected = Math.max(0, Math.floor(Number(start) || 0)),
    oldRows = (session.msgs || []).slice(affected);
  try {
    oldRows.forEach(function (message) {
      var seq = Math.max(0, Math.floor(Number(message && message.seq) || 0));
      if (seq && typeof rollbackMemoryDependencies === 'function') rollbackMemoryDependencies(char.id, session, seq);
    });
    mutate(char, session, mutation);
    if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts(char.id, affected, true, session.id);
    await refreshMessageMutation(char, session, mutation);
    if (typeof saveData === 'function') await saveData('sessions', refresh === 'all' ? { urgent: true } : undefined);
  } catch (error) {
    mutation.rollback();
    if (typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, session.id);
    throw new Error('脚本消息写入失败，原对话已恢复：' + String((error && error.message) || error));
  }
  if (typeof markStreamDraftsStaleForSession === 'function')
    try {
      await markStreamDraftsStaleForSession(char.id, session.id, 'base_changed');
    } catch (error) {
      console.warn('流式草稿失效标记失败', error);
    }
  if (getChar() !== char || getActiveSession(char.id) !== session) return;
  if (refresh !== 'none' && typeof renderChat === 'function') {
    if (typeof releaseCardFrontendsForMessageRender === 'function')
      releaseCardFrontendsForMessageRender(
        char,
        refresh === 'all' ? 0 : affected,
        refresh === 'all' ? null : lifecycle && lifecycle.refreshMessageIndexes
      );
    renderChat();
  } else if (typeof refreshCardScriptLibraryContext === 'function') refreshCardScriptLibraryContext(char, session);
  if (typeof updateTokensBar === 'function') updateTokensBar(char);
  if (lifecycle && typeof lifecycle.afterRender === 'function') await lifecycle.afterRender();
}
function hostWriteIsOpeningCandidateHandoff(session, args) {
  var rows = (session && session.msgs) || [],
    index = hostWriteMessageTargetIndex(args && args.messageId, rows.length),
    message = index == null ? null : rows[index];
  if (!message || message.opening !== true || typeof (args && args.message) !== 'string') return false;
  var option = objectRecord(args && args.option) || {},
    target = Number(option.swipe_id),
    swipes = Array.isArray(message.swipes) ? message.swipes : [];
  // refresh 'none' 的约定是只写候选文本、不动选择，所以它永远走通用写入，不交给开场白切换入口。
  if (String(option.refresh || 'display_and_render_current') === 'none') return false;
  if (option.swipe_id == null || !Number.isInteger(target) || target < 0 || target >= swipes.length) return false;
  return args.message === String(swipes[target] == null ? '' : swipes[target]);
}
// The opening row mirrors its active candidate into message.openingIndex and session.openingIndex;
// a swipe write that skips the mirror leaves the greeting scope on the previous candidate. The
// mirror only copies the already-selected index, so the caller says whether the active candidate
// actually moved: only then is message.extra remapped to the new candidate's swipe info and the
// display flags (显示原文、续写基底、命运轮盘草稿) dropped, exactly like messageSwipeSetActive does;
// a write that never changed the selection keeps them. A translated greeting only holds its original
// in original_content, so the candidate the write moved away from gets that original back first,
// unless the write itself replaced that candidate (translation is the pre-write snapshot).
function hostWriteOpeningTranslation(message) {
  if (!message || message.opening !== true || typeof message.original_content !== 'string') return null;
  var active =
    message.swipeId == null && Number.isInteger(message.openingIndex) ? message.openingIndex : message.swipeId;
  return {
    index: Math.max(0, Math.floor(Number(active) || 0)),
    text: String(message.content || ''),
    original: message.original_content,
  };
}
function hostWriteSyncOpeningSelection(session, message, selectionChanged, translation) {
  if (!message || message.opening !== true) return;
  if (message.swipeId == null && Number.isInteger(message.openingIndex)) message.swipeId = message.openingIndex;
  var swipes = Array.isArray(message.swipes) ? message.swipes : [],
    active = messageActiveSwipeIndex(message);
  if (swipes.length) active = Math.min(active, swipes.length - 1);
  message.swipeId = active;
  message.openingIndex = active;
  if (session) session.openingIndex = active;
  if (!selectionChanged) return;
  if (translation && swipes[translation.index] === translation.text) swipes[translation.index] = translation.original;
  if (Array.isArray(message.tavernHelperSwipeInfo) && message.tavernHelperSwipeInfo[active])
    message.extra = hostWriteMessageExtra(message, message.tavernHelperSwipeInfo[active]);
  delete message.original_content;
  delete message.translated;
  delete message.restored;
  delete message.continueBase;
}
function hostWriteSetChatMessages(live, args) {
  var context = cardFrontendRequireCurrent(live),
    rows = context.session.msgs || [],
    updates = Array.isArray(args && args.updates) ? args.updates : [],
    merged = Object.create(null),
    affected = rows.length;
  updates.forEach(function (value) {
    var patch = objectRecord(value);
    if (!patch) return;
    var index = hostWriteMessageTargetIndex(patch.message_id, rows.length);
    if (index == null || !rows[index]) return;
    merged[index] = Object.assign(merged[index] || {}, cloneData(patch));
    affected = Math.min(affected, index);
  });
  if (!Object.keys(merged).length) return Promise.resolve();
  return hostWriteMessageTransaction(
    live,
    affected,
    String((args && args.option && args.option.refresh) || 'affected'),
    function (char, session, mutation) {
      Object.keys(merged).forEach(function (index) {
        var row = session.msgs[Number(index)],
          previousSwipe = row.swipeId,
          translation = hostWriteOpeningTranslation(row);
        mutation.capture(row);
        hostWriteApplyMessagePatch(row, merged[index], char);
        // A compact patch carrying message/data ignores swipe_id, so mirroring on the raw key alone
        // would rewrite the opening selection for a write that never moved it.
        if (row.swipeId !== previousSwipe) hostWriteSyncOpeningSelection(session, row, true, translation);
      });
    },
    {
      refreshMessageIndexes: Object.keys(merged).map(Number),
    }
  );
}
function hostWriteSetChatMessage(live, args) {
  var context = cardFrontendRequireCurrent(live),
    session = context.session,
    index = hostWriteMessageTargetIndex(args && args.messageId, session.msgs.length),
    message = index == null ? null : session.msgs[index];
  if (!message) return Promise.resolve();
  var option = objectRecord(args && args.option) || {},
    swipe =
      option.swipe_id === 'current' || option.swipe_id == null
        ? messageActiveSwipeIndex(message)
        : Math.max(0, Math.floor(Number(option.swipe_id) || 0)),
    fields =
      typeof (args && args.message) === 'string'
        ? { message: args.message }
        : objectRecord(args && args.message) || {},
    refresh = String(option.refresh || 'display_and_render_current');
  return hostWriteMessageTransaction(
    live,
    index,
    refresh === 'none' ? 'none' : refresh === 'all' ? 'all' : 'affected',
    function (char, session, mutation) {
      mutation.capture(message);
      // 候选可能在下面被补长；旧数据先按补长前的候选落成思考分格。
      messageSwipeAdoptReasoning(message);
      var translation = hostWriteOpeningTranslation(message),
        active = messageActiveSwipeIndex(message),
        previousActive = active,
        selectionChanged = refresh !== 'none' && swipe !== previousActive;
      if (selectionChanged && message.opening !== true) messageRevertTranslation(message);
      var swipes = Array.isArray(message.swipes) ? message.swipes : [String(message.content || '')];
      while (swipes.length <= swipe) swipes.push('');
      message.swipes = swipes;
      if (hostWriteOwn(fields, 'message')) {
        if (
          String(fields.message == null ? '' : fields.message) !== swipes[swipe] &&
          typeof invalidateMessageImageCandidate === 'function'
        )
          invalidateMessageImageCandidate(message, swipe);
        swipes[swipe] = String(fields.message == null ? '' : fields.message);
      }
      if (hostWriteOwn(fields, 'data')) hostWriteSetMessageData(message, swipe, fields.data, char);
      if (refresh !== 'none') {
        messageSwipeStashActive(message);
        message.swipeId = swipe;
        messageSwipeRestoreActive(message);
        active = swipe;
        if (message.yeyuMvu) message.yeyuMvu.activeIndex = swipe;
      }
      if (active === swipe) message.content = swipes[swipe];
      hostWriteSyncOpeningSelection(session, message, selectionChanged, translation);
    },
    { refreshMessageIndexes: [index] }
  );
}
function hostWriteCreateChatMessages(live, args) {
  var context = cardFrontendRequireCurrent(live),
    rows = context.session.msgs || [],
    option = objectRecord(args && args.option) || {},
    at = hostWriteOwn(option, 'insert_at')
      ? option.insert_at
      : hostWriteOwn(option, 'insert_before')
        ? option.insert_before
        : 'end',
    index = hostWriteNormalizeIndex(at, rows.length, true),
    incoming = Array.isArray(args && args.messages) ? args.messages : [],
    refresh = String(option.refresh || 'affected'),
    createdEvents = [];
  return hostWriteMessageTransaction(
    live,
    index,
    refresh,
    function (char, session, mutation) {
      var created = incoming.map(function (value, offset) {
        var row = objectRecord(value) || {},
          role = ['system', 'assistant', 'user'].includes(String(row.role)) ? String(row.role) : 'assistant',
          message = {
            role: role,
            content: String(row.message == null ? '' : row.message),
            time: Date.now(),
            seq: typeof allocateMessageSeq === 'function' ? allocateMessageSeq(session) : Date.now(),
            hidden: row.is_hidden === true,
          };
        if (hostWriteOwn(row, 'name')) message.name = String(row.name || '');
        if (objectRecord(row.extra)) message.extra = hostWriteWithoutImageMedia(cloneData(row.extra));
        if (objectRecord(row.data)) hostWriteSetMessageData(message, 0, row.data, char);
        if (typeof markMessageMacroEffects === 'function') markMessageMacroEffects(char, message);
        createdEvents.push({ role: role, index: index + offset });
        return message;
      });
      mutation.splice(session.msgs, index, 0, created);
    },
    {
      // TavernHelper announces created rows only when it redraws exactly those rows: 'none' leaves the
      // screen alone and 'all' reloads the whole chat, and neither emits message events.
      afterRender: async function () {
        if (refresh !== 'affected') return;
        for (var i = 0; i < createdEvents.length; i++) {
          var row = createdEvents[i],
            user = row.role === 'user';
          await cardFrontendAwaitBroadcastEvent(
            user ? CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SENT : CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_RECEIVED,
            [row.index, 'extension']
          );
          await cardFrontendAwaitBroadcastEvent(
            user
              ? CARD_FRONTEND_TAVERN_EVENT_VALUES.USER_MESSAGE_RENDERED
              : CARD_FRONTEND_TAVERN_EVENT_VALUES.CHARACTER_MESSAGE_RENDERED,
            [row.index]
          );
        }
      },
    }
  );
}
function hostWriteDeleteChatMessages(live, args) {
  var context = cardFrontendRequireCurrent(live),
    length = context.session.msgs.length,
    indexes = (Array.isArray(args && args.messageIds) ? args.messageIds : [])
      .map(function (value) {
        return hostWriteMessageTargetIndex(value, length);
      })
      .filter(function (value, at, all) {
        return value != null && all.indexOf(value) === at;
      })
      .sort(function (a, b) {
        return a - b;
      }),
    start = indexes.length ? indexes[0] : 0;
  if (!indexes.length) return Promise.resolve();
  return hostWriteMessageTransaction(
    live,
    start,
    String((args && args.option && args.option.refresh) || 'affected'),
    function (_, session, mutation) {
      for (var at = indexes.length - 1; at >= 0; at--) mutation.splice(session.msgs, indexes[at], 1);
    }
  );
}
function hostWriteRotateChatMessages(live, args) {
  var context = cardFrontendRequireCurrent(live),
    length = context.session.msgs.length,
    begin = hostWriteNormalizeIndex(args && args.begin, length, true),
    end = hostWriteNormalizeIndex(args && args.end, length, true);
  begin = begin == null ? 0 : begin;
  end = end == null ? length : end;
  var middle = hostWriteNormalizeIndex(args && args.middle, length, true);
  middle = Math.max(begin, Math.min(end, middle == null ? begin : middle));
  return hostWriteMessageTransaction(
    live,
    begin,
    String((args && args.option && args.option.refresh) || 'affected'),
    function (_, session, mutation) {
      var right = mutation.splice(session.msgs, middle, end - middle);
      mutation.splice(session.msgs, begin, 0, right);
    }
  );
}

function hostWriteVariableContext(live) {
  if (live) return cardFrontendRequireCurrent(live);
  var char = getChar(),
    session = char && getActiveSession(char.id);
  if (!char || !session) throw new Error('当前没有可编辑的角色或聊天');
  return { char: char, session: session };
}
function hostWriteVariableTarget(live, option, create) {
  option = objectRecord(option) || { type: 'chat' };
  var context = hostWriteVariableContext(live),
    char = context.char,
    session = context.session,
    type = String(option.type || 'chat'),
    owner,
    container,
    message,
    index,
    candidate;
  if (type === 'global') {
    if (!objectRecord(D.settings.stscript)) {
      if (!create) return { type: type, value: {}, section: 'meta' };
      D.settings.stscript = {};
    }
    if (create && !objectRecord(D.settings.stscript.globalVars)) D.settings.stscript.globalVars = {};
    return { type: type, value: objectRecord(D.settings.stscript.globalVars) || {}, section: 'meta' };
  }
  if (type === 'chat') {
    if (create && !objectRecord(session.stscriptVars)) session.stscriptVars = {};
    return { type: type, value: objectRecord(session.stscriptVars) || {}, section: 'sessions' };
  }
  if (type === 'character') {
    owner = hostWriteCharacter(option.name, char);
    if (!owner) throw new Error("未找到角色 '" + String(option.name || 'current') + "'");
    if (!objectRecord(owner.extensions)) {
      if (!create) return { type: type, value: {}, section: 'characters', owner: owner };
      owner.extensions = {};
    }
    container = hostWriteExtensionContainer(owner.extensions, create);
    return {
      type: type,
      value: hostWriteContainerVariables(container, create) || {},
      section: 'characters',
      owner: owner,
      container: container,
    };
  }
  if (type === 'preset') {
    var presetName = String(option.name || 'in_use'),
      extensions = hostWritePresetExtensions(presetName, create);
    if (!extensions) throw new Error("预设 '" + presetName + "' 不存在");
    container = hostWriteExtensionContainer(extensions, create);
    return {
      type: type,
      value: hostWriteContainerVariables(container, create) || {},
      section: 'meta',
      presetName: presetName,
      container: container,
    };
  }
  if (type === 'extension') {
    var id = String(option.extension_id || '');
    if (!id) throw new Error('extension 变量缺少 extension_id');
    if (create && !objectRecord(D.settings.tavernHelperExtensionSettings))
      D.settings.tavernHelperExtensionSettings = {};
    if (create && !objectRecord(D.settings.tavernHelperExtensionSettings[id]))
      D.settings.tavernHelperExtensionSettings[id] = {};
    return {
      type: type,
      value:
        objectRecord(D.settings.tavernHelperExtensionSettings && D.settings.tavernHelperExtensionSettings[id]) || {},
      section: 'meta',
      extensionId: id,
    };
  }
  if (type === 'message') {
    if (option.message_id == null || option.message_id === 'latest') {
      index = -1;
      for (var latest = session.msgs.length - 1; latest >= 0; latest--)
        if (session.msgs[latest] && session.msgs[latest].hidden !== true) {
          index = latest;
          break;
        }
    } else index = hostWriteMessageTargetIndex(option.message_id, session.msgs.length);
    message = index == null || index < 0 ? null : session.msgs[index];
    if (!message) throw new Error('找不到消息 ' + String(option.message_id));
    var swipe =
        option.swipe_id == null
          ? messageActiveSwipeIndex(message)
          : Math.floor(Number(option.swipe_id) || 0),
      swipeLength = Array.isArray(message.swipes) ? message.swipes.length : 1;
    if (swipe < 0) swipe = swipeLength + swipe;
    swipe = Math.max(0, swipe);
    return {
      type: type,
      value: cardFrontendHostMessageData(message, swipe, char),
      section: 'sessions',
      message: message,
      swipe: swipe,
      index: index,
    };
  }
  if (type === 'script') {
    var script = hostWriteFindScript(char, String(option.script_id || ''), String(option.script_scope || ''));
    if (!script) return { type: type, value: {}, section: '', missing: true };
    return { type: type, value: objectRecord(script.node.data) || {}, section: script.section, script: script };
  }
  throw new Error('不支持的变量作用域：' + type);
}
function hostWriteAssignVariableTarget(target, value) {
  value = cloneData(objectRecord(value) || {});
  if (target.type === 'global') D.settings.stscript.globalVars = value;
  else if (target.type === 'chat') target.session.stscriptVars = value;
  else if (target.type === 'character' || target.type === 'preset') {
    var vars = hostWriteContainerVariables(target.container, true);
    Object.keys(vars).forEach(function (key) {
      delete vars[key];
    });
    Object.assign(vars, value);
  } else if (target.type === 'extension') D.settings.tavernHelperExtensionSettings[target.extensionId] = value;
  else if (target.type === 'message') hostWriteSetMessageData(target.message, target.swipe, value, target.char);
  else if (target.type === 'script' && target.script) target.script.node.data = value;
}
function hostWriteGetVariables(live, option) {
  var target = hostWriteVariableTarget(live, option, false);
  return cloneData(target.value || {});
}
function hostWriteIsMvuDataReady(session) {
  var rows = Array.isArray(session && session.msgs) ? session.msgs : [];
  function hasData(message) {
    var envelope = objectRecord(message && message.yeyuMvu),
      swipe = messageActiveSwipeIndex(message || {}),
      candidate = envelope && Array.isArray(envelope.candidates) && envelope.candidates[swipe];
    // cardFrontendHostMessageData exposes stat_data exactly when this candidate has an object state.
    return !!objectRecord(candidate && candidate.state);
  }
  if (hasData(rows[0])) return true;
  for (var index = Math.max(1, rows.length - 10); index < rows.length; index++) if (hasData(rows[index])) return true;
  return false;
}
function hostWriteReplaceVariables(live, value, option) {
  var context = hostWriteVariableContext(live),
    target = hostWriteVariableTarget(live, option, true);
  target.live = live;
  target.char = context.char;
  target.session = context.session;
  hostWriteAssignVariableTarget(target, value);
  if (target.type === 'message' && typeof _mvuRuntime !== 'undefined') {
    var runtime = _mvuRuntime[String(context.char.id || '') + '|' + String(context.session.id || '')],
      candidate = hostWriteMessageCandidates(target.message, context.char, false)[target.swipe];
    if (runtime && target.index === context.session.msgs.length - 1)
      runtime.state = cloneData(objectRecord(candidate && candidate.state) || {});
    if (typeof renderMvuRuntimeStatus === 'function') renderMvuRuntimeStatus(context.char, context.session);
  }
  var globalScope =
      target.type === 'global' ||
      target.type === 'preset' ||
      target.type === 'extension' ||
      (target.type === 'script' && target.script && target.script.scope !== 'character'),
    cacheChanged =
      typeof invalidateCacheContexts === 'function' &&
      (globalScope
        ? invalidateCacheContexts()
        : invalidateCacheContexts(
            context.char.id,
            target.type === 'message' ? target.index : 0,
            true,
            context.session.id
          )),
    sections = target.section ? [target.section] : [];
  if (cacheChanged && !sections.includes('sessions')) sections.push('sessions');
  if (target.type === 'preset' && typeof completionPresetSaveHostWriteDebounced === 'function') {
    completionPresetSaveHostWriteDebounced(target.presetName);
    if (sections.includes('sessions') && typeof saveData === 'function')
      Promise.resolve(saveData('sessions')).catch(function (error) {
        cardFrontendSettingsSaveFailed(error, live);
      });
  } else if (sections.length && typeof saveData === 'function')
    Promise.resolve(saveData(sections.length === 1 ? sections[0] : sections)).catch(function (error) {
      cardFrontendSettingsSaveFailed(error, live);
    });
  if (typeof refreshCardScriptLibraryContext === 'function')
    refreshCardScriptLibraryContext(context.char, context.session, target.type !== 'message');
}
function hostWriteGetAllVariables(live, option) {
  var context = cardFrontendRequireCurrent(live),
    char = context.char,
    session = context.session,
    current =
      option && option.message_id == null
        ? Math.max(0, Number(live.owner && live.owner.messageIndex) || 0)
        : hostWriteNormalizeIndex(option.message_id, session.msgs.length, false),
    out = {};
  [
    hostWriteGetVariables(live, { type: 'global' }),
    hostWriteGetVariables(live, { type: 'character' }),
    hostWriteGetVariables(live, {
      type: 'script',
      script_id: option && option.script_id,
      script_scope: option && option.script_scope,
    }),
    hostWriteGetVariables(live, { type: 'chat' }),
  ].forEach(function (value) {
    out = hostWriteMerge(out, value);
  });
  if (!(option && option.script_id))
    for (var index = 0; index <= current && index < session.msgs.length; index++) {
      var message = session.msgs[index];
      if (!message) continue;
      out = hostWriteMerge(out, cardFrontendHostMessageData(message, Math.max(0, Number(message.swipeId) || 0), char));
    }
  return out;
}

function hostWriteWorldbookCategories() {
  return D && D.worldBook && Array.isArray(D.worldBook.categories) ? D.worldBook.categories : [];
}
function hostWriteWorldbookCategory(name, required) {
  var wanted = String(name == null ? '' : name),
    matches = hostWriteWorldbookCategories().filter(function (row) {
      return row && String(row.name || '') === wanted;
    });
  if (matches.length > 1) throw new Error("世界书名称 '" + wanted + "' 不唯一");
  if (required && matches.length === 0) throw new Error("未能找到世界书 '" + wanted + "'");
  return matches[0] || null;
}
function hostWriteWorldbookNames() {
  return hostWriteWorldbookCategories()
    .map(function (row) {
      return String((row && row.name) || '');
    })
    .filter(Boolean);
}
function hostWriteLorebookSettings() {
  var wb = D.worldBook || {},
    resolved =
      typeof worldBookSettings === 'function'
        ? worldBookSettings()
        : {
            scanDepth: 20,
            budgetPercent: 0,
            budgetCap: 0,
            minActivations: 0,
            minActivationsDepthMax: 0,
            maxRecursionSteps: 0,
            insertionStrategy: 'character_first',
            includeNames: true,
            recursive: false,
            caseSensitive: false,
            matchWholeWords: false,
            useGroupScoring: false,
          };
  return {
    selected_global_lorebooks: (wb.globalCategoryIds || [])
      .map(function (id) {
        var row = hostWriteWorldbookCategories().find(function (cat) {
          return String((cat && cat.id) || '') === String(id);
        });
        return row && String(row.name || '');
      })
      .filter(Boolean),
    scan_depth: resolved.scanDepth,
    context_percentage: resolved.budgetPercent,
    budget_cap: resolved.budgetCap,
    min_activations: resolved.minActivations,
    max_depth: resolved.minActivationsDepthMax,
    max_recursion_steps: resolved.maxRecursionSteps,
    insertion_strategy: resolved.insertionStrategy,
    include_names: resolved.includeNames,
    recursive: resolved.recursive,
    case_sensitive: resolved.caseSensitive,
    match_whole_words: resolved.matchWholeWords,
    use_group_scoring: resolved.useGroupScoring,
    overflow_alert: wb.overflow_alert === true,
  };
}
function hostWriteSetLorebookSettings(live, value) {
  var patch = objectRecord(value) || {},
    wb = D.worldBook || {},
    names = hostWriteWorldbookNames(),
    journal = createMutationJournal(),
    selectedIds = null;
  if (hostWriteOwn(patch, 'selected_global_lorebooks')) {
    var selected = Array.isArray(patch.selected_global_lorebooks) ? patch.selected_global_lorebooks.map(String) : [],
      missing = selected.filter(function (name) {
        return names.indexOf(name) < 0;
      });
    if (missing.length) throw new Error('未找到要全局启用的世界书：' + missing.join('、'));
    selectedIds = selected.map(function (name) {
      return hostWriteWorldbookCategory(name, true).id;
    });
  }
  var map = {
    scan_depth: 'scan_depth',
    context_percentage: 'budget_percent',
    budget_cap: 'token_budget',
    min_activations: 'min_activations',
    max_depth: 'min_activations_depth_max',
    max_recursion_steps: 'max_recursion_steps',
    insertion_strategy: 'insertion_strategy',
    include_names: 'include_names',
    recursive: 'recursive',
    case_sensitive: 'case_sensitive',
    match_whole_words: 'match_whole_words',
    use_group_scoring: 'use_group_scoring',
    overflow_alert: 'overflow_alert',
  };
  var fields = Object.keys(map)
    .filter(function (key) {
      return hostWriteOwn(patch, key);
    })
    .map(function (key) {
      return map[key];
    });
  if (selectedIds) fields.push('globalCategoryIds');
  journal.capture(wb, fields, true);
  if (selectedIds) {
    if (!Array.isArray(wb.globalCategoryIds)) wb.globalCategoryIds = [];
    journal.splice(wb.globalCategoryIds, 0, wb.globalCategoryIds.length, selectedIds);
  }
  Object.keys(map).forEach(function (key) {
    if (hostWriteOwn(patch, key)) wb[map[key]] = cloneData(patch[key]);
  });
  journal.seal();
  var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts();
  if (typeof saveData === 'function') {
    var saveFailed = function (error) {
      journal.rollback();
      if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts();
      cardFrontendSettingsSaveFailed(error, live);
    };
    try {
      Promise.resolve(saveData(sessionsChanged ? ['worldbook', 'sessions'] : 'worldbook')).catch(saveFailed);
    } catch (error) {
      saveFailed(error);
    }
  }
}
async function hostWriteRebindGlobalWorldbooks(names) {
  var journal = createMutationJournal(),
    wanted = (Array.isArray(names) ? names : []).map(String),
    missing = wanted.filter(function (name) {
      return !hostWriteWorldbookCategory(name, false);
    });
  if (missing.length) throw new Error('未找到要全局启用的世界书：' + missing.join('、'));
  if (!Array.isArray(D.worldBook.globalCategoryIds)) {
    journal.capture(D.worldBook, ['globalCategoryIds'], true);
    D.worldBook.globalCategoryIds = [];
  }
  journal.splice(
    D.worldBook.globalCategoryIds,
    0,
    D.worldBook.globalCategoryIds.length,
    wanted.map(function (name) {
      return hostWriteWorldbookCategory(name, true).id;
    })
  );
  journal.seal();
  var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts();
  try {
    await saveData(sessionsChanged ? ['worldbook', 'sessions'] : 'worldbook');
  } catch (error) {
    journal.rollback();
    throw error;
  }
}
function hostWriteCharLorebooks(char) {
  if (!char) return { primary: null, additional: [] };
  var extensions = objectRecord(char.extensions) || {},
    primary = String(extensions.world || '') || null,
    id = String(char.id || ''),
    additional = hostWriteWorldbookCategories()
      .filter(function (cat) {
        return (
          (Array.isArray(cat && cat.boundCharIds) ? cat.boundCharIds : []).map(String).includes(id) &&
          String(cat.name || '') !== primary
        );
      })
      .map(function (cat) {
        return String(cat.name || '');
      })
      .filter(Boolean);
  return { primary: primary, additional: additional };
}
async function hostWriteSetCharLorebooks(live, value, targetChar) {
  var context = cardFrontendRequireCurrent(live),
    char = targetChar || context.char,
    patch = objectRecord(value) || {},
    names = hostWriteWorldbookNames(),
    wanted = [];
  if (hostWriteOwn(patch, 'primary') && patch.primary) wanted.push(String(patch.primary));
  if (hostWriteOwn(patch, 'additional'))
    wanted = wanted.concat((Array.isArray(patch.additional) ? patch.additional : []).map(String));
  var missing = wanted.filter(function (name) {
    return names.indexOf(name) < 0;
  });
  if (missing.length) throw new Error('未找到要绑定的世界书：' + missing.join('、'));
  var journal = createMutationJournal();
  try {
    if (!objectRecord(char.extensions)) {
      journal.capture(char, ['extensions'], true);
      char.extensions = {};
    }
    journal.capture(char.extensions, ['world'], true);
    if (hostWriteOwn(patch, 'primary')) {
      if (patch.primary) char.extensions.world = String(patch.primary);
      else delete char.extensions.world;
    }
    if (hostWriteOwn(patch, 'additional')) {
      var ids = new Set(
        (patch.additional || []).map(function (name) {
          return String(hostWriteWorldbookCategory(name, true).id);
        })
      );
      hostWriteWorldbookCategories().forEach(function (cat) {
        if (!Array.isArray(cat.boundCharIds)) {
          journal.capture(cat, ['boundCharIds'], true);
          cat.boundCharIds = [];
        }
        for (var index = cat.boundCharIds.length - 1; index >= 0; index--) {
          if (String(cat.boundCharIds[index]) === String(char.id || '')) journal.splice(cat.boundCharIds, index, 1);
        }
        if (ids.has(String(cat.id)))
          journal.splice(cat.boundCharIds, cat.boundCharIds.length, 0, [String(char.id || '')]);
      });
    }
    journal.seal();
    var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts(char.id, 0, true);
    await saveData(sessionsChanged ? ['characters', 'worldbook', 'sessions'] : ['characters', 'worldbook']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
}
function hostWriteChatLorebook(session) {
  var name = String((session && session.tavernHelperChatLorebook) || '');
  return name && hostWriteWorldbookNames().includes(name) ? name : null;
}
async function hostWriteSetChatLorebook(live, name) {
  var context = cardFrontendRequireCurrent(live),
    session = context.session,
    journal = createMutationJournal();
  journal.capture(session, ['tavernHelperChatLorebook'], true);
  if (name == null || name === '') delete session.tavernHelperChatLorebook;
  else {
    hostWriteWorldbookCategory(name, true);
    session.tavernHelperChatLorebook = String(name);
  }
  journal.seal();
  if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts(context.char.id, 0, true, session.id);
  try {
    await saveData('sessions');
  } catch (error) {
    journal.rollback();
    throw error;
  }
}
function hostWriteReplaceRows(rows, entries, journal, key, update) {
  key =
    key ||
    function (row) {
      return String(row.id);
    };
  update =
    update ||
    function (old, entry) {
      return journal.replaceRecord(old, entry);
    };
  var next = entries.map(function (entry) {
    var old = rows.find(function (row) {
      return key(row) === key(entry);
    });
    return old ? update(old, entry) : entry;
  });
  for (var index = rows.length - 1; index >= 0; index--) {
    if (!next.includes(rows[index])) journal.splice(rows, index, 1);
  }
  next.forEach(function (entry, index) {
    if (rows[index] === entry) return;
    var current = rows.indexOf(entry);
    if (current >= 0) journal.splice(rows, current, 1);
    journal.splice(rows, index, 0, [entry]);
  });
}
function hostWriteReplaceWorldbookEntries(category, entries, journal) {
  if (!Array.isArray(category.entries)) {
    journal.capture(category, ['entries'], true);
    category.entries = [];
  }
  hostWriteReplaceRows(category.entries, entries, journal);
}
async function hostWriteCreateWorldbook(name, entries, replace, option) {
  var wanted = String(name || '').trim();
  if (!wanted) throw new Error('世界书名称不能为空');
  var existing = hostWriteWorldbookCategory(wanted, false);
  if (existing && !replace) return false;
  var journal = createMutationJournal(),
    category = existing || {
      id: 'cat_' + (typeof uid === 'function' ? uid() : Date.now().toString(36)),
      name: wanted,
      color: '#8b5cf6',
      entries: [],
      boundCharIds: [],
    },
    oldRows = cardFrontendWorldbookRows(category),
    used = new Set();
  try {
    if (!existing) journal.splice(D.worldBook.categories, D.worldBook.categories.length, 0, [category]);
    if (replace || (Array.isArray(entries) && entries.length))
      hostWriteReplaceWorldbookEntries(
        category,
        (Array.isArray(entries) ? entries : []).map(function (entry, index) {
          var official = cloneData(objectRecord(entry) || {}),
            original = Number(official.uid),
            wantedUid =
              Number.isSafeInteger(original) && original >= 0 && original < 1000000
                ? original
                : Math.floor(Math.random() * 1000000),
            step = 1;
          while (used.has(wantedUid)) {
            wantedUid = (wantedUid + step * step) % 1000000;
            step++;
          }
          used.add(wantedUid);
          official.uid = wantedUid;
          var old = oldRows.find(function (row) {
            return row.uid === original;
          });
          return hostWriteWorldbookStoredEntry(official, old && old.stored, index);
        }),
        journal
      );
    journal.seal();
    var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts();
    await saveData(sessionsChanged ? ['worldbook', 'sessions'] : 'worldbook');
  } catch (error) {
    journal.rollback();
    throw error;
  }
  hostWriteRenderWorldbook(option);
  return !existing;
}
function hostWriteWorldbookBindings(previous, next, journal) {
  function replace(owner, field) {
    if (!owner || String(owner[field] || '') !== previous) return;
    journal.capture(owner, [field], true);
    if (next === undefined) delete owner[field];
    else owner[field] = next;
  }
  (D.personas || []).forEach(function (persona) {
    replace(persona, 'lorebook');
  });
  (D.characters || []).forEach(function (char) {
    replace(char && objectRecord(char.extensions), 'world');
  });
  Object.keys(D.chats || {}).forEach(function (id) {
    ((D.chats[id] && D.chats[id].sessions) || []).forEach(function (session) {
      replace(session, 'tavernHelperChatLorebook');
    });
  });
}
async function hostWriteRenameWorldbook(oldName, newName) {
  var category = hostWriteWorldbookCategory(oldName, true),
    wanted = String(newName || '').trim();
  if (!wanted) throw new Error('世界书名称不能为空');
  var duplicate = hostWriteWorldbookCategory(wanted, false);
  if (duplicate && duplicate !== category) throw new Error("世界书名称 '" + wanted + "' 已存在");
  if (wanted === String(category.name || '')) return false;
  var journal = createMutationJournal(),
    previous = String(category.name || '');
  try {
    journal.capture(category, ['name'], true);
    category.name = wanted;
    hostWriteWorldbookBindings(previous, wanted, journal);
    journal.seal();
    if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts();
    await saveData(['worldbook', 'characters', 'sessions', 'personas']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  hostWriteRenderWorldbook({ render: 'immediate' });
  return true;
}
async function hostWriteReplaceLorebook(name, entries) {
  var category = hostWriteWorldbookCategory(name, true),
    journal = createMutationJournal(),
    oldRows = cardFrontendWorldbookRows(category),
    used = new Set();
  try {
    hostWriteReplaceWorldbookEntries(
      category,
      (Array.isArray(entries) ? entries : []).map(function (value, index) {
        var official = cloneData(objectRecord(value) || {}),
          wanted = Number(official.uid);
        if (!Number.isSafeInteger(wanted) || wanted < 0) wanted = 0;
        while (used.has(wanted)) wanted = (wanted + 1) % 1000000;
        used.add(wanted);
        official.uid = wanted;
        official.display_index = hostWriteOwn(official, 'display_index') ? Number(official.display_index) : index;
        var old = oldRows.find(function (row) {
          return row.uid === wanted;
        });
        return cardFrontendLorebookStoredEntry(
          cardFrontendLorebookMerge(cardFrontendLorebookDefaults(wanted, index), official),
          old && old.stored
        );
      }),
      journal
    );
    await cardFrontendPersistLorebook(category, journal);
  } catch (error) {
    journal.rollback();
    throw error;
  }
}
function cardFrontendWorldbookToLorebook(value, index) {
  var row = objectRecord(value) || {},
    strategy = objectRecord(row.strategy) || {},
    secondary = objectRecord(strategy.keys_secondary) || {},
    position = objectRecord(row.position) || {},
    order = Number(position.order == null ? 100 : position.order),
    recursion = objectRecord(row.recursion) || {},
    effect = objectRecord(row.effect) || {};
  return {
    uid: Number(row.uid),
    display_index: index,
    comment: String(row.name || ''),
    enabled: row.enabled !== false,
    type: String(strategy.type || 'constant'),
    position:
      String(position.type || 'at_depth') === 'at_depth'
        ? 'at_depth_as_' + String(position.role || 'system')
        : String(position.type || 'at_depth'),
    depth: position.depth == null ? 4 : Math.max(0, Number(position.depth) || 0),
    order: Number.isFinite(order) ? order : 100,
    probability: Number(row.probability == null ? 100 : row.probability),
    keys: (strategy.keys || []).map(String),
    logic: String(secondary.logic || 'and_any'),
    filters: (secondary.keys || []).map(String),
    scan_depth: strategy.scan_depth == null ? 'same_as_global' : strategy.scan_depth,
    case_sensitive: row.caseSensitive == null ? 'same_as_global' : row.caseSensitive,
    match_whole_words: row.matchWholeWords == null ? 'same_as_global' : row.matchWholeWords,
    use_group_scoring: row.useGroupScoring == null ? 'same_as_global' : row.useGroupScoring,
    automation_id: row.automationId || null,
    exclude_recursion: recursion.prevent_incoming === true,
    prevent_recursion: recursion.prevent_outgoing === true,
    delay_until_recursion: recursion.delay_until || false,
    content: String(row.content || ''),
    group: String(row.group || ''),
    group_prioritized: row.groupOverride === true,
    group_weight: Number(row.groupWeight) || 100,
    sticky: effect.sticky || null,
    cooldown: effect.cooldown || null,
    delay: effect.delay || null,
  };
}
function hostWriteWorldbookStoredEntry(value, existing, index) {
  var official = objectRecord(value) || {},
    row = cardFrontendLorebookStoredEntry(cardFrontendWorldbookToLorebook(official, index), existing),
    defaults = {
      addMemo: true,
      matchPersonaDescription: false,
      matchCharacterDescription: false,
      matchCharacterPersonality: false,
      matchCharacterDepthPrompt: false,
      matchScenario: false,
      matchCreatorNotes: false,
      ignoreBudget: false,
    };
  row.name = String(official.name || '');
  if (objectRecord(official.extra)) {
    if (!objectRecord(row._raw)) row._raw = {};
    row._raw.extra = cloneData(official.extra);
  }
  Object.keys(defaults).forEach(function (key) {
    row[key] = hostWriteOwn(official, key) ? official[key] === true : defaults[key];
  });
  row.outletName = hostWriteOwn(official, 'outletName') ? String(official.outletName || '') : '';
  row.triggers =
    hostWriteOwn(official, 'triggers') && Array.isArray(official.triggers) ? cloneData(official.triggers) : [];
  row.characterFilter = hostWriteOwn(official, 'characterFilter')
    ? cloneData(objectRecord(official.characterFilter) || { isExclude: false, names: [], tags: [] })
    : { isExclude: false, names: [], tags: [] };
  return row;
}
function hostWriteRenderWorldbook(option) {
  var mode = String((option && option.render) || 'debounced');
  if (mode === 'none') return;
  var render = function () {
    if (typeof scheduleWBRenderPrewarm === 'function') scheduleWBRenderPrewarm();
    if (typeof renderWBAll === 'function') renderWBAll();
    if (typeof renderWBSidebar === 'function') renderWBSidebar();
    if (typeof updateChatUI === 'function') updateChatUI();
  };
  if (mode === 'immediate') render();
  else setTimeout(render, 0);
}
async function hostWriteDeleteWorldbook(name) {
  var category = hostWriteWorldbookCategory(name, false);
  if (!category) return false;
  var journal = createMutationJournal();
  try {
    hostWriteWorldbookBindings(String(name), undefined, journal);
    journal.splice(D.worldBook.categories, D.worldBook.categories.indexOf(category), 1);
    var ids = D.worldBook.globalCategoryIds || [];
    for (var index = ids.length - 1; index >= 0; index--) {
      if (String(ids[index]) === String(category.id)) journal.splice(ids, index, 1);
    }
    journal.capture(D.worldBook, ['activeCategoryId'], true);
    if (String(D.worldBook.activeCategoryId || '') === String(category.id))
      D.worldBook.activeCategoryId = (D.worldBook.categories[0] && D.worldBook.categories[0].id) || '';
    journal.seal();
    if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts();
    await saveData(['worldbook', 'characters', 'sessions', 'personas']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  hostWriteRenderWorldbook({ render: 'immediate' });
  return true;
}
async function hostWriteGetOrCreateChatLorebook(live, name) {
  var context = cardFrontendRequireCurrent(live),
    existing = hostWriteChatLorebook(context.session);
  if (existing) return existing;
  var fallback = ('Chat Book ' + String(context.session.id || ''))
      .replace(/[^a-z0-9 -]/gi, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 64),
    wanted = hostWriteUniqueStscriptWorldbookName(name, fallback);
  await hostWriteCreateWorldbook(wanted, [], false);
  await hostWriteSetChatLorebook(live, wanted);
  return wanted;
}

var HOST_WRITE_STSCRIPT_WORLD_FIELDS = {
  key: { type: 'array', stored: 'keys', default: [] },
  keysecondary: { type: 'array', stored: 'secondary_keys', default: [] },
  comment: { type: 'string', stored: 'comment', default: '' },
  content: { type: 'string', stored: 'content', default: '' },
  constant: { type: 'boolean', stored: 'constant', default: false },
  vectorized: { type: 'boolean', stored: 'vectorized', default: false },
  selective: { type: 'boolean', stored: 'selective', default: true },
  selectiveLogic: { type: 'number', stored: 'selectiveLogic', default: 0 },
  addMemo: { type: 'boolean', stored: 'addMemo', default: false },
  order: { type: 'number', stored: 'order', default: 100 },
  position: { type: 'position', stored: 'sourcePosition', default: 0 },
  disable: { type: 'disabled', stored: 'enabled', default: false },
  ignoreBudget: { type: 'boolean', stored: 'ignoreBudget', default: false },
  excludeRecursion: { type: 'boolean', stored: 'excludeRecursion', default: false },
  preventRecursion: { type: 'boolean', stored: 'preventRecursion', default: false },
  matchPersonaDescription: { type: 'boolean', stored: 'matchPersonaDescription', default: false },
  matchCharacterDescription: { type: 'boolean', stored: 'matchCharacterDescription', default: false },
  matchCharacterPersonality: { type: 'boolean', stored: 'matchCharacterPersonality', default: false },
  matchCharacterDepthPrompt: { type: 'boolean', stored: 'matchCharacterDepthPrompt', default: false },
  matchScenario: { type: 'boolean', stored: 'matchScenario', default: false },
  matchCreatorNotes: { type: 'boolean', stored: 'matchCreatorNotes', default: false },
  delayUntilRecursion: { type: 'number', stored: 'delayUntilRecursion', default: 0 },
  probability: { type: 'number', stored: 'probability', default: 100 },
  useProbability: { type: 'boolean', stored: 'useProbability', default: true },
  depth: { type: 'number', stored: 'depth', default: 4 },
  outletName: { type: 'string', stored: 'outletName', default: '' },
  group: { type: 'string', stored: 'group', default: '' },
  groupOverride: { type: 'boolean', stored: 'groupOverride', default: false },
  groupWeight: { type: 'number', stored: 'groupWeight', default: 100 },
  scanDepth: { type: 'nullable-number', stored: 'scanDepth', default: null },
  caseSensitive: { type: 'nullable-boolean', stored: 'caseSensitive', default: null },
  matchWholeWords: { type: 'nullable-boolean', stored: 'matchWholeWords', default: null },
  useGroupScoring: { type: 'nullable-boolean', stored: 'useGroupScoring', default: null },
  automationId: { type: 'string', stored: 'automationId', default: '' },
  role: { type: 'role', stored: 'role', default: 0 },
  sticky: { type: 'nullable-number', stored: 'sticky', default: null },
  cooldown: { type: 'nullable-number', stored: 'cooldown', default: null },
  delay: { type: 'nullable-number', stored: 'delay', default: null },
  characterFilterNames: { type: 'filter-array', stored: 'names', default: [] },
  characterFilterTags: { type: 'filter-array', stored: 'tags', default: [] },
  characterFilterExclude: { type: 'filter-boolean', stored: 'isExclude', default: false },
  triggers: { type: 'array', stored: 'triggers', default: [] },
};
function hostWriteStscriptWorldbookEntry(file, uid) {
  var category = hostWriteWorldbookCategory(file, false);
  if (!category) return null;
  var row = cardFrontendWorldbookRows(category).find(function (item) {
    return String(item.uid) === String(uid);
  });
  if (!row) return null;
  return {
    category: category,
    row: row,
    official:
      typeof cardFrontendSillyTavernWorldInfoEntry === 'function'
        ? cardFrontendSillyTavernWorldInfoEntry(row, category)
        : cloneData(row.entry),
  };
}
function hostWriteStscriptParseArray(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return [];
  try {
    var parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch (_) {}
  return text
    .split(',')
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}
function hostWriteStscriptBool(value) {
  return typeof stscriptIsTrue === 'function'
    ? stscriptIsTrue(value)
    : ['true', 'on', 'yes', '1'].includes(String(value).trim().toLowerCase());
}
function hostWriteGetStscriptWorldbookField(file, uid, field) {
  var target = hostWriteStscriptWorldbookEntry(file, uid),
    definition = HOST_WRITE_STSCRIPT_WORLD_FIELDS[String(field || 'content')];
  if (!target || !definition) return undefined;
  var official = target.official || {},
    value;
  if (definition.type.indexOf('filter-') === 0) {
    var filter = objectRecord(official.characterFilter) ||
      objectRecord(target.row.entry && target.row.entry.characterFilter) || {
        names: [],
        tags: [],
        isExclude: false,
      };
    value = filter[definition.stored];
  } else if (hostWriteOwn(official, field)) value = official[field];
  else if (hostWriteOwn(target.row.entry, definition.stored)) value = target.row.entry[definition.stored];
  else value = definition.default;
  return cloneData(value);
}
async function hostWriteSetStscriptWorldbookField(file, uid, field, value) {
  var target = hostWriteStscriptWorldbookEntry(file, uid),
    definition = HOST_WRITE_STSCRIPT_WORLD_FIELDS[String(field || 'content')];
  if (!target || !definition) return false;
  var entry = target.row.stored,
    journal = createMutationJournal(),
    text = String(value == null ? '' : value),
    next;
  journal.capture(entry);
  if (definition.type === 'array' || definition.type === 'filter-array') next = hostWriteStscriptParseArray(text);
  else if (definition.type === 'boolean' || definition.type === 'filter-boolean') next = hostWriteStscriptBool(text);
  else if (definition.type === 'disabled') next = !hostWriteStscriptBool(text);
  else if (definition.type === 'number') next = Number(text);
  else if (definition.type === 'nullable-number') next = text.trim() === '' ? null : Number(text);
  else if (definition.type === 'nullable-boolean') next = text.trim() === '' ? null : hostWriteStscriptBool(text);
  else if (definition.type === 'position') {
    next = Number(text);
    entry.sourcePosition = next;
    entry.position =
      {
        0: 'before_char',
        1: 'after_char',
        2: 'an_top',
        3: 'an_bottom',
        4: 'at_depth',
        5: 'em_top',
        6: 'em_bottom',
        7: 'outlet',
      }[next] || 'before_char';
  } else if (definition.type === 'role') {
    next = Number(text);
    entry.role = next === 1 ? 'user' : next === 2 ? 'assistant' : 'system';
  } else next = text;
  if (
    (definition.type === 'number' || definition.type === 'nullable-number') &&
    next !== null &&
    !Number.isFinite(next)
  )
    next = 0;
  if (definition.type.indexOf('filter-') === 0) {
    if (!objectRecord(entry.characterFilter)) entry.characterFilter = { names: [], tags: [], isExclude: false };
    entry.characterFilter[definition.stored] = next;
  } else if (definition.type === 'disabled') entry.enabled = next;
  else if (definition.type !== 'position' && definition.type !== 'role') entry[definition.stored] = next;
  if (!objectRecord(entry._raw)) entry._raw = {};
  entry._raw[String(field || 'content')] = cloneData(definition.type === 'disabled' ? !entry.enabled : next);
  try {
    await cardFrontendPersistLorebook(target.category, journal);
  } catch (error) {
    throw error;
  }
  return true;
}
async function hostWriteCreateStscriptWorldbookEntry(file, key, content) {
  var category = hostWriteWorldbookCategory(file, false);
  if (!category) return '';
  var journal = createMutationJournal(),
    used = new Set(
      cardFrontendWorldbookRows(category).map(function (row) {
        return row.uid;
      })
    ),
    newUid = 0;
  while (used.has(newUid)) newUid++;
  journal.splice(category.entries, category.entries.length, 0, [
    {
      id: String(newUid),
      keys: key ? [String(key)] : [],
      secondary_keys: [],
      comment: key ? String(key) : '',
      content: String(content == null ? '' : content),
      enabled: true,
      constant: false,
      vectorized: false,
      selective: true,
      selectiveLogic: 0,
      addMemo: !!key,
      order: 100,
      position: 'before_char',
      sourcePosition: 0,
      probability: 100,
      useProbability: true,
      depth: 4,
    },
  ]);
  await cardFrontendPersistLorebook(category, journal);
  return String(newUid);
}
function hostWriteUniqueStscriptWorldbookName(proposed, fallback) {
  var explicit = proposed !== undefined && proposed !== null,
    wanted = String(explicit ? proposed : fallback || '').trim();
  if (!wanted) wanted = 'Lorebook_' + (typeof uid === 'function' ? uid() : Date.now().toString(36));
  if (explicit && hostWriteWorldbookCategory(wanted, false)) throw new Error("世界书名称 '" + wanted + "' 已存在");
  var base = wanted,
    suffix = 2;
  while (hostWriteWorldbookCategory(wanted, false)) wanted = base + ' ' + suffix++;
  return wanted.slice(0, 64);
}
async function hostWriteGetOrCreatePersonaLorebook(live, name, create) {
  var context = cardFrontendRequireCurrent(live),
    persona = typeof getActivePersona === 'function' ? getActivePersona(context.char.id) : null;
  if (!persona) return '';
  var existing = String(persona.lorebook || '');
  if (existing) return existing;
  if (!create) return '';
  var wanted = hostWriteUniqueStscriptWorldbookName(
      name,
      ('Persona Book ' + String(persona.name || ''))
        .replace(/[^a-z0-9 -]/gi, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 64)
    ),
    before = persona.lorebook;
  await hostWriteCreateWorldbook(wanted, [], false);
  persona.lorebook = wanted;
  try {
    await saveData('personas', { urgent: true });
  } catch (error) {
    if (before == null) delete persona.lorebook;
    else persona.lorebook = before;
    await hostWriteDeleteWorldbook(wanted);
    throw error;
  }
  return wanted;
}
// The character and bound books /getcharbook resolves; `create` writes only when a character has none of that type.
function hostWriteCharLorebookLookup(identifier, type, current) {
  var char = hostWriteCharacter(identifier, current);
  type = String(type || 'primary')
    .trim()
    .toLowerCase();
  if (!['primary', 'additional', 'all'].includes(type)) type = 'primary';
  if (!char) return { char: null, type: type, books: [] };
  var bindings = hostWriteCharLorebooks(char),
    books = [];
  if ((type === 'primary' || type === 'all') && bindings.primary) books.push(bindings.primary);
  if (type === 'additional' || type === 'all') books = books.concat(bindings.additional || []);
  books = books.filter(function (item, index, rows) {
    return item && rows.indexOf(item) === index;
  });
  return { char: char, type: type, books: books };
}
async function hostWriteGetOrCreateCharLorebooks(live, identifier, type, name, create) {
  var lookup = hostWriteCharLorebookLookup(identifier, type, cardFrontendRequireCurrent(live).char),
    char = lookup.char,
    books = lookup.books;
  type = lookup.type;
  if (!char) return '';
  if (create && !books.length) {
    var wanted = hostWriteUniqueStscriptWorldbookName(
      name,
      ('Character Book ' + String(char.name || ''))
        .replace(/[^a-z0-9 -]/gi, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 64)
    );
    await hostWriteCreateWorldbook(wanted, [], false);
    var patch = type === 'additional' ? { additional: [wanted] } : { primary: wanted };
    await hostWriteSetCharLorebooks(live, patch, char);
    books.push(wanted);
  }
  return type === 'primary' ? String(books[0] || '') : JSON.stringify(books);
}
async function hostWriteSetStscriptGlobalWorldbooks(names, state, silent) {
  var wanted = (Array.isArray(names) ? names : []).map(function (item) {
      return String(item).trim().toLowerCase();
    }),
    current = hostWriteLorebookSettings().selected_global_lorebooks,
    next = current.slice();
  if (!wanted.length) next = [];
  else
    wanted.forEach(function (lower) {
      var category = hostWriteWorldbookCategories().find(function (row) {
        return String((row && row.name) || '').toLowerCase() === lower;
      });
      if (!category) {
        if (!silent && typeof toast === 'function') toast('未找到世界书：' + lower, 'err');
        return;
      }
      var name = String(category.name || ''),
        index = next.indexOf(name),
        enabled = index >= 0,
        shouldEnable = state === 'toggle' ? !enabled : state !== 'off';
      if (shouldEnable && !enabled) next.push(name);
      if (!shouldEnable && enabled) next.splice(index, 1);
    });
  await hostWriteRebindGlobalWorldbooks(next);
  hostWriteRenderWorldbook({ render: 'immediate' });
  return '';
}
function hostWriteStscriptVectorValue(name) {
  var settings = worldBookSettings();
  if (name === 'vector-chats-state') return D.settings.vectorChatsEnabled !== false;
  if (name === 'vector-worldinfo-state') return settings.vectorEnabled;
  if (name === 'vector-query') return memoryV5Number(D.settings.memoryQueryMessageLimit, 4, 8, 6);
  if (name === 'vector-max-entries') return settings.vectorMaxEntries;
  if (name === 'vector-threshold') return settings.vectorScoreThreshold;
  return undefined;
}
async function hostWriteSetStscriptVectorValue(name, value) {
  var journal = createMutationJournal(),
    sections = [];
  journal.capture(D.worldBook, ['vector_enabled', 'vector_max_entries', 'vector_score_threshold'], true);
  journal.capture(D.settings, ['vectorChatsEnabled', 'memoryQueryMessageLimit'], true);
  if (name === 'vector-chats-state') {
    D.settings.vectorChatsEnabled = value === true;
    sections.push('meta');
  } else if (name === 'vector-worldinfo-state') {
    D.worldBook.vector_enabled = value === true;
    sections.push('worldbook');
  } else if (name === 'vector-query') {
    D.settings.memoryQueryMessageLimit = memoryV5Number(value, 4, 8, 6);
    sections.push('meta');
  } else if (name === 'vector-max-entries') {
    D.worldBook.vector_max_entries = Number(value);
    sections.push('worldbook');
  } else if (name === 'vector-threshold') {
    D.worldBook.vector_score_threshold = Number(value);
    sections.push('worldbook');
  }
  journal.seal();
  var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts();
  if (sessionsChanged) sections.push('sessions');
  sections = sections.filter(function (item, index, rows) {
    return rows.indexOf(item) === index;
  });
  try {
    await saveData(sections.length === 1 ? sections[0] : sections, { urgent: true });
  } catch (error) {
    journal.rollback();
    throw error;
  }
  return hostWriteStscriptVectorValue(name);
}
function hostWriteComparableName(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function hostWriteFindStscriptRegex(name, char) {
  var wanted = hostWriteComparableName(name);
  return (typeof effectiveRegexScriptRows === 'function' ? effectiveRegexScriptRows(char) : []).find(function (row) {
    var normalized =
      typeof normalizeRegexScriptRecord === 'function' ? normalizeRegexScriptRecord(row.script) : row.script;
    return hostWriteComparableName(normalized && normalized.name) === wanted;
  });
}
function hostWriteStscriptRegexState(name, char) {
  var row = hostWriteFindStscriptRegex(name, char);
  if (!row) return null;
  var normalized =
    typeof normalizeRegexScriptRecord === 'function' ? normalizeRegexScriptRecord(row.script) : row.script;
  return normalized && normalized.enabled !== false;
}
async function hostWriteToggleStscriptRegex(name, state, char) {
  var row = hostWriteFindStscriptRegex(name, char);
  if (!row) return '';
  var script = row.script,
    journal = createMutationJournal(),
    current = hostWriteStscriptRegexState(name, char),
    enabled = state === 'toggle' ? !current : state === 'on',
    section = row.scope === 'character' ? 'characters' : 'meta';
  journal.capture(script, ['enabled', 'disabled'], true);
  if (hostWriteOwn(script, 'enabled') || !hostWriteOwn(script, 'disabled')) script.enabled = enabled;
  else script.disabled = !enabled;
  journal.seal();
  try {
    if (row.scope === 'preset' && typeof completionPresetSyncHostWrite === 'function')
      completionPresetSyncHostWrite('in_use');
    var sessionsChanged =
      typeof invalidateCacheContexts === 'function' &&
      (row.scope === 'character' ? invalidateCacheContexts(char && char.id, 0, true) : invalidateCacheContexts());
    await saveData(sessionsChanged ? [section, 'sessions'] : section, { urgent: true });
  } catch (error) {
    journal.rollback();
    if (row.scope === 'preset' && typeof completionPresetSyncHostWrite === 'function')
      completionPresetSyncHostWrite('in_use');
    throw error;
  }
  if (typeof invalidateRegexScriptRuntimeCache === 'function') invalidateRegexScriptRuntimeCache();
  if (typeof invalidateCardScriptDisplayCache === 'function') invalidateCardScriptDisplayCache(char);
  if (typeof renderChat === 'function') renderChat();
  var normalized = typeof normalizeRegexScriptRecord === 'function' ? normalizeRegexScriptRecord(script) : script;
  return String((normalized && normalized.name) || name);
}
async function hostWriteSelectStscriptRegexPreset(name) {
  var wanted = String(name == null ? '' : name).trim();
  if (!wanted) {
    var selected = typeof regexPresetSelected === 'function' ? regexPresetSelected() : null;
    return String((selected && selected.id) || '');
  }
  if (typeof regexPresetApply !== 'function') return '';
  return regexPresetApply(wanted, typeof getChar === 'function' ? getChar() : null);
}

function hostWriteScriptTree(scope, char, create) {
  if (scope === 'global') {
    var settings = objectRecord(D.settings.tavernHelperExtensionSettings);
    if (!settings) {
      if (!create) return { rows: [], section: 'meta' };
      settings = D.settings.tavernHelperExtensionSettings = {};
    }
    if (create && !objectRecord(settings.tavern_helper)) settings.tavern_helper = {};
    if (create && !objectRecord(settings.tavern_helper.script)) settings.tavern_helper.script = {};
    if (create && !Array.isArray(settings.tavern_helper.script.scripts)) settings.tavern_helper.script.scripts = [];
    return {
      rows:
        settings.tavern_helper && settings.tavern_helper.script && Array.isArray(settings.tavern_helper.script.scripts)
          ? settings.tavern_helper.script.scripts
          : [],
      section: 'meta',
    };
  }
  if (scope === 'preset') {
    var extensions = hostWritePresetExtensions('in_use', create),
      presetScripts =
        extensions && typeof cardScriptTavernHelperContainer === 'function'
          ? cardScriptTavernHelperContainer(extensions, create)
          : null;
    return { rows: (presetScripts && presetScripts.rows) || [], section: 'meta', presetName: 'in_use' };
  }
  if (scope === 'character') {
    if (create && !objectRecord(char.extensions)) char.extensions = {};
    var charScripts =
      typeof cardScriptTavernHelperContainer === 'function'
        ? cardScriptTavernHelperContainer(char.extensions, create)
        : null;
    return { rows: (charScripts && charScripts.rows) || [], section: 'characters' };
  }
  throw new Error('脚本树作用域无效：' + scope);
}
function hostWriteNormalizeScriptNode(value) {
  var outer = objectRecord(value) || {},
    row = hostWriteScriptPayload(outer) || {},
    wrapped = row !== outer,
    type = String(row.type || 'script') === 'folder' ? 'folder' : 'script',
    result = cloneData(row);
  result.type = type;
  result.id = String(result.id || (typeof uid === 'function' ? uid() : Date.now().toString(36)));
  result.name = String(result.name || '');
  result.enabled = result.enabled === true;
  if (type === 'folder')
    result.scripts = (Array.isArray(result.scripts) ? result.scripts : []).map(hostWriteNormalizeScriptNode);
  else {
    result.content = String(result.content != null ? result.content : result.code || '');
    result.info = String(result.info || '');
    result.data = objectRecord(result.data) ? result.data : {};
    var button = objectRecord(result.button) || {};
    result.button = {
      enabled: button.enabled !== false,
      buttons: (Array.isArray(button.buttons) ? button.buttons : []).map(function (item) {
        var copy = objectRecord(item) ? cloneData(item) : { name: String(item || '') };
        copy.name = String(copy.name || '');
        copy.visible = copy.visible !== false;
        return copy;
      }),
    };
    result.export_with = objectRecord(result.export_with) ? result.export_with : { data: true, button: true };
  }
  if (!wrapped) return result;
  var stored = cloneData(outer);
  stored.value = result;
  return stored;
}
function hostWriteFindScript(char, id, scope) {
  var matches = [];
  ['global', 'preset', 'character'].forEach(function (type) {
    if (scope && scope !== type) return;
    var tree = hostWriteScriptTree(type, char, false);
    hostWriteFlattenScripts(tree.rows, type, tree.section, matches);
  });
  matches = matches.filter(function (row) {
    return String((row.node && row.node.id) || '') === String(id || '');
  });
  if (matches.length > 1) throw new Error("脚本 id '" + String(id || '') + "' 不唯一");
  return matches[0] || null;
}
function cardFrontendAllScriptRows(char) {
  var rows = [];
  ['global', 'preset', 'character'].forEach(function (scope) {
    var tree = hostWriteScriptTree(scope, char, false);
    hostWriteFlattenScripts(tree.rows, scope, tree.section, []).forEach(function (record, index) {
      var normalized = hostWriteNormalizeScriptNode(record.node),
        node = hostWriteScriptPayload(normalized);
      if (!node || node.type !== 'script') return;
      rows.push({
        id: node.id,
        name: node.name,
        type: 'script',
        enabled: node.enabled === true,
        content: node.content,
        data: cloneData(node.data),
        button: cloneData(node.button),
        info: node.info,
        scope: scope,
        source: scope + '.tavern_helper.scripts',
        index: index,
        raw: cloneData(record.stored),
      });
    });
  });
  return rows;
}
function hostWriteReplaceScriptRows(rows, entries, journal) {
  hostWriteReplaceRows(
    rows,
    entries,
    journal,
    function (row) {
      return String((hostWriteScriptPayload(row) || {}).id);
    },
    function (old, entry) {
      var before = hostWriteScriptPayload(old),
        next = hostWriteScriptPayload(entry);
      if (before && next && Array.isArray(before.scripts) && Array.isArray(next.scripts)) {
        hostWriteReplaceScriptRows(before.scripts, next.scripts, journal);
        next.scripts = before.scripts;
      }
      return journal.replaceRecord(old, entry);
    }
  );
}
function hostWriteSaveScript(live, section, scope, journal) {
  journal.seal();
  if (scope === 'preset' && typeof completionPresetSyncHostWrite === 'function')
    completionPresetSyncHostWrite('in_use');
  var char = cardFrontendCharacter(live);
  if (section && typeof saveData === 'function')
    Promise.resolve()
      .then(function () {
        return saveData(section);
      })
      .catch(function (error) {
        journal.rollback();
        if (scope === 'preset' && typeof completionPresetSyncHostWrite === 'function')
          completionPresetSyncHostWrite('in_use');
        if (char && typeof invalidateCardScriptStack === 'function') invalidateCardScriptStack(char);
        if (char && typeof syncCardScriptLibrary === 'function') syncCardScriptLibrary(char);
        cardFrontendSettingsSaveFailed(error, live);
      });
  if (char && typeof invalidateCardScriptStack === 'function') invalidateCardScriptStack(char);
}
function hostWriteScriptButtons(live, args, replaceInfo) {
  var char = cardFrontendRequireCurrent(live).char,
    script = hostWriteFindScript(char, String((args && args.scriptId) || ''), String((args && args.scope) || ''));
  if (!script) return replaceInfo ? '' : [];
  var journal = createMutationJournal();
  if (replaceInfo) {
    if (hostWriteOwn(args, 'value')) {
      journal.capture(script.node, ['info'], true);
      script.node.info = String(args.value || '');
      hostWriteSaveScript(live, script.section, script.scope, journal);
    }
    return String(script.node.info || '');
  }
  if (hostWriteOwn(args, 'buttons')) {
    journal.capture(script.node, ['button'], true);
    var button = objectRecord(script.node.button) || { enabled: true };
    journal.capture(button, ['buttons'], true);
    button.buttons = (Array.isArray(args.buttons) ? args.buttons : []).map(function (row) {
      var copy = objectRecord(row) ? cloneData(row) : { name: String(row || '') };
      copy.name = String(copy.name || '');
      copy.visible = copy.visible !== false;
      return copy;
    });
    script.node.button = button;
    hostWriteSaveScript(live, script.section, script.scope, journal);
  }
  return cloneData(
    objectRecord(script.node.button) && Array.isArray(script.node.button.buttons) ? script.node.button.buttons : []
  );
}
function hostWriteAllEnabledButtons(char) {
  var out = {};
  ['global', 'preset', 'character'].forEach(function (scope) {
    var tree = hostWriteScriptTree(scope, char, false);
    hostWriteFlattenScripts(tree.rows, scope, tree.section, []).forEach(function (record) {
      var node = record.node,
        buttons = objectRecord(node.button);
      if (node.enabled !== true || !buttons || buttons.enabled === false) return;
      var rows = (buttons.buttons || [])
        .filter(function (button) {
          return button && button.visible !== false;
        })
        .map(function (button) {
          return {
            button_id: String(node.id || '') + '_' + hostWriteStringHash(String(button.name || '')),
            button_name: String(button.name || ''),
          };
        });
      if (rows.length) out[String(node.id || '')] = rows;
    });
  });
  return out;
}

function hostWriteRegexRaw(option, char, create) {
  option = objectRecord(option) || {};
  var type = String(option.type || '');
  if (!type) {
    return null;
  }
  if (type === 'global') {
    if (create && !Array.isArray(D.settings.regexScripts)) D.settings.regexScripts = [];
    return {
      rows: Array.isArray(D.settings.regexScripts) ? D.settings.regexScripts : [],
      section: 'meta',
      type: type,
      viewer: char,
    };
  }
  if (type === 'character') {
    var owner = hostWriteCharacter(option.name, char);
    if (!owner) throw new Error("未能找到角色 '" + String(option.name || 'current') + "'");
    if (create && !Array.isArray(owner.regexScripts)) owner.regexScripts = [];
    return {
      rows: Array.isArray(owner.regexScripts) ? owner.regexScripts : [],
      section: 'characters',
      type: type,
      owner: owner,
    };
  }
  if (type === 'preset') {
    var name = String(option.name || 'in_use'),
      extensions = hostWritePresetExtensions(name, create);
    if (!extensions) {
      if (create) throw new Error("预设 '" + name + "' 不存在");
      return { missing: true, rows: [], section: '', type: type };
    }
    if (create && !Array.isArray(extensions.regex_scripts)) extensions.regex_scripts = [];
    return {
      rows: Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : [],
      section: 'meta',
      type: type,
      extensions: extensions,
    };
  }
  throw new Error('Regex 作用域无效：' + type);
}
// Deliberate deviation chosen by the user: a card sees the user's global rows plus the rows its
// own character's scripts wrote, and what it writes to the global table belongs to that character.
function hostWriteRegexVisibleRows(store) {
  if (store.type !== 'global') return store.rows || [];
  return store.rows.filter(function (row) {
    return regexScriptGlobalVisibleTo(row, store.viewer);
  });
}
function hostWriteRegexStoredRaw(value) {
  var row = objectRecord(value) || {},
    normalized = hostWriteOwn(row, 'raw') && hostWriteOwn(row, 'targetUser') && hostWriteOwn(row, 'applyDisplay');
  return normalized && typeof exportRegexScriptRecord === 'function' ? exportRegexScriptRecord(row) : cloneData(row);
}
function hostWriteRegexOfficial(raw) {
  var exported = hostWriteRegexStoredRaw(raw),
    official;
  if (typeof presetRegexToHelper === 'function') official = presetRegexToHelper(exported);
  else {
    var normalized = typeof normalizeRegexScriptRecord === 'function' ? normalizeRegexScriptRecord(raw) : raw;
    official = {
      id: String(normalized.id || ''),
      script_name: String(normalized.name || ''),
      enabled: normalized.enabled !== false,
      find_regex: String(normalized.findRegex || ''),
      trim_strings: cloneData(normalized.trimStrings || []),
      replace_string: String(normalized.replaceString || ''),
      source: {
        user_input: normalized.targetUser === true,
        ai_output: normalized.targetAssistant === true,
        slash_command: false,
        world_info: normalized.targetWorldBook === true,
        reasoning: false,
      },
      destination: { display: normalized.applyDisplay === true, prompt: normalized.applySend === true },
      run_on_edit: normalized.runOnEdit === true,
      min_depth: normalized.minDepth == null ? null : normalized.minDepth,
      max_depth: normalized.maxDepth == null ? null : normalized.maxDepth,
    };
  }
  var rawKnown = {
    id: 1,
    scriptName: 1,
    disabled: 1,
    runOnEdit: 1,
    findRegex: 1,
    trimStrings: 1,
    replaceString: 1,
    placement: 1,
    substituteRegex: 1,
    minDepth: 1,
    maxDepth: 1,
    markdownOnly: 1,
    promptOnly: 1,
    name: 1,
    find: 1,
    replacement: 1,
    targetUser: 1,
    targetAssistant: 1,
    targetWorldBook: 1,
    applyDisplay: 1,
    applySend: 1,
    enabled: 1,
    imported: 1,
    raw: 1,
  };
  Object.keys(objectRecord(exported) || {}).forEach(function (key) {
    if (!rawKnown[key] && hostWriteSafeKey(key)) official[key] = cloneData(exported[key]);
  });
  return official;
}
function hostWriteGetRegexes(live, option) {
  var char = cardFrontendRequireCurrent(live).char;
  if (option && option.type) {
    var store = hostWriteRegexRaw(option, char, false);
    return hostWriteRegexVisibleRows(store).map(hostWriteRegexOfficial);
  }
  var legacy = objectRecord(option) || {},
    scope = String(legacy.scope || 'all'),
    state = String(legacy.enable_state || 'all'),
    rows = [];
  if (scope === 'all' || scope === 'global')
    rows = rows.concat(
      hostWriteRegexVisibleRows(hostWriteRegexRaw({ type: 'global' }, char, false)).map(function (row) {
        return Object.assign(hostWriteRegexOfficial(row), { scope: 'global' });
      })
    );
  if (scope === 'all' || scope === 'character')
    rows = rows.concat(
      hostWriteRegexRaw({ type: 'character' }, char, false).rows.map(function (row) {
        return Object.assign(hostWriteRegexOfficial(row), { scope: 'character' });
      })
    );
  if (!['all', 'global', 'character'].includes(scope) || !['all', 'enabled', 'disabled'].includes(state))
    throw new Error('Regex 旧式筛选参数无效');
  return state === 'all'
    ? rows
    : rows.filter(function (row) {
        return row.enabled === (state === 'enabled');
      });
}
function hostWriteRegexPlacement(source) {
  return { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }[String(source || '')];
}
function hostWriteRegexSourceAllows(source, placement) {
  var raw = hostWriteRegexStoredRaw(source),
    values = typeof regexScriptPlacementValues === 'function' ? regexScriptPlacementValues(raw && raw.placement) : [],
    normalized = typeof normalizeRegexScriptRecord === 'function' ? normalizeRegexScriptRecord(source) : source;
  if (values.length) return values.includes(placement);
  if (placement === 1) return normalized.targetUser === true;
  if (placement === 2) return normalized.targetAssistant === true;
  if (placement === 5) return normalized.targetWorldBook === true;
  return false;
}
function hostWriteRegexDestinationAllows(source, destination) {
  var markdown =
      typeof regexScriptOfficialPhaseFlag === 'function'
        ? regexScriptOfficialPhaseFlag(source, 'markdownOnly')
        : source && source.markdownOnly === true,
    prompt =
      typeof regexScriptOfficialPhaseFlag === 'function'
        ? regexScriptOfficialPhaseFlag(source, 'promptOnly')
        : source && source.promptOnly === true;
  if (destination === 'display') return markdown;
  if (destination === 'prompt') return prompt;
  return !markdown && !prompt;
}
function hostWriteRegexMacroState(char, session, depth) {
  var state =
    typeof bindCharacterMacroSession === 'function'
      ? bindCharacterMacroSession(createCharacterMacroState(), session, { commit: false })
      : createCharacterMacroState();
  state.messages = session && Array.isArray(session.msgs) ? session.msgs : [];
  state.messageId =
    typeof depth === 'number' ? Math.max(0, state.messages.length - depth - 1) : Math.max(0, state.messages.length - 1);
  state.lastMessageId = state.messageId;
  state.input = typeof $ === 'function' && $('user-input') ? $('user-input').value : '';
  return state;
}
function hostWriteRegexReplaceSync(text, source, char, currentState, overrideState, overrideChar) {
  var plan = regexScriptPlan(source),
    script = plan.script,
    find = script.substituteRegex ? regexScriptFindSource(script, char) : script.findRegex,
    safety = regexScriptSafety(find);
  if (!script.enabled || !safety.valid || !text) return text;
  var regex = new RegExp(safety.pattern, safety.flags);
  return String(text).replace(regex, function () {
    var args = Array.from(arguments),
      replacement = String(script.replaceString || '')
        .replace(/{{match}}/gi, '$0')
        .replace(/\$(\d+)|\$<([^>]+)>/g, function (_, number, name) {
          var value = number
            ? args[Number(number)]
            : args[args.length - 1] && typeof args[args.length - 1] === 'object'
              ? args[args.length - 1][name]
              : undefined;
          if (value == null || value === '') return '';
          var trims = (script.trimStrings || []).map(function (trim) {
            return replaceCharacterMacros(String(trim), overrideChar, regexScriptUserName(char), overrideState);
          });
          return regexScriptFilterGroup(value, trims);
        });
    return replaceCharacterMacros(replacement, char, regexScriptUserName(char), currentState);
  });
}
function formatRegexedStringForContext(char, session, args) {
  var text = String((args && args.text) || ''),
    source = String((args && args.source) || ''),
    destination = String((args && args.destination) || ''),
    option = objectRecord(args && args.option) || {},
    placement = hostWriteRegexPlacement(source),
    depth = typeof option.depth === 'number' && Number.isFinite(option.depth) ? option.depth : undefined,
    currentState = hostWriteRegexMacroState(char, session, depth),
    overrideName = option.character_name == null ? '' : String(option.character_name),
    overrideChar = overrideName
      ? Object.assign({}, char, { name: overrideName, nickname: overrideName, localizedName: overrideName })
      : char,
    overrideState = hostWriteRegexMacroState(overrideChar, session, depth);
  if (placement !== undefined)
    effectiveRegexScriptRows(char).forEach(function (row) {
      if (row.scope === 'character' && !cardRegexesEnabled(char)) return;
      if (
        !hostWriteRegexSourceAllows(row.script, placement) ||
        !hostWriteRegexDestinationAllows(row.script, destination)
      )
        return;
      var script = normalizeRegexScriptRecord(row.script);
      if (!regexScriptDepthAllows(script, depth)) return;
      text = hostWriteRegexReplaceSync(text, row.script, char, currentState, overrideState, overrideChar);
    });
  text = replaceCharacterMacros(text, overrideChar, regexScriptUserName(char), overrideState);
  var role = {
      user_input: 'user',
      ai_output: 'assistant',
      slash_command: 'system',
      world_info: 'system',
      reasoning: 'system',
    }[source],
    messageId =
      depth === undefined ? undefined : (session && Array.isArray(session.msgs) ? session.msgs.length : 0) - depth - 1;
  return String(
    typeof cardFrontendApplyMacroLikes === 'function'
      ? cardFrontendApplyMacroLikes(text, { role: role, message_id: messageId })
      : text
  );
}
function hostWriteFormatRegexedString(live, args) {
  var context = cardFrontendRequireCurrent(live);
  return formatRegexedStringForContext(context.char, context.session, args);
}
async function hostWriteReplaceRegexes(live, regexes, option, transaction) {
  var context = cardFrontendRequireCurrent(live),
    char = context.char,
    rows = Array.isArray(regexes) ? regexes : [];
  if (!option || !option.type) {
    var scope = String((option && option.scope) || 'all');
    if (!['all', 'global', 'character'].includes(scope)) throw new Error('Regex 旧式替换作用域无效：' + scope);
    var globals =
        scope === 'global'
          ? rows
          : rows.filter(function (row) {
              return String((row && row.scope) || '') === 'global';
            }),
      characters =
        scope === 'character'
          ? rows
          : rows.filter(function (row) {
              return String((row && row.scope) || '') !== 'global';
            });
    var combined = { journal: createMutationJournal(), stores: [] };
    try {
      if (scope === 'all' || scope === 'global')
        await hostWriteReplaceRegexes(live, globals, { type: 'global' }, combined);
      if (scope === 'all' || scope === 'character')
        await hostWriteReplaceRegexes(live, characters, { type: 'character' }, combined);
      await hostWritePersistRegexes(char, combined);
    } catch (error) {
      combined.journal.rollback();
      throw error;
    }
    return;
  }
  var pending = transaction || { journal: createMutationJournal(), stores: [] };
  if (option.type === 'preset') completionPresetCaptureDefaultExtensions(pending.journal);
  var store = hostWriteRegexRaw(option, char, true);
  if (store.missing) return;
  var visibleRows = hostWriteRegexVisibleRows(store),
    existingById = Object.create(null);
  visibleRows.forEach(function (row) {
    existingById[String(hostWriteRegexOfficial(row).id || '')] = row;
  });
  var converted = rows.map(function (row) {
    var copy = cloneData(objectRecord(row) || {});
    if (!String(copy.script_name || '')) copy.script_name = '未命名-' + String(copy.id || '');
    var existing = existingById[String(copy.id || '')],
      base = existing ? hostWriteRegexStoredRaw(existing) : {},
      raw = typeof presetRegexToRaw === 'function' ? presetRegexToRaw(copy) : copy,
      known = {
        id: 1,
        script_name: 1,
        enabled: 1,
        find_regex: 1,
        trim_strings: 1,
        replace_string: 1,
        source: 1,
        destination: 1,
        run_on_edit: 1,
        min_depth: 1,
        max_depth: 1,
        substitute_regex: 1,
        scope: 1,
      };
    if (existing && !hostWriteOwn(copy, 'substitute_regex')) delete raw.substituteRegex;
    else if (hostWriteOwn(copy, 'substitute_regex')) raw.substituteRegex = copy.substitute_regex;
    base = Object.assign(objectRecord(base) || {}, raw);
    Object.keys(copy).forEach(function (key) {
      if (!known[key] && hostWriteSafeKey(key)) base[key] = cloneData(copy[key]);
    });
    if (store.type === 'preset') return base;
    // The written row keeps its full raw evidence; only a row that came in with a card keeps the
    // imported mark, and a global row keeps its owner or, when new, belongs to this character. A
    // row the table write hands back unchanged stays exactly as stored.
    var record = normalizeRegexScriptRecord(Object.assign({}, base, { raw: cloneData(base) })),
      owner = store.type === 'global' ? (existing ? regexScriptGlobalOwnerId(existing) : String(char.id || '')) : '';
    record.imported = !!existing && normalizeRegexScriptRecord(existing).imported === true;
    delete record.ownerCharacterId;
    if (owner) record.ownerCharacterId = owner;
    if (existing && JSON.stringify(hostWriteRegexOfficial(record)) === JSON.stringify(hostWriteRegexOfficial(existing)))
      return existing;
    return record;
  });
  if (store.type === 'global') {
    // Rows this character cannot see keep their slots; the visible slots take the new rows in
    // order and any extra rows follow at the end.
    var queue = converted.slice(),
      merged = [];
    store.rows.forEach(function (row) {
      if (!regexScriptGlobalVisibleTo(row, char)) merged.push(row);
      else if (queue.length) merged.push(queue.shift());
    });
    converted = merged.concat(queue);
  }
  hostWriteReplaceRows(store.rows, converted, pending.journal, regexScriptGlobalSlot);
  pending.journal.seal();
  pending.stores.push({ store: store, name: String(option.name || 'in_use') });
  if (!transaction) await hostWritePersistRegexes(char, pending);
}
function hostWriteSyncRegexPresets(pending) {
  if (typeof completionPresetSyncHostWrite !== 'function') return;
  pending.stores.forEach(function (entry) {
    if (entry.store.type === 'preset') completionPresetSyncHostWrite(entry.name);
  });
}
async function hostWritePersistRegexes(char, pending) {
  hostWriteSyncRegexPresets(pending);
  var sections = new Set();
  pending.stores.forEach(function (entry) {
    var store = entry.store;
    sections.add(store.section);
    if (
      typeof invalidateCacheContexts === 'function' &&
      (store.type === 'character'
        ? invalidateCacheContexts(store.owner && store.owner.id, 0, true)
        : invalidateCacheContexts())
    )
      sections.add('sessions');
  });
  try {
    await saveData(sections.size === 1 ? Array.from(sections)[0] : Array.from(sections));
  } catch (error) {
    pending.journal.rollback();
    hostWriteSyncRegexPresets(pending);
    throw error;
  }
  if (typeof invalidateRegexScriptRuntimeCache === 'function') invalidateRegexScriptRuntimeCache();
  if (typeof invalidateCardScriptDisplayCache === 'function') invalidateCardScriptDisplayCache(char);
  if (typeof renderChat === 'function') renderChat();
}

function cardFrontendHostWriteCall(live, name, args) {
  if (name === 'facadeSetPrompt') return { handled: true, value: hostFacadeSetPrompt(live, args.args) };
  if (name === 'facadeVariable') return { handled: true, value: hostFacadeVariable(live, args) };
  if (name === 'facadeUpdateMetadata')
    return { handled: true, value: hostFacadeUpdateMetadata(live, args.value, args.reset) };
  if (name === 'facadeValue') return { handled: true, value: hostFacadeValue(live, args.key) };
  if (name === 'facadeAction') return { handled: true, value: hostFacadeAction(live, args.name, args.args) };
  if (name === 'mvuCall') return { handled: true, value: hostMvuCall(live, args.name, args.args) };
  if (typeof hostDisplayCall === 'function') {
    var displayed = hostDisplayCall(live, name, args);
    if (displayed) return displayed;
  }
  if (name === 'registerVariableSchema')
    return { handled: true, value: hostVariableRegisterSchema(live, args.schema, args.type) };
  if (typeof hostPromptCall === 'function') {
    var prompt = hostPromptCall(live, name, args);
    if (prompt) return prompt;
  }
  if (typeof hostImportCall === 'function') {
    var imported = hostImportCall(live, name, args);
    if (imported) return imported;
  }
  if (typeof hostEntityCall === 'function') {
    var entity = hostEntityCall(live, name, args);
    if (entity) return entity;
  }
  var context = cardFrontendRequireCurrent(live),
    char = context.char,
    session = context.session,
    handled = function (value) {
      return { handled: true, value: value };
    };
  if (name === 'getChatMessages') return handled(hostWriteGetChatMessages(char, session, args));
  if (name === 'isMvuDataReady') return handled(hostWriteIsMvuDataReady(session));
  if (name === 'setChatMessages') return handled(hostWriteSetChatMessages(live, args));
  if (name === 'setChatMessage') {
    // Only selecting an existing opening candidate needs the greeting scope; that one case is
    // declined here for cardFrontendSelectOpeningMessage in 73-card-frontend.js. Plain text edits
    // and every other opening write stay on the generic host write.
    if (hostWriteIsOpeningCandidateHandoff(session, args)) return null;
    return handled(hostWriteSetChatMessage(live, args));
  }
  if (name === 'createChatMessages') return handled(hostWriteCreateChatMessages(live, args));
  if (name === 'deleteChatMessages') return handled(hostWriteDeleteChatMessages(live, args));
  if (name === 'rotateChatMessages') return handled(hostWriteRotateChatMessages(live, args));
  if (name === 'getVariables') return handled(hostWriteGetVariables(live, args && args.option));
  if (name === 'getAllVariables') return handled(hostWriteGetAllVariables(live, (args && args.option) || {}));
  if (name === 'replaceVariables')
    return handled(hostWriteReplaceVariables(live, args && args.value, args && args.option));
  if (name === 'getLorebookSettings') return handled(hostWriteLorebookSettings());
  if (name === 'setLorebookSettings') return handled(hostWriteSetLorebookSettings(live, args && args.value));
  if (name === 'getLorebooks' || name === 'getWorldbookNames') return handled(hostWriteWorldbookNames());
  if (name === 'getGlobalWorldbookNames') return handled(hostWriteLorebookSettings().selected_global_lorebooks);
  if (name === 'rebindGlobalWorldbooks') return handled(hostWriteRebindGlobalWorldbooks(args && args.names));
  if (name === 'getCharLorebooks' || name === 'getCharWorldbookNames') {
    var owner = hostWriteCharacter(args && args.name, char);
    if (!owner && args && args.name !== 'current') throw new Error("未找到角色 '" + String(args && args.name) + "'");
    return handled(hostWriteCharLorebooks(owner || char));
  }
  if (name === 'getCurrentCharPrimaryLorebook') return handled(hostWriteCharLorebooks(char).primary);
  if (name === 'setCurrentCharLorebooks' || name === 'rebindCharWorldbooks')
    return handled(hostWriteSetCharLorebooks(live, args && args.value));
  if (name === 'getChatLorebook' || name === 'getChatWorldbookName') return handled(hostWriteChatLorebook(session));
  if (name === 'setChatLorebook' || name === 'rebindChatWorldbook')
    return handled(hostWriteSetChatLorebook(live, args && args.name));
  if (name === 'getOrCreateChatLorebook' || name === 'getOrCreateChatWorldbook')
    return handled(hostWriteGetOrCreateChatLorebook(live, args && args.name));
  if (name === 'createLorebook') return handled(hostWriteCreateWorldbook(args && args.name, [], false));
  if (name === 'deleteLorebook' || name === 'deleteWorldbook')
    return handled(hostWriteDeleteWorldbook(args && args.name));
  if (name === 'createWorldbook')
    return handled(hostWriteCreateWorldbook(args && args.name, args && args.entries, false, args && args.option));
  if (name === 'createOrReplaceWorldbook')
    return handled(hostWriteCreateWorldbook(args && args.name, args && args.entries, true, args && args.option));
  if (name === 'getWorldbook' || name === 'getLorebookEntries') {
    var category = hostWriteWorldbookCategory(args && args.name, true),
      mapped = cardFrontendWorldbookRows(category).map(
        name === 'getWorldbook' ? cardFrontendWorldbookEntry : cardFrontendLorebookEntry
      );
    return handled(name === 'getLorebookEntries' ? cardFrontendLorebookFilter(mapped, args && args.option) : mapped);
  }
  if (name === 'replaceWorldbook')
    return handled(
      hostWriteCreateWorldbook(args && args.name, args && args.entries, true, args && args.option).then(function () {
        return;
      })
    );
  if (name === 'updateWorldbookWith')
    return handled(
      Promise.resolve(args && args.entries).then(function (entries) {
        return hostWriteCreateWorldbook(args && args.name, entries, true, args && args.option).then(function () {
          return cardFrontendWorldbookRows(hostWriteWorldbookCategory(args && args.name, true)).map(
            cardFrontendWorldbookEntry
          );
        });
      })
    );
  if (name === 'replaceLorebookEntries')
    return handled(hostWriteReplaceLorebook(args && args.name, args && args.entries));
  if (name === 'updateLorebookEntriesWith')
    return handled(
      hostWriteReplaceLorebook(args && args.name, args && args.entries).then(function () {
        return cardFrontendWorldbookRows(hostWriteWorldbookCategory(args && args.name, true)).map(
          cardFrontendLorebookEntry
        );
      })
    );
  if (name === 'createLorebookEntries' || name === 'setLorebookEntries' || name === 'deleteLorebookEntries')
    return handled(cardFrontendWriteLorebook(name, args));
  if (name === 'getScriptTrees')
    return handled(
      cloneData(hostWriteScriptTree(String((args && args.option && args.option.type) || ''), char, false).rows)
    );
  if (name === 'replaceScriptTrees') {
    var scope = String((args && args.option && args.option.type) || ''),
      journal = createMutationJournal();
    if (scope === 'preset') completionPresetCaptureDefaultExtensions(journal);
    var tree = hostWriteScriptTree(scope, char, true);
    hostWriteReplaceScriptRows(
      tree.rows,
      (Array.isArray(args && args.trees) ? args.trees : []).map(hostWriteNormalizeScriptNode),
      journal
    );
    hostWriteSaveScript(live, tree.section, scope, journal);
    if (typeof syncCardScriptLibrary === 'function')
      Promise.resolve().then(function () {
        syncCardScriptLibrary(char);
      });
    return handled();
  }
  if (name === 'getScriptButtons') return handled(hostWriteScriptButtons(live, args, false));
  if (name === 'replaceScriptButtons') {
    hostWriteScriptButtons(live, args, false);
    return handled();
  }
  if (name === 'getScriptInfo') return handled(hostWriteScriptButtons(live, args, true));
  if (name === 'replaceScriptInfo') return handled(hostWriteScriptButtons(live, args, true));
  if (name === 'getAllEnabledScriptButtons') return handled(hostWriteAllEnabledButtons(char));
  if (name === 'getTavernRegexes') return handled(hostWriteGetRegexes(live, args && args.option));
  if (name === 'isCharacterTavernRegexesEnabled') return handled(cardRegexesEnabled(char));
  if (name === 'replaceTavernRegexes')
    return handled(hostWriteReplaceRegexes(live, args && args.regexes, args && args.option));
  if (name === 'formatAsTavernRegexedString') return handled(hostWriteFormatRegexedString(live, args));
  return null;
}
