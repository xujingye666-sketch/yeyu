// ===== Same-origin card frontend host =====
// Executable card HTML runs in unsandboxed same-origin iframes aligned with TavernHelper 4.11.3.
// The frame receives host API functions directly and can also access the real parent window.
var CARD_FRONTEND_MARK_OPEN = 'FRONT',
  CARD_FRONTEND_MARK_CLOSE = '',
  CARD_FRONTEND_VOID = {
    area: 1,
    base: 1,
    br: 1,
    col: 1,
    embed: 1,
    hr: 1,
    img: 1,
    input: 1,
    link: 1,
    meta: 1,
    param: 1,
    source: 1,
    track: 1,
    wbr: 1,
  },
  CARD_FRONTEND_RAW_TEXT = { script: 1, style: 1, textarea: 1, title: 1 },
  CARD_FRONTEND_IFRAME_EVENT_VALUES = {
    MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
    MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
    GENERATION_REQUESTED: 'js_generation_requested',
    GENERATION_STARTED: 'js_generation_started',
    STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
    GENERATION_ENDED: 'js_generation_ended',
  },
  CARD_FRONTEND_TAVERN_EVENT_VALUES = {
    APP_READY: 'app_ready',
    EXTRAS_CONNECTED: 'extras_connected',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_FILE_EMBEDDED: 'message_file_embedded',
    MESSAGE_REASONING_EDITED: 'message_reasoning_edited',
    MESSAGE_REASONING_DELETED: 'message_reasoning_deleted',
    MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
    IMPERSONATE_READY: 'impersonate_ready',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
    GENERATION_STARTED: 'generation_started',
    GENERATION_STOPPED: 'generation_stopped',
    GENERATION_ENDED: 'generation_ended',
    SD_PROMPT_PROCESSING: 'sd_prompt_processing',
    EXTENSIONS_FIRST_LOAD: 'extensions_first_load',
    EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
    SETTINGS_LOADED: 'settings_loaded',
    SETTINGS_UPDATED: 'settings_updated',
    MOVABLE_PANELS_RESET: 'movable_panels_reset',
    SETTINGS_LOADED_BEFORE: 'settings_loaded_before',
    SETTINGS_LOADED_AFTER: 'settings_loaded_after',
    CHATCOMPLETION_SOURCE_CHANGED: 'chatcompletion_source_changed',
    CHATCOMPLETION_MODEL_CHANGED: 'chatcompletion_model_changed',
    OAI_PRESET_CHANGED_BEFORE: 'oai_preset_changed_before',
    OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after',
    OAI_PRESET_EXPORT_READY: 'oai_preset_export_ready',
    OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready',
    WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    CHARACTER_EDITOR_OPENED: 'character_editor_opened',
    CHARACTER_EDITED: 'character_edited',
    CHARACTER_PAGE_LOADED: 'character_page_loaded',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    FORCE_SET_BACKGROUND: 'force_set_background',
    CHAT_DELETED: 'chat_deleted',
    CHAT_CREATED: 'chat_created',
    GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
    GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
    GENERATE_AFTER_DATA: 'generate_after_data',
    WORLD_INFO_ACTIVATED: 'world_info_activated',
    TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    CHARACTER_FIRST_MESSAGE_SELECTED: 'character_first_message_selected',
    CHARACTER_DELETED: 'characterDeleted',
    CHARACTER_DUPLICATED: 'character_duplicated',
    CHARACTER_RENAMED: 'character_renamed',
    CHARACTER_RENAMED_IN_PAST_CHAT: 'character_renamed_in_past_chat',
    SMOOTH_STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_TOKEN_RECEIVED: 'stream_token_received',
    STREAM_REASONING_DONE: 'stream_reasoning_done',
    FILE_ATTACHMENT_DELETED: 'file_attachment_deleted',
    WORLDINFO_FORCE_ACTIVATE: 'world_info_force_activate',
    OPEN_CHARACTER_LIBRARY: 'open_character_library',
    ONLINE_STATUS_CHANGED: 'online_status_changed',
    IMAGE_SWIPED: 'image_swiped',
    CONNECTION_PROFILE_LOADED: 'connection_profile_loaded',
    CONNECTION_PROFILE_CREATED: 'connection_profile_created',
    CONNECTION_PROFILE_DELETED: 'connection_profile_deleted',
    CONNECTION_PROFILE_UPDATED: 'connection_profile_updated',
    CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown',
    SECRET_WRITTEN: 'secret_written',
    SECRET_DELETED: 'secret_deleted',
    SECRET_ROTATED: 'secret_rotated',
    SECRET_EDITED: 'secret_edited',
    PRESET_CHANGED: 'preset_changed',
    PRESET_DELETED: 'preset_deleted',
    PRESET_RENAMED: 'preset_renamed',
    PRESET_RENAMED_BEFORE: 'preset_renamed_before',
    MAIN_API_CHANGED: 'main_api_changed',
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
    WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
    MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
  },
  CARD_FRONTEND_EVENTS = Object.keys(CARD_FRONTEND_IFRAME_EVENT_VALUES).concat(
    Object.keys(CARD_FRONTEND_TAVERN_EVENT_VALUES)
  ),
  // SillyTavern serves Font Awesome from its own document, and card scripts rely on that: they put
  // their stylesheet <link> inside a shadow root, where Chromium ignores @font-face, so the faces
  // have to come from the host document (index.html) and from every frame that runs card code.
  CARD_FRONTEND_FONT_AWESOME_URL = 'css/vendor/fontawesome-6.7.2/css/all.min.css',
  CARD_FRONTEND_BASE_CSS =
    'html,body{margin:0;padding:0;background:transparent;height:auto;max-height:none;}body{overflow-x:hidden;}img,video,canvas{max-width:100%;}.yeyu-frontend-image-failed,.yeyu-frontend-image-loading{box-sizing:border-box!important;display:flex!important;width:100%!important;max-width:100%!important;min-height:64px!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;gap:7px!important;margin:6px 0!important;padding:9px!important;border:1px dashed #8d8d99!important;border-radius:7px!important;background:#1b1b22!important;color:#f2f2f5!important;font:13px/1.45 system-ui,sans-serif!important;text-align:center!important;overflow-wrap:anywhere!important;}.yeyu-frontend-image-failed-address{display:block!important;width:100%!important;color:#c8c8d2!important;font:11px/1.4 ui-monospace,monospace!important;overflow-wrap:anywhere!important;}.yeyu-frontend-image-retry{box-sizing:border-box!important;min-height:36px!important;padding:6px 14px!important;border:1px solid #9999aa!important;border-radius:6px!important;background:#30303b!important;color:#fff!important;font:600 13px/1 system-ui,sans-serif!important;cursor:pointer!important;}',
  // Font Awesome 6 comes first and the official template's Font Awesome 7 stays last: the 7 release
  // only declares the 7/5/4 families, so cards written against the 6 class names need the 6 faces
  // registered as well, while the template's own class rules keep winning.
  CARD_FRONTEND_MESSAGE_RESOURCES = [
    { kind: 'style', url: CARD_FRONTEND_FONT_AWESOME_URL },
    { kind: 'style', url: 'css/vendor/fontawesome-7.3.1/css/all.min.css' },
    { kind: 'script', url: 'js/vendor/tailwind-browser-4.1.12.global.js' },
    { kind: 'script', url: 'js/vendor/jquery-4.0.0.min.js' },
    { kind: 'script', url: 'js/vendor/jquery-ui-1.14.2.min.js' },
    { kind: 'style', url: 'css/vendor/jquery-ui-1.14.2/theme.css' },
    {
      kind: 'script',
      url: 'js/vendor/jquery-ui-touch-punch-0.2.3.min.js',
    },
    { kind: 'script', url: 'js/vendor/vue-3.5.41.runtime.global.prod.js' },
    { kind: 'script', url: 'js/vendor/vue-router-5.2.0.global.prod.js' },
  ],
  CARD_FRONTEND_PREDEFINE_RESOURCES = [{ kind: 'script', url: 'js/vendor/showdown-2.1.0.min.js' }],
  // How many message frontends may run at the same time. The newest card-bearing message is pinned
  // and does not take one of these slots. Kept low because heavy cards running side by side stutter
  // on the phone; 4 was confirmed on a real device as enough for reading back.
  CARD_FRONTEND_LIVE_LIMIT = 4,
  // Of those slots, this many always go to the frontends nearest the reading position, so scrolling
  // to a placeholder always starts it. The rest keep the most recently used frontends alive.
  CARD_FRONTEND_NEAR_KEEP = 3,
  // Height a placeholder reserves when the same content has never been measured at this width.
  CARD_FRONTEND_PLACEHOLDER_HEIGHT = 220,
  // Quiet time after the last chat scroll before frontends may start or be retired.
  CARD_FRONTEND_SCROLL_IDLE_MS = 150,
  // Ceiling on how long one starting frontend holds the queue before the next one starts.
  CARD_FRONTEND_MOUNT_STEP_MS = 400,
  // Remembered heights and "recently used" marks are keyed per content and would otherwise grow for
  // the whole session; both are kept as bounded LRUs.
  CARD_FRONTEND_KEY_MEMORY_LIMIT = 500,
  _cardFrontendSource = new Map(),
  _cardFrontendLive = new Map(),
  _cardFrontendRetiring = new Map(),
  _cardFrontendStopped = Object.create(null),
  _cardFrontendHeights = new Map(),
  // Bumped whenever a remembered height actually changes, so a repaint can tell at a glance that a
  // placeholder already showing the current estimate needs no measuring and no writing at all.
  _cardFrontendHeightRevision = 0,
  _cardFrontendPendingShown = typeof WeakMap === 'function' ? new WeakMap() : null,
  _cardFrontendUsed = new Map(),
  _cardFrontendUseSeq = 0,
  _cardFrontendScrolling = false,
  _cardFrontendScrollIdleTimer = 0,
  _cardFrontendMountingKey = '',
  _cardFrontendMountTimer = 0,
  _cardFrontendScheduleQueued = false,
  _cardFrontendSeq = 0,
  _cardFrontendBound = false,
  _cardFrontendPage = '',
  _cardFrontendCreatedPage = '',
  _cardFrontendLayoutObserver = null,
  _cardFrontendHostStyleObserver = null,
  _cardFrontendHostInlineStyleObserver = null,
  _cardScriptLibraryLive = null,
  _cardScriptLibraryStopped = Object.create(null),
  _cardScriptSendIntercept = null,
  _cardScriptSendInterceptSeq = 0,
  _cardScriptEventWaiters = new Map(),
  _cardScriptEventSeq = 0,
  _cardFrontendToasts = new Map(),
  _cardFrontendEventListeners = [],
  _cardFrontendEventRuns = new Map(),
  _cardFrontendEventRunSeq = 0,
  _cardFrontendMacroLikes = [],
  CARD_SCRIPT_LIBRARY_RESOURCES = [
    { kind: 'style', url: CARD_FRONTEND_FONT_AWESOME_URL },
    { kind: 'script', url: 'js/vendor/vue-3.5.41.runtime.global.prod.js' },
    { kind: 'script', url: 'js/vendor/vue-router-5.2.0.global.prod.js' },
    // shujuku v9.1 and existing library cards consume jQuery; keep TavernHelper's resident-frame
    // compatibility choice while message frontends remain pinned to the official jQuery 4 template.
    { kind: 'script', url: 'js/vendor/jquery-3.7.1.min.js' },
  ];

// A cancellable deadline for host work that waits on a frame or asynchronous rendering.
function cardFrontendAbortError(label) {
  var error = new Error(String(label || '卡片操作') + '已停止');
  error.name = 'AbortError';
  return error;
}
function cardFrontendAwaitWithTimeout(promise, options) {
  options = options || {};
  var signal = options.signal,
    timeoutMs = Number(options.timeoutMs),
    label = String(options.label || '卡片操作');
  if (signal && signal.aborted) {
    Promise.resolve(promise).catch(function () {});
    return Promise.reject(cardFrontendAbortError(label));
  }
  return new Promise(function (resolve, reject) {
    var settled = false,
      timer = null;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    }
    function onAbort() {
      finish(cardFrontendAbortError(label));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0)
      timer = setTimeout(function () {
        var error = new Error(label + '等待超时（' + timeoutMs + 'ms）');
        error.name = 'TimeoutError';
        finish(error);
      }, timeoutMs);
    Promise.resolve(promise).then(
      function (value) {
        finish(null, value);
      },
      function (error) {
        finish(error);
      }
    );
  });
}

