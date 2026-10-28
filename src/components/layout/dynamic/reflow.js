function boundsOf(tree) {
  if (tree.kind === "leaf") return tree.tile;
  const first = boundsOf(tree.first);
  const second = boundsOf(tree.second);
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y
  };
}

function reflow(tree, windowCount, focusedIndex) {
  if (windowCount <= 1) return [boundsOf(tree)];
  const leaves = leavesOf(tree);
  if (windowCount === leaves.length) return leaves;
  if (windowCount > leaves.length)
    return subdivide(leaves, windowCount, focusedIndex);
  const split = tree;
  const firstTiles = leavesOf(split.first).length;
  let toFirst = Math.round(windowCount * firstTiles / leaves.length);
  toFirst = Math.max(1, Math.min(windowCount - 1, toFirst));
  return [
    ...reflow(split.first, toFirst),
    ...reflow(split.second, windowCount - toFirst)
  ];
}

function subdivide(leaves, windowCount, focusedIndex) {
  const rects = [...leaves];
  let target = focusedIndex !== void 0 && focusedIndex >= 0 && focusedIndex < rects.length ? focusedIndex : void 0;
  while (rects.length < windowCount) {
    let widest = 0;
    for (let i = 1; i < rects.length; i++) {
      if (areaOf(rects[i]) > areaOf(rects[widest])) widest = i;
    }
    if (target !== void 0) {
      widest = target;
      target = void 0;
    }
    const r = rects[widest];
    const halves = r.height >= r.width ? [
      { ...r, height: r.height / 2 },
      { ...r, y: r.y + r.height / 2, height: r.height / 2 }
    ] : [
      { ...r, width: r.width / 2 },
      { ...r, x: r.x + r.width / 2, width: r.width / 2 }
    ];
    rects.splice(widest, 1, ...halves);
  }
  return rects;
}
const areaOf = (r) => r.width * r.height;

function assign(tree, windowCount, splitSlot) {
  if (windowCount <= 0) return [];
  const leaves = leavesOf(tree);
  if (windowCount <= leaves.length) {
    const rects = reflow(tree, windowCount);
    return slotOrder(rects).map((index) => rects[index]);
  }
  const slots = slotOrder(leaves).map((index) => leaves[index]);
  // The nominated split slot used to be rejected when it equalled
  // `windowCount - 1`:
  //
  //   splitSlot < windowCount - 1
  //
  // The last slot is exactly the one that must be split when the window
  // count grows, so the nomination was dropped and `assign()` split the
  // *widest* leaf instead -- halving the wrong window.
  const nominated = splitSlot !== void 0 && splitSlot >= 0 && splitSlot < windowCount ? splitSlot : void 0;
  while (slots.length < windowCount) {
    let target = slots.length === windowCount - 1 ? nominated : void 0;
    if (target === void 0 || target >= slots.length) {
      target = 0;
      for (let i = 1; i < slots.length; i++) {
        if (areaOf(slots[i]) > areaOf(slots[target])) target = i;
      }
    }
    const r = slots[target];
    if (r.height >= r.width) {
      slots[target] = { ...r, height: r.height / 2 };
      slots.push({ ...r, y: r.y + r.height / 2, height: r.height / 2 });
    } else {
      slots[target] = { ...r, width: r.width / 2 };
      slots.push({ ...r, x: r.x + r.width / 2, width: r.width / 2 });
    }
  }
  return slots;
}

function neighbourIndex(rects, from, direction) {
  const start = rects[from];
  if (!start) return -1;
  const horizontal = direction === "left" || direction === "right";
  const startNear = horizontal ? start.x : start.y;
  const startFar = startNear + (horizontal ? start.width : start.height);
  let best = -1;
  let bestGap = Number.MAX_VALUE;
  rects.forEach((rect, index) => {
    if (index === from) return;
    const near = horizontal ? rect.x : rect.y;
    const far = near + (horizontal ? rect.width : rect.height);
    const gap = direction === "right" || direction === "down" ? near - startFar : startNear - far;
    if (gap < -1e-9) return;
    const aNear = horizontal ? start.y : start.x;
    const aFar = aNear + (horizontal ? start.height : start.width);
    const bNear = horizontal ? rect.y : rect.x;
    const bFar = bNear + (horizontal ? rect.height : rect.width);
    if (Math.min(aFar, bFar) - Math.max(aNear, bNear) <= 1e-9) return;
    if (gap < bestGap - 1e-9) {
      best = index;
      bestGap = gap;
    } else if (Math.abs(gap - bestGap) <= 1e-9 && best >= 0) {
      const current = rects[best];
      if (rect.y < current.y - 1e-9 || Math.abs(rect.y - current.y) <= 1e-9 && rect.x < current.x)
        best = index;
    }
  });
  return best;
}

function slotOrder(rects) {
  return rects.map((_, index) => index).sort((a, b) => {
    const ra = rects[a];
    const rb = rects[b];
    const areaA = areaOf(ra);
    const areaB = areaOf(rb);
    const maxArea = Math.max(areaA, areaB);
    // If tiles have nearly equal area (within 5% tolerance), keep natural
    // geometric reading order (top-to-bottom, left-to-right) so Left stays Left
    // and Right stays Right without crossover inversion.
    if (maxArea > 0 && Math.abs(areaB - areaA) / maxArea > 0.05) {
      return areaB - areaA;
    }
    if (Math.abs(ra.y - rb.y) > 1e-4)
      return ra.y - rb.y;
    return ra.x - rb.x;
  });
}

function leavesOf(tree) {
  if (tree.kind === "leaf") return [tree.tile];
  return [...leavesOf(tree.first), ...leavesOf(tree.second)];
}

function slotUnderPoint(rects, workArea, point) {
  return rects.findIndex((r) => {
    const x = Math.round(workArea.x + r.x * workArea.width);
    const y = Math.round(workArea.y + r.y * workArea.height);
    // The exclusive far edge is computed from the *far side* of the slot
    // rather than by adding a separately rounded width. Rounding the width
    // independently can overshoot the true right edge by up to one pixel,
    // so a point one pixel into the next slot would match both slots and
    // `findIndex` would return the earlier one.
    const right = Math.round(workArea.x + (r.x + r.width) * workArea.width);
    const bottom = Math.round(workArea.y + (r.y + r.height) * workArea.height);
    return point.x >= x && point.x < right && point.y >= y && point.y < bottom;
  });
}

function nearestSlotUnderPoint(rects, workArea, point) {
  if (!rects || rects.length === 0) return -1;
  let best = -1;
  let bestDistSq = Number.MAX_VALUE;
  rects.forEach((r, idx) => {
    const cx = workArea.x + (r.x + r.width / 2) * workArea.width;
    const cy = workArea.y + (r.y + r.height / 2) * workArea.height;
    const dx = point.x - cx;
    const dy = point.y - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = idx;
    }
  });
  return best;
}

export {
  assign,
  leavesOf,
  neighbourIndex,
  reflow,
  slotOrder,
  slotUnderPoint,
  nearestSlotUnderPoint
};

