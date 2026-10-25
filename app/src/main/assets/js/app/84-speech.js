/* global YeyuTextDiff */
// Cloud speech owns its requests, playback and session-only cache. It never writes messages/cards.
var _speechRun = null,
  _speechEpoch = 0,
  _speechCache = new Map(),
  _speechChatKey = '';

function speechSettings() {
  return D.settings.speech || {};
}
function speechDefaultVoice(protocol) {
  return protocol === 'openai'
    ? {
        apiUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        speed: 1,
        instructions: '',
      }
    : {
        apiUrl: 'https://api.minimax.chat/v1',
        apiKey: '',
        model: 'speech-2.6-hd',
        voice: 'female-shaonv',
        speed: 1,
        vol: 1,
        pitch: 0,
        emotion: '',
        language: 'auto',
        normalization: '',
        latex: false,
        modifyPitch: 0,
        intensity: 0,
        timbre: 0,
        effect: '',
        pronunciation: '',
        mix: '',
      };
}
function speechConfiguration(char) {
  var settings = speechSettings();
  return (char && settings.characters && settings.characters[char.id]) || settings.voice || { protocol: 'minimax' };
}
function speechResolvedVoice(config) {
  var protocol = config.protocol === 'openai' ? 'openai' : 'minimax';
  return { protocol: protocol, voice: Object.assign(speechDefaultVoice(protocol), config[protocol] || {}) };
}
function speechRequest(config, text) {
  var resolved = speechResolvedVoice(config),
    protocol = resolved.protocol,
    voice = resolved.voice,
    url = new URL(String(voice.apiUrl).trim()),
    body;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('语音地址需为 HTTP(S) 地址，凭据请填在 API Key 中');
  var suffix = protocol === 'openai' ? '/audio/speech' : '/t2a_v2';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith(suffix)) {
    if (!url.pathname) url.pathname = '/v1';
    url.pathname += suffix;
  }
  url.hash = '';
  if (!String(voice.model).trim()) throw new Error('请填写语音模型');
  function number(key, min, max, integer) {
    var value = Number(voice[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
      throw new Error('语音参数 ' + key + ' 超出范围（' + min + '～' + max + '）');
    return value;
  }
  if (protocol === 'openai') {
    var voiceId = String(voice.voice || '').trim();
    if (!voiceId) throw new Error('请填写音色 ID');
    body = {
      model: voice.model.trim(),
      input: text,
      voice: voice.customVoice ? { id: voiceId } : voiceId,
      speed: number('speed', 0.25, 4),
      response_format: 'mp3',
    };
    if (String(voice.instructions || '').trim()) body.instructions = voice.instructions.trim();
  } else {
    if (text.length >= 10000) throw new Error('MiniMax 单条朗读需少于 10000 字符，请缩短消息或切到只读对白');
    body = {
      model: voice.model.trim(),
      text: text,
      stream: false,
      output_format: 'hex',
      subtitle_enable: false,
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      voice_setting: {
        voice_id: String(voice.voice || '').trim(),
        speed: number('speed', 0.5, 2),
        vol: number('vol', 0, 10),
        pitch: number('pitch', -12, 12, true),
        latex_read: !!voice.latex,
      },
      voice_modify: {
        pitch: number('modifyPitch', -100, 100, true),
        intensity: number('intensity', -100, 100, true),
        timbre: number('timbre', -100, 100, true),
      },
    };
    if (body.voice_setting.vol <= 0) throw new Error('音量需大于 0，且不超过 10');
    if (voice.emotion) body.voice_setting.emotion = voice.emotion;
    if (voice.language) body.language_boost = voice.language;
    if (voice.normalization) body.text_normalization_mode = voice.normalization;
    if (voice.effect) body.voice_modify.sound_effects = voice.effect;
    if (String(voice.pronunciation || '').trim())
      body.pronunciation_dict = {
        tone: voice.pronunciation
          .split('\n')
          .map(function (line) {
            return line.trim();
          })
          .filter(Boolean),
      };
    if (String(voice.mix || '').trim()) {
      body.timbre_weights = voice.mix
        .split('\n')
        .filter(function (line) {
          return line.trim();
        })
        .map(function (line) {
          var match = /^(.+)\s*\/\s*(\d+)\s*$/.exec(line.trim());
          if (!match || Number(match[2]) < 1 || Number(match[2]) > 100)
            throw new Error('混合音色每行填写 音色ID/权重，权重为 1～100');
          return { voice_id: match[1].trim(), weight: Number(match[2]) };
        });
      if (body.timbre_weights.length > 4) throw new Error('最多混合 4 个音色');
      body.voice_setting.voice_id = '';
    } else if (!body.voice_setting.voice_id) throw new Error('请填写音色 ID');
  }
  return { protocol: protocol, url: url.href, key: String(voice.apiKey || '').trim(), body: body };
}

async function speechFetchAudio(request, signal) {
  var response = await fetch(request.url, {
    method: 'POST',
    signal: signal,
    cache: 'no-store',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      request.key ? { Authorization: 'Bearer ' + request.key } : {}
    ),
    body: JSON.stringify(request.body),
  });
  // Never surface provider response bodies: a proxy may echo the submitted text or credentials.
  if (!response.ok) throw new Error('语音服务请求失败（HTTP ' + response.status + '）');
  var blob;
  if (request.protocol === 'minimax') {
    var result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error('语音服务返回的内容不是有效 JSON');
    }
    if (!result || typeof result !== 'object') throw new Error('语音服务未返回音频对象');
    var code = result.base_resp && result.base_resp.status_code;
    if (code != null && Number(code) !== 0) throw new Error('MiniMax 语音合成失败（错误码 ' + Number(code) + '）');
    var hex = result.data && result.data.audio;
    if (typeof hex !== 'string' || !hex || hex.length % 2 || !/^[\da-f]+$/i.test(hex))
      throw new Error('语音服务未返回有效音频');
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    blob = new Blob([bytes], { type: 'audio/mpeg' });
  } else {
    if (/json|text\//i.test(response.headers.get('Content-Type') || ''))
      throw new Error('语音服务返回了文本，未返回音频');
    blob = new Blob([await response.arrayBuffer()], { type: 'audio/mpeg' });
  }
  if (!blob.size) throw new Error('语音服务返回的音频为空');
  return blob;
}