function cardFrontendEmptyScan() {
  return {
    count: 0,
    scripts: [],
    active: [],
    disabled: [],
    unsupported: [],
    remotes: [],
    runtimeRemotes: [],
    missing: [],
    usesParent: false,
    usesHostInput: false,
  };
}
function cardFrontendCopy(value) {
  if (value == null) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (_) {}
  return JSON.parse(JSON.stringify(value));
}
function cardFrontendHash(value) {
  var text = String(value == null ? '' : value),
    hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function cardFrontendIgnoresRuntimeError(value) {
  var message = value && typeof value === 'object' && value.message != null ? value.message : value;
  return (
    message === 'ResizeObserver loop completed with undelivered notifications' ||
    message === 'ResizeObserver loop limit exceeded'
  );
}
function cardFrontendEnsureVendor() {
  if (typeof self === 'undefined') return null;
  var yamlSource = String(self.__yeyuMvuRuntimeVendorSource || ''),
    workerSource = String(self.__yeyuMvuWorkerVendorSource || '');
  if ((!self.YeyuMvuVendor || typeof self.YeyuMvuVendor.parseYaml !== 'function') && yamlSource) (0, eval)(yamlSource);
  var yaml = self.YeyuMvuVendor || {};
  if ((!self.YeyuMvuVendor || !self.YeyuMvuVendor.z || !self.YeyuMvuVendor._) && workerSource) {
    (0, eval)(workerSource);
    self.YeyuMvuVendor.parseYaml = yaml.parseYaml;
    self.YeyuMvuVendor.stringifyYaml = yaml.stringifyYaml;
  }
  return self.YeyuMvuVendor || null;
}
cardFrontendEnsureVendor();

function cardFrontendTagEnd(source, from) {
  var quote = '';
  for (var i = from; i < source.length; i++) {
    var character = source.charAt(i);
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return i + 1;
  }
  return source.length;
}
function cardFrontendNextTag(source, from) {
  var at = source.indexOf('<', from);
  while (at >= 0) {
    if (source.substr(at, 4) === '<!--') {
      var comment = source.indexOf('-->', at);
      return { kind: 'comment', start: at, end: comment < 0 ? source.length : comment + 3 };
    }
    if (source.substr(at, 2) === '<!') return { kind: 'declaration', start: at, end: cardFrontendTagEnd(source, at) };
    var closing = source.charAt(at + 1) === '/',
      name = /^([a-zA-Z][^\s/>]*)/.exec(source.substr(closing ? at + 2 : at + 1, 80));
    if (name)
      return {
        kind: closing ? 'close' : 'open',
        name: name[1].toLowerCase(),
        start: at,
        end: cardFrontendTagEnd(source, at),
      };
    at = source.indexOf('<', at + 1);
  }
  return null;
}
function cardFrontendElementEnd(source, tag) {
  var name = tag.name;
  if (CARD_FRONTEND_VOID[name] || source.charAt(tag.end - 2) === '/') return tag.end;
  if (CARD_FRONTEND_RAW_TEXT[name]) {
    var close = new RegExp('</' + name + '\\s*>', 'i'),
      rest = source.slice(tag.end),
      hit = close.exec(rest);
    return hit ? tag.end + hit.index + hit[0].length : source.length;
  }
  var depth = 1,
    cursor = tag.end,
    token;
  while (depth > 0 && (token = cardFrontendNextTag(source, cursor))) {
    if (token.kind === 'open' && CARD_FRONTEND_RAW_TEXT[token.name] && token.name !== name) {
      cursor = cardFrontendElementEnd(source, token);
      continue;
    }
    if (
      token.kind === 'open' &&
      token.name === name &&
      !CARD_FRONTEND_VOID[name] &&
      source.charAt(token.end - 2) !== '/'
    )
      depth++;
    else if (token.kind === 'close' && token.name === name) {
      depth--;
      if (!depth) return token.end;
    }
    cursor = token.end;
  }
  // Never closed: an unmatched tag in ordinary prose must not take the rest of the message with it,
  // so the tag stands alone and everything after it is scanned as its own top level content.
  return tag.end;
}
// A run is executable when it contains a <script> element or an inline on* handler. Attributes are
// read inside real tag boundaries, so a quoted '>' in an attribute value cannot hide a handler and
// prose that merely spells "onload=" is not a feature.
function cardFrontendExecutable(value) {
  var source = String(value || ''),
    cursor = 0,
    token;
  while ((token = cardFrontendNextTag(source, cursor))) {
    if (token.kind === 'open') {
      if (token.name === 'script') return true;
      if (/\son[a-z]{2,20}\s*=/i.test(source.slice(token.start, token.end))) return true;
    }
    cursor = token.end;
  }
  return false;
}
function cardFrontendFence(value) {
  return ['html>', '<head>', '<body'].some(function (tag) {
    return String(value || '').indexOf(tag) >= 0;
  });
}
function cardFrontendClamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), Math.max(min, max));
}
function cardFrontendMenuViewportOffset(rect, viewport) {
  var gap = 8,
    left = Number(viewport && viewport.left) || 0,
    top = Number(viewport && viewport.top) || 0,
    right = left + Math.max(1, Number(viewport && viewport.width) || 1),
    bottom = top + Math.max(1, Number(viewport && viewport.height) || 1);
  return {
    x:
      cardFrontendClamp(
        Number(rect && rect.left) || 0,
        left + gap,
        right - gap - Math.max(0, Number(rect && rect.width) || 0)
      ) - (Number(rect && rect.left) || 0),
    y:
      cardFrontendClamp(
        Number(rect && rect.top) || 0,
        top + gap,
        bottom - gap - Math.max(0, Number(rect && rect.height) || 0)
      ) - (Number(rect && rect.top) || 0),
  };
}
function cardFrontendViewerZoom(startZoom, startDistance, distance) {
  return cardFrontendClamp(
    (Number(startZoom) || 1) * (Math.max(1, Number(distance) || 1) / Math.max(1, Number(startDistance) || 1)),
    1,
    4
  );
}
function cardFrontendGestureGeometry(payload, metrics, slot) {
  var scale = Math.max(0.0001, Number(metrics && metrics.scale) || 1),
    scrollLeft = Math.max(0, Number(slot && slot.scrollLeft) || 0),
    scrollTop = Math.max(0, Number(slot && slot.scrollTop) || 0);
  var x = payload && payload.pointX != null ? payload.pointX : payload && payload.centerX,
    y = payload && payload.pointY != null ? payload.pointY : payload && payload.centerY;
  return {
    x: (Number(x) || 0) * scale - scrollLeft,
    y: (Number(y) || 0) * scale - scrollTop,
    distance: Math.max(1, (Number(payload && payload.distance) || 1) * scale),
  };
}
function cardFrontendFullscreenActionsHtml(key) {
  if (!key) return '';
  var safe = typeof escAttr === 'function' ? escAttr(key) : String(key).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return (
    '<div class="msg-more yeyu-card-frontend-fullscreen-menu"><button type="button" class="btn sm msg-more-toggle yeyu-card-frontend-fullscreen-toggle" aria-expanded="false" title="选择卡片全屏方式">' +
    (typeof uiIcon === 'function' ? uiIcon('expand') : '') +
    '全屏</button><div class="msg-more-menu">' +
    '<button type="button" class="btn sm yeyu-card-frontend-fullscreen-action" data-frontend-key="' +
    safe +
    '" data-frontend-mode="phone" title="按当前卡片的手机布局全屏打开">' +
    (typeof uiIcon === 'function' ? uiIcon('expand') : '') +
    '手机版全屏</button>' +
    '<button type="button" class="btn sm yeyu-card-frontend-fullscreen-action" data-frontend-key="' +
    safe +
    '" data-frontend-mode="desktop" title="只把当前卡片按电脑版排版全屏打开">' +
    (typeof uiIcon === 'function' ? uiIcon('monitor') : '') +
    '电脑版全屏</button></div></div>'
  );
}
// Top level nodes of one text chunk. Prose separates runs; whitespace and comments do not.
function cardFrontendTopLevelNodes(source) {
  var nodes = [],
    cursor = 0,
    token;
  while ((token = cardFrontendNextTag(source, cursor))) {
    if (token.start > cursor)
      nodes.push({
        type: String(source.slice(cursor, token.start)).trim() ? 'text' : 'blank',
        start: cursor,
        end: token.start,
      });
    if (token.kind === 'open') {
      var end = cardFrontendElementEnd(source, token);
      nodes.push({ type: 'element', start: token.start, end: end });
      cursor = end;
    } else {
      nodes.push({
        type: token.kind === 'comment' || token.kind === 'declaration' ? 'blank' : 'text',
        start: token.start,
        end: token.end,
      });
      cursor = token.end;
    }
  }
  if (cursor < source.length)
    nodes.push({ type: String(source.slice(cursor)).trim() ? 'text' : 'blank', start: cursor, end: source.length });
  return nodes;
}
function cardFrontendRuns(source) {
  var nodes = cardFrontendTopLevelNodes(source),
    runs = [],
    current = null;
  function flush() {
    if (current && current.executable) runs.push({ start: current.start, end: current.end });
    current = null;
  }
  nodes.forEach(function (node) {
    if (node.type === 'text') {
      flush();
      return;
    }
    if (node.type === 'blank') return;
    var markup = source.slice(node.start, node.end),
      executable = cardFrontendExecutable(markup);
    if (!current) current = { start: node.start, end: node.end, executable: false };
    current.end = node.end;
    if (executable) current.executable = true;
  });
  flush();
  return runs;
}
function cardFrontendSegments(source) {
  var text = String(source || ''),
    segments = [],
    plain = [],
    cursor = 0,
    // Markdown fence rules: both delimiters start a line, and the closing run repeats the opening
    // character at least as many times. A card frontend template regularly contains ``` inside its
    // own JavaScript, so a mid-line run must not be read as the end of the block.
    fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*\r?\n(?:([\s\S]*?)\r?\n)?[ \t]{0,3}\1[`~]*[ \t]*(?=\r?\n|$)/gm,
    match;
  while ((match = fence.exec(text))) {
    if (match.index > cursor) plain.push({ start: cursor, end: match.index });
    if (cardFrontendFence(match[2]))
      segments.push({ start: match.index, end: match.index + match[0].length, html: String(match[2] || '') });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) plain.push({ start: cursor, end: text.length });
  plain.forEach(function (part) {
    var chunk = text.slice(part.start, part.end);
    if (!cardFrontendExecutable(chunk)) return;
    cardFrontendRuns(chunk).forEach(function (run) {
      segments.push({
        start: part.start + run.start,
        end: part.start + run.end,
        html: chunk.slice(run.start, run.end),
      });
    });
  });
  return segments.sort(function (left, right) {
    return left.start - right.start;
  });
}
// A reply that is still arriving, and a reply an interruption cut short, can end in the middle of a
// frontend: the fence never closed, or the outermost element never got its closing tag. Such a tail
// is not display markup. Showing it as prose leaks the card's source, and extracting it as a segment
// would hand every fragment a different content hash, so the key would change and the sandbox would
// be torn down and rebuilt on every repaint. This answers where that unfinished block starts, or -1
// when the text ends on finished content.
function cardFrontendOpenTailStart(source) {
  var text = String(source || ''),
    fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*\r?\n(?:([\s\S]*?)\r?\n)?[ \t]{0,3}\1[`~]*[ \t]*(?=\r?\n|$)/gm,
    tailOffset = 0,
    closed;
  while ((closed = fence.exec(text))) tailOffset = closed.index + closed[0].length;
  var tail = text.slice(tailOffset),
    // Every complete fence is behind us, so a fence delimiter still in the tail opened a block that
    // never closed.
    opener = /(?:^|\n)[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/.exec(tail);
  if (opener) {
    var lead = opener[0].charAt(0) === '\n' ? 1 : 0,
      body = tail.slice(opener.index + opener[0].length);
    // An unfinished ordinary code block stays an ordinary code block; only one that already reads as
    // a card frontend, or that announced itself as html, becomes the placeholder.
    if (!cardFrontendFence(body) && !/^\s*html\b/i.test(opener[2])) return -1;
    return tailOffset + opener.index + lead;
  }
  var open = [],
    cursor = 0,
    token;
  while ((token = cardFrontendNextTag(tail, cursor))) {
    if (token.kind === 'open') {
      if (CARD_FRONTEND_VOID[token.name] || tail.charAt(token.end - 2) === '/') {
        cursor = token.end;
        continue;
      }
      if (CARD_FRONTEND_RAW_TEXT[token.name]) {
        var closing = new RegExp('</' + token.name + '\\s*>', 'i').exec(tail.slice(token.end));
        if (!closing) {
          open.push(token);
          break;
        }
        cursor = token.end + closing.index + closing[0].length;
        continue;
      }
      open.push(token);
      cursor = token.end;
      continue;
    }
    if (token.kind === 'close')
      for (var depth = open.length - 1; depth >= 0; depth--)
        if (open[depth].name === token.name) {
          open.length = depth;
          break;
        }
    cursor = token.end;
  }
  if (!open.length) return -1;
  // Unbalanced prose is ordinary prose. Only a tail that already carries the features this module
  // runs — a script, a style, or an inline handler — is held back as an unfinished frontend.
  var partial = tail.slice(open[0].start);
  if (!cardFrontendExecutable(partial) && !/<\s*(?:script|style)\b/i.test(partial)) return -1;
  return tailOffset + open[0].start;
}
function cardFrontendStripMarkers(value) {
  var open = CARD_FRONTEND_MARK_OPEN,
    close = CARD_FRONTEND_MARK_CLOSE,
    source = String(value == null ? '' : value),
    output = '',
    cursor = 0;
  while (true) {
    var at = source.indexOf(open, cursor);
    if (at < 0) break;
    var end = source.indexOf(close, at + open.length),
      digits = end < 0 ? '' : source.slice(at + open.length, end);
    output += source.slice(cursor, at);
    cursor = end >= 0 && /^\d+$/.test(digits) ? end + close.length : at + open.length;
  }
  return (output + source.slice(cursor)).split(open).join('').split(close).join('');
}
// md() calls this before the sanitiser runs, and only when a caller passed a frontendOwner; every
// other md() consumer keeps the exact display behaviour it had before this module existed.
function cardFrontendExtract(text, options) {
  // A message that already contains the private use placeholder characters would otherwise produce a
  // second node with the same key, so any pre-existing marker is removed before new ones are made.
  var source = cardFrontendStripMarkers(text),
    owner = objectRecord(options && options.frontendOwner);
  if (!owner || !source) return { text: source, frames: [] };
  var ownerChar =
    typeof D !== 'undefined' && D && Array.isArray(D.characters)
      ? D.characters.find(function (char) {
          return String((char && char.id) || '') === String(owner.charId || '');
        })
      : null;
  if (isRisuCharacter(ownerChar)) return { text: source, frames: [] };
  // Only the two callers that know the text may break off mid frontend ask for the unfinished tail to
  // be held back: the live stream, and a message an interruption left incomplete.
  var pending =
      options && options.frontendStreaming ? 'streaming' : options && options.frontendIncomplete ? 'incomplete' : '',
    pendingStart = pending ? cardFrontendOpenTailStart(source) : -1,
    segments = cardFrontendSegments(pendingStart >= 0 ? source.slice(0, pendingStart) : source);
  if (!segments.length && pendingStart < 0) return { text: source, frames: [] };
  var frames = [],
    output = '',
    cursor = 0;
  segments.forEach(function (segment) {
    if (segment.start < cursor) return;
    var index = frames.length,
      key = [
        String(owner.charId || ''),
        String(owner.sessionId || ''),
        owner.messageSeq ? 'seq:' + owner.messageSeq : 'index:' + owner.messageIndex,
        String(index),
        cardFrontendHash(segment.html),
      ].join('|');
    _cardFrontendSource.set(key, { html: segment.html, owner: owner });
    frames.push({ key: key, index: index });
    output += source.slice(cursor, segment.start) + CARD_FRONTEND_MARK_OPEN + index + CARD_FRONTEND_MARK_CLOSE;
    cursor = segment.end;
  });
  if (pendingStart >= 0) {
    var pendingIndex = frames.length;
    frames.push({ index: pendingIndex, pending: pending, source: source.slice(pendingStart) });
    output += source.slice(cursor, pendingStart) + CARD_FRONTEND_MARK_OPEN + pendingIndex + CARD_FRONTEND_MARK_CLOSE;
    cursor = source.length;
  }
  return { text: output + source.slice(cursor), frames: frames };
}
// Whether a card may run its frontends, and which session it is in, is the same answer for every
// message of one render. The renderer already threads a per-render context object through
// messageHtml, so the answer is derived once there instead of once per rendered row.
function cardFrontendRenderScope(char, renderContext) {
  var context = renderContext && typeof renderContext === 'object' ? renderContext : null,
    scope = context && context.cardFrontendScope;
  if (scope && scope.char === char) return scope;
  scope = { char: char, ready: cardFrontendReady(char), session: cardFrontendSession(char) };
  if (context) context.cardFrontendScope = scope;
  return scope;
}
// One owner identifies one message slot; md() only extracts when a caller supplies it, so the
// streaming draft (which has no owner) keeps rendering through the sanitiser until the reply commits.
function cardFrontendOwner(char, messageIndex, renderContext) {
  var index = Math.floor(Number(messageIndex));
  if (!char || !Number.isFinite(index) || index < 0) return null;
  var scope = cardFrontendRenderScope(char, renderContext);
  // A card whose running components are disabled keeps the display it already had: the markup stays
  // in the sanitiser pipeline instead of being taken away for an iframe that will not start.
  if (!scope.ready) return null;
  var session = scope.session;
  var message = session && session.msgs && session.msgs[index];
  return {
    charId: String(char.id || ''),
    sessionId: String((session && session.id) || ''),
    messageIndex: index,
    messageSeq: Number(message && message.seq) || null,
  };
}
// A new reply has no row in the session yet, so its owner is the slot it is about to take: the index
// after the last message, and the sequence number the session would allocate next. Predicting both
// makes the placeholder key identical before and after the commit, so the sandbox mounted while the
// fence was still streaming is the same sandbox the committed message shows.
function cardFrontendStreamOwner(char) {
  if (!char || !cardFrontendReady(char)) return null;
  var session = cardFrontendSession(char);
  if (!session || !Array.isArray(session.msgs)) return null;
  if (typeof ensureMessageSequences === 'function') ensureMessageSequences(session);
  return {
    charId: String(char.id || ''),
    sessionId: String(session.id || ''),
    messageIndex: session.msgs.length,
    messageSeq: Math.max(1, Math.floor(Number(session.nextMessageSeq)) || 1),
    // That sequence number is a prediction until the reply commits; see cardFrontendRequireCurrent.
    pendingCommit: true,
  };
}
function cardFrontendPendingHtml(frame) {
  var source = String((frame && frame.source) || '');
  if (frame.pending === 'streaming') return '<div class="yeyu-card-frontend-streaming" role="status">界面生成中…</div>';
  return (
    '<details class="yeyu-card-frontend-truncated"><summary>未完成的界面代码</summary><pre><code>' +
    (typeof esc === 'function' ? esc(source) : source) +
    '</code></pre></details>'
  );
}
function cardFrontendPlaceholderHtml(frame) {
  if (!frame) return '';
  if (frame.pending) return cardFrontendPendingHtml(frame);
  var key = typeof escAttr === 'function' ? escAttr(frame.key) : String(frame.key);
  return (
    '<div class="yeyu-card-frontend" data-frontend-key="' +
    key +
    '">' +
    '<div class="yeyu-card-frontend-bar"><span class="yeyu-card-frontend-label">卡片前端</span>' +
    cardFrontendFullscreenActionsHtml(frame.key) +
    '<button type="button" class="btn sm yeyu-card-frontend-stop">停止</button>' +
    '<button type="button" class="btn sm yeyu-card-frontend-reload" hidden>重新载入</button></div>' +
    '<div class="yeyu-card-frontend-slot"></div>' +
    '<p class="yeyu-card-frontend-note" hidden></p></div>'
  );
}

// ---- per card scan: what the card ships, what it needs, where it loads from ----
// Carrier sources are read straight from the card, never through cardScriptStack(): the stack asks
// this module whether the card ships a frontend, so going back through it would recurse.
// char.regexScripts and extensions.regex_scripts are two views of one list: the normalized live rows
// and the card's own extension block. Reading both would count every script twice, so the live rows
// win and the extension block only answers for a card whose import left regexScripts empty.
function cardFrontendRegexRows(char) {
  var live = Array.isArray(char && char.regexScripts) ? char.regexScripts : [],
    standard = typeof cardScriptStandardExtensions === 'function' ? cardScriptStandardExtensions(char) : null,
    raw = Array.isArray(standard && standard.regex_scripts) ? standard.regex_scripts : [];
  return live.length ? live : raw;
}
function cardFrontendCarrierTexts(char) {
  if (isRisuCharacter(char)) return [];
  var rows = [],
    push = function (value) {
      var text = String(value == null ? '' : value);
      if (text) rows.push(text);
    };
  cardFrontendRegexRows(char).forEach(function (script) {
    var row = objectRecord(script);
    if (row) push(row.replaceString || row.replacement);
  });
  push(char && char.first_mes);
  (Array.isArray(char && char.alternate_greetings) ? char.alternate_greetings : []).forEach(push);
  return rows;
}
// Names the contracted API batches do not implement. The dependency report names them up front, and
// the resident runtime exposes explicit failures instead of pretending the operation succeeded.
var CARD_FRONTEND_UNBRIDGED = ['registerMvuSchema'];
function cardFrontendMissingApis(source) {
  var text = String(source || '');
  return CARD_FRONTEND_UNBRIDGED.filter(function (name) {
    if (!new RegExp('\\b' + name + '\\s*\\(').test(text)) return false;
    return !(
      name === 'registerMvuSchema' && new RegExp('\\bimport\\s*\\{[^}]*\\b' + name + '\\b[^}]*\\}\\s*from').test(text)
    );
  });
}
function cardFrontendScan(char) {
  if (isRisuCharacter(char)) return cardFrontendEmptyScan();
  var texts = cardFrontendCarrierTexts(char),
    count = 0,
    remotes = [],
    missing = [],
    usesParent = false,
    usesHostInput = false;
  texts.forEach(function (text) {
    cardFrontendSegments(text).forEach(function (segment) {
      count++;
      var html = segment.html,
        pattern = /\bhttps?:\/\/[^\s"'<>)}\]]+/gi,
        match;
      while ((match = pattern.exec(html))) {
        var address = match[0].replace(/[.,;:!?]+$/, '');
        if (remotes.indexOf(address) < 0) remotes.push(address);
      }
      var allowed =
        /(?:\bwindow\s*\.\s*)?\bparent\s*\.\s*document\s*\.\s*(?:getElementById\s*\(\s*(['"])(?:send_textarea|send_but)\1|querySelector(?:All)?\s*\(\s*(['"])(?:#send_textarea|textarea|#send_but)\2)\s*\)/gi;
      if (allowed.test(html)) usesHostInput = true;
      allowed.lastIndex = 0;
      var remaining = html
        .replace(allowed, '')
        .replace(
          /(?:\bwindow\s*\.\s*)?\bparent\s*\.\s*document\s*\.\s*(?:body|head|documentElement|createElement|createTextNode|addEventListener|removeEventListener)\b/gi,
          ''
        );
      if (/\bwindow\s*\.\s*parent\b|\bparent\s*\.\s*(?:document|window)\b/.test(remaining)) usesParent = true;
      cardFrontendMissingApis(html).forEach(function (name) {
        if (missing.indexOf(name) < 0) missing.push(name);
      });
    });
  });
  return {
    count: count,
    remotes: remotes,
    runtimeRemotes: count
      ? CARD_FRONTEND_MESSAGE_RESOURCES.concat(CARD_FRONTEND_PREDEFINE_RESOURCES)
          .map(function (resource) {
            return resource.url;
          })
          .filter(function (url) {
            return /^https?:\/\//i.test(url);
          })
      : [],
    missing: missing,
    usesParent: usesParent,
    usesHostInput: usesHostInput,
  };
}
// Same address grammar as the dependency report's URL extractor in 31-card-dependencies.js: a
// template-literal `${...}` stays inside the address so both sides yield one identical string.
function cardScriptLibraryAddresses(content) {
  var found = [],
    match,
    pattern = /\bhttps?:\/\/(?:\$\{[^{}]*\}|[^\s"'`<>)}\]])+/gi;
  while ((match = pattern.exec(String(content || '')))) {
    var address = match[0].replace(/[.,;:!?]+$/, '');
    if (found.indexOf(address) < 0) found.push(address);
  }
  return found;
}
function cardScriptLibraryModuleAddresses(content) {
  var found = [],
    match,
    pattern = /\bimport\s*(?:\(\s*)?(?:[^'"\r\n;]*?\s+from\s*)?(['"])(https?:\/\/[^'"]+)\1\s*\)?/gim;
  while ((match = pattern.exec(String(content || '')))) if (found.indexOf(match[2]) < 0) found.push(match[2]);
  return found;
}
function cardScriptLibraryScan(char) {
  if (isRisuCharacter(char)) return cardFrontendEmptyScan();
  var rows =
      typeof cardFrontendAllScriptRows === 'function'
        ? cardFrontendAllScriptRows(char)
        : typeof cardScriptTavernHelperRows === 'function'
          ? cardScriptTavernHelperRows(char)
          : [],
    scripts = [],
    unsupported = [];
  rows.forEach(function (row) {
    if (!row.content.trim()) return;
    if (row.type !== 'script') {
      unsupported.push(row);
      return;
    }
    scripts.push(
      Object.assign({}, row, {
        remotes: cardScriptLibraryAddresses(row.content),
        modules: cardScriptLibraryModuleAddresses(row.content),
        missing: cardFrontendMissingApis(row.content),
      })
    );
  });
  scripts.sort(function (left, right) {
    var a = String(left.id || ''),
      b = String(right.id || '');
    return a < b ? -1 : a > b ? 1 : 0;
  });
  var active = scripts.filter(function (row) {
      return row.enabled;
    }),
    disabled = scripts.filter(function (row) {
      return !row.enabled;
    }),
    remotes = [],
    runtimeRemotes = active.length
      ? CARD_SCRIPT_LIBRARY_RESOURCES.concat(CARD_FRONTEND_PREDEFINE_RESOURCES)
          .map(function (resource) {
            return resource.url;
          })
          .filter(function (url) {
            return /^https?:\/\//i.test(url);
          })
      : [];
  scripts.forEach(function (row) {
    row.remotes.forEach(function (address) {
      remotes.push({ name: row.name, address: address, source: row.source });
    });
  });
  runtimeRemotes.forEach(function (address) {
    remotes.push({ name: '脚本库运行环境', address: address, source: '夜欲脚本库运行环境' });
  });
  return {
    scripts: scripts,
    active: active,
    disabled: disabled,
    unsupported: unsupported,
    remotes: remotes,
    runtimeRemotes: runtimeRemotes,
  };
}
function cardScriptLibrarySignature(char) {
  var scan = cardScriptLibraryScan(char);
  return cardFrontendHash(
    JSON.stringify(
      scan.scripts.map(function (row) {
        return [row.id, row.name, row.type, row.enabled, row.content];
      })
    )
  );
}
function cardFrontendSignature(char) {
  var greetings = (Array.isArray(char && char.alternate_greetings) ? char.alternate_greetings : []).join('\u0000');
  return cardFrontendHash(String((char && char.first_mes) || '') + '\u0000' + greetings);
}
function cardFrontendReady(char) {
  if (!char) return false;
  if (isRisuCharacter(char)) return false;
  if (char.scriptsEnabled === false) return false;
  if (typeof cardScriptsEnabled === 'function' && !cardScriptsEnabled(char)) return false;
  return true;
}

// TavernHelper's extension_settings is application-global. Keep its established app settings branch;
// saveData owns the app-wide debounce/coalescing queue, so no iframe-owned dirty timer can disappear
// on a card/session switch.
function cardFrontendExtensionSettingsSnapshot() {
  var settings = typeof D !== 'undefined' && D && objectRecord(D.settings),
    tree = settings && objectRecord(settings.tavernHelperExtensionSettings);
  return tree ? cardFrontendCopy(tree) : {};
}
function cardFrontendExtensionSettingsEqual(left, right) {
  if (left === right) return true;
  if (left instanceof RegExp && right instanceof RegExp)
    return left.source === right.source && left.flags === right.flags;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every(function (value, index) {
        return cardFrontendExtensionSettingsEqual(value, right[index]);
      })
    );
  var a = objectRecord(left),
    b = objectRecord(right);
  if (!a || !b) return false;
  var keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
  return keys.every(function (key) {
    return (
      Object.prototype.hasOwnProperty.call(a, key) === Object.prototype.hasOwnProperty.call(b, key) &&
      cardFrontendExtensionSettingsEqual(a[key], b[key])
    );
  });
}
function cardFrontendMergeExtensionSettings(base, next, current) {
  base = objectRecord(base) || {};
  next = objectRecord(next) || {};
  current = objectRecord(current) || {};
  Array.from(new Set(Object.keys(base).concat(Object.keys(next)))).forEach(function (key) {
    var had = Object.prototype.hasOwnProperty.call(base, key),
      has = Object.prototype.hasOwnProperty.call(next, key);
    if (had && !has) {
      delete current[key];
      return;
    }
    if (!has || (had && cardFrontendExtensionSettingsEqual(base[key], next[key]))) return;
    if (objectRecord(base[key]) && objectRecord(next[key]) && objectRecord(current[key]))
      cardFrontendMergeExtensionSettings(base[key], next[key], current[key]);
    else current[key] = cardFrontendCopy(next[key]);
  });
  return current;
}
function cardFrontendSyncAudioSettings() {
  var live = _cardScriptLibraryLive,
    settings = typeof D !== 'undefined' && D && D.settings,
    root = settings && objectRecord(settings.tavernHelperExtensionSettings),
    helper = root && objectRecord(root.tavern_helper),
    canonical = helper && objectRecord(helper.audio);
  if (!live) return;
  function syncTree(tree) {
    tree = objectRecord(tree);
    if (!tree) return;
    var targetHelper = objectRecord(tree.tavern_helper);
    if (!canonical) {
      if (targetHelper) delete targetHelper.audio;
      return;
    }
    if (!targetHelper) targetHelper = tree.tavern_helper = {};
    var target = objectRecord(targetHelper.audio);
    if (!target) target = targetHelper.audio = {};
    Object.keys(target).forEach(function (key) {
      delete target[key];
    });
    Object.keys(canonical).forEach(function (key) {
      target[key] = cardFrontendCopy(canonical[key]);
    });
  }
  syncTree(live.extensionSettingsBase);
  var frame = live.frame && live.frame.contentWindow;
  try {
    if (frame) syncTree(frame.extension_settings);
  } catch (_) {}
}
function cardFrontendPersistExtensionSettings(live, value, urgent) {
  if (!live || live.kind !== 'library') throw new Error('酒馆助手设置只提供给常驻脚本库');
  if (typeof D === 'undefined' || !D || !objectRecord(D.settings)) throw new Error('设置尚未加载');
  var tree = objectRecord(value);
  if (!tree) throw new Error('酒馆助手设置必须是对象');
  var current = objectRecord(D.settings.tavernHelperExtensionSettings) || {};
  D.settings.tavernHelperExtensionSettings = cardFrontendMergeExtensionSettings(
    live.extensionSettingsBase,
    tree,
    current
  );
  live.extensionSettingsBase = cardFrontendCopy(tree);
  if (typeof tavernAudioApplySettings === 'function') {
    tavernAudioApplySettings('bgm');
    tavernAudioApplySettings('ambient');
  }
  cardFrontendSyncAudioSettings();
  var revision = (Number(live.extensionSettingsRevision) || 0) + 1;
  live.extensionSettingsRevision = revision;
  live.extensionSettingsDirty = true;
  if (typeof saveData !== 'function') throw new Error('设置保存入口不可用');
  return Promise.resolve(saveData('meta', urgent ? { urgent: true } : undefined)).then(function () {
    if (live.extensionSettingsRevision === revision) live.extensionSettingsDirty = false;
    return true;
  });
}
function cardFrontendFlushExtensionSettings(live) {
  if (!live || !live.extensionSettingsDirty) return Promise.resolve(true);
  if (typeof saveData !== 'function') return Promise.reject(new Error('设置保存入口不可用'));
  var revision = live.extensionSettingsRevision;
  return Promise.resolve(saveData('meta', { urgent: true })).then(function () {
    if (live.extensionSettingsRevision === revision) live.extensionSettingsDirty = false;
    return true;
  });
}
function cardFrontendSettingsSaveFailed(error, live) {
  if (typeof toast === 'function') toast('脚本设置保存失败：' + String((error && error.message) || error), 'err');
}

// ---- the data the frame is seeded with ----
function cardFrontendSession(char) {
  return char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
}
var CARD_FRONTEND_ST_MESSAGE_KEYS = {
  role: 1,
  content: 1,
  time: 1,
  seq: 1,
  reasoning: 1,
  original_content: 1,
  swipes: 1,
  swipeId: 1,
  name: 1,
  is_user: 1,
  is_system: 1,
  user: 1,
  mes: 1,
  message: 1,
  send_date: 1,
  swipe_id: 1,
  variables: 1,
  __yeyu_seq: 1,
  edited: 1,
  translated: 1,
  restored: 1,
  reverted: 1,
  hidden: 1,
  excludeFromMemory: 1,
  excludeFromWorldBook: 1,
  excludeFromUsage: 1,
  continued: 1,
  continueBase: 1,
  regenerated: 1,
  incomplete: 1,
  streamDraft: 1,
  isStreamDraft: 1,
  speaker: 1,
  speakerId: 1,
  opening: 1,
  openingIndex: 1,
  generationMeta: 1,
  swipeGenerationMeta: 1,
  swipeReasoning: 1,
  images: 1,
  swipeImages: 1,
  yeyuMvu: 1,
  kind: 1,
  branchReturnSummary: 1,
  branchReturnCopy: 1,
  bridgeVersion: 1,
  mergeId: 1,
  originBranchSessionId: 1,
  originParentSessionId: 1,
  sourceHash: 1,
  mergeSourceHash: 1,
  revertReason: 1,
  originStartSeq: 1,
  originEndSeq: 1,
  branchPointSeq: 1,
  createdAt: 1,
  copySeq: 1,
  returnBrief: 1,
  returnMode: 1,
  previousMerge: 1,
  sourceRef: 1,
  cacheContext: 1,
  cacheContextVersion: 1,
  memoryRetrievalFingerprint: 1,
  vectorRetrievalFingerprint: 1,
  worldBookSnapshot: 1,
  worldBookMetrics: 1,
  worldBookInChat: 1,
  authorNoteContext: 1,
};
function cardFrontendSafeOwnKey(key) {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
}
function cardFrontendSillyTavernMessage(char, message) {
  var role = String((message && message.role) || 'assistant'),
    row = {};
  Object.keys(message || {}).forEach(function (key) {
    if (cardFrontendSafeOwnKey(key) && !CARD_FRONTEND_ST_MESSAGE_KEYS[key]) row[key] = cardFrontendCopy(message[key]);
  });
  row.name =
    role === 'user'
      ? typeof displayName === 'function'
        ? displayName('user')
        : 'User'
      : typeof canonicalCharacterName === 'function'
        ? canonicalCharacterName(char)
        : String((char && char.name) || '');
  row.is_user = role === 'user';
  row.is_system = role === 'system';
  row.mes = String((message && message.content) || '');
  row.send_date = Number(message && message.time) || 0;
  row.swipe_id = messageActiveSwipeIndex(message || {});
  row.swipes = Array.isArray(message && message.swipes) ? message.swipes.map(String) : [row.mes];
  row.__yeyu_seq = Math.max(0, Math.floor(Number(message && message.seq) || 0));
  if (typeof hostWriteImageExtraView === 'function' && message) {
    var extra = hostWriteImageExtraView(message, row.swipe_id, objectRecord(row.extra) || {});
    if (Object.keys(extra).length) row.extra = extra;
  }
  var record = objectRecord(message && message.yeyuMvu),
    candidates = record && Array.isArray(record.candidates) ? record.candidates : [];
  row.variables = row.swipes.map(function (_, index) {
    if (typeof cardFrontendHostMessageData === 'function') return cardFrontendHostMessageData(message, index, char);
    var candidate = objectRecord(candidates[index]);
    if (!candidate) return {};
    var value = { stat_data: cardFrontendCopy(candidate.state) || {} };
    if (objectRecord(candidate.schema)) value.schema = cardFrontendCopy(candidate.schema);
    if (objectRecord(candidate.display)) value.display_data = cardFrontendCopy(candidate.display);
    if (objectRecord(candidate.delta)) value.delta_data = cardFrontendCopy(candidate.delta);
    return value;
  });
  return row;
}
function cardFrontendSillyTavernContext(char, session) {
  if (typeof hostVariableSchemaSync === 'function') hostVariableSchemaSync();
  return {
    sillyTavernChat: (session && Array.isArray(session.msgs) ? session.msgs : []).map(function (message) {
      return cardFrontendSillyTavernMessage(char, message);
    }),
    sillyTavernChatId: String((session && session.id) || ''),
  };
}
function cardFrontendTavernRegexes(char) {
  var rows = [];
  cardFrontendRegexRows(char).forEach(function (value) {
    var row = objectRecord(value);
    if (!row) return;
    var copy = cardFrontendCopy(row);
    copy.script_name = String(copy.script_name || copy.scriptName || copy.name || copy.comment || '');
    copy.enabled = copy.enabled !== false && copy.disabled !== true;
    rows.push(copy);
  });
  return rows;
}
function cardFrontendOwnedSession(live) {
  var char = cardFrontendCharacter(live),
    box = char && typeof D !== 'undefined' && D && D.chats && D.chats[char.id],
    sessions = box && Array.isArray(box.sessions) ? box.sessions : [],
    sessionId = String((live && live.owner && live.owner.sessionId) || '');
  return (
    sessions.find(function (row) {
      return row && String(row.id || '') === sessionId;
    }) || null
  );
}
function cardFrontendLiveIsCurrent(live) {
  var char = cardFrontendCharacter(live),
    session = char && cardFrontendSession(char),
    currentId = typeof D !== 'undefined' && D ? String(D.currentCharId || '') : '';
  return !!(
    live &&
    live.state !== 'disposed' &&
    char &&
    session &&
    currentId === String(char.id || '') &&
    String(session.id || '') === String((live.owner && live.owner.sessionId) || '')
  );
}
// Losing ownership is a refusal, not a failure: the instance simply no longer speaks for what is on
// screen. The tag lets the one caller for which that is an ordinary outcome — a frame's own
// bootstrap — tell it apart from a genuine error without repeating the ownership rules.
function cardFrontendStaleError(message) {
  var error = new Error(message);
  error.cardFrontendStale = true;
  return error;
}
function cardFrontendRequireCurrent(live) {
  if (live && live.cancelled) throw cardFrontendAbortError('卡片脚本');
  if (!cardFrontendLiveIsCurrent(live)) throw cardFrontendStaleError('卡片运行实例所属的角色或对话已经切换');
  var char = cardFrontendCharacter(live),
    session = cardFrontendOwnedSession(live);
  if (!char || !session) throw cardFrontendStaleError('卡片运行实例已经失效');
  if (live.kind !== 'library' && live.owner.messageSeq) {
    var index = session.msgs.findIndex(function (message) {
      return message.seq === live.owner.messageSeq;
    });
    // A frontend mounted on the reply still being written names the sequence number that reply will
    // be given, which the session does not hold yet. Looking it up would read "deleted" and stand the
    // instance down on every repaint, so the draft keeps the slot its owner already names; the commit
    // puts the sequence number in place and the ordinary check takes over from there.
    if (index < 0) {
      if (live.owner.pendingCommit !== true) throw cardFrontendStaleError('卡片运行实例所属消息已经删除');
    } else {
      live.owner.messageIndex = index;
      if (live.owner.pendingCommit === true) delete live.owner.pendingCommit;
    }
  }
  return { char: char, session: session };
}
function cardFrontendConfig(char, session, owner, token, liveContext, sillyTavern) {
  var index = Math.max(0, Math.floor(Number(owner && owner.messageIndex) || 0)),
    rows = session && Array.isArray(session.msgs) ? session.msgs : [],
    result = {
      token: token,
      liveContext: liveContext === true,
      messageId: index,
      lastMessageId: Math.max(0, rows.length - 1),
      events: CARD_FRONTEND_EVENTS.slice(),
      iframeEventValues: cardFrontendCopy(CARD_FRONTEND_IFRAME_EVENT_VALUES),
      tavernEventValues: cardFrontendCopy(CARD_FRONTEND_TAVERN_EVENT_VALUES),
      tavernRegexes: cardFrontendTavernRegexes(char),
      viewportHeight: cardFrontendViewportHeight(),
    };
  if (sillyTavern === true)
    Object.assign(
      result,
      { sillyTavern: true, extensionSettings: cardFrontendExtensionSettingsSnapshot() },
      cardFrontendSillyTavernContext(char, session)
    );
  return result;
}
function cardFrontendViewportHeight() {
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null,
    available = Math.floor(Number(host && host.clientHeight) || 0),
    fallback = Math.floor(
      Number(
        typeof window !== 'undefined' &&
          (window.innerHeight || (document.documentElement && document.documentElement.clientHeight))
      ) || 1
    );
  return Math.max(1, available || fallback);
}
function cardFrontendLiveForToken(token, source) {
  token = String(token || '');
  var live = null;
  _cardFrontendLive.forEach(function (row) {
    if (!live && row.token === token && row.frame && row.frame.contentWindow === source) live = row;
  });
  if (
    !live &&
    _cardScriptLibraryLive &&
    _cardScriptLibraryLive.token === token &&
    _cardScriptLibraryLive.frame &&
    _cardScriptLibraryLive.frame.contentWindow === source
  )
    live = _cardScriptLibraryLive;
  var retiring = _cardFrontendRetiring.get(token);
  if (!live && retiring && retiring.live && retiring.live.frame && retiring.live.frame.contentWindow === source)
    live = retiring.live;
  return live;
}
function cardFrontendDirectConfig(token, source) {
  var live = cardFrontendLiveForToken(token, source);
  if (!live || _cardFrontendRetiring.has(live.token)) throw new Error('卡片运行实例已经失效');
  var context = cardFrontendRequireCurrent(live),
    library = live.kind === 'library',
    config = cardFrontendConfig(context.char, context.session, live.owner, live.token, library, library);
  if (!library && live.normalGeometry) config.viewportHeight = live.normalGeometry.viewportHeight;
  if (library) config.scripts = live.scripts || [];
  return config;
}
// A frame asking whether it may still reach the host page needs the ownership verdict of a config
// read, not the config: for the script library that config carries the whole chat.
function cardFrontendDirectAlive(token, source) {
  var live = cardFrontendLiveForToken(token, source);
  if (!live || _cardFrontendRetiring.has(live.token)) return false;
  try {
    cardFrontendRequireCurrent(live);
    return true;
  } catch (_) {
    return false;
  }
}
// A frame document is mounted now and runs a task later, so the reader can change character or
// session in between: the instance the host handed the slot to is stale before its first line runs.
// That is the one moment where losing ownership is normal, so the bootstrap gets its own entry — it
// stands the instance down and starts nothing instead of reporting an error. Every other entry keeps
// throwing, so a card script that is already running can never reach across a switch.
function cardFrontendDirectStartup(token, source) {
  var live = cardFrontendLiveForToken(token, source);
  if (!live || _cardFrontendRetiring.has(live.token)) return null;
  try {
    return cardFrontendDirectConfig(token, source);
  } catch (error) {
    if (!error || error.cardFrontendStale !== true) throw error;
    cardFrontendCancelStartup(live);
    return null;
  }
}
function cardFrontendCancelStartup(live) {
  if (!live) return false;
  if (live.kind === 'library') return _cardScriptLibraryLive === live ? cardScriptLibraryDispose() : false;
  var key = String(live.key || '');
  if (_cardFrontendLive.get(key) !== live) return false;
  cardFrontendDispose(key);
  // Whatever the queue was holding for this frame is free again the moment it stands down.
  if (_cardFrontendMountingKey === key) cardFrontendReleaseMountGate(false);
  // The frame never laid anything out, so the block is still the placeholder box it was mounted at:
  // putting the placeholder back moves nothing and needs no layout compensation.
  if (live.node && live.node.isConnected) cardFrontendShowPending(live.node, key);
  return true;
}
function cardFrontendSurfaceHostApiError(live, name, error) {
  if (!live || typeof toast !== 'function') return;
  var detail = String((error && error.message) || error || '未知错误'),
    key = String(name || '') + '\u0000' + detail;
  if (live.lastVisibleHostError === key) return;
  live.lastVisibleHostError = key;
  setTimeout(function () {
    if (live.lastVisibleHostError === key) live.lastVisibleHostError = '';
  }, 100);
  toast('卡片操作失败：' + detail, 'err');
}
function cardFrontendDirectCall(token, source, name, args, eventSource) {
  var live = cardFrontendLiveForToken(token, source);
  if (!live || _cardFrontendRetiring.has(live.token)) throw new Error('卡片运行实例已经失效');
  cardFrontendRequireCurrent(live);
  cardFrontendEventSourceOptions(live, eventSource);
  name = String(name || '');
  var called;
  try {
    called = cardFrontendCall(live, name, args);
  } catch (error) {
    cardFrontendSurfaceHostApiError(live, name, error);
    throw error;
  }
  if (!called || typeof called.then !== 'function') {
    return called;
  }
  return Promise.resolve(called).then(
    function (value) {
      return value;
    },
    function (error) {
      cardFrontendSurfaceHostApiError(live, name, error);
      throw error;
    }
  );
}
// ---- read-only worldbook bridge (Tavern Helper 4.11.3 shapes) ----
function cardFrontendWorldbookCategories() {
  return typeof D !== 'undefined' && D && D.worldBook && Array.isArray(D.worldBook.categories)
    ? D.worldBook.categories.filter(function (row) {
        return row && typeof row === 'object';
      })
    : [];
}
function cardFrontendWorldbookName(category) {
  return String((category && category.name) || '');
}
function cardFrontendWorldbookCategory(name) {
  var wanted = String(name == null ? '' : name);
  var matches = cardFrontendWorldbookCategories().filter(function (category) {
    return cardFrontendWorldbookName(category) === wanted;
  });
  if (matches.length > 1) throw new Error("世界书名称 '" + wanted + "' 不唯一");
  return matches[0] || null;
}
function cardFrontendWorldbookLogic(value) {
  var text = String(value == null ? '' : value)
      .trim()
      .toLowerCase(),
    byNumber = { 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' };
  return ['and_any', 'and_all', 'not_all', 'not_any'].indexOf(text) >= 0
    ? text
    : byNumber[Math.floor(Number(value))] || 'and_any';
}
function cardFrontendWorldbookPositive(value) {
  var number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
function cardFrontendWorldbookUid(entry, index, used) {
  var raw = entry && entry.id,
    number = Number(raw);
  if (!(Number.isSafeInteger(number) && number >= 0)) {
    var text = String(raw == null ? 'entry:' + index : raw),
      hash = 2166136261;
    for (var at = 0; at < text.length; at++) {
      hash ^= text.charCodeAt(at);
      hash = Math.imul(hash, 16777619);
    }
    number = hash >>> 0;
  }
  while (used[number]) number = (number + 1) >>> 0;
  used[number] = true;
  return number;
}
function cardFrontendWorldbookRows(category) {
  var used = Object.create(null);
  return (Array.isArray(category && category.entries) ? category.entries : [])
    .filter(function (entry) {
      return entry && typeof entry === 'object';
    })
    .map(function (entry, index) {
      var runtime = typeof wbRuntimeEntry === 'function' ? wbRuntimeEntry(entry, category) : entry;
      return { entry: runtime, stored: entry, index: index, uid: cardFrontendWorldbookUid(runtime, index, used) };
    });
}
function cardFrontendWorldbookPosition(entry) {
  var position = String((entry && entry.position) || 'after_char'),
    type = {
      before_char: 'before_character_definition',
      after_char: 'after_character_definition',
      em_top: 'before_example_messages',
      em_bottom: 'after_example_messages',
      an_top: 'before_author_note',
      an_bottom: 'after_author_note',
      at_depth: 'at_depth',
      outlet: 'outlet',
    }[position];
  if (position === 'character_card')
    type =
      String(entry.characterPosition || '') === 'before_desc'
        ? 'before_character_definition'
        : 'after_character_definition';
  if (position === 'before_user') type = 'at_depth';
  return {
    type: type || 'after_character_definition',
    role:
      position === 'before_user'
        ? 'user'
        : ['system', 'assistant', 'user'].indexOf(String((entry && entry.role) || '')) >= 0
          ? String(entry.role)
          : 'system',
    depth: wbDepth(entry && entry.depth),
    order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : 100,
  };
}
function cardFrontendWorldbookRegexKey(value) {
  var text = String(value == null ? '' : value),
    parsed = typeof wbParseRegexKey === 'function' ? wbParseRegexKey(text) : null;
  return parsed && parsed.valid ? new RegExp(parsed.pattern, parsed.flags) : text;
}
function cardFrontendWorldbookEntry(row) {
  var entry = row.entry || {},
    position = cardFrontendWorldbookPosition(entry),
    extra = entry._raw && objectRecord(entry._raw.extra) ? cardFrontendCopy(entry._raw.extra) : null,
    result = {
      uid: row.uid,
      name: String(entry.name || entry.comment || entry.id || ''),
      enabled: entry.enabled !== false,
      strategy: {
        type: entry.constant === true ? 'constant' : entry.vectorized === true ? 'vectorized' : 'selective',
        keys: (entry.keys || []).map(cardFrontendWorldbookRegexKey),
        keys_secondary: {
          logic: cardFrontendWorldbookLogic(entry.selectiveLogic),
          keys: (entry.secondary_keys || []).map(cardFrontendWorldbookRegexKey),
        },
        scan_depth: entry.scanDepth == null ? 'same_as_global' : Math.max(0, Number(entry.scanDepth) || 0),
      },
      position: position,
      content: String(entry.content || ''),
      probability: Math.max(0, Math.min(100, Number(entry.probability == null ? 100 : entry.probability) || 0)),
      recursion: {
        prevent_incoming: entry.excludeRecursion === true,
        prevent_outgoing: entry.preventRecursion === true,
        delay_until: cardFrontendWorldbookPositive(entry.delayUntilRecursion),
      },
      effect: {
        sticky: cardFrontendWorldbookPositive(entry.sticky),
        cooldown: cardFrontendWorldbookPositive(entry.cooldown),
        delay: cardFrontendWorldbookPositive(entry.delay),
      },
      addMemo: entry.addMemo !== false,
      matchPersonaDescription: entry.matchPersonaDescription === true,
      matchCharacterDescription: entry.matchCharacterDescription === true,
      matchCharacterPersonality: entry.matchCharacterPersonality === true,
      matchCharacterDepthPrompt: entry.matchCharacterDepthPrompt === true,
      matchScenario: entry.matchScenario === true,
      matchCreatorNotes: entry.matchCreatorNotes === true,
      group: String(entry.group || ''),
      groupOverride: entry.groupOverride === true,
      groupWeight: Math.max(1, Number(entry.groupWeight) || 100),
      caseSensitive: entry.caseSensitive == null ? null : entry.caseSensitive === true,
      matchWholeWords: entry.matchWholeWords == null ? null : entry.matchWholeWords === true,
      useGroupScoring: entry.useGroupScoring == null ? null : entry.useGroupScoring === true,
      automationId: String(entry.automationId || ''),
      ignoreBudget: entry.ignoreBudget === true,
      outletName: String(entry.outletName || ''),
      triggers: Array.isArray(entry.triggers) ? entry.triggers.slice() : [],
      characterFilter: entry.characterFilter
        ? cardFrontendCopy(entry.characterFilter)
        : { isExclude: false, names: [], tags: [] },
    };
  if (extra) result.extra = extra;
  return result;
}
// TavernHelper toLorebookEntry builds only the public LorebookEntry fields; stored source
// fields stay in _raw and never leak into what scripts read or write back.
function cardFrontendLorebookEntry(row) {
  var entry = row.entry || {},
    position = cardFrontendWorldbookPosition(entry),
    atDepth = position.type === 'at_depth',
    type = entry.constant === true ? 'constant' : entry.vectorized === true ? 'vectorized' : 'selective',
    keys = (entry.keys || []).map(String),
    filters = (entry.secondary_keys || []).map(String);
  return {
    uid: row.uid,
    display_index: Number.isFinite(Number(entry.displayIndex)) ? Number(entry.displayIndex) : row.index,
    comment: String(entry.comment != null ? entry.comment : entry.name || ''),
    enabled: entry.enabled !== false,
    type: type,
    position: atDepth ? 'at_depth_as_' + position.role : position.type,
    depth: atDepth ? position.depth : null,
    order: position.order,
    probability: Math.max(0, Math.min(100, Number(entry.probability == null ? 100 : entry.probability) || 0)),
    key: keys.slice(),
    keys: keys,
    logic: cardFrontendWorldbookLogic(entry.selectiveLogic),
    filter: filters.slice(),
    filters: filters,
    scan_depth: entry.scanDepth == null ? 'same_as_global' : Math.max(0, Number(entry.scanDepth) || 0),
    case_sensitive: entry.caseSensitive == null ? 'same_as_global' : entry.caseSensitive === true,
    match_whole_words: entry.matchWholeWords == null ? 'same_as_global' : entry.matchWholeWords === true,
    use_group_scoring: entry.useGroupScoring == null ? 'same_as_global' : entry.useGroupScoring === true,
    automation_id: String(entry.automationId || '') || null,
    exclude_recursion: entry.excludeRecursion === true,
    prevent_recursion: entry.preventRecursion === true,
    delay_until_recursion: entry.delayUntilRecursion == null ? false : entry.delayUntilRecursion,
    content: String(entry.content || ''),
    group: String(entry.group || ''),
    group_prioritized: entry.groupOverride === true,
    group_weight: Math.max(1, Number(entry.groupWeight) || 100),
    sticky: cardFrontendWorldbookPositive(entry.sticky),
    cooldown: cardFrontendWorldbookPositive(entry.cooldown),
    delay: cardFrontendWorldbookPositive(entry.delay),
  };
}
function cardFrontendSillyTavernWorldInfoEntry(row, category) {
  var entry = row.entry || {},
    raw = entry._raw && objectRecord(entry._raw) ? cardFrontendCopy(entry._raw) : {},
    sourcePosition = entry.sourcePosition,
    positionNumber = Number(sourcePosition),
    positions = {
      before_char: 0,
      after_char: 1,
      an_top: 2,
      an_bottom: 3,
      at_depth: 4,
      em_top: 5,
      em_bottom: 6,
      outlet: 7,
    };
  if (
    sourcePosition === '' ||
    sourcePosition == null ||
    !Number.isFinite(positionNumber) ||
    positionNumber < 0 ||
    positionNumber > 7
  )
    positionNumber = positions[String(entry.position || '')] ?? 1;
  var sourceRole = raw.role == null && objectRecord(raw.extensions) ? raw.extensions.role : raw.role,
    roleName = String(sourceRole == null ? entry.role || 'system' : sourceRole).toLowerCase(),
    role = roleName === 'user' || roleName === '1' ? 1 : roleName === 'assistant' || roleName === '2' ? 2 : 0,
    displayIndex = Number(raw.displayIndex ?? raw.display_index ?? entry.displayIndex ?? row.index),
    filter = objectRecord(entry.characterFilter) || { isExclude: false, names: [], tags: [] };
  var extensions = Object.assign(
    {},
    objectRecord(raw.extensions) || {},
    objectRecord(entry.extensions) || {},
    {
      position: positionNumber,
      display_index: displayIndex,
      exclude_recursion: entry.excludeRecursion === true,
      prevent_recursion: entry.preventRecursion === true,
      delay_until_recursion: entry.delayUntilRecursion || false,
      probability: Number(entry.probability ?? 100),
      useProbability: entry.useProbability !== false,
      depth: Number(entry.depth ?? 4),
      selectiveLogic: Number(entry.selectiveLogic ?? 0),
      group: String(entry.group || ''),
      group_override: entry.groupOverride === true,
      group_weight: Number(entry.groupWeight ?? 100),
      scan_depth: entry.scanDepth == null ? null : Number(entry.scanDepth),
      match_whole_words: entry.matchWholeWords == null ? null : entry.matchWholeWords === true,
      use_group_scoring: entry.useGroupScoring == null ? null : entry.useGroupScoring === true,
      case_sensitive: entry.caseSensitive == null ? null : entry.caseSensitive === true,
      automation_id: String(entry.automationId || ''),
      role: role,
      vectorized: entry.vectorized === true,
      sticky: Number(entry.sticky || 0),
      cooldown: Number(entry.cooldown || 0),
      delay: Number(entry.delay || 0),
    }
  );
  Object.assign(raw, {
    uid: row.uid,
    key: cardFrontendCopy(entry.keys || []),
    keysecondary: cardFrontendCopy(entry.secondary_keys || []),
    comment: String(entry.comment != null ? entry.comment : entry.name || ''),
    content: String(entry.content || ''),
    constant: entry.constant === true,
    vectorized: entry.vectorized === true,
    selective: entry.selective === true,
    selectiveLogic: Number(entry.selectiveLogic ?? 0),
    addMemo: entry.addMemo !== false,
    order: Number(entry.order ?? 100),
    position: positionNumber,
    disable: entry.enabled === false,
    excludeRecursion: entry.excludeRecursion === true,
    preventRecursion: entry.preventRecursion === true,
    delayUntilRecursion: entry.delayUntilRecursion || false,
    probability: Number(entry.probability ?? 100),
    useProbability: entry.useProbability !== false,
    depth: Number(entry.depth ?? 4),
    group: String(entry.group || ''),
    groupOverride: entry.groupOverride === true,
    groupWeight: Number(entry.groupWeight ?? 100),
    scanDepth: entry.scanDepth == null ? null : Number(entry.scanDepth),
    caseSensitive: entry.caseSensitive == null ? null : entry.caseSensitive === true,
    matchWholeWords: entry.matchWholeWords == null ? null : entry.matchWholeWords === true,
    useGroupScoring: entry.useGroupScoring == null ? null : entry.useGroupScoring === true,
    automationId: String(entry.automationId || ''),
    role: role,
    sticky: Number(entry.sticky || 0),
    cooldown: Number(entry.cooldown || 0),
    delay: Number(entry.delay || 0),
    displayIndex: displayIndex,
    world: cardFrontendWorldbookName(category),
    extensions: extensions,
    triggers: cardFrontendCopy(entry.triggers || []),
    characterFilter: {
      isExclude: filter.isExclude === true,
      names: cardFrontendCopy(filter.names || []),
      tags: cardFrontendCopy(filter.tags || []),
    },
  });
  return raw;
}
function cardFrontendSillyTavernWorldInfo(category) {
  var entries = {};
  cardFrontendWorldbookRows(category).forEach(function (row) {
    entries[String(row.uid)] = cardFrontendSillyTavernWorldInfoEntry(row, category);
  });
  return { entries: entries };
}
function cardFrontendLorebookFilter(entries, option) {
  var filter = option && option.filter;
  if (!objectRecord(filter)) return entries;
  return entries.filter(function (entry) {
    return Object.keys(filter).every(function (field) {
      var actual = entry[field],
        expected = filter[field];
      if (Array.isArray(actual))
        return (Array.isArray(expected) ? expected : [expected]).every(function (value) {
          return actual.indexOf(value) >= 0;
        });
      if (typeof actual === 'string') return actual.indexOf(String(expected)) >= 0;
      return actual === expected;
    });
  });
}
function cardFrontendLorebookMerge(base, patch) {
  if (Array.isArray(patch)) {
    var list = Array.isArray(base) ? cardFrontendCopy(base) : [];
    Object.keys(patch).forEach(function (key) {
      list[key] = cardFrontendLorebookMerge(list[key], patch[key]);
    });
    return list;
  }
  if (objectRecord(patch)) {
    var out = objectRecord(base) ? cardFrontendCopy(base) : {};
    Object.keys(patch).forEach(function (key) {
      if (cardFrontendSafeOwnKey(key)) out[key] = cardFrontendLorebookMerge(out[key], patch[key]);
    });
    return out;
  }
  return cardFrontendCopy(patch);
}
function cardFrontendLorebookHas(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}
function cardFrontendLorebookStoredPosition(value) {
  var name = String(value == null ? '' : value),
    mapped = {
      before_character_definition: 'before_char',
      after_character_definition: 'after_char',
      before_example_messages: 'em_top',
      after_example_messages: 'em_bottom',
      before_author_note: 'an_top',
      after_author_note: 'an_bottom',
      outlet: 'outlet',
    }[name];
  if (/^at_depth_as_(?:user|assistant|system)$/.test(name))
    return { position: 'at_depth', role: name.slice('at_depth_as_'.length) };
  if (name === 'at_depth') return { position: 'at_depth' };
  return { position: mapped || 'after_char' };
}
// Writes a TavernHelper LorebookEntry onto a stored entry. Public fields land on the stored entry;
// only fields TavernHelper does not define are kept in _raw, beside the role it maps back to the
// source index. An existing entry keeps its stored id, so the uid scripts see does not move.
function cardFrontendLorebookStoredEntry(official, existing) {
  var row = objectRecord(existing) ? cardFrontendCopy(existing) : {},
    publicFields = cardFrontendLorebookDefaults(0, 0),
    unknown = {};
  Object.keys(official).forEach(function (key) {
    if (!cardFrontendLorebookHas(publicFields, key)) unknown[key] = official[key];
  });
  row._raw = cardFrontendLorebookMerge(objectRecord(row._raw) ? row._raw : {}, unknown);
  if (!wbEntryIdText(row.id)) row.id = String(Math.max(0, Math.floor(Number(official.uid) || 0)));
  if (cardFrontendLorebookHas(official, 'display_index')) row.displayIndex = Number(official.display_index) || 0;
  if (cardFrontendLorebookHas(official, 'comment'))
    row.comment = String(official.comment == null ? '' : official.comment);
  if (cardFrontendLorebookHas(official, 'content'))
    row.content = String(official.content == null ? '' : official.content);
  if (cardFrontendLorebookHas(official, 'enabled')) row.enabled = official.enabled !== false;
  if (cardFrontendLorebookHas(official, 'type')) {
    var type = String(official.type || 'selective');
    row.constant = type === 'constant';
    row.vectorized = type === 'vectorized';
  }
  if (cardFrontendLorebookHas(official, 'position')) {
    var placed = cardFrontendLorebookStoredPosition(official.position);
    row.position = placed.position;
    row.sourcePosition = WB_POSITION_BY_INDEX.indexOf(placed.position);
    if (placed.role) {
      var roleIndex = ['system', 'user', 'assistant'].indexOf(placed.role);
      row.role = placed.role;
      row._raw.role = roleIndex;
      if (objectRecord(row._raw.extensions)) row._raw.extensions.role = roleIndex;
    }
  }
  if (cardFrontendLorebookHas(official, 'depth'))
    row.depth = official.depth == null ? 4 : Math.max(0, Number(official.depth) || 0);
  if (cardFrontendLorebookHas(official, 'order'))
    row.order = Number.isFinite(Number(official.order)) ? Number(official.order) : 100;
  if (cardFrontendLorebookHas(official, 'probability'))
    row.probability = Math.max(0, Math.min(100, Number(official.probability) || 0));
  if (cardFrontendLorebookHas(official, 'keys') || cardFrontendLorebookHas(official, 'key')) {
    var primary = cardFrontendLorebookHas(official, 'keys') ? official.keys : official.key;
    row.keys = (Array.isArray(primary) ? primary : primary == null ? [] : [primary]).map(String);
  }
  if (cardFrontendLorebookHas(official, 'filters') || cardFrontendLorebookHas(official, 'filter')) {
    var secondary = cardFrontendLorebookHas(official, 'filters') ? official.filters : official.filter;
    row.secondary_keys = (Array.isArray(secondary) ? secondary : secondary == null ? [] : [secondary]).map(String);
    row.selective = row.secondary_keys.length > 0;
  }
  if (cardFrontendLorebookHas(official, 'logic')) {
    var logicName = cardFrontendWorldbookLogic(official.logic);
    row.selectiveLogic = { and_any: 0, not_all: 1, not_any: 2, and_all: 3 }[logicName];
  }
  if (cardFrontendLorebookHas(official, 'scan_depth'))
    row.scanDepth = official.scan_depth === 'same_as_global' ? null : Math.max(0, Number(official.scan_depth) || 0);
  if (cardFrontendLorebookHas(official, 'case_sensitive'))
    row.caseSensitive = official.case_sensitive === 'same_as_global' ? null : official.case_sensitive === true;
  if (cardFrontendLorebookHas(official, 'match_whole_words'))
    row.matchWholeWords = official.match_whole_words === 'same_as_global' ? null : official.match_whole_words === true;
  if (cardFrontendLorebookHas(official, 'use_group_scoring'))
    row.useGroupScoring = official.use_group_scoring === 'same_as_global' ? null : official.use_group_scoring === true;
  if (cardFrontendLorebookHas(official, 'automation_id')) row.automationId = String(official.automation_id || '');
  if (cardFrontendLorebookHas(official, 'exclude_recursion'))
    row.excludeRecursion = official.exclude_recursion === true;
  if (cardFrontendLorebookHas(official, 'prevent_recursion'))
    row.preventRecursion = official.prevent_recursion === true;
  if (cardFrontendLorebookHas(official, 'delay_until_recursion'))
    row.delayUntilRecursion = official.delay_until_recursion;
  if (cardFrontendLorebookHas(official, 'group')) row.group = String(official.group || '');
  if (cardFrontendLorebookHas(official, 'group_prioritized')) row.groupOverride = official.group_prioritized === true;
  if (cardFrontendLorebookHas(official, 'group_weight'))
    row.groupWeight = Math.max(1, Number(official.group_weight) || 100);
  ['sticky', 'cooldown', 'delay'].forEach(function (key) {
    if (cardFrontendLorebookHas(official, key))
      row[key] = official[key] == null ? 0 : Math.max(0, Number(official[key]) || 0);
  });
  return row;
}
function cardFrontendLorebookDefaults(uid, index) {
  return {
    uid: uid,
    display_index: index,
    comment: '',
    enabled: true,
    type: 'selective',
    position: 'after_character_definition',
    depth: null,
    order: 100,
    probability: 100,
    key: [],
    keys: [],
    logic: 'and_any',
    filter: [],
    filters: [],
    scan_depth: 'same_as_global',
    case_sensitive: 'same_as_global',
    match_whole_words: 'same_as_global',
    use_group_scoring: 'same_as_global',
    automation_id: null,
    exclude_recursion: false,
    prevent_recursion: false,
    delay_until_recursion: false,
    content: '',
    group: '',
    group_prioritized: false,
    group_weight: 100,
    sticky: null,
    cooldown: null,
    delay: null,
  };
}
async function cardFrontendPersistLorebook(category, journal) {
  journal.seal();
  try {
    if (typeof persistWorldBookChange === 'function') await persistWorldBookChange({ urgent: true });
    else {
      var sessionsChanged = typeof invalidateCacheContexts === 'function' && invalidateCacheContexts();
      if (typeof saveData === 'function')
        await saveData(sessionsChanged ? ['worldbook', 'sessions'] : 'worldbook', { urgent: true });
    }
  } catch (error) {
    journal.rollback();
    throw new Error('世界书写入保存失败，原内容已恢复：' + String((error && error.message) || error));
  }
  if (typeof renderWBAll === 'function') renderWBAll();
  if (typeof renderWBSidebar === 'function') renderWBSidebar();
  if (typeof updateChatUI === 'function') updateChatUI();
}
async function cardFrontendWriteLorebook(name, args) {
  var category = cardFrontendWorldbookCategory(args && args.name);
  if (!category) throw new Error("未能找到世界书 '" + String((args && args.name) || '') + "'");
  if (!Array.isArray(category.entries)) category.entries = [];
  var journal = createMutationJournal(),
    rows = cardFrontendWorldbookRows(category),
    operation = String(name || '');
  if (operation === 'createLorebookEntries') {
    var used = Object.create(null);
    rows.forEach(function (row) {
      used[row.uid] = true;
    });
    var newUids = [],
      inputs = Array.isArray(args && args.entries) ? args.entries : [];
    inputs.forEach(function (value) {
      var uid = 0;
      while (used[uid]) uid++;
      used[uid] = true;
      newUids.push(uid);
      var partial = objectRecord(value) ? value : {},
        official = cardFrontendLorebookMerge(
          cardFrontendLorebookDefaults(uid, (category.entries || []).length),
          partial
        );
      official.uid = uid;
      journal.splice(category.entries, category.entries.length, 0, [cardFrontendLorebookStoredEntry(official, null)]);
    });
    await cardFrontendPersistLorebook(category, journal);
    return { entries: cardFrontendWorldbookRows(category).map(cardFrontendLorebookEntry), new_uids: newUids };
  }
  if (operation === 'setLorebookEntries') {
    (Array.isArray(args && args.entries) ? args.entries : []).forEach(function (value) {
      var patch = objectRecord(value);
      if (!patch) return;
      var uid = Number(patch.uid),
        current = cardFrontendWorldbookRows(category).find(function (row) {
          return row.uid === uid;
        });
      if (!current) return;
      var publicEntry = cardFrontendLorebookEntry(current),
        merged = cardFrontendLorebookMerge(publicEntry, patch);
      if (cardFrontendLorebookHas(patch, 'keys') && !cardFrontendLorebookHas(patch, 'key'))
        merged.key = cardFrontendCopy(merged.keys);
      if (cardFrontendLorebookHas(patch, 'key')) merged.keys = cardFrontendCopy(merged.key);
      if (cardFrontendLorebookHas(patch, 'filters') && !cardFrontendLorebookHas(patch, 'filter'))
        merged.filter = cardFrontendCopy(merged.filters);
      if (cardFrontendLorebookHas(patch, 'filter')) merged.filters = cardFrontendCopy(merged.filter);
      merged.uid = current.uid;
      journal.replaceRecord(current.stored, cardFrontendLorebookStoredEntry(merged, current.stored));
    });
    await cardFrontendPersistLorebook(category, journal);
    return cardFrontendWorldbookRows(category).map(cardFrontendLorebookEntry);
  }
  var wanted = new Set((Array.isArray(args && args.uids) ? args.uids : []).map(Number)),
    deleted = false;
  cardFrontendWorldbookRows(category)
    .reverse()
    .forEach(function (row) {
      if (wanted.has(row.uid)) {
        journal.splice(category.entries, row.index, 1);
        deleted = true;
      }
    });
  await cardFrontendPersistLorebook(category, journal);
  return { entries: cardFrontendWorldbookRows(category).map(cardFrontendLorebookEntry), delete_occurred: deleted };
}
function cardFrontendCharacterLorebooks(live, option) {
  var wanted = String((option && option.name) || 'current'),
    current = cardFrontendCharacter(live),
    character = wanted === 'current' ? current : null;
  if (!character && typeof D !== 'undefined' && D && Array.isArray(D.characters))
    character =
      D.characters.find(function (row) {
        return (
          row &&
          (String(row.name || '') === wanted ||
            (typeof canonicalCharacterName === 'function' && String(canonicalCharacterName(row)) === wanted))
        );
      }) || null;
  if (!character) {
    if (wanted === 'current') return { primary: null, additional: [] };
    throw new Error("未找到名为 '" + wanted + "' 的角色卡");
  }
  var id = String(character.id || ''),
    categories = cardFrontendWorldbookCategories().filter(function (category) {
      return (Array.isArray(category.boundCharIds) ? category.boundCharIds : []).map(String).indexOf(id) >= 0;
    }),
    primary =
      categories.find(function (category) {
        return String(category.ownerCharId || '') === id;
      }) ||
      categories[0] ||
      null,
    primaryName = cardFrontendWorldbookName(primary),
    additional = categories
      .filter(function (category) {
        return category !== primary;
      })
      .map(cardFrontendWorldbookName)
      .filter(Boolean);
  return { primary: primaryName || null, additional: additional };
}
function cardFrontendAllowedLorebookNames(live) {
  var bound = cardFrontendCharacterLorebooks(live, { name: 'current' }),
    settings =
      typeof hostWriteLorebookSettings === 'function' ? hostWriteLorebookSettings() : { selected_global_lorebooks: [] },
    names = (settings.selected_global_lorebooks || []).concat([bound.primary], bound.additional || []).filter(Boolean);
  return Array.from(new Set(names.map(String)));
}

// ---- frame document ----
function cardFrontendReplaceVh(content) {
  var source = String(content || ''),
    unit = '(?:dvh|svh|lvh|vh)',
    convert = function (value) {
      return String(value).replace(new RegExp('(-?\\d+(?:\\.\\d+)?)' + unit + '\\b', 'gi'), function (match, amount) {
        var parsed = parseFloat(amount);
        if (!Number.isFinite(parsed)) return match;
        return parsed === 100 ? 'var(--TH-viewport-height)' : 'calc(var(--TH-viewport-height) * ' + parsed / 100 + ')';
      });
    };
  source = source.replace(
    new RegExp('((?:min-|max-)?height\\s*:\\s*)([^;{}]*?-?\\d+(?:\\.\\d+)?' + unit + ')(?=\\s*[;}]|!important)', 'gi'),
    function (_, prefix, value) {
      return prefix + convert(value);
    }
  );
  source = source.replace(/(style\s*=\s*(["']))([^"']*?)(\2)/gi, function (match, prefix, quote, value, suffix) {
    return /(?:min-|max-)?height\s*:/i.test(value)
      ? prefix +
          value.replace(
            new RegExp('((?:min-|max-)?height\\s*:\\s*)([^;]*?-?\\d+(?:\\.\\d+)?' + unit + ')', 'gi'),
            function (_, label, height) {
              return label + convert(height);
            }
          ) +
          suffix
      : match;
  });
  source = source.replace(
    /(\.style\.(?:height|minHeight|maxHeight)\s*=\s*(["']))([\s\S]*?)(\2)/gi,
    function (match, prefix, quote, value, suffix) {
      return new RegExp('-?\\d+(?:\\.\\d+)?' + unit + '\\b', 'i').test(value)
        ? prefix + convert(value) + suffix
        : match;
    }
  );
  source = source.replace(
    /(setProperty\s*\(\s*(["'])(?:height|min-height|max-height)\2\s*,\s*(["']))([\s\S]*?)(\3\s*\))/gi,
    function (match, prefix, quote1, quote2, value, suffix) {
      return new RegExp('-?\\d+(?:\\.\\d+)?' + unit + '\\b', 'i').test(value)
        ? prefix + convert(value) + suffix
        : match;
    }
  );
  return source;
}
function cardFrontendResourceTags(resources) {
  return (Array.isArray(resources) ? resources : [])
    .map(function (resource) {
      var failed = 'window.__yeyuDependencyError&&window.__yeyuDependencyError(' + JSON.stringify(resource.url) + ')';
      return resource.kind === 'style'
        ? '<link rel="stylesheet" href="' + resource.url + '" onerror="' + failed + '">'
        : '<script src="' + resource.url + '" onerror="' + failed + '"></' + 'script>';
    })
    .join('');
}
// Every frame runs the same runtime and differs only in its token. Handing the token over in a script of
// its own keeps the ~120 KB runtime source identical across frames, so the engine compiles it once instead
// of on every mount; the runtime takes the token and deletes it before any card code runs.
var _cardFrontendRuntimeScript = '';
function cardFrontendRuntimeTags(token) {
  if (!_cardFrontendRuntimeScript)
    _cardFrontendRuntimeScript =
      '<script>(' +
      cardFrontendFrameBody.toString() +
      ')((function(){var token=window.__yeyuFrameToken;delete window.__yeyuFrameToken;return token;})());</' +
      'script>';
  return (
    '<script>window.__yeyuFrameToken=' +
    JSON.stringify(String(token || '')) +
    ';</' +
    'script>' +
    _cardFrontendRuntimeScript
  );
}
function cardFrontendDocument(html, token, viewportHeight) {
  var source = cardFrontendReplaceVh(html);
  viewportHeight = Math.max(1, Math.floor(Number(viewportHeight) || 1));
  var head =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>:root{--TH-viewport-height:' +
    viewportHeight +
    'px;}' +
    CARD_FRONTEND_BASE_CSS +
    '</style>' +
    cardFrontendRuntimeTags(token) +
    cardFrontendResourceTags(CARD_FRONTEND_PREDEFINE_RESOURCES.concat(CARD_FRONTEND_MESSAGE_RESOURCES)) +
    '<script>window.__yeyuCleanupDependenciesReady();</' +
    'script>';
  if (/<html[\s>]/i.test(source)) {
    if (/<head[\s>]/i.test(source))
      return source.replace(/<head\b[^>]*>/i, function (tag) {
        return tag + head;
      });
    return source.replace(/<html\b[^>]*>/i, function (tag) {
      return tag + '<head>' + head + '</head>';
    });
  }
  return '<!doctype html><html><head>' + head + '</head><body>' + source + '</body></html>';
}
function cardScriptLibraryDocument(token) {
  var libraryCss =
    'html,body{height:100%!important;min-height:100%!important;background:#101016!important;color:#f5f5f7!important;font:14px/1.5 system-ui,sans-serif!important;}body{box-sizing:border-box;padding:10px!important;overflow:auto!important;}#extensionsMenu{display:flex;flex-direction:column;gap:8px;min-height:44px}.extension_container,.list-group-item{box-sizing:border-box}.list-group-item{display:flex;align-items:center;gap:8px;min-height:44px;padding:10px 12px;border:1px solid #3b3b48;border-radius:9px;background:#22222b;color:#fff;cursor:pointer}dialog{box-sizing:border-box;width:100%;max-width:100%;height:100%;max-height:100%;margin:0;padding:42px 8px 8px;border:0;background:#121218;color:#fff}dialog::backdrop{background:#121218}.yeyu-library-dialog-close{position:fixed;z-index:20;top:7px;right:9px;min-height:34px;padding:5px 12px;border:1px solid #555565;border-radius:7px;background:#292934;color:#fff}';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
    CARD_FRONTEND_BASE_CSS +
    libraryCss +
    '</style>' +
    cardFrontendRuntimeTags(token) +
    cardFrontendResourceTags(CARD_FRONTEND_PREDEFINE_RESOURCES.concat(CARD_SCRIPT_LIBRARY_RESOURCES)) +
    '<script>window.__yeyuCleanupDependenciesReady();window.__yeyuStartLibraryRows();</' +
    'script></head><body><div id="extensionsMenu" aria-label="脚本库面板"></div></body></html>'
  );
}

// ---- lifecycle ----
function cardFrontendNote(node, text, kind) {
  var note = node && node.querySelector('.yeyu-card-frontend-note');
  if (!note) return;
  note.textContent = String(text || '');
  note.hidden = !text;
  note.setAttribute('data-frontend-note', String(kind || 'info'));
}
function cardFrontendToggleButtons(node, running) {
  var stop = node && node.querySelector('.yeyu-card-frontend-stop'),
    reload = node && node.querySelector('.yeyu-card-frontend-reload');
  if (stop) stop.hidden = !running;
  if (reload) reload.hidden = running;
}
function cardFrontendFlushHeightWaiters(live) {
  var waiters = live && live.heightWaiters;
  if (!live) return;
  live.heightWaiters = [];
  if (!waiters) return;
  waiters.forEach(function (fn) {
    try {
      fn();
    } catch (_) {}
  });
}
function cardFrontendFinalizeRetire(live, force) {
  var retiring = live && _cardFrontendRetiring.get(live.token),
    frame = live && live.frame,
    container = retiring && retiring.container;
  if (!retiring || !frame) return;
  var remove = function () {
    clearTimeout(retiring.timer);
    _cardFrontendRetiring.delete(live.token);
    try {
      (container || live.canvas || frame).remove();
    } catch (_) {}
  };
  if (force) {
    remove();
    return;
  }
  try {
    frame.addEventListener('load', remove, { once: true });
    frame.srcdoc = '<!doctype html><meta charset="utf-8">';
  } catch (_) {
    remove();
  }
}
function cardFrontendRetireFrame(live, container) {
  if (live) live.state = 'disposed';
  var frame = live && live.frame;
  if (!frame) return;
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  _cardFrontendRetiring.set(live.token, {
    live: live,
    container: container || null,
    timer: setTimeout(function () {
      cardFrontendFinalizeRetire(live, true);
    }, 2000),
  });
  if (!cardFrontendSend(live, 'shutdown', {})) cardFrontendFinalizeRetire(live);
}
function cardFrontendHtmlHash(key) {
  var record = _cardFrontendSource.get(key);
  return record ? cardFrontendHash(record.html) : '';
}
// Map insertion order is the recency order: re-inserting on every read and write turns the height
// memory into a plain LRU, so a long session cannot keep one entry per message it ever rendered.
function cardFrontendTouchHeight(hash, record) {
  if (!hash || !record) return record || null;
  _cardFrontendHeights.delete(hash);
  _cardFrontendHeights.set(hash, record);
  while (_cardFrontendHeights.size > CARD_FRONTEND_KEY_MEMORY_LIMIT)
    _cardFrontendHeights.delete(_cardFrontendHeights.keys().next().value);
  return record;
}
function cardFrontendRememberHeight(key, height, width) {
  var hash = cardFrontendHtmlHash(key),
    measured = Math.max(0, Math.floor(Number(height) || 0)),
    measuredWidth = Math.max(0, Math.floor(Number(width) || 0)),
    hostWidth = cardFrontendHostWidth();
  if (hash && measured > 0 && measuredWidth > 0) {
    var before = _cardFrontendHeights.get(hash);
    if (!before || before.height !== measured || before.width !== measuredWidth || before.hostWidth !== hostWidth)
      _cardFrontendHeightRevision++;
    cardFrontendTouchHeight(hash, { height: measured, width: measuredWidth, hostWidth: hostWidth });
  }
  return measured;
}
function cardFrontendReservedHeight(key, width) {
  var hash = cardFrontendHtmlHash(key),
    remembered = hash && _cardFrontendHeights.get(hash),
    currentWidth = Math.max(0, Math.floor(Number(width) || 0));
  if (!remembered) return 0;
  cardFrontendTouchHeight(hash, remembered);
  return currentWidth > 0 && Math.abs(Number(remembered.width) - currentWidth) <= 2
    ? Math.max(0, Math.floor(Number(remembered.height) || 0))
    : 0;
}
// A placeholder cannot be measured against the width its frame will get: with the frame gone the
// bubble shrinks to the hint text, so the slot reports a much narrower box and the remembered height
// never applied. The chat's own width is the same before and after mounting, so it is what decides
// whether a remembered height still fits.
function cardFrontendPlaceholderReservedHeight(key, hostWidth) {
  var hash = cardFrontendHtmlHash(key),
    remembered = hash && _cardFrontendHeights.get(hash),
    currentWidth = Math.max(0, Math.floor(Number(hostWidth) || 0));
  if (!remembered) return 0;
  cardFrontendTouchHeight(hash, remembered);
  return currentWidth > 0 && Math.abs(Number(remembered.hostWidth) - currentWidth) <= 2
    ? Math.max(0, Math.floor(Number(remembered.height) || 0))
    : 0;
}
function cardFrontendNormalMode() {
  return typeof document !== 'undefined' && document.body && document.body.classList.contains('message-style-immersive')
    ? 'immersive'
    : 'bubble';
}
function cardFrontendMeasureNormalGeometry(live) {
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null,
    frame = live && live.frame,
    node = live && live.node,
    availableHeight = Math.max(1, Math.floor(Number(host && host.clientHeight) || cardFrontendViewportHeight())),
    frameRect = frame && frame.getBoundingClientRect ? frame.getBoundingClientRect() : null,
    nodeRect = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null,
    frameHeight = Math.max(0, Number(frameRect && frameRect.height) || Number(frame && frame.offsetHeight) || 0),
    nodeHeight = Math.max(
      frameHeight,
      Number(nodeRect && nodeRect.height) || Number(node && node.offsetHeight) || frameHeight
    ),
    chromeHeight = Math.max(0, Math.ceil(nodeHeight - frameHeight)),
    width = Math.max(
      1,
      Math.floor(
        Number(frame && frame.clientWidth) ||
          Number(live && live.slot && live.slot.clientWidth) ||
          Number(node && node.clientWidth) ||
          1
      )
    );
  return {
    mode: cardFrontendNormalMode(),
    width: width,
    availableHeight: availableHeight,
    chromeHeight: chromeHeight,
    viewportHeight: Math.max(1, availableHeight - chromeHeight),
  };
}
function cardFrontendApplyNormalGeometry(live, height, deliver) {
  if (!live || live.fullscreenActive || !live.frame) return { layoutChanged: false, geometryChanged: false };
  var incoming = Math.max(0, Math.floor(Number(height) || 0));
  if (incoming > 0) live.contentHeight = incoming;
  var measured = cardFrontendMeasureNormalGeometry(live),
    contentHeight = Math.max(0, Math.floor(Number(live.contentHeight) || 0)),
    applied = Math.max(1, contentHeight || measured.viewportHeight),
    previous = Math.max(0, Math.floor(Number(live.appliedHeight) || 0)),
    before = live.normalGeometry,
    geometry = Object.assign(measured, {
      contentHeight: contentHeight,
      appliedHeight: applied,
    });
  live.frame.style.setProperty('--TH-viewport-height', measured.viewportHeight + 'px');
  if (applied !== previous) {
    // The snapshots only serve the frame's own compensation, which a live bottom follow replaces.
    var following = cardFrontendChatBottomFollowing();
    live.layoutViewport = following ? null : captureChatViewportLayout();
    live.layoutGrowth = following ? null : captureChatViewportBlock(live.node);
  }
  if (applied !== previous || live.frame.style.height !== applied + 'px') live.frame.style.height = applied + 'px';
  live.appliedHeight = applied;
  live.normalGeometry = geometry;
  var geometryChanged =
    !before ||
    before.mode !== geometry.mode ||
    before.width !== geometry.width ||
    before.viewportHeight !== geometry.viewportHeight;
  if (deliver && geometryChanged)
    cardFrontendSend(live, 'normalLayout', {
      mode: geometry.mode,
      viewportHeight: geometry.viewportHeight,
    });
  return { layoutChanged: applied !== previous, geometryChanged: geometryChanged };
}
function cardFrontendHostStyleSnapshot(live) {
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null,
    node = live && live.node,
    rows = [],
    properties = [
      'display',
      'position',
      'box-sizing',
      'width',
      'min-width',
      'max-width',
      'inline-size',
      'min-inline-size',
      'max-inline-size',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'overflow-x',
      'overflow-y',
      'contain',
      'clip-path',
      'mask-image',
      '-webkit-mask-image',
      'top',
      'right',
      'bottom',
      'left',
      'float',
      'flex-basis',
      'grid-column',
      'grid-row',
    ];
  if (!host || !node) return rows;
  for (var current = node; current; current = current.parentElement) {
    var style = getComputedStyle(current),
      values = {};
    properties.forEach(function (name) {
      values[name] = style.getPropertyValue(name);
    });
    rows.push({ node: current, inline: current.getAttribute('style'), values: values });
    if (current === host) break;
  }
  return rows;
}
function cardFrontendHostStyleChanged(snapshot) {
  return (snapshot || []).some(function (row) {
    if (!row.node || !row.node.isConnected) return true;
    var style = getComputedStyle(row.node);
    return Object.keys(row.values || {}).some(function (name) {
      return style.getPropertyValue(name) !== row.values[name];
    });
  });
}
function cardFrontendGuardHostStyle(styleNode) {
  if (
    !styleNode ||
    styleNode.nodeType !== 1 ||
    String(styleNode.tagName || '').toLowerCase() !== 'style' ||
    styleNode.disabled
  )
    return;
  var source = String(styleNode.textContent || '');
  if (!source) return;
  _cardFrontendLive.forEach(function (live) {
    if (
      styleNode.disabled ||
      !live ||
      live.fullscreenActive ||
      !live.frame ||
      !live.frame.id ||
      source.indexOf(live.frame.id) < 0
    )
      return;
    if (!cardFrontendHostStyleChanged(live.normalHostStyleSnapshot)) return;
    styleNode.disabled = true;
    styleNode.setAttribute('data-yeyu-host-geometry-blocked', '');
    cardFrontendApplyHostContainerStyles(live, false);
    cardFrontendRestoreInteraction(live);
  });
}
function cardFrontendInspectHostStyleMutation(mutation) {
  var target = mutation && mutation.target,
    node = target && target.nodeType === 1 ? target : target && target.parentElement;
  if (mutation && mutation.type === 'attributes' && mutation.attributeName === 'style') {
    _cardFrontendLive.forEach(function (live) {
      var state = live && live.interactionViewport,
        row = ((live && live.normalHostStyleSnapshot) || []).find(function (item) {
          return item.node === target;
        });
      if (!state || Date.now() > state.until || live.fullscreenActive || !row || !cardFrontendHostStyleChanged([row]))
        return;
      if (row.inline === null) target.removeAttribute('style');
      else target.setAttribute('style', row.inline);
      target.setAttribute('data-yeyu-host-geometry-blocked', '');
      cardFrontendApplyHostContainerStyles(live, false);
      cardFrontendRestoreInteraction(live);
    });
    return;
  }
  if (node && String(node.tagName || '').toLowerCase() === 'style') cardFrontendGuardHostStyle(node);
  Array.prototype.forEach.call((mutation && mutation.addedNodes) || [], function (added) {
    if (!added || added.nodeType !== 1) return;
    if (String(added.tagName || '').toLowerCase() === 'style') cardFrontendGuardHostStyle(added);
    if (added.querySelectorAll)
      Array.prototype.forEach.call(added.querySelectorAll('style'), cardFrontendGuardHostStyle);
  });
}
function cardFrontendClearInteraction(live) {
  var state = live && live.interactionViewport;
  if (!state) return;
  if (state.frameId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frameId);
  if (state.timer) clearTimeout(state.timer);
  if (_cardFrontendHostInlineStyleObserver) _cardFrontendHostInlineStyleObserver.disconnect();
  live.interactionViewport = null;
}
function cardFrontendRestoreInteraction(live) {
  var state = live && live.interactionViewport;
  if (!state) return false;
  if (live.fullscreenActive) {
    cardFrontendClearInteraction(live);
    return false;
  }
  if (
    Date.now() > state.until ||
    !chatViewportTaskMatches(state.task) ||
    !state.host ||
    !state.anchorNode ||
    !state.anchorNode.isConnected
  ) {
    cardFrontendClearInteraction(live);
    return false;
  }
  if (state.frameId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(state.frameId);
    state.frameId = 0;
  }
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = 0;
  }
  cardFrontendApplyHostContainerStyles(live, false);
  var current = state.anchorNode.getBoundingClientRect(),
    delta = Number(current && current.top) - state.top;
  if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
    var next = cardFrontendClamp(
      (Number(state.host.scrollTop) || 0) + delta,
      0,
      Math.max(0, state.host.scrollHeight - state.host.clientHeight)
    );
    if (typeof writeOwnedChatScrollTop === 'function') writeOwnedChatScrollTop(state.host, next);
    else state.host.scrollTop = next;
  }
  var tick = function () {
    cardFrontendRestoreInteraction(live);
  };
  if (state.settles-- > 0 && typeof requestAnimationFrame === 'function') state.frameId = requestAnimationFrame(tick);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(
    function () {
      cardFrontendClearInteraction(live);
    },
    Math.max(0, state.until - Date.now())
  );
  return true;
}
function cardFrontendBeginInteraction(live) {
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null,
    node = live && live.node,
    now = Date.now(),
    current = live && live.interactionViewport;
  if (!live || live.fullscreenActive || live.fullscreenMode) {
    if (live) cardFrontendClearInteraction(live);
    return false;
  }
  if (!host || !node || !node.isConnected) return false;
  cardFrontendMarkUsed(live.key);
  cardFrontendApplyHostContainerStyles(live, false);
  if (current && now <= current.until && chatViewportTaskMatches(current.task)) {
    current.until = now + 1200;
    current.settles = 2;
    return true;
  }
  cardFrontendClearInteraction(live);
  live.normalHostStyleSnapshot = cardFrontendHostStyleSnapshot(live);
  if (_cardFrontendHostInlineStyleObserver) {
    _cardFrontendHostInlineStyleObserver.disconnect();
    live.normalHostStyleSnapshot.forEach(function (row) {
      _cardFrontendHostInlineStyleObserver.observe(row.node, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['style'],
      });
    });
  }
  var anchorNode = node.querySelector('.yeyu-card-frontend-bar') || node,
    anchor = typeof captureChatReadingAnchor === 'function' ? captureChatReadingAnchor(true) : null,
    rect = anchorNode.getBoundingClientRect();
  if (typeof adoptChatViewportReading === 'function') adoptChatViewportReading('card-frontend-interaction', anchor);
  live.interactionViewport = {
    host: host,
    anchorNode: anchorNode,
    top: Number(rect && rect.top) || 0,
    until: now + 1200,
    frameId: 0,
    timer: 0,
    task: captureChatViewportTask(host),
    settles: 2,
  };
  return cardFrontendRestoreInteraction(live);
}
// Mounting and disposing a frame both resize the block under the reader without any gesture, so a
// live bottom follow is told where the list stands now rather than being left to judge the scroll
// that arrives afterwards against numbers taken before the swap.
function cardFrontendRepinChatBottom() {
  return typeof chatBottomFollowRepin === 'function' ? chatBottomFollowRepin() : false;
}
function cardFrontendChatBottomFollowing() {
  return typeof chatBottomFollowing === 'function' ? chatBottomFollowing() : false;
}
function cardFrontendNotifyLayout(live) {
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null;
  if (!host) return;
  if (live && live.interactionViewport && cardFrontendRestoreInteraction(live)) return;
  // With a live bottom follow the correction is one repin, skipped when the list is already there,
  // instead of the unconditional follow-mode write below (the snapshots would defer to it anyway).
  if (cardFrontendRepinChatBottom()) return;
  var owner = typeof getChatViewportState === 'function' ? getChatViewportState() : null;
  if (owner && owner.mode === 'follow') {
    if (typeof writeOwnedChatScrollTop === 'function')
      writeOwnedChatScrollTop(host, Math.max(0, host.scrollHeight - host.clientHeight));
    else host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
    return;
  }
  if (!compensateChatViewportGrowth(live && live.layoutGrowth)) restoreChatViewportLayout(live && live.layoutViewport);
  if (live) {
    live.layoutViewport = null;
    live.layoutGrowth = null;
  }
}
function cardFrontendScrollChat(live, delta) {
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null,
    amount = Number(delta) || 0;
  if (!host || !amount) return false;
  cardFrontendClearInteraction(live);
  var before = Number(host.scrollTop) || 0,
    next = cardFrontendClamp(before + amount, 0, Math.max(0, host.scrollHeight - host.clientHeight));
  if (Math.abs(next - before) < 0.5) return false;
  if (typeof writeOwnedChatScrollTop === 'function') writeOwnedChatScrollTop(host, next);
  else host.scrollTop = next;
  var changed = Math.abs((Number(host.scrollTop) || 0) - before) >= 0.5;
  if (changed && _generationState !== 'idle' && typeof isNearChatBottom === 'function' && isNearChatBottom(host)) {
    if (typeof adoptChatViewportFollow === 'function') adoptChatViewportFollow('card-frontend-scroll-bottom');
  } else if (changed && typeof adoptChatViewportGesture === 'function')
    adoptChatViewportGesture('card-frontend-scroll', true);
  return changed;
}
function cardFrontendFullscreenElement() {
  return (typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement)) || null;
}
function cardFrontendSetOwnedStyle(node, name, value, priority) {
  if (!node || !node.style) return;
  if (value === null) {
    if (node.style.getPropertyValue(name) || node.style.getPropertyPriority(name)) node.style.removeProperty(name);
    return;
  }
  priority = priority || '';
  if (node.style.getPropertyValue(name) !== value || node.style.getPropertyPriority(name) !== priority)
    node.style.setProperty(name, value, priority);
}
function cardFrontendApplyHostContainerStyles(live, fullscreen, exitingFullscreen) {
  if (!live) return;
  if (!fullscreen && !exitingFullscreen && (live.fullscreenActive || live.fullscreenMode)) return;
  if (!fullscreen) {
    var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null;
    cardFrontendSetOwnedStyle(host, 'overflow-y', 'auto', 'important');
    if (live.slot) {
      cardFrontendSetOwnedStyle(live.slot, 'width', null);
      cardFrontendSetOwnedStyle(live.slot, 'overflow', null);
      cardFrontendSetOwnedStyle(live.slot, 'max-width', '100%', 'important');
    }
    if (live.canvas) {
      cardFrontendSetOwnedStyle(live.canvas, 'width', null);
      cardFrontendSetOwnedStyle(live.canvas, 'height', null);
      cardFrontendSetOwnedStyle(live.canvas, 'overflow', null);
      cardFrontendSetOwnedStyle(live.canvas, 'max-width', '100%', 'important');
      cardFrontendSetOwnedStyle(live.canvas, 'margin', '0', 'important');
      cardFrontendSetOwnedStyle(live.canvas, 'position', 'static', 'important');
    }
    if (live.frame) {
      cardFrontendSetOwnedStyle(live.frame, 'width', null);
      cardFrontendSetOwnedStyle(live.frame, 'max-width', '100%', 'important');
    }
    return;
  }
  if (live.slot) {
    cardFrontendSetOwnedStyle(live.slot, 'width', '100%', 'important');
    cardFrontendSetOwnedStyle(live.slot, 'max-width', '100%', 'important');
    cardFrontendSetOwnedStyle(live.slot, 'overflow', 'hidden', 'important');
  }
  if (live.canvas) {
    cardFrontendSetOwnedStyle(live.canvas, 'width', '100%', 'important');
    cardFrontendSetOwnedStyle(live.canvas, 'max-width', 'none', 'important');
    cardFrontendSetOwnedStyle(live.canvas, 'height', '100%', 'important');
    cardFrontendSetOwnedStyle(live.canvas, 'position', 'relative', 'important');
    cardFrontendSetOwnedStyle(live.canvas, 'overflow', 'auto', 'important');
  }
  if (live.frame) cardFrontendSetOwnedStyle(live.frame, 'max-width', 'none', 'important');
}
function cardFrontendFullscreenMetrics(mode, zoom, reportedContentSize) {
  var view = typeof window !== 'undefined' && window.visualViewport,
    width = Math.max(1, Math.floor(Number((view && view.width) || window.innerWidth) || 1)),
    height = Math.max(1, Math.floor(Number((view && view.height) || window.innerHeight) || 1)),
    logicalWidth = mode === 'desktop' ? 1080 : width,
    fitScale = mode === 'desktop' ? width / logicalWidth : 1,
    logicalViewportHeight = Math.max(1, height / fitScale),
    content = objectRecord(reportedContentSize) || {},
    contentWidth = Math.max(logicalWidth, Number(content.width) || 0),
    contentHeight = Math.max(logicalViewportHeight, Number(content.height) || 0);
  zoom = mode === 'desktop' ? cardFrontendClamp(Number(zoom) || 1, 1, 4) : 1;
  var scale = fitScale * zoom;
  return {
    width: width,
    height: height,
    logicalWidth: logicalWidth,
    logicalViewportHeight: logicalViewportHeight,
    contentWidth: contentWidth,
    contentHeight: contentHeight,
    fitScale: fitScale,
    scale: scale,
    zoom: zoom,
    renderedViewportWidth: logicalWidth * scale,
    renderedViewportHeight: logicalViewportHeight * scale,
    renderedContentWidth: contentWidth * scale,
    renderedContentHeight: contentHeight * scale,
  };
}
function cardFrontendNativeFullscreenMode(mode) {
  try {
    var bridge = typeof window !== 'undefined' && window.AndroidBridge;
    if (bridge && typeof bridge.setCardFrontendFullscreenMode === 'function')
      bridge.setCardFrontendFullscreenMode(mode === 'desktop' || mode === 'phone' ? mode : '');
  } catch (_) {}
}
function cardFrontendApplyFullscreenLayout(live, options) {
  if (!live || !live.slot || !live.fullscreenMode) return false;
  options = options || {};
  var mode = live.fullscreenMode === 'desktop' ? 'desktop' : 'phone',
    slot = live.slot,
    scroller = live.canvas || slot,
    viewer =
      live.fullscreenViewer ||
      (live.fullscreenViewer = { zoom: 1, metrics: null, resizeTimer: 0, gesture: false, pendingResize: false }),
    old = viewer.metrics,
    metrics =
      options.zoomOnly && old
        ? Object.assign({}, old)
        : cardFrontendFullscreenMetrics(mode, viewer.zoom, live.fullscreenContentSize),
    focus = options.focus || null;
  if (options.zoomOnly && old) {
    metrics.zoom = cardFrontendClamp(viewer.zoom, 1, 4);
    metrics.scale = old.fitScale * metrics.zoom;
    metrics.renderedViewportWidth = metrics.logicalWidth * metrics.scale;
    metrics.renderedViewportHeight = metrics.logicalViewportHeight * metrics.scale;
    metrics.renderedContentWidth = metrics.contentWidth * metrics.scale;
    metrics.renderedContentHeight = metrics.contentHeight * metrics.scale;
  }
  if (
    old &&
    !options.force &&
    old.width === metrics.width &&
    old.height === metrics.height &&
    old.zoom === metrics.zoom
  )
    return false;
  if (old && !focus && options.preserve !== false)
    focus = {
      x: scroller.clientWidth / 2,
      y: scroller.clientHeight / 2,
      logicalX: (scroller.scrollLeft + scroller.clientWidth / 2) / old.scale,
      logicalY: (scroller.scrollTop + scroller.clientHeight / 2) / old.scale,
    };
  slot.setAttribute('data-yeyu-fullscreen-active', '');
  slot.setAttribute('data-yeyu-fullscreen-layout', mode);
  cardFrontendApplyHostContainerStyles(live, true);
  slot.style.setProperty('--yeyu-frontend-logical-width', metrics.logicalWidth + 'px');
  slot.style.setProperty('--yeyu-frontend-logical-viewport-height', metrics.logicalViewportHeight + 'px');
  slot.style.setProperty('--yeyu-frontend-rendered-viewport-width', metrics.renderedViewportWidth + 'px');
  slot.style.setProperty('--yeyu-frontend-rendered-viewport-height', metrics.renderedViewportHeight + 'px');
  slot.style.setProperty('--yeyu-frontend-rendered-content-width', metrics.renderedContentWidth + 'px');
  slot.style.setProperty('--yeyu-frontend-rendered-content-height', metrics.renderedContentHeight + 'px');
  slot.style.setProperty('--yeyu-frontend-scale', String(metrics.scale));
  viewer.metrics = metrics;
  viewer.zoom = metrics.zoom;
  if (focus) {
    scroller.scrollLeft = focus.logicalX * metrics.scale - focus.x;
    scroller.scrollTop = focus.logicalY * metrics.scale - focus.y;
  }
  if (live.frame) {
    live.frame.setAttribute('scrolling', 'auto');
    live.frame.style.setProperty('--TH-viewport-height', metrics.logicalViewportHeight + 'px');
    live.frame.style.setProperty('width', metrics.logicalWidth + 'px', 'important');
  }
  cardFrontendSyncFullscreenViewport(live);
  if (options.notify !== false)
    cardFrontendSend(live, 'fullscreenLayout', {
      active: true,
      mode: mode,
      logicalWidth: metrics.logicalWidth,
      logicalViewportHeight: metrics.logicalViewportHeight,
      fitScale: metrics.fitScale,
      scale: metrics.scale,
      zoom: metrics.zoom,
    });
  return true;
}
function cardFrontendSyncFullscreenViewport(live) {
  var viewer = live && live.fullscreenViewer,
    metrics = viewer && viewer.metrics,
    scroller = live && (live.canvas || live.slot),
    frame = live && live.frame;
  if (!metrics || !scroller || !frame || live.fullscreenMode !== 'desktop') return false;
  var contentTravel = Math.max(0, (metrics.contentHeight - metrics.logicalViewportHeight) * metrics.scale),
    contentOffset = cardFrontendClamp(scroller.scrollTop, 0, contentTravel);
  frame.style.top = contentOffset + 'px';
  cardFrontendSend(live, 'fullscreenViewport', { top: contentOffset / metrics.scale });
  return true;
}
function cardFrontendScheduleFullscreenLayout(live) {
  var viewer = live && live.fullscreenViewer;
  if (!viewer) return;
  if (viewer.gesture) {
    viewer.pendingResize = true;
    return;
  }
  if (viewer.resizeTimer) clearTimeout(viewer.resizeTimer);
  viewer.resizeTimer = setTimeout(function () {
    viewer.resizeTimer = 0;
    if (viewer.gesture) {
      viewer.pendingResize = true;
      return;
    }
    if (live.fullscreenActive) cardFrontendApplyFullscreenLayout(live, { preserve: true });
  }, 140);
}
function cardFrontendFullscreenGesture(live, payload) {
  if (!live || live.fullscreenMode !== 'desktop' || !live.fullscreenActive) return false;
  var viewer =
      live.fullscreenViewer ||
      (live.fullscreenViewer = { zoom: 1, metrics: null, resizeTimer: 0, gesture: false, pendingResize: false }),
    slot = live.slot,
    scroller = live.canvas || slot,
    phase = String((payload && payload.phase) || ''),
    kind = String((payload && payload.kind) || '');
  if (phase === 'start') {
    if (viewer.resizeTimer) {
      clearTimeout(viewer.resizeTimer);
      viewer.resizeTimer = 0;
      viewer.pendingResize = true;
    }
  }
  if (phase === 'start' && kind === 'pinch') {
    var metrics = viewer.metrics;
    if (!metrics) return false;
    var start = cardFrontendGestureGeometry(payload, metrics, scroller),
      x = cardFrontendClamp(start.x, 0, scroller.clientWidth),
      y = cardFrontendClamp(start.y, 0, scroller.clientHeight);
    viewer.gesture = {
      kind: 'pinch',
      distance: start.distance,
      zoom: viewer.zoom,
      focus: {
        x: x,
        y: y,
        logicalX: (scroller.scrollLeft + x) / metrics.scale,
        logicalY: (scroller.scrollTop + y) / metrics.scale,
      },
    };
    return true;
  }
  if (phase === 'start' && kind === 'pan') {
    viewer.gesture = { kind: 'pan' };
    return true;
  }
  if (phase === 'move' && kind === 'pinch' && viewer.gesture && viewer.gesture.kind === 'pinch') {
    var pinch = viewer.gesture,
      current = cardFrontendGestureGeometry(payload, viewer.metrics, scroller),
      focus = {
        x: cardFrontendClamp(current.x, 0, scroller.clientWidth),
        y: cardFrontendClamp(current.y, 0, scroller.clientHeight),
        logicalX: pinch.focus.logicalX,
        logicalY: pinch.focus.logicalY,
      };
    viewer.zoom = cardFrontendViewerZoom(pinch.zoom, pinch.distance, current.distance);
    cardFrontendApplyFullscreenLayout(live, { force: true, focus: focus, notify: false, zoomOnly: true });
    return true;
  }
  if (phase === 'pan' && viewer.gesture && viewer.gesture.kind === 'pan') {
    var deltaX = Number(payload && payload.deltaX) || 0,
      deltaY = Number(payload && payload.deltaY) || 0;
    if (deltaX) scroller.scrollLeft += deltaX;
    if (deltaY) scroller.scrollTop += deltaY;
    cardFrontendSyncFullscreenViewport(live);
    return true;
  }
  if (phase === 'end') {
    viewer.gesture = false;
    cardFrontendSend(live, 'fullscreenLayout', {
      active: true,
      mode: 'desktop',
      logicalWidth: viewer.metrics && viewer.metrics.logicalWidth,
      logicalViewportHeight: viewer.metrics && viewer.metrics.logicalViewportHeight,
      fitScale: viewer.metrics && viewer.metrics.fitScale,
      scale: viewer.metrics && viewer.metrics.scale,
      zoom: viewer.zoom,
    });
    if (viewer.pendingResize) {
      viewer.pendingResize = false;
      cardFrontendScheduleFullscreenLayout(live);
    }
    return true;
  }
  return false;
}
function cardFrontendRestoreFullscreenHostScroll(live, finish) {
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null;
  if (!live || live.fullscreenHostScrollTop == null || !host) return false;
  var top = Number(live.fullscreenHostScrollTop);
  if (!Number.isFinite(top)) return false;
  var apply = function () {
    restoreChatViewportLayout(live.fullscreenViewport);
  };
  apply();
  if (finish) {
    if (live.fullscreenHostScrollTimer) clearTimeout(live.fullscreenHostScrollTimer);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    live.fullscreenHostScrollTimer = setTimeout(function () {
      live.fullscreenHostScrollTimer = 0;
      if (live.fullscreenHostScrollTop == null) return;
      apply();
      live.fullscreenHostScrollTop = null;
    }, 320);
  }
  return true;
}
function cardFrontendResetFullscreen(live) {
  if (!live) return;
  var slot = live.slot,
    hadMode = !!live.fullscreenMode,
    viewer = live.fullscreenViewer,
    host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null,
    hostScrollTop = Number(live.fullscreenHostScrollTop);
  if (viewer && viewer.resizeTimer) clearTimeout(viewer.resizeTimer);
  if (slot) {
    slot.removeAttribute('data-yeyu-fullscreen-active');
    slot.removeAttribute('data-yeyu-fullscreen-layout');
    slot.style.removeProperty('--yeyu-frontend-logical-width');
    slot.style.removeProperty('--yeyu-frontend-logical-viewport-height');
    slot.style.removeProperty('--yeyu-frontend-rendered-viewport-width');
    slot.style.removeProperty('--yeyu-frontend-rendered-viewport-height');
    slot.style.removeProperty('--yeyu-frontend-rendered-content-width');
    slot.style.removeProperty('--yeyu-frontend-rendered-content-height');
    slot.style.removeProperty('--yeyu-frontend-scale');
    slot.scrollLeft = 0;
    slot.scrollTop = 0;
  }
  if (live.canvas) {
    live.canvas.scrollLeft = 0;
    live.canvas.scrollTop = 0;
  }
  if (live.frame) {
    live.frame.setAttribute('scrolling', 'auto');
    live.frame.style.removeProperty('width');
    live.frame.style.removeProperty('top');
  }
  cardFrontendApplyHostContainerStyles(live, false, true);
  live.fullscreenRequestId = (Number(live.fullscreenRequestId) || 0) + 1;
  live.fullscreenRequestPending = false;
  live.fullscreenMode = '';
  live.fullscreenActive = false;
  live.fullscreenContentSize = { width: 0, height: 0 };
  live.fullscreenViewer = null;
  if (hadMode) cardFrontendNativeFullscreenMode('');
  cardFrontendSend(live, 'fullscreenLayout', { active: false });
  if (hadMode) {
    var normal = cardFrontendApplyNormalGeometry(live, 0, true);
    if (normal.layoutChanged) cardFrontendNotifyLayout(live);
    live.normalHostStyleSnapshot = cardFrontendHostStyleSnapshot(live);
  }
  if (hadMode && host && Number.isFinite(hostScrollTop)) cardFrontendRestoreFullscreenHostScroll(live, true);
}
function cardFrontendCloseFullscreen(live) {
  if (!live) return;
  var active = cardFrontendFullscreenElement();
  if (active && active === live.slot) {
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (typeof exit === 'function') Promise.resolve(exit.call(document)).catch(function () {});
  }
  cardFrontendResetFullscreen(live);
}
function cardFrontendSyncFullscreen() {
  var active = cardFrontendFullscreenElement();
  _cardFrontendLive.forEach(function (live) {
    if (active && active === live.slot && live.fullscreenMode) {
      live.fullscreenRequestPending = false;
      live.fullscreenActive = true;
      cardFrontendApplyFullscreenLayout(live, { force: true });
    } else if (live.fullscreenActive && !live.fullscreenRequestPending) cardFrontendResetFullscreen(live);
  });
}
function cardFrontendResizeFullscreen() {
  _cardFrontendLive.forEach(function (live) {
    if (live.fullscreenActive) {
      cardFrontendScheduleFullscreenLayout(live);
      return;
    }
    var normal = cardFrontendApplyNormalGeometry(live, 0, true);
    if (normal.layoutChanged) cardFrontendNotifyLayout(live);
    if (!live.interactionViewport) live.normalHostStyleSnapshot = cardFrontendHostStyleSnapshot(live);
    cardFrontendRestoreFullscreenHostScroll(live, window.innerHeight >= window.innerWidth);
  });
}
function openCardFrontendFullscreen(key, mode) {
  var live = _cardFrontendLive.get(String(key || '')),
    record = live && _cardFrontendSource.get(live.key),
    slot = live && live.slot;
  if (!live || !record || !slot || !slot.isConnected) {
    if (typeof toast === 'function') toast('这段卡片前端还没有准备好', 'err');
    return false;
  }
  if (cardFrontendFullscreenElement()) {
    if (typeof toast === 'function') toast('请先退出当前全屏', 'err');
    return false;
  }
  var request = slot.requestFullscreen || slot.webkitRequestFullscreen;
  if (typeof request !== 'function') {
    if (typeof toast === 'function') toast('当前系统网页组件不支持卡片全屏', 'err');
    return false;
  }
  cardFrontendClearInteraction(live);
  cardFrontendMarkUsed(live.key);
  if (live.fullscreenHostScrollTimer) {
    clearTimeout(live.fullscreenHostScrollTimer);
    live.fullscreenHostScrollTimer = 0;
  }
  var host = typeof document !== 'undefined' ? document.getElementById('chat-messages') : null,
    requestId = (Number(live.fullscreenRequestId) || 0) + 1;
  live.fullscreenHostScrollTop = Number(host && host.scrollTop) || 0;
  adoptChatViewportReading('card-fullscreen', captureChatReadingAnchor(true));
  live.fullscreenViewport = captureChatViewportLayout();
  live.fullscreenRequestId = requestId;
  live.fullscreenRequestPending = true;
  live.fullscreenMode = mode === 'desktop' ? 'desktop' : 'phone';
  live.fullscreenActive = true;
  live.fullscreenViewer = { zoom: 1, metrics: null, resizeTimer: 0, gesture: false, pendingResize: false };
  cardFrontendNativeFullscreenMode(live.fullscreenMode);
  cardFrontendApplyFullscreenLayout(live, { force: true, preserve: false });
  Promise.resolve(request.call(slot)).then(
    function () {
      if (live.fullscreenRequestId !== requestId) return;
      live.fullscreenRequestPending = false;
      cardFrontendSyncFullscreen();
    },
    function (error) {
      if (live.fullscreenRequestId !== requestId) return;
      cardFrontendResetFullscreen(live);
      if (typeof toast === 'function') toast('无法进入卡片全屏：' + String((error && error.message) || error), 'err');
    }
  );
  return true;
}
function cardFrontendDispose(key) {
  var live = _cardFrontendLive.get(key);
  if (!live) return false;
  _cardFrontendLive.delete(key);
  if (live.fullscreenHostScrollTimer) clearTimeout(live.fullscreenHostScrollTimer);
  cardFrontendClearInteraction(live);
  if (_cardFrontendLayoutObserver && live.node)
    try {
      _cardFrontendLayoutObserver.unobserve(live.node);
    } catch (_) {}
  cardFrontendCloseFullscreen(live);
  cardFrontendClearToasts(live);
  if (typeof stopCardFrontendGenerationsForLive === 'function') stopCardFrontendGenerationsForLive(live, false);
  cardFrontendClearOwnerRegistrations(live);
  cardFrontendFlushHeightWaiters(live);
  cardFrontendRetireFrame(live);
  cardFrontendRepinChatBottom();
  return true;
}
function cardScriptLibraryDispose() {
  var live = _cardScriptLibraryLive;
  if (!live) return false;
  _cardScriptLibraryLive = null;
  if (live.readyResolve) {
    live.readyResolve(null);
    live.readyResolve = null;
  }
  _cardScriptEventWaiters.forEach(function (waiter, eventId) {
    if (waiter.live !== live) return;
    _cardScriptEventWaiters.delete(eventId);
    waiter.reject(new Error('脚本库已停止'));
  });
  if (typeof cardScriptSendInterceptDispose === 'function') cardScriptSendInterceptDispose(live);
  cardFrontendClearToasts(live);
  cardFrontendFlushExtensionSettings(live).catch(function (error) {
    cardFrontendSettingsSaveFailed(error, live);
  });
  if (typeof stopCardFrontendGenerationsForLive === 'function') stopCardFrontendGenerationsForLive(live, false);
  cardFrontendClearOwnerRegistrations(live);
  cardFrontendRetireFrame(live, live.shell || null);
  if (live.char && typeof renderCardScriptStatus === 'function') renderCardScriptStatus(live.char);
  return true;
}
function cardScriptLibraryOwner(char) {
  var session = cardFrontendSession(char),
    rows = session && Array.isArray(session.msgs) ? session.msgs : [];
  return session && !(typeof sessionAwaitsGreeting === 'function' && sessionAwaitsGreeting(session))
    ? {
        charId: String((char && char.id) || ''),
        sessionId: String(session.id || ''),
        messageIndex: Math.max(0, rows.length - 1),
      }
    : null;
}
function cardScriptLibraryMount(char, scan, page) {
  if (typeof document === 'undefined' || !document.body) return null;
  var owner = cardScriptLibraryOwner(char);
  if (!owner) return null;
  var token = 'l' + ++_cardFrontendSeq + '_' + cardFrontendHash(page + ':' + _cardFrontendSeq),
    shell = document.createElement('section'),
    frame = document.createElement('iframe'),
    names = scan.active.map(function (row) {
      return row.name;
    }),
    firstScript = scan.active[0] || {};
  shell.className = 'yeyu-script-library-shell';
  shell.id = 'yeyu-script-library-panel';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-labelledby', 'yeyu-script-library-title');
  shell.hidden = true;
  shell.innerHTML =
    '<header><div class="yeyu-script-library-heading"><strong id="yeyu-script-library-title">卡片脚本库</strong><span>' +
    names
      .map(function (name) {
        return typeof esc === 'function' ? esc(name) : String(name);
      })
      .join('、') +
    '</span></div><button type="button" class="modal-close yeyu-script-library-close" aria-label="关闭脚本库"><svg class="ui-icon" aria-hidden="true"><use href="#i-close" xlink:href="#i-close"></use></svg></button></header>';
  frame.className = 'yeyu-script-library-frame';
  frame.setAttribute('title', '卡片脚本库');
  frame.id = frame.name = 'TH-script--' + String(firstScript.name || '夜欲') + '--' + String(firstScript.id || token);
  shell.appendChild(frame);
  document.body.appendChild(shell);
  var scripts = (scan.active || []).map(function (row) {
      return {
        id: String(row.id || ''),
        name: String(row.name || ''),
        info: String(row.info || ''),
        button: cardFrontendCopy(row.button) || {},
        content:
          typeof mvuResidentScriptSource === 'function'
            ? mvuResidentScriptSource(char, row)
            : String(row.content || ''),
        modules: Array.isArray(row.modules) ? row.modules.slice() : [],
      };
    }),
    readyResolve,
    readyPromise = new Promise(function (resolve) {
      readyResolve = resolve;
    }),
    live = {
      kind: 'library',
      key: page,
      node: shell,
      shell: shell,
      frame: frame,
      token: token,
      owner: owner,
      charId: String(char.id || ''),
      char: char,
      scripts: scripts,
      state: 'loading',
      lastError: '',
      scriptFailures: [],
      readyPromise: readyPromise,
      readyResolve: readyResolve,
      extensionSettingsBase: cardFrontendExtensionSettingsSnapshot(),
      sillyTavernPending: cardFrontendChatOpenedEvents(char, cardFrontendSession(char)),
    };
  _cardScriptLibraryLive = live;

  frame.srcdoc = cardScriptLibraryDocument(token);
  shell.querySelector('.yeyu-script-library-close').addEventListener('click', closeCurrentCardScriptLibrary);
  if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(char);
  return live;
}
function refreshCardScriptLibraryContext(char, session, preserveChat) {
  var live = _cardScriptLibraryLive,
    target = char || cardFrontendCharacter(live),
    active = session || cardFrontendSession(target);
  if (
    !live ||
    !target ||
    !active ||
    live.charId !== String(target.id || '') ||
    String((live.owner && live.owner.sessionId) || '') !== String(active.id || '')
  )
    return false;
  var rows = Array.isArray(active.msgs) ? active.msgs : [],
    current = Math.max(0, rows.length - 1),
    preserve = preserveChat === true,
    payload = { messageId: current, lastMessageId: current };
  if (!preserve) Object.assign(payload, cardFrontendSillyTavernContext(target, active));
  payload.preserveChat = preserve;
  return cardFrontendSend(live, 'context', payload);
}
function cardScriptSendInterceptAbortError(message) {
  var error = new Error(message || '已取消');
  error.name = 'AbortError';
  return error;
}
function cardScriptSendInterceptClose(record) {
  if (!record) return false;
  if (record.controller && record.abortListener)
    record.controller.signal.removeEventListener('abort', record.abortListener);
  if (_cardScriptSendIntercept === record) _cardScriptSendIntercept = null;
  record.closed = true;
  return true;
}
function cardScriptSendInterceptSession(record) {
  var char = record && cardFrontendCharacter(record.live),
    box = char && D.chats && D.chats[char.id],
    session =
      box && Array.isArray(box.sessions)
        ? box.sessions.find(function (row) {
            return String((row && row.id) || '') === String(record.sessionId || '');
          })
        : null;
  return char && session ? { char: char, session: session } : null;
}
function cardScriptSendInterceptCurrent(record) {
  var pair = cardScriptSendInterceptSession(record);
  return !!(
    pair &&
    record &&
    record.live === _cardScriptLibraryLive &&
    record.live.state === 'ready' &&
    String(record.live.charId || '') === String(record.charId || '') &&
    String((record.live.owner && record.live.owner.sessionId) || '') === String(record.sessionId || '') &&
    typeof cardScriptSendInterceptGranted === 'function' &&
    cardScriptSendInterceptGranted(pair.char)
  );
}
function cardScriptSendInterceptReject(record, error) {
  if (record && typeof record.reject === 'function') record.reject(error);
}
function cardScriptSendInterceptCancel(live) {
  var record = _cardScriptSendIntercept;
  if (!record || record.closed || (live && record.live !== live)) return false;
  record.cancelled = true;
  if (typeof CardFrontendGenerationCycle === 'object') CardFrontendGenerationCycle.stop(record.live);
  if (
    typeof _generationState !== 'undefined' &&
    _generationState !== 'idle' &&
    _generationState !== 'stopping' &&
    _generationState !== 'committing'
  )
    setGenerationState('stopping');
  if (record.controller && !record.controller.signal.aborted) record.controller.abort();
  return true;
}
function cardScriptSendInterceptHostStop() {
  var record = _cardScriptSendIntercept;
  if (!record || record.closed) return false;
  record.cancelled = true;
  if (typeof CardFrontendGenerationCycle === 'object') CardFrontendGenerationCycle.stop(record.live);
  cardScriptSendInterceptReject(record, cardScriptSendInterceptAbortError('已由你停止'));
  cardScriptSendInterceptClose(record);
  if (record.controller && !record.controller.signal.aborted) record.controller.abort();
  return true;
}
function cardScriptSendInterceptDispose(live) {
  var record = _cardScriptSendIntercept;
  if (!record || record.closed || (live && record.live !== live)) return false;
  cardScriptSendInterceptCancel(record.live);
  cardScriptSendInterceptReject(record, cardScriptSendInterceptAbortError('脚本库已停止'));
  return cardScriptSendInterceptClose(record);
}
async function cardScriptSendInterceptApply(record, incoming) {
  if (
    !record ||
    record.closed ||
    record.cancelled ||
    record.deleted ||
    record.writeUsed ||
    !Number.isInteger(record.messageIndex) ||
    record.messageIndex < 0
  )
    return false;
  if (!cardScriptSendInterceptCurrent(record)) throw new Error('发送拦截运行实例或所属对话已变化');
  if (record.preSave === true) {
    var pendingSource = Array.isArray(incoming) ? incoming[record.messageIndex] : null;
    if (!pendingSource || Number(pendingSource.__yeyu_seq) !== 0)
      throw new Error('本轮待发送消息身份已变化，脚本改写被拒绝');
    record.writeUsed = true;
    record.nextContent = String(pendingSource.mes == null ? '' : pendingSource.mes);
    return record.nextContent !== record.originalContent;
  }
  var pair = cardScriptSendInterceptSession(record),
    rows = pair.session.msgs || [],
    message = rows[record.messageIndex],
    source = Array.isArray(incoming) ? incoming[record.messageIndex] : null;
  if (
    record.messageIndex !== rows.length - 1 ||
    !message ||
    message.role !== 'user' ||
    Number(message.seq) !== record.messageSeq ||
    String(message.content || '') !== record.originalContent ||
    !source ||
    Number(source.__yeyu_seq) !== record.messageSeq
  )
    throw new Error('本轮用户消息身份已变化，脚本改写被拒绝');
  record.writeUsed = true;
  var next = String(source.mes == null ? '' : source.mes);
  if (next === record.originalContent) return false;
  message.content = next;
  try {
    await saveData('sessions', { urgent: true });
  } catch (error) {
    message.content = record.originalContent;
    throw new Error('发送拦截正文保存失败，已恢复原文：' + String((error && error.message) || error));
  }
  if (typeof invalidateCacheContexts === 'function')
    invalidateCacheContexts(record.charId, record.messageIndex + 1, true, record.sessionId);
  if (typeof renderChat === 'function') renderChat();
  return true;
}
function cardScriptSendInterceptResult(live, payload) {
  var record = _cardScriptSendIntercept,
    eventId = String((payload && payload.eventId) || '');
  if (!record || record.closed || record.live !== live || record.eventId !== eventId) return false;
  Promise.resolve()
    .then(function () {
      return cardScriptSendInterceptApply(record, payload && payload.chat);
    })
    .then(
      function () {
        record.resolve(record.preSave ? { content: record.nextContent, deleted: record.deleted === true } : true);
      },
      function (error) {
        cardScriptSendInterceptReject(record, error);
      }
    )
    .finally(function () {
      cardScriptSendInterceptClose(record);
    });
  return true;
}
async function cardScriptSendInterceptDelete(live) {
  var record = _cardScriptSendIntercept;
  if (!record || record.closed || record.live !== live) throw new Error('deleteLastMessage 只在当前发送拦截窗口内可用');
  if (!cardScriptSendInterceptCurrent(record)) throw new Error('发送拦截运行实例或所属对话已变化');
  if (record.deleted) throw new Error('本轮用户消息已经删除');
  if (record.preSave === true) {
    record.deleted = true;
    return true;
  }
  if (!Number.isInteger(record.messageIndex) || record.messageIndex < 0)
    throw new Error('当前生成没有可删除的本轮用户消息');
  var pair = cardScriptSendInterceptSession(record),
    rows = pair.session.msgs || [],
    message = rows[record.messageIndex];
  if (
    record.messageIndex !== rows.length - 1 ||
    !message ||
    message.role !== 'user' ||
    Number(message.seq) !== record.messageSeq ||
    String(message.content || '') !== record.originalContent
  )
    throw new Error('只能删除本轮刚提交且尚未变化的用户消息');
  rows.splice(record.messageIndex, 1);
  record.deleted = true;
  try {
    await saveData('sessions', { urgent: true });
  } catch (error) {
    rows.splice(record.messageIndex, 0, message);
    record.deleted = false;
    throw new Error('本轮用户消息删除保存失败，已恢复：' + String((error && error.message) || error));
  }
  if (typeof invalidateCacheContexts === 'function')
    invalidateCacheContexts(record.charId, record.messageIndex, true, record.sessionId);
  if (typeof renderChat === 'function') renderChat();
  if (typeof updateTokensBar === 'function') updateTokensBar(pair.char);
  return true;
}
async function cardScriptLibraryGenerationAfterCommands(target, submittedMessage, pendingContent) {
  var targetChar =
    target && typeof D !== 'undefined' && D && Array.isArray(D.characters)
      ? D.characters.find(function (char) {
          return String((char && char.id) || '') === String(target.charId || '');
        })
      : null;
  if (isRisuCharacter(targetChar)) return false;
  if (typeof completionPresetAwaitRuntime === 'function') await completionPresetAwaitRuntime();
  var live = _cardScriptLibraryLive;
  var readyController =
    typeof abortController !== 'undefined' && abortController && abortController.signal ? abortController : null;
  if (live && live.state !== 'ready')
    if (!(await cardScriptLibraryAwaitReady(live, { signal: readyController && readyController.signal }))) return false;
  var char = live && cardFrontendCharacter(live),
    session = char && cardFrontendSession(char),
    mode = String((target && target.mode) || '');
  if (
    !live ||
    !char ||
    !session ||
    ['new', 'regenerate', 'continue'].indexOf(mode) < 0 ||
    typeof cardScriptSendInterceptGranted !== 'function' ||
    !cardScriptSendInterceptGranted(char)
  )
    return false;
  if (
    String(live.charId || '') !== String(target.charId || '') ||
    String((live.owner && live.owner.sessionId) || '') !== String(target.sessionId || '')
  )
    return false;
  if (_cardScriptSendIntercept) throw new Error('已有发送拦截事件正在处理');
  var rows = session.msgs || [],
    messageIndex = -1,
    messageSeq = 0,
    originalContent = '',
    preSave = typeof pendingContent === 'string';
  if (preSave) {
    messageIndex = rows.length;
    originalContent = String(pendingContent);
  } else if (submittedMessage) {
    messageIndex = rows.indexOf(submittedMessage);
    if (messageIndex !== rows.length - 1 || messageIndex < 0 || submittedMessage.role !== 'user')
      throw new Error('本轮用户消息身份无效，发送拦截未执行');
    messageSeq = Number(submittedMessage.seq) || 0;
    originalContent = String(submittedMessage.content || '');
  }
  var controller =
    typeof abortController !== 'undefined' && abortController && abortController.signal ? abortController : null;
  if (!controller) throw new Error('发送拦截缺少当前生成控制器');
  var record = {
    eventId: 'i' + ++_cardScriptSendInterceptSeq,
    live: live,
    target: target,
    charId: String(target.charId || ''),
    sessionId: String(target.sessionId || ''),
    messageIndex: messageIndex,
    messageSeq: messageSeq,
    originalContent: originalContent,
    nextContent: originalContent,
    preSave: preSave,
    controller: controller,
    cancelled: false,
    deleted: false,
    writeUsed: false,
    closed: false,
    resolve: null,
    reject: null,
    abortListener: null,
  };
  var waiting = new Promise(function (resolve, reject) {
    record.resolve = resolve;
    record.reject = reject;
  });
  record.abortListener = function () {
    record.cancelled = true;
    cardScriptSendInterceptReject(record, cardScriptSendInterceptAbortError('已由你停止'));
  };
  controller.signal.addEventListener('abort', record.abortListener, { once: true });
  _cardScriptSendIntercept = record;
  if (preSave) {
    var virtualSession = Object.assign({}, session, {
      msgs: rows.concat([{ role: 'user', content: originalContent, time: Date.now(), seq: 0 }]),
    });
    refreshCardScriptLibraryContext(char, virtualSession);
  } else refreshCardScriptLibraryContext(char, session);
  var type = mode === 'regenerate' ? 'regenerate' : mode === 'continue' ? 'continue' : 'normal',
    sent = cardFrontendSend(live, 'sillyTavernEvent', {
      name: CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_AFTER_COMMANDS,
      args: [type, {}, false],
      eventId: record.eventId,
    });
  if (!sent) {
    cardScriptSendInterceptClose(record);
    return false;
  }
  target.cardFrontendAfterCommandsEmitted = true;
  try {
    return await cardFrontendAwaitEvent(
      live,
      function () {
        return waiting;
      },
      {
        signal: controller.signal,
        label: '发送拦截事件 ' + CARD_FRONTEND_TAVERN_EVENT_VALUES.GENERATION_AFTER_COMMANDS,
      }
    );
  } finally {
    cardScriptSendInterceptClose(record);
  }
}
function cardScriptLibrarySillyTavernEmit(name, args) {
  var live = _cardScriptLibraryLive,
    event = { name: String(name || ''), args: Array.isArray(args) ? args : [] };
  if (!live || isRisuCharacter(cardFrontendCharacter(live))) return false;
  if (live.state !== 'ready') {
    (live.sillyTavernPending = live.sillyTavernPending || []).push(event);
    return true;
  }
  return cardFrontendSend(live, 'sillyTavernEvent', event);
}
function cardScriptLibraryAwaitReady(live, options) {
  live = live || _cardScriptLibraryLive;
  if (!live) return Promise.resolve(null);
  options = options || {};
  if (live.state === 'ready') return Promise.resolve(live);
  return cardFrontendAwaitWithTimeout(live.readyPromise, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    label: '脚本库就绪',
  }).then(function (ready) {
    if (ready !== live || live !== _cardScriptLibraryLive || live.state !== 'ready')
      throw new Error('脚本库在载入期间已停止');
    return live;
  });
}
async function cardScriptLibrarySillyTavernEmitAsync(name, args, live, options) {
  live = live || _cardScriptLibraryLive;
  if (!live || isRisuCharacter(cardFrontendCharacter(live))) return false;
  options = options || {};
  if (!(await cardScriptLibraryAwaitReady(live, options))) return false;
  // A library which is already ready resolves without touching the signal, so a stopped
  // generation must be caught here instead of delivering one more event to the card.
  if (options.signal && options.signal.aborted) throw cardFrontendAbortError('脚本库事件 ' + String(name || ''));
  var eventId = 'e' + ++_cardScriptEventSeq,
    waiting = new Promise(function (resolve, reject) {
      // eventId plus the dispatching frame already identify the receipt; no other owner
      // fields take part in routing it back.
      _cardScriptEventWaiters.set(eventId, { live: live, resolve: resolve, reject: reject });
    });
  if (
    !cardFrontendSend(live, 'sillyTavernEvent', {
      name: String(name || ''),
      args: Array.isArray(args) ? args : [],
      eventId: eventId,
    })
  ) {
    _cardScriptEventWaiters.delete(eventId);
    return false;
  }
  try {
    await cardFrontendAwaitEvent(
      live,
      function () {
        return waiting;
      },
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        label: '脚本库事件 ' + String(name || ''),
      }
    );
  } catch (error) {
    if (options.signal && options.signal.aborted) cardFrontendCancelEventOwner(live);
    throw error;
  } finally {
    _cardScriptEventWaiters.delete(eventId);
  }
  return true;
}
// MESSAGE_RECEIVED reaches every listener of the chat the reply was committed to. A resident library
// of that chat first sees the reply in its SillyTavern.chat and, while it is still starting, is waited
// for so its scripts hear the event too.
async function cardFrontendMessageReceived(target, options) {
  var index = target && target.index;
  if (!Number.isInteger(index) || index < 0) return false;
  var char = typeof getChar === 'function' ? getChar() : null,
    session = char && cardFrontendSession(char);
  if (
    !char ||
    !session ||
    isRisuCharacter(char) ||
    String(char.id || '') !== String(target.charId || '') ||
    String(session.id || '') !== String(target.sessionId || '')
  )
    return false;
  var live = _cardScriptLibraryLive;
  if (
    live &&
    String(live.charId || '') === String(char.id || '') &&
    String((live.owner && live.owner.sessionId) || '') === String(session.id || '')
  ) {
    try {
      await cardScriptLibraryAwaitReady(live, options);
    } catch (error) {
      if (options && options.signal && options.signal.aborted) throw error;
    }
    refreshCardScriptLibraryContext(char, session);
  }
  await cardFrontendAwaitBroadcastEvent(
    CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_RECEIVED,
    [index, typeof generationTypeForTarget === 'function' ? generationTypeForTarget(target) : 'normal'],
    options
  );
  return true;
}
function cardScriptLibraryGenerationCommitted(target) {
  var index = target && target.cardScriptLibraryCommittedMessageIndex;
  if (!Number.isInteger(index) || index < 0) return false;
  delete target.cardScriptLibraryCommittedMessageIndex;
  var live = _cardScriptLibraryLive;
  if (
    !live ||
    String(live.charId || '') !== String(target.charId || '') ||
    String((live.owner && live.owner.sessionId) || '') !== String(target.sessionId || '')
  )
    return false;
  var char = cardFrontendCharacter(live),
    session = char && cardFrontendSession(char);
  if (!char || isRisuCharacter(char) || !session) return false;
  return refreshCardScriptLibraryContext(char, session);
}
function syncCardScriptLibrary(char) {
  var target = char || (typeof getChar === 'function' ? getChar() : null),
    scan = target ? cardScriptLibraryScan(target) : { active: [] },
    signature = target ? cardScriptLibrarySignature(target) : '',
    owner = target && cardScriptLibraryOwner(target),
    page = owner ? [owner.charId, owner.sessionId, signature].join('|') : '';
  if (!target || !scan.active.length || !cardFrontendReady(target) || !owner) {
    cardScriptLibraryDispose();
    return null;
  }
  if (_cardScriptLibraryStopped[String(target.id || '')] === signature) {
    cardScriptLibraryDispose();
    return null;
  }
  if (
    _cardScriptLibraryLive &&
    _cardScriptLibraryLive.key === page &&
    _cardScriptLibraryLive.frame &&
    _cardScriptLibraryLive.frame.isConnected
  ) {
    refreshCardScriptLibraryContext(target, cardFrontendSession(target));
    return _cardScriptLibraryLive;
  }
  cardScriptLibraryDispose();
  return cardScriptLibraryMount(target, scan, page);
}
function openCurrentCardScriptLibrary() {
  var live = syncCardScriptLibrary(typeof getChar === 'function' ? getChar() : null);
  if (!live) {
    if (typeof toast === 'function')
      toast(
        cardScriptLibraryStatus().kind === 'awaiting-greeting'
          ? '选定开场白后脚本库才会启动'
          : '这张卡没有可打开的常驻脚本，或卡片脚本尚未开启',
        'info'
      );
    return false;
  }
  showModalSurface(live.shell.id);
  live.frame.focus();
  return true;
}
function closeCurrentCardScriptLibrary() {
  if (!_cardScriptLibraryLive) return false;
  hideModalSurface(_cardScriptLibraryLive.shell.id);
  return true;
}
function stopCardScriptLibrary(char) {
  var target = char || (typeof getChar === 'function' ? getChar() : null);
  if (!target) return false;
  _cardScriptLibraryStopped[String(target.id || '')] = cardScriptLibrarySignature(target);
  return _cardScriptLibraryLive && _cardScriptLibraryLive.charId === String(target.id || '')
    ? cardScriptLibraryDispose()
    : false;
}
function resumeCardScriptLibrary(char) {
  var target = char || (typeof getChar === 'function' ? getChar() : null);
  if (!target) return false;
  delete _cardScriptLibraryStopped[String(target.id || '')];
  return !!syncCardScriptLibrary(target);
}
// One dead script is recorded against its own row. The library keeps its state, so the scripts that
// are still running answer generation events and a send is never held back by a neighbour's failure.
function cardScriptLibraryRecordScriptFailure(live, id, name, message) {
  if (!live) return false;
  var scriptId = String(id || '');
  if (!scriptId) return false;
  var rows = Array.isArray(live.scriptFailures) ? live.scriptFailures : (live.scriptFailures = []),
    known = (live.scripts || []).find(function (row) {
      return String((row && row.id) || '') === scriptId;
    }),
    label = String(name || (known && known.name) || '未命名脚本'),
    text = String(message || '脚本运行出错'),
    existing = rows.find(function (row) {
      return String(row.id || '') === scriptId;
    });
  if (existing && existing.message === text) return false;
  if (existing) {
    existing.name = label;
    existing.message = text;
  } else rows.push({ id: scriptId, name: label, message: text });
  return true;
}
function cardScriptLibraryStatus(char) {
  var target = char || (typeof getChar === 'function' ? getChar() : null),
    scan = target ? cardScriptLibraryScan(target) : { active: [] };
  if (!scan.active.length) return { kind: 'none', label: '没有启用的脚本库' };
  if (!cardFrontendReady(target)) return { kind: 'disabled', label: '卡片脚本未开启' };
  if (_cardScriptLibraryStopped[String(target.id || '')] === cardScriptLibrarySignature(target))
    return { kind: 'stopped', label: '已停止，可重新开启' };
  if (!cardScriptLibraryOwner(target)) return { kind: 'awaiting-greeting', label: '选定开场白后启动' };
  var live =
    _cardScriptLibraryLive && _cardScriptLibraryLive.charId === String(target.id || '') ? _cardScriptLibraryLive : null;
  if (!live) return { kind: 'idle', label: '等待进入当前对话' };
  var failures = (Array.isArray(live.scriptFailures) ? live.scriptFailures : []).map(function (row) {
    return { id: String(row.id || ''), name: String(row.name || ''), message: String(row.message || '') };
  });
  return {
    kind: live.state,
    label:
      (live.state === 'ready' ? '常驻运行中' : live.state === 'failed' ? '启动失败' : '正在载入') +
      (failures.length ? '（' + failures.length + ' 段脚本失败）' : ''),
    error: live.lastError || '',
    failures: failures,
  };
}
// ---- visibility scheduling ----
// Only the frontends around the reading position run. Everything else keeps an equal-height
// placeholder that starts on its own once the reader scrolls near it.
function cardFrontendChatHost() {
  return typeof document !== 'undefined' ? document.getElementById('chat-messages') : null;
}
function cardFrontendMarkUsed(key) {
  var id = String(key || '');
  if (!id) return 0;
  _cardFrontendUsed.delete(id);
  _cardFrontendUsed.set(id, ++_cardFrontendUseSeq);
  while (_cardFrontendUsed.size > CARD_FRONTEND_KEY_MEMORY_LIMIT)
    _cardFrontendUsed.delete(_cardFrontendUsed.keys().next().value);
  return _cardFrontendUseSeq;
}
// The message row closest to the middle of the chat viewport, found by bisection so a long chat
// costs a handful of geometry reads instead of one per placeholder.
function cardFrontendCenterMessageIndex(host) {
  var rows = host ? host.querySelectorAll('.msg[data-msg-idx]') : null;
  if (!rows || !rows.length) return null;
  var hostRect = host.getBoundingClientRect(),
    center = hostRect.top + hostRect.height / 2,
    low = 0,
    high = rows.length - 1,
    best = 0;
  while (low <= high) {
    var middle = (low + high) >> 1,
      rect = rows[middle].getBoundingClientRect();
    best = middle;
    if (center < rect.top) high = middle - 1;
    else if (center > rect.bottom) low = middle + 1;
    else break;
  }
  return Math.max(0, Math.floor(Number(rows[best].getAttribute('data-msg-idx')) || 0));
}
function cardFrontendCandidates(host) {
  var center = cardFrontendCenterMessageIndex(host),
    rows = [];
  if (!host) return rows;
  Array.prototype.forEach.call(host.querySelectorAll('.yeyu-card-frontend[data-frontend-key]'), function (node, order) {
    var key = String(node.getAttribute('data-frontend-key') || '');
    // A frontend the reader stopped by hand stays stopped and is never picked up by the scheduler.
    if (!key || _cardFrontendStopped[key]) return;
    var row = node.closest('[data-msg-idx]'),
      source = _cardFrontendSource.get(key),
      // The streaming draft has no row index yet; its owner already names the slot it will take, so
      // the reply being written ranks as the newest message and stays pinned while it grows.
      index = row
        ? Math.max(0, Math.floor(Number(row.getAttribute('data-msg-idx')) || 0))
        : Math.max(0, Math.floor(Number(source && source.owner && source.owner.messageIndex) || 0)),
      live = _cardFrontendLive.get(key);
    rows.push({
      key: key,
      node: node,
      index: index,
      order: order,
      distance: center == null ? order : Math.abs(index - center),
      usedAt: Number(_cardFrontendUsed.get(key)) || 0,
      live: live && live.node === node && live.frame && live.frame.isConnected ? live : null,
    });
  });
  return rows;
}
// Desirability order: the nearest frontends first, then the ones the reader used most recently.
function cardFrontendKeepOrder(rows) {
  var byDistance = rows.slice().sort(function (left, right) {
      return left.distance - right.distance || right.usedAt - left.usedAt || left.order - right.order;
    }),
    near = byDistance.slice(0, CARD_FRONTEND_NEAR_KEEP),
    taken = new Set(
      near.map(function (row) {
        return row.key;
      })
    ),
    rest = byDistance
      .filter(function (row) {
        return !taken.has(row.key);
      })
      .sort(function (left, right) {
        return right.usedAt - left.usedAt || left.distance - right.distance || left.order - right.order;
      });
  return near.concat(rest);
}
function cardFrontendNodeOnScreen(node) {
  var host = cardFrontendChatHost();
  if (!host || !node || !node.isConnected) return false;
  var hostRect = host.getBoundingClientRect(),
    rect = node.getBoundingClientRect();
  return rect.bottom > hostRect.top && rect.top < hostRect.bottom;
}
// Retiring a frontend loses whatever it was doing, so the ones the reader can see, is touching, has
// opened full screen, or that are waiting on their own generation keep running whatever the ranking
// says. They still occupy a slot, so the limit stays a real ceiling.
function cardFrontendRetirable(row) {
  var live = row && row.live;
  if (!live) return false;
  if (live.fullscreenActive || live.fullscreenMode || live.fullscreenRequestPending) return false;
  if (live.interactionViewport) return false;
  if (
    typeof _cardFrontendGenerations !== 'undefined' &&
    _cardFrontendGenerations &&
    Array.from(_cardFrontendGenerations.values()).some(function (run) {
      return run && run.live === live;
    })
  )
    return false;
  return !cardFrontendNodeOnScreen(row.node);
}
function cardFrontendClearPending(node) {
  if (!node) return;
  if (_cardFrontendPendingShown) _cardFrontendPendingShown.delete(node);
  node.removeAttribute('data-frontend-pending');
  var hint = node.querySelector('.yeyu-card-frontend-pending');
  if (hint) hint.remove();
}
function cardFrontendHostWidth() {
  var host = cardFrontendChatHost();
  return host ? Math.max(0, Math.floor(Number(host.clientWidth) || 0)) : 0;
}
// True when this node is already showing the placeholder it would be given again: same slot, same
// height memory and same chat width. Answering from bookkeeping keeps a repaint from measuring and
// rewriting every placeholder of a long chat.
function cardFrontendPendingUpToDate(node, key, hostWidth) {
  var shown = _cardFrontendPendingShown && _cardFrontendPendingShown.get(node);
  return !!(
    shown &&
    shown.key === key &&
    shown.revision === _cardFrontendHeightRevision &&
    shown.hostWidth === hostWidth &&
    node.hasAttribute('data-frontend-pending') &&
    node.querySelector('.yeyu-card-frontend-pending')
  );
}
// `hostWidth` lets a caller about to show many placeholders read the chat width once instead of once
// per placeholder; leaving it out reads it here.
function cardFrontendShowPending(node, key, hostWidth) {
  var slot = node && node.querySelector('.yeyu-card-frontend-slot');
  if (!slot) return 0;
  node.setAttribute('data-frontend-pending', '');
  cardFrontendNote(node, '', 'info');
  cardFrontendToggleButtons(node, true);
  var hint = slot.querySelector('.yeyu-card-frontend-pending');
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'yeyu-card-frontend-pending';
    hint.textContent = '卡片内容 · 滚动到此处时自动加载';
    slot.replaceChildren(hint);
  }
  var measured = hostWidth === undefined ? cardFrontendHostWidth() : Math.max(0, Math.floor(Number(hostWidth) || 0)),
    remembered = cardFrontendPlaceholderReservedHeight(key, measured),
    height = remembered > 0 ? remembered : CARD_FRONTEND_PLACEHOLDER_HEIGHT;
  if (hint.style.height !== height + 'px') hint.style.height = height + 'px';
  if (_cardFrontendPendingShown)
    _cardFrontendPendingShown.set(node, { key: key, revision: _cardFrontendHeightRevision, hostWidth: measured });
  return height;
}
// The placeholder takes the height the frame had, so the rows below it do not move. Only a frontend
// whose remembered height no longer matches needs the reading position put back.
function cardFrontendRetire(row) {
  var live = row && row.live;
  if (!live) return false;
  // The whole block is what the rows below sit on, not just the frame box: a running frontend also
  // carries its note line, which the placeholder does not. Comparing frame heights alone let that
  // difference move the chat with no compensation at all.
  var before = row.node && row.node.isConnected ? row.node.getBoundingClientRect().height : 0,
    layout = before > 0 ? captureChatViewportLayout() : null,
    growth = captureChatViewportBlock(row.node);
  // Only a height the frame actually reported is worth remembering; the box a frame that never
  // laid out was holding is the placeholder estimate, not its content.
  if (live.heightReady)
    cardFrontendRememberHeight(row.key, live.contentHeight, live.normalGeometry && live.normalGeometry.width);
  cardFrontendDispose(row.key);
  if (_cardFrontendMountingKey === row.key) cardFrontendReleaseMountGate(false);
  cardFrontendShowPending(row.node, row.key);
  var after = row.node && row.node.isConnected ? row.node.getBoundingClientRect().height : 0;
  if (layout && Math.abs(after - before) >= 1 && !compensateChatViewportGrowth(growth))
    restoreChatViewportLayout(layout);
  return true;
}
function cardFrontendStart(char, row) {
  if (!row || !row.node || !row.node.isConnected) return false;
  cardFrontendMount(char, row.node, row.key);
  var live = _cardFrontendLive.get(row.key);
  if (!live) return false;
  cardFrontendMarkUsed(row.key);
  return true;
}
function cardFrontendReleaseMountGate(reschedule) {
  if (_cardFrontendMountTimer) clearTimeout(_cardFrontendMountTimer);
  _cardFrontendMountTimer = 0;
  _cardFrontendMountingKey = '';
  if (reschedule !== false) cardFrontendScheduleFrames();
}
function cardFrontendHoldMountGate(key) {
  _cardFrontendMountingKey = String(key || '');
  if (_cardFrontendMountTimer) clearTimeout(_cardFrontendMountTimer);
  _cardFrontendMountTimer = setTimeout(function () {
    _cardFrontendMountTimer = 0;
    _cardFrontendMountingKey = '';
    cardFrontendScheduleFrames();
  }, CARD_FRONTEND_MOUNT_STEP_MS);
}
function cardFrontendScheduleFrames() {
  if (_cardFrontendScheduleQueued || typeof document === 'undefined') return;
  _cardFrontendScheduleQueued = true;
  var run = function () {
    _cardFrontendScheduleQueued = false;
    cardFrontendRunScheduler(null);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}
function cardFrontendNoteChatScroll() {
  _cardFrontendScrolling = true;
  if (_cardFrontendScrollIdleTimer) clearTimeout(_cardFrontendScrollIdleTimer);
  _cardFrontendScrollIdleTimer = setTimeout(function () {
    _cardFrontendScrollIdleTimer = 0;
    _cardFrontendScrolling = false;
    cardFrontendRunScheduler(null);
  }, CARD_FRONTEND_SCROLL_IDLE_MS);
}
// One pass: keep the newest card running, retire what fell outside the limit, then start the single
// best missing frontend. Starting one at a time is what keeps a burst of frames off the main thread;
// the next one follows as soon as this one reports its height or the step budget expires.
function cardFrontendRunScheduler(char, pinnedOnly) {
  var host = cardFrontendChatHost();
  if (!host) return;
  var target = char || (typeof getChar === 'function' ? getChar() : null);
  if (!target || isRisuCharacter(target)) return;
  var rows = cardFrontendCandidates(host);
  if (!rows.length) return;
  var pinnedIndex = rows[rows.length - 1].index,
    pinned = [],
    rest = [];
  rows.forEach(function (row) {
    (row.index === pinnedIndex ? pinned : rest).push(row);
  });
  pinned.forEach(function (row) {
    if (!row.live && cardFrontendStart(target, row)) cardFrontendHoldMountGate(row.key);
  });
  // While a frontend is still starting, the rows below it have not taken their final places yet —
  // and the render that produced them has not finished restoring the reading position either. Both
  // make distances provisional, so nothing is started or retired on that geometry.
  if (pinnedOnly || _cardFrontendScrolling) return;
  if (_cardFrontendMountingKey && _cardFrontendLive.has(_cardFrontendMountingKey)) return;
  var keep = cardFrontendKeepOrder(rest),
    allowed = new Set(
      keep.slice(0, CARD_FRONTEND_LIVE_LIMIT).map(function (row) {
        return row.key;
      })
    );
  rest.forEach(function (row) {
    if (allowed.has(row.key) || !cardFrontendRetirable(row)) return;
    cardFrontendRetire(row);
    row.live = null;
  });
  var next = keep.slice(0, CARD_FRONTEND_LIVE_LIMIT).find(function (row) {
    return !row.live;
  });
  if (next && cardFrontendStart(target, next)) cardFrontendHoldMountGate(next.key);
}
function cardFrontendMount(char, node, key) {
  var record = _cardFrontendSource.get(key),
    slot = node.querySelector('.yeyu-card-frontend-slot');
  if (!slot) return;
  cardFrontendClearPending(node);
  if (!record) {
    cardFrontendNote(node, '这段卡片前端的内容已经失效，重新打开对话后会重新生成。', 'err');
    cardFrontendToggleButtons(node, false);
    return;
  }
  if (!cardFrontendReady(char)) {
    slot.replaceChildren();
    cardFrontendNote(node, '卡片前端未运行：请在「卡片」设置里开启这张卡的脚本。', 'info');
    cardFrontendToggleButtons(node, false);
    return;
  }
  var token = 'f' + ++_cardFrontendSeq + '_' + cardFrontendHash(key + ':' + _cardFrontendSeq),
    canvas = document.createElement('div'),
    range = document.createElement('div'),
    frame = document.createElement('iframe');
  canvas.className = 'yeyu-card-frontend-canvas';
  range.className = 'yeyu-card-frontend-scroll-range';
  frame.className = 'yeyu-card-frontend-frame';
  frame.setAttribute('scrolling', 'auto');
  frame.setAttribute('title', '卡片前端');
  frame.id = frame.name =
    'TH-message--' +
    Math.max(0, Math.floor(Number(record.owner && record.owner.messageIndex) || 0)) +
    '--' +
    _cardFrontendSeq;
  frame.style.height = '1px';
  canvas.appendChild(range);
  canvas.appendChild(frame);
  slot.replaceChildren(canvas);
  var mounted = {
    key: key,
    node: node,
    slot: slot,
    canvas: canvas,
    scrollRange: range,
    frame: frame,
    token: token,
    owner: record.owner,
    charId: String((char && char.id) || ''),
    heightReady: false,
    contentHeight: 0,
    appliedHeight: 1,
    normalGeometry: null,
    normalHostStyleSnapshot: null,
    interactionViewport: null,
    heightWaiters: [],
    fullscreenMode: '',
    fullscreenActive: false,
    fullscreenContentSize: { width: 0, height: 0 },
    fullscreenHostScrollTop: null,
    fullscreenHostScrollTimer: 0,
    fullscreenRequestId: 0,
    fullscreenRequestPending: false,
  };
  _cardFrontendLive.set(key, mounted);
  cardFrontendApplyHostContainerStyles(mounted, false);
  var width = cardFrontendMeasureNormalGeometry(mounted).width,
    reserved = cardFrontendReservedHeight(key, width);
  // Start from the box the placeholder already occupied — the remembered height, or the same modest
  // estimate — so mounting does not push the rows below it around before the real height arrives.
  mounted.contentHeight = reserved > 0 ? reserved : CARD_FRONTEND_PLACEHOLDER_HEIGHT;
  mounted.heightReady = reserved > 0;
  cardFrontendApplyNormalGeometry(mounted, 0, false);
  mounted.normalHostStyleSnapshot = cardFrontendHostStyleSnapshot(mounted);
  canvas.addEventListener(
    'scroll',
    function () {
      var live = _cardFrontendLive.get(key);
      if (live) cardFrontendSyncFullscreenViewport(live);
    },
    { passive: true }
  );
  if (_cardFrontendLayoutObserver)
    try {
      _cardFrontendLayoutObserver.observe(node);
    } catch (_) {}

  cardFrontendNote(node, '', 'info');
  cardFrontendToggleButtons(node, true);
  frame.srcdoc = cardFrontendDocument(record.html, token, mounted.normalGeometry.viewportHeight);
  // Swapping the placeholder box for a frame moves the list, and the scroll that follows arrives a
  // task later — by then the content is back to its old size, so a bottom follow comparing against
  // the position it wrote before the swap would read the browser's own clamp as the reader taking
  // over. Re-pinning writes the bottom again and re-notes the numbers the next scroll is judged by.
  cardFrontendRepinChatBottom();
}
function syncCardFrontends(char) {
  var target = char || (typeof getChar === 'function' ? getChar() : null);
  if (syncCardFrontendSlots(target)) syncCardScriptLibrary(target);
  // The render that opened a newly created chat has announced it.
  _cardFrontendCreatedPage = '';
}
// Reconciles the message frontends on the page and nothing else. A stream repaint calls this alone:
// the reply is not in the chat until it commits, so pushing the chat to the script library on every
// paint would hand it the same state again; the commit's own render brings the library up to date.
// Returns whether the card runs SillyTavern frontends at all.
function syncCardFrontendSlots(char) {
  if (typeof document === 'undefined') return false;
  cardFrontendBind();
  var target = char || (typeof getChar === 'function' ? getChar() : null),
    host = document.getElementById('chat-messages'),
    nodes = host ? Array.prototype.slice.call(host.querySelectorAll('.yeyu-card-frontend[data-frontend-key]')) : [],
    present = Object.create(null),
    pending = [];
  if (isRisuCharacter(target)) {
    releaseCardFrontends();
    return false;
  }
  // Whether this card may run frontends, which session it is in and how wide the chat is are the
  // same for every slot on the page. Asking per slot made one repaint of a long chat repeat the
  // card's whole script scan once per placeholder.
  var ready = cardFrontendReady(target),
    session = cardFrontendSession(target),
    hostWidth = host ? Math.max(0, Math.floor(Number(host.clientWidth) || 0)) : 0;
  nodes.forEach(function (node) {
    var key = String(node.getAttribute('data-frontend-key') || '');
    if (!key) return;
    present[key] = true;
    var live = _cardFrontendLive.get(key);
    if (live && live.node === node && live.frame && live.frame.isConnected) {
      var source = _cardFrontendSource.get(key);
      if (source) live.owner = source.owner;
      live.frame.id = live.frame.name = live.frame.id.replace(
        /^TH-message--\d+--/,
        'TH-message--' + live.owner.messageIndex + '--'
      );
      cardFrontendSend(live, 'context', cardFrontendConfig(target, session, live.owner, live.token));
      return;
    }
    if (live) cardFrontendDispose(key);
    if (_cardFrontendStopped[key]) {
      cardFrontendClearPending(node);
      cardFrontendNote(node, '这段卡片前端已停止。', 'info');
      cardFrontendToggleButtons(node, false);
      return;
    }
    // A frontend with no content or a card whose components are off says so in place; everything
    // else waits for the scheduler, which decides what runs around the reading position.
    if (!_cardFrontendSource.get(key) || !ready) cardFrontendMount(target, node, key);
    else if (!cardFrontendPendingUpToDate(node, key, hostWidth)) pending.push({ node: node, key: key });
  });
  pending.forEach(function (row) {
    cardFrontendShowPending(row.node, row.key, hostWidth);
  });
  Array.from(_cardFrontendLive.keys()).forEach(function (key) {
    if (!present[key]) cardFrontendDispose(key);
  });
  Array.from(_cardFrontendSource.keys()).forEach(function (key) {
    if (!present[key]) _cardFrontendSource.delete(key);
  });
  var page = String((target && target.id) || '') + '|' + String((session && session.id) || '');
  if (page !== _cardFrontendPage) {
    if (typeof generationPromptInvalidateNetwork === 'function') generationPromptInvalidateNetwork();
    _cardFrontendPage = page;
    cardFrontendEmitInOrder(cardFrontendChatOpenedEvents(target, session));
  }
  // The newest card keeps running through every repaint. The rest is decided one frame later, once
  // this render's reading position has been restored and the distances are the real ones.
  cardFrontendRunScheduler(target, true);
  cardFrontendScheduleFrames();
  return true;
}
function releaseCardFrontendsForMessageRender(char, start, messageIndexes) {
  var target = char || (typeof getChar === 'function' ? getChar() : null),
    session = target && cardFrontendSession(target),
    charId = String((target && target.id) || ''),
    sessionId = String((session && session.id) || ''),
    first = Math.max(0, Math.floor(Number(start) || 0)),
    exact = Array.isArray(messageIndexes)
      ? new Set(
          messageIndexes.map(function (value) {
            return Math.max(0, Math.floor(Number(value) || 0));
          })
        )
      : null,
    released = 0;
  if (!charId || !sessionId) return released;
  Array.from(_cardFrontendLive.keys()).forEach(function (key) {
    var live = _cardFrontendLive.get(key),
      owner = live && live.owner,
      index = Math.max(0, Math.floor(Number(owner && owner.messageIndex) || 0));
    if (
      !live ||
      String(live.charId || '') !== charId ||
      String((owner && owner.sessionId) || '') !== sessionId ||
      (exact ? !exact.has(index) : index < first)
    )
      return;
    if (cardFrontendDispose(key)) released++;
  });
  return released;
}
function stopCardFrontend(key) {
  var selector =
      window.CSS && typeof CSS.escape === 'function'
        ? '.yeyu-card-frontend[data-frontend-key="' + CSS.escape(String(key)) + '"]'
        : '',
    live = _cardFrontendLive.get(key),
    node =
      (live && live.node) ||
      (selector
        ? document.querySelector(selector)
        : Array.prototype.slice.call(document.querySelectorAll('.yeyu-card-frontend')).filter(function (row) {
            return row.getAttribute('data-frontend-key') === String(key);
          })[0]);
  _cardFrontendStopped[key] = true;
  cardFrontendDispose(key);
  if (node) {
    cardFrontendClearPending(node);
    cardFrontendNote(node, '这段卡片前端已停止。', 'info');
    cardFrontendToggleButtons(node, false);
  }
  return true;
}
function resumeCardFrontend(key) {
  delete _cardFrontendStopped[key];
  // Reloading by hand is the strongest "I am using this one" there is: it must not be the first
  // frontend the limit gives up.
  cardFrontendMarkUsed(key);
  syncCardFrontends(typeof getChar === 'function' ? getChar() : null);
  return true;
}
function releaseCardFrontends(charId) {
  var keep = String(charId || ''),
    released = 0;
  Array.from(_cardFrontendLive.keys()).forEach(function (key) {
    var live = _cardFrontendLive.get(key);
    if (live && keep && live.charId === keep) return;
    if (cardFrontendDispose(key)) released++;
  });
  // A stop decision belongs to the frontend that is on screen; keys for other characters would
  // otherwise pile up and make a later identical block start out stopped.
  Object.keys(_cardFrontendStopped).forEach(function (key) {
    if (!keep || key.indexOf(keep + '|') !== 0) delete _cardFrontendStopped[key];
  });
  if (!keep) _cardFrontendSource.clear();
  if (_cardScriptLibraryLive && (!keep || _cardScriptLibraryLive.charId !== keep)) cardScriptLibraryDispose();
  return released;
}
function stopAllCardFrontends(char) {
  var keep = String((char && char.id) || ''),
    stopped = 0;
  Array.from(_cardFrontendLive.keys()).forEach(function (key) {
    var live = _cardFrontendLive.get(key);
    if (!live || (keep && live.charId !== keep)) return;
    stopCardFrontend(key);
    stopped++;
  });
  return stopped;
}
function cardFrontendEventName(name) {
  var key = String(name == null ? '' : name);
  return CARD_FRONTEND_IFRAME_EVENT_VALUES[key] || CARD_FRONTEND_TAVERN_EVENT_VALUES[key] || key;
}
function cardFrontendEventArguments(name, args) {
  var key = cardFrontendEventName(name),
    values = Array.isArray(args) ? args : [],
    integerEvents = [
      CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SWIPED,
      CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_SENT,
      CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_RECEIVED,
      CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_EDITED,
      CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_UPDATED,
      CARD_FRONTEND_TAVERN_EVENT_VALUES.USER_MESSAGE_RENDERED,
      CARD_FRONTEND_TAVERN_EVENT_VALUES.CHARACTER_MESSAGE_RENDERED,
    ];
  if (integerEvents.indexOf(key) < 0) return { key: key, args: values };
  var index = parseInt(values[0], 10);
  if (!Number.isInteger(index)) return null;
  var normalized = values.slice();
  normalized[0] = index;
  return { key: key, args: normalized };
}
function cardFrontendRegisterEvent(live, name, handler, once, position) {
  var key = cardFrontendEventName(name);
  if (!key || typeof handler !== 'function') throw new Error('事件监听需要事件名和函数');
  var matches = function (row) {
      return row.live === live && row.name === key && row.handler === handler;
    },
    existing = _cardFrontendEventListeners.some(matches);
  if (position === 'first' || position === 'last')
    _cardFrontendEventListeners = _cardFrontendEventListeners.filter(function (row) {
      return !matches(row);
    });
  else if (existing) return false;
  var record = { live: live, name: key, handler: handler, once: once === true };
  if (position === 'first') _cardFrontendEventListeners.unshift(record);
  else _cardFrontendEventListeners.push(record);
  return true;
}
function cardFrontendRemoveEvent(live, name, handler) {
  var key = cardFrontendEventName(name),
    before = _cardFrontendEventListeners.length;
  _cardFrontendEventListeners = _cardFrontendEventListeners.filter(function (row) {
    return !(row.live === live && row.name === key && row.handler === handler);
  });
  return before !== _cardFrontendEventListeners.length;
}
function cardFrontendClearEvent(live, name) {
  var key = cardFrontendEventName(name);
  _cardFrontendEventListeners = _cardFrontendEventListeners.filter(function (row) {
    return row.live !== live || row.name !== key;
  });
}
function cardFrontendClearListener(live, handler) {
  _cardFrontendEventListeners = _cardFrontendEventListeners.filter(function (row) {
    return row.live !== live || row.handler !== handler;
  });
}
function cardFrontendClearOwnerRegistrations(live) {
  if (typeof hostPromptReleaseOwner === 'function') hostPromptReleaseOwner(live);
  _cardFrontendEventListeners = _cardFrontendEventListeners.filter(function (row) {
    return row.live !== live;
  });
  _cardFrontendEventRuns.forEach(function (entry, source) {
    if (entry.live === live) _cardFrontendEventRuns.delete(source);
  });
  _cardFrontendMacroLikes = _cardFrontendMacroLikes.filter(function (row) {
    return row.live !== live;
  });
}
function cardFrontendReportEventError(live, error, name, showToast) {
  if (typeof console !== 'undefined' && console.error) console.error(error);
  if (!live) return;
  var message = '事件 ' + String(name || '') + ' 处理失败：' + String((error && error.message) || error || '未知错误');
  if (live.kind === 'library') {
    var changed = live.lastError !== message;
    live.lastError = message;
    if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(cardFrontendCharacter(live));
    if (showToast !== false && (changed || showToast === true) && typeof toast === 'function')
      toast('卡片脚本运行失败：' + message, 'err');
  } else if (live.node) cardFrontendNote(live.node, '卡片前端报错：' + message, 'err');
}
function cardFrontendCancelEventOwner(live) {
  if (!live || live.cancelled) return;
  // Async JavaScript continuations cannot be individually revoked. Retire their host identity
  // so an old callback cannot acquire the next run's write authority after it resumes.
  live.cancelled = true;
  if (live.kind === 'library' && _cardScriptLibraryLive === live) cardScriptLibraryDispose();
  else if (_cardFrontendLive.get(live.key) === live) cardFrontendRetire({ live: live, key: live.key, node: live.node });
  else {
    cardFrontendClearOwnerRegistrations(live);
    live.state = 'disposed';
  }
  Promise.resolve().then(function () {
    var target = typeof getChar === 'function' ? getChar() : null,
      session = target && typeof getActiveSession === 'function' ? getActiveSession(target.id) : null;
    if (
      !target ||
      !session ||
      String(target.id || '') !== String(live.charId || '') ||
      String(session.id || '') !== String((live.owner && live.owner.sessionId) || '')
    )
      return;
    if (live.kind === 'library') syncCardScriptLibrary(target);
    else cardFrontendScheduleFrames();
  });
}
// A message frame hears the render of its own message once. The broadcast after a render and the
// catch-up a frame does for itself once its scripts ran (cardFrontendDeliverOwnRender) name the same render
// while the message is unchanged, so whichever reaches the frame first claims it; a changed message
// is a new render and is delivered again.
function cardFrontendOwnRenderKey(live, eventKey, index) {
  if (!live || live.kind === 'library' || !live.owner || live.owner.pendingCommit === true) return '';
  var session = cardFrontendOwnedSession(live),
    rows = session && Array.isArray(session.msgs) ? session.msgs : [],
    message = rows[index];
  if (!message || Number(message.seq) !== Number(live.owner.messageSeq)) return '';
  return [eventKey, index, Number(message.seq) || 0, cardFrontendHash(message.content)].join('|');
}
function cardFrontendClaimOwnRenders(rows, normalized) {
  if (
    normalized.key !== CARD_FRONTEND_TAVERN_EVENT_VALUES.USER_MESSAGE_RENDERED &&
    normalized.key !== CARD_FRONTEND_TAVERN_EVENT_VALUES.CHARACTER_MESSAGE_RENDERED
  )
    return rows;
  var claims = new Map();
  return rows.filter(function (row) {
    if (!claims.has(row.live)) {
      var key = cardFrontendOwnRenderKey(row.live, normalized.key, normalized.args[0]),
        heard = (row.live.ownRenders = row.live.ownRenders || new Set());
      claims.set(row.live, !key || !heard.has(key));
      if (key) heard.add(key);
    }
    return claims.get(row.live);
  });
}
// The frame reports ready before its own scripts run, so the render of its message is delivered once
// the document has loaded, the first moment its listeners exist. A frame mounted on a reply that is
// still streaming waits for the broadcast that follows the commit instead.
function cardFrontendDeliverOwnRender(live) {
  if (!live || live.kind === 'library' || !live.frame || !live.owner || live.owner.pendingCommit === true) return;
  live.frame.addEventListener(
    'load',
    function () {
      if (!cardFrontendLiveIsCurrent(live) || live.owner.pendingCommit === true) return;
      var session = cardFrontendOwnedSession(live),
        rows = session && Array.isArray(session.msgs) ? session.msgs : [],
        index = rows.findIndex(function (message) {
          return Number(message && message.seq) === Number(live.owner.messageSeq);
        });
      if (index < 0) return;
      var eventKey =
        rows[index].role === 'user'
          ? CARD_FRONTEND_TAVERN_EVENT_VALUES.USER_MESSAGE_RENDERED
          : CARD_FRONTEND_TAVERN_EVENT_VALUES.CHARACTER_MESSAGE_RENDERED;
      Promise.resolve(cardFrontendDispatchEvent(eventKey, [index], { live: live })).catch(function (error) {
        cardFrontendReportEventError(live, error, eventKey);
      });
    },
    { once: true }
  );
}
// ---- dry-run listeners (ST Generate(..., dryRun)) ----
// The Prompt Manager preview announces generation events with dryRun=true. While a listener handles one, the host
// keeps its data and screen as they are: writes through the host API are dropped, model calls, STScript and network
// requests answer with a placeholder, toasts stay hidden. What the script does itself under the dryRun flag is its
// own business, as in ST. The guard lasts until the listener's own promise settles or the preview ends (its signal
// aborts), whichever comes first; a generation cancels a running preview before it announces anything (62).
var _cardFrontendDryRuns = new Map(),
  CARD_FRONTEND_DRY_RUN_READS = new Set([
    'facadeValue',
    'mvuCall',
    'loadWorldInfo',
    'retrieveDisplayedMessage',
    'formatAsDisplayedMessage',
    'formatAsTavernRegexedString',
    'substitudeMacros',
    'applyMacroLikes',
    'eventRegister',
    'eventRemove',
    'eventClearEvent',
    'eventClearListener',
    'eventClearAll',
  ]);
function cardFrontendDryRun(live, notes, callback, signal) {
  var entry = _cardFrontendDryRuns.get(live) || { depth: 0, notes: notes };
  entry.depth++;
  if (notes) entry.notes = notes;
  if (notes && typeof generationPromptNoteScriptRan === 'function') generationPromptNoteScriptRan(notes);
  _cardFrontendDryRuns.set(live, entry);
  var released = false,
    release = function () {
      if (released) return;
      released = true;
      if (signal) signal.removeEventListener('abort', release);
      if (--entry.depth <= 0 && _cardFrontendDryRuns.get(live) === entry) _cardFrontendDryRuns.delete(live);
    },
    result;
  if (signal) signal.addEventListener('abort', release, { once: true });
  try {
    result = callback();
  } catch (error) {
    release();
    throw error;
  }
  Promise.resolve(result).then(release, release);
  return result;
}
function cardFrontendDryRunNote(entry, text) {
  if (entry.notes && !entry.notes.includes(text)) entry.notes.push(text);
  return text;
}
// The replacement for a host call made during a dry run, or null when the call only reads and goes ahead.
function cardFrontendDryRunCall(live, name, args) {
  var entry = _cardFrontendDryRuns.get(live);
  if (!entry) return null;
  if (name === 'generate' || name === 'generateRaw' || (name === 'facadeAction' && args && args.name === 'generate'))
    return { value: Promise.resolve(cardFrontendDryRunNote(entry, '[预览未执行：卡片脚本模型调用]')) };
  if (name === 'triggerSlash')
    return { value: Promise.resolve(cardFrontendDryRunNote(entry, '[预览未执行：卡片脚本 STScript]')) };
  if (name === 'getModelList') {
    cardFrontendDryRunNote(entry, '[预览未执行：卡片脚本联网请求]');
    return { value: Promise.resolve([]) };
  }
  if (
    CARD_FRONTEND_DRY_RUN_READS.has(name) ||
    (/^(?:get|is|has)[A-Z]/.test(name) && !/^getOrCreate/.test(name)) ||
    (name === 'facadeVariable' && args && (args.op === 'get' || args.op === 'has'))
  )
    return null;
  cardFrontendDryRunNote(entry, '卡片脚本在预览中发起的写入已丢弃，发送时照常写入。');
  return { value: undefined };
}
function cardFrontendInDryRun(live) {
  return _cardFrontendDryRuns.has(live);
}
async function cardFrontendAwaitEvent(live, callback, options) {
  var source = options.stscriptRun && options.stscriptRun.abort,
    parentSignal = options.signal,
    controller = source ? new AbortController() : null,
    forwardAbort = function () {
      controller.abort();
    };
  if (controller) {
    if (source.signal.aborted || (parentSignal && parentSignal.aborted)) controller.abort();
    source.onAbort(forwardAbort);
    if (parentSignal) parentSignal.addEventListener('abort', forwardAbort, { once: true });
    options = Object.assign({}, options, { signal: controller.signal });
  }
  var signal = options.signal,
    cancel = function () {
      if (!source) cardFrontendCancelEventOwner(live);
    };
  try {
    if (signal && signal.aborted) throw cardFrontendAbortError(options.label);
    if (signal) signal.addEventListener('abort', cancel, { once: true });
    return await cardFrontendAwaitWithTimeout(
      callback(signal, options.eventCancel || (controller && forwardAbort)),
      options
    );
  } finally {
    if (signal) signal.removeEventListener('abort', cancel);
    if (source) source.offAbort(forwardAbort);
    if (controller && parentSignal) parentSignal.removeEventListener('abort', forwardAbort);
  }
}
async function cardFrontendInvokeEventListener(row, args, options) {
  var run = options.stscriptRun,
    frame = row.live && row.live.frame && row.live.frame.contentWindow,
    invoke = frame && frame.__yeyuInvokeEventListener;
  if (!run || typeof invoke !== 'function') return row.handler.apply(null, args);
  var source = 'e' + ++_cardFrontendEventRunSeq,
    signal = options.signal;
  if (signal.aborted) throw cardFrontendAbortError('事件监听器');
  _cardFrontendEventRuns.set(source, { live: row.live, run: run, signal: signal, cancel: options.eventCancel });
  var release = function () {
    _cardFrontendEventRuns.delete(source);
  };
  signal.addEventListener('abort', release, { once: true });
  try {
    return await invoke(row.handler, args, source, true, signal);
  } finally {
    signal.removeEventListener('abort', release);
    release();
  }
}
async function cardFrontendDispatchEvent(name, args, options) {
  options = options || {};
  if (options.stscriptRun && !options.signal)
    return stscriptWithRequestController({ _abortController: options.stscriptRun.abort }, function (controller) {
      return cardFrontendDispatchEvent(name, args, Object.assign({}, options, { signal: controller.signal }));
    });
  if (isRisuCharacter(typeof getChar === 'function' ? getChar() : null)) return Array.isArray(args) ? args : [];
  var normalized = cardFrontendEventArguments(name, args);
  if (!normalized) return Array.isArray(args) ? args : [];
  var rows = cardFrontendClaimOwnRenders(
    _cardFrontendEventListeners.filter(function (row) {
      return (
        row.name === normalized.key &&
        (!options.live || row.live === options.live) &&
        (!options.owners || options.owners.has(row.live))
      );
    }),
    normalized
  );
  // A dry run leaves the listeners as registered and their owners running: a cancelled preview only stops waiting.
  var dryRun = options.dryRun === true,
    reported = false,
    deadline = options.totalTimeoutMs == null ? Infinity : Date.now() + Number(options.totalTimeoutMs);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (options.signal && options.signal.aborted) throw cardFrontendAbortError('事件 ' + normalized.key);
    if (Date.now() >= deadline) break;
    if (row.once && !dryRun) cardFrontendRemoveEvent(row.live, row.name, row.handler);
    var handle = function (signal, cancel) {
        return cardFrontendInvokeEventListener(
          row,
          normalized.args,
          signal ? Object.assign({}, options, { signal: signal, eventCancel: cancel }) : options
        );
      },
      waitOptions = {
        signal: options.signal,
        stscriptRun: options.stscriptRun,
        eventCancel: options.eventCancel,
        timeoutMs: Math.min(options.timeoutMs == null ? Infinity : Number(options.timeoutMs), deadline - Date.now()),
        label: '事件 ' + normalized.key + ' 监听器',
      };
    try {
      if (dryRun)
        await cardFrontendAwaitWithTimeout(
          cardFrontendDryRun(row.live, options.previewNotes, handle, options.signal),
          waitOptions
        );
      else await cardFrontendAwaitEvent(row.live, handle, waitOptions);
    } catch (error) {
      if (
        (options.signal && options.signal.aborted) ||
        (options.stscriptRun && options.stscriptRun.abort.signal.aborted)
      ) {
        if (!dryRun && !options.stscriptRun) cardFrontendCancelEventOwner(row.live);
        throw error;
      }
      if (dryRun) {
        console.error(error);
        if (options.previewNotes)
          cardFrontendDryRunNote(
            { notes: options.previewNotes },
            '卡片脚本处理预览事件 ' + normalized.key + ' 出错：' + String((error && error.message) || error)
          );
        continue;
      }
      cardFrontendReportEventError(row.live, error, normalized.key, !reported);
      reported = true;
    }
  }
  return normalized.args;
}
function cardFrontendDispatchSyncEvent(name, args, options) {
  options = options || {};
  if (isRisuCharacter(typeof getChar === 'function' ? getChar() : null)) return;
  var normalized = cardFrontendEventArguments(name, args);
  if (!normalized) return;
  var rows = _cardFrontendEventListeners
    .filter(function (row) {
      return row.name === normalized.key;
    })
    .slice();
  rows.forEach(function (row) {
    if (options.signal && options.signal.aborted) throw cardFrontendAbortError('事件 ' + normalized.key);
    if (row.once) cardFrontendRemoveEvent(row.live, row.name, row.handler);
    try {
      if (options.stscriptRun) {
        // Sync emission starts every listener immediately; their continuations still belong to
        // the emitting chain and lose their host identity if that chain is stopped.
        cardFrontendAwaitEvent(
          row.live,
          function (signal, cancel) {
            return cardFrontendInvokeEventListener(
              row,
              normalized.args,
              Object.assign({}, options, { signal: signal, eventCancel: cancel })
            );
          },
          { signal: options.signal, stscriptRun: options.stscriptRun, label: '事件 ' + normalized.key + ' 监听器' }
        ).catch(function (error) {
          if (!(options.signal && options.signal.aborted) && !options.stscriptRun.abort.signal.aborted)
            cardFrontendReportEventError(row.live, error, normalized.key);
        });
        return;
      }
      row.handler.apply(null, normalized.args);
    } catch (error) {
      cardFrontendReportEventError(row.live, error, normalized.key);
    }
  });
}
function cardFrontendRegisterMacroLike(live, regex, replace) {
  var isRegex = regex instanceof RegExp || Object.prototype.toString.call(regex) === '[object RegExp]';
  if (!isRegex || typeof replace !== 'function') throw new Error('registerMacroLike 需要 RegExp 和替换函数');
  if (
    _cardFrontendMacroLikes.some(function (row) {
      return row.regex.source === regex.source;
    })
  )
    return false;
  _cardFrontendMacroLikes.push({ live: live, regex: regex, replace: replace });
  return true;
}
function cardFrontendUnregisterMacroLike(regex) {
  var source = regex && typeof regex.source === 'string' ? regex.source : String(regex || ''),
    index = _cardFrontendMacroLikes.findIndex(function (row) {
      return row.regex.source === source;
    });
  if (index < 0) return false;
  _cardFrontendMacroLikes.splice(index, 1);
  return true;
}
function cardFrontendApplyMacroLikes(value, context) {
  var text = String(value == null ? '' : value);
  if (isRisuCharacter(typeof getChar === 'function' ? getChar() : null)) return text;
  _cardFrontendMacroLikes.slice().forEach(function (row) {
    text = text.replace(row.regex, function () {
      var args = Array.from(arguments);
      return row.replace.apply(null, [context && typeof context === 'object' ? context : {}].concat(args));
    });
  });
  return text;
}
function cardFrontendChatPage(char, session) {
  return String((char && char.id) || '') + '|' + String((session && session.id) || '');
}
// ST puts a new chat's greeting in when the chat is first opened and then announces CHAT_CREATED. The
// entries that start a conversation with its greeting mark it here, before the render that opens it.
function markCardFrontendChatCreated(char, session) {
  _cardFrontendCreatedPage = cardFrontendChatPage(char, session);
}
// A chat opens as in ST getChatResult: CHAT_CHANGED, CHAT_CREATED for a chat just started with its
// greeting, then, while that greeting is the only message, MESSAGE_RECEIVED and
// CHARACTER_MESSAGE_RENDERED for it as 'first_message'.
function cardFrontendChatOpenedEvents(char, session) {
  var events = [
      { name: CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_CHANGED, args: [String((session && session.id) || '')] },
    ],
    rows = session && Array.isArray(session.msgs) ? session.msgs : [];
  if (session && _cardFrontendCreatedPage === cardFrontendChatPage(char, session))
    events.push({ name: CARD_FRONTEND_TAVERN_EVENT_VALUES.CHAT_CREATED, args: [] });
  return rows.length === 1 && rows[0] && rows[0].opening === true
    ? events.concat(cardFrontendFirstMessageEvents())
    : events;
}
function cardFrontendFirstMessageEvents() {
  return [
    { name: CARD_FRONTEND_TAVERN_EVENT_VALUES.MESSAGE_RECEIVED, args: [0, 'first_message'] },
    { name: CARD_FRONTEND_TAVERN_EVENT_VALUES.CHARACTER_MESSAGE_RENDERED, args: [0, 'first_message'] },
  ];
}
function cardFrontendListeningOwners() {
  return new Set(
    _cardFrontendEventListeners.map(function (row) {
      return row.live;
    })
  );
}
// ST awaits each event of such a sequence before the next. The sequence goes to the frames listening
// when it starts, and its first event reaches them at once; a library or frame that loads meanwhile
// hears it from its own catch-up instead (the library's pending replay, a frame's own render).
// Nothing waits on the returned promise before painting.
function cardFrontendEmitInOrder(events, owners) {
  var listening = owners || cardFrontendListeningOwners();
  function emit(event) {
    return Promise.resolve(cardFrontendDispatchEvent(event.name, event.args, { owners: listening })).catch(
      function (error) {
        cardFrontendReportEventError(null, error, event.name);
      }
    );
  }
  return events.slice(1).reduce(
    function (previous, event) {
      return previous.then(function () {
        return emit(event);
      });
    },
    events.length ? emit(events[0]) : Promise.resolve()
  );
}
// Saving a character rebuilds the greeting of a chat that holds nothing else, as ST's
// createOrEditCharacter does: MESSAGE_RECEIVED before the chat is redrawn, CHARACTER_MESSAGE_RENDERED
// after it.
function cardFrontendRedrawGreeting(redraw) {
  var owners = cardFrontendListeningOwners(),
    events = cardFrontendFirstMessageEvents(),
    received = cardFrontendEmitInOrder(events.slice(0, 1), owners);
  redraw();
  return received.then(function () {
    return cardFrontendEmitInOrder(events.slice(1), owners);
  });
}
// Main-chat STREAM_TOKEN_RECEIVED carries the text accumulated so far, as in ST. Chunks are coalesced
// and the next dispatch starts only after the previous listeners returned, so a slow card listener
// never holds up reading or painting the stream. finish sends the last streamed text without waiting
// for the interval and resolves once no dispatch is running any more: ST awaits every chunk before it
// saves the reply, so MESSAGE_RECEIVED waits for it. A reply that arrived as one JSON body sends nothing.
function cardFrontendStreamTokenRelay(intervalMs) {
  var latest = '',
    sent = '',
    busy = false,
    closed = false,
    timer = 0,
    lastAt = 0,
    delivered = null,
    resolveDelivered = null;
  function settle() {
    if (resolveDelivered && !busy) resolveDelivered();
  }
  function send() {
    timer = 0;
    if (closed || busy || latest === sent) return;
    busy = true;
    sent = latest;
    lastAt = Date.now();
    Promise.resolve(cardFrontendDispatchEvent(CARD_FRONTEND_TAVERN_EVENT_VALUES.STREAM_TOKEN_RECEIVED, [sent]))
      .catch(function (error) {
        cardFrontendReportEventError(null, error, CARD_FRONTEND_TAVERN_EVENT_VALUES.STREAM_TOKEN_RECEIVED);
      })
      .then(function () {
        busy = false;
        schedule();
        settle();
      });
  }
  function schedule() {
    if (closed || busy || timer || latest === sent) return;
    if (delivered) send();
    else timer = setTimeout(send, Math.max(0, lastAt + intervalMs - Date.now()));
  }
  return {
    push: function (text) {
      latest = String(text == null ? '' : text);
      schedule();
    },
    finish: function () {
      if (timer) clearTimeout(timer);
      timer = 0;
      delivered =
        delivered ||
        new Promise(function (resolve) {
          resolveDelivered = resolve;
        });
      schedule();
      settle();
      return delivered;
    },
    close: function () {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = 0;
    },
  };
}
function cardFrontendAwaitBroadcastEvent(name, args, options) {
  return cardFrontendDispatchEvent(name, args, options);
}
function cardFrontendBroadcastSyncEvent(name, args, options) {
  cardFrontendDispatchSyncEvent(name, args, options);
}
function cardFrontendBroadcastEvent(name, args) {
  var key = cardFrontendEventName(name),
    count = _cardFrontendEventListeners.filter(function (row) {
      return row.name === key;
    }).length;
  Promise.resolve(cardFrontendDispatchEvent(key, args)).catch(function (error) {
    cardFrontendReportEventError(null, error, key);
  });
  return count;
}

// ---- same-origin direct runtime ----
function cardFrontendSend(live, type, payload) {
  if (!live || isRisuCharacter(cardFrontendCharacter(live)) || !live.frame || !live.frame.contentWindow)
    return false;
  try {
    var deliver = live.frame.contentWindow.__yeyuHostDeliver;
    if (typeof deliver !== 'function') return false;
    deliver(type, payload);
    return true;
  } catch (error) {
    return false;
  }
}
var CardFrontendGenerationCycle = {
  stop: function (live) {
    if (!live) return false;
    live.generationCycleStopped = true;
    return true;
  },
  resume: function () {
    _cardFrontendLive.forEach(function (live) {
      delete live.generationCycleStopped;
    });
    if (_cardScriptLibraryLive) delete _cardScriptLibraryLive.generationCycleStopped;
  },
  stopped: function (live) {
    return !!(live && live.generationCycleStopped);
  },
  stopFromToast: function (live, action) {
    if (!live || !action) return false;
    var label = String(action.textContent || '').trim();
    if (!/^(?:终止|停止|取消|中止)$/.test(label)) return false;
    return (
      typeof stopCardFrontendGenerationsForLive === 'function' &&
      stopCardFrontendGenerationsForLive(live, false) === true
    );
  },
};
function cardFrontendCharacter(live) {
  var id = String((live && live.charId) || '');
  if (typeof D === 'undefined' || !D || !Array.isArray(D.characters)) return null;
  return (
    D.characters.find(function (row) {
      return row && String(row.id || '') === id;
    }) || null
  );
}
async function cardFrontendSaveSillyTavernChat(live, args) {
  if (!live || live.kind !== 'library') throw new Error('SillyTavern.saveChat 只提供给常驻脚本库');
  var char = cardFrontendCharacter(live),
    box = char && D.chats && D.chats[char.id],
    session =
      box && Array.isArray(box.sessions)
        ? box.sessions.find(function (row) {
            return String((row && row.id) || '') === String((live.owner && live.owner.sessionId) || '');
          })
        : null,
    incoming = Array.isArray(args && args.chat) ? args.chat : null;
  if (!char || !session || !incoming || incoming.length !== session.msgs.length)
    throw new Error('对话已变化，本次脚本消息字段未保存');
  var journal = createMutationJournal();
  try {
    session.msgs.forEach(function (message, index) {
      var source = objectRecord(incoming[index]);
      if (
        !source ||
        Math.max(0, Math.floor(Number(source.__yeyu_seq) || 0)) !== Math.max(0, Math.floor(Number(message.seq) || 0))
      )
        throw new Error('消息身份已变化');
      var fields = Array.from(new Set(Object.keys(message).concat(Object.keys(source)))).filter(function (key) {
        return cardFrontendSafeOwnKey(key) && !CARD_FRONTEND_ST_MESSAGE_KEYS[key];
      });
      journal.capture(message, fields, true);
      var previousExtra = message.extra;
      Object.keys(message).forEach(function (key) {
        if (cardFrontendSafeOwnKey(key) && !CARD_FRONTEND_ST_MESSAGE_KEYS[key]) delete message[key];
      });
      Object.keys(source).forEach(function (key) {
        if (cardFrontendSafeOwnKey(key) && !CARD_FRONTEND_ST_MESSAGE_KEYS[key])
          message[key] = cardFrontendCopy(source[key]);
      });
      // chat[] 视图里投影进 extra.media 的夜欲图片不随 saveChat 写回。
      if (objectRecord(message.extra) && typeof hostWriteWithoutImageMedia === 'function')
        hostWriteWithoutImageMedia(message.extra, previousExtra);
    });
    journal.seal();
    if (typeof refreshMvuAfterMutation === 'function')
      await refreshMvuAfterMutation(char, session, { mutation: journal });
    if (typeof saveData === 'function') await saveData('sessions', { urgent: true });
  } catch (error) {
    journal.rollback();
    if (typeof clearMvuSessionRuntime === 'function') clearMvuSessionRuntime(char.id, session.id);
    throw new Error('脚本消息字段保存失败，原对话已恢复：' + String((error && error.message) || error));
  }
  refreshCardScriptLibraryContext(char, session);
  return true;
}
function cardFrontendSelectOpeningMessage(live, args) {
  var context = cardFrontendRequireCurrent(live),
    char = context.char,
    session = context.session,
    rows = (session && session.msgs) || [],
    index = hostWriteMessageTargetIndex(args && args.messageId, rows.length),
    message = index == null ? null : rows[index],
    option = (args && args.option) || {},
    target = Math.floor(Number(option.swipe_id)),
    swipes = message && Array.isArray(message.swipes) ? message.swipes : [];
  if (
    index == null ||
    !message ||
    message.opening !== true ||
    target < 0 ||
    target >= swipes.length ||
    String((args && args.message) || '') !== String(swipes[target] || '')
  )
    throw new Error('setChatMessage 只允许选择第一条开场消息的既有候选');
  if (typeof switchOpeningGreeting !== 'function') throw new Error('夜欲的开场白切换入口不可用');
  var active = Math.max(0, Math.floor(Number(message.swipeId == null ? message.openingIndex : message.swipeId) || 0));
  if (active === target) return true;
  return Promise.resolve(switchOpeningGreeting(index, target - active, { targetIndex: target, hostFacade: true })).then(
    function (ok) {
      if (!ok) throw new Error('开场白候选没有切换');
      return true;
    }
  );
}
function cardFrontendSubstitudeMacros(char, session, value, messageId) {
  if (typeof replaceCharacterMacros !== 'function') return String(value == null ? '' : value);
  var persona = typeof getActivePersona === 'function' ? getActivePersona(char && char.id) : null,
    state =
      typeof bindCharacterMacroSession === 'function'
        ? bindCharacterMacroSession(createCharacterMacroState(), session, { commit: false })
        : createCharacterMacroState();
  state.messages = session && Array.isArray(session.msgs) ? session.msgs : [];
  state.messageId = Math.max(0, state.messages.length - 1);
  state.helperMessageId = messageId;
  state.lastMessageId = state.messageId;
  state.input = typeof $ === 'function' && $('user-input') ? $('user-input').value : '';
  return replaceCharacterMacros(
    String(value == null ? '' : value),
    char,
    String((persona && persona.name) || '用户'),
    state
  );
}
function cardFrontendEventSourceOptions(live, source) {
  source = String(source || '');
  if (!source) return {};
  var event = _cardFrontendEventRuns.get(source);
  // A listener can outlive a synchronous emitter's completed run. That completion releases
  // nesting authority, while its source and cancellation remain valid until the listener ends.
  if (
    !event ||
    event.live !== live ||
    typeof _qrTop === 'undefined' ||
    (event.run !== _qrTop && event.run.state !== 'completed') ||
    event.run.abort.signal.aborted ||
    event.signal.aborted
  )
    throw cardFrontendAbortError('事件调用');
  return { stscriptRun: event.run, signal: event.signal, eventCancel: event.cancel };
}
function cardFrontendCall(live, name, args) {
  var dryRun = cardFrontendDryRunCall(live, name, args);
  if (dryRun) return dryRun.value;
  var context = cardFrontendRequireCurrent(live),
    char = context.char,
    session = context.session;
  if (typeof cardFrontendHostWriteCall === 'function') {
    var hostWrite = cardFrontendHostWriteCall(live, name, args);
    if (hostWrite && hostWrite.handled === true) return hostWrite.value;
  }
  if (name === 'saveSettings') return cardFrontendPersistExtensionSettings(live, args && args.extensionSettings, true);
  if (name === 'saveChat') return cardFrontendSaveSillyTavernChat(live, args);
  if (name === 'setChatMessage') return cardFrontendSelectOpeningMessage(live, args);
  if (name === 'requestFullscreen') return openCardFrontendFullscreen(live.key, 'desktop');
  if (name === 'exitFullscreen') {
    cardFrontendCloseFullscreen(live);
    return true;
  }
  if (name === 'eventRegister')
    return cardFrontendRegisterEvent(
      live,
      args && args.name,
      args && args.handler,
      args && args.once,
      args && args.position
    );
  if (name === 'eventRemove') return cardFrontendRemoveEvent(live, args && args.name, args && args.handler);
  if (name === 'eventClearEvent') {
    cardFrontendClearEvent(live, args && args.name);
    return;
  }
  if (name === 'eventClearListener') {
    cardFrontendClearListener(live, args && args.handler);
    return;
  }
  if (name === 'eventClearAll') {
    _cardFrontendEventListeners = _cardFrontendEventListeners.filter(function (row) {
      return row.live !== live;
    });
    return;
  }
  if (name === 'clearOwnerRegistrations') {
    cardFrontendClearOwnerRegistrations(live);
    return;
  }
  if (name === 'eventEmit')
    return cardFrontendAwaitBroadcastEvent(
      args && args.name,
      args && args.args,
      cardFrontendEventSourceOptions(live, args && args.eventSource)
    ).then(function () {});
  if (name === 'eventEmitAndWait') {
    cardFrontendBroadcastSyncEvent(
      args && args.name,
      args && args.args,
      cardFrontendEventSourceOptions(live, args && args.eventSource)
    );
    return;
  }
  if (name === 'substitudeMacros') return cardFrontendSubstitudeMacros(char, session, args && args.value, args && args.messageId);
  if (name === 'registerMacroLike')
    return cardFrontendRegisterMacroLike(live, args && args.regex, args && args.replace);
  if (name === 'unregisterMacroLike') return cardFrontendUnregisterMacroLike(args && args.regex);
  if (name === 'applyMacroLikes') return cardFrontendApplyMacroLikes(args && args.value, args && args.context);
  var audioFunctions = {
    playAudio: typeof playAudio === 'function' ? playAudio : null,
    pauseAudio: typeof pauseAudio === 'function' ? pauseAudio : null,
    getAudioList: typeof getAudioList === 'function' ? getAudioList : null,
    replaceAudioList: typeof replaceAudioList === 'function' ? replaceAudioList : null,
    appendAudioList: typeof appendAudioList === 'function' ? appendAudioList : null,
    getAudioSettings: typeof getAudioSettings === 'function' ? getAudioSettings : null,
    setAudioSettings: typeof setAudioSettings === 'function' ? setAudioSettings : null,
    getCurrentAudio: typeof getCurrentAudio === 'function' ? getCurrentAudio : null,
    setAudioPlaying: typeof tavernAudioSetPlaying === 'function' ? tavernAudioSetPlaying : null,
  };
  if (Object.prototype.hasOwnProperty.call(audioFunctions, name)) {
    var audioFunction = audioFunctions[name];
    if (typeof audioFunction !== 'function') throw new Error('夜欲音频运行时尚未加载');
    return audioFunction.apply(window, Array.isArray(args && args.values) ? args.values : []);
  }
  if (name === 'triggerSlash') {
    if (typeof executeStscriptFromCardFrontend !== 'function') throw new Error('夜欲的 STScript 调用入口不可用');
    var command = String(args && args.command != null ? args.command : ''),
      eventOptions = cardFrontendEventSourceOptions(live, args && args.eventSource),
      run = Promise.resolve(
        executeStscriptFromCardFrontend(
          command,
          live.owner,
          eventOptions.stscriptRun,
          eventOptions.signal,
          eventOptions.eventCancel
        )
      );
    return run.then(
      function (value) {
        if (live.kind === 'library') refreshCardScriptLibraryContext(char, session);
        return String(value == null ? '' : value);
      },
      function (error) {
        if (live.kind === 'library') refreshCardScriptLibraryContext(char, session);
        throw error;
      }
    );
  }
  if (name === 'stopGeneration')
    return (
      cardScriptSendInterceptCancel(live) ||
      (typeof cancelCardFrontendGeneration === 'function' ? cancelCardFrontendGeneration(live) === true : false)
    );
  if (name === 'stopGenerationById')
    return typeof stopCardFrontendGenerationById === 'function'
      ? stopCardFrontendGenerationById(args && args.generationId)
      : false;
  if (name === 'stopAllGeneration')
    return typeof stopAllCardFrontendGenerations === 'function' ? stopAllCardFrontendGenerations() : false;
  if (name === 'getModelList')
    return typeof cardFrontendGetModelList === 'function' ? cardFrontendGetModelList(args && args.config) : [];
  if (name === 'getProxyPresetNames')
    return typeof cardFrontendGetProxyPresetNames === 'function' ? cardFrontendGetProxyPresetNames() : [];
  if (name === 'deleteLastMessage') return cardScriptSendInterceptDelete(live);
  if (name === 'generate' || name === 'generateRaw') {
    if (typeof executeCardFrontendGeneration !== 'function') throw new Error('夜欲的卡片生成入口不可用');
    return executeCardFrontendGeneration(args && args.config, live, name === 'generateRaw');
  }
  if (name === 'loadWorldInfo') {
    if (
      live.kind === 'library' &&
      cardFrontendAllowedLorebookNames(live).indexOf(String((args && args.name) || '')) < 0
    )
      throw new Error('常驻脚本库只能读取当前启用的全局世界书或角色绑定世界书');
    var rawCategory = cardFrontendWorldbookCategory(args && args.name);
    if (!rawCategory) throw new Error("未能找到世界书 '" + String((args && args.name) || '') + "'");
    return cardFrontendSillyTavernWorldInfo(rawCategory);
  }
  throw new Error('夜欲卡片前端桥本期没有实现 ' + String(name));
}
// Keys are copied one by one onto a fresh object so a frontend can never reach a prototype.
function cardFrontendMergeVariables(base, patch) {
  var out = objectRecord(base) ? cardFrontendCopy(base) : {};
  Object.keys(objectRecord(patch) || {}).forEach(function (key) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
    var next = patch[key];
    out[key] =
      objectRecord(next) && objectRecord(out[key])
        ? cardFrontendMergeVariables(out[key], next)
        : cardFrontendCopy(next);
  });
  return out;
}
function cardFrontendSafeVariables(value) {
  return cardFrontendMergeVariables({}, value);
}
function cardFrontendWriteVariables(live, payload) {
  var type = String((payload && payload.type) || ''),
    replace = String((payload && payload.op) || '') === 'replace',
    value = objectRecord(payload && payload.value) || {},
    context = cardFrontendRequireCurrent(live),
    char = context.char,
    session = context.session;
  if (type === 'chat') {
    if (!session) throw new Error('当前没有可写入的对话');
    session.stscriptVars = replace
      ? cardFrontendSafeVariables(value)
      : cardFrontendMergeVariables(session.stscriptVars, value);
    if (typeof saveData === 'function') saveData('sessions');
    refreshCardScriptLibraryContext(char, session);
    return;
  }
  if (type === 'global') {
    if (typeof D === 'undefined' || !D || !D.settings) throw new Error('设置尚未加载');
    if (!objectRecord(D.settings.stscript)) D.settings.stscript = {};
    D.settings.stscript.globalVars = replace
      ? cardFrontendSafeVariables(value)
      : cardFrontendMergeVariables(D.settings.stscript.globalVars, value);
    if (typeof saveData === 'function') saveData('meta');
    refreshCardScriptLibraryContext(char, session);
    return;
  }
  if (type === 'message') {
    if (!session || !Array.isArray(session.msgs)) throw new Error('当前没有可写入的消息');
    var index = Math.floor(Number(payload && payload.messageId));
    if (index < 0) index = session.msgs.length + index;
    var message = session.msgs[index],
      choice =
        message && typeof mvuCandidateTexts === 'function'
          ? mvuCandidateTexts(message)
          : { texts: [String((message && message.content) || '')], active: 0 },
      envelope = message && objectRecord(message.yeyuMvu),
      record = message && typeof mvuMessageRecord === 'function' ? mvuMessageRecord(message) : null;
    var state = objectRecord(value.stat_data);
    if (!state) throw new Error('Mvu.replaceMvuData 缺少 stat_data');
    if (!record) {
      var candidates = choice.texts.map(function (text) {
        return { sourceHash: typeof mvuHash === 'function' ? mvuHash(text) : '', state: {}, error: '', updates: 0 };
      });
      envelope = {
        version: typeof MVU_STATE_VERSION !== 'undefined' ? MVU_STATE_VERSION : 1,
        schemaSignature: typeof mvuSchemaScriptSignature === 'function' ? mvuSchemaScriptSignature(char) : 'resident',
        activeIndex: choice.active,
        candidates: candidates,
      };
      if (typeof mvuDialect === 'function' && mvuDialect(char) === 'legacy') envelope.dialect = 'legacy';
      message.yeyuMvu = envelope;
      record = candidates[choice.active];
    }
    record.state = cardFrontendCopy(state);
    if (objectRecord(value.schema)) record.schema = cardFrontendCopy(value.schema);
    if (objectRecord(value.display_data)) record.display = cardFrontendCopy(value.display_data);
    if (objectRecord(value.delta_data)) record.delta = cardFrontendCopy(value.delta_data);
    if (typeof _mvuRuntime !== 'undefined' && char && session) {
      var runtime = _mvuRuntime[String(char.id || '') + '|' + String(session.id || '')];
      if (runtime && index === session.msgs.length - 1) runtime.state = cardFrontendCopy(state);
    }
    if (typeof saveData === 'function') saveData('sessions');
    refreshCardScriptLibraryContext(char, session);
    if (typeof renderMvuRuntimeStatus === 'function') renderMvuRuntimeStatus(char, session);
    return;
  }
  throw new Error('夜欲卡片前端桥不能写入「' + type + '」作用域');
}
function cardFrontendToastKey(live, id) {
  return String((live && live.token) || '') + '|' + String(id || '');
}
function cardFrontendToastNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
function cardFrontendToastReleaseMedia(root) {
  if (!root || !root.querySelectorAll) return;
  Array.from(root.querySelectorAll('img,audio,video,source')).forEach(function (media) {
    if ((media.tagName === 'AUDIO' || media.tagName === 'VIDEO') && typeof media.pause === 'function') {
      try {
        media.pause();
      } catch (_) {}
    }
    media.removeAttribute('src');
    media.removeAttribute('srcset');
    media.removeAttribute('poster');
    if ((media.tagName === 'AUDIO' || media.tagName === 'VIDEO') && typeof media.load === 'function') {
      try {
        media.load();
      } catch (_) {}
    }
  });
}
function cardFrontendToastFinish(record) {
  if (!record || record.closed) return false;
  record.closed = true;
  if (record.timer) clearTimeout(record.timer);
  if (record.removeTimer) clearTimeout(record.removeTimer);
  cardFrontendToastReleaseMedia(record.node);
  record.node.classList.add('is-leaving');
  record.removeTimer = setTimeout(function () {
    if (record.node) record.node.remove();
  }, 300);
  _cardFrontendToasts.delete(record.key);
  if (record.options && typeof record.options.onHidden === 'function') {
    try {
      record.options.onHidden.call(record.proxy);
    } catch (error) {
      setTimeout(function () {
        throw error;
      }, 0);
    }
  }
  return true;
}
function cardFrontendToastSchedule(record, delay) {
  if (!record || record.closed || delay <= 0) return;
  if (record.timer) clearTimeout(record.timer);
  record.remaining = delay;
  record.startedAt = Date.now();
  record.timer = setTimeout(function () {
    cardFrontendToastFinish(record);
  }, delay);
}
function cardFrontendToastBody(message, escapeHtml) {
  var body = document.createElement('div');
  body.className = 'card-frontend-toast-message';
  if (escapeHtml === true) {
    body.textContent = message;
    return body;
  }
  if (typeof RichDisplay === 'object' && RichDisplay && typeof RichDisplay.prepare === 'function') {
    var prepared = RichDisplay.prepare(message);
    body.classList.add('yeyu-rich-content', prepared.scopeClass);
    if (prepared.hasMarkup) body.appendChild(prepared.fragment);
    else body.textContent = prepared.text;
    return body;
  }
  if (typeof DOMPurify !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
    body.appendChild(
      DOMPurify.sanitize(message, {
        RETURN_DOM_FRAGMENT: true,
        FORCE_BODY: true,
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'template', 'base', 'meta', 'link'],
        ADD_FORBID_CONTENTS: ['script', 'iframe', 'object', 'embed', 'template'],
        FORBID_ATTR: ['srcdoc'],
      })
    );
    return body;
  }
  body.textContent = message;
  return body;
}
// RichDisplay promotes card inline styles to !important so host CSS cannot restyle card bodies.
// Inside a notification the app theme wins instead: background and text colours are stripped from
// the display copy (the script's own mirror keeps nothing visual anyway), layout styles stay.
function cardFrontendToastNeutralizeStyles(root) {
  if (!root || !root.querySelectorAll) return root;
  Array.from(root.querySelectorAll('[style]')).forEach(function (el) {
    var style = el.style,
      doomed = [];
    for (var i = 0; i < style.length; i++) {
      var name = style[i];
      if (name.indexOf('background') === 0 || name === 'color' || name === 'text-shadow' || name === 'box-shadow')
        doomed.push(name);
    }
    doomed.forEach(function (name) {
      style.removeProperty(name);
    });
    if (!el.getAttribute('style')) el.removeAttribute('style');
  });
  return root;
}
function cardFrontendToastShow(live, payload) {
  var container = typeof document !== 'undefined' && document.getElementById('toasts'),
    message = String((payload && payload.message) || ''),
    options = objectRecord(payload && payload.options) || {};
  if (!container || typeof DOMPurify === 'undefined') {
    var fallbackLevel = String((payload && payload.level) || 'info');
    if (typeof toast === 'function')
      toast(message, fallbackLevel === 'success' ? 'ok' : fallbackLevel === 'error' ? 'err' : 'info');
    return null;
  }
  var id = String((payload && payload.id) || ''),
    key = cardFrontendToastKey(live, id),
    level = String((payload && payload.level) || 'info');
  if (['info', 'success', 'warning', 'error'].indexOf(level) < 0) level = 'info';
  var node = document.createElement('section'),
    content = document.createElement('div'),
    title = String((payload && payload.title) || ''),
    body = cardFrontendToastNeutralizeStyles(cardFrontendToastBody(message, options.escapeHtml === true)),
    close = null,
    progress = null,
    timeOut = cardFrontendToastNumber(options.timeOut, 2800),
    extended = cardFrontendToastNumber(options.extendedTimeOut, 0),
    record = {
      key: key,
      id: id,
      live: live,
      node: node,
      timer: null,
      removeTimer: null,
      remaining: timeOut,
      startedAt: 0,
      closed: false,
      options: options,
    };
  node.className = 'toast card-frontend-toast level-' + level;
  node.setAttribute('role', level === 'error' || level === 'warning' ? 'alert' : 'status');
  node.setAttribute('data-yeyu-toast-id', id);
  content.className = 'card-frontend-toast-content';
  if (title) {
    var heading = document.createElement('div');
    heading.className = 'card-frontend-toast-title';
    heading.textContent = title;
    content.appendChild(heading);
  }
  Array.from(body.querySelectorAll('button')).forEach(function (button) {
    button.type = 'button';
  });
  content.appendChild(body);
  node.appendChild(content);
  if (options.closeButton === true) {
    close = document.createElement('button');
    close.type = 'button';
    close.className = 'card-frontend-toast-close';
    close.setAttribute('aria-label', '关闭通知');
    close.innerHTML = uiIcon('close');
    node.appendChild(close);
  }
  if (options.progressBar === true && timeOut > 0) {
    progress = document.createElement('div');
    progress.className = 'card-frontend-toast-progress';
    progress.style.setProperty('--yeyu-toast-duration', timeOut + 'ms');
    node.appendChild(progress);
  }
  node.addEventListener('click', function (event) {
    if (close && event.target === close) {
      event.preventDefault();
      event.stopPropagation();
      cardFrontendToastFinish(record);
      return;
    }
    if (typeof options.onclick === 'function') {
      try {
        options.onclick.call(record.proxy, event);
      } catch (error) {
        setTimeout(function () {
          throw error;
        }, 0);
      }
    }
    if (options.tapToDismiss === true) cardFrontendToastFinish(record);
  });
  node.addEventListener('pointerenter', function () {
    if (record.closed || !record.timer) return;
    record.remaining = Math.max(0, record.remaining - (Date.now() - record.startedAt));
    clearTimeout(record.timer);
    record.timer = null;
    node.classList.add('is-paused');
  });
  node.addEventListener('pointerleave', function () {
    if (record.closed) return;
    node.classList.remove('is-paused');
    var delay = extended > 0 ? extended : record.remaining;
    if (delay > 0) cardFrontendToastSchedule(record, delay);
  });
  if (options.newestOnTop === true && container.firstChild) container.insertBefore(node, container.firstChild);
  else container.appendChild(node);
  record.proxy = {
    0: node,
    length: 1,
    __yeyuToastId: id,
    find: function (selector) {
      var nodes = Array.from(node.querySelectorAll(String(selector || '')));
      nodes.on = function (name, handler) {
        var event = String(name || '').split('.')[0];
        nodes.forEach(function (item) {
          item.addEventListener(event, handler);
        });
        return nodes;
      };
      nodes.off = function () {
        return nodes;
      };
      nodes.remove = function () {
        nodes.forEach(function (item) {
          item.remove();
        });
        return nodes;
      };
      return nodes;
    },
    remove: function () {
      cardFrontendToastFinish(record);
    },
  };
  _cardFrontendToasts.set(key, record);
  if (timeOut > 0) cardFrontendToastSchedule(record, timeOut);
  if (typeof options.onShown === 'function') {
    try {
      options.onShown.call(record.proxy);
    } catch (error) {
      setTimeout(function () {
        throw error;
      }, 0);
    }
  }
  return record.proxy;
}
function cardFrontendToastClear(live, id) {
  var wanted = String(id || ''),
    cleared = 0;
  Array.from(_cardFrontendToasts.values()).forEach(function (record) {
    if (record.live !== live || (wanted && record.id !== wanted)) return;
    if (cardFrontendToastFinish(record)) cleared++;
  });
  return cleared;
}
function cardFrontendClearToasts(live) {
  return cardFrontendToastClear(live, '');
}
function cardFrontendDirectToast(token, source, level, message, title, options, eventSource) {
  var live = cardFrontendLiveForToken(token, source);
  if (!live || _cardFrontendRetiring.has(live.token)) throw new Error('卡片运行实例已经失效');
  cardFrontendRequireCurrent(live);
  cardFrontendEventSourceOptions(live, eventSource);
  if (cardFrontendInDryRun(live)) return null;
  return cardFrontendToastShow(live, {
    id: 't' + ++_cardFrontendSeq,
    level: level,
    message: message,
    title: title,
    options: options,
  });
}
function cardFrontendDirectToastClear(token, source, id, eventSource) {
  var live = cardFrontendLiveForToken(token, source);
  if (live) cardFrontendEventSourceOptions(live, eventSource);
  return live && cardFrontendLiveIsCurrent(live) ? cardFrontendToastClear(live, id) : 0;
}
function cardFrontendDirectNotify(token, source, type, payload, eventSource) {
  var live = cardFrontendLiveForToken(token, source),
    retiring = live && _cardFrontendRetiring.get(live.token);
  if (!live) return;
  cardFrontendEventSourceOptions(live, eventSource);
  payload = payload || {};
  type = String(type || '');
  if (type === 'shutdownComplete') {
    cardFrontendFinalizeRetire(live);
    return;
  }
  if (type === 'sillyTavernEventResult') {
    var eventId = String(payload.eventId || ''),
      waiter = _cardScriptEventWaiters.get(eventId);
    if (waiter) {
      // The event may itself switch the active conversation. Its originating frame,
      // captured when dispatched, owns the reply regardless of the current UI, so the
      // eventId plus that frame already determine where this receipt belongs.
      if (waiter.live !== live) return false;
      _cardScriptEventWaiters.delete(eventId);
      waiter.resolve(payload);
      return;
    }
    if (retiring || !cardFrontendLiveIsCurrent(live)) return false;
    cardScriptSendInterceptResult(live, payload);
    return;
  }
  if (retiring) return;
  if (!cardFrontendLiveIsCurrent(live)) return false;
  if (type === 'globalWait') {
    var globalName = String(payload.name || '脚本组件'),
      noticeKey = 'global-wait-' + globalName;
    live.visibleRuntimeNotices = live.visibleRuntimeNotices || {};
    if (!live.visibleRuntimeNotices[noticeKey]) {
      live.visibleRuntimeNotices[noticeKey] = true;
      if (typeof toast === 'function') toast('卡片仍在等待 ' + globalName + ' 初始化，超时后会结束本次等待', 'info');
    }
    return;
  }
  // The frame announces itself once its bridge is running; its own render follows when its scripts
  // have run (see cardFrontendDeliverOwnRender).
  if (type === 'ready') {
    cardFrontendDeliverOwnRender(live);
    return;
  }
  if (type === 'libraryReady') {
    if (live.kind === 'library') {
      var failures = Array.isArray(payload.failures) ? payload.failures : [];
      live.state = 'ready';
      // A row that failed to load is exactly one dead script; the rest of the library is running and
      // must keep answering generation events, so the failure stays on that row.
      failures.forEach(function (row) {
        cardScriptLibraryRecordScriptFailure(
          live,
          row && row.id,
          row && row.name,
          String((row && row.message) || '加载失败')
        );
      });
      if (live.readyResolve) {
        live.readyResolve(live);
        live.readyResolve = null;
      }
      var context = cardFrontendRequireCurrent(live),
        char = context.char,
        session = context.session;
      refreshCardScriptLibraryContext(char, session);
      failures.forEach(function (row) {
        var message =
          '脚本库「' +
          String((row && row.name) || '未命名脚本') +
          '」加载失败：' +
          String((row && row.message) || '未知错误');
        if (typeof toast === 'function') toast(message, 'err');
      });
      var queued = (live.sillyTavernPending || []).slice();
      live.sillyTavernPending = [];
      // One at a time, each awaited as ST awaits it, so the chat's opening events keep their order.
      queued.reduce(function (previous, event) {
        return previous.then(function () {
          if (live !== _cardScriptLibraryLive) return;
          return cardScriptLibrarySillyTavernEmitAsync(event.name, event.args, live).catch(function (error) {
            if (live === _cardScriptLibraryLive) cardFrontendReportEventError(live, error, event.name);
          });
        });
      }, Promise.resolve());
      if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(char);
    }
    return;
  }
  if (type === 'libraryFailed') {
    if (live.kind === 'library') {
      live.state = 'failed';
      live.lastError = String(payload.message || '脚本库启动失败');
      if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(cardFrontendCharacter(live));
      if (typeof toast === 'function') toast('卡片脚本库启动失败：' + live.lastError, 'err');
    }
    return;
  }
  if (type === 'height') {
    var height = Math.max(0, Math.floor(Number(payload.height) || 0)),
      previous = Math.max(0, Math.floor(Number(live.appliedHeight) || 0));
    if (live.fullscreenActive) return;
    cardFrontendApplyHostContainerStyles(live, false);
    // A freshly remounted frame can report 0 before its document paints. That must not undo the
    // reserved box or the chat layout collapses again.
    if (height <= 0 && previous > 0) return;
    if (height <= 0) return;
    var normal = cardFrontendApplyNormalGeometry(live, height, true),
      following = normal.layoutChanged && cardFrontendChatBottomFollowing();
    live.heightReady = true;
    cardFrontendRememberHeight(live.key, height, live.normalGeometry && live.normalGeometry.width);
    if (normal.layoutChanged && !following) cardFrontendNotifyLayout(live);
    // Whoever was waiting for this frame's height — the render that opened the chat, a generation
    // following the bottom — is placing the reading position for this round and has the last word
    // over the frame's own compensation, which was sampled before the height arrived.
    cardFrontendFlushHeightWaiters(live);
    // A live bottom follow outranks them as well. Pinning before them meant pinning again after
    // them; going last writes the newest message once and skips the write when it is already there.
    if (following) cardFrontendNotifyLayout(live);
    // The frontend that was holding the start queue has laid out; the next one may begin.
    if (_cardFrontendMountingKey === live.key) cardFrontendReleaseMountGate(true);
    return;
  }
  if (type === 'fullscreenScroll') {
    var delta = Number(payload.delta) || 0;
    if (live.fullscreenActive && delta) {
      (live.canvas || live.slot).scrollTop += delta;
      cardFrontendSyncFullscreenViewport(live);
    }
    return;
  }
  if (type === 'normalScroll') return cardFrontendScrollChat(live, payload.delta);
  if (type === 'fullscreenContentSize') {
    var contentSize = {
        width: Math.max(1, Number(payload.width) || 0),
        height: Math.max(1, Number(payload.height) || 0),
      },
      previousSize = objectRecord(live.fullscreenContentSize) || {};
    if (
      live.fullscreenActive &&
      live.fullscreenMode === 'desktop' &&
      (Math.abs(contentSize.width - (Number(previousSize.width) || 0)) >= 1 ||
        Math.abs(contentSize.height - (Number(previousSize.height) || 0)) >= 1)
    ) {
      live.fullscreenContentSize = contentSize;
      cardFrontendApplyFullscreenLayout(live, { force: true, preserve: true });
    }
    return;
  }
  if (type === 'fullscreenGesture') {
    cardFrontendFullscreenGesture(live, payload);
    return;
  }
  if (type === 'error') {
    if (cardFrontendIgnoresRuntimeError(payload.message)) return;

    if (live.kind === 'library') {
      var message = String(payload.message || '脚本库运行出错'),
        failedScript = String(payload.scriptId || ''),
        changed;
      if (failedScript) changed = cardScriptLibraryRecordScriptFailure(live, failedScript, payload.scriptName, message);
      else if (live.state === 'loading') {
        // Nothing has reported ready yet, so no script is known to be running and the ready promise
        // has nothing left to resolve it: a send must fail here instead of waiting for a frame that
        // never started.
        changed = live.state !== 'failed' || live.lastError !== message;
        live.state = 'failed';
        live.lastError = message;
      } else {
        // The library is demonstrably running; an error nothing can be pinned on stays a warning so
        // the scripts that are alive keep answering generation events.
        changed = live.lastError !== message;
        live.lastError = message;
      }
      if (typeof renderCardScriptStatus === 'function') renderCardScriptStatus(cardFrontendCharacter(live));
      if (changed && typeof toast === 'function') toast('卡片脚本运行失败：' + message, 'err');
    } else cardFrontendNote(live.node, '卡片前端报错：' + String(payload.message || ''), 'err');
    return;
  }
  if (type === 'userAction') {
    cardFrontendBeginInteraction(live);
    CardFrontendGenerationCycle.resume();
    return;
  }
  if ((type === 'variables' || type === 'settings') && cardFrontendInDryRun(live)) {
    cardFrontendDryRunCall(live, type);
    return;
  }
  if (type === 'variables') {
    try {
      cardFrontendWriteVariables(live, payload);
    } catch (error) {
      cardFrontendNote(live.node, '卡片前端写入变量失败：' + String((error && error.message) || error), 'err');
    }
    return;
  }
  if (type === 'settings') {
    Promise.resolve()
      .then(function () {
        return cardFrontendPersistExtensionSettings(live, payload.extensionSettings, false);
      })
      .catch(function (error) {
        cardFrontendSettingsSaveFailed(error, live);
      });
    return;
  }
}
function cardFrontendToggleFullscreenMenu(button, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var root = button && button.closest && button.closest('.msg-more');
  if (!root) return false;
  var open = !root.classList.contains('open');
  if (typeof closeMessageMore === 'function') closeMessageMore(root);
  else
    document.querySelectorAll('.msg-more.open').forEach(function (node) {
      if (node !== root) {
        node.classList.remove('open');
        var toggle = node.querySelector('.msg-more-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });
  root.classList.toggle('open', open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  var menu = root.querySelector('.msg-more-menu');
  if (menu) {
    menu.style.removeProperty('transform');
    if (open) {
      var rect = menu.getBoundingClientRect(),
        view = window.visualViewport,
        offset = cardFrontendMenuViewportOffset(rect, {
          left: Number(view && view.offsetLeft) || 0,
          top: Number(view && view.offsetTop) || 0,
          width: Number((view && view.width) || window.innerWidth) || 1,
          height: Number((view && view.height) || window.innerHeight) || 1,
        });
      menu.style.transform = 'translate3d(' + offset.x + 'px,' + offset.y + 'px,0)';
    }
  }
  return open;
}
function cardFrontendBind() {
  if (_cardFrontendBound || typeof document === 'undefined') return;
  _cardFrontendBound = true;
  document.addEventListener('fullscreenchange', cardFrontendSyncFullscreen);
  document.addEventListener('webkitfullscreenchange', cardFrontendSyncFullscreen);
  var resizeFrame = 0,
    scheduleResize = function () {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(function () {
        resizeFrame = 0;
        cardFrontendResizeFullscreen();
        cardFrontendScheduleFrames();
      });
    };
  // Scroll does not bubble, and the chat host is replaced when the page is rebuilt, so the capture
  // phase on the document is what reliably reports every chat scroll.
  document.addEventListener(
    'scroll',
    function (event) {
      var node = event && event.target;
      if (node && node.id === 'chat-messages') cardFrontendNoteChatScroll();
    },
    true
  );
  if (typeof ResizeObserver === 'function') {
    _cardFrontendLayoutObserver = new ResizeObserver(scheduleResize);
    var host = document.getElementById('chat-messages');
    if (host) _cardFrontendLayoutObserver.observe(host);
  }
  if (typeof MutationObserver === 'function' && document.documentElement) {
    _cardFrontendHostStyleObserver = new MutationObserver(function (rows) {
      rows.forEach(cardFrontendInspectHostStyleMutation);
    });
    _cardFrontendHostStyleObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    _cardFrontendHostInlineStyleObserver = new MutationObserver(function (rows) {
      rows.forEach(cardFrontendInspectHostStyleMutation);
    });
  }
  window.addEventListener('resize', scheduleResize);
  if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function')
    window.visualViewport.addEventListener('resize', scheduleResize);
  document.addEventListener(
    'pointerdown',
    function (event) {
      if (event.isTrusted !== false) {
        _cardFrontendLive.forEach(cardFrontendClearInteraction);
        CardFrontendGenerationCycle.resume();
      }
    },
    true
  );
  document.addEventListener(
    'keydown',
    function (event) {
      if (event.isTrusted !== false) {
        _cardFrontendLive.forEach(cardFrontendClearInteraction);
        CardFrontendGenerationCycle.resume();
      }
    },
    true
  );
  document.addEventListener('click', function (event) {
    var button =
      event.target && event.target.closest
        ? event.target.closest(
            '.yeyu-card-frontend-stop,.yeyu-card-frontend-reload,.yeyu-card-frontend-fullscreen-toggle,.yeyu-card-frontend-fullscreen-action'
          )
        : null;
    if (!button) return;
    if (button.classList.contains('yeyu-card-frontend-fullscreen-toggle')) {
      cardFrontendToggleFullscreenMenu(button, event);
      return;
    }
    if (button.classList.contains('yeyu-card-frontend-fullscreen-action')) {
      event.preventDefault();
      var menu = button.closest('.msg-more');
      if (menu) {
        menu.classList.remove('open');
        var toggle = menu.querySelector('.msg-more-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
      if (typeof closeMessageMore === 'function') closeMessageMore();
      openCardFrontendFullscreen(button.getAttribute('data-frontend-key'), button.getAttribute('data-frontend-mode'));
      return;
    }
    var node = button.closest('.yeyu-card-frontend'),
      key = node && String(node.getAttribute('data-frontend-key') || '');
    if (!key) return;
    event.preventDefault();
    if (button.classList.contains('yeyu-card-frontend-stop')) {
      stopCardFrontend(key);
      if (typeof toast === 'function') toast('已停止这段卡片前端', 'ok');
      return;
    }
    resumeCardFrontend(key);
  });
}
