(function (root) {
  'use strict';
  var crcTable = Uint32Array.from({ length: 256 }, function (_, value) {
    for (var bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
  });
  function crc32(bytes) {
    var value = 0xffffffff;
    for (var byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
    return (value ^ 0xffffffff) >>> 0;
  }
  function normalizePath(value) {
    var path = String(value || '')
        .replace(/\\/g, '/')
        .trim(),
      parts = [];
    for (var part of path.split('/')) {
      if (part === '..') {
        if (!parts.length) return null;
        parts.pop();
      } else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/') || null;
  }
  function embeddedPath(uri) {
    var match = String(uri || '')
      .trim()
      .match(/^(?:embeded:\/\/|embedded:\/\/|__asset:)(.*)$/i);
    return match ? normalizePath(match[1]) : null;
  }
  async function openArchive(input, format) {
    format = format || 'CHARX';
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function check(offset, size) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length)
        throw new Error(format + ' ZIP 数据不完整');
    }
    function u16(offset) {
      check(offset, 2);
      return view.getUint16(offset, true);
    }
    function u32(offset) {
      check(offset, 4);
      return view.getUint32(offset, true);
    }
    function u64(offset) {
      var result = u32(offset) + u32(offset + 4) * 4294967296;
      if (!Number.isSafeInteger(result)) throw new Error(format + ' ZIP 长度超出可读取范围');
      return result;
    }
    var end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557)) {
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
      end--;
    }
    if (end < Math.max(0, bytes.length - 65557)) throw new Error(format + ' ZIP 目录缺失或损坏');
    if (u16(end + 4) || u16(end + 6)) throw new Error(format + ' 不支持分卷 ZIP，请合并后重新导入');
    var count = u16(end + 10),
      directorySize = u32(end + 12),
      directoryOffset = u32(end + 16),
      directoryEnd = end;
    if (count === 65535 || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      if (u32(end - 20) !== 0x07064b50 || u32(end - 16) || u32(end - 4) !== 1)
        throw new Error(format + ' ZIP64 目录缺失或分卷');
      var zip64 = end - 76;
      while (zip64 >= 0) {
        if (
          u32(zip64) === 0x06064b50 &&
          u32(zip64 + 8) === 0 &&
          u64(zip64 + 4) >= 44 &&
          zip64 + 12 + u64(zip64 + 4) === end - 20 &&
          u32(zip64 + 44) === 0 &&
          u32(zip64 + 52) === 0 &&
          zip64 - u64(zip64 + 40) - u64(zip64 + 48) + u64(end - 12) === zip64
        )
          break;
        zip64--;
      }
      if (zip64 < 0 || u32(zip64 + 16) || u32(zip64 + 20) || u64(zip64 + 24) !== u64(zip64 + 32))
        throw new Error(format + ' ZIP64 目录无效');
      count = u64(zip64 + 32);
      directorySize = u64(zip64 + 40);
      directoryOffset = u64(zip64 + 48);
      directoryEnd = zip64;
    }
    var base = directoryEnd - directorySize - directoryOffset,
      cursor = base + directoryOffset,
      entries = [];
    check(cursor, directorySize);
    for (var i = 0; i < count; i++) {
      if (u32(cursor) !== 0x02014b50) throw new Error(format + ' ZIP 文件目录损坏');
      var nameSize = u16(cursor + 28),
        extraSize = u16(cursor + 30),
        commentSize = u16(cursor + 32);
      check(cursor, 46 + nameSize + extraSize + commentSize);
      var entry = {
        flags: u16(cursor + 8),
        method: u16(cursor + 10),
        crc: u32(cursor + 16),
        size: u32(cursor + 24),
        compressedSize: u32(cursor + 20),
        offset: u32(cursor + 42),
      };
      var nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
      if (
        !(entry.flags & 0x800) &&
        nameBytes.some(function (byte) {
          return byte > 127;
        })
      )
        throw new Error(format + ' 文件名不是 UTF-8，请用 UTF-8 重新打包后导入');
      try {
        entry.name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
      } catch (_) {
        throw new Error(format + ' 文件名不是 UTF-8，请用 UTF-8 重新打包后导入');
      }
      if (u16(cursor + 34)) throw new Error(format + ' 不支持分卷 ZIP，请合并后重新导入');
      var extra = cursor + 46 + nameSize,
        extraEnd = extra + extraSize;
      while (extra + 4 <= extraEnd) {
        var tag = u16(extra),
          length = u16(extra + 2),
          position = extra + 4;
        if (position + length > extraEnd) throw new Error(format + ' ZIP 扩展目录损坏');
        if (tag === 1) {
          for (var key of ['size', 'compressedSize', 'offset']) {
            if (entry[key] === 0xffffffff) {
              if (position + 8 > extra + 4 + length) throw new Error(format + ' ZIP64 文件长度缺失');
              entry[key] = u64(position);
              position += 8;
            }
          }
        }
        extra = position = extra + 4 + length;
      }
      entry.path = normalizePath(entry.name);
      entries.push(entry);
      cursor += 46 + nameSize + extraSize + commentSize;
    }
    if (cursor !== directoryEnd || base < 0) throw new Error(format + ' ZIP 目录长度不符');
    async function read(entry) {
      if (!entry) return null;
      if (entry.flags & 1) throw new Error(format + ' 文件已加密，请解密后重新导入');
      var local = base + entry.offset;
      if (u32(local) !== 0x04034b50) throw new Error(format + ' ZIP 文件头损坏');
      if (u16(local + 6) & 1) throw new Error(format + ' 文件已加密，请解密后重新导入');
      if (u16(local + 8) !== entry.method) throw new Error(format + ' ZIP 压缩方式不一致');
      var start = local + 30 + u16(local + 26) + u16(local + 28);
      check(start, entry.compressedSize);
      if (start + entry.compressedSize > base + directoryOffset) throw new Error(format + ' ZIP 文件内容越界');
      var content = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 8) {
        var decompressor;
        try {
          decompressor = new DecompressionStream('deflate-raw');
        } catch (_) {
          throw new Error('当前 WebView 不支持 ' + format + ' 解压，请更新 WebView 后重试');
        }
        var reader = new Blob([content]).stream().pipeThrough(decompressor).getReader(),
          length = 0,
          chunks = [];
        try {
          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            if (length + chunk.value.length > entry.size) throw new Error(format + ' ZIP 解压长度超出声明大小');
            chunks.push(chunk.value);
            length += chunk.value.length;
          }
        } finally {
          await reader.cancel();
        }
        if (length !== entry.size) throw new Error(format + ' ZIP 文件长度不符');
        content = new Uint8Array(length);
        var offset = 0;
        chunks.forEach(function (chunk) {
          content.set(chunk, offset);
          offset += chunk.length;
        });
      } else if (entry.method !== 0) throw new Error(format + ' ZIP 压缩方式不受支持，请使用 Store 或 Deflate');
      if (content.length !== entry.size) throw new Error(format + ' ZIP 文件长度不符');
      if (crc32(content) !== entry.crc) throw new Error(format + ' ZIP CRC 校验失败，请重新获取文件');
      return content;
    }
    return { entries: entries, read: read };
  }
  // Only images can become the icon. Audio and video are kept as assets so Risu display tags
  // ({{audio::}}, {{bgm::}}, {{video::}}) resolve them by name, as they already do for module assets.
  var IMAGE_EXTENSION = /^(png|jpe?g|webp|gif|apng|avif|bmp|jfif)$/,
    MEDIA_EXTENSION = /^(png|jpe?g|webp|gif|apng|avif|bmp|jfif|mp3|wav|ogg|mp4|webm|m4v|m4p|avi)$/;
  async function parse(input) {
    var archive = await openArchive(input),
      cardEntry = archive.entries
        .filter(function (entry) {
          return entry.path && entry.path.split('/').pop() === 'card.json' && !entry.path.startsWith('__MACOSX/');
        })
        .sort(function (a, b) {
          return a.path.split('/').length - b.path.split('/').length;
        })[0];
    if (!cardEntry) throw new Error('CHARX 内没有 card.json');
    var card = JSON.parse(new TextDecoder().decode(await archive.read(cardEntry)));
    if (!card || card.spec === undefined) throw new Error('CHARX card.json 缺少 spec 字段');
    // A folder compressed as a whole puts card.json under that folder. Declared paths are looked up at
    // the archive root first (the CHARX layout ST also reads), then beside card.json.
    var cardDirectory = cardEntry.path.split('/').slice(0, -1).join('/');
    function findEntry(path) {
      var candidates = cardDirectory ? [path, normalizePath(cardDirectory + '/' + path)] : [path];
      for (var candidate of candidates) {
        var found =
          candidate &&
          archive.entries.find(function (entry) {
            return entry.path === candidate;
          });
        if (found) return found;
      }
      return null;
    }
    var assets = (Array.isArray(card.data && card.data.assets) ? card.data.assets : [])
      .map(function (asset, index) {
        if (!asset) return null;
        var path = embeddedPath(asset.uri),
          ext = String(asset.ext || '')
            .trim()
            .toLowerCase()
            .replace(/^\./, '');
        if (!ext && path) {
          // ST derives the fallback with path.extname, which reports no extension for a dotfile such
          // as `assets/.png`; the leading dot there is the whole name, not a type.
          var base = path.split('/').pop(),
            dot = base.lastIndexOf('.');
          if (dot > 0) ext = base.slice(dot + 1).toLowerCase();
        }
        return path
          ? {
              index: index,
              path: path,
              ext: ext,
              type: String(asset.type || '').toLowerCase(),
              name: String(asset.name || ''),
              uri: String(asset.uri || ''),
            }
          : null;
      })
      .filter(function (asset) {
        return asset && MEDIA_EXTENSION.test(asset.ext);
      });
    var icons = assets.filter(function (asset) {
        return asset.type === 'icon' && IMAGE_EXTENSION.test(asset.ext);
      }),
      icon =
        icons.find(function (asset) {
          return asset.name.toLowerCase() === 'main';
        }) || icons[0];
    var selected = assets.filter(function (asset) {
      return asset.type !== 'icon' && asset.type !== 'user_icon';
    });
    async function readAsset(asset) {
      if (!asset) return null;
      var entry = findEntry(asset.path);
      asset.mediaHash = entry ? 'charx-crc32:' + entry.crc.toString(16) + ':' + entry.size : '';
      return archive.read(entry);
    }
    return {
      card: card,
      assets: selected,
      icon: icon || null,
      readAsset: readAsset,
      readModule: function () {
        return archive.read(findEntry('module.risum'));
      },
    };
  }
  root.YeyuCharx = { parse: parse, openArchive: openArchive, normalizePath: normalizePath, crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