function stopSpeech() {
  _speechEpoch++;
  var run = _speechRun;
  _speechRun = null;
  if (run) {
    run.controller.abort();
    if (run.audio) {
      run.audio.pause();
      run.audio.removeAttribute('src');
      run.audio.load();
    }
    if (run.url) URL.revokeObjectURL(run.url);
  }
  refreshSpeechUi();
}
function refreshSpeechUi() {
  var button = $('speech-auto-btn'),
    enabled = speechSettings().auto === true;
  if (button) {
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? '关闭自动朗读' : '开启自动朗读');
    button.title = enabled ? '关闭自动朗读' : '开启自动朗读';
  }
  var messages = getMsgs(D.currentCharId);
  document.querySelectorAll('[data-speech-index]').forEach(function (node) {
    var active = !!(_speechRun && _speechRun.message === messages[Number(node.dataset.speechIndex)]);
    if (node.dataset.speechActive === String(active)) return;
    node.dataset.speechActive = String(active);
    node.innerHTML = uiIcon(active ? 'stop' : 'volume') + (active ? ' 停止' : ' 朗读');
  });
}
function syncSpeechSession() {
  var char = getChar(),
    session = char && getActiveSession(char.id),
    key = currentTavernAudioChatKey(),
    run = _speechRun;
  if (
    _speechChatKey !== key ||
    (run &&
      session &&
      (run.tail !== session.msgs[session.msgs.length - 1] ||
        (run.message && (!session.msgs.includes(run.message) || run.content !== run.message.content))))
  ) {
    _speechChatKey = key;
    stopSpeech();
  }
  refreshSpeechUi();
}
async function toggleAutoSpeech() {
  stopSpeech();
  var settings = speechSettings(),
    before = settings.auto,
    next = before !== true;
  D.settings.speech = settings;
  settings.auto = next;
  refreshSpeechUi();
  try {
    await saveData('meta');
  } catch (_) {
    settings.auto = before;
    refreshSpeechUi();
    toast('自动朗读开关保存失败', 'err');
  }
}

