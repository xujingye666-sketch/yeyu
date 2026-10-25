'use strict';
// Protected Prompt identity: evaluates 00-defaults.js and every assistant
// `defaultText` the way the WebView would, so constants interpolated through
// `${...}` are covered by the same hash as the Prompt that embeds them.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseScript } = require('./classic_globals');

const root = path.resolve(__dirname, '../..');
const DEFAULTS_PATH = 'app/src/main/assets/js/app/00-defaults.js';
const APP_SCRIPTS_DIR = 'app/src/main/assets/js/app';
const MANIFEST_PATH = 'tools/fixtures/protected_prompt_manifest.json';
const MANIFEST_SCHEMA_VERSION = 5;
const PROTECTED_CONSTANT = /^DEFAULT_[A-Z0-9_]+$/;

function promptHash(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

// `overrides` maps project-relative paths to replacement source, letting the
// gate's self-test prove tampering is caught without touching the tree.
function sourceReader(projectRoot, overrides) {
  return (relative) =>
    Object.prototype.hasOwnProperty.call(overrides, relative)
      ? overrides[relative]
      : fs.readFileSync(path.join(projectRoot, relative), 'utf8');
}

function appScriptPaths(projectRoot, overrides) {
  const names = new Set(fs.readdirSync(path.join(projectRoot, APP_SCRIPTS_DIR)).filter((name) => name.endsWith('.js')));
  for (const relative of Object.keys(overrides)) {
    if (path.posix.dirname(relative) === APP_SCRIPTS_DIR && relative.endsWith('.js')) names.add(path.posix.basename(relative));
  }
  return [...names].sort().map((name) => `${APP_SCRIPTS_DIR}/${name}`);
}

function walk(sourceCode, node, visit) {
  visit(node);
  for (const key of sourceCode.visitorKeys[node.type] || []) {
    const child = node[key];
    for (const item of Array.isArray(child) ? child : [child]) if (item) walk(sourceCode, item, visit);
  }
}

function isDefaultTextProperty(node) {
  if (node.type !== 'Property' || node.kind !== 'init') return false;
  const key = node.key;
  return node.computed ? key.type === 'Literal' && key.value === 'defaultText' : key.name === 'defaultText' || key.value === 'defaultText';
}

function collectProtectedPrompts(projectRoot = root, overrides = {}) {
  const read = sourceReader(projectRoot, overrides);
  const errors = [];
  const constants = new Map();
  const assistant = new Map();

  const defaultsSource = read(DEFAULTS_PATH);
  const defaultsCode = parseScript(defaultsSource, DEFAULTS_PATH);
  const context = vm.createContext({});
  vm.runInContext(defaultsSource, context, { filename: DEFAULTS_PATH });
  for (const variable of defaultsCode.scopeManager.globalScope.variables) {
    if (!variable.defs.length || !PROTECTED_CONSTANT.test(variable.name)) continue;
    const value = vm.runInContext(variable.name, context);
    if (typeof value !== 'string') errors.push(`默认 Prompt 常量必须求值为字符串：${variable.name}`);
    else constants.set(variable.name, value);
  }

  for (const relative of appScriptPaths(projectRoot, overrides)) {
    const source = read(relative);
    const sourceCode = parseScript(source, relative);
    let ordinal = 0;
    walk(sourceCode, sourceCode.ast, (node) => {
      if (!isDefaultTextProperty(node)) return;
      if (node.value.type === 'Identifier' && constants.has(node.value.name)) return;
      ordinal += 1;
      const location = `${relative}#${ordinal}`;
      let value;
      try {
        value = vm.runInContext(`(${source.slice(node.value.range[0], node.value.range[1])})`, context);
      } catch (error) {
        errors.push(`助手默认 Prompt 必须能仅凭 00-defaults.js 求值：${location}（${error.message}）`);
        return;
      }
      if (typeof value !== 'string') errors.push(`助手默认 Prompt 必须求值为字符串：${location}`);
      else assistant.set(location, value);
    });
  }
  return { constants, assistant, errors };
}

function verifyProtectedPromptManifest(projectRoot = root, overrides = {}) {
  const read = sourceReader(projectRoot, overrides);
  let manifest;
  try {
    manifest = JSON.parse(read(MANIFEST_PATH));
  } catch (error) {
    return [`受保护 Prompt 身份清单无法解析：${error.message}`];
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION)
    return [`受保护 Prompt 身份清单版本必须为 ${MANIFEST_SCHEMA_VERSION}`];
  if (!Array.isArray(manifest.currentConstants) || !Array.isArray(manifest.currentAssistantPrompts))
    return ['受保护 Prompt 身份清单必须分别登记默认常量与助手默认提示词'];

  let collected;
  try {
    collected = collectProtectedPrompts(projectRoot, overrides);
  } catch (error) {
    return [`受保护 Prompt 源码无法求值：${error.message}`];
  }
  const { constants, assistant, errors } = collected;
  const checkRecord = (record, actual, label, kind) => {
    if (!/^(?:issue:[1-9]\d*|user-direct)$/.test(String(record.authorizationSource)))
      errors.push(`${kind}缺少 issue 或用户直接授权来源：${label}`);
    if (!/^[0-9a-f]{64}$/.test(String(record.sha256))) errors.push(`${kind}身份清单哈希错误：${label}`);
    else if (actual !== undefined && promptHash(actual) !== record.sha256) errors.push(`${kind}已偏离固定基线：${label}`);
  };

  const declaredConstants = new Map();
  for (const record of manifest.currentConstants) {
    const name = record && typeof record.name === 'string' ? record.name : '';
    if (!name || declaredConstants.has(name)) errors.push(`受保护 Prompt 常量身份不得重复或缺少名称：${name}`);
    else declaredConstants.set(name, record);
  }
  const missingConstants = [...constants.keys()].filter((name) => !declaredConstants.has(name)).sort();
  const staleConstants = [...declaredConstants.keys()].filter((name) => !constants.has(name)).sort();
  if (missingConstants.length) errors.push(`发现未登记的默认 Prompt 常量：${missingConstants.join(', ')}`);
  if (staleConstants.length) errors.push(`受保护 Prompt 身份清单含有已不存在的常量：${staleConstants.join(', ')}`);
  for (const [name, record] of declaredConstants) {
    if (record.sourcePath !== DEFAULTS_PATH) errors.push(`受保护 Prompt 常量来源错误：${name}`);
    checkRecord(record, constants.get(name), name, '默认 Prompt ');
  }

  const declaredAssistant = new Map();
  const assistantIds = new Set();
  for (const record of manifest.currentAssistantPrompts) {
    const id = record && typeof record.id === 'string' ? record.id : '';
    if (!id || assistantIds.has(id)) {
      errors.push(`助手默认 Prompt 身份无效或重复：${id}`);
      continue;
    }
    assistantIds.add(id);
    if (typeof record.sourcePath !== 'string' || !Number.isInteger(record.ordinal) || record.ordinal < 1) {
      errors.push(`助手默认 Prompt 定位信息无效：${id}`);
      continue;
    }
    const location = `${record.sourcePath}#${record.ordinal}`;
    if (declaredAssistant.has(location)) errors.push(`助手默认 Prompt 定位重复：${location}`);
    else declaredAssistant.set(location, record);
  }
  const missingAssistant = [...assistant.keys()].filter((location) => !declaredAssistant.has(location)).sort();
  const staleAssistant = [...declaredAssistant.keys()].filter((location) => !assistant.has(location)).sort();
  if (missingAssistant.length) errors.push(`发现未登记的助手默认 Prompt：${missingAssistant.join(', ')}`);
  if (staleAssistant.length) errors.push(`受保护 Prompt 身份清单含有已不存在的助手默认项：${staleAssistant.join(', ')}`);
  for (const [location, record] of declaredAssistant) checkRecord(record, assistant.get(location), record.id, '助手默认 Prompt ');
  return errors;
}

module.exports = {
  DEFAULTS_PATH,
  MANIFEST_PATH,
  collectProtectedPrompts,
  promptHash,
  verifyProtectedPromptManifest,
};

if (require.main === module) {
  // check_project.py consumes one error per line; exit status carries the verdict.
  const errors = verifyProtectedPromptManifest();
  for (const error of errors) process.stdout.write(`${error}\n`);
  process.exitCode = errors.length ? 1 : 0;
}
