// Test harness for OmniShell dynamic tiling math.
// Runs the pure modules (no GNOME deps) and probes for defects.
import { buildLayoutTree } from './src/components/layout/dynamic/layoutTree.js';
import { assign, reflow, slotOrder, slotUnderPoint, neighbourIndex, leavesOf } from './src/components/layout/dynamic/reflow.js';
import { buildArrangement, insertIntoArrangement, arrangementRectOf, arrangementKeys } from './src/components/layout/dynamic/arrangement.js';
import { pickLayoutIndex, pickLayoutIndexAt } from './src/components/layout/dynamic/pickLayout.js';

const LAYOUTS = [
  { id: 'Layout 1', tiles: [
    {x:0,y:0,width:0.33645833333333336,height:0.5},
    {x:0,y:0.5,width:0.33645833333333336,height:0.5},
    {x:0.33645833333333336,y:0,width:0.32708333333333334,height:0.5},
    {x:0.33645833333333336,y:0.5,width:0.32708333333333334,height:0.5},
    {x:0.6635416666666667,y:0,width:0.33645833333333336,height:0.5},
    {x:0.6635416666666667,y:0.5,width:0.33645833333333336,height:0.5},
  ]},
  { id: 'Layout 2', tiles: [
    {x:0,y:0,width:0.3333333333333333,height:0.49713740458015265},
    {x:0.3333333333333333,y:0,width:0.3333333333333333,height:1},
    {x:0.6666666666666666,y:0,width:0.33333333333333337,height:0.5009541984732825},
    {x:0.6666666666666666,y:0.5009541984732825,width:0.33333333333333337,height:0.4990458015267175},
    {x:0,y:0.49713740458015265,width:0.3333333333333333,height:0.5028625954198473},
  ]},
  { id: 'Layout 4', tiles: [
    {x:0,y:0,width:0.67,height:1},
    {x:0.67,y:0,width:0.33,height:1},
  ]},
];

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL: ' + msg); };
const ok = (msg) => console.log('  ok  : ' + msg);

console.log('=== 1. layout tree build ===');
const trees = LAYOUTS.map(l => ({ id: l.id, tree: buildLayoutTree(l.tiles), n: l.tiles.length }));
for (const t of trees) {
  if (!t.tree) fail(`${t.id}: buildLayoutTree returned null`);
  else ok(`${t.id}: tree built, ${leavesOf(t.tree).length} leaves (tiles=${t.n})`);
}

console.log('\n=== 2. pickLayoutIndex behaviour ===');
const counts = trees.map(t => t.n);
console.log('  tileCounts =', counts.join(','));
for (const wc of [1,2,3,4,5,6,7]) {
  const idx = pickLayoutIndex(counts, wc);
  const picked = trees[idx];
  console.log(`  windowCount=${wc} -> ${picked.id} (${picked.n} tiles)`);
}

console.log('\n=== 3. assign() coverage: does every window get a slot? ===');
for (const t of trees) {
  if (!t.tree) continue;
  for (let wc = 1; wc <= 10; wc++) {
    const rects = assign(t.tree, wc);
    if (rects.length !== wc) {
      fail(`${t.id} wc=${wc}: assign returned ${rects.length} rects, expected ${wc}`);
      continue;
    }
    // every rect must be positive area
    rects.forEach((r, i) => {
      if (!(r.width > 0) || !(r.height > 0))
        fail(`${t.id} wc=${wc} rect[${i}] non-positive size: ${JSON.stringify(r)}`);
    });
    // total area must be ~1.0 of the container (0..1 space)
    const area = rects.reduce((s,r)=>s+r.width*r.height,0);
    if (Math.abs(area - 1) > 0.02)
      fail(`${t.id} wc=${wc}: total area ${area.toFixed(4)} != 1 (rects leak/overlap)`);
  }
}
if (!failures) ok('assign() produced correct count & full-area coverage for all layouts/counts');

console.log('\n=== 4. assign() OVERLAP check (do two windows get the same space?) ===');
for (const t of trees) {
  if (!t.tree) continue;
  for (let wc = 2; wc <= 8; wc++) {
    const rects = assign(t.tree, wc);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i+1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const ox = Math.min(a.x+a.width, b.x+b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y+a.height, b.y+b.height) - Math.max(a.y, b.y);
        if (ox > 1e-9 && oy > 1e-9) {
          fail(`${t.id} wc=${wc}: rects[${i}] and rects[${j}] OVERLAP (${ox.toFixed(4)}x${oy.toFixed(4)})`);
        }
      }
    }
  }
}
ok('overlap scan done');

