function pickLayoutIndex(tileCounts, windowCount) {
  if (tileCounts.length === 0) return -1;
  const exact = tileCounts.indexOf(windowCount);
  if (exact >= 0) return exact;
  let roomier = -1;
  for (let i = 0; i < tileCounts.length; i++) {
    if (tileCounts[i] <= windowCount) continue;
    if (roomier < 0 || tileCounts[i] < tileCounts[roomier]) roomier = i;
  }
  if (roomier >= 0) return roomier;
  let roomiest = 0;
  for (let i = 1; i < tileCounts.length; i++) {
    if (tileCounts[i] > tileCounts[roomiest]) roomiest = i;
  }
  return roomiest;
}

function pickLayoutIndexAt(tileCounts, windowCount, offset) {
  const picked = pickLayoutIndex(tileCounts, windowCount);
  if (picked < 0) return -1;
  const group = tileCounts.map((count, index) => ({ count, index })).filter((entry) => entry.count === tileCounts[picked]).map((entry) => entry.index);
  const position = group.indexOf(picked);
  const wrapped = (offset % group.length + group.length) % group.length;
  return group[(position + wrapped) % group.length];
}
export {
  pickLayoutIndex,
  pickLayoutIndexAt
};
