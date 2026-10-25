'use strict';

const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
const objectiveA = '**【剧情目标】**\n目标:\n- 查清港口信号来源\n- 安全抵达旧钟楼\n支线:\n- 寻找遗失的徽章\n已完成:\n- 抵达港口';
const objectiveB = '  【剧情目标】  \n目标:\n- 解开旧钟楼机关\n支线:\n- 寻找遗失的徽章\n- 调查钟楼暗门\n已完成:\n- 抵达港口\n- 接受邀约\n- 找到暗门钥匙\n- 解开守门谜题';
const panelBlock = '[QUEST ACTIVATED: 抵达王都]\n[难度：危险]\n[目标：与幸存同学一起安全抵达王都]';
const replyA = '第一轮剧情。\n\n' + objectiveA;
const replyB = '第二轮剧情。\n\n' + panelBlock + '\n\n新的通告已经出现。\n\n' + objectiveB;

let browser;
let server;

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const {pageErrors, consoleErrors} = capturePageDiagnostics(page);
  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html', {waitUntil: 'load'});
  await waitForAppReady(page, {timeout: 15000});
  await page.waitForTimeout(450);

  const setup = await page.evaluate(async ({replyA, replyB, objectiveB}) => {
    D = defaults();
    D.settings.systemTpl = '';
    D.settings.enhancePrompt = '';
    D.settings.auxPrompt = '';
    D.settings.authorsNote = '';
    D.settings.useMemory = false;
    D.settings.maxContextTokens = 0;
    const char = {id: 'objective-char', name: '剧情目标测试角色', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '发送后测试要求', avatar_image: '', background_image: '', tags: [], extensions: {yeyu: {}}};
    const ledger = createBlankSession('账本验证', 'objective-ledger');
    ledger.msgs = [
      {seq: 1, role: 'user', content: '开始剧情'},
      {seq: 2, role: 'assistant', content: replyA, time: 1700000000000},
      {seq: 3, role: 'user', content: '推进剧情'},
      {seq: 4, role: 'assistant', content: replyB, time: 1700000001000},
      {seq: 5, role: 'user', content: '继续'}
    ];
    const automatic = createBlankSession('自动续写验证', 'objective-auto');
    automatic.msgs = [{seq: 1, role: 'user', content: '沿着这条支线调查。【至少 600 字】'}];
    const manual = createBlankSession('手动续写验证', 'objective-manual');
    manual.msgs = [{seq: 1, role: 'user', content: '继续调查旧钟楼'}, {seq: 2, role: 'assistant', content: replyA, time: 1700000002000}];
    const empty = createBlankSession('空方向验证', 'objective-empty');
    empty.msgs = [{seq: 1, role: 'user', content: '先观察四周'}];
    [ledger, automatic, manual, empty].forEach(ensureMessageSequences);
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions: [ledger, automatic, manual, empty], activeSid: ledger.id}};
    D.personas = [];
    await saveData();
    _generationState = 'idle';
    _memoryJobActive = false;
    const before = JSON.stringify(ledger.msgs);
    const built = buildMessages(char, ledger.msgs, ledger, {commit: false});
    const orderSession = JSON.parse(JSON.stringify(ledger));
    orderSession.storyDirection = {longTerm: '保持调查方向', queue: []};
    const previousStyleAuditHint = window.styleAuditHintForSession;
    window.styleAuditHintForSession = () => '避免重复句式';
    let orderedBuilt;
    try { orderedBuilt = buildMessages(char, orderSession.msgs, orderSession, {commit: false}); }
    finally { window.styleAuditHintForSession = previousStyleAuditHint; }
    const merged = StoryDirection.mergeContinuation(replyA, replyB, char);
    const messageIndex = (rows, prefix) => rows.messages.findIndex(row => String(row.content || '').startsWith(prefix));
    const postHistory = char.post_history_instructions;
    const orderedIndices = [
      messageIndex(orderedBuilt, '[剧情方向]\n'),
      messageIndex(orderedBuilt, '[文风审计] '),
      orderedBuilt.messages.findIndex(row => String(row.content || '').includes(postHistory))
    ];
    renderChat();
    updateChatUI();
    return {
      before,
      after: JSON.stringify(ledger.msgs),
      orderedIndices,
      merged: {objective: storyObjectiveMatches(merged).length, finalTail: merged.trim().endsWith(objectiveB.trim()), sourcePreserved: merged.includes('第一轮剧情。') && merged.includes('第二轮剧情。')},
      hasDirectionWithoutData: built.messages.some(row => String(row.content || '').startsWith('[剧情方向]\n')),
    };
  }, {replyA, replyB, objectiveB});

  assert.strictEqual(setup.after, setup.before, '渲染与锚构建不得改写消息原文');
  assert(setup.orderedIndices.every(index => index >= 0) && setup.orderedIndices.every((index, position, rows) => position === 0 || rows[position - 1] < index), '末端顺序必须为剧情方向→文风审计→发送后指令：' + JSON.stringify(setup.orderedIndices));
  assert.deepStrictEqual(setup.merged, {objective: 1, finalTail: true, sourcePreserved: true}, '续写显示副本合并正文，并只展示最新一组目标块');
  assert.strictEqual(setup.hasDirectionWithoutData, false, '没有设置剧情方向时不得注入方向消息');

  const manual = await page.evaluate(async ({objectiveB}) => {
    const char = getChar();
    const box = D.chats[char.id];
    const session = box.sessions.find(row => row.id === 'objective-manual');
    box.activeSid = session.id;
    renderChat();
    const requests = [];
    runAutoMemorySummary = async () => {};
    callDeepSeek = async function(messages, target) {
      requests.push({mode: target.mode, messages: messages.map(row => ({role: row.role, content: String(row.content || '')}))});
      const content = '手动续写新增正文，线索继续向前展开。\n\n' + objectiveB;
      return {content, display: content, reasoning: '', usage: null, finishReason: 'stop'};
    };
    setGenerationState('preparing');
    const target = {charId: char.id, sessionId: session.id, mode: 'continue', messageIndex: 1, messageSeq: 2};
    await doAPICall({target});
    setGenerationState('idle');
    const final = session.msgs[1].content;
    const extracted = StoryDirection.extractBlocks(final, char);
    const assistantRows = requests[0].messages.filter(row => row.role === 'assistant' && row.content.includes('第一轮剧情。'));
    return {
      modes: requests.map(row => row.mode),
      assistantRows,
      body: extracted.body,
      objectiveCount: storyObjectiveMatches(final).length,
      finalTail: final.trim().endsWith(objectiveB.trim()),
      sourcePreserved: final.includes('第一轮剧情。') && final.includes('手动续写新增正文')
    };
  }, {objectiveB});

  assert.deepStrictEqual(manual.modes, ['continue']);
  assert(manual.assistantRows.length === 1 && manual.assistantRows.every(row => !row.content.includes('【剧情目标】')), '手动续写请求必须剥离目标块');
  assert(!manual.body.includes('【剧情目标】'), '手动续写完成后的正文中部不得残留目标块');
  assert.deepStrictEqual({objective: manual.objectiveCount, tail: manual.finalTail, source: manual.sourcePreserved}, {objective: 2, tail: true, source: true}, '手动续写原文保留两次收到的目标块，显示副本剥离它们');

  const automatic = await page.evaluate(async ({replyA, objectiveA, objectiveB}) => {
    const char = getChar();
    const box = D.chats[char.id];
    const session = box.sessions.find(row => row.id === 'objective-auto');
    box.activeSid = session.id;
    session.storyDirection = {
      longTerm: '让调查始终围绕失踪案真相展开，并保留角色自行选择路线的空间。',
      queue: [
        {id: 'stage-1', text: '找到进入旧钟楼的可靠方法', budget: 1},
        {id: 'stage-2', text: '查明钟楼信号与失踪案的联系', budget: 2},
        {id: 'stage-3', text: '决定如何处理钟楼深处的秘密', budget: 4}
      ],
      activatedAfterUserSeq: 0
    };
    renderChat();
    const realToast = toast;
    const toasts = [];
    toast = function(message, type) { toasts.push({message: String(message), type: type}); return realToast(message, type); };
    const requests = [];
    runAutoMemorySummary = async () => {};
    callDeepSeek = async function(messages, target) {
      requests.push({mode: target.mode, messages: messages.map(row => ({role: row.role, content: String(row.content || '')}))});
      return {content: replyA, display: replyA, reasoning: '', usage: null, finishReason: 'stop'};
    };
    setGenerationState('preparing');
    const target = {charId: char.id, sessionId: session.id, mode: 'new'};
    await doAPICall({target: target});
    setGenerationState('idle');
    toast = realToast;
    const finalMessage = session.msgs[target.messageIndex];
    const directions = requests.map(request => {
      const row = request.messages.find(message => message.content.startsWith('[剧情方向]\n'));
      return row ? row.content : '';
    });
    const regeneration = buildMessages(char, session.msgs.slice(0, -1), session, {commit: false});
    const regenerationDirection = (regeneration.messages.find(message => String(message.content || '').startsWith('[剧情方向]\n')) || {}).content || '';
    const fullProgress = StoryDirection.progress(session, session.msgs);
    const rolledBackProgress = StoryDirection.progress(session, session.msgs.slice(0, -1));
    const editedBudget = StoryDirection.progress(session, session.msgs, {
      longTerm: session.storyDirection.longTerm,
      queue: [
        {id: 'stage-1', text: '找到进入旧钟楼的可靠方法', budget: 3},
        {id: 'stage-2', text: '查明钟楼信号与失踪案的联系', budget: 2}
      ],
      activatedAfterUserSeq: session.storyDirection.activatedAfterUserSeq
    });
    const branchRows = session.msgs.concat([
      {seq: 3, role: 'user', content: '转入仓库支线调查'},
      {seq: 4, role: 'assistant', content: '支线调查取得进展'}
    ]);
    const branchProgress = StoryDirection.progress(session, branchRows);
    const exhaustedRows = branchRows.concat([
      {seq: 5, role: 'user', content: '继续调查'},
      {seq: 6, role: 'assistant', content: '线索已经闭合'},
      {seq: 7, role: 'user', content: '深入钟楼'},
      {seq: 8, role: 'assistant', content: '发现第一层秘密'},
      {seq: 9, role: 'user', content: '继续确认'},
      {seq: 10, role: 'assistant', content: '确认第二层线索'},
      {seq: 11, role: 'user', content: '作出选择'},
      {seq: 12, role: 'assistant', content: '选择开始落定'},
      {seq: 13, role: 'user', content: '完成决定'},
      {seq: 14, role: 'assistant', content: '秘密已经处理'}
    ]);
    const exhaustedMessage = StoryDirection.messageForBuild(session, exhaustedRows);
    const independent = box.sessions.find(row => row.id === 'objective-empty');
    const missingBlockMerged = StoryDirection.mergeContinuation(replyA, '补充一段干净正文。\n\n' + objectiveB, char);
    return {
      requestModes: requests.map(request => request.mode),
      directions,
      regenerationDirection,
      toasts,
      finalContent: finalMessage.content,
      finalObjectiveCount: storyObjectiveMatches(finalMessage.content).length,
      finalTail: finalMessage.content.trim().endsWith(objectiveA.trim()),
      fullProgress: {consumed: fullProgress.consumed, current: fullProgress.current},
      liveDirection: copyJsonData(session.storyDirection),
      rolledBackProgress: {consumed: rolledBackProgress.consumed, current: rolledBackProgress.current},
      editedBudget: {consumed: editedBudget.consumed, current: editedBudget.current},
      branchProgress: {consumed: branchProgress.consumed, current: branchProgress.current},
      exhaustedMessage: exhaustedMessage && exhaustedMessage.content,
      independentDirection: StoryDirection.messageForBuild(independent, independent.msgs),
      blankDirection: StoryDirection.messageForBuild({storyDirection: {longTerm: '', queue: [], activatedAfterUserSeq: 0}}, []),
      missingBlockObjectiveCount: storyObjectiveMatches(missingBlockMerged).length,
      missingBlockUsesNewObjective: (storyObjectiveMatches(missingBlockMerged)[0].parsed.goals || [])[0] === '解开旧钟楼机关',
      missingBlockKeepsBodies: missingBlockMerged.includes('第一轮剧情。') && missingBlockMerged.includes('补充一段干净正文。')
    };
  }, {replyA, objectiveA, objectiveB});

  assert.deepStrictEqual(automatic.requestModes, ['new'], '字数要求不能自动触发额外生成');
  assert.strictEqual(automatic.directions.length, 1);
  assert.strictEqual(automatic.regenerationDirection, automatic.directions[0], '重新生成必须使用被替换回复之前的相同方向');
  assert.strictEqual(automatic.finalObjectiveCount, 1, '普通新生成只保留一次收到的目标块');
  assert.strictEqual(automatic.finalTail, true, '本次生成目标块位于原文末尾');
  assert.strictEqual(automatic.finalContent, replyA, '普通生成应原样保存模型正文');
  assert.deepStrictEqual(automatic.fullProgress, {consumed: 1, current: {id: 'stage-2', index: 1, text: '查明钟楼信号与失踪案的联系', budget: 2, remaining: 2}}, '一次普通生成只消耗一轮回复次数');
  assert.deepStrictEqual(automatic.liveDirection.roundOwners, [{userSeq: 1, targetId: 'stage-1'}], '已消耗回合必须归于生成时的目标');
  assert.strictEqual(automatic.liveDirection.trackedThroughUserSeq, 1, '回合归属账本必须记录已检查到的用户消息序号');
  assert.deepStrictEqual(automatic.rolledBackProgress, {consumed: 0, current: {id: 'stage-1', index: 0, text: '找到进入旧钟楼的可靠方法', budget: 1, remaining: 1}}, '删除末尾助手回复后必须自动回退目标进度');
  assert.deepStrictEqual(automatic.editedBudget, {consumed: 1, current: {id: 'stage-1', index: 0, text: '找到进入旧钟楼的可靠方法', budget: 3, remaining: 2}}, '修改目标预算必须从原激活基线重新计算');
  assert.deepStrictEqual(automatic.branchProgress, {consumed: 2, current: {id: 'stage-2', index: 1, text: '查明钟楼信号与失踪案的联系', budget: 2, remaining: 1}}, '普通剧情支线的一次用户回复必须正常计数');
  assert(automatic.exhaustedMessage.includes('长期方向') && !automatic.exhaustedMessage.includes('当前阶段目标'), '队列用完后必须只保留长期方向');
  assert.strictEqual(automatic.independentDirection, null, '不同会话不得共享剧情方向');
  assert.strictEqual(automatic.blankDirection, null, '长期方向与目标队列都为空时不得发送剧情方向消息');
  assert.deepStrictEqual(
    {objective: automatic.missingBlockObjectiveCount, newObjective: automatic.missingBlockUsesNewObjective, bodies: automatic.missingBlockKeepsBodies},
    {objective: 1, newObjective: true, bodies: true},
    '续写必须采用新目标块并保留两段正文'
  );

  await page.evaluate(() => {
    closeModal('story-objective-modal');
    const char = getChar();
    D.chats[char.id].activeSid = 'objective-empty';
    renderChat();
  });
  await page.locator('#chat-tools-toggle').click();
  await page.locator('.story-objective-btn').click();
  const panel = page.locator('#story-objective-modal');
  await panel.waitFor({state: 'visible'});
  await panel.locator('.story-direction-long-term-input').fill('保持调查节奏自然，不预设唯一解法。');
  await panel.locator('.story-direction-add').click();
  await panel.locator('.story-direction-add').click();
  const draftInputs = panel.locator('.story-direction-queue-row input[data-direction-field="text"]');
  await draftInputs.first().fill('先确认现场留下的三条线索');
  await panel.locator('.story-direction-queue-row input[data-direction-field="budget"]').first().fill('5');
  await panel.locator('.story-direction-save').click();
  await page.waitForFunction(() => {
    const char = getChar();
    const session = D.chats[char.id].sessions.find(row => row.id === 'objective-empty');
    return session && session.storyDirection && session.storyDirection.queue[0] && session.storyDirection.queue[0].text === '先确认现场留下的三条线索';
  });
  const savedDirection = await page.evaluate(() => {
    const char = getChar();
    const session = D.chats[char.id].sessions.find(row => row.id === 'objective-empty');
    return copyJsonData(session.storyDirection);
  });
  assert.strictEqual(savedDirection.longTerm, '保持调查节奏自然，不预设唯一解法。');
  assert.strictEqual(savedDirection.queue.length, 1, '保存时必须忽略空文本阶段目标');
  assert.strictEqual(savedDirection.queue[0].budget, 5);
  assert.strictEqual(savedDirection.activatedAfterUserSeq, 1, '首次保存队列必须记录当前普通用户消息作为激活基线');
  assert.strictEqual(savedDirection.trackedThroughUserSeq, 1, '首次保存队列必须从同一激活基线开始追踪新回合');
  assert.deepStrictEqual(savedDirection.roundOwners, [], '首次保存不得把设置前的历史回复归给新目标');

  await page.evaluate(() => flushPendingSave());
  await page.reload({waitUntil: 'load'});
  await waitForAppReady(page);
  const reloaded = await page.evaluate(() => {
    const sessions = D.chats['objective-char'].sessions;
    const automatic = sessions.find(row => row.id === 'objective-auto');
    const progress = StoryDirection.progress(automatic, automatic.msgs);
    return {
      savedDirection: sessions.find(row => row.id === 'objective-empty').storyDirection,
      generatedDirection: automatic.storyDirection,
      current: progress.current,
    };
  });
  assert.deepStrictEqual(reloaded.savedDirection, savedDirection, '编辑保存的剧情方向必须在页面重载后原样读回');
  assert.deepStrictEqual(reloaded.generatedDirection, automatic.liveDirection, '生成后的目标归属必须随消息保存并在重载后读回');
  assert.deepStrictEqual(reloaded.current, automatic.fullProgress.current, '重载后必须保持当前目标及剩余预算');

  assert.deepStrictEqual(pageErrors, [], '页面脚本错误：' + pageErrors.join('\n'));
  assert.deepStrictEqual(consoleErrors, [], '控制台错误：' + consoleErrors.join('\n'));
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
