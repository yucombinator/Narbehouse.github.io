// Pure rolling-hill terrain, deterministic per seed. Both the renderer and
// the game logic use this exact function so flowers sit on the surface the
// player sees. No three.js/DOM/WebAudio.

import { mulberry32 } from './rand.js';

export const HILL_OFFSET = -3; // base height of the valley floor

export function createHills(seed = 7) {
  const rand = mulberry32(seed);
  const a1 = 3.0 + rand() * 2.0;
  const b1 = 1.6 + rand() * 1.4;
  const f1x = 0.012 + rand() * 0.006;
  const f1z = 0.02 + rand() * 0.008;
  const p1x = 0.6 + rand() * 0.8;
  const p1z = 1.1 + rand() * 0.7;
  const f2x = 0.03 + rand() * 0.012;
  const f2z = 0.037 + rand() * 0.012;
  const p2x = 2.2 + rand();
  const p2z = 0.3 + rand();

  return {
    params: { a1, b1, f1x, f1z, p1x, p1z, f2x, f2z, p2x, p2z, offset: HILL_OFFSET },
    // Height of the ground at a world (x, z). Matches the rendered plane.
    height(x, z) {
      return (
        HILL_OFFSET +
        a1 * Math.sin(x * f1x + p1x) * Math.sin(z * f1z + p1z) +
        b1 * Math.sin(x * f2x + p2x) * Math.sin(z * f2z + p2z)
      );
    },
  };
}

// One terrain shared by every meadow so the hills never pop between levels.
export const HILLS = createHills(7);