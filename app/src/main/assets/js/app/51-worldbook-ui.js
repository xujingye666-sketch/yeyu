// ===== World book management UI =====
// ===== WB Category Management =====
var WB_RENDER_BATCH_SIZE = 50;
var wbViewState = {
  expanded: new Set(),
  scrollTop: 0,
  focusCatId: '',
  focusEntryId: '',
  focusOffset: null,
  pendingRestore: false,
  query: '',
  renderLimits: new Map(),
};
var _wbRenderCache = { revision: -1, categories: new Map() };
var _wbPrewarmRenderFrame = null;
function cancelWBPrewarmRender() {
  if (_wbPrewarmRenderFrame === null) return;
  cancelAnimationFrame(_wbPrewarmRenderFrame);
  _wbPrewarmRenderFrame = null;
}
function scheduleWBPrewarmRender() {
  if (_wbPrewarmRenderFrame !== null) return;
  var render = function () {
    _wbPrewarmRenderFrame = null;
    var modal = $('wb-modal');
    if (modal && modal.classList.contains('open')) renderWBAll();
  };
  _wbPrewarmRenderFrame = requestAnimationFrame(render);
}
function persistWorldBookChange(options) {
  var sessionsChanged = invalidateCacheContexts(),
    result = saveData(sessionsChanged ? ['worldbook', 'sessions'] : 'worldbook', options),
    refresh = function () {
      if (typeof refreshCardScriptLibraryContext === 'function') refreshCardScriptLibraryContext();
    };
  if (result && typeof result.then === 'function')
    return result.then(function (value) {
      refresh();
      return value;
    });
  refresh();
  return result;
}
function resetWBViewState(clearSearch) {
  wbViewState.expanded = new Set();
  wbViewState.scrollTop = 0;
  wbViewState.focusCatId = '';
  wbViewState.focusEntryId = '';
  wbViewState.focusOffset = null;
  wbViewState.pendingRestore = false;
  wbViewState.query = '';
  wbViewState.renderLimits = new Map();
  var search = clearSearch && typeof $ === 'function' && $('wb-cat-search');
  if (search) search.value = '';
}
function wbRenderRevision() {
  return typeof _worldBookRevision === 'number' ? _worldBookRevision : 0;
}
function wbSyncRenderCache() {
  var revision = wbRenderRevision();
  if (_wbRenderCache.revision !== revision) {
    _wbRenderCache.revision = revision;
    _wbRenderCache.categories.clear();
  }
}
function wbIdle(callback) {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(callback, { timeout: 120 });
  return setTimeout(function () {
    callback({
      didTimeout: true,
      timeRemaining: function () {
        return 8;
      },
    });
  }, 0);
}
function wbCategoryDerived(cat) {
  wbSyncRenderCache();
  var id = String((cat && cat.id) || ''),
    entries = cat && Array.isArray(cat.entries) ? cat.entries : [],
    cached = _wbRenderCache.categories.get(id);
  if (
    cached &&
    cached.cat === cat &&
    cached.entries === entries &&
    cached.length === entries.length &&
    cached.name === cat.name &&
    cached.localizedName === cat.localizedName
  )
    return cached;
  cached = {
    cat: cat,
    entries: entries,
    length: entries.length,
    name: cat && cat.name,
    localizedName: cat && cat.localizedName,
    rows: [],
    localizationPending: 0,
    cleanableBlank: 0,
    searches: new Map(),
    ready: false,
    building: false,
  };
  _wbRenderCache.categories.set(id, cached);
  return cached;
}
function scheduleWBCategoryPrewarm(cat) {
  var cached = wbCategoryDerived(cat);
  if (cached.ready || cached.building) return cached;
  cached.building = true;
  cached.localizationPending = wbCategoryNeedsLocalizationRetry(cat) ? 1 : 0;
  cached.cleanableBlank = 0;
  cached.rows = [];
  var revision = _wbRenderCache.revision,
    index = 0,
    entries = cached.entries,
    namesOnly = wbCategoryLocalizesNamesOnly(cat);
  function pump() {
    if (
      _wbRenderCache.revision !== revision ||
      _wbRenderCache.categories.get(String((cat && cat.id) || '')) !== cached
    ) {
      cached.building = false;
      return;
    }
    var end = Math.min(entries.length, index + 64);
    for (var i = index; i < end; i++) {
      var entry = entries[i],
        values = [
          entry && entry.name,
          entry && entry.localizedName,
          entry && entry.comment,
          entry && entry.content,
        ].concat(
          (entry && entry.keys) || [],
          (entry && entry.keyAliases) || [],
          (entry && entry.secondary_keys) || [],
          (entry && entry.secondaryKeyAliases) || []
        );
      cached.rows.push({
        entry: entry,
        index: i,
        searchText: values
          .map(function (value) {
            return String(value || '').toLowerCase();
          })
          .join('\n'),
      });
    }
    for (var j = index; j < end; j++) {
      var row = entries[j];
      if (entryLocalizationNeedsWork(row, namesOnly)) cached.localizationPending++;
      if (typeof isCleanableCharacterCardBlankEntry === 'function' && isCleanableCharacterCardBlankEntry(cat, row))
        cached.cleanableBlank++;
    }
    index = end;
    if (index < entries.length) {
      wbIdle(pump);
      return;
    }
    cached.ready = true;
    cached.building = false;
    var modal = $('wb-modal');
    if (modal && modal.classList.contains('open')) scheduleWBPrewarmRender();
  }
  wbIdle(pump);
  return cached;
}
function scheduleWBRenderPrewarm(categories) {
  wbSyncRenderCache();
  (Array.isArray(categories) ? categories : (D.worldBook && D.worldBook.categories) || []).forEach(
    scheduleWBCategoryPrewarm
  );
}
function wbFilteredRows(derived, query) {
  if (!derived.ready) return null;
  if (!query) return derived.rows;
  var cached = derived.searches.get(query);
  if (cached) return cached;
  cached = derived.rows.filter(function (row) {
    return row.searchText.indexOf(query) >= 0;
  });
  if (derived.searches.size >= 8) derived.searches.delete(derived.searches.keys().next().value);
  derived.searches.set(query, cached);
  return cached;
}
function wbRenderLimitKey(catId, query) {
  return String(catId) + '|' + String(query || '');
}
function wbRowsForRange(cat, entries, start, end) {
  if (entries) return entries.slice(start, end);
  return ((cat && cat.entries) || []).slice(start, end).map(function (entry, index) {
    return { entry: entry, index: start + index };
  });
}
function wbEntryRenderHtml(cat, row) {
  var e = row.entry || {},
    i = row.index,
    keys = (e.keys || [])
      .map(function (k) {
        return String(k || '').trim();
      })
      .filter(Boolean),
    aliasKeys = (e.keyAliases || [])
      .map(function (k) {
        return String(k || '').trim();
      })
      .filter(Boolean),
    willNotTrigger = !e.constant && !e.vectorized && !keys.length,
    content = String(e.content || ''),
    name = wbEntryDisplayName(e),
    positionLabels = {
      before_char: '角色设定前',
      after_char: '角色设定后',
      before_user: '当前用户消息前',
      em_top: '示例对话前',
      em_bottom: '示例对话后',
      an_top: '作者注记前',
      an_bottom: '作者注记后',
      outlet: '出口 ' + String(e.outletName || '（未命名）'),
    },
    resolvedPosition = wbPosition(e.position),
    positionText =
      resolvedPosition === 'at_depth'
        ? '聊天记录中 · 距最新 ' + wbDepth(e.depth) + ' 条'
        : positionLabels[resolvedPosition] || '角色设定后',
    target = '" data-cat-id="' + escAttr(cat.id) + '" data-entry-index="' + i + '"';
  return (
    '<article class="wb-entry' +
    (e.enabled ? '' : ' is-disabled') +
    '" data-entry-id="' +
    escAttr(e.id || '') +
    '" data-entry-index="' +
    i +
    '"><button type="button" class="wb-entry-main" data-wb-action="edit' +
    target +
    '><span class="wb-entry-name">' +
    esc(name) +
    '</span><span class="wb-keywords">' +
    (keys.length ? esc(keys.join('、')) : '') +
    (aliasKeys.length
      ? '<span class="wb-kw-aliases">' + (keys.length ? ' · ' : '') + '中文别名 ' + esc(aliasKeys.join('、')) + '</span>'
      : '') +
    '</span>' +
    (content ? '<span class="wb-content">' + esc(content.slice(0, 120)) + (content.length > 120 ? '…' : '') + '</span>' : '') +
    '<span class="wb-meta"><span>' +
    esc(positionText) +
    '</span>' +
    (e.constant ? '<span class="is-info">常驻</span>' : '') +
    (e.vectorized ? '<span class="is-info">向量</span>' : '') +
    (e.ignoreBudget ? '<span class="is-warning">忽略预算</span>' : '') +
    (willNotTrigger ? '<span class="is-danger">不会触发：没有有效关键词</span>' : '') +
    (e.selective ? '<span class="is-warning">使用次级筛选</span>' : '') +
    (e.probability < 100 ? '<span>概率 ' + Number(e.probability || 0) + '%</span>' : '') +
    (!e.enabled ? '<span class="is-danger">已停用</span>' : '') +
    (e._fromChar ? '<span>来自角色：' + esc(e._fromChar) + '</span>' : '') +
    '</span></button><button type="button" class="btn text sm danger wb-entry-delete" data-wb-action="delete-entry' +
    target +
    ' aria-label="删除条目 ' +
    escAttr(name) +
    '">删除</button></article>'
  );
}
function ensureWBListEvents() {
  var ct = $('wb-cat-list');
  if (!ct || ct.dataset.wbEvents === '1') return;
  ct.dataset.wbEvents = '1';
  ct.addEventListener('click', function (event) {
    var el = event.target.closest('[data-wb-action]');
    if (!el || !ct.contains(el)) return;
    var action = el.dataset.wbAction,
      catId = el.dataset.catId,
      index = Number(el.dataset.entryIndex);
    if (action !== 'toggle') event.stopPropagation();
    if (action === 'toggle') toggleWBCategory(catId);
    else if (action === 'load-more') loadMoreWBEntries(catId);
    else if (action === 'add-entry') openWBEditor(catId);
    else if (action === 'edit') editWBEntry(catId, index);
    else if (action === 'delete-entry') deleteWBEntry(catId, index);
    else if (action === 'localize') retryWorldBookLocalization(catId);
    else if (action === 'clean') cleanCharacterCardBlankEntries(catId);
    else if (action === 'bind') bindCategory(catId);
    else if (action === 'category-settings') editWBCategorySettings(catId);
    else if (action === 'rename') renameWBCategory(catId);
    else if (action === 'delete-category') deleteWBCategory(catId);
  });
  // The category header is a div so its row can hold the name and summary; keys behave like a button.
  ct.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var header = event.target.closest('.wb-cat-hd[data-wb-action="toggle"]');
    if (!header || event.target !== header) return;
    event.preventDefault();
    header.click();
  });
}
function wbScrollContainer() {
  var list = $('wb-cat-list');
  return list && list.closest('.modal-body');
}
function captureWBViewState(entryId) {
  var sc = wbScrollContainer();
  if (sc) wbViewState.scrollTop = sc.scrollTop;
  if (!wbViewState.query)
    document.querySelectorAll('.wb-category[data-cat-id]').forEach(function (el) {
      var open = el.querySelector('.wb-cat-body')?.classList.contains('open');
      if (open) wbViewState.expanded.add(el.dataset.catId);
      else wbViewState.expanded.delete(el.dataset.catId);
    });
  var target = entryId
    ? Array.from(document.querySelectorAll('.wb-entry[data-entry-id]')).find(function (el) {
        return el.dataset.entryId === String(entryId);
      })
    : null;
  wbViewState.focusOffset = target && sc ? target.getBoundingClientRect().top - sc.getBoundingClientRect().top : null;
  wbViewState.pendingRestore = true;
}
function returnToWBBrowse() {
  openWBSection('browse');
}
function restoreWBViewState() {
  if (!wbViewState.pendingRestore) return;
  wbViewState.pendingRestore = false;
  requestAnimationFrame(function () {
    var sc = wbScrollContainer(),
      savedOffset = wbViewState.focusOffset,
      target = wbViewState.focusEntryId
        ? Array.from(document.querySelectorAll('.wb-entry[data-entry-id]')).find(function (el) {
            return el.dataset.entryId === String(wbViewState.focusEntryId);
          })
        : null;
    if (sc) sc.scrollTop = wbViewState.scrollTop;
    if (target && sc) {
      requestAnimationFrame(function () {
        var saved = Number(savedOffset);
        if (Number.isFinite(saved)) {
          var delta = target.getBoundingClientRect().top - sc.getBoundingClientRect().top - saved;
          if (Math.abs(delta) > 0.5) sc.scrollTop += delta;
        }
        target.classList.add('return-focus');
        setTimeout(function () {
          target.classList.remove('return-focus');
        }, 900);
        wbViewState.scrollTop = sc.scrollTop;
      });
    }
    wbViewState.focusEntryId = '';
    wbViewState.focusCatId = '';
    wbViewState.focusOffset = null;
  });
}
async function addWBCategory(charId) {
  if (blockDuringGeneration('新建世界书分类')) return;
  var name = await appInput('请输入分类名称：', '', '新建分类', '分类名称', { okText: '新建分类' });
  if (!name || !name.trim()) return;
  var colors = ['#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#ec4899', '#f59e0b', '#ef4444'];
  // Category names are the host-write key (hostWriteWorldbookCategory rejects duplicates), so a
  // manual create dedupes with the same ' #N' rule the import paths use.
  var base = name.trim(),
    unique = base,
    suffix = 2;
  while (
    (D.worldBook.categories || []).some(function (x) {
      return x && String(x.name || '').trim() === unique;
    })
  )
    unique = base + ' #' + suffix++;
  var cat = {
    id: 'cat_' + uid(),
    name: unique,
    color: colors[Math.floor(Math.random() * colors.length)],
    entries: [],
    boundCharIds: charId ? [String(charId)] : [],
  };
  if (!D.worldBook.categories) D.worldBook.categories = [];
  var oldActive = D.worldBook.activeCategoryId;
  D.worldBook.categories.push(cat);
  D.worldBook.activeCategoryId = cat.id;
  try {
    await persistWorldBookChange();
  } catch (error) {
    D.worldBook.categories = D.worldBook.categories.filter(function (x) {
      return x !== cat;
    });
    D.worldBook.activeCategoryId = oldActive || '';
    toast('分类保存失败：' + error.message, 'err');
    return;
  }
  renderWBAll();
  renderWBSidebar();
  updateChatUI();
  if (charId) toast('分类「' + cat.name + '」已创建并绑定到 ' + getCharName(charId), 'ok');
  else toast('分类「' + cat.name + '」已创建', 'ok');
  return cat;
}

