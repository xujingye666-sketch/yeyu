'use strict';

// Opening the app is not a write. Reopening it over a library the app itself saved leaves every IndexedDB store
// exactly as it was, unknown fields and media included. The one write startup owns is saving interrupted drafts,
// and that write only appends: a stale draft whose reply still exists becomes a hidden candidate at the end of the
// reply's swipes, while what the reader sees, the summary and long-term memory stay. A draft whose save fails on
// a full device is neither deleted nor pruned, even past its retention, and is saved once storage works again.
const assert = require('assert');
const path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');

const DRAFT_PREFIX = 'stream_draft_v1:';
const STALE_DRAFT_TEXT = '旧的重写草稿：守夜人把灯芯剪短。';
const FAILED_DRAFT_TEXT = '保存失败的草稿：雨声压过了脚步。';
const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Every store as raw rows, Blobs and typed arrays by bytes, object keys sorted.
async function dumpStores() {
  const encode = async value => {
    if (value instanceof Blob) return {blobType: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())).join(',')};
    if (ArrayBuffer.isView(value)) return {typed: value.constructor.name, bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).join(',')};
    if (Array.isArray(value)) return Promise.all(value.map(encode));
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = await encode(value[key]);
      return out;
    }
    return value;
  };
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(YeyuRepository.DB_NAME || 'TavernAI');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const dump = {};
    for (const name of Array.from(db.objectStoreNames).sort()) {
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(name, 'readonly'), store = tx.objectStore(name);
        const keys = store.getAllKeys(), values = store.getAll();
        tx.oncomplete = () => resolve(keys.result.map((key, index) => [key, values.result[index]]));
        tx.onerror = () => reject(tx.error);
      });
      dump[name] = await encode(rows);
    }
    return dump;
  } finally {
    db.close();
  }
}

// A device whose storage is full: session writes fail in IndexedDB and the recovery snapshot cannot be written.
function installFullStorage() {
  if (!new URLSearchParams(location.search).has('full-storage')) return;
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () {
    if (this.name === 'sessions') throw new DOMException('fixture storage is full', 'QuotaExceededError');
    return put.apply(this, arguments);
  };
  Storage.prototype.setItem = function () {
    throw new DOMException('fixture storage is full', 'QuotaExceededError');
  };
}

// Saving a draft is a save: it removes the draft record and stamps the meta record's save time.
function withoutDrafts(dump) {
  const copy = JSON.parse(JSON.stringify(dump));
  copy.app_meta = copy.app_meta.filter(([key]) => !String(key).startsWith(DRAFT_PREFIX));
  for (const [key, value] of copy.app_meta) if (key === 'state') delete value.updatedAt;
  return copy;
}

function draftKeys(dump) {
  return dump.app_meta.map(([key]) => String(key)).filter(key => key.startsWith(DRAFT_PREFIX));
}

// The sessions store keeps every character's conversations in one record.
function storedMessage(dump, seq) {
  for (const [, chats] of dump.sessions) {
    for (const box of Object.values(chats)) {
      for (const session of box.sessions || []) {
        const message = (session.msgs || []).find(row => row.seq === seq);
        if (message) return message;
      }
    }
  }
  throw new Error('stored message missing: seq ' + seq);
}

const SWIPE_FIELDS = ['swipes', 'swipeGenerationMeta', 'swipeReasoning', 'swipeImages'];

// Startup may only append candidates to one reply: every earlier candidate field keeps its prefix and every
// other byte of every store is unchanged. Returns the appended candidate texts.
function assertOnlyAppendedCandidates(before, after, seq, label) {
  const left = withoutDrafts(before), right = withoutDrafts(after);
  const oldMessage = storedMessage(left, seq), newMessage = storedMessage(right, seq);
  for (const field of SWIPE_FIELDS) {
    const oldRows = oldMessage[field] || [], newRows = newMessage[field] || [];
    assert.deepStrictEqual(newRows.slice(0, oldRows.length), oldRows, `${label}：${field} 的已有候选必须原样保留`);
  }
  const appended = (newMessage.swipes || []).slice((oldMessage.swipes || []).length);
  for (const field of SWIPE_FIELDS) {
    delete oldMessage[field];
    delete newMessage[field];
  }
  assert.deepStrictEqual(right, left, `${label}：除追加候选与草稿记录外，任何 Store 都不得被启动改写`);
  return appended;
}

