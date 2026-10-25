'use strict';

// The same display-path measurements run on disposable desktop data and the user's
// already-open Android chat. Only display-owned derived writes are authorized.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('../tests/source');
const {visualDevice, installNativeSafeArea} = require('../qa/visual_device');
const root = path.resolve(__dirname, '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const probeSha256 = sha(fs.readFileSync(__filename));
const TEMP_SESSION_PREFIX = 'vc302-measure-temp-';
const TEMP_SESSION_NAME = 'vc302 测量临时会话';
const TEMP_SESSION_USER_TEXT = '请继续。';

async function captureChatData() {
  if (typeof D !== 'object' || !D) throw new Error('应用尚未加载');
  const char = D.characters.find(row => row.id === D.currentCharId);
  const box = char && D.chats[char.id], session = box?.sessions?.find(row => row.id === box.activeSid);
  const host = document.getElementById('chat-messages');
  if (!session || !host || !session.msgs.length) throw new Error('请先打开待测会话');
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(byte => byte.toString(16).padStart(2,'0')).join('');
  const encode = value => new TextEncoder().encode(JSON.stringify(value, (_key, entry) => {
    if (entry && Object.getPrototypeOf(entry) === Object.prototype)
      return Object.fromEntries(Object.keys(entry).sort().map(key => [key,entry[key]]));
    return entry;
  }));
  const derivedKeys = ['blob','bytes','data_url','dataUrl','status','error','objectUrl','objectUrlSource','objectUrlOwnerId'];
  const assets = char.media_assets || [];
  const manifest = assets.map(asset => Object.fromEntries(Object.entries(asset || {}).filter(([key]) => !derivedKeys.includes(key))));
  const fields = ['name','nickname','description','personality','scenario','first_mes','alternate_greetings','mes_example',
    'system_prompt','post_history_instructions','creator','creator_notes','tags','character_version','extensions','assets'];
  // Serialize all main values synchronously before yielding for digest computation.
  const mainSources = {
    owner:encode([char.id,session.id]), msgs:encode(session.msgs),
    character:encode(Object.fromEntries(fields.map(key => [key,char[key]]))),
    worldbook:encode({embedded:char.character_book, worldBook:D.worldBook}),
    regex:encode({character:char.regexScripts,global:D.settings.regexScripts,
      preset:D.settings.chatCompletionPresetInUse?.extensions?.regex_scripts}),
    assetManifest:encode(manifest),
  };
  const derived = {};
  async function record(key, value) {
    const type = value instanceof Blob ? 'Blob' : ArrayBuffer.isView(value) ? 'bytes' : typeof value;
    const bytes = value instanceof Blob ? await value.arrayBuffer() : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer,value.byteOffset,value.byteLength) : encode(value === undefined ? null : value);
    derived[key] = {present:value !== undefined,type,bytes:bytes.byteLength,sha256:await digest(bytes)};
    if (type === 'Blob') derived[key].mime = value.type;
  }
  const records = [record('session.risu.scriptstate', session.risu?.scriptstate),
    record('session.memoryStore',session.memoryStore),record('session.memoryCompressedUntil',session.memoryCompressedUntil),
    record('session.lastMemorySummaryAt',session.lastMemorySummaryAt)];
  assets.forEach((asset,index) => derivedKeys.forEach(key => records.push(record(`assets[${index}].${key}`,asset?.[key]))));
  const main = {messageCount:session.msgs.length};
  await Promise.all(Object.entries(mainSources).map(async ([key,value]) => { main[key+'Sha256']=await digest(value); }));
  await Promise.all(records);
  return {main,derived,
    counts:{messages:session.msgs.length,renderedMessages:host.querySelectorAll('[data-msg-idx]').length,
      iframes:document.querySelectorAll('iframe').length,risuFrames:host.querySelectorAll('.risu-display-frame').length,
      cardFrames:host.querySelectorAll('.yeyu-card-frontend iframe').length},
    environment:{userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}}};
}

// The single definition of "this chat has finished displaying". Installed once per connection as
// window.__yeyuIdleSnapshot and used by the initial gate, every timed sample and the expand scenario,
// so the three never drift apart. Risu display frames and ST card frontends both have to settle.
function idleSnapshot() {
  const host = document.getElementById('chat-messages');
  const char = typeof getChar === 'function' ? getChar() : null;
  const session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
  const msgs = (session && session.msgs) || [];
  const start = session ? getHistoryRenderStart(session, msgs) : 0;
  const frames = [...(typeof _cardFrontendLive === 'undefined' ? [] : _cardFrontendLive.values())]
    .filter(row => row && row.frame && row.frame.isConnected);
  // Card slots mount on demand, so most of them stay placeholders on purpose and a slot without a
  // frame is not a pending slot. Readiness therefore asks two things only: the mount scheduler has
  // nothing left to do, and every frame it did mount has reported a real height.
  const lazyMount = typeof _cardFrontendMountingKey !== 'undefined';
  const state = {
    messages: msgs.length,
    historyStart: start,
    renderedMessages: host ? host.querySelectorAll('[data-msg-idx]').length : 0,
    iframes: document.querySelectorAll('iframe').length,
    risuFrames: host ? host.querySelectorAll('.risu-display-frame').length : 0,
    risuHosts: host ? host.querySelectorAll('.risu-display-host').length : 0,
    risuReady: host ? host.querySelectorAll('.risu-display-host[data-risu-ready]').length : 0,
    // Card slot positions in the DOM, and how many of them are actually running a frame.
    cardPlaceholders: host ? host.querySelectorAll('.yeyu-card-frontend[data-frontend-key]').length : 0,
    cardPending: host ? host.querySelectorAll('.yeyu-card-frontend[data-frontend-pending]').length : 0,
    cardFrames: host ? host.querySelectorAll('.yeyu-card-frontend iframe').length : 0,
    cardFramesConnected: frames.length,
    lazyMount,
    schedulerMounting: lazyMount && !!_cardFrontendMountingKey && _cardFrontendLive.has(_cardFrontendMountingKey),
    schedulerQueued: lazyMount && !!_cardFrontendScheduleQueued,
    schedulerScrolling: lazyMount && !!_cardFrontendScrolling,
    scrollHeight: host ? Math.round(host.scrollHeight) : 0,
    clientHeight: host ? Math.round(host.clientHeight) : 0,
    scrollTop: host ? Math.round(host.scrollTop) : 0,
    bottomGapPx: host ? Math.round(host.scrollHeight - host.clientHeight - host.scrollTop) : null,
    // A frame is ready once it has parsed its document and reported a real height. Waiting for
    // readyState 'complete' would wait for the images inside the card, which settledMs never counts.
    heightPending: frames.filter(row => !row.heightReady).length,
    documentPending: frames.filter(row => ((row.frame.contentDocument || {}).readyState || 'loading') === 'loading').length,
    documentIncomplete: frames.filter(row => ((row.frame.contentDocument || {}).readyState || 'loading') !== 'complete').length,
    pendingTransforms: typeof _cardScriptTextPending === 'undefined' ? 0 : _cardScriptTextPending.size,
    libraryState: typeof _cardScriptLibraryLive === 'undefined' || !_cardScriptLibraryLive
      ? 'none' : String(_cardScriptLibraryLive.state || ''),
    risuExecutions: typeof _risuExecutions === 'undefined' ? 0 : _risuExecutions.size,
    risuQueues: typeof _risuExecutionQueues === 'undefined' ? 0 : _risuExecutionQueues.size,
    generationState: typeof _generationState === 'undefined' ? '' : _generationState,
    heapUsedBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
  };
  state.risuDisplayPending = char && typeof isRisuCharacter === 'function' && isRisuCharacter(char)
    ? msgs.slice(start).filter(msg => !_risuDisplayCache.has(msg)).length : 0;
  state.templatesPending = typeof _promptTemplateRenderCache === 'undefined' ? 0
    : msgs.slice(start).filter(msg =>
      [...(_promptTemplateRenderCache.get(msg)?.values() || [])].some(row => row.state === 'pending')).length;
  state.schedulerBusy = state.schedulerMounting || state.schedulerQueued || state.schedulerScrolling;
  state.idle = !state.heightPending && !state.documentPending && !state.pendingTransforms && !state.schedulerBusy &&
    (state.libraryState === 'none' || state.libraryState === 'ready') &&
    !state.risuExecutions && !state.risuQueues && state.risuHosts === state.risuReady &&
    !state.risuDisplayPending && !state.templatesPending;
  return state;
}

