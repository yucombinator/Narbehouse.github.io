// SVG art builders: shaded wicker basket, stylized flower heads, and the
// bouquet postcard illustration. Pure string builders — no DOM injection
// here, callers set innerHTML. No three.js or WebAudio.

// --- Flower heads ---------------------------------------------------------
// One stylized head per roster shape. r = head radius in px.
export function flowerHeadSvg(f, r = 15, extra = '') {
  const p = f.petalHex;
  const c = f.centerHex;
  const shade = 'rgba(0,0,0,0.10)';
  let out = '';
  if (f.shape === 'cup') {
    // Three fanned vertical petals gathered into a cup.
    for (const [ang, dx] of [[-24, -r * 0.42], [0, 0], [24, r * 0.42]]) {
      out += `<ellipse cx="${dx}" cy="${-r * 0.18}" rx="${r * 0.42}" ry="${r * 0.85}" fill="${p}" stroke="${shade}" stroke-width="0.6" transform="rotate(${ang})"/>`;
    }
    out += `<circle cx="0" cy="${r * 0.42}" r="${r * 0.3}" fill="${c}"/>`;
    out += `<path d="M ${-r * 0.3},${r * 0.05} q ${r * 0.3},${r * 0.5} ${r * 0.6},0" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="0.8"/>`;
  } else if (f.shape === 'bell') {
    // Nodding bell with a scalloped mouth.
    out += `<path d="M 0,${-r} C ${r * 0.8},${-r * 0.75} ${r * 0.85},${r * 0.25} ${r * 0.42},${r * 0.8} L ${-r * 0.42},${r * 0.8} C ${-r * 0.85},${r * 0.25} ${-r * 0.8},${-r * 0.75} 0,${-r} Z" fill="${p}" stroke="${shade}" stroke-width="0.7"/>`;
    for (const dx of [-r * 0.26, 0, r * 0.26]) {
      out += `<circle cx="${dx}" cy="${r * 0.78}" r="${r * 0.16}" fill="${p}"/>`;
      out += `<circle cx="${dx}" cy="${r * 0.86}" r="${r * 0.07}" fill="${c}"/>`;
    }
    out += `<circle cx="0" cy="${-r * 0.35}" r="${r * 0.2}" fill="rgba(255,255,255,0.25)"/>`;
  } else if (f.shape === 'puff') {
    // Soft cluster of round florets.
    const ring = [[0, -r * 0.55], [r * 0.5, -r * 0.28], [r * 0.5, r * 0.28], [0, r * 0.55], [-r * 0.5, r * 0.28], [-r * 0.5, -r * 0.28]];
    for (const [dx, dy] of ring) {
      out += `<circle cx="${dx}" cy="${dy}" r="${r * 0.4}" fill="${p}" stroke="${shade}" stroke-width="0.5"/>`;
      out += `<circle cx="${dx - r * 0.08}" cy="${dy - r * 0.08}" r="${r * 0.1}" fill="rgba(255,255,255,0.35)"/>`;
    }
    out += `<circle cx="0" cy="0" r="${r * 0.34}" fill="${c}"/>`;
  } else {
    // daisy: flat ray of petals around a round centre.
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = Math.round((i / n) * 360);
      out += `<ellipse cx="0" cy="${-r * 0.66}" rx="${r * 0.34}" ry="${r * 0.62}" fill="${p}" stroke="${shade}" stroke-width="0.5" transform="rotate(${a})"/>`;
    }
    out += `<circle cx="0" cy="0" r="${r * 0.4}" fill="${c}"/>`;
    out += `<circle cx="${-r * 0.12}" cy="${-r * 0.12}" r="${r * 0.1}" fill="rgba(255,255,255,0.4)"/>`;
  }
  return `<g ${extra}>${out}</g>`;
}

