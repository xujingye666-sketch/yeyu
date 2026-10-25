(function (root) {
  'use strict';

  var IMAGE_EXTENSION = /\.(png|jpe?g|jfif|webp|gif|apng|bmp|avif)$/i,
    NON_IMAGE_EXTENSION = /\.(mp3|wav|ogg|mp4|webm|avi|m4p|m4v)$/i,
    NON_IMAGE_TYPE = ['audio', 'sound', 'voice', 'video'],
    sourceLoads = new WeakMap(),
    validatedImageSources = new WeakMap();

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function available(char) {
    return !(typeof root.isRisuCharacter === 'function' && root.isRisuCharacter(char));
  }

  function assertAvailable(char) {
    if (!available(char)) throw new Error('Risu 卡片的立绘由 Risu 运行体系管理');
  }

  function config(char, write) {
    if (!object(char)) throw new Error('当前没有可管理表情的角色');
    assertAvailable(char);
    var extensions = object(char.extensions) || {},
      yeyu = object(extensions.yeyu) || {},
      stored = object(yeyu.expressions),
      result = write ? stored || {} : Object.assign({}, stored || {});
    if (!Array.isArray(result.bindings)) result.bindings = [];
    if (!Array.isArray(result.excluded)) result.excluded = [];
    if (typeof result.group !== 'string') result.group = '';
    if (typeof result.hidden !== 'boolean') result.hidden = true;
    if (write) {
      char.extensions = extensions;
      extensions.yeyu = yeyu;
      yeyu.expressions = result;
    }
    return result;
  }

  function assetId(asset) {
    return String((asset && asset.id) || '').trim();
  }

  function mediaAssets(char) {
    return char && Array.isArray(char.media_assets) ? char.media_assets : [];
  }

  function assetForId(char, id) {
    id = String(id || '').trim();
    return mediaAssets(char).find(function (asset) {
      return assetId(asset) === id;
    });
  }

  function remoteSource(asset) {
    var value = String((asset && (asset.sourceUrl || asset.originalUri)) || '').trim();
    return typeof remoteImageUrl === 'function' ? remoteImageUrl(value) : /^https?:\/\//i.test(value) ? value : '';
  }

  function imageName(asset) {
    return String((asset && (asset.name || asset.alt)) || assetId(asset) || '未命名图片').trim();
  }

  function stripImageExtension(value) {
    return String(value || '')
      .split(/[\\/]/)
      .pop()
      .replace(IMAGE_EXTENSION, '')
      .trim();
  }

  function automaticLabel(asset) {
    return String((asset && asset.name) || '').trim() || '未命名表情';
  }

  function importedLabel(filename) {
    var stem = stripImageExtension(filename).toLowerCase();
    return (stem.match(/^(.+?)(?:[-\.].*?)?$/) || [null, stem])[1] || '';
  }

  function imageExtension(filename, mime) {
    var match = String(filename || '').match(IMAGE_EXTENSION);
    if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
    return (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/apng': 'apng',
        'image/bmp': 'bmp',
        'image/avif': 'avif',
      }[String(mime || '').toLowerCase()] || ''
    );
  }

  function hasMemoryBytes(asset) {
    return !!(
      asset &&
      (asset.blob instanceof Blob ||
        asset.bytes instanceof Uint8Array ||
        /^data:image\//i.test(String(asset.data_url || asset.dataUrl || '')))
    );
  }

  function missingBytes(asset) {
    if (!asset || asset.status === 'failed' || asset.status === 'save_failed') return true;
    if (hasMemoryBytes(asset) || asset.mediaKey) return false;
    return !remoteSource(asset);
  }

  function assetDeclaredMime(asset) {
    var blobMime = asset && asset.blob instanceof Blob ? asset.blob.type : '',
      dataMatch = String((asset && (asset.data_url || asset.dataUrl)) || '').match(/^data:([^;,]+)/i),
      declared = String((dataMatch && dataMatch[1]) || blobMime || (asset && asset.mime) || '').toLowerCase();
    if (declared) return declared;
    return typeof cardAssetMime === 'function'
      ? cardAssetMime(asset, (asset && (asset.name || asset.originalUri || asset.sourceUrl)) || '')
      : '';
  }

  function isExplicitNonImage(asset) {
    var type = String((asset && asset.assetType) || '').toLowerCase(),
      mime = assetDeclaredMime(asset),
      name = String((asset && (asset.name || asset.originalUri || asset.sourceUrl)) || '');
    return NON_IMAGE_TYPE.includes(type) || /^(?:audio|video)\//.test(mime) || NON_IMAGE_EXTENSION.test(name);
  }

  function isImageAsset(asset) {
    if (!asset || typeof asset !== 'object') return false;
    var type = String(asset.assetType || '').toLowerCase(),
      mime = assetDeclaredMime(asset),
      name = String(asset.name || asset.originalUri || asset.sourceUrl || '');
    if (isExplicitNonImage(asset)) return false;
    if (asset.bytes instanceof Uint8Array)
      return typeof cardImageContentType === 'function' && !!cardImageContentType(asset.bytes);
    if (/^data:(?:audio|video)\//i.test(String(asset.data_url || asset.dataUrl || ''))) return false;
    return (
      mime.startsWith('image/') ||
      /^data:image\//i.test(String(asset.data_url || asset.dataUrl || '')) ||
      IMAGE_EXTENSION.test(name) ||
      ['emotion', 'icon', 'avatar', 'portrait', 'background', 'user_icon'].includes(type)
    );
  }

  function publicImage(asset) {
    var missing = missingBytes(asset);
    return {
      id: assetId(asset),
      name: imageName(asset),
      type: String((asset && asset.assetType) || 'other'),
      missing: missing,
      status: String(asset.status || (missing ? 'missing' : 'ready')),
    };
  }

  function images(char) {
    if (!available(char)) return [];
    return mediaAssets(char)
      .filter(function (asset) {
        return (
          assetId(asset) &&
          isImageAsset(asset) &&
          (asset.kind === 'ccv3_asset' || hasMemoryBytes(asset) || !!asset.mediaKey)
        );
      })
      .map(publicImage);
  }

  function publicBinding(char, row, automatic) {
    var id = String((row && row.assetId) || '').trim(),
      asset = assetForId(char, id);
    return {
      assetId: id,
      label: String((row && row.label) || '').trim(),
      group: String((row && row.group) || ''),
      automatic: !!automatic,
      missing: missingBytes(asset),
      name: asset ? imageName(asset) : '',
    };
  }

  function bindingKey(assetIdValue, label, group) {
    return JSON.stringify([String(assetIdValue || '').trim(), String(label || '').trim(), String(group || '')]);
  }

  function bindings(char) {
    if (!available(char)) return [];
    var settings = config(char),
      manual = settings.bindings
        .filter(function (row) {
          if (!object(row) || !String(row.assetId || '').trim() || !String(row.label || '').trim()) return false;
          var asset = assetForId(char, row.assetId);
          return !asset || isImageAsset(asset);
        })
        .map(function (row) {
          return publicBinding(char, row, false);
        }),
      manuallyBound = new Set(
        manual.map(function (row) {
          return bindingKey(row.assetId, row.label, row.group);
        })
      ),
      excluded = new Set(settings.excluded.map(String));
    mediaAssets(char).forEach(function (asset) {
      var id = assetId(asset);
      if (
        id &&
        String(asset.assetType || '').toLowerCase() === 'emotion' &&
        isImageAsset(asset) &&
        !manuallyBound.has(bindingKey(id, automaticLabel(asset), '')) &&
        !excluded.has(id)
      )
        manual.push(publicBinding(char, { assetId: id, label: automaticLabel(asset), group: '' }, true));
    });
    return manual;
  }

  function bind(char, id, label, group) {
    var asset = assetForId(char, id),
      settings = config(char, true);
    id = String(id || '').trim();
    label = String(label || '').trim();
    group = group == null ? settings.group : String(group);
    if (!asset) throw new Error('找不到要绑定的卡内图片：' + (id || '未提供资产 ID'));
    if (!isImageAsset(asset)) throw new Error('卡内资产“' + imageName(asset) + '”不是可绑定的图片');
    if (!label) throw new Error('表情标签不能为空');
    var stored = settings.bindings.find(function (row) {
      return (
        object(row) &&
        String(row.assetId || '') === id &&
        String(row.label || '').trim() === label &&
        String(row.group || '') === group
      );
    });
    if (!stored) {
      stored = { assetId: id, label: label, group: group };
      settings.bindings.push(stored);
    }
    return { assetId: id, label: label, group: group };
  }

  function unbind(char, binding) {
    binding = binding || {};
    var settings = config(char, true),
      id = String(binding.assetId || '').trim(),
      label = String(binding.label || '').trim(),
      group = String(binding.group || ''),
      asset = assetForId(char, id),
      automaticTuple =
        asset &&
        String(asset.assetType || '').toLowerCase() === 'emotion' &&
        bindingKey(id, label, group) === bindingKey(id, automaticLabel(asset), ''),
      before = settings.bindings.length;
    settings.bindings = settings.bindings.filter(function (row) {
      if (!object(row) || String(row.assetId || '') !== id) return true;
      if (String(row.label || '').trim() !== label) return true;
      if (String(row.group || '') !== group) return true;
      return false;
    });
    var changed = settings.bindings.length !== before;
    if (
      automaticTuple &&
      !settings.excluded.some(function (value) {
        return String(value) === id;
      })
    ) {
      settings.excluded.push(id);
      changed = true;
    }
    return changed;
  }

  function hashBytes(bytes) {
    var value = 2166136261;
    for (var index = 0; index < bytes.length; index++) {
      value ^= bytes[index];
      value = Math.imul(value, 16777619);
    }
    return 'expression-fnv1a:' + (value >>> 0).toString(16) + ':' + bytes.length;
  }

  function uniqueAssetId(char) {
    var id;
    do {
      id =
        'expression_' +
        (root.crypto && typeof root.crypto.randomUUID === 'function'
          ? root.crypto.randomUUID()
          : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
    } while (assetForId(char, id));
    return id;
  }

  async function validateImage(bytes, filename, fromZip) {
    var blob = new Blob([bytes]),
      validated;
    try {
      validated = await validateCardImageBlob(blob);
    } catch (error) {
      throw new Error('图片“' + filename + '”无法导入：' + String((error && error.message) || error));
    }
    return {
      filename: String(filename || '未命名图片'),
      bytes: new Uint8Array(await validated.arrayBuffer()),
      mime: String(validated.type || blob.type || 'application/octet-stream'),
      fromZip: !!fromZip,
    };
  }

  async function readZip(file, bytes) {
    if (!root.YeyuCharx || typeof root.YeyuCharx.openArchive !== 'function')
      throw new Error('当前版本缺少表情 ZIP 解压能力');
    var archive = await root.YeyuCharx.openArchive(bytes, '表情 ZIP'),
      entries = archive.entries.filter(function (entry) {
        return (
          entry &&
          entry.path &&
          !entry.path.startsWith('__MACOSX/') &&
          IMAGE_EXTENSION.test(entry.path.split('/').pop() || '')
        );
      });
    if (!entries.length) throw new Error('表情 ZIP“' + String(file.name || '') + '”内没有可导入的图片');
    var result = [];
    for (var entry of entries) {
      var entryBytes = await archive.read(entry);
      result.push(await validateImage(entryBytes, entry.path.split('/').pop(), true));
    }
    return result;
  }

  async function prepareFiles(files) {
    var result = [];
    for (var file of Array.from(files || [])) {
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('选择的文件无法读取');
      var bytes = new Uint8Array(await file.arrayBuffer()),
        zip = /\.zip$/i.test(String(file.name || '')) || String(file.type || '').toLowerCase() === 'application/zip';
      if (zip) result.push.apply(result, await readZip(file, bytes));
      else result.push(await validateImage(bytes, String(file.name || '未命名图片'), false));
    }
    if (!result.length) throw new Error('请选择要导入的图片或表情 ZIP');
    return result;
  }

  function expressionAsset(char, prepared) {
    var id = uniqueAssetId(char),
      ext = imageExtension(prepared.filename, prepared.mime);
    return {
      id: id,
      kind: 'ccv3_asset',
      assetType: 'emotion',
      name: prepared.filename,
      ext: ext,
      originalUri: '',
      sourceUrl: '',
      status: 'ready',
      bytes: prepared.bytes,
      mime: prepared.mime,
      mediaHash: hashBytes(prepared.bytes),
    };
  }

  async function importFiles(char, files, options) {
    options = object(options) || {};
    var prepared = await prepareFiles(files),
      settings = config(char, true),
      replaceId = String(options.replaceAssetId || '').trim();
    if (replaceId) {
      if (prepared.length !== 1) throw new Error('替换单张表情时只能选择一张图片');
      var target = assetForId(char, replaceId);
      if (!target || !isImageAsset(target)) throw new Error('找不到要替换的卡内图片：' + replaceId);
      var replaceLabel = String(options.label || '').trim(),
        replaceGroup = options.group == null ? '' : String(options.group),
        previous = bindings(char).filter(function (row) {
          return row.assetId === replaceId && row.label === replaceLabel && row.group === replaceGroup;
        }),
        item = prepared[0],
        next = expressionAsset(char, item),
        nextLabel = replaceLabel,
        nextGroup = replaceGroup;
      if (!replaceLabel || !previous.length) throw new Error('找不到要替换的表情绑定，请按图片、标签和素材组重新选择');
      if (!nextLabel) throw new Error('图片文件名无法生成表情标签，请手动填写标签');
      previous.forEach(function (row) {
        unbind(char, row);
      });
      mediaAssets(char).push(next);
      var nextBinding = bind(char, next.id, nextLabel, nextGroup);
      if (
        !settings.excluded.some(function (value) {
          return String(value) === next.id;
        })
      )
        settings.excluded.push(next.id);
      return {
        assets: [publicImage(next)],
        bindings: [nextBinding],
        count: 1,
      };
    }

    var plan = prepared.map(function (item) {
      return {
        item: item,
        label:
          String(options.label || '').trim() ||
          (item.fromZip ? importedLabel(item.filename) : stripImageExtension(item.filename)),
        group: options.group == null ? settings.group : String(options.group),
      };
    });
    if (
      plan.some(function (row) {
        return !row.label;
      })
    )
      throw new Error('图片文件名无法生成表情标签，请手动填写标签');
    if (options.replace) {
      var replaceKeys = new Set(
        plan.map(function (row) {
          return JSON.stringify([row.label, row.group]);
        })
      );
      bindings(char).forEach(function (row) {
        if (replaceKeys.has(JSON.stringify([row.label, row.group]))) unbind(char, row);
      });
    }
    if (!Array.isArray(char.media_assets)) char.media_assets = [];
    var added = plan.map(function (row) {
      var asset = expressionAsset(char, row.item);
      mediaAssets(char).push(asset);
      var binding = bind(char, asset.id, row.label, row.group);
      if (
        !settings.excluded.some(function (value) {
          return String(value) === asset.id;
        })
      )
        settings.excluded.push(asset.id);
      return { asset: asset, binding: binding };
    });
    return {
      assets: added.map(function (row) {
        return publicImage(row.asset);
      }),
      bindings: added.map(function (row) {
        return row.binding;
      }),
      count: added.length,
    };
  }

  function sourceError(message, retryable, cause) {
    var error = new Error(message);
    error.retryable = !!retryable;
    if (cause) error.cause = cause;
    return error;
  }

  function rememberSourceFailure(asset, status, message, retryable) {
    asset.status = status;
    asset.error = String(message || '图片加载失败');
    asset.errorRetryable = !!retryable;
  }

  async function validateExpressionAsset(asset) {
    var sourceValue =
      asset.blob instanceof Blob
        ? asset.blob
        : asset.bytes instanceof Uint8Array
          ? asset.bytes
          : String(asset.data_url || asset.dataUrl || '');
    if (sourceValue && validatedImageSources.get(asset) === sourceValue) return;
    var blob = null;
    if (asset.blob instanceof Blob) blob = asset.blob;
    else if (asset.bytes instanceof Uint8Array)
      blob = new Blob([asset.bytes], {
        type:
          assetDeclaredMime(asset) ||
          (typeof cardImageContentType === 'function' ? cardImageContentType(asset.bytes) : ''),
      });
    else if (/^data:image\//i.test(sourceValue) && typeof fetch === 'function') {
      var response = await fetch(sourceValue);
      if (response.ok) blob = await response.blob();
    }
    if (!blob) throw sourceError('图片字节缺失或无法读取', false);
    if (typeof validateCardImageBlob === 'function') {
      var validated = await validateCardImageBlob(blob);
      if (asset.blob instanceof Blob) asset.blob = validated;
      if (validated.type) asset.mime = validated.type;
    } else {
      var bytes = new Uint8Array(await blob.arrayBuffer());
      var type = typeof cardImageContentType === 'function' ? cardImageContentType(bytes) : '';
      if (!type) throw sourceError('图片内容无法识别', false);
      asset.mime = type;
    }
    validatedImageSources.set(
      asset,
      asset.blob instanceof Blob ? asset.blob : asset.bytes instanceof Uint8Array ? asset.bytes : sourceValue
    );
  }

  async function persistExpressionAsset(asset) {
    asset.status = 'ready';
    asset.error = '';
    asset.errorRetryable = false;
    try {
      if (typeof saveData === 'function') await saveData('characters');
    } catch (error) {
      rememberSourceFailure(
        asset,
        'save_failed',
        '图片已加载，但保存到媒体仓储失败：' + String(error.message || error),
        true
      );
      throw sourceError(asset.error + '。请重试保存', true, error);
    }
  }

  async function loadExpressionSource(char, asset, options) {
    var retry = !!options.retry;
    if (asset.status === 'failed' && !retry)
      throw sourceError(asset.error || '图片加载失败，请重试', asset.errorRetryable !== false);

    if (hasMemoryBytes(asset)) {
      try {
        await validateExpressionAsset(asset);
        var localDisplay = typeof cardAssetDisplaySrc === 'function' ? cardAssetDisplaySrc(asset, char) : '';
        if (!localDisplay) throw sourceError('图片字节缺失或无法读取', false);
        if (asset.status === 'save_failed') {
          if (!retry) throw sourceError(asset.error || '图片尚未保存，请重试', true);
          await persistExpressionAsset(asset);
          localDisplay = typeof cardAssetDisplaySrc === 'function' ? cardAssetDisplaySrc(asset, char) : '';
          if (!localDisplay) throw sourceError('图片保存后无法读取，请重试', true);
        }
        return localDisplay;
      } catch (error) {
        if (asset.status === 'save_failed' || error.retryable) throw error;
        if (!remoteSource(asset))
          throw sourceError('表情图片“' + imageName(asset) + '”无法解码，请从原文件补入', false, error);
        delete asset.blob;
        delete asset.bytes;
        delete asset.data_url;
        delete asset.dataUrl;
        asset.status = 'remote';
        asset.error = '本地图片无法解码，将重新加载远程来源：' + String(error.message || error);
        asset.errorRetryable = true;
      }
    }

    if (asset.mediaKey && root.YeyuRepository && typeof root.YeyuRepository.loadMediaBlob === 'function') {
      try {
        var blob = await root.YeyuRepository.loadMediaBlob(asset.mediaKey);
        if (blob instanceof Blob) {
          asset.blob = blob;
          if (/^(?:audio|video)\//i.test(blob.type)) {
            asset.mime = blob.type;
            delete asset.blob;
            rememberSourceFailure(asset, 'failed', '媒体仓储中的资产不是图片', false);
            throw sourceError(asset.error, false);
          }
          try {
            await validateExpressionAsset(asset);
          } catch (validationError) {
            delete asset.blob;
            rememberSourceFailure(
              asset,
              'failed',
              '媒体仓储中的图片无法解码：' + String(validationError.message || validationError),
              false
            );
            throw sourceError(asset.error, false, validationError);
          }
          asset.status = 'ready';
          asset.error = '';
          asset.errorRetryable = false;
          var storedDisplay = typeof cardAssetDisplaySrc === 'function' ? cardAssetDisplaySrc(asset, char) : '';
          if (storedDisplay) return storedDisplay;
        }
        delete asset.blob;
        if (!remoteSource(asset)) {
          rememberSourceFailure(asset, 'failed', '媒体仓储中没有这张图片的原始字节', true);
          throw sourceError(asset.error + '，请重试读取', true);
        }
      } catch (error) {
        delete asset.blob;
        if (!remoteSource(asset)) {
          if (typeof error.retryable === 'boolean') throw error;
          else rememberSourceFailure(asset, 'failed', '媒体仓储读取失败：' + String(error.message || error), true);
          throw sourceError(asset.error + '，请重试读取', true, error);
        }
        asset.status = 'remote';
        asset.errorRetryable = true;
      }
    }

    var remote = remoteSource(asset);
    if (remote) {
      if (asset.status === 'failed' && !retry)
        throw sourceError(asset.error || '远程图片加载失败，请重试', asset.errorRetryable !== false);
      asset.sourceUrl = remote;
      asset.status = 'loading';
      asset.error = '';
      asset.errorRetryable = false;
      if (typeof downloadCardAsset !== 'function') {
        rememberSourceFailure(asset, 'failed', '当前环境无法下载远程图片', true);
        throw sourceError(asset.error + '，请重试', true);
      }
      await downloadCardAsset(char, asset);
      if (!asset.data_url) {
        rememberSourceFailure(asset, 'failed', asset.error || '远程图片加载失败', true);
        throw sourceError('表情图片“' + imageName(asset) + '”加载失败：' + asset.error + '。请重试', true);
      }
      try {
        await validateExpressionAsset(asset);
      } catch (validationError) {
        delete asset.data_url;
        delete asset.dataUrl;
        rememberSourceFailure(
          asset,
          'failed',
          '远程图片无法解码：' + String(validationError.message || validationError),
          true
        );
        throw sourceError(asset.error + '。请重试下载', true, validationError);
      }
      await persistExpressionAsset(asset);
      var remoteDisplay = typeof cardAssetDisplaySrc === 'function' ? cardAssetDisplaySrc(asset, char) : '';
      if (remoteDisplay) return remoteDisplay;
      rememberSourceFailure(asset, 'failed', '远程图片加载后无法显示', true);
      throw sourceError(asset.error + '，请重试', true);
    }

    asset.status = 'unavailable';
    asset.error = 'missing_blob';
    asset.errorRetryable = false;
    throw sourceError('表情图片“' + imageName(asset) + '”缺少原始字节，请从原角色卡或图片重新补入', false);
  }

  async function source(char, id, options) {
    var asset = assetForId(char, id);
    if (!asset) throw sourceError('找不到卡内图片：' + String(id || '未提供资产 ID'), false);
    if (isExplicitNonImage(asset)) throw sourceError('卡内资产“' + imageName(asset) + '”不是可显示图片', false);
    var shared = sourceLoads.get(asset);
    if (shared) return await shared;
    options = object(options) || {};
    shared = loadExpressionSource(char, asset, options).finally(function () {
      if (sourceLoads.get(asset) === shared) sourceLoads.delete(asset);
    });
    sourceLoads.set(asset, shared);
    return await shared;
  }

  root.YeyuExpressionAssets = {
    available: available,
    config: config,
    bindings: bindings,
    images: images,
    importFiles: importFiles,
    bind: bind,
    unbind: unbind,
    source: source,
  };
})(typeof window !== 'undefined' ? window : globalThis);
