'use strict';
const zlib = require('zlib');
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function archive(files, options = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const [filename, data] of Object.entries(files)) {
    const name = options.nameBytes?.[filename] || Buffer.from(filename), content = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const method = options.store ? 0 : 8, packed = method ? zlib.deflateRawSync(content) : content;
    const local = Buffer.alloc(30), entry = Buffer.alloc(46), crc = crc32(content);
    const flags = options.flags ?? 0x800, size = options.sizes?.[filename] ?? content.length;
    const extra = options.zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (extra.length) {
      extra.writeUInt16LE(1); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(size), 4); extra.writeBigUInt64LE(BigInt(packed.length), 12); extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(45, 4); entry.writeUInt16LE(45, 6);
    entry.writeUInt16LE(flags, 8); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(options.badCrc ? (crc ^ 1) >>> 0 : crc, 16);
    entry.writeUInt32LE(options.zip64 ? 0xffffffff : packed.length, 20); entry.writeUInt32LE(options.zip64 ? 0xffffffff : size, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(extra.length, 30); entry.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 42);
    locals.push(local, name, packed); central.push(entry, name, extra); offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(files).length;
  const tail = [];
  if (options.zip64) {
    const extension = options.fakeSignature ? Buffer.alloc(64) : Buffer.alloc(0);
    if (extension.length) { extension.writeUInt32LE(0x06064b50); extension.writeUInt32LE(0xffffffff,8); }
    const record = Buffer.alloc(56), locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(BigInt(44 + extension.length), 4);
    record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24); record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40); record.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset + directory.length), 8); locator.writeUInt32LE(1, 16);
    tail.push(record, extension, locator);
  }
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(options.zip64 ? 65535 : count, 8); end.writeUInt16LE(options.zip64 ? 65535 : count, 10);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : directory.length, 12); end.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([Buffer.from(options.prefix || ''), ...locals, directory, ...tail, end]);
}
function png(color) {
  function chunk(type, bytes) {
    const data = Buffer.concat([Buffer.from(type), bytes]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(data));
    return Buffer.concat([length, data, crc]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0,...color,255]))), chunk('IEND', Buffer.alloc(0))]);
}
const image = png([255,0,0]), background = png([0,0,255]);
const card = {spec:'chara_card_v3', spec_version:'3.0', extra:{preserved:7}, data:{name:'容器测试', description:'说明', first_mes:'<img src="embedded://assets/背景.png">', extensions:{risuai:{customScripts:[{type:'lua',code:'must never run'}]}, custom:{preserved:true}}, assets:[
  {type:'icon',name:'secondary',uri:'embedded://assets/second.png',ext:'png'},
  {type:'ICON',name:'MAIN',uri:'embeded://assets/main.png',ext:'.PNG'},
  {type:'background',name:'背景',uri:'embedded://assets/背景.png',ext:'png'},
  {type:'emotion',name:'Happy.png',uri:'__asset:assets/happy.png',ext:'png'},
  {type:'other',name:'missing',uri:'embedded://assets/missing.png',ext:'png'},
  {type:'user_icon',name:'user',uri:'embedded://assets/user.png',ext:'png'},
  {type:'sound',name:'sound',uri:'embedded://assets/sound.wav',ext:'wav'},
]}};
function risum(module, assets = []) {
  const map = require('../../app/src/main/assets/js/vendor/rpack-map.js');
  const encode = bytes => Buffer.from([...bytes].map(byte => map[byte]));
  const json = encode(Buffer.from(JSON.stringify({type:'risuModule',module})));
  const header = Buffer.alloc(6); header[0]=111; header.writeUInt32LE(json.length,2);
  return Buffer.concat([header,json,...assets.flatMap(bytes=>{const h=Buffer.alloc(5);h[0]=1;h.writeUInt32LE(bytes.length,1);return [h,encode(bytes)];}),Buffer.from([0])]);
}
const moduleData = {name:'测试模块', regex:[], trigger:[], unknown:{keep:true}};
const files = {'card.json':JSON.stringify(card), 'assets/main.png':image, 'assets/second.png':png([0,255,0]), 'assets/背景.png':background, 'assets/happy.png':png([255,255,0]), 'assets/user.png':png([255,0,255]), 'assets/sound.wav':'untouched', 'module.risum':risum(moduleData)};
module.exports = {archive, card, files, image, background, risum, moduleData};
