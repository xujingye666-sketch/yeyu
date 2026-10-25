function hostImportResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
// TavernHelper's importRawCharacter replaces the whole character file (preserved_name import), so the
// replacement keeps the new card's fields, extensions and rawCard as they are. Only Yeyu-local state
// crosses over; the id, chats, persona and world-book bindings follow through commitPreparedCharacterCards.
var HOST_IMPORT_LOCAL_FIELDS = ['favorite', 'fav', 'scriptsEnabled', 'regexEnabled', 'selectedBackground'];
var HOST_IMPORT_LOCAL_YEYU_KEYS = ['componentImportMode', 'expressions', 'risuLorebookState'];
// A stored image the new card does not supply stays, with the import notes describing where it came from.
var HOST_IMPORT_MEDIA_META = {
  avatar_image: ['sourceAvatar', 'avatarUserReplaced'],
  background_image: [
    'sourceBackground',
    'sourceBackgroundStatus',
    'backgroundExplicit',
    'backgroundUserReplaced',
    'derivedBackgroundDisabled',
    'backgroundPresentation',
    'backgroundPresentationVersion',
  ],
};
// Stored assets are named by id (by name for older id-less rows), as background references resolve them.
function hostImportAssetId(asset) {
  return String((asset && (asset.id || asset.name)) || '');
}
// The replaced character's assets that local state still points at: its expression bindings, and every
// background selection or session lock naming this character. These are user uploads the new card cannot
// supply, so they stay with the character unless the new card brings an asset of the same id. The carried
// row keeps its media key, which keeps its stored bytes referenced.
function hostImportReferencedAssets(original, card) {
  var referenced = new Set(),
    provided = new Set((Array.isArray(card.media_assets) ? card.media_assets : []).map(hostImportAssetId)),
    expressions = objectRecord(objectRecord(original.extensions) && original.extensions.yeyu),
    reference = function (ref) {
      if (ref && ref.charId === original.id && ref.assetId) referenced.add(String(ref.assetId));
    };
  expressions = expressions && objectRecord(expressions.expressions);
  (expressions && Array.isArray(expressions.bindings) ? expressions.bindings : []).forEach(function (row) {
    if (row && row.assetId) referenced.add(String(row.assetId).trim());
  });
  (D.characters || []).forEach(function (row) {
    reference(row && row.selectedBackground);
  });
  Object.values(D.chats || {}).forEach(function (box) {
    ((box && box.sessions) || []).forEach(function (session) {
      reference(session && session.lockedBackground);
    });
  });
  return (Array.isArray(original.media_assets) ? original.media_assets : []).filter(function (asset) {
    var id = hostImportAssetId(asset);
    return id && referenced.has(id) && !provided.has(id);
  });
}
function hostImportCarryLocalState(original, card) {
  HOST_IMPORT_LOCAL_FIELDS.forEach(function (key) {
    if (hostWriteOwn(original, key)) card[key] = cloneData(original[key]);
  });
  // The display name belongs to the unchanged character name. A creator note the new card did not change
  // is not shown again once seen, and keeps its translation unless the new card brings its own.
  if (original.localizedName && !card.localizedName) card.localizedName = original.localizedName;
  if (String(original.creator_notes || '') === String(card.creator_notes || '')) {
    if (original.creatorNotesShownAt) card.creatorNotesShownAt = original.creatorNotesShownAt;
    if (original.creator_notes_zh && !card.creator_notes_zh) card.creator_notes_zh = original.creator_notes_zh;
  }
  var yeyu = objectRecord(objectRecord(original.extensions) && original.extensions.yeyu),
    carried = {};
  HOST_IMPORT_LOCAL_YEYU_KEYS.forEach(function (key) {
    if (yeyu && hostWriteOwn(yeyu, key)) carried[key] = cloneData(yeyu[key]);
  });
  if (Object.keys(carried).length) {
    var extensions = objectRecord(card.extensions) || {};
    card.extensions = Object.assign({}, extensions, {
      yeyu: Object.assign({}, objectRecord(extensions.yeyu) || {}, carried),
    });
  }
  var assets = hostImportReferencedAssets(original, card);
  if (assets.length) card.media_assets = (Array.isArray(card.media_assets) ? card.media_assets : []).concat(assets);
  Object.keys(HOST_IMPORT_MEDIA_META).forEach(function (field) {
    var stored =
      original[field] ||
      (original._media && original._media[field]) ||
      (original._mediaBlobs && original._mediaBlobs[field]);
    if (card[field] || !stored) return;
    card[field] = original[field];
    ['_media', '_mediaHash'].forEach(function (key) {
      if (!original[key] || !original[key][field]) return;
      card[key] = Object.assign({}, card[key] || {});
      card[key][field] = cloneData(original[key][field]);
    });
    copyStoredMediaBlobs(original, card, field === 'avatar_image', field === 'background_image');
    var meta = original.importMeta || {};
    card.importMeta = card.importMeta || {};
    HOST_IMPORT_MEDIA_META[field].forEach(function (key) {
      if (hostWriteOwn(meta, key)) card.importMeta[key] = cloneData(meta[key]);
    });
  });
}
function hostImportReportSyncedBooks(name, card) {
  var synced = (card.importMeta.worldBookImportReport || {}).synced || [];
  if (!synced.length) return;
  toast(
    '角色「' +
      name +
      '」已按新卡更新随卡世界书：' +
      synced
        .map(function (row) {
          return (
            '「' +
            row.name +
            '」的 ' +
            row.replaced +
            ' 条随卡条目替换为新卡的 ' +
            row.imported +
            ' 条' +
            (row.kept ? '，保留 ' + row.kept + ' 条自行添加的条目' : '')
          );
        })
        .join('；'),
    'info'
  );
}
async function hostImportCharacter(live, name, content) {
  if (!hostEntityBlob(content)) throw new Error('importRawCharacter 需要 PNG、JSON 或 CHARX Blob');
  var charxName = /\.charx$/i.test(String(name || ''));
  name = String(name || '').replace(/\.(?:png|json|charx)$/i, '');
  if (!name || name === 'current') throw new Error('请提供角色文件名');
  var original = hostEntityCharacter(name, cardFrontendRequireCurrent(live).char),
    bytes = new Uint8Array(await content.slice(0, 8).arrayBuffer()),
    png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71,
    charx = charxName || /charx/i.test(content.type) || (bytes[0] === 80 && bytes[1] === 75),
    parsed = charx
      ? await readCHARX(new File([content], name + '.charx'))
      : png
        ? await readPNG(new File([content], name + '.png', { type: 'image/png' }))
        : parseCard(JSON.parse(await content.text()));
  if (!parsed) throw new Error('文件中没有可读取的角色卡');
  try {
    var card = initializeCardForImport(parsed);
    card.name = name;
    await prepareCardMediaForImport(card, createCardImportImageBatch());
    cardFrontendRequireCurrent(live);
    if (original && !D.characters.includes(original)) throw new Error('待替换角色在导入期间已被修改');
    if (original) hostImportCarryLocalState(original, card);
    await commitPreparedCharacterCards([card], { replaceId: original && original.id });
    hostImportReportSyncedBooks(name, card);
    await refreshCharacterData(card);
    return hostImportResponse({ file_name: card.id });
  } finally {
    releasePendingImportUrls([parsed]);
  }
}
function hostImportFailed(kind, name, error) {
  toast(kind + '「' + name + '」导入失败：' + String((error && error.message) || error || '未知错误'), 'err');
  return false;
}
async function hostImportPreset(live, name, content) {
  cardFrontendRequireCurrent(live);
  var raw, imported, result;
  function withImportedRow(current) {
    var rows = cloneData(current.chatCompletionPresets || []),
      index = rows.findIndex(function (row) {
        return row.name === name;
      });
    if (index < 0) rows.push(cloneData(imported));
    else rows[index] = cloneData(imported);
    return rows;
  }
  try {
    result = completionPresetImportRaw(name, JSON.parse(String(content)), []);
    imported = result.row;
    raw = imported.preset;
    if (result.notices.length) toast('预设「' + name + '」：' + result.notices.join('；'), 'info');
  } catch (error) {
    return hostImportFailed('预设', name, error);
  }
  // The active check shares the queue slot with the write: a switch queued ahead of this import may change
  // which preset is active, and only the preset active when the write runs may replace chatCompletionPresetInUse.
  return completionPresetQueueRuntime(async function () {
    var settings = D.settings;
    if (settings.activeChatCompletionPresetName === name) {
      if (
        !(await completionPresetApplySettingsInQueue(
          function (current) {
            return { chatCompletionPresets: withImportedRow(current), chatCompletionPresetInUse: cloneData(raw) };
          },
          name,
          function (error) {
            hostImportFailed('预设', name, error);
          }
        ))
      )
        return false;
    } else {
      var before = settings.chatCompletionPresets;
      settings.chatCompletionPresets = withImportedRow(settings);
      try {
        await saveData('meta');
      } catch (error) {
        settings.chatCompletionPresets = before;
        return hostImportFailed('预设', name, error);
      }
    }
    completionPresetSyncHostWrite(name);
    return true;
  });
}
async function hostImportWorldbook(live, name, content) {
  cardFrontendRequireCurrent(live);
  var journal = createMutationJournal();
  try {
    var raw = JSON.parse(String(content));
    if (!objectRecord(raw) || (!objectRecord(raw.entries) && !Array.isArray(raw.entries)))
      throw new Error('世界书缺少有效的 entries');
    var groups = parseStandaloneWorldBookImportGroups({ name: name, entries: raw.entries }),
      group = groups[0];
    if (!group) throw new Error('没有可导入的世界书');
    var existing = hostWriteWorldbookCategory(name, false),
      built = buildStandaloneWorldBookCategory(group, 'direct', []),
      category = Object.assign({}, existing || built.category, {
        name: String(name),
        entries: group.entries.map(function (entry) {
          return normalizeWBEntry(entry);
        }),
      });
    normalizeWorldBookCategoryEntryIds(category);
    category.sourceMeta = Object.assign({}, category.sourceMeta || {}, { raw: cloneData(raw) });
    if (existing) {
      hostWriteReplaceWorldbookEntries(existing, category.entries, journal);
      journal.capture(existing, ['sourceMeta'], true);
      existing.sourceMeta = category.sourceMeta;
    } else journal.splice(D.worldBook.categories, D.worldBook.categories.length, 0, [category]);
    journal.seal();
    invalidateCacheContexts();
    await saveData(['worldbook', 'sessions']);
  } catch (error) {
    journal.rollback();
    return hostImportFailed('世界书', name, error);
  }
  hostWriteRenderWorldbook({ render: 'immediate' });
  return true;
}
function hostImportRegex(live, name, content) {
  var writer = cardFrontendRequireCurrent(live).char,
    raw = JSON.parse(String(content));
  if (!objectRecord(raw) || !hostWriteOwn(raw, 'findRegex')) return false;
  raw.id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uid();
  raw.scriptName = String(name);
  var before = D.settings.regexScripts || [],
    row = normalizeRegexScriptRecord(raw);
  // Like every global row a card script writes, it belongs to the writing character.
  row.ownerCharacterId = String(writer.id || '');
  D.settings.regexScripts = before.concat([row]);
  invalidateRegexScriptRuntimeCache();
  invalidateCacheContexts();
  Promise.resolve(saveData('meta')).catch(function (error) {
    D.settings.regexScripts = D.settings.regexScripts.filter(function (item) {
      return item !== row;
    });
    invalidateRegexScriptRuntimeCache();
    hostImportFailed('正则', name, error);
  });
  regexScriptRefreshAfterChange();
  return true;
}
function hostImportCall(live, name, args) {
  var call = {
    importRawCharacter: hostImportCharacter,
    importRawPreset: hostImportPreset,
    importRawWorldbook: hostImportWorldbook,
    importRawTavernRegex: hostImportRegex,
  }[name];
  return call ? { handled: true, value: call(live, String((args && args.name) || ''), args && args.content) } : null;
}
