// ===== TavernHelper-compatible audio runtime and card background music =====
var _tavernAudioChatKey = '',
  _cardBgmPanelOpen = false;
var _tavernAudioRuntime = {
  bgm: { audio: null, src: '', title: '', playing: false, progress: 0, error: '' },
  ambient: { audio: null, src: '', title: '', playing: false, progress: 0, error: '' },
};

function currentTavernAudioChatKey() {
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  return char && session ? String(char.id) + ':' + String(session.id) : '';
}
function tavernAudioType(type) {
  type = String(type || '').toLowerCase();
  if (type !== 'bgm' && type !== 'ambient') throw new Error('音频类型必须是 bgm 或 ambient');
  return type;
}
function tavernAudioClone(value) {
  if (value == null) return value;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
function tavernAudioSession() {
  var char = typeof getChar === 'function' ? getChar() : null;
  return char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
}
function tavernAudioPlaylist(type, create) {
  type = tavernAudioType(type);
  var session = tavernAudioSession();
  if (!session) return [];
  var tree = session.tavernHelperAudio;
  if ((!tree || typeof tree !== 'object' || Array.isArray(tree)) && create) {
    tree = {};
    session.tavernHelperAudio = tree;
  }
  var rows = tree && tree[type];
  if (!Array.isArray(rows) && create) {
    rows = [];
    tree[type] = rows;
  }
  return Array.isArray(rows) ? rows : [];
}
function tavernAudioSettings(type) {
  type = tavernAudioType(type);
  var fallback = { enabled: true, mode: type === 'bgm' ? 'repeat_all' : 'play_one_and_stop', muted: false, volume: 50 },
    settings = typeof D !== 'undefined' && D && D.settings,
    root = settings && settings.tavernHelperExtensionSettings,
    helper = root && root.tavern_helper,
    audio = helper && helper.audio,
    row = audio && audio[type];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return fallback;
  var mode =
      ['repeat_one', 'repeat_all', 'shuffle', 'play_one_and_stop'].indexOf(String(row.mode || '')) >= 0
        ? String(row.mode)
        : fallback.mode,
    volume = Number(row.volume);
  return {
    enabled: row.enabled === undefined ? true : row.enabled === true,
    mode: mode,
    muted: row.muted === true,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 50,
  };
}
function tavernAudioWritableSettings(type) {
  type = tavernAudioType(type);
  if (typeof D === 'undefined' || !D || !D.settings) throw new Error('设置尚未加载');
  var root = D.settings.tavernHelperExtensionSettings;
  if (!root || typeof root !== 'object' || Array.isArray(root)) root = D.settings.tavernHelperExtensionSettings = {};
  var helper = root.tavern_helper;
  if (!helper || typeof helper !== 'object' || Array.isArray(helper)) helper = root.tavern_helper = {};
  var audio = helper.audio;
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) audio = helper.audio = { enabled: true };
  var row = audio[type];
  if (!row || typeof row !== 'object' || Array.isArray(row)) row = audio[type] = tavernAudioSettings(type);
  return row;
}
function tavernAudioPersist(section) {
  if (typeof saveData !== 'function') return;
  try {
    var pending = saveData(section);
    if (pending && typeof pending.catch === 'function')
      pending.catch(function (error) {
        tavernAudioFeedback('音频设置保存失败：' + String((error && error.message) || error), true);
      });
  } catch (error) {
    tavernAudioFeedback('音频设置保存失败：' + String((error && error.message) || error), true);
  }
}
function tavernAudioTitle(url) {
  var source = String(url || ''),
    tail = source.split('/').pop() || source,
    base = tail.split(/[?#]/)[0],
    title = base.split('.')[0] || base || source;
  try {
    return decodeURIComponent(title);
  } catch (_) {
    return title;
  }
}
function tavernAudioNormalizeItem(item) {
  var row = item && typeof item === 'object' ? item : { url: item },
    url = String((row && row.url) || '').trim();
  if (!url) throw new Error('音频链接不能为空');
  return { title: String(row.title || '').trim() || tavernAudioTitle(url), url: url };
}
function tavernAudioRuntime(type) {
  return _tavernAudioRuntime[tavernAudioType(type)];
}
function tavernAudioElement(type, recreate) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type);
  if (runtime.audio && !recreate) return runtime.audio;
  if (runtime.audio) {
    try {
      runtime.audio.pause();
      runtime.audio.removeAttribute('src');
      runtime.audio.load();
    } catch (_) {}
  }
  var audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.setAttribute('data-yeyu-audio-type', type);
  audio.addEventListener('play', function () {
    runtime.error = '';
    refreshCardBgmUi();
  });
  audio.addEventListener('pause', function () {
    refreshCardBgmUi();
  });
  audio.addEventListener('timeupdate', function () {
    tavernAudioUpdateProgress(type);
  });
  audio.addEventListener('loadedmetadata', function () {
    tavernAudioUpdateProgress(type);
  });
  audio.addEventListener('durationchange', function () {
    tavernAudioUpdateProgress(type);
  });
  audio.addEventListener('ended', function () {
    tavernAudioEnded(type);
  });
  audio.addEventListener('error', function () {
    runtime.error = '无法播放，请检查音频链接或网络';
    tavernAudioFeedback((type === 'bgm' ? '背景音乐' : '环境音') + '播放失败，请检查链接或网络', true);
    refreshCardBgmUi();
  });
  runtime.audio = audio;
  if (recreate) {
    var settings = tavernAudioSettings(type);
    audio.muted = settings.muted;
    audio.volume = settings.volume / 100;
    audio.loop = settings.mode === 'repeat_one';
  } else tavernAudioApplySettings(type);
  return audio;
}
function tavernAudioBeginPlayback(type) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type),
    audio = runtime.audio,
    settings = tavernAudioSettings(type);
  if (!audio || !runtime.src || !runtime.playing || !settings.enabled) return;
  var src = runtime.src,
    label = type === 'bgm' ? '背景音乐' : '环境音',
    playback;
  // A play() interrupted by pause, a track switch or a session change is superseded, not a failure.
  function fail(error) {
    if ((error && error.name === 'AbortError') || runtime.audio !== audio || runtime.src !== src || !runtime.playing)
      return;
    var blocked = error && error.name === 'NotAllowedError';
    runtime.error = blocked ? '系统阻止了自动播放，请点击播放按钮开始' : '无法开始播放';
    tavernAudioFeedback(label + (blocked ? '被系统阻止自动播放，请点击播放按钮开始' : '无法开始播放'), true);
    refreshCardBgmUi();
  }
  try {
    playback = audio.play();
  } catch (error) {
    fail(error);
  }
  if (playback && typeof playback.catch === 'function') playback.catch(fail);
}
function tavernAudioApplySettings(type) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type),
    audio = runtime.audio,
    settings = tavernAudioSettings(type);
  if (!audio) return settings;
  audio.muted = settings.muted;
  audio.volume = settings.volume / 100;
  audio.loop = settings.mode === 'repeat_one';
  if (!settings.enabled) {
    if (!audio.paused) audio.pause();
  } else if (runtime.playing && runtime.src && audio.paused) tavernAudioBeginPlayback(type);
  return settings;
}
function tavernAudioUpdateProgress(type) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type),
    audio = runtime.audio,
    duration = audio && Number(audio.duration),
    time = (audio && Number(audio.currentTime)) || 0;
  runtime.progress =
    Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
  refreshCardAudioProgress(type, 'card-' + type);
}
function tavernAudioNext(type) {
  type = tavernAudioType(type);
  var rows = tavernAudioPlaylist(type, false),
    runtime = tavernAudioRuntime(type);
  if (!rows.length) return null;
  var current = rows.findIndex(function (row) {
      return String((row && row.url) || '') === runtime.src;
    }),
    settings = tavernAudioSettings(type),
    index = settings.mode === 'shuffle' ? Math.floor(Math.random() * rows.length) : (current + 1) % rows.length;
  return rows[Math.max(0, index)] || null;
}
function tavernAudioEnded(type) {
  type = tavernAudioType(type);
  var settings = tavernAudioSettings(type),
    runtime = tavernAudioRuntime(type);
  if (settings.mode === 'play_one_and_stop') {
    pauseAudio(type);
    return;
  }
  if (settings.mode === 'repeat_one' && runtime.src) {
    tavernAudioStart(type, { title: runtime.title, url: runtime.src });
    return;
  }
  var next = tavernAudioNext(type);
  if (next) tavernAudioStart(type, next);
  else pauseAudio(type);
}
function tavernAudioFeedback(message, error) {
  var node = typeof $ === 'function' ? $('card-audio-feedback') : null;
  if (node) {
    node.textContent = String(message || '');
    node.classList.toggle('error', error === true);
  }
  if (error && typeof toast === 'function') toast(String(message || '音频播放失败'), 'err');
}
function tavernAudioStart(type, item) {
  type = tavernAudioType(type);
  var normalized = tavernAudioNormalizeItem(item),
    runtime = tavernAudioRuntime(type),
    audio = tavernAudioElement(type, type === 'bgm');
  _tavernAudioChatKey = currentTavernAudioChatKey();
  runtime.src = normalized.url;
  runtime.title = normalized.title;
  runtime.playing = true;
  runtime.progress = 0;
  runtime.error = '';
  try {
    audio.pause();
    audio.src = normalized.url;
    audio.currentTime = 0;
  } catch (_) {}
  var settings = tavernAudioApplySettings(type);
  if (!settings.enabled)
    tavernAudioFeedback((type === 'bgm' ? '背景音乐' : '环境音') + '已停用，启用后将继续播放', false);
  refreshCardBgmUi();
}

