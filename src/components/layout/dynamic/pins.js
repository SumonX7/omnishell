import { buildLayoutTree, pathOf, pinLeaf, rectAtPath } from "./layoutTree.js";
const EPSILON = 1e-9;
const readBack = (tree, rects, paths) => rects.map((r, i) => rectAtPath(tree, paths[i]) ?? r);
const unsatisfied = (rects, pins) => pins.filter((pin) => {
  const r = rects[pin.slot];
  if (!r) return false;
  return pin.minWidth !== void 0 && r.width < pin.minWidth - EPSILON || pin.minHeight !== void 0 && r.height < pin.minHeight - EPSILON;
});

function applyPins(rects, pins) {
  if (unsatisfied(rects, pins).length === 0) return rects;
  let tree = buildLayoutTree(rects);
  if (!tree) return rects;
  const paths = rects.map((r) => pathOf(tree, r));
  if (paths.some((p) => p === null)) return rects;
  // `pathOf` matches a leaf by *containment* rather than by identity, so two
  // nested rects can resolve to the very same leaf path. The `floors` map is
  // keyed by that path, so the second pin would silently overwrite the
  // first and the earlier minimum size would never be enforced. Detect the
  // collision and bail out instead of applying an inconsistent set of pins.
  const seenPaths = new Set();
  for (const path of paths) {
    const key = path.join("/");
    if (seenPaths.has(key)) return rects;
    seenPaths.add(key);
  }
  const floors = /* @__PURE__ */ new Map();
  for (const pin of pins) {
    const path = paths[pin.slot];
    if (path) floors.set(path.join("/"), pin);
  }
  const widthFloor = (p) => Math.min(floors.get(p.join("/"))?.minWidth ?? 0, 1);
  const heightFloor = (p) => Math.min(floors.get(p.join("/"))?.minHeight ?? 0, 1);
  let current = rects;
  for (let pass = 0; pass < 4; pass++) {
    const needed = unsatisfied(current, pins);
    if (needed.length === 0) break;
    for (const pin of needed) {
      const path = paths[pin.slot];
      const leaf = rectAtPath(tree, path);
      if (!leaf) continue;
      if (pin.minWidth !== void 0 && leaf.width < pin.minWidth - EPSILON)
        tree = pinLeaf(
          tree,
          path,
          Math.min(pin.minWidth, 1),
          "x",
          widthFloor
        );
      const grown = rectAtPath(tree, path);
      if (grown && pin.minHeight !== void 0 && grown.height < pin.minHeight - EPSILON)
        tree = pinLeaf(
          tree,
          path,
          Math.min(pin.minHeight, 1),
          "y",
          heightFloor
        );
    }
    current = readBack(tree, rects, paths);
  }
  return current;
}
export {
  applyPins
};
