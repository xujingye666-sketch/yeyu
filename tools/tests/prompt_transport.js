'use strict';

// What is sent and what is touched when a reply is regenerated, continued or accepted, on the loaded app:
// continue and regenerate attach to the last reply and leave the history alone, sending accepts an
// interrupted reply even when a /imagine message trails it, and a bracketed passage is transported once,
// whole, as the user's message.
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {

  // 从真实入口到请求、提交与重载；只提供模型的响应字节。
  await scenario('续写与重新生成落在末尾回复', `
    for (const mode of ['continue', 'regenerate', 'new']) {
      const {session} = await reset({visible: true});
      session.msgs = [
        {role: 'user', seq: 1, content: '较早提问', time: 1},
        {role: 'assistant', seq: 2, content: '较早回复', time: 2},
        {role: 'user', seq: 3, content: '原始提问', time: 3},
      ];
      if (mode !== 'new') session.msgs.push({role: 'assistant', seq: 4, content: '已有回复', time: 4});
      session.nextMessageSeq = mode === 'new' ? 4 : 5;
      const history = JSON.stringify(session.msgs.slice(0, 2));
      const requests = [];
      window.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return body([chunk('生成结果'), done]);
      };
      setGenerationState('idle');
      assert.strictEqual(await (mode === 'continue' ? continueGeneration() : regenerateLast()), true);
      assert.strictEqual(requests.length, 1);
      const messages = requests[0].messages;
      assert.ok(messages.some(row => row.role === 'user' && row.content === '原始提问'));
      if (mode === 'continue') assert.ok(messages.some(row => row.role === 'assistant' && row.content === '已有回复'), '续写必须携带被接续的正文');
      else assert.ok(!messages.some(row => row.content === '已有回复'), '重新生成不得把被替换回复发给模型');
      assert.strictEqual(JSON.stringify(session.msgs.slice(0, 2)), history, '生成不得改写较早历史');
      assert.strictEqual(session.msgs.length, 4, '只应生成或更新末尾回复');
      assert.strictEqual(session.msgs[2].content, '原始提问', '末尾为用户时不得改写提问');
      const reply = session.msgs[3];
      assert.strictEqual(reply.role, 'assistant');
      assert.strictEqual(reply.seq, 4, '续写和重生成必须保持末尾回复身份');
      assert.strictEqual(reply.content, mode === 'continue' ? '已有回复生成结果' : '生成结果');
      await flushPendingSave();
      const saved = (await YeyuRepository.load()).data.chats.c1.sessions[0];
      assert.strictEqual(saved.msgs[3].content, reply.content, '真实提交必须持久化生成结果');
    }
  `);

  // 发送即接受：中断回复后面跟着 /imagine 系统图片消息时，仍清掉那条回复的未完成标记。
  await scenario('发送前接受被中断的回复', `
    const {char} = await reset();
    const acceptSession = {msgs: [
      {role: 'user', seq: 1},
      {role: 'assistant', seq: 2, incomplete: true},
      {role: 'system', seq: 3, kind: GENERATED_IMAGE_MESSAGE_KIND},
    ]};
    const accepted = acceptIncompleteAssistantBeforeUserSend(char, acceptSession);
    assert.strictEqual(accepted.changed, true, '末尾是系统图片消息时仍接受前面的中断回复');
    assert.strictEqual(accepted.messageIndex, 1);
    assert.strictEqual(acceptSession.msgs[1].incomplete, undefined);
    accepted.rollback();
    assert.strictEqual(acceptSession.msgs[1].incomplete, true, '回滚恢复未完成标记');
  `);

  // API 请求中完整正文只出现一次，且保持 role:user；旧缓存字段不能复制它。
  await scenario('括号正文只传输一次', `
    const {session, target} = await reset({visible: true});
    const sentinel = '前文甲【保留换行\\n、引号“乙”、HTML <img src=x onerror=alert(1)> 与 URL https://example.test/?q=【丙】】后文丁';
    Object.assign(D.settings, {useMemory: false, maxContextTokens: 0, maxTokens: 0});
    const message = {role: 'user', seq: 1, content: sentinel, directives: ['旧字段'], promptContent: '错误删减正文'};
    session.msgs = [message];
    const requests = [];
    window.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return body([chunk('正文传输完成'), done]);
    };
    setGenerationState('preparing');
    await doAPICall({target});
    assert.strictEqual(requests.length, 1);
    const occurrences = requests[0].messages.filter(row => String(row.content || '').includes(sentinel));
    assert.strictEqual(occurrences.length, 1, '【】完整正文必须只传输一次');
    assert.strictEqual(occurrences[0].role, 'user', '【】完整正文必须保持 role:user');
    assert.strictEqual(occurrences[0].content, sentinel);
  `);
  await scenario('外部 API 地址仅携带调用者自己的凭据，同源保留配置', `
    const {char, session} = await reset({visible: true});
    setGenerationState('idle');
    D.settings.useMemory = false;
    const originalResolve = resolveApiRoute;
    const inheritedHeaders = {'X-Private-Header': 'synthetic-private', Authorization: 'Bearer synthetic-header'};
    const requests = [];
    window.fetch = async (url, options) => {
      requests.push({url: String(url), headers: Object.fromEntries(new Headers(options.headers))});
      const protocol = D.settings.providers[0].protocol;
      const native = !String(url).includes('/chat/completions');
      const payload = native && protocol === 'anthropic'
        ? {content: [{type: 'text', text: 'ok'}], stop_reason: 'end_turn'}
        : native && protocol === 'gemini'
          ? {candidates: [{content: {parts: [{text: 'ok'}]}, finishReason: 'STOP'}]}
          : {choices: [{message: {content: 'ok'}, finish_reason: 'stop'}]};
      return new Response(JSON.stringify(payload), {headers: {'content-type': 'application/json'}});
    };
    resolveApiRoute = function (...args) {
      return Object.assign(originalResolve(...args), {headers: {...inheritedHeaders}});
    };
    try {
      for (const protocol of ['openai', 'anthropic', 'gemini']) {
        Object.assign(D.settings.providers[0], {protocol, apiUrl: 'https://api.example.test/v1', apiKey: 'synthetic-provider'});
        for (const entry of ['helper', 'xbgenraw']) {
          for (const [url, sameOrigin] of [
            ['https://API.EXAMPLE.TEST:443/other', true],
            ['https://external.example.test/v1', false],
            ['http://api.example.test/v1', false],
            ['https://api.example.test:8443/v1', false],
          ]) {
            for (const ownKey of [false, true]) {
              const before = requests.length;
              if (entry === 'helper') {
                const custom = {apiurl: url};
                if (ownKey) Object.assign(custom, {key: 'synthetic-caller', custom_include_headers: {'X-Caller': 'synthetic-own'}});
                assert.strictEqual(await executeCardFrontendGeneration({
                  ordered_prompts: ['user_input'], user_input: 'test', should_silence: true,
                  should_stream: false, max_chat_history: 0, injects: [], overrides: {}, custom_api: custom,
                }, {charId: char.id, owner: {charId: char.id, sessionId: session.id}}, true), 'ok');
              } else {
                const args = {apiurl: url, prompt: 'test', nonstream: true};
                if (ownKey) args.apipassword = 'synthetic-caller';
                assert.strictEqual(await presetTaskGenerateRaw(args, {}), 'ok');
              }
              assert.strictEqual(requests.length, before + 1, '每次调用恰好发送一次');
              const sent = requests[before].headers;
              assert.strictEqual(sent['x-private-header'], sameOrigin ? 'synthetic-private' : undefined);
              if (sameOrigin) assert.strictEqual(sent.authorization, inheritedHeaders.Authorization);
              else {
                assert.ok(!Object.values(sent).some(value => /synthetic-provider|synthetic-private|synthetic-header/.test(value)), '跨源不得携带用户配置凭据或自定义 headers');
                const auth = entry === 'xbgenraw' && protocol !== 'openai' ? (protocol === 'gemini' ? 'x-goog-api-key' : 'x-api-key') : 'authorization';
                assert.strictEqual(sent[auth], ownKey ? (auth === 'authorization' ? 'Bearer ' : '') + 'synthetic-caller' : undefined);
              }
              if (entry === 'helper' && ownKey) assert.strictEqual(sent['x-caller'], 'synthetic-own');
              assert.strictEqual(D.settings.providers[0].apiKey, 'synthetic-provider', '单次请求不得修改供应商配置');
            }
          }
        }
      }
      delete inheritedHeaders.Authorization;
      D.settings.providers[0].protocol = 'openai';
      for (const url of [undefined, 'https://api.example.test/other']) {
        assert.strictEqual(await presetTaskGenerateRaw({apiurl: url, apipassword: '', prompt: 'test', nonstream: true}, {}), 'ok');
        assert.strictEqual(requests[requests.length - 1].headers.authorization, 'Bearer synthetic-provider', '空 xbgenraw 密码保留未覆盖和同源路由的既有凭据');
      }
    } finally {
      resolveApiRoute = originalResolve;
    }
  `);
  console.log('reply tail generation, accept-on-send, bracketed transport and API override credential boundaries hold');
});
