// Entity projections share the character, persona and session stores used by the application UI.
function hostEntityPersistentCharacters() {
  return D.characters.filter(Boolean);
}
function hostEntityCharacter(name, current) {
  if (!name || name === 'current') return current || null;
  var key = String(name).toLowerCase();
  return (
    D.characters.find(function (char) {
      return (
        String(char.id).toLowerCase() === key ||
        (String(char.id) + '.png').toLowerCase() === key ||
        String(char.name).toLowerCase() === key
      );
    }) || null
  );
}
function hostEntityRawCharacter(char) {
  if (!char) return null;
  var raw = cloneData((char.importMeta && char.importMeta.rawCard) || {}),
    data = objectRecord(raw.data) || cloneData(raw);
  [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'system_prompt',
    'post_history_instructions',
    'creator',
    'creator_notes',
    'character_version',
    'alternate_greetings',
    'tags',
    'nickname',
    'source',
    'assets',
    'creation_date',
    'creator_notes_multilingual',
    'character_book',
  ].forEach(function (key) {
    if (hostWriteOwn(char, key)) data[key] = cloneData(char[key]);
  });
  data.extensions = cloneData(char.extensions || {});
  data.extensions.regex_scripts = (char.regexScripts || []).map(hostWriteRegexStoredRaw);
  Object.assign(raw, {
    name: String(char.name || ''),
    avatar: String(char.id),
    data: data,
    description: String(char.description || ''),
    first_mes: String(char.first_mes || ''),
    personality: String(char.personality || ''),
    scenario: String(char.scenario || ''),
    mes_example: String(char.mes_example || ''),
    creatorcomment: String(char.creator_notes || ''),
    chat: String((D.chats[char.id] && D.chats[char.id].activeSid) || ''),
  });
  return raw;
}
function hostEntityCharacterView(char) {
  var raw = hostEntityRawCharacter(char),
    ext = raw.data.extensions;
  ext.regex_scripts = (char.regexScripts || []).map(hostWriteRegexOfficial);
  if (Array.isArray(ext.tavern_helper)) ext.tavern_helper = Object.fromEntries(ext.tavern_helper);
  [
    'TavernHelper_scripts',
    'TavernHelper_characterScriptVariables',
    'fav',
    'talkativeness',
    'world',
    'depth_prompt',
    'pygmalion_id',
    'github_repo',
    'source_url',
    'chub',
    'risuai',
    'sd_character_prompt',
  ].forEach(function (key) {
    delete ext[key];
  });
  return {
    avatar: String(char.id),
    version: String(char.character_version || ''),
    creator: String(char.creator || ''),
    creator_notes: String(char.creator_notes || ''),
    description: String(char.description || ''),
    first_messages: [String(char.first_mes || '')].concat(char.alternate_greetings || []),
    worldbook: hostWriteCharLorebooks(char).primary,
    extensions: ext,
  };
}
function hostEntityAvatarPath(entity) {
  return entity && typeof displayImageSrc === 'function' ? displayImageSrc(entity, 'avatar_image') || null : null;
}
function hostEntityBlob(value) {
  return value && typeof value.arrayBuffer === 'function' && typeof value.type === 'string';
}
async function hostEntityAvatarData(entityId, avatar, persona) {
  if (!avatar || avatar === entityId) return;
  var data;
  if (hostEntityBlob(avatar)) {
    await validateCardImageBlob(avatar);
    data = cardBytesToDataUrl(new Uint8Array(await avatar.arrayBuffer()), avatar.type || 'image/png');
  } else if (typeof avatar === 'string' && /^data:image\//i.test(avatar.trim())) {
    data = avatar.trim();
  } else if (avatar === 'prompt') {
    return;
  } else if (persona) {
    var source = D.personas.find(function (row) {
      return row.id === avatar;
    });
    if (!source) throw new Error('未找到人格头像：' + String(avatar));
    data = await loadStoredMediaDataUrl(source, 'avatar_image');
  } else return; // The upstream character API only changes avatars supplied as Blob.
  return data || '';
}
function hostEntitySetAvatar(entity, data) {
  if (data === undefined) return;
  entity.avatar_image = data;
  ['_media', '_mediaHash', '_mediaBlobs'].forEach(function (key) {
    if (entity[key]) {
      entity[key] = Object.assign({}, entity[key]);
      delete entity[key].avatar_image;
    }
  });
  if (entity.importMeta) entity.importMeta = Object.assign({}, entity.importMeta, { avatarUserReplaced: true });
}
function hostEntityRenderOption(option) {
  var render = (option && option.render) || 'debounced';
  if (!['debounced', 'immediate', 'none'].includes(render))
    throw new Error('render 必须为 debounced、immediate 或 none');
  return render;
}
var _hostEntityRenderTimers = new Map();
function hostEntityRender(key, render, callback) {
  clearTimeout(_hostEntityRenderTimers.get(key));
  _hostEntityRenderTimers.delete(key);
  if (render === 'none') return;
  if (render === 'immediate') return callback();
  _hostEntityRenderTimers.set(
    key,
    setTimeout(function () {
      _hostEntityRenderTimers.delete(key);
      Promise.resolve(callback()).catch(function (error) {
        toast('界面更新失败：' + error.message, 'err');
      });
    }, 1000)
  );
}
async function hostEntityWriteCharacter(live, name, value, mode, option) {
  var context = cardFrontendRequireCurrent(live),
    original = hostEntityCharacter(name, context.char),
    render = hostEntityRenderOption(option),
    patch = objectRecord(value) || {},
    creating = !original;
  if (mode === 'create' && (name === 'current' || original)) return false;
  if (mode === 'replace' && !original) throw new Error('角色卡不存在：' + String(name));
  if (creating && (!String(name || '').trim() || name === 'current')) return false;
  var avatarData = await hostEntityAvatarData(original && original.id, patch.avatar, false);
  cardFrontendRequireCurrent(live);
  var isAvatarId = String(name).endsWith('.png'),
    char = original
      ? cloneData(original)
      : initializeCardForImport(parseCard({ name: isAvatarId ? String(name).slice(0, -4) : String(name) }));
  if (creating) char.id = isAvatarId ? String(name) : 'c_' + uid();
  var fields = {
    name: 'name',
    version: 'character_version',
    creator: 'creator',
    creator_notes: 'creator_notes',
    description: 'description',
    personality: 'personality',
    scenario: 'scenario',
    message_examples: 'mes_example',
    system_prompt: 'system_prompt',
    post_history_instructions: 'post_history_instructions',
  };
  Object.keys(fields).forEach(function (key) {
    if (patch[key] != null) char[fields[key]] = String(patch[key]);
  });
  if (patch.name != null) applyCharacterRename(char, original, String(patch.name));
  if (patch.first_messages != null) {
    if (!Array.isArray(patch.first_messages)) throw new Error('first_messages 必须是字符串数组');
    char.first_mes = String(patch.first_messages[0] || '');
    char.alternate_greetings = patch.first_messages.slice(1).map(String);
  }
  if (patch.tags != null) {
    if (!Array.isArray(patch.tags)) throw new Error('tags 必须是字符串数组');
    char.tags = patch.tags.map(String);
  }
  char.extensions = Object.assign({}, char.extensions || {}, cloneData(patch.extensions || {}));
  if (patch.talkativeness != null) {
    var talkativeness = Number(patch.talkativeness);
    if (!Number.isFinite(talkativeness)) throw new Error('talkativeness 必须是数字');
    char.talkativeness = talkativeness;
    char.extensions.talkativeness = talkativeness;
  }
  if (patch.favorite != null) {
    char.fav = patch.favorite === true;
    char.extensions.fav = char.fav;
  }
  if (patch.depth_prompt != null) {
    if (!objectRecord(patch.depth_prompt)) throw new Error('depth_prompt 必须是对象');
    char.extensions.depth_prompt = Object.assign({}, char.extensions.depth_prompt || {}, cloneData(patch.depth_prompt));
  }
  if (patch.extensions && patch.extensions.regex_scripts !== undefined) {
    if (!Array.isArray(patch.extensions.regex_scripts)) throw new Error('regex_scripts 必须是数组');
    char.regexScripts = patch.extensions.regex_scripts.map(function (row) {
      return normalizeRegexScriptRecord(presetRegexToRaw(row));
    });
    char.extensions.regex_scripts = char.regexScripts.map(hostWriteRegexStoredRaw);
  }
  if (patch.worldbook !== undefined) {
    if (patch.worldbook && !hostWriteWorldbookCategory(patch.worldbook, false))
      throw new Error('未找到世界书：' + String(patch.worldbook));
    if (patch.worldbook) char.extensions.world = String(patch.worldbook);
    else delete char.extensions.world;
  }
  hostEntitySetAvatar(char, avatarData);
  cardFrontendRequireCurrent(live);
  if (typeof _generationState !== 'undefined' && _generationState !== 'idle')
    throw new Error('请先停止生成，再修改角色');
  if (original && !D.characters.includes(original)) throw new Error('角色卡在更新期间已被修改');
  char.media_assets = syncCharacterGreetingMediaAssets(char, original && original.media_assets);
  ensureCharacterIntelligence(char);
  var journal = createMutationJournal();
  if (original) char = journal.replaceRecord(original, char);
  else journal.splice(D.characters, D.characters.length, 0, [char]);
  if (creating) {
    journal.capture(D.chats, [char.id], true);
    D.chats[char.id] = { sessions: [], activeSid: null };
  }
  journal.seal();
  try {
    await saveData(['characters', 'sessions']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  invalidateCardScriptStack(char);
  invalidateCacheContexts(char.id, 0, true);
  // Runtime ownership changes immediately even when the optional list repaint is deferred.
  if (D.currentCharId === char.id) syncCardScriptLibrary(char);
  await hostEntityRender('character:' + char.id, render, function () {
    var current = D.characters.find(function (row) {
      return row.id === char.id;
    });
    if (current) return refreshCharacterData(current);
  });
  return mode === 'replace' ? undefined : creating;
}
function hostEntityPersona(name, char) {
  if (!name || name === 'current') {
    var active = getActivePersona(char && char.id);
    if (
      active &&
      D.personas.some(function (row) {
        return row === active;
      })
    )
      return active;
    return typeof _hostEntityBaseGetActivePersona === 'function'
      ? _hostEntityBaseGetActivePersona(char && char.id)
      : null;
  }
  var byId = D.personas.find(function (row) {
    return row.id === name;
  });
  if (byId) return byId;
  var matches = D.personas.filter(function (row) {
    return String(row.name).toLowerCase() === String(name).toLowerCase();
  });
  return matches.length === 1 ? matches[0] : null;
}
function hostEntityPersonaView(persona) {
  return {
    avatar_id: persona.id,
    avatar: persona.id,
    name: String(persona.name || ''),
    title: String(persona.title || ''),
    description: String(persona.desc || ''),
    position: persona.position ?? 0,
    depth: persona.depth ?? 2,
    role: persona.role ?? 0,
    lorebook: String(persona.lorebook || ''),
    connections: personaBoundCharIds(persona).map(function (id) {
      return { type: 'character', id: id };
    }),
    is_default: D.activePersonaId === persona.id,
  };
}
function hostEntitySetPersonaBindings(persona, ids, journal) {
  return setPersonaBoundCharIds(persona, ids, journal);
}
async function hostEntityWritePersona(live, name, value, mode, option) {
  var context = cardFrontendRequireCurrent(live),
    original = hostEntityPersona(name, context.char),
    patch = objectRecord(value) || {},
    creating = !original,
    render = hostEntityRenderOption(option);
  if (
    mode === 'create' &&
    (name === 'current' ||
      original ||
      D.personas.some(function (row) {
        return row.id === patch.avatar_id || String(row.name).toLowerCase() === String(name).toLowerCase();
      }))
  )
    return false;
  if (mode === 'replace' && !original) throw new Error('人格不存在或名称不唯一：' + String(name));
  if (
    creating &&
    D.personas.filter(function (row) {
      return String(row.name).toLowerCase() === String(name).toLowerCase();
    }).length > 1
  )
    throw new Error('人格名称不唯一：' + String(name));
  if (creating && (!String(name || '').trim() || name === 'current')) return false;
  var avatarData = await hostEntityAvatarData(original ? original.id : patch.avatar_id, patch.avatar, true);
  cardFrontendRequireCurrent(live);
  var persona = original
    ? cloneData(original)
    : { id: String(patch.avatar_id || 'p_' + uid()), name: String(name), desc: '', boundCharIds: [] };
  if (
    creating &&
    D.personas.some(function (row) {
      return row.id === persona.id;
    })
  )
    return false;
  if (patch.name != null && !creating) persona.name = String(patch.name);
  if (patch.description != null) persona.desc = String(patch.description);
  ['title', 'position', 'depth', 'role', 'lorebook'].forEach(function (key) {
    if (patch[key] != null) persona[key] = cloneData(patch[key]);
  });
  if (persona.lorebook && !hostWriteWorldbookCategory(persona.lorebook, false))
    throw new Error('未找到世界书：' + persona.lorebook);
  var connections;
  if (patch.connections != null) {
    if (!Array.isArray(patch.connections)) throw new Error('connections 必须是数组');
    connections = patch.connections.map(function (connection) {
      if (!connection || connection.type !== 'character') throw new Error('人格只支持 character 绑定');
      var char = hostEntityCharacter(connection.id, context.char);
      if (!char) throw new Error('未找到可绑定的角色：' + String(connection.id));
      return char.id;
    });
  }
  hostEntitySetAvatar(persona, avatarData);
  cardFrontendRequireCurrent(live);
  if (original && !D.personas.includes(original)) throw new Error('人格在更新期间已被修改');
  var journal = createMutationJournal();
  if (original) persona = journal.replaceRecord(original, persona);
  else journal.splice(D.personas, D.personas.length, 0, [persona]);
  if (connections !== undefined) hostEntitySetPersonaBindings(persona, connections, journal);
  D.personas.forEach(function (row) {
    if (row === persona || connections === undefined) return;
    var bound = personaBoundCharIds(row);
    if (
      !bound.some(function (id) {
        return connections.includes(id);
      })
    )
      return;
    hostEntitySetPersonaBindings(
      row,
      bound.filter(function (id) {
        return !connections.includes(id);
      }),
      journal
    );
  });
  journal.capture(D, ['activePersonaId'], true);
  if (patch.is_default === true) D.activePersonaId = persona.id;
  else if (patch.is_default === false && D.activePersonaId === persona.id) D.activePersonaId = null;
  journal.seal();
  try {
    await saveData(['personas', 'meta']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  invalidateCacheContexts();
  refreshCardScriptLibraryContext(context.char, context.session);
  await hostEntityRender('personas', render, function () {
    renderPersonaList();
    renderChat();
    updateChatUI();
  });
  return mode === 'replace' ? undefined : creating;
}
async function hostEntityDeletePersona(live, name) {
  var context = cardFrontendRequireCurrent(live),
    persona = hostEntityPersona(name, context.char);
  if (!persona) return false;
  var journal = createMutationJournal();
  journal.splice(D.personas, D.personas.indexOf(persona), 1);
  Object.values(D.chats || {}).forEach(function (box) {
    (box.sessions || []).forEach(function (session) {
      if (session && session.personaId === persona.id) {
        journal.capture(session, ['personaId'], true);
        delete session.personaId;
      }
    });
  });
  journal.capture(D, ['activePersonaId'], true);
  if (D.activePersonaId === persona.id) D.activePersonaId = D.personas[0] ? D.personas[0].id : null;
  journal.seal();
  try {
    await saveData(['personas', 'meta', 'sessions']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  invalidateCacheContexts();
  renderPersonaList();
  renderChat();
  updateChatUI();
  refreshCardScriptLibraryContext(context.char, context.session);
  return true;
}

// STScript entity commands use the same stores as the editors, but do not carry a
// card-frontend live object. This adapter supplies the current owner only for the
// duration of the transactional entity writers above.
function hostEntityStscriptLive() {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  if (!char || !session) throw new Error('当前没有可用的角色或对话');
  return { charId: char.id, owner: { sessionId: session.id } };
}
function hostEntityStscriptCharacterArgs(args) {
  args = args || {};
  var patch = {};
  var fields = {
    name: 'name',
    description: 'description',
    personality: 'personality',
    scenario: 'scenario',
    messageExamples: 'message_examples',
    creatorNotes: 'creator_notes',
    systemPrompt: 'system_prompt',
    postHistoryInstructions: 'post_history_instructions',
    creator: 'creator',
    characterVersion: 'version',
  };
  Object.keys(fields).forEach(function (key) {
    if (hostWriteOwn(args, key)) patch[fields[key]] = String(args[key] == null ? '' : args[key]);
  });
  if (hostWriteOwn(args, 'firstMessage')) patch.first_messages = [String(args.firstMessage || '')];
  if (hostWriteOwn(args, 'tags'))
    patch.tags = String(args.tags || '')
      .split(',')
      .map(function (value) {
        return value.trim();
      })
      .filter(Boolean);
  if (hostWriteOwn(args, 'talkativeness')) patch.talkativeness = Number(args.talkativeness);
  if (hostWriteOwn(args, 'favorite')) patch.favorite = stscriptIsTrue(args.favorite);
  if (hostWriteOwn(args, 'world')) patch.worldbook = String(args.world || '');
  if (hostWriteOwn(args, 'avatar')) patch.avatar = args.avatar;
  if (
    hostWriteOwn(args, 'depthPrompt') ||
    hostWriteOwn(args, 'depthPromptDepth') ||
    hostWriteOwn(args, 'depthPromptRole')
  ) {
    patch.depth_prompt = {};
    if (hostWriteOwn(args, 'depthPrompt')) patch.depth_prompt.prompt = String(args.depthPrompt || '');
    if (hostWriteOwn(args, 'depthPromptDepth')) {
      var depth = Number(args.depthPromptDepth);
      if (!Number.isFinite(depth)) throw new Error('depthPromptDepth 必须是数字');
      patch.depth_prompt.depth = depth;
    }
    if (hostWriteOwn(args, 'depthPromptRole')) {
      var role = String(args.depthPromptRole || 'system');
      if (!['system', 'user', 'assistant'].includes(role)) throw new Error('depthPromptRole 无效');
      patch.depth_prompt.role = role;
    }
  }
  return patch;
}
function hostEntityStscriptCharacterData(char) {
  var ext = (char && char.extensions) || {},
    depth = ext.depth_prompt || {};
  return {
    avatar: String(char.id),
    name: String(char.name || ''),
    description: String(char.description || ''),
    personality: String(char.personality || ''),
    scenario: String(char.scenario || ''),
    first_mes: String(char.first_mes || ''),
    mes_example: String(char.mes_example || ''),
    creator_notes: String(char.creator_notes || ''),
    system_prompt: String(char.system_prompt || ''),
    post_history_instructions: String(char.post_history_instructions || ''),
    creator: String(char.creator || ''),
    character_version: String(char.character_version || ''),
    tags: Array.isArray(char.tags) ? char.tags.slice() : [],
    talkativeness: Number.isFinite(Number(ext.talkativeness ?? char.talkativeness))
      ? Number(ext.talkativeness ?? char.talkativeness)
      : 0.5,
    fav: char.fav === true || ext.fav === true,
    world: String(ext.world || ''),
    depth_prompt: cloneData(depth),
    chat: String((D.chats[char.id] || {}).activeSid || ''),
    create_date: Number(char.creation_date || 0),
  };
}
async function hostEntityStscriptCreateCharacter(args) {
  var name = String((args && args.name) || '').trim();
  if (!name) throw new Error('/char-create 需要 name');
  var before = new Set(
    D.characters.map(function (row) {
      return row.id;
    })
  );
  await hostEntityWriteCharacter(hostEntityStscriptLive(), name, hostEntityStscriptCharacterArgs(args), 'create', {
    render: 'immediate',
  });
  var created = D.characters.find(function (row) {
    return !before.has(row.id);
  });
  if (!created) return '';
  if (!stscriptIsFalse(args.select) && typeof stscriptSelectCharacter === 'function')
    await stscriptSelectCharacter(created.id);
  return created.id;
}
async function hostEntityStscriptUpdateCharacter(args) {
  var current = typeof getChar === 'function' ? getChar() : null,
    char = hostEntityCharacter(args && args.char, current);
  if (!char) return '';
  await hostEntityWriteCharacter(hostEntityStscriptLive(), char.id, hostEntityStscriptCharacterArgs(args), 'replace', {
    render: 'immediate',
  });
  return char.id;
}
async function hostEntityStscriptDuplicateCharacter(args) {
  var current = typeof getChar === 'function' ? getChar() : null,
    source = hostEntityCharacter(args && args.char, current);
  if (!source) return '';
  var copy = cloneData(source),
    journal = createMutationJournal(),
    base = String(source.name || '角色') + ' Copy',
    name = base,
    suffix = 2;
  while (
    D.characters.some(function (row) {
      return String(row.name).toLowerCase() === name.toLowerCase();
    })
  )
    name = base + ' ' + suffix++;
  copy.id = 'c_' + uid();
  copy.name = name;
  journal.splice(D.characters, D.characters.length, 0, [copy]);
  journal.capture(D.chats, [copy.id], true);
  D.chats[copy.id] = { sessions: [], activeSid: null };
  journal.seal();
  try {
    await saveData(['characters', 'sessions']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  renderCharList();
  if (stscriptIsTrue(args && args.select) && typeof stscriptSelectCharacter === 'function')
    await stscriptSelectCharacter(copy.id);
  return copy.id;
}
async function hostEntityStscriptDeleteCharacter(args) {
  var current = typeof getChar === 'function' ? getChar() : null,
    char = hostEntityCharacter(args && args.char, current);
  if (!char) return false;
  if (!stscriptIsTrue(args && args.silent)) {
    var confirmed = await appConfirm(
      '删除角色「' + canonicalCharacterName(char) + '」及其全部对话？',
      '删除角色',
      '删除'
    );
    if (!confirmed) return false;
  }
  return deleteCharacterData(char.id);
}
function hostEntityStscriptFindCharacter(args, value) {
  var text = String(value == null ? '' : value).trim(),
    key = text.toLowerCase(),
    requested = args && args.tag != null ? (Array.isArray(args.tag) ? args.tag : [args.tag]) : [],
    tags = requested.map(function (tag) {
      return String(tag).trim().toLowerCase();
    }),
    matches = D.characters.filter(function (char) {
      if (!char) return false;
      var names = [char.id, char.name].concat(char.nameAliases || []).map(function (name) {
        return String(name || '').toLowerCase();
      });
      if (key && !names.includes(key)) return false;
      var owned = (char.tags || []).map(function (tag) {
        return String(tag).toLowerCase();
      });
      return tags.every(function (tag) {
        return owned.includes(tag);
      });
    });
  var current = typeof getChar === 'function' ? getChar() : null;
  if (
    matches.length > 1 &&
    !stscriptIsFalse(args && args.preferCurrent) &&
    current &&
    matches.some(function (row) {
      return row.id === current.id;
    })
  )
    return current.id;
  if (matches.length > 1 && !stscriptIsTrue(args && args.quiet) && typeof toast === 'function')
    toast('找到多个符合条件的角色，已使用第一个。', 'info');
  return matches.length ? matches[0].id : '';
}
async function hostEntityStscriptSetTag(char, name, present) {
  if (!char || !String(name || '').trim()) return false;
  var tag = String(name).trim(),
    rows = Array.isArray(char.tags) ? char.tags : [],
    before = rows.slice(),
    index = before.findIndex(function (value) {
      return String(value).toLowerCase() === tag.toLowerCase();
    });
  if ((present && index >= 0) || (!present && index < 0)) return false;
  var journal = createMutationJournal();
  if (!Array.isArray(char.tags)) {
    journal.capture(char, ['tags'], true);
    char.tags = rows = [];
  }
  if (present) journal.splice(rows, rows.length, 0, [tag]);
  else journal.splice(rows, index, 1);
  journal.seal();
  try {
    await saveData('characters');
  } catch (error) {
    journal.rollback();
    throw error;
  }
  renderCharList();
  return true;
}
function hostEntityStscriptPersonaArgs(args) {
  args = args || {};
  var patch = {},
    positions = { inPrompt: 0, atDepth: 1, none: 2 },
    roles = { system: 0, user: 1, assistant: 2 };
  if (hostWriteOwn(args, 'description')) patch.description = String(args.description || '');
  if (hostWriteOwn(args, 'title')) patch.title = String(args.title || '');
  if (hostWriteOwn(args, 'descriptionPosition')) {
    if (!hostWriteOwn(positions, args.descriptionPosition)) throw new Error('descriptionPosition 无效');
    patch.position = positions[args.descriptionPosition];
  }
  if (hostWriteOwn(args, 'name')) {
    var name = String(args.name || '').trim();
    if (name) patch.name = name;
  }
  if (hostWriteOwn(args, 'descriptionDepth')) {
    var depth = Number(args.descriptionDepth);
    if (!Number.isFinite(depth)) throw new Error('descriptionDepth 必须是数字');
    patch.depth = depth;
  }
  if (hostWriteOwn(args, 'descriptionRole')) {
    if (!hostWriteOwn(roles, args.descriptionRole)) throw new Error('descriptionRole 无效');
    patch.role = roles[args.descriptionRole];
  }
  if (hostWriteOwn(args, 'lorebook')) patch.lorebook = String(args.lorebook || '');
  if (hostWriteOwn(args, 'avatar')) patch.avatar = args.avatar;
  return patch;
}
function hostEntityStscriptPersonaData(persona) {
  var view = hostEntityPersonaView(persona);
  return {
    avatar: view.avatar,
    name: view.name,
    description: view.description,
    title: view.title,
    position: view.position,
    depth: view.depth,
    role: view.role,
    lorebook: view.lorebook,
    default: view.is_default,
    connections: view.connections,
  };
}
async function hostEntityStscriptCreatePersona(args) {
  var name = String((args && args.name) || '').trim();
  if (!name) throw new Error('/persona-create 需要 name');
  var patch = hostEntityStscriptPersonaArgs(args);
  patch.avatar_id = 'p_' + uid();
  patch.is_default = !stscriptIsFalse(args.select);
  var created = await hostEntityWritePersona(hostEntityStscriptLive(), name, patch, 'create', { render: 'immediate' });
  return created ? patch.avatar_id : '';
}
async function hostEntityStscriptUpdatePersona(args) {
  var current = typeof getChar === 'function' ? getChar() : null,
    persona = hostEntityPersona(args && args.persona, current);
  if (!persona) return '';
  await hostEntityWritePersona(hostEntityStscriptLive(), persona.id, hostEntityStscriptPersonaArgs(args), 'replace', {
    render: 'immediate',
  });
  return persona.id;
}
async function hostEntityStscriptDuplicatePersona(args) {
  var char = typeof getChar === 'function' ? getChar() : null,
    source = hostEntityPersona(args && args.persona, char);
  if (!source) return '';
  var copy = cloneData(source),
    base = String(source.name || '人格') + ' Copy',
    name = base,
    suffix = 2;
  while (
    D.personas.some(function (row) {
      return String(row.name).toLowerCase() === name.toLowerCase();
    })
  )
    name = base + ' ' + suffix++;
  copy.id = 'p_' + uid();
  copy.name = name;
  setPersonaBoundCharIds(copy, []);
  var journal = createMutationJournal();
  journal.splice(D.personas, D.personas.length, 0, [copy]);
  journal.capture(D, ['activePersonaId'], true);
  if (stscriptIsTrue(args && args.select)) D.activePersonaId = copy.id;
  journal.seal();
  try {
    await saveData(['personas', 'meta']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  renderPersonaList();
  renderChat();
  return copy.id;
}
async function hostEntityStscriptDeletePersona(args) {
  var char = typeof getChar === 'function' ? getChar() : null,
    persona = hostEntityPersona(args && args.persona, char);
  if (!persona) return false;
  if (!stscriptIsTrue(args && args.silent)) {
    var confirmed = await appConfirm('删除人格「' + String(persona.name || '') + '」？', '删除人格', '删除');
    if (!confirmed) return false;
  }
  return hostEntityDeletePersona(hostEntityStscriptLive(), persona.id);
}
function hostEntityStscriptCurrentPersonaContext() {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    persona = char && hostEntityPersona('', char);
  if (!char || !session || !persona) throw new Error('当前没有可用的人格');
  return { char: char, session: session, persona: persona };
}
async function hostEntityStscriptPersonaLock(type, value) {
  var context = hostEntityStscriptCurrentPersonaContext(),
    persona = context.persona,
    char = context.char,
    session = context.session;
  type = String(type || 'chat');
  if (!['chat', 'character', 'default'].includes(type)) return null;
  var current =
    type === 'chat'
      ? session.personaId === persona.id
      : type === 'character'
        ? personaBoundCharIds(persona).includes(char.id)
        : D.activePersonaId === persona.id;
  if (String(value || '').trim() === '') return current;
  var text = String(value).trim().toLowerCase(),
    next = ['toggle', 't'].includes(text)
      ? !current
      : stscriptIsTrue(text)
        ? true
        : stscriptIsFalse(text)
          ? false
          : null;
  if (next == null) return null;
  var journal = createMutationJournal();
  journal.capture(D, ['activePersonaId'], true);
  journal.capture(session, ['personaId'], true);
  if (type === 'chat') {
    if (next) session.personaId = persona.id;
    else if (session.personaId === persona.id) delete session.personaId;
  } else if (type === 'character') {
    var ids = personaBoundCharIds(persona);
    hostEntitySetPersonaBindings(
      persona,
      next
        ? Array.from(new Set(ids.concat(char.id)))
        : ids.filter(function (id) {
            return id !== char.id;
          }),
      journal
    );
  } else if (next) D.activePersonaId = persona.id;
  else if (D.activePersonaId === persona.id) D.activePersonaId = null;
  journal.seal();
  try {
    await saveData(['personas', 'meta', 'sessions']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  renderPersonaList();
  renderChat();
  updateChatUI();
  return next;
}
async function hostEntityStscriptSetPersona(name, mode) {
  mode = String(mode || 'all');
  if (!['lookup', 'temp', 'all'].includes(mode)) throw new Error('mode 必须是 lookup、temp 或 all');
  name = String(name || '').trim();
  if (!name) throw new Error('/persona-set 需要人格名称');
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    persona = mode === 'temp' ? null : hostEntityPersona(name, char),
    journal = createMutationJournal();
  journal.capture(D, ['activePersonaId'], true);
  journal.capture(session, ['temporaryUserName'], true);
  if (persona) {
    D.activePersonaId = persona.id;
    if (session) delete session.temporaryUserName;
  } else if (mode === 'lookup') return false;
  else if (session) session.temporaryUserName = name;
  journal.seal();
  try {
    await saveData(['meta', 'sessions']);
  } catch (error) {
    journal.rollback();
    throw error;
  }
  renderPersonaList();
  renderChat();
  updateChatUI();
  return true;
}
async function hostEntityStscriptSyncPersona(args, value) {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    persona = char && getActivePersona(char.id);
  if (!session || !persona) return false;
  var rows = session.msgs || [],
    start = 0,
    end = rows.length - 1,
    range = String(value || '')
      .trim()
      .match(/^(\d+)(?:-(\d+))?$/);
  if (String(value || '').trim() && !range) return false;
  if (range) {
    start = Number(range[1]);
    end = range[2] == null ? start : Number(range[2]);
  }
  var from = String((args && args.from) || '').trim(),
    indexes = [];
  for (var index = Math.max(0, start); index <= Math.min(end, rows.length - 1); index++) {
    var message = rows[index];
    if (
      message &&
      message.role === 'user' &&
      (!from || String(message.name || '') === from) &&
      message.name !== persona.name
    )
      indexes.push(index);
  }
  if (!indexes.length) return false;
  var live = hostEntityStscriptLive();
  if (
    stscriptIsFalse(args && args.quiet) &&
    !(await appConfirm(
      '将 ' + indexes.length + ' 条用户消息的名称同步为「' + persona.name + '」？',
      '同步人格',
      '同步'
    ))
  )
    return false;
  await hostWriteMessageTransaction(live, indexes[0], 'affected', function (_, liveSession) {
    indexes.forEach(function (index) {
      var message = liveSession.msgs[index];
      if (
        !message ||
        message.role !== 'user' ||
        (from && String(message.name || '') !== from) ||
        message.name === persona.name
      )
        return;
      message.name = persona.name;
    });
  });
  return true;
}
function hostEntityStscriptMessageIndex(value, length) {
  var index = value == null || String(value).trim() === '' ? length - 1 : Number(value);
  if (!Number.isInteger(index)) return null;
  if (index < 0 || Object.is(index, -0)) index = length + index;
  return index >= 0 && index < length ? index : null;
}
function hostEntityStscriptMessageName(message, char, session) {
  if (message && String(message.name || '').trim()) return String(message.name);
  if (!message) return '';
  if (message.role === 'user') {
    if (session && String(session.temporaryUserName || '').trim()) return String(session.temporaryUserName);
    var persona = getActivePersona(char && char.id);
    return String((persona && persona.name) || '用户');
  }
  return message.role === 'assistant' ? String((char && canonicalCharacterName(char)) || '角色') : '';
}
async function hostEntityStscriptMessageField(field, at, value) {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    rows = (session && session.msgs) || [],
    index = hostEntityStscriptMessageIndex(at, rows.length),
    message = index == null ? null : rows[index];
  if (!message) return '';
  var text = String(value == null ? '' : value).trim();
  if (field === 'role') {
    if (!['user', 'assistant', 'system'].includes(text.toLowerCase())) return String(message.role || 'assistant');
    text = text.toLowerCase();
  } else if (!text) return hostEntityStscriptMessageName(message, char, session);
  await hostWriteMessageTransaction(hostEntityStscriptLive(), index, 'affected', function () {
    message[field] = text;
  });
  return text;
}
async function hostEntityStscriptDeleteMessages(count) {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    rows = (session && session.msgs) || [],
    n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > rows.length) return '';
  var start = rows.length - n,
    text =
      rows
        .slice(start)
        .map(function (row) {
          return String(row.content || '');
        })
        .join('\n') + '\n';
  await hostWriteMessageTransaction(hostEntityStscriptLive(), start, 'affected', function (_, liveSession) {
    liveSession.msgs.splice(start, n);
  });
  return text;
}
async function hostEntityStscriptDeleteMessagesByName(name) {
  if (!String(name || '').trim()) return '';
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    rows = (session && session.msgs) || [],
    matchedChar = hostEntityCharacter(name, char),
    wanted = String((matchedChar && matchedChar.name) || name || ''),
    indexes = [];
  rows.forEach(function (message, index) {
    if (hostEntityStscriptMessageName(message, char, session) === wanted) indexes.push(index);
  });
  if (!indexes.length) return '';
  await hostWriteMessageTransaction(hostEntityStscriptLive(), indexes[0], 'affected', function (_, liveSession) {
    for (var at = indexes.length - 1; at >= 0; at--) liveSession.msgs.splice(indexes[at], 1);
  });
  return '';
}
// A chat lock outranks a character binding, which outranks the global/default
// persona. A temporary name is represented as a session-scoped synthetic persona.
var _hostEntityBaseGetActivePersona = typeof getActivePersona === 'function' ? getActivePersona : null;
if (_hostEntityBaseGetActivePersona)
  getActivePersona = function (charId) {
    var resolved = charId === undefined ? String(D.currentCharId || '') : String(charId || ''),
      box = D.chats && D.chats[resolved],
      session =
        box &&
        (box.sessions || []).find(function (row) {
          return row.id === box.activeSid;
        });
    if (session && String(session.temporaryUserName || '').trim())
      return { id: '', name: String(session.temporaryUserName), desc: '', boundCharIds: [] };
    if (session && session.personaId) {
      var locked = D.personas.find(function (row) {
        return row.id === session.personaId;
      });
      if (locked) return locked;
    }
    return _hostEntityBaseGetActivePersona(resolved);
  };
function hostEntityHistoryBrief(char) {
  if (!char) return null;
  return ((D.chats[char.id] && D.chats[char.id].sessions) || []).map(function (session) {
    var messages = session.msgs || [],
      last = messages[messages.length - 1];
    return {
      file_name: session.id + '.jsonl',
      ch_name: String(char.name),
      avatar_url: String(char.id),
      chat_items: messages.length,
      mes: last ? String(last.content || '') : '',
      last_mes: last ? Number(last.time || 0) : Number(session.createdAt || 0),
      file_size: String(
        new Blob([
          messages
            .map(function (message) {
              return JSON.stringify(cardFrontendSillyTavernMessage(char, message));
            })
            .join('\n'),
        ]).size
      ),
    };
  });
}
function hostEntityHistoryDetail(rows, group) {
  if (group) throw new Error('夜欲不支持群聊历史');
  var result = {};
  (Array.isArray(rows) ? rows : [])
    .filter(function (row) {
      return row && typeof row.file_name === 'string' && row.file_name;
    })
    .sort(function (a, b) {
      return b.file_name.localeCompare(a.file_name);
    })
    .forEach(function (row) {
      var char = hostEntityCharacter(
          row.avatar_url || row.ch_name || row.character_name || row.file_name.split(' - ')[0]
        ),
        box = char && D.chats[char.id],
        session =
          box &&
          (box.sessions || []).find(function (item) {
            return item.id === row.file_name.replace(/\.jsonl$/, '');
          });
      if (session)
        result[row.file_name] = (session.msgs || []).map(function (message) {
          return cardFrontendSillyTavernMessage(char, message);
        });
    });
  return result;
}
async function hostEntityUpdate(live, kind, args) {
  var context = cardFrontendRequireCurrent(live),
    character = kind === 'Character',
    original = character ? hostEntityCharacter(args.name, context.char) : hostEntityPersona(args.name, context.char);
  if (!original) throw new Error('实体不存在：' + String(args.name));
  if (typeof args.updater !== 'function') throw new Error('updater 必须是函数');
  var value = await args.updater(character ? hostEntityCharacterView(original) : hostEntityPersonaView(original));
  cardFrontendRequireCurrent(live);
  if (!(character ? D.characters : D.personas).includes(original)) throw new Error('实体在更新期间已被修改');
  await (character ? hostEntityWriteCharacter : hostEntityWritePersona)(
    live,
    original.id,
    value,
    'replace',
    args.option
  );
  return value;
}
function hostEntityCall(live, name, args) {
  if (name === 'updateCharacterWith' || name === 'updatePersonaWith')
    return {
      handled: true,
      value: hostEntityUpdate(live, name === 'updateCharacterWith' ? 'Character' : 'Persona', args),
    };
  if (
    !/^(?:getCharacterNames|getCharacterIds|getCurrentCharacterName|getCurrentCharacterId|getCharacter|createCharacter|createOrReplaceCharacter|replaceCharacter|deleteCharacter|getCharData|getCharAvatarPath|getChatHistoryBrief|getChatHistoryDetail|getPersonaNames|getPersonaIds|getCurrentPersonaName|getCurrentPersonaId|getPersonaAvatarPath|getPersona|createPersona|createOrReplacePersona|replacePersona|deletePersona)$/.test(
      name
    )
  )
    return null;
  var context = cardFrontendRequireCurrent(live),
    a = args || {},
    char = hostEntityCharacter(a.name, context.char),
    persona = hostEntityPersona(a.name, context.char),
    handled = function (value) {
      return { handled: true, value: value };
    };
  if (name === 'getCharacterNames')
    return handled(
      hostEntityPersistentCharacters().map(function (row) {
        return String(row.name);
      })
    );
  if (name === 'getCharacterIds')
    return handled(
      hostEntityPersistentCharacters().map(function (row) {
        return row.id;
      })
    );
  if (name === 'getCurrentCharacterName') return handled(context.char.name || null);
  if (name === 'getCurrentCharacterId') return handled(context.char.id || null);
  if (name === 'getCharData') return handled(hostEntityRawCharacter(char));
  if (name === 'getCharAvatarPath') return handled(hostEntityAvatarPath(char));
  if (name === 'getChatHistoryBrief') return handled(Promise.resolve(hostEntityHistoryBrief(char)));
  if (name === 'getChatHistoryDetail') return handled(Promise.resolve(hostEntityHistoryDetail(a.rows, a.group)));
  if (name === 'getCharacter') {
    if (!char) throw new Error('角色卡不存在：' + String(a.name));
    return handled(Promise.resolve(hostEntityCharacterView(char)));
  }
  if (name === 'deleteCharacter') return handled(char ? deleteCharacterData(char.id) : Promise.resolve(false));
  if (['createCharacter', 'createOrReplaceCharacter', 'replaceCharacter'].includes(name))
    return handled(
      hostEntityWriteCharacter(
        live,
        a.name,
        a.value,
        { createCharacter: 'create', createOrReplaceCharacter: 'upsert', replaceCharacter: 'replace' }[name],
        a.option
      )
    );
  if (name === 'getPersonaNames')
    return handled(
      D.personas.map(function (row) {
        return String(row.name);
      })
    );
  if (name === 'getPersonaIds')
    return handled(
      D.personas.map(function (row) {
        return row.id;
      })
    );
  if (name === 'getCurrentPersonaName') return handled(persona ? persona.name : null);
  if (name === 'getCurrentPersonaId') return handled(persona ? persona.id : null);
  if (name === 'getPersonaAvatarPath') return handled(hostEntityAvatarPath(persona));
  if (name === 'getPersona') {
    if (!persona) throw new Error('人格不存在或名称不唯一：' + String(a.name));
    return handled(hostEntityPersonaView(persona));
  }
  if (name === 'deletePersona') return handled(hostEntityDeletePersona(live, a.name));
  return handled(
    hostEntityWritePersona(
      live,
      a.name,
      a.value,
      { createPersona: 'create', createOrReplacePersona: 'upsert', replacePersona: 'replace' }[name],
      a.option
    )
  );
}