// --- Wicker basket --------------------------------------------------------
// Painted side-view wicker: a round-bellied silhouette with converging ribs,
// belly-following weave bands and soft volume shading — reads as a vessel,
// not a flat panel. Blooms are appended later into #basketBlooms.
export function basketSvg(w = 190, h = 168) {
  const ribs = [];
  for (let i = 0; i < 9; i++) {
    const x0 = 54 + i * 11.5;
    const s = Math.sign(x0 - 100);
    const xb = x0 + s * 7;
    const xe = 100 + (x0 - 100) * 0.52;
    ribs.push(`<path d="M${x0},72 C${xb},102 ${xe + s * 2},132 ${xe},154" fill="none" stroke="rgba(112,74,38,0.5)" stroke-width="3.4"/>`);
    ribs.push(`<path d="M${x0 + 5.6},72 C${xb + 5.6},104 ${xe + s * 2 + 4},134 ${xe + 4},153" fill="none" stroke="rgba(244,214,166,0.4)" stroke-width="1.6"/>`);
  }
  const bands = [
    [96, 110, 4.5, 'rgba(122,80,40,0.42)'],
    [114, 130, 4.5, 'rgba(122,80,40,0.4)'],
    [134, 146, 4, 'rgba(122,80,40,0.36)'],
  ];
  const bandSvg = bands
    .map(
      ([y, dy, w, col]) =>
        `<path d="M31,${y} Q100,${y + dy} 169,${y}" fill="none" stroke="${col}" stroke-width="${w}"/>
         <path d="M31,${y + 5} Q100,${y + dy + 6} 169,${y + 5}" fill="none" stroke="rgba(248,222,178,0.35)" stroke-width="1.7"/>`
    )
    .join('');
  return `
<svg viewBox="0 0 200 176" width="${w}" height="${h}" aria-hidden="true">
  <defs>
    <linearGradient id="bw-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e3ba84"/>
      <stop offset="0.5" stop-color="#c69357"/>
      <stop offset="1" stop-color="#96683a"/>
    </linearGradient>
    <linearGradient id="bw-shadeL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="rgba(255,240,210,0.34)"/>
      <stop offset="0.28" stop-color="rgba(255,240,210,0)"/>
    </linearGradient>
    <linearGradient id="bw-shadeR" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="rgba(56,33,12,0.42)"/>
      <stop offset="0.3" stop-color="rgba(56,33,12,0)"/>
    </linearGradient>
    <radialGradient id="bw-sheen" cx="0.32" cy="0.22" r="0.55">
      <stop offset="0" stop-color="rgba(255,246,224,0.35)"/>
      <stop offset="1" stop-color="rgba(255,246,224,0)"/>
    </radialGradient>
    <linearGradient id="bw-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0d09a"/>
      <stop offset="1" stop-color="#b98a52"/>
    </linearGradient>
    <linearGradient id="bw-handle" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8a5d2c"/>
      <stop offset="0.5" stop-color="#d8ab6e"/>
      <stop offset="1" stop-color="#8a5d2c"/>
    </linearGradient>
    <!-- tight over-under wicker weave, tone-on-tone and low-contrast so it
         reads as texture up close without becoming a focal point -->
    <pattern id="bw-weave" width="11" height="8" patternUnits="userSpaceOnUse">
      <rect width="11" height="4" fill="rgba(255,236,200,0.17)"/>
      <rect y="4" width="11" height="4" fill="rgba(88,56,24,0.19)"/>
      <path d="M0,4 Q2.75,3 5.5,4 T11,4" fill="none" stroke="rgba(255,240,208,0.14)" stroke-width="1"/>
      <path d="M0,8 Q2.75,7 5.5,8 T11,8" fill="none" stroke="rgba(70,44,18,0.15)" stroke-width="1"/>
      <rect x="5.2" width="1.5" height="8" fill="rgba(96,62,28,0.13)"/>
    </pattern>
    <pattern id="bw-gingham" width="14" height="14" patternUnits="userSpaceOnUse">
      <rect width="14" height="14" fill="#fbefe6"/>
      <rect width="7" height="14" fill="rgba(216,130,150,0.34)"/>
      <rect width="14" height="7" fill="rgba(216,130,150,0.34)"/>
    </pattern>
    <radialGradient id="bw-shadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="rgba(80,50,25,0.38)"/>
      <stop offset="1" stop-color="rgba(80,50,25,0)"/>
    </radialGradient>
    <clipPath id="bw-clip">
      <path d="M50,68 C36,86 30,106 34,122 C39,143 64,157 100,157 C136,157 161,143 166,122 C170,106 164,86 150,68 Z"/>
    </clipPath>
  </defs>

  <!-- ground shadow -->
  <ellipse cx="100" cy="160" rx="74" ry="12" fill="url(#bw-shadow)"/>

  <!-- handle -->
  <path d="M54,62 C58,16 142,16 146,62" fill="none" stroke="#6b471f" stroke-width="11" stroke-linecap="round"/>
  <path d="M54,62 C58,16 142,16 146,62" fill="none" stroke="url(#bw-handle)" stroke-width="7" stroke-linecap="round"/>
  <path d="M60,56 C66,26 108,20 124,24" fill="none" stroke="rgba(255,238,204,0.6)" stroke-width="2" stroke-linecap="round"/>

  <!-- round body: belly out, tapering to a settled base -->
  <g clip-path="url(#bw-clip)">
    <rect x="26" y="64" width="148" height="96" fill="url(#bw-body)"/>
    <rect x="26" y="64" width="148" height="96" fill="url(#bw-weave)"/>
    ${ribs.join('')}
    ${bandSvg}
    <rect x="26" y="64" width="148" height="96" fill="url(#bw-sheen)"/>
    <rect x="26" y="64" width="148" height="96" fill="url(#bw-shadeL)"/>
    <rect x="26" y="64" width="148" height="96" fill="url(#bw-shadeR)"/>
    <!-- core shadow settling into the base -->
    <ellipse cx="100" cy="162" rx="70" ry="18" fill="rgba(60,35,14,0.35)"/>
    <!-- small reflected light so the base rounds off -->
    <ellipse cx="74" cy="152" rx="26" ry="7" fill="rgba(255,238,206,0.16)"/>
  </g>

  <!-- opening: interior then the near rim -->
  <ellipse cx="100" cy="68" rx="50" ry="12.5" fill="#46301a"/>
  <ellipse cx="100" cy="67" rx="43" ry="9.5" fill="#2f1f0e"/>

  <!-- gingham cloth over the right lip -->
  <path d="M112,56 C138,46 164,54 168,72 C170,86 154,94 136,90 C124,87 113,78 111,68 Z"
        fill="url(#bw-gingham)" stroke="rgba(170,100,120,0.55)" stroke-width="1"/>
  <path d="M118,60 C136,54 154,56 163,66" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.4"/>
  <path d="M48,62 C60,54 76,54 84,62 C76,72 58,72 48,66 Z"
        fill="url(#bw-gingham)" stroke="rgba(170,100,120,0.45)" stroke-width="1"/>

  <!-- picked blooms rest here (behind the front rim) -->
  <g id="basketBlooms"></g>

  <!-- front rim: a rolled coil following the ellipse -->
  <path d="M48,68 A52,14 0 0 0 152,68 A46,10.5 0 0 1 48,68 Z" fill="url(#bw-rim)" stroke="#7c5427" stroke-width="1.4"/>
  <path d="M52,71 A48,11 0 0 0 148,71" fill="none" stroke="rgba(255,238,208,0.85)" stroke-width="2"/>
  <path d="M50,75 A50,12.5 0 0 0 150,75" fill="none" stroke="rgba(122,80,40,0.45)" stroke-width="1.6"/>

  <!-- ribbon bow where the handle meets the rim -->
  <g transform="translate(53,59) rotate(-14)">
    <path d="M0,0 C -14,-9 -22,2 -8,8 Z" fill="#dd8ba0" stroke="#b26077" stroke-width="1"/>
    <path d="M0,0 C 14,-9 22,2 8,8 Z" fill="#dd8ba0" stroke="#b26077" stroke-width="1"/>
    <circle cx="0" cy="2" r="3.6" fill="#c06f87" stroke="#9c5468" stroke-width="1"/>
    <path d="M-3,6 C -7,14 -5,19 -8,24" fill="none" stroke="#dd8ba0" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M3,7 C 6,14 4,18 8,22" fill="none" stroke="#d37f96" stroke-width="3.4" stroke-linecap="round"/>
  </g>
</svg>`;
}

