'use strict';

const assert = require('assert');
const path = require('path');
const {listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable, createAssetServer} = require('./source');
const {capturePageDiagnostics} = require("./helpers/page-diagnostics");

const {waitForAppReady} = require('./helpers/app-ready');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'app/src/main/assets');
let browser;
let server;

async function openCleanPage() {
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  const page = await context.newPage();
  const {pageErrors} = capturePageDiagnostics(page, {captureConsole: false});
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {waitUntil: 'load'});
  assert.strictEqual(response.headers()['cache-control'], 'no-store');
  await waitForAppReady(page, {timeout: 15000});
  await page.evaluate(async () => { try { await flushPendingSave(); } catch (_) {} });
  assert.deepStrictEqual(pageErrors, []);
  return {context, page, pageErrors};
}

(async () => {
  server = createAssetServer(assets);
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});

  {
    const {context, page, pageErrors} = await openCleanPage();
    const proof = await page.evaluate(async () => {
      localStorage.clear();
      D = defaults();
      const realSave = window.YeyuRepository.save.bind(window.YeyuRepository);
      const imageBytes = Uint8Array.from({length: 24581}, (_, index) => (index * 37 + 11) & 255);
      const audioBytes = Uint8Array.from({length: 32789}, (_, index) => (index * 53 + 7) & 255);
      const existingBytes = new Uint8Array([0, 17, 128, 254, 255]);
      const char = {
        id: 'snapshot-recovery-char',
        name: '二进制恢复角色',
        avatar_image: '',
        background_image: '',
        media_assets: [{id: 'existing', name: 'existing.webp', type: 'image', mime: 'image/webp', bytes: existingBytes}],
      };
      D.characters = [char];
      D.currentCharId = char.id;
      D.chats = {[char.id]: {activeSid: 'snapshot-recovery-session', sessions: [{id: 'snapshot-recovery-session', name: '恢复测试', msgs: [{seq: 1, role: 'user', content: '保存未落库图音'}], nextMessageSeq: 2}]}};
      await realSave(D, {sections: ['meta', 'characters', 'personas', 'worldbook', 'sessions', 'wheels']});
      const existingKey = char.media_assets[0].mediaKey;
      const existingHash = char.media_assets[0].mediaHash;
      delete char.media_assets[0].blob;
      char.media_assets.push(
        {id: 'image-new', name: 'new-image.png', type: 'image', mime: 'image/png', bytes: imageBytes},
        {id: 'audio-new', name: 'new-audio.ogg', type: 'audio', mime: 'audio/ogg', blob: new Blob([audioBytes], {type: 'audio/ogg'})},
      );

      await new Promise(resolve => setTimeout(resolve, 5));
      window.YeyuRepository.save = async () => { throw new Error('synthetic primary failure'); };
      await saveData('characters', {urgent: true});
      const degradedMode = _storageHealth.lastSaveMode;
      const fallbackBox = JSON.parse(localStorage.getItem(FALLBACK_KEY));
      const encoded = JSON.parse(fallbackBox.snapshot);
      const encodedAssets = encoded.characters[0].media_assets;
      const imageSidecar = fallbackBox.binary.find(row => JSON.stringify(row.path) === JSON.stringify(['characters', 0, 'media_assets', 1, 'bytes']));
      const audioSidecar = fallbackBox.binary.find(row => JSON.stringify(row.path) === JSON.stringify(['characters', 0, 'media_assets', 2, 'blob']));
      const recovered = await loadDataAsync();
      const recoveredAssets = recovered.characters[0].media_assets;
      const recoveredImage = recoveredAssets.find(asset => asset.id === 'image-new');
      const recoveredAudio = recoveredAssets.find(asset => asset.id === 'audio-new');
      const recoveredExisting = recoveredAssets.find(asset => asset.id === 'existing');
      const imageBeforeRetry = recoveredImage.bytes instanceof Uint8Array ? Array.from(recoveredImage.bytes) : [];
      const audioBeforeRetry = recoveredAudio.blob instanceof Blob ? Array.from(new Uint8Array(await recoveredAudio.blob.arrayBuffer())) : [];

      D = recovered;
      const pendingAfterSnapshotLoad = Array.from(_pendingPrimarySections).sort();
      const retryToasts = [];
      window.toast = (message, type) => retryToasts.push({message: String(message), type: String(type || '')});
      await retryPendingPrimarySave();
      const failedRetry = {
        pending: Array.from(_pendingPrimarySections).sort(),
        bannerVisible: !document.getElementById('storage-health-banner').hidden,
        toast: retryToasts[retryToasts.length - 1],
      };

      window.YeyuRepository.save = realSave;
      _storageHealth.lastSaveMode = 'IndexedDB 正常保存';
      renderStorageHealthStatus();
      const bannerVisibleWhilePending = !document.getElementById('storage-health-banner').hidden;
      await retryPendingPrimarySave();
      const bannerHiddenAfterFlush = document.getElementById('storage-health-banner').hidden;
      const storedImageAsset = D.characters[0].media_assets.find(asset => asset.id === 'image-new');
      const storedAudioAsset = D.characters[0].media_assets.find(asset => asset.id === 'audio-new');
      const storedExistingAsset = D.characters[0].media_assets.find(asset => asset.id === 'existing');
      const storedImageBlob = await window.YeyuRepository.loadMediaBlob(storedImageAsset.mediaKey);
      const storedAudioBlob = await window.YeyuRepository.loadMediaBlob(storedAudioAsset.mediaKey);
      const storedExistingBlob = await window.YeyuRepository.loadMediaBlob(storedExistingAsset.mediaKey);
      const fallbackCleared = localStorage.getItem(FALLBACK_KEY) === null;

      localStorage.setItem(FALLBACK_KEY, JSON.stringify({savedAt: 1, snapshot: JSON.stringify({settings: {themeMode: 'stale'}})}));
      D.settings.themeMode = 'primary-fresh';
      await saveData('meta', {urgent: true});
      const stored = await window.YeyuRepository.load();
      return {
        degradedMode,
        finalMode: _storageHealth.lastSaveMode,
        encoding: fallbackBox.encoding,
        encodedImagePlaceholder: encodedAssets.find(asset => asset.id === 'image-new').bytes,
        encodedAudioPlaceholder: encodedAssets.find(asset => asset.id === 'audio-new').blob,
        encodedImageKind: imageSidecar && imageSidecar.kind,
        encodedAudioKind: audioSidecar && audioSidecar.kind,
        recoveredImageMatches: imageBeforeRetry.length === imageBytes.length && imageBeforeRetry.every((value, index) => value === imageBytes[index]),
        recoveredAudioMatches: audioBeforeRetry.length === audioBytes.length && audioBeforeRetry.every((value, index) => value === audioBytes[index]),
        recoveredAudioType: recoveredAudio.blob.type,
        existingReferenceBeforeRetry: recoveredExisting.mediaKey === existingKey && recoveredExisting.mediaHash === existingHash && !('bytes' in recoveredExisting) && !('blob' in recoveredExisting),
        storedImageMatches: Array.from(new Uint8Array(await storedImageBlob.arrayBuffer())).every((value, index) => value === imageBytes[index]) && storedImageBlob.size === imageBytes.length,
        storedAudioMatches: Array.from(new Uint8Array(await storedAudioBlob.arrayBuffer())).every((value, index) => value === audioBytes[index]) && storedAudioBlob.size === audioBytes.length,
        storedAudioType: storedAudioBlob.type,
        existingReferenceAfterRetry: storedExistingAsset.mediaKey === existingKey && Array.from(new Uint8Array(await storedExistingBlob.arrayBuffer())).every((value, index) => value === existingBytes[index]),
        fallbackCleared,
        pendingAfterSnapshotLoad,
        failedRetry,
        bannerVisibleWhilePending,
        bannerHiddenAfterFlush,
        pendingSections: Array.from(_pendingPrimarySections),
        staleFallbackClearedByPrimarySave: localStorage.getItem(FALLBACK_KEY) === null,
        primaryTheme: stored && stored.data && stored.data.settings.themeMode,
      };
    });
    assert.deepStrictEqual(proof, {
      degradedMode: '本地恢复快照',
      finalMode: 'IndexedDB 正常保存',
      encoding: 'yeyu-binary-sidecar-v1',
      encodedImagePlaceholder: null,
      encodedAudioPlaceholder: null,
      encodedImageKind: 'Uint8Array',
      encodedAudioKind: 'Blob',
      recoveredImageMatches: true,
      recoveredAudioMatches: true,
      recoveredAudioType: 'audio/ogg',
      existingReferenceBeforeRetry: true,
      storedImageMatches: true,
      storedAudioMatches: true,
      storedAudioType: 'audio/ogg',
      existingReferenceAfterRetry: true,
      fallbackCleared: true,
      pendingAfterSnapshotLoad: ['characters', 'meta', 'personas', 'sessions', 'wheels', 'worldbook'],
      failedRetry: {
        pending: ['characters', 'meta', 'personas', 'sessions', 'wheels', 'worldbook'],
        bannerVisible: true,
        toast: {message: '仍未保存成功：内容继续临时保留在本机', type: 'err'},
      },
      bannerVisibleWhilePending: true,
      bannerHiddenAfterFlush: true,
      pendingSections: [],
      staleFallbackClearedByPrimarySave: true,
      primaryTheme: 'primary-fresh',
    }, '未持久化 Uint8Array/Blob 必须经降级快照、重载和主仓库重试逐字节保真，已有引用保持有效；手动重试仍失败时不得误报已恢复，主仓库正常保存须清掉旧恢复快照');
    assert.deepStrictEqual(pageErrors, []);
    await context.close();
  }

  {
    const {context, page, pageErrors} = await openCleanPage();
    await page.evaluate(async () => {
      localStorage.clear();
      D = defaults();
      D.characters = [{id: 'boot-char', name: '快照重载角色'}];
      D.currentCharId = 'boot-char';
      window.YeyuRepository.save = async () => { throw new Error('synthetic primary failure'); };
      await saveData(['meta', 'characters'], {urgent: true});
    });
    await page.reload({waitUntil: 'load'});
    await waitForAppReady(page, {timeout: 15000});
    await page.waitForFunction(() => _pendingPrimarySections.size === 0, null, {timeout: 15000});
    const proof = await page.evaluate(async () => {
      const stored = await window.YeyuRepository.load();
      return {
        recoveredSource: _storageHealth.source,
        recoveredNames: D.characters.map(row => row.name),
        storedNames: (stored && stored.data && stored.data.characters || []).map(row => row.name),
        bannerHidden: document.getElementById('storage-health-banner').hidden,
        fallbackCleared: localStorage.getItem(FALLBACK_KEY) === null,
      };
    });
    assert.deepStrictEqual(proof, {
      recoveredSource: '本地恢复快照',
      recoveredNames: ['快照重载角色'],
      storedNames: ['快照重载角色'],
      bannerHidden: true,
      fallbackCleared: true,
    }, '从恢复快照读到的数据必须在启动后自动写回 IndexedDB，并在成功后收起提示');
    assert.deepStrictEqual(pageErrors, []);
    await context.close();
  }

  {
    const {context, page, pageErrors} = await openCleanPage();
    const proof = await page.evaluate(async () => {
      localStorage.clear();
      D = defaults();
      D.settings.themeMode = 'snapshot-only';
      window.YeyuRepository.save = async () => { throw new Error('synthetic primary failure'); };
      await saveData('meta', {urgent: true});
      _pendingPrimarySections.clear();
      let writes = 0;
      window.YeyuRepository.save = async () => { writes += 1; };
      window.YeyuRepository.load = async () => { throw new Error('上次保存未完整完成，请保留应用数据并重新尝试读取'); };
      const loaded = await loadDataAsync();
      const loadedTheme = loaded.settings.themeMode;
      D = loaded;
      renderStorageHealthStatus();
      const banner = document.getElementById('storage-health-banner');
      const bannerVisible = !banner.hidden;
      const bannerText = banner.textContent;
      const pendingAfterLoad = Array.from(_pendingPrimarySections);

      D.settings.themeMode = 'edited-under-readonly';
      let editRejected = '';
      try {
        await saveData('meta', {urgent: true});
      } catch (error) {
        editRejected = String(error && error.message || error);
      }
      const writesAfterEdit = writes;
      const pendingAfterBlockedEdit = Array.from(_pendingPrimarySections);
      const fallbackKeptAfterEdit = localStorage.getItem(FALLBACK_KEY) !== null;

      window.toast = () => {};
      let disabledDuringConfirm = null;
      window.appConfirm = async () => {
        disabledDuringConfirm = banner.querySelector('button').disabled;
        return false;
      };
      await retryPendingPrimarySave();
      const writesAfterDecline = writes;
      const buttonAfterDecline = banner.querySelector('button').disabled;

      window.appConfirm = async () => true;
      await retryPendingPrimarySave();
      return {
        loadedTheme,
        source: _storageHealth.source,
        pendingAfterLoad,
        pending: Array.from(_pendingPrimarySections),
        writes,
        fallbackKept: fallbackKeptAfterEdit,
        bannerVisible,
        bannerMentionsReadFailure: bannerText.includes('数据库未能读取'),
        editRejected,
        writesAfterEdit,
        writesAfterDecline,
        pendingAfterBlockedEdit,
        disabledDuringConfirm,
        buttonAfterDecline,
        bannerHiddenAfterConfirm: banner.hidden,
        readOnlyCleared: _storageHealth.readOnlyFallback === false,
      };
    });
    assert.match(proof.editRejected, /数据库上次读取失败/);
    assert.deepStrictEqual(proof, {
      loadedTheme: 'snapshot-only',
      source: '本地恢复快照',
      pendingAfterLoad: [],
      pending: [],
      writes: 1,
      fallbackKept: true,
      bannerVisible: true,
      bannerMentionsReadFailure: true,
      editRejected: proof.editRejected,
      writesAfterEdit: 0,
      writesAfterDecline: 0,
      pendingAfterBlockedEdit: [],
      disabledDuringConfirm: true,
      buttonAfterDecline: false,
      bannerHiddenAfterConfirm: true,
      readOnlyCleared: true,
    }, '主仓库读取异常时恢复快照只读展示并保留降级横幅，用户确认覆盖前不得写入数据库');
    assert.deepStrictEqual(pageErrors, []);
    await context.close();
  }

  {
    const {context, page} = await openCleanPage();
    const proof = await page.evaluate(async () => {
      const raw = JSON.stringify({savedAt: Date.now() + 100000, snapshot: JSON.stringify(defaults())});
      localStorage.setItem(FALLBACK_KEY, raw);
      await loadDataAsync();
      let writes = 0;
      window.YeyuRepository.save = async () => { writes++; };
      D = defaults();
      showStorageRecoveryScreen(new Error('synthetic initialization failure'));
      await flushPendingSave().catch(() => {});
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
      _saveDrainPromise = Promise.resolve();
      triggerSaveDrain();
      return {writes, retained: localStorage.getItem(FALLBACK_KEY) === raw};
    });
    assert.deepStrictEqual(proof, {writes: 0, retained: true});
    const refusal = await page.evaluate(async () => {
      localStorage.setItem(FALLBACK_KEY, '{broken');
      window.YeyuRepository.load = async () => { throw new Error('unreadable database'); };
      try { await loadDataAsync(); } catch (error) { return !!error.restartRecoverySnapshot; }
    });
    assert.strictEqual(refusal, false, '数据库不可读时不得提供重新开始');
    await context.close();
  }
  {
    const {context, page} = await openCleanPage();
    await page.evaluate(async () => {
      await flushPendingSave();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('TavernAI');
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      localStorage.setItem(FALLBACK_KEY, '{broken');
    });
    await page.reload();
    const restart = page.getByRole('button', {name: '重新开始', exact: true});
    await restart.click();
    assert.strictEqual(await page.evaluate(() => localStorage.getItem(FALLBACK_KEY)), '{broken');

    await page.getByRole('button', {name: '确认放弃快照并重新开始', exact: true}).click();
    await waitForAppReady(page);
    await page.waitForFunction(() => !document.querySelector('.storage-recovery-screen'));
    assert.strictEqual(await page.evaluate(() => localStorage.getItem(FALLBACK_KEY)), null);
    await context.close();
  }
  console.log('snapshot binary recovery tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
