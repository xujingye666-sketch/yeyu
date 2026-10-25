// ===== Attachment Data Bank: existing data owners, media store, and vector cache =====
var _dataBankWriteTail = Promise.resolve(),
  _dataBankPromptBySession = new WeakMap(),
  _dataBankRunBySession = new WeakMap();
function dataBankContext(char, session) {
  return { data: D, char: char || null, session: session || null };
}
function dataBankCurrent() {
  var char = typeof getChar === 'function' ? getChar() : null;
  return dataBankContext(char, char && getActiveSession(char.id));
}
function dataBankOwner(context, source) {
  if (context.data !== D) throw new Error('数据已重新载入，请重新打开资料库');
  if (source === 'global') return { target: D.settings, section: 'meta' };
  if (!context.char || !D.characters.includes(context.char)) throw new Error('当前没有可用角色');
  if (source === 'character') return { target: context.char, section: 'characters' };
  var box = D.chats[context.char.id];
  if (source !== 'chat' || !context.session || !box || !(box.sessions || []).includes(context.session))
    throw new Error('当前没有可用对话');
  return { target: context.session, section: 'sessions' };
}
function dataBankRows(context, source, includeDisabled) {
  var sources = source ? [source] : ['global', 'chat', 'character'],
    rows = [];
  sources.forEach(function (scope) {
    if (!['global', 'chat', 'character'].includes(scope)) return;
    if ((scope === 'character' && !context.char) || (scope === 'chat' && !context.session)) return;
    var owner = dataBankOwner(context, scope);
    (Array.isArray(owner.target.dataBankAttachments) ? owner.target.dataBankAttachments : []).forEach(function (file) {
      if (file && (includeDisabled || file.disabled !== true)) rows.push({ file: file, source: scope });
    });
  });
  return rows;
}
function dataBankFind(rows, value) {
  var key = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  return (
    rows.find(function (row) {
      return String(row.file.url).trim().toLowerCase() === key;
    }) ||
    rows.find(function (row) {
      return String(row.file.name).trim().toLowerCase() === key;
    })
  );
}
function dataBankMissing(value) {
  if (typeof toast === 'function') toast('资料库中没有找到附件：' + String(value || ''), 'info');
  return '';
}
function dataBankInvalidate() {
  _dataBankPromptBySession = new WeakMap();
}
function dataBankWrite(context, source, edit) {
  var task = _dataBankWriteTail.then(async function () {
    var owner = dataBankOwner(context, source),
      before = owner.target.dataBankAttachments,
      rows = Array.isArray(before) ? before.slice() : [],
      result = edit(rows);
    if (!result) return '';
    owner.target.dataBankAttachments = rows;
    try {
      await saveData(owner.section, { urgent: true });
    } catch (error) {
      if (owner.target.dataBankAttachments === rows) {
        if (before === undefined) delete owner.target.dataBankAttachments;
        else owner.target.dataBankAttachments = before;
      }
      throw error;
    }
    dataBankInvalidate();
    if (result.removed) await dataBankForgetAttachments(result.removed);
    return result.value || '';
  });
  _dataBankWriteTail = task.catch(function () {});
  return task;
}
function dataBankNewFile(name, text, original) {
  var id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uid(),
    file = Object.assign({}, original || {}, {
      id: id,
      url: 'yeyu-attachment:' + id,
      name: String(name || new Date().toLocaleString()),
      created: Date.now(),
      size: new Blob([text]).size,
      disabled: false,
      text: String(text),
    });
  delete file.mediaKey;
  delete file.mediaHash;
  delete file.data_url;
  return file;
}
function dataBankAdd(context, source, name, text) {
  return dataBankWrite(context, source, function (rows) {
    var file = dataBankNewFile(name, String(text == null ? '' : text));
    rows.push(file);
    return { value: file.url };
  });
}
function dataBankUpdate(context, source, selectors, text) {
  return dataBankWrite(context, source, function (rows) {
    var found;
    selectors.some(function (selector) {
      found = dataBankFind(
        rows.map(function (file) {
          return { file: file };
        }),
        selector
      );
      return !!found;
    });
    if (!found) {
      dataBankMissing(selectors.filter(Boolean).join(' / '));
      return null;
    }
    var file = dataBankNewFile(found.file.name, String(text == null ? '' : text), found.file);
    rows.splice(rows.indexOf(found.file), 1);
    rows.push(file);
    return { value: file.url, removed: [found.file.url] };
  });
}
function dataBankDelete(context, source, value) {
  return dataBankWrite(context, source, function (rows) {
    var found = dataBankFind(
      rows.map(function (file) {
        return { file: file };
      }),
      value
    );
    if (!found) {
      dataBankMissing(value);
      return null;
    }
    for (var index = rows.length - 1; index >= 0; index--)
      if (rows[index].url === found.file.url) rows.splice(index, 1);
    return { removed: [found.file.url] };
  });
}
async function dataBankSetDisabled(context, source, value, disabled) {
  var found = dataBankFind(dataBankRows(context, source, true), value);
  if (!found) return dataBankMissing(value);
  return dataBankWrite(context, found.source, function (rows) {
    var index = rows.findIndex(function (file) {
      return file.url === found.file.url;
    });
    if (index < 0) return null;
    rows[index] = Object.assign({}, rows[index], { disabled: disabled === true });
    return {};
  });
}
async function dataBankText(file) {
  if (typeof file.text === 'string') return file.text;
  if (typeof file.data_url === 'string' && file.data_url.startsWith('data:'))
    return await (await fetch(file.data_url)).text();
  var blob = await YeyuRepository.loadMediaBlob(file.mediaKey);
  if (!blob) throw new Error('附件内容缺失，请重新导入：' + String(file.name || file.url));
  return blob.text();
}
function dataBankSettings() {
  var saved = D.settings.dataBank || {};
  function number(key, fallback, min, max) {
    var value = Number(saved[key]);
    return saved[key] == null || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, value));
  }
  return {
    enabled: D.settings.vectorFilesEnabled === true,
    sizeThreshold: number('sizeThreshold', 5, 0, Infinity),
    chunkSize: Math.floor(number('chunkSize', 2500, 1, Infinity)),
    chunkCount: Math.floor(number('chunkCount', 5, 1, Infinity)),
    overlap: number('overlap', 0, 0, 99),
    queryMessages: memoryV5Number(D.settings.memoryQueryMessageLimit, 4, 8, 6),
    threshold: typeof worldBookSettings === 'function' ? worldBookSettings().vectorScoreThreshold : 0.25,
    template: saved.template == null ? 'Related information:\n{{text}}' : String(saved.template),
    position: ['before_prompt', 'in_prompt', 'in_chat', 'none'].includes(saved.position) ? saved.position : 'in_prompt',
    depth: Math.floor(number('depth', 4, 0, 100)),
    role: ['user', 'assistant', 'system'].includes(saved.role) ? saved.role : 'system',
    shouldScan: saved.shouldScan === true,
  };
}
function dataBankSaveSettings(patch, enabled) {
  var data = D,
    task = _dataBankWriteTail.then(async function () {
      if (D !== data) throw new Error('数据已重新载入，请重新打开资料库');
      var settings = data.settings,
        before = settings.dataBank,
        beforeEnabled = settings.vectorFilesEnabled,
        beforeQuery = settings.memoryQueryMessageLimit;
      settings.dataBank = Object.assign({}, before || {}, patch || {});
      delete settings.dataBank.queryMessages;
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'queryMessages'))
        settings.memoryQueryMessageLimit = memoryV5Number(patch.queryMessages, 4, 8, 6);
      if (enabled !== undefined) settings.vectorFilesEnabled = enabled === true;
      try {
        await saveData('meta', { urgent: true });
      } catch (error) {
        if (before === undefined) delete settings.dataBank;
        else settings.dataBank = before;
        if (beforeEnabled === undefined) delete settings.vectorFilesEnabled;
        else settings.vectorFilesEnabled = beforeEnabled;
        if (beforeQuery === undefined) delete settings.memoryQueryMessageLimit;
        else settings.memoryQueryMessageLimit = beforeQuery;
        throw error;
      }
      dataBankInvalidate();
      return dataBankSettings();
    });
  _dataBankWriteTail = task.catch(function () {});
  return task;
}
function dataBankSplit(text, length, delimiters) {
  if (length <= 0) return [text];
  delimiters = delimiters || ['\n\n', '\n', ' ', ''];
  var delimiter = delimiters[0] || '',
    parts = text.split(delimiter).flatMap(function (part) {
      return part.length < length || !delimiter ? part : dataBankSplit(part, length, delimiters.slice(1));
    }),
    result = [];
  for (var index = 0; index < parts.length; ) {
    var chunk = parts[index++];
    while (index < parts.length && chunk.length + parts[index].length + delimiter.length <= length)
      chunk += delimiter + parts[index++];
    result.push(chunk);
  }
  return result;
}
function dataBankChunks(text, file, settings) {
  var length = file.size > settings.sizeThreshold * 1024 ? settings.chunkSize : -1,
    overlap = length > 0 ? Math.round((length * settings.overlap) / 100) : 0,
    chunks = dataBankSplit(text, overlap > 0 ? Math.max(1, length - overlap) : length);
  if (!overlap) return chunks;
  return chunks.map(function (chunk, index) {
    var half = Math.floor(overlap / 2),
      before = index && half ? chunks[index - 1].slice(-half) : '',
      after = index < chunks.length - 1 ? chunks[index + 1].slice(0, half) : '',
      first = before.indexOf('.'),
      skip = 2;
    ['!', '?', '\n'].forEach(function (character) {
      var at = before.indexOf(character);
      if (at > 0 && at < first) {
        first = at;
        skip = character === '\n' ? 1 : 2;
      }
    });
    if (first > 0) before = before.substring(first + skip);
    var characters = Array.from(after),
      punctuation = new Set([
        '.',
        '!',
        '?',
        '*',
        '"',
        ')',
        '}',
        '`',
        ']',
        '$',
        '。',
        '！',
        '？',
        '”',
        '）',
        '】',
        '’',
        '」',
        '_',
      ]);
    for (var at = characters.length - 1; at >= 0; at--) {
      var emoji = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u.test(characters[at]);
      if (punctuation.has(characters[at]) || emoji) {
        after = characters.slice(0, !emoji && at > 0 && /\s/.test(characters[at - 1]) ? at : at + 1).join('');
        break;
      }
    }
    return [before, chunk, after.trimEnd()].filter(Boolean).join(' ');
  });
}
function dataBankCachePrefix(url) {
  return 'databank:' + YeyuRepository.hashValue(String(url)) + ':';
}
function dataBankAttachmentUrls(owners) {
  var urls = [];
  (owners || []).forEach(function (owner) {
    (owner && Array.isArray(owner.dataBankAttachments) ? owner.dataBankAttachments : []).forEach(function (file) {
      if (file && file.url && urls.indexOf(String(file.url)) < 0) urls.push(String(file.url));
    });
  });
  return urls;
}
// 角色或对话删除后，附件的片段向量只在全局、任一角色或对话都不再引用该附件时删除；复制角色和支线会共用 url。
function dataBankForgetAttachments(urls) {
  var owners = [D.settings].concat(D.characters || []);
  Object.keys(D.chats || {}).forEach(function (charId) {
    owners = owners.concat((D.chats[charId] && D.chats[charId].sessions) || []);
  });
  var referenced = dataBankAttachmentUrls(owners),
    gone = (urls || []).filter(function (url) {
      return referenced.indexOf(url) < 0;
    });
  if (!gone.length) return Promise.resolve();
  dataBankInvalidate();
  return YeyuRepository.deleteVectorCachePrefixes(gone.map(dataBankCachePrefix)).catch(function (error) {
    console.warn('资料库向量缓存清理失败', error);
  });
}
async function dataBankWithController(options, action) {
  options = options || {};
  var parent = options.abortController || options.controller,
    signal = options.signal || (parent && parent.signal),
    controller = new AbortController(),
    cancel = function () {
      controller.abort();
    };
  if (signal && signal.aborted) cancel();
  if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', cancel, { once: true });
  else if (parent && typeof parent.onAbort === 'function') parent.onAbort(cancel);
  var releaseController =
    !options.preview && typeof registerTransientRequestController === 'function'
      ? registerTransientRequestController(controller)
      : null;
  function check() {
    if (controller.signal.aborted) throw vectorRetrievalAbortError();
  }
  try {
    check();
    var result = await action(controller, check);
    check();
    return result;
  } finally {
    if (releaseController) releaseController();
    if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', cancel);
    else if (parent && typeof parent.offAbort === 'function') parent.offAbort(cancel);
  }
}
async function dataBankIngestRows(context, source, settings, config, controller, check, options) {
  var files = dataBankRows(context, source, false),
    candidates = [];
  function fresh() {
    check();
    var current = dataBankRows(context, source, false);
    if (
      files.some(function (row) {
        return !current.some(function (value) {
          return value.file === row.file;
        });
      })
    )
      throw new Error('附件已改变，请重新检索');
  }
  for (var row of files) {
    fresh();
    var text = await dataBankText(row.file),
      unique = new Map();
    dataBankChunks(text, row.file, settings).forEach(function (text, index) {
      if (!text) return;
      unique.set(text, {
        id: row.file.url + '#' + index,
        url: row.file.url,
        name: row.file.name,
        text: text,
        index: index,
        key: dataBankCachePrefix(row.file.url) + YeyuVectorRetrieval.vectorCacheKey(text, config),
      });
    });
    candidates.push.apply(candidates, Array.from(unique.values()));
  }
  fresh();
  var records = await YeyuRepository.loadVectorCache(
      candidates.map(function (row) {
        return row.key;
      })
    ),
    byKey = new Map(
      records.map(function (row) {
        return [row.key, row.vector];
      })
    ),
    missing = candidates.filter(function (row) {
      return !byKey.has(row.key);
    });
  for (var index = 0; index < missing.length; index += 5) {
    fresh();
    var batch = missing.slice(index, index + 5),
      vectors = await YeyuVectorRetrieval.requestEmbeddings(
        batch.map(function (row) {
          return row.text;
        }),
        config,
        { controller: controller }
      );
    fresh();
    var cacheRows = batch.map(function (row, at) {
      byKey.set(row.key, vectors[at]);
      return { key: row.key, vector: vectors[at], updatedAt: Date.now() };
    });
    await YeyuRepository.saveVectorCache(cacheRows);
  }
  fresh();
  return {
    candidates: candidates.map(function (row) {
      return Object.assign({}, row, { vector: byKey.get(row.key) });
    }),
    check: fresh,
  };
}
async function dataBankIngest(context, source, options) {
  return dataBankWithController(options, async function (controller, check) {
    return (
      await dataBankIngestRows(
        context,
        source,
        dataBankSettings(),
        normalizeEmbeddingSettings(D.settings),
        controller,
        check
      )
    ).candidates;
  });
}
async function dataBankSearch(context, source, query, options) {
  options = options || {};
  query = String(query || '');
  if (!query.trim()) throw new Error('请输入资料库检索内容');
  return dataBankWithController(options, async function (controller, check) {
    var settings = dataBankSettings(),
      config = normalizeEmbeddingSettings(D.settings),
      ingested = await dataBankIngestRows(context, source, settings, config, controller, check, options),
      queryKey = YeyuVectorRetrieval.vectorCacheKey(query, config),
      cached = await YeyuRepository.loadVectorCache([queryKey]),
      vector = cached.length ? cached[0].vector : null;
    if (!ingested.candidates.length) return { urls: [], chunks: '', groups: new Map() };
    if (!vector) {
      vector = (await YeyuVectorRetrieval.requestEmbeddings([query], config, { controller: controller }))[0];
      ingested.check();
      await YeyuRepository.saveVectorCache([{ key: queryKey, vector: vector, updatedAt: Date.now() }]);
    }
    ingested.check();
    var count = Number(options.count),
      threshold = Number(options.threshold ?? settings.threshold),
      hits = YeyuVectorRetrieval.topMatches(vector, ingested.candidates, {
        limit: Number.isInteger(count) && count > 0 ? count : settings.chunkCount,
        minScore: Number.isNaN(threshold) ? settings.threshold : Math.max(0, Math.min(1, threshold)),
      }),
      grouped = new Map();
    hits.forEach(function (hit) {
      var row = ingested.candidates.find(function (row) {
        return row.id === hit.id;
      });
      if (!grouped.has(row.url)) grouped.set(row.url, []);
      grouped.get(row.url).push(Object.assign({}, row, { score: hit.score }));
    });
    var text = '';
    grouped.forEach(function (rows) {
      text +=
        Array.from(
          new Set(
            rows
              .sort(function (a, b) {
                return a.index - b.index;
              })
              .map(function (row) {
                return row.text;
              })
          )
        ).join('\n') + '\n\n';
    });
    return { urls: Array.from(grouped.keys()), chunks: text, groups: grouped };
  });
}
async function dataBankPurge(context) {
  if (dataBankSettings().enabled)
    await YeyuRepository.deleteVectorCachePrefixes(
      dataBankRows(context, '', false).map(function (row) {
        return dataBankCachePrefix(row.file.url);
      })
    );
  dataBankInvalidate();
  return '';
}
function dataBankQueryInput(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(function (row) {
      return row && !row.excludeFromWorldBook && !row.reverted;
    })
    .map(function (row) {
      return String(row.content || '').trim();
    });
}
function dataBankQuery(char, session, messages) {
  return dataBankQueryInput(messages)
    .map(function (text) {
      return cardFrontendSubstitudeMacros(char, session, text);
    })
    .filter(Boolean)
    .reverse()
    .slice(0, dataBankSettings().queryMessages)
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
function dataBankSignature(context) {
  return YeyuRepository.hashValue({
    files: dataBankRows(context, '', false).map(function (row) {
      return [row.source, row.file.url, row.file.mediaHash, row.file.text];
    }),
    settings: dataBankSettings(),
    route: YeyuVectorRetrieval.routeIdentity(normalizeEmbeddingSettings(D.settings)),
  });
}
// The result is kept on the session by its query and files: the same search reuses it, so a send right after a
// preview gets the previewed chunks, and any other search runs again.
async function dataBankPrepareForPrompt(char, session, messages, options) {
  options = options || {};
  var context = dataBankContext(char, session),
    run = {},
    previous = _dataBankPromptBySession.get(session);
  _dataBankRunBySession.set(session, run);
  _dataBankPromptBySession.delete(session);
  if (!dataBankSettings().enabled || !dataBankRows(context, '', false).length) return;
  var input = JSON.stringify(dataBankQueryInput(messages)),
    query = dataBankQuery(char, session, messages),
    signature = dataBankSignature(context);
  if (!query) return;
  if (previous && previous.query === query && previous.signature === signature) {
    _dataBankPromptBySession.set(session, Object.assign({}, previous, { input: input }));
    return;
  }
  var result;
  try {
    result = await dataBankSearch(context, '', query, options);
  } catch (error) {
    if (options.signal && options.signal.aborted) throw error;
    if (options.preview) {
      if (options.previewNotes) options.previewNotes.push('资料库附件检索失败，预览未包含附件内容；发送时会重新检索。');
    } else if (typeof toast === 'function') toast('附件检索失败，本次继续生成；请检查嵌入设置或重试资料库检索', 'info');
    return;
  }
  if (_dataBankRunBySession.get(session) !== run || dataBankSignature(context) !== signature)
    throw vectorRetrievalAbortError();
  _dataBankPromptBySession.set(session, { input: input, query: query, signature: signature, chunks: result.chunks });
}
function dataBankPromptSnapshot(char, session, messages) {
  var state = session && _dataBankPromptBySession.get(session),
    settings = dataBankSettings(),
    context = dataBankContext(char, session);
  if (
    !state ||
    !settings.enabled ||
    !state.chunks ||
    state.signature !== dataBankSignature(context) ||
    state.input !== JSON.stringify(dataBankQueryInput(messages))
  )
    return [];
  return [
    {
      id: '4_vectors_data_bank',
      content: settings.template.replace(/\{\{text\}\}/gi, function () {
        return state.chunks;
      }),
      position: settings.position,
      depth: settings.depth,
      role: settings.role,
      should_scan: settings.shouldScan,
      order: 0,
    },
  ];
}
