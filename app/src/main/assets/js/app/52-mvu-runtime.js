// ===== MVU state ownership: card bundle or local Zod replay fallback =====
// Behavioral baseline: MagVarUpdate beta@0a730cd4 and its message/swipe-bound state model.
// A bundle and a Zod registration may coexist as card scripts, but only the bundle writes state.
var MVU_STATE_VERSION = 1,
  MVU_SCHEMA_IMPORT_RE =
    /^\s*import\s+[^\r\n]*?\s+from\s+(['"])(https:\/\/testingcf\.jsdelivr\.net\/gh\/StageDog\/tavern_resource\/dist\/util\/mvu_zod\.js)\1\s*;?\s*$/gm,
  MVU_REMOTE_IMPORT_RE = /\bimport\s*(?:\(\s*)?(?:[^'"\r\n;]*?\s+from\s*)?(['"])(https?:\/\/[^'"]+)\1\s*\)?/gim,
  MVU_ZOD_CALL_RE = /\bregisterMvuSchema\s*\(/,
  _mvuWorkers = Object.create(null),
  _mvuWorkerSeq = 0,
  _mvuRuntime = Object.create(null),
  // A preview's runtime state, kept on the cloned session it was built for.
  _mvuPreviewRuntime = new WeakMap(),
  _mvuRuns = Object.create(null);

function mvuHash(value) {
  var text = String(value == null ? '' : value),
    hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function mvuScriptRows(char) {
  if (isRisuCharacter(char)) return [];
  return cardScriptTavernHelperRows(char)
    .map(function (row) {
      return { id: row.id, name: row.name, enabled: row.enabled, content: row.content, data: row.data, raw: row.raw };
    })
    .filter(function (row) {
      return row.enabled;
    });
}
function mvuRemoteImportAddresses(source) {
  var rows = [],
    text = String(source || ''),
    masked = mvuTypescriptCodeMask(text),
    match;
  MVU_REMOTE_IMPORT_RE.lastIndex = 0;
  while ((match = MVU_REMOTE_IMPORT_RE.exec(text))) {
    if (masked.slice(match.index, match.index + 6) !== 'import') continue;
    var address = String(match[2] || '');
    if (address && rows.indexOf(address) < 0) rows.push(address);
  }
  return rows;
}
function mvuBundleAddress(address) {
  try {
    var path = new URL(String(address || '')).pathname;
    return (
      /\/MagicalAstrogy\/MagVarUpdate(?:@[^/]+)?\/(?:artifact|dist)\/bundle(?:\.min)?\.js$/i.test(path) ||
      /\/NLKASHEI\/MVU-offline(?:@[^/]+)?\/mvu_bundle_full(?:\.min)?\.js$/i.test(path)
    );
  } catch (_) {
    return false;
  }
}
function mvuBundleScripts(char) {
  return mvuScriptRows(char).filter(function (row) {
    return mvuRemoteImportAddresses(row.content).some(mvuBundleAddress);
  });
}
function mvuDeclaredSchemaScripts(char) {
  return mvuScriptRows(char).filter(function (row) {
    return mvuHasSchemaRegistration(row.content);
  });
}
// A card-owned bundle is the real host API consumer. Only a schema card without any bundle falls
// back to the local replay engine, so the two implementations can never write the same state.
function mvuSchemaScripts(char) {
  return mvuBundleScripts(char).length ? [] : mvuDeclaredSchemaScripts(char);
}
function mvuProtocolScripts(char) {
  return mvuSchemaScripts(char);
}
function mvuRuntimeOwner(char) {
  return mvuBundleScripts(char).length ? 'bundle' : mvuSchemaScripts(char).length ? 'local' : '';
}
function mvuDialect(char) {
  return mvuDeclaredSchemaScripts(char).length ? 'zod' : mvuBundleScripts(char).length ? 'legacy' : '';
}
// Every mvuScriptRows() call re-reads and deep-clones the card's whole script library, so the owner
// and both script sets are derived from a single pass here instead of six separate ones.
function mvuSchemaScriptSignature(char) {
  var all = mvuScriptRows(char),
    bundle = all.filter(function (row) {
      return mvuRemoteImportAddresses(row.content).some(mvuBundleAddress);
    }),
    declared = all.filter(function (row) {
      return mvuHasSchemaRegistration(row.content);
    }),
    owner = bundle.length ? 'bundle' : declared.length ? 'local' : '',
    rows = bundle.length ? bundle.concat(declared) : declared;
  return (
    owner +
    ':' +
    rows
      .map(function (row) {
        return row.id + ':' + mvuHash(row.content);
      })
      .join('|')
  );
}
function mvuHasSchema(char) {
  return mvuRuntimeOwner(char) !== '';
}
function mvuEnabled(char) {
  return !!(char && mvuHasSchema(char) && char.scriptsEnabled !== false);
}
function mvuCanRun(char) {
  return mvuEnabled(char) && mvuRuntimeOwner(char) === 'local';
}
function mvuSchemaSourceCompiles(source) {
  try {
    var probe = String(source || '')
      .replace(/\bimport\s+(?:(?:[^'"\r\n;]+?\s+from\s+)?(['"])[^'"\r\n]+\1)\s*;?/gm, '')
      .replace(/^\s*export\s+default\s+/gm, '')
      .replace(/^\s*export\s+(?=(?:const|let|var|function|class|async\s+function)\b)/gm, '')
      .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
    if (/^\s*(?:import|export)\b/m.test(probe)) return false;
    new Function(
      'registerMvuSchema',
      'z',
      '_',
      '$',
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'importScripts',
      'postMessage',
      'close',
      'self',
      'globalThis',
      'window',
      'document',
      'AndroidBridge',
      '"use strict";\n' + probe + '\n'
    );
    return true;
  } catch (error) {
    if (error && error.name === 'SyntaxError') return false;
    throw error;
  }
}
// Type erasure only edits lexical code. Quoted text, templates, comments, and regex literals stay byte-for-byte intact.
function mvuTypescriptCodeMask(source) {
  var text = String(source || ''),
    masked = text.split(''),
    templates = [];
  function blank(start, end) {
    for (var at = start; at < end; at++) if (masked[at] !== '\r' && masked[at] !== '\n') masked[at] = ' ';
  }
  function regexCanStart(index) {
    var at = index - 1;
    while (at >= 0 && /\s/.test(text[at])) at--;
    if (at < 0) return true;
    var previous = text[at];
    if (/[([{=,:;!?&|+\-*%^~<>]/.test(previous)) return true;
    if (!/[A-Za-z_$]/.test(previous)) return false;
    var end = at + 1;
    while (at >= 0 && /[\w$]/.test(text[at])) at--;
    return /^(?:return|case|throw|else|do|typeof|instanceof|in|of|yield|await|void|delete)$/.test(
      text.slice(at + 1, end)
    );
  }
  function templateEnd(start) {
    for (var end = start + 1; end < text.length; end++) {
      if (text[end] === '\\') {
        end++;
        continue;
      }
      if (text[end] === '`') {
        blank(start, end + 1);
        return end;
      }
      if (text[end] === '$' && text[end + 1] === '{') {
        blank(start, end + 2);
        templates.push(0);
        return end + 1;
      }
    }
    blank(start, text.length);
    return text.length;
  }
  for (var index = 0; index < text.length; index++) {
    var char = text[index],
      next = text[index + 1];
    if (char === '`') {
      index = templateEnd(index);
      continue;
    }
    if (templates.length && char === '{') templates[templates.length - 1]++;
    if (templates.length && char === '}') {
      if (templates[templates.length - 1] > 0) templates[templates.length - 1]--;
      else {
        templates.pop();
        index = templateEnd(index);
        continue;
      }
    }
    if (char === '"' || char === "'") {
      var quote = char,
        end = index + 1;
      for (; end < text.length; end++) {
        if (text[end] === '\\') {
          end++;
          continue;
        }
        if (text[end] === quote) {
          end++;
          break;
        }
        if (text[end] === '\r' || text[end] === '\n') break;
      }
      blank(index, end);
      index = end - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      var line = index + 2;
      while (line < text.length && text[line] !== '\r' && text[line] !== '\n') line++;
      blank(index, line);
      index = line - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      var block = text.indexOf('*/', index + 2),
        blockEnd = block < 0 ? text.length : block + 2;
      blank(index, blockEnd);
      index = blockEnd - 1;
      continue;
    }
    if (char === '/' && next !== '=' && regexCanStart(index)) {
      var cursor = index + 1,
        inClass = false,
        closed = false;
      for (; cursor < text.length; cursor++) {
        if (text[cursor] === '\\') {
          cursor++;
          continue;
        }
        if (text[cursor] === '[') inClass = true;
        else if (text[cursor] === ']') inClass = false;
        else if (text[cursor] === '/' && !inClass) {
          cursor++;
          while (cursor < text.length && /[A-Za-z]/.test(text[cursor])) cursor++;
          closed = true;
          break;
        } else if (text[cursor] === '\r' || text[cursor] === '\n') break;
      }
      if (closed) {
        blank(index, cursor);
        index = cursor - 1;
      }
    }
  }
  return masked.join('');
}
function mvuHasSchemaRegistration(source) {
  return MVU_ZOD_CALL_RE.test(mvuTypescriptCodeMask(source));
}
function mvuEraseTypescriptTypeImports(source) {
  var text = String(source || ''),
    masked = mvuTypescriptCodeMask(text),
    pattern = /^\s*import\s+type\b[^\r\n]*(?:\r?\n|$)/gm,
    ranges = [],
    match;
  while ((match = pattern.exec(masked))) ranges.push([match.index, match.index + match[0].length]);
  for (var index = ranges.length - 1; index >= 0; index--)
    text = text.slice(0, ranges[index][0]) + text.slice(ranges[index][1]);
  return text;
}
function mvuEraseTypescriptParameters(source) {
  var text = String(source || ''),
    masked = mvuTypescriptCodeMask(text),
    ranges = [],
    containers = [/(\()([^()\r\n]*)(\)\s*=>)/g, /(\bfunction(?:\s+[A-Za-z_$][\w$]*)?\s*\()([^()\r\n]*)(\))/g];
  containers.forEach(function (container) {
    var match;
    container.lastIndex = 0;
    while ((match = container.exec(masked))) {
      var start = match.index + match[1].length,
        inside = match[2],
        parameter = /(^|,)(\s*[A-Za-z_$][\w$]*\s*):\s*[A-Za-z_$][\w$]*(?:\s*<[^>\r\n]+>)?(?:\s*\[\])?(?=\s*(?:,|$|=))/g,
        item;
      while ((item = parameter.exec(inside)))
        ranges.push([start + item.index + item[1].length + item[2].length, start + item.index + item[0].length]);
    }
  });
  ranges.sort(function (left, right) {
    return right[0] - left[0];
  });
  for (var index = 0; index < ranges.length; index++)
    text = text.slice(0, ranges[index][0]) + text.slice(ranges[index][1]);
  return text;
}
function mvuEraseTypescriptAssertions(source) {
  var text = String(source || ''),
    masked = mvuTypescriptCodeMask(text),
    pattern = /\s+as\s+[A-Za-z_$][\w$]*(?:\s*<[^;=\r\n{}]+>)?(?=\s*[,;\r\n})])/g,
    ranges = [],
    match;
  while ((match = pattern.exec(masked))) {
    var statementStart = masked.lastIndexOf(';', match.index - 1) + 1,
      prefix = masked.slice(statementStart, match.index);
    if (/^\s*(?:import|export)\b/.test(prefix)) continue;
    ranges.push([match.index, match.index + match[0].length]);
  }
  for (var index = ranges.length - 1; index >= 0; index--)
    text = text.slice(0, ranges[index][0]) + text.slice(ranges[index][1]);
  return text;
}
function mvuEraseSupportedTypescript(source) {
  var text = String(source || '');
  if (!/^\s*import\s+type\b/m.test(mvuTypescriptCodeMask(text)) && mvuSchemaSourceCompiles(text)) return text;
  var erased = mvuEraseTypescriptTypeImports(text);
  erased = mvuEraseTypescriptParameters(erased);
  erased = mvuEraseTypescriptAssertions(erased);
  return erased !== text && mvuSchemaSourceCompiles(erased) ? erased : text;
}
function mvuResidentScriptSource(char, row) {
  var source = String((row && row.content) || '');
  return mvuRuntimeOwner(char) === 'bundle' && mvuHasSchemaRegistration(source)
    ? mvuEraseSupportedTypescript(source)
    : source;
}
function mvuPrepareSchemaSource(char) {
  var scripts = mvuSchemaScripts(char);
  if (scripts.length !== 1)
    throw new Error(scripts.length ? '当前卡片声明了多个 MVU 结构脚本' : '没有找到 MVU 结构脚本');
  var source = scripts[0].content,
    masked = mvuTypescriptCodeMask(source),
    matched = 0;
  source = source.replace(MVU_SCHEMA_IMPORT_RE, function (statement, quote, address, offset) {
    var start = offset + statement.indexOf('import');
    if (masked.slice(start, start + 6) !== 'import') return statement;
    matched++;
    return '';
  });
  if (!matched) throw new Error('MVU 结构脚本没有使用受支持的本地映射入口');
  if (/\bimport\b/.test(mvuTypescriptCodeMask(source))) throw new Error('MVU 结构脚本还依赖其他远程模块');
  source = source
    .replace(/^\s*export\s+(?=(?:const|let|var|function|class|async\s+function)\b)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  if (/^\s*export\b/m.test(source)) throw new Error('MVU 结构脚本包含不支持的模块导出');
  source = mvuEraseSupportedTypescript(source);
  return { source: source, signature: mvuHash(scripts[0].content) };
}
function mvuWorkerKey(char) {
  return String((char && char.id) || '');
}
function mvuSandboxWorker(source) {
  if (typeof document === 'undefined' || !document.body || typeof mvuSandboxFrameBody !== 'function')
    throw new Error('MVU 隔离运行区不可用');
  var frame = document.createElement('iframe'),
    token = 'mvu_' + ++_mvuWorkerSeq + '_' + mvuHash(Date.now() + ':' + Math.random()),
    ready = false,
    queue = [],
    closed = false,
    proxy = { onmessage: null, onerror: null, onmessageerror: null };
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc =
    "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; worker-src data:; child-src data:; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'\"><script>(" +
    mvuSandboxFrameBody.toString() +
    ')();<\/script>';
  function send(message) {
    if (closed) return;
    if (!ready) {
      queue.push(message);
      return;
    }
    frame.contentWindow.postMessage(message, '*');
  }
  function receive(event) {
    if (closed || event.source !== frame.contentWindow) return;
    var message = event.data || {};
    if (String(message.token || '') !== token) return;
    if (message.kind === 'message' && typeof proxy.onmessage === 'function') proxy.onmessage({ data: message.payload });
    else if (message.kind === 'error' && typeof proxy.onerror === 'function')
      proxy.onerror({ message: String(message.message || 'MVU Worker 异常') });
    else if (message.kind === 'messageerror' && typeof proxy.onmessageerror === 'function') proxy.onmessageerror();
  }
  window.addEventListener('message', receive);
  frame.onload = function () {
    if (closed) return;
    ready = true;
    var pending = queue;
    queue = [];
    pending.forEach(send);
  };
  document.body.appendChild(frame);
  send({ kind: 'create', token: token, source: String(source || '') });
  proxy.postMessage = function (message) {
    send({ kind: 'call', token: token, payload: message });
  };
  proxy.terminate = function () {
    if (closed) return;
    send({ kind: 'terminate', token: token });
    closed = true;
    queue = [];
    window.removeEventListener('message', receive);
    frame.remove();
  };
  return proxy;
}
function mvuWorkerHandle(char) {
  var key = mvuWorkerKey(char),
    handle = _mvuWorkers[key];
  if (handle && handle.worker) return handle;
  handle = {
    key: key,
    worker: null,
    url: '',
    pending: new Map(),
    schemaSignature: '',
    generation: ((handle && handle.generation) || 0) + 1,
  };
  var generation = handle.generation,
    worker,
    url = '',
    vendorSource = String(self.__yeyuMvuWorkerVendorSource || '');
  if (!vendorSource || typeof mvuWorkerBody !== 'function') throw new Error('MVU Worker 本地组件未加载');
  try {
    worker = mvuSandboxWorker(vendorSource + '\n(' + mvuWorkerBody.toString() + ')();');
  } catch (error) {
    throw new Error('MVU Worker 启动失败：' + String((error && error.message) || error));
  }
  handle.worker = worker;
  handle.url = url;
  worker.onmessage = function (event) {
    if (handle.generation !== generation) return;
    var message = event.data || {},
      pending = handle.pending.get(message.callId);
    if (!pending) return;
    if (message.type === 'started') {
      pending.timer = setTimeout(function () {
        mvuInvalidateWorker(handle, new Error('MVU 计算超时并已终止'));
      }, 15000);
      return;
    }
    clearTimeout(pending.timer);
    handle.pending.delete(message.callId);
    if (message.type === 'done') pending.resolve(message.value);
    else {
      var detail =
          message.error && typeof message.error === 'object'
            ? message.error
            : { message: String(message.error || 'MVU Worker 失败') },
        failure = new Error(String(detail.message || 'MVU Worker 失败'));
      failure.mvuIssues = Array.isArray(detail.issues) ? detail.issues : [];
      pending.reject(failure);
    }
  };
  worker.onerror = function (event) {
    var error = new Error('MVU Worker 异常：' + String((event && event.message) || '未知错误'));
    mvuInvalidateWorker(handle, error);
  };
  worker.onmessageerror = function () {
    mvuInvalidateWorker(handle, new Error('MVU Worker 返回了无法读取的数据'));
  };
  _mvuWorkers[key] = handle;
  return handle;
}
function mvuInvalidateWorker(handle, error) {
  if (!handle) return false;
  var worker = handle.worker,
    url = handle.url;
  handle.worker = null;
  handle.url = '';
  handle.schemaSignature = '';
  handle.generation++;
  if (worker)
    try {
      worker.terminate();
    } catch (_) {}
  if (url)
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
  handle.pending.forEach(function (pending) {
    clearTimeout(pending.timer);
    pending.reject(error || new Error('MVU 已被停止'));
  });
  handle.pending.clear();
  return !!worker;
}
function terminateMvuWorker(char) {
  var key = mvuWorkerKey(char),
    handle = _mvuWorkers[key],
    stopped = handle ? mvuInvalidateWorker(handle, new Error('MVU 已被手动停止')) : false;
  delete _mvuWorkers[key];
  return stopped;
}
function releaseMvuWorkersExcept(charId) {
  var keep = String(charId || ''),
    released = [];
  Object.keys(_mvuWorkers).forEach(function (key) {
    if (key !== keep) {
      if (mvuInvalidateWorker(_mvuWorkers[key], new Error('角色已切换'))) released.push(key);
      delete _mvuWorkers[key];
    }
  });
  return released;
}
async function mvuCall(char, message, options) {
  options = options || {};
  if (options.signal && options.signal.aborted) throw cardFrontendAbortError('MVU 变量刷新');
  var handle = mvuWorkerHandle(char),
    callId = 'm' + ++_mvuWorkerSeq,
    generation = handle.generation,
    controller = new AbortController(),
    parentSignal = options.signal,
    abort = function () {
      controller.abort();
    },
    release =
      typeof registerTransientRequestController === 'function' ? registerTransientRequestController(controller) : null;
  if (parentSignal) parentSignal.addEventListener('abort', abort, { once: true });
  var waiting = new Promise(function (resolve, reject) {
    handle.pending.set(callId, { resolve: resolve, reject: reject, generation: generation });
    try {
      handle.worker.postMessage(Object.assign({}, message, { callId: callId }));
    } catch (error) {
      handle.pending.delete(callId);
      reject(error);
    }
  });
  try {
    return await cardFrontendAwaitWithTimeout(waiting, {
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
      label: 'MVU 变量刷新',
    });
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) mvuInvalidateWorker(handle, error);
    throw error;
  } finally {
    var pending = handle.pending.get(callId);
    if (pending) clearTimeout(pending.timer);
    if (parentSignal) parentSignal.removeEventListener('abort', abort);
    if (release) release();
    handle.pending.delete(callId);
  }
}
async function mvuEnsureSchema(char, options) {
  var plan = mvuPrepareSchemaSource(char),
    handle = mvuWorkerHandle(char);
  if (handle.schemaSignature === plan.signature) return plan.signature;
  await mvuCall(char, { type: 'init', source: plan.source }, options);
  if (!handle.worker) throw new Error('MVU 已被停止');
  handle.schemaSignature = plan.signature;
  return plan.signature;
}
function mvuYamlValue(source) {
  var vendor = typeof self !== 'undefined' && self.YeyuMvuVendor;
  if (!vendor || typeof vendor.parseYaml !== 'function') throw new Error('YAML 解析组件未加载');
  var parsed = vendor.parseYaml(String(source || ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('变量初始值必须是 YAML 对象');
  return Object.prototype.hasOwnProperty.call(parsed, 'stat_data') ? parsed.stat_data : parsed;
}
function mvuInitEntry(char) {
  var entries = typeof getAllWBEntries === 'function' ? getAllWBEntries(char && char.id) : [];
  return (
    entries.find(function (entry) {
      return /\[\s*initvar\s*\]/i.test(String((entry && entry.comment) || (entry && entry.name) || ''));
    }) || null
  );
}
function mvuOpeningInitSource(value) {
  var match = /<\s*initvar\b[^>]*>([\s\S]*?)<\s*\/\s*initvar\s*>/i.exec(String(value || ''));
  return match ? String(match[1] || '').trim() : '';
}
function mvuInitialSource(char) {
  var entry = mvuInitEntry(char),
    content = String((entry && entry.content) || '')
      .replace(/^\s*\[\s*initvar\s*\]\s*/i, '')
      .trim();
  return content || '{}';
}
function mvuUpdateBlocks(value) {
  var source = String(value || ''),
    blocks = [],
    pattern = /<\s*UpdateVariable\b[^>]*>([\s\S]*?)<\s*\/\s*UpdateVariable\s*>/gi,
    match;
  while ((match = pattern.exec(source))) {
    var body = String(match[1] || ''),
      json = /<\s*JSONPatch\b[^>]*>([\s\S]*?)<\s*\/\s*JSONPatch\s*>/i.exec(body);
    if (!json) {
      blocks.push({ error: 'UpdateVariable 中缺少 JSONPatch' });
      continue;
    }
    var text = String(json[1] || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      var operations = JSON.parse(text);
      if (!Array.isArray(operations)) throw new Error('JSONPatch 必须是数组');
      blocks.push({ operations: operations });
    } catch (error) {
      blocks.push({ error: 'JSONPatch 无法解析：' + String((error && error.message) || error) });
    }
  }
  return blocks;
}
function mvuCandidateTexts(message) {
  var swipes =
      message && Array.isArray(message.swipes) && message.swipes.length
        ? message.swipes.map(function (value) {
            return String(value || '');
          })
        : [String((message && message.content) || '')],
    active = message && Number.isInteger(Number(message.swipeId)) ? Number(message.swipeId) : 0;
  if (active < 0 || active >= swipes.length) active = 0;
  if (swipes[active] !== String((message && message.content) || ''))
    swipes[active] = String((message && message.content) || '');
  return { texts: swipes, active: active };
}
function mvuRebuiltCandidate(stored, computed) {
  var candidate = objectRecord(stored) ? cloneJsonValue(stored) : {};
  return Object.assign(candidate, computed);
}
function mvuMessageRecord(message, index) {
  var record = message && objectRecord(message.yeyuMvu),
    candidates = record && Array.isArray(record.candidates) ? record.candidates : [],
    at = Math.max(
      0,
      Math.min(
        candidates.length - 1,
        Number.isInteger(Number(index)) ? Number(index) : Number(record && record.activeIndex) || 0
      )
    );
  return candidates[at] || null;
}
function mvuRuntimeKey(char, session) {
  return String((char && char.id) || '') + '|' + String((session && session.id) || '');
}
function clearMvuSessionRuntime(charId, sessionIds) {
  (Array.isArray(sessionIds) ? sessionIds : [sessionIds]).forEach(function (id) {
    var key = String(charId || '') + '|' + String(id || '');
    delete _mvuRuntime[key];
    _mvuRuns[key] = (Number(_mvuRuns[key]) || 0) + 1;
  });
}
function clearMvuCharacterRuntime(charId) {
  var id = String(charId || ''),
    worker = _mvuWorkers[id];
  if (worker) mvuInvalidateWorker(worker, new Error('角色已删除'));
  delete _mvuWorkers[id];
  Object.keys(_mvuRuntime).forEach(function (key) {
    if (key.indexOf(id + '|') === 0) {
      delete _mvuRuntime[key];
      _mvuRuns[key] = (Number(_mvuRuns[key]) || 0) + 1;
    }
  });
}
function stopMvuRuntime(char, session) {
  var stopped = terminateMvuWorker(char),
    key = mvuRuntimeKey(char, session);
  _mvuRuns[key] = (Number(_mvuRuns[key]) || 0) + 1;
  if (stopped)
    _mvuRuntime[key] = {
      kind: 'stopped',
      label: 'MVU 已手动停止',
      state: mvuSelectedStoredState(session) || {},
      error: '重新构建或再次发送时会创建新的运行区',
    };
  if (typeof renderMvuRuntimeStatus === 'function') renderMvuRuntimeStatus(char, session);
  return stopped;
}
function syncMvuMessageActiveSwipe(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.swipes) || !message.swipes.length)
    return false;
  var active = Math.max(
      0,
      Math.min(message.swipes.length - 1, Number.isInteger(Number(message.swipeId)) ? Number(message.swipeId) : 0)
    ),
    content = String(message.content || ''),
    changed = message.swipes[active] !== content;
  message.swipes[active] = content;
  message.swipeId = active;
  return changed;
}
function mvuSelectedStoredCandidate(session) {
  var rows = session && Array.isArray(session.msgs) ? session.msgs : [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var message = rows[i];
    if (!message || message.role !== 'assistant') continue;
    var choice = mvuCandidateTexts(message),
      record = mvuMessageRecord(message, choice.active);
    if (record && record.state && typeof record.state === 'object') return record;
  }
  return null;
}
function mvuSelectedStoredState(session) {
  var record = mvuSelectedStoredCandidate(session);
  return record ? cloneJsonValue(record.state) : null;
}
function mvuCurrentState(char, session) {
  if (isRisuCharacter(char)) return {};
  var runtime = _mvuPreviewRuntime.get(session) || _mvuRuntime[mvuRuntimeKey(char, session)];
  return cloneJsonValue((runtime && runtime.state) || mvuSelectedStoredState(session) || {});
}
// Bundle-written records may carry the official `display_data` / `delta_data` containers on the
// candidate that produced them, so macros read them from the selected record.
function mvuMacroContainers(char, session) {
  if (isRisuCharacter(char)) return { stat_data: {}, display_data: {}, delta_data: {} };
  var record = mvuSelectedStoredCandidate(session);
  return {
    stat_data: mvuCurrentState(char, session),
    display_data: cloneJsonValue((record && record.display) || {}),
    delta_data: cloneJsonValue((record && record.delta) || {}),
  };
}
function mvuRuntimeStatus(char, session) {
  if (!char || !mvuHasSchema(char)) return { kind: 'none', label: '这张卡片没有 MVU 变量协议' };
  if (char.scriptsEnabled === false)
    return { kind: 'disabled', label: 'MVU 已关闭' };
  if (mvuRuntimeOwner(char) === 'bundle')
    return { kind: 'external', label: 'MVU 由卡片 bundle 运行', state: mvuSelectedStoredState(session) || {} };
  var runtime = _mvuRuntime[mvuRuntimeKey(char, session)];
  if (!runtime) return { kind: 'idle', label: '尚未构建变量状态', state: mvuSelectedStoredState(session) || {} };
  return runtime;
}
async function mvuApplyCandidate(char, base, text, options) {
  var state = cloneJsonValue(base),
    blocks = mvuUpdateBlocks(text),
    errors = [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].error) {
      errors.push(blocks[i].error);
      continue;
    }
    try {
      state = await mvuCall(char, { type: 'apply', base: state, operations: blocks[i].operations }, options);
    } catch (error) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
      errors.push(String((error && error.message) || error));
    }
  }
  return { state: state, error: errors.join('；'), updates: blocks.length };
}
// A preview (options.preview) replays onto cloned messages and keeps its state on that cloned session; the live
// runtime, its run token and the status display stay as they are.
async function rebuildMvuSession(char, session, messages, options) {
  options = options || {};
  if (!mvuCanRun(char)) return { changed: false, status: mvuRuntimeStatus(char, session) };
  var preview = options.preview === true,
    runtimeKey = mvuRuntimeKey(char, session),
    runToken = preview ? _mvuRuns[runtimeKey] : (Number(_mvuRuns[runtimeKey]) || 0) + 1,
    started = false,
    failure = null,
    activeHandle = null,
    activeGeneration = 0;
  if (!preview) _mvuRuns[runtimeKey] = runToken;
  try {
    if (!preview && typeof markCardScriptRunning === 'function') {
      markCardScriptRunning(char, 'MVU 变量');
      started = true;
    }
    activeHandle = mvuWorkerHandle(char);
    activeGeneration = activeHandle.generation;
    var schemaSignature = await mvuEnsureSchema(char, options),
      carry = await mvuCall(char, { type: 'validate', value: mvuYamlValue(mvuInitialSource(char)) }, options);
    var rows = Array.isArray(messages) ? messages : (session && session.msgs) || [],
      changed = false,
      errorCount = 0,
      processed = 0,
      staged = [],
      firstError = '';
    for (var i = 0; i < rows.length; i++) {
      var message = rows[i];
      if (
        !message ||
        message.role !== 'assistant' ||
        message.reverted === true ||
        message.kind === 'branch-return' ||
        message.kind === 'branch-return-revert' ||
        message.branchReturnSummary === true ||
        message.branchReturnCopy === true
      )
        continue;
      var choices = mvuCandidateTexts(message),
        base = carry,
        candidates = [],
        storedCandidates =
          message && message.yeyuMvu && Array.isArray(message.yeyuMvu.candidates) ? message.yeyuMvu.candidates : [];
      for (var c = 0; c < choices.texts.length; c++) {
        var text = choices.texts[c],
          candidateBase = base,
          openingFailed = '';
        if (message.opening === true) {
          var openingSource = mvuOpeningInitSource(text);
          if (openingSource) {
            try {
              candidateBase = await mvuCall(char, { type: 'validate', value: mvuYamlValue(openingSource) }, options);
            } catch (error) {
              if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
              openingFailed = String((error && error.message) || error);
            }
          }
        }
        if (openingFailed) {
          candidates.push(
            mvuRebuiltCandidate(storedCandidates[c], {
              sourceHash: mvuHash(text),
              state: cloneJsonValue(base),
              error: '开场变量无效：' + openingFailed,
              updates: 0,
            })
          );
          errorCount++;
          if (!firstError) firstError = '开场变量无效：' + openingFailed;
          continue;
        }
        var result = await mvuApplyCandidate(char, candidateBase, text, options);
        if (result.error) {
          errorCount++;
          if (!firstError) firstError = result.error;
        }
        candidates.push(
          mvuRebuiltCandidate(storedCandidates[c], {
            sourceHash: mvuHash(text),
            state: cloneJsonValue(result.state),
            error: result.error,
            updates: result.updates,
          })
        );
      }
      var record = {
        version: MVU_STATE_VERSION,
        schemaSignature: schemaSignature,
        activeIndex: choices.active,
        candidates: candidates,
      };
      var serialized = JSON.stringify(record);
      staged.push({
        message: message,
        record: record,
        changed: JSON.stringify(message.yeyuMvu || null) !== serialized,
      });
      var active = candidates[choices.active];
      carry = active ? cloneJsonValue(active.state) : base;
      processed++;
    }
    if (
      _mvuRuns[runtimeKey] !== runToken ||
      !activeHandle ||
      _mvuWorkers[mvuWorkerKey(char)] !== activeHandle ||
      !activeHandle.worker ||
      activeHandle.generation !== activeGeneration
    )
      throw new Error('MVU 已被停止');
    staged.forEach(function (row) {
      if (row.changed) {
        if (options.mutation) options.mutation.capture(row.message, ['yeyuMvu'], true);
        row.message.yeyuMvu = row.record;
        changed = true;
      }
    });
    if (options.mutation) options.mutation.seal();
    var status = {
      kind: errorCount ? 'warning' : 'ready',
      label: errorCount ? '变量已构建，部分更新未采用' : 'MVU 变量已就绪',
      state: cloneJsonValue(carry),
      error: errorCount ? errorCount + ' 条消息含无效变量更新' + (firstError ? '：' + firstError : '') : '',
      errorCount: errorCount,
      errorDetail: firstError,
      processedMessages: processed,
      schemaSignature: schemaSignature,
      dialect: 'zod',
      updatedAt: Date.now(),
    };
    if (preview) {
      _mvuPreviewRuntime.set(session, status);
      return { changed: changed, status: status };
    }
    _mvuRuntime[runtimeKey] = status;
    if (typeof refreshCardScriptLibraryContext === 'function') refreshCardScriptLibraryContext(char, session);
    if (typeof renderMvuRuntimeStatus === 'function') renderMvuRuntimeStatus(char, session);
    return { changed: changed, status: status };
  } catch (error) {
    failure = error;
    if (
      !preview &&
      _mvuRuns[runtimeKey] === runToken &&
      (!activeHandle || (activeHandle.worker && activeHandle.generation === activeGeneration))
    ) {
      var failed = {
        kind: 'failed',
        label: 'MVU 变量构建失败',
        state: mvuSelectedStoredState(session) || {},
        error: String((error && error.message) || error),
        errorCount: 1,
        updatedAt: Date.now(),
      };
      _mvuRuntime[runtimeKey] = failed;
      if (typeof renderMvuRuntimeStatus === 'function') renderMvuRuntimeStatus(char, session);
    }
    throw error;
  } finally {
    if (started && typeof markCardScriptFinished === 'function') markCardScriptFinished(char, failure);
  }
}
async function prepareMvuForPrompt(char, session, messages, options) {
  return await rebuildMvuSession(char, session, messages, Object.assign({ reason: 'prompt' }, options));
}
async function refreshMvuAfterMutation(char, session, options) {
  if (!char || !session || !mvuCanRun(char)) return false;
  try {
    return (await rebuildMvuSession(char, session, session.msgs || [], Object.assign({ reason: 'mutation' }, options)))
      .changed;
  } catch (error) {
    if (options && options.signal && error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      throw error;
    return false;
  }
}
async function rebuildCurrentMvuSession() {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  if (!char || !session) return false;
  var mutation = createMutationJournal(),
    committed = false;
  try {
    var result = await rebuildMvuSession(char, session, session.msgs || [], { reason: 'manual', mutation: mutation });
    if (result.changed) await saveData('sessions', { urgent: true });
    committed = true;
    if (getChar() === char && getActiveSession(char.id) === session) {
      if (typeof renderChat === 'function') renderChat();
      if (typeof renderMvuRuntimeStatus === 'function') renderMvuRuntimeStatus(char, session);
    }
    toast('MVU 变量已重新构建', 'ok');
    return true;
  } catch (error) {
    if (!committed) {
      mutation.rollback();
      clearMvuSessionRuntime(char.id, session.id);
    }
    toast('MVU 变量构建失败：' + String((error && error.message) || error), 'err');
    return false;
  }
}
function mvuHiddenClone(value) {
  if (Array.isArray(value)) return value.map(mvuHiddenClone);
  if (!value || typeof value !== 'object') return value;
  var out = {};
  Object.keys(value).forEach(function (key) {
    if (key.charAt(0) !== '$') out[key] = mvuHiddenClone(value[key]);
  });
  return out;
}
function mvuReadStatePath(state, path) {
  var normalized = String(path || '').replace(
      /\[(?:"([^"]*)"|'([^']*)'|(\d+))\]/g,
      function (_, doubleKey, singleKey, index) {
        return '.' + String(doubleKey == null ? (singleKey == null ? index : singleKey) : doubleKey);
      }
    ),
    parts = normalized.split(/[.:]+/).filter(Boolean),
    value = state;
  for (var i = 0; i < parts.length; i++) {
    var key = parts[i];
    if (
      key.charAt(0) === '$' ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      value == null ||
      typeof value !== 'object' ||
      !Object.prototype.hasOwnProperty.call(value, key)
    )
      return undefined;
    value = value[key];
  }
  return value;
}
function mvuRenderVariable(target) {
  if (target === undefined) return '';
  var vendor = self.YeyuMvuVendor;
  return vendor && typeof vendor.stringifyYaml === 'function'
    ? vendor.stringifyYaml(mvuHiddenClone(target), { indent: 2, lineWidth: 0 }).trim()
    : JSON.stringify(mvuHiddenClone(target), null, 2);
}
function formatTavernHelperVariable(value, quoted) {
  if (value === undefined) return '';
  value = mvuHiddenClone(value);
  if (typeof value === 'string') return value;
  return self.YeyuMvuVendor.stringifyYaml(
    value,
    quoted
      ? {
          blockQuote: 'literal',
          defaultKeyType: 'PLAIN',
          defaultStringType: 'QUOTE_DOUBLE',
        }
      : { blockQuote: 'literal' }
  ).trimEnd();
}
function mvuMacroSession(char, macroState) {
  return (
    (macroState && macroState.session) ||
    (char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null)
  );
}
function mvuFormatVariable(path, char, macroState) {
  var state = mvuCurrentState(char, mvuMacroSession(char, macroState)),
    target = state,
    raw = String(path || '').trim();
  if (raw && raw !== 'stat_data') {
    raw = raw.replace(/^stat_data(?:\.|::)?/, '');
    target = raw ? mvuReadStatePath(state, raw) : state;
  }
  return mvuRenderVariable(target);
}
// TavernHelper's message-variable macro addresses the three official containers, and a bare path
// keeps meaning `stat_data`.
function mvuMessageVariable(path, char, macroState) {
  var containers = mvuMacroContainers(char, mvuMacroSession(char, macroState)),
    raw = String(path || '').trim(),
    root = /^(stat_data|display_data|delta_data)(?![\w$])/.exec(raw),
    name = root ? root[1] : 'stat_data',
    rest = (root ? raw.slice(root[1].length).replace(/^(?:\.|::)/, '') : raw).trim();
  return mvuRenderVariable(rest ? mvuReadStatePath(containers[name], rest) : containers[name]);
}
function replaceMvuVariableMacros(value, char, macroState) {
  var text = String(value || '');
  if (!mvuEnabled(char)) return text;
  return text
    .replace(/\{\{\s*format_message_variable\s*::([\s\S]*?)\}\}/gi, function (_, path) {
      return mvuFormatVariable(path, char, macroState);
    })
    .replace(/\{\{\s*get_message_variable\s*::([\s\S]*?)\}\}/gi, function (_, path) {
      return mvuMessageVariable(path, char, macroState);
    });
}
function stripMvuProtocolForDisplay(value, char) {
  if (isRisuCharacter(char)) return String(value || '');
  return String(value || '')
    .replace(/<\s*UpdateVariable\b[^>]*>[\s\S]*?<\s*\/\s*UpdateVariable\s*>/gi, '')
    .replace(/<\s*UpdateVariable\b[^>]*>[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
