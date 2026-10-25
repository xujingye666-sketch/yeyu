// ===== Streaming response, SSE, and paint throttling =====
// 光标跟在最后一个字后面：沿最后一个能容纳行内内容的元素往下走，自成一块的节点停在它外面。
var STREAM_CURSOR_INLINE_HOSTS =
  /^(?:P|DIV|SPAN|EM|STRONG|B|I|U|S|DEL|SMALL|MARK|CODE|PRE|BLOCKQUOTE|UL|OL|LI|H1|H2|H3|H4|H5|H6)$/;
// 第一个字节到达前不画空气泡，只在消息列表底部留一行「生成中」。它只服务于会新建一条回复的生成：
// 续写和重生成的气泡本来就在原位，不存在空气泡。
var _streamPendingIndicatorOwner = null,
  // 指示行被整屏重绘拿掉后会原样补回；入场动效每个归属只放一次。
  _streamPendingIndicatorArrived = null;
function streamPendingIndicatorHtml(char) {
  var avatar = displayImageSrc(char, 'avatar_image'),
    avatarHtml = avatar ? '<img src="' + escAttr(avatar) + '" alt="">' : '';
  return (
    '<div class="msg-avatar">' +
    avatarHtml +
    '</div>' +
    immersiveMessageHeadHtml(char, 'assistant', avatarHtml) +
    '<div class="msg-body"><span class="stream-pending-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>'
  );
}
function syncStreamPendingIndicator() {
  var ct = $('chat-messages'),
    existing = ct ? ct.querySelector('#stream-pending-indicator') : null,
    owner = _streamPendingIndicatorOwner,
    char = generationTargetCharacter(owner);
  // 已经有气泡在吐字就不再留指示行，无论这一轮是怎么回到 preparing 的。
  if (!ct || !char || ct.querySelector('.stream-active-bubble') || !chatViewportTargetVisible(owner)) {
    if (existing) existing.remove();
    syncGenerationStatusBar();
    return;
  }
  if (!existing) {
    existing = document.createElement('div');
    existing.id = 'stream-pending-indicator';
    existing.className = 'msg char stream-pending';
    existing.setAttribute('role', 'status');
    existing.setAttribute('aria-label', '正在生成');
    existing.innerHTML = streamPendingIndicatorHtml(char);
  }
  // 指示行是这条回复的占位，和它换成的气泡一样插在结尾哨兵之前，说话人切换的虚线才对两者一致；
  // 追加消息的 appendMessageDom 会把新消息插在它前面，所以它始终紧贴哨兵。
  var end = ct.querySelector(':scope > #chat-end-sentinel');
  if (end) {
    if (existing.nextSibling !== end) ct.insertBefore(existing, end);
  } else if (existing.parentNode !== ct || existing.nextSibling) ct.appendChild(existing);
  if (_streamPendingIndicatorArrived !== owner) {
    _streamPendingIndicatorArrived = owner;
    playChatArrival(existing);
  }
  syncGenerationStatusBar();
}
// 生成态每轮都会切好几次，只有归属真的变了才动列表，免得给无关的状态切换加上一次 DOM 往返。
function noteGenerationStateForStreamIndicator(state) {
  var target = generationTarget,
    owner =
      (state === 'preparing' || state === 'streaming') && target && String(target.mode || 'new') === 'new'
        ? target
        : null;
  if (owner === _streamPendingIndicatorOwner) return;
  _streamPendingIndicatorOwner = owner;
  syncStreamPendingIndicator();
}
// 聊天里已经能看出这一轮在生成：底部有指示行，或者有气泡正在吐字。
function chatShowsGenerationInline() {
  var ct = typeof $ === 'function' ? $('chat-messages') : null;
  return !!(ct && (ct.querySelector('#stream-pending-indicator') || ct.querySelector('.stream-active-bubble')));
}
function clearStreamPendingIndicator() {
  if (!_streamPendingIndicatorOwner) return;
  _streamPendingIndicatorOwner = null;
  syncStreamPendingIndicator();
}
function removeStreamCursor(root) {
  var host = root || document;
  if (!host.querySelectorAll) return;
  host.querySelectorAll('.stream-cursor').forEach(function (node) {
    node.remove();
  });
}
function placeStreamCursor(slot) {
  if (!slot) return;
  var host = slot;
  for (var depth = 0; depth < 32; depth++) {
    var last = host.lastElementChild;
    if (
      !last ||
      !STREAM_CURSOR_INLINE_HOSTS.test(last.tagName) ||
      last.classList.contains('yeyu-card-frontend') ||
      last.classList.contains('risu-display-host') ||
      last.classList.contains('think-block')
    )
      break;
    host = last;
  }
  var cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  host.appendChild(cursor);
}
function completionReasoningSignature(message) {
  var details = Array.isArray(message.reasoning_details) ? message.reasoning_details : [],
    encrypted = details.find(function (detail) {
      return (
        detail && detail.type === 'reasoning.encrypted' && detail.data && !/^(?:tool_|call_)/.test(detail.id || '')
      );
    });
  return (
    message.reasoning_signature || (message.extra && message.extra.signature) || (encrypted && encrypted.data) || ''
  );
}
function completionFromJsonResponse(json) {
  // Relays often answer quota, group or rate-limit failures with HTTP 200 and an error document; its
  // own words are the only diagnosis the user gets, so it fails as a provider error, not an empty reply.
  var error = json && typeof json === 'object' ? json.error : null;
  if (error && !(Array.isArray(json.choices) && json.choices.length)) {
    var status = Math.floor(Number(json.status || error.status) || 0),
      known = status >= 100 && status <= 599,
      detail = providerErrorMessage(json),
      providerError = new Error(
        detail || (known ? providerHttpErrorText(status) : providerErrorText(json) || '供应商返回了错误，没有生成回复')
      );
    providerError.interruptionReason = 'provider_error';
    if (known) providerError.status = status;
    providerError.responseText = JSON.stringify(json);
    throw providerError;
  }
  var choice = (json && json.choices && json.choices[0]) || {},
    message = choice.message || choice.delta || {},
    content = completionContentPart(message.content, false) || '',
    reasoning =
      completionContentPart(message.reasoning_content, true) ||
      completionContentPart(message.reasoning, true) ||
      completionContentPart(message.thinking, true) ||
      '';
  return {
    content: sanitizeText(content),
    reasoning: sanitizeText(reasoning),
    reasoning_signature: completionReasoningSignature(message),
    usage: (json && json.usage) || null,
    finishReason: message.refusal ? 'refusal' : choice.finish_reason || '',
  };
}

