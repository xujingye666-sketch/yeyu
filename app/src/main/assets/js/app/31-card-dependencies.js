// ===== Character card ecosystem dependency analysis =====
// Pure, local and side-effect free: no DOM, storage, network, script execution or model calls.
// Card scripts are judged by cardScriptStack(), the same executable set 53-regex-scripts.js and
// the regex runtime runs, so the report can never say a script runs that the stack will not
// execute, or call an executable one unsupported. Every other ecosystem component needs either a
// structural extension key or a real call inside a script container; ordinary prose, negations,
// example text and site metadata never produce a runtime dependency on their own.
(function (root) {
  'use strict';
  var object = function (value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };
  var array = function (value) {
    return Array.isArray(value) ? value : [];
  };
  var present = function (value) {
    if (value == null || value === false || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return typeof value === 'string' ? !!value.trim() : true;
  };
  var text = function (value) {
    return typeof value === 'string' ? value : '';
  };
  var copy = function (value) {
    return JSON.parse(JSON.stringify(value));
  };
  var metaExtensionKeys = new Set([
    'aicc-site',
    'chub',
    'depth_prompt',
    'depthprompt',
    'talkativeness',
    'fav',
    'favorite',
    'tavernai',
    'world',
    'creator_notes_multilingual',
    'pngexif',
    'yeyu',
  ]);
  var GROUP_ORDER = ['ready', 'disabled', 'preserved', 'missing'];
  var COMPONENT_ORDER = [
    'st-regex',
    'stscript',
    'quick-reply',
    'mvu-zod',
    'mvu-legacy',
    'card-frontend',
    'tavern-helper',
    'prompt-template',
    'remote-script',
    'remote-frontend',
    'second-model',
    'special-preset',
    'external-worldbook',
    'external-regex',
    'third-party-host-macro',
    'unknown-extension',
  ];
  var labels = {
    'st-regex': 'ST Regex',
    'stscript': 'STScript',
    'quick-reply': '快捷栏',
    'mvu-zod': 'MVU / Zod',
    'mvu-legacy': 'MVU 旧版命令',
    'card-frontend': '卡片前端',
    'tavern-helper': 'TavernHelper',
    'prompt-template': '提示词模板（EJS）',
    'remote-script': '远程脚本',
    'remote-frontend': '远程前端',
    'second-model': '第二模型',
    'special-preset': '专用预设',
    'external-worldbook': '外部世界书',
    'external-regex': '外部正则',
    'third-party-host-macro': '第三方宿主宏',
    'unknown-extension': '未知扩展',
  };
  var impacts = {
    'st-regex': '按卡片规则改写聊天显示、发送内容或世界书正文。',
    'stscript': '依赖 SillyTavern 的 STScript 命令与变量。',
    'quick-reply': '依赖快捷栏集合、按钮或自动触发。',
    'mvu-zod': '依赖 MVU 变量系统与数据校验。',
    'mvu-legacy': '依赖旧版 MVU 的 `_.set` 命令变量。',
    'card-frontend':
      '卡片自带的网页前端会在同源 iframe 里运行，可直接访问夜欲页面与浏览器存储，也可联网加载作者指定的素材与脚本。',
    'tavern-helper': '依赖 TavernHelper 提供的宿主函数和事件。',
    'prompt-template':
      '卡内的 <% %> 模板会在生成和显示时于夜欲主页面内执行，可读写宿主数据与浏览器存储，也可联网；它不受“仅基础内容”或本卡脚本开关控制。',
    'remote-script': '依赖外部 JavaScript；启用的常驻脚本按浏览器原生模块规则加载，其他位置仅报告真实引用。',
    'remote-frontend': '依赖 iframe 或外部页面；已识别的消息、卡片和脚本前端按浏览器规则加载，其他位置仅报告真实引用。',
    'second-model': '作品需要额外模型或第二套 API 路由。',
    'special-preset': '作品要求搭配特定预设或提示配置。',
    'external-worldbook': '卡片引用了没有随卡提供的世界书。',
    'external-regex': '卡片引用了没有随卡提供的正则文件。',
    'third-party-host-macro': '使用了夜欲无法计算的第三方变量宏。',
    'unknown-extension': '扩展材料会随原卡保留，但无法证明其运行方式。',
  };
  // `<%%` is EJS's escaped literal, not a tag.
  var EJS_TEMPLATE = /<%(?!%)[\s\S]*?%>/;
  function rawData(card) {
    var raw = object(card && card.importMeta && card.importMeta.rawCard);
    if (!Object.keys(raw).length) raw = object(card);
    return object(raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw);
  }
  function retiredExtension(key) {
    return /^(?:risu|risuai|risuai_module)$/i.test(String(key));
  }
  function safeKey(key) {
    return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
  }
  function helperMaterialPresent(value) {
    if (Array.isArray(value)) {
      if (value.length === 2 && /^(scripts|variables)$/.test(value[0])) return helperMaterialPresent(value[1]);
      return value.some(helperMaterialPresent);
    }
    if (value && typeof value === 'object')
      return Object.keys(value).some(function (key) {
        return safeKey(key) && helperMaterialPresent(value[key]);
      });
    return present(value);
  }
  function emptyHelperContainer(key, value) {
    return /tavern[_.\- ]?helper/i.test(key) && !helperMaterialPresent(value);
  }
  function joinStrings(value, path, rows, depth) {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') {
      if (value.trim()) rows.push({ path: path, value: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        joinStrings(item, path + '[' + index + ']', rows, depth + 1);
      });
      return;
    }
    if (typeof value === 'object')
      Object.keys(value).forEach(function (key) {
        if (safeKey(key)) joinStrings(value[key], path + '.' + key, rows, depth + 1);
      });
  }
  // Structural evidence: the shape of the card, not its wording.
  function joinKeyPaths(value, path, rows, depth) {
    if (depth > 4 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        joinKeyPaths(item, path + '[]', rows, depth + 1);
      });
      return;
    }
    Object.keys(value).forEach(function (key) {
      if (!safeKey(key) || emptyHelperContainer(key, value[key])) return;
      rows.push(path + '.' + key);
      joinKeyPaths(value[key], path + '.' + key, rows, depth + 1);
    });
  }
  // Protocol evidence is only trusted inside a container that holds executable material.
  // A segment names executable material only at a word boundary: `regex_scripts`, `triggerscript`
  // and `customScripts` qualify, `description` does not.
  var EXECUTABLE_SEGMENT =
    /^[a-z]*scripts?$|^(?:qr|code|codes|effect|effects|command|commands|macro|macros|trigger|triggers|regex|regexes|findregex|replacestring)$|(?:^|[_-])(?:script|scripts|regex|regexes|trigger|triggers|effect|effects|command|commands|macro|macros|code|codes)(?:$|[_-])|quick[_\- ]?(?:repl|response)/i;
  var EXECUTABLE_CAMEL = /[a-z0-9](?:Script|Regex|Trigger|Effect|Command|Macro|Code)/;
  // Even inside a script container, the fields an author writes prose into are still prose.
  var ANNOTATION_SEGMENT =
    /^(?:comment|comments|name|scriptname|title|label|description|desc|note|notes|summary|author|creator|version|id|uid|type|tag|tags)$/i;
  function pathSegments(path) {
    return String(path)
      .split(/[.[\]]+/)
      .filter(Boolean);
  }
  function executablePath(path) {
    return pathSegments(path).some(function (segment) {
      return EXECUTABLE_SEGMENT.test(segment) || EXECUTABLE_CAMEL.test(segment);
    });
  }
  function annotationPath(path) {
    var segments = pathSegments(path);
    return ANNOTATION_SEGMENT.test(segments[segments.length - 1] || '');
  }
  // The markers the report already trusts elsewhere: a real address, a module or markup load, or an
  // executable construct. An unknown `extensions.*` pocket is an open pocket SillyTavern keeps
  // verbatim, so it only becomes a dependency once the card shows one of these or names executable
  // material in a key path; a watermark or a counter is data, not a runtime.
  var RUNTIME_MARKER =
    /\bhttps?:\/\/|<\s*(?:script|iframe)\b|javascript:|\bimport\s*[("'`]|\bimport\s+[^;\n]*?\bfrom\b|\brequire\s*\(|\beval\s*\(|\bnew\s+Function\s*\(|\bfunction\s*[\w$]*\s*\(|=>/i;
  function extensionCarriesRuntime(path, value) {
    var keyPaths = [path],
      rows = [];
    joinKeyPaths(value, path, keyPaths, 1);
    if (
      keyPaths.some(function (row) {
        return executablePath(row);
      })
    )
      return true;
    joinStrings(value, path, rows, 0);
    return rows.some(function (row) {
      return RUNTIME_MARKER.test(row.value);
    });
  }
  // A card may build its address from a template literal, so `${...}` stays part of the address
  // instead of cutting it in half at the closing brace; the backtick itself ends it.
  var URL_TEXT = /\bhttps?:\/\/(?:\$\{[^{}]*\}|[^\s"'`<>)}\]])+/gi;
  function urls(value) {
    var found = [],
      match;
    URL_TEXT.lastIndex = 0;
    while ((match = URL_TEXT.exec(String(value || '')))) {
      var address = match[0].replace(/[.,;:!?]+$/, '');
      if (found.indexOf(address) < 0) found.push(address);
    }
    return found;
  }
  // Only the address the construct itself loads counts; other links in the same block of markup are
  // not what the card depends on. Quoted and template-literal forms must yield the identical string,
  // otherwise the same script is reported twice under different groups.
  var IFRAME_SRC = /<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']*)["']/gi;
  var SCRIPT_SRC =
    /<script\b[^>]*?\bsrc\s*=\s*["']([^"']*)["']|\bimport\s*\(\s*["'`]([^"'`]*)["'`]|\bimport\s+[^;]*?\bfrom\s*["'`]([^"'`]*)["'`]|\bimport\s*["'`]([^"'`]*)["'`]/gi;
  function remoteAddresses(value, pattern) {
    var found = [],
      match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(String(value || '')))) {
      var address = String(match[1] || match[2] || match[3] || match[4] || '').trim();
      if (/^https?:\/\//i.test(address) && found.indexOf(address) < 0) found.push(address);
    }
    return found;
  }
  function host(address) {
    try {
      return new URL(address).host;
    } catch (_) {
      return '';
    }
  }
  function evidence(source, detail, address) {
    var row = { source: String(source || ''), detail: String(detail || '') };
    if (address) {
      row.address = String(address);
      row.host = host(address);
    }
    return row;
  }
  function analyze(card) {
    card = object(card);
    if (typeof root.isRisuCharacter === 'function' && root.isRisuCharacter(card))
      return root.risuDependencyReport(card);
    var data = rawData(card),
      rawExt = object(data.extensions),
      items = new Map();
    function add(id, group, material, runtime, source, detail, address, missing, count) {
      var key = id + '|' + group,
        row = items.get(key);
      if (!row) {
        row = {
          id: id,
          label: labels[id] || id,
          group: group,
          materialStatus: material,
          runtimeStatus: runtime,
          count: 0,
          impact: impacts[id] || '',
          missing: String(missing || ''),
          evidence: [],
          signatures: new Set(),
        };
        items.set(key, row);
      }
      if (!row.missing && missing) row.missing = String(missing);
      // External references are counted per distinct address, so one CDN URL repeated across many
      // scripts stays one reference instead of inflating the count and the evidence list.
      var proof = evidence(source, detail, address),
        signature = address ? '@' + String(address) : JSON.stringify(proof);
      if (row.signatures.has(signature)) return row;
      row.signatures.add(signature);
      row.evidence.push(proof);
      row.count += Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 1;
      return row;
    }
    // ---- the executable truth ----
    var stack = root.cardScriptStack(card),
      scriptsOn = root.cardScriptsEnabled(card) === true,
      runGroup = scriptsOn ? 'ready' : 'disabled',
      runStatus = scriptsOn ? 'supported-enabled' : 'supported-disabled',
      runNote = scriptsOn ? '当前开启' : '本卡脚本当前关闭';
    // regexScriptStaticReason() is the same static gate effectiveRegexScriptRows() applies before a
    // ST script is allowed to run, so an unsafe pattern or a script without a target can never be
    // counted as executable here. An unrecognised macro is not such a gate: SillyTavern keeps the
    // marker verbatim and runs the script, so those entries stay in the runnable group.
    var stRows = array(card.regexScripts).length ? array(card.regexScripts) : array(stack && stack.stScripts),
      stReason = function (row) {
        return String(root.regexScriptStaticReason(row) || '');
      },
      stOff = stRows.filter(function (row) {
        row = object(row);
        return row.enabled === false || row.disabled === true;
      }),
      stBlocked = stRows.filter(function (row) {
        return !(object(row).enabled === false || object(row).disabled === true) && stReason(row);
      }),
      stLive = stRows.length - stOff.length - stBlocked.length;
    if (stLive)
      add(
        'st-regex',
        card.regexEnabled !== false ? 'ready' : 'disabled',
        'embedded-preserved',
        card.regexEnabled !== false ? 'supported-enabled' : 'supported-disabled',
        'extensions.regex_scripts',
        stLive + ' 条随卡正则可执行，' + (card.regexEnabled !== false ? '当前开启' : '本卡正则当前关闭'),
        '',
        '',
        stLive
      );
    if (stOff.length)
      add(
        'st-regex',
        'disabled',
        'embedded-preserved',
        'supported-disabled',
        'extensions.regex_scripts',
        stOff.length + ' 条当前未启用',
        '',
        '',
        stOff.length
      );
    if (stBlocked.length)
      add(
        'st-regex',
        'preserved',
        'embedded-preserved',
        'unsupported',
        'extensions.regex_scripts',
        stBlocked.length + ' 条不满足执行条件：' + Array.from(new Set(stBlocked.map(stReason))).join('；'),
        '',
        '这些条目会随卡保留，但当前不会执行',
        stBlocked.length
      );
    // Prompt Template (EJS) runs in the host page for every ST card, whatever the card's script and
    // regex switches say, so it is reported as runnable. A regex replacement only counts while that
    // regex can actually emit it.
    var templateRows = [];
    [
      'description',
      'personality',
      'scenario',
      'first_mes',
      'mes_example',
      'system_prompt',
      'post_history_instructions',
      'alternate_greetings',
      'character_book',
    ].forEach(function (key) {
      joinStrings(data[key], key, templateRows, 0);
    });
    if (card.regexEnabled !== false)
      stRows.forEach(function (row, index) {
        row = object(row);
        if (row.enabled === false || row.disabled === true || stReason(row)) return;
        joinStrings(row.replaceString, 'regexScripts[' + index + '].replaceString', templateRows, 0);
      });
    templateRows.forEach(function (row) {
      if (!EJS_TEMPLATE.test(row.value)) return;
      add(
        'prompt-template',
        'ready',
        'embedded-preserved',
        'supported-enabled',
        row.path,
        '含提示词模板',
        '',
        '',
        1
      );
    });
    // ---- structural and protocol evidence for the rest of the ecosystem ----
    var structuredRows = [],
      keyPaths = [];
    Object.keys(rawExt).forEach(function (key) {
      if (safeKey(key) && !retiredExtension(key) && !metaExtensionKeys.has(String(key).toLowerCase()))
        joinStrings(rawExt[key], 'extensions.' + key, structuredRows, 0);
    });
    joinStrings(card.regexScripts, 'regexScripts', structuredRows, 0);
    Object.keys(rawExt).forEach(function (key) {
      if (
        safeKey(key) &&
        !retiredExtension(key) &&
        !metaExtensionKeys.has(String(key).toLowerCase()) &&
        !emptyHelperContainer(key, rawExt[key])
      ) {
        keyPaths.push('extensions.' + key);
        joinKeyPaths(rawExt[key], 'extensions.' + key, keyPaths, 1);
      }
    });
    // Two separate channels. A key name is structure and may carry the plain component name; a value
    // only counts when it is a real call or protocol tag inside a script container, never prose, and
    // never one of the fields authors write comments and titles into.
    var keyText = keyPaths.join('\n'),
      callText = structuredRows
        .filter(function (row) {
          return executablePath(row.path) && !annotationPath(row.path);
        })
        .map(function (row) {
          return row.value;
        })
        .join('\n');
    function embedded(id, keyRe, callRe, missing) {
      var byKey = keyRe.test(keyText);
      if (!byKey && !callRe.test(callText)) return;
      add(
        id,
        'preserved',
        'embedded-preserved',
        'unsupported',
        '扩展键或脚本容器',
        byKey ? '检测到随卡结构键' : '检测到脚本容器内的调用特征',
        '',
        '夜欲尚无' + missing,
        1
      );
    }
    function hostReady(id, keyRe, callRe, note) {
      var byKey = keyRe.test(keyText);
      if (!byKey && !callRe.test(callText)) return;
      add(
        id,
        'ready',
        'embedded-preserved',
        'supported-enabled',
        '扩展键或脚本容器',
        byKey ? '检测到随卡结构键' : '检测到脚本容器内的调用特征',
        '',
        note,
        1
      );
    }
    var tagText = array(data.tags).map(String).join(' '),
      protocolText = [
        data.description,
        data.personality,
        data.scenario,
        data.first_mes,
        data.mes_example,
        data.system_prompt,
        data.post_history_instructions,
      ]
        .map(text)
        .join('\n');
    if (
      /(?:^|[,\s])STScript(?:$|[,\s])/i.test(tagText) &&
      /(?:\{\{\s*(?:setvar|getvar)\b|(^|[\s"'])\/(?:let|setvar|if|while|send|trigger|run)\b)/im.test(
        protocolText + callText
      )
    )
      add(
        'stscript',
        'ready',
        'embedded-preserved',
        'supported-enabled',
        'tags + 协议标记',
        '检测到 STScript 标签和命令/变量协议',
        '',
        '夜欲可运行 STScript 核心命令；未实现命令会明确报错',
        1
      );
    else
      hostReady(
        'stscript',
        /\bst[_-]?script\b/i,
        /(?:executeSlashCommands\s*\(|triggerSlash\s*\(|(?:^|[\s"'`(])\/(?:let|setvar|getvar|if|while|send|trigger|run|echo|gen|cut|setinput)\b)/m,
        '夜欲可运行 STScript 核心命令；未实现命令会明确报错'
      );
    hostReady(
      'quick-reply',
      /quick[_\- ]?(?:repl|response)|(?:^|[.[])qr(?:$|[.[])/i,
      /(?:\bqr[._-](?:set|run|execute)\b|(?:^|[\s"'`(])\/qr(?:-set|-run|-create|-edit|-contextadd)?\b|\bQuickReplyApi\b|\bqrApi\.)/,
      '夜欲可导入并运行快捷栏；未绑定的集合不会自动执行'
    );
    // TavernHelper cards carry their script list under either container key; report the real one.
    var libraries = (stack && stack.libraries) || {
        scripts: [],
        active: [],
        disabled: [],
        unsupported: [],
        remotes: [],
      },
      helperSource =
        (libraries.scripts[0] && libraries.scripts[0].source) ||
        (Array.isArray(rawExt.TavernHelper_scripts)
          ? 'extensions.TavernHelper_scripts'
          : 'extensions.tavern_helper.scripts'),
      mvuRows = typeof root.mvuSchemaScripts === 'function' ? root.mvuSchemaScripts(card) : [],
      mvuReady = false,
      mvuUnavailable = '',
      mvuOwner = typeof root.mvuRuntimeOwner === 'function' ? root.mvuRuntimeOwner(card) : '',
      declaredMvuRows =
        typeof root.mvuDeclaredSchemaScripts === 'function' ? root.mvuDeclaredSchemaScripts(card) : mvuRows,
      bundleRows = typeof root.mvuBundleScripts === 'function' ? root.mvuBundleScripts(card) : [];
    if (mvuRows.length && typeof root.mvuPrepareSchemaSource === 'function') {
      try {
        root.mvuPrepareSchemaSource(card);
        mvuReady = true;
      } catch (error) {
        mvuUnavailable = String((error && error.message) || error);
      }
    }
    var mvuOn = typeof root.mvuEnabled === 'function' ? root.mvuEnabled(card) : scriptsOn,
      mvuRunGroup = mvuOn ? 'ready' : 'disabled',
      mvuRunStatus = mvuOn ? 'supported-enabled' : 'supported-disabled',
      mvuRunNote = mvuOn ? '当前开启' : '本卡脚本当前关闭';
    if (mvuOwner === 'bundle') {
      var bundleId = declaredMvuRows.length ? 'mvu-zod' : 'mvu-legacy';
      add(
        bundleId,
        mvuRunGroup,
        'embedded-preserved',
        mvuRunStatus,
        helperSource,
        bundleRows.length + ' 个卡片 MVU bundle，' + mvuRunNote,
        '',
        mvuOn ? '卡片 bundle 已接管宿主 API；夜欲本地引擎已退出' : '开启卡片脚本后由卡片 bundle 接管',
        bundleRows.length
      );
    } else {
      if (mvuReady)
        add(
          'mvu-zod',
          mvuRunGroup,
          'embedded-preserved',
          mvuRunStatus,
          helperSource,
          mvuRows.length + ' 个 Zod 结构脚本，' + mvuRunNote,
          '',
          mvuOn ? '无卡片 bundle，夜欲执行本地 JSONPatch 回放' : '开启卡片脚本后可执行',
          mvuRows.length
        );
      else if (mvuUnavailable)
        add(
          'mvu-zod',
          'preserved',
          'embedded-preserved',
          'unsupported',
          helperSource,
          mvuRows.length + ' 个 Zod 结构脚本',
          '',
          '夜欲本地回放不可用：' + mvuUnavailable,
          mvuRows.length
        );
      else
        embedded(
          'mvu-zod',
          /\bmvu\b|\bzod\b/i,
          /(?:registerMvuSchema\s*\(|<\s*\/?\s*UpdateVariable\b|\bMvu\.\w+\s*\(|\bmvu[_-]zod\b)/i,
          ' MVU / Zod 运行时'
        );
    }
    var libraryOn = typeof root.cardFrontendReady === 'function' && root.cardFrontendReady(card) === true,
      libraryGroup = libraryOn ? 'ready' : runGroup,
      libraryStatus = libraryOn ? 'supported-enabled' : runStatus,
      libraryNote = libraryOn ? '常驻运行中' : '本卡脚本当前关闭',
      libraryUrls = new Set();
    // The library section and the reference scan below must read a script's addresses through the
    // same extractor, or one script lands in two groups at once with a half-extracted address.
    function libraryAddresses(script) {
      return urls(text(object(script).content));
    }
    libraries.active.forEach(function (script) {
      add(
        'tavern-helper',
        libraryGroup,
        'embedded-preserved',
        libraryStatus,
        script.source,
        '脚本库「' + script.name + '」：' + libraryNote,
        '',
        '',
        1
      );
      libraryAddresses(script).forEach(function (address) {
        libraryUrls.add(address);
        add(
          'tavern-helper',
          libraryGroup,
          'embedded-preserved',
          libraryStatus,
          script.source,
          '脚本库「' + script.name + '」加载的远程地址',
          address,
          '',
          0
        );
      });
      if (script.missing.length)
        add(
          'tavern-helper',
          'preserved',
          'embedded-preserved',
          'unsupported',
          script.source,
          '脚本库「' + script.name + '」还调用了未提供的宿主函数：' + script.missing.join('、'),
          '',
          '这些调用会明确报错，对应功能当前无效',
          1
        );
    });
    array(libraries.runtimeRemotes).forEach(function (address) {
      libraryUrls.add(address);
      add(
        'tavern-helper',
        libraryGroup,
        'external-reference',
        libraryStatus,
        '夜欲脚本库运行环境',
        '脚本库运行环境加载的第三方库',
        address,
        '',
        0
      );
    });
    libraries.disabled.forEach(function (script) {
      add(
        'tavern-helper',
        'disabled',
        'embedded-preserved',
        'supported-disabled',
        script.source,
        '脚本库「' + script.name + '」当前未启用',
        '',
        '',
        1
      );
      libraryAddresses(script).forEach(function (address) {
        libraryUrls.add(address);
        add(
          'tavern-helper',
          'disabled',
          'embedded-preserved',
          'supported-disabled',
          script.source,
          '脚本库「' + script.name + '」声明的远程地址',
          address,
          '',
          0
        );
      });
    });
    libraries.unsupported.forEach(function (script) {
      add(
        'tavern-helper',
        'preserved',
        'embedded-preserved',
        'unsupported',
        script.source,
        '条目「' + script.name + '」类型为 ' + script.type + '，不是常驻 script',
        '',
        '非脚本类型会原样保留但不执行',
        1
      );
    });
    // The report names what the same-origin frontend will run and where it will load from.
    var frontends =
        typeof root.cardFrontendScan === 'function'
          ? root.cardFrontendScan(card)
          : { count: 0, remotes: [], runtimeRemotes: [], missing: [], usesParent: false, usesHostInput: false },
      frontendUrls = new Set(frontends.remotes || []);
    if (frontends.count) {
      var frontendOn = typeof root.cardFrontendReady === 'function' && root.cardFrontendReady(card) === true,
        frontendGroup = frontendOn ? 'ready' : runGroup,
        frontendStatus = frontendOn ? 'supported-enabled' : runStatus,
        frontendNote = frontendOn ? '当前开启' : '本卡脚本当前关闭';
      add(
        'card-frontend',
        frontendGroup,
        'embedded-preserved',
        frontendStatus,
        '正则替换内容 / 开场白',
        '检测到 ' +
          frontends.count +
          ' 段带脚本的卡片前端，' +
          frontendNote +
          '；前端与夜欲同源，可直接访问真实宿主页面与浏览器存储',
        '',
        '',
        frontends.count
      );
      frontends.remotes.forEach(function (address) {
        add(
          'card-frontend',
          frontendGroup,
          'embedded-preserved',
          frontendStatus,
          '卡片前端',
          '前端会加载这个外部地址',
          address,
          '',
          0
        );
      });
      array(frontends.runtimeRemotes).forEach(function (address) {
        add(
          'card-frontend',
          frontendGroup,
          'external-reference',
          frontendStatus,
          '夜欲消息前端运行环境',
          '消息前端运行环境加载的第三方库',
          address,
          '',
          0
        );
      });
      if (frontends.missing.length)
        add(
          'card-frontend',
          'preserved',
          'embedded-preserved',
          'unsupported',
          '卡片前端',
          '前端还调用了本期未提供的宿主函数：' + frontends.missing.join('、'),
          '',
          '这些调用会明确报错，对应功能当前无效',
          1
        );
      if (frontends.usesHostInput)
        add(
          'card-frontend',
          frontendGroup,
          'embedded-preserved',
          frontendStatus,
          '卡片前端',
          '前端会通过真实宿主的 textarea / send_textarea / send_but 操作输入区',
          '',
          '与酒馆助手相同，脚本可直接操作宿主 DOM',
          1
        );
      if (frontends.usesParent)
        add(
          'card-frontend',
          frontendGroup,
          'embedded-preserved',
          frontendStatus,
          '卡片前端',
          '前端会通过 window.parent 直接访问宿主页面',
          '',
          '与酒馆助手相同，脚本获得完整同源父窗口',
          1
        );
    }
    if (!libraries.scripts.length && !libraries.unsupported.length) {
      var helperByKey = /tavern[_.\- ]?helper/i.test(keyText),
        helperByCall =
          /(?:\bTavernHelper\s*[.[(]|\b(?:window|parent)\.TavernHelper\b|insertOrAssignVariables\s*\(|getChatMessages\s*\(|eventSource\.(?:on|emit)\s*\(|substitudeMacros\s*\()/.test(
            callText
          );
      if (helperByKey || helperByCall)
        add(
          'tavern-helper',
          runGroup,
          'embedded-preserved',
          runStatus,
          '扩展键或脚本容器',
          (helperByKey ? '检测到随卡结构材料，' : '检测到脚本容器内的调用特征，') + runNote,
          '',
          '夜欲提供 TavernHelper 宿主函数；仅已识别的卡片前端和常驻脚本会启动，未提供的函数会明确报错',
          1
        );
    }
    embedded(
      'second-model',
      /second[_.\- ]?(?:api|model)|\bsubmodel\b|\botherax\b|\baxllm\b/i,
      /(?:\bsecond[_.]?(?:Api|API|Model)\b|\bsubmodel\b|\botherax\b|\baxllm\b)/,
      '第二模型路由'
    );
    Object.keys(rawExt).forEach(function (key) {
      var lower = String(key).toLowerCase();
      if (!safeKey(key) || metaExtensionKeys.has(lower) || !/preset/.test(lower) || !present(rawExt[key])) return;
      add(
        'special-preset',
        'missing',
        'external-reference',
        'missing-companion',
        'extensions.' + key,
        '检测到专用预设配置键',
        '',
        '对应预设需由用户另行准备和选择',
        1
      );
    });
    // ---- external references: real markup and real addresses only ----
    var markupRows = [];
    ['first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes'].forEach(function (key) {
      joinStrings(data[key], key, markupRows, 0);
    });
    joinStrings(data.alternate_greetings, 'alternate_greetings', markupRows, 0);
    joinStrings(data.character_book, 'character_book', markupRows, 0);
    // A TavernHelper script's content belongs to the library section above, which reports it and its
    // remote addresses whether or not it runs. Scanning it again here only adds what that section
    // rightly leaves out: a module path that is no remote address (`./x.js`, `import(name)`) would
    // show up as a missing remote script with an empty address. Non-script entries are not reported
    // with their addresses there, so they stay in this scan.
    var libraryContents = new Set(
        libraries.scripts.map(function (script) {
          return text(object(script).content);
        })
      ),
      referenceRows = structuredRows
        .filter(function (row) {
          return !libraryContents.has(row.value);
        })
        .concat(markupRows);
    referenceRows.forEach(function (row) {
      var value = row.value,
        found,
        runtimeFrontend =
          typeof root.cardFrontendSegments === 'function' && root.cardFrontendSegments(value).length > 0;
      if (!runtimeFrontend && /<iframe\b/i.test(value)) {
        found = remoteAddresses(value, IFRAME_SRC).filter(function (address) {
          return !frontendUrls.has(address) && !libraryUrls.has(address);
        });
        (found.length ? found : remoteAddresses(value, IFRAME_SRC).length ? [] : ['']).forEach(function (address) {
          add(
            'remote-frontend',
            'missing',
            'external-reference',
            'missing-capability',
            row.path,
            '检测到 iframe 或远程页面引用',
            address,
            '该位置不属于夜欲会启动的消息、卡片或脚本前端',
            1
          );
        });
      }
      if (
        !runtimeFrontend &&
        /<script\b[^>]*\bsrc\s*=|\bimport\s*\(|\bimport\s+(?:[^;]+\s+from\s+)?['"]https?:|javascript:/i.test(value)
      ) {
        found = remoteAddresses(value, SCRIPT_SRC).filter(function (address) {
          return (
            !frontendUrls.has(address) &&
            !libraryUrls.has(address) &&
            !(
              mvuReady &&
              /^https:\/\/testingcf\.jsdelivr\.net\/gh\/StageDog\/tavern_resource\/dist\/util\/mvu_zod\.js$/i.test(
                address
              ) &&
              /\bregisterMvuSchema\s*\(/.test(value)
            )
          );
        });
        (found.length ? found : remoteAddresses(value, SCRIPT_SRC).length ? [] : ['']).forEach(function (address) {
          add(
            'remote-script',
            'missing',
            'external-reference',
            'missing-capability',
            row.path,
            '检测到远程脚本或 import 引用',
            address,
            '该位置不属于启用的常驻脚本或卡片前端',
            1
          );
        });
      }
      if (!runtimeFrontend && /(?:regexScripts|regex_scripts)/i.test(row.path)) {
        urls(value)
          .filter(function (address) {
            return !frontendUrls.has(address) && /(?:\.html?(?:[?#]|$)|\.github\.io(?:\/|$))/i.test(address);
          })
          .forEach(function (address) {
            add(
              'remote-frontend',
              'missing',
              'external-reference',
              'missing-capability',
              row.path,
              '检测到正则生成的远程页面',
              address,
              '这段替换内容不是酒馆助手会识别的完整网页',
              1
            );
          });
      }
    });
    var noteRows = [];
    joinStrings(data.creator_notes, 'creator_notes', noteRows, 0);
    joinStrings(data.source, 'source', noteRows, 0);
    // A note only counts when it carries an address that itself names the companion material;
    // a sentence that merely mentions a plugin proves nothing.
    function noteCompanion(row, id, phrase, addressPattern, detail, missing) {
      if (!phrase.test(row.value)) return;
      var address = urls(row.value).filter(function (url) {
        return addressPattern.test(url);
      })[0];
      if (address) add(id, 'missing', 'external-reference', 'missing-companion', row.path, detail, address, missing, 1);
    }
    noteRows.forEach(function (row) {
      noteCompanion(
        row,
        'quick-reply',
        /(?:quick[\s_-]?(?:repl(?:y|ies)|response)|快速回复)/i,
        /quick[\s_-]?repl|quick[\s_-]?response|[/#_-]qr\b/i,
        '作者说明指向外部快捷栏配套',
        '快捷栏配套未随卡提供'
      );
      noteCompanion(
        row,
        'external-worldbook',
        /(?:lorebook|world[\s_-]?info|世界书)/i,
        /lorebook|world[_-]?info|worldbook/i,
        '作者说明指向外部世界书文件',
        '引用材料未随卡提供'
      );
      noteCompanion(
        row,
        'external-regex',
        /(?:regex|正则)/i,
        /regex/i,
        '作者说明指向外部正则文件',
        '引用材料未随卡提供'
      );
    });
    array(object(rawExt.chub).related_lorebooks).forEach(function (value) {
      var entry = object(value),
        path = String(typeof value === 'string' ? value : entry.path || ''),
        id = Number(entry.id),
        address = urls(typeof value === 'string' ? value : JSON.stringify(value))[0] || '';
      if (!path || path.toLowerCase() === 'embedded') return;
      if (typeof value !== 'string' && !(id > 0)) return;
      add(
        'external-worldbook',
        'missing',
        'external-reference',
        'missing-companion',
        'extensions.chub.related_lorebooks',
        '检测到外部世界书引用',
        address || path,
        '外部世界书未随卡提供',
        1
      );
    });
    structuredRows.forEach(function (row) {
      var lower = row.path.toLowerCase(),
        id = /(?:related|external|required)[_.-]?(?:regex|regexes)|regex[_.-]?(?:files|url)/i.test(lower)
          ? 'external-regex'
          : /(?:related|external|required)[_.-]?(?:lorebook|worldbook|world_info)|(?:lorebook|worldbook)[_.-]?(?:files|url)/i.test(
                lower
              )
            ? 'external-worldbook'
            : '';
      if (!id || !present(row.value)) return;
      add(
        id,
        'missing',
        'external-reference',
        'missing-companion',
        row.path,
        '检测到外部' + (id === 'external-regex' ? '正则' : '世界书') + '配套引用',
        urls(row.value)[0] || '',
        '引用材料未随卡提供',
        1
      );
    });
    var macroNames = {};
    stRows.forEach(function (script) {
      var replacement = String(object(script).replaceString || object(script).replacement || ''),
        match,
        re = /\{\{\s*(get_message_variable|timeweather|roleidentity)\b/gi;
      while ((match = re.exec(replacement))) macroNames[match[1].toLowerCase()] = true;
    });
    if (Object.keys(macroNames).length)
      add(
        'third-party-host-macro',
        'preserved',
        'embedded-preserved',
        'unsupported',
        'regexScripts.replaceString',
        Object.keys(macroNames).join('、'),
        '',
        '夜欲缺少这些第三方宿主变量',
        1
      );
    var knownTop = new Set([
      'regex_scripts',
      'tavern_helper',
      'tavernhelper',
      'tavernhelper_scripts',
      'mvu',
      'zod',
      'quick_reply',
      'quickreply',
      'quick-response-force',
      'stscript',
      'st_script',
    ]);
    Object.keys(rawExt).forEach(function (key) {
      var lower = String(key).toLowerCase(),
        value = rawExt[key];
      if (
        !safeKey(key) ||
        !present(value) ||
        metaExtensionKeys.has(lower) ||
        knownTop.has(lower) ||
        /(?:tavern.?helper|quick.?reply|quick.?response|mvu|zod|st.?script)/i.test(lower) ||
        // Same rule the TavernHelper container follows: a container with no value anywhere is not a
        // dependency, and neither is a pocket that holds nothing executable.
        !helperMaterialPresent(value) ||
        !extensionCarriesRuntime('extensions.' + key, value)
      )
        return;
      add(
        'unknown-extension',
        'preserved',
        'embedded-preserved',
        'unknown',
        'extensions.' + key,
        '未知扩展 “' + key + '” 已保留',
        '',
        '无法证明其所需宿主或运行方式',
        1
      );
    });
    var rows = Array.from(items.values())
      .filter(function (row) {
        return row.count > 0;
      })
      .map(function (row) {
        delete row.signatures;
        return row;
      });
    rows.sort(function (a, b) {
      return (
        COMPONENT_ORDER.indexOf(a.id) - COMPONENT_ORDER.indexOf(b.id) ||
        GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
      );
    });
    var storedMode = String(object(object(card.extensions).yeyu).componentImportMode || ''),
      counts = {};
    GROUP_ORDER.forEach(function (group) {
      counts[group] = rows.filter(function (row) {
        return row.group === group;
      }).length;
    });
    return {
      version: 2,
      items: copy(rows),
      counts: counts,
      mode: storedMode === 'basic' || storedMode === 'full' ? storedMode : 'legacy',
    };
  }
  root.YeyuCardDependencies = Object.freeze({
    analyze: analyze,
    labels: Object.freeze(copy(labels)),
    groups: Object.freeze(GROUP_ORDER.slice()),
  });
  root.analyzeCardDependencies = analyze;
})(typeof window !== 'undefined' ? window : globalThis);
