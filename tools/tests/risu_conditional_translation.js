'use strict';
/* global assert -- installed by the real application page harness */
const {runStreamPage} = require('./helpers/stream-page');

// Keep every translation acceptance check on the loaded app, including Workers, message mutations,
// storage, cancellation and display. Only the completion transport returns a deterministic translation.
runStreamPage(async scenario => {
  await scenario('conditional translation', String.raw`
const nativeFetch = window.fetch;
function createApp(options) {
  cancelRisuExecutions();
  D = defaults();
  Object.assign(activeProviderForSettings(D.settings), {
    apiUrl: 'https://translation.example.test/v1', apiKey: 'synthetic-local', model: 'synthetic-model', reasoningEffort: 'off',
  });
  $('toasts').replaceChildren();
  const sent = [];
  window.fetch = async (url, init) => {
    if (!String(url).startsWith('https://translation.example.test/')) return nativeFetch(url, init);
    const body = JSON.parse(init.body), input = body.messages.at(-1).content;
    sent.push(input);
    return new Response(JSON.stringify({choices: [{message: {content: options.reply(input, sent.length)}, finish_reason: 'stop'}]}),
      {headers: {'content-type': 'application/json'}});
  };
  return {sent, get toasts() {
    return Array.from($('toasts').children, row => ({text: row.textContent, kind: row.classList.contains('err') ? 'err' : ''}));
  }};
}
function blankSession(id) {
  const session = createBlankSession('Translation', id);
  session.greetingChosen = true;
  session.creatorNotesSeen = true;
  return session;
}
const SCENES = {
  zero: '場面ゼロ：朝の光が差し込む。',
  oneCalm: '静かな気分で{{user}}を待つ。',
  oneStorm: '嵐の気分で{{user}}を見つめる。',
  elseBranch: '別の道を選んだ世界線。',
};
const TEMPLATE = [
  '序幕：{{user}}。',
  '{{#when::keep::scene::tis::0}}',
  SCENES.zero,
  '{{/when}}',
  '{{#when::keep::scene::tis::1}}',
  '場面いち。',
  '{{#when::keep::mood::tis::0}}',
  SCENES.oneCalm,
  '{{/when}}',
  '{{#when::keep::mood::tis::1}}',
  SCENES.oneStorm,
  '{{/when}}',
  '{{/when}}',
  '{{#when::keep::scene::tis::2}}',
  '場面に：終幕。',
  '{{:else}}',
  SCENES.elseBranch,
  '{{/when}}',
  '&&',
  '尾声。',
].join('\n');

function seedCharacter(options) {
  options = options || {};
  const char = {
    id: 'risu-1',
    name: '夜',
    first_mes: TEMPLATE,
    extensions: {
      risuai: {
        customScripts: options.scripts
          ? options.scripts
          : options.withTrigger
            ? [{ type: 'editdisplay', in: '&&', out: '<div class="paper"></div>', flag: 'g', ableFlag: true }]
            : [],
        toggles: 'scene=場面=select=零,一,二\nmood=気分=select=静,嵐',
      },
    },
    media_assets: [],
  };
  const session = blankSession('sess-1');
  session.risu = { globalVariables: Object.assign({ toggle_scene: '1', toggle_mood: '1' }, options.toggles || {}) };
  D.characters = [char];
  D.chats = { 'risu-1': { sessions: [session], activeSid: session.id } };
  D.currentCharId = 'risu-1';
  const message = {
    role: 'assistant',
    content: options.content == null ? TEMPLATE : options.content,
    opening: true,
    openingIndex: 0,
    seq: 1,
  };
  session.msgs.push(message);
  return { char, session, message };
}

// A stand-in translator that behaves like a real one: it rewrites the prose and carries the
// placeholders through, so the test can tell a translated span from an untouched one.
const DICTIONARY = [
  ['序幕', '序幕的中文'],
  ['場面いち', '第一幕的中文'],
  ['嵐の気分', '暴风心情的中文'],
  ['静かな気分', '安静心情的中文'],
  ['別の道', '另一条路的中文'],
  ['尾声', '尾声的中文'],
];
function translatePiece(piece) {
  const kept = piece.match(/__YEYU_KEEP_\d+__/g) || [];
  const hit = DICTIONARY.find((row) => piece.includes(row[0]));
  return (hit ? hit[1] : '未登记的中文') + (kept.length ? ' ' + kept.join(' ') : '');
}
function eachPart(input, translate) {
  return input
    .split(/(__YEYU_PART_\d+__)/)
    .map((piece) => (/^__YEYU_PART_\d+__$/.test(piece) ? piece : translate(piece)))
    .join('\n');
}
function translateEachPart(input) {
  return eachPart(input, translatePiece);
}


  // 1. Only the visible branch is requested, and it is requested without a single structural marker.
  {
    const app = createApp({ reply: translateEachPart });
    const { message } = seedCharacter({ withTrigger: true });
    const original = message.content;
    await translateMessage(0);
    assert.strictEqual(app.sent.length, 1, '一条消息只发一次翻译请求');
    const request = app.sent[0];
    assert.ok(!/\{\{#when|\{\{\/when\}\}|\{\{:else\}\}/.test(request), '条件标记不得进入请求');
    assert.ok(!request.includes('場面ゼロ'), '未选中的场景不得进入请求');
    assert.ok(!request.includes('場面に'), '未选中的场景不得进入请求');
    assert.ok(!request.includes('静かな気分'), '同级未选中的嵌套分支不得进入请求');
    assert.ok(request.includes('嵐の気分'), '当前可见分支必须进入请求');
    assert.ok(request.includes('別の道'), '当前条件下采用的 else 分支必须进入请求');
    assert.ok(!request.includes('{{user}}'), '行内宏必须以占位符形式送出');
    assert.ok(/__YEYU_KEEP_\d+__/.test(request), '行内宏必须被占位符保护');
    assert.ok(!request.includes('&&'), '整段替换的显示正则触发串不得进入请求');
    assert.ok(/__YEYU_PART_1__/.test(request), '多个可见段之间必须有分隔标记');

    // 2. Everything outside the visible spans is copied from the stored text, character for character.
    assert.strictEqual(message.original_content, original, '首次翻译必须保存翻译前的完整原文');
    assert.strictEqual(
      (message.content.match(/\{\{#when/g) || []).length,
      (original.match(/\{\{#when/g) || []).length,
      '条件块数量必须逐字保持'
    );
    assert.strictEqual(
      (message.content.match(/\{\{\/when\}\}/g) || []).length,
      (original.match(/\{\{\/when\}\}/g) || []).length,
      '闭合标记数量必须逐字保持'
    );
    [SCENES.zero, SCENES.oneCalm, '場面に：終幕。'].forEach((text) =>
      assert.ok(message.content.includes(text), '未翻译的分支必须逐字保留：' + text)
    );
    assert.ok(message.content.includes('&&'), '触发串必须逐字保留');
    assert.ok(message.content.includes('{{user}}'), '行内宏必须还原为原样');
    assert.ok(message.content.includes('暴风心情的中文 {{user}}'), '当前可见分支必须写入译文并还原宏');
    assert.ok(!message.content.includes('嵐の気分'), '当前可见分支的原文必须被译文替换');
    assert.ok(!/__YEYU_(KEEP|PART)_\d+__/.test(message.content), '占位符不得留在正文里');

    // 3. Switching the option shows the new branch in its original language; translating again keeps both.
    const session = getActiveSession('risu-1');
    session.risu.globalVariables.toggle_mood = '0';
    await translateMessage(0);
    assert.strictEqual(app.sent.length, 2, '切换选项后需要再发一次请求');
    assert.ok(app.sent[1].includes('静かな気分'), '第二次只翻译新选中的分支');
    assert.ok(!app.sent[1].includes('嵐'), '第二次不得重复翻译已译分支');
    assert.ok(!/的中文/.test(app.sent[1]), '第二次的待译文本必须取自原文而不是译文');
    assert.ok(message.content.includes('暴风心情的中文'), '已翻译场景的译文必须保留');
    assert.ok(message.content.includes('安静心情的中文'), '新选中的场景必须写入译文');
    assert.ok(!message.content.includes('静かな気分'), '新选中场景的原文必须被译文替换');
    assert.strictEqual(message.original_content, original, '再次翻译不得覆盖已保存的原文');
    const stored = (await YeyuRepository.load()).data.chats['risu-1'].sessions[0].msgs[0];
    assert.strictEqual(stored.content, message.content, '译文必须经过真实存储写入');
    assert.strictEqual(stored.original_content, original, '原文副本必须经过真实存储写入');

    // 4. Restoring gives the whole original back.
    await restoreOriginalMessage(0);
    assert.strictEqual(message.content, original, '恢复原文必须回到完整原文');
    assert.strictEqual(message.original_content, undefined, '恢复原文后不再保留原文副本');
    const restored = (await YeyuRepository.load()).data.chats['risu-1'].sessions[0].msgs[0];
    assert.strictEqual(restored.content, original, '恢复原文必须持久化');
    assert.strictEqual(restored.original_content, undefined);
  }

  // 5. A reply whose separators are missing or reordered is refused; the stored message never moves.
  for (const broken of [
    (input) => translateEachPart(input).replace(/__YEYU_PART_1__/, ''),
    (input) => translateEachPart(input).replace(/__YEYU_PART_1__/, '__YEYU_PART_3__'),
  ]) {
    const app = createApp({ reply: broken });
    const { message } = seedCharacter({ withTrigger: true });
    const original = message.content;
    await translateMessage(0);
    assert.strictEqual(message.content, original, '分隔标记不完整时消息必须原样不动');
    assert.strictEqual(message.original_content, undefined, '失败的翻译不得留下原文副本');
    assert.ok(
      app.toasts.some((row) => row.kind === 'err' && row.text.includes('分段标记')),
      '分隔标记不完整必须给出中文失败提示'
    );
  }

  // 8. A message with no condition block keeps the old single-request path.
  {
    const app = createApp({ reply: (input) => '【中文】' + input });
    const char = { id: 'plain-1', name: '普通', media_assets: [] };
    D.characters = [char];
    D.chats = { 'plain-1': { sessions: [blankSession('s')], activeSid: 's' } };
    D.currentCharId = 'plain-1';
    const message = { role: 'assistant', content: 'Good morning, {{user}}.', seq: 1 };
    getActiveSession('plain-1').msgs.push(message);
    await translateMessage(0);
    assert.strictEqual(app.sent.length, 1, '普通消息只发一次请求');
    assert.ok(!/__YEYU_PART_\d+__/.test(app.sent[0]), '普通消息不得出现分隔标记');
    assert.ok(/__YEYU_KEEP_\d+__/.test(app.sent[0]), '普通消息的宏同样受占位符保护');
    assert.strictEqual(message.content, '【中文】Good morning, {{user}}.', '普通消息整条替换为译文');
    assert.strictEqual(message.original_content, 'Good morning, {{user}}.', '普通消息保存原文');
  }

  // 11. Protection and restoration are exact inverses even when the protected regions nest and
  //     even when a stray \`{{\` has no closing pair. Every sample here used to come back with a
  //     literal __YEYU_KEEP_N__ in the body and a fragment appended after the last line, although
  //     the model had returned the request untouched.
  {
    const app = createApp({ reply: (input) => input });
    const samples = [
      ['你好 {{raw::<b>粗体</b>}} 再见', '宏里套 HTML'],
      ['你好 {{random::[a](b)::c}} 再见', '宏里套 Markdown 链接'],
      ['{{audio::https://x.com/a.mp3}} 然后 {{user}}', '宏里套 URL'],
      ['{{img::a&&b}} 之后 {{user}}', '宏里套隐藏触发串'],
      ['\`\`\`js\nif (a && b) { run(); }\n\`\`\`\n收尾 {{user}}', '代码围栏里套隐藏触发串'],
      ['未闭合 {{ 之后 {{user}} 仍要保护', '落单的左花括号'],
    ];
    samples.forEach(function (row) {
      const guarded = protectTranslationMarkup(row[0], { patterns: [/&&/g] }),
        restored = restoreTranslationMarkup(guarded.source, guarded.slots);
      assert.strictEqual(restored.text, row[0], '模型原样返回时必须逐字还原：' + row[1]);
      assert.strictEqual(restored.missing.length, 0, '原样返回时不得把嵌套占位符判为缺失：' + row[1]);
    });
    const macroUrl = protectTranslationMarkup('{{audio::https://x.com/a.mp3}} 然后 {{user}}', {
      patterns: [],
    });
    assert.ok(!macroUrl.source.includes('{{user}}'), 'URL 之后的宏必须照常受保护');
    assert.ok(!macroUrl.source.includes('https://'), '宏里的 URL 必须被保护');
    assert.ok(!macroUrl.source.includes('}}'), '宏的闭合符不得被 URL 规则吞掉');
    const orphan = protectTranslationMarkup('未闭合 {{ 之后 {{user}} 仍要保护', { patterns: [] });
    assert.ok(orphan.source.includes('{{ 之后'), '落单的 {{ 只让它自己不受保护');
    assert.ok(!orphan.source.includes('{{user}}'), '落单的 {{ 之后的成对宏仍要受保护');
    const trigger = protectTranslationMarkup('{{img::a&&b}} 之后 {{user}}', { patterns: [/&&/g] });
    assert.ok(!trigger.source.includes('&&'), '宏内的隐藏触发串必须被保护');
    const once = [new RegExp('一次性标记', 'i')];
    const spent = protectTranslationMarkup('甲 一次性标记 乙 一次性标记 丙', { patterns: once });
    assert.strictEqual(
      spent.source.match(/一次性标记/g).length,
      1,
      '非全局的显示脚本只改第一处，所以只保护第一处'
    );
    assert.strictEqual(once.length, 0, '非全局的模式用掉后不得再保护后面的可见段');
  }

  // 12. Hidden trigger patterns are built with the display engine's flags.
  {
    const app = createApp({ reply: (input) => input });
    const { char } = seedCharacter({
      scripts: [
        { type: 'editdisplay', in: '\\p{Script=Han}+@@', out: '', flag: 'gu', ableFlag: true },
        { type: 'editdisplay', in: '一次性标记', out: '', flag: 'i', ableFlag: true },
      ],
    });
    const patterns = risuHiddenTriggerPatterns(char);
    assert.strictEqual(patterns.length, 2, '两个整段替换的显示脚本都要给出模式');
    assert.strictEqual(patterns[0].flags, 'gu', '依赖 u 的模式必须保留 u，否则构造抛错后静默失去保护');
    assert.ok(patterns[0].test('漢字@@'), '带 u 的模式必须能真正命中');
    assert.strictEqual(patterns[1].flags, 'i', '非全局脚本不得被强制加上 g');
  }

  // 13. Anything that would persist our own placeholders, or lose a macro, is refused.
  {
    const cases = [
      {
        name: '占位符被搬到另一段',
        reply: (input) => {
          const pieces = translateEachPart(input).split(/(__YEYU_PART_\d+__)/),
            token = (pieces[0].match(/__YEYU_KEEP_\d+__/) || [])[0];
          assert.ok(token, '样例前提：第一段里有占位符');
          pieces[0] = pieces[0].replace(token, '');
          pieces[pieces.length - 1] += ' ' + token;
          return pieces.join('');
        },
      },
      {
        name: '宏占位符被删掉',
        reply: (input) => eachPart(input, (piece) => piece.replace(/__YEYU_KEEP_\d+__/g, '').trim() + '的中文'),
      },
      {
        name: '隐藏触发串占位符被删掉',
        reply: (input) => input.replace((input.match(/__YEYU_KEEP_\d+__/g) || [])[0], ''),
      },
    ];
    for (const row of cases) {
      const app = createApp({ reply: row.reply });
      const { message } = seedCharacter({ withTrigger: true });
      const original = message.content;
      await translateMessage(0);
      assert.strictEqual(message.content, original, row.name + '：消息必须原样不动');
      assert.strictEqual(message.original_content, undefined, row.name + '：失败的翻译不得留下原文副本');
      assert.ok(
        app.toasts.some((entry) => entry.kind === 'err' && /占位符/.test(entry.text)),
        row.name + '：必须给出中文失败提示'
      );
    }
  }

  // 14. Both halves of a natural-language fence are structural. Dropping either one must leave the
  //     stored message untouched instead of appending the missing fence to the end of the reply.
  for (const edge of ['first', 'last']) {
    const app = createApp({
      reply: (input) => {
        const tokens = input.match(/__YEYU_KEEP_\d+__/g) || [];
        assert.strictEqual(tokens.length, 2, '样例前提：自然语言围栏必须拆成首尾两个占位符');
        return input.replace(edge === 'first' ? tokens[0] : tokens[1], '');
      },
    });
    const char = { id: 'plain-fence-' + edge, name: '普通', media_assets: [] };
    D.characters = [char];
    D.chats = { [char.id]: { sessions: [blankSession('s')], activeSid: 's' } };
    D.currentCharId = char.id;
    const original = '\`\`\`chat\nAlice: Good morning.\nBob: Hello.\n\`\`\`';
    const message = { role: 'assistant', content: original, seq: 1 };
    getActiveSession(char.id).msgs.push(message);
    await translateMessage(0);
    assert.strictEqual(message.content, original, '自然语言围栏丢失' + edge + '半边时必须保留原文');
    assert.strictEqual(message.original_content, undefined, '围栏失败不得留下原文副本');
    assert.ok(app.toasts.some((entry) => entry.kind === 'err' && /占位符/.test(entry.text)), '围栏缺失必须报错');
  }

  // 15. Placeholder-looking text that belongs to the source is data. It must survive nested
  //     protection and an untouched conditional branch without being restored or rejected as ours.
  {
    const app = createApp({ reply: (input) => '【中文】' + input });
    const char = { id: 'literal-token', name: '普通', media_assets: [] };
    D.characters = [char];
    D.chats = { 'literal-token': { sessions: [blankSession('s')], activeSid: 's' } };
    D.currentCharId = char.id;
    const original = '<b>x</b> {{raw::__YEYU_KEEP_0__}} and __YEYU_PART_7__';
    const message = { role: 'assistant', content: original, seq: 1 };
    getActiveSession(char.id).msgs.push(message);
    await translateMessage(0);
    assert.strictEqual(message.content, '【中文】' + original, '原文字面 token 必须逐字保留且不参与还原');
    assert.ok(!app.toasts.some((entry) => entry.kind === 'err'), '原文字面 token 不得触发残留闸');
  }
  {
    const app = createApp({ reply: (input) => input });
    const content = [
      '{{#when::keep::scene::tis::1}}場面いち。 __YEYU_PART_1__{{/when}}',
      '{{#when::keep::mood::tis::1}}嵐の気分。{{/when}}',
    ].join('\n');
    const { message } = seedCharacter({ content });
    await translateMessage(0);
    assert.ok(message.content.includes('__YEYU_PART_1__'), '可见段里的字面 PART token 不得参与分段');
    assert.ok(!app.toasts.some((entry) => entry.kind === 'err'), '可见段字面 PART token 不得破坏实际翻译入口');
  }
  {
    const app = createApp({ reply: translateEachPart });
    const content = [
      '{{#when::keep::scene::tis::0}}未选 __YEYU_KEEP_3__ / __YEYU_PART_4__{{/when}}',
      '{{#when::keep::scene::tis::1}}場面いち。{{/when}}',
    ].join('\n');
    const { message } = seedCharacter({ content });
    await translateMessage(0);
    assert.ok(message.content.includes('__YEYU_KEEP_3__ / __YEYU_PART_4__'), '未翻译分支的字面 token 必须保留');
    assert.ok(!app.toasts.some((entry) => entry.kind === 'err'), '未翻译分支的字面 token 不得触发残留闸');
  }

  // 16. A single-span message whose reply invents a separator is refused too.
  {
    const app = createApp({ reply: (input) => '【中文】' + input + '\n__YEYU_PART_1__' });
    const char = { id: 'plain-2', name: '普通', media_assets: [] };
    D.characters = [char];
    D.chats = { 'plain-2': { sessions: [blankSession('s')], activeSid: 's' } };
    D.currentCharId = 'plain-2';
    const message = { role: 'assistant', content: 'Good morning, {{user}}.', seq: 1 };
    getActiveSession('plain-2').msgs.push(message);
    await translateMessage(0);
    assert.strictEqual(message.content, 'Good morning, {{user}}.', '自行插入分隔标记时消息必须原样不动');
    assert.strictEqual(message.original_content, undefined, '失败的翻译不得留下原文副本');
    assert.ok(
      app.toasts.some((entry) => entry.kind === 'err' && /占位符/.test(entry.text)),
      '自行插入分隔标记必须给出中文失败提示'
    );
  }

  console.log(
    JSON.stringify({
      visibleBranchOnly: true,
      markersVerbatim: true,
      secondPassKeepsBothScenes: true,
      brokenSeparatorsRefused: true,
      plainMessageUnchanged: true,
      nestedPlaceholderRoundTrip: true,
      hiddenTriggerFlagsMatchDisplay: true,
      placeholderResidueRefused: true,
    })
  );
  `);
});
