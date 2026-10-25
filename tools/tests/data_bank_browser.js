'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const {createAssetServer, listenOnBrowserSafePort, loadPlaywright, resolveEdgeExecutable} = require('./source');
const fixture = require('../fixtures/data_bank_fixture');
const {archive} = require('../fixtures/charx_fixture');
const oracle = require('../fixtures/data_bank_oracle.json');
const {waitForAppReady} = require('./helpers/app-ready');
for (const [file, expected] of Object.entries(oracle.assets)) {
  const actual = require('crypto').createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../..', file))).digest('hex');
  assert.strictEqual(actual, expected, file + ' pinned asset');
}
for (const [file, expected] of Object.entries(oracle.licenses)) {
  const text = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(text.includes('Apache License'), file + ' license text');
  assert.strictEqual(require('crypto').createHash('sha256').update(text).digest('hex'), expected, file + ' complete license');
}
const assets = path.resolve(__dirname, '../../app/src/main/assets');
const epubBoundaries = archive({
  'META-INF/container.xml': '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  'book.opf': '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
  'a.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章</h1><p>alpha<span>inline</span><em>word</em></p><p>beta<br/>gamma</p></body></html>',
  'b.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>第二章<strong>末尾</strong></p><div>delta</div><p><![CDATA[甲 < 乙 & 丙]]></p><p>正文<![CDATA[与行内]]><span>文字</span><br/><![CDATA[下一行]]>末尾</p></body></html>',
});
let browser, server;
(async () => {
  const loads = [];
  server = createAssetServer(assets, {cacheable: true, onRequest: request => loads.push(request.url)});
  await listenOnBrowserSafePort(server);
  browser = await loadPlaywright().chromium.launch({ executablePath: resolveEdgeExecutable(), headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url); await waitForAppReady(page);
  assert.ok(!loads.some(url => /pdf-4|pdf-worker|readability-0/.test(url)), 'extractors load only on use');
  const result = await page.evaluate(async ({ pdf, epub, epubBoundaries, article }) => {
    const check = (value, label) => { if (!value) throw new Error(label); };
    const rejects = async (action, label) => { let failed = false; try { await action(); } catch (error) { failed = true; } check(failed, label); };
    const script = async text => (await executeStscript(text, { handleParserErrors: false, handleExecutionErrors: false })).pipe;
    D = defaults(); D.settings.useMemory = false; D.settings.maxContextTokens = 0;
    Object.assign(D.settings, { embeddingEnabled: true, embeddingApiUrl: 'https://fixture.invalid/v1', embeddingApiKey: 'fixture-only', embeddingModel: 'fixture' });
    let char = parseCard({ name: '资料库角色', description: '角色说明' }); char.id = 'bank-char';
    let session = createBlankSession('资料库对话', 'bank-session'); session.msgs = [{ role: 'user', content: 'apple query', seq: 1 }];
    D.characters = [char]; D.currentCharId = char.id; D.chats = { [char.id]: { sessions: [session], activeSid: session.id } };
    const originalFetch = window.fetch, requests = []; let networkMode = 'ok';
    window.fetch = async function (input, options) {
      if (!String(input).startsWith('https://fixture.invalid/')) return originalFetch.apply(this, arguments);
      const body = JSON.parse(options.body); requests.push(body);
      if (networkMode === 'fail') return new Response('fixture failure', { status: 500 });
      return new Response(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: text.includes('apple') ? [1, 0] : [0, 1] })) }), { headers: { 'content-type': 'application/json' } });
    };
    let context = dataBankCurrent();
    const compactHTML = '<p>alpha<span>inline</span><em>word</em></p><p>beta</p><div>gamma<br>delta</div><ul><li>one</li><li>two</li></ul>';
    check(await dataBankExtractFile(new File([compactHTML], 'boundaries.html')) === 'alphainlineword\nbeta\ngamma\ndelta\none\ntwo', 'HTML blocks and BR separate text while inline stays joined');
    check(await dataBankExtractFile(new File([new Uint8Array(epubBoundaries)], 'boundaries.epub')) === '第一章\nalphainlineword\nbeta\ngamma\n第二章末尾\ndelta\n甲 < 乙 & 丙\n正文与行内文字\n下一行末尾', 'EPUB preserves CDATA, text nodes, inline joins, BR and spine boundaries');
    check(dataBankSettings().queryMessages===6 && await script('/vector-query')==='6','shared query default');
    await script('/vector-query 4'); check(dataBankSettings().queryMessages===4,'command updates manager query');
    await dataBankSaveSettings({queryMessages:8});
    check(await script('/vector-query')==='8' && !('queryMessages' in D.settings.dataBank),'manager updates single source');
    const macroText='{{char}} said {{getvar::bankTest}}'; session.macroVars={bankTest:'macro-value'};
    check(dataBankQuery(char,session,[{content:macroText}])==='资料库角色 said macro-value','query uses real character and session macros');
    check(presetTaskScriptModule().substituteParams(macroText)==='资料库角色 said macro-value','preset module uses same real macros');
    await dataBankSaveSettings({queryMessages:6});

    check(await script('/vector-files-state') === 'false', 'files default disabled');
    for (const prefix of ['db', 'databank', 'data-bank']) for (const action of ['', '-add', '-delete', '-disable', '-enable', '-get', '-ingest', '-list', '-purge', '-search', '-update'])
      check(typeof STSCRIPT_COMMANDS[prefix + action].callback === 'function', prefix + action);
    const global = await script('/db-add source=global name=GLOBAL apple global');
    const chat = await script('/databank-add name=CHAT apple chat');
    const character = await script('/data-bank-add source=character name=CHAR banana character');
    check(JSON.stringify(JSON.parse(await script('/db-list'))) === JSON.stringify([global, chat, character]), 'source order');
    check(await script('/data-bank-get source=global global') === 'apple global', 'case-insensitive get');
    await script('/db-disable CHAT'); check((await script('/db-list')).includes(chat), 'disabled files still listed');
    check(await script('/databank-get CHAT') === 'apple chat', 'disabled text still readable');
    check(await script('/db-ingest') === '', 'explicit ingest works with files disabled');
    check(requests.flatMap(row => row.input).includes('apple global') && !requests.flatMap(row => row.input).includes('apple chat'), 'ingest excludes disabled');
    await script('/data-bank-enable CHAT');
    const hits = JSON.parse(await script('/databank-search threshold=0.9 count=1 apple query'));
    check(hits.length === 1 && hits[0] === global, 'global top-k');
    check(await script('/db-search source=chat threshold=1 return=chunks apple') === 'apple chat\n\n', 'chunk return');
    check(await script('/data-bank-search source=character threshold=1 return=pipe banana') === character, 'pipe URLs');
    const requestCount = requests.length; await script('/db-search source=character threshold=1 return=pipe banana');
    check(requests.length === requestCount, 'vectors and query cached');
    check(await script('/vector-files-state true') === 'true', 'files toggle');
    const beforePurge = requests.length; await script('/databank-purge'); await script('/db-ingest');
    check(requests.length > beforePurge && await script('/db-get GLOBAL') === 'apple global', 'purge derived data only');
    const saved = (await YeyuRepository.load()).data;
    const owners = [saved.settings, saved.chats[char.id].sessions[0], saved.characters[0]];
    check(owners.every(owner => owner.dataBankAttachments.length === 1 && owner.dataBankAttachments[0].mediaKey && !('text' in owner.dataBankAttachments[0]) && !('data_url' in owner.dataBankAttachments[0])), 'three owners persist references only');
    D = saved; char = D.characters[0]; session = D.chats[char.id].sessions[0]; context = dataBankCurrent();
    check(await script('/db-get CHAR') === 'banana character', 'lazy text after reload');
    const transaction = IDBDatabase.prototype.transaction, mediaWrites=[];
    IDBDatabase.prototype.transaction=function(stores, mode) {
      if(mode==='readwrite' && Array.from(typeof stores==='string'?[stores]:stores).includes('media')) mediaWrites.push(stores);
      return transaction.apply(this,arguments);
    };
    try {
      session.msgs.push({role:'user',content:'save without media',seq:2});
      await saveData('sessions',{urgent:true});
      D.settings.dataBankRevisionTest=1; await saveData('meta',{urgent:true});
      check(mediaWrites.length===0,'ordinary message and meta save avoid media write/cleanup');
      for(const [owner,section] of [[D.settings,'meta'],[session,'sessions'],[char,'characters']]) {
        const attachment=owner.dataBankAttachments[0], text=await dataBankText(attachment);
        attachment.text=text+' updated-inline'; await saveData(section,{urgent:true});
        check(!('text' in attachment) && (await YeyuRepository.loadMediaBlob(attachment.mediaKey)) instanceof Blob,'inline owner detaches '+section);
        attachment.text=text; await saveData(section,{urgent:true});
      }
      check(mediaWrites.length>0,'attachment writes use media');
      session.msgs.pop(); await saveData('sessions',{urgent:true});
    } finally {IDBDatabase.prototype.transaction=transaction;}

    char.dataBankAttachments[0].futureField = { preserve: 7 };
    await saveData('characters', { urgent: true });
    const updated = await script('/db-update source=character name=CHAR apple updated');
    check(updated !== character && await script('/db-get CHAR') === 'apple updated' && char.dataBankAttachments[0].futureField.preserve === 7, 'update replaces URL preserves name unknown fields');
    const sharedDelete = await dataBankAdd(context, 'character', 'shared delete', 'apple shared delete');
    const sharedUpdate = await dataBankAdd(context, 'character', 'shared update', 'apple shared update');
    const ingested = await dataBankIngest(context, 'character');
    const cached = async url => YeyuRepository.loadVectorCache(ingested.filter(row => row.url === url).map(row => row.key));
    const deleteRef = char.dataBankAttachments.find(row => row.url === sharedDelete);
    const updateRef = char.dataBankAttachments.find(row => row.url === sharedUpdate);
    await duplicateCharacter(char.id);
    const copied = D.characters.find(row => row.id !== char.id), copiedContext = dataBankContext(copied, null);
    check(copied.dataBankAttachments.some(row => row.url === sharedDelete) && copied.dataBankAttachments.some(row => row.url === sharedUpdate), 'real character duplication shares attachment URLs');
    await dataBankDelete(copiedContext, 'character', sharedDelete);
    const replacement = await dataBankUpdate(copiedContext, 'character', [sharedUpdate], 'banana replaced copy');
    const beforeSharedIngest = requests.length;
    await dataBankIngest(context, 'character');
    check(requests.length === beforeSharedIngest && (await cached(sharedDelete)).length && (await cached(sharedUpdate)).length, 'delete and update of copied attachments keep original vectors without embedding again');
    check(await dataBankText(deleteRef) === 'apple shared delete' && await dataBankText(updateRef) === 'apple shared update', 'surviving original attachment text stays readable');
    D.settings.dataBankAttachments.push({...deleteRef});
    session.dataBankAttachments.push({...deleteRef, disabled: true});
    await saveData(['meta', 'sessions'], {urgent: true});
    await dataBankDelete(context, 'character', sharedDelete);
    await dataBankDelete(context, 'global', sharedDelete);
    check((await cached(sharedDelete)).length && (await YeyuRepository.loadMediaBlob(deleteRef.mediaKey)) instanceof Blob, 'disabled chat reference retains shared vector and media across owners');
    await dataBankDelete(context, 'chat', sharedDelete);
    await dataBankDelete(context, 'character', sharedUpdate);
    check((await cached(sharedDelete)).length === 0 && (await cached(sharedUpdate)).length === 0, 'last original references reclaim vectors');
    check(await YeyuRepository.loadMediaBlob(deleteRef.mediaKey) === null && await YeyuRepository.loadMediaBlob(updateRef.mediaKey) === null, 'last original references reclaim attachment media');
    const copiedVectors = await dataBankIngest(copiedContext, 'character');
    const replacementKeys = copiedVectors.filter(row => row.url === replacement).map(row => row.key);
    check(replacementKeys.length && (await YeyuRepository.loadVectorCache(replacementKeys)).length, 'replacement gets its own vectors');
    await dataBankDelete(copiedContext, 'character', replacement);
    check((await YeyuRepository.loadVectorCache(replacementKeys)).length === 0, 'last replacement reference reclaims vectors');
    D.characters = D.characters.filter(row => row !== copied); delete D.chats[copied.id];
    await saveData(['characters', 'sessions'], {urgent: true});
    const save = saveData; saveData = async () => { throw new Error('fixture write failure'); };
    const snapshot = JSON.stringify(D);
    try {
      await rejects(() => dataBankAdd(context, 'global', 'ROLLBACK', 'must not persist'), 'failed add rejects');
      await rejects(() => dataBankUpdate(context, 'character', [updated], 'must not persist'), 'failed update rejects');
      await rejects(() => dataBankSetDisabled(context, 'chat', chat, true), 'failed toggle rejects');
      await rejects(() => dataBankDelete(context, 'chat', chat), 'failed delete rejects');
      await rejects(() => dataBankSaveSettings({ chunkSize: 1, queryMessages:4 }, false), 'failed settings reject');
      check(JSON.stringify(D) === snapshot, 'all writes rollback on failure');
    } finally { saveData = save; }
    const attachmentOwners = [D.settings, D.characters[0], D.chats[char.id].sessions[0]];
    for (const owner of attachmentOwners) {
      const attachment = owner.dataBankAttachments[0];
      const blob = await YeyuRepository.loadMediaBlob(attachment.mediaKey);
      check(blob instanceof Blob && await blob.text() === await dataBankText(attachment), 'media store preserves attachment text in every scope');
      check(!attachment.data_url && typeof attachment.text !== 'string', 'saved attachments retain references without inline payloads');
    }
    // Multiple owners can retain the same blob reference; deletion keeps surviving references.
    const ref = D.settings.dataBankAttachments[0];
    char.dataBankAttachments.push({ ...ref, id: 'shared-copy', url: 'yeyu-attachment:shared-copy', name: 'shared copy' });
    await saveData('characters', { urgent: true });
    await dataBankDelete(context, 'character', 'shared copy');
    check((await YeyuRepository.loadMediaBlob(ref.mediaKey)) instanceof Blob, 'shared media retained');
    await dataBankDelete(context, 'global', global);
    check(await YeyuRepository.loadMediaBlob(ref.mediaKey) === null, 'unreferenced media cleaned');
    for (const wholeSession of [false, true]) {
      const lastSession = wholeSession ? createBlankSession('Disposable', 'disposable') : session;
      if (wholeSession) D.chats[char.id].sessions.push(lastSession);
      const lastContext = dataBankContext(char, lastSession);
      const url = await dataBankAdd(lastContext, 'chat', 'last chat reference', 'unique chat blob ' + wholeSession);
      const attachment = lastSession.dataBankAttachments.find(row => row.url === url);
      char.dataBankAttachments.push({...attachment, name:'temporary owner'});
      await saveData('characters', {urgent:true});
      await dataBankDelete(context, 'character', 'temporary owner');
      check((await YeyuRepository.loadMediaBlob(attachment.mediaKey)) instanceof Blob, 'last chat reference retained');
      if (wholeSession) {
        D.chats[char.id].sessions = D.chats[char.id].sessions.filter(row => row !== lastSession);
        await saveData('sessions', {urgent:true});
      } else await dataBankDelete(lastContext, 'chat', url);
      check(await YeyuRepository.loadMediaBlob(attachment.mediaKey) === null, 'last chat reference removed including whole session');
    }
    // Actual prompt manager injection, role/depth, disabled/missing/failing retrieval clears old text.
    await dataBankSaveSettings({ chunkCount: 2, position: 'in_chat', depth: 0, role: 'system', template: 'BANK {{text}}' }, true);
    await dataBankPrepareForPrompt(char, session, session.msgs);
    const macroMessages = [{role:'user', content:'apple {{random::one::two}}'}];
    const substitute = cardFrontendSubstitudeMacros; let expansions = 0;
    cardFrontendSubstitudeMacros = function(c, s, text) {
      if (text.includes('{{random::')) expansions++;
      return substitute(c, s, text);
    };
    try {
      await dataBankPrepareForPrompt(char, session, macroMessages);
      check(dataBankPromptSnapshot(char, session, macroMessages).length === 1, 'random macro retains retrieval injection');
      check(dataBankPromptSnapshot(char, session, macroMessages).length === 1 && expansions === 1, 'query macro expands once across snapshots');
      check(dataBankPromptSnapshot(char, session, [{content:'changed'}]).length === 0, 'changed raw query invalidates snapshot');
    } finally {cardFrontendSubstitudeMacros = substitute;}
    await dataBankPrepareForPrompt(char, session, session.msgs);
    let built = buildMessages(char, session.msgs, session, { commit: false });
    check(built.messages.some(message => message.content.includes('BANK apple')), 'retrieved chunks enter final request messages');
    check(!buildMessages(char, session.msgs, session, { commit: false, skipDataBank: true }).messages.some(message => message.content.includes('BANK apple')), 'quiet generation skips data bank');
    const request = requestGenerationWithRetry; let outgoing;
    requestGenerationWithRetry = async messages => { outgoing = messages; return { content: 'transported' }; };
    const target = { charId: char.id, sessionId: session.id, mode: 'new' };
    generationTarget = target; abortController = new AbortController(); setGenerationState('preparing');
    try { await doAPICall({ target, controller: abortController }); }
    finally { requestGenerationWithRetry = request; finishGeneration(target); }
    check(outgoing.some(message => message.content.includes('BANK apple')), 'normal coordinator prepares retrieval before request');
    const quiet = await cardFrontendPresetGenerationMessages(char, session, null, cardFrontendGenerationConfig({ user_input: 'apple' }, false), new AbortController(), false);
    check(!quiet.some(message => String(message.content).includes('BANK apple')), 'helper quiet path excludes prior data bank prompt');
    await dataBankSaveSettings({}, false);
    check(!buildMessages(char, session.msgs, session, { commit: false }).messages.some(message => message.content.includes('BANK apple')), 'disable invalidates previous prompt');
    await dataBankSaveSettings({}, true); await dataBankPurge(context); networkMode = 'fail';
    await dataBankPrepareForPrompt(char, session, session.msgs);
    check(dataBankPromptSnapshot(char, session, session.msgs).length === 0, 'failure clears prior injection');
    networkMode = 'ok';
    // Extract genuine locally parsed formats, with lazy library loading.
    check(await dataBankExtractFile(new File(['a\r\nb\t c'], 'raw.txt', { type: 'text/plain' })) === 'a\r\nb\t c', 'plain text unchanged');
    check(await dataBankExtractFile(new File(['# Heading\n\n**bold**'], 'note.md')) === '# Heading\n\n**bold**', 'markdown markup preserved');
    check(await dataBankExtractFile(new File(['<p>HTML text</p><script>bad()</script>'], 'note.html')) === 'HTML text', 'HTML sanitization fallback');
    const readable = await dataBankExtractFile(new File([article], 'article.html'));
    check(readable.includes('第 0 段') && !readable.includes('导航条'), 'Readability article extraction');
    check(readable.split('\n').filter(line => /^第 \d 段/.test(line)).length === 8, 'Readability article keeps paragraph boundaries');
    check(await dataBankExtractFile(new File([new Uint8Array(pdf)], 'sample.pdf')) === 'PDF attachment text', 'PDF.js real text extraction');
    check(await dataBankExtractFile(new File([new Uint8Array(epub)], 'sample.epub')) === '第一章\n文本 B\n第二章\n文本 A', 'EPUB spine order text');
    window.fetch = originalFetch;
    return { aliases: 34, owners: 3, cache: true, rollback: true, promptInjection: true, formats: ['plain', 'markdown', 'html', 'pdf', 'epub'] };
  }, { pdf: [...fixture.pdf], epub: [...fixture.epub], epubBoundaries: [...epubBoundaries], article: fixture.article });
  // Reload uses persisted media references and preserves attachment bytes.
  await page.reload(); await waitForAppReady(page);
  await page.evaluate(async () => {
    const texts = await Promise.all(dataBankRows(dataBankCurrent(), '', true).map(row => dataBankText(row.file)));
    if (JSON.stringify(texts) !== '["apple chat","apple updated"]') throw new Error('persisted attachment text bytes changed after reload');
  });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(loads.filter(url => url === '/js/vendor/pdf-4.7.76.js').length, 1);
  assert.strictEqual(loads.filter(url => url === '/js/vendor/readability-0.6.0.js').length, 1);
  console.log(JSON.stringify({ ...result, mediaReload: true, lazyLibraries: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
