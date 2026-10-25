// ===== Imported cnmeme.wiki wheel scheme library =====
function wheelSchemeList() {
  if (!D) return [];
  if (!Array.isArray(D.wheelSchemes)) D.wheelSchemes = [];
  return D.wheelSchemes;
}
function wheelSchemeById(id) {
  return (
    wheelSchemeList().find(function (item) {
      return item && item.id === String(id || '');
    }) || null
  );
}
// Legacy records retain their stored picked or automatic colour. New imports carry independent
// palette colours and never need an automatic hue.
function wheelSchemeOccupiedHues(rows) {
  var hues = [];
  rows.forEach(function (item) {
    if (!item) return;
    if (typeof item.autoHue === 'number') hues.push(item.autoHue);
    var picked = pureApi().colorHue(item.color);
    if (picked !== null) hues.push(picked);
  });
  return hues;
}
// Schemes stored before automatic hues were kept get theirs once, in import order; schemes showing a
// picked colour go last because their automatic hue stays hidden. Returns whether any changed.
function ensureWheelSchemeAutoHues() {
  var rows = wheelSchemeList(),
    missing = rows
      .filter(function (item) {
        return item && !Array.isArray(item.paletteColors) && typeof item.autoHue !== 'number';
      })
      .sort(function (a, b) {
        var order = (a.color ? 1 : 0) - (b.color ? 1 : 0) || (Number(a.importedAt) || 0) - (Number(b.importedAt) || 0);
        return order || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
      });
  if (!missing.length) return false;
  var occupied = wheelSchemeOccupiedHues(rows);
  missing.forEach(function (item) {
    item.autoHue = pureApi().identityHue(item.id, occupied);
    occupied.push(item.autoHue);
  });
  return missing.length > 0;
}
function wheelSchemeColor(id) {
  var item = wheelSchemeById(id);
  if (!item) return '';
  if (Array.isArray(item.paletteColors) && item.paletteColors.length) return item.paletteColors[0];
  return item.color || (typeof item.autoHue === 'number' ? pureApi().identityColor(item.autoHue) : '');
}
function wheelSchemePaletteColors(item) {
  if (!item) return [];
  if (Array.isArray(item.paletteColors) && item.paletteColors.length) return item.paletteColors.slice();
  var legacy = wheelSchemeColor(item.id);
  return legacy ? [legacy] : [];
}
function normalizedWheelScheme(item) {
  if (!item || !item.document) throw new Error('转盘方案内容缺失');
  return YeyuWheelScheme.normalizeScheme(item.document);
}
function setWheelSchemeImportStatus(message, type, actions) {
  var box = $('wheel-scheme-import-status');
  if (!box) return;
  box.className = 'wheel-scheme-import-status ' + String(type || '');
  box.textContent = String(message || '');
  (actions || []).forEach(function (action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn text sm';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    box.appendChild(button);
  });
}
// The engine stops a broken scheme whenever an automatic wheel cannot move on — before the first
// manual turn or halfway through a run; without a dedicated wording it would read as a normal ending.
function wheelSchemeAutomaticErrorText(error) {
  if (error === 'loop') return '轮盘跳转形成了循环。';
  if (error === 'no-option') return '自动轮盘没有可用结果。';
  if (error === 'limit') return '自动轮盘连续转动超过上限仍未停下，这段自动结果已丢弃。';
  return '自动轮盘没有走到可以转动的位置。';
}
function wheelSchemeProgressLabel(progress) {
  if (!progress) return '尚未开始';
  if (progress.pendingBiography) {
    var pending = progress.biography ? '人物志待重新生成' : '人物志待生成';
    return progress.automaticError ? '方案无法继续 · ' + pending : pending;
  }
  if (progress.biography) return '人物志已生成';
  if (progress.automaticError) return Number(progress.turnCount) > 0 ? '方案无法继续 · 可生成人物志' : '方案无法继续';
  if (progress.status === 'finished' || !progress.currentWheelId) return '等待生成人物志';
  return '已进行 ' + Math.max(0, Number(progress.turnCount) || 0) + ' 转';
}
function wheelSchemeRowHtml(item) {
  var id = (item && item.id) || '',
    scheme;
  try {
    scheme = normalizedWheelScheme(item);
  } catch (error) {
    return (
      '<div class="char-item wheel-scheme-item invalid" data-wheel-scheme-id="' +
      escAttr(id) +
      '" onclick="toggleWheelSchemeTools(this)">' +
      '<details class="char-tools" onclick="event.stopPropagation()"><summary aria-label="方案操作" title="方案操作">' +
      uiIcon('more') +
      '</summary><div class="char-actions"><button type="button" class="btn text sm danger wheel-scheme-delete" onclick="event.stopPropagation();deleteWheelScheme(' +
      jsArg(id) +
      ')">删除</button></div></details>' +
      '<div class="char-info"><div class="cname">方案暂不可用</div><div class="cmeta">' +
      esc(String((error && error.message) || error)) +
      '</div></div></div>'
    );
  }
  var progress = item.progress && typeof item.progress === 'object' ? item.progress : null,
    actions = progress
      ? '<button type="button" class="btn text sm wheel-scheme-continue" onclick="event.stopPropagation();continueWheelSchemeGame(' +
        jsArg(id) +
        ')">' +
        (progress.biography ? '查看人物志' : '继续对局') +
        '</button><button type="button" class="btn text sm wheel-scheme-restart" onclick="event.stopPropagation();restartWheelSchemeGame(' +
        jsArg(id) +
        ')" title="开新对局会覆盖当前进度">开新对局</button>'
      : '<button type="button" class="btn text sm wheel-scheme-start" onclick="event.stopPropagation();startWheelSchemeGame(' +
        jsArg(id) +
        ')">开始对局</button>';
  return (
    '<div class="char-item wheel-scheme-item" data-wheel-scheme-id="' +
    escAttr(id) +
    '" onclick="toggleWheelSchemeTools(this)">' +
    '<details class="char-tools" onclick="event.stopPropagation()"><summary aria-label="方案操作" title="方案操作">' +
    uiIcon('more') +
    '</summary><div class="char-actions">' +
    actions +
    '<button type="button" class="btn text sm danger wheel-scheme-delete" onclick="event.stopPropagation();deleteWheelScheme(' +
    jsArg(id) +
    ')">删除</button>' +
    '</div></details>' +
    '<div class="char-info"><div class="char-title"><span class="wheel-scheme-swatch palette-scope" aria-hidden="true"></span><span class="cname">' +
    esc(scheme.title) +
    '</span></div><div class="cmeta">' +
    scheme.wheels.length +
    ' 个轮盘 · ' +
    scheme.stats.length +
    ' 个变量 · ' +
    esc(wheelSchemeProgressLabel(progress)) +
    '</div></div></div>'
  );
}
function toggleWheelSchemeTools(row) {
  var tools = row && row.querySelector('details.char-tools');
  if (tools) tools.open = !tools.open;
}
function renderWheelSchemeLibrary() {
  var box = $('wheel-scheme-list');
  if (!box) return;
  var rows = wheelSchemeList();
  box.innerHTML = rows.length
    ? rows
        .map(function (item) {
          return wheelSchemeRowHtml(item);
        })
        .join('')
    : '<div class="ui-empty"><strong>还没有转盘方案</strong><p>导入本机的 .wheel.json 方案。每一转都在手机上立即结算，走到终点后生成人物志。</p></div>';
  box.querySelectorAll('.wheel-scheme-item').forEach(function (row) {
    var marker = row.querySelector('.wheel-scheme-swatch'),
      item = wheelSchemeById(row.dataset.wheelSchemeId);
    if (marker && item) applyPaletteScopeSeeds(marker, wheelSchemePaletteColors(item));
  });
}
var _wheelSchemeImportState = null;
function wheelSchemePaletteInput(scheme) {
  function preview(value, limit) {
    return String(value || '')
      .trim()
      .slice(0, limit);
  }
  function representative(rows, count) {
    if (rows.length <= count) return rows;
    return Array.from({ length: count }, function (_, index) {
      return rows[Math.round((index * (rows.length - 1)) / (count - 1))];
    });
  }
  return JSON.stringify({
    title: preview(scheme.title, 180),
    description: preview(scheme.description, 500),
    wheels: representative(scheme.wheels, 6).map(function (wheel) {
      return {
        name: preview(wheel.name, 160),
        description: preview(wheel.description, 240),
        options: representative(wheel.options, 4).map(function (option) {
          return preview(option.label, 160);
        }),
      };
    }),
  });
}
function parseWheelSchemePalette(content) {
  var data;
  try {
    data = JSON.parse(String(content || '').trim());
  } catch (_) {
    throw new Error('模型没有返回可用的配色 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.colors))
    throw new Error('模型配色格式不正确');
  var colors = data.colors;
  if (
    colors.length < 3 ||
    colors.length > 4 ||
    colors.some(function (color) {
      return typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color);
    })
  )
    throw new Error('模型配色需要 3 到 4 个六位色值');
  colors = colors.map(function (color) {
    return color.toUpperCase();
  });
  var hues = [];
  colors.forEach(function (color) {
    var rgb = [1, 3, 5].map(function (index) {
        return parseInt(color.slice(index, index + 2), 16);
      }),
      lch = pureApi().rgbToOklch(rgb[0], rgb[1], rgb[2]);
    if (lch.L < 0.18 || lch.L > 0.88 || lch.C < 0.055 || lch.C > 0.33)
      throw new Error('模型配色包含过暗、过亮或过于鲜艳的颜色');
    hues.push(lch.H);
  });
  if (
    new Set(colors).size !== colors.length ||
    !hues.some(function (hue) {
      return hues.some(function (other) {
        var distance = Math.abs(hue - other) % 360;
        return Math.min(distance, 360 - distance) >= 25;
      });
    })
  )
    throw new Error('模型配色缺少可区分的搭配色');
  return colors;
}
function randomWheelSchemePalette() {
  var first = Math.random() * 360;
  return [0, 112, 228].map(function (offset, index) {
    return pureApi()
      .oklchToHex(index === 1 ? 0.68 : 0.62, 0.16, (first + offset) % 360)
      .toUpperCase();
  });
}
function cancelWheelSchemeImport() {
  var state = _wheelSchemeImportState;
  if (!state || state.saving) return false;
  _wheelSchemeImportState = null;
  if (state.controller) state.controller.abort();
  setWheelSchemeImportStatus('已取消导入', '');
  return true;
}
function wheelSchemeImportFailure(state, error) {
  if (_wheelSchemeImportState !== state) return;
  setWheelSchemeImportStatus('配色失败：' + String((error && error.message) || error), 'err', [
    {
      label: '重试',
      run: function () {
        retryWheelSchemeImport();
      },
    },
    {
      label: '随机配色',
      run: function () {
        useRandomWheelSchemePalette();
      },
    },
    {
      label: '取消导入',
      run: function () {
        cancelWheelSchemeImport();
      },
    },
  ]);
}
async function saveWheelSchemeImport(state) {
  if (_wheelSchemeImportState !== state || state.saving || !state.paletteColors) return false;
  state.saving = true;
  setWheelSchemeImportStatus('配色已确定，正在保存“' + state.scheme.title + '”…', '');
  var record = {
      id: 'wheel_scheme_' + uid(),
      importedAt: Date.now(),
      sourceFileName: state.fileName,
      document: state.document,
      progress: null,
      paletteColors: state.paletteColors.slice(),
    },
    rows = wheelSchemeList();
  rows.push(record);
  try {
    await saveData('wheels', { urgent: true });
  } catch (error) {
    var index = rows.indexOf(record);
    if (index >= 0) rows.splice(index, 1);
    state.saving = false;
    setWheelSchemeImportStatus('保存失败，原方案库保持不变：' + String((error && error.message) || error), 'err', [
      {
        label: '重试保存',
        run: function () {
          saveWheelSchemeImport(state);
        },
      },
      {
        label: '取消导入',
        run: function () {
          cancelWheelSchemeImport();
        },
      },
    ]);
    return false;
  }
  _wheelSchemeImportState = null;
  renderWheelSchemeLibrary();
  setWheelSchemeImportStatus('已导入“' + state.scheme.title + '”', 'ok');
  toast('转盘方案已导入', 'ok');
  return record;
}
async function retryWheelSchemeImport() {
  var state = _wheelSchemeImportState;
  if (!state || state.controller || state.saving) return false;
  var controller = new AbortController();
  state.controller = controller;
  controller.signal.addEventListener(
    'abort',
    function () {
      if (_wheelSchemeImportState !== state || state.controller !== controller) return;
      state.controller = null;
      wheelSchemeImportFailure(state, new Error('配色请求已停止'));
    },
    { once: true }
  );
  setWheelSchemeImportStatus('正在为“' + state.scheme.title + '”分析配色…', '', [
    {
      label: '取消导入',
      run: function () {
        cancelWheelSchemeImport();
      },
    },
  ]);
  try {
    var result = await callDeepSeek(
      [
        { role: 'system', content: assistantPromptText('wheelScheme', 'palette') },
        { role: 'user', content: wheelSchemePaletteInput(state.scheme) },
      ],
      null,
      Object.assign(modelRouteRequestOptions('wheelScheme'), {
        route: 'wheelScheme',
        transient: true,
        nonStream: true,
        controller: controller,
        maxTokens: 2048,
        ignoreUserMaxTokens: true,
      })
    );
    if (_wheelSchemeImportState !== state || controller.signal.aborted) return false;
    state.paletteColors = parseWheelSchemePalette(result && result.content);
    state.controller = null;
    return await saveWheelSchemeImport(state);
  } catch (error) {
    if (_wheelSchemeImportState !== state || controller.signal.aborted) return false;
    state.controller = null;
    wheelSchemeImportFailure(state, error);
    return false;
  }
}
function useRandomWheelSchemePalette() {
  var state = _wheelSchemeImportState;
  if (!state || state.controller || state.saving) return false;
  state.paletteColors = randomWheelSchemePalette();
  return saveWheelSchemeImport(state);
}
async function importWheelSchemeFile(event) {
  var input = (event && event.target) || $('wheel-scheme-file'),
    file = input && input.files && input.files[0];
  if (!file || (_wheelSchemeImportState && _wheelSchemeImportState.saving)) return false;
  cancelWheelSchemeImport();
  if (input) input.value = '';
  var state = {
    fileName: String(file.name || ''),
    document: null,
    scheme: null,
    controller: null,
    saving: false,
    paletteColors: null,
  };
  _wheelSchemeImportState = state;
  setWheelSchemeImportStatus('正在读取 ' + file.name + '…', '', [
    {
      label: '取消导入',
      run: function () {
        cancelWheelSchemeImport();
      },
    },
  ]);
  try {
    if (!/\.wheel\.json$/i.test(String(file.name || ''))) throw new Error('请选择以 .wheel.json 结尾的方案文件');
    var raw = String(await file.text()).replace(/^﻿/, '');
    if (_wheelSchemeImportState !== state) return false;
    var document = JSON.parse(raw),
      scheme = YeyuWheelScheme.normalizeScheme(document);
    state.document = document;
    state.scheme = scheme;
    return retryWheelSchemeImport();
  } catch (error) {
    if (_wheelSchemeImportState !== state) return false;
    _wheelSchemeImportState = null;
    setWheelSchemeImportStatus('导入失败：' + String((error && error.message) || error), 'err');
    toast('转盘方案导入失败', 'err');
    return false;
  }
}
async function deleteWheelScheme(id) {
  var item = wheelSchemeById(id);
  if (!item) return false;
  var title = '这个转盘方案';
  try {
    title = '“' + normalizedWheelScheme(item).title + '”';
  } catch (_) {}
  if (!(await appConfirm('删除' + title + '？它的当前对局与人物志也会一并删除。', '删除转盘方案', '删除')))
    return false;
  var rows = wheelSchemeList(),
    index = rows.indexOf(item);
  if (index < 0) return false;
  if (
    typeof _wheelSchemeRequestItem !== 'undefined' &&
    _wheelSchemeRequestItem === item &&
    _wheelSchemeRequestController
  )
    _wheelSchemeRequestController.abort();
  rows.splice(index, 1);
  try {
    await saveData('wheels', { urgent: true });
  } catch (error) {
    rows.splice(index, 0, item);
    renderWheelSchemeLibrary();
    toast('删除失败，方案和进度均已保留', 'err');
    return false;
  }
  if (typeof activeWheelSchemeId === 'function' && activeWheelSchemeId() === item.id) closeWheelSchemeGame();
  renderWheelSchemeLibrary();
  toast('转盘方案已删除', 'ok');
  return true;
}

function openWheelSchemeManager() {
  renderAssistantPromptSettings('wheel-assistant-prompts', 'wheel-manager', D.settings);
  $('wheel-scheme-max-tokens').value = taskMaxTokens('wheelSchemeMaxTokens');
  openModal('wheel-manager-modal');
  scheduleAutoGrowTextareas($('wheel-manager-modal'));
}
async function saveWheelSchemeManager() {
  if (blockDuringGeneration('保存转盘设置')) return false;
  var raw = String($('wheel-scheme-max-tokens').value || '').trim(),
    limit = raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(limit) || limit < 0 || limit > TASK_MAX_TOKENS_MAX) {
    toast('输出上限请填写 0—' + TASK_MAX_TOKENS_MAX + ' 之间的整数，0 或留空为不限', 'err');
    return false;
  }
  var before = { limit: D.settings.wheelSchemeMaxTokens, overrides: D.settings.assistantPromptOverrides },
    next = { assistantPromptOverrides: D.settings.assistantPromptOverrides };
  // Captures a copy: only the wheel-manager prompt group changes, every other override group is carried over.
  captureAssistantPromptSettings(next, 'wheel-manager');
  D.settings.wheelSchemeMaxTokens = limit;
  D.settings.assistantPromptOverrides = next.assistantPromptOverrides;
  try {
    await saveData('meta', { urgent: true });
  } catch (error) {
    D.settings.wheelSchemeMaxTokens = before.limit;
    D.settings.assistantPromptOverrides = before.overrides;
    toast('转盘设置保存失败，请重试', 'err');
    return false;
  }
  closeModal('wheel-manager-modal');
  toast('转盘设置已保存', 'ok');
  return true;
}