// Wait for the installed snapshot to report idle twice in a row. Never throws: a timeout returns the
// state it gave up on, so a failed run still reports what was still pending.
async function awaitChatIdle(options) {
  const started = performance.now(), deadline = started + options.timeoutMs;
  let stable = 0, state = window.__yeyuIdleSnapshot();
  while (stable < 2 && performance.now() < deadline) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    state = window.__yeyuIdleSnapshot();
    stable = state.idle ? stable + 1 : 0;
  }
  return {ready: stable >= 2, ms: Math.round(performance.now() - started), state};
}

function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return {count:n, medianMs:n ? (sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2 : null,
    p95Ms:n ? sorted[Math.ceil(n*0.95)-1] : null, totalMs:values.reduce((a,b) => a+b, 0)};
}

// collect() checks main data after every sample, outside measured/profiler intervals.
async function measureChat({instrument, readyTimeoutMs}) {
  const char = D.characters.find(row => row.id === D.currentCharId);
  const box = char && D.chats[char.id], session = box?.sessions?.find(row => row.id === box.activeSid);
  const host = document.getElementById('chat-messages');
  if (!char || !session || !host || !session.msgs.length) throw new Error('请先打开待测会话');
  if (document.visibilityState !== 'visible' || !host.getBoundingClientRect().height) throw new Error('待测聊天须在前台可见');
  if (_generationState !== 'idle' || _risuExecutions.size) throw new Error('会话仍有动作执行，未开始测量');
  const counts = () => window.__yeyuIdleSnapshot();
  const initial = counts();
  if (initial.risuReady !== initial.risuHosts) throw new Error('显示帧尚未绑定完成，未开始测量');
  const rows = [], timings = [], undo = [], pending = new Set(), failures = [];
  const stack = [];
  let messageDepth = 0;
  function wrap(name, group, asyncWork = false) {
    const original = window[name];
    if (typeof original !== 'function') throw new Error('缺少测量入口：' + name);
    window[name] = function (...args) {
      const started = performance.now(), frame = {child:0}, withinMessage = messageDepth > 0;
      if (name === 'messageHtml') messageDepth++;
      if (instrument) stack.push(frame);
      let result;
      try { result = original.apply(this, args); return result; }
      finally {
        const elapsed = performance.now() - started;
        if (instrument) {
          stack.pop();
          if (stack.length) stack[stack.length-1].child += elapsed;
          timings.push({name, group, withinMessage, ms:elapsed, selfMs:Math.max(0, elapsed-frame.child)});
        }
        if (name === 'messageHtml') messageDepth--;
        if (asyncWork && result?.then) {
          const task = Promise.resolve(result).then(() => {
            if (instrument) timings.push({name, group:group+'Async', withinMessage:false, ms:performance.now()-started});
          }, () => failures.push(name + ' rejected')).finally(() => pending.delete(task));
          pending.add(task);
        }
      }
    };
    undo.push(() => { window[name] = original; });
  }
  async function settled() {
    const deadline = performance.now()+readyTimeoutMs;
    let stable = 0;
    while (stable < 2) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const state = counts();
      if (performance.now() > deadline)
        throw new Error('显示帧 ' + readyTimeoutMs + ' ms 内未就绪：' + JSON.stringify(state));
      if (failures.length) throw new Error(failures.join('; '));
      stable = state.idle && !pending.size ? stable+1 : 0;
    }
  }
  let error;
  try {
    // Retain the original Promise and arguments. Timing does not replace application completion conditions.
    wrap('syncRisuDisplays', 'risuSync', true);
    if (instrument) {
      wrap('syncCardFrontends', 'cardSync');
      wrap('messageHtml', 'message');
      for (const name of ['promptTemplateDisplayText','promptTemplateDisplayHtml']) wrap(name, 'template');
      wrap('regexScriptDisplayText', 'regex');
      for (const name of ['replaceCharacterMacros','risuRenderCBSInWorker','risuEvaluateDisplayMessages']) wrap(name, 'macro', true);
      wrap('md', 'markdown');
      wrap('risuRenderMixedMarkdown', 'risuMarkdown');
    }
    {
      const anchorStart = performance.now();
      captureChatReadingAnchor(true);
      const anchorMs = performance.now()-anchorStart;
      const renderStart = performance.now();
      renderChat();
      const renderMs = performance.now()-renderStart;
      await settled();
      rows.push({renderMs, anchorMs, settledMs:performance.now()-renderStart, ...counts()});
      if (_generationState !== 'idle' || D.currentCharId !== char.id || box.activeSid !== session.id)
        throw new Error('测量中会话或生成状态变化');
    }
  } catch (failure) { error = String(failure.message || failure); }
  finally { undo.reverse().forEach(restore => restore()); }
  return {ok:!error,error:error || null,
    instrument, initial, final:counts(), samples:rows, timings,
    environment:{userAgent:navigator.userAgent, viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
      historyStart:initial.historyStart, generationState:_generationState},
    scope:'当前打开的会话，保持折叠范围；renderMs 为同步调用，settledMs 含显示任务、帧绑定/布局就绪与两帧等待，不含外部图片下载完成。'};
}

// Jumping to the first message of the conversation, measured once. The product entry is
// jumpToConversationStart(), which loads the whole log and then places the reader on message 0; it
// carries no confirmation of its own. Code without that entry falls back to the old window expansion
// so the same scenario still runs against a baseline build.
async function measureExpandAll({readyTimeoutMs}) {
  const char = D.characters.find(row => row.id === D.currentCharId);
  const box = char && D.chats[char.id], session = box?.sessions?.find(row => row.id === box.activeSid);
  const host = document.getElementById('chat-messages');
  if (!char || !session || !session.msgs.length || !host) throw new Error('请先打开待测会话');
  const productEntry = typeof jumpToConversationStart === 'function';
  const before = window.__yeyuIdleSnapshot();
  const anchorStart = performance.now();
  captureChatReadingAnchor(true);
  const anchorMs = performance.now() - anchorStart;
  // renderChat() may be called from inside the product entry across several turns; count every
  // synchronous repaint it causes so renderMs stays comparable with the fallback path.
  const originalRender = renderChat;
  let renderMs = 0, renderCalls = 0;
  renderChat = function (...args) {
    const at = performance.now();
    renderCalls++;
    try { return originalRender.apply(this, args); }
    finally { renderMs += performance.now() - at; }
  };
  const startedAt = performance.now();
  // The first row is "in place" once it is rendered and actually intersects the chat viewport.
  const firstInView = () => {
    const node = host.querySelector('[data-msg-idx="0"]');
    if (!node) return false;
    const hostRect = host.getBoundingClientRect(), rect = node.getBoundingClientRect();
    return rect.bottom > hostRect.top && rect.top < hostRect.bottom;
  };
  // A full repaint puts message 0 at the top of a freshly built list for a frame or two, before the
  // reading position is restored. Only the placement the entry itself performs counts as "in place".
  const originalJump = typeof jumpToMessage === 'function' ? jumpToMessage : null;
  let placed = !productEntry, entryOutcome = 'pending';
  if (originalJump) jumpToMessage = function (index) {
    const result = originalJump.apply(this, arguments);
    if (Math.floor(Number(index) || 0) === 0) placed = true;
    return result;
  };
  try {
    if (productEntry) Promise.resolve(jumpToConversationStart())
      .then(() => { entryOutcome = 'done'; }, error => { entryOutcome = String(error?.message || error).slice(0, 120); });
    else { _historyLoadedBySession[session.id] = 0; originalRender(); entryOutcome = 'fallback'; }
    const deadline = startedAt + readyTimeoutMs;
    let stable = 0, state = window.__yeyuIdleSnapshot();
    let pendingDrainMs = state.pendingTransforms ? null : 0, firstMessageMs = null;
    while (stable < 2 && performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      state = window.__yeyuIdleSnapshot();
      if (pendingDrainMs === null && !state.pendingTransforms) pendingDrainMs = Math.round(performance.now() - startedAt);
      if (firstMessageMs === null && placed && firstInView()) firstMessageMs = Math.round(performance.now() - startedAt);
      stable = state.idle && firstMessageMs !== null ? stable + 1 : 0;
    }
    const settledMs = performance.now() - startedAt;
    return {ok: stable >= 2, timedOut: stable < 2, readyTimeoutMs, entry: productEntry ? 'jumpToConversationStart' : 'renderWindowFallback',
      entryOutcome,
      anchorMs, renderMs, renderCalls, firstMessageMs, settledMs, pendingDrainMs,
      before, after: window.__yeyuIdleSnapshot(),
      environment:{userAgent:navigator.userAgent, viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}},
      scope:'一次性场景：调用产品的「跳转到对话开头」入口，分别记录第 1 条进入视口的耗时与到空闲的耗时；超时如实记录，不丢弃数据。'};
  } finally {
    renderChat = originalRender;
    if (originalJump) jumpToMessage = originalJump;
  }
}

