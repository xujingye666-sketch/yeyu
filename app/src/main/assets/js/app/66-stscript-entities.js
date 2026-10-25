// ===== STScript character, persona, chat and message commands =====
function stscriptEntityArgs(names) {
  return String(names || '')
    .split(',')
    .filter(Boolean)
    .map(function (name) {
      return { name: name };
    });
}
function stscriptEntityReturn(args, value) {
  var mode = String((args && args.return) || 'pipe').toLowerCase();
  if (mode === 'object') return value;
  var text = value && typeof value === 'object' ? JSON.stringify(value) : value == null ? '' : String(value);
  if (mode === 'popup') {
    return scriptDialog('脚本结果', '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>').then(function () {
      return '';
    });
  }
  return text;
}
function stscriptEntityCurrentCharacter(value) {
  var current = typeof getChar === 'function' ? getChar() : null;
  return hostEntityCharacter(String(value || '').trim(), current);
}
function stscriptEntityCurrentPersona(value) {
  var current = typeof getChar === 'function' ? getChar() : null;
  return hostEntityPersona(String(value || '').trim(), current);
}
function stscriptEntityMessageIndex(value) {
  var rows = typeof stscriptMsgs === 'function' ? stscriptMsgs() : [];
  return hostEntityStscriptMessageIndex(value, rows.length) ?? -1;
}

stscriptAddCommand({
  name: 'chat-manager',
  aliases: ['chat-history', 'manage-chats'],
  callback: function () {
    stscriptOpenSessionManager();
    return '';
  },
});
stscriptAddCommand({
  name: 'go',
  aliases: ['char'],
  callback: async function (_, value) {
    var id = hostEntityStscriptFindCharacter({ preferCurrent: 'true' }, stscriptJoin(value));
    if (!id) return '';
    var char = hostEntityCharacter(id, null);
    if (!(await stscriptSelectCharacter(id))) return '';
    return String(char.name || '');
  },
});
stscriptAddCommand({
  name: 'newchat',
  namedArgumentList: [{ name: 'delete' }],
  callback: async function (args) {
    await stscriptCreateSession({ deleteCurrent: stscriptIsTrue(args.delete) });
    return '';
  },
});
stscriptAddCommand({
  name: 'delchat',
  callback: async function () {
    await stscriptDeleteCurrentSession();
    return '';
  },
});
stscriptAddCommand({
  name: 'renamechat',
  callback: async function (_, value) {
    await stscriptRenameCurrentSession(stscriptJoin(value));
    return '';
  },
});
stscriptAddCommand({
  name: 'closechat',
  callback: async function () {
    await stscriptCloseCurrentChat();
    return '';
  },
});
stscriptAddCommand({
  name: 'chat-reload',
  callback: async function () {
    await stscriptReloadCurrentChat();
    return '';
  },
});
stscriptAddCommand({
  name: 'rename-char',
  namedArgumentList: [{ name: 'silent' }, { name: 'chats' }],
  callback: async function (args, value) {
    var name = stscriptJoin(value).trim();
    var silent = args.silent == null || !stscriptIsFalse(args.silent);
    if (!name && !silent && typeof appInput === 'function')
      name = String(
        (await appInput('新的角色名称：', '', '重命名角色', '角色名称', { okText: '保存名称' })) || ''
      ).trim();
    if (!name) return 'false';
    var char = typeof getChar === 'function' ? getChar() : null;
    if (!char) return 'false';
    var oldName = String(char.name || '');
    var result = await hostEntityStscriptUpdateCharacter({ char: char.id, name: name });
    if (result && stscriptIsTrue(args.chats)) {
      var changed = [],
        box = D.chats[char.id];
      ((box && box.sessions) || []).forEach(function (session) {
        (session.msgs || []).forEach(function (message) {
          if (message && message.name === oldName) {
            changed.push(message);
            message.name = name;
          }
        });
      });
      try {
        if (changed.length) await saveData('sessions');
      } catch (error) {
        changed.forEach(function (message) {
          message.name = oldName;
        });
        throw error;
      }
    }
    return String(!!result);
  },
});
stscriptAddCommand({
  name: 'char-find',
  dryRun: 'run',
  aliases: ['findchar'],
  namedArgumentList: [{ name: 'tag' }, { name: 'preferCurrent' }, { name: 'quiet' }],
  callback: function (args, value) {
    return hostEntityStscriptFindCharacter(
      stscriptDryRunning(args) ? Object.assign({}, args, { quiet: 'true' }) : args,
      stscriptJoin(value)
    );
  },
});
stscriptAddCommand({
  name: 'char-create',
  namedArgumentList: stscriptEntityArgs(
    'name,description,firstMessage,personality,scenario,messageExamples,creatorNotes,systemPrompt,postHistoryInstructions,creator,characterVersion,tags,favorite,avatar,talkativeness,world,depthPrompt,depthPromptDepth,depthPromptRole,select'
  ),
  callback: function (args) {
    return hostEntityStscriptCreateCharacter(args);
  },
});
stscriptAddCommand({
  name: 'char-update',
  namedArgumentList: stscriptEntityArgs(
    'char,name,description,firstMessage,personality,scenario,messageExamples,creatorNotes,systemPrompt,postHistoryInstructions,creator,characterVersion,tags,favorite,avatar,talkativeness,world,depthPrompt,depthPromptDepth,depthPromptRole'
  ),
  callback: function (args) {
    return hostEntityStscriptUpdateCharacter(args);
  },
});
stscriptAddCommand({
  name: 'char-duplicate',
  aliases: ['dupe'],
  namedArgumentList: [{ name: 'char' }, { name: 'select' }],
  callback: function (args) {
    return hostEntityStscriptDuplicateCharacter(args);
  },
});
stscriptAddCommand({
  name: 'char-get',
  dryRun: stscriptDryRunReadUnlessShown('pipe'),
  aliases: ['char-data'],
  namedArgumentList: [{ name: 'char' }, { name: 'field' }, { name: 'return' }],
  callback: function (args) {
    var char = stscriptEntityCurrentCharacter(args.char);
    if (!char) return '';
    var data = hostEntityStscriptCharacterData(char);
    if (args.field) {
      var value = data[args.field];
      if (args.field === 'tags' && Array.isArray(value)) value = value.join(', ');
      return stscriptEntityReturn(args, value === undefined ? '' : value);
    }
    return stscriptEntityReturn(args, data);
  },
});
stscriptAddCommand({
  name: 'char-delete',
  namedArgumentList: [{ name: 'char' }, { name: 'silent' }],
  callback: async function (args) {
    return String(await hostEntityStscriptDeleteCharacter(args));
  },
});