function playAudio(type, audio) {
  type = tavernAudioType(type);
  var item = tavernAudioNormalizeItem(audio),
    rows = tavernAudioPlaylist(type, true),
    existing = rows.find(function (row) {
      return String((row && row.title) || '') === item.title || String((row && row.url) || '') === item.url;
    });
  if (existing) {
    existing.title = item.title;
    existing.url = item.url;
  } else rows.push(item);
  tavernAudioPersist('sessions');
  tavernAudioStart(type, item);
}
function pauseAudio(type) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type),
    audio = runtime.audio;
  if (audio) audio.pause();
  runtime.playing = false;
  runtime.error = '';
  refreshCardBgmUi();
}
function getAudioList(type) {
  return tavernAudioClone(tavernAudioPlaylist(type, false).map(tavernAudioNormalizeItem));
}
function replaceAudioList(type, audioList) {
  type = tavernAudioType(type);
  var rows = tavernAudioPlaylist(type, true);
  rows.splice.apply(
    rows,
    [0, rows.length].concat((Array.isArray(audioList) ? audioList : []).map(tavernAudioNormalizeItem))
  );
  tavernAudioPersist('sessions');
  refreshCardBgmUi();
}
function appendAudioList(type, audioList) {
  type = tavernAudioType(type);
  var rows = tavernAudioPlaylist(type, true);
  rows.push.apply(rows, (Array.isArray(audioList) ? audioList : []).map(tavernAudioNormalizeItem));
  tavernAudioPersist('sessions');
  refreshCardBgmUi();
}
function getAudioSettings(type) {
  return tavernAudioClone(tavernAudioSettings(type));
}
function setAudioSettings(type, settings) {
  type = tavernAudioType(type);
  settings = settings && typeof settings === 'object' ? settings : {};
  var row = tavernAudioWritableSettings(type);
  if (settings.enabled !== undefined) row.enabled = settings.enabled === true;
  if (settings.mode !== undefined) {
    var mode = String(settings.mode);
    if (['repeat_one', 'repeat_all', 'shuffle', 'play_one_and_stop'].indexOf(mode) < 0)
      throw new Error('音频播放模式无效');
    row.mode = mode;
  }
  if (settings.muted !== undefined) row.muted = settings.muted === true;
  if (settings.volume !== undefined) {
    var volume = Number(settings.volume);
    row.volume = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 0;
    row.muted = row.volume === 0;
  }
  tavernAudioApplySettings(type);
  if (typeof cardFrontendSyncAudioSettings === 'function') cardFrontendSyncAudioSettings();
  tavernAudioPersist('meta');
  refreshCardBgmUi();
}
function getCurrentAudio(type) {
  type = tavernAudioType(type);
  tavernAudioUpdateProgress(type);
  var runtime = tavernAudioRuntime(type),
    current = tavernAudioPlaylist(type, false).find(function (row) {
      return String((row && row.url) || '') === runtime.src;
    });
  return {
    src: String(runtime.src || ''),
    title: current ? String(current.title || '') : String(runtime.title || ''),
    playing: !!runtime.playing,
    progress: Number(runtime.progress) || 0,
  };
}

