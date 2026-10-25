#!/usr/bin/env node
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { insideRoot, readManifest } = require("../qa/test_manifest");

const root = path.resolve(__dirname, "../..");
const nodeArgs = ["--unhandled-rejections=strict", "--max-old-space-size=512"];
const maxOutputBytes = 8 * 1024 * 1024;

function usage() {
  return "Usage: node tools/tests/run_all.js [--gate Fast|Release] [--changed path[,path]] [--test id|path] [--jobs number] [--list]";
}

function parseArgs(argv) {
  const options = { gate: "Release", changed: [], tests: [], jobs: Math.min(4, Math.max(1, os.cpus().length)), list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { console.log(usage()); process.exit(0); }
    if (arg === "--list") { options.list = true; continue; }
    const value = argv[index + 1];
    if (!["--gate", "--changed", "--test", "--jobs"].includes(arg) || value == null) throw new Error("invalid argument: " + arg);
    index += 1;
    if (arg === "--gate") {
      if (!["Fast", "Release"].includes(value)) throw new Error("--gate must be Fast or Release");
      options.gate = value;
    } else if (arg === "--jobs") {
      options.jobs = Math.max(1, Math.min(8, Number(value)));
      if (!Number.isInteger(options.jobs)) throw new Error("--jobs must be an integer from 1 to 8");
    } else {
      const values = value.split(",").map((item) => item.trim()).filter(Boolean);
      if (arg === "--test") options.tests.push(...values);
      else options.changed.push(...values);
    }
  }
  return options;
}

function pathMatches(changed, sourcePath) {
  const left = changed.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  const right = sourcePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
}

function matchesPattern(changed, pattern) {
  const normalized = changed.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!pattern.includes("*")) return pathMatches(normalized, pattern);
  const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + expression + "$").test(normalized);
}

function enforceCliSelectorGate(options) {
  if (options.gate === "Fast" || !options.changed.length) return;
  const error = new Error("--changed is supported only with --gate Fast; Release must run the complete declared regression set");
  error.scheduler = { gate: options.gate, requestedChangedPaths: options.changed };
  throw error;
}

function selectTests(manifest, options) {
  const hasSelector = options.changed.length;
  const expanded = manifest.tests.map((test) => Object.assign({gate: "full"}, manifest.profiles[test.profile], test));
  const requestedIds = new Set((options.tests || []).map((requested) => {
    const normalized = requested.replace(/\\/g, "/");
    const candidate = path.resolve(root, normalized.includes("/") ? normalized : "tools/tests/" + normalized);
    const test = expanded.find((entry) => entry.id === requested || !path.relative(path.resolve(root, entry.path), candidate));
    if (!test) throw new Error("test is not declared in the manifest: " + requested);
    return test.id;
  }));
  const changedPathMatches = options.changed.map((changed) => {
    const normalized = changed.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const direct = expanded.filter((test) => pathMatches(normalized, test.path));
    if (direct.length) return {changed, tests: direct};
    if (normalized === "tools/tests/test_manifest.json") return {changed, tests: expanded.filter((test) => test.domain === "tooling")};
    if (normalized.startsWith("tools/tests/") && !fs.existsSync(path.join(root, normalized))) {
      return {changed, tests: [], ignored: true};
    }
    const domains = Object.entries(manifest.domains).filter(([, domain]) =>
      domain.paths.some((pattern) => matchesPattern(normalized, pattern)));
    const selectedDomains = new Set(domains.flatMap(([name, domain]) => [name, ...(domain.related || [])]));
    const shared = manifest.sharedPaths.some((pattern) => matchesPattern(normalized, pattern));
    // Unclassified and shared sources run the full retained set, including newly added files.
    const tests = shared || !domains.length ? expanded : expanded.filter((test) => selectedDomains.has(test.domain));
    return {changed, tests, fallback: !shared && !domains.length};
  });
  const matchedChangedPaths = changedPathMatches.filter((entry) => entry.tests.length).map((entry) => entry.changed);
  const ignoredChangedPaths = changedPathMatches.filter((entry) => entry.ignored).map((entry) => entry.changed);
  const fallbackChangedPaths = changedPathMatches.filter((entry) => entry.fallback).map((entry) => entry.changed);
  const matchedChangedTests = [...new Set(changedPathMatches.flatMap((entry) => entry.tests.map((test) => test.id)))].sort();
  const matchedChangedTestIds = new Set(matchedChangedTests);
  const changedTestFiles = expanded.filter((test) => options.changed.some((changed) => pathMatches(changed, test.path))).map((test) => test.id).sort();
  const selected = expanded.filter((test) => {
    if (requestedIds.has(test.id)) return true;
    const selectedByChange = !options.changed.length || matchedChangedTestIds.has(test.id);
    if (!hasSelector) return options.gate === "Fast" ? test.gate === "fast" : true;
    return selectedByChange || (options.gate === "Fast" && test.gate === "fast");
  });
  if (!selected.length) throw new Error("no tests match the requested selector");
  return { tests: selected, fallbackChangedPaths, matchedChangedTests, matchedChangedPaths, ignoredChangedPaths, changedTestFiles, triggeredProbes: triggeredProbes(manifest, options.changed) };
}

