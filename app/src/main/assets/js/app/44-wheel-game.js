// ===== Deterministic wheel scheme game =====
var WHEEL_SCHEME_SPIN_MS = 2400,
  WHEEL_SCHEME_LABEL_MIN_SWEEP = 18,
  WHEEL_SCHEME_SOUND_WAIT_MS = 400,
  WHEEL_SCHEME_SOUND_CLIPS = [
    { name: 'tick', path: 'audio/wheel/tick.wav' },
    { name: 'settle', path: 'audio/wheel/settle.wav' },
  ],
  _wheelSchemeGameId = '',
  _wheelSchemeBusy = false,
  _wheelSchemeModalState = null,
  _wheelSchemeRequestController = null,
  _wheelSchemeRequestItem = null,
  _wheelSchemeBiographyLive = wheelSchemeBiographyLiveState(),
  _wheelSchemeStatsExpanded = false,
  _wheelSchemeFeedView = {
    following: true,
    writtenTop: -1,
    lastTop: 0,
    dragTop: -1,
    dragFollowing: false,
    bound: false,
  },
  _wheelSchemeFormulaNotices = new Set();
// The biography stream as it is being drawn: the text so far, when the reasoning started and how long it
// ran (frozen by the first body text, like the chat's reasoning card), and whether the reader opened it.
function wheelSchemeBiographyLiveState() {
  return { content: '', reasoning: '', startedAt: 0, elapsedMs: 0, open: false, frame: 0, ticker: 0 };
}
function activeWheelSchemeId() {
  return _wheelSchemeGameId;
}
function activeWheelSchemeItem() {
  return wheelSchemeById(_wheelSchemeGameId);
}
function wheelSchemeRandom() {
  if (window.crypto && typeof crypto.getRandomValues === 'function') {
    var values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 4294967296;
  }
  return Math.random();
}
function wheelSchemePoint(angle, radius) {
  var radians = (angle * Math.PI) / 180;
  return { x: 160 + radius * Math.cos(radians), y: 160 + radius * Math.sin(radians) };
}
// Existing schemes keep their identity-hue ring. New schemes cycle their saved source colours after
// spreading near-identical hues, preserving the same colour families as the scheme surface.
function wheelSchemePalette(count, sourceColors) {
  var rgb = getComputedStyle($('wheel-scheme-spin-modal'))
      .getPropertyValue('--accent-rgb')
      .match(/[\d.]+/g),
    pure = pureApi(),
    source = pure.rgbToOklch(Number(rgb[0]), Number(rgb[1]), Number(rgb[2])),
    multi = paletteHexList(sourceColors).slice(0, 4),
    multiHues =
      multi.length >= 3
        ? pure.spreadHues(
            multi.map(function (hex) {
              return hexOklch(hex).H;
            }),
            32
          )
        : [],
    used = new Set(),
    palette = [];
  for (var index = 0; index < count; index++) {
    var lightness = 0.76,
      chroma = 0.085,
      hue =
        multi.length >= 3
          ? multiHues[index % multiHues.length]
          : source.H + (360 * index) / count;
    if (multiHues.length > 1 && index === count - 1 && count > multiHues.length && index % multiHues.length === 0)
      hue = multiHues[1];
    if (count > 8) {
      lightness = index % 2 ? 0.62 : 0.76;
      chroma = index % 2 ? 0.1 : 0.085;
      // An odd ring cannot alternate at both ends; blend its closing sector between the two levels.
      if (count % 2 && index === count - 1) {
        lightness = 0.69;
        chroma = 0.09;
      }
    }
    var fill = pure.oklchToHex(lightness, chroma, hue);
    // Resolve 8-bit rounding collisions locally without changing the evenly spaced hue sequence.
    for (var offset = 1; used.has(fill); offset++) {
      fill = pure.oklchToHex(lightness + ((offset % 2 ? 1 : -1) * Math.ceil(offset / 2)) / 1000, chroma, hue);
    }
    used.add(fill);
    palette.push({
      fill: fill,
      ink: pure.contrastRatio('#000000', fill) >= pure.contrastRatio('#ffffff', fill) ? '#000000' : '#ffffff',
    });
  }
  return palette;
}
function wheelSchemeSvgHtml(options, weightResolver, palette) {
  var rows = Array.isArray(options) ? options : [],
    resolveWeight =
      typeof weightResolver === 'function'
        ? weightResolver
        : function (option) {
            return Number(option && option.weight);
          },
    weights = rows.map(function (option) {
      var weight = Number(resolveWeight(option));
      return Number.isFinite(weight) && weight > 0 ? weight : 1;
    }),
    total = weights.reduce(function (sum, weight) {
      return sum + weight;
    }, 0),
    colors = palette || wheelSchemePalette(rows.length),
    style = getComputedStyle(document.documentElement),
    fontSize = parseFloat(style.getPropertyValue('--type-control')),
    measure = document.createElement('canvas').getContext('2d'),
    angle = -90,
    html = '';
  measure.font = '600 ' + fontSize + 'px ' + style.getPropertyValue('--font');
  rows.forEach(function (option, index) {
    var sweep = (weights[index] / total) * 360,
      start = wheelSchemePoint(angle, 156),
      end = wheelSchemePoint(angle + sweep, 156),
      large = sweep > 180 ? 1 : 0,
      mid = angle + sweep / 2,
      labelPoint = wheelSchemePoint(mid, 96),
      rotation = mid > 90 && mid < 270 ? mid + 180 : mid,
      // Keep the label between the center button and rim. Narrow wedges move its inner edge outward.
      innerRadius = Math.max(40, (fontSize / 2 + 4) / Math.tan((Math.min(sweep, 180) * Math.PI) / 360)),
      maxWidth = Math.min(104, 2 * (96 - innerRadius)),
      label = String(option.text || '');
    var attributes =
      ' class="wheel-scheme-sector" data-sweep="' +
      sweep.toFixed(6) +
      '" style="--wheel-sector-fill:' +
      colors[index].fill +
      '"';
    html +=
      rows.length === 1
        ? '<circle' + attributes + ' cx="160" cy="160" r="156"></circle>'
        : '<path' +
          attributes +
          ' d="M160 160 L' +
          start.x.toFixed(6) +
          ' ' +
          start.y.toFixed(6) +
          ' A156 156 0 ' +
          large +
          ' 1 ' +
          end.x.toFixed(6) +
          ' ' +
          end.y.toFixed(6) +
          ' Z"></path>';
    if (sweep >= WHEEL_SCHEME_LABEL_MIN_SWEEP) {
      if (measure.measureText(label).width > maxWidth) {
        var letters = Array.from(label);
        while (letters.length && measure.measureText(letters.join('') + '…').width > maxWidth) letters.pop();
        label = letters.join('') + '…';
      }
      html +=
        '<text style="--wheel-sector-ink:' +
        colors[index].ink +
        '" data-sector="' +
        index +
        '" x="' +
        labelPoint.x.toFixed(2) +
        '" y="' +
        labelPoint.y.toFixed(2) +
        '" transform="rotate(' +
        rotation.toFixed(2) +
        ' ' +
        labelPoint.x.toFixed(2) +
        ' ' +
        labelPoint.y.toFixed(2) +
        ')">' +
        esc(label) +
        '</text>';
    }
    angle += sweep;
  });
  return html;
}
function wheelSchemeProgressCopy(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}
function wheelSchemeNormalizedProgress(item, scheme) {
  var source = item && item.progress && typeof item.progress === 'object' ? item.progress : {},
    normalized = YeyuWheelScheme.normalizeProgress(scheme, source);
  Object.keys(normalized).forEach(function (key) {
    source[key] = normalized[key];
  });
  delete source.pendingNarration;
  source.turns = normalized.turns;
  if (item) item.progress = source;
  return source;
}
function wheelSchemeAvailableRows(scheme, wheel, progress) {
  return YeyuWheelScheme.availableOptions(scheme, wheel, progress).map(function (row) {
    return { option: row.option, weight: YeyuWheelScheme.optionWeight(scheme, row.option, progress.stats || {}) };
  });
}
function wheelSchemeRotationForOption(scheme, wheel, progress, option) {
  var rows = wheelSchemeAvailableRows(scheme, wheel, progress),
    total = rows.reduce(function (sum, row) {
      return sum + row.weight;
    }, 0),
    before = 0,
    target = rows.findIndex(function (row) {
      return row.option.id === option.id;
    });
  if (target < 0 || total <= 0) return 2160;
  for (var i = 0; i < target; i++) before += (rows[i].weight / total) * 360;
  var sweep = (rows[target].weight / total) * 360,
    jitter = sweep * (0.2 + wheelSchemeRandom() * 0.6);
  return 2160 - (before + jitter);
}
// Blocks and tags read big values in 万 or 亿 (one decimal at most); the expanded panel shows them in full.
// The unit is chosen on the value as it will be shown, so rounding never reads 10000 or 10000万.
function wheelSchemeCompactNumber(value) {
  var number = Number(value),
    shown = Math.abs(Number(YeyuWheelScheme.formatNumber(number)));
  if (!Number.isFinite(number) || shown < 1e4) return YeyuWheelScheme.formatNumber(value);
  var tenths = Math.round(shown / 1e3),
    unit = '万';
  if (tenths >= 1e5) {
    tenths = Math.round(shown / 1e7);
    unit = '亿';
  }
  return (number < 0 ? '-' : '') + tenths / 10 + unit;
}
function wheelSchemeDeltaText(delta, full) {
  return (delta > 0 ? '+' : '') + (full ? YeyuWheelScheme.formatNumber(delta) : wheelSchemeCompactNumber(delta));
}
function wheelSchemeTurnEndStats(turn) {
  var records = (turn && turn.records) || [];
  for (var index = records.length - 1; index >= 0; index--) {
    var stats = records[index] && records[index].stats;
    if (stats && typeof stats === 'object') return stats;
  }
  return turn && turn.afterStats && typeof turn.afterStats === 'object' ? turn.afterStats : null;
}
// What the latest turn changed, by visible stat id. It compares snapshots instead of trusting the records'
// own change lists, which older saves lack: the stats after the previous turn — for the first turn the
// scheme's initial values, so the automatic wheels folded into it count too — against the current stats.
// Derived stats are evaluated on both sides. A previous turn without any snapshot yields no changes.
function wheelSchemeLatestTurnChanges(scheme, progress) {
  var turns = (progress && progress.turns) || [],
    before = turns.length > 1 ? wheelSchemeTurnEndStats(turns[turns.length - 2]) : null,
    changes = new Map();
  if (turns.length === 1) before = YeyuWheelScheme.initialStats(scheme);
  if (!before) return changes;
  YeyuWheelScheme.visibleChanges(scheme, before, progress.stats || {}).forEach(function (stat) {
    changes.set(stat.id, stat.delta);
  });
  return changes;
}
function wheelSchemeTurnBadgeHtml(number) {
  return '<span class="wheel-game-turn-badge">第 ' + Math.max(1, Number(number) || 1) + ' 转</span>';
}
function wheelSchemeRecordChangesHtml(record) {
  var changes = Array.isArray(record.changedStats)
    ? record.changedStats.filter(function (stat) {
        return stat && Number.isFinite(Number(stat.delta));
      })
    : null;
  if (!changes) return record.changedStatsText ? '<p>' + esc(String(record.changedStatsText)) + '</p>' : '';
  if (!changes.length) return '';
  return (
    '<ul class="wheel-game-record-changes">' +
    changes
      .map(function (stat) {
        return (
          '<li>' +
          esc(String(stat.name || stat.id || '')) +
          '<b>' +
          esc(wheelSchemeDeltaText(Number(stat.delta))) +
          '</b></li>'
        );
      })
      .join('') +
    '</ul>'
  );
}
function wheelSchemeRecordHtml(record) {
  record = record || {};
  return (
    '<div class="wheel-game-record"><div class="wheel-game-record-result"><span>' +
    esc(String(record.wheelName || record.wheelId || '转盘')) +
    '</span><strong>' +
    esc(String(record.label || record.optionId || '结果')) +
    '</strong></div>' +
    (record.note ? '<p>' + esc(String(record.note)) + '</p>' : '') +
    wheelSchemeRecordChangesHtml(record) +
    '</div>'
  );
}
function wheelSchemeTurnHtml(turn) {
  return (
    '<article class="wheel-game-turn">' +
    wheelSchemeTurnBadgeHtml(turn && turn.number) +
    ((turn && turn.records) || []).map(wheelSchemeRecordHtml).join('') +
    '</article>'
  );
}
// The first three visible stats are attribute blocks, the rest compact tags that stay within two rows until
// the panel is expanded; the latest turn's changes are marked on both. Collapsed values abbreviate to 万,
// the expanded panel shows every tag and every value in full.
function wheelSchemeStatsHtml(scheme, progress) {
  var stats = YeyuWheelScheme.visibleStats(scheme, progress.stats || {});
  if (!stats.length) return '<p class="wheel-game-stats-empty">这个方案没有可见数值</p>';
  var changes = wheelSchemeLatestTurnChanges(scheme, progress),
    full = _wheelSchemeStatsExpanded,
    abbreviated = stats.some(function (stat) {
      return (
        wheelSchemeCompactNumber(stat.value) !== YeyuWheelScheme.formatNumber(stat.value) ||
        (changes.has(stat.id) &&
          wheelSchemeDeltaText(changes.get(stat.id)) !== wheelSchemeDeltaText(changes.get(stat.id), true))
      );
    }),
    rest = stats.slice(3),
    value = function (stat) {
      return esc(full ? YeyuWheelScheme.formatNumber(stat.value) : wheelSchemeCompactNumber(stat.value));
    },
    delta = function (stat) {
      return changes.has(stat.id)
        ? '<span class="wheel-game-delta">' + esc(wheelSchemeDeltaText(changes.get(stat.id), full)) + '</span>'
        : '';
    },
    blocks = stats
      .slice(0, 3)
      .map(function (stat) {
        return (
          '<div class="wheel-game-attr"><div class="wheel-game-attr-hd"><span>' +
          esc(stat.name) +
          '</span>' +
          delta(stat) +
          '</div><strong>' +
          value(stat) +
          '</strong></div>'
        );
      })
      .join(''),
    tags = rest
      .map(function (stat) {
        return (
          '<li class="wheel-game-tag' +
          (changes.has(stat.id) ? ' changed' : '') +
          '"><span>' +
          esc(stat.name) +
          '</span><b>' +
          value(stat) +
          '</b>' +
          delta(stat) +
          '</li>'
        );
      })
      .join(''),
    toggle =
      rest.length || abbreviated
        ? '<button type="button" class="wheel-game-stats-toggle" aria-expanded="' +
          full +
          '" onclick="toggleWheelSchemeStats()">' +
          (full ? '收起' : '全部 ' + stats.length + ' 项') +
          '</button>'
        : '<span class="wheel-game-stats-count">' + stats.length + ' 项</span>';
  return (
    '<div class="wheel-game-stats-hd"><h2>数值</h2>' +
    toggle +
    '</div><div class="wheel-game-attrs" style="--wheel-attr-count:' +
    Math.min(3, stats.length) +
    '">' +
    blocks +
    '</div>' +
    (rest.length
      ? '<ul class="wheel-game-tags" aria-label="其余数值"' + (full ? ' data-expanded' : '') + '>' + tags + '</ul>'
      : '')
  );
}
function toggleWheelSchemeStats() {
  var item = activeWheelSchemeItem(),
    panel = $('wheel-game-stats');
  if (!item || !panel) return false;
  _wheelSchemeStatsExpanded = !_wheelSchemeStatsExpanded;
  panel.innerHTML = wheelSchemeStatsHtml(normalizedWheelScheme(item), item.progress);
  pinWheelSchemeFeed();
  return true;
}
// The feed follows its bottom while text streams in, the way the chat does: only a gesture that scrolls
// (a drag, the wheel or a scroll key, by the chat's own test) can let go, and only when it heads away from
// the bottom of a feed that can move; a tap, such as opening the reasoning card, never does. The feed
// follows again wherever the reader brings it back to the bottom. Programmatic repaints never pull a
// released feed back; opening the game, spinning and regenerating do follow again.
function wheelSchemeFeedAtBottom(feed, slack) {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight <= slack;
}
function writeWheelSchemeFeedTop(feed, top) {
  feed.scrollTop = top;
  _wheelSchemeFeedView.writtenTop = feed.scrollTop;
  _wheelSchemeFeedView.lastTop = feed.scrollTop;
}
function pinWheelSchemeFeed() {
  var feed = $('wheel-game-feed');
  if (feed && _wheelSchemeFeedView.following) writeWheelSchemeFeedTop(feed, feed.scrollHeight);
}
function followWheelSchemeFeed() {
  _wheelSchemeFeedView.following = true;
  pinWheelSchemeFeed();
}
// Whether a scroll gesture moves the feed up. A drag's direction is only known once the feed moves, so
// any drag of a feed taller than its box counts; the wheel and keys say their direction up front, and
// those heading down can only bring the feed back to its bottom.
function wheelSchemeFeedGestureLeavesBottom(feed, event) {
  if (!isChatViewportScrollIntent(event)) return false;
  if (event.type === 'touchmove') return feed.scrollHeight - feed.clientHeight > 1;
  if (feed.scrollTop <= 0) return false;
  if (event.type === 'wheel') return event.deltaY < 0;
  return /^(ArrowUp|PageUp|Home)$/.test(event.key) || (event.key === ' ' && event.shiftKey);
}
function bindWheelSchemeFeedFollow(feed) {
  var view = _wheelSchemeFeedView;
  if (view.bound || !feed) return;
  view.bound = true;
  var intend = function (event) {
    if (!wheelSchemeFeedGestureLeavesBottom(feed, event)) return;
    if (event.type === 'touchmove' && view.dragTop < 0) {
      view.dragTop = feed.scrollTop;
      view.dragFollowing = view.following;
    }
    view.following = false;
    view.writtenTop = -1;
  };
  // The feed takes focus so its scroll keys reach it; keyboard scrolling moves the focused scroller.
  ['touchmove', 'wheel', 'keydown'].forEach(function (name) {
    feed.addEventListener(name, intend, { passive: true });
  });
  // Only a reader who was following before this drag can keep following without reaching the end.
  // A released reader stays released after a sideways or downward drag in the middle of the feed.
  ['touchend', 'touchcancel'].forEach(function (name) {
    feed.addEventListener(
      name,
      function () {
        if (view.dragFollowing && view.dragTop >= 0 && feed.scrollTop >= view.dragTop) view.following = true;
        view.dragTop = -1;
        view.dragFollowing = false;
      },
      { passive: true }
    );
  });
  feed.addEventListener(
    'scroll',
    function () {
      var top = feed.scrollTop;
      if (view.writtenTop >= 0 && Math.abs(top - view.writtenTop) <= 1) {
        view.writtenTop = -1;
        view.lastTop = top;
        return;
      }
      view.writtenTop = -1;
      // At the very end (the reader got there, or shrinking content clamped the feed) it follows again;
      // any upward move lets go. A released reader must reach the end before following again.
      if (wheelSchemeFeedAtBottom(feed, 1)) view.following = true;
      else if (top < view.lastTop) view.following = false;
      view.lastTop = top;
    },
    { passive: true }
  );
  // Opening or closing the reasoning card changes the height under a feed that is following its bottom.
  feed.addEventListener('toggle', pinWheelSchemeFeed, true);
}
function stopWheelSchemeBiographyTicker() {
  var live = _wheelSchemeBiographyLive;
  if (live.ticker) clearInterval(live.ticker);
  live.ticker = 0;
}
function resetWheelSchemeBiographyDraft() {
  var live = _wheelSchemeBiographyLive;
  if (live.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(live.frame);
  stopWheelSchemeBiographyTicker();
  _wheelSchemeBiographyLive = wheelSchemeBiographyLiveState();
}
function wheelSchemeBiographyReasoningState() {
  var live = _wheelSchemeBiographyLive;
  if (!live.startedAt) return null;
  return {
    seconds: Math.round((live.elapsedMs || performance.now() - live.startedAt) / 1000),
    thinking: !live.elapsedMs,
    open: live.open,
  };
}
function wheelSchemeBiographyStatusText() {
  var live = _wheelSchemeBiographyLive;
  return live.content ? '正文生成中…' : live.reasoning ? '正在构思，正文稍后开始…' : '正在连接模型…';
}
// The chat's reasoning card, collapsed unless the reader opens it. The reader's choice is read back from
// the card first, then the card is reconciled in place like the chat's stream, so a selection, a tap on
// the title and the card node itself survive every repaint; while the model thinks, the ticker rewrites
// the timer alone.
function paintWheelSchemeBiographyReasoning(slot) {
  var live = _wheelSchemeBiographyLive,
    card = slot.querySelector('details.think-block');
  if (card) live.open = card.open === true;
  var html = reasoningBlockHtml(live.reasoning, null, wheelSchemeBiographyReasoningState());
  // These nodes have fixed roles, independent of their text. Update them before reconciling the card,
  // so a new preview line or the completed timer cannot replace a title being pressed by the reader.
  if (card && html) {
    var template = document.createElement('template');
    template.innerHTML = html;
    var next = template.content.firstElementChild;
    ['.think-title', '.think-preview', '.think-head', 'summary'].forEach(function (selector) {
      reconcileStreamNode(card.querySelector(selector), next.querySelector(selector));
    });
    reconcileStreamNode(card, next);
  } else reconcileStreamHtml(slot, html);
}
function paintWheelSchemeBiographyLive() {
  _wheelSchemeBiographyLive.frame = 0;
  var text = $('wheel-game-biography-live-text'),
    slot = $('wheel-game-biography-live-reasoning'),
    status = $('wheel-game-biography-live-status');
  if (text) text.textContent = _wheelSchemeBiographyLive.content;
  if (slot) paintWheelSchemeBiographyReasoning(slot);
  if (status) status.textContent = wheelSchemeBiographyStatusText();
  pinWheelSchemeFeed();
}
// The reasoning time starts with the first reasoning text and stops at the first body text.
function paintWheelSchemeBiographyProgress(state) {
  var live = _wheelSchemeBiographyLive;
  live.content = String((state && state.content) || '');
  live.reasoning = String((state && state.reasoning) || '');
  if (live.reasoning.trim() && !live.startedAt) {
    live.startedAt = performance.now();
    live.ticker = setInterval(function () {
      var timer = document.querySelector('#wheel-game-biography-live-reasoning .think-timer');
      if (timer) timer.textContent = reasoningTimerText(wheelSchemeBiographyReasoningState());
    }, 1000);
  }
  if (live.content.trim() && live.startedAt && !live.elapsedMs) {
    live.elapsedMs = Math.max(1, performance.now() - live.startedAt);
    stopWheelSchemeBiographyTicker();
  }
  if (live.frame) return;
  if (typeof requestAnimationFrame === 'function') live.frame = requestAnimationFrame(paintWheelSchemeBiographyLive);
  else paintWheelSchemeBiographyLive();
}
function wheelSchemeStageHtml(scheme, progress) {
  // While the biography is written, the stage is its only status line; the feed shows just the text.
  if (progress.pendingBiography && _wheelSchemeBusy)
    return (
      '<div class="wheel-game-live" role="status"><i aria-hidden="true"></i><strong>人物志生成中</strong><span id="wheel-game-biography-live-status">' +
      wheelSchemeBiographyStatusText() +
      '</span></div>'
    );
  if (progress.pendingBiography)
    return (
      '<div class="wheel-game-recovery"><strong>' +
      (progress.automaticError ? '方案无法继续' : '对局已结束') +
      '</strong><p>' +
      (progress.biographyError
        ? '上次人物志生成没有完成：' +
          esc(progress.biographyError) +
          (/[。！？!?]$/.test(String(progress.biographyError || '')) ? '' : '。')
        : '人物志生成曾被中断。') +
      '</p><button type="button" class="btn primary" id="wheel-game-regenerate-biography" onclick="regenerateWheelSchemeBiography()">重新生成人物志</button></div>'
    );
  if (progress.biography) return '<p class="wheel-game-finished">对局已结束，人物志在上方。</p>';
  if (progress.automaticError)
    return (
      '<div class="wheel-game-recovery"><strong>方案无法继续</strong><p>' +
      esc(wheelSchemeAutomaticErrorText(progress.automaticError)) +
      '请检查方案文件。' +
      (Number(progress.turnCount) > 0 ? '已经走过的这几转仍可写成人物志。' : '') +
      '</p>' +
      (Number(progress.turnCount) > 0
        ? '<button type="button" class="btn primary" id="wheel-game-regenerate-biography" onclick="regenerateWheelSchemeBiography()"' +
          (_wheelSchemeBusy ? ' disabled' : '') +
          '>生成人物志</button>'
        : '') +
      '</div>'
    );
  if (progress.status === 'finished' || !progress.currentWheelId)
    return (
      '<div class="wheel-game-finished"><p>所有转盘都已走完。</p><button type="button" class="btn primary" id="wheel-game-regenerate-biography" onclick="regenerateWheelSchemeBiography()"' +
      (_wheelSchemeBusy ? ' disabled' : '') +
      '>生成人物志</button></div>'
    );
  var wheel = YeyuWheelScheme.wheelById(scheme, progress.currentWheelId),
    rows = wheel ? wheelSchemeAvailableRows(scheme, wheel, progress) : [];
  if (!wheel)
    return '<div class="wheel-game-recovery"><strong>当前轮盘不存在</strong><p>方案无法继续，请重新开始这局。</p></div>';
  if (!rows.length)
    return (
      '<div class="wheel-game-finished"><p>“' +
      esc(wheel.name || wheel.id) +
      '”没有剩余结果。</p><button type="button" class="btn primary" onclick="finishWheelSchemeWithoutOption()"' +
      (_wheelSchemeBusy ? ' disabled' : '') +
      '>结束并生成人物志</button></div>'
    );
  var total = rows.reduce(function (sum, row) {
      return sum + row.weight;
    }, 0),
    options = rows
      .map(function (row) {
        var chance = total > 0 ? (row.weight / total) * 100 : 0;
        return (
          '<li><span>' +
          esc(row.option.label || row.option.id) +
          '</span><span class="wheel-game-option-chance">' +
          (chance < 1 ? '&lt;1' : Math.round(chance)) +
          '%</span></li>'
        );
      })
      .join('');
  return (
    '<div class="wheel-game-stage-card"><div class="wheel-game-stage-hd">' +
    wheelSchemeTurnBadgeHtml(Number(progress.turnCount) + 1) +
    '<h2>' +
    esc(wheel.name || wheel.id) +
    '</h2></div><p>' +
    esc(wheel.description || '转动后由本机决定这一转的结果。') +
    '</p><ul class="wheel-game-option-list" aria-label="本轮可能结果与概率">' +
    options +
    '</ul><div class="wheel-game-stage-actions"><button type="button" class="btn text" id="wheel-game-restart" onclick="restartActiveWheelSchemeGame()"' +
    (_wheelSchemeBusy ? ' disabled' : '') +
    '>重新开始</button><button type="button" class="btn primary" id="wheel-game-spin" onclick="spinWheelScheme()"' +
    (_wheelSchemeBusy ? ' disabled' : '') +
    '>' +
    (_wheelSchemeBusy ? '正在保存结果…' : '转动轮盘') +
    '</button></div></div>'
  );
}
// The engine keeps a game going on a broken formula by using the fixed weight or value;
// tell the player once per scheme and problem instead of letting results drift silently.
function noticeWheelSchemeFormulaIssues(item, scheme, progress) {
  var fresh = YeyuWheelScheme.formulaIssues(scheme, progress.stats || {}).filter(function (issue) {
    var key = JSON.stringify([item.id, issue.label, issue.formula, issue.message]);
    if (_wheelSchemeFormulaNotices.has(key)) return false;
    _wheelSchemeFormulaNotices.add(key);
    return true;
  });
  if (!fresh.length) return;
  toast(
    fresh[0].label +
      '无法计算（' +
      fresh[0].message +
      '），已按固定数值继续' +
      (fresh.length > 1 ? '；另有 ' + (fresh.length - 1) + ' 处公式同样无法计算' : ''),
    'err'
  );
}
// The game page and its spin sheet take the scheme's saved colours, never the character background.
function paintWheelSchemeGameColor(item) {
  var colors = wheelSchemePaletteColors(item);
  ['wheel-game-view', 'wheel-scheme-spin-modal'].forEach(function (id) {
    applyPaletteScopeSeeds($(id), colors);
  });
}
function renderWheelSchemeGame() {
  var item = activeWheelSchemeItem(),
    view = $('wheel-game-view');
  if (!item || !view) return false;
  paintWheelSchemeGameColor(item);
  var scheme;
  try {
    scheme = normalizedWheelScheme(item);
  } catch (error) {
    toast('转盘方案无法读取：' + String((error && error.message) || error), 'err');
    return false;
  }
  item.progress = wheelSchemeNormalizedProgress(item, scheme);
  noticeWheelSchemeFormulaIssues(item, scheme, item.progress);
  var progress = item.progress,
    turns = Math.max(0, Number(progress.turnCount) || 0),
    liveBiography = progress.pendingBiography && _wheelSchemeBusy,
    feed = $('wheel-game-feed'),
    readingTop = feed.scrollTop,
    reasoningCard = feed.querySelector('#wheel-game-biography-live-reasoning details.think-block');
  if (reasoningCard) _wheelSchemeBiographyLive.open = reasoningCard.open === true;
  $('wheel-game-title').textContent = scheme.title;
  $('wheel-game-subtitle').textContent =
    progress.status === 'finished' || !progress.currentWheelId
      ? (progress.biography ? '人物志' : '对局已结束') + ' · 共 ' + turns + ' 转'
      : turns
        ? '已走 ' + turns + ' 转'
        : '尚未开始';
  $('wheel-game-stats').innerHTML = wheelSchemeStatsHtml(scheme, progress);
  var html =
    '<p class="wheel-game-opening">' +
    esc(scheme.description || '转动每一轮，由结果共同写成这一次人生。') +
    '</p>' +
    (progress.turns || []).map(wheelSchemeTurnHtml).join('');
  if (liveBiography) {
    html +=
      '<article class="wheel-game-biography wheel-game-biography-live" aria-busy="true"><h3>人物志</h3><div class="wheel-game-biography-thinking" id="wheel-game-biography-live-reasoning">' +
      reasoningBlockHtml(_wheelSchemeBiographyLive.reasoning, null, wheelSchemeBiographyReasoningState()) +
      '</div><div class="wheel-game-biography-text"><span id="wheel-game-biography-live-text">' +
      esc(_wheelSchemeBiographyLive.content) +
      '</span><span class="stream-cursor" aria-hidden="true"></span></div></article>';
  } else if (progress.biography)
    html +=
      '<article class="wheel-game-biography"><h3>本局人物志</h3><div class="wheel-game-biography-text">' +
      esc(progress.biography) +
      '</div><div class="wheel-game-biography-actions"><button type="button" class="btn" onclick="copyWheelSchemeBiography()">复制人物志</button>' +
      (progress.pendingBiography
        ? ''
        : '<button type="button" class="btn" id="wheel-game-regenerate-biography" onclick="regenerateWheelSchemeBiography()">重新生成</button>') +
      '</div></article>';
  feed.innerHTML = html;
  $('wheel-game-stage').innerHTML = wheelSchemeStageHtml(scheme, progress);
  // A released feed keeps the reader's place through the rebuild.
  if (_wheelSchemeFeedView.following) pinWheelSchemeFeed();
  else writeWheelSchemeFeedTop(feed, readingTop);
  return true;
}
async function replaceWheelSchemeProgress(item) {
  var scheme = normalizedWheelScheme(item),
    before = item.progress;
  item.progress = YeyuWheelScheme.createProgress(scheme, wheelSchemeRandom);
  try {
    await saveData('wheels', { urgent: true });
  } catch (error) {
    item.progress = before;
    throw error;
  }
  return item.progress;
}
function openWheelSchemeGame(item) {
  if (!item) return false;
  if (_wheelSchemeGameId !== item.id) _wheelSchemeStatsExpanded = false;
  _wheelSchemeGameId = item.id;
  var view = $('wheel-game-view');
  bindWheelSchemeFeedFollow($('wheel-game-feed'));
  _wheelSchemeFeedView.following = true;
  transitionUiVisibility(
    view,
    true,
    function () {
      view.classList.add('open');
    },
    'dialog'
  );
  if (window.innerWidth <= 768) setSidebarOpen(false);
  renderWheelSchemeGame();
  return true;
}
async function startWheelSchemeGame(id) {
  if (_wheelSchemeBusy) {
    toast('请等当前操作完成', 'info');
    return false;
  }
  var item = wheelSchemeById(id);
  if (!item) return false;
  if (item.progress) return await restartWheelSchemeGame(id);
  try {
    await replaceWheelSchemeProgress(item);
    renderWheelSchemeLibrary();
    openWheelSchemeGame(item);
    return true;
  } catch (error) {
    toast('新对局保存失败，原进度保持不变', 'err');
    return false;
  }
}
function continueWheelSchemeGame(id) {
  if (_wheelSchemeBusy && _wheelSchemeGameId !== id) {
    toast('请等当前操作完成', 'info');
    return false;
  }
  var item = wheelSchemeById(id);
  if (!item || !item.progress) return startWheelSchemeGame(id);
  return openWheelSchemeGame(item);
}
async function restartWheelSchemeGame(id) {
  var item = wheelSchemeById(id);
  if (!item || _wheelSchemeBusy) return false;
  if (
    item.progress &&
    !(await appConfirm('重新开始会覆盖这个方案当前保存的对局和人物志。', '重新开始转盘对局', '重新开始'))
  )
    return false;
  try {
    await replaceWheelSchemeProgress(item);
    renderWheelSchemeLibrary();
    openWheelSchemeGame(item);
    return true;
  } catch (error) {
    toast('重新开始失败，原进度已保留', 'err');
    return false;
  }
}
function restartActiveWheelSchemeGame() {
  return restartWheelSchemeGame(_wheelSchemeGameId);
}
function closeWheelSchemeGame() {
  if (_wheelSchemeRequestItem && _wheelSchemeRequestItem.id === _wheelSchemeGameId && _wheelSchemeRequestController)
    _wheelSchemeRequestController.abort();
  if (_wheelSchemeModalState) closeWheelSchemeSpin();
  var view = $('wheel-game-view');
  if (view) {
    transitionUiVisibility(
      view,
      false,
      function () {
        view.classList.remove('open');
      },
      'dialog'
    );
  }
  if (!_wheelSchemeBusy) _wheelSchemeGameId = '';
  renderWheelSchemeLibrary();
  openSidebarTab('wheels');
  return true;
}
function wheelSchemeBiographyLengthMessage(specialMaxTokens, state) {
  if (String((state && state.content) || '').trim())
    return Number(specialMaxTokens) > 0
      ? '人物志达到输出上限被截断。请在侧边栏“转盘 → 人物志设置”调大输出上限后重试。'
      : '人物志达到模型自身的输出上限被截断。人物志输出上限当前为不限，请换用其他模型后重试。';
  var hasReasoning = !!String((state && state.reasoning) || '').trim();
  // 0 means no cap was sent, so the limit that was hit is the provider's own and there is nothing to raise.
  if (!(Number(specialMaxTokens) > 0))
    return hasReasoning
      ? '人物志达到模型自身的输出上限时仍在思考，正文尚未开始。人物志输出上限当前为不限，请降低此任务的思考档位或换用其他模型后重试。'
      : '人物志达到模型自身的输出上限，但没有返回正文。人物志输出上限当前为不限，请降低此任务的思考档位或换用其他模型后重试。';
  return hasReasoning
    ? '人物志达到输出上限时仍在思考，正文尚未开始。请在侧边栏“转盘 → 人物志设置”调大输出上限，或降低此任务的思考档位后重试。'
    : '人物志达到输出上限，但没有返回正文。请在侧边栏“转盘 → 人物志设置”调大输出上限或换用其他模型后重试。';
}
async function wheelSchemeBiographyRequest(input, onProgress) {
  var specialMaxTokens = taskMaxTokens('wheelSchemeMaxTokens'),
    result = await callDeepSeek(
      [
        { role: 'system', content: String((input && input.system) || '') },
        { role: 'user', content: String((input && input.user) || '') },
      ],
      null,
      {
        route: 'wheelScheme',
        transient: true,
        controller: _wheelSchemeRequestController,
        maxTokens: specialMaxTokens,
        ignoreUserMaxTokens: true,
        onProgress: onProgress,
        emptyContentLengthMessage: function (state) {
          return wheelSchemeBiographyLengthMessage(specialMaxTokens, state);
        },
      }
    );
  var text = String((result && result.content) || '').trim();
  if (structuredOutputTruncated(result)) throw new Error(wheelSchemeBiographyLengthMessage(specialMaxTokens, result));
  if (providerInterceptedFinishReason(result && result.finishReason))
    throw new Error('模型拒绝或拦截了人物志生成，请调整内容后重试。');
  if (!text) throw new Error('模型没有返回人物志');
  return text;
}
async function beginWheelSchemeBiography(item, replaceExisting) {
  var scheme = normalizedWheelScheme(item),
    progress = item.progress,
    previousBiography = String(progress.biography || ''),
    previousStatus = progress.status,
    previousUpdatedAt = progress.updatedAt;
  if (previousBiography && !replaceExisting) return true;
  var controller = new AbortController();
  _wheelSchemeRequestController = controller;
  _wheelSchemeRequestItem = item;
  function current() {
    return !controller.signal.aborted && wheelSchemeById(item.id) === item && item.progress === progress;
  }
  resetWheelSchemeBiographyDraft();
  progress.pendingBiography = true;
  delete progress.biographyError;
  try {
    await saveData('wheels', { urgent: true });
  } catch (saveError) {
    if (_wheelSchemeRequestController === controller) {
      _wheelSchemeRequestController = null;
      _wheelSchemeRequestItem = null;
    }
    progress.biographyError = '人物志准备状态保存失败：' + String((saveError && saveError.message) || saveError);
    toast('人物志尚未开始，可稍后重新生成', 'err');
    return false;
  }
  renderWheelSchemeGame();
  try {
    if (!current()) return false;
    var customPrompt = typeof assistantPromptText === 'function' ? assistantPromptText('wheelScheme', 'biography') : '',
      input = YeyuWheelScheme.buildBiographyInput(scheme, progress, customPrompt),
      biography = String(await wheelSchemeBiographyRequest(input, paintWheelSchemeBiographyProgress)).trim();
    if (!current()) return false;
    if (!biography) throw new Error('模型没有返回人物志');
    progress.biography = biography;
    progress.pendingBiography = false;
    progress.status = 'finished';
    progress.updatedAt = Date.now();
    try {
      await saveData('wheels', { urgent: true });
    } catch (saveError) {
      progress.biography = previousBiography;
      progress.pendingBiography = true;
      progress.status = previousStatus;
      progress.updatedAt = previousUpdatedAt;
      throw new Error('人物志保存失败：' + String((saveError && saveError.message) || saveError));
    }
    delete progress.biographyError;
    return true;
  } catch (error) {
    if (!current()) return false;
    progress.biography = previousBiography;
    progress.pendingBiography = true;
    progress.status = previousStatus;
    progress.updatedAt = previousUpdatedAt;
    progress.biographyError = String((error && error.message) || error);
    try {
      await saveData('wheels', { urgent: true });
    } catch (_) {}
    toast('人物志尚未完成，可重新生成', 'err');
    return false;
  } finally {
    if (_wheelSchemeRequestController === controller) {
      _wheelSchemeRequestController = null;
      _wheelSchemeRequestItem = null;
      resetWheelSchemeBiographyDraft();
    }
  }
}
async function regenerateWheelSchemeBiography() {
  if (_wheelSchemeBusy) return false;
  var item = activeWheelSchemeItem();
  if (!item || !item.progress) return false;
  _wheelSchemeBusy = true;
  _wheelSchemeFeedView.following = true;
  renderWheelSchemeGame();
  try {
    return await beginWheelSchemeBiography(item, true);
  } catch (error) {
    item.progress.pendingBiography = true;
    item.progress.biographyError = String((error && error.message) || error);
    toast('人物志尚未完成，可重新生成', 'err');
    return false;
  } finally {
    _wheelSchemeBusy = false;
    renderWheelSchemeGame();
    renderWheelSchemeLibrary();
  }
}
async function finishWheelSchemeWithoutOption() {
  if (_wheelSchemeBusy) return false;
  var item = activeWheelSchemeItem();
  if (!item) return false;
  item.progress.currentWheelId = '';
  item.progress.status = 'finished';
  item.progress.updatedAt = Date.now();
  try {
    await saveData('wheels', { urgent: true });
  } catch (error) {
    toast('结束状态保存失败，请重试', 'err');
    return false;
  }
  return await regenerateWheelSchemeBiography();
}
function spinWheelScheme() {
  if (_wheelSchemeBusy || _wheelSchemeModalState) return false;
  var item = activeWheelSchemeItem(),
    modal = $('wheel-scheme-spin-modal');
  if (!item || !modal) return false;
  var scheme = normalizedWheelScheme(item),
    progress = (item.progress = wheelSchemeNormalizedProgress(item, scheme));
  if (progress.pendingBiography || progress.status === 'finished') return false;
  var wheel = YeyuWheelScheme.wheelById(scheme, progress.currentWheelId),
    rows = wheel ? wheelSchemeAvailableRows(scheme, wheel, progress) : [];
  if (!wheel) return false;
  if (!rows.length) return finishWheelSchemeWithoutOption();
  _wheelSchemeModalState = {
    itemId: item.id,
    scheme: scheme,
    progress: wheelSchemeProgressCopy(progress),
    wheel: wheel,
    option: null,
    spinning: false,
  };
  $('wheel-scheme-spin-title').textContent = wheel.name || wheel.id;
  $('wheel-scheme-spin-turn').textContent = '第 ' + (Number(progress.turnCount) + 1) + ' 转';
  $('wheel-scheme-spin-result').textContent = '';
  $('wheel-scheme-spin-result').hidden = true;
  $('wheel-scheme-spin-confirm').hidden = true;
  $('wheel-scheme-spin-button').textContent = '转';
  $('wheel-scheme-spin-button').disabled = false;
  var rotor = $('wheel-scheme-spin-rotor'),
    palette = wheelSchemePalette(rows.length, wheelSchemePaletteColors(item));
  rotor.innerHTML = wheelSchemeSvgHtml(
    rows.map(function (row) {
      return { text: row.option.label || row.option.id, weight: row.weight };
    }),
    function (option) {
      return YeyuWheelScheme.positiveWeight(option && option.weight, 1);
    },
    palette
  );
  $('wheel-scheme-spin-legend').innerHTML = rows
    .map(function (row, index) {
      return (
        '<li><i aria-hidden="true" style="--wheel-sector-fill:' +
        palette[index].fill +
        '"></i><span>' +
        esc(row.option.label || row.option.id) +
        '</span></li>'
      );
    })
    .join('');
  rotor.style.transition = 'none';
  rotor.style.transform = 'rotate(0deg)';
  prepareWheelSchemeSound();
  openModal('wheel-scheme-spin-modal');
  modal.setAttribute('aria-hidden', 'false');
  return true;
}
function closeWheelSchemeSpin() {
  var modal = $('wheel-scheme-spin-modal'),
    state = _wheelSchemeModalState;
  if (!modal) return false;
  _wheelSchemeModalState = null;
  if (state) {
    cancelAnimationFrame(state.spinFrame);
    releaseWheelSchemeSound();
    var rotor = $('wheel-scheme-spin-rotor'),
      transform = getComputedStyle(rotor).transform;
    rotor.style.transition = 'none';
    rotor.style.transform = transform;
  }
  hideModalSurface('wheel-scheme-spin-modal');
  modal.setAttribute('aria-hidden', 'true');
  return true;
}
// One interactive AudioContext serves the whole app session. It is created and resumed inside the
// user's tap, and the recorded clips are decoded before the first spin, so each tick starts on the
// next audio quantum instead of waiting for a fresh output device or IO.
var _wheelSchemeSound = { context: null, buffers: null, loading: null, voices: new Set() };
function wheelSchemeSoundAsset(path) {
  return new Promise(function (resolve, reject) {
    var request = new XMLHttpRequest();
    request.open('GET', path);
    request.responseType = 'arraybuffer';
    request.onload = function () {
      // Android serves file:///android_asset with status 0.
      var ok = (request.status === 0 || request.status === 200) && request.response && request.response.byteLength;
      if (ok) resolve(request.response);
      else reject(new Error('Wheel sound unavailable: ' + path));
    };
    request.onerror = function () {
      reject(new Error('Wheel sound unavailable: ' + path));
    };
    request.send();
  });
}
function prepareWheelSchemeSound() {
  var sound = _wheelSchemeSound,
    Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return Promise.resolve();
  try {
    if (!sound.context) sound.context = new Context({ latencyHint: 'interactive' });
    var context = sound.context,
      warmup = context.createBufferSource();
    // A silent one-sample buffer opens the output stream while the tap still counts as activation.
    warmup.buffer = context.createBuffer(1, 1, context.sampleRate);
    warmup.connect(context.destination);
    warmup.start();
    var running = context.resume().then(function () {
      if (!_wheelSchemeModalState || document.hidden) return context.suspend();
    }).catch(function () {});
    if (!sound.loading)
      sound.loading = Promise.all(
        WHEEL_SCHEME_SOUND_CLIPS.map(function (clip) {
          return wheelSchemeSoundAsset(clip.path).then(function (data) {
            return context.decodeAudioData(data);
          });
        })
      ).then(
        function (decoded) {
          sound.buffers = {};
          WHEEL_SCHEME_SOUND_CLIPS.forEach(function (clip, index) {
            sound.buffers[clip.name] = decoded[index];
          });
        },
        // Missing or undecodable clips leave the wheel silent; spinning never depends on sound.
        function () {}
      );
    return Promise.all([running, sound.loading]).then(function () {});
  } catch (_) {
    return Promise.resolve();
  }
}
function playWheelSchemeSound(name) {
  var sound = _wheelSchemeSound,
    context = sound.context,
    buffer = sound.buffers && sound.buffers[name];
  if (!buffer || !context || context.state !== 'running' || document.hidden) return;
  // A fresh tooth replaces its predecessor; settling silences the last tooth before the latch lands.
  sound.voices.forEach(function (active) {
    if (name === 'settle' || active._wheelSchemeName === 'tick') {
      try { active.stop(); } catch (_) {}
      sound.voices.delete(active);
    }
  });
  var voice = context.createBufferSource();
  voice.buffer = buffer;
  voice._wheelSchemeName = name;
  // The short clips are mastered with headroom; loudness follows the media volume.
  voice.connect(context.destination);
  voice.onended = function () {
    sound.voices.delete(voice);
    voice.disconnect();
  };
  sound.voices.add(voice);
  voice.start();
}
function releaseWheelSchemeSound() {
  var sound = _wheelSchemeSound;
  sound.voices.forEach(function (voice) {
    try {
      voice.stop();
    } catch (_) {}
  });
  sound.voices.clear();
  if (sound.context && sound.context.state === 'running') sound.context.suspend().catch(function () {});
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) releaseWheelSchemeSound();
  else if (_wheelSchemeModalState && _wheelSchemeSound.context)
    _wheelSchemeSound.context.resume().catch(function () {});
});
function spinWheelSchemeModal() {
  var state = _wheelSchemeModalState,
    rotor = $('wheel-scheme-spin-rotor');
  if (!state || state.spinning || state.option || !rotor) return false;
  state.option = YeyuWheelScheme.chooseOption(state.scheme, state.wheel, state.progress, wheelSchemeRandom);
  if (!state.option) return false;
  state.spinning = true;
  $('wheel-scheme-spin-button').textContent = '…';
  $('wheel-scheme-spin-button').disabled = true;
  var rotation = wheelSchemeRotationForOption(state.scheme, state.wheel, state.progress, state.option),
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    duration = reduced ? 0 : Math.max(0, WHEEL_SCHEME_SPIN_MS),
    soundReady = prepareWheelSchemeSound();
  // Flush the initial transform before starting the CSS transition, including immediate repeated opens.
  getComputedStyle(rotor).transform;
  rotor.style.transition = 'transform ' + duration + 'ms cubic-bezier(.12,.75,.06,1)';
  rotor.style.transform = 'rotate(' + rotation + 'deg)';
  var animation = rotor.getAnimations().find(function (entry) {
      return entry.transitionProperty === 'transform';
    }),
    boundaries = [],
    before = 0,
    nextBoundary = 0;
  rotor.querySelectorAll('.wheel-scheme-sector').forEach(function (sector) {
    var first = 360 - before;
    for (var angle = first; angle <= rotation; angle += 360) boundaries.push(angle);
    before += Number(sector.dataset.sweep);
  });
  boundaries.sort(function (a, b) {
    return a - b;
  });
  function finish() {
    if (_wheelSchemeModalState !== state || !state.spinning) return;
    cancelAnimationFrame(state.spinFrame);
    state.spinning = false;
    playWheelSchemeSound('settle');
    $('wheel-scheme-spin-button').textContent = '已停';
    $('wheel-scheme-spin-result').textContent = '「' + (state.option.label || state.option.id) + '」';
    $('wheel-scheme-spin-result').hidden = false;
    $('wheel-scheme-spin-confirm').hidden = false;
  }
  function sample() {
    if (_wheelSchemeModalState !== state || !state.spinning) return;
    // The browser supplies eased transition progress; it remains aligned with the rendered rotor.
    var progress = animation.effect.getComputedTiming().progress,
      angle = (progress == null ? 1 : progress) * rotation,
      crossed = false;
    while (nextBoundary < boundaries.length && boundaries[nextBoundary] <= angle) {
      crossed = true;
      nextBoundary++;
    }
    // Sub-frame crossings coalesce to one click; delayed/background frames never queue a burst of tones.
    if (crossed && progress != null) playWheelSchemeSound('tick');
    state.spinFrame = requestAnimationFrame(sample);
  }
  if (animation && duration > 0) {
    state.spinFrame = requestAnimationFrame(sample);
    animation.finished.then(finish, finish);
  } else {
    // Let the tap's resume and the clip decode settle before the single reduced-motion landing, but never
    // hold the result behind an audio stack that does not answer.
    Promise.race([
      soundReady,
      new Promise(function (resolve) {
        setTimeout(resolve, WHEEL_SCHEME_SOUND_WAIT_MS);
      }),
    ]).then(finish);
  }
  return true;
}
async function confirmWheelSchemeSpin() {
  var state = _wheelSchemeModalState;
  if (!state || state.spinning || !state.option) return false;
  var item = wheelSchemeById(state.itemId),
    optionId = state.option.id;
  if (!item || item.id !== activeWheelSchemeId()) return false;
  closeWheelSchemeSpin();
  return await commitWheelSchemeSpin(item, optionId);
}
async function commitWheelSchemeSpin(item, optionId) {
  if (_wheelSchemeBusy || !item) return false;
  var scheme = normalizedWheelScheme(item),
    progress = (item.progress = wheelSchemeNormalizedProgress(item, scheme)),
    before = wheelSchemeProgressCopy(progress);
  _wheelSchemeBusy = true;
  _wheelSchemeFeedView.following = true;
  renderWheelSchemeGame();
  try {
    var result = YeyuWheelScheme.commitSpin(scheme, progress, optionId, wheelSchemeRandom);
    item.progress = result.progress;
    await saveData('wheels', { urgent: true });
    renderWheelSchemeGame();
    // The biography starts right away and covers the stage's error panel, so say it here once.
    if (result.progress.automaticError)
      toast(
        '方案无法继续：' + wheelSchemeAutomaticErrorText(result.progress.automaticError) + '请检查方案文件。',
        'err'
      );
    if (result.progress.status === 'finished' || !result.progress.currentWheelId)
      return await beginWheelSchemeBiography(item);
    return true;
  } catch (error) {
    item.progress = before;
    toast('这一转没有保存成功，请重新转动', 'err');
    return false;
  } finally {
    _wheelSchemeBusy = false;
    renderWheelSchemeGame();
    renderWheelSchemeLibrary();
  }
}
async function copyWheelSchemeBiography() {
  var item = activeWheelSchemeItem(),
    text = String((item && item.progress && item.progress.biography) || '');
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    else {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast('人物志已复制', 'ok');
    return true;
  } catch (error) {
    toast('复制失败，请长按人物志正文选择复制', 'err');
    return false;
  }
}
