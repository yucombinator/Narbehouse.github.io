import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, generateTrail, MAX_CURVATURE, ALT_AMPLITUDE,
  holdableCurvature, PALETTE, CLUSTER_RADIUS, CLUSTER_SPACING,
  CLUSTER_MIN, CLUSTER_MAX, BUD_SPREAD,
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

test('buds come in sparse bunches with long gaps between groups', () => {
  const t = generateTrail(DEFAULT);
  // Group consecutive buds by cluster id (buds are z-sorted, clusters contiguous).
  // Scattered meadow flowers (cluster === -1) are excluded from cluster checks.
  const groups = new Map();
  for (const b of t.buds) {
    if (b.cluster === -1) continue;
    if (!groups.has(b.cluster)) groups.set(b.cluster, []);
    groups.get(b.cluster).push(b);
  }
  for (const [id, g] of groups) {
    assert.ok(g.length >= CLUSTER_MIN && g.length <= CLUSTER_MAX, `cluster ${id} size ${g.length}`);
    // All buds of one cluster sit within CLUSTER_RADIUS of the first.
    const c0 = g[0];
    for (const b of g) {
      const d = Math.hypot(b.x - c0.x, b.z - c0.z);
      assert.ok(d <= CLUSTER_RADIUS * 2 + 1e-6, `cluster ${id} spread ${d}`);
    }
  }
  // A meadow has a handful of bunches — sparse, with long empty stretches.
  assert.ok(groups.size >= 3 && groups.size <= 10, `clusters ${groups.size}`);
});

test('bunches are spaced apart (no giant merged clump)', () => {
  const t = generateTrail(DEFAULT);
  const centers = new Map();
  for (const b of t.buds) {
    if (b.cluster === -1) continue;
    if (!centers.has(b.cluster)) centers.set(b.cluster, { x: 0, z: 0, n: 0 });
    const c = centers.get(b.cluster);
    c.x += b.x;
    c.z += b.z;
    c.n += 1;
  }
  const radii = [...centers.keys()].map((id) => {
    const c = centers.get(id);
    return { x: c.x / c.n, z: c.z / c.n };
  });
  for (let i = 1; i < radii.length; i++) {
    const dz = Math.abs(radii[i].z - radii[i - 1].z);
    assert.ok(dz >= CLUSTER_SPACING * 0.4, `cluster gap ${dz}`);
  }
});

test('every bud lies in a bounded corridor around the path', () => {
  const t = generateTrail(DEFAULT);
  for (const b of t.buds) {
    const p = t.pointAt(b.z);
    const dx = Math.abs(b.x - p.x);
    const dy = Math.abs(b.y - p.y);
    // Scattered meadow flowers (cluster === -1) use a wider corridor.
    const spread = b.cluster === -1 ? 60 : BUD_SPREAD;
    assert.ok(dx <= spread + 1e-6, `lateral corridor ${dx} at z=${b.z}`);
    assert.ok(dy <= ALT_AMPLITUDE + 1e-6, `alt corridor ${dy} at z=${b.z}`);
  }
});

test('no NaN anywhere in trail data', () => {
  const t = generateTrail({ seed: 1, length: 1000 });
  const nums = [t.zStart, t.zEnd, t.mother.x, t.mother.y, t.mother.z];
  for (const b of t.buds) nums.push(b.x, b.y, b.z);
  for (let z = t.zStart; z >= t.zEnd; z -= 2) {
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