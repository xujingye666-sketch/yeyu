// ===== Messages =====
function generationInterruptionLabel(meta) {
  meta = meta || {};
  var labels = {
      user_cancelled: '已由你停止，回复可能没写完',
      connection_timeout: '连接模型超时，回复可能没写完',
      network_offline: '网络连接中断，回复可能没写完',
      network_interrupted: '网络连接中断，回复可能没写完',
      app_suspended: '应用离开前台时生成中断，回复可能没写完',
      context_changed: '对话内容变化后生成中断，回复可能没写完',
    },
    reason = String(meta.interruptionReason || ''),
    label = labels[reason] || '生成中断，回复可能没写完';
  if (reason === 'provider_error') {
    var status = Math.floor(Number(meta.interruptionStatus) || 0),
      detail = String(meta.interruptionDetail || '').trim();
    label =
      '供应商在回复途中报错' +
      (status ? '（HTTP ' + status + '）' : '') +
      (detail ? '：' + detail : '') +
      '，回复可能没写完';
  }
  return label;
}
function generationMetaHtml(meta, message) {
  var rows = [],
    safe = function (value) {
      return esc(String(value || ''));
    };
  if (meta && meta.incomplete === true)
    rows.push(
      '<span class="generation-meta warn interrupted" title="可点击聊天页顶部的“继续生成”接着写">' +
        safe(generationInterruptionLabel(meta)) +
        '</span>'
    );
  if (meta && meta.outputLimitReached === true)
    rows.push(
      '<span class="generation-meta limit" title="这次回复达到了输出上限，内容可能没有写完；可点击聊天页顶部的“继续生成”接着写">达到输出上限，可能未写完</span>'
    );
  if (meta && meta.providerStopReason)
    rows.push(
      '<span class="generation-meta limit" title="供应商以内容过滤或安全原因提前结束了这次回复，收到的部分已保存">供应商中途拦截（' +
        safe(meta.providerStopReason) +
        '），回复可能不完整</span>'
    );
  return rows.join('');
}
// Write meta layout with the row; :has() would restyle every bubble on each streaming redraw.
function messageMetaLayoutClass(time, generationHtml) {
  return generationHtml ? '' : time ? 'meta-time-only' : 'meta-empty';
}
function syncMessageMetaLayout(bubble, time, generationHtml) {
  if (!bubble) return;
  bubble.classList.remove('meta-time-only', 'meta-empty');
  var name = messageMetaLayoutClass(time, generationHtml);
  if (name) bubble.classList.add(name);
}
var _memoryRetrievalViewByMessage = typeof WeakMap === 'function' ? new WeakMap() : null;
function messageObservabilityHtml(message) {
  var sections = [],
    metrics = message && message.worldBookMetrics;
  if (metrics && typeof metrics === 'object') {
    var statusLabels = {
        activated: '已激活并带入',
        sticky: '置顶保持并带入',
        cooldown: '冷却中，本轮未带入',
        delayed: '尚未到生效轮次',
        probability: '本轮概率未命中',
        recursive: '递归找到并带入',
        'regex-skipped': '匹配规则本轮未执行',
        'group-dropped': '同组已有其他条目入选',
        'unsupported-position': '注入位置暂不支持',
        'budget-dropped': '超出本轮世界书容量',
      },
      usedStatuses = { activated: true, sticky: true, recursive: true },
      latest = {},
      order = [];
    (Array.isArray(metrics.details) ? metrics.details : []).forEach(function (detail, index) {
      if (!detail || typeof detail !== 'object') return;
      var key = String(detail.runtimeKey || detail.id || detail.name || 'row_' + index);
      if (!Object.prototype.hasOwnProperty.call(latest, key)) order.push(key);
      latest[key] = detail;
    });
    var worldRows = order
        .map(function (key) {
          var detail = latest[key],
            status = String(detail.status || ''),
            label = statusLabels[status] || '本轮未带入',
            reason = detail.reason ? '（' + String(detail.reason) + '）' : '',
            name = String(detail.name || detail.id || '未命名条目');
          return (
            '<div class="turn-insight-row' +
            (usedStatuses[status] ? ' used' : '') +
            '"><span class="turn-insight-name">' +
            esc(name) +
            '</span><span class="turn-insight-value">' +
            esc(label + reason) +
            '</span></div>'
          );
        })
        .join(''),
      matched = Math.max(0, Number(metrics.matched) || 0),
      activated = Math.max(0, Number(metrics.activated) || 0),
      injected = Math.max(0, Number(metrics.injected) || 0),
      dropped = Math.max(0, Number(metrics.dropped) || 0),
      tokens = Math.max(0, Math.round(Number(metrics.tokens) || 0));
    sections.push(
      '<section class="turn-insight worldbook-insight"><h3 class="ui-group-title">世界书</h3><p class="turn-insight-summary">匹配 ' +
        matched +
        ' · 候选 ' +
        activated +
        ' · 带入 ' +
        injected +
        ' · 未采用 ' +
        dropped +
        ' · 约 ' +
        tokens +
        ' Token</p><div class="ui-group">' +
        (worldRows || '<p class="ui-empty compact">本轮没有可展示的条目状态。</p>') +
        '</div></section>'
    );
  }
  var memoryView = _memoryRetrievalViewByMessage && message ? _memoryRetrievalViewByMessage.get(message) : null;
  if (memoryView && memoryView.enabled !== false) {
    var typeLabels = { character_fact: '人物信息', relationship_change: '关系变化', key_event: '关键事件' },
      scored = Array.isArray(memoryView.scored) ? memoryView.scored : [],
      selected = scored.filter(function (item) {
        return item && item.selected === true;
      }).length,
      memoryRows = scored
        .map(function (item) {
          var score = Math.max(0, Math.min(100, Math.round((Number(item && item.score) || 0) * 100))),
            type = typeLabels[String((item && item.type) || '')] || '辅助记忆',
            content = String((item && item.content) || '');
          return (
            '<div class="turn-insight-row' +
            (item && item.selected === true ? ' used' : '') +
            '"><div class="turn-insight-name"><strong>' +
            esc(type) +
            '</strong><span>' +
            esc(content) +
            '</span></div><span class="turn-insight-value">' +
            (item && item.selected === true ? '已带入' : '未带入') +
            ' · ' +
            score +
            ' 分</span></div>'
          );
        })
        .join('');
    sections.push(
      '<section class="turn-insight memory-retrieval-insight"><h3 class="ui-group-title">辅助记忆</h3><p class="turn-insight-summary">评估 ' +
        scored.length +
        ' 条 · 带入 ' +
        selected +
        ' 条</p><div class="ui-group">' +
        (memoryRows || '<p class="ui-empty compact">本轮没有找到达到相关条件的辅助记忆。</p>') +
        '</div></section>'
    );
  }
  return sections.join('');
}
function rememberMessageMemoryScores(message, report) {
  if (!message || !_memoryRetrievalViewByMessage) return;
  var safe = {
    fingerprint: String((report && report.fingerprint) || ''),
    enabled: report && report.enabled !== false,
    scored: (Array.isArray(report && report.scored) ? report.scored : []).map(function (item) {
      return {
        id: String((item && item.id) || ''),
        type: String((item && item.type) || ''),
        content: String((item && item.content) || ''),
        score: Number(item && item.score) || 0,
        selected: item && item.selected === true,
      };
    }),
  };
  _memoryRetrievalViewByMessage.set(message, safe);
}
function openLatestTurnStatistics() {
  var modal = $('turn-statistics-modal'),
    target = modal && modal.querySelector('.latest-turn-insights'),
    char = getChar(),
    sess = char ? getActiveSession(char.id) : null,
    msgs = sess && Array.isArray(sess.msgs) ? sess.msgs : [],
    assistantIndex = -1;
  if (!target) return false;
  for (var i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === 'assistant' && msgs[i].reverted !== true) {
      assistantIndex = i;
      break;
    }
  }
  var content = '';
  if (assistantIndex >= 0) {
    for (var j = assistantIndex - 1; j >= 0; j--) {
      if (msgs[j] && msgs[j].role === 'assistant') break;
      if (msgs[j] && msgs[j].role === 'user') {
        content += messageObservabilityHtml(msgs[j]);
        break;
      }
    }
    content += messageObservabilityHtml(msgs[assistantIndex]);
  }
  target.innerHTML =
    content ||
    '<div class="ui-empty"><strong>最新一轮还没有统计</strong><p>角色回复后，这里会列出那一轮用到的世界书条目和辅助记忆。</p></div>';
  openModal('turn-statistics-modal');
  return !!content;
}
function messageBranchAction(char, i) {
  var sess = char ? getActiveSession(char.id) : null,
    message = sess && sess.msgs && sess.msgs[i],
    blocked = branchReturnCreateBlockedReason(sess, message);
  return blocked
    ? '<button class="btn sm" disabled title="' +
        escAttr(blocked) +
        '">' +
        uiIcon('branch') +
        ' 已整理，不能创建支线</button>'
    : '<button class="btn sm" onclick="createBranchAtMessage(' +
        i +
        ');closeMessageMore()" title="从这条消息创建独立支线">' +
        uiIcon('branch') +
        ' 创建分支</button>';
}
function closeMessageMore(except) {
  document.querySelectorAll('.msg-more.open').forEach(function (el) {
    if (el !== except) {
      transitionUiVisibility(el.querySelector('.msg-more-menu'), false, function () {
        el.classList.remove('open');
      });
      var btn = el.querySelector('.msg-more-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });
}
function toggleMessageMore(i, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var trigger = event && (event.currentTarget || event.target),
    root = trigger && trigger.closest ? trigger.closest('.msg-more') : null;
  if (!root) root = document.querySelector('[data-msg-idx="' + i + '"] .msg-actions > .msg-more');
  if (!root) return;
  var open = !root.classList.contains('open');
  closeMessageMore(root);
  transitionUiVisibility(root.querySelector('.msg-more-menu'), open, function () {
    root.classList.toggle('open', open);
  });
  var btn = root.querySelector('.msg-more-toggle');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function toggleMessageActions(i, event) {
  var target = event && event.target;
  if (target && target.closest && target.closest(MESSAGE_TAP_CONTROL_SELECTOR)) return;
  var row = document.querySelector('.msg[data-msg-idx="' + i + '"]');
  if (!row) return;
  // Keep the tapped message fixed; the viewport anchor may be inside the toolbar being removed.
  var host = $('chat-messages'),
    rowTop = row.getBoundingClientRect().top;
  var open = !row.classList.contains('actions-open');
  document.querySelectorAll('.msg.actions-open').forEach(function (message) {
    if (message !== row) {
      finishUiMotions(message.querySelector('.msg-actions'));
      message.classList.remove('actions-open');
    }
  });
  closeMessageMore();
  row.classList.toggle('actions-open', open);
  if (open) revealUiContent(row.querySelector('.msg-actions'), 0);
  else finishUiMotions(row.querySelector('.msg-actions'));
  var moved = row.getBoundingClientRect().top - rowTop;
  if (host && Math.abs(moved) > 0.5) writeOwnedChatScrollTop(host, Math.max(0, host.scrollTop + moved));
}
function openingSwipeActionsHtml(char, m, i) {
  var candidates =
      m && m.opening === true ? (Array.isArray(m.swipes) && m.swipes.length ? m.swipes : getGreetings(char)) : [],
    active = Math.max(
      0,
      Math.min(
        candidates.length - 1,
        Number.isInteger(Number(m && m.swipeId)) ? Number(m.swipeId) : Number(m && m.openingIndex) || 0
      )
    );
  if (candidates.length < 2) return '';
  return (
    '<span class="opening-swipe-controls" aria-label="开场白候选"><button class="btn sm opening-swipe-prev" onclick="switchOpeningGreeting(' +
    i +
    ',-1)"' +
    (active <= 0 ? ' disabled' : '') +
    ' aria-label="上一条开场白">' +
    uiIcon('chevron-left') +
    '</button><span class="opening-swipe-count" aria-live="polite">' +
    (active + 1) +
    ' / ' +
    candidates.length +
    '</span><button class="btn sm opening-swipe-next" onclick="switchOpeningGreeting(' +
    i +
    ',1)"' +
    (active >= candidates.length - 1 ? ' disabled' : '') +
    ' aria-label="下一条开场白">' +
    uiIcon('chevron-right') +
    '</button></span>'
  );
}
function ordinarySwipeActionsHtml(char, m, i) {
  var sess = char ? getActiveSession(char.id) : null,
    candidates =
      m && m.role === 'assistant' && m.opening !== true
        ? Array.isArray(m.swipes) && m.swipes.length
          ? m.swipes
          : [String(m.content || '')]
        : [],
    active = Math.max(0, Math.min(candidates.length - 1, Number(m && m.swipeId) || 0)),
    isLast = !!(sess && i === replyTailIndex(sess.msgs)),
    show = candidates.length > 1 || isLast;
  if (!show || !candidates.length) return '';
  var canNext = active < candidates.length - 1 || isLast,
    nextLabel = active < candidates.length - 1 ? '下一个候选' : '生成新候选';
  return (
    '<span class="opening-swipe-controls message-swipe-controls" aria-label="回复候选"><button class="btn sm opening-swipe-prev" onclick="switchMessageSwipe(' +
    i +
    ',-1)"' +
    (active <= 0 ? ' disabled' : '') +
    ' aria-label="上一个候选">' +
    uiIcon('chevron-left') +
    '</button>' +
    (candidates.length > 1
      ? '<span class="opening-swipe-count" aria-live="polite">' + (active + 1) + ' / ' + candidates.length + '</span>'
      : '') +
    '<button class="btn sm opening-swipe-next" onclick="switchMessageSwipe(' +
    i +
    ',1)"' +
    (canNext ? '' : ' disabled') +
    ' title="' +
    nextLabel +
    '" aria-label="' +
    nextLabel +
    '">' +
    uiIcon('chevron-right') +
    '</button></span>'
  );
}
// 系统图片消息（/imagine）只有删除、复制与生图：正文是图片说明，不翻译、不编辑，也没有候选。
function messageActionsHtml(char, m, i) {
  var imageMessage = isGeneratedImageMessage(m),
    swipe = imageMessage ? '' : openingSwipeActionsHtml(char, m, i) || ordinarySwipeActionsHtml(char, m, i),
    translate = imageMessage
      ? ''
      : '<button class="btn sm msg-action-secondary" onclick="translateMessage(' +
        i +
        ')" title="翻译消息">' +
        uiIcon('globe') +
        ' 翻译</button>',
    edit = imageMessage
      ? ''
      : '<button class="btn sm" onclick="editMessage(' + i + ')" title="编辑消息">' + uiIcon('edit') + ' 编辑</button>',
    del =
      '<button class="btn sm danger' + (imageMessage ? '' : ' msg-action-secondary') + '" onclick="deleteMessage(' +
      i +
      ')" title="删除消息">' +
      uiIcon('trash') +
      ' 删除</button>',
    more = [
      '<button class="btn sm" onclick="copyMessage(' +
        i +
        ');closeMessageMore()" title="复制消息">' +
        uiIcon('copy') +
        ' 复制</button>',
    ];
  if (m.role === 'assistant' && typeof m.continueBase === 'string')
    more.push(
      '<button class="btn sm" onclick="restoreOriginalMessage(' +
        i +
        ',true);closeMessageMore()">' +
        uiIcon('undo') +
        ' 撤销续写</button>'
    );
  if (m.original_content)
    more.push(
      '<button class="btn sm" onclick="restoreOriginalMessage(' +
        i +
        ');closeMessageMore()">' +
        uiIcon('undo') +
        ' 恢复原文</button>'
    );
  var imageAction = char ? messageImageActionHtml(char, getActiveSession(char.id), m, i) : '';
  if (imageAction) more.push(imageAction);
  var branch = messageBranchAction(char, i);
  if (branch) more.push(branch);
  return (
    '<div class="msg-actions">' +
    swipe +
    translate +
    (imageMessage ? '' : '<button class="btn sm" data-speech-index="' + i + '" onclick="speakMessage(' + i + ')">' + uiIcon('volume') + ' 朗读</button>') +
    edit +
    del +
    '<div class="msg-more"><button class="btn sm msg-more-toggle" aria-expanded="false" onclick="toggleMessageMore(' +
    i +
    ',event)" title="更多消息操作">' +
    uiIcon('more') +
    ' 更多</button><div class="msg-more-menu">' +
    (imageMessage ? '' : translate + del) +
    more.join('') +
    '</div></div></div>'
  );
}

// Streaming commits in place, so refresh the predecessor’s latest-message image actions explicitly.
function refreshManualImageEntrypoints(char, session) {
  refreshComposerImageButton();
  if (!char || !session || getChar() !== char || getActiveSession(char.id) !== session) return;
  var host = $('chat-messages');
  if (!host || !Array.isArray(session.msgs)) return;
  var refreshed = 0;
  for (var i = session.msgs.length - 1; i >= 0 && refreshed < 2; i--) {
    var message = session.msgs[i];
    if (!message || message.role !== 'assistant' || !messageCanHaveImages(message)) continue;
    refreshed++;
    var row = host.querySelector('[data-msg-seq="' + Number(message.seq) + '"]');
    var actions = row && row.querySelector('.msg-body > .msg-actions');
    if (actions) reconcileStreamElement(actions, messageActionsHtml(char, message, i));
  }
}
function branchReturnRevertCardHtml(m, i) {
  return (
    '<div class="msg-system branch-return-card reverted" data-msg-idx="' +
    i +
    '">' +
    branchReturnEyebrowHtml('undo', '支线回归已撤销') +
    '<p>' +
    esc(m.content || '') +
    '</p></div>'
  );
}
function immersiveMessageHeadHtml(char, role, avatarHtml, message) {
  var persona = role === 'user' ? getActivePersona(char && char.id) : null,
    name =
      message && message.name != null
        ? String(message.name)
        : role === 'user'
          ? String((persona && persona.name) || '你')
          : canonicalCharacterName(char);
  return (
    '<div class="msg-immersive-head"><span class="msg-immersive-avatar">' +
    String(avatarHtml || '') +
    '</span><strong>' +
    esc(name) +
    '</strong></div>'
  );
}
// depth is the distance back from the newest message, the value engine.js compares
// minDepth and maxDepth against.
function messageMediaHtml(message) {
  var media = message && message.extra && message.extra.media;
  return (Array.isArray(media) ? media : [])
    .map(function (item) {
      var source = item && item.type === 'image' && safeImage(item.url, true);
      return source
        ? '<img class="message-attachment" src="' + escAttr(source) + '" alt="消息图片" loading="lazy">'
        : '';
    })
    .join('');
}
// The source and synchronous preprocessing shared by chat, search and greeting previews.
// Display scripts and Markdown remain downstream so search never starts those asynchronous jobs.
function messageDisplayParts(char, message, options) {
  options = options || {};
  if (message.role !== 'assistant') return { content: String(message.content || ''), reasoning: '' };
  var parts = assistantMessageParts(message);
  if (message.opening && !isRisuCharacter(char)) {
    var state = options.macroState || characterMacroStateForChar(char),
      beforeSuppress = state.suppressWrites;
    if (!message.seq || message.pendingMacroEffects)
      replaceCharacterMacros(
        parts.content.slice(Number(message.pendingMacroEffects && message.pendingMacroEffects.from) || 0),
        char,
        undefined,
        state
      );
    state.suppressWrites = true;
    try {
      parts.content = replaceCharacterMacros(parts.content, char, undefined, state);
    } finally {
      state.suppressWrites = beforeSuppress;
    }
  }
  return parts;
}
function messageHtml(char, m, i, messagePanelContext, depth, templateRenderContext) {
  var timeStr = m.time ? relativeTime(m.time) : '',
    displayOptions = { depth: depth, index: i, templateRenderContext: templateRenderContext },
    seqAttr = Number(m.seq) > 0 ? ' data-msg-seq="' + Number(m.seq) + '"' : '';
  if (isBranchReturnMessage(m)) return branchReturnCardHtml(char, m, i);
  if (isBranchReturnRevertMessage(m)) return branchReturnRevertCardHtml(m, i);
  if (isGeneratedImageMessage(m)) return generatedImageMessageHtml(char, m, i, seqAttr, timeStr);
  if (m.role === 'system') {
    var systemSource = messageDisplayParts(char, m, displayOptions).content,
      systemDisplay = promptTemplateDisplayText(systemSource, 'system', char, m, displayOptions);
    var systemHtml = esc(systemDisplay);
    systemHtml = promptTemplateDisplayHtml(systemHtml, m.content, 'system', char, m, { depth: depth });
    return '<div class="msg-system" data-msg-idx="' + i + '"' + seqAttr + '>' + systemHtml + '</div>';
  }
  if (m.role === 'user') {
    var userSource = messageDisplayParts(char, m, displayOptions).content,
      userTemplate = promptTemplateDisplayText(userSource, 'user', char, m, displayOptions),
      userDisplay = regexScriptDisplayText(userTemplate, 'user', char, m, { depth: depth, index: i }),
      userAvatar = getUserAvatarHtml(),
      userBody =
        isRisuCharacter(char) && risuNeedsIsolatedDisplay(userDisplay)
          ? risuDisplayPlaceholderHtml(userDisplay, i, 'user')
          : md(cleanDisplayText(userDisplay, 'user'), { role: 'user' });
    userBody = promptTemplateDisplayHtml(userBody, m.content, 'user', char, m, { depth: depth });
    return (
      '<div class="msg user" data-msg-idx="' +
      i +
      '"' +
      seqAttr +
      '><div class="msg-avatar">' +
      userAvatar +
      '</div>' +
      immersiveMessageHeadHtml(char, 'user', userAvatar, m) +
      '<div class="msg-body"><div class="msg-bubble ' +
      messageMetaLayoutClass(m.time, '') +
      '" title="' +
      timeStr +
      '" onclick="toggleMessageActions(' +
      i +
      ',event)">' +
      userBody +
      messageMediaHtml(m) +
      '<div class="msg-bubble-meta">' +
      messageTimeHtml(m.time) +
      '</div></div>' +
      messageActionsHtml(char, m, i) +
      '</div></div>'
    );
  }
  var speaker = char,
    avatarSrc = displayImageSrc(speaker, 'avatar_image'),
    av = avatarSrc ? '<img src="' + escAttr(avatarSrc) + '" alt="">' : '',
    rich = !!m.opening,
    parts = messageDisplayParts(char, m, displayOptions);
  if (rich) displayOptions.preserveImages = true;
  var assistantDisplay = regexScriptDisplayText(parts.content, 'assistant', char, m, { depth: depth, index: i }),
    markdownOptions = Object.assign({
      role: 'assistant',
      preserveImages: true,
      mediaAssets: (char && char.media_assets) || [],
      mediaOwnerId: char && char.id,
      frontendOwner: cardFrontendOwner(char, i, templateRenderContext),
      // Keep an interrupted frontend as collapsed source until continuation completes its fence.
      frontendIncomplete: messageIsIncomplete(m),
    }),
    assistantBody = assistantMessageDisplayHtml(
      parts.content,
      char,
      m,
      displayOptions,
      markdownOptions,
      messagePanelContext,
      i
    );
  var generationHtml = generationMetaHtml(messageActiveGenerationMeta(m), m);
  return (
    '<div class="msg char" data-msg-idx="' +
    i +
    '"' +
    seqAttr +
    '><div class="msg-avatar">' +
    av +
    '</div>' +
    immersiveMessageHeadHtml(speaker, 'assistant', av, m) +
    '<div class="msg-body"><div class="msg-bubble ' +
    messageMetaLayoutClass(m.time, generationHtml) +
    '" title="' +
    timeStr +
    '" onclick="toggleMessageActions(' +
    i +
    ',event)">' +
    '<div class="msg-live-text"><div class="stream-reasoning-slot">' +
    reasoningBlockHtml(parts.reasoning, m) +
    '</div><div class="stream-content-slot">' +
    assistantBody +
    messageMediaHtml(m) +
    (messageCanHaveImages(m) ? messageImagesHtml(char, m, i) : '') +
    '</div></div>' +
    '<div class="msg-bubble-meta">' +
    messageTimeHtml(m.time) +
    generationHtml +
    '</div></div>' +
    messageActionsHtml(char, m, i) +
    '</div></div>'
  );
}
// /imagine 的系统图片消息：以角色身份显示图片条，说明文字（ST 消息模板展开结果）弱化在图下。
function generatedImageMessageHtml(char, m, i, seqAttr, timeStr) {
  var avatarSrc = displayImageSrc(char, 'avatar_image'),
    av = avatarSrc ? '<img src="' + escAttr(avatarSrc) + '" alt="">' : '';
  return (
    '<div class="msg char msg-generated-image" data-msg-idx="' +
    i +
    '"' +
    seqAttr +
    '><div class="msg-avatar">' +
    av +
    '</div>' +
    immersiveMessageHeadHtml(char, 'assistant', av, m) +
    '<div class="msg-body"><div class="msg-bubble ' +
    messageMetaLayoutClass(m.time, '') +
    '" title="' +
    timeStr +
    '" onclick="toggleMessageActions(' +
    i +
    ',event)">' +
    messageImagesHtml(char, m, i) +
    '<p class="generated-image-caption">' +
    esc(m.content || '') +
    '</p><div class="msg-bubble-meta">' +
    messageTimeHtml(m.time) +
    '</div></div>' +
    messageActionsHtml(char, m, i) +
    '</div></div>'
  );
}
// Date dividers have no message index and never count toward floors, search, anchors or windows.
// Use the nearest earlier timestamp so window changes cannot add or drop a divider.
function chatDayStart(time) {
  var day = new Date(time);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
}
function chatDayLabel(time) {
  var day = new Date(time),
    now = new Date(),
    daysAgo = Math.round((chatDayStart(now.getTime()) - chatDayStart(time)) / 86400000);
  if (daysAgo === 0) return '今天';
  if (daysAgo === 1) return '昨天';
  var date = day.getMonth() + 1 + ' 月 ' + day.getDate() + ' 日';
  return day.getFullYear() === now.getFullYear() ? date : day.getFullYear() + ' 年 ' + date;
}
function chatDayDividerHtml(msgs, i) {
  var time = Number(msgs[i] && msgs[i].time) || 0;
  if (time <= 0) return '';
  for (var j = i - 1; j >= 0; j--) {
    var previous = Number(msgs[j] && msgs[j].time) || 0;
    if (previous <= 0) continue;
    if (chatDayStart(previous) === chatDayStart(time)) return '';
    break;
  }
  var seq = Number(msgs[i].seq);
  return (
    '<div class="chat-day-divider" id="chat-day-' +
    (seq > 0 ? 'seq-' + seq : 'idx-' + i) +
    '"><span>' +
    chatDayLabel(time) +
    '</span></div>'
  );
}
// Animate arrivals only, never rows restored by redraw, navigation or history loading.
// Motion tokens and reduced motion belong to 12-motion.js.
var CHAT_ARRIVAL_RISE_PX = 6,
  _chatArrivalMark = { page: '', seq: 0 };
function playChatArrival(row) {
  if (!row) return;
  runUiMotion(
    row,
    [
      {
        node: row,
        frames: [
          { opacity: 0, transform: 'translateY(' + CHAT_ARRIVAL_RISE_PX + 'px)' },
          { opacity: 1, transform: 'none' },
        ],
      },
    ],
    '--motion-normal'
  );
}
function appendMessageDom(char, msg, idx) {
  var ct = $('chat-messages'),
    end = $('chat-end-sentinel');
  if (!ct || !end || ct.querySelector('.empty')) {
    renderChat();
    return;
  }
  var owner = getChatViewportState(),
    follow = owner.mode === 'follow',
    anchor = follow ? null : captureChatReadingAnchor(true),
    top = ct.scrollTop,
    task = captureChatViewportTask(ct),
    msgs = getActiveSession(char.id).msgs,
    // 底部的「生成中」指示行占着下一条回复的位置，新消息插在它前面。
    tail = ct.querySelector(':scope > #stream-pending-indicator') || end;
  tail.insertAdjacentHTML(
    'beforebegin',
    chatDayDividerHtml(msgs, idx) + messageHtml(char, msg, idx, null, regexScriptMessageDepths(msgs)[idx])
  );
  if (_chatArrivalMark.page === ct.getAttribute('data-chat-reconcile'))
    _chatArrivalMark.seq = Math.max(_chatArrivalMark.seq, Number(msg.seq) || 0);
  playChatArrival(tail.previousElementSibling);
  updateChatAnchors();
  syncTavernAudioSession();
  syncCardAssetObjectUrlLifecycle(char);
  syncCardFrontends(char);
  noteChatContentBelowReader();
  var settle = function () {
    if (!chatViewportTaskMatches(task)) return;
    if (follow) writeOwnedChatScrollTop(ct, Math.max(0, ct.scrollHeight - ct.clientHeight));
    else if (anchor) applyChatReadingAnchor(anchor);
    else writeOwnedChatScrollTop(ct, top);
  };
  settle();
  requestAnimationFrame(settle);
  Promise.resolve(syncRisuDisplays(char, getActiveSession(char.id), getActiveSession(char.id).msgs || [], 0))
    .then(function () {
      settleChatThroughMedia(ct, ct, settle);
    })
    .catch(function (error) {
      console.warn('Risu 增量演出挂载失败', error);
    });
}
async function saveMsg(role, content, extra, owner) {
  const char = owner ? owner.char : getChar();
  if (!char) return null;
  const sess = owner ? owner.session : getActiveSession(char.id),
    safeContent = String(content == null ? '' : content),
    safeExtra = Object.assign({}, extra || {});
  const msg = Object.assign(
    { role: role, content: safeContent, time: Date.now(), seq: allocateMessageSeq(sess) },
    safeExtra
  );
  sess.msgs.push(msg);
  markMessageMacroEffects(char, msg);
  try {
    await saveData('sessions', { urgent: true });
  } catch (error) {
    var failedIndex = sess.msgs.indexOf(msg);
    if (failedIndex >= 0) sess.msgs.splice(failedIndex, 1);
    throw error;
  }
  if (getChar() === char && getActiveSession(char.id) === sess) appendMessageDom(char, msg, sess.msgs.length - 1);
  scheduleTokensBar(char);
  return msg;
}

function getChar() {
  return (
    D.characters.find(function (c) {
      return c.id === D.currentCharId;
    }) || null
  );
}
function getCharName(id) {
  var c = D.characters.find(function (x) {
    return x.id === id;
  });
  return c ? canonicalCharacterName(c) : '未知角色';
}

var _historyLoadedBySession = {};
// How many messages a session shows before the reader asks for more. Purely a rendering budget:
// memory compression never hides a message, it only marks where the summary takes over.
var HISTORY_RENDER_WINDOW = 200,
  HISTORY_LOAD_BATCH = 50,
  // Keeps a little context above a jump target so the target does not sit against the top edge.
  HISTORY_JUMP_CONTEXT = 5,
  // How far above the visible top the "earlier messages" hint may be before the next batch loads.
  HISTORY_AUTO_LOAD_MARGIN_PX = 600;
function getSessionCompressedUntil(sess, msgs) {
  return sess && D.settings.useMemory !== false ? memoryV5CompressedUntilIndex(sess, msgs) : 0;
}
function getHistoryRenderStart(sess, msgs) {
  var saved = _historyLoadedBySession[sess && sess.id];
  if (saved === undefined || Number(saved) >= msgs.length) return Math.max(0, msgs.length - HISTORY_RENDER_WINDOW);
  return Math.max(0, parseInt(saved) || 0);
}
function setHistoryRenderStart(sess, start, reason) {
  var ct = $('chat-messages');
  if (!sess || !ct) return false;
  var next = Math.max(0, Math.min((sess.msgs || []).length, Math.floor(start)));
  if (next === getHistoryRenderStart(sess, sess.msgs || [])) return false;
  var visual = captureChatReadingAnchor(true);
  adoptChatViewportReading(reason || 'load-older', visual);
  _historyLoadedBySession[sess.id] = next;
  renderChat();
  return true;
}
// Drop expanded history only when the saved position is inside the default window; otherwise
// retain its rows. Keeping a bottom-only expansion would tax every later redraw and send.
function historyRenderStartResettable(sess, anchor) {
  if (!sess || _historyLoadedBySession[sess.id] === undefined) return false;
  var msgs = sess.msgs || [],
    fallback = Math.max(0, msgs.length - HISTORY_RENDER_WINDOW);
  if (getHistoryRenderStart(sess, msgs) >= fallback) return false;
  if (!anchor) return false;
  if (anchor.bottom === true) return true;
  var idx = Number(anchor.idx);
  if (!Number.isFinite(idx) && Number(anchor.seq) > 0)
    idx = msgs.findIndex(function (msg) {
      return Number(msg && msg.seq) === Number(anchor.seq);
    });
  return Number.isFinite(idx) && idx >= fallback;
}
function loadOlderHistory(count) {
  var char = getChar(),
    sess = char ? getActiveSession(char.id) : null;
  if (!sess) return;
  var cur = getHistoryRenderStart(sess, sess.msgs || []);
  setHistoryRenderStart(sess, cur - (count || HISTORY_LOAD_BATCH), 'load-older');
}
// Widens the window so `idx` is rendered; returns whether the window actually moved.
function expandHistoryWindowTo(idx) {
  var char = getChar(),
    sess = char ? getActiveSession(char.id) : null;
  if (!sess) return false;
  var msgs = sess.msgs || [],
    target = Math.floor(Number(idx));
  if (!Number.isFinite(target) || target < 0 || target >= msgs.length) return false;
  if (target >= getHistoryRenderStart(sess, msgs)) return false;
  return setHistoryRenderStart(sess, target - HISTORY_JUMP_CONTEXT, 'load-target');
}
var _historyAutoLoadObserver = null,
  _historyAutoLoadHost = null,
  _historyAutoLoadNode = null,
  _historyAutoLoadBusy = false,
  _historyAutoLoadNear = false,
  _historyAutoLoadArmedAt = 0;
function historyAutoLoadScrollCount() {
  return chatViewportUserScrollCount();
}
// Opening/restoring a chat can expose the top hint without a gesture. Load more only after
// a real upward gesture on this list since observation began.
function historyAutoLoadArmed() {
  return historyAutoLoadScrollCount() > _historyAutoLoadArmedAt;
}
// Observer samples can be stale after prepending or restoring a position. Use the cached flag
// only to decide whether to measure; live rectangles must satisfy the same root/margin before loading.
function historyAutoLoadHintNear() {
  var ct = $('chat-messages'),
    hint = _historyAutoLoadNode || (ct ? ct.querySelector('#history-earlier-hint') : null);
  if (!ct || !hint) return false;
  var cr = ct.getBoundingClientRect(),
    hr = hint.getBoundingClientRect();
  return hr.bottom > cr.top - HISTORY_AUTO_LOAD_MARGIN_PX && hr.top < cr.bottom;
}
// Scrolling is re-checked as well as observed: a gesture that keeps the hint inside the margin
// produces no new observer callback, so the observer alone would never get a second chance.
function tryAutoLoadOlderHistory() {
  if (!_historyAutoLoadNear || !historyAutoLoadArmed()) return;
  if (!historyAutoLoadHintNear()) {
    _historyAutoLoadNear = false;
    return;
  }
  autoLoadOlderHistory();
}
var _historyAutoLoadScroll = function () {
  tryAutoLoadOlderHistory();
};
function autoLoadOlderHistory() {
  var ct = $('chat-messages');
  if (_historyAutoLoadBusy || !ct) return;
  // Generation owns the viewport while following the bottom; never steal it to prepend history.
  if (getChatViewportState().mode === 'follow') return;
  var char = getChar(),
    sess = char ? getActiveSession(char.id) : null;
  if (!sess || getHistoryRenderStart(sess, sess.msgs || []) <= 0) return;
  _historyAutoLoadBusy = true;
  var released = false,
    fallbackTimer,
    release = function () {
      if (released) return;
      released = true;
      clearTimeout(fallbackTimer);
      _historyAutoLoadBusy = false;
    };
  fallbackTimer = setTimeout(release, 1500);
  try {
    loadOlderHistory(HISTORY_LOAD_BATCH);
  } catch (error) {
    release();
    throw error;
  }
  // Wait for this render to settle and remeasure before another batch, preventing a whole-log cascade.
  var host = $('chat-messages');
  if (host)
    settleChatThroughMedia(host, host, function () {
      requestAnimationFrame(release);
    });
  else requestAnimationFrame(release);
}
function syncHistoryAutoLoad() {
  var ct = $('chat-messages'),
    hint = ct ? ct.querySelector('#history-earlier-hint') : null;
  if (!hint || typeof IntersectionObserver !== 'function') {
    if (_historyAutoLoadObserver) _historyAutoLoadObserver.disconnect();
    _historyAutoLoadNode = null;
    _historyAutoLoadNear = false;
    return;
  }
  if (_historyAutoLoadHost !== ct) {
    if (_historyAutoLoadObserver) _historyAutoLoadObserver.disconnect();
    if (_historyAutoLoadHost) _historyAutoLoadHost.removeEventListener('scroll', _historyAutoLoadScroll);
    _historyAutoLoadHost = ct;
    _historyAutoLoadNode = null;
    _historyAutoLoadObserver = new IntersectionObserver(
      function (entries) {
        _historyAutoLoadNear = entries.some(function (entry) {
          return entry.isIntersecting;
        });
        tryAutoLoadOlderHistory();
      },
      { root: ct, rootMargin: HISTORY_AUTO_LOAD_MARGIN_PX + 'px 0px 0px 0px' }
    );
    ct.addEventListener('scroll', _historyAutoLoadScroll, { passive: true });
  }
  // Reusing the hint keeps observation/gesture state through redraws; a new session’s hint waits
  // for its own gesture, so a redraw alone never triggers another batch.
  if (_historyAutoLoadNode === hint) return;
  _historyAutoLoadObserver.disconnect();
  _historyAutoLoadNode = hint;
  _historyAutoLoadNear = false;
  _historyAutoLoadArmedAt = historyAutoLoadScrollCount();
  _historyAutoLoadObserver.observe(hint);
}
function renderStreamDraftRecovery(char, session) {
  var slot = $('stream-draft-recovery-slot');
  if (!slot) return;
  var html = streamDraftRecoveryHtml(char, session);
  slot.innerHTML = html;
  slot.hidden = !html;
  requestAnimationFrame(syncComposerMetrics);
}
var writeOwnedChatScrollTop = function (ct, top) {
  writeChatViewportTop(ct, top);
};
// Cache markup until external DOM mutation; identical redraws need no reconciliation.
// Mounted card subtrees and their non-identity attributes are card-owned, not row mutations.
var _chatRowMarkup = new WeakMap(),
  _chatRowObserver = null,
  _chatRowObservedHost = null;
function chatRowTouched(host, record) {
  var node = record.target,
    element = node.nodeType === 1 ? node : node.parentElement,
    frontend = element && element.closest('.yeyu-card-frontend');
  if (frontend && host.contains(frontend)) {
    if (frontend !== node) return;
    if (
      record.type === 'attributes' &&
      record.attributeName !== 'class' &&
      record.attributeName !== 'data-frontend-key'
    )
      return;
  }
  while (node && node.parentNode !== host) node = node.parentNode;
  if (node) _chatRowMarkup.delete(node);
}
function noteChatRowChanges(host) {
  if (typeof MutationObserver !== 'function') return false;
  if (_chatRowObservedHost !== host) {
    if (_chatRowObserver) _chatRowObserver.disconnect();
    _chatRowObservedHost = host;
    _chatRowObserver = new MutationObserver(function (records) {
      records.forEach(function (record) {
        chatRowTouched(host, record);
      });
    });
    _chatRowObserver.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
    return false;
  }
  _chatRowObserver.takeRecords().forEach(function (record) {
    chatRowTouched(host, record);
  });
  return true;
}
function parseChatRow(markup) {
  var template = document.createElement('template');
  template.innerHTML = markup;
  return Array.prototype.filter.call(template.content.childNodes, function (node) {
    return node.nodeType === 1;
  });
}
function reconcileChatHost(host, html) {
  if (!host) return;
  var rows = Array.isArray(html) ? html : [String(html || '')];

  var watching = noteChatRowChanges(host),
    unchanged = new Map(),
    inserted = [];
  if (watching)
    Array.prototype.forEach.call(host.children, function (node) {
      var markup = _chatRowMarkup.get(node);
      if (markup != null && !unchanged.has(markup)) unchanged.set(markup, node);
    });
  var nodeKey = function (node) {
    if (!node || node.nodeType !== 1) return '';
    // seq survives index shifts (deleting an earlier message), so an untouched row keeps its DOM
    // node and the browser's native scroll anchoring keeps the reading position without any write.
    if (node.getAttribute('data-msg-seq')) return 'seq:' + node.getAttribute('data-msg-seq');
    if (node.hasAttribute('data-msg-idx')) return 'msg:' + node.getAttribute('data-msg-idx');
    if (node.id) return 'id:' + node.id;
    if (node.classList && node.classList.contains('empty')) return 'empty';
    return '';
  };
  // Unchanged rows are not parsed at all; every other row is parsed on its own, as a patch does.
  var desired = [];
  rows.forEach(function (markup) {
    var kept = unchanged.get(markup);
    if (kept) {
      unchanged.delete(markup);
      desired.push({ node: kept, key: nodeKey(kept), markup: markup, kept: true });
      return;
    }
    var parsed = parseChatRow(markup);
    parsed.forEach(function (node) {
      desired.push({ node: node, key: nodeKey(node), markup: parsed.length === 1 ? markup : null });
    });
  });
  var existing = {};
  Array.prototype.forEach.call(host.children, function (node) {
    var key = nodeKey(node);
    if (key && !existing[key]) existing[key] = node;
  });
  var used = {},
    cursor = host.firstChild;
  var wanted = new Set(
    desired.map(function (entry) {
      return entry.key;
    })
  );
  Array.from(host.children).forEach(function (node) {
    if (!wanted.has(nodeKey(node))) node.remove();
  });
  var remember = function (node, markup) {
    if (markup == null) _chatRowMarkup.delete(node);
    else _chatRowMarkup.set(node, markup);
  };
  cursor = host.firstChild;
  desired.forEach(function (entry) {
    var key = entry.key,
      match = key && existing[key] && !used[key] ? existing[key] : null,
      node = entry.kept && match !== entry.node ? parseChatRow(entry.markup)[0] : entry.node;
    if (match) {
      used[key] = true;
      if (match !== cursor) host.insertBefore(match, cursor || null);
      if (match !== node) reconcileStreamNode(match, node);
      remember(match, entry.markup);
      cursor = match.nextSibling;
      return;
    }
    var imported = document.importNode(node, true);
    host.insertBefore(imported, cursor || null);
    remember(imported, entry.markup);
    inserted.push(imported);
    cursor = imported.nextSibling;
  });
  while (cursor) {
    var after = cursor.nextSibling;
    cursor.remove();
    cursor = after;
  }
  // What changed above is this markup itself, not something to invalidate it.
  if (_chatRowObservedHost === host) _chatRowObserver.takeRecords();
  return inserted;
}
function patchRegexDisplayMessages(targets) {
  var char = getChar(),
    sess = char && getActiveSession(char.id),
    host = $('chat-messages');
  if (
    !char ||
    !sess ||
    !host ||
    !Array.isArray(targets) ||
    !targets.length ||
    host.getAttribute('data-chat-reconcile') !== String(char.id) + '|' + String(sess.id)
  )
    return false;
  var rows = new Map();
  for (var target of targets) {
    if (
      target.charId !== String(char.id) ||
      target.sessionId !== String(sess.id) ||
      sess.msgs[target.index] !== target.message
    )
      return false;
    var row = host.querySelector('[data-msg-idx="' + target.index + '"]');
    if (!row) return false;
    rows.set(target.index, row);
  }
  var owner = getChatViewportState(),
    follow = owner.mode === 'follow',
    anchor = follow ? null : captureChatReadingAnchor(true),
    depths = regexScriptMessageDepths(sess.msgs);
  rows.forEach(function (row, index) {
    var template = document.createElement('template');
    template.innerHTML = messageHtml(char, sess.msgs[index], index, null, depths[index]);
    reconcileStreamNode(row, template.content.firstElementChild);
  });
  updateChatAnchors();
  syncTavernAudioSession();
  syncCardAssetObjectUrlLifecycle(char);
  syncCardFrontends(char);
  var visibleTexts = [];
  rows.forEach(function (_, index) {
    var msg = sess.msgs[index];
    if (msg && msg.role === 'assistant') {
      visibleTexts.push({
        text: assistantMessageParts(msg).content,
        message: msg,
        role: 'assistant',
        depth: depths[index],
      });
    }
  });
  if (visibleTexts.length)
    Promise.resolve(hydrateReferencedCardAssets(char, visibleTexts))
      .then(function (changed) {
        if (changed && getChar() === char && getActiveSession(char.id) === sess) renderChat();
      })
      .catch(function (error) {
        console.warn('对话素材读取失败', error);
      });
  if (follow) followChatBottomThroughMedia(host, host);
  else if (anchor)
    settleChatThroughMedia(host, host, function () {
      applyChatReadingAnchor(anchor);
    });
  return true;
}
var _chatReadingPositions = new Map();
var _chatPositionSavedForSwitch = '';
// Save bottom-follow as a position: a row anchor would let later growth push the newest message offscreen.
function currentChatReadingPosition(host) {
  return host && isNearChatBottom(host) ? { bottom: true } : captureChatReadingAnchor(true);
}
function rememberCurrentChatPosition() {
  var host = $('chat-messages'),
    key = host && host.getAttribute('data-chat-reconcile');
  if (!key) return;
  _chatReadingPositions.set(key, currentChatReadingPosition(host));
  _chatPositionSavedForSwitch = key;
}
function renderChat(risuDisplayCompleted) {
  if (risuDisplayCompleted !== true) _risuDisplayClockEpoch++;
  syncExpressions();
  var host = $('chat-messages'),
    stateChar = getChar(),
    stateSession = stateChar ? getActiveSession(stateChar.id) : null,
    owner = getChatViewportState(),
    follow = owner.mode === 'follow',
    anchor = host && !follow ? captureChatReadingAnchor(true) : null,
    pageKey = stateChar && stateSession ? String(stateChar.id) + '|' + String(stateSession.id) : '',
    previousPage = host && host.getAttribute('data-chat-reconcile');
  if (host && previousPage !== pageKey) {
    if (previousPage && _chatPositionSavedForSwitch !== previousPage)
      _chatReadingPositions.set(previousPage, currentChatReadingPosition(host));
    anchor = _chatReadingPositions.get(pageKey) || { bottom: true };
    follow = false;
    adoptChatViewportReading('open-chat', anchor);
    // Re-entry already rebuilds the list; shrink before reading the window to avoid another render.
    if (historyRenderStartResettable(stateSession, anchor)) delete _historyLoadedBySession[stateSession.id];
  }
  _chatPositionSavedForSwitch = '';
  if (stateSession) risuCaptureDisplayStates(stateSession.msgs || []);
  retainChatViewportRender();
  if (!follow) rememberChatViewportAnchor(anchor);
  risuAdoptDisplayContextOwner(stateChar);
  risuSyncCharacterDisplayOptions(stateChar);
  var previousRisuEnvironment = _risuDisplayRenderEnvironment;
  if (stateChar && isRisuCharacter(stateChar)) {
    _risuDisplayRenderEnvironment = chatSearchEnvironment(stateChar, stateSession);
    _risuDisplayRenderEnvironment.scriptDisplayKey = null;
  }
  try {
    withRegexScriptDisplayScope(stateChar, renderChatContent);
  } finally {
    _risuDisplayRenderEnvironment = previousRisuEnvironment;
  }
  if (!host) return;
  if (follow) followChatBottomThroughMedia(host, host);
  else if (anchor)
    settleChatThroughMedia(host, host, function () {
      applyChatReadingAnchor(anchor);
    });
}
function renderChatContent() {
  syncRisuExecutionSessions();
  const char = getChar(),
    ct = $('chat-messages'),
    sess = char ? getActiveSession(char.id) : null;
  refreshComposerImageButton();
  if (ct) {
    bindChatViewportHost(ct);
    bindChatNavigationVisibility(ct);
  }
  renderStreamDraftRecovery(char, sess);
  if (!char) {
    clearRisuDisplays();
    _chatArrivalMark = { page: '', seq: 0 };
    if (ct) ct.removeAttribute('data-chat-reconcile');
    ct.innerHTML = '';
    updateChatAnchors();
    syncHistoryAutoLoad();
    syncTavernAudioSession();
    syncCardAssetObjectUrlLifecycle(null);
    releaseCardFrontends('');
    return;
  }
  const msgs = sess ? sess.msgs : [];
  var pageKey = String(char.id || '') + '|' + String((sess && sess.id) || '');
  if (!msgs.length) {
    _chatArrivalMark = { page: pageKey, seq: 0 };
    ct.setAttribute('data-chat-reconcile', pageKey);
    ct.innerHTML =
      '<div class="empty" id="chat-empty"><h3>还没有消息</h3><p>在下方写下第一句话，和 ' +
      esc(canonicalCharacterName(char)) +
      ' 开始这段对话。</p></div><div id="chat-end-sentinel" class="chat-end-sentinel"></div>';
    updateChatAnchors();
    syncHistoryAutoLoad();
    syncTavernAudioSession();
    syncCardAssetObjectUrlLifecycle(char);
    syncCardFrontends(char);
    Promise.resolve(syncRisuDisplays(char, sess, msgs, 0)).catch(console.warn);
    return;
  }
  var start = getHistoryRenderStart(sess, msgs),
    templateRenderContext = {},
    compressed = getSessionCompressedUntil(sess, msgs),
    depths = regexScriptMessageDepths(msgs),
    messagePanelContext = createMessagePanelRenderContext(msgs, char, start),
    rows = [];
  if (start > 0)
    rows.push(
      '<div class="history-earlier-hint" id="history-earlier-hint" role="status" data-earlier="' +
        start +
        '">更早的 ' +
        start +
        ' 条 · 继续上滑加载</div>'
    );
  for (var i = start; i < msgs.length; i++) {
    if (i === compressed && compressed > start)
      rows.push(
        '<div class="history-compress-divider" id="history-compress-divider"><span>以上对话已整理为摘要，发送时用摘要代替</span></div>'
      );
    var dayDivider = chatDayDividerHtml(msgs, i);
    if (dayDivider) rows.push(dayDivider);
    rows.push(messageHtml(char, msgs[i], i, messagePanelContext, depths[i], templateRenderContext));
  }
  rows.push('<div id="chat-end-sentinel" class="chat-end-sentinel" aria-hidden="true"></div>');
  // Opening a page is not an arrival; on the same page only rows past the newest one shown before are.
  var arrivalFloor = _chatArrivalMark.page === pageKey ? _chatArrivalMark.seq : Infinity;
  _chatArrivalMark = {
    page: pageKey,
    seq: msgs.reduce(function (max, msg) {
      return Math.max(max, Number(msg && msg.seq) || 0);
    }, 0),
  };
  if (ct.getAttribute('data-chat-reconcile') === pageKey)
    (reconcileChatHost(ct, rows) || []).forEach(function (row) {
      if (Number(row.getAttribute('data-msg-seq')) > arrivalFloor) playChatArrival(row);
    });
  else {
    ct.setAttribute('data-chat-reconcile', pageKey);
    ct.innerHTML = rows.join('');
  }
  updateChatAnchors();
  syncHistoryAutoLoad();
  syncStreamPendingIndicator();
  syncTavernAudioSession();
  syncCardAssetObjectUrlLifecycle(char);
  syncCardFrontends(char);
  Promise.resolve(syncRisuDisplays(char, sess, msgs, start)).catch(function (error) {
    console.warn('Risu 演出挂载失败', error);
  });
  var visibleTexts = [];
  msgs.slice(start).forEach(function (msg, offset) {
    if (msg && msg.role === 'assistant') {
      var assetText = assistantMessageParts(msg).content;
      visibleTexts.push({
        text: assetText,
        message: msg,
        role: 'assistant',
        depth: depths[start + offset],
      });
      if (msg.opening) queueOpeningMediaHydration(char, msg.openingIndex == null ? 0 : msg.openingIndex);
    }
  });
  if (visibleTexts.length) {
    var hydrateCharId = char.id,
      hydrateSessId = sess && sess.id;
    Promise.resolve(hydrateReferencedCardAssets(char, visibleTexts))
      .then(function (changed) {
        if (!changed) return;
        var now = getChar(),
          nowSess = now ? getActiveSession(now.id) : null;
        if (now && now.id === hydrateCharId && nowSess && nowSess.id === hydrateSessId) renderChat();
      })
      .catch(function (error) {
        console.warn('对话素材读取失败', error);
      });
  }
}
// Message search covers the whole conversation, not just the rendered window, and reads a derived
// readable view of each message: it never writes back to content and is never persisted.
var CHAT_SEARCH_SNIPPET_CHARS = 100,
  CHAT_SEARCH_DEBOUNCE_MS = 120,
  _chatSearchState = { charId: '', sessionId: '', keyword: '' },
  _chatSearchTextCache = typeof WeakMap === 'function' ? new WeakMap() : null,
  _chatSearchEnvironment = null,
  _chatSearchTimer = null;
function chatSearchableMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (isBranchReturnMessage(msg)) return false;
  if (isBranchReturnRevertMessage(msg)) return false;
  // A live streaming draft is DOM only, but a restored one carries these markers in the session.
  if (msg.kind === 'stream-draft' || msg.streamDraft === true || msg.isStreamDraft === true) return false;
  if (msg.role === 'user' || msg.role === 'assistant') return true;
  // /sys narration is searchable; script replies use the same kind but mark excludeFromMemory.
  // That marker distinguishes them. Other system messages stay out.
  return msg.role === 'system' && msg.kind === 'stscript-system' && msg.excludeFromMemory !== true;
}
function chatSearchEnvironment(char, sess) {
  var signature = JSON.stringify([
    displayName('user'),
    displayName('char'),
    characterPromptName(char),
    (sess && sess.risu) || null,
    (sess && sess.macroVars) || null,
    D.settings.stscript && D.settings.stscript.globalVars,
    isRisuCharacter(char)
      ? [
          char.character_book,
          risuLorebookModuleSource(char),
          risuLorebookStoredGlobal(char),
          risuPersonaDisplayState(char),
          risuDefaultVariables(char),
          [
            char.name,
            char.nickname,
            char.description,
            char.desc,
            char.personality,
            char.scenario,
            char.exampleDialogue,
            char.exampleMessage,
            char.mes_example,
            char.firstMessage,
            char.first_mes,
            char.alternateGreetings,
            char.alternate_greetings,
          ],
          (sess.msgs || []).map(function (message) {
            return [
              risuMessageTemplate(message),
              message.role,
              message.time,
              message.opening,
              message.openingIndex,
              message.seq,
            ];
          }),
          resolveApiRoute('chat'),
          D.settings.authorsNote,
          D.settings.maxContextTokens,
          window.innerWidth,
          window.innerHeight,
          _risuTriggerIds.get(sess) && _risuTriggerIds.get(sess).value,
        ]
      : null,
  ]);
  // Compare the potentially large lorebook signature once per search, not once per message.
  if (
    !_chatSearchEnvironment ||
    _chatSearchEnvironment.char !== char ||
    _chatSearchEnvironment.session !== sess ||
    _chatSearchEnvironment.signature !== signature
  )
    _chatSearchEnvironment = { char: char, session: sess, signature: signature };
  return _chatSearchEnvironment;
}
function chatSearchReadableText(char, sess, msg, env, evaluated) {
  var source = JSON.stringify([msg.content, msg.risu, msg.role, msg.opening]),
    cached = _chatSearchTextCache ? _chatSearchTextCache.get(msg) : null,
    revision = isRisuCharacter(char) ? _risuDisplayCache : null;
  if (cached && cached.source === source && cached.env === env && cached.revision === revision) return cached.text;
  var body = messageDisplayParts(char, msg).content;
  if (msg.role !== 'system') {
    if (isRisuCharacter(char)) {
      if (evaluated === undefined) throw new Error('Risu 搜索正文尚未完成计算');
      body = risuStripAssetMacros(evaluated);
    }
    var segments = cardFrontendSegments(body);
    for (var at = segments.length - 1; at >= 0; at--)
      body = body.slice(0, segments[at].start) + '\n' + body.slice(segments[at].end);
    body = cleanDisplayText(body, msg.role, { char: char });
    body = window.YeyuPure.decodeAttrText(window.YeyuPure.readableMessageText(body));
  }
  // System narration is escaped literally by chat: macros, Markdown and entities are all text.
  var text = body.replace(/\s+/g, ' ').trim();
  if (_chatSearchTextCache) _chatSearchTextCache.set(msg, { source: source, env: env, revision: revision, text: text });
  return text;
}
function chatSearchResults(char, msgs, keyword, options) {
  var needle = String(keyword || '')
      .trim()
      .toLowerCase(),
    hits = [];
  if (!needle) return hits;
  var sess = getActiveSession(char && char.id),
    env = chatSearchEnvironment(char, sess);
  if (isRisuCharacter(char))
    return (async function () {
      var pending = msgs.filter(function (message) {
        if (!chatSearchableMessage(message) || message.role === 'system') return false;
        var cached = _chatSearchTextCache && _chatSearchTextCache.get(message);
        if (_risuDisplayClockReads.has(message)) {
          if (_chatSearchTextCache) _chatSearchTextCache.delete(message);
          return true;
        }
        return (
          !cached ||
          cached.env !== env ||
          cached.revision !== _risuDisplayCache ||
          cached.source !== JSON.stringify([message.content, message.risu, message.role, message.opening])
        );
      });
      var values = pending.length
        ? await risuEvaluateDisplayMessages(
            char,
            sess,
            pending,
            function () {
              return chatSearchEnvironment(char, sess) === env;
            },
            options && options.signal
          )
        : [];
      if (chatSearchEnvironment(char, sess) !== env) throw risuAbortError();
      var evaluated = new Map();
      pending.forEach(function (message, index) {
        evaluated.set(message, values[index]);
      });
      return collect(evaluated);
    })();
  return collect();
  function collect(evaluated) {
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (!chatSearchableMessage(m)) continue;
      var text = chatSearchReadableText(char, sess, m, env, evaluated && evaluated.get(m));
      if (text.toLowerCase().indexOf(needle) < 0) continue;
      hits.push({ index: i, role: m.role, hidden: m.hidden === true, text: text });
    }
    return hits;
  }
}
function chatSearchCurrentKeyword(char, sess) {
  var charId = String((char && char.id) || ''),
    sessionId = String((sess && sess.id) || '');
  if (_chatSearchState.charId !== charId || _chatSearchState.sessionId !== sessionId) {
    _chatSearchState.charId = charId;
    _chatSearchState.sessionId = sessionId;
    _chatSearchState.keyword = '';
    clearTimeout(_chatSearchTimer);
    var input = $('chat-anchor-search');
    if (input) input.value = '';
  }
  return _chatSearchState.keyword;
}
function applyChatSearchKeyword() {
  var input = $('chat-anchor-search');
  if (!input || _chatSearchState.keyword === input.value) return;
  _chatSearchState.keyword = input.value;
  renderChatAnchorList();
}
function clearChatSearchKeyword() {
  clearTimeout(_chatSearchTimer);
  var input = $('chat-anchor-search');
  if (!input) return;
  input.value = '';
  applyChatSearchKeyword();
  input.focus();
}
function scheduleChatSearchKeyword() {
  clearTimeout(_chatSearchTimer);
  _chatSearchTimer = setTimeout(applyChatSearchKeyword, CHAT_SEARCH_DEBOUNCE_MS);
}
function bindChatSearchInput(input) {
  if (!input) return;
  input.addEventListener('input', function (event) {
    // Searching intermediate IME composition repeats work and can interrupt composition.
    if (event.isComposing) return;
    scheduleChatSearchKeyword();
  });
  input.addEventListener('compositionend', scheduleChatSearchKeyword);
}
function chatAnchorFloorListHtml(sess, msgs) {
  var start = getHistoryRenderStart(sess, msgs),
    h = '';
  if (start > 0)
    h +=
      '<button type="button" class="anchor-preview" onclick="loadOlderHistory(' +
      HISTORY_LOAD_BATCH +
      ');toggleAnchorPanel(false)"><b>更早的 ' +
      start +
      ' 条</b><span>加载后可在这里选择跳转</span></button>';
  for (var i = start; i < msgs.length; i++) {
    var m = msgs[i],
      role = m.role === 'user' ? '用户' : m.role === 'system' ? '系统' : '角色',
      text =
        String(m.content || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100) || '（空消息）';
    h +=
      '<button type="button" class="anchor-preview" onclick="jumpToMessage(' +
      i +
      ');toggleAnchorPanel(false)"><b>#' +
      (i + 1) +
      ' · ' +
      role +
      (m.hidden ? ' · <em class="anchor-tag">已隐藏</em>' : '') +
      '</b><span>' +
      esc(text) +
      '</span></button>';
  }
  return h;
}
function chatSearchResultHtml(hit, keyword) {
  return (
    '<button type="button" class="anchor-preview" onclick="jumpToMessage(' +
    hit.index +
    ');toggleAnchorPanel(false)"><b>#' +
    (hit.index + 1) +
    ' · ' +
    (hit.role === 'user' ? '用户' : hit.role === 'system' ? '旁白' : '角色') +
    (hit.hidden ? ' · <em class="anchor-tag">已隐藏</em>' : '') +
    '</b><span>' +
    window.YeyuPure.matchSnippetHtml(hit.text, keyword, CHAT_SEARCH_SNIPPET_CHARS) +
    '</span></button>'
  );
}
var _chatSearchRenderRevision = 0,
  _chatSearchController = null;
async function renderChatAnchorList() {
  var revision = ++_chatSearchRenderRevision;
  if (_chatSearchController) _chatSearchController.abort();
  var controller = (_chatSearchController = new AbortController());
  var panel = $('chat-anchor-panel'),
    char = getChar(),
    list = panel ? $('chat-anchor-list') : null,
    count = panel ? $('chat-anchor-count') : null;
  if (!list || !char) return;
  var sess = getActiveSession(char.id),
    msgs = sess ? sess.msgs : [],
    keyword = chatSearchCurrentKeyword(char, sess).trim();
  var clear = $('chat-anchor-clear');
  if (clear) clear.hidden = !$('chat-anchor-search').value;
  if (!keyword) {
    if (count) count.hidden = true;
    list.innerHTML = chatAnchorFloorListHtml(sess, msgs);
    return;
  }
  var hits;
  try {
    var result = chatSearchResults(char, msgs, keyword, { signal: controller.signal });
    if (result && typeof result.then === 'function') {
      if (count) {
        count.hidden = false;
        count.textContent = '搜索中…';
      }
      hits = await result;
    } else hits = result;
  } catch (error) {
    if (error.name !== 'AbortError') risuScriptError(error);
    if (revision === _chatSearchRenderRevision && count) count.textContent = '搜索已停止';
    return;
  }
  if (revision !== _chatSearchRenderRevision || getChar() !== char || getActiveSession(char.id) !== sess) return;
  if (count) {
    count.hidden = false;
    count.textContent = '共 ' + hits.length + ' 条';
  }
  list.innerHTML = hits.length
    ? hits
        .map(function (hit) {
          return chatSearchResultHtml(hit, keyword);
        })
        .join('')
    : '<p class="ui-empty">这段对话里没有包含这个词的消息</p>';
}
function buildChatAnchorPanel() {
  var panel = $('chat-anchor-panel'),
    char = getChar();
  if (!panel || !char) return;
  // The head survives rebuilds: recreating the input mid-typing drops the caret and whatever the
  // input method is still composing.
  if (!$('chat-anchor-search')) {
    panel.innerHTML =
      '<div class="chat-anchor-head"><div class="session-manager-search chat-anchor-search">' +
      '<svg class="ui-icon" aria-hidden="true"><use href="#i-search" xlink:href="#i-search"></use></svg>' +
      '<input type="text" id="chat-anchor-search" autocomplete="off" aria-label="搜索这段对话" placeholder="搜索这段对话">' +
      '<button type="button" id="chat-anchor-clear" class="chat-anchor-clear" aria-label="清空关键词" onclick="clearChatSearchKeyword()" hidden>' +
      '<svg class="ui-icon" aria-hidden="true"><use href="#i-close" xlink:href="#i-close"></use></svg></button></div>' +
      '<div class="chat-anchor-count" id="chat-anchor-count" hidden></div></div>' +
      '<div class="chat-anchor-list" id="chat-anchor-list"></div>';
    bindChatSearchInput($('chat-anchor-search'));
    $('chat-anchor-search').value = chatSearchCurrentKeyword(char, getActiveSession(char.id));
  }
  renderChatAnchorList();
  panel.dataset.ready = '1';
}
var _chatNavigationHost = null;
function hideChatNavigation() {
  var tools = $('chat-nav-tools');
  if (!tools) return false;
  tools.classList.add('is-auto-hidden');
  tools.inert = true;
  return tools.style.display !== 'none';
}
function showChatNavigation() {
  var tools = $('chat-nav-tools');
  if (!tools || tools.style.display === 'none') return false;
  tools.classList.remove('is-auto-hidden');
  tools.inert = false;
  return true;
}
function bindChatNavigationVisibility(host) {
  if (!host || _chatNavigationHost === host) return;
  _chatNavigationHost = host;
  host.addEventListener(
    'scroll',
    function () {
      hideChatNavigation();
      var panel = $('chat-anchor-panel');
      if (!panel || !panel.classList.contains('open')) return;
      // Keyboard resize scrolls chat: exempt it while the keyboard is up, or tapping search
      // would immediately close the panel. Focus alone must not keep that exemption afterward.
      if (document.body.classList.contains('keyboard-open') && panel.contains(document.activeElement)) return;
      toggleAnchorPanel(false);
    },
    { passive: true }
  );
}
function updateChatAnchors() {
  var panel = $('chat-anchor-panel'),
    tools = $('chat-nav-tools'),
    reveal = $('chat-navigation-reveal'),
    char = getChar();
  if (!panel || !tools) return;
  var msgs = char ? getMsgs(char.id) : [],
    available = msgs.length > 0;
  tools.style.display = available ? 'flex' : 'none';
  tools.classList.add('is-auto-hidden');
  tools.inert = true;
  if (reveal) {
    reveal.hidden = !available;
    reveal.style.display = available ? '' : 'none';
  }
  panel.dataset.ready = '0';
  // An open panel is rebuilt rather than blanked: the reader's keyword and results have to survive
  // the redraws a running conversation keeps causing.
  if (available && panel.classList.contains('open')) buildChatAnchorPanel();
  else panel.innerHTML = '';
}
function toggleAnchorPanel(force) {
  var p = $('chat-anchor-panel');
  if (!p) return;
  if (force === false) {
    $('chat-anchor-toggle').setAttribute('aria-expanded', 'false');
    transitionUiVisibility(p, false, function () {
      p.classList.remove('open');
    });
    return;
  }
  hideChatNavigation();
  if (!p.classList.contains('open') && p.dataset.ready !== '1') buildChatAnchorPanel();
  var open = !p.classList.contains('open');
  $('chat-anchor-toggle').setAttribute('aria-expanded', String(open));
  transitionUiVisibility(p, open, function () {
    p.classList.toggle('open', open);
  });
}
function getVisibleMessageIndex() {
  var ct = $('chat-messages');
  if (!ct) return -1;
  var base = ct.getBoundingClientRect().top + ct.clientHeight * 0.48,
    best = -1,
    dist = Infinity;
  ct.querySelectorAll('[data-msg-idx]').forEach(function (el) {
    var r = el.getBoundingClientRect(),
      d = Math.abs(r.top + r.height / 2 - base);
    if (d < dist) {
      dist = d;
      best = Number(el.getAttribute('data-msg-idx'));
    }
  });
  return best;
}
var readingAnchorNodeText = function (el) {
  return String((el && el.textContent) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
};
var chatReadingSelector = 'p,li,h1,h2,h3,h4,blockquote,pre,img,summary,input,textarea,button,.think-block';
function chatReadingChildren(node) {
  return Array.from(node.children).filter(function (child) {
    return !/^(STYLE|SCRIPT|LINK|META|TITLE|TEMPLATE)$/.test(child.tagName);
  });
}
function chatReadingNodePath(node, root) {
  var path = [];
  while (node && node !== root) {
    var parent = node.parentElement;
    if (!parent) return null;
    path.unshift(chatReadingChildren(parent).indexOf(node));
    node = parent;
  }
  return node === root ? path : null;
}
// Sample only frame boxes during gestures to avoid forcing animated card layouts every frame.
// Restoration samples again inside the frames.
function captureChatReadingAnchor(forceVisual, outsideFrames) {
  var ct = $('chat-messages');
  if (!ct) return null;
  var owner = getChatViewportState();
  if (!forceVisual && owner.mode === 'follow') return { bottom: true };
  var cr = ct.getBoundingClientRect(),
    chosen = null;
  ct.querySelectorAll('[data-msg-idx]').forEach(function (el) {
    if (chosen) return;
    var r = el.getBoundingClientRect();
    if (r.bottom <= cr.top) return;
    var inner = null,
      best = Infinity;
    var consider = function (node, root, frame, frameIndex) {
      var ir = node.getBoundingClientRect(),
        shift = frame ? frame.getBoundingClientRect().top : 0,
        top = ir.top + shift,
        bottom = ir.bottom + shift,
        distance = Math.max(0, top - cr.top);
      if (ir.width <= 0 || ir.height <= 0 || bottom <= cr.top || top >= cr.bottom) return;
      if (distance > best || (distance === best && inner && !inner.node.contains(node))) return;
      inner = { node: node, root: root, frameIndex: frameIndex, top: top };
      best = distance;
    };
    // Toolbars are not restored by redraws, so their transient buttons cannot be reading anchors.
    el.querySelectorAll(outsideFrames ? chatReadingSelector + ',iframe' : chatReadingSelector).forEach(function (node) {
      if (!node.closest('.msg-actions')) consider(node, el, null, null);
    });
    if (!outsideFrames)
      el.querySelectorAll('iframe').forEach(function (frame, index) {
        try {
          var root = frame.contentDocument && frame.contentDocument.body;
          if (root)
            root.querySelectorAll(chatReadingSelector).forEach(function (node) {
              consider(node, root, frame, index);
            });
        } catch (_) {}
      });
    if (inner) {
      chosen = {
        idx: Number(el.getAttribute('data-msg-idx')),
        seq: Number(el.getAttribute('data-msg-seq')) || null,
        offset: inner.top - cr.top,
        text: readingAnchorNodeText(inner.node),
        tag: inner.node.tagName,
        path: chatReadingNodePath(inner.node, inner.root),
        frameIndex: inner.frameIndex,
      };
    } else
      chosen = {
        idx: Number(el.getAttribute('data-msg-idx')),
        seq: Number(el.getAttribute('data-msg-seq')) || null,
        offset: r.top - cr.top,
        text: readingAnchorNodeText(el),
      };
  });
  return chosen || { scrollTop: ct.scrollTop };
}
function applyChatReadingAnchor(anchor) {
  var ct = $('chat-messages');
  if (!ct || !anchor) return;
  var write = function (top) {
    if (Math.abs(top - ct.scrollTop) > 1) writeOwnedChatScrollTop(ct, top);
  };
  if (anchor.bottom) {
    write(Math.max(0, ct.scrollHeight - ct.clientHeight));
    return;
  }
  var msg = anchor.seq
    ? ct.querySelector('[data-msg-seq="' + anchor.seq + '"]')
    : Number.isFinite(anchor.idx)
      ? ct.querySelector('[data-msg-idx="' + anchor.idx + '"]')
      : null;
  // If the row was removed, keep the nearest surviving row at the same offset rather than jump to an edge.
  if (!msg && Number.isFinite(anchor.idx)) {
    var rows = ct.querySelectorAll('[data-msg-idx]'),
      bestDist = Infinity;
    rows.forEach(function (el) {
      var dist = Math.abs(Number(el.getAttribute('data-msg-idx')) - anchor.idx);
      if (dist < bestDist) {
        bestDist = dist;
        msg = el;
      }
    });
    if (msg) anchor = Object.assign({}, anchor, { text: '', path: null, frameIndex: null, offset: 0 });
  }
  if (!msg) {
    if (Number.isFinite(anchor.scrollTop)) write(anchor.scrollTop);
    return;
  }
  var target = msg,
    root = msg,
    frame = null;
  if (Number.isInteger(anchor.frameIndex)) {
    frame = msg.querySelectorAll('iframe')[anchor.frameIndex];
    try {
      root = (frame && frame.contentDocument && frame.contentDocument.body) || msg;
    } catch (_) {}
  }
  if (Array.isArray(anchor.path)) {
    var candidate = root;
    anchor.path.forEach(function (index) {
      candidate = candidate && chatReadingChildren(candidate)[index];
    });
    if (candidate && candidate.tagName === anchor.tag && readingAnchorNodeText(candidate) === anchor.text)
      target = candidate;
  }
  if (target === msg && anchor.text) {
    var nodes = root.querySelectorAll(chatReadingSelector + ',.msg-bubble');
    for (var i = 0; i < nodes.length; i++) {
      var text = readingAnchorNodeText(nodes[i]);
      if (text === anchor.text || text.indexOf(String(anchor.text).slice(0, 16)) === 0) {
        target = nodes[i];
        break;
      }
    }
  }
  var cr = ct.getBoundingClientRect(),
    r = target.getBoundingClientRect(),
    shift = frame && target.ownerDocument === frame.contentDocument ? frame.getBoundingClientRect().top : 0,
    next = ct.scrollTop + (r.top + shift - cr.top - (Number.isFinite(anchor.offset) ? anchor.offset : 0));
  write(next);
}
function setChatScrollBoundary(toEnd) {
  const ct = $('chat-messages');
  if (!ct) return;
  noteChatViewportUserIntent();
  if (toEnd && _generationState === 'idle') {
    var endChar = getChar(),
      endSess = endChar ? getActiveSession(endChar.id) : null;
    // Jumping to the end is the reader returning to the newest message; the redraw happens before the
    // bottom is written below, so the rows that disappear above never show.
    if (historyRenderStartResettable(endSess, { bottom: true })) {
      delete _historyLoadedBySession[endSess.id];
      renderChat();
    }
  }
  if (toEnd) {
    if (_generationState !== 'idle') adoptChatViewportFollow('jump-bottom');
    else adoptChatViewportReading('jump-bottom');
  } else {
    var first = ct.querySelector('[data-msg-idx]'),
      anchor = first
        ? { idx: Number(first.getAttribute('data-msg-idx')), offset: 0, text: readingAnchorNodeText(first) }
        : { scrollTop: 0 };
    adoptChatViewportReading('jump-top', anchor);
  }
  var task = captureChatViewportTask(ct),
    kept = !toEnd ? getChatViewportState().anchor : null;
  requestAnimationFrame(function () {
    if (!chatViewportTaskMatches(task)) return;
    writeOwnedChatScrollTop(ct, toEnd ? Math.max(0, ct.scrollHeight - ct.clientHeight) : 0);
    if (toEnd) followChatBottomThroughMedia(ct, ct);
    else
      settleChatThroughMedia(ct, ct, function () {
        applyChatReadingAnchor(kept);
      });
  });
  toggleAnchorPanel(false);
}
async function confirmJumpConversationStart() {
  hideChatNavigation();
  if (!(await appConfirm('确定跳转到当前对话的最开头吗？', '跳转到对话开头', '跳转'))) return;
  await jumpToConversationStart();
}
// Render the entire history before anchoring message #1.
async function jumpToConversationStart() {
  var char = getChar(),
    sess = char ? getActiveSession(char.id) : null,
    msgs = sess ? sess.msgs || [] : [];
  if (!sess || !msgs.length || getHistoryRenderStart(sess, msgs) <= 0) {
    setChatScrollBoundary(false);
    return;
  }
  var charId = char.id,
    sessionId = sess.id,
    handle = scriptLoaderShow({
      message: '正在加载更早的对话',
      title: '跳转到对话开头',
      toast: 'static',
      blocking: true,
      slug: 'chat-start',
    });
  var nextFrame = function () {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  };
  try {
    // Let the notice paint before the whole history renders on this same thread.
    await nextFrame();
    var now = getChar(),
      nowSess = now ? getActiveSession(now.id) : null;
    if (!now || now.id !== charId || !nowSess || nowSess.id !== sessionId) return;
    noteChatViewportUserIntent();
    setHistoryRenderStart(nowSess, 0, 'jump-conversation-start');
    var ct = $('chat-messages');
    if (!ct) return;
    var task = captureChatViewportTask(ct);
    await nextFrame();
    if (!chatViewportTaskMatches(task)) return;
    jumpToMessage(0);
  } finally {
    if (handle) Promise.resolve(scriptLoaderFinish(handle, false)).catch(function () {});
    toggleAnchorPanel(false);
  }
}
async function confirmJumpConversationEnd() {
  hideChatNavigation();
  if (!(await appConfirm('确定跳转到当前对话的最底部吗？', '跳转到对话底部', '跳转'))) return;
  setChatScrollBoundary(true);
}
function jumpRelativeMessage(step) {
  hideChatNavigation();
  var msgs = getMsgs(D.currentCharId);
  if (!msgs.length) return;
  var i = getVisibleMessageIndex();
  if (i < 0) i = step > 0 ? -1 : msgs.length;
  i = Math.max(0, Math.min(msgs.length - 1, i + step));
  jumpToMessage(i);
}
function scrollChatToBottomAfterRender() {
  var ct = $('chat-messages');
  if (!ct) return;
  var task = captureChatViewportTask(ct);
  requestAnimationFrame(function () {
    if (chatViewportTaskMatches(task)) setChatScrollBoundary(true);
  });
}
function jumpToMessage(idx) {
  hideChatNavigation();
  var ct = $('chat-messages'),
    el = ct ? ct.querySelector('[data-msg-idx="' + idx + '"]') : null;
  if (!el && expandHistoryWindowTo(idx)) {
    ct = $('chat-messages');
    el = ct ? ct.querySelector('[data-msg-idx="' + idx + '"]') : null;
  }
  if (!el) return;
  noteChatViewportUserIntent();
  try {
    el.scrollIntoView({ behavior: 'auto', block: 'center' });
  } catch (e) {
    el.scrollIntoView(true);
  }
  var cr = ct.getBoundingClientRect(),
    r = el.getBoundingClientRect(),
    anchor = { idx: idx, offset: r.top - cr.top, text: readingAnchorNodeText(el) };
  adoptChatViewportReading('jump-message', anchor);
  settleChatThroughMedia(ct, ct, function () {
    applyChatReadingAnchor(anchor);
  });
  el.classList.add('anchor-hit');
  setTimeout(function () {
    el.classList.remove('anchor-hit');
  }, 900);
}
