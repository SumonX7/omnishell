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

function arrangementRectOf(tree, key) {
  return leaves(tree).find((leaf) => leaf.key === key)?.tile ?? null;
}

function insertIntoArrangement(tree, at, key) {
  let target = at;
  if (target === void 0 || arrangementRectOf(tree, target) === null) {
    const all = leaves(tree);
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
  buildArrangement,
  insertIntoArrangement,
  swapInArrangement
};
