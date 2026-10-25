'use strict';
const assert = require('assert');
const path = require('path');
const {loadAppModulesContext} = require('../tests/source');
const referenceRoot = process.argv[2];
if (!referenceRoot) throw new Error('Pass the fixed SillyTavern checkout directory.');
const Fuse = require(path.join(path.resolve(referenceRoot), 'node_modules/fuse.js/dist/fuse.cjs'));
const root = path.resolve(__dirname, '../..');
const ctx = loadAppModulesContext(root, ['48-stscript-parser.js','66-stscript-commands.js','66-stscript-tools.js'], {});
let state = 9172;
function random(n) { state = (Math.imul(state,1664525)+1013904223)>>>0; return state%n; }
function word(n) { return Array.from({length:n},()=> 'abcXYZ123汉字 '[random(12)]).join(''); }
let cases=0;
for (let i=0;i<2000;i++) {
  const text=word(1+random(85)), start=random(text.length);
  let pattern=i%3===0?word(1+random(70)):text.slice(start,start+1+random(65));
  if(i%4===0)pattern=pattern.slice(0,1)+'Q'+pattern.slice(2);
  const options={threshold:random(11)/10,ignoreLocation:!!random(2),location:random(20),distance:[10,100][random(2)],includeScore:true};
  const expected=new Fuse([text],options).search(pattern)[0];
  const actual=ctx.stscriptFuzzyMatch(pattern,text,options.threshold,options);
  assert.strictEqual(actual.match,!!expected,JSON.stringify({pattern,text,options,actual,expected}));
  if(expected) assert.ok(Math.abs(actual.score-expected.score)<1e-10,JSON.stringify({pattern,text,options,actual,expected}));
  cases++;
}
console.log(JSON.stringify({fuseVersion:Fuse.version,cases,matched:true}));