['tag-add', 'tag-remove'].forEach(function (command) {
  stscriptAddCommand({
    name: command,
    namedArgumentList: [{ name: 'name' }],
    callback: async function (args, value) {
      var char = stscriptEntityCurrentCharacter(args.name);
      return String(await hostEntityStscriptSetTag(char, stscriptJoin(value), command === 'tag-add'));
    },
  });
});
stscriptAddCommand({
  name: 'tag-exists',
  dryRun: 'run',
  namedArgumentList: [{ name: 'name' }],
  callback: function (args, value) {
    var char = stscriptEntityCurrentCharacter(args.name),
      tag = stscriptJoin(value).trim().toLowerCase();
    return String(
      !!char &&
        (char.tags || []).some(function (row) {
          return String(row).toLowerCase() === tag;
        })
    );
  },
});
stscriptAddCommand({
  name: 'tag-list',
  dryRun: 'run',
  namedArgumentList: [{ name: 'name' }],
  callback: function (args) {
    var char = stscriptEntityCurrentCharacter(args.name);
    return char ? (char.tags || []).join(', ') : '';
  },
});
stscriptAddCommand({
  name: 'tag-import',
  dryRun: 'run',
  namedArgumentList: [{ name: 'name' }, { name: 'mode' }],
  callback: function (args) {
    var char = stscriptEntityCurrentCharacter(args.name);
    if (!char || String(args.mode || '').toLowerCase() === 'none') return 'false';
    // Night stores one canonical tag list. There is no second folder-tag database
    // to import into, so an already-normalized card has no changes to apply.
    return 'false';
  },
});

stscriptAddCommand({
  name: 'branch-create',
  namedArgumentList: [{ name: 'mesId' }],
  callback: async function (args, value) {
    var index = stscriptEntityMessageIndex(args.mesId == null ? stscriptJoin(value) : args.mesId);
    return index < 0 ? '' : await createBranchAtMessage(index, { postCommitRun: stscriptPostCommitRun(args) });
  },
});
stscriptAddCommand({
  name: 'checkpoint-create',
  namedArgumentList: [{ name: 'mesId' }],
  callback: async function (args, value) {
    var index = stscriptEntityMessageIndex(args.mesId),
      name = stscriptJoin(value).trim();
    return index < 0
      ? ''
      : await createBranchAtMessage(index, {
          switchTo: false,
          checkpoint: true,
          name: name,
          postCommitRun: stscriptPostCommitRun(args),
        });
  },
});
stscriptAddCommand({
  name: 'checkpoint-get',
  dryRun: 'run',
  namedArgumentList: [{ name: 'mesId' }],
  callback: function (args, value) {
    var index = stscriptEntityMessageIndex(args.mesId == null ? stscriptJoin(value) : args.mesId),
      message = stscriptMsgs()[index];
    return message ? String(message.checkpointName || '') : '';
  },
});
stscriptAddCommand({
  name: 'checkpoint-go',
  namedArgumentList: [{ name: 'mesId' }],
  callback: async function (args, value) {
    var index = stscriptEntityMessageIndex(args.mesId == null ? stscriptJoin(value) : args.mesId),
      message = stscriptMsgs()[index],
      char = typeof getChar === 'function' ? getChar() : null;
    if (!message || !message.checkpointSessionId || !char) return '';
    var target = findSession(char.id, message.checkpointSessionId);
    if (!target || !(await stscriptSwitchSession(target.id))) return '';
    return String(target.name || message.checkpointName || '');
  },
});
stscriptAddCommand({
  name: 'checkpoint-list',
  dryRun: 'run',
  namedArgumentList: [{ name: 'links' }],
  callback: function (args) {
    var links = stscriptIsTrue(args.links),
      out = [];
    stscriptMsgs().forEach(function (message, index) {
      if (message && message.checkpointSessionId) out.push(links ? String(message.checkpointName || '') : index);
    });
    return JSON.stringify(out);
  },
});
stscriptAddCommand({
  name: 'checkpoint-parent',
  dryRun: 'run',
  callback: function () {
    var char = typeof getChar === 'function' ? getChar() : null,
      session = char && getActiveSession(char.id),
      parent = session && session.checkpoint && findSession(char.id, session.parentSessionId);
    return parent ? String(parent.name || '') : '';
  },
});
stscriptAddCommand({
  name: 'checkpoint-exit',
  callback: async function () {
    var char = typeof getChar === 'function' ? getChar() : null,
      session = char && getActiveSession(char.id),
      parent = session && session.checkpoint && findSession(char.id, session.parentSessionId);
    if (!parent || !(await stscriptSwitchSession(parent.id))) return '';
    return String(parent.name || '');
  },
});