// How long a placeholder takes to become a running frame once the reader stops scrolling on it, and
// whether the rows around it hold still while that happens. Cold = never mounted at this width; warm
// = mounted before, retired, and remounted with a remembered height.
async function measureCardRemount({readyTimeoutMs, samples}) {
  const host = document.getElementById('chat-messages');
  if (!host) throw new Error('请先打开待测会话');
  if (typeof _cardFrontendLive === 'undefined') throw new Error('当前代码没有卡片前端懒挂载，无法测重挂');
  const peak = {frames: 0, placeholders: 0};
  const heightAt = new Map();
  const originalNotify = cardFrontendDirectNotify;
  cardFrontendDirectNotify = function (token, source, type, payload) {
    const result = originalNotify.apply(this, arguments);
    if (type === 'height' && Math.floor(Number((payload || {}).height) || 0) > 0)
      for (const live of _cardFrontendLive.values())
        if (live && live.token === token) { heightAt.set(live.key, performance.now()); break; }
    return result;
  };
  const snapshot = () => {
    const state = window.__yeyuIdleSnapshot();
    if (state.cardFramesConnected > peak.frames) peak.frames = state.cardFramesConnected;
    peak.placeholders = Math.max(peak.placeholders, state.cardPlaceholders);
    return state;
  };
  const settle = async limit => {
    const deadline = performance.now() + limit;
    let stable = 0;
    while (stable < 2 && performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      stable = snapshot().idle ? stable + 1 : 0;
    }
    return stable >= 2;
  };
  const slots = () => Array.prototype.map.call(host.querySelectorAll('.yeyu-card-frontend[data-frontend-key]'), node => {
    const row = node.closest('[data-msg-idx]');
    return {key: String(node.getAttribute('data-frontend-key') || ''), node, row,
      index: row ? Math.floor(Number(row.getAttribute('data-msg-idx')) || 0) : 0};
  }).filter(row => row.key && row.row);
  const offsetOf = row => Math.round(row.row.getBoundingClientRect().top - host.getBoundingClientRect().top);
  // One visit: centre the slot with a programmatic scroll, then time from that scroll to the frame's
  // own height report, and see how far the anchored row moved while the frame took its place.
  const visit = async (target, phase) => {
    const wasLive = _cardFrontendLive.has(target.key);
    heightAt.delete(target.key);
    const hostRect = host.getBoundingClientRect(), rect = target.node.getBoundingClientRect();
    host.scrollTop += rect.top + rect.height / 2 - (hostRect.top + hostRect.height / 2);
    const startedAt = performance.now();
    const offsetBefore = offsetOf(target);
    // What the product promises to hold still is the reading anchor — the content at the top of the
    // viewport — not an arbitrary row. Capturing it with the app's own function and putting it back
    // afterwards measures exactly how far that content drifted: the scroll correction it needs.
    const readingAnchor = captureChatReadingAnchor(true);
    let scrollIdleMs = null, mountedMs = null;
    // A slot that never got retired reports no new height; waiting for one would only burn the budget.
    const deadline = startedAt + (wasLive ? 0 : readyTimeoutMs);
    while (mountedMs === null && performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const state = snapshot();
      if (scrollIdleMs === null && !state.schedulerScrolling) scrollIdleMs = Math.round(performance.now() - startedAt);
      if (heightAt.has(target.key)) mountedMs = Math.round(heightAt.get(target.key) - startedAt);
    }
    const idle = await settle(readyTimeoutMs);
    const offsetAfter = offsetOf(target);
    const scrollBefore = host.scrollTop;
    applyChatReadingAnchor(readingAnchor);
    const readingShiftPx = Math.round(host.scrollTop - scrollBefore);
    return {phase, key: target.key.slice(0, 8), index: target.index, alreadyLive: wasLive,
      mountedMs, scrollIdleMs, idle, offsetBefore, offsetAfter,
      offsetShiftPx: offsetAfter - offsetBefore, readingShiftPx};
  };
  const rows = [];
  try {
    await settle(readyTimeoutMs);
    const initial = snapshot();
    const all = slots();
    const step = Math.max(2, Math.floor(all.length / (samples * 2 + 2)));
    // Two disjoint sets: the first is measured cold, the second only visited so the first falls out
    // of the "recently used" slots, and then the first is measured again warm.
    const cold = [], decoy = [];
    for (let index = 0; index < all.length && cold.length < samples; index += step) cold.push(all[index]);
    for (let index = Math.floor(step / 2); index < all.length && decoy.length < samples; index += step)
      if (!cold.includes(all[index])) decoy.push(all[index]);
    for (const target of cold) rows.push(await visit(target, 'cold'));
    for (const target of decoy) await visit(target, 'decoy');
    for (const target of cold) rows.push(await visit(target, 'warm'));
    const median = values => {
      const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
      return sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : null;
    };
    const of = phase => rows.filter(row => row.phase === phase && !row.alreadyLive);
    return {ok: true, samples, initial, final: snapshot(), peak, rows,
      coldMountedMedianMs: median(of('cold').map(row => row.mountedMs)),
      warmMountedMedianMs: median(of('warm').map(row => row.mountedMs)),
      coldCount: of('cold').length, warmCount: of('warm').length,
      warmStillLive: rows.filter(row => row.phase === 'warm' && row.alreadyLive).length,
      offsetShiftMaxPx: Math.max(0, ...rows.map(row => Math.abs(row.offsetShiftPx))),
      offsetShiftMedianPx: median(rows.map(row => Math.abs(row.offsetShiftPx))),
      readingShiftMaxPx: Math.max(0, ...rows.map(row => Math.abs(row.readingShiftPx))),
      readingShiftMedianPx: median(rows.map(row => Math.abs(row.readingShiftPx))),
      bottomGapAfterReady: initial.bottomGapPx,
      scope:'滚动到某个未挂载占位后，测「程序化滚动 → 该帧上报真实高度」；冷为首次挂载，热为淘汰后带记忆高度重挂。' +
        'scrollIdleMs 是滚动静默判定（固定 150 ms 量级）落在其中的那一段。' +
        '阅读位移是把挂载前采样的阅读锚点重新对齐所需的滚动量，即产品承诺不动的那段内容实际漂了多远；' +
        '居中行位移是被居中那一行的位移，它在阅读锚点下方，两者之间的卡片一长高它本来就会跟着走。'};
  } finally { cardFrontendDirectNotify = originalNotify; }
}

// ===== disposable long session used by both the desktop fixture and the phone temp session =====
// Alternating short user text and the card's own first non-empty greeting, built through the app's
// own sequence allocation so no message field is invented here.
function fillSyntheticHistory(char, session, total, userText) {
  const greeting = getGreetings(char).find(Boolean);
  if (!greeting) throw new Error('角色卡没有非空开场白');
  if (!session.msgs.length) {
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    appendOpeningGreeting(char, session, greeting, 0);
  }
  while (session.msgs.length < total) {
    const role = session.msgs.length % 2 ? 'user' : 'assistant';
    session.msgs.push({role, content: role === 'user' ? userText : greeting, time: Date.now(),
      seq: allocateMessageSeq(session)});
  }
  ensureMessageSequences(session);
  return greeting;
}

