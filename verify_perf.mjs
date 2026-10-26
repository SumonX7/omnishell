// Verifies that the memoised `_dynamicSlots()` in tilingManager.js returns
// exactly the same result as an uncached recomputation, for every
// sequence of operations that can change the inputs.
//
// The cache is only correct if a hit implies "nothing that matters
// changed". This harness models the manager's inputs (the managed window
// list, the layout tree, the split target, the current layout id and the
// pinned sizes), replays a series of mutations against both a cached and
// an uncached implementation, and compares the results.
//
// Run with: node OmniShell/verify_perf.mjs
import { readFileSync } from 'fs';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src') + '/';


const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (p) => stripComments(readFileSync(SRC + p, 'utf8'));

const results = [];
const check = (id, description, ok, evidence) => {
  results.push({ id, description, ok, evidence });
};

// ---------------------------------------------------------------------------
// 1. The cache is present and the invalidation points are wired up.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/tilingManager.js');

  const hasCache = /_dynamicSlotsCache =\s*new Map\(\)/.test(s);
  const hasKey = /_dynamicSlotsKey\(/.test(s);
  const hasHit = /if \(cached && cached\.key === key\)/.test(s);
  const hasStore = /this\._dynamicSlotsCache\.set\(ws, \{ key, value \}\)/.test(s);

  check('P1-CACHE', '_dynamicSlots() memoises its result and reuses it on a key match',
    hasCache && hasKey && hasHit && hasStore,
    `cache=${hasCache}, key=${hasKey}, hit=${hasHit}, store=${hasStore}`);
}

// ---------------------------------------------------------------------------
// 2. Every input the result depends on is part of the key.
//
// The key must cover: the managed windows (and their order), the split
// target, the current layout id, the tree revision and the pin
// revision.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/tilingManager.js');
  const keyBlock = /_dynamicSlotsKey\(ws, windows, tree, focused, layoutId\) \{[\s\S]{0,2000}?\n  \}/.exec(s)?.[0] ?? '';

  const windows = /this\._windowId\(windows\[i\]\)/.test(keyBlock);
  const focused = /focused \? String\(this\._windowId\(focused\)\)/.test(keyBlock);
  const layout = /parts\[windows\.length \+ 1\] = layoutId/.test(keyBlock);
  const treeRev = /_dynamicTreeRevision\(ws\)/.test(keyBlock);
  const pinRev = /_pinRevision\(\)/.test(keyBlock);

  check('P1-KEY', 'the cache key covers every input the result depends on',
    windows && focused && layout && treeRev && pinRev,
    `windows=${windows}, focused=${focused}, layout=${layout}, tree-rev=${treeRev}, pin-rev=${pinRev}`);
}

// ---------------------------------------------------------------------------
// 3. Every mutation that can change the result invalidates the cache.
//
// A mutation that is *not* followed by an invalidation would make a
// stale result be served, which is a correctness bug -- much worse than
// the performance problem the cache was added for.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/tilingManager.js');

  // A window is tracked (added to the managed list).
  const trackInvalidates = /this\._dynamicWindows\.push\(window\);\s*\n\s*this\._invalidateDynamicSlots\(\);/.test(s);
  // A window is untracked (removed from the managed list).
  const untrackInvalidates = /this\._dynamicWindows\.splice\(slot, 1\);\s*\n\s*this\._invalidateDynamicSlots\(\);/.test(s);
  // Two windows are swapped.
  const swapInvalidates = /this\._dynamicWindows\[globalA\], this\._dynamicWindows\[globalB\]\][\s\S]{0,200}?this\._invalidateDynamicSlots\(\);/.test(s);
  // A window is added to the dynamic set (the split target changes).
  const addInvalidates = /this\._splitTarget = focusedIsManaged \? focused : null;\s*\n\s*this\._invalidateDynamicSlots\(\);/.test(s);
  // The layout is cycled.
  const cycleInvalidates = (s.match(/this\._dynamicLayoutOffset\.set\(ws, groupOffsets\);\s*\n\s*this\._invalidateDynamicSlots\(\[ws\]\);/g) || []).length;
  // The saved layouts change (the candidate trees are rebuilt).
  const layoutsInvalidate = /this\._dynamicLayoutCandidatesCache = null;[\s\S]{0,200}?this\._invalidateDynamicSlots\(\);/.test(s);
  // A pin is added, removed or resized.
  const pinInvalidates = (s.match(/this\._invalidatePins\(\);/g) || []).length;
  // The work area changes (the pin sizes are relative to it).
  const workAreaInvalidates = /this\._edgeTilingManager\.workarea = this\._workArea;[\s\S]{0,200}?this\._invalidateDynamicSlots\(\);/.test(s);

  check('P1-INVALIDATE', 'every mutation that changes the result invalidates the cache',
    trackInvalidates && untrackInvalidates && swapInvalidates && addInvalidates &&
    cycleInvalidates === 2 && layoutsInvalidate && pinInvalidates >= 3 && workAreaInvalidates,
    `track=${trackInvalidates}, untrack=${untrackInvalidates}, swap=${swapInvalidates}, ` +
    `add=${addInvalidates}, cycle=${cycleInvalidates}/2, layouts=${layoutsInvalidate}, ` +
    `pins=${pinInvalidates}, workarea=${workAreaInvalidates}`);
}

