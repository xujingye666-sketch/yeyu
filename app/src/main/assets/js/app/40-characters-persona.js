// ===== Create/Edit Character =====
var _alternateGreetingsExpanded = false,
  _characterBackgroundClearRequested = false,
  _characterAvatarClearRequested = false,
  _characterEditorBaseline = null;
function readAlternateGreetingsEditor() {
  var host = $('c-alt-greetings');
  if (!host) return [];
  var rows = Array.from(host.querySelectorAll('textarea[data-alt-greeting]')).map(function (input) {
    var source = input._greetingSource;
    return source && source.text === input.value ? source.value : String(input.value || '').trim();
  });
  return rows;
}
function renderAlternateGreetingsEditor(values, expanded) {
  var host = $('c-alt-greetings');
  if (!host) return;
  if (expanded !== undefined) _alternateGreetingsExpanded = !!expanded;
  var rows = (Array.isArray(values) ? values : []).map(normalizeGreetingValue),
    collapsed = rows.length > 3 && !_alternateGreetingsExpanded;
  host.innerHTML =
    rows
      .map(function (text, index) {
        return (
          '<div class="character-alt-greeting' +
          (collapsed && index >= 3 ? ' is-collapsed' : '') +
          '"><div class="character-alt-greeting-label"><span>备用开场白 ' +
          (index + 1) +
          '</span><button type="button" class="btn text sm danger" onclick="removeAlternateGreeting(' +
          index +
          ')" aria-label="删除备用开场白 ' +
          (index + 1) +
          '">删除</button></div><textarea rows="4" data-alt-greeting="' +
          index +
          '" aria-label="备用开场白 ' +
          (index + 1) +
          '" placeholder="另一种开场方式">' +
          esc(text) +
          '</textarea></div>'
        );
      })
      .join('') +
    (rows.length > 3
      ? '<button type="button" class="character-alt-greetings-toggle" aria-expanded="' +
        _alternateGreetingsExpanded +
        '" onclick="toggleAlternateGreetings()">' +
        alternateGreetingsToggleContent(rows.length) +
        '</button>'
      : '');
  host.querySelectorAll('textarea[data-alt-greeting]').forEach(function (input, index) {
    input._greetingSource = { text: input.value, value: values[index] };
  });
}
function alternateGreetingsToggleContent(count) {
  return (
    '<span>' +
    (_alternateGreetingsExpanded ? '收起备用开场白' : '展开其余 ' + (count - 3) + ' 条') +
    '</span>' +
    uiIcon(_alternateGreetingsExpanded ? 'arrow-up' : 'arrow-down')
  );
}
// Folding only hides the rows beyond the first three and leaves every text area as typed, so
// expanding or collapsing is never an edit.
function toggleAlternateGreetings() {
  var host = $('c-alt-greetings'),
    toggle = host && host.querySelector('.character-alt-greetings-toggle');
  if (!toggle) return;
  _alternateGreetingsExpanded = !_alternateGreetingsExpanded;
  var rows = host.querySelectorAll('.character-alt-greeting');
  rows.forEach(function (row, index) {
    if (index >= 3) row.classList.toggle('is-collapsed', !_alternateGreetingsExpanded);
  });
  toggle.setAttribute('aria-expanded', String(_alternateGreetingsExpanded));
  toggle.innerHTML = alternateGreetingsToggleContent(rows.length);
}
function addAlternateGreeting(value) {
  var rows = readAlternateGreetingsEditor();
  rows.push(String(value || ''));
  renderAlternateGreetingsEditor(rows, true);
  var fields = $('c-alt-greetings').querySelectorAll('textarea[data-alt-greeting]'),
    last = fields[fields.length - 1];
  if (last) {
    last.focus();
    last.scrollIntoView({ block: 'nearest' });
  }
}
function removeAlternateGreeting(index) {
  var rows = readAlternateGreetingsEditor();
  if (index >= 0 && index < rows.length) rows.splice(index, 1);
  renderAlternateGreetingsEditor(rows, _alternateGreetingsExpanded && rows.length > 3);
}
function characterCardDateText(value) {
  var seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  try {
    return new Date(seconds * 1000).toLocaleString();
  } catch (_) {
    return '';
  }
}
function renderCharacterCardMeta(char) {
  var details = $('c-card-meta'),
    host = $('c-card-meta-content');
  if (!details || !host) return;
  var rows = [],
    add = function (label, html) {
      if (html)
        rows.push(
          '<div class="card-source-row"><strong>' +
            esc(label) +
            '</strong><div class="card-source-value">' +
            html +
            '</div></div>'
        );
    },
    meta = (char && char.importMeta) || {},
    sources = Array.isArray(char && char.source) ? char.source : [];
  if (char && String(char.nickname || '').trim()) add('对话昵称', esc(char.nickname));
  if (meta.format === 'chara_card_v3') add('卡片格式', 'Character Card V3');
  if (sources.length)
    add(
      '来源',
      sources
        .map(function (source) {
          var text = String(source || '').trim();
          return /^https?:\/\//i.test(text)
            ? '<a href="' + escAttr(text) + '" rel="noopener">' + esc(text) + '</a>'
            : '<span>' + esc(text) + '</span>';
        })
        .join('')
    );
  add('创建时间', esc(characterCardDateText(char && char.creation_date)));
  add('修改时间', esc(characterCardDateText(char && char.modification_date)));
  host.innerHTML = rows.join('');
  details.hidden = !rows.length;
  if (!rows.length) details.open = false;
}
function resetCharacterForm() {
  _characterBackgroundClearRequested = false;
  _characterAvatarClearRequested = false;
  _characterEditorBaseline = null;
  [
    'c-name',
    'c-emoji',
    'c-avatar-data',
    'c-desc',
    'c-personality',
    'c-scenario',
    'c-first-mes',
    'c-examples',
    'c-system-prompt',
    'c-post-history',
    'c-author-notes-preview',
    'c-tags',
  ].forEach(function (id) {
    var el = $(id);
    if (el) el.value = '';
  });
  $('edit-char-id').value = '';
  $('create-title').textContent = '创建角色';
  renderAlternateGreetingsEditor([], false);
  renderCharacterCardMeta(null);
  setCharacterAvatarPreview('');
  if ($('c-avatar-file')) $('c-avatar-file').value = '';
  var temp = document.getElementById('temp-bg-data');
  if (temp) temp.remove();
  var preview = $('bg-preview'),
    image = preview && preview.querySelector('img');
  if (image) image.remove();
  if ($('bg-text')) $('bg-text').style.display = '';
  if ($('c-bg-file')) $('c-bg-file').value = '';
}
function openCharacterCreator() {
  resetCharacterForm();
  openModal('create-modal');
}
function syncCharacterGreetingMediaAssets(char, previousAssets) {
  var current = char && Array.isArray(char.media_assets) ? char.media_assets : [],
    prior = current.length ? current : Array.isArray(previousAssets) ? previousAssets : [],
    bySource = new Map();
  prior.forEach(function (asset) {
    var source = normalizeRemoteCardUrl(asset && asset.sourceUrl) || String((asset && asset.sourceUrl) || '').trim();
    if (source && !bySource.has(source)) bySource.set(source, asset);
  });
  var openings = collectCardMediaAssets({
    first_mes: char.first_mes,
    alternate_greetings: char.alternate_greetings,
  }).map(function (asset) {
    var priorAsset = bySource.get(normalizeRemoteCardUrl(asset.sourceUrl) || String(asset.sourceUrl || '').trim());
    return priorAsset
      ? Object.assign({}, priorAsset, asset, {
          id: priorAsset.id || asset.id,
          status: priorAsset.status || asset.status,
          data_url: priorAsset.data_url || asset.data_url || '',
          mediaKey: priorAsset.mediaKey || '',
        })
      : asset;
  });
  return prior
    .filter(function (asset) {
      return asset && asset.kind !== 'opening';
    })
    .concat(openings);
}
async function editCharacter(id) {
  const ch = D.characters.find((c) => c.id === id);
  if (!ch) return;
  var avatar = await loadStoredMediaDataUrl(ch, 'avatar_image'),
    background = await loadStoredMediaDataUrl(ch, 'background_image');
  _characterBackgroundClearRequested = false;
  _characterAvatarClearRequested = false;
  $('create-title').textContent = '编辑角色';
  $('edit-char-id').value = id;
  $('c-name').value = ch.name;
  $('c-emoji').value = ch.avatar_emoji || '';
  $('c-avatar-data').value = avatar || '';
  setCharacterAvatarPreview(avatar || '');
  $('c-desc').value = ch.description;
  $('c-personality').value = ch.personality;
  $('c-scenario').value = ch.scenario;
  $('c-first-mes').value = normalizeGreetingValue(ch.first_mes);
  $('c-examples').value = ch.mes_example;
  $('c-system-prompt').value = ch.system_prompt || '';
  $('c-post-history').value = ch.post_history_instructions || '';
  renderAlternateGreetingsEditor(ch.alternate_greetings || [], false);
  $('c-author-notes-preview').value =
    ch.creator_notes_zh ||
    ch.creator_notes_display ||
    ch.creator_notes_clean ||
    window.YeyuPure.cleanCreatorNotes(ch.creator_notes || '').cleaned ||
    '';
  $('c-tags').value = (ch.tags || []).join(', ');
  renderCharacterCardMeta(ch);
  // Background preview
  const bgPreview = $('bg-preview');
  const existingImg = bgPreview.querySelector('img');
  if (existingImg) existingImg.remove();
  $('bg-text').style.display = background ? 'none' : '';
  if (background) {
    const img = document.createElement('img');
    img.src = background;
    bgPreview.appendChild(img);
  }
  // Store temp bg data
  let tempEl = document.getElementById('temp-bg-data');
  if (!tempEl) {
    tempEl = document.createElement('input');
    tempEl.type = 'hidden';
    tempEl.id = 'temp-bg-data';
    document.body.appendChild(tempEl);
  }
  tempEl.value = background || '';
  rememberCharacterEditorBaseline();
  openModal('create-modal');
}
function rememberCharacterEditorBaseline() {
  _characterEditorBaseline = {
    id: $('edit-char-id').value,
    avatar: $('c-avatar-data').value,
    background: document.getElementById('temp-bg-data')?.value || '',
    first: $('c-first-mes').value,
    alternates: JSON.stringify(readAlternateGreetingsEditor()),
  };
}
function handleBgUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!/^image\//i.test(file.type)) {
    toast('请选择图片文件', 'err');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onerror = function () {
    toast('图片读取失败', 'err');
  };
  reader.onload = function (ev) {
    const source = ev.target.result,
      img = new Image();
    img.onerror = function () {
      toast('图片解码失败', 'err');
    };
    img.onload = function () {
      const max = 1920,
        scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)),
        c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.86),
        bgPreview = $('bg-preview'),
        old = bgPreview.querySelector('img');
      if (old) old.remove();
      const preview = document.createElement('img');
      preview.src = dataUrl;
      bgPreview.appendChild(preview);
      $('bg-text').style.display = 'none';
      let tempEl = document.getElementById('temp-bg-data');
      if (!tempEl) {
        tempEl = document.createElement('input');
        tempEl.type = 'hidden';
        tempEl.id = 'temp-bg-data';
        document.body.appendChild(tempEl);
      }
      tempEl.value = dataUrl;
      _characterBackgroundClearRequested = false;
      if (scale < 1) toast('背景图已压缩到最大边 1920px', 'info');
    };
    img.src = source;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}
