"use strict";

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const vm = require("vm");
const http = require("http");

const ASSET_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

// Serves the app's assets directory over HTTP the way the packaged WebView sees it: no favicon
// noise, only regular files inside the directory, and no caching unless a test counts loads across reloads.
function createAssetServer(assets, {onRequest, cacheable = false} = {}) {
  const noStore = cacheable ? {} : {'Cache-Control': 'no-store'};
  return http.createServer((request, response) => {
    if (onRequest) onRequest(request);
    const relative = decodeURIComponent(String(request.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    if (relative === 'favicon.ico') {
      response.writeHead(204, noStore).end();
      return;
    }
    const file = path.resolve(assets, relative);
    const inside = path.relative(assets, file);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404, noStore).end();
      return;
    }
    response.writeHead(200, {'Content-Type': ASSET_MIME_TYPES[path.extname(file)] || 'application/octet-stream', ...noStore});
    fs.createReadStream(file).pipe(response);
  });
}

function scriptPaths(root, dir) {
  const html = fs.readFileSync(path.join(root, "app/src/main/assets/index.html"), "utf8");
  const pattern = new RegExp(String.raw`<script\b[^>]*\bsrc="(js/${dir}/[^"?#]+)(?:\?[^"#]*)?"[^>]*>`, "g");
  const refs = Array.from(html.matchAll(pattern), (match) => path.join(root, "app/src/main/assets", match[1]));
  if (!refs.length) throw new Error("index.html 未声明 js/" + dir + " 模块");
  return refs;
}

function appModulePaths(root) {
  return scriptPaths(root, "app");
}

