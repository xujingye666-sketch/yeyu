/* global XBTasks, __taskRequests, __taskReleases -- runtime facade and page-owned network fixtures */
'use strict';

const assert = require('assert');
const {openStreamPage} = require('./helpers/stream-page');

(async () => {
  const opened = await openStreamPage();
  try {
    const {page} = opened;
    await page.evaluate(async () => {
      disposePresetTaskRuntime();
      D = defaults();
      D.settings.chatCompletionPresetInUse = {prompt_order: [{character_id: 100000, xiaobai_ext: {scheduledTasks: [
        {id: 'init', name: '角色载入', triggerTiming: 'character_init', interval: 1, commands: [
          '<<taskjs>> await STscript("/setvar key=initOwner " + ctx.characterId); ctx.scriptModule.chat_metadata.initRuns = (ctx.scriptModule.chat_metadata.initRuns || 0) + 1; await ctx.scriptModule.saveMetadata(); <</taskjs>>',
          '/xbgenraw nonstream=true 初始化',
          '/setvar key=initReply finished',
        ]},
        {id: 'disabled', name: '停用载入', disabled: true, triggerTiming: 'character_init', interval: 1, commands: ['/setvar key=disabledRan yes']},
        {id: 'manual', name: '改写任务', triggerTiming: 'plugin_init', interval: 0, commands: ['/setvar key=override original']},
      ]}}]};
      Object.assign(D.settings.providers[0], {apiUrl: 'https://tasks.example.test/v1', apiKey: 'synthetic', model: 'task-test'});
      D.characters = ['c1', 'c2', 'c3'].map(id => Object.assign(parseCard({name: id, first_mes: ''}), {id}));
      D.chats = Object.fromEntries(D.characters.map(char => {
        const session = createBlankSession(char.id, 's-' + char.id);
        session.greetingChosen = true;
        return [char.id, {activeSid: session.id, sessions: [session]}];
      }));
      D.currentCharId = '';
      window.__taskRequests = [];
      window.__taskReleases = [];
      const originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (!String(url).startsWith('https://tasks.example.test/')) return originalFetch(url, options);
        const owner = D.currentCharId;
        window.__taskRequests.push({owner, signal: options.signal});
        const response = () => new Response(JSON.stringify({choices: [{message: {content: '完成'}, finish_reason: 'stop'}]}),
          {headers: {'content-type': 'application/json'}});
        return owner === 'c2' ? new Promise(resolve => window.__taskReleases.push(() => resolve(response()))) : response();
      };
      await saveData(['meta', 'characters', 'sessions'], {urgent: true});
      renderCharList();
      initPresetTaskRuntime();
    });
    await page.evaluate(() => selectCharacter('c1'));
    assert.deepStrictEqual(await page.evaluate(() => ({enabled: D.settings.presetEmbeddedTasksEnabled,
      calls: __taskRequests.length, owner: getActiveSession('c1').stscriptVars && getActiveSession('c1').stscriptVars.initOwner})),
    {enabled: false, calls: 0, owner: undefined}, '角色载入不得自动启用任务');

    await page.evaluate(async () => { D.settings.presetEmbeddedTasksEnabled = true; await selectCharacter('c3'); });
    assert.deepStrictEqual(await page.evaluate(() => {
      const session = getActiveSession('c3');
      return {owner: (session.stscriptVars || {}).initOwner, reply: (session.stscriptVars || {}).initReply,
        runs: (session.tavernHelperMetadata || {}).initRuns, disabled: (session.stscriptVars || {}).disabledRan, calls: __taskRequests.length};
    }), {owner: 'c3', reply: 'finished', runs: 1, disabled: undefined, calls: 1}, '启用的载入任务应属于选中的角色与会话');
    assert.deepStrictEqual(await page.evaluate(async () => {
      const raw = JSON.stringify(activeCompletionPresetRaw());
      XBTasks.setCommands('改写任务', ['/setvar key=override commands']);
      XBTasks.setProps('改写任务', {floorType: 'user'});
      const commands = [XBTasks.list(), XBTasks.dump()].map(rows => rows.find(row => row.id === 'manual').commands);
      commands.push(XBTasks.find('改写任务').task.commands, presetTaskRuntime.find('改写任务').commands);
      await XBTasks.exec('改写任务');
      const executedCommands = getActiveSession('c3').stscriptVars.override;
      XBTasks.setJS('改写任务', 'await STscript("/setvar key=override js")');
      const js = XBTasks.find('改写任务').task.commands;
      await XBTasks.exec('改写任务');
      return {commands, js, executedCommands, executedJS: getActiveSession('c3').stscriptVars.override,
        floorType: XBTasks.find('改写任务').task.floorType, rawUnchanged: raw === JSON.stringify(activeCompletionPresetRaw())};
    }), {commands: Array.from({length: 4}, () => ['/setvar key=override commands']),
      js: ['<<taskjs>>await STscript("/setvar key=override js")<</taskjs>>'], executedCommands: 'commands',
      executedJS: 'js', floorType: 'user', rawUnchanged: true}, '任务公开有效读取须与真实 STScript 执行及其他覆盖字段一致，raw 不变');
    assert.strictEqual(await page.evaluate(async () => {
      XBTasks.setJS('改写任务', 'await STscript("/setvar key=moduleExposed " + String("saveMetadata" in await import("/script.js")));');
      await XBTasks.exec('改写任务');
      return getActiveSession('c3').stscriptVars.moduleExposed;
    }), 'false', '未提供 scriptModule 的任务不得新增模块能力');
    await page.evaluate(async () => {
      await selectCharacter('c3');
      await presetTaskCall('onCharacterInitialized', {characterId: 'c3', sessionId: 's-c3'});
    });
    assert.strictEqual(await page.evaluate(() => __taskRequests.length), 1, '重复载入同一当前角色不应重复执行');

    await page.evaluate(() => { window.__selectSlow = selectCharacter('c2'); });
    await page.waitForFunction(() => __taskReleases.length === 1);
    assert.strictEqual(await page.evaluate(async () => {
      await presetTaskCall('onCharacterChanged', 'c2');
      await presetTaskCall('onSessionChanged', 's-c2');
      return __taskRequests.find(row => row.owner === 'c2').signal.aborted;
    }), false, '重复同步相同身份不得误取消正在运行的载入任务');
    await page.evaluate(async () => {
      await selectCharacter('c1');
      __taskReleases[0]();
      await window.__selectSlow;
      await flushPendingSave();
    });
    assert.deepStrictEqual(await page.evaluate(async () => {
      const saved = (await YeyuRepository.load()).data;
      const slow = getActiveSession('c2'), active = getActiveSession('c1');
      return {current: D.currentCharId, oldOwner: slow.stscriptVars.initOwner, oldReply: slow.stscriptVars.initReply,
        aborted: __taskRequests.find(row => row.owner === 'c2').signal.aborted,
        activeOwner: active.stscriptVars.initOwner, activeReply: active.stscriptVars.initReply,
        savedOldReply: saved.chats.c2.sessions[0].stscriptVars.initReply, requests: __taskRequests.length};
    }), {current: 'c1', oldOwner: 'c2', oldReply: undefined, aborted: true,
      activeOwner: 'c1', activeReply: 'finished', savedOldReply: undefined, requests: 3},
    '离开角色应停止旧任务，迟到生成不得把后续命令写进旧角色或当前角色');

    await page.route('https://tasks.example.test/**', route => route.fulfill({contentType: 'application/json',
      body: JSON.stringify({choices: [{message: {content: '完成'}, finish_reason: 'stop'}]})}));
    await page.reload({waitUntil: 'load'});
    await page.waitForFunction(() => presetTaskRuntime && getActiveSession('c1').tavernHelperMetadata.initRuns === 2);
    assert.strictEqual(await page.evaluate(() => getActiveSession('c1').stscriptVars.initOwner), 'c1', '应用启动恢复当前角色也应触发载入任务');
    console.log('preset character-init: default disabled, identity, deduplication, cancellation, late reply, reload: ok');
  } finally {
    await opened.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