async function bindCategory(catId) {
  if (blockDuringGeneration('修改世界书范围')) return;
  var cat = D.worldBook.categories.find(function (c) {
    return c.id === catId;
  });
  if (!cat) return;
  var chars = (D.characters || []).filter(Boolean),
    bound = worldBookCategoryBoundCharIds(cat),
    isGlobal = (D.worldBook.globalCategoryIds || []).includes(cat.id),
    mode = isGlobal ? 'global' : bound.length ? 'selected' : 'none';
  var charOptions = chars.length
    ? characterBindingOptions(chars, bound)
    : '<div class="hint">还没有可绑定的角色。可以先设为「暂不生效」，创建角色后再回来设置。</div>';
  appPromptMode = 'confirm';
  $('app-prompt-title').textContent = '设置世界书作用范围';
  $('app-prompt-message').classList.add('app-prompt-rich');
  $('app-prompt-message').innerHTML =
    '<div class="wb-bind-heading">分类：<b>' +
    esc(wbCategoryDisplayName(cat)) +
    '</b></div><div class="import-mode-options wb-bind-modes"><label class="import-mode-option"><input type="radio" name="wb-bind-mode" value="none"' +
    (mode === 'none' ? ' checked' : '') +
    '><span><strong>暂不生效</strong><small>保留分类和条目，但聊天时不会使用。</small></span></label><label class="import-mode-option"><input type="radio" name="wb-bind-mode" value="global"' +
    (mode === 'global' ? ' checked' : '') +
    '><span><strong>全局生效</strong><small>所有角色都能使用，包括以后新建的角色。</small></span></label><label class="import-mode-option"><input type="radio" name="wb-bind-mode" value="selected"' +
    (mode === 'selected' ? ' checked' : '') +
    '><span><strong>绑定指定角色</strong><small>只有下面勾选的角色能够使用。</small></span></label></div><div id="wb-bind-character-list" class="wb-bind-character-list">' +
    charOptions +
    '</div><div class="hint wb-bind-advice">选择「全局生效」时忽略角色勾选。</div>';
  $('app-prompt-field').style.display = 'none';
  $('app-prompt-ok').textContent = '保存';
  openModal('app-prompt-modal');
  var sync = function () {
    var selected = document.querySelector('input[name="wb-bind-mode"]:checked'),
      list = $('wb-bind-character-list'),
      enabled = selected && selected.value === 'selected';
    if (list) list.classList.toggle('disabled', !enabled);
    if (list)
      list.querySelectorAll('input').forEach(function (input) {
        input.disabled = !enabled;
      });
  };
  document.querySelectorAll('input[name="wb-bind-mode"]').forEach(function (input) {
    input.addEventListener('change', sync);
  });
  sync();
  var ok = await new Promise(function (resolve) {
    appPromptResolver = resolve;
  });
  if (!ok) return;
  var selectedMode = document.querySelector('input[name="wb-bind-mode"]:checked'),
    nextMode = selectedMode ? selectedMode.value : 'none',
    selectedIds =
      nextMode === 'selected'
        ? Array.from(document.querySelectorAll('#wb-bind-character-list input:checked')).map(function (input) {
            return input.value;
          })
        : [];
  if (nextMode === 'selected' && !selectedIds.length) {
    toast('请至少选择一个角色，或改为“暂不生效”', 'info');
    return bindCategory(catId);
  }
  var oldGlobal = (D.worldBook.globalCategoryIds || []).slice(),
    oldBound = worldBookCategoryBoundCharIds(cat);
  D.worldBook.globalCategoryIds = (D.worldBook.globalCategoryIds || []).filter(function (id) {
    return id !== cat.id;
  });
  setWorldBookCategoryBoundCharIds(cat, nextMode === 'selected' ? selectedIds : []);
  if (nextMode === 'global') D.worldBook.globalCategoryIds.push(cat.id);
  try {
    await persistWorldBookChange();
  } catch (error) {
    D.worldBook.globalCategoryIds = oldGlobal;
    setWorldBookCategoryBoundCharIds(cat, oldBound);
    toast('作用范围保存失败，原设置已恢复：' + error.message, 'err');
    return;
  }
  renderWBAll();
  renderWBSidebar();
  updateChatUI();
  toast(
    nextMode === 'global'
      ? '已设为全局生效'
      : nextMode === 'selected'
        ? '已绑定 ' + selectedIds.length + ' 个角色'
        : '已设为暂不生效',
    'ok'
  );
}

