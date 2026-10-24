const EPSILON = 1e-6;

function buildLayoutTree(tiles) {
  if (tiles.length === 0) return null;
  if (tiles.length === 1) return { kind: "leaf", tile: tiles[0] };
  for (const axis of ["x", "y"]) {
    const extent = axis === "x" ? "width" : "height";
    const candidates = [
      ...new Set(tiles.map((t) => t[axis] + t[extent]))
    ].sort((a, b) => a - b);
    for (const at of candidates) {
      const before = tiles.filter(
        (t) => t[axis] + t[extent] <= at + EPSILON
      );
      const after = tiles.filter((t) => t[axis] >= at - EPSILON);
      if (before.length + after.length !== tiles.length) continue;
      if (before.length === 0 || after.length === 0) continue;
      const first = buildLayoutTree(before);
      if (!first) continue;
      const second = buildLayoutTree(after);
      if (!second) continue;
      return { kind: "split", axis, at, first, second };
    }
  }
  return null;
}

function pathOf(tree, target) {
  function walk(node, path) {
    if (node.kind === "leaf") {
      if (target.x >= node.tile.x - EPSILON && target.y >= node.tile.y - EPSILON && target.x + target.width <= node.tile.x + node.tile.width + EPSILON && target.y + target.height <= node.tile.y + node.tile.height + EPSILON) {
        return path;
      }
      return null;
    }
    return walk(node.first, [...path, "first"]) || walk(node.second, [...path, "second"]);
  }
  return walk(tree, []);
}

function rectAtPath(tree, path) {
  let node = tree;
  for (const dir of path) {
    if (node.kind === "leaf") return null;
    node = node[dir];
  }
  return node.kind === "leaf" ? node.tile : treeBounds(node);
}

function leafCount(tree) {
  if (tree.kind === "leaf") return 1;
  return leafCount(tree.first) + leafCount(tree.second);
}

function treeBounds(tree) {
  if (tree.kind === "leaf") return tree.tile;
  const first = treeBounds(tree.first);
  const second = treeBounds(tree.second);
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y
  };
}

function applyBounds(tree, bounds) {
  if (tree.kind === "leaf") return { kind: "leaf", tile: bounds };
  const { axis, at, first, second } = tree;
  const oldBounds = treeBounds(tree);
  const extentProp = axis === "x" ? "width" : "height";
  const startProp = axis === "x" ? "x" : "y";
  let ratio = 0.5;
  if (oldBounds[extentProp] > EPSILON) {
    ratio = (at - oldBounds[startProp]) / oldBounds[extentProp];
  }
  const newAt = bounds[startProp] + bounds[extentProp] * ratio;
  const firstBounds = { ...bounds };
  firstBounds[extentProp] = newAt - bounds[startProp];
  const secondBounds = { ...bounds };
  secondBounds[startProp] = newAt;
  secondBounds[extentProp] = bounds[startProp] + bounds[extentProp] - newAt;
  return {
    kind: "split",
    axis,
    at: newAt,
    first: applyBounds(first, firstBounds),
    second: applyBounds(second, secondBounds)
  };
}

function subtreeFloor(node, path, axis, leafFloor) {
  if (node.kind === "leaf") return leafFloor(path);
  const first = subtreeFloor(node.first, [...path, "first"], axis, leafFloor);
  const second = subtreeFloor(
    node.second,
    [...path, "second"],
    axis,
    leafFloor
  );
  return node.axis === axis ? first + second : Math.max(first, second);
}

