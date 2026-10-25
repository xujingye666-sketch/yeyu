'use strict';

// Why a reply is incomplete, through the loaded app: the interruption and output-limit badges, the metadata a
// saved reply keeps after reload, provider interceptions, and the generation loop's retry rules (a stream that
// broke after text arrived is never re-requested, a connection that never opened is retried once).
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {
  await scenario('流式拒绝与非流式一致', `
    let {target} = await reset();
    const refusal = {choices: [{message: {content: '', refusal: 'refused'}, finish_reason: 'stop'}]};
    const nonStreamError = await failure(() => streamResponse(new Response(JSON.stringify(refusal), {headers: {'content-type': 'application/json'}}), target, {deferCommit: true}));
    ({target} = await reset());
    const streamError = await failure(() => streamResponse(body([sse({choices: [{delta: {refusal: 'refused'}}]}), sse({choices: [{delta: {}, finish_reason: 'stop'}]}), done]), target, {deferCommit: true}));
    assert.strictEqual(streamError && streamError.message, nonStreamError && nonStreamError.message);
    assert.ok(/refusal/.test(streamError.message));
    ({target} = await reset());
    const result = await streamResponse(body([chunk('拒绝前正文'), sse({choices: [{delta: {refusal: 'refused'}}]}), sse({choices: [{delta: {}, finish_reason: 'stop'}]}), done]), target, {deferCommit: true});
    assert.strictEqual(result.finishReason, 'refusal');
    assert.strictEqual(result.content, '拒绝前正文');
  `);

  await scenario('中断与输出上限徽标', `
    const separate = generationMetaHtml({incomplete: true, interruptionReason: 'network_interrupted', outputLimitReached: true});
    assert.ok(separate.includes('网络连接中断') && separate.includes('达到输出上限，可能未写完'), '流式中断与输出上限必须使用两个独立提示');
    assert.strictEqual(generationMetaHtml({sourceDraftId: 'cancelled-draft'}), '', '用户主动停止保留的正文不得显示错误提示');
    assert.ok(generationMetaHtml({incomplete: true, interruptionReason: 'connection_timeout'}).includes('连接模型超时'));
    assert.ok(generationMetaHtml({incomplete: true, interruptionReason: 'network_offline'}).includes('网络连接中断'));
    const provider = generationMetaHtml({incomplete: true, interruptionReason: 'provider_error', interruptionStatus: 502, interruptionDetail: '上游服务暂不可用'});
    assert.ok(provider.includes('HTTP 502') && provider.includes('上游服务暂不可用'), '供应商中途错误必须显示状态码和错误说明');
  `);

  await scenario('保存后重载仍带中断元数据', `
    const {session} = await reset({visible: true});
    setGenerationState('idle');
    const stored = async () => {
      await flushPendingSave();
      const copy = (await YeyuRepository.load()).data.chats.c1.sessions[0];
      sanitizeLoadedAssistantMessages(copy);
      return copy;
    };
    await commitGeneratedResponse({charId: 'c1', sessionId: 's1', mode: 'new', sourceUserSeq: 1}, '达到上限前生成的正文', {finishReason: 'length', deferMemorySummary: true});
    session.msgs.push({role: 'user', content: '再生成一条回复', seq: 3});
    session.nextMessageSeq = 4;
    await commitGeneratedResponse({charId: 'c1', sessionId: 's1', mode: 'new', sourceUserSeq: 3}, '网络中断前生成的正文',
      {generationMeta: {incomplete: true, sourceDraftId: 'draft-persist', interruptionReason: 'provider_error', interruptionStatus: 502, interruptionDetail: '上游服务暂不可用', untrustedField: 'drop-me'}, deferMemorySummary: true});
    const reloaded = await stored();
    assert.strictEqual(reloaded.msgs[1].generationMeta.outputLimitReached, true, '保存后重新加载必须保留输出上限状态');
    assert.ok(generationMetaHtml(reloaded.msgs[1].generationMeta).includes('达到输出上限，可能未写完'), '重新加载后必须继续显示输出上限徽标');
    assert.deepStrictEqual(reloaded.msgs[3].generationMeta, {incomplete: true, interruptionReason: 'provider_error', interruptionStatus: 502, interruptionDetail: '上游服务暂不可用', sourceDraftId: 'draft-persist'},
      '保存后重新加载必须保留中断原因、状态码和供应商说明，并剥离未知字段');
    assert.ok(generationMetaHtml(reloaded.msgs[3].generationMeta).includes('上游服务暂不可用'), '重新加载后必须继续显示具体中断原因');

    setGenerationState('streaming');
    await commitGeneratedResponse({charId: 'c1', sessionId: 's1', mode: 'continue', messageIndex: 3, messageSeq: session.msgs[3].seq}, '续写完成',
      {continuedBase: session.msgs[3].content, finishReason: 'stop', deferMemorySummary: true});
    assert.ok(session.msgs[3].content.endsWith('续写完成'), '成功续写必须合并正文');
    const meta = session.msgs[3].generationMeta || {};
    assert.strictEqual(meta.incomplete, undefined, '成功续写后必须清理旧中断状态');
    assert.strictEqual(meta.interruptionReason, undefined, '成功续写后必须清理旧中断原因');
    assert.strictEqual(generationMetaHtml(session.msgs[3].generationMeta), '', '成功续写后不得继续显示旧中断提示');
  `);

  // 供应商以内容过滤、安全拦截或拒答结束时：正文照常保存，原因跟着回复保存并提示，不再自动续写（#207）。
  await scenario('供应商拦截的原因随回复保存', `
    const {session} = await reset({visible: true});
    document.getElementById('toasts').replaceChildren();
    const results = [];
    for (const [finishReason, shown] of [['content_filter', 'content_filter'], ['SAFETY', 'safety'], ['refusal', 'refusal'], ['stop'], ['end_turn']]) {
      setGenerationState('streaming');
      session.msgs.push({role: 'user', content: '拦截测试', seq: session.nextMessageSeq++});
      await commitGeneratedResponse({charId: 'c1', sessionId: 's1', mode: 'new'}, '被拦截前的半截正文', {finishReason, deferMemorySummary: true});
      await flushPendingSave();
      const copy = (await YeyuRepository.load()).data.chats.c1.sessions[0];
      sanitizeLoadedAssistantMessages(copy);
      const meta = copy.msgs[copy.msgs.length - 1].generationMeta;
      results.push([finishReason, meta && meta.providerStopReason, !!meta && generationMetaHtml(meta).includes('供应商中途拦截（' + shown + '），回复可能不完整')]);
    }
    assert.deepStrictEqual(results, [['content_filter', 'content_filter', true], ['SAFETY', 'safety', true], ['refusal', 'refusal', true], ['stop', undefined, false], ['end_turn', undefined, false]],
      '拦截原因必须随回复保存、重载后仍显示，正常结束不带标记');
    const notices = Array.from(document.querySelectorAll('#toasts .toast'), row => row.textContent).filter(text => text.includes('供应商中途拦截'));
    assert.strictEqual(notices.length, 3, '拦截结束必须提示用户，正常结束不提示');
  `);

  await scenario('输出上限随回复提交', `
    const {session, target} = await reset({visible: true});
    window.fetch = async () => body([sse({choices: [{delta: {content: '短内容'}, finish_reason: 'length'}]}), done]);
    setGenerationState('preparing');
    await doAPICall({target});
    const reply = session.msgs[session.msgs.length - 1];
    assert.strictEqual(reply.role, 'assistant');
    assert.strictEqual(reply.generationMeta.outputLimitReached, true, '输出上限原因必须传到正式回复提交层');
  `);

  await scenario('拦截与中断不自动重新生成', `
    let {session, target} = await reset({visible: true});
    session.msgs = [{role: 'user', content: '继续写【至少 500 字】', seq: 1, time: 1700000000000}];
    let fetches = 0;
    window.fetch = async () => { fetches += 1; return body([sse({choices: [{delta: {content: '拦截前'}, finish_reason: 'content_filter'}]}), done]); };
    setGenerationState('preparing');
    await doAPICall({target});
    assert.strictEqual(fetches, 1, '被供应商拦截的回复不得自动续写');

    ({session, target} = await reset({visible: true}));
    fetches = 0;
    window.fetch = async () => { fetches += 1; return body([chunk('已收到的正文'), new TypeError('socket closed')]); };
    setGenerationState('preparing');
    await assert.rejects(() => doAPICall({target}), /流式响应期间网络传输中断/);
    assert.strictEqual(fetches, 1, '已收到正文后的中断不得自动发起第二次内容生成');

    ({session, target} = await reset({visible: true}));
    fetches = 0;
    window.fetch = async () => {
      fetches += 1;
      if (fetches === 1) throw new TypeError('Failed to fetch');
      return body([chunk('重试后的正文'), done]);
    };
    setGenerationState('preparing');
    await doAPICall({target});
    assert.strictEqual(fetches, 2, '连接尚未成功时只允许重试一次');
    assert.strictEqual(session.msgs.filter(row => row.role === 'assistant').length, 1);
  `);

  // A hanging preview retrieval must release the shared assembly queue when real sending starts.
  await scenario('发送让出卡住的预览', `
    const {char, session, target} = await reset({visible: true});
    const target2 = {...target};
    let retrievalEntered;
    const entered = new Promise(resolve => { retrievalEntered = resolve; });
    const previewController = new AbortController();
    _presetRoundPreviewController = previewController;
    Object.assign(D.settings, {embeddingEnabled: true, embeddingApiUrl: 'https://embedding.test/v1',
      embeddingApiKey: 'synthetic-key', embeddingModel: 'preview-cancellation', embeddingDimensions: 2});
    ensureSessionMemoryStore(session).longTermEntries.push(memoryV5NormalizeLongTerm({
      id: 'preview-candidate', type: 'key_event', content: '预览检索的候选', status: 'active',
      sourceStartSeq: 1, sourceEndSeq: 1,
    }, session.id));
    let previewSignal, embeddingCalls = 0;
    window.fetch = async (url, options) => {
      assert.ok(String(url).endsWith('/embeddings'), '必须经过真实向量检索网络入口');
      embeddingCalls++;
      if (embeddingCalls === 1) {
        previewSignal = options.signal;
        retrievalEntered();
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort',
          () => reject(new DOMException('cancelled preview', 'AbortError')), {once: true}));
      }
      const request = JSON.parse(options.body);
      return new Response(JSON.stringify({data: request.input.map((_text, index) => ({index, embedding: [1, 0]}))}),
        {headers: {'content-type': 'application/json'}});
    };
    const preview = assembleGenerationPrompt(char, session, session.msgs, target, {preview: true, signal: previewController.signal});
    const previewStopped = assert.rejects(preview, /已取消/);
    await entered;
    const sendAfterPreview = assembleGenerationPrompt(char, session, session.msgs, target2, {});
    await previewStopped;
    assert.ok(previewController.signal.aborted && previewSignal.aborted, 'sending must cancel the preview and its actual embedding request');
    const sent = await sendAfterPreview;
    assert.ok(sent.messages.some(row => row.content === '请继续'), 'cancelled preview must not keep the send queue locked');
    assert.ok(embeddingCalls > 1, '发送必须重新经过真实检索');
    assert.strictEqual(_vectorRetrievalBySession.get(session).state, 'ready');
    assert.ok(_vectorRetrievalBySession.get(session).memoryScores['preview-candidate'] > 0);
  `);
  console.log('interrupted reply metadata, interception notices and retry rules hold');
});