async function renameWBCategory(catId) {
  if (blockDuringGeneration('重命名世界书分类')) return;
  const cat = D.worldBook.categories.find((c) => c.id === catId);
  if (!cat) return;
  const name = await appInput('重命名分类：', cat.name, '重命名分类', '分类名称', { okText: '保存名称' });
  if (!name || !name.trim()) return;
  var nextName = name.trim();
  try {
    await hostWriteRenameWorldbook(cat.name, nextName);
  } catch (error) {
    toast('重命名保存失败：' + error.message, 'err');
    return;
  }
  renderWBAll();
  renderWBSidebar();
}

function wbOptionalCategoryNumber(value, min, max) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return null;
  var number = Number(text);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < min || number > max) return undefined;
  return number;
}
async function editWBCategorySettings(catId) {
  if (blockDuringGeneration('修改世界书分类设置')) return;
  var cat = (D.worldBook.categories || []).find(function (row) {
    return row && row.id === catId;
  });
  if (!cat) return;
  var settings = cat.settings && typeof cat.settings === 'object' && !Array.isArray(cat.settings) ? cat.settings : {},
    recursive = settings.recursive == null ? '' : String(!!settings.recursive),
    sensitive = settings.caseSensitive == null ? '' : String(!!settings.caseSensitive);
  appPromptMode = 'confirm';
  $('app-prompt-title').textContent = '分类设置 · ' + wbCategoryDisplayName(cat);
  $('app-prompt-message').classList.add('app-prompt-rich');
  $('app-prompt-message').innerHTML =
    '<div class="fg-row"><div class="fg"><label>回看消息数量</label><input id="wb-category-scan-depth" type="number" min="1" max="100" step="1" value="' +
    (settings.scan_depth == null ? '' : escAttr(settings.scan_depth)) +
    '" placeholder="跟随全局设置"><div class="hint">1–100，留空跟随世界书设置。</div></div><div class="fg"><label>单次加入量上限（Token）</label><input id="wb-category-token-budget" type="number" min="0" max="262144" step="256" value="' +
    (settings.token_budget == null ? '' : escAttr(settings.token_budget)) +
    '" placeholder="只使用全局上限"><div class="hint">0–262144，0 或留空不额外限制，仍遵守全局上限。</div></div></div><div class="fg"><label>递归扫描</label><select id="wb-category-recursive"><option value=""' +
    (recursive === '' ? ' selected' : '') +
    '>跟随全局设置</option><option value="true"' +
    (recursive === 'true' ? ' selected' : '') +
    '>为这个分类开启</option><option value="false"' +
    (recursive === 'false' ? ' selected' : '') +
    '>为这个分类关闭</option></select><div class="hint">本分类已激活条目的正文能否继续触发其他条目；选开启或关闭时覆盖全局开关。</div></div><div class="fg"><label>英文关键词大小写</label><select id="wb-category-case-sensitive"><option value=""' +
    (sensitive === '' ? ' selected' : '') +
    '>未单独指定（默认不区分）</option><option value="true"' +
    (sensitive === 'true' ? ' selected' : '') +
    '>区分大小写</option><option value="false"' +
    (sensitive === 'false' ? ' selected' : '') +
    '>不区分大小写</option></select><div class="hint">本分类条目的默认值；条目自己指定时以条目为准。</div></div>';
  $('app-prompt-field').style.display = 'none';
  $('app-prompt-ok').textContent = '保存分类设置';
  openModal('app-prompt-modal');
  var confirmed = await new Promise(function (resolve) {
    appPromptResolver = resolve;
  });
  if (!confirmed) return;
  var scan = wbOptionalCategoryNumber($('wb-category-scan-depth') && $('wb-category-scan-depth').value, 1, 100),
    budget = wbOptionalCategoryNumber($('wb-category-token-budget') && $('wb-category-token-budget').value, 0, 262144);
  if (scan === undefined || budget === undefined) {
    toast('分类设置中的数量必须是允许范围内的整数', 'err');
    return editWBCategorySettings(catId);
  }
  var oldHadSettings = Object.prototype.hasOwnProperty.call(cat, 'settings'),
    oldSettings = oldHadSettings ? copyJsonData(cat.settings) : undefined,
    next = Object.assign({}, settings),
    recursiveValue = $('wb-category-recursive') ? $('wb-category-recursive').value : '',
    sensitiveValue = $('wb-category-case-sensitive') ? $('wb-category-case-sensitive').value : '';
  if (scan == null) delete next.scan_depth;
  else next.scan_depth = scan;
  if (budget == null) delete next.token_budget;
  else next.token_budget = budget;
  if (!recursiveValue) delete next.recursive;
  else next.recursive = recursiveValue === 'true';
  if (!sensitiveValue) delete next.caseSensitive;
  else next.caseSensitive = sensitiveValue === 'true';
  cat.settings = Object.keys(next).length ? next : null;
  try {
    await persistWorldBookChange({ urgent: true });
  } catch (error) {
    if (oldHadSettings) cat.settings = oldSettings;
    else delete cat.settings;
    toast('分类设置保存失败，原设置已恢复：' + error.message, 'err');
    return;
  }
  renderWBAll();
  updateChatUI();
  toast('分类设置已保存', 'ok');
}