// Anchor points (viewBox coords) where picked blooms rest along the opening.
export const BASKET_ANCHORS = [
  [72, 70],
  [86, 64],
  [100, 61],
  [114, 64],
  [129, 69],
];
const BASKET_TILTS = [-14, -6, 2, 8, 16];

export function bloomInBasketSvg(f, index) {
  const [x, y] = BASKET_ANCHORS[index % BASKET_ANCHORS.length];
  const tilt = BASKET_TILTS[index % BASKET_TILTS.length];
  // Outer group carries the placement transform; the inner one carries the
  // pop animation. (A CSS animated transform would otherwise override the
  // placement attribute and pile every bloom at the origin.)
  return `<g transform="translate(${x},${y}) rotate(${tilt})"><g class="bloom-pop">${flowerHeadSvg(f, 16)}</g></g>`;
}

// --- Bouquet illustration for the postcard --------------------------------
const STEM_HEADS = [
  { x: 88, y: 132, r: 25 },
  { x: 125, y: 106, r: 27 },
  { x: 161, y: 94, r: 29 },
  { x: 198, y: 108, r: 27 },
  { x: 234, y: 134, r: 25 },
];

function leafPair(x, y, angle, tone) {
  return `
  <ellipse cx="-9" cy="0" rx="11" ry="4.5" fill="${tone}" transform="translate(${x},${y}) rotate(${angle - 38})"/>
  <ellipse cx="9" cy="0" rx="11" ry="4.5" fill="${tone}" transform="translate(${x},${y}) rotate(${angle + 38})" opacity="0.85"/>`;
}

