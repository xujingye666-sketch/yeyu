"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "tools", "tests", "test_manifest.json");
const testDir = path.join(root, "tools", "tests");


function insideRoot(relative) {
  const resolved = path.resolve(root, relative);
  const fromRoot = path.relative(root, resolved);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) throw new Error("path escapes repository: " + relative);
  return resolved;
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 3 || !manifest.profiles || !manifest.domains || !Array.isArray(manifest.sharedPaths) || !Array.isArray(manifest.tests)) throw new Error("test manifest schemaVersion=3, profiles, domains, sharedPaths, and tests are required");
  const ids = new Set(), paths = new Set();
  for (const [name, profile] of Object.entries(manifest.profiles)) {
    for (const key of ["environment", "timeoutMs", "parallel"]) {
      if (!(key in profile)) throw new Error("profile " + name + " missing " + key);
    }
    if (!["node", "browser"].includes(profile.environment) || !Number.isInteger(profile.timeoutMs) || profile.timeoutMs < 1 || typeof profile.parallel !== "boolean") throw new Error("profile " + name + " has invalid execution metadata");
  }
  for (const [name, domain] of Object.entries(manifest.domains)) {
    if (!Array.isArray(domain.paths) || !domain.paths.length || domain.paths.some((entry) => typeof entry !== "string" || !entry)) throw new Error("domain " + name + " needs path patterns");
    if ((domain.related || []).some((entry) => !manifest.domains[entry])) throw new Error("domain " + name + " has unknown related domain");
  }
  for (const [name, probe] of Object.entries(manifest.probes || {})) {
    if (!probe || typeof probe.entry !== "string" || !fs.existsSync(insideRoot(probe.entry)) || typeof probe.when !== "string" || !probe.when) throw new Error("probe " + name + " needs an existing entry and a trigger description");
    const paths = probe.paths || [], domains = probe.domains || [];
    if (!paths.length && !domains.length) throw new Error("probe " + name + " needs paths or domains");
    if (paths.some((entry) => typeof entry !== "string" || !entry) || domains.some((entry) => !manifest.domains[entry])) throw new Error("probe " + name + " has an invalid path or unknown domain");
  }
  for (const test of manifest.tests) {
    if (!test || typeof test.id !== "string" || !test.id || typeof test.path !== "string" || !manifest.profiles[test.profile]) throw new Error("test manifest entry needs id, path, and known profile");
    if (!/^behavior\.[a-z][a-z0-9-]*$/.test(test.id) || /^behavior\.(?:issue|vc)\d/.test(test.id)) throw new Error("test id must describe stable behavior, not a historical issue or version: " + test.id);
    if (ids.has(test.id) || paths.has(test.path)) throw new Error("duplicate test id or path: " + test.id + " / " + test.path);
    if (!fs.existsSync(insideRoot(test.path))) throw new Error("declared test is missing: " + test.path);
    if (!manifest.domains[test.domain]) throw new Error("test " + test.id + " needs a known domain");
    if (!["data", "main", "boundary", "compat"].includes(test.keep)) throw new Error("test " + test.id + " needs a permanent-test category");
    for (const key of ["gate", "environment", "timeoutMs", "parallel"]) {
      if (!(key in test)) continue;
      const value = test[key];
      if ((key === "gate" && !["fast", "full"].includes(value)) ||
        (key === "environment" && !["node", "browser"].includes(value)) ||
        (key === "timeoutMs" && (!Number.isInteger(value) || value < 1)) ||
        (key === "parallel" && typeof value !== "boolean")) throw new Error("test " + test.id + " has invalid " + key + " override");
    }
    ids.add(test.id); paths.add(test.path);
  }
  const discovered = fs.readdirSync(testDir).filter((name) => name.endsWith(".js") && !["run_all.js", "source.js"].includes(name)).map((name) => "tools/tests/" + name).sort();
  const declaredInTestDir = [...paths].filter((entry) => entry.startsWith("tools/tests/")).sort();
  if (JSON.stringify(discovered) !== JSON.stringify(declaredInTestDir)) throw new Error("test manifest must declare every tools/tests/*.js test exactly once");
  return manifest;
}

if (require.main === module) {
  try {
    const manifest = readManifest();
    console.log(JSON.stringify({testManifestValid: true, tests: manifest.tests.length}));
  } catch (error) {
    console.error(String(error.message || error));
    process.exitCode = 1;
  }
}

module.exports = { insideRoot, readManifest };