stscriptAddCommand({
  name: 'persona-create',
  namedArgumentList: stscriptEntityArgs(
    'name,description,title,descriptionPosition,descriptionDepth,descriptionRole,lorebook,avatar,select'
  ),
  callback: function (args) {
    return hostEntityStscriptCreatePersona(args);
  },
});
stscriptAddCommand({
  name: 'persona-update',
  namedArgumentList: stscriptEntityArgs(
    'persona,name,description,title,descriptionPosition,descriptionDepth,descriptionRole,lorebook,avatar'
  ),
  callback: function (args) {
    return hostEntityStscriptUpdatePersona(args);
  },
});
stscriptAddCommand({
  name: 'persona-duplicate',
  namedArgumentList: [{ name: 'persona' }, { name: 'select' }],
  callback: function (args) {
    return hostEntityStscriptDuplicatePersona(args);
  },
});
stscriptAddCommand({
  name: 'persona-get',
  dryRun: stscriptDryRunReadUnlessShown('pipe'),
  aliases: ['persona-data'],
  namedArgumentList: [{ name: 'persona' }, { name: 'field' }, { name: 'return' }],
  callback: function (args) {
    var persona = stscriptEntityCurrentPersona(args.persona);
    if (!persona || !persona.id) return '';
    var data = hostEntityStscriptPersonaData(persona);
    return stscriptEntityReturn(args, args.field ? (data[args.field] ?? '') : data);
  },
});
stscriptAddCommand({
  name: 'persona-delete',
  namedArgumentList: [{ name: 'persona' }, { name: 'silent' }],
  callback: async function (args) {
    return String(await hostEntityStscriptDeletePersona(args));
  },
});
stscriptAddCommand({
  name: 'persona-lock',
  dryRun: stscriptDryRunReadIfBlank,
  aliases: ['lock', 'bind'],
  namedArgumentList: [{ name: 'type' }],
  callback: async function (args, value) {
    var result = await hostEntityStscriptPersonaLock(args.type, stscriptJoin(value));
    return result == null ? '' : String(result);
  },
});
stscriptAddCommand({
  name: 'persona-set',
  aliases: ['persona', 'name'],
  namedArgumentList: [{ name: 'mode' }],
  callback: async function (args, value) {
    await hostEntityStscriptSetPersona(stscriptJoin(value), args.mode);
    return '';
  },
});
stscriptAddCommand({
  name: 'persona-sync',
  aliases: ['sync'],
  namedArgumentList: [{ name: 'from' }, { name: 'quiet' }],
  callback: async function (args, value) {
    await hostEntityStscriptSyncPersona(args, stscriptJoin(value));
    return '';
  },
});

stscriptAddCommand({
  name: 'message-role',
  dryRun: function (args, value) {
    return ['user', 'assistant', 'system'].includes(stscriptJoin(value).trim().toLowerCase()) ? null : 'run';
  },
  namedArgumentList: [{ name: 'at' }],
  callback: function (args, value) {
    return hostEntityStscriptMessageField('role', args.at, stscriptJoin(value));
  },
});
stscriptAddCommand({
  name: 'message-name',
  dryRun: stscriptDryRunReadIfBlank,
  namedArgumentList: [{ name: 'at' }],
  callback: function (args, value) {
    return hostEntityStscriptMessageField('name', args.at, stscriptJoin(value));
  },
});
stscriptAddCommand({
  name: 'del',
  aliases: ['delete', 'delmode'],
  callback: async function (_, value) {
    var text = stscriptJoin(value).trim();
    if (!text) {
      if (typeof toast === 'function') toast('轻触消息后可使用“删除”操作', 'info');
      return '';
    }
    return hostEntityStscriptDeleteMessages(text);
  },
});
stscriptAddCommand({
  name: 'delname',
  aliases: ['cancel'],
  callback: function (_, value) {
    return hostEntityStscriptDeleteMessagesByName(stscriptJoin(value).trim());
  },
});
