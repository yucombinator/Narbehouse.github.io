// Pure random trail generation. No three.js, DOM, or WebAudio — unit-tested with node --test.

export const CRUISE_SPEED = 6;      // world units / second, constant
export const MAX_BANK_DEG = 35;     // max bank angle, two-button steering
export const G_EFF = 9.8;           // feel constant for the curvature budget
export const MAX_CURVATURE = 0.09;  // |x''(z)| cap; hard invariant
export const BUD_SPACING = 7;
export const LATERAL_OFFSET = 0.35; // buds form a single gentle line on the spline
export const ALT_AMPLITUDE = 2.5;   // max |y(z) - 6|

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

export function generateTrail({ seed, length = 400, budSpacing = BUD_SPACING }) {
	const rand = mulberry32(seed);
	const zStart = 40;                      // trail begins at the player
	const zEnd = zStart - length;           // and runs toward -z (forward)
  // A "line of flowers": keep the trail nearly straight. Very long
  // wavelengths (period ~1500 units) and small amplitudes mean the whole
  // meadow reads as one gentle row; curvature stays far below the
  // holdable budget, so any wander is trivially followable.
  const layers = 2;
  const freqs = Array.from({ length: layers }, () => 0.003 + rand() * 0.005);
  const phases = Array.from({ length: layers }, () => rand() * Math.PI * 2);
  const amps = freqs.map((f, i) => (i === 0 ? 3 + rand() * 3 : 2 + rand() * 2));

  // Altitude: gentle, independent low-frequency sines (defined before curveY uses them).
  const altFreqs = [0.02 + rand() * 0.02, 0.035 + rand() * 0.02];
  const altPhases = [rand() * Math.PI * 2, rand() * Math.PI * 2];
  const altAmp1 = 1.0 + rand() * 1.2;
  const altAmp2 = 0.6 + rand() * 0.9;

  const curveX = (z) => amps.reduce((s, a, i) => s + a * Math.sin(freqs[i] * z + phases[i]), 0);
  const curveY = (z) =>
    6 + altAmp1 * Math.sin(altFreqs[0] * z + altPhases[0]) + altAmp2 * Math.sin(altFreqs[1] * z + altPhases[1]);

  	const buds = [];
	let side = 1;
	for (let z = zStart - budSpacing; z >= zEnd + budSpacing; z -= budSpacing) {
    buds.push({
      x: curveX(z) + side * LATERAL_OFFSET,
      y: curveY(z),
      z,
      colorHex: PALETTE[Math.floor(rand() * PALETTE.length)],
    });
    side = -side;
  }
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