let browser, server;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  const port = await listenOnBrowserSafePort(server);
  const url = `http://127.0.0.1:${port}/index.html`;
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  const context = await browser.newContext();
  await context.addInitScript(installFullStorage);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  // Startup finishes with the draft settle pass; anything it scheduled is flushed before the stores are read.
  const open = async (query = '') => {
    await page.goto(url + query);
    await waitForAppReady(page);
    await page.evaluate(async () => {
      await _streamDraftLoadPromise;
      await new Promise(resolve => setTimeout(resolve, 600));
      if (typeof flushPendingSave === 'function') await flushPendingSave().catch(() => {});
    });
    return page.evaluate(dumpStores);
  };

  await open();
  // A library with what users keep: a card and persona with unknown fields, an avatar Blob, a world book with
  // its source evidence, swiped replies with reasoning, a history summary and long-term memory over them.
  await page.evaluate(async avatar => {
    D = defaults();
    D.settings.yeyuFutureSetting = {kept: true};
    const char = parseCard({spec: 'chara_card_v2', spec_version: '2.0', data: {name: '启动守夜人', description: '{{char}}守着灯塔。',
      first_mes: '灯塔的门开了。', alternate_greetings: ['雨停了。'], extensions: {yeyuFutureExtension: {keep: [1, 2]}}}});
    char.id = 'startup-card';
    char.avatar_image = avatar;
    char.yeyuFutureCharacterField = 'kept';
    const session = createBlankSession('守夜', 'startup-session');
    session.yeyuFutureSessionField = {kept: 1};
    const message = (seq, role, content, extra) => Object.assign({seq, role, content, time: 1700000000000 + seq}, extra);
    session.msgs = [
      message(1, 'assistant', '灯塔的门开了。', {swipes: ['灯塔的门开了。', '雨停了。'], swipeId: 0, openingIndex: 0}),
      message(2, 'user', '还有船吗？'),
      message(3, 'assistant', '等雨停。', {swipes: ['明早有。', '等雨停。'], swipeId: 1, reasoning: '他在估算潮汐。',
        swipeReasoning: ['先看天色。', ''], yeyuFutureMessageField: 'kept'}),
      message(4, 'user', '我能留下吗？'),
      message(5, 'assistant', '阁楼还空着。', {swipes: ['阁楼还空着。'], swipeId: 0}),
      message(6, 'user', '谢谢。'),
      message(7, 'assistant', '把湿衣服挂起来。'),
    ];
    session.nextMessageSeq = 8;
    session.memoryStore.historySummary = memoryV5NormalizeHistorySummary({recent_history_summary: '旅人在暴雨夜到了灯塔，守夜人留他过夜。',
      sourceStartSeq: 1, sourceEndSeq: 5, sourceHash: 'startup_range_1_5'}, session.id);
    session.memoryStore.longTermEntries = [memoryV5NormalizeLongTerm({id: 'lt-keeper', type: 'relationship_change', content: '守夜人愿意收留旅人。',
      subject: '守夜人', object: '旅人', sourceStartSeq: 3, sourceEndSeq: 5, sourceHash: 'startup_range_3_5'}, session.id)];
    session.memoryStore.processedThroughSeq = 5;
    D.characters = [char];
    D.currentCharId = char.id;
    D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
    D.personas = [{id: 'startup-persona', name: '旅人', desc: '浑身湿透。', yeyuFuturePersonaField: [true]}];
    D.worldBook.categories = [{id: 'startup-book', name: '灯塔志', boundCharIds: [char.id], yeyuFutureBookField: 'kept',
      entries: [normalizeWBEntry({id: 'lamp', name: '灯', keys: ['灯'], content: '灯油只够一夜。', enabled: true,
        extensions: {_raw: {uid: 7, comment: '灯', yeyuFutureEntryField: 'kept'}}})]}];
    await saveData(['meta', 'characters', 'personas', 'worldbook', 'sessions'], {urgent: true});
  }, PIXEL_PNG);
  // Baselines are the library as the app itself writes it back after loading it.
  const resave = async () => {
    await open();
    await page.evaluate(() => saveData(['meta', 'characters', 'personas', 'worldbook', 'sessions'], {urgent: true}));
    return page.evaluate(dumpStores);
  };
  const saved = await resave();
  assert.ok(saved.media.length >= 1, '夹具应把头像存成媒体 Blob');

  const reopened = await open();
  assert.deepStrictEqual(reopened, saved, '应用重新打开自己保存的数据库时不得写入任何 Store');
  assert.deepStrictEqual(await open(), saved, '再次打开仍不得写入任何 Store');
  assert.deepStrictEqual(await page.evaluate(() => {
    const char = getChar(), session = getActiveSession(char.id);
    return {setting: D.settings.yeyuFutureSetting, character: char.yeyuFutureCharacterField, extension: char.extensions.yeyuFutureExtension,
      session: session.yeyuFutureSessionField, message: session.msgs[2].yeyuFutureMessageField, persona: D.personas[0].yeyuFuturePersonaField,
      book: D.worldBook.categories[0].yeyuFutureBookField};
  }), {setting: {kept: true}, character: 'kept', extension: {keep: [1, 2]}, session: {kept: 1}, message: 'kept', persona: [true], book: 'kept'},
  '加载出的运行数据必须保留各主数据对象内的未知字段');

  // A regenerate draft of the middle reply whose conversation changed after it was written.
  await page.evaluate(async text => {
    const char = getChar(), session = getActiveSession(char.id);
    const draft = makeStreamDraftCheckpoint({charId: char.id, sessionId: session.id, mode: 'regenerate', messageSeq: 5}, session,
      {text, committedBaseHash: 'base-before-later-edits'});
    await persistStreamDraftRecord(draft);
  }, STALE_DRAFT_TEXT);
  const withStaleDraft = await page.evaluate(dumpStores);
  assert.strictEqual(draftKeys(withStaleDraft).length, 1);
  const afterStaleDraft = await open();
  assert.deepStrictEqual(draftKeys(afterStaleDraft), [], '已自动保存的草稿记录应被删除');
  assert.deepStrictEqual(assertOnlyAppendedCandidates(withStaleDraft, afterStaleDraft, 5, '失效草稿启动保存'), [STALE_DRAFT_TEXT],
    '失效草稿应作为对应回复末尾的隐藏候选保存');
  assert.deepStrictEqual(await page.evaluate(() => {
    const session = getActiveSession(getChar().id), reply = session.msgs[4];
    return {shown: reply.content, swipeId: reply.swipeId, summary: session.memoryStore.historySummary.text,
      entries: session.memoryStore.longTermEntries.map(entry => entry.status),
      visible: document.querySelector('#chat-messages [data-msg-seq="5"]').textContent.includes('阁楼还空着。')};
  }), {shown: '阁楼还空着。', swipeId: 0, summary: '旅人在暴雨夜到了灯塔，守夜人留他过夜。', entries: ['active'], visible: true},
  '启动保存草稿不得改变正在显示的回复、历史摘要或长期记忆');
  assert.deepStrictEqual(await open(), afterStaleDraft, '草稿保存后再次启动不得再写入');
  const savedMeta = storedMessage(afterStaleDraft, 5).swipeGenerationMeta.filter(Boolean);
  assert.ok(savedMeta.some(meta => meta.sourceDraftId), '草稿保存的候选应记着来源草稿');
  assert.deepStrictEqual(await page.evaluate(rows => rows.map(sanitizeLoadedGenerationMeta), savedMeta), savedMeta,
    '草稿保存的生成元数据已是读回规范化的结果，加载后再保存不应变化');

  // More stale drafts than the global limit, whose startup saves all fail on a full device: none is pruned, since
  // their text is not in the chat yet, and all are saved once storage works again.
  await resave();
  const failedTexts = await page.evaluate(async text => {
    const char = getChar(), session = getActiveSession(char.id), texts = [];
    for (let index = 0; index <= STREAM_DRAFT_MAX_TOTAL; index++) {
      const draft = makeStreamDraftCheckpoint({charId: char.id, sessionId: session.id, mode: 'regenerate', messageSeq: 3},
        session, {text: text + index, committedBaseHash: 'base-before-later-edits', now: Date.now() - (index + 1) * 60000});
      await persistStreamDraftRecord(draft);
      texts.push(draft.text);
    }
    return texts;
  }, FAILED_DRAFT_TEXT);
  const withFailingDraft = await page.evaluate(dumpStores);
  const failedKeys = draftKeys(withFailingDraft);
  assert.strictEqual(failedKeys.length, failedTexts.length);
  const onFullDevice = await open('?full-storage');
  // Saving notes the reply each draft is about to become a candidate of; their text stays protected.
  assert.deepStrictEqual(draftKeys(onFullDevice), failedKeys, '存储写满导致启动保存失败时，超出上限的草稿也不得被清理');
  assert.deepStrictEqual(onFullDevice.app_meta.filter(([key]) => failedKeys.includes(key)).map(([, draft]) => draft.text).sort(), [...failedTexts].sort());
  assert.deepStrictEqual(withoutDrafts(onFullDevice), withoutDrafts(withFailingDraft), '存储写满时启动保存失败不得改动其他数据');
  assert.match(await page.locator('#stream-draft-recovery-slot .stream-draft-recovery').first().innerText(), /上次生成未完成[\s\S]*重试保存/, '保存失败的草稿应留在聊天里可重试');
  assert.match(await page.locator('#stream-draft-recovery-slot .stream-draft-recovery small').first().innerText(), /自动保存失败：.+草稿仍受保护/, '失效草稿自动保存失败时，恢复卡应显示失败原因');
  const afterRecovery = await open();
  assert.deepStrictEqual(draftKeys(afterRecovery), [], '存储恢复后草稿应被保存并删除记录');
  assert.deepStrictEqual(assertOnlyAppendedCandidates(withFailingDraft, afterRecovery, 3, '存储恢复后保存草稿').sort(), [...failedTexts].sort());
  console.log('startup leaves stores untouched and only appends hidden draft candidates');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) server.close();
});
