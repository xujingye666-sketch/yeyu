// ===== STScript interface commands =====
var _scriptDialogResolvers = new Map(),
  _scriptLoaders = new Map();
function scriptDialog(title, content, buttons, options) {
  options = options || {};
  return new Promise(function (resolve) {
    var id = 'script-dialog-' + stscriptUid(),
      overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'modal script-dialog';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    // Width requests only apply on wide screens; phones always get the full-width centred dialog.
    if (options.wide) modal.dataset.width = options.wider ? 'wider' : 'wide';
    if (options.large) modal.dataset.height = 'large';
    if (options.transparent) modal.style.background = 'transparent';
    var header = document.createElement('div');
    header.className = 'modal-hd';
    var heading = document.createElement('h2');
    if (options.headerHtml) heading.innerHTML = DOMPurify.sanitize(title || '提示');
    else heading.textContent = title || '提示';
    heading.id = id + '-title';
    modal.setAttribute('aria-labelledby', heading.id);
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal-close';
    close.setAttribute('aria-label', '关闭窗口');
    close.innerHTML = uiIcon('close');
    close.onclick = function () {
      closeModal(id);
    };
    header.append(heading, close);
    var body = document.createElement('div');
    body.className = 'modal-body';
    if (options.tooltip != null) body.title = String(options.tooltip);
    if (typeof content === 'string') body.innerHTML = DOMPurify.sanitize(content);
    else body.appendChild(content);
    if (options.scroll === false) body.style.overflowY = 'hidden';
    var footer = document.createElement('div');
    footer.className = 'modal-ft';
    function done(value) {
      _scriptDialogResolvers.delete(id);
      closeModal(id);
      overlay.remove();
      resolve(value);
    }
    var rows = buttons || [{ label: '确定', value: true }],
      primaryRow = rows.find(function (row) {
        return !!row.value;
      });
    rows.forEach(function (row) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ' + scriptDialogButtonKind(row, row === primaryRow);
      button.textContent = row.label;
      button.onclick = function () {
        done(row.value);
      };
      footer.appendChild(button);
    });
    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    _scriptDialogResolvers.set(id, function () {
      overlay.remove();
      resolve(null);
    });
    overlay.onclick = function (event) {
      if (event.target === overlay) closeModal(id);
    };
    openModal(id);
    if (options.onOpen) options.onOpen(done);
    if (options.abortController) {
      var cancel = function () {
        closeModal(id);
      };
      options.abortController.onAbort(cancel);
      var originalResolve = resolve;
      resolve = function (value) {
        options.abortController.offAbort(cancel);
        originalResolve(value);
      };
    }
  });
}
// A falsy value dismisses (text button); the first truthy value completes (primary, or danger when it deletes).
function scriptDialogButtonKind(row, completes) {
  if (!row.value) return 'text';
  if (!completes) return '';
  return typeof isDestructiveActionLabel === 'function' && isDestructiveActionLabel(row.label) ? 'danger' : 'primary';
}
stscriptAddCommand({
  name: 'popup',
  namedArgumentList: [
    'header',
    'result',
    'scroll',
    'large',
    'wide',
    'wider',
    'transparent',
    'okButton',
    'cancelButton',
    'tooltip',
  ].map(function (name) {
    return { name: name };
  }),
  callback: async function (args, value) {
    var text = stscriptJoin(value),
      buttons = [{ label: args.okButton == null ? '确定' : String(args.okButton), value: 1 }];
    if (args.cancelButton != null) buttons.push({ label: String(args.cancelButton), value: 0 });
    var result = await scriptDialog(args.header, text, buttons, {
      wide: stscriptIsTrue(args.wide) || stscriptIsTrue(args.wider) || stscriptIsTrue(args.large),
      wider: stscriptIsTrue(args.wider),
      large: stscriptIsTrue(args.large),
      tooltip: args.tooltip,
      headerHtml: true,
      transparent: stscriptIsTrue(args.transparent),
      scroll: !stscriptIsFalse(args.scroll),
      abortController: args._abortController,
    });
    return stscriptIsTrue(args.result) ? (result == null ? '' : String(result)) : text;
  },
});
var SCRIPT_ICON_CHOICES = [
  ['fa-bars', 'menu', '菜单'],
  ['fa-ellipsis', 'more', '更多'],
  ['fa-compass', 'compass', '指南针'],
  ['fa-expand', 'expand', '展开'],
  ['fa-desktop', 'monitor', '屏幕'],
  ['fa-users', 'users', '角色'],
  ['fa-user', 'user', '人格'],
  ['fa-book', 'book', '书籍'],
  ['fa-plus', 'plus', '添加'],
  ['fa-floppy-disk', 'save', '保存'],
  ['fa-gear', 'settings', '设置'],
  ['fa-comment', 'chat', '对话'],
  ['fa-wand-magic-sparkles', 'spark', '星光'],
  ['fa-brain', 'brain', '思考'],
  ['fa-magnifying-glass', 'search', '搜索'],
  ['fa-arrows-rotate', 'refresh', '刷新'],
  ['fa-play', 'play', '播放'],
  ['fa-music', 'music', '音乐'],
  ['fa-stop', 'stop', '停止'],
];
async function pickScriptIcon() {
  var grid = document.createElement('div');
  grid.className = 'script-icon-grid';
  var chosen = await scriptDialog('选择图标', grid, [{ label: '取消', value: false }], {
    onOpen: function (finish) {
      SCRIPT_ICON_CHOICES.forEach(function (row) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.dataset.icon = row[0];
        button.innerHTML = uiIcon(row[1]);
        var label = document.createElement('span');
        label.textContent = row[2];
        button.appendChild(label);
        button.onclick = function () {
          finish(row[0]);
        };
        grid.appendChild(button);
      });
    },
  });
  return chosen == null ? 'false' : String(chosen);
}
stscriptAddCommand({ name: 'pick-icon', callback: pickScriptIcon });
function scriptLoaderRender() {
  var surface = $('script-loader-surface');
  if (!surface) {
    surface = document.createElement('div');
    surface.id = 'script-loader-surface';
    document.body.appendChild(surface);
  }
  surface.replaceChildren();
  surface.hidden = !_scriptLoaders.size;
  surface.className =
    'script-loader-surface' +
    (Array.from(_scriptLoaders.values()).some(function (row) {
      return row.blocking;
    })
      ? ' blocking'
      : '');
  _scriptLoaders.forEach(function (row, id) {
    if (row.toast === 'none') return;
    var panel = document.createElement('div');
    panel.className = 'script-loader-panel';
    panel.setAttribute('role', 'status');
    var label = document.createElement('span');
    label.textContent = (row.title ? row.title + ' — ' : '') + row.message;
    panel.appendChild(label);
    if (row.toast !== 'static') {
      var stop = document.createElement('button');
      stop.className = 'btn';
      stop.textContent = '停止';
      stop.title = row.stopTooltip || '停止';
      stop.onclick = function () {
        scriptLoaderFinish(id, true).catch(function (error) {
          toast(error.message);
        });
      };
      panel.appendChild(stop);
    }
    surface.appendChild(panel);
  });
}
function scriptLoaderShow(args) {
  ['onStop', 'onHide'].forEach(function (key) {
    if (args[key] && !(args[key] instanceof StscriptClosure)) throw new Error(key + ' 需要闭包');
  });
  var id = String(args.slug || 'slash-show') + '-' + stscriptUid();
  _scriptLoaders.set(id, {
    blocking: !stscriptIsFalse(args.blocking),
    toast: ['none', 'static', 'stoppable'].includes(args.toast) ? args.toast : 'stoppable',
    message: args.message == null ? '正在处理…' : String(args.message),
    title: args.title || '',
    stopTooltip: args.stopTooltip,
    onStop: args.onStop,
    onHide: args.onHide,
    cancel: typeof args.cancel === 'function' ? args.cancel : null,
  });
  scriptLoaderRender();
  return id;
}
async function scriptLoaderFinish(id, stop) {
  var row = _scriptLoaders.get(id);
  if (!row) return false;
  try {
    if (stop) {
      if (typeof row.cancel === 'function') row.cancel();
      if (row.onStop) await scriptLoaderCallback(row.onStop);
      else if (typeof row.cancel !== 'function' && typeof stopGeneration === 'function') await stopGeneration();
    }
  } finally {
    _scriptLoaders.delete(id);
    scriptLoaderRender();
    if (!stop && row.onHide) await scriptLoaderCallback(row.onHide);
  }
  return true;
}
async function scriptLoaderCallback(closure) {
  try {
    await closure.getCopy().execute();
  } catch (_) {
    toast('加载提示的回调执行失败');
  }
}
var scriptLoaderArguments = ['blocking', 'toast', 'message', 'title', 'slug', 'stopTooltip', 'onStop', 'onHide'].map(
  function (name) {
    return { name: name };
  }
);
stscriptAddCommand({
  name: 'loader-show',
  namedArgumentList: scriptLoaderArguments,
  callback: function (args) {
    return scriptLoaderShow(args);
  },
});
stscriptAddCommand({
  name: 'loader-hide',
  namedArgumentList: [{ name: 'handle' }],
  callback: async function (args) {
    if (args.handle) return String(await scriptLoaderFinish(String(args.handle), false));
    var ids = Array.from(_scriptLoaders.keys());
    for (var id of ids) await scriptLoaderFinish(id, false);
    return String(!!ids.length);
  },
});
stscriptAddCommand({
  name: 'loader-stop',
  namedArgumentList: [{ name: 'handle' }],
  callback: async function (args) {
    return String(await scriptLoaderFinish(String(args.handle || ''), true));
  },
});
stscriptAddCommand({
  name: 'loader-wrap',
  dryRun: 'run',
  namedArgumentList: scriptLoaderArguments,
  callback: async function (args, value) {
    if (!(value instanceof StscriptClosure)) throw new Error('/loader-wrap 需要闭包');
    if (stscriptDryRunning(args)) return (await value.execute()).pipe;
    var id = scriptLoaderShow(args);
    try {
      return (await value.execute()).pipe;
    } finally {
      await scriptLoaderFinish(id, false);
    }
  },
});
stscriptAddCommand({
  name: 'beep',
  aliases: ['ding'],
  callback: async function (args) {
    var Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('当前环境不能播放提示音');
    var context = new Audio(),
      oscillator,
      timer,
      cancel;
    try {
      await new Promise(function (resolve, reject) {
        var settled = false;
        function finish(error) {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        }
        cancel = function () {
          finish(new Error('提示音已中止'));
        };
        timer = setTimeout(function () {
          finish();
        }, 1500);
        if (args._abortController) {
          args._abortController.onAbort(cancel);
          if (args._abortController.signal.aborted) return cancel();
        }
        Promise.resolve(context.resume())
          .then(function () {
            if (settled) return;
            oscillator = context.createOscillator();
            var gain = context.createGain();
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.12, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.onended = function () {
              finish();
            };
            oscillator.start();
            oscillator.stop(context.currentTime + 0.2);
          })
          .catch(finish);
      });
    } finally {
      clearTimeout(timer);
      if (args._abortController) args._abortController.offAbort(cancel);
      if (oscillator) oscillator.disconnect();
      Promise.resolve(context.close()).catch(function () {});
    }
    return '';
  },
});
stscriptAddCommand({
  name: 'bubble',
  aliases: ['bubbles'],
  callback: async function () {
    var old = D.settings.messageStyle;
    D.settings.messageStyle = 'bubble';
    try {
      await saveData('meta');
    } catch (error) {
      D.settings.messageStyle = old;
      throw error;
    }
    applyMessageStyle();
    return '';
  },
});
stscriptAddCommand({
  name: 'chat-jump',
  aliases: ['chat-scrollto', 'floor-teleport'],
  callback: function (args, value) {
    var index = Number(stscriptJoin(value));
    if (!Number.isInteger(index) || index < 0 || index >= stscriptMsgs().length) throw new Error('消息编号不存在');
    jumpToMessage(index);
    return '';
  },
});
stscriptAddCommand({
  name: 'chat-render',
  namedArgumentList: [{ name: 'scroll' }],
  callback: function (args, value) {
    var count = Number(stscriptJoin(value));
    loadOlderHistory(count && !Number.isNaN(count) ? count : Number.MAX_SAFE_INTEGER);
    if (stscriptIsTrue(args.scroll)) setChatScrollBoundary(false);
    return '';
  },
});
stscriptAddCommand({
  name: 'panels',
  aliases: ['togglepanels'],
  callback: function () {
    toggleSidebar();
    return '';
  },
});
stscriptAddCommand({
  name: 'css-var',
  namedArgumentList: [{ name: 'varname' }, { name: 'to' }],
  callback: function (args, value) {
    var selector = {
      chat: '#chat-messages',
      background: '.bg-layer',
      gallery: '.character-gallery',
      zoomedAvatar: '.avatar-preview',
    }[args.to || 'chat'];
    if (!selector) throw new Error('to 需要 chat、background、gallery 或 zoomedAvatar');
    if (!String(args.varname || '').startsWith('--')) throw new Error('varname 必须以 -- 开头');
    document.querySelectorAll(selector).forEach(function (node) {
      node.style.setProperty(args.varname, stscriptJoin(value));
    });
    return '';
  },
});
stscriptAddCommand({
  name: 'reload-page',
  callback: async function (args) {
    await saveData();
    if (args._abortController) args._abortController.abort('页面正在重新载入', true);
    setTimeout(function () {
      window.location.reload();
    }, 0);
    return '';
  },
});
stscriptAddCommand({
  name: 'bg',
  aliases: ['background'],
  callback: async function (args, value) {
    return selectScriptBackground(stscriptJoin(value));
  },
});
stscriptAddCommand({
  name: 'bglock',
  aliases: ['lockbg'],
  callback: async function () {
    return setScriptBackgroundLock(stscriptChar(), true);
  },
});
stscriptAddCommand({
  name: 'bgunlock',
  aliases: ['unlockbg'],
  callback: async function () {
    return setScriptBackgroundLock(stscriptChar(), false);
  },
});
stscriptAddCommand({
  name: 'theme',
  callback: async function (args, value) {
    return selectScriptTheme(stscriptJoin(value));
  },
});
stscriptAddCommand({
  name: 'bgcol',
  namedArgumentList: [{ name: 'force' }, { name: 'name' }, { name: 'bg' }],
  callback: async function (args) {
    return createScriptBackgroundTheme(args);
  },
});
stscriptAddCommand({
  name: 'show-gallery',
  aliases: ['sg'],
  callback: async function () {
    await openCharacterGallery(stscriptChar(), { wait: false });
    return '';
  },
});
stscriptAddCommand({
  name: 'list-gallery',
  dryRun: 'run',
  aliases: ['lg'],
  namedArgumentList: [{ name: 'char' }, { name: 'group' }],
  callback: async function (args) {
    if (args.group != null) throw new Error('夜欲没有群聊产品能力');
    var char =
      args.char == null
        ? stscriptChar()
        : D.characters.find(function (row) {
            return row.name === args.char || row.id === args.char;
          });
    return JSON.stringify(
      (await characterGalleryItems(char)).map(function (row) {
        return row.src;
      })
    );
  },
});
function scriptPickImage() {
  return new Promise(function (resolve, reject) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.oncancel = function () {
      resolve(null);
    };
    input.onchange = function () {
      var file = input.files[0];
      if (!file) return resolve(null);
      var reader = new FileReader();
      reader.onload = function () {
        resolve({ name: file.name, mime: file.type, data: String(reader.result) });
      };
      reader.onerror = function () {
        reject(reader.error);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
