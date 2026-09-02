// Pure postcard composition for the bouquet ceremony: a collectible
// "Meadow Postcard" whose haiku is ASSEMBLED from mood-family word banks —
// every line is self-contained, so any combination reads cleanly. Seeded
// selection keeps a given run's card deterministic while giving hundreds of
// distinct poems across playthroughs.
//
// No three.js, DOM, or WebAudio.

// Word banks per colour family. Lines are written to be order-independent:
// an opening scene, a middle turn, and a closing breath.
export const BANKS = {
  sun: {
    open: [
      'Warm crowns in the wheat,',
      'The hillside hums low;',
      'Little cups of sun,',
      'Gold spills down the slope;',
      'Late light on the grass —',
      'A field full of embers,',
      'Buttercups to the horizon;',
      'A jar of spilled sunlight,',
      'Pollen dusts the breeze —',
      'Small suns on slim stems,',
      'The meadow wears amber;',
      'Heat shimmer of petals,',
    ],
    mid: [
      'every stalk holds its note;',
      'the warm air moves like honey;',
      'small fires that never burn;',
      'afternoon leans in to listen;',
      'the light stays a while longer;',
      'each one a tiny lantern;',
      'sweetness on the warm wind;',
      'gold answering gold;',
      'bees droning their approval;',
      'bright as a welcome home;',
    ],
    close: [
      'dusk walks slowly home.',
      'the day forgets to end.',
      'evening keeps the gold.',
      'the wind drinks them in.',
      'the light lingers kindly.',
      'warm all the way down.',
      'the field glows on.',
      'kept like afternoon sun.',
    ],
  },
  rose: {
    open: [
      'Bold hearts in the grass;',
      'Pink and crimson notes,',
      'Petals like kind words,',
      'Red hems on the hillside;',
      'A blush among the green —',
      'Small trumpets of red,',
      'Rose-red confetti,',
      'Pink fires, gentle ones;',
      'Small valentines bloom —',
      'A parade of petals;',
      'Crimson chords in green;',
      'Sweet hearts on thin stems,',
    ],
    mid: [
      'each bloom a soft thank-you;',
      'a quiet song without words;',
      'warmer than the noon air;',
      'brave as first mornings;',
      'saying what needs no saying;',
      'each petal a kind word;',
      'colour like laughter;',
      'soft as a held hand;',
      'brave ribbons in the wind;',
      'warming the whole hillside;',
    ],
    close: [
      'the breeze says it back.',
      'sung straight to the heart.',
      'carried gently home.',
      'remembered all winter.',
      'loved at first light.',
      'the heart says thank you.',
      'petals in your pocket.',
      'red that never fades.',
    ],
  },
  sky: {
    open: [
      'A hush of blue bells;',
      'Quiet as deep lakes,',
      'Violet whispers,',
      'Blue threads through the green;',
      'Cool petals at dawn —',
      'Where clouds lean lower,',
      'Lavender in waves,',
      'A drift of periwinkle,',
      'Indigo at the edges —',
      'Soft blue congregation,',
      'Violets underfoot,',
      'Blue as a held breath,',
    ],
    mid: [
      'clouds pause to admire them;',
      'your flowers remember rain;',
      'the evening listens closely;',
      'stillness made of colour;',
      'the sky leans down to hear;',
      'colour poured from the sky;',
      'a calm, cool octave;',
      'the wind rearranges blue;',
      'petals like quiet water;',
      'humming a lower note;',
    ],
    close: [
      'the sky nods approval.',
      'and shine all the more.',
      'peace you can carry.',
      'the day speaks softly here.',
      'the blue carries you.',
      'stillness, signed in blue.',
      'the horizon approves.',
      'wide as the sky above.',
    ],
  },
  cream: {
    open: [
      'White wings in the grass;',
      'Moon-coloured blossoms,', // night-filtered during stages; album-only
      'Light as a promise,',
      'Pale sails on a green sea;',
      'Morning opens slowly —',
      'Soft crowns, barely there,',
      'White caps on the green;',
      'A scatter of pearl,',
      'Cream on green velvet —',
      'Small lamps in the grass,',
      'Petals like first pages,',
      'An understudy of white,',
    ],
    mid: [
      'morning opens softly here;',
      'keeping the meadow’s secrets;',
      'pale petals in soft focus;',
      'quiet as unsaid prayers;',
      'holding the light gently;',
      'a hush between heartbeats;',
      'soft voices of the field;',
      'luminous and unhurried;',
      'pale flags of peace;',
      'the grass leans in to listen;',
      'mid-morning takes its time;',
    ],
    close: [
      'nothing hurries now.',
      'simple, and enough.',
      'the day rests its tools.',
      'rest, and then more rest.',
      'gentle to the end.',
      'quiet that restores.',
      'a breath you keep.',
      'the white outshines gold.',
    ],
  },
};