function pinLeaf(tree, path, actualExtent, axis, leafFloor = () => 0) {
  const MIN_SIBLING_FRACTION = 0.05;
  const extentProp = axis === "x" ? "width" : "height";
  const startProp = axis === "x" ? "x" : "y";

  function walk(node, pathIndex) {
    if (node.kind === "leaf" || pathIndex >= path.length) {
      return { tree: node, requestedExtent: actualExtent };
    }
    const dir = path[pathIndex];
    const child = node[dir];
    const { tree: newChild, requestedExtent } = walk(child, pathIndex + 1);
    if (node.axis === axis) {
      const oldBounds = treeBounds(node);
      const oldExtent = oldBounds[extentProp];
      const minSize = MIN_SIBLING_FRACTION * oldExtent;
      const siblingDir = dir === "first" ? "second" : "first";
      const siblingFloor = Math.max(
        minSize,
        subtreeFloor(
          node[siblingDir],
          [...path.slice(0, pathIndex), siblingDir],
          axis,
          leafFloor
        )
      );
      let newAt = node.at;
      let myRequestedExtent = oldExtent;
      if (dir === "first") {
        newAt = oldBounds[startProp] + requestedExtent;
        let clampedAt = newAt;
        if (clampedAt > oldBounds[startProp] + oldExtent - siblingFloor) {
          clampedAt = oldBounds[startProp] + oldExtent - siblingFloor;
        }
        if (clampedAt < oldBounds[startProp] + minSize) {
          clampedAt = oldBounds[startProp] + minSize;
        }
        // The two clamps above can conflict: when the requested extent is
        // larger than the available space, the "at least minSize" clamp can
        // push `clampedAt` past the sibling floor, and the sibling extent
        // computed below would then become negative -- an inverted rect
        // that Mtk.Rectangle happily accepts. The first half is therefore
        // additionally clamped so that the sibling keeps at least
        // `siblingFloor` of extent.
        const maxFirstExtent = oldExtent - siblingFloor;
        if (maxFirstExtent < minSize) {
          // Not even one minimum-size half fits next to the sibling; give
          // the whole extent to the first half and let the sibling keep
          // its floor (handled by the caller clamping the result).
          clampedAt = oldBounds[startProp] + Math.max(0, oldExtent);
        } else if (clampedAt > oldBounds[startProp] + maxFirstExtent) {
          clampedAt = oldBounds[startProp] + maxFirstExtent;
        }
        const achievedExtent = clampedAt - oldBounds[startProp];
        if (achievedExtent < requestedExtent - EPSILON) {
          myRequestedExtent = requestedExtent + siblingFloor;
        }
        const firstBounds = { ...oldBounds };
        firstBounds[extentProp] = clampedAt - oldBounds[startProp];
        const secondBounds = { ...oldBounds };
        secondBounds[startProp] = clampedAt;
        secondBounds[extentProp] = oldExtent - firstBounds[extentProp];
        const newNode = {
          kind: "split",
          axis,
          at: clampedAt,
          first: applyBounds(newChild, firstBounds),
          second: applyBounds(node.second, secondBounds)
        };
        return { tree: newNode, requestedExtent: myRequestedExtent };
      } else {
        newAt = oldBounds[startProp] + oldExtent - requestedExtent;
        let clampedAt = newAt;
        if (clampedAt < oldBounds[startProp] + siblingFloor) {
          clampedAt = oldBounds[startProp] + siblingFloor;
        }
        if (clampedAt > oldBounds[startProp] + oldExtent - minSize) {
          clampedAt = oldBounds[startProp] + oldExtent - minSize;
        }
        const achievedExtent = oldBounds[startProp] + oldExtent - clampedAt;
        if (achievedExtent < requestedExtent - EPSILON) {
          myRequestedExtent = requestedExtent + siblingFloor;
        }
        const firstBounds = { ...oldBounds };
        firstBounds[extentProp] = clampedAt - oldBounds[startProp];
        const secondBounds = { ...oldBounds };
        secondBounds[startProp] = clampedAt;
        secondBounds[extentProp] = oldExtent - firstBounds[extentProp];
        const newNode = {
          kind: "split",
          axis,
          at: clampedAt,
          first: applyBounds(node.first, firstBounds),
          second: applyBounds(newChild, secondBounds)
        };
        return { tree: newNode, requestedExtent: myRequestedExtent };
      }
    } else {
      const newNode = {
        kind: "split",
        axis: node.axis,
        at: node.at,
        first: dir === "first" ? newChild : node.first,
        second: dir === "second" ? newChild : node.second
      };
      return { tree: newNode, requestedExtent };
    }
  }
  const { tree: newTree } = walk(tree, 0);
  return applyBounds(newTree, treeBounds(tree));
}
export {
  buildLayoutTree,
  leafCount,
  pathOf,
  pinLeaf,
  rectAtPath
};
