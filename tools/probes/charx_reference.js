'use strict';
const assert = require('assert');
const path = require('path');
const {pathToFileURL} = require('url');
const {archive,files} = require('../fixtures/charx_fixture');
require('../../app/src/main/assets/js/core/charx');
(async()=>{
  const reference = process.argv[2];
  if (!reference) throw new Error('Usage: node tools/probes/charx_reference.js <SillyTavern directory>');
  const {CharXParser}=await import(pathToFileURL(path.join(reference,'src/charx.js')).href);
  const results=[];
  assert.strictEqual(new Set(Object.entries(files).filter(([name, bytes]) => /\.png$/i.test(name) && Buffer.isBuffer(bytes)).map(([, bytes]) => bytes.toString('base64'))).size, 5);
  for(const options of [{},{store:true},{prefix:'JPEG prefix'},{zip64:true},{zip64:true,prefix:'JPEG prefix'},{zip64:true,fakeSignature:true}]) {
    const input=archive(files,options), parser=new CharXParser(input), official=await parser.parse();
    const local=await YeyuCharx.parse(input);
    assert.deepStrictEqual(local.card,official.card);
    assert.deepStrictEqual(Buffer.from(await local.readAsset(local.icon)),official.avatar);
    assert.strictEqual(local.icon.path,parser.pickCharXIconAsset(parser.collectCharXAssets(local.card)).zipPath);
    // ST stores image assets only; Yeyu also preserves audio/video for Risu playback.
    const selected=local.assets.filter(asset => !/\.(?:mp3|wav|ogg|mp4|webm|m4v|m4p|avi)$/i.test(asset.path));
    assert.deepStrictEqual(selected.map(a=>a.path),official.auxiliaryAssets.map(a=>a.zipPath));
    for(const asset of selected) {
      const actual=await local.readAsset(asset),expected=official.extractedBuffers.get(asset.path);
      assert.strictEqual(Boolean(actual),Boolean(expected));
      if(actual)assert.deepStrictEqual(Buffer.from(actual),expected);
    }
    const sound = local.assets.find(asset => asset.path === 'assets/sound.wav');
    assert.deepStrictEqual(Buffer.from(await local.readAsset(sound)), Buffer.from(files['assets/sound.wav']));
    results.push({options,cardEqual:true,avatarEqual:true,imagePathsAndBytesEqual:true,extraAudioPreserved:true});
  }
  console.log(JSON.stringify(results));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
