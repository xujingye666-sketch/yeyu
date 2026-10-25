'use strict';
// Run against the pinned local reference. Only synthetic fixtures are created and removed.
const fs = require('fs');
const path = require('path');
const {loadPlaywright, resolveEdgeExecutable} = require('../tests/source');
(async () => {
  const browser = await loadPlaywright().chromium.launch({executablePath: resolveEdgeExecutable(), headless: true});
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:8000/', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => typeof window.TavernHelper?.createCharacter === 'function');
    // The helper exports are installed before ST finishes loading its character list.
    await page.waitForFunction(() => !document.querySelector('#loader') || document.querySelector('#loader').getBoundingClientRect().height === 0);
    const result = await page.evaluate(async () => {
      const h = TavernHelper, ctx = SillyTavern.getContext();
      const nonce = crypto.randomUUID(), name = 'Yeyu API probe ' + nonce, personaName = 'Yeyu persona probe ' + nonce;
      const oldAvatar = h.getCurrentCharacterId();
      let madeCharacter = false, madePersona = false;
      const evidence = {}, checks = [];
      const check = (value, label) => { if (!value) throw new Error('Reference check failed: ' + label); checks.push(label); };
      try {
        madeCharacter = await h.createCharacter(name, {description: 'Synthetic reference fixture', first_messages: ['**fixture**']});
        check(madeCharacter === true, 'character-create-boolean');
        check(await h.createCharacter(name.toLowerCase()) === false, 'character-duplicate-case-insensitive');
        const c = await h.getCharacter(name);
        check((await h.getCharacter(c.avatar)).avatar === c.avatar, 'character-avatar-id-lookup');
        evidence.characterKeys = Object.keys(c).sort();
        check(c.first_messages.length === 1 && c.avatar === name + '.png', 'character-shape');
        check(await h.replaceCharacter(c.avatar, {version: 'probe'}, {render: 'none'}) === undefined, 'character-replace-by-avatar-void');
        check((await h.getCharacter(name)).description === c.description, 'character-partial-preserves-fields');
        check(await h.createOrReplaceCharacter(name, {creator: 'probe'}, {render: 'none'}) === false, 'character-upsert-replace-false');
        const changed = await h.updateCharacterWith(name, row => ({...row, creator_notes: 'Synthetic fixture'}));
        check(changed.creator_notes === 'Synthetic fixture', 'character-updater-value');
        await ctx.selectCharacterById(h.RawCharacter.findIndex(name));
        await new Promise(resolve => setTimeout(resolve, 1200));
        check(h.getCurrentCharacterId() === name + '.png', 'character-current-identity');
        check(h.getCharData(name, false).avatar === h.getCharData(name, true).avatar, 'raw-avatar-flag-ignored');
        check(h.getCharData('missing-' + nonce) === null, 'raw-missing-null');
        await h.replaceCharacter(name, {first_messages: ['**new fixture**']}, {render: 'immediate'});
        check(SillyTavern.getContext().chat[0]?.mes === '**new fixture**', 'current-first-message-repaint');
        const formatted = h.formatAsDisplayedMessage('**display fixture**', {message_id: -1});
        check(typeof formatted === 'string' && /<strong>/.test(formatted), 'display-format-sync-html');
        const displayed = h.retrieveDisplayedMessage(0);
        check(!!displayed.jquery && displayed.length === 1, 'display-retrieve-jquery');
        check(await h.refreshOneMessage(0) === undefined, 'display-refresh-void');
        check(h.retrieveDisplayedMessage(999999).length === 0, 'display-missing-empty');
        let missingDisplay = false;
        try { h.formatAsDisplayedMessage('fixture', {message_id: 999999}); } catch (_) { missingDisplay = true; }
        check(missingDisplay, 'display-invalid-range-error');
        const slot = 'yeyu-probe-' + nonce;
        const injected = h.injectPrompts([{id: slot, position: 'in_chat', depth: 2, role: 'assistant', content: 'Synthetic injection', should_scan: true}]);
        const stored = SillyTavern.getContext().extensionPrompts[slot];
        evidence.injectionKeys = Object.keys(stored).sort();
        check(typeof injected.uninject === 'function', 'injection-returns-cleanup');
        check(stored.position === 1 && stored.depth === 2 && stored.role === 2 && stored.scan === true, 'injection-role-depth-scan');
        h.injectPrompts([{id: slot, position: 'none', content: 'Replacement'}]);
        check(SillyTavern.getContext().extensionPrompts[slot].position === -1, 'injection-overwrite-none');
        injected.uninject(); injected.uninject();
        check(!SillyTavern.getContext().extensionPrompts[slot], 'injection-idempotent-cleanup');
        h.injectPrompts([{id: slot, content: 'Once'}], {once: true});
        await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STOPPED);
        check(!SillyTavern.getContext().extensionPrompts[slot], 'injection-once-stopped');
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
        canvas.getContext('2d').fillRect(0, 0, 2, 2);
        const avatar = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const personaId = 'yeyu-probe-' + nonce + '.png';
        madePersona = await h.createPersona(personaName, {avatar_id: personaId, avatar, description: 'Synthetic persona'}, {render: 'none'});
        check(madePersona === true, 'persona-create-boolean');
        const persona = h.getPersona(personaName);
        evidence.personaKeys = Object.keys(persona).sort();
        evidence.personaDefaults = {position: persona.position, depth: persona.depth, role: persona.role, is_default: persona.is_default};
        check(persona.avatar_id === personaId && persona.avatar === personaId, 'persona-native-avatar-id');
        check(await h.createPersona(personaName.toLowerCase(), {}, {render: 'none'}) === false, 'persona-duplicate-case-insensitive');
        check(await h.replacePersona(personaId, {title: 'probe'}, {render: 'none'}) === undefined, 'persona-replace-void');
        check(h.getPersona(personaId).description === persona.description, 'persona-partial-preserves-fields');
        check(await h.createOrReplacePersona(personaName, {title: 'updated'}, {render: 'none'}) === false, 'persona-upsert-replace-false');
        check((await h.updatePersonaWith(personaId, row => ({...row, description: 'Updated'}), {render: 'none'})).description === 'Updated', 'persona-updater-value');
        check(h.getPersonaAvatarPath('missing-' + nonce) === null, 'persona-missing-avatar-null');
        check(await h.deletePersona(personaId) === true, 'persona-delete-true'); madePersona = false;
        check(await h.deletePersona(personaId) === false, 'persona-missing-delete-false');
        check(await h.deleteCharacter(name) === true, 'character-delete-true'); madeCharacter = false;
        check(await h.deleteCharacter(name) === false, 'character-missing-delete-false');
      } finally {
        h.uninjectPrompts(['yeyu-probe-' + nonce]);
        if (madePersona) await h.deletePersona(personaName);
        if (madeCharacter) await h.deleteCharacter(name);
        if (oldAvatar && h.RawCharacter.findIndex(oldAvatar) !== -1) await ctx.selectCharacterById(h.RawCharacter.findIndex(oldAvatar));
      }
      return {checkedAt: new Date().toISOString(), checks, evidence, cleanup: 'synthetic characters, chats, persona and injections removed'};
    });
    const output = path.resolve(__dirname, '../../.tmp/helper-batch/reference-result.json');
    fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
