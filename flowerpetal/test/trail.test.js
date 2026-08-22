import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, generateTrail, MAX_CURVATURE, BUD_SPACING,
  LATERAL_OFFSET, ALT_AMPLITUDE, holdableCurvature, PALETTE,
} from '../src/trail.js';

const DEFAULT = { seed: 42, length: 400 };

test('mulberry32 is deterministic and in range', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('same seed -> identical trail; different seed -> different trail', () => {
  const t1 = generateTrail(DEFAULT);
  const t2 = generateTrail(DEFAULT);
  const t3 = generateTrail({ ...DEFAULT, seed: 43 });
  assert.deepEqual(t1.buds, t2.buds);
  assert.deepEqual(t1.mother, t2.mother);
  assert.notDeepEqual(t1.buds, t3.buds);
});

test('buds are spaced along the trail, sorted by z, with sane count', () => {
  const t = generateTrail(DEFAULT);
  assert.ok(t.buds.length >= 40 && t.buds.length <= 70, `count ${t.buds.length}`);
  for (let i = 1; i < t.buds.length; i++) {
    assert.ok(t.buds[i].z > t.buds[i - 1].z);
    const dz = t.buds[i].z - t.buds[i - 1].z;
    assert.ok(Math.abs(dz - BUD_SPACING) < 1e-6, `even spacing ${dz}`);
  }
  assert.equal(t.buds[0].z, t.zStart + BUD_SPACING);
  assert.equal(t.mother.z, t.zEnd);
});

test('every bud lies in a bounded corridor around the spline', () => {
  const t = generateTrail(DEFAULT);
  for (const b of t.buds) {
    const p = t.pointAt(b.z);
    const dx = Math.abs(b.x - p.x);
    const dy = Math.abs(b.y - p.y);
    assert.ok(dx <= LATERAL_OFFSET + 1e-6, `lateral corridor ${dx} at z=${b.z}`);
    assert.ok(dy <= ALT_AMPLITUDE + 1e-6, `alt corridor ${dy} at z=${b.z}`);
  }
});

test('no NaN anywhere in trail data', () => {
  const t = generateTrail({ seed: 1, length: 1000 });
  const nums = [t.zStart, t.zEnd, t.mother.x, t.mother.y, t.mother.z];
  for (const b of t.buds) nums.push(b.x, b.y, b.z);
  for (let z = t.zStart; z <= t.zEnd; z += 2) {
    const p = t.pointAt(z);
    nums.push(p.x, p.y);
  }
  assert.ok(nums.every(Number.isFinite));
});

test('curvature never exceeds the holdable bound', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const t = generateTrail({ seed, length: 600 });
    assert.ok(t.curvatureBound <= MAX_CURVATURE, `analytic bound ${t.curvatureBound}`);
    assert.ok(t.curvatureBound * 2 <= holdableCurvature(), '>=2x margin to max bank');
  }
});

test('bud colors come from the palette', () => {
  const t = generateTrail(DEFAULT);
  assert.ok(t.buds.every((b) => PALETTE.includes(b.colorHex)));
});