async function createTempSession(options) {
  const wanted = String(options.characterName || '').trim();
  const matches = D.characters.filter(row => canonicalCharacterName(row) === wanted);
  // The name is matched exactly, punctuation included: a card called 《千叶童话》 does not answer to
  // 千叶童话. Listing what is actually on the device is what makes the mismatch fixable.
  if (matches.length !== 1)
    throw new Error('角色名匹配数为 ' + matches.length + '，未做任何写入；设备上的角色名：' +
      (D.characters.map(row => canonicalCharacterName(row)).join('、') || '（无）'));
  const char = matches[0];
  const box = getSessions(char.id);
  const listing = () => (getSessions(char.id).sessions || []).map(row => ({id:row.id, name:row.name || '',
    messages:(row.msgs || []).length}));
  const before = {characterId:char.id, originalCharId:D.currentCharId, originalActiveSid:box.activeSid,
    sessions:listing()};
  if (before.sessions.some(row => row.id.startsWith(options.prefix)))
    throw new Error('该角色下已存在同前缀的临时会话，未做任何写入');
  const session = createBlankSession(options.sessionName, options.prefix + Date.now().toString(36));
  window.__yeyuFillSyntheticHistory(char, session, options.messages, options.userText);
  box.sessions.push(session);
  // The temp session is made active before selectCharacter runs, so entering the character never
  // lands on an empty session and never opens the greeting or creator-notes modal the probe cannot answer.
  box.activeSid = session.id;
  try {
    await saveData('sessions', {urgent:true});
  } catch (error) {
    box.sessions = box.sessions.filter(row => row !== session);
    box.activeSid = before.originalActiveSid;
    throw error;
  }
  if (D.currentCharId !== char.id) await selectCharacter(char.id);
  else {
    await prepareRegexScriptDisplayTexts(char, session.msgs);
    renderChat();
    updateChatUI();
  }
  if (D.currentCharId !== char.id || getSessions(char.id).activeSid !== session.id)
    throw new Error('临时会话未成为活动会话；请用 delete 子命令清理');
  return {before, sessionId:session.id, messages:session.msgs.length, after:listing(),
    currentCharId:D.currentCharId, activeSid:getSessions(char.id).activeSid};
}

async function deleteTempSession(options) {
  const char = D.characters.find(row => row.id === options.characterId);
  if (!char) throw new Error('未找到创建时记录的角色，未删除任何内容');
  const box = getSessions(char.id);
  const temps = box.sessions.filter(row => String(row.id).startsWith(options.prefix));
  if (!temps.length) throw new Error('该角色下没有该前缀的临时会话');
  const cascades = temps.map(row => chatSessionCascade(box, row.id, true));
  const removing = new Set(cascades.flatMap(row => row.ids));
  if ([...removing].some(id => !String(id).startsWith(options.prefix)))
    throw new Error('临时会话下挂着非临时的支线，未删除任何内容');
  if (box.sessions.every(row => removing.has(row.id))) throw new Error('删除后不会剩下任何会话，未删除任何内容');
  cascades.forEach(cascade => removeChatSessionCascade(box, cascade));
  box.activeSid = options.originalActiveSid && box.sessions.some(row => row.id === options.originalActiveSid)
    ? options.originalActiveSid : box.sessions[0].id;
  await saveData('sessions', {urgent:true});
  // Returning to a character whose active session is still empty would open the greeting or
  // creator-notes modal, which this probe cannot answer; that character is left for the user to enter.
  const origin = options.originalCharId && options.originalCharId !== D.currentCharId
    ? D.characters.find(row => row.id === options.originalCharId) : null;
  const originSession = origin ? getActiveSession(origin.id) : null;
  const restorable = !!(originSession && (originSession.msgs || []).length);
  if (origin && restorable) await selectCharacter(origin.id);
  else {
    await prepareRegexScriptDisplayTexts(char, getActiveSession(char.id).msgs || []);
    renderChat();
    updateChatUI();
  }
  return {characterId:char.id, currentCharId:D.currentCharId, activeSid:getSessions(char.id).activeSid,
    originalCharacterRestored:origin ? restorable : true,
    sessions:(getSessions(char.id).sessions || []).map(row => ({id:row.id, name:row.name || '',
      messages:(row.msgs || []).length}))};
}

function profileTop(profiles) {
  if (!Array.isArray(profiles)) profiles = [profiles];
  const totals = new Map();
  for (const profile of profiles) {
    const nodes = new Map(profile.nodes.map(node => [node.id,node]));
    (profile.samples || []).forEach((id,i) => {
    const frame = nodes.get(id)?.callFrame;
    if (!frame) return;
    // Persist no raw profile, chat, script body or arbitrary card URL.
    const source = /\/js\/(app|core|vendor)\/[^/?#]+\.js/.exec(frame.url || '')?.[0] || '(runtime)';
    const key = JSON.stringify([frame.functionName || '(anonymous)',source,frame.lineNumber+1]);
    totals.set(key,(totals.get(key)||0)+(profile.timeDeltas?.[i]||0)/1000);
    });
  }
  const totalMs = [...totals.values()].reduce((a,b) => a+b,0);
  return {windows:profiles.length,sampleCount:profiles.reduce((count,p) => count+(p.samples?.length || 0),0), totalMs,
    top10:[...totals].filter(([key]) => !['(idle)','(root)'].includes(JSON.parse(key)[0]))
      .sort((a,b) => b[1]-a[1]).slice(0,10).map(([key,selfMs]) => {
        const [name,source,line] = JSON.parse(key); return {name,source,line,selfMs,percent:totalMs ? selfMs/totalMs*100 : 0};
    }), scope:'第三轮每次重绘单独 Profiler 1ms 抽样并归并统计；含布局、异步同步与 GC，不含样本间的主数据/派生字段哈希；排除 idle/root 排名。'};
}

function changedMain(before, after) {
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key => before[key] !== after[key]);
}

function changedDerived(before, after) {
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key =>
    JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(path => ({path,before:before[path] || null,after:after[path] || null}));
}

function evaluator(call) {
  return async (fn, args) => {
    const result = await call('Runtime.evaluate', {expression:`(${fn.toString()})(${JSON.stringify(args || {})})`,
      awaitPromise:true, returnByValue:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
}

// Runtime.evaluate is the only injection point both the desktop page and the phone WebView share.
async function installMeasureHelpers(call) {
  const helpers = {__yeyuIdleSnapshot:idleSnapshot, __yeyuFillSyntheticHistory:fillSyntheticHistory};
  for (const [name, fn] of Object.entries(helpers)) {
    const result = await call('Runtime.evaluate', {expression:`window.${name} = (${fn.toString()})`});
    if (result.exceptionDetails) throw new Error('无法安装测量辅助函数 ' + name + '：' + (result.exceptionDetails.text || ''));
  }
}

async function collect(call, samples, options = {}) {
  const readyTimeoutMs = options.readyTimeoutMs || 20000;
  const evaluate = evaluator(call);
  const before = await evaluate(captureChatData), phases = {}, checks = [], derivedChanges = [], profiles = [];
  let after = before, error, profilerEnabled = false, attempted = 0, failureState = null;
  try {
    for (const phase of ['plain','detailed','profiled']) {
      const merged = phases[phase] = {initial:after.counts,samples:[],timings:[]};
      if (phase === 'profiled') {
        await call('Profiler.enable'); profilerEnabled = true;
        await call('Profiler.setSamplingInterval', {interval:1000});
      }
      for (let sample=1; sample<=samples; sample++) {
        let row, failure;
        attempted++;
        if (phase === 'profiled') await call('Profiler.start');
        try { row = await evaluate(measureChat, {instrument:phase === 'detailed', readyTimeoutMs}); }
        catch(cause) { failure = cause; }
        finally { if (phase === 'profiled') profiles.push((await call('Profiler.stop')).profile); }
        // Even a failed render is followed by a main-data check; never continue after a mismatch.
        const next = await evaluate(captureChatData);
        const changed = changedMain(before.main,next.main);
        checks.push({phase,sample,mainUnchanged:!changed.length,changedMain:changed});
        const changes = changedDerived(after.derived,next.derived);
        if (changes.length) derivedChanges.push({phase,sample,changes});
        after = next;
        if (row) {
          merged.samples.push(...row.samples); merged.timings.push(...row.timings);
          merged.final = row.final; merged.environment = row.environment; merged.scope = row.scope;
        }
        if (changed.length) throw new Error('主数据变化，停止后续测量且不回写：'+changed.join(', '));
        if (failure) throw failure;
        if (!row?.ok) throw new Error(row?.error || '测量未完成');
      }
    }
  } catch(cause) {
    error = String(cause.message || cause);
    // A failed readiness gate has to leave behind what was still pending, not only the message.
    failureState = await evaluate(() => window.__yeyuIdleSnapshot()).catch(() => null);
  }
  finally { if (profilerEnabled) await call('Profiler.disable'); }
  const plain = phases.plain || {initial:before.counts,samples:[]};
  const detailed = phases.detailed || {samples:[],timings:[]};
  const buckets = Object.fromEntries(['template:message','regex:message','macro:message','markdown:message'].map(key => [key,[]]));
  detailed.timings.forEach(row => {
    const key = row.group + (row.withinMessage ? ':message' : ':outside');
    (buckets[key] ||= []).push(row.selfMs ?? row.ms);
  });
  const functions = {};
  detailed.timings.forEach(row => {
    const key = row.name + (row.group.endsWith('Async') ? ':async' : ':sync');
    (functions[key] ||= []).push(row.ms);
  });
  delete detailed.timings;
  return {status:error ? 'failed' : 'measured',error:error || null,readyTimeoutMs,failureState,plain,detailed,
    guard:{before:before.main,after:after.main,
      mainUnchanged:changedMain(before.main,after.main).length ? false : checks.length === attempted ? true : null,checks,derivedChanges},
    metrics:Object.fromEntries(['renderMs','anchorMs','settledMs'].map(key =>
    [key,statistics(plain.samples.map(row => row[key]))])),
    segments:Object.fromEntries(Object.entries(buckets).map(([key,values]) => [key,statistics(values)])),
    functions:Object.fromEntries(Object.entries(functions).map(([key,values]) => [key,statistics(values)])),
    profiler:profileTop(profiles)};
}

async function connect(url) {
  const socket = new WebSocket(url), pending = new Map();
  let next = 0;
  await new Promise((resolve,reject) => {
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',() => reject(new Error('CDP 连接失败')),{once:true});
  });
  socket.addEventListener('message',event => {
    const message = JSON.parse(String(event.data)), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });
  socket.addEventListener('close',() => {
    pending.forEach(entry => entry.reject(new Error('CDP 连接关闭'))); pending.clear();
  });
  return {call:(method,params={}) => new Promise((resolve,reject) => {
    const id = ++next; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params}));
  }), close:() => socket.close()};
}

