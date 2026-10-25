const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');

const root = path.resolve(__dirname, '../..');
const assets = 'app/src/main/assets';
// Locked ESLint parser's latest standard; the supported WebView 151 is newer.
const ecmaVersion = 'latest';

function readClassicScripts(projectRoot = root) {
  const html = fs.readFileSync(path.join(projectRoot, assets, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\b[^>]*\bsrc=["'](js\/(?:core|app)\/[^"']+\.js)["'][^>]*>/gi)].map(
    (match) => `${assets}/${match[1]}`
  );
}

function parseScript(source, filename) {
  const linter = new Linter();
  const messages = linter.verify(source, {
    languageOptions: { ecmaVersion, sourceType: 'script' },
  });
  const failure = messages.find((message) => message.fatal);
  if (failure) throw new Error(`${filename}:${failure.line}:${failure.column} ${failure.message}`);
  return linter.getSourceCode();
}

function visitNodes(sourceCode, node, enter) {
  if (enter(node) === false) return;
  for (const key of sourceCode.visitorKeys[node.type] || []) {
    const child = node[key];
    if (Array.isArray(child))
      child.forEach((item) => {
        if (item) visitNodes(sourceCode, item, enter);
      });
    else if (child) visitNodes(sourceCode, child, enter);
  }
}

// Functions serialized with `name.toString()` run inside card iframes or workers, so their
// `window.X =` writes belong to that realm rather than the main page.
function collectSerializedFunctions(sourceCode) {
  const names = new Set();
  visitNodes(sourceCode, sourceCode.ast, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.name === 'toString' &&
      node.callee.object.type === 'Identifier'
    )
      names.add(node.callee.object.name);
  });
  return names;
}

function collectWindowAssignments(sourceCode, serializedFunctions) {
  const names = new Set();
  const globalReferences = new Set(
    sourceCode.scopeManager.scopes
      .flatMap((scope) => scope.references)
      .filter(
        (reference) =>
          !reference.resolved || (reference.resolved.scope.type === 'global' && !reference.resolved.defs.length)
      )
      .map((reference) => reference.identifier)
  );
  visitNodes(sourceCode, sourceCode.ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id && serializedFunctions.has(node.id.name)) return false;
    if (node.type === 'AssignmentExpression') {
      const member = node.left;
      if (
        member.type === 'MemberExpression' &&
        member.object.type === 'Identifier' &&
        globalReferences.has(member.object) &&
        ['window', 'globalThis'].includes(member.object.name)
      ) {
        const name =
          !member.computed && member.property.type === 'Identifier'
            ? member.property.name
            : member.computed && typeof member.property.value === 'string'
              ? member.property.value
              : null;
        if (name) names.add(name);
      }
    }
  });
  return names;
}

function generateClassicGlobals(projectRoot = root) {
  const declarations = new Map();
  const globals = {};
  const files = [];
  const scripts = readClassicScripts(projectRoot).map((filename) => ({
    filename,
    sourceCode: parseScript(fs.readFileSync(path.join(projectRoot, filename), 'utf8'), filename),
  }));
  const serializedFunctions = new Set(scripts.flatMap(({ sourceCode }) => [...collectSerializedFunctions(sourceCode)]));
  for (const { filename, sourceCode } of scripts) {
    const ownNames = [];
    for (const variable of sourceCode.scopeManager.globalScope.variables) {
      if (!variable.defs.length) continue;
      const identifier = variable.identifiers[0];
      const location = `${filename}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
      const previous = declarations.get(variable.name);
      if (previous)
        throw new Error(`${location} duplicate classic global '${variable.name}'; first declared at ${previous}`);
      declarations.set(variable.name, location);
      ownNames.push(variable.name);
      globals[variable.name] = 'writable';
    }
    for (const name of collectWindowAssignments(sourceCode, serializedFunctions)) globals[name] = 'writable';
    files.push({ filename, ownNames });
  }
  return { globals, files };
}

module.exports = { ecmaVersion, generateClassicGlobals, parseScript };

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(generateClassicGlobals(), null, 2)}\n`);
}
