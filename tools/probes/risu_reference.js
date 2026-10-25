'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('../../app/src/main/assets/js/core/charx');
const RisuModule = require('../../app/src/main/assets/js/core/risu-module');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function mapStrings(value, visit, seen = new WeakSet()) {
  if (typeof value === 'string') return visit(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach(item => mapStrings(item, visit, seen));
  else Object.values(value).forEach(item => mapStrings(item, visit, seen));
}
function origins(value) {
  const values = new Set();
  mapStrings(value, text => {
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>)}]+/gi)) {
      try {
        values.add(new URL(match[0]).origin);
      } catch (_) {}
    }
  });
  return Array.from(values).sort();
}
function referenceDecode(bytes, officialMap) {
  const decode = officialMap.subarray(256);
  const decoded = Buffer.alloc(bytes.length);
  for (let index = 0; index < bytes.length; index++) decoded[index] = decode[bytes[index]];
  return decoded;
}
function referenceRead(bytes, officialMap) {
  let offset = 0;
  const byte = () => bytes[offset++];
  const u32 = () => {
    const value = bytes.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  assert.strictEqual(byte(), 111, '官方容器魔数');
  assert.strictEqual(byte(), 0, '官方容器版本');
  const mainLength = u32();
  const envelope = JSON.parse(referenceDecode(bytes.subarray(offset, offset + mainLength), officialMap));
  offset += mainLength;
  assert.strictEqual(envelope.type, 'risuModule');
  const assets = [];
  while (true) {
    const marker = byte();
    if (marker === 0) break;
    assert.strictEqual(marker, 1, '官方资产标记');
    const length = u32();
    assets.push(referenceDecode(bytes.subarray(offset, offset + length), officialMap));
    offset += length;
  }
  return { module: envelope.module, assets, consumedBytes: offset };
}
function embeddedPath(uri) {
  const match = String(uri || '').match(/^(?:embeded:\/\/|embedded:\/\/|__asset:)(.*)$/i);
  return match ? YeyuCharx.normalizePath(match[1]) : null;
}

(async () => {
  const [referenceRoot, ...cardPaths] = process.argv.slice(2);
  if (!referenceRoot || cardPaths.length !== 2)
    throw new Error('Usage: node tools/probes/risu_reference.js <RisuAI directory> <card1.charx> <card2.charx>');
  const officialMap = fs.readFileSync(path.join(referenceRoot, 'src/ts/rpack/rpack_map.bin'));
    const localMap = Buffer.from(require('../../app/src/main/assets/js/vendor/rpack-map.js'));
  assert.deepStrictEqual(localMap, officialMap, '随应用保存的映射必须与固定官方版本逐字节一致');
  const results = [];
  for (const cardPath of cardPaths) {
    const archive = await YeyuCharx.openArchive(fs.readFileSync(cardPath), 'Risu CHARX');
    const moduleEntry = archive.entries.find(entry => entry.name === 'module.risum');
    const cardEntry = archive.entries.find(entry => entry.name === 'card.json');
    assert(moduleEntry && cardEntry, '真实 CHARX 必须同时包含 card.json 和 module.risum');
    const moduleBytes = Buffer.from(await archive.read(moduleEntry));
    const card = JSON.parse(new TextDecoder().decode(await archive.read(cardEntry)));
    const decoded = await RisuModule.decodeRisum(moduleBytes);
    const official = referenceRead(moduleBytes, officialMap);
    assert.deepStrictEqual(decoded.module, official.module, '模块结构必须与固定官方算法一致');
    assert.strictEqual(decoded.decodedAssetCount, official.assets.length);
    decoded.assets.slice(0, decoded.decodedAssetCount).forEach((asset, index) =>
      assert.deepStrictEqual(Buffer.from(asset.bytes), official.assets[index]),
    );
    assert.strictEqual(decoded.consumedBytes, official.consumedBytes);

    const analysis = RisuModule.analyzeModule(decoded);
    const risu = (card.data && card.data.extensions && card.data.extensions.risuai) || {};
    const cardAssets = Array.isArray(card.data && card.data.assets) ? card.data.assets : [];
    const archiveEntries = new Map(archive.entries.map(entry => [entry.name, entry]));
    const cardAssetDigest = crypto.createHash('sha256');
    let cardAssetPayloadBytes = 0;
    let cardAssetPayloadsPresent = 0;
    for (const [index, asset] of cardAssets.entries()) {
      const assetPath = embeddedPath(asset.uri);
      const entry = assetPath && archiveEntries.get(assetPath);
      if (!entry) continue;
      const payload = Buffer.from(await archive.read(entry));
      cardAssetPayloadBytes += payload.length;
      cardAssetPayloadsPresent++;
      cardAssetDigest.update(String(index));
      cardAssetDigest.update('\0');
      cardAssetDigest.update(assetPath);
      cardAssetDigest.update('\0');
      cardAssetDigest.update(sha256(payload));
      cardAssetDigest.update('\0');
    }
    const effects = (decoded.module.trigger || []).flatMap(trigger => trigger.effect || []);
    const externalModuleDependency = Boolean(
      analysis.dependencies.mcpUrl ||
        analysis.dependencies.moduleReferences.length ||
        risu.modules ||
        decoded.module.namespace,
    );
    results.push({
      file: path.basename(cardPath),
      moduleContainer: {
        bytes: moduleBytes.length,
        sha256: sha256(moduleBytes),
        decodedJsonSha256: sha256(Buffer.from(JSON.stringify(decoded.module))),
        version: decoded.version,
        trailingBytes: decoded.trailingBytes,
      },
      identity: analysis.identity,
      counts: analysis.counts,
      lorebook: {
        modes: (decoded.module.lorebook || []).reduce((result, lore) => {
          const mode = String(lore.mode || '');
          result[mode] = (result[mode] || 0) + 1;
          return result;
        }, {}),
        alwaysActive: (decoded.module.lorebook || []).filter(lore => lore.alwaysActive).length,
        selective: (decoded.module.lorebook || []).filter(lore => lore.selective).length,
      },
      regex: analysis.regex,
      triggers: analysis.triggers,
      lua: {
        slots: analysis.lua.length,
        emptySlots: effects.filter(effect => effect.type === 'triggerlua' && !String(effect.code || '').trim()).length,
        characters: analysis.lua.reduce((total, slot) => total + slot.characters, 0),
      },
      assets: {
        moduleDeclared: analysis.counts.assets,
        moduleDecoded: analysis.counts.decodedAssets,
        cardDeclared: cardAssets.length,
        cardPayloadsPresent: cardAssetPayloadsPresent,
        cardPayloadBytes: cardAssetPayloadBytes,
        cardPayloadManifestSha256: cardAssetDigest.digest('hex'),
        cardByType: cardAssets.reduce((result, asset) => {
          const type = String(asset.type || '');
          result[type] = (result[type] || 0) + 1;
          return result;
        }, {}),
        rawMacros: analysis.assetReferences.raw.map(reference => ({
          ...reference,
          dynamic: reference.name.includes('$'),
          declaredNameMatches: cardAssets.filter(asset => asset.name === reference.name).length,
        })),
      },
      dependencies: {
        externalModuleOrPlugin: externalModuleDependency,
        mcpUrl: analysis.dependencies.mcpUrl,
        moduleReferences: analysis.dependencies.moduleReferences,
        httpsOrigins: Array.from(new Set([...analysis.dependencies.externalOrigins, ...origins(risu)])).sort(),
      },
      cardRisuFieldNames: Object.keys(risu).sort(),
    });
  }
  console.log(
    JSON.stringify(
      {
        reference: {
          tag: 'v2026.10.211',
          commit: '02a83695d81eb4e083453c4524b8c7d463df95aa',
          rpackMapSha256: sha256(officialMap),
          modulesSource: 'src/ts/process/modules.ts',
        },
        cards: results,
      },
      null,
      2,
    ),
  );
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
