"use strict";

function capturePageDiagnostics(page, options = {}) {
  const pageErrors = [];
  const consoleErrors = [];
  const ignoreFavicon = options.ignoreFavicon === true;
  const appendUrl = options.appendUrl === true;
  const captureConsole = options.captureConsole !== false;
  const ignoreConsoleError = options.ignoreConsoleError;
  const formatConsoleError = options.formatConsoleError;

  page.on("pageerror", error => pageErrors.push(String(error && error.stack || error)));
  if (captureConsole) {
    page.on("console", message => {
      if (message.type() !== "error") return;
      const needsUrl = ignoreFavicon || appendUrl || typeof formatConsoleError === "function";
      const url = needsUrl ? String(message.location() && message.location().url || "") : "";
      if (ignoreFavicon && /favicon\.ico$/.test(url)) return;
      if (typeof ignoreConsoleError === "function" && ignoreConsoleError(message, url)) return;
      consoleErrors.push(typeof formatConsoleError === "function" ? formatConsoleError(message, url) : appendUrl ? message.text() + " @ " + url : message.text());
    });
  }
  return {pageErrors, consoleErrors};
}

module.exports = {capturePageDiagnostics};
