// Public client and endpoints verified 2026-09-25 against https://auth.x.ai/.well-known/openid-configuration
// and Grok Build / Hermes device authorization. No client secret or web cookies are used.
const GROK_SUBSCRIPTION = {
  apiUrl: 'https://api.x.ai/v1',
  issuer: 'https://auth.x.ai',
  clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
  scope: 'openid profile email offline_access grok-cli:access api:access',
};
let _grokLogin = null,
  _grokRefresh = null,
  _grokAuthEpoch = 0,
  _grokAuthStatus = '';
const _grokRequests = new Set();

function grokSubscriptionAuth() {
  return D && D.settings && D.settings.grokSubscriptionAuth;
}
function grokAbortError() {
  return new DOMException('已取消', 'AbortError');
}
function grokWait(ms, signal) {
  return new Promise(function (resolve, reject) {
    if (signal.aborted) return reject(grokAbortError());
    var timer = setTimeout(function () {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(grokAbortError());
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function grokOAuthRequest(endpoint, fields, signal) {
  var controller = new AbortController(),
    abort = function () {
      controller.abort();
    },
    timer = setTimeout(abort, 30000);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    var response = await fetch(GROK_SUBSCRIPTION.issuer + '/oauth2/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(Object.assign({ client_id: GROK_SUBSCRIPTION.clientId }, fields)).toString(),
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    var json = await response.json();
    if (!response.ok || json.error) {
      var code = typeof json.error === 'string' ? json.error : '',
        error = new Error(
          {
            access_denied: 'Grok 授权已拒绝，请重新登录。',
            expired_token: '登录代码已过期，请重新登录。',
            invalid_grant: 'Grok 登录已失效，请重新登录。',
          }[code] || 'Grok 授权暂时失败（HTTP ' + response.status + '），请稍后重试。'
        );
      error.oauthCode = code;
      throw error;
    }
    return json;
  } catch (error) {
    if (signal && signal.aborted) throw grokAbortError();
    if (error.oauthCode) throw error;
    // Authorization responses can contain credentials. Never expose their body or raw parsing errors.
    throw new Error('无法连接 Grok 授权服务，请检查手机网络后重试。');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}
function grokAccountFromToken(token) {
  try {
    var part = String(token || '')
        .split('.')[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/'),
      bytes = Uint8Array.from(atob(part), function (c) {
        return c.charCodeAt(0);
      }),
      claims = JSON.parse(new TextDecoder().decode(bytes));
    // Display metadata only, never an authorization decision. The token was returned by the pinned issuer.
    return String(claims.email || claims.preferred_username || claims.name || claims.sub || '').slice(0, 200);
  } catch (_) {
    return '';
  }
}
function grokTokenRecord(json, previous) {
  if (!json.access_token || !Number.isFinite(Number(json.expires_in)) || Number(json.expires_in) <= 0)
    throw new Error('Grok 返回的登录信息不完整，请重新登录。');
  var refresh = json.refresh_token || (previous && previous.refreshToken);
  if (!refresh) throw new Error('Grok 未提供续期凭据，请重新登录。');
  return {
    accessToken: String(json.access_token),
    refreshToken: String(refresh),
    expiresAt: Date.now() + Number(json.expires_in) * 1000,
    account:
      grokAccountFromToken(json.id_token) || (previous && previous.account) || grokAccountFromToken(json.access_token),
  };
}
async function saveGrokSubscriptionAuth(auth, epoch) {
  if (epoch !== _grokAuthEpoch) throw grokAbortError();
  if (auth) D.settings.grokSubscriptionAuth = auth;
  else delete D.settings.grokSubscriptionAuth;
  try {
    await saveData(['meta'], { urgent: true });
  } catch (_) {
    // A rotated refresh token must not be replaced with the invalid old token after a disk failure.
    throw new Error('Grok 登录状态未能保存到本机，请恢复存储后重试。');
  }
  if (epoch !== _grokAuthEpoch) throw grokAbortError();
  renderGrokSubscription();
}
function cancelGrokSubscriptionLogin() {
  if (_grokLogin) {
    _grokLogin.controller.abort();
    _grokAuthStatus = '已取消登录。';
  }
  _grokLogin = null;
  renderGrokSubscription();
}
async function loginGrokSubscription() {
  cancelGrokSubscriptionLogin();
  var login = { controller: new AbortController(), epoch: ++_grokAuthEpoch },
    signal = login.controller.signal;
  _grokLogin = login;
  _grokAuthStatus = '正在获取登录代码…';
  renderGrokSubscription();
  try {
    var device = await grokOAuthRequest('device/code', { scope: GROK_SUBSCRIPTION.scope }, signal),
      verification = new URL(device.verification_uri_complete || device.verification_uri);
    if (
      verification.origin !== 'https://accounts.x.ai' ||
      verification.pathname !== '/oauth2/device' ||
      !device.device_code ||
      !device.user_code ||
      !(Number(device.expires_in) > 0)
    )
      throw new Error('Grok 返回的授权地址或登录代码无效，请重试。');
    if (signal.aborted || _grokLogin !== login) throw grokAbortError();
    login.code = String(device.user_code);
    login.url = verification.href;
    login.expiresAt = Date.now() + Number(device.expires_in) * 1000;
    _grokAuthStatus = '在浏览器完成授权，返回后会自动登录。';
    renderGrokSubscription();
    var interval = Math.max(5, Number(device.interval) || 5) * 1000;
    while (Date.now() < login.expiresAt) {
      await grokWait(Math.min(interval, login.expiresAt - Date.now()), signal);
      if (Date.now() >= login.expiresAt) break;
      try {
        var json = await grokOAuthRequest(
          'token',
          {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: device.device_code,
          },
          signal
        );
        if (signal.aborted || _grokLogin !== login) throw grokAbortError();
        await saveGrokSubscriptionAuth(grokTokenRecord(json), login.epoch);
        _grokAuthStatus = '登录成功；供应商与模型设置需点击底部保存。';
        return;
      } catch (error) {
        if (error.oauthCode === 'authorization_pending') continue;
        if (error.oauthCode === 'slow_down') {
          interval += 5000;
          continue;
        }
        throw error;
      }
    }
    throw new Error('登录代码已过期，请重新登录。');
  } catch (error) {
    if (_grokLogin === login && error.name !== 'AbortError') _grokAuthStatus = error.message;
  } finally {
    if (_grokLogin === login) {
      _grokLogin = null;
      renderGrokSubscription();
    }
  }
}
async function logoutGrokSubscription() {
  ++_grokAuthEpoch;
  cancelGrokSubscriptionLogin();
  if (_grokRefresh) _grokRefresh.controller.abort();
  _grokRefresh = null;
  _grokRequests.forEach(function (controller) {
    controller.abort();
  });
  try {
    await saveGrokSubscriptionAuth(null, _grokAuthEpoch);
    _grokAuthStatus = '已退出登录，本机凭据已清除。';
  } catch (error) {
    _grokAuthStatus = error.message;
  }
  renderGrokSubscription();
}
async function grokAccessToken(signal, rejectedToken) {
  if (signal && signal.aborted) throw grokAbortError();
  var auth = grokSubscriptionAuth();
  if (!auth || !auth.refreshToken) throw new Error('请先在设置 → 接口 → Grok 订阅中登录。');
  if (auth.accessToken && auth.expiresAt > Date.now() + 60000 && auth.accessToken !== rejectedToken)
    return auth.accessToken;
  if (!_grokRefresh) {
    var refresh = { controller: new AbortController(), epoch: _grokAuthEpoch };
    _grokRefresh = refresh;
    refresh.promise = (async function () {
      try {
        var json = await grokOAuthRequest(
            'token',
            { grant_type: 'refresh_token', refresh_token: auth.refreshToken },
            refresh.controller.signal
          ),
          next = grokTokenRecord(json, auth);
        await saveGrokSubscriptionAuth(next, refresh.epoch);
        return next.accessToken;
      } catch (error) {
        if (error.oauthCode === 'invalid_grant' && refresh.epoch === _grokAuthEpoch) {
          await saveGrokSubscriptionAuth(null, refresh.epoch);
          _grokAuthStatus = '登录已失效，请重新登录。';
          renderGrokSubscription();
        }
        throw error;
      } finally {
        if (_grokRefresh === refresh) _grokRefresh = null;
      }
    })();
  }
  // Cancel this caller promptly without cancelling the shared refresh needed by other requests.
  var pending = _grokRefresh.promise;
  if (!signal) return pending;
  return new Promise(function (resolve, reject) {
    function abort() {
      reject(grokAbortError());
    }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      function (value) {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(grokAbortError());
        else resolve(value);
      },
      function (error) {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}
// 错误带上供应商的 code 与原文：出图的审核拒绝（imagine:content-moderated）等由调用方按 code 识别。
async function grokSubscriptionFailure(response) {
  var text = '',
    json = {};
  try {
    text = await response.text();
    json = JSON.parse(text) || {};
  } catch (_) {}
  if (!json || typeof json !== 'object') json = {};
  var details = json.error && typeof json.error === 'object' ? json.error : json;
  var exhausted = /quota|resource_exhausted|usage.?limit|weekly.?limit|spending.?limit/i.test(
    String(details.code || '') + ' ' + String(details.message || json.error || '')
  );
  var message =
      response.status === 401
        ? 'Grok 登录已失效，请重新登录。'
        : exhausted || response.status === 402 || response.status === 429
          ? 'Grok 订阅额度已用尽或请求过于频繁，请等待恢复后重试。'
          : response.status === 403
            ? '当前 Grok 订阅暂不能调用此模型，请检查订阅状态或换一个模型。'
            : response.status === 404
              ? 'Grok 未找到此模型，请重新检测模型后选择。'
              : 'Grok 请求失败（HTTP ' +
                response.status +
                '）' +
                (providerErrorText(text) ? '：' + providerErrorText(text) : '，请检查所选模型与参数后重试。'),
    reset =
      response.headers.get('retry-after') ||
      response.headers.get('x-ratelimit-reset') ||
      response.headers.get('x-ratelimit-reset-requests') ||
      details.reset_at ||
      details.reset_time ||
      details.resetAt ||
      details.resetTime ||
      details.retry_after;
  if (reset) {
    var numeric = Number(reset),
      date = Number.isFinite(numeric)
        ? new Date(
            numeric > 1000000000000 ? numeric : numeric > 1000000000 ? numeric * 1000 : Date.now() + numeric * 1000
          )
        : new Date(reset);
    if (Number.isFinite(date.getTime())) message += ' 可重试时间：' + date.toLocaleString('zh-CN') + '。';
  }
  var error = new Error(message);
  error.status = response.status;
  error.code = typeof details.code === 'string' ? details.code : '';
  error.responseText = text;
  return error;
}
// 订阅凭据只发往这些固定端点与方法；有请求体即 POST。
const GROK_SUBSCRIPTION_ENDPOINTS = {
  '/chat/completions': 'POST',
  '/models': 'GET',
  '/images/generations': 'POST',
  '/image-generation-models': 'GET',
};
// x-grok-conv-id 把同一会话的请求路由到同一台服务器以命中缓存；只接受会话 id 这类安全字符。
function grokConversationHeader(path, convId) {
  var value = String(convId || '');
  return path === '/chat/completions' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? { 'x-grok-conv-id': value } : {};
}
async function fetchGrokSubscription(path, options) {
  // Callers cannot redirect a subscription credential to custom providers or headers.
  options = options || {};
  if (
    !Object.prototype.hasOwnProperty.call(GROK_SUBSCRIPTION_ENDPOINTS, path) ||
    GROK_SUBSCRIPTION_ENDPOINTS[path] !== (options.body ? 'POST' : 'GET')
  )
    throw new Error('不支持的 Grok 请求');
  var signal = options.signal,
    controller = new AbortController(),
    abort = function () {
      controller.abort();
    },
    epoch = _grokAuthEpoch,
    reading = false;
  function release() {
    _grokRequests.delete(controller);
    if (signal) signal.removeEventListener('abort', abort);
  }
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  _grokRequests.add(controller);
  try {
    var token = await grokAccessToken(controller.signal);
    for (var attempt = 0; attempt < 2; attempt++) {
      if (epoch !== _grokAuthEpoch || controller.signal.aborted) throw grokAbortError();
      var response = await fetch(GROK_SUBSCRIPTION.apiUrl + path, {
        method: GROK_SUBSCRIPTION_ENDPOINTS[path],
        headers: Object.assign(
          { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          grokConversationHeader(path, options.convId)
        ),
        body: options.body,
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
      if (response.status === 401 && attempt === 0) {
        if (response.body) await response.body.cancel();
        token = await grokAccessToken(controller.signal, token);
        continue;
      }
      if ([401, 403, 429].includes(response.status)) {
        var error = await grokSubscriptionFailure(response);
        if (response.status === 401 && grokSubscriptionAuth() && grokSubscriptionAuth().accessToken === token) {
          await saveGrokSubscriptionAuth(null, epoch);
          _grokAuthStatus = error.message;
          renderGrokSubscription();
        }
        throw error;
      }
      if (!response.body) return response;
      var reader = response.body.getReader();
      reading = true;
      return new Response(
        new ReadableStream({
          async pull(sink) {
            try {
              var chunk = await reader.read();
              if (chunk.done) {
                release();
                sink.close();
              } else sink.enqueue(chunk.value);
            } catch (error) {
              release();
              sink.error(error);
            }
          },
          cancel(reason) {
            release();
            controller.abort();
            return reader.cancel(reason);
          },
        }),
        { status: response.status, statusText: response.statusText, headers: response.headers }
      );
    }
  } finally {
    // Keep cancellation and logout active until the SSE/JSON consumer finishes reading.
    if (!reading) release();
  }
}
// xAI reasoning docs (2026-09-25): /developers/model-capabilities/text/reasoning.
function applyGrokThinking(body, effort, options) {
  clearProviderThinkingParameters(body);
  if (effort === 'off' && !options.disableThinking)
    throw new Error('Grok 订阅模型不能关闭思考，请选择“自动”或其他思考档位。');
  if (options.disableThinking) effort = 'low';
  if (effort !== 'auto')
    body.reasoning_effort = effort === 'max' ? (/^grok-4\.5(?:-|$)/.test(body.model) ? 'high' : 'xhigh') : effort;
  return body;
}
// xAI 只接受 user 消息带 name。与 ST convertXAIMessages 一致：其余消息去掉 name，助手消息和对话示例把说话人
// 写进正文（已带「名字: 」开头的不重复加）。返回新数组，不改来源消息。
function grokRequestMessages(messages, names) {
  var charName = String((names && names.charName) || ''),
    userName = String((names && names.userName) || '');
  function speakerPrefixed(content, speaker) {
    return speaker && typeof content === 'string' && !content.startsWith(speaker + ': ')
      ? speaker + ': ' + content
      : content;
  }
  return messages.map(function (message) {
    if (!message.name || message.role === 'user') return message;
    var next = Object.assign({}, message);
    if (message.role === 'assistant' || (message.role === 'system' && message.name === 'example_assistant'))
      next.content = speakerPrefixed(message.content, charName);
    else if (message.role === 'system' && message.name === 'example_user')
      next.content = speakerPrefixed(message.content, userName);
    delete next.name;
    return next;
  });
}
// 设置页 API 与生图分区各有一个登录块（[data-grok-login]），共用同一个登录流程与状态。
function grokLoginBlockHtml(index) {
  var codeId = 'grok-device-code-' + index;
  return (
    '<div class="fg"><div class="ui-field-hd"><strong class="grok-account">尚未登录</strong><div class="ui-actions">' +
    '<button type="button" class="btn text sm accent grok-login-btn" onclick="loginGrokSubscription()">登录</button>' +
    '<button type="button" class="btn text sm grok-cancel-btn" onclick="cancelGrokSubscriptionLogin()" hidden>取消登录</button>' +
    '<button type="button" class="btn text sm danger grok-logout-btn" onclick="logoutGrokSubscription()" hidden>退出登录</button>' +
    '</div></div><div class="hint grok-auth-status" aria-live="polite"></div></div>' +
    '<div class="grok-device-panel" hidden><div class="fg"><label for="' +
    codeId +
    '">登录代码</label><input id="' +
    codeId +
    '" class="grok-device-code" type="text" readonly><div class="hint">打开下方网址，在浏览器中输入此代码并授权。</div></div>' +
    '<div class="fg"><a class="accent grok-device-link" rel="noreferrer">打开授权页面</a></div></div>'
  );
}
function renderGrokSubscription() {
  var panel = $('grok-subscription-panel');
  if (!panel) return;
  var provider = editingProviderRecord(),
    active = provider && provider.protocol === 'grok-subscription',
    auth = grokSubscriptionAuth(),
    login = _grokLogin;
  panel.hidden = !active;
  ['s-api-url', 's-api-key'].forEach(function (id) {
    if ($(id)) $(id).closest('.fg').hidden = active;
  });
  if ($('s-api-key-manager')) $('s-api-key-manager').hidden = active;
  document.querySelectorAll('[data-grok-login]').forEach(function (block, index) {
    if (!block.firstChild) block.innerHTML = grokLoginBlockHtml(index);
    var part = function (name) {
      return block.querySelector('.grok-' + name);
    };
    part('account').textContent = auth ? '已登录：' + (auth.account || 'Grok 账号') : '尚未登录';
    part('auth-status').textContent = _grokAuthStatus || '使用手机当前网络直连 xAI，登录状态只保存在本机。';
    part('login-btn').hidden = !!auth || !!login;
    part('logout-btn').hidden = !auth;
    part('cancel-btn').hidden = !login;
    part('device-panel').hidden = !(login && login.code);
    part('device-code').value = (login && login.code) || '';
    var link = part('device-link');
    if (login && login.url) {
      link.href = login.url;
      link.textContent = 'accounts.x.ai/oauth2/device';
    } else {
      link.removeAttribute('href');
      link.textContent = '';
    }
  });
}
