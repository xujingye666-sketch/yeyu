// ===== About and release update notice =====
// Update checks read only the public latest-release record of the project; they send no chat, key or
// setting. Only a stable release (vX.Y.Z, not draft or prerelease) newer than this build counts.
const APP_REPOSITORY = 'xujingye666-sketch/yeyu';
const APP_PROJECT_URL = 'https://github.com/' + APP_REPOSITORY;
const APP_LATEST_RELEASE_API = 'https://api.github.com/repos/' + APP_REPOSITORY + '/releases/latest';
const APP_CONTACT_EMAIL = 'xujingye666@gmail.com';
const APP_UPDATE_STATE_KEY = 'yeyu_update_check_v1';
const APP_UPDATE_AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APP_UPDATE_TIMEOUT_MS = 15000;
var _appUpdateRequest = null;

// The native shell loads index.html?version=<versionName>; a release never edits index.html.
function currentAppVersion() {
  return String(new URLSearchParams(location.search).get('version') || '');
}
function renderAppVersion() {
  var node = $('app-version');
  if (node) node.textContent = currentAppVersion();
}
function parseReleaseVersion(text) {
  var match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text || '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
// A build whose version is not X.Y.Z predates the release numbering, so any release is newer.
function isNewerAppRelease(version) {
  var candidate = parseReleaseVersion(version),
    current = parseReleaseVersion(currentAppVersion()) || [0, 0, 0];
  if (!candidate) return false;
  for (var i = 0; i < 3; i++) if (candidate[i] !== current[i]) return candidate[i] > current[i];
  return false;
}
function readAppUpdateState() {
  try {
    var value = JSON.parse(localStorage.getItem(APP_UPDATE_STATE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
}
function writeAppUpdateState(state) {
  try {
    localStorage.setItem(APP_UPDATE_STATE_KEY, JSON.stringify(state));
  } catch (_) {}
}
// Resolves to {version, url} for the latest stable release, or null when none is published yet; any
// other answer, including a malformed one, rejects instead of reading as "up to date".
function fetchLatestAppRelease() {
  if (_appUpdateRequest) return _appUpdateRequest;
  var controller = new AbortController(),
    timer = setTimeout(function () {
      controller.abort();
    }, APP_UPDATE_TIMEOUT_MS);
  _appUpdateRequest = fetch(APP_LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: controller.signal,
  })
    .then(function (response) {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json().then(function (release) {
        var version = parseReleaseVersion(release && release.tag_name),
          url = String((release && release.html_url) || '');
        if (!version || release.draft || release.prerelease || url.indexOf(APP_PROJECT_URL + '/releases/') !== 0)
          throw new Error('发布信息无效');
        return { version: version.join('.'), url: url };
      });
    })
    .finally(function () {
      clearTimeout(timer);
      _appUpdateRequest = null;
    });
  return _appUpdateRequest;
}
function openAppReleasePage(url) {
  location.href = url;
}
// The automatic notice waits for a quiet moment: never over an open layer or a running reply. A
// deferred notice is offered again at the next launch or return to the foreground.
function offerPendingAppUpdate() {
  var state = readAppUpdateState(),
    latest = state.latest;
  if (!latest || !isNewerAppRelease(latest.version) || state.notifiedVersion === latest.version) return;
  if (document.visibilityState !== 'visible' || _generationState !== 'idle' || getTopOpenModal()) return;
  state.notifiedVersion = latest.version;
  writeAppUpdateState(state);
  toast('夜欲 ' + latest.version + ' 已发布', 'info', {
    label: '前往更新',
    run: function () {
      openAppReleasePage(latest.url);
    },
  });
}
// Runs at launch and on each return to the foreground; the network is asked at most once per day and a
// failed automatic check stays silent.
async function runAutomaticAppUpdateCheck() {
  var state = readAppUpdateState(),
    now = Date.now(),
    last = Number(state.lastAutoCheckAt) || 0;
  if (last <= now && now - last < APP_UPDATE_AUTO_INTERVAL_MS) return offerPendingAppUpdate();
  state.lastAutoCheckAt = now;
  writeAppUpdateState(state);
  var latest;
  try {
    latest = await fetchLatestAppRelease();
  } catch (_) {
    return;
  }
  state = readAppUpdateState();
  state.latest = latest;
  writeAppUpdateState(state);
  offerPendingAppUpdate();
}
// Outside the app shell (a plain browser page) there is no installed version to compare against.
function startAppUpdateChecks() {
  if (!currentAppVersion()) return;
  runAutomaticAppUpdateCheck();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') runAutomaticAppUpdateCheck();
  });
}

function setAboutUpdateStatus(text, release) {
  $('about-update-status').textContent = text;
  var open = $('about-update-open');
  open.hidden = !release;
  open.onclick = release
    ? function () {
        openAppReleasePage(release.url);
      }
    : null;
}
function openAboutDialog() {
  $('about-version').textContent = currentAppVersion();
  setAboutUpdateStatus('', null);
  openModal('about-modal');
}
async function checkAppUpdateManually() {
  var button = $('about-update-check');
  button.disabled = true;
  setAboutUpdateStatus('正在检查…', null);
  try {
    var latest = await fetchLatestAppRelease(),
      state = readAppUpdateState();
    state.latest = latest;
    if (latest && isNewerAppRelease(latest.version)) {
      if (document.visibilityState === 'visible' && getTopOpenModal() === $('about-modal'))
        state.notifiedVersion = latest.version;
      setAboutUpdateStatus('发现新版本 ' + latest.version, latest);
    } else setAboutUpdateStatus(latest ? '已是最新版本' : '暂无正式发布版本', null);
    writeAppUpdateState(state);
  } catch (_) {
    setAboutUpdateStatus('检查失败，请检查网络后重试', null);
  } finally {
    button.disabled = false;
  }
}
async function copyAboutEmail() {
  try {
    await navigator.clipboard.writeText(APP_CONTACT_EMAIL);
    toast('邮箱已复制', 'ok');
  } catch (_) {
    toast('复制失败，请手动记录邮箱', 'err');
  }
}