function clearCharacterBackground(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  _characterBackgroundClearRequested = true;
  var temp = document.getElementById('temp-bg-data');
  if (!temp) {
    temp = document.createElement('input');
    temp.type = 'hidden';
    temp.id = 'temp-bg-data';
    document.body.appendChild(temp);
  }
  temp.value = '';
  var preview = $('bg-preview'),
    image = preview && preview.querySelector('img');
  if (image) image.remove();
  if ($('bg-text')) $('bg-text').style.display = '';
  if ($('c-bg-file')) $('c-bg-file').value = '';
}

function setCharacterAvatarPreview(dataUrl) {
  const box = $('character-avatar-preview');
  if (!box) return;
  box.querySelector('img')?.remove();
  var src = safeImage(dataUrl, true);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '角色头像预览';
    box.appendChild(img);
    if ($('c-avatar-text')) $('c-avatar-text').style.display = 'none';
  } else if ($('c-avatar-text')) $('c-avatar-text').style.display = '';
}
function clearCharacterAvatar(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  _characterAvatarClearRequested = true;
  if ($('c-avatar-data')) $('c-avatar-data').value = '';
  if ($('c-avatar-file')) $('c-avatar-file').value = '';
  setCharacterAvatarPreview('');
}
function preserveCharacterMediaRefs(oldCharacter, avatarImage, backgroundImage) {
  var media =
    oldCharacter && oldCharacter._media && typeof oldCharacter._media === 'object'
      ? Object.assign({}, oldCharacter._media)
      : null;
  if (media) {
    if (!avatarImage) delete media.avatar_image;
    if (!backgroundImage) delete media.background_image;
    if (!Object.keys(media).length) media = null;
  }
  return media;
}
function storedMediaUnchanged(oldCharacter, field, nextValue) {
  var next = String(nextValue || '');
  if (!oldCharacter) return !next;
  if (!next)
    return !(
      oldCharacter[field] ||
      (oldCharacter._media && oldCharacter._media[field]) ||
      (oldCharacter._mediaBlobs && oldCharacter._mediaBlobs[field])
    );
  if (oldCharacter[field] && oldCharacter[field] === next) return true;
  var hash = oldCharacter._mediaHash && oldCharacter._mediaHash[field];
  return !!(
    hash &&
    window.YeyuRepository &&
    typeof YeyuRepository.hashValue === 'function' &&
    YeyuRepository.hashValue(next) === String(hash)
  );
}
function copyStoredMediaBlobs(source, target, keepAvatar, keepBackground) {
  if (!source || !target) return target;
  delete target._mediaDisplay;
  var blobs = source._mediaBlobs || {};
  target._mediaBlobs = target._mediaBlobs || {};
  if (keepAvatar && blobs.avatar_image) target._mediaBlobs.avatar_image = blobs.avatar_image;
  if (keepBackground && blobs.background_image) target._mediaBlobs.background_image = blobs.background_image;
  if (!Object.keys(target._mediaBlobs).length) delete target._mediaBlobs;
  return target;
}