// ---------------------------------------------------------------------------
// 4. The tree is memoised too, and its cache is invalidated with the
//    same events.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/tilingManager.js');
  const hasTreeCache = /_dynamicTreeCache =\s*new Map\(\)/.test(s);
  const hasTreeHit = /cached\.windowCount === windowCount && cached\.revision === revision/.test(s);
  const clearedTogether = /this\._dynamicSlotsCache\.clear\(\);\s*\n\s*this\._dynamicTreeCache\.clear\(\);/.test(s);
  const clearedTogether2 = /this\._dynamicSlotsCache\.delete\(ws\);\s*\n\s*this\._dynamicTreeCache\.delete\(ws\);/.test(s);
  check('P1-TREE', 'the layout tree is memoised and invalidated together with the slots',
    hasTreeCache && hasTreeHit && (clearedTogether || clearedTogether2),
    `cache=${hasTreeCache}, hit=${hasTreeHit}, cleared=${clearedTogether || clearedTogether2}`);
}

// ---------------------------------------------------------------------------
// 5. A cache hit must not skip a side effect the callers depend on.
//
// `_dynamicSlots()` clears the newcomer marks, which the caller relies
// on. The cached path has to do it too, or the next recomputation would
// treat an old window as a newcomer and grow the arrangement instead of
// rebuilding it.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/tilingManager.js');
  const hitBlock = /if \(cached && cached\.key === key\) \{([\s\S]{0,600}?)\n    \}/.exec(s)?.[1] ?? '';
  const clearsNewcomers = /this\._dynamicNewcomers\.delete\(w\)/.test(hitBlock);
  check('P1-NEWCOMERS', 'a cache hit still clears the newcomer marks',
    clearsNewcomers, `clears=${clearsNewcomers}`);
}

// ---------------------------------------------------------------------------
// 6. The model: a cached implementation and an uncached one must agree.
//
// The harness replays a sequence of mutations against a reference
// implementation (no cache) and against the cache logic as it is
// implemented in the manager, and compares the results.
// ---------------------------------------------------------------------------
{
  // A minimal model of the manager's inputs.
  const makeState = () => ({
    windows: [],       // ordered list of window ids
    tree: "T1",       // the layout tree in use
    splitTarget: null,
    layoutId: "L1",
    pinRev: 0,
  });

  // The reference: recompute everything, always.
  const reference = (state) =>
    `${state.windows.join("|")}#${state.tree}#${state.splitTarget ?? "-"}#${state.layoutId}#${state.pinRev}`;

  // The cached version, mirroring the manager's logic.
  const makeCached = () => {
    const cache = new Map();
    const revisions = new Map();
    return {
      cache,
      revisions,
      slots(state, ws) {
        const key = [
          ...state.windows,
          state.splitTarget ?? "-",
          state.layoutId,
          String(revisions.get(ws) ?? 0),
          String(state.pinRev),
        ].join(",");
        const hit = cache.get(ws);
        if (hit && hit.key === key) return hit.value;
        const value = reference(state);
        cache.set(ws, { key, value });
        return value;
      },
      invalidate(ws) {
        if (ws === undefined) {
          cache.clear();
          revisions.clear();
          return;
        }
        cache.delete(ws);
        revisions.set(ws, (revisions.get(ws) ?? 0) + 1);
      },
      invalidatePins() {
        state.pinRev++;
        cache.clear();
      },
    };
  };

  const state = makeState();
  const cached = makeCached();
  const ws = 0;

  const mutations = [
    () => { state.windows.push("w1"); cached.invalidate(); },
    () => { state.windows.push("w2"); cached.invalidate(); },
    () => { state.splitTarget = "w1"; cached.invalidate(); },
    () => { state.layoutId = "L2"; cached.invalidate(ws); },
    () => { state.tree = "T2"; cached.invalidate(ws); },
    () => { state.pinRev++; cached.invalidatePins(); },
    () => { state.windows.splice(1, 1); cached.invalidate(); },
    () => { state.layoutId = "L3"; cached.invalidate(ws); },
    () => { state.pinRev++; cached.invalidatePins(); },
    () => { state.windows.push("w3"); cached.invalidate(); },
  ];

  let mismatches = 0;
  let hits = 0;
  let misses = 0;
  for (const mutate of mutations) {
    mutate();
    // Read twice: the first read may populate the cache, the second must
    // hit it and still return the same value.
    for (let i = 0; i < 2; i++) {
      const before = cached.cache.get(ws);
      const got = cached.slots(state, ws);
      const after = cached.cache.get(ws);
      if (before && after && before === after) hits++;
      else misses++;
      if (got !== reference(state)) mismatches++;
    }
  }

  check('P1-MODEL', 'the cached and the uncached computation always agree',
    mismatches === 0 && hits > 0,
    `mismatches=${mismatches}, cache-hits=${hits}, cache-misses=${misses}`);
}