// ===== desktop =====
// The disposable desktop character goes through the real import entry, so ST cards get the same
// assets, scripts and world book a user's import would produce; readPNG alone would not.
async function importDesktopCard(page, cardPath) {
  await page.evaluate(() => {
    const fresh = defaults();
    Object.keys(D).forEach(key => delete D[key]);
    Object.assign(D, fresh);
    openModal('import-modal');
    resetImport();
  });
  await page.locator('#file-input').setInputFiles(cardPath);
  await page.waitForFunction(() => !_importProgressActive && pending.length === 1);
  return page.evaluate(async () => {
    const expected = canonicalCharacterName(pending[0]);
    const originalConfirm = appConfirm;
    appConfirm = async () => true;
    try {
      setPendingImportMode(0, 'direct');
      setPendingComponentMode(0, 'full');
      await confirmImport();
    } finally { appConfirm = originalConfirm; }
    const char = D.characters.slice().reverse().find(row => canonicalCharacterName(row) === expected);
    if (!char) throw new Error('角色卡导入后未找到');
    document.querySelectorAll('.modal-overlay.open').forEach(node => node.classList.remove('open'));
    return {characterId:char.id, characterName:canonicalCharacterName(char), risuCard:isRisuCharacter(char),
      greetingLength:(getGreetings(char).find(Boolean) || '').length};
  });
}

async function buildDesktopSession(page, messages, userText) {
  return page.evaluate(async config => {
    const char = getChar() || D.characters[D.characters.length-1];
    const session = createBlankSession('合成 ' + config.messages + ' 条', 'chat-measure-session');
    const greeting = window.__yeyuFillSyntheticHistory(char, session, config.messages, config.userText);
    D.currentCharId = char.id;
    D.chats[char.id] = {sessions:[session], activeSid:session.id};
    await saveData(['meta','characters','sessions','worldbook'], {urgent:true});
    await prepareRegexScriptDisplayTexts(char, session.msgs);
    // Without the chat page laid out the message iframes stay 0×0 and never report a height.
    switchAppPage('chat');
    updateChatUI();
    renderChat();
    const host = document.getElementById('chat-messages');
    const gapAfterRender = host ? Math.round(host.scrollHeight - host.clientHeight - host.scrollTop) : null;
    // Every product path that opens a chat — start-up, entering a character, switching session —
    // follows renderChat() with this. Without it the fixture would sit at the top of the log, where
    // the "earlier messages" hint auto-loads batch after batch: the opposite of opening a chat.
    scrollChatToBottomAfterRender();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const live = typeof syncCardScriptLibrary === 'function' ? syncCardScriptLibrary(char) : null;
    if (live && typeof cardScriptLibraryAwaitReady === 'function') await cardScriptLibraryAwaitReady(live);
    return {totalMessages:session.msgs.length,
      assistantMessages:session.msgs.filter(row => row.role === 'assistant').length,
      assistantTextLength:greeting.length, userTextLength:config.userText.length,
      bottomGapAfterRender:gapAfterRender,
      bottomGapAfterScroll:host ? Math.round(host.scrollHeight - host.clientHeight - host.scrollTop) : null,
      // Whether simply opening the chat already pulled an extra batch of older messages in.
      historyStartAfterOpen:getHistoryRenderStart(session, session.msgs),
      renderedAfterOpen:host ? host.querySelectorAll('[data-msg-idx]').length : null,
      description:'1 条原卡开场白加交替的合成用户短文本与原卡首个非空开场白；不设置 _historyLoadedBySession，' +
        '默认只渲染最近 200 条；渲染后按产品入口滚到底；外网关闭，首次加载不计入热重渲染。'};
  }, {messages, userText});
}

