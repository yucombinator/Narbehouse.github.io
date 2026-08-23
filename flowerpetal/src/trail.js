// Pure random trail generation. No three.js, DOM, or WebAudio — unit-tested with node --test.

export const CRUISE_SPEED = 6;      // world units / second, constant
export const MAX_BANK_DEG = 35;     // max bank angle, two-button steering
export const G_EFF = 9.8;           // feel constant for the curvature budget
export const MAX_CURVATURE = 0.09;  // |x''(z)| cap; hard invariant
export const CLUSTER_SPACING = 26;      // average z gap between bunches
export const CLUSTER_SPACING_JITTER = 12; // random gap variation
export const CLUSTER_RADIUS = 2.6;      // petals spread within this many units
export const CLUSTER_MIN = 3;           // flowers per bunch
export const CLUSTER_MAX = 6;
export const ALT_AMPLITUDE = 2.5;       // max |y(z) - 6| path
export const BUD_SPREAD = CLUSTER_RADIUS + 2.2; // corridor bound used by tests

export const PALETTE = [
  0xffd1dc, 0xb3e1ff, 0xc7f0c7, 0xfff3b0, 0xdcc8ff, 0xffc9a8,
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Worst-case |x''| a max-bank turn can follow: a_lat / v^2, a_lat = g*tan(bank).
export function holdableCurvature(v = CRUISE_SPEED) {
  return (G_EFF * Math.tan((MAX_BANK_DEG * Math.PI) / 180)) / (v * v);
}

export function generateTrail({ seed, length = 400 }) {
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

  // Altitude: gentle, independent low-frequency sines (defined before curveY uses them).
  const altFreqs = [0.02 + rand() * 0.02, 0.035 + rand() * 0.02];
  const altPhases = [rand() * Math.PI * 2, rand() * Math.PI * 2];
  const altAmp1 = 1.0 + rand() * 1.2;
  const altAmp2 = 0.6 + rand() * 0.9;

  const curveX = (z) => amps.reduce((s, a, i) => s + a * Math.sin(freqs[i] * z + phases[i]), 0);
  const curveY = (z) =>
    6 + altAmp1 * Math.sin(altFreqs[0] * z + altPhases[0]) + altAmp2 * Math.sin(altFreqs[1] * z + altPhases[1]);

  // Flowers gather in bunches: a cluster of 3-6 petals centred near the
  // path, then a gap, then the next bunch. Organic little groups, not a
  // straight line.
  const buds = [];
  let z = zStart - 8; // first bunch a short way ahead
  let cluster = 0;
  while (z > zEnd + 12) {
    const n = CLUSTER_MIN + Math.floor(rand() * (CLUSTER_MAX - CLUSTER_MIN + 1));
    const cx = curveX(z) + (rand() - 0.5) * 2.4;
    const cz = z + (rand() - 0.5) * 3;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * CLUSTER_RADIUS;
      const bx = cx + Math.cos(a) * r;
      const bz = cz + Math.sin(a) * r;
      const by = curveY(bz) + (rand() - 0.5) * 1.6;
      buds.push({
        x: bx,
        y: by,
        z: bz,
        colorHex: PALETTE[Math.floor(rand() * PALETTE.length)],
        cluster,
      });
    }
    z -= CLUSTER_SPACING + rand() * CLUSTER_SPACING_JITTER;
    cluster++;
  }
  buds.sort((a, b) => b.z - a.z); // descending z = toward the player's flight
  const mother = { x: curveX(zEnd), y: curveY(zEnd), z: zEnd };

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