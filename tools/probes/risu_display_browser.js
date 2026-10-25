'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  createAssetServer,
  listenOnBrowserSafePort,
  loadPlaywright,
  resolveEdgeExecutable,
} = require('../tests/source');
const root = path.resolve(__dirname, '../..');
const {resolveCardPaths} = require('./real_cards');
const {waitForAppReady} = require('../tests/helpers/app-ready');
const files = resolveCardPaths(process.argv.slice(2), '用法：node tools/probes/risu_display_browser.js <原卡路径> [原卡路径...]');
const screenshotDir = path.join(root, '.tmp', 'risu-display');
fs.mkdirSync(screenshotDir, { recursive: true });
let server, browser;
async function importCard(page, file) {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await waitForAppReady(page);
  await page.evaluate(() => {
    openModal('import-modal');
    resetImport();
  });
  await page.locator('#file-input').setInputFiles(file);
  await page.waitForFunction(() => pending.length === 1 && !_importProgressActive);
  await page.evaluate(() => {
    setPendingImportMode(0, 'direct');
    appConfirm = async () => true;
  });
  await page.locator('#import-preview button.primary').click();
  await page.waitForFunction(() => D.characters.length === 1 && !_importProgressActive);
  await page.evaluate(() => {
    const char = D.characters[0],
      session = getActiveSession(char.id);
    D.currentCharId = char.id;
    session.greetingChosen = true;
    session.creatorNotesSeen = true;
    if (!session.msgs.length && char.first_mes) appendOpeningGreeting(char, session, char.first_mes, 0);
    switchAppPage('chat');
    updateChatUI();
    renderChat();
  });
}
async function probeOriginalToggle(page, requests) {
  // Discover an actual card-owned branch that reaches the ordinary Prompt builder.
  // Keep source text and request bodies in memory; report only hashes and booleans.
  const candidate = await page.evaluate(async () => {
    const char = getChar(),
      session = getActiveSession(char.id),
      sources = risuCardSources(char);
    const flatten = (rows) => rows.flatMap((row) => (row.children ? flatten(row.children) : [row]));
    const items = flatten(risuToggleItems(sources.card.toggles || sources.card.customModuleToggle || ''));
    const original = [
      char.description,
      char.personality,
      char.scenario,
      ...risuLorebookInitialGlobal(char).entries.map((row) => row.content),
    ].join('\n');
    for (const item of items.filter((row) => row.type === 'select' && row.options.length > 1)) {
      if (!original.includes('::' + item.key + '::tis::')) continue;
      const outputs = [];
      for (const value of ['0', '1']) {
        const current = session.risu || {};
        const view = Object.assign({}, session, {
          risu: Object.assign({}, current, {
            globalVariables: Object.assign({}, current.globalVariables, { ['toggle_' + item.key]: value }),
          }),
        });
        outputs.push((await buildMessages(char, view.msgs, view, { commit: false }))
          .messages.map((row) => String(row.content || ''))
          .join('\n'));
      }
      const markers = outputs.map(
        (value, index) =>
          value
            .split('\n')
            .map((line) => line.trim())
            .find(
              (line) =>
                line.length > 20 &&
                line.length < 600 &&
                !line.includes('{{') &&
                original.includes(line) &&
                !outputs[1 - index].includes(line)
            ) || ''
      );
      if (markers.every(Boolean)) return { key: item.key, markers };
    }
    return null;
  });
  assert(candidate, 'original Adelheid select must change two card-owned branches in actual Prompt output');
  async function choose(value) {
    await page.locator('#chat-tools-toggle').click();
    await page.locator('#risu-options-btn').click();
    const row = page
      .locator('.risu-option-row')
      .filter({ has: page.locator('[data-risu-toggle="' + candidate.key + '"]') });
    const group = row.locator('xpath=ancestor::details[1]');
    if ((await group.count()) && (await group.getAttribute('open')) === null) await group.locator('summary').click();
    await row.locator('.app-select-trigger').click();
    await page.locator('#app-select-list [role="option"]').nth(Number(value)).click();
    await page.waitForFunction(
      ({ key, value }) => getActiveSession(getChar().id).risu?.globalVariables?.['toggle_' + key] === value,
      { key: candidate.key, value }
    );
    if (await group.count()) {
      await group.locator('summary').click();
      assert.equal(await group.getAttribute('open'), null, 'original toggle group must collapse after selection');
    }
    await page.locator('#risu-options-modal .modal-close').click();
  }
  for (const value of ['0', '1']) {
    await choose(value);
    const before = requests.length;
    await page.locator('#user-input').fill('继续演出');
    await page.locator('#composer-action-btn').click();
    await page.waitForFunction(() => _generationState === 'idle');
    assert.equal(requests.length, before + 1, 'original toggle check must reach the real send request');
    const outbound = requests[before].messages.map((row) => String(row.content || '')).join('\n');
    assert(outbound.includes(candidate.markers[Number(value)]), 'actual request omitted selected original card branch');
    assert(
      !outbound.includes(candidate.markers[1 - Number(value)]),
      'actual request retained unselected original card branch'
    );
  }
  await page.reload();
  await waitForAppReady(page);
  const persisted = await page.evaluate(async ({ key, markers }) => {
    const char = D.characters[0],
      session = getActiveSession(char.id);
    const output = (await buildMessages(char, session.msgs, session, { commit: false }))
      .messages.map((row) => String(row.content || ''))
      .join('\n');
    return (
      session.risu.globalVariables['toggle_' + key] === '1' &&
      output.includes(markers[1]) &&
      !output.includes(markers[0])
    );
  }, candidate);
  assert(persisted, 'original branch selection must survive actual page reload');
  return {
    actualSelectClicks: true,
    groupExpandCollapse: true,
    twoBranchRequests: true,
    reload: true,
    branchHashes: candidate.markers.map((value) => crypto.createHash('sha256').update(value).digest('hex')),
  };
}