async function withDesktopPage(cardPath, work) {
  const server = createAssetServer(path.join(root,'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  let browser;
  try {
    browser = await loadPlaywright().chromium.launch({executablePath:resolveEdgeExecutable(),headless:true});
    const device = visualDevice(), page = await browser.newPage(device.browserContext);
    await installNativeSafeArea(page, device);
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    page.setDefaultTimeout(600000);
    // Deterministic offline comparison; no external card resources or model calls.
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'load'});
    await page.waitForFunction(() => typeof D === 'object' && D && typeof readPNG === 'function' && typeof confirmImport === 'function');
    const imported = await importDesktopCard(page, cardPath);
    const cdp = await page.context().newCDPSession(page);
    const call = cdp.send.bind(cdp);
    await installMeasureHelpers(call);
    const result = await work({page, call, imported, browser});
    return {browser:browser.version(), imported:{...imported, pngSha256:sha(fs.readFileSync(cardPath))},
      pageErrors:errors, ...result};
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function desktop(cardPath, samples, options) {
  const messages = options.messages, readyTimeoutMs = options.readyTimeoutMs, userText = options.userText;
  return withDesktopPage(cardPath, async ({page, call}) => {
    const fixture = await buildDesktopSession(page, messages, userText);
    console.log(`合成 ${fixture.totalMessages} 条已创建；等待显示队列与帧就绪（上限 ${readyTimeoutMs} ms）`);
    // A gate timeout is reported, not thrown: the run continues so the report carries the numbers and
    // the state it gave up on instead of only an error string.
    const gate = await evaluator(call)(awaitChatIdle, {timeoutMs:readyTimeoutMs});
    if (!gate.ready) console.error('桌面初始就绪超时，继续测量并记录状态：' + JSON.stringify(gate.state));
    if (options.scenario === 'expand-all') {
      const heapBefore = await call('Runtime.getHeapUsage').catch(() => null);
      const expand = await evaluator(call)(measureExpandAll, {readyTimeoutMs});
      const heapAfter = await call('Runtime.getHeapUsage').catch(() => null);
      const problems = [gate.ready ? null : '初始闸门未就绪', expand.timedOut ? '展开后 ' + readyTimeoutMs + ' ms 内未就绪' : null]
        .filter(Boolean);
      return {mode:'desktop', scenario:'expand-all', status:problems.length ? 'failed' : 'measured',
        error:problems.join('；') || null,
        fixture, gate, expand, cdpHeap:{before:heapBefore, after:heapAfter}};
    }
    if (options.scenario === 'remount') {
      const remount = await evaluator(call)(measureCardRemount, {readyTimeoutMs, samples});
      const problems = [gate.ready ? null : '初始闸门未就绪',
        remount.coldMountedMedianMs == null ? '没有取到冷挂载样本' : null].filter(Boolean);
      return {mode:'desktop', scenario:'remount', status:problems.length ? 'failed' : 'measured',
        error:problems.join('；') || null, fixture, gate, remount};
    }
    console.log('初始就绪完成；开始主数据守卫、普通计时、分段计时与 Profiler');
    return {mode:'desktop', scenario:'steady', fixture, gate, ...await collect(call, samples, {readyTimeoutMs})};
  });
}

// ===== android =====
function adbPath() {
  return path.join(process.env.LOCALAPPDATA || '','Android/Sdk/platform-tools/adb.exe');
}

function androidRunner(serial) {
  const adb = adbPath();
  // /proc files and dumpsys output run to hundreds of KB; the 1 MB default turns a normal read into
  // an intermittent "Command failed".
  return (...args) => execFileSync(adb,['-s',serial,...args],
    {encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024}).trim();
}

// Which renderer processes belong to com.yeyu.app. A WebView renderer is a child of the app process,
// so its PPID is the only reliable link: the command lines of several apps' renderers are identical.
function androidAppProcessTree(run, appPid) {
  const owned = new Set([String(appPid)]);
  let output = '';
  try { output = run('shell','ps','-A','-o','PID,PPID,NAME'); }
  catch (_) { return owned; }
  const rows = output.split(/\r?\n/).map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean);
  // Two passes cover a renderer whose parent appears after it in the listing.
  for (let pass = 0; pass < 2; pass++)
    rows.forEach(cells => { if (owned.has(cells[2])) owned.add(cells[1]); });
  return owned;
}

// CPU% and RES for the app process and its WebView renderer children, five samples, median per
// process. The explicit -o field list is what makes the columns parseable: toybox's default header
// merges the state, %CPU and MEM columns, so positions read off it do not line up with the rows.
// Rows are keyed by pid, never by name: several apps run a sandboxed process with the very same
// command line, and merging them by name averages an unrelated process into the app's own numbers.
function androidProcessStats(run, samples = 5, owned = null) {
  const rows = new Map();
  let parsed = 0, lastError = null;
  for (let index = 0; index < samples; index++) {
    let output = '';
    try { output = run('shell','top','-b','-n','1','-o','PID,%CPU,RES,ARGS'); }
    catch (error) { lastError = String(error.message || error).slice(0,200); continue; }
    const lines = output.split(/\r?\n/);
    const headerAt = lines.findIndex(line => /\bPID\b/.test(line) && /\bARGS\b/i.test(line));
    if (headerAt < 0) { lastError = '未找到 top 表头'; continue; }
    parsed++;
    for (const line of lines.slice(headerAt+1)) {
      const cells = /^\s*(\d+)\s+([\d.]+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
      if (!cells) continue;
      const pid = cells[1], name = cells[4];
      if (!/com\.yeyu\.app|webview/i.test(name)) continue;
      const entry = rows.get(pid) || {process:name, pid, cpuPercent:[], resKb:[],
        ownedByApp:owned ? owned.has(pid) : null};
      entry.cpuPercent.push(Number(cells[2]));
      entry.resKb.push(parseAndroidSize(cells[3]));
      rows.set(pid, entry);
    }
  }
  const median = values => {
    const sorted = values.filter(value => Number.isFinite(value)).sort((a,b) => a-b);
    if (!sorted.length) return null;
    return (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)]) / 2;
  };
  return {samples, parsedSamples:parsed, error:lastError,
    processes:[...rows.values()].map(entry => ({process:entry.process, pid:entry.pid, ownedByApp:entry.ownedByApp,
      cpuPercentMedian:median(entry.cpuPercent), resKbMedian:median(entry.resKb), readings:entry.cpuPercent.length}))};
}

// top prints RES with a unit suffix once the value leaves kilobytes: 305M, 2.1G. A bare number is
// kilobytes, which is what toybox prints for small processes.
function parseAndroidSize(value) {
  const match = /^([\d.]+)([KMGTkmgt])?$/.exec(String(value || ''));
  if (!match) return null;
  const scale = {K:1, M:1024, G:1024*1024, T:1024*1024*1024}[String(match[2] || 'K').toUpperCase()] || 1;
  return Number(match[1]) * scale;
}

// Connect to the single already-running com.yeyu.app page. Never starts, installs or switches apps.
async function withAndroidPage(serial, work) {
  const run = androidRunner(serial);
  const pid = run('shell','pidof','com.yeyu.app');
  if (!/^\d+$/.test(pid)) throw new Error('夜欲未运行或进程不唯一；未启动、安装或切换手机应用');
  const socketName = 'webview_devtools_remote_' + pid;
  // Grep on the device instead of pulling /proc/net/unix back: the file is hundreds of KB of
  // unrelated sockets and reading it whole failed intermittently.
  const socketLine = (() => {
    try { return run('shell','grep','-a',socketName,'/proc/net/unix'); }
    catch (_) { return ''; }
  })();
  if (!socketLine.includes('@'+socketName)) throw new Error('未发现夜欲 WebView 调试套接字；需先在设备上启动夜欲');
  const port = run('forward','tcp:0','localabstract:'+socketName);
  let client;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pages = targets.filter(t => t.type === 'page' && /^file:\/\/\/android_asset\/index\.html(?:\?|$)/.test(t.url));
    if (pages.length !== 1) throw new Error('夜欲内置页面目标不唯一');
    client = await connect(pages[0].webSocketDebuggerUrl);
    await installMeasureHelpers(client.call);
    return {device:{model:run('shell','getprop','ro.product.model'),android:run('shell','getprop','ro.build.version.release')},
      appPid:pid,
      ...await work({call:client.call, run, appPid:pid})};
  } finally { if (client) client.close(); run('forward','--remove','tcp:'+port); }
}

async function android(serial, samples, options) {
  return {mode:'android', ...await withAndroidPage(serial, async ({call, run, appPid}) => {
    const owned = androidAppProcessTree(run, appPid);
    const processesBefore = androidProcessStats(run, 5, owned);
    const result = await collect(call, samples, {readyTimeoutMs:options.readyTimeoutMs});
    return {...result, processes:{before:processesBefore, after:androidProcessStats(run, 5, owned)}};
  })};
}

async function androidTempSessionCreate(serial, options) {
  return {mode:'android-temp-session', action:'create', ...await withAndroidPage(serial, async ({call}) =>
    ({created:await evaluator(call)(createTempSession, {characterName:options.characterName,
      messages:options.messages, prefix:TEMP_SESSION_PREFIX, sessionName:TEMP_SESSION_NAME,
      userText:TEMP_SESSION_USER_TEXT})}))};
}

async function androidTempSessionDelete(serial, manifest) {
  const created = manifest.created;
  return {mode:'android-temp-session', action:'delete', ...await withAndroidPage(serial, async ({call}) => {
    const deleted = await evaluator(call)(deleteTempSession, {characterId:created.before.characterId,
      prefix:TEMP_SESSION_PREFIX, originalActiveSid:created.before.originalActiveSid,
      originalCharId:created.before.originalCharId});
    const mismatch = compareSessionLists(created.before.sessions, deleted.sessions);
    if (mismatch.length) throw new Error('删除后会话清单与创建前不一致：' + JSON.stringify(mismatch));
    return {deleted, restored:true};
  })};
}

function compareSessionLists(before, after) {
  const key = rows => rows.map(row => row.id + ':' + row.messages).sort();
  const a = key(before), b = key(after), problems = [];
  a.filter(row => !b.includes(row)).forEach(row => problems.push({missing:row}));
  b.filter(row => !a.includes(row)).forEach(row => problems.push({unexpected:row}));
  return problems;
}

