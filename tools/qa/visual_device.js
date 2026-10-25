'use strict';

const profile = require('../fixtures/visual_device_profile.json');

function visualDevice(reference = false) {
  if (reference) return {id: 'reference-390x844', browserContext: {viewport: {width: 390, height: 844}, deviceScaleFactor: 1, hasTouch: true}, nativeSafeAreaCss: {top: 0, bottom: 0}};
  return profile;
}

async function installNativeSafeArea(page, device) {
  await page.addInitScript(({top, bottom}) => {
    const apply = () => {
      document.documentElement.style.setProperty('--native-safe-top', top + 'px');
      document.documentElement.style.setProperty('--native-safe-bottom', bottom + 'px');
    };
    if (document.documentElement) apply();
    else document.addEventListener('DOMContentLoaded', apply, {once: true});
  }, device.nativeSafeAreaCss);
}

module.exports = {visualDevice, installNativeSafeArea};
