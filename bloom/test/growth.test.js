import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SIZE, GROWTH_K, stepSize, tintFor, collectBud } from '../src/growth.js';

test('stepSize grows monotonically toward MAX_SIZE and never exceeds it', () => {
  let s = 1;
  assert.ok(stepSize(s) > s);
  for (let i = 0; i < 1000; i++) {
    const next = stepSize(s);
    assert.ok(next >= s, 'nondecreasing');
    assert.ok(next <= MAX_SIZE + 1e-9, 'capped');
    s = next;
  }
  assert.ok(Math.abs(s - MAX_SIZE) < 1e-6, 'converges');
});

test('stepSize formula matches spec', () => {
  assert.equal(stepSize(1), 1 + (MAX_SIZE - 1) * GROWTH_K);
  assert.equal(stepSize(MAX_SIZE), MAX_SIZE);
});

test('first bud is the biggest single step; steps diminish', () => {
  let s = 1;
  let prevStep = Infinity;
  for (let i = 0; i < 20; i++) {
    const next = stepSize(s);
    const step = next - s;
    assert.ok(step < prevStep, `diminishing step ${i}`);
    prevStep = step;
    s = next;
  }
});

test('tintFor clamps and lerps between endpoints', () => {
  assert.equal(tintFor(0), 0xffe3f0);
  assert.equal(tintFor(1), 0xffffff);
  assert.equal(tintFor(-1), 0xffe3f0);
  assert.equal(tintFor(2), 0xffffff);
  assert.ok(tintFor(0.5) !== tintFor(0) && tintFor(0.5) !== tintFor(1));
});

test('collectBud advances size once per bud and flags bloom at the end', () => {
  const st = { size: 1, meadowBuds: 0, meadowTotal: 3 };
  let r = collectBud(st);
  assert.equal(r.meadowBuds, 1);
  assert.equal(r.doesBloom, false);
  assert.ok(r.size > 1);
  r = collectBud(r);
  r = collectBud(r);
  assert.equal(r.meadowBuds, 3);
  assert.equal(r.doesBloom, true);
});

test('collectBud at full meadow does not over-collect', () => {
  const st = { size: 2, meadowBuds: 3, meadowTotal: 3 };
  const r = collectBud(st);
  assert.equal(r.meadowBuds, 3);
  assert.equal(r.size, 2);
  assert.equal(r.doesBloom, false);
});