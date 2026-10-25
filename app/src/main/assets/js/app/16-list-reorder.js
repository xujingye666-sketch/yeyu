// Long-press drag reordering for a vertical list its owner renders. The list element stays bound across
// re-renders (events are delegated); rows are re-read on every grab. The controller only moves rows visually
// and reports the drop as (row, fromPosition, toPosition) among the rows matched by rowSelector; the owner
// applies the move to its own model and re-renders.
var LIST_REORDER_PRESS_MS = 450,
  LIST_REORDER_SLOP_PX = 8,
  LIST_REORDER_EDGE_PX = 56,
  LIST_REORDER_MAX_SCROLL_PX = 14;

function listReorderHapticTick() {
  var bridge = window.AndroidBridge;
  if (!bridge || typeof bridge.hapticLongPress !== 'function') return;
  try {
    bridge.hapticLongPress();
  } catch (_) {}
}
function listReorderScrollParent(node) {
  for (var current = node.parentElement; current; current = current.parentElement) {
    var overflow = getComputedStyle(current).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && current.scrollHeight > current.clientHeight) return current;
  }
  return document.scrollingElement || document.documentElement;
}
// Where a lifted row lands: past every row whose midpoint its own midpoint has crossed.
function listReorderTargetPosition(tops, heights, from, center) {
  var to = from;
  for (var after = from + 1; after < tops.length && tops[after] + heights[after] / 2 < center; after++) to = after;
  for (var before = from - 1; before >= 0 && tops[before] + heights[before] / 2 > center; before--) to = before;
  return to;
}

// options: rowSelector, ignoreSelector (controls that keep their own gestures), canGrab(row), onDrop(row, from, to).
function bindListReorder(list, options) {
  var press = null,
    drag = null,
    settling = false,
    suppressClick = false;

  function setRowOffset(row, offset) {
    row.style.translate = offset ? '0 ' + offset + 'px' : '';
  }
  function stopListening() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }
  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
    if (!drag) stopListening();
  }
  function grab() {
    var row = press.row,
      startY = press.y;
    press = null;
    if (!row.isConnected) return stopListening();
    var rows = Array.from(list.querySelectorAll(options.rowSelector)),
      from = rows.indexOf(row),
      scroller = listReorderScrollParent(list),
      base = scroller.scrollTop - scroller.getBoundingClientRect().top;
    if (from < 0) return stopListening();
    var tops = [],
      heights = [];
    rows.forEach(function (item) {
      var rect = item.getBoundingClientRect();
      tops.push(rect.top + base);
      heights.push(rect.height);
    });
    var next = from + 1 < rows.length ? tops[from + 1] - (tops[from] + heights[from]) : 0,
      previous = from > 0 ? tops[from] - (tops[from - 1] + heights[from - 1]) : 0;
    drag = {
      row: row,
      rows: rows,
      from: from,
      to: from,
      tops: tops,
      heights: heights,
      slot: heights[from] + Math.max(0, from + 1 < rows.length ? next : previous),
      scroller: scroller,
      startY: startY,
      startScroll: scroller.scrollTop,
      pointerY: startY,
      frame: 0,
    };
    list.classList.add('is-reordering');
    row.classList.add('is-reorder-dragging');
    suppressClick = true;
    listReorderHapticTick();
    drag.frame = requestAnimationFrame(autoScroll);
  }
  function updateDrag() {
    if (!drag.row.isConnected) return finishDrag(false);
    var offset = drag.pointerY - drag.startY + (drag.scroller.scrollTop - drag.startScroll),
      from = drag.from,
      to = listReorderTargetPosition(drag.tops, drag.heights, from, drag.tops[from] + drag.heights[from] / 2 + offset);
    setRowOffset(drag.row, offset);
    if (to === drag.to) return;
    drag.to = to;
    drag.rows.forEach(function (item, index) {
      if (index === from) return;
      var shift = index > from && index <= to ? -drag.slot : index < from && index >= to ? drag.slot : 0;
      setRowOffset(item, shift);
    });
  }
  function autoScroll() {
    if (!drag) return;
    var scroller = drag.scroller,
      rect =
        scroller === document.scrollingElement || scroller === document.documentElement
          ? { top: 0, bottom: window.innerHeight, height: window.innerHeight }
          : scroller.getBoundingClientRect(),
      edge = Math.min(LIST_REORDER_EDGE_PX, rect.height / 4),
      depth =
        drag.pointerY < rect.top + edge
          ? -(rect.top + edge - drag.pointerY)
          : drag.pointerY > rect.bottom - edge
            ? drag.pointerY - (rect.bottom - edge)
            : 0;
    if (depth) {
      var before = scroller.scrollTop;
      scroller.scrollTop = before + Math.sign(depth) * Math.ceil(LIST_REORDER_MAX_SCROLL_PX * Math.min(1, Math.abs(depth) / edge));
      if (scroller.scrollTop !== before) updateDrag();
    }
    if (drag) drag.frame = requestAnimationFrame(autoScroll);
  }
  // The lifted row glides into its slot, then the owner commits the move and re-renders in place.
  function finishDrag(commit) {
    var ending = drag;
    drag = null;
    stopListening();
    cancelAnimationFrame(ending.frame);
    var from = ending.from,
      to = commit ? ending.to : from,
      row = ending.row,
      landing =
        to > from
          ? ending.tops[to] + ending.heights[to] - (ending.tops[from] + ending.heights[from])
          : to < from
            ? ending.tops[to] - ending.tops[from]
            : 0;
    if (!commit)
      ending.rows.forEach(function (item) {
        if (item !== row) setRowOffset(item, 0);
      });
    row.classList.remove('is-reorder-dragging');
    row.classList.add('is-reorder-settling');
    setRowOffset(row, landing);
    settling = true;
    var done = function () {
      settling = false;
      list.classList.remove('is-reordering');
      row.classList.remove('is-reorder-settling');
      ending.rows.forEach(function (item) {
        setRowOffset(item, 0);
      });
      if (to !== from && row.isConnected) options.onDrop(row, from, to);
    };
    var duration = row.isConnected ? uiMotionDuration('--motion-normal') : 0;
    if (duration) setTimeout(done, duration);
    else done();
  }

  function onPointerDown(event) {
    if (press || drag || settling || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    var row = event.target.closest(options.rowSelector);
    if (!row || !list.contains(row) || event.target.closest(options.ignoreSelector) || !options.canGrab(row)) return;
    press = {
      row: row,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(grab, LIST_REORDER_PRESS_MS),
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }
  function onPointerMove(event) {
    if (press && event.pointerId === press.pointerId) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LIST_REORDER_SLOP_PX) cancelPress();
      return;
    }
    if (!drag) return;
    event.preventDefault();
    drag.pointerY = event.clientY;
    updateDrag();
  }
  function onPointerUp() {
    if (press) return cancelPress();
    if (drag) finishDrag(true);
  }
  function onPointerCancel() {
    if (press) return cancelPress();
    if (drag) finishDrag(false);
  }

  list.addEventListener('pointerdown', onPointerDown);
  // Once a row is lifted the finger drives the row, not the page: no scrolling, callout or text selection.
  list.addEventListener(
    'touchmove',
    function (event) {
      if (drag && event.cancelable) event.preventDefault();
    },
    { passive: false }
  );
  list.addEventListener('contextmenu', function (event) {
    if (press || drag || suppressClick) event.preventDefault();
  });
  list.addEventListener(
    'click',
    function (event) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}
