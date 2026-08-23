import test from 'node:test';
import assert from 'node:assert/strict';
import { windAt, WIND_CFG } from '../src/wind.js';

test('windAt is deterministic per (seed, t)', () => {
  const a = windAt(12.5, 42);
  const b = windAt(12.5, 42);
  assert.equal(a.swayVx, b.swayVx);
  assert.equal(a.bobY, b.bobY);
  assert.equal(a.speedFactor, b.speedFactor);
});

test('different seeds give different wind', () => {
  const a = windAt(5, 1);
  const b = windAt(5, 2);
  assert.notEqual(a.swayVx, b.swayVx);
});

test('wind magnitudes are bounded', () => {
  let maxSway = 0;
  let maxBob = 0;
  for (let t = 0; t < 300; t += 0.5) {
    const w = windAt(t, 7);
    maxSway = Math.max(maxSway, Math.abs(w.swayVx));
    maxBob = Math.max(maxBob, Math.abs(w.bobY));
    assert.ok(w.speedFactor >= 1 - WIND_CFG.speedAmp - 1e-9);
    assert.ok(w.speedFactor <= 1 + WIND_CFG.speedAmp + 1e-9);
  }
  assert.ok(maxSway <= WIND_CFG.latAmp * 1.6, `sway ${maxSway}`);
  assert.ok(maxBob <= WIND_CFG.bobAmp * 1.05, `bob ${maxBob}`);
});

test('wind does not drift the player permanently (mean ~ 0 over time)', () => {
  const dt = 0.25;
  const T = 240; // seconds
  let sum = 0;
  for (let t = 0; t < T; t += dt) sum += windAt(t, 3).swayVx * dt;
  const mean = sum / T;
  assert.ok(Math.abs(mean) < 0.08, `mean lateral wander ${mean}`);
});

test('wind speed varies within a few percent', () => {
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < 60; t += 0.25) {
    const f = windAt(t, 9).speedFactor;
    min = Math.min(min, f);
    max = Math.max(max, f);
  }
  assert.ok(max - min > 0.05, 'speed actually breathes');
  assert.ok(min >= 1 - WIND_CFG.speedAmp - 1e-9 && max <= 1 + WIND_CFG.speedAmp + 1e-9);
});