async function deleteWBCategory(catId) {
  if (blockDuringGeneration('删除世界书分类')) return;
  const cat = D.worldBook.categories.find((c) => c.id === catId);
  if (!cat) return;
  if (!(await appConfirm(`删除分类「${cat.name}」及其全部 ${cat.entries.length} 个条目？`, '删除分类', '删除'))) return;
  try {
    await hostWriteDeleteWorldbook(cat.name);
  } catch (error) {
    toast('删除保存失败，分类已恢复：' + error.message, 'err');
    return;
  }
  renderWBAll();
  renderWBSidebar();
  updateChatUI();
  toast(`分类「${cat.name}」已删除`, 'info');
}
async function cleanCharacterCardBlankEntries(catId) {
  if (blockDuringGeneration('清理空白导入条目')) return;
  var cat = (D.worldBook.categories || []).find(function (row) {
    return row && row.id === catId;
  });
  if (!cat) return;
  var blank = (cat.entries || []).filter(function (entry) {
    return isCleanableCharacterCardBlankEntry(cat, entry);
  });
  if (!blank.length) {
    toast('这个角色卡世界书没有可清理的空白导入条目', 'info');
    return;
  }
  if (
    !(await appConfirm(
      '确认清理「' +
        wbCategoryDisplayName(cat) +
        '」中的 ' +
        blank.length +
        ' 个空白导入条目？\n\n只会清理随角色卡导入、且名称、关键词、正文和备注全部为空的旧记录；不会影响手动创建的占位或其他世界书。',
      '清理空白导入条目',
      '确认清理'
    ))
  )
    return;
  var before = cat.entries.slice(),
    blankSet = new Set(blank);
  cat.entries = cat.entries.filter(function (entry) {
    return !blankSet.has(entry);
  });
  try {
    await persistWorldBookChange({ urgent: true });
  } catch (error) {
    cat.entries = before;
    toast('清理保存失败，原条目已恢复：' + error.message, 'err');
    return;
  }
  renderWBAll();
  renderWBSidebar();
  updateChatUI();
  toast('已清理 ' + blank.length + ' 个空白导入条目', 'ok');
}

function toggleWBCategory(catId) {
  var id = String(catId),
    opening = !wbViewState.expanded.has(id),
    sc = wbScrollContainer();
  if (sc) wbViewState.scrollTop = sc.scrollTop;
  if (opening) wbViewState.expanded.add(id);
  else wbViewState.expanded.delete(id);
  wbViewState.pendingRestore = true;
  renderWBAll();
}
function appendWBEntryBatch(catId, query, start, end) {
  var cat = (D.worldBook.categories || []).find(function (row) {
      return row && String(row.id) === String(catId);
    }),
    ct = $('wb-cat-list');
  if (!cat || !ct || wbViewState.query !== query) return false;
  var derived = scheduleWBCategoryPrewarm(cat),
    entries = query ? wbFilteredRows(derived, query) : derived.ready ? derived.rows : null;
  if (query && !entries) return false;
  var totalRows = entries ? entries.length : (cat.entries || []).length,
    category = Array.from(ct.querySelectorAll('.wb-category[data-cat-id]')).find(function (node) {
      return node.dataset.catId === String(catId);
    }),
    body =
      category &&
      Array.from(category.children).find(function (node) {
        return node.classList.contains('wb-cat-body');
      }),
    last = body && body.lastElementChild,
    more = last && last.classList.contains('wb-load-more') ? last : null,
    rendered = Number(more && more.dataset.wbRenderedCount),
    from = Math.min(start, totalRows),
    to = Math.min(end, totalRows);
  if (!body || !more || rendered !== from || to <= from) return false;
  more.insertAdjacentHTML(
    'beforebegin',
    wbRowsForRange(cat, entries, from, to)
      .map(function (row) {
        return wbEntryRenderHtml(cat, row);
      })
      .join('')
  );
  if (to >= totalRows) more.remove();
  else {
    more.dataset.wbRenderedCount = String(to);
    var button = more.querySelector('[data-wb-action="load-more"]');
    if (button) button.textContent = '加载更多（已显示 ' + to + ' / ' + totalRows + '）';
  }
  return true;
}
function loadMoreWBEntries(catId) {
  var query = wbViewState.query || '',
    key = wbRenderLimitKey(catId, query),
    current = wbViewState.renderLimits.get(key) || WB_RENDER_BATCH_SIZE,
    next = current + WB_RENDER_BATCH_SIZE,
    sc = wbScrollContainer();
  if (sc) wbViewState.scrollTop = sc.scrollTop;
  wbViewState.renderLimits.set(key, next);
  if (appendWBEntryBatch(catId, query, current, next)) {
    if (sc) sc.scrollTop = wbViewState.scrollTop;
    wbViewState.pendingRestore = false;
    return true;
  }
  wbViewState.pendingRestore = true;
  renderWBAll();
  return false;
}