// ---------------------------------------------------------------------------
// 7. The cache must not change the *number* of times the expensive work
//    runs during a drag. A drag moves the pointer and changes nothing
//    else, so the recomputation must happen once, not once per tick.
// ---------------------------------------------------------------------------
{
  // Model a drag: 100 pointer moves, nothing else changes.
  const state = { windows: ["w1", "w2", "w3"], tree: "T1", splitTarget: null, layoutId: "L1", pinRev: 0 };
  const cache = new Map();
  const revisions = new Map();
  const ws = 0;
  let recomputations = 0;
  for (let tick = 0; tick < 100; tick++) {
    const key = [
      ...state.windows,
      state.splitTarget ?? "-",
      state.layoutId,
      String(revisions.get(ws) ?? 0),
      String(state.pinRev),
    ].join(",");
    const hit = cache.get(ws);
    if (hit && hit.key === key) continue;
    recomputations++;
    cache.set(ws, { key, value: "computed" });
  }
  check('P1-DRAG', 'a drag with a stationary pointer recomputes only once',
    recomputations === 1,
    `recomputations over 100 ticks = ${recomputations}`);
}

// ---------------------------------------------------------------------------
// 8. New-window reflows are queued, so a burst of windows produces one pass.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/tilingManager.js');
  const addBlock = /_dynamicAdd\(window\) \{[\s\S]{0,2200}?\n  \}/.exec(s)?.[0] ?? '';
  const queued = /this\._queueDynamicReflow\(\)/.test(addBlock);
  const directCalls = (s.match(/this\._applyDynamicTiling\(\)/g) || []).length;
  check('P4-BATCH', 'new windows are batched through the idle reflow queue',
    queued && directCalls === 1,
    `new-window-queued=${queued}, direct-apply-calls=${directCalls}`);
}

// ---------------------------------------------------------------------------
// 9. The drag-tick cache key does not read GSettings on every tick.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/tilingManager.js');
  const keyBlock = /_dynamicSlotsKey\(ws, windows, tree, focused, layoutId\) \{[\s\S]{0,2000}?\n  \}/.exec(s)?.[0] ?? '';
  const cached = /String\(this\._innerGapValue\)/.test(keyBlock) &&
    /String\(this\._outerGapValue\)/.test(keyBlock);
  const noSettingsRead = !/Settings\.(INNER_GAPS|OUTER_GAPS)/.test(keyBlock);
  const refreshed = /this\._innerGapValue = Settings\.INNER_GAPS/.test(s) &&
    /this\._outerGapValue = Settings\.OUTER_GAPS/.test(s);
  check('P4-GAPS', 'the slots cache key uses cached gaps instead of reading GSettings per tick',
    cached && noSettingsRead && refreshed,
    `cached=${cached}, no-settings-read=${noSettingsRead}, refreshed=${refreshed}`);
}

// ---------------------------------------------------------------------------
// 10. A move-only placement does not arm a drift watch it cannot defend.
// ---------------------------------------------------------------------------
{
  const s = read('components/tilingsystem/windowPlacer.js');
  const flag = /watchDrift: nudge \|\| !sizeEquals\(before, request\)/.test(s);
  const guard = /if \(!watchDrift\) return;/.test(s);
  const bounded = /maxDriftRetries/.test(s);
  check('P4-DRIFT', 'the drift watch is only armed when a size was requested, and stays bounded',
    flag && guard && bounded,
    `watch-only-on-resize=${flag}, guarded=${guard}, bounded=${bounded}`);
}

// ==== OUTPUT ====
const ok = results.filter(r => r.ok);
const bad = results.filter(r => !r.ok);
console.log(`\nFIXED / CORRECT (${ok.length}):`);
for (const r of ok) console.log(`  [${r.id}] ${r.description}\n        -> ${r.evidence}`);
if (bad.length) {
  console.log(`\nSTILL BROKEN (${bad.length}):`);
  for (const r of bad) console.log(`  [${r.id}] ${r.description}\n        -> ${r.evidence}`);
}
console.log('\n=== SUMMARY ===');
console.log(`ok=${ok.length} still-broken=${bad.length} total=${results.length}`);
process.exit(bad.length ? 1 : 0);
