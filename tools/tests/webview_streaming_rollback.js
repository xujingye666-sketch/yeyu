'use strict';

// Requests and stops through the loaded app. The WebView fetch is the only transport (replaced here by a
// scripted fetch), a stop aborts only the main request and never the commit, a manual stop is not retried,
// SSE and whole-JSON bodies are read whatever they are labelled, [DONE] ends a connection that stays open,
// and a database that fell back to read-only refuses to start a generation.
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {

  await scenario('WebView fetch 是唯一传输', `
    const {target} = await reset();
    const calls = [];
    window.fetch = async (url, options) => { calls.push({url, options}); return body([chunk('经 WebView 返回'), done]); };
    const result = await callDeepSeek([{role: 'user', content: '测试'}], target, {route: 'chat', deferCommit: true});
    assert.strictEqual(result.content, '经 WebView 返回', '普通聊天必须通过 WebView fetch 返回的响应流');
    assert.strictEqual(calls.length, 1, '普通聊天应只发出一次 WebView fetch');
    assert.strictEqual(calls[0].url, 'https://api.example.test/v1/chat/completions');
    const sent = JSON.parse(calls[0].options.body);
    assert.strictEqual(sent.stream, true);
    assert.deepStrictEqual(sent.stream_options, {include_usage: true}, '必须保留当前 usage 兼容字段');
  `);

  await scenario('停止只中止 WebView 请求', `
    await reset();
    let aborts = 0;
    const fresh = () => {
      const controller = new AbortController();
      const abort = controller.abort.bind(controller);
      controller.abort = (...args) => { aborts += 1; return abort(...args); };
      return controller;
    };
    abortController = fresh();
    stopGeneration();
    for (let index = 0; index < 20; index += 1) stopGeneration();
    assert.strictEqual(aborts, 1, '重复点击停止必须只 abort 一次');
    assert.strictEqual(_generationState, 'stopping');

    setGenerationState('committing');
    abortController = fresh();
    stopGeneration();
    assert.strictEqual(_generationState, 'committing', '进入原子保存阶段后停止必须越过线性化点');
    assert.strictEqual(aborts, 1, '保存阶段不得再中止已经开始的提交');

    const transient = new AbortController();
    registerTransientRequestController(transient);
    stopGeneration();
    assert.strictEqual(transient.signal.aborted, true, '保存阶段的停止必须释放自带控制器的临时请求');
    assert.strictEqual(aborts, 1, '释放临时请求不得连带中止已经开始的提交');
  `);

  await scenario('手动停止不重试', `
    const {target} = await reset();
    setGenerationState('preparing');
    abortController = new AbortController();
    let fetches = 0;
    window.fetch = async () => {
      fetches += 1;
      setGenerationState('stopping');
      abortController.abort();
      throw Object.assign(new Error('用户停止'), {name: 'AbortError'});
    };
    await assert.rejects(() => requestGenerationWithRetry([{role: 'user', content: '手动停止'}], target, {route: 'chat'}), /已取消/);
    assert.strictEqual(fetches, 1, '用户手动停止后不得自动重试');
  `);

  await scenario('按内容而非标签读取响应', `
    const {target} = await reset();
    const streamed = await streamResponse(body([chunk('被误标'), chunk('的 SSE'), done], 'application/json'), {...target}, {deferCommit: true});
    assert.strictEqual(streamed.content, '被误标的 SSE', '被中转站标成 application/json 的 SSE 必须照常流式读取');
    const whole = new Response(JSON.stringify({choices: [{message: {content: '整段 JSON'}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});
    const single = await streamResponse(whole, {...target}, {deferCommit: true});
    assert.strictEqual(single.content, '整段 JSON', '整段 JSON 响应仍须返回正文');
    assert.strictEqual(single.finishReason, 'stop', '整段 JSON 响应仍须带回结束原因');
  `);

  await scenario('[DONE] 终止仍保持连接的服务器', `
    const {target} = await reset();
    let reads = 0, cancels = 0;
    const response = new Response(new ReadableStream({
      pull(controller) {
        reads += 1;
        if (reads === 1) controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"完成"}}]}\\n\\ndata: [DONE]\\n\\n'));
        // 之后的拉取永远不返回，等同于服务器保持连接不再发数据。
        else return new Promise(() => {});
      },
      cancel() { cancels += 1; },
    }), {headers: {'content-type': 'text/event-stream'}});
    const result = await streamResponse(response, {...target}, {deferCommit: true});
    assert.strictEqual(result.content, '完成');
    assert.strictEqual(cancels, 1, '协议结束后必须释放仍打开的 reader');
    assert.ok(reads <= 2, '[DONE] 必须作为协议终点，而不是等待 TCP EOF：读取了 ' + reads + ' 次');
  `);

  await scenario('原生流缺少结束标记时保留正文并中断', `
    for (const protocol of ['anthropic', 'gemini']) {
      const {target} = await reset();
      Object.assign(D.settings.providers[0], {protocol, model: protocol === 'anthropic' ? 'claude-test' : 'gemini-test'});
      const frame = protocol === 'anthropic'
        ? {type: 'content_block_delta', delta: {type: 'text_delta', text: '已收到正文'}}
        : {candidates: [{content: {parts: [{text: '已收到正文'}]}}]};
      window.fetch = async () => body([sse(frame)]);
      const error = await failure(() => callDeepSeek([{role: 'user', content: '测试'}], target, {route: 'chat', deferCommit: true}));
      assert.strictEqual(error && error.interruptionReason, 'network_interrupted', protocol + ' EOF 必须标记为中断');
      assert.strictEqual(error && error.noRetry, true, protocol + ' 已有正文不得自动重试');
      const drafts = await storedDrafts();
      assert.strictEqual(drafts.length, 1, protocol + ' 已有正文必须保留草稿');
      assert.strictEqual(drafts[0].text, '已收到正文');
      assert.strictEqual(drafts[0].stopReason, 'network_interrupted');
    }
  `);

  await scenario('原生流合法结束、坏帧与终止后的数据', `
    for (const protocol of ['anthropic', 'gemini']) {
      const {target} = await reset();
      Object.assign(D.settings.providers[0], {protocol, model: protocol === 'anthropic' ? 'claude-test' : 'gemini-test'});
      const textFrame = protocol === 'anthropic'
        ? {type: 'content_block_delta', delta: {type: 'text_delta', text: '有效正文'}}
        : {candidates: [{content: {parts: [{text: '有效正文'}]}, finishReason: 'STOP'}]};
      const terminal = protocol === 'anthropic' ? {type: 'message_stop'} : null;
      const lateFrame = protocol === 'anthropic'
        ? {type: 'content_block_delta', delta: {type: 'text_delta', text: '多余正文'}}
        : {candidates: [{content: {parts: [{text: '多余正文'}]}}]};
      const bytes = [encoder.encode('data: not-json\\n\\n'), sse(textFrame), terminal && sse(terminal), sse(lateFrame)].filter(Boolean);
      window.fetch = async () => body([encoder.encode(bytes.map(value => new TextDecoder().decode(value)).join(''))]);
      const result = await callDeepSeek([{role: 'user', content: '测试'}], target, {route: 'chat', deferCommit: true});
      assert.strictEqual(result.content, '有效正文', protocol + ' 坏帧须跳过，终止后的正文须忽略');
    }
    const {target} = await reset();
    Object.assign(D.settings.providers[0], {protocol: 'anthropic', model: 'claude-test'});
    window.fetch = async () => body([
      sse({type: 'content_block_delta', delta: {type: 'text_delta', text: '有结束原因'}}),
      sse({type: 'message_delta', delta: {stop_reason: 'end_turn'}}),
    ]);
    const result = await callDeepSeek([{role: 'user', content: '测试'}], target, {route: 'chat', deferCommit: true});
    assert.strictEqual(result.content, '有结束原因');
    assert.strictEqual(result.finishReason, 'stop', 'Anthropic 结束原因本身也能合法完成');
  `);

  await scenario('仅收到思考后中断不重试', `
    const {target} = await reset();
    Object.assign(D.settings.providers[0], {protocol: 'anthropic', model: 'claude-test'});
    window.fetch = async () => body([sse({type: 'content_block_delta', delta: {type: 'thinking_delta', thinking: '已有思考'}})]);
    const error = await failure(() => callDeepSeek([{role: 'user', content: '测试'}], target, {route: 'chat', deferCommit: true}));
    assert.strictEqual(error && error.interruptionReason, 'network_interrupted');
    assert.strictEqual(error && error.noRetry, true, '收到思考后不能自动重试');
    const providerError = await failure(() => streamResponse(body([
      sse({choices: [{delta: {reasoning_content: '已有思考'}}]}),
      sse({error: {message: '供应商中途报错'}}),
    ]), target, {deferCommit: true}));
    assert.strictEqual(providerError && providerError.interruptionReason, 'provider_error');
    assert.strictEqual(providerError && providerError.noRetry, true, '思考后供应商报错也不能自动重试');
  `);

  await scenario('helper 遇结束事件后停止消费', `
    await reset();
    let laterRead = 0;
    const first = encoder.encode('data: ' + JSON.stringify({choices: [{delta: {content: '有效正文'}}]}) + '\\n\\ndata: [DONE]\\n\\n' +
      'data: ' + JSON.stringify({choices: [{delta: {content: '同块多余正文'}}]}) + '\\n\\n');
    const response = new Response(new ReadableStream({
      pull(controller) {
        if (!laterRead++) controller.enqueue(first);
        else controller.enqueue(chunk('后块多余正文'));
      },
    }), {headers: {'content-type': 'text/event-stream'}});
    const result = await readTransientCompletionResponse(response);
    assert.strictEqual(result.content, '有效正文', '结束事件后的同块和后块内容都不能进入 helper 结果');
    for (const protocol of ['anthropic', 'gemini']) {
      const frame = protocol === 'anthropic'
        ? {type: 'content_block_delta', delta: {type: 'text_delta', text: '未完成'}}
        : {candidates: [{content: {parts: [{text: '未完成'}]}}]};
      const native = nativeProviderResponse({protocol}, body([sse(frame)]), true);
      const error = await failure(() => readTransientCompletionResponse(native));
      assert.strictEqual(error && error.interruptionReason, 'network_interrupted', protocol + ' helper 不能把无结束标记的 EOF 当成功');
    }
  `);

  await scenario('数据库只读回退时拒绝发送', `
    await reset({visible: true});
    setGenerationState('idle');
    let fetches = 0;
    window.fetch = async () => { fetches += 1; return body([chunk('不应发出'), done]); };
    document.getElementById('toasts').replaceChildren();
    _storageHealth.readOnlyFallback = true;
    try {
      assert.strictEqual(await doSendMessage('你好'), false, '数据库只读回退期间不得启动生成');
      const notices = Array.from(document.querySelectorAll('#toasts .toast'), row => row.textContent);
      assert.strictEqual(fetches, 0, '数据库只读回退期间不得发出任何请求');
      assert.strictEqual(notices.length, 1, '拒绝发送必须给出一次提示：' + JSON.stringify(notices));
      assert.ok(/只读展示本地恢复快照/.test(notices[0]), '提示必须说明当前是只读快照：' + notices[0]);
      assert.ok(/顶部横幅|重新尝试保存/.test(notices[0]), '提示必须指向恢复写入的入口：' + notices[0]);
    } finally {
      _storageHealth.readOnlyFallback = false;
    }
    assert.strictEqual(blockGenerationDuringStorageReadOnly(), false, '恢复写入后不得继续拦截发送');
  `);
  console.log('webview transport, stop, retry, labelled bodies, [DONE] and read-only refusal hold');
});
