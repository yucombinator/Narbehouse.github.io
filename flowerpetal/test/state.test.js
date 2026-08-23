import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, loadSave, writeSave, resetSave, KEY } from '../src/state.js';
import { MAX_SIZE } from '../src/growth.js';

test('memory store behaves like a minimal storage', () => {
  const s = createMemoryStore();
  s.setItem('a', '1');
  assert.equal(s.getItem('a'), '1');
  assert.equal(s.getItem('missing'), null);
  s.removeItem('a');
  assert.equal(s.getItem('a'), null);
});

test('save round-trips', () => {
  const s = createMemoryStore();
  const save = { size: 1.7, totalBuds: 23, blooms: 2 };
  writeSave(s, save);
  assert.deepEqual(loadSave(s), save);
});

test('absent save returns null', () => {
  assert.equal(loadSave(createMemoryStore()), null);
});

test('corrupt JSON returns null, does not throw', () => {
  const s = createMemoryStore();
  s.setItem(KEY, '{not json');
  assert.equal(loadSave(s), null);
});

test('out-of-range fields are clamped to defaults', () => {
  const s = createMemoryStore();
  s.setItem(KEY, JSON.stringify({ size: 99, totalBuds: -5, blooms: 'x' }));
  const loaded = loadSave(s);
  assert.equal(loaded.size, MAX_SIZE);
  assert.equal(loaded.totalBuds, 0);
  assert.equal(loaded.blooms, 0);
});

test('resetSave clears the key', () => {
  const s = createMemoryStore();
  writeSave(s, { size: 1, totalBuds: 1, blooms: 0 });
  resetSave(s);
  assert.equal(s.getItem(KEY), null);
  assert.equal(loadSave(s), null);
});