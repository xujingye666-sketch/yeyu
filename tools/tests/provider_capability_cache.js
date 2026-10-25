'use strict';

// Provider capability negotiation through the loaded app: what a provider rejects is remembered for the
// request only (never in the settings, never probed ahead), thinking-off is retried through the four
// dialects before failing visibly, and a rejected json_schema falls back to json_object in the transport.
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {

  await scenario('Gemini 仅在明确拒绝末尾 model 时补 user，旧模型续写不变', `
    await reset();
    for (const protocol of ['gemini', 'openai']) {
      for (const refuses of [true, false]) {
        const route = {...resolveApiRoute('chat'), protocol, model: refuses ? 'gemini-4-argon' : 'gemini-2.5-flash'};
        const messages = [{role: 'user', content: 'start'}, {role: 'assistant', content: 'PREFILL'}];
        const before = JSON.stringify(messages), calls = [];
        window.fetch = async (_url, options) => {
          const request = JSON.parse(options.body); calls.push(request);
          const turns = protocol === 'gemini' ? request.contents : request.messages;
          if (refuses && turns.at(-1).role === (protocol === 'gemini' ? 'model' : 'assistant'))
            return new Response(JSON.stringify({error: {message: 'Requests ending with a model turn are not supported.'}}), {status: 400});
          return new Response(JSON.stringify(protocol === 'gemini' ?
            {candidates: [{content: {parts: [{text: 'done'}]}, finishReason: 'STOP'}]} :
            {choices: [{message: {content: 'done'}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});
        };
        await fetchCompatibleCompletion(route, {model: route.model, messages, stream: false});
        assert.strictEqual(calls.length, refuses ? 2 : 1);
        assert.strictEqual(JSON.stringify(messages), before);
        const turns = protocol === 'gemini' ? calls.at(-1).contents : calls.at(-1).messages;
        assert.strictEqual(turns.length, refuses ? 3 : 2);
        const prefill = turns[1];
        assert.strictEqual(protocol === 'gemini' ? prefill.parts[0].text : prefill.content, 'PREFILL');
        assert.strictEqual(prefill.role, protocol === 'gemini' ? 'model' : 'assistant');
        if (refuses)
          assert.strictEqual(
            protocol === 'gemini' ? turns.at(-1).parts[0].text : turns.at(-1).content,
            '请继续上一条回复。'
          );
      }
    }
  `);

  await scenario('能力只属于当次请求', `
    await reset();
    const stored = {
      providers: [{id: 'stored', name: 'Stored', apiUrl: 'https://stored.example/v1', apiKey: 'key', model: 'model', models: [], enabled: true, capabilities: {}, capabilityCache: {version: 1, entries: {legacy: {unsupported: true}}}}],
      activeProviderId: 'stored',
      modelPresets: [{id: 'preset', name: 'Preset', routes: {}}], activeModelPresetId: 'preset',
      styleAuditEnabled: false, worldBookLocalizationBatchSize: 80,
    };
    assert.strictEqual(ensureProviderSettings(stored), true, '供应商运行时能力不得进入持久设置');
    assert.ok(!('capabilities' in stored.providers[0]));
    assert.ok(!('capabilityCache' in stored.providers[0]));

    Object.assign(D.settings, {
      providers: [{id: 'p', name: 'P', apiUrl: 'https://api.example/v1', apiKey: 'secret', model: 'model-a', enabled: true}],
      activeProviderId: 'p', modelPresets: [{id: 'preset', routes: {}}], activeModelPresetId: 'preset',
    });
    const route = resolveApiRoute('chat');
    assert.deepStrictEqual(route.capabilities, {});
    const schemaDefinition = {name: 'fixture_schema', schema: {type: 'object', properties: {value: {type: 'string'}}, required: ['value'], additionalProperties: false}};
    let structuredBody = {};
    applyStructuredResponseFormat(structuredBody, route, schemaDefinition);
    assert.strictEqual(structuredBody.response_format.type, 'json_schema');
    assert.strictEqual(rejectedProviderCapability(415, '{"error":{"message":"json_schema is not supported"}}', structuredBody), 'native_json_schema');
    structuredBody = {};
    applyStructuredResponseFormat(structuredBody, {capabilities: {native_json_schema: false}}, schemaDefinition);
    assert.deepStrictEqual(structuredBody.response_format, {type: 'json_object'});
    assert.strictEqual(rejectProviderCapability(route, 'streamOptions'), true);
    assert.strictEqual(route.capabilities.streamOptions, false);
    const streamBody = {stream_options: {include_usage: true}};
    applyProviderCapabilities(streamBody, route);
    assert.strictEqual(streamBody.stream_options, undefined);
    const provider = D.settings.providers[0];
    assert.ok(!provider.capabilityCache);
    assert.ok(!provider.capabilities);
    assert.deepStrictEqual(resolveApiRoute('chat').capabilities, {}, '新请求不得继承上次协商结果');
  `);

  await scenario('关闭思考轮换四种写法', `
    await reset();
    const rejectedName = sent => sent.thinking ? 'thinking' : sent.reasoning_effort ? 'reasoning_effort' : 'enable_thinking' in sent ? 'enable_thinking' : 'reasoning';
    const refuse = (name) => new Response(JSON.stringify({error: {message: '未知参数 ' + name}}), {status: 400});
    const bodies = [];
    window.fetch = async (_url, options) => {
      const sent = JSON.parse(options.body);
      bodies.push(sent);
      return refuse(rejectedName(sent));
    };
    const disableRoute = {providerId: 'p', apiUrl: 'https://api.example/v1', apiKey: 'secret', model: 'model-disable', capabilities: {}};
    const disableBody = {model: disableRoute.model, messages: [{role: 'user', content: 'test'}]};
    setProviderThinkingMode(disableBody, 'disabled');
    applyDisabledThinkingDialect(disableBody, disableRoute);
    await assert.rejects(() => fetchCompatibleCompletion(disableRoute, disableBody), /不支持关闭思考/);
    assert.strictEqual(bodies.length, 4, '关闭思考必须轮完四种兼容写法后才判定失败');
    assert.deepStrictEqual(bodies.map(rejectedName), ['thinking', 'reasoning_effort', 'enable_thinking', 'reasoning']);
    assert.ok(bodies.every(sent => sent.__yeyuThinkingMode === undefined), '内部协商标记不得发给供应商');
    for (const key of ['thinkingDisable.thinking', 'thinkingDisable.reasoningEffort', 'thinkingDisable.enableThinking', 'thinkingDisable.reasoning'])
      assert.strictEqual(disableRoute.capabilities[key], false, '缺少当次请求的方言拒绝状态：' + key);

    const accepted = [];
    window.fetch = async (_url, options) => {
      accepted.push(JSON.parse(options.body));
      return accepted.length === 1 ? new Response('{"error":{"message":"unknown parameter thinking"}}', {status: 400}) : new Response('{}', {status: 200});
    };
    const compatibleRoute = {providerId: 'p', apiUrl: 'https://api.example/v1', apiKey: 'secret', model: 'model-compatible', capabilities: {}};
    const compatibleBody = {model: compatibleRoute.model, messages: [{role: 'user', content: 'test'}]};
    setProviderThinkingMode(compatibleBody, 'disabled');
    applyDisabledThinkingDialect(compatibleBody, compatibleRoute);
    await fetchCompatibleCompletion(compatibleRoute, compatibleBody);
    assert.ok(accepted[0].thinking && accepted[1].reasoning_effort === 'none', '第一种写法被拒后必须继续尝试下一种');
    assert.strictEqual(compatibleRoute.capabilities['thinkingDisable.thinking'], false);
    assert.notStrictEqual(compatibleRoute.capabilities['thinkingDisable.reasoningEffort'], false);
  `);

  await scenario('json_schema 被拒后降级', `
    await reset();
    const schemaDefinition = {name: 'fixture_schema', schema: {type: 'object', properties: {value: {type: 'string'}}, required: ['value'], additionalProperties: false}};
    const bodies = [];
    window.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1 ? new Response('{"error":{"message":"json_schema is not supported"}}', {status: 400}) : new Response('{}', {status: 200});
    };
    const route = resolveApiRoute('chat');
    const requestBody = {model: route.model, messages: [{role: 'user', content: 'test'}]};
    applyStructuredResponseFormat(requestBody, route, schemaDefinition);
    await fetchCompatibleCompletion(route, requestBody);
    assert.deepStrictEqual(bodies.map(sent => sent.response_format.type), ['json_schema', 'json_object'], 'HTTP 明确拒绝 json_schema 后必须在统一传输层降级重试');
    assert.strictEqual(route.capabilities.native_json_schema, false, '当次请求应记录已拒绝能力');
    assert.ok(!D.settings.providers[0].capabilityCache, '协商结果不得写入设置');
    assert.deepStrictEqual(resolveApiRoute('chat').capabilities, {}, '新请求不得继承协商结果');
  `);

  await scenario('对话主循环显式失败', `
    const {target} = await reset();
    D.settings.reasoningEffort = 'off';
    D.settings.maxTokens = 0;
    const bodies = [];
    window.fetch = async (_url, options) => {
      const sent = JSON.parse(options.body);
      bodies.push(sent);
      const name = sent.thinking ? 'thinking' : sent.reasoning_effort ? 'reasoning_effort' : 'enable_thinking' in sent ? 'enable_thinking' : 'reasoning';
      return new Response('{"error":{"message":"unsupported parameter ' + name + '"}}', {status: 400});
    };
    await assert.rejects(() => callDeepSeek([{role: 'user', content: 'test'}], target, {route: 'chat'}), /不支持关闭思考/);
    assert.strictEqual(bodies.length, 4, '对话主循环必须轮完四种关闭写法并显式失败');
  `);
  console.log(JSON.stringify({requestScoped: true, noPersistentRecord: true, noProbeRequest: true, thinkingDisableDialects: true, chatDisableFailureVisible: true, jsonSchemaDowngrade: true}));
});
