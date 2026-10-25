"use strict";

// index.html assigns D only after IndexedDB loads, and stream-draft recovery runs after that;
// tests that seed or read app state must wait for both instead of `typeof D === "object"`, which also holds for null.
async function waitForAppReady(page, options = {}) {
  await page.waitForFunction(
    () => typeof D === "object" && D !== null && typeof _streamDraftsLoaded !== "undefined" && _streamDraftsLoaded === true,
    null,
    options
  );
  await page.evaluate(() => _streamDraftLoadPromise);
}

module.exports = {waitForAppReady};
