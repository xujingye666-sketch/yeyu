'use strict';

// A streamed reply through the loaded app: the preview bubble repaints as text arrives and finishes on the
// final display, a reply prefix survives the stream, and a committed stream writes back to the same message
// (continue appends, regenerate replaces, reasoning stays out of the body).
const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {

  await scenario('流式预览逐步刷新', `
    const {target} = await reset({visible: true});
    D.personas = [{id: 'p1', name: '测试用户', desc: ''}];
    D.activePersonaId = 'p1';
    const slotText = () => {
      const slot = document.querySelector('#chat-messages .stream-active-bubble .stream-content-slot');
      return slot ? slot.textContent : null;
    };
    // 每次内容槽文字变化记一笔，等价于逐次可见的刷新。
    const seen = [];
    const root = document.getElementById('chat-messages');
    const observer = new MutationObserver(() => {
      const text = slotText();
      if (text !== null && seen[seen.length - 1] !== text) seen.push(text);
    });
    observer.observe(root, {childList: true, subtree: true, characterData: true});
    let paintedBeforeSecondChunk = null;
    const result = await streamResponse(body([
      chunk('你好，'),
      () => { paintedBeforeSecondChunk = slotText(); },
      {delay: 400}, chunk('{{us'), {delay: 400}, chunk('er}}'), {delay: 400}, chunk('。'), done,
    ]), target, {deferCommit: true});
    await wait(50);
    observer.disconnect();
    assert.strictEqual(paintedBeforeSecondChunk, '你好，', '首个正文 chunk 到达后应立即刷新临时气泡');
    assert.ok(seen.length >= 3, '正常 SSE 应产生多次流式 DOM 更新：' + JSON.stringify(seen));
    assert.ok(seen.some(text => text.includes('测试用户') && !text.includes('{{user}}')), '累计文本完成占位符后应在流式显示中替换：' + JSON.stringify(seen));
    assert.strictEqual(result.display, '你好，测试用户。', '最终显示文本应与流式累计清理结果一致');
  `);

  await scenario('回复开头', `
    const {target} = await reset({visible: true});
    const result = await streamResponse(body([chunk('流式正文'), done]), {...target}, {deferCommit: true, responsePrefix: '固定开头：'});
    assert.strictEqual(result.content, '固定开头：流式正文', '真实流式结果必须带回请求时使用的回复开头');
    assert.strictEqual(result.display, '固定开头：流式正文', '流式显示必须包含回复开头');
    const prefixed = await streamResponse(body([chunk('固定'), chunk('开头：供应商正文'), done]), {...target}, {deferCommit: true, responsePrefix: '固定开头：'});
    assert.strictEqual(prefixed.content, '固定开头：供应商正文', '供应商跨分片返回已有前缀时不得重复拼接');
    assert.strictEqual(prefixed.display, prefixed.content);
  `);

  // 不走 deferCommit：流式结果经真实提交层写回会话里的同一条消息。
  await scenario('提交回同一条消息', `
    const {session, target: base} = await reset({visible: true});
    session.msgs = [{role: 'assistant', content: '原回复', time: 1, seq: 1}];
    session.nextMessageSeq = 2;
    renderChat();
    const target = {charId: 'c1', sessionId: 's1', messageIndex: 0, messageSeq: 1};
    await streamResponse(body([sse({choices: [{delta: {content: '后续'}}]}), done]), {...target, mode: 'continue'}, {});
    assert.strictEqual(session.msgs[0].content, '原回复后续', '续写必须接在原消息正文之后');
    assert.strictEqual(joinContinuationText('原回复。', '后续内容。'), '原回复。\\n\\n后续内容。', '原文已成句时续写另起段落');
    setGenerationState('streaming');
    await streamResponse(body([chunk('新回复')]), {...target, mode: 'regenerate'}, {});
    assert.strictEqual(session.msgs[0].content, '新回复', '重新生成必须替换原消息正文');
    setGenerationState('streaming');
    await streamResponse(body([sse({choices: [{delta: {reasoning_content: '内部分析', content: '纯正文'}}]})]), {...target, mode: 'regenerate'}, {});
    assert.strictEqual(session.msgs[0].content, '纯正文', 'reasoning_content 不得混入正文');
    assert.strictEqual(session.msgs[0].reasoning, '内部分析', 'reasoning_content 必须存入思考字段');
    assert.strictEqual(session.msgs.length, 1, '三次写回都落在同一条消息上');
    assert.ok(document.querySelector('#chat-messages [data-msg-seq="1"] .msg-bubble').textContent.includes('纯正文'), '提交后聊天里显示的是最终正文');
  `);
  console.log('streaming preview repaints, keeps the reply prefix and commits to the same message');
});
