'use strict';

// The stream-draft protocol through the loaded app: streamResponse over real Response bodies, drafts in the real
// repository, the native pause handshake over the real save pipeline, and cold-start recovery into the chat.
// Only the boundaries are replaced: the byte stream, navigator.onLine and the native bridge callback.
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {
  await scenario('断网后草稿', `
    const {session, target} = await reset();
    setOnline(false);
    const error = await failure(() => streamResponse(body([chunk('首段已收到正文'), chunk('末段<think>原文</think>'), new TypeError('socket closed')]), target, {deferCommit: true}));
    assert.ok(error && /(流式响应中断|网络已断开)/.test(error.message), '断网首段必须结束请求而不是自动重发：' + (error && error.message));
    assert.strictEqual(session.msgs.length, 1, '草稿不得写入正式 session.msgs');
    const drafts = await storedDrafts();
    assert.strictEqual(drafts.length, 1, '首个可见正文必须立即创建持久草稿');
    const draft = drafts[0];
    assert.strictEqual(draft.text, '首段已收到正文末段<think>原文</think>', '中断必须保存节流重绘尚未显示的最后原文');
    assert.strictEqual(draft.state, 'network_error');
    assert.strictEqual(draft.stopReason, 'network_offline', '已断网必须保存真实停止原因');
    assert.ok(!('reasoning' in draft), '草稿协议不得保存独立 reasoning 字段');
    assert.strictEqual(draft.targetMessageSeq, 1);
  `);

  await scenario('停止保留最后收到的原文', `
    const {target} = await reset();
    abortController = new AbortController();
    const error = await failure(() => streamResponse(body([chunk('FIRST'), chunk('LAST'), () => stopGeneration(), new DOMException('stopped', 'AbortError')]), target, {deferCommit: true}));
    assert.ok(error && /已取消/.test(error.message));
    assert.strictEqual((await storedDrafts())[0].text, 'FIRSTLAST');
    assert.strictEqual((await storedDrafts())[0].state, 'cancelled');
  `);

  await scenario('草稿保存完整原文', `
    const {target} = await reset();
    const raw = '<think>完整思考</think>□ {{user}}<!--hidden--><UpdateVariable>raw</UpdateVariable>';
    const result = await streamResponse(body([chunk(raw), encoder.encode('data: [DONE]\\n\\n')]), target, {deferCommit: true});
    assert.strictEqual(result.content, raw);
    assert.notStrictEqual(result.display, raw, '显示结果与原文不同，才能证明草稿没有复用显示结果');
    await _activeStreamDraft._writePromise;
    assert.strictEqual((await storedDrafts())[0].text, raw, '草稿保存完整原文，不能复用显示结果');
  `);

  await scenario('检查点节流与生命周期', `
    const {session, target} = await reset();
    setOnline(false);
    await failure(() => streamResponse(body([chunk('首段已收到正文'), new TypeError('socket closed')]), target, {deferCommit: true}));
    const active = _activeStreamDraft;
    const before = (await storedDrafts()).length;
    checkpointStreamDraft(target, session, '首段已收到正文X', {draft: active, state: 'streaming', now: Date.now()});
    await active._writePromise;
    const firstSavedAt = active.lastSavedAt;
    checkpointStreamDraft(target, session, '首段已收到正文XY', {draft: active, state: 'streaming', now: firstSavedAt + 100});
    await active._writePromise;
    assert.strictEqual((await storedDrafts()).length, before, '同一草稿必须覆盖而不是新增记录');
    assert.strictEqual(active.lastSavedAt, firstSavedAt, '小增量且不足一秒不得逐 token 写入');
    checkpointStreamDraft(target, session, active.text + 'Z'.repeat(160), {draft: active, state: 'streaming', now: firstSavedAt + 200});
    await active._writePromise;
    assert.ok(active.lastSavedAt >= firstSavedAt + 200, '128–256 字级别增量必须写入检查点');

    await flushActiveStreamDraft('visibility_hidden');
    assert.strictEqual((await storedDrafts())[0].state, 'suspended', 'hidden 必须立即 flush 并标记 suspended');
    stopGeneration();
    await _activeStreamDraft._writePromise;
    assert.strictEqual((await storedDrafts())[0].state, 'cancelled', '用户停止且已有正文必须保留 cancelled 草稿');
    assert.strictEqual(session.msgs.length, 1, '生命周期 flush 不得影响正式消息、记忆或 usage');

    const kept = _activeStreamDraft;
    assert.strictEqual(checkpointStreamDraft(target, session, 'X'.repeat(1000001), {draft: kept, state: 'streaming'}), null, '超大草稿不得继续扩张写入');
    assert.strictEqual(_activeStreamDraft.draftId, kept.draftId, '超大后续内容不得丢失上一次可恢复草稿');

    session.msgs.push({role: 'user', seq: 2, content: '新的正式提问'});
    assert.notStrictEqual(streamDraftBaseHash(session), kept.committedBaseHash, '新用户消息必须改变草稿基础 hash');
    const next = checkpointStreamDraft(target, session, '新一段正文', {state: 'streaming'});
    await next._writePromise;
    assert.notStrictEqual(next.draftId, kept.draftId, '同一会话的新目标不得覆盖旧目标草稿');
    assert.strictEqual(next.targetMessageSeq, 2, '新目标草稿必须绑定新用户消息');
    assert.strictEqual((await storedDrafts()).length, 2, '不同目标必须保留独立、可验证的草稿记录');
    const again = checkpointStreamDraft(target, session, '新一段正文继续', {state: 'streaming', now: Date.now() + 1001});
    await again._writePromise;
    assert.strictEqual(again.draftId, next.draftId, '同一目标必须幂等覆盖同一个草稿记录');
  `);

  await scenario('供应商拦截与中途报错', `
    // 兼容线路没有正文、直接以 content_filter 结束时说明是供应商拦截，而不是空响应（#207）。
    let {target} = await reset();
    await assert.rejects(() => streamResponse(body([sse({choices: [{delta: {}, finish_reason: 'content_filter'}]}), encoder.encode('data: [DONE]\\n\\n')]), target, {deferCommit: true}),
      /供应商拦截了这次回复（content_filter），没有生成正文/);

    ({target} = await reset());
    const error = await failure(() => streamResponse(body([chunk('供应商报错前的正文'), sse({status: 502, error: {message: '上游服务暂不可用'}})]), target, {deferCommit: true}));
    assert.strictEqual(error && error.interruptionReason, 'provider_error', '供应商中途报错必须保留独立原因');
    assert.strictEqual(error && error.status, 502, '供应商中途报错必须保留 HTTP 状态码');
    assert.ok(String(error && error.responseText).includes('上游服务暂不可用'), '供应商中途报错必须保留错误正文');
    assert.strictEqual((await storedDrafts())[0].stopReason, 'provider_error', '供应商中途报错必须写入草稿停止原因');
  `);

  await scenario('续写与超限', `
    let {session} = await reset();
    setOnline(false);
    session.msgs.push({role: 'assistant', seq: 2, content: '正式已提交的前段'});
    const continuation = {charId: 'c1', sessionId: 's1', mode: 'continue', messageIndex: 1, messageSeq: 2};
    const error = await failure(() => streamResponse(body([chunk('首段已收到正文'), new TypeError('socket closed')]), continuation, {deferCommit: true}));
    assert.ok(error, '手动续写段断网必须返回中断状态');
    const draft = (await storedDrafts())[0];
    assert.strictEqual(draft.targetMessageSeq, 2, '手动续写草稿必须绑定正式助手消息');
    assert.strictEqual(draft.text, '首段已收到正文', '手动续写草稿只保存未提交的新段，避免重复基础正文');
    assert.strictEqual(session.msgs[1].content, '正式已提交的前段', '中断草稿不得改写已提交助手消息');

    // 第二片段超过草稿上限后断网：检查点会拒绝这一次写入，但先前已可恢复的草稿必须留到中断落盘。
    let {target} = await reset();
    setOnline(false);
    // 节流重绘要等定时器，超限检查点必须在断网之前真的跑过一次。
    const oversized = await failure(() => streamResponse(body([chunk('首段已收到正文'), chunk('X'.repeat(1000001)), {delay: 150}, new TypeError('socket closed')]), target, {deferCommit: true}));
    assert.ok(oversized, '超大后续片段之后断网必须返回中断状态');
    assert.strictEqual(_streamDraftProtectionWarning, '草稿保护暂不可用', '超限片段必须触发过草稿保护提示，否则这一轮根本没走到超限分支');
    const drafts = await storedDrafts();
    assert.strictEqual(drafts.length, 1, '超大后续片段不得另建草稿记录');
    assert.strictEqual(drafts[0].text, '首段已收到正文', '超大后续片段不得覆盖先前有效草稿正文');
    assert.strictEqual(drafts[0].state, 'network_error', '超大后续片段不得丢失草稿引用，中断时先前草稿仍必须按中断状态落盘');
    assert.strictEqual(drafts[0].stopReason, 'network_offline', '超大后续片段之后的中断必须保留真实停止原因');
  `);

  await scenario('冷启动读回草稿', `
    const {session, target} = await reset();
    await persistStreamDraftRecord(makeStreamDraftCheckpoint(target, session, {text: 'WebView 重建前留下的未完成正文', state: 'cancelled', stopReason: 'user_cancelled'}));
    _streamDrafts = [];
    _streamDraftsLoaded = false;
    _streamDraftLoadPromise = null;
    setGenerationState('idle');
    await initStreamDraftRecovery();
    assert.strictEqual(_streamDraftsLoaded, true);
    const reply = session.msgs[session.msgs.length - 1];
    assert.strictEqual(reply.role, 'assistant', '冷启动读回的草稿必须自动保存成未完成回复');
    assert.strictEqual(reply.content, 'WebView 重建前留下的未完成正文');
    assert.strictEqual(reply.generationMeta.incomplete, true);
    assert.strictEqual(reply.generationMeta.interruptionReason, 'user_cancelled', '用户已停止的草稿也要被保存下来');
    assert.strictEqual((await storedDrafts()).length, 0, '保存成未完成回复后草稿记录被删除');
  `);

  await scenario('原生暂停握手', `
    const {session, target} = await reset();
    const ready = [];
    window.AndroidBridge = {onWebViewPauseReady: (epoch, safe) => ready.push({epoch, safe})};
    checkpointStreamDraft(target, session, '后台前的正文', {state: 'streaming'});
    await _activeStreamDraft._writePromise;
    setGenerationState('idle');
    const settle = () => wait(30);
    // 落盘边界由测试握住：草稿写入与主数据写入各自等待放行。
    const held = {};
    const hold = (key, original) => function () {
      const args = arguments;
      return new Promise((resolve, reject) => { held[key] = () => original.apply(YeyuRepository, args).then(resolve, reject); });
    };
    const originals = {draft: YeyuRepository.saveStreamDraft, data: YeyuRepository.save};
    YeyuRepository.saveStreamDraft = hold('draft', originals.draft);
    YeyuRepository.save = hold('data', originals.data);
    try {
      saveData('sessions');
      assert.strictEqual(prepareNativeWebViewStop(17), true);
      await settle();
      assert.deepStrictEqual(ready, [], '两个保存任务都完成前不得通知原生暂停');
      held.draft();
      await settle();
      assert.deepStrictEqual(ready, [], '只完成草稿保存仍不得通知原生暂停');
      held.data();
      await settle();
      assert.deepStrictEqual(ready, [{epoch: '17', safe: true}], '两个保存成功且未生成时才允许原生暂停');
    } finally {
      Object.assign(YeyuRepository, {saveStreamDraft: originals.draft, save: originals.data});
    }

    ready.length = 0;
    setGenerationState('streaming');
    prepareNativeWebViewStop(18);
    await settle();
    assert.deepStrictEqual(ready, [{epoch: '18', safe: false}], '开始时仍在生成时，即使保存完成也不得暂停 WebView');

    ready.length = 0;
    setGenerationState('idle');
    const releaseTransient = registerTransientRequestController(new AbortController());
    prepareNativeWebViewStop(20);
    await settle();
    assert.deepStrictEqual(ready, [{epoch: '20', safe: false}], '回复已显示但后台工作挂起时不得暂停');
    releaseTransient();

    ready.length = 0;
    _persistenceBlocked = true;
    try {
      prepareNativeWebViewStop(19);
      await settle();
    } finally {
      _persistenceBlocked = false;
    }
    assert.deepStrictEqual(ready, [{epoch: '19', safe: false}], '任一保存失败不得通知原生暂停');
  `);

  await scenario('草稿落盘失败', `
    const {session, target} = await reset();
    const ready = [];
    let pauseReady;
    const paused = new Promise(resolve => { pauseReady = resolve; });
    window.AndroidBridge = {onWebViewPauseReady: (epoch, safe) => { ready.push({epoch, safe}); pauseReady(); }};
    checkpointStreamDraft(target, session, '后台前的正文', {state: 'streaming'});
    await _activeStreamDraft._writePromise;
    setGenerationState('idle');
    const original = IDBObjectStore.prototype.put;
    let rejectedWrites = 0;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'app_meta' && String(key).startsWith('stream_draft_v1:')) {
        rejectedWrites++;
        throw new DOMException('磁盘已满', 'QuotaExceededError');
      }
      return original.apply(this, arguments);
    };
    try {
      assert.strictEqual(await flushStreamDrafts('native_stop'), false, '草稿落盘失败时 flush 必须报告失败');
      prepareNativeWebViewStop(21);
      await paused; // The scenario timeout bounds a missing native callback. Keep storage failing until it arrives.
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    assert.ok(rejectedWrites > 0, '必须实际到达 IndexedDB 草稿写入边界');
    assert.deepStrictEqual(ready, [{epoch: '21', safe: false}], '草稿落盘失败不得通知原生可以暂停');
    assert.strictEqual(_streamDraftStopFailure, '本地存储空间不足，请清理设备空间后重试', '落盘失败原因必须留到回前台时提示');
  `);

  console.log(JSON.stringify({firstVisibleCheckpoint: true, networkRecovery: true, continuationNetworkRecovery: true, throttledOverwrite: true, hiddenFlush: true, cancelledDraft: true, targetIsolation: true, oversizedBounded: true, coldStartRecovery: true, nativeStopWaitsForBothSaves: true}));
});
