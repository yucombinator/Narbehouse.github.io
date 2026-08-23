// Pure meadow-lifecycle transitions. No three.js, DOM, or WebAudio.

export function nextMeadow(prev) {
  // prev: { seed, blooms, size, totalBuds, meadowBuds? }
  return {
    seed: prev.seed + 1,
    blooms: prev.blooms + 1,
    size: prev.size,
    totalBuds: prev.totalBuds + (prev.meadowBuds ?? 0),
  };
}