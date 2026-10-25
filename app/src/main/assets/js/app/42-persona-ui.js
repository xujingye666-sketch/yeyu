// ===== Persona =====
function personaBoundCharIds(persona) {
  var seen = new Set();
  return (Array.isArray(persona && persona.boundCharIds) ? persona.boundCharIds : [])
    .map(function (id) {
      return String(id || '').trim();
    })
    .filter(function (id) {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}
function setPersonaBoundCharIds(persona, ids, journal) {
  if (!persona) return persona;
  var next = personaBoundCharIds({ boundCharIds: ids });
  if (!journal) {
    persona.boundCharIds = next;
    return persona;
  }
  if (!Array.isArray(persona.boundCharIds)) {
    journal.capture(persona, ['boundCharIds'], true);
    persona.boundCharIds = [];
  }
  var rows = persona.boundCharIds;
  for (var index = rows.length - 1; index >= 0; index--)
    if (!next.includes(rows[index])) journal.splice(rows, index, 1);
  next.forEach(function (id, index) {
    if (rows[index] === id) return;
    var previous = rows.indexOf(id);
    if (previous >= 0) journal.splice(rows, previous, 1);
    journal.splice(rows, index, 0, [id]);
  });
  return persona;
}
function applyPersonaScopeState(personaId, nextMode, selectedIds, journal) {
  var persona = (D.personas || []).find(function (item) {
    return item && item.id === personaId;
  });
  if (!persona) return null;
  var validIds = new Set(
      (D.characters || [])
        .filter(Boolean)
        .map(function (char) {
          return String((char && char.id) || '');
        })
        .filter(Boolean)
    ),
    ids = personaBoundCharIds({ boundCharIds: selectedIds }).filter(function (charId) {
      return validIds.has(charId);
    }),
    reassigned = [];
  if (nextMode === 'selected' && ids.length) {
    D.personas.forEach(function (item) {
      if (!item || item.id === personaId) return;
      var before = personaBoundCharIds(item),
        after = before.filter(function (charId) {
          return !ids.includes(charId);
        });
      if (after.length !== before.length) {
        before
          .filter(function (charId) {
            return ids.includes(charId);
          })
          .forEach(function (charId) {
            reassigned.push({ charId: charId, from: item.name || '原人格' });
          });
        setPersonaBoundCharIds(item, after, journal);
      }
    });
    setPersonaBoundCharIds(persona, ids, journal);
    nextMode = 'selected';
  } else {
    if (nextMode === 'global') D.activePersonaId = personaId;
    else if (nextMode === 'global-off') {
      if (D.activePersonaId === personaId) D.activePersonaId = null;
    } else {
      setPersonaBoundCharIds(persona, [], journal);
      nextMode = 'none';
      if (D.activePersonaId === personaId) D.activePersonaId = null;
    }
  }
  return { mode: nextMode, selectedIds: ids, reassigned: reassigned, persona: persona };
}
function personaScopeResultMessage(result) {
  if (!result) return '';
  var persona = result.persona || {},
    message =
      result.mode === 'global'
        ? '已设为全局默认人格'
        : result.mode === 'selected'
          ? '已绑定 ' + result.selectedIds.length + ' 个角色'
          : '已设为不绑定';
  if (result.reassigned.length) {
    var first = result.reassigned[0],
      charName = getCharName(first.charId);
    message += '；角色“' + charName + '”的人格已从“' + first.from + '”改为“' + (persona.name || '当前人格') + '”';
    if (result.reassigned.length > 1) message += '，另有 ' + (result.reassigned.length - 1) + ' 个角色已改绑';
  }
  return message;
}
async function persistPersonaScope(personaId, nextMode, selectedIds, successMessage) {
  var journal = createMutationJournal();
  journal.capture(D, ['activePersonaId'], true);
  var result = applyPersonaScopeState(personaId, nextMode, selectedIds, journal);
  if (!result) return null;
  journal.seal();
  try {
    await saveData(['meta', 'personas']);
  } catch (error) {
    journal.rollback();
    toast('作用范围保存失败，原设置已恢复：' + error.message, 'err');
    return null;
  }
  renderPersonaList();
  renderChat();
  if (typeof updateChatUI === 'function') updateChatUI();
  toast(successMessage || personaScopeResultMessage(result), 'ok');
  return result;
}
function normalizePersonaBindings(data) {
  if (!data || typeof data !== 'object') return false;
  var personas = Array.isArray(data.personas) ? data.personas : [],
    validCharacters = new Set(
      (Array.isArray(data.characters) ? data.characters : [])
        .map(function (char) {
          return String((char && char.id) || '').trim();
        })
        .filter(Boolean)
    ),
    activeId = String(data.activePersonaId || ''),
    activeExists =
      !activeId ||
      personas.some(function (persona) {
        return persona && String(persona.id || '') === activeId;
      }),
    claimed = new Set(),
    changed = false;
  if (!activeExists) {
    data.activePersonaId = null;
    activeId = '';
    changed = true;
  }
  personas.forEach(function (persona) {
    if (!persona || !Array.isArray(persona.boundCharIds)) return;
    var original = persona.boundCharIds,
      next = personaBoundCharIds(persona).filter(function (charId) {
        if (!validCharacters.has(charId) || claimed.has(charId)) return false;
        claimed.add(charId);
        return true;
      });
    if (
      original.length !== next.length ||
      original.some(function (value, index) {
        return value !== next[index];
      })
    ) {
      persona.boundCharIds = next;
      changed = true;
    }
  });
  return changed;
}
function personaScopeText(persona) {
  var bound = personaBoundCharIds(persona);
  if (persona && persona.id === D.activePersonaId)
    return '全局默认' + (bound.length ? ' · 已绑定 ' + bound.length + ' 个角色' : '');
  if (bound.length === 1) return '绑定：' + getCharName(bound[0]);
  if (bound.length > 1) return '已绑定 ' + bound.length + ' 个角色';
  return '不绑定';
}
function renderPersonaList() {
  const ct = $('persona-list');
  if (!D.personas.length) {
    ct.innerHTML =
      '<div class="ui-empty"><strong>还没有人格</strong><p>人格是你在对话里扮演的身份。新建后，可设为全局默认或绑定到指定角色。</p></div>';
    return;
  }
  let h = '';
  D.personas.forEach((p) => {
    const act = p.id === D.activePersonaId ? ' active' : '';
    const personaSrc =
      typeof displayImageSrc === 'function' ? displayImageSrc(p, 'avatar_image') : safeImage(p.avatar_image, true);
    const av = personaSrc ? '<img src="' + escAttr(personaSrc) + '" alt="">' : '';
    const desc = (p.desc || '').slice(0, 50);
    h += `<div class="char-item persona-item${act}" onclick="selectPersona(${jsArg(p.id)})">
<details class="char-tools" onclick="event.stopPropagation()"><summary aria-label="人格操作" title="人格操作">${uiIcon('more')}</summary><div class="char-actions">
<button class="btn text sm" onclick="event.stopPropagation();bindPersonaScope(${jsArg(p.id)})">使用范围</button>
<button class="btn text sm" onclick="event.stopPropagation();editPersona(${jsArg(p.id)})" title="编辑">编辑</button>
<button class="btn text sm danger" onclick="event.stopPropagation();deletePersona(${jsArg(p.id)})">删除</button></div></details>
<div class="char-avatar p-avatar">${av}</div>
<div class="char-info persona-item-info"><div class="char-title"><span class="cname">${esc(p.name)}</span></div><div class="cmeta"><span class="persona-scope-label">${esc(personaScopeText(p))}</span>${desc ? ' · ' + esc(desc) : ''}</div></div></div>`;
  });
  ct.innerHTML = h;
}
async function selectPersona(id) {
  if (blockDuringGeneration('切换人格')) return;
  var persona = D.personas.find(function (item) {
    return item && item.id === id;
  });
  if (!persona) return;
  var nextMode = id === D.activePersonaId ? 'global-off' : 'global';
  await persistPersonaScope(id, nextMode, [], nextMode === 'global' ? '已设为全局默认人格' : '已取消全局默认人格');
}
async function bindPersonaScope(personaId) {
  if (blockDuringGeneration('修改人格范围')) return;
  var persona = D.personas.find(function (item) {
    return item && item.id === personaId;
  });
  if (!persona) return;
  var chars = (D.characters || []).filter(Boolean),
    bound = personaBoundCharIds(persona),
    mode = persona.id === D.activePersonaId ? 'global' : bound.length ? 'selected' : 'none',
    charOptions = chars.length
      ? characterBindingOptions(chars, bound)
      : '<div class="hint">还没有可绑定的角色。可以先保存为“不绑定”，创建角色后再回来设置。</div>';
  appPromptMode = 'confirm';
  $('app-prompt-title').textContent = '设置人格作用范围';
  $('app-prompt-message').classList.add('app-prompt-rich');
  $('app-prompt-message').innerHTML =
    '<div class="wb-bind-heading">人格：<b>' +
    esc(persona.name || '未命名人格') +
    '</b></div><div class="import-mode-options wb-bind-modes"><label class="import-mode-option"><input type="radio" name="persona-bind-mode" value="none"' +
    (mode === 'none' ? ' checked' : '') +
    '><span><strong>不绑定</strong><small>保留这个人格，但不会自动用于任何角色。</small></span></label><label class="import-mode-option"><input type="radio" name="persona-bind-mode" value="global"' +
    (mode === 'global' ? ' checked' : '') +
    '><span><strong>全局默认</strong><small>没有单独绑定人格的角色都会使用它。</small></span></label><label class="import-mode-option"><input type="radio" name="persona-bind-mode" value="selected"' +
    (mode === 'selected' ? ' checked' : '') +
    '><span><strong>绑定指定角色</strong><small>打开下面勾选的角色时自动使用这个人格。</small></span></label></div><div id="persona-bind-character-list" class="wb-bind-character-list">' +
    charOptions +
    '</div><div class="hint wb-bind-advice">每个角色只能绑定一个人格；如果已经绑定过，保存后会改用当前人格。</div>';
  $('app-prompt-field').style.display = 'none';
  $('app-prompt-ok').textContent = '保存';
  openModal('app-prompt-modal');
  var sync = function () {
    var selected = document.querySelector('input[name="persona-bind-mode"]:checked'),
      list = $('persona-bind-character-list'),
      enabled = selected && selected.value === 'selected';
    if (list) list.classList.toggle('disabled', !enabled);
    if (list)
      list.querySelectorAll('input').forEach(function (input) {
        input.disabled = !enabled;
      });
  };
  document.querySelectorAll('input[name="persona-bind-mode"]').forEach(function (input) {
    input.addEventListener('change', sync);
  });
  sync();
  var ok = await new Promise(function (resolve) {
    appPromptResolver = resolve;
  });
  if (!ok) return;
  var selectedMode = document.querySelector('input[name="persona-bind-mode"]:checked'),
    nextMode = selectedMode ? selectedMode.value : 'none',
    selectedIds =
      nextMode === 'selected'
        ? Array.from(document.querySelectorAll('#persona-bind-character-list input:checked')).map(function (input) {
            return input.value;
          })
        : [];
  if (nextMode === 'selected' && !selectedIds.length) {
    toast('请至少选择一个角色，或改为“不绑定”', 'info');
    return bindPersonaScope(personaId);
  }
  await persistPersonaScope(personaId, nextMode, selectedIds);
}
async function deletePersona(id) {
  if (blockDuringGeneration('删除人格')) return;
  var item = D.personas.find(function (p) {
    return p.id === id;
  });
  if (!item) return;
  if (
    !(await appConfirm(
      '删除人格「' + item.name + '」？已有对话不会删除；如果它是当前人格，将同时取消选择。',
      '删除人格',
      '删除'
    ))
  )
    return;
  var currentIndex = D.personas.findIndex(function (persona) {
    return persona && persona.id === id;
  });
  if (currentIndex < 0) return;
  var journal = createMutationJournal();
  journal.splice(D.personas, currentIndex, 1);
  journal.capture(D, ['activePersonaId'], true);
  if (D.activePersonaId === id) D.activePersonaId = null;
  journal.seal();
  try {
    await saveData(['meta', 'personas']);
  } catch (error) {
    journal.rollback();
    toast('人格删除保存失败：' + error.message, 'err');
    return;
  }
  renderPersonaList();
  renderChat();
}
var _personaEditorAvatar = null;
function resetPersonaModal() {
  _personaEditorAvatar = null;
  $('persona-modal-title').textContent = '新建人格';
  $('persona-edit-id').value = '';
  $('p-name').value = '';
  $('p-desc').value = '';
  $('p-emoji').value = '';
  $('p-avatar-data').value = '';
  const box = $('persona-avatar-preview');
  if (box) {
    box.querySelector('img')?.remove();
  }
  if ($('p-avatar-text')) $('p-avatar-text').style.display = '';
}
function setPersonaAvatarPreview(dataUrl) {
  const box = $('persona-avatar-preview');
  if (!box) return;
  box.querySelector('img')?.remove();
  var previewSrc = safeImage(dataUrl, true);
  if (previewSrc) {
    const img = document.createElement('img');
    img.src = previewSrc;
    img.alt = '人格头像预览';
    box.appendChild(img);
    if ($('p-avatar-text')) $('p-avatar-text').style.display = 'none';
  } else if ($('p-avatar-text')) $('p-avatar-text').style.display = '';
}
let personaCrop = { img: null, scale: 1, minScale: 1, x: 0, y: 0, drag: false, lastX: 0, lastY: 0, target: 'persona' };
function drawPersonaCrop() {
  const c = $('persona-crop-canvas'),
    img = personaCrop.img;
  if (!c || !img) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, c.width, c.height);
  const w = img.naturalWidth * personaCrop.scale,
    h = img.naturalHeight * personaCrop.scale;
  const minX = c.width - w,
    minY = c.height - h;
  personaCrop.x = Math.min(0, Math.max(minX, personaCrop.x));
  personaCrop.y = Math.min(0, Math.max(minY, personaCrop.y));
  ctx.drawImage(img, personaCrop.x, personaCrop.y, w, h);
}
function beginPersonaCrop(dataUrl, target) {
  const img = new Image();
  img.onload = function () {
    personaCrop.target = target === 'character' ? 'character' : 'persona';
    if ($('avatar-crop-title'))
      $('avatar-crop-title').textContent = personaCrop.target === 'character' ? '裁剪角色头像' : '裁剪人格头像';
    const c = $('persona-crop-canvas');
    personaCrop.img = img;
    personaCrop.minScale = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
    personaCrop.scale = personaCrop.minScale;
    personaCrop.x = (c.width - img.naturalWidth * personaCrop.scale) / 2;
    personaCrop.y = (c.height - img.naturalHeight * personaCrop.scale) / 2;
    const slider = $('persona-crop-scale');
    slider.value = 1;
    drawPersonaCrop();
    openModal('persona-crop-modal');
  };
  img.onerror = function () {
    toast('图片读取失败', 'err');
  };
  img.src = dataUrl;
}
function updatePersonaCropScale(v) {
  const c = $('persona-crop-canvas'),
    img = personaCrop.img;
  if (!c || !img) return;
  const cx = (c.width / 2 - personaCrop.x) / personaCrop.scale,
    cy = (c.height / 2 - personaCrop.y) / personaCrop.scale;
  personaCrop.scale = personaCrop.minScale * Number(v);
  personaCrop.x = c.width / 2 - cx * personaCrop.scale;
  personaCrop.y = c.height / 2 - cy * personaCrop.scale;
  drawPersonaCrop();
}
function personaCropPoint(e) {
  const t = e.touches && e.touches[0];
  return { x: t ? t.clientX : e.clientX, y: t ? t.clientY : e.clientY };
}
function startPersonaCropDrag(e) {
  const p = personaCropPoint(e);
  personaCrop.drag = true;
  personaCrop.lastX = p.x;
  personaCrop.lastY = p.y;
  e.preventDefault();
}
function movePersonaCropDrag(e) {
  if (!personaCrop.drag) return;
  const p = personaCropPoint(e),
    c = $('persona-crop-canvas'),
    r = c.getBoundingClientRect(),
    k = c.width / r.width;
  personaCrop.x += (p.x - personaCrop.lastX) * k;
  personaCrop.y += (p.y - personaCrop.lastY) * k;
  personaCrop.lastX = p.x;
  personaCrop.lastY = p.y;
  drawPersonaCrop();
  e.preventDefault();
}
function endPersonaCropDrag() {
  personaCrop.drag = false;
}
function confirmPersonaCrop() {
  const c = $('persona-crop-canvas');
  if (!c || !personaCrop.img) return;
  const out = c.toDataURL('image/jpeg', 0.9);
  if (personaCrop.target === 'character') {
    $('c-avatar-data').value = out;
    _characterAvatarClearRequested = false;
    setCharacterAvatarPreview(out);
  } else {
    $('p-avatar-data').value = out;
    setPersonaAvatarPreview(out);
  }
  cancelPersonaCrop();
}
function cancelPersonaCrop() {
  personaCrop.drag = false;
  personaCrop.img = null;
  personaCrop.target = 'persona';
  closeModal('persona-crop-modal');
}
function handleAvatarUpload(e, target) {
  const f = e.target.files[0];
  if (!f) return;
  if (!/^image\/(?:png|jpe?g|webp)$/i.test(f.type)) {
    toast('请选择 PNG、JPEG 或 WebP 图片', 'err');
    e.target.value = '';
    return;
  }
  const r = new FileReader();
  r.onerror = function () {
    toast('头像读取失败', 'err');
  };
  r.onload = function (ev) {
    beginPersonaCrop(ev.target.result, target);
  };
  r.readAsDataURL(f);
  e.target.value = '';
}
async function editPersona(id) {
  const p = D.personas.find((x) => x.id === id);
  if (!p) return;
  var avatar =
    typeof loadStoredMediaDataUrl === 'function'
      ? await loadStoredMediaDataUrl(p, 'avatar_image')
      : p.avatar_image || '';
  openModal('persona-modal');
  $('persona-modal-title').textContent = '编辑人格';
  $('persona-edit-id').value = id;
  $('p-name').value = p.name || '';
  $('p-desc').value = p.desc || '';
  $('p-emoji').value = '';
  $('p-avatar-data').value = avatar || '';
  _personaEditorAvatar = { id: id, value: $('p-avatar-data').value };
  setPersonaAvatarPreview(avatar || '');
  rememberUnsavedEditorBaseline('persona-modal');
}
function savePersona() {
  return runModalSave('persona-modal', commitPersonaEditor);
}
async function commitPersonaEditor() {
  if (blockDuringGeneration('保存人格')) return;
  const name = $('p-name').value.trim();
  if (!name) {
    toast('请输入名称', 'err');
    return;
  }
  const editId = $('persona-edit-id').value;
  let p = {
    name,
    emoji: $('p-emoji').value.trim(),
    avatar_image: safeImage($('p-avatar-data').value, false),
    desc: $('p-desc').value.trim(),
    boundCharIds: [],
  };
  var journal = createMutationJournal(),
    oldPersona = null;
  journal.capture(D, ['activePersonaId'], true);
  if (editId) {
    const idx = D.personas.findIndex((x) => x.id === editId);
    if (idx >= 0) {
      oldPersona = D.personas[idx];
      p.id = editId;
      p.boundCharIds = Array.isArray(oldPersona.boundCharIds) ? oldPersona.boundCharIds : [];
      var updated = Object.assign({}, oldPersona, p),
        unchanged =
          (_personaEditorAvatar &&
            _personaEditorAvatar.id === editId &&
            _personaEditorAvatar.value === $('p-avatar-data').value) ||
          storedMediaUnchanged(oldPersona, 'avatar_image', p.avatar_image);
      ['_media', '_mediaHash', '_mediaBlobs'].forEach(function (key) {
        if (!oldPersona[key]) return;
        updated[key] = Object.assign({}, oldPersona[key]);
        if (!unchanged) delete updated[key].avatar_image;
      });
      delete updated._mediaDisplay;
      if (unchanged) updated.avatar_image = oldPersona.avatar_image || '';
      journal.replaceRecord(oldPersona, updated);
      p = oldPersona;
    }
  } else {
    p.id = 'p_' + uid();
    journal.splice(D.personas, D.personas.length, 0, [p]);
  }
  // Only a freshly created persona may take over the empty global default;
  // editing must never overwrite the scope the user chose.
  if (!editId && !D.activePersonaId) D.activePersonaId = p.id;
  journal.seal();
  try {
    await saveData(['meta', 'personas']);
  } catch (error) {
    journal.rollback();
    toast('人格保存失败，原数据已恢复：' + error.message, 'err');
    return;
  }
  renderPersonaList();
  renderChat();
  if (typeof updateChatUI === 'function') updateChatUI();
  $('persona-edit-id').value = p.id;
  _personaEditorAvatar = { id: p.id, value: $('p-avatar-data').value };
  rememberUnsavedEditorBaseline('persona-modal');
  toast('人格已保存，可继续编辑', 'ok');
}
function getActivePersona(charId) {
  var resolvedCharId = charId === undefined ? String(D.currentCharId || '') : String(charId || ''),
    bound = resolvedCharId
      ? (D.personas || []).find(function (persona) {
          return personaBoundCharIds(persona).includes(resolvedCharId);
        })
      : null;
  return (
    bound ||
    (D.personas || []).find(function (persona) {
      return persona && persona.id === D.activePersonaId;
    }) ||
    null
  );
}
function syncTavernUserAvatarImage(charId) {
  var image = $('user_avatar_image'),
    persona = getActivePersona(charId),
    source =
      persona &&
      (typeof displayImageSrc === 'function'
        ? displayImageSrc(persona, 'avatar_image')
        : safeImage(persona.avatar_image, true));
  if (!image) return;
  if (source) image.src = source;
  else image.removeAttribute('src');
}
function getUserAvatarHtml() {
  const p = getActivePersona(),
    src =
      p &&
      (typeof displayImageSrc === 'function' ? displayImageSrc(p, 'avatar_image') : safeImage(p.avatar_image, true));
  if (src) return '<img src="' + escAttr(src) + '" alt="">';
  return '';
}
