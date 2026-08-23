// Pure wind model: gentle, bounded wander that makes flight feel alive.
// Deterministic per (t, seed) — same arguments, same wind. No three/DOM/audio.

import { mulberry32 } from './trail.js';

export const WIND_CFG = {
  latAmp: 1.0,     // max lateral wind speed contribution (u/s), first wave
  latF1: 0.45,     // slow drift (~14s period)
  latF2: 0.9,      // ripple (~7s period)
  bobAmp: 1.0,     // vertical bob amplitude (u)
  bobF1: 0.5,
  bobF2: 1.25,
  speedAmp: 0.09,  // cruise speed breathes by ±9%
  speedF: 0.31,
};

// Per-seed phases, cached so per-frame calls stay cheap.
const phaseCache = new Map();
function getPhases(seed) {
  let p = phaseCache.get(seed);
  if (!p) {
    const rand = mulberry32(seed);
    p = {
      p1: rand() * Math.PI * 2,
      p2: rand() * Math.PI * 2,
      p3: rand() * Math.PI * 2,
      p4: rand() * Math.PI * 2,
    };
    phaseCache.set(seed, p);
  }
  return p;
}

export function windAt(t, seed, cfg = WIND_CFG) {
  const { p1, p2, p3, p4 } = getPhases(seed);
  return {
    swayVx: cfg.latAmp * Math.sin(cfg.latF1 * t + p1) + cfg.latAmp * 0.55 * Math.sin(cfg.latF2 * t + p2),
    bobY: cfg.bobAmp * (0.6 * Math.sin(cfg.bobF1 * t + p3) + 0.4 * Math.sin(cfg.bobF2 * t + p4)),
    speedFactor: 1 + cfg.speedAmp * Math.sin(cfg.speedF * t + p4),
  };
}