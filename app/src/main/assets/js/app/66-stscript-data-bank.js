// ===== Data Bank commands and attachment manager =====
function stscriptDataBankContext() {
  return dataBankContext(stscriptChar(), stscriptSess());
}
function stscriptDataBankSource(value, fallback) {
  return ['global', 'chat', 'character'].includes(value) ? value : fallback;
}
function stscriptDataBankCommand(action, names, callback, dryRun) {
  stscriptAddCommand({
    name: 'db' + action,
    aliases: ['databank' + action, 'data-bank' + action],
    dryRun: dryRun,
    namedArgumentList: names.map(function (name) {
      return { name: name };
    }),
    callback: callback,
  });
}
stscriptDataBankCommand('', [], function (args) {
  openDataBank(stscriptDataBankContext(), args._abortController);
  return '';
});
stscriptDataBankCommand(
  '-list',
  ['source', 'field'],
  function (args) {
    return JSON.stringify(
      dataBankRows(stscriptDataBankContext(), stscriptDataBankSource(args.source, ''), true).map(function (row) {
        return row.file[args.field === 'name' ? 'name' : 'url'];
      })
    );
  },
  'run'
);
stscriptDataBankCommand(
  '-get',
  ['source'],
  async function (args, value) {
    var row = dataBankFind(
      dataBankRows(stscriptDataBankContext(), stscriptDataBankSource(args.source, ''), true),
      value
    );
    if (row) return dataBankText(row.file);
    return stscriptDryRunning(args) ? '' : dataBankMissing(value);
  },
  'run'
);
stscriptDataBankCommand('-add', ['source', 'name'], function (args, value) {
  return dataBankAdd(stscriptDataBankContext(), stscriptDataBankSource(args.source, 'chat'), args.name, value);
});
stscriptDataBankCommand('-update', ['source', 'url', 'name'], function (args, value) {
  return dataBankUpdate(
    stscriptDataBankContext(),
    stscriptDataBankSource(args.source, 'chat'),
    [args.url, args.name].filter(Boolean),
    value
  );
});
stscriptDataBankCommand('-delete', ['source'], function (args, value) {
  return dataBankDelete(stscriptDataBankContext(), stscriptDataBankSource(args.source, 'chat'), value);
});
['disable', 'enable'].forEach(function (action) {
  stscriptDataBankCommand('-' + action, ['source'], function (args, value) {
    return dataBankSetDisabled(
      stscriptDataBankContext(),
      stscriptDataBankSource(args.source, ''),
      value,
      action === 'disable'
    );
  });
});
stscriptDataBankCommand(
  '-ingest',
  [],
  async function (args) {
    await dataBankIngest(stscriptDataBankContext(), '', { abortController: args._abortController });
    return '';
  },
  'network'
);
stscriptDataBankCommand('-purge', [], function () {
  return dataBankPurge(stscriptDataBankContext());
});
stscriptDataBankCommand(
  '-search',
  ['source', 'return', 'count', 'threshold'],
  async function (args, query) {
    var result = await dataBankSearch(stscriptDataBankContext(), String(args.source || ''), query, {
        count: args.count,
        threshold: args.threshold,
        abortController: args._abortController,
      }),
      mode = args.return || 'object',
      text = result.urls.join('\n');
    if (mode === 'chunks') return result.chunks;
    if (mode === 'object') return JSON.stringify(result.urls);
    if (mode === 'pipe') return text;
    if (mode === 'console') {
      console.info(result.urls);
      return '';
    }
    if (mode !== 'none' && !/^(chat|popup|toast)-(html|text)$/.test(mode)) throw new Error('未知返回方式：' + mode);
    return stscriptPromptReturn(mode.replace(/-text$/, '-html'), result.urls, {
      text: text,
      html: '<pre>' + esc(text) + '</pre>',
      title: '资料库检索结果',
    });
  },
  'network'
);
stscriptAddCommand({
  name: 'vector-files-state',
  dryRun: stscriptDryRunReadIfBlank,
  callback: async function (args, value) {
    if (String(value == null ? '' : value).trim()) await dataBankSaveSettings({}, stscriptIsTrue(String(value).trim()));
    return String(dataBankSettings().enabled);
  },
});
function dataBankDialogController(controller) {
  return (
    controller && {
      onAbort: function (handler) {
        if (controller.signal.aborted) queueMicrotask(handler);
        else controller.signal.addEventListener('abort', handler, { once: true });
      },
      offAbort: function (handler) {
        controller.signal.removeEventListener('abort', handler);
      },
    }
  );
}
async function dataBankEditDialog(context, source, file, controller) {
  var form = document.createElement('div');
  form.innerHTML =
    '<div class="fg"><label>附件名称<input data-bank-name></label></div><div class="fg"><label>文本内容<textarea data-bank-text rows="14"></textarea></label></div>';
  var name = form.querySelector('input'),
    text = form.querySelector('textarea');
  name.value = file ? file.name : '';
  name.disabled = !!file;
  text.value = file ? await dataBankText(file) : '';
  if (controller && controller.signal.aborted) throw vectorRetrievalAbortError();
  var result = await scriptDialog(
    file ? '编辑附件' : '新建文本附件',
    form,
    [
      { label: '取消', value: false },
      { label: '保存', value: true },
    ],
    { wide: true, abortController: dataBankDialogController(controller) }
  );
  if (controller && controller.signal.aborted) throw vectorRetrievalAbortError();
  if (!result) return;
  if (file) await dataBankUpdate(context, source, [file.url], text.value);
  else await dataBankAdd(context, source, name.value, text.value);
}
function openDataBank(context, abortController) {
  context = context || dataBankCurrent();
  var root = document.createElement('div'),
    running = null,
    closed = false;
  root.className = 'data-bank-manager';
  root.innerHTML =
    '<div class="fg-row"><div class="fg"><label>附件归属<select data-bank-source><option value="global">全局</option><option value="chat">当前对话</option><option value="character">当前角色</option></select></label></div><div class="fg"><label>筛选名称<input data-bank-filter type="search"></label></div></div>' +
    '<div class="fg-row"><button class="btn" data-bank-add>新建文本</button><button class="btn" data-bank-upload>导入文件</button></div><input data-bank-files type="file" multiple hidden accept=".txt,.md,.markdown,.json,.csv,.xml,.html,.htm,.pdf,.epub"><div data-bank-list></div>' +
    '<details><summary>检索设置</summary><div class="fg"><label><input type="checkbox" data-bank-enabled> 生成时检索附件</label></div><p class="hint">使用设置中的嵌入接口。只发送检索命中的片段。</p><div data-bank-fields></div>' +
    '<div class="fg"><label><input type="checkbox" data-bank-setting="shouldScan"> 片段参与世界书扫描</label></div><button class="btn" data-bank-save>保存检索设置</button></details>' +
    '<div class="fg"><label>检索内容<input data-bank-query></label></div><div class="fg-row"><button class="btn" data-bank-search>检索</button><button class="btn" data-bank-ingest>建立索引</button><button class="btn" data-bank-purge>清除索引</button><button class="btn" data-bank-stop hidden>停止</button></div><p data-bank-status role="status"></p><pre data-bank-result style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>';
  var fields = root.querySelector('[data-bank-fields]');
  [
    ['sizeThreshold', '分块阈值（KB）', 0],
    ['chunkSize', '每块字符数', 1],
    ['chunkCount', '最多片段数', 1],
    ['overlap', '重叠比例（%）', 0, 99],
    ['depth', '聊天深度', 0, 100],
  ].forEach(function (row) {
    var field = document.createElement('div');
    field.className = 'fg';
    field.innerHTML =
      '<label>' +
      row[1] +
      '<input type="number" data-bank-setting="' +
      row[0] +
      '" min="' +
      row[2] +
      '"' +
      (row[3] == null ? '' : ' max="' + row[3] + '"') +
      '></label>';
    fields.append(field);
  });
  fields.insertAdjacentHTML(
    'beforeend',
    '<div class="fg"><label>注入位置<select data-bank-setting="position"><option value="before_prompt">主提示词前</option><option value="in_prompt">主提示词后</option><option value="in_chat">聊天中</option><option value="none">不注入</option></select></label></div><div class="fg"><label>消息角色<select data-bank-setting="role"><option value="system">系统</option><option value="user">用户</option><option value="assistant">助手</option></select></label></div><div class="fg"><label>片段模板<textarea data-bank-setting="template" rows="3"></textarea></label><div class="hint">{{text}} 替换为命中片段；相似度阈值使用世界书的向量检索设置。</div></div>'
  );
  var source = root.querySelector('[data-bank-source]'),
    list = root.querySelector('[data-bank-list]'),
    status = root.querySelector('[data-bank-status]'),
    result = root.querySelector('[data-bank-result]');
  source.value = context.session ? 'chat' : context.char ? 'character' : 'global';
  Array.from(source.options).forEach(function (option) {
    option.disabled = option.value === 'chat' ? !context.session : option.value === 'character' ? !context.char : false;
  });
  function settings() {
    var values = dataBankSettings();
    root.querySelector('[data-bank-enabled]').checked = values.enabled;
    root.querySelectorAll('[data-bank-setting]').forEach(function (input) {
      if (input.type === 'checkbox') input.checked = values[input.dataset.bankSetting];
      else input.value = values[input.dataset.bankSetting];
    });
  }
  async function work(action) {
    if (running || closed) return;
    running = new AbortController();
    var controller = running;
    root.querySelector('[data-bank-stop]').hidden = false;
    root.querySelectorAll('button:not([data-bank-stop])').forEach(function (button) {
      button.disabled = true;
    });
    status.textContent = '处理中…';
    try {
      await action(controller);
      if (!closed) {
        status.textContent = '已完成';
        render();
      }
    } catch (error) {
      if (!closed) status.textContent = error.name === 'AbortError' ? '已停止' : String(error.message || error);
    } finally {
      if (running === controller) running = null;
      root.querySelector('[data-bank-stop]').hidden = true;
      root.querySelectorAll('button:not([data-bank-stop])').forEach(function (button) {
        button.disabled = false;
      });
    }
  }
  function render() {
    list.replaceChildren();
    var filter = root.querySelector('[data-bank-filter]').value.toLowerCase(),
      rows = dataBankRows(context, source.value, true).filter(function (row) {
        return row.file.name.toLowerCase().includes(filter);
      });
    if (!rows.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '没有附件';
      list.append(empty);
    }
    rows.forEach(function (row) {
      var box = document.createElement('div');
      box.className = 'fg';
      var title = document.createElement('strong');
      title.textContent = row.file.name;
      var info = document.createElement('div');
      info.className = 'hint';
      info.textContent = (row.file.disabled ? '已停用 · ' : '') + row.file.size + ' 字节';
      var actions = document.createElement('div');
      actions.className = 'fg-row';
      function button(label, action) {
        var btn = document.createElement('button');
        btn.className = label === '删除' ? 'btn danger' : 'btn';
        btn.textContent = label;
        btn.onclick = function () {
          work(action);
        };
        actions.append(btn);
      }
      button(row.file.disabled ? '启用' : '停用', function () {
        return dataBankSetDisabled(context, row.source, row.file.url, !row.file.disabled);
      });
      button('编辑', function (controller) {
        return dataBankEditDialog(context, row.source, row.file, controller);
      });
      button('删除', async function (controller) {
        var confirmed = await scriptDialog(
          '删除附件',
          '<p>删除“' + esc(row.file.name) + '”？</p>',
          [
            { label: '取消', value: false },
            { label: '删除', value: true },
          ],
          { abortController: dataBankDialogController(controller) }
        );
        if (controller.signal.aborted) throw vectorRetrievalAbortError();
        if (confirmed) await dataBankDelete(context, row.source, row.file.url);
      });
      box.append(title, info, actions);
      list.append(box);
    });
  }
  source.onchange = render;
  root.querySelector('[data-bank-filter]').oninput = render;
  root.querySelector('[data-bank-add]').onclick = function () {
    var scope = source.value;
    work(function (controller) {
      return dataBankEditDialog(context, scope, null, controller);
    });
  };
  var files = root.querySelector('[data-bank-files]');
  root.querySelector('[data-bank-upload]').onclick = function () {
    if (!running) files.click();
  };
  files.onchange = function () {
    var selected = Array.from(files.files),
      scope = source.value;
    files.value = '';
    work(async function (controller) {
      for (var file of selected) {
        var text = await dataBankExtractFile(file);
        if (controller.signal.aborted) throw vectorRetrievalAbortError();
        await dataBankAdd(context, scope, file.name, text);
      }
    });
  };
  root.querySelector('[data-bank-save]').onclick = function () {
    work(async function () {
      var patch = {};
      root.querySelectorAll('[data-bank-setting]').forEach(function (input) {
        patch[input.dataset.bankSetting] =
          input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      });
      await dataBankSaveSettings(patch, root.querySelector('[data-bank-enabled]').checked);
      settings();
    });
  };
  root.querySelector('[data-bank-search]').onclick = function () {
    var query = root.querySelector('[data-bank-query]').value,
      scope = source.value;
    work(async function (controller) {
      var hits = await dataBankSearch(context, scope, query, { controller: controller });
      result.textContent = hits.chunks || '没有找到相关片段';
    });
  };
  root.querySelector('[data-bank-ingest]').onclick = function () {
    work(function (controller) {
      return dataBankIngest(context, '', { controller: controller });
    });
  };
  root.querySelector('[data-bank-purge]').onclick = function () {
    work(function () {
      return dataBankPurge(context);
    });
  };
  root.querySelector('[data-bank-stop]').onclick = function () {
    if (running) running.abort();
  };
  settings();
  render();
  return scriptDialog('附件资料库', root, [{ label: '关闭', value: true }], {
    wide: true,
    large: true,
    abortController: abortController,
  }).finally(function () {
    closed = true;
    if (running) running.abort();
  });
}
