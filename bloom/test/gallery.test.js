import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GALLERY_KEY,
  GALLERY_CAP,
  loadBouquets,
  addBouquet,
  resetBouquets,
} from '../src/gallery.js';
import { createMemoryStore } from '../src/state.js';

const BOUQUET = { seed: 42, picks: ['a', 'b'], finishedAt: 1 };

test('empty gallery by default', () => {
  assert.deepEqual(loadBouquets(createMemoryStore()), []);
});

test('add then load round-trips, newest first', () => {
  const s = createMemoryStore();
  addBouquet(s, BOUQUET);
  addBouquet(s, { seed: 43, picks: ['c'], finishedAt: 2 });
  const list = loadBouquets(s);
  assert.equal(list.length, 2);
  assert.equal(list[0].seed, 43); // newest first
  assert.equal(list[1].seed, 42);
});

test('gallery respects the cap, dropping oldest', () => {
  const s = createMemoryStore();
  for (let i = 0; i < GALLERY_CAP + 5; i++) {
    addBouquet(s, { seed: i, picks: [`f${i}`], finishedAt: i });
  }
  const list = loadBouquets(s);
  assert.equal(list.length, GALLERY_CAP);
  assert.equal(list[0].seed, GALLERY_CAP + 4); // newest survived
  assert.equal(list[GALLERY_CAP - 1].seed, 5); // oldest five dropped
});

test('corrupt JSON yields an empty gallery, not a throw', () => {
  const s = createMemoryStore();
  s.setItem(GALLERY_KEY, '{oops');
  assert.deepEqual(loadBouquets(s), []);
  s.setItem(GALLERY_KEY, '{"not":"an array"}');
  assert.deepEqual(loadBouquets(s), []);
});

test('malformed entries are filtered out on load', () => {
  const s = createMemoryStore();
  s.setItem(GALLERY_KEY, JSON.stringify([{ seed: 1, picks: ['ok'], finishedAt: 1 }, 'junk', { nope: true }, { picks: [] }]));
  const list = loadBouquets(s);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].picks, ['ok']);
});

test('addBouquet rejects malformed records', () => {
  const s = createMemoryStore();
  assert.throws(() => addBouquet(s, { seed: 1 }));
  assert.throws(() => addBouquet(s, null));
  assert.throws(() => addBouquet(s, { seed: 1, picks: [], finishedAt: 1 }));
});

test('resetBouquets clears the gallery but not the core save', () => {
  const s = createMemoryStore();
  s.setItem('petalBloom.save', JSON.stringify({ size: 1.2, totalBuds: 3, blooms: 0 }));
  addBouquet(s, BOUQUET);
  resetBouquets(s);
  assert.deepEqual(loadBouquets(s), []);
  assert.notEqual(s.getItem('petalBloom.save'), null); // untouched
});
