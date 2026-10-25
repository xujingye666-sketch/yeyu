// ===== World book import and localization =====
function wbCategoryStableFallback(cat) {
  var direct = String((cat && cat.name) || '').trim();
  if (direct && !isGenericExportWorldBookName(direct)) return direct;
  var bound = Array.isArray(cat && cat.boundCharIds) ? cat.boundCharIds.map(String).filter(Boolean) : [],
    ownerId = bound[0],
    owner =
      ownerId &&
      (D.characters || []).find(function (char) {
        return char && char.id === ownerId;
      }),
    ownerName = owner && canonicalCharacterName(owner);
  return ownerName ? ownerName + ' 世界书' : '导入世界书';
}
function wbCategoryDisplayName(cat) {
  var localized = String((cat && cat.localizedName) || '').trim();
  return localized && !isGenericExportWorldBookName(localized) ? localized : wbCategoryStableFallback(cat);
}
function wbEntryDisplayName(entry) {
  var localizedKeys = entry && Array.isArray(entry.keyAliases) ? entry.keyAliases : [],
    keys = entry && Array.isArray(entry.keys) ? entry.keys : [],
    content = String((entry && entry.content) || '')
      .replace(/\s+/g, ' ')
      .trim(),
    fallback =
      localizedKeys[0] || keys[0] || (content ? content.slice(0, 28) + (content.length > 28 ? '…' : '') : '未命名条目');
  return String((entry && entry.localizedName) || (entry && entry.name) || (entry && entry.comment) || fallback);
}
// A Risu card's books run in Risu's own lorebook matcher, which never reads Chinese aliases.
function wbCategoryLocalizesNamesOnly(cat) {
  if (!cat || cat.sourceType !== 'character_card') return false;
  var bound = Array.isArray(cat.boundCharIds) ? cat.boundCharIds : [],
    ownerId = String(cat.ownerCharId || (bound.length === 1 ? bound[0] : '') || ''),
    owner =
      ownerId &&
      (D.characters || []).find(function (char) {
        return char && char.id === ownerId;
      });
  return !!owner && cardLocalizesNamesOnly(owner);
}
function pendingWorldBookLocalizationEntries(cat) {
  var namesOnly = wbCategoryLocalizesNamesOnly(cat);
  return (cat && Array.isArray(cat.entries) ? cat.entries : []).filter(function (entry) {
    return entryLocalizationNeedsWork(entry, namesOnly);
  });
}
function wbCategoryNeedsLocalizationRetry(cat) {
  return worldBookCategoryNeedsLocalization(cat);
}
async function retryWorldBookLocalization(catId) {
  if (blockDuringGeneration('补全世界书汉化')) return;
  if (_importProgressActive) {
    toast('当前已有导入或汉化任务正在处理', 'info');
    return;
  }
  var cat = (D.worldBook.categories || []).find(function (row) {
    return row && row.id === catId;
  });
  if (!cat) return;
  var pendingEntries = pendingWorldBookLocalizationEntries(cat),
    categoryPending = wbCategoryNeedsLocalizationRetry(cat);
  if (!pendingEntries.length && !categoryPending) {
    toast('这个分类没有待补全的汉化内容', 'info');
    renderWBAll();
    return;
  }
  var route = resolveApiRoute('importLocalization');
  if (!route.apiKey && route.protocol !== 'grok-subscription') {
    toast('请先在设置中配置导入汉化使用的供应商和模型', 'err');
    return;
  }
  var ownerType = cat.sourceType === 'character_card' ? 'card' : 'group',
    categoryTask = categoryPending
      ? buildWorldBookCategoryNameTask(cat, ownerType, wbCategoryDisplayName(cat) + ' · 补全汉化')
      : null,
    tasks = (categoryTask ? [categoryTask] : []).concat(
      buildEntryTasks(
        cat,
        ownerType,
        pendingEntries,
        wbCategoryDisplayName(cat) + ' · 补全汉化',
        wbCategoryLocalizesNamesOnly(cat)
      )
    ),
    before = copyJsonData(cat);
  if (!tasks.length) {
    pendingEntries.forEach(function (entry) {
      entry.localizationStatus = 'complete';
    });
    if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts();
    await saveData(['worldbook', 'sessions']);
    renderWBAll();
    toast('剩余内容不需要翻译，已直接完成', 'ok');
    return;
  }
  showImportProgress(
    '正在补全世界书汉化',
    '仅处理 ' + (pendingEntries.length + (categoryPending ? 1 : 0)) + ' 项未完成内容…',
    tasks.length
  );
  try {
    var report = await runLocalizationTasks(tasks, '正在补全中文名称和触发词');
    report.unresolved =
      pendingWorldBookLocalizationEntries(cat).length + (wbCategoryNeedsLocalizationRetry(cat) ? 1 : 0);
    assertLocalizationReadyForCommit(report, '世界书补全汉化');
    if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts();
    await saveData(['worldbook', 'sessions'], { urgent: true });
    renderWBAll();
    renderWBSidebar();
    updateChatUI();
    toast('世界书汉化已全部补全', 'ok');
    return report;
  } catch (error) {
    Object.keys(cat).forEach(function (key) {
      delete cat[key];
    });
    Object.assign(cat, before);
    renderWBAll();
    toast('补全汉化未完成，原世界书保持不变：' + String(error.message || error), 'err');
  } finally {
    hideImportProgress();
  }
}

