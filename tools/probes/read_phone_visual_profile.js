'use strict';

// Read-only native measurements. Run with Yeyu foreground, portrait, keyboard closed.
// Outputs only display metrics; does not save activity dumps, chat data or device serials.
const {execFileSync} = require('child_process');
const path = require('path');
const adb = process.env.ADB_PATH || path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const serial = process.argv[2];
const run = (...args) => execFileSync(adb, [...(serial ? ['-s', serial] : []), ...args], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}).trim();
const density = run('shell', 'wm', 'density');
const size = run('shell', 'wm', 'size');
const activity = run('shell', 'dumpsys', 'activity', 'com.yeyu.app');
const dp = [...activity.matchAll(/\bw(\d+)dp h(\d+)dp (\d+)dpi/g)].pop();
const view = [...activity.matchAll(/android\.webkit\.WebView\{[^\r\n]*? (\d+),(\d+)-(\d+),(\d+)/g)].pop();
const bar = type => {
  const m = [...activity.matchAll(new RegExp('type=' + type + ' frame=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\] visible=true', 'g'))].pop();
  return m ? Number(m[4]) - Number(m[2]) : null;
};
const dpi = Number((density.match(/Override density:\s*(\d+)/) || density.match(/Physical density:\s*(\d+)/) || [])[1]);
const pixels = size.match(/(?:Override|Physical) size:\s*(\d+)x(\d+)/g)?.pop()?.match(/(\d+)x(\d+)/);
const top = bar('statusBars'), bottom = bar('navigationBars');
if (!dp || !view || !dpi || !pixels || top == null || bottom == null) throw new Error('Incomplete native metrics: open Yeyu in portrait with keyboard closed and rerun.');
console.log(JSON.stringify({
  model: run('shell', 'getprop', 'ro.product.model'), build: run('shell', 'getprop', 'ro.build.display.id'),
  physicalPixels: {width: Number(pixels[1]), height: Number(pixels[2])}, effectiveDensityDpi: dpi,
  fontScale: Number(run('shell', 'settings', 'get', 'system', 'font_scale')),
  nativeWindowDp: {width: Number(dp[1]), height: Number(dp[2])},
  nativeWebViewPixels: {width: Number(view[3]) - Number(view[1]), height: Number(view[4]) - Number(view[2])},
  systemBarPixels: {top, bottom},
  inferredBrowser: {viewport: {width: Number(dp[1]), height: Number(dp[2])}, deviceScaleFactor: dpi / 160, safeTop: Math.round(top / (dpi / 160)), safeBottom: Math.round(bottom / (dpi / 160))},
  cssViewportDirectlyMeasured: false
}, null, 2));