function saveCharacter() {
  return runModalSave('create-modal', commitCharacterEditor);
}
async function commitCharacterEditor() {
  if (blockDuringGeneration('保存角色')) return;
  const name = $('c-name').value.trim();
  if (!name) {
    toast('请输入名称', 'err');
    return;
  }
  const editId = $('edit-char-id').value;
  const bgData = document.getElementById('temp-bg-data')?.value || '';
  let char = {
    name,
    avatar_emoji: $('c-emoji').value.trim(),
    description: $('c-desc').value.trim(),
    personality: $('c-personality').value.trim(),
    scenario: $('c-scenario').value.trim(),
    first_mes: $('c-first-mes').value.trim(),
    alternate_greetings: readAlternateGreetingsEditor(),
    mes_example: $('c-examples').value.trim(),
    system_prompt: $('c-system-prompt').value.trim(),
    post_history_instructions: $('c-post-history').value.trim(),
    tags: $('c-tags')
      .value.split(',')
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean),
    avatar_image: safeImage($('c-avatar-data').value, false),
    background_image: bgData,
  };
  var previousCharacter = null,
    editedIndex = -1,
    createdChat = false;
  if (editId) {
    const idx = D.characters.findIndex((c) => c.id === editId);
    if (idx >= 0) {
      const old = D.characters[idx];
      previousCharacter = old;
      editedIndex = idx;
      var baseline =
        _characterEditorBaseline && _characterEditorBaseline.id === editId ? _characterEditorBaseline : null;
      if (baseline && baseline.first === $('c-first-mes').value) delete char.first_mes;
      if (baseline && baseline.alternates === JSON.stringify(char.alternate_greetings)) delete char.alternate_greetings;
      char = Object.assign({}, old, char);
      if (Array.isArray(old.nameAliases)) char.nameAliases = old.nameAliases.slice();
      var avatarUnchanged =
          !_characterAvatarClearRequested &&
          ((baseline && baseline.avatar === $('c-avatar-data').value) ||
            storedMediaUnchanged(old, 'avatar_image', char.avatar_image)),
        backgroundUnchanged =
          !_characterBackgroundClearRequested &&
          ((baseline && baseline.background === bgData) ||
            storedMediaUnchanged(old, 'background_image', char.background_image));
      char._media = preserveCharacterMediaRefs(
        old,
        avatarUnchanged || char.avatar_image,
        backgroundUnchanged || char.background_image
      );
      if (old._mediaHash) {
        char._mediaHash = Object.assign({}, old._mediaHash);
        if (!avatarUnchanged) delete char._mediaHash.avatar_image;
        if (!backgroundUnchanged) delete char._mediaHash.background_image;
      }
      if (old._mediaBlobs) {
        char._mediaBlobs = Object.assign({}, old._mediaBlobs);
        if (!avatarUnchanged) delete char._mediaBlobs.avatar_image;
        if (!backgroundUnchanged) delete char._mediaBlobs.background_image;
      }
      if (avatarUnchanged) char.avatar_image = old.avatar_image || '';
      if (backgroundUnchanged) char.background_image = old.background_image || '';
      copyStoredMediaBlobs(old, char, avatarUnchanged, backgroundUnchanged);
      if (char.importMeta) {
        char.importMeta = Object.assign({}, char.importMeta);
        if (!avatarUnchanged) char.importMeta.avatarUserReplaced = true;
        if (!backgroundUnchanged || _characterBackgroundClearRequested) {
          char.importMeta.backgroundExplicit = !!char.background_image;
          char.importMeta.backgroundUserReplaced = !!char.background_image;
          char.importMeta.derivedBackgroundDisabled = !char.background_image;
          char.importMeta.backgroundPresentation = '';
          char.importMeta.backgroundPresentationVersion = 0;
          char.importMeta.sourceBackgroundStatus = char.background_image ? 'user-replaced' : 'user-cleared';
        }
      }
      applyCharacterRename(char, old, name);
      char.media_assets = syncCharacterGreetingMediaAssets(char, old.media_assets);
      D.characters[idx] = char;
    }
  } else {
    char = Object.assign(
      { creator: '自定义', creator_notes: '', creator_notes_clean: '', creator_notes_zh: '', extensions: {} },
      char
    );
    char.id = 'c_' + uid();
    char.media_assets = syncCharacterGreetingMediaAssets(char, []);
    D.characters.push(char);
    D.chats[char.id] = { sessions: [], activeSid: null };
    createdChat = true;
  }
  ensureCharacterIntelligence(char);
  try {
    await saveData(['characters', 'sessions']);
  } catch (saveError) {
    if (previousCharacter && editedIndex >= 0) D.characters[editedIndex] = previousCharacter;
    else {
      D.characters = D.characters.filter(function (c) {
        return c.id !== char.id;
      });
      if (createdChat) delete D.chats[char.id];
    }
    toast('角色保存失败，原数据已恢复：' + saveError.message, 'err');
    return;
  }
  await refreshCharacterData(char);
  $('edit-char-id').value = char.id;
  $('create-title').textContent = '编辑角色';
  _characterAvatarClearRequested = false;
  _characterBackgroundClearRequested = false;
  rememberCharacterEditorBaseline();
  rememberUnsavedEditorBaseline('create-modal');
  toast(editId ? '角色已更新，可继续编辑' : '角色已创建，可继续编辑', 'ok');
}