// The phone code cannot be run here, so the same in-page create/delete functions are rehearsed on a
// disposable desktop page and the session listing is compared before and after.
async function rehearseTempSession(cardPath, options) {
  return withDesktopPage(cardPath, async ({call, imported}) => {
    const evaluate = evaluator(call);
    const before = await evaluate(() => {
      const char = getChar() || D.characters[D.characters.length-1];
      D.currentCharId = char.id;
      // Desktop-only setup: the phone is already showing the chat page when the probe connects.
      switchAppPage('chat');
      updateChatUI();
      return {characterId:char.id,
        sessions:(getSessions(char.id).sessions || []).map(row => ({id:row.id, name:row.name || '',
          messages:(row.msgs || []).length})),
        activeSid:getSessions(char.id).activeSid};
    });
    const created = await evaluate(createTempSession, {characterName:options.characterName || imported.characterName,
      messages:options.messages, prefix:TEMP_SESSION_PREFIX, sessionName:TEMP_SESSION_NAME,
      userText:TEMP_SESSION_USER_TEXT});
    const gate = await evaluate(awaitChatIdle, {timeoutMs:options.readyTimeoutMs});
    const deleted = await evaluate(deleteTempSession, {characterId:created.before.characterId,
      prefix:TEMP_SESSION_PREFIX, originalActiveSid:created.before.originalActiveSid,
      originalCharId:created.before.originalCharId});
    const mismatch = compareSessionLists(before.sessions, deleted.sessions);
    return {mode:'android-temp-session', action:'rehearse',
      status:mismatch.length ? 'failed' : 'measured',
      error:mismatch.length ? '演练后会话清单不一致：' + JSON.stringify(mismatch) : null,
      before, created, gate, deleted, mismatch};
  });
}

function summary(result, comparison) {
  const fmt = value => value == null ? '未测' : value.toFixed(2);
  const lines = ['# 长聊天渲染测量', '', `目标：${result.mode}；${result.plain.initial.messages} 条存档消息，${result.plain.initial.renderedMessages} 条 DOM，${result.plain.initial.iframes} 个 iframe（Risu ${result.plain.initial.risuFrames} / 卡片 ${result.plain.initial.cardFrames}）。`, '',
    `结果：${result.status === 'failed' ? '失败，后续样本已停止：'+result.error : '完成'}。`, '',
    '| 指标 | 本次中位 ms | 桌面对照 ms | 真机 / 桌面 |','| --- | ---: | ---: | ---: |'];
  for (const key of ['renderMs','anchorMs','settledMs']) {
    const value = result.metrics[key].medianMs, base = comparison?.metrics?.[key]?.medianMs;
    lines.push(`| ${key} | ${fmt(value)} | ${fmt(base)} | ${result.status === 'measured' && base > 0 ? fmt(value/base)+'×' : '未测'} |`);
  }
  lines.push('', '分段为第二轮临时插桩的同步独占耗时（嵌套调用扣除，不代表纯正则引擎或纯 Markdown 解析器）。异步同步为墙钟耗时，不能与独占耗时相加。', '',
    '| 分段 | 次数 | 总 ms | P50 / P95 ms |', '| --- | ---: | ---: | ---: |');
  for (const [key,row] of Object.entries(result.segments)) lines.push(`| ${key} | ${row.count} | ${fmt(row.totalMs)} | ${fmt(row.medianMs)} / ${fmt(row.p95Ms)} |`);
  lines.push('', 'Profiler 自耗时前 10 项（1ms 抽样）：', '', '| 函数 | 位置 | 自耗时 ms |', '| --- | --- | ---: |');
  result.profiler.top10.forEach(row => lines.push(`| ${row.name.replace(/\|/g,'/')} | ${row.source}:${row.line} | ${fmt(row.selfMs)} |`));
  if (result.failureState) lines.push('', `就绪失败时的状态：${JSON.stringify(result.failureState)}`);
  if (result.processes) {
    lines.push('', '真机进程（5 次 top 采样中位，按 pid 分行；同名进程可能属于别的应用）：', '',
      '| PID | 属于夜欲 | 进程 | CPU% | RES MB |', '| ---: | --- | --- | ---: | ---: |');
    result.processes.after.processes.forEach(row => lines.push(`| ${row.pid} | ${row.ownedByApp === null ? '未判定' : row.ownedByApp ? '是' : '否'} | ${row.process.replace(/\|/g,'/')} | ${fmt(row.cpuPercentMedian)} | ${fmt(row.resKbMedian == null ? null : row.resKbMedian/1024)} |`));
  }
  const paths = [...new Set(result.guard.derivedChanges.flatMap(row => row.changes.map(change => change.path)))];
  lines.push('',`主数据：${result.guard.mainUnchanged === true ? '一致' : result.guard.mainUnchanged === false ? '不一致' : '未完成核验'}，已检查 ${result.guard.checks.length} 个样本。前后哈希及逐次检查见 JSON 的 guard。`,
    `派生字段变化：${paths.length ? paths.slice(0,20).join('、')+(paths.length>20 ? `（共 ${paths.length} 项，完整清单见 JSON）` : '') : '无'}。`, '',
    result.plain.scope || '', '未主动展开历史；未测首次打开、滚动流畅度或图片下载延迟；桌面合成与手机真实内容不同，倍率只作场景对照，不是硬件性能倍率。',
    ...(comparison ? [`对照规模：${comparison.plain.initial.messages} 条消息 / ${comparison.plain.initial.renderedMessages} 条 DOM / ${comparison.plain.initial.risuFrames} 个 Risu 帧。`] : ['真机数据及倍率待用户装好 r5、连线并打开目标会话后采集。']),'');
  return lines.join('\n');
}

function expandSummary(result) {
  const fmt = value => value == null ? '未测' : Number(value).toFixed(2);
  const mb = value => value == null ? '未测' : (value/1048576).toFixed(1);
  const {expand} = result;
  return ['# 跳转到对话开头耗时', '',
    `目标：桌面合成 ${result.fixture.totalMessages} 条；跳转前 ${expand.before.renderedMessages} 条 DOM、${expand.before.cardFrames} 个卡片帧 / ${expand.before.cardPlaceholders} 个占位。`,
    `入口：${expand.entry}。结果：${result.status === 'failed' ? '就绪超时，数据仍保留：'+result.error : '完成'}。`, '',
    '| 指标 | 值 |', '| --- | ---: |',
    `| anchorMs | ${fmt(expand.anchorMs)} |`,
    `| renderMs（同步 renderChat 累计，${expand.renderCalls} 次） | ${fmt(expand.renderMs)} |`,
    `| 第 1 条进入视口 ms | ${expand.firstMessageMs == null ? '未就位' : fmt(expand.firstMessageMs)} |`,
    `| settledMs（调用到空闲） | ${fmt(expand.settledMs)} |`,
    `| 显示转换队列归零 ms | ${expand.pendingDrainMs == null ? '未归零' : fmt(expand.pendingDrainMs)} |`,
    `| 跳转后 DOM 消息数 | ${expand.after.renderedMessages} |`,
    `| 跳转后 iframe 数 | ${expand.after.iframes} |`,
    `| 跳转后卡片帧 / 占位 | ${expand.after.cardFrames} / ${expand.after.cardPlaceholders} |`,
    `| JS 堆 跳转前 → 后 MB | ${mb(expand.before.heapUsedBytes)} → ${mb(expand.after.heapUsedBytes)} |`,
    `| CDP 堆 跳转前 → 后 MB | ${mb(result.cdpHeap.before?.usedSize)} → ${mb(result.cdpHeap.after?.usedSize)} |`,
    '', expand.scope, ''].join('\n');
}

function remountSummary(result) {
  const fmt = value => value == null ? '未测' : Number(value).toFixed(2);
  const {remount} = result;
  const lines = ['# 卡片重挂耗时', '',
    `目标：桌面合成 ${result.fixture.totalMessages} 条；就绪时 ${remount.initial.renderedMessages} 条 DOM、${remount.initial.cardPlaceholders} 个卡片位置、${remount.initial.cardFramesConnected} 个运行帧。`,
    `结果：${result.status === 'failed' ? '未取满样本：'+result.error : '完成'}。`, '',
    '| 指标 | 值 |', '| --- | ---: |',
    `| 冷挂载中位 ms（${remount.coldCount} 次） | ${fmt(remount.coldMountedMedianMs)} |`,
    `| 热重挂中位 ms（${remount.warmCount} 次） | ${fmt(remount.warmMountedMedianMs)} |`,
    `| 热轮仍在运行未被淘汰 | ${remount.warmStillLive} |`,
    `| 运行帧数峰值 | ${remount.peak.frames} |`,
    `| 阅读位移 中位 / 最大 px | ${fmt(remount.readingShiftMedianPx)} / ${remount.readingShiftMaxPx} |`,
    `| 居中行位移 中位 / 最大 px | ${fmt(remount.offsetShiftMedianPx)} / ${remount.offsetShiftMaxPx} |`,
    `| 就绪后贴底偏差 px（scrollHeight-clientHeight-scrollTop） | ${remount.bottomGapAfterReady} |`,
    '', '| 轮次 | 消息序号 | 挂载 ms | 滚动静默 ms | 阅读位移 px | 居中行位移 px | 已在运行 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |'];
  remount.rows.forEach(row => lines.push(`| ${row.phase} | ${row.index} | ${row.mountedMs == null ? '未挂载' : row.mountedMs} | ${row.scrollIdleMs == null ? '未记录' : row.scrollIdleMs} | ${row.readingShiftPx} | ${row.offsetShiftPx} | ${row.alreadyLive ? '是' : '否'} |`));
  lines.push('', remount.scope, '');
  return lines.join('\n');
}

