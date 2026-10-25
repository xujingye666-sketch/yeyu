'use strict';
const fs = require('fs');
const path = require('path');
const reference = process.argv[2];
if (!reference) throw new Error('Pass the fixed ST-Prompt-Template libs directory.');
function wrapModule(name) {
  const source = fs.readFileSync(path.join(reference, name), 'utf8').replace(/\r\n/g, '\n').replace(/\/\/# sourceMappingURL=.*$/gm, '');
  const match = source.match(/export\s*\{([^}]+)\};?/);
  if (!match) throw new Error('Expected fixed bundled module exports: ' + name);
  const exports = match[1].split(',').map(value => {
    const pair = value.trim().split(/\s+as\s+/);
    return JSON.stringify(pair[1] || pair[0]) + ':' + pair[0];
  }).join(',');
  return source.replace(match[0], '').replace('import { Buffer as __Buffer$ } from "./buffer.mjs";', '') + '\nreturn {' + exports + '};\n';
}
const bundle = '(function(root) {\nvar __Buffer$=(function(){\n' + wrapModule('buffer.mjs') + '})().Buffer;\nroot.YeyuFaker=(function(){\n' + wrapModule('faker.mjs') + '})();\n})(globalThis);\n';
fs.writeFileSync(path.resolve(__dirname, '../../app/src/main/assets/js/vendor/faker-9.7.0.js'), bundle);
console.log('Bundled fixed faker and Buffer exports as a local classic script.');
