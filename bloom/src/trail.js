// Pure random trail generation. No three.js, DOM, or WebAudio — unit-tested.
import { mulberry32 } from './rand.js';
import { HILLS } from './hill.js';
import { flowerById } from './flowers.js?v=4';

// Re-export for tests and callers that import the PRNG from here.
export { mulberry32 };

export const CRUISE_SPEED = 6;      // world units / second, constant
export const MAX_BANK_DEG = 35;     // max bank angle, two-button steering
export const G_EFF = 9.8;           // feel constant for the curvature budget
export const MAX_CURVATURE = 0.09;  // |x''(z)| cap; hard invariant
export const CLUSTER_SPACING = 78;      // long empty meadow between bunches
export const CLUSTER_SPACING_JITTER = 34; // random gap variation
export const CLUSTER_RADIUS = 4.6;      // wider scatter — clusters aren't a line
export const CLUSTER_MIN = 3;           // flowers per bunch: a proper little patch
export const CLUSTER_MAX = 5;
export const ALT_AMPLITUDE = 3.0;       // max |y(z) - HILL_OFFSET| flight path
export const BUD_SPREAD = CLUSTER_RADIUS + 2.2; // corridor spread used by tests
export const FLY_ALT = 3.6;             // how high above the ground the petal cruises

export const PALETTE = [
  0xffd1dc, 0xb3e1ff, 0xc7f0c7, 0xfff3b0, 0xdcc8ff, 0xffc9a8,
];

// Distinct flower varieties: petal count + a crown-of-petals flag so the
// meadow reads as different kinds of bloom, not one clone repeated.
export const FLOWER_KINDS = [
  { petals: 5, spread: 1.0, bigCenter: 0.3 },   // classic rose
  { petals: 6, spread: 1.15, bigCenter: 0.24 }, // daisy
  { petals: 4, spread: 0.95, bigCenter: 0.22 }, // star
  { petals: 8, spread: 1.35, bigCenter: 0.2 },  // airy cluster
];

// Meadow geometry variants: each carries a SHAPE so tulips cup, roses
// rosette, bells nod and puffs round out — believable forms instead of one
// fan repeated. Tulip and rose deliberately have two configurations each,
// so the same species can appear closed or open.
export const FLOWER_VARIANTS = [
  { shape: 'daisy', petals: 5, spread: 1.0, bigCenter: 0.3 },
  { shape: 'daisy', petals: 6, spread: 1.15, bigCenter: 0.24 },
  { shape: 'daisy', petals: 4, spread: 0.95, bigCenter: 0.22 },
  { shape: 'daisy', petals: 8, spread: 1.35, bigCenter: 0.2 },
  { shape: 'cup', petals: 6, spread: 0.92, bigCenter: 0.16 },    // closed tulip
  { shape: 'star', petals: 6, spread: 1.2, bigCenter: 0.18 },    // open tulip
  { shape: 'rosette', petals: 8, spread: 1.05, bigCenter: 0.18 }, // full rose
  { shape: 'wild', petals: 5, spread: 1.18, bigCenter: 0.26 },   // wild rose
  { shape: 'bell', petals: 5, spread: 0.9, bigCenter: 0.16 },    // nodding bell
  { shape: 'puff', petals: 9, spread: 1.05, bigCenter: 0.14 },   // soft pompom
];

// Worst-case |x''| a max-bank turn can follow: a_lat / v^2, a_lat = g*tan(bank).
export function holdableCurvature(v = CRUISE_SPEED) {
  return (G_EFF * Math.tan((MAX_BANK_DEG * Math.PI) / 180)) / (v * v);
}

export function generateTrail({ seed, length = 400, species = null }) {
	const rand = mulberry32(seed);
	const zStart = 40;                      // trail begins at the player
	const zEnd = zStart - length;           // and runs toward -z (forward)
  // The path rolls gently like wind over a meadow: long-wavelength lateral
  // sway (amplitudes a few units, periods ~200-600 units) — still far under
  // the holdable curvature budget.
  const layers = 2;
  const freqs = Array.from({ length: layers }, () => 0.004 + rand() * 0.01);
  const phases = Array.from({ length: layers }, () => rand() * Math.PI * 2);
  const amps = freqs.map((f, i) => (i === 0 ? 4 + rand() * 4 : 2.5 + rand() * 2.5));

  // The flight path hovers ~FLY_ALT above the terrain: the petal follows the
  // hills' undulations (ground level) plus a float altitude, so it dips into
  // valleys with them and rises over ridges.
  const curveX = (z) => amps.reduce((s, a, i) => s + a * Math.sin(freqs[i] * z + phases[i]), 0);
  const curveY = (z) => HILLS.height(curveX(z), z) + FLY_ALT;

  // Flowers gather in bunches: a cluster of 3-6 petals centred near the
  // path, then a gap, then the next bunch. Organic little groups, not a
  // straight line.
  const buds = [];
  let z = zStart - 8; // first bunch a short way ahead
  let cluster = 0;
  while (z > zEnd + 12) {
    const n = CLUSTER_MIN + Math.floor(rand() * (CLUSTER_MAX - CLUSTER_MIN + 1));
    // Bigger lateral + depth scatter per bunch so flowers gather in clumps
    // off the path, not a tidy row along it.
    const cx = curveX(z) + (rand() - 0.5) * 7;
    const cz = z + (rand() - 0.5) * 6;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * CLUSTER_RADIUS;
      const bx = cx + Math.cos(a) * r;
      const bz = cz + Math.sin(a) * r;
      const kind = Math.floor(rand() * FLOWER_VARIANTS.length);
      // Flowers grow on stems sticking just above the grass field
      const gy = HILLS.height(bx, bz) + 3.55;
      // Themed meadows grow their own species pool: bud colours come from
      // real roster flowers so the field matches the region being flown.
      const speciesHex = (species && species.length)
        ? flowerById(species[Math.floor(rand() * species.length)])?.petalHex
        : null;
      buds.push({
        x: bx,
        y: gy,
        z: bz,
        colorHex: speciesHex || PALETTE[Math.floor(rand() * PALETTE.length)],
        kind,
        kindIndex: 0, // filled below by the per-kind counter
        cluster,
      });
    }
    z -= CLUSTER_SPACING + rand() * CLUSTER_SPACING_JITTER;
    cluster++;
  }
  buds.sort((a, b) => b.z - a.z); // descending z = toward the player's flight
  // Assign a per-kind order so each kind's InstancedMesh indices line up.
  const kindCounts = Array.from({ length: FLOWER_VARIANTS.length }, () => 0);
  for (const b of buds) {
    b.kindIndex = kindCounts[b.kind]++;
  }
  const mother = { x: curveX(zEnd), y: HILLS.height(curveX(zEnd), zEnd) + 3.2, z: zEnd };

  // Analytic worst-case second derivative (true upper bound).
  const curvatureBound = amps.reduce((s, a, i) => s + a * freqs[i] * freqs[i], 0);

  return {
    zStart,
    zEnd,
    buds,
    mother,
    curvatureBound,
    pointAt(z) {
      return { x: curveX(z), y: curveY(z) };
    },
  };
}