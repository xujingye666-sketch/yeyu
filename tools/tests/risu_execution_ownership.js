'use strict';
/* global __risuFailStorageWrites -- native storage boundary fault installed below */

const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');

const {waitForAppReady} = require('./helpers/app-ready');
const assetsRoot = path.resolve(__dirname, '../../app/src/main/assets');
let browser;
let server;

(async () => {
  server = createAssetServer(assetsRoot);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({
    executablePath: resolveEdgeExecutable(),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 450, height: 974 } });
  await page.addInitScript(() => {
    window.__risuFailStorageWrites = onAttempt => {
      const originalPut = IDBObjectStore.prototype.put, originalSetItem = Storage.prototype.setItem;
      let failures = 0;
      IDBObjectStore.prototype.put = function(value, key) {
        if (this.name === 'sessions') {
          failures++;
          if (onAttempt) onAttempt();
          throw new DOMException('synthetic repository failure', 'QuotaExceededError');
        }
        return originalPut.apply(this, arguments);
      };
      Storage.prototype.setItem = function(key, value) {
        if (key === FALLBACK_KEY) throw new DOMException('synthetic recovery snapshot failure', 'QuotaExceededError');
        return originalSetItem.apply(this, arguments);
      };
      return () => {
        IDBObjectStore.prototype.put = originalPut;
        Storage.prototype.setItem = originalSetItem;
        if (!failures) throw new Error('Risu failure scenario did not reach real sessions storage');
      };
    };
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
  await waitForAppReady(page, { timeout: 15000 });

  const result = await page.evaluate(async () => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const makeChar = (id, card) => ({
      id,
      name: id,
      description: `${id}-original-description`,
      personality: '',
      scenario: '',
      first_mes: `${id}-opening`,
      mes_example: '',
      extensions: card ? { risuai: card } : {},
    });
    const makeSession = (id, messages) => {
      const session = createBlankSession(id, id);
      session.greetingChosen = true;
      session.creatorNotesSeen = true;
      session.msgs = clone(messages || []);
      session.nextMessageSeq = Math.max(1, ...session.msgs.map((row) => (Number(row.seq) || 0) + 1));
      return session;
    };
    const configure = async (chars, sessions, activeCharId, persona) => {
      generationTarget = null;
      setGenerationState('idle');
      D = defaults();
      D.settings.useMemory = false;
      D.settings.embeddingEnabled = false;
      D.settings.styleAuditEnabled = false;
      D.settings.maxContextTokens = 0;
      D.settings.maxTokens = 0;
      D.characters = chars;
      D.currentCharId = activeCharId;
      D.chats = {};
      chars.forEach((char, index) => {
        const session = sessions[index];
        D.chats[char.id] = { sessions: [session], activeSid: session.id };
      });
      D.personas = persona ? [persona] : [];
      D.activePersonaId = persona ? persona.id : '';
      await saveData(['meta', 'characters', 'personas', 'sessions'], { urgent: true });
      switchAppPage('chat');
      updateChatUI();
      renderChat();
    };

    // Output effects alter all three persistence owners, then the actual outer
    // generation commit loses its final repository write. Every live owner must roll back.
    const rollbackCard = {
      defaultVariables: '',
      customScripts: [],
      triggerscript: [
        {
          type: 'output',
          comment: 'rollback fixture',
          conditions: [],
          effect: [
            { type: 'v2SetCharacterDesc', value: 'mutated character description' },
            { type: 'v2SetPersonaDesc', value: 'mutated persona description' },
            {
              type: 'v2CreateLorebook',
              name: 'rollback global',
              key: '',
              content: 'unpersisted global lore',
              insertOrder: '100',
            },
            {
              type: 'triggerlua',
              code: "function onOutput(id) upsertLocalLoreBook(id,'rollback local','unpersisted local lore',{alwaysActive=true}); setBackgroundEmbedding(id,'<div>unpersisted background</div>') end",
            },
          ],
        },
      ],
    };
    const rollbackChar = makeChar('risu-rollback', rollbackCard);
    const rollbackSession = makeSession('risu-rollback-session', [
      { role: 'user', content: 'original user', time: 1, seq: 1 },
      { role: 'assistant', content: 'original assistant', swipes: ['original assistant'], swipeId: 0, time: 2, seq: 2 },
    ]);
    const rollbackPersona = {
      id: 'risu-rollback-persona',
      name: 'Rollback Persona',
      desc: 'original persona description',
    };
    await configure([rollbackChar], [rollbackSession], rollbackChar.id, rollbackPersona);
    const rollbackBefore = {
      session: clone(rollbackSession),
      extensions: clone(rollbackChar.extensions),
      description: rollbackChar.description,
      persona: rollbackPersona.desc,
    };
    const rollbackTarget = bindGenerationTargetOwnership(
      {
        charId: rollbackChar.id,
        sessionId: rollbackSession.id,
        mode: 'regenerate',
        messageIndex: 1,
        messageSeq: 2,
        viewportContextId: -1,
      },
      rollbackSession
    );
    const persistedBefore = JSON.stringify((await YeyuRepository.load()).data);
    let commitError = '';
    let attemptedState;
    const restoreStorage = __risuFailStorageWrites(() => {
      attemptedState = {
        session: clone(rollbackSession),
        extensions: clone(rollbackChar.extensions),
        description: rollbackChar.description,
        persona: rollbackPersona.desc,
      };
    });
    try {
      await commitGeneratedResponse(rollbackTarget, 'unpersisted generated reply', { finishReason: 'stop' });
    } catch (error) {
      commitError = String((error && error.message) || error);
    } finally {
      restoreStorage();
    }
    const rollbackAfter = {
      session: clone(rollbackSession),
      extensions: clone(rollbackChar.extensions),
      description: rollbackChar.description,
      persona: rollbackPersona.desc,
      rollbackHandlePresent: Object.prototype.hasOwnProperty.call(rollbackTarget, 'risuRollback'),
      commitError,
      persistedUnchanged: JSON.stringify((await YeyuRepository.load()).data) === persistedBefore,
    };

    // Prompt builders clone messages. editprocess repeat_back must recover the
    // official chat index from seq so it can see the previous assistant row.
    const sequenceCard = {
      defaultVariables: '',
      triggerscript: [],
      customScripts: [
        {
          type: 'editprocess',
          in: 'OLDER_ASSISTANT',
          out: '@@repeat_back end',
        },
      ],
    };
    const sequenceChar = makeChar('risu-sequence', sequenceCard);
    const sequenceSession = makeSession('risu-sequence-session', [
      { role: 'assistant', content: 'OLDER_ASSISTANT', time: 1, seq: 11 },
      { role: 'user', content: 'middle user', time: 2, seq: 12 },
      { role: 'assistant', content: 'TARGET_ASSISTANT', time: 3, seq: 13 },
    ]);
    await configure([sequenceChar], [sequenceSession], sequenceChar.id);
    const sequenceTarget = bindGenerationTargetOwnership(
      {
        charId: sequenceChar.id,
        sessionId: sequenceSession.id,
        mode: 'new',
        viewportContextId: -1,
      },
      sequenceSession
    );
    const clonedTarget = Object.assign({}, sequenceSession.msgs[2]);
    const processed = await risuPreparePrompt(sequenceChar, sequenceSession, [clonedTarget], sequenceTarget);
    const sequence = {
      cloneIsDistinct: clonedTarget !== sequenceSession.msgs[2],
      processed: clone(processed),
    };

    const emotionImage =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyRZAAAAAElFTkSuQmCC';
    const emotionChar = makeChar('risu-emotion', {
      viewScreen: 'emotion',
      inlayViewScreen: false,
      defaultVariables: '',
      customScripts: [],
      triggerscript: [],
    });
    emotionChar.media_assets = ['happiness', 'Intrigued', 'sadness', 'neutral'].map((name, index) => ({
      id: `risu-emotion-${index}`,
      name,
      assetType: 'emotion',
      status: 'ready',
      data_url: emotionImage,
      mime: 'image/png',
    }));
    const emotionSession = makeSession('risu-emotion-session', [
      {
        role: 'assistant',
        content: 'The lantern flickers across her face.',
        swipes: ['The lantern flickers across her face.'],
        swipeId: 0,
        time: 1,
        seq: 1,
      },
    ]);
    await configure([emotionChar], [emotionSession], emotionChar.id);
    Object.assign(activeProviderForSettings(D.settings), {apiUrl:'https://emotion.example.test/v1', apiKey:'synthetic-local', model:'synthetic-model', reasoningEffort:'off'});
    const originalEmotionTransport = window.fetch;
    const emotionRequests = [];
    window.fetch = async (url, init) => {
      if (!String(url).startsWith('https://emotion.example.test/')) return originalEmotionTransport(url, init);
      emotionRequests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({choices:[{message:{content:'sadness'},finish_reason:'stop'}]}),
        {headers:{'content-type':'application/json'}});
    };
    const emotionTarget = bindGenerationTargetOwnership(
      {
        charId: emotionChar.id,
        sessionId: emotionSession.id,
        mode: 'new',
        messageIndex: 0,
        viewportContextId: -1,
      },
      emotionSession
    );
    const classifiedValue = await risuAfterGeneration(
      emotionTarget,
      { controller: new AbortController() },
      'generation-result'
    );
    const classifiedEmotion = risuCurrentEmotion(emotionSession);
    window.fetch = originalEmotionTransport;
    const emotionClassification = {
      classifiedValue,
      classifiedName: classifiedEmotion && classifiedEmotion.name,
      request: emotionRequests[0],
    };

    return {
      rollbackBefore,
      rollbackAttempt: attemptedState,
      rollbackAfter,
      sequence,
      emotionClassification,
    };
  });

  const readOnlyHistory = await page.evaluate(async () => {
    const char = { id: 'readonly-history', name: 'Current', extensions: { risuai: {} } };
    const session = createBlankSession('Readonly', 'readonly-history');
    session.msgs = [{ seq: 1, role: 'assistant', content: 'RAW',
      risu: { source: 'RAW', template: '{{char}}', text: 'Processed history' } }];
    D = defaults(); D.characters = [char]; D.currentCharId = char.id;
    D.chats = { [char.id]: { sessions: [session], activeSid: session.id } };
    const before = JSON.stringify(session);
    const text = await risuWithExecution(char, session, { readOnly: true }, context => context.messages[0].data);
    return { text, unchanged: before === JSON.stringify(session) };
  });
  assert.deepStrictEqual(readOnlyHistory, { text: 'Processed history', unchanged: true });

  const memoryEdits=await page.evaluate(async()=>{
    const char={id:'risu-memory-edits',name:'Memory',extensions:{risuai:{}}};
    const session=createBlankSession('Memory','memory-edits');
    D=defaults();D.characters=[char];D.currentCharId=char.id;D.chats={[char.id]:{sessions:[session],activeSid:session.id}};
    const results=[];
      for(const mode of ['delete','failure']) {
        session.msgs=[{seq:1,role:'user',content:'OLD {{char}}'},{seq:2,role:'assistant',content:'SECOND'}];session.nextMessageSeq=3;
        session.memoryStore=makeEmptyMemoryStore();
        memoryV5ApplyBatch(session.memoryStore,{historySummary:memoryV5NormalizeHistorySummary({sourceStartSeq:1,sourceEndSeq:2,sourceHash:'old',text:'Old history'},session.id),entries:[memoryV5NormalizeLongTerm({id:'old-memory',type:'key_event',content:'Old event',sourceStartSeq:1,sourceEndSeq:2},session.id)]});
        const before=JSON.stringify(session.memoryStore),first=session.msgs[0];
        await saveData('sessions', {urgent:true});
        const persistedBefore=JSON.stringify((await YeyuRepository.load()).data);
        const restoreStorage=mode==='failure'?__risuFailStorageWrites():()=>{};
        let rejected=false;
        try{await risuWithExecution(char,session,{},context=>{
          if(mode==='delete'||mode==='failure')context.messages.splice(0,1);
        });}catch(error){if(mode!=='failure')throw error;rejected=true;}finally{restoreStorage();}
        results.push({mode,invalidated:!session.memoryStore.historySummary&&session.memoryStore.longTermEntries[0].status==='stale',
          preserved:JSON.stringify(session.memoryStore)===before,restored:session.msgs[0]===first,rejected,
          persistedUnchanged:JSON.stringify((await YeyuRepository.load()).data)===persistedBefore});
      }
    return results;
  });
  for(const row of memoryEdits){
    if(row.mode==='failure')assert(row.preserved&&row.restored&&row.persistedUnchanged,JSON.stringify(row));
    else assert(row.invalidated,JSON.stringify(row));
    assert.strictEqual(row.rejected,row.mode==='failure');
  }
  assert.deepStrictEqual(pageErrors, []);
  assert(result.rollbackAfter.persistedUnchanged, 'Risu output rollback must preserve real persisted owners');
  assert.match(result.rollbackAfter.commitError, /synthetic repository failure|生成结果保存失败/);
  assert.strictEqual(
    result.rollbackAttempt.description,
    'mutated character description',
    '失败点必须已包含 output 角色修改'
  );
  assert.strictEqual(result.rollbackAttempt.persona, 'mutated persona description', '失败点必须已包含 output 人格修改');
  assert.equal(result.rollbackAttempt.extensions.yeyu.risuLorebookState[0].content, 'unpersisted global lore');
  assert.equal(result.rollbackAttempt.session.risu.localLore[0].content, 'unpersisted local lore');
  assert(result.rollbackAttempt.extensions.risuai.backgroundHTML.includes('unpersisted background'));
  assert.strictEqual(
    result.rollbackAttempt.session.msgs[1].content,
    'unpersisted generated reply',
    '失败点必须已包含待提交回复'
  );
  assert.deepStrictEqual(
    result.rollbackAfter.session,
    result.rollbackBefore.session,
    '最终保存失败必须恢复完整原消息与会话状态'
  );
  assert.deepStrictEqual(
    result.rollbackAfter.extensions,
    result.rollbackBefore.extensions,
    '最终保存失败必须恢复世界书覆盖值和 Lua 背景'
  );
  assert.strictEqual(
    result.rollbackAfter.description,
    result.rollbackBefore.description,
    '最终保存失败必须恢复角色描述'
  );
  assert.strictEqual(result.rollbackAfter.persona, result.rollbackBefore.persona, '最终保存失败必须恢复人格描述');
  assert.strictEqual(result.rollbackAfter.rollbackHandlePresent, false, '失败后的回滚句柄不得留到后续生成');
  assert.strictEqual(result.sequence.cloneIsDistinct, true, '夹具必须使用真实克隆消息而非对象身份');
  assert.strictEqual(
    result.sequence.processed[0].content,
    'TARGET_ASSISTANTOLDER_ASSISTANT',
    'editprocess 必须按 seq 找回 chatIndex，并让 repeat_back 读取上一条同角色消息'
  );
  assert.strictEqual(result.emotionClassification.classifiedValue, 'generation-result');
  assert.strictEqual(result.emotionClassification.classifiedName, 'sadness', 'Risu 独立模型返回须选择卡内同名情绪');
  assert.deepStrictEqual(
    result.emotionClassification.request.messages.slice(1),
    [
      { role: 'user', content: '"Good morning, Master! Is there anything I can do for you today?"' },
      { role: 'assistant', content: 'happy' },
      { role: 'user', content: 'The lantern flickers across her face.' },
    ],
    '情绪请求须使用固定 few-shot 和完整主回复'
  );
  ['happiness', 'Intrigued', 'sadness', 'neutral'].forEach((name) => {
    assert(
      result.emotionClassification.request.messages[0].content.includes(name),
      `情绪请求缺少原卡资产名：${name}`
    );
  });
})()
  .catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
  });