function tavernAudioSelect(type, url) {
  type = tavernAudioType(type);
  var source = String(url || '').trim();
  if (!source) throw new Error('音频链接不能为空');
  var rows = tavernAudioPlaylist(type, true),
    item = rows.find(function (row) {
      return String((row && row.url) || '') === source;
    });
  if (!item) {
    item = tavernAudioNormalizeItem({ url: source });
    rows.push(item);
    tavernAudioPersist('sessions');
  }
  tavernAudioStart(type, item);
}
function tavernAudioImport(type, urls, play) {
  type = tavernAudioType(type);
  var existing = tavernAudioPlaylist(type, true),
    seen = new Set(
      existing.map(function (row) {
        return String((row && row.url) || '');
      })
    ),
    added = [];
  String(urls || '')
    .split(',')
    .map(function (url) {
      return url.trim();
    })
    .filter(Boolean)
    .forEach(function (url) {
      if (seen.has(url)) return;
      seen.add(url);
      var item = tavernAudioNormalizeItem({ url: url });
      existing.push(item);
      added.push(item);
    });
  if (added.length) tavernAudioPersist('sessions');
  if (play !== false && added[0]) tavernAudioStart(type, added[0]);
  return added;
}
function tavernAudioSetPlaying(type, playing) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type);
  if (playing) {
    runtime.playing = true;
    if (runtime.src) tavernAudioApplySettings(type);
    refreshCardBgmUi();
  } else pauseAudio(type);
}
function tavernAudioSetSlashMode(type, mode) {
  var mapped = { single: 'repeat_one', repeat: 'repeat_all', random: 'shuffle', stop: 'play_one_and_stop' }[
    String(mode || '').toLowerCase()
  ];
  if (!mapped) throw new Error('音频播放模式必须是 repeat、random、single 或 stop');
  setAudioSettings(type, { mode: mapped });
}

