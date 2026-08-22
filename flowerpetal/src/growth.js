// Pure growth math. No three.js, DOM, or WebAudio.

export const MAX_SIZE = 2.5;
export const GROWTH_K = 0.09;

export function stepSize(size) {
  return size + (MAX_SIZE - size) * GROWTH_K;
}

// Tint gradient stops: [progress, hex] from pale pink -> pale blue -> white.
const TINTS = [
  [0, 0xffe3f0],
  [0.5, 0xcde7ff],
  [1, 0xffffff],
];

export function tintFor(progress01) {
  const t = Math.min(1, Math.max(0, progress01));
  let lo = TINTS[0];
  let hi = TINTS[TINTS.length - 1];
  for (let i = 0; i < TINTS.length - 1; i++) {
    if (t >= TINTS[i][0] && t <= TINTS[i + 1][0]) {
      lo = TINTS[i];
      hi = TINTS[i + 1];
      break;
    }
  }
  const seg = hi[0] - lo[0] || 1;
  const k = (t - lo[0]) / seg;
  const lerp = (a, b) => Math.round(a + (b - a) * k);
  const lc = [(lo[1] >> 16) & 0xff, (lo[1] >> 8) & 0xff, lo[1] & 0xff];
  const rc = [(hi[1] >> 16) & 0xff, (hi[1] >> 8) & 0xff, hi[1] & 0xff];
  return (lerp(lc[0], rc[0]) << 16) | (lerp(lc[1], rc[1]) << 8) | lerp(lc[2], rc[2]);
}

export function collectBud(state) {
  const { size, meadowBuds, meadowTotal } = state;
  if (meadowBuds >= meadowTotal) return { ...state, doesBloom: false };
  const next = meadowBuds + 1;
  return {
    size: stepSize(size),
    meadowBuds: next,
    meadowTotal,
    doesBloom: next === meadowTotal,
  };
}