console.log('\n=== 5. neighbourIndex: keyboard movement (audit E1) ===');
// two abutting tiles horizontally
const two = [
  {x:0,y:0,width:0.5,height:1},
  {x:0.5,y:0,width:0.5,height:1},
];
console.log('  right from 0 ->', neighbourIndex(two, 0, 'right'), '(expect 1)');
console.log('  left  from 1 ->', neighbourIndex(two, 1, 'left'),  '(expect 0)');
if (neighbourIndex(two, 0, 'right') !== 1) fail('E1 CONFIRMED: exact-abutting right neighbour NOT found (keyboard move is a no-op)');
if (neighbourIndex(two, 1, 'left') !== 0) fail('E1 CONFIRMED: exact-abutting left neighbour NOT found');

console.log('\n=== 6. slotUnderPoint boundary (audit E4) ===');
const rects = [
  {x:0,   y:0, width:0.3333333, height:1},
  {x:0.3333333, y:0, width:0.3333333, height:1},
  {x:0.6666666, y:0, width:0.3333334, height:1},
];
for (let px = 0; px < 1920; px += 1) {
  const idx = slotUnderPoint(rects, workArea, {x:px, y:100});
  if (idx < 0 || idx > 2) { fail(`slotUnderPoint px=${px} -> ${idx} (out of range)`); break; }
}
ok('slotUnderPoint stayed in range across the full width');

console.log('\n=== 7. buildArrangement: does every key get a rect? ===');
for (const t of trees) {
  if (!t.tree) continue;
  for (let wc = 1; wc <= 8; wc++) {
    const keys = Array.from({length: wc}, (_, i) => `w${i}`);
    const arr = buildArrangement(t.tree, keys, undefined);
    if (!arr) { fail(`${t.id} wc=${wc}: buildArrangement returned null`); continue; }
    const arrKeys = arrangementKeys(arr);
    for (const k of keys) {
      if (!arrKeys.includes(k)) { fail(`${t.id} wc=${wc}: key ${k} missing from arrangement`); break; }
      const r = arrangementRectOf(arr, k);
      if (!r || !(r.width>0) || !(r.height>0)) { fail(`${t.id} wc=${wc}: key ${k} has bad rect ${JSON.stringify(r)}`); break; }
    }
  }
}
ok('buildArrangement covers all keys');

console.log('\n=== 8. insertIntoArrangement (new window splits focused) ===');
for (const t of trees) {
  if (!t.tree) continue;
  const base = ['w0','w1','w2'];
  const arr0 = buildArrangement(t.tree, base, undefined);
  if (!arr0) continue;
  for (let focusIdx = 0; focusIdx < base.length; focusIdx++) {
    const arr = insertIntoArrangement(arr0, base[focusIdx], 'newcomer');
    const keys = arrangementKeys(arr);
    if (!keys.includes('newcomer')) { fail(`${t.id}: insert lost newcomer (focus=${base[focusIdx]})`); continue; }
    if (keys.length !== base.length + 1) fail(`${t.id}: insert produced ${keys.length} leaves, expected ${base.length+1}`);
    // area check
    const area = keys.reduce((s,k)=>{ const r=arrangementRectOf(arr,k); return s + r.width*r.height; },0);
    if (Math.abs(area-1) > 0.02) fail(`${t.id} focus=${base[focusIdx]}: area after insert = ${area.toFixed(4)} != 1`);
  }
}
ok('insertIntoArrangement checks done');

console.log('\n=== 9. splitSlot nomination (audit E2) ===');
// assign with splitSlot == windowCount-1 (the last slot)
for (const t of trees) {
  if (!t.tree) continue;
  for (let wc = 2; wc <= 6; wc++) {
    const rects = assign(t.tree, wc, wc - 1); // nominate the LAST slot
    if (rects.length !== wc) { fail(`${t.id} wc=${wc}: assign with splitSlot=${wc-1} gave ${rects.length}`); continue; }
  }
}
ok('assign with last-slot splitSlot done (see E2 note below)');

console.log('\n=== SUMMARY ===');
console.log(failures === 0 ? 'NO FAILURES' : `${failures} FAILURES`);
