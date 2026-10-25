'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {stripTypeScriptTypes}=require('module');
const reference=process.argv[2];
if(!reference)throw new Error('Pass the fixed SillyTavern directory.');
const plugin=path.join(reference,'data/default-user/extensions/ST-Prompt-Template');
const root=path.resolve(__dirname,'../..'),vendor=path.join(root,'app/src/main/assets/js/vendor');
const _=require(path.join(reference,'node_modules/lodash/lodash.js'));
const upstreamWarnings=[],nightWarnings=[];
const upstream=vm.createContext({_,extension_settings:{regex:[]},hashString:value=>String(value),jsonrepair:require(path.join(vendor,'jsonrepair-3.13.1.min.js')).jsonrepair,toastr:{error(){},warn(value){upstreamWarnings.push(value);},warning(value){upstreamWarnings.push(value);}}});
for(const name of ['regex','json-patch']){
 const source=fs.readFileSync(path.join(plugin,'src/function',name+'.ts'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/\bexport /g,'');
 vm.runInContext(stripTypeScriptTypes(source,{mode:'strip'}),upstream);
}
const night=vm.createContext({console,toast:(value,type)=>nightWarnings.push({value,type})});night.window=night;
require('../tests/helpers/app-functions').loadAppFunctions(night, ['isObjectRecord', 'objectRecord', 'cloneData', 'escapeRegexText']);
vm.runInContext(fs.readFileSync(path.join(vendor,'jsonrepair-3.13.1.min.js'),'utf8'),night);
vm.runInContext(fs.readFileSync(path.join(root,'app/src/main/assets/js/app/75-prompt-template.js'),'utf8'),night);
const json=value=>JSON.stringify(value);
for(const input of ["{a:'x',list:[1,2,],}",'```json\n{"ok":True}\n```','{"missing":','', '1\n2\n3']){
 const result=(context,fn)=>{try{return {value:json(context[fn](input))};}catch(error){return {error:error.message};}};
 assert.deepStrictEqual(result(night,'promptTemplateParseJSON'),result(upstream,'parseJSON'));
}
for(const patches of [
 [{op:'set',path:'/a/n',value:2},{op:'assign',path:'/a/new',value:3},{op:'add',path:'/list/-',value:'c'}],
 [{op:'remove',path:'/list/0'},{op:'copy',from:'/a',path:'/copy'},{op:'move',from:'/a/n',path:'/moved'}],
 [{op:'set',path:'/a/n',value:8},{op:'test',path:'/a/n',value:1}],
 [{op:'add',path:'/a~1b/~0',value:2},{op:'remove',path:'/missing'}],
 [{op:'replace',path:'',value:{root:true}},{op:'unknown',path:'/a',value:7}],
 [{op:'copy',from:'/missing',path:'/b'},{op:'add',path:'/a/-',value:1}],
]){
 const document={a:{n:1},list:['a','b']};
 assert.strictEqual(json(night.promptTemplateJsonPatch(document,patches)),json(upstream.jsonPatch(document,patches)));
 assert.strictEqual(document.a.n,1);
}
for(const context of [upstream,night]){
 const activate=context===upstream?context.activateRegex:context.promptTemplateActivateRegex;
 activate(vm.runInContext('/x/g',context),'a',{uuid:'a',generate:true,message:true,sticky:2,user:false,minDepth:1,maxDepth:9,html:true});
 activate('a',function(){return this.suffix;},{uuid:'b',generate:true,message:true,order:200});
}
const removeDocument={list:[1,2]},removePatch=[{op:'remove',path:'/list/length'}];
assert.strictEqual(json(night.promptTemplateJsonPatch(removeDocument,removePatch)),json(upstream.jsonPatch(removeDocument,removePatch)));
assert.match(upstreamWarnings.at(-1),/list\/length/);assert.match(nightWarnings.at(-1).value,/list\/length/);assert.strictEqual(nightWarnings.at(-1).type,'info');
for(const flags of [{role:'user'},{role:'assistant'},{role:'system',worldinfo:true},{worldinfo:true,html:true},{worldinfo:true,before:false,html:true,assistant:true},{assistant:true,before:true,depth:0},{assistant:true,html:true,depth:1},{assistant:true,html:true,depth:2}]){
 for(const kind of ['generate','message']){
  const expected=upstream.applyRegex({suffix:'Z'},'xxx a',Object.assign({[kind]:true},flags));
  assert.strictEqual(night.promptTemplateApplyRegex(null,{suffix:'Z'},'xxx a',kind,flags),expected);
 }
}
for(let count=0;count<2;count++){
 upstream.deactivateRegex({message:true,generate:true});night.promptTemplateDeactivateRegex({message:true,generate:true});
 assert.strictEqual(night.promptTemplateApplyRegex(null,{},'xxx','generate',{role:'assistant'}),upstream.applyRegex({},'xxx',{generate:true,role:'assistant'}));
}
for(const opts of [{uuid:'basic',minDepth:2,maxDepth:8},{uuid:'basic',worldinfo:false,user:false}]){
 upstream.activateRegex(vm.runInContext('/x/g',upstream),'B',opts);night.promptTemplateActivateRegex(vm.runInContext('/x/g',night),'B',opts);
 assert.strictEqual(json(vm.runInContext('Array.from(_promptTemplateRegexes.basic.values())',night)),json(upstream.extension_settings.regex));
}
console.log('Fixed Prompt Template parity passed: JSON repair/errors, patch operations, dynamic regex flags/order/sticky/basic quirks.');
(async()=>{
 const original=await import(require('url').pathToFileURL(path.join(plugin,'libs/faker.mjs')));
 const bundled=vm.createContext({Blob,atob,btoa});
 vm.runInContext(fs.readFileSync(path.join(vendor,'faker-9.7.0.js'),'utf8'),bundled);
 assert.deepStrictEqual(Object.keys(bundled.YeyuFaker).sort(),Object.keys(original).sort());
 for(const locale of ['fakerEN','fakerZH_CN','fakerJA']){
  original[locale].seed(42);bundled.YeyuFaker[locale].seed(42);
  assert.strictEqual(bundled.YeyuFaker[locale].person.fullName(),original[locale].person.fullName());
  assert.strictEqual(bundled.YeyuFaker[locale].internet.email(),original[locale].internet.email());
 }
 console.log('Fixed faker module exports and seeded EN/ZH_CN/JA results match the classic bundle.');
})().catch(error=>{console.error(error);process.exitCode=1;});