async function probeCard(page, file) {
  const errors = [],
    requests = [];
  let modelReply = '';
  page.on('pageerror', (error) => errors.push(String(error)));
  const baseName = path.basename(file),
    probeKind = baseName.includes('바이 &')
      ? 'vi'
      : baseName.startsWith('허접')
        ? 'asset'
        : baseName === 'Adelheid Hitler.charx'
          ? 'adelheid'
          : baseName === 'RisuAI-Sign here hero.png'
            ? 'sign'
            : 'opening';
  await page.route('**/risu-display-model/**', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        'data: ' +
        JSON.stringify({ choices: [{ delta: { content: modelReply }, finish_reason: null }] }) +
        '\n\ndata: ' +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
        '\n\ndata: [DONE]\n\n',
    });
  });
  await importCard(page, file);
  const inventory = await page.evaluate(async (probeKind) => {
    const char = getChar(),
      session = getActiveSession(char.id),
      sources = risuCardSources(char),
      context = await risuDisplayAssetContext(char);
    const actual = char.media_assets
      .filter((asset) => asset.assetType === 'x-risu-asset' || asset.assetType === 'emotion')
      .filter((asset) => asset.status !== 'unavailable');
    const first = context.assets[0] || context.emotionEntries[0] || null;
    let macro = '';
    if (first)
      macro = (
        await risuDisplaySource(
          '{{' + (first.type === 'emotion' ? 'emotion' : 'raw') + '::' + first.name + '}}',
          char,
          {}
        )
      ).text;
    const safeManual = sources.triggers
      .filter(
        (row) =>
          row &&
          row.type === 'manual' &&
          (!Array.isArray(row.effect) ||
            !row.effect.length ||
            row.effect.every(
              (effect) =>
                !effect ||
                (!String(effect.code || '').trim() && (!effect.type || /^(?:v2Header|triggerlua)$/i.test(effect.type)))
            ))
      )
      .map((row) => ({ name: String(row.comment || row.name || ''), id: row.id == null ? '' : String(row.id) }))
      .filter((row) => row.name);
    const card = sources.card || {};
    const backgroundResolved = card.backgroundHTML
      ? await risuDisplaySource(card.backgroundHTML, char, { background: true })
      : { text: '' };
    const backgroundVisible = risuSplitFrameStyles(backgroundResolved.text)
      .body.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!doctype[^>]*>/gi, '')
      .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
      .trim();
    const message = session.msgs[0];
    let probeInput = message ? String(message.content || '') : '';
    if ((probeKind === 'vi' || probeKind === 'asset') && context.assets[0])
      probeInput = '<img="' + context.assets[0].name + '">';
    else if (probeKind === 'adelheid')
      probeInput = '<HISTORY>' + Array(24).fill('ARCHIV // 기록 검증 — Scroll verification').join('\n') + '</HISTORY>';
    else if (probeKind === 'sign')
      probeInput = char.alternate_greetings[3] + '\n<charimg="' + context.assets[0].name + '">';
    const renderProbe = (text) =>
      risuWithExecution(char, session, { readOnly: true, displayVars: true }, (execution) =>
        risuProcessScriptContext(execution, text, 'editdisplay', {
          message,
          chatIndex: Math.max(0, execution.messages.length - 1),
          role: 'assistant',
        })
      );
    let actualDisplay = await renderProbe(probeInput);
    if (probeKind === 'asset' && !context.assets.some((entry) => actualDisplay.includes(entry.url)))
      outer: for (const entry of context.assets)
        for (const name of [entry.name, String(entry.name).replace(/\.[^.]+$/, '')]) {
          const candidates = [
            '<img="' + name + '">',
            ...sources.regex
              .filter((row) => row.type === 'editdisplay')
              .map((row) =>
                String(row.in)
                  .replace(/\(\.[*+]\??\)/g, '\0')
                  .replace(/[()^$]/g, '')
                  .replace(/\\([^a-z])/gi, '$1')
                  .replace(/\0/g, () => name)
              ),
          ];
          for (const candidate of candidates) {
            const rendered = await renderProbe(candidate);
            if (/<img\b/i.test(rendered) && rendered.includes(entry.url)) {
              probeInput = candidate;
              actualDisplay = rendered;
              break outer;
            }
          }
        }
    return {
      risu: isRisuCharacter(char),
      assets: context.assets.length,
      emotions: context.emotions.length,
      actual: actual.length,
      first: first && { name: first.name, url: first.url, type: first.type },
      macro,
      background: !!card.backgroundHTML,
      backgroundVisible: !!backgroundVisible,
      fields: {
        viewScreen: card.viewScreen || 'none',
        inlayViewScreen: card.inlayViewScreen === true,
        hideChatIcon: card.hideChatIcon === true,
        largePortrait: card.largePortrait === true,
        prebuiltAssetCommand: !!card.prebuiltAssetCommand,
        prebuiltAssetStyle: card.prebuiltAssetStyle || '',
        prebuiltAssetExclude: Array.isArray(card.prebuiltAssetExclude) ? card.prebuiltAssetExclude.length : 0,
      },
      safeManual,
      probeInput,
      actualDisplay,
      directImage: /<img\b/i.test(actualDisplay),
      directAssetUrl: context.assets.some((entry) => actualDisplay.includes(entry.url)),
      regexCount: sources.regex.length,
      editDisplayRegexes: sources.regex.filter((row) => row.type === 'editdisplay').length,
    };
  }, probeKind);
  assert(inventory.risu, 'card was not classified as Risu');
  assert.equal(inventory.assets + inventory.emotions, inventory.actual, 'real card assets did not all resolve');
  if (probeKind === 'asset')
    assert(
      inventory.directImage && inventory.directAssetUrl,
      'no original editdisplay asset candidate rendered an image'
    );
  if (inventory.first) {
    if (inventory.first.type === 'emotion')
      assert(inventory.macro.includes(inventory.first.url), 'real emotion macro did not render its stored image');
    else assert.equal(inventory.macro, inventory.first.url, 'real asset raw macro changed its URL');
  }
  let emotionEvidence = null;
  if (inventory.emotions && inventory.fields.viewScreen === 'emotion' && !inventory.fields.inlayViewScreen) {
    emotionEvidence = await page.evaluate(async () => {
      const char = getChar(),
        session = getActiveSession(char.id),
        context = await risuDisplayAssetContext(char),
        entry = context.emotionEntries[0];
      await risuApplyEmotionEffects(char, session, { type: 'emotion', name: entry.name, asset: entry.url });
      const img = document.querySelector('#risu-emotion-stage img');
      if (img && !img.complete)
        await new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      return {
        name: entry.name,
        src: img && img.src,
        loaded: !!(img && img.naturalWidth > 0),
        visible: !!(img && img.getBoundingClientRect().height > 0),
      };
    });
    assert(emotionEvidence.loaded && emotionEvidence.visible, 'real emotion card did not display a stored image');
  }
  if (inventory.backgroundVisible) {
    await page.waitForFunction(() => {
      const frame = document.querySelector('.risu-background-frame'),
        chat = document.querySelector('#chat-messages');
      return frame && Math.abs(frame.getBoundingClientRect().height - chat.getBoundingClientRect().height) < 1;
    });
    const background = await page.evaluate(() => {
      const frame = document.querySelector('.risu-background-frame');
      return {
        sandbox: frame.getAttribute('sandbox'),
        script: frame.contentDocument && !!frame.contentDocument.querySelector('script'),
        srcdoc: frame.srcdoc.length,
      };
    });
    assert.equal(background.sandbox, 'allow-same-origin');
    assert(!background.script && background.srcdoc > 100, 'real background was not inert');
  }
  const actualChatCard = /^(?:바이 &|허접|Adelheid Hitler|RisuAI-Sign here hero)/.test(path.basename(file));
  if (probeKind === 'sign') {
    await page.locator('#chat-tools-toggle').click();
    await page.locator('#risu-options-btn').click();
    const portraitToggle = page.locator('[data-risu-toggle="signhereshowucharimg"]');
    const group = portraitToggle.locator('xpath=ancestor::details[1]');
    if ((await group.count()) && (await group.getAttribute('open')) === null) await group.locator('summary').click();
    await portraitToggle.check({ timeout: 10000 });
    await page.waitForFunction(
      () => getActiveSession(getChar().id).risu?.globalVariables?.toggle_signhereshowucharimg === '1'
    );
    await page.locator('#risu-options-modal .modal-close').click();
  }
  let generatedIndex = -1;
  let streamTone = null;
  if (actualChatCard) {
    modelReply = (probeKind === 'asset' ? '“流式对白” *流式动作* ' : '') + inventory.probeInput;
    await page.evaluate(() => {
      ensureProviderSettings(D.settings);
      Object.assign(activeProviderForSettings(D.settings), {
        apiUrl: location.origin + '/risu-display-model/v1',
        apiKey: 'synthetic-local',
        model: 'risu-display-probe',
        reasoningEffort: 'off',
        promptPostProcessing: 'none',
      });
      Object.assign(D.settings, {
        useMemory: false,
        embeddingEnabled: false,
        styleAuditEnabled: false,
        maxContextTokens: 0,
      });
    });
    if (probeKind === 'asset')
      await page.evaluate(() => {
        window.__risuStreamTone = null;
        window.__risuOriginalReconcileStreamHtml = reconcileStreamHtml;
        reconcileStreamHtml = function () {
          const result = window.__risuOriginalReconcileStreamHtml.apply(this, arguments);
          const target = arguments[0],
            row = target && target.closest && target.closest('#stream-msg'),
            tone = row && row.querySelector('.tone-quote');
          if (tone)
            window.__risuStreamTone = {
              color: getComputedStyle(tone).color,
              bodyColor: getComputedStyle(row.querySelector('.msg-bubble')).color,
              isolated: !!row.querySelector('.risu-display-host,iframe.risu-display-frame'),
            };
          return result;
        };
      });
    const messageCount = await page.evaluate(() => getActiveSession(getChar().id).msgs.length);
    await page.locator('#user-input').fill('继续演出');
    await page.locator('#composer-action-btn').click();
    try {
      await page.waitForFunction(
        (before) => {
          const rows = getActiveSession(getChar().id).msgs;
          return _generationState === 'idle' && rows.length > before && rows[rows.length - 1].role === 'assistant';
        },
        messageCount,
        { timeout: 60000 }
      );
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        state: _generationState,
        roles: getActiveSession(getChar().id).msgs.map((row) => row.role),
        disabled: document.getElementById('composer-action-btn').disabled,
        toastCount: document.querySelectorAll('#toasts>*').length,
      }));
      throw new Error('real chat send did not finish: ' + JSON.stringify(diagnostic), { cause: error });
    }
    if (probeKind === 'asset') {
      streamTone = await page.evaluate(() => {
        const result = window.__risuStreamTone;
        reconcileStreamHtml = window.__risuOriginalReconcileStreamHtml;
        delete window.__risuOriginalReconcileStreamHtml;
        delete window.__risuStreamTone;
        return result;
      });
      assert(
        streamTone && streamTone.color !== streamTone.bodyColor && !streamTone.isolated,
        'real card streaming text did not keep host semantic color before image commit: ' + JSON.stringify(streamTone)
      );
    }
    generatedIndex = await page.evaluate(() => getActiveSession(getChar().id).msgs.length - 1);
  }
  const htmlScript = generatedIndex >= 0 ? { out: inventory.actualDisplay } : null;
  let htmlEvidence = null;
  let semanticEvidence = null;
  if (htmlScript) {
    await page.waitForFunction(
      ({ index, kind }) => {
        const frame = document.querySelector('.msg[data-msg-idx="' + index + '"] iframe.risu-display-frame'),
          doc = frame && frame.contentDocument;
        if (!doc || doc.readyState !== 'complete') return false;
        if (kind === 'adelheid') return !!doc.querySelector('.hist-wrap input[type="checkbox"]');
        if (kind === 'vi' || kind === 'asset') return !!doc.querySelector('img,.asset-table,.asset-table-wide');
        return frame.getBoundingClientRect().height > 80 && doc.body.textContent.trim().length > 10;
      },
      { index: generatedIndex, kind: probeKind }
    );
    await page.waitForFunction(async (index) => {
      const selector = '.msg[data-msg-idx="' + index + '"] iframe.risu-display-frame',
        frame = document.querySelector(selector);
      if (!frame || frame.getBoundingClientRect().height < 1) return false;
      await new Promise((resolve) => setTimeout(resolve, 600));
      return (
        frame.isConnected && frame === document.querySelector(selector) && frame.getBoundingClientRect().height > 0
      );
    }, generatedIndex);
    htmlEvidence = await page.evaluate(async (index) => {
      const row = document.querySelector('.msg[data-msg-idx="' + index + '"]'),
        frame = row.querySelector('iframe.risu-display-frame'),
        doc = frame.contentDocument,
        details = doc.querySelector('details'),
        before = frame.getBoundingClientRect().height;
      let expanded = false,
        collapsed = false,
        checked = false,
        unchecked = false,
        panelChanged = false,
        panelRestored = false,
        expandedHeight = before,
        collapsedHeight = before;
      if (details) {
        details.querySelector('summary').click();
        await new Promise((resolve) => setTimeout(resolve, 180));
        const openHeight = frame.getBoundingClientRect().height;
        expanded = details.open && openHeight >= before;
        details.querySelector('summary').click();
        await new Promise((resolve) => setTimeout(resolve, 180));
        collapsed = !details.open && frame.getBoundingClientRect().height <= openHeight;
      }
      const flattenRules = (rules) =>
        [...rules].flatMap((rule) => (rule.selectorText ? [rule] : rule.cssRules ? flattenRules(rule.cssRules) : []));
      const checkedRules = [...doc.querySelectorAll('style')]
        .flatMap((node) => flattenRules(node.sheet.cssRules))
        .filter((rule) => rule.selectorText.includes(':checked'));
      const checkboxes = details ? [] : [...doc.querySelectorAll('input[type="checkbox"]')];
      const controlEvidence = [];
      async function settleControls() {
        doc.body.getBoundingClientRect();
        const animations = doc
          .getAnimations()
          .filter((animation) => Number.isFinite(animation.effect.getComputedTiming().endTime));
        await Promise.race([
          Promise.allSettled(animations.map((animation) => animation.finished)),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const checkbox of checkboxes) {
        const targets = [];
        for (const rule of checkedRules) {
          const selector = rule.selectorText.replace(/:not\(\s*:checked\s*\)/g, '').replace(/:checked/g, '');
          for (const node of doc.querySelectorAll(selector)) targets.push({ node, properties: [...rule.style] });
        }
        const visualState = () =>
          targets.map((target) =>
            target.properties
              .map((name) => doc.defaultView.getComputedStyle(target.node).getPropertyValue(name))
              .join('|')
          );
        await settleControls();
        const initialVisual = visualState(),
          initialChecked = checkbox.checked,
          initialHeight = frame.getBoundingClientRect().height;
        checkbox.click();
        await settleControls();
        const toggledVisual = visualState(),
          toggledChecked = checkbox.checked,
          toggledHeight = frame.getBoundingClientRect().height;
        checkbox.click();
        await settleControls();
        const restoredVisual = visualState(),
          restoredChecked = checkbox.checked,
          restoredHeight = frame.getBoundingClientRect().height;
        controlEvidence.push({
          targets: targets.length,
          changed: initialVisual.some((value, index) => value !== toggledVisual[index]),
          restored:
            initialVisual.every((value, index) => value === restoredVisual[index]) &&
            restoredChecked === initialChecked,
        });
        checked = checked || initialChecked || toggledChecked || restoredChecked;
        unchecked = unchecked || !initialChecked || !toggledChecked || !restoredChecked;
        expandedHeight = Math.max(expandedHeight, initialHeight, toggledHeight, restoredHeight);
        collapsedHeight = Math.min(collapsedHeight, initialHeight, toggledHeight, restoredHeight);
      }
      panelChanged = controlEvidence.length > 0 && controlEvidence.every((row) => row.changed);
      panelRestored = controlEvidence.length > 0 && controlEvidence.every((row) => row.restored);
      const chat = document.querySelector('#chat-messages');
      chat.scrollTop = chat.scrollHeight;
      const scrollContainers = [...doc.querySelectorAll('*')].filter(
        (node) =>
          node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight + 1 &&
          /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)
      );
      if (scrollContainers[0]) scrollContainers[0].scrollTop = scrollContainers[0].scrollHeight;
      const images = [...doc.querySelectorAll('img')];
      const assetUrls = new Set((await risuDisplayAssetContext(getChar())).assets.map((entry) => entry.url));
      const backgroundImages = [];
      for (const node of doc.querySelectorAll('[style]')) {
        const value = doc.defaultView.getComputedStyle(node).backgroundImage;
        const url = (value.match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
        if (!url || !assetUrls.has(url)) continue;
        const img = new Image();
        const loaded = await new Promise((resolve) => {
          img.onload = () => resolve(img.naturalWidth > 0);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        const rect = node.getBoundingClientRect();
        backgroundImages.push({
          loaded,
          visible: rect.width > 0 && rect.height > 0,
          portrait: node.classList.contains('charimg-container'),
        });
      }
      return {
        styles: doc.querySelectorAll('style').length,
        details: !!details,
        expanded,
        collapsed,
        checkbox: checkboxes.length > 0,
        checked,
        unchecked,
        panelChanged,
        panelRestored,
        controlEvidence,
        checkboxCount: checkboxes.length,
        expandedHeight,
        collapsedHeight,
        buttons: doc.querySelectorAll('button,[risu-trigger],[risu-btn]').length,
        images: images.length,
        imagesLoaded: images.every((img) => img.complete && img.naturalWidth > 0),
        backgroundImages,
        script: !!doc.querySelector('script'),
        height: frame.getBoundingClientRect().height,
        innerScrollable: scrollContainers.length,
        innerAtBottom: scrollContainers[0]
          ? scrollContainers[0].scrollTop + scrollContainers[0].clientHeight >= scrollContainers[0].scrollHeight - 2
          : true,
        scrollable:
          chat.scrollHeight > chat.clientHeight ? chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 2 : true,
        actualChat: true,
      };
    }, generatedIndex);
    assert(
      !htmlEvidence.script && htmlEvidence.height > 0,
      'real chat card output was lost or executable: ' + JSON.stringify(htmlEvidence)
    );
    if (htmlEvidence.details)
      assert(htmlEvidence.expanded && htmlEvidence.collapsed, 'real card details cannot expand and collapse');
    if (htmlEvidence.checkbox)
      assert(
        htmlEvidence.panelChanged && htmlEvidence.panelRestored,
        'original checkbox must change the actual panel and restore its layout: ' + JSON.stringify(htmlEvidence)
      );
    if (probeKind === 'adelheid')
      assert(
        htmlEvidence.checkbox &&
          htmlEvidence.checked &&
          htmlEvidence.unchecked &&
          htmlEvidence.expandedHeight >= htmlEvidence.collapsedHeight,
        'real Adelheid card checkbox cannot expand and collapse: ' + JSON.stringify(htmlEvidence)
      );
    if (probeKind === 'vi' || probeKind === 'asset')
      assert(
        htmlEvidence.images > 0 && htmlEvidence.imagesLoaded,
        'real asset card did not display a loaded stored image'
      );
    if (probeKind === 'asset') {
      semanticEvidence = await page.evaluate(async (index) => {
        const frame = document.querySelector('.msg[data-msg-idx="' + index + '"] iframe.risu-display-frame'),
          doc = frame.contentDocument,
          quote = doc.querySelector('.tone-quote'),
          narration = doc.querySelector('em');
        const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const read = () => ({
          scheme: doc.querySelector('meta[name="color-scheme"]').content,
          quote: getComputedStyle(quote).color,
          narration: getComputedStyle(narration).color,
          body: getComputedStyle(doc.body).color,
        });
        applyTheme('dark');
        risuRefreshFrameAppearance();
        await waitFrames();
        const dark = read();
        applyTheme('light');
        risuRefreshFrameAppearance();
        await waitFrames();
        const light = read();
        return { dark, light };
      }, generatedIndex);
      assert(
        semanticEvidence.dark.scheme === 'dark' &&
          semanticEvidence.light.scheme === 'light' &&
          semanticEvidence.dark.quote !== semanticEvidence.dark.body &&
          semanticEvidence.light.quote !== semanticEvidence.light.body &&
          semanticEvidence.dark.quote !== semanticEvidence.light.quote &&
          semanticEvidence.dark.narration !== semanticEvidence.dark.body &&
          semanticEvidence.light.narration !== semanticEvidence.light.body,
        'real card committed frame did not follow semantic colors across themes: ' + JSON.stringify(semanticEvidence)
      );
    }
    if (probeKind === 'sign')
      assert(
        htmlEvidence.backgroundImages.some((row) => row.portrait) &&
          htmlEvidence.backgroundImages.every((row) => row.loaded && row.visible),
        'original Sign background portrait must load and remain visible: ' + JSON.stringify(htmlEvidence)
      );
    assert(htmlEvidence.scrollable, 'real card output blocked outer chat scrolling');
  }
  let actualManual = null;
  if (inventory.safeManual.length) {
    await page.locator('#chat-tools-toggle').click();
    await page.locator('#risu-options-btn').click();
    const manualButton = page.locator('[data-risu-manual]').filter({ hasText: inventory.safeManual[0].name }).first();
    await manualButton.click();
    await page.waitForFunction(
      () => _generationState === 'idle' && document.querySelector('[data-risu-manual]:disabled') === null
    );
    actualManual = await page.evaluate(
      (manual) => ({
        name: manual.name,
        id: manual.id,
        generation: _generationState,
        throughOptions: document.getElementById('risu-options-modal').classList.contains('open'),
      }),
      inventory.safeManual[0]
    );
    assert.equal(actualManual.generation, 'idle', 'empty original manual trigger did not return to idle');
    await page.locator('#risu-options-modal .modal-close').click();
  }
  let reloadEvidence = null;
  if (probeKind === 'asset' && generatedIndex >= 0) {
    await page.reload();
    await page.waitForFunction(
      (index) => {
        const frame = document.querySelector('.msg[data-msg-idx="' + index + '"] iframe.risu-display-frame'),
          doc = frame && frame.contentDocument,
          image = doc && doc.querySelector('img');
        return !!(
          frame &&
          frame.closest('.risu-display-host[data-risu-ready]') &&
          doc.querySelector('.tone-quote') &&
          image &&
          image.complete &&
          image.naturalWidth > 0
        );
      },
      generatedIndex
    );
    reloadEvidence = await page.evaluate((index) => {
      const frame = document.querySelector('.msg[data-msg-idx="' + index + '"] iframe.risu-display-frame'),
        doc = frame.contentDocument,
        quote = doc.querySelector('.tone-quote');
      return {
        ready: frame.closest('.risu-display-host').hasAttribute('data-risu-ready'),
        imageLoaded: doc.querySelector('img').naturalWidth > 0,
        quoteSemantic: getComputedStyle(quote).color !== getComputedStyle(doc.body).color,
      };
    }, generatedIndex);
    assert(
      reloadEvidence.ready && reloadEvidence.imageLoaded && reloadEvidence.quoteSemantic,
      'real card semantic image frame did not survive reload: ' + JSON.stringify(reloadEvidence)
    );
  }
  const screenshotNames = {
    '바이 & 케이틀린 with 징크스 (Vi & Caitlyn with Jinx) v1.charx': 'vi-expanded.png',
    'Adelheid Hitler.charx': 'adelheid-expanded.png',
    'RisuAI-Sign here hero.png': 'sign-ui.png',
    '허접허접 동위체♡.png': 'weak-ui.png',
    'RisuAI-Iirena Koran.png': 'iirena-ui.png',
  };
  let screenshot = '';
  if (screenshotNames[path.basename(file)] && generatedIndex >= 0) {
    const row = page.locator('.msg[data-msg-idx="' + generatedIndex + '"]'),
      frame = row.locator('iframe.risu-display-frame');
    await frame.evaluate((node, kind) => {
      const doc = node.contentDocument,
        details = doc.querySelector('details'),
        checkbox = doc.querySelector('input[type="checkbox"]');
      if (details) details.open = true;
      else if (checkbox && kind === 'adelheid') checkbox.checked = true;
    }, probeKind);
    await page.waitForTimeout(300);
    screenshot = path.join(screenshotDir, screenshotNames[path.basename(file)]);
    await row.evaluate((node) => {
      const chat = document.getElementById('chat-messages');
      chat.scrollTop += node.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    });
    if (probeKind === 'sign')
      await frame.evaluate(async (node) => {
        const toggle = node.contentDocument.getElementById('character-toggle');
        if (!node.contentDocument.querySelector('.charimg-container') && toggle && !toggle.checked) toggle.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const target =
          node.contentDocument.querySelector('.charimg-container') ||
          [...node.contentDocument.querySelectorAll('[style]')].find((el) =>
            node.contentWindow.getComputedStyle(el).backgroundImage.includes('blob:')
          );
        if (target) {
          const chat = document.getElementById('chat-messages');
          chat.scrollTop +=
            node.getBoundingClientRect().top + target.getBoundingClientRect().top - chat.getBoundingClientRect().top;
        }
      });
    await page.waitForTimeout(200);
    await page.screenshot({ path: screenshot });
  } else if (screenshotNames[path.basename(file)]) {
    screenshot = path.join(screenshotDir, screenshotNames[path.basename(file)]);
    await page.screenshot({ path: screenshot });
  }
  const toggleEvidence = probeKind === 'adelheid' ? await probeOriginalToggle(page, requests) : null;
  assert.deepStrictEqual(errors, []);
  return {
    file: path.basename(file),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    assets: inventory.assets,
    emotions: inventory.emotions,
    background: inventory.background,
    fields: inventory.fields,
    emotionEvidence,
    actualChatSend: generatedIndex >= 0,
    htmlEvidence,
    streamTone,
    semanticEvidence,
    reloadEvidence,
    actualManual,
    toggleEvidence,
    screenshot,
    displayHash: crypto.createHash('sha256').update(inventory.actualDisplay).digest('hex'),
    editDisplayRegexes: inventory.editDisplayRegexes,
    originalReadOnly: true,
    provider: 'local synthetic SSE',
    viewport: '450x974',
    remoteResources: 'blocked',
  };
}
(async () => {
  server = createAssetServer(path.join(root, 'app/src/main/assets'));
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  for (const file of files) {
    const context = await browser.newContext({ viewport: { width: 450, height: 974 } }),
      page = await context.newPage();
    page.setDefaultTimeout(180000);
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    );
    try {
      console.log(JSON.stringify(await probeCard(page, file)));
    } finally {
      await context.close();
    }
  }
})()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });
