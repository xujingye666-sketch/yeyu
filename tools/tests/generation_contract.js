'use strict';

// The card-script generation contract (generate / generateRaw options, injects, images, custom_api, event
// tables, stop by id / all) and the request wire shapes behind it, on the loaded app. The recorded SillyTavern
// / JS-Slash-Runner oracle is read from the fixture; only the network is scripted.
const fs = require('fs');
const path = require('path');
const {runStreamPage} = require('./helpers/stream-page');

const oracle = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/generation_contract_oracle.json'), 'utf8'));

runStreamPage(async scenario => {
  const withOracle = code => `const oracle = ${JSON.stringify(oracle)};\n${code}`;

  await scenario('事件表与配置字段', withOracle(`
    assert.deepStrictEqual(CARD_FRONTEND_IFRAME_EVENT_VALUES, oracle.iframeEvents);
    assert.deepStrictEqual(CARD_FRONTEND_TAVERN_EVENT_VALUES, oracle.tavernEvents);
    assert.strictEqual(Object.keys(oracle.iframeEvents).length, 7);
    assert.strictEqual(Object.keys(oracle.tavernEvents).length, 80);
    const fullConfig = Object.fromEntries(oracle.configFields.generate.map(key => [key, undefined]));
    Object.assign(fullConfig, {
      preset_name: 'in_use', generation_id: 'full', user_input: '输入', image: [], should_stream: false,
      should_silence: true, overrides: {}, injects: [], max_chat_history: 'all', custom_api: {}, json_schema: undefined,
    });
    assert.strictEqual(cardFrontendGenerationConfig(fullConfig, false).generation_id, 'full');
    const publicSchema = {name: 'scene', description: '场景', value: {type: 'object'}, strict: false};
    assert.deepStrictEqual(cardFrontendGenerationConfig({json_schema: publicSchema}, false).json_schema, publicSchema);
    assert.deepStrictEqual(Array.from(CARD_FRONTEND_BUILTIN_PROMPT_DEFAULT_ORDER), oracle.runtimeExports.defaultOrder);
    const rawPlan = cardFrontendGenerationRawPreset({ordered_prompts: oracle.runtimeExports.defaultOrder}, '本轮输入');
    assert.strictEqual(rawPlan.hasUser, true);
    assert.strictEqual(rawPlan.hasHistory, true);
    assert.deepStrictEqual(Array.from(rawPlan.raw.prompt_order[0].order, row => row.identifier),
      ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'yeyuRawUserInput']);
  `));

  await scenario('历史、注入与图片', `
    const {session} = await reset();
    session.msgs = [{role: 'user', content: '历史 A', seq: 1}];
    assert.deepStrictEqual(cardFrontendGenerationHistory(session, {max_chat_history: 1, overrides: {}}).map(row => [row.role, row.content]), [['user', '历史 A']]);
    assert.deepStrictEqual(cardFrontendGenerationHistory(session, {max_chat_history: 1, overrides: {chat_history: {prompts: [{role: 'user', content: '较早替换'}, {role: 'assistant', content: '替换'}]}}}).map(row => [row.role, row.content]),
      [['assistant', '替换']]);

    let filterArgs = -1;
    const injects = await cardFrontendGenerationPrepareInjects({injects: [
      {position: 'in_chat', depth: 2, role: 'system', content: '注入', should_scan: true, filter: function () { filterArgs = arguments.length; return true; }},
      {position: 'none', depth: 0, role: 'user', content: '只扫描', should_scan: true},
      {position: 'in_chat', depth: 0, role: 'assistant', content: '过滤', filter: () => false},
    ]});
    assert.strictEqual(filterArgs, 0);
    assert.deepStrictEqual(injects, {inChat: [{role: 'system', content: '注入', depth: 2, order: 0}], scan: ['注入', '只扫描']});
    assert.deepStrictEqual(cardFrontendGenerationInsertInjects([{role: 'user', content: 'A'}, {role: 'assistant', content: 'B'}], injects.inChat),
      [{role: 'system', content: '注入'}, {role: 'user', content: 'A'}, {role: 'assistant', content: 'B'}]);

    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', {type: 'image/png'});
    const images = await cardFrontendGenerationImages(['data:image/png;base64,AA==', 'https://example.invalid/a.png', file]);
    assert.strictEqual(images.length, 3);
    assert.ok(images[2].startsWith('data:image/png;base64,'));
    const duplicates = [{role: 'user', content: '重复'}, {role: 'user', content: '重复'}];
    await cardFrontendGenerationAttachPromptImages(duplicates, [
      {index: 0, role: 'user', content: '重复', image: 'data:image/png;base64,AA=='},
      {index: 1, role: 'user', content: '重复', image: 'data:image/png;base64,AQ=='},
    ], 'prompts');
    assert.strictEqual(duplicates[0].content[1].image_url.url, 'data:image/png;base64,AA==');
    assert.strictEqual(duplicates[1].content[1].image_url.url, 'data:image/png;base64,AQ==');
    const multimodal = {role: 'user', content: [{type: 'text', text: '保留'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,OLD='}}]};
    cardFrontendGenerationAttachImages(multimodal, ['data:image/png;base64,NEW=']);
    assert.deepStrictEqual(multimodal.content, [
      {type: 'text', text: '保留'},
      {type: 'image_url', image_url: {url: 'data:image/png;base64,OLD='}},
      {type: 'image_url', image_url: {url: 'data:image/png;base64,NEW='}},
    ]);
  `);

  await scenario('自定义接口与模型列表', withOracle(`
    const {session} = await reset();
    Object.assign(D.settings, {providers: [
      {id: 'p1', name: '命中代理', apiUrl: 'https://preset.invalid/v1/', apiKey: 'preset-key', model: 'preset-model', enabled: true, promptPostProcessing: 'none'},
      {id: 'p2', name: '空代理', apiUrl: '', apiKey: '', model: 'empty-model', enabled: true},
      {id: 'p3', name: '已停用', apiUrl: 'https://disabled.invalid/v1', apiKey: 'disabled', enabled: false},
    ], activeProviderId: 'p1'});
    const live = {key: 'live-a', owner: {sessionId: session.id}, charId: 'c1'};
    const iframeEvents = [];
    const eventName = oracle.iframeEvents.STREAM_TOKEN_RECEIVED_FULLY;
    const receive = (text, id) => iframeEvents.push([text, id]);
    cardFrontendRegisterEvent(live, eventName, receive);
    try {
      const requestBase = {should_stream: true, custom_api: {
        proxy_preset: '命中代理', apiurl: 'https://custom.invalid/v1/', key: 'custom-key', model: 'custom-model', source: 'custom',
        max_tokens: 321, temperature: 'unset', frequency_penalty: 'same_as_preset', presence_penalty: 0.5, top_p: 0.8, top_k: 40,
        custom_include_body: {seed: 7}, custom_exclude_body: ['top_p'], custom_include_headers: {Authorization: 'Custom token', 'X-Test': 'yes'},
      }};
      const options = cardFrontendGenerationRequestOptions(requestBase, {openai_max_tokens: 100}, new AbortController(), {}, live, {id: 'request'});
      assert.strictEqual(options.routeOverride.apiUrl, 'https://preset.invalid/v1');
      assert.strictEqual(options.routeOverride.apiKey, 'preset-key');
      assert.strictEqual(options.routeOverride.model, 'custom-model');
      assert.deepStrictEqual(options.requestBodyPatch, {max_tokens: 321, presence_penalty: 0.5, top_p: 0.8, top_k: 40, seed: 7});
      assert.deepStrictEqual(Array.from(options.requestBodyExclude), ['temperature', 'top_p']);
      assert.strictEqual(options.routeOverride.headers.Authorization, 'Custom token');
      assert.strictEqual(options.nonStream, false);
      options.onProgress({content: '一'});
      options.onProgress({content: '一二'});
      await wait(0);
      assert.deepStrictEqual(iframeEvents, [['一', 'request'], ['一二', 'request']], '真实事件分发必须把完整流式进度送到消费者');
    } finally {
      cardFrontendRemoveEvent(live, eventName, receive);
    }
    const fallback = cardFrontendGenerationRequestOptions({custom_api: {proxy_preset: '不存在', apiurl: 'https://fallback.invalid/v1/', key: 'fallback-key'}}, {}, new AbortController(), {}, live, {id: 'fallback'});
    assert.strictEqual(fallback.routeOverride.apiUrl, 'https://fallback.invalid/v1');
    assert.strictEqual(fallback.routeOverride.apiKey, 'fallback-key');
    const emptyPreset = cardFrontendGenerationRequestOptions({custom_api: {proxy_preset: '空代理', apiurl: 'https://fallback.invalid/v1', key: 'fallback-key'}}, {}, new AbortController(), {}, live, {id: 'empty'});
    assert.strictEqual(emptyPreset.routeOverride.apiUrl, '');
    assert.strictEqual(emptyPreset.routeOverride.apiKey, '');
    assert.strictEqual(emptyPreset.allowEmptyApiKey, true);
    const schemaOptions = cardFrontendGenerationRequestOptions({json_schema: {name: 'scene', description: '场景', value: {type: 'object'}, strict: false}}, {}, new AbortController(), {}, live, {id: 'strict-schema'});
    assert.strictEqual(schemaOptions.noRetry, true);
    assert.deepStrictEqual(Array.from(cardFrontendGetProxyPresetNames()), ['命中代理', '空代理']);

    const requests = [];
    window.fetch = async (url, options) => {
      requests.push({url, authorization: options.headers.Authorization});
      return new Response(JSON.stringify({data: [{id: 'a'}, {id: 'b'}]}), {headers: {'content-type': 'application/json'}});
    };
    assert.deepStrictEqual(Array.from(await cardFrontendGetModelList({apiurl: 'https://models.invalid/v1', key: 'model-key'})), ['a', 'b']);
    assert.deepStrictEqual(requests, [{url: 'https://models.invalid/v1/models', authorization: 'Bearer model-key'}]);
  `));

  await scenario('按编号或全部停止生成', `
    const {session} = await reset();
    session.msgs = [{role: 'user', content: '历史 A', seq: 1}];
    session.nextMessageSeq = 2;
    D.currentCharId = 'c1';
    setGenerationState('idle');
    const live = {key: 'live-a', owner: {sessionId: session.id}, charId: 'c1'};
    const pending = new Map();
    window.fetch = (_url, options) => new Promise((_resolve, reject) => {
      const generationId = JSON.parse(options.body).messages.some(row => String(row.content).includes('stop-all')) ? 'stop-all' : 'stop-by-id';
      pending.set(generationId, options.signal);
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('已取消'), {name: 'AbortError'})), {once: true});
    });
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 3000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for ' + label);
        await wait(5);
      }
    };
    const byId = executeCardFrontendGeneration({generation_id: 'stop-by-id', user_input: 'stop-by-id', should_silence: true}, live, false);
    const byIdFailure = failure(() => byId);
    await waitFor(() => pending.has('stop-by-id'), 'stopGenerationById transport');
    assert.strictEqual(cardFrontendCall(live, 'stopGenerationById', {generationId: 'stop-by-id'}), true);
    assert.strictEqual((await byIdFailure).name, 'AbortError');
    assert.strictEqual(pending.get('stop-by-id').aborted, true);

    const all = executeCardFrontendGeneration({generation_id: 'stop-all', user_input: 'stop-all', should_silence: true}, live, false);
    const allFailure = failure(() => all);
    await waitFor(() => pending.has('stop-all'), 'stopAllGeneration transport');
    assert.strictEqual(cardFrontendCall(live, 'stopAllGeneration', null), true);
    assert.strictEqual((await allFailure).name, 'AbortError');
    assert.strictEqual(_cardFrontendGenerations.size, 0);
  `);

  await scenario('请求线上形状', `
    const {target} = await reset();
    const publicSchema = {name: 'scene', description: '场景', value: {type: 'object'}, strict: false};
    const sent = [];
    let reply = () => new Response('{"choices":[{"message":{"content":"{}"}}]}', {headers: {'content-type': 'application/json'}});
    window.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return reply(); };
    const route = {...resolveApiRoute('chat'), apiUrl: 'https://wire.invalid/v1', apiKey: 'wire-key', model: 'wire-model'};
    const call = options => callDeepSeek([{role: 'user', content: 'schema'}], target, {transient: true, nonStream: true, routeOverride: route, settingsOverride: {}, controller: new AbortController(), noRetry: true, ...options});
    const result = await call({jsonSchema: publicSchema});
    assert.strictEqual(result.content, '{}');
    assert.deepStrictEqual(sent[0].response_format, {type: 'json_schema', json_schema: {name: 'scene', schema: {type: 'object'}, strict: false, description: '场景'}});
    await call({beforeRequest: requestBody => { assert.ok(Array.isArray(requestBody.messages)); requestBody.max_tokens = 77; }});
    assert.strictEqual(sent[1].max_tokens, 77, 'settings-ready mutations must reach the actual request body');
    // 明确指定的 schema 请求被供应商拒绝时不进入能力降级重试：只发一次，原样失败。
    sent.length = 0;
    reply = () => new Response('{"error":{"message":"json_schema is not supported"}}', {status: 400});
    await assert.rejects(() => call({jsonSchema: publicSchema}));
    assert.strictEqual(sent.length, 1, '显式 schema 请求不得进入能力降级重试');
  `);
  await scenario('helper 原生 schema 与独立自定义路由', `
    const {session} = await reset();
    setGenerationState('idle');
    const live = {key: 'provider-helper', owner: {sessionId: session.id}, charId: 'c1'};
    D.currentCharId = 'c1';
    const schema = {type: 'object', properties: {answer: {type: 'string', enum: ['OK']}}, required: ['answer'], additionalProperties: false};
    const publicSchema = {name: 'answer', value: schema};
    const sent = [];
    let finish = 'end_turn', httpError = false;
    window.fetch = async (url, options) => {
      const request = {url, body: JSON.parse(options.body), headers: new Headers(options.headers)};
      sent.push(request);
      if (httpError) return new Response('{"error":{"message":"output_config.format schema is unsupported"}}', {status: 400});
      if (url.endsWith('/chat/completions')) return request.body.stream
        ? body([chunk('{"answer":"OK"}'), sse({choices: [{delta: {}, finish_reason: 'stop'}]}), done])
        : new Response(JSON.stringify({choices: [{message: {content: '{"answer":"OK"}'}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});
      if (request.body.stream) return body([
        sse({type: 'message_start', message: {id: 'msg_helper', usage: {input_tokens: 2}}}),
        sse({type: 'content_block_delta', delta: {type: 'text_delta', text: '{"answer":"OK"}'}}),
        sse({type: 'message_delta', delta: {stop_reason: finish}, usage: {output_tokens: 4}}),
        sse({type: 'message_stop'}),
      ]);
      return new Response(JSON.stringify({content: [{type: 'text', text: '{"answer":"OK"}'}], stop_reason: finish}), {headers: {'content-type': 'application/json'}});
    };
    const invoke = (name, config) => cardFrontendCall(live, name, {config: {user_input: 'Reply OK', should_silence: true, ...(name === 'generateRaw' ? {ordered_prompts: ['user_input']} : {}), ...config}});
    for (const protocol of ['anthropic', 'gemini']) {
      Object.assign(D.settings.providers[0], {protocol, apiUrl: 'https://native.invalid/v1', apiKey: 'native-key', apiKeys: [], model: protocol === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash'});
      for (const name of ['generate', 'generateRaw']) for (const should_stream of [false, true]) {
        assert.strictEqual(await invoke(name, {should_stream, custom_api: {source: 'openai', apiurl: 'https://custom.invalid/v1', key: 'custom-key', model: 'custom-model', max_tokens: 1024}}), '{"answer":"OK"}');
        const request = sent.at(-1);
        assert.strictEqual(request.url, 'https://custom.invalid/v1/chat/completions');
        assert.strictEqual(request.headers.get('authorization'), 'Bearer custom-key');
        assert.strictEqual(request.headers.has('x-api-key') || request.headers.has('x-goog-api-key'), false);
        assert.strictEqual(request.body.max_tokens, 1024);
      }
      if (protocol === 'anthropic') {
        assert.strictEqual(await invoke('generate', {custom_api: {source: 'openai', model: 'override-model', max_tokens: 777}}), '{"answer":"OK"}');
        assert.ok(sent.at(-1).url.startsWith('https://native.invalid/') && sent.at(-1).body.model === 'override-model', '无 apiurl 的 custom_api 沿用当前原生路线并应用覆盖');
      }
      await assert.rejects(() => invoke('generate', {custom_api: {source: 'openai', proxy_preset: D.settings.providers[0].name}}), /OpenAI-compatible/);
    }
    Object.assign(D.settings.providers[0], {protocol: 'anthropic', apiUrl: 'https://claude.invalid/v1', apiKey: 'claude-key', apiKeys: [], model: 'claude-sonnet-4-6'});
    Object.assign(D.settings, {reasoningEffort: 'medium', maxTokens: 2048});
    for (const name of ['generate', 'generateRaw']) for (const should_stream of [false, true]) {
      const before = sent.length;
      assert.strictEqual(await invoke(name, {json_schema: publicSchema, should_stream}), '{"answer":"OK"}');
      const request = sent.at(-1);
      assert.strictEqual(sent.length, before + 1);
      assert.strictEqual(request.url, 'https://claude.invalid/v1/messages');
      assert.strictEqual(request.headers.get('x-api-key'), 'claude-key');
      assert.deepStrictEqual(request.body.output_config, {effort: 'medium', format: {type: 'json_schema', schema}});
      assert.strictEqual(request.body.thinking.type, 'adaptive');
      assert.strictEqual(request.body.stream, should_stream);
      assert.strictEqual(request.body.max_tokens, 2048);
      assert.strictEqual(request.body.response_format, undefined);
    }
    for (const should_stream of [false, true]) for (const reason of ['refusal', 'max_tokens']) {
      finish = reason;
      const before = sent.length;
      await assert.rejects(() => invoke('generateRaw', {json_schema: publicSchema, should_stream}), reason === 'refusal' ? /refusal/ : /截断/);
      assert.strictEqual(sent.length, before + 1, '拒绝和截断不能重试或当作完整 schema 成功');
    }
    httpError = true;
    const before = sent.length;
    await assert.rejects(() => invoke('generate', {json_schema: publicSchema}), /schema is unsupported/);
    assert.strictEqual(sent.length, before + 1, '供应商不支持 schema 时保留原错误，不移除约束重试');
  `);
  console.log(JSON.stringify({
    configFields: oracle.configFields.generate.length,
    iframeEvents: Object.keys(oracle.iframeEvents).length,
    tavernEvents: Object.keys(oracle.tavernEvents).length,
  }));
});