// ===== WB Entry CRUD =====
function openWBSection(section) {
  var target = $('wb-' + section),
    changed = target && getComputedStyle(target).display === 'none';
  ['browse', 'import', 'settings'].forEach(function (x) {
    var p = $('wb-' + x);
    if (p) p.style.display = x === section ? '' : 'none';
  });
  $('wb-add').style.display = 'none';
  if (section === 'browse' || section === 'import' || section === 'settings') setWBFooterEditing(false);
  document.querySelectorAll('#wb-modal [data-wb-tab]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.wbTab === section);
  });
  if (section === 'browse') renderWBAll();
  if (section === 'settings') loadWBSettings();
  if (changed) revealUiContent(target);
}
async function openWBEditor(preselectedCatId) {
  if (!(D.worldBook.categories || []).length) {
    var created = await addWBCategory();
    if (!created) return;
    preselectedCatId = created.id;
  }
  captureWBViewState();
  setWBFooterEditing(true);
  clearWBForm();
  refreshWBCatSelect();
  var selected = (D.worldBook.categories || []).find(function (cat) {
    return cat && cat.id === preselectedCatId;
  });
  if (selected) $('wb-cat-select').value = selected.id;
  $('wb-browse').style.display = 'none';
  $('wb-import').style.display = 'none';
  $('wb-settings').style.display = 'none';
  $('wb-add').style.display = '';
  document.querySelectorAll('#wb-modal [data-wb-tab]').forEach(function (b) {
    b.classList.remove('active');
  });
  $('wb-add-status').innerHTML =
    '<p class="wb-add-context">' +
    (selected ? '正在向「' + esc(wbCategoryDisplayName(selected)) + '」添加条目' : '新建世界书条目') +
    '</p>';
  rememberUnsavedEditorBaseline('wb-modal');
}
function setWBFooterEditing(editing) {
  document.querySelectorAll('.wb-footer-browse').forEach(function (x) {
    x.style.display = editing ? 'none' : '';
  });
  document.querySelectorAll('.wb-footer-editor').forEach(function (x) {
    x.style.display = editing ? '' : 'none';
  });
}
function cancelWBEditor() {
  clearWBForm();
  setWBFooterEditing(false);
  returnToWBBrowse();
}
function wbEditorIsOpen() {
  var modal = $('wb-modal'),
    editor = $('wb-add');
  return !!(modal && modal.classList.contains('open') && editor && editor.style.display !== 'none');
}
// Leaving the entry editor for the list or another section asks first when the entry has unsaved changes.
function handleWBBack() {
  if (!wbEditorIsOpen()) return false;
  discardEditorAfterConfirm('wb-modal', cancelWBEditor);
  return true;
}
function selectWBSection(section) {
  if (!wbEditorIsOpen()) return openWBSection(section);
  discardEditorAfterConfirm('wb-modal', function () {
    openWBSection(section);
  });
}
function resetWBModalView() {
  cancelWBPrewarmRender();
  clearWBForm();
  setWBFooterEditing(false);
  resetWBViewState(true);
  openWBSection('browse');
}
function wbCharacterFilterNames(filter) {
  var names = Array.isArray(filter) ? filter : filter && Array.isArray(filter.names) ? filter.names : [];
  return names
    .map(function (value) {
      return String(value || '').trim();
    })
    .filter(Boolean);
}
function wbCharacterFilterTags(filter) {
  var tags = filter && !Array.isArray(filter) && Array.isArray(filter.tags) ? filter.tags : [];
  return tags
    .map(function (value) {
      return String(value || '').trim();
    })
    .filter(Boolean);
}
function wbCommaList(value) {
  return String(value || '')
    .split(',')
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}
// Keys are stored joined by ', ', but a regex key may contain commas (/\d{1,3}人/). Peel off
// whole /pattern/flags tokens - the grammar wbParseRegexPattern accepts, escaped slashes included -
// before splitting the rest on commas, so a regex key survives an edit round trip.
var WB_REGEX_KEY_TOKEN = /^\/(?:\\[\s\S]|[^\\/])+\/[gimsuy]*(?=\s*(?:,|$))/;
function wbEditorKeyList(value) {
  var rest = String(value || ''),
    keys = [];
  while (rest) {
    rest = rest.replace(/^[\s,]+/, '');
    if (!rest) break;
    var token = rest.charAt(0) === '/' ? rest.match(WB_REGEX_KEY_TOKEN) : null;
    if (token) {
      keys.push(token[0]);
      rest = rest.slice(token[0].length);
      continue;
    }
    var comma = rest.indexOf(','),
      plain = (comma < 0 ? rest : rest.slice(0, comma)).trim();
    if (plain) keys.push(plain);
    rest = comma < 0 ? '' : rest.slice(comma + 1);
  }
  return keys;
}
function wbCharacterFilterFromEditor() {
  var names = Array.from(new Set(wbCommaList($('wb-character-filter').value))),
    tags = Array.from(new Set(wbCommaList($('wb-character-filter-tags').value)));
  return names.length || tags.length
    ? { names: names, tags: tags, isExclude: $('wb-character-filter-exclude').checked }
    : null;
}
var WB_SCAN_SOURCE_FIELDS = [
  ['wb-match-persona-description', 'matchPersonaDescription'],
  ['wb-match-character-description', 'matchCharacterDescription'],
  ['wb-match-character-personality', 'matchCharacterPersonality'],
  ['wb-match-character-depth-prompt', 'matchCharacterDepthPrompt'],
  ['wb-match-scenario', 'matchScenario'],
  ['wb-match-creator-notes', 'matchCreatorNotes'],
];
var WB_TRIGGER_FIELDS = [
  ['wb-trigger-normal', 'normal'],
  ['wb-trigger-continue', 'continue'],
  ['wb-trigger-regenerate', 'regenerate'],
  ['wb-trigger-swipe', 'swipe'],
  ['wb-trigger-impersonate', 'impersonate'],
  ['wb-trigger-quiet', 'quiet'],
];
function setWBScanSourceEditor(entry) {
  WB_SCAN_SOURCE_FIELDS.forEach(function (row) {
    var node = $(row[0]);
    if (node) node.checked = !!(entry && entry[row[1]] === true);
  });
}
function wbScanSourcesFromEditor() {
  var out = {};
  WB_SCAN_SOURCE_FIELDS.forEach(function (row) {
    out[row[1]] = !!($(row[0]) && $(row[0]).checked);
  });
  return out;
}
function setWBTriggerEditor(list) {
  var selected = wbGenerationTriggerList(list);
  WB_TRIGGER_FIELDS.forEach(function (row) {
    var node = $(row[0]);
    if (node) node.checked = selected.indexOf(row[1]) >= 0;
  });
}
function wbTriggerListFromEditor() {
  return WB_TRIGGER_FIELDS.filter(function (row) {
    return $(row[0]) && $(row[0]).checked;
  }).map(function (row) {
    return row[1];
  });
}
// The trigger strategy is one three-way choice, so constant and vector can never both be on.
function wbTriggerModeForEntry(entry) {
  return entry && entry.constant ? 'constant' : entry && entry.vectorized ? 'vector' : 'keyword';
}
function wbEntryScanDepthFromEditor() {
  var raw = String($('wb-entry-scan-depth').value || '').trim();
  if (!raw) return null;
  var value = Math.floor(wbNumber(raw, 0));
  return value >= 0 ? Math.min(1000, value) : null;
}
function syncWBProbabilityState() {
  var enabled = $('wb-use-probability') ? $('wb-use-probability').checked : true,
    input = $('wb-probability');
  if (input) input.disabled = !enabled;
}
// Depth and chat role only apply to the in-chat position; the outlet name only to outlets.
function syncWBPositionState() {
  var position = $('wb-position') ? $('wb-position').value : 'after_char',
    depth = $('wb-depth'),
    role = $('wb-role'),
    outlet = $('wb-outlet-name');
  if (depth) depth.disabled = position !== 'at_depth';
  if (role) role.disabled = position !== 'at_depth';
  if (outlet) outlet.disabled = position !== 'outlet';
}
function setWBDelayUntilRecursionEditor(value) {
  var input = $('wb-delay-until-recursion');
  if (!input) return;
  var display = value === true ? 1 : Math.max(0, wbNumber(value, 0));
  input.value = String(display);
  input.dataset.originalDisplay = String(display);
  input.dataset.originalValue = value === undefined ? '' : JSON.stringify(value);
}
function wbDelayUntilRecursionFromEditor() {
  var input = $('wb-delay-until-recursion');
  if (!input) return 0;
  var display = String(input.value || '').trim() || '0';
  if (input.dataset.originalValue !== '' && display === input.dataset.originalDisplay) {
    try {
      return JSON.parse(input.dataset.originalValue);
    } catch (_) {}
  }
  return Math.floor(Math.max(0, wbNumber(display, 0)));
}
function clearWBForm() {
  $('wb-edit-id').value = '';
  $('wb-edit-cat-id').value = '';
  $('wb-name').value = '';
  $('wb-keys').value = '';
  $('wb-content').value = '';
  $('wb-comment').value = '';
  $('wb-trigger-mode').value = 'keyword';
  $('wb-position').value = 'after_char';
  $('wb-depth').value = WB_DEFAULT_DEPTH;
  $('wb-order').value = 100;
  $('wb-probability').value = 100;
  $('wb-outlet-name').value = '';
  $('wb-ignore-budget').checked = false;
  $('wb-use-probability').checked = true;
  $('wb-case-sensitive').value = '';
  $('wb-match-whole-words').value = '';
  $('wb-role').value = 'system';
  setWBDelayUntilRecursionEditor(undefined);
  $('wb-selective').checked = false;
  $('wb-secondary').value = '';
  $('wb-selective-logic').value = '0';
  $('wb-entry-scan-depth').value = '';
  setWBScanSourceEditor(null);
  setWBTriggerEditor([]);
  $('wb-prevent-recursion').checked = false;
  $('wb-exclude-recursion').checked = false;
  $('wb-enabled').checked = true;
  $('wb-character-filter').value = '';
  $('wb-character-filter-tags').value = '';
  $('wb-character-filter-exclude').checked = false;
  $('wb-sticky').value = 0;
  $('wb-cooldown').value = 0;
  $('wb-delay').value = 0;
  $('wb-group').value = '';
  $('wb-group-weight').value = 100;
  $('wb-group-override').checked = false;
  $('wb-use-group-scoring').value = '';
  $('wb-automation-id').value = '';
  syncWBProbabilityState();
  syncWBPositionState();
  $('wb-add-status').innerHTML = '';
}

function refreshWBCatSelect() {
  var sel = $('wb-cat-select');
  if (!sel) return;
  var h = '';
  (D.worldBook.categories || []).forEach(function (cat) {
    h += '<option value=\"' + cat.id + '\">' + esc(cat.name) + '</option>';
  });
  sel.innerHTML = h || '<option value=\"\">无分类</option>';
}

