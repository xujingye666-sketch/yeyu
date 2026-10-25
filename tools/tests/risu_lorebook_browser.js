'use strict';

const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');

const {pageAssertSource} = require('./helpers/page-assert');
const {waitForAppReady} = require('./helpers/app-ready');
let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 450, height: 974 } });
  await page.addInitScript(pageAssertSource);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);

  await page.evaluate(async () => {
{
  const char = {
    id: 'char',
    character_book: {
      entries: [{ keys: ['card'], name: 'card', content: 'CARD', constant: true, insertion_order: 100 }],
    },
    extensions: {
      risuai: {},
      yeyu: {
        risuModule: {
          lorebook: [
            {
              key: '',
              secondkey: '',
              insertorder: 100,
              comment: 'module',
              content: 'MODULE',
              mode: 'normal',
              alwaysActive: true,
              selective: false,
            },
          ],
        },
      },
    },
  };
  const session = {
    id: 'session',
    msgs: [{ role: 'assistant', content: 'opening', opening: true, openingIndex: 1 }],
    risu: {
      localLore: [
        {
          key: '',
          secondkey: '',
          insertorder: 90,
          comment: 'local',
          content: 'LOCAL',
          mode: 'normal',
          alwaysActive: true,
          selective: false,
        },
      ],
    },
  };
  const transaction = risuLorebookCreateTransaction(char, session);
  assert.strictEqual(transaction.source, 'module.risum');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(transaction.getLorebooksByName('local', String).map((row) => row.content))),
    ['LOCAL']
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify((await transaction.resolve()).actives.map((row) => row.prompt))), [
    'LOCAL',
    'MODULE',
  ]);
  transaction.upsertLocalLorebook('runtime', 'RUNTIME', { alwaysActive: true, insertOrder: 80 });
  transaction.setGlobalLorebooks([
    {
      key: '',
      secondkey: '',
      insertorder: 70,
      comment: 'global changed',
      content: 'GLOBAL CHANGED',
      mode: 'normal',
      alwaysActive: true,
      selective: false,
    },
  ]);
  const snapshot = transaction.snapshot();
  assert.strictEqual(snapshot.globalChanged, true);
  assert.strictEqual(snapshot.localChanged, true);
  assert.deepStrictEqual(
    session.risu.localLore.map((row) => row.comment),
    ['local']
  );
  const charCopy = JSON.parse(JSON.stringify(char));
  const sessionCopy = JSON.parse(JSON.stringify(session));
  transaction.applyToCopies(charCopy, sessionCopy);
  assert.strictEqual(charCopy.extensions.yeyu.risuLorebookState[0].comment, 'global changed');
  assert.deepStrictEqual(
    sessionCopy.risu.localLore.map((row) => row.comment),
    ['local', 'runtime']
  );
}

  });

  await page.evaluate(async () => {
    const row = (id, key, content = id) => ({id, key, content, useRegex: true, insertorder: 100, mode: 'normal'});
    const char = {id: 'regex-regression', name: 'Regex', extensions: {risuai: {}, yeyu: {risuModule: {}}}};
    const session = {id: 'regex-regression-session', msgs: []};
    const resolve = async (entries, texts, state = createRisuMacroState(char, session)) => {
      char.extensions.yeyu.risuModule.lorebook = entries;
      return risuLorebookCreateTransaction(char, session).resolve({macroState: state,
        messages: texts.map(data => ({role: 'user', data})), settings: {recursiveScanning: false}});
    };
    for (const key of ['/needle/', '/needle/i', '/miss/,/needle/g', '/miss/,/needle/y']) {
      assert.strictEqual((await resolve([row('match', key)], ['needle'])).actives.length, 1);
    }
    for (const key of ['/needle/,/[/', '/needle/,not-a-regex', '/needle/ii']) {
      assert.strictEqual((await resolve([row('invalid', key)], ['needle'])).actives.length, 0);
    }
    const flags = createRisuMacroState(char, session);
    const entries = [row('keep', '/needle/', '@@keep_activate_after_match\nKEEP'), row('ordinary', '/needle/')];
    assert.strictEqual((await resolve(entries, ['needle'], flags)).actives.length, 2);
    assert.deepStrictEqual(Object.keys(flags.vars).filter(key => key.startsWith('$__internal_ka_')), ['$__internal_ka_keep']);
    assert.deepStrictEqual((await resolve(entries, ['miss'], flags)).actives.map(item => item.prompt), ['KEEP']);
    const once = createRisuMacroState(char, session);
    const onceEntries = [row('once', '/needle/', '@@dont_activate_after_match\nONCE'), row('ordinary', '/needle/')];
    await resolve(onceEntries, ['needle'], once);
    assert.deepStrictEqual(Object.keys(once.vars).filter(key => key.startsWith('$__internal_da_')), ['$__internal_da_once']);
    assert.deepStrictEqual((await resolve(onceEntries, ['needle'], once)).actives.map(item => item.prompt), ['ordinary']);
  });

  const built = await page.evaluate(async () => {
    const char = {
      id: 'risu-lorebook-build',
      name: 'Risu 世界书构建夹具',
      description: 'RISU_DESCRIPTION',
      personality: 'RISU_PERSONALITY',
      scenario: 'RISU_SCENARIO',
      mes_example: 'EXAMPLE_SHOULD_NOT_APPEAR',
      system_prompt: 'CARD_SYSTEM_SHOULD_NOT_APPEAR',
      post_history_instructions: 'RISU_GLOBAL_NOTE',
      character_book: {
        entries: [
          {
            keys: [],
            constant: true,
            insertion_order: 100,
            name: 'card source',
            content: 'CARD_LORE_SHOULD_NOT_APPEAR',
          },
        ],
      },
      media_assets: [{ name: 'fixture-image', status: 'ready' }],
      extensions: {
        depth_prompt: { prompt: 'DEPTH_SHOULD_NOT_APPEAR', depth: 0 },
        risuai: { utilityBot: true, prebuiltAssetCommand: true },
        yeyu: {
          risuModule: {
            lorebook: [
              {
                key: '',
                secondkey: '',
                insertorder: 100,
                comment: 'module source',
                content: 'MODULE_LORE',
                mode: 'normal',
                alwaysActive: true,
                selective: false,
              },
              {
                key: '',
                secondkey: '',
                insertorder: 80,
                comment: 'global note injection',
                content: '@@inject_at globalNote\n@@inject_prepend\nINJECTED_GLOBAL_NOTE',
                mode: 'normal',
                alwaysActive: true,
                selective: false,
              },
              {
                key: '',
                secondkey: '',
                insertorder: 70,
                comment: 'post everything lore',
                content: '@@depth 0\nDEPTH_ZERO_POST_EVERYTHING',
                mode: 'normal',
                alwaysActive: true,
                selective: false,
              },
              {
                key: '',
                secondkey: '',
                insertorder: 60,
                comment: 'role lore',
                content: '@@role user\nUSER_ROLE_LORE',
                mode: 'normal',
                alwaysActive: true,
                selective: false,
              },
            ],
          },
        },
      },
    };
    const session = {
      id: 'risu-lorebook-session',
      msgs: [],
      memoryStore: makeEmptyMemoryStore(),
      risu: {
        localLore: [
          {
            key: '',
            secondkey: '',
            insertorder: 90,
            comment: 'local source',
            content: 'LOCAL_LORE',
            mode: 'normal',
            alwaysActive: true,
            selective: false,
          },
        ],
      },
    };
    const messages = [{ role: 'user', content: 'RISU_CHAT' }];
    D.characters = [char]; D.currentCharId = char.id;
    D.chats = {[char.id]: {sessions:[session], activeSid:session.id}};
    D.personas = [{id:'utility-persona', name:'用户', desc:'PERSONA_SHOULD_NOT_APPEAR'}];
    D.activePersonaId = 'utility-persona';
    D.settings.useMemory = true;
    D.settings.chatCompletionPresetInUse = presetRawSkeleton();
    D.settings.chatCompletionPresetInUse.prompts.find(row=>row.identifier==='main').content = 'MAIN_SHOULD_NOT_APPEAR';
    session.storyDirection = {longTerm:'STORY_SHOULD_NOT_APPEAR'};
    session.memoryStore.longTermEntries = [memoryV5NormalizeLongTerm({id:'utility-memory',type:'key_event',content:'MEMORY_SHOULD_NOT_APPEAR',importance:5,confidence:1,sourceStartSeq:1,sourceEndSeq:1},session.id)];
    assert.strictEqual(getActivePersona(char.id).desc, 'PERSONA_SHOULD_NOT_APPEAR');
    assert.ok(StoryDirection.messageForBuild(session, messages).content.includes('STORY_SHOULD_NOT_APPEAR'));
    assert.ok(memoryContextPayloadForSession(session, 'MEMORY_SHOULD_NOT_APPEAR', 0, char).text.includes('MEMORY_SHOULD_NOT_APPEAR'));
    const result = await buildMessages(char, messages, session, {
      commit: false,
      risuSystemPrompts: {
        start: 'RISU_POST_EVERYTHING_START',
        historyend: 'RISU_POST_EVERYTHING_HISTORY_END',
        promptend: 'RISU_POST_EVERYTHING_END',
      },
    });
    return {messages: result.messages.map(row => ({role:row.role,content:row.content})),metrics:result.worldBookMetrics};
  });

  const outbound = built.messages.map((row) => row.content).join('\n');
  for (const expected of [
    'RISU_DESCRIPTION',
    'RISU_PERSONALITY',
    'RISU_SCENARIO',
    'MODULE_LORE',
    'LOCAL_LORE',
    'RISU_CHAT',
    'RISU_GLOBAL_NOTE',
    'INJECTED_GLOBAL_NOTE',
    'DEPTH_ZERO_POST_EVERYTHING',
    'USER_ROLE_LORE',
    '<Image Tag Instruction>',
    'RISU_POST_EVERYTHING_START',
    'RISU_POST_EVERYTHING_HISTORY_END',
    'RISU_POST_EVERYTHING_END',
  ])
    assert(outbound.includes(expected), `missing ${expected}`);
  for (const absent of [
    'CARD_LORE_SHOULD_NOT_APPEAR',
    'MAIN_SHOULD_NOT_APPEAR',
    'CARD_SYSTEM_SHOULD_NOT_APPEAR',
    'PERSONA_SHOULD_NOT_APPEAR',
    'EXAMPLE_SHOULD_NOT_APPEAR',
    'MEMORY_SHOULD_NOT_APPEAR',
    'DEPTH_SHOULD_NOT_APPEAR',
    'STORY_SHOULD_NOT_APPEAR',
  ])
    assert(!outbound.includes(absent), `unexpected ${absent}`);
  assert(outbound.indexOf('RISU_GLOBAL_NOTE') < outbound.indexOf('DEPTH_ZERO_POST_EVERYTHING'));
  assert(built.messages.some((row) => row.role === 'user' && row.content.includes('USER_ROLE_LORE')));
  assert.equal(built.metrics.injected, 4);

  // Ordinary presets must retain postEverything lore, with the fixed upstream assistant-prefill grouping.
  const ordinaryTail = await page.evaluate(async () => {
    const key = '/UNUSED|\\bTAIL_REGEX\\s+\\d+\\b/i';
    const specs = [['assistant',10],['user',20],['system',40],['assistant',50],['user',60]];
    const char = {id:'risu-tail',name:'Tail',description:'TAIL_DESCRIPTION',system_prompt:'TAIL_CARD_MAIN',post_history_instructions:'TAIL_CARD_POST',
      extensions:{risuai:{},yeyu:{risuLorebookState:specs.map(([role,order])=>({
        key,useRegex:true,alwaysActive:false,insertorder:order,mode:'normal',
        content:'@@no_recursive_search\n@@unrecursive\n@@depth 0\n@@role '+role+'\nTAIL_'+role+'_'+order,
      })).concat(['main','globalNote'].map(location=>({key,useRegex:true,alwaysActive:false,insertorder:70,mode:'normal',
        content:'@@no_recursive_search\n@@unrecursive\n@@inject_at '+location+'\n@@inject_prepend\nTAIL_INJECT_'+location})))}}};
    const raw = presetRawSkeleton();
    raw.prompts.find(row=>row.identifier==='main').content='TAIL_PRESET_MAIN';
    raw.prompts.find(row=>row.identifier==='jailbreak').content='TAIL_PRESET_POST';
    raw.prompts.push({identifier:'after-post',role:'system',content:'TAIL_AFTER_POST',injection_position:0});
    presetOrderRow(raw).order.push({identifier:'after-post',enabled:true});
    const cases = [];
    for (const [input,variant] of [['TAIL_REGEX 73','normal'],['TAIL_REGEX missed','normal'],[null,'normal'],['TAIL_REGEX 73','forbid'],['TAIL_REGEX 73','disabled']]) {
      const preset=cloneData(raw);
      if(variant==='forbid')preset.prompts.filter(row=>['main','jailbreak'].includes(row.identifier)).forEach(row=>row.forbid_overrides=true);
      if(variant==='disabled')presetOrderRow(preset).order.filter(row=>['main','jailbreak'].includes(row.identifier)).forEach(row=>row.enabled=false);
      const session=createBlankSession('Tail','tail-'+input);
      session.msgs=input===null?[]:[{role:'user',content:input,seq:1}];
      const result=await buildMessages(char,session.msgs,session,{commit:false,completionPresetRaw:preset,ignoreContextLimit:true});
      cases.push({input,variant,messages:result.messages});
    }
    return cases;
  });
  for (const row of ordinaryTail) {
    const tails = row.messages.filter(message=>/^TAIL_(?:user|system|assistant)_\d+$/.test(message.content));
    assert.deepStrictEqual(tails,row.input==='TAIL_REGEX 73'?[
      {role:'user',content:'TAIL_user_20'}, {role:'system',content:'TAIL_system_40'}, {role:'user',content:'TAIL_user_60'},
      {role:'assistant',content:'TAIL_assistant_10'}, {role:'assistant',content:'TAIL_assistant_50'},
    ]:[], 'depth=0 regex hit/miss and role order must survive ordinary preset reassembly');
    if(tails.length)assert.deepStrictEqual(row.messages.slice(-5),tails,'postEverything follows every ordered preset row');
    const text=row.messages.map(message=>message.content).join('\n');
    for(const location of ['main','globalNote'])assert.strictEqual(text.includes('TAIL_INJECT_'+location),row.input==='TAIL_REGEX 73'&&row.variant!=='disabled','slot injection must survive preset overrides and honor the disabled slot');
    if(row.input!==null&&row.variant!=='disabled')for(const location of ['MAIN','POST'])assert(text.includes('TAIL_'+(row.variant==='forbid'?'PRESET':'CARD')+'_'+location),'forbid_overrides/card substitution semantics changed');
    row.messages.forEach(message=>assert(!Object.keys(message).some(key=>key.startsWith('_yeyu')),'internal tail identity leaked'));
  }

  // @@is_greeting counts card slots like official fmIndex + 1: a blank alternate keeps its slot, and a
  // chat without an opening compares 0. CBS/triggers read the same position (openingAlternateGreetingIndex).
  const greetings = await page.evaluate(async () => {
    const lore = [0, 1, 2, 3].map((slot) => ({
      key: '', secondkey: '', insertorder: 100 - slot, comment: 'greeting ' + slot,
      content: '@@is_greeting ' + slot + '\nGREETING_' + slot, mode: 'normal', alwaysActive: true, selective: false,
    }));
    const char = {
      id: 'risu-greeting', name: 'Greeting', first_mes: 'g0', alternate_greetings: ['', 'g2', 'g3'],
      extensions: { risuai: {}, yeyu: { risuModule: { lorebook: lore } } },
    };
    const results = [];
    for (const openingIndex of [null, 0, 1, 2]) {
      const opening = openingIndex == null ? null : { role: 'assistant', opening: true, openingIndex, content: getGreetings(char)[openingIndex] };
      const session = { id: 'risu-greeting-' + openingIndex, msgs: (opening ? [opening] : []).concat([{ role: 'user', content: 'hi' }]) };
      const resolved = await risuLorebookCreateTransaction(char, session).resolve();
      results.push({
        openingIndex,
        active: resolved.actives.map((row) => row.prompt),
        cbsSlot: openingAlternateGreetingIndex(char, opening) + 1,
      });
    }
    return results;
  });
  assert.deepStrictEqual(
    greetings.map((row) => [row.openingIndex, row.active, row.cbsSlot]),
    [[null, ['GREETING_0'], 0], [0, ['GREETING_0'], 0], [1, ['GREETING_2'], 2], [2, ['GREETING_3'], 3]]
  );

  const isolation = await page.evaluate(async () => {
    const originalRuntime = YeyuRisuRegexRuntime, NativeWorker = Worker, results = [];
    for (const action of ['timeout', 'stop', 'leave']) {
      const char = {id:'isolated-lore', name:'Isolated', extensions:{risuai:{}, yeyu:{risuModule:{lorebook:[{
        key:'/(a+)+$/g', secondkey:'', content:'must not reach provider', mode:'normal',
        useRegex:true, selective:false, alwaysActive:false, insertorder:100,
      }]}}}};
      const session = createBlankSession('Old', 'isolated-old');
      session.msgs = [{role:'user',content:'/'+'a'.repeat(50000)+'!',seq:1}];
      D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{activeSid:session.id,sessions:[session]}};
      const controller = new AbortController();
      const runtime = originalRuntime.createRuntime({defaultTimeoutMs:action === 'timeout' ? 50 : 4000});
      let started = false, ticks = 0;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', event => {
            if (this.requestType !== 'lore' || event.data.type !== 'started' || started) return;
            started = true;
            if (action !== 'timeout') setTimeout(() => {
              if (action === 'stop') controller.abort();
              else releaseRisuExecutionSession(session);
            }, 20);
          });
        }
        postMessage(message) {this.requestType=message.type;super.postMessage(message);}
      };
      window.YeyuRisuRegexRuntime = Object.assign({}, originalRuntime, {
        resolveLorebook: (...args) => runtime.resolveLorebook(...args),
      });
      const heartbeat = setInterval(() => {ticks++;}, 5);
      let error;
      try {await buildMessages(char, session.msgs, session, {signal:controller.signal});}
      catch (failure) {error=failure.name;}
      finally {
        clearInterval(heartbeat);runtime.dispose();window.Worker=NativeWorker;window.YeyuRisuRegexRuntime=originalRuntime;
      }
      results.push({action, started, responsive:ticks>0, error, active:runtime.active.size});
    }
    return results;
  });
  for (const row of isolation)
    assert(row.started && row.responsive && row.active===0 && row.error===(row.action==='timeout'?'TimeoutError':'AbortError'), JSON.stringify(row));

  assert.deepStrictEqual(errors, []);
  console.log(
    JSON.stringify({
      buildMessages: true,
      moduleReplacesCardLore: true,
      localAndGlobalLore: true,
      utilityTemplate: true,
      prebuiltGlobalNote: true,
      postEverything: true,
      isGreetingCardSlot: true,
      viewport: '450x974',
    })
  );
})()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });
