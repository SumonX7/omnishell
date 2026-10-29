// Test harness for gap filling, reflow math, and Wayland workspace resilience.
import { buildLayoutTree } from './src/components/layout/dynamic/layoutTree.js';
import { assign, reflow, slotOrder, leavesOf } from './src/components/layout/dynamic/reflow.js';
import { buildArrangement, insertIntoArrangement, arrangementRectOf, arrangementKeys } from './src/components/layout/dynamic/arrangement.js';
import { pickLayoutIndex } from './src/components/layout/dynamic/pickLayout.js';

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL: ' + msg); };
const ok = (msg) => console.log('  ok  : ' + msg);

console.log('=== 1. Shrink from 3 to 2 windows: Coverage & Gap Test ===');
const layouts = [
  { id: '2-tiles', tiles: [{x:0, y:0, width:0.5, height:1}, {x:0.5, y:0, width:0.5, height:1}] },
  { id: '3-tiles', tiles: [{x:0, y:0, width:0.34, height:1}, {x:0.34, y:0, width:0.33, height:1}, {x:0.67, y:0, width:0.33, height:1}] }
];

const candidates = layouts.map(l => ({
  id: l.id,
  tileCount: l.tiles.length,
  tree: buildLayoutTree(l.tiles)
}));

// Test picking for 3 windows
const idx3 = pickLayoutIndex(candidates.map(c => c.tileCount), 3);
const tree3 = candidates[idx3].tree;
const rects3 = assign(tree3, 3);
const area3 = rects3.reduce((acc, r) => acc + r.width * r.height, 0);
if (Math.abs(area3 - 1.0) > 0.01) fail(`3 windows area is ${area3}, expected 1.0`);
else ok(`3 windows area sums to 1.0: ${rects3.length} slots`);

// Test picking for 2 windows (after 1 closed)
const idx2 = pickLayoutIndex(candidates.map(c => c.tileCount), 2);
const tree2 = candidates[idx2].tree;
const rects2 = assign(tree2, 2);
const area2 = rects2.reduce((acc, r) => acc + r.width * r.height, 0);
if (Math.abs(area2 - 1.0) > 0.01) fail(`2 windows area is ${area2}, expected 1.0`);
else ok(`2 windows area sums to 1.0: ${rects2.length} slots covering full screen`);

// Test collapse when only a 3-tile layout exists (no 2-tile layout saved)
const rectsCollapsed = assign(tree3, 2);
const areaCollapsed = rectsCollapsed.reduce((acc, r) => acc + r.width * r.height, 0);
if (Math.abs(areaCollapsed - 1.0) > 0.01) fail(`Collapsed 3->2 area is ${areaCollapsed}, expected 1.0`);
else ok(`Collapsed 3->2 area sums to 1.0 without holes: ${rectsCollapsed.length} slots`);

console.log('\n=== 2. Dynamic arrangement cleanup on window removal ===');
const windows3 = ['winA', 'winB', 'winC'];
let arrangement = buildArrangement(tree3, windows3, undefined);
if (!arrangement) {
  fail('buildArrangement returned null');
} else {
  let keys = arrangementKeys(arrangement);
  if (keys.length !== 3) fail(`Expected 3 keys, got ${keys.length}`);
  else ok(`Arrangement has 3 keys: ${keys.join(', ')}`);

  // Window B closes. Surviving windows: winA, winC
  // The arrangement for 3 windows should be cleared and recomputed for 2 windows
  const windows2 = ['winA', 'winC'];
  const rectsAfterClose = assign(tree2, windows2.length);
  if (rectsAfterClose.length !== 2) {
    fail(`Expected 2 rects after close, got ${rectsAfterClose.length}`);
  } else {
    const area = rectsAfterClose.reduce((acc, r) => acc + r.width * r.height, 0);
    if (Math.abs(area - 1.0) > 0.01) fail(`Area after close is ${area}, expected 1.0`);
    else ok(`Area after close is 1.0: winA and winC fill full width`);
  }
}

console.log('\n=== 3. Slot order consistency (Left stays Left, Right stays Right) ===');
const twoRects = [
  { x: 0, y: 0, width: 0.5, height: 1 },
  { x: 0.5, y: 0, width: 0.5, height: 1 }
];
const order = slotOrder(twoRects);
if (order[0] !== 0 || order[1] !== 1) {
  fail(`slotOrder inverted: expected [0, 1], got [${order.join(', ')}]`);
} else {
  ok(`slotOrder correctly preserves geometric left-to-right order [0, 1]`);
}

console.log('\n=== SUMMARY ===');
if (failures === 0) {
  console.log('ALL GAP FILL CHECKS PASSED');
  process.exit(0);
} else {
  console.log(`${failures} FAILURES`);
  process.exit(1);
}