function editWBEntry(catId, entryIdx) {
  const cat = D.worldBook.categories.find((c) => c.id === catId);
  if (!cat) return;
  const e = cat.entries[entryIdx];
  if (!e) return;
  captureWBViewState(e.id);
  wbViewState.expanded.add(String(catId));
  wbViewState.focusCatId = String(catId);
  wbViewState.focusEntryId = String(e.id || '');
  $('wb-edit-id').value = entryIdx;
  $('wb-edit-cat-id').value = catId;
  $('wb-name').value = e.name || '';
  $('wb-keys').value = (e.keys || []).join(', ');
  $('wb-content').value = e.content || '';
  $('wb-comment').value = e.comment || '';
  $('wb-trigger-mode').value = wbTriggerModeForEntry(e);
  $('wb-position').value = wbPosition(e.position);
  $('wb-depth').value = wbDepth(e.depth);
  $('wb-order').value = e.order ?? 100;
  $('wb-outlet-name').value = String(e.outletName || '');
  $('wb-ignore-budget').checked = e.ignoreBudget === true;
  $('wb-probability').value = e.probability ?? 100;
  $('wb-use-probability').checked = e.useProbability !== false;
  $('wb-case-sensitive').value = e.caseSensitive == null ? '' : String(!!e.caseSensitive);
  $('wb-match-whole-words').value = e.matchWholeWords == null ? '' : String(!!e.matchWholeWords);
  $('wb-role').value = ['system', 'user', 'assistant'].includes(String(e.role || '')) ? String(e.role) : 'system';
  setWBDelayUntilRecursionEditor(e.delayUntilRecursion);
  $('wb-selective').checked = !!e.selective;
  $('wb-secondary').value = (e.secondary_keys || []).join(', ');
  var selectiveLogic = String(e.selectiveLogic == null ? 0 : e.selectiveLogic)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  $('wb-selective-logic').value =
    selectiveLogic === '1' || selectiveLogic === 'notall'
      ? '1'
      : selectiveLogic === '2' || selectiveLogic === 'notany'
        ? '2'
        : selectiveLogic === '3' || selectiveLogic === 'andall' || selectiveLogic === 'all'
          ? '3'
          : '0';
  $('wb-entry-scan-depth').value = e.scanDepth == null ? '' : String(Math.max(0, wbNumber(e.scanDepth, 0)));
  setWBScanSourceEditor(e);
  setWBTriggerEditor(e.triggers);
  $('wb-prevent-recursion').checked = !!e.preventRecursion;
  $('wb-exclude-recursion').checked = !!e.excludeRecursion;
  $('wb-character-filter').value = wbCharacterFilterNames(e.characterFilter).join(', ');
  $('wb-character-filter-tags').value = wbCharacterFilterTags(e.characterFilter).join(', ');
  $('wb-character-filter-exclude').checked = !!(e.characterFilter && e.characterFilter.isExclude);
  $('wb-sticky').value = Math.max(0, Number(e.sticky) || 0);
  $('wb-cooldown').value = Math.max(0, Number(e.cooldown) || 0);
  $('wb-delay').value = Math.max(0, Number(e.delay) || 0);
  $('wb-group').value = String(e.group || '');
  $('wb-group-weight').value = Math.max(1, Number(e.groupWeight) || 100);
  $('wb-group-override').checked = !!e.groupOverride;
  $('wb-use-group-scoring').value = e.useGroupScoring == null ? '' : String(!!e.useGroupScoring);
  $('wb-automation-id').value = String(e.automationId || '');
  $('wb-enabled').checked = e.enabled !== false;
  syncWBProbabilityState();
  syncWBPositionState();
  refreshWBCatSelect();
  $('wb-cat-select').value = catId;
  setWBFooterEditing(true);
  $('wb-add-status').innerHTML =
    '<p class="wb-add-context">正在编辑条目，修改后点「保存条目」</p>';
  $('wb-browse').style.display = 'none';
  $('wb-settings').style.display = 'none';
  $('wb-add').style.display = '';
  document.querySelectorAll('#wb-modal [data-wb-tab]').forEach(function (b) {
    b.classList.remove('active');
  });
  rememberUnsavedEditorBaseline('wb-modal');
}

function saveWBEntry() {
  return runModalSave('wb-modal', commitWBEntryEditor);
}
async function commitWBEntryEditor() {
  if (blockDuringGeneration('保存世界书条目')) return;
  const editIdx = $('wb-edit-id').value;
  const catId = $('wb-cat-select').value || $('wb-edit-cat-id').value || D.worldBook.categories[0]?.id;
  if (!catId) {
    toast('请先创建分类', 'err');
    return;
  }
  const cat = D.worldBook.categories.find((c) => c.id === catId);
  if (!cat) {
    toast('分类不存在', 'err');
    return;
  }

  const keys = $('wb-keys').value.trim();
  // Blank-only content is rejected, but saved content keeps its own leading and trailing whitespace.
  const content = $('wb-content').value;
  const triggerMode = $('wb-trigger-mode').value;
  const position = $('wb-position').value;
  const outletName = String($('wb-outlet-name').value || '').trim();
  if (!content.trim()) {
    toast('请填写内容', 'err');
    return;
  }
  if (!keys && triggerMode === 'keyword') {
    toast('请填写关键词，或把触发策略改为常驻或向量', 'err');
    return;
  }
  if (position === 'outlet' && !outletName) {
    toast('加入位置选为命名出口时必须填写出口名称', 'err');
    return;
  }

  const origCatId = $('wb-edit-cat-id').value,
    origIdx = parseInt(editIdx);
  const origCat = origCatId ? D.worldBook.categories.find((c) => c.id === origCatId) : null;
  const original = origCat && origIdx >= 0 && origIdx < origCat.entries.length ? origCat.entries[origIdx] : null;
  var submittedDepth = wbDepth($('wb-depth').value),
    submittedRole = ['system', 'user', 'assistant'].includes($('wb-role').value) ? $('wb-role').value : 'system',
    submittedScanDepth = wbEntryScanDepthFromEditor(),
    submittedWholeWords = $('wb-match-whole-words').value === '' ? null : $('wb-match-whole-words').value === 'true';
  // Editing keeps every stored field the editor does not own. When a visible value changes,
  // remove the old decorator group that would otherwise keep overriding the edited value.
  const entry = Object.assign(
    original ? copyJsonData(original) : { id: uid() },
    {
      keys: wbEditorKeyList(keys),
      content,
      name: $('wb-name').value.trim(),
      comment: $('wb-comment').value.trim(),
      position: position,
      depth: submittedDepth,
      order: wbNumber($('wb-order').value, 100),
      outletName: outletName,
      ignoreBudget: $('wb-ignore-budget').checked,
      probability: wbClamp(wbNumber($('wb-probability').value, 100), 0, 100),
      useProbability: $('wb-use-probability').checked,
      caseSensitive: $('wb-case-sensitive').value === '' ? null : $('wb-case-sensitive').value === 'true',
      matchWholeWords: submittedWholeWords,
      delayUntilRecursion: wbDelayUntilRecursionFromEditor(),
      role: submittedRole,
      constant: triggerMode === 'constant',
      vectorized: triggerMode === 'vector',
      selective: $('wb-selective').checked,
      secondary_keys: wbEditorKeyList($('wb-secondary').value),
      selectiveLogic: wbNumber($('wb-selective-logic').value, 0),
      scanDepth: submittedScanDepth,
      triggers: wbTriggerListFromEditor(),
      preventRecursion: $('wb-prevent-recursion').checked,
      excludeRecursion: $('wb-exclude-recursion').checked,
      characterFilter: wbCharacterFilterFromEditor(),
      sticky: Math.floor(Math.max(0, wbNumber($('wb-sticky').value, 0))),
      cooldown: Math.floor(Math.max(0, wbNumber($('wb-cooldown').value, 0))),
      delay: Math.floor(Math.max(0, wbNumber($('wb-delay').value, 0))),
      group: String($('wb-group').value || '').trim(),
      groupWeight: Math.floor(Math.max(1, wbNumber($('wb-group-weight').value, 100))),
      groupOverride: !!String($('wb-group').value || '').trim() && $('wb-group-override').checked,
      useGroupScoring: $('wb-use-group-scoring').value === '' ? null : $('wb-use-group-scoring').value === 'true',
      enabled: $('wb-enabled').checked,
      automationId: String($('wb-automation-id').value || '').trim(),
    },
    wbScanSourcesFromEditor()
  );
  if (original) {
    var removeDecoratorGroups = function (names) {
      var remove = new Set(names),
        groups = [],
        current = null;
      (Array.isArray(entry.decoratorLines) ? entry.decoratorLines : []).forEach(function (line) {
        var match = String(line || '')
            .trim()
            .match(/^(@@@?)([a-z_]+)/i),
          row = {
            line: line,
            name: match ? String(match[2] || '').toLowerCase() : '',
            fallback: !!(match && match[1] === '@@@'),
          };
        if (row.fallback && current) current.push(row);
        else {
          current = [row];
          groups.push(current);
        }
      });
      entry.decoratorLines = groups
        .filter(function (group) {
          return !group.some(function (row) {
            return remove.has(row.name);
          });
        })
        .reduce(function (all, group) {
          return all.concat(
            group.map(function (row) {
              return row.line;
            })
          );
        }, []);
    };
    var originalPosition = wbPosition(original.position),
      placementChanged = position !== originalPosition,
      depthChanged = submittedDepth !== wbDepth(original.depth),
      roleChanged = submittedRole !== String(original.role || 'system'),
      scanChanged =
        submittedScanDepth !== (original.scanDepth == null ? null : Math.max(0, wbNumber(original.scanDepth, 0)));
    if (placementChanged) {
      removeDecoratorGroups(['position', 'depth', 'instruct_depth', 'reverse_depth', 'reverse_instruct_depth']);
      delete entry.decoratorDepth;
      delete entry.instructDepth;
      delete entry.reverseDepth;
      delete entry.reverseInstructDepth;
      delete entry.characterPosition;
      delete entry.characterPositionFallbacks;
      entry.sourcePosition = position;
    } else if (depthChanged) {
      removeDecoratorGroups(['depth', 'instruct_depth', 'reverse_depth', 'reverse_instruct_depth']);
      delete entry.decoratorDepth;
      delete entry.instructDepth;
      delete entry.reverseDepth;
      delete entry.reverseInstructDepth;
    }
    if (roleChanged) removeDecoratorGroups(['role']);
    if (scanChanged) {
      removeDecoratorGroups(['scan_depth', 'instruct_scan_depth']);
      delete entry.instructScanDepth;
    }
  }
  if (original) {
    entry._raw = original._raw || original;
    [
      ['keys', 'keyAliases', 'keyAliasMap'],
      ['secondary_keys', 'secondaryKeyAliases', 'secondaryKeyAliasMap'],
    ].forEach(function (fields) {
      if (!original[fields[2]]) return;
      var pruned = wbPruneKeyAliases(original[fields[1]], original[fields[2]], original[fields[0]], entry[fields[0]]);
      entry[fields[1]] = pruned.aliases;
      entry[fields[2]] = pruned.map;
    });
  }

  var beforeCategories = copyJsonData(D.worldBook.categories),
    updated = !!original;
  if (updated) {
    if (origCatId === catId) {
      origCat.entries[origIdx] = entry;
    } else {
      origCat.entries.splice(origIdx, 1);
      cat.entries.push(entry);
    }
  } else {
    cat.entries.push(entry);
  }

  try {
    await persistWorldBookChange();
  } catch (error) {
    D.worldBook.categories = beforeCategories;
    toast('条目保存失败，编辑内容仍保留：' + error.message, 'err');
    return;
  }
  toast(updated ? '条目已更新' : '条目已添加', 'ok');
  wbViewState.expanded.add(String(catId));
  wbViewState.focusCatId = String(catId);
  wbViewState.focusEntryId = String(entry.id || '');
  $('wb-edit-id').value = String(
    cat.entries.findIndex(function (row) {
      return row && row.id === entry.id;
    })
  );
  $('wb-edit-cat-id').value = catId;
  $('wb-add-status').innerHTML = '<p class="status-line ok">' + uiIcon('check') + ' 已保存，可继续编辑</p>';
  renderWBSidebar();
  updateChatUI();
  setWBFooterEditing(true);
  rememberUnsavedEditorBaseline('wb-modal');
}

