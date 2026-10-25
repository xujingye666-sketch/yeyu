// Preserve source macro spans through derived script edits; evaluation and alignment run in a Worker.
function installYeyuRisuHistory(g) {
  'use strict';
  function equalRuns(before, after) {
    if (before === after) return [{ left: 0, right: 0, length: before.length }];
    let left = 0,
      right = 0;
    const equals = [];
    for (const part of g.YeyuTextDiff.diffChars(before, after)) {
      if (!part.added && !part.removed) equals.push({ left, right, length: part.value.length });
      if (!part.added) left += part.value.length;
      if (!part.removed) right += part.value.length;
    }
    return equals;
  }
  function remap(before, after, spans, runs) {
    const equals = runs || equalRuns(before, after);
    return spans.flatMap((span) => {
      const match = equals.find((eq) => span.start >= eq.left && span.end <= eq.left + eq.length);
      return match
        ? [{ ...span, start: match.right + span.start - match.left, end: match.right + span.end - match.left }]
        : [];
    });
  }
  function retainedTemplate(before, after, trace) {
    const nodes = [];
    function visit(rows, actual, offset, parent) {
      const joined = rows.map((row) => row.text).join(''),
        runs = equalRuns(joined, actual);
      let at = 0;
      for (const row of rows) {
        const id = nodes.length;
        const span = {
          start: at,
          end: at + row.text.length,
          source: row.source,
          macro: row.macro,
          parent,
          id,
          sourceStart: row.start,
          sourceEnd: row.end,
          children: row.children.length,
        };
        const mapped = remap(joined, actual, [span], runs)[0];
        if (mapped) {
          mapped.start += offset;
          mapped.end += offset;
          nodes.push(mapped);
          if (row.children.length) visit(row.children, row.text, mapped.start, id);
        }
        at += row.text.length;
      }
    }
    visit(trace, before, 0, -1);
    const hunks = [];
    let oldOffset = 0,
      active;
    for (const part of g.YeyuTextDiff.diffChars(before, after)) {
      if (!part.added && !part.removed) {
        oldOffset += part.value.length;
        active = null;
        continue;
      }
      if (!active) {
        active = { start: oldOffset, end: oldOffset, text: '' };
        hunks.push(active);
      }
      if (part.removed) {
        oldOffset += part.value.length;
        active.end = oldOffset;
      } else active.text += part.value;
    }
    const retained = remap(before, after, nodes).filter((row) => row.macro);
    for (const block of nodes.filter((row) => row.macro && row.children)) {
      if (retained.some((row) => row.id === block.id)) continue;
      const edits = hunks.filter((h) => h.end > block.start && h.start < block.end);
      if (!edits.length || edits.some((h) => h.start < block.start || h.end > block.end)) continue;
      const patches = [];
      const macroEdits = new Map();
      let safe = true;
      for (const edit of edits) {
        const leaves = nodes.filter(
          (row) =>
            (!row.macro || !row.children) &&
            row.start <= edit.start &&
            row.end >= edit.end &&
            row.sourceStart >= block.sourceStart &&
            row.sourceEnd <= block.sourceEnd
        );
        if (leaves.length !== 1) {
          safe = false;
          break;
        }
        const leaf = leaves[0];
        if (
          nodes.filter((row) => row.sourceStart === leaf.sourceStart && row.sourceEnd === leaf.sourceEnd).length !== 1
        ) {
          safe = false;
          break;
        }
        if (leaf.macro && leaf.source !== before.slice(leaf.start, leaf.end)) {
          if (!macroEdits.has(leaf)) macroEdits.set(leaf, []);
          macroEdits.get(leaf).push(edit);
          continue;
        }
        patches.push({
          start: leaf.sourceStart - block.sourceStart + edit.start - leaf.start,
          end: leaf.sourceStart - block.sourceStart + edit.end - leaf.start,
          text: edit.text,
        });
      }
      if (!safe) continue;
      // An edited expansion becomes this leaf's literal result; its enclosing condition and
      // unrelated macros remain dynamic. Aggregate edits before replacing the one source span.
      for (const [leaf, changes] of macroEdits) {
        let text = before.slice(leaf.start, leaf.end);
        for (const edit of changes.sort((a, b) => b.start - a.start))
          text = text.slice(0, edit.start - leaf.start) + edit.text + text.slice(edit.end - leaf.start);
        patches.push({ start: leaf.sourceStart - block.sourceStart, end: leaf.sourceEnd - block.sourceStart, text });
      }
      let source = block.source;
      for (const patch of patches.sort((a, b) => b.start - a.start))
        source = source.slice(0, patch.start) + patch.text + source.slice(patch.end);
      const shift = (pos) =>
        hunks.filter((h) => h.end <= pos).reduce((sum, h) => sum + h.text.length - (h.end - h.start), 0);
      retained.push({ ...block, source, start: block.start + shift(block.start), end: block.end + shift(block.end) });
    }
    retained.sort((a, b) => a.start - b.start || b.end - a.end || a.id - b.id);
    let out = '',
      at = 0;
    const used = new Set();
    for (const span of retained) {
      if (/\{\{\s*(?:slot|tempvar|gettempvar)(?:::|:|\s)/i.test(span.source)) {
        let ancestor = span.parent,
          requiresScope = false;
        while (ancestor >= 0) {
          if (/^\{\{#each\b/.test(nodes[ancestor].source) && !used.has(ancestor)) requiresScope = true;
          ancestor = nodes[ancestor].parent;
        }
        if (requiresScope) continue;
      }
      let parent = span.parent,
        owned = false;
      while (parent >= 0) {
        if (used.has(parent)) {
          owned = true;
          break;
        }
        parent = nodes[parent].parent;
      }
      if (owned || span.start < at) continue;
      out += after.slice(at, span.start) + span.source;
      at = span.end;
      used.add(span.id);
    }
    return out + after.slice(at);
  }

  function mapOffset(before, after, offset) {
    let left = 0,
      right = 0;
    for (const part of g.YeyuTextDiff.diffChars(before, after)) {
      if (left >= offset) return right;
      if (part.added) {
        right += part.value.length;
        continue;
      }
      if (left + part.value.length >= offset) return part.removed ? right : right + offset - left;
      left += part.value.length;
      if (!part.removed) right += part.value.length;
    }
    return right;
  }
  g.YeyuRisuHistory = Object.freeze({ retainTemplate: retainedTemplate, mapOffset: mapOffset });
}
installYeyuRisuHistory(typeof window !== 'undefined' ? window : globalThis);
(typeof window !== 'undefined' ? window : globalThis).YeyuRisuHistoryInstaller = installYeyuRisuHistory;
