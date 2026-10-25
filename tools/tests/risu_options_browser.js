'use strict';
const assert = require('assert');
const path = require('path');
const { createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable } = require('./source');
const {waitForAppReady} = require('./helpers/app-ready');
let server, browser;
(async () => {
  server = createAssetServer(path.resolve(__dirname, '../../app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 450, height: 974 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const modelOrigin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(modelOrigin + '/index.html');
  await waitForAppReady(page);
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Risu 选项夹具',
      description: '{{#when::keep::route::tis::1}}BRANCH_B{{:else}}BRANCH_A{{/}}',
      first_mes: 'OPEN',
      character_book: {
        scan_depth: 5,
        token_budget: 800,
        recursive_scanning: true,
        entries: [
          {
            keys: ['shared'],
            content: 'GLOBAL {{upper::seed}}',
            comment: 'shared',
            enabled: true,
            constant: true,
            insertion_order: 100,
          },
        ],
      },
      assets: [
        {
          type: 'icon',
          name: 'main',
          ext: 'png',
          uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        },
      ],
      extensions: {
        risuai: {
          lowLevelAccess: true,
          toggles: 'g=剧情=group\nroute=路线=select=路线甲,路线乙\nflag=额外剧情\ntext=称呼=text\ng=结束=groupEnd',
          defaultVariables: 'runs=0\nbatch=FIRST|||SECOND\nclearBatch=clear|||THIRD|||FOURTH',
          customScripts: [{ type: 'editoutput', in: 'RAW_', out: 'SAVED_' }],
          triggerscript: [
            { type: 'start', comment: 'start', effect: [{ type: 'setvar', var: 'runs', operator: '+=', value: '1' }] },
            {
              type: 'manual',
              comment: '两次生成',
              effect: [{ type: 'command', value: '/getvar key=batch|/multisend {{pipe}}' }],
            },
            {
              type: 'manual',
              comment: '清空后生成',
              effect: [{ type: 'command', value: '/getvar key=clearBatch|/multisend {{pipe}}' }],
            },
            {
              type: 'manual',
              comment: '创建世界书',
              effect: [
                {
                  type: 'v2CreateLorebook',
                  name: 'created',
                  key: 'FOURTH',
                  content: 'CREATED_LORE',
                  insertOrder: '90',
                },
                { type: 'v2GetLorebookCountNew', outputVar: 'globalCount' },
                { type: 'v2SetAuthorNote', value: 'NOTE {{upper::live}}' },
                { type: 'setvar', var: 'noteMacro', operator: '=', value: '{{authornote}}' },
              ],
            },
            {
              type: 'manual',
              comment: 'hosts',
              effect: [
                {
                  type: 'triggerlua',
                  code: `
          hosts=async(function(id)
            local before=getLoreBooks(id,'shared'); setChatVar(id,'globalContent',before[1].content)
            setChatVar(id,'fresh','44')
            upsertLocalLoreBook(id,'shared','LOCAL_LORE {{getvar::fresh}}',{alwaysActive=true,insertOrder=50})
            local after=getLoreBooks(id,'shared'); setChatVar(id,'loreCount',tostring(#after));setChatVar(id,'localFirst',after[1].content)
            setChatVar(id,'loaded',json.encode(loadLoreBooks(id,0)))
            setBackgroundEmbedding(id,'<div id="lua-background">Lua background</div>')
            setChatVar(id,'image',getCharacterImage(id))
            setChatVar(id,'estimatedTokens',tostring(getTokens(id,'你好 hello 😀'):await()))
          end)
        `,
                },
              ],
            },
            { type: 'manual', comment: '检查世界书', effect: [{ type: 'command', value: '/test_lorebook' }] },
            {
              type: 'manual',
              comment: 'vision',
              effect: [
                {
                  type: 'triggerlua',
                  code: `vision=async(function(id)
          local img=getCharacterImage(id)
          local response=LLM(id,{{role='assistant',content='TEXT '..img},{role='assistant',content='DATA '..string.gsub(img,'inlayed::','inlayeddata::')},{role='user',content='SEE '..img}},true)
          setChatVar(id,'visionReply',response.result)
        end)`,
                },
              ],
            },
          ],
        },
      },
    },
  };
  await page.evaluate(() => openModal('import-modal'));
  await page.locator('#file-input').setInputFiles({
    name: 'Risu options.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(card)),
  });
  await page.waitForFunction(() => pending.length === 1 && !_importProgressActive);
  await page.evaluate(() => {
    setPendingImportMode(0, 'direct');
    appConfirm = async () => true;
  });
  await page.locator('#import-preview button.primary').click();
  await page.waitForFunction(
    () =>
      D.characters.length === 1 &&
      !_importProgressActive &&
      !document.getElementById('import-modal').classList.contains('open')
  );
  await page.evaluate(async (apiOrigin) => {
    const char = D.characters[0];
    D.currentCharId = char.id;
    const session = getActiveSession(char.id);
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    session.macroVars = { flag: 'ST_UNCHANGED' };
    ensureProviderSettings(D.settings);
    Object.assign(activeProviderForSettings(D.settings), {
      apiUrl: apiOrigin + '/risu-options-model/v1',
      apiKey: 'local-synthetic',
      model: 'synthetic-model',
      reasoningEffort: 'off',
    });
    Object.assign(D.settings, {
      useMemory: false,
      embeddingEnabled: false,
      styleAuditEnabled: false,
      maxContextTokens: 0,
    });
    await saveData(['sessions', 'meta'], { urgent: true });
    switchAppPage('chat');
    updateChatUI();
    renderChat();
  }, modelOrigin);
  const requests = [];
  await page.route('**/risu-options-model/**', async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, content-type',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers,
      body:
        'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'RAW_' + requests.length }, finish_reason: null }] }) +
        '\n\ndata: ' +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
        '\n\ndata: [DONE]\n\n',
    });
  });
  await page.locator('#chat-tools-toggle').click();
  await page.locator('#risu-options-btn').click();
  const group = page.locator('#risu-options-body details');
  await group.locator('summary').click();
  await page.locator('[data-risu-toggle="flag"]').check();
  await page.waitForFunction(() => getActiveSession(getChar().id).risu?.globalVariables?.toggle_flag === '1');
  await page.locator('[data-risu-toggle="text"]').fill('旅人');
  await page.locator('[data-risu-toggle="text"]').blur();
  await page.waitForFunction(() => getActiveSession(getChar().id).risu?.globalVariables?.toggle_text === '旅人');
  // Native select retains change semantics; click the app's actual choice control.
  await page
    .locator('.risu-option-row')
    .filter({ has: page.locator('[data-risu-toggle="route"]') })
    .locator('.app-select-trigger')
    .click();
  await page.locator('#app-select-list').getByRole('option', { name: '路线乙', exact: true }).click();
  await page.waitForFunction(() => getActiveSession(getChar().id).risu?.globalVariables?.toggle_route === '1');
  await group.locator('summary').click();
  assert.equal(await group.getAttribute('open'), null, 'group must close after writes');
  await page.locator('[data-risu-manual="两次生成"]').click();
  await page.waitForFunction(() => _generationState === 'idle');
  assert.equal(
    await page.evaluate(() => risuOfficialMessages(getActiveSession(getChar().id)).length),
    4,
    await page.locator('body').innerText()
  );
  assert.equal(requests.length, 2, 'multisend waits for two real requests');
  assert(JSON.stringify(requests[0].messages).includes('BRANCH_B'), 'toggle controls outbound branch');
  assert(JSON.stringify(requests[1].messages).includes('SAVED_1'), 'second generation sees completed first output');
  let snapshot = await page.evaluate(() => {
    const session = getActiveSession(getChar().id);
    return {
      raw: risuOfficialMessages(session).map((m) => m.content),
      effective: risuOfficialMessages(session).map(risuMessageText),
      runs: session.risu.scriptstate.$runs,
      st: session.macroVars.flag,
    };
  });
  assert.deepEqual(snapshot.raw, ['FIRST', 'RAW_1', 'SECOND', 'RAW_2']);
  assert.deepEqual(snapshot.effective, ['FIRST', 'SAVED_1', 'SECOND', 'SAVED_2']);
  assert.equal(snapshot.runs, '2');
  assert.equal(snapshot.st, 'ST_UNCHANGED');
  await page.locator('[data-risu-manual="清空后生成"]').click();
  await page.waitForFunction(
    () => _generationState === 'idle' && risuOfficialMessages(getActiveSession(getChar().id)).length === 2
  );
  assert.equal(requests.length, 4);
  assert(!JSON.stringify(requests[3].messages).includes('THIRD'), 'clear applies to every generation');
  await page.locator('[data-risu-manual="创建世界书"]').click();
  await page.waitForFunction(() => _generationState === 'idle');
  await page.locator('[data-risu-manual="hosts"]').click();
  await page.waitForFunction(() => _generationState === 'idle');
  const hostState = await page.evaluate(() => {
    const c = getChar(),
      s = getActiveSession(c.id);
    return {
      vars: s.risu.scriptstate,
      local: s.risu.localLore,
      global: risuLorebookInitialGlobal(c).entries,
      background: risuCardSources(c).card.backgroundHTML,
    };
  });
  assert.equal(hostState.vars.$globalCount, '2');
  assert.equal(
    hostState.vars.$globalContent,
    'GLOBAL SEED',
    JSON.stringify(hostState) + ' ' + (await page.locator('#toasts').innerText())
  );
  assert.equal(hostState.vars.$loreCount, '2');
  assert.equal(Number(hostState.vars.$estimatedTokens), await page.evaluate(() => estTokens('你好 hello 😀')));
  assert.equal(hostState.vars.$localFirst, 'LOCAL_LORE 44');
  assert.equal(hostState.vars.$noteMacro, 'NOTE LIVE', 'CBS reads the author note changed in this transaction');
  assert.equal(
    await page.evaluate(() =>
      risuRenderCBSInWorker(
        '{{metadata::mobile}}/{{metadata::local}}/{{metadata::node}}/{{metadata::risutype}}/{{jbtoggled}}/{{metadata::modelname}}/{{metadata::modelinternalid}}',
        getChar(),
        getActiveSession(getChar().id)
      )
    ),
    '0/0/0/web/0/synthetic-model/synthetic-model'
  );
  assert.equal(hostState.local.length, 1);
  const modelMetadata = await page.evaluate(async () => {
    const settings = D.settings,
      provider = activeProviderForSettings(settings);
    const before = { model: provider.model, apiUrl: provider.apiUrl, profile: settings.activeConnectionProfileId };
    const render = () =>
      risuRenderCBSInWorker(
        '{{model}}/{{metadata::modelformat}}/{{metadata::modelprovider}}/{{metadata::modeltokenizer}}',
        getChar(),
        getActiveSession(getChar().id)
      );
    try {
      const unknown = await render();
      settings.modelPresets.push({
        id: 'risu-metadata-profile',
        name: 'metadata',
        routes: { chat: { model: 'profile-model' } },
      });
      settings.activeConnectionProfileId = 'risu-metadata-profile';
      const profile = await render();
      settings.activeConnectionProfileId = '';
      Object.assign(activeProviderForSettings(settings), {
        apiUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-pro',
      });
      const official = await render();
      activeProviderForSettings(settings).apiUrl = 'https://synthetic.invalid/v1';
      const proxy = await render();
      return { unknown, profile, official, proxy };
    } finally {
      Object.assign(activeProviderForSettings(settings), { model: before.model, apiUrl: before.apiUrl });
      settings.activeConnectionProfileId = before.profile;
      settings.modelPresets = settings.modelPresets.filter((row) => row.id !== 'risu-metadata-profile');
    }
  });
  assert.deepEqual(modelMetadata, {
    unknown: 'synthetic-model/0/4/0',
    profile: 'profile-model/0/4/0',
    official: 'deepseek-v4-pro/0/12/14',
    proxy: 'deepseek-v4-pro/0/4/0',
  });
  assert.equal(hostState.global.length, 2);
  assert(hostState.vars.$loaded.includes('LOCAL_LORE 44') && hostState.vars.$loaded.includes('GLOBAL SEED'));
  assert(hostState.background.includes('lua-background'));
  assert(hostState.vars.$image.startsWith('{{inlayed::yeyu-media:char:'));
  let loreAlert = '';
  page.once('dialog', async (dialog) => {
    loreAlert = dialog.message();
    await dialog.accept();
  });
  await page.locator('[data-risu-manual="检查世界书"]').click();
  await page.waitForFunction(() => _generationState === 'idle');
  assert(loreAlert.includes('LOCAL_LORE') && loreAlert.includes('CREATED_LORE'));
  await page.locator('[data-risu-manual="vision"]').click();
  await page.waitForFunction(() => _generationState === 'idle');
  assert.equal(requests.length, 5);
  assert(
    requests[4].messages.some((row) => row.role === 'assistant' && row.content === 'TEXT '),
    'assistant inlay is stripped without attaching media'
  );
  assert(
    requests[4].messages.some(
      (row) =>
        row.role === 'assistant' && Array.isArray(row.content) && row.content.some((part) => part.type === 'image_url')
    ),
    'assistant inlayeddata attaches its real media'
  );
  assert(
    requests[4].messages.some(
      (row) =>
        Array.isArray(row.content) &&
        row.content.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/'))
    ),
    'Lua multimodal uses actual imported image bytes'
  );
  assert.equal(await page.evaluate(() => getActiveSession(getChar().id).risu.scriptstate.$visionReply), 'RAW_5');
  await page.reload();
  await waitForAppReady(page);
  assert.equal(await page.evaluate(() => getActiveSession(getChar().id).risu.globalVariables.toggle_route), '1');
  assert.equal(await page.evaluate(() => risuOfficialMessages(getActiveSession(getChar().id)).at(-1).content), 'RAW_4');
  assert.equal(await page.evaluate(() => getActiveSession(getChar().id).risu.localLore.length), 1);

  // Card options travel with the reader into the conversation they open from the current one. A
  // card whose whole opening sits inside {{#when::keep::…}} used to open blank after 新建对话 or
  // 清除对话, because the new conversation started with every option unset while the picker had
  // previewed the scene the old conversation selected.
  const previousToggles = await page.evaluate(() => {
    const char = getChar();
    char.first_mes = '{{#when::keep::route::tis::1}}路线乙的开场{{:else}}路线甲的开场{{/when}}';
    appInput = async () => '继承检查';
    appConfirm = async () => true;
    switchAppPage('chat');
    updateChatUI();
    renderChat();
    return Object.assign({}, getActiveSession(char.id).risu.globalVariables);
  });
  assert.deepEqual(previousToggles, { toggle_flag: '1', toggle_route: '1', toggle_text: '旅人' });
  async function pickGreetingPreview() {
    await page.waitForFunction(() => document.getElementById('greeting-modal').classList.contains('open'));
    await page.waitForFunction(
      () => !document.getElementById('greeting-list').innerHTML.includes('正在按当前卡片选项生成预览')
    );
    const preview = (await page.locator('#greeting-list .greeting-preview').first().innerText()).trim();
    await page.locator('#greeting-modal .modal-ft button.primary').click();
    await page.evaluate(() => window.__sessionFlow);
    return preview;
  }
  async function openedState() {
    await page.waitForFunction(
      () => (document.querySelector('#chat-messages .msg[data-msg-idx="0"] .stream-content-slot') || {}).innerText
    );
    const body = (await page.locator('#chat-messages .msg[data-msg-idx="0"] .msg-body').innerText()).trim();
    await page.locator('#chat-tools-toggle').click();
    await page.locator('#risu-options-btn').click();
    const panel = await page.evaluate(() => {
      const session = getActiveSession(getChar().id);
      return {
        route: document.querySelector('[data-risu-toggle="route"]').value,
        flag: document.querySelector('[data-risu-toggle="flag"]').checked,
        text: document.querySelector('[data-risu-toggle="text"]').value,
        toggles: Object.assign({}, session.risu && session.risu.globalVariables),
        scriptRuns: (session.risu && session.risu.scriptstate && session.risu.scriptstate.$runs) || '',
        macroVars: session.macroVars || null,
      };
    });
    await page.locator('#risu-options-modal .modal-ft button').click();
    return { body, panel };
  }
  await page.evaluate(() => {
    window.__sessionFlow = addSession();
  });
  const addedPreview = await pickGreetingPreview();
  assert.equal(addedPreview, '路线乙的开场', '新建对话的弹窗预览按当前对话的卡片选项求值');
  const added = await openedState();
  assert.ok(
    added.body.includes('路线乙的开场') && !added.body.includes('路线甲的开场'),
    '进入新对话后看到的开场白与弹窗预览一致：' + added.body
  );
  assert.deepEqual(added.panel.toggles, previousToggles, '新对话带走当前对话的全部卡片选项');
  assert.equal(added.panel.scriptRuns, '', '卡片选项之外的 Risu 会话变量不得带过去');
  assert.equal(added.panel.macroVars, null, '卡片选项之外的宿主会话变量不得带过去');
  assert.deepEqual(
    { route: added.panel.route, flag: added.panel.flag, text: added.panel.text },
    { route: '1', flag: true, text: '旅人' },
    '新对话的选项面板显示继承下来的选中值'
  );
  await page.evaluate(() => {
    window.__sessionFlow = clearChat();
  });
  const clearedPreview = await pickGreetingPreview();
  assert.equal(clearedPreview, '路线乙的开场', '清除对话的弹窗预览按被清除对话的卡片选项求值');
  const cleared = await openedState();
  assert.ok(
    cleared.body.includes('路线乙的开场') && !cleared.body.includes('路线甲的开场'),
    '清除对话后看到的开场白与弹窗预览一致：' + cleared.body
  );
  assert.deepEqual(cleared.panel.toggles, previousToggles, '清除对话后保留原有的卡片选项');
  assert.equal(await page.evaluate(() => getActiveSession(getChar().id).msgs.length), 1, '清除后只剩新的开场白');

  assert.deepEqual(errors, []);
  console.log(
    'PASS Risu options: actual import, open/close, toggles, branch request, serial multisend/clear, lorebook, background, inlay multimodal, raw text, ST isolation, reload and card-option inheritance into new/cleared conversations (Edge; HTTP; local SSE).'
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
  });
