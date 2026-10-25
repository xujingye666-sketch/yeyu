'use strict';

// Prompt post-processing (None / Merge / Semi / Strict / Single) through the loaded app: the semantics of each
// mode on a message list, the per-provider setting, and the bytes that actually go out (scripted fetch) for
// plain requests, assistant prefill, reply start, stop strings and the structured repair retry.
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {

  await scenario('各档位对消息的处理', `
    const names = {charName: '炎帝', userName: '药师', startsWithGroupName: () => false};
    const run = (messages, mode) => postProcessPromptMessages(messages, mode, names);
    const noneInput = [{role: 'system', content: '规则'}, {role: 'user', content: '开始'}];
    const noneBytes = JSON.stringify(noneInput);
    assert.strictEqual(run(noneInput, 'none'), noneInput, 'None 必须直接返回原消息数组');
    assert.strictEqual(JSON.stringify(noneInput), noneBytes, 'None 不得改变任何请求消息字节');

    const mergeInput = [
      {role: 'system', name: 'example_user', content: '示例提问'},
      {role: 'system', name: 'example_assistant', content: '示例回答'},
      {role: 'user', name: '旁白', content: '第一段'},
      {role: 'user', content: '第二段'},
    ];
    const mergeSnapshot = JSON.stringify(mergeInput);
    assert.deepStrictEqual(run(mergeInput, 'merge'), [
      {role: 'system', content: '药师: 示例提问\\n\\n炎帝: 示例回答'},
      {role: 'user', content: '旁白: 第一段\\n\\n第二段'},
    ]);
    assert.strictEqual(JSON.stringify(mergeInput), mergeSnapshot, '非 None 档也只能改请求副本，不能回写来源消息');

    assert.deepStrictEqual(run([
      {role: 'system', content: '开头系统'}, {role: 'assistant', content: '角色'},
      {role: 'system', content: '中途系统一'}, {role: 'system', content: '中途系统二'}, {role: 'user', content: '用户'},
    ], 'semi'), [
      {role: 'system', content: '开头系统'}, {role: 'assistant', content: '角色'},
      {role: 'user', content: '中途系统一\\n\\n中途系统二\\n\\n用户'},
    ], 'Semi 必须把第 2 条起的 system 改成 user 后再次合并');

    const strictAfterSystem = run([{role: 'system', content: '系统'}, {role: 'assistant', content: '助手预填'}], 'strict');
    assert.deepStrictEqual(strictAfterSystem, [
      {role: 'system', content: '系统'}, {role: 'user', content: '[Start a new chat]'}, {role: 'assistant', content: '助手预填'},
    ], 'Strict 必须在开头 system 后缺 user 时插入官方占位');
    assert.strictEqual(strictAfterSystem.at(-1).role, 'assistant', 'Strict 不得修改末条 assistant');
    assert.deepStrictEqual(run([{role: 'assistant', content: '先由助手开头'}, {role: 'user', content: '随后用户'}], 'strict'), [
      {role: 'user', content: '[Start a new chat]'}, {role: 'assistant', content: '先由助手开头'}, {role: 'user', content: '随后用户'},
    ], 'Strict 必须在首条既非 system 也非 user 时从数组开头插入占位');

    assert.deepStrictEqual(run([
      {role: 'system', content: '系统规则'}, {role: 'user', content: '开始'}, {role: 'assistant', content: '回答'}, {role: 'assistant', content: '助手预填'},
    ], 'single'), [{role: 'user', content: '系统规则\\n\\n药师: 开始\\n\\n炎帝: 回答\\n\\n炎帝: 助手预填'}], 'Single 必须加当前角色/人格名前缀并合成单条 user');

    const image = {type: 'image_url', image_url: {url: 'data:image/png;base64,AA=='}};
    const media = run([{role: 'user', content: [{type: 'text', text: '图片前'}, image, {type: 'text', text: '图片后'}]}, {role: 'user', content: '同角色续段'}], 'merge');
    assert.strictEqual(media.length, 1);
    assert.deepStrictEqual(media[0].content, [{type: 'text', text: '图片前'}, image, {type: 'text', text: '图片后\\n\\n同角色续段'}], '合并时必须保留多模态内容对象和相对顺序');
  `);

  await scenario('档位按供应商保存', `
    await reset();
    const settings = D.settings;
    Object.assign(settings, {
      providers: [
        {id: 'main', name: '主供应商', apiUrl: 'https://main.example/v1', apiKey: 'key', model: 'main-model'},
        {id: 'strict', name: '严格供应商', apiUrl: 'https://strict.example/v1', apiKey: 'key', model: 'strict-model', promptPostProcessing: 'single'},
      ],
      activeProviderId: 'main',
      modelPresets: [{id: 'routes', name: '路由', routes: {translation: {providerId: 'strict'}}}],
      activeModelPresetId: 'routes',
    });
    assert.strictEqual(ensureProviderSettings(settings), true, '旧供应商记录补默认 None 时必须标记设置已更新');
    assert.strictEqual(settings.providers[0].promptPostProcessing, 'none');
    assert.strictEqual(resolveApiRoute('chat').promptPostProcessing, 'none');
    assert.strictEqual(resolveApiRoute('translation').promptPostProcessing, 'single', '任务路由必须使用实际供应商自己的档位');
  `);

  await scenario('实际发出的请求体', `
    const {char, session} = await reset();
    char.name = '炎帝';
    session.msgs.push({role: 'assistant', seq: 2, content: '已提交的前文', time: 1700000000001});
    D.personas = [{id: 'p1', name: '药师', desc: ''}];
    D.activePersonaId = 'p1';
    D.settings.reasoningEffort = 'auto';
    // 供应商记录在解析路由时会被规范化成新对象，每次按当前设置写入档位。
    const setMode = mode => { D.settings.providers[0].promptPostProcessing = mode; };
    const bodies = [], queue = [];
    window.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify(queue.length ? queue.shift() : {choices: [{message: {content: 'ok'}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});
    };
    const send = (messages, mode, options, extra) => callDeepSeek(messages, {charId: 'c1', sessionId: 's1', mode, ...extra}, {route: 'chat', nonStream: true, deferCommit: true, controller: new AbortController(), ...options});
    const take = () => bodies.shift();

    const unchanged = [{role: 'system', content: '规则'}, {role: 'user', content: '原样'}];
    await send(unchanged, undefined, {transient: true});
    assert.strictEqual(JSON.stringify(take()), JSON.stringify({model: 'test-model', messages: unchanged, stream: false}), '默认 None 的请求体必须与既有发送形状逐字节一致');

    setMode('single');
    D.settings.reasoningEffort = 'off';
    D.settings.startReplyWith = '预填结尾';
    let result = await send([{role: 'user', content: '斗破更新'}], 'new');
    const prefillBody = take();
    assert.deepStrictEqual(prefillBody.messages.map(row => row.role), ['user']);
    assert.ok(prefillBody.messages[0].content.endsWith('炎帝: 预填结尾'), 'Single 必须在助手预填追加完成后执行');
    assert.strictEqual(result.content, '预填结尾ok', '回复开头要带回提交层');

    // 活动补全预设自带的 assistant_prefill 优先于「回复开头」设置。
    setMode('none');
    const presetSettings = {...D.settings, _completionPresetActive: true, _completionPresetRaw: {assistant_prefill: '预设预填'}};
    result = await send([{role: 'user', content: '预设预填'}], 'new', {settingsOverride: presetSettings});
    assert.deepStrictEqual(take().messages.at(-1), {role: 'assistant', content: '预设预填'}, '预设里的预填优先于回复开头设置');
    assert.strictEqual(result.content, '预设预填ok');
    const prefillSource = [{role: 'system', content: '合成系统内容'}, {role: 'user', content: '合成用户内容'}];
    const prefillSourceBytes = JSON.stringify(prefillSource);
    for (const effort of ['off', 'high', 'auto']) {
      D.settings.reasoningEffort = effort;
      await send(prefillSource, 'new');
      assert.deepStrictEqual(take().messages, prefillSource.concat([{role: 'assistant', content: '预填结尾'}]), effort + ' 思考档位下预填必须照常追加到请求末尾');
    }
    assert.strictEqual(JSON.stringify(prefillSource), prefillSourceBytes, '预填不得写回来源消息');
    D.settings.reasoningEffort = 'off';

    D.settings.startReplyWith = '固定开头：';
    D.settings.customStoppingStrings = ['CHAT_STOP'];
    result = await send([{role: 'user', content: '主聊天'}], 'new');
    const mainChatBody = take();
    assert.deepStrictEqual(mainChatBody.messages.at(-1), {role: 'assistant', content: '固定开头：'});
    assert.deepStrictEqual(mainChatBody.stop, ['CHAT_STOP']);
    assert.strictEqual(result.content, '固定开头：ok');

    const quiet = await send([{role: 'user', content: '静默生成'}], 'quiet', {transient: true, deferCommit: undefined});
    const quietBody = take();
    assert.strictEqual(quietBody.messages.at(-1).role, 'user');
    assert.strictEqual(quietBody.stop, undefined);
    assert.strictEqual(quiet.content, 'ok', '静默工具生成不得继承聊天回复开头');

    result = await send([{role: 'user', content: '继续'}], 'continue', {}, {messageIndex: 1, messageSeq: 2});
    const continuationBody = take();
    assert.strictEqual(continuationBody.messages.at(-1).role, 'user');
    assert.deepStrictEqual(continuationBody.stop, ['CHAT_STOP']);
    assert.strictEqual(result.content, 'ok', '续写不得再次添加回复开头');

    result = await send([{role: 'user', content: 'Impersonate'}], 'impersonate');
    const impersonateBody = take();
    assert.strictEqual(impersonateBody.messages.at(-1).role, 'user');
    assert.deepStrictEqual(impersonateBody.stop, ['CHAT_STOP']);
    assert.strictEqual(result.content, 'ok', 'Impersonation uses chat stops without an assistant prefix');

    setMode('single');
    queue.push({choices: [{message: {content: '格式错误'}, finish_reason: 'stop'}]}, {choices: [{message: {content: '{"ok":true}'}, finish_reason: 'stop'}]});
    await send([{role: 'system', content: '输出 JSON'}, {role: 'user', content: '任务'}], undefined,
      {transient: true, structured: true, output: {validate: value => value && value.ok === true}});
    const structured = bodies.splice(0);
    assert.strictEqual(structured.length, 2, '结构化请求仍须保留唯一一次格式修复');
    assert.ok(structured.every(body => !JSON.stringify(body.messages).includes('固定开头：')), '结构化任务不得继承自然语言回复开头');
    assert.ok(structured.every(body => body.stop === undefined), '结构化任务不得继承主聊天停止字符串');
    assert.ok(structured.every(body => body.messages.length === 1 && body.messages[0].role === 'user'), '每次最终发送前都必须重新执行 Single');
    assert.ok(structured[1].messages[0].content.includes('格式错误'));
    assert.ok(structured[1].messages[0].content.includes('唯一一次格式修复请求'));

    // Grok 订阅线路照 ST convertXAIMessages：非 user 消息去掉 name，对话示例与助手消息把说话人写进正文；其他线路保留 name。
    const named = [
      {role: 'system', content: '规则'},
      {role: 'system', name: 'example_user', content: '还有船吗？'},
      {role: 'system', name: 'example_assistant', content: '等雨停。'},
      {role: 'system', name: 'example_assistant', content: '炎帝: 已有前缀'},
      {role: 'system', name: '旁白', content: '夜色'},
      {role: 'user', name: '药师', content: '你好'},
      {role: 'assistant', name: '炎帝', content: '在'},
    ];
    const namedBytes = JSON.stringify(named);
    const promptNames = promptPostProcessingNames({charId: 'c1'});
    setMode('none');
    assert.deepStrictEqual(completionRequestMessages(named, resolveApiRoute('chat'), promptNames), named, '其他线路的请求保留 name 字段');
    assert.deepStrictEqual(completionRequestMessages(named, {task: 'chat', protocol: 'grok-subscription', promptPostProcessing: 'none'}, promptNames), [
      {role: 'system', content: '规则'},
      {role: 'system', content: '药师: 还有船吗？'},
      {role: 'system', content: '炎帝: 等雨停。'},
      {role: 'system', content: '炎帝: 已有前缀'},
      {role: 'system', content: '夜色'},
      {role: 'user', name: '药师', content: '你好'},
      {role: 'assistant', content: '炎帝: 在'},
    ], 'Grok 订阅线路按 xAI 规则去掉非 user 的 name 并把说话人写进正文');
    assert.strictEqual(JSON.stringify(named), namedBytes, 'Grok 转换不得写回来源消息');

    const samplingRoute = {task: 'chat', apiUrl: 'https://example.invalid/v1', model: 'model', capabilities: {}};
    const samplingKeys = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'];
    const samplingFor = (effort, settings) => {
      Object.assign(D.settings, {reasoningEffort: effort}, settings);
      return applyThinkingForRoute({temperature: 2, top_p: 1, frequency_penalty: 2, presence_penalty: 2}, samplingRoute, {route: 'chat'});
    };
    const nonThinking = samplingFor('off', {temperature: 0, top_p: 0.75, frequency_penalty: -0.5, presence_penalty: 1.25});
    assert.deepStrictEqual(samplingKeys.map(key => nonThinking[key]), [0, 0.75, -0.5, 1.25], '关闭思考时采样参数取设置值，合法的零值必须保留');
    const thinking = samplingFor('high', {});
    assert.deepStrictEqual(samplingKeys.filter(key => key in thinking), [], '思考请求不得携带采样参数');
    const blank = samplingFor('off', {temperature: null, top_p: null, frequency_penalty: null, presence_penalty: null});
    assert.deepStrictEqual(samplingKeys.filter(key => key in blank), [], '留空的采样参数不得发送');
  `);
  console.log(JSON.stringify({modes: ['none', 'merge', 'semi', 'strict', 'single'], officialPlaceholder: true, mediaPreserved: true, perProviderPersistence: true, noneBodyByteIdentity: true, prefillProcessedLast: true, structuredRepairProcessedLast: true}));
});