function tavernAudioClearRuntime(type) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type),
    audio = runtime.audio;
  runtime.playing = false;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  runtime.src = '';
  runtime.title = '';
  runtime.progress = 0;
  runtime.error = '';
  if (type === 'bgm') _cardBgmPanelOpen = false;
  refreshCardBgmUi();
}
function syncTavernAudioSession() {
  syncSpeechSession();
  var chatKey = currentTavernAudioChatKey();
  if (chatKey !== _tavernAudioChatKey) {
    tavernAudioClearRuntime('bgm');
    tavernAudioClearRuntime('ambient');
    _tavernAudioChatKey = chatKey;
  }
}

function toggleCardBgmPanel(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  if (!tavernAudioRuntime('bgm').src && !tavernAudioRuntime('ambient').src) return false;
  _cardBgmPanelOpen = !_cardBgmPanelOpen;
  refreshCardBgmUi();
  return _cardBgmPanelOpen;
}
function closeCardBgmPanel() {
  if (!_cardBgmPanelOpen) return;
  _cardBgmPanelOpen = false;
  refreshCardBgmUi();
}
function toggleCardAudioPause(type) {
  type = tavernAudioType(type);
  var runtime = tavernAudioRuntime(type);
  if (!runtime.src) return false;
  if (runtime.playing) pauseAudio(type);
  // Resuming keeps the current position; only a released media element needs the
  // track-change path, which rewinds to the start.
  else if (runtime.audio) tavernAudioSetPlaying(type, true);
  else tavernAudioStart(type, { title: runtime.title, url: runtime.src });
  return true;
}
function toggleCardAudioMute(type) {
  var settings = getAudioSettings(type);
  setAudioSettings(type, { muted: !settings.muted });
}
function setCardAudioVolume(type, value) {
  setAudioSettings(type, { volume: Number(value) });
}
function setCardAudioMode(type, value) {
  setAudioSettings(type, { mode: String(value) });
}
function seekCardAudio(type, value) {
  type = tavernAudioType(type);
  var audio = tavernAudioElement(type),
    duration = Number(audio.duration);
  if (Number.isFinite(duration) && duration > 0)
    audio.currentTime = Math.max(0, Math.min(duration, Number(value) || 0));
  tavernAudioUpdateProgress(type);
}
function cardBgmTime(value) {
  var seconds = Math.max(0, Math.floor(Number(value) || 0)),
    minutes = Math.floor(seconds / 60);
  return minutes + ':' + String(seconds % 60).padStart(2, '0');
}
function refreshCardAudioProgress(type, prefix) {
  var runtime = tavernAudioRuntime(type),
    audio = runtime.audio,
    range = $(prefix + '-progress'),
    current = $(prefix + '-current'),
    durationNode = $(prefix + '-duration'),
    duration = audio && Number(audio.duration),
    time = (audio && Number(audio.currentTime)) || 0;
  if (range) {
    range.max = Number.isFinite(duration) && duration > 0 ? String(duration) : '0';
    range.value = Number.isFinite(duration) && duration > 0 ? String(Math.min(time, duration)) : '0';
    range.disabled = !(Number.isFinite(duration) && duration > 0);
  }
  if (current) current.textContent = cardBgmTime(time);
  if (durationNode)
    durationNode.textContent = Number.isFinite(duration) && duration > 0 ? cardBgmTime(duration) : '0:00';
}
function refreshCardAudioRow(type, prefix, label) {
  var runtime = tavernAudioRuntime(type),
    settings = tavernAudioSettings(type),
    actual = !!(runtime.playing && settings.enabled && runtime.audio && !runtime.audio.paused),
    title = $(prefix + '-track'),
    status = $(prefix + '-status'),
    pause = $(prefix + '-pause'),
    mute = $(prefix + '-mute'),
    volume = $(prefix + '-volume'),
    mode = $(prefix + '-mode');
  if (title) title.textContent = runtime.title || '未选择音频';
  if (status)
    status.textContent =
      runtime.error ||
      (!runtime.src
        ? '等待音频'
        : !settings.enabled
          ? runtime.playing
            ? '已停用，启用后播放'
            : '已停用'
          : actual
            ? '正在播放'
            : runtime.playing
              ? '正在连接'
              : '已暂停');
  if (pause) {
    pause.textContent = runtime.playing ? '暂停' : '播放';
    pause.disabled = !runtime.src;
    pause.setAttribute('aria-label', (runtime.playing ? '暂停 ' : '播放 ') + (runtime.title || label));
  }
  if (mute) {
    mute.textContent = settings.muted ? '取消静音' : '静音';
    mute.setAttribute('aria-pressed', settings.muted ? 'true' : 'false');
  }
  if (volume) volume.value = String(settings.volume);
  if (mode) mode.value = settings.mode;
  refreshCardAudioProgress(type, prefix);
}
function refreshCardBgmPanel() {
  var panel = $('card-bgm-panel');
  if (!panel) return;
  var hasTrack = !!(tavernAudioRuntime('bgm').src || tavernAudioRuntime('ambient').src);
  var visible = _cardBgmPanelOpen && hasTrack;
  transitionUiVisibility(panel, visible, function () {
    panel.hidden = !visible;
    panel.classList.toggle('open', visible);
  });
  refreshCardAudioRow('bgm', 'card-bgm', '背景音乐');
  refreshCardAudioRow('ambient', 'card-ambient', '环境音');
  if (typeof syncAppSelects === 'function') syncAppSelects(panel);
}
function refreshCardBgmUi() {
  var bgm = tavernAudioRuntime('bgm'),
    ambient = tavernAudioRuntime('ambient'),
    playing = !!(
      (bgm.playing && tavernAudioSettings('bgm').enabled && bgm.audio && !bgm.audio.paused) ||
      (ambient.playing && tavernAudioSettings('ambient').enabled && ambient.audio && !ambient.audio.paused)
    ),
    hasTrack = !!(bgm.src || ambient.src),
    shell = $('ch-avatar-shell'),
    button = shell;
  if (shell) shell.classList.toggle('is-playing', playing);
  if (button) {
    button.disabled = !hasTrack;
    button.setAttribute('aria-expanded', _cardBgmPanelOpen ? 'true' : 'false');
    button.title = hasTrack ? (_cardBgmPanelOpen ? '收起音频播放器' : '打开音频播放器') : '';
  }
  refreshCardBgmPanel();
}