async function deleteWBEntry(catId, entryIdx) {
  if (blockDuringGeneration('删除世界书条目')) return;
  const cat = D.worldBook.categories.find((c) => c.id === catId);
  if (!cat) return;
  if (entryIdx < 0 || entryIdx >= cat.entries.length) return;
  var removed = cat.entries.splice(entryIdx, 1)[0];
  try {
    await persistWorldBookChange();
  } catch (error) {
    cat.entries.splice(entryIdx, 0, removed);
    toast('删除保存失败，条目已恢复：' + error.message, 'err');
    return;
  }
  renderWBAll();
  renderWBSidebar();
  updateChatUI();
  toast('条目已删除', 'info');
}

function renderWBAll() {
  var q = ($('wb-cat-search')?.value || '').toLowerCase();
  var ct = $('wb-cat-list');
  if (!ct) return;
  ensureWBListEvents();
  if (wbViewState.query !== q) {
    wbViewState.query = q;
    wbViewState.renderLimits = new Map();
  }
  var cats = D.worldBook.categories || [];
  if (!cats.length) {
    ct.innerHTML =
      '<div class="ui-empty"><strong>还没有世界书</strong><p>新建分类后添加条目，或在「导入」页导入世界书 JSON。</p></div>';
    return;
  }
  var h = '',
    renderedCategories = 0;
  cats.forEach(function (cat) {
    var derived = scheduleWBCategoryPrewarm(cat),
      entries = q ? wbFilteredRows(derived, q) : derived.ready ? derived.rows : null,
      indexPending = !!q && !derived.ready,
      isOpen = wbViewState.expanded.has(String(cat.id)),
      showEntries = isOpen || !!q,
      localizationPending = derived.ready ? derived.localizationPending : 0,
      cleanableBlank = derived.ready ? derived.cleanableBlank : 0,
      boundIds = worldBookCategoryBoundCharIds(cat),
      isGlobal = (D.worldBook.globalCategoryIds || []).includes(cat.id),
      scopeText = isGlobal
        ? '全局'
        : boundIds.length
          ? boundIds.length === 1
            ? '绑定 ' + getCharName(boundIds[0])
            : '已绑定 ' + boundIds.length + ' 个角色'
          : '未生效',
      sourceName =
        cat.sourceType === 'character_card'
          ? (D.characters || []).find(function (char) {
              return char && char.id === cat.ownerCharId;
            })
            ? getCharName(cat.ownerCharId)
            : String(
                (cat.entries || []).find(function (entry) {
                  return entry && entry._fromChar;
                })?._fromChar || '已删除角色'
              )
          : '',
      target = ' data-cat-id="' + escAttr(cat.id) + '"';
    if (q && !indexPending && !entries.length) return;
    renderedCategories++;
    h +=
      '<section class="wb-category"' +
      target +
      '><div class="wb-cat-hd' +
      (showEntries ? ' open' : '') +
      '" data-wb-action="toggle"' +
      target +
      ' role="button" tabindex="0" aria-expanded="' +
      showEntries +
      '"><span class="cat-arrow" aria-hidden="true"></span><span class="cat-main"><span class="cat-name">' +
      esc(wbCategoryDisplayName(cat)) +
      '</span><span class="cat-meta">' +
      (cat.entries || []).length +
      ' 条 · <span class="cat-scope' +
      (isGlobal || boundIds.length ? '' : ' is-off') +
      '">' +
      esc(scopeText) +
      '</span>' +
      (sourceName ? ' · 来自角色卡：' + esc(sourceName) : '') +
      (localizationPending ? ' · <span class="cat-flag">待补全汉化 ' + localizationPending + '</span>' : '') +
      (cleanableBlank ? ' · <span class="cat-flag">空白导入记录 ' + cleanableBlank + '</span>' : '') +
      '</span></span></div>';
    if (!showEntries) {
      h += '</section>';
      return;
    }
    h +=
      '<div class="wb-cat-body open"><div class="wb-cat-actions"><button type="button" class="btn text accent sm" data-wb-action="add-entry"' +
      target +
      '>添加条目</button><button type="button" class="btn text sm" data-wb-action="bind"' +
      target +
      '>作用范围</button><button type="button" class="btn text sm" data-wb-action="category-settings"' +
      target +
      '>分类设置</button><button type="button" class="btn text sm" data-wb-action="rename"' +
      target +
      '>重命名</button>' +
      (localizationPending
        ? '<button type="button" class="btn text sm" data-wb-action="localize"' +
          target +
          ' title="只重新处理未完成的中文名称和触发词">补全汉化 ' +
          localizationPending +
          '</button>'
        : '') +
      (cleanableBlank
        ? '<button type="button" class="btn text sm danger" data-wb-action="clean"' +
          target +
          ' title="仅清理由角色卡导入且语义全空的旧条目">清理空白 ' +
          cleanableBlank +
          '</button>'
        : '') +
      '<button type="button" class="btn text sm danger" data-wb-action="delete-category"' +
      target +
      '>删除分类</button></div>';
    if (indexPending) {
      h += '<p class="wb-cat-note">正在建立搜索索引…</p>';
    } else if (derived.ready && !entries.length) {
      h += '<p class="wb-cat-note">这个分类还没有条目。</p>';
    } else {
      var limitKey = wbRenderLimitKey(cat.id, q),
        limit = wbViewState.renderLimits.get(limitKey) || WB_RENDER_BATCH_SIZE,
        totalRows = entries ? entries.length : (cat.entries || []).length,
        visibleRows = wbRowsForRange(cat, entries, 0, Math.min(limit, totalRows));
      visibleRows.forEach(function (row) {
        h += wbEntryRenderHtml(cat, row);
      });
      if (totalRows > visibleRows.length)
        h +=
          '<div class="wb-load-more" data-wb-rendered-count="' +
          visibleRows.length +
          '"><button type="button" class="btn text sm" data-wb-action="load-more"' +
          target +
          '>加载更多（已显示 ' +
          visibleRows.length +
          ' / ' +
          totalRows +
          '）</button></div>';
    }
    h += '</div></section>';
  });
  if (q && !renderedCategories)
    h = '<div class="ui-empty"><strong>没有匹配的条目</strong><p>换个关键词，或清空搜索查看全部分类。</p></div>';
  ct.innerHTML = h;
  restoreWBViewState();
}

