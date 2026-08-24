import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTER,
  flowerById,
  choicesPerStop,
  maxStopsCovered,
  sampleChoices,
  segmentMood,
  bouquetTitle,
  MEADOW_POOLS,
  speciesScale,
} from '../src/flowers.js';
import { moodKeyForHex } from '../src/poem.js';
import { TOTAL_STOPS, TOTAL_STAGES } from '../src/run.js';

const SHAPES = new Set(['daisy', 'cup', 'bell', 'puff', 'spike', 'star', 'wild']);

test('roster covers a 5-stop run with room for variety', () => {
  assert.equal(ROSTER.length, 49, `expected 49 variants, have ${ROSTER.length}`);
  assert.ok(maxStopsCovered() >= 5, 'roster must cover five stops');
});

test('every flower has complete data incl. shape + colours', () => {
  for (const f of ROSTER) {
    assert.equal(typeof f.id, 'string');
    assert.ok(f.id.length > 0);
    assert.equal(typeof f.name, 'string');
    assert.ok(f.name.length > 0);
    assert.equal(typeof f.tts, 'string');
    assert.ok(f.tts.length > 0 && f.tts.length <= 40); // short spoken label
    assert.equal(typeof f.fact, 'string');
    assert.ok(SHAPES.has(f.shape), `known shape for ${f.id}`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(f.petalHex), `petalHex for ${f.id}`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(f.centerHex), `centerHex for ${f.id}`);
  }
});

test('same-shape variants still look distinct (unique petal colour per shape)', () => {
  const byShape = {};
  for (const f of ROSTER) (byShape[f.shape] ||= []).push(f);
  assert.deepEqual(Object.keys(byShape).sort(), ['bell', 'cup', 'daisy', 'puff', 'spike', 'star', 'wild']);
  for (const [shape, group] of Object.entries(byShape)) {
    const petals = new Set(group.map((f) => f.petalHex));
    assert.equal(petals.size, group.length, `${shape} variants need distinct petalHex`);
    if (shape !== 'spike') { // spike is a lone signature — a spire, not a family
      assert.ok(group.length >= 3, `${shape} needs at least three colourways`);
    }
  }
});

test('ids and names are unique', () => {
  const ids = new Set(ROSTER.map((f) => f.id));
  const names = new Set(ROSTER.map((f) => f.name));
  const tts = new Set(ROSTER.map((f) => f.tts));
  assert.equal(ids.size, ROSTER.length);
  assert.equal(names.size, ROSTER.length);
  assert.equal(tts.size, ROSTER.length);
});

test('flowerById resolves roster ids and rejects junk', () => {
  assert.equal(flowerById('oxeye-daisy').name, 'Oxeye Daisy');
  assert.equal(flowerById('nope'), null);
  assert.equal(flowerById(undefined), null);
});

test('each stop offers three distinct choices from the roster', () => {
  for (let stop = 0; stop < 5; stop++) {
    const choices = sampleChoices(42, stop);
    assert.equal(choices.length, choicesPerStop());
    assert.equal(new Set(choices).size, choices.length, 'choices are distinct');
    for (const id of choices) assert.ok(flowerById(id), `unknown id ${id}`);
  }
});

test('no variant is offered twice in one run — across ALL stops', () => {
  // Core rule: every meadow of a run shows only never-before-seen variants.
  for (let seed = 1; seed <= 300; seed++) {
    const seen = [];
    for (let stop = 0; stop < 5; stop++) seen.push(...sampleChoices(seed, stop));
    assert.equal(new Set(seen).size, 15, `seed ${seed} repeated a variant`);
  }
});

test('sampleChoices is deterministic per seed', () => {
  assert.deepEqual(sampleChoices(42, 0), sampleChoices(42, 0));
  assert.deepEqual(sampleChoices(42, 3), sampleChoices(42, 3));
  const a = sampleChoices(7, 2);
  const b = sampleChoices(7, 2);
  assert.deepEqual(a, b);
});

test('segmentMood: similar flowers grow together — mood comes from that stretch\'s offers', () => {
  for (let seed = 1; seed <= 50; seed++) {
    for (let seg = 0; seg < 5; seg++) {
      const mood = segmentMood(seed, seg);
      assert.ok(mood, `mood exists for seed ${seed} segment ${seg}`);
      assert.ok(
        sampleChoices(seed, seg).includes(mood.id),
        `mood ${mood.id} must belong to segment ${seg}'s offers`,
      );
      // Determinism
      assert.equal(segmentMood(seed, seg).id, mood.id);
    }
  }
  assert.equal(segmentMood(42, maxStopsCovered()), null); // beyond the run
});

test('bouquetTitle describes mixes', () => {
  const allSame = ['oxeye-daisy', 'oxeye-daisy', 'oxeye-daisy'];
  assert.equal(bouquetTitle(allSame), 'An Oxeye Daisy bouquet');

  const clearFavorite = ['columbine', 'columbine', 'poppy', 'dandelion'];
  assert.equal(bouquetTitle(clearFavorite), 'Featuring western columbines');

  const poppyPair = ['poppy', 'poppy', 'camas'];
  assert.equal(bouquetTitle(poppyPair), 'Featuring red poppies');

  const gardenFive = [
    'oxeye-daisy',
    'columbine',
    'camas',
    'oregon-grape',
    'blackeyed-susan',
  ];
  assert.equal(bouquetTitle(gardenFive), 'A whole garden in one bouquet');

  const evenPair = ['camas', 'dandelion'];
  assert.equal(bouquetTitle(evenPair), 'A mixed garden bouquet');
});

test('bouquetTitle tolerates junk input', () => {
  assert.equal(bouquetTitle([]), 'A wildflower bouquet');
  assert.equal(bouquetTitle(null), 'A wildflower bouquet');
});

test('meadow pools: every id is real, each covers five stops, and stages never share a flower', () => {
  assert.equal(MEADOW_POOLS.length, TOTAL_STAGES);
  const all = [];
  for (const pool of MEADOW_POOLS) {
    assert.ok(pool.length >= TOTAL_STOPS * choicesPerStop(),
      `pool too small (${pool.length})`);
    assert.equal(new Set(pool).size, pool.length, 'pool has no internal repeats');
    for (const id of pool) assert.ok(flowerById(id), `unknown flower ${id}`);
    all.push(...pool);
  }
  assert.equal(new Set(all).size, all.length,
    'a flower must never appear in two stages');
});

test('sampleChoices honours a themed pool', () => {
  const pool = MEADOW_POOLS[2]; // summit ridge
  for (let stop = 0; stop < TOTAL_STOPS; stop++) {
    const picks = sampleChoices(1234, stop, pool);
    assert.equal(picks.length, choicesPerStop());
    for (const id of picks) assert.ok(pool.includes(id), `${id} leaked from pool`);
  }
});

test('lupine joined the roster with a valid mood bucket', () => {
  const f = flowerById('lupine');
  assert.ok(f, 'lupine missing');
  assert.notEqual(moodKeyForHex(f.petalHex), null);
});

test('speciesScale: sane default and sensible sized plants', () => {
  assert.equal(speciesScale('not-a-flower'), 1);
  assert.ok(speciesScale('sunflower') > 1, 'sunflower should read big');
  assert.ok(speciesScale('cosmos') < 1, 'cosmos should read small');
  assert.ok(Number.isFinite(speciesScale('lupine')));
});