// Probes stay outside the deterministic gate; a change that reaches what they verify names them in the summary.
function triggeredProbes(manifest, changed) {
  return Object.entries(manifest.probes || {}).filter(([, probe]) => changed.some((entry) =>
    (probe.paths || []).some((pattern) => matchesPattern(entry, pattern)) ||
    (probe.domains || []).some((name) => manifest.domains[name].paths.some((pattern) => matchesPattern(entry, pattern)))))
    .map(([id, probe]) => ({ id, entry: probe.entry, when: probe.when }));
}

function runOne(test) {
  const file = insideRoot(test.path);
  const startedAt = process.hrtime.bigint();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...nodeArgs, file], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false, overflow = false;
    let termination = null;
    function terminateTree() {
      if (termination || !child.pid) return;
      termination = new Promise((done) => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", (error) => { stderr += "process tree cleanup failed: " + error.message; child.kill(); done(); });
        killer.once("close", () => done());
      });
    }
    const append = (current, chunk) => {
      const next = current + chunk;
      if (Buffer.byteLength(next, "utf8") > maxOutputBytes) { overflow = true; terminateTree(); }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, String(chunk)); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, String(chunk)); });
    const timer = setTimeout(() => { timedOut = true; terminateTree(); }, test.timeoutMs);
    child.on("error", (error) => finish({ error }));
    child.on("close", (code, signal) => finish({ code, signal }));
    let completed = false;
    async function finish(outcome) {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (termination) await termination;
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const reasons = [];
      if (timedOut) reasons.push("timeout " + test.timeoutMs + "ms");
      if (overflow) reasons.push("output exceeds " + (maxOutputBytes / 1024 / 1024) + "MiB");
      if (outcome.error) reasons.push("process error: " + outcome.error.message);
      if (outcome.signal) reasons.push("signal " + outcome.signal);
      if (outcome.code !== 0) reasons.push("exit " + outcome.code);
      if (stderr) reasons.push("stderr");
      resolve({ id: test.id, path: test.path, domain: test.domain, environment: test.environment, elapsedMs: Math.round(elapsedMs), passed: !reasons.length, reasons, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() });
    }
  });
}

async function runPool(tests, jobs, results, onResult) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, tests.length) }, async () => {
    while (cursor < tests.length) {
      const test = tests[cursor++];
      const result = await runOne(test);
      results.push(result);
      onResult(result);
    }
  }));
}

async function execute(tests, jobs, onResult) {
  const serial = tests.filter((test) => !test.parallel);
  const parallelNode = tests.filter((test) => test.parallel && test.environment !== "browser");
  const parallelBrowser = tests.filter((test) => test.parallel && test.environment === "browser");
  const results = [];
  const phases = {};
  let startedAt = process.hrtime.bigint();
  for (const test of serial) {
    const result = await runOne(test);
    results.push(result);
    onResult(result);
  }
  phases.serialMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  startedAt = process.hrtime.bigint();
  await runPool(parallelNode, jobs, results, onResult);
  phases.nodeParallelMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  startedAt = process.hrtime.bigint();
  await runPool(parallelBrowser, jobs, results, onResult);
  phases.browserParallelMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  return { results: tests.map((test) => results.find((result) => result.id === test.id)), phases };
}

// A test added or edited in this change runs again before it is trusted: one that only passes some of the
// time fails Fast here, not later as an unexplained red in someone else's run.
const STABILITY_RUNS = 3;

