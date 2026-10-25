// ===== Image generation =====
// 生图的唯一所有者：图片来源解析、出图传输、写出图提示词、错误归一化和三类入口共用的执行函数。
// 图片来源的形状与规范化见 05-runtime.js 的 normalizeImageSourceRecord（DATA_MODEL §2.3）。

// 审核拒绝的错误码：Grok 订阅为 imagine:content-moderated，其余是 OpenAI 兼容接口的常见写法。
const IMAGE_MODERATION_CODES = ['imagine:content-moderated', 'content_policy_violation', 'moderation_blocked'];
// ST raw_last 沿固定宿主语义截取末尾；辅助取材的预算由正常聊天编排统一决定。
const IMAGE_PROMPT_MESSAGE_MAX_CHARS = 6000;

function imageAbortError() {
  return new DOMException('已取消', 'AbortError');
}
// 查询直接读设置：D.settings 已在加载与保存设置时经 ensureProviderSettings 规范化。
function imageSourceById(id, settings) {
  settings = settings || (D && D.settings) || {};
  return (
    (settings.imageSources || []).find(function (row) {
      return row.id === id;
    }) || null
  );
}
function activeImageSource(settings) {
  settings = settings || (D && D.settings) || {};
  return imageSourceById(settings.activeImageSourceId, settings);
}
// 接受来源 id、来源记录（如设置页草稿里的一行）或空值（当前活动来源）。
function resolveImageSource(source) {
  if (source && typeof source === 'object') return normalizeImageSourceRecord(source, 0);
  var resolved = source ? imageSourceById(String(source)) : activeImageSource();
  if (!resolved) throw new Error(source ? '找不到所选的图片来源，请在设置里重新选择。' : '请先在设置里添加图片来源。');
  return resolved;
}
function imageModerationError(source, code) {
  var error = new Error(
    '图片被「' +
      source.name +
      '」的内容审核拒绝，没有生成图片，这次请求可能仍会计费。' +
      (source.promptMode === 'desensitize'
        ? '可以调整去敏感化提示词，或换一个图片来源。'
        : '可以把该来源的提示词处理方式改为“去敏感化”，或换一个图片来源。')
  );
  error.moderated = true;
  error.code = code;
  return error;
}
function imageErrorCode(json) {
  if (!json || typeof json !== 'object') return '';
  var nested = json.error && typeof json.error === 'object' ? json.error : {};
  return String(json.code || nested.code || nested.type || '');
}
// 非 2xx 响应：审核拒绝给专门提示，其他错误保留供应商原文；action 为失败说明的开头（出图或读取模型）。
async function imageGenerationFailure(source, response, action) {
  if (source.type === 'grok-subscription') {
    var grokError = await grokSubscriptionFailure(response);
    return IMAGE_MODERATION_CODES.includes(grokError.code) ? imageModerationError(source, grokError.code) : grokError;
  }
  var text = '',
    json = null;
  try {
    text = await response.text();
    json = JSON.parse(text);
  } catch (_) {}
  var code = imageErrorCode(json);
  if (IMAGE_MODERATION_CODES.includes(code)) return imageModerationError(source, code);
  var detail = providerErrorText(text);
  if (source.apiKey) detail = detail.split(source.apiKey).join('[已隐藏]');
  var error = new Error((action || '出图失败') + '（HTTP ' + response.status + '）' + (detail ? '：' + detail : ''));
  error.status = response.status;
  error.code = code;
  return error;
}
// 自定义来源经 fetch 直连；网络失败给出原因，取消原样上抛。
async function imageSourceFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new Error('出图网络请求失败：' + ((error && error.message) || '连接异常'));
  }
}
function imageSourceHeaders(source, json) {
  var headers = json ? { 'Content-Type': 'application/json' } : {};
  if (source.apiKey) headers.Authorization = 'Bearer ' + source.apiKey;
  return headers;
}
function imageModelIds(json, format) {
  var rows = (json && (Array.isArray(json.data) ? json.data : json.models)) || [];
  return Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map(function (row) {
          var id = row && typeof row === 'object' ? row.id || (format === 'gemini' && row.name) : row;
          id = String(id || '').trim();
          return format === 'gemini' ? id.replace(/^models\//, '') : id;
        })
        .filter(Boolean)
    )
  );
}
// 模型检测：Grok 订阅读出图模型列表，自定义来源读 <apiUrl>/models；失败时由设置页允许手填。
async function detectImageSourceModels(source, options) {
  options = options || {};
  source = resolveImageSource(source);
  var response;
  if (source.type === 'grok-subscription')
    response = await fetchGrokSubscription('/image-generation-models', { signal: options.signal });
  else {
    if (!source.apiUrl) throw new Error('请先填写图片来源的接口地址。');
    response = await imageSourceFetch(
      (source.format === 'gemini' ? providerApiBase('gemini', source.apiUrl) : source.apiUrl) + '/models',
      {
        method: 'GET',
        headers:
          source.format === 'gemini'
            ? nativeProviderHeaders({ protocol: 'gemini', apiKey: source.apiKey }, true)
            : imageSourceHeaders(source, false),
        signal: options.signal,
      }
    );
  }
  if (!response.ok) throw await imageGenerationFailure(source, response, '读取模型列表失败');
  return imageModelIds(await response.json(), source.format);
}
function imageBase64Blob(value, mime) {
  var binary = atob(String(value || '').replace(/^data:[^,]*,/, '')),
    bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: String(mime || '') });
}
async function imageResultBlob(item, signal) {
  if (item && typeof item.b64_json === 'string' && item.b64_json) return imageBase64Blob(item.b64_json, item.mime_type);
  if (item && typeof item.url === 'string' && item.url) {
    var response = await imageSourceFetch(item.url, { signal: signal });
    if (!response.ok) throw new Error('下载生成的图片失败（HTTP ' + response.status + '）');
    return response.blob();
  }
  throw new Error('图片来源返回的结果里没有图片数据');
}
const GEMINI_IMAGE_BLOCK_REASONS = [
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'SPII',
  'ESCALATION',
];
async function requestGeminiImage(source, model, prompt, aspectRatio, signal) {
  var config = { responseModalities: ['TEXT', 'IMAGE'] };
  if (aspectRatio) config.imageConfig = { aspectRatio: aspectRatio };
  var url =
      providerApiBase('gemini', source.apiUrl) +
      '/models/' +
      encodeURIComponent(model.replace(/^models\//, '')) +
      ':generateContent',
    response = await imageSourceFetch(url, {
      method: 'POST',
      headers: nativeProviderHeaders({ protocol: 'gemini', apiKey: source.apiKey }),
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: config }),
      signal: signal,
    });
  if (!response.ok) throw await imageGenerationFailure(source, response);
  var json = await response.json(),
    block = String((json && json.promptFeedback && json.promptFeedback.blockReason) || '').toUpperCase(),
    candidates = (json && Array.isArray(json.candidates) && json.candidates) || [];
  if (GEMINI_IMAGE_BLOCK_REASONS.includes(block)) throw imageModerationError(source, block);
  var images = [];
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i],
      finish = String((candidate && candidate.finishReason) || '').toUpperCase();
    if (GEMINI_IMAGE_BLOCK_REASONS.includes(finish)) throw imageModerationError(source, finish);
    var parts = (candidate && candidate.content && candidate.content.parts) || [];
    for (var j = 0; j < parts.length; j++) {
      if (parts[j] && parts[j].thought === true) continue;
      var inline = parts[j] && parts[j].inlineData;
      if (!inline || !inline.data || !/^image\//i.test(String(inline.mimeType || ''))) continue;
      var blob = await validateCardImageBlob(imageBase64Blob(inline.data, inline.mimeType));
      images.push({ blob: blob, mime: blob.type });
    }
  }
  if (!images.length) throw new Error('图片来源没有返回图片。');
  return [images[0]];
}
// 出图：返回 [{blob, mime}]，blob 已按内容校验并带正确的类型。options 可覆盖来源的 n、model、aspectRatio、size。
async function requestImages(source, prompt, options) {
  options = options || {};
  source = resolveImageSource(source);
  prompt = String(prompt || '').trim();
  if (!prompt) throw new Error('出图提示词为空，没有出图。');
  var model = String(options.model || source.model || '').trim(),
    count = Math.floor(Number(options.n || source.n)),
    imageCount = count >= 1 && count <= 4 ? count : 1;
  if (source.format === 'gemini' && source.type === 'openai') {
    if (!source.apiUrl) throw new Error('请先填写图片来源「' + source.name + '」的接口地址。');
    if (!model) throw new Error('请先为图片来源「' + source.name + '」选择模型。');
    var geminiImages = [],
      geminiAspect = String(options.aspectRatio || source.aspectRatio || '').trim();
    for (var requestIndex = 0; requestIndex < imageCount; requestIndex++) {
      if (options.signal && options.signal.aborted) throw imageAbortError();
      var generated = await requestGeminiImage(source, model, prompt, geminiAspect, options.signal);
      geminiImages.push.apply(geminiImages, generated);
    }
    if (options.signal && options.signal.aborted) throw imageAbortError();
    return geminiImages;
  }
  var gptImage = /^(?:gpt-image-|chatgpt-image-latest$)/i.test(model),
    body = { prompt: prompt, n: /^dall-e-3$/i.test(model) ? 1 : imageCount },
    response;
  if (model) body = Object.assign({ model: model }, body);
  if (source.type === 'grok-subscription') {
    if (!model) throw new Error('请先为图片来源「' + source.name + '」选择模型。');
    body.response_format = 'b64_json';
    var aspectRatio = String(options.aspectRatio || source.aspectRatio || '').trim();
    if (aspectRatio) body.aspect_ratio = aspectRatio;
    response = await fetchGrokSubscription('/images/generations', {
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } else {
    if (!source.apiUrl) throw new Error('请先填写图片来源「' + source.name + '」的接口地址。');
    if (!gptImage) body.response_format = 'b64_json';
    var size = String(options.size || source.size || '').trim();
    if (size) body.size = size;
    response = await imageSourceFetch(source.apiUrl + '/images/generations', {
      method: 'POST',
      headers: imageSourceHeaders(source, true),
      body: JSON.stringify(body),
      signal: options.signal,
    });
  }
  if (!response.ok) throw await imageGenerationFailure(source, response);
  var json = await response.json(),
    rows = json && Array.isArray(json.data) ? json.data : [];
  if (!rows.length) throw new Error('图片来源没有返回图片。');
  var images = [];
  for (var i = 0; i < rows.length; i++) {
    var blob = await validateCardImageBlob(await imageResultBlob(rows[i], options.signal));
    images.push({ blob: blob, mime: blob.type });
  }
  return images;
}

// ----- 写出图提示词 -----
function imagePromptUserName(char) {
  var persona = getActivePersona(char && char.id);
  return String((persona && persona.name) || '用户');
}
function imagePromptTail(text, limit) {
  return text.length > limit ? text.slice(text.length - limit) : text;
}
// 消息里读者实际读到的正文：去掉思考、卡片前端、脚本、代码与标记，压成一行。
function imagePromptMessageText(char, message) {
  var risu = isRisuCharacter(char),
    body;
  if (risu) {
    body = risuMessageText(message);
    if (message.role === 'assistant') body = splitAssistantResponseText(body).content;
  } else body = messageDisplayParts(char, message).content;
  var segments = cardFrontendSegments(body);
  for (var at = segments.length - 1; at >= 0; at--)
    body = body.slice(0, segments[at].start) + '\n' + body.slice(segments[at].end);
  return window.YeyuPure.decodeAttrText(window.YeyuPure.readableMessageText(body)).replace(/\s+/g, ' ').trim();
}
function imagePromptContextMessage(message) {
  return !!(
    message &&
    (message.role === 'user' || message.role === 'assistant') &&
    message.hidden !== true &&
    message.reverted !== true &&
    message.streamDraft !== true &&
    message.isStreamDraft !== true &&
    message.kind !== 'stream-draft' &&
    message.kind !== 'branch-return-revert'
  );
}
// 截至目标消息的已生效聊天 Prompt 原样作为对话消息；末尾的任务消息告知任务已转为写出图提示词。
// 任务消息按聊天 Prompt 的同一规则展开宏；/imagine 的主体说明接在任务消息后，仍按主体取材。
async function imagePromptMessages(char, session, message, signal, options) {
  options = options || {};
  var context = await assembleGenerationContext(char, session, message, signal),
    task = assistantPromptText('imageGeneration', 'summary'),
    subject = String((options.input && options.input.subject) || '').trim();
  if (options.mode === 'desensitize') {
    var note = assistantPromptText('imageGeneration', 'desensitize').trim();
    if (note) task += '\n\n' + note;
  }
  if (subject) task += '\n' + subject;
  task = await replaceCharacterMacros(task, char, undefined, characterMacroStateForChar(char));
  return context.concat({ role: 'user', content: task });
}
// 卡片给出提示词时的改写请求：不进入聊天上下文，改写说明与去敏感化注意事项合成 system 任务。
function imageCardRewriteSystem(mode) {
  var system = assistantPromptText('imageGeneration', 'cardRewrite');
  if (mode === 'desensitize') {
    var note = assistantPromptText('imageGeneration', 'desensitize').trim();
    if (note) system += '\n\n' + note;
  }
  return system;
}
// 去掉模型偶尔加上的代码围栏和外层引号。
function cleanImagePrompt(text) {
  var value = String(text || '').trim(),
    fenced = value.match(/^(`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)\r?\n\1\s*$/);
  if (fenced) value = fenced[2].trim();
  var pairs = { '"': '"', "'": "'", '“': '”', '‘': '’', '「': '」' };
  while (value.length >= 2 && pairs[value.charAt(0)] && value.charAt(value.length - 1) === pairs[value.charAt(0)])
    value = value.slice(1, -1).trim();
  return value;
}
// mode 为来源的处理方式。给了 cardPrompt 时：直接总结原样返回，去敏感化先改写；否则把任务消息追加在
// 截至目标消息的已生效 Prompt 后写提示词（input.message 可覆盖目标消息，/imagine 的主体说明随任务消息取材）。
// 请求随 signal 取消；globalStop 为 false 时不登记到输入区的停止键（调用方有自己的停止入口）。
async function writeImagePrompt(options) {
  options = options || {};
  var mode = options.mode === 'desensitize' ? 'desensitize' : 'summary',
    hasCardPrompt = options.cardPrompt !== undefined && options.cardPrompt !== null,
    cardPrompt = hasCardPrompt ? String(options.cardPrompt).trim() : '',
    signal = options.signal;
  if (hasCardPrompt && !cardPrompt) throw new Error('卡片没有给出出图提示词。');
  if (hasCardPrompt && mode === 'summary') return cardPrompt;
  if (signal && signal.aborted) throw imageAbortError();
  var messages = hasCardPrompt
      ? [
          { role: 'system', content: imageCardRewriteSystem(mode) },
          { role: 'user', content: cardPrompt },
        ]
      : await imagePromptMessages(
          options.char,
          options.session,
          (options.input && options.input.message) || options.message,
          signal,
          { mode: mode, input: options.input }
        ),
    controller = new AbortController(),
    abort = function () {
      controller.abort();
    },
    result;
  if (signal && signal.aborted) throw imageAbortError();
  if (signal) signal.addEventListener('abort', abort, { once: true });
  try {
    result = await callDeepSeek(messages, null, {
      route: 'imagePrompt',
      transient: true,
      nonStream: true,
      controller: controller,
      ignoreUserMaxTokens: true,
      globalStop: options.globalStop !== false,
    });
  } catch (error) {
    if (controller.signal.aborted) throw imageAbortError();
    throw new Error('出图提示词生成失败：' + ((error && error.message) || '未知错误'));
  } finally {
    if (signal) signal.removeEventListener('abort', abort);
  }
  if (controller.signal.aborted) throw imageAbortError();
  var finishReason = String((result && result.finishReason) || '').toLowerCase(),
    intercepted = providerInterceptedFinishReason(finishReason);
  if (intercepted)
    throw new Error('出图提示词被供应商拦截（' + intercepted + '），没有出图；可换用其他模型或改用去敏感化。');
  if (finishReason === 'length')
    throw new Error('出图提示词被截断，没有出图；请重试或调大「出图提示词」路由的输出上限。');
  var prompt = cleanImagePrompt(result && result.content);
  if (!prompt) throw new Error('模型没有返回出图提示词，没有出图。');
  return prompt;
}
// 三类入口（手动生图、ST /imagine、Risu 出图）共用：按来源的处理方式写提示词，再出图。
// beforeRequest(prompt) 可在出图前改写提示词（/imagine edit=true 的确认框），返回空值即取消。
// 返回 {source, prompt, images}；prompt 是实际发给出图模型的提示词。
async function runImageGeneration(options) {
  options = options || {};
  var source = resolveImageSource(options.source),
    prompt = await writeImagePrompt({
      mode: source.promptMode,
      char: options.char,
      session: options.session,
      message: options.message,
      input: options.input,
      cardPrompt: options.cardPrompt,
      signal: options.signal,
      globalStop: options.globalStop,
    });
  if (options.beforeRequest) {
    prompt = String((await options.beforeRequest(prompt)) || '').trim();
    if (!prompt) throw imageAbortError();
  }
  var images = await requestImages(source, prompt, {
    n: options.n,
    model: options.model,
    aspectRatio: options.aspectRatio,
    size: options.size,
    signal: options.signal,
  });
  return { source: source, prompt: prompt, images: images };
}

// ----- 夜欲保存的图片：条目、显示地址与 TavernHelper 视图 -----
// 条目 {id, mediaKey, mediaHash, mime, createdAt, width?, height?, ...来源字段}；未落库前另挂 blob，仓储保存成功后
// 摘掉（core/repository-media.js 的会话图片 walker）。消息图片的来源字段是 prompt / sourceId / model，候选归属见
// 81 号 messageSwipeStashImages；Risu inlay 用同一种条目放在 session.risu.inlays。
async function createStoredImage(kind, blob, fields) {
  var id = uid(),
    entry = Object.assign(
      { id: id },
      YeyuRepository.storedImageFields(kind, id, blob),
      { mime: blob.type, createdAt: Date.now() },
      fields || {}
    );
  if (typeof createImageBitmap === 'function') {
    try {
      var bitmap = await createImageBitmap(blob);
      entry.width = bitmap.width;
      entry.height = bitmap.height;
      if (typeof bitmap.close === 'function') bitmap.close();
    } catch (_) {}
  }
  entry.blob = blob;
  return entry;
}
// 显示资产按 mediaKey 共用（分支复制的会话指向同一份），object URL 的创建与回收走 10 号卡片资产的生命周期：
// 由 storedImageDisplayAssets 并入当前资产集合；异步读取只为仍有效的显示创建 URL。
var _storedImageDisplays = new Map();
function storedImageDisplayAsset(entry) {
  var key = String(entry.mediaKey || ''),
    asset = _storedImageDisplays.get(key);
  if (!asset) {
    asset = { id: 'stored-image:' + key, kind: 'stored-image', mediaKey: key, mime: entry.mime };
    _storedImageDisplays.set(key, asset);
  }
  if (entry.blob instanceof Blob && !(asset.blob instanceof Blob)) asset.blob = entry.blob;
  return asset;
}
function storedImageDisplayAssets() {
  _storedImageDisplays.forEach(releaseUnusedStoredImageDisplayAsset);
  return Array.from(_storedImageDisplays.values());
}
function releaseUnusedStoredImageDisplayAsset(asset) {
  if (!asset.objectUrl && !asset.loading && !asset.displayReaders) _storedImageDisplays.delete(asset.mediaKey);
}
// 显示同步或多模态读取在完整消费结束后释放；其他消费者和已挂载的显示仍持有图片。
function releaseStoredImageDisplayReads(assets) {
  if (!assets.size) return;
  assets.forEach(function (asset) {
    asset.displayReaders--;
  });
  syncCardAssetObjectUrlLifecycle(getChar());
  storedImageDisplayAssets();
}
// 当前可用的显示地址；没有内存 Blob 时按需从仓储读取，读到后直接换上页面里对应的 <img>。
function storedImageDisplaySrc(entry, ownerId) {
  if (!entry || !entry.mediaKey) return '';
  var asset = storedImageDisplayAsset(entry);
  if (asset.blob instanceof Blob) return cardAssetDisplaySrc(asset, ownerId);
  if (!asset.loading && !asset.missing) asset.loading = loadStoredImage(asset, ownerId);
  return '';
}
// 等 Blob 读入后再给地址：Risu inlay 在卡片框架里按文本解析，没有可回填的 <img>。
async function storedImageDisplaySrcReady(entry, ownerId, isCurrent, displayAssets) {
  if (!entry || !entry.mediaKey || (isCurrent && !isCurrent())) return '';
  var asset = storedImageDisplayAsset(entry);
  // 同一图片可被多个显示同时等待；失效的等待者不撤销其他显示正在使用的读取。
  if (!displayAssets || !displayAssets.has(asset)) {
    asset.displayReaders = (asset.displayReaders || 0) + 1;
    if (displayAssets) displayAssets.add(asset);
  }
  try {
    var src = storedImageDisplaySrc(entry, ownerId);
    if (src) return src;
    if (asset.loading) await asset.loading;
    if (isCurrent && !isCurrent()) return '';
    return asset.blob instanceof Blob ? cardAssetDisplaySrc(asset, ownerId) : '';
  } finally {
    if (!displayAssets) asset.displayReaders--;
    releaseUnusedStoredImageDisplayAsset(asset);
  }
}
async function loadStoredImage(asset, ownerId) {
  try {
    var blob = await YeyuRepository.loadMediaBlob(asset.mediaKey);
    if (blob) asset.blob = blob;
    else asset.missing = true;
  } catch (error) {
    // 读取异常不记为丢失：这次显示为「已丢失」，下次渲染会再读（只有仓储确实没有才永久标记）。
    console.warn('图片读取失败', error);
  } finally {
    asset.loading = null;
  }
  _storedImageDisplays.set(asset.mediaKey, asset);
  var images = Array.from(document.querySelectorAll('img[data-stored-image]')).filter(function (img) {
      return img.getAttribute('data-stored-image') === asset.mediaKey;
    }),
    char = getChar(),
    src = images.length && asset.blob ? cardAssetDisplaySrc(asset, (char && char.id) || ownerId) : '';
  images.forEach(function (img) {
    if (src) img.src = src;
    else {
      img.alt = '图片已丢失';
      img.classList.add('missing');
    }
  });
  releaseUnusedStoredImageDisplayAsset(asset);
}
// 只读视图：候选的夜欲图片按 ST 媒体项形状投影进 extra.media，带 yeyu_image_id 标记以便写回时剔除。
// url 是该图当前显示用的 object URL；还没读入或已不在对话里显示的图为空串。
function storedImageMediaView(entries) {
  return (entries || []).map(function (entry) {
    var asset = entry && entry.mediaKey ? _storedImageDisplays.get(String(entry.mediaKey)) : null;
    return {
      url: (asset && asset.objectUrl) || '',
      type: 'image',
      title: String((entry && entry.prompt) || ''),
      source: 'generated',
      yeyu_image_id: String((entry && entry.id) || ''),
    };
  });
}

// ----- 消息图片：显示与手动生图 -----
var _messageImageRuns = new Map(),
  _messageImageSlides = new Map(),
  _messageImageCandidateIdentities = new WeakMap();
// 图片请求和删除确认只活在本次页面生命周期；身份不进入消息数据。候选正规化和切换不改变身份。
function messageImageCandidateIdentity(message, swipe) {
  var identities = _messageImageCandidateIdentities.get(message);
  if (!identities) {
    identities = [];
    _messageImageCandidateIdentities.set(message, identities);
  }
  var count = messageSwipeState(message).swipes.length;
  while (identities.length < count) identities.push({});
  return identities[swipe];
}
function invalidateMessageImageCandidate(message, swipe) {
  var identities = _messageImageCandidateIdentities.get(message);
  if (identities) identities[swipe] = {};
}
function removeMessageImageCandidateIdentity(message, swipe) {
  var identities = _messageImageCandidateIdentities.get(message);
  if (identities) identities.splice(swipe, 1);
}
function resetMessageImageCandidateIdentities(message) {
  _messageImageCandidateIdentities.delete(message);
}
function messageImageRunKey(charId, sessionId, seq) {
  return String(charId) + '|' + String(sessionId) + '|' + String(seq);
}
function messageImageSlideKey(session, message) {
  return (
    String(session && session.id) +
    '|' +
    String(message && message.seq) +
    '|' +
    String(Number(message && message.swipeId) || 0)
  );
}
// 宿主消息与 Risu 消息帧共用长按。移动、滚动、多指或离开页面均撤销等待，长按结束不再触发点按。
function bindGeneratedImageHold(doc, resolveTarget, removeTarget) {
  var hold = null,
    consumed = null;
  function cancel() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }
  function imageAt(event) {
    return event.target && event.target.closest && event.target.closest('img[data-generated-image]');
  }
  doc.addEventListener('pointerdown', function (event) {
    var image = imageAt(event);
    if (hold || (!event.isPrimary && event.pointerType === 'touch')) {
      cancel();
      return;
    }
    consumed = null;
    if (!image || event.button !== 0) return;
    var target = resolveTarget(image);
    if (!target) return;
    hold = { image: image, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    hold.timer = setTimeout(function () {
      if (!hold || !image.isConnected) return cancel();
      consumed = image;
      cancel();
      void confirmGeneratedImageDeletion(target, removeTarget);
    }, 550);
  });
  doc.addEventListener('pointermove', function (event) {
    if (hold && event.pointerId === hold.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8)
      cancel();
  });
  ['pointerup', 'pointercancel', 'scroll', 'dragstart'].forEach(function (name) {
    doc.addEventListener(name, cancel, true);
  });
  doc.defaultView.addEventListener('blur', cancel);
  doc.defaultView.addEventListener('pagehide', cancel);
  doc.addEventListener(
    'click',
    function (event) {
      if (consumed && imageAt(event) === consumed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        consumed = null;
      }
    },
    true
  );
  doc.addEventListener('contextmenu', function (event) {
    var image = imageAt(event);
    if (!image) return;
    event.preventDefault();
    cancel();
    if (consumed === image) return;
    var target = resolveTarget(image);
    if (target) void confirmGeneratedImageDeletion(target, removeTarget);
  });
}
async function confirmGeneratedImageDeletion(target, removeTarget) {
  if (!(await appConfirm('删除这张生成的图片？消息文字和其他图片会保留。', '删除图片', '删除', { danger: true })))
    return false;
  return removeTarget(target);
}
function messageImageDeleteTarget(image) {
  var char = getChar(),
    session = char && getActiveSession(char.id),
    slot = image.closest('.message-image-slot'),
    message =
      session &&
      slot &&
      session.msgs.find(function (row) {
        return Number(row.seq) === Number(slot.getAttribute('data-message-image-seq'));
      });
  if (!message) return null;
  var swipe = messageSwipeState(message).active;
  return {
    charId: char.id,
    sessionId: session.id,
    seq: Number(message.seq),
    swipe: swipe,
    message: message,
    candidateIdentity: messageImageCandidateIdentity(message, swipe),
    text: messageImageCandidateText(message, swipe),
    imageId: image.getAttribute('data-generated-image'),
  };
}
async function deleteMessageImage(target) {
  var owner = messageImageTarget(target);
  if (!owner) return false;
  if (blockDuringGenerationOrPostCommit('删除图片', owner.session)) return false;
  var message = owner.message,
    previous = messageCandidateImages(message, target.swipe),
    index = previous.findIndex(function (entry) {
      return entry.id === target.imageId;
    });
  if (index < 0) return false;
  var removed = previous[index],
    slideKey = String(owner.session.id) + '|' + String(message.seq) + '|' + String(target.swipe),
    slide = Number(_messageImageSlides.get(slideKey)) || 0;
  setMessageCandidateImages(
    message,
    target.swipe,
    previous.filter(function (_, at) {
      return at !== index;
    })
  );
  _messageImageSlides.set(slideKey, Math.max(0, Math.min(previous.length - 2, slide > index ? slide - 1 : slide)));
  refreshMessageImages(owner.char, owner.session, message);
  try {
    // 仓储按全局引用回收 Blob，其他候选、消息或分支共用的媒体仍会保留。
    await saveData('sessions', { urgent: true });
  } catch (error) {
    // 只撤销本次摘掉的条目，保留保存等待期间新增图片与候选切换。
    if (messageImageTarget(target)) {
      var current = messageCandidateImages(message, target.swipe).slice();
      if (
        !current.some(function (entry) {
          return entry.id === removed.id;
        })
      ) {
        current.splice(Math.min(index, current.length), 0, removed);
        setMessageCandidateImages(message, target.swipe, current);
      }
    }
    _messageImageSlides.set(slideKey, slide);
    refreshMessageImages(owner.char, owner.session, message);
    toast('图片删除失败：' + ((error && error.message) || error), 'err');
    return false;
  }
  return true;
}
bindGeneratedImageHold(document, messageImageDeleteTarget, deleteMessageImage);
function messageImageRunVisible(run) {
  return !!(run && !run.stopping && !run.saving);
}
// ST /imagine 新建的系统图片消息（等价 ST is_system 的图片消息，不进 Prompt），见下方 ST /imagine 一节。
const GENERATED_IMAGE_MESSAGE_KIND = 'generated-image';
function isGeneratedImageMessage(message) {
  return !!(message && message.role === 'system' && message.kind === GENERATED_IMAGE_MESSAGE_KIND);
}
// 开场白的候选会被角色卡保存、卡片切换开场白等路径整体重建，不挂图片。
function messageCanHaveImages(message) {
  if (!message || !(Number(message.seq) > 0)) return false;
  if (isGeneratedImageMessage(message)) return true;
  return !!(
    message.role === 'assistant' &&
    message.opening !== true &&
    message.streamDraft !== true &&
    message.isStreamDraft !== true &&
    message.kind !== 'stream-draft' &&
    !isBranchReturnMessage(message) &&
    !isBranchReturnRevertMessage(message)
  );
}
// 输入栏与消息菜单共用的目标：只认最新一条 AI 回复，系统图片消息不占用这个入口。
function latestManualImageMessageIndex(session) {
  if (!session || !Array.isArray(session.msgs)) return -1;
  for (var i = session.msgs.length - 1; i >= 0; i--) {
    var message = session.msgs[i];
    if (message && message.role === 'assistant') return messageCanHaveImages(message) ? i : -1;
  }
  return -1;
}
// 「更多」菜单里的生图入口；进行中同一按钮变为停止。
function messageImageActionHtml(char, session, message, index) {
  if (
    !messageCanHaveImages(message) ||
    (message.role === 'assistant' && index === latestManualImageMessageIndex(session))
  )
    return '';
  var running = messageImageRunVisible(_messageImageRuns.get(messageImageRunKey(char.id, session.id, message.seq)));
  return (
    '<button class="btn sm" data-message-image-action onclick="generateMessageImage(' +
    index +
    ');closeMessageMore()">' +
    (running ? uiIcon('stop') + ' 停止生图' : uiIcon('palette') + ' 生图') +
    '</button>'
  );
}
// 消息里的图片条与生图状态，外层槽位总是输出，生图状态变化时只换槽位内容。
function messageImagesHtml(char, message, index) {
  var session = char && getActiveSession(char.id);
  return (
    '<div class="message-image-slot" data-message-image-seq="' +
    escAttr(String(message.seq || '')) +
    '">' +
    messageImagesInnerHtml(char, session, message, index) +
    '</div>'
  );
}
function messageImagesInnerHtml(char, session, message, index) {
  var images = Array.isArray(message.images) ? message.images : [],
    run = session && _messageImageRuns.get(messageImageRunKey(char.id, session.id, message.seq)),
    html = '';
  if (images.length) {
    var slideKey = messageImageSlideKey(session, message),
      current = Math.max(0, Math.min(images.length - 1, Number(_messageImageSlides.get(slideKey)) || 0));
    html +=
      '<div class="message-images" data-yeyu-interactive data-image-slide="' +
      escAttr(slideKey) +
      '"><div class="message-image-track" data-image-index="' +
      current +
      '" onscroll="messageImageTrackScrolled(this)">' +
      images
        .map(function (entry) {
          var src = storedImageDisplaySrc(entry, char.id),
            size =
              Number(entry.width) > 0 && Number(entry.height) > 0
                ? ' width="' + Number(entry.width) + '" height="' + Number(entry.height) + '"'
                : '';
          return (
            '<div class="message-image-slide"><img class="message-image" draggable="false" data-generated-image="' +
            escAttr(entry.id) +
            '" data-stored-image="' +
            escAttr(entry.mediaKey) +
            '"' +
            (src ? ' src="' + escAttr(src) + '"' : '') +
            size +
            ' alt="生成的图片" title="' +
            escAttr(entry.prompt || '') +
            '"></div>'
          );
        })
        .join('') +
      '</div>' +
      (images.length > 1
        ? '<div class="opening-swipe-controls message-image-controls"><button class="btn sm message-image-prev" onclick="stepMessageImages(this,-1)" aria-label="上一张图片"' +
          (current <= 0 ? ' disabled' : '') +
          '>' +
          uiIcon('chevron-left') +
          '</button><span class="opening-swipe-count message-image-count" aria-live="polite">' +
          (current + 1) +
          ' / ' +
          images.length +
          '</span><button class="btn sm message-image-next" onclick="stepMessageImages(this,1)" aria-label="下一张图片"' +
          (current >= images.length - 1 ? ' disabled' : '') +
          '>' +
          uiIcon('chevron-right') +
          '</button></div>'
        : '') +
      '</div>';
    if (current > 0) requestAnimationFrame(restoreMessageImageSlides);
  }
  if (run)
    html +=
      '<div class="message-image-status" data-yeyu-interactive role="status" aria-live="polite"><span class="message-image-state-mark" aria-hidden="true">' +
      uiIcon('palette') +
      '</span><span class="message-image-state-copy"><strong>' +
      (run.stopping ? '正在停止' : run.saving ? '正在保存图片' : run.phase === 'image' ? '正在生图' : '正在准备画面') +
      '</strong><span>' +
      (run.stopping
        ? '已取消本次请求'
        : run.saving
          ? '生成已完成'
          : run.phase === 'image'
            ? '等待图片返回'
            : '正在撰写出图提示词') +
      '</span></span><button class="btn text danger message-image-stop" onclick="stopMessageImage(' +
      index +
      ')"' +
      (run.stopping || run.saving ? ' disabled' : '') +
      '>' +
      uiIcon('stop') +
      (run.stopping ? '停止中' : '停止') +
      '</button></div>';
  return html;
}
// 重绘后的图片条从第一张开始；把记住的那一张滚回视口（只在本次运行内记忆，不写库）。
function restoreMessageImageSlides() {
  document.querySelectorAll('.message-image-track[data-image-index]').forEach(function (track) {
    var index = Number(track.getAttribute('data-image-index')) || 0;
    track.removeAttribute('data-image-index');
    if (index > 0 && track.clientWidth) track.scrollLeft = index * track.clientWidth;
  });
}
function messageImageTrackScrolled(track) {
  var strip = track.closest('.message-images'),
    total = track.children.length,
    index = track.clientWidth ? Math.max(0, Math.min(total - 1, Math.round(track.scrollLeft / track.clientWidth))) : 0;
  if (!strip) return;
  _messageImageSlides.set(strip.getAttribute('data-image-slide'), index);
  var count = strip.querySelector('.message-image-count'),
    prev = strip.querySelector('.message-image-prev'),
    next = strip.querySelector('.message-image-next');
  if (count) count.textContent = index + 1 + ' / ' + total;
  if (prev) prev.disabled = index <= 0;
  if (next) next.disabled = index >= total - 1;
}
function stepMessageImages(button, step) {
  var track = button.closest('.message-images').querySelector('.message-image-track');
  track.scrollBy({ left: step * track.clientWidth, behavior: uiMotionDuration() ? 'smooth' : 'auto' });
}
function refreshMessageImages(char, session, message) {
  if (getChar() !== char || getActiveSession(char.id) !== session) return;
  refreshComposerImageButton();
  var index = session.msgs.indexOf(message),
    slot =
      index < 0
        ? null
        : document.querySelector('.message-image-slot[data-message-image-seq="' + Number(message.seq) + '"]');
  if (!slot) return;
  slot.innerHTML = messageImagesInnerHtml(char, session, message, index);
  var row = slot.closest('.msg'),
    action = row && row.querySelector('[data-message-image-action]');
  if (action) action.outerHTML = messageImageActionHtml(char, session, message, index);
}
// 生图前就能判断的配置问题，给出指向设置的提示，免得白写一次提示词。
function imageSourceProblem(source) {
  if (!source) return '还没有可用的图片来源，请先在「设置 → 生图」里添加。';
  var auth = D.settings && D.settings.grokSubscriptionAuth;
  if (source.type === 'grok-subscription' && !(auth && auth.refreshToken))
    return '图片来源「' + source.name + '」使用 Grok 订阅，请先在「设置 → 生图」里登录 Grok。';
  if (source.type === 'grok-subscription' && !source.model)
    return '请先在「设置 → 生图」里为图片来源「' + source.name + '」选择模型。';
  if (source.format === 'gemini' && !source.model)
    return '请先在「设置 → 生图」里为图片来源「' + source.name + '」选择模型。';
  if (source.type === 'openai' && !source.apiUrl)
    return '请先在「设置 → 生图」里填写图片来源「' + source.name + '」的接口地址。';
  return '';
}
// 候选身份：生图期间候选被删除、改写或换了位置，结果就不再属于它。
function messageImageCandidateText(message, swipe) {
  var model = messageSwipeState(message);
  if (swipe >= model.swipes.length) return null;
  return swipe === model.active ? messageUntranslatedContent(message) : model.swipes[swipe];
}
function messageImageTarget(run) {
  var char = (D.characters || []).find(function (row) {
      return row.id === run.charId;
    }),
    box = char && D.chats && D.chats[char.id],
    session =
      box &&
      (box.sessions || []).find(function (row) {
        return row.id === run.sessionId;
      }),
    message =
      session &&
      session.msgs.find(function (row) {
        return Number(row && row.seq) === run.seq;
      });
  if (
    !messageCanHaveImages(message) ||
    message !== run.message ||
    messageImageCandidateIdentity(message, run.swipe) !== run.candidateIdentity ||
    messageImageCandidateText(message, run.swipe) !== run.text
  )
    return null;
  return { char: char, session: session, message: message };
}
// 手动生图：按当前图片来源的处理方式写提示词并出图，结果追加到发起时那个候选的图片末尾。
// 系统图片消息按 ST 消息按钮的语义，以最后一张图的原提示词直接出一张，不经写提示词模型。
async function generateMessageImage(idx) {
  var char = getChar(),
    session = char && getActiveSession(char.id),
    message = session && session.msgs[idx];
  if (!messageCanHaveImages(message)) return false;
  var key = messageImageRunKey(char.id, session.id, message.seq);
  if (_messageImageRuns.has(key)) return stopMessageImage(idx);
  if (blockDuringGenerationOrPostCommit('生图', session)) return false;
  var source = activeImageSource(),
    problem = imageSourceProblem(source);
  if (problem) {
    toast(problem, 'err');
    return false;
  }
  var swipe = messageSwipeState(message).active,
    run = {
      controller: new AbortController(),
      charId: char.id,
      sessionId: session.id,
      seq: Number(message.seq),
      swipe: swipe,
      message: message,
      candidateIdentity: messageImageCandidateIdentity(message, swipe),
      text: messageImageCandidateText(message, swipe),
      phase: isGeneratedImageMessage(message) ? 'image' : 'prompt',
    };
  _messageImageRuns.set(key, run);
  refreshMessageImages(char, session, message);
  try {
    var result = isGeneratedImageMessage(message)
        ? await regenerateImageMessagePicture(source, message, run.controller.signal)
        : await runImageGeneration({
            source: source.id,
            char: char,
            session: session,
            message: message,
            signal: run.controller.signal,
            // 手动生图由消息内的「停止」取消，写提示词期间输入区照常可发送；提示词弹窗归这次运行
            // 的 signal 持有，停止时一并关掉。
            globalStop: false,
            beforeRequest: async function (prompt) {
              var edited = await appInput('检查并修改出图提示词，取消则不出图。', prompt, '出图提示词', '提示词', {
                multiline: true,
                okText: '出图',
                owner: run.controller.signal,
              });
              if (edited === null || !String(edited).trim()) throw imageAbortError();
              run.phase = 'image';
              refreshMessageImages(char, session, message);
              return edited;
            },
          }),
      entries = [];
    for (var i = 0; i < result.images.length; i++)
      entries.push(
        await createStoredImage('message-image', result.images[i].blob, {
          prompt: result.prompt,
          sourceId: result.source.id,
          model: result.source.model,
        })
      );
    if (run.controller.signal.aborted) return false;
    var target = messageImageTarget(run);
    if (!target) {
      toast('消息或候选已变化，这次生成的图片没有保存。', 'info');
      return false;
    }
    run.saving = true;
    refreshMessageImages(target.char, target.session, target.message);
    return await appendMessageImages(target.char, target.session, target.message, run.swipe, entries);
  } catch (error) {
    if (!(error && error.name === 'AbortError')) toast((error && error.message) || '生图失败', 'err');
    return false;
  } finally {
    if (_messageImageRuns.get(key) === run) _messageImageRuns.delete(key);
    var current = messageImageTarget(run) || { char: char, session: session, message: message };
    refreshMessageImages(current.char, current.session, current.message);
  }
}
function stopMessageImage(idx) {
  var char = getChar(),
    session = char && getActiveSession(char.id),
    message = session && session.msgs[idx],
    key = message && messageImageRunKey(char.id, session.id, message.seq),
    run = key && _messageImageRuns.get(key);
  if (!run || run.stopping || run.saving) return false;
  run.stopping = true;
  run.controller.abort();
  cancelOwnedAppPrompt(run.controller.signal);
  refreshMessageImages(char, session, message);
  return true;
}
async function regenerateImageMessagePicture(source, message, signal) {
  var images = Array.isArray(message.images) ? message.images : [],
    prompt = String((images.length && images[images.length - 1].prompt) || message.content || '');
  return { source: source, prompt: prompt, images: await requestImages(source, prompt, { n: 1, signal: signal }) };
}
// 把图片追加到消息某个候选的末尾并保存；保存失败只撤销这两个图片字段。
async function appendMessageImages(char, session, message, swipe, entries) {
  var before = {
    images: message.images,
    swipeImages: Array.isArray(message.swipeImages) ? message.swipeImages.slice() : undefined,
  };
  var previous = messageCandidateImages(message, swipe);
  setMessageCandidateImages(message, swipe, previous.concat(entries));
  if (swipe === messageSwipeState(message).active)
    _messageImageSlides.set(messageImageSlideKey(session, message), previous.length);
  refreshMessageImages(char, session, message);
  try {
    await saveData('sessions', { urgent: true });
  } catch (error) {
    ['images', 'swipeImages'].forEach(function (field) {
      if (before[field] === undefined) delete message[field];
      else message[field] = before[field];
    });
    refreshMessageImages(char, session, message);
    toast('图片保存失败，没有留下这次的图片：' + ((error && error.message) || error), 'err');
    return false;
  }
  return true;
}

// ----- Risu inlay 出图（33 号的 ImgGen 标签、trigger runImgGen/v2ImgGen 与 Lua generateImage 共用）-----
// 对照固定 Risu generateAIImage(..., 'inlay')：卡片给出的提示词按当前来源的处理方式出一张图（直接总结原样发出，
// 去敏感化先改写）；negative 不发送，与上游 OpenAI 兼容来源一致。返回待写入 session.risu.inlays 的条目，失败抛出原因。
async function generateRisuInlayImage(char, session, prompt, signal) {
  var source = activeImageSource(),
    problem = imageSourceProblem(source);
  if (problem) throw new Error(problem);
  var result = await runImageGeneration({
    source: source.id,
    char: char,
    session: session,
    cardPrompt: String(prompt == null ? '' : prompt),
    n: 1,
    signal: signal,
  });
  return createStoredImage('inlay', result.images[0].blob, {
    prompt: result.prompt,
    sourceId: result.source.id,
    model: result.source.model,
  });
}

// ----- ST /imagine（66 号注册命令，执行在这里）-----
// 对照固定 ST stable-diffusion 扩展：触发词整串匹配、不分大小写，其余文本为自由模式提示词；
// 一条命令出一张图，非 quiet 时新建系统图片消息；成功返回图片地址，失败提示并返回空串（不抛）。
// 有意差异见 COMPATIBILITY_MATRIX §2.3。
const ST_IMAGINE_TRIGGERS = ['you', 'me', 'scene', 'raw_last', 'last', 'face', 'background'];
// 触发词的画面主体，作为写提示词输入里的 message（受保护提示词正文不变，只换取材）。
const ST_IMAGINE_SUBJECTS = {
  you: '{{name}}的全身像，展示外貌与服装。',
  face: '{{name}}的面部特写肖像，只画到肩部。',
  me: '{{name}}的全身像，展示外貌与服装。',
  background: '最近对话所在地点的场景背景，画面里没有人物，写清地点、时间、天气与光线。',
};
function stImagineMode(trigger) {
  var key = trigger.toLowerCase();
  return ST_IMAGINE_TRIGGERS.includes(key) ? key : 'free';
}
// 最新一条可读的对话消息（ST 跳过 is_system 行）。
function stImagineLatestIndex(session) {
  for (var i = session.msgs.length - 1; i >= 0; i--) if (imagePromptContextMessage(session.msgs[i])) return i;
  throw new Error('对话里还没有可以配图的消息。');
}
// 按模式给出 runImageGeneration 的取材：cardPrompt（自由文本、raw_last）或写提示词输入 input。
function stImagineMaterial(mode, trigger, char, session) {
  // ST 自由模式的 `char ` 前缀与 {{charPrefix}} 换成角色级 SD 前缀；夜欲没有这项设置，按空前缀去掉。
  if (mode === 'free') return { cardPrompt: trigger.replace(/^char(\s|,)|\{\{charPrefix\}\}/gi, '').trim() };
  var latest = stImagineLatestIndex(session);
  if (mode === 'raw_last')
    return {
      cardPrompt: imagePromptTail(imagePromptMessageText(char, session.msgs[latest]), IMAGE_PROMPT_MESSAGE_MAX_CHARS),
    };
  if (mode === 'last' || mode === 'scene') return { message: session.msgs[latest] };
  var subjectName = mode === 'me' ? imagePromptUserName(char) : characterPromptName(char);
  return {
    input: {
      message: session.msgs[latest],
      subject: ST_IMAGINE_SUBJECTS[mode].replace('{{name}}', subjectName),
    },
  };
}
// 画幅：width/height 同时给出时按它们；否则按 ST setTypeSpecificDimensions，以来源设置的画幅为底，
// face 不是竖幅时高改为宽的 1.5 倍，background 不是横幅时宽改为高的 1.8 倍，其余沿用来源设置。
// Grok/Gemini 取各自最接近的画幅，OpenAI 兼容来源作为 size（来源没设 size 时只用命令给的宽高）。
function stImagineDimensions(source, args, mode) {
  var width = Math.round(Number(args.width)),
    height = Math.round(Number(args.height)),
    ratioSource = source.type === 'grok-subscription' || source.format === 'gemini';
  if (!(width > 0 && height > 0)) {
    var base = String((ratioSource ? source.aspectRatio || '1:1' : source.size) || '').split(/[:x×]/i);
    width = Number(base[0]);
    height = Number(base[1]);
    if (!(width > 0 && height > 0)) return {};
    // 与 ST 一样把改动的边取到 64 的倍数；Grok 的底是比例，只看比值，不取整。
    var snap = function (value) {
      return ratioSource ? value : Math.round(value / 64) * 64;
    };
    if (mode === 'face' && width / height >= 1) height = snap(width * 1.5);
    else if (mode === 'background' && width / height <= 1) width = snap(height * 1.8);
    else return {};
  }
  if (!ratioSource) return { size: width + 'x' + height };
  var target = width / height,
    ratios = source.format === 'gemini' ? GEMINI_IMAGE_ASPECT_RATIOS : GROK_IMAGE_ASPECT_RATIOS,
    best = ratios[0];
  ratios.forEach(function (ratio) {
    var parts = ratio.split(':'),
      current = best.split(':');
    if (Math.abs(Math.log(parts[0] / parts[1] / target)) < Math.abs(Math.log(current[0] / current[1] / target)))
      best = ratio;
  });
  return { aspectRatio: best };
}
// 按 ST sendMessage：名字为角色名，正文为 ST 默认消息模板展开结果，图片附在这条消息上。
async function createImageMessage(char, session, prompt, entries, options) {
  options = options || {};
  if (options.signal && options.signal.aborted) throw imageAbortError();
  var box = D.chats && D.chats[char.id];
  if (!box || !(box.sessions || []).includes(session)) throw new Error('出图期间对话已被删除，图片没有保存。');
  var journal = createMutationJournal();
  journal.capture(session, ['nextMessageSeq', 'lockedBackground'], true);
  var name = canonicalCharacterName(char),
    seq = allocateMessageSeq(session),
    message = {
      role: 'system',
      kind: GENERATED_IMAGE_MESSAGE_KIND,
      content: '[' + name + ' sends a picture that contains: ' + prompt + '].',
      time: Date.now(),
      seq: seq,
      images: entries,
    },
    background = options.background,
    sections = background ? ['characters', 'sessions'] : 'sessions',
    saved = false;
  if (background) {
    char.media_assets = char.media_assets || [];
    char.media_assets.push(background.asset);
    session.lockedBackground = background.reference;
  }
  session.msgs.push(message);
  journal.seal();
  try {
    await saveData(sections, { urgent: true });
    saved = true;
    if (options.signal && options.signal.aborted) throw imageAbortError();
  } catch (error) {
    journal.rollback();
    // 仓储会把新图片的 Blob/data URL 换成媒体键，按对象身份移除本次插入，保留期间的其他追加。
    var messageIndex = session.msgs.indexOf(message);
    if (messageIndex >= 0) session.msgs.splice(messageIndex, 1);
    if (background) {
      var assetIndex = (char.media_assets || []).indexOf(background.asset);
      if (assetIndex >= 0) char.media_assets.splice(assetIndex, 1);
    }
    // 保存等待期间停止时，本次结果可能已落库，撤回也必须持久化。
    if (saved) {
      try {
        await saveData(sections, { urgent: true });
      } catch (rollbackError) {
        throw new Error('图片撤回保存失败：' + ((rollbackError && rollbackError.message) || rollbackError));
      }
    }
    if (error && error.name === 'AbortError') throw error;
    throw new Error('图片消息保存失败：' + ((error && error.message) || error));
  }
  return message;
}
// trigger 为命令的未命名参数；char / session 是命令开始时的所属对话，出图期间切换对话也写回原处。
async function runStscriptImagine(args, trigger, char, session) {
  args = args || {};
  trigger = String(trigger == null ? '' : trigger).trim();
  if (!trigger) return '';
  var fail = function (text) {
    toast(text, 'err');
    return '';
  };
  if (!char || !session) return fail('当前没有可用对话，没有出图。');
  var source = activeImageSource(),
    problem = imageSourceProblem(source);
  if (problem) return fail(problem);
  var mode = stImagineMode(trigger),
    quiet = stscriptIsTrue(args.quiet),
    url,
    message,
    completed = false;
  try {
    var material = stImagineMaterial(mode, trigger, char, session),
      dimensions = stImagineDimensions(source, args, mode);
    await stscriptWithRequestController(args, async function (controller) {
      var result = await runImageGeneration({
        source: source.id,
        char: char,
        session: session,
        message: material.message,
        input: material.input,
        cardPrompt: material.cardPrompt,
        n: 1,
        model: String(args.model || '').trim(),
        aspectRatio: dimensions.aspectRatio,
        size: dimensions.size,
        signal: controller.signal,
        // ST 的 edit 只作用于触发词模式（自由文本不经 refinePrompt）。
        beforeRequest:
          stscriptIsTrue(args.edit) && mode !== 'free'
            ? function (prompt) {
                return appInput('检查并修改出图提示词，取消则不出图。', prompt, '出图提示词', '提示词', {
                  multiline: true,
                  okText: '出图',
                });
              }
            : null,
      });
      var blob = result.images[0].blob;
      url = await imageBlobToDataUrl(blob);
      if (controller.signal.aborted) throw imageAbortError();
      if (!quiet) {
        var entry = await createStoredImage('message-image', blob, {
          prompt: result.prompt,
          sourceId: result.source.id,
          model: String(args.model || '').trim() || result.source.model,
        });
        message = await createImageMessage(char, session, result.prompt, [entry], {
          signal: controller.signal,
          background: mode === 'background' ? prepareGeneratedChatBackground(char, blob, url) : null,
        });
      }
      // quiet 的结果已转换完成；普通/背景模式已保存并通过最后的取消检查。
      completed = true;
    });
  } catch (error) {
    if (!completed || !(error && error.name === 'AbortError')) {
      if (error && error.name === 'AbortError') return '';
      return fail((error && error.message) || '出图失败');
    }
  }
  if (quiet) return url;
  try {
    if (mode === 'background' && getChar() && getChar().id === char.id && getActiveSession(char.id) === session)
      await applyCharBackground(char);
    await stscriptRenderSentMessage(session, message, true, args, 'extension');
  } catch (error) {
    if (error && error.name === 'AbortError') {
      stscriptRenderOwner(char, session);
      return url;
    }
    return fail((error && error.message) || '图片消息保存失败');
  }
  return url;
}

// ----- 设置页「生图」分区：图片来源编辑 -----
// 只改设置页草稿（providerFormSettings），底部「保存」随供应商草稿整体写回，「取消」一并丢弃。
// 规范化会重建来源记录，所以跨重绘与 await 一律按 id 在草稿里现查，不持有旧引用。
const IMAGE_SOURCE_TYPE_LABELS = { 'grok-subscription': 'Grok 订阅', openai: '自定义图片接口' };
// Grok 出图画幅，与固定 ST stable-diffusion 扩展的 xAI 画幅表一致；空值为自动，不发送。
const GROK_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '1:2',
  '2:1',
];
// Gemini generateContent 的 ImageConfig 画幅，见 Google GenerateContent API ImageConfig。
const GEMINI_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
];
var _imageSourceDetection = null;

// 把表单写回它正在显示的那个来源；表单没渲染过或来源已不在草稿里时返回 null。
function captureImageSourceForm() {
  var tab = $('st-image'),
    source = tab && imageSourceById(tab.dataset.sourceId, providerFormSettings());
  if (!source) return null;
  if (source.type === 'openai') {
    source.format = $('image-source-format').value === 'gemini' ? 'gemini' : 'openai';
    source.apiUrl = normalizeApiBase($('image-source-url').value);
    source.apiKey = $('image-source-key').value.trim();
    if (source.format === 'openai') source.size = $('image-source-size').value.trim();
  }
  if (source.type === 'grok-subscription' || source.format === 'gemini')
    source.aspectRatio = $('image-source-aspect').value;
  source.model = $('image-source-model').value.trim();
  source.n = Number($('image-source-count').value) || 1;
  source.promptMode = $('image-source-prompt-mode').value === 'desensitize' ? 'desensitize' : 'summary';
  return source;
}
function imageSourceAspectOptions(selected, format) {
  var values = (format === 'gemini' ? GEMINI_IMAGE_ASPECT_RATIOS : GROK_IMAGE_ASPECT_RATIOS).slice();
  if (selected && values.indexOf(selected) < 0) values.unshift(selected);
  return (
    '<option value="">自动</option>' +
    values
      .map(function (value) {
        return '<option value="' + escAttr(value) + '">' + esc(value) + '</option>';
      })
      .join('')
  );
}
function renderImageSourceModelOptions(source) {
  var box = $('image-source-model-results');
  if (!box) return;
  box.innerHTML = source.models
    .map(function (id) {
      return (
        '<button type="button" class="api-model-option' +
        (id === source.model ? ' selected' : '') +
        '" onclick="chooseImageSourceModel(this)" data-model="' +
        escAttr(id) +
        '">' +
        esc(id) +
        '</button>'
      );
    })
    .join('');
  box.style.display = source.models.length ? 'grid' : 'none';
}
function setImageSourceStatus(text, type) {
  var el = $('image-source-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'api-test-status ' + (type || '');
  el.hidden = !text;
}
function syncImageSourceDetectButton() {
  var button = $('image-source-detect-btn');
  if (button) button.textContent = _imageSourceDetection ? '取消' : '检测模型';
}
function renderImageSourceEditor() {
  var select = $('image-source-select');
  if (!select || !D || !D.settings) return;
  syncProviderDraftWithSettings();
  // 草稿复制自已规范化的设置，新增来源各自规范化；这里把表单采集的值规范化一次再显示。
  var settings = providerFormSettings();
  ensureImageSourceSettings(settings);
  var source = imageSourceById(settings.activeImageSourceId, settings);
  select.innerHTML = settings.imageSources
    .map(function (row) {
      return (
        '<option value="' +
        escAttr(row.id) +
        '"' +
        (source && row.id === source.id ? ' selected' : '') +
        '>' +
        esc(row.name) +
        '</option>'
      );
    })
    .join('');
  $('image-source-picker').hidden = !source;
  $('image-source-empty').hidden = !!source;
  $('image-source-rename').disabled = $('image-source-delete').disabled = !source;
  $('image-source-connection').hidden = $('image-source-output').hidden = !source;
  // 表单正在显示的来源；采集按它写回，不受选择器已切换的值影响。
  $('st-image').dataset.sourceId = source ? source.id : '';
  setImageSourceStatus('', '');
  syncImageSourceDetectButton();
  if (!source) return;
  var grok = source.type === 'grok-subscription',
    gemini = !grok && source.format === 'gemini';
  $('image-source-type-hint').textContent = grok
    ? 'Grok 订阅：复用本机已登录的 Grok 账号出图；登录和退出立即生效。'
    : gemini
      ? 'Gemini 原生：填写 Base URL 与 Key，使用 generateContent 生成图片。'
      : 'OpenAI 兼容图片接口：填写接口地址，需要鉴权时再填 Key。';
  $('image-source-grok').hidden = !grok;
  $('image-source-openai').hidden = grok;
  $('image-source-format').value = gemini ? 'gemini' : 'openai';
  $('image-source-url-hint').textContent = gemini
    ? '可填 https://uuapi.cc/v1beta 或 https://generativelanguage.googleapis.com/v1beta；只填域名时会自动补 /v1beta。'
    : '填到版本路径为止，例如 …/v1；出图请求发往其下的 /images/generations。';
  $('image-source-url').value = source.apiUrl || '';
  $('image-source-url').placeholder = gemini
    ? 'https://generativelanguage.googleapis.com/v1beta'
    : 'https://api.example.com/v1';
  $('image-source-key').value = source.apiKey || '';
  $('image-source-model').value = source.model;
  $('image-source-model').placeholder = grok
    ? '例如：grok-imagine-image'
    : gemini
      ? '例如：gemini-3.1-flash-image-preview'
      : '例如：dall-e-3';
  renderImageSourceModelOptions(source);
  $('image-source-aspect-field').hidden = !grok && !gemini;
  $('image-source-aspect').innerHTML = imageSourceAspectOptions(source.aspectRatio, gemini ? 'gemini' : 'grok');
  $('image-source-aspect').value = source.aspectRatio;
  $('image-source-size-field').hidden = grok || gemini;
  $('image-source-size').value = source.size;
  $('image-source-count').value = String(source.n);
  $('image-source-prompt-mode').value = source.promptMode;
  if (grok) renderGrokSubscription();
}
function changeImageSourceFormat() {
  cancelImageSourceDetection();
  captureImageSourceForm();
  renderImageSourceEditor();
}
function selectImageSourceForEditing() {
  cancelImageSourceDetection();
  captureImageSourceForm();
  providerFormSettings().activeImageSourceId = $('image-source-select').value;
  renderImageSourceEditor();
}
async function addImageSource() {
  captureImageSourceForm();
  var draft = providerFormSettings(),
    labels = IMAGE_SOURCE_TYPE_LABELS,
    choice = await appInput('选择新图片来源的类型，添加后可以重命名。', labels.openai, '新增图片来源', '类型', {
      choices: [labels['grok-subscription'], labels.openai],
      okText: '添加',
    });
  // 等待期间离开了设置页时草稿已丢弃，不能写进运行中的设置。
  if (!choice || !draft || providerFormSettings() !== draft) return;
  cancelImageSourceDetection();
  var settings = providerFormSettings(),
    source = normalizeImageSourceRecord(
      { id: 'image_source_' + uid(), type: choice === labels['grok-subscription'] ? 'grok-subscription' : 'openai' },
      settings.imageSources.length
    );
  settings.imageSources.push(source);
  settings.activeImageSourceId = source.id;
  renderImageSourceEditor();
}
async function renameImageSource() {
  var source = captureImageSourceForm();
  if (!source) return;
  var draft = providerFormSettings(),
    id = source.id,
    name = String(
      (await appInput('给图片来源起一个名称。', source.name, '重命名图片来源', '名称', { okText: '确定' })) || ''
    ).trim();
  if (!name || providerFormSettings() !== draft) return;
  source = imageSourceById(id, providerFormSettings());
  if (!source) return;
  source.name = name;
  renderImageSourceEditor();
}
async function deleteImageSource() {
  var source = captureImageSourceForm();
  if (!source) return;
  var draft = providerFormSettings(),
    id = source.id;
  if (
    !(await appConfirm(
      '删除图片来源“' + source.name + '”？它的地址、模型和 Key 会从本地设置中移除，保存后生效。',
      '删除图片来源',
      '删除'
    )) ||
    providerFormSettings() !== draft
  )
    return;
  cancelImageSourceDetection();
  var settings = providerFormSettings();
  settings.imageSources = settings.imageSources.filter(function (row) {
    return row.id !== id;
  });
  if (settings.activeImageSourceId === id)
    settings.activeImageSourceId = settings.imageSources.length ? settings.imageSources[0].id : '';
  renderImageSourceEditor();
}
function chooseImageSourceModel(button) {
  var id = button && button.dataset.model;
  if (!id) return;
  $('image-source-model').value = id;
  captureImageSourceForm();
  document.querySelectorAll('#image-source-model-results .api-model-option').forEach(function (row) {
    row.classList.toggle('selected', row === button);
  });
  setImageSourceStatus('已选择 ' + id + '；保存设置后生效', 'ok');
}
// 切换或删除来源时直接调用，离开设置页与丢弃草稿时经 cancelProviderProbes 调用；迟到的结果不再写回。
function cancelImageSourceDetection() {
  if (!_imageSourceDetection) return;
  _imageSourceDetection.controller.abort();
  _imageSourceDetection = null;
  syncImageSourceDetectButton();
  setImageSourceStatus('', '');
}
// 检测进行中再点一次即取消；结果只写回发起时的草稿和来源。
async function detectImageSourceFormModels() {
  if (_imageSourceDetection) {
    _imageSourceDetection.controller.abort();
    return;
  }
  var source = captureImageSourceForm();
  if (!source) return;
  if (source.type === 'openai' && !isValidApiBase(source.apiUrl)) {
    setImageSourceStatus('请先填写有效的接口地址', 'err');
    return;
  }
  var request = { controller: new AbortController(), sourceId: source.id, settings: providerFormSettings() },
    live = function () {
      return _imageSourceDetection === request && providerFormSettings() === request.settings;
    };
  _imageSourceDetection = request;
  syncImageSourceDetectButton();
  setImageSourceStatus('正在读取模型列表…', 'busy');
  try {
    var ids = await detectImageSourceModels(source, { signal: request.controller.signal });
    if (!live()) return;
    captureImageSourceForm();
    var current = imageSourceById(request.sourceId, providerFormSettings());
    if (!current) return;
    current.models = ids;
    renderImageSourceModelOptions(current);
    if (ids.length) setImageSourceStatus('已发现 ' + ids.length + ' 个模型，请选择；保存设置后生效', 'ok');
    else setImageSourceStatus('没有读到模型列表，请手动填写模型名', 'err');
  } catch (error) {
    if (!live()) return;
    setImageSourceStatus(
      error && error.name === 'AbortError'
        ? '检测已取消'
        : '检测失败：' + ((error && error.message) || '未知错误') + '；可以手动填写模型名',
      'err'
    );
  } finally {
    if (_imageSourceDetection === request) {
      _imageSourceDetection = null;
      syncImageSourceDetectButton();
    }
  }
}
