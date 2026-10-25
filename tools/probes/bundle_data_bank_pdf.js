'use strict';
// Reproduce the fixed ST PDF.js classic-script builds without an additional bundler.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const reference = process.argv[2];
if (!reference) throw new Error('Pass the fixed SillyTavern checkout');
const output = path.resolve(__dirname, '../../app/src/main/assets/js/vendor');
for (const [input, name] of [['pdf.min.mjs', 'pdf-4.7.76.js'], ['pdf.worker.min.mjs', 'pdf-worker-4.7.76.js']]) {
  const source = fs.readFileSync(path.join(reference, 'public/lib', input), 'utf8');
  if (!source.includes('4.7.76')) throw new Error('Unexpected PDF.js version');
  const stripped = source.replace(/export\{[^{}]*\};?\s*$/, '');
  if (stripped === source) throw new Error('Expected one trailing ES export');
  const result = '(function () {\n' + stripped.replace(/\r\n/g, '\n') + '\n})();';
  fs.writeFileSync(path.join(output, name), result + '\n');
  console.log(JSON.stringify({ input, output: name, sha256: crypto.createHash('sha256').update(result + '\n').digest('hex') }));
}
const readability = path.join(reference, 'node_modules/@mozilla/readability');
if (JSON.parse(fs.readFileSync(path.join(readability, 'package.json'), 'utf8')).version !== '0.6.0') throw new Error('Unexpected Readability version');
const readable = ['Readability.js', 'Readability-readerable.js'].map(file => fs.readFileSync(path.join(readability, file), 'utf8')).join('\n');
fs.writeFileSync(path.join(output, 'readability-0.6.0.js'), readable);
fs.copyFileSync(path.join(readability, 'LICENSE.md'), path.join(output, 'readability-0.6.0.LICENSE'));
console.log(JSON.stringify({ output: 'readability-0.6.0.js', sha256: crypto.createHash('sha256').update(readable).digest('hex') }));
