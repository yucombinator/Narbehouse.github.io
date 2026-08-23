// Pure flower roster + seeded choice sampling for meadow stops.
//
// Design: four simple flower SHAPES (daisy, cup, bell, puff), each in
// several colourways = 25 variants (15 wildflower classics + 10 garden
// favourites). Five stops × three offers sample from the shuffled roster,
// so every run shows fifteen distinct variants — never a repeat within a
// run, with fresh combinations each run. Similar flowers grow together on
// the ground: each flight segment carries one variant's colour mood (see
// segmentMood).
//
// No three.js, DOM, or WebAudio.

import { mulberry32 } from './rand.js';

export const ROSTER = [
  // --- DAISY shape: flat ray petals around a round centre ---------------
  { id: 'blackeyed-susan', name: 'Black-eyed Susan', tts: 'Black-eyed Susan',
    shape: 'daisy', petalHex: '#f2b01e', centerHex: '#4a2c17',
    fact: 'A sunny prairie classic' },
  { id: 'oxeye-daisy', name: 'Oxeye Daisy', tts: 'Oxeye daisy',
    shape: 'daisy', petalHex: '#f6ecd4', centerHex: '#f2c21e',
    fact: 'A meadow classic' },
  { id: 'cosmos', name: 'Cosmos', tts: 'Cosmos',
    shape: 'daisy', petalHex: '#ee86b5', centerHex: '#f2c21e',
    fact: 'Feathery leaves, papery petals' },
  { id: 'sunflower', name: 'Sunflower', tts: 'Sunflower',
    shape: 'daisy', petalHex: '#f7c81e', centerHex: '#6b4423',
    fact: 'Young ones turn to follow the sun' },

  // --- CUP shape: petals gathered into a cup ----------------------------
  { id: 'poppy', name: 'Red Poppy', tts: 'Red poppy',
    shape: 'cup', petalHex: '#d43a2f', centerHex: '#2c2c2c',
    fact: 'A symbol of remembrance' },
  { id: 'california-poppy', name: 'California Poppy', tts: 'California poppy',
    shape: 'cup', petalHex: '#f39c2c', centerHex: '#d97b1f',
    fact: 'Closes up at night' },
  { id: 'buttercup', name: 'Meadow Buttercup', tts: 'Buttercup',
    shape: 'cup', petalHex: '#ffd83d', centerHex: '#e8b90a',
    fact: 'Glossy little cups of sunshine' },
  { id: 'tulip', name: 'Pink Tulip', tts: 'Pink tulip',
    shape: 'cup', petalHex: '#e05263', centerHex: '#f2c21e',
    fact: 'A classic garden cup on a stem' },

  // --- BELL shape: nodding bells up a stem -------------------------------
  { id: 'columbine', name: 'Western Columbine', tts: 'Western columbine',
    shape: 'bell', petalHex: '#d94f3d', centerHex: '#f7d154',
    fact: 'Hummingbirds love it' },
  { id: 'camas', name: 'Camas Lily', tts: 'Camas lily',
    shape: 'bell', petalHex: '#8aa7e8', centerHex: '#5c79c9',
    fact: 'Blue fields like lakes of blue' },
  { id: 'lupine', name: 'Lupine', tts: 'Lupine',
    shape: 'bell', petalHex: '#8b7fd6', centerHex: '#eee7fa',
    fact: 'Paints subalpine slopes purple' },
  { id: 'bellflower', name: 'Bellflower', tts: 'Bellflower',
    shape: 'bell', petalHex: '#9b7fd4', centerHex: '#7a5cb8',
    fact: 'Rings of purple up the stem' },
  { id: 'foxglove', name: 'Foxglove', tts: 'Foxglove',
    shape: 'bell', petalHex: '#e8a8c8', centerHex: '#c97ba3',
    fact: 'Speckled thimbles bees dive into' },

  // --- PUFF shape: soft rounded clusters ---------------------------------
  { id: 'dandelion', name: 'Dandelion', tts: 'Dandelion',
    shape: 'puff', petalHex: '#f5c518', centerHex: '#e8a10d',
    fact: 'Turns into a wish-blowing puffball' },
  { id: 'oregon-grape', name: 'Oregon Grape', tts: 'Oregon grape',
    shape: 'puff', petalHex: '#f7e04b', centerHex: '#8a5a2a',
    fact: "Oregon's state flower" },
  { id: 'white-clover', name: 'White Clover', tts: 'White clover',
    shape: 'puff', petalHex: '#f2ebd6', centerHex: '#e0e0d2',
    fact: 'Sweet little lawns of white' },

  // --- Recognizable garden classics ---------------------------------------
  { id: 'rose', name: 'Rose', tts: 'Rose',
    shape: 'cup', petalHex: '#d94f6f', centerHex: '#b23a55',
    fact: 'The classic spiral of layered petals' },
  { id: 'marigold', name: 'Marigold', tts: 'Marigold',
    shape: 'puff', petalHex: '#f5a623', centerHex: '#c8781a',
    fact: 'Golden ruffles gardens love' },
  { id: 'jasmine', name: 'Jasmine', tts: 'Jasmine',
    shape: 'daisy', petalHex: '#f5edd9', centerHex: '#f2e18c',
    fact: 'Tiny stars with a night perfume' },
  { id: 'lavender', name: 'Lavender', tts: 'Lavender',
    shape: 'bell', petalHex: '#b39ddb', centerHex: '#8f76c2',
    fact: 'Purple spikes bees hum around' },
  { id: 'daffodil', name: 'Daffodil', tts: 'Daffodil',
    shape: 'cup', petalHex: '#ffce30', centerHex: '#f59d1e',
    fact: 'Wears a golden trumpet' },
  { id: 'peony', name: 'Peony', tts: 'Peony',
    shape: 'puff', petalHex: '#f7a8c0', centerHex: '#e88aa8',
    fact: 'A soft blush ball of petals' },
  { id: 'chrysanthemum', name: 'Chrysanthemum', tts: 'Chrysanthemum',
    shape: 'puff', petalHex: '#eda04f', centerHex: '#b96a2a',
    fact: 'Autumn\u2019s many-petalled crown' },
  { id: 'lotus', name: 'Lotus', tts: 'Lotus',
    shape: 'cup', petalHex: '#f2b8cf', centerHex: '#e8d44f',
    fact: 'Blooms above still water' },
  { id: 'lantana', name: 'Lantana', tts: 'Lantana',
    shape: 'puff', petalHex: '#ef7f4e', centerHex: '#e8b93c',
    fact: 'One cluster, sunset colors mixed' },
  { id: 'orchid', name: 'Orchid', tts: 'Orchid',
    shape: 'bell', petalHex: '#c86fd4', centerHex: '#9a4fae',
    fact: 'An elegant, exotic bloom' },
];