function auditStandaloneWorldBookImportLocalization(group) {
  var audit = createLocalizationAudit();
  auditWorldBookLocalization(audit, group || {}, 'worldbook', false);
  return finishLocalizationAudit(audit);
}

// SillyTavern importWorldInfo converts three foreign lorebook exports before saving. The rows below
// follow convertNovelLorebook, convertAgnaiMemoryBook and convertRisuLorebook field by field; every
// converted entry sits before the character (position 0) like it does there.
function convertForeignWorldBookJson(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  var list = function (value) {
      return Array.isArray(value) ? value : [];
    },
    split = function (value) {
      return String(value || '')
        .split(',')
        .map(function (key) {
          return key.trim();
        });
    },
    convert = function (rows, mapEntry) {
      return {
        name: source.name,
        entries: list(rows).map(function (entry, index) {
          entry = entry && typeof entry === 'object' ? entry : {};
          return Object.assign({ uid: index, displayIndex: index, position: 0, selectiveLogic: 0 }, mapEntry(entry));
        }),
      };
    };
  if (source.lorebookVersion !== undefined)
    return convert(source.entries, function (entry) {
      var displayName = entry.displayName;
      return {
        key: entry.keys,
        keysecondary: [],
        comment: displayName || '',
        content: entry.text,
        constant: false,
        selective: false,
        order: (entry.contextConfig && entry.contextConfig.budgetPriority) ?? 0,
        disable: !entry.enabled,
        addMemo: displayName !== undefined && String(displayName).trim() !== '',
      };
    });
  if (source.kind === 'memory')
    return convert(source.entries, function (entry) {
      return {
        key: entry.keywords,
        keysecondary: [],
        comment: entry.name,
        content: entry.entry,
        constant: false,
        selective: false,
        order: entry.weight,
        disable: !entry.enabled,
        addMemo: !!entry.name,
      };
    });
  if (source.type === 'risu')
    return convert(source.data, function (entry) {
      return {
        key: split(entry.key),
        keysecondary: entry.secondkey ? split(entry.secondkey) : [],
        comment: entry.comment,
        content: entry.content,
        constant: entry.alwaysActive,
        selective: entry.selective,
        order: entry.insertorder,
        disable: false,
        addMemo: true,
        probability: entry.activationPercent ?? 100,
        useProbability: entry.activationPercent ?? true,
      };
    });
  return null;
}
function parseStandaloneWorldBookImportGroups(json) {
  var source = copyJsonData(json),
    foreign = convertForeignWorldBookJson(source),
    root =
      foreign ||
      (source &&
        (source.worldBook ||
          source.world_book ||
          source.worldInfo ||
          source.world_info ||
          source.lorebook ||
          source.character_book)) ||
      source,
    groups = [];
  function values(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object')
      return Object.keys(value)
        .filter(function (key) {
          return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
        })
        .map(function (key) {
          return value[key];
        });
    return [];
  }
  function groupOf(raw, index, fallback, parent) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var sourceEntries = raw.entries || raw.items || raw.world_info || [],
      settingsSource = Object.assign(
        {},
        parent && typeof parent === 'object' && !Array.isArray(parent) ? parent : {},
        raw,
        raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {}
      );
    return {
      name: String(raw.name || raw.title || raw.label || fallback || '导入分类 ' + (index + 1)),
      description: String(raw.description || raw.comment || ''),
      extensions:
        raw.extensions && typeof raw.extensions === 'object' && !Array.isArray(raw.extensions) ? raw.extensions : {},
      settings: normalizeWBSettings(settingsSource),
      raw: raw,
      entries: values(sourceEntries),
    };
  }
  if (
    root &&
    root.data &&
    typeof root.data === 'object' &&
    !Array.isArray(root.data) &&
    !root.entries &&
    !root.categories &&
    !root.folders
  )
    root =
      root.data.worldBook ||
      root.data.world_book ||
      root.data.worldInfo ||
      root.data.world_info ||
      root.data.lorebook ||
      root.data.character_book ||
      root.data;
  var importedSettings = root && typeof root === 'object' && !Array.isArray(root) ? normalizeWBSettings(root) : null;
  if (Array.isArray(root))
    groups = [
      {
        name: '导入世界书',
        description: '',
        extensions: {},
        settings: null,
        raw: { entries: root },
        entries: root.slice(),
      },
    ];
  else if (root && (root.categories || root.folders)) {
    var categories = values(root.categories || root.folders);
    groups = categories.map(function (category, index) {
      return groupOf(category, index, '导入分类 ' + (index + 1), root);
    });
  } else if (root && root.character_book && root.character_book.entries)
    groups = [groupOf(root.character_book, 0, '角色世界书', root.character_book)];
  else if (root && (root.entries || root.items))
    groups = [
      {
        name: String(root.name || root.title || root.label || '导入世界书'),
        description: String(root.description || root.comment || ''),
        extensions:
          root.extensions && typeof root.extensions === 'object' && !Array.isArray(root.extensions)
            ? root.extensions
            : {},
        settings: importedSettings,
        raw: root,
        entries: values(root.entries || root.items),
      },
    ];
  else if (root && typeof root === 'object' && !Array.isArray(root)) {
    var rows = values(root);
    if (
      rows.some(function (row) {
        return row && typeof row === 'object' && (row.content || row.text || row.value || row.entry || row.prompt);
      })
    )
      groups = [
        { name: '导入世界书', description: '', extensions: {}, settings: importedSettings, raw: root, entries: rows },
      ];
  }
  groups.forEach(function (group) {
    // A converted foreign file keeps the file itself as the category's raw source.
    group._rawOriginal = copyJsonData(
      (foreign && source) ||
        group.raw || {
          name: group.name,
          description: group.description,
          extensions: group.extensions,
          settings: group.settings,
          entries: group.entries,
        }
    );
    group._entryRawOriginal = (group.entries || []).map(copyJsonData);
  });
  return groups;
}
function cloneWorldBookImportGroup(group) {
  return copyJsonData(group);
}
function buildStandaloneWorldBookCategory(group, mode, existingCategories) {
  group = group || {};
  mode = mode === 'ai' ? 'ai' : 'direct';
  existingCategories = Array.isArray(existingCategories) ? existingCategories : [];
  var sourceEntries = Array.isArray(group.entries) ? group.entries : [],
    rawEntries = Array.isArray(group._entryRawOriginal) ? group._entryRawOriginal : [],
    recognized = new Set(),
    blank = 0,
    unsupported = 0,
    unsupportedItems = worldBookImportUnsupportedItems(group, String(group.name || '导入世界书')),
    entries = [];
  sourceEntries.forEach(function (entry, index) {
    if (!hasSemanticWorldBookValue(entry)) {
      blank++;
      return;
    }
    Object.keys(entry && typeof entry === 'object' ? entry : {}).forEach(function (key) {
      if (
        [
          'enabled',
          'disable',
          'disabled',
          'constant',
          'always_active',
          'keys',
          'key',
          'keywords',
          'triggers',
          'primary_keys',
          'secondary_keys',
          'secondary',
          'keysecondary',
          'secondaryKeys',
          'selective',
          'use_regex',
          'useRegex',
          'selectiveLogic',
          'selective_logic',
          'probability',
          'useProbability',
          'use_probability',
          'position',
          'order',
          'insertion_order',
          'depth',
          'insertion_depth',
          'recursive',
          'excludeRecursion',
          'exclude_recursion',
          'preventRecursion',
          'prevent_recursion',
          'delayUntilRecursion',
          'delay_until_recursion',
          'caseSensitive',
          'case_sensitive',
          'matchWholeWords',
          'match_whole_words',
          'characterFilter',
          'character_filter',
          'sticky',
          'cooldown',
          'delay',
          'group',
          'group_override',
          'group_weight',
          'role',
          'extensions',
        ].includes(key)
      )
        recognized.add(key);
    });
    var runtime = copyJsonData(entry);
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
      blank++;
      return;
    }
    runtime._raw = copyJsonData(rawEntries[index] === undefined ? entry : rawEntries[index]);
    var normalized = normalizeWBEntry(runtime);
    if (normalized.position === 'outlet' && !normalized.outletName) unsupported++;
    entries.push(normalized);
  });
  var sourceName = String(group.name || '').trim(),
    base = mode === 'direct' ? sourceName : String(group.localizedName || sourceName).trim();
  if (!base) base = '导入世界书';
  var name = base,
    suffix = 2;
  while (
    existingCategories.some(function (category) {
      return category && String(category.name || '').trim() === name;
    })
  )
    name = base + ' #' + suffix++;
  var category = {
    id: 'cat_' + uid(),
    name: name,
    originalName: sourceName,
    localizedName: String(group.localizedName || group.localized_name || ''),
    description: String(group.description || ''),
    extensions: copyJsonData(
      group.extensions && typeof group.extensions === 'object' && !Array.isArray(group.extensions)
        ? group.extensions
        : {}
    ),
    settings: copyJsonData(group.settings || null),
    sourceMeta: { source: 'imported_worldbook', raw: copyJsonData(group._rawOriginal || null) },
    entries: entries,
    boundCharIds: [],
    sourceType: 'imported_worldbook',
  };
  normalizeWorldBookCategoryEntryIds(category);
  return {
    category: category,
    imported: entries.length,
    blank: blank,
    unsupported: unsupported,
    unsupportedItems: unsupportedItems,
    recognized: recognized.size,
  };
}
async function prepareWorldBookImportAttempts(items) {
  var attempts = [];
  for (var index = 0; index < (items || []).length; index++) {
    var item = items[index] || {},
      mode = item.mode === 'ai' ? 'ai' : 'direct',
      group = cloneWorldBookImportGroup(item.group);
    if (mode === 'ai') {
      var report = await localizeWorldBookGroups([group], { requireComplete: true }),
        audit = auditStandaloneWorldBookImportLocalization(group);
      report.unresolvedItems = audit.unresolvedItems || [];
      report.unresolved = Math.max(0, Number(audit.totalMissing) || 0);
      report.invalid = 0;
      assertLocalizationReadyForCommit(report, '世界书汉化', '世界书');
    }
    attempts.push({ group: group, sourceGroup: item.group, mode: mode, report: mode === 'ai' ? report : null });
  }
  return attempts;
}
function pendingWorldBookImportMode(group) {
  var current = _pendingWorldBookImportModes.get(group);
  return current === 'ai' || current === 'direct'
    ? current
    : recommendedCardImportMode(auditStandaloneWorldBookImportLocalization(group));
}
function setPendingWorldBookImportMode(index, mode) {
  var group = _pendingWorldBookImports[Number(index)];
  if (!group || !['ai', 'direct'].includes(mode)) return;
  _pendingWorldBookImportModes.set(group, mode);
  renderWBImportPreview();
}
function setAllPendingWorldBookImportModes(mode) {
  if (mode === 'suggested') _pendingWorldBookImportModes = new WeakMap();
  else if (mode === 'ai' || mode === 'direct')
    _pendingWorldBookImports.forEach(function (group) {
      _pendingWorldBookImportModes.set(group, mode);
    });
  renderWBImportPreview();
}
function resetPendingWorldBookImport(clearPaste) {
  _pendingWorldBookImports = [];
  _pendingWorldBookImportModes = new WeakMap();
  if (typeof $ === 'function') {
    var preview = $('wb-import-preview');
    if (preview) preview.innerHTML = '';
    if (clearPaste && $('wb-paste')) $('wb-paste').value = '';
  }
}
function worldBookImportLanguageLabel(language) {
  return language === 'chinese' ? '纯中文' : language === 'mixed' ? '中英混合' : '主要非中文';
}
function renderWBImportPreview() {
  var preview = $('wb-import-preview');
  if (!preview) return;
  if (!_pendingWorldBookImports.length) {
    preview.innerHTML = '';
    return;
  }
  var html =
    _pendingWorldBookImports.length > 1
      ? '<div class="import-mode-toolbar" role="group" aria-label="批量设置"><button class="btn sm" type="button" onclick="setAllPendingWorldBookImportModes(\'ai\')">全部设为 AI 汉化后导入</button><button class="btn sm" type="button" onclick="setAllPendingWorldBookImportModes(\'direct\')">全部设为直接导入</button><button class="btn sm" type="button" onclick="setAllPendingWorldBookImportModes(\'suggested\')">恢复系统建议</button></div>'
      : '';
  _pendingWorldBookImports.forEach(function (group, index) {
    var audit = auditStandaloneWorldBookImportLocalization(group),
      mode = pendingWorldBookImportMode(group),
      suggested = recommendedCardImportMode(audit),
      risk = audit.primaryMissing + audit.secondaryMissing,
      unsupportedItems = worldBookImportUnsupportedItems(group, String(group.name || '导入世界书'));
    html +=
      '<article class="import-mode-card"><header class="import-card-head"><span class="import-card-avatar is-book" aria-hidden="true">' +
      uiIcon('book') +
      '</span><div class="import-card-title"><strong>' +
      esc(group.name || '导入世界书') +
      '</strong><small>' +
      (group.entries || []).length +
      ' 条来源记录</small></div></header><section class="import-card-section"><h4>内容检查</h4><p class="import-audit' +
      (risk ? ' warn' : '') +
      '">' +
      esc(worldBookImportLanguageLabel(audit.language)) +
      ' · 可补充中文的分类名 ' +
      audit.categories +
      ' · 条目名 ' +
      audit.entryNames +
      ' · 缺少中文别名的主关键词 ' +
      audit.primaryMissing +
      ' · 次关键词 ' +
      audit.secondaryMissing +
      ' · 已有中文别名 ' +
      audit.aliasesReady +
      '</p><p class="import-suggestion">建议' +
      (suggested === 'ai' ? ' AI 汉化后导入' : '直接导入（内容已是中文）') +
      (risk
        ? '<span class="import-risk">；直接导入时 ' + risk + ' 个外语触发词可能无法被中文对话触发</span>'
        : '') +
      '</p>' +
      importUnsupportedItemsHtml(unsupportedItems) +
      '</section><div class="import-choice-group"><h4>内容处理</h4><div class="import-mode-options"><label class="import-mode-option"><input type="radio" name="wb-import-mode-' +
      index +
      '" value="ai" ' +
      (mode === 'ai' ? 'checked' : '') +
      ' onchange="setPendingWorldBookImportMode(' +
      index +
      ',\'ai\')"><span><strong>AI 汉化后导入</strong><small>为分类名、条目名和触发词补充中文，结果全部准备好后才保存</small></span></label><label class="import-mode-option"><input type="radio" name="wb-import-mode-' +
      index +
      '" value="direct" ' +
      (mode === 'direct' ? 'checked' : '') +
      ' onchange="setPendingWorldBookImportMode(' +
      index +
      ",'direct')\"><span><strong>直接导入</strong><small>不调用 AI，分类名、条目名、关键词、正文、别名和其他内容保持原样</small></span></label></div></div></article>";
  });
  html +=
    '<button class="btn primary import-confirm" type="button" onclick="confirmWBImport()">确认导入 ' +
    _pendingWorldBookImports.length +
    ' 个分类</button>';
  preview.innerHTML = html;
}
function stageStandaloneWorldBookImport(json, sourceLabel) {
  var groups = parseStandaloneWorldBookImportGroups(json),
    label = String(sourceLabel || '').trim(),
    fileName =
      label && label !== '粘贴 JSON'
        ? label
            .split(/[\\/]/)
            .pop()
            .replace(/\.json$/i, '')
            .trim()
        : '';
  if (!groups.length) return 0;
  _pendingWorldBookImports = groups;
  _pendingWorldBookImports.forEach(function (group) {
    var current = String(group.name || '').trim();
    group._sourceLabel = label;
    if (fileName && (!current || current === '导入世界书' || isGenericExportWorldBookName(current)))
      group.name = fileName;
  });
  _pendingWorldBookImportModes = new WeakMap();
  renderWBImportPreview();
  return groups.length;
}
function importWBJSON(json, sourceLabel) {
  return stageStandaloneWorldBookImport(json, sourceLabel);
}
async function confirmDirectWorldBookImportRisks(items) {
  var risks = (items || [])
    .filter(function (item) {
      return item.mode === 'direct';
    })
    .map(function (item) {
      var audit = auditStandaloneWorldBookImportLocalization(item.group),
        count = audit.primaryMissing + audit.secondaryMissing;
      return count ? { name: String((item.group && item.group.name) || '导入世界书'), count: count } : null;
    })
    .filter(Boolean);
  if (!risks.length) return true;
  var total = risks.reduce(function (sum, row) {
      return sum + row.count;
    }, 0),
    detail = risks
      .slice(0, 5)
      .map(function (row) {
        return '• ' + row.name + '：' + row.count + ' 个';
      })
      .join('\n');
  return await appConfirm(
    '以下分类仍有 ' +
      total +
      ' 个外语触发词缺少中文别名：\n' +
      detail +
      (risks.length > 5 ? '\n另有 ' + (risks.length - 5) + ' 个分类。' : '') +
      '\n\n继续会按原文直接导入，不调用 AI；选择「取消」可回到预览改为 AI 汉化。',
    '直接导入风险提示',
    '继续导入'
  );
}
async function confirmWBImport() {
  if (blockDuringGeneration('导入世界书')) return 0;
  var status = $('wb-import-status'),
    items = _pendingWorldBookImports.map(function (group) {
      return { group: group, mode: pendingWorldBookImportMode(group) };
    });
  if (!items.length) {
    if (status) status.innerHTML = '<p class="status-line err">请先选择或粘贴世界书 JSON</p>';
    return 0;
  }
  if (!(await confirmDirectWorldBookImportRisks(items))) {
    if (status) status.innerHTML = '<p class="status-line">已返回预览，尚未导入任何世界书</p>';
    return 0;
  }
  var before = {
    categories: D.worldBook.categories || [],
    globalCategoryIds: D.worldBook.globalCategoryIds || [],
    activeCategoryId: D.worldBook.activeCategoryId,
  };
  showImportProgress('正在导入世界书', '正在准备分类和触发词，完成前不会保存任何内容…', items.length);
  try {
    var attempts = await prepareWorldBookImportAttempts(items);
    if (_importLocalizationCancelled) {
      var cancelled = new Error('用户取消导入；未导入任何世界书，待导入内容未改变');
      cancelled.cancelled = true;
      throw cancelled;
    }
    var categories = before.categories.slice(),
      globalIds = before.globalCategoryIds.slice(),
      activeId = before.activeCategoryId,
      total = 0,
      blank = 0,
      unsupported = 0,
      unsupportedItems = [],
      recognized = 0,
      aiCount = 0,
      directCount = 0,
      requests = 0;
    attempts.forEach(function (attempt) {
      var built = buildStandaloneWorldBookCategory(attempt.group, attempt.mode, categories);
      blank += built.blank;
      unsupported += built.unsupported;
      unsupportedItems = unsupportedItems.concat(built.unsupportedItems || []);
      recognized += built.recognized;
      requests += Number(attempt.report && attempt.report.requests) || 0;
      if (!built.imported) return;
      categories.push(built.category);
      if (
        !globalIds.some(function (id) {
          return String(id) === String(built.category.id);
        })
      )
        globalIds.push(built.category.id);
      activeId = built.category.id;
      total += built.imported;
      if (attempt.mode === 'ai') aiCount++;
      else directCount++;
    });
    if (!total) throw new Error('没有可导入的有效世界书条目；空白记录未保存');
    updateImportProgress('正在保存世界书', '已准备 ' + total + ' 条有效内容，正在保存…', false);
    D.worldBook.categories = categories;
    D.worldBook.globalCategoryIds = globalIds;
    D.worldBook.activeCategoryId = activeId;
    try {
      if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts();
      await saveData(['worldbook', 'sessions'], { urgent: true });
    } catch (error) {
      D.worldBook.categories = before.categories;
      D.worldBook.globalCategoryIds = before.globalCategoryIds;
      D.worldBook.activeCategoryId = before.activeCategoryId;
      throw new Error('保存失败，未写入任何世界书：' + error.message);
    }
    renderWBAll();
    renderWBSidebar();
    updateChatUI();
    if ($('wb-scan-depth')) loadWBSettings();
    _lastImportReports.worldbook =
      '已导入 ' +
      total +
      ' 条世界书内容（直接导入 ' +
      directCount +
      ' 个分类，AI 汉化 ' +
      aiCount +
      ' 个分类）' +
      (blank ? '；空白记录未保存' : '') +
      (unsupportedItems.length ? '；识别但不应用：' + importUnsupportedItemsText(unsupportedItems, 8) : '');
    if (status)
      status.innerHTML =
        '<p class="status-line ok">' + uiIcon('check') + ' ' + esc(_lastImportReports.worldbook) + '</p>';
    resetPendingWorldBookImport(true);
    openWBSection('browse');
    toast(
      '世界书已导入' +
        (unsupportedItems.length
          ? '；有 ' + Array.from(new Set(unsupportedItems)).length + ' 项只保留原内容但不会生效'
          : ''),
      'ok'
    );
    return total;
  } catch (error) {
    var message = String((error && error.message) || error);
    if (status) status.innerHTML = '<p class="status-line err">' + uiIcon('alert') + ' ' + esc(message) + '</p>';
    if (error && error.localizationIncomplete) await showLocalizationFailureDetails(error);
    toast('世界书导入失败：' + message, 'err');
    return 0;
  } finally {
    hideImportProgress();
  }
}
async function importWBFile(e) {
  if (blockDuringGeneration('导入世界书')) {
    e.target.value = '';
    return;
  }
  const file = e.target.files && e.target.files[0],
    status = $('wb-import-status');
  if (!file) return;
  if (status) status.innerHTML = '<p class="status-line">正在读取 ' + esc(file.name) + '…</p>';
  try {
    var raw = await file.text();
    if (!raw || !raw.trim()) throw new Error('文件为空，未读取到 JSON 内容');
    stageWBImportText(raw, file.name, status);
  } catch (error) {
    showWBImportError(status, error);
    toast('世界书解析失败：' + error.message, 'err');
  } finally {
    e.target.value = '';
  }
}
function parseWBJSONText(raw) {
  var text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) throw new Error('没有 JSON 内容');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('JSON 不完整或格式错误：' + error.message);
  }
}
function stageWBImportText(raw, source, status) {
  var staged = importWBJSON(parseWBJSONText(raw), source);
  if (!staged) throw new Error('JSON 可解析，但没有找到可分析的世界书分类或条目');
  if (status)
    status.innerHTML =
      '<p class="status-line ok">' + uiIcon('check') + ' 已分析 ' + staged + ' 个分类，请选择导入方式</p>';
}
function showWBImportError(status, error) {
  if (status) status.innerHTML = '<p class="status-line err">' + uiIcon('alert') + ' ' + esc(error.message) + '</p>';
}
async function importWBPaste() {
  if (blockDuringGeneration('导入世界书')) return;
  var status = $('wb-import-status');
  try {
    stageWBImportText($('wb-paste').value, '粘贴 JSON', status);
  } catch (error) {
    showWBImportError(status, error);
  }
}