function hexToHsl(hex) {
  const m = /^#[0-9a-f]{6}$/i.exec(String(hex));
  if (!m) return null;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

// Map any petalHex to a colour-family key used by HAIKUS.
export function moodKeyForHex(hex) {
  const c = hexToHsl(hex);
  if (!c || c.l > 0.92 || c.s < 0.22) return 'cream'; // whites/near-whites
  if (c.l > 0.86 && c.s < 0.72 && c.h >= 20 && c.h < 75) return 'cream'; // warm ivory — white flowers, gently warmed
  if (c.h >= 300 || c.h < 15) return 'rose'; // pinks, crimsons, reds
  if (c.h < 80) return 'sun'; // golds, oranges, warm yellows
  if (c.h >= 195 && c.h < 300) return 'sky'; // blues, violets
  return 'sun'; // stray greens read as warm meadow light
}

// The bouquet's dominant variant: most common pick, ties broken by earliest
// appearance. Returns null for an empty run.
export function dominantPick(picks, flowerById) {
  if (!Array.isArray(picks) || picks.length === 0) return null;
  const counts = {};
  const firstSeen = {};
  picks.forEach((id, i) => {
    counts[id] = (counts[id] || 0) + 1;
    if (!(id in firstSeen)) firstSeen[id] = i;
  });
  let best = null;
  for (const id of Object.keys(counts)) {
    if (
      best === null ||
      counts[id] > counts[best] ||
      (counts[id] === counts[best] && firstSeen[id] < firstSeen[best])
    ) {
      best = id;
    }
  }
  return best ? flowerById(best) : null;
}

// Stable little PRNG so a given (picks, seed) always yields the same card.
function mix32(x) {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function picksSignature(picks) {
  // Order matters (first pick sets the tone), so fold indices in.
  let acc = 2166136261 >>> 0; // FNV-1a basis
  picks.forEach((p, i) => {
    acc ^= mix32(mix32(i + 1) ^ mix32(String(p).length * 31 + (p.charCodeAt(0) || 0)));
    acc = mix32(acc);
  });
  return acc;
}

export function meadowNumber(seed) {
  // Decorative registry number: hash the meadow seed first, so consecutive
  // runs (seed counter 42, 43, …) don't produce consecutive "Meadow No.s".
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return 101 + (x % 899);
}

// Time-of-day connotations some lines carry. The haiku never HAS to mention
// time — but when a line does, it must match the meadow's hour on the hike:
// stage 0 is dawn, stage 1 mid-morning, stage 2 afternoon. Night words have
// no stage and are always filtered out.
const TIME_BUCKETS = [
  { re: /\bdawn\b|\bsunrise\b|\bdaybreak\b|first light/i, key: 'dawn' },
  { re: /\bmorning\b/i, key: 'morning' },
  { re: /\bnoon\b|\bmidday\b/i, key: 'noon' },
  { re: /\bafternoon\b/i, key: 'afternoon' },
  { re: /\bdusk\b|\bsunset\b|\btwilight\b|\bevening\b|\bnight\b|\bmidnight\b|\bmoon\b|\bstarlight\b|\bstars\b/i, key: 'night' },
];
const STAGE_TIMES = [['dawn'], ['morning'], ['afternoon', 'noon']];

function lineTimeOk(line, allowed) {
  const hits = TIME_BUCKETS.filter((b) => b.re.test(line)).map((b) => b.key);
  if (!hits.length) return true; // timeless lines fit any hour
  return hits.every((k) => allowed.includes(k));
}

// Compose everything the postcard view needs. The haiku is assembled from
// the family's three banks with independent seeded streams, so a family
// yields open.length × mid.length × close.length distinct poems.
export function composePostcard({ picks, seed, flowerById, stage = null }) {
  const dom = dominantPick(picks, flowerById);
  const moodKey = dom ? moodKeyForHex(dom.petalHex) : 'cream';
  const bank = BANKS[moodKey];
  const sig = mix32(mix32(seed >>> 0) ^ picksSignature(Array.isArray(picks) ? picks : []));
  const s1 = mix32(sig ^ 0x9e3779b9);
  const s2 = mix32(sig ^ 0x85ebca6b);
  const s3 = mix32(sig ^ 0xc2b2ae35);
  const allowed = stage === null
    ? null
    : STAGE_TIMES[((stage % STAGE_TIMES.length) + STAGE_TIMES.length) % STAGE_TIMES.length];
  const from = (arr, i) => {
    const fitting = allowed ? arr.filter((l) => lineTimeOk(l, allowed)) : arr;
    const pool = fitting.length ? fitting : arr; // safety: never empty-handed
    return pool[i % pool.length];
  };
  const lines = [
    from(bank.open, s1),
    from(bank.mid, s2),
    from(bank.close, s3),
  ];
  return {
    number: meadowNumber(seed),
    moodKey,
    lines,
    // Spoken version: no meadow number (repetitive aloud) — the card shows it.
    narration: lines.join(' '),
    dominantId: dom ? dom.id : null,
  };
}
