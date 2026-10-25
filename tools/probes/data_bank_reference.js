'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { extractFunctionSource } = require('../tests/source');
const reference = process.argv[2], root = path.resolve(__dirname, '../..');
if (!reference) throw new Error('Pass the fixed SillyTavern checkout');
const utils = fs.readFileSync(path.join(reference, 'public/scripts/utils.js'), 'utf8');
const vectors = fs.readFileSync(path.join(reference, 'public/scripts/extensions/vectors/index.js'), 'utf8');
const attachments = fs.readFileSync(path.join(reference, 'public/scripts/extensions/attachments/index.js'), 'utf8');
const scopes = { global: [{ url: 'g', name: 'Global', text: 'Global text' }], chat: [{ url: 'c', name: 'Chat', text: 'Chat text' }], character: [{ url: 'r', name: 'Role', text: 'Role text' }] };
const st = vm.createContext({ Blob, File, console, TYPES: ['global', 'character', 'chat'], FIELDS: ['name', 'url'],
  toastr: { warning() {} }, extension_settings: { disabled_attachments: [] }, settings: { query: 6 },
  getDataBankAttachments: () => [].concat(scopes.global, scopes.chat, scopes.character),
  getDataBankAttachmentsForSource: source => scopes[source] || [],
  getFileAttachment: async url => Object.values(scopes).flat().find(row => row.url === url).text,
  substituteParams: text => text.replace(/\{\{char\}\}/g, 'Role'), getStringHash: text => text,
  collapseNewlines: text => text.replace(/\n{2,}/g, '\n'),
});
for (const name of ['splitRecursive', 'trimToStartSentence', 'trimToEndSentence', 'postProcessText']) vm.runInContext(extractFunctionSource(utils, name), st);
for (const name of ['overlapChunks', 'getQueryText']) vm.runInContext(extractFunctionSource(vectors, name), st);
for (const name of ['getAttachments', 'getAttachmentByField', 'getAttachmentByFields', 'listDataBankAttachments', 'getDataBankText', 'disableDataBankAttachment', 'enableDataBankAttachment']) vm.runInContext(extractFunctionSource(attachments, name), st);
const char = { id: 'r', name: 'Role', dataBankAttachments: scopes.character.map(row => ({ ...row })) }, session = { id: 'c', dataBankAttachments: scopes.chat.map(row => ({ ...row })) };
const night = vm.createContext({ Blob, console, D: { characters: [char], settings: { dataBankAttachments: scopes.global.map(row => ({ ...row })) }, chats: { r: { sessions: [session] } } },
  saveData: async () => {}, YeyuRepository: { deleteVectorCachePrefixes: async () => {} },
});
vm.runInContext(fs.readFileSync(path.join(root, 'app/src/main/assets/js/app/55-prompt-core.js'), 'utf8'), night);
require('../tests/helpers/app-functions').loadAppFunctions(night, ['cloneData']);
for (const [file, name] of [['21-layered-memory.js','memoryV5Number'],['73-card-frontend.js','cardFrontendSubstitudeMacros']])
  vm.runInContext(extractFunctionSource(fs.readFileSync(path.join(root, 'app/src/main/assets/js/app', file), 'utf8'), name), night);
for (const file of ['49-data-bank.js', '49-data-bank-import.js']) vm.runInContext(fs.readFileSync(path.join(root, 'app/src/main/assets/js/app', file), 'utf8'), night);
const json = value => JSON.stringify(value);
(async () => {
  let cases = 0;
  for (const text of ['a\n\nb c d efghijklmnop', '中文标点。和段落\n\n次段', 'One. Two!\n Three? Next.', 'a\t  b\r\n\n\n\n\n　c', '', '🤗abcd🙂efg']) {
    for (const length of [-1, 4, 8, 12]) {
      assert.strictEqual(json(night.dataBankSplit(text, length)), json(st.splitRecursive(text, length))); cases++;
      for (const overlap of [0, 20, 50]) {
        const size = Math.round(length * overlap / 100), chunks = st.splitRecursive(text, size > 0 ? length - size : length);
        const expected = chunks.map((chunk, index) => size > 0 ? st.overlapChunks(chunk, index, chunks, size) : chunk);
        assert.strictEqual(json(night.dataBankChunks(text, { size: 999 }, { sizeThreshold: 0, chunkSize: length, overlap })), json(expected)); cases++;
      }
    }
    for (const collapse of [true, false]) { assert.strictEqual(night.dataBankProcessText(text, collapse), st.postProcessText(text, collapse)); cases++; }
  }
  const context = night.dataBankContext(char, session);
  for (const source of ['', 'global', 'chat', 'character', 'invalid']) {
    for (const field of ['name', 'url', 'invalid']) {
      const rows = night.dataBankRows(context, ['global', 'chat', 'character'].includes(source) ? source : '', true);
      assert.strictEqual(json(rows.map(row => row.file[field === 'name' ? 'name' : 'url'])), st.listDataBankAttachments({ source, field })); cases++;
    }
  }
  for (const selector of ['g', ' global ', 'CHAT', 'missing']) {
    const row = night.dataBankFind(night.dataBankRows(context, '', true), selector);
    assert.strictEqual(row ? await night.dataBankText(row.file) : '', (await st.getDataBankText({}, selector)) || ''); cases++;
  }
  await st.disableDataBankAttachment({}, 'CHAT'); await night.dataBankSetDisabled(context, '', 'CHAT', true);
  assert.deepStrictEqual(night.dataBankRows(context, '', false).map(row => row.file.url).join(','), 'g,r');
  await st.enableDataBankAttachment({}, 'CHAT'); await night.dataBankSetDisabled(context, '', 'CHAT', false);
  const messages = [...Array.from({length:7},(_,i)=>({content:'old '+i})), { content: 'old' }, { content: '   ' }, { content: '{{char}} said\n\nhello' }, { content: 'latest' }];
  assert.strictEqual(night.dataBankQuery(char, session, messages), await st.getQueryText(messages.map(row => ({ mes: row.content })), 'file'));
  // Fixed source's length=1 recursion is deliberately not reproduced.
  assert.strictEqual(json(night.dataBankSplit('abc', 1)), '["a","b","c"]');
  console.log(JSON.stringify({ fixedSourceCases: cases, chunkAndOverlap: true, textNormalization: true, selectorsAndSources: true, disabled: true, queryOrder: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