function parseArgs(args, allowed) {
  const options = {};
  if (args.length % 2) throw new Error('参数必须成对出现');
  for (let i=0;i<args.length;i+=2) {
    if (!allowed.includes(args[i])) throw new Error('未知参数：'+args[i]);
    options[args[i].slice(2)] = args[i+1];
  }
  return options;
}

const USAGE = ['用法：',
  '  node tools/probes/chat_render_measure.js desktop --card <卡片.png> [--out <目录>] [--samples 5] [--scenario steady|expand-all|remount] [--messages 300] [--ready-timeout 20000]',
  '  node tools/probes/chat_render_measure.js android --serial <设备序列> [--compare <desktop.json>] [--out <目录>] [--samples 5] [--ready-timeout 20000]',
  '  node tools/probes/chat_render_measure.js android-temp-session create --serial <设备序列> --character-name <角色名> [--messages 300] [--out <目录>]',
  '  node tools/probes/chat_render_measure.js android-temp-session delete --serial <设备序列> [--out <目录>] [--manifest <create 输出 json>]',
  '  node tools/probes/chat_render_measure.js android-temp-session rehearse --card <卡片.png> [--messages 300] [--out <目录>] [--ready-timeout 20000]',
].join('\n');

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  if (!['desktop','android','android-temp-session'].includes(mode)) throw new Error(USAGE);
  if (mode === 'android-temp-session') return tempSessionMain(args);
  const options = parseArgs(args, ['--card','--serial','--out','--samples','--compare','--scenario','--messages','--ready-timeout']);
  const samples = Number(options.samples || 5);
  if (!Number.isInteger(samples) || samples<5) throw new Error('samples 至少为 5');
  const scenario = options.scenario || 'steady';
  if (!['steady','expand-all','remount'].includes(scenario)) throw new Error('scenario 只支持 steady、expand-all 或 remount');
  const messages = Number(options.messages || (scenario === 'expand-all' ? 1200 : 300));
  if (!Number.isInteger(messages) || messages < 2) throw new Error('messages 至少为 2');
  const readyTimeoutMs = Number(options['ready-timeout'] || 20000);
  if (!Number.isInteger(readyTimeoutMs) || readyTimeoutMs < 1000) throw new Error('ready-timeout 至少为 1000');
  if (mode === 'android' && (!options.serial || options.card)) throw new Error('Android 必须显式指定 --serial，且不接受 --card');
  if (mode === 'android' && (options.scenario || options.messages))
    throw new Error('Android 只测当前已打开的会话，不接受 --scenario 或 --messages');
  if (mode === 'desktop' && !options.card) throw new Error('桌面合成必须指定 --card');
  if (mode !== 'android' && options.compare) throw new Error('--compare 仅供真机与桌面对照');
  const comparison = options.compare ? JSON.parse(fs.readFileSync(path.resolve(options.compare),'utf8')) : null;
  if (comparison && (comparison.mode !== 'desktop' || comparison.status !== 'measured')) throw new Error('--compare 须为本探针测量成功的桌面 JSON');
  const output = path.resolve(options.out || path.join(root,'.tmp/chat-render-measure',mode));
  const result = mode === 'desktop'
    ? await desktop(path.resolve(options.card), samples,
      {messages, scenario, readyTimeoutMs, userText:TEMP_SESSION_USER_TEXT})
    : await android(options.serial, samples, {readyTimeoutMs});
  stamp(result);
  fs.mkdirSync(output,{recursive:true});
  const name = result.scenario && result.scenario !== 'steady' ? mode + '-' + result.scenario : mode;
  fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(output,name+'.md'),
    result.scenario === 'expand-all' ? expandSummary(result)
      : result.scenario === 'remount' ? remountSummary(result) : summary(result,comparison));
  console.log(JSON.stringify(result.scenario === 'expand-all'
    ? {output,mode,scenario:result.scenario,status:result.status,error:result.error,
      fixture:result.fixture,gate:{ready:result.gate.ready,ms:result.gate.ms,bottomGapPx:result.gate.state.bottomGapPx},
      expand:{anchorMs:result.expand.anchorMs,renderMs:result.expand.renderMs,renderCalls:result.expand.renderCalls,
        firstMessageMs:result.expand.firstMessageMs,settledMs:result.expand.settledMs,entry:result.expand.entry,
        pendingDrainMs:result.expand.pendingDrainMs,timedOut:result.expand.timedOut,
        before:result.expand.before,after:result.expand.after},
      cdpHeap:result.cdpHeap}
    : result.scenario === 'remount'
    ? {output,mode,scenario:result.scenario,status:result.status,error:result.error,
      gate:{ready:result.gate.ready,ms:result.gate.ms,bottomGapPx:result.gate.state.bottomGapPx},
      remount:{coldMountedMedianMs:result.remount.coldMountedMedianMs,warmMountedMedianMs:result.remount.warmMountedMedianMs,
        coldCount:result.remount.coldCount,warmCount:result.remount.warmCount,warmStillLive:result.remount.warmStillLive,
        peak:result.remount.peak,offsetShiftMaxPx:result.remount.offsetShiftMaxPx,
        offsetShiftMedianPx:result.remount.offsetShiftMedianPx,readingShiftMaxPx:result.remount.readingShiftMaxPx,
        readingShiftMedianPx:result.remount.readingShiftMedianPx,
        initial:result.remount.initial,final:result.remount.final}}
    : {output,mode,status:result.status,error:result.error,metrics:result.metrics,counts:result.plain.initial,
      failureState:result.failureState,processes:result.processes || null,
      mainUnchanged:result.guard.mainUnchanged,derivedChangeSamples:result.guard.derivedChanges.length},null,2));
  if (result.status === 'failed') process.exitCode = 1;
}

function stamp(result) {
  result.measuredAt = new Date().toISOString();
  result.sourceHead = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  result.probeSha256 = probeSha256;
  result.tempSessionPrefix = TEMP_SESSION_PREFIX;
}

async function tempSessionMain(args) {
  const action = args.shift();
  if (!['create','delete','rehearse'].includes(action)) throw new Error(USAGE);
  const options = parseArgs(args, ['--serial','--character-name','--messages','--out','--manifest','--card','--ready-timeout']);
  const output = path.resolve(options.out || path.join(root,'.tmp/chat-render-measure/android-temp-session'));
  const manifestPath = path.resolve(options.manifest || path.join(output,'create.json'));
  const messages = Number(options.messages || 300);
  if (!Number.isInteger(messages) || messages < 2) throw new Error('messages 至少为 2');
  const readyTimeoutMs = Number(options['ready-timeout'] || 20000);
  let result;
  if (action === 'create') {
    if (!options.serial || !options['character-name']) throw new Error('create 必须指定 --serial 与 --character-name');
    result = await androidTempSessionCreate(options.serial, {characterName:options['character-name'], messages});
  } else if (action === 'delete') {
    if (!options.serial) throw new Error('delete 必须指定 --serial');
    if (!fs.existsSync(manifestPath)) throw new Error('找不到 create 输出清单：'+manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if (manifest.action !== 'create' || !manifest.created) throw new Error('清单不是本探针的 create 输出');
    result = await androidTempSessionDelete(options.serial, manifest);
  } else {
    if (!options.card) throw new Error('rehearse 必须指定 --card');
    result = await rehearseTempSession(path.resolve(options.card),
      {messages, characterName:options['character-name'], readyTimeoutMs});
  }
  stamp(result);
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,action+'.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if (result.status === 'failed') process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode=1; });
module.exports = {measureChat,measureExpandAll,measureCardRemount,captureChatData,collect,statistics,profileTop,
  summary,expandSummary,remountSummary,
  changedMain,changedDerived,idleSnapshot,awaitChatIdle,createTempSession,deleteTempSession,compareSessionLists,
  androidProcessStats,parseAndroidSize};