export function bouquetSvg(picks, flowerById, w = 300, h = 250) {
  const n = picks.length || 1;
  const stems = [];
  const leaves = [];
  const heads = [];
  picks.forEach((id, i) => {
    const slot = STEM_HEADS[Math.round((i * (STEM_HEADS.length - 1)) / Math.max(1, n - 1))];
    const f = flowerById(id);
    if (!f) return;
    const ctrlX = 160 + (slot.x - 160) * 0.35 + (i % 2 ? 10 : -10);
    stems.push(
      `<path d="M160,232 Q ${ctrlX},${(232 + slot.y) / 2 + 14} ${slot.x},${slot.y + slot.r * 0.55}"
         fill="none" stroke="#6f8f57" stroke-width="5" stroke-linecap="round"/>`,
    );
    if (i % 2 === 0) leaves.push(leafPair(slot.x + (i % 4 ? 16 : -16), (232 + slot.y) / 2 + 6, i % 4 ? -12 : 12, i % 4 ? '#87a86e' : '#6f8f57'));
    heads.push(
      `<g transform="translate(${slot.x},${slot.y}) rotate(${(slot.x - 161) / 9})">
         ${flowerHeadSvg(f, slot.r)}
       </g>`,
    );
  });
  return `
<svg viewBox="0 0 322 268" width="${w}" height="${h}" role="img" aria-label="Illustration of your bouquet">
  <defs>
    <radialGradient id="bq-linen" cx="0.5" cy="0.42" r="0.65">
      <stop offset="0" stop-color="#fffaf1"/>
      <stop offset="1" stop-color="#f7ead6"/>
    </radialGradient>
  </defs>
  <ellipse cx="161" cy="140" rx="142" ry="112" fill="url(#bq-linen)"/>
  <ellipse cx="161" cy="140" rx="142" ry="112" fill="none" stroke="#e4cfaf" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>
  ${stems.join('')}
  ${leaves.join('')}
  <ellipse cx="161" cy="230" rx="26" ry="7" fill="rgba(111,143,87,0.25)"/>
  ${heads.join('')}
  <!-- ribbon wrap and bow -->
  <rect x="144" y="222" width="34" height="21" rx="7" fill="#d97f95" stroke="#b26077" stroke-width="1.2"/>
  <path d="M147,228 H175 M147,236 H175" stroke="rgba(140,60,80,0.5)" stroke-width="1.4"/>
  <g transform="translate(161,244)">
    <path d="M0,-2 C -20,-16 -34,4 -12,10 Z" fill="#e290a4" stroke="#b26077" stroke-width="1.2"/>
    <path d="M0,-2 C 20,-16 34,4 12,10 Z" fill="#e290a4" stroke="#b26077" stroke-width="1.2"/>
    <path d="M-6,7 C -12,20 -8,28 -14,36 L -6,33 Z" fill="#e290a4" stroke="#b26077" stroke-width="1"/>
    <path d="M6,7 C 12,20 8,28 14,36 L 6,33 Z" fill="#d97f95" stroke="#b26077" stroke-width="1"/>
    <circle cx="0" cy="2" r="6.4" fill="#c06f87" stroke="#9c5468" stroke-width="1.2"/>
  </g>
</svg>`;
}

// Postage stamp showing the bouquet's signature flower.
export function stampSvg(flower, w = 78, h = 92) {
  const head = flower ? `<g transform="translate(39,44)">${flowerHeadSvg(flower, 24)}</g>` : '';
  return `
<svg viewBox="0 0 78 92" width="${w}" height="${h}" aria-hidden="true">
  <defs>
    <pattern id="st-perf" width="7" height="7" patternUnits="userSpaceOnUse">
      <circle cx="3.5" cy="3.5" r="2.1" fill="#f7ecdb"/>
    </pattern>
  </defs>
  <rect x="0" y="0" width="78" height="92" rx="3" fill="#e9dcc3"/>
  <rect x="3" y="3" width="72" height="86" fill="url(#st-perf)"/>
  <rect x="5.5" y="5.5" width="67" height="81" fill="#fffdf6" stroke="#d9c49c" stroke-width="1"/>
  ${head}
  <text x="39" y="82" text-anchor="middle" font-family="Georgia, serif" font-size="9.5"
        letter-spacing="2.5" fill="#8a6238">MEADOW</text>
</svg>`;
}
