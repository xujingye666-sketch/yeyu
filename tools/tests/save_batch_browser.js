'use strict';

const {runStreamPage} = require('./helpers/stream-page');

runStreamPage(async scenario => {
  await scenario('保存批次独立返回结果', `
    const {session} = await reset();
    await saveData(null, {urgent: true});
    const put = IDBObjectStore.prototype.put;
    const transaction = IDBDatabase.prototype.transaction;
    const setItem = Storage.prototype.setItem;
    let second, injected = false;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'app_meta' && key === 'state' && value.settings.batchFailure)
        throw new DOMException('second batch quota', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === FALLBACK_KEY) throw new DOMException('fallback quota', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
    IDBDatabase.prototype.transaction = function(names, mode, options) {
      const tx = transaction.call(this, names, mode, options);
      if (!injected && mode === 'readwrite' && Array.from(tx.objectStoreNames).includes('sessions')) {
        injected = true;
        tx.addEventListener('complete', () => {
          D.settings.batchFailure = true;
          second = saveData('meta', {urgent: true});
        });
      }
      return tx;
    };
    session.msgs.push({role: 'assistant', seq: 2, content: '已成功的第一批'});
    let firstError, secondError;
    try {
      firstError = await failure(() => saveData('sessions', {urgent: true}));
      assert.ok(second, '第二批应在第一批事务完成时排队');
      secondError = await failure(() => second);
    } finally {
      IDBObjectStore.prototype.put = put;
      IDBDatabase.prototype.transaction = transaction;
      Storage.prototype.setItem = setItem;
      delete D.settings.batchFailure;
    }
    assert.strictEqual(firstError, null, '已提交的第一批不得被后批双重失败连带拒绝');
    assert.ok(secondError && /本地存储写入失败/.test(secondError.message));
    const persisted = (await YeyuRepository.load()).data;
    assert.strictEqual(persisted.chats.c1.sessions[0].msgs[1].content, '已成功的第一批');
    assert.ok(!persisted.settings.batchFailure, '失败第二批不能落盘');
    await saveData('meta', {urgent: true});
    assert.strictEqual(_pendingPrimarySections.size, 0, '恢复后补写失败批所属分区');
  `);
  await scenario('恢复快照只确认实际捕获的保存', `
    const {char} = await reset();
    await saveData(null, {urgent: true});
    const put = IDBObjectStore.prototype.put;
    const setItem = Storage.prototype.setItem;
    let second, writes = 0;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'app_meta' && key === 'state') throw new DOMException('primary quota', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    Storage.prototype.setItem = function(key, value) {
      const result = setItem.call(this, key, value);
      if (key === FALLBACK_KEY && ++writes === 1) queueMicrotask(() => {
        char.name = '快照落盘之后的批次';
        second = saveData('characters', {urgent: true, clearStreamDraftId: 'late-draft'});
      });
      return result;
    };
    char.name = '第一批快照';
    try {
      await saveData('characters', {urgent: true});
      assert.ok(second);
      await second;
      const stored = JSON.parse(localStorage.getItem(FALLBACK_KEY));
      assert.strictEqual(JSON.parse(stored.snapshot).characters[0].name, '快照落盘之后的批次', '未被首批快照捕获的晚到保存必须实际落盘后才成功');
      assert.deepStrictEqual(stored.clearedStreamDraftIds, ['late-draft'], '晚到草稿删除意图必须随其所属批次保存');
      assert.strictEqual(writes, 2);
    } finally {
      IDBObjectStore.prototype.put = put;
      Storage.prototype.setItem = setItem;
    }
    await flushPendingSave();
    assert.strictEqual(_pendingPrimaryStreamDraftClearIds.size, 0);
  `);
  console.log('save batches return their own committed results');
});
