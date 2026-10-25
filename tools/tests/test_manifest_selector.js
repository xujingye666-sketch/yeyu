"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readManifest, selectTests, confirmChangedTestsStable, STABILITY_RUNS } = require("./run_all");
const manifest = readManifest();
const base = selectTests(manifest, {gate: "Fast", changed: []});
const baseIds = new Set(base.tests.map((test) => test.id));

// Selection must keep the daily/data-safety base and add a whole affected domain.
for (const [changed, domain] of [
  ["app/src/main/assets/js/app/50-worldbook.js", "prompt"],
  ["app/src/main/assets/js/core/repository-db.js", "storage"],
  ["app/src/main/assets/js/app/35-new-display-module.js", "risu"]
]) {
  const selection = selectTests(manifest, {gate: "Fast", changed: [changed]});
  const ids = new Set(selection.tests.map((test) => test.id));
  for (const id of baseIds) assert(ids.has(id), "changed selection lost a base test: " + id);
  for (const test of manifest.tests.filter((test) => test.domain === domain)) assert(ids.has(test.id), "domain selection omitted " + test.id);
  assert.deepStrictEqual(selection.fallbackChangedPaths, []);
}
const fallback = selectTests(manifest, {gate: "Fast", changed: ["app/src/main/assets/js/app/new-module.js"]});
assert.strictEqual(fallback.tests.length, manifest.tests.length, "unclassified new source must not silently skip permanent tests");
assert.deepStrictEqual(fallback.fallbackChangedPaths, ["app/src/main/assets/js/app/new-module.js"]);
const removed = selectTests(manifest, {gate: "Fast", changed: ["tools/tests/retired-test.js"]});
assert.deepStrictEqual(removed.tests.map((test) => test.id), [...baseIds]);
const requested = manifest.tests.find((test) => !baseIds.has(test.id));
const extra = selectTests(manifest, {gate: "Fast", changed: [], tests: [requested.id]});
assert.strictEqual(extra.tests.length, base.tests.length + 1);
assert.strictEqual(selectTests(manifest, {gate: "Release", changed: [], tests: [requested.id]}).tests.length, manifest.tests.length);

// A changed test file is rerun before it is trusted; a probe is named when a change reaches what it verifies.
const touched = selectTests(manifest, {gate: "Fast", changed: ["tools/tests/main_path_browser.js", "app/src/main/java/com/yeyu/app/MainActivity.java"]});
assert.deepStrictEqual(touched.changedTestFiles, ["behavior.main-path-browser"]);
assert.deepStrictEqual(touched.triggeredProbes.map((probe) => probe.id), ["android-smoke"]);
assert.deepStrictEqual(selectTests(manifest, {gate: "Fast", changed: ["app/src/main/assets/js/app/30-card-import.js"]}).triggeredProbes.map((probe) => probe.id), ["android-smoke", "real-card"]);
assert.deepStrictEqual(base.triggeredProbes, []);

// A test that fails on one of its reruns fails the gate instead of passing on its first run.
const root = path.resolve(__dirname, "../..");
fs.mkdirSync(path.join(root, ".tmp"), {recursive: true});
const flakyDir = fs.mkdtempSync(path.join(root, ".tmp", "stability-"));
try {
  const counter = path.join(flakyDir, "runs.txt");
  const flaky = path.join(flakyDir, "flaky.js");
  fs.writeFileSync(flaky, `const fs = require("fs"); const runs = Number(fs.existsSync(${JSON.stringify(counter)}) ? fs.readFileSync(${JSON.stringify(counter)}, "utf8") : 0) + 1; fs.writeFileSync(${JSON.stringify(counter)}, String(runs)); process.exitCode = runs === 1 ? 1 : 0;`);
  const test = {id: "behavior.flaky-fixture", path: path.relative(root, flaky).replace(/\\/g, "/"), timeoutMs: 30000};
  const results = [{id: test.id, passed: true, reasons: [], elapsedMs: 0}];
  confirmChangedTestsStable(results, {tests: [test], changedTestFiles: [test.id]}, 1).then(() => {
    assert.strictEqual(fs.readFileSync(counter, "utf8"), "1", "the reruns stop at the first failure");
    assert.strictEqual(results[0].passed, false);
    assert.match(results[0].reasons[0], new RegExp("unstable: run 2 of " + STABILITY_RUNS));
  }).finally(() => fs.rmSync(flakyDir, {recursive: true, force: true})).catch((error) => { console.error(error); process.exitCode = 1; });
} catch (error) {
  fs.rmSync(flakyDir, {recursive: true, force: true});
  throw error;
}

// Release must reject partial selectors at the real CLI before executing tests.
const result = spawnSync(process.execPath, ["tools/tests/run_all.js", "--gate", "Release", "--changed", "app/src/main/assets/js/app/50-worldbook.js"], {cwd: path.resolve(__dirname, "../.."), encoding: "utf8"});
assert.strictEqual(result.status, 1);
assert.match(result.stderr, /Release must run the complete/);
console.log("domain selection preserves base, affected domains, new sources, and complete Release");