async function refreshCharacterData(char) {
  invalidateCardScriptStack(char);
  if (typeof invalidateCacheContexts === 'function') invalidateCacheContexts(char.id, 0, true);
  if (typeof invalidateCardScriptDisplayCache === 'function') invalidateCardScriptDisplayCache(char);
  renderCharList();
  updateChatUI();
  if (D.currentCharId === char.id) {
    var session = getActiveSession(char.id),
      first = session && session.msgs[0],
      greetingRebuilt = false;
    if (
      session &&
      char.first_mes &&
      (!first || (session.msgs.length === 1 && first.opening === true)) &&
      !(session.tavernHelperMetadata && session.tavernHelperMetadata.tainted) &&
      (!first || first.content !== char.first_mes)
    ) {
      var before = session.msgs,
        beforeSeq = session.nextMessageSeq;
      session.msgs = [];
      appendOpeningGreeting(char, session, char.first_mes, 0);
      try {
        await saveData('sessions');
      } catch (error) {
        session.msgs = before;
        session.nextMessageSeq = beforeSeq;
        throw error;
      }
      greetingRebuilt = true;
    }
    if (typeof syncCardScriptLibrary === 'function') syncCardScriptLibrary(char);
    if (greetingRebuilt && typeof cardFrontendRedrawGreeting === 'function') cardFrontendRedrawGreeting(renderChat);
    else renderChat();
    await applyCharBackground(char);
  }
}

