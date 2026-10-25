'use strict';

const assert = require('node:assert/strict');
const {openStreamPage} = require('./helpers/stream-page');

(async () => {
  const env = await openStreamPage();
  try {
    const page = env.page;
    const requests = [];
    // Inspect the app's actual speech requests without depending on a cloud service or speakers.
    await page.route('**/t2a_v2', async route => {
      requests.push(route.request().postDataJSON().text);
      await route.fulfill({status: 400, body: ''});
    });
    await page.evaluate(async () => {
      D = defaults();
      const char = parseCard({name: 'Speech regression', first_mes: ''});
      char.id = 'speech-regression';
      const session = createBlankSession('Speech', 'speech-session');
      session.greetingChosen = true;
      session.creatorNotesSeen = true;
      session.msgs = [{role: 'assistant', seq: 1, time: 1, content:
        '*她笑着说“你好”*\n\n<em>他回答「欢迎」</em>\n\n<span class="tone-narration">她轻声说『再见』</span>\n\n*纯动作*\n\n<details><summary>折叠</summary>“秘密”</details>\n\n<span hidden>“隐藏”</span>\n\n剧情选项\n1. “选项一”\n2. “选项二”'}];
      session.nextMessageSeq = 2;
      D.characters = [char];
      D.currentCharId = char.id;
      D.chats = {[char.id]: {activeSid: session.id, sessions: [session]}};
      D.settings.speech = {auto: true, voice: {protocol: 'minimax', minimax: {...speechDefaultVoice('minimax'), apiUrl: location.origin + '/v1'}}};
      Object.assign(D.settings.providers[0], {apiUrl: 'https://example.test/v1', model: 'chat-model'});
      await saveData(['meta', 'characters', 'sessions'], {urgent: true});
      renderChat();
      updateChatUI();
      await speakMessage(0);
    });
    assert.equal(requests.pop(), '你好\n欢迎\n再见');
    await page.evaluate(async () => {
      const char = getChar(), session = getActiveSession(char.id), message = session.msgs[0];
      message.content = '*她笑着说“旧对白”*';
      renderChat();
      const target = {charId: char.id, sessionId: session.id, mode: 'continue', speechSourceOffset: message.content.length};
      message.content += '\n\n*她继续说“新增对白”*';
      renderChat();
      activateGenerationEpoch(target, session);
      await speechGenerated(target, char, session, message);
    });
    assert.equal(requests.pop(), '新增对白');
    await page.evaluate(async () => {
      const char = getChar(), session = getActiveSession(char.id), message = session.msgs[0];
      message.content = '<em>他抬头说“自动对白”</em>\n\n*挥手*';
      renderChat();
      const target = {charId: char.id, sessionId: session.id, mode: 'new'};
      activateGenerationEpoch(target, session);
      await speechGenerated(target, char, session, message);
      D.settings.speech.readFull = true;
      await speakMessage(0);
    });
    assert.equal(requests.shift(), '自动对白');
    assert.match(requests.shift(), /他抬头说“自动对白”[\s\S]*挥手/);
    await page.evaluate(async () => {
      D.settings.speech.readFull = false;
      getMsgs(D.currentCharId)[0].content = '*她挥手*\n\n<em>他点头</em>';
      renderChat();
      await speakMessage(0);
    });
    assert.equal(requests.length, 0, 'Pure actions must not request speech');

    // The reported wrap must stay fixed in the actual message column, with and without swipes.
    await page.evaluate(() => {
      const session = getActiveSession(D.currentCharId);
      session.msgs = [
        {role: 'user', seq: 1, time: 1, content: '短消息'},
        {role: 'assistant', seq: 2, time: 2, content: '普通历史回复'},
        {role: 'assistant', seq: 3, time: 3, content: '候选回复', swipes: ['候选回复', '另一回复'], swipeId: 0},
        {role: 'assistant', seq: 4, time: 4, content: '开场白', opening: true, swipes: ['开场白', '另一开场白'], swipeId: 0},
      ];
      session.nextMessageSeq = 5;
      renderChat();
    });
    const referenceViewport = page.viewportSize();
    for (const width of [320, 360, referenceViewport.width, 480, 768]) {
      await page.setViewportSize({width, height: referenceViewport.height});
      for (const immersive of [false, true]) {
        await page.evaluate(value => document.body.classList.toggle('message-style-immersive', value), immersive);
        for (let index = 0; index < 4; index++) {
          await page.evaluate(i => toggleMessageActions(i), index);
          const toolbar = page.locator(`[data-msg-idx="${index}"] .msg-actions`);
          for (const speaking of [false, true]) {
            await page.evaluate(({i, active}) => {
              _speechRun = active ? {message: getMsgs(D.currentCharId)[i]} : null;
              refreshSpeechUi();
            }, {i: index, active: speaking});
            const layout = await toolbar.evaluate(node => {
              const bar = node.getBoundingClientRect();
              const controls = [...node.querySelectorAll(':scope > .btn, :scope > .opening-swipe-controls, :scope > .msg-more')]
                .filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect());
              return {bar: {left: bar.left, right: bar.right}, controls: controls.map(rect => ({left: rect.left, right: rect.right})), viewport: innerWidth, singleRow: controls.every(rect => rect.top >= bar.top && rect.bottom <= bar.bottom),
                contained: controls.every(rect => rect.left >= bar.left && rect.right <= bar.right + 1) && bar.right <= innerWidth,
                height: bar.height, targets: [...node.querySelectorAll(':scope > .btn')].filter(el => getComputedStyle(el).display !== 'none')
                  .every(el => el.getBoundingClientRect().height >= 28 && el.getBoundingClientRect().width >= 36)};
            });
            assert.equal(layout.singleRow && layout.contained && layout.targets, true, JSON.stringify({width, immersive, index, speaking, layout}));
            assert.ok(layout.height <= 34, 'Actions must not gain a second row');
            assert.equal(await toolbar.getByRole('button', {name: speaking ? '停止' : '朗读', exact: true}).isVisible(), true);
          }
          await toolbar.getByRole('button', {name: '更多', exact: true}).click();
          for (const name of ['翻译', '编辑', '删除', '复制']) {
            assert.equal(await toolbar.getByRole('button', {name, exact: true}).count(), 1, `${name} must remain available exactly once`);
          }
          await page.evaluate(i => toggleMessageActions(i), index);
        }
      }
    }
    await page.setViewportSize(referenceViewport);
    await page.evaluate(() => { _speechRun = null; document.body.classList.remove('message-style-immersive'); });

    await page.evaluate(() => switchAppPage('settings'));
    await page.locator('#s-model').fill('unsaved-chat-model');
    await page.getByRole('tab', {name: '语音朗读', exact: true}).click();
    assert.equal(await page.locator('#st-speech').isVisible(), true);
    assert.equal(await page.locator('#speech-settings-modal').isVisible(), false);
    async function checkSwitch(id) {
      const label = page.locator(`label[for="${id}"]`);
      const geometry = await label.evaluate(node => {
        const copy = node.querySelector('.switch-copy').getBoundingClientRect();
        const control = node.querySelector('.switch-control').getBoundingClientRect();
        return {ordered: copy.right <= control.left, width: control.width, height: control.height};
      });
      assert.ok(geometry.ordered && geometry.width > geometry.height && geometry.height > 16, 'Shared right-hand capsule switch');
      const previous = await page.locator(`#${id}`).isChecked();
      await label.click();
      assert.equal(await page.locator(`#${id}`).isChecked(), !previous);
    }
    await checkSwitch('speech-read-full');
    await page.locator('#speech-global-fields summary').click();
    await checkSwitch('speech-global-field-latex');
    await page.locator('#speech-global-field-voice').fill('global-voice');
    await page.locator('#speech-global-protocol').selectOption('openai');
    await page.locator('#speech-global-fields summary').click();
    await checkSwitch('speech-global-field-customVoice');
    await page.locator('#speech-global-field-voice').fill('nova');
    await page.locator('#speech-global-protocol').selectOption('minimax');
    assert.equal(await page.locator('#speech-global-field-voice').inputValue(), 'global-voice');
    await page.getByRole('tab', {name: 'API', exact: true}).click();
    assert.equal(await page.locator('#s-model').inputValue(), 'unsaved-chat-model');
    await page.getByRole('tab', {name: '语音朗读', exact: true}).click();
    assert.equal(await page.locator('#speech-global-field-voice').inputValue(), 'global-voice');
    assert.equal(await page.evaluate(() => D.settings.speech.voice.minimax.voice), 'female-shaonv');
    await page.locator('#settings-modal .modal-ft .primary').click();
    await page.waitForFunction(() => D.settings.speech.voice.minimax.voice === 'global-voice');
    assert.equal(await page.evaluate(() => D.settings.speech.readFull && D.settings.speech.voice.minimax.latex && D.settings.speech.voice.openai.customVoice), true);
    assert.equal(await page.evaluate(() => activeProviderForSettings(D.settings).model), 'unsaved-chat-model');

    // Navigating away preserves both drafts; saving a role override must not commit either draft.
    await page.locator('#speech-global-field-voice').fill('draft-global');
    await page.evaluate(() => { switchAppPage('chat'); openSpeechSettings(); });
    assert.equal(await page.locator('#speech-field-voice').inputValue(), 'global-voice');
    await page.locator('label[for="speech-override"]').click();
    await page.locator('#speech-field-voice').fill('role-voice');
    await page.locator('#speech-settings-modal .primary').click();
    await page.waitForFunction(() => !_speechEditor);
    assert.equal(await page.evaluate(() => speechConfiguration(getChar()).minimax.voice), 'role-voice');
    assert.equal(await page.evaluate(() => D.settings.speech.voice.minimax.voice), 'global-voice');
    await page.evaluate(() => switchAppPage('settings'));
    assert.equal(await page.locator('#speech-global-field-voice').inputValue(), 'draft-global');
    await page.locator('#settings-modal .modal-ft .primary').click();
    await page.waitForFunction(() => D.settings.speech.voice.minimax.voice === 'draft-global');
    assert.equal(await page.evaluate(() => speechConfiguration(getChar()).minimax.voice), 'role-voice');
    await page.evaluate(() => { switchAppPage('chat'); openSpeechSettings(); });
    await page.locator('label[for="speech-override"]').click();
    await page.locator('#speech-settings-modal .primary').click();
    await page.waitForFunction(() => !_speechEditor);
    assert.equal(await page.evaluate(() => speechConfiguration(getChar()).minimax.voice), 'draft-global');
    await page.evaluate(() => switchAppPage('settings'));
    await page.locator('#speech-global-field-voice').fill('discard-me');
    await page.locator('#settings-modal .modal-ft .text').click();
    await page.evaluate(() => switchAppPage('settings'));
    assert.equal(await page.locator('#speech-global-field-voice').inputValue(), 'draft-global');
    await page.reload();
    const {waitForAppReady} = require('./helpers/app-ready');
    await waitForAppReady(page);
    assert.equal(await page.evaluate(() => D.settings.speech.voice.minimax.voice), 'draft-global');
    console.log('Speech dialogue and settings regression passed');
  } finally {
    await env.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