// The day is a hike from a garden at dawn to a summit ridge in afternoon
// light. Each stage's meadow grows only its own elevation band of flowers,
// and the stop offers are drawn from the same pool — what you see is what
// you can pick. Fifteen ids each = five stops x three offers, no repeats.
export const MEADOW_POOLS = [
  [ // Stage 1 — Garden at Dawn: familiar faces, low and friendly
    'tulip', 'rose', 'peony', 'daffodil', 'oxeye-daisy', 'white-clover',
    'california-poppy', 'cosmos', 'buttercup', 'marigold', 'jasmine',
    'chrysanthemum', 'lavender', 'poppy', 'sunflower',
  ],
  [ // Stage 2 — Valley Meadow: prairie classics in morning light
    'camas', 'columbine', 'blackeyed-susan', 'sunflower', 'bellflower',
    'poppy', 'oregon-grape', 'lavender', 'white-clover', 'dandelion',
    'cosmos', 'buttercup', 'california-poppy', 'oxeye-daisy', 'marigold',
  ],
  [ // Stage 3 — Summit Ridge: thin air — lupines and hardy travellers
    'lupine', 'foxglove', 'columbine', 'bellflower', 'camas', 'oregon-grape',
    'oxeye-daisy', 'buttercup', 'white-clover', 'dandelion', 'blackeyed-susan',
    'cosmos', 'lavender', 'poppy', 'california-poppy',
  ],
];

export function flowerById(id) {
  return ROSTER.find((f) => f.id === id) || null;
}

const CHOICES_PER_STOP = 3;

export function choicesPerStop() {
  return CHOICES_PER_STOP;
}

// How many stops' worth of offers the roster can cover without repeating a
// variant anywhere in a run.
export function maxStopsCovered() {
  return Math.floor(ROSTER.length / CHOICES_PER_STOP);
}

// Deterministically pick the flowers offered at one stop. Each variant is
// offered at most once per run: the whole roster is shuffled once (seeded),
// and stop N reads its own slice, so offers never repeat across stops.
export function sampleChoices(seed, stopIndex, poolIds) {
  // murmur3-style finalizer so nearby seeds never correlate.
  const mix = (x) => {
    x |= 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return (x ^ (x >>> 16)) >>> 0;
  };
  const rng = mulberry32(mix(seed >>> 0));
  let pool = (Array.isArray(poolIds) && poolIds.length ? [...poolIds] : ROSTER.map((f) => f.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const start = stopIndex * CHOICES_PER_STOP;
  if (start + CHOICES_PER_STOP > pool.length) return [];
  return pool.slice(start, start + CHOICES_PER_STOP);
}

// The colour mood of the ground meadow for flight segment i (between stop i
// and stop i+1): similar flowers tend to grow together, so each stretch of
// meadow leans toward one variant's colours. Returns the flower or null.
export function segmentMood(seed, segmentIndex) {
  const offers = sampleChoices(seed, segmentIndex);
  if (offers.length === 0) return null;
  const mix = (x) => {
    x |= 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return (x ^ (x >>> 16)) >>> 0;
  };
  const rng = mulberry32(mix(mix(seed >>> 0) ^ (segmentIndex + 1)));
  return flowerById(offers[Math.floor(rng() * offers.length)]);
}

// A short spoken/display title for a finished bouquet, derived from its mix.
function pluralName(name) {
  if (/(s|x|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

export function bouquetTitle(picks) {
  if (!Array.isArray(picks) || picks.length === 0) return 'A wildflower bouquet';
  const counts = {};
  for (const p of picks) counts[p] = (counts[p] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topCount = sorted[0][1];
  const runnersUp = sorted.length > 1 ? sorted[1][1] : 0;
  const top = flowerById(sorted[0][0]);
  if (!top) return 'A wildflower bouquet';
  const article = /^[aeiou]/i.test(top.name) ? 'An' : 'A';
  if (topCount === picks.length && picks.length > 1) return `${article} ${top.name} bouquet`;
  if (topCount >= 2 && topCount > runnersUp) return `Featuring ${pluralName(top.name.toLowerCase())}`;
  if (sorted.length >= 4) return 'A whole garden in one bouquet';
  return 'A mixed garden bouquet';
}