async function confirmChangedTestsStable(results, selection, jobs) {
  const startedAt = process.hrtime.bigint();
  const pending = selection.tests.filter((test) => selection.changedTestFiles.includes(test.id) && results.find((result) => result.id === test.id).passed);
  async function rerun(test) {
    const result = results.find((entry) => entry.id === test.id);
    for (let run = 2; run <= STABILITY_RUNS; run += 1) {
      const repeat = await runOne(test);
      if (repeat.passed) continue;
      Object.assign(result, { passed: false, reasons: ["unstable: run " + run + " of " + STABILITY_RUNS + " failed", ...repeat.reasons], stdout: repeat.stdout, stderr: repeat.stderr });
      reportResult(result);
      return;
    }
  }
  // Tests the manifest keeps serial are rerun one at a time, as in the main run.
  for (const test of pending.filter((entry) => entry.parallel === false)) await rerun(test);
  const parallel = pending.filter((entry) => entry.parallel !== false);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, parallel.length) }, async () => {
    while (cursor < parallel.length) await rerun(parallel[cursor++]);
  }));
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
}

function reportResult(result) {
  console.log("[" + (result.passed ? "PASS" : "FAIL") + "] " + result.id + " (" + result.elapsedMs + " ms)");
  if (!result.passed) {
    for (const reason of result.reasons) console.log("  reason: " + reason);
    if (result.stdout) console.log("  [stdout]\\n" + result.stdout);
    if (result.stderr) console.log("  [stderr]\\n" + result.stderr);
  }
}

function reportProbes(selection) {
  for (const probe of selection.triggeredProbes) console.log("[PROBE] " + probe.id + ": " + probe.entry + " — " + probe.when);
}

function reportSelection(selection, options) {
  console.log("Preview only: " + selection.tests.length + " tests selected; no tests were run and no gate passed.");
  for (const test of selection.tests) console.log("[SELECTED] " + test.id + " (" + test.path + ")");
  reportProbes(selection);
  console.log("TEST_SUMMARY_JSON=" + JSON.stringify({
    schemaVersion: 2,
    kind: "yeyu-test-selection-summary",
    gate: options.gate,
    previewOnly: true,
    executed: false,
    gatePassed: false,
    selected: selection.tests.length,
    domains: [...new Set(selection.tests.map((test) => test.domain))].sort(),
    matchedChangedTests: selection.matchedChangedTests,
    matchedChangedPaths: selection.matchedChangedPaths,
    ignoredChangedPaths: selection.ignoredChangedPaths,
    fallbackChangedPaths: selection.fallbackChangedPaths,
    stabilityCheckedTests: options.gate === "Fast" ? selection.changedTestFiles : [],
    triggeredProbes: selection.triggeredProbes,
    tests: selection.tests.map((test) => ({ id: test.id, path: test.path, domain: test.domain, environment: test.environment }))
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  enforceCliSelectorGate(options);
  const manifest = readManifest();
  const selection = selectTests(manifest, options);
  if (options.list) {
    reportSelection(selection, options);
    return;
  }
  const execution = await execute(selection.tests, options.jobs, reportResult);
  const results = execution.results;
  if (options.gate === "Fast" && results.every((result) => result.passed)) execution.phases.stabilityMs = await confirmChangedTestsStable(results, selection, options.jobs);
  reportProbes(selection);
  const summary = { schemaVersion: 2, kind: "yeyu-test-summary", gate: options.gate, selected: results.length, passed: results.filter((result) => result.passed).length, failed: results.filter((result) => !result.passed).length, jobs: options.jobs, phases: execution.phases, domains: [...new Set(results.map((result) => result.domain))].sort(), matchedChangedTests: selection.matchedChangedTests, matchedChangedPaths: selection.matchedChangedPaths, ignoredChangedPaths: selection.ignoredChangedPaths, fallbackChangedPaths: selection.fallbackChangedPaths, stabilityRuns: STABILITY_RUNS, stabilityCheckedTests: options.gate === "Fast" ? selection.changedTestFiles : [], triggeredProbes: selection.triggeredProbes, results: results.map(({ stdout, stderr, ...result }) => result) };
  console.log("TEST_SUMMARY_JSON=" + JSON.stringify(summary));
  process.exitCode = summary.failed ? 1 : 0;
}

if (require.main === module) main().catch((error) => {
  console.error("Test scheduler failed: " + (error.stack || error.message || error));
  const selection = error.selection || {};
  const scheduler = error.scheduler || {};
  console.log("TEST_SUMMARY_JSON=" + JSON.stringify({ schemaVersion: 2, kind: "yeyu-test-summary", gate: scheduler.gate, failed: 1, matchedChangedTests: selection.matchedChangedTests || [], matchedChangedPaths: selection.matchedChangedPaths || [], ignoredChangedPaths: selection.ignoredChangedPaths || [], requestedChangedPaths: scheduler.requestedChangedPaths || [], schedulerError: String(error.message || error) }));
  process.exitCode = 1;
});

module.exports = { readManifest, selectTests, runOne, confirmChangedTestsStable, STABILITY_RUNS };
