'use strict';

const {runStreamPage} = require('./helpers/stream-page');

// The shipped app owns prompt preparation, transport and commits. Only the HTTP boundary supplies replies.
async function worldBookScenarios() {
  const assert = window.assert;
  const storedBeforeBuild = await YeyuRepository.load();
  const originalSaveData = saveData;
  let buildSaveCalls = 0;
  saveData = function (...args) {
    buildSaveCalls++;
    return originalSaveData(...args);
  };
  D = defaults();
  D.currentCharId = 'not-visible';
  Object.assign(D.settings.providers[0], {apiUrl: 'https://api.example.test/v1', apiKey: 'key', model: 'test-model'});
  D.settings.streamOutput = false;
  D.settings.chatCompletionPresetInUse = presetRawDefault();
  // This fixture has no continuation control text, so only the continued assistant body ends the payload.
  D.settings.chatCompletionPresetInUse.continue_nudge_prompt = '';
  for (const prompt of D.settings.chatCompletionPresetInUse.prompts) {
    if (!prompt.marker) prompt.content = '';
    if (prompt.identifier === 'main') prompt.content = 'FIXED_SYSTEM_PREFIX';
    if (prompt.identifier === 'jailbreak') prompt.content = 'POST_HISTORY';
  }
  setGenerationState('streaming');
  function normalized(id, fields) {
    return normalizeWBEntry(Object.assign({id, enabled: true, probability: 100, useProbability: true, order: 100}, fields));
  }

  // SillyTavern DEFAULT_DEPTH: an in-chat entry without depth sits four messages up; an explicit 0 stays.
  assert.strictEqual(normalizeWBEntry({keys: ['k'], content: 'x', extensions: {position: 4}}).depth, 4, '@D 条目缺 depth 时必须按 4 放置');
  assert.strictEqual(normalizeWBEntry({keys: ['k'], content: 'x', position: 4, depth: 0}).depth, 0, '显式 depth 0 不得被改写');

  const sentinels = {
    stableBefore: 'SENTINEL_A_BEFORE_CHAR',
    stableAfter: 'SENTINEL_A_AFTER_CHAR',
    stableInChat: 'SENTINEL_A_IN_CHAT_D0',
    stableBeforeUser: 'SENTINEL_A_BEFORE_USER',
    dynamicBefore: 'SENTINEL_B_BEFORE_CHAR',
    dynamicAfter: 'SENTINEL_B_AFTER_CHAR',
    dynamicInChat: 'SENTINEL_B_IN_CHAT_D1',
    dynamicBeforeUser: 'SENTINEL_B_BEFORE_USER',
    depthFive: 'SENTINEL_IN_CHAT_D5',
    depthTwenty: 'SENTINEL_IN_CHAT_D20',
    alias: 'SENTINEL_CHINESE_ALIAS',
    recursiveSeed: 'RECURSION_TARGET_KEY',
    recursive: 'SENTINEL_RECURSIVE',
  };

  const entries = [
    normalized('a-before', {constant: true, position: 'before_char', content: sentinels.stableBefore, order: 10}),
    normalized('a-after', {constant: true, position: 'after_char', content: sentinels.stableAfter, order: 20}),
    normalized('a-chat', {constant: true, position: 'in_chat', role: 'system', depth: 0, content: sentinels.stableInChat, order: 30}),
    normalized('a-user', {constant: true, position: 'before_user', content: sentinels.stableBeforeUser, order: 40}),
    normalized('b-before', {key: ['SCAN_TRIGGER'], position: 'before_char', content: sentinels.dynamicBefore, order: 50}),
    normalized('b-after', {key: ['SCAN_TRIGGER'], position: 'after_char', content: sentinels.dynamicAfter, order: 60}),
    normalized('b-chat', {key: ['SCAN_TRIGGER'], position: 'in_chat', role: 'user', depth: 1, content: sentinels.dynamicInChat, order: 70}),
    normalized('b-user', {key: ['SCAN_TRIGGER'], position: 'before_user', content: sentinels.dynamicBeforeUser, order: 80}),
    normalized('depth-five', {
      key: ['SCAN_TRIGGER'],
      position: 'in_chat',
      role: 'assistant',
      depth: 5,
      content: sentinels.depthFive,
      order: 90,
    }),
    normalized('depth-twenty', {
      key: ['SCAN_TRIGGER'],
      position: 'in_chat',
      role: 'system',
      depth: 20,
      content: sentinels.depthTwenty,
      order: 100,
    }),
    normalized('alias', {
      key: ['english-trigger'],
      keyAliasMap: {'english-trigger': ['中文别名触发']},
      position: 'after_char',
      content: sentinels.alias,
      order: 110,
    }),
    normalized('recursive-seed', {key: ['SCAN_TRIGGER'], position: 'after_char', content: sentinels.recursiveSeed, order: 120}),
    normalized('recursive-target', {key: ['RECURSION_TARGET_KEY'], position: 'after_char', content: sentinels.recursive, order: 130}),
  ];

  Object.assign(D.settings, {maxContextTokens: 0, maxTokens: 0, useMemory: false, enhancePrompt: '', auxPrompt: '', authorsNote: ''});
  D.worldBook = {
    scan_depth: 20,
    token_budget: 0,
    recursive: true,
    categories: [{id: 'qa', settings: {scan_depth: 20, token_budget: 0, recursive: true, caseSensitive: false}, entries}],
    globalCategoryIds: ['qa'],
  };

  {
    const originalWorldBook = D.worldBook;
    const category = {
      id: 'scan-audit',
      settings: normalizeWBSettings({scan_depth: 0}),
      entries: [
        normalized('old-key', {key: ['OLDER_TRIGGER'], content: 'OLDER_MATCH'}),
        normalized('injected-key', {key: ['INJECT_TRIGGER'], content: 'INJECT_MATCH'}),
      ],
    };
    D.worldBook = {scan_depth: 2, token_budget: 0, recursive: false, categories: [category], globalCategoryIds: [category.id]};
    const messages = [
      {role: 'user', content: 'OLDER_TRIGGER'},
      {role: 'assistant', content: 'LATEST'},
    ];
    const actual = buildMessages(
      {id: 'scan-audit', name: 'QA_CHAR', extensions: {}},
      messages,
      {id: 'scan-audit', msgs: messages},
      {worldBookScanPrompts: ['INJECT_TRIGGER']}
    );
    const contents = actual.messages.map(row => row.content).join('\n');
    assert.ok(contents.includes('OLDER_MATCH'), '书级深度 0 必须回退全局，扫描注入不得挤掉真实消息');
    assert.ok(contents.includes('INJECT_MATCH'), '额外扫描文本仍须激活条目');
    category.entries = [
      normalized('macro-primary', {key: ['{{char}}'], content: 'PRIMARY_MACRO'}),
      normalized('macro-secondary', {key: ['OLDER_TRIGGER'], keysecondary: ['{{char}}'], selective: true, content: 'SECONDARY_MACRO'}),
      normalized('macro-recursion-seed', {key: ['OLDER_TRIGGER'], content: '{{char}}'}),
      normalized('macro-recursion-target', {key: ['QA_CHAR'], content: 'RECURSIVE_MACRO'}),
    ];
    D.worldBook.recursive = true;
    const macroMessages = [{role: 'user', content: 'OLDER_TRIGGER'}];
    const macroBuilt = buildMessages(
      {id: 'scan-audit', name: 'QA_CHAR', extensions: {}},
      macroMessages,
      {id: 'macro-scan', msgs: macroMessages},
      {}
    );
    const macroContents = macroBuilt.messages.map(row => row.content).join('\n');
    for (const expected of ['PRIMARY_MACRO', 'SECONDARY_MACRO', 'RECURSIVE_MACRO'])
      assert.ok(macroContents.includes(expected), '关键词和递归扫描必须使用展开后的宏：' + expected);
    D.worldBook.case_sensitive = true;
    D.worldBook.match_whole_words = true;
    const glossaryEntry = normalized('glossary', {key: ['Alice'], content: 'NAME'});
    assert.strictEqual(wbEntryMatchesText(glossaryEntry, 'alice', 'scan-audit'), false);
    assert.strictEqual(wbEntryMatchesText(glossaryEntry, 'AliceExtra', 'scan-audit'), false);
    assert.strictEqual(wbEntryMatchesText(glossaryEntry, 'Alice', 'scan-audit'), true);
    D.worldBook = originalWorldBook;
  }

  // ST populationInjectionPrompts: entries sharing a depth and role reach the model as one message.
  {
    const originalWorldBook = D.worldBook;
    const category = {
      id: 'depth-merge',
      settings: normalizeWBSettings({}),
      entries: [
        normalized('merge-one', {constant: true, position: 'in_chat', role: 'system', depth: 1, content: 'ENTRY_ONE', order: 10}),
        normalized('merge-two', {constant: true, position: 'in_chat', role: 'system', depth: 1, content: 'ENTRY_TWO', order: 20}),
        normalized('merge-user', {constant: true, position: 'in_chat', role: 'user', depth: 1, content: 'ENTRY_USER', order: 30}),
      ],
    };
    D.worldBook = {scan_depth: 2, token_budget: 0, recursive: false, categories: [category], globalCategoryIds: [category.id]};
    const messages = [
      {role: 'user', content: 'HISTORY_USER'},
      {role: 'assistant', content: 'HISTORY_ASSISTANT'},
    ];
    const built = buildMessages({id: 'depth-merge', name: 'QA_CHAR', extensions: {}}, messages, {id: 'depth-merge', msgs: messages}, {});
    const rows = built.messages.map(row => ({role: row.role, content: row.content}));
    const assistantAt = rows.findIndex(row => row.content === 'HISTORY_ASSISTANT');
    assert.deepStrictEqual(
      rows.slice(assistantAt - 2, assistantAt),
      [
        {role: 'user', content: 'ENTRY_USER'},
        {role: 'system', content: 'ENTRY_ONE\nENTRY_TWO'},
      ],
      '同深度同角色的世界书条目必须按原文合成一条消息'
    );
    assert.strictEqual(rows[assistantAt - 3].content, 'HISTORY_USER', '同深度只能插入两条消息');
    D.worldBook = originalWorldBook;
  }

  function makeConversation(id) {
    const messages = [
      {role: 'user', content: 'QA_HISTORY_USER', seq: 1},
      {role: 'assistant', content: 'QA_HISTORY_ASSISTANT', seq: 2},
      {role: 'user', content: 'SCAN_TRIGGER 与 中文别名触发', seq: 3},
    ];
    return {messages, session: Object.assign(createBlankSession('World book', id), {msgs: messages, nextMessageSeq: 4})};
  }

  const previewFixture = makeConversation('worldbook-preview');
  const preview = buildMessages(
    {id: 'char', name: 'QA_CHAR', description: 'CHARACTER_CORE', extensions: {}},
    previewFixture.messages,
    previewFixture.session,
    {}
  );
  const committed = buildMessages(
    {id: 'char', name: 'QA_CHAR', description: 'CHARACTER_CORE', extensions: {}},
    previewFixture.messages,
    previewFixture.session,
    {commit: true}
  );
  assert.deepStrictEqual(preview.messages, committed.messages, '预览与实际 transport messages[] 不一致');
  const expectedPipelineStages = [
    'fixed-system',
    'persona',
    'worldbook-before-char',
    'character-card',
    'worldbook-after-char',
    'examples',
    'token-budget',
    'memory',
    'worldbook-in-chat',
    'worldbook-before-user',
    'chat-history',
    'memory-tail',
    'depth-prompt',
    'story-direction',
    'post-history',
    'cache-commit',
  ];
  assert.deepStrictEqual(
    preview.pipelineStages.map(stage => stage.id),
    expectedPipelineStages,
    '预览 Prompt 流水线阶段顺序失真'
  );
  assert.deepStrictEqual(committed.pipelineStages, preview.pipelineStages, '预览与实际发送必须经过同一 Prompt 流水线');

  saveData = originalSaveData;
  assert.strictEqual(buildSaveCalls, 0, '构建阶段不得安排延迟保存');
  assert.deepStrictEqual(await YeyuRepository.load(), storedBeforeBuild, '构建阶段不得写入持久库');

  const payload = committed.messages.map(message => ({role: message.role, content: message.content}));
  for (const sentinel of Object.values(sentinels)) {
    const count = payload.reduce((total, message) => total + (String(message.content || '').split(sentinel).length - 1), 0);
    assert.strictEqual(count, 1, `${sentinel} 在最终 messages[] 中必须恰好出现一次`);
  }

  const indexOf = text => payload.findIndex(message => String(message.content || '').includes(text));
  const coreIndex = indexOf('CHARACTER_CORE');
  assert.ok(indexOf(sentinels.stableBefore) < coreIndex && indexOf(sentinels.dynamicBefore) < coreIndex, 'before_char 未位于角色核心之前');
  assert.ok(coreIndex < indexOf(sentinels.stableAfter) && coreIndex < indexOf(sentinels.dynamicAfter), 'after_char 必须位于角色核心之后');
  const latestUserIndex = payload.findIndex(message => message.role === 'user' && message.content === 'SCAN_TRIGGER 与 中文别名触发');
  assert.strictEqual(indexOf(sentinels.stableBeforeUser), latestUserIndex - 1, 'before_user 未紧邻最新真实 user 消息');
  assert.strictEqual(indexOf(sentinels.dynamicBeforeUser), latestUserIndex - 1, '两组 before_user 必须保持同一紧邻层且各出现一次');
  assert.ok(
    indexOf(sentinels.stableInChat) > latestUserIndex && indexOf(sentinels.stableInChat) < indexOf('POST_HISTORY'),
    'in_chat depth=0 未处于聊天末端和发送后指令之前'
  );
  assert.strictEqual(payload[indexOf(sentinels.stableInChat)].role, 'system');
  assert.strictEqual(payload[indexOf(sentinels.dynamicInChat)].role, 'user');
  assert.strictEqual(payload[indexOf(sentinels.depthFive)].role, 'assistant');
  assert.strictEqual(payload[indexOf(sentinels.depthTwenty)].role, 'system');
  assert.ok(indexOf(sentinels.dynamicInChat) < indexOf(sentinels.stableInChat), 'depth=1 没有比 depth=0 更早');
  assert.ok(indexOf(sentinels.depthFive) <= indexOf(sentinels.dynamicInChat), 'depth=5 没有继续向更早聊天位置移动');
  assert.ok(indexOf(sentinels.depthTwenty) > indexOf(sentinels.dynamicAfter), '大深度 in_chat 越过了固定系统前缀');

  assert.strictEqual(committed.worldBookMetrics.injected, entries.length);
  assert.strictEqual(committed.worldBookMetrics.dropped, 0);

  async function assertAssistantMessageMetricCommit() {
    const char = {id: 'metrics-char', name: '统计测试角色'};
    const session = Object.assign(createBlankSession('Metrics', 'metrics-session'), {
      msgs: [{role: 'user', seq: 1, content: '触发世界书的提问'}],
      nextMessageSeq: 2,
    });
    D.currentCharId = char.id;
    D.characters = [char];
    D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
    const actualMetrics = structuredClone(committed.worldBookMetrics);
    const actualTarget = {charId: char.id, sessionId: session.id, mode: 'new', wbMetrics: actualMetrics};
    const actualMetricsBefore = JSON.stringify(actualMetrics);
    await commitGeneratedResponse(actualTarget, '世界书统计对应的正式回复', {});
    const actualReply = session.msgs[1];
    assert.strictEqual(session.msgs[0].worldBookMetrics, undefined, '运行时快照仍只属于最新 user，不能写回用户消息');
    assert.strictEqual(JSON.stringify(actualMetrics), actualMetricsBefore, '提交统计不能回写请求阶段的原始指标');
    assert.notStrictEqual(actualReply.worldBookMetrics, actualMetrics, '助手消息必须持有独立的精简统计副本');
    for (const key of ['matched', 'activated', 'injected', 'dropped', 'tokens'])
      assert.strictEqual(actualReply.worldBookMetrics[key], actualMetrics[key], `${key} 必须与实际注入统计一致`);

    const zeroTarget = {
      charId: char.id,
      sessionId: session.id,
      mode: 'new',
      wbMetrics: {matched: 0, activated: 0, injected: 0, dropped: 0, tokens: 0, details: []},
    };
    await commitGeneratedResponse(zeroTarget, '没有触发世界书的回复', {});
    for (const key of ['matched', 'activated', 'injected', 'dropped', 'tokens'])
      assert.strictEqual(session.msgs[2].worldBookMetrics[key], 0, `未触发世界书时 ${key} 必须如实保存为 0`);
    const stored = await YeyuRepository.load();
    const savedMessages = stored.data.chats[char.id].sessions[0].msgs;
    assert.deepStrictEqual(
      savedMessages.map(message => message.worldBookMetrics),
      session.msgs.map(message => message.worldBookMetrics),
      '世界书统计必须与正式助手消息一起持久保存'
    );
  }

  // 前缀位置优先输出稳定条目以延长缓存前缀；组内仍按原全局顺序，其他位置保持原顺序。
  function assertOrderedText(text, expected, label) {
    let previous = -1;
    for (const sentinel of expected) {
      const index = String(text).indexOf(sentinel);
      assert.ok(index > previous, `${label} 未按全局 order 保持 ${sentinel} 的顺序`);
      previous = index;
    }
  }

  function assertPositionPriority(position) {
    const prefix = `ORDER_${position.toUpperCase()}`;
    const sentinel = {
      low: `${prefix}_DYNAMIC_LOW`,
      dynamicEqual: `${prefix}_DYNAMIC_EQUAL`,
      stableEqual: `${prefix}_STABLE_EQUAL`,
      mid: `${prefix}_DYNAMIC_MID`,
      high: `${prefix}_STABLE_HIGH`,
    };
    // Official tie-break. SillyTavern 1.19.0 world-info.js sorts the activated set
    // with `const sortFn = (a, b) => b.order - a.order;` and then `unshift`s each entry into
    // its slot. Array.prototype.sort is stable, so two entries with the same order keep their
    // activation order through the sort and are reversed by the unshift. dynamic-equal is
    // declared before stable-equal in the book, therefore stable-equal must come out first.
    // The previous expectation (activation order preserved for ties) was the old Yeyu
    // ascending push and is not the official arrangement.
    const expected = [sentinel.low, sentinel.stableEqual, sentinel.dynamicEqual, sentinel.mid, sentinel.high];
    const roles = ['system', 'assistant', 'user', 'system', 'assistant'];
    const rows = [
      normalized(`${position}-dynamic-low`, {key: ['ORDER_TRIGGER'], position, content: sentinel.low, order: 10, role: 'system', depth: 0}),
      normalized(`${position}-dynamic-equal`, {
        key: ['ORDER_TRIGGER'],
        position,
        content: sentinel.dynamicEqual,
        order: 50,
        role: 'user',
        depth: 0,
      }),
      normalized(`${position}-stable-equal`, {
        constant: true,
        position,
        content: sentinel.stableEqual,
        order: 50,
        role: 'assistant',
        depth: 0,
      }),
      normalized(`${position}-dynamic-mid`, {key: ['ORDER_TRIGGER'], position, content: sentinel.mid, order: 60, role: 'system', depth: 0}),
      normalized(`${position}-stable-high`, {constant: true, position, content: sentinel.high, order: 90, role: 'assistant', depth: 0}),
    ];
    const previousBook = D.worldBook;
    D.worldBook = {
      scan_depth: 20,
      token_budget: 0,
      recursive: false,
      categories: [
        {id: `order-${position}`, settings: {scan_depth: 20, token_budget: 0, recursive: false, caseSensitive: false}, entries: rows},
      ],
      globalCategoryIds: [`order-${position}`],
    };
    const fixture = makeConversation(`order-${position}`);
    fixture.messages[2].content = 'ORDER_TRIGGER';
    const resolved = resolveWorldBook([{role: 'user', text: 'ORDER_TRIGGER'}], 'char', fixture.session);
    const resolvedRows =
      position === 'before_char'
        ? resolved.beforeCharItems
        : position === 'after_char'
          ? resolved.afterCharItems
          : position === 'before_user'
            ? resolved.beforeUserItems
            : Array.from(resolved.inChat.values()).flat();
    assert.deepStrictEqual(
      resolvedRows.map(row => row.content),
      expected,
      `${position} resolveWorldBook 顺序失真`
    );
    const built = buildMessages(
      {id: 'char', name: 'QA_CHAR', description: 'CHARACTER_CORE', extensions: {}},
      fixture.messages,
      fixture.session,
      {commit: true}
    );
    const flat = built.messages.map((message, index) => ({index, role: message.role, content: String(message.content || '')}));
    if (position === 'in_chat') {
      const matches = expected.map(sentinel => flat.find(message => message.content.includes(sentinel)));
      assert.ok(matches.every(Boolean), 'in_chat 少了排序夹具');
      assert.deepStrictEqual(
        matches.map(message => message.role),
        roles,
        'in_chat role 映射失真'
      );
      // Same depth and role share one message (entry order kept inside it); ST inserts assistant, user, system.
      const byRole = role => matches.filter(message => message.role === role);
      ['system', 'assistant', 'user'].forEach(role => {
        assert.strictEqual(new Set(byRole(role).map(message => message.index)).size, 1, `in_chat 同深度的 ${role} 条目必须合成一条消息`);
        assertOrderedText(
          byRole(role)[0].content,
          expected.filter((_, index) => roles[index] === role),
          `in_chat ${role}`
        );
      });
      assert.ok(
        byRole('assistant')[0].index < byRole('user')[0].index && byRole('user')[0].index < byRole('system')[0].index,
        'in_chat 同 depth 角色顺序失真'
      );
    } else {
      const joined = flat.map(message => message.content).join('\n');
      const injectedOrder =
        position === 'before_char' || position === 'after_char'
          ? [sentinel.stableEqual, sentinel.high, sentinel.low, sentinel.dynamicEqual, sentinel.mid]
          : expected;
      assertOrderedText(joined, injectedOrder, position);
      const roleRows = expected.map(sentinel => flat.find(message => message.content.includes(sentinel)));
      assert.ok(
        roleRows.every(message => message && message.role === 'system'),
        `${position} 必须使用 system role`
      );
      if (position === 'before_user') {
        const latestIndex = flat.findIndex(message => message.role === 'user' && message.content === 'ORDER_TRIGGER');
        assert.strictEqual(roleRows[0].index, latestIndex - 1, 'before_user 整组未紧邻最新 user');
      }
    }
    D.worldBook = previousBook;
  }

  for (const position of ['before_char', 'after_char', 'before_user', 'in_chat']) assertPositionPriority(position);

  // 同一输入的重复构建必须完全一致（按轮种子确定性，不依赖持久化快照）。
  const replayFixture = makeConversation('worldbook-replay');
  const replayFirst = buildMessages(
    {id: 'char', name: 'QA_CHAR', description: 'CHARACTER_CORE', extensions: {}},
    replayFixture.messages,
    replayFixture.session,
    {commit: true}
  );
  const replaySecond = buildMessages(
    {id: 'char', name: 'QA_CHAR', description: 'CHARACTER_CORE', extensions: {}},
    replayFixture.messages,
    replayFixture.session,
    {commit: true}
  );
  assert.deepStrictEqual(replaySecond.messages, replayFirst.messages, '相同输入的重复构建必须产出一致的 outbound payload');

  // Token 预算丢弃必须整条生效，指标与最终请求一致且没有半段残留。
  const originalBook = D.worldBook;
  D.worldBook = {
    scan_depth: 20,
    token_budget: 4,
    recursive: false,
    categories: [
      {
        id: 'budget',
        settings: {scan_depth: 20, token_budget: 0, recursive: false},
        entries: [
          normalized('budget-keep', {key: ['BUDGET_TRIGGER'], position: 'after_char', content: 'LATIN123'}),
          normalized('budget-drop', {key: ['BUDGET_TRIGGER'], position: 'after_char', content: '中文世界设定条目'}),
        ],
      },
    ],
    globalCategoryIds: ['budget'],
  };
  const budget = resolveWorldBook([{role: 'user', text: 'BUDGET_TRIGGER'}], 'char', {id: 'budget-session', msgs: [{role: 'user'}]});
  assert.strictEqual(budget.matchedCount, 2);
  assert.strictEqual(budget.activatedCount, 2);
  assert.strictEqual(budget.count, 1);
  assert.strictEqual(budget.droppedCount, 1);
  assert.ok(budget.afterChar.includes('LATIN123') && !budget.afterChar.includes('中文世界设定条目'));
  assert.ok(
    Math.ceil('中文世界设定条目'.length * 0.4) <= 4 && estTokens('中文世界设定条目') > 4,
    '世界书预算夹具必须覆盖旧口径会放行、当前口径会丢弃的中文条目'
  );
  assert.ok(budget.injectedTokens <= 4 && budget.details.some(detail => detail.id === 'budget-drop' && detail.status === 'budget-dropped'));

  D.worldBook.token_budget = 0;
  D.worldBook.budget_percent = 10;
  const percentBudget = resolveWorldBook(
    [{role: 'user', text: 'BUDGET_TRIGGER'}],
    'char',
    {id: 'percent-budget-session', msgs: [{role: 'user'}]},
    {maxContext: 40}
  );
  assert.strictEqual(percentBudget.count, budget.count);
  assert.strictEqual(percentBudget.injectedTokens, budget.injectedTokens, '10% of 40 must match the fixed budget of 4');
  assert.strictEqual(
    resolveWorldBook([{role: 'user', text: 'BUDGET_TRIGGER'}], 'char', {id: 'uncapped-percent-session', msgs: [{role: 'user'}]}).count,
    2,
    'percentage alone does not impose a budget'
  );
  D.worldBook = originalBook;

  // 历史编辑／删除失效必须清除世界书置顶/冷却运行时。
  const invalidatedSession = {msgs: [{role: 'user', content: '正文'}], worldBookRuntime: {sticky: {key: 2}}};
  D.chats = {char: {sessions: [invalidatedSession]}};
  assert.strictEqual(invalidateCacheContexts('char', 0, true), true);
  assert.strictEqual(invalidatedSession.worldBookRuntime, undefined);

  async function assertOutboundTransportIdentity() {
    const fixture = makeConversation('worldbook-transport');
    fixture.messages.push({role: 'assistant', content: 'CONTINUE_BASE', seq: 4});
    fixture.session.msgs = fixture.messages;
    fixture.session.nextMessageSeq = 5;
    const char = {id: 'transport-char', name: 'QA_CHAR', description: 'CHARACTER_CORE', extensions: {}};
    const originalCharacters = D.characters;
    const originalChats = D.chats;
    const captured = [];
    D.currentCharId = char.id;
    D.characters = [char];
    D.chats = {[char.id]: {activeSid: fixture.session.id, sessions: [fixture.session]}};
    const originalFetch = window.fetch;
    window.fetch = async (_url, options) => {
      captured.push(JSON.parse(options.body).messages);
      return Response.json({choices: [{message: {content: 'TRANSPORT_REPLY'}, finish_reason: 'stop'}]});
    };
    try {
      const preview = await assembleGenerationPrompt(
        char,
        fixture.session,
        fixture.messages,
        {charId: char.id, sessionId: fixture.session.id, mode: 'new'},
        {preview: true}
      );
      const previewMessages = structuredClone(preview.messages);
      await doAPICall({target: {charId: char.id, sessionId: fixture.session.id, mode: 'new'}});
      assert.deepStrictEqual(captured[0], previewMessages, '真实 doAPICall outbound payload 与预览 buildMessages 不一致');

      entries.find(entry => entry.id === 'b-after').content = 'MUTATED_TRANSPORT_AFTER_SEND';
      await doAPICall({target: {charId: char.id, sessionId: fixture.session.id, mode: 'regenerate', messageIndex: 3, messageSeq: 4}});
      assert.ok(JSON.stringify(captured[1]) !== JSON.stringify(captured[0]), '重生成必须重新评估世界书，不得复用旧 outbound 快照');
      assert.ok(
        captured[1].some(message => String(message.content || '').includes('MUTATED_TRANSPORT_AFTER_SEND')),
        '重生成没有带入重新评估后的世界书正文'
      );
      assert.ok(!captured[1].some(message => String(message.content || '').includes(sentinels.dynamicAfter)), '重生成仍携带旧快照正文');

      await doAPICall({target: {charId: char.id, sessionId: fixture.session.id, mode: 'continue', messageIndex: 3, messageSeq: 4}});
      assert.deepStrictEqual(
        captured[2].at(-1),
        {role: 'assistant', content: 'TRANSPORT_REPLY'},
        '继续生成必须把被续写正文移到请求尾部，且不注入旧独立控制提示'
      );
      assert.ok(
        captured[2].some(message => String(message.content || '').includes('MUTATED_TRANSPORT_AFTER_SEND')),
        '继续生成必须按当前世界书重扫并带入改动后的正文'
      );
      for (const sentinel of Object.values(sentinels).filter(value => value !== sentinels.dynamicAfter)) {
        assert.ok(
          captured[2].some(message => String(message.content || '').includes(sentinel)),
          `继续生成重扫后丢失仍然命中的世界书：${sentinel}`
        );
      }
      assert.ok(
        captured.every(messages => messages.every(message => Object.keys(message).sort().join(',') === 'content,role')),
        'outbound payload 含有非 transport 字段'
      );
    } finally {
      window.fetch = originalFetch;
      entries.find(entry => entry.id === 'b-after').content = sentinels.dynamicAfter;
      D.characters = originalCharacters;
      D.chats = originalChats;
    }
  }

  async function assertContinuationWorldBookRescan() {
    const frozenGroupEntry = normalized('continuation-group-frozen', {
      key: ['SCAN_TRIGGER'],
      position: 'after_char',
      content: 'FROZEN_GROUP_WINNER',
      group: 'continuation-exclusive',
      groupWeight: 1,
      order: 135,
    });
    const newGroupCompetitor = normalized('continuation-group-new', {
      key: ['CONTINUATION_SCAN_KEY'],
      position: 'after_char',
      content: 'NEW_GROUP_COMPETITOR',
      group: 'continuation-exclusive',
      groupWeight: 1000000,
      order: 136,
    });
    const continuationCategory = {
      id: 'continuation-category',
      settings: {scan_depth: 20, token_budget: 0, recursive: false, caseSensitive: false},
      entries: [
        normalized('b-after', {
          key: ['CONTINUATION_SCAN_KEY'],
          position: 'in_chat',
          depth: 0,
          content: 'CONTINUATION_WORLD_BOOK',
          order: 140,
        }),
      ],
    };
    entries.push(frozenGroupEntry, newGroupCompetitor);
    D.worldBook.categories.push(continuationCategory);
    D.worldBook.globalCategoryIds.push(continuationCategory.id);
    const fixture = makeConversation('continuation-worldbook-rescan');
    const char = {id: 'continuation-char', name: 'CONTINUATION_QA_CHAR', extensions: {}};
    const originalCharacters = D.characters;
    const originalChats = D.chats;
    const originalFetch = window.fetch;
    try {
      const firstBuild = buildMessages(char, fixture.messages, fixture.session, {commit: true});
      assert.ok(
        !firstBuild.messages.some(message => String(message.content || '').includes('CONTINUATION_WORLD_BOOK')),
        '首次生成前不得提前激活续写正文关键词'
      );
      fixture.messages.push({role: 'assistant', content: '断点正文出现 CONTINUATION_SCAN_KEY', seq: 4});
      fixture.session.msgs = fixture.messages;
      fixture.session.nextMessageSeq = 5;
      const captured = [];
      D.currentCharId = char.id;
      D.characters = [char];
      D.chats = {[char.id]: {activeSid: fixture.session.id, sessions: [fixture.session]}};
      window.fetch = async (_url, options) => {
        captured.push(JSON.parse(options.body).messages);
        return Response.json({choices: [{message: {content: '接续正文'}, finish_reason: 'stop'}]});
      };
      await doAPICall({target: {charId: char.id, sessionId: fixture.session.id, mode: 'continue', messageIndex: 3, messageSeq: 4}});
      const joined = captured[0].map(message => message.content).join('\n');
      assert.ok(joined.includes(sentinels.dynamicAfter), '续写全量重扫不得丢失仍然命中的世界书');
      assert.ok(joined.includes('CONTINUATION_WORLD_BOOK'), '续写正文新关键词必须激活对应世界书条目');
      const winners = ['FROZEN_GROUP_WINNER', 'NEW_GROUP_COMPETITOR'].filter(value => joined.includes(value));
      assert.strictEqual(winners.length, 1, '同组条目每轮必须只决出一个赢家');
    } finally {
      entries.splice(-2, 2);
      D.worldBook.categories.pop();
      D.worldBook.globalCategoryIds.pop();
      D.characters = originalCharacters;
      D.chats = originalChats;
      window.fetch = originalFetch;
    }
  }

  await assertOutboundTransportIdentity();
  await assertContinuationWorldBookRescan();
  await assertAssistantMessageMetricCommit();
}

runStreamPage(scenario => scenario('world book positions, transport and metrics', 'await (' + worldBookScenarios.toString() + ')()'));