function readAppSource(root) {
  return appModulePaths(root).map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

function namedAppModulePaths(root, names) {
  const expected = new Set(names);
  const files = appModulePaths(root).filter((file) => expected.has(path.basename(file)));
  if (files.length !== expected.size) throw new Error("app 模块清单不完整：" + names.join(", "));
  return files;
}

function loadAppModulesContext(root, names, extra = {}) {
  const context = Object.assign({ console }, extra);
  vm.createContext(context);
  namedAppModulePaths(root, Array.isArray(names) ? names : [names]).forEach((file) => vm.runInContext(fs.readFileSync(file, "utf8"), context));
  return context;
}

// A `/` opens a regex literal when the previous token cannot end an expression; the scanner then
// skips to its closing `/` so quotes and braces inside the pattern never unbalance the walk.
function regexLiteralCanStart(source, index) {
  let at = index - 1;
  while (at >= 0 && /\s/.test(source[at])) at -= 1;
  if (at < 0) return true;
  const previous = source[at];
  if (/[([{=,:;!&|?+\-*%^~<>]/.test(previous)) return true;
  if (!/[A-Za-z_$\d]/.test(previous)) return false;
  const end = at + 1;
  while (at >= 0 && /[\w$]/.test(source[at])) at -= 1;
  return /^(?:return|case|throw|else|do|typeof|instanceof|in|of|yield|await|void|delete)$/.test(source.slice(at + 1, end));
}

function regexLiteralEnd(source, index) {
  let inClass = false;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const current = source[cursor];
    if (current === "\\") {
      cursor += 1;
      continue;
    }
    if (current === "\n") return cursor;
    if (current === "[") inClass = true;
    else if (current === "]") inClass = false;
    else if (current === "/" && !inClass) return cursor;
  }
  return source.length;
}

function extractFunctionSource(source, name) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:async\\s+)?function\\s*\\*?\\s+${escapedName}\\s*\\(`).exec(source);
  if (!match) throw new Error(`缺少函数 ${name}`);
  const start = match.index;
  const open = source.indexOf("{", start + match[0].length);
  if (open < 0) throw new Error(`函数未闭合 ${name}`);
  let depth = 0;
  let quote = "";
  let escape = false;
  for (let index = open; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (quote) {
      if (escape) escape = false;
      else if (current === "\\") escape = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (current === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      quote = current;
      continue;
    }
    if (current === "/" && regexLiteralCanStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (current === "{") depth += 1;
    else if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`函数未闭合 ${name}`);
}

function resolvePlaywrightRuntime() {
  let moduleFile;
  try {
    moduleFile = require.resolve("playwright");
  } catch (_) {
    throw new Error("缺少 Playwright 测试运行时；请先在项目根目录运行 npm ci。");
  }
  return {modulePath: "playwright", nodePath: path.dirname(path.dirname(moduleFile)), edgePath: resolveEdgeExecutable()};
}
const PLAYWRIGHT_PROFILE_POOL_SIZE = 8;
const PLAYWRIGHT_PROFILE_WAIT_MS = 100;
const PLAYWRIGHT_PROFILE_WAIT_TIMEOUT_MS = 180000;
const playwrightWrappers = new Map();

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function playwrightProfileRoot() {
  return path.resolve(__dirname, "../../.tmp/playwright-edge-profiles");
}

function resetPlaywrightProfile(profileDir) {
  const profileRoot = playwrightProfileRoot();
  const relative = path.relative(profileRoot, path.resolve(profileDir));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Playwright profile path escapes the fixed pool");
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
}

function releasePlaywrightProfile(lockPath, token) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (owner.token === token) fs.rmSync(lockPath, { force: true });
  } catch (_) {}
}

function recoverStalePlaywrightProfileLock(lockPath) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (isProcessRunning(Number(owner.pid))) return false;
  } catch (error) {
    if (error && error.code === "ENOENT") return true;
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs < 5000) return false;
    } catch (_) {
      return false;
    }
  }
  try {
    fs.rmSync(lockPath, { force: true });
    return true;
  } catch (_) {
    return false;
  }
}

async function acquirePlaywrightProfile() {
  const profileRoot = playwrightProfileRoot();
  fs.mkdirSync(profileRoot, { recursive: true });
  const deadline = Date.now() + PLAYWRIGHT_PROFILE_WAIT_TIMEOUT_MS;
  let lastResetError;
  let lastLockError;
  while (Date.now() < deadline) {
    for (let index = 0; index < PLAYWRIGHT_PROFILE_POOL_SIZE; index += 1) {
      const profileDir = path.join(profileRoot, `profile-${index}`);
      const lockPath = path.join(profileRoot, `profile-${index}.lock`);
      const token = crypto.randomUUID();
      let descriptor;
      try {
        descriptor = fs.openSync(lockPath, "wx");
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }), "utf8");
      } catch (error) {
        if (descriptor != null) fs.closeSync(descriptor);
        // Windows answers EPERM, not EEXIST, while another runner's just-deleted lock is still
        // pending deletion. The slot is simply busy for a moment: move on instead of failing the test.
        if (error && error.code === "EPERM") {
          lastLockError = error;
          continue;
        }
        if (!error || error.code !== "EEXIST") throw error;
        recoverStalePlaywrightProfileLock(lockPath);
        continue;
      }
      fs.closeSync(descriptor);
      try {
        resetPlaywrightProfile(profileDir);
        let released = false;
        return {
          profileDir,
          release() {
            if (released) return;
            released = true;
            releasePlaywrightProfile(lockPath, token);
          },
        };
      } catch (error) {
        lastResetError = error;
        releasePlaywrightProfile(lockPath, token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, PLAYWRIGHT_PROFILE_WAIT_MS));
  }
  const lastError = lastResetError || lastLockError;
  const detail = lastError ? ` Last profile error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for one of ${PLAYWRIGHT_PROFILE_POOL_SIZE} Playwright profile slots.${detail}`);
}

async function launchWithStablePlaywrightProfile(chromium, options) {
  const lease = await acquirePlaywrightProfile();
  try {
    const context = await chromium.launchPersistentContext(lease.profileDir, options || {});
    const browser = context.browser();
    if (!browser) throw new Error("Persistent Chromium context did not expose its browser");
    browser.once("disconnected", lease.release);
    return gateTestProcess() ? withGateBrowserPolicy(browser) : browser;
  } catch (error) {
    lease.release();
    throw error;
  }
}

// Only processes started from a permanent test file get the gate policy; probes keep plain browsers.
function gateTestProcess() {
  return Boolean(require.main && path.dirname(require.main.filename) === __dirname);
}

const unexpectedPageErrors = [];
const expectedPageErrors = new WeakMap();

function expectPageError(page, matches) {
  if (!expectedPageErrors.has(page)) expectedPageErrors.set(page, []);
  expectedPageErrors.get(page).push(matches);
}

function phoneContextOptions(options) {
  const device = require("../qa/visual_device").visualDevice().browserContext;
  const next = Object.assign({}, options || {});
  if (!("isMobile" in next)) next.isMobile = true;
  if (!("hasTouch" in next)) next.hasTouch = true;
  if (!("viewport" in next)) next.viewport = Object.assign({}, device.viewport);
  return next;
}

function watchPageErrors(page) {
  page.on("pageerror", (error) => {
    const text = String((error && error.stack) || error);
    if ((expectedPageErrors.get(page) || []).some((matches) => matches(text, error))) return;
    unexpectedPageErrors.push(text);
  });
}

// Permanent tests run in the phone the app ships to: a context that does not choose otherwise is a touch
// device with mobile viewport semantics, sized like the reference phone when it names no viewport.
// Any uncaught page exception or unhandled rejection fails the test unless the test declares it with
// expectPageError(); a test's own assertions cannot forget a page or context it opened. Browser.newPage
// creates its context through this newContext, so pages opened either way get the policy.
function withGateBrowserPolicy(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(phoneContextOptions(options));
    context.on("page", watchPageErrors);
    return context;
  };
  return browser;
}

process.once("exit", () => {
  if (!unexpectedPageErrors.length) return;
  fs.writeSync(2, "Uncaught page errors:\n" + unexpectedPageErrors.join("\n---\n") + "\n");
  process.exitCode = 1;
});

function loadPlaywright() {
  const modulePath = resolvePlaywrightRuntime().modulePath;
  if (playwrightWrappers.has(modulePath)) return playwrightWrappers.get(modulePath);
  const playwright = require(modulePath);
  const chromium = new Proxy(playwright.chromium, {
    get(target, property) {
      if (property === "launch") return (options) => launchWithStablePlaywrightProfile(target, options);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const wrapper = new Proxy(playwright, {
    get(target, property, receiver) {
      return property === "chromium" ? chromium : Reflect.get(target, property, receiver);
    },
  });
  playwrightWrappers.set(modulePath, wrapper);
  return wrapper;
}

function resolveEdgeExecutable() {
  const candidates = [
    process.env.YEYU_EDGE_PATH,
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("未找到 Microsoft Edge；请设置 YEYU_EDGE_PATH，或安装 Edge。已检查：" + candidates.join("；"));
  return executable;
}

const CHROMIUM_UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 67, 68, 69, 70,
  79, 80, 81, 88, 110, 111, 113, 119, 123, 135, 137, 138, 139, 143, 161, 179, 389,
  427, 465, 512, 513, 514, 515, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6697, 10080,
]);
for (let port = 6665; port <= 6669; port += 1) CHROMIUM_UNSAFE_PORTS.add(port);

function isChromiumUnsafePort(port) {
  return CHROMIUM_UNSAFE_PORTS.has(Number(port));
}

async function listenOnBrowserSafePort(httpServer, host = '127.0.0.1') {
  let lastError;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onListening = () => { cleanup(); resolve(); };
        const onError = (error) => { cleanup(); reject(error); };
        const cleanup = () => {
          httpServer.off('listening', onListening);
          httpServer.off('error', onError);
        };
        httpServer.once('listening', onListening);
        httpServer.once('error', onError);
        httpServer.listen(0, host);
      });
      const address = httpServer.address();
      const port = address && typeof address === 'object' ? address.port : NaN;
      if (!isChromiumUnsafePort(port)) return port;
      await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    } catch (error) {
      lastError = error;
      if (!error || error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw lastError || new Error('无法分配 Edge 可访问的本机测试端口');
}

async function selectAppOption(page, selector, value) {
  const choice = await page.locator(selector).evaluate((source, wanted) => {
    const option = Array.from(source.options).find(row => typeof wanted === 'object' ? row.label === wanted.label : row.value === wanted);
    if (!option) throw new Error('Option missing: ' + String(wanted));
    return {index:option.index, trigger:source.closest('.app-select').querySelector('.app-select-trigger').id};
  }, value);
  await page.locator('#' + choice.trigger).click();
  await page.locator('#app-select-list [data-option-index="' + choice.index + '"]').click();
}

module.exports = {
  createAssetServer, selectAppOption, expectPageError, extractFunctionSource, listenOnBrowserSafePort,
  loadAppModulesContext, loadPlaywright, readAppSource, resolveEdgeExecutable, resolvePlaywrightRuntime,
};
