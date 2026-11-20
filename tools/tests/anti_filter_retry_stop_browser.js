'use strict';

// End-to-end checks on the loaded app for the empty default model, Gemini stop-hang recovery,
// first-output timeout, 3x backoff retry, anti-filter context/output tool transport (OpenAI + Gemini,
// streaming + non-streaming), boundary marker stripping, and opt-in single auto-continuation on truncation.
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {

  await scenario('默认模型与设置开关显隐保存', `
    await reset({visible: true});
    setGenerationState('idle');
    assert.strictEqual(makeDefaultProvider().model, '', '默认供应商不预填模型');
    let modelFetches = 0;
    const realFetch = window.fetch;
    window.fetch = async () => { modelFetches++; throw new Error('不应发出请求'); };
    D.settings.providers[0].model = '';
    await assert.rejects(callDeepSeek([{role: 'user', content: 'hi'}], null, {route: 'chat'}), /选择模型/);
    assert.strictEqual(modelFetches, 0, '未选模型时不得发出请求');
    window.fetch = realFetch;
    D.settings.providers[0].model = 'test-model';
    assert.strictEqual(D.settings.autoContinueOnTruncation, undefined, '截断后自动补写默认关闭且不污染旧设置');
    loadSettingsForm();
    const panel = document.getElementById('s-provider-antifilter-panel');
    assert.strictEqual(panel.hidden, false, 'OpenAI 兼容供应商应显示防过滤开关');
    document.getElementById('s-context-in-tool').checked = true;
    document.getElementById('s-tool-output-channel').checked = true;
    document.getElementById('s-auto-continue-truncation').checked = true;
    await saveSettings();
    assert.strictEqual(D.settings.providers[0].contextInToolDescription, true);
    assert.strictEqual(D.settings.providers[0].toolOutputChannel, true);
    assert.strictEqual(D.settings.autoContinueOnTruncation, true);
    assert.strictEqual(resolveApiRoute('chat').contextInToolDescription, true);
    assert.strictEqual(resolveApiRoute('chat').toolOutputChannel, true);

    document.getElementById('s-provider-protocol').value = 'anthropic';
    changeProviderProtocol();
    assert.strictEqual(panel.hidden, true, 'Anthropic 协议应隐藏防过滤开关');
    document.getElementById('s-provider-protocol').value = 'gemini';
    changeProviderProtocol();
    assert.strictEqual(panel.hidden, false, 'Gemini 协议应显示防过滤开关');
    document.getElementById('s-context-in-tool').checked = true;
    document.getElementById('s-tool-output-channel').checked = true;
    await saveSettings();
    assert.strictEqual(resolveApiRoute('chat').protocol, 'gemini');
    assert.strictEqual(resolveApiRoute('chat').contextInToolDescription, true);
    assert.strictEqual(resolveApiRoute('chat').toolOutputChannel, true);
    discardProviderDraft();
  `);

  await scenario('Gemini 原生流挂起时点停止及时回到可发送状态', `
    const {session} = await reset({visible: true});
    Object.assign(D.settings.providers[0], {protocol: 'gemini', model: 'gemini-2.5-flash'});
    let enteredRead = null;
    const ready = new Promise(resolve => { enteredRead = resolve; });
    window.fetch = async () => new Response(new ReadableStream({
      pull() {
        enteredRead();
        return new Promise(() => {});
      },
      // Simulate a stalled upstream socket whose cancel() also never resolves.
      cancel() {
        return new Promise(() => {});
      },
    }), {status: 200, headers: {'content-type': 'text/event-stream'}});
    setGenerationState('idle');
    session.msgs = [{role: 'user', seq: 1, content: '测试挂起停止', time: 1}];
    const pending = regenerateLast();
    await ready;
    const startedStop = Date.now();
    stopGeneration();
    const ok = await pending;
    assert.strictEqual(ok, false);
    assert.strictEqual(_generationState, 'idle', '停止挂起的 Gemini 原生流后必须回到 idle');
    assert.strictEqual(document.getElementById('composer-action-btn').disabled, false, '停止后发送按钮必须恢复可点');
    assert.ok(Date.now() - startedStop < 2000, '停止不得被挂起的流长期卡住');
  `);

  await scenario('Gemini 首次无输出超时并进入自动重发，有思考则不超时', `
    const {session, target} = await reset({visible: true});
    Object.assign(D.settings.providers[0], {protocol: 'gemini', model: 'gemini-2.5-flash'});
    const prevTimeout = GEMINI_FIRST_OUTPUT_TIMEOUT_MS;
    const prevDelays = GENERATION_RETRY_DELAYS_MS;
    GEMINI_FIRST_OUTPUT_TIMEOUT_MS = 80;
    GENERATION_RETRY_DELAYS_MS = [10, 20, 40];
    try {
      let calls = 0;
      window.fetch = async () => {
        calls++;
        if (calls === 1) {
          return new Response(new ReadableStream({pull() { return new Promise(() => {}); }}), {
            status: 200, headers: {'content-type': 'text/event-stream'},
          });
        }
        return body([
          sse({candidates: [{content: {parts: [{text: '先思考一下', thought: true}]}}]}),
          sse({candidates: [{content: {parts: [{text: '超时重发后成功'}]}, finishReason: 'STOP'}]}),
        ]);
      };
      setGenerationState('preparing');
      await doAPICall({target});
      assert.strictEqual(calls, 2, '首次无输出超时后必须自动重发');
      assert.strictEqual(session.msgs[session.msgs.length - 1].content, '超时重发后成功');

      // Receiving thought before timeout cancels the first-output timeout even if body text arrives later.
      const {session: session2, target: target2} = await reset({visible: true});
      Object.assign(D.settings.providers[0], {protocol: 'gemini', model: 'gemini-2.5-flash'});
      let calls2 = 0;
      window.fetch = async () => {
        calls2++;
        let step = 0;
        return new Response(new ReadableStream({
          async pull(controller) {
            step++;
            if (step === 1) {
              controller.enqueue(sse({candidates: [{content: {parts: [{text: '思考中', thought: true}]}}]}));
              return;
            }
            if (step === 2) {
              await new Promise(r => setTimeout(r, 140));
              controller.enqueue(sse({candidates: [{content: {parts: [{text: '慢吐正文'}]}, finishReason: 'STOP'}]}));
              controller.close();
            }
          },
        }), {status: 200, headers: {'content-type': 'text/event-stream'}});
      };
      setGenerationState('preparing');
      await doAPICall({target: target2});
      assert.strictEqual(calls2, 1, '已收到思考内容时不得因首次无输出超时而重发');
      assert.strictEqual(session2.msgs[session2.msgs.length - 1].content, '慢吐正文');
    } finally {
      GEMINI_FIRST_OUTPUT_TIMEOUT_MS = prevTimeout;
      GENERATION_RETRY_DELAYS_MS = prevDelays;
    }
  `);

  await scenario('429/503/断连最多重发 3 次、间隔递增、停止取消重发', `
    const {target} = await reset();
    const prevDelays = GENERATION_RETRY_DELAYS_MS;
    GENERATION_RETRY_DELAYS_MS = [20, 45, 90];
    try {
      const timestamps = [];
      let attempts = 0;
      window.fetch = async () => {
        timestamps.push(Date.now());
        attempts++;
        if (attempts === 1) return new Response('{"error":{"message":"rate limit"}}', {status: 429});
        if (attempts === 2) return new Response('{"error":{"message":"service unavailable"}}', {status: 503});
        if (attempts === 3) throw new TypeError('Failed to fetch');
        return body([chunk('第 4 次成功'), done]);
      };
      setGenerationState('preparing');
      const res = await requestGenerationWithRetry([{role: 'user', content: 'hi'}], target, {route: 'chat', deferCommit: true});
      assert.strictEqual(attempts, 4, '应允许首次 + 3 次重试');
      assert.strictEqual(res.content, '第 4 次成功');
      assert.ok(timestamps[2] - timestamps[1] >= timestamps[1] - timestamps[0] - 10, '重试间隔应递增');

      // Exhausting 3 retries surfaces original error.
      let failAttempts = 0;
      window.fetch = async () => {
        failAttempts++;
        return new Response('{"error":{"message":"too many requests"}}', {status: 429});
      };
      setGenerationState('preparing');
      await assert.rejects(
        () => requestGenerationWithRetry([{role: 'user', content: 'hi'}], target, {route: 'chat', deferCommit: true}),
        /too many requests/
      );
      assert.strictEqual(failAttempts, 4, '耗尽 3 次重试共发 4 次请求并保留原错误');

      // Stopping during backoff cancels immediately without sending another request.
      GENERATION_RETRY_DELAYS_MS = [5000, 10000, 20000];
      let stopAttempts = 0;
      window.fetch = async () => {
        stopAttempts++;
        setTimeout(() => stopGeneration(), 25);
        return new Response('{"error":{"message":"busy"}}', {status: 503});
      };
      setGenerationState('preparing');
      await assert.rejects(
        () => requestGenerationWithRetry([{role: 'user', content: 'hi'}], target, {route: 'chat', deferCommit: true}),
        /已取消/
      );
      assert.strictEqual(stopAttempts, 1, '退避等待期间点停止不得继续重发');
    } finally {
      GENERATION_RETRY_DELAYS_MS = prevDelays;
    }
  `);

  await scenario('边界标记无论开关都不漏给模型，且藏上下文对 OpenAI 与 Gemini 生效', `
    const begin = '[[WAVE_CONTEXT_BEGIN_07_8d2c91]]';
    const end = '[[WAVE_CONTEXT_END_07_8d2c91]]';
    const markedInput = [
      {role: 'system', content: '写作框架要求'},
      {role: 'system', content: begin},
      {role: 'system', content: '角色设定与世界书'},
      {role: 'assistant', content: '上一轮角色回复'},
      {role: 'user', content: '最新用户输入'},
      {role: 'system', content: end},
      {role: 'system', content: '收尾格式要求'},
    ];
    const originalSnapshot = JSON.stringify(markedInput);

    // 1. Toggle OFF: markers must be stripped, no tools sent.
    let {target} = await reset();
    let captured = null;
    window.fetch = async (_url, options) => {
      captured = JSON.parse(options.body);
      return body([chunk('正常回包'), done]);
    };
    setGenerationState('preparing');
    await callDeepSeek(markedInput, target, {route: 'chat', deferCommit: true});
    assert.strictEqual(JSON.stringify(markedInput), originalSnapshot, '不得修改原始消息副本');
    assert.strictEqual(captured.tools, undefined, '开关关闭时不得发送 tools');
    assert.ok(!JSON.stringify(captured.messages).includes(begin) && !JSON.stringify(captured.messages).includes(end),
      '开关关闭时边界标记也不得以原文发给模型');

    // 2. Toggle ON (marked + unmarked) for both OpenAI and Gemini.
    for (const protocol of ['openai', 'gemini']) {
      ({target} = await reset());
      Object.assign(D.settings.providers[0], {
        protocol,
        model: protocol === 'gemini' ? 'gemini-2.5-flash' : 'gpt-test',
        contextInToolDescription: true,
        toolOutputChannel: false,
      });
      const sentBodies = [];
      window.fetch = async (_url, options) => {
        sentBodies.push(JSON.parse(options.body));
        return protocol === 'gemini'
          ? body([sse({candidates: [{content: {parts: [{text: 'ok'}]}, finishReason: 'STOP'}]})])
          : body([chunk('ok'), done]);
      };
      setGenerationState('preparing');
      await callDeepSeek(markedInput, target, {route: 'chat', deferCommit: true});
      const markedBody = sentBodies[0];
      assert.ok(!JSON.stringify(markedBody).includes(begin) && !JSON.stringify(markedBody).includes(end),
        protocol + ' 开启藏上下文时边界标记同样不得发给模型');
      const markedTool = protocol === 'gemini'
        ? markedBody.tools[0].functionDeclarations[0]
        : markedBody.tools[0].function;
      assert.strictEqual(markedTool.name, 'wave_context_reference');
      assert.ok(markedTool.description.includes('角色设定与世界书') && markedTool.description.includes('上一轮角色回复'));
      const outerMarked = JSON.stringify(protocol === 'gemini' ? markedBody.contents : markedBody.messages);
      assert.ok(outerMarked.includes('最新用户输入'), protocol + ' 外层消息必须保留最后一条用户输入');
      assert.ok(!outerMarked.includes('角色设定与世界书'), protocol + ' 资料不应重复留在外层消息');

      // Unmarked messages.
      const unmarkedInput = [
        {role: 'system', content: '基础人设资料'},
        {role: 'user', content: '第一轮问题'},
        {role: 'assistant', content: '第一轮回答'},
        {role: 'user', content: '最新真实发言'},
      ];
      setGenerationState('preparing');
      await callDeepSeek(unmarkedInput, target, {route: 'chat', deferCommit: true});
      const unmarkedBody = sentBodies[1];
      const unmarkedTool = protocol === 'gemini'
        ? unmarkedBody.tools[0].functionDeclarations[0]
        : unmarkedBody.tools[0].function;
      assert.strictEqual(unmarkedTool.name, 'context_reference');
      assert.ok(unmarkedTool.description.includes('基础人设资料') && unmarkedTool.description.includes('第一轮回答'));
      const outerUnmarked = JSON.stringify(protocol === 'gemini' ? unmarkedBody.contents : unmarkedBody.messages);
      assert.ok(outerUnmarked.includes('最新真实发言'), protocol + ' 无标记时外层消息必须保留最后一条用户输入');
      assert.ok(!outerUnmarked.includes('基础人设资料'), protocol + ' 无标记时前置资料应移入工具说明');
    }
  `);

  await scenario('输出通道：OpenAI 与 Gemini 流式/非流式还原与普通正文回退', `
    // OpenAI streaming + non-streaming + fallback plain text
    for (const streamOutput of [true, false]) {
      const {target} = await reset();
      D.settings.streamOutput = streamOutput;
      Object.assign(D.settings.providers[0], {protocol: 'openai', model: 'gpt-test', toolOutputChannel: true});
      let sentBody = null;
      window.fetch = async (_url, options) => {
        sentBody = JSON.parse(options.body);
        if (streamOutput) {
          const fullArgs = JSON.stringify({content: '流式\\n"正文"中文'});
          return body([
            sse({choices: [{delta: {tool_calls: [{index: 0, id: 'c1', type: 'function', function: {name: 'deliver_reply', arguments: fullArgs.slice(0, 6)}}]}}]}),
            sse({choices: [{delta: {tool_calls: [{index: 0, function: {arguments: fullArgs.slice(6, 17)}}]}}]}),
            sse({choices: [{delta: {tool_calls: [{index: 0, function: {arguments: fullArgs.slice(17)}}]}, finish_reason: 'tool_calls'}]}),
            done,
          ]);
        }
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: null,
              tool_calls: [{id: 'c1', type: 'function', function: {name: 'deliver_reply', arguments: '{"content":"非流式正文"}'}}],
            },
            finish_reason: 'tool_calls',
          }],
        }), {headers: {'content-type': 'application/json'}});
      };
      setGenerationState('preparing');
      const result = await callDeepSeek([{role: 'user', content: '写一段'}], target, {route: 'chat', deferCommit: true});
      assert.strictEqual(sentBody.tool_choice, 'auto');
      assert.strictEqual(result.content, streamOutput ? '流式\\n"正文"中文' : '非流式正文');
      assert.strictEqual(result.finishReason, 'stop', '输出通道 tool_calls 结束应映射为 stop');
    }

    // Gemini streaming (partialArgs + full args) & non-streaming & plain-text fallback
    for (const mode of ['stream-partial', 'stream-args', 'non-stream', 'fallback-plain']) {
      const {target} = await reset();
      D.settings.streamOutput = mode !== 'non-stream';
      Object.assign(D.settings.providers[0], {protocol: 'gemini', model: 'gemini-2.5-flash', toolOutputChannel: true});
      let sentBody = null;
      window.fetch = async (_url, options) => {
        sentBody = JSON.parse(options.body);
        if (mode === 'stream-partial') {
          return body([
            sse({candidates: [{content: {parts: [{functionCall: {name: 'deliver_reply', partialArgs: [{jsonPath: '$.content', stringValue: '分块'}], willContinue: true}}]}}]}),
            sse({candidates: [{content: {parts: [{functionCall: {partialArgs: [{jsonPath: '$.content', stringValue: '还原正文'}], willContinue: false}}]}, finishReason: 'STOP'}]}),
          ]);
        }
        if (mode === 'stream-args') {
          return body([
            sse({candidates: [{content: {parts: [{functionCall: {name: 'deliver_reply', args: {content: '整包函数正文'}}}]}, finishReason: 'STOP'}]}),
          ]);
        }
        if (mode === 'non-stream') {
          return new Response(JSON.stringify({
            candidates: [{content: {parts: [{functionCall: {name: 'deliver_reply', args: {content: 'Gemini非流式'}}}]}, finishReason: 'STOP'}],
          }), {headers: {'content-type': 'application/json'}});
        }
        return body([
          sse({candidates: [{content: {parts: [{text: '模型未调工具直接回正文'}]}, finishReason: 'STOP'}]}),
        ]);
      };
      setGenerationState('preparing');
      const result = await callDeepSeek([{role: 'user', content: '写一段'}], target, {route: 'chat', deferCommit: true});
      assert.strictEqual(sentBody.toolConfig, undefined, '不得下发 allowedFunctionNames 屏蔽其他工具');
      const expected = {
        'stream-partial': '分块还原正文',
        'stream-args': '整包函数正文',
        'non-stream': 'Gemini非流式',
        'fallback-plain': '模型未调工具直接回正文',
      }[mode];
      assert.strictEqual(result.content, expected, mode + ' 正文还原必须准确');
      assert.strictEqual(result.finishReason, 'stop');
    }
  `);

  await scenario('双开关共存、误调资料工具保底与 OpenAI 长资料拆分', `
    // 1. Both switches ON for OpenAI and Gemini: context tool + deliver_reply visible, no allowedFunctionNames.
    for (const protocol of ['openai', 'gemini']) {
      const {target} = await reset();
      Object.assign(D.settings.providers[0], {
        protocol,
        model: protocol === 'gemini' ? 'gemini-2.5-flash' : 'gpt-test',
        contextInToolDescription: true,
        toolOutputChannel: true,
      });
      let sentBody = null;
      window.fetch = async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return protocol === 'gemini'
          ? body([sse({candidates: [{content: {parts: [{functionCall: {name: 'deliver_reply', args: {content: '双开成功'}}}]}, finishReason: 'STOP'}]})])
          : body([sse({choices: [{delta: {tool_calls: [{index: 0, id: 'c1', type: 'function', function: {name: 'deliver_reply', arguments: '{"content":"双开成功"}'}}]}, finish_reason: 'tool_calls'}]}), done]);
      };
      setGenerationState('preparing');
      const result = await callDeepSeek([
        {role: 'system', content: '角色核心设定'},
        {role: 'user', content: '上一轮问题'},
        {role: 'assistant', content: '上一轮回答'},
        {role: 'user', content: '本轮最新请求'},
      ], target, {route: 'chat', deferCommit: true});
      assert.strictEqual(result.content, '双开成功', protocol);
      if (protocol === 'gemini') {
        const names = sentBody.tools[0].functionDeclarations.map(d => d.name);
        assert.deepStrictEqual(names, ['context_reference', 'deliver_reply']);
        assert.strictEqual(sentBody.toolConfig, undefined);
      } else {
        const names = sentBody.tools.map(t => t.function.name);
        assert.deepStrictEqual(names, ['context_reference', 'deliver_reply']);
        assert.strictEqual(sentBody.tool_choice, 'auto');
      }
    }

    // 2. Model mistakenly delivers text via context tool (streaming + non-streaming) -> text preserved.
    for (const streamOutput of [true, false]) {
      const {target} = await reset();
      D.settings.streamOutput = streamOutput;
      Object.assign(D.settings.providers[0], {
        protocol: 'gemini',
        model: 'gemini-2.5-flash',
        contextInToolDescription: true,
        toolOutputChannel: true,
      });
      window.fetch = async () => streamOutput
        ? body([
            sse({candidates: [{content: {parts: [{functionCall: {name: 'context_reference', partialArgs: [{jsonPath: '$.text', stringValue: '误调资料工具'}], willContinue: true}}]}}]}),
            sse({candidates: [{content: {parts: [{functionCall: {partialArgs: [{jsonPath: '$.text', stringValue: '也要还原'}], willContinue: false}}]}, finishReason: 'STOP'}]}),
          ])
        : new Response(JSON.stringify({
            candidates: [{content: {parts: [{functionCall: {name: 'context_reference', args: {content: '非流式误调保底'}}}]}, finishReason: 'STOP'}],
          }), {headers: {'content-type': 'application/json'}});
      setGenerationState('preparing');
      const result = await callDeepSeek([
        {role: 'system', content: '设定资料'},
        {role: 'user', content: '开始'},
      ], target, {route: 'chat', deferCommit: true});
      assert.strictEqual(result.content, streamOutput ? '误调资料工具也要还原' : '非流式误调保底');
    }

    // 3. Model makes empty context tool calls (acknowledged: true / "true") -> automatically retried and succeeds.
    const prevDelays = GENERATION_RETRY_DELAYS_MS;
    GENERATION_RETRY_DELAYS_MS = [10, 20, 40];
    try {
      const {session, target} = await reset({visible: true});
      Object.assign(D.settings.providers[0], {
        protocol: 'gemini',
        model: 'gemini-2.5-flash',
        contextInToolDescription: true,
        toolOutputChannel: true,
      });
      let calls = 0;
      window.fetch = async () => {
        calls++;
        if (calls === 1) {
          return body([
            sse({candidates: [{content: {parts: [{functionCall: {name: 'context_reference', args: {acknowledged: true}}}]}, finishReason: 'STOP'}]}),
          ]);
        }
        if (calls === 2) {
          return body([
            sse({candidates: [{content: {parts: [{functionCall: {name: 'context_reference', args: {acknowledged: 'true'}}}]}, finishReason: 'STOP'}]}),
          ]);
        }
        return body([
          sse({candidates: [{content: {parts: [{functionCall: {name: 'deliver_reply', args: {content: '重试后交回正文'}}}]}, finishReason: 'STOP'}]}),
        ]);
      };
      setGenerationState('preparing');
      await doAPICall({target});
      assert.strictEqual(calls, 3, '只调用资料空参数（布尔或字符串确认词）未交正文时应自动重试');
      assert.strictEqual(session.msgs[session.msgs.length - 1].content, '重试后交回正文');
    } finally {
      GENERATION_RETRY_DELAYS_MS = prevDelays;
    }

    // 4. OpenAI long context (~30k chars with markers) splits in order <= 2400 chars per tool; Gemini stays single.
    const sections = [];
    for (let offset = 0; offset < 30000; offset += 500) {
      sections.push('[POS_' + String(offset).padStart(5, '0') + '] ' + '故事设定与前情内容'.repeat(55));
    }
    const longContext = sections.join('\\n');
    const longInput = [
      {role: 'system', content: '[[WAVE_CONTEXT_BEGIN_07_8d2c91]]'},
      {role: 'system', content: longContext},
      {role: 'assistant', content: '旧回复结尾片段'},
      {role: 'system', content: '[[WAVE_CONTEXT_END_07_8d2c91]]'},
      {role: 'user', content: '请报出首尾标记'},
    ];
    for (const protocol of ['openai', 'gemini']) {
      const {target} = await reset();
      Object.assign(D.settings.providers[0], {
        protocol,
        model: protocol === 'gemini' ? 'gemini-2.5-flash' : 'gpt-test',
        contextInToolDescription: true,
        toolOutputChannel: true,
      });
      let sentBody = null;
      window.fetch = async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return protocol === 'gemini'
          ? body([sse({candidates: [{content: {parts: [{functionCall: {name: 'deliver_reply', args: {content: 'ok'}}}]}, finishReason: 'STOP'}]})])
          : body([sse({choices: [{delta: {tool_calls: [{index: 0, id: 'c1', type: 'function', function: {name: 'deliver_reply', arguments: '{"content":"ok"}'}}]}, finish_reason: 'tool_calls'}]}), done]);
      };
      setGenerationState('preparing');
      await callDeepSeek(longInput, target, {route: 'chat', deferCommit: true});
      if (protocol === 'openai') {
        const ctxTools = sentBody.tools.filter(t => t.function.name.startsWith('wave_context_reference'));
        assert.ok(ctxTools.length > 10, '3万字长资料在 OpenAI 应拆成多个工具: ' + ctxTools.length);
        ctxTools.forEach((t, idx) => {
          assert.strictEqual(t.function.name, 'wave_context_reference_' + (idx + 1));
          assert.ok(t.function.description.length <= 2400, '每段说明不得超过 2400 字: ' + t.function.description.length);
        });
        const rebuilt = ctxTools.flatMap(t => {
          const jsonPart = t.function.description.slice(t.function.description.indexOf('['));
          return JSON.parse(jsonPart).map(row => row.content);
        }).join('');
        assert.strictEqual(rebuilt, longContext + '旧回复结尾片段', '拆分后拼接必须与原资料逐字一致');
        const msgText = JSON.stringify(sentBody.messages);
        assert.ok(msgText.includes('wave_context_reference_1') && msgText.includes('wave_context_reference_' + ctxTools.length));
        assert.strictEqual(sentBody.tools[sentBody.tools.length - 1].function.name, 'deliver_reply');
        assert.strictEqual(sentBody.tool_choice, 'auto');
      } else {
        const decls = sentBody.tools[0].functionDeclarations;
        assert.strictEqual(decls.length, 2);
        assert.strictEqual(decls[0].name, 'wave_context_reference');
        assert.ok(decls[0].description.length > 30000);
        assert.strictEqual(decls[1].name, 'deliver_reply');
        assert.strictEqual(sentBody.toolConfig, undefined);
      }
    }
  `);

  await scenario('截断后自动补写一次（过滤/长度/流中断），每轮至多一次，失败保底', `
    // 1. Filter truncation -> auto continue once and merge
    let {session, target} = await reset({visible: true});
    D.settings.autoContinueOnTruncation = true;
    let fetches = 0;
    window.fetch = async () => {
      fetches++;
      if (fetches === 1) return body([sse({choices: [{delta: {content: '前半段截断'}, finish_reason: 'content_filter'}]}), done]);
      return body([sse({choices: [{delta: {content: '，后半段补齐。'}, finish_reason: 'length'}]}), done]);
    };
    setGenerationState('preparing');
    await doAPICall({target});
    assert.strictEqual(fetches, 2, '开启开关后过滤截断只自动补写一次，哪怕补写也达上限不再循环');
    assert.strictEqual(session.msgs[session.msgs.length - 1].content, '前半段截断，后半段补齐。');

    // 2. Stream interruption with partial content -> auto continue once and recover cleanly
    ({session, target} = await reset({visible: true}));
    D.settings.autoContinueOnTruncation = true;
    fetches = 0;
    window.fetch = async () => {
      fetches++;
      if (fetches === 1) return body([chunk('断流前半段'), new TypeError('socket closed')]);
      return body([chunk('接续后半段。'), done]);
    };
    setGenerationState('preparing');
    await doAPICall({target});
    assert.strictEqual(fetches, 2, '流中断且有正文时应自动补写一次');
    assert.strictEqual(session.msgs[session.msgs.length - 1].content, '断流前半段接续后半段。');

    // 3. Continuation refused -> keep first half without losing content
    ({session, target} = await reset({visible: true}));
    D.settings.autoContinueOnTruncation = true;
    fetches = 0;
    window.fetch = async () => {
      fetches++;
      if (fetches === 1) return body([sse({choices: [{delta: {content: '保底前半段'}, finish_reason: 'length'}]}), done]);
      return body([sse({choices: [{delta: {refusal: 'refused'}}]}), sse({choices: [{delta: {}, finish_reason: 'stop'}]}), done]);
    };
    setGenerationState('preparing');
    await doAPICall({target});
    assert.strictEqual(fetches, 2);
    assert.strictEqual(session.msgs[session.msgs.length - 1].content, '保底前半段', '自动补写被拒时必须完整保留前半段');
    assert.strictEqual(session.msgs[session.msgs.length - 1].generationMeta.outputLimitReached, true);
  `);


  await scenario('OpenAI 兼容流的提前 EOF、正常结束与业务错误', `
    for (const kind of ['eof-on', 'eof-off', 'done', 'finish', 'json', 'empty', 'thinking', 'status', 'nested', 'code']) {
      const {session, target} = await reset({visible: true});
      D.settings.autoContinueOnTruncation = kind !== 'eof-off';
      let calls = 0;
      const status = {status: 400, nested: 401, code: 403}[kind];
      window.fetch = async () => {
        if (++calls === 2) return body([chunk('beta'), done]);
        if (status) {
          const frame = {error: {message: 'denied'}};
          if (kind === 'status') frame.status = status;
          else if (kind === 'nested') frame.error.status = status;
          else Object.assign(frame.error, {status: 'PERMISSION_DENIED', code: status});
          return body([chunk('alpha'), sse(frame)]);
        }
        if (kind === 'empty') return body([sse({choices: [{delta: {role: 'assistant'}}]})]);
        if (kind === 'thinking') return body([sse({choices: [{delta: {reasoning_content: 'thinking'}}]})]);
        if (kind === 'done') return body([chunk('alpha'), done]);
        if (kind === 'finish') return body([sse({choices: [{delta: {content: 'alpha'}, finish_reason: 'stop'}]})]);
        if (kind === 'json') return new Response(JSON.stringify({choices: [{message: {content: 'alpha'}}]}));
        return body([chunk('alpha')]);
      };
      const error = await failure(() => doAPICall({target})), reply = session.msgs.at(-1);
      assert.strictEqual(calls, ['eof-on', 'empty'].includes(kind) ? 2 : 1, kind);
      if (kind === 'thinking') {
        assert.strictEqual(error?.interruptionReason, 'network_interrupted');
        assert.strictEqual(reply.role, 'user');
        continue;
      }
      assert.strictEqual(reply.content, kind === 'eof-on' ? 'alphabeta' : kind === 'empty' ? 'beta' : 'alpha', kind);
      if (status || kind === 'eof-off') {
        assert.strictEqual(reply.generationMeta.incomplete, true, kind);
        assert.strictEqual(reply.generationMeta.interruptionReason, status ? 'provider_error' : 'network_interrupted', kind);
        assert.strictEqual(error?.autoSavedIncomplete, true);
        if (status) {
          assert.strictEqual(error.status, status);
          assert.strictEqual(reply.generationMeta.interruptionStatus, status);
          assert.ok(reply.generationMeta.interruptionDetail.includes('denied'));
        }
      } else assert.strictEqual(error, null, kind);
      assert.strictEqual((await storedDrafts()).length, 0);
    }
  `);

  await scenario('补写只按协议拒答，恢复首段与草稿', `
    for (const kind of ['finish', 'delta', 'json', 'anthropic', 'gemini', 'interrupted', 'ordinary']) {
      const {session, target} = await reset({visible: true});
      D.settings.autoContinueOnTruncation = true;
      if (kind === 'gemini' || kind === 'anthropic') D.settings.providers[0].protocol = kind;
      let calls = 0;
      document.getElementById('toasts').replaceChildren();
      window.fetch = async () => {
        const first = ++calls === 1;
        if (kind === 'anthropic') return body([
          sse({type: 'content_block_delta', delta: {type: 'text_delta', text: first ? 'alpha' : 'I decline'}}),
          sse({type: 'message_delta', delta: {stop_reason: first ? 'max_tokens' : 'refusal'}})]);
        if (kind === 'gemini') return body([sse({candidates: [{content: {parts: [{text: first ? 'alpha' : 'I decline'}]},
          finishReason: first ? 'MAX_TOKENS' : 'REFUSAL'}]})]);
        if (first) return kind === 'interrupted' ? body([chunk('alpha')])
          : body([sse({choices: [{delta: {content: 'alpha'}, finish_reason: 'length'}]})]);
        if (kind === 'json') return new Response(JSON.stringify({choices: [{message: {content: 'I decline', refusal: 'explicit'}, finish_reason: 'stop'}]}));
        if (kind === 'delta') return body([chunk('I decline'), sse({choices: [{delta: {refusal: 'explicit'}}]}),
          sse({choices: [{delta: {}, finish_reason: 'stop'}]}), done]);
        return body([chunk('I decline'), sse({choices: [{delta: {}, finish_reason: kind === 'ordinary' ? 'stop' : 'refusal'}]}), done]);
      };
      const error = await failure(() => doAPICall({target}));
      const reply = session.msgs.at(-1);
      assert.strictEqual(calls, 2);
      assert.strictEqual(reply.content, kind === 'ordinary' ? 'alphaI decline' : 'alpha', kind);
      assert.strictEqual(document.getElementById('toasts').textContent.includes('自动补写被模型拒绝'), kind !== 'ordinary', kind);
      if (kind === 'interrupted') {
        assert.strictEqual(error?.interruptionReason, 'network_interrupted');
        assert.strictEqual(reply.generationMeta.incomplete, true);
      } else {
        assert.strictEqual(error, null, kind);
        if (kind !== 'ordinary') assert.strictEqual(reply.generationMeta.outputLimitReached, true, kind);
      }
      assert.strictEqual(_activeStreamDraft, null, kind);
      assert.strictEqual((await storedDrafts()).length, 0, kind);
    }
  `);

  await scenario('手动继续的补写、实时画面、草稿与慢事件', `
    for (const kind of ['manual', 'manual-eof', 'refusal', 'failed', 'cancelled', 'new-prefix', 'whole', 'first-whole']) {
      const {session} = await reset({visible: true});
      const manual = !['new-prefix', 'first-whole'].includes(kind);
      if (manual) {
        session.msgs.push({role: 'assistant', content: 'orig', seq: session.nextMessageSeq++});
        D.settings.chatCompletionPresetInUse = cloneData(activeCompletionPresetRaw());
        D.settings.chatCompletionPresetInUse.continue_nudge_prompt = '  original marker: {{lastChatMessage}}  ';
        D.settings.chatCompletionPresetInUse.continue_prefill = kind === 'manual-eof';
      }
      else D.settings.startReplyWith = 'prefix:';
      D.settings.autoContinueOnTruncation = true;
      renderChat();
      setGenerationState('idle');
      const requests = [], trace = [], owner = {kind: 'library'}, events = CARD_FRONTEND_TAVERN_EVENT_VALUES;
      let painted, checkpoint;
      if (kind === 'manual') cardFrontendRegisterEvent(owner, events.CHAT_COMPLETION_PROMPT_READY, data => {
        data.chat.push({role: 'system', content: 'script tail'});
      }, false);
      cardFrontendRegisterEvent(owner, events.STREAM_TOKEN_RECEIVED, async text => {
        trace.push('start:' + text);
        await wait(180);
        trace.push('end:' + text);
      }, false);
      cardFrontendRegisterEvent(owner, events.MESSAGE_RECEIVED, () => trace.push('message'), false);
      window.fetch = async (_url, init) => {
        requests.push(JSON.parse(init.body));
        if (requests.length === 1) {
          if (kind === 'manual-eof') return body([chunk('part1')]);
          if (kind === 'first-whole') return new Response(JSON.stringify({choices: [{message: {content: 'part1'}, finish_reason: 'length'}]}));
          return body([sse({choices: [{delta: {content: 'part1'}, finish_reason: 'length'}]})]);
        }
        if (kind === 'whole') return new Response(JSON.stringify({choices: [{message: {content: 'part2'}, finish_reason: 'stop'}]}));
        if (kind === 'refusal') return body([sse({choices: [{delta: {content: 'I decline'}, finish_reason: 'refusal'}]}), done]);
        const steps = [chunk('part2'), {delay: 300}, () => {
          painted = document.querySelector('.stream-active-bubble .stream-content-slot')?.textContent;
          checkpoint = _activeStreamDraft?.text;
        }];
        if (kind === 'cancelled') steps.push(() => stopGeneration(), new DOMException('stopped', 'AbortError'));
        else if (kind === 'failed') steps.push(new TypeError('socket closed'));
        else steps.push(done);
        return body(steps);
      };
      try {
        if (manual) await continueGeneration();
        else await regenerateLast();
        if (_generationPostCommitTasks.get(session)) await _generationPostCommitTasks.get(session);
        assert.strictEqual(requests.length, 2, kind);
        const reply = session.msgs.at(-1);
        const expected = (manual ? 'orig' : 'prefix:') + 'part1' + (kind === 'refusal' ? '' : 'part2');
        assert.strictEqual(reply.content, expected, kind);
        if (manual) {
          const rows = requests[1].messages;
          assert.ok(rows.some(row => row.role === 'assistant' && row.content === 'origpart1'), kind);
          assert.strictEqual(rows.filter(row => row.role === 'assistant' && row.content.includes('orig')).length, 1);
          const nudges = rows.filter(row => String(row.content).includes('original marker:'));
          assert.strictEqual(nudges.length, kind === 'manual-eof' ? 0 : 1, kind);
          if (nudges.length) assert.ok(nudges[0].content.includes('original marker: origpart1'), kind);
          if (kind === 'manual') assert.strictEqual(rows.at(-1).content, 'script tail');
          assert.strictEqual(session.msgs.length, 2);
        }
        if (!['whole', 'refusal'].includes(kind)) {
          assert.strictEqual(checkpoint, expected.slice(manual ? 4 : 0), kind);
          assert.ok(painted?.includes(expected), kind + ': ' + painted);
        }
        const texts = ['whole', 'refusal'].includes(kind) ? ['part1'] :
          kind === 'first-whole' ? ['part1part2'] : ['part1', 'part1part2'];
        assert.deepStrictEqual(trace, texts.flatMap(text => ['start:' + text, 'end:' + text]).concat('message'), kind);
        assert.strictEqual((await storedDrafts()).length, 0, kind);
      } finally { cardFrontendClearOwnerRegistrations(owner); }
    }
  `);

  await scenario('补写事件丢弃两帧拒答并保留正常段落衔接', `
    for (const kind of ['refusal', 'delayed-refusal', 'pending-boundary', 'paragraph']) {
      const {session, target} = await reset({visible: true});
      D.settings.autoContinueOnTruncation = true;
      const refused = kind !== 'paragraph', first = refused ? 'alpha' : '第一句。';
      const owner = {kind: 'library'}, events = CARD_FRONTEND_TAVERN_EVENT_VALUES, trace = [];
      let onFirstToken, releaseListener;
      const firstToken = new Promise(resolve => { onFirstToken = resolve; });
      const holdListener = new Promise(resolve => { releaseListener = resolve; });
      cardFrontendRegisterEvent(owner, events.STREAM_TOKEN_RECEIVED, async text => {
        trace.push(['start', text]);
        if (text === 'al') {
          onFirstToken();
          await holdListener;
        }
        await wait(150);
        trace.push(['end', text]);
      }, false);
      cardFrontendRegisterEvent(owner, events.MESSAGE_RECEIVED, () => trace.push(['message']), false);
      let calls = 0;
      window.fetch = async () => {
        if (++calls === 1) {
          if (kind === 'pending-boundary') return new Response(new ReadableStream({
            async start(controller) {
              controller.enqueue(chunk('al'));
              await firstToken;
              controller.enqueue(sse({choices: [{delta: {content: 'pha'}, finish_reason: 'length'}]}));
              controller.close();
            },
          }), {headers: {'content-type': 'text/event-stream'}});
          return body([sse({choices: [{delta: {content: first}, finish_reason: 'length'}]})]);
        }
        const steps = [chunk(refused ? 'I decline' : '第二句。')];
        if (kind === 'delayed-refusal') steps.push({delay: 350});
        steps.push(sse({choices: [{delta: {}, finish_reason: refused ? 'REFUSAL' : 'stop'}]}), done);
        return body(steps);
      };
      try {
        await doAPICall({target});
        releaseListener();
        await target.postCommitTask;
        const saved = session.msgs.at(-1);
        assert.strictEqual(calls, 2);
        assert.strictEqual(saved.content, refused ? first : '第一句。\\n\\n第二句。', kind);
        if (refused) assert.strictEqual(saved.generationMeta.outputLimitReached, true);
        const expected = [['start', first], ['end', first]];
        if (kind === 'pending-boundary') expected.unshift(['start', 'al'], ['end', 'al']);
        if (!refused) expected.push(['start', saved.content], ['end', saved.content]);
        assert.deepStrictEqual(trace, expected.concat([['message']]), kind);
      } finally { releaseListener(); cardFrontendClearOwnerRegistrations(owner); }
    }
  `);

  await scenario('预设页预计总量按实际发出的两种协议工具资料计算一次', `
    for (const protocol of ['openai', 'gemini']) {
      for (const [context, output] of [[false, false], [true, false], [false, true], [true, true]]) {
        const {char, target} = await reset({visible: true});
        const marker = 'A'.repeat(15000);
        char.description = marker;
        Object.assign(D.settings.providers[0], {protocol, contextInToolDescription: context, toolOutputChannel: output});
        setGenerationState('idle');
        switchAppPage('presets');
        switchCompletionPresetTab('order');
        if (_presetRoundPreviewExpanded) setPresetRoundPreviewExpanded(false);
        $('prompt-preview-toggle').click();
        await presetRoundPreviewShown();
        const shown = $('prompt-preview-box').textContent, stats = $('prompt-stats-box').textContent;
        const preview = await buildPresetRoundPreview();
        switchAppPage('chat');
        let sent;
        window.fetch = async (_url, init) => {
          sent = JSON.parse(init.body);
          return protocol === 'gemini' ? body([sse({candidates: [{content: {parts: [{text: 'ok'}]}, finishReason: 'STOP'}]})])
            : body([chunk('ok'), done]);
        };
        await doAPICall({target});
        const tools = preview.messages.filter(row => row.role === 'tools');
        assert.strictEqual(tools.length, context || output ? 1 : 0);
        if (tools.length) {
          assert.deepStrictEqual(JSON.parse(tools[0].content), sent.tools);
          assert.ok(shown.includes(JSON.stringify(sent.tools)));
        }
        if (protocol === 'openai' && context) {
          const ctxTools = sent.tools.filter(t => t.function.name.startsWith('context_reference_'));
          assert.ok(ctxTools.length > 1);
          const joined = ctxTools.flatMap(t => JSON.parse(t.function.description.slice(t.function.description.indexOf('['))).map(r => r.content)).join('');
          assert.strictEqual(joined.split(marker).length, 2, '拆分工具拼接后设定应恰好出现一次');
        } else {
          assert.strictEqual(shown.split(marker).length, 2, '设定应恰好显示一次');
        }
        const wire = protocol === 'openai' ? sent.messages.map(row => row.content) :
          [sent.systemInstruction?.parts, ...sent.contents.map(row => row.parts)].filter(Boolean);
        const expected = wire.reduce((sum, content) => sum + estTokens(presetRoundPreviewContent(content)) + 4, 0) +
          (sent.tools ? estTokens(JSON.stringify(sent.tools)) + 4 : 0);
        assert.ok(stats.includes('约 ' + expected + ' Token'), protocol + ': ' + stats + ' expected ' + expected);
        finishGeneration(target);
      }
    }
  `);

  await scenario('首个数据帧前提前关流进入重发，合法整包与明确空回复及停止保持原意', `
    const prevDelays = GENERATION_RETRY_DELAYS_MS;
    GENERATION_RETRY_DELAYS_MS = [10, 20, 40];
    try {
      for (const kind of ['immediate-eof', 'heartbeat-eof', 'heartbeat-mislabelled', 'whole-json-as-sse', 'whole-empty-as-sse', 'done-empty', 'finish-empty', 'stop-before-first-frame']) {
        const {session, target} = await reset({visible: true});
        let calls = 0;
        window.fetch = async () => {
          calls++;
          if (calls === 2) return body([chunk('重发成功'), done]);
          if (kind === 'immediate-eof') return body([], 'text/event-stream');
          if (kind === 'heartbeat-eof') return body([encoder.encode(': keep-alive\\n\\n')], 'text/event-stream');
          if (kind === 'heartbeat-mislabelled') return body([encoder.encode(': OPENROUTER PROCESSING\\n\\n')], 'application/json');
          if (kind === 'whole-json-as-sse') {
            return body([encoder.encode(JSON.stringify({choices: [{message: {content: '整包正文'}}]}))], 'text/event-stream');
          }
          if (kind === 'whole-empty-as-sse') {
            return body([encoder.encode(JSON.stringify({choices: [{message: {content: ''}}]}))], 'text/event-stream');
          }
          if (kind === 'done-empty') return body([done], 'text/event-stream');
          if (kind === 'finish-empty') return body([sse({choices: [{delta: {}, finish_reason: 'stop'}]})], 'text/event-stream');
          return body([encoder.encode(': keep-alive\\n\\n'), {delay: 15}, () => stopGeneration(), {delay: 500}], 'text/event-stream');
        };
        setGenerationState('preparing');
        const error = await failure(() => doAPICall({target}));
        const reply = session.msgs.at(-1);
        if (['immediate-eof', 'heartbeat-eof', 'heartbeat-mislabelled'].includes(kind)) {
          assert.strictEqual(error, null, kind);
          assert.strictEqual(calls, 2, kind + ' 应进入自动重发');
          assert.strictEqual(reply.content, '重发成功', kind);
        } else if (kind === 'whole-json-as-sse') {
          assert.strictEqual(error, null, kind);
          assert.strictEqual(calls, 1, kind + ' 合法整包 JSON 不得误判为断流重试');
          assert.strictEqual(reply.content, '整包正文', kind);
        } else if (kind === 'stop-before-first-frame') {
          assert.strictEqual(calls, 1, kind + ' 用户停止后不得重发');
          assert.ok(error && /已取消/.test(error.message), kind);
        } else {
          assert.strictEqual(calls, 1, kind + ' 明确空回复不得误判为断流重试');
          assert.ok(error && /API 返回空响应/.test(error.message), kind + ': ' + (error && error.message));
        }
      }
    } finally {
      GENERATION_RETRY_DELAYS_MS = prevDelays;
    }
  `);

  await scenario('补写途中遇到明确供应商错误按未完成保存并保留错误状态与说明', `
    for (const kind of ['length-sse-403', 'eof-sse-403', 'whole-http-403']) {
      const {session, target} = await reset({visible: true});
      D.settings.autoContinueOnTruncation = true;
      let calls = 0;
      window.fetch = async () => {
        calls++;
        if (calls === 1) {
          if (kind === 'eof-sse-403') return body([chunk('alpha')]);
          if (kind === 'whole-http-403') {
            return new Response(JSON.stringify({choices: [{message: {content: 'alpha'}, finish_reason: 'length'}]}), {
              headers: {'content-type': 'application/json'},
            });
          }
          return body([sse({choices: [{delta: {content: 'alpha'}, finish_reason: 'length'}]}), done]);
        }
        if (kind === 'whole-http-403') {
          return new Response(JSON.stringify({error: {message: 'denied by gateway'}}), {
            status: 403,
            headers: {'content-type': 'application/json'},
          });
        }
        return body([chunk('beta'), sse({error: {code: 403, message: 'denied by gateway'}})]);
      };
      setGenerationState('preparing');
      const error = await failure(() => doAPICall({target}));
      const reply = session.msgs.at(-1);
      assert.strictEqual(calls, 2, kind + ' 只应发首段与一次补写');
      assert.ok(error, kind + ' 补写遇 403 不得按成功返回');
      assert.strictEqual(error.status, 403, kind);
      assert.strictEqual(error.interruptionReason, 'provider_error', kind);
      assert.strictEqual(error.autoSavedIncomplete, true, kind);
      const expectedContent = kind === 'whole-http-403' ? 'alpha' : 'alphabeta';
      await flushPendingSave();
      const reloaded = (await YeyuRepository.load()).data.chats.c1.sessions[0];
      sanitizeLoadedAssistantMessages(reloaded);
      const persisted = reloaded.msgs.at(-1);
      for (const msg of [reply, persisted]) {
        assert.strictEqual(msg.content, expectedContent, kind);
        assert.strictEqual(msg.generationMeta.incomplete, true, kind);
        assert.strictEqual(msg.generationMeta.interruptionReason, 'provider_error', kind);
        assert.strictEqual(msg.generationMeta.interruptionStatus, 403, kind);
        assert.ok(msg.generationMeta.interruptionDetail.includes('denied by gateway'), kind);
        assert.strictEqual(msg.generationMeta.outputLimitReached, undefined, kind);
      }
      const badge = generationMetaHtml(persisted.generationMeta);
      assert.ok(badge.includes('HTTP 403') && badge.includes('denied by gateway'), kind + ': ' + badge);
      assert.strictEqual(_activeStreamDraft, null, kind);
      assert.strictEqual((await storedDrafts()).length, 0, kind);
    }
  `);

  console.log('anti-filter transport, timeout, 3x retry, stop recovery and auto-continuation hold');
});