async function deleteCharacter(id) {
  if (blockDuringGeneration('删除角色')) return;
  const ch = D.characters.find((c) => c.id === id);
  if (!ch) return;
  var ownedBooks = (D.worldBook.categories || []).filter(function (cat) {
      return cat && cat.sourceType === 'character_card' && cat.ownerCharId === id;
    }),
    deleteOwnedBooks = false;
  if (ownedBooks.length) {
    var totalEntries = ownedBooks.reduce(function (total, cat) {
        return total + (cat.entries || []).length;
      }, 0),
      details = ownedBooks
        .map(function (cat) {
          return '<li><b>' + esc(wbCategoryDisplayName(cat)) + '</b>：' + (cat.entries || []).length + ' 条</li>';
        })
        .join('');
    appPromptMode = 'confirm';
    $('app-prompt-title').textContent = '删除角色';
    $('app-prompt-message').classList.add('app-prompt-rich');
    $('app-prompt-message').innerHTML =
      '<p>删除“' +
      esc(canonicalCharacterName(ch)) +
      '”及其所有对话？</p><p>以下世界书分类随这张角色卡导入，共 ' +
      totalEntries +
      ' 条内容：</p><ul class="wb-delete-source-list">' +
      details +
      '</ul><label class="import-mode-option wb-delete-source-choice"><input id="delete-owned-worldbooks" type="checkbox" checked><span><strong>同时删除这些世界书分类</strong><small>取消勾选会完整保留分类和条目，只移除已删除角色的绑定。</small></span></label>';
    $('app-prompt-field').style.display = 'none';
    $('app-prompt-ok').textContent = '删除角色';
    openModal('app-prompt-modal');
    var confirmed = await new Promise(function (resolve) {
      appPromptResolver = resolve;
    });
    if (!confirmed) return;
    deleteOwnedBooks = !!$('delete-owned-worldbooks')?.checked;
  } else if (!(await appConfirm(`删除「${canonicalCharacterName(ch)}」及其所有对话？`, '删除角色', '删除'))) return;
  if (typeof qrStopAndAwait === 'function') await qrStopAndAwait();
  else if (typeof stopStscriptRun === 'function') stopStscriptRun();
  try {
    if (!(await deleteCharacterData(id, { deleteOwnedBooks: deleteOwnedBooks }))) return;
  } catch (error) {
    toast('删除保存失败，角色、对话和人格绑定已恢复：' + error.message, 'err');
    return;
  }
  toast(
    deleteOwnedBooks
      ? '角色、对话和随卡世界书已删除'
      : ownedBooks.length
        ? '角色和对话已删除，随卡世界书已保留'
        : '已删除',
    'info'
  );
}

