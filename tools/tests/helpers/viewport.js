"use strict";

function createViewportReadingHelpers(page, origin) {
  async function locateReadingAt(label, offset) {
    const placed = await page.evaluate(({label, offset}) => {
      const ct = document.getElementById("chat-messages");
      const walker = document.createTreeWalker(ct, NodeFilter.SHOW_TEXT);
      let node = null;
      while ((node = walker.nextNode())) {
        if (String(node.data || "").includes(label)) break;
      }
      if (!node || !node.parentElement) return {ok: false};
      const el = node.parentElement;
      const cr = ct.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      ct.scrollTop = Math.max(0, ct.scrollTop + (r.top - cr.top) - offset);
      ct.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch"}));
      if (typeof noteChatViewportUserIntent === "function") noteChatViewportUserIntent();
      ct.dispatchEvent(new Event("scroll", {bubbles: true}));
      return Object.assign({ok: true, offset}, window.__probe("placed"));
    }, {label, offset});
    return placed;
  }

  async function queueSse(text, extras) {
    const params = new URLSearchParams(Object.assign({text, step: "3", delay: "14"}, extras || {}));
    await page.evaluate(url => { window.__sseQueue.push(url); }, `${origin}/sse?${params.toString()}`);
  }

  return {locateReadingAt, queueSse};
}

module.exports = {createViewportReadingHelpers};