function reconcileStreamNode(current, next) {
  if (!current || !next) return current;
  if (
    current.nodeType === 1 &&
    next.nodeType === 1 &&
    current.classList &&
    current.classList.contains('yeyu-card-media-missing') &&
    next.tagName === 'IMG' &&
    String(current.getAttribute('data-yeyu-src') || '') ===
      String(next.getAttribute('data-yeyu-src') || next.getAttribute('src') || '')
  )
    return current;
  if (current.nodeType !== next.nodeType || (current.nodeType === 1 && current.tagName !== next.tagName)) {
    var replacement = next.cloneNode(true);
    current.replaceWith(replacement);
    return replacement;
  }
  // A ready Risu placeholder owns its iframe and interactive state. Reusing an
  // unchanged message must keep that subtree connected; moving or rebuilding
  // iframes unloads srcdoc in Android WebView. A new source for the same display
  // slot keeps the host and its frame too: the display pipeline then patches or
  // remounts that frame, and the old document stays on screen until it does.
  if (
    current.nodeType === 1 &&
    current.classList &&
    current.classList.contains('risu-display-host') &&
    next.classList &&
    next.classList.contains('risu-display-host')
  ) {
    var currentSource = current.querySelector('.risu-display-source'),
      nextSource = next.querySelector('.risu-display-source'),
      currentFallback = current.querySelector('.risu-display-fallback'),
      nextFallback = next.querySelector('.risu-display-fallback'),
      sameIdentity = ['data-risu-message-index', 'data-risu-role', 'data-risu-display-part'].every(function (name) {
        return current.getAttribute(name) === next.getAttribute(name);
      });
    if (sameIdentity && currentSource && nextSource && currentFallback && nextFallback) {
      if (currentSource.textContent !== nextSource.textContent) {
        currentSource.textContent = nextSource.textContent;
        currentFallback.textContent = nextFallback.textContent;
      }
      return current;
    }
    var rebuiltRisu = next.cloneNode(true);
    current.replaceWith(rebuiltRisu);
    return rebuiltRisu;
  }
  // A mounted card frontend owns its own subtree. Same key means the same sandbox stays alive;
  // a different key means the content changed and the whole placeholder is rebuilt.
  if (
    current.nodeType === 1 &&
    current.classList &&
    current.classList.contains('yeyu-card-frontend') &&
    next.classList &&
    next.classList.contains('yeyu-card-frontend')
  ) {
    if (current.getAttribute('data-frontend-key') === next.getAttribute('data-frontend-key')) return current;
    var rebuilt = next.cloneNode(true);
    current.replaceWith(rebuilt);
    return rebuilt;
  }
  if (current.nodeType === 3 || current.nodeType === 8) {
    if (current.data !== next.data) current.data = next.data;
    return current;
  }
  Array.from(current.attributes || []).forEach(function (attribute) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  });
  Array.from(next.attributes || []).forEach(function (attribute) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  });
  reconcileStreamChildren(current, next.childNodes);
  return current;
}
function streamNodesCompatible(current, next) {
  if (!current || !next || current.nodeType !== next.nodeType) return false;
  if (
    current.nodeType === 1 &&
    current.classList &&
    current.classList.contains('yeyu-card-media-missing') &&
    next.tagName === 'IMG' &&
    String(current.getAttribute('data-yeyu-src') || '') ===
      String(next.getAttribute('data-yeyu-src') || next.getAttribute('src') || '')
  )
    return true;
  if (current.nodeType === 3 || current.nodeType === 8) return true;
  if (current.tagName !== next.tagName || current.className !== next.className) return false;
  // Message shells have fixed roles. Their time label and action text may change
  // while the embedded document stays identical; text similarity is not their identity.
  if (current.matches('.msg-body, .msg-bubble, .msg-live-text, .stream-reasoning-slot, .stream-content-slot'))
    return true;
  if (current.classList.contains('yeyu-card-frontend'))
    return current.getAttribute('data-frontend-key') === next.getAttribute('data-frontend-key');
  // A Risu display slot is identified by its message, role and part, not by its growing text.
  if (current.classList.contains('risu-display-host'))
    return ['data-risu-message-index', 'data-risu-role', 'data-risu-display-part'].every(function (name) {
      return current.getAttribute(name) === next.getAttribute(name);
    });
  if (current.tagName === 'IMG')
    return (
      current.getAttribute('src') === next.getAttribute('src') ||
      current.getAttribute('alt') === next.getAttribute('alt')
    );
  if (current.querySelector && next.querySelector) {
    // A display wrapper can gain or lose adjacent text/frontends while still
    // containing the same live document. Its text content is not its identity.
    var currentKeys = new Set(
      Array.from(current.querySelectorAll('.yeyu-card-frontend[data-frontend-key]'), function (node) {
        return node.getAttribute('data-frontend-key');
      })
    );
    if (
      Array.from(next.querySelectorAll('.yeyu-card-frontend[data-frontend-key]')).some(function (node) {
        return currentKeys.has(node.getAttribute('data-frontend-key'));
      })
    )
      return true;
    var failed = current.querySelector('.yeyu-card-media-missing[data-yeyu-src]'),
      image = next.querySelector('img[data-yeyu-src],img[src]');
    if (
      failed &&
      image &&
      String(failed.getAttribute('data-yeyu-src') || '') ===
        String(image.getAttribute('data-yeyu-src') || image.getAttribute('src') || '')
    )
      return true;
  }
  var currentText = String(current.textContent || ''),
    nextText = String(next.textContent || '');
  if (currentText.length >= 4 && nextText.length >= 4)
    return nextText.indexOf(currentText) >= 0 || currentText.indexOf(nextText) >= 0;
  return true;
}
function reconcileStreamChildren(parent, nextChildren) {
  var desired = Array.from(nextChildren || []);
  for (var i = 0; i < desired.length; i++) {
    var existing = parent.childNodes[i];
    // A block that already matches (every closed block of a growing stream) has nothing to reconcile.
    if (existing && existing.isEqualNode(desired[i])) continue;
    var match = streamNodesCompatible(existing, desired[i]) ? existing : null;
    if (!match) {
      for (var j = i + 1; j < parent.childNodes.length; j++) {
        if (streamNodesCompatible(parent.childNodes[j], desired[i])) {
          match = parent.childNodes[j];
          break;
        }
      }
    }
    if (match) {
      if (match !== existing) parent.insertBefore(match, existing || null);
      reconcileStreamNode(match, desired[i]);
      continue;
    }
    if (desired[i].nodeType === 1) {
      var shell = desired[i].cloneNode(false);
      parent.insertBefore(shell, existing || null);
      reconcileStreamChildren(shell, desired[i].childNodes);
    } else parent.insertBefore(desired[i].cloneNode(true), existing || null);
  }
  while (parent.childNodes.length > desired.length) parent.removeChild(parent.lastChild);
  return parent;
}
function reconcileStreamHtml(parent, html) {
  var template = document.createElement('template');
  template.innerHTML = String(html || '');
  return reconcileStreamChildren(parent, template.content.childNodes);
}
function reconcileStreamElement(element, html) {
  var template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  var desired = template.content.firstElementChild;
  if (!element || !desired) return element;
  return reconcileStreamNode(element, desired);
}
function ensureStreamContentSlots(bubble) {
  var live = bubble.querySelector(':scope > .stream-live-text') || bubble.querySelector(':scope > .msg-live-text');
  if (!live) {
    live = document.createElement('div');
    live.className = 'stream-live-text';
    var meta = bubble.querySelector(':scope > .msg-bubble-meta'),
      cursor = bubble.querySelector(':scope > .stream-cursor'),
      reasoning = document.createElement('div'),
      content = document.createElement('div');
    reasoning.className = 'stream-reasoning-slot';
    content.className = 'stream-content-slot';
    Array.from(bubble.childNodes).forEach(function (node) {
      if (node === meta || node === cursor) return;
      if (node.nodeType === 1 && node.classList.contains('think-block')) reasoning.appendChild(node);
      else content.appendChild(node);
    });
    live.appendChild(reasoning);
    live.appendChild(content);
    bubble.insertBefore(live, meta || cursor || null);
  } else live.className = 'stream-live-text';
  var reasoningSlot = live.querySelector(':scope > .stream-reasoning-slot'),
    contentSlot = live.querySelector(':scope > .stream-content-slot');
  if (!reasoningSlot) {
    reasoningSlot = document.createElement('div');
    reasoningSlot.className = 'stream-reasoning-slot';
    live.insertBefore(reasoningSlot, live.firstChild);
  }
  if (!contentSlot) {
    contentSlot = document.createElement('div');
    contentSlot.className = 'stream-content-slot';
    live.appendChild(contentSlot);
  }
  return { live: live, reasoning: reasoningSlot, content: contentSlot };
}
async function streamResponse(resp, target, options) {
  options = options || {};
  async function readResponseText(response) {
    if (response && typeof response.text === 'function') return await response.text();
    if (response && typeof response.json === 'function') return JSON.stringify(await response.json());
    if (response && response.body && typeof response.body.getReader === 'function') {
      var directReader = response.body.getReader(),
        decoder = new TextDecoder('utf-8'),
        parts = [];
      try {
        while (true) {
          var item = await directReader.read();
          if (item.done) break;
          parts.push(decoder.decode(item.value, { stream: true }));
        }
        parts.push(decoder.decode());
        return parts.join('');
      } finally {
        try {
          directReader.releaseLock();
        } catch (_) {}
      }
    }
    throw new Error('API 响应无法读取');
  }
  var thinkingLimitMessage =
    '本次回复的额度在思考阶段就用完了，正文没有生成。请调大“单次回复长度上限”，或关闭思考后重试。';
  // 没有正文时按结束原因说明：额度在思考阶段用完、供应商拦截，其余才是空响应。
  function emptyReplyMessage(finishReason) {
    if (String(finishReason || '').toLowerCase() === 'length') return thinkingLimitMessage;
    var intercepted = providerInterceptedFinishReason(finishReason);
    return intercepted ? '供应商拦截了这次回复（' + intercepted + '），没有生成正文' : 'API 返回空响应';
  }
  // 思考用时随消息一起保存，提交那一刻标题和折叠状态才不会跳变。流式模式按推理流计时；非流式
  // 整段返回，没有推理流可计，就用请求等待时长。
  // 用墙钟计：请求发出的时刻由 `70-api.js` 打在同一把尺子上，测试沙箱里也没有 performance。
  function requestWaitMs() {
    var sentAt = Number(options.requestSentAt);
    return sentAt > 0 ? Math.max(0, Date.now() - sentAt) : 0;
  }
  target = target || generationTarget;
  const char = generationTargetCharacter(target);
  if (!char) throw new Error('生成目标角色已不存在');
  if (target.viewportContextId == null)
    target.viewportContextId = chatViewportTargetVisible(target) ? _chatViewportOwner.contextId : -1;
  const sess = generationSessionForTarget(target);
  if (!sess) throw new Error('生成目标对话已不存在');
  const isContinuation = target.mode === 'continue',
    isRegeneration = target.mode === 'regenerate' || target.mode === 'swipe',
    isImpersonate = target.mode === 'impersonate',
    // Scripts may have moved the reply while the request was out; the stream paints onto it by identity.
    targetMessage = isContinuation || isRegeneration ? resolveGenerationTargetMessage(target, sess) : null,
    continuedBase = isContinuation && targetMessage ? messageUntranslatedContent(targetMessage) : '',
    streamPreviousObjective = isContinuation ? previousStoryObjectiveParsed(char, targetMessage) : null;
  // A continued or regenerated message may already host a mounted in-message sandbox frontend.
  // Passing its owner keeps the placeholder key stable so stream paints never tear the iframe down.
  const streamMarkdownOptions = {
    role: 'assistant',
    preserveImages: true,
    // 只影响显示：未配对的代码围栏和强调标记按临时闭合渲染，草稿与提交的原文一个字都不动。
    closeOpenMarkers: true,
    mediaAssets: (char && char.media_assets) || [],
    mediaOwnerId: char && char.id,
    frontendOwner:
      isContinuation || isRegeneration
        ? cardFrontendOwner(char, target.messageIndex)
        : isImpersonate
          ? null
          : cardFrontendStreamOwner(char),
    // The fence the model is still writing is not markup yet, so it shows a compact placeholder until
    // it closes; the moment it closes the segment becomes a real frame without waiting for the reply.
    frontendStreaming: true,
  };
  // A relay may label a real SSE body as application/json, so only the absence of a readable
  // stream selects the whole-body path; the reader loop below recovers whole-JSON bodies itself.
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    var direct = completionFromJsonResponse(JSON.parse(await readResponseText(resp))),
      directRaw = assistantResponseWithPrefix(options.responsePrefix, direct.content),
      directVisible = cleanDisplayText(directRaw, 'assistant'),
      directReasoning = joinReasoningText(direct.reasoning, splitAssistantResponseText(direct.content).reasoning);
    if (isGenerationCancelled()) throw new Error('已取消');
    if (!directRaw.trim()) throw new Error(emptyReplyMessage(direct.finishReason));
    var directUsage = direct.usage ? mergeUsageTotals(null, direct.usage) : null,
      directReasoningMs = directReasoning ? requestWaitMs() : 0;
    if (options.deferCommit)
      return {
        content: directRaw,
        display: directVisible,
        reasoning: directReasoning,
        reasoningMs: directReasoningMs,
        usage: directUsage,
        finishReason: direct.finishReason,
        streamed: false,
      };
    return await commitGeneratedResponse(target, directRaw, {
      continuedBase: continuedBase,
      reasoning: directReasoning,
      reasoningMs: directReasoningMs,
      usage: directUsage,
      finishReason: direct.finishReason,
      streamed: false,
      viewportState: options.viewportState,
    });
  }
  const reader = resp.body.getReader(),
    dec = new TextDecoder('utf-8');
  let full = '',
    reasoningFull = '',
    buf = '',
    rawResponse = '',
    finalUsage = null,
    finishReason = '',
    streamRefused = false,
    streamEnded = false,
    sawSSEEvents = false,
    readerReleased = false;
  let activeDraft = null,
    streamDraftIdentity = streamDraftTargetIdentity(target, sess);
  // The preview is the display phase, so it takes the display depth of the row it rewrites.
  var streamReplyDepth =
      (isContinuation || isRegeneration) && Number.isInteger(target.messageIndex)
        ? regexScriptMessageDepths(sess.msgs)[target.messageIndex]
        : 0,
    spO = { preservePlaceholders: true, preserveImages: true, streamPreview: true, depth: streamReplyDepth },
    streamDisplayState = {
      active: true,
      inputKey: '',
      inputRevision: 0,
      paintedContent: false,
      slots: Object.create(null),
      sources: Object.create(null),
      used: Object.create(null),
      mediaRevisions: Object.create(null),
    };
  const paintEpoch = ++_streamPaintEpoch,
    tokenRelay = cardFrontendStreamTokenRelay(100);
  let paintPending = false,
    lastPaint = 0,
    paintFrame = 0,
    paintTimer = 0,
    streamPaintDone = false,
    paintCost = 0;
  let lastLiveText = '',
    streamFrontendSeen = false,
    firstContentHandled = false,
    reasoningStartedAt = 0,
    reasoningElapsedMs = 0,
    inlineReasoning = false,
    reasoningTicker = 0,
    streamThinkOpen = false,
    statusBarHandedOver = false,
    streamRecoveryAttempted = false,
    streamMediaHydrationRevision = 0,
    hydratedContent = null;
  // The raw prefix is scanned as it stands. Sending it through the display transform would queue one
  // more speculative transform per call for a result this path throws away, and the assets a display
  // regex introduces are already hydrated from the accepted display text below.
  function queueStreamMediaHydration() {
    var revision = ++streamMediaHydrationRevision;
    Promise.resolve(
      hydrateReferencedCardAssets(char, [
        { text: full, role: 'assistant', streamPreview: true, displayTextReady: true },
      ])
    )
      .then(function (changed) {
        if (
          changed &&
          revision === streamMediaHydrationRevision &&
          paintEpoch === _streamPaintEpoch &&
          !streamPaintDone &&
          chatViewportTargetVisible(target)
        ) {
          lastLiveText = '';
          paintStream(false);
        }
      })
      .catch(function (error) {
        console.warn('流式素材读取失败', error);
      });
  }
  function queueAcceptedDisplayMediaHydration(slot, revision, text) {
    slot = String(slot || 'body');
    if (revision < 1 || streamDisplayState.mediaRevisions[slot] === revision) return;
    streamDisplayState.mediaRevisions[slot] = revision;
    Promise.resolve(
      hydrateReferencedCardAssets(char, [
        { text: String(text == null ? '' : text), role: 'assistant', streamPreview: true, displayTextReady: true },
      ])
    )
      .then(function (changed) {
        var current = streamDisplayState.slots[slot];
        if (
          changed &&
          current &&
          current.revision === revision &&
          paintEpoch === _streamPaintEpoch &&
          !streamPaintDone &&
          chatViewportTargetVisible(target)
        ) {
          lastLiveText = '';
          paintStream(false);
        }
      })
      .catch(function (error) {
        console.warn('流式显示素材读取失败', error);
      });
  }
  // 蹦字上限。两次重绘之间至少隔这么久，渠道再细也只在到点时把攒下的字一次画完；自适应间隔比它
  // 长时以自适应为准，所以这里只是下限。
  const minPaintIntervalMs = 120;
  function streamPaintInterval() {
    return Math.max(minPaintIntervalMs, Math.min(240, Math.max(16, Math.round(paintCost * 3))));
  }
  // 「思考」块在推理流开始时就出现，正文到达的那一刻秒数定格，标题从「思考中」换成「已思考」。
  function liveReasoningState() {
    if (!reasoningStartedAt) return null;
    return {
      seconds: Math.round((reasoningElapsedMs || performance.now() - reasoningStartedAt) / 1000),
      thinking: !reasoningElapsedMs,
      open: streamThinkOpen,
    };
  }
  function stopReasoningTicker() {
    if (reasoningTicker && typeof clearInterval === 'function') clearInterval(reasoningTicker);
    reasoningTicker = 0;
  }
  function startReasoningTicker() {
    if (reasoningTicker || !reasoningStartedAt || reasoningElapsedMs || typeof setInterval !== 'function') return;
    reasoningTicker = setInterval(function () {
      if (paintEpoch !== _streamPaintEpoch || streamPaintDone || reasoningElapsedMs) {
        stopReasoningTicker();
        return;
      }
      var timer = document.querySelector(
        '.stream-active-bubble .stream-reasoning-slot > details.think-block > summary .think-timer'
      );
      if (timer) timer.textContent = reasoningTimerText(liveReasoningState());
    }, 1000);
  }
  function noteReasoningDelta() {
    if (!reasoningStartedAt) reasoningStartedAt = performance.now();
    startReasoningTicker();
  }
  // 模型把思考写在正文里、靠思考标签模板拆出来的回复没有推理增量可计时：开始标记一到就算开始思考，
  // 结束标记之后正文首次出现就定格，和推理流路径用同一把尺子。
  function inlineReasoningPhase() {
    var markers = reasoningDisplayMarkers(),
      start = markers ? full.indexOf(markers.prefix) : -1;
    if (start < 0) return 'none';
    var end = full.indexOf(markers.suffix, start + markers.prefix.length);
    if (end < 0) return 'thinking';
    return (full.slice(0, start) + full.slice(end + markers.suffix.length)).trim() ? 'answered' : 'thinking';
  }
  function noteContentDelta() {
    if (reasoningElapsedMs || isImpersonate) return;
    if (!reasoningStartedAt) {
      if (inlineReasoningPhase() === 'none') return;
      inlineReasoning = true;
      noteReasoningDelta();
    }
    if (inlineReasoning && inlineReasoningPhase() !== 'answered') return;
    reasoningElapsedMs = Math.max(1, performance.now() - reasoningStartedAt);
    stopReasoningTicker();
  }
  // 没有正文、也没有可显示的思考块时，这一轮什么都画不出来，底部的「生成中」指示继续留着。
  function streamHasVisibleOutput() {
    return !!String(full || '').trim() || !!(D.settings.showThinking && String(reasoningFull || '').trim());
  }
  function notePaintCost(startedAt) {
    var spent = performance.now() - startedAt;
    paintCost = paintCost ? paintCost * 0.6 + spent * 0.4 : spent;
  }
  function acceptStreamDisplay(result) {
    if (!result || !streamDisplayState.active || paintEpoch !== _streamPaintEpoch || streamPaintDone) return;
    var slot = String(result.slot || 'body'),
      revision = Number(result.revision) || 0,
      current = streamDisplayState.slots[slot];
    if (revision < 1 || revision > streamDisplayState.inputRevision || (current && revision <= current.revision))
      return;
    streamDisplayState.slots[slot] = { revision: revision, text: String(result.text == null ? '' : result.text) };
    queueAcceptedDisplayMediaHydration(slot, revision, result.text);
    if (result.async) {
      lastLiveText = '';
      paintStream(false);
    }
  }
  function streamDisplayOptions(slot, revision) {
    return Object.assign({}, spO, {
      streamDisplaySlot: slot,
      streamDisplayRevision: revision,
      onStreamDisplayComplete: acceptStreamDisplay,
      streamDisplaySnapshot: function (request) {
        var current = streamDisplayState.slots[String((request && request.slot) || slot)];
        if (!current) return null;
        streamDisplayState.used[String((request && request.slot) || slot)] = current.revision;
        return { ready: true, revision: current.revision, text: current.text };
      },
    });
  }
  // A Risu reply streams through the same display chain and the same card frames as the committed
  // reply: its display parts become frame placeholders at the index the reply occupies (or will
  // occupy), so the commit finds the frame it would mount already in place.
  const risuStream = isRisuCharacter(char);
  function risuStreamIndex() {
    return isContinuation || isRegeneration ? sess.msgs.indexOf(targetMessage) : sess.msgs.length;
  }
  function streamStructuredHtml(value, message, slot, revision) {
    var displayOptions = streamDisplayOptions(slot, revision),
      paint = function () {
        return assistantStructuredDisplayHtml(
          value,
          char,
          message,
          displayOptions,
          streamMarkdownOptions,
          streamPreviousObjective,
          targetMessage ? sess.msgs.indexOf(targetMessage) : target.messageIndex
        );
      };
    if (!risuStream) return paint();
    var partIndex = 0,
      index = risuStreamIndex();
    displayOptions.renderBody = function (text) {
      return risuNeedsIsolatedDisplay(text)
        ? risuDisplayPlaceholderHtml(text, index, 'assistant', partIndex++)
        : md(text, streamMarkdownOptions);
    };
    return risuWithStreamDisplay(
      { char: char, session: sess, message: message, owner: streamDisplayState, options: displayOptions },
      paint
    );
  }
  function syncRisuStreamFrames(root, text) {
    if (!risuStream) return;
    var messages =
      isContinuation || isRegeneration
        ? sess.msgs
        : sess.msgs.concat([{ role: 'assistant', content: text, time: Date.now() }]);
    Promise.resolve(syncRisuStreamDisplays(char, sess, root, messages)).catch(function (error) {
      console.warn('Risu 流式演出挂载失败', error);
    });
  }
  function cancelPendingPaint() {
    if (paintTimer) clearTimeout(paintTimer);
    if (paintFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(paintFrame);
    paintTimer = 0;
    paintFrame = 0;
    paintPending = false;
  }
  function checkpointReceivedText(force) {
    if (isImpersonate || !full) return;
    var checkpointed = checkpointStreamDraft(target, sess, assistantResponseWithPrefix(options.responsePrefix, full), {
      draft: activeDraft,
      state: 'streaming',
      force: force === true,
      identity: streamDraftIdentity,
    });
    if (checkpointed) activeDraft = checkpointed;
  }
  function paintStream(force) {
    if (streamPaintDone && !force) return;
    const now = performance.now();
    if (!force && paintPending) return;
    const run = function (finalPaint) {
      paintTimer = 0;
      paintFrame = 0;
      paintPending = false;
      if (paintEpoch !== _streamPaintEpoch || (streamPaintDone && !finalPaint)) return;
      lastPaint = performance.now();
      var paintStartedAt = lastPaint,
        streamed = splitAssistantResponseText(full),
        rawDraftText = assistantResponseWithPrefix(options.responsePrefix, full),
        visibleDraftText = cleanDisplayText(rawDraftText, 'assistant');
      if (full.length) firstContentHandled = true;
      if (!finalPaint && document.visibilityState === 'hidden') return;
      if (!finalPaint && !isContinuation && !isRegeneration && !streamHasVisibleOutput()) return;
      clearStreamPendingIndicator();
      var el = ensureStreamingBubble();
      if (!el) return;
      // 气泡就位后状态条让位给它；续写和重生成没有指示行，只能在这里通知一次。
      if (!statusBarHandedOver) {
        statusBarHandedOver = true;
        syncGenerationStatusBar();
      }
      // 用户手动折叠或展开思考块的选择由 DOM 持有，重绘按它回写，标题换词不会把块重新弹开。
      var openedThink = el.querySelector('.stream-reasoning-slot > details.think-block');
      if (openedThink) streamThinkOpen = openedThink.open === true;
      removeStreamCursor(el);
      var draft = visibleDraftText,
        combined =
          isContinuation &&
          typeof StoryDirection === 'object' &&
          StoryDirection &&
          typeof StoryDirection.mergeContinuation === 'function'
            ? StoryDirection.mergeContinuation(continuedBase, draft, char)
            : isContinuation
              ? joinContinuationText(continuedBase, draft)
              : draft,
        liveReasoning = joinReasoningText(
          isContinuation ? String((targetMessage && targetMessage.reasoning) || '') : '',
          joinReasoningText(reasoningFull, streamed.reasoning)
        ),
        previewMessage = targetMessage,
        paintKey = liveReasoning + '\u0000' + combined,
        slots = null,
        ensureSlots = function () {
          if (!slots) slots = ensureStreamContentSlots(el);
          return slots;
        };
      if (paintKey !== streamDisplayState.inputKey) {
        streamDisplayState.inputKey = paintKey;
        streamDisplayState.inputRevision++;
      }
      var displayRevision = streamDisplayState.inputRevision;
      if (paintKey !== lastLiveText) {
        // Media hydration follows repaints rather than fragments: the prefix this repaint is about to
        // show is the only one whose assets are worth measuring, and a per-fragment call rescans the
        // same growing text dozens of times a second for the same answer.
        if (full !== hydratedContent) {
          hydratedContent = full;
          queueStreamMediaHydration();
        }
        streamDisplayState.used = Object.create(null);
        var structured;
        if (
          isContinuation &&
          typeof StoryDirection === 'object' &&
          StoryDirection &&
          typeof StoryDirection.extractBlocks === 'function'
        ) {
          var baseParts = StoryDirection.extractBlocks(continuedBase, char),
            draftParts = StoryDirection.extractBlocks(draft, char),
            bodySource = joinContinuationText(baseParts.body, draftParts.body),
            objectiveCurrent = draftParts.objective || baseParts.objective;
          if (objectiveCurrent) streamDisplayState.sources.objective = objectiveCurrent;
          var objectiveSource = objectiveCurrent || streamDisplayState.sources.objective;
          structured = streamStructuredHtml(bodySource, previewMessage, 'body', displayRevision);
          if (objectiveSource)
            structured += '<br><br>' + streamStructuredHtml(objectiveSource, null, 'objective', displayRevision);
        } else structured = streamStructuredHtml(combined, previewMessage, 'body', displayRevision);
        var used = Object.keys(streamDisplayState.used).map(function (name) {
            return streamDisplayState.used[name];
          }),
          preserveCommitted = (isContinuation || isRegeneration) && !streamDisplayState.paintedContent && !used.length;
        if (!preserveCommitted) {
          streamDisplayState.paintedContent = true;
          var paintSlots = ensureSlots();
          reconcileStreamHtml(paintSlots.reasoning, reasoningBlockHtml(liveReasoning, null, liveReasoningState()));
          reconcileStreamHtml(paintSlots.content, structured);
          syncRisuStreamFrames(paintSlots.content, combined);
          // A closed fence became a placeholder in this paint; mounting it here is what lets the
          // interface appear while the rest of the reply is still arriving. Only the slots: the
          // script library catches up with the chat when the reply commits.
          if (streamFrontendSeen || structured.indexOf('yeyu-card-frontend') >= 0) {
            streamFrontendSeen = true;
            syncCardFrontendSlots(char);
          }
          paintSlots.content.setAttribute('data-stream-input-revision', String(displayRevision));
          paintSlots.content.setAttribute(
            'data-stream-display-revision',
            String(used.length ? Math.min.apply(Math, used) : 0)
          );
          paintSlots.content.setAttribute(
            'data-stream-display-status',
            used.length &&
              used.every(function (revision) {
                return revision === displayRevision;
              })
              ? 'current'
              : used.length
                ? 'snapshot'
                : 'pending'
          );
        }
        lastLiveText = paintKey;
        settleViewportAfterMedia(slots ? slots.live : el, options.viewportState);
      }
      // 光标只在正文开始吐字后出现；思考阶段和等待阶段气泡里没有它。
      if (!finalPaint && streamDisplayState.paintedContent && combined.trim()) placeStreamCursor(ensureSlots().content);
      settleViewport(options.viewportState);
      notePaintCost(paintStartedAt);
    };
    // 只有整场还没画过第一笔时才立刻绘制，之后一律等最短间隔到点，正文的第一个字也不例外。
    var immediate = !firstContentHandled && full.length > 0 && !lastPaint,
      interval = streamPaintInterval(),
      remaining = Math.max(0, interval - (now - lastPaint));
    if (force) {
      streamPaintDone = true;
      stopReasoningTicker();
      cancelPendingPaint();
      run(true);
      return;
    }
    if (immediate) {
      cancelPendingPaint();
      run(false);
      return;
    }
    paintPending = true;
    var schedule = function () {
      paintTimer = 0;
      if (document.visibilityState === 'hidden') {
        run(false);
        return;
      }
      paintFrame = requestAnimationFrame(function () {
        run(false);
      });
    };
    if (remaining <= 0) schedule();
    else paintTimer = setTimeout(schedule, remaining);
  }

  _activeStreamTarget = {
    charId: target.charId,
    sessionId: target.sessionId,
    viewportContextId: target.viewportContextId,
  };
  _activeStreamRepaint = function () {
    if (paintEpoch !== _streamPaintEpoch || streamPaintDone || !chatViewportTargetVisible(_activeStreamTarget))
      return false;
    lastLiveText = '';
    paintStream(false);
    return true;
  };
  const visible =
      D.currentCharId === target.charId &&
      getActiveSession(target.charId) &&
      getActiveSession(target.charId).id === target.sessionId,
    ct = visible ? $('chat-messages') : null;
  options.viewportState = ensureViewportState(target, ct, options.viewportState);
  const bubble = document.createElement('div');
  bubble.className = 'msg char';
  bubble.id = 'stream-msg';
  const streamAvatar = displayImageSrc(char, 'avatar_image');
  const avatarHtml = streamAvatar ? `<img src="${escAttr(streamAvatar)}" alt="">` : '';
  bubble.innerHTML = `<div class="msg-avatar">${avatarHtml}</div>${immersiveMessageHeadHtml(char, 'assistant', avatarHtml)}<div class="msg-body"><div class="msg-bubble stream-active-bubble"></div></div>`;
  // 气泡等到第一次真的有东西可画时才进列表，等待期由底部的「生成中」指示占位。
  var bubbleArrived = false;

  function ensureStreamingBubble() {
    if (!chatViewportTargetVisible(target) || ct !== $('chat-messages')) return null;
    var row = null;
    if (isContinuation || isRegeneration) {
      var targetRow = '[data-msg-seq="' + Number(targetMessage.seq) + '"]';
      row = document.querySelector(targetRow);
      if (!row && visible && !streamRecoveryAttempted) {
        streamRecoveryAttempted = true;
        renderChat();
        row = document.querySelector(targetRow);
      }
    } else {
      row = document.getElementById('stream-msg');
      if (!row && ct && visible) {
        var end = $('chat-end-sentinel');
        if (end && end.parentNode === ct) ct.insertBefore(bubble, end);
        else ct.appendChild(bubble);
        row = bubble;
        if (!bubbleArrived) playChatArrival(bubble);
        bubbleArrived = true;
      }
    }
    var activeBubble = row && row.querySelector('.msg-bubble');
    if (activeBubble) activeBubble.classList.add('stream-active-bubble');
    return activeBubble;
  }

  function consumeSSEEvents(events) {
    events = events || [];
    if (events.length) sawSSEEvents = true;
    for (var eventIndex = 0; eventIndex < events.length; eventIndex++) {
      var event = events[eventIndex];
      if (event.done) {
        streamEnded = true;
        break;
      }
      if (!event.data) continue;
      var j = event.data;
      if (j.error) {
        var providerBody = '';
        try {
          providerBody = JSON.stringify(j.error);
        } catch (_) {
          providerBody = String(j.error || '');
        }
        var providerStatus = Math.floor(Number(j.status || (j.error && j.error.status)) || 0),
          providerText = providerErrorText(j),
          providerMessage =
            providerStatus >= 100 && providerStatus <= 599
              ? providerHttpErrorText(providerStatus, providerText)
              : providerText || '供应商在回复途中返回了错误',
          providerError = new Error(providerMessage);
        providerError.interruptionReason = j.interruptionReason || 'provider_error';
        if (providerStatus >= 100 && providerStatus <= 599) providerError.status = providerStatus;
        providerError.responseText = providerBody;
        throw providerError;
      }
      if (j.usage) finalUsage = j.usage;
      var choice = j.choices?.[0] || {},
        delta = choice.delta || {};
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (delta.refusal) streamRefused = true;
      if (streamRefused) finishReason = 'refusal';
      var reasoning =
        completionContentPart(delta.reasoning_content, true) ||
        completionContentPart(delta.reasoning, true) ||
        completionContentPart(delta.thinking, true) ||
        '';
      var cont = completionContentPart(delta.content, false) || '';
      if (reasoning) {
        reasoningFull += sanitizeText(reasoning);
        if (!isImpersonate) noteReasoningDelta();
      }
      if (cont) {
        full += sanitizeText(cont);
        checkpointReceivedText(false);
        noteContentDelta();
        if (tokenRelay) tokenRelay.push(full);
      }
      if ((reasoning || cont) && !isImpersonate) paintStream(false);
    }
  }
  async function releaseReader() {
    if (readerReleased) return;
    readerReleased = true;
    if (typeof reader.cancel === 'function') {
      try {
        await reader.cancel();
      } catch (_) {}
    }
  }
  // A read whose bytes are already buffered resolves on the microtask queue, so a provider that keeps
  // the socket full lets this loop run for the whole reply without the event loop ever coming back —
  // no timer, no animation frame, so nothing paintStream scheduled ever runs. The thread goes back
  // whenever the next repaint is due by paintStream's own adaptive interval, which is the earliest
  // moment a yield can buy anything and keeps the cost at one task per repaint.
  // A hidden page has no repaint to yield to (paintStream only checkpoints there, synchronously), and
  // generation deliberately keeps running in the background, where Chromium aligns timers to one per
  // second or sparser: waiting on one would cap the read rate at a fraction of the provider's.
  let lastReadYieldAt = performance.now();
  async function yieldBetweenReads() {
    if (document.visibilityState === 'hidden') return;
    if (performance.now() - lastReadYieldAt < streamPaintInterval()) return;
    await new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
    lastReadYieldAt = performance.now();
  }
  // The request has no deadline: a reply that stops arriving (a half-open connection, or a model still
  // thinking without sending anything) is only reported on the status bar, and the user decides to stop.
  var lastDataAt = Date.now(),
    stallWatch =
      typeof setInterval === 'function' &&
      ['new', 'regenerate', 'swipe', 'continue', 'impersonate'].includes(target.mode)
        ? setInterval(function () {
            noteGenerationStall(Date.now() - lastDataAt);
          }, 1000)
        : 0;
  function stopStallWatch() {
    if (!stallWatch) return;
    clearInterval(stallWatch);
    stallWatch = 0;
    noteGenerationStall(0);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      lastDataAt = Date.now();
      if (stallWatch) noteGenerationStall(0);
      if (done) break;
      var decoded = dec.decode(value, { stream: true });
      rawResponse += decoded;
      buf += decoded;
      var parsed = window.YeyuPure.parseSSEBuffer(buf);
      buf = parsed.rest;
      consumeSSEEvents(parsed.events);
      if (!streamEnded) await yieldBetweenReads();
      // A stop whose abort never reached this request must still end the read here, not when the
      // provider has finished sending the whole reply.
      if (!streamEnded && isGenerationCancelled()) {
        var readAbort = new Error('流式响应已取消');
        readAbort.name = 'AbortError';
        throw readAbort;
      }
      if (streamEnded) {
        await releaseReader();
        if (isGenerationCancelled()) {
          var doneAbort = new Error('流式响应已取消');
          doneAbort.name = 'AbortError';
          throw doneAbort;
        }
        break;
      }
    }
    var decodedTail = dec.decode();
    buf += decodedTail;
    rawResponse += decodedTail;
    if (!streamEnded && buf.trim()) {
      var tailParsed = window.YeyuPure.parseSSEBuffer(buf + '\n\n');
      consumeSSEEvents(tailParsed.events);
    }
    stopStallWatch();
    if (!full.trim() && rawResponse.trim()) {
      var wholeJson = null;
      try {
        wholeJson = JSON.parse(rawResponse.trim());
      } catch (_) {}
      if (wholeJson) {
        var compatible = completionFromJsonResponse(wholeJson);
        full = compatible.content;
        reasoningFull = joinReasoningText(reasoningFull, compatible.reasoning);
        finalUsage = compatible.usage || finalUsage;
        finishReason = compatible.finishReason || finishReason;
      }
    }
  } catch (e) {
    stopStallWatch();
    if (tokenRelay) tokenRelay.close();
    streamPaintDone = true;
    stopReasoningTicker();
    clearStreamPendingIndicator();
    cancelPendingPaint();
    dropStreamRegexPreviews();
    if (risuStream) dropRisuStreamPreviews(streamDisplayState);
    await releaseReader();
    clearStreamCursors();
    if ((isContinuation || isRegeneration) && visible) restoreTargetBubble(target);
    var userCancelled = isGenerationCancelled(e),
      interruption = userCancelled ? null : generationInterruption(e, 'error'),
      draftReason = userCancelled ? 'user_cancelled' : (interruption && interruption.kind) || 'network_interrupted';
    checkpointReceivedText(true);
    if (activeDraft) await flushActiveStreamDraft(draftReason);
    if (userCancelled) throw new Error('已取消');
    if (e && e.interruptionReason === 'provider_error') {
      e.noRetry = !!(full || reasoningFull);
      throw e;
    }
    var streamError = new Error(
      (navigator.onLine === false ? '流式响应期间网络已断开' : '流式响应期间网络传输中断') +
        (full || reasoningFull ? '（已收到部分内容，为避免重复回复不会自动重试）' : '')
    );
    streamError.noRetry = !!(full || reasoningFull);
    streamError.interruptionReason =
      (interruption && interruption.kind) || (navigator.onLine === false ? 'network_offline' : 'network_interrupted');
    if (e && e.status) streamError.status = e.status;
    if (e && e.responseText) streamError.responseText = e.responseText;
    throw streamError;
  }

  if (isGenerationCancelled()) {
    if (tokenRelay) tokenRelay.close();
    throw new Error('已取消');
  }
  var streamTokensDelivered = tokenRelay ? tokenRelay.finish() : null;
  checkpointReceivedText(true);
  if (!isImpersonate) paintStream(true);
  // No further prefix is coming, so anything still waiting for the preview lane would only delay the
  // reply's own final display transform, which the commit is about to ask for on the same worker.
  dropStreamRegexPreviews();
  if (risuStream) dropRisuStreamPreviews(streamDisplayState);
  var separated = splitAssistantResponseText(full),
    content = assistantResponseWithPrefix(options.responsePrefix, full),
    reasoning = joinReasoningText(reasoningFull, separated.reasoning),
    display = cleanDisplayText(content, 'assistant');
  if (!content.trim()) throw new Error(emptyReplyMessage(finishReason));
  if (activeDraft) await flushActiveStreamDraft('streaming');
  var usageTotal = finalUsage ? mergeUsageTotals(null, finalUsage) : null,
    // 正文到达时定格的用时；正文一直没到就算到流结束，整段返回的则是请求等待时长。
    thinkingMs = reasoning
      ? reasoningElapsedMs || (reasoningStartedAt ? performance.now() - reasoningStartedAt : requestWaitMs())
      : 0,
    result = {
      content: content,
      display: display,
      reasoning: reasoning,
      reasoningMs: thinkingMs,
      reasoningCollapsed: !streamThinkOpen,
      usage: usageTotal,
      finishReason: finishReason,
      streamed: sawSSEEvents,
      streamDraftId: (activeDraft && activeDraft.draftId) || '',
      streamTokensDelivered: streamTokensDelivered,
    };
  if (options.deferCommit) return result;
  return await commitGeneratedResponse(target, content, {
    continuedBase: continuedBase,
    reasoning: reasoning,
    reasoningMs: thinkingMs,
    reasoningCollapsed: result.reasoningCollapsed,
    usage: usageTotal,
    finishReason: finishReason,
    streamed: result.streamed,
    viewportState: options.viewportState,
    streamDraftId: result.streamDraftId,
    streamTokensDelivered: streamTokensDelivered,
  });
}
