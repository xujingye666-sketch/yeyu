/* global module, require */
// Guarded CommonJS access loads the same RPack map in Node tests.
(function (root) {
  'use strict';

  var mapPromise = null,
    encodeMap = null,
    decodeMap = null;

  function RisuModuleError(code, message, offset) {
    this.name = 'RisuModuleError';
    this.code = code;
    this.offset = Number.isSafeInteger(offset) ? offset : null;
    this.message = message;
    if (Error.captureStackTrace) Error.captureStackTrace(this, RisuModuleError);
  }
  RisuModuleError.prototype = Object.create(Error.prototype);
  RisuModuleError.prototype.constructor = RisuModuleError;

  function bytesOf(input, label) {
    label = label || 'Risu module';
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new TypeError(label + ' 必须是 ArrayBuffer 或字节视图');
  }

  function validateMap(input) {
    var bytes = bytesOf(input, 'RPack 映射');
    if (bytes.length !== 512) throw new RisuModuleError('RPACK_MAP_LENGTH', 'RPack 映射必须正好是 512 字节');
    var enc = bytes.slice(0, 256),
      dec = bytes.slice(256),
      seenEncode = new Uint8Array(256),
      seenDecode = new Uint8Array(256);
    for (var i = 0; i < 256; i++) {
      if (seenEncode[enc[i]] || seenDecode[dec[i]] || dec[enc[i]] !== i || enc[dec[i]] !== i)
        throw new RisuModuleError('RPACK_MAP_INVALID', 'RPack 映射不是互逆的字节排列');
      seenEncode[enc[i]] = 1;
      seenDecode[dec[i]] = 1;
    }
    return { encode: enc, decode: dec };
  }

  async function readDefaultMap() {
    if (typeof require === 'function' && typeof module === 'object') return require('../vendor/rpack-map.js');
    if (!root.YeyuRisuRPackMap) throw new RisuModuleError('RPACK_MAP_LOAD', 'RPack 映射脚本未加载');
    return root.YeyuRisuRPackMap;
  }

  async function initRPack(source) {
    if (!source && encodeMap && decodeMap) return;
    if (source) {
      var supplied = validateMap(source);
      encodeMap = supplied.encode;
      decodeMap = supplied.decode;
      return;
    }
    if (!mapPromise)
      mapPromise = readDefaultMap()
        .then(function (bytes) {
          var maps = validateMap(bytes);
          encodeMap = maps.encode;
          decodeMap = maps.decode;
        })
        .catch(function (error) {
          mapPromise = null;
          throw error;
        });
    return mapPromise;
  }

  async function decodeRPack(input, map) {
    await initRPack(map);
    var bytes = bytesOf(input),
      result = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) result[i] = decodeMap[bytes[i]];
    return result;
  }

  async function encodeRPack(input, map) {
    await initRPack(map);
    var bytes = bytesOf(input),
      result = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) result[i] = encodeMap[bytes[i]];
    return result;
  }

  function Reader(input) {
    this.bytes = bytesOf(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
  }
  Reader.prototype.require = function (length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length)
      throw new RisuModuleError('TRUNCATED', 'Risu module 容器数据不完整', this.offset);
  };
  Reader.prototype.byte = function () {
    this.require(1);
    return this.bytes[this.offset++];
  };
  Reader.prototype.u32 = function () {
    this.require(4);
    var value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  };
  Reader.prototype.data = function (length) {
    this.require(length);
    var value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  };

  function decodeText(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      throw new RisuModuleError('MAIN_UTF8', 'Risu module 主数据不是有效 UTF-8');
    }
  }

  function assetMetadata(module, index) {
    var value = module.assets && module.assets[index];
    if (!Array.isArray(value)) return null;
    return {
      index: index,
      name: String(value[0] == null ? '' : value[0]),
      declaredRef: String(value[1] == null ? '' : value[1]),
      declaredType: String(value[2] == null ? '' : value[2]),
    };
  }

  async function decodeRisum(input, options) {
    options = options || {};
    await initRPack(options.map);
    var reader = new Reader(input);
    if (reader.byte() !== 111) throw new RisuModuleError('MAGIC', 'Risu module 魔数无效', 0);
    var version = reader.byte();
    if (version !== 0) throw new RisuModuleError('VERSION', '不支持的 Risu module 版本：' + version, 1);
    var mainLength = reader.u32(),
      mainBytes = await decodeRPack(reader.data(mainLength)),
      envelope;
    try {
      envelope = JSON.parse(decodeText(mainBytes));
    } catch (error) {
      if (error instanceof RisuModuleError) throw error;
      throw new RisuModuleError('MAIN_JSON', 'Risu module 主数据不是有效 JSON', 6);
    }
    if (!envelope || envelope.type !== 'risuModule' || !envelope.module || typeof envelope.module !== 'object')
      throw new RisuModuleError('MAIN_TYPE', 'Risu module 主数据类型无效', 6);
    var module = envelope.module,
      declaredAssetCount = Array.isArray(module.assets) ? module.assets.length : 0,
      assets = [];
    while (true) {
      var markerOffset = reader.offset,
        marker = reader.byte();
      if (marker === 0) break;
      if (marker !== 1) throw new RisuModuleError('ASSET_MARKER', 'Risu module 资产标记无效', markerOffset);
      var length = reader.u32(),
        index = assets.length,
        metadata = assetMetadata(module, index);
      if (!metadata)
        throw new RisuModuleError('ASSET_METADATA', 'Risu module 第 ' + index + ' 个资产缺少对应元数据', markerOffset);
      metadata.bytes = await decodeRPack(reader.data(length));
      assets.push(metadata);
    }
    for (var i = assets.length; i < declaredAssetCount; i++) {
      var missing = assetMetadata(module, i);
      if (!missing)
        throw new RisuModuleError('ASSET_METADATA', 'Risu module 第 ' + i + ' 个资产元数据无效', reader.offset);
      missing.bytes = null;
      assets.push(missing);
    }
    return {
      format: 'risum',
      version: version,
      module: module,
      assets: assets,
      decodedAssetCount: assets.filter(function (asset) {
        return asset.bytes !== null;
      }).length,
      consumedBytes: reader.offset,
      trailingBytes: reader.bytes.length - reader.offset,
    };
  }

  function walkStrings(value, visit, seen, path) {
    if (typeof value === 'string') {
      visit(value, path);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) walkStrings(value[i], visit, seen, path.concat(i));
    } else {
      Object.keys(value).forEach(function (key) {
        walkStrings(value[key], visit, seen, path.concat(key));
      });
    }
  }

  function stringLength(value) {
    return typeof value === 'string' ? value.length : 0;
  }

  function analyzeModule(decoded) {
    var module = decoded && decoded.module ? decoded.module : decoded,
      decodedAssets = decoded && Array.isArray(decoded.assets) ? decoded.assets : [],
      regex = Array.isArray(module && module.regex) ? module.regex : [],
      triggers = Array.isArray(module && module.trigger) ? module.trigger : [],
      lorebook = Array.isArray(module && module.lorebook) ? module.lorebook : [],
      declaredAssets = Array.isArray(module && module.assets) ? module.assets : [],
      assetHits = declaredAssets.map(function (asset, index) {
        return { index: index, name: String((asset && asset[0]) || ''), occurrences: 0 };
      }),
      rawReferences = Object.create(null),
      externalOrigins = Object.create(null),
      moduleReferences = Object.create(null),
      lua = [],
      triggerEffectCount = 0,
      triggerConditionCount = 0;
    walkStrings(
      module,
      function (text, path) {
        if (path[0] !== 'assets')
          assetHits.forEach(function (asset) {
            if (!asset.name) return;
            var at = 0;
            while ((at = text.indexOf(asset.name, at)) !== -1) {
              asset.occurrences++;
              at += asset.name.length;
            }
          });
        var match,
          rawPattern = /\{\{\s*(?:raw|asset)::\s*([^}|]+)[^}]*\}\}/gi,
          urlPattern = /https?:\/\/[^\s"'<>)}]+/gi,
          modulePattern = /\{\{\s*module::\s*([^}|]+)[^}]*\}\}/gi;
        while ((match = rawPattern.exec(text))) {
          var rawName = match[1].trim();
          rawReferences[rawName] = (rawReferences[rawName] || 0) + 1;
        }
        while ((match = urlPattern.exec(text))) {
          try {
            externalOrigins[new URL(match[0]).origin] = true;
          } catch (_) {}
        }
        while ((match = modulePattern.exec(text))) moduleReferences[match[1].trim()] = true;
        if (path.length === 1 && path[0] === 'cjs') lua.push({ source: 'cjs', characters: text.length });
      },
      new WeakSet(),
      []
    );
    var triggerSummary = triggers.map(function (trigger, triggerIndex) {
      var conditions = Array.isArray(trigger && trigger.conditions) ? trigger.conditions : [],
        effects = Array.isArray(trigger && trigger.effect) ? trigger.effect : [];
      triggerConditionCount += conditions.length;
      triggerEffectCount += effects.length;
      effects.forEach(function (effect, effectIndex) {
        if (effect && effect.type === 'triggerlua')
          lua.push({
            source: 'trigger',
            triggerIndex: triggerIndex,
            effectIndex: effectIndex,
            characters: stringLength(effect.code),
          });
      });
      return {
        index: triggerIndex,
        comment: String((trigger && trigger.comment) || ''),
        type: String((trigger && trigger.type) || ''),
        conditionCount: conditions.length,
        effectCount: effects.length,
        conditionTypes: Array.from(
          new Set(
            conditions.map(function (item) {
              return String((item && item.type) || '');
            })
          )
        ),
        effectTypes: Array.from(
          new Set(
            effects.map(function (item) {
              return String((item && item.type) || '');
            })
          )
        ),
      };
    });
    return {
      identity: {
        name: String((module && module.name) || ''),
        id: String((module && module.id) || ''),
        namespace: String((module && module.namespace) || ''),
        descriptionCharacters: stringLength(module && module.description),
        lowLevelAccess: !!(module && module.lowLevelAccess),
      },
      counts: {
        lorebook: lorebook.length,
        regex: regex.length,
        triggers: triggers.length,
        triggerConditions: triggerConditionCount,
        triggerEffects: triggerEffectCount,
        lua: lua.length,
        cjsCharacters: stringLength(module && module.cjs),
        assets: declaredAssets.length,
        decodedAssets: decodedAssets.filter(function (asset) {
          return asset.bytes !== null;
        }).length,
        customModuleToggleCharacters: stringLength(module && module.customModuleToggle),
        backgroundEmbeddingCharacters: stringLength(module && module.backgroundEmbedding),
      },
      regex: regex.map(function (script, index) {
        return {
          index: index,
          comment: String((script && script.comment) || ''),
          type: String((script && script.type) || ''),
          flag: String((script && script.flag) || ''),
          ableFlag: script && script.ableFlag,
          inputCharacters: stringLength(script && script.in),
          outputCharacters: stringLength(script && script.out),
        };
      }),
      triggers: triggerSummary,
      lua: lua,
      assetReferences: {
        declared: assetHits,
        raw: Object.keys(rawReferences).map(function (name) {
          return { name: name, occurrences: rawReferences[name] };
        }),
      },
      dependencies: {
        mcpUrl: String((module && module.mcp && module.mcp.url) || ''),
        moduleReferences: Object.keys(moduleReferences),
        externalOrigins: Object.keys(externalOrigins).sort(),
      },
    };
  }

  var api = {
    RisuModuleError: RisuModuleError,
    initRPack: initRPack,
    encodeRPack: encodeRPack,
    decodeRPack: decodeRPack,
    decodeRisum: decodeRisum,
    analyzeModule: analyzeModule,
  };
  root.YeyuRisuModule = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
