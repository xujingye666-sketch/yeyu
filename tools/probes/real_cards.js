'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function resolveCardPaths(files, usage) {
  assert(files.length > 0, '必须显式提供原卡路径。\n' + usage);
  return files.map(file => {
    assert(!file.startsWith('-'), '不支持的参数：' + file + '\n' + usage);
    const resolved = path.resolve(file);
    assert(fs.statSync(resolved, {throwIfNoEntry: false})?.isFile(), '原卡不存在或不是文件：' + resolved + '\n' + usage);
    return resolved;
  });
}

module.exports = {resolveCardPaths};