// Walk the live DOM, including same-origin card frames. Layout visibility and closed details are
// evaluated before text collection; controls, metadata, reasoning and story options never speak.
function speechVisibleText(root) {
  var skip =
    'script,style,template,noscript,button,input,select,textarea,svg,canvas,audio,video,summary,[role="button"],[risu-trigger],[risu-btn],[hidden],[aria-hidden="true"],.msg-actions,.msg-bubble-meta,.stream-reasoning-slot,.story-options,.msg-options,.risu-choice';
  function visit(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || node.matches(skip) || (node !== root && node.hasAttribute('onclick'))) return '';
    var view = node.ownerDocument.defaultView,
      style = view && view.getComputedStyle(node);
    if (
      style &&
      (style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0')
    )
      return '';
    if (node.tagName === 'DETAILS' && !node.open) return '';
    if (node.tagName === 'IFRAME') {
      try {
        return node.contentDocument && node.contentDocument.body ? visit(node.contentDocument.body) : '';
      } catch (_) {
        return '';
      }
    }
    if (node.tagName === 'BR') return '\n';
    var text = Array.from(node.childNodes).map(visit).join('');
    if (node.tagName === 'LI') {
      var list = node.parentElement;
      text =
        (list && list.tagName === 'OL'
          ? String(node.value || (Number(list.start) || 1) + Array.from(list.children).indexOf(node)) + '. '
          : '• ') + text;
    }
    return style && /^(block|flex|grid|table|list-item)/.test(style.display) ? '\n' + text + '\n' : text;
  }
  return speechNarrativeText(
    visit(root)
      .replace(/[ \t]+/g, ' ')
      .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')
      .trim()
  );
}
// Cards also render choices as ordinary numbered text, not just interactive controls. Keep offsets
// while excluding labelled choice sections, so continuation mapping still refers to displayed text.
function speechNarrativeText(text) {
  var lines = text.split('\n'),
    heading =
      /^[#*\s『「【\[]*(?:剧情(?:发展|选项|选择)|行动(?:选项|选择)|回复选项|可选行动|选项|choices|options)[\s』」】\]:：*]*$/i,
    numbered = /^\s*(?:\d+[.．、)）]|[A-Da-d][.、)]|[-•])\s*/,
    metadata = /^[『「【\[]\s*(?:日期|时间|地点|场景|角色状态|状态栏)\s*[:：]/,
    clear = function (index) {
      lines[index] = lines[index].replace(/[^\s]/g, ' ');
    };
  for (var i = 0; i < lines.length; i++) {
    if (metadata.test(lines[i])) {
      clear(i);
      continue;
    }
    if (!heading.test(lines[i].trim())) continue;
    var start = i + 1;
    while (start < lines.length && !lines[start].trim()) start++;
    if (!numbered.test(lines[start] || '')) continue;
    clear(i);
    for (i = start; i < lines.length; i++) {
      if (/^\s*(?:#{1,6}\s|[『「【\[][^\n]+[』」】\]]\s*$)/.test(lines[i]) && !numbered.test(lines[i])) {
        i--;
        break;
      }
      if (!lines[i].trim()) {
        var next = i + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (!numbered.test(lines[next] || '')) break;
      }
      clear(i);
    }
  }
  return lines.join('\n');
}
function speechDialogue(text, from) {
  text = String(text || '');
  var matches = text.matchAll(
    /“([^”]*)(?:”|$)|「([^」]*)(?:」|$)|『([^』]*)(?:』|$)|"([^"]*)(?:"|$)|‘([^’]*)(?:’|$)|(?<![\p{L}\p{N}])'([^'\n]+)'/gu
  );
  return Array.from(matches, function (match) {
    var quoted = match.slice(1).find(function (part) {
      return part !== undefined;
    });
    return quoted.slice(Math.max(0, (from || 0) - match.index - 1)).trim();
  })
    .filter(Boolean)
    .join('\n');
}
function speechMessageRoot(index) {
  var row = document.querySelector('#chat-messages [data-msg-idx="' + index + '"]');
  return row && (row.querySelector('.stream-content-slot') || row.querySelector('.msg-bubble'));
}
function speechReadMessage(index) {
  var root = speechMessageRoot(index),
    text = root ? speechVisibleText(root) : '';
  return speechSettings().readFull ? text : speechDialogue(text);
}
async function speechPlay(text, char, message, config, expectedEpoch) {
  if (expectedEpoch != null && expectedEpoch !== _speechEpoch) return;
  stopSpeech();
  text = String(text).trim();
  if (document.hidden || !text) return false;
  var session = char && getActiveSession(char.id),
    run = {
      controller: new AbortController(),
      message: message,
      content: message && message.content,
      tail: session && session.msgs[session.msgs.length - 1],
    };
  _speechRun = run;
  refreshSpeechUi();
  try {
    var request = speechRequest(config || speechConfiguration(char), text),
      cacheKey = JSON.stringify([request.url, request.key, request.body]),
      blob = _speechCache.get(cacheKey);
    if (!blob) {
      blob = await speechFetchAudio(request, run.controller.signal);
      if (_speechRun !== run) return false;
      _speechCache.set(cacheKey, blob);
    }
    if (_speechRun !== run || document.hidden) return false;
    run.url = URL.createObjectURL(blob);
    run.audio = new Audio(run.url);
    run.audio.onended = function () {
      if (_speechRun === run) stopSpeech();
    };
    run.audio.onerror = function () {
      if (_speechRun === run) {
        stopSpeech();
        toast('语音音频无法播放', 'err');
      }
    };
    await run.audio.play();
    return true;
  } catch (error) {
    if (_speechRun === run) {
      stopSpeech();
      if (error.name !== 'AbortError')
        toast(error instanceof TypeError ? '语音连接失败，请检查地址和网络' : error.message, 'err');
    }
    return false;
  }
}
async function speakMessage(index) {
  var char = getChar(),
    session = char && getActiveSession(char.id),
    message = session && session.msgs[index];
  if (!message) return;
  if (_speechRun && _speechRun.message === message) {
    stopSpeech();
    return;
  }
  stopSpeech();
  var epoch = _speechEpoch,
    content = message.content;
  await speechWaitForFrames(index);
  if (
    epoch !== _speechEpoch ||
    getChar() !== char ||
    getActiveSession(char.id) !== session ||
    session.msgs[index] !== message ||
    content !== message.content
  )
    return;
  var text = speechReadMessage(index);
  if (!text) {
    toast(
      speechSettings().readFull ? '当前显示没有可朗读文字' : '当前显示没有对白，可在语音设置中切换为读全文',
      'info'
    );
    return;
  }
  await speechPlay(text, char, message, null, epoch);
}
async function speechWaitForFrames(index) {
  var root = speechMessageRoot(index);
  if (!root) return;
  await Promise.all(
    Array.from(root.querySelectorAll('iframe')).map(function (frame) {
      try {
        if (
          frame.contentDocument &&
          frame.contentDocument.readyState === 'complete' &&
          frame.contentDocument.URL !== 'about:blank'
        )
          return;
      } catch (_) {
        return;
      }
      return new Promise(function (resolve) {
        var timer = setTimeout(done, 5000);
        function done() {
          clearTimeout(timer);
          frame.removeEventListener('load', done);
          resolve();
        }
        frame.addEventListener('load', done, { once: true });
      });
    })
  );
}
function speechGenerationStarted(target) {
  stopSpeech();
  target.speechEpoch = _speechEpoch;
}
// Project the persisted continuation boundary through Markdown/HTML/regex display edits. This also
// handles continuation of a translated message: the old translated DOM is not mistaken for new speech.
function speechDisplayOffset(source, displayed, offset) {
  var left = 0,
    right = 0;
  for (var part of YeyuTextDiff.diffChars(source, displayed)) {
    if (left >= offset) return right;
    if (!part.added) {
      if (left + part.value.length >= offset) return right + (part.removed ? 0 : offset - left);
      left += part.value.length;
    }
    if (!part.removed) right += part.value.length;
  }
  return right;
}
async function speechGenerated(target, char, session, message) {
  if (!speechSettings().auto || messageIsIncomplete(message) || target.speechEpoch !== _speechEpoch) return;
  var epoch = _speechEpoch;
  if (isRisuCharacter(char)) await risuAwaitDisplaySync(char, session);
  await speechWaitForFrames(session.msgs.indexOf(message));
  if (epoch !== _speechEpoch || !generationTargetStillLive(target, session)) return;
  var index = session.msgs.indexOf(message),
    root = speechMessageRoot(index),
    displayed = root ? speechVisibleText(root) : '',
    from =
      target.mode === 'continue' ? speechDisplayOffset(message.content, displayed, target.speechSourceOffset || 0) : 0,
    text = speechSettings().readFull ? displayed.slice(from) : speechDialogue(displayed, from);
  if (text.trim()) await speechPlay(text, char, message, null, epoch);
}
async function speechCommand(text, char) {
  if (char && getChar() !== char) return false;
  // Explicit speech commands already identify what to say; unquoted command arguments are speech.
  var host = document.createElement('div');
  host.innerHTML = md(String(text || ''));
  host
    .querySelectorAll('script,style,template,button,input,select,textarea,details:not([open])')
    .forEach(function (node) {
      node.remove();
    });
  return speechPlay(host.textContent.trim(), char || getChar(), null);
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) stopSpeech();
});
window.addEventListener('pagehide', stopSpeech);
