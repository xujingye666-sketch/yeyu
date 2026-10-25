// Character expression host. Media ownership remains with the character repository.
var _expressionContext = null,
  _expressionEpoch = 0,
  _expressionRequest = null,
  _expressionPaint = 0,
  _expressionManagerChar = null,
  _expressionChanges = new WeakMap();
function expressionAvailable(char) {
  return !(typeof isRisuCharacter === 'function' && isRisuCharacter(char));
}
// Macros read the same single-character state and asset labels as the expression host.
function expressionMacroValue(name, target, char, session) {
  if (!char || !expressionAvailable(char)) return '';
  if (target && target !== char.name && target !== canonicalCharacterName(char) && target !== characterPromptName(char))
    return '';
  var config = YeyuExpressionAssets.config(char),
    context = { char: char, session: session || getActiveSession(char.id), config: config },
    kind = String(name).toLowerCase();
  if (kind === 'availableexpressions') return expressionLabels(context).join(', ');
  if (kind === 'defaultexpression') return config.fallback === '#none' ? '' : String(config.fallback || '');
  var label = context.session && context.session.expressions && context.session.expressions.label;
  return label === '#reset' ? '' : String(label || '');
}
function expressionCurrent() {
  var char = getChar();
  if (!char) throw new Error('请先选择角色，再使用立绘表情');
  if (!expressionAvailable(char)) throw new Error('Risu 卡片的立绘由 Risu 运行体系管理');
  var session = getActiveSession(char.id);
  if (!session) throw new Error('请先打开对话，再使用立绘表情');
  return { char: char, session: session, config: YeyuExpressionAssets.config(char) };
}
function expressionContextMatches(context) {
  return getChar() === context.char && getActiveSession(context.char.id) === context.session;
}
function cancelExpressionClassification() {
  _expressionEpoch++;
  if (_expressionRequest) _expressionRequest.abort();
  _expressionRequest = null;
  var stop = $('expression-stop');
  if (stop) stop.hidden = true;
  if ($('expression-status')) $('expression-status').hidden = true;
}
function expressionRows(context, group) {
  return YeyuExpressionAssets.bindings(context.char).filter(function (row) {
    return row.group === String(group == null ? context.config.group || '' : group);
  });
}
function expressionLabels(context, filter) {
  return Array.from(
    new Set(
      expressionRows(context)
        .filter(function (row) {
          return filter === false || !row.missing;
        })
        .map(function (row) {
          return row.label;
        })
    )
  );
}
function expressionChange(context, change, domains) {
  // Serialize snapshots so a failed save cannot restore another uncommitted change.
  var previous = _expressionChanges.get(context.char) || Promise.resolve(),
    pending = previous
      .catch(function () {})
      .then(function () {
        if (!expressionContextMatches(context)) throw new DOMException('对话已切换，立绘未改变', 'AbortError');
        return commitExpressionChange(context, change, domains);
      });
  _expressionChanges.set(context.char, pending);
  return pending;
}
async function commitExpressionChange(context, change, domains) {
  context.config = YeyuExpressionAssets.config(context.char, true);
  var config = structuredClone(context.config),
    session = context.session.expressions && structuredClone(context.session.expressions),
    media = context.char.media_assets,
    mediaItems = media && media.slice();
  try {
    var result = await change();
    await saveData(domains || 'characters');
    if (expressionContextMatches(context)) syncExpressions();
    return result;
  } catch (error) {
    Object.keys(context.config).forEach(function (key) {
      delete context.config[key];
    });
    Object.assign(context.config, config);
    if (session) context.session.expressions = session;
    else delete context.session.expressions;
    if (media) {
      // Object URL caches belong to the original media objects, including shared consumers.
      media.splice(0, media.length, ...mediaItems);
      context.char.media_assets = media;
    } else delete context.char.media_assets;
    if (expressionContextMatches(context)) {
      syncExpressions();
      if (_expressionManagerChar === context.char && $('expressions-modal').classList.contains('open'))
        renderExpressionManager();
    }
    throw error;
  }
}
async function setExpression(name, options) {
  options = options || {};
  if (!expressionOptionsCurrent(options)) throw new DOMException('立绘选择已取消', 'AbortError');
  var context = expressionCurrent(),
    rows = expressionRows(context),
    requested = String(name || '').trim();
  if (requested === '#reset') {
    cancelExpressionClassification();
    await expressionChange(
      context,
      function () {
        context.session.expressions = Object.assign({}, context.session.expressions || {}, {
          label: '#reset',
          assetId: '',
        });
      },
      'sessions'
    );
    return '#reset';
  }
  if (!rows.length) throw new Error('当前素材组没有表情，请在“立绘表情”中添加图片或绑定卡内图片');
  var matches = rows.filter(function (row) {
    if (options.type === 'sprite') {
      var asset = context.char.media_assets.find(function (asset) {
        return asset.id === row.assetId;
      });
      return asset && String(asset.name || '').toLowerCase() === requested.toLowerCase();
    }
    return row.label.toLowerCase() === requested.toLowerCase();
  });
  if (
    options.type !== 'sprite' &&
    matches.some(function (row) {
      return row.label === requested;
    })
  )
    matches = matches.filter(function (row) {
      return row.label === requested;
    });
  if (!matches.length && options.mode === 'command' && typeof stscriptFindNamed === 'function') {
    var candidate = stscriptFindNamed(
      rows.map(function (row) {
        return { name: options.type === 'sprite' ? row.name : row.label, row: row };
      }),
      requested
    );
    if (candidate)
      matches =
        options.type === 'sprite'
          ? [candidate.row]
          : rows.filter(function (row) {
              return row.label === candidate.row.label;
            });
  }
  if (!matches.length) {
    if (options.mode === 'command') return '';
    throw new Error('没有表情“' + requested + '”，请从当前素材组的标签中选择');
  }
  cancelExpressionClassification();
  var epoch = _expressionEpoch,
    previous = context.session.expressions || {},
    alternatives = matches.filter(function (row) {
      return row.assetId !== previous.assetId;
    }),
    selected = (alternatives.length ? alternatives : matches)[
      Math.floor(Math.random() * (alternatives.length || matches.length))
    ];
  if (options.assetId)
    selected =
      matches.find(function (row) {
        return row.assetId === options.assetId;
      }) || selected;
  await YeyuExpressionAssets.source(context.char, selected.assetId, { retry: !options.preserveVisibility });
  if (epoch !== _expressionEpoch || !expressionContextMatches(context) || !expressionOptionsCurrent(options))
    throw new DOMException('对话已切换，立绘未改变', 'AbortError');
  await expressionChange(
    context,
    function () {
      if (epoch !== _expressionEpoch || !expressionOptionsCurrent(options))
        throw new DOMException('立绘选择已取消', 'AbortError');
      context.session.expressions = Object.assign({}, previous, { label: selected.label, assetId: selected.assetId });
      if (!options.preserveVisibility) context.config.hidden = false;
    },
    ['characters', 'sessions']
  );
  return selected.label;
}
async function classifyExpression(text, options) {
  options = options || {};
  if (!expressionOptionsCurrent(options)) throw new DOMException('分类已取消', 'AbortError');
  var context = expressionCurrent(),
    labels = expressionLabels(context, options.filter),
    prompt = String(options.prompt || assistantPromptText('expressions', 'classify'))
      .trim()
      .replace(/{{labels}}/gi, labels.join(', '));
  if (!labels.length) throw new Error('当前素材组没有可分类的表情，请先添加表情');
  if (!prompt) throw new Error('请先在“预设 → 辅助”中填写表情分类提示词');
  if (!String(text || '').trim()) throw new Error('没有可分类的消息正文');
  if (options.api && !['llm', 'current'].includes(String(options.api).toLowerCase()))
    throw new Error('立绘分类支持当前聊天模型；请使用 api=llm');
  cancelExpressionClassification();
  var controller = new AbortController(),
    epoch = _expressionEpoch;
  var cancel = function () {
    controller.abort();
  };
  if (options.signal) options.signal.addEventListener('abort', cancel, { once: true });
  _expressionRequest = controller;
  if ($('expression-stop')) $('expression-stop').hidden = false;
  if ($('expression-status')) $('expression-status').hidden = false;
  try {
    var result = await callDeepSeek(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify({ labels: labels, message: String(text) }) },
      ],
      null,
      {
        route: 'chat',
        transient: true,
        nonStream: true,
        disableThinking: true,
        controller: controller,
        maxTokens: Math.max(
          128,
          labels.reduce(function (max, label) {
            return Math.max(max, label.length * 3 + 16);
          }, 0)
        ),
        ignoreUserMaxTokens: true,
      }
    );
    if (
      controller.signal.aborted ||
      epoch !== _expressionEpoch ||
      !expressionContextMatches(context) ||
      !expressionOptionsCurrent(options)
    )
      throw new DOMException('分类已停止或对话已切换', 'AbortError');
    var answer = String(result.content || '')
        .trim()
        .replace(/^["']|["']$/g, ''),
      label =
        labels.find(function (value) {
          return value === answer;
        }) ||
        labels.find(function (value) {
          return value.toLowerCase() === answer.toLowerCase();
        });
    if (!label) throw new Error('模型未返回当前素材组的标签，立绘保持不变；请调整分类提示词后重试');
    return label;
  } catch (error) {
    if (
      controller.signal.aborted ||
      epoch !== _expressionEpoch ||
      !expressionContextMatches(context) ||
      !expressionOptionsCurrent(options)
    )
      throw new DOMException('分类已停止或对话已切换', 'AbortError');
    throw error;
  } finally {
    if (options.signal) options.signal.removeEventListener('abort', cancel);
    if (_expressionRequest === controller) {
      _expressionRequest = null;
      if ($('expression-stop')) $('expression-stop').hidden = true;
      if ($('expression-status')) $('expression-status').hidden = true;
    }
  }
}
function expressionOptionsCurrent(options) {
  return !options || (!(options.signal && options.signal.aborted) && (!options.current || options.current()));
}
function autoClassifyExpression(char, session, message, options) {
  if (
    !expressionOptionsCurrent(options) ||
    !char ||
    !expressionAvailable(char) ||
    !session ||
    !message ||
    getChar() !== char ||
    getActiveSession(char.id) !== session
  )
    return;
  var config = YeyuExpressionAssets.config(char);
  if (!config.auto || !String(message.content || '').trim()) return;
  var content = message.content;
  return classifyExpression(content, options)
    .then(function (label) {
      if (
        !expressionOptionsCurrent(options) ||
        getChar() !== char ||
        getActiveSession(char.id) !== session ||
        !YeyuExpressionAssets.config(char).auto ||
        message.content !== content ||
        session.msgs
          .filter(function (row) {
            return row.role === 'assistant';
          })
          .slice(-1)[0] !== message
      )
        return;
      return setExpression(label, Object.assign({}, options, { preserveVisibility: true }));
    })
    .catch(function (error) {
      if (error.name !== 'AbortError') toast('表情判定失败，保留当前立绘；可在“立绘表情”中重试', 'err');
    });
}
async function expressionFolder(name, options) {
  var context = expressionCurrent();
  if (options && Object.prototype.hasOwnProperty.call(options, 'costume')) {
    expressionAssertCharacter(name, context);
    name = String(options.costume || '').replace(/^[/\\]+/, '');
  }
  if (name == null) return String(context.config.group || '');
  var group = String(name).trim();
  if (
    group &&
    !YeyuExpressionAssets.bindings(context.char).some(function (row) {
      return row.group === group;
    })
  )
    throw new Error('没有素材组“' + group + '”，请先在立绘表情中添加该组图片');
  cancelExpressionClassification();
  await expressionChange(context, function () {
    context.config.group = group;
  });
  return group;
}
async function expressionFallback(name) {
  var context = expressionCurrent();
  if (name == null || name === '') return String(context.config.fallback || '');
  var label = String(name).trim();
  if (label === '#emoji') throw new Error('夜欲不提供 Emoji 默认立绘；请选择图片标签或 #none');
  label =
    ['#none'].concat(expressionLabels(context)).find(function (value) {
      return value.toLowerCase() === label.toLowerCase();
    }) || '';
  if (!label && name) return '';
  await expressionChange(context, function () {
    context.config.fallback = label;
  });
  return label;
}
async function expressionVn(value) {
  var context = expressionCurrent();
  cancelExpressionClassification();
  await expressionChange(
    context,
    function () {
      context.config.vn =
        value == null || value === '' || value === 'toggle'
          ? !context.config.vn
          : ['true', 'on', '1'].includes(String(value));
      if (context.config.vn) context.config.hidden = false;
      expressionResumeDisplay(context);
    },
    ['characters', 'sessions']
  );
  return String(context.config.vn);
}
function clearExpressionStage(stage) {
  if (typeof finishUiMotion === 'function') finishUiMotion(stage);
  delete stage.dataset.expressionPending;
  stage.inert = false;
  stage.querySelectorAll('.expression-image-outgoing').forEach(function (node) {
    node.remove();
  });
  var image = $('expression-image');
  image.removeAttribute('src');
  delete image.dataset.asset;
  delete image.dataset.owner;
  image.alt = '';
}
function setExpressionStageVisible(stage, visible) {
  if (!visible && stage.dataset.expressionPending === 'true') {
    delete stage.dataset.expressionPending;
    stage.inert = false;
    stage.hidden = true;
    stage.setAttribute('aria-hidden', 'true');
    return;
  }
  if (typeof transitionUiVisibility === 'function') {
    transitionUiVisibility(
      stage,
      visible,
      function () {
        stage.hidden = !visible;
      },
      'expression'
    );
  } else stage.hidden = !visible;
}
function loadExpressionImage(source) {
  return new Promise(function (resolve, reject) {
    var image = new Image();
    image.onload = function () {
      resolve(source);
    };
    image.onerror = function () {
      reject(new Error('立绘图片无法显示'));
    };
    image.src = source;
  });
}
function paintExpressionImage(stage, image, source, row, char) {
  var pending = stage.dataset.expressionPending === 'true',
    showing = !pending && !stage.hidden && image.complete && image.naturalWidth > 0,
    changing = showing && (image.dataset.asset !== row.assetId || image.dataset.owner !== String(char.id)),
    outgoing = null;
  if (typeof finishUiMotion === 'function') finishUiMotion(stage);
  if (changing) {
    outgoing = image.cloneNode(false);
    outgoing.removeAttribute('id');
    outgoing.removeAttribute('alt');
    outgoing.setAttribute('aria-hidden', 'true');
    outgoing.className = 'expression-image-outgoing';
    image.after(outgoing);
  }
  image.src = source;
  image.dataset.asset = row.assetId;
  image.dataset.owner = String(char.id);
  image.alt = row.label;
  $('expression-label').textContent = row.label;
  if (pending) {
    delete stage.dataset.expressionPending;
    stage.inert = false;
    stage.setAttribute('aria-hidden', 'false');
    if (typeof runUiMotion === 'function') {
      var entrance = runUiMotion(stage, [{ node: stage, frames: [{ opacity: 0 }, { opacity: 1 }] }], '--motion-fast');
      if (entrance) entrance.visible = true;
    }
    return;
  }
  setExpressionStageVisible(stage, true);
  if (!outgoing || typeof runUiMotion !== 'function') return;
  var motion = runUiMotion(
    stage,
    [
      { node: outgoing, frames: [{ opacity: 1 }, { opacity: 0 }] },
      { node: image, frames: [{ opacity: 0 }, { opacity: 1 }] },
    ],
    '--motion-fast',
    function () {
      outgoing.remove();
    }
  );
  if (motion) motion.visible = true;
}
function syncExpressions() {
  var stage = $('expression-stage');
  if (!stage || !window.YeyuExpressionAssets) return;
  var char = getChar(),
    session = char && getActiveSession(char.id),
    contextChanged = !_expressionContext || _expressionContext.char !== char || _expressionContext.session !== session;
  if (contextChanged) {
    cancelExpressionClassification();
    _expressionContext = { char: char, session: session };
    clearExpressionStage(stage);
    stage.hidden = true;
  }
  var paint = ++_expressionPaint;
  if (char && !expressionAvailable(char)) {
    cancelExpressionClassification();
    clearExpressionStage(stage);
    document.body.classList.remove('expression-vn');
    setExpressionStageVisible(stage, false);
    return;
  }
  var storedConfig =
    char &&
    char.extensions &&
    char.extensions.yeyu &&
    char.extensions.yeyu.expressions &&
    typeof char.extensions.yeyu.expressions === 'object' &&
    !Array.isArray(char.extensions.yeyu.expressions)
      ? char.extensions.yeyu.expressions
      : null;
  if (!char || !session || !storedConfig) {
    if (char && session && !contextChanged) clearExpressionStage(stage);
    document.body.classList.remove('expression-vn');
    setExpressionStageVisible(stage, false);
    return;
  }
  var context = expressionCurrent(),
    config = context.config;
  if (config.hidden !== false && !config.vn) {
    document.body.classList.remove('expression-vn');
    setExpressionStageVisible(stage, false);
    return;
  }
  var rows = expressionRows(context),
    state = session.expressions || {},
    row =
      rows.find(function (entry) {
        return entry.assetId === state.assetId && entry.label === state.label;
      }) ||
      rows.find(function (entry) {
        return entry.label === state.label;
      }) ||
      rows.find(function (entry) {
        return entry.label === config.fallback;
      }) ||
      (config.fallback === '#none'
        ? null
        : rows.find(function (entry) {
            return !entry.missing;
          }));
  if (state.label === '#reset' || !row) {
    document.body.classList.remove('expression-vn');
    setExpressionStageVisible(stage, false);
    return;
  }
  document.body.style.setProperty(
    '--expression-height',
    Math.max(16, Math.min(42, Number(config.height) || (config.vn ? 36 : 24))) + 'vh'
  );
  stage.dataset.position = ['left', 'right'].includes(config.position) ? config.position : 'center';
  document.body.classList.toggle('expression-vn', !!config.vn);
  var image = $('expression-image');
  if (
    !stage.hidden &&
    image.dataset.asset === row.assetId &&
    image.dataset.owner === String(char.id) &&
    image.complete &&
    image.naturalWidth > 0
  ) {
    $('expression-label').textContent = row.label;
    setExpressionStageVisible(stage, true);
    return;
  }
  if (stage.hidden) {
    stage.hidden = false;
    stage.inert = true;
    stage.dataset.expressionPending = 'true';
  }
  Promise.resolve()
    .then(function () {
      return YeyuExpressionAssets.source(char, row.assetId);
    })
    .then(loadExpressionImage)
    .then(function (source) {
      if (paint === _expressionPaint && expressionContextMatches(context))
        paintExpressionImage(stage, image, source, row, char);
    })
    .catch(function () {
      if (paint === _expressionPaint) {
        document.body.classList.remove('expression-vn');
        setExpressionStageVisible(stage, false);
      }
    });
}
async function expressionVisibility(hidden) {
  var context = expressionCurrent();
  cancelExpressionClassification();
  await expressionChange(
    context,
    function () {
      context.config.hidden = !!hidden;
      if (hidden) context.config.vn = false;
      expressionResumeDisplay(context);
    },
    ['characters', 'sessions']
  );
}
function expressionResumeDisplay(context) {
  if (!context.config.hidden && (context.session.expressions || {}).label === '#reset') {
    delete context.session.expressions.label;
    delete context.session.expressions.assetId;
  }
}
function expressionUiError(error) {
  if (error && error.name !== 'AbortError') toast(error.message || String(error), 'err');
}
function expressionUiVn(value) {
  expressionVn(value).catch(expressionUiError);
}
function expressionUiVisibility(value) {
  expressionVisibility(value).catch(expressionUiError);
}
function expressionUiFolder(value) {
  expressionFolder(value).then(renderExpressionManager).catch(expressionUiError);
}
function expressionManagerContext() {
  var context = expressionCurrent();
  if (context.char !== _expressionManagerChar) throw new Error('角色已切换，请重新打开立绘表情');
  return context;
}
function openExpressionManager() {
  try {
    var context = expressionCurrent();
    _expressionManagerChar = context.char;
    renderExpressionManager();
    openModal('expressions-modal');
  } catch (error) {
    expressionUiError(error);
  }
}
function expressionOption(value, title, active) {
  return '<option value="' + escAttr(value) + '"' + (active ? ' selected' : '') + '>' + esc(title) + '</option>';
}
function renderExpressionManager() {
  var context = expressionManagerContext(),
    config = context.config,
    rows = expressionRows(context),
    groups = Array.from(
      new Set(
        [''].concat(
          YeyuExpressionAssets.bindings(context.char).map(function (row) {
            return row.group;
          })
        )
      )
    );
  $('expression-group').innerHTML = groups
    .map(function (group) {
      return expressionOption(group, group || '默认素材组', group === (config.group || ''));
    })
    .join('');
  $('expression-visible').checked = config.hidden === false || !!config.vn;
  $('expression-vn-toggle').checked = !!config.vn;
  $('expression-auto').checked = !!config.auto;
  $('expression-height').value = Number(config.height) || (config.vn ? 36 : 24);
  $('expression-position').value = config.position || 'center';
  $('expression-fallback').innerHTML =
    expressionOption('', '首张可用图片', !config.fallback) +
    expressionOption('#none', '不显示默认图片', config.fallback === '#none') +
    expressionLabels(context)
      .map(function (label) {
        return expressionOption(label, label, label === config.fallback);
      })
      .join('');
  $('expression-bind-group').value = config.group || '';
  var list = $('expression-bindings');
  list.replaceChildren();
  if (!rows.length)
    list.innerHTML =
      '<p class="ui-empty">这个素材组还没有表情。添加图片或 ZIP 表情包，也可以在「绑定卡内图片」里选择。</p>';
  rows.forEach(function (row) {
    var item = document.createElement('div');
    item.className = 'expression-tile';
    item.innerHTML =
      '<button type="button" class="expression-preview" aria-label="切换到 ' +
      escAttr(row.label) +
      '"><img alt="' +
      escAttr(row.label) +
      '" loading="lazy"><span>' +
      esc(row.label) +
      '</span></button><div class="expression-tile-actions"><button type="button" class="btn text sm" data-expression-replace>替换</button><button type="button" class="btn text sm danger" data-expression-unbind>删除绑定</button></div>';
    item.querySelector('.expression-preview').onclick = function () {
      setExpression(row.label, { assetId: row.assetId }).catch(expressionUiError);
    };
    item.querySelector('[data-expression-replace]').onclick = function () {
      expressionChooseFiles({ label: row.label, group: row.group, replace: true, replaceAssetId: row.assetId });
    };
    item.querySelector('[data-expression-unbind]').onclick = async function () {
      try {
        expressionManagerContext();
        cancelExpressionClassification();
        await expressionChange(context, function () {
          YeyuExpressionAssets.unbind(context.char, row);
        });
        renderExpressionManager();
      } catch (error) {
        expressionUiError(error);
      }
    };
    list.appendChild(item);
    expressionPreviewSource(context.char, row.assetId, item.querySelector('img'));
  });
  var images = $('expression-assets');
  images.replaceChildren();
  var assets = YeyuExpressionAssets.images(context.char);
  if (!assets.length)
    images.innerHTML =
      '<p class="ui-empty">卡内没有附加图片。可以添加独立图片或 ZIP 表情包；角色封面不会自动作为表情。</p>';
  assets.forEach(function (asset) {
    var item = document.createElement('div'),
      button = document.createElement('button');
    item.className = 'expression-tile';
    button.type = 'button';
    button.className = 'expression-preview';
    button.innerHTML =
      '<img loading="lazy" alt="' +
      escAttr(asset.name || asset.id) +
      '"><span>' +
      esc(asset.name || asset.id) +
      '</span>';
    button.onclick = async function () {
      try {
        expressionManagerContext();
        var label = $('expression-bind-label').value.trim(),
          group = $('expression-bind-group').value.trim();
        if (!label) {
          $('expression-bind-label').focus();
          throw new Error('请先填写要绑定的表情标签');
        }
        cancelExpressionClassification();
        await expressionChange(context, function () {
          YeyuExpressionAssets.bind(context.char, asset.id, label, group);
        });
        renderExpressionManager();
      } catch (error) {
        expressionUiError(error);
      }
    };
    item.appendChild(button);
    images.appendChild(item);
    expressionPreviewSource(context.char, asset.id, button.querySelector('img'));
  });
  if (typeof syncAppSelects === 'function') syncAppSelects($('expressions-modal'));
}
function expressionPreviewSource(char, id, image, retry) {
  image.dataset.expressionAsset = id;
  YeyuExpressionAssets.source(char, id, { retry: !!retry })
    .then(function (source) {
      if (!image.isConnected) return;
      image.src = source;
      if (retry) {
        $('expressions-modal')
          .querySelectorAll('[data-expression-asset]')
          .forEach(function (node) {
            if (node.dataset.expressionAsset !== String(id)) return;
            if (node.tagName === 'IMG') {
              node.src = source;
              node.hidden = false;
            } else node.remove();
          });
        if (getChar() === char) syncExpressions();
      }
    })
    .catch(function (error) {
      if (image.isConnected) {
        image.hidden = true;
        var note = document.createElement('div'),
          text = document.createElement('small');
        note.className = 'expression-help';
        note.dataset.expressionAsset = id;
        text.textContent = error.message || '图片无法读取，请从原文件补入';
        note.appendChild(text);
        if (error.retryable) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn text accent sm';
          button.textContent = '重试加载';
          button.onclick = function () {
            note.remove();
            image.hidden = false;
            expressionPreviewSource(char, id, image, true);
          };
          note.appendChild(button);
        }
        image.parentElement.after(note);
      }
    });
}
async function expressionNewGroup() {
  try {
    var context = expressionManagerContext(),
      group = await appInput('输入名称后添加该组图片。', '', '新建素材组', '素材组名称', { okText: '选择图片' });
    if (group == null || !String(group).trim()) return;
    if (!expressionContextMatches(context)) return;
    expressionChooseFiles({ group: String(group).trim() });
  } catch (error) {
    expressionUiError(error);
  }
}
async function expressionClassifyLatest() {
  try {
    var context = expressionManagerContext(),
      message = context.session.msgs
        .filter(function (row) {
          return row.role === 'assistant';
        })
        .slice(-1)[0];
    if (!message) throw new Error('当前对话还没有角色回复');
    var content = message.content,
      label = await classifyExpression(content);
    if (
      expressionContextMatches(context) &&
      message.content === content &&
      context.session.msgs
        .filter(function (row) {
          return row.role === 'assistant';
        })
        .slice(-1)[0] === message
    )
      await setExpression(label, { preserveVisibility: true });
  } catch (error) {
    expressionUiError(error);
  }
}
function expressionAssertCharacter(name, context) {
  if (name && ![String(context.char.id), canonicalCharacterName(context.char)].includes(String(name)))
    throw new Error('立绘命令仅支持当前角色；请先切换到目标角色');
}
async function uploadExpression(url, options) {
  options = options || {};
  var context = expressionCurrent(),
    group = String(options.folder == null ? context.config.group || '' : options.folder).replace(/^[/\\]+/, '');
  expressionAssertCharacter(options.name, context);
  if (!options.label) throw new Error('上传表情需要 label 标签');
  var source = String(url || '').trim(),
    blob;
  if (/^data:image\//i.test(source)) blob = await (await fetch(source)).blob();
  else {
    var data = await downloadCardImage(source);
    blob = await (await fetch(data)).blob();
  }
  if (!expressionContextMatches(context)) throw new DOMException('对话已切换，图片未添加', 'AbortError');
  var spriteName = String(options.spriteName || options.label).replace(/[/\\]/g, '_'),
    filename = spriteName;
  if (!/\.(png|webp|gif|jpe?g|avif)$/i.test(filename))
    filename += '.' + (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  var old = YeyuExpressionAssets.bindings(context.char).find(function (row) {
    return row.group === group && row.name === filename && row.label === String(options.label);
  });
  await expressionChange(context, async function () {
    await YeyuExpressionAssets.importFiles(context.char, [new File([blob], filename, { type: blob.type })], {
      label: String(options.label),
      group: group,
      replace: !!old,
      replaceAssetId: old && old.assetId,
    });
    if (!expressionContextMatches(context)) throw new DOMException('对话已切换，图片未添加', 'AbortError');
  });
  return spriteName;
}
async function expressionUpdateSettings(changedId) {
  try {
    var context = expressionManagerContext(),
      auto = $('expression-auto').checked;
    cancelExpressionClassification();
    await expressionChange(
      context,
      function () {
        Object.assign(context.config, {
          hidden: !$('expression-visible').checked,
          vn: $('expression-vn-toggle').checked,
          auto: auto,
          height: Number($('expression-height').value),
          position: $('expression-position').value,
          fallback: $('expression-fallback').value,
        });
        if (changedId === 'expression-visible' && context.config.hidden) context.config.vn = false;
        if (context.config.vn) context.config.hidden = false;
        $('expression-visible').checked = !context.config.hidden;
        $('expression-vn-toggle').checked = !!context.config.vn;
        expressionResumeDisplay(context);
      },
      ['characters', 'sessions']
    );
  } catch (error) {
    if (_expressionManagerChar === getChar()) renderExpressionManager();
    expressionUiError(error);
  }
}
function expressionChooseFiles(options) {
  var context;
  try {
    context = expressionCurrent();
  } catch (error) {
    expressionUiError(error);
    return;
  }
  options = options || { group: context.config.group || '' };
  var input = $('expression-files');
  input.accept = options.replaceAssetId ? 'image/*' : 'image/*,.zip';
  input.value = '';
  input.onchange = async function () {
    var file = input.files[0];
    if (!file) return;
    try {
      if (!expressionContextMatches(context)) throw new Error('角色或对话已切换，请重新添加图片');
      await expressionChange(
        context,
        async function () {
          var imported = await YeyuExpressionAssets.importFiles(context.char, [file], options);
          if (!expressionContextMatches(context)) throw new DOMException('对话已切换，图片未添加', 'AbortError');
          if (
            options.replaceAssetId &&
            (context.session.expressions || {}).assetId === options.replaceAssetId &&
            context.session.expressions.label === options.label &&
            context.config.group === options.group
          ) {
            var replacement = imported.bindings[0];
            context.session.expressions = Object.assign({}, context.session.expressions, {
              assetId: replacement.assetId,
              label: replacement.label,
            });
          }
          context.config.group = options.group || '';
          context.config.hidden = false;
          cancelExpressionClassification();
        },
        ['characters', 'sessions']
      );
      if (_expressionManagerChar === context.char) renderExpressionManager();
      toast('表情图片已添加', 'ok');
    } catch (error) {
      expressionUiError(error);
    } finally {
      input.value = '';
    }
  };
  input.click();
}
window.YeyuExpressions = {
  list: function (options) {
    return expressionLabels(expressionCurrent(), options && options.filter);
  },
  last: function () {
    var context = expressionCurrent();
    return String((context.session.expressions || {}).label || '');
  },
  set: setExpression,
  classify: classifyExpression,
  fallback: expressionFallback,
  folder: expressionFolder,
  vn: expressionVn,
  upload: uploadExpression,
};
document.addEventListener('visibilitychange', function () {
  if (document.hidden) cancelExpressionClassification();
});
