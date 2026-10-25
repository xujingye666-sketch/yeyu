const globals = require('globals');
const { ecmaVersion, generateClassicGlobals } = require('./tools/qa/classic_globals');

// Only vendor exports and names installed dynamically belong here.
const externalGlobals = {
  DOMPurify: 'readonly', // js/vendor/dompurify-3.4.5.min.js
  ejs: 'readonly', // js/vendor/ejs-3.1.9.js
  JSONRepair: 'readonly', // js/vendor/jsonrepair-3.13.1.min.js
  YeyuMvuVendor: 'readonly', // js/vendor/mvu-runtime-1.0.0.js (self export)
  AndroidBridge: 'readonly', // java/com/yeyu/app/MainActivity.java, addJavascriptInterface
  YeyuPure: 'readonly', // js/core/pure.js, g export
  YeyuCharx: 'readonly', // js/core/charx.js, root export
  YeyuRisuModule: 'readonly', // js/core/risu-module.js, root export
  YeyuRisuCBS: 'readonly', // js/core/risu-cbs.js, installer g export
  YeyuRisuRegex: 'readonly', // js/core/risu-regex.js, installer g export
  YeyuRisuRegexRuntime: 'readonly', // js/core/risu-regex-runtime.js, root export
  YeyuRisuTrigger: 'readonly', // js/core/risu-trigger.js, UMD root export
  YeyuRisuCommand: 'readonly', // js/core/risu-command.js, UMD root export
  YeyuRisuLua: 'readonly', // js/core/risu-lua.js, root export
  YeyuRisuLorebook: 'readonly', // js/core/risu-lorebook.js, root export
  YeyuWheelScheme: 'readonly', // js/core/wheel-scheme-engine.js, g export
  YeyuRepository: 'readonly', // js/core/repository.js, g export
  YeyuVectorRetrieval: 'readonly', // js/core/vector-retrieval.js, g export
  YeyuExpressionAssets: 'readonly', // js/app/45-expression-assets.js, root export
  analyzeCardDependencies: 'readonly', // js/app/31-card-dependencies.js, root export
};
const classic = generateClassicGlobals();
const browserGlobals = { ...globals.browser, ...globals.worker, ...classic.globals, ...externalGlobals };
const rules = { 'no-undef': 'error', 'no-redeclare': ['error', { builtinGlobals: true }] };

module.exports = [
  { ignores: ['**/node_modules/**', '**/build/**', '.tmp/**', 'app/src/main/assets/js/vendor/**'] },
  {
    files: ['app/src/main/assets/js/{core,app}/**/*.js'],
    languageOptions: {
      ecmaVersion,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.worker, ...externalGlobals },
    },
    rules,
  },
  ...classic.files.map(({ filename, ownNames }) => ({
    files: [filename],
    languageOptions: {
      // Own declarations must remain declarations, otherwise no-redeclare
      // would treat the generated entry as a pre-existing built-in global.
      globals: Object.fromEntries(Object.entries(classic.globals).filter(([name]) => !ownNames.includes(name))),
    },
  })),
  {
    files: ['app/src/main/assets/js/workers/**/*.js'],
    languageOptions: {
      ecmaVersion,
      sourceType: 'script',
      globals: globals.worker,
    },
    rules,
  },
  {
    files: ['tools/{tests,qa}/**/*.js'],
    languageOptions: {
      ecmaVersion,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...browserGlobals },
    },
    rules,
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion, sourceType: 'commonjs', globals: globals.node },
    rules,
  },
];
