'use strict';

// A small `assert` for test bodies that run inside the loaded app page (page.evaluate). It throws on the first
// failed check, so the evaluate rejects with the test's own message. Install once per page, before navigation.
const pageAssertSource = `(() => {
  const fail = (message, detail) => { throw new Error(message + (detail === undefined ? '' : '\\n' + detail)); };
  const show = value => { try { return JSON.stringify(value); } catch (_) { return String(value); } };
  const same = (a, b) => a === b || (a !== a && b !== b);
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const sameJson = (a, b) => show(canonical(a)) === show(canonical(b));
  window.assert = {
    ok: (value, message) => { if (!value) fail(message || 'expected a truthy value'); },
    strictEqual: (actual, expected, message) => { if (!same(actual, expected)) fail(message || 'values differ', show(actual) + ' !== ' + show(expected)); },
    notStrictEqual: (actual, expected, message) => { if (same(actual, expected)) fail(message || 'values are equal', show(actual)); },
    deepStrictEqual: (actual, expected, message) => { if (!sameJson(actual, expected)) fail(message || 'values differ', show(actual) + ' !== ' + show(expected)); },
    match: (text, pattern, message) => { if (!pattern.test(String(text))) fail(message || 'text does not match', String(text) + ' !~ ' + pattern); },
    rejects: async (work, pattern, message) => {
      let error = null;
      try { await (typeof work === 'function' ? work() : work); } catch (caught) { error = caught; }
      if (!error) fail(message || 'expected a rejection');
      if (pattern && !pattern.test(String(error && error.message || error))) fail(message || 'rejection does not match', String(error && error.message || error) + ' !~ ' + pattern);
      return error;
    },
  };
})();`;

module.exports = {pageAssertSource};
