// ===== Prompt/Token status =====
var _lastWbHitsByChar = {},
  _providerCacheUsageBySession = {};
function getBuiltMessages(char, msgs) {
  return buildMessages(char, msgs);
}
var _tokenUpdateSeq = 0;
function scheduleTokensBar(char) {
  var seq = ++_tokenUpdateSeq;
  var run = function () {
    if (seq === _tokenUpdateSeq && char && D.currentCharId === char.id) updateTokensBar(char);
  };
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 700 });
  else setTimeout(run, 80);
}
// 世界书命中徽标只从会话里已保存的助手消息派生：重载、切换会话、删除或分支后都跟随消息本身。
function latestSessionWorldBookMetrics(sess) {
  var msgs = (sess && sess.msgs) || [];
  for (var i = msgs.length - 1; i >= 0; i--) {
    var message = msgs[i];
    if (
      message &&
      message.role === 'assistant' &&
      message.worldBookMetrics &&
      typeof message.worldBookMetrics === 'object'
    )
      return message.worldBookMetrics;
  }
  return null;
}
function updateWorldBookHeader(char) {
  if (!char) return;
  var activeBadge = $('wb-active-badge'),
    hitBadge = $('wb-hit-badge'),
    activeBooks = getEffectiveWBCategories(char.id).length,
    sess = getActiveSession(char.id),
    metric = latestSessionWorldBookMetrics(sess),
    matched = Number(metric && metric.matched) || 0,
    injected = Number(metric && metric.injected) || 0;
  if (activeBadge) {
    activeBadge.style.display = '';
    activeBadge.textContent = '世界书 ' + activeBooks + ' 本';
    activeBadge.title = activeBooks ? '当前角色可用世界书：' + activeBooks + ' 本' : '当前角色没有可用世界书';
  }
  if (hitBadge) {
    hitBadge.style.display = '';
    hitBadge.textContent = metric
      ? injected
        ? '本轮带入 ' + injected + ' 条'
        : matched
          ? '本轮未带入'
          : '本轮无匹配'
      : '本轮未统计';
    hitBadge.title = metric
      ? injected
        ? '最近一轮对话使用了 ' + injected + ' 条世界书内容'
        : matched
          ? '有条目匹配，但受加入量上限等设置影响，本轮没有使用'
          : '最近一轮对话没有匹配世界书'
      : '发送消息后显示本轮世界书使用情况';
  }
}
function updateMemoryBadge(char) {
  var badge = $('mem-badge');
  if (!badge) return;
  if (!char) {
    badge.style.display = 'none';
    return;
  }
  var sess = getActiveSession(char.id),
    store = ensureSessionMemoryStore(sess),
    active = (store.longTermEntries || []).filter(function (row) {
      return row.active !== false;
    }).length,
    hasSummary = !!(store.historySummary && store.historySummary.active !== false);
  badge.style.display = '';
  badge.textContent = '记忆 ' + active + ' 条' + (hasSummary ? ' · 已整理' : '');
  badge.title = '当前对话有 ' + active + ' 条可用辅助记忆' + (hasSummary ? '，较早对话已整理' : '，较早对话尚未整理');
}
async function updateTokensBar(char) {
  if (!char) {
    var emptyBar = $('tokens-bar');
    if (emptyBar) emptyBar.style.display = 'none';
    return;
  }
  const msgs = getMsgs(char.id);
  const owner = getActiveSession(char.id),
    revision = _tokenUpdateSeq;
  let built;
  try {
    built = getBuiltMessages(char, msgs);
    if (built && typeof built.then === 'function') built = await built;
  } catch (error) {
    if (error.name !== 'AbortError') console.warn('Context estimate failed', error);
    return;
  }
  if (getChar() !== char || getActiveSession(char.id) !== owner || revision !== _tokenUpdateSeq) return;
  updateWorldBookHeader(char);
  updateMemoryBadge(char);
  let used = built.usedTokens;
  const max = parseInt(D.settings.maxContextTokens) || 0;
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  var trimmed =
      Number(Object.prototype.hasOwnProperty.call(built, 'trimmedMessages') ? built.trimmedMessages : built.trimmed) ||
      0,
    summarized = Number(built.summarized) || 0,
    summaryTrimmed = built.summaryTrimmed === true;
  var visibleBar = $('tokens-bar');
  if (visibleBar) visibleBar.style.display = 'flex';
  var lastUsage = D.settings.lastRequestUsage,
    sess = getActiveSession(char.id),
    lastExact =
      lastUsage && lastUsage.charId === char.id && sess && lastUsage.sessionId === sess.id
        ? Number(lastUsage.contextPrompt) || 0
        : 0,
    cacheUsage = sess ? _providerCacheUsageBySession[sess.id] : null,
    cacheHit =
      cacheUsage && Number.isFinite(Number(cacheUsage.providerCacheHitTokens))
        ? Number(cacheUsage.providerCacheHitTokens)
        : null,
    cacheText = $('tokens-cache'),
    store = sess && typeof ensureSessionMemoryStore === 'function' ? ensureSessionMemoryStore(sess) : null,
    hasSummary = !!(store && store.historySummary && store.historySummary.active !== false),
    details = visibleBar && visibleBar.querySelector('.tokens-detail-list');
  $('tokens-text').textContent = max > 0 ? '约 ' + used + ' / ' + max : '约 ' + used + ' / 不限';
  $('tokens-text').title = '点一下查看本轮上下文明细';
  var requestCount = lastExact ? Math.max(1, Number(lastUsage && lastUsage.requestCount) || 1) : 1,
    requestSummary = requestCount > 1 ? requestCount + ' 次请求合计' : '上一轮接口记录',
    cacheRequestCount = cacheUsage ? Math.max(1, Number(cacheUsage.requestCount) || 1) : 1;
  if (details)
    details.innerHTML =
      '<span><b>本轮估算</b><strong>约 ' +
      used +
      ' Token</strong></span><span><b>上下文上限</b><strong>' +
      (max > 0 ? max + ' Token' : '未限制') +
      '</strong></span><span><b>已整理为摘要</b><strong>' +
      summarized +
      ' 条</strong></span><span><b>本轮未发送</b><strong>' +
      trimmed +
      ' 条</strong></span><span><b>较早对话摘要</b><strong>' +
      (hasSummary ? (summaryTrimmed ? '本轮未发送' : '已发送') : '尚未生成') +
      '</strong></span><small>' +
      (lastExact
        ? requestSummary +
          '：输入约 ' +
          (Number(lastUsage.prompt) || lastExact) +
          ' Token，最大单次上下文约 ' +
          lastExact +
          ' Token，输出约 ' +
          (Number(lastUsage.completion) || 0) +
          ' Token。'
        : '当前值按实际发送内容估算，发送后会按接口返回值校准。') +
      '</small>';
  if (cacheText) {
    cacheText.hidden = cacheHit == null;
    cacheText.textContent =
      cacheHit == null
        ? ''
        : (cacheRequestCount > 1 ? '本轮 ' + cacheRequestCount + ' 次请求累计缓存命中 ' : '本轮供应商缓存命中 ') +
          cacheHit +
          ' Token';
  }
  $('tokens-fill').style.width = pct + '%';
  $('tokens-fill').className = 't-fill-inner' + (max > 0 && pct > 80 ? (pct > 90 ? ' danger' : ' warn') : '');
  $('tokens-pct').textContent = max > 0 ? '已用 ' + pct + '%' : '';
  $('tokens-usage').hidden = max <= 0;
}