async function deleteCharacterData(id, options) {
  options = options || {};
  if (typeof _generationState !== 'undefined' && _generationState !== 'idle')
    throw new Error('请先停止生成，再删除角色');
  var target = D.characters.find(function (char) {
    return char.id === id;
  });
  if (!target) return false;
  var deleteOwnedBooks = options.deleteOwnedBooks === true,
    ownedBooks = (D.worldBook.categories || []).filter(function (cat) {
      return cat && cat.sourceType === 'character_card' && cat.ownerCharId === id;
    });
  var journal = createMutationJournal(),
    deletingCurrent = D.currentCharId === id,
    ownedData = beginOwnedChatDataRemoval(id, null, [target].concat((D.chats[id] && D.chats[id].sessions) || []));
  if (deletingCurrent) {
    invalidateBackgroundThemeRequest();
    setThemeProgress(false);
  }
  journal.splice(D.characters, D.characters.indexOf(target), 1);
  journal.capture(D.chats, [id], true);
  delete D.chats[id];
  var voices = D.settings.speech && D.settings.speech.characters;
  if (voices && Object.prototype.hasOwnProperty.call(voices, id)) {
    journal.capture(voices, [id], true);
    delete voices[id];
  }
  var regexScriptsRemoved =
    typeof removeCharacterOwnedRegexScripts === 'function' && removeCharacterOwnedRegexScripts(id, journal);
  var ownedIds = deleteOwnedBooks
      ? ownedBooks.map(function (cat) {
          return cat.id;
        })
      : [],
    worldBookChanged =
      ownedIds.length > 0 ||
      (D.worldBook.categories || []).some(function (cat) {
        return worldBookCategoryBoundCharIds(cat).includes(id);
      });
  var categories = D.worldBook.categories || [];
  for (var categoryIndex = categories.length - 1; categoryIndex >= 0; categoryIndex--) {
    var category = categories[categoryIndex];
    if (ownedIds.includes(category.id)) {
      journal.splice(categories, categoryIndex, 1);
      continue;
    }
    var bound = worldBookCategoryBoundCharIds(category).filter(function (charId) {
      return charId !== id;
    });
    if (bound.length !== worldBookCategoryBoundCharIds(category).length) {
      journal.capture(category, ['boundCharIds'], true);
      setWorldBookCategoryBoundCharIds(category, bound);
    }
  }
  var globalCategoryIds = D.worldBook.globalCategoryIds || [];
  for (var globalIndex = globalCategoryIds.length - 1; globalIndex >= 0; globalIndex--)
    if (ownedIds.includes(globalCategoryIds[globalIndex])) journal.splice(globalCategoryIds, globalIndex, 1);
  journal.capture(D.worldBook, ['activeCategoryId'], true);
  if (ownedIds.includes(D.worldBook.activeCategoryId)) D.worldBook.activeCategoryId = categories[0]?.id || '';
  if (worldBookChanged) invalidateCacheContexts();
  var personaBindingsChanged = (D.personas || []).some(function (persona) {
    return personaBoundCharIds(persona).includes(id);
  });
  if (personaBindingsChanged)
    (D.personas || []).forEach(function (persona) {
      if (!personaBoundCharIds(persona).includes(id)) return persona;
      setPersonaBoundCharIds(
        persona,
        personaBoundCharIds(persona).filter(function (charId) {
          return charId !== id;
        }),
        journal
      );
    });
  journal.capture(D, ['currentCharId'], true);
  if (D.currentCharId === id) {
    D.currentCharId = D.characters[0]?.id || null;
  }
  journal.seal();
  try {
    await saveData(['meta', 'characters', 'personas', 'sessions', 'worldbook'], ownedData.saveOptions());
  } catch (saveError) {
    journal.rollback();
    ownedData.release();
    if (deletingCurrent) applyCharBackground(getChar(), false);
    throw saveError;
  }
  ownedData.commit();
  if (typeof clearMvuCharacterRuntime === 'function') clearMvuCharacterRuntime(id);
  if (regexScriptsRemoved) {
    invalidateRegexScriptRuntimeCache();
    if (typeof renderRegexScriptManager === 'function') renderRegexScriptManager();
  }
  renderCharList();
  renderPersonaList();
  renderChat();
  renderWBAll();
  renderWBSidebar();
  updateChatUI();
  var nextChar = getChar(),
    nextCharId = (nextChar && nextChar.id) || '';
  await applyCharBackground(nextChar, false);
  if (String(D.currentCharId || '') === String(nextCharId)) updateChatUI();
  return true;
}