async function clearWB() {
  if (blockDuringGeneration('清空世界书')) return;
  var categories = D.worldBook.categories || [],
    entryCount = categories.reduce(function (total, cat) {
      return total + ((cat && cat.entries) || []).length;
    }, 0);
  if (
    !(await appConfirm(
      '清空全部 ' +
        categories.length +
        ' 个世界书分类和 ' +
        entryCount +
        ' 条内容？\n\n随角色卡导入的分类也会一并删除。此操作不会删除角色卡。',
      '清空世界书',
      '清空全部'
    ))
  )
    return;
  var oldCategories = D.worldBook.categories,
    oldGlobal = D.worldBook.globalCategoryIds,
    oldActive = D.worldBook.activeCategoryId;
  D.worldBook.categories = [];
  D.worldBook.globalCategoryIds = [];
  D.worldBook.activeCategoryId = '';
  try {
    await persistWorldBookChange();
  } catch (error) {
    D.worldBook.categories = oldCategories;
    D.worldBook.globalCategoryIds = oldGlobal;
    D.worldBook.activeCategoryId = oldActive;
    toast('清空保存失败，原世界书已恢复：' + error.message, 'err');
    return;
  }
  renderWBAll();
  renderWBSidebar();
  updateChatUI();
  toast('世界书已清空', 'info');
}

function loadWBSettings() {
  var settings = worldBookSettings();
  $('wb-scan-depth').value = settings.scanDepth;
  $('wb-budget-percent').value = settings.budgetPercent;
  $('wb-token-budget').value = settings.budgetCap;
  $('wb-include-names').checked = settings.includeNames;
  $('wb-recursive').checked = settings.recursive;
  $('wb-max-recursion-steps').value = settings.maxRecursionSteps;
  $('wb-min-activations').value = settings.minActivations;
  $('wb-min-activations-depth-max').value = settings.minActivationsDepthMax;
  $('wb-insertion-strategy').value = settings.insertionStrategy;
  $('wb-case-sensitive-global').checked = settings.caseSensitive;
  $('wb-match-whole-words-global').checked = settings.matchWholeWords;
  $('wb-use-group-scoring-global').checked = settings.useGroupScoring;
  $('wb-vector-query-messages').value = settings.vectorQueryMessages;
  $('wb-vector-max-entries').value = settings.vectorMaxEntries;
  $('wb-vector-score-threshold').value = settings.vectorScoreThreshold;
  var status = $('wb-settings-status');
  if (status) status.textContent = '';
  clearWBSettingsFieldErrors();
}
var WB_SETTINGS_INT_FIELDS = [
  ['scan_depth', 'wb-scan-depth', 0, 1000, '回看消息数量 0–1000'],
  // 末位 true：留空与 0 同义，都表示不限。
  ['budget_percent', 'wb-budget-percent', 0, 100, '预算占上下文比例 0–100', true],
  ['token_budget', 'wb-token-budget', 0, 262144, '预算上限 0–262144', true],
  ['max_recursion_steps', 'wb-max-recursion-steps', 0, null, '最多递归几轮（0 或更大的整数）'],
  ['min_activations', 'wb-min-activations', 0, null, '最少激活条数（0 或更大的整数）'],
  ['min_activations_depth_max', 'wb-min-activations-depth-max', 0, 1000, '最少激活条数的最大回看条数 0–1000'],
  ['vector_query_messages', 'wb-vector-query-messages', 1, null, '向量查询消息数（1 或更大的整数）'],
  ['vector_max_entries', 'wb-vector-max-entries', 1, null, '向量最多取回条数（1 或更大的整数）'],
];
// A rejected value is reported under its own field; the status line below the save button only reports saving.
function clearWBSettingsFieldErrors() {
  document.querySelectorAll('#wb-settings [aria-invalid]').forEach(function (node) {
    node.removeAttribute('aria-invalid');
  });
  document.querySelectorAll('#wb-settings .field-error').forEach(function (node) {
    node.remove();
  });
}
function showWBSettingsFieldError(id, message) {
  var input = $(id),
    field = input && input.closest('.fg');
  if (!field) return;
  var note = document.createElement('p');
  note.className = 'hint field-error';
  note.setAttribute('role', 'alert');
  note.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  field.appendChild(note);
  input.addEventListener('input', clearWBSettingsFieldErrors, { once: true });
  input.scrollIntoView({ block: 'center' });
}
async function saveWBSettings() {
  if (blockDuringGeneration('保存世界书设置')) return;
  var status = $('wb-settings-status'),
    next = {},
    invalid = '',
    invalidField = '';
  clearWBSettingsFieldErrors();
  if (status) status.textContent = '';
  WB_SETTINGS_INT_FIELDS.forEach(function (row) {
    if (invalid) return;
    var raw = String($(row[1]).value || '').trim(),
      value = raw === '' ? (row[5] ? 0 : NaN) : Number(raw);
    if (!Number.isInteger(value) || value < row[2] || (row[3] != null && value > row[3])) {
      invalid = '请输入允许范围内的整数：' + row[4] + '。';
      invalidField = row[1];
      return;
    }
    next[row[0]] = value;
  });
  var thresholdRaw = String($('wb-vector-score-threshold').value || '').trim(),
    threshold = thresholdRaw === '' ? NaN : Number(thresholdRaw);
  if (!invalid && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
    invalid = '请输入允许范围内的相似度门槛：0–1。';
    invalidField = 'wb-vector-score-threshold';
  }
  var strategy = String($('wb-insertion-strategy').value || '');
  if (!invalid && !WB_INSERTION_STRATEGIES.includes(strategy)) {
    invalid = '请选择有效的世界书排列方式。';
    invalidField = 'wb-insertion-strategy';
  }
  if (invalid) {
    showWBSettingsFieldError(invalidField, invalid);
    toast(invalid, 'err');
    return;
  }
  next.vector_score_threshold = threshold;
  next.insertion_strategy = strategy;
  next.include_names = $('wb-include-names').checked;
  next.recursive = $('wb-recursive').checked;
  next.case_sensitive = $('wb-case-sensitive-global').checked;
  next.match_whole_words = $('wb-match-whole-words-global').checked;
  next.use_group_scoring = $('wb-use-group-scoring-global').checked;
  var before = {};
  Object.keys(next).forEach(function (key) {
    before[key] = D.worldBook[key];
  });
  Object.assign(D.worldBook, next);
  try {
    await persistWorldBookChange({ urgent: true });
  } catch (error) {
    Object.assign(D.worldBook, before);
    loadWBSettings();
    var failure = '保存失败，原设置已恢复：' + error.message;
    if (status) status.innerHTML = '<span class="status-line err">' + uiIcon('alert') + ' ' + esc(failure) + '</span>';
    toast(failure, 'err');
    return;
  }
  if (typeof updateTokensBar === 'function') updateTokensBar(getChar());
  if (status) status.innerHTML = '<span class="status-line ok">' + uiIcon('check') + ' 已保存，下一次生成生效</span>';
  toast('世界书设置已保存，下一次生成生效', 'ok');
}
var _lastImportReports = {};
var _pendingWorldBookImports = [];
var _pendingWorldBookImportModes = new WeakMap();

function renderWBSidebar() {
  const ct = $('wb-sidebar-list');
  if (!ct) return;
  const cats = D.worldBook.categories || [];
  if (!cats.length) {
    ct.innerHTML =
      '<div class="ui-empty"><strong>还没有世界书</strong><p>在世界书管理里新建或导入，再设为全局或绑定到角色。</p></div>';
    return;
  }
  ct.innerHTML = cats
    .map(function (cat) {
      const count = (cat.entries || []).length,
        boundIds = worldBookCategoryBoundCharIds(cat),
        state = (D.worldBook.globalCategoryIds || []).includes(cat.id)
          ? '全局'
          : boundIds.length
            ? boundIds.length === 1
              ? '绑定：' + esc(getCharName(boundIds[0]))
              : '已绑定 ' + boundIds.length + ' 个角色'
            : '未绑定';
      return (
        '<button type="button" class="char-item wb-sidebar-category" onclick="openModal(\'wb-modal\')"><span class="char-info"><span class="char-title"><span class="cname">' +
        esc(wbCategoryDisplayName(cat)) +
        '</span></span><span class="cmeta">' +
        count +
        ' 条 · ' +
        state +
        '</span></span></button>'
      );
    })
    .join('');
}
