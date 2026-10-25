// Serialized into a sandbox-owned data Worker by 52-mvu-runtime.js so Android file:// assets
// never need direct Worker or importScripts access. The local Zod/Lodash bundle runs first.
function mvuSandboxFrameBody() {
  'use strict';
  var worker = null,
    token = '';
  addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.kind === 'create' && !worker) {
      token = String(message.token || '');
      try {
        worker = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(String(message.source || '')));
        worker.onmessage = function (inner) {
          parent.postMessage({ kind: 'message', token: token, payload: inner.data }, '*');
        };
        worker.onerror = function (inner) {
          if (inner && inner.preventDefault) inner.preventDefault();
          parent.postMessage(
            { kind: 'error', token: token, message: String((inner && inner.message) || 'MVU Worker 异常') },
            '*'
          );
        };
        worker.onmessageerror = function () {
          parent.postMessage({ kind: 'messageerror', token: token }, '*');
        };
      } catch (error) {
        parent.postMessage({ kind: 'error', token: token, message: String((error && error.message) || error) }, '*');
      }
    } else if (message.kind === 'call' && worker && String(message.token || '') === token)
      worker.postMessage(message.payload);
    else if (message.kind === 'terminate' && worker && String(message.token || '') === token) {
      worker.terminate();
      worker = null;
    }
  });
}
function mvuWorkerBody() {
  'use strict';
  var vendor = self.YeyuMvuVendor,
    schema = null,
    hostPost = self.postMessage.bind(self);
  [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'WebSocketStream',
    'WebTransport',
    'EventSource',
    'Worker',
    'SharedWorker',
    'importScripts',
    'indexedDB',
    'caches',
    'navigator',
    'postMessage',
    'close',
  ].forEach(function (name) {
    try {
      Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
    } catch (_) {
      try {
        self[name] = undefined;
      } catch (__) {}
    }
  });
  function post(message) {
    hostPost(message);
  }
  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function failure(error) {
    var issues =
      error && Array.isArray(error.issues)
        ? error.issues.map(function (issue) {
            return {
              path: Array.isArray(issue.path) ? issue.path : [],
              message: String(issue.message || '校验失败'),
              code: String(issue.code || ''),
            };
          })
        : [];
    return { message: String((error && error.message) || error || 'MVU 运行失败'), issues: issues };
  }
  function validate(value) {
    if (!schema) throw new Error('MVU 结构尚未加载');
    var result = schema.safeParse(clone(value));
    if (!result.success) {
      var error = new Error('变量不符合角色卡声明的结构');
      error.issues = (result.error && result.error.issues) || [];
      throw error;
    }
    return clone(result.data);
  }
  function pointer(path) {
    path = String(path == null ? '' : path);
    if (path === '') return [];
    if (path.charAt(0) !== '/') throw new Error('变量路径必须以 / 开头');
    return path
      .slice(1)
      .split('/')
      .map(function (part) {
        if (/~(?:[^01]|$)/.test(part)) throw new Error('变量路径包含无效转义');
        var value = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (value === '__proto__' || value === 'prototype' || value === 'constructor')
          throw new Error('变量路径包含禁止字段');
        if (value.charAt(0) === '_' || value.charAt(0) === '$') throw new Error('不能修改受保护变量：' + value);
        return value;
      });
  }
  function container(root, parts) {
    var value = root;
    for (var i = 0; i < parts.length - 1; i++) {
      if (value == null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, parts[i]))
        throw new Error('变量路径不存在：/' + parts.slice(0, i + 1).join('/'));
      value = value[parts[i]];
    }
    return { value: value, key: parts[parts.length - 1] };
  }
  function read(root, parts) {
    var value = root;
    for (var i = 0; i < parts.length; i++) {
      if (value == null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, parts[i]))
        throw new Error('变量路径不存在：/' + parts.slice(0, i + 1).join('/'));
      value = value[parts[i]];
    }
    return value;
  }
  function arrayIndex(value, key, allowEnd) {
    if (key === '-' && allowEnd) return value.length;
    if (!/^(?:0|[1-9]\d*)$/.test(String(key))) throw new Error('数组位置无效：' + key);
    var index = Number(key),
      max = allowEnd ? value.length : value.length - 1;
    if (index < 0 || index > max) throw new Error('数组位置超出范围：' + key);
    return index;
  }
  function removeAt(root, parts) {
    if (!parts.length) throw new Error('不能删除变量根节点');
    var target = container(root, parts),
      owner = target.value,
      key = target.key;
    if (Array.isArray(owner)) {
      var index = arrayIndex(owner, key, false),
        old = owner[index];
      owner.splice(index, 1);
      return old;
    }
    if (owner == null || typeof owner !== 'object' || !Object.prototype.hasOwnProperty.call(owner, key))
      throw new Error('变量路径不存在：/' + parts.join('/'));
    var previous = owner[key];
    delete owner[key];
    return previous;
  }
  function insertAt(root, parts, value) {
    if (!parts.length) throw new Error('不能替换变量根节点');
    var target = container(root, parts),
      owner = target.value,
      key = target.key;
    if (Array.isArray(owner)) {
      owner.splice(arrayIndex(owner, key, true), 0, clone(value));
      return;
    }
    if (owner == null || typeof owner !== 'object') throw new Error('变量父路径不是对象');
    owner[key] = clone(value);
  }
  function replaceAt(root, parts, value) {
    if (!parts.length) throw new Error('不能替换变量根节点');
    var target = container(root, parts),
      owner = target.value,
      key = target.key;
    if (Array.isArray(owner)) {
      owner[arrayIndex(owner, key, false)] = clone(value);
      return root;
    }
    if (owner == null || typeof owner !== 'object' || !Object.prototype.hasOwnProperty.call(owner, key))
      throw new Error('变量路径不存在：/' + parts.join('/'));
    owner[key] = clone(value);
    return root;
  }
  function applyOne(root, operation) {
    operation = operation && typeof operation === 'object' ? operation : {};
    var op = String(operation.op || '').toLowerCase(),
      parts = pointer(operation.path);
    if (op === 'replace') return replaceAt(root, parts, operation.value);
    if (op === 'delta') {
      var current = read(root, parts),
        amount = Number(operation.value);
      if (typeof current !== 'number' || !Number.isFinite(current) || !Number.isFinite(amount))
        throw new Error('delta 只能用于有限数值');
      return replaceAt(root, parts, current + amount);
    }
    if (op === 'insert') {
      insertAt(root, parts, operation.value);
      return root;
    }
    if (op === 'remove') {
      removeAt(root, parts);
      return root;
    }
    if (op === 'move') {
      var from = pointer(operation.from),
        value = clone(read(root, from));
      removeAt(root, from);
      insertAt(root, parts, value);
      return root;
    }
    throw new Error('不支持的变量操作：' + (op || '未填写'));
  }
  function applyOperations(base, operations) {
    if (!Array.isArray(operations)) throw new Error('JSONPatch 必须是数组');
    var next = clone(base);
    for (var i = 0; i < operations.length; i++) next = applyOne(next, operations[i]);
    return validate(next);
  }
  function loadSchema(source) {
    schema = null;
    var registered = 0,
      registerMvuSchema = function (value) {
        registered++;
        schema = value;
      };
    var ready = function (callback) {
      if (typeof callback !== 'function') throw new Error('MVU 结构脚本只能使用就绪回调');
      return callback();
    };
    var unavailable = undefined;
    var runner = new Function(
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
      '"use strict";\n' + String(source || '') + '\n'
    );
    runner(
      registerMvuSchema,
      vendor.z,
      vendor._,
      ready,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      unavailable
    );
    if (registered !== 1 || !schema || typeof schema.safeParse !== 'function')
      throw new Error(registered > 1 ? '结构脚本注册了多个 MVU Schema' : '结构脚本没有注册有效的 MVU Schema');
    return true;
  }
  self.onmessage = function (event) {
    var message = event.data || {},
      callId = message.callId;
    post({ type: 'started', callId: callId });
    try {
      var value;
      if (message.type === 'init') value = loadSchema(message.source);
      else if (message.type === 'validate') value = validate(message.value);
      else if (message.type === 'apply') value = applyOperations(message.base, message.operations);
      else throw new Error('不支持的 MVU Worker 操作：' + message.type);
      post({ type: 'done', callId: callId, value: value });
    } catch (error) {
      post({ type: 'failed', callId: callId, error: failure(error) });
    }
  };
}