var _listRenderTimers = Object.create(null);
function scheduleListRender(kind) {
  clearTimeout(_listRenderTimers[kind]);
  _listRenderTimers[kind] = setTimeout(function () {
    if (kind === 'characters') renderCharList();
    else if (kind === 'worldbook') renderWBAll();
  }, 120);
}
function applyCharacterRename(char, previous, name) {
  char.name = name;
  if (!previous || name === previous.name) return;
  char.localizedName = name;
  char.nameAliases = window.YeyuPure.uniqueTextList(
    [name, previous.name, previous.localizedName].concat(previous.nameAliases || []),
    40
  );
  char.participantRegistryVersion = 0;
}
function renderCharList() {
  if (typeof syncEmptyHomeCopy === 'function') syncEmptyHomeCopy();
  const q = ($('char-search')?.value || '').toLowerCase();
  var chars = D.characters.filter(function (c) {
    if (!c) return false;
    var searchable = [c.name, c.localizedName]
      .concat(c.nameAliases || [])
      .join(' ')
      .toLowerCase();
    return (
      !q ||
      searchable.includes(q) ||
      (c.tags || []).some(function (t) {
        return t.toLowerCase().includes(q);
      }) ||
      (c.description || '').toLowerCase().includes(q)
    );
  });
  // Sort: favorites first, then by name
  chars.sort(function (a, b) {
    if ((a.favorite || false) !== (b.favorite || false)) return b.favorite || false ? 1 : -1;
    return canonicalCharacterName(a).localeCompare(canonicalCharacterName(b));
  });

  // Collect all unique tags for filter chips
  var allTags = [];
  var seen = {};
  D.characters.forEach(function (c) {
    if (!c) return;
    (c.tags || []).forEach(function (t) {
      if (!seen[t.toLowerCase()]) {
        seen[t.toLowerCase()] = true;
        allTags.push(t);
      }
    });
  });

  const ct = $('char-list');
  if (!chars.length) {
    ct.innerHTML = q
      ? '<div class="ui-empty"><strong>没有匹配的角色</strong><p>换个名称、标签或简介里的词再搜。</p></div>'
      : '<div class="ui-empty"><strong>还没有角色</strong><p>导入角色卡，或从空白创建一个角色。</p></div>';
    return;
  }
  // Tag filter chips
  var h = '';
  if (allTags.length > 0) {
    h += '<div class="tag-chips">';
    allTags.forEach(function (t) {
      h +=
        '<button type="button" class="tag-chip' +
        (q === t.toLowerCase() ? ' active' : '') +
        '" onclick="event.stopPropagation();$(\'char-search\').value=' +
        jsArg(t) +
        ';renderCharList()">' +
        esc(t) +
        '</button>';
    });
    if (q)
      h +=
        '<button type="button" class="tag-chip tag-chip-clear" onclick="event.stopPropagation();$(\'char-search\').value=\'\';renderCharList()">清除筛选</button>';
    h += '</div>';
  }
  chars.forEach(function (c) {
    var act = c.id === D.currentCharId ? ' active' : '';
    var avatarSrc =
      typeof displayImageSrc === 'function' ? displayImageSrc(c, 'avatar_image') : safeImage(c.avatar_image, true);
    var av = avatarSrc ? '<img src="' + escAttr(avatarSrc) + '" alt="">' : '',
      version = String(c.character_version || '').trim();
    h +=
      '<div class="char-item' +
      act +
      '" data-char-id="' +
      escAttr(c.id) +
      '" onclick="selectCharacter(' +
      jsArg(c.id) +
      ')">' +
      '<details class="char-tools" onclick="event.stopPropagation()"><summary aria-label="角色操作" title="角色操作">' +
      uiIcon('more') +
      '</summary><div class="char-actions">' +
      '<button class="btn text sm" onclick="event.stopPropagation();toggleFavorite(' +
      jsArg(c.id) +
      ');renderCharList()" title="' +
      (c.favorite ? '取消收藏' : '收藏') +
      '">' +
      (c.favorite ? '取消收藏' : '收藏') +
      '</button>' +
      '<button class="btn text sm" onclick="event.stopPropagation();editCharacter(' +
      jsArg(c.id) +
      ')" title="编辑">编辑</button>' +
      '<button class="btn text sm" onclick="event.stopPropagation();duplicateCharacter(' +
      jsArg(c.id) +
      ')" title="复制">复制</button>' +
      '<button class="btn text sm danger" onclick="event.stopPropagation();deleteCharacter(' +
      jsArg(c.id) +
      ')" title="删除">删除</button>' +
      '</div></details>' +
      '<div class="char-avatar">' +
      av +
      '</div>' +
      '<div class="char-info"><div class="char-title">' +
      (c.favorite ? '<span class="char-favorite" title="已收藏">' + uiIcon('star') + '</span>' : '') +
      '<span class="cname">' +
      esc(canonicalCharacterName(c)) +
      '</span>' +
      (version ? '<span class="char-version">' + esc(/^v/i.test(version) ? version : 'v' + version) + '</span>' : '') +
      '</div><div class="cmeta">' +
      esc((c.description || c.personality || '').slice(0, 45)) +
      '</div></div></div>';
  });
  ct.innerHTML = h;
}

async function toggleFavorite(id) {
  var ch = D.characters.find(function (c) {
    return c.id === id;
  });
  if (!ch) return;
  ch.favorite = !ch.favorite;
  try {
    await saveData('characters');
  } catch (error) {
    ch.favorite = !ch.favorite;
    toast('收藏状态保存失败', 'err');
    return;
  }
  toast(ch.favorite ? '已收藏' : '已取消收藏', 'info');
}

async function duplicateCharacter(id) {
  if (blockDuringGeneration('复制角色')) return;
  const ch = D.characters.find((c) => c.id === id);
  if (!ch) return;
  const copied = copyJsonData(ch),
    n = {};
  Object.keys(copied).forEach(function (key) {
    if (!/memory/i.test(key)) n[key] = copied[key];
  });
  n.id = 'c_' + uid();
  n.name = ch.name + ' (副本)';
  n.localizedName = canonicalCharacterName(ch) + '（副本）';
  n.nameAliases = window.YeyuPure.uniqueTextList([n.name, n.localizedName].concat(ch.nameAliases || []), 40);
  n.creator = '复制';
  copyStoredMediaBlobs(ch, n, true, true);
  D.characters.push(n);
  D.chats[n.id] = { sessions: [], activeSid: null };

  try {
    await saveData(['characters', 'sessions']);
  } catch (error) {
    D.characters = D.characters.filter(function (item) {
      return item.id !== n.id;
    });
    delete D.chats[n.id];
    toast('角色复制保存失败：' + error.message, 'err');
    return;
  }
  renderCharList();
  toast('角色已复制', 'ok');
}

