import { buildLayoutTree } from "./layoutTree.js";
import { assign, slotOrder } from "./reflow.js";
const EPSILON = 1e-6;
const sameRect = (a, b) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON && Math.abs(a.width - b.width) < EPSILON && Math.abs(a.height - b.height) < EPSILON;

function label(tree, rects, keys) {
  if (tree.kind === "leaf") {
    const index = rects.findIndex((r) => sameRect(r, tree.tile));
    if (index < 0) return null;
    return { kind: "leaf", key: keys[index], tile: tree.tile };
  }
  const first = label(tree.first, rects, keys);
  const second = label(tree.second, rects, keys);
  if (!first || !second) return null;
  return { kind: "split", axis: tree.axis, at: tree.at, first, second };
}

function buildArrangement(base, keys, focused) {
  if (keys.length === 0) return null;
  const splitSlot = focused === void 0 ? -1 : keys.indexOf(focused);
  const rects = assign(
    base,
    keys.length,
    splitSlot >= 0 ? splitSlot : void 0
  );
  const tree = buildLayoutTree(rects);
  return tree ? label(tree, rects, keys) : null;
}

function leaves(tree) {
  if (tree.kind === "leaf") return [tree];
  return [...leaves(tree.first), ...leaves(tree.second)];
}

function arrangementKeys(tree) {
  return leaves(tree).map((leaf) => leaf.key);
}

/**
 * The rectangle of one leaf, by its key.
 *
 * This searches the leaf list, so it costs a walk of the tree per lookup.
 * When the rectangles of many leaves are needed, `arrangementRects` is
 * the one to use.
 */
function arrangementRectOf(tree, key) {
  return leaves(tree).find((leaf) => leaf.key === key)?.tile ?? null;
}

/**
 * Every leaf's rectangle, keyed by the leaf's key, in a single walk of the
 * tree.
 *
 * The rectangles of every window of a workspace are needed at once, and
 * searching the leaf list for each of them in turn means a walk of the
 * whole tree per window. They are collected into a map here instead — one
 * walk, then a constant-time lookup each.
 */
function arrangementRects(tree) {
  const rects = /* @__PURE__ */ new Map();
  const walk = (node) => {
    if (node.kind === "leaf") {
      rects.set(node.key, node.tile);
      return;
    }
    walk(node.first);
    walk(node.second);
  };
  walk(tree);
  return rects;
}

function insertIntoArrangement(tree, at, key) {
  let target = at;
  // The leaves are collected once and used for both the membership test
  // and the fallback pick, rather than walking the tree separately for
  // each of them.
  const all = leaves(tree);
  if (target === void 0 || !all.some((leaf) => leaf.key === target)) {
    target = all[slotOrder(all.map((leaf) => leaf.tile))[0]].key;
  }
  const cut = (node) => {
    if (node.kind === "leaf") {
      if (node.key !== target) return node;
      const r = node.tile;
      if (r.height >= r.width) {
        const mid2 = r.y + r.height / 2;
        return {
          kind: "split",
          axis: "y",
          at: mid2,
          first: { ...node, tile: { ...r, height: r.height / 2 } },
          second: {
            kind: "leaf",
            key,
            tile: { ...r, y: mid2, height: r.height / 2 }
          }
        };
      }
      const mid = r.x + r.width / 2;
      return {
        kind: "split",
        axis: "x",
        at: mid,
        first: { ...node, tile: { ...r, width: r.width / 2 } },
        second: {
          kind: "leaf",
          key,
          tile: { ...r, x: mid, width: r.width / 2 }
        }
      };
    }
    return { ...node, first: cut(node.first), second: cut(node.second) };
  };
  return cut(tree);
}

function swapInArrangement(tree, a, b) {
  const walk = (node) => {
    if (node.kind === "leaf") {
      if (node.key === a) return { ...node, key: b };
      if (node.key === b) return { ...node, key: a };
      return node;
    }
    return { ...node, first: walk(node.first), second: walk(node.second) };
  };
  return walk(tree);
}
export {
  arrangementKeys,
  arrangementRectOf,
  arrangementRects,
  buildArrangement,
  insertIntoArrangement,
  swapInArrangement
};
