import test from 'node:test';
import assert from 'node:assert/strict';
import { composePostcard, moodKeyForHex, dominantPick, meadowNumber, BANKS } from '../src/poem.js';
import { flowerById } from '../src/flowers.js';

test('mood buckets cover the whole roster sensibly', () => {
  const cases = {
    poppy: 'rose', // crimson
    columbine: 'rose',
    tulip: 'rose',
    cosmos: 'rose',
    foxglove: 'rose',
    'california-poppy': 'sun', // orange
    buttercup: 'sun',
    dandelion: 'sun',
    'blackeyed-susan': 'sun',
    sunflower: 'sun',
    'oregon-grape': 'sun',
    camas: 'sky',
    bellflower: 'sky',
    'oxeye-daisy': 'cream',
    'white-clover': 'cream',
  };
  for (const [id, key] of Object.entries(cases)) {
    assert.equal(moodKeyForHex(flowerById(id).petalHex), `${key} (${id})` && key);
  }
});

test('every mood bank is rich and grammatically self-contained lines', () => {
  for (const [key, bank] of Object.entries(BANKS)) {
    assert.ok(bank.open.length >= 4, `${key} open variety`);
    assert.ok(bank.mid.length >= 4, `${key} mid variety`);
    assert.ok(bank.close.length >= 3, `${key} close variety`);
    for (const part of ['open', 'mid', 'close']) {
      for (const line of bank[part]) {
        assert.equal(typeof line, 'string');
        assert.ok(line.length > 0 && line.length < 60, `line too long in ${key}.${part}`);
      }
    }
  }
});

test('composePostcard is deterministic and well-formed', () => {
  const picks = ['poppy', 'dandelion', 'oxeye-daisy', 'camas', 'poppy'];
  const a = composePostcard({ picks, seed: 42, flowerById });
  const b = composePostcard({ picks, seed: 42, flowerById });
  assert.deepEqual(a, b);
  assert.equal(a.lines.length, 3);
  assert.ok(a.number >= 101 && a.number <= 999, `number ${a.number}`);
  assert.ok(Object.keys(BANKS).includes(a.moodKey));
  assert.equal(a.dominantId, 'poppy'); // pair of poppies wins
  assert.ok(!a.narration.includes(String(a.number)), 'spoken narration omits the meadow number');
  assert.equal(a.narration, a.lines.join(' '), 'narration is just the haiku');
});

test('dominantPick breaks ties by earliest appearance', () => {
  const f = (id) => flowerById(id);
  assert.equal(dominantPick(['sunflower', 'camas', 'sunflower', 'camas'], f).id, 'sunflower');
  assert.equal(dominantPick(['camas', 'sunflower', 'camas', 'sunflower'], f).id, 'camas');
  assert.equal(dominantPick([], f), null);
  assert.equal(dominantPick(null, f), null);
});

test('meadowNumber stays in its friendly range across seeds', () => {
  for (let s = 0; s < 500; s++) {
    const n = meadowNumber(s);
    assert.ok(n >= 101 && n <= 999);
  }
});

test('assembled haiku vary across playthroughs but stay in-family', () => {
  const narrations = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const card = composePostcard({ picks: ['dandelion'], seed, flowerById });
    assert.equal(card.moodKey, 'sun');
    assert.equal(card.lines.length, 3);
    assert.ok(BANKS.sun.open.includes(card.lines[0]));
    assert.ok(BANKS.sun.mid.includes(card.lines[1]));
    assert.ok(BANKS.sun.close.includes(card.lines[2]));
    narrations.add(card.narration);
  }
  // 6 opens x 5 mids x 4 closes = 120 possible sun poems; demand real spread.
  assert.ok(narrations.size >= 12, `expected wide variety, got ${narrations.size}`);
});

test('haiku time-of-day follows the hike stage when it mentions time at all', () => {
  const NIGHT = /dusk|sunset|twilight|evening|night|moon|starlight|\bstars\b/i;
  const picks = ['poppy', 'tulip', 'cosmos', 'foxglove', 'camas'];
  for (let seed = 1; seed < 400; seed += 7) {
    for (let stage = 0; stage < 3; stage++) {
      const card = composePostcard({ picks: picks.slice(stage % 3), seed, flowerById, stage });
      for (const line of card.lines) {
        assert.ok(!NIGHT.test(line), `night word leaked at stage ${stage}: ${line}`);
      }
    }
  }
  // stage 0 (dawn) never claims afternoon; stage 2 (afternoon) never dawn
  for (let seed = 0; seed < 300; seed += 11) {
    for (const line of composePostcard({ picks, seed, flowerById, stage: 0 }).lines) {
      assert.ok(!/\bafternoon\b|\bnoon\b|\bmidday\b/i.test(line), `afternoon at dawn: ${line}`);
    }
    for (const line of composePostcard({ picks, seed, flowerById, stage: 2 }).lines) {
      assert.ok(!/\bdawn\b|\bsunrise\b|\bmorning\b/i.test(line), `dawn word at summit: ${line}`);
    }
  }
});