async function selectCharacter(id) {
  if (D.currentCharId === id) {
    if (window.innerWidth <= 768) setSidebarOpen(false);
    return;
  }
  if (typeof qrStopAndAwait === 'function') await qrStopAndAwait();
  else if (typeof stopStscriptRun === 'function') stopStscriptRun();
  if (typeof presetTaskCall === 'function') await presetTaskCall('onGenerationStopped');
  var previousCharId = D.currentCharId;
  rememberCurrentChatPosition();
  releaseCardScriptWorkersExcept(id);
  invalidateBackgroundThemeRequest();
  setThemeProgress(true, '正在加载角色');
  D.currentCharId = id;
  if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('select-character');
  try {
    await saveData('meta', { urgent: true });
  } catch (error) {
    D.currentCharId = previousCharId;
    if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('select-character-revert');
    await applyCharBackground(getChar(), false);
    setThemeProgress(false);
    toast('角色切换保存失败：' + error.message, 'err');
    return;
  }
  document.querySelectorAll('#char-list .char-item[data-char-id]').forEach(function (el) {
    el.classList.toggle('active', el.dataset.charId === String(id));
  });
  if (window.innerWidth <= 768) {
    setSidebarOpen(false);
  }
  const ch = getChar();
  if (ch) await applyCharBackground(ch, true);
  if (D.currentCharId !== id) return;
  // Display regex is warmed before the first paint, so the chat opens with the transformed
  // text instead of blanking the bodies a hiding script would otherwise have leaked.
  if (typeof prepareRegexScriptDisplayTexts === 'function') {
    var entrySession = getActiveSession(id);
    await prepareRegexScriptDisplayTexts(ch, (entrySession && entrySession.msgs) || []);
    if (D.currentCharId !== id) return;
  }
  renderChat();
  updateChatUI();
  // A newly imported/copied character owns one lazily-created blank session.
  // Ask for the greeting on first entry, but never interrupt existing conversations.
  const sess = ch ? getActiveSession(ch.id) : null;
  if (typeof presetTaskCall === 'function') {
    await presetTaskCall('onCharacterChanged', (ch && ch.id) || '');
    await presetTaskCall('onSessionChanged', (sess && sess.id) || '');
    if (D.currentCharId !== id || getActiveSession(id) !== sess) return;
    await presetTaskCall(
      'onCharacterInitialized',
      { characterId: (ch && ch.id) || '', sessionId: (sess && sess.id) || '' },
      {
        current: function () {
          return D.currentCharId === id && getActiveSession(id) === sess;
        },
      }
    );
    if (D.currentCharId !== id || getActiveSession(id) !== sess) return;
    await presetTaskCall('onChatChanged', { characterId: (ch && ch.id) || '', sessionId: (sess && sess.id) || '' });
  }
  if (ch && sess && !sess.msgs.length && !sess.greetingChosen) {
    var firstSession = (getSessions(ch.id).sessions || [])[0] === sess;
    if (firstSession) await showCreatorNotesBeforeChat(ch);
    if (D.currentCharId !== id) return;
    if (getGreetings(ch).length) {
      var greet = await chooseGreeting(ch, sess.macroVars);
      if (greet !== null && D.currentCharId === id) {
        var before = copyJsonData(sess);
        sess.greetingChosen = true;
        var firstGreeting = typeof greet === 'object' ? greet.text : greet,
          index = typeof greet === 'object' ? greet.index : null;
        if (firstGreeting) {
          appendOpeningGreeting(ch, sess, firstGreeting, index);
          if (typeof markCardFrontendChatCreated === 'function') markCardFrontendChatCreated(ch, sess);
        }
        try {
          await saveData('sessions', { urgent: true });
        } catch (error) {
          Object.keys(sess).forEach(function (k) {
            delete sess[k];
          });
          Object.assign(sess, before);
          toast('开场白保存失败：' + error.message, 'err');
          return;
        }
        renderChat();
        scrollChatToBottomAfterRender();
        if (firstGreeting) queueOpeningMediaHydration(ch, Number.isInteger(index) ? index : 0);
      }
    } else {
      var blankBefore = copyJsonData(sess);
      sess.greetingChosen = true;
      try {
        await saveData('sessions', { urgent: true });
      } catch (error) {
        Object.keys(sess).forEach(function (k) {
          delete sess[k];
        });
        Object.assign(sess, blankBefore);
        toast('对话状态保存失败：' + error.message, 'err');
      }
      // A card without greetings begins its conversation here, so its script library starts now.
      if (D.currentCharId === id && typeof syncCardScriptLibrary === 'function') syncCardScriptLibrary(ch);
    }
  }
  if (typeof qrPerformAuto === 'function') await qrPerformAuto('executeOnChatChange');
}
