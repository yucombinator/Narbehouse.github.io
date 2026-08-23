import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMeadow } from '../src/meadow.js';

test('nextMeadow advances seed and blooms, keeps size', () => {
  const prev = { seed: 42, blooms: 2, size: 1.7, totalBuds: 23, meadowBuds: 10 };
  const next = nextMeadow(prev);
  assert.equal(next.seed, 43);
  assert.equal(next.blooms, 3);
  assert.equal(next.size, 1.7);
  assert.equal(next.totalBuds, 33);
});

test('nextMeadow with no carried meadowBuds accumulates 0', () => {
  const next = nextMeadow({ seed: 1, blooms: 0, size: 1, totalBuds: 0 });
  assert.equal(next.totalBuds, 0);
  assert.equal(next.seed, 2);
});

test('nextMeadow is pure (does not mutate input)', () => {
  const prev = { seed: 7, blooms: 5, size: 2, totalBuds: 100, meadowBuds: 50 };
  const snapshot = { ...prev };
  nextMeadow(prev);
  assert.deepEqual(prev, snapshot);
});